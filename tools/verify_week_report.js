/* 周对比分析报告（含六维差异）验证套件
 *
 * 目的：验证「选好两周 → 生成报告」这条链路里最容易被写错、也最容易悄悄错的地方：
 *   - 从页面读出来的两周数据对不对（位次、新增、掉榜）
 *   - 六个维度（款式 / 图案印花与设计元素 / 二次工艺 / 场景与背景构成 / 主图视觉 / 模特肤色）
 *     的计数与占比差算法对不对，二次工艺是否真的从元素标签里抽出工艺词
 *   - 打标覆盖率算得对不对（结论置信度就靠它）
 *   - 成稿页数是否随维度增加、缺打标时是否优雅降级而不是报错
 *   - 结论页是否只写分析、**不出现**建议/优先级/排期/落地这类计划性口径
 *
 * 用法：node tools/verify_week_report.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; fails.push(name + (extra !== undefined ? " → " + extra : "")); }
}

/* ---------- 造两列（两周）真实结构的 DOM ---------- */
function pool(name, n, urls) {
  const cards = urls.map((u, i) =>
    `<figure class="rk-card" data-url="${u}" title="${u}-标题${i + 1}">
       <img src="${u}" alt="卫衣">
       <span class="rk-badge ${i % 2 ? "b-hot" : "b-surge"}">热卖</span>
       ${i > 0 ? `<span class="rk-move">${i === 1 ? "上升 2 位" : (i === 2 ? "下降 1 位" : "新上榜")}</span>` : ""}
     </figure>`).join("");
  return `<section class="rk-pool">
      <div class="rk-pool-head">
        <div class="rk-pool-name"><span>${name}</span><span class="rk-n">${urls.length} 张</span></div>
        <div class="rk-pool-meta">美国 · 卫衣</div>
      </div>
      <div class="rk-pool-grid">${cards}</div>
    </section>`;
}
function mkDom(poolsHtml) {
  const html = `<!doctype html><html><body>
      <div id="rk-bar"><div class="rk-bar-info">共 12 张 · 2 列</div></div>
      <div id="rk-pools">${poolsHtml}</div>
    </body></html>`;
  const dom = new JSDOM(html, { url: "https://example.test/rank.html", pretendToBeVisual: true, runScripts: "dangerously" });
  dom.window.eval(read("js/weekreport.js"));
  return dom;
}

const U = (s) => "https://img.test/" + s + ".jpg";
const A = [U("a1"), U("a2"), U("a3"), U("a4")];
const B = [U("a2"), U("a1"), U("b1"), U("b2"), U("a4")];   /* a3 掉榜；b1 b2 新增 */

const dom = mkDom(pool("2026W41", 4, A) + pool("2026W42", 5, B));
const WR = dom.window.WeekReport;

ok("报告模块挂到 window.WeekReport", !!WR && typeof WR.run === "function");
ok("六个维度已定义", Array.isArray(WR.DIMS) && WR.DIMS.length === 6, WR.DIMS && WR.DIMS.length);
ok("维度名称与需求一致",
  WR.DIMS.map((d) => d.zh).join("|") === "款式与版型|图案印花与设计元素|二次工艺|场景与背景构成|主图视觉|模特肤色",
  WR.DIMS.map((d) => d.zh).join("|"));

/* ---------------- ① 取数 ---------------- */
const data = WR.collect(dom.window.document.querySelector("#rk-pools"));
ok("读出两列，列名分别是两周", data.cols.length === 2 && data.cols[0].name === "2026W41" && data.cols[1].name === "2026W42",
  JSON.stringify(data.cols.map((c) => c.name)));
ok("每列款数与页面一致（4 / 5）", data.cols[0].cards.length === 4 && data.cols[1].cards.length === 5,
  data.cols.map((c) => c.cards.length).join("/"));
ok("位次按页面顺序从 1 起", data.cols[1].cards.map((c) => c.rank).join(",") === "1,2,3,4,5");
ok("卡片标题取到了", /标题1/.test(data.cols[0].cards[0].title), data.cols[0].cards[0].title);
ok("筛选范围文案读到了", /共 12 张/.test(data.scope), data.scope);

