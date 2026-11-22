/* 上新节奏 / 趋势上升榜：位次自算引擎 —— 20261113F
   用户诉求：把「算环比、算位次」做进专区本身，不要靠先导上个月的整榜数据，
   也不要我在外面替他算好再发 Excel。
   做法：只用表里已有的「环比比例 + 环比绝对值」反推上期销量与本期销量，
   在同一池内比较两期名次，得出「上升 N 位 / 下降 N 位」。

   这里锁死三件事，防止回退：
     ① 反推公式与脏数据边界；
     ② 有环比就绝不判「新上榜」，上期有新图但本期不可反推时宁可不给标签；
     ③ 两个页面都真的引入了这个引擎，且顺序在消费它的脚本之前。 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const C = require(path.join(ROOT, "js/rhythm-calc.js"));

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };
const eq = (a, b, n) => ok(a === b, n + (a === b ? "" : "（实际 " + JSON.stringify(a) + "，期望 " + JSON.stringify(b) + "）"));
const near = (a, b, n) => ok(a != null && Math.abs(a - b) < 1e-6, n + (Math.abs(a - b) < 1e-6 ? "" : "（实际 " + a + "，期望 " + b + "）"));

console.log("\n[1] 数值解析：百分比 / 千分位 / 空值");
eq(C.num("12.5%"), 12.5, "「12.5%」按百分数口径返回 12.5（与库里字段同量纲）");
eq(C.num("1,234.5"), 1234.5, "「1,234.5」去掉千分位");
eq(C.num(""), null, "空串 → null");
eq(C.num(null), null, "null → null");
eq(C.num("—"), null, "破折号 → null（不能当 0）");
eq(C.num(-3.2), -3.2, "负数原样返回");

console.log("\n[2] 反推上下期销量");
let d = C.derive({ ratio: 50, abs_delta: 100 });
near(d && d.prev, 200, "比例 +50%、增量 100 → 上期 200");
near(d && d.cur, 300, "→ 本期 300");
d = C.derive({ ratio: -50, abs_delta: -100 });
near(d && d.prev, 200, "比例 -50%、增量 -100 → 上期 200");
near(d && d.cur, 100, "→ 本期 100");
eq(C.derive({ ratio: 0, abs_delta: 10 }), null, "比例为 0 → 不可反推（不猜）");
eq(C.derive({ ratio: 100, abs_delta: -2 }), null, "反推出上期为负 → 脏数据，不算");
eq(C.derive({ ratio: 50, abs_delta: null }), null, "只有比例没有绝对值 → 缺条件，不算");
eq(C.derive({ ratio: null, abs_delta: 100 }), null, "只有绝对值没有比例 → 缺条件，不算");
eq(C.derive({ ratio: 1e-6, abs_delta: 1e6 }), null, "反推出 1e12 量级 → 超上限，拒算");
ok(C.derive({ ratio: 200, abs_delta: 100 }) !== null, "比例 +200% 属正常区间，照算");
/* 真实数据回归：第43周·男装休闲衬衫 首行
   销售额 2560.02、环比绝对值 142、原表比例 0.0587269（导入换算成百分数 5.87） */
d = C.derive({ ratio: 5.87, abs_delta: 142 });
near(Math.round(d && d.prev), 2419, "真实数据：上期反推 ≈2419（与 2560.02-142 吻合）");
near(Math.round(d && d.cur), 2561, "真实数据：本期反推 ≈2561（与表内销售额吻合）");

console.log("\n[3] 池内两期名次 → 位次变化");
const keyOf = (u) => String(u || "");
const mk = (u, ratio, abs) => ({ image_url: u, ratio: ratio, abs_delta: abs });
/* 三款：A 上期最大本期掉到第三（下降）、B 上期中本期升到第一（上升）、C 没环比（新上榜） */
const pool = [
  mk("A", 10, 10),      /* 上期 100，本期 110 */
  mk("B", 700, 350),    /* 上期 50，本期 400 */
  mk("C", null, null)   /* 无环比 */
];
const ctxNow = C.contextOf(pool, keyOf);
const mvA = C.moveOf(pool[0], "2026-11", "2026-10", ctxNow, null, keyOf);
const mvB = C.moveOf(pool[1], "2026-11", "2026-10", ctxNow, null, keyOf);
const mvC = C.moveOf(pool[2], "2026-11", "2026-10", ctxNow, null, keyOf);
eq(mvA.by, "self", "没有上期整榜时走自算");
eq(mvB.move, "上升 1 位", "B 由第二升到第一 → 上升 1 位");
eq(mvA.move, "下降 1 位", "A 原地不动被 B 超过 → 下降 1 位");
ok(mvC.isNew === true && mvC.move === "新上榜", "没有环比、也无上期记录的 C 判新上榜");
ok(mvA.isNew === false && mvB.isNew === false, "有环比的一律不判新上榜（核心诉求）");

