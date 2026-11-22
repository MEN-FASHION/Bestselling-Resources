/* 20261121C · 渠道对比：榜单列（趋势上升榜）从对比栏消失
 *
 * 用户看到的现象：
 *   「渠道对比那个趋势上升榜怎么不在对比栏里了，可选的只有 P / T / S 三个专区对比了」
 *
 * 两个独立成因，都必须拦住：
 *   ① 榜单列只认「上新节奏(rhythm)」一个专区 —— 账号被授权了「趋势上升榜(rank)」、
 *      没被授权（或后台关掉了）上新节奏时，整列被摘掉，筛选里就只剩 S / P / T。
 *   ② 榜单列在这个月没有图时，连筛选里的按钮都不画 —— 于是看起来像「被删了 / 丢了」，
 *      用户无从判断是没图、还是被开关挡了。
 *
 * 验收点：
 *   1) 只关上新节奏 → 榜单列照常出列（rank 还开着）；
 *   2) 白名单只有 rank（没有 rhythm）→ 榜单列照常出列（反向验证修复点）；
 *   3) 两个榜单专区都关 / 都没授权 → 榜单列才不摆；
 *   4) 本月没有榜单图 → 筛选里仍有这一项，标「本月无图」，摘要写明「本月无榜单图」；
 *   5) 点这个「本月无图」项 → 不新增空列，而是给出提示（不允许静默失败）；
 *   6) 有图的月份 → 照旧出列并带张数（对照组，防止「永远显示/永远不显示」都算通过）。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/compare-front.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

/* ================= 一、代码层面的硬约束 ================= */
console.log("一、实现约定");
ok(/var RANK_ZONES\s*=\s*\["rank",\s*"rhythm"\]/.test(SRC), "榜单列应同时认趋势上升榜与上新节奏两个专区");
ok(/if \(s && s\.type === "rank"\)[\s\S]{0,200}RANK_ZONES/.test(SRC), "srcZoneOpen 应对榜单列走「任一开放即摆」");
ok(/if \(s\.type === "rank"\) return true;/.test(SRC), "渠道筛选里榜单列应无条件列出（有图与否都列）");
ok(/本月无图/.test(SRC), "本月没有图时应在筛选里写「本月无图」而不是消失");
ok(/本月无榜单图/.test(SRC), "摘要应说明本月没有榜单图");
ok(!/state\.sources\.filter\(function \(s\) \{ return !state\.month \|\| colHasData\(s\); \}\)\.forEach/.test(SRC),
  "不允许退回「本月没图就整项不画」的旧写法");

/* ================= 二、真实执行 ================= */
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
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl("div"); }, querySelectorAll() { return []; },
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

/* 渠道行都在 2026-11；榜单行可指定月份（用来造「本月没有榜单图」） */
function mkRows(rankMonth) {
  return {
    ch: [
      { image_url: "http://x/p1.jpg", category: "T恤", period_label: "2026-11", channel: "Pinterest", title: "p1" },
      { image_url: "http://x/t1.jpg", category: "T恤", period_label: "2026-11", channel: "TikTok", title: "t1" },
      { image_url: "http://x/s1.jpg", category: "T恤", period_label: "2026-11", channel: "SHEIN", title: "s1" },
    ],
    rank: [{ id: 1, image_url: "http://x/r1.jpg", category: "T恤", period_label: rankMonth, site: "美国", channel: "", title: "r1" }],
  };
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
  const store = {};
  const rows = mkRows(o.rankMonth || "2026-11");
  const SB = {
    getSession: async () => ({ user: { email: "t@t" } }),
    getFrontendZoneVisibility: async () => (o.vis === undefined ? null : o.vis),
    myFrontendZones: async () => (o.mine === undefined ? null : o.mine),
    listRankChannelPics: async () => rows.ch,
    getCompareSources: async () => o.cfg || null,
    getCompareChannels: async () => (Array.isArray(o.channels) ? o.channels : null),
    listRankItems: async () => rows.rank,
    listImageTags: async () => ({}),
    listMovementTags: async () => ({}),
  };
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    document: doc,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    location: { href: "compare.html", pathname: "/compare.html", origin: "http://x", replace() {} },
  };
  sandbox.window = sandbox;
  sandbox.SB = SB;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx);
  await new Promise((r) => setTimeout(r, 80));

  /* 页面上的对比列（srcGroup 画的是筛选项，renderPools 画的是列） */
  const hasCol = (key) => q("#cmp-body").innerHTML.indexOf('data-src="' + key + '"') >= 0;
  const summary = () => String(q("#cmp-summary").textContent || "");
  /* 筛选里的「渠道」组：groups → [月度组, 渠道组] */
  const groups = () => (q("#cmp-groups").children || []);
  const srcChips = () => {
    const g = groups()[groups().length - 1];
    if (!g || !g.children) return [];
    return (g.children[1] && g.children[1].children) || [];
  };
  const chipOf = (label) => srcChips().filter((c) => String(c.textContent || "").indexOf(label) === 0)[0] || null;
  const toastText = () => String((q("#toast") || {}).textContent || "");
  const bodyText = () => String(q("#cmp-body").innerHTML || "");
  return { hasCol, summary, srcChips, chipOf, toastText, bodyText, q };
}