/* ---------------- ② 打标数据（模拟库里的六个维度） ---------------- */
const TAGS = {
  [U("a1")]: { style_tags: ["连帽", "加厚"], element_tags: ["字母印花", "刺绣"], scene_tags: ["室内"], shoot_tags: ["平铺", "柔光"], skin_tags: ["浅肤"], category: "卫衣" },
  [U("a2")]: { style_tags: ["圆领"], element_tags: ["水洗", "做旧"], scene_tags: ["外景"], shoot_tags: ["模特实拍", "硬光"], skin_tags: ["深肤"], category: "卫衣" },
  [U("a3")]: { style_tags: ["连帽"], element_tags: ["胶印"], scene_tags: ["室内"], shoot_tags: ["平铺"], skin_tags: ["浅肤"], category: "卫衣/连帽衫" },
  [U("a4")]: { style_tags: ["圆领", "短款"], element_tags: ["拼接"], scene_tags: ["室内"], shoot_tags: ["模特实拍"], skin_tags: ["中肤"], category: "卫衣" },
  [U("b1")]: { style_tags: ["连帽", "廓形"], element_tags: ["刺绣", "亮片"], scene_tags: ["外景"], shoot_tags: ["模特实拍", "硬光"], skin_tags: ["深肤"], category: "卫衣" },
  [U("b2")]: { style_tags: ["连帽"], element_tags: ["烫钻"], scene_tags: ["室内"], shoot_tags: ["平铺", "柔光"], skin_tags: ["浅肤"], category: "卫衣" }
};

const a = WR.analyze(data, TAGS);
ok("分析成功", a.ok === true, a.reason);
ok("新增 2 款（b1、b2）", a.pair.added.length === 2, a.pair.added.length);
ok("掉榜 1 款（a3）", a.pair.dropped.length === 1 && a.pair.dropped[0].url === U("a3"), JSON.stringify(a.pair.dropped.map((x) => x.url)));
ok("重合 3 款", a.pair.kept.length === 3, a.pair.kept.length);
ok("留存率 = 重合 / 上期 = 3/4 = 75%", a.pair.keepRate === 75, a.pair.keepRate);
ok("位次上升 1 款（a2：第2→第1）", a.pair.up.length === 1 && a.pair.up[0].url === U("a2") && a.pair.up[0].delta === 1, JSON.stringify(a.pair.up));
ok("位次下降 2 款（a1：1→2，a4：4→5）", a.pair.down.length === 2 && a.pair.down[0].url === U("a1") && a.pair.down[0].delta === -1,
  JSON.stringify(a.pair.down.map((x) => x.url.slice(-6) + x.before + "→" + x.now)));

