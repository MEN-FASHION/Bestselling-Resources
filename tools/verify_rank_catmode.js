/* ============================================================
 * 类目对比：① 不选「几列」，勾几个就比几个、最多四个
 *           ② 对比池的类目列可以拖动换序
 *
 * 真实痛点：右上角还有一排「对比列数（类目）」，选了 4 个类目却按 3 列出图，
 * 或者勾了第 5 个没有任何反馈；列的顺序固定按后台类目顺序，没法把要对比的两个挪到一起。
 *
 * 用法：node tools/verify_rank_catmode.js <仓库根目录>
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

const SITES = ["美国"];
const PERIODS = ["2026W41", "2026W42"];
const CATS = ["卫衣", "T恤", "鞋", "外套", "帽子"];

function items() {
  const out = [];
  CATS.forEach((cat, ci) => {
    PERIODS.forEach((p, pi) => {
      for (let i = 0; i < 3; i++) out.push({
        image_url: "https://img.newtrend.top/p/" + cat + p + i + ".jpg",
        site: "美国", period_label: p, category: cat, leaf_category: cat,
        ratio: 1 + i + pi, abs_delta: 90 - i * 5,
        shoot_tags: ["模拍"], element_tags: ["印花"],
      });
    });
  });
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
    getRankGroups: async () => [],
    getRankHidden: async () => ({ sites: [], periods: [] }),
    listRankItems: async (f) => {
      f = f || {};
      const s = f.sites || [], p = f.periods || [];
      const cats = f.category ? [f.category] : (f.categories || []);
      return rows.filter((it) =>
        (!s.length || s.indexOf(it.site) >= 0) &&
        (!p.length || p.indexOf(it.period_label) >= 0) &&
        (!cats.length || cats.indexOf(it.category) >= 0));
    },
    /* 打标表：没有就返回空，页面只显示三档占比，不影响本测试 */
    listImageTags: async () => [],
    ensureDefaultFavCats: async () => [],
    listFavCategories: async () => [],
    listFavItems: async () => [],
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
const poolN = (w) => w.document.querySelectorAll("#rk-pools .rk-pool").length;
const poolCats = (w) => Array.prototype.map.call(w.document.querySelectorAll("#rk-pools .rk-pool[data-rk-cat]"),
  (e) => e.getAttribute("data-rk-cat"));
const poolHead = (w, cat) => {
  const s = w.document.querySelector('#rk-pools .rk-pool[data-rk-cat="' + cat + '"]');
  return s ? (s.querySelector(".rk-pool-head").textContent || "").replace(/\s+/g, " ").trim() : "";
};
const toastTxt = (w) => { const t = w.document.getElementById("toast"); return t ? (t.textContent || "") : ""; };

/* 造一个最小可用的 DragEvent（jsdom 没有内置 dataTransfer） */
function dragEvt(w, type, opts) {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  const dt = { data: {}, types: [],
    setData(k, v) { this.data[k] = String(v); if (this.types.indexOf(k) < 0) this.types.push(k); },
    getData(k) { return this.data[k] || ""; } };
  e.dataTransfer = dt;
  e.clientX = (opts && opts.clientX) || 0;
  e.clientY = (opts && opts.clientY) || 0;
  return e;
}

