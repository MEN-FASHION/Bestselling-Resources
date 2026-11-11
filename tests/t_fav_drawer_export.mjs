/* 收藏抽屉（趋势上升榜 / 上新节奏 页右下角「收藏」）· 每一期自己的导出按钮 —— 20261111AF
   用户口径：抽屉里每一期（W45 这类）标题旁边就该有「导出 PDF」「导出 HTML」。
   锁五件事：
     ① 期次标题行里真的有这两个按钮（不是只有顶部那个「导出」）
     ② 只导这一期：按 period_label 精确取，不掺别的期次
     ③ PDF 只下载，不上传、不登记（publish:false）
     ④ 顶部「导出」菜单也补上 PDF，三处口径一致
     ⑤ 按钮每次渲染重建 → 事件用委托，且不会跟卡片点击打架 */
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const FD = fs.readFileSync(path.join(ROOT, "js/favdrawer.js"), "utf8");
const FE = fs.readFileSync(path.join(ROOT, "js/favexport.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
const RK = fs.readFileSync(path.join(ROOT, "rank.html"), "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

console.log("一、期次标题里有按钮");
ok(/data-period="' \+ esc\(g\.period\) \+ '"/.test(FD), "期次块带 data-period（导出要知道是哪一期）");
ok(/class="fv-d-week-acts"/.test(FD), "标题行右侧有按钮容器");
ok(/data-pexp="pdf"/.test(FD), "有「导出 PDF」");
ok(/data-pexp="html"/.test(FD), "有「导出 HTML」");
const head = FD.slice(FD.indexOf("fv-d-week-h"), FD.indexOf("if (ST.flat)"));
ok(head.indexOf("data-pexp") > 0, "两个按钮在期次标题这一行里（不是塞在别处）");

console.log("二、只导这一期");
ok(/function periodItems\(period\)/.test(FD), "有按期次取图的函数");
ok(/String\(it\.period_label \|\| "未标注期次"\) === p/.test(FD), "按 period_label 精确匹配");
ok(/exportHtml\(list, ST\.cats, \{ scope: "all" \}\)/.test(FD), "HTML 只导这一期");
ok(/exportPdfForTrend\(list, ST\.cats, \{/.test(FD), "PDF 只导这一期");

console.log("三、PDF 只下载");
ok(/publish: false/.test(FD), "明确 publish:false");
ok(/FE\.download\(pr\.pdfBlob, periodFileName\(period, "pdf"\)\)/.test(FD), "下载 PDF 而不是上传");
ok(!/doPeriodExport[\s\S]{0,2500}addTrendRecord/.test(FD), "不写趋势专区清单");
ok(/opts\.publish === false/.test(FE), "封面脚注据此改成「导出」而非「已发布」");

console.log("四、顶部「导出」菜单补齐 PDF");
ok(/data-k="pdf"/.test(FD), "菜单里有 PDF 项");
ok(/kind === "pdf"/.test(FD), "选择后能走 PDF 分支");
ok(/收藏周报-.*\.pdf/.test(FD), "整份 PDF 也有文件名");

console.log("五、交互与样式");
ok(/function onPeriodExpClick\(e\)/.test(FD), "有统一的点击处理");
ok(/dBodyEl\.addEventListener\("click", onPeriodExpClick\)/.test(FD), "挂在抽屉主体上（按钮重建也不丢）");
ok(/e\.preventDefault\(\);[\s\S]{0,80}e\.stopPropagation\(\);/.test(FD), "拦住冒泡，不误触卡片");
ok(/b\.closest\("\.fv-d-week"\)/.test(FD), "从按钮反查所属期次");
ok(/\.fv-d-pexp\s*\{/.test(CSS), "按钮有样式");
ok(/\.fv-d-week-acts\{[^}]*margin-left:\s*auto/.test(CSS), "按钮靠右，期次标题仍在左");
ok(/css\/style\.css\?v=20261111AF/.test(RK), "页面样式版本已升级（否则新样式不生效）");

console.log("六、异常提示");
ok(/这一期没有收藏/.test(FD), "这一期没图时说清楚");
ok(/导出组件未加载，请刷新页面/.test(FD), "组件缺失有提示");
ok(/已导出 " \+ period/.test(FD), "导完回执带期次");
ok(/data-busy/.test(FD), "导出中防重复点击");

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
