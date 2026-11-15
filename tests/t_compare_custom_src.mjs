/* 20261114Y · 渠道对比：渠道的增删只在后台，前台只读
 *
 * 背景：20261114Q 曾把「＋ 添加渠道 / 列头 ✕」做在前台（只影响本机），
 * 但用户要的是「在后台配好，前台照着摆」。这一版把前台那层删干净了。
 *
 * 验收点：
 *   1) 前台没有任何增删入口（没有 ＋ 添加渠道、没有列头 ✕、不读本机渠道名单）；
 *   2) 后台「渠道对比 · 对比列配置」里有渠道清单，可增可删，存进 site_settings；
 *   3) 前台列 = 后台清单 + 库里出现过的渠道，再按「这个月有没有图」过滤；
 *   4) 后台登记了但还没传图的渠道，当月不占空白列。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/compare-front.js", "utf8");
const ADMIN = fs.readFileSync("js/admin-compare.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

/* ================= 一、代码层面的硬约束 ================= */
console.log("一、前台只读");
ok(!/function addChannel\(/.test(SRC), "前台不应再有「添加渠道」实现");
ok(!/function removeChannel\(/.test(SRC), "前台不应再有「去掉渠道」实现");
ok(!/function readColsPref\(|function applyColsPref\(|function resetColsPref\(/.test(SRC),
  "前台不应再读写本机自定义渠道名单");
ok(!/＋ 添加渠道/.test(SRC), "前台不应再有「＋ 添加渠道」入口");
ok(!/cmp-chip-x|cmp-col-x/.test(SRC), "前台不应再有列头 / chip 上的 ✕");
ok(!/uiPrompt/.test(SRC), "前台不应再弹「输入渠道名」的输入框");

console.log("二、后台可增删渠道");
ok(/compare_channels/.test(ADMIN), "后台应把渠道清单存进 site_settings");
ok(/function\s+addChannel|addChannel\s*=|addChannel:/.test(ADMIN), "后台应有「新增渠道」实现");
ok(/function\s+dropChannel|dropChannel\s*=|dropChannel:/.test(ADMIN), "后台应有「删除渠道」实现");
ok(/saveCompareSources|setCompareSources/.test(ADMIN), "后台改动应写回配置（不是只改内存）");

/* ================= 二、真实执行 ================= */
console.log("三、实跑：列由后台清单 + 库里有图决定");

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

  /* 当月 2026-11：后台登记的 AliExpress 没有图 → 不占空白列，筛选里也不出现 */
  ok(!hasCol("ch:aliexpress"), "后台登记但当月没图的渠道不应占一列空白");
  ok(!chipList().some((x) => x.text.indexOf("AliExpress") >= 0),
    "当月没图的渠道不应出现在筛选里");
  ok(!addBtn(), "「渠道」筛选里不应再有「＋ 添加渠道」按钮");
  ok(hasCol("ch:pinterest") && hasCol("ch:shein"), "当月有图的渠道应正常出列");

  /* 也没有列头 ✕ / chip ✕ */
  const wraps = chipList().map((x) => x.wrap);
  ok(!wraps.some((w) => w && w.children && w.children.length >= 2), "渠道 chip 上不应再有 ✕");

  /* 切到「全部月份」：TikTok（09 月有图）应出现；AliExpress 始终没图，仍不出现 */
  const monthBox = q("#cmp-groups").children[0].children[1];
  const allMonth = monthBox.children.filter((c) => String(c.textContent || "").indexOf("全部月份") >= 0)[0];
  ok(!!allMonth, "月度筛选里应有「全部月份」");
  allMonth.onclick();
  ok(hasCol("ch:tiktok"), "「全部月份」下有图的渠道应出列（TikTok）");
  ok(!hasCol("ch:aliexpress"), "始终没有图的渠道不应假装成一列");

  /* 前台仍然不写库、不多取数 */
  ok(writes === 0, "前台不应写库（实际写 " + writes + " 次）");
  ok(requests <= 3, "前台不应触发重复取数（实际 " + requests + " 次）");
  ok(promptCalls === 0, "前台不应弹出任何输入框");

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})();
