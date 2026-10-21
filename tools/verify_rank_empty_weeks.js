/* ============================================================
 * 趋势上升榜：周次 / 国家不齐时不出空列，剩余列铺满宽度 —— 运行时验证
 *
 * 真实痛点：类目 A 只有 40 周，但对比列数选了 3 列 → 旧版补出 40/41/42，
 * 41、42 是空列；横向国家对比时某国没上传，同样留一个空列。
 *
 * 现要求：没有数据的列整列不输出，剩余列由 flex 均分铺满
 *（1 列 = 整行、2 列 = 两等分）；纵向只比当前国家的周次，别国数据不凑列。
 *
 * 用法：node tools/verify_rank_empty_weeks.js <仓库根目录>
 * ============================================================ */
const fs = require("fs");
const path = require("path");
let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) { console.error("需要先安装 jsdom"); process.exit(2); }

const ROOT = process.argv[2] || ".";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  \u2713 " + n); } else { fail++; console.log("  \u2717 " + n + (x ? "  [" + x + "]" : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITES = ["美国", "英国"];
const PERIODS = ["2026W40", "2026W41", "2026W42"];
const CATS = ["卫衣", "T恤", "鞋"];

/* 数据刻意不齐：
   美国：卫衣@40、T恤@40、T恤@41
   英国：卫衣@41、T恤@40            ← 用来验证"别国数据不会凑出列" */
function items() {
  const out = [];
  const add = (site, cat, period, n) => {
    for (let i = 0; i < n; i++) out.push({
      image_url: "https://img.newtrend.top/p/" + site + cat + period + i + ".jpg",
      site, period_label: period, category: cat, leaf_category: cat,
      ratio: 1 + i, abs_delta: 100 - i * 3,
    });
  };
  add("美国", "卫衣", "2026W40", 5);
  add("美国", "卫衣", "2026W42", 5);
  add("美国", "T恤", "2026W40", 5);
  add("美国", "T恤", "2026W41", 5);
  add("美国", "T恤", "2026W42", 5);
  add("英国", "卫衣", "2026W41", 3);
  add("英国", "T恤", "2026W40", 4);
  add("英国", "T恤", "2026W42", 4);
  return out;
}

function makeSB() {
  const rows = items();
  const impl = {
    getSession: async () => ({ access_token: "T", user: { id: "u1", email: "a@b.c" } }),
    myRole: async () => "super",
    getFrontendZoneVisibility: async () => ({}),
    rankFacets: async () => ({ sites: SITES.slice(), periods: PERIODS.slice(), categories: CATS.slice() }),
    listRankSites: async () => SITES.map((n) => ({ name: n })),
    getRankGroups: async () => [{ name: "欧洲", members: ["英国"] }],
    getRankHidden: async () => ({ sites: [], periods: [] }),
    /* 与真实实现同口径：sites / periods / category（单类目）或 categories（全类目） */
    listRankItems: async (f) => {
      f = f || {};
      const s = f.sites || [], p = f.periods || [];
      const cats = f.category ? [f.category] : (f.categories || []);
      return rows.filter((it) =>
        (!s.length || s.indexOf(it.site) >= 0) &&
        (!p.length || p.indexOf(it.period_label) >= 0) &&
        (!cats.length || cats.indexOf(it.category) >= 0));
    },
  };
  return new Proxy(impl, { get(t, k) { if (k in t) return t[k]; if (typeof k !== "string") return undefined; return async () => null; } });
}

async function boot(query) {
  const html = read("rank.html").replace(/<script src="[^"]*"><\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://newtrend.top/rank.html" + (query || ""), runScripts: "dangerously", pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message || e.error)));
  window.addEventListener("unhandledrejection", (e) => errors.push("unhandled: " + e.reason));
  window.eval(read("js/config.js"));
  window.SB = makeSB();
  window.eval(read("js/rank.js"));
  for (let i = 0; i < 70; i++) await sleep(20);
  return { window, errors };
}

const q = (o) => "?" + Object.keys(o).map((k) => k + "=" + encodeURIComponent(o[k])).join("&");
const pools = (w) => Array.prototype.map.call(w.document.querySelectorAll("#rk-pools .rk-pool"), (e) => {
  const h = e.querySelector(".rk-pool-head");
  return h ? h.textContent.replace(/\s+/g, " ").trim() : "";
});
const poolN = (w) => w.document.querySelectorAll("#rk-pools .rk-pool").length;
const emptyN = (w) => w.document.querySelectorAll("#rk-pools .rk-empty").length;
const note = (w) => { const e = w.document.querySelector(".rk-dropnote"); return e ? e.textContent.replace(/\s+/g, " ") : ""; };
const bodyTxt = (w) => (w.document.querySelector("#rk-body").textContent || "").replace(/\s+/g, " ");

