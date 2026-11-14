/* 20261113I · 位次口径统一为「销售额」
   -------------------------------------------------
   用户场景：一个月表里带「排名」、另一个月只有「销售额」。旧逻辑两把尺子相减，
   会算出「上升 38 位」这类没有意义的数字。用户的决定是：全部统一按销售额。

   本文件断言三件事：
     ① 导入侧：表里同时有「排名」和「销售额」时，一律按销售额排批内名次；
        「排名」只在整批没有销售额列时才用，并标记为回退口径。
     ② 引擎侧：两个月名次口径不同（一边平台排名、一边批内名次）时，
        不给位次、也不把这张图冤枉成「新上榜」。
     ③ 页面侧：真跑「上新节奏」页，口径不一致时列头明确写「不做位次对比」，
        且整页没有「上升 N 位 / 下降 N 位」这类假数字。
*/
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const C0 = createRequire(import.meta.url)(process.cwd() + "/js/rhythm-calc.js");

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log("  ✓ " + n); }
  else { fail++; console.log("  ✗ " + n, extra === undefined ? "" : "→ " + JSON.stringify(extra)); }
};
const R = (p) => fs.readFileSync(p, "utf8");

/* ---------- ① 导入侧：真抽函数跑（与 t_rhythm_rankbasis 同一切片方式） ---------- */
const SRC = R("js/admin-rhythm.js");
function slice(from, to) {
  const a = SRC.indexOf(from), b = SRC.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error("切片失败：" + from);
  return SRC.slice(a, b);
}
const HEAD = slice("  function normHead(h)", "  /* ---------- 标签与名次");
const RANK = slice("  function isPosNum(v)", "  /* ---------- 导入 ----------");
const API = new Function(HEAD + "\n" + RANK + "\n return { mapHeaderRow, pickHeaderRow, applyOfficialRank };")();

function parseAoa(aoa) {
  const head = API.pickHeaderRow(aoa);
  const rows = [];
  for (let i = head.idx + 1; i < aoa.length; i++) {
    const c = aoa[i] || [];
    const url = head.map.url >= 0 ? String(c[head.map.url] || "").trim() : "";
    if (!url) continue;
    const num = (v) => { const s = String(v == null ? "" : v).replace(/[,%]/g, "").trim(); return /^-?\d*\.?\d+$/.test(s) ? parseFloat(s) : null; };
    rows.push({
      leaf_category: "T恤", site: "美国", image_url: url,
      ratio: num(head.map.ratio >= 0 ? c[head.map.ratio] : null),
      abs_delta: num(head.map.abs >= 0 ? c[head.map.abs] : null),
      pos: num(head.map.pos >= 0 ? c[head.map.pos] : null),
      sales: num(head.map.sales >= 0 ? c[head.map.sales] : null),
    });
  }
  return rows;
}

console.log("一、导入侧：销售额与排名同时存在 → 一律按销售额");
{
  const aoa = [["叶子类目名称", "有销量站点", "销售额", "排名", "首图url"]];
  [["a", 900, 7], ["b", 500, 1], ["c", 100, 3]].forEach(([u, s, p]) =>
    aoa.push(["T恤", "美国", String(s), String(p), "https://img.kwcdn.com/" + u + ".jpg"]));
  const rows = parseAoa(aoa);
  const res = API.applyOfficialRank(rows);
  ok("名次依据 = 销售额", res.basis === "sales", res.basis);
  ok("a 销售额最高 → 第 1 名（不是排名列的 7）", rows[0].rank_abs === 1, rows.map(r => r.rank_abs));
  ok("b、c 依次为 2、3 名", rows[1].rank_abs === 2 && rows[2].rank_abs === 3, rows.map(r => r.rank_abs));
  ok("不是回退口径", res.fallback === "", res.fallback);
}

console.log("二、导入侧：没有销售额列 → 退回排名并标记回退");
{
  const aoa = [["叶子类目名称", "有销量站点", "排名", "首图url"]];
  [["a", 7], ["b", 1], ["c", 3]].forEach(([u, p]) =>
    aoa.push(["T恤", "美国", String(p), "https://img.kwcdn.com/" + u + ".jpg"]));
  const rows = parseAoa(aoa);
  const res = API.applyOfficialRank(rows);
  ok("名次依据 = 排名", res.basis === "pos", res.basis);
  ok("按排名列写值（7 / 1 / 3）", rows[0].rank_abs === 7 && rows[1].rank_abs === 1, rows.map(r => r.rank_abs));
  ok("标记 fallback=pos（用于提示跨月不比对）", res.fallback === "pos", res.fallback);
}

