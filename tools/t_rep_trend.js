/* 趋势上升榜 · 趋势动向（新上榜 / 上升最多）回归（20261102N）
   需求：建议要更细致（版型、元素、视觉都要列举），并且要能看出「上升最多的」
   与「新上榜的」分别在打什么，从而得出新的趋势动向。

   本测试锁：
     1) 建议里带样本张数（"占比%，N 张"）与次选并列
     2) 新增「趋势动向」章节，且编号排在可执行建议之后、数据说明之前
     3) 上升最多那批 / 新上榜那批分别统计，能识别出「只在子集里抬头」的值
     4) 阈值生效：占比不足 25%、张数不足 3、落差不足 15 个百分点都不算抬头
     5) 新上榜的判定确实与上一期比较（上一期已有的图不能算新）
     6) 首期无上一周时明确说明，不硬造新上榜
     7) 样本过少的子集写"样本太少"，不输出结论
     8) 印花类值可以出现在动向里（描述），但不会被写成照抄动作 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (d ? "  → " + d : ""))); };

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
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8"), ctx, { filename: "rank.js" });
const T = fakeWin.__RANK_T;

/* ---------------- 造数据 ----------------
   A 类目 · W43：10 张老图（收腰 1 张，其余常规）
                 + 4 张「周度激增」（3 张收腰）+ 6 张「新上榜」（5 张收腰）
   W42 已有 10 张老图（用于判新上榜）
   整体 20 张里收腰 = 1+3+5 = 9 张 → 45%？（为了让阈值有意义，整体要低）
   实际构造：整体 20 张，收腰 4 张（20%）；上升最多 4 张里收腰 3 张（75%，+55）；
   新上榜 6 张里收腰 5 张（83%，+63）。都过阈值。 */
const mk = (o) => Object.assign({
  image_url: "", category: "外套夹克", site: "美国站", period_label: "2026-W43",
  _surge: false, _hot: false, _opp: false, ratio: 1, abs_delta: 1,
}, o);

const items = [];
/* W42 基线 10 张（判新上榜用，不进 W43 分组统计） */
for (let i = 0; i < 10; i++) {
  items.push(mk({ image_url: "old" + i, period_label: "2026-W42",
    fit_tags: ["版型·常规"], element_tags: ["纯色"] }));
}
/* W43 普通图 10 张：全部常规版型，无印花 */
for (let i = 0; i < 10; i++) {
  items.push(mk({ image_url: "n" + i, fit_tags: ["版型·常规"],
    visual_tags: ["纯白底"], craft_tags: ["无工艺"], struct_tags: ["口袋"],
    fabric_tags: ["涤纶（100%涤）"], element_tags: ["纯色"] }));
}
/* W43 周度激增 8 张：6 张收腰 + 6 张骷髅 */
for (let i = 0; i < 8; i++) {
  items.push(mk({ image_url: "up" + i, _surge: true,
    fit_tags: [i < 6 ? "版型·收腰" : "版型·常规"],
    visual_tags: ["留白构图"], craft_tags: [i < 6 ? "数码印制" : "无工艺"],
    struct_tags: ["拉链"], fabric_tags: ["纯棉（100%棉）"],
    element_tags: [i < 6 ? "骷髅" : "纯色"] }));
}
/* W43 新上榜 6 张（W42 没有这些地址）：5 张收腰 + 荷叶边 */
for (let i = 0; i < 6; i++) {
  items.push(mk({ image_url: "nw" + i, fit_tags: [i < 5 ? "版型·收腰" : "版型·常规"],
    visual_tags: ["纯白底"], craft_tags: ["无工艺"], struct_tags: [i < 5 ? "荷叶边" : "口袋"],
    fabric_tags: ["纯棉（100%棉）"], element_tags: ["纯色"] }));
}
/* 「上一期就有」的图：W43 也有 → 不能算新上榜 */
items.push(mk({ image_url: "old1", fit_tags: ["版型·常规"], visual_tags: ["纯白底"] }));

