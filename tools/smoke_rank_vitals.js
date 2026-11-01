/* 趋势上升榜 · 体征卡三种模式离屏自测（20261031B）
   目的：分析模块以前只在「类目对比」出，切到国家对比 / 纵向时间对比整块消失。
   这里直接跑 vitalsGroups / vitalsOfGroups / vitalsHtml，验证三种模式都能分组、
   统计口径正确、文案跟着维度走。 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };

/* ---- 极简 DOM：只要够让脚本加载就行，不触发 boot ---- */
const listeners = {};
const fakeDoc = {
  readyState: "loading",
  addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  body: { appendChild() {} },
  documentElement: { style: {} },
};
const fakeWin = { __RANK_TEST__: true, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };

const ctx = {
  window: fakeWin,
  document: fakeDoc,
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
  localStorage: { getItem: () => null, setItem() {} },
  location: { href: "", search: "" },
  navigator: { userAgent: "node" },
};
ctx.window.document = fakeDoc;
ctx.globalThis = ctx;
vm.createContext(ctx);

const src = fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8");
vm.runInContext(src, ctx, { filename: "rank.js" });

const T = fakeWin.__RANK_T;
ok("测试钩子已挂出", !!T);

/* ---- 测试数据 ----
   注意：真实取数时 CACHE 已经按模式收敛过了 ——
   类目对比只取单站点、国家对比只取单类目、纵向只取单站点+单类目。
   所以每个场景下面各给一份符合真实口径的 CACHE，而不是全塞一份再指望函数去猜。 */
const P1 = "2026-W42", P2 = "2026-W43";
const S1 = "美国站", S2 = "德国站";
const C1 = "T恤", C2 = "长裤";
const mk = (o) => Object.assign({
  image_url: "", category: C1, site: S1, period_label: P2,
  _opp: false, _hot: false, _surge: false,
}, o);

const tags = {
  u1: { shoot_tags: ["模拍"], element_tags: ["条纹"], style_tags: ["运动"] },
  u2: { shoot_tags: ["模拍"], element_tags: ["纯色"], style_tags: ["运动"] },
  u3: { shoot_tags: ["模拍"], element_tags: ["纯色"] },
  u4: { shoot_tags: ["摆拍"], element_tags: ["图案"] },
  u5: { shoot_tags: ["摆拍"], element_tags: ["图案"] },
  u6: { shoot_tags: ["摆拍"], element_tags: ["图案"] },
  u7: { shoot_tags: ["挂拍"], element_tags: ["条纹"] },
};

/* 类目对比：单站点（美国站），含本周两类目 + 上一周基线 */
const CACHE_C = { key: "c", items: [
  mk({ image_url: "u1", period_label: P2, category: C1, _surge: true, _hot: true }),
  mk({ image_url: "u2", period_label: P2, category: C1, _opp: true }),
  mk({ image_url: "u3", period_label: P2, category: C1 }),
  mk({ image_url: "u7", period_label: P2, category: C2, _surge: true }),
  mk({ image_url: "u6", period_label: P1, category: C1, _hot: true }),   /* 基线周，不该被算进 W43 */
] };

/* 国家对比：单类目（T恤），两国同周 */
const CACHE_H = { key: "h", items: [
  mk({ image_url: "u1", site: S1, period_label: P2, _surge: true, _hot: true }),
  mk({ image_url: "u2", site: S1, period_label: P2, _opp: true }),
  mk({ image_url: "u3", site: S1, period_label: P2 }),
  mk({ image_url: "u4", site: S2, period_label: P2, _opp: true }),
  mk({ image_url: "u5", site: S2, period_label: P2 }),
] };

/* 纵向时间对比：单站点 + 单类目，两周 */
const CACHE_V = { key: "v", items: [
  mk({ image_url: "u1", site: S1, period_label: P2, _surge: true, _hot: true }),
  mk({ image_url: "u2", site: S1, period_label: P2, _opp: true }),
  mk({ image_url: "u3", site: S1, period_label: P2 }),
  mk({ image_url: "u6", site: S1, period_label: P1, _hot: true }),
] };

T.set({
  facets: { sites: [S1, S2], periods: [P1, P2], categories: [C1, C2] },
  tags,
  groups: [{ name: "欧洲", members: [S2] }],
});

/* ---------------- 1. 类目对比 ---------------- */
console.log("\n[1] 横向 · 类目对比");
T.set({ mode: "c", cat: C1, cats: [C1, C2], sites: [S1], periods: [P2], cache: CACHE_C });
let G = T.vitalsGroups();
ok("按类目分组，勾几个出几个", G.length === 2, "实际 " + G.length);
ok("第一组是 T恤", G[0].label === C1, G[0].label);
ok("每组只带本类目 + 本周（不含基线周）", G[0].items.length === 3, "T恤 " + G[0].items.length + " 张");
ok("长裤组 1 张", G[1].items.length === 1, String(G[1].items.length));
let V = T.vitalsOfGroups(G);
ok("T恤 三档占比：激增 33% / 爆款 33% / 机会 33%",
  V[0].srgP === 33 && V[0].hotP === 33 && V[0].oppP === 33,
  [V[0].srgP, V[0].hotP, V[0].oppP].join("/"));
