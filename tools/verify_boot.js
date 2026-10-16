/* 轻量仿真：模拟"本地化登录库在无会话时不推送任何登录态事件"时，后台页面的表现。
 * 断言：页面最终应显示登录页、隐藏加载遮罩（修复目标）。
 * 用法：node verify_boot.js <admin.js 路径>
 */
const fs = require("fs");
const vm = require("vm");
const path = process.argv[2];

function mkEl(id) {
  return { id, _cls: new Set(["hidden"]), classList: null, textContent: "" };
}
function el(id) {
  const e = mkEl(id);
  e.classList = {
    add: (c) => e._cls.add(c),
    remove: (c) => e._cls.delete(c),
    toggle: (c, on) => { if (on) e._cls.add(c); else e._cls.delete(c); },
    contains: (c) => e._cls.has(c),
  };
  return e;
}

// 预置：登录区默认 hidden、遮罩默认可见、后台主体 hidden（与 admin.html 一致）
const nodes = {
  "#admin-login": el("admin-login"),
  "#admin-panel": el("admin-panel"),
  "#token-status": el("token-status"),
  "#toast": el("toast"),
};
const splash = el("boot-splash");

const docListeners = {};
const document_ = {
  addEventListener: (ev, fn) => { (docListeners[ev] = docListeners[ev] || []).push(fn); },
  querySelector: (s) => nodes[s] || null,
  // 真实页面里后台面板至少有一个可见的 panel-card；这里回一个占位，避免触发"面板为空"的探针逻辑
  querySelectorAll: (sel) => (sel && sel.indexOf(".panel-card:not(.hidden)") >= 0 ? [{}] : []),
  getElementById: (id) => (id === "boot-splash" ? splash : null),
  createElement: () => el("x"),
  body: { appendChild() {} },
  title: "",
};

// 假登录库：注册订阅但【永远不推送初始登录态】（对齐 vendor/supabase.js 的真实行为）
// 第 3 个参数为 "session" 时：模拟浏览器里仍有有效会话（登录库在恢复会话时推送一次 SIGNED_IN）
const MODE = process.argv[3] || "nologin";
const SESSION = MODE === "session" ? { user: { id: "u1", email: "a@b.com" } } : null;
const subs = [];
const SB = {
  onAuth: (cb) => {
    subs.push(cb);
    if (SESSION) setTimeout(() => cb(SESSION), 20);   // 登录库恢复会话 → 推送 SIGNED_IN
  },
  getSession: async () => SESSION,
  myRole: async () => (SESSION ? "admin" : null),
  myManageZones: async () => null,
  signOut: async () => ({ error: null }),
  signIn: async () => ({ error: null }),
};
Object.keys(nodes).forEach(() => {});

const win = { console, setTimeout, clearTimeout, location: { reload() {} } };
const ctx = {
  window: win, document: document_, console, setTimeout, clearTimeout,
  SB, location: { reload() {}, href: "" }, navigator: { userAgent: "node" },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: () => Promise.reject(new Error("no-net")),
  URLSearchParams,
};
// 其它后台模块（admin-images.js 等）中定义的函数：此处以空实现占位，只验证启动判定链路
["bindManage","bindFavCats","bindCatMgmt","bindAccess","bindTagDefs","bindDashboard","bindAdminNav",
 "bindSmartModal","bindTrend","bindNotice","bindRecruit","bindBestseller","bindPreview","bindExport",
 "bindZoneCatModal","bindPermission","bindImagePool","bindMarketing","bindSuperTabs","bindRankPanel",
 "canAccessPanel","canOperateZone","guardZone","switchPanel","setPreviewTab","setPreviewFrame",
 "openPreview","closePreview","refreshPreview","switchPreviewPage","openPreviewInNewTab","saveCatOrder",
 "sbToast","escHtml","loadCats","loadFavCats","loadCatMgmt","loadTagDefs","loadAccess","loadManage","openSmartModal","toggleSmartFullscreen"].forEach((n) => { ctx[n] = function () {}; });

// 探针：enterPanel 正常进入后台后必然调用 loadCats，用它统计"进入后台"的实际次数
ctx.loadCats = function () { ctx.__enterCount = (ctx.__enterCount || 0) + 1; };

ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path, "utf8"), ctx, { filename: path });

// 触发 DOMContentLoaded；不派发任何登录态事件（模拟"退出后刷新、库里没有会话"）
(docListeners["DOMContentLoaded"] || []).forEach((fn) => fn());

function report() {
  const loginVisible = !nodes["#admin-login"]._cls.has("hidden");
  const splashHidden = splash._cls.has("hidden");
  const panelVisible = !nodes["#admin-panel"]._cls.has("hidden");
  const enterCount = ctx.__enterCount || 0;
  let verdict;
  if (MODE === "session") {
    verdict = (panelVisible && splashHidden && enterCount === 1)
      ? "PASS 已登录：进入后台且未重复进入(enterPanel=1)" : "FAIL 已登录场景异常";
  } else {
    verdict = (loginVisible && splashHidden)
      ? "PASS 未登录：登录界面可进入" : "FAIL 卡住，登录界面进不去";
  }
  console.log(JSON.stringify({ 模式: MODE, admin_js: path, 登录页可见: loginVisible,
    后台可见: panelVisible, 加载遮罩已揭开: splashHidden, enterPanel次数: enterCount, 结论: verdict }, null, 2));
}
setTimeout(report, 3500);
