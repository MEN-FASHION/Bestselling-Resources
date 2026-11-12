/* ============================================================
 * find-similar.js —— 前台大图「找相似款」（站外以图搜图）
 * ------------------------------------------------------------
 * 做了什么：
 *   在任何页面点开一张图（视觉专区 / 趋势上升榜 / 上新节奏 / Pinterest / SHEIN
 *   专区 / 渠道对比 / 收藏夹 …），图片右下角出现「找相似款」。
 *   点一下就用这张图的地址去 Google 以图搜图，换引擎可切 Bing / Yandex / TinEye。
 *
 * 为什么不需要后端：
 *   站里的图都是可直连的 http(s) 地址，而主流以图搜图都支持「按图片地址搜索」，
 *   拼一个搜索链接新开标签就行，不下载再上传、不写库、不加接口。
 *
 * 例外：
 *   有的图直连失败时页面会退化成页面内临时地址（blob:/data:），
 *   这种地址丢给外部站点一定是空搜索页 —— 所以改为「下载原图 + 打开搜索首页」并说明原因。
 *
 * 与各页面的关系：
 *   不依赖任何页面的具体 id / 类名。判断方式为「当前是否有覆盖层，覆盖层里最大的那张图」，
 *   所以哪一页、以后新加的页面都自动生效，不用逐页对接。
 * ============================================================ */