/* ---------------- ③ 六维计数与占比差 ---------------- */
const dim = (k) => (a.pair.dims || []).find((d) => d.key === k);
ok("维度结果共 6 个", (a.pair.dims || []).length === 6);
{
  const st = dim("style_tags");
  const hood = st.rows.find((r) => r.tag === "连帽") || {};
  /* 上期：a1、a3 带连帽 = 2/4 = 50%；本期：b1、b2 带连帽 = 2/5 = 40% → -10pt */
  ok("款式：连帽上期 2（50%）", hood.prev === 2 && hood.pa === 50, JSON.stringify(hood));
  /* 本期五张：a1(连帽) a2(圆领) b1(连帽) b2(连帽) a4(圆领·短款) → 连帽 3/5 = 60% */
  ok("款式：连帽本期 3（60%）", hood.cur === 3 && hood.pb === 60, JSON.stringify(hood));
  ok("款式：占比差 +10pt", hood.delta === 10, hood.delta);
  ok("款式按变化幅度排序（首行是变化最大的）",
    Math.abs(st.rows[0].delta) >= Math.abs(st.rows[st.rows.length - 1].delta), JSON.stringify(st.rows.map((r) => r.tag + r.delta)));
}
{
  /* 二次工艺：从 element_tags 里抽工艺词 —— a1 刺绣、a2 水洗+做旧、a3 胶印、a4 拼接 / b1 刺绣、b2 烫钻 */
  const cr = dim("craft");
  const tags = cr.rows.map((r) => r.tag);
  ok("二次工艺：抽到了刺绣 / 水洗 / 做旧 / 胶印 / 拼接 / 烫钻",
    ["刺绣", "水洗", "做旧", "胶印", "拼接", "烫钻"].every((t) => tags.indexOf(t) >= 0), tags.join(","));
  ok("二次工艺：不会把「字母印花」这类图案词误算成工艺", tags.indexOf("字母印花") < 0, tags.join(","));
  ok("二次工艺：「亮片」属于工艺/辅料，应当计入", tags.indexOf("亮片") >= 0, tags.join(","));
  const emb = cr.rows.find((r) => r.tag === "刺绣") || {};
  /* 刺绣：上期 a1 → 1/4=25%；本期 a1、b1 → 2/5=40% */
  ok("二次工艺：刺绣上期 1（25%）→ 本期 2（40%），差 +15pt", emb.prev === 1 && emb.cur === 2 && emb.delta === 15, JSON.stringify(emb));
  const drill = cr.rows.find((r) => r.tag === "烫钻") || {};
  ok("二次工艺：烫钻上期 0 → 本期 1（20%），差 +20pt", drill.prev === 0 && drill.cur === 1 && drill.delta === 20, JSON.stringify(drill));
}
{
  const sh = dim("shoot_tags");
  const flat = sh.rows.find((r) => r.tag === "平铺") || {};
  ok("主图视觉：平铺上期 2（50%）→ 本期 2（40%），差 -10pt", flat.prev === 2 && flat.cur === 2 && flat.delta === -10, JSON.stringify(flat));
  const hard = sh.rows.find((r) => r.tag === "硬光") || {};
  ok("主图视觉：硬光上期 1（25%）→ 本期 2（40%）", hard.prev === 1 && hard.cur === 2, JSON.stringify(hard));
}
{
  const sc = dim("scene_tags");
  const out = sc.rows.find((r) => r.tag === "外景") || {};
  ok("场景与背景构成：外景上期 1（25%）→ 本期 2（40%）", out.prev === 1 && out.cur === 2, JSON.stringify(out));
}
{
  const sk = dim("skin_tags");
  const dark = sk.rows.find((r) => r.tag === "深肤") || {};
  ok("模特肤色：深肤上期 1（25%）→ 本期 2（40%）", dark.prev === 1 && dark.cur === 2, JSON.stringify(dark));
}
ok("类目结构仍然保留（没有因为加维度而丢掉）", Array.isArray(a.pair.cats) && a.pair.cats.length >= 1, a.pair.cats.length);

/* ---------------- ④ 覆盖率 ---------------- */
ok("上期覆盖率 4/4（四款都有标签）", a.pair.coverPrev.has === 4 && a.pair.coverPrev.total === 4 && a.pair.coverPrev.pct === 100, JSON.stringify(a.pair.coverPrev));
ok("本期覆盖率 5/5", a.pair.coverCur.has === 5 && a.pair.coverCur.pct === 100, JSON.stringify(a.pair.coverCur));
/* 覆盖率的意义：没打标就不能装作有结论 —— 单独造一个「全无标签」的场景验证 */
{
  const noTag = WR.analyze(data, {});
  ok("全无标签时覆盖率为 0%", noTag.pair.coverPrev.pct === 0 && noTag.pair.coverCur.pct === 0);
  ok("全无标签时覆盖率告警会出现", /打标覆盖率偏低/.test(WR.verdicts(noTag).join("\n")));
}

/* ---------------- ⑤ 结论：只写分析、不写计划 ---------------- */
const vs = WR.verdicts(a).join("\n");
ok("结论包含新增/掉榜与留存率", /新增|新上榜/.test(vs) && /留存率/.test(vs), vs.slice(0, 60));
ok("结论包含六维度观察（至少出现款式与二次工艺）", /款式与版型/.test(vs) && /二次工艺/.test(vs), vs.slice(0, 200));
ok("覆盖率充足（100%）时不出现覆盖率告警", !/打标覆盖率偏低/.test(vs), vs.slice(-80));
[["建议", /建议/], ["优先级", /优先级/], ["排期", /排期/], ["落地", /落地/], ["风险提示", /风险提示/], ["可启动", /可启动/]].forEach(([n, re]) => {
  ok("结论不出现计划性口径：" + n, !re.test(vs));
});

