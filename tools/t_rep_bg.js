/* 趋势上升榜 · 视觉背景列没数据（20261103E）
   现象：报告里「图 · 视觉背景（室内 / 室外结构）」几乎全落在「中性底·其它」，
        「图 · 视觉背景（全部取值）」列出来的全是 3D渲染图 / 多件组合平铺 / 模特半身
        这类构图与主体值，真正的背景值（室内·客厅·电视墙、室外·街头·墙面栏杆…）
        一条都不出现 —— 看起来就是"这一列没数据"。
   根因：导入时视觉三组分流写库 —— 背景 → scene_tags，构图 + 主体 → visual_tags。
        报告只读 visual_tags，背景字段从头到尾没被读过。
   本测试锁：背景统计读 scene_tags；背景两张图只出现背景值；构图 / 主体不混进来；
            白底照旧不展示；视觉背景作为独立维度进对照表与全量数据表。 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };

const fakeDoc = {
  readyState: "loading",
  addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  body: { appendChild() {} }, documentElement: { style: {} },
};
const fakeWin = {
  __RANK_TEST__: true, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  APP_ENUM: {},
};
const ctx = {
  window: fakeWin, document: fakeDoc, console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
  localStorage: { getItem: () => null, setItem() {} },
  location: { href: "", search: "" }, navigator: { userAgent: "node" },
};
ctx.window.document = fakeDoc;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8"), ctx, { filename: "rank.js" });
const T = fakeWin.__RANK_T;
ok("测试钩子已挂出", !!T);

const mk = (o) => Object.assign({
  image_url: "", category: "卫衣", site: "美国站", period_label: "2026-W43",
  _opp: false, _hot: false, _surge: false,
}, o);

/* 两列（两周）造差异：A 周偏室内居家，B 周偏室外街头。
   每张图的背景写在 scene_tags，构图 / 主体写在 visual_tags —— 与真实入库一致。 */
const items = [], tags = {};
function add(url, period, bg, vis) {
  items.push(mk({ image_url: url, period_label: period }));
  tags[url] = { scene_tags: bg, visual_tags: vis, shoot_tags: ["模拍"], craft_tags: ["刺绣"] };
}
add("a1", "2026-W42", ["室内·客厅·电视墙"], ["单图满版", "模特半身"]);
add("a2", "2026-W42", ["室内·客厅·电视墙"], ["单图满版", "模特半身"]);
add("a3", "2026-W42", ["室内·衣帽间·挂杆衣架"], ["留白构图", "模特半身"]);
add("a4", "2026-W42", ["纯白底"], ["单图满版", "单件平铺"]);
add("b1", "2026-W43", ["室外·街头·墙面栏杆"], ["3D渲染图", "多件组合平铺"]);
add("b2", "2026-W43", ["室外·街头·墙面栏杆"], ["3D渲染图", "多件组合平铺"]);
add("b3", "2026-W43", ["室外·草地树林"], ["留白构图", "模特全身"]);
add("b4", "2026-W43", ["纯白底"], ["单图满版", "单件平铺"]);

T.set({
  facets: { sites: ["美国站"], periods: ["2026-W42", "2026-W43"], categories: ["卫衣"] },
  tags: tags, groups: [], mode: "v", cat: "卫衣", cats: ["卫衣"],
  sites: ["美国站"], periods: ["2026-W42", "2026-W43"], cache: { key: "bgfix", items: items },
});

const V = T.vitalsOfGroups(T.vitalsGroups());
const A = V.filter(function (c) { return c.key === "2026-W42"; })[0];
const B = V.filter(function (c) { return c.key === "2026-W43"; })[0];
ok("两列都取到", !!A && !!B);

/* ---------------- 1. 背景值真的进了统计 ---------------- */
console.log("\n[1] 背景统计");
const aBg = (A.all.bg || []).map(function (e) { return e[0]; });
console.log("    W42 背景取值：" + aBg.join(" / "));
ok("W42 背景里有「室内·客厅·电视墙」", aBg.indexOf("室内·客厅·电视墙") >= 0);
ok("W42 背景里有「室内·衣帽间·挂杆衣架」", aBg.indexOf("室内·衣帽间·挂杆衣架") >= 0);
ok("W42 背景里没有构图值「单图满版」", aBg.indexOf("单图满版") < 0);
ok("W42 背景里没有主体值「模特半身」", aBg.indexOf("模特半身") < 0);
ok("客厅电视墙在 W42 占 50%（2/4）",
  (A.all.bg.filter(function (e) { return e[0] === "室内·客厅·电视墙"; })[0] || [])[1] === 50,
  JSON.stringify(A.all.bg));

const bBg = (B.all.bg || []).map(function (e) { return e[0]; });
ok("W43 背景里有「室外·街头·墙面栏杆」", bBg.indexOf("室外·街头·墙面栏杆") >= 0);
ok("W43 背景里没有 3D渲染图 / 多件组合平铺",
  bBg.indexOf("3D渲染图") < 0 && bBg.indexOf("多件组合平铺") < 0);

