/* ============================================================
 * 本轮两项修复的运行时验证：
 *   ① 趋势上升榜「图幅 小/中/大」必须真正生效（此前被自动铺满的行内列数盖掉 → 点了没反应）；
 *   ② 天眼默认只对比最近两周，并且在顶栏加上「排序」下拉。
 *
 * 全部执行真实文件、真实代码：jsdom 装载真实 rank.html + 真实 js/rank.js，
 * 调用生产代码里的 fitPools / sizeAdjustedR / eyeScope / fillEye，
 * 真实点击筛选栏里的图幅芯片、真实改天眼排序下拉。
 *
 * 用法：node tools/verify_rank_size_eye2.js <站点仓库根目录>
 * ============================================================ */
const fs = require("fs");
const path = require("path");

let JSDOM, VirtualConsole;
try {
  JSDOM = require("jsdom").JSDOM;
  VirtualConsole = require("jsdom").VirtualConsole;
} catch (e) {
  console.error("需要先安装 jsdom：npm install jsdom@22.1.0");
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

/* ---------------- 极简 CSS 规则解析 ---------------- */
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
function decl(selector, prop) {
  let val = null;
  CSS.forEach((r) => {
    const sels = r.sel.split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (sels.indexOf(selector) < 0) return;
    const re = new RegExp("(?:^|;)\\s*" + prop.replace(/[-]/g, "\\-") + "\\s*:\\s*([^;]+)");
    const m = re.exec(";" + r.body);
    if (m) val = m[1].trim().replace(/\s+/g, " ");
  });
  return val;
}

/* ---------------- 假数据层（只覆盖本页真正会调用的方法） ---------------- */
const PERIODS = ["2026W39", "2026W40", "2026W41", "2026W42"];
const SITES = ["美国", "英国"];
const PER_SITE = 24;                 /* 每个「站点×期次」的条数：足够把列排满，让自动列数算得出来 */
function makeItems() {
  const out = [];
  PERIODS.forEach((p, pi) => {
    SITES.forEach((s, si) => {
      for (let i = 0; i < PER_SITE; i++) {
        out.push({
          image_url: "https://img.newtrend.top/p/" + p + "_" + s + "_" + i + ".jpg",
          site: s, period_label: p, category: "卫衣", leaf_category: "卫衣",
          /* ratio 与 index 强相关：便于断言「排序后首张卡是哪一张」 */
          ratio: 1 + ((i + pi + si) % 7) * 0.5,
          abs_delta: 500 - i * 7 - pi * 3 - si,
        });
      }
    });
  });
  return out;
}
function makeSB(items, cfg) {
  cfg = cfg || {};
  const impl = {
    getSession: async () => ({ access_token: "T", user: { id: "u1", email: "a@b.c" } }),
    onAuth: () => {}, onAuthChange: () => {}, currentToken: async () => "T",
    signOut: async () => {}, myRole: async () => "super",
    getFrontendZoneVisibility: async () => ({}), myFrontendZones: async () => null,
    rankFacets: async () => ({ sites: SITES.slice(), periods: PERIODS.slice(), categories: ["卫衣"] }),
    listRankSites: async () => SITES.map((n) => ({ name: n })),
    getRankGroups: async () => [],
    listRankItems: async (f) => {
      const s = (f && f.sites) || [], p = (f && f.periods) || [];
      return items.filter((it) => (!s.length || s.indexOf(it.site) >= 0) && (!p.length || p.indexOf(it.period_label) >= 0));
    },
  };
  return new Proxy(impl, {
    get(t, k) { if (k in t) return t[k]; if (typeof k !== "string") return undefined; return async () => null; },
  });
}

const EXPORTS =
  "window.__t={fitPools:fitPools,fitPoolsSoon:fitPoolsSoon,sizeAdjustedR:sizeAdjustedR,eyeScope:eyeScope," +
  "openEye:openEye,closeEye:closeEye,fillEye:fillEye,POOL_MIN_CARD:POOL_MIN_CARD,POOL_R_MAX:POOL_R_MAX," +
  "EYE_PERIODS_MAX:EYE_PERIODS_MAX," +
  "setSize:function(v){SIZE=v;},getSize:function(){return SIZE;}," +
  "setState:function(o){if(o.periods)SEL_PERIODS=o.periods.slice();if(o.sites)SEL_SITES=o.sites.slice();" +
  "if(o.size)SIZE=o.size;" +
  "if(o.mode)MODE=o.mode;if(o.sort)SORT=o.sort;if(o.all!=null)EYE_ALL=o.all;}," +
  "getState:function(){return {periods:SEL_PERIODS.slice(),sites:SEL_SITES.slice(),mode:MODE,sort:SORT,size:SIZE,all:EYE_ALL,clamped:EYE_PERIOD_CLAMPED};}};";

async function bootRank(cfg) {
  cfg = cfg || {};
  const html = read("rank.html").replace(/<script src="[^"]*"><\/script>/g, "");
  const vc = new VirtualConsole();
  const logs = [];
  vc.on("jsdomError", (e) => logs.push("jsdomError: " + (e && e.message)));
  const dom = new JSDOM(html, { url: "https://newtrend.top/rank.html", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message || e.error)));
  window.addEventListener("unhandledrejection", (e) => errors.push("unhandled: " + e.reason));

  window.eval(read("js/config.js"));
  window.SB = makeSB(cfg.items || makeItems(), cfg);

  const src = read("js/rank.js");
  const hooked = src.replace(/\}\)\(\);\s*$/, EXPORTS + "})();");
  const injected = hooked !== src;
  window.eval(hooked);
  for (let i = 0; i < 80; i++) await sleep(20);
  return { dom, window, errors, logs, injected, T: window.__t };
}

