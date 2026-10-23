/* favfan.js —— 拖动榜单图时，把收藏分类以「扇形文件夹」摊在对比池上
 *
 * 用它的原因：拖动只有两三秒，右侧抽屉要滑出、要等数据，路径太长；
 * 分类在对比池正上方呈扇形铺开，鼠标往哪个方向甩就进哪个文件夹，一步到位。
 *
 * 约束（与「不影响对比池」同一条底线）：
 *   ① 外层 fixed、pointer-events:none，不占布局、不推挤列宽；
 *   ② 只有文件夹本身收事件，其余区域不拦截对比池；
 *   ③ 松手不在文件夹上 = 取消，不产生任何收藏；
 *   ④ Esc 或 dragend 立即收起，不留残影。
 */
(function (global) {
  "use strict";

  var EXT_TYPE = "application/x-fav-row";
  var MAX_FAN = 8;                 /* 扇形最多摊几个：再多就挤成一团，改用抽屉 */
  var RADIUS = 208;                /* 弧半径（px） */
  var SPAN = 150;                  /* 最大张角（度） */

  var ST = { open: false, cats: [], el: null, loading: false, saved: 0 };

  /* ---------------------------------------------------------------- 小工具 */

  function SBX() {
    try { return global.SB || null; } catch (e) { return null; }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }

  /* 每个分类已有几张（用于文件夹上的计数；拿不到就不显示，不编数字） */
  function countOf(cid) {
    try {
      var d = global.FavDrawer;
      var items = (d && d.state && d.state() && d.state().items) || [];
      var n = 0;
      items.forEach(function (it) { if (Number(it.category_id) === Number(cid)) n++; });
      return n;
    } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- DOM */

  function ensure() {
    if (ST.el && ST.el.parentNode) return ST.el;
    var d = document.createElement("div");
    d.id = "fv-fan";
    d.className = "fv-fan";
    d.setAttribute("aria-hidden", "true");
    d.innerHTML = ''
      + '<div class="fv-fan-hint"><b>松手即收藏</b> · 拖到文件夹里归类 · Esc 取消</div>'
      + '<div class="fv-fan-ring" id="fv-fan-ring"></div>';
    document.body.appendChild(d);
    ST.el = d;
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ST.open) hide();
    });
    return d;
  }

  /* 扇形排布：以容器中心为圆心向上摊开，角度从 -SPAN/2 到 +SPAN/2。
     文件夹自身也跟着轻微旋转，看起来像一叠被摊开的卡片。 */
  function layout() {
    var ring = $("#fv-fan-ring");
    if (!ring) return;
    var cells = all(".fv-fan-cell", ring);
    var n = cells.length;
    if (!n) return;
    /* 半径随窗口收放：窄屏时弧太大会摊出屏幕，玩家找不到落点 */
    var vw = (global.innerWidth || 1280);
    var R = Math.min(RADIUS, Math.max(148, Math.round((vw - 268) / 2)));
    var dropDown = Math.round(R * 0.46);
    var span = Math.min(SPAN, 32 * n);
    cells.forEach(function (el, i) {
      var t = (n === 1) ? 0 : (i / (n - 1) - 0.5);
      var deg = t * span;
      var rad = deg * Math.PI / 180;
      var dx = Math.round(Math.sin(rad) * R);
      var dy = Math.round(-Math.cos(rad) * R) + dropDown;   /* 把弧往下挪，落在对比池中部 */
      el.style.transform = "translate(-50%,-50%) translate(" + dx + "px," + dy + "px) rotate(" + (deg * 0.26) + "deg)";
      el.style.transitionDelay = (i * 36) + "ms";
      el.style.zIndex = String(10 + i);
    });
  }

  function render() {
    var ring = $("#fv-fan-ring");
    if (!ring) return;
    var cats = ST.cats || [];
    if (!cats.length) {
      ring.innerHTML = '<div class="fv-fan-empty">' + (ST.loading ? "正在准备分类…" : "还没有分类") + '</div>';
      layout();
      return;
    }
    var list = cats.slice(0, MAX_FAN);
    ring.innerHTML = list.map(function (c) {
      var n = countOf(c.id);
      return '<div class="fv-fan-cell" data-cat="' + esc(c.id) + '" data-name="' + esc(c.name) + '"'
        + ' style="--fv-c:' + esc(c.color || "#8b7355") + '">'
        + '<span class="fv-fan-fold"></span>'
        + '<span class="fv-fan-nm">' + esc(c.name) + '</span>'
        + (n == null ? "" : '<span class="fv-fan-n">' + n + ' 张</span>')
        + '</div>';
    }).join("")
      + (cats.length > MAX_FAN
        ? '<div class="fv-fan-more">还有 ' + (cats.length - MAX_FAN) + ' 个分类，<br>请用右侧收藏抽屉拖放</div>'
        : "");
    layout();
    bindFolders();
  }

  /* ---------------------------------------------------------------- 拖放 */

  function bindFolders() {
    all(".fv-fan-cell", $("#fv-fan-ring")).forEach(function (el) {
      el.addEventListener("dragover", function (e) {
        e.preventDefault();
        try { e.dataTransfer.dropEffect = "copy"; } catch (x) {}
        el.classList.add("is-over");
      });
      el.addEventListener("dragleave", function () { el.classList.remove("is-over"); });
      el.addEventListener("drop", function (e) {
        e.preventDefault();
        e.stopPropagation();
        onDrop(e, el);
      });
    });
  }

  function rowFrom(e) {
    var raw = "";
    try { raw = e.dataTransfer.getData(EXT_TYPE); } catch (x) {}
    if (!raw) {
      try { raw = e.dataTransfer.getData("text/plain"); } catch (x) {}
    }
    if (!raw) return null;
    try {
      var o = JSON.parse(raw);
      if (o && o.image_url) return o;
    } catch (x) { /* text/plain 可能是标题，不是 JSON */ }
    return null;
  }

  async function onDrop(e, el) {
    var cid = Number(el.getAttribute("data-cat"));
    var cname = el.getAttribute("data-name") || "分类";
    var row = rowFrom(e);
    if (!row) { toast("没拿到这张图的信息，请重新拖一次"); hide(); return; }

    var SB = SBX();
    if (!SB || typeof SB.addFavItems !== "function") { toast("数据服务未就绪，请刷新页面"); hide(); return; }

    el.classList.add("is-saving");
    try {
      await SB.addFavItems([row], cid);
      ST.saved += 1;
      toast("已收藏到「" + cname + "」");
      try {
        if (global.FavDrawer && typeof global.FavDrawer.refresh === "function") global.FavDrawer.refresh();
      } catch (x) {}
    } catch (err) {
      toast((err && err.message) ? err.message : "收藏失败");
    } finally {
      el.classList.remove("is-saving");
      hide();
    }
  }

  /* ---------------------------------------------------------------- 取分类 */

  async function loadCats() {
    var SB = SBX();
    if (!SB) { ST.loading = false; render(); return; }

    /* 抽屉里已经有分类就直接用，拖动只有几秒，不能每次都等网络 */
    var st = null;
    try { st = global.FavDrawer && global.FavDrawer.state && global.FavDrawer.state(); } catch (x) {}
    if (st && st.cats && st.cats.length) { ST.cats = st.cats; ST.loading = false; render(); return; }

    ST.loading = true;
    render();
    try {
      var cats = null;
      if (typeof SB.ensureDefaultFavCats === "function") cats = await SB.ensureDefaultFavCats();
      else if (typeof SB.listFavCategories === "function") cats = await SB.listFavCategories();
      ST.cats = Array.isArray(cats) ? cats : [];
    } catch (err) {
      ST.cats = [];
      ST.error = (err && err.message) ? err.message : "读取分类失败";
    }
    ST.loading = false;
    if (ST.open) render();
  }

  /* ---------------------------------------------------------------- 对外 */

  function show() {
    ensure();
    if (ST.open) return;
    ST.open = true;
    ST.el.classList.add("is-open");
    ST.el.setAttribute("aria-hidden", "false");
    loadCats();
  }

  function hide() {
    if (!ST.el) return;
    ST.open = false;
    ST.el.classList.remove("is-open");
    ST.el.setAttribute("aria-hidden", "true");
    all(".is-over", ST.el).forEach(function (x) { x.classList.remove("is-over"); });
    /* 下次拖动重新取一次分类（用户可能刚新建过） */
    ST.cats = [];
  }

  global.FavFan = {
    show: show,
    hide: hide,
    isOpen: function () { return ST.open; },
    state: function () { return ST; },
    _test: { layout: layout, render: render, countOf: countOf, onDrop: onDrop, MAX_FAN: MAX_FAN }
  };
})(window);