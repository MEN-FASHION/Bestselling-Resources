/* ============================================================
 * 趋势上升榜：「只看标签（位次上升 / 新上榜）」+「导出图片（带标签·高清）」+ 导出权限收紧到超管
 *      —— 运行时验证（真实文件 / 真实代码，不用快照式断言）
 *
 * A. 页面侧（jsdom 解析真实 rank.html，执行真实 js/config.js + js/report.js + js/rank.js）
 *    ① 「只看标签」单选行只在纵向·时间对比出现；点一下就只留下带该标签的图；
 *    ② 命中判定与卡片标签同源：留下的每一张，图上标签都必须匹配；
 *    ③ 再点一次可取消；切到横向自动复位；筛空时给出明确说明；
 *    ④ 导出按钮默认不可见、非超管不可见、超管才出现；点击时把"整列（不被每列上限截断）"交给导出；
 *       开了「只看标签」时，导出范围文字也要写清楚。
 *
 * B. 导出侧（执行真实 js/report.js 的导出实现，只把 canvas / 图片 / 压缩包换成可编程替身）
 *    ⑤ 非超管调用 → 拒绝且不产出任何文件；超管调用 → 逐张出 PNG + 清单 CSV；
 *    ⑥ 画布尺寸 = 原图分辨率（不超过上限）+ 底部标签栏；站点·期次·类目 与 位次标签 都画进标签栏；
 *    ⑦ 取不到像素的图如实计数并写进清单，不假装有图；超过上限只导前 N 张并说明。
 *
 * 用法：node tools/verify_rank_only_export.js <站点仓库根目录>
 * ============================================================ */
const fs = require("fs");
const path = require("path");

let JSDOM, VirtualConsole;
try {
  JSDOM = require("jsdom").JSDOM;
  VirtualConsole = require("jsdom").VirtualConsole;
} catch (e) {
  console.error("需要先安装 jsdom（本脚本用真实浏览器环境跑真实前台脚本）：");
  console.error("  npm install jsdom@22.1.0");
  process.exit(2);
}

const ROOT = process.argv[2] || ".";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; failures.push(name + (extra ? "  [" + extra + "]" : "")); console.log("  \u2717 " + name + (extra ? "  [" + extra + "]" : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 固定数据：让位次标签完全可预期 ----------------
   同一件商品跨周共用同一个图片地址（生产里就是以图片地址认同一件商品）。
   W40 排序（环比降序）A(5) > B(3) > C(1)   → 位次 A=1 B=2 C=3
   W41 排序            B(6) > A(4) > D(2)   → 位次 B=1 A=2 D=3
   ⇒ W41 里：B 上升 1 位、A 下降 1 位、D 新上榜
   W42：A(9) B(8) —— A/B 都在 W41 出现过，所以 W42 没有"新上榜"（A 上升 1 位） */
const U = (n) => "https://img.newtrend.top/" + n + ".jpg";
function mk(p, name, ratio) {
  return {
    image_url: U(name), site: "美国", period_label: p,
    category: "卫衣", leaf_category: "卫衣", ratio: ratio, abs_delta: ratio
  };
}
function makeItems() {
  return [
    mk("2026W40", "A", 5), mk("2026W40", "B", 3), mk("2026W40", "C", 1),
    mk("2026W41", "B", 6), mk("2026W41", "A", 4), mk("2026W41", "D", 2),
    mk("2026W42", "A", 9), mk("2026W42", "B", 8)
  ];
}
const B_URL = U("B"), A_URL = U("A"), C_URL = U("C"), D_URL = U("D");

const EXPORTS = "window.__F=function(){return {ONLY:ONLY,MODE:MODE,SORT:SORT,TAGS:TAGS,MOVE:MOVE,SEL_PERIODS:SEL_PERIODS,SEL_SITES:SEL_SITES," +
  "EXPORT_ITEMS:EXPORT_ITEMS,onlyLabel:onlyLabel,hitOnly:hitOnly,moveOf:moveOf,exportScope:exportScope," +
  "renderBody:renderBody,renderBar:renderBar,setCap:function(n){CAP=n;},setSort:function(s){SORT=s;}};};";

function makeSB(items, cfg) {
  cfg = cfg || {};
  const impl = {
    getSession: async () => ({ access_token: "T", user: { id: "u1", email: "a@b.c" } }),
    onAuth: () => {}, onAuthChange: () => {}, currentToken: async () => "T",
    signOut: async () => {},
    myRole: async () => (cfg.role || "super_admin"),
    getFrontendZoneVisibility: async () => ({}),
    myFrontendZones: async () => null,
    rankFacets: async () => ({ sites: ["美国"], periods: ["2026W40", "2026W41", "2026W42"], categories: ["卫衣"] }),
    listRankSites: async () => [{ name: "美国" }],
    getRankGroups: async () => [],
    getRankHidden: async () => ({ sites: [], periods: [] }),
    listRankItems: async (f) => {
      const p = (f && f.periods) || [];
      return items.filter((it) => !p.length || p.indexOf(it.period_label) >= 0);
    },
  };
  return new Proxy(impl, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k !== "string") return undefined;
      return async () => null;
    },
  });
}

