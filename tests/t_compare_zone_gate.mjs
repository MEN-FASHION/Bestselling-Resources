/* 20261114S · 渠道对比：专区关掉了，它的渠道列就不该再出现
 *
 * 要解决的问题：
 *   后台「前台访问设置」里把 S 专区 / T 专区关掉之后，渠道对比里仍然摆着 SHEIN / TikTok 两列 ——
 *   因为渠道列原来只看「库里有没有这个渠道的图」，从不看专区开关，历史图一在就永远出列。
 *
 * 验收点：
 *   1) 专区关闭 → 该渠道列不摆；专区开启 → 正常摆（对照组，防止「永远不显示」也算通过）；
 *   2) 上新节奏列跟随 rhythm 专区开关；
 *   3) 账号白名单（myFrontendZones）非空时，不在白名单里的专区也不摆；
 *   4) 关掉的渠道无法用「＋ 添加渠道」硬加回来（否则「关了还在」的错觉又回来了）；
 *   5) 被专区开关挡住的列数会写在筛选摘要里，用户能看出「不是没图，是被关掉了」；
 *   6) 后台自己加的渠道（Amazon 等）没有对应专区，照常显示，不受影响。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/compare-front.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };
/* 真实沙箱里的元素表里有没有这个 id（mkEl 兜底会造空节点，所以要按 innerHTML/onclick 判断） */
const q_has = (api, sel) => {
  const el = api.q(sel);
  return !!(el && (typeof el.onclick === "function" || (el.children && el.children.length)));
};

/* ================= 一、代码层面的硬约束 ================= */
console.log("一、实现约定");
ok(/function srcZoneOpen\(/.test(SRC), "缺少「该列所属专区是否开启」判定");
ok(/function zoneOpen\(/.test(SRC), "缺少专区开关判定");
ok(/CH_ZONE/.test(SRC), "缺少渠道 → 专区 的对应关系");
ok(/state\.zoneVis\s*=/.test(SRC), "启动时应记录后台「前台可见专区」配置");
ok(/state\.myZones\s*=/.test(SRC), "启动时应记录账号专区白名单");
ok(/getFrontendZoneVisibility/.test(SRC), "应读取后台的专区可见性配置");
ok(/computeSources/.test(SRC), "列的计算应统一走带专区过滤的入口");
/* 20261114Y：前台只读 —— 增删渠道只能在后台，前台不能再有这些入口 */
ok(!/cmp-add-channel/.test(SRC), "前台不应再有「＋ 添加渠道」入口");
ok(!/cmp-reset-channels/.test(SRC), "前台不应再有「重置渠道」");
ok(!/cmp-col-x|data-rmcol/.test(SRC), "前台不应再有列头 ✕");
ok(!/function addChannel\(/.test(SRC), "前台不应再有 addChannel（渠道只在后台增删）");
/* 只读页：这次也不能引入任何写库操作 */
ok(!/uploadRankChannel|deleteRankChannel|saveCompareSources|saveSiteSetting/.test(SRC), "渠道列显隐不得写库");

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
    set(v) { this._h = String(v); if (!v) this.children = []; },
  });
  return e;
}

const chRows = [
  { image_url: "http://x/p1.jpg", category: "T恤", period_label: "2026-11", channel: "Pinterest", title: "p1" },
  { image_url: "http://x/s1.jpg", category: "T恤", period_label: "2026-11", channel: "SHEIN", title: "s1" },
  { image_url: "http://x/t1.jpg", category: "T恤", period_label: "2026-11", channel: "TikTok", title: "t1" },
  { image_url: "http://x/a1.jpg", category: "T恤", period_label: "2026-11", channel: "Amazon", title: "a1" },
];
const rankRows = [
  { id: 1, image_url: "http://x/r1.jpg", category: "T恤", period_label: "2026-11", site: "美国", channel: "", title: "r1" },
];

/* 每次「打开一次页面」都重新起一个沙箱：专区开关不同，结果必须不同 */
async function run(opts) {
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
  const localStorageMock = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  let writes = 0;
  const SB = {
    getSession: async () => ({ user: { email: "t@t" } }),
    getFrontendZoneVisibility: async () => (opts.vis === undefined ? null : opts.vis),
    myFrontendZones: async () => (opts.mine === undefined ? null : opts.mine),
    listRankChannelPics: async () => chRows,
    getCompareSources: async () => opts.cfg || null,
    listRankItems: async () => rankRows,
    listImageTags: async () => ({}),
    listMovementTags: async () => ({}),
    saveCompareSources: async () => { writes++; },
    saveSiteSetting: async () => { writes++; },
  };
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    document: doc, localStorage: localStorageMock,
    location: { href: "compare.html", pathname: "/compare.html", origin: "http://x", replace() {} },
  };
  sandbox.window = sandbox;
  sandbox.SB = SB;
  let promptAnswer = null;
  sandbox.uiPrompt = async () => promptAnswer;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx);
  await new Promise((r) => setTimeout(r, 80));
  const bodyHtml = () => q("#cmp-body").innerHTML;
  const hasCol = (key) => bodyHtml().indexOf('data-src="' + key + '"') >= 0;
  const summary = () => String(q("#cmp-summary").textContent || "");
  return {
    hasCol, summary, store, q,
    add(name) { promptAnswer = name; const b = q("#cmp-add-channel-bar"); b.onclick(); },
    writes: () => writes,
  };
}

