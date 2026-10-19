/* 临时诊断：看纵向列到底拿没拿到"上一周"的数据 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const ROOT = process.argv[2] || ".";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mk(p, name, ratio) {
  return { image_url: "https://img.newtrend.top/" + p + "_" + name + ".jpg", site: "美国",
    period_label: p, category: "卫衣", leaf_category: "卫衣", ratio: ratio, abs_delta: ratio };
}
const items = [
  mk("2026W40", "A", 5), mk("2026W40", "B", 3), mk("2026W40", "C", 1),
  mk("2026W41", "B", 6), mk("2026W41", "A", 4), mk("2026W41", "D", 2),
];

(async function () {
  const html = read("rank.html").replace(/<script src="[^"]*"><\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://newtrend.top/rank.html?mode=v&sites=%E7%BE%8E%E5%9B%BD&periods=2026W40,2026W41", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  const calls = [];
  w.eval(read("js/config.js"));
  w.SB = new Proxy({
    getSession: async () => ({ access_token: "T", user: { id: "u1" } }),
    onAuth: () => {}, onAuthChange: () => {}, currentToken: async () => "T",
    myRole: async () => "super_admin",
    getFrontendZoneVisibility: async () => ({}), myFrontendZones: async () => null,
    rankFacets: async () => ({ sites: ["美国"], periods: ["2026W40", "2026W41", "2026W42"], categories: ["卫衣"] }),
    listRankSites: async () => [{ name: "美国" }],
    getRankGroups: async () => [], getRankHidden: async () => ({ sites: [], periods: [] }),
    listRankItems: async (f) => { calls.push(JSON.stringify(f)); return items.filter((it) => !f.periods || f.periods.indexOf(it.period_label) >= 0); },
  }, { get(t, k) { if (k in t) return t[k]; if (typeof k !== "string") return undefined; return async () => null; } });
  const src = read("js/rank.js");
  w.eval(src.replace(/\}\)\(\);\s*$/, "window.__F=function(){return {SEL_PERIODS:SEL_PERIODS,FACETS:FACETS,CACHE:CACHE,prevOfPeriod:prevOfPeriod,withBasePeriods:withBasePeriods};};})();"));
  for (let i = 0; i < 90; i++) await sleep(20);
  console.log("SB 调用参数：", calls.join("  ||  "));
  console.log("选中期次：", JSON.stringify(w.__F().SEL_PERIODS));
  console.log("FACETS.periods：", JSON.stringify(w.__F().FACETS.periods));
  console.log("prevOfPeriod(2026W41) =", w.__F().prevOfPeriod("2026W41"));
  console.log("basePeriods =", JSON.stringify(w.__F().withBasePeriods(w.__F().SEL_PERIODS)));
  const cache = w.__F().CACHE;
  console.log("CACHE.key =", cache && cache.key);
  const byP = {};
  ((cache && cache.items) || []).forEach((it) => { byP[it.period_label] = (byP[it.period_label] || 0) + 1; });
  console.log("CACHE 各期条数：", JSON.stringify(byP));
  Array.prototype.forEach.call(w.document.querySelectorAll(".rk-pool"), (p) => {
    const meta = p.querySelector(".rk-pool-meta") || p;
    console.log("列：", (meta.textContent || "").trim().slice(0, 60), "｜卡片:", p.querySelectorAll(".rk-card").length);
  });
})();