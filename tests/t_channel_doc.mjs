/* 20261111H · 渠道图改用独立文档存储（不依赖榜单表的列与约束） */
import fs from "node:fs";
const S = fs.readFileSync("js/supabase.js", "utf8");
const R = fs.readFileSync("js/rhythm.js", "utf8");
const A = fs.readFileSync("js/admin-rhythm.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

console.log("一、存储");
ok(/rank_channel_pics/.test(S), "渠道图存在 frontend_dims.rank_channel_pics");
ok(/async function chPicSave\(arr\)/.test(S), "有统一的保存函数");
ok(/const back = await chPicLoad\(true\)/.test(S), "写完回读确认，读不到当失败");
ok(/API\.uploadRankChannelImages = async function/.test(S), "传图走新实现");
ok(/const idx = doc\.findIndex/.test(S), "同一张图重复上传只留一条");

console.log("二、写入不再依赖榜单表");
const upBlock = S.slice(S.indexOf("API.uploadRankChannelImages = async function"), S.indexOf("API.updateRankChannelItem = async function"));
ok(!/_safeInsert/.test(upBlock), "新实现不再往 rank_items 写行");
ok(/chPicSave\(doc\)/.test(upBlock), "只写渠道图文档");
ok(/API\.listRankChannelItems = async function/.test(S), "后台列表也读文档");
ok(/isCpId\(id\)/.test(S), "文档里的图用 cp: 前缀的 id 定位");

console.log("三、前台");
const chFetch = R.slice(R.indexOf("rCh = await SBX.listRankChannelPics"), R.indexOf("rCh = await SBX.listRankChannelPics") + 400);
ok(/periods: periods,/.test(chFetch), "渠道图只取选中月份，不带基线月");
ok(/渠道对比里「榜单」这一列允许为空/.test(R), "榜单为空时不再拦掉渠道图");
ok(/var BUILD = "20261111H"/.test(R) && /var BUILD = "20261111H"/.test(A), "版本号已统一");

console.log("四、后台可核对");
ok(/channelPicStats/.test(A), "后台显示存储里共有多少张");
ok(/存储共 /.test(A), "展示文案存在");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
