/* 20261121D · 渠道对比：榜单列（上新节奏）必须始终在
 *
 * 用户看到的现象：
 *   「上新节奏怎么没了？渠道对比前台不显示这个筛选项了，也没有渠道对比池子」
 *
 * 两个独立成因，这一版都拦住：
 *   ① 后台对比列配置里没有榜单列（保存时被移出过 / 保存时 type 丢了变成空渠道列）
 *      → 前台完全听配置，这一列永久消失，前端没有任何入口能加回来；
 *   ② 这个月没有上新节奏的图 → 旧逻辑「没图就不摆列」，筛选里的项和池子一起没了。
 *
 * 验收点：
 *   1) 配置里只有渠道、没有榜单列 → 前台仍自动补出「上新节奏」列并带图；
 *   2) 配置里榜单列被存成普通渠道（名字是「上新节奏 / 榜单」）→ 认回榜单列；
 *   3) 本月没有榜单图 → 列与筛选项都在，池子里写明「不会用其它月份顶替」；
 *   4) 保存配置时（数据层）漏了榜单列 → 自动补在最前面；
 *   5) 后台面板：读出来就补、保存前再补、且不允许把它移出。
 */
import fs from "fs";
import vm from "vm";

const FRONT = fs.readFileSync("js/compare-front.js", "utf8");
const ADMIN = fs.readFileSync("js/admin-compare.js", "utf8");
const DATA = fs.readFileSync("js/supabase.js", "utf8");

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

