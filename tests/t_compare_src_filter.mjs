/* 20261114Y · 渠道对比：顶部「渠道」筛选（只本地过滤，不重新取数）
 *
 * 口径（用户定的）：
 *   1) 选了月份就只摆这个月的图；这个月没图的渠道，整列不出现，
 *      也不再用别的月份的图顶替，更不写「无图（其它月份 N）」这种容易误读的文案；
 *   2) 左侧类目也只列这个月有图的类目；
 *   3) 渠道本身的增删在后台配置，前台只读 —— 不再有「＋ 添加渠道」与列头 ✕；
 *   4) 筛选只做本地过滤，不触发任何请求。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/compare-front.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

/* ================= 一、代码层面的硬约束 ================= */
console.log("一、筛选只做本地过滤");
ok(/function srcGroup\(/.test(SRC), "缺少「渠道」筛选组");
ok(/"渠道"/.test(SRC), "筛选组标题应为「渠道」");

const act = SRC.slice(SRC.indexOf("function activeSources()"), SRC.indexOf("function hiddenByEmpty()"));
ok(act.length > 0, "抽取 activeSources 失败");
ok(!/SB\.|await |fetch\(/.test(act), "activeSources 不应发起任何请求或异步调用");
ok(/state\.srcOff\[s\.key\]/.test(act), "应支持手动关掉某列");
ok(/colHasData\(s\)/.test(act), "列是否有图决定摆不摆");
ok(/function colHasData\(/.test(SRC), "缺少列是否有图的判定函数");
ok(/function hiddenByEmpty\(/.test(SRC), "缺少「被自动隐藏列」统计");
ok(/这个月没有图/.test(SRC), "摘要应说明有几个渠道这个月没有图");
ok(/至少要保留一列/.test(SRC), "不允许把列全部关掉");

console.log("一·二、前台只读：增删渠道只能在后台");
ok(!/promptAddChannel/.test(SRC), "前台不应再有「添加渠道」入口");
ok(!/cmp-add-channel/.test(SRC), "前台不应再有添加渠道按钮");
ok(!/cmp-col-x|data-rmcol/.test(SRC), "列头不应再有删除按钮");
ok(!/readColsPref|applyColsPref|resetColsPref/.test(SRC), "前台不应再读本机自定义渠道名单");
ok(!/monthFallback/.test(SRC), "不应再用别的月份的图顶替当月");
ok(!/其它月份\s*\d|无图（其它月份/.test(SRC), "不应再出现「无图（其它月份 N）」这种易误读文案（本轮新增的是「库里其它月份有：…」+ 一键切换，不摆图）");

/* ================= 二、真实执行：点一遍筛选按钮 ================= */
console.log("二、实跑：默认隐藏无图渠道，可手动开关");

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
function q(sel) {
  if (!REG[sel]) REG[sel] = mkEl("div");
  return REG[sel];
}

const doc = {
  readyState: "complete",
  querySelector: q,
  getElementById: (id) => q("#" + id),
  createElement: (t) => mkEl(t),
  addEventListener() {},
  querySelectorAll: () => [],
  head: mkEl("head"),
  body: mkEl("body"),
  documentElement: mkEl("html"),
};

/* 数据：Pinterest 2 张(2026-11)、SHEIN 1 张(2026-11)、TikTok 1 张(2026-09，当前月无图) */
const chRows = [
  { image_url: "http://x/p1.jpg", category: "T恤", period_label: "2026-11", channel: "Pinterest", title: "p1" },
  { image_url: "http://x/p2.jpg", category: "T恤", period_label: "2026-11", channel: "Pinterest", title: "p2" },
  { image_url: "http://x/s1.jpg", category: "T恤", period_label: "2026-11", channel: "SHEIN", title: "s1" },
  { image_url: "http://x/t1.jpg", category: "T恤", period_label: "2026-09", channel: "TikTok", title: "t1" },
];
const rankRows = [
  { id: 1, image_url: "http://x/r1.jpg", category: "T恤", period_label: "2026-11", site: "美国", channel: "", title: "r1" },
];
let requests = 0;
const SB = {
  getSession: async () => ({ user: { email: "t@t" } }),
  getFrontendZoneVisibility: async () => null,
  myFrontendZones: async () => null,
  listRankChannelPics: async () => { requests++; return chRows; },
  getCompareSources: async () => null,
  listRankItems: async () => { requests++; return rankRows; },
  listImageTags: async () => ({}),
  listMovementTags: async () => ({}),
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
vm.runInContext(SRC, ctx);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 找到「渠道」筛组里的 chip 列表 */
function srcChips() {
  const box = q("#cmp-groups");
  const grp = box.children.filter((g) => {
    const nm = g.children && g.children[0];
    return nm && nm.textContent === "渠道";
  })[0];
  if (!grp) return null;
  return grp.children[1];
}
/* 20261114Q：一个 chip 现在是「开关按钮 + 右侧 ✕」的包一层（只影响本机显示），
   断言时统一拆出里面的开关按钮，避免把外壳当成 chip。 */
function chipBtn(c) {
  if (!c) return null;
  return String(c.className || "").indexOf("cmp-chip-wrap") >= 0 ? c.children[0] : c;
}
function chipList() {
  const c = srcChips();
  if (!c) return [];
  return c.children.map((x) => ({ wrap: x, btn: chipBtn(x), text: String((chipBtn(x) || {}).textContent || "") }));
}
function chipByLabel(part) {
  return (chipList().filter((x) => x.text.indexOf(part) >= 0)[0] || {}).btn || null;
}
function chipWrapByLabel(part) {
  return (chipList().filter((x) => x.text.indexOf(part) >= 0)[0] || {}).wrap || null;
}
const bodyHtml = () => q("#cmp-body").innerHTML;
const hasCol = (key) => bodyHtml().indexOf('data-src="' + key + '"') >= 0;

(async () => {
  await sleep(60);

  ok(requests >= 2, "取数确实发生了（否则下面的断言没有意义）");

  /* 默认（当月 2026-11）：TikTok 只有 09 月的图 → 整列不出现 */
  ok(!hasCol("ch:tiktok"), "当月没有图的渠道不应出列（TikTok）");
  ok(hasCol("ch:pinterest"), "有图的渠道应正常出列（Pinterest）");
  ok(hasCol("ch:shein"), "有图的渠道应正常出列（SHEIN）");
  ok(/1 个渠道这个月没有图/.test(q("#cmp-summary").textContent), "摘要应说明有 1 个渠道这个月没有图");
  ok(!/其它月份/.test(q("#cmp-summary").textContent), "摘要不应再引导去看别的月份");
  ok(!/无图（其它月份/.test(SRC), "不得在任何地方写「无图（其它月份 N）」");

  /* 渠道筛选里也不再出现当月没图的渠道 */
  ok(!chipByLabel("T"), "当月没图的渠道不应出现在筛选里");

  const before = requests;

  /* 关掉一个有图的渠道 */
  const pin = chipByLabel("P");
  ok(!!pin, "有图的渠道应出现在筛选里");
  pin.onclick();
  ok(!hasCol("ch:pinterest"), "关掉后该渠道不应再出列");

  /* 全部关掉时至少留一列 */
  let guard = 0;
  while (guard++ < 12) {
    const on = chipList().slice(1).filter((c) => /active/.test((c.btn || {}).className));
    if (on.length <= 1) break;
    on[0].btn.onclick();
  }
  const last = chipList().slice(1).filter((c) => /active/.test((c.btn || {}).className));
  ok(last.length === 1, "应只剩一列仍然显示");
  last[0].btn.onclick();
  const afterClose = chipList().slice(1).filter((c) => /active/.test((c.btn || {}).className)).length;
  ok(afterClose === 1, "关最后一列时不应生效（至少保留一列）");
  ok(/rk-pool|rk-empty|该列暂无数据/.test(bodyHtml()), "至少保留一列时不应渲染成空白页");

  /* 「全部」恢复默认 */
  srcChips().children[0].onclick();
  ok(hasCol("ch:pinterest") && hasCol("ch:shein"), "「全部」应恢复有图的列");
  ok(!hasCol("ch:tiktok"), "「全部」后当月无图的渠道仍不出现");

  /* 切到「全部月份」：TikTok 有图了，应该出现 */
  chipByLabel.call(null, "全部月份");
  const monthBox = q("#cmp-groups").children[0].children[1];
  const allMonth = monthBox.children.filter((c) => String(c.textContent || "").indexOf("全部月份") >= 0)[0];
  ok(!!allMonth, "月度筛选里应有「全部月份」");
  if (allMonth) {
    allMonth.onclick();
    ok(hasCol("ch:tiktok"), "「全部月份」下 TikTok 应出列（它有 09 月的图）");
  }

  /* 整个过程不应增加取数请求：筛选只在内存里过滤 */
  ok(requests === before, "筛选不应触发任何取数请求（否则又会变慢）");

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})();
