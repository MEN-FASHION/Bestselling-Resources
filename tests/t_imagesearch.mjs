/* 20261111AC · 大图「站外找相似款」（以图搜图）自检
 *
 * 这块功能全在前端，出错方式很隐蔽：搜索引擎地址拼错、图片地址没做编码、
 * 把只在当前页面可见的 blob 地址丢给外部站点（对方取不到，等于打开一个空搜索页），
 * 或者某个前台页面忘了引脚本（那个页面就没有按钮）。
 * 所以这里既查静态接入，也用最小 DOM 桩真实跑一遍模块，验证 URL 与降级分支。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

const SRC = read("js/imagesearch.js");
const CSS = read("css/style.css");

/* ---------- 1. 基本结构 ---------- */
ok(/window\.ImageSearch\s*=/.test(SRC), "未对外暴露 ImageSearch");
ok(/^\s*\(function \(\) \{/m.test(SRC) || /\(function \(\)\s*\{/.test(SRC), "应以 IIFE 包裹，避免污染全局");
ok(/lens\.google\.com\/uploadbyurl\?url=/.test(SRC), "缺少 Google Lens「按图片地址搜索」入口");
ok(/encodeURIComponent\(u\)/.test(SRC), "图片地址必须编码，否则带参数的链接会拼断");
ok(/searchbyimage\?image_url=/.test(SRC), "缺少 Google 图片兼容入口");
ok(/bing\.com\/images\/searchbyimage/.test(SRC), "缺少 Bing 以图搜图");
ok(/yandex\.com\/images\/search\?rpt=imageview/.test(SRC), "缺少 Yandex 以图搜图");
ok(/tineye\.com\/search\?url=/.test(SRC), "缺少 TinEye 反查");

/* ---------- 2. 大图容器覆盖 ---------- */
const SLOT_SRC = SRC.slice(SRC.indexOf("var SLOTS"), SRC.indexOf("];", SRC.indexOf("var SLOTS")) + 2);
[["#lb-img", "#lightbox"], ["#mv-big", "#mv-modal"], ["#cz-big", "#cz-modal"],
 ["#cmp-big", "#cmp-modal"], ["#plz-lb", "#plz-lb"], [".rk-zoom-ov", ".rk-zoom-ov"]].forEach(([sel, host]) => {
  ok(SLOT_SRC.includes(sel) && SLOT_SRC.includes(host), "未覆盖大图容器：" + host);
});

/* 站点里真实存在的每个大图容器都必须在覆盖清单里 */
const BIG_IDS = ["lb-img", "mv-big", "cz-big", "cmp-big", "plz-lb"];
BIG_IDS.forEach((id) => {
  const used = ["index.html", "movement.html", "pinterest.html", "shein.html", "compare.html", "plus.html"]
    .some((f) => read(f).includes('id="' + id + '"'));
  if (used) ok(SLOT_SRC.includes("#" + id), "页面用了 #" + id + " 但模块没覆盖");
});
ok(/rk-zoom-ov/.test(read("js/rank.js")), "趋势上升榜放大层类名变了？模块依赖 .rk-zoom-ov");

/* ---------- 3. 每个有大图的页面都引了脚本 ---------- */
const PAGES = ["index.html", "rank.html", "movement.html", "pinterest.html", "shein.html",
  "compare.html", "plus.html", "rhythm.html", "fav.html", "trends.html"];
PAGES.forEach((p) => {
  ok(/js\/imagesearch\.js\?v=/.test(read(p)), p + " 未引入 imagesearch.js（该页面不会有按钮）");
});
/* 引到 </body> 前，保证 DOM 已在 */
PAGES.forEach((p) => {
  const s = read(p);
  const i = s.indexOf("imagesearch.js");
  if (i < 0) return;
  ok(i < s.lastIndexOf("</body>"), p + " 中 imagesearch.js 应在 </body> 之前");
});

/* ---------- 4. 样式 ---------- */
ok(/\.imgsearch-bar\s*\{/.test(CSS), "缺少悬浮按钮样式");
ok(/\.imgsearch-menu\s*\{/.test(CSS) && /\.imgsearch-menu\.hidden\s*\{/.test(CSS), "缺少下拉菜单样式或隐藏态");
ok(/position:\s*fixed/.test(CSS.slice(CSS.indexOf(".imgsearch-bar"))), "按钮应固定定位，滚到哪都能点");

/* ---------- 5. 最小 DOM 桩：真跑模块 ---------- */
function makeDom(bigSrc, hostHidden) {
  const mkEl = (tag) => {
    const el = {
      tagName: (tag || "div").toUpperCase(),
      style: {}, children: [], attrs: {}, textContent: "", innerHTML: "",
      isConnected: true, offsetWidth: 100, offsetHeight: 40,
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); }, toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      },
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
      addEventListener() {},
      removeEventListener() {},
      click() { this._clicked = true; },
      getBoundingClientRect() { return { width: 100, height: 40, left: 10, top: 10, right: 110, bottom: 50 }; },
      contains() { return false; },
      get currentSrc() { return this._src || ""; },
      get src() { return this._src || ""; },
      set src(v) { this._src = v; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    };
    return el;
  };

  const body = mkEl("body");
  const bigImg = mkEl("img");
  bigImg.src = bigSrc;
  const host = mkEl("div");
  if (hostHidden) host.classList.add("hidden");

  const document = {
    readyState: "complete",
    body,
    documentElement: body,
    addEventListener() {},
    createElement: mkEl,
    getElementById(id) { return id === "toast" ? null : null; },
    querySelector(sel) {
      if (sel === "#lightbox" || sel === "#mv-modal" || sel === "#cz-modal" || sel === "#cmp-modal" || sel === "#plz-lb" || sel === ".rk-zoom-ov") {
        /* 只有 #mv-modal 的场景下，其余 host 返回不可见（不存在） */
        return sel === "#mv-modal" ? host : null;
      }
      if (sel === "#lb-img" || sel === "#mv-big") return bigImg;
      if (sel === "#plz-lb img" || sel === ".rk-zoom-ov img") return bigImg;
      return null;
    },
    querySelectorAll() { return []; },
  };

  const opened = [];
  const win = {
    document,
    console,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    MutationObserver: function () { return { observe() {} }; },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    innerWidth: 1280, innerHeight: 800,
    addEventListener() {},
    open(url) { opened.push(url); return { closed: false }; },
    ImageSearch: null,
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  vm.createContext(win);
  vm.runInContext(SRC, win, { filename: "imagesearch.js" });
  return { win, opened, bigImg, host };
}

/* 5a. http 图片 → 直接打开 Google Lens，地址正确编码 */
{
  const d = makeDom("https://cdn.example.com/a/b c.jpg?x=1&y=2", false);
  ok(!!d.win.ImageSearch, "模块在桩环境里没挂上（可能依赖了浏览器专有 API）");
  const cur = d.win.ImageSearch.current();
  ok(cur && cur.src === "https://cdn.example.com/a/b c.jpg?x=1&y=2", "未能识别当前大图");
  ok(cur.kind === "remote", "http 图片应判定为 remote");
  d.win.ImageSearch.search("lens");
  ok(d.opened.length === 1, "点一次应只打开一个标签，实际 " + d.opened.length);
  const u = d.opened[0] || "";
  ok(u.startsWith("https://lens.google.com/uploadbyurl?url="), "应跳 Lens 按图片地址搜索，实际：" + u.slice(0, 40));
  ok(!/[ "]/.test(u), "URL 里的空格应被编码");
  ok(u.indexOf("%3F") >= 0 || u.indexOf("%26") >= 0, "查询参数应被整体编码（%3F/%26）");
}
/* 5b. blob 图片 → 不硬跳外部站点（对方取不到），改用下载 + 打开上传页 */
{
  const d = makeDom("blob:https://site/abcd-1234", false);
  const cur = d.win.ImageSearch.current();
  ok(cur && cur.kind === "local", "blob 图片应判定为 local");
  d.win.ImageSearch.search("lens");
  ok(d.opened.length === 1 && d.opened[0] === "https://lens.google.com/",
    "blob 图应打开上传页而不是带 blob 地址的搜索页，实际：" + d.opened[0]);
  ok(d.opened.every((u) => !u.includes("blob:")), "绝不能把 blob 地址拼进搜索链接");
}
/* 5c. data: 图片同样走降级分支 */
{
  const d = makeDom("data:image/png;base64,AAAA", false);
  ok(d.win.ImageSearch.current().kind === "local", "data: 图片应判定为 local");
}
/* 5d. 弹层关闭（hidden）时不应出现按钮 */
{
  const d = makeDom("https://cdn.example.com/a.jpg", true);
  ok(!d.win.ImageSearch.current(), "大图弹层隐藏时不应识别为「正在看大图」");
}
/* 5e. 各引擎地址可用 */
{
  const d = makeDom("https://cdn.example.com/a.jpg", false);
  const url = "https://cdn.example.com/a.jpg?w=800&h=1000";
  d.win.ImageSearch.engines.forEach((e) => {
    const built = e.build(url);
    ok(/^https:\/\//.test(built), e.name + " 不是 https 地址");
    ok(built.includes(encodeURIComponent(url)), e.name + " 未对图片地址编码");
    ok(!/[ "]/.test(built), e.name + " 地址含未编码空格");
  });
}
/* 5f. 指定引擎（不走当前大图） */
{
  const d = makeDom("", false);
  const before = d.opened.length;
  d.win.ImageSearch.searchUrl("https://cdn.example.com/x.jpg", "bing");
  ok(d.opened.length === before + 1, "searchUrl 未打开新标签");
  ok((d.opened[d.opened.length - 1] || "").includes("bing.com/images/searchbyimage"), "searchUrl 未按指定引擎跳转");
}

/* ---------- 6. 不写库 ---------- */
ok(!/SB\.|listRankItems|insert|update\(/i.test(SRC), "该模块应只做只读跳转，不应触达数据层");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
