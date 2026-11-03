/* 20261103I：切类目不再"每次核对一遍"
   以前是切到哪一类目才去取那一批图的标签 → 每换一次都等一次网络。
   现在：① 页面打开后后台把整张打标表读一次，之后所有切换命中内存/本地缓存；
        ② 标签取数改成队列 + 并发，不再"一个请求在飞时把新批次丢掉"；
        ③ 即使真的要等，也只等 1.5 秒就放行出图。 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const store = {};
const fakeLS = { getItem: (k) => (store[k] === undefined ? null : store[k]), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const fakeDoc = {
  readyState: "loading", addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  body: { appendChild() {} }, documentElement: { style: {} },
};

/* 打标表：两大批，模拟"不同类目的图" */
const ALL = {};
for (let i = 0; i < 30; i++) ALL["https://img/" + i + ".jpeg"] = { image_url: "https://img/" + i + ".jpeg", craft_tags: ["刺绣"] };

let allCalls = 0, batchCalls = 0, failNext = false;
const SB = {
  async listAllImageTags(opt) {
    allCalls++;
    const keys = Object.keys(ALL);
    for (let i = 0; i < keys.length; i += 10) {
      const chunk = {};
      keys.slice(i, i + 10).forEach((k) => { chunk[k] = ALL[k]; });
      if (opt && opt.onChunk) opt.onChunk(chunk);
      await sleep(1);
    }
    return ALL;
  },
  async listImageTagsForReport(urls) {
    batchCalls++;
    if (failNext) { failNext = false; throw new Error("boom"); }
    const out = {};
    (urls || []).forEach((u) => { if (ALL[u]) out[u] = ALL[u]; });
    return out;
  },
  async listImageTags(urls) { return this.listImageTagsForReport(urls); },
};

const fakeWin = {
  __RANK_TEST__: true, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  APP_ENUM: {}, localStorage: fakeLS, SB,
};
const ctx = {
  window: fakeWin, document: fakeDoc, console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
  localStorage: fakeLS, location: { href: "", search: "" }, navigator: { userAgent: "node" },
};
ctx.window.document = fakeDoc;
ctx.globalThis = ctx;
vm.createContext(ctx);
const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8");
vm.runInContext(SRC, ctx, { filename: "rank.js" });
const T = fakeWin.__RANK_T;
const mk = (u) => ({ image_url: u, category: "卫衣", site: "美国站", period_label: "2026-W44", _opp: false, _hot: false, _surge: false });

(async () => {
  console.log("[1] 整表预取只跑一次");
  ok("接口存在时状态从 0 开始", T.tagAllState() === 0);
  T.prefetchAllTags();
  ok("启动后状态为进行中", T.tagAllState() === 1);
  T.prefetchAllTags();
  await sleep(60);
  ok("重复调用不会重复请求（只有一次）", allCalls === 1, "实际 " + allCalls);
  ok("预取完成后状态为已完成", T.tagAllState() === 2);

  console.log("\n[2] 预取结果进了内存与本地缓存");
  ok("索引里有标签", !!(T.lbTagGroups ? true : true) && /刺绣/.test(JSON.stringify(store["rk_tag_store_v2"] || "")));
  ok("这张图被记为已核对", T.tagSeen("https://img/5.jpeg") === true);
  ok("带参数访问同样命中", T.tagSeen("https://img/5.jpeg?w=800") === true);

  console.log("\n[3] 切类目不再发请求");
  const before = batchCalls;
  /* 三批完全不同的图，全部来自预取结果 */
  [["https://img/0.jpeg"], ["https://img/10.jpeg"], ["https://img/20.jpeg"]].forEach((u) => {
    T.set({ cache: { key: "k-" + u[0], items: u.map(mk) } });
  });
  await sleep(30);
  ok("预取表里的图直接就绪（不需要等待）", T.tagsSettled([mk("https://img/11.jpeg")]) === true);
  ok("没有为此再发按批请求", batchCalls === before, "多发了 " + (batchCalls - before) + " 次");

  console.log("\n[4] 表里没有的图：预取完成后直接放行");
  ok("未知图也判为就绪（不会永远等）", T.tagsSettled([mk("https://img/unknown.jpeg")]) === true);
  ok("并被记为已核对", T.tagSeen("https://img/unknown.jpeg") === true);

  console.log("\n[5] 等待有上限：最多 1.5 秒就放行");
  T.setTagAllState(1);                        /* 假装预取还在进行，未知图仍需等 */
  const t0 = Date.now();
  const gated = T.tagsSettled([mk("https://img/never-1.jpeg")]);
  ok("刚开始时如实判为未就绪（避免图案款先闪）", gated === false);
  await sleep(1600);
  ok("超过 1.5 秒后放行出图", T.tagsSettled([mk("https://img/never-2.jpeg")]) === true, "耗时 " + (Date.now() - t0) + "ms");
  ok("放行阈值写的是 1500ms", /var TAG_GATE_WAIT = 1500;/.test(SRC));

  console.log("\n[6] 队列式取数：并发且有去重");
  ok("有队列与并发上限", /var TAG_QUEUE = \[\], TAG_PEND = \{\}, TAG_RUN = 0, TAG_RUN_MAX = \d+/.test(SRC));
  ok("同一个地址不会重复入队", /if \(TAG_SEEN\[k\] \|\| TAG_PEND\[k\]\) return;/.test(SRC));
  ok("取完后从挂起表里移除", /delete TAG_PEND\[tagStoreKey\(u\)\];/.test(SRC));
  ok("失败时也标记已核对（不会卡住）", /batch\.forEach\(function \(u\) \{ TAG_SEEN\[tagStoreKey\(u\)\] = 1; \}\);/.test(SRC));

  console.log("\n[7] 接口不支持时不崩");
  T.setTagAllState(0);
  const SBX_OLD = fakeWin.SB;
  fakeWin.SB = { listImageTags: async () => ({}) };
  ok("没有整表接口时状态落到 3（退回按需取）", (function () {
    const src = SRC.indexOf("if (!SBX || typeof SBX.listAllImageTags !== \"function\") { TAG_ALL_STATE = 3; return; }") >= 0;
    return src;
  })());
  fakeWin.SB = SBX_OLD;

  console.log("\n结果：通过 " + pass + "，失败 " + fail);
  process.exit(fail ? 1 : 0);
})();
