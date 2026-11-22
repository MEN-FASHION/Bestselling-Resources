/* 20261114C · 「列数减少 → 每行展示更多」实跑自检（渠道对比多列同样适用）
 *
 * 用户要求：参考趋势上升榜的图片展示 —— 对比列越少，每行摆的图越多。
 * 本自检把两条真实源码抽出来跑（不是复制一份逻辑）：
 *   · common.js 的 CardGrid.cols(w)  —— 全站唯一张数算法
 *   · compare-front.js 的 perRowOf(n, containerW) —— 渠道对比按列宽反推
 * 断言：同一总宽下，n=1..5 的张数单调不增；且单列明显多于 5 列。
 */
import fs from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const common = fs.readFileSync("js/common.js", "utf8");
const compare = fs.readFileSync("js/compare-front.js", "utf8");

/* ---------- 1 抽出真实算法 ---------- */
const cStart = common.indexOf("var GAP =");
const cEnd = common.indexOf("function paint()");
ok(cStart > 0 && cEnd > cStart, "能定位 common.js 的张数算法");
const cols = new Function(common.slice(cStart, cEnd) + "\nreturn cols;")();

const pStart = compare.indexOf("function perRowOf(");
const pEnd = compare.indexOf("/* 插入 DOM 后按每列实测宽度重算");
ok(pStart > 0 && pEnd > pStart, "能定位 compare-front.js 的 perRowOf()");
const perRowOf = new Function("state", "$", "window",
  compare.slice(pStart, pEnd) + "\nreturn perRowOf;")({ cfg: null }, () => ({ clientWidth: 0 }), { CardGrid: { cols } });

/* ---------- 2 单列满宽：明显摆得更多（上一版固定 4 张） ---------- */
ok(perRowOf(1, 1440) >= 8, "1440px 单列 ≥ 8 张，实际 " + perRowOf(1, 1440));
ok(perRowOf(1, 1920) >= 10, "1920px 单列 ≥ 10 张，实际 " + perRowOf(1, 1920));
ok(perRowOf(1, 1440) !== 4, "单列不再是固定 4 张");

/* ---------- 3 核心结论：列数越少，每行越多 ---------- */
[1280, 1440, 1600, 1920].forEach((W) => {
  const seq = [1, 2, 3, 4, 5].map((n) => perRowOf(n, W));
  let mono = true;
  for (let i = 1; i < seq.length; i++) if (seq[i] > seq[i - 1]) mono = false;
  ok(mono, W + "px：列数 1→5 每行张数单调不增（" + seq.join(" / ") + "）");
  ok(seq[0] > seq[seq.length - 1], W + "px：单列明显多于 5 列（" + seq[0] + " vs " + seq[seq.length - 1] + "）");
});

/* ---------- 4 列数与张数成反比关系（相邻两档必须能看出差别，不能塌成同一档） ---------- */
const s1440 = [1, 2, 3, 4].map((n) => perRowOf(n, 1440));
ok(s1440[0] > s1440[1] && s1440[1] > s1440[2] && s1440[2] >= s1440[3],
  "1440px 下 1→4 列逐档变少，不会出现「点了没反应」（" + s1440.join(" / ") + "）");

/* ---------- 5 后台手动指定每行张数时仍以配置为准（上限 6） ---------- */
const withCfg = new Function("state", "$", "window",
  compare.slice(pStart, pEnd) + "\nreturn perRowOf;")(
  { cfg: { perRow: 3 } }, () => ({ clientWidth: 0 }), { CardGrid: { cols } });
ok(withCfg(1, 1920) === 3, "后台指定 3 张时，1920px 单列也按 3 张（配置优先）");

/* ---------- 6 拿不到宽度时也不能崩（首屏兜底） ---------- */
const noW = new Function("state", "$", "window",
  compare.slice(pStart, pEnd) + "\nreturn perRowOf;")({ cfg: null }, () => ({ clientWidth: 0 }), { CardGrid: cols });
ok(noW(2, 0) >= 1 && noW(5, 0) >= 1, "宽度取不到时给出可用的兜底张数（不返回 0/NaN）");

console.log("\n列数↔每行张数自检：" + pass + " 通过，" + fail + " 失败");
if (fail) process.exit(1);