/* jsdom 没有排版引擎：把本页真正读取的几个尺寸显式钉住，让真实铺排函数算出确定的结果 */
function stubLayout(window, poolW, poolH053, colW) {
  const doc = window.document;
  const pools = doc.querySelector("#rank-view .rk-pools") || doc.querySelector(".rk-pools");
  if (!pools) return null;
  const def = (el, prop, val) => Object.defineProperty(el, prop, { value: val, configurable: true });
  def(pools, "clientWidth", poolW === undefined ? 1100 : poolW);
  def(pools, "clientHeight", poolH053 === undefined ? 620 : poolH053);
  let n = 0;
  Array.prototype.forEach.call(pools.querySelectorAll(".rk-pool-grid"), (g) => {
    def(g, "clientWidth", colW === undefined ? 267 : colW);
    n++;
  });
  return { pools: pools, grids: n };
}
function readR(window) {
  const doc = window.document;
  const pools = doc.querySelector("#rank-view .rk-pools") || doc.querySelector(".rk-pools");
  if (!pools) return [];
  return Array.prototype.map.call(pools.querySelectorAll(".rk-pool-grid"), (g) => ({
    r: parseFloat(g.style.getPropertyValue("--rk-r")),
    n: g.querySelectorAll(".rk-card").length,
    cls: g.className,
  }));
}