async function bootRank(cfg) {
  cfg = cfg || {};
  const html = read("rank.html").replace(/<script src="[^"]*"><\/script>/g, "");
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: "https://newtrend.top/rank.html" + (cfg.query || ""),
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message || e.error)));
  window.addEventListener("unhandledrejection", (e) => errors.push("unhandled: " + e.reason));

  window.eval(read("js/config.js"));
  window.eval(read("js/report.js"));                 /* 真实导出模块（导出按钮依赖它） */
  window.SB = makeSB(cfg.items || makeItems(), cfg);
  const src = read("js/rank.js");
  const hooked = src.replace(/\}\)\(\);\s*$/, EXPORTS + "})();");
  if (hooked === src) throw new Error("无法注入测试导出（rank.js 尾部结构变化）");
  window.eval(hooked);
  for (let i = 0; i < 90; i++) await sleep(20);
  if (cfg.sort) { window.__F().setSort(cfg.sort); window.__F().renderBody(); await sleep(30); }
  return { dom, window, errors, T: window.__F };
}

/* jsdom 不做真实排版（所有元素尺寸都是 0），这里按「3 列、每列卡片竖排」给出一套
   确定的几何，用来验证「整页定格采集的位置 = 元素在页面上的位置」这一行为。 */
function fakeLayout(w) {
  const doc = w.document;
  const poolsEl = doc.querySelector("#rk-pools");
  if (!poolsEl) return;
  const PW = 280, GAP = 10, HEAD = 46, CARD = 200, IMG = 170;
  const pools = Array.prototype.slice.call(poolsEl.querySelectorAll(".rk-pool"));
  const rect = (l, t, ww, hh) => ({ left: l, top: t, width: ww, height: hh, right: l + ww, bottom: t + hh, x: l, y: t });
  pools.forEach((p, pi) => {
    const left = pi * (PW + GAP);
    const cards = Array.prototype.slice.call(p.querySelectorAll(".rk-card"));
    p.getBoundingClientRect = () => rect(left, 0, PW, HEAD + cards.length * CARD);
    const head = p.querySelector(".rk-pool-head");
    if (head) head.getBoundingClientRect = () => rect(left, 6, PW, 30);
    Array.prototype.forEach.call(p.querySelectorAll(".rk-pool-name span, .rk-pool-meta, .rk-n"), (t) => {
      t.getBoundingClientRect = () => rect(left + 8, 10, 120, 20);
    });
    cards.forEach((c, ci) => {
      const y = HEAD + 4 + ci * CARD;
      c.getBoundingClientRect = () => rect(left + 6, y, PW - 12, CARD - 6);
      const im = c.querySelector("img");
      if (im) im.getBoundingClientRect = () => rect(left + 6, y, PW - 12, IMG);
      const mv = c.querySelector(".rk-move");
      if (mv) mv.getBoundingClientRect = () => rect(left + 12, y + 6, 80, 20);
      const cap = c.querySelector(".rk-title, figcaption");
      if (cap) cap.getBoundingClientRect = () => rect(left + 10, y + IMG + 2, PW - 20, 24);
    });
  });
  poolsEl.getBoundingClientRect = () => rect(0, 0, Math.max(1, pools.length) * (PW + GAP), 1200);
  Object.defineProperty(poolsEl, "scrollWidth", { configurable: true, get: () => Math.max(1, pools.length) * (PW + GAP) });
  Object.defineProperty(poolsEl, "scrollHeight", { configurable: true, get: () => 1200 });
}
function colCards(w) {
  return Array.prototype.slice.call(w.document.querySelectorAll("#rk-pools .rk-pool")).map((p) =>
    Array.prototype.slice.call(p.querySelectorAll(".rk-card")).map((c) => ({
      url: c.getAttribute("data-url") || "",
      move: c.querySelector(".rk-move") ? c.querySelector(".rk-move").textContent.trim() : ""
    }))
  );
}
const movesOf = (cols, i) => (cols[i] || []).map((c) => c.move);
const urlsOf = (cols, i) => (cols[i] || []).map((c) => c.url);
const allCards = (cols) => cols.reduce((a, c) => a.concat(c), []);

