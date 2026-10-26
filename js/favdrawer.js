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
    sub: "all",         /* 二分类视图："all" | "top" 上装 | "bottom" 下装 | "none" 未分 */
    loading: false,
    error: "",
    built: false,
    dragId: null,
    tagsReady: null,   /* null=还没探测 / true=库里有 tags 列 / false=补丁没执行 */
    liveTags: null,    /* 当前榜单上同图的标签，用来兜底显示补丁前的旧收藏 */
    liveHit: 0,        /* 有多少条旧收藏是靠兜底补上标签的 */
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

  /* 线性图标：不用 emoji，避免各系统字形不一致、也便于随字号缩放 */
  var SVG = {
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4.5h11a1 1 0 0 1 1 1V20l-6.5-3.6L5.5 20V5.5a1 1 0 0 1 1-1Z"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/></svg>',
    rows: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5V9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15M15 20h3.5a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>',
    collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M20 9V5.5A1.5 1.5 0 0 0 18.5 4H15M4 15v3.5A1.5 1.5 0 0 0 5.5 20H9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg>'
  };
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
      tab.innerHTML = '<span class="fv-tab-ico" aria-hidden="true">' + SVG.bookmark + '</span>'
        + '<span class="fv-tab-t">收藏</span>'
        + '<span class="fv-tab-n" id="fv-tab-n" hidden>0</span>';
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
        +   '<div class="fv-d-htxt">'
        +     '<div class="fv-d-title">我的收藏<span class="fv-d-count" id="fv-d-count"></span></div>'
        +     '<div class="fv-d-sub" id="fv-d-sub"></div>'
        +   '</div>'
        +   '<div class="fv-d-acts">'
        +     '<button type="button" class="fv-d-ic" id="fv-d-flat" aria-label="平铺"></button>'
        +     '<button type="button" class="fv-d-ic" id="fv-d-full" aria-label="全屏"></button>'
        +     '<button type="button" class="fv-d-x" id="fv-d-x" aria-label="收起">' + SVG.close + '</button>'
        +   '</div>'
        + '</div>'
        + '<div class="fv-drop-hint" id="fv-drop-hint" hidden>'
        +   '<span class="fv-drop-hint-dot" aria-hidden="true"></span>'
        +   '<span>把图拖到分类，或拖进「上装 / 下装」栏，松手即归入</span>'
        + '</div>'
        + '<div class="fv-d-filter" id="fv-d-filter"></div>'
        + '<div class="fv-d-main">'
        +   '<div class="fv-d-rail" id="fv-d-rail" aria-label="拖到这里归为上装或下装">'
        +     '<button type="button" class="fv-d-rail-z" data-railk="top" title="拖到这里归为上装">'
        +       '<span>上装</span><i id="fv-rail-n-top">0</i></button>'
        +     '<button type="button" class="fv-d-rail-z" data-railk="bottom" title="拖到这里归为下装">'
        +       '<span>下装</span><i id="fv-rail-n-bottom">0</i></button>'
        +   '</div>'
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
      /* 探测 tags 列在不在：不在就在面板上明说，别让"没标签"看起来像"功能没做" */
      if (typeof SB.favTagsReady === "function") {
        try { ST.tagsReady = await SB.favTagsReady(); } catch (e) { ST.tagsReady = null; }
      } else {
        ST.tagsReady = null;
      }
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

  /* 二分类取值：只认 top / bottom，其余（含老数据 null）一律按"未分"处理 */
  function subOf(it) {
    var v = it && it.sub_cat;
    return (v === "top" || v === "bottom") ? v : null;
  }
  function subName(v) { return v === "top" ? "上装" : (v === "bottom" ? "下装" : "未分"); }

  /* 先按分类筛，再按上装/下装筛——两个条件是"与"关系，切分类不该重置二分类 */
  function filtered() {
    var list;
    if (ST.filter === "all") list = ST.items;
    else if (ST.filter === "none") list = ST.items.filter(function (it) { return it.category_id == null; });
    else {
      var cid = Number(ST.filter);
      list = ST.items.filter(function (it) { return Number(it.category_id) === cid; });
    }
    if (ST.sub === "none") return list.filter(function (it) { return subOf(it) == null; });
    if (ST.sub === "top" || ST.sub === "bottom") {
      return list.filter(function (it) { return subOf(it) === ST.sub; });
    }
    return list;
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
        endDropMode(true);          /* 放进分类了：抽屉留着，让用户看到归到哪 */
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

  /* 当前筛选范围落成一个分类 id：拖进来的图默认收进"你正在看的那一类" */
  function currentFilterCid() {
    if (ST.filter === "none") return null;
    if (ST.filter === "all" || ST.filter == null || ST.filter === "") return null;
    var n = Number(ST.filter);
    return isNaN(n) ? null : n;
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

  async function addDropped(row, cid, sub) {
    var SB = SBX();
    if (!SB || typeof SB.addFavItems !== "function") { toast("数据服务未就绪，请刷新页面重试"); return; }
    var realCid = (cid == null || cid === "__none__" || cid === undefined) ? null : Number(cid);
    var c = realCid == null ? null : catOf(realCid);
    var wantSub = (sub === "top" || sub === "bottom") ? sub : null;
    try {
      var n = await SB.addFavItems([row], realCid);
      await refresh();
      /* 拖到「上装 / 下装」上：收藏完顺手把二分类写掉，省一次点击 */
      if (wantSub && SB.setFavSubCat) {
        var url = String((row && (row.image_url || row.imageUrl)) || "");
        var hit = ST.items.filter(function (x) { return String(x.image_url || "") === url; })[0];
        if (hit && hit.id != null) {
          try {
            await SB.setFavSubCat([hit.id], wantSub);
            hit.sub_cat = wantSub;
            render();
            flashSaved("已收藏 " + (n || 1) + " 张到「" + (c ? c.name : "未分类") + "」· 归为" + subName(wantSub));
            return;
          } catch (e) {
            /* 补丁没跑时只影响二分类，收藏本身是成功的，别把用户吓一跳 */
            toast((e && e.message) ? e.message : "收藏成功，但二分类没写进去");
            return;
          }
        }
      }
      flashSaved("已收藏 " + (n || 1) + " 张到「" + (c ? c.name : "未分类") + "」");
    } catch (e) {
      toast((e && e.message) ? e.message : "收藏失败");
    }
  }

  /* 拖动榜单图时把抽屉摊开、让分类变成"文件夹"落点 */
  function openForDrop() {
    ensureDom();
    /* 记住"这次是拖动临时拉开的"：拖到空处（没放进任何分类）要自动收回，
       用户没有主动开过抽屉，不该替他留着。 */
    ST.autoOpened = !ST.open;
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
    var t = $("#fv-tab");
    if (t) { t.classList.add("is-open"); t.setAttribute("aria-expanded", "true"); }
    setDropHint(true);
  }
  /* keep=true 表示"已经放进分类了"，抽屉留着让用户看到结果；
     keep=false（默认）表示没放成（拖到空处 / 拖出窗口），临时拉开的抽屉自动收回。 */
  function endDropMode(keep) {
    var d = $("#fv-drawer");
    if (d) d.classList.remove("is-drop-ready");
    all(".is-drop", document).forEach(function (e) { e.classList.remove("is-drop"); });
    setDropHint(false);
    var wasAuto = !!ST.autoOpened;
    ST.autoOpened = false;
    if (wasAuto && !keep && ST.open) close();
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
    var liveFallback = false;
    if (!tags.length && ST.liveTags) {
      var kp = (it.period_label || "") + "|" + (it.image_url || "");
      var lv = ST.liveTags[kp] || ST.liveTags["*|" + (it.image_url || "")];
      if (lv && lv.length) { tags = lv.slice(); liveFallback = true; }
    }
    var meta = "";
    if (rk != null) meta += '<span class="fv-d-rank">#' + esc(rk) + '</span>';
    /* 卡片上原本显示的信息（周度激增 / 新上榜 / 上升 12 位 / 共 3 国同款）全部带过来；
       位置有限，最多铺 4 个，再多收成 +N，鼠标悬停看全文。 */
    var SHOW_TG = 4;
    tags.slice(0, SHOW_TG).forEach(function (tg) {
      var kind = (/位$/.test(tg) ? " is-move" : "") + (liveFallback ? " is-live" : "");
      meta += '<span class="fv-d-tg' + kind + '">' + esc(tg) + '</span>';
    });
    if (tags.length > SHOW_TG) {
      meta += '<span class="fv-d-tg is-more" title="' + esc(tags.slice(SHOW_TG).join(" · ")) + '">+' + (tags.length - SHOW_TG) + '</span>';
    }
    var full = [it.title, it.leaf_category, cname, rk != null ? ("第 " + rk + " 位") : "", tags.join(" "),
      liveFallback ? "（这些标签来自当前榜单的临时显示，重新收藏一次即可存下来）" : ""]
      .filter(Boolean).join(" · ");
    return '<figure class="fv-d-cell' + (opts.drag ? " is-drag" : "") + '" data-url="' + esc(it.image_url) + '"'
      + (opts.drag ? ' draggable="true" data-id="' + esc(it.id) + '"' : '')
      + ' data-cid="' + esc(cid == null ? "" : cid) + '"'
      + ' style="--i:' + (opts.i || 0) + '"'
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

  /* 二分类工具条：当前分类范围下，上装 / 下装 / 未分 各有多少张。
     除了当筛选器，它本身也是放置目标——把卡片拖到「上装」上就直接改二分类。 */
  function subBarHtml(list) {
    var base = ST.items;
    if (ST.filter === "none") base = base.filter(function (it) { return it.category_id == null; });
    else if (ST.filter !== "all") {
      var cid = Number(ST.filter);
      base = base.filter(function (it) { return Number(it.category_id) === cid; });
    }
    var top = 0, bot = 0, none = 0;
    base.forEach(function (it) {
      var v = subOf(it);
      if (v === "top") top++; else if (v === "bottom") bot++; else none++;
    });
    if (!base.length) return '';
    /* 数据库里还没加 sub_cat 列时，按钮点下去必然失败、点完还会变成空页。
       这里直接给一句能照做的提示，比放一排死按钮好。 */
    if (!subReady()) return subOffHtml();
    var item = function (k, label, n) {
      return '<button type="button" class="fv-sub' + (ST.sub === k ? " is-on" : "") + (k === "none" ? " is-quiet" : "")
        + '" data-sub="' + k + '" data-sub-drop="' + k + '">' + label + '<i>' + n + '</i></button>';
    };
    return '<div class="fv-subbar" id="fv-subbar">'
      + '<span class="fv-subbar-t">二分类</span>'
      + item("all", "全部", base.length)
      + item("top", "上装", top)
      + item("bottom", "下装", bot)
      + (none ? item("none", "未分", none) : '')
      + '</div>';
  }

  /* sub_cat 列是否已存在：只要有一行带这个键就说明列在（值为 null 也算存在） */
  function subReady() {
    if (!ST.items.length) return true;          /* 空库时无法判断，先按可用处理 */
    for (var i = 0; i < ST.items.length; i++) { if (ST.items[i] && "sub_cat" in ST.items[i]) return true; }
    return false;
  }
  function subOffHtml() {
    return '<div class="fv-subbar is-off" id="fv-subbar"><span class="fv-subbar-t">二分类</span>'
      + '<span class="fv-sub-off-tip">未启用：请在数据库执行一次 <code>tools/patch_20261023I.sql</code> 后刷新</span></div>';
  }

  function bindSubBar(root) {
    /* 只绑工具条里的按钮：卡片上的 上/下 按钮用的是同一个 data-sub 属性，
       若在这里一并绑上，点卡片会变成切筛选而不是给这张图分类。 */
    all("#fv-subbar [data-sub]", root).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault();
        ST.sub = b.getAttribute("data-sub");
        render();
      });
    });
    all("#fv-subbar [data-sub-drop]", root).forEach(function (el) {
      var k = el.getAttribute("data-sub-drop");
      if (k === "all" || k === "none") return;
      el.addEventListener("dragover", function (e) {
        /* 两种来源都要接：①抽屉里的图改二分类 ②从榜单卡片直接拖进来（收藏的同时归到这一类） */
        var back = hasExt(e);
        if (ST.dragId == null && !back) return;
        e.preventDefault();
        if (e.dataTransfer) { try { e.dataTransfer.dropEffect = back ? "copy" : "move"; } catch (x) { } }
        el.classList.add("is-drop");
      });
      el.addEventListener("dragleave", function () { el.classList.remove("is-drop"); });
      el.addEventListener("drop", function (e) {
        el.classList.remove("is-drop");
        /* 从榜单拖进来：先收藏到当前分类范围，再直接打上 上装 / 下装 */
        if (hasExt(e)) {
          e.preventDefault(); e.stopPropagation();
          var row = extRow(e);
          endDropMode(true);
          if (row) addDropped(row, currentFilterCid(), k);
          return;
        }
        if (ST.dragId == null) return;
        e.preventDefault(); e.stopPropagation();
        var id = ST.dragId;
        clearDragState(id);
        setSub(id, k);
      });
    });

    /* 空态里的「看全部」：点了就能退出当前二分类筛选（避免"进去出不来"） */
    all("[data-sub='all']", root).forEach(function (b) {
      if (b.closest && !b.closest(".fv-d-empty")) return;
      b.addEventListener("click", function (e) {
        e.preventDefault();
        ST.sub = "all";
        render();
      });
    });
  }

  /* 左栏最外侧那条贯穿上下的拖拽栏：上半 上装、下半 下装。
     两种来源都接——抽屉里已有的图改分类，以及从榜单直接拖进来的图（收藏 + 归类一步到位）。 */
  function bindRail(root) {
    all("#fv-d-rail [data-railk]", root).forEach(function (el) {
      if (el.dataset.railBound === "1") return;
      el.dataset.railBound = "1";
      var k = el.getAttribute("data-railk");
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
        if (hasExt(e)) {
          e.preventDefault(); e.stopPropagation();
          var row = extRow(e);
          endDropMode(true);
          if (row) addDropped(row, currentFilterCid(), k);
          return;
        }
        if (ST.dragId == null) return;
        e.preventDefault(); e.stopPropagation();
        var id = ST.dragId;
        clearDragState(id);
        setSub(id, k);
      });
      /* 点一下也能把当前筛选范围里的图批量归过去，不用非拖不可 */
      el.addEventListener("click", function () {
        var base = filtered();
        if (!base.length) { toast("当前范围里还没有图"); return; }
        var ids = base.filter(function (it) { return subOf(it) !== k; }).map(function (it) { return it.id; });
        if (!ids.length) { toast("都已经在「" + subName(k) + "」里了"); return; }
        setSubMany(ids, k);
      });
    });
  }

  /* 栏上的张数：跟着当前分类范围走，与工具条同一口径 */
  function updateRail() {
    var top = 0, bot = 0, base = filtered();
    base.forEach(function (it) {
      var v = subOf(it);
      if (v === "top") top++; else if (v === "bottom") bot++;
    });
    var nt = $("#fv-rail-n-top"), nb = $("#fv-rail-n-bottom");
    if (nt) nt.textContent = top;
    if (nb) nb.textContent = bot;
    all("#fv-d-rail [data-railk]").forEach(function (el) {
      el.classList.toggle("is-on", el.getAttribute("data-railk") === ST.sub);
    });
  }

  /* 批量设置二分类（点边缘栏、或一次归类当前范围） */
  async function setSubMany(ids, sub) {
    var SB = SBX();
    if (!SB || !SB.setFavSubCat) { toast("二分类功能未就绪，请刷新页面重试"); return; }
    var want = (sub === "top" || sub === "bottom") ? sub : null;
    var real = (ids || []).filter(function (id) { return id != null; });
    if (!real.length) return;
    try {
      await SB.setFavSubCat(real, want);
      ST.items.forEach(function (x) {
        for (var i = 0; i < real.length; i++) { if (Number(real[i]) === Number(x.id)) { x.sub_cat = want; break; } }
      });
      render();
      flashSaved(real.length + " 张已归为" + subName(want));
    } catch (e) {
      toast((e && e.message) ? e.message : "设置失败");
    }
  }

  /* 设置单张图的上装 / 下装；同值不发请求（避免无意义的写库） */
  async function setSub(id, sub) {
    var SB = SBX();
    if (!SB || !SB.setFavSubCat) { toast("二分类功能未就绪，请刷新页面重试"); return false; }
    var it = ST.items.filter(function (x) { return Number(x.id) === Number(id); })[0];
    if (!it) return false;
    var want = (sub === "top" || sub === "bottom") ? sub : null;
    if (subOf(it) === want) { flashSaved("已经是" + subName(want)); return true; }
    try {
      await SB.setFavSubCat([id], want);
      it.sub_cat = want;
      render();
      flashSaved(want ? "已归为" + subName(want) : "已取消二分类");
      return true;
    } catch (e) {
      toast((e && e.message) ? e.message : "设置失败");
      return false;
    }
  }

  function renderBody() {
    bindRail(document);
    updateRail();
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
      /* 关键：即使当前筛选下没有图，也要照常渲染二分类工具条。
         否则点了「上装」发现 0 张、工具条跟着消失，就没有「全部」可点 → 用户会觉得"进去就出不来"。 */
      var bar0 = subBarHtml(list);
      var why;
      if (!ST.items.length) {
        why = '还没有收藏。在图卡片右下角点 <b>☆</b> 即可收藏，收藏后会立刻出现在这里。';
      } else if (ST.sub === "top" || ST.sub === "bottom") {
        why = '「' + subName(ST.sub) + '」下还没有图。把图拖到上方「' + subName(ST.sub) + '」上，或把鼠标移到图上点「'
          + (ST.sub === "top" ? "上" : "下") + '」，就会归到这里。';
      } else if (ST.sub === "none") {
        why = '「未分」下没有图 —— 说明现有收藏都已经分好上装 / 下装了。';
      } else {
        why = '这个分类下还没有图。';
      }
      box.innerHTML = bar0 + '<div class="fv-d-empty">' + why
        + (ST.sub && ST.sub !== "all" ? ' <button type="button" class="fv-d-empty-back" data-sub="all">看全部</button>' : '')
        + '</div>';
      bindSubBar(box);
      return;
    }

    /* 拖拽在抽屉形态也开放：放置目标是顶部筛选 chip，
       全屏形态另有左栏分类与平铺组可接。这样"来回拖"不必先进全屏。 */
    var canDrag = true;
    var seq = 0;                 /* 仅用于入场动画的错峰序号，最多算到 24，后面不再叠加延迟 */
    var nextI = function () { return Math.min(seq++, 24); };
    var h = subBarHtml(list);
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
          grp.items.forEach(function (it) { h += cellHtml(it, { drag: canDrag, i: nextI() }); });
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
          fg.others.forEach(function (it) { h += cellHtml(it, { drag: canDrag, i: nextI() }); });
          h += '</div></details>';
        }
      } else {
        h += '<div class="fv-d-grid">';
        g.items.forEach(function (it) { h += cellHtml(it, { drag: canDrag, i: nextI() }); });
        h += '</div>';
      }
      h += '</section>';
    });
    box.innerHTML = h;
    bindCells();
    bindSubBar(box);
    all(".fv-d-flat, .fv-d-flat-band, [data-flat-none]", box).forEach(function (el) {
      bindDropTarget(el, catDropValue(el));
    });
  }

  function renderCount() {
    var n = ST.items.length;
    var b = $("#fv-tab-n");
    if (b) { b.textContent = String(n > 999 ? "999+" : n); b.hidden = !n; }
    var c = $("#fv-d-count");
    if (c) c.textContent = n ? "· " + n : "";
    /* 副标题：分类数与当前筛选，用一句话说清"现在看到的是什么范围" */
    var sub = $("#fv-d-sub");
    if (sub) {
      var parts = [n + " 张"];
      if ((ST.cats || []).length) parts.push(ST.cats.length + " 个分类");
      if (ST.filter && ST.filter !== "all") {
        var cn = ST.filter === "none" ? "未分类" : (catOf(ST.filter) || {}).name;
        if (cn) parts.push("正在看「" + cn + "」");
      }
      sub.textContent = parts.join(" · ");
    }
  }

  function renderHead() {
    var fb = $("#fv-d-flat"), bf = $("#fv-d-full");
    if (fb) {
      fb.innerHTML = ST.flat ? SVG.rows : SVG.grid;
      fb.classList.toggle("is-on", !!ST.flat);
      fb.setAttribute("aria-pressed", ST.flat ? "true" : "false");
      fb.title = ST.flat ? "回到普通分组视图" : "把已分类的图按类别相邻铺开，未分类的不展开";
    }
    if (bf) {
      bf.innerHTML = ST.view === "full" ? SVG.collapse : SVG.expand;
      bf.title = ST.view === "full" ? "退出全屏（Esc）" : "全屏（Esc 退出）";
      bf.setAttribute("aria-label", ST.view === "full" ? "退出全屏" : "全屏");
    }
    var d = $("#fv-drawer");
    if (d) {
      d.classList.toggle("is-full", ST.view === "full");
      d.classList.toggle("is-flat", !!ST.flat);
    }
    var side = $("#fv-d-side");
    if (side) side.hidden = ST.view !== "full";
  }

  /* 收藏标签（新上榜 / 周度激增 / 上升 N 位）存在 fav_items.tags 列里。
     老库没执行补丁时，写入会静默降级成"能收藏但没标签"——这个降级必须让人看见，
     否则用户会以为功能没做。 */
  function renderWarn() {
    var box = $("#fv-d-warn");
    if (!box) {
      box = document.createElement("div");
      box.id = "fv-d-warn";
      box.className = "fv-d-warn";
      var host = $("#fv-drawer");
      var filt = $("#fv-d-filter");
      if (host && filt) host.insertBefore(box, filt);
    }
    var hasItems = (ST.items || []).length > 0;
    var on = (ST.tagsReady === false) && hasItems;
    var live = (ST.tagsReady !== false) && hasItems && ST.liveHit > 0;
    box.hidden = !(on || live);
    if (on) {
      box.innerHTML = '<b>收藏标签未启用</b>：现在只能存图，<b>新上榜 / 周度激增 / 上升 N 位</b>不会跟着存。'
        + '在数据库执行一次 <code>tools/patch_20261021Y.sql</code>（末尾会通知接口重载），刷新本页后重新收藏即可带上标签。'
        + '已经收藏的图不会自动补——需要重新收藏一次。';
    } else if (live) {
      box.innerHTML = '有 <b>' + ST.liveHit + '</b> 条收藏是补丁前存的，自己没带标签；'
        + '现在显示的标签取自<b>当前榜单</b>（临时，换期就会消失）。想让它们真正存下来，重新收藏一次即可。';
    }
  }

  /* 补丁之前收藏的记录，库里 tags 为空 —— 一律显示"没有标签"会让人以为功能没做。
     这里从当前排行榜的卡片上取同图的标签做「临时显示」（不写库），并明确告知是临时的。
     一旦离开这一期榜单，兜底自然失效，不会假装数据还在。 */
  function scanLiveTags() {
    var m = {};
    var hit = 0;
    var box = document.getElementById("rk-body");
    if (box) {
      all(".rk-card[data-url]", box).forEach(function (fig) {
        var url = fig.getAttribute("data-url") || "";
        if (!url) return;
        var per = fig.getAttribute("data-period") || "";
        var ts = String(fig.getAttribute("data-tags") || "").split("|").filter(function (x) { return x && x.trim(); });
        if (!ts.length) return;
        m[per + "|" + url] = ts;
        if (!m["*|" + url]) m["*|" + url] = ts;
      });
    }
    ST.liveTags = m;
    (ST.items || []).forEach(function (it) {
      if (Array.isArray(it.tags) && it.tags.length) return;
      var k1 = (it.period_label || "") + "|" + (it.image_url || "");
      if (m[k1] || m["*|" + (it.image_url || "")]) hit++;
    });
    ST.liveHit = hit;
  }

  function render() {
    ensureDom();
    scanLiveTags();
    renderWarn();
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
    setDropHint(false);
    await load();
    render();
    animateIn();
  }

  /* 入场：只在真正"打开"这一刻播一次，筛选/重绘不重播，避免每次都像刷新 */
  function animateIn() {
    var box = $("#fv-d-body");
    if (!box) return;
    box.classList.remove("is-in");
    void box.offsetWidth;
    box.classList.add("is-in");
    setTimeout(function () { box.classList.remove("is-in"); }, 900);
  }

  function close() {
    var d = $("#fv-drawer"), t = $("#fv-tab");
    ST.open = false;
    ST.view = "drawer";
    if (d) { d.classList.remove("is-open", "is-full", "is-drop-ready"); d.setAttribute("aria-hidden", "true"); }
    if (t) { t.classList.remove("is-open"); t.setAttribute("aria-expanded", "false"); }
    setDropHint(false);
  }

  /* 拖放提示条：只在"正在从榜单拖图"时出现，平时不占地方 */
  function setDropHint(on) {
    var h = $("#fv-drop-hint");
    if (h) h.hidden = !on;
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
      setSub: setSub,
      subOf: subOf,
      subBarHtml: subBarHtml,
      ensured: function () { return !!$("#fv-drawer"); },
    },
  };
})();