/* t_rank_source.mjs — 三个专区的数据域隔离（趋势上升榜 / 上新节奏 / 标题组词台）
   用户诉求：上传时就隔开，"不然太容易出错"。
   口径：写进哪个域就只有那个域能看到；清空、查重、撤销也只在同域内进行。 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log("FAIL: " + m); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SB = read("js/supabase.js");
const ADM = read("js/admin-rank.js");
const RHM = read("js/admin-rhythm.js");
const RANK = read("js/rank.js");
const RHY = read("js/rhythm.js");
const TTL = read("js/titlelab.js");
const HTML = read("admin.html");

/* ---------- 1. 底层：按域过滤的能力存在 ---------- */
ok(/async rankSourceColumn\(\)/.test(SB), "应能探测 source 列是否存在");
ok(/_srcCond\(q, src\)/.test(SB), "应有统一的按域条件构造");
ok(/source\.eq\.rank,source\.is\.null/.test(SB),
  "rank 域必须收「source=rank」和「source 为空」两种，否则历史数据会消失");
ok(/if \(f\.source && _srcOk\) q = this\._srcCond\(q, f\.source\)/.test(SB),
  "listRankItems 必须支持按域过滤");
ok(/src && srcOk \? this\._srcCond\(q, src\)/.test(SB) || /_srcCond\(q, src\)/.test(SB),
  "同类条件应复用 _srcCond");

/* 清空 / 查重 / 删除也必须限定域，否则导 title 会清掉 rank 的同槽位数据 */
const fn = (name) => {
  const i = SB.indexOf("async " + name + "(");
  if (i < 0) return "";
  const j = SB.indexOf("\n    },", i);
  return SB.slice(i, j > 0 ? j : i + 4000);
};
["clearRankSlot", "listRankSlotUrls", "deleteRankItemsByScope"].forEach((n) => {
  const body = fn(n);
  ok(body.length > 0, n + " 应存在");
  ok(/source/.test(body) && /_srcCond\(q, src\)/.test(body), n + " 必须按数据域限定");
});

ok(/async createRankBatch\(b\)[\s\S]{0,400}if \(b\.source\) payload\.source = b\.source/.test(SB),
  "建批次时必须写入 source");
ok(/rankFacetsBySource\(src, periodType\)/.test(SB),
  "应能按域取筛选项（类目 / 期次 / 站点）");
ok(/if \(src === "rank" \? !\(bs === "" \|\| bs === "rank"\) : bs !== src\) return;/.test(SB),
  "按域取筛选项时，rank 域要收空 source，其它域只认自己");
ok(/async listRankBatches\(source\)[\s\S]{0,600}withSrc/.test(SB),
  "台账读取要按域过滤，且只在有 source 列时才带它，缺列自动退回");
ok(/want === "rank" \? \(s === "" \|\| s === "rank"\) : s === want/.test(SB),
  "台账过滤：rank 域收空 source，其它域只认自己");

/* ---------- 2. 后台导入：每个面板只写自己那一个域 ----------
   20261113C：设计改为「一个专区一个面板」，不再在趋势上升榜的导入区里选数据域 ——
   下拉能选，就有人会选错，然后又是一次脏数据。 */
ok(!/id="rank-import-source"/.test(HTML), "导入区不应再有「数据域」下拉（三个专区各有自己的面板）");
ok(/const SOURCE = "rank";/.test(ADM), "趋势上升榜面板必须固定写 rank 域，不能可配");
ok(/SB\.listRankBatches\(SOURCE\)/.test(ADM), "趋势上升榜台账只读本域");
ok(/id="titlelab-card"/.test(HTML), "后台应有独立的「标题组词台」面板");
ok(/<a class="nav-item" data-target="titlelab-card">/.test(HTML), "侧栏应有「标题组词台」入口");
ok(/enterTiPanel\(\)/.test(read("js/admin.js")), "进入面板时要拉起它自己的数据");

ok(/sites: g\.slotSites, source: SOURCE \}/.test(ADM), "清空槽位要带域");
ok(/max: 60000, source: SOURCE/.test(ADM), "留底读取要带域（只留本域的底）");
ok(/site: batchSite, source: SOURCE \}/.test(ADM), "批次要记域");
ok(/batch_id: batchId, source: SOURCE \}/.test(ADM), "条目要记域");
ok(/source: o\.source \|\| "rank"/.test(ADM), "行对象要带域，缺省 rank");
ok(/undoGroups\.push\(\{[^}]*source: SOURCE/.test(ADM), "撤销记录要带域");
ok(/source: g\.source \|\| info\.source \|\| ""/.test(ADM) || /source: SOURCE/.test(ADM), "撤销只清本域");
ok(/只作用于本专区（趋势上升榜）/.test(ADM), "类目清理要说明它只影响本专区");
ok(!/作用于全部三个专区/.test(ADM), "类目清理不能再声称影响全部专区");
ok(/SB\.deleteRankCategory\(c\.category, SOURCE\)/.test(ADM), "类目删除要带本域");
ok(/SB\.renameRankCategory\(c\.category, target, SOURCE\)/.test(ADM), "类目合并要带本域");
ok(/SB\.deleteRankCategory\(c, SOURCE\)/.test(ADM), "批量类目删除要带本域");

/* 上新节奏自己那条链路 */
ok(/source: "rhythm" \}/.test(RHM), "上新节奏导入的清空槽位要带 rhythm 域");
ok(/site: batchSite, source: "rhythm" \}/.test(RHM), "上新节奏批次要记 rhythm");
ok(/batch_id: batchId, source: "rhythm" \}/.test(RHM), "上新节奏条目要记 rhythm");

/* ---------- 3. 前台三页各读各的 ---------- */
ok(/source: "rank" \}/.test(RANK), "趋势上升榜取数必须带 source=rank");
ok(/source: "rhythm" \}/.test(RHY), "上新节奏取数必须带 source=rhythm");
ok(/source: "title"/.test(TTL), "标题组词台取数必须带 source=title");
ok(/rankFacetsBySource\("rank", "week"\)/.test(RANK), "榜单筛选项按 rank 域取");
ok(/rankFacetsBySource\("rhythm", PTYPE\)/.test(RHY), "上新节奏筛选项按其域取");
ok(/rankFacetsBySource\("title", "week"\)/.test(TTL), "组词台筛选项按 title 域取");

/* 三处都不能再直接用「全库筛选项」——那会让另一域的类目冒出来 */
ok(!/FACETS = \(typeof SBX\.rankFacetsByType/.test(RANK), "榜单不应再退回全库筛选项");
ok(!/f = \(typeof SBX\.rankFacetsByType/.test(TTL), "组词台不应再退回全库筛选项");

/* 台账要标出这批属于哪个专区 */
ok(/上新节奏/.test(ADM) && /标题组词台/.test(ADM) && /趋势上升榜/.test(ADM),
  "台账行应标出所属专区");

/* ---------- 4. 版本戳 ---------- */
const BUILD = (RHY.match(/var BUILD = "([^"]+)"/) || [])[1];
ok(!!BUILD, "前台 BUILD 应有值，实际 " + BUILD);
/* 以代码里的 BUILD 为准，不写死版本号（写死会在每次发版时误报失败） */
["index.html", "rank.html", "rhythm.html", "titlelab.html", "admin.html"].forEach((f) => {
  const t = read(f);
  ok(t.includes("?v=" + BUILD), f + " 版本戳应与 BUILD 一致（" + BUILD + "）");
});

console.log("\n=== t_rank_source: " + pass + " pass / " + fail + " fail ===");
process.exit(fail ? 1 : 0);
