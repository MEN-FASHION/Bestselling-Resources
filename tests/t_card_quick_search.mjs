/* 20261113K · 卡片「悬停一键搜同款」
 *
 * 需求：凡是有图片的专区（视觉专区 / 趋势上升榜 / 上新节奏 / Pinterest / SHEIN /
 *      渠道对比 / 品牌动向 / 收藏夹），鼠标放到图上就能一键以图搜图，不用先点开大图。
 *
 * 验收点：
 *   1) 悬停在正常卡片图上 → 浮出「搜同款」，且位置贴在该图上方、在图范围内；
 *   2) 点它 → 打开的是按图片地址搜索的链接，地址被正确编码；
 *   3) 点它不会顺带触发卡片本身（不打开大图）；
 *   4) 小图标 / 徽标不出现；弹层里已放大的那张图不重复出现；
 *   5) 鼠标从图移到同一张卡片上的角标 → 不闪掉；移出卡片 → 收起；
 *   6) 触屏设备（无悬停）不注册悬停入口，避免误触；
 *   7) 滚出屏幕后自动收起，不会飘在别处；
 *   8) 页面内临时地址（blob:）绝不拼进搜索链接。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/find-similar.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= 一、静态约束 ================= */
console.log("一、脚本结构");
ok(/\.fs-quick/.test(SRC), "应有悬停入口的样式类 fs-quick");
ok(/mouseover/.test(SRC) && /mouseout/.test(SRC), "悬停入口应由 mouseover / mouseout 驱动");
ok(/hover: none/.test(SRC), "触屏设备不应注册悬停入口");
ok(!/XMLHttpRequest|fetch\(/.test(SRC), "不得发请求（纯前端拼链接）");
ok(!/\.appendChild\([^)]*\)[\s\S]{0,40}card/.test(SRC), "不应往卡片 DOM 里插按钮（浮层独立）");

/* 有图的专区都得接上：前台 11 页 + 后台图墙 */
const PAGES = ["index.html", "rank.html", "rhythm.html", "compare.html", "pinterest.html", "shein.html",
  "trends.html", "fav.html", "movement.html", "marketing.html", "titlelab.html", "admin.html"];
PAGES.forEach((f) => {
  const h = fs.readFileSync(f, "utf8");
  ok(h.indexOf("find-similar.js") >= 0, f + " 未接入悬停搜同款脚本");
});
ok(/v=20261113K/.test(fs.readFileSync("rank.html", "utf8")), "资源版本戳应已升级（否则浏览器仍用旧缓存）");