(function () {
  "use strict";
  if (window.__findSimilarReady) return;
  window.__findSimilarReady = true;

  var MIN_SIDE = 240;          /* 认定为「放大图」的最小边长 */
  var ENGINES = [
    { key: "google", name: "Google 以图搜图", url: function (u) { return "https://lens.google.com/uploadbyurl?url=" + encodeURIComponent(u); } },
    { key: "bing", name: "Bing 图片", url: function (u) { return "https://www.bing.com/images/searchbyimage/upload?cbir=sbi&imgurl=" + encodeURIComponent(u); } },
    { key: "yandex", name: "Yandex 图片", url: function (u) { return "https://yandex.com/images/search?rpt=imageview&url=" + encodeURIComponent(u); } },
    { key: "tineye", name: "TinEye 反查", url: function (u) { return "https://tineye.com/search?url=" + encodeURIComponent(u); } },
    { key: "gimg", name: "Google 图片（兼容入口）", url: function (u) { return "https://www.google.com/searchbyimage?image_url=" + encodeURIComponent(u); } }
  ];

  var cssDone = false;
  function ensureCss() {
    if (cssDone) return;
    cssDone = true;
    var st = document.createElement("style");
    st.textContent = [
      ".fs-wrap{position:fixed;z-index:2147483000;display:none;font-family:inherit;}",
      ".fs-wrap.on{display:flex;align-items:center;gap:0;}",
      ".fs-main{cursor:pointer;border:1px solid rgba(255,255,255,.28);background:rgba(17,24,39,.86);",
      "color:#fff;font-size:12.5px;line-height:1;padding:9px 13px;border-radius:9px 0 0 9px;",
      "display:flex;align-items:center;gap:6px;backdrop-filter:blur(4px);white-space:nowrap;}",
      ".fs-main:hover{background:rgba(37,99,235,.92);}",
      ".fs-more{cursor:pointer;border:1px solid rgba(255,255,255,.28);border-left:none;",
      "background:rgba(17,24,39,.86);color:#fff;font-size:11px;padding:9px 9px;border-radius:0 9px 9px 0;}",
      ".fs-more:hover{background:rgba(37,99,235,.92);}",
      ".fs-menu{position:fixed;z-index:2147483001;display:none;min-width:190px;background:#fff;",
      "border:1px solid #e2e5ea;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:6px;overflow:hidden;}",
      ".fs-menu.on{display:block;}",
      ".fs-item{display:block;width:100%;text-align:left;background:none;border:0;padding:8px 10px;",
      "font-size:13px;color:#2b2b2b;border-radius:7px;cursor:pointer;font-family:inherit;}",
      ".fs-item:hover{background:#f2f5f9;}",
      ".fs-sep{height:1px;background:#eef0f3;margin:5px 4px;}",
      ".fs-tip{position:fixed;z-index:2147483002;max-width:280px;background:rgba(17,24,39,.92);color:#fff;",
      "font-size:12px;line-height:1.55;padding:9px 12px;border-radius:9px;display:none;}",
      ".fs-tip.on{display:block;}",
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- 元素与状态 ---------- */
  var wrap = null, btnMain = null, btnMore = null, menu = null, tip = null;
  var curUrl = "";
  var tipTimer = null;

  function build() {
    ensureCss();
    wrap = document.createElement("div");
    wrap.className = "fs-wrap";

    btnMain = document.createElement("div");
    btnMain.className = "fs-main";
    btnMain.setAttribute("role", "button");
    btnMain.setAttribute("tabindex", "0");
    btnMain.title = "用这张图去站外找相似款";
    btnMain.innerHTML = '<span aria-hidden="true">\u2315</span><span>找相似款</span>';

    btnMore = document.createElement("div");
    btnMore.className = "fs-more";
    btnMore.setAttribute("role", "button");
    btnMore.title = "换一个搜索引擎";
    btnMore.textContent = "\u25be";

    wrap.appendChild(btnMain);
    wrap.appendChild(btnMore);
    document.body.appendChild(wrap);

    menu = document.createElement("div");
    menu.className = "fs-menu";
    ENGINES.forEach(function (e) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "fs-item";
      b.textContent = e.name;
      b.onclick = function (ev) {
        ev.stopPropagation();
        openSearch(curUrl, e);
        hideMenu();
      };
      menu.appendChild(b);
    });
    var sep = document.createElement("div");
    sep.className = "fs-sep";
    menu.appendChild(sep);
    var dl = document.createElement("button");
    dl.type = "button";
    dl.className = "fs-item";
    dl.textContent = "下载原图";
    dl.onclick = function (ev) { ev.stopPropagation(); download(curUrl); hideMenu(); };
    menu.appendChild(dl);
    document.body.appendChild(menu);

    tip = document.createElement("div");
    tip.className = "fs-tip";
    document.body.appendChild(tip);

    btnMain.onclick = function (e) { e.stopPropagation(); openSearch(curUrl, ENGINES[0]); };
    btnMain.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSearch(curUrl, ENGINES[0]); } };
    btnMore.onclick = function (e) { e.stopPropagation(); toggleMenu(); };
    menu.onclick = function (e) { e.stopPropagation(); };
    document.addEventListener("click", function () { hideMenu(); }, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
  }

  function hideMenu() { if (menu) menu.classList.remove("on"); }

  function toggleMenu() {
    if (!menu) return;
    if (menu.classList.contains("on")) { hideMenu(); return; }
    var r = btnMore.getBoundingClientRect();
    menu.classList.add("on");
    var mw = menu.offsetWidth || 200;
    var mh = menu.offsetHeight || 220;
    var left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  /* ---------- 判定「当前放大的那张图」 ---------- */
  function clsOf(n) {
    var c = n.className;
    if (typeof c === "string") return c;
    if (c && typeof c.baseVal === "string") return c.baseVal;
    return "";
  }

  var OVERLAY_CLS = /modal|lightbox|viewer|zoom|popup|overlay|mask|preview|big-?img|enlarge/i;

  function inOverlay(im) {
    var n = im.parentElement || im.parentNode, d = 0;
    while (n && n !== document.body && d < 9) {
      var cs = null;
      try { cs = window.getComputedStyle(n); } catch (e) { cs = null; }
      if (cs && (cs.position === "fixed" || cs.position === "absolute")) {
        var z = parseInt(cs.zIndex, 10);
        if (!isNaN(z) && z >= 10) return true;
      }
      if (OVERLAY_CLS.test(clsOf(n))) return true;
      n = n.parentElement || n.parentNode;
      d++;
    }
    return false;
  }

  /* 有没有铺满屏幕的遮罩层（有的页面用 .modal-mask 包住大图） */
  function hasFullMask() {
    var all = document.querySelectorAll("div,section");
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (!n.getBoundingClientRect) continue;
      var cs;
      try { cs = window.getComputedStyle(n); } catch (e) { continue; }
      if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
      var op = parseFloat(cs.opacity);
      if (!isNaN(op) && op === 0) continue;
      var r = n.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.6 && r.height >= window.innerHeight * 0.5) return true;
    }
    return false;
  }

  var lastClickSrc = "";

  function okBox(r) {
    return r.width >= MIN_SIDE && r.height >= MIN_SIDE &&
      !(r.right < 40 || r.left > window.innerWidth - 40) &&
      !(r.bottom < 40 || r.top > window.innerHeight - 40);
  }

  /* 优先看「刚刚点的那张图」：省掉整页遍历，图片多的页面也不会卡 */
  function pickClicked(mask) {
    if (!lastClickSrc) return null;
    var imgs = document.images || [];
    var best = null, bestArea = 0;
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      var src = im.currentSrc || im.src || "";
      if (src !== lastClickSrc) continue;
      var r = im.getBoundingClientRect();
      if (!okBox(r)) continue;
      if (!mask && !inOverlay(im)) continue;
      var area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = { el: im, r: r, src: src }; }
    }
    return best;
  }

  function pick() {
    var imgs = document.images || [];
    var mask = null;
    var best = null, bestArea = 0;
    mask = hasFullMask();
    var quick = pickClicked(mask);
    if (quick) return quick;
    mask = null;
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      var src = im.currentSrc || im.src || "";
      if (!src) continue;
      var r = im.getBoundingClientRect();
      if (r.width < MIN_SIDE || r.height < MIN_SIDE) continue;
      if (r.right < 40 || r.left > window.innerWidth - 40) continue;
      if (r.bottom < 40 || r.top > window.innerHeight - 40) continue;
      if (mask === null) mask = hasFullMask();
      if (!mask && !inOverlay(im)) continue;
      var area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = { el: im, r: r, src: src }; }
    }
    return best;
  }

  /* ---------- 显示 / 定位 / 隐藏 ---------- */
  var last = null;

  function place() {
    if (!wrap || !wrap.classList.contains("on") || !last) return;
    var r = last.el.getBoundingClientRect();
    if (!r.width) { hide(); return; }
    var right = window.innerWidth - r.right + 12;
    var bottom = window.innerHeight - r.bottom + 12;
    if (right < 8) right = 8;
    if (bottom < 8) bottom = 8;
    if (right > window.innerWidth - 120) right = 8;
    if (bottom > window.innerHeight - 60) bottom = 8;
    wrap.style.right = right + "px";
    wrap.style.bottom = bottom + "px";
  }

  function hide() {
    if (wrap) wrap.classList.remove("on");
    hideMenu();
    last = null;
  }

  var lastScanAt = 0;
  function scan() {
    var now = Date.now();
    if (now - lastScanAt < 200) return;      /* 节流：属性变化很频繁也不能反复强制布局 */
    lastScanAt = now;
    var hit = pick();
    if (!hit) { hide(); return; }
    if (!wrap) build();
    last = hit;
    curUrl = hit.src;
    wrap.classList.add("on");
    place();
  }

  var pending = null;
  function scanSoon(delay) {
    clearTimeout(pending);
    pending = setTimeout(scan, delay == null ? 90 : delay);
  }

  /* ---------- 打开搜索 ---------- */
  function isPublic(u) {
    return /^https?:\/\//i.test(String(u || ""));
  }

  function showTip(msg) {
    if (!tip) return;
    tip.textContent = msg;
    tip.classList.add("on");
    var r = wrap ? wrap.getBoundingClientRect() : { top: 0, left: 0 };
    tip.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 300)) + "px";
    tip.style.top = Math.max(8, r.top - 52) + "px";
    clearTimeout(tipTimer);
    tipTimer = setTimeout(function () { tip.classList.remove("on"); }, 4200);
  }

  function openSearch(u, engine) {
    if (!u) return;
    if (!isPublic(u)) {
      /* 页面内临时地址（blob:/data:）：外部站点读不到，改为下载 + 打开搜索首页 */
      showTip("这张图不是公开链接，已为你下载原图；把它拖进搜索框即可找相似款。");
      download(u);
      window.open("https://images.google.com/", "_blank", "noopener");
      return;
    }
    var url = engine.url(u);
    var w = window.open(url, "_blank", "noopener");
    if (!w) showTip("浏览器拦住了新标签页，请允许弹窗后重试。");
  }

  function download(u) {
    if (!u) return;
    try {
      var a = document.createElement("a");
      a.href = u;
      a.download = "image";
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 200);
    } catch (e) {
      window.open(u, "_blank", "noopener");
    }
  }

  /* ---------- 触发时机 ---------- */
  function boot() {
    build();
    /* 点任何地方后都看一眼：打开大图往往是点击后异步完成的 */
    document.addEventListener("click", function (ev) {
      try {
        var t = ev.target;
        var im = (t && t.tagName === "IMG") ? t : (t && t.closest ? t.closest("img") : null);
        if (im) lastClickSrc = im.currentSrc || im.src || "";
      } catch (e) { /* 忽略 */ }
      scanSoon(90);
      scanSoon(420);
      scanSoon(1200);      /* 大图若加载较慢，再补一次 */
    }, true);
    /* 只在 body 自身的 class/style 变化时补扫一次。
       刻意不监听子树：页面上图片卡片的 class 变化非常频繁，逐次全量测量会让页面变卡。 */
    try {
      var mo = new MutationObserver(function () { scanSoon(160); });
      mo.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    } catch (e) { /* 老浏览器忽略 */ }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { hide(); return; }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") scanSoon(200);
    });
    scanSoon(300);
  }

  window.FindSimilar = { scan: scan, hide: hide, open: function (u) { openSearch(u, ENGINES[0]); } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
