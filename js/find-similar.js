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
      /* 卡片悬停用的小胶囊：贴在图上方，独立浮层，不改页面结构 */
      ".fs-quick{position:fixed;z-index:2147482999;display:none;align-items:center;gap:4px;",
      "padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.5);",
      "background:rgba(17,24,39,.84);color:#fff;font-size:12px;line-height:1;cursor:pointer;",
      "font-family:inherit;white-space:nowrap;backdrop-filter:blur(4px);",
      "box-shadow:0 4px 14px rgba(0,0,0,.24);user-select:none;}",
      ".fs-quick:hover{background:rgba(37,99,235,.94);}",
      ".fs-quick.on{display:inline-flex;}",
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
    hideQuick();                     /* 大图按钮出来了，卡片上的小胶囊就收起 */
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
    var anchor = null;
    if (wrap && wrap.classList.contains("on")) anchor = wrap.getBoundingClientRect();
    else if (quick && quick.classList.contains("on")) anchor = quick.getBoundingClientRect();
    if (!anchor) anchor = { top: 80, left: window.innerWidth / 2 - 100 };
    tip.style.left = Math.max(8, Math.min(anchor.left, window.innerWidth - 300)) + "px";
    tip.style.top = Math.max(8, anchor.top - 52) + "px";
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
      /* 下载失败时只兜底打开公开地址；blob:/data: 这种打开也是白页，宁可不做 */
      if (isPublic(u)) window.open(u, "_blank", "noopener");
    }
  }

  /* ============================================================
   * 卡片悬停：鼠标移到图上，图上方浮出「搜同款」，点一下直接搜
   * ------------------------------------------------------------
   * 大图里那个按钮要先点开大图；列表里几十上百张图逐个点开太慢，
   * 所以再给卡片图加一层「悬停即出」的入口。
   *
   * 为什么不往卡片里插按钮：
   *   各页面卡片结构不同（有的 onclick 开弹层、有的可拖拽、有的带勾选框），
   *   插节点容易和这些交互打架。所以按钮做成独立的一层浮层，
   *   跟着鼠标悬停那张图的位置贴上去，页面结构一行都不用改。
   *   位置放「图的上方居中」，避开各卡片四角的星标、勾选框、角标。
   * ============================================================ */
  var QMIN = 72;                 /* 卡片图最小边长：再小的是图标/徽标，不做 */
  var quick = null, quickImg = null, quickSrc = "", quickTimer = null;

  function buildQuick() {
    if (quick) return;
    ensureCss();
    quick = document.createElement("div");
    quick.className = "fs-quick";
    quick.setAttribute("role", "button");
    quick.setAttribute("tabindex", "-1");
    quick.title = "用这张图去站外找相似款（Google 以图搜图）";
    quick.innerHTML = '<span aria-hidden="true">\u2315</span><span>搜同款</span>';
    document.body.appendChild(quick);
    /* 按下就先拦掉：卡片本身可拖拽/可点开大图，别被这两件事抢先 */
    quick.onmousedown = function (e) {
      if (!e) return;
      e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
    };
    quick.onmouseenter = function () { clearTimeout(quickTimer); };
    quick.onmouseleave = function () { scheduleHideQuick(); };
    quick.onclick = function (e) {
      if (e) {
        e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
      }
      openSearch(quickSrc, ENGINES[0]);
    };
  }

  /* 图标、徽标、头像、页头导航里的图不进候选 */
  var QUICK_SKIP_CLS = /(^|[\s_-])(logo|avatar|icon|sprite|qrcode|qr)([\s_-]|$)/i;

  function quickSkip(im) {
    if (QUICK_SKIP_CLS.test(clsOf(im))) return true;
    try {
      if (im.closest && im.closest("header,nav,.site-head,.topbar,.site-nav,.fs-skip")) return true;
    } catch (e) { /* 忽略 */ }
    return false;
  }

  /* 只在「弹层/灯箱」里才跳过悬停入口；
     不用 inOverlay 那套计算样式判断——列表容器本身常常是 absolute 定位，
     用计算样式判断会把正常卡片图误判成弹层大图，等于功能不出现。 */
  function inOverlayClass(im) {
    var n = im.parentElement || im.parentNode, d = 0;
    while (n && n !== document.body && d < 8) {
      if (OVERLAY_CLS.test(clsOf(n))) return true;
      n = n.parentElement || n.parentNode;
      d++;
    }
    return false;
  }

  function quickHit(t) {
    if (!t) return null;
    var im = null;
    if (t.tagName === "IMG") im = t;
    else if (t.closest) { try { im = t.closest("img"); } catch (e) { im = null; } }
    if (!im) return null;
    var src = im.currentSrc || im.src || "";
    if (!src) return null;
    if (quickSkip(im)) return null;
    var r = im.getBoundingClientRect();
    if (!r || r.width < QMIN || r.height < QMIN) return null;
    if (r.bottom < 8 || r.top > window.innerHeight - 8) return null;
    /* 已经在弹层/灯箱里放大的那张图，交给右下角那个按钮，这里不重复出 */
    if (inOverlayClass(im)) return null;
    if (wrap && wrap.classList.contains("on") && last && last.el === im) return null;
    return { el: im, r: r, src: src };
  }

  function placeQuick(r) {
    if (!quick) return;
    var w = quick.offsetWidth || 86, h = quick.offsetHeight || 26;
    var left = r.left + (r.width - w) / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
    var top = r.top + 6;
    if (top < 6) top = 6;
    if (top + h > r.bottom - 4) top = Math.max(6, r.bottom - h - 6);
    if (top + h > window.innerHeight - 6) top = window.innerHeight - h - 6;
    quick.style.left = left + "px";
    quick.style.top = top + "px";
  }

  function showQuick(hit) {
    buildQuick();
    clearTimeout(quickTimer);
    quickImg = hit.el;
    quickSrc = hit.src;
    placeQuick(hit.r);
    quick.classList.add("on");
  }

  function hideQuick() {
    clearTimeout(quickTimer);
    if (quick) quick.classList.remove("on");
    quickImg = null;
  }

  function scheduleHideQuick() {
    clearTimeout(quickTimer);
    quickTimer = setTimeout(hideQuick, 220);
  }

  /* 卡片范围的判定：停留在同一张卡片（角标、文字）上时不要让按钮闪掉 */
  function quickCard(im) {
    try {
      return im.closest ? im.closest("figure,li,.rk-card,.mv-card,.fv-card,.gthumb,.cmp-card,.card") : null;
    } catch (e) { return null; }
  }

  function hoverAllowed() {
    try {
      if (window.matchMedia && window.matchMedia("(hover: none)").matches) return false;
    } catch (e) { /* 忽略 */ }
    return true;
  }

  function wireHover() {
    if (!hoverAllowed()) return;    /* 触屏设备没有悬停，靠点开大图那个按钮 */
    document.addEventListener("mouseover", function (e) {
      var t = e.target;
      var hit = quickHit(t);
      if (hit) { showQuick(hit); return; }
      if (!quickImg || !quick || !quick.classList.contains("on")) return;
      if (t && t.closest) {
        var card = quickCard(quickImg);
        if (card && card.contains(t)) return;
        if (t.closest(".fs-quick")) return;
      }
      scheduleHideQuick();
    }, true);

    document.addEventListener("mouseout", function (e) {
      if (!quickImg) return;
      var to = e.relatedTarget;
      if (to) {
        if (to === quickImg) return;
        if (to.closest && to.closest(".fs-quick")) return;
        var card = quickCard(quickImg);
        if (card && card.contains(to)) return;
      }
      scheduleHideQuick();
    }, true);

    /* 滚动、改窗口大小时跟着图片走；图滚出屏幕就收起，别飘在别处 */
    window.addEventListener("scroll", function () {
      if (!quickImg || !quick || !quick.classList.contains("on")) return;
      var r = quickImg.getBoundingClientRect();
      if (r.width < QMIN || r.bottom < 8 || r.top > window.innerHeight - 8) { hideQuick(); return; }
      placeQuick(r);
    }, true);
    window.addEventListener("resize", function () {
      if (!quickImg || !quick) return;
      var r = quickImg.getBoundingClientRect();
      if (r.width < QMIN) { hideQuick(); return; }
      placeQuick(r);
    });
  }

  /* ---------- 触发时机 ---------- */
  function boot() {
    build();
    wireHover();
    /* 点任何地方后都看一眼：打开大图往往是点击后异步完成的 */
    document.addEventListener("click", function (ev) {
      var inQuick = false;
      try { inQuick = !!(ev.target && ev.target.closest && ev.target.closest(".fs-quick")); } catch (e) { inQuick = false; }
      if (inQuick) return;                 /* 点的是「搜同款」胶囊本身，不当作点了卡片 */
      hideQuick();                         /* 点了卡片（多半是开大图），小胶囊先收起 */
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

  window.FindSimilar = {
    scan: scan,
    hide: hide,
    open: function (u) { openSearch(u, ENGINES[0]); },
    quickHide: hideQuick,
    quickHit: quickHit
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
