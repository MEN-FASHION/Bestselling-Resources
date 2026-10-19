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

/* 每一列（对比池）当前的卡片：url + 位次标签文案（无标签则空串） */
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
      fillStyle: "", font: "", textBaseline: "", textAlign: "",
      fillRect(x, y, ww, hh) { rec.rects.push({ cvw: cv.width, cvh: cv.height, x, y, w: ww, h: hh, fill: ctx.fillStyle }); },
      drawImage(im, dx, dy, dw, dh) { rec.imgs.push({ dx, dy, dw, dh, nw: im.naturalWidth, nh: im.naturalHeight }); },
      fillText(t, x, y) { rec.texts.push({ t: String(t), x, y, font: ctx.font, fill: ctx.fillStyle }); },
      measureText(t) { return { width: String(t).length * 12 }; },
      clearRect() { }, save() { }, restore() { }, translate() { }, scale() { }, setTransform() { },
    };
    return ctx;
  };
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(["x"], { type: "image/png" })); };

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
  console.log("\n[5] 「导出图片（带标签 · 高清）」按钮：只允许超级管理员");
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
    ok("按钮文案写明「带标签 · 高清」", b && b.textContent.indexOf("导出图片") >= 0 && b.textContent.indexOf("高清") >= 0, b ? b.textContent : "");

    /* 点击 → 交给导出模块，且交付的是"整列"（不被每列展示上限截断） */
    let got = null;
    w.ReportKit.exportImages = (p) => { got = p; return Promise.resolve(true); };
    ctx.T().setCap(2);            /* 把每列展示上限压到 2，用于验证导出不受它影响 */
    ctx.T().renderBody();
    const shown = w.document.querySelectorAll("#rk-pools .rk-card").length;
    const click = (sel) => w.document.querySelector(sel).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    click("#rk-exp-img");
    await sleep(40);
    ok("点击后确实把清单交给导出模块", !!got && Array.isArray(got.items));
    ok("导出清单是整列（2 列 × 3 张 = 6），不受「每列最多展示 2 张」截断",
      got && got.items.length === 6 && shown === 4, "导出 " + (got ? got.items.length : "-") + " 张 / 屏上 " + shown + " 张");
    ok("每一条都带站点 / 期次 / 类目",
      got && got.items.every((x) => x.site === "美国" && /^2026W4\d$/.test(x.period) && x.cat === "卫衣"),
      got ? JSON.stringify(got.items[0]) : "");
    ok("位次标签一起带出去（W41 的 B = 上升 1 位）",
      got && got.items.some((x) => x.url === B_URL && x.label === "上升 1 位" && x.period === "2026W41"),
      got ? JSON.stringify(got.items.filter((x) => x.label)) : "");

    /* 开了「只看标签」时，导出范围文字也要写清楚 */
    w.document.querySelector('#rk-g-only [data-only="up"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(40);
    got = null;
    w.document.querySelector("#rk-exp-img").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(40);
    ok("只看位次上升时，导出的范围文字带上了这个筛选",
      got && String(got.scope).indexOf("只看位次上升") >= 0, got ? String(got.scope) : "");
    ok("并且导出清单只剩命中的图（3 首期 + 1 上升）", got && got.items.length === 4, got ? String(got.items.length) : "");
  }

  /* ---------------- ③ 导出实现本身 ---------------- */
  console.log("\n[6] 导出实现：非超管调用被拒绝，且不产出任何文件");
  {
    const { rec, RK } = makeExportEnv();
    RK._.cfg.isSuper = () => false;
    const r = await RK.exportImages({ items: [{ url: U("A"), label: "上升 1 位", site: "美国", period: "2026W41", cat: "卫衣" }], scope: "x" });
    ok("返回 false（明确拒绝）", r === false, String(r));
    ok("没有产出压缩包", rec.zips.length === 0, String(rec.zips.length));
    ok("没有触发下载", rec.clicks.length === 0, String(rec.clicks.length));
    ok("没有画任何图", rec.canvases.length === 0, String(rec.canvases.length));
  }

  console.log("\n[7] 导出实现：超管调用 → 逐张高清 PNG + 标签栏 + 清单");
  {
    const { rec, RK } = makeExportEnv();
    RK._.cfg.isSuper = () => true;
    const r = await RK.exportImages({
      items: [
        { url: U("A"), label: "上升 1 位", site: "美国", period: "2026W41", cat: "卫衣" },
        { url: U("B"), label: "下降 1 位", site: "美国", period: "2026W41", cat: "卫衣" },
        { url: "https://img.newtrend.top/bad_x.jpg", label: "新上榜", site: "美国", period: "2026W41", cat: "卫衣" },
      ],
      scope: "卫衣 · 美国 · 2026W40、2026W41",
    });
    ok("返回 true（导出完成）", r === true, String(r));
    ok("产出 1 个压缩包", rec.zips.length === 1, String(rec.zips.length));
    const zip = rec.zips[0];
    ok("压缩包里 2 张 PNG（取不到像素的那张不假装有图）+ 1 份清单 CSV",
      pngCount(zip) === 2 && zip.files.some((f) => /\.csv$/i.test(f.name)),
      zip.files.map((f) => f.name).join(" | "));
    ok("文件名带序号 / 站点 / 期次 / 类目 / 位次标签",
      zip.files.some((f) => /^01_美国_2026W41_卫衣_上升 1 位\.png$/.test(f.name)),
      zip.files.map((f) => f.name).join(" | "));
    const csv = csvOf(zip);
    ok("清单里如实写下「未导出：取不到图片像素」那一行", /未导出/.test(csv), csv.slice(0, 200));
    ok("清单里保留了原图地址", csv.indexOf(U("A")) >= 0, csv.slice(0, 200));
    ok("触发了下载，文件名带范围与日期",
      rec.clicks.length === 1 && /趋势上升榜_.*\.zip$/.test(rec.clicks[0].download), rec.clicks.length ? rec.clicks[0].download : "no-click");

    /* 画布：原图分辨率（1000×1500，未超上限）→ 高度要多出一条标签栏 */
    const cvs = rec.canvases.filter((c) => c.h > 1500);
    ok("画布高度 = 原图 1500 + 底部标签栏", cvs.length === 2 && cvs.every((c) => c.h > 1500 && c.w === 1000), JSON.stringify(rec.canvases));
    ok("图片按原图分辨率贴进画布（1000×1500，没有缩小）",
      rec.imgs.length === 2 && rec.imgs.every((d) => d.dw === 1000 && d.dh === 1500), JSON.stringify(rec.imgs));
    ok("标签栏是深色横条（先铺白底，再铺深色条）",
      rec.rects.some((x) => x.fill === "#ffffff") && rec.rects.some((x) => String(x.fill).indexOf("17,17,17") >= 0),
      rec.rects.map((x) => x.fill).join(" / "));
    ok("标签栏里写了「站点 · 期次 · 类目」", rec.texts.some((t) => t.t === "美国 · 2026W41 · 卫衣"),
      rec.texts.map((t) => t.t).join(" | "));
    ok("标签栏里也写了位次标签（上升 1 位 / 下降 1 位）",
      rec.texts.some((t) => t.t === "上升 1 位") && rec.texts.some((t) => t.t === "下降 1 位"),
      rec.texts.map((t) => t.t).join(" | "));
    ok("位次标签带金色徽章底（不是裸文字）",
      rec.rects.some((x) => String(x.fill).toLowerCase() === "#d4a017"), rec.rects.map((x) => x.fill).join(" / "));
    ok("位次标签用加粗字（与说明文字区分）",
      rec.texts.filter((t) => t.t === "上升 1 位").every((t) => /bold/i.test(t.font)),
      rec.texts.map((t) => t.font).join(" | "));
  }

  console.log("\n[8] 导出实现：图片过多时只导前 N 张并如实说明");
  {
    const { rec, RK } = makeExportEnv();
    RK._.cfg.isSuper = () => true;
    RK._.IMG_EXP.maxN = 3;                    /* 把上限压到 3 便于验证 */
    const items = [];
    for (let i = 0; i < 7; i++) items.push({ url: "https://img.newtrend.top/n" + i + ".jpg", label: "", site: "美国", period: "2026W41", cat: "卫衣" });
    const r = await RK.exportImages({ items: items, scope: "x" });
    ok("仍然返回成功", r === true, String(r));
    ok("只导出前 3 张（+1 份清单）", pngCount(rec.zips[0]) === 3, String(pngCount(rec.zips[0])));
    RK._.IMG_EXP.maxN = 300;
  }

  console.log("\n[9] 导出实现：空清单 / 全站外地址 → 不产出空压缩包糊弄人");
  {
    const { rec, RK } = makeExportEnv();
    RK._.cfg.isSuper = () => true;
    const r1 = await RK.exportImages({ items: [], scope: "x" });
    ok("空清单 → 返回 false 且不产出压缩包", r1 === false && rec.zips.length === 0, String(r1) + "/" + rec.zips.length);
    const r2 = await RK.exportImages({ items: [{ url: "data:image/png;base64,xxx" }], scope: "x" });
    ok("非 http(s) 地址被过滤掉 → 同样不产出压缩包", r2 === false && rec.zips.length === 0, String(r2) + "/" + rec.zips.length);
  }

  console.log("\n== 结果：" + pass + " 通过 / " + fail + " 失败 ==");
  if (fail) { console.log("\n失败项："); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
})();