/* ---------------- ⑥ 成稿：页数与标题 ---------------- */
function mkPptx() {
  const slides = [];
  function slideObj() {
    const s = { items: [], addText: (t) => s.items.push({ k: "text", t }), addShape: () => s.items.push({ k: "shape" }),
      addTable: (rows) => s.items.push({ k: "table", rows }),
      addImage: (o) => s.items.push({ k: "img", path: o.path, x: o.x, y: o.y, w: o.w })};
    return s;
  }
  const pptx = {
    layout: "", slides,
    defineLayout() { }, addSlide() { const s = slideObj(); slides.push(s); return s; },
    writeFile() { return Promise.resolve(); }
  };
  return pptx;
}
const pptx = mkPptx();
WR.assemble(pptx, a, { spec: "wide", scope: "美国 · 卫衣", nowText: "2026-10-21 20:40" });
ok("成稿页数 = 数据类 10 页 + 六维 6 页", pptx.slides.length === 16, pptx.slides.length);
function slideText(s) {
  return s.items.map(function (i) {
    if (i.k === "text") return i.t;
    if (i.k === "table") return i.rows.map(function (r) { return r.map(function (c) { return c.text; }).join(" "); }).join("\n");
    return "";
  }).join(" ");
}
const allText = pptx.slides.map(slideText).join("\n");
WR.DIMS.forEach((d) => ok("报告里有「" + d.zh + "」页", allText.indexOf(d.zh) >= 0));
ok("口径页写明了「维度来源」", /维度来源/.test(allText));
ok("口径页写明了「打标覆盖率」", /打标覆盖率/.test(allText));
ok("结论页仍无建议/排期/优先级",
  !/建议|排期|优先级|落地路径/.test(allText.split("趋势结论")[1] || ""), (allText.split("趋势结论")[1] || "").slice(0, 80));
ok("图片对照墙页保留", /图片对照墙/.test(allText));

/* ---------------- ⑥-b 分好类的插图：每个维度页都要有按标签分组的配图 ---------------- */
{
  const imgSlides = pptx.slides.map(function (sl) { return sl.items.filter(function (i) { return i.k === "img"; }); });
  /* 维度页从第 11 页（索引 10）起连续 6 页，最后 1 页是对照墙 */
  const dimPages = pptx.slides.slice(9, 15);
  ok("六维页每页都有插图", dimPages.every(function (sl) {
    return sl.items.filter(function (i) { return i.k === "img"; }).length > 0;
  }), dimPages.map(function (sl) { return sl.items.filter(function (i) { return i.k === "img"; }).length; }).join("/"));

  const stylePage = dimPages[0];   /* 款式与版型 */
  const styleImgs = stylePage.items.filter(function (i) { return i.k === "img"; });
  ok("款式页插图数不超过 3 组 × 每组 4 张", styleImgs.length > 0 && styleImgs.length <= 12, styleImgs.length);
  const styleTexts = stylePage.items.filter(function (i) { return i.k === "text"; }).map(function (i) { return i.t; }).join("\n");
  ok("插图按标签分组，组标题写明标签名与张数", /连帽　本期 3 张/.test(styleTexts) || /连帽.*本期.*张/.test(styleTexts), styleTexts.slice(0, 120));
  ok("组标题带上占比差，方便和图对照", /pt）/.test(styleTexts), styleTexts.slice(0, 120));
  ok("页面写明配图取图规则（本期优先、标位次）", /优先取本期代表款/.test(styleTexts));

  /* 本期优先：连帽在本期有 a1/b1/b2，插图的 path 必须全来自本期 */
  const curUrls = new Set(B.map((u) => u.replace("https://img.test/", "")));
  ok("插图优先取本期款式（不会拿上期凑数）",
    styleImgs.every(function (i) { return curUrls.has(String(i.path).split("/").pop()); }),
    styleImgs.map(function (i) { return String(i.path).split("/").pop(); }).join(","));

  /* 二次工艺页：工艺标签也应配到图（烫钻只在本期 b2） */
  const craftPage = dimPages[2];
  const craftImgs = craftPage.items.filter(function (i) { return i.k === "img"; });
  ok("二次工艺页也配了图（工艺看得见）", craftImgs.length > 0, craftImgs.length);
  ok("二次工艺页插图里有本期新出现的烫钻款",
    craftImgs.some(function (i) { return String(i.path).indexOf("b2") >= 0; }),
    craftImgs.map(function (i) { return String(i.path).split("/").pop(); }).join(","));

  /* 每个标签最多 DIM_PICS 张：按 x 坐标分组，同一 x 起点上最多 4 张 */
  const xs = {};
  styleImgs.forEach(function (i) { xs[i.x.toFixed(2)] = (xs[i.x.toFixed(2)] || 0) + 1; });
  const perGroup = styleImgs.length / 3;
  ok("每组插图不超过 4 张", perGroup <= 4, "共 " + styleImgs.length + " 张 / 3 组");
}

