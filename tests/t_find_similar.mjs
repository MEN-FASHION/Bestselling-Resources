/* 20261112B · 前台大图「找相似款」（站外以图搜图）
 *
 * 之前这一版回退到 V 基线时把该功能丢掉了，用户反馈"前台没看到以图搜图"。
 * 本次重新实现，并且换成不依赖各页面 id / 类名的方式：
 * 判断「当前是否有覆盖层 + 覆盖层里最大的那张图」，所以每个页面、以后新增的页面都自动生效。
 *
 * 验收点：
 *   1) 覆盖层里出现大图 → 出现按钮；关掉覆盖层 → 按钮消失；
 *   2) 点按钮 → 打开的是「按图片地址搜索」的链接，且地址被正确编码；
 *   3) 页面内临时地址（blob:/data:）绝不拼进搜索链接，改为下载原图 + 打开搜索首页；
 *   4) 列表里的小图不触发（不当成放大图）；
 *   5) 前台各页面都引入了该脚本。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/find-similar.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

/* ================= 一、静态约束 ================= */
console.log("一、脚本结构");
ok(/window\.FindSimilar\s*=/.test(SRC), "应暴露 FindSimilar 便于排查");
ok(/lens\.google\.com\/uploadbyurl/.test(SRC), "默认引擎应为 Google 以图搜图（按地址）");
ok(/encodeURIComponent\(u\)/.test(SRC), "图片地址必须编码后再拼入链接");
ok(/bing\.com|yandex\.com|tineye\.com/.test(SRC), "应支持多个引擎");
ok(/isPublic/.test(SRC), "应有「是否公开链接」的判断");
ok(/下载原图/.test(SRC), "应提供下载原图");
ok(!/XMLHttpRequest|fetch\(/.test(SRC), "不得发请求（纯前端拼链接）");

const pages = ["index.html", "trends.html", "compare.html", "pinterest.html", "shein.html",
  "rank.html", "rhythm.html", "fav.html", "movement.html", "marketing.html"];
pages.forEach((f) => {
  ok(fs.readFileSync(f, "utf8").indexOf("find-similar.js") >= 0, f + " 未引入 find-similar.js");
});

/* ================= 二、真实执行 ================= */
console.log("二、实跑：覆盖层大图 → 按钮 → 搜索链接");

function mkEl(tag) {
  const e = {
    tagName: String(tag || "div").toUpperCase(), children: [], style: {}, dataset: {},
    className: "", textContent: "", title: "", type: "", src: "", currentSrc: "", id: "", value: "",
    _cls: new Set(),
    classList: {
      add: (c) => e._cls.add(c), remove: (c) => e._cls.delete(c),
      contains: (c) => e._cls.has(c), toggle: (c, on) => { on ? e._cls.add(c) : e._cls.delete(c); },
    },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    insertBefore(c) { this.children.push(c); c.parentNode = this; return c; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, click() { if (this.onclick) this.onclick({ stopPropagation() {} }); },
    closest() { return null; }, contains() { return false; },
    getBoundingClientRect() { return this._r || { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; },
    get offsetWidth() { return this._r ? this._r.width : 0; },
    get offsetHeight() { return this._r ? this._r.height : 0; },
  };
  Object.defineProperty(e, "innerHTML", { get() { return this._h || ""; }, set(v) { this._h = String(v); if (!v) this.children = []; } });
  return e;
}

/* 造一个「遮罩 + 大图」的结构 */
const IMG_MARGIN = 40;
const modal = mkEl("div");
modal.className = "mv-modal";
modal._cls.add("mv-modal");
const bigImg = mkEl("img");
bigImg.src = "http://img.example.com/a b/c?x=1&y=2.jpg";
bigImg._r = { width: 900, height: 1200, top: 40, left: 100, right: 1000, bottom: 1240 };
modal.appendChild(bigImg);

/* 列表里的小图（不该触发） */
const small = mkEl("img");
small.src = "http://img.example.com/small.jpg";
small._r = { width: 150, height: 200, top: 10, left: 10, right: 160, bottom: 210 };

const opened = [];
const downloads = [];
const body = mkEl("body");
const doc = {
  readyState: "complete",
  images: [small],
  body,
  head: mkEl("head"),
  documentElement: mkEl("html"),
  createElement: (t) => mkEl(t),
  querySelector: () => null,
  querySelectorAll: (sel) => (sel === "div,section" ? [modal] : []),
  getElementById: () => null,
  addEventListener() {},
};
/* 通过重定义 images 让「大图是否在页面上」可控 */
let bigOn = false;
Object.defineProperty(doc, "images", { get: () => (bigOn ? [small, bigImg] : [small]) });

const sandbox = {
  console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
  RegExp, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  document: doc,
  MutationObserver: function () { this.observe = () => {}; },
  innerWidth: 1440, innerHeight: 900,
  getComputedStyle: (n) => {
    if (n === modal) return { position: "fixed", display: "flex", visibility: "visible", opacity: "1", zIndex: "999" };
    if (n === bigImg.parentElement) return { position: "static", display: "block", zIndex: "auto", opacity: "1", visibility: "visible" };
    return { position: "static", display: "block", zIndex: "auto", opacity: "1", visibility: "visible" };
  },
  open: (u) => { opened.push(u); return {}; },
};
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
const ctx = vm.createContext(sandbox);
vm.runInContext(SRC, ctx);

const FS = sandbox.FindSimilar;
ok(!!FS, "脚本未正常初始化");

/* scan 内部有 200ms 节流（避免属性频繁变化时反复强制布局），测试里按真实节奏推进 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scan = async () => { await sleep(210); FS.scan(); };

(async () => {

/* 覆盖层里没有大图时：不显示 */
await scan();
const wrap = body.children.filter((c) => c.className === "fs-wrap")[0];
ok(!!wrap, "缺少按钮容器");
ok(!wrap.classList.contains("on"), "没有放大图时不应显示按钮");

/* 打开大图 → 按钮出现 */
bigOn = true;
await scan();
ok(wrap.classList.contains("on"), "覆盖层里出现大图后应显示按钮");

/* 只覆盖层外的大图不应触发 */
bigOn = true;
bigImg.parentNode = body;    /* 大图不再处于覆盖层（父级换到静态的 body） */
doc.querySelectorAll = () => [];   /* 也没有全屏遮罩 */
await scan();
ok(!wrap.classList.contains("on"), "既无遮罩、也不在覆盖层里的大图不应触发按钮");

/* 恢复 → 点主按钮 */
bigImg.parentNode = modal;   /* 放回覆盖层 */
doc.querySelectorAll = (sel) => (sel === "div,section" ? [modal] : []);
await scan();
ok(wrap.classList.contains("on"), "恢复后按钮应重新出现");

const mainBtn = wrap.children[0];
mainBtn.click();
ok(opened.length === 1, "点「找相似款」应打开一个搜索页");
const u1 = opened[0] || "";
ok(u1.indexOf("lens.google.com/uploadbyurl") >= 0, "默认应走 Google 以图搜图");
ok(u1.indexOf(encodeURIComponent(bigImg.src)) >= 0, "图片地址应被编码后拼入链接（空格/问号/和号不能把链接拼断）");
ok(u1.indexOf(" ") < 0, "链接中不应出现未编码的空格");

/* 换引擎 */
const moreBtn = wrap.children[1];
moreBtn.onclick({ stopPropagation() {} });
const menu = body.children.filter((c) => c.className === "fs-menu")[0];
ok(menu && menu.classList.contains("on"), "点 ▾ 应展开引擎菜单");
const items = menu.children.filter((c) => c.className === "fs-item");
ok(items.length >= 5, "引擎菜单至少应有 4 个搜索引擎 + 下载原图");

/* 临时地址：绝不拼进搜索链接 */
opened.length = 0;
bigImg.src = "blob:http://x/9a8b";
await scan();
mainBtn.click();
ok(opened.length === 1 && opened[0].indexOf("images.google.com") >= 0,
  "页面内临时地址应打开搜索首页，而不是带着 blob 地址去搜");
ok(opened.every((u) => u.indexOf("blob:") < 0), "临时地址绝不能出现在搜索链接里");

/* 关掉覆盖层 → 按钮消失 */
bigOn = false;
await scan();
ok(!wrap.classList.contains("on"), "关闭大图后按钮应消失");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
})();
