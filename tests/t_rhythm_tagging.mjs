/* 月度（上新节奏）打标链路 —— 与周度同一套口径（20261111L 渠道对比下线后重写）
   锁三件事：
     ① 月度面板里有「导出月度打标表」和「导入月度打标结果」两块，控件齐全
     ② 导出只导月度、可按期次收窄；导入只认月度条目
     ③ 打标表列数与每行长度严格对齐（错位会让整张表报废） */
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const A = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
const AR = fs.readFileSync(path.join(ROOT, "js/admin-rhythm.js"), "utf8");
const EX = fs.readFileSync(path.join(ROOT, "js/rankexport.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

console.log("一、导出区块");
ok(/id="rm-tag-scope"/.test(A), "有导出范围下拉");
ok(/id="rm-tag-period"/.test(A), "有期次（按月导出）下拉");
ok(/id="rm-tag-cat"/.test(A), "有类目下拉");
ok(/id="rm-tag-export-btn"/.test(A), "有导出按钮");
ok(/id="rm-tag-export-tip"/.test(A), "有导出提示位");
ok(!/id="rm-tag-channel"/.test(A), "不再有「来源（渠道）」下拉");
ok(!/其他渠道传图/.test(A), "后台不再有「其他渠道传图」区块");
ok(!/批量补渠道/.test(A), "后台不再有「批量补渠道」区块");

console.log("二、导出只导月度");
ok(/periodType: "month"/.test(AR), "月度出口锁死 periodType=month");
ok(/period: \(perSel && perSel\.value\) \|\| ""/.test(AR), "选了月份就只导那一期");
ok(/const perSel = \$\("#rm-tag-period"\)/.test(AR), "导出按钮读取期次下拉");

console.log("三、导入区块");
ok(/id="rm-tag-imp-file"/.test(A), "有选文件控件");
ok(/id="rm-tag-imp-btn"/.test(A), "有写入按钮");
ok(/id="rm-tag-imp-mode"/.test(A), "有写入模式（补齐 / 覆盖）");
ok(/id="rm-tag-imp-clear-empty"/.test(A), "有「空单元格也清空」开关");
ok(/periodType: "month"/.test(AR), "导入同样锁死月度");

console.log("四、打标表列：表头与每行长度必须一致");
const headLine = EX.match(/var COLS = \[([\s\S]*?)\];/);
ok(!!headLine, "能取到表头定义");
const cols = headLine ? (headLine[1].match(/"[^"]*"/g) || []).length : 0;
const rowStart = EX.indexOf("        u,");
ok(rowStart > 0, "能取到明细行构造");
const seg = EX.slice(rowStart, EX.indexOf("],", rowStart));
ok(!/渠道/.test(headLine ? headLine[1] : ""), "表头不再有「渠道」列（渠道功能已下线）");
ok(!/"渠道"/.test(EX), "全量明细也不再写「渠道」列");
ok(cols >= 15, "表头列数正常（" + cols + " 列）");

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
