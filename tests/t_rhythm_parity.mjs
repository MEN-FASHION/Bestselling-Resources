/* 上新节奏（月度）与趋势上升榜（周度）口径一致 —— 20261111Y
   用户要求：月度整体按周度那套来，渠道对比整块下线。
   这里锁住「不能再长出第四种模式」「不能再出现渠道入口」「两页同一套脚本、同一个版本」。 */
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const R = fs.readFileSync(path.join(ROOT, "js/rhythm.js"), "utf8");
const A = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
const AR = fs.readFileSync(path.join(ROOT, "js/admin-rhythm.js"), "utf8");
const RH = fs.readFileSync(path.join(ROOT, "rhythm.html"), "utf8");
const RK = fs.readFileSync(path.join(ROOT, "rank.html"), "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

console.log("一、只剩三种对比模式");
ok(!/MODE === "s"/.test(R), "前台没有任何「渠道对比」分支");
ok(!/data-mode="s"/.test(R), "模式条没有第四种按钮");
ok(!/_m === "h" \|\| _m === "v" \|\| _m === "c" \|\| _m === "s"/.test(R), "地址参数只认 h/v/c（mode=s 不再生效）");
ok(/chip\("h", "横向 · 国家对比"/.test(R) && /chip\("v", "纵向 · 时间对比"/.test(R) && /chip\("c", "横向 · 类目对比"/.test(R), "三种模式都在");
ok(!/chColumnCount|channelColumns|CH_PICS|CH_STAT|chOf\(/.test(R), "渠道分列的整套函数已删除");

console.log("二、后台不留渠道入口");
ok(!/其他渠道传图/.test(A), "页面没有「其他渠道传图」");
ok(!/批量补渠道/.test(A), "页面没有「批量补渠道」");
ok(!/rm-ch-|rm-fixch-/.test(A), "页面上没有渠道相关控件 id");
ok(!/rm-ch-|rm-fixch-/.test(AR), "后台脚本不再引用这些控件");
ok(!/bindChannelUploader|loadChChannels|uploadChPending|applyFixChannel/.test(AR), "渠道相关函数已删除");

console.log("三、两页同一套脚本、同一个版本");
const v1 = (RH.match(/js\/rhythm\.js\?v=(\w+)/) || [])[1];
ok(v1 === "20261111Y", "月度页 rhythm.js 引用版本已升级（否则浏览器仍用旧脚本）");
ok(/js\/rank\.js\?v=20261111Y/.test(RK), "周度页 rank.js 引用版本同步升级");
const rj = fs.readFileSync(path.join(ROOT, "js/rank.js"), "utf8");
ok(!/渠道对比|listRankChannelPics|MODE === "s"/.test(rj), "周度脚本本身没有渠道对比残留");
ok(/"20261111Y"/.test(R), "前台版本常量 20261111Y");
const s1 = (RH.match(/js\/supabase\.js\?v=(\w+)/) || [])[1];
const s2 = (RK.match(/js\/supabase\.js\?v=(\w+)/) || [])[1];
ok(!!s1 && s1 === s2, "两页引用同一个数据层版本");
ok(!!s1 && s1 === "20261111Y", "数据层引用版本为 20261111Y");

console.log("四、取数口径只剩一条路");
ok((R.match(/SBX\.listRankItems\(/g) || []).length >= 1, "取数仍走统一入口");
ok(!/listRankChannelPics/.test(R), "前台不再单独取渠道图");
ok(!/allowEmptySite|channelMode/.test(R), "不再有「跳过站点 / 只看渠道」这类特殊参数");

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
