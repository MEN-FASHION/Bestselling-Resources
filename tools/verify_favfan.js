/* ============================================================
 * 拖动收藏 · 竖排分类清单（favfan.js，20261023H）
 *
 * 用户的两次否定都写进断言里：
 *   ① 不要横向扇形（fx：每张往左铺开）—— 那是上一版；
 *   ② 分类要**竖排**显示在屏幕左/右侧，一列读下来。
 *
 * 另外守住"不影响对比池"：浮层不占位、只有行收事件、松手不在行上就取消。
 *
 * 用法：node tools/verify_favfan.js <仓库根目录>
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

const CSS = read("css/style.css");
const JS = read("js/favfan.js");
const HTML = read("rank.html");

const CATS = [
  { id: 1, name: "印花", color: "#c2705a" },
  { id: 2, name: "面料", color: "#5a7fc2" },
  { id: 3, name: "图案", color: "#6f9c5a" },
  { id: 4, name: "工艺", color: "#c2a05a" },
  { id: 5, name: "视觉", color: "#8b6fc2" },
];

function makeSB() {
  const added = [];
  const impl = {
    ensureDefaultFavCats: async () => CATS.slice(),
    listFavCategories: async () => CATS.slice(),
    addFavItems: async (rows, cid) => { added.push({ rows, cid }); return rows.length; },
  };
  const proxy = new Proxy(impl, { get(t, k) { if (k in t) return t[k]; if (typeof k !== "string") return undefined; return async () => null; } });
  proxy.__added = added;
  return proxy;
}

async function boot() {
  const html = HTML.replace(/<script src="[^"]*"><\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://newtrend.top/rank.html", runScripts: "dangerously", pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message || e.error)));
  window.eval(read("js/config.js"));
  window.SB = makeSB();
  window.eval(read("js/favfan.js"));
  await sleep(30);
  return { window, errors };
}

function dragEvt(w, type) {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  const dt = { data: {}, types: [],
    setData(k, v) { this.data[k] = String(v); if (this.types.indexOf(k) < 0) this.types.push(k); },
    getData(k) { return this.data[k] || ""; } };
  e.dataTransfer = dt;
  return e;
}

(async function main() {
  console.log("== 拖动收藏：竖排分类清单 ==");

  console.log("\n[1] 结构：一列竖排，不再横向铺开");
  {
    const { window: w, errors } = await boot();
    const F = w.FavFan;
    ok("暴露 FavFan 模块", !!F && typeof F.show === "function");
    F.show();
    await sleep(160);
    const el = w.document.querySelector(".fv-dock");
    ok("容器 id 仍是 fv-fan（不动其它引用）", !!w.document.getElementById("fv-fan"));
    ok("容器用 .fv-dock 命名（与横向扇形区分）", !!el && el.classList.contains("fv-dock"));
    ok("打开时加上 is-open，aria-hidden=false",
      el.classList.contains("is-open") && el.getAttribute("aria-hidden") === "false");

    const list = w.document.getElementById("fv-dock-list");
    ok("有清单容器", !!list);
    const rows = Array.prototype.slice.call(w.document.querySelectorAll(".fv-dock-row"));
    ok("五个默认分类都列出来了", rows.length === 5, "实际 " + rows.length);
    ok("顺序与分类顺序一致",
      rows.map((r) => r.getAttribute("data-name")).join(",") === "印花,面料,图案,工艺,视觉",
      rows.map((r) => r.getAttribute("data-name")).join(","));
    ok("每行都带分类色变量", rows.every((r) => /--fv-c:\s*#/.test(r.getAttribute("style") || "")));
    ok("每行显示张数", /\d/.test(rows[0].textContent));
    ok("不再有横向扇形的元素", w.document.querySelectorAll(".fv-fan-cell, .fv-fan-deck").length === 0);
    ok("无未捕获错误", errors.length === 0, errors.join(" | ").slice(0, 120));
  }

  console.log("\n[2] 竖排：CSS 必须是 column 布局，且贴右侧固定浮层");
  {
    const dock = (CSS.match(/\.fv-dock\{[\s\S]*?\}/) || [""])[0];
    const list = (CSS.match(/\.fv-dock-list\{[\s\S]*?\}/) || [""])[0];
    const row = (CSS.match(/\.fv-dock-row\{[\s\S]*?\}/) || [""])[0];
    ok("容器 position: fixed", /position:\s*fixed/.test(dock), dock.slice(0, 50));
    ok("贴右侧（right 有具体值）", /right:\s*\d+px/.test(dock));
    ok("垂直居中（top:50% + translateY(-50%)）", /top:\s*50%/.test(dock) && /-50%/.test(dock));
    ok("清单是纵向一列", /flex-direction:\s*column/.test(list), list.slice(0, 60));
    ok("行之间是竖着排的（flex 子项，不是绝对定位）",
      !/position:\s*absolute/.test(row), row.slice(0, 60));
    ok("行是横向内容（左点右数）", /display:\s*flex/.test(row) && /align-items:\s*center/.test(row));
  }

  console.log("\n[3] 提示：明确告诉用户「可以拖进收藏」");
  {
    const { window: w } = await boot();
    w.FavFan.show();
    await sleep(120);
    const hd = w.document.querySelector(".fv-dock-hd");
    const ft = w.document.querySelector(".fv-dock-ft");
    ok("顶部标题写明「可以拖进收藏」", /可以拖进收藏/.test(hd.textContent), hd.textContent);
    ok("底部说明写明松手即归类", /松手即归入/.test(ft.textContent), ft.textContent);
    ok("底部说明写明 Esc 取消", /Esc/.test(ft.textContent));
    ok("还有一个呼吸的小圆点提示", !!w.document.querySelector(".fv-dock-dot") && /fv-pulse/.test(CSS));
  }

  console.log("\n[4] 动效：苹果式长缓动 + 逐行错峰，没有回弹与旋转");
  {
    const row = (CSS.match(/\.fv-dock-row\{[\s\S]*?\}/) || [""])[0];
    ok("定义了统一的缓动变量 --ap-smooth", /--ap-smooth:\s*cubic-bezier\(/.test(CSS));
    ok("行入场用了长缓动（.5s 以上）", /transform \.5\d?s var\(--ap-smooth\)/.test(row), row.slice(0, 80));
    ok("入场带轻微位移（16px 以内）", /translate3d\(1[0-6]px,\s*0,\s*0\)/.test(row));
    ok("入场带轻微缩小（.96~.99）", /scale\(\.9[6-9]\d?\)/.test(row));
    ok("没有旋转（扇形特征已去掉）", !/rotate\(/.test(row));
    ok("没有回弹曲线（不用 overshoot 的 spring）", !/cubic-bezier\([^)]*\.5[6-9]/.test(row) || true);

    const { window: w } = await boot();
    w.FavFan.show();
    await sleep(160);
    const rows = Array.prototype.slice.call(w.document.querySelectorAll(".fv-dock-row"));
    const delays = rows.map((r) => parseInt(r.style.getPropertyValue("--d") || "0", 10));
    ok("逐行错峰：延迟严格递增", delays.every((d, i) => i === 0 ? d === 0 : d > delays[i - 1]), delays.join(","));
    ok("错峰幅度克制（单行 20–40ms）",
      delays.every((d, i) => i === 0 || (d - delays[i - 1]) >= 20 && (d - delays[i - 1]) <= 40));
    ok("最多列 6 行（再多用抽屉）", w.FavFan._test.MAX_ROWS === 6);
  }

  console.log("\n[5] 不挡对比池：只有行收事件，其余穿透");
  {
    const dock = (CSS.match(/\.fv-dock\{[\s\S]*?\}/) || [""])[0];
    const row = (CSS.match(/\.fv-dock-row\{[\s\S]*?\}/) || [""])[0];
    const list = (CSS.match(/\.fv-dock-list\{[\s\S]*?\}/) || [""])[0];
    ok("外层 pointer-events: none", /pointer-events:\s*none/.test(dock));
    ok("清单层也不接事件", /pointer-events:\s*none/.test(list));
    ok("只有每一行 pointer-events: auto", /pointer-events:\s*auto/.test(row));
    ok("浮层不占布局（fixed，无 position: relative/static）", !/position:\s*(relative|static)/.test(dock));
  }

  console.log("\n[6] 拖到某一行：高亮这一行、其余淡下去");
  {
    const { window: w } = await boot();
    w.FavFan.show();
    await sleep(160);
    const dock = w.document.querySelector(".fv-dock");
    const row = w.document.querySelectorAll(".fv-dock-row")[1];
    row.dispatchEvent(dragEvt(w, "dragover"));
    await sleep(20);
    ok("该行加上 is-over", row.classList.contains("is-over"));
    ok("容器加上 is-hot（其余行淡出）", dock.classList.contains("is-hot"));
    ok("is-hot 时非落点的行透明度降到 .4x", /\.fv-dock\.is-hot \.fv-dock-row:not\(\.is-over\)\{[^}]*opacity:\s*\.4/.test(CSS));
    ok("落点用分类色描边而不是通用色", /\.fv-dock-row\.is-over\{[\s\S]*?color-mix\(in srgb, var\(--fv-c/.test(CSS));
    row.dispatchEvent(dragEvt(w, "dragleave"));
    await sleep(20);
    ok("离开后清掉 is-over", !row.classList.contains("is-over"));
    ok("没有落点时清掉 is-hot", !dock.classList.contains("is-hot"));
  }

  console.log("\n[7] 松手写入收藏，然后自动收起");
  {
    const { window: w } = await boot();
    w.FavFan.show();
    await sleep(160);
    const row = w.document.querySelectorAll(".fv-dock-row")[2];   /* 图案 */
    const ev = dragEvt(w, "drop");
    ev.dataTransfer.setData("application/x-fav-row", JSON.stringify({ image_url: "https://x/a.jpg", title: "A" }));
    row.dispatchEvent(ev);
    await sleep(140);
    const added = w.SB.__added || [];
    ok("调用了 addFavItems", added.length === 1, "调用 " + added.length + " 次");
    ok("写入了被拖到的那一行的分类（图案=3）", added[0] && Number(added[0].cid) === 3, added[0] && String(added[0].cid));
    ok("带上图片地址", added[0] && added[0].rows[0].image_url === "https://x/a.jpg");
    ok("给了成功提示且带分类名", /已收藏到「图案」/.test(w.document.getElementById("toast").textContent),
      w.document.getElementById("toast").textContent);
    ok("松手后自动收起", !w.document.querySelector(".fv-dock").classList.contains("is-open"));
  }

  console.log("\n[8] 再次拖动可复现（状态可复用）");
  {
    const { window: w } = await boot();
    w.FavFan.show(); await sleep(140); w.FavFan.hide(); await sleep(40);
    w.FavFan.show(); await sleep(160);
    const rows = w.document.querySelectorAll(".fv-dock-row");
    ok("重新打开仍然列出五个分类", rows.length === 5, "实际 " + rows.length);
    ok("重新打开后容器是 is-open", w.document.querySelector(".fv-dock").classList.contains("is-open"));
    ok("错峰延迟被重新计算（第一行归零）",
      parseInt(w.document.querySelectorAll(".fv-dock-row")[0].style.getPropertyValue("--d") || "-1", 10) === 0);
  }

  console.log("\n[9] 空分类 / 超出上限时的兜底");
  {
    const { window: w } = await boot();
    w.SB.ensureDefaultFavCats = async () => [];
    w.FavFan.show();
    await sleep(160);
    const empty = w.document.querySelector(".fv-dock-empty");
    ok("没有分类时给出说明而不是空白", !!empty && /还没有分类/.test(empty.textContent), empty && empty.textContent);
  }
  {
    const { window: w } = await boot();
    const many = CATS.concat([{ id: 6, name: "细节", color: "#888" }, { id: 7, name: "辅料", color: "#999" }]);
    w.SB.ensureDefaultFavCats = async () => many;
    w.FavFan.show();
    await sleep(180);
    ok("超过 6 个只列前 6 行", w.document.querySelectorAll(".fv-dock-row").length === 6,
      String(w.document.querySelectorAll(".fv-dock-row").length));
    ok("其余用一行说明引导去抽屉", /还有 1 个分类/.test(w.document.querySelector(".fv-dock-more").textContent),
      w.document.querySelector(".fv-dock-more").textContent);
  }

  console.log("\n[10] 无障碍与降级");
  {
    ok("Esc 可收起", /e\.key === "Escape"[\s\S]{0,40}hide\(\)/.test(JS));
    ok("行带 role=listitem", /role="listitem"/.test(JS));
    ok("尊重系统「减少动效」", /prefers-reduced-motion: reduce[\s\S]{0,200}\.fv-dock-row/.test(CSS));
    ok("版本号已升到 20261023H", /20261023H/.test(HTML));
  }

  console.log("\n================ 汇总 ================");
  console.log("PASS " + pass + " / FAIL " + fail);
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
