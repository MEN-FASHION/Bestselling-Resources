/* 「上新节奏 · 渠道对比 + 其他渠道传图」回归 —— 20261109A
   锁住三件事：
     ① 渠道雷达独立专区确实下线了（页面/脚本/样式/导航/权限/专区定义都不再引用）
     ② 前台第四种模式「横向 · 渠道对比」的存在与口径（榜单列优先、渠道最多 4 列、不出版位标签）
     ③ 后台「其他渠道传图」只写渠道图（channel 非空、site 空、period_type=month），
        且 channel 列不存在时能降级，不会把整页数据搞空 */
import fs from "fs";
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };
const has = (p) => fs.existsSync(p);
const R = (p) => fs.readFileSync(p, "utf8");

const Y = R("js/rhythm.js");
const S = R("js/supabase.js");
const A = R("admin.html");
const AR = R("js/admin-rhythm.js");
const CFG = R("js/config.js");
const PERM = R("js/admin-perm.js");
const AJ = R("js/admin.js");
const CMN = R("js/common.js");
const CSS = R("css/style.css");
const FILES = R("FILES.md");
const SQL = R("sql/patch_20261109A_rank_channel.sql");

console.log("一、渠道雷达已下线");
ok("前台页面 channel.html 已删除", !has("channel.html"));
ok("前台脚本 channel-front.js 已删除", !has("js/channel-front.js"));
ok("后台脚本 admin-channel.js 已删除", !has("js/admin-channel.js"));
ok("样式 channel.css 已删除", !has("css/channel.css"));
const allHtml = fs.readdirSync(".").filter((f) => f.endsWith(".html"));
ok("没有任何页面再引用渠道雷达资源", allHtml.every((f) => {
  const h = R(f);
  return !/channel\.html|channel-front\.js|admin-channel\.js|css\/channel\.css/.test(h);
}));
ok("后台面板 channel-card 已移除", !/channel-card/.test(A) && !/channel-card/.test(AJ));
ok("权限清单不再有「渠道雷达」", !/渠道雷达/.test(PERM) && !/渠道雷达/.test(CFG) && !/渠道雷达/.test(AJ));
ok("前台专区入口不再有渠道雷达", !/渠道雷达/.test(CFG));
ok("历史专区定义里的 channel 被过滤（不留 404 死链）", /GONE\s*=\s*\{\s*channel:\s*1\s*\}/.test(S));
ok("数据层不再保留渠道字典/图片/设置三表的读写", !/channel_sites|channel_items|channel_settings/.test(S));
ok("FILES.md 不再列 channel.html / css/channel.css", !/`channel\.html`/.test(FILES) && !/`css\/channel\.css`/.test(FILES));

