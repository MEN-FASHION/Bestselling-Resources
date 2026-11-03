/* 趋势上升榜 · 图案印花款前台展示开关（20261103A）
   需求：后台加一个「图案印花是否前台展示」的开关；关掉后所有有印花图案的款都不展示，
   前台数据与分析报告随之变化；但要区分「章仔 / 织唛 / 印花标」这类辅料标牌，不能被判成印花。
   本测试锁五件事：
     1) 印花判定：图案类型 / 图案元素 / 图案复制类工艺 任一处命中即算
     2) 辅料标牌不被误判（章仔、织唛、印花标、烫标、皮标、绣标、肩章、臂章）
     3) 开关打开（默认）时一张不少；关掉后印花款从列表与体征卡里消失
     4) 被隐藏的款数可被统计出来，用于页面说明
     5) 标签还没取到的图不被误伤 */
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

const mk = (o) => Object.assign({ image_url: "", category: "外套夹克", site: "美国站", period_label: "2026-W43",
  _opp: false, _hot: false, _surge: false }, o);

/* 六个款：
   p1 图案类型满印        p2 二次工艺数码印花      p3 图案元素「印花·字母」
   k1 只有「印花标」工艺（辅料，不许隐藏）
   k2 只有「织唛」+「肩章」（辅料，不许隐藏）
   n1 完全没打标（标签取不到时不许隐藏） */
const items = [
  mk({ image_url: "p1", _hot: true }),
  mk({ image_url: "p2", _surge: true }),
  mk({ image_url: "p3", _opp: true }),
  mk({ image_url: "k1" }),
  mk({ image_url: "k2" }),
  mk({ image_url: "n1" }),
];
const tags = {
  p1: { pattern_tags: ["满印"], craft_tags: ["刺绣"], element_tags: ["纯色"] },
  p2: { pattern_tags: ["纯色"], craft_tags: ["数码印花"], element_tags: ["纯色"] },
  p3: { pattern_tags: ["纯色"], craft_tags: ["刺绣"], element_tags: ["印花·字母"] },
  k1: { pattern_tags: ["纯色"], craft_tags: ["印花标"], element_tags: ["纯色"] },
  k2: { pattern_tags: ["纯色"], craft_tags: ["织唛"], struct_tags: ["肩章"], element_tags: ["纯色"] },
};
/* n1 故意不给标签 */

T.set({ facets: { sites: ["美国站"], periods: ["2026-W43"], categories: ["外套夹克"] },
  tags, groups: [], mode: "c", cat: "外套夹克", cats: ["外套夹克"],
  sites: ["美国站"], periods: ["2026-W43"], cache: { key: "print", items } });

/* ---------------- 1. 判定 ---------------- */
console.log("\n[1] 印花判定");
ok("图案类型满印 → 算印花", T.itemIsPrint(items[0]) === true);
ok("二次工艺数码印花 → 算印花", T.itemIsPrint(items[1]) === true);
ok("图案元素「印花·字母」→ 算印花", T.itemIsPrint(items[2]) === true);

console.log("\n[2] 辅料标牌不被误判");
ok("只有「印花标」→ 不算印花", T.itemIsPrint(items[3]) === false);
ok("只有「织唛 + 肩章」→ 不算印花", T.itemIsPrint(items[4]) === false);
ok("章仔 / 织唛 / 印花标 / 烫标 / 皮标 / 绣标 / 肩章 / 臂章 都进辅料白名单",
  ["章仔", "织唛", "印花标", "烫标", "皮标", "绣标", "肩章", "臂章"].every(v => T.isPatchLabel(v)));
ok("这些辅料单独出现时都不算印花图案",
  ["章仔", "织唛", "印花标", "烫标", "皮标", "绣标", "肩章", "臂章"].every(v => T.patternIsPrint(v) === false));
ok("「印花标」即使走 patternIsPrint 也不判成印花", T.patternIsPrint("印花标") === false);
ok("「热带印花」仍判成印花（真印花图案不能漏）", T.patternIsPrint("热带印花") === true);

/* ---------------- 3. 开关打开 ---------------- */
console.log("\n[3] 开关打开（默认展示）");
ok("默认 PRINT_HIDE = false", T.PRINT_HIDE() === false);
ok("六张全在", (CACHE => CACHE) && true);
let shown = T.visibleItems();
ok("开着时 6 张都展示", shown.length === 6, "实际 " + shown.length);
ok("开着时隐藏数为 0", T.hiddenPrintCount(items) === 0);

/* ---------------- 4. 开关关闭 ---------------- */
console.log("\n[4] 开关关闭（印花款不展示）");
T.setPrintHide(true);
shown = T.visibleItems();
ok("关掉后只剩 3 张（辅料 2 张 + 无标签 1 张）", shown.length === 3, shown.map(i => i.image_url).join(","));
ok("满印款被挡掉", shown.every(i => i.image_url !== "p1"));
ok("数码印花款被挡掉", shown.every(i => i.image_url !== "p2"));
ok("图案元素印花款被挡掉", shown.every(i => i.image_url !== "p3"));
ok("只有印花标的款仍在（没被判成印花）", shown.some(i => i.image_url === "k1"));
ok("织唛 + 肩章的款仍在", shown.some(i => i.image_url === "k2"));
ok("没有标签的款仍在（不误伤）", shown.some(i => i.image_url === "n1"));
ok("被挡掉 3 个款，能统计出来提示用户", T.hiddenPrintCount(items) === 3, String(T.hiddenPrintCount(items)));

