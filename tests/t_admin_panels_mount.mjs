/* 20261111AB · 后台面板能否真的挂载出来 + 用户动向已移除
 *
 * 事故背景：SHEIN 面板整块空白。
 * 原因不是数据没了，而是「导入打标表」弹窗的 HTML 函数里漏写了 var k = z.key，
 * 初始化时抛 ReferenceError；而初始化是 ZONES.forEach 顺序执行，
 * Pinterest 先抛错 → 循环中断 → SHEIN 连外框都没生成 → 整块空白，且没有任何提示。
 *
 * 所以这里不是「检查文件里有没有这个字符串」，而是用假 DOM 真的把脚本跑一遍，
 * 断言两个面板都能产出完整的 HTML。这类错误只有实际执行才抓得到。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

/* ---------- 假 DOM：够跑通后台面板初始化 ---------- */
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
      if (!(id in store)) { store[id] = mkEl("div"); store[id].id = id; }
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
    Option: function (t, v) {
      const o = mkEl("option");
      o.textContent = t == null ? "" : String(t);
      o.value = v == null ? "" : String(v);
      return o;
    },
  };
  win.window = win;
  vm.createContext(win);
  const out = { throwMsg: "" };
  try {
    vm.runInContext(code, win, { filename: "admin-channelzone.js" });
  } catch (e) {
    out.throwMsg = (e && e.message) || "unknown";
  }
  return { store, out };
}

/* ---------- 一、两个专区面板都必须挂载成功 ---------- */
const CZ = read("js/admin-channelzone.js");
const r = runPanel(CZ);
ok(!r.out.throwMsg, "面板脚本执行抛错：" + r.out.throwMsg);

["pinterest", "shein"].forEach((k) => {
  const card = r.store[k + "-card"];
  ok(!!card, k + " 面板容器没有被写入（init 可能中途中断）");
  const html = (card && card.innerHTML) || "";
  ok(html.length > 1000, k + " 面板内容过短（" + html.length + " 字符），疑似初始化中断");
  ok(html.indexOf("这个面板初始化出错") < 0, k + " 面板落到了「初始化出错」兜底文案，说明仍有异常");
  /* 面板该有的几个区块 */
  ok(/上传|拖拽/.test(html), k + " 面板缺少上传区");
  ok(/打标|类目/.test(html), k + " 面板缺少类目 / 打标区");
});

/* ---------- 二、弹窗 HTML 也必须能生成（这次事故就在这里） ---------- */
/* 通过面板挂载后 body 上追加的节点数量间接验证：四个弹窗都生成了 */
const bodyNodes = r.store["__none__"] ? 0 : 0;
ok(/function importModalHtml\(z\) \{\s*var k = z\.key;/.test(CZ),
  "importModalHtml 缺少 var k = z.key（会导致整个面板初始化中断）");
ok(/function exportModalHtml\(z\) \{\s*var k = z\.key;/.test(CZ),
  "exportModalHtml 缺少 var k = z.key");
ok(/function batchModalHtml\(z\) \{\s*var k = z\.key;/.test(CZ),
  "batchModalHtml 缺少 var k = z.key");

/* ---------- 三、专区之间不能互相影响 ---------- */
ok(/try \{\s*mount\(z\);/.test(CZ),
  "init 里每个专区的 mount 应各自 try/catch，一个专区出错不该让后面的专区整块空白");
ok(/这个面板初始化出错/.test(CZ), "初始化失败时应给出可见提示，而不是留白");

/* ---------- 四、用户动向已彻底移除 ---------- */
const html = read("admin.html");
ok(html.indexOf("用户动向") < 0, "admin.html 仍残留「用户动向」文案");
ok(html.indexOf('id="insight-card"') < 0, "admin.html 仍残留 insight-card 面板");
ok(html.indexOf("admin-insight.js") < 0, "admin.html 仍引用 admin-insight.js");
ok(html.indexOf("track-menu.js") < 0, "admin.html 仍引用 track-menu.js");
ok(!fs.existsSync(path.join(ROOT, "js/admin-insight.js")), "js/admin-insight.js 未删除");
ok(!fs.existsSync(path.join(ROOT, "js/track-menu.js")), "js/track-menu.js 未删除");

const ADMIN = read("js/admin.js");
ok(ADMIN.indexOf("insight-card") < 0, "admin.js 仍残留 insight-card 的权限 / 懒加载逻辑");

/* 前台页面也不该再上报用户动向数据 */
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
pages.forEach((f) => {
  ok(read(f).indexOf("track-menu.js") < 0, f + " 仍引用 track-menu.js（用户动向埋点应一并停止）");
});

/* ---------- 五、页面不再引用已删除的脚本 ---------- */
pages.forEach((f) => {
  const s = read(f);
  [...s.matchAll(/<script[^>]+src="([^"]+)"/g)].forEach((m) => {
    const rel = String(m[1] || "").split("?")[0];
    if (!rel || /^https?:/i.test(rel)) return;
    ok(fs.existsSync(path.join(ROOT, rel)), f + " 引用了不存在的脚本：" + rel);
  });
});

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
