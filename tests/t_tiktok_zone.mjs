/* 20261114O · TikTok 专区（与 Pinterest / SHEIN 同构）
 * 覆盖：
 *  1) 前台页存在，声明 CZONE = tiktok，结构与另两个专区一致（左侧类目 + 只留月度筛选）
 *  2) 所有前台页面顶部菜单都补上 TikTok 入口（不能只在 tiktok.html 自己能到）
 *  3) 后台面板、侧栏菜单、脚本引用、面板授权绑定齐全
 *  4) 专区定义 / 权限勾选 / 导出权限 / 类目授权 / 专区管理预设都含 tiktok
 *  5) 导出（单页网页 / 高清图）与数据统计都认得这个专区
 *  6) 真的把后台面板脚本跑一遍：tiktok 面板能挂载出来，不是一块空白
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

/* ---------- 1. 前台页面 ---------- */
const h = read("tiktok.html");
ok(h.indexOf('<title>TikTok 专区 · TREND BANK</title>') >= 0, "tiktok.html 标题不对");
ok(h.indexOf('window.CZONE = { key: "tiktok", label: "TikTok 专区", channel: "TikTok" }') >= 0,
  "tiktok.html 未声明专区配置（key/label/channel）");
ok(h.indexOf('class="sidebar"') >= 0 && h.indexOf("服装类目") >= 0, "左侧菜单应与趋势上升榜一致");
ok(h.indexOf('id="cz-cats"') >= 0, "缺少类目菜单容器");
ok(h.indexOf('class="tag-filter"') >= 0 && h.indexOf('id="cz-groups"') >= 0, "缺少筛选栏");
ok(!/国家站点|周次/.test(h), "顶部筛选项只应保留月度");
ok(h.indexOf('href="tiktok.html" class="tab-link active"') >= 0, "自身菜单项未高亮");
ok(h.indexOf("channel-zone-front.js") >= 0, "未引用前台脚本");
ok(h.indexOf("js/view-export.js") >= 0 && h.indexOf('VX.boot("tiktok")') >= 0, "未接入按页导出");
ok(h.indexOf("js/page-shot.js") >= 0 && h.indexOf('PageShot.mount("tiktok")') >= 0, "未接入导出高清图");

/* ---------- 2. 全部前台页面导航 ---------- */
const FRONT = ["rank.html", "marketing.html", "index.html", "trends.html",
  "pinterest.html", "shein.html", "tiktok.html", "compare.html", "fav.html", "rhythm.html", "movement.html"];
FRONT.forEach((f) => {
  const s = read(f);
  ok(s.indexOf('<a href="tiktok.html" class="tab-link') >= 0, f + " 顶部菜单缺少 TikTok 入口");
  /* 高亮项最多一个（trends.html 的高亮由页面内页签脚本处理，静态可以为 0） */
  ok((s.match(/class="tab-link active"/g) || []).length <= 1, f + " 顶部菜单 active 项应唯一");
});

/* ---------- 3. 后台 ---------- */
const admin = read("admin.html");
ok(admin.indexOf('id="tiktok-card"') >= 0, "后台缺少 TikTok 面板容器");
ok(/data-target="tiktok-card"/.test(admin), "后台侧栏缺少 TikTok 入口");
ok(admin.indexOf("admin-channelzone.js") >= 0, "后台未引用渠道专区脚本");

const adm = read("js/admin-channelzone.js");
ok(/key:\s*"tiktok",\s*label:\s*"TikTok 专区",\s*channel:\s*"TikTok"/.test(adm), "后台 ZONES 未登记 tiktok");
ok(/guardZone/.test(adm), "写操作仍应做专区权限守门");

const adminJs = read("js/admin.js");
ok(/"tiktok-card":\s*"tiktok"/.test(adminJs), "PANEL_ZONE 未绑定 tiktok");
ok(/key:\s*"tiktok",\s*label:\s*"TikTok 专区",\s*href:\s*"tiktok\.html"/.test(adminJs), "前台访问设置未含 TikTok");
ok(/"tiktok-card":\s*"tiktok"\s*\}/.test(adminJs), "切换面板时应按 tiktok 触发加载");

