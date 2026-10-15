/* ============================================================================
 * rank.js —— 前台「趋势上升榜」专区
 *
 * 布局：与「视觉专区」一致 —— 左侧类目菜单栏 + 上方筛选栏（悬停/点击展开）+ 多列对比池
 *
 * 两种对比模式（严格按需求口径）：
 *   ① 横向 · 国家对比：选 1 个类目 + 选 1 个周次 + 多选国家 → 每国一列并排；
 *      列头标注「与其余所选国家重合多少张 / 重合度」；同一张图出现在多国时卡片角标「共 N 国」。
 *   ② 纵向 · 时间对比：选 1 个类目 + 选 1 个国家 + 多选周次 → 每期一列并排；
 *      相同图标注「新上榜 / 上升 N 位 / 下降 N 位」。
 *
 * 三档标签（与后台同口径 · A 口径：同 类目+站点+期次 各自一池）：
 *   潜力机会 = 环比比例上升；趋势爆款 = 环比绝对值上升前 20 名；
 *   周度激增 = 比例与绝对值双重提升的前 20%（至少 1 个）。
 *
 * 硬性约束：前台不出现任何环比具体数值，只用标签与位次变化表达。
 * ==========================================================================*/
(function () {
  "use strict";

  var SBX = (typeof SB !== "undefined") ? SB : (window.SB || null);
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };

  var ALL = "全部";
  var CAP_STEP = 48;         // 每列初始展示张数（先小，避免一次拉太多图片）
  var CAP_MAX = 288;         // 每列上限

  var FACETS = { sites: [], periods: [], categories: [] };
  var MODE = "h";            // h=横向·国家对比 / v=纵向·时间对比
  var CAT = ALL;
  var SEL_SITES = [];        // h：多选；v：仅第一个生效
  var SEL_PERIODS = [];      // h：仅第一个生效；v：多选
  var GROUPS = [];           // 后台定义的地区分组：[{name, members:[站点名…]}]（如「欧洲」= 英国/德国/法国…）
  var SEL_GROUP = "";        // 选中的地区名；非空时按整个地区合并成一列，只能单选
  var TAGS = ["all"];        // all | surge | hot | opportunity
  var SORT = "ratio_desc";   // ratio_desc / ratio_asc / abs_desc / abs_asc
  var MOVE = "off";          // off | move（位次上升最多） | new（新上榜优先）——仅纵向·时间对比有效
  var MOVE_SCOPE = "all";    // all = 全部期次都按位次重排；或某个具体期次（只重排该列）
  var SIZE = "m";            // s | m | l
  var CAP = CAP_STEP;
  var CACHE = null;          // { key, items }
  var ITEMS_BY_URL = {};     // 灯箱用：url → 条目

  /* ---------------- 期次排序 ---------------- */
  function periodKey(p) {
    var s = String(p || "").trim();
    var ym = s.match(/(20\d{2})/);
    var year = ym ? parseInt(ym[1], 10) : 0;
    var m;
    /* 1) 明确日期 2026-10-14 */
    m = s.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return parseInt(m[1], 10) * 10000 + 300 + parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
    /* 2) 周次：W41 / w41 / 41周 / 第41周 / 2026-W41 */
    m = s.match(/[Ww]\s*(\d{1,2})/) || s.match(/第?\s*(\d{1,2})\s*周/);
    if (m) return year * 10000 + 100 + parseInt(m[1], 10);
    /* 3) 月份：2026-09 / 2026年9月 / 9月 */
    m = s.match(/(20\d{2})\D{0,3}(\d{1,2})\s*月?$/) || s.match(/^(\d{1,2})\s*月$/);
    if (m) return year * 10000 + 200 + parseInt(m[m.length - 1], 10);
    /* 4) 纯数字当周次 */
    m = s.match(/^(\d{1,3})$/);
    if (m) return year * 10000 + 100 + parseInt(m[1], 10);
    return 990000 + (s.charCodeAt(0) || 0);
  }
  function sortPeriods(arr) { return arr.slice().sort(function (a, b) { return periodKey(a) - periodKey(b); }); }

  /* 数据时间轴里排在某一期次前面的那一期（不受当前勾选影响；纵向对比永远比"上一周"） */
  function prevOfPeriod(p) {
    var all = sortPeriods(FACETS.periods);
    var i = all.indexOf(p);
    return i > 0 ? all[i - 1] : null;
  }
  function withBasePeriods(periods) {
    var need = periods.slice();
    periods.forEach(function (p) {
      var q = prevOfPeriod(p);
      if (q && need.indexOf(q) < 0) need.push(q);
    });
    return need;
  }

  /* ---------------- 三档标签（A 口径：类目+站点+期次 各自一池） ---------------- */
  function flagPools(items) {
    var pools = {};
    items.forEach(function (it) {
      var k = (it.category || "") + "\u0001" + (it.site || "") + "\u0001" + (it.period_label || "");
      (pools[k] = pools[k] || []).push(it);
    });
    Object.keys(pools).forEach(function (k) {
      var pool = pools[k];
      pool.forEach(function (r) { r._opp = false; r._hot = false; r._surge = false; });
      var byRatio = pool.filter(function (r) { return r.ratio != null; })
        .sort(function (a, b) { return b.ratio - a.ratio; });
      byRatio.forEach(function (r, i) { r._rk = i + 1; });
      var byAbs = pool.filter(function (r) { return r.abs_delta != null; })
        .sort(function (a, b) { return b.abs_delta - a.abs_delta; });
      byAbs.forEach(function (r, i) { r._ak = i + 1; });
      pool.forEach(function (r) { r._opp = (r.ratio != null && r.ratio > 0); });
      byAbs.filter(function (r) { return r.abs_delta > 0; }).slice(0, 20).forEach(function (r) { r._hot = true; });
      var dual = byRatio.filter(function (r) { return r.ratio > 0 && r.abs_delta != null && r.abs_delta > 0; });
      var n = dual.length ? Math.max(1, Math.round(dual.length * 0.2)) : 0;
      dual.slice(0, n).forEach(function (r) { r._surge = true; });
    });
    return items;
  }

  function hitTags(it) {
    if (!TAGS.length || TAGS.indexOf("all") >= 0) return true;
    if (TAGS.indexOf("surge") >= 0 && it._surge) return true;
    if (TAGS.indexOf("hot") >= 0 && it._hot) return true;
    if (TAGS.indexOf("opportunity") >= 0 && it._opp) return true;
    return false;
  }

  function sortItems(arr) {
    var a = arr.slice();
    if (SORT === "ratio_desc") a.sort(function (x, y) { return (y.ratio == null ? -Infinity : y.ratio) - (x.ratio == null ? -Infinity : x.ratio); });
    else if (SORT === "ratio_asc") a.sort(function (x, y) { return (x.ratio == null ? Infinity : x.ratio) - (y.ratio == null ? Infinity : y.ratio); });
    else if (SORT === "abs_desc") a.sort(function (x, y) { return (y.abs_delta == null ? -Infinity : y.abs_delta) - (x.abs_delta == null ? -Infinity : x.abs_delta); });
    else a.sort(function (x, y) { return (x.abs_delta == null ? Infinity : x.abs_delta) - (y.abs_delta == null ? Infinity : y.abs_delta); });
    return a;
  }

  function badgeOf(it) {
    if (it._surge) return { cls: "flag-surge", txt: "周度激增" };
    if (it._hot) return { cls: "flag-hot", txt: "趋势爆款" };
    if (it._opp) return { cls: "flag-opportunity", txt: "潜力机会" };
    return null;
  }

  /* ---------------- 轻提示 ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ---------------- 取数 ---------------- */
  function activeSites() { return MODE === "v" ? SEL_SITES.slice(0, 1) : SEL_SITES.slice(); }

  /* ---------------- 地区分组：把多个国家并成一列 ----------------
     后台把「英国 / 德国 / 法国…」放进「欧洲」这个地区后：
     选中国 → 多国数据合并成「欧洲」一列（同一张图在多国都上榜时只留一条）；
     不选地区 → 仍可按单个国家对比（两种方式随你切）。 */
  function activeGroup() {
    if (!SEL_GROUP) return null;
    if (MODE === "v") { /* 纵向也要能用：单列显示该地区 */ }
    var g = GROUPS.filter(function (x) { return x.name === SEL_GROUP; })[0];
    if (!g) return null;
    var mem = (g.members || []).filter(function (m) { return FACETS.sites.indexOf(m) >= 0; });
    return { name: g.name, members: mem };
  }
  /* 去数据库取数时用的站点清单：选了地区 → 该地区的所有国家 */
  function sitesForQuery() {
    var g = activeGroup();
    if (g) return g.members.slice();
    return activeSites();
  }
  /* 对比池的列名：选了地区 → 一列「欧洲」 */
  function poolSites() {
    var g = activeGroup();
    return g ? [g.name] : activeSites();
  }
  /* 把地区内多国的同名商品合并成一条（取环比更强的那个） */
  function mergeGroupItems(items, g) {
    var byKey = {};
    (items || []).forEach(function (it) {
      if (g.members.indexOf(it.site) < 0) return;
      var k = it.image_url || ((it.leaf_category || "") + "\u0001" + (it.title || "") + "\u0001" + (it.period_label || ""));
      var prev = byKey[k];
      it.site = g.name;
      if (!prev) { byKey[k] = it; return; }
      var a = prev.ratio, b = it.ratio;
      var better;
      if (b != null && a == null) better = true;
      else if (b != null && a != null) better = b > a;
      else if (b == null && a == null) better = Number(it.abs_delta || 0) > Number(prev.abs_delta || 0);
      else better = false;
      if (better) byKey[k] = it;
    });
    return Object.keys(byKey).map(function (k) { return byKey[k]; });
  }
  function activePeriods() {
    if (MODE === "h") { var sp = sortPeriods(SEL_PERIODS); return sp.length ? [sp[sp.length - 1]] : []; }
    return sortPeriods(SEL_PERIODS);
  }

  async function fetchItems() {
    var sites = sitesForQuery();
    var periods = activePeriods();
    if (!sites.length || !periods.length) return [];
    var key = [CAT, MODE, SEL_GROUP || "", sites.join("|"), periods.join("|")].join("\u00a7");
    if (CACHE && CACHE.key === key) return CACHE.items;

    /* 纵向对比需要拿到「上一周」的数据做基线，一并取回但不单独成列 */
    var needPeriods = MODE === "v" ? withBasePeriods(periods) : periods;
    var filter = { sites: sites, periods: needPeriods };
    if (CAT && CAT !== ALL) filter.category = CAT;
    else if (FACETS.categories.length) filter.categories = FACETS.categories;

    var items = [];
    try { items = await SBX.listRankItems(filter); } catch (e) { items = []; }
    items = (items || []).map(function (it) {
      it.ratio = (it.ratio == null ? null : Number(it.ratio));
      it.abs_delta = (it.abs_delta == null ? null : Number(it.abs_delta));
      return it;
    });
    var _g = activeGroup();
    if (_g) items = mergeGroupItems(items, _g);   // 地区模式：多国合并成一列，同名商品只留最强的那个
    flagPools(items);
    ITEMS_BY_URL = {};
    items.forEach(function (it) { if (it.image_url) ITEMS_BY_URL[it.image_url] = it; });
    CACHE = { key: key, items: items };
    return items;
  }

  /* ---------------- 类目菜单（同视觉专区） ---------------- */
  function renderCats() {
    var box = $("#rk-cats");
    if (!box) return;
    var list = FACETS.categories.slice();
    if (!list.length) { box.innerHTML = '<div class="rk-empty">暂无类目</div>'; return; }
    box.innerHTML = "";
    [ALL].concat(list).forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cat-menu-item" + (c === CAT ? " active" : "");
      b.textContent = c;
      b.onclick = function () {
        CAT = c; CACHE = null; CAP = CAP_STEP;
        renderCats(); renderPanel(); renderSummary(); load();
      };
      box.appendChild(b);
    });
  }

  /* ---------------- 筛选面板（悬停/点击展开） ---------------- */
  function chip(val, label, on, attr) {
    return '<button type="button" class="tag-chip' + (on ? " active" : "") + '" ' + attr + '="' + esc(val) + '">' + esc(label) + '</button>';
  }

  function renderPanel() {
    var box = $("#rk-groups");
    if (!box) return;
    var periods = sortPeriods(FACETS.periods);

    var sitesHtml = FACETS.sites.length
      ? FACETS.sites.map(function (s) { return chip(s, s, SEL_SITES.indexOf(s) >= 0 && !SEL_GROUP, "data-site"); }).join("")
      : '<span class="rk-note">后台还没有维护国家站点</span>';

    /* 地区（后台把多个国家并成一个地区）：选中即整区合并成一列；也可以不选，直接挑单个国家 */
    var grpList = GROUPS.filter(function (g) { return g.name && (g.members || []).length; });
    var groupHtml = "";
    if (grpList.length) {
      groupHtml = '<div class="tag-group"><span class="tag-group-name">地区（合并整区对比）</span><div class="tag-chips" id="rk-g-groups">' +
        grpList.map(function (g) {
          return chip(g.name, g.name + "（" + g.members.length + " 国）", SEL_GROUP === g.name, "data-group");
        }).join("") +
        (SEL_GROUP ? chip("", "取消地区", false, "data-group") : "") +
        '</div></div>';
    }

    var periodsHtml = periods.length
      ? periods.map(function (p) { return chip(p, p, SEL_PERIODS.indexOf(p) >= 0, "data-period"); }).join("")
      : '<span class="rk-note">后台还没有上传榜单数据</span>';

    var tagList = [["all", "全部"], ["surge", "周度激增"], ["hot", "趋势爆款"], ["opportunity", "潜力机会"]];
    var tagsHtml = tagList.map(function (t) { return chip(t[0], t[1], TAGS.indexOf(t[0]) >= 0, "data-tag"); }).join("");

    var sortList = [["ratio_desc", "环比比例 高→低"], ["ratio_asc", "环比比例 低→高"], ["abs_desc", "环比绝对值 高→低"], ["abs_asc", "环比绝对值 低→高"]];
    var sortHtml = sortList.map(function (t) { return chip(t[0], t[1], SORT === t[0], "data-sort"); }).join("");

    var sizeList = [["s", "小"], ["m", "中"], ["l", "大"]];
    var sizeHtml = sizeList.map(function (t) { return chip(t[0], t[1], SIZE === t[0], "data-size"); }).join("");

    var modeHtml =
      chip("h", "横向 · 国家对比", MODE === "h", "data-mode") +
      chip("v", "纵向 · 时间对比", MODE === "v", "data-mode");

    /* 位次排序（仅纵向有效）：新上榜 / 上升位次最多的排最前面 */
    var moveHtml =
      chip("off", "默认（环比）", MOVE === "off", "data-move") +
      chip("move", "位次上升最多", MOVE === "move", "data-move") +
      chip("new", "新上榜优先", MOVE === "new", "data-move");
    var scopeHtml = "";
    if (MODE === "v" && MOVE !== "off") {
      scopeHtml = chip("all", "全部期次", MOVE_SCOPE === "all", "data-scope") +
        sortPeriods(SEL_PERIODS).map(function (p) { return chip(p, "仅 " + p, MOVE_SCOPE === p, "data-scope"); }).join("");
    }
    /* 趋势标签 + 排序 / 图幅 / 位次排序 全部并列在同一排直接展示，无需再点开 */
    var mergedRow =
      '<div class="tag-group"><span class="tag-group-name">趋势标签 / 排序</span><div class="tag-chips" id="rk-g-merge">' +
        '<span class="tag-inline" id="rk-g-tags">' + tagsHtml + '</span>' +
        '<span class="tag-sep"></span><span class="tag-sub">排序</span>' +
        '<span class="tag-inline" id="rk-g-sort">' + sortHtml + '</span>' +
        '<span class="tag-sep"></span><span class="tag-sub">图幅</span>' +
        '<span class="tag-inline" id="rk-g-size">' + sizeHtml + '</span>' +
        '<span class="tag-sep"></span><span class="tag-sub">位次排序' +
          (MODE === "v" ? "（对比上一周）" : "（仅纵向有效）") + '</span>' +
        '<span class="tag-inline" id="rk-g-move">' + moveHtml + '</span>' +
        (scopeHtml
          ? '<span class="tag-sep"></span><span class="tag-sub">范围</span><span class="tag-inline" id="rk-g-scope">' + scopeHtml + '</span>'
          : '') +
      '</div></div>';

    box.innerHTML =
      '<div class="tag-group"><span class="tag-group-name">对比模式</span><div class="tag-chips" id="rk-g-mode">' + modeHtml + '</div></div>' +
      groupHtml +
      '<div class="tag-group"><span class="tag-group-name">国家站点' + (SEL_GROUP ? "（已按地区合并，点上方「取消地区」可单选国家）" : (MODE === "v" ? "（单选）" : "（可多选）")) + '</span><div class="tag-chips" id="rk-g-sites">' + sitesHtml + '</div></div>' +
      '<div class="tag-group"><span class="tag-group-name">周次 / 期次' + (MODE === "h" ? "（单选）" : "（可多选）") + '</span><div class="tag-chips" id="rk-g-periods">' + periodsHtml + '</div></div>' +
      mergedRow;

    bindPanel();
  }

  function bindPanel() {
    var modeBox = $("#rk-g-mode");
    if (modeBox) Array.prototype.forEach.call(modeBox.querySelectorAll("[data-mode]"), function (b) {
      b.onclick = function () {
        var m = b.getAttribute("data-mode");
        if (m === MODE) return;
        MODE = m;
                CACHE = null; CAP = CAP_STEP;
        renderPanel(); renderSummary(); renderBar(); load();
      };
    });

    var siteBox = $("#rk-g-sites");
    if (siteBox) Array.prototype.forEach.call(siteBox.querySelectorAll("[data-site]"), function (b) {
      b.onclick = function () {
        var v = b.getAttribute("data-site");
        SEL_GROUP = "";                       /* 选单个国家 → 取消地区合并 */
        if (MODE === "v") {
          SEL_SITES = [v];
        } else {
          var i = SEL_SITES.indexOf(v);
          if (i >= 0) SEL_SITES.splice(i, 1); else SEL_SITES.push(v);
        }
        if (!SEL_SITES.length) SEL_SITES = FACETS.sites.slice(0, 4);   /* 全取消时回落到前 4 个，避免空页 */
        CACHE = null; CAP = CAP_STEP;
        renderPanel(); renderSummary(); renderBar(); load();
      };
    });

    var grpBox = $("#rk-g-groups");
    if (grpBox) Array.prototype.forEach.call(grpBox.querySelectorAll("[data-group]"), function (b) {
      b.onclick = function () {
        var v = b.getAttribute("data-group");
        SEL_GROUP = (v && v !== SEL_GROUP) ? v : "";
        CACHE = null; CAP = CAP_STEP;
        renderPanel(); renderSummary(); renderBar(); load();
      };
    });

    var pBox = $("#rk-g-periods");
    if (pBox) Array.prototype.forEach.call(pBox.querySelectorAll("[data-period]"), function (b) {
      b.onclick = function () {
        var v = b.getAttribute("data-period");
        if (MODE === "h") {
          SEL_PERIODS = [v];
        } else {
          var i = SEL_PERIODS.indexOf(v);
          if (i >= 0) SEL_PERIODS.splice(i, 1); else SEL_PERIODS.push(v);
        }
        CACHE = null; CAP = CAP_STEP;
        renderPanel(); renderSummary(); renderBar(); load();
      };
    });

    var tagBox = $("#rk-g-tags");
    if (tagBox) Array.prototype.forEach.call(tagBox.querySelectorAll("[data-tag]"), function (b) {
      b.onclick = function () {
        var v = b.getAttribute("data-tag");
        if (v === "all") TAGS = ["all"];
        else {
          TAGS = TAGS.filter(function (t) { return t !== "all"; });
          var i = TAGS.indexOf(v);
          if (i >= 0) TAGS.splice(i, 1); else TAGS.push(v);
          if (!TAGS.length) TAGS = ["all"];
        }
        renderPanel(); renderSummary(); renderBody();
      };
    });

    var moveBox = $("#rk-g-move");
    if (moveBox) Array.prototype.forEach.call(moveBox.querySelectorAll("[data-move]"), function (b) {
      b.onclick = function () {
        MOVE = b.getAttribute("data-move");
        if (MOVE === "off") MOVE_SCOPE = "all";
        renderPanel(); renderSummary(); renderBody();
      };
    });

    var scopeBox = $("#rk-g-scope");
    if (scopeBox) Array.prototype.forEach.call(scopeBox.querySelectorAll("[data-scope]"), function (b) {
      b.onclick = function () {
        MOVE_SCOPE = b.getAttribute("data-scope");
        renderPanel(); renderSummary(); renderBody();
      };
    });

    var sortBox = $("#rk-g-sort");
    if (sortBox) Array.prototype.forEach.call(sortBox.querySelectorAll("[data-sort]"), function (b) {
      b.onclick = function () {
        SORT = b.getAttribute("data-sort");
        renderPanel(); renderSummary(); renderBody();
      };
    });

    var sizeBox = $("#rk-g-size");
    if (sizeBox) Array.prototype.forEach.call(sizeBox.querySelectorAll("[data-size]"), function (b) {
      b.onclick = function () {
        SIZE = b.getAttribute("data-size");
        renderPanel(); renderBody();
      };
    });
  }

  /* ---------------- 摘要条 ---------------- */
  function tagLabel() {
    if (!TAGS.length || TAGS.indexOf("all") >= 0) return "全部";
    var map = { surge: "周度激增", hot: "趋势爆款", opportunity: "潜力机会" };
    return TAGS.map(function (t) { return map[t] || t; }).join(" / ");
  }

  function renderSummary() {
    var el = $("#rk-summary");
    if (!el) return;
    var sites = activeSites();
    var periods = activePeriods();
    var parts = [];
    parts.push(CAT || ALL);
    parts.push(periods.length ? periods.join("、") : "未选周次");
    var _g = activeGroup();
    parts.push(_g ? ("地区 " + _g.name) : (sites.length ? sites.join(" / ") : "未选国家"));
    parts.push(tagLabel());
    if (MODE === "v" && MOVE !== "off") parts.push(moveLabel());
    el.textContent = parts.join(" · ");
  }

  function moveLabel() {
    var base = (MOVE === "move") ? "位次上升最多优先" : "新上榜优先";
    if (MOVE_SCOPE === "all") return base + "（全部期次）";
    return base + "（仅 " + MOVE_SCOPE + "）";
  }

  function renderBar() {
    var el = $("#rk-bar");
    if (!el) return;
    var sites = sitesForQuery();
    var periods = activePeriods();
    var total = (CACHE && CACHE.items) ? CACHE.items.length : 0;
    var shown = total ? Math.min(CAP, total) : 0;
    var h = '<div class="rk-modes">' +
      '<button type="button" class="rk-mode-btn' + (MODE === "h" ? " on" : "") + '" data-mode="h">横向 · 国家对比（多国 × 单周）</button>' +
      '<button type="button" class="rk-mode-btn' + (MODE === "v" ? " on" : "") + '" data-mode="v">纵向 · 时间对比（单国 × 多周）</button>' +
      '</div>';
    h += '<div class="rk-bar-info">';
    if (!sites.length || !periods.length) h += '请选择国家站点与周次';
    else h += '共 <b>' + total + '</b> 张 · 每列最多展示 <b>' + shown + '</b> 张';
    h += '</div>';
    el.innerHTML = h;
    Array.prototype.forEach.call(el.querySelectorAll("[data-mode]"), function (b) {
      b.onclick = function () {
        var m = b.getAttribute("data-mode");
        if (m === MODE) return;
        MODE = m;
                CACHE = null; CAP = CAP_STEP;
        renderPanel(); renderSummary(); renderBar(); load();
      };
    });
  }

  /* ---------------- 卡片 ---------------- */
  function cardHtml(it, opt) {
    opt = opt || {};
    var b = badgeOf(it);
    var share = (opt.share && opt.share.length >= 2) ? opt.share : null;
    var title = [it.site, it.period_label, it.leaf_category, b ? b.txt : ""].filter(Boolean).join(" · ");
    var h = '<figure class="rk-card' + (opt.isNew ? " is-new" : "") + '" data-url="' + esc(it.image_url) + '" title="' + esc(title) + '">';
    h += '<img loading="lazy" src="' + esc(it.image_url) + '" alt="' + esc(it.leaf_category || "榜单图片") + '">';
    if (b) h += '<span class="rk-badge ' + b.cls + '">' + esc(b.txt) + '</span>';
    if (share) h += '<span class="rk-share" title="与 ' + esc(share.join("、")) + ' 相同">共 ' + share.length + ' 国</span>';
    if (opt.move) h += '<span class="rk-move">' + esc(opt.move) + '</span>';
    h += '</figure>';
    return h;
  }

  function poolHtml(name, meta, n, cardsHtml, shownN) {
    var h = '<section class="rk-pool">';
    h += '<div class="rk-pool-head">' +
      '<div class="rk-pool-name"><span>' + esc(name) + '</span><span class="rk-n">' + n + ' 张</span></div>' +
      (meta ? '<div class="rk-pool-meta">' + esc(meta) + '</div>' : "") +
      '</div>';
    h += '<div class="rk-pool-grid sz-' + SIZE + '">' + (cardsHtml || '<div class="rk-empty">该列暂无数据</div>') + '</div>';
    if (shownN != null) h += '<div class="rk-pool-foot">已展示 ' + shownN + ' / ' + n + '</div>';
    h += '</section>';
    return h;
  }

  /* ---------------- 主体：多列对比池 ---------------- */
  function renderBody() {
    var box = $("#rk-body");
    if (!box) return;
    var sites = poolSites();
    var periods = activePeriods();

    if (!FACETS.periods.length) {
      box.innerHTML = '<div class="rk-empty">后台还没有上传榜单数据。上传后这里会按「类目 + 周次 + 国家」自动生成对比池。</div>';
      return;
    }
    if (!CAT) { box.innerHTML = '<div class="rk-empty">请先在左侧选择一个类目</div>'; return; }
    var _gchk = activeGroup();
    if (_gchk && !_gchk.members.length) { box.innerHTML = '<div class="rk-empty">地区「' + esc(_gchk.name) + '」还没有勾选国家。到后台「趋势上升榜 → 地区分组」点 ☑ 把国家勾进去即可。</div>'; return; }
    if (!sites.length) { box.innerHTML = '<div class="rk-empty">请在上方筛选中选择「国家站点」或「地区」</div>'; return; }
    if (!periods.length) { box.innerHTML = '<div class="rk-empty">请在上方筛选中选择周次 / 期次</div>'; return; }
    if (!CACHE || !CACHE.items.length) { box.innerHTML = '<div class="rk-empty">该组合下暂无榜单数据</div>'; return; }

    var all = CACHE.items.filter(hitTags);
    if (!all.length) { box.innerHTML = '<div class="rk-empty">当前标签下没有匹配的图片，试试切换「趋势标签」。</div>'; return; }

    var html = '<div class="rk-pools" id="rk-pools">';
    var maxLen = 0;

    /* ===== 横向 · 国家对比：每国一列 ===== */
    if (MODE === "h") {
      var bySite = {};
      sites.forEach(function (s) { bySite[s] = []; });
      var urlSites = {};
      all.forEach(function (it) {
        if (bySite[it.site]) bySite[it.site].push(it);
        if (sites.indexOf(it.site) >= 0) {
          if (!urlSites[it.image_url]) urlSites[it.image_url] = [];
          if (urlSites[it.image_url].indexOf(it.site) < 0) urlSites[it.image_url].push(it.site);
        }
      });

      sites.forEach(function (s) {
        var mine = bySite[s] || [];
        var others = sites.filter(function (x) { return x !== s; });
        var over = 0;
        if (others.length) {
          var union = {};
          others.forEach(function (o) { (bySite[o] || []).forEach(function (i) { union[i.image_url] = 1; }); });
          var seen = {};
          mine.forEach(function (i) { if (union[i.image_url] && !seen[i.image_url]) { seen[i.image_url] = 1; over++; } });
        }
        var total = mine.length;
        var rate = total ? Math.round(over / total * 100) : 0;
        var _gp = activeGroup();
        var meta = others.length
          ? ("与 " + (others.length <= 2 ? others.join("、") : ("另 " + others.length + " 国")) + " 重合 " + over + " 张 · 重合度 " + rate + "%")
          : (_gp ? ("地区合并 · 含 " + _gp.members.length + " 国，同名商品只保留一条") : "单国视图");
        var list = sortItems(mine);
        if (list.length > maxLen) maxLen = list.length;
        var cards = list.slice(0, CAP).map(function (it) { return cardHtml(it, { share: urlSites[it.image_url] }); }).join("");
        html += poolHtml(s, meta, total, cards, Math.min(CAP, total));
      });
    } else {
      /* ===== 纵向 · 时间对比：每期一列 ===== */
      var site = sites[0];
      var basePeriods = withBasePeriods(periods);
      var byPeriod = {};
      basePeriods.forEach(function (p) { byPeriod[p] = []; });
      all.forEach(function (it) { if (byPeriod[it.period_label]) byPeriod[it.period_label].push(it); });

      var hasOf = {}, rankOf = {};
      basePeriods.forEach(function (p) {
        var lst = sortItems(byPeriod[p] || []);
        var hs = {}, m = {};
        lst.forEach(function (i) { hs[i.image_url] = 1; });
        lst.filter(function (i) { return i.ratio != null; }).forEach(function (i, idx) { m[i.image_url] = idx + 1; });
        hasOf[p] = hs; rankOf[p] = m;
      });

      periods.forEach(function (p) {
        var prev = prevOfPeriod(p);
        var list = sortItems(byPeriod[p] || []);
        /* 位次排序：与该列的「上一周」比较 —— 新上榜置顶 / 上升位次最多的排前面。
           排序用的位次与卡片上「上升 N 位」标签同源（同一套 rankOf），保证显示与顺序一致。 */
        if (MOVE !== "off" && (MOVE_SCOPE === "all" || MOVE_SCOPE === p) && prev) {
          var keyed = list.map(function (it, i) {
            var isNew = !hasOf[prev][it.image_url];
            var d = 0;
            if (!isNew) {
              var pr = rankOf[prev][it.image_url];
              var cr = rankOf[p][it.image_url];
              if (pr != null && cr != null) d = pr - cr;
            }
            /* 「新上榜优先」：新上榜的排最前；
               「位次上升最多」：只按上升位次排（新上榜无位次可比，沉到末尾），
               两种模式结果明显区分。 */
            var key = (MOVE === "new") ? (isNew ? 1e9 : 0) : (isNew ? -1e9 : d);
            return { it: it, i: i, key: key };
          });
          keyed.sort(function (a, b) { return (b.key - a.key) || (a.i - b.i); });
          list = keyed.map(function (o) { return o.it; });
        }
        if (list.length > maxLen) maxLen = list.length;
        var newCnt = 0;
        if (prev) list.forEach(function (i) { if (!hasOf[prev][i.image_url]) newCnt++; });
        var meta = site + (prev ? (" · 较上一周（" + prev + "）新上榜 " + newCnt + " 张") : " · 首期（无上一周）");
        var cards = list.slice(0, CAP).map(function (it) {
          var move = "", isNew = false;
          if (prev) {
            if (!hasOf[prev][it.image_url]) { move = "新上榜"; isNew = true; }
            else {
              var pr = rankOf[prev][it.image_url];
              var cr = rankOf[p][it.image_url];
              if (pr != null && cr != null) {
                var diff = pr - cr;
                if (diff > 0) move = "上升 " + diff + " 位";
                else if (diff < 0) move = "下降 " + (-diff) + " 位";
              }
            }
          }
          return cardHtml(it, { move: move, isNew: isNew });
        }).join("");
        html += poolHtml(p, meta, list.length, cards, Math.min(CAP, list.length));
      });
    }
    html += '</div>';

    if (maxLen > CAP) {
      html += '<div class="rk-more-wrap"><button type="button" class="rk-loadmore" id="rk-loadmore">展开更多（已展示 ' + CAP + ' / 最多 ' + maxLen + '）</button></div>';
    }
    box.innerHTML = html;

    var more = $("#rk-loadmore");
    if (more) more.onclick = function () {
      CAP = Math.min(CAP_MAX, CAP + CAP_STEP);
      renderBody(); renderBar();
    };

    // 卡片点击 → 灯箱
    Array.prototype.forEach.call(box.querySelectorAll(".rk-card"), function (el) {
      el.onclick = function () { openLB(el.getAttribute("data-url")); };
    });
  }

  /* ---------------- 灯箱（仅看图 + 归属信息，不显示任何环比数值） ---------------- */
  function openLB(url) {
    if (!url) return;
    var it = ITEMS_BY_URL[url] || {};
    var b = badgeOf(it);
    var old = $("#rk-lb");
    if (old) old.parentNode.removeChild(old);
    var d = document.createElement("div");
    d.id = "rk-lb";
    d.className = "rk-lb";
    var bits = [];
    if (it.site) bits.push('<span class="rk-lb-tag">' + esc(it.site) + '</span>');
    if (it.period_label) bits.push('<span class="rk-lb-tag">' + esc(it.period_label) + '</span>');
    if (it.leaf_category) bits.push('<span class="rk-lb-tag">' + esc(it.leaf_category) + '</span>');
    if (b) bits.push('<span class="rk-lb-tag">' + esc(b.txt) + '</span>');
    d.innerHTML = '<button type="button" class="rk-lb-close" id="rk-lb-close">×</button>' +
      '<img src="' + esc(url) + '" alt="榜单图片">' +
      '<div class="rk-lb-meta">' + bits.join("") + '</div>';
    document.body.appendChild(d);
    d.onclick = function (e) { if (e.target === d || e.target.id === "rk-lb-close") closeLB(); };
    document.addEventListener("keydown", lbEsc);
  }
  function lbEsc(e) { if (e.key === "Escape") closeLB(); }
  function closeLB() {
    var d = $("#rk-lb");
    if (d) d.parentNode.removeChild(d);
    document.removeEventListener("keydown", lbEsc);
  }

  /* ---------------- 加载 ---------------- */
  async function load() {
    var box = $("#rk-body");
    var sites = sitesForQuery();
    var periods = activePeriods();
    if (!sites.length || !periods.length) { renderBody(); renderBar(); return; }
    if (box) box.innerHTML = '<div class="rk-empty">加载中…</div>';
    await fetchItems();
    renderBody();
    renderBar();
  }

  /* ---------------- 登录态（顶部显示 + 退出） ---------------- */
  async function renderAuth() {
    var email = "", ok = false;
    try {
      var s = await SBX.getSession();
      if (s && s.user) { email = s.user.email || ""; ok = true; }
    } catch (e) { /* 忽略 */ }
    var u = $("#rk-user"), lo = $("#rk-logout"), li = $("#rk-login");
    if (u) { u.textContent = email; u.classList.toggle("hidden", !ok); }
    if (lo) {
      lo.classList.toggle("hidden", !ok);
      lo.onclick = async function () {
        try { await SBX.signOut(); } catch (e) { /* 忽略 */ }
        location.href = "index.html";
      };
    }
    if (li) li.classList.toggle("hidden", ok);
    return ok;
  }

  /* ---------------- 无权限时的说明面板 ---------------- */
  function renderGate(box, why) {
    if ($("#rk-groups")) $("#rk-groups").innerHTML = '<div class="rk-note">当前账号不可访问该专区</div>';
    if ($("#rk-cats")) $("#rk-cats").innerHTML = '<div class="rk-empty">—</div>';
    if ($("#rk-bar")) $("#rk-bar").innerHTML = "";
    if ($("#rk-summary")) $("#rk-summary").textContent = "";
    if (!box) return;
    box.innerHTML = ''
      + '<div class="rk-gate">'
      +   '<div class="rk-gate-ico">🔒</div>'
      +   '<div class="rk-gate-title">暂无法查看「趋势上升榜」</div>'
      +   '<div class="rk-gate-why">' + String(why || "当前账号不可访问该专区").replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }) + '</div>'
      +   '<div class="rk-gate-tip">'
      +     '<div class="rk-gate-h">怎么解决</div>'
      +     '<div class="rk-gate-steps">'
      +       '① 请联系超级管理员，在后台 <b>权限管理 → 该用户「编辑」</b> 中勾选「<b>趋势上升榜</b>」并保存；<br>'
      +       '② 若为全站开关问题，请在后台 <b>超管权限 → 前台访问设置 → 顶部菜单项·前台可见</b> 中将「趋势上升榜」设为「展示」；<br>'
      +       '③ 改完后回到本页强制刷新（Ctrl+F5）即可。'
      +     '</div>'
      +   '</div>'
      +   '<div class="rk-gate-btns">'
      +     '<a class="rk-gate-btn ghost" href="index.html">返回视觉专区</a>'
      +     '<button class="rk-gate-btn" id="rk-gate-out" type="button">退出登录</button>'
      +   '</div>'
      + '</div>';
    var out = $("#rk-gate-out");
    if (out) out.onclick = async function () {
      try { await SBX.signOut(); } catch (e) { /* 忽略 */ }
      location.href = "index.html";
    };
  }

  /* ---------------- 初始化 ---------------- */
  async function boot() {
    var box = $("#rk-body");
    if (!SBX) {
      if (box) box.innerHTML = '<div class="rk-empty">数据服务未就绪，请刷新页面重试。</div>';
      return;
    }

    var logged = await renderAuth();

    // 专区可见性守门（两级）：①全站开关（后台「前台访问设置」） ②用户级白名单（后台「权限管理」勾选）
    var vis = null, myz = null;
    try { vis = await SBX.getFrontendZoneVisibility(); } catch (e) { /* 读取失败时照常展示 */ }
    try { myz = await SBX.myFrontendZones(); } catch (e) { myz = null; }
    if (window.Common && Common.zones) {
      Common.zones.setVis(vis || {});
      Common.zones.setMine(Array.isArray(myz) ? myz : null);
      Common.zones.renderNav();
    }
    var gateWhy = "";
    if (vis && vis.rank === false) {
      gateWhy = "全站开关：该专区已在后台「前台访问设置」中被关闭";
    } else if (logged && Array.isArray(myz) && myz.length && myz.indexOf("rank") === -1) {
      gateWhy = "账号授权：你的账号未获授权访问本专区";
    }
    if (gateWhy) {
      renderGate(box, gateWhy);
      return;
    }

    try { FACETS = await SBX.rankFacets(); } catch (e) { FACETS = { sites: [], periods: [], categories: [] }; }
    FACETS.sites = FACETS.sites || [];
    FACETS.periods = sortPeriods(FACETS.periods || []);
    FACETS.categories = FACETS.categories || [];

    /* 国家站点（地区）以后台「站点管理」里我自定义的清单为准。
       表格里自带的一堆国名（如欧盟合计表里写满各国）不作为前台筛选项。
       若后台一个站点都没定义，才退回按数据里出现过的站点展示（避免筛选项为空）。 */
    var _dataSites = FACETS.sites.slice();
    var _defined = [];
    try {
      var _raw = await SBX.listRankSites();
      _defined = (_raw || []).map(function (s) { return s && s.name; }).filter(function (v) { return v && String(v).trim(); });
    } catch (e) { _defined = []; }
    if (_defined.length) FACETS.sites = _defined.slice();

    // 默认选择：类目取第一个（否则「全部」）、周次取最新、国家取前 2~3 个
    CAT = FACETS.categories.length ? FACETS.categories[0] : ALL;
    var _sp = sortPeriods(FACETS.periods);
    SEL_PERIODS = _sp.slice(Math.max(0, _sp.length - 4));
    // 有数据的站点优先进入默认选中，其余按定义顺序补齐
    var _withData = FACETS.sites.filter(function (s) { return _dataSites.indexOf(s) >= 0; });
    var _rest = FACETS.sites.filter(function (s) { return _dataSites.indexOf(s) < 0; });
    SEL_SITES = _withData.concat(_rest).slice(0, Math.min(4, FACETS.sites.length));

    try { GROUPS = await SBX.getRankGroups(); } catch (e) { GROUPS = []; }
    GROUPS = (GROUPS || []).filter(function (g) { return g && g.name; });

    // URL 参数（后台实时预览 / 分享链接）：mode / size / cat / sites / periods / group
    try {
      var _qs = new URLSearchParams(location.search);
      var _m = _qs.get("mode"); if (_m === "h" || _m === "v") MODE = _m;
      var _z = _qs.get("size"); if (_z === "s" || _z === "m" || _z === "l") SIZE = _z;
      var _c = _qs.get("cat"); if (_c) CAT = _c;
      var _ss = (_qs.get("sites") || "").split(",").filter(function (v) { return v.trim(); });
      if (_ss.length) SEL_SITES = _ss;
      var _g = _qs.get("group");
      if (_g && GROUPS.some(function (x) { return x.name === _g; })) SEL_GROUP = _g;
      var _pp = (_qs.get("periods") || "").split(",").filter(function (v) { return v.trim(); });
      if (_pp.length) { SEL_PERIODS = _pp; if (MODE === "h") MODE = "v"; }
    } catch (e) { /* 无参数时忽略 */ }

    renderCats();
    renderPanel();
    renderSummary();
    renderBar();
    bindTrigger();

    // 「生成报告」（PDF / PPT）：只有超级管理员会看到按钮；封装在 report.js 里，失败不影响榜单页
    if (window.ReportKit) {
      try {
        window.ReportKit.init({
          btn: "#rk-report-btn",
          isSuper: isSuperAdmin,
          state: reportState,
          itemOf: function (url) { return ITEMS_BY_URL[url] || null; },
          poolsEl: function () { return document.querySelector("#rk-pools"); },
          expandAll: expandAllForReport
        });
      } catch (e) { /* 报告功能不可用时不阻塞页面 */ }
    }

    await load();

    // 未登录 / 无数据时的兜底提示
    if (!CACHE || !CACHE.items.length) {
      var s2 = null;
      try { s2 = await SBX.getSession(); } catch (e) { /* 忽略 */ }
      if (!s2 && box) {
        box.innerHTML = '<div class="rk-empty">暂无可查看的数据：本页需要登录后查看，请先到<a href="index.html">视觉专区</a>登录。</div>';
      }
    } else if (!logged && box && !CACHE.items.length) {
      if (box) box.innerHTML = '<div class="rk-empty">暂无可查看的数据。</div>';
    }
  }

  /* ---------------- 生成报告（PDF / PPT）用的桥接 ----------------
   * 报表内容直接取自屏幕上正在渲染的对比池（DOM），
   * 因此「网页什么样、导出就什么样」，不会出现两套口径。 */
  async function isSuperAdmin() {
    try {
      if (!SBX || !SBX.myRole) return false;
      return (await SBX.myRole()) === "super_admin";
    } catch (e) { return false; }
  }

  function reportState() {
    var items = (CACHE && CACHE.items) ? CACHE.items.filter(hitTags) : [];
    var sizeMap = { s: "小图", m: "中图", l: "大图" };
    return {
      zone: "趋势上升榜",
      cat: CAT || ALL,
      modeLabel: MODE === "h" ? "横向 · 国家对比（多国 × 单周）" : "纵向 · 时间对比（单国 × 多周）",
      sites: poolSites(),
      group: activeGroup() ? activeGroup().name : "",
      periods: activePeriods(),
      tags: tagLabel(),
      sizeLabel: sizeMap[SIZE] || "",
      total: items.length
    };
  }

  /* 「每列全部条目」：把每列展开到上限，并等图片加载完再交给报告模块 */
  async function expandAllForReport() {
    if (CAP < CAP_MAX) { CAP = CAP_MAX; renderBody(); renderBar(); }
    var box = document.querySelector("#rk-pools");
    if (box && window.ReportKit && window.ReportKit._ && window.ReportKit._.waitImages) {
      await window.ReportKit._.waitImages(box, 15000);
    }
  }

  // 筛选条：除悬停展开外，点击也可锁定展开（触屏 / 不习惯悬停时）
  function bindTrigger() {
    var t = $("#rk-trigger");
    if (!t) return;
    t.onclick = function () {
      var f = $("#rk-filter");
      if (f) f.classList.toggle("open");
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();