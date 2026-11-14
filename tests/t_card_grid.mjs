/* 20261114C · 「各专区一行展示多少张」与趋势上升榜同一套算法 · 自检
 *
 * 口径（用户明确要求）：参考趋势上升榜做图片展示 ——
 *   对比列越少（每列越宽），每行摆的图越多；列越多，每行越少，图不被压小。
 * 做法：算法只有一份（common.js CardGrid）= 列宽 ÷ 目标卡宽（130px），
 *       结果写进 --card-cols；渠道对比按每列实测宽度写 --rk-r。
 *
 * 本自检不靠「看起来对不对」：
 *   1) 把算法真抽出来跑，断言各宽度档位张数；
 *   2) 断言「同一总宽、列数越少 → 每行越多」这个核心结论；
 *   3) 反向断言：规则退回固定 4 张 / 渠道对比退回写死表 必须失败。
 */
import fs from "fs";
import path from "path";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const ROOT = process.cwd();
const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
const common = fs.readFileSync(path.join(ROOT, "js/common.js"), "utf8");
const compare = fs.readFileSync(path.join(ROOT, "js/compare-front.js"), "utf8");

/* ---------- 1 变量本身 ---------- */
const r0 = css.indexOf(":root");
const rootBlock = css.slice(r0, css.indexOf("}", r0));
ok(/--card-cols-base:\s*4/.test(rootBlock), ":root 保留 --card-cols-base 兜底值");
ok(/--card-gap:\s*6px/.test(rootBlock), ":root 里 --card-gap 为 6px（与榜单对比池一致）");

