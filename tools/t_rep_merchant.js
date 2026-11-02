/* 趋势上升榜 · 报告改为商家视角（20261102L）
   需求：分析要侧重商家能落地的东西 —— 二次工艺、新的结构部件、版型、面料；
   不要再推荐印花（图案元素）。
   本测试锁四件事：
     1) 结构部件 / 面料已进统计（此前根本没算，报告里无从谈起）
     2) 对照表与结论只用商家四维 + 风格/视觉参考，不出现图案元素
     3) 建议按「工艺 → 结构件 → 版型 → 面料」排序，且不含印花类建议
     4) 画像句以工艺开头，不再以风格为主线 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };

const listeners = {};
const fakeDoc = {
  readyState: "loading",
  addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  body: { appendChild() {} }, documentElement: { style: {} },
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
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8"), ctx, { filename: "rank.js" });

const T = fakeWin.__RANK_T;
ok("测试钩子已挂出", !!T);

const mk = (o) => Object.assign({ image_url: "", category: "外套夹克", site: "美国站", period_label: "2026-W43",
  _opp: false, _hot: false, _surge: false }, o);

/* A 列：工艺数码印制 + 结构件拉链 + 版型收腰 + 面料纯棉，且带一个显眼的印花元素
   B 列：无工艺 + 口袋 + 常规版型 + 涤纶
   印花元素只给 A 列，用来验证「即便它最独有，也不该被推荐」 */
const tags = {
  a1: { craft_tags: ["数码印制"], struct_tags: ["拉链"], fit_tags: ["版型·收腰"], fabric_tags: ["纯棉（100%棉）"], element_tags: ["骷髅"], style_tags: ["户外机能"], visual_tags: ["纯白底"], shoot_tags: ["模拍"] },
  a2: { craft_tags: ["数码印制"], struct_tags: ["拉链"], fit_tags: ["版型·收腰"], fabric_tags: ["纯棉（100%棉）"], element_tags: ["骷髅"], style_tags: ["户外机能"], visual_tags: ["纯白底"], shoot_tags: ["模拍"] },
  a3: { craft_tags: ["数码印制"], struct_tags: ["拉链"], fit_tags: ["版型·收腰"], fabric_tags: ["纯棉（100%棉）"], element_tags: ["骷髅"], style_tags: ["户外机能"], visual_tags: ["纯白底"], shoot_tags: ["模拍"] },
  b1: { craft_tags: ["无工艺"], struct_tags: ["口袋"], fit_tags: ["版型·常规"], fabric_tags: ["涤纶（100%涤）"], event_tags: [], style_tags: ["商务通勤"], visual_tags: ["3D渲染图"], shoot_tags: ["3D"] },
  b2: { craft_tags: ["无工艺"], struct_tags: ["口袋"], fit_tags: ["版型·常规"], fabric_tags: ["涤纶（100%涤）"], style_tags: ["商务通勤"], visual_tags: ["3D渲染图"], shoot_tags: ["3D"] },
  b3: { craft_tags: ["无工艺"], struct_tags: ["口袋"], fit_tags: ["版型·常规"], fabric_tags: ["涤纶（100%涤）"], style_tags: ["商务通勤"], visual_tags: ["3D渲染图"], shoot_tags: ["3D"] },
};

T.set({ facets: { sites: ["美国站"], periods: ["2026-W43"], categories: ["外套夹克", "POLO"] }, tags, groups: [],
  mode: "c", cat: "外套夹克", cats: ["外套夹克", "POLO"], sites: ["美国站"], periods: ["2026-W43"],
  cache: { key: "c", items: [mk({ image_url: "a1" }), mk({ image_url: "a2" }), mk({ image_url: "a3" }),
    mk({ image_url: "b1", category: "POLO" }), mk({ image_url: "b2", category: "POLO" }), mk({ image_url: "b3", category: "POLO" })] } });

const V = T.vitalsOfGroups(T.vitalsGroups());
const html = T.vitalsHtml(V, T.vitalsDim());

