/* 导出「整页高清图」文字绘制：不许丢字（W42 → W4 回归套件）
 *
 * 背景：整页定格导出时，文字是按「元素框宽度」逐字折行的；只要有任何一个字符
 *       比框宽出一点点，它就会掉到第二行，而「最多排到元素高度」会把多出来的整行丢掉。
 *       周次标签「W42」在窄列下就变成了「W4」——这就是用户报的「周数字展示不全」。
 *
 * 本套件用可编程 canvas 替身，直接驱动真实的 ReportKit._.drawTextOp：
 *   - 造一个「比框宽一点点」的场景，断言整段文字完整画出；
 *   - 断言会自动缩小字号去适配，而不是丢字；
 *   - 断言短标签即使在最小字号下仍放不下，也整段画出（宁可靠出一点）；
 *   - 断言长文本依旧折行 + 明确加省略号，不静默吞字；
 *   - 断言 DOM 侧（rank.js）会给单行短标签打 nowrap 标记，CSS 也不再挤压列头。
 *
 * 用法：node tools/verify_export_text_fit.js
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

/* ---------- 可编程 canvas 上下文：记录每一次 fillText ---------- */
function mkCtx(opts) {
  opts = opts || {};
  const rec = { texts: [], font: "" };
  const boldWider = opts.boldWider === undefined ? 1.05 : opts.boldWider;
  const ctx = {
    font: "",
    fillStyle: "#000",
    textBaseline: "",
    textAlign: "",
    measureText(t) {
      const bold = /^bold /.test(ctx.font);
      const px = parseFloat((ctx.font.match(/(\d+(?:\.\d+)?)px/) || [])[1] || 12);
      /* 粗体比常规宽 5%（真实字体就是这样，也正是「布局按常规算、绘制按粗体画」才会差出几像素） */
      return { width: String(t).length * px * 0.62 * (bold ? boldWider : 1) };
    },
    fillText(t, x, y) { rec.texts.push({ t: String(t), x, y, font: ctx.font }); },
  };
  rec.ctx = ctx;
  return rec;
}
const sizeOf = (font) => parseFloat((String(font).match(/(\d+(?:\.\d+)?)px/) || [])[1] || 0);

/* ---------- 启动真实的 report.js（jsdom + 替身） ---------- */
function boot() {
  const html = "<!doctype html><html><body><div id='rp-hud'></div></body></html>";
  const dom = new JSDOM(html, { url: "https://example.test/rank.html", pretendToBeVisual: true, runScripts: "dangerously" });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { return mkCtx().ctx; };
  w.eval(read("js/config.js"));
  w.eval(read("js/report.js"));
  return { dom, w, RK: w.ReportKit };
}

const { w, RK } = boot();
const D = RK && RK._;
ok("report.js 正常初始化，ReportKit 挂到 window", !!RK && typeof RK.exportImages === "function");
ok("绘制函数可从 ReportKit 取到（供验证与复用）", !!D && typeof D.drawTextOp === "function");
ok("缩放下限常量已导出且合理", !!D && D.TEXT_SHRINK_MIN > 0.3 && D.TEXT_SHRINK_MIN <= 0.8, D && D.TEXT_SHRINK_MIN);

/* ================= ① 核心回归：框比文字窄一点点，也不能丢字 ================= */
{
  /* 复刻线上情形：13.5px 粗体的「W42」，元素框只比它窄 2px */
  const rec = mkCtx();
  const op = { k: "text", x: 0, y: 0, w: 25, h: 18, text: "W42", size: 13.5, weight: "700", color: "#1a1a1a", nowrap: true };
  D.drawTextOp(rec.ctx, op, 2);
  const all = rec.texts.map((t) => t.t).join("");
  ok("「W42」整段完整画出（不再变成 W4）", all === "W42", JSON.stringify(rec.texts.map((t) => t.t)));
  ok("只画一行（不会把末位推到第二行再被丢掉）", rec.texts.length === 1, rec.texts.length);
  ok("为了塞进框内，字号被自动缩小", sizeOf(rec.texts[0].font) <= 26 && sizeOf(rec.texts[0].font) > 4, rec.texts[0].font);
}

{
  /* 两周对比：41 / 41 两个标签都必须完整 */
  ["W41", "W42", "2026W41"].forEach((lab) => {
    const rec = mkCtx();
    D.drawTextOp(rec.ctx, { k: "text", x: 0, y: 0, w: 30, h: 18, text: lab, size: 13.5, weight: "700", nowrap: true }, 2);
    ok("周次「" + lab + "」完整", rec.texts.map((t) => t.t).join("") === lab, JSON.stringify(rec.texts.map((t) => t.t)));
  });
}

/* ================= ② 没有 nowrap 标记（老数据 / 其它入口）也不能丢 ================= */
{
  const rec = mkCtx();
  D.drawTextOp(rec.ctx, { k: "text", x: 0, y: 0, w: 25, h: 18, text: "W42", size: 13.5, weight: "700" }, 2);
  ok("未标记 nowrap 时同样完整（靠缩字号适配）", rec.texts.map((t) => t.t).join("") === "W42", JSON.stringify(rec.texts.map((t) => t.t)));
}

