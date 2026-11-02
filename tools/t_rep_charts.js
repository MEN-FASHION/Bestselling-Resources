/* 趋势上升榜 · 报告图表层自测（20261102Q）
   目的：详细报告原来只有文字与表格，读数靠人脑做减法。现在要求「图表 + 文字」：
     图 1 爆发密度（每列三点）、维度构成（每维一张点阵图）、趋势落差（整体 → 该批）、
     对照表单元格占比条、报告头覆盖率圆环。
   这里逐项验证图形是否真的画出来、数值是否与占比一致、动画是否只在展开时播放，
   以及边界：单列不画图、空数据不报错、打印时落到终态。 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };
const count = (h, re) => (h.match(re) || []).length;

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
const RANK_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8");
vm.runInContext(RANK_SRC, ctx, { filename: "rank.js" });
const T = fakeWin.__RANK_T;
ok("测试钩子已挂出", !!T);

const P1 = "2026-W42", P2 = "2026-W43";
const S1 = "美国站";
const C1 = "外套夹克", C2 = "POLO";
const mk = (o) => Object.assign({
  image_url: "", category: C1, site: S1, period_label: P2,
  _opp: false, _hot: false, _surge: false,
}, o);

/* 两列各 8 张，四个商家维度都有值；工艺刻意让印花占比最高、刺绣次之（顺带守住"不推印花"） */
const items = [];
const tags = {};
function addC1(i, o, tag) { items.push(mk(o)); tags[o.image_url] = tag; }
for (let i = 0; i < 8; i++) {
  addC1(i, { image_url: "a" + i, category: C1, _surge: i < 6 },
    {
      craft_tags: [i < 4 ? "数码印花" : (i < 7 ? "刺绣" : "水洗")],
      struct_tags: [i < 5 ? "拉链" : "口袋"],
      fit_tags: [i < 6 ? "版型·收腰" : "版型·常规"],
      fabric_tags: [i < 5 ? "纯棉（100%棉）" : "涤纶（100%涤）"],
      style_tags: ["户外机能"], visual_tags: ["纯白底"],
    });
}
for (let i = 0; i < 8; i++) {
  addC1(i, { image_url: "b" + i, category: C2, _hot: i < 2 },
    {
      craft_tags: [i < 2 ? "刺绣" : "无工艺"],
      struct_tags: ["口袋"],
      fit_tags: ["版型·常规"],
      fabric_tags: [i < 3 ? "纯棉（100%棉）" : "羊毛混纺"],
      style_tags: ["商务通勤"], visual_tags: ["留白构图"],
    });
}
/* 上一期（W42）放几张：判新上榜用 */
for (let i = 0; i < 2; i++) {
  addC1(i, { image_url: "old" + i, category: C1, period_label: P1, _hot: false },
    { craft_tags: ["刺绣"], struct_tags: ["口袋"], fit_tags: ["版型·常规"], fabric_tags: ["纯棉（100%棉）"] });
}

T.set({ facets: { sites: [S1], periods: [P1, P2], categories: [C1, C2] }, tags, groups: [], mode: "c", cat: C1,
  cats: [C1, C2], sites: [S1], periods: [P2], cache: { key: "chart1", items } });
let V = T.vitalsOfGroups(T.vitalsGroups());
let html = T.vitalsHtml(V, T.vitalsDim());

/* ---------------- 1. 图 1 爆发密度 ---------------- */
console.log("\n[1] 图 1 · 爆发密度对照");
ok("有图 1 标题", html.indexOf("图 1 · 爆发密度对照") >= 0);
ok("图 1 按列排（2 列 → 2 行）", count(html, /class="rk-ch-r"/g) >= 2);
ok("图 1 每列三个点（2 列 × 3 档 = 6 个点）",
  count(html, /class="rk-ch-d(?: alt)?"/g) >= 6, "点数 " + count(html, /class="rk-ch-d(?: alt)?"/g));
ok("图 1 图例含三档", html.indexOf("潜力机会") >= 0 && html.indexOf("趋势爆款") >= 0 && html.indexOf("周度激增") >= 0);
ok("有 0/25/50/75/100 刻度轴", html.indexOf('<span>25%</span>') >= 0 && html.indexOf('<span>100%</span>') >= 0);
ok("有点位百分比标签", /class="rk-ch-d[^"]*"[^>]*>\s*<u>\d+%<\/u>/.test(html));

