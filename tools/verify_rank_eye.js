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

let JSDOM;
try {
  JSDOM = require("jsdom").JSDOM;
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
    ok("顶栏强制单行、不换行（文字再多也不会把图顶下去）", /nowrap/.test(String(decl(".rk-eye-head", "flex-wrap"))));

    const tFont = numDecl(".rk-eye-title", "font-size");
    const sFont = numDecl(".rk-eye-sub", "font-size");
    ok("顶栏标题字号变小（" + tFont + "px，修复前 " + BEFORE.titleFont + "px）", tFont <= 12.5 && tFont < BEFORE.titleFont);
    ok("顶栏说明字号变小（" + sFont + "px，修复前 " + BEFORE.subFont + "px）", sFont <= 11.5 && sFont < BEFORE.subFont);
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
    ok("顶栏没有被改成浮在图上（未使用绝对定位去盖图）",
      !/absolute|fixed/.test(String(decl(".rk-eye-head", "position") || "static")));
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
      const VP_W = 1920, VP_H = 1080;
      const HEAD_NOW = 28 + 6;                       /* 顶栏细条（实测高约 28px）+ 列头 */
      const BODY_PAD_NOW = 4 + 6;                    /* .rk-eye-body 上下内边距 */
      const COL_GAP = numDecl(".rk-eye-body .rk-pools", "gap") || 4;
      const POOL_PAD = numDecl(".rk-eye-body .rk-pool", "padding") || 3;
      const K = 3;
      const availH_NOW = VP_H - HEAD_NOW - BODY_PAD_NOW;
      const colW_NOW = (VP_W - COL_GAP * (K - 1)) / K - POOL_PAD * 2;

      const fitNow = T.eyeFitCalc(colW_NOW, availH_NOW, 1, 58, { headH: HEAD_NOW, gap: T.EYE_GAP, vgap: T.EYE_VGAP });
      const needNow = HEAD_NOW + Math.ceil(58 / fitNow.r) * (fitNow.cardW * 4 / 3 + T.EYE_VGAP);
      ok("全屏后 3 列 × 每列 58 张：一屏放得下、不用滚动", fitNow.clipped === false);
      ok("算出的排布高度确实落在可用高度内（" + Math.round(needNow) + " ≤ " + Math.round(availH_NOW) + "）", needNow <= availH_NOW);
      ok("每行张数在合理区间（2~20 张/行）", fitNow.r >= 2 && fitNow.r <= 20, "r=" + fitNow.r);

      /* 反向对比：修复前（3vh/3vw 留白 + 粗顶栏 + 14/40 内边距 + 4px 缝）在同样屏幕上能排多大 */
      const oldInnerH = (VP_H * 0.94) - BEFORE.headPadTop * 2 - 16 - 46 - (14 + 40);
      const oldInnerW = (VP_W * 0.94) - 16 * 2 - 2 * 2;
      const colW_OLD = (oldInnerW - BEFORE.poolsGap * (K - 1)) / K - BEFORE.poolPad * 2;
      const fitOld = T.eyeFitCalc(colW_OLD, oldInnerH, 1, 58, { headH: 46, gap: BEFORE.gridGap, vgap: BEFORE.gridGap });
      ok("修复后每张图比修复前更大（" + fitNow.cardW.toFixed(1) + "px > " + fitOld.cardW.toFixed(1) + "px）", fitNow.cardW > fitOld.cardW);
      console.log("    修复前：单列可用 " + colW_OLD.toFixed(0) + "×" + oldInnerH.toFixed(0) + " → 每行 " + fitOld.r + " 张、卡片宽 " + fitOld.cardW.toFixed(1) + "px");
      console.log("    修复后：单列可用 " + colW_NOW.toFixed(0) + "×" + availH_NOW.toFixed(0) + " → 每行 " + fitNow.r + " 张、卡片宽 " + fitNow.cardW.toFixed(1) + "px");

      /* 图特别多时：如实标记需要下滑，且每张不低于最小可读宽度 */
      const fitHuge = T.eyeFitCalc(colW_NOW, availH_NOW, 1, 4000, { headH: HEAD_NOW, gap: T.EYE_GAP, vgap: T.EYE_VGAP });
      ok("图特别多（4000 张）时如实标记「可下滑查看剩余」", fitHuge.clipped === true);
      ok("图特别多时每张仍不低于最小可读宽度", (colW_NOW - T.EYE_GAP * (fitHuge.r - 1)) / fitHuge.r >= T.EYE_MIN_CARD - 0.01);
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
      ok("顶栏由「标题 + 说明 + 范围按钮 + 关闭」四件构成", !!head &&
        !!head.querySelector(".rk-eye-title") && !!sub &&
        !!doc.querySelector("#rk-eye-scope") && !!doc.querySelector("#rk-eye-close"));
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

  /* ---------------- 汇总 ---------------- */
  console.log("\n== 结果：" + pass + " 项通过，" + fail + " 项失败 ==");
  if (fail) { console.log("失败项：\n  - " + failures.join("\n  - ")); process.exit(1); }
})().catch((e) => { console.error("验证脚本异常：" + (e && e.message)); process.exit(1); });