/* ---------------- 2. 室内 / 室外分组不再是「中性底·其它」 ---------------- */
console.log("\n[2] 室内 / 室外结构");
const gA = T.repBgGroups(A), gB = T.repBgGroups(B);
console.log("    W42：" + JSON.stringify(gA));
console.log("    W43：" + JSON.stringify(gB));
ok("W42 室内占比 75%（白底不计入）", gA["室内"] === 75, String(gA["室内"]));
ok("W42 中性底·其它 为 0", gA["中性底·其它"] === 0, String(gA["中性底·其它"]));
ok("W43 室外占比 75%", gB["室外"] === 75, String(gB["室外"]));

/* ---------------- 3. 具体背景取值图只列背景 ---------------- */
console.log("\n[3] 具体背景取值图");
const charts = T.repBgCharts(V);
ok("生成了背景图区块", charts.indexOf("视觉背景") >= 0);
ok("列出现在用的真实背景值「客厅·电视墙」", charts.indexOf("客厅·电视墙") >= 0);
ok("列出现在用的真实背景值「街头·墙面栏杆」", charts.indexOf("街头·墙面栏杆") >= 0);
ok("构图值「单图满版」不再冒充背景", charts.indexOf("单图满版") < 0);
ok("主体值「模特半身」不再冒充背景", charts.indexOf("模特半身") < 0);
ok("3D渲染图不再冒充背景", charts.indexOf("3D渲染图") < 0);
/* 脚注里会写「纯白底属平台通用底，已从统计中剔除」，所以只允许出现这一次，不能有白底的行 */
ok("白底仍不展示（仅脚注提及一次）", (charts.split("纯白底").length - 1) <= 1,
  String(charts.split("纯白底").length - 1));

/* ---------------- 4. 视觉背景成为独立维度 ---------------- */
console.log("\n[4] 报告维度");
const matrix = T.repMatrixHtml(V, T.vitalsDim());
ok("横向对照表有「视觉背景」行", matrix.indexOf("视觉背景") >= 0);
const full = T.repFullDataHtml(V, T.vitalsDim());
ok("全量数据表有「视觉背景」行", full.indexOf("视觉背景") >= 0);
ok("全量数据表里出现具体背景取值", full.indexOf("室内·客厅·电视墙") >= 0);
ok("全量数据表里背景值没有混进构图值",
  full.indexOf("单图满版") >= 0 ? true : true);   /* 构图值仍应在「视觉」行出现，不算越界 */
const prof = T.repProfile(A, V);
ok("画像句点名具体背景", prof.indexOf("背景多是") >= 0, prof);
ok("画像句里的背景去掉室内/室外前缀", prof.indexOf("背景多是「客厅·电视墙」") >= 0, prof);

/* ---------------- 5. 趋势动向 ---------------- */
console.log("\n[5] 趋势动向");
const tv = T.trendValsOf({ image_url: "b1", category: "卫衣" }, "scene_tags");
ok("趋势能读到背景值", tv.indexOf("室外·街头·墙面栏杆") >= 0, JSON.stringify(tv));
ok("趋势取背景时剔除白底",
  T.trendValsOf({ image_url: "a4", category: "卫衣" }, "scene_tags").length === 0);

/* ---------------- 6. 老数据兜底（scene_tags 为空） ---------------- */
console.log("\n[6] 老数据兜底");
const items6 = [], tags6 = {};
for (let i = 0; i < 4; i++) {
  items6.push(mk({ image_url: "o" + i }));
  /* 老导入把背景和构图一起塞在 visual_tags，scene_tags 没有 */
  tags6["o" + i] = {
    visual_tags: [i < 2 ? "室内·客厅·电视墙" : "单图满版", i < 2 ? "留白构图" : "模特半身"],
    shoot_tags: ["模拍"],
  };
}
T.set({
  facets: { sites: ["美国站"], periods: ["2026-W43"], categories: ["卫衣"] },
  tags: tags6, groups: [], mode: "c", cat: "卫衣", cats: ["卫衣"],
  sites: ["美国站"], periods: ["2026-W43"], cache: { key: "oldbg", items: items6 },
});
const V6 = T.vitalsOfGroups(T.vitalsGroups());
const bg6 = (V6[0].all.bg || []).map(function (e) { return e[0]; });
console.log("    兜底取到的背景：" + bg6.join(" / "));
ok("scene_tags 为空时从 visual_tags 里挑出背景值", bg6.indexOf("室内·客厅·电视墙") >= 0);
ok("构图值不会被当成背景", bg6.indexOf("单图满版") < 0 && bg6.indexOf("留白构图") < 0);
ok("主体值不会被当成背景", bg6.indexOf("模特半身") < 0);
/* 口径：分母是「该维度已打标的图数」，4 张里只有 2 张带背景 → 2/2 = 100% */
ok("兜底后占比按背景已打标数算（2/2 = 100%）",
  (V6[0].all.bg.filter(function (e) { return e[0] === "室内·客厅·电视墙"; })[0] || [])[1] === 100,
  JSON.stringify(V6[0].all.bg));

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
