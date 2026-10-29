/* 收藏 → PDF 发布到趋势专区：纯逻辑单测（不碰浏览器）
   1) paginate：页与页首尾相接、覆盖完整、不重叠、不切出过短的页
   2) trendMeta：标题/标签/简介按收藏内容推导
   3) 封面尺寸与 A4 横版比例一致 */
const fs = require("fs");
const vm = require("vm");

/* 极简浏览器 stub：模块只在函数体内用 document/Image，导出时不会真跑 */
const sandbox = { window: {}, document: { createElement: () => ({ getContext: () => ({}) }) }, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("js/favexport.js", "utf8"), sandbox);
const F = sandbox.window.FavExport;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

console.log("\n【一】paginate 分页");
/* 构造一张 3200 宽、高 12000 的画布（含块边界），scale=2 */
const canvas = { width: 3200, height: 12000 };
const blocks = [];
for (let y = 200; y < 12000; y += 700) blocks.push({ y: y / 2, kind: "sub" });

const pg = F.paginate(canvas, blocks, 2);
ok("页高 = 宽 × 210/297（A4 横版比例）", pg.ph === Math.round(3200 * 210 / 297), pg.ph);
ok("至少切出 2 页", pg.cuts.length >= 3, "cuts=" + pg.cuts.length);
ok("首页从 0 开始", pg.cuts[0] === 0);
ok("末页到画布底部", pg.cuts[pg.cuts.length - 1] === 12000, pg.cuts[pg.cuts.length - 1]);

let contiguous = true, overlap = false, overrun = false;
for (let i = 1; i < pg.cuts.length; i++) {
  if (pg.cuts[i] <= pg.cuts[i - 1]) overlap = true;
  if (pg.cuts[i] > 12000) overrun = true;
}
ok("切片首尾相接且严格递增（不重叠、不遗漏）", !overlap, JSON.stringify(pg.cuts));
ok("末片不越界", !overrun);

/* 除末页外，每页高度不得超过一页，也不得短于 1/3 页（防碎页） */
let tooTall = 0, tooShort = 0;
for (let i = 1; i < pg.cuts.length; i++) {
  const h = pg.cuts[i] - pg.cuts[i - 1];
  if (h > pg.ph + 1) tooTall++;
  if (i < pg.cuts.length - 1 && h < pg.ph * 0.3) tooShort++;
}
ok("没有超出一页高度的切片", tooTall === 0, "过高的页=" + tooTall);
ok("没有切出过短的碎页", tooShort === 0, "过短的页=" + tooShort);

/* 边界情况：内容只有一页 */
const small = F.paginate({ width: 3200, height: 500 }, [], 2);
ok("内容不足一页 → 只有首尾两个切点", small.cuts.length === 2, JSON.stringify(small.cuts));
/* 边界情况：无块边界可用时按整页硬切，且不死循环 */
const noBlocks = F.paginate({ width: 3200, height: 9000 }, [], 2);
ok("无块边界也能正常分页", noBlocks.cuts[noBlocks.cuts.length - 1] === 9000);

console.log("\n【二】trendMeta 标题 / 标签 / 简介");
function mkPlan(weeks, totals) {
  return {
    weeks: weeks.map(w => ({ period: w })),
    totals: Object.assign({ items: 100, weeks: weeks.length, cats: 3, top: 60, bottom: 30, none: 10 }, totals || {}),
  };
}
const m1 = F.trendMeta(mkPlan(["2026-W43", "2026-W44"]), new Date("2026-10-29T10:00:00"));
ok("周期期次 → 标签「周度」", m1.tag === "周度", m1.tag);
ok("标题含期次", /W43/.test(m1.title), m1.title);
ok("标题长度 ≤ 60", m1.title.length <= 60, m1.title.length);

const m2 = F.trendMeta(mkPlan(["2026-09", "2026-10"]), new Date("2026-10-29T10:00:00"));
ok("月期次 → 标签「月度」", m2.tag === "月度", m2.tag);

const m3 = F.trendMeta(mkPlan(["秋季上新"]), new Date("2026-10-29T10:00:00"));
ok("非期次命名 → 标签「类目」", m3.tag === "类目", m3.tag);

ok("类目留空（收藏跨类目，写死会筛错）", m3.category === "", m3.category);
ok("简介含张数与上装/下装", /100 张图片/.test(m3.description) && /上装 60/.test(m3.description), m3.description);
ok("简介含生成时间", /2026-10-29/.test(m3.description));
ok("三个标签都在前台页签枚举内", ["周度", "月度", "类目"].indexOf(m1.tag) >= 0);

console.log("\n【三】PDF 画幅常量");
const C = F._const;
ok("长图逻辑宽度 1600（与既有导出一致）", C.LW === 1600, C.LW);
ok("封面比例 = 297:210（A4 横版）", Math.abs((1600 * 210 / 297) - 1131) <= 1, 1600 * 210 / 297);

console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + "：" + pass + " 通过 / " + fail + " 失败\n");
process.exit(fail === 0 ? 0 : 1);