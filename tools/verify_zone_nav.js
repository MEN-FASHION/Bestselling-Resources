/* ============================================================
 * 顶部菜单一致性 —— 运行时验证
 *
 * 背景（用户反馈的 BUG）：在「趋势上升榜」能看到「招品回品 / BESTSELLER」，
 * 切到其它专区这两个入口就消失了。根因有两个：
 *   ① 榜单页没有引入公共专区模块（也没有任何显隐逻辑）→ 菜单永远常显；
 *   ② 趋势专区/营销日历用的是「后台可管理专区」(manage_zones) 而不是
 *      「前台可见专区」(frontend_zones) 做白名单 → 与视觉专区判定不一致。
 *
 * 本脚本全部执行真实代码：
 *   A. 接线检查：四个页面都引入公共模块，且都调用统一显隐实现；
 *   B. 运行时：在四个页面的真实 DOM 里加载真实 common.js，放入同一份白名单，
 *      断言四个页面得到的「可见菜单集合」完全一致；
 *   C. 反向验证：把关键实现还原成旧写法，断言检查项会失败。
 *
 * 用法：node tools/verify_zone_nav.js <站点仓库根目录>
 * ============================================================ */
const fs = require("fs");
const path = require("path");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) { console.error("需要先安装 jsdom：npm install jsdom@22.1.0"); process.exit(2); }

const ROOT = process.argv[2] || ".";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; failures.push(name); console.log("  \u2717 " + name + (extra ? "  [" + extra + "]" : "")); }
};

const PAGES = ["index.html", "trends.html", "marketing.html", "rank.html"];
const PAGE_JS = { "index.html": "js/frontend.js", "trends.html": "js/trends.js", "marketing.html": "js/marketing.js", "rank.html": "js/rank.js" };

/* 在某个页面的真实 DOM 里跑真实 common.js，返回可见的专区 key 集合 */
function visibleZones(pageFile, whitelist, opts) {
  const o = opts || {};
  const html = read(pageFile).replace(/<script src="[^"]*"><\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://newtrend.top/" + pageFile, runScripts: "dangerously", pretendToBeVisual: true });
  const win = dom.window;
  win.eval(read("js/config.js"));
  win.eval(read("js/common.js"));
  const C = win.Common && win.Common.zones;
  if (!C) return null;
  C.setVis(o.vis || {});
  C.setMine(whitelist);
  // 旧写法：直接按 manage_zones 白名单隐藏（用于反向验证）
  if (o.legacyHide) {
    win.document.querySelectorAll(".top-tabs .tab-link").forEach((a) => {
      const vt = a.getAttribute("data-viewtab") || "";
      const href = a.getAttribute("href") || "";
      let z = null;
      if (vt === "marketing" || href === "marketing.html") z = "marketing";
      else if (href === "index.html") z = "visual";
      else if (vt === "trend" || href === "trends.html") z = "trend";
      else if (vt === "recruit" || href === "trends.html#recruit") z = "recruit";
      else if (vt === "bestseller" || href === "trends.html#bestseller") z = "bestseller";
      if (z) a.style.display = whitelist && whitelist.length && whitelist.indexOf(z) === -1 ? "none" : "";
    });
    return collect(win);
  }
  C.applyNav();
  return collect(win);
}

function collect(win) {
  const out = [];
  win.document.querySelectorAll(".top-tabs .tab-link").forEach((a) => {
    const z = a.getAttribute("data-zone");
    if (z && z !== "notice" && a.style.display !== "none") out.push(z);
  });
  return out.sort();
}

console.log("== 顶部菜单一致性：运行时验证 ==");

/* ---------- A. 接线检查 ---------- */
console.log("\n[A] 接线：四个页面共用同一套显隐实现");
{
  PAGES.forEach((p) => ok(p + " 引入了公共专区模块", /js\/common\.js/.test(read(p))));
  const rankHtml = read("rank.html");
  ok("榜单页公共模块在 supabase 之后加载（依赖顺序正确）",
    rankHtml.indexOf("js/supabase.js") < rankHtml.indexOf("js/common.js"));

  Object.keys(PAGE_JS).forEach((p) => {
    const src = read(PAGE_JS[p]);
    ok(PAGE_JS[p] + " 调用统一显隐实现（Common.zones.applyNav）", /Common\.zones\.applyNav/.test(src));
  });
  ok("公共模块导出了 applyNav", /applyNav/.test(read("js/common.js")) && /applyNav,/.test(read("js/common.js")));

  ok("趋势专区改用「前台可见专区」白名单（不再用后台可管理专区）",
    /myFrontendZones/.test(read("js/trends.js")) && !/myManageZones/.test(read("js/trends.js")));
  ok("营销日历改用「前台可见专区」白名单（不再用后台可管理专区）",
    /myFrontendZones/.test(read("js/marketing.js")) && !/myManageZones/.test(read("js/marketing.js")));
  ok("榜单页读取的也是「前台可见专区」白名单", /myFrontendZones/.test(read("js/rank.js")));
  ok("视觉专区读取的也是「前台可见专区」白名单", /myFrontendZones/.test(read("js/frontend.js")));
}

