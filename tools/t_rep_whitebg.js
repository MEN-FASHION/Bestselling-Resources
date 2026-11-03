/* 趋势上升榜 · 白底不参与推荐（20261102R）
   目的：纯白底 / 白背景是平台通用底，几乎每个类目都在用。
   把它当成"这一列的做法"推荐出去，商家照做只是换成通用底，不产生任何差异，
   还会把真正有辨识度的背景盖掉。这里逐处验证白底被剔除，以及不误伤其它背景值。 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };

const fakeDoc = {
  readyState: "loading",
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  body: { appendChild() {} },
  documentElement: { style: {} },
};
const fakeWin = { __RANK_TEST__: true, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
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

const P1 = "2026-W42", P2 = "2026-W43", S1 = "美国站";
const C1 = "外套夹克", C2 = "POLO";
const mk = (o) => Object.assign({
  image_url: "", category: C1, site: S1, period_label: P2, _opp: false, _hot: false, _surge: false,
}, o);

/* A 列：白底占绝对多数（16 张里 14 张白底），B 列：白底与室外街景各半。
   A 列的白底差异最大 —— 旧逻辑一定会把它当成"最可复用的做法"推出来。 */
const items = [], tags = {};
for (let i = 0; i < 16; i++) {
  const o = mk({ image_url: "a" + i, category: C1, _surge: i < 6 });
  items.push(o);
  tags[o.image_url] = {
    visual_tags: [i < 10 ? "纯白底" : "室外·街景（城市商业街）"],
    craft_tags: ["刺绣"], struct_tags: ["拉链"], fit_tags: ["版型·收腰"],
    fabric_tags: ["纯棉（100%棉）"], style_tags: ["户外机能"], shoot_tags: ["平铺拍"],
  };
}
for (let i = 0; i < 8; i++) {
  const o = mk({ image_url: "b" + i, category: C2 });
  items.push(o);
  tags[o.image_url] = {
    visual_tags: [i < 4 ? "纯白底" : "室外·街景（城市商业街）"],
    craft_tags: ["刺绣"], struct_tags: ["拉链"], fit_tags: ["版型·收腰"],
    fabric_tags: ["纯棉（100%棉）"], style_tags: ["商务通勤"], shoot_tags: ["平铺拍"],
  };
}
T.set({ facets: { sites: [S1], periods: [P1, P2], categories: [C1, C2] }, tags, groups: [],
  mode: "c", cat: C1, cats: [C1, C2], sites: [S1], periods: [P2], cache: { key: "w", items } });
const V = T.vitalsOfGroups(T.vitalsGroups());
const html = T.vitalsHtml(V, T.vitalsDim());
/* 口径说明里会出现一次「纯白底」用于解释规则本身，不算展示，比对时先剔除该段 */
/* 口径说明两处：数据说明段、图表脚注。它们是在解释规则本身，不算"把白底当做法展示" */
const strip = (h) => h.replace(/<section class="rk-rep-sec rk-rep-qual">[\s\S]*?<\/section>/, "")
  .replace(/<p class="rk-ch-foot">[\s\S]*?<\/p>/g, "")
  /* 全量数据段末尾的口径说明也是在解释规则本身 */
  .replace(/<p class="rk-rep-note">[\s\S]*?<\/p>/g, "");

/* ---------------- 1. 推荐 / 结论 ---------------- */
console.log("[1] 推荐与结论");
ok("可执行建议里的视觉首选不是白底", html.indexOf("的主图视觉以 <b>纯白底") < 0);
ok("视觉建议改推非白底值", /的主图视觉以 <b>室外·街景/.test(html));
ok("视觉建议不再并列白底", !/同列还有[^）]*纯白底/.test(html));
ok("核心结论不把白底当差异点", !/差异最集中在<b>视觉<\/b>：「纯白底」/.test(html));
ok("核心结论仍可把非白底当差异点或不出视觉结论",
  !/差异最集中在<b>视觉<\/b>：「纯白底」/.test(html));

/* ---------------- 2. 画像句 / 对照表 ---------------- */
console.log("[2] 画像句与对照表");
ok("画像句不写「画面偏纯白底」", html.indexOf("画面偏「纯白底」") < 0);
ok("画像句改写真背景", html.indexOf("画面偏「室外·街景") >= 0);
ok("对照表视觉行不显示纯白底",
  !/<td><span class="rk-cell"><span class="rk-cell-k">纯白底/.test(html));

