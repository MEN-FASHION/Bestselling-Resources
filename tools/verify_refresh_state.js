/* verify_refresh_state.js —— 「刷新后保持原样」的校验（20261026W）
 *
 * 背景：以前所有筛选/面板选择只存在内存里，按 F5 就回到默认（前台像"跳回首页"，
 *       后台回到第一项并弹智能打标）。本版把状态写进地址栏 + 会话存储，刷新后恢复。
 *
 * 检查两类东西：
 *   ① 结构：每个页面确实有 syncUrl / readUrl，且真的在渲染时调用（避免"写了没接上"）
 *   ② 行为：用 jsdom 真跑——改状态后地址栏真的变了；带参数的地址真的能恢复回状态；
 *            首页在"刷新"时会把人送回上次那一页，而主动点导航时不会。
 *
 * 用法：node tools/verify_refresh_state.js [项目根目录]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = process.argv[2] || path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  →  " + extra : "")); }
};

console.log("\n=== 刷新后保持原样（前台 + 后台） ===\n");

/* ---------------- ① 结构：每个页面都接上了 ---------------- */
const RANK = read("js/rank.js");
const PLUS = read("js/plus.js");
const FAV = read("js/fav.js");
const FRONT = read("js/frontend.js");
const COMMON = read("js/common.js");
const ADMIN = read("js/admin.js");

