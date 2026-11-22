/* ============================================================================
 * merge-front.js —— 渠道合并对比（20261123B）
 * ----------------------------------------------------------------------------
 * 页面回答一个问题：**去年同月卖得好的款，今年同月渠道在铺什么。**
 *
 * 摆法（口径写死，不提供「同月」切换）：
 *   · 最左列 = 趋势榜单，永远取「目标月往前一年」的月度榜单（26年X月）；
 *   · 右侧 = 其他渠道（P / T / S），取目标月（27年X月）；
 *   · 其他渠道可在右上角切换「合并 / 拆分」：
 *       合并（默认）→ 一列，P / T / S 的图汇总并去重，整列与趋势算同期比值；
 *       拆分        → 三列，每个渠道各一列，各自与趋势算同期比值。
 *     切换只重算「其他渠道」这一侧，趋势列不动、位置永远在最左。
 *
 * 三条硬约束（照需求定死）：
 *   ① 不新增图库、不写入任何数据 —— 纯只读页面；
 *   ② 不影响原「渠道对比」—— 那边一行代码都没动，配置、列、筛选互不干扰；
 *   ③ 页面怎么显示，导出就长什么样 —— 复用 .rk-pool 结构，
 *      「导出高清图 / 单页网页 / 高清海报」直接认得出这几列。
 *
 * 其它口径：
 *   · 只摆所选月份的图，当月没图就是没图，绝不用别的月份顶替；
 *   · 列的显隐跟随所属专区（后台关掉的专区，它的那一列不出现，图也不参与合计）；
 *   · 类目按「同一个类目」匹配（全路径名与标准名算同一个），显示名原样不改。
 * ==========================================================================*/
