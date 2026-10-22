/* ============================================================================
 * 趋势上升榜 · 右侧「我的收藏」抽屉（含全屏工作台）
 *
 * 三种形态，同一个组件、同一个入口：
 *   ① 收起：只留右侧竖排标签（角标显示总数）
 *   ② 抽屉：380px 浮层，看图 / 按分类筛 / 开原图
 *   ③ 全屏：铺满视口，左侧分类栏 + 右侧内容区，可拖拽改分类、可一键展开平铺
 *
 * 为什么不再跳 fav.html：
 *   用户要求"点开不用另起一页，直接向右侧展开"。所以重活（拖拽、平铺、
 *   分类管理）全部搬进全屏形态，在当前页完成，不打断浏览上下文。
 *
 * 设计约束（都是有意的，改之前先读）：
 *   - 浮层 fixed，不参与 .gallery-layout 网格 → 列宽零影响；
 *   - 抽屉形态不加遮罩 → 不挡对比池点击；全屏形态才铺满；
 *   - Esc 分级退出：全屏 → 抽屉 → 关闭，一次 Esc 不会直接丢掉当前视图；
 *   - 拖拽只在全屏形态启用：抽屉太窄，拖拽手势会和对比池抢事件。
 * ========================================================================== */
(function () {
  "use strict";

  var MAX_ITEMS = 2000;

  var ST = {
    open: false,
    view: "drawer",     /* "drawer" | "full" */
    flat: false,        /* 是否平铺 */
    uid: null,
    ready: null,
    cats: [],
    items: [],
    filter: "all",      /* "all" | 分类 id（数字）| "none" */
    loading: false,
    error: "",
    built: false,
    dragId: null,
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function SBX() { return window.SB || null; }
  function toast(t) {
    if (window.toast) { try { window.toast(t); return; } catch (e) {} }
    if (window.Common && Common.toast) { try { Common.toast(t); return; } catch (e) {} }
  }

  var COLORS = ["#8b7355", "#c25e5a", "#4a9c6d", "#5b7c9d", "#b08a4f", "#8a6fa8", "#4f8f8a", "#a0685a"];
  /* 首次使用自动建好的五个默认大类（用户可改名、可删除；删了不会被自动塞回来） */
  var DEFAULT_CATS = ["印花", "面料", "图案", "工艺", "视觉"];
  /* 从榜单卡片拖进来时用的自定义数据类型（浏览器在 dragover 阶段只允许读 types） */
  var EXT_TYPE = "application/x-fav-row";
  function colorAt(i) { return COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length]; }

  /* ---------------------------------------------------------------- DOM */

  function ensureDom() {
    if (ST.built && $("#fv-drawer")) return;
    var body = document.body;
    if (!body) return;

    if (!$("#fv-tab")) {
      var tab = document.createElement("button");
      tab.type = "button";
      tab.id = "fv-tab";
      tab.className = "fv-tab";
      tab.setAttribute("aria-controls", "fv-drawer");
      tab.setAttribute("aria-expanded", "false");
      tab.title = "我的收藏（点击展开，不影响对比池）";
      tab.innerHTML = '<span class="fv-tab-t">我的收藏</span><span class="fv-tab-n" id="fv-tab-n" hidden>0</span>';
      tab.addEventListener("click", function () { toggle(); });
      body.appendChild(tab);
    }

    if (!$("#fv-drawer")) {
      var d = document.createElement("aside");
      d.id = "fv-drawer";
      d.className = "fv-drawer";
      d.setAttribute("aria-hidden", "true");
      d.setAttribute("aria-label", "我的收藏");
      d.innerHTML = ''
        + '<div class="fv-d-head">'
        +   '<div class="fv-d-title">我的收藏<span class="fv-d-count" id="fv-d-count"></span></div>'
        +   '<div class="fv-d-acts">'
        +     '<button type="button" class="fv-d-btn" id="fv-d-flat" title="把已分类的图按类别相邻铺开，未分类的不展开">平铺</button>'
        +     '<button type="button" class="fv-d-btn fv-d-full" id="fv-d-full" title="全屏（Esc 退出）">⤢ 全屏</button>'
        +     '<button type="button" class="fv-d-x" id="fv-d-x" aria-label="收起">×</button>'
        +   '</div>'
        + '</div>'
        + '<div class="fv-d-filter" id="fv-d-filter"></div>'
        + '<div class="fv-d-main">'
        +   '<aside class="fv-d-side" id="fv-d-side" aria-label="我的分类"></aside>'
        +   '<div class="fv-d-body" id="fv-d-body"></div>'
        + '</div>'
        + '<div class="fv-d-save" id="fv-d-save" hidden></div>';
      body.appendChild(d);
      $("#fv-d-x").addEventListener("click", function () { close(); });
      $("#fv-d-full").addEventListener("click", function () { setView(ST.view === "full" ? "drawer" : "full"); });
      $("#fv-d-flat").addEventListener("click", function () { setFlat(!ST.flat); });
      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        if (!ST.open) return;
        /* 分级退出：全屏 → 抽屉 → 关闭，一次 Esc 不会把整层丢光 */
        if (ST.view === "full") { setView("drawer"); return; }
        close();
      });
    }
    ST.built = true;
  }

  /* ------------------------------------------------------------- 数据层 */

  async function load() {
    var SB = SBX();
    if (!SB || !SB.listFavItems) { ST.error = "数据服务未就绪，请刷新页面重试。"; ST.items = []; return; }
    ST.loading = true;
    ST.error = "";
    try {
      ST.uid = (await SB.favUid()) || null;
      if (!ST.uid) { ST.items = []; ST.cats = []; ST.loading = false; return; }
      try { ST.ready = await SB.favReady(); } catch (e) { ST.ready = false; }
      if (!ST.ready) { ST.items = []; ST.cats = []; ST.loading = false; return; }
      try { ST.cats = (await SB.listFavCategories()) || []; } catch (e) { ST.cats = []; }
      /* 五个默认大类：只在一条分类都没有时创建，且不影响读取收藏本身 */
      if (!(ST.cats || []).length && typeof SB.ensureDefaultFavCats === "function") {
        try { ST.cats = (await SB.ensureDefaultFavCats(DEFAULT_CATS)) || []; } catch (e) { /* 建不了也能继续浏览 */ }
      }
      ST.items = (await SB.listFavItems({ limit: MAX_ITEMS })) || [];
    } catch (e) {
      ST.error = (e && e.message) ? String(e.message) : "读取收藏失败";
      ST.items = [];
    }
    ST.loading = false;
  }

  /* 按周分组：周（period_label）→ 条目；周内保持接口顺序（时间倒序） */
  function groupByPeriod(items) {
    var out = [], idx = {};
    (items || []).forEach(function (it) {
      var p = String(it.period_label || "未标注期次");
      if (idx[p] == null) { idx[p] = out.length; out.push({ period: p, items: [] }); }
      out[idx[p]].items.push(it);
    });
    return out;
  }

  /* 平铺分组：同一周内按分类聚在一起，同类相邻；未分类单独一桶、不参与平铺 */
  function flatGroups(items, cats) {
    var byId = {}, order = [];
    (cats || []).forEach(function (c, i) {
      byId[Number(c.id)] = { cid: Number(c.id), name: c.name, color: c.color || colorAt(i), items: [] };
      order.push(Number(c.id));
    });
    var others = [];
    (items || []).forEach(function (it) {
      var cid = it.category_id == null ? null : Number(it.category_id);
      if (cid != null && byId[cid]) byId[cid].items.push(it);
      else others.push(it);   /* 未分类 + 分类已删的脏数据，都按未分类处理，不丢图 */
    });
    var groups = order.map(function (k) { return byId[k]; }).filter(function (g) { return g.items.length; });
    return { groups: groups, others: others };
  }

  function filtered() {
    if (ST.filter === "all") return ST.items;
    if (ST.filter === "none") return ST.items.filter(function (it) { return it.category_id == null; });
    var cid = Number(ST.filter);
    return ST.items.filter(function (it) { return Number(it.category_id) === cid; });
  }

  function catOf(cid) {
    if (cid == null) return null;
    return (ST.cats || []).filter(function (c) { return Number(c.id) === Number(cid); })[0] || null;
  }
  function catColor(cid) {
    var c = catOf(cid);
    return (c && c.color) || "#8b7355";
  }

  /* -------------------------------------------------------------- 渲染 */

  function renderFilter() {
    var box = $("#fv-d-filter");
    if (!box) return;
    var h = '<button type="button" class="fv-d-chip' + (ST.filter === "all" ? " is-on" : "") + '" data-fv-f="all">全部<i>'
      + ST.items.length + '</i></button>';
    (ST.cats || []).forEach(function (c) {
      var n = ST.items.filter(function (it) { return Number(it.category_id) === Number(c.id); }).length;
      h += '<button type="button" class="fv-d-chip' + (Number(ST.filter) === Number(c.id) ? " is-on" : "") + '"'
        + ' data-fv-f="' + c.id + '"><span class="fv-d-dot" style="background:' + esc(c.color || "#8b7355") + '"></span>'
        + esc(c.name) + '<i>' + n + '</i></button>';
    });
    var none = ST.items.filter(function (it) { return it.category_id == null; }).length;
    if (none) {
      h += '<button type="button" class="fv-d-chip' + (ST.filter === "none" ? " is-on" : "")
        + '" data-fv-f="none">未分类<i>' + none + '</i></button>';
    }
    box.innerHTML = h;
    all("[data-fv-f]", box).forEach(function (b) {
      b.addEventListener("click", function () {
        ST.filter = b.getAttribute("data-fv-f");
        render();
      });
      bindDropTarget(b, catDropValue(b));   /* 直接把图拖到分类 chip 上即可归类 */
    });
  }

  /* 全屏形态的左栏：分类列表 + 新建 + 删除；同时是拖放目标 */
  function renderSide() {
    var box = $("#fv-d-side");
    if (!box) return;
    var h = '<div class="fv-d-side-h"><span>我的分类</span>'
      + '<button type="button" class="fv-d-newbtn" id="fv-d-new">＋ 新建</button></div>'
      + '<div class="fv-d-newbox" id="fv-d-newbox" hidden>'
      +   '<input type="text" id="fv-d-newname" maxlength="40" placeholder="分类名，如 印花T恤">'
      +   '<div class="fv-d-newrow"><button type="button" class="fv-d-btn ok" id="fv-d-newok">建好</button>'
      +   '<button type="button" class="fv-d-btn" id="fv-d-newcancel">取消</button></div>'
      + '</div>';

    h += '<div class="fv-d-cats" id="fv-d-cats">';
    h += '<div class="fv-d-cat' + (ST.filter === "all" ? " is-on" : "") + '" data-drop="__all__">'
      + '<span class="fv-d-cdot" style="background:transparent;border:1px solid var(--line)"></span>'
      + '<span class="fv-d-cname">全部</span><i class="fv-d-cn">' + ST.items.length + '</i></div>';
    (ST.cats || []).forEach(function (c, i) {
      var n = ST.items.filter(function (it) { return Number(it.category_id) === Number(c.id); }).length;
      h += '<div class="fv-d-cat' + (Number(ST.filter) === Number(c.id) ? " is-on" : "") + '"'
        + ' data-drop="' + c.id + '" data-cid="' + c.id + '">'
        + '<span class="fv-d-cdot" style="background:' + esc(c.color || colorAt(i)) + '"></span>'
        + '<span class="fv-d-cname" title="' + esc(c.name) + '">' + esc(c.name) + '</span>'
        + '<i class="fv-d-cn">' + n + '</i>'
        + '<button type="button" class="fv-d-cdel" data-del="' + c.id + '" title="删除分类（图退回未分类）">×</button>'
        + '</div>';
    });
    var none = ST.items.filter(function (it) { return it.category_id == null; }).length;
    h += '<div class="fv-d-cat' + (ST.filter === "none" ? " is-on" : "") + '" data-drop="__none__">'
      + '<span class="fv-d-cdot" style="background:transparent;border:1px dashed var(--line)"></span>'
      + '<span class="fv-d-cname">未分类</span><i class="fv-d-cn">' + none + '</i></div>';
    h += '</div>';
    h += '<div class="fv-d-side-tip">把图拖到分类上即可归类</div>';
    box.innerHTML = h;

    /* 点分类 = 筛选 */
    all("[data-cid]", box).forEach(function (el) {
      el.addEventListener("click", function (e) {
        if (e.target && e.target.closest && e.target.closest("[data-del]")) return;
        ST.filter = el.getAttribute("data-cid");
        render();
      });
    });
    all("[data-del]", box).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        delCat(Number(b.getAttribute("data-del")));
      });
    });

    /* 新建分类 */
    var nw = $("#fv-d-new"), nwb = $("#fv-d-newbox");
    if (nw && nwb) {
      nw.addEventListener("click", function () {
        nwb.hidden = !nwb.hidden;
        if (!nwb.hidden) { var inp = $("#fv-d-newname"); if (inp && inp.focus) inp.focus(); }
      });
    }
    var cancel = $("#fv-d-newcancel");
    if (cancel) cancel.addEventListener("click", function () { var b = $("#fv-d-newbox"); if (b) b.hidden = true; });
    var okb = $("#fv-d-newok");
    if (okb) okb.addEventListener("click", function () { createCat(); });
    var nameInp = $("#fv-d-newname");
    if (nameInp) nameInp.addEventListener("keydown", function (e) { if (e.key === "Enter") createCat(); });

    /* 拖放目标：分类 / 未分类（「全部」不是有效归类目标） */
    all("[data-drop]", box).forEach(function (el) { bindDropTarget(el, catDropValue(el)); });
  }

  /* 统一的拖放目标绑定：任何承载"一个分类"的元素都能接图。
     已用于 ①左栏分类 ②顶部筛选 chip ③平铺的类别组与类别框 ④未分类折叠区。 */
  function bindDropTarget(el, resolveCid) {
    if (!el || el.dataset.dropBound === "1") return;
    el.dataset.dropBound = "1";
    el.addEventListener("dragover", function (e) {
      var back = hasExt(e);
      if (ST.dragId == null && !back) return;
      e.preventDefault();
      if (e.dataTransfer) { try { e.dataTransfer.dropEffect = back ? "copy" : "move"; } catch (x) { } }
      el.classList.add("is-drop");
    });
    el.addEventListener("dragleave", function () { el.classList.remove("is-drop"); });
    el.addEventListener("drop", function (e) {
      el.classList.remove("is-drop");
      /* ① 从榜单卡片直接拖进来 = 收藏到该分类 */
      if (hasExt(e)) {
        e.preventDefault(); e.stopPropagation();
        var row = extRow(e);
        var cidExt = resolveCid();
        endDropMode();
        if (row && cidExt !== "__skip__") addDropped(row, cidExt);
        return;
      }
      /* ② 抽屉里的图改分类 */
      e.preventDefault();
      e.stopPropagation();
      if (ST.dragId == null) return;
      var id = ST.dragId;
      if (resolveCid() === "__skip__") { clearDragState(id); return; }
      var cid = resolveCid();
      clearDragState(id);        /* 先收状态：drop 之后不一定有 dragend */
      moveTo(id, cid);
    });
  }

  /* ---------- 从榜单卡片拖进来（收藏） ---------- */
  function hasExt(e) {
    var dt = e && e.dataTransfer;
    if (!dt) return false;
    var types = dt.types || [];
    for (var i = 0; i < types.length; i++) { if (types[i] === EXT_TYPE) return true; }
    return false;
  }

  function extRow(e) {
    try {
      var s = e.dataTransfer && e.dataTransfer.getData(EXT_TYPE);
      if (!s) return null;
      var o = JSON.parse(s);
      return (o && o.image_url) ? o : null;
    } catch (x) { return null; }
  }

  async function addDropped(row, cid) {
    var SB = SBX();
    if (!SB || typeof SB.addFavItems !== "function") { toast("数据服务未就绪，请刷新页面重试"); return; }
    var realCid = (cid == null || cid === "__none__" || cid === undefined) ? null : Number(cid);
    var c = realCid == null ? null : catOf(realCid);
    try {
      var n = await SB.addFavItems([row], realCid);
      /* 立刻本地插入，不必等整表重读 */
      await refresh();
      flashSaved("已收藏 " + (n || 1) + " 张到「" + (c ? c.name : "未分类") + "」");
    } catch (e) {
      toast((e && e.message) ? e.message : "收藏失败");
    }
  }

  /* 拖动榜单图时把抽屉摊开、让分类变成"文件夹"落点 */
  function openForDrop() {
    ensureDom();
    if (!ST.open) {
      ST.open = true;
      ST.view = "drawer";
      var t0 = $("#fv-tab");
      if (t0) { t0.classList.add("is-open"); t0.setAttribute("aria-expanded", "true"); }
      /* 先把抽屉推出来（拖动只有几秒，不能等网络），数据回来再补渲染 */
      ST.loading = true;
      render();
      load().then(function () { render(); });
    }
    markDropMode();
  }
  function markDropMode() {
    var d = $("#fv-drawer");
    if (!d) return;
    d.classList.add("is-open", "is-drop-ready");
    d.setAttribute("aria-hidden", "false");
  }
  function endDropMode() {
    var d = $("#fv-drawer");
    if (d) d.classList.remove("is-drop-ready");
    all(".is-drop", document).forEach(function (e) { e.classList.remove("is-drop"); });
  }

  /* 取消收藏：从收藏里移除这一条（不删图、不删分类） */
  async function unfav(id) {
    var SB = SBX();
    if (!SB || typeof SB.removeFavItems !== "function" || id == null) return false;
    try {
      await SB.removeFavItems([Number(id)]);
      ST.items = (ST.items || []).filter(function (it) { return Number(it.id) !== Number(id); });
      render();
      flashSaved("已取消收藏");
      return true;
    } catch (e) {
      toast((e && e.message) ? e.message : "取消收藏失败");
      return false;
    }
  }

  /* 拖拽收尾：清 id、清抽屉标记、清所有高亮。
     drop 之后浏览器不保证一定发 dragend（例如拖到窗口外），所以两端都要收。 */
  function clearDragState(id) {
    if (id != null) {
      var doc0 = document;
      var c0 = all('.fv-d-cell[data-id="' + id + '"]', doc0)[0];
      if (c0) {
        c0.classList.remove("is-dragging");
        c0.setAttribute("data-dragged", "1");
        setTimeout(function () { c0.removeAttribute("data-dragged"); }, 260);
      }
    }
    ST.dragId = null;
    var d = $("#fv-drawer");
    if (d) {
      d.classList.remove("is-dragging");
      all(".is-drop", d).forEach(function (x) { x.classList.remove("is-drop"); });
    }
    var doc = (d && d.ownerDocument) || document;
    all(".is-drop", doc).forEach(function (x) { x.classList.remove("is-drop"); });
  }

  /* 把 data-drop / data-fv-f / data-flat 上的值翻译成：分类 id / null / "__skip__" */
  function catDropValue(el) {
    return function () {
      var tag = el.getAttribute("data-drop");
      if (tag != null) {
        if (tag === "__all__") return "__skip__";
        if (tag === "__none__") return null;
        return Number(tag);
      }
      var f = el.getAttribute("data-fv-f");
      if (f != null) {
        if (f === "all") return "__skip__";
        if (f === "none") return null;
        return Number(f);
      }
      var fl = el.getAttribute("data-flat");
      if (fl != null) return Number(fl);
      if (el.getAttribute("data-flat-none") != null) return null;
      return "__skip__";
    };
  }

  /* 收藏卡片：保留原图的「排位」与「标签」，并带一个取消收藏按钮。
     tags 是收藏当时的快照（趋势爆款 / 上升 12 位 / 共 3 国同款…），
     榜单换期后仍然能看到当时是什么状态。 */
  function cellHtml(it, opts) {
    opts = opts || {};
    var cname = "", cid = it.category_id;
    if (cid != null) { var c = catOf(cid); cname = c ? c.name : ""; }
    var rk = (it.rank_pos != null && it.rank_pos !== "") ? it.rank_pos
      : ((it.rank_abs != null && it.rank_abs !== "") ? it.rank_abs : null);
    var tags = [];
    if (Array.isArray(it.tags)) tags = it.tags.filter(function (x) { return String(x || "").trim(); });
    var meta = "";
    if (rk != null) meta += '<span class="fv-d-rank">#' + esc(rk) + '</span>';
    tags.slice(0, 2).forEach(function (tg) { meta += '<span class="fv-d-tg">' + esc(tg) + '</span>'; });
    var full = [it.title, it.leaf_category, cname, rk != null ? ("第 " + rk + " 位") : "", tags.join(" ")]
      .filter(Boolean).join(" · ");
    return '<figure class="fv-d-cell' + (opts.drag ? " is-drag" : "") + '" data-url="' + esc(it.image_url) + '"'
      + (opts.drag ? ' draggable="true" data-id="' + esc(it.id) + '"' : '')
      + ' data-cid="' + esc(cid == null ? "" : cid) + '"'
      + ' title="' + esc(full) + '">'
      + '<img src="' + esc(it.image_url) + '" alt="" loading="lazy" decoding="async">'
      + (cname ? '<span class="fv-d-tag" style="background:' + esc(catColor(cid)) + '">' + esc(cname) + '</span>' : '')
      + '<button type="button" class="fv-d-unfav" data-unfav="' + esc(it.id) + '" title="取消收藏">×</button>'
      + (meta ? '<span class="fv-d-meta">' + meta + '</span>' : '')
      + '<figcaption>' + esc(String(it.title || "").slice(0, 16)) + '</figcaption>'
      + '</figure>';
  }

  function bindCells() {
    var body = $("#fv-d-body");
    if (!body) return;
    all("[data-unfav]", body).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        unfav(b.getAttribute("data-unfav"));
      });
    });
    all(".fv-d-cell", body).forEach(function (c) {
      c.addEventListener("click", function () {
        if (c.getAttribute("data-dragged") === "1") { c.removeAttribute("data-dragged"); return; }
        var u = c.getAttribute("data-url");
        if (u) window.open(u, "_blank", "noopener");
      });
      if (c.getAttribute("draggable") === "true") {
        c.addEventListener("dragstart", function (e) {
          ST.dragId = Number(c.getAttribute("data-id"));
          c.classList.add("is-dragging");
          try { e.dataTransfer.setData("text/plain", String(ST.dragId)); e.dataTransfer.effectAllowed = "move"; } catch (x) {}
        });
        c.addEventListener("dragend", function () {
          c.classList.remove("is-dragging");
          ST.dragId = null;
          var d = $("#fv-drawer");
          if (d) d.classList.remove("is-dragging");
          /* 拖完必定会跟一个 click（松手处），在 260ms 内吞掉，避免顺手打开原图 */
          c.setAttribute("data-dragged", "1");
          setTimeout(function () { c.removeAttribute("data-dragged"); }, 260);
        });
        c.addEventListener("dragstart", function () {
          var d = $("#fv-drawer");
          if (d) d.classList.add("is-dragging");
        });
      }
    });
  }

  function renderBody() {
    var box = $("#fv-d-body");
    if (!box) return;

    if (ST.loading) { box.innerHTML = '<div class="fv-d-empty">读取中…</div>'; return; }
    if (!ST.uid) { box.innerHTML = '<div class="fv-d-empty">登录后即可在这里看到你收藏的图。</div>'; return; }
    if (ST.ready === false) {
      box.innerHTML = '<div class="fv-d-empty">收藏表还没建好：请在数据库执行一次 '
        + '<code>tools/patch_20261021R.sql</code>，执行后刷新本页。</div>';
      return;
    }
    if (ST.error) { box.innerHTML = '<div class="fv-d-empty fv-d-bad">' + esc(ST.error) + '</div>'; return; }

    var list = filtered();
    if (!list.length) {
      box.innerHTML = '<div class="fv-d-empty">'
        + (ST.items.length ? '这个分类下还没有图。' : '还没有收藏。在图卡片右下角点 <b>☆</b> 即可收藏，收藏后会立刻出现在这里。')
        + '</div>';
      return;
    }

    /* 拖拽在抽屉形态也开放：放置目标是顶部筛选 chip，
       全屏形态另有左栏分类与平铺组可接。这样"来回拖"不必先进全屏。 */
    var canDrag = true;
    var h = '';
    groupByPeriod(list).forEach(function (g) {
      h += '<section class="fv-d-week">';
      h += '<div class="fv-d-week-h"><span class="fv-d-week-t">' + esc(g.period) + '</span>'
        + '<span class="fv-d-week-n">' + g.items.length + ' 张</span></div>';

      if (ST.flat) {
        /* 平铺：同类相邻，每组下方一条框横跨该组全部图片；未分类不进平铺 */
        var fg = flatGroups(g.items, ST.cats);
        if (!fg.groups.length) {
          h += '<div class="fv-d-flat-none">本批没有已分类的图，平铺无可展示（未分类的图不参与平铺）。</div>';
        }
        fg.groups.forEach(function (grp) {
          h += '<div class="fv-d-flat is-droppable" data-flat="' + grp.cid + '">';
          h += '<div class="fv-d-flat-cells">';
          grp.items.forEach(function (it) { h += cellHtml(it, { drag: canDrag }); });
          h += '</div>';
          h += '<div class="fv-d-flat-band is-droppable" data-flat="' + grp.cid + '" style="border-color:' + esc(grp.color)
            + ';background:' + esc(grp.color) + '1f">'
            + '<span class="fv-d-flat-dot" style="background:' + esc(grp.color) + '"></span>'
            + '<span class="fv-d-flat-name">' + esc(grp.name) + '</span>'
            + '<span class="fv-d-flat-n">' + grp.items.length + ' 张</span>'
            + '</div>';
          h += '</div>';
        });
        if (fg.others.length) {
          h += '<details class="fv-d-flat-others is-droppable" data-flat-none="1"><summary>未分类 ' + fg.others.length + ' 张（不参与平铺）</summary>'
            + '<div class="fv-d-grid">';
          fg.others.forEach(function (it) { h += cellHtml(it, { drag: canDrag }); });
          h += '</div></details>';
        }
      } else {
        h += '<div class="fv-d-grid">';
        g.items.forEach(function (it) { h += cellHtml(it, { drag: canDrag }); });
        h += '</div>';
      }
      h += '</section>';
    });
    box.innerHTML = h;
    bindCells();
    all(".fv-d-flat, .fv-d-flat-band, [data-flat-none]", box).forEach(function (el) {
      bindDropTarget(el, catDropValue(el));
    });
  }

  function renderCount() {
    var n = ST.items.length;
    var b = $("#fv-tab-n");
    if (b) { b.textContent = String(n > 999 ? "999+" : n); b.hidden = !n; }
    var c = $("#fv-d-count");
    if (c) c.textContent = n ? "· " + n + " 张" : "";
  }

  function renderHead() {
    var fb = $("#fv-d-flat"), bf = $("#fv-d-full");
    if (fb) {
      fb.textContent = ST.flat ? "取消平铺" : "平铺";
      fb.classList.toggle("is-on", !!ST.flat);
      fb.title = ST.flat ? "回到普通分组视图" : "把已分类的图按类别相邻铺开，未分类的不展开";
    }
    if (bf) {
      bf.textContent = ST.view === "full" ? "⤡ 退出全屏" : "⤢ 全屏";
      bf.title = ST.view === "full" ? "退出全屏（Esc）" : "全屏（Esc 退出）";
    }
    var d = $("#fv-drawer");
    if (d) {
      d.classList.toggle("is-full", ST.view === "full");
      d.classList.toggle("is-flat", !!ST.flat);
    }
    var side = $("#fv-d-side");
    if (side) side.hidden = ST.view !== "full";
  }

  function render() {
    ensureDom();
    renderHead();
    renderCount();
    renderSide();
    renderFilter();
    renderBody();
  }

  function flashSaved(msg) {
    var el = $("#fv-d-save");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add("is-on");
    setTimeout(function () { el.classList.remove("is-on"); setTimeout(function () { el.hidden = true; }, 260); }, 1600);
  }

  /* -------------------------------------------------------------- 操作 */

  async function moveTo(id, cid) {
    var SB = SBX();
    if (!SB || !SB.moveFavItems || !id) return false;
    var cur = ST.items.filter(function (x) { return Number(x.id) === Number(id); })[0];
    var target = (cid == null) ? null : Number(cid);
    /* 拖回原处不发请求：同类互拖（尤其平铺里拖到自己的组）不应产生写库 */
    if (cur && ((cur.category_id == null ? null : Number(cur.category_id)) === target)) {
      var same = catOf(target);
      flashSaved(target == null ? "已经是未分类" : "已在「" + ((same && same.name) || "") + "」里");
      return true;
    }
    try {
      await SB.moveFavItems([id], cid == null ? null : Number(cid));
      /* 就地更新，不整表重建：保持滚动位置与筛选态 */
      var it = ST.items.filter(function (x) { return Number(x.id) === Number(id); })[0];
      if (it) it.category_id = cid == null ? null : Number(cid);
      render();
      var c = catOf(cid);
      flashSaved(cid == null ? "已移出分类" : "已归到「" + ((c && c.name) || "") + "」");
      return true;
    } catch (e) {
      toast((e && e.message) ? e.message : "移动失败");
      return false;
    }
  }

  async function createCat() {
    var inp = $("#fv-d-newname");
    var name = inp ? String(inp.value || "").trim() : "";
    if (!name) { toast("先给新分类起个名字"); if (inp && inp.focus) inp.focus(); return; }
    var SB = SBX();
    if (!SB || !SB.createFavCategory) return;
    try {
      await SB.createFavCategory(name, colorAt(ST.cats.length));
      ST.cats = (await SB.listFavCategories()) || ST.cats;
      render();
      flashSaved("已新建分类「" + name + "」");
    } catch (e) {
      toast((e && e.message) ? e.message : "新建分类失败");
    }
  }

  async function delCat(id) {
    var c = catOf(id);
    var SB = SBX();
    if (!SB || !SB.deleteFavCategory) return;
    if (!window.confirm("删除分类「" + ((c && c.name) || "") + "」？里面的图会退回未分类，不会被删除。")) return;
    try {
      await SB.deleteFavCategory(id);
      ST.items.forEach(function (it) { if (Number(it.category_id) === Number(id)) it.category_id = null; });
      if (Number(ST.filter) === Number(id)) ST.filter = "all";
      try { ST.cats = (await SB.listFavCategories()) || []; }
      catch (e2) { ST.cats = ST.cats.filter(function (x) { return Number(x.id) !== Number(id); }); }
      render();
      flashSaved("分类已删除，图已退回未分类");
    } catch (e) {
      toast((e && e.message) ? e.message : "删除分类失败");
    }
  }

  /* -------------------------------------------------------------- 形态 */

  function setView(v) {
    ensureDom();
    ST.view = v === "full" ? "full" : "drawer";
    var d = $("#fv-drawer"), t = $("#fv-tab");
    if (!ST.open) {
      ST.open = true;
      if (d) { d.classList.add("is-open"); d.setAttribute("aria-hidden", "false"); }
      if (t) { t.classList.add("is-open"); t.setAttribute("aria-expanded", "true"); }
    }
    render();
    return ST.view;
  }

  function setFlat(on) {
    ST.flat = !!on;
    render();
    return ST.flat;
  }

  async function open() {
    ensureDom();
    ST.open = true;
    ST.view = "drawer";
    var d = $("#fv-drawer"), t = $("#fv-tab");
    if (d) { d.classList.add("is-open"); d.setAttribute("aria-hidden", "false"); }
    if (t) { t.classList.add("is-open"); t.setAttribute("aria-expanded", "true"); }
    await load();
    render();
  }

  function close() {
    var d = $("#fv-drawer"), t = $("#fv-tab");
    ST.open = false;
    ST.view = "drawer";
    if (d) { d.classList.remove("is-open", "is-full"); d.setAttribute("aria-hidden", "true"); }
    if (t) { t.classList.remove("is-open"); t.setAttribute("aria-expanded", "false"); }
  }

  function toggle() { return ST.open ? (close(), Promise.resolve()) : open(); }

  async function refresh() {
    if (!ST.built) ensureDom();
    await load();
    if (ST.open) render();
    else renderCount();
  }

  function boot() {
    ensureDom();
    if (SBX() && SBX().listFavItems) load().then(function () { renderCount(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.FavDrawer = {
    open: open, close: close, toggle: toggle, refresh: refresh, render: render,
    setView: setView, setFlat: setFlat,
    openForDrop: openForDrop, endDropMode: endDropMode, unfav: unfav,
    DEFAULT_CATS: DEFAULT_CATS,
    isOpen: function () { return ST.open; },
    view: function () { return ST.view; },
    state: function () { return ST; },
    _test: {
      groupByPeriod: groupByPeriod,
      flatGroups: flatGroups,
      moveTo: moveTo,
      ensured: function () { return !!$("#fv-drawer"); },
    },
  };
})();