/* ---------------- B. 导出侧替身（只替 canvas / 图片 / 压缩包） ---------------- */
function makeExportEnv() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://newtrend.top/rank.html", runScripts: "dangerously", pretendToBeVisual: true });
  const w = dom.window;
  const rec = { canvases: [], rects: [], texts: [], imgs: [], zips: [], clicks: [] };

  /* 图片替身：地址里带 bad 的模拟"取不到像素" */
  class FakeImage {
    constructor() { this.naturalWidth = 0; this.naturalHeight = 0; this.crossOrigin = ""; }
    set src(u) {
      this._src = u;
      setTimeout(() => {
        if (String(u).indexOf("bad") >= 0) { if (this.onerror) this.onerror(); return; }
        this.naturalWidth = 1000; this.naturalHeight = 1500;
        if (this.onload) this.onload();
      }, 0);
    }
    get src() { return this._src; }
  }
  w.Image = FakeImage;

  /* 画布替身：记录每一次填充、每一段文字、每一次贴图，以及画布尺寸 */
  w.HTMLCanvasElement.prototype.getContext = function () {
    const cv = this;
    const mine = { w: cv.width, h: cv.height };
    rec.canvases.push(mine);
    const ctx = {
      fillStyle: "", font: "", textBaseline: "", textAlign: "", lineWidth: 1, strokeStyle: "",
      fillRect(x, y, ww, hh) { rec.rects.push({ cvw: cv.width, cvh: cv.height, x, y, w: ww, h: hh, fill: ctx.fillStyle }); },
      strokeRect() { },
      drawImage(im, dx, dy, dw, dh) { rec.imgs.push({ dx, dy, dw, dh, nw: im.naturalWidth, nh: im.naturalHeight }); },
      fillText(t, x, y) { rec.texts.push({ t: String(t), x, y, font: ctx.font, fill: ctx.fillStyle }); },
      measureText(t) { return { width: String(t).length * 12 }; },
      beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arcTo() { }, rect() { },
      clip() { }, fill() { }, stroke() { }, arc() { },
      clearRect() { }, save() { }, restore() { }, translate() { }, scale() { }, setTransform() { },
    };
    return ctx;
  };
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(["x"], { type: "image/png" })); };
  w.HTMLCanvasElement.prototype.toDataURL = function () { return "data:image/png;base64,AAA"; };

  /* 进度条文案：始终读实时 DOM（导出过程中会变），供断言直接使用 */
  Object.defineProperty(rec, "hudTxt", {
    get() { const h = w.document.querySelector("#rp-hud"); return h ? String(h.textContent || "") : ""; }
  });

  /* 压缩包替身 */
  function FakeZip() { this.files = []; rec.zips.push(this); }
  FakeZip.prototype.file = function (name, data) { this.files.push({ name: name, data: data }); return this; };
  FakeZip.prototype.generateAsync = function () { return Promise.resolve(new w.Blob(["zip"], { type: "application/zip" })); };
  w.JSZip = FakeZip;

  w.URL.createObjectURL = () => "blob:stub";
  w.URL.revokeObjectURL = () => { };
  w.HTMLAnchorElement.prototype.click = function () { rec.clicks.push({ download: this.download, href: this.href }); };

  w.eval(read("js/report.js"));
  return { w, rec, RK: w.ReportKit };
}

const pngCount = (zip) => zip.files.filter((f) => /\.png$/i.test(f.name)).length;
const csvOf = (zip) => (zip.files.find((f) => /\.csv$/i.test(f.name)) || {}).data || "";

/* 整页定格用的绘制指令（结构与 js/rank.js 的采集结果一致）：
   3 列 × n 张 —— 每列一个池框 + 列标题，每张一个卡框 + 图片，首张带位次标签。 */
function mkOps(n) {
  const ops = [];
  let bottom = 0;
  for (let c = 0; c < 3; c++) {
    const x = 10 + c * 300;
    ops.push({ k: "box", x, y: 10, w: 280, h: 90 + n * 210, fill: "#ffffff", stroke: "#e6e0d6", lw: 1, radius: 10 });
    ops.push({ k: "text", x: x + 10, y: 20, w: 200, h: 22, text: "2026W4" + c, size: 14, weight: "700", color: "#1a1a1a" });
    for (let i = 0; i < n; i++) {
      const y = 50 + i * 210;
      ops.push({ k: "box", x: x + 6, y, w: 268, h: 200, fill: "#ffffff", stroke: "#eeeeee", lw: 1, radius: 8 });
      ops.push({ k: "img", x: x + 6, y, w: 268, h: 170, url: U("P" + c + "_" + i), radius: 8 });
      if (i === 0) ops.push({ k: "text", x: x + 14, y: y + 6, w: 90, h: 22, text: "上升 1 位", size: 12, weight: "700", color: "#8a5a00" });
      bottom = Math.max(bottom, y + 200);
    }
  }
  return { root: { w: 910, h: bottom + 20 }, ops };
}