/* ================= 二、假 DOM ================= */
function mkEl(tag, cls, rect) {
  const e = {
    tagName: String(tag || "div").toUpperCase(),
    className: cls || "",
    style: {},
    children: [],
    parentNode: null,
    parentElement: null,
    title: "",
    src: "",
    currentSrc: "",
    _cls: new Set(String(cls || "").split(/\s+/).filter(Boolean)),
    _r: rect || { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
  };
  let _cn = String(cls || "");
  Object.defineProperty(e, "className", {
    get: () => _cn,
    set: (v) => { _cn = String(v); e._cls = new Set(_cn.split(/\s+/).filter(Boolean)); },
  });
  e.classList = {
    add: (c) => e._cls.add(c),
    remove: (c) => e._cls.delete(c),
    contains: (c) => e._cls.has(c),
    toggle: (c, on) => { on ? e._cls.add(c) : e._cls.delete(c); },
  };
  Object.defineProperty(e, "offsetWidth", { get: () => (e._cls.has("fs-quick") ? 86 : 0) });
  Object.defineProperty(e, "offsetHeight", { get: () => (e._cls.has("fs-quick") ? 26 : 0) });
  Object.defineProperty(e, "innerHTML", { get() { return e._h || ""; }, set(v) { e._h = String(v); } });
  e.appendChild = (c) => { e.children.push(c); c.parentNode = e; c.parentElement = e; return c; };
  e.removeChild = (c) => { e.children = e.children.filter((x) => x !== c); };
  e.setAttribute = () => {};
  e.getAttribute = () => null;
  e.addEventListener = () => {};
  e.getBoundingClientRect = () => e._r;
  e.contains = (n) => { let p = n; while (p) { if (p === e) return true; p = p.parentElement; } return false; };
  e.closest = (sel) => {
    const parts = String(sel).split(",").map((s) => s.trim()).filter(Boolean);
    const hit = (n) => parts.some((s) => (s.charAt(0) === "." ? n._cls.has(s.slice(1)) : n.tagName === s.toUpperCase()));
    let p = e;
    while (p) { if (hit(p)) return p; p = p.parentElement; }
    return null;
  };
  return e;
}

function boot(opts) {
  opts = opts || {};
  const opened = [];
  const body = mkEl("body");
  const docListeners = {};
  const winListeners = {};
  const imgs = [];
  const created = [];

  const cards = [];
  function makeCard(imgRect, opts) {
    opts = opts || {};
    const card = mkEl("figure", opts.cardCls || "rk-card");
    const imgParent = opts.wrapCls ? mkEl("div", opts.wrapCls) : card;
    if (imgParent !== card) card.appendChild(imgParent);
    const im = mkEl("img", opts.imgCls || "", imgRect);
    im.src = opts.src || "http://img.example.com/x/a b?p=1&q=2.jpg";
    im.currentSrc = im.src;
    imgParent.appendChild(im);
    imgs.push(im);
    const badge = mkEl("span", "rk-badge");
    imgParent.appendChild(badge);
    card._img = im; card._badge = badge;
    cards.push(card);
    return { card, img: im, badge };
  }

  const doc = {
    readyState: "complete",
    get images() { return imgs; },
    body,
    head: mkEl("head"),
    documentElement: mkEl("html"),
    createElement: (t) => { const el = mkEl(t); created.push(el); return el; },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener: () => {},
  };

  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
    document: doc,
    MutationObserver: function () { this.observe = () => {}; },
    innerWidth: 1440, innerHeight: 900,
    getComputedStyle: () => ({ position: "static", display: "block", visibility: "visible", opacity: "1", zIndex: "auto" }),
    open: (u) => { opened.push(u); return {}; },
    matchMedia: opts.touch ? (q) => ({ matches: /hover: none/.test(String(q)) }) : null,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn) => { (winListeners[type] = winListeners[type] || []).push(fn); };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx);

  const fire = (type, ev) => (docListeners[type] || []).forEach((fn) => fn(ev));
  const fireWin = (type) => (winListeners[type] || []).forEach((fn) => fn({}));
  return { FS: sandbox.FindSimilar, body, created, cards, makeCard, fire, fireWin, opened, doc, sandbox };
}

/* ================= 三、悬停 → 点一下 → 搜同款 ================= */
console.log("二、悬停出按钮 → 点一下直接搜");
{
  const S = boot();
  const { img, card, badge } = S.makeCard({ width: 180, height: 240, top: 300, left: 100, right: 280, bottom: 540 });
  card.onclick = () => { card._clicked = true; };
  await sleep(20);

  /* 悬停到图上 */
  S.fire("mouseover", { target: img });
  const pills = S.created.filter((c) => c._cls.has("fs-quick"));
  ok(pills.length === 1, "首次悬停应创建一个「搜同款」浮层（且只有一层）");
  const pill = pills[0];
  ok(pill.classList.contains("on"), "悬停在卡片图上应显示「搜同款」");
  const L = parseFloat(pill.style.left), T = parseFloat(pill.style.top);
  ok(Math.abs(L - (100 + 180 / 2)) <= 6, "横向应落在图片正中（左右居中）");
  ok(Math.abs(T - (300 + 240 / 2)) <= 6, "纵向应落在图片正中（上下居中），而不是贴在上沿");

  /* 点它：应打开 Google 以图搜图，且不触发卡片点击 */
  S.opened.length = 0;
  pill.onclick({ preventDefault() {}, stopPropagation() {} });
  ok(S.opened.length === 1, "点「搜同款」应打开一个搜索页");
  ok((S.opened[0] || "").indexOf("lens.google.com/uploadbyurl") >= 0, "默认应走 Google 以图搜图");
  ok((S.opened[0] || "").indexOf(encodeURIComponent(img.src)) >= 0, "图片地址应被编码后拼入链接（空格/问号/和号不能拼断）");
  ok((S.opened[0] || "").indexOf(" ") < 0, "链接中不应出现未编码的空格");
  ok(!card._clicked, "点「搜同款」不应顺带触发卡片本身（不打开大图）");

  /* 再悬停一次：不能又造一个浮层 */
  S.fire("mouseover", { target: img });
  ok(S.created.filter((c) => c._cls.has("fs-quick")).length === 1, "反复悬停不应重复创建浮层");
  ok(pill.classList.contains("on"), "再次悬停应重新显示");
}