ok("T恤 拍摄方式模拍 100%", V[0].shoot[0][0] === "模拍" && V[0].shoot[0][1] === 100,
  JSON.stringify(V[0].shoot));
let html = T.vitalsHtml(V, T.vitalsDim());
ok("体征卡有输出", html.indexOf("rk-vitals") >= 0);
ok("类目模式标题是「这一周，这几个类目差别在哪」", html.indexOf("这几个类目差别在哪") >= 0);

/* ---------------- 2. 国家对比 ---------------- */
console.log("\n[2] 横向 · 国家对比（以前这里是空的）");
T.set({ mode: "h", cat: C1, sites: [S1, S2], periods: [P2], group: "", cache: CACHE_H });
G = T.vitalsGroups();
ok("按国家分组，两国两组", G.length === 2, "实际 " + G.length);
ok("组名是国家", G[0].label === S1 && G[1].label === S2, G.map((g) => g.label).join(","));
ok("美国站 3 张", G[0].items.length === 3, String(G[0].items.length));
ok("德国站 2 张", G[1].items.length === 2, String(G[1].items.length));
V = T.vitalsOfGroups(G);
ok("美国站模拍 100%", V[0].shoot[0][0] === "模拍" && V[0].shoot[0][1] === 100, JSON.stringify(V[0].shoot));
ok("德国站摆拍 100%", V[1].shoot[0][0] === "摆拍" && V[1].shoot[0][1] === 100, JSON.stringify(V[1].shoot));
html = T.vitalsHtml(V, T.vitalsDim());
ok("国家对比也能出体征卡", html.indexOf("rk-vitals") >= 0);
ok("标题变成「这几个国家，差别在哪」", html.indexOf("这几个国家，差别在哪") >= 0);
ok("洞察文案用「国家」而不是「类目」", html.indexOf("比其余国家均值") >= 0, html.indexOf("比其余类目均值") >= 0 ? "仍写成类目" : "");

/* ---------------- 3. 选了地区 → 只有一列，不出比较块 ---------------- */
console.log("\n[3] 国家对比 · 选了地区分组");
T.set({ mode: "h", cat: C1, sites: [S1], periods: [P2], group: "欧洲", cache: CACHE_H });
ok("地区合并成单列时不出比较块", T.vitalsGroups().length === 0, String(T.vitalsGroups().length));

/* ---------------- 4. 纵向时间对比 ---------------- */
console.log("\n[4] 纵向 · 时间对比（以前这里也是空的）");
T.set({ mode: "v", cat: C1, sites: [S1], periods: [P1, P2], group: "", cache: CACHE_V });
G = T.vitalsGroups();
ok("按周次分组，两周两组", G.length === 2, "实际 " + G.length);
ok("组名是周次", G[0].label === P1 && G[1].label === P2, G.map((g) => g.label).join(","));
ok("W42 只取本组那一周，不混进 W43", G[0].items.length === 1 && G[0].items[0].period_label === P1,
  JSON.stringify(G[0].items.map((x) => x.period_label)));
ok("W43 3 张", G[1].items.length === 3, String(G[1].items.length));
V = T.vitalsOfGroups(G);
ok("W42 爆款 100%（该周唯一一张就是爆款）", V[0].hotP === 100, String(V[0].hotP));
ok("W43 爆款 33%", V[1].hotP === 33, String(V[1].hotP));
html = T.vitalsHtml(V, T.vitalsDim());
ok("时间对比也能出体征卡", html.indexOf("rk-vitals") >= 0);
ok("标题变成「这几周，差别在哪」", html.indexOf("这几周，差别在哪") >= 0);
ok("洞察文案用「周次」", html.indexOf("其余周次") >= 0 || html.indexOf("这几个周次") >= 0);

/* ---------------- 5. 边界 ---------------- */
console.log("\n[5] 边界");
T.set({ mode: "v", cat: C1, periods: [P2], sites: [S1], cache: CACHE_V });
V = T.vitalsOfGroups(T.vitalsGroups());
ok("只有一列时不出「差别在哪」，但仍有单卡", T.insightsOf(V, T.vitalsDim()).length === 0 && V.length === 1,
  "洞察 " + T.insightsOf(V, T.vitalsDim()).length);
T.set({ mode: "c", cat: C1, cats: [C1, C2], periods: [P1], cache: CACHE_C });
V = T.vitalsOfGroups(T.vitalsGroups());
ok("某列没图时保留卡片并标空态", V.some((c) => c.n === 0), JSON.stringify(V.map((c) => c.n)));
html = T.vitalsHtml(V, T.vitalsDim());
ok("空态卡片有说明文字", html.indexOf("rk-vit-empty") >= 0 || html.indexOf("rk-vit-none") >= 0);

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
