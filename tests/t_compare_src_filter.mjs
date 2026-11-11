/* 20261111AF · 渠道对比：顶部「渠道」筛选（只本地过滤，不重新取数）
 *
 * 要解决的问题：
 *   下面会把所有渠道都摆出来一列，哪怕这个渠道当月一张图都没有 → 一屏空白列。
 *
 * 验收点：
 *   1) 当前月份没有图的渠道，默认不出列；
 *   2) 顶部「筛选 → 渠道」可以把任何渠道点开（含空渠道），也可以关掉有图的渠道；
 *   3) 至少保留一列，不允许全关；
 *   4) 「全部」回到默认；
 *   5) 整个筛选只在内存里过滤，不触发任何请求（不会因此变慢 / 转圈）。
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

/* activeSources 内部不得发请求 */
const act = SRC.slice(SRC.indexOf("function activeSources()"), SRC.indexOf("function hiddenByEmpty()"));
ok(act.length > 0, "抽取 activeSources 失败");
ok(!/SB\.|await |fetch\(/.test(act), "activeSources 不应发起任何请求或异步调用");
ok(/state\.srcOff\[s\.key\]/.test(act), "应支持手动关掉某列");
ok(/state\.srcOn\[s\.key\]/.test(act), "应支持手动打开某列");
ok(/colHasData\(s\)/.test(act), "默认按「这一列有没有图」决定");

ok(/function colHasData\(/.test(SRC), "缺少列是否有图的判定函数");
ok(/function hiddenByEmpty\(/.test(SRC), "缺少「被自动隐藏列」统计");
ok(/已隐藏 /.test(SRC) && /无图渠道/.test(SRC), "摘要应提示隐藏了几个无图渠道");
ok(/至少要保留一列/.test(SRC), "不允许把列全部关掉");
ok(/筛选 → 渠道/.test(SRC), "空态应指路到「筛选 → 渠道」");

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
function chipByLabel(part) {
  const chips = srcChips();
  if (!chips) return null;
  return chips.children.filter((c) => String(c.textContent).indexOf(part) === 0 ||
    String(c.textContent).indexOf(part) >= 0)[0];
}
const bodyHtml = () => q("#cmp-body").innerHTML;

(async () => {
  await sleep(60);

  ok(requests >= 2, "取数确实发生了（否则下面的断言没有意义）");

  /* 默认：TikTok 当月无图 → 不出列 */
  ok(bodyHtml().indexOf("TikTok") < 0, "默认不应显示当月没有图的渠道（TikTok）");
  ok(bodyHtml().indexOf("Pinterest") >= 0, "有图的渠道应正常出列（Pinterest）");
  ok(bodyHtml().indexOf("SHEIN") >= 0, "有图的渠道应正常出列（SHEIN）");
  ok(/已隐藏 1 个无图渠道/.test(q("#cmp-summary").textContent), "摘要应写明隐藏了 1 个无图渠道");

  const before = requests;

  /* 渠道筛选里应能看到被隐藏的 TikTok（否则用户没法打开它） */
  const tik = chipByLabel("TikTok");
  ok(!!tik, "「渠道」筛选里应列出被隐藏的 TikTok，方便手动打开");
  ok(/无图/.test(tik.textContent), "无图渠道的 chip 应标注「无图」");

  /* 手动打开 TikTok */
  tik.onclick();
  ok(bodyHtml().indexOf("TikTok") >= 0, "点开后应强制显示该渠道（即使当月无图）");
  ok(/active/.test(chipByLabel("TikTok").className), "被打开的 chip 应处于选中态");

  /* 手动关掉一个有图的渠道 */
  const pin = chipByLabel("Pinterest");
  pin.onclick();
  ok(bodyHtml().indexOf("Pinterest") < 0, "关掉后该渠道不应再出列");
  ok(!/active/.test(chipByLabel("Pinterest").className), "被关掉的 chip 不应是选中态");

  /* 全部关掉时至少留一列 */
  let guard = 0;
  while (guard++ < 12) {
    const chips = srcChips().children.slice(1);        // 跳过「全部」
    const on = chips.filter((c) => /active/.test(c.className));
    if (on.length <= 1) break;
    on[0].onclick();
  }
  const last = srcChips().children.slice(1).filter((c) => /active/.test(c.className));
  ok(last.length === 1, "应只剩一列仍然显示");
  last[0].onclick();
  const afterClose = srcChips().children.slice(1).filter((c) => /active/.test(c.className)).length;
  ok(afterClose === 1, "关最后一列时不应生效（至少保留一列）");
  /* 剩下那列可能本来就没图（例如只剩 TikTok）：只要有内容或空态提示即可，不能是白屏 */
  ok(/rk-pool|rk-empty/.test(bodyHtml()), "至少保留一列时不应渲染成空白页");

  /* 「全部」恢复默认 */
  srcChips().children[0].onclick();
  ok(bodyHtml().indexOf("Pinterest") >= 0 && bodyHtml().indexOf("SHEIN") >= 0,
    "「全部」应恢复有图的列");
  ok(bodyHtml().indexOf("TikTok") < 0, "「全部」后无图渠道仍默认隐藏");

  /* 整个过程不应增加取数请求：筛选只在内存里过滤 */
  ok(requests === before, "筛选不应触发任何取数请求（否则又会变慢）");

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})();