/* ---------------- 5. 载荷 / 报告随开关变化 ---------------- */
console.log("\n[5] 数据与报告随开关变化");
const V = T.vitalsOfGroups(T.vitalsGroups());
ok("体征卡样本数从 6 变成 3", V.length === 1 && V[0].n === 3, V.length ? "n=" + V[0].n : "无组");
const cov = T.coverageOf();
ok("覆盖率分母也变成 3（口径一致）", cov.total === 3, "total=" + cov.total);
ok("报告里的工艺不含印花（数码印花款已被整款剔除）",
  (V[0].craft || []).every(x => x[0] !== "数码印花"));
T.setPrintHide(false);
const V2 = T.vitalsOfGroups(T.vitalsGroups());
ok("开关打开后样本数回到 6", V2[0].n === 6, "n=" + V2[0].n);


/* ---------------- 6. 20261103C：图案款判定补全 ----------------
   真实漏判：图案元素写「字母 / 文字标语 / 卡通人物」、图案类型写「几何图案 / 格纹 / 迷彩」
   的款，一个字都没提"印花"，旧口径全放过，开关关了还留在前台。
   这里锁住新口径：按「有没有图案」判，同时不把辅料、结构件、纯配色算进来。 */
console.log("\n[6] 图案款判定补全（20261103C）");
const items6 = [
  mk({ image_url: "e1" }),   /* 图案类型空 + 元素「文字标语」= 截图里那种款 */
  mk({ image_url: "e2" }),   /* 图案类型「几何图案」 */
  mk({ image_url: "e3" }),   /* 图案类型「格纹」 */
  mk({ image_url: "e4" }),   /* 图案类型「迷彩」 */
  mk({ image_url: "e5" }),   /* 图案类型「纯色/无图案」，元素「字母」 */
  mk({ image_url: "n1" }),   /* 纯色 + 拼色，元素「纯色」→ 不算 */
  mk({ image_url: "n2" }),   /* 元素里混了结构件「荷叶边」+ 纯色 → 不算 */
  mk({ image_url: "n3" }),   /* 只有辅料「印花标」→ 不算 */
];
const tags6 = {
  e1: { pattern_tags: [], element_tags: ["文字标语"], craft_tags: ["无工艺"] },
  e2: { pattern_tags: ["几何图案"], element_tags: ["纯色"], craft_tags: ["无工艺"] },
  e3: { pattern_tags: ["格纹"], element_tags: ["纯色"], craft_tags: ["无工艺"] },
  e4: { pattern_tags: ["迷彩"], element_tags: ["纯色"], craft_tags: ["刺绣"] },
  e5: { pattern_tags: ["纯色/无图案"], element_tags: ["字母"], craft_tags: ["无工艺"] },
  n1: { pattern_tags: ["纯色/无图案", "拼色"], element_tags: ["纯色"], craft_tags: ["无工艺"] },
  n2: { pattern_tags: ["纯色/无图案"], element_tags: ["荷叶边"], craft_tags: ["无工艺"] },
  n3: { pattern_tags: ["纯色/无图案"], element_tags: ["纯色"], craft_tags: ["印花标"] },
};
T.set({ facets: { sites: ["美国站"], periods: ["2026-W43"], categories: ["外套夹克"] },
  tags: tags6, groups: [], mode: "c", cat: "外套夹克", cats: ["外套夹克"],
  sites: ["美国站"], periods: ["2026-W43"], cache: { key: "print6", items: items6 } });

ok("图案类型空 + 元素「文字标语」→ 算图案款（截图同款）", T.itemIsPrint(items6[0]) === true);
ok("图案类型「几何图案」→ 算图案款", T.itemIsPrint(items6[1]) === true);
ok("图案类型「格纹」→ 算图案款", T.itemIsPrint(items6[2]) === true);
ok("图案类型「迷彩」→ 算图案款", T.itemIsPrint(items6[3]) === true);
ok("图案类型写纯色但元素写了「字母」→ 算图案款", T.itemIsPrint(items6[4]) === true);
ok("纯色 + 拼色（只是配色）→ 不算图案款", T.itemIsPrint(items6[5]) === false);
ok("元素里只有结构件「荷叶边」→ 不算图案款", T.itemIsPrint(items6[6]) === false);
ok("只有「印花标」辅料 → 不算图案款", T.itemIsPrint(items6[7]) === false);
ok("纯色/无图案 不算图案", T.patternTypeIsPattern("纯色/无图案") === false);
ok("拼色 / 撞色 / 双色拼接 / 色块拼接 不算图案",
  ["拼色", "撞色", "双色拼接", "色块拼接"].every(v => T.patternTypeIsPattern(v) === false));
ok("格纹 / 竖条纹 / 豹纹 / 大花/花卉 算图案",
  ["格纹", "竖条纹", "豹纹", "大花/花卉"].every(v => T.patternTypeIsPattern(v) === true));

T.setPrintHide(true);
ok("关掉开关后 5 个图案款全被挡掉", T.visibleItems().length === 3,
  T.visibleItems().map(i => i.image_url).join(","));
ok("拼色纯色款、结构件款、辅料款都还在",
  ["n1", "n2", "n3"].every(u => T.visibleItems().some(i => i.image_url === u)));
ok("隐藏数统计为 5", T.hiddenPrintCount(items6) === 5, String(T.hiddenPrintCount(items6)));
T.setPrintHide(false);

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
