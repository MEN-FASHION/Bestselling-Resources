/* verify_fav_sub.js —— 收藏二分类（上装 / 下装）行为校验（20261023I）
 * 用 jsdom 真跑一遍：工具条计数、筛切换、卡片上/下按钮写库、拖到 chip、缺接口时的兜底。
 * 用法：node tools/verify_fav_sub.js [项目根目录]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const ROOT = process.argv[2] || path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  →  " + extra : "")); }
};

const IMG = (n) => "https://img.kwcdn.com/product/open/" + n + "-goods.jpeg";

function makeItems() {
  const rows = [];
  let id = 1;
  const spec = [
    { cat: 1, sub: "top" }, { cat: 1, sub: "top" }, { cat: 1, sub: null },
    { cat: 2, sub: "bottom" }, { cat: 2, sub: "bottom" }, { cat: 2, sub: "top" },
    { cat: 3, sub: null },
  ];
  spec.forEach(function (s, i) {
    rows.push({
      id: id++, category_id: s.cat, sub_cat: s.sub, image_url: IMG("i" + i), title: "款式 " + i,
      leaf_category: "衬衫", site: "US", period_label: "W42", rank_pos: 3 + i,
      tags: ["潜力机会"], created_at: "2026-10-20T10:00:00Z",
    });
  });
  return rows;
}

function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div class="gallery-layout"><main id="pool"></main></div></body></html>', {
    runScripts: "outside-only", pretendToBeVisual: true, url: "https://newtrend.top/rank.html",
  });
  const w = dom.window;
  const items = opts.items || makeItems();
  const calls = [];
  const added = [];   /* 拖进来被收藏的行 */
  w.SB = {
    favUid: async () => "u-1",
    favReady: async () => true,
    favTagsReady: async () => true,
    listFavCategories: async () => ([
      { id: 1, name: "印花", color: "#8b7355" },
      { id: 2, name: "面料", color: "#c25e5a" },
      { id: 3, name: "图案", color: "#4a9c6d" },
    ]),
    ensureDefaultFavCats: async () => [],
    listFavItems: async () => items,
    moveFavItems: async () => 1,
    setFavSubCat: opts.noApi ? undefined : async (ids, sub) => { calls.push({ ids: ids, sub: sub }); return ids.length; },
    listFavKeys: async () => [],
    addFavItems: async (rows) => {
      (rows || []).forEach(function (r) {
        added.push(r);
        items.push({ id: 900 + items.length, category_id: null, sub_cat: (opts.noSubCat ? undefined : null),
          image_url: r.image_url, title: r.title, period_label: "W42" });
      });
      return (rows || []).length;
    },
  };
  w.eval(read("js/favdrawer.js"));
  return { dom, w, items, calls, added };
}

function q(w, sel) { return w.document.querySelector(sel); }
function qa(w, sel) { return Array.prototype.slice.call(w.document.querySelectorAll(sel)); }

