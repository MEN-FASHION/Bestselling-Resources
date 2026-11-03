/* 趋势上升榜 · 详细报告「全量数据」+ 图案复制类工艺整类不展示（20261102Z）
   需求原文：详细报告点开要「全量的数据」；数码印花 / 烫画这些「不要展示数据」。
   本测试锁四件事：
     1) 新增「七、全量数据」，每个维度的全部取值都在（不是前 3 / 前 5）
     2) 图表不再按 5 个取值截断
     3) 数码印花 / 烫画 / 烫金 / 丝印 / 升华 等图案复制类，图表、对照表、全量表里都不出现
     4) 剔除它们不抬高其它工艺的占比（刺绣 30% 还是 30%，不会变 100%） */
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

/* A 列：10 张，工艺 4 张数码印花 + 3 张刺绣 + 3 张水洗（印花占比最高，但必须整类消失）
   结构件刻意给 7 个不同取值，用来验证图表与全量表都不再只取前 5 */
const STRUCT = ["拉链", "口袋", "荷叶边", "抽绳", "绗缝", "毛边", "铆钉"];
const items = [], tags = {};
for (let i = 0; i < 10; i++) {
  const o = mk({ image_url: "a" + i, category: "外套夹克",
    craft_tags: [i < 4 ? "数码印花" : (i < 7 ? "刺绣" : "水洗")],
    struct_tags: [STRUCT[i % STRUCT.length]],
    fit_tags: ["版型·收腰"], fabric_tags: ["纯棉（100%棉）"],
    visual_tags: ["室外·街景（城市商业街）"], style_tags: ["户外机能"] });
  items.push(o);
  tags[o.image_url] = {
    craft_tags: o.craft_tags, struct_tags: o.struct_tags, fit_tags: o.fit_tags,
    fabric_tags: o.fabric_tags, visual_tags: o.visual_tags, style_tags: o.style_tags,
    shoot_tags: ["平铺拍"], element_tags: ["纯色"], culture_tags: [], psych_tags: [],
  };
}
/* B 列：8 张，工艺全是图案复制类 —— 这一列不该出现任何工艺数字 */
for (let i = 0; i < 8; i++) {
  const o = mk({ image_url: "b" + i, category: "POLO", craft_tags: [i < 5 ? "烫画" : "数码印花"] });
  items.push(o);
  tags[o.image_url] = { craft_tags: o.craft_tags, fit_tags: ["版型·常规"],
    visual_tags: ["室内·棚拍（纯色背景）"], style_tags: ["商务通勤"], shoot_tags: ["平铺拍"] };
}

T.set({ facets: { sites: ["美国站"], periods: ["2026-W43"], categories: ["外套夹克", "POLO"] },
  tags, groups: [], mode: "c", cat: "外套夹克", cats: ["外套夹克", "POLO"],
  sites: ["美国站"], periods: ["2026-W43"], cache: { key: "full", items } });

const V = T.vitalsOfGroups(T.vitalsGroups());
const html = T.vitalsHtml(V, T.vitalsDim());

/* ---------------- 1. 全量数据段 ---------------- */
console.log("\n[1] 全量数据段");
ok("有「七、全量数据」段", /rk-rep-sec rk-rep-full/.test(html) && html.indexOf("七</em>全量数据") >= 0);
const full = (html.match(/<section class="rk-rep-sec rk-rep-full">[\s\S]*?<\/section>/) || [])[0] || "";
ok("表头含维度 / 取值 / 张数 / 占比 + 每列各一列",
  /<th>维度<\/th><th>取值<\/th><th>张数<\/th><th>占比<\/th><th>外套夹克<\/th><th>POLO<\/th>/.test(full));
ok("结构件 7 个取值全部列出（不截断）", STRUCT.every(function (v) { return full.indexOf(">" + v + "<") >= 0; }),
  STRUCT.filter(function (v) { return full.indexOf(">" + v + "<") < 0; }).join(","));
ok("行数 = 各维度取值数之和（至少 10 行）", (full.match(/<tr>/g) || []).length >= 10);
ok("取值占比与张数成对出现", /<td>拉链<\/td><td>\d+<\/td><td>\d+%<\/td>/.test(full));

/* ---------------- 2. 图表不截断 ---------------- */
console.log("\n[2] 图表不截断");
const structChart = (html.match(/图 · 结构部件[\s\S]{0,4000}?<\/div><\/div>/g) || [])[0] || "";
ok("结构件图里出现 7 个取值", STRUCT.filter(function (v) { return html.indexOf('class="rk-ch-rl">' + v) >= 0; }).length >= 7);
ok("源码里不再有 slice(0, 5) 的取值截断",
  !/\.sort\(function \(a, b\) \{ return b\.mx - a\.mx; \}\)\.slice\(0, 5\)/.test(
    fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8")));

/* ---------------- 3. 图案复制类整类不展示 ---------------- */
console.log("\n[3] 图案复制类不展示");
const noNote = html.replace(/<p class="rk-rep-note">[\s\S]*?<\/p>/g, "");
ok("正文（除口径说明）不出现数码印花", noNote.indexOf("数码印花") < 0);
ok("正文（除口径说明）不出现烫画", noNote.indexOf("烫画") < 0);
ok("全量表里没有图案复制类行", !/<td>(数码印花|烫画|烫金|丝印|升华)<\/td>/.test(full));
ok("对照表工艺行不是图案复制类", !/<td><span class="rk-cell"><span class="rk-cell-k">(数码印花|烫画)/.test(noNote));
ok("POLO 列（全图案类）不给工艺推荐",
  noNote.indexOf("「POLO」的二次工艺里，质感类出现最多的是") < 0);
ok("POLO 列入榜单列不显示工艺百分比", !/POLO[\s\S]{0,80}数码印花/.test(noNote));

/* ---------------- 4. 分母不被抬高 ---------------- */
console.log("\n[4] 口径");
const pctOf = (nm) => {
  const m = html.match(new RegExp("<b>" + nm + "<\\/b>（(\\d+)%，(\\d+) 张）"));
  return m ? m[1] + "% / " + m[2] + " 张" : "未找到";
};
ok("刺绣仍是 30% / 3 张（4 张印花被剔除但分母不变）", pctOf("刺绣") === "30% / 3 张", pctOf("刺绣"));
ok("水洗仍是 30%（并列列举里保留）", /水洗[^0-9]{0,6}30%/.test(html),
  (html.match(/水洗[^0-9]{0,6}\d+%/) || [])[0]);
ok("尾注说明图案复制类整类不展示", /图案复制类/.test(html) && /原始标签仍可在逐张看图时查看/.test(html));

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
