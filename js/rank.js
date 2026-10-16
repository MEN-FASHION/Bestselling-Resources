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
  var MODE = "v";            // 默认「纵向 · 时间对比」；h=横向·国家对比 / v=纵向·时间对比
  var CAT = ALL;
  var SEL_SITES = [];        // h：多选；v：仅第一个生效
  var SEL_PERIODS = [];      // h：仅第一个生效；v：多选
  var COLS = 3;              // 对比列数：纵向=最近几周、横向=前几个国家，可选 2/3/4（默认 3 = 美国近三周对比）
  var COLS_OPTS = [2, 3, 4];
  var COLS_MAX = 4;          // 列数硬上限（再多就看不清了）
  var DEFAULT_CAT = "卫衣";   // 默认进入时优先选中的类目
  var DEFAULT_SITE = "美国";  // 默认进入时优先选中的站点
  var SITE_ORDER = [];       // 站点顺序：有数据的优先，其余按后台定义顺序
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
  /* ---------------- 默认口径与「对比列数」 ---------------- */
  /* 命中优先（默认类目「卫衣」/ 默认站点「美国」），命中不到退回兜底值 */
  function pickDefault(list, want, fallback) {
    list = list || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i]).indexOf(want) >= 0) return list[i];
    }
    return fallback;
  }

  function orderedSites() {
    return (SITE_ORDER && SITE_ORDER.length) ? SITE_ORDER : (FACETS.sites || []);
  }

  /* 按「对比列数」重排选择：纵向=最近 N 周（保留当前站点）；横向=前 N 个国家（保留最新一周） */
  function applyCols() {
    var n = Math.max(2, Math.min(COLS_MAX, COLS));
    if (MODE === "v") {
      var sp = sortPeriods(FACETS.periods);
      SEL_PERIODS = sp.slice(Math.max(0, sp.length - n));
      var all = orderedSites();
      var keep = SEL_SITES[0] || "";
      var one = (keep && all.indexOf(keep) >= 0) ? keep : (all[0] || "");
      SEL_SITES = one ? [one] : [];
    } else {
      var all2 = orderedSites();
      var kept = SEL_SITES.filter(function (x) { return all2.indexOf(x) >= 0; });
      var pick = kept.slice(0, n);
      /* 补足到 N 个国家：只留下已选的会变成「1 列」，横向对比就没意义了 */
      for (var q = 0; q < all2.length && pick.length < n; q++) {
        if (pick.indexOf(all2[q]) < 0) pick.push(all2[q]);
      }
      SEL_SITES = pick;
      var sp2 = sortPeriods(FACETS.periods);
      SEL_PERIODS = sp2.length ? [sp2[sp2.length - 1]] : [];
    }
    CACHE = null; CAP = CAP_STEP;
  }

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

    /* 对比列数：纵向=对比几周、横向=对比几国，点一下就按这个列数重排 */
    var colsHtml = COLS_OPTS.map(function (n) { return chip(String(n), n + " 列", COLS === n, "data-cols"); }).join("");
    var colsLabel = (MODE === "v" ? "对比列数（周）" : "对比列数（国家）");

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
      '<div class="tag-group"><span class="tag-group-name">' + colsLabel + '</span><div class="tag-chips" id="rk-g-cols">' + colsHtml + '</div></div>' +
      groupHtml +
      '<div class="tag-group"><span class="tag-group-name">国家站点' + (SEL_GROUP ? "（已按地区合并，点上方「取消地区」可单选国家）" : (MODE === "v" ? "（单选）" : "（可多选）")) + '</span><div class="tag-chips" id="rk-g-sites">' + sitesHtml + '</div></div>' +
      '<div class="tag-group"><span class="tag-group-name">周次 / 期次' + (MODE === "h" ? "（单选）" : "（可多选，最多 " + COLS_MAX + " 个）") + '</span><div class="tag-chips" id="rk-g-periods">' + periodsHtml + '</div></div>' +
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
        applyCols();                       /* 切换模式后按「对比列数」重排站点 / 期次 */
        renderPanel(); renderSummary(); renderBar(); load();
      };
    });

    var colsBox = $("#rk-g-cols");
    if (colsBox) Array.prototype.forEach.call(colsBox.querySelectorAll("[data-cols]"), function (b) {
      b.onclick = function () {
        var n = parseInt(b.getAttribute("data-cols"), 10);
        if (!n || n === COLS) return;
        COLS = n;
        applyCols();
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
          if (i >= 0) SEL_SITES.splice(i, 1);
          else {
            if (SEL_SITES.length >= COLS_MAX) { toast("最多同时对比 " + COLS_MAX + " 个国家，可先取消一个"); return; }
            SEL_SITES.push(v);
          }
          COLS = Math.max(2, Math.min(COLS_MAX, SEL_SITES.length));   /* 手选后列数跟着走 */
        }
        if (!SEL_SITES.length) SEL_SITES = orderedSites().slice(0, COLS);   /* 全取消时回落到前几个，避免空页 */
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
          if (i >= 0) SEL_PERIODS.splice(i, 1);
          else {
            if (SEL_PERIODS.length >= COLS_MAX) { toast("最多同时对比 " + COLS_MAX + " 列，可先取消一个期次"); return; }
            SEL_PERIODS.push(v);
          }
          COLS = Math.max(2, Math.min(COLS_MAX, SEL_PERIODS.length));   /* 手选后列数跟着走 */
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
    var cols = (MODE === "v" ? periods.length : sites.length);
    h += '<button type="button" class="rk-eye-btn" id="rk-eye-btn" title="一次看到所有对比列的全部图片">天眼 · 查看全部对比图</button>';
    h += '<div class="rk-bar-info">';
    if (!sites.length || !periods.length) h += '请选择国家站点与周次';
    else h += '共 <b>' + total + '</b> 张 · <b>' + cols + '</b> 列 · 每列最多展示 <b>' + shown + '</b> 张';
    h += '</div>';
    el.innerHTML = h;
    var eye = $("#rk-eye-btn");
    if (eye) eye.onclick = openEye;
    Array.prototype.forEach.call(el.querySelectorAll("[data-mode]"), function (b) {
      b.onclick = function () {
        var m = b.getAttribute("data-mode");
        if (m === MODE) return;
        MODE = m;
        applyCols();                       /* 切换模式后按「对比列数」重排站点 / 期次 */
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
    /* 天眼要求「一次全加载、不用下滑」：这些图都在首屏内，直接加载；其余场景保持懒加载省流量 */
    h += '<img' + (opt.eager ? '' : ' loading="lazy"') + ' src="' + esc(it.image_url) + '" alt="' + esc(it.leaf_category || "榜单图片") + '"' +
      (opt.eager ? ' decoding="async"' : '') + '>';
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
  /* 组装多列对比池 HTML（只出列，不含外层容器）。
     limit = 每列最多渲染多少张；天眼传 Infinity，一次把该列全部图片都出出来。 */
  function buildPools(limit, opts) {
    opts = opts || {};
    var sites = opts.sites || poolSites();
    var periods = opts.periods || activePeriods();
    var src = opts.items || (CACHE && CACHE.items) || [];
    var all = src.filter(hitTags);
    var html = "", maxLen = 0;

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
        var cards = list.slice(0, limit).map(function (it) { return cardHtml(it, { share: urlSites[it.image_url], eager: opts.eager }); }).join("");
        html += poolHtml(s, meta, total, cards, opts.noFoot ? null : Math.min(limit, total));
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
        var cards = list.slice(0, limit).map(function (it) {
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
          return cardHtml(it, { move: move, isNew: isNew, eager: opts.eager });
        }).join("");
        html += poolHtml(p, meta, list.length, cards, opts.noFoot ? null : Math.min(limit, list.length));
      });
    }
    return { html: html, maxLen: maxLen };
  }

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

    var R = buildPools(CAP);
    var html = '<div class="rk-pools" id="rk-pools">' + R.html + '</div>';
    var maxLen = R.maxLen;

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

  /* ---------------- 天眼：一屏铺满「每一列的全部图」 ---------------- */
  /* 需求口径：打开天眼 → 每一列（每个国家 / 每个期次）的【全部图片】都在，
     不受「每列最多展示 N 张」限制、不需要点「加载更多」；图片全部直接加载（不懒加载）、
     比例自适应、尽量铺满一屏——一眼就能看全，不用下滑。
     列范围可切换：默认=当前对比列（2/3/4 列），另可切「全部站点 × 全部期次」。 */
  var EYE_ALL = false;        /* 列范围：false=当前对比列，true=全部站点×全部期次 */
  var EYE_EAGER_MAX = 1500;   /* 图数超过此上限才退回懒加载，避免一次拉爆（默认全加载） */
  var EYE_R_MAX = 60;         /* 每行最多排几张（真正的下限由「最小卡片宽度」兜住） */
  var EYE_MIN_CARD = 20;      /* 卡片最小宽度（px）：低于这个就看不清了 */
  var eyeFitBound = null;

  /* 天眼要铺开的列范围 */
  function eyeScope() {
    if (!EYE_ALL) return { sites: poolSites(), periods: activePeriods() };
    if (MODE === "h") return { sites: orderedSites(), periods: sortPeriods(FACETS.periods).slice(-1) };
    return { sites: sitesForQuery(), periods: sortPeriods(FACETS.periods) };
  }

  /* 天眼自己的取数（独立于页面缓存口径；纵向仍需取「上一期」做基线） */
  async function eyeFetch(sc) {
    var sites = sc.sites || [], periods = sc.periods || [];
    if (!sites.length || !periods.length) return { items: [], sites: sites, periods: periods };
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
    flagPools(items);
    /* 补进「图 → 归属信息」索引，天眼里点开大图也能看到站点/期次/标签 */
    items.forEach(function (it) { if (it.image_url && !ITEMS_BY_URL[it.image_url]) ITEMS_BY_URL[it.image_url] = it; });
    return { items: items, sites: sites, periods: periods };
  }

  /* 纯计算：按可用宽高反推「每行几张 + 卡片多宽」，让每列全部图都落在首屏内
     （图实在太多、压到最小尺寸仍放不下时，clipped=true 表示允许下滑看剩余部分） */
  function eyeFitCalc(availW, availH, K, maxN, opt) {
    opt = opt || {};
    var gap = opt.gap == null ? 4 : opt.gap;
    var vgap = opt.vgap == null ? 4 : opt.vgap;
    var headH = opt.headH == null ? 46 : opt.headH;
    var minW = opt.minW == null ? EYE_MIN_CARD : opt.minW;
    var rMax = opt.rMax == null ? EYE_R_MAX : opt.rMax;
    K = Math.max(1, K || 1);
    var colW = (availW - gap * (K - 1)) / K;
    if (!(colW > 0) || !(availH > 0) || !(maxN > 0)) {
      return { r: 1, cardW: Math.max(minW, colW > 0 ? colW : minW), clipped: true };
    }
    /* 从「每行最少的张数」开始试：第一个能把该列全部图塞进可用高度的方案，
       就是卡片最大的方案 —— 一屏放得下，且图尽量大、看得清。 */
    var best = 0, bestW = 0;
    for (var r = 1; r <= rMax; r++) {
      var cardW = (colW - gap * (r - 1)) / r;
      if (cardW < minW) break;                       /* 再密就低于最小可读宽度了 */
      var rows = Math.ceil(maxN / r);
      var needH = headH + rows * (cardW * 4 / 3 + vgap);
      if (needH <= availH) { best = r; bestW = cardW; break; }
    }
    if (best) return { r: best, cardW: bestW, clipped: false };
    for (var r2 = rMax; r2 >= 1; r2--) {
      var cw = (colW - gap * (r2 - 1)) / r2;
      if (cw >= minW) return { r: r2, cardW: cw, clipped: true };
    }
    return { r: 1, cardW: colW > 0 ? colW : minW, clipped: true };
  }

  /* 把算出来的「每行几张 / 卡片宽 / 字号」落到样式变量上，并决定是否还需要下滑 */
  function fitEye(panel) {
    var body = panel.querySelector("#rk-eye-body") || panel.querySelector(".rk-eye-body");
    var pools = body ? body.querySelector(".rk-pools") : null;
    if (!body || !pools) return;
    var cols = pools.querySelectorAll(".rk-pool");
    var K = cols.length || 1;
    var maxN = 0;
    Array.prototype.forEach.call(cols, function (c) {
      var n = c.querySelectorAll(".rk-card").length;
      if (n > maxN) maxN = n;
    });
    if (!maxN) return;
    var headH = 46;
    var hd = cols[0] ? cols[0].querySelector(".rk-pool-head") : null;
    if (hd && hd.offsetHeight) headH = hd.offsetHeight + 6;
    var fit = eyeFitCalc(pools.clientWidth || body.clientWidth, body.clientHeight, K, maxN, { headH: headH });
    pools.style.setProperty("--eye-r", String(fit.r));
    pools.style.setProperty("--eye-card", fit.cardW.toFixed(1) + "px");
    pools.style.setProperty("--eye-fs", Math.max(7, Math.min(12, fit.cardW * 0.22)).toFixed(1) + "px");
    body.style.overflowY = fit.clipped ? "auto" : "hidden";
    panel.setAttribute("data-eye-clip", fit.clipped ? "1" : "0");
    var note = panel.querySelector("#rk-eye-clip");
    if (note) note.style.display = fit.clipped ? "" : "none";
  }

  function openEye() {
    var old = $("#rk-eye");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var d = document.createElement("div");
    d.id = "rk-eye";
    d.className = "rk-eye";
    d.innerHTML = '<div class="rk-eye-mask" id="rk-eye-mask"></div>' +
      '<div class="rk-eye-panel">' +
        '<div class="rk-eye-head">' +
          '<div class="rk-eye-title">天眼 · 全部对比图</div>' +
          '<div class="rk-eye-sub" id="rk-eye-sub">加载中…</div>' +
          '<button type="button" class="rk-eye-scope" id="rk-eye-scope"></button>' +
          '<button type="button" class="rk-eye-close" id="rk-eye-close" title="关闭（Esc）">×</button>' +
        '</div>' +
        '<div class="rk-eye-body" id="rk-eye-body"><div class="rk-empty">加载中…</div></div>' +
        '<div class="rk-eye-note" id="rk-eye-clip" style="display:none">图数较多，已按最小尺寸铺满；剩余部分可下滑查看</div>' +
      '</div>';
    document.body.appendChild(d);
    bindEye(d);
    fillEye(d);
  }

  function bindEye(d) {
    d.addEventListener("click", function (e) {
      var t = e.target;
      if (t && (t.id === "rk-eye-close" || t.id === "rk-eye-mask")) { closeEye(); return; }
      if (t && t.id === "rk-eye-scope") { EYE_ALL = !EYE_ALL; openEye(); return; }   /* 切换列范围 */
      var card = (t && t.closest) ? t.closest(".rk-card") : null;
      if (card) openLB(card.getAttribute("data-url"));
    });
    document.addEventListener("keydown", eyeEsc);
    eyeFitBound = function () { fitEye(d); };
    window.addEventListener("resize", eyeFitBound);      /* 窗口变化重新铺满 */
  }

  async function fillEye(d) {
    var body = d.querySelector("#rk-eye-body");
    var sub = d.querySelector("#rk-eye-sub");
    var scb = d.querySelector("#rk-eye-scope");
    if (scb) scb.textContent = EYE_ALL ? "范围：全部站点 × 全部期次" : "范围：当前对比列";
    var sc = eyeScope();
    var R = { items: [], sites: sc.sites, periods: sc.periods };
    try { R = await eyeFetch(sc); } catch (e) { R = { items: [], sites: sc.sites, periods: sc.periods }; }
    if (!d.parentNode) return;                            /* 取数期间被关掉就不画了 */
    var total = (R.items || []).length;
    var eager = total <= EYE_EAGER_MAX;                   /* 默认「全部加载」，只有极端量级才退回懒加载 */
    var built = buildPools(Infinity, { items: R.items, sites: sc.sites, periods: sc.periods, noFoot: true, eager: eager });
    var n = 0;
    if (built.html) {
      body.innerHTML = '<div class="rk-pools">' + built.html + '</div>';
      n = body.querySelectorAll(".rk-card").length;
    } else {
      body.innerHTML = '<div class="rk-empty">当前口径下没有可显示的图片</div>';
    }
    if (sub) {
      var colsN = (MODE === "v") ? sc.periods.length : sc.sites.length;
      var scopeTxt = (MODE === "v") ? (R.sites.join("、") || "—") : (R.periods.join("、") || "—");
      sub.innerHTML = esc(CAT) + ' · ' + esc(scopeTxt) + ' · <b>' + colsN + '</b> 列 · 共 <b>' + n + '</b> 张' +
        (eager ? '' : ' · <span class="rk-eye-warn">图数过多，已改为随滚动加载</span>');
    }
    if (n) fitEye(d);
  }

  function eyeEsc(e) {
    if (e.key !== "Escape") return;
    if ($("#rk-lb")) return;              /* 灯箱开着时，先交给灯箱自己的 Esc 处理 */
    closeEye();
  }

  function closeEye() {
    var d = $("#rk-eye");
    if (d && d.parentNode) d.parentNode.removeChild(d);
    document.removeEventListener("keydown", eyeEsc);
    if (eyeFitBound) { window.removeEventListener("resize", eyeFitBound); eyeFitBound = null; }
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
    try { sessionStorage.setItem("nl_landed", "1"); } catch (e) {}   // 已落地过：避免从榜单点回视觉专区又被弹回来
    if (logged && window.Common && Common.visit) Common.visit.track("rank");   // 访问统计（后台数据看板）

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

    // 站点顺序：有数据的优先，其余按后台定义顺序（横向按这个顺序取前 N 个）
    var _withData = FACETS.sites.filter(function (s) { return _dataSites.indexOf(s) >= 0; });
    var _rest = FACETS.sites.filter(function (s) { return _dataSites.indexOf(s) < 0; });
    SITE_ORDER = _withData.concat(_rest);

    // 默认进入口径：纵向 · 时间对比（已默认） + 美国站 + 卫衣；命中不到就退回「有数据的第一个」/ 全部类目
    CAT = pickDefault(FACETS.categories, DEFAULT_CAT, FACETS.categories.length ? FACETS.categories[0] : ALL);
    var _firstSite = pickDefault(SITE_ORDER, DEFAULT_SITE, SITE_ORDER[0] || "");
    SEL_SITES = _firstSite ? [_firstSite] : [];
    SEL_PERIODS = sortPeriods(FACETS.periods).slice(-COLS);

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

    /* 「对比列数」跟着当前实际列数走：分享链接 / 后台预览带参数时也能对上 */
    if (MODE === "v") COLS = Math.max(2, Math.min(COLS_MAX, SEL_PERIODS.length || COLS));
    else COLS = Math.max(2, Math.min(COLS_MAX, SEL_SITES.length || COLS));

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