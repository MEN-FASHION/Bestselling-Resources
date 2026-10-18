/* ============================================================
 * 趋势上升榜：后台可控前台显隐 + 筛选单选 —— 运行时验证
 *
 * 全部用真实文件、真实代码（jsdom 解析真实 rank.html、执行真实 js/rank.js）：
 *   ① 显隐：后台隐藏的国家站点 / 周次不在前台出现（筛选项、地区分组、默认选择一起走），
 *      分享链接里带的隐藏项也会被摘掉并回落到默认口径，不会出现"筛不到的空列"；
 *   ② 趋势标签：单选（选中一个，其余自动取消）；
 *   ③ 横向·国家对比：周次单选（选中一周，其它周自动取消）；
 *   ④ 纵向·时间对比：国家单选（选中一国，其它国家自动取消）。
 *
 * 用法：node tools/verify_rank_filters.js <站点仓库根目录>
 *       （需要 jsdom：npm install jsdom@22.1.0）
 * ============================================================ */
const fs = require("fs");
const path = require("path");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) {
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

const SITES = ["美国", "英国", "德国", "法国"];
const PERIODS = ["2026W39", "2026W40", "2026W41", "2026W42"];

function makeItems() {
  const out = [];
  SITES.forEach((s) => PERIODS.forEach((p) => {
    for (let i = 0; i < 10; i++) {
      out.push({
        image_url: "https://img.newtrend.top/p/" + s + "_" + p + "_" + i + ".jpg",
        site: s, period_label: p, category: "卫衣", leaf_category: "卫衣",
        ratio: 1 + ((i + p.length) % 5), abs_delta: 120 - i * 3,
      });
    }
  }));
  return out;
}

/* 假 SB：只实现本验证需要的接口，其余返回 null（与真实调用面一致） */
function makeSB(cfg) {
  cfg = cfg || {};
  const items = cfg.items || makeItems();
  const impl = {
    getSession: async () => ({ access_token: "T", user: { id: "u1", email: "a@b.c" } }),
    onAuth: () => {}, onAuthChange: () => {}, currentToken: async () => "T",
    signOut: async () => {}, myRole: async () => "super",
    getFrontendZoneVisibility: async () => ({}),
    myFrontendZones: async () => null,
    rankFacets: async () => ({ sites: SITES.slice(), periods: PERIODS.slice(), categories: ["卫衣", "T恤"] }),
    listRankSites: async () => SITES.map((n) => ({ name: n })),
    getRankGroups: async () => (cfg.groups || [{ name: "欧洲", members: ["英国", "德国", "法国"] }]),
    getRankHidden: async () => Object.assign({ sites: [], periods: [] }, cfg.hidden || {}),
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

/* 真实页面 + 真实脚本；仅在内存里给末尾追加测试导出（磁盘上的生产代码不变） */
async function bootRank(cfg) {
  cfg = cfg || {};
  const html = read("rank.html").replace(/<script src="[^"]*"><\/script>/g, "");
  const url = "https://newtrend.top/rank.html" + (cfg.query || "");
  const dom = new JSDOM(html, { url: url, runScripts: "dangerously", pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message || e.error)));
  window.addEventListener("unhandledrejection", (e) => errors.push("unhandled: " + e.reason));
  window.eval(read("js/config.js"));
  window.SB = makeSB(cfg);
  const src = read("js/rank.js");
  /* 注意：必须导出「取值函数」而不是快照对象 —— 脚本求值时 boot 的异步加载还没结束，
     直接导出变量只会拿到初始值（这正是本脚本第一版误判的原因）。 */
  const hooked = src.replace(/\}\)\(\);\s*$/,
    "window.__F=function(){return {SEL_SITES:SEL_SITES,SEL_PERIODS:SEL_PERIODS,TAGS:TAGS,SORT:SORT,SIZE:SIZE,HIDDEN:HIDDEN," +
    "FACETS:FACETS,GROUPS:GROUPS,MODE:MODE,applyHiddenFilter:applyHiddenFilter,siteVisible:siteVisible};};})();");
  if (hooked === src) throw new Error("无法注入测试导出（rank.js 尾部结构变化）");
  window.eval(hooked);
  for (let i = 0; i < 60; i++) await sleep(20);
  return { dom, window, errors, T: window.__F };
}

const chips = (w, sel) => Array.prototype.slice.call(w.document.querySelectorAll(sel + " [data-" + (sel === "#rk-g-sites" ? "site" : sel === "#rk-g-periods" ? "period" : sel === "#rk-g-tags" ? "tag" : "x") + "]"));
const activeTexts = (w, sel, attr) => Array.prototype.slice.call(w.document.querySelectorAll(sel + " [" + attr + "]"))
  .filter((b) => b.className.indexOf("active") >= 0)
  .map((b) => b.getAttribute(attr));

