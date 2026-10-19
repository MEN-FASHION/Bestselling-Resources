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
  "admin-marketing.js", "admin-tasks.js", "admin-bestseller.js", "admin-perm.js", "admin-pool.js", "admin-rank.js",
  "admin-insight.js", "admin-backup.js"];

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

console.log("【C】图片管理看板保留，权限管理里的数据看板已移除（需求：权限管理的数据看板不要了）");
const imgDashFn = sources["admin-images.js"];
const permDashFn = sources["admin-perm.js"];
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
check("图片管理看板：读 #dash-meta", /#{0,1}\$\(["']#dash-meta["']\)/.test(imgDashFn));
check("权限管理面板已无数据看板 DOM（perm-dash 已移除）", adminHtml.indexOf("perm-dash") < 0);
check("权限管理脚本已无看板读取函数 loadAnalyticsDash", permDashFn.indexOf("loadAnalyticsDash") < 0);
check("权限管理脚本已无看板绑定函数 bindAnalyticsDash", permDashFn.indexOf("bindAnalyticsDash") < 0);
check("权限管理模块不再占用公共名字", !exposed["admin-perm.js"].includes("loadDashboard") && !exposed["admin-perm.js"].includes("bindDashboard"));
check("权限管理面板未遗留对已删元素的引用", !/\$\(["']#(perm-dash|dash-zones|dash-regions|dash-recent|dash-cards)["']\)/.test(permDashFn));

console.log("【D】左侧「数据看板」入口调用的是哪一套");
check("admin.js 未自行定义 loadDashboard（会用到全局，即图片管理那套）", !/function\s+loadDashboard\s*\(/.test(sources["admin.js"]));
check("admin.js 的数据看板分支调用了 loadDashboard", /target\s*===\s*["']dash-card["'][^\n]*loadDashboard\(\)/.test(sources["admin.js"]));
check("面板初始化调用 bindDashboard（现为图片管理那套）", /bindDashboard/.test(sources["admin.js"]));

console.log("【E】新增两个超管面板（用户动向 / 版本恢复）");
const insFn = sources["admin-insight.js"] || "";
const bkpFn = sources["admin-backup.js"] || "";
check("admin.html 含「用户动向」面板", adminHtml.indexOf('id="insight-card"') >= 0);
check("admin.html 含「版本恢复」面板", adminHtml.indexOf('id="backup-card"') >= 0);
check("侧边菜单含「用户动向」入口（超管专属）", /data-target="insight-card"[^>]*data-super="1"/.test(adminHtml));
check("侧边菜单含「版本恢复」入口（超管专属）", /data-target="backup-card"[^>]*data-super="1"/.test(adminHtml));
check("admin.html 已引入用户动向脚本", /admin-insight\.js\?v=/.test(adminHtml));
check("admin.html 已引入版本恢复脚本", /admin-backup\.js\?v=/.test(adminHtml));
check("面板分区：用户动向任一管理员专区可入", /"insight-card"\s*:/.test(sources["admin.js"]));
check("面板分区：版本恢复仅超管", /"backup-card"\s*:\s*"super"/.test(sources["admin.js"]));
check("用户动向：面板上定义了三个子页（前台用户 / 专区·菜单热度 / 后台管理员）",
  /data-iv="iv-1"/.test(adminHtml) && /data-iv="iv-2"/.test(adminHtml) && /data-iv="iv-3"/.test(adminHtml));
check("用户动向：脚本按 data-iv 通用切换子页（不写死子页清单）",
  /getAttribute\("data-iv"\)/.test(insFn));
check("用户动向：面板自带分层自检入口", /ins-probe/.test(adminHtml) && /connProbe/.test(insFn));
check("版本恢复：脚本内含快照与恢复动作", /insight|bkp/i.test(bkpFn) && /restore/i.test(bkpFn));
check("版本恢复：恢复前先自动备份", /恢复前自动备份/.test(bkpFn));
{
  const sbSrc = fs.readFileSync(path.join(root, "js", "supabase.js"), "utf8");
  const bkpSql = fs.readFileSync(path.join(root, "tools", "setup_backup.sql"), "utf8");
  check("版本恢复：恢复走数据层专用函数（不是直接写表）", /SB\.backupRestore\(/.test(bkpFn));
  check("版本恢复：专用函数映射到服务端 backup_restore",
    /backupRestore\(id\)\s*\{\s*return this\.rpcJson\("backup_restore"/.test(sbSrc));
  // 恢复必须「先校验、后落地」：校验用的 raise 必须出现在破坏性写入之前，
  // 且整个恢复在单个数据库函数内完成（不带手动 commit/rollback → 保持 Postgres 原子性，任一异常整体回滚）
  const fnMatch = bkpSql.match(/create (?:or replace )?function public\.backup_restore/);
  const fnIdx = fnMatch ? fnMatch.index : -1;
  const fnBody = fnIdx >= 0 ? bkpSql.slice(fnIdx) : "";
  const firstRaise = fnBody.search(/raise\s+exception/i);
  const firstWrite = fnBody.search(/delete\s+from|insert\s+into|truncate/i);
  check("版本恢复：先校验后落地（校验失败抛错发生在破坏性写入之前）",
    fnIdx >= 0 && firstRaise >= 0 && firstWrite > firstRaise);
  check("版本恢复：单函数内完成且无手动提交（原子性 → 任一步失败整体回滚）",
    fnIdx >= 0 && !/\b(commit|rollback)\b(?!.*--)/i.test(fnBody));
  check("版本恢复：恢复前自动备份 + 快照上限清理", /恢复前自动备份/.test(bkpFn) && /最多保留/.test(bkpFn));
}

console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);