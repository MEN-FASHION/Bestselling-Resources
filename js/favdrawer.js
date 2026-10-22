/* ============================================================================
 * 趋势上升榜 · 右侧「我的收藏」抽屉
 *
 * 解决三个问题：
 *   ① 收藏成功后"东西去哪了"没有去处 —— 点右侧标签即可当场看到刚收藏的图；
 *   ② 顶部菜单的「我的收藏」会被账号的专区白名单挡住（个人数据不该被挡）；
 *   ③ 抽屉必须是浮层：不能挤压/遮挡多列对比池的列宽与列数。
 *
 * 设计约束（都是有意的，改之前先读）：
 *   - 抽屉只有一个：position: fixed，不参与 .gallery-layout 网格 → 列宽零影响；
 *   - 不加全屏遮罩：加遮罩会挡住对比池的点击，等于"影响了对比池"；
 *   - 关闭只靠 ×、Esc、再次点标签 —— 不做"点外面关闭"，因为点外面往往就是要点对比池；
 *   - 数据全走 localStorage 之外的真实接口（fav_items / fav_categories），
 *     按「周（period_label）」分组，与 fav.html 同一套口径。
 * ========================================================================== */
(function () {
  "use strict";

  var MAX_ITEMS = 2000;

  var ST = {
    open: false,
    uid: null,
    ready: null,
    cats: [],
    items: [],
    filter: "all",      /* "all" | 分类 id（数字）| "none"（未分类） */
    loading: false,
    error: "",
    built: false,
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function SBX() { return window.SB || null; }

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
        +     '<a class="fv-d-open" id="fv-d-open" href="fav.html" target="_blank" rel="noopener">完整页面 ↗</a>'
        +     '<button type="button" class="fv-d-x" id="fv-d-x" aria-label="收起">×</button>'
        +   '</div>'
        + '</div>'
        + '<div class="fv-d-filter" id="fv-d-filter"></div>'
        + '<div class="fv-d-body" id="fv-d-body"></div>';
      body.appendChild(d);
      $("#fv-d-x").addEventListener("click", close);
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && ST.open) close();
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
      try { ST.cats = await SB.listFavCategories() || []; } catch (e) { ST.cats = []; }
      ST.items = await SB.listFavItems({ limit: MAX_ITEMS }) || [];
    } catch (e) {
      ST.error = (e && e.message) ? String(e.message) : "读取收藏失败";
      ST.items = [];
    }
    ST.loading = false;
  }

  /* 按周分组：周（period_label）→ 条目，周内保持接口给的顺序（收藏时间倒序） */
  function groupByPeriod(items) {
    var out = [];
    var idx = {};
    (items || []).forEach(function (it) {
      var p = String(it.period_label || "未标注期次");
      if (idx[p] == null) { idx[p] = out.length; out.push({ period: p, items: [] }); }
      out[idx[p]].items.push(it);
    });
    return out;
  }

  function filtered() {
    if (ST.filter === "all") return ST.items;
    if (ST.filter === "none") return ST.items.filter(function (it) { return it.category_id == null; });
    var cid = Number(ST.filter);
    return ST.items.filter(function (it) { return Number(it.category_id) === cid; });
  }

  /* -------------------------------------------------------------- 渲染 */

  function catColor(cid) {
    var c = (ST.cats || []).filter(function (x) { return Number(x.id) === Number(cid); })[0];
    return (c && c.color) || "#8b7355";
  }

  function renderFilter() {
    var box = $("#fv-d-filter");
    if (!box) return;
    var h = '';
    h += '<button type="button" class="fv-d-chip' + (ST.filter === "all" ? " is-on" : "") + '" data-fv-f="all">全部'
      + '<i>' + ST.items.length + '</i></button>';
    (ST.cats || []).forEach(function (c) {
      var n = (ST.items || []).filter(function (it) { return Number(it.category_id) === Number(c.id); }).length;
      h += '<button type="button" class="fv-d-chip' + (Number(ST.filter) === Number(c.id) ? " is-on" : "") + '"'
        + ' data-fv-f="' + c.id + '">'
        + '<span class="fv-d-dot" style="background:' + esc(c.color || "#8b7355") + '"></span>'
        + esc(c.name) + '<i>' + n + '</i></button>';
    });
    var none = (ST.items || []).filter(function (it) { return it.category_id == null; }).length;
    if (none) {
      h += '<button type="button" class="fv-d-chip' + (ST.filter === "none" ? " is-on" : "") + '" data-fv-f="none">未分类<i>' + none + '</i></button>';
    }
    box.innerHTML = h;
    Array.prototype.slice.call(box.querySelectorAll("[data-fv-f]")).forEach(function (b) {
      b.addEventListener("click", function () {
        ST.filter = b.getAttribute("data-fv-f");
        render();
      });
    });
  }

  function renderBody() {
    var box = $("#fv-d-body");
    if (!box) return;

    if (ST.loading) { box.innerHTML = '<div class="fv-d-empty">读取中…</div>'; return; }

    if (!ST.uid) {
      box.innerHTML = '<div class="fv-d-empty">登录后即可在这里看到你收藏的图。</div>';
      return;
    }
    if (ST.ready === false) {
      box.innerHTML = '<div class="fv-d-empty">收藏表还没建好：请在数据库执行一次 '
        + '<code>tools/patch_20261021R.sql</code>，执行后刷新本页。</div>';
      return;
    }
    if (ST.error) {
      box.innerHTML = '<div class="fv-d-empty fv-d-bad">' + esc(ST.error) + '</div>';
      return;
    }

    var list = filtered();
    if (!list.length) {
      box.innerHTML = '<div class="fv-d-empty">'
        + (ST.items.length ? '这个分类下还没有图。' : '还没有收藏。在图卡片右下角点 <b>☆</b> 即可收藏，收藏后会立刻出现在这里。')
        + '</div>';
      return;
    }

    var groups = groupByPeriod(list);
    var h = '';
    groups.forEach(function (g) {
      h += '<section class="fv-d-week">';
      h += '<div class="fv-d-week-h"><span class="fv-d-week-t">' + esc(g.period) + '</span>'
        + '<span class="fv-d-week-n">' + g.items.length + ' 张</span></div>';
      h += '<div class="fv-d-grid">';
      g.items.forEach(function (it) {
        var cid = it.category_id;
        var cname = "";
        if (cid != null) {
          var c = (ST.cats || []).filter(function (x) { return Number(x.id) === Number(cid); })[0];
          cname = c ? c.name : "";
        }
        h += '<figure class="fv-d-cell" data-url="' + esc(it.image_url) + '"'
          + ' title="' + esc((it.title || "") + (cname ? " · " + cname : "")) + '">'
          + '<img src="' + esc(it.image_url) + '" alt="" loading="lazy" decoding="async">'
          + (cname ? '<span class="fv-d-tag" style="background:' + esc(catColor(cid)) + '">' + esc(cname) + '</span>' : '')
          + '<figcaption>' + esc(String(it.title || "").slice(0, 14)) + '</figcaption>'
          + '</figure>';
      });
      h += '</div></section>';
    });
    box.innerHTML = h;

    Array.prototype.slice.call(box.querySelectorAll(".fv-d-cell")).forEach(function (c) {
      c.addEventListener("click", function () {
        var u = c.getAttribute("data-url");
        if (u) window.open(u, "_blank", "noopener");
      });
    });
  }

  function renderCount() {
    var n = (ST.items || []).length;
    var b = $("#fv-tab-n");
    if (b) {
      b.textContent = String(n > 999 ? "999+" : n);
      b.hidden = !n;
    }
    var c = $("#fv-d-count");
    if (c) c.textContent = n ? "· " + n + " 张" : "";
  }

  function render() {
    ensureDom();
    renderCount();
    renderFilter();
    renderBody();
  }

  /* -------------------------------------------------------------- 交互 */

  async function open() {
    ensureDom();
    var d = $("#fv-drawer");
    var t = $("#fv-tab");
    if (!d) return;
    ST.open = true;
    d.classList.add("is-open");
    d.setAttribute("aria-hidden", "false");
    if (t) { t.classList.add("is-open"); t.setAttribute("aria-expanded", "true"); }
    await load();
    render();
  }

  function close() {
    var d = $("#fv-drawer");
    var t = $("#fv-tab");
    ST.open = false;
    if (d) { d.classList.remove("is-open"); d.setAttribute("aria-hidden", "true"); }
    if (t) { t.classList.remove("is-open"); t.setAttribute("aria-expanded", "false"); }
  }

  function toggle() { return ST.open ? (close(), Promise.resolve()) : open(); }

  /* 收藏/取消收藏后由榜单侧调用：抽屉开着就即时刷新，关着就只更新角标 */
  async function refresh() {
    if (!ST.built) { ensureDom(); }
    await load();
    if (ST.open) render();
    else renderCount();
  }

  /* -------------------------------------------------------------- 启动 */

  function boot() {
    ensureDom();
    /* 首屏只取一次角标数字，不打开抽屉、不干扰对比池渲染 */
    if (SBX() && SBX().listFavItems) {
      load().then(function () { renderCount(); });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.FavDrawer = {
    open: open, close: close, toggle: toggle, refresh: refresh, render: render,
    isOpen: function () { return ST.open; },
    state: function () { return ST; },
    _test: { groupByPeriod: groupByPeriod, ensured: function () { return !!$("#fv-drawer"); } },
  };
})();