/* 我的收藏 · 每个期次（周 / 月）自己的「导出 PDF」「导出 HTML」—— 20261111O
   锁五件事：
     ① 每个期次区块头部都有这两个按钮（不是只在工具栏）
     ② 只导这一期：按 period_label 精确取，不掺别的期次，也不套「导出范围」下拉
     ③ PDF 是本地下载，不上传、不登记（publish:false），封面脚注据此换文案
     ④ 文件名带期次，导完能一眼对上
     ⑤ 按钮在卡片之前处理，不会误触发看大图 */
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const FE = fs.readFileSync(path.join(ROOT, "js/favexport.js"), "utf8");
const FJ = fs.readFileSync(path.join(ROOT, "js/fav.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

console.log("一、每个期次区块头部都有两个导出按钮");
const wk = FJ.slice(FJ.indexOf("function weekHtml"), FJ.indexOf("function renderCats"));
ok(/data-weekexp="pdf"/.test(wk), "有「导出 PDF」按钮");
ok(/data-weekexp="html"/.test(wk), "有「导出 HTML」按钮");
ok(/<button type="button" class="fv-btn fv-weekexp" data-weekexp="pdf"/.test(wk), "用统一的小按钮样式");
ok(wk.indexOf("fv-week-head") < wk.indexOf("data-weekexp"), "按钮在区块头里，跟期次标题同一行");
ok(wk.indexOf("data-weekexp") < wk.indexOf("data-weekflat"), "排在「一键展开」之前，不抢主操作位置");

console.log("二、只导这一期");
ok(/function itemsOfPeriod\(week\)/.test(FJ), "有按期次取图的函数");
ok(/String\(it\.period_label \|\| "未标注期次"\) === w/.test(FJ), "按 period_label 精确匹配（口径与分组一致）");
ok(!/doWeekExport[\s\S]{0,2000}exportScope\(\)/.test(FJ), "不套「导出范围」下拉（这一期的类型本来就已确定）");
ok(/scope: "all"/.test(FJ), "传给导出组件的是「全部」，避免周/月判定把图漏掉");

console.log("三、PDF 只下载，不发布");
ok(/FE\.exportPdfForTrend\(list, ST\.cats, \{/.test(FJ), "复用同一套 PDF 排版");
ok(/publish: false/.test(FJ), "明确 publish:false");
ok(/FE\.download\(res\.pdfBlob, periodFileName\(week, "pdf"\)\)/.test(FJ), "下载 PDF 而不是上传");
ok(!/doWeekExport[\s\S]{0,3000}addTrendRecord/.test(FJ), "单期次导出不写趋势专区清单");
ok(/opts\.publish === false/.test(FE), "封面脚注认 publish:false");
ok(/由「我的收藏」导出 · 仅供内部使用 · 请勿外传/.test(FE), "本地导出的脚注不写「并发布至趋势专区」");

console.log("四、HTML 与命名");
ok(/FE\.exportHtml\(list, ST\.cats, \{ scope: "all" \}\)/.test(FJ), "HTML 也只用这一期的图");
ok(/FE\.download\(res\.blob, periodFileName\(week, "html"\)\)/.test(FJ), "HTML 用带期次的文件名");
ok(/function periodFileName\(week, ext, now\)/.test(FJ), "有命名函数");
ok(/"收藏周报-" \+ tag \+ "-"/.test(FJ), "文件名前缀带期次");

console.log("五、交互不会被卡片点击吃掉");
const bind = FJ.slice(FJ.indexOf("function bind()"));
ok(/var wxp = t\.closest\("\[data-weekexp\]"\)/.test(bind), "点击里有专门的判断");
ok(bind.indexOf('t.closest("[data-weekexp]")') < bind.indexOf('t.closest(".fv-card")'), "在处理「点图看大图」之前，不会误开灯箱");
ok(/e\.preventDefault\(\); e\.stopPropagation\(\);/.test(bind), "拦住冒泡");
ok(/doWeekExport\(wxp\.getAttribute\("data-weekexp"\), wk4, wxp\)/.test(bind), "把类型、期次、按钮一起传下去");

console.log("六、异常与回执");
ok(/这一期没有收藏/.test(FJ), "这一期没图时说清楚");
ok(/导出组件未加载，请刷新页面/.test(FJ), "组件缺失有提示");
ok(/已导出 " \+ week \+ " · " \+ res\.count \+ " 张 · HTML/.test(FJ), "HTML 导完给回执（带期次与张数）");
ok(/已导出 " \+ week \+ " · " \+ res\.count \+ " 张 · PDF/.test(FJ), "PDF 导完给回执（带期次与页数）");
ok(/data-busy/.test(FJ), "导出中防重复点击");

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