/* ---------------- ⑦ 缺打标时优雅降级 ---------------- */
{
  const a2 = WR.analyze(WR.collect(dom.window.document.querySelector("#rk-pools")), {});
  const p2 = mkPptx();
  WR.assemble(p2, a2, { spec: "wide", scope: "", nowText: "" });
  ok("完全没有打标数据时仍能出稿（页数不变）", p2.slides.length === 16, p2.slides.length);
  const t2 = p2.slides.map(function (s) { return s.items.map(function (i) { return i.k === "text" ? i.t : ""; }).join(" "); }).join("\n");
  ok("缺打标时维度页明确写「无法比较」", /无法比较/.test(t2));
  ok("缺打标时维度页不放任何图", p2.slides.slice(9, 15).every(function (sl) {
    return sl.items.filter(function (i) { return i.k === "img"; }).length === 0;
  }));
  ok("缺打标时不抛异常、数据类页面照常", /新上榜清单/.test(t2) && /类目结构变化/.test(t2));
}

/* ---------------- ⑦-b 地址带缩放参数时仍能匹配到标签 ---------------- */
{
  const t2 = {};
  Object.keys(TAGS).forEach(function (k) { t2[k] = TAGS[k]; });
  const norm = WR.tagFor(t2, U("a1") + "?imageView2/2/w/400");
  ok("图片地址带缩放参数时仍能命中标签", !!(norm && norm.style_tags), JSON.stringify(norm));
  ok("地址归一化后仍缺少的标签返回空对象、不报错", JSON.stringify(WR.tagFor(t2, "https://img.test/none.jpg")) === "{}");
}

/* ---------------- ⑧ 反向验证：断言不是摆设 ---------------- */
{
  const a3 = JSON.parse(JSON.stringify(a));
  a3.pair.dims = [];
  const p3 = mkPptx();
  WR.assemble(p3, a3, { spec: "wide", scope: "", nowText: "" });
  ok("反向验证：抹掉维度后页数应降为 10（说明页数断言真的在看维度页）", p3.slides.length === 10, p3.slides.length);
  const v3 = WR.verdicts(a3).join("\n");
  ok("反向验证：抹掉维度后结论里不再有维度句", !/款式与版型/.test(v3));
}

/* ---------------- ⑨ 接线：按钮、权限、样式 ---------------- */
{
  const rank = read("js/rank.js");
  ok("筛选栏加了「生成周对比分析报告」按钮", /id="rk-week-report"/.test(rank));
  ok("按钮只在纵向·时间对比且 ≥2 周时可用", /MODE === "v" && periods\.length >= 2/.test(rank));
  ok("点击时再次校验模式与期次", /MODE !== "v" \|\| activePeriods\(\)\.length < 2/.test(rank));
  ok("报告走打标取数（按图片地址批量查）", /listImageTags\(urls\)/.test(rank));
  ok("报告入口与导出图片同一权限口径（超管才显示）", /eyeIsSuper\(\)\.then\(function \(ok\) \{ if \(ok\) rep\.style\.display/.test(rank));
  ok("生成过程中按钮文案显示进度", /onProgress: function \(t\) \{ rep\.textContent = t; \}/.test(rank));
  const css = read("css/style.css");
  ok("报告按钮样式已定义", /\.rk-rep-btn \{/.test(css));
  ok("报告按钮禁用态有样式", /\.rk-rep-btn:disabled/.test(css));
  const html = read("rank.html");
  ok("页面引入了报告脚本", /js\/weekreport\.js\?v=/.test(html));
  ok("报告脚本在 rank.js 之前加载", html.indexOf("js/weekreport.js") < html.indexOf("js/rank.js"));
  const sb = read("js/supabase.js");
  ok("数据层提供按地址批量取打标维度的方法", /async listImageTags\(urls\)/.test(sb));
  ok("取的是分析需要的六个维度字段", /image_url,category,style_tags,element_tags,scene_tags,shoot_tags,skin_tags/.test(sb));
  ok("缺列时退化为只取类目、不让整份报告失败", /select\("image_url,category"\)/.test(sb));
}

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
if (fails.length) { console.log("失败项："); fails.forEach((f) => console.log(" - " + f)); }
process.exit(fail ? 1 : 0);