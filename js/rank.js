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
  var HIDDEN = { sites: [], periods: [] };   // 后台控制前台显隐：这些国家站点 / 周次不在前台出现
  var SEL_GROUP = "";        // 选中的地区名；非空时按整个地区合并成一列，只能单选
  var TAGS = ["all"];        // all | surge | hot | opportunity
  var SORT = "ratio_desc";   // ratio_desc / ratio_asc / abs_desc / abs_asc
  var MOVE = "off";          // off | move（位次上升最多） | new（新上榜优先）——仅纵向·时间对比有效
  var MOVE_SCOPE = "all";
  var ONLY = "off";          /* 只看标签：off | up（位次上升）| new（新上榜）——仅纵向·时间对比有效 */
  var EXPORT_ITEMS = [];     /* 当前屏幕上这批图（含位次标签），供「导出 PPT」范围说明使用 */

  /* 某期某张图的位次标签（与卡片上「上升 N 位 / 下降 N 位 / 新上榜」同源）：
     排序、卡片标签、「只看标签」筛选三处共用同一套计算，
     保证"筛出来的东西"和"图上显示的东西"永远一致，不会各算各的。 */
  function moveOf(it, p, prev, hasOf, rankOf) {
    if (!prev) return { move: "", isNew: false, diff: 0 };
    if (!hasOf[prev] || !hasOf[prev][it.image_url]) return { move: "新上榜", isNew: true, diff: 0 };
    var pr = (rankOf[prev] || {})[it.image_url];
    var cr = (rankOf[p] || {})[it.image_url];
    if (pr != null && cr != null) {
      var d = pr - cr;
      if (d > 0) return { move: "上升 " + d + " 位", isNew: false, diff: d };
      if (d < 0) return { move: "下降 " + (-d) + " 位", isNew: false, diff: d };
    }
    return { move: "", isNew: false, diff: 0 };
  }
  function onlyLabel() {
    return ONLY === "up" ? "只看位次上升" : (ONLY === "new" ? "只看新上榜" : "");
  }
  /* 「只看标签」命中判定：与卡片标签文案同源 */
  function hitOnly(mv) {
    if (ONLY === "off") return true;
    var s = (mv && mv.move) || "";
    if (ONLY === "new") return s === "新上榜";
    return s.indexOf("上升") === 0;                 /* 位次上升（含「上升 N 位」） */
  }
  /* 导出图片 / PPT 时写进文件名与封面的范围文字 */
  function exportScope() {
    var parts = [CAT || "全部类目"];
    var _g = activeGroup();
    parts.push(_g ? ("地区 " + _g.name) : (sitesForQuery().join("/") || "未选国家"));
    parts.push(activePeriods().join("、") || "未选周次");
    if (MODE === "v" && ONLY !== "off") parts.push(onlyLabel());
    return parts.join(" · ");
  }

  /* 把当前屏幕上的对比池「定格」成一份绘制指令（供整页高清图使用）。
     采集顺序 = 底色/边框 → 图片 → 文字，与网页的视觉层次一致；
     位置取相对对比池容器的坐标，滚动到哪里都不影响结果。 */
  function snapshotOps() {
    var root = document.querySelector("#rk-pools");
    if (!root) return null;
    var r0 = root.getBoundingClientRect();
    var baseX = r0.left - (root.scrollLeft || 0);
    var baseY = r0.top - (root.scrollTop || 0);
    var boxes = [], imgs = [], texts = [];

    function rectOf(el) {
      var r = el.getBoundingClientRect();
      if (!(r.width >= 1) || !(r.height >= 1)) return null;
      return { x: Math.round(r.left - baseX), y: Math.round(r.top - baseY), w: Math.round(r.width), h: Math.round(r.height) };
    }
    function shown(el) {
      var cs = window.getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity || 1) > 0.05;
    }

    Array.prototype.forEach.call(root.querySelectorAll("*"), function (el) {
      if (!shown(el)) return;
      var tag = (el.tagName || "").toLowerCase();
      var rr = rectOf(el);
      if (!rr) return;
      if (tag === "img") {
        var src = el.getAttribute("src");
        if (src) imgs.push({ k: "img", x: rr.x, y: rr.y, w: rr.w, h: rr.h, url: src, radius: 8 });
        return;
      }
      var cs = window.getComputedStyle(el);
      var bg = cs.backgroundColor || "";
      var lw = parseFloat(cs.borderTopWidth) || 0;
      var hasBg = bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)";
      if (hasBg || lw > 0) {
        boxes.push({ k: "box", x: rr.x, y: rr.y, w: rr.w, h: rr.h,
          fill: hasBg ? bg : "", stroke: lw > 0 ? cs.borderTopColor : "", lw: lw,
          radius: parseFloat(cs.borderTopLeftRadius) || 0 });
      }
      /* 只画叶子节点的文字，避免父节点把同一句重复画一遍。
         同时记下「这行文字在网页上是不是单行显示」：单行短标签（周次、计数、位次）在导出时
         必须整段完整绘制，不能被折行后截断（曾出现 W42 → W4 的丢字）。 */
      var txt = (el.textContent || "").trim();
      if (txt && (!el.children || !el.children.length)) {
        var fs = parseFloat(cs.fontSize) || 12;
        var lh = parseFloat(cs.lineHeight) || fs * 1.4;
        var oneLine = (rr.h <= lh * 1.6);
        texts.push({ k: "text", x: rr.x, y: rr.y, w: rr.w, h: rr.h, text: txt,
          size: fs, weight: cs.fontWeight, color: cs.color,
          nowrap: oneLine && txt.length <= 16 });   /* 短的单行标签：整段画，宁可缩字号也不丢字 */
      }
    });

    return {
      root: { w: Math.round(root.scrollWidth || r0.width), h: Math.round(root.scrollHeight || r0.height) },
      ops: boxes.concat(imgs, texts)
    };
  }    // all = 全部期次都按位次重排；或某个具体期次（只重排该列）
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

  /* ---------------- 后台可控的前台显隐 + 单选归一化 ---------------- */
  function siteVisible(s) { return (HIDDEN.sites || []).indexOf(s) < 0; }
  function periodVisible(p) { return (HIDDEN.periods || []).indexOf(p) < 0; }
  /* 把后台隐藏的国家站点 / 周次从筛选项、地区分组、当前选择里统一摘掉 */
  function applyHiddenFilter() {
    var before = (SEL_SITES || []).length + "|" + (SEL_PERIODS || []).length;
    FACETS.sites = (FACETS.sites || []).filter(siteVisible);
    FACETS.periods = sortPeriods((FACETS.periods || []).filter(periodVisible));
    SITE_ORDER = (SITE_ORDER || []).filter(siteVisible);
    GROUPS = (GROUPS || []).map(function (g) {
      return { name: g.name, members: (g.members || []).filter(siteVisible) };
    }).filter(function (g) { return g && g.name && g.members.length; });
    if (SEL_GROUP && !GROUPS.some(function (g) { return g.name === SEL_GROUP; })) SEL_GROUP = "";
    SEL_SITES = (SEL_SITES || []).filter(siteVisible);
    SEL_PERIODS = (SEL_PERIODS || []).filter(periodVisible);
    normalizeSingle();
    return before;
  }
  /* 横向对比 = 单选一周（国家可比）；纵向对比 = 单选一国（周次可比）；另一维度才是多列对比 */
  function normalizeSingle() {
    if (MODE === "v") {
      if (SEL_SITES.length > 1) SEL_SITES = [SEL_SITES[0]];
    } else {
      if (SEL_PERIODS.length > 1) SEL_PERIODS = [SEL_PERIODS[SEL_PERIODS.length - 1]];
      /* 位次标签只存在于「纵向·时间对比」（与上一周比），横向没有可比基线 →
         切到横向时自动回到「全部」，避免出现"界面高亮只看上升、实际没筛"的错位 */
      ONLY = "off";
    }
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
    normalizeSingle();
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
    /* 只看标签：点了就只显示带该标签的图，再点一次可取消（仅纵向·时间对比有效） */
    var onlyGroup = (MODE === "v")
      ? '<div class="tag-group"><span class="tag-group-name">只看标签（单选，点已选中的可取消）</span><div class="tag-chips" id="rk-g-only">' +
          chip("off", "全部", ONLY === "off", "data-only") +
          chip("up", "只看位次上升", ONLY === "up", "data-only") +
          chip("new", "只看新上榜", ONLY === "new", "data-only") +
        '</div></div>'
      : "";

    /* 趋势标签 + 排序 / 图幅 / 位次排序 全部并列在同一排直接展示，无需再点开 */
    var mergedRow =
      '<div class="tag-group"><span class="tag-group-name">趋势标签 / 排序（均为单选）</span><div class="tag-chips" id="rk-g-merge">' +
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
      '<div class="tag-group"><span class="tag-group-name">国家站点' + (SEL_GROUP ? "（已按地区合并，点上方「取消地区」可单选国家）" : (MODE === "v" ? "（单选，选一个其它自动取消）" : "（可多选，最多 " + COLS_MAX + " 个）")) + '</span><div class="tag-chips" id="rk-g-sites">' + sitesHtml + '</div></div>' +
      '<div class="tag-group"><span class="tag-group-name">周次 / 期次' + (MODE === "h" ? "（单选，选一个其它自动取消）" : "（可多选，最多 " + COLS_MAX + " 个）") + '</span><div class="tag-chips" id="rk-g-periods">' + periodsHtml + '</div></div>' +
      mergedRow + onlyGroup;

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
          SEL_SITES = [v];                    /* 纵向·时间对比：国家单选，选中即自动取消其它国家 */
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
          SEL_PERIODS = [v];                  /* 横向·国家对比：周次单选，选中即自动取消其它周次 */
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
        /* 趋势标签为单选：选中一个，其余自动取消 */
        TAGS = [b.getAttribute("data-tag")];
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

    var onlyBox = $("#rk-g-only");
    if (onlyBox) Array.prototype.forEach.call(onlyBox.querySelectorAll("[data-only]"), function (b) {
      b.onclick = function () {
        var v = b.getAttribute("data-only");
        ONLY = (v === ONLY) ? "off" : v;             /* 点已选中的 → 取消，回到全部 */
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
    if (MODE === "v" && ONLY !== "off") parts.push(onlyLabel());
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
    h += '<button type="button" class="rk-exp-img" id="rk-exp-img" title="把当前这个页面此刻的样子定格成一张高清长图（列、卡片、位次标签都在原位，可放大看清）">导出图片（整页 · 高清）</button>';
    h += '<button type="button" class="rk-rep-btn" id="rk-week-report" title="按当前选中的两周生成一份对比分析报告（PPT）：款式 / 图案印花与设计元素 / 二次工艺 / 场景与背景构成 / 主图视觉 / 类目结构 六维差异 + 趋势结论">生成周对比分析报告</button>';
    h += '<button type="button" class="rk-batch-fav hidden" id="rk-batch-fav">批量收藏（0）</button>';
    h += '<div class="rk-bar-info">';
    if (!sites.length || !periods.length) h += '请选择国家站点与周次';
    else h += '共 <b>' + total + '</b> 张 · <b>' + cols + '</b> 列 · 每列最多展示 <b>' + shown + '</b> 张';
    h += '</div>';
    el.innerHTML = h;
    /* 导出图片（整页 · 高清）：与「导出 PPT」同一套权限口径 —— 只允许超级管理员
       （按钮默认不可见，确认身份后才出现；调用时还会再校验一次） */
    var exb = $("#rk-exp-img");
    if (exb) {
      exb.onclick = function () {
        if (!window.ReportKit || !window.ReportKit.exportImages) { toast("导出组件不可用，请刷新页面后重试"); return; }
        var snap = snapshotOps();
        if (!snap || !snap.ops.length) { toast("当前筛选下没有可导出的内容"); return; }
        window.ReportKit.exportImages({ ops: snap.ops, root: snap.root, scope: exportScope() });
      };
      eyeIsSuper().then(function (ok) { if (ok) exb.className = "rk-exp-img on"; });
    }

    var eye = $("#rk-eye-btn");
    if (eye) eye.onclick = openEye;

    /* 生成周对比分析报告：只在「纵向 · 时间对比」且选中 ≥2 周时才有意义。
       权限口径与「导出图片」「导出 PPT」一致 —— 只给超级管理员。
       报告里除数据类页面外，还有款式 / 印花 / 工艺 / 场景 / 主图视觉 / 类目 六维差异页，
       维度数据取自后台给图片打的标签（缺标时该维度页会说明"无打标数据"，不影响成稿）。 */
    var rep = $("#rk-week-report");
    if (rep) {
      var canRep = (MODE === "v" && periods.length >= 2);
      rep.disabled = !canRep;
      rep.style.display = "none";   /* 默认不可见，确认是超级管理员后才出现 */
      rep.title = canRep
        ? rep.getAttribute("title")
        : "请先用「纵向 · 时间对比」并选中 2 周以上，再生成对比报告";
      rep.onclick = function () {
        if (!window.WeekReport) { toast("报告组件未加载，请刷新页面后重试"); return; }
        if (MODE !== "v" || activePeriods().length < 2) { toast("请切到「纵向 · 时间对比」并选中两周以上"); return; }
        var scope = exportScope();
        var now = new Date();
        var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
        rep.disabled = true;
        var oldTxt = rep.textContent;
        rep.textContent = "正在生成报告…";
        var done = function (msg, bad) {
          rep.disabled = false; rep.textContent = oldTxt;
          if (msg) toast(msg, bad);
        };
        window.WeekReport.run({
          root: document.querySelector("#rk-pools"),
          spec: "wide",
          scope: scope,
          nowText: now.getFullYear() + "-" + p2(now.getMonth() + 1) + "-" + p2(now.getDate()) + " " + p2(now.getHours()) + ":" + p2(now.getMinutes()),
          v: (function () { var s = document.querySelector('script[src*="js/rank.js"]'); return (s && (String(s.getAttribute("src")).match(/[?&]v=([^&]+)/) || [])[1]) || ""; })(),
          onProgress: function (t) { rep.textContent = t; },
          tagOf: function (urls) {
            if (!SBX) return Promise.resolve({});
            /* 先读「图库标签 + 榜单独立标签」的合并结果（后台「榜单打标」写的就是后者）；
               老版本没有合并方法时退回只读图库，保证不会因此报错。 */
            var fn = SBX.listImageTagsForReport || SBX.listImageTags;
            if (!fn) return Promise.resolve({});
            return fn.call(SBX, urls).catch(function () { return {}; });
          }
        }).then(function (r) {
          if (!r || !r.ok) { done((r && r.reason) || "生成失败，请重试", true); return; }
          done("已生成：" + r.name);
        }, function () { done("生成失败，请重试", true); });
      };
      eyeIsSuper().then(function (ok) { if (ok) rep.style.display = ""; else rep.style.display = "none"; });
    }
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
    /* 天眼模式：图上不叠任何文字（打开后就是一面纯图墙，密密麻麻的字不再挡图）。
       标签改挂在 data-* 上，鼠标移到那张图上时由放大浮窗显示 —— 放大图 + 图下方标签。 */
    var eyeMeta = "", eyeTags = [];
    if (opt.eye) {
      eyeMeta = [it.site, it.period_label, it.leaf_category].filter(Boolean).join(" · ");
      if (b) eyeTags.push(b.txt);
      if (opt.move) eyeTags.push(opt.move);
      if (share) eyeTags.push("共 " + share.length + " 国同款");
    }
    var h = '<figure class="rk-card' + (opt.isNew ? " is-new" : "") + '" data-url="' + esc(it.image_url) + '" title="' + esc(title) + '"'
      + ' data-period="' + esc(it.period_label || "") + '" data-ptype="' + esc(it.period_type || "week") + '"'
      + ' data-title="' + esc(it.title || "") + '" data-leaf="' + esc(it.leaf_category || "") + '"'
      + ' data-cat="' + esc(it.category || "") + '" data-site="' + esc(it.site || "") + '"'
      + ' data-ratio="' + esc(it.ratio == null ? "" : it.ratio) + '" data-rank="' + esc(it.rank_abs == null ? "" : it.rank_abs) + '"'
      + (opt.eye ? ' data-eye-meta="' + esc(eyeMeta) + '" data-eye-tags="' + esc(eyeTags.join("|")) + '"' : '') + '>';
    /* 天眼要求「一次全加载、不用下滑」：这些图都在首屏内，直接加载；其余场景保持懒加载省流量 */
    h += '<img' + (opt.eager ? '' : ' loading="lazy"') + ' src="' + esc(it.image_url) + '" alt="' + esc(it.leaf_category || "榜单图片") + '"' +
      (opt.eager ? ' decoding="async"' : '') + '>';
    if (!opt.eye) {
      if (b) h += '<span class="rk-badge ' + b.cls + '">' + esc(b.txt) + '</span>';
      if (share) h += '<span class="rk-share" title="与 ' + esc(share.join("、")) + ' 相同">共 ' + share.length + ' 国</span>';
      if (opt.move) h += '<span class="rk-move">' + esc(opt.move) + '</span>';
      /* 我的收藏：右上角星标（点一次收藏/取消），左上角多选勾选（攒够一次批量收藏） */
      h += '<button type="button" class="rk-fav" data-fav="0" title="收藏到「我的收藏」">☆</button>';
      h += '<span class="rk-pick" data-pick="0" title="选中，稍后批量收藏"></span>';
    }
    /* 天眼标签（可开关）：文字一律放在【图片下方】的独立栏里，绝不叠在图上、不盖图。
       顶栏固定蓝栏里的「眼睛」按钮随时开关；关掉后整条隐藏，图片区自然变大。 */
    if (opt.eye) {
      h += '<figcaption class="rk-eye-cap">' +
        (eyeMeta ? '<span class="rk-eye-cap-m">' + esc(eyeMeta) + '</span>' : '') +
        (eyeTags.length ? '<span class="rk-eye-cap-t">' + esc(eyeTags.join(" · ")) + '</span>' : '') +
        '</figcaption>';
    }
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
    EXPORT_ITEMS = [];                                   /* 每次重排都重新累计，避免残留上一次的范围 */
    var html = "", maxLen = 0, kept = 0, cols = 0, dropped = 0, dropKind = "";

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
        /* 该国这一期在这个类目下没有图 → 整列不输出（横向国家对比同理：
           选了几个国家、但其中某个国家本期没上传，留一个空列既难看又白占宽度）。
           去掉后剩下的列由 flex 均分：只剩 1 国就整行铺满，2 国就两等分。 */
        if (!list.length) { dropped++; dropKind = "site"; return; }
        if (list.length > maxLen) maxLen = list.length;
        var cards = list.slice(0, limit).map(function (it) { return cardHtml(it, { share: urlSites[it.image_url], eager: opts.eager, eye: opts.eye }); }).join("");
        html += poolHtml(s, meta, total, cards, opts.noFoot ? null : Math.min(limit, total));
        kept += list.length; cols++;
        /* 导出用清单：整列（不按「每列最多展示」截断）；横向按国家比，没有位次标签 */
        list.forEach(function (it) {
          EXPORT_ITEMS.push({
            url: it.image_url, label: "", site: s,
            period: it.period_label || "",
            cat: it.leaf_category || it.category || CAT || ""
          });
        });
      });
    } else {
      /* ===== 纵向 · 时间对比：每期一列 ===== */
      var site = sites[0];
      /* 纵向只比「当前这一个国家（或地区合并池）」的周次：别的国家的数据若混进来，
         会给本不存在的周次凑出一列（列里全是别国的图），既误导又和筛选对不上。 */
      var mineOnly = all.filter(function (it) { return (it.site || "") === site; });
      var basePeriods = withBasePeriods(periods);
      var byPeriod = {};
      basePeriods.forEach(function (p) { byPeriod[p] = []; });
      mineOnly.forEach(function (it) { if (byPeriod[it.period_label]) byPeriod[it.period_label].push(it); });

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
            var mv0 = moveOf(it, p, prev, hasOf, rankOf);
            var isNew = mv0.isNew;
            var d = mv0.diff;
            /* 「新上榜优先」：新上榜的排最前；
               「位次上升最多」：只按上升位次排（新上榜无位次可比，沉到末尾），
               两种模式结果明显区分。 */
            var key = (MOVE === "new") ? (isNew ? 1e9 : 0) : (isNew ? -1e9 : d);
            return { it: it, i: i, key: key };
          });
          keyed.sort(function (a, b) { return (b.key - a.key) || (a.i - b.i); });
          list = keyed.map(function (o) { return o.it; });
        }
        var newCnt = 0;
        if (prev) list.forEach(function (i) { if (moveOf(i, p, prev, hasOf, rankOf).isNew) newCnt++; });
        var full = list.length;
        /* 只看标签：位次上升 / 新上榜 —— 命中判定与卡片标签同源（同一套 moveOf），
           筛出来的和图上的标签永远一致；在排序之后筛，顺序仍是同一套口径 */
        if (ONLY !== "off" && prev) {
          list = list.filter(function (it) { return hitOnly(moveOf(it, p, prev, hasOf, rankOf)); });
        }
        if (list.length > maxLen) maxLen = list.length;
        var meta = site + (prev ? (" · 较上一周（" + prev + "）新上榜 " + newCnt + " 张") : " · 首期（无上一周）");
        if (ONLY !== "off") meta += " · " + onlyLabel() + "：" + list.length + " 张（该列共 " + full + " 张）";
        /* 该周在这个「国家 + 类目」下没有任何图 → 不输出这一列：
           各国家/类目的周度本来就不齐，留一个空列既难看又占宽；
           去掉后剩下的列由 flex 均分，1 列就铺满、2 列就两等分。 */
        if (!list.length) { dropped++; dropKind = "period"; return; }
        var cards = list.slice(0, limit).map(function (it) {
          var mv = moveOf(it, p, prev, hasOf, rankOf);
          return cardHtml(it, { move: mv.move, isNew: mv.isNew, eager: opts.eager, eye: opts.eye });
        }).join("");
        html += poolHtml(p, meta, list.length, cards, opts.noFoot ? null : Math.min(limit, list.length));
        kept += list.length; cols++;
        /* 导出用清单：整列（不按「每列最多展示」截断），带站点 / 期次 / 类目 / 位次标签 */
        list.forEach(function (it) {
          EXPORT_ITEMS.push({
            url: it.image_url, label: moveOf(it, p, prev, hasOf, rankOf).move,
            site: it.site || site, period: p,
            cat: it.leaf_category || it.category || CAT || ""
          });
        });
      });
    }
    return { html: html, maxLen: maxLen, kept: kept, cols: cols, dropped: dropped, dropKind: dropKind };
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
    if (ONLY !== "off" && !R.kept) {
      box.innerHTML = '<div class="rk-empty">当前筛选里没有「' + onlyLabel() + '」的图片。点筛选里的「全部」可以看回所有图。</div>';
      return;
    }
    /* 选中的周列里有几列在本组合下确实没有图 → 已折叠；全部为空时给出空态而不是大片留白 */
    if (!R.cols) {
      box.innerHTML = '<div class="rk-empty">该组合下暂无榜单数据（所选周次在这个国家 / 类目下都没有上传）。换一个周次或国家试试。</div>';
      return;
    }
    var html = '';
    if (R.dropped) {
      var _dtxt = R.dropKind === "site"
        ? ('已自动隐藏 <b>' + R.dropped + '</b> 个国家列（该国这一期在这个类目下没有上传）')
        : ('已自动隐藏 <b>' + R.dropped + '</b> 个无数据的周列（该周这个国家 / 类目没有上传）');
      html += '<div class="rk-dropnote">' + _dtxt + '，'
        + '剩余 <b>' + R.cols + '</b> 列已铺满宽度。</div>';
    }
    html += '<div class="rk-pools" id="rk-pools">' + R.html + '</div>';
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

    fitPoolsSoon();
    syncFavUI();
  }

  /* ================= 我的收藏：收藏 / 多选批量 / 取消 =================
     · 星标状态按「期次 + 图地址」判定：同一张图在 W40 与 W41 各算一条，
       所以在 W40 收藏了不会把 W41 那一列也点亮（用户明确要求两条）。
     · 未登录、或建表脚本还没执行 → 只提示，不发任何写请求。 */
  var FAV = { ready: null, uid: null, cats: [], keys: {}, sel: {}, rows: [], batch: false, catId: null, pop: null };
  var FAV_COLORS = ["#8b7355", "#c25e5a", "#4a9c6d", "#5b7c9d", "#b08a4f", "#8a6fa8", "#4f8f8a", "#a0685a"];

  function favKey(period, url) { return String(period || "") + "\u0001" + String(url || ""); }
  function favColorOf(i) { return FAV_COLORS[((i % FAV_COLORS.length) + FAV_COLORS.length) % FAV_COLORS.length]; }
  function favColorFor(cat, idx) { return (cat && cat.color) || favColorOf(idx); }

  async function loadFavState() {
    FAV.ready = false;
    if (!SBX || typeof SBX.favReady !== "function") return;
    try { FAV.ready = await SBX.favReady(); } catch (e) { FAV.ready = false; }
    try { FAV.uid = (await SBX.favUid()) || null; } catch (e) { FAV.uid = null; }
    if (!FAV.uid || !FAV.ready) return;
    try { FAV.cats = await SBX.listFavCategories(); } catch (e) { FAV.cats = []; }
    try {
      var rows = await SBX.listFavKeys();
      var m = {};
      (rows || []).forEach(function (r) { m[favKey(r.period_label, r.image_url)] = r.id || 1; });
      FAV.keys = m;
    } catch (e) { FAV.keys = {}; }
  }

  function syncFavUI() {
    var box = $("#rk-body");
    if (box) {
      Array.prototype.forEach.call(box.querySelectorAll(".rk-card[data-url]"), function (fig) {
        var k = favKey(fig.getAttribute("data-period"), fig.getAttribute("data-url"));
        var on = !!FAV.keys[k];
        var b = fig.querySelector(".rk-fav");
        if (b) { b.setAttribute("data-fav", on ? "1" : "0"); b.textContent = on ? "★" : "☆"; }
        var p = fig.querySelector(".rk-pick");
        if (p) p.setAttribute("data-pick", FAV.sel[k] ? "1" : "0");
      });
    }
    var n = Object.keys(FAV.sel).length;
    var bb = $("#rk-batch-fav");
    if (bb) {
      bb.textContent = "批量收藏（" + n + "）";
      bb.classList.toggle("hidden", !n || !FAV.uid);
    }
  }

  function favCardData(fig) {
    return {
      image_url: fig.getAttribute("data-url") || "",
      period_label: fig.getAttribute("data-period") || "",
      period_type: fig.getAttribute("data-ptype") || "week",
      title: fig.getAttribute("data-title") || "",
      leaf_category: fig.getAttribute("data-leaf") || "",
      rank_category: fig.getAttribute("data-cat") || "",
      site: fig.getAttribute("data-site") || "",
      ratio: fig.getAttribute("data-ratio") || null,
      rank_abs: fig.getAttribute("data-rank") || null
    };
  }

  function favNeedLogin() {
    if (!FAV.uid) { toast("请先登录后再收藏"); return true; }
    if (!FAV.ready) { toast("收藏表还没建好，请先执行 tools/patch_20261021R.sql"); return true; }
    return false;
  }

  function closeFavPop() {
    if (FAV.pop && FAV.pop.parentNode) FAV.pop.parentNode.removeChild(FAV.pop);
    FAV.pop = null; FAV.rows = []; FAV.batch = false; FAV.catId = null;
  }

  function openFavPop(rows, opt) {
    var o = opt || {};
    closeFavPop();
    FAV.rows = rows || [];
    if (!FAV.rows.length) return;
    FAV.batch = !!o.batch;
    FAV.catId = null;
    var already = (!FAV.batch && FAV.rows.length === 1)
      ? !!FAV.keys[favKey(FAV.rows[0].period_label, FAV.rows[0].image_url)] : false;

    var head = already ? "已收藏" : (FAV.batch ? "批量收藏 " + FAV.rows.length + " 张" : "收藏到「我的收藏」");
    var h = '<div class="fp-mask" data-fp="mask"></div><div class="fp-box" role="dialog" aria-label="我的收藏">';
    h += '<div class="fp-head"><span class="fp-t">' + esc(head) + '</span>'
      + '<button type="button" class="fp-x" data-fp="close" aria-label="关闭">×</button></div>';
    if (!FAV.ready) {
      /* 表还没建好：不要等用户点「收藏」才报错，进来就把原因和下一步说清楚 */
      h += '<div class="fp-body">'
        + '<div class="fp-miss">收藏功能还没启用。</div>'
        + '<div class="fp-hint">需要管理员在数据库执行一次建表脚本 <code>tools/patch_20261021R.sql</code>。'
        + '脚本末尾会刷新接口缓存，执行完点下面的按钮即可，不用重新部署。</div>'
        + '</div>'
        + '<div class="fp-foot"><button type="button" class="fp-cancel" data-fp="close">关闭</button>'
        + '<button type="button" class="fp-ok" data-fp="recheck">我建好了，重新检测</button></div>';
    } else if (already) {
      h += '<div class="fp-body"><div class="fp-done">这张图已经收藏过了（' + esc(FAV.rows[0].period_label || "本批") + '）。</div>'
        + '<div class="fp-hint">同一个分类下想调整位置，可以到「我的收藏」里拖拽。</div></div>';
      h += '<div class="fp-foot"><button type="button" class="fp-cancel" data-fp="close">关闭</button>'
        + '<button type="button" class="fp-del" data-fp="unfav">取消收藏</button></div>';
    } else {
      h += '<div class="fp-body"><div class="fp-sub">选择分类</div><div class="fp-cats">';
      FAV.cats.forEach(function (c, i) {
        h += '<button type="button" class="fp-cat' + (FAV.catId === c.id ? " is-on" : "") + '" data-cat="' + c.id + '">'
          + '<i class="fp-dot" style="background:' + favColorFor(c, i) + '"></i>'
          + '<span class="fp-cn">' + esc(c.name) + '</span></button>';
      });
      h += '<button type="button" class="fp-cat is-none" data-cat=""><i class="fp-dot is-empty"></i><span class="fp-cn">不分类（直接收藏）</span></button>';
      h += '</div>';
      h += '<div class="fp-new"><input class="fp-input" maxlength="40" placeholder="或者新建一个分类…" data-fp="name">'
        + '<button type="button" class="fp-addbtn" data-fp="newcat">新建并收藏</button></div>';
      h += '</div>';
      h += '<div class="fp-foot"><button type="button" class="fp-cancel" data-fp="close">取消</button>'
        + '<button type="button" class="fp-ok" data-fp="ok">收藏</button></div>';
    }
    h += '</div>';

    var wrap = document.createElement("div");
    wrap.className = "fav-pop-wrap";
    wrap.id = "rk-fav-pop";
    wrap.innerHTML = h;
    document.body.appendChild(wrap);
    FAV.pop = wrap;

    wrap.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-fp="mask"]') || t.closest('[data-fp="close"]')) { closeFavPop(); return; }
      var cat = t.closest(".fp-cat");
      if (cat) {
        var v = cat.getAttribute("data-cat");
        FAV.catId = v ? Number(v) : null;
        Array.prototype.forEach.call(wrap.querySelectorAll(".fp-cat"), function (x) { x.classList.remove("is-on"); });
        cat.classList.add("is-on");
        return;
      }
      if (t.closest('[data-fp="recheck"]')) { favRecheck(wrap); return; }
      if (t.closest('[data-fp="newcat"]')) { favCreateAndSave(wrap); return; }
      if (t.closest('[data-fp="ok"]')) { favSave(wrap, FAV.catId); return; }
      if (t.closest('[data-fp="unfav"]')) { favRemoveOne(wrap); return; }
    });
    wrap.addEventListener("keydown", function (e) {
      if (!e || !e.key) return;
      if (e.key === "Escape") { closeFavPop(); return; }
      if (e.key === "Enter" && e.target && e.target.getAttribute && e.target.getAttribute("data-fp") === "name") {
        favCreateAndSave(wrap);
      }
    });
  }

  /* 用户执行完建表脚本后，不刷新页面直接重新检测一次 */
  async function favRecheck(wrap) {
    var btn = wrap.querySelector('[data-fp="recheck"]');
    if (btn) { btn.disabled = true; btn.textContent = "检测中…"; }
    var rows = FAV.rows.slice();
    var batch = FAV.batch;
    await loadFavState();
    if (FAV.ready) {
      syncFavUI();
      closeFavPop();
      openFavPop(rows, { batch: batch });
      toast("收藏功能已就绪");
    } else {
      if (btn) { btn.disabled = false; btn.textContent = "我建好了，重新检测"; }
      toast("还是连不上：请确认脚本执行在这个站点对应的数据库里");
    }
  }

  async function favSave(wrap, catId) {
    if (favNeedLogin()) { closeFavPop(); return; }
    var btn = wrap.querySelector('[data-fp="ok"]');
    if (btn) { btn.disabled = true; btn.textContent = "收藏中…"; }
    try {
      var n = await SBX.addFavItems(FAV.rows, catId);
      FAV.rows.forEach(function (r) { FAV.keys[favKey(r.period_label, r.image_url)] = 1; });
      var wasBatch = FAV.batch;
      if (wasBatch) FAV.sel = {};
      closeFavPop();
      syncFavUI();
      toast("已收藏 " + n + " 张");
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "收藏"; }
      toast((e && e.message) ? e.message : "收藏失败");
    }
  }

  async function favCreateAndSave(wrap) {
    var inp = wrap.querySelector('[data-fp="name"]');
    var name = inp ? String(inp.value || "").trim() : "";
    if (!name) { toast("先给新分类起个名字"); if (inp && inp.focus) inp.focus(); return; }
    if (favNeedLogin()) { closeFavPop(); return; }
    var add = wrap.querySelector('[data-fp="newcat"]');
    if (add) { add.disabled = true; add.textContent = "新建中…"; }
    try {
      var c = await SBX.createFavCategory(name, favColorOf(FAV.cats.length));
      try { FAV.cats = await SBX.listFavCategories(); } catch (e2) { FAV.cats = FAV.cats.concat([c]); }
      await favSave(wrap, (c && c.id) ? c.id : null);
    } catch (e) {
      if (add) { add.disabled = false; add.textContent = "新建并收藏"; }
      toast((e && e.message) ? e.message : "新建分类失败");
    }
  }

  async function favRemoveOne(wrap) {
    var r = FAV.rows[0];
    if (!r) { closeFavPop(); return; }
    try {
      var id = FAV.keys[favKey(r.period_label, r.image_url)];
      if (!id || id === 1) {
        var list = await SBX.listFavItems({ period: r.period_label });
        var hit = (list || []).filter(function (x) { return x.image_url === r.image_url; })[0];
        if (hit) id = hit.id;
      }
      if (id) await SBX.removeFavItems([id]);
      delete FAV.keys[favKey(r.period_label, r.image_url)];
      closeFavPop(); syncFavUI();
      toast("已取消收藏");
    } catch (e) {
      toast((e && e.message) ? e.message : "取消收藏失败");
    }
  }

  function bindFav() {
    var box = $("#rk-body");
    if (box && !box.__favBound) {
      box.__favBound = true;
      /* 捕获阶段拦截：卡片自身有「点击开灯箱」，星标与勾选必须先被我们吃掉 */
      box.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var favBtn = t.closest(".rk-fav");
        if (favBtn) {
          e.preventDefault(); e.stopPropagation();
          var fig = favBtn.closest(".rk-card");
          if (!fig) return;
          if (favNeedLogin()) return;
          openFavPop([favCardData(fig)], {});
          return;
        }
        var pick = t.closest(".rk-pick");
        if (pick) {
          e.preventDefault(); e.stopPropagation();
          var fig2 = pick.closest(".rk-card");
          if (!fig2) return;
          if (favNeedLogin()) return;
          var k = favKey(fig2.getAttribute("data-period"), fig2.getAttribute("data-url"));
          if (FAV.sel[k]) delete FAV.sel[k]; else FAV.sel[k] = 1;
          syncFavUI();
          return;
        }
      }, true);
    }
    if (!document.__favBatchBound) {
      document.__favBatchBound = true;
      document.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (!t.closest("#rk-batch-fav")) return;
        if (favNeedLogin()) return;
        var rows = [];
        var box2 = $("#rk-body");
        if (box2) {
          Array.prototype.forEach.call(box2.querySelectorAll(".rk-card[data-url]"), function (fig) {
            var k = favKey(fig.getAttribute("data-period"), fig.getAttribute("data-url"));
            if (FAV.sel[k]) rows.push(favCardData(fig));
          });
        }
        if (!rows.length) { toast("先点图左上角的勾选，再批量收藏"); return; }
        openFavPop(rows, { batch: true });
      });
    }
  }

  async function initFav() {
    bindFav();
    await loadFavState();
    syncFavUI();
  }

  /* ---------------- 对比池：横向铺满 + 纵向自然向下排 ----------------
     需求口径（用户明确）：不管选了几列对比，横向都要铺满、不溢出到右侧、不需要横向滚动；
     而且**不要为了塞进一屏把图片缩小** —— 图多就往下排，页面自己纵向滚动。
     所以这里只按「列宽 + 图幅档位目标卡宽」反推每行几张：卡片大小与列数、屏幕高度都无关。 */
  var POOL_GAP = 10;          /* 列与列之间的缝（px）—— 必须与 CSS 的 .rk-pools gap 一致 */
  var POOL_VGAP = 6;          /* 图与图之间的缝（px）—— 必须与 CSS 的 .rk-pool-grid gap 一致 */
  var POOL_MIN_CARD = 34;     /* 卡片最小可读宽度（px）：硬下限 */
  /* 每行张数上限：这里曾经是 12 —— 那正是「小档和中档一样大」的根因：
     单列时两档的目标宽度都算到 12 以上，被这个上限一起截到 12，于是三档看不出区别；
     同时列数一多（3/4 列），列宽变小、每行张数却没跟着变小，图片就被压小了。
     现在上限放宽到 40，真正决定张数的是「列宽 ÷ 档位目标卡宽」。 */
  var POOL_R_MAX = 40;
  /* 图幅档位 → 目标卡片宽度（px）。三档目标宽度拉得足够开，保证四舍五入后仍不撞档。 */
  var SIZE_TARGET = { s: 70, m: 130, l: 220 };
  function sizeTargetW() { return SIZE_TARGET[SIZE] || SIZE_TARGET.m; }
  var poolFitTimer = null;

  /* 每行排几张：只由「该列实际宽度 + 图幅档位目标卡宽」决定 ——
     卡片的绝对大小 ≈ 档位目标宽度，与**选了几列对比**、屏幕高度都无关。
     这一条是用户明确要求：3 列、4 列时图片不能被压小，图多就继续往下排。
     做法：先各自按目标宽度算出张数，再强制保证档位顺序（小 > 中 > 大）——
     否则窄列时四舍五入会把两档撞成同一个张数，又变成「点了没反应」。
     最后由 grid 的 1fr 把整行拉满（横向铺满、不溢出、不出现横向滚动条）。 */
  function poolColsFromWidth(colW, n) {
    var gap = POOL_VGAP;
    var avail = colW + gap;
    var rS = Math.max(1, Math.round(avail / (SIZE_TARGET.s + gap)));
    var rM = Math.max(1, Math.round(avail / (SIZE_TARGET.m + gap)));
    var rL = Math.max(1, Math.round(avail / (SIZE_TARGET.l + gap)));
    if (rM <= rL) rM = rL + 1;                 /* 档位顺序硬保证：中 > 大 */
    if (rS <= rM) rS = rM + 1;                 /* 档位顺序硬保证：小 > 中 */
    var r = SIZE === "s" ? rS : (SIZE === "l" ? rL : rM);
    var maxCols = Math.floor(avail / (POOL_MIN_CARD + gap));   /* 硬下限：不低于最小可读宽度 */
    r = Math.min(r, POOL_R_MAX, Math.max(1, maxCols), Math.max(1, n));
    return Math.max(1, r);
  }

  function fitPools() {
    var pools = document.querySelector("#rank-view .rk-pools") || document.querySelector(".rk-pools");
    if (!pools) return;
    var cols = pools.querySelectorAll(".rk-pool");
    if (!cols.length) return;
    var K = cols.length;

    Array.prototype.forEach.call(cols, function (col) {
      var grid = col.querySelector(".rk-pool-grid");
      if (!grid) return;
      var n = grid.querySelectorAll(".rk-card").length;
      if (!n) return;
      var colW = grid.clientWidth || 0;
      if (!colW) {
        /* 刚写入 DOM 还没排版出来时按容器宽度估一个（下一帧 resize 会再校正） */
        colW = Math.max(1, ((pools.clientWidth || 0) - (K - 1) * POOL_GAP) / K);
      }
      grid.style.setProperty("--rk-r", String(poolColsFromWidth(colW, n)));
    });
    /* 不再有「一屏塞不下就裁掉」的概念：图多就往下排、页面纵向滚动，图片尺寸保持不变 */
    pools.setAttribute("data-pool-clip", "0");
  }

  function fitPoolsSoon() {
    if (poolFitTimer) clearTimeout(poolFitTimer);
    poolFitTimer = setTimeout(function () { poolFitTimer = null; try { fitPools(); } catch (e) {} }, 60);
  }

  /* ---------------- 天眼：一屏铺满「每一列的全部图」 ---------------- */
  /* 需求口径：打开天眼 → 每一列（每个国家 / 每个期次）的【全部图片】都在，
     不受「每列最多展示 N 张」限制、不需要点「加载更多」；图片全部直接加载（不懒加载）、
     比例自适应、尽量铺满一屏——一眼就能看全，不用下滑。
     列范围可切换：默认=当前对比列（2/3/4 列），另可切「全部站点 × 全部期次」。 */
  var EYE_ALL = false;        /* 列范围：false=当前对比列，true=全部站点×全部期次 */
  var EYE_PERIODS_MAX = 2;    /* 天眼默认最多对比的周数：列少了每列更宽，图片能明显放大 */
  var EYE_PERIOD_CLAMPED = false;  /* 本次是否真的发生了「按默认收紧到最近 N 周」 */
  var EYE_EAGER_MAX = 1500;   /* 图数超过此上限才退回懒加载，避免一次拉爆（默认全加载） */
  var EYE_R_MAX = 60;         /* 每行最多排几张（真正的下限由「最小卡片宽度」兜住） */
  var EYE_MIN_CARD = 20;      /* 卡片最小宽度（px）：低于这个就看不清了 */
  var EYE_TARGET_CARD = 150;  /* 天眼里卡片的自然宽度（px）：每行几张只按列宽算，不按屏幕高度缩图 */
  var EYE_GAP = 2;            /* 同列里图与图的横向缝（px）——必须与 CSS 的 --eye-gap 保持一致 */
  var EYE_VGAP = 2;           /* 同列里图与图的纵向缝（px）——必须与 CSS 的 gap 保持一致 */
  /* 天眼标签开关（固定蓝栏里的眼睛按钮）：默认显示，但标签一律画在【图片上方/下方】的正常流里，
     不会叠在图上；关掉后整条隐藏、图片区自然变大。选择会记住，下次打开保持上次状态。 */
  var EYE_LABELS = true;
  try { if (localStorage.getItem("rk-eye-labels") === "0") EYE_LABELS = false; } catch (eL) { /* 取不到就用默认值 */ }
  function saveEyeLabels() {
    try { localStorage.setItem("rk-eye-labels", EYE_LABELS ? "1" : "0"); } catch (eL2) { /* 忽略 */ }
  }
  function applyEyeLabels(panel) {
    if (!panel) return;
    panel.classList.toggle("labels-off", !EYE_LABELS);
    var btn = panel.querySelector("#rk-eye-tag");
    if (btn) {
      btn.classList.toggle("on", EYE_LABELS);
      btn.setAttribute("aria-pressed", EYE_LABELS ? "true" : "false");
      btn.title = EYE_LABELS ? "标签：显示中（点击隐藏）" : "标签：已隐藏（点击显示）";
    }
  }
  var eyeFitBound = null, eyeFsBound = null;

  /* 天眼要铺开的列范围 */
  function eyeScope() {
    if (!EYE_ALL) {
      /* 天眼默认只对比最近两周：列数少了，每列更宽，图自然更大。
         需要看更多周时，点顶栏的「范围」切到「全部站点 × 全部期次」。 */
      var ps = activePeriods();
      EYE_PERIOD_CLAMPED = ps.length > EYE_PERIODS_MAX;
      if (EYE_PERIOD_CLAMPED) ps = ps.slice(ps.length - EYE_PERIODS_MAX);
      return { sites: poolSites(), periods: ps };
    }
    /* 「全部站点 × 全部期次」不受两周限制，顶栏的「默认两周」提示也必须随之消失
       （否则切一次范围后提示会一直挂着，与屏幕上的实际列数对不上）。 */
    EYE_PERIOD_CLAMPED = false;
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

  /* 纯计算（天眼）：每行排几张 = 只由「列宽」决定。
     用户口径（明确）：不管几列对比都要横向铺满；**不要再为了塞进一屏把图片缩小** ——
     列数越多、屏幕越矮，都不允许把图压小，图多就直接往下排、页面自己纵向滚动。
     所以这里不再从「最小张数」往回试高度，而是按自然卡宽（EYE_TARGET_CARD）算张数；
     高度只用来判断「要不要允许下滑」（clipped）。 */
  function eyeFitCalc(availW, availH, K, maxN, opt) {
    opt = opt || {};
    var gap = opt.gap == null ? EYE_GAP : opt.gap;
    var vgap = opt.vgap == null ? EYE_VGAP : opt.vgap;
    var headH = opt.headH == null ? 46 : opt.headH;
    var capH = opt.capH == null ? 0 : opt.capH;   /* 每张图【上方/下方】标签栏的高度（天眼开着标签时才 > 0） */
    var minW = opt.minW == null ? EYE_MIN_CARD : opt.minW;
    var target = opt.target == null ? EYE_TARGET_CARD : opt.target;
    K = Math.max(1, K || 1);
    var colW = (availW - gap * (K - 1)) / K;
    if (!(colW > 0) || !(maxN > 0)) {
      return { r: 1, cardW: Math.max(minW, colW > 0 ? colW : minW), clipped: false };
    }
    var r = Math.round((colW + gap) / (target + gap));              /* 四舍五入 → 实际卡宽最接近自然卡宽 */
    var maxCols = Math.floor((colW + gap) / (minW + gap));          /* 硬下限：不低于最小可读宽度 */
    r = Math.max(1, Math.min(r, EYE_R_MAX, maxCols, Math.max(1, maxN)));
    var cardW = (colW - gap * (r - 1)) / r;
    var rows = Math.ceil(maxN / r);
    var needH = headH + rows * (cardW * 4 / 3 + vgap + capH);
    /* 一屏放得下 → 不用下滑；图多放不下 → 允许下滑（此时也不缩图，图片尺寸与列数无关） */
    var clipped = !(availH > 0) || needH > availH;
    return { r: r, cardW: cardW, clipped: clipped };
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
    /* 单列可用宽度 = 该列网格的实测宽度（比「整行宽 ÷ 列数」准：
       列与列之间的缝、列自身的左右内边距都已被排掉，算出的「每行几张」不会偏大而把图挤出可视高度）。 */
    var g0 = cols[0] ? cols[0].querySelector(".rk-pool-grid") : null;
    var colW = (g0 && g0.clientWidth) ? g0.clientWidth : 0;
    if (!colW) {
      var poolPad = 0;
      try {
        var cstyle = getComputedStyle(cols[0]);
        poolPad = (parseFloat(cstyle.paddingLeft) || 0) + (parseFloat(cstyle.paddingRight) || 0);
      } catch (e) { poolPad = 0; }
      var poolsW = pools.clientWidth || body.clientWidth;
      colW = Math.max(1, (poolsW - (K - 1) * 4) / Math.max(1, K) - poolPad);
    }
    /* 天眼列头（周度）与卡片标签：开启时都画在【正常流内】的独立栏里（图片上方 / 下方），
       绝不叠在图上；这里把它们的实测高度扣掉，保证「一屏看全」的口径仍然成立。 */
    var headH = 0, capH = 0;
    if (EYE_LABELS) {
      var hz = cols[0] ? cols[0].querySelector(".rk-pool-head") : null;
      var cz = cols[0] ? cols[0].querySelector(".rk-eye-cap") : null;
      headH = hz ? (hz.offsetHeight || 0) : 0;
      capH = cz ? (cz.offsetHeight || 0) : 0;
    }
    /* 可用高度要扣掉外层内边距（clientHeight 含 padding），否则会把图算高一点、挤出行外 */
    var availH = body.clientHeight;
    try {
      var bstyle = getComputedStyle(body);
      availH = Math.max(1, body.clientHeight - (parseFloat(bstyle.paddingTop) || 0) - (parseFloat(bstyle.paddingBottom) || 0));
    } catch (e2) { /* 取不到样式就用原值 */ }
    var fit = eyeFitCalc(colW, availH, 1, maxN, { headH: headH, gap: EYE_GAP, vgap: EYE_VGAP, capH: capH });
    pools.style.setProperty("--eye-gap", EYE_GAP + "px");
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
        /* 顶部固定蓝栏（正常流第一条，永不压图）：范围 / 排序 / 标签开关（眼睛）/ 导出 PPT / 关闭
           全部常显，点开就能用，不需要鼠标悬浮才出现。 */
        '<div class="rk-eye-head" id="rk-eye-head">' +
          '<span class="rk-eye-brand">天眼 · 全部对比图</span>' +
          '<span class="rk-eye-sub" id="rk-eye-sub">加载中…</span>' +
          '<span class="rk-eye-clip" id="rk-eye-clip" style="display:none">图数较多，已按最小尺寸铺满；剩余可下滑查看</span>' +
          '<span class="rk-eye-sp"></span>' +
          '<label class="rk-eye-sortwrap"><span class="rk-eye-sortlab">排序</span>' +
            '<select class="rk-eye-sortsel" id="rk-eye-sortsel" title="排序方式">' +
              '<option value="ratio_desc">环比比例 高→低</option>' +
              '<option value="ratio_asc">环比比例 低→高</option>' +
              '<option value="abs_desc">环比绝对值 高→低</option>' +
              '<option value="abs_asc">环比绝对值 低→高</option>' +
            '</select>' +
          '</label>' +
          '<button type="button" class="rk-eye-scope" id="rk-eye-scope"></button>' +
          '<button type="button" class="rk-eye-tag" id="rk-eye-tag" title="标签：显示中（点击隐藏）" aria-pressed="true"><span class="rk-eye-tagicon">👁</span><span class="rk-eye-tagtxt">标签</span></button>' +
          '<button type="button" class="rk-eye-ppt" id="rk-eye-ppt">导出 PPT</button>' +
          '<button type="button" class="rk-eye-close" id="rk-eye-close" title="关闭（Esc）">×</button>' +
        '</div>' +
        '<div class="rk-eye-body" id="rk-eye-body"><div class="rk-empty">加载中…</div></div>' +
        /* 悬浮放大镜：鼠标放到某张图上时，在旁边放大显示这张图，标签显示在放大图的下方 */
        '<div class="rk-eye-loupe" id="rk-eye-loupe" style="display:none">' +
          '<img id="rk-eye-loupe-img" alt="">' +
          '<div class="rk-eye-loupe-tags" id="rk-eye-loupe-tags"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);
    document.documentElement.classList.add("rk-eye-on");
    bindEye(d);
    applyEyeLabels(d);
    wireEyePpt(d);
    fillEye(d);
    enterEyeFullscreen(d);     /* 真·全屏：占满电脑屏幕；不支持或被拒时自动退化为「占满视口」 */
  }

  /* ---- 天眼 · 真全屏（占满电脑屏幕）---- */
  function eyeFsEl() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
  }
  function enterEyeFullscreen(d) {
    if (eyeFsEl()) return;                      /* 已在全屏中就不再重复请求 */
    try {
      var fn = d.requestFullscreen || d.webkitRequestFullscreen || d.msRequestFullscreen;
      if (!fn) return;
      var p = fn.call(d);
      if (p && p.catch) p.catch(function () { /* 忽略：未获授权时按「占满视口」显示，不影响使用 */ });
    } catch (e) { /* 忽略 */ }
  }
  function exitEyeFullscreen() {
    if (!eyeFsEl()) return;
    try {
      var fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (fn) { var p = fn.call(document); if (p && p.catch) p.catch(function () {}); }
    } catch (e) { /* 忽略 */ }
  }

  function bindEye(d) {
    d.addEventListener("click", function (e) {
      var t = e.target;
      if (t && (t.id === "rk-eye-close" || t.id === "rk-eye-mask")) { closeEye(); return; }
      if (t && t.id === "rk-eye-scope") { EYE_ALL = !EYE_ALL; openEye(); return; }   /* 切换列范围 */
      if (t && t.id === "rk-eye-tag") {                       /* 标签开关：图片上方/下方的标签整条显隐 */
        EYE_LABELS = !EYE_LABELS; saveEyeLabels(); applyEyeLabels(d);
        try { fitEye(d); } catch (e) { /* 重排失败不影响看图 */ }
        return;
      }
      if (t && t.id === "rk-eye-sortsel") return;             /* 排序下拉由自己的 change 处理 */
      if (t && t.id === "rk-eye-ppt") return;                  /* 导出 PPT 由按钮自己的 onclick 处理 */
      if (t && t.closest && t.closest("#rk-eye-loupe")) return; /* 放大镜不参与点击 */
      var card = (t && t.closest) ? t.closest(".rk-card") : null;
      if (card) openLB(card.getAttribute("data-url"));
    });
    /* 鼠标移到某张图上 → 旁边放大显示 + 图下方显示标签；移开即收起 */
    var body = d.querySelector("#rk-eye-body");
    if (body) {
      body.addEventListener("mouseover", function (e) {
        var card = (e.target && e.target.closest) ? e.target.closest(".rk-card") : null;
        if (!card || card === eyeHoverCard) return;
        eyeHoverCard = card;
        showEyeLoupe(d, card);
      });
      body.addEventListener("mouseout", function (e) {
        var card = (e.target && e.target.closest) ? e.target.closest(".rk-card") : null;
        if (!card || card !== eyeHoverCard) return;
        var to = e.relatedTarget;
        if (to && to.closest && to.closest(".rk-card") === card) return;   /* 还在同一张卡片内部移动 */
        eyeHoverCard = null;
        hideEyeLoupe(d);
      });
      body.addEventListener("mouseleave", function () { eyeHoverCard = null; hideEyeLoupe(d); });
    }
    var ssel = d.querySelector("#rk-eye-sortsel");
    if (ssel) {
      ssel.value = SORT;
      ssel.addEventListener("change", function () {
        SORT = ssel.value;
        try { fillEye(d); } catch (e) { /* 排序失败不影响看图 */ }
      });
    }
    document.addEventListener("keydown", eyeEsc);
    eyeFitBound = function () { fitEye(d); };
    window.addEventListener("resize", eyeFitBound);      /* 窗口变化重新铺满 */
    eyeFsBound = function () { fitEye(d); };             /* 进出全屏后视口尺寸变了，重新铺排一次 */
    document.addEventListener("fullscreenchange", eyeFsBound);
    document.addEventListener("webkitfullscreenchange", eyeFsBound);
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
    var built = buildPools(Infinity, { items: R.items, sites: sc.sites, periods: sc.periods, noFoot: true, eager: eager, eye: true });
    var n = 0;
    if (built.html) {
      body.innerHTML = '<div class="rk-pools">' + built.html + '</div>';
      n = body.querySelectorAll(".rk-card").length;
    } else {
      body.innerHTML = '<div class="rk-empty">当前口径下没有可显示的图片</div>';
    }
    var ss = d.querySelector("#rk-eye-sortsel");
    if (ss && ss.value !== SORT) ss.value = SORT;
    if (sub) {
      var colsN = (MODE === "v") ? sc.periods.length : sc.sites.length;
      var scopeTxt = (MODE === "v") ? (R.sites.join("、") || "—") : (R.periods.join("、") || "—");
      var colsTxt = (MODE === "v") ? "周" : "国";
      /* 顶栏只留一行关键信息（类目 / 列数 / 张数）；范围明细收进悬浮提示，
         避免顶栏文字又长又大把图挤掉、甚至盖住图。 */
      sub.innerHTML = esc(CAT) + ' · ' + colsN + ' ' + colsTxt + ' · 共 <b>' + n + '</b> 张' +
        (EYE_PERIOD_CLAMPED ? ' · <span class="rk-eye-dflt">默认只对比最近 ' + EYE_PERIODS_MAX + ' 周</span>' : '') +
        (eager ? '' : ' · <span class="rk-eye-warn">图数过多，已改为随滚动加载</span>');
      sub.title = (MODE === "v" ? "国家：" : "期次：") + scopeTxt;
    }
    if (n) fitEye(d);
  }

  /* ---- 天眼 · 悬浮放大镜（纯图墙的必要补充：信息按需出现）----
     鼠标移到某张图上：在旁边浮出这张图的放大预览，标签贴在放大图的下方；
     移开即收起。放大镜不吃鼠标事件（pointer-events:none），不会打断滑动与点击。 */
  var eyeHoverCard = null;
  function hideEyeLoupe(d) {
    var l = d ? d.querySelector("#rk-eye-loupe") : null;
    if (l) l.style.display = "none";
  }
  function showEyeLoupe(d, card) {
    var l = d.querySelector("#rk-eye-loupe");
    if (!l) return;
    var im = card.querySelector("img");
    var url = card.getAttribute("data-url") || (im ? im.getAttribute("src") : "");
    if (!url) { hideEyeLoupe(d); return; }
    var li = l.querySelector("#rk-eye-loupe-img");
    if (li && li.getAttribute("src") !== url) li.setAttribute("src", url);
    var tb = l.querySelector("#rk-eye-loupe-tags");
    if (tb) {
      var meta = card.getAttribute("data-eye-meta") || "";
      var tags = (card.getAttribute("data-eye-tags") || "").split("|").filter(Boolean);
      var h = "";
      if (meta) h += '<div class="l-meta">' + esc(meta) + '</div>';
      if (tags.length) h += '<div class="l-chips">' + tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join("") + '</div>';
      if (!h) h = '<div class="l-meta">—</div>';
      tb.innerHTML = h;
    }
    l.style.display = "block";
    var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    var LW = Math.max(180, Math.min(340, Math.round(vw * 0.22)));
    var LH = Math.round(LW * 4 / 3) + 54;                    /* 图（3:4）+ 下方标签区 */
    var r = card.getBoundingClientRect();
    var x = r.right + 12;
    if (x + LW > vw - 8) x = r.left - LW - 12;
    if (x < 8) x = Math.max(8, Math.min(r.left, vw - LW - 8));
    var y = r.top;
    if (y + LH > vh - 8) y = Math.max(8, vh - LH - 8);
    l.style.width = LW + "px";
    l.style.left = Math.round(x) + "px";
    l.style.top = Math.round(Math.max(8, y)) + "px";
  }

  /* ---- 天眼 · 导出 PPT（仅超管可见；按钮放在悬浮才显现的顶栏里，不占图、不压图）---- */
  var eyeSuper = null;
  function eyeIsSuper() {
    if (eyeSuper !== null) return Promise.resolve(eyeSuper);
    return Promise.resolve()
      .then(function () { return isSuperAdmin(); })
      .then(function (ok) { eyeSuper = !!ok; return eyeSuper; })
      .catch(function () { eyeSuper = false; return false; });
  }
  function wireEyePpt(d) {
    var b = d.querySelector("#rk-eye-ppt");
    if (!b) return;
    b.onclick = function () {
      if (!window.ReportKit || !window.ReportKit.exportEye) return;
      window.ReportKit.exportEye();
    };
    eyeIsSuper().then(function (ok) { if (ok) b.className = "rk-eye-ppt on"; });
  }

  function eyeEsc(e) {
    if (e.key !== "Escape") return;
    if ($("#rk-lb")) return;              /* 灯箱开着时，先交给灯箱自己的 Esc 处理 */
    closeEye();
  }

  function closeEye() {
    var d = $("#rk-eye");
    if (d && d.parentNode) d.parentNode.removeChild(d);
    eyeHoverCard = null;
    document.documentElement.classList.remove("rk-eye-on");
    document.removeEventListener("keydown", eyeEsc);
    if (eyeFitBound) { window.removeEventListener("resize", eyeFitBound); eyeFitBound = null; }
    if (eyeFsBound) {
      document.removeEventListener("fullscreenchange", eyeFsBound);
      document.removeEventListener("webkitfullscreenchange", eyeFsBound);
      eyeFsBound = null;
    }
    exitEyeFullscreen();       /* 关天眼时一并退出全屏（若本次是由天眼进入的） */
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
    /* 窗口尺寸变化 → 重新按列数与高度铺排对比池 */
    if (!window.__rkPoolFitBound) {
      window.__rkPoolFitBound = true;
      window.addEventListener("resize", fitPoolsSoon);
    }
    try { sessionStorage.setItem("nl_landed", "1"); } catch (e) {}   // 已落地过：避免从榜单点回视觉专区又被弹回来
    if (logged && window.Common && Common.visit) Common.visit.track("rank");   // 访问统计（后台数据看板）

    // 专区可见性守门（两级）：①全站开关（后台「前台访问设置」） ②用户级白名单（后台「权限管理」勾选）
    var vis = null, myz = null;
    try { vis = await SBX.getFrontendZoneVisibility(); } catch (e) { /* 读取失败时照常展示 */ }
    try { myz = await SBX.myFrontendZones(); } catch (e) { myz = null; }
    if (window.Common && Common.zones) {
      Common.zones.setVis(vis || {});
      Common.zones.setMine(Array.isArray(myz) ? myz : null);
      if (Common.zones.applyNav) Common.zones.applyNav(); else Common.zones.renderNav();
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
    /* 后台可以控制哪些国家站点 / 周次在前台展示：整页统一过滤（筛选项、默认值、地区分组、分享链接都跟着走） */
    try { HIDDEN = await SBX.getRankHidden(); } catch (e) { HIDDEN = { sites: [], periods: [] }; }
    HIDDEN = { sites: (HIDDEN && HIDDEN.sites) || [], periods: (HIDDEN && HIDDEN.periods) || [] };
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
    applyHiddenFilter();                       /* 隐藏的站点 / 周次不参与前台筛选 */

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
    applyHiddenFilter();                       /* 地区分组里若含被隐藏的国家，一并摘掉 */

    // URL 参数（后台实时预览 / 分享链接）：mode / size / cat / sites / periods / group
    var _modeFromUrl = false, _urlPickedCols = false;
    try {
      var _qs = new URLSearchParams(location.search);
      var _m = _qs.get("mode"); if (_m === "h" || _m === "v") { if (_m !== MODE) _modeFromUrl = true; MODE = _m; }
      var _z = _qs.get("size"); if (_z === "s" || _z === "m" || _z === "l") SIZE = _z;
      var _c = _qs.get("cat"); if (_c) CAT = _c;
      var _ss = (_qs.get("sites") || "").split(",").filter(function (v) { return v.trim(); });
      if (_ss.length) SEL_SITES = _ss;
      var _g = _qs.get("group");
      if (_g && GROUPS.some(function (x) { return x.name === _g; })) SEL_GROUP = _g;
      var _pp = (_qs.get("periods") || "").split(",").filter(function (v) { return v.trim(); });
      if (_pp.length) { SEL_PERIODS = _pp; if (MODE === "h") MODE = "v"; }
      _urlPickedCols = !!(_ss.length || _pp.length);
    } catch (e) { /* 无参数时忽略 */ }

    /* 分享链接 / 后台预览带的参数里可能含已隐藏项：再收一遍；收空了就回落到默认口径 */
    applyHiddenFilter();
    /* 链接里指定了对比模式、又没点名具体列：按该模式重排列（与手动点「对比模式」一致），
       否则用 mode=h 打开会只剩 1 列，横向对比失去意义 */
    if (_modeFromUrl && !_urlPickedCols) applyCols();
    if (!SEL_SITES.length || !SEL_PERIODS.length) applyCols();

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
    /* 收藏状态（星标点亮 + 分类清单）在榜单渲染完之后再同步一次：
       否则首屏渲染时还不知道哪些图已收藏，星标会全部是空心。 */
    try { await initFav(); } catch (e) { /* 收藏不可用不影响榜单本身 */ }

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

  /* ---------------- 筛选栏：感应收缩 ----------------
   * 收起态只有一行摘要（当前类目 · 周次 · 国家 · 标签），不占版面；
   * 鼠标移到筛选条上（含上方 10px 感应带、下方 8px 过桥带）就自动展开 —— 不用点；
   * 选好「单选类」条件后自动收起；鼠标移开也会延迟收起，手抖不会闪退；
   * 触屏 / 键盘没有悬停：点一下筛选条展开，再点一下收起，Tab 也能进去。 */
  var F_CLOSE_DELAY = 200;    /* 鼠标移开后多久收起 */
  var F_PICK_DELAY = 340;     /* 单选完成后多久收起：留一点时间让用户看清选中态 */
  var _fCloseTimer = null;

  function filterEl() { return $("#rk-filter"); }

  function filterOpen() {
    var f = filterEl();
    if (!f) return;
    if (_fCloseTimer) { clearTimeout(_fCloseTimer); _fCloseTimer = null; }
    f.classList.add("is-open");
  }

  function filterClose(delay) {
    var f = filterEl();
    if (!f) return;
    if (_fCloseTimer) clearTimeout(_fCloseTimer);
    _fCloseTimer = setTimeout(function () {
      _fCloseTimer = null;
      var el = filterEl();
      if (el) el.classList.remove("is-open");
    }, delay == null ? F_CLOSE_DELAY : delay);
  }

  /* 多选类条件不自动收起（横向要多选国家、纵向要多选周次，连着点才对）；
     其余单选类条件点完就收起。 */
  var PICK_ATTRS = "[data-mode],[data-cols],[data-site],[data-period],[data-group],[data-tag],[data-sort],[data-size],[data-move],[data-scope],[data-only]";
  function isMultiPick(el) {
    if (!el || !el.hasAttribute) return false;
    if (el.hasAttribute("data-site")) return MODE !== "v";      /* 横向：国家可多选 */
    if (el.hasAttribute("data-period")) return MODE !== "h";    /* 纵向：周次可多选 */
    return false;
  }

  function bindTrigger() {
    var f = filterEl(), t = $("#rk-trigger");
    if (!f) return;

    /* 悬停感应：只认鼠标 / 触控笔，触屏不要被 pointerenter 抢跑 */
    function byPointer(e) {
      var pt = e.pointerType;
      return !pt || pt === "mouse" || pt === "pen";
    }
    f.addEventListener("pointerenter", function (e) { if (byPointer(e)) filterOpen(); });
    f.addEventListener("pointerleave", function (e) { if (byPointer(e)) filterClose(); });

    /* 点击开合（触屏 / 不想悬停时） */
    if (t) t.addEventListener("click", function () {
      var el = filterEl();
      if (!el) return;
      if (el.classList.contains("is-open")) filterClose(0);
      else filterOpen();
    });

    /* 面板内选完条件：单选类自动收起 */
    f.addEventListener("click", function (e) {
      var node = e.target;
      if (!node || !node.closest) return;
      var chip = node.closest(PICK_ATTRS);
      if (!chip) return;
      if (isMultiPick(chip)) return;
      filterClose(F_PICK_DELAY);
    });

    /* Esc 收起 */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") filterClose(0);
    });

    /* 面板重新渲染（点击后整块重绘）会丢焦点：保证收起态时不会被 focus-within 顶开 */
    if (f.matches(":focus-within") && !f.classList.contains("is-open")) {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();