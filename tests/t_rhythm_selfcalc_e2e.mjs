/* 20261113F · 真跑一遍「上新节奏」页（不是查字符串，是把 rhythm.js 启动流程完整执行）
   ---------------------------------------------------------------
   用户诉求：把「算环比、算位次」做进专区本身 —— 只导当月数据，也要看到
   「上升 N 位 / 下降 N 位」，而不是整页「新上榜」。

   本文件用极简 DOM 桩 + 假数据层把页面真跑一次：
     场景一：库里只有 11 月，10 月那一期是空的（只导了一个月）→ 必须靠自算给出位次；
     场景二：对照组（不给引擎）→ 同一份数据整页退化成「新上榜」，证明用例抓得住该缺陷。
*/
import fs from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log("  ✓ " + n); }
  else { fail++; console.log("  ✗ " + n, extra === undefined ? "" : "→ " + JSON.stringify(extra)); }
};
const R = (p) => fs.readFileSync(p, "utf8");

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

async function runPage(opts) {
  opts = opts || {};
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
  if (!opts.noCalc) load("js/rhythm-calc.js");      /* 对照组故意不加载引擎 */

  const items = (opts.items || []).map((x) => ({ ...x }));
  const sites = ["美国"];
  const periods = ["2026-10", "2026-11"];          /* 10 月这一期库里是空的：只导了 11 月 */
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
    listRankItems: async (f) => items.filter((it) =>
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
  return { html: (body && body.innerHTML) || "", errors, ctx };
}

/* 只导 11 月：三款带环比（可反推），一款完全没有环比 */
const mk = (u, ratio, abs) => ({
  id: u, period_label: "2026-11", period_type: "month", category: "T恤", site: "美国",
  image_url: "https://img.example.com/t/" + u + ".jpg", title: "Vintage Tee " + u,
  ratio: ratio, abs_delta: abs, source: "rhythm", leaf_category: "T恤",
});
const ITEMS = [
  mk("A", 10, 10),       /* 上期 100 → 本期 110 */
  mk("B", 700, 350),     /* 上期 50  → 本期 400（反超 A） */
  mk("C", 300, 30),      /* 上期 10  → 本期 40（仍第三） */
  mk("D", null, null)    /* 没有任何环比 → 无法比较，判新上榜 */
];
const moves = (html) => [...html.matchAll(/class="rk-move">([^<]*)</g)].map((m) => m[1]);
const nOf = (html) => (html.match(/class="rk-card/g) || []).length;

console.log("一、只导了当月数据，也必须算出位次（自算，不靠上期整榜）");
{
  const r = await runPage({ items: ITEMS });
  ok("脚本加载与启动无异常", r.errors.length === 0, r.errors);
  ok("四张图都画出来了", nOf(r.html) === 4, nOf(r.html));
  const mv = moves(r.html);
  ok("出现了「上升 1 位」", mv.indexOf("上升 1 位") >= 0, mv);
  ok("出现了「下降 1 位」", mv.indexOf("下降 1 位") >= 0, mv);
  ok("不是整页「新上榜」：有环比的三款都没有被判新上榜",
    mv.filter((x) => /新上榜/.test(x)).length <= 1, mv);
  ok("唯独没有环比的那一款判「新上榜」", mv.some((x) => /新上榜/.test(x)), mv);
  ok("列头写明是系统自算的位次口径", /位次由系统按销量自算/.test(r.html), r.html.slice(0, 200));
  ok("页面没有报出「无法比对位次」", !/无法比对位次/.test(r.html));
}

console.log("二、对照组：不加载自算引擎 → 同一份数据整页退化成「新上榜」");
{
  const r = await runPage({ items: ITEMS, noCalc: true });
  const mv = moves(r.html);
  ok("对照组确实一张位次都给不出来", mv.filter((x) => /位/.test(x)).length === 0, mv);
  ok("对照组连「新上榜」也判不出来（旧逻辑只给环比方向）", mv.filter((x) => /新上榜/.test(x)).length === 0, mv);
  ok("对照组只剩「环比上升」这类方向词", mv.filter((x) => /环比/.test(x)).length >= 3, mv);
  ok("与本轮修复后的结果明显不同 → 本用例抓得住该缺陷",
    mv.filter((x) => /位$/.test(x)).length === 0 && mv.length > 0, mv);
}

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
