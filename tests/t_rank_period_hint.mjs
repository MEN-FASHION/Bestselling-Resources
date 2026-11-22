/* 上传带「期次」列的表格时，界面必须说清「日历可留空」以及期次取值的来源。 */
import fs from "fs";
import path from "path";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(path.join(root, "js/admin-rank.js"), "utf8");

console.log("一、期次来源要说清楚");
ok(/const perList = Object\.keys\(perSet\)/.test(src), "从表格统计期次取值");
ok(/表格自带期次：/.test(src), "提示里写出表格自带的期次");
ok(/上方日历可以留空/.test(src), "明确日历可留空");
ok(/perNorm\.length > 6/.test(src), "期次过多时截断，避免撑爆提示（归一后按去重结果截断）");
ok(/escHtml\(periodNote\)/.test(src), "期次名做了转义（防止表里的尖括号注入）");

console.log("二、期次口径要提前说明");
ok(/期次统一成「第N周」/.test(src), "明确 W45 / 45周 / 第45周 会统一成同一期，不再拆成两个");
ok(/不会覆盖上方所选/.test(src), "明确表格里的期次只作兜底，不覆盖界面所选");
ok(/以所选为准/.test(src), "界面选了期次时，提示里写明以所选为准");

console.log("三、没有破坏既有多组提示");
ok(/按期次拆成/.test(src), "多组导入提示仍在（按期次拆成 N 批）");
ok(/上方日历可以留空/.test(src), "说明日历可留空");
ok(/function renderRankPreview/.test(src), "预览函数仍在");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