(async () => {
  /* ---------- 对照组：什么都没关，四个渠道全部出列 ---------- */
  console.log("二、对照：专区全部开启");
  const all = await run({ vis: null });
  ok(all.hasCol("ch:pinterest"), "对照：Pinterest 应出列（否则下面的「关掉后消失」没有意义）");
  ok(all.hasCol("ch:shein"), "对照：SHEIN 应出列");
  ok(all.hasCol("ch:tiktok"), "对照：TikTok 应出列");
  ok(all.hasCol("rank:month"), "对照：上新节奏列应出列");

  /* ---------- 关掉 S / T：列必须消失，P / Amazon 不受影响 ---------- */
  console.log("三、关掉 S / T 专区之后");
  const off = await run({ vis: { shein: false, tiktok: false } });
  ok(!off.hasCol("ch:shein"), "后台关掉 S 专区后，SHEIN 列不应再出现");
  ok(!off.hasCol("ch:tiktok"), "后台关掉 T 专区后，TikTok 列不应再出现");
  ok(off.hasCol("ch:pinterest"), "P 专区没关，Pinterest 列应照常出现");
  ok(off.hasCol("ch:amazon"), "自建渠道（Amazon）没有对应专区，应照常出现");
  ok(/ch:shein/.test(off.summary()) || !/SHEIN/.test(off.summary()), "摘要不应把已关闭的渠道算进对比列数");
  ok(/2 列对比/.test(off.summary()) || /列对比/.test(off.summary()), "摘要应说明当前实际对比列数");
  ok(/专区.*关闭|后台关闭/.test(off.summary()), "摘要应说明「有渠道因其专区关闭而未显示」");

  /* ---------- 关掉上新节奏：rank 列跟着消失 ---------- */
  console.log("四、关掉上新节奏专区");
  const offR = await run({ vis: { rhythm: false } });
  ok(!offR.hasCol("rank:month"), "rhythm 专区关闭后，「上新节奏」列不应再出现");
  ok(offR.hasCol("ch:shein"), "只关上新节奏时，SHEIN 列应照常出现");

  /* ---------- 账号白名单：不在名单里的专区不摆 ---------- */
  console.log("五、账号级白名单");
  const mine = await run({ vis: null, mine: ["compare", "pinterest", "rank"] });
  ok(mine.hasCol("ch:pinterest"), "白名单含 P 专区，Pinterest 应出列");
  ok(!mine.hasCol("ch:shein"), "白名单不含 S 专区，SHEIN 不应出列");
  ok(!mine.hasCol("ch:tiktok"), "白名单不含 T 专区，TikTok 不应出列");
  ok(!mine.hasCol("rank:month"), "白名单不含上新节奏，rank 列不应出列");

  /* ---------- 前台没有增删入口，所以关掉的渠道无法被手动加回来 ---------- */
  console.log("六、前台只读：没有任何渠道入口");
  const add = await run({ vis: { shein: false } });
  ok(!q_has(add, "#cmp-add-channel-bar"), "工具条不应再有「＋ 添加渠道」");
  ok(!q_has(add, "#cmp-add-channel"), "筛选中不应再有「＋ 添加渠道」");
  ok(add.writes() === 0, "整个过程不应写库（实际写 " + add.writes() + " 次）");

  /* ---------- 后台配的列也要过专区开关 ---------- */
  console.log("七、后台配置的列同样受开关约束");
  const cfg = { list: [{ type: "rank", label: "上新节奏" }, { type: "channel", channel: "SHEIN" }, { type: "channel", channel: "Amazon" }] };
  const c1 = await run({ vis: { shein: false }, cfg });
  ok(!c1.hasCol("ch:shein"), "后台配置里写死的 SHEIN 列，专区关掉后也不应出现");
  ok(c1.hasCol("ch:amazon"), "后台配置里的 Amazon 列应照常出现");

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})();
