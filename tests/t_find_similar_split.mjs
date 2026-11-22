/* 20261113K · 搜同款「分屏看结果」
 *
 * 需求：
 *   1) 「搜同款」按钮放到图片正中（原来是贴图片上沿）；
 *   2) 点它把浏览器拆成两部分：右半是搜索结果，左半还能继续点下一张图，
 *      再点只换右边内容，结果窗复用同一个。
 *
 * 验收点：
 *   1) 按钮坐标 = 图片中心；
 *   2) 打开结果用的是「具名窗口」，位置在窗口右半边（left + width ≈ 窗口右边缘）；
 *   3) 点第二张图不再开第二个窗，仍是同一个窗名（复用）；
 *   4) 页面主体让位宽度 = 结果窗宽度（body 右内边距），退出后复原；
 *   5) 结果窗被用户关掉 → 让位自动解除，不会留下半屏空白；
 *   6) 弹窗被拦截 → 降级为新标签，并且不进入分屏状态（不留半屏空白）；
 *   7) 关闭分屏偏好后 → 走新标签；
 *   8) 窗口很窄时，结果窗宽度 / 位置仍然合理（不为负、不成一条缝）。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/find-similar.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= 假 DOM ================= */
function mkStyle() {
  const m = {};
  return {
    setProperty: (k, v) => { m[k] = v; },
    getPropertyValue: (k) => m[k] || "",
    removeProperty: (k) => { delete m[k]; },
    _map: m,
  };
}

function mkEl(tag, cls, rect) {
  const e = {
    tagName: String(tag || "div").toUpperCase(),
    style: mkStyle(),
    children: [],
    parentNode: null,
    parentElement: null,
    title: "",
    src: "",
    currentSrc: "",
    _r: rect || { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
    _cls: new Set(String(cls || "").split(/\s+/).filter(Boolean)),
  };
  let _cn = String(cls || "");
  Object.defineProperty(e, "className", {
    get: () => _cn,
    set: (v) => { _cn = String(v); e._cls = new Set(_cn.split(/\s+/).filter(Boolean)); },
  });
  e.classList = {
    add: (c) => { e._cls.add(c); },
    remove: (c) => { e._cls.delete(c); },
    contains: (c) => e._cls.has(c),
    toggle: (c, on) => { on ? e._cls.add(c) : e._cls.delete(c); },
  };
  Object.defineProperty(e, "offsetWidth", { get: () => 110 });
  Object.defineProperty(e, "offsetHeight", { get: () => 34 });
  Object.defineProperty(e, "innerHTML", { get() { return e._h || ""; }, set(v) { e._h = String(v); } });
  e.appendChild = (c) => { e.children.push(c); c.parentNode = e; c.parentElement = e; return c; };
  e.removeChild = (c) => { e.children = e.children.filter((x) => x !== c); };
  e.setAttribute = () => {};
  e.getAttribute = () => null;
  e.addEventListener = () => {};
  e.getBoundingClientRect = () => e._r;
  e.contains = (n) => { let p = n; while (p) { if (p === e) return true; p = p.parentElement; } return null; };
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
  const calls = [];          /* window.open 调用记录 */
  const intervals = [];      /* 假定时器：手动 tick */
  const store = {};
  const imgs = [];
  const created = [];
  const docListeners = {};
  const winListeners = {};

  const html = mkEl("html");
  const body = mkEl("body", "front");

  const mkWin = (u, name, feat) => {
    calls.push({ url: u, name: name, feat: feat || "" });
    if (opts.block) return null;
    const w = { closed: false, close() { this.closed = true; this._closedByUs = true; } };
    sandbox.__wins.push(w);
    return w;
  };

  const doc = {
    readyState: "complete",
    get images() { return imgs; },
    body,
    head: mkEl("head"),
    documentElement: html,
    createElement: (t) => { const el = mkEl(t); created.push(el); return el; },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener: () => {},
  };

  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent,
    document: doc,
    MutationObserver: function () { this.observe = () => {}; },
    innerWidth: opts.innerWidth || 1440,
    innerHeight: 900,
    outerWidth: opts.innerWidth || 1440,
    outerHeight: 900,
    screenX: opts.screenX == null ? 0 : opts.screenX,
    screenY: 0,
    screen: { availWidth: opts.availWidth || (opts.innerWidth || 1440), availHeight: 900 },
    getComputedStyle: () => ({ position: "static", display: "block", visibility: "visible", opacity: "1", zIndex: "auto" }),
    open: mkWin,
    matchMedia: () => null,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: (id) => { if (id && intervals[id - 1]) intervals[id - 1] = null; },
    addEventListener: (type, fn) => { (winListeners[type] = winListeners[type] || []).push(fn); },
    focus: () => {},
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  sandbox.__wins = [];

  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx);

  const fire = (type, ev) => (docListeners[type] || []).forEach((fn) => fn(ev));

  const makeCard = (rect, o) => {
    o = o || {};
    const card = mkEl("figure", "rk-card");
    const im = mkEl("img", o.imgCls || "", rect);
    im.src = o.src || "http://img.example.com/x/a b?p=1&q=2.jpg";
    im.currentSrc = im.src;
    card.appendChild(im);
    imgs.push(im);
    return { card, img: im };
  };

  return { FS: sandbox.FindSimilar, body, html, created, makeCard, fire, calls, intervals, store, sandbox };
}