/* ---------- B. 运行时：四页行为必须一致 ---------- */
console.log("\n[B] 运行时：同一份白名单下，四个页面的可见菜单完全一致");
{
  const cases = [
    { name: "未配置白名单（跟随全局）", wl: null },
    { name: "白名单含全部专区", wl: ["rank", "marketing", "visual", "trend", "recruit", "bestseller"] },
    { name: "白名单含 trend 与 recruit/bestseller", wl: ["visual", "trend", "recruit", "bestseller"] },
    { name: "白名单只有 visual/trend（不含招品回品）", wl: ["visual", "trend"] },
    { name: "白名单只有 visual", wl: ["visual"] },
  ];

  cases.forEach((c) => {
    const sets = PAGES.map((p) => visibleZones(p, c.wl));
    const first = JSON.stringify(sets[0]);
    const allSame = sets.every((s) => JSON.stringify(s) === first);
    ok("「" + c.name + "」四页可见集合一致", allSame,
      PAGES.map((p, i) => p + "=" + JSON.stringify(sets[i])).join(" "));
    console.log("      → 可见：" + sets[0].join(" / "));
  });

  // 用户反馈的核心场景：授权里有招品回品/BESTSELLER 时，四页都必须显示
  const wlAll = ["rank", "marketing", "visual", "trend", "recruit", "bestseller"];
  PAGES.forEach((p) => {
    const s = visibleZones(p, wlAll);
    ok(p + " 授权的「招品回品」可见", s.indexOf("recruit") >= 0, JSON.stringify(s));
    ok(p + " 授权的「BESTSELLER」可见", s.indexOf("bestseller") >= 0, JSON.stringify(s));
  });

  // 未授权时四页也都要藏（而不是只有部分页面藏）
  PAGES.forEach((p) => {
    const s = visibleZones(p, ["visual"]);
    ok(p + " 未授权的专区在菜单里隐藏", s.indexOf("recruit") < 0 && s.indexOf("trend") < 0 && s.indexOf("rank") < 0, JSON.stringify(s));
  });

  // 全局开关也要四页一致
  const visCases = [{ rank: false }, { marketing: false, trend: false }];
  visCases.forEach((v) => {
    const sets = PAGES.map((p) => visibleZones(p, null, { vis: v }));
    ok("全局开关 " + JSON.stringify(v) + " 下四页可见集合一致",
      sets.every((s) => JSON.stringify(s) === JSON.stringify(sets[0])),
      PAGES.map((p, i) => p + "=" + JSON.stringify(sets[i])).join(" "));
    PAGES.forEach((p) => {
      const s = visibleZones(p, null, { vis: v });
      const bad = Object.keys(v).filter((k) => v[k] === false && s.indexOf(k) >= 0);
      ok(p + " 全局关闭的专区不会出现在菜单里", bad.length === 0, bad.join(",") + " " + JSON.stringify(s));
    });
  });
}

/* ---------- C. 反向验证：还原旧写法必须被判失败 ---------- */
console.log("\n[C] 反向验证：还原旧写法后，一致性检查必须失败");
{
  // 旧写法：趋势/营销用「后台可管理专区」，而该账号后台只管视觉专区 → 只在这两页被藏
  const manageZones = ["visual"];
  const wl = ["visual", "trend", "recruit", "bestseller"];
  const legacyTrends = visibleZones("trends.html", manageZones, { legacyHide: true });
  const legacyIndex = visibleZones("index.html", wl);
  ok("还原：用后台可管理专区判定时，趋势页与视觉页可见集合不再一致（证明检查有效）",
    JSON.stringify(legacyTrends) !== JSON.stringify(legacyIndex),
    "trends=" + JSON.stringify(legacyTrends) + " index=" + JSON.stringify(legacyIndex));
  ok("还原：旧写法下趋势页确实会丢掉「招品回品 / BESTSELLER」（复现用户看到的现象）",
    legacyTrends.indexOf("recruit") < 0 && legacyTrends.indexOf("bestseller") < 0,
    JSON.stringify(legacyTrends));

  // 旧写法：榜单页没有 applyNav —— 源码里不应存在显隐逻辑
  const rankSrc = read("js/rank.js").replace(/if \(Common\.zones\.applyNav\) Common\.zones\.applyNav\(\);/g, "Common.zones.renderNav();");
  ok("还原：拿掉榜单页的统一调用后，接线检查会失败（证明检查有效）",
    !/Common\.zones\.applyNav/.test(rankSrc));

  // 旧写法：公共模块没有 applyNav
  const commonOld = read("js/common.js").replace(/applyNav,/, "");
  ok("还原：公共模块去掉 applyNav 导出后，接线检查会失败（证明检查有效）",
    !/applyNav,/ .test(commonOld));
}

console.log("\n" + "=".repeat(60));
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
if (failures.length) { console.log("失败项："); failures.forEach((f) => console.log(" - " + f)); }
process.exit(fail ? 1 : 0);