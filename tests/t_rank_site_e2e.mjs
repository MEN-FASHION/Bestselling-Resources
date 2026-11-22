/* 20261113D · 真跑一遍前台榜单页（不是查字符串，是把 rank.js 启动流程完整执行）
   ---------------------------------------------------------------
   背景：线上出现「后台传完数据，前台某组合整片空白」。
   根因是站点名对不上：库里写「美国站 / US」，菜单里是「美国」。

   本文件用一个极简 DOM 桩 + 假数据层，把 rank.js 的 boot() 真跑一次，
   断言页面最终画出了图片列、而不是空态。同时跑一次「关掉归一」的对照组，
   证明这个用例确实能抓到该缺陷（否则等于没测）。
*/
import fs from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log("  ✓ " + n); }
  else { fail++; console.log("  ✗ " + n, extra === undefined ? "" : "→ " + JSON.stringify(extra)); }
};
const R = (p) => fs.readFileSync(p, "utf8");

function el(tag) {
  return {
    tagName: (tag || "div").toUpperCase(), style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    innerHTML: "", textContent: "", value: "", checked: false, disabled: false,
    options: [], selectedIndex: 0,
    offsetHeight: 600, offsetWidth: 1200, clientHeight: 600, clientWidth: 1200,
    scrollHeight: 600, scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 1200, bottom: 600, width: 1200, height: 600 }),
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    removeAttribute() {}, hasAttribute() { return false; },
    focus() {}, blur() {}, click() {}, scrollIntoView() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, cloneNode() { return el(tag); }, contains() { return false; },
    insertAdjacentHTML() {}, replaceWith() {}, matches() { return false; },
    set onchange(v) {}, set onclick(v) {},
  };
}

/* 起一个沙箱，跑真实脚本，返回 { html, text, errors } */
async function runPage(opts) {
  opts = opts || {};
  const doc = {
    readyState: "complete",
    location: { href: "http://localhost/rank.html", search: opts.search || "", hash: "", pathname: "/rank.html" },
    addEventListener() {}, removeEventListener() {},
    createElement(t) { return el(t); }, createTextNode(t) { return { nodeValue: t }; },
    _memo: {},
    querySelector(sel) { return this._memo[sel] || (this._memo[sel] = el(sel)); },
    querySelectorAll() { return []; },
    getElementById(id) { return this.querySelector("#" + id); },
    body: el("body"), head: el("head"), documentElement: el("html"), cookie: "",
  };
  const store = {};
  const win = {
    document: doc, location: doc.location, navigator: { userAgent: "node", language: "zh-CN" },
    addEventListener() {}, removeEventListener() {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    alert() {}, confirm() { return true; }, prompt() { return ""; },
    URLSearchParams, URL, JSON, Math, Date, Promise, console,
    fetch: async () => ({ ok: true, status: 200, json: async () => [], text: async () => "" }),
    history: { replaceState() {}, pushState() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "", width: "0px", height: "0px" }),
    requestIdleCallback: () => 0,
  };
  win.__RANK_TEST__ = true;   /* 打开离屏测试钩子，才能读到内部状态 */
  win.window = win; win.self = win; win.globalThis = win; win.top = win;
  const ctx = vm.createContext(win);
  const errors = [];
  const load = (f) => vm.runInContext(R(f), ctx, { filename: f });

  load("vendor/supabase.js");
  if (!opts.noSiteNorm) load("js/site-norm.js");
  load("js/config.js");
  load("js/supabase.js");
  load("js/common.js");

  /* 深拷贝：rank.js 会就地改写条目（it.site = 归一后的名字），
     同一份 items 复用给第二个用例，第二次就成了「已经被归一过」的数据，
     对照组会假装通过 —— 这里必须每次都给一份干净的。 */
  const items = (opts.items || []).map((x) => ({ ...x }));
  const sites = opts.sites || ["美国", "英国"];
  const periods = ["第43周", "第44周", "第45周"];
  const called = [];
  const stub = {
    getSession: async () => ({ user: { id: "u1", email: "qa@example.com" } }),
    currentUser: async () => ({ id: "u1" }),
    signOut: async () => {},
    getFrontendZoneVisibility: async () => ({ rank: true }),
    myFrontendZones: async () => null,
    rankFacetsBySource: async () => ({ sites: sites.slice(), periods: periods.slice(), categories: ["T恤"] }),
    getPatternPrintVisible: async () => true,
    getRankHidden: async () => ({ sites: [], periods: [] }),
    listRankSites: async () => sites.map((n) => ({ name: n })),
    getRankGroups: async () => [],
    listRankItems: async (f) => items.filter((it) =>
      (!f.category || it.category === f.category)
      && (!f.periods || !f.periods.length || f.periods.indexOf(it.period_label) >= 0)),
    listImageTags: async () => ({}),
    rankImageTags: async () => ({}),
    listRankTagHistory: async () => [],
    listRankTagBatches: async () => [],
    myRole: async () => "viewer",
    isAdmin: async () => false,
    getFavorites: async () => [],
    isFavorite: async () => false,
  };
  const SBREF = vm.runInContext("typeof SB !== 'undefined' ? SB : null", ctx);
  if (SBREF) {
    Object.keys(stub).forEach((k) => {
      const fn = stub[k];
      SBREF[k] = (...a) => { called.push(k); return fn(...a); };
    });
  }
  try { load(opts.rankPath || "js/rank.js"); } catch (e) { errors.push("rank.js 加载失败: " + (e && e.message)); }
  await new Promise((r) => setTimeout(r, 700));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 700));
  const body = doc._memo["#rk-body"];
  return { html: (body && body.innerHTML) || "", errors, called, ctx };
}

