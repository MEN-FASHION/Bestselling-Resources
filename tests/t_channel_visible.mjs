/* 20261111E · 后台补了渠道前台为什么看不到：把「前台能不能读到渠道」锁死 */
import fs from "node:fs";
const R = (p) => fs.readFileSync(p, "utf8");
const SB = R("js/supabase.js");
const RHY = R("js/rhythm.js");

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } };

console.log("一、数据层：字典归属一定合并到条目上");
ok(/async applyChannelMap\(rows\)/.test(SB), "应有 applyChannelMap");
ok(!/if \(await this\.rankChannelColumn\(\)\) return list;/.test(SB), "不应再因为「有列」就跳过字典合并（这正是前台看不到的直接原因）");
ok(/const m = await this\._chMapLoad\(\);\s*\n\s*list\.forEach/.test(SB), "无论列是否存在都要合并字典");

console.log("二、读列表时一定调用合并");
ok(/const needMap = true;/.test(SB), "listRankItems 应无条件合并字典");
ok(/await this\.applyChannelMap\(out\);/.test(SB), "确实调用了合并");

console.log("三、渠道筛选在内存里做（混存也看得全）");
ok(/let chMode = "";/.test(SB), "渠道条件不再下发给数据库");
ok(/pm === "only" \|\| ""/.test(SB) || /if \(pm === "only"\)/.test(SB), "only 口径按合后结果筛");
ok(/if \(pm === "exclude"\)/.test(SB), "exclude 口径按合后结果筛");

console.log("四、前台版本可核对（区分「没传图」与「旧脚本」）");
ok(/var BUILD = "20261111E";/.test(RHY), "前台脚本带版本号");
ok(/rk-ch-hint/.test(RHY), "单列时给出提示");
ok(/Ctrl\+F5/.test(RHY), "提示里写了强制刷新");

console.log("五、页面引用版本已升级（换 URL 才能顶掉旧缓存）");
const pages = ["rhythm.html", "rank.html", "admin.html"];
pages.forEach((p) => {
  const H = R(p);
  ok(/supabase\.js\?v=20261111E/.test(H), p + " 引用新版本 supabase.js");
});

console.log("六、补渠道确实写进了「读得到」的地方");
ok(/map\[t\.url\] = v;/.test(SB), "写入字典（按图片地址）");
ok(/await this\._chMapSave\(map\);\s*\n\s*if \(await this\.rankChannelColumn\(\)\)/.test(SB), "先存字典再尝试写列");
ok(/_chMapLoad\(true\)/.test(SB), "读写用同一份字典且读时取最新");

console.log("七、补完前台口径应能分出渠道列");
ok(/function channelColumns\(items\)/.test(RHY), "前台按 channel 建列");
ok(/var CH_BASE = "榜单";/.test(RHY), "空渠道归「榜单」列");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