(async () => {
  /* ---------- 对照组：本月有榜单图 ---------- */
  console.log("二、对照：本月有榜单图");
  const withData = await run({});
  ok(withData.hasCol("rank:month"), "对照：本月有榜单图时，榜单列应出列");
  const chipA = withData.chipOf("上新节奏");
  ok(!!chipA, "对照：筛选里应有榜单列这一项");
  ok(!!chipA && /1$/.test(String(chipA.textContent).trim()), "对照：应带本月张数（实际「" + (chipA && chipA.textContent) + "」）");
  ok(!!chipA && String(chipA.className).indexOf("is-empty") < 0, "对照：有图时不该带「本月无图」样式");

  /* ---------- 只关上新节奏：榜单列不能消失（rank 还开着） ---------- */
  console.log("三、关掉上新节奏专区");
  const offRhythm = await run({ vis: { rhythm: false } });
  ok(offRhythm.hasCol("rank:month"), "只关上新节奏时，榜单列应照常出列（这正是「趋势上升榜不见了」的修复点）");

  /* ---------- 白名单只有趋势上升榜 ---------- */
  console.log("四、账号只被授权趋势上升榜");
  const onlyRank = await run({ mine: ["compare", "rank", "pinterest"] });
  ok(onlyRank.hasCol("rank:month"), "白名单含 rank、不含 rhythm 时，榜单列应出列");
  ok(onlyRank.hasCol("ch:pinterest"), "白名单含 P 专区，Pinterest 应出列");
  ok(!onlyRank.hasCol("ch:shein"), "白名单不含 S 专区，SHEIN 不应出列");

  /* ---------- 两个榜单专区都关 / 都没授权 ---------- */
  console.log("五、两个榜单专区都关掉");
  const bothOff = await run({ vis: { rank: false, rhythm: false } });
  ok(!bothOff.hasCol("rank:month"), "两个榜单专区都关掉后，榜单列不应再出列");

  console.log("五之二、白名单两个榜单专区都没有");
  const noneAuth = await run({ mine: ["compare", "pinterest"] });
  ok(!noneAuth.hasCol("rank:month"), "既无 rank 也无 rhythm 授权时，榜单列不应出列");

  /* ---------- 本月没有榜单图：筛选里仍在，但标「本月无图」 ---------- */
  console.log("六、本月没有榜单图");
  const noData = await run({ rankMonth: "2026-10" });
  ok(noData.hasCol("rank:month"), "20261121D：本月没有榜单图时，这一列仍要摆出来（不许整列消失、池子跟着没）");
  const chipB = noData.chipOf("上新节奏");
  ok(!!chipB, "本月没有榜单图时，筛选里这一项仍然要在（不许静默消失）");
  ok(!!chipB && /本月无图/.test(String(chipB.textContent)), "应写明「本月无图」（实际「" + (chipB && chipB.textContent) + "」）");
  ok(!!chipB && String(chipB.className).indexOf("is-empty") >= 0, "应带上「无图」样式，与可用项区分");
  ok(/本月无榜单图/.test(noData.summary()), "摘要应说明本月没有榜单图（实际「" + noData.summary() + "」）");
  ok(/不会用其它月份顶替/.test(noData.bodyText()), "空列里要写明「不会用其它月份顶替」（实际「" + noData.bodyText() + "」）");

  /* 点它：只解释原因，不静默切换、也不清空这一列 */
  if (chipB && typeof chipB.onclick === "function") {
    chipB.onclick();
    ok(noData.hasCol("rank:month"), "点击「本月无图」的榜单项，这一列仍要在");
    ok(/没有图/.test(noData.toastText()), "点击后应提示「这个月没有图」，不能毫无反应（实际「" + noData.toastText() + "」）");
  } else {
    ok(false, "筛选项缺少点击处理");
  }

  /* ---------- 渠道项仍按原口径：本月没图就不列 ---------- */
  console.log("七、渠道项口径不变");
  const chOnly = await run({ rankMonth: "2026-10" });
  const names = chOnly.srcChips().map((c) => String(c.textContent || ""));
  ok(names.some((t) => t.indexOf("P ") === 0 || t === "P"), "有图的渠道照旧列出");
  ok(!names.some((t) => t.indexOf("Amazon") === 0), "库里没有图的渠道不应凭空出现在筛选里");

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})();