/* ---------- ② 引擎侧 ---------- */
const keyOf = (u) => String(u || "").replace(/^https?:\/\/[^/]+/, "");
console.log("三、引擎侧：一个月平台排名、一个月批内名次 → 不相减、不判新上榜");
{
  const C = C0;
  /* 上月：3 条数据，名次 5 / 40 / 80 → 明显是平台整类目排名（跨度远大于条数） */
  const old = [
    { image_url: "x/a.jpg", rank_abs: 5 },
    { image_url: "x/b.jpg", rank_abs: 40 },
    { image_url: "x/c.jpg", rank_abs: 80 },
  ];
  /* 本月：3 条数据，名次 1 / 2 / 3 → 批内名次 */
  const cur = [
    { image_url: "x/a.jpg", rank_abs: 3 },
    { image_url: "x/b.jpg", rank_abs: 2 },
    { image_url: "x/c.jpg", rank_abs: 1 },
  ];
  const cP = C.contextOf(old, keyOf), cN = C.contextOf(cur, keyOf);
  ok("上月口径判为 platform（最大名次 80 > 条数 3）", cP.style === "platform", cP.style);
  ok("本月口径判为 batch（1..3 批内名次）", cN.style === "batch", cN.style);
  const mv = C.moveOf(cur[1], "2026-11", "2026-10", cN, cP, keyOf);
  ok("口径不同 → 不给位次（不是「上升 38 位」）", mv.move === "", mv);
  ok("也不判「新上榜」", mv.isNew === false, mv);
  ok("标记 basisMixed", mv.basisMixed === true, mv);
  const cap = C.capability(cN, cP);
  ok("可比性判定为 mixed", cap.mode === "mixed" && cap.ok === false, cap);
}

console.log("四、引擎侧：两个月都是批内名次 → 正常给位次");
{
  const C = C0;
  /* 批内名次就是 1..N：上月 5 条、名次 1..5；本月 5 条、名次互换 */
  const old = [
    { image_url: "x/a.jpg", rank_abs: 1 }, { image_url: "x/b.jpg", rank_abs: 2 },
    { image_url: "x/c.jpg", rank_abs: 3 }, { image_url: "x/d.jpg", rank_abs: 4 },
    { image_url: "x/e.jpg", rank_abs: 5 },
  ];
  const cur = [
    { image_url: "x/a.jpg", rank_abs: 3 }, { image_url: "x/b.jpg", rank_abs: 2 },
    { image_url: "x/c.jpg", rank_abs: 1 }, { image_url: "x/d.jpg", rank_abs: 4 },
    { image_url: "x/e.jpg", rank_abs: 5 },
  ];
  const cP = C.contextOf(old, keyOf), cN = C.contextOf(cur, keyOf);
  ok("两月口径都是 batch", cP.style === "batch" && cN.style === "batch", [cP.style, cN.style]);
  const a = C.moveOf(cur[0], "2026-11", "2026-10", cN, cP, keyOf);
  ok("1 → 3 = 下降 2 位", a.move === "下降 2 位", a);
  const cap = C.capability(cN, cP);
  ok("可比性判定为 official", cap.mode === "official" && cap.ok === true, cap);
}

/* ---------- ③ 页面侧：真跑「上新节奏」 ---------- */
function el(tag) {
  return {
    tagName: (tag || "div").toUpperCase(), style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    innerHTML: "", textContent: "", value: "", checked: false, disabled: false,
    options: [], selectedIndex: 0,
    offsetHeight: 600, offsetWidth: 1200, clientHeight: 600, clientWidth: 1200,
    scrollHeight: 600, scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 1200, bottom: 600, width: 1200, height: 600 }),
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    removeAttribute() {}, hasAttribute() { return false; },
    focus() {}, blur() {}, click() {}, scrollIntoView() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, cloneNode() { return el(tag); }, contains() { return false; },
    insertAdjacentHTML() {}, replaceWith() {}, matches() { return false; },
    set onchange(v) {}, set onclick(v) {},
  };
}

