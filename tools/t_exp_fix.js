/* 20261103F：三处体验问题
   ① 图案款"先暴露后隐藏"：标签没到就先把列表渲染出来了
   ② 切类目 / 报告慢：数据只缓存一个组合、报告收着也算全量
   ③ 大图标签面板的「视觉 · 背景」整组不出（面板读错了字段）
   本测试锁住这三处的行为，避免以后回退。 */
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
const fakeWin = { __RANK_TEST__: true, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), APP_ENUM: {} };
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
const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8");
vm.runInContext(SRC, ctx, { filename: "rank.js" });
const T = fakeWin.__RANK_T;
ok("测试钩子已挂出", !!T);

const mk = (o) => Object.assign({
  image_url: "", category: "卫衣", site: "美国站", period_label: "2026-W43",
  _opp: false, _hot: false, _surge: false,
}, o);

/* ---------------- 1. 标签未就绪 → 不出图 ---------------- */
console.log("\n[1] 图案款不再先暴露");
/* 工程断言：renderBody 在过滤图片之前就做了就绪门控 */
ok("renderBody 里先取标签再做门控",
  /ensureTags\(CACHE\.items\);\s*\n\s*if \(PRINT_HIDE && !tagsSettled\(CACHE\.items\)\)/.test(SRC));
ok("门控未通过时直接 return，不往下渲染列表",
  /!tagsSettled\(CACHE\.items\)\) \{[\s\S]{0,400}return;/.test(SRC));
ok("门控文案说明「核对完成后才出图」", SRC.indexOf("核对完成后才出图") >= 0);

/* 行为断言：没有取数通道时视为已就绪（不能因为取不到就永远转圈） */
ok("取不到标签时不阻塞", T.tagsSettled([mk({ image_url: "x" })]) === true);

/* ---------------- 2. 多组合缓存 ---------------- */
console.log("\n[2] 切类目不再重新请求");
T.cachePut("k1", [mk({ image_url: "a" })]);
T.cachePut("k2", [mk({ image_url: "b" })]);
ok("命中缓存的组能取回", (T.cacheGet("k1") || {}).items.length === 1);
ok("两组互不干扰", T.cacheGet("k2").items[0].image_url === "b");
for (let i = 0; i < 10; i++) T.cachePut("z" + i, [mk({ image_url: "z" + i })]);
ok("超过上限淘汰最旧的（k1 已不在）", T.cacheGet("k1") === null);
ok("最近写入的仍在", !!T.cacheGet("z9"));
ok("缓存命中时不再闪「加载中」",
  /_cached\) box\.innerHTML/.test(SRC.replace(/\n/g, " ").replace(/\s+/g, " ")) || SRC.indexOf("命中缓存就别闪") >= 0);

/* ---------------- 3. 报告详情懒加载 ---------------- */
console.log("\n[3] 报告详情展开才生成");
const items = [], tags = {};
for (let i = 0; i < 6; i++) {
  items.push(mk({ image_url: "p" + i, category: i < 3 ? "卫衣" : "POLO" }));
  tags["p" + i] = {
    scene_tags: ["室外·街头·墙面栏杆"], visual_tags: ["单图满版", "模特半身"],
    craft_tags: ["刺绣"], struct_tags: ["拉链"], fit_tags: ["领型·圆领"], fabric_tags: ["纯棉（100%棉）"],
  };
}
T.set({
  facets: { sites: ["美国站"], periods: ["2026-W43"], categories: ["卫衣", "POLO"] },
  tags, groups: [], mode: "c", cat: "卫衣", cats: ["卫衣", "POLO"],
  sites: ["美国站"], periods: ["2026-W43"], cache: { key: "lazy", items },
});
const V = T.vitalsOfGroups(T.vitalsGroups());

const lazyHtml = T.vitalsHtml(V, T.vitalsDim(), { lazyDetail: true });
ok("收起态：详情块是占位", lazyHtml.indexOf('data-rep-lazy="top"') >= 0 && lazyHtml.indexOf('data-rep-lazy="bottom"') >= 0);
ok("收起态：不生成全量数据表", lazyHtml.indexOf("全量数据") < 0);
ok("收起态：不生成核心结论", lazyHtml.indexOf("核心结论") < 0);
ok("收起态：逐列画像照旧在本体里", lazyHtml.indexOf("逐列画像") >= 0);

