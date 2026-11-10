/* 20261111F · 传图仍失败的最后一环：页面跑的是旧脚本 / 写入带了库里没有的列 */
import fs from "node:fs";
const R = (p) => fs.readFileSync(p, "utf8");
const SB = R("js/supabase.js"), AD = R("js/admin-rhythm.js"), H = R("admin.html");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

console.log("一、写入不再带标题列（这张表可能没有该列，一带就整条被拒）");
ok(!/title: String\(it\.file\.name \|\| ""\)/.test(SB), "渠道传图不再写 title");
ok(/channel_upload_no_title|不再写 title/.test(SB), "代码里注明原因");

console.log("二、页面能自己报出版本，便于判断是不是旧缓存");
ok(/var BUILD = "20261111F";/.test(AD), "后台脚本带版本常量");
ok(/rm-ch-ver/.test(H), "页面上有版本显示位");
ok(/el\.textContent = "脚本版本 "/.test(AD), "会把版本写进页面");
ok(/脚本版本 " \+ BUILD.*Ctrl\+F5/.test(AD), "失败提示里也带版本");

console.log("三、版本号已整体升级");
["admin.html", "rhythm.html", "rank.html"].forEach((p) => {
  ok(/v=20261111F/.test(R(p)), p + " 引用 20261111F");
});
ok(/supabase\.js\?v=20261111F/.test(H), "数据层脚本版本同步");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