(function () {
  "use strict";

  var KEY = "merge";
  var ALL = "全部";

  /* 三个站外渠道：写法差异不影响（SHEIN / shein / S 都认） */
  var CANON = { pinterest: 1, shein: 1, tiktok: 1 };
  /* 固定顺序：P → T → S */
  var CH_ORDER = { pinterest: 1, p: 1, tiktok: 2, t: 2, shein: 3, s: 3 };
  var CH_SHORT = { shein: "S", pinterest: "P", tiktok: "T" };
  /* 每个渠道归属哪个专区（后台关掉这个专区，这一列就不摆、图也不参与合计） */
  var CH_ZONE = { pinterest: "pinterest", tiktok: "tiktok", shein: "shein" };
  var CH_DEFS = [
    { key: "pinterest", short: "P", label: "P 渠道" },
    { key: "tiktok", short: "T", label: "T 渠道" },
    { key: "shein", short: "S", label: "S 渠道" }
  ];
  var RANK_ZONES = ["rank", "rhythm"];

  var $ = function (s) { return document.querySelector(s); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function SBx() { return window.SB || null; }
  function pad2(n) { return String(n).length < 2 ? "0" + n : String(n); }

  /* 其他渠道「合并 / 拆分」：口径以后台配置为准（site_settings.frontend_dims.merge_view），
     浏览器本地只记「允许前台切换时，这个人上次选的是哪个」。 */
  var SPLIT_KEY = "tb.merge.split";
  var viewCfg = { split: false, allowFront: true };   // 后台设定：拆分与否 + 是否允许前台切换
  var localSplit = null;                              // 本浏览器上次的选择（null = 没选过）
  try {
    if (window.localStorage) {
      var lsv = localStorage.getItem(SPLIT_KEY);
      if (lsv === "1") localSplit = true;
      else if (lsv === "0") localSplit = false;
    }
  } catch (e) {}

  var state = {
    chFull: [],        // 三个渠道各自的图（每个渠道内部按「图 + 月」去重）
    merged: [],        // 合并列：三渠道并集，再按「图 + 月」跨渠道去重
    rank: [],          // 趋势榜单（月度榜单里没有渠道归属的行）
    items: [],         // 明细池（用于类目菜单 / 大图信息）
    tags: {},
    tagTried: {},
    months: [],        // 可选的目标月（其他渠道这一侧）
    monthsCh: [],      // 渠道有图的月份
    monthsRk: [],      // 月度榜单有图的月份
    month: null,       // null = 还没选（落到最新月）
    split: false,      // 其他渠道：false = 合并（默认），true = 拆分
    cat: ALL,
    zoneVis: null,
    myZones: null,
    gate: "",
    loading: false,
    rankLoading: false,
    shown: {},
  };
  try { if (window.localStorage && localStorage.getItem(SPLIT_KEY) === "1") state.split = true; } catch (e) {}

  /* 应用后台设定的展示口径：不允许前台切换时，一律按后台那个口径画 */
  function applyMergeView(mv) {
    if (!mv) return;
    viewCfg.split = mv.split === true;
    viewCfg.allowFront = mv.allowFront !== false;
    state.split = viewCfg.allowFront
      ? (localSplit === null ? viewCfg.split : localSplit)
      : viewCfg.split;
  }

  function normMonth(v) {
    var SB = SBx();
    if (SB && typeof SB._normMonth === "function") {
      try { return SB._normMonth(v); } catch (e) { /* 本地兜底 */ }
    }
    var s = String(v || "").trim();
    var m = s.match(/(20\d{2})\D{0,2}(\d{1,2})/);
    return m ? m[1] + "-" + pad2(parseInt(m[2], 10)) : s;
  }

  function imgUrl(u) {
    var s = String(u || "");
    if (!s) return "";
    if (typeof window.imgSrc === "function") return window.imgSrc(s);
    if (/^https?:\/\//i.test(s)) return s;
    var base = String((window.CONFIG && window.CONFIG.WORKER_URL) || "").replace(/\/$/, "");
    return base ? base + "/" + s.replace(/^\/+/, "") : s;
  }
  function thumbOf(u) {
    try { return window.imgThumb ? window.imgThumb(u) : u; } catch (e) { return u; }
  }

  function toast(msg, ok) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "toast show" + (ok === false ? " bad" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = "toast"; }, 2400);
  }

  /* ---------- 渠道名与类目名归一（与渠道对比同一套判定） ---------- */
  function chKey(v) {
    return String(v == null ? "" : v).replace(/[\s_\-]/g, "").toLowerCase();
  }
  /* P / Pinterest 视为同一个渠道，T / TikTok、S / SHEIN 同理 */
  function chCanon(v) {
    var k = chKey(v);
    if (k === "p") return "pinterest";
    if (k === "t") return "tiktok";
    if (k === "s") return "shein";
    return k;
  }
  function chShort(name) { return CH_SHORT[chCanon(name)] || String(name || "").trim(); }
  function shortOf(ck) { return CH_SHORT[ck] || ck; }
  function normCat(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim(); }
  var CAT_SEP = /[，,、＞>｜|;；:：]/;
  function catCompact(v) { return normCat(v).replace(/\s+/g, ""); }
  function catLastSeg(v) {
    var t = normCat(v);
    if (!CAT_SEP.test(t)) return t;
    var parts = t.split(CAT_SEP).map(function (x) { return x.trim(); }).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : t;
  }
  function catSame(a, b) {
    var x = catCompact(a), y = catCompact(b);
    if (!x || !y) return x === y;
    if (x === y) return true;
    if (CAT_SEP.test(String(a))) {
      var la = catCompact(catLastSeg(a));
      if (la.indexOf(y) >= 0 || y.indexOf(la) >= 0) return true;
    }
    if (CAT_SEP.test(String(b))) {
      var lb = catCompact(catLastSeg(b));
      if (lb.indexOf(x) >= 0 || x.indexOf(lb) >= 0) return true;
    }
    return false;
  }
  function catPickLabel(names) {
    var best = "";
    names.forEach(function (n) {
      if (!n) return;
      if (!best) { best = n; return; }
      var bn = catCompact(best), cn = catCompact(n);
      if (cn.length < bn.length || (cn.length === bn.length && n < best)) best = n;
    });
    return best;
  }

  /* ---------- 专区开关 ---------- */
  function zoneOpen(zone) {
    if (!zone) return true;
    if (state.zoneVis && state.zoneVis[zone] === false) return false;
    if (Array.isArray(state.myZones) && state.myZones.length) {
      return state.myZones.indexOf(zone) !== -1;
    }
    return true;
  }
  function anysOpen(list) {
    for (var i = 0; i < list.length; i++) { if (zoneOpen(list[i])) return true; }
    return false;
  }
  function openChMap() {
    var m = {};
    CH_DEFS.forEach(function (d) { if (zoneOpen(CH_ZONE[d.key])) m[d.key] = 1; });
    return m;
  }
  function anyChannelOpen() {
    var any = false;
    CH_DEFS.forEach(function (d) { if (zoneOpen(CH_ZONE[d.key])) any = true; });
    return any;
  }

  /* ---------- 列定义（趋势榜单永远第一列） ---------- */
  function columns() {
    var out = [{ key: "mrg:rank", label: "趋势榜单", type: "rank", zones: RANK_ZONES }];
    if (!state.split) {
      out.push({
        key: "mrg:ch", label: "站外渠道（P · T · S 合计）", type: "channel", ch: "",
        zones: CH_DEFS.map(function (d) { return CH_ZONE[d.key]; }),
      });
    } else {
      CH_DEFS.forEach(function (d) {
        out.push({
          key: "mrg:ch:" + d.key, label: d.label, type: "channel", ch: d.key,
          zones: [CH_ZONE[d.key]],
        });
      });
    }
    return out;
  }
  function colOpen(c) {
    if (!anysOpen(c.zones)) return false;
    /* 拆分视图里，某个渠道「一张图都没有传过」就不必摆一整列空池；
       传过图、只是这个月没有的，仍要摆出来并写明原因（用户要能看出「是没图，不是被删了」）。 */
    if (c.type === "channel" && c.ch) {
      var any = false;
      state.chFull.forEach(function (r) { if (r.chKey === c.ch) any = true; });
      if (!any) return false;
    }
    return true;
  }
  function activeCols() { return columns().filter(colOpen); }

  /* ---------- 写死的口径：趋势榜单永远比其他渠道少一年 ----------
     其他渠道 = 目标月（下拉选的那个月）；趋势榜单 = 目标月往前推 12 个月，月份不变。 */
  function prevYearMonth(m) {
    var s = String(m || "");
    var mt = s.match(/^(20\d{2})-(\d{2})$/);
    if (!mt) return "";
    return (parseInt(mt[1], 10) - 1) + "-" + mt[2];
  }
  function nextYearMonth(m) {
    var s = String(m || "");
    var mt = s.match(/^(20\d{2})-(\d{2})$/);
    if (!mt) return "";
    return (parseInt(mt[1], 10) + 1) + "-" + mt[2];
  }
  function colMonth(c) {
    if (!state.month) return "";
    return c.type === "rank" ? prevYearMonth(state.month) : state.month;
  }

  /* ---------- 同期比值：其他渠道张数 ÷ 同期趋势榜单张数 ---------- */
  function ratioText(n, base) {
    if (!base) return "";
    var v = n / base;
    return "较趋势 ×" + (v >= 10 ? v.toFixed(1) : v.toFixed(2));
  }

  /* 合并列里各渠道各多少张（口径：当前月份 + 当前类目） */
  function chBreakdown(mo) {
    if (!mo) return "";
    var om = openChMap(), out = [];
    CH_DEFS.forEach(function (d) {
      if (!om[d.key]) return;
      var n = state.chFull.filter(function (r) {
        if (r.chKey !== d.key || r.month !== mo) return false;
        if (state.cat === ALL) return true;
        return catSame(r.category, state.cat);
      }).length;
      out.push(d.short + " " + n);
    });
    return out.join(" / ");
  }

  function colMetaText(c, n, base) {
    var m = colMonth(c);
    var parts = [];
    if (c.type === "rank") {
      parts.push("去年同期");
      if (m) parts.push(m);
      parts.push("上新节奏月度榜单");
      return parts.join(" · ");
    }
    parts.push("目标月");
    if (m) parts.push(m);
    if (!c.ch) {
      var b = chBreakdown(m);
      if (b) parts.push(b);
    }
    var r = ratioText(n, base);
    if (r) parts.push(r);
    return parts.join(" · ");
  }

  function emptyNote(c) {
    var m = colMonth(c);
    var hint = nearestHint(c);
    var pre = m ? m + (c.type === "rank" ? "（去年同期）" : "") + " " : "";
    var who = c.type === "rank"
      ? "「上新节奏」的图"
      : (c.ch ? shortOf(c.ch) + " 渠道的图" : "P / T / S 的图");
    return pre + "没有" + who + "（不会用其它月份顶替）" + (hint ? "；" + hint : "");
  }
  /* 空列里说清「这一列到底有没有数据、最近是哪个月」——
     只做说明，绝不拿别的月份顶替（用户口径：没图就不展示）。 */
  function nearestHint(c) {
    var all = c.type === "rank" ? state.rank : (c.ch ? chRowsOf(c.ch) : state.merged);
    var ms = monthsOf(all);
    if (!ms.length) {
      return c.type === "rank"
        ? "库里还没有任何月度榜单数据"
        : (c.ch ? "这个渠道还没有传过图" : "库里还没有 P / T / S 的渠道图");
    }
    return "该列最近有图的月份：" + ms[0];
  }

  function chRowsOf(ck) {
    return state.chFull.filter(function (r) { return r.chKey === ck; });
  }
  function mergedVisible() {
    var om = openChMap();
    return state.merged.filter(function (r) { return om[r.chKey]; });
  }
  function pickMonthCat(list, mo) {
    return list.filter(function (r) {
      if (mo && r.month !== mo) return false;
      if (state.cat === ALL) return true;
      return catSame(r.category, state.cat);
    });
  }
  function colList(c) {
    if (c.type === "rank") return pickMonthCat(state.rank, colMonth(c));
    if (c.ch) return pickMonthCat(chRowsOf(c.ch), state.month);
    return pickMonthCat(mergedVisible(), state.month);
  }

  /* ---------- 取数 ---------- */
  var _tick = null;
  function showLoading() {
    var body = $("#mrg-body");
    if (body) body.innerHTML = '<div class="rk-empty" id="mrg-loading">加载中…</div>';
    var t0 = Date.now();
    if (_tick) clearTimeout(_tick);
    (function tick() {
      var el = $("#mrg-loading");
      if (!el) { _tick = null; return; }
      el.innerHTML = "加载中…" + (Math.round((Date.now() - t0) / 1000) >= 2
        ? "（已 " + Math.round((Date.now() - t0) / 1000) + " 秒）" : "");
      _tick = setTimeout(tick, 1000);
    })();
  }
  function stopLoading() { if (_tick) clearTimeout(_tick); _tick = null; }

  /* ---------- 月份清单 ---------- */
  function monthsOf(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (r) {
      var m = r && r.month;
      if (!m || seen[m]) return;
      seen[m] = 1;
      out.push(m);
    });
    return out.sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
  }
  /* 目标月以「其他渠道有图的月份」为准：
     这一页问的是「这些渠道在这个月铺了什么」，渠道没有数据的月份选了也只能看到空列。
     渠道一张图都没有时，退回按「榜单月份 + 1 年」列目标月，页面仍有内容可看。 */
  function syncTargets() {
    var ms = state.monthsCh.slice();
    if (!ms.length) {
      ms = monthsOf(state.monthsRk.map(function (m) { return nextYearMonth(m); })
        .map(function (m) { return { month: m }; }));
    }
    ms = monthsOf(ms.map(function (m) { return { month: m }; }));
    state.months = ms;
    if (state.month === null || state.month === undefined) { state.month = ms[0] || ""; return; }
    if (state.month && ms.indexOf(state.month) < 0) state.month = ms[0] || "";
  }

  /* ---------- 本地缓存（同一会话内再次打开秒开，随后静默刷新） ---------- */
  var CACHE_KEY = "tb.merge.cache.v2";
  var CACHE_TTL = 5 * 60 * 1000;
  function cacheGet() {
    try {
      if (!window.sessionStorage) return null;
      var raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.ts || (Date.now() - o.ts) > CACHE_TTL) return null;
      if (!Array.isArray(o.chFull) || !Array.isArray(o.merged) || !Array.isArray(o.rank)) return null;
      return o;
    } catch (e) { return null; }
  }
  function cacheSet(chFull, merged, rank) {
    try {
      if (!window.sessionStorage) return;
      var s = JSON.stringify({ ts: Date.now(), chFull: chFull, merged: merged, rank: rank });
      if (s.length > 3 * 1024 * 1024) return;   /* 太大就不缓存，别把本地存储撑爆 */
      window.sessionStorage.setItem(CACHE_KEY, s);
    } catch (e) { /* 缓存失败不影响功能 */ }
  }

  /* ---------- 数据整形 ---------- */
  /* 去重键 = 图片地址 + 月份：跨年同图（去年同月 / 目标月）是两条信息，不能被吃掉；
     同一个月内同一个渠道传了同一张，仍然只留一张。 */
  function dedupKey(u, mo) { return u + "@" + mo; }

  /* 三个渠道的图：每个渠道内部按「图 + 月」去重（拆分视图下每个渠道各算各的） */
  function buildChannels(chRows) {
    var out = [], seen = {};
    (chRows || []).slice().sort(function (a, b) {
      var ka = CH_ORDER[chKey(a.channel)] || 9, kb = CH_ORDER[chKey(b.channel)] || 9;
      return ka - kb;
    }).forEach(function (r) {
      var ck = chCanon(r.channel);
      if (!CANON[ck]) return;                          /* 其它渠道（Amazon、独立站等）不进来 */
      var u = imgUrl(r.image_url);
      if (!u) return;
      var cat = normCat(r.category);
      if (!cat) return;
      var mo = normMonth(r.period_label || r.m || "");
      var k = ck + "|" + dedupKey(u, mo);
      if (seen[k]) return;
      seen[k] = 1;
      out.push({
        image_url: u, category: cat, month: mo,
        site: "", channel: chShort(r.channel), chKey: ck,
        title: String(r.title || ""),
      });
    });
    return out;
  }
  /* 合并列 = 三个渠道的并集，再按「图 + 月」跨渠道去重（同一张图被两个渠道传过只摆一次） */
  function mergeOf(chFull) {
    var out = [], seen = {};
    (chFull || []).forEach(function (r) {
      var k = dedupKey(r.image_url, r.month);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(r);
    });
    return out;
  }
  function seenOf(merged) {
    var seen = {};
    (merged || []).forEach(function (r) { seen[dedupKey(r.image_url, r.month)] = 1; });
    return seen;
  }
  /* 趋势榜单列：月度榜单里没有渠道归属的行（有渠道归属的行属于渠道，与渠道对比同一口径）。
     这一列取的是「去年同月」，与渠道列不是同一个月，所以去重按月份分桶。 */
  function buildRank(rankRows, merged) {
    var rank = [], seenR = {}, skip = seenOf(merged);
    (rankRows || []).forEach(function (r) {
      if (String(r.channel || "").trim()) return;
      var u = imgUrl(r.image_url);
      var mo = normMonth(r.period_label || "");
      var uk = dedupKey(u, mo);
      if (!u || skip[uk] || seenR[uk]) return;
      var cat = normCat(r.category);
      if (!cat) return;
      seenR[uk] = 1;
      rank.push({
        image_url: u, category: cat, month: mo,
        site: String(r.site || ""), title: String(r.title || ""),
        rank: Number(r.rank_abs) || 0,
      });
    });
    /* 榜单项按平台名次升序（没有名次的排在后面，保持原始顺序） */
    rank.sort(function (a, b) {
      var x = a.rank || 1e9, y = b.rank || 1e9;
      return x === y ? 0 : (x < y ? -1 : 1);
    });
    return rank;
  }

  function applyLists(chFull, merged, rank) {
    state.chFull = chFull || [];
    state.merged = merged || [];
    state.rank = rank || [];
    state.items = state.chFull.concat(state.rank);
    state.monthsCh = monthsOf(state.merged);
    state.monthsRk = monthsOf(state.rank);
    syncTargets();
  }

  function repaint() {
    renderFilter();
    renderSwitch();
    renderCats();
    renderPools();
  }

  /* 榜单只取「这一页真的会显示」的月份：每个目标月的去年同月。
     以前是把整张月度表按 1000 行一页扫到底，上万行、几十次串行往返 —— 打开慢的主因。 */
  function rankPeriods() {
    var out = [];
    state.months.forEach(function (m) {
      var p = prevYearMonth(m);
      if (p && out.indexOf(p) < 0) out.push(p);
    });
    return out;
  }
  async function fetchRank(SB) {
    if (typeof SB.listRankItems !== "function") return { rows: [], fail: false };
    var f = {
      periodType: "month",
      cols: "id,image_url,category,period_label,period_type,site,channel,title,rank_abs",
    };
    var ps = rankPeriods();
    if (ps.length) f.periods = ps;
    try { return { rows: (await SB.listRankItems(f)) || [], fail: false }; }
    catch (e) { return { rows: [], fail: true }; }
  }

  async function load() {
    var SB = SBx();
    if (!SB || state.loading) return;
    state.loading = true;

    /* ① 同一会话内再打开：先用上次结果把页面铺出来，随后静默刷新（不再空等取数） */
    var cached = cacheGet();
    if (cached) {
      state.rankLoading = false;
      applyLists(cached.chFull, cached.merged, cached.rank);
      repaint();
    } else {
      showLoading();
    }

    try {
      /* ② 渠道图先取：体积小，且决定了「可选月份」——取到就先把列和筛选铺出来 */
      var chRows = [], chFail = false;
      try {
        if (typeof SB.listRankChannelPics === "function") {
          chRows = (await SB.listRankChannelPics({ periodType: "month" })) || [];
        }
      } catch (e) { chRows = []; chFail = true; }

      /* 读取失败（不是「确实没有图」）时保留缓存里的内容，别把已铺好的页面清空 */
      var chFull = buildChannels(chRows);
      if (chFail && state.chFull.length) chFull = state.chFull;
      var merged = mergeOf(chFull);
      state.tags = {};
      state.tagTried = {};
      /* 榜单列还没有任何数据时才算「读取中」，避免已有数据闪成加载态 */
      state.rankLoading = !state.rank.length;
      applyLists(chFull, merged, state.rank);
      repaint();

      /* ③ 榜单只取需要的月份（每个目标月的去年同月） */
      var rk = await fetchRank(SB);
      state.rankLoading = false;
      var rank = buildRank(rk.rows, merged);
      if (rk.fail && state.rank.length) rank = state.rank;
      applyLists(chFull, merged, rank);
      repaint();

      cacheSet(state.chFull, state.merged, state.rank);
    } catch (e) {
      if (!state.merged.length && !state.rank.length) {
        var body = $("#mrg-body");
        if (body) body.innerHTML = '<div class="rk-empty">读取失败，请刷新重试</div>';
      }
    } finally {
      stopLoading();
      state.loading = false;
    }
  }

  /* ---------- 筛选（只有月度：两列/四列的月份由「目标月」一个值推出来） ---------- */
  function renderFilter() {
    var box = $("#mrg-groups");
    if (!box) return;
    box.innerHTML = "";
    var g = document.createElement("div");
    g.className = "tag-group";
    var name = document.createElement("div");
    name.className = "tag-group-name";
    name.textContent = "目标月（其他渠道）";
    var chips = document.createElement("div");
    chips.className = "tag-chips";
    function chip(v) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tag-chip" + (state.month === v ? " active" : "");
      b.textContent = v;
      b.onclick = function () {
        state.month = v;
        state.cat = ALL;      /* 换月后类目回到「全部」，避免「这个月什么都没有」的误判 */
        state.shown = {};
        renderFilter(); renderCats(); renderPools(); syncSummary();
      };
      return b;
    }
    if (!state.months.length) {
      var t = document.createElement("span");
      t.className = "tag-chip";
      t.style.opacity = ".55";
      t.textContent = "暂无月份";
      chips.appendChild(t);
    }
    state.months.forEach(function (m) { chips.appendChild(chip(m)); });
    g.appendChild(name);
    g.appendChild(chips);
    box.appendChild(g);

    /* 口径写死：趋势榜单永远比目标月少一年 */
    var tip = document.createElement("div");
    tip.className = "tag-group-name mrg-sync-tip";
    var tg = state.month || "";
    var rf = prevYearMonth(tg);
    var nRk = 0, nCh = 0;
    if (tg) {
      nRk = state.rank.filter(function (r) {
        return r.month === rf && (state.cat === ALL || catSame(r.category, state.cat));
      }).length;
      nCh = mergedVisible().filter(function (r) {
        return r.month === tg && (state.cat === ALL || catSame(r.category, state.cat));
      }).length;
    }
    tip.textContent = "口径写死：目标月 " + (tg || "—") + " 看其他渠道在铺什么（P / T / S " + nCh +
      " 张）；趋势榜单固定取去年同月 " + (rf || "—") + "（" + nRk + " 张）—— 永远少一年，不提供同月切换。";
    box.appendChild(tip);

    syncSummary();
  }

  function syncSummary() {
    var sum = $("#mrg-summary");
    if (!sum) return;
    var cols = activeCols();
    var closed = columns().length - cols.length;
    sum.textContent = "目标月 " + (state.month || "未选") +
      " / 去年同期 " + (prevYearMonth(state.month) || "未选") +
      " · " + cols.length + " 列 · 其他渠道" + (state.split ? "拆分" : "合并") +
      (closed ? "（另有 " + closed + " 列因其专区已在后台关闭而未显示）" : "");
  }

  /* ---------- 右上角：其他渠道「合并 / 拆分」 ---------- */
  function renderSwitch() {
    var box = $("#mrg-switch");
    if (!box) return;
    box.innerHTML = "";
    /* 后台把「允许前台切换」关掉时，前台不出现这个按钮 —— 一律按后台口径画 */
    if (viewCfg.allowFront === false) { box.classList.add("hidden"); return; }
    if (!anyChannelOpen()) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    var lab = document.createElement("span");
    lab.className = "mrg-seg-name";
    lab.textContent = "其他渠道";
    box.appendChild(lab);
    [["merge", "合并"], ["split", "拆分"]].forEach(function (p) {
      var on = (p[0] === "split") === !!state.split;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mrg-seg-btn" + (on ? " active" : "");
      b.textContent = p[1];
      b.title = p[0] === "split"
        ? "P / T / S 各占一列，各自与趋势榜单算同期比值"
        : "P / T / S 合成一列（合计、去重），整列与趋势榜单算同期比值";
      b.onclick = function () {
        var want = p[0] === "split";
        if (want === !!state.split) return;
        state.split = want;
        try { if (window.localStorage) localStorage.setItem(SPLIT_KEY, want ? "1" : "0"); } catch (e) {}
        state.shown = {};
        renderSwitch();
        renderFilter();
        renderPools();
        syncSummary();
      };
      box.appendChild(b);
    });
  }

  /* ---------- 左侧类目菜单 ---------- */
  function monthItems() {
    if (!state.month) return state.items;
    var ref = prevYearMonth(state.month);
    var out = state.chFull.filter(function (r) { return r.month === state.month; });
    state.rank.forEach(function (r) { if (r.month === ref) out.push(r); });
    return out;
  }
  function renderCats() {
    var nav = $("#mrg-cats");
    if (!nav) return;
    var list = monthItems();
    var groups = [];
    list.forEach(function (r) {
      var c = normCat(r.category);
      if (!c) return;
      for (var i = 0; i < groups.length; i++) {
        if (catSame(groups[i].names[0], c)) { groups[i].names.push(c); groups[i].count++; return; }
      }
      groups.push({ names: [c], count: 1 });
    });
    groups = groups.map(function (g) {
      return { label: catPickLabel(g.names), count: g.count };
    }).sort(function (a, b) { return b.count - a.count; });

    nav.innerHTML = "";
    function add(name, count) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cat-menu-item" + (state.cat === name ? " active" : "");
      b.innerHTML = esc(name) + (count != null ? ' <span class="cvi-state">' + count + "</span>" : "");
      b.onclick = function () { state.cat = name; state.shown = {}; renderCats(); renderPools(); };
      nav.appendChild(b);
    }
    add(ALL, list.length);
    if (!groups.length) {
      var t = document.createElement("div");
      t.className = "cat-menu-tip";
      t.textContent = "暂无类目";
      nav.appendChild(t);
      return;
    }
    groups.forEach(function (g) { add(g.label, g.count); });
  }

  /* ---------- 每行几张：与趋势上升榜同一套算法（列宽 ÷ 目标卡宽） ---------- */
  function perRowOf(n, containerW) {
    var cg = window.CardGrid;
    var W = Number(containerW) || 0;
    if (!W) { var host = $("#mrg-body"); W = host ? host.clientWidth || 0 : 0; }
    if (W > 0 && n > 0 && cg && cg.cols) {
      var colW = (W - (n - 1) * 10) / n - 22;
      var c = cg.cols(colW);
      if (c) return c;
    }
    if (n <= 2) return 6;
    if (n === 3) return 4;
    return 3;
  }
  function fitPools() {
    var body = $("#mrg-body");
    if (!body) return;
    var cg = window.CardGrid;
    var grids = body.querySelectorAll(".rk-pool-grid");
    var read = [];
    for (var i = 0; i < grids.length; i++) read.push({ el: grids[i], w: grids[i].clientWidth || 0 });
    for (var j = 0; j < read.length; j++) {
      if (!read[j].w) continue;
      var n = read[j].el.querySelectorAll(".rk-card").length;
      var c = (cg && cg.cols) ? cg.cols(read[j].w) : 0;
      if (!c) continue;
      if (n) c = Math.min(c, Math.max(1, n));
      read[j].el.style.setProperty("--rk-r", String(c));
    }
  }
  var _fit = null;
  function fitPoolsSoon() {
    if (_fit) clearTimeout(_fit);
    _fit = setTimeout(function () { _fit = null; try { fitPools(); } catch (e) {} }, 50);
  }
  if (window && typeof window.addEventListener === "function") {
    window.addEventListener("resize", fitPoolsSoon);
    window.addEventListener("load", fitPoolsSoon);
    window.addEventListener("cardgrid:size", function () {
      if (_fit) clearTimeout(_fit);
      _fit = setTimeout(function () { _fit = null; try { fitPools(); } catch (e) {} }, 0);
    });
    try { if (window.CardGrid && window.CardGrid.onChange) window.CardGrid.onChange(fitPools); } catch (e) {}
  }

  /* ---------- 池子（趋势榜单在左，其他渠道在右，可合并可拆分） ---------- */
  var FIRST_PAGE = 96, MORE_PAGE = 96, MAX_PAGE = 288;
  function shownKey(c, list) {
    return c.key + "|" + (colMonth(c) || "*") + "|" + state.cat + "|" + (list ? list.length : 0);
  }
  function shownOf(c, list) {
    var n = state.shown[shownKey(c, list)] || FIRST_PAGE;
    return Math.min(n, list.length, MAX_PAGE);
  }
  function renderPools() {
    var body = $("#mrg-body");
    if (!body) return;
    var cols = activeCols();

    /* 同期比值的分母：趋势榜单这一列的张数（同一类目口径） */
    var rankCol = null;
    cols.forEach(function (c) { if (!rankCol && c.type === "rank") rankCol = c; });
    var base = rankCol ? colList(rankCol).length : 0;

    var lists = cols.map(function (c) {
      return {
        col: c,
        list: colList(c),
        loading: (c.type === "rank" && state.rankLoading),
      };
    });
    var total = 0;
    lists.forEach(function (x) { total += x.list.length; });

    var info = $("#mrg-bar-info");
    if (info) {
      var barTxt = "共 <b>" + total + "</b> 张 · " + cols.length + " 列 · 目标月 " +
        esc(state.month || "—") + " / 去年同期 " + esc(prevYearMonth(state.month) || "—") +
        " · 其他渠道：" + (state.split ? "拆分" : "合并");
      if (state.cat !== ALL) barTxt += " · " + esc(state.cat);
      if (state.loading) barTxt += ' · <span class="rk-bar-loading">刷新中…</span>';
      info.innerHTML = barTxt;
    }

    if (!cols.length) {
      body.innerHTML = '<div class="rk-empty">榜单（趋势上升榜 / 上新节奏）与 P / S / T 专区都在后台关闭了或你的账号未获授权，' +
        "这一页没有可对比的列。<br>想看到它们，请让超管在后台「前台访问设置」里开启任一个。</div>";
      return;
    }

    var pr = perRowOf(cols.length, body.clientWidth || 0);
    var html = '<div class="rk-pools">';
    lists.forEach(function (x) {
      var s = x.col, list = x.list;
      var page = x.loading ? 0 : shownOf(s, list);
      var meta = colMetaText(s, list.length, base);
      html += '<section class="rk-pool" data-src="' + esc(s.key) + '">';
      html += '<div class="rk-pool-head"><div class="rk-pool-name"><span>' + esc(s.label) +
        '</span><span class="rk-n">' + (x.loading ? "读取中" : list.length + " 张") + "</span></div>" +
        '<div class="rk-pool-meta">' + esc(meta) + "</div></div>";
      html += '<div class="rk-pool-grid" style="--rk-r:' + pr + '">';
      if (x.loading) {
        html += '<div class="rk-empty">正在读取「趋势榜单」的图…</div>';
      } else if (!list.length) {
        html += '<div class="rk-empty">' + esc(emptyNote(s)) + "</div>";
      } else {
        list.slice(0, page).forEach(function (it) {
          html += '<figure class="rk-card cmp-card" data-url="' + esc(it.image_url) + '" title="' +
            esc([it.category, it.month, it.channel].filter(Boolean).join(" · ")) + '">' +
            '<img loading="lazy" decoding="async" src="' + esc(thumbOf(it.image_url)) +
            '" data-full="' + esc(it.image_url) + '" alt="' + esc(it.category) + '">' +
            "</figure>";
        });
      }
      html += "</div>";
      if (!x.loading && list.length > page) {
        var left = page >= MAX_PAGE ? 0 : list.length - page;
        html += '<div class="rk-more-wrap"><button type="button" class="rk-loadmore" data-more="' +
          esc(shownKey(s, list)) + '">' +
          (left ? "展开更多（已展示 " + page + " / " + list.length + "）" : "已展示 " + page + " / " + list.length + " 张") +
          "</button></div>";
      }
      html += "</section>";
    });
    html += "</div>";
    body.innerHTML = html;

    Array.prototype.forEach.call(body.querySelectorAll(".cmp-card"), function (fig) {
      fig.onclick = function () { openModal(fig.getAttribute("data-url")); };
    });
    Array.prototype.forEach.call(body.querySelectorAll("[data-more]"), function (btn) {
      btn.onclick = function () {
        var k = btn.getAttribute("data-more") || "";
        if (!k) return;
        state.shown[k] = Math.min((state.shown[k] || FIRST_PAGE) + MORE_PAGE, MAX_PAGE);
        renderPools();
      };
    });
    fitPools();
    fitPoolsSoon();
    renderSyncBar();
  }

  /* ---------- 同期摘要条：两列各多少张、比值多少、去年同月好卖的是哪几个类目 ---------- */
  function topCats(list, n) {
    var cnt = {}, order = [];
    list.forEach(function (r) {
      var c = r.category || "未分类";
      if (!cnt[c]) { cnt[c] = 0; order.push(c); }
      cnt[c]++;
    });
    order.sort(function (a, b) { return cnt[b] - cnt[a]; });
    return order.slice(0, n || 3).map(function (c) { return c + " " + cnt[c]; });
  }
  function renderSyncBar() {
    var el = $("#mrg-sync-bar");
    if (!el) return;
    if (!state.month) { el.innerHTML = ""; el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    var target = state.month, ref = prevYearMonth(target);
    var rkList = state.rank.filter(function (r) {
      return r.month === ref && (state.cat === ALL || catSame(r.category, state.cat));
    });
    var chList = mergedVisible().filter(function (r) {
      return r.month === target && (state.cat === ALL || catSame(r.category, state.cat));
    });
    var tCats = topCats(chList, 3), rCats = topCats(rkList, 3);
    var ratio = ratioText(chList.length, rkList.length);
    var bd = chBreakdown(target);
    var html = '<div class="mrg-sync-row">' +
      '<span class="mrg-sync-k">去年同期 ' + esc(ref || "—") + "</span>" +
      '<span class="mrg-sync-v">趋势榜单 <b>' + rkList.length + "</b> 张" +
      (rCats.length ? " · TOP：" + esc(rCats.join("、")) : "") + "</span>" +
      "</div>" +
      '<div class="mrg-sync-row">' +
      '<span class="mrg-sync-k">目标月 ' + esc(target) + "</span>" +
      '<span class="mrg-sync-v">其他渠道 <b>' + chList.length + "</b> 张" +
      (bd ? "（" + esc(bd) + "）" : "") +
      (ratio ? " · " + esc(ratio) : "") +
      (tCats.length ? " · TOP：" + esc(tCats.join("、")) : "") + "</span>" +
      "</div>" +
      '<div class="mrg-sync-row mrg-sync-hint">先看去年同月这一类目卖什么，再看渠道这个月有没有同款／同风格，' +
      "按 2 个月备货周期反推现在该上什么。</div>";
    el.innerHTML = html;
  }

  /* ---------- 大图 + 打标（点哪张只查哪张，不挡首屏） ---------- */
  var GROUPS = [
    ["风格", ["style_tags"]], ["视觉", ["visual_tags"]], ["图案类型", ["pattern_tags"]],
    ["图案元素", ["element_tags"]], ["结构部件", ["struct_tags"]], ["面料", ["fabric_tags"]],
    ["二次工艺", ["craft_tags"]], ["拍摄方式", ["shoot_tags"]], ["模特", ["skin_tags"]],
    ["版型", ["fit_tags"]], ["文化背景", ["culture_tags"]], ["消费心理", ["psych_tags"]],
    ["节日", ["festival_tags"]]
  ];

  async function fetchTags(urls) {
    var SB = SBx();
    var list = (urls || []).filter(function (u) { return u && !state.tagTried[u]; });
    if (!SB || !list.length) return;
    list.forEach(function (u) { state.tagTried[u] = 1; });
    try {
      var got = null;
      if (typeof SB.listMovementTags === "function") got = await SB.listMovementTags(list);
      else if (typeof SB.listImageTags === "function") got = await SB.listImageTags(list);
      if (got) Object.keys(got).forEach(function (u) { state.tags[u] = got[u]; });
    } catch (e) { /* 读不到标签不影响看图 */ }
  }

  function openModal(url) {
    if (!url) return;
    paintModal(url);
    if (!state.tagTried[url]) fetchTags([url]).then(function () { paintModal(url); });
  }

  function paintModal(url) {
    var t = state.tags[url] || {};
    var big = $("#mrg-big");
    if (big) big.src = url;
    var it = state.items.filter(function (r) { return r.image_url === url; })[0] || {};
    var title = $("#mrg-title");
    if (title) title.textContent = [it.category, it.month, it.channel].filter(Boolean).join(" · ") || "大图";
    var box = $("#mrg-tags");
    if (!box) return;
    box.innerHTML = "";
    var any = false;
    GROUPS.forEach(function (g) {
      var vals = [];
      g[1].forEach(function (f) {
        (t[f] || []).forEach(function (v) { if (vals.indexOf(v) < 0) vals.push(v); });
      });
      if (!vals.length) return;
      any = true;
      var row = document.createElement("div");
      row.className = "mv-tag-row";
      row.innerHTML = '<div class="mv-tag-k">' + esc(g[0]) + '</div><div class="mv-tag-v">' +
        vals.map(function (v) { return '<span class="mv-chip">' + esc(v) + "</span>"; }).join("") + "</div>";
      box.appendChild(row);
    });
    if (!any) box.innerHTML = '<div class="mv-empty-tag">这张图还没有打标</div>';
    var m = $("#mrg-modal");
    if (m) m.classList.remove("hidden");
  }
  function closeModal() {
    var m = $("#mrg-modal");
    if (m) m.classList.add("hidden");
  }

  function bind() {
    var c = $("#mrg-close");
    if (c) c.onclick = closeModal;
    var m = $("#mrg-modal");
    if (m) m.onclick = function (e) { if (e.target === m) closeModal(); };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    bind();
    var SB = SBx();
    var logged = false;
    try {
      var sess = (SB && typeof SB.getSession === "function") ? await SB.getSession() : null;
      if (sess && sess.user) {
        logged = true;
        var u = $("#mrg-user");
        if (u) { u.textContent = sess.user.email || ""; u.classList.remove("hidden"); }
        var li = $("#mrg-login"); if (li) li.classList.add("hidden");
      }
      var lo = $("#mrg-logout");
      if (lo) {
        lo.classList.toggle("hidden", !logged);
        lo.onclick = async function () { try { await SB.signOut(); } catch (e) {} location.href = "index.html"; };
      }
      if (!logged) {
        var li2 = $("#mrg-login"); if (li2) li2.classList.remove("hidden");
        location.replace("index.html");
        return;
      }
    } catch (e) { /* 拿不到会话也继续尝试渲染 */ }

    try {
      if (window.Common && Common.zones && Common.zones.loadDefs) await Common.zones.loadDefs();
      var vis = null, myz = null;
      try { vis = await SB.getFrontendZoneVisibility(); } catch (e) { vis = null; }
      try { myz = await SB.myFrontendZones(); } catch (e) { myz = null; }
      state.zoneVis = vis || null;
      state.myZones = Array.isArray(myz) ? myz : null;
      if (window.Common && Common.zones) {
        Common.zones.setVis(vis || {});
        Common.zones.setMine(Array.isArray(myz) ? myz : null);
        if (Common.zones.applyNav) Common.zones.applyNav();
      }
      /* 20261124A：本页改为独立授权 —— 「渠道合并对比」现在是权限管理里可以单独勾选的专区。
         关掉它只影响这一页，不动「渠道对比」的任何权限（两者互不牵连）。 */
      var selfOk = true;
      if (vis && vis.merge === false) selfOk = false;
      else if (Array.isArray(myz) && myz.length && myz.indexOf("merge") === -1) selfOk = false;
      /* 其次才看来源专区：全关或全无授权时，这一页也没有可对比的内容 */
      var anyDep = ["rank", "rhythm", "pinterest", "shein", "tiktok"].some(function (z) {
        if (vis && vis[z] === false) return false;
        if (Array.isArray(myz) && myz.length && myz.indexOf(z) === -1) return false;
        return true;
      });
      if (!selfOk) state.gate = "「渠道合并对比」这个专区当前未对你开放，请联系管理员在「权限管理 → 前台可见专区」里勾上（不影响你查看「渠道对比」）。";
      else if (!anyDep) state.gate = "本页的数据来自「趋势上升榜 / 上新节奏 / P / S / T 专区」，这些专区当前都未对你开放。";
      /* 展示口径（合并 / 拆分）以后台配置为准 */
      try {
        var mv = (SB && typeof SB.getMergeView === "function") ? await SB.getMergeView() : null;
        applyMergeView(mv);
      } catch (e1) { /* 读不到就用默认：合并、允许前台切换 */ }
      if (window.Common && Common.visit) { try { Common.visit.track(KEY); } catch (e0) {} }
    } catch (e) { /* 导航显隐失败不影响展示 */ }

    var tabs = document.querySelector(".top-tabs");
    if (tabs) tabs.classList.remove("is-booting");

    if (state.gate) {
      var cats = $("#mrg-cats");
      if (cats) cats.innerHTML = '<div class="cat-menu-tip">未开放</div>';
      $("#mrg-body").innerHTML = '<div class="rk-empty">' + esc(state.gate) + "</div>";
      var bar0 = $("#mrg-bar-info");
      if (bar0) bar0.innerHTML = "";
      var sw0 = $("#mrg-switch");
      if (sw0) sw0.classList.add("hidden");
      return;
    }
    await load();
  }

  window.__tbReload = function () { return load(); };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
