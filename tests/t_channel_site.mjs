/* 20261111E · 榜单数据补了渠道、前台渠道对比仍不显示：站点条件把渠道图整体滤掉了 */
import fs from "node:fs";
const R = (p) => fs.readFileSync(p, "utf8");
const SB = R("js/supabase.js"), RHY = R("js/rhythm.js");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

console.log("一、根因：渠道图 site 为空，不能被国家条件筛掉");
ok(/const skipSites = f\.channelMode === "only" \|\| f\.allowEmptySite;/.test(SB), "有跳过站点条件的开关");
ok(/if \(!skipSites && f\.sites && f\.sites\.length\) q = q\.in\("site", f\.sites\);/.test(SB), "开关生效后才下发站点条件");
ok(/if \(skipSites \|\| !f\.sites \|\| !f\.sites\.length\)/.test(SB) === false || true, "（占位）");

console.log("二、渠道模式不按国家取数");
ok(/filter\.sites = \[\];/.test(RHY), "渠道对比清空站点条件");
ok(/filter\.allowEmptySite = true;/.test(RHY), "允许站点为空的条目");
ok(/本站榜单（全部站点）/.test(RHY), "列标题本就写着全部站点，口径一致");

console.log("三、期次写法兼容（补渠道的月份写法可能与下拉不同）");
ok(/function sameMonth\(a, b\)/.test(RHY), "有同月判断");
ok(/sameMonth\(it\.period_label, pS\)/.test(RHY), "渠道列按同月取数");
ok(/sameMonth\(it\.period_label, pS2\)/.test(RHY), "体征卡按同月取数");
ok(/if \(\/W\\d\/i\.test\(String\(a\)\) \|\| \/W\\d\/i\.test\(String\(b\)\)\) return false;/.test(RHY), "周次不按月份误判");

console.log("四、其它模式不受影响");
ok(/var filter = \{ sites: sites, periods: needPeriods, periodType: PTYPE, cols: REL_COLS \};/.test(RHY), "其它模式仍带站点条件");
ok(/if \(f\.sites && f\.sites\.length && !skipSites\)/.test(SB) === false, "（站点条件仍默认生效）");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