/* 「本视图共 N 张」是取回的总条数，不随站点筛选变化；
   真正该断言的是「页面上画出了多少张卡片」。 */
const nOf = (html) => (html.match(/class="rk-card/g) || []).length;

const mk = (p, site, i) => ({
  id: i, period_label: p, period_type: "week", category: "T恤", site,
  image_url: "https://img.example.com/t/" + encodeURIComponent(site) + "-" + p + "-" + i + ".jpg",
  title: "Vintage Striped Tee " + i, ratio: 10 + i, abs_delta: 100 + i,
  source: "rank", leaf_category: "T恤",
});

/* 场景一：库里站点写成三种样子，菜单里只有「美国」 */
const ITEMS_MIXED = [];
[["第43周", "美国站"], ["第44周", "US"], ["第45周", "美国"]].forEach(([p, s], k) => {
  for (let i = 0; i < 5; i++) ITEMS_MIXED.push(mk(p, s, k * 10 + i));
});

console.log("一、站点写法不一致时，页面必须照常出图（真实跑一遍）");
{
  const r = await runPage({ items: ITEMS_MIXED });
  ok("脚本加载与启动无异常", r.errors.length === 0, r.errors);
  ok("真的去取了榜单数据", r.called.indexOf("listRankItems") >= 0, r.called);
  ok("页面不是空态", !/暂无榜单数据/.test(r.html));
  ok("画出了对比池", /rk-pool/.test(r.html), r.html.slice(0, 120));
  ok("三周各出一列（列名各出现一次）", (r.html.match(/rk-pool-name/g) || []).length === 3,
    (r.html.match(/rk-pool-name/g) || []).length);
  ok("15 张图全部显示（没有被站点名过滤掉）", nOf(r.html) === 15, nOf(r.html));
}

console.log("二、对照组：关掉站点归一 → 同一份数据被静默过滤（证明用例抓得住缺陷）");
{
  const SEL = "?sites=" + encodeURIComponent("美国") + "&periods=" + encodeURIComponent("第43周,第44周,第45周");
  const withFix = await runPage({ items: ITEMS_MIXED, search: SEL });
  const noFix = await runPage({ items: ITEMS_MIXED, noSiteNorm: true, search: SEL });
  ok("修复后：选「美国」能看到三种写法的 15 张", nOf(withFix.html) === 15, nOf(withFix.html));
  ok("修复后：不出现「已按全部站点显示」的降级提示", !/已按全部站点显示/.test(withFix.html));
  ok("对照（旧逻辑）：只剩写法完全等于「美国」的 5 张", nOf(noFix.html) === 5, nOf(noFix.html));
  ok("对照确实少于修复后 → 本用例抓得住该缺陷", nOf(noFix.html) < nOf(withFix.html),
    [nOf(noFix.html), nOf(withFix.html)]);
}

console.log("三、所选站点真的没数据时：按全部站点显示并写明原因");
{
  const onlyUK = [mk("第43周", "英国", 1), mk("第44周", "英国站", 2), mk("第45周", "UK", 3)];
  const r = await runPage({
    items: onlyUK,
    sites: ["美国", "英国"],
    search: "?sites=" + encodeURIComponent("美国") + "&periods=" + encodeURIComponent("第43周,第44周,第45周"),
  });
  ok("没有变成空白页", !/暂无榜单数据/.test(r.html), r.html.slice(0, 160));
  ok("写出了「所选站点没数据，已按全部站点显示」", /已按全部站点显示/.test(r.html));
  ok("英国的三张图照常可见", nOf(r.html) === 3, nOf(r.html));
}

console.log("四、库里一条都没有时：空态把查询条件摊开写清楚");
{
  const r = await runPage({ items: [] });
  ok("给出空态", /暂无榜单数据/.test(r.html));
  ok("解释可能原因（专区 / 期次写法 / 站点名）", /传到别的专区了/.test(r.html) && /期次写法不同/.test(r.html) && /站点名对不上/.test(r.html));
  ok("写出实际查到的条数与当前选择", /本次实际取到/.test(r.html) && /当前选择：类目/.test(r.html));
  ok("没有运行期异常", r.errors.length === 0, r.errors);
}

if (process.env.PEEK) { const r = await runPage({ items: ITEMS_MIXED }); console.log(r.html.slice(0, 3000)); }
console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
