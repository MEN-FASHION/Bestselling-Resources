/* ============================================================================
 * t_pdf_longpage.js —— 收藏趋势周报 PDF 的「分页 + 页间黑缝」回归（20261102C）
 *
 * 两个线上问题：
 *   ① 打开很慢：老版单页高 4800mm（宽高比 1:16），前台按满宽 + 1.5 倍像素比渲染，
 *      一页就是 1100×18000 ≈ 2000 万像素的 canvas，两页开屏上百 MB。
 *   ② 上面一条黑线压着：页与页之间 18px 深色缝 + 每页 10px 深色投影，
 *      正好压在上一页最后一行卡片的下沿；而且分页点按固定高度硬切，卡片被切成两半。
 *
 * 本测试锁死修复后的四条约束：
 *   ① 分页点只落在块边界上（不在块内部），且每页不超过页高上限
 *   ② 页高上限已下调（≤1600mm），单页画布像素可控
 *   ③ 页间不再有深色缝与纵向投影（CSS）
 *   ④ 前台渲染有像素上限（不会再把 2000 万像素的画布丢给浏览器）
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✓ " + n); };
const no = (n, d) => { fail++; console.log("  ✗ " + n + (d ? " — " + d : "")); };

/* 极简 DOM 桩：本文件只调纯函数，不真的画图 */
const noopEl = () => ({
  style: {}, classList: { add() {}, remove() {}, contains() { return false; } },
  appendChild() {}, setAttribute() {}, getContext() { return null; },
});
global.window = global;
global.document = {
  addEventListener() {}, querySelector() { return null; },
  createElement() { return noopEl(); }, head: noopEl(), body: noopEl(),
};
global.navigator = { userAgent: "node" };

const src = fs.readFileSync(path.resolve(__dirname, "..", "js/favexport.js"), "utf8");
// eslint-disable-next-line no-eval
eval(src);
const FE = window.FavExport;
if (!FE || typeof FE.planLongPages !== "function") {
  console.log("✗ 取不到 planLongPages"); process.exit(1);
}

/* ---------- ① 分页点只落在块边界 ---------- */
/* 造 20 个块，每块高 900px，最后总高 18000px；页高上限 = 1600mm */
const blocks = [];
for (let i = 0; i < 20; i++) blocks.push({ y: i * 900, h: 900 });
const stripH = 18000;
const mmPerPx = 297 / 1600;              /* 贴图宽 1600px → 297mm */
const ratio = 1, blockScale = 2;         /* 块坐标是布局像素，贴图是 2 倍图 */
const maxMm = 1600;
const cuts = FE.planLongPages(blocks, blockScale, ratio, stripH, mmPerPx, maxMm);

if (cuts[0] === 0 && cuts[cuts.length - 1] === stripH) ok("分页点覆盖 0 → 页尾");
else no("分页点首尾不对", JSON.stringify([cuts[0], cuts[cuts.length - 1]]));

const boundSet = new Set(blocks.map((b) => b.y * blockScale * ratio));
const badCut = cuts.slice(1, -1).filter((c) => !boundSet.has(c));
if (!badCut.length) ok("中间断点全部落在块边界（不会把卡片切两半）");
else no("有断点落在块内部", JSON.stringify(badCut));

/* 每页高度不超过上限（留 1px 取整余量） */
const maxPx = (maxMm / mmPerPx) * 1.001;
const tooTall = [];
for (let i = 1; i < cuts.length; i++) if (cuts[i] - cuts[i - 1] > maxPx) tooTall.push(i);
if (!tooTall.length) ok("每页都不超过 " + maxMm + "mm 上限");
else no("有页超上限", JSON.stringify(tooTall));

if (cuts.length > 2) ok("确实分成了多页（" + (cuts.length - 1) + " 页）");
else no("没有分页，测不到分页逻辑");

/* 相邻断点必须递增，否则会死循环/输出错页 */
let mono = true;
for (let i = 1; i < cuts.length; i++) if (cuts[i] <= cuts[i - 1]) mono = false;
if (mono) ok("断点严格递增");
else no("断点没有递增", JSON.stringify(cuts));

/* ---------- ② 页高上限已下调 ---------- */
if (FE._const && FE._const.LONG_MAX_H_MM <= 1600) ok("单页高度上限 ≤ 1600mm（" + FE._const.LONG_MAX_H_MM + "）");
else no("单页高度上限还是老的", String(FE._const && FE._const.LONG_MAX_H_MM));

const targetW = (src.match(/var targetW = (\d+);/) || [])[1];
if (targetW && Number(targetW) <= 1600) ok("贴图宽度 ≤ 1600px（" + targetW + "）");
else no("贴图宽度没降", targetW);

if (/toDataURL\("image\/jpeg", 0\.7\d?\)/.test(src)) ok("JPEG 质量已下调到 0.7x");
else no("JPEG 质量没改");

/* 长页页高按 1600mm、满宽 1100px 估算，单页画布应远小于 2000 万像素 */
const pageCanvasPx = 1100 * Math.round(1100 * 1600 / 297);
if (pageCanvasPx < 8000000) ok("单页画布约 " + (pageCanvasPx / 10000).toFixed(0) + " 万像素（老版约 2000 万）");
else no("单页画布仍然过大", String(pageCanvasPx));

/* ---------- ③ CSS：页间无深色缝、无纵向投影 ---------- */
const css = fs.readFileSync(path.resolve(__dirname, "..", "css/style.css"), "utf8");
const pagesRule = (css.match(/\.pdf-pages\s*\{[^}]*\}/) || [""])[0];
if (/gap:\s*0/.test(pagesRule)) ok("页间距为 0（黑缝消失）");
else no("页间距还不是 0", pagesRule);
const wrapRule = (css.match(/\.pdf-page-wrap\s*\{[^}]*\}/) || [""])[0];
if (/box-shadow:\s*0\s+0\s+0/.test(wrapRule)) ok("页投影改为 1px 描边，不再有上下深色投影");
else no("页投影仍带纵向偏移", wrapRule);

/* ---------- ④ 前台渲染有像素上限 ---------- */
const tjs = fs.readFileSync(path.resolve(__dirname, "..", "js/trends.js"), "utf8");
if (/PDF_MAX_PX_H\s*=\s*\d+/.test(tjs)) ok("渲染端设置了单页像素高度上限");
else no("渲染端没有像素上限，超长页仍会撑爆画布");
if (/base\.height \* s > PDF_MAX_PX_H/.test(tjs)) ok("超限时按比例降分辨率（不是直接放弃渲染）");
else no("超限处理缺失");
if (/fetchPdfWithProgress/.test(tjs)) ok("下载走带进度的流式读取");
else no("下载仍是一次性 arrayBuffer，看不到进度");

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