/* 展开时填充：模拟占位节点 */
const nodes = { top: { innerHTML: "", __filled: 0, removeAttribute() {} }, bottom: { innerHTML: "", __filled: 0, removeAttribute() {} } };
const fakeBox = { querySelector: (sel) => (sel.indexOf("top") >= 0 ? nodes.top : nodes.bottom) };
T.fillRepDetail(fakeBox);
ok("展开后填充出报告头", nodes.top.innerHTML.indexOf("趋势构成分析报告") >= 0);
ok("展开后填充出全量数据表", nodes.bottom.innerHTML.indexOf("全量数据") >= 0);
ok("展开后填充出视觉背景小节（背景值来自 scene_tags）", nodes.top.innerHTML.indexOf("视觉背景") >= 0);
const once = nodes.top.innerHTML;
nodes.top.innerHTML = "SENTINEL";
/* 第二次调用不应重算（__filled 已置位） */
const kept = { top: nodes.top, bottom: nodes.bottom };
const box2 = { querySelector: (sel) => (sel.indexOf("top") >= 0 ? kept.top : kept.bottom) };
T.fillRepDetail(box2);
ok("已填充过的不再重算", kept.top.innerHTML === "SENTINEL");

const eager = T.vitalsHtml(V, T.vitalsDim());
ok("展开状态下仍能一次性拿到完整报告", eager.indexOf("全量数据") >= 0 && eager.indexOf("核心结论") >= 0);

/* ---------------- 4. 面板「视觉 · 背景」读 scene_tags ---------------- */
console.log("\n[4] 标签面板的背景组");
const g = T.lbTagGroups({ scene_tags: ["室外·交通工具·汽车（轿车）"], visual_tags: ["单图横版", "模特半身"] });
const bgGrp = g.filter((x) => x[0] === "视觉 · 背景")[0];
const cpGrp = g.filter((x) => x[0] === "视觉 · 构图")[0];
const sbGrp = g.filter((x) => x[0] === "视觉 · 主体")[0];
console.log("    分组：" + g.map((x) => x[0] + "=" + x[1].join("/")).join(" | "));
ok("出现「视觉 · 背景」组（以前整组不出）", !!bgGrp);
ok("背景组里是背景值（汽车）", !!bgGrp && bgGrp[1].indexOf("室外·交通工具·汽车（轿车）") >= 0);
ok("构图组不会被背景值串进去", !!cpGrp && cpGrp[1].indexOf("汽车") < 0);
ok("主体组不会被背景值串进去", !!sbGrp && sbGrp[1].indexOf("汽车") < 0);
ok("构图 / 主体仍正常显示", !!cpGrp && cpGrp[1].indexOf("单图横版") >= 0 && !!sbGrp && sbGrp[1].indexOf("模特半身") >= 0);

/* 老数据：背景混在 visual_tags 里 */
const g2 = T.lbTagGroups({ visual_tags: ["室内·客厅·电视墙", "留白构图", "单件平铺"] });
const bg2 = g2.filter((x) => x[0] === "视觉 · 背景")[0];
ok("老数据（背景在 visual_tags）也能出背景组", !!bg2 && bg2[1].indexOf("室内·客厅·电视墙") >= 0);
ok("老数据下构图值不冒充背景", !bg2 || bg2[1].indexOf("留白构图") < 0);

/* ---------------- 5. 占比索引：结果与原逻辑一致 ---------------- */
console.log("\n[5] 占比索引");
const col = { all: { craft: [["刺绣", 40, 4], ["水洗", 30, 3]] }, craft: [["刺绣", 40, 4]] };
ok("已有值取到正确占比", T.repTagPct(col, "craft", "刺绣") === 40);
ok("不存在的值给 0", T.repTagPct(col, "craft", "印花") === 0);
ok("只查 all 里的第 4 名之后的值（不回落截断表）", T.repTagPct({ all: { craft: [["a", 9, 1], ["b", 5, 1]] }, craft: [["a", 9, 1]] }, "craft", "b") === 5);

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
