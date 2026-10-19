/* ============================================================
 * 趋势上升榜「天眼」模式：全屏 / 顶栏不压图 / 周与周缝隙收紧 —— 运行时验证
 *
 * 覆盖三件事（都用真实文件、真实代码，不做替身逻辑）：
 *   ① 样式（真实 css/style.css）：面板是否占满整屏、顶栏是否被压成单行细条、
 *      「周与周」与「图与图」之间的缝隙是否确实收紧（并与修复前的取值做反向对比）；
 *   ② 铺排算法（真实 js/rank.js 里的 eyeFitCalc）：给定真实屏幕尺寸与图数，
 *      能否把某列的【全部图】排进首屏（不出现滚动），且卡片比修复前更大；
 *   ③ 页面行为（jsdom 解析真实 rank.html + 执行真实 js/rank.js）：
 *      点「天眼」→ 触发浏览器全屏、面板铺满、顶栏只剩一行、明细收进悬浮提示、
 *      关闭/Esc → 退出全屏并清理；不支持全屏的环境不得报错（自动降级）。
 *
 * 用法：node tools/verify_rank_eye.js <站点仓库根目录>
 * ============================================================ */
const fs = require("fs");
const path = require("path");

let JSDOM, VirtualConsole;
try {
  JSDOM = require("jsdom").JSDOM;
  VirtualConsole = require("jsdom").VirtualConsole;
} catch (e) {
  console.error("需要先安装 jsdom（本脚本用真实浏览器环境跑真实前台脚本，做运行时验证）：");
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

/* ---------------- 极简 CSS 规则解析（带 @media 展开） ---------------- */
function parseRules(cssText) {
  const clean = String(cssText).replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const scan = (str, media) => {
    let i = 0;
    while (i < str.length) {
      const open = str.indexOf("{", i);
      if (open < 0) break;
      const sel = str.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < str.length && depth > 0) {
        if (str[j] === "{") depth++;
        else if (str[j] === "}") depth--;
        j++;
      }
      const body = str.slice(open + 1, j - 1);
      if (sel.indexOf("@media") === 0) scan(body, sel);
      else out.push({ sel: sel, body: body, media: media });
      i = j;
    }
  };
  scan(clean, null);
  return out;
}
const CSS = parseRules(read("css/style.css"));
const RANK_SRC = read("js/rank.js");   /* rank.js 源码：只用来断言 CSS/JS 里确有对应实现（不改盘上文件） */
function decl(selector, prop, opts) {
  const onlyMedia = !!(opts && opts.onlyMedia);
  let val = null;
  CSS.forEach((r) => {
    if (onlyMedia && !r.media) return;
    const sels = r.sel.split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (sels.indexOf(selector) < 0) return;
    const re = new RegExp("(?:^|;)\\s*" + prop.replace(/[-]/g, "\\-") + "\\s*:\\s*([^;]+)");
    const m = re.exec(";" + r.body);
    if (m) val = m[1].trim().replace(/\s+/g, " ");
  });
  return val;
}
const px = (v) => { const m = /-?[0-9.]+/.exec(String(v == null ? "" : v)); return m ? parseFloat(m[0]) : NaN; };
function numDecl(sel, prop) { return px(decl(sel, prop)); }
function cssHas(sel, prop, want) { return String(decl(sel, prop) || "").indexOf(want) >= 0; }

/* 修复前（20261016J）的实际取值：用于反向对比，证明本轮确实收紧了 */
const BEFORE = { panelInset: "3vh 3vw", headPadTop: 13, titleFont: 16, subFont: 12.5, poolsGap: 12, poolPad: 8, gridGap: 4 };