(async function main() {
  console.log("== 趋势上升榜：列不齐 → 不出空列、剩余列铺满 ==");

  console.log("\n[1] 纵向：卫衣只有 40 周，选了 40/41 两列 → 只出 1 列");
  {
    const { window: w, errors } = await boot(q({ mode: "v", cat: "卫衣", sites: "美国", periods: "2026W40,2026W41" }));
    ok("只渲染 1 列（不补空列）", poolN(w) === 1, "实际 " + poolN(w));
    ok("没有「该列暂无数据」的空列", emptyN(w) === 0, "空列 " + emptyN(w));
    ok("列标题就是 40 周", /2026W40/.test(pools(w)[0] || ""), (pools(w)[0] || "").slice(0, 40));
    ok("提示条说明隐藏 1 个空列", /已自动隐藏/.test(note(w)) && /1/.test(note(w)), note(w).slice(0, 70));
    ok("提示条写明剩余 1 列已铺满", /剩余/.test(note(w)) && /1/.test(note(w)) && /铺满/.test(note(w)), note(w).slice(0, 90));
    ok("无未捕获错误", errors.length === 0, errors.join(" | ").slice(0, 120));
  }

  console.log("\n[1b] 纵向：选 40/41/42 三列，只有 40 与 42 有数据 → 出 2 列（41 整列消失）");
  {
    const { window: w } = await boot(q({ mode: "v", cat: "卫衣", sites: "美国", periods: "2026W40,2026W41,2026W42" }));
    ok("渲染 2 列", poolN(w) === 2, "实际 " + poolN(w));
    const _heads = pools(w).map((t) => t.slice(0, 7));   /* 只取列标题的周次前缀，避免副标题里的「上一周」误判 */
    ok("中间那个空列（41）不出现", _heads.indexOf("2026W41") < 0, _heads.join(" | "));
    ok("剩下的是 40 与 42", _heads[0] === "2026W40" && _heads[1] === "2026W42", _heads.join(" | "));
    ok("没有空列占位", emptyN(w) === 0, "空列 " + emptyN(w));
    ok("提示条写明隐藏 1 列", /1/.test(note(w)), note(w).slice(0, 60));
  }

  console.log("\n[2] 纵向：T恤 40 + 41 两列都有数据 → 两列都留，不报隐藏");
  {
    const { window: w } = await boot(q({ mode: "v", cat: "T恤", sites: "美国", periods: "2026W40,2026W41" }));
    ok("渲染 2 列", poolN(w) === 2, "实际 " + poolN(w));
    ok("没有空列", emptyN(w) === 0, "空列 " + emptyN(w));
    const ps = pools(w);
    ok("两列分别是 40 / 41 周", /2026W40/.test(ps[0]) && /2026W41/.test(ps[1]), ps.join(" | ").slice(0, 80));
    ok("没有提示条（没丢列）", note(w) === "", note(w).slice(0, 40));
  }

  console.log("\n[3] 纵向：三个周都没有数据 → 空态，不出一排空列");
  {
    const { window: w } = await boot(q({ mode: "v", cat: "鞋", sites: "美国", periods: "2026W40,2026W41,2026W42" }));
    ok("不渲染任何列", poolN(w) === 0, "实际 " + poolN(w));
    ok("给出明确的空态文案", /暂无榜单数据/.test(bodyTxt(w)), bodyTxt(w).slice(0, 40));
  }

  console.log("\n[4] 纵向：同时选了美国+英国，英国只有 41 周 → 不因别国的周次多出一列（双保险）");
  {
    const { window: w } = await boot(q({ mode: "v", cat: "卫衣", sites: "美国,英国", periods: "2026W40,2026W41" }));
    ok("只出 1 列（美国的 40 周）", poolN(w) === 1, "实际 " + poolN(w));
    ok("列标题是 40 周", /2026W40/.test(pools(w)[0] || ""), (pools(w)[0] || "").slice(0, 40));
    ok("页面里不出现英国的 41 周列", !/2026W41/.test(pools(w).join(" | ")), pools(w).join(" | ").slice(0, 60));
  }

  console.log("\n[5] 横向·国家对比：选 2 国但英国这期没上传 → 只出 1 列并说明");
  {
    const { window: w } = await boot(q({ mode: "h", cat: "卫衣", sites: "美国,英国" }));
    ok("只渲染 1 列", poolN(w) === 1, "实际 " + poolN(w));
    ok("没有空列", emptyN(w) === 0, "空列 " + emptyN(w));
    ok("提示条按「国家列」措辞", /国家列/.test(note(w)), note(w).slice(0, 70));
    ok("提示条写明隐藏 1 列", /1/.test(note(w)), note(w).slice(0, 60));
  }

  console.log("\n[6] 横向·国家对比：两国都有数据 → 2 列，一国都不丢");
  {
    const { window: w } = await boot(q({ mode: "h", cat: "T恤", sites: "美国,英国" }));
    ok("渲染 2 列", poolN(w) === 2, "实际 " + poolN(w));
    ok("没有提示条（没丢列）", note(w) === "", note(w).slice(0, 40));
  }

  console.log("\n[7] 布局：剩下几列就铺满几列（不靠固定列数）");
  {
    const css = read("css/style.css");
    const poolsRule = (css.match(/\.rk-pools \{[^}]*\}/) || [""])[0];
    const poolRule = (css.match(/\.rk-pool \{[^}]*\}/) || [""])[0];
    ok(".rk-pools 是 flex 容器", /display:\s*flex/.test(poolsRule), poolsRule.replace(/\s+/g, " ").slice(0, 60));
    ok(".rk-pool 用 flex: 1 1 0 均分（列少自动变宽）", /flex:\s*1 1 0/.test(poolRule), poolRule.replace(/\s+/g, " ").slice(0, 60));
    ok(".rk-pool 不限最大宽度（单列铺满整行）", /max-width:\s*none/.test(poolRule), poolRule.replace(/\s+/g, " ").slice(0, 60));
    ok("存在提示条样式", /\.rk-dropnote\s*\{/.test(css));
  }

  console.log("\n结果: 通过 " + pass + " / 失败 " + fail);
  process.exit(fail ? 1 : 0);
})();
