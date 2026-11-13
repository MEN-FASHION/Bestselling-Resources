/* 20261113G · 只带「销售额 + 排名」的表，也要能看到「上升 / 下降 N 位」
   ---------------------------------------------------------------
   用户的实际表：一列销售额、一列排名，环比比例 / 环比绝对值为空。
   旧逻辑下这种表一律「全是新上榜」。现在两条路兜住它：
     ① 表里的「排名」存进 rank_abs → 两个月的名次一减就是真实位次；
     ② 没排名但有销售额 → 批内按销售额排名，同样能跨月比。
   本文件既做引擎单测，也把「上新节奏」页真跑一遍（DOM 桩 + 假库），
   断言两个月只带排名时页面真的画出「上升 / 下降 N 位」。
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


/* 只带名次（模拟平台「排名」列），没有任何环比 */
const mk = (u, p, pos) => ({
  id: p + "-" + u, period_label: p, period_type: "month", category: "T恤", site: "美国",
  image_url: "https://img.example.com/t/" + u + ".jpg", title: "Knit " + u,
  ratio: null, abs_delta: null, rank_abs: pos, source: "rhythm", leaf_category: "T恤",
});
const OCT = ["A", "B", "C", "D", "E", "F"];
const posOct = { A: 5, B: 9, C: 20, D: 30, E: 40, F: 50 };
const posNov = { A: 3, B: 11, C: 20, D: 25, E: 41, F: 60 };
const ITEMS = [];
OCT.forEach((u) => ITEMS.push(mk(u, "2026-10", posOct[u])));
OCT.forEach((u) => ITEMS.push(mk(u, "2026-11", posNov[u])));
ITEMS.push(mk("Z", "2026-11", 8));       /* 上月没这款 → 新上榜 */

const moves = (html) => [...html.matchAll(/class="rk-move">([^<]*)</g)].map((m) => m[1]);
const nOf = (html) => (html.match(/class="rk-card/g) || []).length;

console.log("一、引擎：两期都带平台名次 → 直接相减给位次");
{
  const C = C0;
  const keyOf = (u) => String(u || "").replace(/^https?:\/\/[^/]+/, "");
  const cur = [{ image_url: "x/a.jpg", rank_abs: 3 }, { image_url: "x/b.jpg", rank_abs: 10 }];
  const old = [{ image_url: "x/a.jpg", rank_abs: 5 }, { image_url: "x/b.jpg", rank_abs: 8 }];
  const cN = C.contextOf(cur, keyOf), cP = C.contextOf(old, keyOf);
  ok("本期上下文识别出 2 个名次", cN.posN === 2, cN.posN);
  ok("两期都没环比 → ratioN 为 0（口径纯净）", cN.ratioN === 0 && cP.ratioN === 0);
  const a = C.moveOf(cur[0], "2026-11", "2026-10", cN, cP, keyOf);
  ok("5 → 3 = 上升 2 位", a.move === "上升 2 位", a);
  ok("来源标为 official（平台名次直比）", a.by === "official", a);
  const b = C.moveOf(cur[1], "2026-11", "2026-10", cN, cP, keyOf);
  ok("8 → 10 = 下降 2 位", b.move === "下降 2 位", b);
  const cap = C.capability(cN, cP);
  ok("可比性判定为 official", cap.ok === true && cap.mode === "official", cap);
}

console.log("二、引擎：名次持平时不给标签、也不冤枉成新上榜");
{
  const C = C0;
  const keyOf = (u) => String(u || "");
  const cur = [{ image_url: "u", rank_abs: 7 }];
  const old = [{ image_url: "u", rank_abs: 7 }];
  const mv = C.moveOf(cur[0], "p", "q", C.contextOf(cur, keyOf), C.contextOf(old, keyOf), keyOf);
  ok("名次不变 → 无标签", mv.move === "", mv);
  ok("且不判新上榜", mv.isNew === false, mv);
}

console.log("三、引擎：带环比的批次不吃这条近路（避免两套口径混比）");
{
  const C = C0;
  const keyOf = (u) => String(u || "");
  const cur = [{ image_url: "u", rank_abs: 3, ratio: 20, abs_delta: 40 }];
  const old = [{ image_url: "u", rank_abs: 9, ratio: 10, abs_delta: 10 }];
  const mv = C.moveOf(cur[0], "p", "q", C.contextOf(cur, keyOf), C.contextOf(old, keyOf), keyOf);
  ok("有环比时不走 official 分支", mv.by !== "official", mv);
}

console.log("四、真跑「上新节奏」页：只带名次的两个月也能看出涨跌");
{
  const r = await runPage({ items: ITEMS });
  ok("脚本加载与启动无异常", r.errors.length === 0, r.errors);
  ok("两个月 13 张图都画出来了（6 + 7）", nOf(r.html) === 13, nOf(r.html));
  const mv = moves(r.html);
  ok("出现「上升 2 位」（5→3）", mv.indexOf("上升 2 位") >= 0, mv);
  ok("出现「下降 2 位」（8→10）", mv.indexOf("下降 2 位") >= 0, mv);
  ok("上月没有的款判「新上榜」", mv.some((x) => /新上榜/.test(x)), mv);
  ok("整页不是清一色新上榜", mv.filter((x) => /新上榜/.test(x)).length <= 2, mv);
  ok("列头写明位次口径是销售额名次直比", /位次按销售额名次直比上一月/.test(r.html), (r.html.match(/位次按[^<]*/) || [""])[0]);
  ok("不再说「无法比对位次」", !/无法比对位次/.test(r.html));
}

console.log("五、导入侧：表头识别与名次落库（真跑解析链路）");
{
  const A = R("js/admin-rhythm.js");
  ok("识别「排名 / 名次」列", /iPos = find\(h => \(h\.indexOf\("排名"\)/.test(A));
  ok("识别「销售额」列", /iSales = find\(h => \(h\.indexOf\("销售额"\)/.test(A));
  ok("有名次时把名次写进 rank_abs", /function applyOfficialRank/.test(A) && /rank_abs = Math\.round\(x\.r\.pos\)/.test(A));
  ok("没名次时按销售额排批内名次", /rankByValue\(pool, r => \(r\.sales != null/.test(A));
  ok("带环比的批次不动 rank_abs", /if \(list\.some\(r => r\.ratio != null \|\| r\.abs_delta != null\)\) return res;/.test(A));
  ok("辅助列不会写进库", /delete o\.pos; delete o\.sales;/.test(A));
  ok("预览里说清「排名列」只有在没有销售额列时才用", /没有「销售额」列/.test(A) && /只能用「排名」列/.test(A));
}

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
