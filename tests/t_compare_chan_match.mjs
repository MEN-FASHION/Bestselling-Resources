/* 20261113T · 渠道对比：加载慢 + 渠道列「传了图却不显示」
 *
 * 两个症状、四个根因，这里逐条钉住：
 *   A. 慢：取数四段串行 + 渠道图扫全表 + 打标结果挡首屏
 *      1) 三条取数必须一开始就同时发出；
 *      2) 渠道图的库内查询只能取「有渠道归属」的行，且不用 select("*")；
 *      3) 打标结果不得挡住首屏（不返回的接口也不能让页面停在加载中）。
 *   B. 空：写法不一致导致对不上
 *      4) 渠道名 SHEIN / shein / SHE-IN 必须归成一列（与专区同口径）；
 *      5) 类目平台全路径必须归一成标准名（与趋势上升榜同口径）；
 *      6) 某一列在所选月份没有图、但别的月份有时，要摆出它自己的图并注明月份，
 *         而不是显示「该列暂无数据」。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SRC = read("js/compare-front.js");
const SUPA = read("js/supabase.js");
const CATNORM = read("js/rank-cat-norm.js");
const PAGE = read("compare.html");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

/* ================= 一、代码层硬约束 ================= */
console.log("一、取数结构");
ok(/Promise\.all\(\[pCh, pCfg, pRk\]\)/.test(SRC), "三条取数必须并行（Promise.all）发出，不能串行等待");
ok(!/await SB\.listRankChannelPics/.test(SRC), "不应再逐个 await 取数（那是串行的写法）");
ok(/function loadTags\(/.test(SRC) && /loadTags\(\);\s*\n\s*\}\)();|loadTags\(\);/.test(SRC),
  "打标结果应在首屏之后异步补，不挡列表");
ok(/showLoading\(/.test(SRC) && /已 /.test(SRC), "加载提示应显示已等待秒数，不能只写「加载中」");

console.log("二、渠道图的库内查询");
const chFn = SUPA.slice(SUPA.indexOf("API.listRankChannelPics = async function"));
const chBody = chFn.slice(0, chFn.indexOf("return out;"));
ok(/not\("channel", "is", null\)/.test(chBody), "库内查询应只取 channel 非空的行（否则等于扫全表）");
ok(!/select\("\*"\)\.eq\("period_type"/.test(chBody), "不应再用 select(\"*\") 扫整张榜单表");
ok(/Promise\.all\(\[chPicLoad\(\), API\.rankChannelColumn\(\)/.test(chBody),
  "文档存储与列探测应并行，少一次串行等待");

console.log("三、页面依赖");
ok(/rank-cat-norm\.js/.test(PAGE), "compare.html 应引入类目归一脚本（与趋势上升榜同一套）");

/* ================= 二、真实执行 ================= */
console.log("四、实跑：写法归一 / 月份回退 / 打标不挡首屏");

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
    querySelector() { return null; }, querySelectorAll() { return []; },
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

/* 数据设计：
   - 渠道名三种写法，实为同一个渠道 SHEIN；
   - 类目一边是平台全路径，一边是标准名「套装」；
   - SHEIN 的图都在 2026-10，榜单在 2026-11（默认月）→ 触发「按列回退」；
   - 打标接口永不返回 → 首屏不能被它挡住。 */
const chRows = [
  { image_url: "http://x/s1.jpg", category: "服装、鞋靴和珠宝饰品，男士时尚，男装，男士休闲运动套装", period_label: "2026-10", channel: "SHEIN" },
  { image_url: "http://x/s2.jpg", category: "套装", period_label: "2026-10", channel: "shein" },
  { image_url: "http://x/s3.jpg", category: "套装", period_label: "2026-10", channel: "SHE-IN" },
  { image_url: "http://x/p1.jpg", category: "套装", period_label: "2026-11", channel: "Pinterest" },
];
const rankRows = [
  { id: 1, image_url: "http://x/r1.jpg", category: "套装", period_label: "2026-11", site: "美国", channel: "", title: "r1" },
];
let tagCalled = 0;
const SB = {
  getSession: async () => ({ user: { email: "t@t" } }),
  getFrontendZoneVisibility: async () => null,
  myFrontendZones: async () => null,
  listRankChannelPics: async () => chRows,
  getCompareSources: async () => null,
  listRankItems: async () => rankRows,
  listImageTags: async () => ({}),
  /* 永不返回：模拟打标表很大 / 很慢 */
  listMovementTags: () => { tagCalled++; return new Promise(() => {}); },
};

const sandbox = {
  console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
  RegExp, Error, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
  document: doc,
  location: { href: "compare.html", pathname: "/compare.html", origin: "http://x", replace() {} },
};
sandbox.window = sandbox;
sandbox.SB = SB;
const ctx = vm.createContext(sandbox);
vm.runInContext(CATNORM, ctx);
vm.runInContext(SRC, ctx);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bodyHtml = () => q("#cmp-body").innerHTML;

function srcChips() {
  const box = q("#cmp-groups");
  const grp = box.children.filter((g) => g.children && g.children[0] && g.children[0].textContent === "渠道")[0];
  return grp ? grp.children[1] : null;
}
function chipByLabel(part) {
  const c = srcChips();
  if (!c) return null;
  return c.children.filter((x) => String(x.textContent).indexOf(part) >= 0)[0];
}

(async () => {
  await sleep(80);

  /* 首屏必须已经画出来（打标接口永不返回也不影响） */
  ok(bodyHtml().indexOf("cmp-card") >= 0, "打标接口不返回时，图片列表仍应正常渲染（不能停在加载中）");
  ok(!/加载中/.test(bodyHtml()), "首屏不应停留在「加载中」");
  ok(tagCalled >= 1, "打标结果应被异步发起（只是不挡首屏）");

  /* 三种写法应归成一列 */
  const chips = srcChips().children.map((c) => String(c.textContent));
  const sheinChips = chips.filter((t) => /shein/i.test(t));
  ok(sheinChips.length === 1, "SHEIN / shein / SHE-IN 应归为同一列，实际：" + JSON.stringify(sheinChips));

  /* 类目：长路径应归到「套装」，不能把菜单撑出长名字 */
  const cats = q("#cmp-cats").children.map((c) => String(c.innerHTML || c.textContent));
  ok(cats.some((t) => t.indexOf("套装") >= 0), "类目菜单应出现标准名「套装」");
  ok(!cats.some((t) => t.indexOf("服装、鞋靴和珠宝饰品") >= 0), "类目菜单不应出现平台全路径");

  /* 默认月份 2026-11：SHEIN 列当月无图 → 默认不出列，但摘要要说明它在别的月份有图 */
  const summary = String(q("#cmp-summary").textContent);
  ok(/已隐藏 1 个无图渠道/.test(summary), "当月无图的渠道应默认隐藏并计数");
  ok(/其它月份/.test(summary), "摘要应写明这些渠道在其它月份有图（否则看起来像图丢了）");

  /* 点开该渠道：必须真的出图，而不是「该列暂无数据」 */
  const shein = chipByLabel("SHEIN");
  ok(!!shein, "「渠道」筛选里应能找到 SHEIN");
  shein.onclick();
  ok(bodyHtml().indexOf("s1.jpg") >= 0 && bodyHtml().indexOf("s2.jpg") >= 0 && bodyHtml().indexOf("s3.jpg") >= 0,
    "点开后应摆出该渠道的图（本月没有就摆它自己的全部）");
  ok(/没有图/.test(bodyHtml()) && /2026-10/.test(bodyHtml()), "应注明这一列在本月没有图、图片是哪个月份的");

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})();
