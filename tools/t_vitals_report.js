/* 趋势上升榜 · 构成分析报告自测（20261102H）
   目的：体征区块以前只有三列百分比卡片 + 3 条洞察，读数靠人自己做减法。
   现在要求它读起来像一份报告：口径头 → 编号结论 → 横向对照（带 ▲/▼）
   → 逐列画像 → 可执行建议 → 数据说明。这里逐层验证，并守住边界：
   单列不出结论、空列不误报、三列都出对应口径文案。 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };

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

const P1 = "2026-W42", P2 = "2026-W43";
const S1 = "美国站", S2 = "德国站";
const C1 = "外套夹克", C2 = "POLO";
const mk = (o) => Object.assign({
  image_url: "", category: C1, site: S1, period_label: P2,
  _opp: false, _hot: false, _surge: false,
}, o);

/* 刻意造出「两列差异极大」：A 列全是模拍 + 户外机能，B 列全是 3D + 商务通勤。
   这样报告必须把差异点出来，而不是平均罗列。 */
const tags = {
  a1: { style_tags: ["户外机能"], visual_tags: ["纯白底"], shoot_tags: ["模拍"], craft_tags: ["刺绣"], element_tags: ["拼接"] },
  a2: { style_tags: ["户外机能"], visual_tags: ["纯白底"], shoot_tags: ["模拍"], craft_tags: ["刺绣"], element_tags: ["字母"] },
  a3: { style_tags: ["户外机能"], visual_tags: ["留白构图"], shoot_tags: ["模拍"], craft_tags: ["无工艺"], element_tags: ["拼接"] },
  a4: { style_tags: ["机车风"], visual_tags: ["纯白底"], shoot_tags: ["模拍"], craft_tags: ["无工艺"], element_tags: ["品牌LOGO"] },
  b1: { style_tags: ["商务通勤"], visual_tags: ["3D渲染图"], shoot_tags: ["3D"], craft_tags: ["刺绣"], element_tags: ["文字标"] },
  b2: { style_tags: ["商务通勤"], visual_tags: ["3D渲染图"], shoot_tags: ["3D"], craft_tags: ["刺绣"], element_tags: ["字母"] },
  b3: { style_tags: ["商务通勤"], visual_tags: ["3D渲染图"], shoot_tags: ["3D"], craft_tags: ["热转印"], element_tags: ["文字标"] },
  b4: { style_tags: ["休闲"], visual_tags: ["单图精修"], shoot_tags: ["平铺拍"], craft_tags: ["无工艺"], element_tags: ["文字标"] },
};

/* 类目对比口径：单站点、单周，两类目各 4 张 */
const CACHE_C = { key: "c", items: [
  mk({ image_url: "a1", category: C1, _surge: true }), mk({ image_url: "a2", category: C1, _opp: true }),
  mk({ image_url: "a3", category: C1, _opp: true }), mk({ image_url: "a4", category: C1, _opp: true }),
  mk({ image_url: "b1", category: C2, _opp: true }), mk({ image_url: "b2", category: C2, _opp: true }),
  mk({ image_url: "b3", category: C2, _opp: true }), mk({ image_url: "b4", category: C2, _opp: true }),
] };
/* 国家对比口径：单类目、单周，两国各 4 张 */
const CACHE_H = { key: "h", items: CACHE_C.items.map(x => Object.assign({}, x, { site: x.category === C1 ? S1 : S2 })) };
/* 纵向口径：单站点 + 单类目，两周各 4 张 */
const CACHE_V = { key: "v", items: [
  mk({ image_url: "a1", _surge: true }), mk({ image_url: "a2", _opp: true }),
  mk({ image_url: "a3", _opp: true }), mk({ image_url: "a4", _opp: true }),
  mk({ image_url: "b1", period_label: P1, _hot: true }), mk({ image_url: "b2", period_label: P1, _hot: true }),
  mk({ image_url: "b3", period_label: P1 }), mk({ image_url: "b4", period_label: P1 }),
] };

T.set({ facets: { sites: [S1, S2], periods: [P1, P2], categories: [C1, C2] }, tags, groups: [] });