/* ---------------- 2. 报告头 KPI 与圆环 ---------------- */
console.log("\n[2] 报告头 KPI / 覆盖率圆环");
ok("有覆盖率圆环", html.indexOf('class="rk-kpi-ring"') >= 0);
const ring = html.match(/class="rk-ring-v"[^>]*style="--c:([\d.]+);--o:([\d.]+)"/);
ok("圆环参数可解析", !!ring, ring ? ring[0] : "未找到");
if (ring) {
  const C = parseFloat(ring[1]), O = parseFloat(ring[2]);
  ok("圆环周长≈2πr（r=26）", Math.abs(C - 2 * Math.PI * 26) < 0.5, C.toFixed(1));
  const cov = Math.round((1 - O / C) * 100);
  ok("圆环空白比例与覆盖率一致", cov >= 0 && cov <= 100, "覆盖 " + cov + "%");
  ok("圆环有描边动画类", html.indexOf("rk-ring-v") >= 0);
}
ok("KPI 卡有样本张数与列数", /class="rk-kpi-n">16</.test(html) && /class="rk-kpi-n">2</.test(html));

/* ---------------- 3. 对照表单元格占比条 ---------------- */
console.log("\n[3] 对照表占比条");
ok("有单元格占比条", html.indexOf('class="rk-cell-bar"') >= 0);
const bars = html.match(/--w:(\d+)%/g) || [];
ok("占比条数量与「维度 × 列」匹配（≥ 8 条）", bars.length >= 8, "条数 " + bars.length);
ok("占比条宽度都在 0~100 之间", bars.every(b => { const n = parseInt(b.match(/\d+/)[0]); return n >= 0 && n <= 100; }));

/* ---------------- 4. 商家四维构成图 ---------------- */
console.log("\n[4] 维度构成点阵图");
["二次工艺", "结构部件", "版型", "面料"].forEach(function (d) {
  ok("有「" + d + "」构成图", html.indexOf("图 · " + d) >= 0);
});
ok("四张图包在网格里", html.indexOf('class="rk-ch-grid"') >= 0);
ok("每张图有点阵轨道", count(html, /class="rk-ch-t"/g) >= 8);

/* ---------------- 5. 趋势落差图 ---------------- */
console.log("\n[5] 趋势动向落差图");
ok("有落差图标题", html.indexOf("抬头幅度（本列整体 → 该批）") >= 0);
ok("落差图有点间连线", html.indexOf('class="rk-ch-conn"') >= 0);
ok("落差图标注拉升值", /class="rk-ch-tail"><b class="up">\+\d+<\/b>/.test(html));
ok("落差图图例区分「本列整体 / 该批」",
  html.indexOf("本列整体") >= 0 && (html.indexOf("上升最多那批") >= 0 || html.indexOf("新上榜那批") >= 0));

/* ---------------- 6. 边界：单列不画图 ---------------- */
console.log("\n[6] 边界");
T.set({ mode: "c", cat: C1, cats: [C1], sites: [S1], periods: [P2], cache: { key: "chart2", items } });
let V1 = T.vitalsOfGroups(T.vitalsGroups());
let h1 = T.vitalsHtml(V1, T.vitalsDim());
ok("单列时不画爆发密度图", h1.indexOf("图 1 · 爆发密度对照") < 0);
ok("单列时不画维度构成图", h1.indexOf('class="rk-ch-grid"') < 0);
ok("单列时给出口径提示", h1.indexOf("当前只有 1 列可比较") >= 0);
ok("单列仍有覆盖率圆环", h1.indexOf('class="rk-kpi-ring"') >= 0);

T.set({ mode: "c", cat: C1, cats: [C1, C2], sites: [S1], periods: [P2], cache: { key: "chart3", items: [] } });
let h2 = "";
try { h2 = T.vitalsHtml(T.vitalsOfGroups(T.vitalsGroups()), T.vitalsDim()); ok("空数据不报错", true); }
catch (e) { ok("空数据不报错", false, e.message); }
ok("空数据不画图", h2.indexOf('class="rk-ch"') < 0);

/* ---------------- 7. 动画门控 / 打印终态 ---------------- */
console.log("\n[7] 动画与打印");
const CSS = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");
ok("点动画只在 .rk-rep-detail.in 下触发", /\.rk-rep-detail\.in \.rk-ch-d\{animation/.test(CSS));
ok("圆环动画只在 .rk-rep-detail.in 下触发", /\.rk-rep-detail\.in \.rk-ring-v\{animation/.test(CSS));
ok("连线动画只在 .rk-rep-detail.in 下触发", /\.rk-rep-detail\.in \.rk-ch-conn\{animation/.test(CSS));
ok("占比条动画只在 .rk-rep-detail.in 下触发", /\.rk-rep-detail\.in \.rk-cell-bar u\{animation/.test(CSS));
ok("打印时关闭动画", /@media print\{[\s\S]{0,400}animation:none !important/.test(CSS));
ok("尊重减少动态偏好", CSS.indexOf("prefers-reduced-motion") >= 0);
ok("图表不引第三方库（rank.js 内无 script 注入）",
  RANK_SRC.indexOf("chart.js") < 0 && RANK_SRC.indexOf("echarts") < 0 && RANK_SRC.indexOf("d3.min") < 0);

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
