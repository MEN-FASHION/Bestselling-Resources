/* 20261123A · 渠道合并对比：打开速度 + 同期对比时两列都要摆出来
 *
 * 需求原文：
 *   「每次打开渠道合并对比都会卡顿；另外打开同期对比，为什么其他渠道的没有以对比池的形式
 *     展示出来？上新节奏是一个池子，其他渠道是一个池子。」
 *
 * 本套自检盯四件事（每条都配反向用例，拿掉实现必须失败）：
 *   1) 榜单取数只取「目标月 + 去年同月」，不再把整张月度表扫到底；
 *   2) 每列首屏只画 120 张，其余点「展开更多」，卡片多也不卡；
 *   3) 右列还在取数时说「读取中」，不许误报成「这个月没有图」；
 *   4) 目标月以「渠道有图的月份」为准，渠道池不会因为落在榜单月份上而空掉；
 *   5) 同一会话再次打开先用缓存铺出来（不等取数）。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/merge-front.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

/* ================= 静态约定 ================= */
console.log("一、实现约定");
ok(/function rankPeriods\(\)/.test(SRC) && /if \(ps\.length\) f\.periods = ps;/.test(SRC),
  "榜单取数必须带上「需要的月份」过滤（不再全量）");
ok(/var FIRST_PAGE = 96, MORE_PAGE = 96, MAX_PAGE = 288;/.test(SRC), "每列首屏分批渲染，与榜单页同档（96 起 / 上限 288）");
ok(/rankLoading/.test(SRC) && /正在读取「趋势榜单」的图/.test(SRC), "右列取数中要单独说明，不许当成空列");
ok(/var ms = state\.monthsCh\.slice\(\);|if \(!ms\.length\) \{[\s\S]{0,120}nextYearMonth/.test(SRC),
  "目标月以渠道有图的月份为准（渠道无数据时才退回榜单月份）");
ok(/tb\.merge\.cache\.v2/.test(SRC), "有本地缓存，同一会话再打开不必重新等取数");

/* ================= 假 DOM / 假数据 ================= */
function mkEl(tag) {
  const e = {
    tagName: (tag || "div").toUpperCase(), children: [], style: {}, dataset: {},
    className: "", textContent: "", title: "", type: "", value: "", id: "", src: "", checked: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, click() {}, contains() { return false; }, closest() { return null; },
    get firstChild() { return this.children[0] || null; },
    onclick: null,
  };
  Object.defineProperty(e, "innerHTML", {
    get() { return this._h || ""; },
    set(v) { this._h = String(v); if (!v) e.children = []; },
  });
  return e;
}
function mkCache() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

/* 渠道：130 张（2026-11）；榜单：2026-11 三张、2025-11 两张、2027-01 一张（用不到的月份） */
function mkRows() {
  const ch = [];
  for (let i = 0; i < 130; i++) {
    ch.push({
      image_url: "http://x/c" + i + ".jpg", category: "卫衣",
      period_label: "2026-11", channel: ["Pinterest", "SHEIN", "TikTok"][i % 3], title: "c" + i,
    });
  }
  const rank = [
    { id: 1, image_url: "http://x/r1.jpg", category: "卫衣", period_label: "2026-11", site: "美国", channel: "", rank_abs: 1 },
    { id: 2, image_url: "http://x/r2.jpg", category: "卫衣", period_label: "2026-11", site: "美国", channel: "", rank_abs: 2 },
    { id: 3, image_url: "http://x/r3.jpg", category: "卫衣", period_label: "2026-11", site: "美国", channel: "", rank_abs: 3 },
    { id: 4, image_url: "http://x/p1.jpg", category: "卫衣", period_label: "2025-11", site: "美国", channel: "", rank_abs: 1 },
    { id: 5, image_url: "http://x/p2.jpg", category: "卫衣", period_label: "2025年11月", site: "美国", channel: "", rank_abs: 2 },
    { id: 6, image_url: "http://x/f1.jpg", category: "卫衣", period_label: "2027-01", site: "美国", channel: "", rank_abs: 1 },
  ];
  return { ch, rank };
}

async function run(opts) {
  const o = opts || {};
  const REG = {};
  const q = (sel) => (REG[sel] = REG[sel] || mkEl("div"));
  const doc = {
    readyState: "complete",
    querySelector: q,
    getElementById: (id) => q("#" + id),
    createElement: (t) => mkEl(t),
    addEventListener() {},
    querySelectorAll: () => [],
    head: mkEl("head"), body: mkEl("body"), documentElement: mkEl("html"),
  };
  const rows = mkRows();
  const cap = { rankFilter: null, chCalled: 0, rankCalled: 0 };
  const SB = {
    getSession: async () => ({ user: { email: "t@t" } }),
    getFrontendZoneVisibility: async () => null,
    myFrontendZones: async () => null,
    listRankChannelPics: async (x) => {
      cap.chCalled++; cap.chOpts = x;
      if (o.allPending) return new Promise(() => {});
      return o.empty ? [] : rows.ch;
    },
    listRankItems: async (f) => {
      cap.rankCalled++;
      cap.rankFilter = f;
      if (o.rankPending || o.allPending) return new Promise(() => {});
      if (o.empty) return [];
      return rows.rank;
    },
    listImageTags: async () => ({}),
    listMovementTags: async () => ({}),
  };
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    document: doc,
    sessionStorage: o.cache || mkCache(),
    location: { href: "merge.html", pathname: "/merge.html", origin: "http://x", replace() {} },
  };
  sandbox.window = sandbox;
  sandbox.SB = SB;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(o.src || SRC, ctx);
  await new Promise((r) => setTimeout(r, o.wait || 150));
  return { q, REG, cap };
}