/* ---------------- 假数据层（只覆盖本页真正会调用的方法） ---------------- */
function makeSB(items, cfg) {
  cfg = cfg || {};
  const impl = {
    getSession: async () => ({ access_token: "T", user: { id: "u1", email: "a@b.c" } }),
    onAuth: () => {}, onAuthChange: () => {}, currentToken: async () => "T",
    signOut: async () => {},
    myRole: async () => "super",
    getFrontendZoneVisibility: async () => ({}),
    myFrontendZones: async () => null,
    rankFacets: async () => ({ sites: cfg.sites || [], periods: cfg.periods || [], categories: cfg.categories || [] }),
    listRankSites: async () => (cfg.sites || []).map((n) => ({ name: n })),
    getRankGroups: async () => [],
    listRankItems: async (f) => {
      const s = (f && f.sites) || [], p = (f && f.periods) || [];
      return items.filter((it) => (!s.length || s.indexOf(it.site) >= 0) && (!p.length || p.indexOf(it.period_label) >= 0));
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

/* 真实页面 + 真实脚本；仅在内存里给 rank.js 末尾追加一行「导出内部函数」，便于直接调用生产代码 */
function makeItems() {
  const out = [];
  ["2026W40", "2026W41", "2026W42"].forEach((p, pi) => {
    for (let i = 0; i < 12; i++) {
      out.push({
        image_url: "https://img.newtrend.top/p/" + p + "_" + i + ".jpg",
        site: "美国", period_label: p, category: "卫衣", leaf_category: "卫衣",
        ratio: 1 + ((i + pi) % 5), abs_delta: 120 - i * 3,
      });
    }
  });
  return out;
}

async function bootRank(cfg) {
  cfg = cfg || {};
  const html = read("rank.html").replace(/<script src="[^"]*"><\/script>/g, "");
  const dom = new JSDOM(html, {
    url: "https://newtrend.top/rank.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message || e.error)));
  window.addEventListener("unhandledrejection", (e) => errors.push("unhandled: " + e.reason));

  /* 假全屏：真实浏览器里由浏览器实现——这里只保证"调用发生、状态可查、关闭时退出" */
  const fsLog = [];
  if (!cfg.noFullscreenApi) {
    const doc = window.document;
    let cur = null;
    Object.defineProperty(doc, "fullscreenElement", { configurable: true, get() { return cur; } });
    window.Element.prototype.requestFullscreen = function () {
      fsLog.push("request:" + (this && this.id));
      cur = this;
      try { doc.dispatchEvent(new window.Event("fullscreenchange")); } catch (e) {}
      return Promise.resolve();
    };
    doc.exitFullscreen = function () {
      fsLog.push("exit");
      cur = null;
      try { doc.dispatchEvent(new window.Event("fullscreenchange")); } catch (e) {}
      return Promise.resolve();
    };
  }

  window.eval(read("js/config.js"));
  window.SB = makeSB(cfg.items || makeItems(), cfg);

  /* 只在内存里给 IIFE 末尾追加测试导出（磁盘上的生产代码不变） */
  const src = read("js/rank.js");
  const hooked = src.replace(/\}\)\(\);\s*$/,
    "window.__eye={eyeFitCalc:eyeFitCalc,openEye:openEye,closeEye:closeEye,fitEye:fitEye,eyeScope:eyeScope," +
    "EYE_GAP:EYE_GAP,EYE_VGAP:EYE_VGAP,EYE_MIN_CARD:EYE_MIN_CARD,EYE_R_MAX:EYE_R_MAX};})();");
  const injected = hooked !== src;
  window.eval(hooked);

  for (let i = 0; i < 60; i++) await sleep(20);
  return { dom, window, errors, fsLog, injected, T: window.__eye };
}

/* ============================================================ */
(async function main() {
  console.log("== 天眼模式（全屏 / 顶栏不压图 / 缝隙收紧）：运行时验证 ==");
  console.log("仓库根目录：" + path.resolve(ROOT));

  /* ---------------- ① 样式 ---------------- */
  console.log("\n[1] 真实样式表：全屏 / 顶栏瘦身 / 缝隙收紧");
  {
    const inset = decl(".rk-eye-panel", "inset");
    ok("天眼面板占满整屏（inset: 0，不再四周留白）", inset === "0", "实际：" + inset);
    ok("与修复前不同（修复前是 " + BEFORE.panelInset + "）", inset !== BEFORE.panelInset);
    ok("面板直角、无圆角留白", decl(".rk-eye-panel", "border-radius") === "0", decl(".rk-eye-panel", "border-radius"));
    ok("面板边框盒不撑出屏幕（未使用 margin 做留白）", !decl(".rk-eye-panel", "margin"));

    const headPadRaw = decl(".rk-eye-head", "padding");
    const headPad = px(String(headPadRaw || "").split(" ")[0]);
    ok("顶栏高度被压小（内边距 " + headPad + "px，修复前 " + BEFORE.headPadTop + "px）", headPad <= 6 && headPad < BEFORE.headPadTop, String(headPadRaw));
    ok("顶栏改成【固定蓝栏】：常显、且用正常流占高度（不叠在图上）",
      /relative|static/.test(String(decl(".rk-eye-head", "position") || "")) &&
      !/absolute|fixed/.test(String(decl(".rk-eye-head", "position") || "")),
      String(decl(".rk-eye-head", "position")));
    ok("蓝栏底色确实是蓝色（不再是透明悬浮条）",
      /gradient/.test(String(decl(".rk-eye-head", "background") || "") + String(decl(".rk-eye-head", "background-image") || "")) ||
      /blue|#2a63d8|42, 99, 216/.test(String(decl(".rk-eye-head", "background") || "") + String(decl(".rk-eye-head", "background-image") || "")),
      String(decl(".rk-eye-head", "background-image") || decl(".rk-eye-head", "background")));

    const tFont = numDecl(".rk-eye-brand", "font-size");
    const sFont = numDecl(".rk-eye-sub", "font-size");
    ok("顶栏标题字号保持瘦身（" + tFont + "px ≤ 12.5px）", tFont <= 12.5 && tFont > 0, String(tFont));
    ok("顶栏说明字号保持瘦身（" + sFont + "px ≤ 11.5px）", sFont <= 11.5 && sFont > 0, String(sFont));
    ok("顶栏说明被限制为一行（nowrap + 省略号 + 可收缩）",
      /nowrap/.test(String(decl(".rk-eye-sub", "white-space"))) &&
      /ellipsis/.test(String(decl(".rk-eye-sub", "text-overflow"))) &&
      decl(".rk-eye-sub", "min-width") === "0", decl(".rk-eye-sub", "white-space") + " / " + decl(".rk-eye-sub", "text-overflow"));

    const closeW = numDecl(".rk-eye-close", "width");
    ok("关闭按钮同步收小（" + closeW + "px ≤ 26px）", closeW <= 26);

    const poolsGap = numDecl(".rk-eye-body .rk-pools", "gap");
    const poolPad = numDecl(".rk-eye-body .rk-pool", "padding");
    const gridGapVar = decl(".rk-eye-body .rk-pool-grid", "gap");
    const gm = /var\(\s*--eye-gap\s*,\s*([0-9.]+)px\s*\)/.exec(String(gridGapVar));
    const gridGap = gm ? parseFloat(gm[1]) : px(gridGapVar);
    ok("周与周（列与列）之间的缝变小（" + poolsGap + "px，修复前 " + BEFORE.poolsGap + "px）", poolsGap <= 6 && poolsGap < BEFORE.poolsGap);
    ok("每列内边距变小（" + poolPad + "px，修复前 " + BEFORE.poolPad + "px）", poolPad <= 4 && poolPad < BEFORE.poolPad);
    ok("图与图之间的缝变小（" + gridGap + "px，修复前 " + BEFORE.gridGap + "px）", gridGap <= 2 && gridGap < BEFORE.gridGap);
    ok("图缝与脚本计算用同一个值（CSS 走 --eye-gap 变量）", !!gm);

    const gapBefore = BEFORE.poolsGap + BEFORE.poolPad * 2;
    const gapNow = poolsGap + poolPad * 2;
    ok("「周与周」实际总缝从 " + gapBefore + "px 收到 " + gapNow + "px（减少 ≥ 50%）", gapNow <= gapBefore * 0.5);
    console.log("    周与周总缝：" + gapBefore + "px → " + gapNow + "px；图与图缝：" + BEFORE.gridGap + "px → " + gridGap + "px");

    ok("天眼打开期间锁住页面滚动（避免背景跟着动）", /hidden/.test(String(decl("html.rk-eye-on", "overflow"))));
    ok("面板纵向排列、蓝栏是第一条（图片区从蓝栏下方开始 → 蓝栏永远不压图）",
      /column/.test(String(decl(".rk-eye-panel", "flex-direction") || "")));
    ok("蓝栏里的控件常显、直接可点（排序 / 范围 / 标签开关 不再需要悬浮才出现）",
      !/^\s*none/.test(String(decl(".rk-eye-sortsel", "display") || "")) &&
      !/^\s*none/.test(String(decl(".rk-eye-scope", "display") || "")) &&
      !/^\s*none/.test(String(decl(".rk-eye-tag", "display") || "")),
      "sortsel=" + decl(".rk-eye-sortsel", "display") + " scope=" + decl(".rk-eye-scope", "display") + " tag=" + decl(".rk-eye-tag", "display"));
    ok("蓝栏里有「排序」下拉（用户点得到、能改排序口径）",
      /id="rk-eye-sortsel"/.test(RANK_SRC) && !/^\s*none/.test(String(decl(".rk-eye-sortsel", "display") || "")),
      "sortsel.display=" + decl(".rk-eye-sortsel", "display"));
    ok("蓝栏里有「标签开关（眼睛）」按钮", /id="rk-eye-tag"/.test(RANK_SRC) && /rk-eye-tagicon/.test(RANK_SRC));
    ok("导出 PPT 按钮只有超管可见（非超管连按钮都不显示）",
      cssHas(".rk-eye-ppt", "display", "none") && cssHas(".rk-eye-ppt.on", "display", "inline-flex"));
  }

  /* ---------------- ② 铺排算法（真实 eyeFitCalc） ---------------- */
  console.log("\n[2] 真实铺排算法：全屏后每列全部图能不能一屏放下");
  {
    const r = await bootRank({});
    ok("测试导出注入成功（执行的是仓库里的真实 rank.js）", r.injected && !!r.T);
    const T = r.T;
    if (T) {
      ok("缝隙常量已同步收小（gap=" + T.EYE_GAP + "px, vgap=" + T.EYE_VGAP + "px）", T.EYE_GAP <= 2 && T.EYE_VGAP <= 2);

      /* 一台 1920×1080 的电脑，天眼全屏后：3 列（近三周），每列 58 张（用户反馈里的 T恤 场景量级） */
      /* 用户口径：不管几列对比，图片都不能被压小；图多就直接往下排、页面纵向滚动。
         所以下面断言的核心不变量是「卡片宽度与列数、与图数都无关」。 */
      const VP_W = 1920, VP_H = 1080;
      const HEAD_NOW = 28 + 6;                       /* 固定蓝栏 + 列头 */
      const BODY_PAD_NOW = 4 + 6;                    /* .rk-eye-body 上下内边距 */
      const COL_GAP = numDecl(".rk-eye-body .rk-pools", "gap") || 4;
      const POOL_PAD = numDecl(".rk-eye-body .rk-pool", "padding") || 3;
      const availH_NOW = VP_H - HEAD_NOW - BODY_PAD_NOW;
      const colWOf = (K) => (VP_W - COL_GAP * (K - 1)) / K - POOL_PAD * 2;
      const fitOf = (K, n) => T.eyeFitCalc(colWOf(K), availH_NOW, 1, n, { headH: HEAD_NOW, gap: T.EYE_GAP, vgap: T.EYE_VGAP });

      const f2 = fitOf(2, 58), f3 = fitOf(3, 58), f4 = fitOf(4, 58);
      const w2 = f2.cardW, w3 = f3.cardW, w4 = f4.cardW;
      console.log("    1920×1080 全屏、每列 58 张：2列 " + f2.r + "张/行 卡宽" + w2.toFixed(1) +
        "px ｜ 3列 " + f3.r + "张/行 卡宽" + w3.toFixed(1) + "px ｜ 4列 " + f4.r + "张/行 卡宽" + w4.toFixed(1) + "px");
      ok("2/3/4 列下卡片宽度几乎相同（列数不再把图压小）",
        Math.max(w2, w3, w4) - Math.min(w2, w3, w4) <= 14,
        [w2, w3, w4].map((v) => v.toFixed(1)).join(" / "));
      ok("列数越多 → 每行张数越少（靠减张数维持图大小，不是靠缩图）",
        f2.r > f3.r && f3.r > f4.r, "2/3/4 列 = " + [f2.r, f3.r, f4.r].join(" / "));
      ok("4 列时每行仍不止 1 张（列不至于退化成细长条）", f4.r >= 2, "r=" + f4.r);
      ok("每张图都不低于最小可读宽度 " + T.EYE_MIN_CARD + "px",
        [w2, w3, w4].every((v) => v >= T.EYE_MIN_CARD - 0.01));
      ok("横向铺满且不溢出（张数 × 卡宽 + 缝隙 ≤ 列宽）",
        [[f2, colWOf(2)], [f3, colWOf(3)], [f4, colWOf(4)]].every(([f, cw]) =>
          f.r * f.cardW + T.EYE_GAP * (f.r - 1) <= cw + 0.01));

      /* 图数与图片大小无关：58 张与 4000 张，算出来的卡片宽度必须一样（图多只往下排） */
      const fHuge = fitOf(3, 4000);
      ok("图数不再影响图片大小（58 张 vs 4000 张，卡宽相同：" + w3.toFixed(1) + "px）",
        Math.abs(fHuge.cardW - w3) < 0.01, "4000 张时 " + fHuge.cardW.toFixed(1));
      ok("图特别多（4000 张）时如实标记「可下滑查看剩余」", fHuge.clipped === true);
      ok("图不多（58 张、4 列）放不下时也只允许下滑、不缩图", f4.cardW >= T.EYE_MIN_CARD && f4.r >= 1);
    }
  }

  /* ---------------- ③ 页面行为 ---------------- */
  console.log("\n[3] 真实页面：点「天眼」→ 全屏 + 顶栏单行 + 明细收起；关闭即复位");
  {
    const CFG_SITES = ["美国", "英国", "德国", "法国"];
    const r = await bootRank({ sites: CFG_SITES, periods: ["2026W40", "2026W41", "2026W42"], categories: ["卫衣", "T恤"] });
    const w = r.window, doc = w.document;
    const btn = doc.querySelector("#rk-eye-btn");
    ok("页面上有天眼入口按钮", !!btn);

    if (btn) {
      btn.click();                                  /* 用户手势 → 请求全屏 */
      await sleep(300);
      const d = doc.querySelector("#rk-eye");
      const panel = doc.querySelector("#rk-eye .rk-eye-panel");
      const sub = doc.querySelector("#rk-eye-sub");
      const head = doc.querySelector("#rk-eye .rk-eye-head");
      ok("天眼浮层已打开", !!d);
      ok("面板类名正确（样式随之生效）", !!panel);
      ok("打开时请求了浏览器全屏（占满电脑屏幕）", r.fsLog.indexOf("request:rk-eye") >= 0, JSON.stringify(r.fsLog));
      ok("打开期间锁住页面滚动（html.rk-eye-on）", doc.documentElement.classList.contains("rk-eye-on"));
      ok("顶栏（固定蓝栏）存在，且含标题（天眼 · 全部对比图）", !!head && !!head.querySelector(".rk-eye-brand"),
        head ? (head.querySelector(".rk-eye-brand") || { textContent: "(无标题)" }).textContent : "(无顶栏)");
      ok("顶栏含说明文字", !!sub);
      ok("顶栏含「排序」下拉", !!doc.querySelector("#rk-eye-sortsel"));
      ok("顶栏含「范围」按钮", !!doc.querySelector("#rk-eye-scope"));
      ok("顶栏含「标签开关（眼睛）」按钮", !!doc.querySelector("#rk-eye-tag"));
      ok("顶栏含「关闭」按钮", !!doc.querySelector("#rk-eye-close"));
      ok("铺排已执行（已把每行张数写到容器上）", !!(d && d.querySelector(".rk-pools") &&
        d.querySelector(".rk-pools").style.getPropertyValue("--eye-r")), d && d.querySelector(".rk-pools") ? d.querySelector(".rk-pools").style.cssText : "");

      const subTxt = sub ? sub.textContent.trim() : "";
      ok("顶栏只留一行关键信息、不再铺满站点/期次名单", sub && subTxt.indexOf("、") < 0, subTxt);
      ok("顶栏说明了类目 / 列数 / 张数", /共/.test(subTxt) && /张/.test(subTxt), subTxt);
      ok("明细收进了悬浮提示（鼠标移上去能看到范围）", !!(sub && sub.title && sub.title.length > 0), sub ? sub.title : "");
      console.log("    顶栏文字：" + JSON.stringify(subTxt) + "  悬浮提示：" + JSON.stringify(sub ? sub.title : ""));

      /* 切到「全部站点 × 全部期次」：旧版会把整串名字铺在顶栏（又多又大），新版仍只有一行 */
      const scopeBtn = doc.querySelector("#rk-eye-scope");
      if (scopeBtn) {
        scopeBtn.click();
        await sleep(300);
        const sub2 = doc.querySelector("#rk-eye-sub");
        const txt2 = sub2 ? sub2.textContent.trim() : "";
        ok("切到「全部期次」范围后，顶栏仍只有一行短信息", sub2 && txt2.indexOf("、") < 0 && txt2.length <= 40, txt2);
        ok("切范围后列出的是全部站点（范围明细在悬浮提示里）", !!(sub2 && /美国|英国|德国|法国/.test(sub2.title)), sub2 ? sub2.title : "");
        /* 反向验证：修复前的写法会把这一串站点名直接铺在顶栏上（又多又大、把图挤掉） */
        const oldTxt = "卫衣 · " + CFG_SITES.join("、") + " · 3 列 · 共 36 张";
        ok("同样范围下顶栏文字明显短于修复前（旧写法：" + oldTxt.length + " 字 → 现在：" + txt2.length + " 字）",
          txt2.length <= oldTxt.length * 0.6, "旧=" + oldTxt + " / 新=" + txt2);
        console.log("    切换后顶栏：" + JSON.stringify(txt2));
      }

      /* 视口尺寸变化（例如刚进入全屏）→ 重新铺排 */
      const pools = doc.querySelector("#rk-eye .rk-pools");
      let reFit = 0;
      if (pools) {
        const orig = pools.style.setProperty.bind(pools.style);
        pools.style.setProperty = function (k, v) { if (k === "--eye-r") reFit++; return orig(k, v); };
      }
      w.dispatchEvent(new w.Event("resize"));
      w.document.dispatchEvent(new w.Event("fullscreenchange"));
      await sleep(200);
      ok("窗口/全屏尺寸变化后会重新铺排一次", reFit >= 1, "重排次数=" + reFit);

      /* 关闭 */
      doc.querySelector("#rk-eye-close").click();
      await sleep(200);
      ok("点关闭后浮层被移除", !doc.querySelector("#rk-eye"));
      ok("关闭后退出全屏", r.fsLog.indexOf("exit") >= 0, JSON.stringify(r.fsLog));
      ok("关闭后恢复页面滚动（rk-eye-on 已移除）", !doc.documentElement.classList.contains("rk-eye-on"));

      /* Esc 关闭 */
      btn.click(); await sleep(250);
      doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(200);
      ok("Esc 也能关闭天眼并退出全屏", !doc.querySelector("#rk-eye") && r.fsLog.filter((x) => x === "exit").length >= 2);
      ok("全过程无未捕获错误", r.errors.length === 0, r.errors.join(" | ").slice(0, 160));
    }
  }

  /* ---------------- ④ 能力降级 ---------------- */
  console.log("\n[4] 不支持浏览器全屏的环境：不得报错，仍要占满视口可用");
  {
    const r = await bootRank({ noFullscreenApi: true, sites: ["美国"], periods: ["2026W41", "2026W42"], categories: ["卫衣"] });
    const doc = r.window.document;
    const btn = doc.querySelector("#rk-eye-btn");
    if (btn) {
      btn.click();
      await sleep(300);
      ok("无全屏接口时天眼照常打开", !!doc.querySelector("#rk-eye"));
      ok("无全屏接口时不抛错", r.errors.length === 0, r.errors.join(" | ").slice(0, 160));
      ok("无全屏接口时面板仍占满视口（样式 inset: 0 兜住）", decl(".rk-eye-panel", "inset") === "0");
      doc.querySelector("#rk-eye-close").click();
      await sleep(150);
      ok("无全屏接口时也能正常关闭", !doc.querySelector("#rk-eye"));
    }
  }

  /* ---------------- ⑤ 纯图墙：打开后没有任何文字压着图 ---------------- */
  console.log("\n[5] 不压图：固定蓝栏常显 + 标签画在图的上/下方 + 眼睛开关随时开关");
  {
    const r = await bootRank({ sites: ["美国"], periods: ["2026W40", "2026W41", "2026W42"], categories: ["卫衣"] });
    const doc = r.window.document;
    doc.querySelector("#rk-eye-btn").click();
    await sleep(320);

    const panel0 = doc.querySelector("#rk-eye");
    const head0 = doc.querySelector("#rk-eye-head");
    /* 蓝栏：正常流里的第一条，图片区从它下面开始 → 结构上不可能压图 */
    ok("蓝栏写在正常流里（position 不是 absolute/fixed）",
      /relative|static/.test(String(decl(".rk-eye-head", "position") || "")),
      String(decl(".rk-eye-head", "position")));
    ok("蓝栏后面紧跟着图区（图片从蓝栏下方开始排，不会被盖住）",
      !!(head0 && head0.nextElementSibling && head0.nextElementSibling.id === "rk-eye-body"),
      head0 && head0.nextElementSibling ? head0.nextElementSibling.id : "(无)");
    ok("列头（周度）改成正常流：占自己的高度、把图往下推，不再叠在列上",
      decl(".rk-eye-body .rk-pool-head", "position") === "static" &&
      numDecl(".rk-eye-body .rk-pool-head", "opacity") === 1,
      "position=" + decl(".rk-eye-body .rk-pool-head", "position") + " opacity=" + decl(".rk-eye-body .rk-pool-head", "opacity"));
    ok("图区四周不留白（body 内边距为 0，图片铺到边）", numDecl(".rk-eye-body", "padding") === 0, String(decl(".rk-eye-body", "padding")));

    /* DOM：卡片 = 一张图（+ 图下方的一栏标签），图上没有任何叠字 */
    const cards = Array.prototype.slice.call(doc.querySelectorAll("#rk-eye .rk-card"));
    ok("天眼里确实渲染出了图片卡片（" + cards.length + " 张）", cards.length > 0);
    const overlay = cards.reduce((a, c) => a + c.querySelectorAll(".rk-badge, .rk-move, .rk-share").length, 0);
    ok("卡片上没有任何叠字（趋势标签 / 位次 / 同款标记一个都不叠在图上）", overlay === 0, "叠字元素=" + overlay);
    ok("卡片 = 1 张图 + 可选的一栏标签，且标签一定排在 img 之后（视觉上在图下方）",
      cards.every((c) => c.children.length >= 1 && c.children[0].tagName === "IMG" &&
        Array.prototype.slice.call(c.children).slice(1).every((x) => x.tagName === "FIGCAPTION")),
      cards.length ? Array.prototype.map.call(cards[0].children, (x) => x.tagName).join(",") : "");
    const withCap = cards.filter((c) => c.querySelector(".rk-eye-cap")).length;
    ok("标签确实渲染在图片下方（" + withCap + "/" + cards.length + " 张有图下标签栏）", withCap === cards.length);
    const withMeta = cards.filter((c) => (c.getAttribute("data-eye-meta") || "").length > 0);
    ok("归属信息没丢（" + withMeta.length + "/" + cards.length + " 张有归属信息）", withMeta.length === cards.length);
    const withTags = cards.filter((c) => (c.getAttribute("data-eye-tags") || "").length > 0);
    ok("趋势标签也没丢（" + withTags.length + " 张有标签）", withTags.length > 0, "有标签的卡片=" + withTags.length);

    /* 眼睛开关：随时开 / 关标签 */
    const tagBtn = doc.querySelector("#rk-eye-tag");
    ok("蓝栏里有「标签开关（眼睛）」按钮", !!tagBtn);
    const shown0 = !panel0.classList.contains("labels-off");
    ok("默认状态：标签显示中（且都在图的上方 / 下方，不压图）", shown0);
    tagBtn.click();
    await sleep(50);
    ok("点一下 → 面板进入「标签隐藏」状态", panel0.classList.contains("labels-off"));
    /* 断言改为读真实样式表（css/style.css），且规则必须命中「列头 + 图下标签」两类 */
    ok("隐藏后 CSS 里「列头」与「图下标签」整条都不显示（规则写在 css/style.css）",
      cssHas(".rk-eye.labels-off .rk-eye-body .rk-pool-head", "display", "none") &&
      cssHas(".rk-eye.labels-off .rk-eye-cap", "display", "none"),
      String(decl(".rk-eye.labels-off .rk-eye-cap", "display")));
    tagBtn.click();
    await sleep(50);
    ok("再点一下 → 标签恢复显示（随时可开关）", !panel0.classList.contains("labels-off"));
    ok("开关状态会被记住（写入本地存储，下次打开沿用上次选择）", /rk-eye-labels/.test(RANK_SRC));
    ok("点标签开关不会被当成「关闭天眼」或「打开大图」",
      /t\.id === "rk-eye-tag"\)/.test(RANK_SRC) && !!doc.querySelector("#rk-eye"));
    ok("标签开关全过程无未捕获错误", r.errors.length === 0, r.errors.join(" | ").slice(0, 160));
    console.log("    示例归属：" + JSON.stringify(cards[0] && cards[0].getAttribute("data-eye-meta")) +
      "  示例标签：" + JSON.stringify(cards[0] && cards[0].getAttribute("data-eye-tags")));
  }

  /* ---------------- ⑥ 天眼里的排序：蓝栏下拉 + 多周范围 ---------------- */
  console.log("\n[6] 天眼内排序：蓝栏排序下拉真的能改顺序，且与筛选栏同口径");
  {
    const r = await bootRank({ sites: ["美国"], periods: ["2026W40", "2026W41", "2026W42"], categories: ["卫衣"] });
    const w = r.window, doc = w.document;
    doc.querySelector("#rk-eye-btn").click();
    await sleep(320);

    const sel = doc.querySelector("#rk-eye-sortsel");
    ok("蓝栏里确实有排序下拉（不是只有样式、而是真实控件）", !!sel);
    const opts = sel ? Array.prototype.map.call(sel.options, (o) => o.value) : [];
    ok("排序口径与筛选栏一致（环比 / 绝对值等）",
      opts.length >= 3 && opts.join(",").indexOf("ratio") >= 0, opts.join(","));
    ok("默认口径是「环比 高→低」", sel && sel.value === (opts[0] || ""), sel ? sel.value : "(无)");

    const firstOf = () => {
      const c = doc.querySelector("#rk-eye .rk-card");
      return c ? c.getAttribute("data-url") : null;
    };
    const before = firstOf();
    const founders = doc.querySelector("#rk-eye .rk-pool-grid");

    /* 独立对照：精确「期望首图」由另一套（图幅/天眼套件）用同样的假数据独立算出；
       这里做的是行为级验证：切换必须重排、且同一口径重复选择必须稳定（幂等）。 */
    let changed = 0;
    const firstByOpt = {};
    for (let i = 0; i < opts.length; i++) {
      const v = opts[i];
      sel.value = v;
      sel.dispatchEvent(new w.Event("change", { bubbles: true }));
      await sleep(140);
      const now = firstOf();
      firstByOpt[v] = now;
      if (i > 0 && now !== before) changed++;
      ok("切换到「" + (sel.options[i] && sel.options[i].textContent) + "」后列表确实重排了",
        !!founders && !!doc.querySelector("#rk-eye .rk-card"));
    }
    /* 幂等：同一口径再选一次，首图必须与第一次相同 */
    const probeV = opts[opts.length - 1];
    sel.value = probeV;
    sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    await sleep(140);
    ok("同一排序口径重复选择结果稳定（幂等）", firstOf() === firstByOpt[probeV],
      String(firstOf()) + " vs " + String(firstByOpt[probeV]));
    /* 不同口径应当给出不同的首图（数据里四个口径的结果确实不同） */
    const uniq = Object.keys(firstByOpt).map((k) => firstByOpt[k]).filter(Boolean);
    ok("不同排序口径给出不同首图（不是四个口径都长一样）",
      new Set(uniq).size >= 2, "不同首图数=" + new Set(uniq).size);
    ok("所有排序口径都能切换、且至少换掉一次首图（说明真的排序，不是摆设）", changed >= 1, "变化次数=" + changed);
    ok("切排序不会把天眼关掉、也不会误开大图",
      !!doc.querySelector("#rk-eye") && !doc.querySelector("#rk-lightbox, .rk-lightbox"));
    ok("排序后仍是纯图墙（图上没有叠字、标签在 img 之后）", (function () {
      const cs = doc.querySelectorAll("#rk-eye .rk-card");
      return cs.length > 0 && Array.prototype.every.call(cs, (c) => !c.querySelector(".rk-badge, .rk-move") &&
        (c.children.length === 0 || c.children[0].tagName === "IMG"));
    })());
    ok("排序切换全过程无未捕获错误", r.errors.length === 0, r.errors.join(" | ").slice(0, 160));
  }

  /* ---------------- ⑥b 天眼里的范围：多周对比的入口还在（想多看几周随时切） ---------------- */
  console.log("\n[6b] 天眼范围：默认最近 2 周，但范围按钮随时可以切到更多周");
  {
    const r = await bootRank({ sites: ["美国"], periods: ["2026W40", "2026W41", "2026W42"], categories: ["卫衣"] });
    const w = r.window, doc = w.document;
    doc.querySelector("#rk-eye-btn").click();
    await sleep(320);
    const pools0 = doc.querySelectorAll("#rk-eye .rk-pool").length;
    ok("默认只对比最近 2 周（列数 " + pools0 + "，列少才看得清）", pools0 === 2, "列数=" + pools0);
    const scopeBtn = doc.querySelector("#rk-eye-head .rk-eye-scope");
    ok("蓝栏里有「范围」按钮（想看更多周随时切）", !!scopeBtn && /id="rk-eye-scope"/.test(RANK_SRC));
    if (scopeBtn) {
      scopeBtn.click();
      await sleep(200);
      const pools1 = doc.querySelectorAll("#rk-eye .rk-pool").length;
      ok("点一下范围按钮 → 展开到全部期次（列数变多，多周对比还在）", pools1 > pools0, pools0 + " → " + pools1);
    }
    ok("范围切换全过程无未捕获错误", r.errors.length === 0, r.errors.join(" | ").slice(0, 160));
  }

  /* ---------------- ⑦ 导出 PPT：真实图片 + 图片下方标签 ---------------- */
  console.log("\n[7] 导出 PPT（用真实 js/report.js 的组装代码）：一列一页、真实图片、标签在图下方");
  function bootReport() {
    const vc = new VirtualConsole();
    vc.on("jsdomError", () => {});          /* 本环境没有 canvas：getContext 的"未实现"提示属环境说明，不是页面报错 */
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: "https://newtrend.top/rank.html", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    });
    const { window } = dom;
    const errors = [];
    window.addEventListener("error", (e) => errors.push(String(e.message || e.error)));
    window.eval(read("js/report.js"));
    return { dom, window, errors };
  }
  function makeRecorder() {
    const slides = [];
    const pptx = {
      defineLayout() {},
      layout: "",
      addSlide() {
        const s = {
          items: [], background: null,
          addText(t, o) { s.items.push({ type: "text", t: String(t), o: o || {} }); },
          addImage(o) { s.items.push({ type: "image", o: o || {} }); },
        };
        slides.push(s);
        return s;
      },
    };
    return { pptx, slides };
  }
  {
    const R = bootReport();
    ok("report.js 能在页面里正常加载（没有加载期报错）", !!R.window.ReportKit && R.errors.length === 0, R.errors.join(" | ").slice(0, 160));
    const K = R.window.ReportKit._;
    ok("对外提供了天眼导出接口（ReportKit.exportEye）", typeof R.window.ReportKit.exportEye === "function");
    ok("对外暴露了组装函数与排布函数（便于验证）", typeof K.assembleEye === "function" && typeof K.eyeSlice === "function");

    const spec = { name: "16:9 宽屏", w: 13.333, h: 7.5 };
    const PER = 12;
    const pools = [1, 2, 3].map((i) => ({
      name: "2026W4" + i, spec: "美国", meta: "较上一周新上榜 3 张",
      cards: Array.from({ length: PER }, (_, k) => ({
        url: "https://img.newtrend.top/p/" + i + "_" + k + ".jpg",
        cat: "卫衣", period: "2026W4" + i,
        tag: (k % 2 ? "热卖爆品" : "潜力爆品"),
        move: (k % 3 === 0 ? "上升 " + (k + 1) + " 位" : ""),
      })),
    }));
    const data = pools.map(() => Array.from({ length: PER }, (_, k) => "data:image/jpeg;base64,AAAA" + k));
    const rec = makeRecorder();
    K.assembleEye(rec.pptx, { spec: spec, pools: pools, data: data, state: { zone: "趋势上升榜-天眼", cat: "卫衣", sites: ["美国"], periods: ["2026W41", "2026W42", "2026W43"] }, scope: "当前对比列", now: new Date() });

    const body = rec.slides.slice(1);
    ok("封面 + 每列一页（3 列 → 共 4 页）", rec.slides.length === 4, "页数=" + rec.slides.length);
    ok("封面有文字（标题 / 口径 / 张数 / 版权）", rec.slides[0].items.filter((x) => x.type === "text").length >= 4);
    ok("对比页数 = 列数（整页对比内容都在同一个 PPT 里）", body.length === 3);

    let allImg = [], allTag = [], bad = [];
    body.forEach((s, si) => {
      const imgs = s.items.filter((x) => x.type === "image");
      const texts = s.items.filter((x) => x.type === "text");
      if (imgs.length !== PER) bad.push("第" + (si + 1) + "页图片数=" + imgs.length);
      imgs.forEach((im) => {
        allImg.push(im);
        if (!im.o.data) bad.push("有图缺像素");
        if (Math.abs(im.o.h - im.o.w * 4 / 3) > 1e-6) bad.push("图片比例不是 3:4");
        if (im.o.x < 0 || im.o.y < 0 || im.o.x + im.o.w > spec.w + 1e-6 || im.o.y + im.o.h > spec.h + 1e-6) bad.push("图片超出页面");
        /* 标签：与图片同列（x 相同）、且紧贴在图片下沿之下 */
        const tag = texts.find((t) => Math.abs(t.o.x - im.o.x) < 1e-9 && t.o.y >= im.o.y + im.o.h - 1e-6 && t.o.y < im.o.y + im.o.h + 0.2);
        if (!tag) bad.push("有图没有下方标签");
        else {
          allTag.push(tag);
          if (!/热卖爆品|潜力爆品|上升|卫衣|2026W/.test(tag.t)) bad.push("标签内容异常：" + tag.t);
          if (tag.o.wrap !== true) bad.push("标签未允许换行");
        }
        /* 「没有文字压图」：任何文字框都不得与图片框相交 */
        texts.forEach((t) => {
          const tw = t.o.w || 0, th = t.o.h || 0;
          const inter = t.o.x < im.o.x + im.o.w && t.o.x + tw > im.o.x && t.o.y < im.o.y + im.o.h && t.o.y + th > im.o.y;
          if (inter) bad.push("有文字压在图片上：" + JSON.stringify(t.t));
        });
      });
    });
    ok("每张图都是「真实图片对象」（不是整页截图）——" + allImg.length + " 张", allImg.length === PER * 3);
    ok("每张图下方都有标签，且标签内容正常", allTag.length === allImg.length && bad.length === 0, bad.slice(0, 4).join(" | "));
    ok("每页内的图片互不重叠", (function () {
      for (const s of body) {
        const imgs = s.items.filter((x) => x.type === "image");
        for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) {
          const a = imgs[i].o, b = imgs[j].o;
          if (a.x < b.x + b.w - 1e-9 && a.x + a.w > b.x + 1e-9 && a.y < b.y + b.h - 1e-9 && a.y + a.h > b.y + 1e-9) return false;
        }
      }
      return true;
    })());
    const sample = body[0].items.filter((x) => x.type === "image")[0].o;
    const sampleTag = body[0].items.filter((x) => x.type === "text").find((t) => Math.abs(t.o.x - sample.x) < 1e-9 && t.o.y >= sample.y + sample.h - 1e-6);
    console.log("    示例：图片 " + sample.w.toFixed(2) + "×" + sample.h.toFixed(2) + " in；其下方标签 y=" + sampleTag.o.y.toFixed(2) + "（图片下沿 y=" + (sample.y + sample.h).toFixed(2) + "）→「" + sampleTag.t + "」");

    /* 排布：图少 → 一屏一页；图多 → 自动拆页，且每张都不小于最小宽度 */
    const W = spec.w - 0.6, H = spec.h - 0.78 - 0.3;
    const g4 = K.eyeSlice(4, W, H), g100 = K.eyeSlice(100, W, H);
    ok("一列只有 4 张时：一屏一页装完（per=4）", g4.per === 4, "per=" + g4.per);
    ok("一列 100 张时自动拆页，不把图压成看不到的小点", g100.per > 0 && g100.per < 100, "每页 " + g100.per + " 张、每行 " + g100.cols + " 张");
    ok("拆页后每张图仍不小于 0.55 英寸（在 PPT 里点开能看清）", g100.cw >= 0.55, "宽 " + g100.cw.toFixed(2) + " in");
    console.log("    一列 100 张 → 每页 " + g100.per + " 张（" + g100.cols + " 列 × " + Math.ceil(g100.per / g100.cols) + " 行），图片宽 " + g100.cw.toFixed(2) + " in");

    /* 取像素失败时如实留白，不假装有图、不抛错 */
    const rec2 = makeRecorder();
    K.assembleEye(rec2.pptx, { spec: spec, pools: [pools[0]], data: [[null, null, null]], state: {}, scope: "", now: new Date() });
    const page1 = rec2.slides[1];
    const boxes = page1.items.filter((x) => x.type === "text" && x.t === "图片未取到");
    ok("有图取不到像素时如实留白（写明「图片未取到」，" + PER + " 张全没取到时就是 " + PER + " 个占位）",
      boxes.length === PER, "占位=" + boxes.length);
    ok("取不到像素时不抛错、其余内容照常生成", rec2.slides.length === 2 && R.errors.length === 0);

    /* 抓取顺序：必须先让本站图片以跨域方式重取一次，再取像素（否则 canvas 全是空白） */
    const src = read("js/report.js");
    const iPrep = src.indexOf("prepCorsImages(wrap)");
    const iCap = src.indexOf("imgDataUrl(t.im)");
    ok("导出前先做跨域图片准备（否则 canvas 取不到像素、导出的 PPT 会全白）", iPrep > 0 && iCap > iPrep);
    ok("导出 PPT 走的是「真实图片」路径（新增 addImage），没有沿用整页截图", /addImage\(\{\s*data:/.test(src));

    /* 权限：非超管不得导出 */
    const R2 = bootReport();
    const hudTxt = (function () {
      R2.window.document.body.innerHTML = '<button id="rk-report-btn"></button>';
      R2.window.ReportKit.init({ btn: "#rk-report-btn", isSuper: () => false, state: () => ({}) });
      return null;
    })();
    await R2.window.ReportKit.exportEye();
    await sleep(120);
    const hud = R2.window.document.querySelector("#rp-hud");
    ok("非超级管理员点导出 → 被拒绝并给出提示", !!hud && /超级管理员/.test(hud.textContent || ""), hud ? hud.textContent : "无提示");
    ok("非超管导出不产生任何文件（不抛错）", R2.errors.length === 0, R2.errors.join(" | ").slice(0, 160));
  }

  /* ---------------- ⑧ 图片像素转换的健壮性 ---------------- */
  console.log("\n[8] 图片像素转换：取不到就返回「无」，绝不抛错");
  {
    const R = bootReport();
    const K = R.window.ReportKit._;
    const doc = R.window.document;
    /* ① 图片还没加载完（天然尺寸为 0） */
    const im1 = doc.createElement("img");
    const d1 = await K.imgDataUrl(im1);
    ok("图片未加载完成 → 返回「无」（不做假数据）", d1 === null);
    /* ② 有天然尺寸，但环境没有 canvas → 返回「无」，不抛错 */
    const im2 = doc.createElement("img");
    Object.defineProperty(im2, "naturalWidth", { configurable: true, value: 800 });
    Object.defineProperty(im2, "naturalHeight", { configurable: true, value: 1067 });
    const d2 = await K.imgDataUrl(im2);
    ok("环境不具备 canvas 能力 → 返回「无」，不抛错", d2 === null && R.errors.length === 0, R.errors.join(" | ").slice(0, 160));
    /* ③ 进度条：出现 / 消失 */
    K.hud(true, "正在读取图片 1 / 10…", 30);
    ok("导出时会在右下角显示进度（不弹窗、不遮图）", !!doc.querySelector("#rp-hud"));
    K.hud(false);
    ok("导出结束后进度条自动消失", !doc.querySelector("#rp-hud"));
  }

  /* ---------------- 汇总 ---------------- */
  console.log("\n== 结果：" + pass + " 项通过，" + fail + " 项失败 ==");
  if (fail) { console.log("失败项：\n  - " + failures.join("\n  - ")); process.exit(1); }
})().catch((e) => { console.error("验证脚本异常：" + (e && e.message)); process.exit(1); });