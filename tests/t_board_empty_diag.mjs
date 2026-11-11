/* 20261111X · 榜单数据不显示时的自述信息 + 不再强带 channel 列 */
import fs from "node:fs";
const R = (p) => fs.readFileSync(p, "utf8");
const RHY = R("js/rhythm.js");
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

console.log("一、查询不再依赖 channel 列");
ok("榜单查询只取渲染要用的列", !/filter\.cols = REL_COLS \+ ",channel"/.test(RHY));
ok("预取也不带 channel", !/cols: REL_COLS \+ ",channel"/.test(RHY));
ok("取数只走一套（不再有渠道分支）", !/MODE === "s"/.test(RHY));

console.log("二、空状态写出实际查询条件");
ok("空态带「查询：」前缀", /该组合下暂无榜单数据'[\s\S]{0,80}查询：/.test(RHY));
ok("三档模式都列出来", /MODE === "c" \? "类目对比"/.test(RHY) && /时间对比/.test(RHY) && /国家对比/.test(RHY));
ok("列出类目", /' · 类目 ' \+ esc\(CAT \|\| "全部"\)/.test(RHY));
ok("列出期次", /' · 期次 ' \+ esc\(\(periods \|\| \[\]\)\.join/.test(RHY));
ok("列出站点", /' · 站点 '/.test(RHY));
ok("列出条目数", /' · 条目 ' \+ \(\(CACHE && CACHE\.items\.length\) \|\| 0\)/.test(RHY));
ok("取数失败时给出原因", /LOAD_ERR \? ' · 取数失败：'/.test(RHY));
ok("带脚本版本", /' · 脚本 ' \+ esc\(BUILD\)/.test(RHY));

console.log("三、版本");
ok("前台版本 20261111X", /var BUILD = "20261111X"/.test(RHY));

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