/* ---------- 4. 专区定义 / 权限 ---------- */
const cfg = read("js/config.js");
ok(/key:\s*"tiktok",\s*label:\s*"TikTok 专区",\s*href:\s*"tiktok\.html"/.test(cfg), "专区定义缺少 TikTok");

const perm = read("js/admin-perm.js");
const m = perm.match(/ALL_CAT_ZONES\s*=\s*\[([^\]]*)\]/);
const zones = m ? m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")) : [];
ok(zones.includes("tiktok"), "类目授权应覆盖 tiktok");
ok((perm.match(/key:\s*"tiktok",\s*label:\s*"TikTok 专区"/g) || []).length >= 2, "权限勾选应含 TikTok（可见 + 导出）");
ok(/TikTok 专区 \(tiktok\.html\)/.test(perm), "专区管理里应能选到 tiktok.html");

/* ---------- 5. 导出与统计 ---------- */
ok(/tiktok:\s*"TikTok 专区"/.test(read("js/view-export.js")), "单页网页/海报导出未登记 tiktok");
ok(/tiktok:\s*\{\s*label:\s*"TikTok 专区",\s*bar:\s*"#cz-bar"/.test(read("js/page-shot.js")), "导出高清图未登记 tiktok 挂点");
const dash = read("js/upload-dash.js");
ok(/tiktok:\s*\{[^}]*channels:\s*\["TIKTOK"\]/.test(dash), "数据统计未登记 tiktok 渠道");
ok(/ORDER\s*=\s*\[[^\]]*"tiktok"/.test(dash), "数据统计页签顺序缺少 tiktok");

/* ---------- 6. 真跑一遍后台面板（假 DOM） ---------- */
function mkEl(tag) {
  const e = {
    tagName: (tag || "div").toUpperCase(), children: [], style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    _html: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    textContent: "", value: "", className: "", type: "", title: "", id: "", src: "", checked: false,
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, insertBefore() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl("div"); }, querySelectorAll() { return []; },
    get firstChild() { return this.children[0] || null; },
    onclick: null, onchange: null, onerror: null, oninput: null,
    focus() {}, click() {}, add() {}, cloneNode() { return mkEl(tag); },
    closest() { return null; }, contains() { return false; }, matches() { return false; },
  };
  e.parentNode = null;
  return e;
}
function runPanel(code) {
  const body = mkEl("body");
  const store = {};
  const document = {
    readyState: "complete", body,
    getElementById(id) {
      if (!(id in store)) { const e = mkEl("div"); e.id = id; store[id] = e; }
      return store[id];
    },
    querySelector() { return mkEl("div"); }, querySelectorAll() { return []; },
    createElement(t) { return mkEl(t); }, createTextNode(t) { return { nodeValue: t }; },
    addEventListener() {}, removeEventListener() {},
  };
  const win = {
    document, console, setTimeout, clearTimeout, JSON, Math, Date,
    APP_ENUM: {}, APP_ENUM_GROUPS: {},
    CONFIG: { WORKER_URL: "https://example.invalid", CATEGORY_OPTIONS: ["T恤"] },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    addEventListener() {}, location: { href: "http://x/admin.html" },
    Option: function (t, v) { const o = mkEl("option"); o.textContent = t == null ? "" : String(t); o.value = v == null ? "" : String(v); return o; },
  };
  win.window = win;
  vm.createContext(win);
  let err = "";
  try { vm.runInContext(code, win, { filename: "admin-channelzone.js" }); }
  catch (e) { err = (e && e.message) || "unknown"; }
  return { store, err };
}
const r = runPanel(adm);
ok(!r.err, "面板脚本执行抛错：" + r.err);
const card = r.store["tiktok-card"];
const cardHtml = (card && card.innerHTML) || "";
ok(!!card && cardHtml.length > 1000, "TikTok 面板没有挂载出来（" + cardHtml.length + " 字符）");
ok(cardHtml.indexOf("这个面板初始化出错") < 0, "TikTok 面板落到了「初始化出错」兜底文案");
ok(/上传|拖拽/.test(cardHtml), "TikTok 面板缺少上传区");
ok(/cz-tiktok-/.test(cardHtml), "TikTok 面板的 DOM id 前缀应是 cz-tiktok-（与其它专区互不干扰）");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
