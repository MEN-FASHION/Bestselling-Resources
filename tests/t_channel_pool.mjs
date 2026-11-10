/* 20261111H · 重做：榜单 + 其他渠道图在同一个对比池里并排 */
import fs from "node:fs";
const R = (p) => fs.readFileSync(p, "utf8");
const SB = R("js/supabase.js"), RHY = R("js/rhythm.js");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

console.log("一、渠道图独立读取，不再共享榜单筛选条件");
ok(/async listRankChannelPics\(opts\)/.test(SB), "数据层有专用接口");
ok(/select\("\*"\)\.eq\("period_type", PT\)/.test(SB), "按期次类型取，不叠加国家/期次精确条件");
ok(/await this\.applyChannelMap\(rows\)/.test(SB), "读出后再合并渠道归属");
ok(/if \(!ch\) return false;/.test(SB), "只保留有渠道的条目");
ok(/this\._sameMonth\(r\.period_label, lb\)/.test(SB), "月份按年月比对，写法不同也认");

console.log("二、前台把两批合并后统一分组");
ok(/var fBoard = Object\.assign\(\{\}, filter\);/.test(RHY), "榜单走原路");
ok(/await SBX\.listRankChannelPics\(\{/.test(RHY), "渠道单独取");
ok(/CH_STAT = \{ board: \(rBoard \|\| \[\]\)\.length/.test(RHY), "记录两批张数");
ok(/delete fBoard\.channelMode;/.test(RHY), "榜单查询不再带渠道条件");

console.log("三、页面上能看到「到底取到了多少」");
ok(/榜单 ' \+ CH_STAT\.board \+ ' 张 · 其他渠道 ' \+ CH_STAT\.channel/.test(RHY), "徽标显示两批张数");
ok(/渠道图取到了但没成列/.test(RHY), "有渠道图却不成列时给出明确提示");

console.log("四、写入统一月份写法");
ok(/_normMonth\(label\) \{/.test(SB), "有月份归一函数");
ok(/it\.periodLabel = this\._normMonth\(it\.periodLabel\)/.test(SB), "传图写入前归一");
ok(/o\.period_label = this\._normMonth\(patch\.period_label\)/.test(SB), "单张改月份也归一");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