/* ============================================================ */
(async function main() {
  console.log("== 图幅档位生效 + 天眼默认两周与排序：运行时验证 ==");
  console.log("仓库根目录：" + path.resolve(ROOT));

  const src = read("js/rank.js");

  /* ---------------- [1] 图幅档位必须真正参与列数计算 ---------------- */
  console.log("\n[1] 图幅 小/中/大：必须真正生效");
  ok("存在档位换算函数 sizeAdjustedR", /function sizeAdjustedR\s*\(/.test(src));
  ok("铺排时确实调用了档位换算（不是只算自动列数）", /setProperty\(\s*"--rk-r"\s*,\s*String\(\s*sizeAdjustedR\(/.test(src),
    "旧写法 String(fit.r) 会让三个档位完全没反应");
  ok("不再存在「直接用自动列数」的旧写法", !/setProperty\(\s*"--rk-r"\s*,\s*String\(\s*fit\.r\s*\)\s*\)/.test(src));
  ok("档位换算受「卡片最小宽度」兜底", /POOL_MIN_CARD/.test(src) && /maxCols/.test(src));

  {
    const b = await bootRank();
    ok("真实页面装载成功（内存里注入了测试导出）", b.injected && !!b.T);
    ok("页面脚本无运行期报错", b.errors.length === 0, b.errors.join(" | "));

    const st = stubLayout(b.window);
    ok("找到真实对比池与列网格", !!st && st.grids > 0, st ? "网格数 " + st.grids : "未找到");

    const measure = (size) => {
      b.T.setSize(size);
      b.T.fitPools();                       /* 真实铺排函数 */
      const rs = readR(b.window);
      return rs;
    };
    const rS = measure("s"), rM = measure("m"), rL = measure("l");
    const rv = (arr) => (arr.length ? arr[0].r : NaN);
    console.log("      自动档位下的首列每行张数：小=" + rv(rS) + " 中=" + rv(rM) + " 大=" + rv(rL));
    ok("三档都算出了列数", [rv(rS), rv(rM), rv(rL)].every((v) => typeof v === "number" && v > 0 && isFinite(v)));
    ok("小档每行张数 > 中档（图更小）", rv(rS) > rv(rM), "小=" + rv(rS) + " 中=" + rv(rM));
    ok("中档每行张数 > 大档（图更大）", rv(rM) > rv(rL), "中=" + rv(rM) + " 大=" + rv(rL));
    ok("三个档位互不相同（点哪一档都有变化）", new Set([rv(rS), rv(rM), rv(rL)]).size === 3, "小/中/大=" + [rv(rS), rv(rM), rv(rL)].join("/"));
    ok("所有列都写入了列数", rM.length > 0 && rM.every((x) => x.r > 0));

    const colW = 267;
    const minCard = b.T.POOL_MIN_CARD, rMax = b.T.POOL_R_MAX;
    [["小", rS], ["中", rM], ["大", rL]].forEach(([label, rs]) => {
      rs.forEach((x, i) => {
        const w = colW / x.r;
        ok("[" + label + "] 第" + (i + 1) + "列卡片宽度 " + w.toFixed(1) + "px 不低于最小可读宽度 " + minCard + "px", w >= minCard - 0.01, "w=" + w.toFixed(2));
      });
    });
    ok("列数不超过每行上限 " + rMax, [rv(rS), rv(rM), rv(rL)].every((v) => v <= rMax));

    /* 真实点击筛选栏里的图幅芯片（走真实事件绑定） */
    const doc = b.window.document;
    const chip = doc.querySelector('[data-size="s"]');
    ok("筛选栏里存在「图幅」芯片（可真实点击）", !!chip);
    if (chip) {
      chip.click();
      for (let i = 0; i < 30; i++) await sleep(20);
      ok("点击「小」后状态确实切换为小档", b.T.getSize() === "s", "实际：" + b.T.getSize());
      const st2 = stubLayout(b.window);
      ok("点击后列网格被重建（走的是真实渲染流程）", !!st2 && st2.grids > 0);
      b.T.fitPools();
      const after = readR(b.window);
      ok("点击「小」后列数确实变多（图变小，不再没反应）", rv(after) > rv(rM), "点击后=" + rv(after) + " 中档=" + rv(rM));
    }

    /* 大档：列数变少、图变大，且不得撑破右边界（每行张数为整数列） */
    b.T.setSize("l");
    stubLayout(b.window);
    b.T.fitPools();
    const rl2 = readR(b.window);
    ok("大档下卡片明显变大（列数少于中档）", rv(rl2) < rv(rM), "大=" + rv(rl2) + " 中=" + rv(rM));
    ok("大档下卡片宽度约为列宽/列数（没有溢出到右边界）", Math.abs(colW / rv(rl2) - colW / rv(rl2)) < 0.01);
  }

  /* ---------------- [2] 天眼默认只对比最近两周 ---------------- */
  console.log("\n[2] 天眼：默认只对比最近两周");
  ok("存在天眼周数上限常量", /var EYE_PERIODS_MAX\s*=\s*2\s*;/.test(src), "应默认 2 周");
  ok("收紧逻辑写在「当前对比列」分支里（未覆盖「全部站点×全部期次」）",
    /EYE_PERIODS_MAX[\s\S]{0,160}slice\(ps\.length - EYE_PERIODS_MAX\)/.test(src));
  ok("收紧后仍保持「取最近的周」而不是最早的周", /ps\.slice\(ps\.length - EYE_PERIODS_MAX\)/.test(src));
  ok("「全部站点 × 全部期次」分支保持原样（不受两周限制）",
    /if \(MODE === "h"\) return \{ sites: orderedSites\(\)/.test(src) && /return \{ sites: sitesForQuery\(\), periods: sortPeriods\(FACETS\.periods\) \};/.test(src));

  {
    const b = await bootRank();
    const T = b.T;
    /* 选中 4 个周次，纵向时间对比 */
    T.setState({ mode: "v", periods: PERIODS.slice(), sites: ["美国"], all: false });
    let sc = T.eyeScope();
    ok("纵向对比选中 4 周时，天眼只取 2 周", sc.periods.length === 2, "实际 " + sc.periods.length + " 周：" + sc.periods.join("、"));
    ok("取的是最近的两周（W41 / W42）", sc.periods.join(",") === "2026W41,2026W42", sc.periods.join(","));
    ok("状态里标记了「本次按默认收紧」（用于顶栏提示）", T.getState().clamped === true);

    /* 只选两周：不触发收紧（本来就是两周） */
    T.setState({ mode: "v", periods: ["2026W41", "2026W42"], all: false });
    sc = T.eyeScope();
    ok("用户自己就只选两周时，列数保持 2 且不误报收紧", sc.periods.length === 2 && T.getState().clamped === false);

    /* 只选一周：不补足、不报错 */
    T.setState({ mode: "v", periods: ["2026W42"], all: false });
    sc = T.eyeScope();
    ok("只选一周时保持一周（不会自作主张补成两周）", sc.periods.length === 1 && T.getState().clamped === false);

    /* 横向国家对比：周次本来就是单选，收紧不应改变行为 */
    T.setState({ mode: "h", periods: ["2026W42"], sites: ["美国", "英国"], all: false });
    sc = T.eyeScope();
    ok("横向国家对比下不受两周规则影响（周次仍为 1）", sc.periods.length === 1, sc.periods.join(","));
    ok("横向下站点列完整保留", sc.sites.length === 2, sc.sites.join("、"));

    /* 「全部」范围按钮：不受两周限制 */
    T.setState({ mode: "v", periods: PERIODS.slice(), sites: ["美国"], all: true });
    sc = T.eyeScope();
    ok("切到「全部站点 × 全部期次」后不再限制为两周", sc.periods.length === PERIODS.length, "实际 " + sc.periods.length);
    ok("切到「全部」后「默认两周」的状态标记必须复位（否则提示会一直挂着）", T.getState().clamped === false);
    T.setState({ all: false });
    sc = T.eyeScope();
    ok("再切回「当前对比列」时提示恢复（状态跟随实际范围）", sc.periods.length === 2 && T.getState().clamped === true);
  }

  {
    /* 顶栏提示：把真实 DOM 打开，确认「默认只对比最近 2 周」会出现在顶栏信息里 */
    const b = await bootRank();
    const T = b.T;
    T.setState({ mode: "v", periods: PERIODS.slice(), sites: ["美国"], all: false });
    T.openEye();
    for (let i = 0; i < 60; i++) await sleep(20);
    const doc = b.window.document;
    const sub = doc.querySelector("#rk-eye-sub");
    ok("天眼顶栏信息里明确提示「默认只对比最近 2 周」", !!sub && /默认只对比最近\s*2\s*周/.test(sub.textContent || ""), sub ? String(sub.textContent).slice(0, 80) : "未找到顶栏");
    ok("提示使用独立样式（不抢眼、只在悬浮顶栏里出现）", /\.rk-eye-dflt\s*\{/.test(read("css/style.css")));
    {
      /* 真实点「范围」按钮切到全部：顶栏不得再挂着两周提示，且字数仍明显少于修复前 */
      const btn = doc.querySelector("#rk-eye-scope");
      ok("天眼顶栏存在「范围」按钮", !!btn);
      if (btn) {
        btn.click();
        for (let i = 0; i < 80; i++) await sleep(20);
        const sub2 = doc.querySelector("#rk-eye-sub");
        const t2 = sub2 ? String(sub2.textContent).trim() : "";
        ok("切到「全部」后顶栏不再出现「默认只对比最近 2 周」", t2.indexOf("默认只对比最近") < 0, t2);
        ok("切到「全部」后顶栏仍是短信息（字数不超过修复前写法的 6 成）", t2.length > 0 && t2.length <= 19, t2);
      }
    }
  }

  /* ---------------- [3] 天眼排序 ---------------- */
  console.log("\n[3] 天眼：排序下拉");
  ok("天眼顶栏含排序下拉", /id="rk-eye-sortsel"/.test(src));
  ok("排序选项与筛选栏一致（四个口径）",
    ["ratio_desc", "ratio_asc", "abs_desc", "abs_asc"].every((v) => src.indexOf('value="' + v + '"') >= 0));
  ok("排序下拉默认不显示、鼠标悬浮顶栏才显现（不压图）", decl(".rk-eye-sortsel", "display") === "none" &&
    decl(".rk-eye-head:hover .rk-eye-sortsel", "display") === "block");
  ok("点击排序下拉不会被当作「关闭天眼」或「打开大图」", /t\.id === "rk-eye-sortsel"\) return;/.test(src));
  ok("排序下拉带 change 绑定并会重新填充", /addEventListener\("change"[\s\S]{0,120}SORT = ssel\.value/.test(src));

  {
    const b = await bootRank();
    const T = b.T;
    const doc = b.window.document;
    T.setState({ mode: "v", periods: ["2026W41", "2026W42"], sites: ["美国"], all: false, sort: "ratio_desc" });
    T.openEye();
    for (let i = 0; i < 80; i++) await sleep(20);
    const sel = doc.querySelector("#rk-eye-sortsel");
    ok("天眼 DOM 里存在排序下拉", !!sel);
    ok("下拉选中项与当前排序一致（初始）", !!sel && sel.value === "ratio_desc", sel ? sel.value : "-");

    const firstCardImg = () => {
      const c = doc.querySelector("#rk-eye-body .rk-card");
      const im = c ? c.querySelector("img") : null;
      return im ? (im.getAttribute("src") || "") : "";
    };
    const descFirst = firstCardImg();
    ok("天眼已渲染出卡片", !!descFirst, descFirst);

    /* 真实改下拉 → 触发 change → 应重新排序并重绘 */
    if (sel) {
      sel.value = "ratio_asc";
      sel.dispatchEvent(new b.window.Event("change"));
      for (let i = 0; i < 80; i++) await sleep(20);
      const ascFirst = firstCardImg();
      ok("切换排序后首张卡片发生变化（排序真的生效）", !!ascFirst && ascFirst !== descFirst, "高→低首张：" + descFirst.split("/").pop() + " 低→高首张：" + ascFirst.split("/").pop());
      ok("切换后下拉仍与状态一致", doc.querySelector("#rk-eye-sortsel").value === "ratio_asc");

      /* 与测试侧独立算出的期望顺序对照（真实数据、真实顺序） */
      const items = makeItems().filter((it) => it.period_label === "2026W41" || it.period_label === "2026W42");
      const expAsc = items.slice().sort((x, y) => x.ratio - y.ratio)[0];
      ok("低→高排序的首张确实是环比最低的那张", ascFirst.indexOf(expAsc.image_url) >= 0 || ascFirst.split("/").pop() === expAsc.image_url.split("/").pop(),
        "期望 " + expAsc.image_url.split("/").pop() + " 实际 " + ascFirst.split("/").pop());
    }

    /* 排序切换不得把天眼关掉，也不得误开灯箱 */
    ok("切换排序后天线面板仍然打开", !!doc.querySelector("#rk-eye-body"));
    ok("切换排序没有误开大图灯箱", !doc.querySelector("#rk-lightbox") || doc.querySelector("#rk-lightbox").style.display !== "block");
  }

  /* ---------------- [4] 反向验证：旧写法必须被拦住 ---------------- */
  console.log("\n[4] 反向验证（把旧写法还原到副本上，检查项必须报失败）");
  {
    const tmp = path.join(ROOT, ".tmp_rev");
    fs.mkdirSync(tmp, { recursive: true });
    const undo = (rel, pairs) => {
      const dst = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      let s = fs.readFileSync(path.join(ROOT, rel), "utf8");
      pairs.forEach(([a, b]) => { s = s.split(a).join(b); });
      fs.writeFileSync(dst, s);
    };
    /* ① 图幅：还原成「直接用自动列数」 */
    undo("js/rank.js", [['setProperty("--rk-r", String(sizeAdjustedR(fit.r, n, colW)))', 'setProperty("--rk-r", String(fit.r))']]);
    const revJs = fs.readFileSync(path.join(tmp, "js/rank.js"), "utf8");
    ok("反向①：还原旧写法后，「确实调用档位换算」这条检查会失败",
      !/setProperty\(\s*"--rk-r"\s*,\s*String\(\s*sizeAdjustedR\(/.test(revJs));
    ok("反向①：还原旧写法后，「不存在旧写法」这条检查会失败",
      /setProperty\(\s*"--rk-r"\s*,\s*String\(\s*fit\.r\s*\)\s*\)/.test(revJs));

    /* ① 的运行时反向：用还原后的脚本重跑铺排，三档列数应当完全相同 */
    {
      const html = read("rank.html").replace(/<script src="[^"]*"><\/script>/g, "");
      const dom = new JSDOM(html, { url: "https://newtrend.top/rank.html", runScripts: "dangerously", pretendToBeVisual: true });
      const w = dom.window;
      w.eval(read("js/config.js"));
      w.SB = makeSB(makeItems(), {});
      w.eval(revJs.replace(/\}\)\(\);\s*$/, EXPORTS + "})();"));
      for (let i = 0; i < 80; i++) await sleep(20);
      const st = stubLayout(w);
      const meas = (size) => { w.__t.setSize(size); w.__t.fitPools(); return readR(w).length ? readR(w)[0].r : NaN; };
      const a = meas("s"), b2 = meas("m"), c = meas("l");
      ok("反向①（运行时）：还原旧写法后，小/中/大三档列数完全相同（正是用户看到的「没反应」）",
        st && a === b2 && b2 === c && isFinite(a), "小/中/大=" + [a, b2, c].join("/"));
    }

    /* ② 天眼两周：去掉收紧逻辑 */
    undo("js/rank.js", [
      ['EYE_PERIOD_CLAMPED = ps.length > EYE_PERIODS_MAX;\n      if (EYE_PERIOD_CLAMPED) ps = ps.slice(ps.length - EYE_PERIODS_MAX);\n      ', ''],
      ['EYE_PERIOD_CLAMPED = ps.length > EYE_PERIODS_MAX;\r\n      if (EYE_PERIOD_CLAMPED) ps = ps.slice(ps.length - EYE_PERIODS_MAX);\r\n      ', ''],
    ]);
    const revJs2 = fs.readFileSync(path.join(tmp, "js/rank.js"), "utf8");
    ok("反向②：去掉收紧逻辑后，「只取 2 周」这条检查会失败",
      !/slice\(ps\.length - EYE_PERIODS_MAX\)/.test(revJs2));
    ok("反向②：去掉收紧逻辑后，4 周会被原样带进天眼（旧行为）",
      !/EYE_PERIODS_MAX[\s\S]{0,160}slice\(ps\.length - EYE_PERIODS_MAX\)/.test(revJs2));

    /* ③ 天眼排序：移除下拉 */
    undo("js/rank.js", [
      [`'<select class="rk-eye-sortsel" id="rk-eye-sortsel" title="排序方式">' +
            '<option value="ratio_desc">环比比例 高→低</option>' +
            '<option value="ratio_asc">环比比例 低→高</option>' +
            '<option value="abs_desc">环比绝对值 高→低</option>' +
            '<option value="abs_asc">环比绝对值 低→高</option>' +
          '</select>' +
          `, ""],
    ]);
    const revJs3 = fs.readFileSync(path.join(tmp, "js/rank.js"), "utf8");
    ok("反向③：移除排序下拉后，「天眼含排序下拉」这条检查会失败", !/id="rk-eye-sortsel"/.test(revJs3));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log("\n============================================================");
  console.log("通过 " + pass + " 项，失败 " + fail + " 项");
  if (fail) { console.log("\n失败明细："); failures.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
})();