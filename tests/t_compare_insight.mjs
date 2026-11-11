/* 20261111AA · 渠道对比「差异分析」
 * 覆盖：
 *  1) 页面接入分析模块与弹层，且每列有「详细分析」入口（只读，不写库）
 *  2) 统计口径：每个维度独立分母；同一张图同一维度重复值只算一次
 *  3) 「其它专区」取各来源占比的算术平均，不按张数加权
 *  4) 结论方向正确：明显更多的写「更偏」，只有其它专区有的写「缺口」
 *  5) 相似度：结构越接近分数越高
 *  6) 边界：只有一个来源 / 没有打标时给得出话，不抛错
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

/* ---------- 1. 接入 ---------- */
const H = read("compare.html");
ok(H.includes("js/compare-insight.js"), "compare.html 未引入分析模块");
ok(H.includes('id="cmi-modal"') && H.includes('id="cmi-scroll"'), "缺少差异分析弹层");
ok(H.indexOf("compare-insight.js") < H.indexOf("compare-front.js"), "分析模块须先于前台脚本加载");

const F = read("js/compare-front.js");
ok(/data-insight=/.test(F), "列头缺少「详细分析」入口");
ok(/id="cmp-insight-all"/.test(F), "工具栏缺少「渠道差异分析」入口");
ok(/visibleList\(s\)/.test(F), "分析样本须与图片列同口径（月度 + 类目）");
ok(!/saveMovementTags|upsert|delete\(\)/.test(F), "差异分析是只读，不应写库");