ok("rank.js 有 syncUrl", /function syncUrl\(\)/.test(RANK));
ok("rank.js 在 renderBar 里调用 syncUrl（不是只定义不用）",
  /function renderBar\(\)\s*\{[\s\S]{0,200}?syncUrl\(\);/.test(RANK));
ok("rank.js 的 syncUrl 写入 mode / cat / sites / periods / cats",
  ["\"mode\"", "\"cat\"", "\"sites\"", "\"periods\"", "\"cats\""].every((k) => RANK.indexOf("q.set(" + k) >= 0));
ok("rank.js 用 replaceState（不产生历史记录）", /history\.replaceState/.test(RANK));

ok("plus.js 有 syncUrl / readUrl", /function syncUrl\(\)/.test(PLUS) && /function readUrl\(\)/.test(PLUS));
ok("plus.js 在 fillSelects 里同步地址栏", /function fillSelects\(\)\s*\{[\s\S]{0,80}?syncUrl\(\);/.test(PLUS));
ok("plus.js 启动时先 readUrl 再渲染", /await loadFacets\(\);[\s\S]{0,200}?readUrl\(\);/.test(PLUS));
ok("plus.js 记住期次 / 类目 / 站点 / 解锁 / 只看机会",
  ["\"plus\"", "\"std\"", "\"cat\"", "\"site\"", "\"unlock\"", "\"gap\""].every((k) => PLUS.indexOf("q.set(" + k) >= 0));

ok("fav.js 有 syncUrl / readUrl", /function syncUrl\(\)/.test(FAV) && /function readUrl\(\)/.test(FAV));
ok("fav.js 的 render 里同步地址栏", /function render\(\)\s*\{[\s\S]{0,120}?syncUrl\(\);/.test(FAV));
ok("fav.js 启动时 readUrl", /async function boot\(\)\s*\{\s*readUrl\(\);/.test(FAV));
ok("fav.js 记住分类与二分类", FAV.indexOf('q.set("f"') >= 0 && FAV.indexOf('q.set("sub"') >= 0);

ok("frontend.js 有 syncUrl / readUrl", /function syncUrl\(\)/.test(FRONT) && /function readUrl\(\)/.test(FRONT));
ok("frontend.js 在 renderGrid 里同步地址栏", /async function renderGrid\(setCat\)\s*\{[\s\S]{0,160}?syncUrl\(\);/.test(FRONT));
ok("frontend.js 在 loadGallery 开头恢复地址栏", /async function loadGallery\(\)\s*\{\s*readUrl\(\);/.test(FRONT));

ok("admin.js 有 rememberPanel / recallPanel", /function rememberPanel\(/.test(ADMIN) && /function recallPanel\(/.test(ADMIN));
ok("admin.js 切换面板时记住目标", /rememberPanel\(target\)/.test(ADMIN));
ok("admin.js 进入后台时先看记忆再决定默认面板", /recallPanel\(\)/.test(ADMIN) && /usable/.test(ADMIN));
ok("admin.js 恢复到图片管理时不自动弹智能打标",
  /openSmartModal\(\)/.test(ADMIN) &&
  /defaultTarget === "manage-card" && !\(memo && memo\.target === "manage-card"\)/.test(ADMIN));
ok("admin.js 记忆只认有权访问的面板（canAccessPanel 守卫）",
  /usable = navEl && !navEl\.classList\.contains\("hidden"\) && canAccessPanel\(memo\.target\)/.test(ADMIN));

ok("common.js 有刷新归位（页面护送）", /refreshEscort/.test(COMMON));
ok("归位只在 reload 时触发（点导航不会被弹走）", /nav\.type === "reload"/.test(COMMON));
ok("归位只作用于首页且要求没带参数/锚点", /!location\.search && !location\.hash/.test(COMMON));
ok("归位用 replace 不污染后退栈", /location\.replace\(last\)/.test(COMMON));

/* ---------------- ② 行为：用 jsdom 真跑 ---------------- */
let JSDOM = null;
try { JSDOM = require("jsdom").JSDOM; } catch (e) {
  try { JSDOM = require(path.resolve(ROOT, "../testdeps/node_modules/jsdom")).JSDOM; } catch (e2) { JSDOM = null; }
}
if (!JSDOM) {
  console.log("  ! 未找到 jsdom，跳过行为校验（结构校验已通过）");
} else {
  /* --- (a) 榜单页：改类目后地址栏真的变了 --- */
  const rankSrc = read("js/rank.js");
  // 直接抽 syncUrl 的实现来跑：它只依赖 MODE/CAT/SEL_*/SIZE 与 location
  const m = rankSrc.match(/function syncUrl\(\)\s*\{[\s\S]*?\n  \}/);
  ok("能取到 rank.js 的 syncUrl 实现", !!m);
  if (m) {
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://x.test/rank.html?mode=v" });
    const w = dom.window;
    const factory = new Function("window", "location", "history", "URLSearchParams", "MODE", "CAT", "SEL_SITES", "SEL_GROUP", "SEL_PERIODS", "SEL_CATS", "SIZE", "ALL", `
      ${m[0]}
      syncUrl();
      return location.search;
    `);
    const qs = factory(w, w.location, w.history, w.URLSearchParams,
      "c", "卫衣", ["美国"], "", ["W42", "W43"], ["卫衣", "裤装"], "m", "全部");
    const p = new URLSearchParams(qs);
    ok("榜单：mode 写进地址栏", p.get("mode") === "c", qs);
    ok("榜单：类目写进地址栏", p.get("cat") === "卫衣");
    ok("榜单：类目对比勾选写进地址栏且顺序保留", p.get("cats") === "卫衣,裤装", p.get("cats"));
    ok("榜单：期次写进地址栏", p.get("periods") === "W42,W43");
    ok("榜单：尺寸写进地址栏", p.get("size") === "m");
    ok("榜单：类目为「全部」时不写 cat（保持地址干净）", (() => {
      const d2 = new JSDOM("<!doctype html><body></body>", { url: "https://x.test/rank.html" });
      const f2 = new Function("window", "location", "history", "URLSearchParams", "MODE", "CAT", "SEL_SITES", "SEL_GROUP", "SEL_PERIODS", "SEL_CATS", "SIZE", "ALL", `
        ${m[0]}
        syncUrl();
        return location.search;
      `);
      const q2 = f2(d2.window, d2.window.location, d2.window.history, d2.window.URLSearchParams,
        "v", "全部", [], "", [], [], "m", "全部");
      return new URLSearchParams(q2).get("cat") === null;
    })());
  }

  /* --- (b) 大码页：带参数的地址能恢复回状态 --- */
  const pm = PLUS.match(/function readUrl\(\)\s*\{[\s\S]*?\n  \}/);
  ok("能取到大码页的 readUrl 实现", !!pm);
  if (pm) {
    const dom = new JSDOM("<!doctype html><body></body>", {
      url: "https://x.test/plus.html?plus=W43&std=W42&cat=裤装&site=美国&unlock=1&gap=1"
    });
    const w = dom.window;
    const ST = { cat: "", plusPeriod: "", stdPeriod: "", site: "", unlock: false, onlyGap: false, onlyReview: false };
    const f = new Function("window", "location", "URLSearchParams", "ST", `
      ${pm[0]}
      readUrl();
    `);
    f(w, w.location, w.URLSearchParams, ST);
    ok("大码：期次恢复", ST.plusPeriod === "W43");
    ok("大码：标码期次恢复且自动解锁", ST.stdPeriod === "W42" && ST.unlock === true);
    ok("大码：类目恢复", ST.cat === "裤装");
    ok("大码：站点恢复", ST.site === "美国");
    ok("大码：只看大码机会恢复", ST.onlyGap === true);
  }

  /* --- (c) 收藏页：分类 + 二分类恢复 --- */
  const fm = FAV.match(/function readUrl\(\)\s*\{[\s\S]*?\n  \}/);
  ok("能取到收藏页的 readUrl 实现", !!fm);
  if (fm) {
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://x.test/fav.html?f=c12&sub=top&flat=W43,W42" });
    const w = dom.window;
    const ST = { filter: "", sub: "", flat: {} };
    const f = new Function("window", "location", "URLSearchParams", "ST", `
      ${fm[0]}
      readUrl();
    `);
    f(w, w.location, w.URLSearchParams, ST);
    ok("收藏：分类恢复", ST.filter === "c12");
    ok("收藏：二分类恢复", ST.sub === "top");
    ok("收藏：平铺的周恢复", ST.flat.W43 === true && ST.flat.W42 === true);
  }

  /* --- (d) 首页护送：刷新时回原页，点击导航时不弹走 --- */
  const gm = COMMON.match(/\(function refreshEscort\(\)\s*\{[\s\S]*?\n\}\)\(\);/);
  ok("能取到 refreshEscort 实现", !!gm);
  if (gm) {
    const run = (url, opts) => {
      const u = new URL(url);
      const store = Object.assign({}, opts.store || {});
      const sessionStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
      };
      const performance = { getEntriesByType: () => [{ type: opts.type }] };
      let moved = null;
      // location 用纯对象桩：jsdom 的真实 Location 不可赋值，也不该被测试改写
      const location = {
        pathname: u.pathname, search: u.search, hash: u.hash,
        replace: (t) => { moved = t; }
      };
      const f = new Function("window", "location", "sessionStorage", "performance", "document", `
        ${gm[0]}
      `);
      f({}, location, sessionStorage, performance, {});
      return { moved, store };
    };

    const a = run("https://x.test/index.html", { type: "reload", store: { nl_last_page: "rank.html?mode=c&cat=卫衣" } });
    ok("首页刷新 → 送回刷新前那一页（带原参数）", a.moved === "rank.html?mode=c&cat=卫衣", String(a.moved));

    const b = run("https://x.test/index.html", { type: "navigate", store: { nl_last_page: "rank.html" } });
    ok("点导航主动回首页 → 不被弹走", b.moved === null, String(b.moved));

    const c2 = run("https://x.test/index.html?zone=visual", { type: "reload", store: { nl_last_page: "rank.html" } });
    ok("首页带显式参数刷新 → 尊重参数不跳", c2.moved === null, String(c2.moved));

    const d = run("https://x.test/index.html", { type: "reload", store: { nl_last_page: "index.html" } });
    ok("上次就在首页 → 不重复跳（避免循环）", d.moved === null, String(d.moved));

    const e = run("https://x.test/index.html", { type: "reload", store: { nl_last_page: "evil.html" } });
    ok("只认白名单内的页面（不会被外部地址带走）", e.moved === null, String(e.moved));

    const g = run("https://x.test/plus.html?cat=%E8%A3%A4%E8%A3%85", { type: "reload" });
    ok("其它页面加载时把自己记下来", g.store.nl_last_page === "plus.html?cat=%E8%A3%A4%E8%A3%85", String(g.store.nl_last_page));
  }
}

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败\n");
process.exit(fail ? 1 : 0);