/* ================= ③ 真的放不下时：短标签整段画出，长文本加省略号 ================= */
{
  const rec = mkCtx();
  D.drawTextOp(rec.ctx, { k: "text", x: 0, y: 0, w: 4, h: 18, text: "W42", size: 13.5, weight: "700", nowrap: true }, 2);
  ok("极端窄框下短标签仍整段画出（宁可靠出一点，也不能少数字）",
    rec.texts.map((t) => t.t).join("") === "W42", JSON.stringify(rec.texts.map((t) => t.t)));
  ok("且已被缩到接近下限", sizeOf(rec.texts[0].font) <= 13.5 * 2 * D.TEXT_SHRINK_MIN + 0.5, rec.texts[0].font);
}

{
  const long = "美国·较上一周（W41）新上榜 109 张，其中潜力机会 32 张、趋势爆款 18 张";
  const rec = mkCtx();
  D.drawTextOp(rec.ctx, { k: "text", x: 0, y: 0, w: 90, h: 26, text: long, size: 11.5, weight: "400" }, 2);
  const joined = rec.texts.map((t) => t.t).join("");
  ok("长文本允许折行但总行数受高度限制", rec.texts.length >= 1 && rec.texts.length <= 2, rec.texts.length);
  ok("长文本要么完整、要么以省略号明确收尾（不静默吞字）", joined === long || /…$/.test(rec.texts[rec.texts.length - 1].t), JSON.stringify(rec.texts.map((t) => t.t)));
  ok("每行都不会超出框宽太多", rec.texts.every((t) => rec.ctx.measureText(t.t).width <= 90 * 2 + 2), JSON.stringify(rec.texts.map((t) => t.t)));
}

/* ================= ④ 正常宽框：字号不变、文字不被缩小 ================= */
{
  const rec = mkCtx();
  D.drawTextOp(rec.ctx, { k: "text", x: 0, y: 0, w: 200, h: 18, text: "W42", size: 13.5, weight: "700", nowrap: true }, 2);
  ok("框足够宽时不缩小字号", Math.abs(sizeOf(rec.texts[0].font) - 27) < 0.01, rec.texts[0].font);
  ok("框足够宽时文字完整", rec.texts.map((t) => t.t).join("") === "W42");
}

/* ================= ⑤ 采集端：单行短标签要被打上 nowrap ================= */
{
  const rank = read("js/rank.js");
  ok("定格采集会计算元素是否为单行", /var oneLine = \(rr\.h <= lh \* 1\.6\)/.test(rank));
  ok("定格采集会给单行短标签打 nowrap 标记", /nowrap:\s*oneLine && txt\.length <= 16/.test(rank));
  ok("单行判定用行高而不是固定高度", /var lh = parseFloat\(cs\.lineHeight\) \|\| fs \* 1\.4/.test(rank));
}

/* ================= ⑥ 样式端：列头的周次与计数都不许被挤压 ================= */
{
  const css = read("css/style.css");
  const nameCss = (css.match(/(?:^|\n)\.rk-pool-name \{[^}]*\}/) || [""])[0];
  ok("列头行允许折行（放不下时整行换行，而不是压缩文字）", /flex-wrap:\s*wrap/.test(nameCss), nameCss.slice(0, 60));
  ok("周次标签禁止收缩", /\.rk-pool-name > span:first-child \{[^}]*flex:\s*0 0 auto/.test(css));
  ok("周次标签禁止换行", /\.rk-pool-name > span:first-child \{[^}]*white-space:\s*nowrap/.test(css));
  ok("「N 张」计数禁止收缩", /\.rk-pool-name \.rk-n \{[^}]*flex:\s*0 0 auto/.test(css));
  ok("「N 张」计数禁止换行", /\.rk-pool-name \.rk-n \{[^}]*white-space:\s*nowrap/.test(css));
}

/* ================= ⑦ 反向验证：把旧实现放回去，必须报错 ================= */
{
  const rec = mkCtx();
  /* 旧实现（逐字折行 + 按高度截断）等价逻辑 */
  const txt = "W42", S = 2, wBox = 25 * S, h = 18;
  rec.ctx.font = "bold 27px Microsoft YaHei";
  let cur = "", lines = [];
  for (let i = 0; i < txt.length; i++) {
    const t = cur + txt.charAt(i);
    if (cur && rec.ctx.measureText(t).width > wBox) { lines.push(cur); cur = txt.charAt(i); }
    else cur = t;
  }
  if (cur) lines.push(cur);
  const maxLines = Math.max(1, Math.floor(h / (27 * 1.34)));
  const old = lines.slice(0, maxLines).join("");
  ok("反向验证：旧实现确实会丢掉末位（说明这条回归有意义）", old !== "W42", old);
  ok("反向验证：新实现同一场景不丢字", (() => {
    const r2 = mkCtx();
    D.drawTextOp(r2.ctx, { k: "text", x: 0, y: 0, w: 25, h: 18, text: "W42", size: 13.5, weight: "700", nowrap: true }, 2);
    return r2.texts.map((t) => t.t).join("") === "W42";
  })());
}

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
if (fails.length) { console.log("失败项："); fails.forEach((f) => console.log(" - " + f)); }
try { w.close(); } catch (e) { /* 忽略 */ }
process.exit(fail ? 1 : 0);