/* ---------------- 1. 类目对比：报告分层 ---------------- */
console.log("\n[1] 横向 · 类目对比：报告结构");
T.set({ mode: "c", cat: C1, cats: [C1, C2], sites: [S1], periods: [P2], cache: CACHE_C });
let V = T.vitalsOfGroups(T.vitalsGroups());
let html = T.vitalsHtml(V, T.vitalsDim());

ok("① 报告头存在", html.indexOf('class="rk-rep-head"') >= 0);
ok("① 标题是「趋势构成分析报告」", html.indexOf("趋势构成分析报告") >= 0);
ok("① 口径写明对比类目", html.indexOf("对比类目") >= 0);
ok("① 样本量写明总数", html.indexOf("样本 <b>8</b> 张上榜图") >= 0, "");
ok("① 有打标覆盖率（KPI 卡 + 圆环）", /打标覆盖<\/b><em>\d+ \/ \d+ 张带标签/.test(html)
  && /class="rk-kpi-ring"/.test(html) && /<b>\d+%<\/b><\/span>/.test(html));
ok("① 有生成时间", /生成于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(html));

ok("② 有一~六 六个编号段",
  ["<em>一</em>", "<em>二</em>", "<em>三</em>", "<em>四</em>", "<em>五</em>", "<em>六</em>"].every(s => html.indexOf(s) >= 0));
ok("② 核心结论带编号列表", html.indexOf("核心结论") >= 0 && html.indexOf("rk-rep-sum") >= 0);
ok("② 结论里出现具体类目名", html.indexOf("外套夹克") >= 0 || html.indexOf("POLO") >= 0);
ok("② 结论带百分点数字", /高 \d+ 个百分点|个百分点/.test(html));

ok("③ 横向对照表存在", html.indexOf('class="rk-rep-tbl"') >= 0);
ok("③ 表头两列都出现", html.indexOf("<th>外套夹克") >= 0 && html.indexOf("<th>POLO") >= 0);
ok("③ 表头带样本张数", html.indexOf('class="rk-rep-th-n"') >= 0);
ok("③ 用 ▲ 标出显著偏高", html.indexOf("▲") >= 0, "落差 100→0 应触发 ▲");
ok("③ 对照表覆盖风格/视觉/拍摄方式", ["风格", "视觉", "拍摄方式"].every(s => html.indexOf("<th>" + s + "</th>") >= 0));

ok("④ 逐列画像标题存在", html.indexOf("逐列画像") >= 0);
ok("④ 每列都有画像句", (html.match(/rk-vit-prof/g) || []).length >= 2);
ok("④ 画像句以工艺开头（商家口径）", html.indexOf("工艺主打「") >= 0 || html.indexOf("多数没有二次工艺") >= 0);
ok("④ 画像句不再以风格为主线", html.indexOf("风格以「") < 0);

ok("⑤ 可执行建议存在", html.indexOf('class="rk-rep-act"') >= 0);
ok("⑤ 建议里点到主图拍法（写成可选）", html.indexOf("主图可优先沿用这个拍法") >= 0);
ok("⑤ 建议带样本张数（占比+张数）", /（\d+%，\d+ 张）/.test(html));
ok("⑤ 建议给出次选并列", html.indexOf("次选") >= 0 || html.indexOf("同列还有") >= 0);
ok("⑤ 有量无爆的判定被给出", html.indexOf("有量无爆") >= 0 || html.indexOf("有量但缺爆点") >= 0);

ok("⑥ 数据说明存在", html.indexOf("rk-rep-qual") >= 0);
ok("⑥ 写明只比构成不比张数", html.indexOf("只比<b>构成</b>") >= 0);
ok("⑥ 写明分母口径", html.indexOf("未打标的图不计入分母") >= 0);
ok("⑥ 写明本次覆盖率", html.indexOf("带打标数据") >= 0);

ok("原三列体征卡仍在（数据底稿没丢）", html.indexOf('class="rk-vitals"') >= 0);
ok("原差异洞察仍在", html.indexOf("这几个类目差别在哪") >= 0);
ok("段落顺序：结论在对照表之前", html.indexOf("核心结论") < html.indexOf("关键维度横向对照"));
ok("段落顺序：建议在画像之后", html.indexOf("可执行建议") > html.indexOf("逐列画像"));

