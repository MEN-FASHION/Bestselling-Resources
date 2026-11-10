/* 「其他渠道传图」的打标链路回归 —— 20261109B
   渠道图虽然没环比，但后期照样要打标。这里锁住：
     ① 打标表里能分出来源（新增「渠道」列），且列数与每行长度严格对齐（错位=整表报废）
     ② 能只导某个渠道 / 只导渠道图 / 只导榜单图（导出去只填这一批）
     ③ 后台「其他渠道传图」有一键导出入口，且导出区下拉会自动带上渠道名
     ④ 回填与前台展示都只认图片地址，渠道图不需要站点或环比也能打标、也能看到标签 */
import fs from "fs";
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };
const R = (p) => fs.readFileSync(p, "utf8");

const EX = R("js/rankexport.js");
const A = R("admin.html");
const AR = R("js/admin-rhythm.js");
const AJ = R("js/admin-rank.js");
const IMP = R("js/admin-rankimport.js");
const Y = R("js/rhythm.js");
const S = R("js/supabase.js");

console.log("一、打标表能分出来源");
ok("打标表表头有「渠道」列", /"出现期次", "站点", "渠道", "最优位次"/.test(EX));
ok("全量明细表头也有「渠道」列", /\["期次类型", "期次", "类目", "站点", "渠道", "叶子类目"/.test(EX));
ok("聚合图片时收集渠道名", /if \(r\.channel\) hit\.channels\[r\.channel\] = 1;/.test(EX));
ok("渠道列宽度单独设置（不挤成一坨）", /if \(h === "渠道"\) return \{ wch: 14 \};/.test(EX));
ok("详情行写入渠道值", /r\.category \|\| "", r\.site \|\| "", r\.channel \|\| "",/.test(EX));

console.log("二、能按来源单独导出");
ok("有渠道筛选函数", /function hitChannel\(h, sel\)/.test(EX));
ok("「仅榜单图」= 没有渠道的那些", /if \(v === "__rank"\) return chs\.length === 0;/.test(EX));
ok("「仅渠道图」= 有渠道的那些", /if \(v === "__chonly"\) return chs\.length > 0;/.test(EX));
ok("「某个渠道」按名字精确匹配", /if \(v\.indexOf\("ch:"\) === 0\) return !!h\.channels\[v\.slice\(3\)\];/.test(EX));
ok("导出时真的用上了渠道筛选", /if \(!hitChannel\(h, o\.channel\)\) return;/.test(EX));
ok("导出选项从页面读渠道", /channel: \(function \(\) \{ var ch = q\("#rank-export-channel"\);/.test(EX));
ok("buildBook 的 opts 注释带上 channel 与 periodType",
  /opts: \{ scope:'todo'\|'partial'\|'done'\|'all', category:'', keyword:'', channel:'', periodType:'', title:'' \}/.test(EX));

console.log("三、后台入口");
ok("导出区有「来源」下拉", /id="rank-export-channel"/.test(A));
ok("下拉含「全部 / 仅榜单 / 仅渠道」三档", /仅榜单表格导入的图/.test(A) && /仅其他渠道传的图（全部渠道）/.test(A));
ok("进入趋势上升榜面板时自动填渠道名", /names = await SB\.listRankChannelNames\(\)/.test(AJ) && /仅渠道：/.test(AJ));
ok("「其他渠道传图」里有导出按钮", /id="rm-ch-tag-export"/.test(A));
ok("导出按钮把当前渠道筛选带进导出选项", /channel: fch \? \("ch:" \+ fch\) : "__chonly",/.test(AR));
ok("导出按钮把当前类目也带上", /category: fcat,/.test(AR));
ok("导出默认只导未打标的图", /scope: "todo",\s*\n?\s*category: fcat,/.test(AR));
ok("面板文案说明「可先传图后打标」", /图传完可以先不打标/.test(A));

console.log("四、回填与前台只认图片地址");
ok("回填按「图片URL」列匹配（不需要站点/环比）", /var iUrl = headers\.indexOf\("图片URL"\);/.test(IMP));
ok("回填前核对图片是否在库里（渠道图也在 rank_items）", /SB\.listRankItems\(\{ cols: "image_url" \}\)/.test(IMP));
ok("回填写的是 rank_image_tags（与榜单同一张表）", /image_url: rec\.url,/.test(IMP));
ok("前台取标签按图片地址批量读", /var urls = \(items \|\| \[\]\)\.map\(function \(it\) \{ return it\.image_url; \}\)\.filter\(Boolean\);/.test(Y));
ok("前台没有按站点过滤标签（渠道图站点为空也能显示）", !/listImageTags[^(]*\(\{[\s\S]{0,80}site/.test(Y));
ok("取标签接口以 image_url 为键", /async listRankTagRows\(urls\)/.test(S));

console.log("五、实跑：打标表列不错位");
/* 用假的 XLSX 接住 aoa，直接跑真实的 buildBook */
let captured = [];
global.XLSX = {
  utils: {
    aoa_to_sheet: (aoa) => ({ aoa }),
    book_new: () => ({ sheets: [] }),
    book_append_sheet: (wb, ws, name) => { wb.sheets.push({ name, ws }); },
  },
};
let lib = null;
try {
  const code = EX;   /* 整份文件执行：首行注释 + IIFE 原样跑，window/document 用参数顶替 */
  const w = { RankExport: null, RANK_VISUAL_ENUM: {}, APP_ENUM: {}, RK_ENUM_READY: true };
  const fn = new Function("window", "document", "XLSX", code + "\n; return window.RankExport;");
  lib = fn(w, { addEventListener() {} }, global.XLSX);
} catch (e) { lib = null; }
ok("导出模块可独立执行", !!lib && typeof lib.buildBook === "function");

if (lib) {
  const detail = [
    { image_url: "u-rank", category: "男装", site: "美国", period_type: "month", period_label: "2026-09", ratio: 12.5, abs_delta: 300, rank_ratio: 3, leaf_category: "男装,上衣,T恤" },
    { image_url: "u-pin", category: "男装", site: "", channel: "Pinterest", period_type: "month", period_label: "2026-09", ratio: null, abs_delta: null, leaf_category: "男装,上衣,T恤" },
    { image_url: "u-shein", category: "男装", site: "", channel: "SHEIN", period_type: "month", period_label: "2026-09", ratio: null, abs_delta: null, leaf_category: "男装,上衣,T恤" },
  ];
  const book = (opt) => { const r = lib.buildBook(detail, {}, opt); return r.wb.sheets; };
  const all = book({ scope: "all" });
  const head = all[0].ws.aoa[0], rows = all[0].ws.aoa.slice(1);
  ok("每行长度与表头一致（不错位）", rows.every((r) => r.length === head.length));
  const iCh = head.indexOf("渠道"), iSite = head.indexOf("站点"), iUrl = head.indexOf("图片URL");
  ok("渠道列表头存在", iCh > 0);
  const byUrl = {}; rows.forEach((r) => { byUrl[r[iUrl]] = r; });
  ok("渠道图的渠道列写着自己渠道", byUrl["u-pin"][iCh] === "Pinterest" && byUrl["u-shein"][iCh] === "SHEIN");
  ok("榜单图的渠道列为空", byUrl["u-rank"][iCh] === "");
  ok("榜单图的站点列仍有值", byUrl["u-rank"][iSite] === "美国");
  ok("渠道图站点列为空但仍在表里", byUrl["u-pin"][iSite] === "" && !!byUrl["u-pin"]);

  const onlyCh = book({ scope: "all", channel: "__chonly" })[0].ws.aoa.slice(1);
  ok("只导渠道图时不含榜单图", onlyCh.length === 2 && onlyCh.every((r) => r[iUrl] !== "u-rank"));
  const oneCh = book({ scope: "all", channel: "ch:SHEIN" })[0].ws.aoa.slice(1);
  ok("只导某个渠道时只剩那一张", oneCh.length === 1 && oneCh[0][iUrl] === "u-shein");
  const onlyRank = book({ scope: "all", channel: "__rank" })[0].ws.aoa.slice(1);
  ok("只导榜单图时不含渠道图", onlyRank.length === 1 && onlyRank[0][iUrl] === "u-rank");

  const det = all[1].ws.aoa;
  ok("全量明细表头也带渠道", det[0].indexOf("渠道") >= 0);
  ok("全量明细每行长度与表头一致", det.slice(1).every((r) => r.length === det[0].length));
  const dCh = det[0].indexOf("渠道");
  ok("全量明细里渠道图带着渠道名", det.slice(1).some((r) => r[dCh] === "Pinterest"));
  ok("没有环比时明细里环比列为空（不写 0）", det.slice(1).filter((r) => r[det[0].indexOf("图片URL")] === "u-pin")[0][det[0].indexOf("环比比例%")] === "");
}

console.log("六、月度面板自带导出入口");
ok("上新节奏面板有独立的「导出月度打标表」区块", /h4>导出月度打标表/.test(A));
ok("区块控件齐全（范围 / 类目 / 来源 / 按钮 / 提示）",
  ["rm-tag-scope", "rm-tag-cat", "rm-tag-channel", "rm-tag-export-btn", "rm-tag-export-tip"].every((i) => A.indexOf('id="' + i + '"') >= 0));
ok("导出只导月度（periodType=month）", /periodType: "month", title: "上新节奏"/.test(AR));
ok("导出提示落在月度面板自己的位置", /tipSelector: "#rm-tag-export-tip"/.test(AR) && /o\.tipSelector \|\| "#rank-export-tip"/.test(EX));
ok("导出结果会回传数量与文件名", /return \{ ok: true, images: pack\.images, stats: pack\.stats, filename: name \};/.test(EX));
ok("没有可导出的图时说清是哪一类为 0", /按当前范围没有可导出的图（月度共 /.test(AR));
ok("月度导出下拉会铺类目与渠道名", /async function fillTagExportSelects\(\)/.test(AR) && /fillTagExportSelects/.test(AR));
ok("进入面板时一并刷新导出下拉", /await fillTagExportSelects\(\);/.test(AR));
ok("渠道区块的导出也走月度出口（不再借用周度面板的按钮）", /runMonthTagExport\(te, \{/.test(AR) && !/selCh\.value = "ch:" \+ fch/.test(AR));

console.log("七、实跑：期次类型过滤真的生效");
if (lib) {
  const detail = [
    { image_url: "w1", category: "男装", site: "美国", period_type: "week", period_label: "2026-W41", ratio: 5, abs_delta: 10 },
    { image_url: "m1", category: "男装", site: "美国", period_type: "month", period_label: "2026-09", ratio: 6, abs_delta: 11 },
    { image_url: "c1", category: "男装", site: "", channel: "Pinterest", period_type: "month", period_label: "2026-09" },
  ];
  const onlyMonth = lib.buildBook(detail, {}, { scope: "all", periodType: "month" }).wb.sheets[0].ws.aoa.slice(1);
  const urls = onlyMonth.map((r) => r[0]);
  ok("只要月度的图（周度那张被排除）", urls.indexOf("m1") >= 0 && urls.indexOf("w1") < 0);
  ok("月度的渠道图也在里面", urls.indexOf("c1") >= 0);
  const onlyWeek = lib.buildBook(detail, {}, { scope: "all", periodType: "week" }).wb.sheets[0].ws.aoa.slice(1);
  ok("只要周度时不含月度", onlyWeek.map((r) => r[0]).join(",") === "w1");
  const allTypes = lib.buildBook(detail, {}, { scope: "all" }).wb.sheets[0].ws.aoa.slice(1);
  ok("不传类型时保持原样（全部）", allTypes.length === 3);
  const monthCh = lib.buildBook(detail, {}, { scope: "all", periodType: "month", channel: "__chonly" }).wb.sheets[0].ws.aoa.slice(1);
  ok("月度 + 仅渠道 两个条件能叠加", monthCh.length === 1 && monthCh[0][0] === "c1");
  ok("导出后不清空原数组（可重复导出）", detail.length === 3);
}

console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