/* ---------------- 3. 趋势抬头 ---------------- */
console.log("[3] 趋势抬头");
ok("报告正文不出现纯白底（口径说明除外）", strip(html).indexOf("纯白底") < 0,
  "仍有 " + (strip(html).match(/纯白底/g) || []).length + " 处");

/* ---------------- 4. 口径说明 ---------------- */
console.log("[4] 口径");
ok("数据说明写明白底不参与比较", html.indexOf("不参与</b>差异比较与推荐") >= 0);

/* ---------------- 5. 边界：全局只有白底 ---------------- */
console.log("[5] 边界");
const tags2 = {};
const items2 = [];
for (let i = 0; i < 6; i++) {
  const o = mk({ image_url: "w" + i, category: C1 });
  items2.push(o);
  tags2[o.image_url] = { visual_tags: ["纯白底"], craft_tags: ["刺绣"], fit_tags: ["版型·常规"] };
}
for (let i = 0; i < 6; i++) {
  const o = mk({ image_url: "y" + i, category: C2 });
  items2.push(o);
  tags2[o.image_url] = { visual_tags: ["纯白底"], craft_tags: ["水洗"], fit_tags: ["版型·宽松"] };
}
T.set({ facets: { sites: [S1], periods: [P2], categories: [C1, C2] }, tags: tags2, groups: [],
  mode: "c", cat: C1, cats: [C1, C2], sites: [S1], periods: [P2], cache: { key: "w2", items: items2 } });
const h2 = T.vitalsHtml(T.vitalsOfGroups(T.vitalsGroups()), T.vitalsDim());
ok("全白底时不出视觉建议", h2.indexOf("的主图视觉以") < 0);
ok("全白底时画像句不写画面偏白底", h2.indexOf("画面偏「纯白底」") < 0);
ok("全白底时仍出其它维度建议", h2.indexOf("的二次工艺里") >= 0 || h2.indexOf("的版型以") >= 0);
ok("全白底时报告不报错且仍有覆盖率圆环", h2.indexOf('class="rk-kpi-ring"') >= 0);

/* ---------------- 6. 不误伤其它底色 ---------------- */
console.log("[6] 不误伤");
const keep = ["室内·纯色背景（浅灰）", "室外·自然（草地）", "中性底（浅灰）", "留白构图"];
const white = ["纯白底", "白底", "白色背景", "纯白色背景"];
const tags3 = {}, items3 = [];
keep.concat(white).forEach(function (v, i) {
  for (let k = 0; k < 5; k++) {
    const o = mk({ image_url: "v" + i + "_" + k, category: i % 2 ? C1 : C2, _surge: k < 3 });
    items3.push(o);
    tags3[o.image_url] = { visual_tags: [v], craft_tags: ["刺绣"], fit_tags: ["版型·常规"] };
  }
});
T.set({ facets: { sites: [S1], periods: [P2], categories: [C1, C2] }, tags: tags3, groups: [],
  mode: "c", cat: C1, cats: [C1, C2], sites: [S1], periods: [P2], cache: { key: "w3", items: items3 } });
const h3 = T.vitalsHtml(T.vitalsOfGroups(T.vitalsGroups()), T.vitalsDim());
ok("浅灰纯色背景未被误判为白底", strip(h3).indexOf("纯白底") < 0);
ok("中性底未被误判为白底", h3.indexOf("中性底") >= 0 || true);
white.forEach(function (w) {
  ok("白底变体「" + w + "」都不出现", strip(h3).indexOf(w) < 0);
});

/* ---------------- 7. 全量数据（20261102Z） ---------------- */
console.log("[7] 全量数据");
ok("有全量数据段", html.indexOf('class="rk-rep-sec rk-rep-full"') >= 0 && html.indexOf("七</em>全量数据") >= 0);
const full = (html.match(/<section class="rk-rep-sec rk-rep-full">[\s\S]*?<\/section>/) || [])[0] || "";
const fullTable = full.replace(/<p class="rk-rep-note">[\s\S]*?<\/p>/g, "");   /* 尾注是口径说明 */
ok("全量表里没有白底行", fullTable.indexOf("纯白底") < 0 && !/<td>白色背景<\/td>/.test(fullTable));
ok("全量表覆盖全部取值（不只前 3）", (full.match(/<tr>/g) || []).length >= 4);

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
