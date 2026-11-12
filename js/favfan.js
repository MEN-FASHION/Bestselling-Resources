/* favfan.js —— 拖动榜单图时，分类清单贴着你拖向的那一侧弹出
 *
 * 这一版：
 *   ① 分类仍然是清单式（不是扇形），但**贴着哪一边由拖动方向决定**：
 *      往左拖 → 贴左边竖排；往右拖 → 贴右边竖排；往上/往下 → 贴顶/底横排。
 *      一次拖动里方向只锁一次，不会来回跳。
 *   ② 字号/行高整体放大（行 44→58，文字 13→15），拖动时不用眯眼看；
 *   ③ 原版：竖排一列贴右侧、垂直居中；
 *   ② 视觉与动效对齐 macOS：玻璃层、细描边、克制阴影，长缓动、错峰滑入；
 *   ③ 仍然明确提示「可以拖进收藏」。
 *
 * 底线（与「不影响对比池」一致）：
 *   ① 外层 fixed + pointer-events:none，不占布局、不推挤列宽；
 *   ② 只有每一行本身接收事件，其余区域照旧点得到对比池；
 *   ③ 松手不在任何一行上 = 取消，不产生收藏；
 *   ④ Esc / dragend 立即收起，不留残影。
 */
(function (global) {
  "use strict";

  var EXT_TYPE = "application/x-fav-row";
  var MAX_ROWS = 6;                    /* 一屏最多列几个，再多用收藏抽屉拖放 */
  var STAGGER = 28;                    /* 每行错峰多少毫秒 */
  var MIN_MOVE = 16;                   /* 位移超过这么多才认方向，避免手抖 */
  var SIDES = ["right", "left", "top", "bottom"];

  var ST = {
    open: false, cats: [], el: null, loading: false, ready: false, error: null,
    side: "right",                     /* 当前贴哪一边 */
    locked: false,                     /* 本次拖动方向是否已锁定 */
    tracking: false, sx: 0, sy: 0      /* 起点坐标，用来算方向 */
  };

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

  /* ------------------------------------------------------------ 方向判定 */

  /* 一次拖动里只认一个方向：横向位移大就左右，纵向大就上下 */
  function decideSide(dx, dy) {
    if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
    return dy < 0 ? "top" : "bottom";
  }

  /* 还没动起来时的过渡猜测：贴到起点对面那一侧，先不压住你要拖的那张图；
     一旦看出方向（16px），立刻滑到真正的那一侧。 */
  function guessSide(x) {
    var vw = global.innerWidth || 0;
    if (!vw) return "right";
    return x < vw * 0.5 ? "right" : "left";
  }

  function setSide(side) {
    if (SIDES.indexOf(side) < 0) side = "right";
    ST.side = side;
    if (!ST.el) return side;
    SIDES.forEach(function (k) {
      ST.el.classList.toggle("is-" + k, k === side);
    });
    return side;
  }

  function onDragStart(e) {
    ST.locked = false;
    ST.tracking = true;
    ST.sx = Number(e && e.clientX) || 0;
    ST.sy = Number(e && e.clientY) || 0;
  }

  var moveTick = false, lastEvt = null;
  function applyMove() {
    moveTick = false;
    var e = lastEvt;
    if (!e || !ST.open || !ST.tracking || ST.locked) return;
    var dx = (Number(e.clientX) || 0) - ST.sx;
    var dy = (Number(e.clientY) || 0) - ST.sy;
    if (Math.abs(dx) < MIN_MOVE && Math.abs(dy) < MIN_MOVE) return;
    setSide(decideSide(dx, dy));       /* 菜单滑到你要去的那个方向 */
    ST.locked = true;                  /* 锁住，这次拖动里不再改 */
  }

  function onDragMove(e) {
    if (!ST.open || !ST.tracking || ST.locked) return;
    lastEvt = e;
    if (moveTick) return;
    moveTick = true;
    (global.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(applyMove);
  }

  function onDragEnd() { ST.tracking = false; ST.locked = false; }

  /* ---------------------------------------------------------------- DOM */

  function ensure() {
    if (ST.el && ST.el.parentNode) return ST.el;
    var d = document.createElement("div");
    d.id = "fv-fan";                       /* id 沿用，避免动到其它引用 */
    d.className = "fv-dock";
    d.setAttribute("aria-hidden", "true");
    d.innerHTML = ''
      + '<div class="fv-dock-hd">'
      +   '<span class="fv-dock-dot" aria-hidden="true"></span>'
      +   '<span class="fv-dock-hd-t">可以拖进收藏</span>'
      + '</div>'
      + '<div class="fv-dock-list" id="fv-dock-list" role="list"></div>'
      + '<div class="fv-dock-ft">松手即归入该分类<span class="fv-dock-sep">·</span>Esc 取消</div>';
    document.body.appendChild(d);
    ST.el = d;
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ST.open) hide();
    });
    /* 拖动全过程只挂三个被动监听：不 preventDefault，不影响任何既有拖放 */
    document.addEventListener("dragstart", onDragStart, true);
    document.addEventListener("dragover", onDragMove, true);
    document.addEventListener("dragend", onDragEnd, true);
    document.addEventListener("drop", onDragEnd, true);
    return d;
  }

  /* 竖排不需要算坐标：行与行靠 flex 排，这里只负责给出错峰节奏 */
  function layout() {
    var rows = all(".fv-dock-row", $("#fv-dock-list"));
    rows.forEach(function (el, i) {
      el.style.setProperty("--i", String(i));
      el.style.setProperty("--d", Math.round(i * STAGGER) + "ms");
    });
    return rows.length;
  }

  /* 展开前先把节奏归零，动画才有起点 */
  function collapseVars() {
    all(".fv-dock-row", $("#fv-dock-list") || document).forEach(function (el) {
      el.style.setProperty("--d", "0ms");
    });
  }

  var wasOpen = false;
  function play() {
    if (ST.ready || !wasOpen) return;
    ST.ready = true;
    layout();
  }

  function render() {
    var list = $("#fv-dock-list");
    if (!list) return;
    ST.ready = false;
    var cats = ST.cats || [];

    if (!cats.length) {
      list.innerHTML = '<div class="fv-dock-empty">'
        + (ST.loading ? "正在准备分类…" : (ST.error ? "分类读取失败，请刷新" : "还没有分类"))
        + '</div>';
      return;
    }

    var show = cats.slice(0, MAX_ROWS);
    var visDone = false;
    list.innerHTML = show.map(function (c) {
      var n = countOf(c.id);
      /* 视觉单独成段：它是"维度"，和印花/面料/图案/工艺这些"品类"不是一类 */
      var grp = "";
      if (!visDone && String(c.name || "").indexOf("视觉") >= 0) {
        grp = '<div class="fv-dock-grp" role="separator"><span>视觉维度</span></div>';
        visDone = true;
      }
      return grp + '<div class="fv-dock-row" role="listitem"'
        + ' data-cat="' + esc(c.id) + '" data-name="' + esc(c.name) + '"'
        + ' style="--fv-c:' + esc(c.color || "#8b7355") + '">'
        + '<span class="fv-dock-pin" aria-hidden="true"></span>'
        + '<span class="fv-dock-nm">' + esc(c.name) + '</span>'
        + (n == null ? "" : '<span class="fv-dock-n">' + n + '</span>')
        + '<span class="fv-dock-ok" aria-hidden="true">\u2713</span>'
        + '</div>';
    }).join("")
      + (cats.length > MAX_ROWS
        ? '<div class="fv-dock-more">还有 ' + (cats.length - MAX_ROWS) + ' 个分类，用右侧收藏抽屉拖放</div>'
        : "");

    collapseVars();
    bindRows();
    /* 下一帧再展开，动画才有起点；再补一个定时兜底：
       某些环境（后台标签页 / 无头预览）rAF 不一定触发，没有兜底就会停在"没出现"的状态 */
    var kick = global.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    kick(function () { play(); });
    global.setTimeout(function () { play(); }, 60);
  }

  /* ---------------------------------------------------------------- 拖放 */

  function bindRows() {
    all(".fv-dock-row", $("#fv-dock-list")).forEach(function (el) {
      el.addEventListener("dragover", function (e) {
        e.preventDefault();
        try { e.dataTransfer.dropEffect = "copy"; } catch (x) {}
        el.classList.add("is-over");
        if (ST.el) ST.el.classList.add("is-hot");     /* 其余行淡下去，视线只在落点上 */
      });
      el.addEventListener("dragleave", function () {
        el.classList.remove("is-over");
        if (ST.el && !all(".is-over", ST.el).length) ST.el.classList.remove("is-hot");
      });
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
      ST.error = null;
    } catch (err) {
      ST.cats = [];
      ST.error = (err && err.message) ? err.message : "读取分类失败";
    }
    ST.loading = false;
    if (ST.open) render();
  }

  /* ---------------------------------------------------------------- 对外 */

  function show(pt) {
    ensure();
    if (ST.open) return;
    /* 起点已知就先把菜单放到"正要离开的那一侧"，等方向确定再滑过去 */
    if (pt && typeof pt.clientX === "number") {
      ST.sx = pt.clientX;
      ST.sy = Number(pt.clientY) || 0;
      ST.tracking = true;
      ST.locked = false;
      setSide(guessSide(pt.clientX));
    } else if (!ST.tracking) {
      setSide(ST.side || "right");
    }
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
    ST.el.classList.remove("is-hot");
    ST.el.setAttribute("aria-hidden", "true");
    all(".is-over", ST.el).forEach(function (x) { x.classList.remove("is-over"); });
    ST.tracking = false;
    ST.locked = false;
    ST.cats = [];                 /* 下次拖动重新取一次（用户可能刚新建过分类） */
  }

  global.FavFan = {
    show: show,
    hide: hide,
    isOpen: function () { return ST.open; },
    state: function () { return ST; },
    _test: {
      layout: layout, render: render, countOf: countOf, onDrop: onDrop,
      setSide: setSide, decideSide: decideSide, guessSide: guessSide,
      MAX_ROWS: MAX_ROWS, STAGGER: STAGGER, MIN_MOVE: MIN_MOVE, SIDES: SIDES
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensure);
  else ensure();
})(window);