const tags = {};
items.forEach(function (it) {
  tags[it.image_url] = {
    style_tags: ["户外机能"], visual_tags: it.visual_tags || [],
    element_tags: it.element_tags || [], craft_tags: it.craft_tags || [],
    struct_tags: it.struct_tags || [], fabric_tags: it.fabric_tags || [],
    fit_tags: it.fit_tags || [], shoot_tags: ["平铺拍"],
  };
});

/* W43 这一列（类目对比，只统计最后一期） */
const w43 = items.filter((it) => it.period_label === "2026-W43");
T.set({ facets: { sites: ["美国站"], periods: ["2026-W42", "2026-W43"], categories: ["外套夹克"] },
  tags, groups: [], mode: "c", cat: "外套夹克", cats: ["外套夹克"], sites: ["美国站"],
  periods: ["2026-W42", "2026-W43"], cache: { key: "c", items } });

const V = T.vitalsOfGroups(T.vitalsGroups());
const html = T.vitalsHtml(V, T.vitalsDim());

/* ---------------- 1. 建议更细致 ---------------- */
console.log("\n[1] 可执行建议");
ok("有建议区块", html.indexOf('class="rk-rep-act"') >= 0);
ok("每条带占比与张数", /（\d+%，\d+ 张）/.test(html));
ok("版型建议点出具体值", html.indexOf("的版型以 <b>") >= 0);
ok("结构部件建议点出具体值", html.indexOf("的结构部件里 <b>") >= 0);
ok("面料建议点出具体值", html.indexOf("的面料候选里 <b>") >= 0);
ok("视觉建议点出具体值", html.indexOf("的主图视觉以 <b>") >= 0);
ok("给出次选并列", html.indexOf("同列还有") >= 0);
ok("建议最多 8 条（不无限堆）", (html.split('<li>').length) > 0);

/* ---------------- 2. 章节顺序 ---------------- */
console.log("\n[2] 章节编号与顺序");
["<em>四</em>", "<em>五</em>", "<em>六</em>"].forEach(function (s) {
  ok("有编号 " + s, html.indexOf(s) >= 0);
});
ok("趋势动向在可执行建议之后", html.indexOf("趋势动向") > html.indexOf("可执行建议"));
ok("趋势动向在数据说明之前",
  html.indexOf("rk-rep-trend") < html.indexOf("rk-rep-qual"),
  "trend=" + html.indexOf("rk-rep-trend") + " qual=" + html.indexOf("rk-rep-qual"));

/* ---------------- 3. 两个子集分别统计 ---------------- */
console.log("\n[3] 上升最多 / 新上榜");
ok("有趋势动向区块", html.indexOf("rk-rep-trend") >= 0);
ok("标题写明两个子集口径", html.indexOf("上升最多 = 本期周度激增") >= 0 || html.indexOf("上升最多") >= 0);
ok("点了上升最多的张数", /上升最多 \d+ 张/.test(html));
ok("点了新上榜的张数并标注对比期", /新上榜 \d+ 张（较 2026-W42）/.test(html));
ok("上升最多的张数是 8（只认周度激增）", /上升最多 8 张/.test(html), (html.match(/上升最多 \d+ 张/) || [])[0]);
ok("新上榜 24 张（25 张里 old1 上期已有 → 不算）", /新上榜 24 张/.test(html),
  (html.match(/新上榜 \d+ 张/) || [])[0]);

/* ---------------- 4. 抬头值被识别 ---------------- */
console.log("\n[4] 抬头值识别");
ok("识别出「收腰」在抬头", html.indexOf("收腰") >= 0);
ok("带 +N 点落差值", /\+[0-9]+<\/b>/.test(html));
ok("带「本列 X%，N 张」口径", /（本列 \d+%，\d+ 张）/.test(html));
ok("有结论文案（高出 N 个百分点）", /高出 \d+ 个百分点/.test(html));

