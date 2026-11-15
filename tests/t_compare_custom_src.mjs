/* 20261114Q · 渠道对比：自定义增删渠道
 *
 * 要解决的问题：
 *   以前对比哪几列由「库里已经出现过的渠道名」定死 —— 没传过图的渠道根本加不进来，
 *   不想看的列也只能靠后台改全局配置。
 *
 * 验收点：
 *   1) 「筛选 → 渠道」里有「＋ 添加渠道」，填个名字就多一列（即使还没图）；
 *   2) 每个渠道列右侧有「✕」，点掉就从这一页消失；
 *   3) 增删记在本机（localStorage），刷新后仍然生效；
 *   4) 「全部」= 恢复默认，把自定义增删一起清掉；
 *   5) 空白名不加、重复名不重复加；整个过程不发任何取数请求、不写库。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/compare-front.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

/* ================= 一、代码层面的硬约束 ================= */
console.log("一、实现约定");
ok(/function addChannel\(/.test(SRC), "缺少「添加渠道」实现");
ok(/function removeChannel\(/.test(SRC), "缺少「去掉渠道」实现");
ok(/function resetColsPref\(/.test(SRC), "缺少「恢复默认」实现");
ok(/localStorage\.setItem/.test(SRC), "自定义增删应记在本机（刷新后仍生效）");
ok(/＋ 添加渠道/.test(SRC), "筛选里应有「＋ 添加渠道」入口");
ok(/cmp-chip-x/.test(SRC), "渠道列右侧应有「✕」");
/* 只改本机显示，绝不写库 */
const segStart = SRC.indexOf("function addChannel(");
const segEnd = SRC.indexOf("function normMonth(");
const seg = SRC.slice(segStart, segEnd);
ok(seg.length > 0, "抽取自定义增删实现失败");
ok(!/SB\./.test(seg), "自定义增删不得调用任何后端接口");
ok(!/uploadRankChannel|saveCompareSources|saveSiteSetting/.test(seg), "自定义增删不得写库");

/* ================= 二、真实执行 ================= */
console.log("二、实跑：加一列、删一列、恢复默认");

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

/* 本机记忆：用一个假 localStorage，能读能写，用来断言「刷新后仍生效」 */
const store = {};
const localStorageMock = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const chRows = [
  { image_url: "http://x/p1.jpg", category: "T恤", period_label: "2026-11", channel: "Pinterest", title: "p1" },
  { image_url: "http://x/s1.jpg", category: "T恤", period_label: "2026-11", channel: "SHEIN", title: "s1" },
  { image_url: "http://x/t1.jpg", category: "T恤", period_label: "2026-09", channel: "TikTok", title: "t1" },
];
const rankRows = [
  { id: 1, image_url: "http://x/r1.jpg", category: "T恤", period_label: "2026-11", site: "美国", channel: "", title: "r1" },
];
let requests = 0, writes = 0;
const SB = {
  getSession: async () => ({ user: { email: "t@t" } }),
  getFrontendZoneVisibility: async () => null,
  myFrontendZones: async () => null,
  listRankChannelPics: async () => { requests++; return chRows; },
  getCompareSources: async () => null,
  /* 20261114T：后台渠道清单里登记过一个还没传图的渠道 */
  getCompareChannels: async () => ["AliExpress"],
  listRankItems: async () => { requests++; return rankRows; },
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
/* 站内输入弹窗桩：由每个用例自己决定「用户输入了什么」 */
let promptAnswer = null;
let promptCalls = 0;
sandbox.uiPrompt = async () => { promptCalls++; return promptAnswer; };

const ctx = vm.createContext(sandbox);
vm.runInContext(SRC, ctx);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function srcChips() {
  const box = q("#cmp-groups");
  const grp = box.children.filter((g) => g.children && g.children[0] && g.children[0].textContent === "渠道")[0];
  return grp ? grp.children[1] : null;
}
function chipBtn(c) {
  if (!c) return null;
  return String(c.className || "").indexOf("cmp-chip-wrap") >= 0 ? c.children[0] : c;
}
function chipList() {
  const c = srcChips();
  if (!c) return [];
  return c.children.map((x) => ({ wrap: x, btn: chipBtn(x), text: String((chipBtn(x) || {}).textContent || "") }));
}
function chipWrapByLabel(part) {
  return (chipList().filter((x) => x.text.indexOf(part) >= 0)[0] || {}).wrap || null;
}
function addBtn() {
  const c = srcChips();
  return c && c.children.filter((x) => String(x.className || "").indexOf("cmp-add-chip") >= 0)[0];
}
const bodyHtml = () => q("#cmp-body").innerHTML;
const hasCol = (key) => bodyHtml().indexOf('data-src="' + key + '"') >= 0;

(async () => {
  await sleep(60);
  ok(requests >= 2, "取数确实发生了（否则下面断言没有意义）");

  /* 0) 后台渠道清单里登记过、但还没有图的渠道：也要出现在「渠道」筛选里 */
  ok(chipList().some((x) => x.text.indexOf("AliExpress") >= 0),
    "后台渠道清单里登记的渠道应出现在筛选里（即使还没有图）");
  ok(/无图/.test((chipList().filter((x) => x.text.indexOf("AliExpress") >= 0)[0] || {}).text || ""),
    "清单里还没传图的渠道应标注「无图」");

  /* 1) 加一列：填「Amazon」，出现一列（现在还没图，也要占位） */
  const add = addBtn();
  ok(!!add, "「渠道」筛选里应有「＋ 添加渠道」按钮");
  promptAnswer = "Amazon";
  add.onclick();
  await sleep(10);
  ok(promptCalls === 1, "点添加应弹出输入框（走站内输入弹窗）");
  ok(hasCol("ch:amazon"), "添加后应出现 Amazon 这一列");
  ok(chipList().some((x) => x.text.indexOf("Amazon") >= 0), "筛选里也应有 Amazon 的开关");
  ok(/无图/.test((chipList().filter((x) => x.text.indexOf("Amazon") >= 0)[0] || {}).text || ""),
    "还没有图的渠道应标注「无图」，不能假装有数据");
  ok(hasCol("ch:pinterest"), "加了一列之后原有渠道仍应正常出列（不能整页变空）");

  /* 2) 记在本机 */
  const saved = JSON.parse(store.bs_cmp_cols || "{}");
  ok((saved.add || []).indexOf("Amazon") >= 0, "新增渠道应记在 localStorage（刷新后仍生效）");

  /* 3) 重复 / 空白：不应产生第二列 */
  promptAnswer = "amazon";
  addBtn().onclick();
  await sleep(10);
  ok(chipList().filter((x) => /amazon/i.test(x.text)).length === 1, "同名渠道不应重复加成两列");
  promptAnswer = "   ";
  addBtn().onclick();
  await sleep(10);
  ok(!hasCol("ch:"), "空白名不应加出空列");

  /* 4) ✕ 去掉一列（SHEIN） */
  const wrapS = chipWrapByLabel("S");
  ok(!!wrapS && wrapS.children.length >= 2, "渠道列右侧应有「✕」");
  wrapS.children[1].onclick({ stopPropagation() {} });
  await sleep(10);
  ok(!hasCol("ch:shein"), "点 ✕ 后该渠道应从对比里消失");
  const saved2 = JSON.parse(store.bs_cmp_cols || "{}");
  ok((saved2.del || []).indexOf("ch:shein") >= 0, "删除也应记在本机（刷新后不会又冒出来）");

  /* 5) 「全部」= 恢复默认：自定义删的回来、自定义加的没了 */
  srcChips().children[0].onclick();
  await sleep(10);
  ok(hasCol("ch:shein"), "「全部」后应恢复被删掉的渠道列");
  ok(!hasCol("ch:amazon"), "「全部」后应清掉自定义添加的列");
  const saved3 = JSON.parse(store.bs_cmp_cols || "{}");
  ok((saved3.add || []).length === 0 && (saved3.del || []).length === 0, "「全部」应把本机自定义增删一起清空");

  /* 6) 不上账：整个过程不写库、不多取一次数 */
  ok(writes === 0, "自定义增删不应写库（实际写 " + writes + " 次）");
  ok(requests <= 3, "自定义增删不应触发重复取数（实际 " + requests + " 次）");

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})();