/* ================= 四、哪些图不该出按钮 ================= */
console.log("三、不该出现的图");
{
  const S = boot();
  const small = S.makeCard({ width: 40, height: 40, top: 100, left: 100, right: 140, bottom: 140 });
  S.fire("mouseover", { target: small.img });
  const pills = S.created.filter((c) => c._cls.has("fs-quick"));
  ok(!pills.length || !pills[0].classList.contains("on"), "小图标（40×40）不应出现「搜同款」");

  /* 弹层里已经放大的那张图：由右下角大按钮负责 */
  const big = S.makeCard({ width: 800, height: 1000, top: 40, left: 320, right: 1120, bottom: 1040 }, { cardCls: "", wrapCls: "mv-modal" });
  S.fire("mouseover", { target: big.img });
  const pills2 = S.created.filter((c) => c._cls.has("fs-quick"));
  ok(!pills2.length || !pills2[0].classList.contains("on"), "弹层/灯箱里的大图不应再出悬停入口（避免与大图按钮重复）");

  /* 页头导航里的图（logo 之类）即使够大也不做 */
  const head = mkEl("header", "site-head");
  const logo = mkEl("img", "site-logo", { width: 160, height: 160, top: 0, left: 0, right: 160, bottom: 160 });
  logo.src = "http://img.example.com/logo.png";
  logo.currentSrc = logo.src;
  head.appendChild(logo);
  S.fire("mouseover", { target: logo });
  const pills3 = S.created.filter((c) => c._cls.has("fs-quick"));
  ok(!pills3.length || !pills3[0].classList.contains("on"), "页头 / 导航里的图不应出现「搜同款」");
}

/* ================= 五、闪不闪、收不收 ================= */
console.log("四、显示与收起的时机");
{
  const S = boot();
  const { img, card, badge } = S.makeCard({ width: 200, height: 260, top: 200, left: 50, right: 250, bottom: 460 });
  S.fire("mouseover", { target: img });
  const pill = S.created.filter((c) => c._cls.has("fs-quick"))[0];
  ok(pill.classList.contains("on"), "悬停后应显示");

  /* 移到同一张卡片上的角标：不应闪掉 */
  S.fire("mouseout", { target: img, relatedTarget: badge });
  await sleep(300);
  ok(pill.classList.contains("on"), "只在同一张卡片内移动（图片 → 角标）时不应收起");

  /* 移到浮层本身：也不应收起（否则点不到） */
  S.fire("mouseout", { target: img, relatedTarget: pill });
  await sleep(300);
  ok(pill.classList.contains("on"), "鼠标移到「搜同款」按钮上时不应收起");

  /* 移出卡片：收起 */
  S.fire("mouseover", { target: S.body });
  await sleep(320);
  ok(!pill.classList.contains("on"), "鼠标移出卡片后应收起");
  ok(!card.classList.contains("on"), "不应在卡片上加多余的类（不改页面结构）");

  /* 图片滚出屏幕：收起，不飘在别处 */
  const { img: img2 } = S.makeCard({ width: 200, height: 260, top: 200, left: 50, right: 250, bottom: 460 });
  S.fire("mouseover", { target: img2 });
  ok(pill.classList.contains("on"), "第二张图悬停应显示");
  img2._r = { width: 200, height: 260, top: -600, left: 50, right: 250, bottom: -340 };
  S.fireWin("scroll");
  ok(!pill.classList.contains("on"), "图片滚出屏幕后应收起");
}

/* ================= 六、触屏设备 ================= */
console.log("五、触屏设备");
{
  const S = boot({ touch: true });
  const { img } = S.makeCard({ width: 200, height: 260, top: 200, left: 50, right: 250, bottom: 460 });
  S.fire("mouseover", { target: img });
  const pills = S.created.filter((c) => c._cls.has("fs-quick"));
  ok(!pills.length || !pills[0].classList.contains("on"), "无悬停能力的触屏设备不应弹出悬停入口（避免点一下就误跳搜索）");
}

/* ================= 七、临时地址 ================= */
console.log("六、页面内临时地址");
{
  const S = boot();
  const { img } = S.makeCard({ width: 200, height: 260, top: 200, left: 50, right: 250, bottom: 460 }, { src: "blob:http://x/abc" });
  S.fire("mouseover", { target: img });
  const pill = S.created.filter((c) => c._cls.has("fs-quick"))[0];
  ok(pill && pill.classList.contains("on"), "临时地址的图也应能点（改为下载 + 打开搜索首页）");
  S.opened.length = 0;
  pill.onclick({ preventDefault() {}, stopPropagation() {} });
  ok(S.opened.length === 1 && S.opened[0].indexOf("images.google.com") >= 0,
    "临时地址应打开搜索首页，而不是带着 blob 地址去搜");
  ok(S.opened.every((u) => u.indexOf("blob:") < 0), "临时地址绝不能出现在搜索链接里");
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);