(async function main() {
  console.log("== 趋势上升榜：只看标签 + 高清图片导出（含超管限制）：运行时验证 ==");

  /* ---------------- ① 只看标签：只在纵向出现、单选、可取消 ---------------- */
  console.log("\n[1] 「只看标签」筛选行：只在纵向·时间对比出现");
  {
    const ctx = await bootRank({ query: "?mode=v&sites=%E7%BE%8E%E5%9B%BD&periods=2026W40,2026W41", sort: "ratio_desc" });
    const w = ctx.window;
    const box = w.document.querySelector("#rk-g-only");
    ok("纵向·时间对比下出现「只看标签」筛选行", !!box);
    const labels = box ? Array.prototype.slice.call(box.querySelectorAll("[data-only]")).map((b) => b.textContent.trim()) : [];
    ok("包含「全部 / 只看位次上升 / 只看新上榜」三项",
      labels.join("|") === "全部|只看位次上升|只看新上榜", labels.join("|"));
    ok("默认停在「全部」", ctx.T().ONLY === "off", ctx.T().ONLY);
    ok("默认「全部」高亮", (box.querySelector('[data-only="off"]').className || "").indexOf("active") >= 0);
    const cols = colCards(w);
    ok("先确认：两列都在（W40 首期 / W41 较 W40）", cols.length === 2 && cols[0].length === 3 && cols[1].length === 3,
      JSON.stringify(cols.map((c) => c.length)));
    ok("位次标签算对：W41 依次为 上升 1 位 / 下降 1 位 / 新上榜",
      movesOf(cols, 1).join("|") === "上升 1 位|下降 1 位|新上榜", movesOf(cols, 1).join("|"));
    ok("首期列不带位次标签（没有上一周可比）", movesOf(cols, 0).join("|") === "||", movesOf(cols, 0).join("|"));
  }

  console.log("\n[2] 点「只看位次上升 / 只看新上榜」：只留下带该标签的图（与图上标签同源）");
  {
    const ctx = await bootRank({ query: "?mode=v&sites=%E7%BE%8E%E5%9B%BD&periods=2026W40,2026W41", sort: "ratio_desc" });
    const w = ctx.window;
    const click = (sel) => w.document.querySelector(sel).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

    click('#rk-g-only [data-only="up"]');
    await sleep(40);
    let cols = colCards(w);
    ok("「只看位次上升」→ 状态为 up", ctx.T().ONLY === "up", ctx.T().ONLY);
    ok("界面上只剩这一项高亮",
      Array.prototype.slice.call(w.document.querySelectorAll("#rk-g-only [data-only]"))
        .filter((b) => (b.className || "").indexOf("active") >= 0).length === 1);
    ok("W41 只留下「上升 1 位」的 B",
      urlsOf(cols, 1).join(",") === B_URL && movesOf(cols, 1).join("") === "上升 1 位", urlsOf(cols, 1).join(","));
    ok("没有上一周的列（W40）不受影响，照常显示 3 张",
      urlsOf(cols, 0).join(",") === [A_URL, B_URL, C_URL].join(","), urlsOf(cols, 0).join(","));
    ok("总数 3(首期) + 1(上升) = 4", allCards(cols).length === 4, String(allCards(cols).length));
    ok("留下的每一张，图上标签都确实匹配（没有偷漏）",
      allCards(cols).every((c) => !c.move || c.move === "上升 1 位"), JSON.stringify(allCards(cols)));

    click('#rk-g-only [data-only="new"]');
    await sleep(40);
    cols = colCards(w);
    ok("「只看新上榜」→ 状态为 new", ctx.T().ONLY === "new", ctx.T().ONLY);
    ok("W41 只留下「新上榜」的 D",
      urlsOf(cols, 1).join(",") === D_URL && movesOf(cols, 1).join("") === "新上榜", urlsOf(cols, 1).join(","));
    ok("总数 3 + 1 = 4", allCards(cols).length === 4, String(allCards(cols).length));
    ok("留下的每一张都确实带匹配标签",
      allCards(cols).every((c) => !c.move || c.move === "新上榜"), JSON.stringify(allCards(cols)));

    click('#rk-g-only [data-only="new"]');
    await sleep(40);
    ok("再点一次已选中的 → 取消，回到「全部」", ctx.T().ONLY === "off", ctx.T().ONLY);
    ok("取消后 6 张全部回来", allCards(colCards(w)).length === 6, String(allCards(colCards(w)).length));
    ok("全程无未捕获错误", ctx.errors.length === 0, ctx.errors.join(" | ").slice(0, 160));
  }

  console.log("\n[3] 横向·国家对比没有位次基线：不显示该行，且从纵向切过去自动复位");
  {
    const ctx = await bootRank({ query: "?mode=h&sites=%E7%BE%8E%E5%9B%BD", sort: "ratio_desc" });
    ok("横向下不出现「只看标签」筛选行", !ctx.window.document.querySelector("#rk-g-only"));

    const ctx2 = await bootRank({ query: "?mode=v&sites=%E7%BE%8E%E5%9B%BD&periods=2026W40,2026W41", sort: "ratio_desc" });
    const w2 = ctx2.window;
    const click = (sel) => w2.document.querySelector(sel).dispatchEvent(new w2.MouseEvent("click", { bubbles: true }));
    click('#rk-g-only [data-only="up"]');
    await sleep(40);
    ok("纵向下先选中「只看位次上升」", ctx2.T().ONLY === "up", ctx2.T().ONLY);
    click('#rk-g-mode [data-mode="h"]');
    await sleep(160);
    ok("切到横向后自动复位为「全部」（避免界面高亮、实际没筛的错位）", ctx2.T().ONLY === "off", ctx2.T().ONLY);
    ok("横向下该行也不再出现", !w2.document.querySelector("#rk-g-only"));
    ok("切换过程无未捕获错误", ctx2.errors.length === 0, ctx2.errors.join(" | ").slice(0, 160));
  }

  console.log("\n[4] 筛完没有命中：给出明确说明（而不是含糊的「暂无数据」）");
  {
    /* W42 的两张都在 W41 出现过 → 「只看新上榜」在 W42 上一张都不命中 */
    const ctx = await bootRank({ query: "?mode=v&sites=%E7%BE%8E%E5%9B%BD&periods=2026W42", sort: "ratio_desc" });
    const w = ctx.window;
    const click = (sel) => w.document.querySelector(sel).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const body = () => (w.document.querySelector("#rk-body").textContent || "").trim();
    ok("先确认：W42 的两张都不是新上榜（都在 W41 出现过）",
      movesOf(colCards(w), 0).join("|") === "上升 1 位|下降 1 位", movesOf(colCards(w), 0).join("|"));
    click('#rk-g-only [data-only="new"]');
    await sleep(60);
    ok("筛空时给出明确说明，并点名「只看新上榜」", body().indexOf("只看新上榜") >= 0, body().slice(0, 80));
    ok("并给出可操作的下一步（点「全部」）", body().indexOf("全部") >= 0, body().slice(0, 80));
    ok("不是含糊的默认文案", body().indexOf("该组合下暂无榜单数据") < 0, body().slice(0, 80));
    click('#rk-g-only [data-only="off"]');
    await sleep(60);
    ok("点回「全部」后图片恢复显示", allCards(colCards(w)).length === 2, String(allCards(colCards(w)).length));
  }

/* ---------------- ② 导出按钮：默认不可见 / 非超管不可见 / 超管才出现 ---------------- */
  console.log("\n[5] 「导出图片（整页 · 高清）」按钮：只允许超级管理员");
  {
    const ctx = await bootRank({ query: "?mode=v&sites=%E7%BE%8E%E5%9B%BD&periods=2026W40,2026W41", sort: "ratio_desc", role: "member" });
    await sleep(120);
    const b = ctx.window.document.querySelector("#rk-exp-img");
    ok("普通角色：按钮不出现（保持隐藏）", !!b && (b.className || "").indexOf("on") < 0, b ? b.className : "no-button");
  }
  {
    const ctx = await bootRank({ query: "?mode=v&sites=%E7%BE%8E%E5%9B%BD&periods=2026W40,2026W41", sort: "ratio_desc", role: "super_admin" });
    await sleep(120);
    const w = ctx.window;
    const b = w.document.querySelector("#rk-exp-img");
    ok("超级管理员：按钮出现", !!b && (b.className || "").indexOf("on") >= 0, b ? b.className : "no-button");
    ok("按钮文案写明「整页 · 高清」（导的是页面，不是单张原图）",
      b && b.textContent.indexOf("导出图片") >= 0 && b.textContent.indexOf("整页") >= 0 && b.textContent.indexOf("高清") >= 0,
      b ? b.textContent : "");

    /* 点击 → 交给导出模块的是「整页定格」的绘制指令（位置 = 屏幕上看到的位置） */
    let got = null;
    w.ReportKit.exportImages = (p) => { got = p; return Promise.resolve(true); };
    ctx.T().setCap(2);            /* 把每列展示上限压到 2：整页定格应当只定格屏幕上真正显示的 */
    ctx.T().renderBody();
    fakeLayout(w);                /* jsdom 无排版：给出一套确定的几何 */
    const shown = w.document.querySelectorAll("#rk-pools .rk-card").length;
    w.document.querySelector("#rk-exp-img").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(40);

    ok("点击后把整页定格的绘制指令交给导出模块",
      !!got && Array.isArray(got.ops) && got.ops.length > 0 && got.root && got.root.w > 0 && got.root.h > 0,
      got ? ("ops=" + got.ops.length + " root=" + JSON.stringify(got.root)) : "no-payload");

    const imgOps = got ? got.ops.filter((o) => o.k === "img") : [];
    ok("绘制指令里的图片数 = 屏幕上真正显示的卡片数",
      imgOps.length === shown && shown > 0, "图片 " + imgOps.length + " / 卡片 " + shown);

    const textOps = got ? got.ops.filter((o) => o.k === "text") : [];
    ok("列标题（周次）也定格进去了",
      textOps.some((t) => /2026W4\d/.test(t.text)), textOps.slice(0, 8).map((t) => t.text).join(" | "));
    ok("位次标签文字也定格进去了（上升 1 位）",
      textOps.some((t) => t.text.indexOf("上升 1 位") >= 0), textOps.map((t) => t.text).join(" | "));
    ok("每张图都带着自己的地址（同一件商品跨周会出现多次，但不止一种地址）",
      imgOps.length > 1 && new Set(imgOps.map((o) => o.url)).size > 1,
      imgOps.map((o) => o.url).join(" | ").slice(0, 160));

    /* 位置取自真实布局：同一列的图片 y 递增，不同列的 x 不同 */
    const col0 = imgOps.filter((o) => Math.abs(o.x - imgOps[0].x) < 2).map((o) => o.y);
    ok("同一列的图片按屏幕顺序自上而下排列（y 递增）",
      col0.length > 1 && col0.every((y, i) => i === 0 || y >= col0[i - 1]), JSON.stringify(col0));
    ok("不同列落在不同的横向位置（x 不都一样）",
      new Set(imgOps.map((o) => o.x)).size > 1, JSON.stringify(Array.from(new Set(imgOps.map((o) => o.x)))));

    /* 开了「只看标签」时，导出范围文字也要写清楚 */
    w.document.querySelector('#rk-g-only [data-only="up"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(40);
    fakeLayout(w);                /* 筛选后重新渲染，几何要重设 */
    got = null;
    w.document.querySelector("#rk-exp-img").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(40);
    ok("只看位次上升时，导出的范围文字带上了这个筛选",
      got && String(got.scope).indexOf("只看位次上升") >= 0, got ? String(got.scope) : "");
    const imgOps2 = got ? got.ops.filter((o) => o.k === "img") : [];
    ok("并且定格的图片只剩命中项（比筛选前少）", imgOps2.length > 0 && imgOps2.length < imgOps.length,
      imgOps2.length + " / " + imgOps.length);
  }

  /* ---------------- ③ 导出实现：整页一张高清长图 ---------------- */
  console.log("\n[6] 导出实现：非超管调用被拒绝，且不产出任何文件");
  {
    const { rec, RK } = makeExportEnv();
    RK._.cfg.isSuper = () => false;
    const r = await RK.exportImages(mkOps(2));
    ok("返回 false（明确拒绝）", r === false, String(r));
    ok("没有触发下载", rec.clicks.length === 0, String(rec.clicks.length));
    ok("没有画任何东西", rec.canvases.length === 0, String(rec.canvases.length));
    ok("给出「只有超级管理员」的提示",
      /超级管理员/.test((rec.hudTxt || "").slice(-400)), (rec.hudTxt || "").slice(-80));
  }

  console.log("\n[7] 导出实现：超管 → 一张整页长图（2 倍尺寸，可放大）");
  {
    const { rec, RK } = makeExportEnv();
    RK._.cfg.isSuper = () => true;
    const payload = mkOps(3);
    const r = await RK.exportImages(payload);
    ok("返回 true（导出完成）", r === true, String(r));

    ok("只产出 1 个文件（整页一张，不是逐张图 + 压缩包）",
      rec.clicks.length === 1 && rec.zips.length === 0,
      "下载 " + rec.clicks.length + " / 压缩包 " + rec.zips.length);
    ok("文件名是 PNG 且写明「整页」",
      rec.clicks.length === 1 && /\.png$/i.test(rec.clicks[0].download) && rec.clicks[0].download.indexOf("整页") >= 0,
      rec.clicks.length ? rec.clicks[0].download : "no-click");

    const cvs = rec.canvases[0];
    ok("画布尺寸 = 页面尺寸 × 2（高清，可放大看清细节）",
      !!cvs && cvs.w === payload.root.w * 2 && cvs.h === payload.root.h * 2,
      cvs ? (cvs.w + " × " + cvs.h + " / 期望 " + (payload.root.w * 2) + " × " + (payload.root.h * 2)) : "no-canvas");

    const imgCount = payload.ops.filter((o) => o.k === "img").length;
    ok("每一张图都贴进了它自己的位置（贴图次数 = 图片数）",
      rec.imgs.length === imgCount, rec.imgs.length + " / " + imgCount);
    ok("图片是铺满自己的框（等比裁切，和网页一致）",
      rec.imgs.every((d) => d.dw >= 0 && d.dh >= 0 && (Math.abs(d.dw - 536) < 2 || Math.abs(d.dh - 340) < 2)),
      JSON.stringify(rec.imgs.slice(0, 2)));
    ok("列标题写进了图里", rec.texts.some((t) => t.t === "2026W40"), rec.texts.slice(0, 6).map((t) => t.t).join(" | "));
    ok("位次标签写进了图里且是加粗", rec.texts.some((t) => t.t === "上升 1 位" && /bold/i.test(t.font)),
      rec.texts.filter((t) => t.t === "上升 1 位").map((t) => t.font).join(" | "));
    ok("提示里写明了成图尺寸与含图数量",
      /整页 \d+ × \d+ 像素/.test(rec.hudTxt || "") && /含图 \d+ 张/.test(rec.hudTxt || ""),
      (rec.hudTxt || "").slice(-120));
  }

  console.log("\n[8] 整页图：取不到像素的图留白标注，并如实计数");
  {
    const { rec, RK } = makeExportEnv();
    RK._.cfg.isSuper = () => true;
    const payload = mkOps(2);
    const imgs = payload.ops.filter((o) => o.k === "img");
    imgs[0].url = "https://img.newtrend.top/bad_one.jpg";     /* 替身里带 bad 的一律加载失败 */
    const r = await RK.exportImages(payload);
    ok("仍然返回成功（不会因为一张图失败就整张作废）", r === true, String(r));
    ok("仍然只出 1 个文件", rec.clicks.length === 1, String(rec.clicks.length));
    ok("坏图位置上写了「取不到图」", rec.texts.some((t) => t.t === "取不到图"),
      rec.texts.map((t) => t.t).join(" | ").slice(0, 160));
    ok("提示里如实写了「1 张取不到像素」", /1 张取不到像素/.test(rec.hudTxt || ""), (rec.hudTxt || "").slice(-120));
  }

  console.log("\n[9] 进度与暂停 / 取消：导出中出现两个按钮，取消后不产出任何文件");
  {
    const { rec, w, RK } = makeExportEnv();
    RK._.cfg.isSuper = () => true;
    const doc = w.document;
    const p = RK.exportImages(mkOps(30));
    await sleep(30);
    let hud = doc.querySelector("#rp-hud");
    ok("导出期间右下角有进度条", !!hud);
    ok("进度条上有「暂停」和「取消」两个按钮",
      !!(hud && hud.querySelector('[data-job="pause"]') && hud.querySelector('[data-job="cancel"]')),
      hud ? hud.textContent.replace(/\s+/g, " ").slice(0, 80) : "no-hud");
    ok("进度里写清了在做哪一步（铺版面 / 贴图 / 写文字）",
      !!(hud && /铺版面|贴图|写文字|生成/.test(hud.textContent || "")), hud ? hud.textContent.replace(/\s+/g, " ").slice(0, 80) : "");

    /* 暂停：进度停住，文案变成「已暂停」，按钮变成「继续」 */
    hud.querySelector('[data-job="pause"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(30);
    hud = doc.querySelector("#rp-hud");
    ok("点「暂停」后按钮变成「继续」",
      hud.querySelector('[data-job="pause"]').textContent === "继续",
      hud.querySelector('[data-job="pause"]').textContent);
    const tA = (hud.querySelector(".rp-hud-txt") || {}).textContent || "";
    ok("暂停时提示「已暂停」", /已暂停/.test(tA), tA);
    await sleep(260);
    const tB = (doc.querySelector("#rp-hud .rp-hud-txt") || {}).textContent || "";
    ok("暂停期间进度确实不动", tA === tB, tA + " → " + tB);

    /* 继续：能接着跑 */
    doc.querySelector('#rp-hud [data-job="pause"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(120);
    const tC = (doc.querySelector("#rp-hud .rp-hud-txt") || {}).textContent || "";
    ok("点「继续」后进度恢复推进", tC !== tB, tB + " → " + tC);

    /* 取消：立刻停，且不产出文件 */
    doc.querySelector('#rp-hud [data-job="cancel"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const r = await p;
    ok("取消后返回 false（未完成）", r === false, String(r));
    ok("取消后没有触发任何下载", rec.clicks.length === 0, String(rec.clicks.length));
    const end = (doc.querySelector("#rp-hud .rp-hud-txt") || {}).textContent || "";
    ok("并明确告知「已取消导出（未生成任何文件）」", /已取消/.test(end) && /未生成/.test(end), end);
  }

  console.log("\n[10] 导出 PPT：同样有进度条与取消按钮，取消后不生成文件");
  {
    const { rec, w, RK } = makeExportEnv();
    RK._.cfg.isSuper = () => true;
    /* 补齐 PPT 导出需要的三个依赖组件（替身） */
    w.JSZip = function () { };
    w.html2canvas = function () { };
    w.PptxGenJS = function () { rec.pptxBuilt = (rec.pptxBuilt || 0) + 1; };

    /* 造一个天眼容器：3 列 × 60 张（够多，确保点击时还在读图阶段） */
    let html = "";
    for (let c = 0; c < 3; c++) {
      html += '<section class="rk-pool"><div class="rk-pool-head"><div class="rk-pool-name"><span>2026W4' + c + '</span>'
        + '<span class="rk-n">60 张</span></div><div class="rk-pool-meta">美国</div></div><div class="rk-pool-grid">';
      for (let i = 0; i < 60; i++) html += '<figure class="rk-card" data-url="' + U("K" + c + "_" + i) + '"><img src="' + U("K" + c + "_" + i) + '"></figure>';
      html += "</div></section>";
    }
    w.document.body.insertAdjacentHTML("beforeend", '<div id="rk-eye-body"><div class="rk-pools" id="eye-pools">' + html + "</div></div>");
    Array.prototype.forEach.call(w.document.querySelectorAll("#eye-pools img"), (im) => {
      Object.defineProperty(im, "naturalWidth", { configurable: true, value: 1000 });
      Object.defineProperty(im, "naturalHeight", { configurable: true, value: 1500 });
    });

    const p = w.ReportKit.exportEye();
    await sleep(12);
    let hud = w.document.querySelector("#rp-hud");
    ok("PPT 导出期间出现进度条", !!hud);
    ok("PPT 进度条上同样有「暂停」和「取消」",
      !!(hud && hud.querySelector('[data-job="pause"]') && hud.querySelector('[data-job="cancel"]')),
      hud ? hud.textContent.replace(/\s+/g, " ").slice(0, 80) : "no-hud");

    /* 先暂停（确定性：暂停期间一定还没组装），再取消 —— 取消必须让它停在原地且不产出文件 */
    if (hud && hud.querySelector('[data-job="pause"]')) {
      hud.querySelector('[data-job="pause"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await sleep(40);
      const tA = (w.document.querySelector("#rp-hud .rp-hud-txt") || {}).textContent || "";
      ok("PPT 导出也能暂停（提示「已暂停」）", /已暂停/.test(tA), tA);
      hud = w.document.querySelector("#rp-hud");
    }
    if (hud && hud.querySelector('[data-job="cancel"]')) {
      hud.querySelector('[data-job="cancel"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    }
    await p;
    await sleep(80);
    ok("取消后没有生成 PPT（连文件对象都没造）", !rec.pptxBuilt, String(rec.pptxBuilt || 0));
    ok("取消后没有触发下载", rec.clicks.length === 0, String(rec.clicks.length));
    ok("并明确告知取消了",
      /已取消/.test((w.document.querySelector("#rp-hud .rp-hud-txt") || {}).textContent || ""),
      (w.document.querySelector("#rp-hud .rp-hud-txt") || {}).textContent || "");
  }

  console.log("\n== 结果：" + pass + " 通过 / " + fail + " 失败 ==");
  if (fail) { console.log("\n失败项："); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
})();