/* ================= 一、按钮在图片正中 ================= */
console.log("一、按钮位置：图片正中");
{
  const S = boot();
  const { img } = S.makeCard({ width: 180, height: 240, top: 300, left: 100, right: 280, bottom: 540 });
  await sleep(20);
  S.fire("mouseover", { target: img });
  const pill = S.created.filter((c) => c._cls.has("fs-quick"))[0];
  ok(!!pill && pill.classList.contains("on"), "悬停应显示「搜同款」");
  const L = parseFloat(pill.style.left), T = parseFloat(pill.style.top);
  ok(Math.abs(L - 190) <= 6, "横向应在图片正中（左 100 + 宽 180 → 中心 190），实际 " + L);
  ok(Math.abs(T - 420) <= 6, "纵向应在图片正中（上 300 + 高 240 → 中心 420），实际 " + T);
  ok(/translate\(-50%,\s*-50%\)/.test(SRC), "居中必须靠 CSS transform，否则 left/top 只是左上角");
}

/* ================= 二、点一下：右侧开结果窗 ================= */
console.log("二、点一下 → 右侧分屏");
{
  const S = boot({ innerWidth: 1440, screenX: 0 });
  const { img } = S.makeCard({ width: 180, height: 240, top: 300, left: 100, right: 280, bottom: 540 });
  await sleep(20);
  S.fire("mouseover", { target: img });
  const pill = S.created.filter((c) => c._cls.has("fs-quick"))[0];
  S.calls.length = 0;
  pill.onclick({ preventDefault() {}, stopPropagation() {} });

  ok(S.calls.length === 1, "点一次只应开一个窗口");
  const c = S.calls[0] || {};
  ok(c.url && c.url.indexOf("lens.google.com") >= 0, "默认仍走 Google 以图搜图");
  ok(c.name === "tb_find_similar_pane", "必须用具名窗口，否则每次点都会开新窗、无法复用，实际：" + c.name);

  const w = /width=(\d+)/.exec(c.feat), l = /left=(\d+)/.exec(c.feat);
  ok(!!w && !!l, "开启参数里必须带 width / left");
  const W = w ? Number(w[1]) : 0, L = l ? Number(l[1]) : -1;
  ok(Math.abs(W - 720) <= 8, "结果窗宽度应约为窗口一半（1440 → 720），实际 " + W);
  ok(Math.abs((L + W) - 1440) <= 8, "结果窗右边缘应贴住窗口右边缘（左 " + L + " + 宽 " + W + " ≈ 1440）");
  ok(/left=720/.test(c.feat) || Math.abs(L - 720) <= 8, "结果窗应落在右半边（left ≈ 720）");

  ok(S.html.classList.contains("fs-split"), "分屏时应给页面打上 fs-split 标记");
  const cut = S.html.style.getPropertyValue("--fs-cut");
  ok(cut === "720px", "页面让位宽度应等于结果窗宽度（720px），实际 " + cut);
}

/* ================= 三、继续点下一张：复用同一个窗 ================= */
console.log("三、继续点下一张 → 同一个窗换内容");
{
  const S = boot();
  const a = S.makeCard({ width: 180, height: 240, top: 100, left: 60, right: 240, bottom: 340 });
  const b = S.makeCard({ width: 180, height: 240, top: 100, left: 300, right: 480, bottom: 340 }, { src: "http://img.example.com/y/c.png" });
  await sleep(20);
  const pill = () => S.created.filter((c) => c._cls.has("fs-quick"))[0];

  S.fire("mouseover", { target: a.img });
  pill().onclick({ preventDefault() {}, stopPropagation() {} });
  S.fire("mouseover", { target: b.img });
  pill().onclick({ preventDefault() {}, stopPropagation() {} });

  ok(S.calls.length === 2, "点两张图应发起两次打开");
  ok(S.calls[0].name === S.calls[1].name, "两次必须用同一个窗口名才能复用（不新开第二个窗）");
  ok(S.calls[1].url.indexOf(encodeURIComponent("y/c.png")) >= 0, "第二次应换成第二张图的搜索地址");
  ok(S.calls[1].url !== S.calls[0].url, "两张不同图不能是同一个搜索地址");
  ok(S.created.filter((c) => c._cls.has("fs-splitbar")).length === 1, "分屏状态条只应有 1 个（不重复创建）");
  const bar = S.created.filter((c) => c._cls.has("fs-splitbar"))[0];
  ok(bar.classList.contains("on"), "分屏状态条应显示，提示可以点下一张");
}