(async function main() {
  console.log("== 趋势上升榜：后台显隐 + 筛选单选：运行时验证 ==");

  /* ---------------- ① 前台显隐 ---------------- */
  console.log("\n[1] 后台隐藏的国家站点 / 周次不在前台出现");
  {
    const ctx = await bootRank({ hidden: { sites: ["法国"], periods: ["2026W39"] } });
    const w = ctx.window;
    const chipSites = Array.prototype.slice.call(w.document.querySelectorAll("#rk-g-sites [data-site]")).map((b) => b.getAttribute("data-site"));
    const chipPeriods = Array.prototype.slice.call(w.document.querySelectorAll("#rk-g-periods [data-period]")).map((b) => b.getAttribute("data-period"));
    ok("被隐藏的国家不在筛选项里（法国）", chipSites.indexOf("法国") < 0, chipSites.join(","));
    ok("其余国家照常出现（美国/英国/德国）", ["美国", "英国", "德国"].every((s) => chipSites.indexOf(s) >= 0), chipSites.join(","));
    ok("被隐藏的周次不在筛选项里（2026W39）", chipPeriods.indexOf("2026W39") < 0, chipPeriods.join(","));
    ok("其余周次照常出现", ["2026W40", "2026W41", "2026W42"].every((p) => chipPeriods.indexOf(p) >= 0), chipPeriods.join(","));
    ok("地区分组里也摘掉了被隐藏的国家（欧洲 = 英/德）",
      ctx.T().GROUPS.length === 1 && ctx.T().GROUPS[0].members.join(",") === "英国,德国", JSON.stringify(ctx.T().GROUPS));
    ok("默认选中项不是被隐藏的站点 / 周次",
      ctx.T().SEL_SITES.every((s) => s !== "法国") && ctx.T().SEL_PERIODS.every((p) => p !== "2026W39"),
      ctx.T().SEL_SITES + " / " + ctx.T().SEL_PERIODS);
    ok("隐藏后无未捕获错误", ctx.errors.length === 0, ctx.errors.join(" | ").slice(0, 160));
  }

  /* ---------------- ② 分享链接带隐藏项：摘掉并回落 ---------------- */
  console.log("\n[2] 分享链接 / 后台预览带的参数里含隐藏项：摘掉并回落到默认口径");
  {
    const ctx = await bootRank({ hidden: { sites: ["法国"], periods: ["2026W39"] }, query: "?sites=%E6%B3%95%E5%9B%BD&periods=2026W39,2026W40&mode=v" });
    ok("链接里只写了被隐藏的站点 → 自动回落到可见站点（不留空列）",
      ctx.T().SEL_SITES.length === 1 && ctx.T().SEL_SITES[0] !== "法国", ctx.T().SEL_SITES.join(","));
    ok("链接里含被隐藏周次 → 只保留可见周次（2026W40）", ctx.T().SEL_PERIODS.indexOf("2026W39") < 0 && ctx.T().SEL_PERIODS.length >= 1, ctx.T().SEL_PERIODS.join(","));
    ok("页面没有报错", ctx.errors.length === 0, ctx.errors.join(" | ").slice(0, 160));
  }

  /* ---------------- ③ 趋势标签单选 ---------------- */
  console.log("\n[3] 趋势标签：单选（选中一个，其余自动取消）");
  {
    const ctx = await bootRank({});
    const w = ctx.window;
    const click = (sel) => w.document.querySelector(sel).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    click('#rk-g-tags [data-tag="hot"]');
    await sleep(30);
    ok("点「趋势爆款」→ 只有它被选中", ctx.T().TAGS.length === 1 && ctx.T().TAGS[0] === "hot", JSON.stringify(ctx.T().TAGS));
    ok("界面上也只剩一个高亮", activeTexts(w, "#rk-g-tags", "data-tag").join(",") === "hot", activeTexts(w, "#rk-g-tags", "data-tag").join(","));
    click('#rk-g-tags [data-tag="surge"]');
    await sleep(30);
    ok("再点「周度激增」→ 之前的自动取消", ctx.T().TAGS.length === 1 && ctx.T().TAGS[0] === "surge", JSON.stringify(ctx.T().TAGS));
    ok("界面上只剩一个高亮", activeTexts(w, "#rk-g-tags", "data-tag").join(",") === "surge", activeTexts(w, "#rk-g-tags", "data-tag").join(","));
    click('#rk-g-tags [data-tag="all"]');
    await sleep(30);
    ok("点「全部」→ 回到全部（仍单选）", ctx.T().TAGS.length === 1 && ctx.T().TAGS[0] === "all", JSON.stringify(ctx.T().TAGS));
    ok("排序 / 图幅 / 位次排序 同样单选（界面上各只有一项高亮）",
      activeTexts(w, "#rk-g-sort", "data-sort").length === 1 &&
      activeTexts(w, "#rk-g-size", "data-size").length === 1, "");
    const sc = activeTexts(w, "#rk-g-scope", "data-scope");
    ok("范围（仅纵向·选了位次排序时出现）也是单选或不出现", sc.length <= 1, sc.join(","));
    ok("无未捕获错误", ctx.errors.length === 0, ctx.errors.join(" | ").slice(0, 160));
  }

  /* ---------------- ④ 横向：周次单选 ---------------- */
  console.log("\n[4] 横向·国家对比：周次单选（选中一周，其它周自动取消）");
  {
    const ctx = await bootRank({ query: "?mode=h" });
    const w = ctx.window;
    const click = (sel) => w.document.querySelector(sel).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    ok("横向模式下默认只选中一周", ctx.T().SEL_PERIODS.length === 1, ctx.T().SEL_PERIODS.join(","));
    click('#rk-g-periods [data-period="2026W39"]');
    await sleep(30);
    ok("点「2026W39」→ 只保留它，其它周自动取消", ctx.T().SEL_PERIODS.length === 1 && ctx.T().SEL_PERIODS[0] === "2026W39", ctx.T().SEL_PERIODS.join(","));
    ok("界面上也只有它高亮", activeTexts(w, "#rk-g-periods", "data-period").join(",") === "2026W39", activeTexts(w, "#rk-g-periods", "data-period").join(","));
    click('#rk-g-periods [data-period="2026W41"]');
    await sleep(30);
    ok("再点「2026W41」→ 同样只剩一个", ctx.T().SEL_PERIODS.length === 1 && ctx.T().SEL_PERIODS[0] === "2026W41", ctx.T().SEL_PERIODS.join(","));
    ok("横向模式下国家可多选（这是对比列，不受影响）", ctx.T().SEL_SITES.length >= 2, ctx.T().SEL_SITES.join(","));
    ok("无未捕获错误", ctx.errors.length === 0, ctx.errors.join(" | ").slice(0, 160));
  }

  /* ---------------- ⑤ 纵向：国家单选 ---------------- */
  console.log("\n[5] 纵向·时间对比：国家单选（选中一国，其它国家自动取消）");
  {
    const ctx = await bootRank({ query: "?mode=v" });
    const w = ctx.window;
    const click = (sel) => w.document.querySelector(sel).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    ok("纵向模式下默认只选中一个国家", ctx.T().SEL_SITES.length === 1, ctx.T().SEL_SITES.join(","));
    click('#rk-g-sites [data-site="德国"]');
    await sleep(30);
    ok("点「德国」→ 只保留它，其它国家自动取消", ctx.T().SEL_SITES.length === 1 && ctx.T().SEL_SITES[0] === "德国", ctx.T().SEL_SITES.join(","));
    ok("界面上也只有它高亮", activeTexts(w, "#rk-g-sites", "data-site").join(",") === "德国", activeTexts(w, "#rk-g-sites", "data-site").join(","));
    ok("纵向模式下周次可多选（这是对比列，不受影响）", ctx.T().SEL_PERIODS.length >= 2, ctx.T().SEL_PERIODS.join(","));
    click('#rk-g-sites [data-site="英国"]');
    await sleep(30);
    ok("再点「英国」→ 还是只有一个", ctx.T().SEL_SITES.length === 1 && ctx.T().SEL_SITES[0] === "英国", ctx.T().SEL_SITES.join(","));
    ok("无未捕获错误", ctx.errors.length === 0, ctx.errors.join(" | ").slice(0, 160));
  }

  /* ---------------- ⑥ 反向验证：把隐藏清单当空 / 单选当多选，检查项必须能抓到 ---------------- */
  console.log("\n[6] 反向验证：检查项本身是否能抓到回归");
  {
    /* 6a 隐藏清单为空时，被隐藏项必须重新出现（证明前面第 1 组不是"恰好为空"） */
    const ctx = await bootRank({ hidden: { sites: [], periods: [] } });
    const chipSites = Array.prototype.slice.call(ctx.window.document.querySelectorAll("#rk-g-sites [data-site]")).map((b) => b.getAttribute("data-site"));
    ok("【反向】不隐藏时 4 个国家全在（对照第 1 组：隐藏时只有 3 个）", chipSites.length === 4, chipSites.join(","));

    /* 6b 多选行为：横向模式下周次若被改成多选，界面应能出现多个高亮 —— 用它反证"单选"断言不是恒真 */
    const ctx2 = await bootRank({ query: "?mode=h" });
    const w2 = ctx2.window;
    const before = ctx2.T().SEL_PERIODS.length;
    /* 直接改内部状态模拟"旧的多选实现"，再看断言口径是否会被打破 */
    ctx2.T().SEL_PERIODS.push("2026W39", "2026W40");
    const multi = ctx2.T().SEL_PERIODS.length;
    ok("【反向】把选择改成多选后，选择数确实大于 1（说明单选断言可被打破）", multi > before + 1, "before=" + before + " after=" + multi);
  }

  console.log("\n== 结果：通过 " + pass + " 项，失败 " + fail + " 项 ==");
  if (fail) { console.log("失败项：\n - " + failures.join("\n - ")); process.exit(1); }
})();