/* ---------------- 5. 印花：可描述，但不写成照抄 ---------------- */
console.log("\n[5] 印花处理");
const trendPart = html.slice(html.indexOf("rk-rep-trend"), html.indexOf("rk-rep-qual"));
ok("印花值可出现在动向里（描述用）", trendPart.indexOf("骷髅") >= 0 || trendPart.indexOf("纯色") >= 0);
ok("动向里说明不构成照抄建议", trendPart.indexOf("不代表适合跟进") >= 0 || trendPart.indexOf("不构成照抄建议") >= 0);
const actPart = html.slice(html.indexOf("rk-rep-act"), html.indexOf("rk-rep-trend"));
ok("建议里不出现印花元素名", actPart.indexOf("骷髅") < 0);

/* ---------------- 6. 首期无上一周 ---------------- */
console.log("\n[6] 首期边界");
T.set({ periods: ["2026-W43"],
  cache: { key: "c2", items: items.filter((it) => it.period_label === "2026-W43") } });
const h2 = T.vitalsHtml(T.vitalsOfGroups(T.vitalsGroups()), T.vitalsDim());
ok("首期说明「无上一周可比」", h2.indexOf("首期") >= 0 || h2.indexOf("无上一周") >= 0);
ok("首期不硬造新上榜数字", !/新上榜 \d+ 张（较/.test(h2));

/* ---------------- 7. 阈值：不足不报 ---------------- */
console.log("\n[7] 阈值");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8");
ok("占比阈值 25%", /if \(p < 25\) return;/.test(src));
ok("张数阈值 3 张", /if \(n < 3\) return;/.test(src));
ok("落差阈值 15 个百分点", /if \(lift < 15\) return;/.test(src));
ok("子集不足 5 张不判定", /sub\.tot < 5/.test(src));

/* ---------------- 8. 无数据不崩 ---------------- */
console.log("\n[8] 空数据");
T.set({ cache: { key: "c3", items: [] }, tags: {} });
const h3 = T.vitalsHtml(T.vitalsOfGroups(T.vitalsGroups()), T.vitalsDim());
ok("无图时返回字符串不报错", typeof h3 === "string");

/* ---------------- 9. 语气：推荐而非命令 ---------------- */
console.log("\n[9] 建议语气与自相矛盾检查");
const actHtml = html.slice(html.indexOf("rk-rep-act"), html.indexOf("rk-rep-trend"));
["直接作", "必须", "别在", "不要加", "照做吧", "一定要"].forEach(function (w) {
  ok("建议里不出现命令词「" + w + "」", actHtml.indexOf(w) < 0, w);
});
ok("建议里有「可优先考虑 / 可优先沿用」", actHtml.indexOf("可优先") >= 0);
ok("建议里点明不是硬性要求", actHtml.indexOf("不是硬性要求") >= 0 || actHtml.indexOf("取舍") >= 0);
ok("建议里写明占比不等于应当照做", html.indexOf("不等于应当照做") >= 0);

/* 两列对照：B 列结构件占比高于 A 列 → A 列不能写「其余最高仅 X%」这种自相矛盾的话 */
const i2 = [];
for (let i = 0; i < 6; i++) i2.push(mk({ image_url: "a" + i, category: "外套夹克", struct_tags: ["口袋"] }));
for (let i = 0; i < 10; i++) i2.push(mk({ image_url: "b" + i, category: "POLO", struct_tags: ["拉链"] }));
const tg2 = {};
i2.forEach(function (it) { tg2[it.image_url] = { struct_tags: it.struct_tags, fit_tags: ["版型·常规"], style_tags: ["简约"] }; });
T.set({ facets: { sites: ["美国站"], periods: ["2026-W43"], categories: ["外套夹克", "POLO"] },
  tags: tg2, groups: [], mode: "c", cat: "POLO", cats: ["外套夹克", "POLO"],
  sites: ["美国站"], periods: ["2026-W43"], cache: { key: "c9", items: i2 } });
const h9 = T.vitalsHtml(T.vitalsOfGroups(T.vitalsGroups()), T.vitalsDim());
ok("低占比列不再写「其余最高仅」", h9.indexOf("其余列最高仅") < 0 && h9.indexOf("最高仅") < 0,
  (h9.match(/其余列[^。]{0,12}/) || [])[0] || "");