/* ---------- 2. 加载模块（stub DOM） ---------- */
const listeners = [];
const sandbox = {
  window: {},
  document: {
    readyState: "complete",
    addEventListener: (t) => listeners.push(t),
    querySelector: () => null,
  },
  console,
  Date,
  isFinite,
  Math,
  Object,
  Array,
  String,
  Number,
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(read("js/compare-insight.js"), sandbox, { filename: "compare-insight.js" });
const CI = sandbox.window.CmpInsight;
ok(!!CI && typeof CI.open === "function", "模块未对外暴露 open");
ok(Array.isArray(CI._dims) && CI._dims.length === 14, "维度应为 14 个（含背景）");
ok(CI._dims.some((d) => d.bg), "背景维度须单独标记（合并 scene_tags 兜底）");

/* ---------- 3. 统计口径 ---------- */
function mkSource(key, label, n, tagFn) {
  const list = [];
  const tags = {};
  for (let i = 0; i < n; i++) {
    const url = key + "-" + i;
    list.push({ image_url: url });
    tags[url] = tagFn(i);
  }
  return { src: { key, label, type: key === "rank:month" ? "rank" : "channel", list }, tags };
}
const A = mkSource("rank:month", "上新节奏", 10, () => ({ style_tags: ["基础百搭"], shoot_tags: ["平铺拍摄"] }));
const B = mkSource("ch:SHEIN", "SHEIN", 10, (i) => ({
  style_tags: ["街头潮流"],
  shoot_tags: i < 6 ? ["平铺拍摄"] : ["模特拍摄"],
}));
const C = mkSource("ch:Pinterest", "Pinterest", 10, (i) => ({
  style_tags: i < 4 ? ["街头潮流"] : ["法式"],
  shoot_tags: ["平铺拍摄"],
}));
const tags = Object.assign({}, A.tags, B.tags, C.tags);
const ctx = { month: "2026-11", cat: "全部", tags, sources: [A.src, B.src, C.src] };
const stats = CI._stats(ctx);
ok(stats.length === 3, "统计应按来源分组");
const b = stats.find((s) => s.label === "SHEIN");
ok(b.n === 10 && b.tagged === 10, "已打标张数统计错误");
ok(b.dims.style_tags.tot === 10, "风格维度分母应为 10");
ok(Math.round(b.dims.style_tags.cnt["街头潮流"]) === 10, "风格取值计数错误");
ok(b.dims.shoot_tags.tot === 10 && b.dims.shoot_tags.cnt["平铺拍摄"] === 6, "拍摄方式应按张计数");

/* 重复值只算一次 */
const dupCtx = {
  tags: { u1: { style_tags: ["简约", "简约", "基础百搭"] } },
  sources: [{ key: "x", label: "X", type: "channel", list: [{ image_url: "u1" }] }],
};
const ds = CI._stats(dupCtx)[0];
ok(ds.dims.style_tags.tot === 1, "同一张图同一维度只能进一次分母");
ok(ds.dims.style_tags.cnt["简约"] === 1, "重复取值只能算一次（否则占比会超过 100%）");

/* 背景：scene_tags 为空时从 visual_tags 兜底 */
const bgCtx = {
  tags: { u2: { visual_tags: ["室外·街道·霓虹夜景", "三分法构图"] } },
  sources: [{ key: "y", label: "Y", type: "channel", list: [{ image_url: "u2" }] }],
};
const bgStat = CI._stats(bgCtx)[0];
ok(bgStat.dims.scene_tags.tot === 1 && bgStat.dims.scene_tags.cnt["室外·街道·霓虹夜景"] === 1,
  "背景应从 visual_tags 里兜底识别");
ok(bgStat.dims.visual_tags.tot === 1, "视觉维度仍应保留构图类取值");

/* ---------- 4. 结论方向 ---------- */
const concl = CI._concl(stats, b);
const txt = concl.map((c) => c.text).join(" | ");
ok(/街头潮流/.test(txt) && /高/.test(txt), "SHEIN 更偏街头潮流，应给出「高 xx 个百分点」");
ok(/基础百搭/.test(txt) && /缺口/.test(txt), "其它来源常见、本列没有的，应写成「缺口」");
ok(concl.every((c) => typeof c.text === "string" && c.text.length > 8), "结论不能为空句子");

/* 「其它专区」是平均，不是按张数加权：把 A 扩到 100 张，其它均值不应被拉成 80/101 */
const A2 = mkSource("rank:month", "上新节奏", 100, () => ({ style_tags: ["基础百搭"], shoot_tags: ["平铺拍摄"] }));
const stats2 = CI._stats({ tags: Object.assign({}, A2.tags, B.tags, C.tags), sources: [A2.src, B.src, C.src] });
const b2 = stats2.find((s) => s.label === "SHEIN");
const c2 = CI._concl(stats2, b2).map((x) => x.text).join(" | ");
ok(/低 40 个百分点|高 40 个百分点/.test(c2), "其它来源占比应是「每来源一票」的平均（20%），不能按张数加权");

/* ---------- 5. 相似度 ---------- */
const sims = CI._sim(stats, b);
ok(sims.length === 2, "相似度应给出其余来源");
ok(sims[0].label === "Pinterest", "SHEIN 与 Pinterest 共享街头潮流，应最接近");
ok(sims[0].score != null && sims[0].score > 0 && sims[0].score <= 100, "相似度应在 0–100 之间");
ok(sims[1].score <= sims[0].score, "相似度应按从高到低排序");

/* ---------- 6. 边界 ---------- */
const soloStats = CI._stats({ tags: A.tags, sources: [A.src] });
const one = CI._concl(soloStats, soloStats[0]);
ok(one.length === 1 && /只有一个来源/.test(one[0].text), "只有一个来源时应说明没有可对比对象");
const noTagStats = CI._stats({ tags: {}, sources: [A.src] });
ok(/还没有任何打标数据/.test(CI._concl(noTagStats, noTagStats[0])[0].text), "未打标时应提示先打标，而不是给空结论");
const emptyCtx = { tags: {}, sources: [{ key: "z", label: "Z", type: "channel", list: [] }] };
const ez = CI._stats(emptyCtx)[0];
ok(ez.n === 0 && ez.tagged === 0, "空来源应安全返回 0");
ok(CI._concl(CI._stats(emptyCtx), ez).length >= 1, "空来源也要给结论，不能空白");
ok(CI._sim(CI._stats(emptyCtx), ez).length === 0, "空来源没有相似度可比");

/* ---------- 7. 维度齐全：13 个打标维度都要参与 ---------- */
const need = ["风格", "视觉", "背景", "拍摄方式", "图案类型", "图案元素", "结构部件", "二次工艺", "面料", "版型", "模特", "文化背景", "消费心理", "节日"];
const labels = CI._dims.map((d) => d.label);
ok(need.every((n) => labels.includes(n)), "维度清单缺失：" + need.filter((n) => !labels.includes(n)).join(","));

/* ---------- 8. 报告渲染（不依赖 DOM） ---------- */
const HTML = CI._html(ctx, "ch:SHEIN");
ok(/核心结论：差异在哪里/.test(HTML), "报告缺少核心结论");
ok(/差异榜单/.test(HTML), "报告缺少差异榜单");
ok(/结构相似度/.test(HTML), "报告缺少相似度");
ok(/全景对照表/.test(HTML), "报告缺少全景对照");
ok(/逐维度对照/.test(HTML), "报告缺少逐维度对照");
ok(/口径说明/.test(HTML), "报告缺少口径说明");
ok(HTML.includes('data-key="ch:Pinterest"'), "缺少可切换的分析对象");
ok(!/NaN|undefined|Infinity/.test(HTML), "报告里出现了 NaN / undefined / Infinity");
ok(/本列 100%/.test(HTML), "差异榜单应带本列占比");

/* 换一个分析对象，结论要跟着换 */
const HTML2 = CI._html(ctx, "rank:month");
ok(HTML2 !== HTML, "切换分析对象后报告内容应变化");
ok(/上新节奏/.test(HTML2), "分析对象应体现在报告里");

/* 单来源 / 空数据不崩 */
const soloHtml = CI._html({ tags: {}, sources: [C.src] }, "ch:Pinterest");
ok(!/NaN|undefined/.test(soloHtml), "单来源报告不应出现 NaN / undefined");
const emptyHtml = CI._html({ tags: {}, sources: [] }, "");
ok(/没有可分析的来源/.test(emptyHtml), "无来源时应给出明确提示，而不是空白");

/* ---------- 9. open / 切换分析对象 的实际 DOM 路径（轻量 stub） ---------- */
{
  const box = { innerHTML: "", scrollTop: 5, querySelectorAll: () => [] };
  const modal = { classList: { add() {}, remove() {} } };
  const s2 = {
    window: {},
    document: {
      readyState: "complete",
      addEventListener() {},
      querySelector(sel) {
        if (sel === "#cmi-scroll") return box;
        if (sel === "#cmi-modal") return modal;
        return null;
      },
    },
    console, Date, isFinite, Math, Object, Array, String, Number,
  };
  s2.window.document = s2.document;
  vm.createContext(s2);
  vm.runInContext(read("js/compare-insight.js"), s2, { filename: "compare-insight.js" });
  const CI2 = s2.window.CmpInsight;
  CI2.open(ctx, "ch:Pinterest");
  ok(box.innerHTML.includes("核心结论"), "open() 应把报告写进弹层");
  ok(box.scrollTop === 0, "每次打开应回到顶部");
  ok(box.innerHTML.includes("SHEIN"), "报告应列出其它来源");
  CI2.close();
  ok(true, "close() 不应抛错");
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