/* ================= 四、关掉结果窗 → 让位自动解除 ================= */
console.log("四、结果窗被关掉 → 页面复原");
{
  const S = boot();
  const { img } = S.makeCard({ width: 180, height: 240, top: 100, left: 60, right: 240, bottom: 340 });
  await sleep(20);
  S.fire("mouseover", { target: img });
  S.created.filter((c) => c._cls.has("fs-quick"))[0].onclick({ preventDefault() {}, stopPropagation() {} });
  ok(S.html.classList.contains("fs-split"), "先应进入分屏");
  ok(S.FS.paneAlive() === true, "刚打开的结果窗应判定为存活");

  /* 1) 主动退出（不关窗）：让位解除 */
  S.FS.exitSplit(false);
  ok(!S.html.classList.contains("fs-split"), "主动退出分屏后页面让位应解除");

  /* 2) 用户自己把结果窗叉掉：巡检应自动解除让位，不留半屏空白 */
  S.fire("mouseover", { target: img });
  S.created.filter((c) => c._cls.has("fs-quick"))[0].onclick({ preventDefault() {}, stopPropagation() {} });
  ok(S.html.classList.contains("fs-split"), "再次进入分屏");
  const win = S.sandbox.__wins[S.sandbox.__wins.length - 1];
  ok(!!win, "应记录到打开的结果窗");
  win.closed = true;
  const ticks = S.intervals.filter(Boolean);
  ok(ticks.length >= 1, "应挂上「结果窗是否被关掉」的巡检定时器");
  ticks.forEach((fn) => fn());
  ok(!S.html.classList.contains("fs-split"), "结果窗被关掉后，页面让位必须自动解除");
  ok(S.FS.paneAlive() === false, "已关闭的结果窗不应再被当成存活");
}

/* ================= 五、弹窗被拦 → 降级新标签，不留半屏 ================= */
console.log("五、弹窗被拦");
{
  const S = boot({ block: true });
  const { img } = S.makeCard({ width: 180, height: 240, top: 100, left: 60, right: 240, bottom: 340 });
  await sleep(20);
  S.fire("mouseover", { target: img });
  S.calls.length = 0;
  S.created.filter((c) => c._cls.has("fs-quick"))[0].onclick({ preventDefault() {}, stopPropagation() {} });
  ok(S.calls.length === 2, "具名窗口被拦后应再尝试新标签打开（共 2 次 open）");
  ok(S.calls[1].name === "_blank", "降级路径应使用新标签（_blank）");
  ok(!S.html.classList.contains("fs-split"), "没打开分屏窗口就不许让位，否则页面会莫名空出半屏");
}

/* ================= 六、偏好：切到新标签 ================= */
console.log("六、打开方式偏好");
{
  const S = boot();
  ok(S.FS.getSplit() === true, "默认应为分屏（主用法）");
  S.FS.setSplit(false);
  ok(S.FS.getSplit() === false, "能切到新标签");
  ok(S.store["tb.fs.split"] === "0", "偏好应写入本地存储，换页面仍生效");

  const { img } = S.makeCard({ width: 180, height: 240, top: 100, left: 60, right: 240, bottom: 340 });
  await sleep(20);
  S.fire("mouseover", { target: img });
  S.calls.length = 0;
  S.created.filter((c) => c._cls.has("fs-quick"))[0].onclick({ preventDefault() {}, stopPropagation() {} });
  ok(S.calls.length === 1 && S.calls[0].name === "_blank", "关掉分屏后应直接开新标签");
  ok(!S.html.classList.contains("fs-split"), "新标签模式下不应给页面让位");
}

/* ================= 七、窗口很窄 / 位置越界 ================= */
console.log("七、极端窗口");
{
  const S = boot({ innerWidth: 700, availWidth: 700, screenX: 0 });
  const g = S.FS.splitGeom();
  ok(g.width >= 300 && g.width <= 520, "窄窗口下结果窗不应成一条缝、也不应超过可用宽度，实际 " + g.width);
  ok(g.left >= 0, "结果窗左边界不能为负");
  ok(g.left + g.width <= 760, "结果窗不应开到屏幕外");

  const S2 = boot({ innerWidth: 1600, availWidth: 1600, screenX: 400 });
  const g2 = S2.FS.splitGeom();
  ok(g2.left >= 400, "多显示器/窗口偏右时，结果窗应跟着当前窗口，而不是写死屏幕左半边");
}

/* ================= 八、静态约束 ================= */
console.log("八、脚本约束");
{
  ok(!/<iframe/i.test(SRC), "不得用 iframe（搜索引擎禁止被嵌入，必然是空白页）");
  ok(!/XMLHttpRequest|fetch\(/.test(SRC), "不得发请求（纯前端拼链接）");
  ok(/popup=yes/.test(SRC), "结果窗应以独立窗口打开，才能真的并排看");
  ok(/clamp\(/.test(SRC), "页面让位应有上限，避免窄屏把内容挤没");
  ok(!/noopener/.test(/window\.open\([^)]*PANE_NAME[\s\S]{0,40}/.exec(SRC) || ""), "分屏窗口不能带 noopener，否则无法复用");
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
