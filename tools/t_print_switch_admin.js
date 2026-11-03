/* 趋势上升榜后台 · 图案印花款开关（20261103B）
   需求：这个开关除了视觉专区标签管理里有，趋势上升榜后台也要有一个。
   本测试锁四件事：
     1) 榜单后台有独立的开关区块（与标签管理那块并存）
     2) 两处读写的是同一个配置项（同一个接口），不会各说各的
     3) 面板打开时会按库里最新值渲染，不会停留在默认值
     4) 关闭状态有明确的状态说明，并且会刷新右侧预览 */
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const adminHtml = R("admin.html");
const adminRank = R("js/admin-rank.js");
const adminImg = R("js/admin-images.js");
const sb = R("js/supabase.js");

console.log("\n[1] 两处界面都在");
const rankBlock = (adminHtml.match(/<section class="rkadm-sec">\s*<h4>前台展示 · 图案印花款[\s\S]*?<\/section>/) || [])[0] || "";
ok("榜单后台有「前台展示 · 图案印花款」区块", !!rankBlock);
ok("榜单后台区块里有开关容器", /id="rank-pattern-print-switch"/.test(rankBlock));
ok("榜单后台区块里有状态说明位", /id="rank-pattern-print-note"/.test(rankBlock));
ok("视觉专区标签管理那块仍在（不是被搬走）", /id="pattern-print-switch"/.test(adminHtml));

console.log("\n[2] 同一个配置项");
ok("读写接口只定义一份", (sb.match(/async getPatternPrintVisible/g) || []).length === 1
  && (sb.match(/async setPatternPrintVisible/g) || []).length === 1);
ok("榜单后台用的是同一对接口",
  /SB\.getPatternPrintVisible\(\)/.test(adminRank) && /SB\.setPatternPrintVisible\(/.test(adminRank));
ok("标签管理用的也是同一对接口",
  /SB\.getPatternPrintVisible\(\)/.test(adminImg) && /SB\.setPatternPrintVisible\(/.test(adminImg));
ok("配置存在既有配置列的同一个键", /pattern_print_visible/.test(sb));

console.log("\n[3] 面板打开会重新读值");
ok("进入面板时加载开关", /loadRankPrintSwitch\(\)/.test(adminRank));
ok("进入面板的并行加载里带上了它",
  /Promise\.all\(\[[^\]]*loadRankPrintSwitch\(\)/.test(adminRank));
ok("批次重载后也会刷新（切完页签不会停在旧值）", (adminRank.match(/loadRankPrintSwitch\(\)/g) || []).length >= 2);
ok("读取失败退回「展示」，不会误隐藏",
  /catch \(e\) \{ rankPrintVisible = true; \}/.test(adminRank));

console.log("\n[4] 关闭后的提示与联动");
ok("关闭时写明榜单 / 统计 / 报告都不计入", /榜单列表、体征卡、覆盖率与详细报告都不再计入/.test(adminRank));
ok("关闭时说明库里数据不受影响", /库里数据不受影响/.test(adminRank));
ok("切换后刷新右侧实时预览", /setPatternPrintVisible\(next\)[\s\S]{0,200}rankPreviewRefresh\(\)/.test(adminRank));
ok("开关状态文字随值变化（展示 / 隐藏）", /on \? "展示" : "隐藏"/.test(adminRank));
ok("辅料白名单在界面上写清楚（章仔 / 织唛 / 印花标）",
  /章仔、织唛、印花标/.test(rankBlock));

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
