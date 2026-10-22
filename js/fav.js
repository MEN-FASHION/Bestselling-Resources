/* ============================================================
 * fav.js —— 前台「我的收藏」
 *
 * 结构：周（榜单期次）→ 分类（用户自定义）→ 图
 * 平铺：只平铺「已分类」的图，同类相邻排在一起，组下方横跨一条类别框，
 *       框内写类别名与张数；未分类的图不参与平铺，收在折叠区里。
 * 交易：拖拽改分类（拖到左侧分类或拖到某分类块上）、批量移动、取消收藏。
 * 依赖：config.js / supabase.js / common.js 先加载。
 * ============================================================ */
(function () {
  "use strict";

  var SBX = window.SB;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ============================================================
   * 一、纯逻辑（不碰 DOM，便于验证）
   * ============================================================ */
  var COLORS = ["#8b7355", "#c25e5a", "#4a9c6d", "#5b7c9d", "#b08a4f", "#8a6fa8", "#4f8f8a", "#a0685a"];

  function colorOf(cat, idx) {
    if (cat && cat.color) return cat.color;
    var i = Number(idx) || 0;
    return COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length];
  }

  /* 按周分组：周降序；周内按「分类顺序」排列，未分类单独一桶 */
  function groupWeeks(items, cats) {
    var catMap = {};
    (cats || []).forEach(function (c, i) { catMap[String(c.id)] = { cat: c, idx: i }; });

    var weekMap = {};
    (items || []).forEach(function (it) {
      var w = String(it.period_label || "未标注期次");
      if (!weekMap[w]) weekMap[w] = { week: w, total: 0, groups: {}, none: [] };
      var g = weekMap[w];
      g.total++;
      var cid = (it.category_id == null || it.category_id === "") ? "" : String(it.category_id);
      if (cid && catMap[cid]) {
        if (!g.groups[cid]) g.groups[cid] = { cat: catMap[cid].cat, idx: catMap[cid].idx, items: [] };
        g.groups[cid].items.push(it);
      } else {
        g.none.push(it);   // 分类已被删除 / 从未分类 → 都归到未分类，不会丢图
      }
    });

    var weeks = Object.keys(weekMap).sort(function (a, b) { return a < b ? 1 : (a > b ? -1 : 0); });
    return weeks.map(function (w) {
      var g = weekMap[w];
      var order = Object.keys(g.groups).sort(function (a, b) { return g.groups[a].idx - g.groups[b].idx; });
      return {
        week: g.week,
        total: g.total,
        groups: order.map(function (k) { return g.groups[k]; }),
        none: g.none
      };
    });
  }

  /* 平铺分组：只取「有图的已分类组」，顺序即分类顺序（同类天然相邻） */
  function flatGroups(weekData) {
    return ((weekData && weekData.groups) || []).filter(function (g) { return g && g.items && g.items.length; });
  }

  /* 单周统计：已分类 / 未分类张数、用到的分类数 */
  function weekStat(weekData) {
    var classified = 0, catN = 0;
    flatGroups(weekData).forEach(function (g) { classified += g.items.length; catN++; });
    return {
      classified: classified,
      uncategorized: ((weekData && weekData.none) || []).length,
      catN: catN,
      total: (weekData && weekData.total) || 0
    };
  }

  window.FavCore = {
    COLORS: COLORS,
    colorOf: colorOf,
    groupWeeks: groupWeeks,
    flatGroups: flatGroups,
    weekStat: weekStat
  };

  /* ============================================================
   * 二、状态
   * ============================================================ */
  var ST = {
    uid: null,
    ready: false,
    cats: [],
    items: [],
    filter: "",       // "" 全部 | "none" 未分类 | "c<id>" 某分类
    flat: {},         // week -> true（该周平铺）
    folded: {},       // week -> true（该周整体折叠）
    sel: {},          // item id -> 1
    openNone: {}      // week -> true（平铺时未分类折叠区是否展开）
  };

  function catIdKey(v) { return (v == null || v === "") ? "" : "c" + v; }

  /* ============================================================
   * 三、渲染
   * ============================================================ */
  function cardHtml(it) {
    var cap = [it.period_label, it.site].filter(Boolean).join(" · ");
    var tips = [it.title || it.leaf_category || "", it.rank_category ? ("榜单类目 " + it.rank_category) : ""].filter(Boolean).join("\n");
    return ''
      + '<figure class="fv-card" draggable="true" data-id="' + it.id + '" data-cat="' + (it.category_id || "") + '"'
      + ' data-url="' + esc(it.image_url) + '" title="' + esc(tips) + '">'
      +   '<img loading="lazy" src="' + esc(it.image_url) + '" alt="' + esc(it.leaf_category || "收藏图片") + '">'
      +   '<span class="fv-pick" data-pick="0" title="选中，可批量移动"></span>'
      +   '<button type="button" class="fv-del" data-del="1" title="取消收藏">×</button>'
      +   (cap ? '<figcaption class="fv-cap">' + esc(cap) + '</figcaption>' : '')
      + '</figure>';
  }

  function catBlockHtml(g, idx, mode) {
    var color = colorOf(g.cat, g.idx != null ? g.idx : idx);
    var n = g.items.length;
    if (mode === "flat") {
      /* 平铺：图横向铺开、同类相邻，组下方横跨一条类别框（框宽 = 本组图的宽度） */
      return ''
        + '<div class="fv-flat-group" data-cat="' + g.cat.id + '">'
        +   '<div class="fv-flat-grid">' + g.items.map(cardHtml).join("") + '</div>'
        +   '<div class="fv-tagbar" style="border-top-color:' + color + '">'
        +     '<i class="fv-dot" style="background:' + color + '"></i>'
        +     '<span class="fv-tagname">' + esc(g.cat.name) + '</span>'
        +     '<b class="fv-tagn">' + n + ' 张</b>'
        +   '</div>'
        + '</div>';
    }
    return ''
      + '<div class="fv-catblock" data-cat="' + g.cat.id + '">'
      +   '<div class="fv-cathead">'
      +     '<i class="fv-dot" style="background:' + color + '"></i>'
      +     '<span class="fv-catname">' + esc(g.cat.name) + '</span>'
      +     '<em class="fv-catn">' + n + ' 张</em>'
      +   '</div>'
      +   '<div class="fv-grid">' + g.items.map(cardHtml).join("") + '</div>'
      + '</div>';
  }

  function noneBlockHtml(list, week, mode) {
    if (!list || !list.length) return "";
    if (mode === "flat") {
      /* 未分类不参与平铺：收在折叠区里，默认收起 */
      var open = !!ST.openNone[week];
      return ''
        + '<div class="fv-nonefold' + (open ? " is-open" : "") + '" data-week="' + esc(week) + '">'
        +   '<button type="button" class="fv-nonehead" data-nonetog="1">'
        +     '<i class="fv-dot is-empty"></i>'
        +     '<span>未分类 · ' + list.length + ' 张</span>'
        +     '<em class="fv-nonetip">未分类不参与平铺</em>'
        +     '<span class="fv-arrow">' + (open ? "▾" : "▸") + '</span>'
        +   '</button>'
        +   '<div class="fv-grid fv-nonebody' + (open ? "" : " hidden") + '">' + list.map(cardHtml).join("") + '</div>'
        + '</div>';
    }
    return ''
      + '<div class="fv-catblock is-none" data-cat="">'
      +   '<div class="fv-cathead"><i class="fv-dot is-empty"></i><span class="fv-catname">未分类</span><em class="fv-catn">' + list.length + ' 张</em></div>'
      +   '<div class="fv-grid">' + list.map(cardHtml).join("") + '</div>'
      + '</div>';
  }

  function weekHtml(wd) {
    var st = weekStat(wd);
    var flatOn = !!ST.flat[wd.week];
    var folded = !!ST.folded[wd.week];
    var h = '<section class="fv-week' + (folded ? " is-folded" : "") + '" data-week="' + esc(wd.week) + '">';
    h += '<div class="fv-week-head">'
      + '<button type="button" class="fv-wtog" data-wtog="1" title="收起 / 展开这一周">' + (folded ? "▸" : "▾") + '</button>'
      + '<span class="fv-week-t">' + esc(wd.week) + '</span>'
      + '<span class="fv-week-n">' + st.total + ' 张 · ' + st.catN + ' 个分类' + (st.uncategorized ? ' · 未分类 ' + st.uncategorized : "") + '</span>'
      + '<button type="button" class="fv-btn fv-weekflat' + (flatOn ? " is-on" : "") + '" data-weekflat="1">'
      +   (flatOn ? "收起平铺" : "一键展开") + '</button>'
      + '</div>';

    if (!folded) {
      var mode = flatOn ? "flat" : "grp";
      var groups = flatGroups(wd);
      h += '<div class="fv-week-body' + (mode === "flat" ? " is-flat" : "") + '">';
      if (mode === "flat") {
        if (groups.length) {
          h += '<div class="fv-flat">' + groups.map(function (g, i) { return catBlockHtml(g, i, "flat"); }).join("") + '</div>';
        } else {
          h += '<div class="fv-empty-s">这一周还没有分类好的图。把图拖到左侧分类上，再点「一键展开」。</div>';
        }
        h += noneBlockHtml(wd.none, wd.week, "flat");
      } else {
        if (groups.length) h += groups.map(function (g, i) { return catBlockHtml(g, i, "grp"); }).join("");
        h += noneBlockHtml(wd.none, wd.week, "grp");
        if (!groups.length && !(wd.none || []).length) h += '<div class="fv-empty-s">这一周还没有收藏。</div>';
      }
      h += '</div>';
    }
    h += '</section>';
    return h;
  }

  function renderCats() {
    var el = $("#fv-cats");
    if (!el) return;
    var all = ST.items.length;
    var noneN = ST.items.filter(function (it) { return it.category_id == null || it.category_id === ""; }).length;
    var h = '<button type="button" class="fv-catrow' + (ST.filter === "" ? " is-on" : "") + '" data-filter="">'
      + '<i class="fv-dot is-all"></i><span class="fv-cn">全部收藏</span><em class="fv-cnum">' + all + '</em></button>';
    ST.cats.forEach(function (c, i) {
      var n = ST.items.filter(function (it) { return String(it.category_id) === String(c.id); }).length;
      var key = catIdKey(c.id);
      h += '<button type="button" class="fv-catrow' + (ST.filter === key ? " is-on" : "") + '" data-filter="' + key + '" data-cat="' + c.id + '">'
        + '<i class="fv-dot" style="background:' + colorOf(c, i) + '"></i>'
        + '<span class="fv-cn">' + esc(c.name) + '</span><em class="fv-cnum">' + n + '</em>'
        + '<span class="fv-cat-ops">'
        +   '<b class="fv-op" data-rename="' + c.id + '" title="改名">✎</b>'
        +   '<b class="fv-op" data-rmcat="' + c.id + '" title="删除分类（里面的图会回到未分类）">×</b>'
        + '</span></button>';
    });
    h += '<button type="button" class="fv-catrow is-none' + (ST.filter === "none" ? " is-on" : "") + '" data-filter="none">'
      + '<i class="fv-dot is-empty"></i><span class="fv-cn">未分类</span><em class="fv-cnum">' + noneN + '</em></button>';
    el.innerHTML = h;
  }

  function renderBody() {
    var box = $("#fv-body");
    if (!box) return;
    if (!ST.uid) {
      box.innerHTML = '<div class="fv-empty">登录后才能使用「我的收藏」。请先到<a href="index.html">视觉专区</a>登录。</div>';
      return;
    }
    if (!ST.ready) {
      box.innerHTML = '<div class="fv-empty">'
        + '<div><b>收藏功能还没启用。</b>需要管理员在数据库执行一次建表脚本 '
        + '<code>tools/patch_20261021R.sql</code>（脚本末尾会刷新接口缓存）。</div>'
        + '<button type="button" class="fv-ok" data-fv-recheck>我建好了，重新检测</button>'
        + '</div>';
      return;
    }
    var items = ST.items.filter(function (it) {
      if (ST.filter === "") return true;
      if (ST.filter === "none") return it.category_id == null || it.category_id === "";
      return catIdKey(it.category_id) === ST.filter;
    });
    if (!items.length) {
      box.innerHTML = ST.items.length
        ? '<div class="fv-empty">这个分类下还没有图。到「趋势上升榜」点图片右上角的 ☆ 就能收藏。</div>'
        : '<div class="fv-empty">还没有收藏任何图。到<a href="rank.html">趋势上升榜</a>点图片右上角的 ☆ 即可收藏，收藏时可以选择或新建分类。</div>';
      return;
    }
    var weeks = groupWeeks(items, ST.cats);
    box.innerHTML = weeks.map(weekHtml).join("");
    syncSelUI();
  }

  function renderSummary() {
    var el = $("#fv-sum");
    if (!el) return;
    if (!ST.uid) { el.textContent = "未登录"; return; }
    var weeks = groupWeeks(ST.items, ST.cats);
    var catN = ST.cats.length;
    var noneN = ST.items.filter(function (it) { return it.category_id == null || it.category_id === ""; }).length;
    var selN = Object.keys(ST.sel).length;
    var t = '共 <b>' + ST.items.length + '</b> 张 · <b>' + weeks.length + '</b> 周 · <b>' + catN + '</b> 个分类'
      + (noneN ? ' · 未分类 <b>' + noneN + '</b>' : "");
    if (selN) t += ' · 已选 <b>' + selN + '</b>';
    el.innerHTML = t;

    var ea = $("#fv-expand-all");
    if (ea) ea.disabled = !weeks.length;
    var ca = $("#fv-collapse-all");
    if (ca) ca.disabled = !weeks.length;
  }

  function render() { renderCats(); renderBody(); renderSummary(); }

  function syncSelUI() {
    var box = $("#fv-body");
    if (!box) return;
    $$(".fv-card", box).forEach(function (fig) {
      var on = !!ST.sel[fig.getAttribute("data-id")];
      fig.classList.toggle("is-sel", on);
      var p = $(".fv-pick", fig);
      if (p) p.setAttribute("data-pick", on ? "1" : "0");
    });
  }

  /* ============================================================
   * 四、操作
   * ============================================================ */
  /* 用户执行完建表脚本后，不刷新页面直接重新检测一次 */
  async function recheckReady() {
    var b = document.querySelector("[data-fv-recheck]");
    if (b) { b.disabled = true; b.textContent = "检测中…"; }
    try { ST.ready = await SBX.favReady(); } catch (e) { ST.ready = false; }
    if (ST.ready) { await reload(); toast("收藏功能已就绪"); }
    else { render(); }
  }

  async function reload() {
    try { ST.cats = await SBX.listFavCategories(); } catch (e) { ST.cats = []; }
    try { ST.items = await SBX.listFavItems(); } catch (e) { ST.items = []; toast((e && e.message) || "读取收藏失败"); }
    render();
  }

  async function createCat(name) {
    var n = String(name || "").trim();
    if (!n) { toast("先给分类起个名字"); return; }
    try {
      await SBX.createFavCategory(n, window.FavCore.colorOf(null, ST.cats.length));
      await reload();
      toast("已新建分类「" + n + "」");
    } catch (e) { toast((e && e.message) || "新建分类失败"); }
  }

  async function renameCat(id) {
    var c = ST.cats.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    var n = window.prompt("分类改名", c.name);
    if (n == null) return;
    n = String(n).trim();
    if (!n || n === c.name) return;
    try { await SBX.updateFavCategory(id, { name: n }); await reload(); toast("已改名"); }
    catch (e) { toast((e && e.message) || "改名失败"); }
  }

  async function removeCat(id) {
    var c = ST.cats.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    var n = ST.items.filter(function (it) { return String(it.category_id) === String(id); }).length;
    var msg = n
      ? '删除分类「' + c.name + '」？里面的 ' + n + ' 张图不会消失，会回到「未分类」。'
      : '删除分类「' + c.name + '」？';
    if (!window.confirm(msg)) return;
    try {
      await SBX.deleteFavCategory(id);
      if (ST.filter === catIdKey(id)) ST.filter = "";
      await reload();
      toast("已删除分类，图已退回未分类");
    } catch (e) { toast((e && e.message) || "删除分类失败"); }
  }

  async function moveItems(ids, categoryId) {
    if (!ids.length) return;
    try {
      await SBX.moveFavItems(ids, categoryId);
      var cid = (categoryId == null || categoryId === "") ? null : Number(categoryId);
      ST.items.forEach(function (it) {
        if (ids.indexOf(String(it.id)) >= 0) it.category_id = cid;
      });
      ST.sel = {};
      render();
      var c = ST.cats.filter(function (x) { return String(x.id) === String(cid); })[0];
      toast(c ? ('已移到「' + c.name + '」') : "已移到未分类");
    } catch (e) { toast((e && e.message) || "移动失败"); }
  }

  async function removeItem(id) {
    try {
      await SBX.removeFavItems([id]);
      ST.items = ST.items.filter(function (it) { return String(it.id) !== String(id); });
      delete ST.sel[String(id)];
      render();
      toast("已取消收藏");
    } catch (e) { toast((e && e.message) || "取消收藏失败"); }
  }

  function expandAll(on) {
    var weeks = groupWeeks(ST.items, ST.cats);
    ST.flat = {};
    if (on) weeks.forEach(function (wd) { if (flatGroups(wd).length) ST.flat[wd.week] = true; });
    render();
    if (on) {
      var n = Object.keys(ST.flat).length;
      toast(n ? ("已平铺 " + n + " 周（未分类不参与平铺）") : "还没有分类好的图，先把图拖到分类里");
    }
  }

  /* ============================================================
   * 五、事件
   * ============================================================ */
  function bind() {
    var body = $("#fv-body");
    if (!body) return;

    /* 点击类：周折叠、周平铺、未分类折叠、勾选、取消收藏、灯箱 */
    body.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var rc = t.closest("[data-fv-recheck]");
      if (rc) { recheckReady(); return; }

      var wt = t.closest("[data-wtog]");
      if (wt) {
        var wk = wt.closest(".fv-week").getAttribute("data-week");
        ST.folded[wk] = !ST.folded[wk];
        render(); return;
      }
      var wf = t.closest("[data-weekflat]");
      if (wf) {
        var wk2 = wf.closest(".fv-week").getAttribute("data-week");
        ST.flat[wk2] = !ST.flat[wk2];
        render(); return;
      }
      var nt = t.closest("[data-nonetog]");
      if (nt) {
        var wk3 = nt.closest(".fv-week").getAttribute("data-week");
        ST.openNone[wk3] = !ST.openNone[wk3];
        render(); return;
      }
      var del = t.closest("[data-del]");
      if (del) {
        e.preventDefault(); e.stopPropagation();
        var fig = del.closest(".fv-card");
        if (fig && window.confirm("取消收藏这张图？")) removeItem(fig.getAttribute("data-id"));
        return;
      }
      var pick = t.closest(".fv-pick");
      if (pick) {
        e.preventDefault(); e.stopPropagation();
        var fig2 = pick.closest(".fv-card");
        if (!fig2) return;
        var id = fig2.getAttribute("data-id");
        if (ST.sel[id]) delete ST.sel[id]; else ST.sel[id] = 1;
        syncSelUI(); renderSummary();
        return;
      }
      /* 点图看大图（只有点击图片本身，不点按钮） */
      var card = t.closest(".fv-card");
      if (card && !t.closest(".fv-pick") && !t.closest(".fv-del")) {
        openLB(card.getAttribute("data-url"));
      }
    });

    /* 拖拽 */
    body.addEventListener("dragstart", function (e) {
      var card = e.target && e.target.closest ? e.target.closest(".fv-card") : null;
      if (!card) return;
      var id = card.getAttribute("data-id");
      var ids = ST.sel[id] ? Object.keys(ST.sel) : [id];
      try {
        e.dataTransfer.setData("text/plain", JSON.stringify(ids));
        e.dataTransfer.effectAllowed = "move";
      } catch (err) { /* 忽略 */ }
      card.classList.add("is-dragging");
    });
    body.addEventListener("dragend", function (e) {
      var card = e.target && e.target.closest ? e.target.closest(".fv-card") : null;
      if (card) card.classList.remove("is-dragging");
      $$(".is-over", body).forEach(function (x) { x.classList.remove("is-over"); });
    });
    body.addEventListener("dragover", function (e) {
      var tgt = e.target && e.target.closest ? (e.target.closest(".fv-catblock") || e.target.closest(".fv-flat-group")) : null;
      if (!tgt) return;
      e.preventDefault();
      $$(".is-over", body).forEach(function (x) { if (x !== tgt) x.classList.remove("is-over"); });
      tgt.classList.add("is-over");
    });
    body.addEventListener("dragleave", function (e) {
      var tgt = e.target && e.target.closest ? (e.target.closest(".fv-catblock") || e.target.closest(".fv-flat-group")) : null;
      if (tgt) tgt.classList.remove("is-over");
    });
    body.addEventListener("drop", function (e) {
      var tgt = e.target && e.target.closest ? (e.target.closest(".fv-catblock") || e.target.closest(".fv-flat-group")) : null;
      if (!tgt) return;
      e.preventDefault();
      tgt.classList.remove("is-over");
      var ids = [];
      try { ids = JSON.parse(e.dataTransfer.getData("text/plain") || "[]"); } catch (err) { ids = []; }
      if (!Array.isArray(ids) || !ids.length) return;
      moveItems(ids.map(String), tgt.getAttribute("data-cat"));
    });

    /* 分类点击 / 改名 / 删除 */
    var cats = $("#fv-cats");
    if (cats) {
      cats.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var rn = t.closest("[data-rename]");
        if (rn) { renameCat(rn.getAttribute("data-rename")); return; }
        var rm = t.closest("[data-rmcat]");
        if (rm) { removeCat(rm.getAttribute("data-rmcat")); return; }
        var row = t.closest(".fv-catrow");
        if (!row) return;
        ST.filter = row.getAttribute("data-filter") || "";
        render();
      });

      /* 左侧分类作为拖拽落点 */
      cats.addEventListener("dragover", function (e) {
        var row = e.target && e.target.closest ? e.target.closest(".fv-catrow") : null;
        if (!row || !row.hasAttribute("data-cat")) return;
        e.preventDefault();
        $$(".is-over", cats).forEach(function (x) { if (x !== row) x.classList.remove("is-over"); });
        row.classList.add("is-over");
      });
      cats.addEventListener("dragleave", function (e) {
        var row = e.target && e.target.closest ? e.target.closest(".fv-catrow") : null;
        if (row) row.classList.remove("is-over");
      });
      cats.addEventListener("drop", function (e) {
        var row = e.target && e.target.closest ? e.target.closest(".fv-catrow") : null;
        if (!row) return;
        e.preventDefault();
        row.classList.remove("is-over");
        var ids = [];
        try { ids = JSON.parse(e.dataTransfer.getData("text/plain") || "[]"); } catch (err) { ids = []; }
        if (!Array.isArray(ids) || !ids.length) return;
        moveItems(ids.map(String), row.getAttribute("data-cat"));
      });
    }

    /* 顶部按钮 */
    var ea = $("#fv-expand-all");
    if (ea) ea.onclick = function () { expandAll(true); };
    var ca = $("#fv-collapse-all");
    if (ca) ca.onclick = function () { ST.flat = {}; render(); };

    /* 新建分类 */
    var nb = $("#fv-new"), nbox = $("#fv-newbox"), nin = $("#fv-newname");
    if (nb) nb.onclick = function () {
      if (!nbox) return;
      nbox.classList.toggle("hidden");
      if (!nbox.classList.contains("hidden") && nin) nin.focus();
    };
    var nok = $("#fv-newok");
    if (nok) nok.onclick = function () {
      createCat(nin ? nin.value : "");
      if (nin) nin.value = "";
      if (nbox) nbox.classList.add("hidden");
    };
    var ncan = $("#fv-newcancel");
    if (ncan) ncan.onclick = function () { if (nbox) nbox.classList.add("hidden"); };
    if (nin) nin.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { nok && nok.click(); }
      if (e.key === "Escape") { if (nbox) nbox.classList.add("hidden"); }
    });

    /* Esc 关灯箱 */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeLB();
    });
  }

  /* ============================================================
   * 六、轻量灯箱
   * ============================================================ */
  function closeLB() {
    var lb = $("#fv-lb");
    if (lb && lb.parentNode) lb.parentNode.removeChild(lb);
  }
  function openLB(url) {
    if (!url) return;
    closeLB();
    var d = document.createElement("div");
    d.id = "fv-lb";
    d.className = "fv-lb";
    d.innerHTML = '<div class="fv-lb-bg" data-lbclose="1"></div><img src="' + esc(url) + '" alt="预览"><button type="button" class="fv-lb-x" data-lbclose="1">×</button>';
    d.addEventListener("click", function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute("data-lbclose")) closeLB();
    });
    document.body.appendChild(d);
  }

  /* ============================================================
   * 七、鉴权 + 启动
   * ============================================================ */
  async function renderAuth() {
    var email = "", ok = false;
    try {
      var s = await SBX.getSession();
      if (s && s.user) { email = s.user.email || ""; ok = true; }
    } catch (e) { /* 忽略 */ }
    var u = $("#fv-user"), lo = $("#fv-logout"), li = $("#fv-login");
    if (u) { u.textContent = email; u.classList.toggle("hidden", !ok); }
    if (lo) {
      lo.classList.toggle("hidden", !ok);
      lo.onclick = async function () {
        try { await SBX.signOut(); } catch (e) { /* 忽略 */ }
        location.href = "index.html";
      };
    }
    if (li) li.classList.toggle("hidden", ok);
    ST.uid = ok ? ((await SBX.favUid()) || "u") : null;
    return ok;
  }

  function gate(msg) {
    var body = $("#fv-body");
    if (body) {
      body.innerHTML = '<div class="fv-gate"><div class="fv-gate-ico">🔒</div>'
        + '<div class="fv-gate-t">暂无法查看「我的收藏」</div>'
        + '<div class="fv-gate-w">' + esc(msg) + '</div>'
        + '<div class="fv-gate-tip">请联系超级管理员，在后台「权限管理 → 该用户编辑」中勾选「我的收藏」并保存，然后回到本页强制刷新（Ctrl+F5）。</div>'
        + '</div>';
    }
    var cats = $("#fv-cats");
    if (cats) cats.innerHTML = '<div class="fv-empty-s">—</div>';
    var sum = $("#fv-sum");
    if (sum) sum.textContent = "当前账号不可访问该专区";
  }

  async function boot() {
    if (!SBX) {
      var body = $("#fv-body");
      if (body) body.innerHTML = '<div class="fv-empty">数据服务未就绪，请刷新页面重试。</div>';
      return;
    }
    var logged = await renderAuth();

    /* 专区可见性守门：①全站开关 ②用户级白名单（与其他专区同一套口径） */
    var vis = null, myz = null;
    try { vis = await SBX.getFrontendZoneVisibility(); } catch (e) { /* 读取失败照常展示 */ }
    try { myz = await SBX.myFrontendZones(); } catch (e) { myz = null; }
    if (window.Common && Common.zones) {
      Common.zones.setVis(vis || {});
      Common.zones.setMine(Array.isArray(myz) ? myz : null);
      if (Common.zones.applyNav) Common.zones.applyNav(); else Common.zones.renderNav();
    }
    if (vis && vis.fav === false) { gate("全站开关：该专区已在后台「前台访问设置」中被关闭"); return; }
    /* 「我的收藏」是个人专区：不再用账号的专区白名单挡它（白名单只管公共业务专区）。
       否则会出现"收藏成功了但打不开收藏页"。此处保留判断入口便于以后回滚。 */
    if (false && logged && Array.isArray(myz) && myz.length && myz.indexOf("fav") === -1) {
      gate("账号授权：你的账号未获授权访问本专区"); return;
    }

    bind();
    if (!logged) { ST.uid = null; render(); return; }

    try { ST.ready = await SBX.favReady(); } catch (e) { ST.ready = false; }
    if (!ST.ready) { render(); return; }
    await reload();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();