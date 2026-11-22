/* 20261114Y · 渠道对比：没图的月份不展示、也不用别的月份顶替
 *
 * 用户原话：
 *   「这种提醒方式有点容易让人误解，如果某个月没图直接不展示就好了，不要用其他月份替代，
 *     所有专区都按照这个思路做。」（2026-03 只显示 1 列、其余列被别的月份的图顶替）
 *   「营装筛选下，未显示的来源在其它月份有图但找不到对应类目。」
 *
 * 验收点：
 *   1) 选了月份就只摆这个月的图；这个月没图的列整列不出现；
 *   2) 页面上不再出现「某月没有图，下面是它全部的 N 张（月份：…）」这类提示；
 *   3) 顶部渠道筛选、左侧类目菜单都只反映当月；
 *   4) 全路径类目名与标准名视为同一个类目：选「营装」时两边的图都在，
 *      菜单合并成一条并显示标准名（不改任何一处显示名）；
 *   5) 反向用例：把「当月没有就回退全部」写回去，用例必须失败。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/compare-front.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= 一、代码层 ================= */
console.log("一、代码层：没有月份兜底");
ok(/function colItems\(s\) \{/.test(SRC), "缺少 colItems");
ok(!/monthFallback/.test(SRC), "不应再保留 monthFallback 分支");
ok(!/月份：/.test(SRC), "不应再拼接「月份：…」这种替换说明");
const ci = SRC.slice(SRC.indexOf("function colItems(s) {"));
const ciBody = ci.slice(0, ci.indexOf("\n  }") + 4);
ok(/r\.month === state\.month/.test(ciBody), "colItems 应按月份严格过滤");
ok(!/if \(!inMonth\.length\)|inMonth\.length \?/.test(ciBody), "colItems 不应再「当空就换成全部」");

console.log("二、代码层：类目同组判定");
ok(/function catSame\(/.test(SRC), "缺少类目同组判定 catSame");
ok(/function catLastSeg\(/.test(SRC), "缺少全路径末段提取");
ok(/catSame\(r\.category, cat\)/.test(SRC), "列内过滤应按「同一个类目」而非字符串相等");
ok(/catPickLabel/.test(SRC), "类目菜单应合并同组并挑一个代表名");

/* ================= 二、真跑 ================= */
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

async function run(src) {
  const CODE = src || SRC;
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
  /* 数据设计（对齐用户现场）：
     · 2026-03 这一批：上新节奏 3 张 + S 专区 2 张，都是「营装 / 全路径营装」；
     · P 专区这个月没图（只有 2026-01 的 2 张）；T 专区也只有 2026-01 的图；
     · S 专区有一条类目写成平台全路径，末段是「男士休闲营装」。 */
  const chRows = [
    { image_url: "http://x/s1.jpg", category: "营装", period_label: "2026-03", channel: "SHEIN" },
    { image_url: "http://x/s2.jpg", category: "服装、鞋靴和珠宝饰品，男士时尚，男装，男士休闲营装", period_label: "2026-03", channel: "SHEIN" },
    { image_url: "http://x/p1.jpg", category: "营装", period_label: "2026-01", channel: "Pinterest" },
    { image_url: "http://x/p2.jpg", category: "营装", period_label: "2026-01", channel: "Pinterest" },
    { image_url: "http://x/t1.jpg", category: "营装", period_label: "2026-01", channel: "TikTok" },
  ];
  const rankRows = [
    { id: 1, image_url: "http://x/r1.jpg", category: "营装", period_label: "2026-03", site: "美国", channel: "" },
    { id: 2, image_url: "http://x/r2.jpg", category: "营装", period_label: "2026-03", site: "美国", channel: "" },
    { id: 3, image_url: "http://x/r3.jpg", category: "营装", period_label: "2026-03", site: "美国", channel: "" },
  ];
  const SB = {
    getSession: async () => ({ user: { email: "t@t" } }),
    getFrontendZoneVisibility: async () => null,
    myFrontendZones: async () => null,
    listRankChannelPics: async () => chRows,
    getCompareSources: async () => null,
    getCompareChannels: async () => null,
    listRankItems: async () => rankRows,
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
  vm.runInContext(CODE, ctx);
  await sleep(80);
  const bodyHtml = () => q("#cmp-body").innerHTML;
  const hasCol = (key) => bodyHtml().indexOf('data-src="' + key + '"') >= 0;
  const sum = () => String(q("#cmp-summary").textContent || "");
  const bar = () => String((q("#cmp-bar") || {}).innerHTML || "");
  function pickMonth(m) {
    const box = q("#cmp-groups").children[0].children[1];
    const chip = box.children.filter((c) => String(c.textContent || "").indexOf(m) >= 0)[0];
    if (chip) chip.onclick();
    return !!chip;
  }
  function cats() { return q("#cmp-cats").children.map((c) => String(c.innerHTML || c.textContent)); }
  function pickCat(part) {
    const c = q("#cmp-cats").children.filter((x) => String(x.innerHTML || x.textContent).indexOf(part) >= 0)[0];
    if (c) c.onclick();
    return !!c;
  }
  return { hasCol, sum, bar, bodyHtml, pickMonth, cats, pickCat };
}

(async () => {
  const p = await run();

  console.log("三、默认最新月 2026-03：只摆这个月有图的列");
  ok(p.hasCol("rank:month"), "上新节奏 2026-03 有 3 张，应出列");
  ok(p.hasCol("ch:shein"), "S 专区 2026-03 有 2 张，应出列");
  ok(!p.hasCol("ch:pinterest"), "P 专区 2026-03 没有图，整列不出现");
  ok(!p.hasCol("ch:tiktok"), "T 专区 2026-03 没有图，整列不出现");
  ok(!/月份：|下面是它全部/.test(p.bodyHtml()), "页面上不应再出现「用别的月份顶替」的提示");
  ok(!/p1\.jpg|t1\.jpg/.test(p.bodyHtml()), "2026-01 的图不得出现在 2026-03 的对比里");

  console.log("四、筛选与菜单只反映当月");
  ok(/2 列对比/.test(p.sum()), "摘要应写实际 2 列（实际：" + p.sum() + "）");
  ok(!/其它月份/.test(p.sum()), "摘要不应再引导去看别的月份");
  const menu = p.cats();
  ok(menu.some((t) => t.indexOf("营装") >= 0), "左侧类目菜单应有「营装」");
  ok(!menu.some((t) => t.indexOf("服装、鞋靴和珠宝饰品") >= 0),
    "全路径名不应在菜单里单独占一条");

  console.log("五、选「营装」：全路径那条也算同一类目");
  ok(p.pickCat("营装"), "应能选中「营装」");
  ok(p.bodyHtml().indexOf("s2.jpg") >= 0,
    "写成平台全路径的那张图（末段含营装）必须算进「营装」，否则这一列会假空");
  ok(p.bodyHtml().indexOf("r1.jpg") >= 0, "上新节奏那边的图也应留着");
  ok(p.bodyHtml().indexOf("p1.jpg") < 0, "别的月份的图仍不得混进来");

  console.log("六、切到「全部月份」：各月分开摆，不合并计算");
  p.pickMonth("全部月份");
  ok(p.hasCol("ch:pinterest") && p.hasCol("ch:tiktok"), "全部月份下 P / T 应出列");
  ok(/p1\.jpg/.test(p.bodyHtml()) && /t1\.jpg/.test(p.bodyHtml()), "全部月份下应看到 01 月的图");

  console.log("七、反向用例：写回「当月没图就换成全部」必须被抓住");
  /* 旧版是「列内兜底 + 有图判定宽松」两处配合才让别的月份的图露出来，两处一起还原 */
  const BAD = SRC
    .replace(
      'if (!state.month) return { list: list };\n    return { list: list.filter(function (r) { return r.month === state.month; }) };',
      'if (!state.month) return { list: list };\n    var inm = list.filter(function (r) { return r.month === state.month; });\n    return { list: inm.length ? inm : list };'
    )
    .replace(
      'return all.some(function (r) { return r.month === state.month; });',
      'return true;'
    );
  ok(BAD !== SRC, "反向用例构造成功（能替换掉严格过滤的实现）");
  /* 真跑那份带兜底的版本：2026-03 下应看到只有 01 月才有的图 —— 正是用户看到的「误解」 */
  const badRun = await run(BAD);
  const goodRun = await run();
  ok(badRun.bodyHtml().indexOf("p1.jpg") >= 0,
    "反向用例：带兜底的实现会把 01 月的图摆进 03 月的对比里（证明本用例抓得住该缺陷）");
  ok(goodRun.bodyHtml().indexOf("p1.jpg") < 0,
    "当前实现不得出现同样的行为（同一份数据、同一操作）");

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})();