console.log("二、前台「横向 · 渠道对比」");
ok("模式变量声明含 s（渠道）", /var MODE = "v";\s*\/\/[^\n]*s=渠道/.test(Y));
ok("筛选面板有渠道对比入口", /chip\("s", "横向 · 渠道对比"/.test(Y));
ok("顶部模式条也有渠道对比", /data-mode="s">横向 · 渠道对比/.test(Y));
ok("地址栏恢复支持 mode=s", /_m === "h" \|\| _m === "v" \|\| _m === "c" \|\| _m === "s"/.test(Y));
ok("列口径函数：榜单固定第一列", /var CH_BASE = "榜单"/.test(Y) && /\(cnt\[CH_BASE\] \? \[CH_BASE\] : \[\]\)\.concat\(chans\)/.test(Y));
ok("渠道列最多 4 个（再多每列只剩一条缝）", /\.slice\(0, 4\)/.test(Y));
ok("渠道列按图数降序（同一批里谁多谁靠前）", /\(cnt\[b\] - cnt\[a\]\)/.test(Y));
ok("渠道模式不吃国家筛选", /if \(MODE === "s"\) return \[\];/.test(Y));
ok("渠道模式不按国家预取类目", /MODE === "c" \|\| MODE === "s"\)\s*return;/.test(Y));
ok("取数分两批：榜单（channel 空）+ 渠道（channel 非空）", /channelMode: "exclude"/.test(Y) && /channelMode: "only"/.test(Y));
ok("渠道模式取数据带 channel 列", /REL_COLS \+ ",channel"/.test(Y));
ok("渠道模式不出版位标签（渠道图没有环比可比）", /MODE === "s"\) \{[\s\S]{0,260}ONLY = "off";\s*MOVE = "off";/.test(Y));
ok("体征按渠道分列统计", /return channelColumns\(inS2\)\.map/.test(Y));
ok("体征文案口径改为「渠道」", /noun: "渠道"/.test(Y));
ok("空态明确指向后台传图入口", /先到后台「上新节奏 → 其他渠道传图」传一批/.test(Y));
ok("天眼支持渠道模式", /return \{ sites: \[\], periods: activePeriods\(\), chMode: true \}/.test(Y));
ok("卡片角标在无趋势标签时显示渠道名", /rk-badge-ch/.test(Y) && /rk-badge-ch/.test(CSS));
ok("渠道模式不渲染列拖动把手（拖动只服务类目对比）", !/poolHtml\(ch, metaS, list\.length, cardsS, opts\.noFoot \? null : Math\.min\(limit, list\.length\), \{ dragKey: ch \}\)/.test(Y));

console.log("三、后台「其他渠道传图」");
const chIds = [...new Set([...A.matchAll(/id="(rm-ch-[a-z-]+)"/g)].map((m) => m[1]))];
ok("后台有独立的渠道传图区块", /h4>其他渠道传图/.test(A));
ok("必备控件齐全（月份/渠道/类目/拖放/待传/上传/进度/筛选/列表）",
  ["rm-ch-month", "rm-ch-channel", "rm-ch-cat", "rm-ch-drop", "rm-ch-file", "rm-ch-pending",
    "rm-ch-upload", "rm-ch-progress", "rm-ch-filter-ch", "rm-ch-filter-cat", "rm-ch-list"].every((i) => chIds.indexOf(i) >= 0));