/* ================= 一、代码层面 ================= */
console.log("一、实现约定");
ok(/var RANK_KEY = "rank:month"/.test(FRONT), "前台应把榜单列的 key 定义成常量");
ok(/function isRankName\(/.test(FRONT), "前台应能按名字认出「上新节奏 / 榜单」这类写法");
ok(/ensureRank\(\)/.test(FRONT), "前台应在列构建后做一次「缺了就补」");
ok(/base\.unshift\(rankSource\(\)\)/.test(FRONT), "补回时应放在最前面");
ok(/return s\.type === "rank";/.test(FRONT), "本月无图时榜单列仍要保留（activeSources）");
ok(/不会用其它月份顶替/.test(FRONT), "空列文案应写明不用其它月份顶替");
ok(/data-jump-month/.test(FRONT), "空列旁应给出一键切到有图月份的入口");

ok(/function ensureRankInList\(/.test(ADMIN), "后台应把榜单列当内置列补齐");
ok(/state\.list\.unshift\(mkRank\(\)\)/.test(ADMIN), "后台缺榜单列时补在最前面");
ok(/isRankName\(x\.channel\) \|\| isRankName\(x\.label\)/.test(ADMIN), "后台读取配置时应认出被存成渠道的榜单列");
ok(/内置对比列，不能移出/.test(ADMIN), "后台应明确拒绝把榜单列移出");
ok(/ensureRankInList\(\);\n    if \(!state\.list\.length\)/.test(ADMIN), "保存前应再补一次榜单列");

ok(/if \(!list\.some\(\(x\) => x\.type === "rank"\)\) \{/.test(DATA), "数据层保存配置时应兜底补榜单列");
ok(/list\.unshift\(\{ key: "rank:month", label: "上新节奏", type: "rank", channel: "" \}\)/.test(DATA),
  "数据层兜底插入的应就是内置榜单列");

/* ================= 二、真实运行前台 ================= */
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

const CH = [
  { image_url: "http://x/p1.jpg", category: "T恤", period_label: "2026-11", channel: "Pinterest", title: "p1" },
  { image_url: "http://x/s1.jpg", category: "T恤", period_label: "2026-11", channel: "SHEIN", title: "s1" },
];

async function run(opts) {
  const o = opts || {};
  const REG = {};
  const q = (sel) => (REG[sel] = REG[sel] || mkEl("div"));
  const doc = {
    readyState: "complete", querySelector: q, getElementById: (id) => q("#" + id),
    createElement: (t) => mkEl(t), addEventListener() {}, querySelectorAll: () => [],
    head: mkEl("head"), body: mkEl("body"), documentElement: mkEl("html"),
  };
  const store = {};
  const SB = {
    getSession: async () => ({ user: { email: "t@t" } }),
    getFrontendZoneVisibility: async () => null,
    myFrontendZones: async () => null,
    listRankChannelPics: async () => CH,
    getCompareSources: async () => o.cfg || null,
    getCompareChannels: async () => (Array.isArray(o.channels) ? o.channels : null),
    listRankItems: async () => [
      { id: 1, image_url: "http://x/r1.jpg", category: "T恤", period_label: o.rankMonth || "2026-11", site: "美国", channel: "", title: "r1" },
    ],
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
  vm.runInContext(FRONT, ctx);
  await new Promise((r) => setTimeout(r, 80));

  const bodyText = () => String(q("#cmp-body").innerHTML || "");
  const hasCol = (key) => bodyText().indexOf('data-src="' + key + '"') >= 0;
  const groups = () => (q("#cmp-groups").children || []);
  const srcChips = () => {
    const g = groups()[groups().length - 1];
    if (!g || !g.children) return [];
    return (g.children[1] && g.children[1].children) || [];
  };
  return {
    hasCol, bodyText, srcChips,
    chipOf: (label) => srcChips().filter((c) => String(c.textContent || "").indexOf(label) === 0)[0] || null,
    summary: () => String(q("#cmp-summary").textContent || ""),
    toastText: () => String((q("#toast") || {}).textContent || ""),
  };
}

(async () => {
  console.log("二、配置里只有渠道、没有榜单列");
  const cfgOnlyCh = {
    list: [
      { key: "ch:pinterest", label: "P", type: "channel", channel: "Pinterest" },
      { key: "ch:shein", label: "S", type: "channel", channel: "SHEIN" },
    ],
    showEmpty: true,
  };
  const r1 = await run({ cfg: cfgOnlyCh });
  ok(r1.hasCol("rank:month"), "配置里没有榜单列时，前台应自动补出来（实际没有）");
  ok(/http:\/\/x\/r1\.jpg/.test(r1.bodyText()), "补出来的榜单列应摆上榜单图");
  ok(!!r1.chipOf("上新节奏"), "筛选里应有「上新节奏」项");
  ok(r1.hasCol("ch:pinterest") && r1.hasCol("ch:shein"), "对照组：配置里的渠道列也要在");

  console.log("三、榜单列被存成普通渠道（旧配置）");
  const cfgLegacy = {
    list: [
      { key: "ch:上新节奏", label: "上新节奏", type: "channel", channel: "" },
      { key: "ch:pinterest", label: "P", type: "channel", channel: "Pinterest" },
    ],
    showEmpty: true,
  };
  const r2 = await run({ cfg: cfgLegacy });
  ok(r2.hasCol("rank:month"), "名字是「上新节奏」但 type 是 channel 时，应认回榜单列");
  ok(!r2.hasCol("ch:上新节奏"), "不应再摆一条空的「上新节奏」渠道列");
  ok(/http:\/\/x\/r1\.jpg/.test(r2.bodyText()), "认回来的榜单列应摆上榜单图");
  ok((r2.bodyText().match(/data-src="rank:month"/g) || []).length === 1, "榜单列只应出现一次（不许重复）");

  console.log("四、本月没有榜单图");
  const r3 = await run({ cfg: cfgOnlyCh, rankMonth: "2026-10" });
  ok(r3.hasCol("rank:month"), "本月没榜单图时，这一列仍要在（池子不能跟着消失）");
  ok(/不会用其它月份顶替/.test(r3.bodyText()), "空列里要写明不用其它月份顶替（实际「" + r3.bodyText().slice(0, 200) + "」）");
  ok(/2026-10/.test(r3.bodyText()), "应提示库里有图的月份");
  ok(/本月无榜单图/.test(r3.summary()), "摘要应说明本月无榜单图");

  console.log("五、反向验证：把内置补列拿掉必须失败");
  const broken = FRONT.replace(/\(function ensureRank\(\) \{[\s\S]*?\}\)\(\);/, "");
  ok(broken !== FRONT, "应能摘掉补列逻辑（证明用例抓得住缺陷）");
  const okBroken = /ensureRank\(\)/.test(broken);
  ok(!okBroken, "摘掉后不应还留着补列调用");
  /* 用摘掉补列逻辑的版本跑一次：配置里没榜单列 → 必须复现「消失」 */
  {
    const SRC0 = FRONT;
    const REG = {};
    const q = (sel) => (REG[sel] = REG[sel] || mkEl("div"));
    const doc = {
      readyState: "complete", querySelector: q, getElementById: (id) => q("#" + id),
      createElement: (t) => mkEl(t), addEventListener() {}, querySelectorAll: () => [],
      head: mkEl("head"), body: mkEl("body"), documentElement: mkEl("html"),
    };
    const sandbox = {
      console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
      RegExp, Error, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
      document: doc,
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      location: { href: "compare.html", pathname: "/compare.html", origin: "http://x", replace() {} },
    };
    sandbox.window = sandbox;
    sandbox.SB = {
      getSession: async () => ({ user: { email: "t@t" } }),
      getFrontendZoneVisibility: async () => null,
      myFrontendZones: async () => null,
      listRankChannelPics: async () => CH,
      getCompareSources: async () => cfgOnlyCh,
      getCompareChannels: async () => null,
      listRankItems: async () => [{ id: 1, image_url: "http://x/r1.jpg", category: "T恤", period_label: "2026-11", channel: "", title: "r1" }],
      listImageTags: async () => ({}),
      listMovementTags: async () => ({}),
    };
    vm.runInContext(broken, vm.createContext(sandbox));
    await new Promise((r) => setTimeout(r, 80));
    const txt = String(q("#cmp-body").innerHTML || "");
    ok(txt.indexOf('data-src="rank:month"') < 0, "摘掉补列逻辑后，榜单列必须复现消失（否则用例无效）");
  }

  console.log("");
  console.log("通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})();