/* ---------------- 1. 统计层补齐 ---------------- */
console.log("\n[1] 结构部件 / 面料进统计");
ok("结构部件已统计", V[0].struct && V[0].struct.length > 0, JSON.stringify(V[0].struct));
ok("面料已统计", V[0].fabric && V[0].fabric.length > 0, JSON.stringify(V[0].fabric));
ok("A 列结构件首位是拉链", V[0].struct[0][0] === "拉链" && V[0].struct[0][1] === 100, JSON.stringify(V[0].struct[0]));
ok("B 列结构件首位是口袋", V[1].struct[0][0] === "口袋", JSON.stringify(V[1].struct[0]));
ok("A 列面料首位是纯棉", V[0].fabric[0][0].indexOf("纯棉") === 0, V[0].fabric[0][0]);
ok("面料分母按本维度已打标图数算（100%）", V[1].fabric[0][1] === 100, JSON.stringify(V[1].fabric[0]));

/* ---------------- 2. 对照表：商家四维在前，无图案元素 ---------------- */
console.log("\n[2] 对照表口径");
["二次工艺", "结构部件", "版型", "面料"].forEach(function (d) {
  ok("对照表含「" + d + "」行", html.indexOf("<th>" + d + "</th>") >= 0);
});
ok("对照表不再有「元素」行", html.indexOf("<th>元素</th>") < 0);
ok("商家四维排在风格之前",
  html.indexOf("<th>二次工艺</th>") < html.indexOf("<th>风格</th>"));
ok("商家四维排在视觉之前",
  html.indexOf("<th>面料</th>") < html.indexOf("<th>视觉</th>"));
ok("对照表仍保留风格/视觉作参考", html.indexOf("<th>风格</th>") >= 0 && html.indexOf("<th>视觉</th>") >= 0);

/* ---------------- 3. 建议：按商家顺序，无印花 ---------------- */
console.log("\n[3] 可执行建议");
ok("有工艺建议", html.indexOf("的二次工艺信号是") >= 0);
ok("有结构部件建议", html.indexOf("出现率 100%") >= 0 && html.indexOf("加这一个结构件成本最低") >= 0);
ok("有版型建议", html.indexOf("版型集中在") >= 0 && html.indexOf("打版直接按这个方向出样") >= 0);
ok("有面料建议", html.indexOf("面料首选") >= 0 && html.indexOf("口头叫法") >= 0);
ok("工艺建议在结构件之前", html.indexOf("二次工艺信号是") < html.indexOf("加这一个结构件"));
ok("结构件建议在版型之前", html.indexOf("加这一个结构件") < html.indexOf("版型集中在"));
ok("版型建议在面料之前", html.indexOf("版型集中在") < html.indexOf("面料首选"));
ok("建议里不出现印花/元素推荐", html.indexOf("做区分标识") < 0 && html.indexOf("系列识别点") < 0);
ok("建议里不出现「骷髅」（即使它是最独有的元素）", html.indexOf("骷髅") < 0, "印花不该被推荐");

/* ---------------- 4. 画像句 ---------------- */
console.log("\n[4] 逐列画像句");
ok("画像句以工艺开头", html.indexOf("工艺主打「数码印制」") >= 0);
ok("画像句含结构件", html.indexOf("结构件集中在「拉链」") >= 0);
ok("画像句含版型", html.indexOf("版型以「收腰」为主") >= 0);
ok("画像句含面料", html.indexOf("面料多为「纯棉") >= 0);
ok("画像句不再以风格开头", html.indexOf("风格以「") < 0);
ok("画像句里工艺排在结构件之前",
  html.indexOf("工艺主打「数码印制」") < html.indexOf("结构件集中在「拉链」"));

/* ---------------- 5. 报告头写明视角 ---------------- */
console.log("\n[5] 报告头");
ok("标题带「商家视角」", html.indexOf("商家视角") >= 0);
ok("写明四个维度", html.indexOf("工艺 / 结构部件 / 版型 / 面料") >= 0);

/* ---------------- 6. 素材全无时的健壮性 ---------------- */
console.log("\n[6] 边界");
T.set({ cache: { key: "c2", items: [mk({ image_url: "a1" }), mk({ image_url: "b1", category: "POLO" })] }, tags: {} });
const v2 = T.vitalsOfGroups(T.vitalsGroups());
const h2 = T.vitalsHtml(v2, T.vitalsDim());
ok("没打工艺/结构件时不抛错", typeof h2 === "string" && h2.length > 0);
ok("没数据时不硬编建议", h2.indexOf("加这一个结构件") < 0);
ok("空结构件返回空数组", (v2[0].struct || []).length === 0);

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
