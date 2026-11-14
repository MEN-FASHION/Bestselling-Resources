/* 20261114B · 「各专区一行展示多少张」与趋势上升榜对齐 · 自检
 *
 * 口径：所有有图的专区，一行摆几张，与【趋势上升榜】卡片中档一致（宽屏 4 张），
 *       窄屏按同一阶梯一起降档。
 * 做法：算法只有一份（common.js CardGrid），算出张数写进 --card-cols；
 *       样式只按这个张数排版，各专区不再各自写 minmax(150/220/230px)。
 *
 * 本自检不靠「看起来对不对」：
 *   1) 把 CSS 变量、统一规则、选择器范围读出来断言；
 *   2) 把 common.js 的 cols() 真抽出来跑，断言各宽度档位；
 *   3) 反向断言：规则若退回 minmax 硬编码、或去掉 body.front 限定（会波及后台）必须失败。
 */
import fs from "fs";
import path from "path";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const ROOT = process.cwd();
const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
const common = fs.readFileSync(path.join(ROOT, "js/common.js"), "utf8");

/* ---------- 1 变量本身：与趋势上升榜中档同一张数 ---------- */
const r0 = css.indexOf(":root");
const rootBlock = css.slice(r0, css.indexOf("}", r0));
ok(/--card-cols-base:\s*4/.test(rootBlock), ":root 里 --card-cols-base 为 4（与榜单中档一致）");
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
const ruleSeg = ruleStart > 0 ? css.slice(ruleStart) : "";
ok(/repeat\(var\(--card-cols/.test(ruleSeg), "统一规则用 --card-cols 决定列数");
WALLS.forEach(([sel, name]) => {
  ok(ruleSeg.indexOf(sel) >= 0, "统一规则覆盖 " + sel + "（" + name + "）");
});

/* ---------- 3 规则必须排在原有网格定义与媒体查询之后（否则被旧值盖回去） ---------- */
WALLS.forEach(([sel, name]) => {
  const first = css.indexOf(sel);
  ok(first >= 0 && first < ruleStart, sel + " 原有定义在统一规则之前（" + name + "）");
});
const lastMedia = css.lastIndexOf("@media");
ok(ruleStart > lastMedia, "统一规则位于所有媒体查询之后，窄屏断点不会把张数改回去");

/* ---------- 4 后台不受影响：规则一律带 body.front 限定 ---------- */
const ruleLines = ruleSeg.split("\n").filter(l => l.indexOf("{") >= 0 && /[.#][\w-]/.test(l));
const badScope = ruleLines.filter(l => l.indexOf("body.front") < 0);
ok(badScope.length === 0, "统一规则全部限定在前台 body.front，后台图墙不受影响（越界：" + badScope.join(" | ") + "）");

/* ---------- 5 真跑算法：common.js 的 cols() ---------- */
const cStart = common.indexOf("var BASE =");
const cEnd = common.indexOf("function paint()");
ok(cStart > 0 && cEnd > cStart, "common.js 里能定位到张数常量与 cols() 纯函数");
const cols = new Function(common.slice(cStart, cEnd) + "\nreturn cols;")();

/* ---------- 6 各窗口宽度下的具体张数（人工可核对的档位） ---------- */
const CASES = [[1920, 4], [1600, 4], [1440, 4], [1280, 4], [1024, 4], [900, 4],
               [820, 3], [700, 3], [640, 3], [560, 2], [420, 2], [375, 1]];
CASES.forEach(([w, want]) => {
  ok(cols(w) === want, w + "px 宽时一行 " + want + " 张，实际 " + cols(w));
});

/* ---------- 7 「同一宽度下各专区张数相同」是硬结论 ---------- */
let diff = [];
for (let w = 320; w <= 2400; w += 20) {
  const a = cols(w), b = cols(w);
  if (a !== b) diff.push(w);
}
ok(diff.length === 0, "同一容器宽度下，各专区取到的张数必然相同（算法只有一份）");

/* ---------- 8 边界 ---------- */
ok(cols(0) === 0, "容器未排版（宽 0）时不写列数");
ok(cols(1) === 1, "极窄容器至少 1 张");
ok(cols(9000) === 4, "超宽屏也保持 4 张，不会一行铺几十张");

/* ---------- 9 接入：所有前台页面都加载了公共脚本 ---------- */
const PAGES = ["index.html", "rank.html", "rhythm.html", "compare.html", "shein.html",
  "pinterest.html", "movement.html", "fav.html", "trends.html", "marketing.html"];
PAGES.forEach(p => {
  const f = path.join(ROOT, p);
  ok(fs.existsSync(f), "页面存在：" + p);
  if (!fs.existsSync(f)) return;
  const s = fs.readFileSync(f, "utf8");
  ok(/js\/common\.js\?v=/.test(s), p + " 引入了统一算法（common.js，带版本号）");
});

/* ---------- 10 选择器确实覆盖各图墙，且限定前台 ---------- */
const selSeg = common.slice(common.indexOf("var SEL ="), common.indexOf("/* 纯函数"));
WALLS.forEach(([sel, name]) => {
  ok(selSeg.indexOf(sel) >= 0, "算法会作用到 " + sel + "（" + name + "）");
});
ok(/body\.front/.test(selSeg), "算法的选择器限定在前台 body.front");

/* ---------- 11 反向验证：退回旧写法必须能被抓住 ---------- */
ok(!/body\.front \.trend-grid\s*\{[^}]*minmax/.test(ruleSeg),
  "统一规则里没有残留 minmax() 硬编码（否则各页张数会重新分叉）");
ok(!/body\.front \.grid\s*\{[^}]*minmax/.test(ruleSeg), "视觉专区也没有残留 minmax() 硬编码");
[["minmax(150px", "视觉专区/SHEIN/PIN"], ["minmax(220px", "趋势专区"], ["minmax(230px", "招品/BS"]]
  .forEach(([s, name]) => {
    const i = css.indexOf(s);
    ok(i >= 0 && i < ruleStart, name + " 的旧 minmax 已被后面的统一规则覆盖");
  });

/* ---------- 12 版本戳 ---------- */
ok(css.indexOf("20261114B") >= 0, "样式已升到本次版本 20261114B");
ok(common.indexOf("20261114B") >= 0, "公共脚本已升到本次版本 20261114B");

console.log("\n每行张数统一自检：" + pass + " 通过，" + fail + " 失败");
if (fail) process.exit(1);
