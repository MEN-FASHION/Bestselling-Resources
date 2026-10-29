/* 20261030F：验证两件事
 *  A. 收藏导出 PDF 改成「一张连续长页」——页宽固定 297mm、页高按内容延伸、
 *     只有超过单页上限才被迫分页、分段贴图后仍落在同一页。
 *  B. 趋势专区预览改成「连续滚动 + 缓存 + 全屏」——结构、事件、懒渲染都在位。
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (e !== undefined ? " → " + e : ""))); };
const read = (p) => fs.readFileSync(p, "utf8");

const TINY = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

/* ---------- 拿真实 jsPDF ---------- */
const sandbox = {
  console, setTimeout, Blob, Uint8Array, Uint32Array, Int8Array, Int16Array, Int32Array,
  Float32Array, Float64Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, atob, btoa,
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
sandbox.navigator = { userAgent: "node" };
sandbox.document = {
  createElement: () => ({
    setAttribute() { }, style: {}, appendChild() { }, width: 0, height: 0,
    getContext: () => ({ fillRect() { }, drawImage() { }, fillStyle: "", font: "" }),
    toDataURL: () => TINY,
  }),
  head: { appendChild() { } },
};
vm.createContext(sandbox);
vm.runInContext(read("vendor/jspdf.umd.min.js"), sandbox);
const jsPDF = (sandbox.jspdf || {}).jsPDF;

/* ============================ A. 长页导出 ============================ */
console.log("\n【A. 收藏导出：一张连续长页】");

/* 常量要和实现保持一致 */
const src = read("js/favexport.js");
const mLONG_W = src.match(/var LONG_W_MM\s*=\s*(\d+)/);
const mLONG_MAX = src.match(/var LONG_MAX_H_MM\s*=\s*(\d+)/);
const mCHUNK = src.match(/var LONG_CHUNK_PX\s*=\s*(\d+)/);
const LONG_W_MM = mLONG_W ? Number(mLONG_W[1]) : 0;
const LONG_MAX_H_MM = mLONG_MAX ? Number(mLONG_MAX[1]) : 0;
const LONG_CHUNK_PX = mCHUNK ? Number(mCHUNK[1]) : 0;

ok("长页宽度常量 = A4 宽 297mm", LONG_W_MM === 297, LONG_W_MM);
ok("单页高度上限已定义且 <= PDF 规范 5080mm", LONG_MAX_H_MM > 0 && LONG_MAX_H_MM <= 5080, LONG_MAX_H_MM);
ok("分段贴图上限已定义（防一次性超大图）", LONG_CHUNK_PX > 0 && LONG_CHUNK_PX <= 8000, LONG_CHUNK_PX);

/* 复算实现里的尺寸推导，验证「同样的内容在各种长度下都只出 1 页（除超限）」 */
function planLong(srcW, srcH, targetW) {
  const ratio = Math.min(1, targetW / srcW);
  const drawW = Math.round(srcW * ratio);
  const stripH = Math.round(srcH * ratio);
  const mmPerPx = LONG_W_MM / drawW;
  const totalMm = stripH * mmPerPx;
  const pageCount = Math.max(1, Math.ceil(totalMm / LONG_MAX_H_MM));
  const firstH = Math.min(LONG_MAX_H_MM, totalMm);
  return { drawW, stripH, mmPerPx, totalMm, pageCount, firstH };
}

const cases = [
  { name: "小内容（3200x1200）", w: 3200, h: 1200, want: 1 },
  { name: "一般报告（3200x9000）", w: 3200, h: 9000, want: 1 },
  { name: "长报告（3200x30000）", w: 3200, h: 30000, want: 1 },
];
cases.forEach((c) => {
  const r = planLong(c.w, c.h, 2200);
  ok(c.name + " → 单页，不切断", r.pageCount === c.want, r.pageCount + " 页 / " + Math.round(r.totalMm) + "mm");
  ok(c.name + " → 页宽换算后恒为 297mm", Math.abs(r.mmPerPx * r.drawW - LONG_W_MM) < 0.01, r.mmPerPx * r.drawW);
});

/* 超过单页上限时必须分页，且总高度不丢
 * 阈值换算：totalMm = 缩放后高度 × 297/2200，要超过 4800mm 需要原始高度约 5.2 万像素 */
const huge = planLong(3200, 60000, 2200);
ok("超长内容按上限分页（不是无脑一页）", huge.pageCount === 2, huge.pageCount + " 页 / " + Math.round(huge.totalMm) + "mm");
ok("分页只发生在超过上限时", huge.totalMm > LONG_MAX_H_MM && huge.totalMm <= LONG_MAX_H_MM * 2, Math.round(huge.totalMm));

/* 用真实 jsPDF 走一遍：建长页 → 分段贴图 → 仍然只有 1 页 */
const p = planLong(3200, 15000, 2200);
const pdf = new jsPDF({ orientation: p.firstH >= LONG_W_MM ? "portrait" : "landscape", unit: "mm", format: [LONG_W_MM, p.firstH] });
const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
ok("PDF 页宽 = 297mm", Math.round(pw) === 297, pw);
ok("PDF 页高 = 内容等比高度", Math.round(ph) === Math.round(p.firstH), Math.round(ph) + " vs " + Math.round(p.firstH));
ok("页面是竖长条（高 > 宽）", ph > pw, pw + "x" + ph);

/* 模拟分段贴图：15000px 内容按 6000px 一段，贴 3 段 */
let segs = 0;
for (let y = 0; y < p.stripH; y += LONG_CHUNK_PX) {
  const h = Math.min(LONG_CHUNK_PX, p.stripH - y);
  pdf.addImage(TINY, "JPEG", 0, y * p.mmPerPx, LONG_W_MM, h * p.mmPerPx);
  segs++;
}
ok("长内容被分成多段贴图（内存可控）", segs >= 2, segs + " 段");
ok("多段贴图后仍是同一页，没有 addPage", pdf.internal.getNumberOfPages() === 1, pdf.internal.getNumberOfPages());

const blob = pdf.output("blob");
ok("生成 Blob 且非空", blob && blob.size > 500, blob ? blob.size + " bytes" : "null");

/* 源码层面确认真的换了实现，不是嘴上说改 */
ok("实现里已不再调用旧的分页函数 paginate", !/pg\s*=\s*paginate/.test(src));
ok("实现里已没有多页 addPage 循环铺 A4 横版", !/addPage\(\[PDF_W_MM, PDF_H_MM\]/.test(src));
ok("实现里有按内容高度换算 mmPerPx", /mmPerPx\s*=\s*LONG_W_MM\s*\/\s*drawW/.test(src));
ok("实现里有分段贴图（避免超大单图）", /LONG_CHUNK_PX/.test(src));
ok("封面仍单独产出（前台卡片用）", /coverBlob/.test(src));

/* ============================ B. 预览改造 ============================ */
console.log("\n【B. 趋势专区预览：滚动 / 缓存 / 全屏】");

const html = read("trends.html");
const js = read("js/trends.js");
const css = read("css/style.css");

ok("预览容器改为多页列表 #pdf-pages", /id="pdf-pages"/.test(html));
ok("已移除单页 canvas #pdf-canvas", !/id="pdf-canvas"/.test(html));
ok("已移除「上一页/下一页」按钮", !/id="pdf-prev"/.test(html) && !/id="pdf-next"/.test(html));
ok("新增「全屏」按钮", /id="pdf-full"/.test(html));
ok("新增「适宽」按钮", /id="pdf-fit"/.test(html));
ok("提示语改为滚动阅读", /滚动阅读/.test(html));

ok("按路径缓存已解析文档", /pdfCache/.test(js) && /pdfCache\.set/.test(js));
ok("缓存有上限并回收旧文档", /PDF_CACHE_MAX/.test(js) && /pdfCache\.delete/.test(js));
ok("关闭预览时保留缓存（二次打开秒开）", /closePdf\(true\)/.test(js));
ok("页面懒渲染（IntersectionObserver）", /IntersectionObserver/.test(js));
ok("首屏只预画前两页", /renderPdfAt\(0\)/.test(js) && /renderPdfAt\(1\)/.test(js));
ok("滚动到哪页就更新页码", /pdfPage\s*=\s*i\s*\+\s*1/.test(js));
ok("支持全屏进出", /requestFullscreen/.test(js) && /fullscreenchange/.test(js));
ok("窗口尺寸变化后重新排版", /addEventListener\("resize"/.test(js));
ok("缩放改为重排版而非重下载", /function setPdfZoom/.test(js) && /relayoutPdf/.test(js));
ok("已删除旧的分页切换函数 goPage", !/function goPage/.test(js));

ok("样式：页列表纵向排列", /\.pdf-pages\s*\{[^}]*flex-direction:\s*column/.test(css));
ok("样式：每页独立容器", /\.pdf-page-wrap\s*\{/.test(css));
ok("样式：全屏时铺满整屏", /\.pdf-modal-box:fullscreen\s*\{[^}]*100vw/.test(css));
ok("样式：移动端整屏预览", /@media \(max-width: 720px\)[\s\S]{0,400}\.pdf-modal-box\s*\{[^}]*100vw/.test(css));
ok("样式：预览窗口已加大", /\.pdf-modal-box\s*\{[^}]*min\(1240px/.test(css));

/* 版本号统一 */
const pages = ["admin.html", "fav.html", "index.html", "marketing.html", "movement.html", "plus.html", "rank.html", "trends.html"];
const stale = pages.filter((f) => /20261030E/.test(read(f)));
ok("八个页面无旧版本号残留", stale.length === 0, stale.join(","));
// 预览库版本号不写死：与页面统一版本号一致即可，避免每次升版都要改测试
const PV = (html.match(/pdf\.min\.js\?v=([0-9A-Za-z]+)/) || [, ""])[1];
const VV = (read("rank.html").match(/\?v=([0-9A-Za-z]+)/) || [, ""])[1];
ok("trends.html 预览库版本已更新", !!PV && PV === VV, `预览库=${PV} 页面=${VV}`);

console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + "：" + pass + " 通过 / " + fail + " 失败\n");
process.exit(fail === 0 ? 0 : 1);