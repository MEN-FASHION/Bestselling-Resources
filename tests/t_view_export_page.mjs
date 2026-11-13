/* 20261113V · 导出要和页面「长得一样」：多列并排 + 列内多格 + 列头列脚都在
 *
 * 用户给的目标形态（趋势上升榜选 3 个周度）：
 *   3 列并排，每列列头写着「第44周 … 200 张」+「美国·较上一周（W39）新上榜 73 张」，
 *   列内每行 6 张小图（页面 --rk-r 决定），列底写着「已展示 48 / 200」。
 *
 * 这一版要证明两件事：
 *   ① 海报（高清图）不再是「一列一张大图」，而是与页面同构的多列 + 列内多格；
 *   ② 导出的网页不会因为打开时窗口变窄就塌成一列（样式里强制横排）。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/view-export.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

/* ================= 极简假 DOM ================= */
const VOID = { IMG: 1, BR: 1, HR: 1, META: 1, LINK: 1, INPUT: 1 };

function mkEl(tag, attrs, cls) {
  const e = {
    tagName: String(tag || "div").toUpperCase(),
    _attrs: Object.assign({}, attrs || {}),
    _cls: new Set(String(cls || "").split(/\s+/).filter(Boolean)),
    children: [], parentElement: null, parentNode: null,
    style: { _p: {}, setProperty(k, v) { this._p[k] = String(v); }, getPropertyValue(k) { return this._p[k] || ""; } },
    textContent: "", _h: "",
  };
  Object.defineProperty(e, "className", {
    get: () => Array.from(e._cls).join(" "),
    set: (v) => { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  Object.defineProperty(e, "innerHTML", { get: () => e._h, set: (v) => { e._h = String(v); } });
  e.classList = { add: (c) => e._cls.add(c), remove: (c) => e._cls.delete(c), contains: (c) => e._cls.has(c) };
  e.setAttribute = (k, v) => { e._attrs[k] = String(v); };
  e.getAttribute = (k) => (k in e._attrs ? e._attrs[k] : null);
  e.removeAttribute = (k) => { delete e._attrs[k]; };
  e.hasAttribute = (k) => k in e._attrs;
  e.appendChild = (c) => { e.children.push(c); c.parentElement = e; c.parentNode = e; return c; };
  e.remove = () => { if (e.parentElement) e.parentElement.children = e.parentElement.children.filter((x) => x !== e); };
  e.getBoundingClientRect = () => ({ width: 1180, height: 600 });
  e.addEventListener = () => {};
  e.closest = () => null;
  e.cloneNode = (deep) => {
    const c = mkEl(e.tagName, Object.assign({}, e._attrs), Array.from(e._cls).join(" "));
    c.textContent = e.textContent; c._h = e._h;
    if (deep) e.children.forEach((ch) => c.appendChild(ch.cloneNode(true)));
    try { Object.keys(e.style._p).forEach((k) => c.style.setProperty(k, e.style._p[k])); } catch (err) {}
    return c;
  };
  Object.defineProperty(e, "outerHTML", {
    get() {
      const tag = e.tagName.toLowerCase();
      const bag = Object.assign({}, e._attrs);
      const cls = Array.from(e._cls).join(" ");
      if (cls) bag.class = cls;
      const attrs = Object.keys(bag).map((k) => " " + k + '="' + String(bag[k]).replace(/"/g, "&quot;") + '"').join("");
      if (VOID[e.tagName]) return "<" + tag + attrs + ">";
      const inner = e._h || (e.textContent || "") + e.children.map((c) => c.outerHTML).join("");
      return "<" + tag + attrs + ">" + inner + "</" + tag + ">";
    },
  });
  e.querySelector = (s) => qsa(e, s)[0] || null;
  e.querySelectorAll = (s) => qsa(e, s);
  return e;
}

function matchSimple(el, sel) {
  let s = String(sel || "").trim();
  if (!s || !el) return false;
  let tag = null, id = null; const attrs = [], cls = [];
  s = s.replace(/\[([^\]]+)\]/g, (m, g) => { attrs.push(g.trim()); return ""; });
  s = s.replace(/#([\w-]+)/g, (m, g) => { id = g; return ""; });
  s = s.replace(/\.([\w-]+)/g, (m, g) => { cls.push(g); return ""; });
  const t = s.trim(); if (t) tag = t.toUpperCase();
  if (tag && el.tagName !== tag) return false;
  if (id && el._attrs.id !== id) return false;
  for (const c of cls) if (!el._cls.has(c)) return false;
  for (const a of attrs) if (!(a in el._attrs)) return false;
  return true;
}
function descendants(root) {
  const out = []; const walk = (n) => { n.children.forEach((c) => { out.push(c); walk(c); }); };
  walk(root); return out;
}
/* 支持 "a b" 与 "a > b" 两种后代/子代写法（页面代码里两种都用了） */
function qsa(root, selector) {
  const all = descendants(root);
  const parts = String(selector).split(",").map((s) => s.trim()).filter(Boolean);
  const hit = new Set();
  parts.forEach((part) => {
    const toks = part.split(/\s*>\s*|\s+/).filter(Boolean);
    const lastTok = toks[toks.length - 1];
    all.forEach((el) => {
      if (!matchSimple(el, lastTok)) return;
      let n = el;
      for (let k = toks.length - 2; k >= 0; k--) {
        n = n.parentElement;
        if (!n) return;
        if (!matchSimple(n, toks[k])) return;
      }
      hit.add(el);
    });
  });
  return all.filter((el) => hit.has(el));
}

/* ================= 造一份「3 个周度、每列 48 张、每行 6 张」的页面 ================= */
function mkPage(opts) {
  opts = opts || {};
  const perCol = opts.perCol == null ? 48 : opts.perCol;
  const r = opts.r == null ? 6 : opts.r;
  const body = mkEl("body", {}, "front");
  const root = mkEl("div", { id: "rk-body" }, "rk-body");
  body.appendChild(root);
  const pools = mkEl("div", { id: "rk-pools" }, "rk-pools");
  root.appendChild(pools);

  (opts.weeks || ["第43周", "第44周", "第45周"]).forEach((w, wi) => {
    const sec = mkEl("section", {}, "rk-pool");
    const head = mkEl("div", {}, "rk-pool-head");
    const nm = mkEl("div", {}, "rk-pool-name");
    const sp = mkEl("span"); sp.textContent = w;
    const n = mkEl("span", {}, "rk-n"); n.textContent = perCol + " 张";
    nm.appendChild(sp); nm.appendChild(n); head.appendChild(nm);
    const meta = mkEl("div", {}, "rk-pool-meta");
    meta.textContent = "美国 · 较上一周（W" + (39 + wi) + "）新上榜 " + (70 + wi) + " 张";
    head.appendChild(meta);
    sec.appendChild(head);

    const grid = mkEl("div", {}, "rk-pool-grid");
    grid.style.setProperty("--rk-r", String(r));
    for (let i = 1; i <= perCol; i++) {
      const url = "https://img.example.com/" + wi + "-" + i + ".jpg";
      const fig = mkEl("figure", { "data-url": url, "data-period": w, "data-tags": "上升 2 位" }, "rk-card");
      const im = mkEl("img"); im.setAttribute("src", url); im.setAttribute("alt", "卫衣");
      fig.appendChild(im); grid.appendChild(fig);
    }
    sec.appendChild(grid);
    const foot = mkEl("div", {}, "rk-pool-foot"); foot.textContent = "已展示 " + perCol + " / 200";
    sec.appendChild(foot);
    pools.appendChild(sec);
  });

  const doc = {
    readyState: "complete", body, title: "趋势上升榜 · TREND BANK",
    createElement: (t) => mkEl(t),
    querySelector: (s) => qsa(body, s)[0] || null,
    querySelectorAll: (s) => qsa(body, s),
    getElementById: (id) => qsa(body, "#" + id)[0] || null,
  };
  return { doc, body, root };
}

function boot(opts) {
  const page = mkPage(opts);
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, isNaN, encodeURIComponent, decodeURIComponent, parseInt, parseFloat,
    document: page.doc,
    fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve("/*css*/") }),
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
    Blob: function (p) { this.size = 1; },
    Image: function () { return { width: 800, height: 1066, naturalWidth: 800, naturalHeight: 1066 }; },
    SB: { myExportZones: () => Promise.resolve(["*"]), siteSettings: () => Promise.resolve({}) },
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx);
  return { VX: sandbox.VX, page, sandbox };
}

/* ================= 用例 ================= */
console.log("一、采集：列头张数、列副标题、列底统计都要抓到");
{
  const { VX } = boot();
  const secs = VX._collect();
  ok(secs.length === 3, "应采到 3 列（三个周度）");
  ok(secs[0].name === "第43周", "列名应是期次");
  ok(secs[0].nText === "48 张", "列头右上角的「48 张」要抓到");
  ok(/较上一周（W39）新上榜 70 张/.test(secs[0].meta), "列副标题要抓到（页面那句对比说明）");
  ok(secs[0].foot === "已展示 48 / 200", "列底「已展示 48 / 200」要抓到");
  ok(secs[0].cols === 6, "每行张数应取页面算好的 --rk-r=6");
  ok(secs[0].cards.length === 48, "这一列的卡片应全部采到");
  ok(VX._isBoard() === true, "多列页面应被识别为并排看板");
}

console.log("二、整页并排：列宽不塌、每列内部再分格");
{
  const { VX } = boot();
  const secs = VX._collect();
  const sheets = VX._layoutCols(secs);
  ok(sheets.length === 1, "48 张 × 3 列应放得下 1 张海报（不该无故分页）");
  const sh = sheets[0];
  ok(sh.colMode === true, "并排看板必须走列模式");
  ok(sh.cols.length === 3, "海报应是 3 列并排，而不是上下三段");
  ok(sh.cols[0].R === 6, "每列内部每行应摆 6 张（跟着页面 --rk-r）");
  ok(sh.cols[0].cards.length === 48, "这一列 48 张应画全");
  const cardW = sh.cols[0].cw, colW = sh.colW;
  ok(cardW < colW / 4, "列内小格宽度必须远小于整列宽（说明不是一列一张大图）：" + Math.round(cardW) + " vs " + Math.round(colW));
  ok(Math.abs(cardW * 6 + 6 * 5 - colW) < 2, "6 格 + 5 个间距应正好铺满列宽");
  const rows = Math.ceil(48 / 6);
  ok(sh.cols[0].h > sh.cols[0].rowH * rows, "列高应按 8 行卡片算出来（不是按 48 行）");
  ok(sh.cols[0].foot === "已展示 48 / 200", "海报要带上列底统计");
  ok(/新上榜 70 张/.test(sh.cols[0].meta), "海报列头要带页面那句对比说明");
}

console.log("三、内容超长时按列续页，列头标「（续）」");
{
  const { VX } = boot({ perCol: 600 });
  const secs = VX._collect();
  const sheets = VX._layoutCols(secs);
  ok(sheets.length > 1, "600 张 × 3 列放不进一张，应自动分页");
  const last = sheets[sheets.length - 1];
  ok(last.cols.some((c) => c.cont === true), "第二张起的列应标成续列");
  const seen = {};
  sheets.forEach((s) => s.cols.forEach((c, i) => c.cards.forEach((x) => { seen[i + "|" + x.url] = 1; })));
  ok(Object.keys(seen).length === 1800, "分页不能丢图也不能重复（应为 1800 张唯一图）");
}

console.log("四、导出的网页：窗口再窄也不塌成一列");
{
  const { VX } = boot();
  const snap = VX._snapshot();
  const html = VX._buildDom(snap.clone, { title: "趋势上升榜 · 卫衣", sub: "类目：卫衣" },
    { ok: 144, failed: 0, total: 144 }, "/*css*/", 1180);
  ok(/\.rk-pools\{[^}]*flex-wrap:nowrap/.test(html) || /rk-pools\{[^}]*flex-wrap:nowrap/.test(html),
    "样式里必须禁止换行，否则窄窗口会把几列压成一列");
  ok(/flex-direction:row/.test(html), "样式里必须强制横排（样式表窄屏断点会让它竖排）");
  ok(/repeat\(var\(--rk-r,4\)/.test(html), "列内格数应继续沿用页面的 --rk-r");
  ok(/width:1180px/.test(html), "内容宽度要按页面实际宽度固定，避免缩放导致列数变化");
  ok(/已展示 48 \/ 200/.test(html), "列底统计应随页面一起带走");
  ok(/较上一周（W39）新上榜 70 张/.test(html), "列副标题应随页面一起带走");
}

console.log("五、每行张数的兜底取值");
{
  const { VX, page } = boot({ r: 5 });
  ok(VX._collect()[0].cols === 5, "内联 --rk-r=5 时应取 5");
  /* 去掉内联值，只剩样式表档位 */
  const grid = qsa(page.body, ".rk-pool-grid")[0];
  grid.style._p = {};
  ok(VX._collect()[0].cols === 4, "什么都取不到时应退回 4 张，而不是 0（0 会让海报算不出格子）");
}

console.log("");
console.log(`结果：${pass} 通过，${fail} 失败`);
if (fail) process.exit(1);