async function runPage(items) {
  const doc = {
    readyState: "complete",
    location: { href: "http://localhost/rhythm.html", search: "", hash: "", pathname: "/rhythm.html" },
    addEventListener() {}, removeEventListener() {},
    createElement(t) { return el(t); }, createTextNode(t) { return { nodeValue: t }; },
    _memo: {},
    querySelector(sel) { return this._memo[sel] || (this._memo[sel] = el(sel)); },
    querySelectorAll() { return []; },
    getElementById(id) { return this.querySelector("#" + id); },
    body: el("body"), head: el("head"), documentElement: el("html"), cookie: "",
  };
  const store = {};
  const win = {
    document: doc, location: doc.location, navigator: { userAgent: "node", language: "zh-CN" },
    addEventListener() {}, removeEventListener() {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    alert() {}, confirm() { return true; }, prompt() { return ""; },
    URLSearchParams, URL, JSON, Math, Date, Promise, console,
    fetch: async () => ({ ok: true, status: 200, json: async () => [], text: async () => "" }),
    history: { replaceState() {}, pushState() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "", width: "0px", height: "0px" }),
    requestIdleCallback: () => 0,
  };
  win.__RANK_TEST__ = true;
  win.window = win; win.self = win; win.globalThis = win; win.top = win;
  const ctx = vm.createContext(win);
  const errors = [];
  const load = (f) => vm.runInContext(R(f), ctx, { filename: f });

  load("vendor/supabase.js");
  load("js/site-norm.js");
  load("js/config.js");
  load("js/supabase.js");
  load("js/common.js");
  load("js/rhythm-calc.js");

  const list = items.map((x) => ({ ...x }));
  const sites = ["美国"];
  const periods = ["2026-10", "2026-11"];
  const stub = {
    getSession: async () => ({ user: { id: "u1", email: "qa@example.com" } }),
    currentUser: async () => ({ id: "u1" }),
    signOut: async () => {},
    getFrontendZoneVisibility: async () => ({ rhythm: true }),
    myFrontendZones: async () => null,
    rankFacetsBySource: async () => ({ sites: sites.slice(), periods: periods.slice(), categories: ["T恤"] }),
    getPatternPrintVisible: async () => true,
    getRankHidden: async () => ({ sites: [], periods: [] }),
    listRankSites: async () => sites.map((n) => ({ name: n })),
    getRankGroups: async () => [],
    listRankItems: async (f) => list.filter((it) =>
      (!f.periods || !f.periods.length || f.periods.indexOf(it.period_label) >= 0)
      && (!f.category || it.category === f.category)),
    listImageTags: async () => ({}),
    rankImageTags: async () => ({}),
    listRankTagHistory: async () => [],
    listRankTagBatches: async () => [],
    myRole: async () => "viewer",
    isAdmin: async () => false,
    getFavorites: async () => [],
    isFavorite: async () => false,
  };
  const SBREF = vm.runInContext("typeof SB !== 'undefined' ? SB : null", ctx);
  if (SBREF) Object.keys(stub).forEach((k) => { const fn = stub[k]; SBREF[k] = (...a) => fn(...a); });
  try { load("js/rhythm.js"); } catch (e) { errors.push("rhythm.js 加载失败: " + (e && e.message)); }
  await new Promise((r) => setTimeout(r, 600));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 600));
  const body = doc._memo["#rk-body"];
  return { html: (body && body.innerHTML) || "", errors };
}

console.log("五、页面侧：口径不一致时列头说明 + 不出现假位次");
{
  const mk = (u, p, pos) => ({
    id: p + "-" + u, period_label: p, period_type: "month", category: "T恤", site: "美国",
    image_url: "https://img.example.com/t/" + u + ".jpg", title: "Knit " + u,
    ratio: null, abs_delta: null, rank_abs: pos, source: "rhythm", leaf_category: "T恤",
  });
  /* 上月：平台排名（跨度大，最大 200）；本月：批内名次（1..6） */
  const items = [
    mk("A", "2026-10", 5), mk("B", "2026-10", 40), mk("C", "2026-10", 80),
    mk("D", "2026-10", 120), mk("E", "2026-10", 160), mk("F", "2026-10", 200),
    mk("A", "2026-11", 4), mk("B", "2026-11", 2), mk("C", "2026-11", 1),
    mk("D", "2026-11", 3), mk("E", "2026-11", 6), mk("F", "2026-11", 5),
  ];
  const r = await runPage(items);
  ok("脚本加载与启动无异常", r.errors.length === 0, r.errors);
  ok("12 张卡都画出来了", (r.html.match(/class="rk-card/g) || []).length === 12, (r.html.match(/class="rk-card/g) || []).length);
  ok("列头写明「位次口径不同」「不做位次对比」", /口径不同/.test(r.html) && /不做位次对比/.test(r.html),
    (r.html.match(/较上一月[^<]*/) || [""])[0]);
  ok("没有出现「上升 38 位」这类假数字", !/(上升|下降)\s*\d+\s*位/.test(r.html),
    (r.html.match(/(上升|下降)\s*\d+\s*位/g) || []));
}

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