(async function main() {
  console.log("== 类目对比：列数 = 类目数（最多四个）+ 列可拖动换序 ==");

  console.log("\n[1] 类目对比时不再出现「对比列数」这一组");
  {
    const { window: w, errors } = await boot(q({ mode: "c", cats: "卫衣,T恤", sites: "美国", periods: "2026W42" }));
    ok("筛选面板里没有「对比列数」控件", !w.document.getElementById("rk-g-cols"));
    ok("面板里没有「对比列数（类目）」字样", !/对比列数（类目）/.test(w.document.querySelector("#rk-filter, #rk-panel, body").textContent));
    ok("类目组文案说明「勾几个就比几个，最多四个」",
      /勾几个就对比几个/.test(w.document.querySelector("#rk-g-cats").parentNode.textContent) &&
      /最多四个/.test(w.document.querySelector("#rk-g-cats").parentNode.textContent));
    ok("勾了 2 个 → 正好 2 列", poolN(w) === 2, "实际 " + poolN(w));
    ok("两列就是选中的那两个类目", poolCats(w).join(",") === "卫衣,T恤", poolCats(w).join(","));
    ok("无未捕获错误", errors.length === 0, errors.join(" | ").slice(0, 120));
  }

  console.log("\n[2] 勾 4 个 → 出 4 列（不再被「默认 3 列」截断）");
  {
    const { window: w } = await boot(q({ mode: "c", cats: "卫衣,T恤,鞋,外套", sites: "美国", periods: "2026W42" }));
    ok("4 列", poolN(w) === 4, "实际 " + poolN(w));
    ok("列顺序与勾选顺序一致", poolCats(w).join(",") === "卫衣,T恤,鞋,外套", poolCats(w).join(","));
    ok("顶栏写 4 列", /4<\/b>\s*列/.test(w.document.querySelector(".rk-bar-info").innerHTML.replace(/\s+/g, " ")),
      w.document.querySelector(".rk-bar-info").textContent);
  }

  console.log("\n[3] 已选 4 个时再勾第 5 个 → 拦住并提示「最多四个」");
  {
    const { window: w } = await boot(q({ mode: "c", cats: "卫衣,T恤,鞋,外套", sites: "美国", periods: "2026W42" }));
    const chip = w.document.querySelector('#rk-g-cats [data-cat="帽子"]');
    ok("第 5 个类目在面板里可见", !!chip);
    chip.dispatchEvent(new w.Event("click", { bubbles: true }));
    await sleep(40);
    ok("提示文案点明最多四个", /最多四个/.test(toastTxt(w)), toastTxt(w));
    ok("仍然是 4 列，没有加出第 5 列", poolN(w) === 4, "实际 " + poolN(w));
    ok("帽子没有进入对比列", poolCats(w).indexOf("帽子") < 0, poolCats(w).join(","));
  }

  console.log("\n[4] 取消到 1 个也照常工作（不被强行补回 2 个）");
  {
    const { window: w } = await boot(q({ mode: "c", cats: "卫衣,T恤", sites: "美国", periods: "2026W42" }));
    w.document.querySelector('#rk-g-cats [data-cat="T恤"]').dispatchEvent(new w.Event("click", { bubbles: true }));
    for (let i = 0; i < 30; i++) await sleep(20);
    ok("只剩 1 列", poolN(w) === 1, "实际 " + poolN(w));
    ok("留下的是卫衣", poolCats(w).join(",") === "卫衣", poolCats(w).join(","));
    ok("顶栏同步写 1 列", /1<\/b>\s*列/.test(w.document.querySelector(".rk-bar-info").innerHTML.replace(/\s+/g, " ")),
      w.document.querySelector(".rk-bar-info").textContent);
  }

  console.log("\n[5] 列头有拖动把手（卡片本身的拖拽不受影响）");
  {
    const { window: w } = await boot(q({ mode: "c", cats: "卫衣,T恤,鞋,外套", sites: "美国", periods: "2026W42" }));
    const grips = w.document.querySelectorAll("#rk-pools .rk-pool .rk-pool-grip");
    ok("每列一个把手（4 个）", grips.length === 4, "实际 " + grips.length);
    ok("把手可拖（draggable=true）", Array.prototype.every.call(grips, (g) => g.getAttribute("draggable") === "true"));
    ok("把手说明了用途", /拖动/.test(grips[0].getAttribute("title") || ""), grips[0].getAttribute("title"));
    ok("列本身不是 draggable（避免吞掉卡片拖拽）",
      Array.prototype.every.call(w.document.querySelectorAll("#rk-pools .rk-pool"), (s) => s.getAttribute("draggable") !== "true"));
    ok("卡片仍然可拖去收藏",
      !!w.document.querySelector("#rk-pools .rk-card[draggable='true']") || !!w.document.querySelector("#rk-pools .rk-card img[draggable='true']"));
  }

  console.log("\n[6] 拖动「外套」到「卫衣」左侧 → 列顺序改变，数据不变");
  {
    const { window: w } = await boot(q({ mode: "c", cats: "卫衣,T恤,鞋,外套", sites: "美国", periods: "2026W42" }));
    const srcGrip = w.document.querySelector('#rk-pools .rk-pool[data-rk-cat="外套"] .rk-pool-grip');
    const dst = w.document.querySelector('#rk-pools .rk-pool[data-rk-cat="卫衣"]');
    const before = poolCats(w).join(",");
    srcGrip.dispatchEvent(dragEvt(w, "dragstart"));
    dst.dispatchEvent(dragEvt(w, "dragover", { clientX: 0 }));      /* clientX 在左半边 → 落在卫衣之前 */
    dst.dispatchEvent(dragEvt(w, "drop", { clientX: 0 }));
    await sleep(80);
    const after = poolCats(w).join(",");
    ok("顺序确实变了", after !== before, before + " → " + after);
    ok("外套移到了最前面", poolCats(w)[0] === "外套", after);
    ok("仍是 4 列（只换位置，不多不少）", poolN(w) === 4, String(poolN(w)));
    ok("每列张数没变（没有被清空重取）",
      /3 张/.test(poolHead(w, "外套")) && /3 张/.test(poolHead(w, "卫衣")),
      poolHead(w, "外套") + " || " + poolHead(w, "卫衣"));
    ok("给了一次轻提示", /调整列顺序/.test(toastTxt(w)), toastTxt(w));
  }

  console.log("\n[7] 拖到右侧 → 落在该列之后");
  {
    const { window: w } = await boot(q({ mode: "c", cats: "卫衣,T恤,鞋,外套", sites: "美国", periods: "2026W42" }));
    const srcGrip = w.document.querySelector('#rk-pools .rk-pool[data-rk-cat="卫衣"] .rk-pool-grip');
    const dst = w.document.querySelector('#rk-pools .rk-pool[data-rk-cat="T恤"]');
    srcGrip.dispatchEvent(dragEvt(w, "dragstart"));
    dst.dispatchEvent(dragEvt(w, "dragover", { clientX: 500 }));
    dst.dispatchEvent(dragEvt(w, "drop", { clientX: 500 }));
    await sleep(80);
    ok("卫衣落到 T恤 之后", poolCats(w).slice(0, 2).join(",") === "T恤,卫衣", poolCats(w).join(","));
  }

  console.log("\n[8] 国家对比 / 时间对比不受影响（没有拖动把手）");
  {
    const { window: w } = await boot(q({ mode: "v", cat: "卫衣", sites: "美国", periods: "2026W41,2026W42" }));
    ok("纵向态仍显示「对比列数（周）」", !!w.document.getElementById("rk-g-cols") && /对比列数（周）/.test(w.document.body.textContent));
    ok("纵向列没有拖动把手", w.document.querySelectorAll("#rk-pools .rk-pool-grip").length === 0);
    ok("纵向 2 列照常", poolN(w) === 2, String(poolN(w)));
  }

  console.log("\n================ 汇总 ================");
  console.log("PASS " + pass + " / FAIL " + fail);
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
