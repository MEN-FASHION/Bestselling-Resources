/* 20261103H：可执行建议只写最近一周
   时间对比下以前每周各给一组（W42/W43/W44 三套几乎一样），又长又难用。
   本测试确认：只保留最新一周那一列，其余周次省略但要说明。 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };

const fakeDoc = {
  readyState: "loading", addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  body: { appendChild() {} }, documentElement: { style: {} },
};
const fakeWin = {
  __RANK_TEST__: true, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  APP_ENUM: {}, localStorage: { getItem: () => null, setItem() {} },
};
const ctx = {
  window: fakeWin, document: fakeDoc, console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
  localStorage: { getItem: () => null, setItem() {} }, location: { href: "", search: "" }, navigator: { userAgent: "node" },
};
ctx.window.document = fakeDoc;
ctx.globalThis = ctx;
vm.createContext(ctx);
const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8");
vm.runInContext(SRC, ctx, { filename: "rank.js" });
const T = fakeWin.__RANK_T;

const tag = (craft, extra) => Object.assign({
  craft_tags: craft, struct_tags: ["拉链", "口袋"], fit_tags: ["领型·圆领", "袖长·长袖"],
  fabric_tags: ["纯棉（100%棉）", "涤棉（涤纶+棉·CVC/TC）"], visual_tags: ["留白构图", "单图满版"],
  scene_tags: ["室外·街头·墙面栏杆"], element_tags: ["字母"], shoot_tags: ["模拍"],
}, extra || {});
const mk = (cat, period, u) => ({ image_url: u, category: cat, site: "美国站", period_label: period, _opp: false, _hot: false, _surge: false });

function buildCols() {
  const items = [], tags = {};
  const weeks = ["2026-W42", "2026-W43", "2026-W44"];
  weeks.forEach((w, wi) => {
    for (let i = 0; i < 10; i++) {
      const u = w + "-" + i;
      items.push(mk("卫衣", w, u));
      tags[u] = tag(wi === 2 ? ["刺绣", "水洗"] : ["剥鳞"]);
    }
  });
  T.set({
    facets: { sites: ["美国站"], periods: weeks, categories: ["卫衣"] },
    tags, groups: [], mode: "v", cat: "卫衣", cats: [],
    sites: ["美国站"], periods: weeks, cache: { key: "act", items },
  });
  return T.vitalsOfGroups(T.vitalsGroups());
}

console.log("[1] 只取最近一周");
const V = buildCols();
const pick = T.repLatestWeekCols(V);
console.log("    三列 = " + V.map((c) => c.key).join(" / ") + " → 保留 " + pick.latest);
ok("最新一周是 W44", pick.latest === "2026-W44");
ok("只保留一列", pick.cols.length === 1);
ok("保留的是 W44", pick.cols[0].key === "2026-W44");
ok("被省略的周次有记录", pick.dropped.length === 2 && pick.dropped.join(",").indexOf("W42") >= 0);

console.log("\n[2] 建议正文只有一套");
const html = T.repActionHtml(V, T.vitalsDim());
ok("出现「只写最近一周」说明", html.indexOf("只写最近一周") >= 0);
ok("说明里点名 W44", html.indexOf("2026-W44") >= 0);
ok("说明里写清哪些周次省略", html.indexOf("已省略") >= 0);
ok("W42 不再作为建议主语出现", html.indexOf("「2026-W42」") < 0);
ok("W43 不再作为建议主语出现", html.indexOf("「2026-W43」") < 0);
ok("W44 作为建议主语出现", html.indexOf("「2026-W44」") >= 0);
const li = (html.match(/<li>/g) || []).length;
console.log("    条目数 = " + li + "（三周各一组时会是 3 倍）");
ok("条目数控制在单列规模（<=14）", li <= 14 && li >= 3);

console.log("\n[3] 边界：不能把建议整段弄没");
/* 只有一周数据时不触发省略逻辑 */
const one = V.filter((c) => c.key === "2026-W44");
const p1 = T.repLatestWeekCols(one);
ok("单列时不做省略", p1.cols.length === 1 && p1.latest === "");
ok("单列时建议照常生成", T.repActionHtml(one, T.vitalsDim()).indexOf("可执行建议") >= 0);
ok("单列时不说「只写最近一周」（本来就只有一周）", T.repActionHtml(one, T.vitalsDim()).indexOf("只写最近一周") < 0);
/* 最新一周没有数据 → 退到最近有数据的那一周 */
const fake = [{ key: "2026-W42", cat: "2026-W42", n: 5 }, { key: "2026-W44", cat: "2026-W44", n: 0 }];
const p2 = T.repLatestWeekCols(fake);
ok("最新一周为空时只用有数据的那一周", p2.cols.length === 1 && p2.cols[0].key === "2026-W42");
ok("此时不必再说明省略（只剩一列可写）", p2.latest === "");
/* 三周里最新一周为空、但前两周都有数据 → 退到最近有数据的一周并说明 */
const fake3 = [
  { key: "2026-W42", cat: "2026-W42", n: 4 },
  { key: "2026-W43", cat: "2026-W43", n: 6 },
  { key: "2026-W44", cat: "2026-W44", n: 0 },
];
const p3 = T.repLatestWeekCols(fake3);
ok("退到 W43", p3.cols.length === 1 && p3.cols[0].key === "2026-W43");
ok("并说明 W42 已省略", p3.latest === "2026-W43" && p3.dropped.join(",").indexOf("W42") >= 0);
/* 空列不给建议 */
ok("全部为空时返回空字符串", T.repActionHtml([{ key: "2026-W44", cat: "2026-W44", n: 0 }], T.vitalsDim()) === "");

console.log("\n[4] 类目 / 国家对比不受影响");
T.set({ facets: { sites: ["美国站"], periods: ["2026-W44"], categories: ["卫衣", "POLO"] }
  , tags: {}, groups: [], mode: "c", cat: "卫衣", cats: ["卫衣", "POLO"], sites: ["美国站"], periods: ["2026-W44"], cache: null });
const cnt = {};
cnt["卫衣"] = 5; cnt["POLO"] = 5;
const itemsC = [], tagsC = {};
["卫衣", "POLO"].forEach((c) => { for (let i = 0; i < 5; i++) { const u = c + i; itemsC.push(mk(c, "2026-W44", u)); tagsC[u] = tag(["刺绣"]); } });
T.set({ facets: { sites: ["美国站"], periods: ["2026-W44"], categories: ["卫衣", "POLO"] }
  , tags: tagsC, groups: [], mode: "c", cat: "卫衣", cats: ["卫衣", "POLO"], sites: ["美国站"], periods: ["2026-W44"], cache: { key: "c", items: itemsC } });
const Vc = T.vitalsOfGroups(T.vitalsGroups());
const htmlC = T.repActionHtml(Vc, T.vitalsDim());
ok("类目对比仍两列都给建议", htmlC.indexOf("「卫衣」") >= 0 && htmlC.indexOf("「POLO」") >= 0);
ok("类目对比不加「只写最近一周」", htmlC.indexOf("只写最近一周") < 0);

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