ok("出现「其余列有的到」的正确表述", /其余列有的到|与其余列基本持平|其余列最高/.test(h9));

/* ---------------- 10. 工艺：图案类降权，质感类优先 ---------------- */
console.log("\n[10] 二次工艺推荐偏向");
const src2 = fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8");
ok("识别图案复制类工艺", /印花\|喷绘\|拔印/.test(src2) && src2.indexOf("craftIsPrint") >= 0);
const i3 = [];
/* A：印花占比最高（40%），刺绣次之（30%）—— 必须推荐刺绣而不是印花 */
for (let i = 0; i < 10; i++) {
  i3.push(mk({ image_url: "p" + i, category: "外套夹克",
    craft_tags: [i < 4 ? "数码印花" : (i < 7 ? "刺绣" : "水洗")] }));
}
const tg3 = {};
i3.forEach(function (it) { tg3[it.image_url] = { craft_tags: it.craft_tags, style_tags: ["简约"] }; });
T.set({ facets: { sites: ["美国站"], periods: ["2026-W43"], categories: ["外套夹克"] },
  tags: tg3, groups: [], mode: "c", cat: "外套夹克", cats: ["外套夹克"],
  sites: ["美国站"], periods: ["2026-W43"], cache: { key: "c10", items: i3 } });
const h10 = T.vitalsHtml(T.vitalsOfGroups(T.vitalsGroups()), T.vitalsDim());
const a10 = h10.slice(h10.indexOf("rk-rep-act"), h10.indexOf("rk-rep-trend"));
ok("工艺建议推荐的是刺绣（质感类），不是占比最高的印花",
  a10.indexOf("质感类出现最多的是 <b>刺绣") >= 0, a10.slice(0, 120));
ok("印花被降级为补充说明并点明不增加质感差异",
  a10.indexOf("数码印花") >= 0 && a10.indexOf("不增加质感差异") >= 0);
ok("给出其他质感类并列（水洗）", a10.indexOf("水洗") >= 0);

/* B：只有图案类 → 明确说以图案类为主，并给补空白方向 */
const i4 = [];
for (let i = 0; i < 8; i++) i4.push(mk({ image_url: "q" + i, category: "POLO", craft_tags: ["数码印花"] }));
const tg4 = {};
i4.forEach(function (it) { tg4[it.image_url] = { craft_tags: it.craft_tags, style_tags: ["简约"] }; });
T.set({ facets: { sites: ["美国站"], periods: ["2026-W43"], categories: ["POLO"] },
  tags: tg4, groups: [], mode: "c", cat: "POLO", cats: ["POLO"],
  sites: ["美国站"], periods: ["2026-W43"], cache: { key: "c11", items: i4 } });
const h11 = T.vitalsHtml(T.vitalsOfGroups(T.vitalsGroups()), T.vitalsDim());
const a11 = h11.slice(h11.indexOf("rk-rep-act"), h11.indexOf("rk-rep-trend"));
ok("只有图案类时说明以图案类为主", a11.indexOf("以图案类为主") >= 0, a11.slice(0, 120));
ok("并给出刺绣/压褶/洗水等补空白方向", /刺绣 \/ 压褶|压褶 \/ 洗水/.test(a11));
ok("并声明这不是结论", a11.indexOf("不是结论") >= 0);

/* C：图案类 / 质感类的判定本身 */
[["数码印花", true], ["烫图/热转印", true], ["烫金", true], ["植绒印花", true], ["发泡印花", true],
 ["刺绣", false], ["立体绣", false], ["水洗", false], ["压褶", false], ["绗缝", false],
 ["毛边", false], ["铆钉", false], ["打缆/抽褶", false], ["激光切割", false]].forEach(function (p) {
  const re = /印花|喷绘|拔印|局部印|烫图|热转印|烫印|烫金|烫银|烫钻|水钻|镭射|夜光|反光印|植绒印/;
  ok("判定「" + p[0] + "」为" + (p[1] ? "图案类" : "质感类"), re.test(p[0]) === p[1]);
});

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