(async function () {
  console.log("\n=== 收藏二分类：上装 / 下装 ===\n");

  /* ① 工具条计数 */
  const A = boot();
  await A.w.FavDrawer.open();
  const bar = q(A.w, "#fv-subbar");
  ok("抽屉里出现二分类工具条", !!bar);
  const chips = qa(A.w, "#fv-subbar [data-sub]");
  ok("工具条有 全部 / 上装 / 下装（并有 未分，因为存在未分图）", chips.length === 4,
    chips.map((c) => c.textContent).join("|"));
  const counts = {};
  chips.forEach(function (c) { counts[c.getAttribute("data-sub")] = parseInt(c.querySelector("i").textContent, 10); });
  ok("全部 = 7", counts.all === 7, JSON.stringify(counts));
  ok("上装 = 3（1 类目 2 张 + 2 类目 1 张）", counts.top === 3, JSON.stringify(counts));
  ok("下装 = 2", counts.bottom === 2, JSON.stringify(counts));
  ok("未分 = 2", counts.none === 2, JSON.stringify(counts));

  /* ② 切换筛选 */
  ok("默认显示的卡片数 = 7", qa(A.w, ".fv-d-grid .fv-d-cell").length === 7);
  const topChip = qa(A.w, "#fv-subbar [data-sub]").filter((c) => c.getAttribute("data-sub") === "top")[0];
  topChip.dispatchEvent(new A.w.MouseEvent("click", { bubbles: true }));
  ok("点上装后只剩 3 张", qa(A.w, ".fv-d-grid .fv-d-cell").length === 3,
    String(qa(A.w, ".fv-d-grid .fv-d-cell").length));
  /* 重绘会重建 chip 节点，必须重新取一次再断言，不能用点击前的旧引用 */
  ok("上装 chip 进入选中态", (function () {
    const c = qa(A.w, "#fv-subbar [data-sub]").filter((x) => x.getAttribute("data-sub") === "top")[0];
    return !!c && /is-on/.test(c.className);
  })());
  const noneChip = qa(A.w, "#fv-subbar [data-sub]").filter((c) => c.getAttribute("data-sub") === "none")[0];
  noneChip.dispatchEvent(new A.w.MouseEvent("click", { bubbles: true }));
  ok("点未分后只剩 2 张", qa(A.w, ".fv-d-grid .fv-d-cell").length === 2);

  /* ③ 切分类不重置二分类（两个条件与关系） */
  const catChip = qa(A.w, "#fv-d-filter [data-fv-f]").filter((c) => c.getAttribute("data-fv-f") === "1")[0];
  catChip.dispatchEvent(new A.w.MouseEvent("click", { bubbles: true }));
  ok("切到「印花」后仍是未分筛选（只剩 1 张）", qa(A.w, ".fv-d-grid .fv-d-cell").length === 1,
    String(qa(A.w, ".fv-d-grid .fv-d-cell").length));
  ok("切分类后工具条计数跟着分类变（印花共 3）", (function () {
    const c = qa(A.w, "#fv-subbar [data-sub]").filter((x) => x.getAttribute("data-sub") === "all")[0];
    return c && parseInt(c.querySelector("i").textContent, 10) === 3;
  })());

  /* ④ 卡片上的 上/下 按钮写库 */
  const B = boot();
  await B.w.FavDrawer.open();
  const cell = qa(B.w, ".fv-d-cell").filter((c) => c.getAttribute("data-id") === "1")[0];
  ok("卡片带 上/下 两个按钮", cell && qa(B.w, ".fv-d-cell[data-id='1'] .fv-d-subseg button").length === 2);
  const botBtn = qa(B.w, ".fv-d-cell[data-id='1'] .fv-d-subseg button").filter((b) => b.getAttribute("data-sub") === "bottom")[0];
  botBtn.dispatchEvent(new B.w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  ok("点「下」调用了 setFavSubCat(id, 'bottom')",
    B.calls.length === 1 && B.calls[0].sub === "bottom" && B.calls[0].ids[0] === 1, JSON.stringify(B.calls));
  const it1 = B.items.filter((x) => x.id === 1)[0];
  ok("本地数据同步改为 bottom（不用刷新页面）", it1.sub_cat === "bottom", String(it1.sub_cat));
  ok("该卡片按钮随即进入选中态",
    /is-on/.test(qa(B.w, ".fv-d-cell[data-id='1'] .fv-d-subseg button").filter((b) => b.getAttribute("data-sub") === "bottom")[0].className));

  /* ⑤ 重复点同一值不发请求 */
  const botBtn2 = qa(B.w, ".fv-d-cell[data-id='1'] .fv-d-subseg button").filter((b) => b.getAttribute("data-sub") === "bottom")[0];
  botBtn2.dispatchEvent(new B.w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  ok("已是同值时不再写库", B.calls.length === 1, JSON.stringify(B.calls));

  /* ⑥ 老字段兼容：sub_cat 是脏值时按未分处理 */
  const C = boot({ items: [{ id: 9, category_id: 1, sub_cat: "TOP", image_url: IMG("x"), title: "x", period_label: "W42" }] });
  await C.w.FavDrawer.open();
  ok("脏值（大写/未知）按未分处理，不崩", (function () {
    const all = qa(C.w, "#fv-subbar [data-sub]").filter((x) => x.getAttribute("data-sub") === "none")[0];
    return !!all && parseInt(all.querySelector("i").textContent, 10) === 1;
  })());

  /* ⑦ 数据层没升级时的兜底：给出可执行的提示，而不是静默失败 */
  const D = boot({ noApi: true });
  await D.w.FavDrawer.open();
  let toasted = "";
  D.w.toast = function (t) { toasted = String(t); };
  const bb = qa(D.w, ".fv-d-cell[data-id='1'] .fv-d-subseg button").filter((b) => b.getAttribute("data-sub") === "top")[0];
  bb.dispatchEvent(new D.w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  ok("接口缺失时明确提示刷新，不假装成功", /未就绪|刷新/.test(toasted), toasted);

  /* ⑧ 收藏页（fav.html）：同一套二分类也要能用，而不是只有抽屉有 */
  const pageHtml = read("fav.html").replace(/<script[\s\S]*?<\/script>/g, "");
  const pageDom = new JSDOM(pageHtml, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://newtrend.top/fav.html" });
  const pw = pageDom.window;
  const pcalls = [];
  pw.SB = {
    getSession: async () => ({ user: { id: "u1", email: "a@b.c" } }),
    signOut: async () => ({}),
    favUid: async () => "u1",
    favReady: async () => true,
    favTagsReady: async () => true,
    listFavCategories: async () => ([{ id: 1, name: "印花", color: "#8b7355" }, { id: 2, name: "面料", color: "#c25e5a" }]),
    ensureDefaultFavCats: async () => [],
    listFavItems: async () => makeItems(),
    moveFavItems: async () => 1,
    setFavSubCat: async (ids, sub) => { pcalls.push({ ids: ids, sub: sub }); return ids.length; },
    listFavKeys: async () => [],
    getFrontendZoneVisibility: async () => ({}),
    myFrontendZones: async () => null,
    myProfile: async () => ({ role: "admin" }),
  };
  pw.eval(read("js/fav.js"));
  await new Promise((r) => setTimeout(r, 400));
  const pfa = (sel) => Array.prototype.slice.call(pw.document.querySelectorAll(sel));
  ok("收藏页也有二分类条", !!pw.document.querySelector("#fv-subbar"));
  ok("收藏页卡片也带 上/下 按钮", pfa(".fv-subseg button").length === 14,
    String(pfa(".fv-subseg button").length));
  const pTop = pfa("#fv-subbar [data-subview]").filter((b) => b.getAttribute("data-subview") === "top")[0];
  pTop.dispatchEvent(new pw.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  ok("收藏页点上装后卡片变少", pfa(".fv-card").length === 3, String(pfa(".fv-card").length));
  const pBtn = pfa(".fv-card .fv-subseg button").filter((b) => b.getAttribute("data-sub") === "bottom")[0];
  pBtn.dispatchEvent(new pw.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  ok("收藏页点「下」也会写库", pcalls.length === 1 && pcalls[0].sub === "bottom", JSON.stringify(pcalls));

  /* ==================================================================
     ⑤ 20261026T：修「点了上装变空页 / 图拖不进去 / 进去出不来」
     ================================================================== */
  console.log("\n=== ⑤ 空态可回退 / 外部拖入可落点 / 未启用说清楚 ===\n");

  /* (1) 筛到 0 张时工具条必须还在，并且有「看全部」能退回去 */
  const T1 = boot();
  await T1.w.FavDrawer.open();
  const botChip = qa(T1.w, "#fv-subbar [data-sub]").filter((c) => c.getAttribute("data-sub") === "bottom")[0];
  botChip.dispatchEvent(new T1.w.MouseEvent("click", { bubbles: true }));
  /* 切到「图案」这个分类：里面只有 1 张且未分 → 下装在这个分类下是 0 张 */
  const patChip = qa(T1.w, "#fv-d-filter [data-fv-f]").filter((c) => c.getAttribute("data-fv-f") === "3")[0];
  patChip.dispatchEvent(new T1.w.MouseEvent("click", { bubbles: true }));
  const isEmpty = qa(T1.w, ".fv-d-grid .fv-d-cell").length === 0;
  ok("构造成功：选中的组合确实是 0 张", isEmpty, String(qa(T1.w, ".fv-d-grid .fv-d-cell").length));
  ok("0 张时二分类工具条仍然在（不会因此消失）", !!q(T1.w, "#fv-subbar"));
  const backBtn = q(T1.w, "#fv-subbar [data-sub]");
  ok("0 张时仍能点「全部」退回去", !!backBtn);
  const emptyBack = q(T1.w, ".fv-d-empty-back");
  ok("空态里另给一个「看全部」按钮", !!emptyBack);
  ok("空态说明写清当前筛的是什么（「下装」）",
    /「下装」下还没有图/.test((q(T1.w, "#fv-d-body") || {}).textContent || ""),
    ((q(T1.w, "#fv-d-body") || {}).textContent || "").slice(0, 60));
  if (emptyBack) {
    emptyBack.dispatchEvent(new T1.w.MouseEvent("click", { bubbles: true }));
    ok("点「看全部」后回到全部（卡片回来）", qa(T1.w, ".fv-d-grid .fv-d-cell").length > 0,
      String(qa(T1.w, ".fv-d-grid .fv-d-cell").length));
  }

  /* (2) 从榜单卡片直接拖到「上装」上：收藏 + 同时写二分类 */
  const T2 = boot();
  await T2.w.FavDrawer.open();
  const dropChip = qa(T2.w, "#fv-subbar [data-sub-drop]").filter((c) => c.getAttribute("data-sub-drop") === "top")[0];
  const dt = { types: ["application/x-fav-row"], getData: function (t) { return t === "application/x-fav-row" ? JSON.stringify({ image_url: IMG("new"), title: "新拖入款" }) : ""; }, setData: function () {}, dropEffect: "", effectAllowed: "" };
  const mkEv = (type) => { const e = new T2.w.Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, "dataTransfer", { value: dt }); return e; };
  dropChip.dispatchEvent(mkEv("dragover"));
  ok("外部拖拽时「上装」亮起落点态（原来完全不理）", /is-drop/.test(dropChip.className), dropChip.className);
  dropChip.dispatchEvent(mkEv("drop"));
  await new Promise((r) => setTimeout(r, 120));
  ok("拖到「上装」上确实收藏了这张（addFavItems 被调用）",
    (T2.added || []).some((r) => r && r.image_url === IMG("new")), JSON.stringify(T2.added || []));
  ok("收藏的同时写入了二分类 top",
    T2.calls.some((c) => c.sub === "top"), JSON.stringify(T2.calls));

  /* (3) 数据库还没加 sub_cat 列：不给一排死按钮，直接给出要执行哪个脚本 */
  const noSub = makeItems().map(function (r) { const o = Object.assign({}, r); delete o.sub_cat; return o; });
  const T3 = boot({ items: noSub });
  await T3.w.FavDrawer.open();
  ok("缺 sub_cat 列时不显示点了必然失败的按钮", qa(T3.w, "#fv-subbar [data-sub]").length === 0);
  ok("缺 sub_cat 列时明确告知要执行哪个脚本",
    /patch_20261023I\.sql/.test((q(T3.w, "#fv-subbar") || {}).textContent || ""),
    ((q(T3.w, "#fv-subbar") || {}).textContent || "").slice(0, 60));

  console.log("\n================ 汇总 ================");
  console.log("PASS " + pass + " / FAIL " + fail);
  if (fail) { console.log("失败项："); process.exitCode = 1; }
})();
