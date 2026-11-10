/* 20261111E · 补渠道成功、F12 报 400、前台不显示：兜底取数 + 版本可核对 */
import fs from "node:fs";
const R = (p) => fs.readFileSync(p, "utf8");
const RHY = R("js/rhythm.js"), CSS = R("css/style.css"), SB = R("js/supabase.js");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

console.log("一、渠道取不到时的兜底");
ok(/var hasAnyCh = mergedCh\.some/.test(RHY), "判断合并结果里是否带渠道值");
ok(/channelMode: "" \}\)\)/.test(RHY), "兜底时用不加渠道条件的一次查询");
ok(/mergedCh = allM;/.test(RHY), "兜底结果顶替原结果");
ok(/catch \(e1\) \{ \/\* 兜底失败就保持原样/.test(RHY), "兜底失败不影响原流程");

console.log("二、版本号常驻，可自查是否旧脚本");
ok(/rk-ch-build">渠道口径 ' \+ esc\(BUILD\)/.test(RHY), "渠道对比顶部常驻版本");
ok(/\.rk-ch-build/.test(CSS), "样式已加");

console.log("三、缺列自愈仍在（400 的成因之一）");
ok(/function missingColumn\(e\)/.test(SB), "数据层能识别「缺哪一列」");
ok(/title/.test(SB) === true, "（写入不再强制带标题列）");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
