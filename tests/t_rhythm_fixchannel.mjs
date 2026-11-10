/* 「传表时忘了选渠道」的补救链路 —— 20261109D
   锁住四件事：
     ① 后台有「批量补渠道」区块，控件齐全且脚本真的绑了事件（点了不会没反应）
     ② 只按「月份 + 类目」整片改 channel，不新增不删图，且只动月度
     ③ 「只改尚未设渠道的」能正确处理 null 与空串两种存法（少一种就漏一半）
     ④ 补完会刷新渠道清单与导出下拉，立刻能在渠道对比里看到
*/
import fs from "fs";
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };
const R = (p) => fs.readFileSync(p, "utf8");

const A = R("admin.html");
const AR = R("js/admin-rhythm.js");
const S = R("js/supabase.js");

console.log("一、界面");
ok("有「批量补渠道」区块", /h4>批量补渠道/.test(A));
["rm-fixch-month", "rm-fixch-cat", "rm-fixch-channel", "rm-fixch-onlyempty",
 "rm-fixch-preview", "rm-fixch-apply", "rm-fixch-clear", "rm-fixch-tip"].forEach((id) => {
  ok("控件存在：" + id, A.indexOf('id="' + id + '"') >= 0);
});
ok("说明里讲清「只改已有条目、不新增不删图」", /只改库里已有的条目，不新增、不删图/.test(A));
ok("说明里讲清「留空=清空归属」", /清空归属/.test(A));
ok("默认勾着「只改尚未设渠道的」", /id="rm-fixch-onlyempty" type="checkbox" checked/.test(A));

console.log("二、事件真的绑了");
ok("预览按钮有绑定", /if \(fcpv\) fcpv\.onclick/.test(AR));
ok("补上渠道按钮有绑定", /applyFixChannel\("set"\)/.test(AR));
ok("清空归属按钮有绑定", /applyFixChannel\("clear"\)/.test(AR));
ok("执行前有二次确认（不会点一下就动几百条）", /if \(!confirm\("即将"/.test(AR));
ok("确认文案带范围与是否覆盖", /\\n范围：/.test(AR) && /包含已有渠道的条目（会被覆盖）/.test(AR));
ok("没选月份时拦下", /请先选月份/.test(AR));
ok("补渠道必须填渠道名", /请填写要补的渠道名/.test(AR));
ok("月份下拉只列月度期次", /\.filter\(\(p\) => p && p\.type === "month" && p\.label\)/.test(AR));
ok("月份下拉按时间倒序", /sort\(\(a, b\) => admPeriodKey\(b\) - admPeriodKey\(a\)\)/.test(AR));
ok("批次行有「设渠道」快捷入口", /textContent = "设渠道"/.test(AR));
ok("快捷入口只填表单、不直接改数据", /不直接改数据/.test(AR) && /已带入：月度/.test(AR));
ok("补完后刷新渠道清单 / 列表 / 导出下拉",
  /await loadChChannels\(\);\s*\n\s*await loadChList\(\);\s*\n\s*await fillTagExportSelects\(\)/.test(AR));

console.log("三、数据接口");
ok("有统计接口", /async countRankItemsChannelSlot\(f\)/.test(S));
ok("有写入接口", /async setRankItemsChannelSlot\(f, channel\)/.test(S));
ok("固定只改月度（period_type=month）", /_rankSlotQ\(f\)[\s\S]{0,200}eq\("period_type", o\.periodType \|\| "month"\)/.test(S));
ok("按月份收窄", /if \(o\.periodLabel\) q = q\.eq\("period_label"/.test(S));
ok("按类目收窄（留空=全部类目）", /if \(o\.category\) q = q\.eq\("category"/.test(S));
ok("只动 channel 列，不改别的字段", /update\(\{ channel: v \}, \{ count: "exact" \}\)/.test(S));
ok("只改尚未设渠道时覆盖 null", /q = \(emptyKind === "null"\) \? q\.is\("channel", null\) : q\.eq\("channel", ""\)/.test(S));
ok("只改尚未设渠道时也覆盖空串", /n \+= await run\("empty"\);/.test(S) && /n \+= await run\("null"\);/.test(S));
ok("统计接口同样处理两种空值", /async countRankItemsChannelSlot\(f\)[\s\S]{0,600}await run\("empty"\)/.test(S));
ok("请空渠道返回条数", /return count \|\| 0;/.test(S));

console.log("四、清空归属的语义");
ok("清空 = 写空字符串（前台按「没有渠道」处理）", /const v = String\(channel == null \? "" : channel\)\.trim\(\);/.test(S));
ok("前台渠道列只认非空 channel", /neq\("channel", ""\)/.test(S));
ok("前台对比按 channel 分组（空值归本站榜单）", /channelColumns|channelMode/.test(R("js/rhythm.js")));

console.log("五、文档");
const F = R("FILES.md");
ok("FILES.md 记了批量补渠道", /批量补渠道/.test(F));

console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
