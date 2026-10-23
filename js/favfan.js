/* favfan.js —— 拖动榜单图时，分类以「横向扇形」贴右侧摊开
 *
 * 与上一版的区别（用户要求）：
 *   ① 不再向"上"摊开成一摞卡片，改为**横向向右展开**：五张文件夹并排，
 *      从右侧收藏入口一路铺向左边，扇骨左低右高，像被人摊开的一手牌；
 *   ② 加一条明确提示「可以拖进收藏」，让人知道这里能放；
 *   ③ 位置贴着右侧栏，不压在对比池中央正在拖的那张图上。
 *
 * 底线（与「不影响对比池」一致）：
 *   ① 外层 fixed + pointer-events:none，不占布局、不推挤列宽；
 *   ② 只有文件夹本身接收事件，其余区域照旧点得到对比池；
 *   ③ 松手不在文件夹上 = 取消，不产生任何收藏；
 *   ④ Esc / dragend 立即收起，不留残影。
 */
(function (global) {
  "use strict";

  var EXT_TYPE = "application/x-fav-row";
  var MAX_FAN = 8;                     /* 最多摊几个，再多改用右侧抽屉 */
  var GAP = 104;                       /* 相邻文件夹的横向间距 */
  var BULGE = 13;                      /* 两端比中间高多少（形成扇形弧） */
  var TILT = 16;                       /* 扇形张开的总角度 */

  var ST = { open: false, cats: [], el: null, loading: false, ready: false };

  /* ---------------------------------------------------------------- 小工具 */

  function SBX() { try { return global.SB || null; } catch (e) { return null; } }
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

  /* 每个分类已有几张（拿不到就不显示，不编数字） */
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
      + '<div class="fv-fan-bar" role="status">'
      +   '<span class="fv-fan-bar-dot" aria-hidden="true"></span>'
      +   '<span class="fv-fan-bar-txt"><b>可以拖进收藏</b> · 松手即归入该分类 · Esc 取消</span>'
      + '</div>'
      + '<div class="fv-fan-deck" id="fv-fan-deck"></div>';
    document.body.appendChild(d);
    ST.el = d;
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ST.open) hide();
    });
    return d;
  }

  /* 横向扇形排布：
     以右侧收藏入口为扇轴（deck 的右端），第 0 张离扇轴最近，依次往左排；
     两端略微上抬、整叠带轻微旋转，所以看起来是"向右展开的一手牌"，而不是竖着的一摞。 */
  function layout() {
    var deck = $("#fv-fan-deck");
    if (!deck) return;
    var cells = all(".fv-fan-cell", deck);
    var n = cells.length;
    if (!n) return;
    var vw = global.innerWidth || 1280;
    /* 窄屏收窄间距，保证最左边那张不会跑出视口 */
    var gap = Math.max(74, Math.min(GAP, Math.round((vw * 0.46) / Math.max(1, n - 1))));
    cells.forEach(function (el, i) {
      var t = (n === 1) ? 0.5 : (i / (n - 1));          /* 0=最右 1=最左 */
      var dx = -Math.round(i * gap);
      var dy = -Math.round(Math.abs(t - 0.5) * 2 * BULGE);   /* 两端高、中间低 = 弧 */
      var rot = Math.round((0.5 - t) * TILT);               /* 向右张开 */
      el.style.setProperty("--dx", dx + "px");
      el.style.setProperty("--dy", dy + "px");
      el.style.setProperty("--rot", rot + "deg");
      el.style.setProperty("--d", Math.round(i * 30) + "ms");
      el.style.zIndex = String(20 - i);
    });
  }

  /* 收起时的形态：五张叠在扇轴上，角度归零 —— 展开动画从这一帧开始播 */
  function collapseVars() {
    var cells = all(".fv-fan-cell", $("#fv-fan-deck") || document);
    cells.forEach(function (el) {
      el.style.setProperty("--dx", "0px");
      el.style.setProperty("--dy", "0px");
      el.style.setProperty("--rot", "0deg");
    });
  }

  var wasOpen = false;
  /* 摊开只在"扇形正开着"时播；收起状态下渲染（例如 hide 之后补渲染）不该有动画 */
  function play() {
    if (ST.ready || !wasOpen) return;
    ST.ready = true;
    layout();
  }

  function render() {
    var deck = $("#fv-fan-deck");
    if (!deck) return;
    ST.ready = false;
    var cats = ST.cats || [];
    if (!cats.length) {
      deck.innerHTML = '<div class="fv-fan-empty">' + (ST.loading ? "正在准备分类…" : "还没有分类") + '</div>';
      return;
    }
    var list = cats.slice(0, MAX_FAN);
    deck.innerHTML = list.map(function (c) {
      var n = countOf(c.id);
      return '<div class="fv-fan-cell" data-cat="' + esc(c.id) + '" data-name="' + esc(c.name) + '"'
        + ' style="--fv-c:' + esc(c.color || "#8b7355") + '">'
        + '<span class="fv-fan-fold" aria-hidden="true"></span>'
        + '<span class="fv-fan-nm">' + esc(c.name) + '</span>'
        + (n == null ? "" : '<span class="fv-fan-n">' + n + ' 张</span>')
        + '</div>';
    }).join("")
      + (cats.length > MAX_FAN
        ? '<div class="fv-fan-more">还有 ' + (cats.length - MAX_FAN) + ' 个分类，<br>用右侧收藏抽屉拖放</div>'
        : "");
    collapseVars();
    bindFolders();
    /* 下一帧再摊开，动画才有起点；再补一个定时兜底：
       某些环境（后台标签页 / 无头预览）rAF 不一定触发，没有兜底就会停在"叠成一摞"的状态 */
    var kick = global.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    kick(function () { play(); });
    global.setTimeout(function () { play(); }, 60);
  }

  /* ---------------------------------------------------------------- 拖放 */

  function bindFolders() {
    all(".fv-fan-cell", $("#fv-fan-deck")).forEach(function (el) {
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
    if (!raw) { try { raw = e.dataTransfer.getData("text/plain"); } catch (x) {} }
    if (!raw) return null;
    try {
      var o = JSON.parse(raw);
      if (o && o.image_url) return o;
    } catch (x) { /* text/plain 可能只是标题，不是 JSON */ }
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
      toast("已收藏到「" + cname + "」");
      try { if (global.FavDrawer && global.FavDrawer.refresh) global.FavDrawer.refresh(); } catch (x) {}
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

    /* 抽屉里已经有分类就直接用：拖动只有几秒，不能每次都等网络 */
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
    wasOpen = true;
    ST.el.classList.add("is-open");
    ST.el.setAttribute("aria-hidden", "false");
    loadCats();
  }

  function hide() {
    if (!ST.el) return;
    ST.open = false;
    wasOpen = false;
    ST.ready = false;
    ST.el.classList.remove("is-open");
    ST.el.setAttribute("aria-hidden", "true");
    all(".is-over", ST.el).forEach(function (x) { x.classList.remove("is-over"); });
    ST.cats = [];                 /* 下次拖动重新取一次（用户可能刚新建过分类） */
  }

  global.FavFan = {
    show: show,
    hide: hide,
    isOpen: function () { return ST.open; },
    state: function () { return ST; },
    _test: { layout: layout, render: render, countOf: countOf, onDrop: onDrop, GAP: GAP, MAX_FAN: MAX_FAN }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensure);
  else ensure();
})(window);