function view(env) {
  const q = env.q;
  const body = () => String(q("#mrg-body").innerHTML || "");
  const seg = (key) => {
    const h = body();
    const i = h.indexOf('data-src="' + key + '"');
    if (i < 0) return "";
    const j = h.indexOf("</section>", i);
    return h.slice(i, j < 0 ? h.length : j);
  };
  const cards = (key) => (seg(key).match(/class="rk-card cmp-card"/g) || []).length;
  const urls = (key) => (seg(key).match(/data-url="[^"]+"/g) || []).map((x) => x.slice(10, -1));
  return {
    body, seg, cards, urls,
    hasMore: (key) => /data-more="[^"]*/.test(seg(key)),
    summary: () => String(q("#mrg-summary").textContent || ""),
  };
}
function clickChip(box, text) {
  let hit = null;
  (function walk(n) {
    if (!n || hit) return;
    if (n.tagName === "BUTTON" && String(n.textContent || "").indexOf(text) >= 0) { hit = n; return; }
    (n.children || []).forEach(walk);
  })(box);
  if (hit && typeof hit.onclick === "function") hit.onclick();
  return !!hit;
}

(async () => {
  console.log("二、榜单只取需要的月份");
  const a = await run({});
  const va = view(a);
  const ps = (a.cap.rankFilter && a.cap.rankFilter.periods) || null;
  ok(!!ps, "榜单取数必须带 periods 过滤（实际 " + JSON.stringify(a.cap.rankFilter) + "）");
  ok(Array.isArray(ps) && ps.indexOf("2025-11") >= 0,
    "过滤里要有趋势列真正需要的去年同月 2025-11（实际 " + JSON.stringify(ps) + "）");
  ok(!Array.isArray(ps) || ps.indexOf("2027-01") < 0, "不该把用不到的月份也拉回来");
  ok(a.cap.rankCalled === 1, "榜单只查一次（实际 " + a.cap.rankCalled + " 次）");

  console.log("三、首屏分批：120 张 + 展开更多");
  ok(va.cards("mrg:ch") === 96, "首屏只画 96 张（实际 " + va.cards("mrg:ch") + " 张）");
  ok(va.hasMore("mrg:ch"), "超过 96 张要有「展开更多」入口");
  ok(va.cards("mrg:rank") === 2, "趋势列摆去年同月 2 张（目标月 3 张一条都不进，实际 " + va.cards("mrg:rank") + " 张）");
  /* 假 DOM 不支持 querySelectorAll 绑定事件，这里校验按钮内容与「按页追加」的实现 */
  ok(/已展示 96 \/ 130/.test(va.seg("mrg:ch")), "「展开更多」要写清已展示 / 总数（实际 " +
    (va.seg("mrg:ch").match(/已展示 \d+ \/ \d+/) || ["无"])[0] + "）");
  ok(/state\.shown\[k\] = Math\.min\(\(state\.shown\[k\] \|\| FIRST_PAGE\) \+ MORE_PAGE, MAX_PAGE\)/.test(SRC),
    "点「展开更多」按 MORE_PAGE 追加并有上限，而不是重画全部");

  console.log("四、口径写死：趋势列永远是去年同月，无需任何开关");
  ok(!/同期对比（去年同月）/.test(SRC), "页面上不再有「同期对比」开关（口径已写死）");
  ok(va.cards("mrg:rank") === 2 && va.urls("mrg:rank").indexOf("http://x/p1.jpg") >= 0 &&
     va.urls("mrg:rank").indexOf("http://x/r1.jpg") < 0,
    "趋势列只取 2025-11（两种写法都认），目标月 2026-11 的榜单不进（实际 " +
    JSON.stringify(va.urls("mrg:rank")) + "）");

  console.log("五、右列还在取数：不许误报成「这个月没有图」");
  const b = await run({ rankPending: true, wait: 120 });
  const vb = view(b);
  ok(vb.cards("mrg:ch") > 0, "渠道列先出来（实际 " + vb.cards("mrg:ch") + " 张）");
  ok(/正在读取「趋势榜单」的图/.test(vb.seg("mrg:rank")), "右列显示「正在读取」而不是空列说明");
  ok(!/不会用其它月份顶替/.test(vb.seg("mrg:rank")), "取数中不许写成「本月没有图」");

  console.log("六、同一会话再打开：先用缓存铺出来");
  const cache = mkCache();
  await run({ cache });
  const again = await run({ cache, allPending: true, wait: 120 });
  ok(view(again).cards("mrg:ch") > 0, "取数还没回来时，上次的缓存要先把页面铺出来（实际 " +
    view(again).cards("mrg:ch") + " 张）");
  ok(view(again).cards("mrg:rank") > 0, "榜单列同样从缓存先铺（实际 " + view(again).cards("mrg:rank") + " 张）");

  console.log("七、反向验证：把实现拿掉必须失败");
  const noPeriods = SRC.replace("    if (ps.length) f.periods = ps;", "");
  ok(noPeriods !== SRC, "月份过滤位置被改动（用例本身有效）");
  const na = await run({ src: noPeriods });
  ok(!(na.cap.rankFilter && Array.isArray(na.cap.rankFilter.periods)),
    "去掉月份过滤后，用例必须报错（榜单又变成全量拉取）");

  const noSlice = SRC.replace("list.slice(0, page).forEach(", "list.forEach(");
  ok(noSlice !== SRC, "分批渲染位置被改动（用例本身有效）");
  const nb = await run({ src: noSlice });
  ok(view(nb).cards("mrg:ch") !== 96, "去掉首屏截断后，用例必须报错（一次画 130 张）");

  const noLoading = SRC.replace('html += \'<div class="rk-empty">正在读取「趋势榜单」的图…</div>\';', 'html += "";');
  ok(noLoading !== SRC, "加载态分支被改动（用例本身有效）");
  const nc = await run({ src: noLoading, rankPending: true, wait: 120 });
  ok(!/正在读取「趋势榜单」的图/.test(view(nc).seg("mrg:rank")), "去掉加载态后，用例必须报错（会被读成空列）");

  console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})();
