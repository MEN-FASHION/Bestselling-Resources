/* ============================================================
 * find-similar.js —— 前台大图「找相似款」（站外以图搜图）
 * ------------------------------------------------------------
 * 做了什么：
 *   在任何页面点开一张图（视觉专区 / 趋势上升榜 / 上新节奏 / Pinterest / SHEIN
 *   专区 / 渠道对比 / 收藏夹 …），图片右下角出现「找相似款」。
 *   列表里的卡片图更是鼠标一放上去，图片正中就浮出「搜同款」，点一下直接搜。
 *
 * 分屏（主要用法）：
 *   点「搜同款」后，在窗口右半边开一个结果窗，页面主体往左让位，
 *   左半继续挑图、右半看结果；再点别的图只换右侧内容，结果窗始终复用同一个。
 *   这样「看一张 → 点下一张」不用来回切标签。
 *   打开方式可在「▾」菜单里切成新标签。
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
      /* 卡片悬停用的胶囊：放在图片正中（translate 居中），独立浮层，不改页面结构 */
      ".fs-quick{position:fixed;z-index:2147482999;display:none;align-items:center;gap:6px;",
      "transform:translate(-50%,-50%);",
      "padding:10px 18px;border-radius:999px;border:1px solid rgba(255,255,255,.55);",
      "background:rgba(17,24,39,.86);color:#fff;font-size:13px;line-height:1;cursor:pointer;",
      "font-family:inherit;white-space:nowrap;backdrop-filter:blur(6px);",
      "box-shadow:0 8px 22px rgba(0,0,0,.34);user-select:none;",
      "transition:background .15s ease, box-shadow .15s ease;}",
      ".fs-quick:hover{background:rgba(37,99,235,.95);box-shadow:0 10px 26px rgba(37,99,235,.42);}",
      ".fs-quick.on{display:inline-flex;}",
      ".fs-quick .fs-q-ico{font-size:15px;line-height:1;}",
      /* 分屏：右侧结果窗口占去的地方，页面主体相应让位，避免被窗口压住 */
      "html.fs-split body.front, html.fs-split body.admin, html.fs-split body.mk-page{",
      "padding-right:clamp(0px, var(--fs-cut, 50vw), 62vw) !important;}",
      /* 分屏状态条：左下角常驻，可一键退出 */
      ".fs-splitbar{position:fixed;z-index:2147482998;left:14px;bottom:14px;display:none;",
      "align-items:center;gap:8px;padding:7px 10px 7px 12px;border-radius:10px;",
      "background:rgba(17,24,39,.9);color:#eef2f7;font-size:12px;line-height:1.2;",
      "font-family:inherit;box-shadow:0 8px 22px rgba(0,0,0,.28);backdrop-filter:blur(6px);}",
      ".fs-splitbar.on{display:flex;}",
      ".fs-splitbar .fs-sb-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;",
      "box-shadow:0 0 0 3px rgba(74,222,128,.22);flex:0 0 auto;}",
      ".fs-splitbar .fs-sb-txt{max-width:240px;}",
      ".fs-sb-x{cursor:pointer;border:1px solid rgba(255,255,255,.28);background:transparent;",
      "color:#fff;font-size:11.5px;font-family:inherit;padding:5px 9px;border-radius:7px;line-height:1;}",
      ".fs-sb-x:hover{background:rgba(239,68,68,.86);border-color:transparent;}",
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- 元素与状态 ---------- */
  var wrap = null, btnMain = null, btnMore = null, menu = null, tip = null;
  var curUrl = "";
  var tipTimer = null;

  /* ---------- 分屏结果窗 ----------
   * 「把浏览器拆两半」：点搜同款时，在窗口右半边开一个结果窗（同一窗复用），
   * 页面主体相应往左让位，于是左半继续挑图、右半看结果。
   * 用独立窗口而不是页面内 iframe：Google/Bing/Yandex 都禁止被嵌入，
   * iframe 必然是空白页，只有真窗口才看得见结果。
   */
  var PANE_NAME = "tb_find_similar_pane";
  var SPLIT_KEY = "tb.fs.split";
  var paneWin = null;
  var paneWatch = null;
  var splitBar = null;
  var splitCut = 0;
  var splitPref = null;
  var splitItem = null, closeItem = null;

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

    /* 打开方式：分屏（默认）/ 新标签 */
    splitItem = document.createElement("button");
    splitItem.type = "button";
    splitItem.className = "fs-item";
    splitItem.onclick = function (ev) {
      ev.stopPropagation();
      setSplit(!getSplit());
      syncMenu();
    };
    menu.appendChild(splitItem);

    /* 关掉右侧结果窗（只在分屏开着且有窗口时出现） */
    closeItem = document.createElement("button");
    closeItem.type = "button";
    closeItem.className = "fs-item";
    closeItem.textContent = "关闭分屏结果窗";
    closeItem.onclick = function (ev) { ev.stopPropagation(); exitSplit(true); hideMenu(); };
    menu.appendChild(closeItem);

    var sep2 = document.createElement("div");
    sep2.className = "fs-sep";
    menu.appendChild(sep2);

    var dl = document.createElement("button");
    dl.type = "button";
    dl.className = "fs-item";
    dl.textContent = "下载原图";
    dl.onclick = function (ev) { ev.stopPropagation(); download(curUrl); hideMenu(); };
    menu.appendChild(dl);
    document.body.appendChild(menu);
    syncMenu();

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

  /* ============================================================
   * 分屏结果窗：把浏览器拆成左右两部分
   * ------------------------------------------------------------
   * 左半 = 本站（继续挑图，点下一张就换右侧结果）
   * 右半 = 以图搜图结果窗口
   *
   * 为什么用真窗口而不是页面内 iframe：
   *   Google Lens / Bing / Yandex 全部设置了 X-Frame-Options，iframe 里只会是空白，
   *   而且要按图搜必须能上传，iframe 也不允许。只有独立窗口能真正看到结果。
   *
   * 「拆一半」怎么做到：
   *   1) 结果窗按当前窗口的右半边开（拿 screenX / outerWidth 算，不写死屏幕尺寸）；
   *   2) 页面给 body 加右内边距，宽度正好等于结果窗宽度 —— 于是左半是站、右半是结果，
   *      互不遮挡，滚动和点击都在自己那一半里；
   *   3) 结果窗只开一次，之后再点任意图都复用同一个窗（只换地址），
   *      所以可以「看一张 → 点下一张」连续挑。
   * ============================================================ */
  function getSplit() {
    if (splitPref !== null) return splitPref;
    var v = null;
    try { v = window.localStorage ? window.localStorage.getItem(SPLIT_KEY) : null; } catch (e) { v = null; }
    splitPref = (v === "0") ? false : true;    /* 默认开：这是主要用法 */
    return splitPref;
  }

  function setSplit(on) {
    splitPref = !!on;
    try { if (window.localStorage) window.localStorage.setItem(SPLIT_KEY, on ? "1" : "0"); } catch (e) { /* 忽略 */ }
    if (!on) exitSplit(false);                  /* 关掉分屏只收起让位，不关用户的结果窗 */
    syncMenu();
  }

  /* 结果窗位置：贴着当前窗口的右半边，尺寸取自当前窗口而不是写死屏幕 */
  function splitGeom() {
    var wx = (typeof window.screenX === "number" && isFinite(window.screenX)) ? window.screenX : 0;
    var wy = (typeof window.screenY === "number" && isFinite(window.screenY)) ? window.screenY : 0;
    var ww = window.outerWidth || window.innerWidth || 1440;
    var wh = window.outerHeight || window.innerHeight || 900;
    var sc = window.screen || {};
    var paneW = Math.round(ww / 2);
    if (paneW < 420) paneW = Math.min(520, ww - 200);   /* 窗口太窄时别开成一条缝 */
    if (paneW < 320) paneW = 320;
    var av = sc.availWidth || ww;
    var left = wx + ww - paneW;
    if (left + paneW > av) left = av - paneW;
    if (left < 0) left = 0;
    var paneH = Math.min(sc.availHeight || wh, wh);
    return { left: Math.round(left), top: Math.round(wy), width: paneW, height: Math.round(paneH), cut: paneW };
  }

  function paneAlive() {
    if (!paneWin) return false;
    var closed = false;
    try { closed = !!paneWin.closed; }
    catch (e) { return true; }   /* 读不到就当还开着：宁可保留让位，也不要突然把页面拉宽 */
    if (closed) { paneWin = null; return false; }
    return true;
  }

  function watchPane() {
    if (paneWatch || typeof setInterval !== "function") return;
    paneWatch = setInterval(function () {
      if (!paneWin) return;
      if (!paneAlive()) {                    /* 用户自己把结果窗关了 → 让位同步解除 */
        if (paneWatch) { clearInterval(paneWatch); paneWatch = null; }
        exitSplitUI();
      }
    }, 900);
  }

  function buildSplitBar() {
    if (splitBar) return;
    ensureCss();
    splitBar = document.createElement("div");
    splitBar.className = "fs-splitbar";
    var dot = document.createElement("span");
    dot.className = "fs-sb-dot";
    splitBar.appendChild(dot);
    var txt = document.createElement("span");
    txt.className = "fs-sb-txt";
    txt.textContent = "分屏中 · 结果在右侧，继续点其它图即可切换";
    splitBar.appendChild(txt);
    var x = document.createElement("button");
    x.type = "button";
    x.className = "fs-sb-x";
    x.textContent = "退出分屏";
    x.onclick = function (e) { if (e && e.stopPropagation) e.stopPropagation(); exitSplit(true); };
    splitBar.appendChild(x);
    document.body.appendChild(splitBar);
  }

  /* 页面让位：右内边距 = 结果窗宽度 */
  function setCut(px) {
    splitCut = px || 0;
    var de = document.documentElement;
    if (!de) return;
    try {
      if (de.style && de.style.setProperty) de.style.setProperty("--fs-cut", splitCut + "px");
      else if (de.style) de.style["--fs-cut"] = splitCut + "px";
    } catch (e) { /* 忽略 */ }
    try { de.classList.add("fs-split"); } catch (e) { /* 忽略 */ }
  }

  function enterSplitUI(cut) {
    setCut(cut);
    buildSplitBar();
    if (splitBar) splitBar.classList.add("on");
    syncMenu();
  }

  function exitSplitUI() {
    try { if (document.documentElement) document.documentElement.classList.remove("fs-split"); } catch (e) { /* 忽略 */ }
    if (splitBar) splitBar.classList.remove("on");
    splitCut = 0;
    syncMenu();
  }

  /* 在右半边打开 / 切换到结果 */
  function openInPane(url) {
    var g = splitGeom();
    var feat = "popup=yes,width=" + g.width + ",height=" + g.height +
      ",left=" + g.left + ",top=" + g.top + ",resizable=yes,scrollbars=yes";
    var w = null;
    try { w = window.open(url, PANE_NAME, feat); } catch (e) { w = null; }
    if (!w) return false;                       /* 被弹窗拦截 → 交给调用方降级 */
    paneWin = w;
    enterSplitUI(g.cut);
    watchPane();
    /* 焦点还给本站：结果窗抢焦点后就点不了下一张图了（多数浏览器允许抢回） */
    setTimeout(function () { try { window.focus(); } catch (e) { /* 忽略 */ } }, 60);
    return true;
  }

  function exitSplit(closePane) {
    if (closePane && paneWin) { try { paneWin.close(); } catch (e) { /* 忽略 */ } }
    paneWin = null;
    if (paneWatch) { clearInterval(paneWatch); paneWatch = null; }
    exitSplitUI();
  }

  function syncMenu() {
    if (splitItem) {
      splitItem.textContent = "分屏打开结果：" + (getSplit() ? "开" : "关");
      splitItem.title = getSplit() ? "点一下改为新标签打开" : "点一下改为分屏打开（推荐）";
    }
    if (closeItem) {
      var on = getSplit() && !!paneWin;
      if (on) closeItem.classList.remove("hidden");
      else closeItem.classList.add("hidden");
    }
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

  /* 统一出口：分屏（默认）或新标签 */
  function openUrl(url) {
    if (getSplit()) {
      if (openInPane(url)) return true;
      var w2 = window.open(url, "_blank", "noopener");
      showTip(w2
        ? "分屏窗口被浏览器拦住了，已改为新标签打开；允许本站弹窗后即可恢复分屏。"
        : "浏览器拦住了新窗口，请允许本站弹窗后重试。");
      return false;
    }
    var w = window.open(url, "_blank", "noopener");
    if (!w) showTip("浏览器拦住了新标签页，请允许弹窗后重试。");
    return false;
  }

  function openSearch(u, engine) {
    if (!u) return;
    if (!isPublic(u)) {
      /* 页面内临时地址（blob:/data:）：外部站点读不到，改为下载 + 打开搜索首页 */
      showTip("这张图不是公开链接，已为你下载原图；把它拖进搜索框即可找相似款。");
      download(u);
      openUrl("https://images.google.com/");
      return;
    }
    openUrl(engine.url(u));
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
   *   位置放「图片正中」：四角已被星标、勾选框、月份徽标占着，中间最干净也最好点。
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
    quick.innerHTML = '<span class="fs-q-ico" aria-hidden="true">\u2315</span><span>搜同款</span>';
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

  /* 位置：图片正中（CSS 里用 translate(-50%,-50%) 居中，这里只给中心点坐标） */
  function placeQuick(r) {
    if (!quick) return;
    var halfW = 70, halfH = 20;
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var loX = Math.max(r.left + halfW, halfW + 4);
    var hiX = Math.min(r.right - halfW, window.innerWidth - halfW - 4);
    if (hiX < loX) cx = Math.max(halfW + 4, Math.min(cx, window.innerWidth - halfW - 4));
    else cx = Math.max(loX, Math.min(cx, hiX));
    var loY = Math.max(r.top + halfH, halfH + 4);
    var hiY = Math.min(r.bottom - halfH, window.innerHeight - halfH - 4);
    if (hiY < loY) cy = Math.max(halfH + 4, Math.min(cy, window.innerHeight - halfH - 4));
    else cy = Math.max(loY, Math.min(cy, hiY));
    quick.style.left = Math.round(cx) + "px";
    quick.style.top = Math.round(cy) + "px";
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
    openUrl: openUrl,
    quickHide: hideQuick,
    quickHit: quickHit,
    setSplit: setSplit,
    getSplit: getSplit,
    exitSplit: exitSplit,
    paneAlive: paneAlive,
    splitGeom: splitGeom
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
