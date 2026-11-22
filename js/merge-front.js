/* ============================================================================
 * merge-front.js —— 渠道合并对比（20261122B）
 * ----------------------------------------------------------------------------
 * 需求：新增一个前台专区，摆法与原「渠道对比」不同，但数据完全复用它。
 *   · 左列：P / T / S 三个渠道的图**合并成一列**（不再一个渠道一列）
 *   · 右列：上新节奏（月度榜单）的图
 *
 * 三条硬约束（照需求定死）：
 *   ① 不新增图库、不写入任何数据 —— 纯只读页面；
 *   ② 不影响原「渠道对比」—— 那边一行代码都没动，配置、列、筛选互不干扰；
 *   ③ 页面怎么显示，导出就长什么样 —— 沿用全站那套导出（复用 .rk-pool 结构，
 *      「导出高清图 / 单页网页 / 高清海报」直接认得出这两列）。
 *
 * 口径与渠道对比保持一致：
 *   · 只摆所选月份的图，当月没图就是没图，绝不用别的月份顶替；
 *   · 列的显隐跟随所属专区（后台关掉的专区，它的那一列不出现）；
 *   · 类目按「同一个类目」匹配（全路径名与标准名算同一个），显示名原样不改。
 * ==========================================================================*/
(function () {
  "use strict";

  var KEY = "merge";
  var ALL = "全部";

  /* 合并列包含哪些渠道（写法差异不影响：SHEIN / Shein / shein 都认） */
  var MERGE_CHANNELS = { pinterest: 1, shein: 1, tiktok: 1, p: 1, s: 1, t: 1 };
  /* 显示顺序：P → T → S（需求里就是这么念的） */
  var CH_ORDER = { pinterest: 1, p: 2, shein: 3 };
  var CH_SHORT = { shein: "S", pinterest: "P", tiktok: "T" };

  var $ = function (s) { return document.querySelector(s); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function SBx() { return window.SB || null; }
  function pad2(n) { return String(n).length < 2 ? "0" + n : String(n); }

  /* 20261122B · 同期对比的开关记在本浏览器，刷新后保持上次选的口径 */
  var SYNC_KEY = "tb.merge.sync";

  var state = {
    merged: [],        // 左列：P / T / S 合并后的图
    rank: [],          // 右列：上新节奏（月度榜单）
    items: [],         // 两列并集（用于类目 / 月份清单）
    tags: {},
    tagTried: {},
    months: [],        // 可选的目标月（20261123A 起：以渠道数据为准）
    monthsCh: [],      // P / T / S 有图的月份
    monthsRk: [],      // 上新节奏有图的月份
    month: null,       // null = 还没选（落到最新月）；"" = 全部月份
    /* 20261122B · 同期对比：关（默认）= 两列都取所选月；开 = 榜单取「去年同月」，渠道取「所选月」 */
    sync: false,
    cat: ALL,
    zoneVis: null,
    myZones: null,
    gate: "",
    loading: false,
    /* 20261123A：右列还在取数时，不能把「加载中」说成「这个月没有图」 */
    rankLoading: false,
    /* 20261123A：每列「展开更多」已经画到第几张（按 列+月份+类目 分别记） */
    shown: {},
  };
  try { if (window.localStorage && localStorage.getItem(SYNC_KEY) === "1") state.sync = true; } catch (e) {}

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
  function chShort(name) {
    var k = chKey(name);
    return CH_SHORT[k] || String(name || "").trim();
  }
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
  var CH_ZONES = ["pinterest", "shein", "tiktok"];
  var RANK_ZONES = ["rank", "rhythm"];
  function anysOpen(list) {
    for (var i = 0; i < list.length; i++) { if (zoneOpen(list[i])) return true; }
    return false;
  }

  /* 两列的定义：内置、固定两列，不读后台对比列配置（那边改配置不影响这里） */
  var COLS = [
    { key: "mrg:ch", label: "站外合并（P · T · S）", type: "channel", zones: CH_ZONES },
    { key: "mrg:rank", label: "上新节奏", type: "rank", zones: RANK_ZONES },
  ];

  function colOpen(c) { return anysOpen(c.zones); }
  function activeCols() { return COLS.filter(colOpen); }

  /* ---------- 同期对比：月份错位一年 ----------
     目标月 = 渠道列用的月份（如 2027-01），
     参考月 = 上新节奏列用的月份（目标月往前推一年，如 2026-01）。
     这样一屏里就是「去年同月实际好卖的款」对「今年同月渠道在铺的款」。 */
  function prevYearMonth(m) {
    var s = String(m || "");
    var mt = s.match(/^(20\d{2})-(\d{2})$/);
    if (!mt) return "";
    return (parseInt(mt[1], 10) - 1) + "-" + mt[2];
  }
  /* 这一列在当前口径下实际取哪个月 */
  function colMonth(c) {
    if (!state.month) return "";
    if (!state.sync) return state.month;
    return c.type === "rank" ? prevYearMonth(state.month) : state.month;
  }
  function colMetaText(c) {
    var m = colMonth(c);
    if (state.sync) {
      return (c.type === "rank" ? "去年同期" : "目标月") + (m ? " · " + m : "");
    }
    return (c.type === "rank" ? "月度榜单" : "P / T / S 合并") + (m ? " · " + m : "");
  }
  function emptyNote(c) {
    var m = colMonth(c);
    var hint = nearestHint(c);
    if (c.type === "rank") {
      return (m ? m + (state.sync ? "（去年同期）" : "") + " " : "") +
        "没有「上新节奏」的图（不会用其它月份顶替）" + (hint ? "；" + hint : "");
    }
    return (m ? m + " " : "") + "没有 P / T / S 的图（不会用其它月份顶替）" + (hint ? "；" + hint : "");
  }
  /* 空列里说清「这一列到底有没有数据、最近是哪个月」——
     只做说明，绝不拿别的月份顶替（用户口径：没图就不展示）。 */
  function nearestHint(c) {
    var all = c.type === "rank" ? state.rank : state.merged;
    var ms = monthsOf(all);
    if (!ms.length) {
      return c.type === "rank"
        ? "库里还没有任何月度榜单数据"
        : "库里还没有 P / T / S 的渠道图";
    }
    return "该列最近有图的月份：" + ms[0];
  }

  function colList(c) {
    var all = c.type === "rank" ? state.rank : state.merged;
    var list = all.filter(function (r) {
      if (state.cat === ALL) return true;
      return catSame(r.category, state.cat);
    });
    var mo = colMonth(c);
    if (!mo) return list;
    return list.filter(function (r) { return r.month === mo; });
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
  /* 目标月以「渠道有图的月份」为准：
     这一页要回答的是「这些渠道在这个月铺了什么」，渠道没有数据的月份选了也只能看到两个空池，
     所以月份清单只列渠道有图的月份；渠道一张图都没有时，退回按榜单月份列（页面仍有内容可看）。 */
  function syncMonthPick() {
    var ms = state.monthsCh.length ? state.monthsCh : state.monthsRk;
    state.months = ms;
    if (state.month === null || state.month === undefined) { state.month = ms[0] || ""; return; }
    if (state.month && ms.indexOf(state.month) < 0) state.month = ms[0] || "";
    if (state.sync && !state.month) state.month = ms[0] || "";
  }

  /* ---------- 本地缓存（同一会话内再次打开秒开，随后静默刷新） ---------- */
  var CACHE_KEY = "tb.merge.cache.v1";
  var CACHE_TTL = 5 * 60 * 1000;
  function cacheGet() {
    try {
      if (!window.sessionStorage) return null;
      var raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.ts || (Date.now() - o.ts) > CACHE_TTL) return null;
      if (!Array.isArray(o.merged) || !Array.isArray(o.rank)) return null;
      return o;
    } catch (e) { return null; }
  }
  function cacheSet(merged, rank) {
    try {
      if (!window.sessionStorage) return;
      var s = JSON.stringify({ ts: Date.now(), merged: merged, rank: rank });
      if (s.length > 3 * 1024 * 1024) return;   /* 太大就不缓存，别把本地存储撑爆 */
      window.sessionStorage.setItem(CACHE_KEY, s);
    } catch (e) { /* 缓存失败不影响功能 */ }
  }

  /* ---------- 数据整形 ---------- */
  /* 去重键 = 图片地址 + 月份：同期对比下同一张图出现在「去年同月」与「目标月」是两条信息，
     不能被当成重复吃掉；同一个月份内多个渠道传了同一张，仍然只摆一次。 */
  function dedupKey(u, mo) { return u + "@" + mo; }
  /* 左列：只收 P / T / S 三个渠道的图，并按「图片地址 + 月份」去重
     （20261122B：去重的桶里带上月份 —— 同期对比下同一张图出现在去年同月与目标月是两条信息，
      不能被当成重复吃掉；同月内多个渠道传了同一张，仍然只摆一次） */
  function buildMerged(chRows) {
    var merged = [], seenU = {};
    (chRows || []).slice().sort(function (a, b) {
      var ka = CH_ORDER[chKey(a.channel)] || 9, kb = CH_ORDER[chKey(b.channel)] || 9;
      return ka - kb;
    }).forEach(function (r) {
      var ck = chKey(r.channel);
      if (!MERGE_CHANNELS[ck]) return;                 /* 其它渠道（Amazon、独立站等）不进合并列 */
      var u = imgUrl(r.image_url);
      if (!u) return;
      var cat = normCat(r.category);
      if (!cat) return;
      var mo = normMonth(r.period_label || r.m || "");
      var uk = dedupKey(u, mo);
      if (seenU[uk]) return;
      seenU[uk] = 1;
      merged.push({
        image_url: u, category: cat,
        month: mo,
        site: "", channel: chShort(r.channel), title: String(r.title || ""),
      });
    });
    return merged;
  }
  function seenOf(merged) {
    var seenU = {};
    (merged || []).forEach(function (r) { seenU[dedupKey(r.image_url, r.month)] = 1; });
    return seenU;
  }
  /* 右列：月度榜单行（有渠道归属的行属于渠道，不进榜单列，与渠道对比同一口径）。
     20261122B：同期对比时这一列取「去年同月」，与渠道列不是同一个月，
     所以去重也按月份分桶，不能因为「渠道里也有这张图」就把它从榜单里摘掉。 */
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
        image_url: u, category: cat,
        month: mo,
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

  function applyLists(merged, rank) {
    state.merged = merged || [];
    state.rank = rank || [];
    state.items = state.merged.concat(state.rank);
    state.monthsCh = monthsOf(state.merged);
    state.monthsRk = monthsOf(state.rank);
    syncMonthPick();
  }

  function repaint() {
    renderFilter();
    renderCats();
    renderPools();
  }

  /* 榜单只取「这一页真的会显示」的月份：
     目标月（渠道有图的月份）＋它的去年同月（同期对比用）。
     以前是把整张月度表按 1000 行一页扫到底，上万行、几十次串行往返 —— 打开慢的主因。 */
  function rankPeriods() {
    var out = [];
    state.monthsCh.forEach(function (m) {
      if (out.indexOf(m) < 0) out.push(m);
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
      applyLists(cached.merged, cached.rank);
      repaint();
    } else {
      showLoading();
    }

    try {
      /* ② 渠道图先取：体积小，且决定了「可选月份」——取到就先把左列和筛选铺出来 */
      var chRows = [], chFail = false;
      try {
        if (typeof SB.listRankChannelPics === "function") {
          chRows = (await SB.listRankChannelPics({ periodType: "month" })) || [];
        }
      } catch (e) { chRows = []; chFail = true; }

      /* 读取失败（不是「确实没有图」）时保留缓存里的内容，别把已铺好的页面清空 */
      var merged = buildMerged(chRows);
      if (chFail && state.merged.length) merged = state.merged;
      state.tags = {};
      state.tagTried = {};
      /* 右列还没有任何数据时才算「读取中」，避免已有数据闪成加载态 */
      state.rankLoading = !state.rank.length;
      applyLists(merged, state.rank);
      repaint();

      /* ③ 榜单只取需要的月份（目标月 + 去年同月） */
      var rk = await fetchRank(SB);
      state.rankLoading = false;
      var rank = buildRank(rk.rows, merged);
      if (rk.fail && state.rank.length) rank = state.rank;
      applyLists(merged, rank);
      repaint();

      cacheSet(state.merged, state.rank);
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


  /* ---------- 筛选（只有月度，没有渠道筛选：两列是固定的） ---------- */
  function renderFilter() {
    var box = $("#mrg-groups");
    if (!box) return;
    box.innerHTML = "";
    var g = document.createElement("div");
    g.className = "tag-group";
    var name = document.createElement("div");
    name.className = "tag-group-name";
    name.textContent = "月度";
    var chips = document.createElement("div");
    chips.className = "tag-chips";
    function chip(v, text) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tag-chip" + (state.month === v ? " active" : "");
      b.textContent = text;
      b.onclick = function () {
        state.month = v;
        state.cat = ALL;      /* 换月后类目回到「全部」，避免「这个月什么都没有」的误判 */
        renderFilter(); renderCats(); renderPools();
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
    /* 同期对比必须落到一个具体月份（要和「去年同月」配对），所以这种情况下不提供「全部月份」 */
    if (!state.sync) chips.appendChild(chip("", "全部月份"));
    state.months.forEach(function (m) { chips.appendChild(chip(m, m)); });
    g.appendChild(name);
    g.appendChild(chips);
    box.appendChild(g);

    /* 对比口径：同月对照（默认） / 同期对比（榜单取去年同月） */
    var g2 = document.createElement("div");
    g2.className = "tag-group";
    var n2 = document.createElement("div");
    n2.className = "tag-group-name";
    n2.textContent = "对比口径";
    var c2 = document.createElement("div");
    c2.className = "tag-chips";
    [["same", "同月对照"], ["sync", "同期对比（去年同月）"]].forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      var on = p[0] === "sync";
      b.className = "tag-chip" + ((on === !!state.sync) ? " active" : "");
      b.textContent = p[1];
      b.onclick = function () {
        if (on === !!state.sync) return;
        state.sync = on;
        try { if (window.localStorage) localStorage.setItem(SYNC_KEY, on ? "1" : "0"); } catch (e) {}
        if (state.sync && !state.month) state.month = state.months[0] || "";
        state.cat = ALL;
        renderFilter(); renderCats(); renderPools();
      };
      c2.appendChild(b);
    });
    g2.appendChild(n2);
    g2.appendChild(c2);
    box.appendChild(g2);

    if (state.sync) {
      var tip = document.createElement("div");
      tip.className = "tag-group-name mrg-sync-tip";
      var tg = state.month || "";
      var rf = prevYearMonth(tg);
      var nCh = state.merged.filter(function (r) { return r.month === tg; }).length;
      var nRk = state.rank.filter(function (r) { return r.month === rf; }).length;
      tip.textContent = "目标月 " + (tg || "—") + " 看渠道在铺什么（P / T / S " + nCh + " 张）；参考月 " +
        (rf || "—") + " 看去年同月实际好卖什么（上新节奏 " + nRk + " 张）。";
      box.appendChild(tip);
    }
    syncSummary();
  }

  function syncSummary() {
    var sum = $("#mrg-summary");
    if (!sum) return;
    var cols = activeCols();
    var closed = COLS.length - cols.length;
    if (state.sync) {
      sum.textContent = "同期对比 · 目标月 " + (state.month || "未选") +
        " / 去年同月 " + (prevYearMonth(state.month) || "未选") + " · " + cols.length + " 列" +
        (closed ? "（另有 " + closed + " 列因其专区已在后台关闭而未显示）" : "");
    } else {
      sum.textContent = (state.month || "全部月份") + " · " + cols.length + " 列" +
        (closed ? "（另有 " + closed + " 列因其专区已在后台关闭而未显示）" : "");
    }
  }

  /* ---------- 左侧类目菜单 ---------- */
  function monthItems() {
    if (!state.month) return state.items;
    if (!state.sync) return state.items.filter(function (r) { return r.month === state.month; });
    var ref = prevYearMonth(state.month);
    return state.items.filter(function (r) { return r.month === state.month || r.month === ref; });
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
      b.onclick = function () { state.cat = name; renderCats(); renderPools(); };
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

  /* ---------- 池子（两列并排） ---------- */
  /* 20261123A：每列首屏只画 FIRST_PAGE 张，余下点「展开更多」再画。
     以前是一次性把整月几千张图都写成 DOM，卡片一多就卡（打开慢、切页也顿）。 */
  var FIRST_PAGE = 96, MORE_PAGE = 96, MAX_PAGE = 288;   /* 与榜单页同一档：先小，避免一次拉太多图 */
  function shownKey(c, list) {
    return c.key + "|" + (colMonth(c) || "*") + "|" + state.cat + "|" + (list ? list.length : 0);
  }
  function shownOf(c, list) {
    var n = state.shown[shownKey(c, list)] || FIRST_PAGE;
    return Math.min(n, list.length, MAX_PAGE);
  }
  function renderPools() {
    var body = $("#mrg-body");
    var bar = $("#mrg-bar");
    if (!body) return;
    var cols = activeCols();
    var lists = cols.map(function (c) {
      return { col: c, list: colList(c), loading: (c.type === "rank" && state.rankLoading) };
    });
    var total = 0;
    lists.forEach(function (x) { total += x.list.length; });

    if (bar) {
      var barTxt = "共 <b>" + total + "</b> 张 · " + cols.length + " 列";
      if (state.sync) {
        barTxt += " · 目标月 " + esc(state.month || "—") + " / 去年同月 " + esc(prevYearMonth(state.month) || "—");
      } else {
        barTxt += state.month ? " · " + esc(state.month) : " · 全部月份";
      }
      if (state.cat !== ALL) barTxt += " · " + esc(state.cat);
      if (state.loading) barTxt += ' · <span class="rk-bar-loading">刷新中…</span>';
      bar.innerHTML = '<span class="rk-bar-info">' + barTxt + "</span>";
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
      html += '<section class="rk-pool" data-src="' + esc(s.key) + '">';
      html += '<div class="rk-pool-head"><div class="rk-pool-name"><span>' + esc(s.label) +
        '</span><span class="rk-n">' + (x.loading ? "读取中" : list.length + " 张") + "</span></div>" +
        '<div class="rk-pool-meta">' + esc(colMetaText(s)) + "</div></div>";
      html += '<div class="rk-pool-grid" style="--rk-r:' + pr + '">';
      if (x.loading) {
        html += '<div class="rk-empty">正在读取「上新节奏」的图…</div>';
      } else if (!list.length) {
        html += '<div class="rk-empty">' + esc(emptyNote(s)) + "</div>";
      } else {
        list.slice(0, page).forEach(function (it) {
          html += '<figure class="rk-card cmp-card" data-url="' + esc(it.image_url) + '" title="' +
            esc([it.category, it.month].filter(Boolean).join(" · ")) + '">' +
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

  /* ---------- 同期对比的摘要条：两列各多少张、去年同月好卖的是哪几个类目 ---------- */
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
    if (!state.sync || !state.month) { el.innerHTML = ""; el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    var target = state.month, ref = prevYearMonth(target);
    var chList = state.merged.filter(function (r) { return r.month === target; });
    var rkList = state.rank.filter(function (r) { return r.month === ref; });
    var tCats = topCats(chList, 3), rCats = topCats(rkList, 3);
    var html = '<div class="mrg-sync-row">' +
      '<span class="mrg-sync-k">去年同月 ' + esc(ref || "—") + "</span>" +
      '<span class="mrg-sync-v">上新节奏 <b>' + rkList.length + "</b> 张" +
      (rCats.length ? " · TOP：" + esc(rCats.join("、")) : "") + "</span>" +
      "</div>" +
      '<div class="mrg-sync-row">' +
      '<span class="mrg-sync-k">目标月 ' + esc(target) + "</span>" +
      '<span class="mrg-sync-v">站外（P · T · S）<b>' + chList.length + "</b> 张" +
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
      /* 这一页不单独配授权：它依赖的专区（榜单 / P / S / T）全关或全无授权时才不开放 */
      var anyDep = ["rank", "rhythm", "pinterest", "shein", "tiktok"].some(function (z) {
        if (vis && vis[z] === false) return false;
        if (Array.isArray(myz) && myz.length && myz.indexOf(z) === -1) return false;
        return true;
      });
      if (!anyDep) state.gate = "本页的数据来自「趋势上升榜 / 上新节奏 / P / S / T 专区」，这些专区当前都未对你开放。";
      if (window.Common && Common.visit) { try { Common.visit.track(KEY); } catch (e0) {} }
    } catch (e) { /* 导航显隐失败不影响展示 */ }

    var tabs = document.querySelector(".top-tabs");
    if (tabs) tabs.classList.remove("is-booting");

    if (state.gate) {
      var cats = $("#mrg-cats");
      if (cats) cats.innerHTML = '<div class="cat-menu-tip">未开放</div>';
      $("#mrg-body").innerHTML = '<div class="rk-empty">' + esc(state.gate) + "</div>";
      var bar0 = $("#mrg-bar");
      if (bar0) bar0.innerHTML = "";
      return;
    }
    await load();
  }

  window.__tbReload = function () { return load(); };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