const used = [...new Set([...AR.matchAll(/\$\("#(rm-ch-[a-z-]+)"\)/g)].map((m) => m[1]))];
ok("脚本引用的元素 id 都真实存在（否则按钮点了没反应）", used.every((i) => chIds.indexOf(i) >= 0));
ok("月份默认当月、与榜单上传分开记", /if \(mEl && !mEl\.value\)[\s\S]{0,160}mEl\.value = now\.getFullYear\(\)/.test(AR));
ok("拖拽与点选都能进待传", /addEventListener\("drop"/.test(AR) && /pick\.onclick = \(\) => file\.click\(\)/.test(AR));
ok("待传可单张移出", /data-chrm/.test(AR) && /rmChPending\.splice/.test(AR));
ok("上传前校验月份/渠道/类目", /请先选月份/.test(AR) && /请先填渠道名/.test(AR) && /请先选类目/.test(AR));
ok("上传有进度条并逐张串行", /uploadRankChannelImages\(rmChPending/.test(AR) && /setPct/.test(AR));
ok("失败张数单独提示，不整批报废", /有 " \+ res\.failed\.length \+ " 张没传上去/.test(AR));
ok("已传列表可改渠道 / 改类目月份 / 删除", /data-chact="channel"/.test(AR) && /data-chact="slot"/.test(AR) && /data-chact="del"/.test(AR));
ok("进入面板时一并加载渠道清单与列表", /await loadChChannels\(\);\s*fillChCatSelects\(\);\s*await loadChList\(\);/.test(AR));

console.log("四、数据口径（关键：渠道图不能污染榜单）");
ok("写入时 channel 必填、site 一律为空", /channel: it\.channel,[\s\S]{0,120}site: "",\s*\n?\s*channel/.test(S) || /site: "",\s*\n\s*channel: it\.channel/.test(S));
ok("写入 period_type 固定 month", /period_type: "month",\s*\n\s*period_label: it\.periodLabel/.test(S));
ok("渠道图不写环比（ratio / abs_delta 为 null）", /ratio: null,\s*\n\s*abs_delta: null/.test(S));
ok("单张失败不影响整批", /failed\.push\(\{ name: \(it\.file && it\.file\.name\) \|\| "", reason/.test(S));
ok("批量上传按进度回调", /typeof onProgress === "function"/.test(S));
ok("列表只读 channel 非空的记录", /from\("rank_items"\)\s*\n\s*\.select\("id,period_type,period_label,category,channel,image_url,title,created_at"\)\s*\n\s*\.neq\("channel", ""\)/.test(S));
ok("可以改渠道 / 类目 / 月份", /async updateRankChannelItem\(id, patch\)/.test(S) && /o\.channel = String\(patch\.channel\)\.trim\(\)/.test(S));
ok("可以单张删除", /async deleteRankChannelItem\(id\)/.test(S));
ok("榜单取数支持 channelMode 三态", /if \(chMode === "only"\) q = q\.neq\("channel", ""\)/.test(S) && /else if \(chMode === "exclude"\) q = q\.eq\("channel", ""\)/.test(S));
ok("channel 列缺失时自动去掉条件重取（不整页空白）", /if \(res\.error && chMode\) \{ chMode = ""; res = await build/.test(S));
ok("列白名单降级仍保留", /if \(res\.error && useSlim\(\)\)/.test(S) && /COLS_REJECTED = true/.test(S));
ok("旧专区的数据接口已彻底移除", !/(listChannelSites|addChannelSite|listChannelItems|saveChannelTags|getChannelTagVisibility|setChannelTagVisibility)/.test(S));

console.log("五、SQL 补丁与版本");
ok("补丁文件随包交付", has("sql/patch_20261109A_rank_channel.sql"));
ok("加列幂等", /alter table rank_items add column if not exists channel text not null default ''/.test(SQL));
ok("建索引幂等", /create index if not exists idx_rank_items_channel/.test(SQL));
ok("索引口径 = 期次+类目+渠道", /\(period_type, period_label, category, channel\)/.test(SQL));
const vers = [...new Set(allHtml.flatMap((f) => [...R(f).matchAll(/v=(2026\d{4}[A-Z])/g)].map((m) => m[1])))];
ok("所有页面版本号统一（本次 20261109E）", vers.length === 1 && vers[0] === "20261109E");

console.log("六、列口径实跑（直接执行真实函数）");
let chLib = null;
try {
  const src = Y.slice(Y.indexOf('var CH_BASE = "榜单";'), Y.indexOf('function activeSites()'));
  chLib = new Function(src + "; return { chOf: chOf, channelColumns: channelColumns };")();
} catch (e) { chLib = null; }
ok("列口径函数可独立执行", !!chLib);
if (chLib) {
  const it = (ch) => ({ channel: ch, image_url: "u" + Math.random() });
  ok("榜单列固定排第一", JSON.stringify(chLib.channelColumns([it(""), it("Pinterest")])) === JSON.stringify(["榜单", "Pinterest"]));
  ok("没有榜单数据时不出「榜单」空列", JSON.stringify(chLib.channelColumns([it("Pinterest"), it("SHEIN")])).indexOf("榜单") < 0);
  const many = [it("")].concat(["A", "B", "C", "D", "E"].map((c) => it(c))).concat([it("E")]);
  const cols = chLib.channelColumns(many);
  ok("渠道最多 4 列", cols.length === 5 && cols[0] === "榜单");
  ok("按图数多的排前面", cols[1] === "E");
  ok("空数据不出列", JSON.stringify(chLib.channelColumns([])) === "[]");
  ok("渠道名前后空格不影响分列", chLib.chOf({ channel: "  SHEIN  " }) === "SHEIN");
  ok("没有 channel 字段的老榜单条目归到「榜单」", chLib.chOf({ image_url: "x" }) === "榜单");
}

console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
