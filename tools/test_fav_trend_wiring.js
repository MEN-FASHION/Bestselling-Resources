/* 结构校验：收藏 → PDF → 趋势专区 全链路（不跑浏览器，只查接线） */
const fs = require("fs");

const favHtml = fs.readFileSync("fav.html", "utf8");
const favJs = fs.readFileSync("js/fav.js", "utf8");
const fxJs = fs.readFileSync("js/favexport.js", "utf8");
const sup = fs.readFileSync("js/supabase.js", "utf8");
const css = fs.readFileSync("css/style.css", "utf8");

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (e !== undefined ? " → " + e : ""))); };

console.log("\n【一】收藏页入口");
ok("存在「发布到趋势专区」按钮", /id="fv-export-pdf"/.test(favHtml));
ok("按钮文案写明 PDF", /发布到趋势专区（PDF）/.test(favHtml));
ok("按钮位于操作栏内（fv-bar-r）", /fv-bar-r[\s\S]{0,1200}fv-export-pdf/.test(favHtml));
ok("样式类 fv-btn-gold 已加载", /fv-btn-gold/.test(favHtml) && /\.fv-btn-gold\s*\{/.test(css));
ok("按钮组允许换行（三个按钮不溢出）", /\.fv-bar-r[^}]*flex-wrap:\s*wrap/.test(css));

console.log("\n【二】事件绑定");
ok("doExportPdfTrend 已定义", /function doExportPdfTrend\s*\(/.test(favJs));
ok("按钮已绑定点击", /fv-export-pdf"\)[\s\S]{0,80}onclick\s*=\s*doExportPdfTrend/.test(favJs));
ok("空收藏时按钮禁用", /fv-export-pdf"\)[\s\S]{0,120}disabled\s*=\s*!ST\.items\.length/.test(favJs) || /fv-export-pdf[\s\S]{0,160}!ST\.items\.length/.test(favJs));

console.log("\n【三】导出模块接线");
ok("导出模块提供 exportPdfForTrend", /NS\.exportPdfForTrend\s*=/.test(fxJs));
ok("jsPDF 懒加载（不拖慢首屏）", /loadJsPdf/.test(fxJs) && /vendor\/jspdf\.umd\.min\.js/.test(fxJs));
ok("封面单独成页且在第 1 页", /addImage\(cover\.toDataURL[\s\S]{0,120}\)/.test(fxJs) && fxJs.indexOf("addImage(cover") < fxJs.indexOf("for (var i = 0; i < pg.cuts.length"));
ok("内页按块边界切（不切卡片）", /function paginate\(/.test(fxJs) && /blocks/.test(fxJs));
ok("A4 横版 297×210", /PDF_W_MM\s*=\s*297/.test(fxJs) && /PDF_H_MM\s*=\s*210/.test(fxJs));
ok("长图导出回传块坐标", /blocks:\s*box\.blocks/.test(fxJs));
ok("标签三选一与前台页签对齐", /"周度"/.test(fxJs) && /"月度"/.test(fxJs) && /"类目"/.test(fxJs));
ok("封面同时抽出给专区卡片用", /coverBlob/.test(fxJs));

console.log("\n【四】上传与登记（复用趋势专区既有接口）");
ok("调用 uploadTrendFileXHR 带进度", /SBx\.uploadTrendFileXHR/.test(favJs));
ok("调用 addTrendRecord 登记清单", /SBx\.addTrendRecord\(/.test(favJs));
ok("必填六项齐全", ["title:", "tag:", "path:", "category:", "file_type:", "description:"].every(k => favJs.includes(k)));
ok("file_type 固定 pdf", /file_type:\s*"pdf"/.test(favJs));
ok("上传接口存在（未被改动）", /async uploadTrendFileXHR\(file, cover, onProgress\)/.test(sup));
ok("登记接口存在（未被改动）", /async addTrendRecord\(/.test(sup));
ok("PDF 不会被图片压缩逻辑误处理", /!\/\^image\\\//.test(sup) || /test\(file\.type/.test(sup));
ok("登记失败时提示手动补录（避免重复上传）", /手动补录/.test(favJs));
ok("无权限时给出明确提示", /没有趋势专区权限/.test(favJs));

console.log("\n【五】不破坏既有导出");
ok("原有「导出周报」按钮仍在", /id="fv-export"/.test(favHtml));
ok("原有「导出网页」按钮仍在", /id="fv-export-html"/.test(favHtml));
ok("原有导出函数仍在", /function doExport\(/.test(favJs) && /function doExportHtml\(/.test(favJs));
ok("未改 exportPng / exportHtml 签名", /async function exportPng\(items, cats, opts\)/.test(fxJs) && /async function exportHtml\(items, cats, opts\)/.test(fxJs));

console.log("\n【六】版本号统一");
const pages = ["admin.html", "fav.html", "index.html", "marketing.html", "movement.html", "plus.html", "rank.html", "trends.html"];
const V = "20261030E";
let bad = [];
pages.forEach(p => {
  const s = fs.readFileSync(p, "utf8");
  if (/20261030D/.test(s)) bad.push(p + "(残留旧版号)");
  if (!s.includes(V) && p !== "admin.html") { /* admin 走自己的版本串 */ }
});
ok("八个页面无旧版本号残留", bad.length === 0, bad.join(","));
ok("收藏页加载 favexport 为新版号", new RegExp("js/favexport\\.js\\?v=" + V).test(favHtml));

console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + "：" + pass + " 通过 / " + fail + " 失败\n");
process.exit(fail === 0 ? 0 : 1);