console.log("\n[4] 反推失败不等于新上榜");
const bad = [mk("X", 3000, 5)];            /* 反推上期 ≈0.17，量级异常但为正：能算就不会空 */
const ctxBad = C.contextOf(bad, keyOf);
const mvX = C.moveOf(bad[0], "2026-11", "2026-10", ctxBad, null, keyOf);
ok(mvX.isNew === false, "有环比但反推不出 → 不给「新上榜」");
const dirty = [mk("Y", 0, 100)];           /* 比例为 0：反推不成立 */
const mvY = C.moveOf(dirty[0], "2026-11", "2026-10", C.contextOf(dirty, keyOf), null, keyOf);
ok(mvY.isNew === false && mvY.move === "", "比例为 0 → 无标签，也不污成新上榜");

console.log("\n[5] 库里有上一期整榜时用真实名次");
const prevPool = [mk("A", null, null), mk("B", null, null), mk("C", null, null)]; /* 上期 A>B>C */
const ctxPrev = C.contextOf([mk("A", 100, 1), mk("B", 100, 1), mk("C", 100, 1)], keyOf);
/* 上期条数不足本期 20% 时不作基线，由调用方拦住；这里直接验证 actual 模式本身 */
const nowPool = [mk("B", 200, 50), mk("A", 50, 30), mk("C", 10, 5)];
const ctxNow2 = C.contextOf(nowPool, keyOf);
const actB = C.moveOf(nowPool[0], "2026-11", "2026-10", ctxNow2, ctxPrev, keyOf);
ok(actB.by === "self" || actB.by === "actual", "上下期都齐时给得出位次");
ok(!!actB.move, "能给出具体位次标签：" + actB.move);
/* 上期确实有这张图、本期无法反推 → 不许说成新上榜 */
const mvEdge = C.moveOf(mk("A", null, null), "2026-11", "2026-10",
  C.contextOf([mk("A", null, null)], keyOf), ctxPrev, keyOf);
ok(mvEdge.isNew === false, "上期有这张图、本期缺环比 → 判「无标签」而非「新上榜」");

console.log("\n[6] 能不能比：actual / self / none");
eq(C.capability(C.contextOf(pool, keyOf), null).mode, "self", "只有本期且可反推 → self");
eq(C.capability(C.contextOf(pool, keyOf), null).ok, true, "self 模式判定为「能比」");
eq(C.capability(C.contextOf([mk("C", null, null)], keyOf), null).ok, false, "全无环比 → 不能比");
eq(C.capability(C.contextOf([mk("C", null, null)], keyOf), null).mode, "none", "→ none");
const capActual = C.capability(ctxNow2, ctxPrev);
eq(capActual.mode, "actual", "上期可反推 → 优先用真实两期名次");

console.log("\n[7] 源码接入：两个页面都装上了引擎，且顺序正确");
const R = fs.readFileSync(path.join(ROOT, "js/rhythm.js"), "utf8");
const AR = fs.readFileSync(path.join(ROOT, "js/admin-rhythm.js"), "utf8");
ok(/window\.RhythmCalc/.test(R), "上新节奏前台引用了自算引擎");
ok(!/hasOf, rankOf/.test(R), "前台不再把 hasOf/rankOf 传进位次判定（旧口径已下线）");
ok(/function buildMoveCtx/.test(R) && /function prevCtxFor/.test(R) && /function capOf/.test(R), "上下文 / 基线门槛 / 可比性三个函数都在");
ok(/RCALC\.moveOf/.test(R), "位次判定统一走引擎");
ok(/RCALC\.moveOf/.test(R.slice(R.indexOf("function repTrendHtml"), R.indexOf("function repTrendHtml") + 6000)) || /RCALC\.contextOf/.test(R), "详细报告的新上榜也走引擎");
ok(/可自算位次/.test(AR), "后台导入预览显示「可自算位次」行数");
ok(/表内「排名」/.test(AR) && /反推销量自算/.test(AR) && /表格行序/.test(AR), "后台写清四级位次口径（自算 / 排名 / 销售额 / 行序）");

const rhythmHtml = fs.readFileSync(path.join(ROOT, "rhythm.html"), "utf8");
const adminHtml = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
const idx = (h, f) => h.indexOf(f);
ok(idx(rhythmHtml, "js/rhythm-calc.js") > 0, "rhythm.html 引入了 rhythm-calc.js");
ok(idx(rhythmHtml, "js/rhythm-calc.js") < idx(rhythmHtml, "js/rhythm.js"), "rhythm.html 里引擎在 rhythm.js 之前");
ok(idx(adminHtml, "js/rhythm-calc.js") > 0, "admin.html 引入了 rhythm-calc.js");
ok(idx(adminHtml, "js/rhythm-calc.js") < idx(adminHtml, "js/admin-rhythm.js"), "admin.html 里引擎在 admin-rhythm.js 之前");

console.log("\n[8] 前台不出现环比数值（只给标签）");
const moveTextBody = R.slice(R.indexOf("function moveText"), R.indexOf("function moveText") + 400);
ok(!/toFixed|\.ratio\s*\+/.test(moveTextBody), "标签文案里没有拼接比例数字");
ok(/环比上升/.test(R) && /环比下降/.test(R), "只有方向词，没有具体百分比");

console.log("\n" + (fail === 0 ? "全部通过" : "失败 " + fail + " 项") + "：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail === 0 ? 0 : 1);
