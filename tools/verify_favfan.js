/* verify_favfan.js —— 拖动榜单图时「扇形文件夹」的行为验证
 *
 * 用法：node tools/verify_favfan.js [项目根目录]
 *
 * 不光查字符串：真的在假 DOM 里跑 favfan.js，
 * 断言扇形的几何（左右对称、中间最高）、悬停态、落点写库参数、取消路径。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = process.argv[2] || ".";
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), "utf8"); }

const SRC = read("js/favfan.js");
const RANK = read("js/rank.js");
const CSS = read("css/style.css");
const HTML = read("rank.html");

function mkDom() {
  const dom = new JSDOM(
    '<!doctype html><html><body class="front">' +
    '<div class="gallery-layout"><main id="rk-body"><div class="rk-pools"><div class="rk-pool-grid"><figure class="rk-card">x</figure></div></div></main></div>' +
    '<div id="toast"></div></body></html>',
    { runScripts: "outside-only", pretendToBeVisual: true }
  );
  return dom;
}

const CATS = [
  { id: 1, name: "印花", color: "#8b7355" },
  { id: 2, name: "面料", color: "#c25e5a" },
  { id: 3, name: "图案", color: "#4a9c6d" },
  { id: 4, name: "工艺", color: "#5b7c9d" },
  { id: 5, name: "视觉", color: "#b08a4f" },
];

function makeSB(cats) {
  const calls = { added: [] };
  return {
    calls,
    favUid: async () => "u1",
    listFavCategories: async () => cats.slice(),
    ensureDefaultFavCats: async () => cats.slice(),
    addFavItems: async (rows, cid) => { calls.added.push({ rows: rows.slice(), cid }); return rows.length; },
  };
}

function dtOf(row) {
  const store = {};
  if (row) store["application/x-fav-row"] = JSON.stringify(row);
  return {
    dropEffect: "",
    getData(k) { return store[k] || ""; },
    setData(k, v) { store[k] = v; },
  };
}

function tick(ms) { return new Promise((r) => setTimeout(r, ms || 0)); }

(async function main() {
  console.log("\n=== 扇形文件夹（favfan.js）===\n");

  /* ---------- 一、静态接线 ---------- */
  ok("favfan.js 存在于 js/ 下", fs.existsSync(path.join(ROOT, "js/favfan.js")));
  ok("rank.html 引入了 favfan.js", /js\/favfan\.js\?v=/.test(HTML));
  ok("favfan.js 在 rank.js 之前加载（否则 rank 拿不到 FavFan）",
    HTML.indexOf("js/favfan.js") > 0 && HTML.indexOf("js/favfan.js") < HTML.indexOf("js/rank.js"));
  ok("rank.js 拖动开始时调 FavFan.show", /FavFan\s*&&\s*typeof\s+FavFan\.show/.test(RANK) && /FavFan\.show\(\)/.test(RANK));
  ok("rank.js 拖动结束时调 FavFan.hide", /FavFan\.hide\(\)/.test(RANK));
  ok("rank.js 不再在拖动时强行滑出右侧抽屉（改为扇形一步到位）",
    !/FavDrawer\.openForDrop\(\)\s*;/.test(RANK));
  ok("扇形外层 fixed 且 pointer-events:none（不占布局、不挡对比池）",
    /\.fv-fan\s*\{[^}]*position:\s*fixed/s.test(CSS) && /\.fv-fan\s*\{[^}]*pointer-events:\s*none/s.test(CSS));
  ok("文件夹本身接收事件", /\.fv-fan-cell\s*\{[^}]*pointer-events:\s*auto/s.test(CSS));
  ok("悬停放大用 scale 属性，不覆盖 JS 定位用的 transform", /\.fv-fan-cell\.is-over\s*\{[^}]*scale:/s.test(CSS));

  /* ---------- 二、真跑：摊开五个文件夹 ---------- */
  const dom = mkDom();
  const w = dom.window;
  const SB = makeSB(CATS);
  w.SB = SB;
  w.FavDrawer = { state: () => ({ items: [{ category_id: 1 }, { category_id: 1 }, { category_id: 3 }], cats: CATS }) };
  w.eval(SRC);
  ok("对外暴露 FavFan", !!w.FavFan && typeof w.FavFan.show === "function");

  w.FavFan.show();
  await tick(30);
  const doc = w.document;
  const fan = doc.getElementById("fv-fan");
  ok("拖动后出现扇形层", !!fan);
  ok("扇形层处于打开态", fan.classList.contains("is-open"));

  const cells = Array.prototype.slice.call(doc.querySelectorAll(".fv-fan-cell"));
  ok("五个分类摊成五个文件夹", cells.length === 5, String(cells.length));
  ok("文件夹上写了分类名", /印花/.test(cells[0].textContent) && /视觉/.test(cells[4].textContent));
  ok("文件夹带上分类颜色", /--fv-c:\s*#8b7355/.test(cells[0].getAttribute("style") || ""));
  ok("文件夹显示该类已有张数", /2 张/.test(cells[0].textContent) && /1 张/.test(cells[2].textContent));

  /* 几何：左右对称、中间最高（dy 最小） */
  const tf = cells.map((c) => c.style.transform || "");
  const mx = tf.map((t) => { const m = /translate\((-?\d+)px,\s*(-?\d+)px\)/.exec(t); return m ? { x: +m[1], y: +m[2] } : null; });
  ok("每个文件夹都有落点坐标", mx.every(Boolean));
  ok("扇形左右对称（首尾水平位移互为相反数）",
    Math.abs(mx[0].x + mx[4].x) <= 2, mx[0].x + " vs " + mx[4].x);
  ok("扇形向上摊开：中间那个最高（dy 最小）",
    mx[2].y < mx[0].y && mx[2].y < mx[4].y, JSON.stringify(mx.map((p) => p.y)));
  ok("相邻两个不重叠（水平间距够放一个文件夹）",
    Math.abs(mx[1].x - mx[0].x) >= 70, String(Math.abs(mx[1].x - mx[0].x)));

  /* ---------- 三、悬停与落点 ---------- */
  cells[3].dispatchEvent(Object.assign(new w.Event("dragover", { bubbles: true, cancelable: true }), { dataTransfer: dtOf(null) }));
  ok("拖到文件夹上方会高亮", cells[3].classList.contains("is-over"));
  cells[3].dispatchEvent(new w.Event("dragleave", { bubbles: true }));
  ok("移开后高亮消失", !cells[3].classList.contains("is-over"));

  const row = { image_url: "https://x/a.jpg", title: "连帽卫衣", period_label: "W42", tags: ["周度激增", "上升 12 位"], rank_pos: 3 };
  const dt = dtOf(row);
  cells[3].dispatchEvent(Object.assign(new w.Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: dt }));
  await tick(40);
  ok("松手在「工艺」上 → 只写了一条", SB.calls.added.length === 1, String(SB.calls.added.length));
  ok("写入的分类 id 正确（不是默认第一个）", SB.calls.added[0] && SB.calls.added[0].cid === 4, JSON.stringify(SB.calls.added[0] && SB.calls.added[0].cid));
  ok("标签与排位随收藏一起写进去（不丢）",
    !!SB.calls.added[0] && SB.calls.added[0].rows[0].tags.length === 2 && SB.calls.added[0].rows[0].rank_pos === 3,
    JSON.stringify(SB.calls.added[0] && SB.calls.added[0].rows[0]));
  ok("收藏成功后扇形自动收起", !fan.classList.contains("is-open"));
  ok("收藏成功给了提示", /工艺/.test(doc.getElementById("toast").textContent), doc.getElementById("toast").textContent);

  /* 没有数据时不写库 */
  w.FavFan.show();
  await tick(20);
  const c2 = doc.querySelectorAll(".fv-fan-cell")[0];
  c2.dispatchEvent(Object.assign(new w.Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: dtOf(null) }));
  await tick(20);
  ok("拖过来的数据为空 → 不写库", SB.calls.added.length === 1, String(SB.calls.added.length));

  /* Esc 收起 */
  doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok("Esc 收起扇形", !doc.getElementById("fv-fan").classList.contains("is-open"));

  /* ---------- 四、边界 ---------- */
  {
    const d2 = mkDom();
    const w2 = d2.window;
    w2.SB = makeSB(CATS);
    w2.FavDrawer = { state: () => ({ items: [], cats: CATS }) };
    w2.eval(SRC);
    w2.FavFan.show();
    await tick(20);
    ok("收起后再次拖动能重新摊开", w2.document.getElementById("fv-fan").classList.contains("is-open"));
    w2.FavFan.hide();
    ok("hide 之后干净收起", !w2.document.getElementById("fv-fan").classList.contains("is-open"));
  }

  {
    const many = CATS.concat([{ id: 6, name: "A" }, { id: 7, name: "B" }, { id: 8, name: "C" }, { id: 9, name: "D" }, { id: 10, name: "E" }]);
    const d3 = mkDom();
    const w3 = d3.window;
    w3.SB = makeSB(many);
    w3.FavDrawer = { state: () => ({ items: [], cats: many }) };
    w3.eval(SRC);
    w3.FavFan.show();
    await tick(20);
    const n3 = d3.window.document.querySelectorAll(".fv-fan-cell").length;
    ok("分类超过 8 个时最多摊 8 个（再多会挤成一团）", n3 === 8, String(n3));
    ok("超出的分类有文字说明、不静默丢", /还有 2 个分类/.test(d3.window.document.querySelector(".fv-fan-ring").textContent));
  }

  {
    const d4 = mkDom();
    const w4 = d4.window;
    w4.SB = makeSB([]);
    w4.FavDrawer = { state: () => ({ items: [], cats: [] }) };
    w4.eval(SRC);
    w4.FavFan.show();
    await tick(30);
    ok("一个分类都没有时不画空框，给一句说明",
      d4.window.document.querySelectorAll(".fv-fan-cell").length === 0 &&
      /还没有分类|正在准备/.test(d4.window.document.querySelector(".fv-fan-ring").textContent));
  }

  {
    /* 落库失败：要提示、要收起，不能卡在扇形上 */
    const d5 = mkDom();
    const w5 = d5.window;
    const SB5 = makeSB(CATS);
    SB5.addFavItems = async () => { throw new Error("网络断了"); };
    w5.SB = SB5;
    w5.FavDrawer = { state: () => ({ items: [], cats: CATS }) };
    w5.eval(SRC);
    w5.FavFan.show();
    await tick(20);
    const cd = d5.window.document.querySelectorAll(".fv-fan-cell")[1];
    cd.dispatchEvent(Object.assign(new w5.Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: dtOf({ image_url: "u/z.jpg", title: "z" }) }));
    await tick(30);
    ok("写库失败也会提示失败原因", /网络断了/.test(d5.window.document.getElementById("toast").textContent),
      d5.window.document.getElementById("toast").textContent);
    ok("写库失败后扇形照样收起（不卡住界面）",
      !d5.window.document.getElementById("fv-fan").classList.contains("is-open"));
  }

  console.log("\n================ 汇总 ================");
  console.log("PASS " + pass + " / FAIL " + fail);
  process.exit(fail ? 1 : 0);
})();