/* ---------------- 2. 国家对比：口径文案跟着变 ---------------- */
console.log("\n[2] 横向 · 国家对比");
T.set({ mode: "h", cat: C1, sites: [S1, S2], periods: [P2], group: "", cache: CACHE_H });
V = T.vitalsOfGroups(T.vitalsGroups());
html = T.vitalsHtml(V, T.vitalsDim());
ok("口径写对比国家", html.indexOf("对比国家") >= 0);
ok("对照表说明用「国家」", html.indexOf("其余国家首位标签相比") >= 0);
ok("仍有报告头与结论", html.indexOf("趋势构成分析报告") >= 0 && html.indexOf("核心结论") >= 0);
ok("国家对比也给建议", html.indexOf('class="rk-rep-act"') >= 0);

/* ---------------- 3. 纵向时间对比 ---------------- */
console.log("\n[3] 纵向 · 时间对比");
T.set({ mode: "v", cat: C1, sites: [S1], periods: [P1, P2], cache: CACHE_V });
V = T.vitalsOfGroups(T.vitalsGroups());
html = T.vitalsHtml(V, T.vitalsDim());
ok("口径写对比周次", html.indexOf("对比周次") >= 0);
ok("对照表说明用「周次」", html.indexOf("其余周次首位标签相比") >= 0);
ok("得到两列", V.length === 2, String(V.length));
ok("周长口径结论不出现「类目」误称", html.indexOf("这几个类目差别在哪") < 0);

/* ---------------- 4. 边界 ---------------- */
console.log("\n[4] 边界");
/* 单列：没有对比对象，不硬造结论与对照表 */
T.set({ mode: "c", cat: C1, cats: [C1], sites: [S1], periods: [P2], cache: { key: "c", items: CACHE_C.items.filter(x => x.category === C1) } });
V = T.vitalsOfGroups(T.vitalsGroups());
html = T.vitalsHtml(V, T.vitalsDim());
ok("单列仍出报告头", html.indexOf("趋势构成分析报告") >= 0);
ok("单列不出核心结论（没有对比对象）", html.indexOf("rk-rep-sum") < 0);
ok("单列不出横向对照表", html.indexOf('class="rk-rep-tbl"') < 0);
ok("单列仍出逐列画像", html.indexOf("逐列画像") >= 0);
ok("单列仍出数据说明", html.indexOf("rk-rep-qual") >= 0);

/* 空列：有分组但某列 0 张，不能把 0% 当成"最低"写进结论而不提空态 */
T.set({ mode: "c", cat: C1, cats: [C1, C2], sites: [S1], periods: [P2],
  cache: { key: "c", items: CACHE_C.items.filter(x => x.category === C1) } });
V = T.vitalsOfGroups(T.vitalsGroups());
html = T.vitalsHtml(V, T.vitalsDim());
ok("空列仍有卡片（不静默消失）", html.indexOf("无数据") >= 0);
ok("空列不参与结论计算", html.indexOf("rk-rep-sum") < 0, "只剩一列有数据");

/* 小样本提示：列内图少于 30 张要提示 */
ok("小样本提示存在", html.indexOf("样本不足 30 张") >= 0 || html.indexOf("最小样本列仅") >= 0);

/* 未打标：无标签图不该让报告崩掉 */
T.set({ mode: "c", cat: C1, cats: [C1, C2], sites: [S1], periods: [P2], tags: {},
  cache: CACHE_C });
V = T.vitalsOfGroups(T.vitalsGroups());
html = T.vitalsHtml(V, T.vitalsDim());
ok("无打标数据时仍能出报告骨架", html.indexOf("趋势构成分析报告") >= 0);
ok("无打标数据时覆盖率显示 0%", html.indexOf("<b>0%</b></span>") >= 0
  && /打标覆盖<\/b><em>0 \/ \d+ 张带标签/.test(html));
ok("无打标数据时不出现空对照表", html.indexOf('class="rk-rep-tbl"') < 0);

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
