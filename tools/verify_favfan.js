/* verify_favfan.js —— 「横向扇形」行为验证（20261023F）
 * 真在 jsdom 里跑 js/favfan.js（配可编程假数据层），检查排布方向、提示语与拖放结果。
 * 用法：node tools/verify_favfan.js [项目根目录]
 */
"use strict";
const fs = require("fs");
const path = require("path");
let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) { console.error("需要先安装 jsdom：npm install jsdom@22.1.0"); process.exit(2); }

const ROOT = process.argv[2] || path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  →  " + extra : "")); }
};

const SRC = read("js/favfan.js");
const CSS = read("css/style.css");
const HTML = read("rank.html");
const RANK = read("js/rank.js");

console.log("\n=== 拖动收藏：横向扇形（向右展开 + 提示可拖进收藏）===\n");

/* ---------- 静态：文件、引用、顺序 ---------- */
ok("js/favfan.js 存在", fs.existsSync(path.join(ROOT, "js/favfan.js")));
ok("rank.html 引入 favfan.js", /js\/favfan\.js\?v=/.test(HTML));
ok("favfan.js 在 favdrawer.js 之前加载（要读抽屉里的分类）",
  HTML.indexOf("favfan.js") < HTML.indexOf("favdrawer.js"));
ok("rank.js 拖动开始时调用 FavFan.show", /FavFan\.show\(\)/.test(RANK));
ok("rank.js 拖动结束时调用 FavFan.hide", /FavFan\.hide\(\)/.test(RANK));
ok("拖动不再自动把右侧抽屉滑出来", !/FavDrawer\.openForDrop\(\)/.test(RANK));

/* ---------- 读懂源码里的排布意图 ---------- */
ok("横向排布：位移沿 X 递增（dx = -i * gap）", /var dx = -Math\.round\(i \* gap\)/.test(SRC));
ok("弧线只做微弱起伏（dy 用 BULGE，量级远小于横向间距）", /BULGE = 1[0-9]/.test(SRC) && /GAP = 10[0-9]/.test(SRC));
ok("不再用「向上摊开」的旧写法（-cos 垂直半径）", !/-Math\.cos\(/.test(SRC));
ok("张开角度以右侧为轴（transform-origin: 100% 50%）", /transform-origin:\s*100% 50%/.test(CSS));

/* ---------- CSS 底线 ---------- */
const fanSeg = (CSS.match(/\.fv-fan\{[\s\S]*?\}/g) || []).pop() || "";
ok("扇形层是 fixed 浮层", /position:\s*fixed/.test(fanSeg));
ok("扇形层 pointer-events:none（不挡对比池）", /pointer-events:\s*none/.test(fanSeg));
ok("只有文件夹本身收事件", /\.fv-fan-cell\{[\s\S]*?pointer-events:\s*auto/.test(CSS));
ok("文件夹基于毛玻璃与圆角（与抽屉同一套语言）",
  /\.fv-fan-cell\{[\s\S]*?backdrop-filter:\s*blur[\s\S]*?border-radius:\s*1[0-9]px/.test(CSS));
ok("有明确提示条样式（.fv-fan-bar）", /\.fv-fan-bar\{/.test(CSS));

(async function main() {
  /* ---------- 跑起来 ---------- */
  const dom = new JSDOM('<!doctype html><html><body><div id="toast"></div></body></html>',
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://newtrend.top/rank.html" });
  const w = dom.window;
  w.innerWidth = 1440;
  let added = [];
  w.SB = {
    ensureDefaultFavCats: async () => [
      { id: 1, name: "印花", color: "#b06a5a" },
      { id: 2, name: "面料", color: "#5a7fb0" },
      { id: 3, name: "图案", color: "#8a9a6b" },
      { id: 4, name: "工艺", color: "#b09a5a" },
      { id: 5, name: "视觉", color: "#7a6f9a" },
    ],
    addFavItems: async (rows, cid) => { added.push({ rows, cid }); return 1; },
  };
  w.FavDrawer = { state: () => ({ items: [], cats: [] }), refresh: () => {} };
  w.eval(SRC);

  const doc = w.document;
  ok("模块暴露 FavFan", !!w.FavFan && typeof w.FavFan.show === "function");
  w.FavFan.show();
  await new Promise((r) => setTimeout(r, 160));
  ok("展开时建好容器（静默，不占位）", !!doc.getElementById("fv-fan"));

  const cells = [...doc.querySelectorAll("#fv-fan-deck .fv-fan-cell")];
  ok("五个默认分类都摊出来了", cells.length === 5, String(cells.length));

  const dx = cells.map((c) => parseFloat(c.style.getPropertyValue("--dx")) || 0);
  const dy = cells.map((c) => parseFloat(c.style.getPropertyValue("--dy")) || 0);
  const rot = cells.map((c) => parseFloat(c.style.getPropertyValue("--rot")) || 0);

  ok("横向展开：每张都比上一张更靠左（dx 严格递减）",
    dx.every((v, i) => i === 0 || v < dx[i - 1]), JSON.stringify(dx));
  ok("横向跨度足够（最左一张至少离开扇轴 300px）", Math.abs(dx[dx.length - 1]) >= 300, String(dx[dx.length - 1]));
  ok("纵向起伏很小（|dy| 不超过 20px，不是竖着一摞）",
    dy.every((v) => Math.abs(v) <= 20), JSON.stringify(dy));
  ok("整叠带扇形旋转（-10°~+10° 之间且左右方向不同）",
    rot.every((v) => Math.abs(v) <= 10) && rot[0] !== rot[rot.length - 1], JSON.stringify(rot));
  ok("最近的一张正对收藏入口（dx≈0）", Math.abs(dx[0]) < 1, String(dx[0]));

  const bar = doc.querySelector(".fv-fan-bar");
  ok("有提示条，且写明「可以拖进收藏」", !!bar && /可以拖进收藏/.test(bar.textContent), bar && bar.textContent.trim());
  ok("提示条还说明了松手即归类与 Esc 取消",
    !!bar && /松手即归入/.test(bar.textContent) && /Esc/.test(bar.textContent));

  /* 拖一张图进去 */
  const cell = cells[1];
  const dt = { data: {}, types: [],
    setData(k, v) { this.data[k] = v; if (!this.types.includes(k)) this.types.push(k); },
    getData(k) { return this.data[k] || ""; } };
  const ev = new w.Event("drop", { bubbles: true, cancelable: true });
  ev.dataTransfer = dt;
  dt.setData("application/x-fav-row", JSON.stringify({ image_url: "https://img.kwcdn.com/a.jpg", title: "示例" }));
  cell.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 60));

  ok("松手后按该文件夹的分类写入收藏", added.length === 1 && added[0].cid === 2, JSON.stringify(added));
  ok("写完后扇形自动收起", !w.FavFan.isOpen());

  w.FavFan.show();
  await new Promise((r) => setTimeout(r, 160));
  ok("再次拖动能重新摊开（状态可复用）",
    w.FavFan.isOpen() && doc.querySelectorAll("#fv-fan-deck .fv-fan-cell").length === 5);
  w.FavFan.hide();
  ok("hide 后容器标记为收起", doc.getElementById("fv-fan").className.indexOf("is-open") < 0);

  console.log("\n================ 汇总 ================");
  console.log("PASS " + pass + " / FAIL " + fail);
  if (fail) process.exit(1);
})().catch(function (e) { console.error(e); process.exit(1); });
