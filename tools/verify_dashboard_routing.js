/* 后台「数据看板」路由回归验证
 *
 * 背景：后台有两套完全不同的"数据看板"——
 *   ① 图片管理 → 数据看板（统计各类标签覆盖，读 #dash-meta）
 *   ② 超管权限 → 权限管理 → 数据看板（访问统计，读 #perm-dash）
 * 两套功能曾使用同名函数且都挂到全局，后加载的文件会覆盖前者的函数，
 * 结果：点左侧「数据看板」实际跑的是权限管理那套逻辑，面板永远没有数据。
 *
 * 本脚本断言：
 *   A. 各模块暴露到全局的名字互不重复（不再互相覆盖）；
 *   B. 「loadDashboard / bindDashboard」归「图片管理」那套所有；
 *   C. 「权限管理」那套使用独立名字，且两边各自读自己的元素；
 *   D. 左侧「数据看板」入口所在的脚本里没有自己的同名定义（即会用到正确的那一份）。
 *
 * 用法：node verify_dashboard_routing.js <站点根目录>
 */
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || ".";
const ORDER = ["admin.js", "admin-images.js", "admin-smart.js", "admin-trend.js", "admin-notice.js",
  "admin-marketing.js", "admin-tasks.js", "admin-bestseller.js", "admin-perm.js", "admin-pool.js", "admin-rank.js"];

function read(f) { return fs.readFileSync(path.join(root, "js", f), "utf8"); }

function exposureNames(src) {
  const i = src.lastIndexOf("Object.assign(window,");
  if (i < 0) return [];
  const j = src.indexOf("{", i);
  let depth = 0, k = j;
  while (k < src.length) {
    const c = src[k];
    if (c === '"' || c === "'") { const q = c; k++; while (k < src.length && src[k] !== q) k++; }
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) break; }
    k++;
  }
  const body = src.slice(j + 1, k);
  let d = 0, buf = "", parts = [];
  for (const c of body) {
    if ("{[(".includes(c)) d++;
    else if ("}])".includes(c)) d--;
    if (c === "," && d === 0) { parts.push(buf); buf = ""; } else buf += c;
  }
  parts.push(buf);
  return parts.map(s => s.trim()).filter(s => /^[A-Za-z_$][\w$]*$/.test(s));
}

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};

const sources = {};
const exposed = {};
ORDER.forEach(f => { sources[f] = read(f); exposed[f] = exposureNames(sources[f]); });

console.log("【A】全局暴露名是否重复");
const owner = {};
const dup = [];
ORDER.forEach(f => exposed[f].forEach(n => {
  if (owner[n] !== undefined) dup.push(n + "（" + owner[n] + " 与 " + f + "）");
  owner[n] = f;
}));
check("所有模块暴露的函数名互不重复", dup.length === 0, dup.join("; "));
console.log("    共检查 " + Object.keys(owner).length + " 个全局名字");

console.log("【B】「图片管理 → 数据看板」的名字归属");
check("loadDashboard 归图片管理模块所有", owner["loadDashboard"] === "admin-images.js", "实际 " + owner["loadDashboard"]);
check("bindDashboard 归图片管理模块所有", owner["bindDashboard"] === "admin-images.js", "实际 " + owner["bindDashboard"]);

console.log("【C】两套看板各自读自己的页面元素");
const imgDashFn = sources["admin-images.js"];
const permDashFn = sources["admin-perm.js"];
check("图片管理看板：读 #dash-meta", /#{0,1}\$\(["']#dash-meta["']\)/.test(imgDashFn));
check("权限管理看板：读 #perm-dash", /\$\(["']#perm-dash["']\)/.test(permDashFn));
check("权限管理看板已使用独立名字 loadAnalyticsDash", owner["loadAnalyticsDash"] === "admin-perm.js", "实际 " + owner["loadAnalyticsDash"]);
check("权限管理看板已使用独立名字 bindAnalyticsDash", owner["bindAnalyticsDash"] === "admin-perm.js", "实际 " + owner["bindAnalyticsDash"]);
check("权限管理模块不再占用公共名字", !exposed["admin-perm.js"].includes("loadDashboard") && !exposed["admin-perm.js"].includes("bindDashboard"));

console.log("【D】左侧「数据看板」入口调用的是哪一套");
check("admin.js 未自行定义 loadDashboard（会用到全局，即图片管理那套）", !/function\s+loadDashboard\s*\(/.test(sources["admin.js"]));
check("admin.js 的数据看板分支调用了 loadDashboard", /target\s*===\s*["']dash-card["'][^\n]*loadDashboard\(\)/.test(sources["admin.js"]));
check("面板初始化调用 bindDashboard（现为图片管理那套）", /bindDashboard/.test(sources["admin.js"]));
check("权限管理面板初始化调用 bindAnalyticsDash", /bindAnalyticsDash\(\);/.test(sources["admin-perm.js"]));

console.log("【E】看板读取的登录态防护与错误码展示");
check("读取看板前先确认登录态（避免以未登录身份请求而误报没权限）",
  /async function loadAnalyticsDash[\s\S]{0,1200}?SB\.getSession\(\)/.test(permDashFn));
check("未取到登录态时给出「请重新登录」而不是「没权限」",
  /async function loadAnalyticsDash[\s\S]{0,2000}?DASH_ERR_TEXT\.not_authenticated/.test(permDashFn));
check("看板失败时展示接口错误码（便于一眼定位）", /function dashDiagLine/.test(permDashFn) && /dashDiagLine\(e\)/.test(permDashFn));
check("错误码展示已做净化（不含地址/原始报错）", /replace\(\/\[\^A-Za-z0-9_\]\/g, ""\)/.test(permDashFn) || /replace\(\/\[\^A-Za-z0-9_\]\/g,\s*""\)/.test(permDashFn));

console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);