/* ---------- 2 汇总规则存在，且覆盖全部图墙 ---------- */
const WALLS = [
  [".grid", "视觉专区 / SHEIN / Pinterest"],
  ["#mv-body", "品牌动向"],
  [".fv-grid", "我的收藏"],
  [".trend-grid", "趋势专区"],
  [".recruit-grid", "招品回品"],
  [".bestseller-grid", "BESTSELLER"],
  [".mk-grid", "营销日历"],
];
const ruleStart = css.lastIndexOf("全站图墙「每行张数」统一");
ok(ruleStart > 0, "样式里存在「每行张数统一」规则块");
const ctrlMark = css.indexOf("「图幅（图片展示大小）」控件");
const ruleSeg = ruleStart > 0 ? css.slice(ruleStart, ctrlMark > ruleStart ? ctrlMark : undefined) : "";
ok(/repeat\(var\(--card-cols/.test(ruleSeg), "统一规则用 --card-cols 决定列数");
WALLS.forEach(([sel, name]) => {
  ok(ruleSeg.indexOf(sel) >= 0, "统一规则覆盖 " + sel + "（" + name + "）");
});

/* ---------- 3 规则排在原有网格定义与媒体查询之后 ---------- */
WALLS.forEach(([sel, name]) => {
  const first = css.indexOf(sel);
  ok(first >= 0 && first < ruleStart, sel + " 原有定义在统一规则之前（" + name + "）");
});
ok(ruleStart > css.lastIndexOf("@media"), "统一规则位于所有媒体查询之后");

/* ---------- 4 后台不受影响 ---------- */
const ruleLines = ruleSeg.split("\n").filter(l => l.indexOf("{") >= 0 && /[.#][\w-]/.test(l));
ok(ruleLines.filter(l => l.indexOf("body.front") < 0).length === 0,
  "统一规则全部限定在前台 body.front，后台图墙不受影响");

/* ---------- 5 真跑算法 ---------- */
const cStart = common.indexOf("var GAP =");
const cEnd = common.indexOf("function paint()");
ok(cStart > 0 && cEnd > cStart, "common.js 里能定位到算法常量与 cols() 纯函数");
const cols = new Function(common.slice(cStart, cEnd) + "\nreturn cols;")();

ok(/SIZE_TARGET = \{ s: 70, m: 130, l: 220 \}/.test(common), "三档目标卡宽与榜单一致（70 / 130 / 220）");
ok(/SIZE_TARGET = \{ s: 70, m: 130, l: 220 \}/.test(
  fs.readFileSync(path.join(ROOT, "js/rank.js"), "utf8")), "榜单中档确为 130px（两处必须一致）");

/* ---------- 6 各宽度下的张数（由「列宽 ÷ 136」四舍五入得出，人工可核） ---------- */
const CASES = [[1920, 14], [1440, 11], [1280, 9], [1024, 8], [900, 7],
               [700, 5], [600, 4], [480, 4], [380, 3], [320, 2]];
CASES.forEach(([w, want]) => {
  ok(cols(w, "m") === want, w + "px 宽（中档）一行 " + want + " 张，实际 " + cols(w, "m"));
});

/* ---------- 7 核心结论：同一总宽下，列数越少 → 每行越多 ---------- */
function forColumns(totalW, n) {
  const colW = (totalW - (n - 1) * 10) / n - 22;   /* 与渠道对比 fitPools 同口径 */
  return cols(colW);
}
[1400, 1600, 1920].forEach((W) => {
  const seq = [1, 2, 3, 4, 5].map(n => forColumns(W, n));
  let mono = true;
  for (let i = 1; i < seq.length; i++) if (seq[i] > seq[i - 1]) mono = false;
  ok(mono, W + "px 总宽：列数 1→5 时每行张数单调不增（实际 " + seq.join(" / ") + "）");
  ok(seq[0] > seq[seq.length - 1], W + "px 总宽：单列明显多于 5 列（" + seq[0] + " vs " + seq[seq.length - 1] + "）");
});

/* ---------- 8 全宽下单列确实「摆得更多」（这是本次要解决的问题） ---------- */
ok(cols(1440) >= 8, "1440px 单列至少 8 张（上一版固定 4 张，图片太大、展示太少）");
ok(cols(1920) >= 10, "1920px 单列至少 10 张");

/* ---------- 9 边界 ---------- */
ok(cols(0) === 0, "容器未排版（宽 0）时不写列数");
ok(cols(1, "m") === 1, "极窄容器至少 1 张");
ok(cols(20000, "m") <= 40, "超宽屏有上限，不会一行铺几十张");
let nonDec = true;
for (let w = 100; w <= 4000; w += 10) if (cols(w, "m") < cols(w - 10, "m")) nonDec = false;
ok(nonDec, "张数随宽度单调不减（不会出现「拉宽窗口图反而变少」）");

/* ---------- 9b 20261114F · 三档图幅：小 > 中 > 大，且每档都能用 ---------- */
[1160, 1440, 1920].forEach(w => {
  const sN = cols(w, "s"), mN = cols(w, "m"), lN = cols(w, "l");
  ok(sN > mN && mN > lN, w + "px：小 > 中 > 大（" + sN + " / " + mN + " / " + lN + "）");
});
ok(cols(1160, "s") >= 12, "1160px（视觉专区宽度）小档至少 12 张，实际 " + cols(1160, "s"));
ok(/var DEFAULT_SIZE = "s"/.test(common), "默认图幅为「小」：打开就是一行能看更多图");

/* ---------- 10 渠道对比：多列时也走同一套算法 ---------- */
ok(/CardGrid/.test(compare), "渠道对比使用公共算法（CardGrid）");
ok(/cg\.cols\(colW\)/.test(compare), "渠道对比按列宽 × 目标卡宽反推张数");
ok(/function fitPools\(/.test(compare), "渠道对比渲染后按实测列宽校正");
ok(/addEventListener\("resize", fitPoolsSoon\)/.test(compare), "渠道对比跟随窗口尺寸重算");
ok(!/if \(n <= 2\) return 4;/.test(compare), "渠道对比已删掉写死的「n<=2 就是 4 张」表");

/* ---------- 11 接入：所有前台页面都加载了公共脚本 ---------- */
const PAGES = ["index.html", "rank.html", "rhythm.html", "compare.html", "shein.html",
  "pinterest.html", "movement.html", "fav.html", "trends.html", "marketing.html"];
PAGES.forEach(p => {
  const f = path.join(ROOT, p);
  ok(fs.existsSync(f), "页面存在：" + p);
  if (!fs.existsSync(f)) return;
  ok(/js\/common\.js\?v=/.test(fs.readFileSync(f, "utf8")), p + " 引入了统一算法（common.js，带版本号）");
});

/* ---------- 12 反向验证 ---------- */
ok(!/body\.front \.trend-grid\s*\{[^}]*minmax/.test(ruleSeg), "统一规则里没有残留 minmax() 硬编码");
ok(!/body\.front \.grid\s*\{[^}]*minmax/.test(ruleSeg), "视觉专区也没有残留 minmax() 硬编码");

/* ---------- 13 版本戳 ---------- */
ok(/\d{8}[A-Z]{1,3}/.test(css), "样式里带版本戳");
ok(/\d{8}[A-Z]{1,3}/.test(common), "公共脚本带版本戳");

console.log("\n每行张数自检：" + pass + " 通过，" + fail + " 失败");
if (fail) process.exit(1);
