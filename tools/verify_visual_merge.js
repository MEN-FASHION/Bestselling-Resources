/* 后台「视觉专区」合并验证：图片管理 + 数据看板 同一面板两个子页签
 * 用法：node tools/verify_visual_merge.js [项目根目录]
 * 做法：用 jsdom 载入真实 admin.html，取出 admin.js 里的真实子页签逻辑执行
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = process.argv[2] || ".";
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};

const html = read("admin.html");
const adminJs = read("js/admin.js");

// 取出真实实现（let visualTab / setVisualTab / bindVisualTabs）
function sliceFn(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) return "";
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === "{") { d++; started = true; }
    else if (c === "}") { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  return "";
}
const tabVar = (adminJs.match(/let visualTab\s*=\s*"[^"]*";/) || [""])[0];
const setFn = sliceFn(adminJs, "setVisualTab");
const bindFn = sliceFn(adminJs, "bindVisualTabs");
const swIdx = adminJs.indexOf("function switchPanel(");
const swFn = swIdx >= 0 ? sliceFn(adminJs, "switchPanel") : "";

console.log("【A】结构：一个「视觉专区」面板装两个子页");
const dom = new JSDOM(html, { runScripts: "outside-only" });
const { window } = dom;
const doc = window.document;
check("面板 id=manage-card 仍在（历史引用不用改）", !!doc.getElementById("manage-card"));
check("「图片管理」子页存在", !!doc.getElementById("vis-manage"));
check("「数据看板」子页存在", !!doc.getElementById("vis-dash"));
check("两个子页都在同一面板内", doc.getElementById("manage-card").contains(doc.getElementById("vis-dash")));
check("数据看板默认隐藏", doc.getElementById("vis-dash").classList.contains("hidden"));
check("图片管理默认显示", !doc.getElementById("vis-manage").classList.contains("hidden"));
const navLabels = [...doc.querySelectorAll("#admin-panel .nav-item")].map(n => n.textContent.trim());
check("侧栏有「视觉专区」", navLabels.includes("视觉专区"));
check("侧栏不再单独有「图片管理」", !navLabels.includes("图片管理"));
check("侧栏不再单独有「数据看板」", !navLabels.includes("数据看板"));
check("看板关键元素仍在（dash-meta / dash-grid 区）", !!doc.getElementById("dash-meta") && !!doc.getElementById("dash-overview"));

console.log("【B】运行时：子页签切换（执行的是 admin.js 的真实代码）");
check("成功取出真实 setVisualTab", !!setFn && !!tabVar);
let dashLoads = 0;
const ctx = {
  document: doc,
  buildDashCatFilter: () => {},
  loadDashboard: () => { dashLoads++; },
  console,
};
window.buildDashCatFilter = ctx.buildDashCatFilter;
window.loadDashboard = ctx.loadDashboard;
window.eval(tabVar + "\n" + setFn + "\n" + bindFn + "\nwindow.__setVisualTab = setVisualTab; window.__bindVisualTabs = bindVisualTabs; window.__getTab = () => visualTab;");
window.__bindVisualTabs();

const tabBtns = [...doc.querySelectorAll("#admin-panel .vis-tab")];
check("两个页签按钮都绑上了点击", tabBtns.length === 2);
check("初始激活的是「图片管理」", tabBtns[0].classList.contains("is-active") && !tabBtns[1].classList.contains("is-active"));
check("初始未触发看板数据加载（进后台不多拉图片）", dashLoads === 0);

tabBtns[1].dispatchEvent(new window.Event("click"));
check("点「数据看板」→ 看板显示", !doc.getElementById("vis-dash").classList.contains("hidden"));
check("点「数据看板」→ 图片管理隐藏", doc.getElementById("vis-manage").classList.contains("hidden"));
check("点「数据看板」→ 按钮高亮切换", tabBtns[1].classList.contains("is-active") && !tabBtns[0].classList.contains("is-active"));
check("点「数据看板」→ 触发一次 loadDashboard", dashLoads === 1);
check("子页签状态记忆为 dash", window.__getTab() === "dash");

tabBtns[0].dispatchEvent(new window.Event("click"));
check("点回「图片管理」→ 恢复图片网格", !doc.getElementById("vis-manage").classList.contains("hidden") && doc.getElementById("vis-dash").classList.contains("hidden"));
check("点回「图片管理」→ 不重复拉看板数据", dashLoads === 1);

tabBtns[1].dispatchEvent(new window.Event("click"));
check("再切回看板 → 再拉一次（保持最新）", dashLoads === 2);

console.log("【C】数据口径与权限边界");
const sup = read("js/supabase.js");
const img = read("js/admin-images.js");
const sql = read("tools/setup.sql");
const patch = read("tools/patch_20261019D.sql");
check("新增全站统计接口 listDashboardImages", /listDashboardImages/.test(sup) && /rpc\("dashboard_images"\)/.test(sup));
check("看板改用全站统计接口", /listDashboardImages/.test(img));
check("看板有兜底（函数没建好时仍能出数）", /listDashboardImages\(\)\.catch\(\(\) => SB\.listImages\(null\)\)/.test(img));
check("看板新增「上传人数」统计", /上传人数/.test(img));
check("SQL 定义了 dashboard_images（security definer）", /function public\.dashboard_images\(\)/.test(sql) && /security definer/.test(sql));
check("SQL 内校验角色，仅管理员可调用", /p\.role in \('admin', 'super_admin'\)/.test(sql));
check("补丁脚本同样定义并可重复执行", /drop function if exists public\.dashboard_images\(\)/.test(patch) && /create or replace function public\.dashboard_images\(\)/.test(patch));
check("补丁脚本带自检查询", /函数已创建_应为true/.test(patch));
check("图片表策略未被放开（管理员仍只能改自己上传的）", /using \(\s*public\.is_super_admin\(\) or uploaded_by = auth\.uid\(\)\s*\)/.test(sql));
check("图片管理仍是受限列表 listImages（不是全站函数）", /SB\.listImages\(/.test(img) && !/manageImages[\s\S]{0,200}listDashboardImages/.test(img));

console.log("【D】switchPanel 进入视觉专区时保留子页签（与真实页同作用域执行）");
check("成功取出真实 switchPanel", !!swFn);
const dom2 = new JSDOM(html, { runScripts: "outside-only" });
const w2 = dom2.window;
const d2 = w2.document;
let dashLoads2 = 0;
w2.buildDashCatFilter = () => {};
w2.loadDashboard = () => { dashLoads2++; };
w2.canAccessPanel = () => true;
w2.sbToast = () => {};
w2.eval(
  tabVar + "\n" + setFn + "\n" + bindFn + "\n" +
  swFn.replace(/^function switchPanel/, "function switchPanel") + "\n" +
  "window.__set = setVisualTab; window.__sw = switchPanel; window.__tab = () => visualTab;"
);
w2.__set("manage");
let err2 = null;
try { w2.__sw("manage-card"); } catch (e) { err2 = String(e); }
check("进入视觉专区落到「图片管理」子页", w2.__tab() === "manage" && !d2.getElementById("vis-manage").classList.contains("hidden"), err2);
check("进入视觉专区不会预拉看板数据", dashLoads2 === 0);
w2.__set("dash");
check("切到看板子页后才拉数据", dashLoads2 === 1);
try { w2.__sw("manage-card"); } catch (e) { err2 = String(e); }
check("离开再回来：记住上次是「数据看板」", w2.__tab() === "dash" && !d2.getElementById("vis-dash").classList.contains("hidden"), err2);
w2.__set("乱写");
check("无效子页名被规范为 manage", w2.__tab() === "manage");
check("switchPanel 不再单独有 dash-card 分支（已合并）", adminJs.indexOf('target === "dash-card"') < 0);
check("PANEL_ZONE 不再有 dash-card 键", adminJs.indexOf('"dash-card"') < 0);

console.log("\n=== 结果：" + pass + " 项通过，" + fail + " 项失败 ===");
process.exit(fail ? 1 : 0);
