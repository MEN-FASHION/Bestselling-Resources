/* 按周（按月）导出 —— 20261109H
   目的：让"全量导出撞读取上限、最新期次被截掉"这件事从根上消失 ——
   选一期只查一期，行数就是这一期的量级（几千），永远碰不到上限。
   这里锁住：
     ① 两个面板都有期次下拉，且只列自己的期次类型（周度不列月份、月度不列周次）
     ② 选中期次后取数带 periods 条件（不是取全量再过滤，否则还是会被截断）
     ③ 文件名 / 提示里带期次，导完能对上是哪一期
     ④ 不选期次时行为与之前一致（全部期次）
*/
import fs from "fs";
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };
const R = (p) => fs.readFileSync(p, "utf8");
const A = R("admin.html"), E = R("js/rankexport.js"), AR = R("js/admin-rank.js"), AH = R("js/admin-rhythm.js");

console.log("一、界面");
ok("周度导出有期次下拉", A.indexOf('id="rank-export-period"') >= 0);
ok("月度导出有月份下拉", A.indexOf('id="rm-tag-period"') >= 0);
ok("周度默认「全部期次」", /id="rank-export-period"><option value="">全部期次<\/option>/.test(A));
ok("月度默认「全部月份」", /id="rm-tag-period"><option value="">全部月份<\/option>/.test(A));
ok("说明里讲清按周导出不受上限影响", /只导这一期/.test(A) && /不受单次读取上限影响/.test(A));

console.log("二、取数真的收窄（关键）");
ok("选项读取包含 period", /period: \(function \(\) \{ var p = q\("#rank-export-period"\);/.test(E));
ok("有按需取数的封装", /async function fetchDetail\(o, maxRows\)/.test(E));
ok("选中期次时带 periods 条件", /if \(o && o\.period\) f\.periods = \[o\.period\];/.test(E));
ok("导出主流程走按需取数", /var detail = await fetchDetail\(o\);/.test(E));
ok("预览统计也走按需取数", /var detail = await fetchDetail\(opts\);/.test(E));
ok("不再直接全量取（避免又撞上限）", !/var detail = await SB\.listRankItems\(\{ max: 200000 \}\);/.test(E.split("async function exportAll")[1] || ""));
ok("进度提示写明只读这一期", /只读 " \+ o\.period \+ " 这一期/.test(E));
ok("组装阶段也按期次兜底过滤", /String\(\(r && r\.period_label\) \|\| ""\) === o\.period/.test(E));

console.log("三、结果可辨认");
ok("文件名带期次", /"\-打标表\-" \+ \(o\.period \? o\.period \+ "\-" : ""\)/.test(E));
ok("完成提示带期次", /\(o\.period \? o\.period \+ " · " : ""\)/.test(E));

console.log("四、下拉只列本类期次");
ok("周度只列 week", /\(p\.type \|\| "week"\) === "week"/.test(AR));
ok("周度期次新的在前", /admPeriodKey\(b\) - admPeriodKey\(a\)/.test(AR));
ok("周度刷新时重建下拉", /fillExportPeriods\(\);/.test(AR));
ok("月度只列 month", /p\.type === "month"/.test(AH));
ok("月度渠道区块导出也带月份", /period: fper/.test(AH));
ok("面板导出按钮读月份", /const perSel = \$\("#rm-tag-period"\)/.test(AH));

console.log("五、实跑：期次过滤的语义");
/* 假数据：两周各 3 条 + 一月 2 条 */
const rows = [
  { image_url: "a1", period_label: "2026-W44", period_type: "week", category: "X" },
  { image_url: "a2", period_label: "2026-W44", period_type: "week", category: "X" },
  { image_url: "a3", period_label: "2026-W44", period_type: "week", category: "X" },
  { image_url: "b1", period_label: "2026-W45", period_type: "week", category: "X" },
  { image_url: "b2", period_label: "2026-W45", period_type: "week", category: "X" },
  { image_url: "b3", period_label: "2026-W45", period_type: "week", category: "X" },
  { image_url: "m1", period_label: "2026-10", period_type: "month", category: "X" },
  { image_url: "m2", period_label: "2026-10", period_type: "month", category: "X" },
];
/* 复用真实 buildBook 里的两段过滤逻辑（保持同样的判定顺序） */
function pick(detail, o) {
  let d = detail;
  if (o.periodType) d = d.filter((r) => ((r && r.period_type) || "week") === o.periodType);
  if (o.period) d = d.filter((r) => String((r && r.period_label) || "") === o.period);
  return d;
}
ok("选 W45 只得到 W45 的 3 条", pick(rows, { period: "2026-W45" }).length === 3
  && pick(rows, { period: "2026-W45" }).every((r) => r.period_label === "2026-W45"));
ok("不选期次得到全部 8 条", pick(rows, {}).length === 8);
ok("月度只选月份时不含周度", pick(rows, { periodType: "month", period: "2026-10" }).length === 2);
ok("周度面板选 W45 不会带出月度图", pick(rows, { periodType: "week", period: "2026-W45" }).length === 3);
ok("期次选错（库里没有）得到空，而不是全部", pick(rows, { period: "2026-W99" }).length === 0);

console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
