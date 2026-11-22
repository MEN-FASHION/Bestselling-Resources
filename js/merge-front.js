/* ============================================================================
 * merge-front.js —— 渠道合并对比（20261122A）
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

  var state = {
    merged: [],        // 左列：P / T / S 合并后的图
    rank: [],          // 右列：上新节奏（月度榜单）
    items: [],         // 两列并集（用于类目 / 月份清单）
    tags: {},
    tagTried: {},
    months: [],
    month: null,       // null = 还没选（落到最新月）；"" = 全部月份
    cat: ALL,
    zoneVis: null,
    myZones: null,
    gate: "",
    loading: false,
  };

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

  function colList(c) {
    var all = c.type === "rank" ? state.rank : state.merged;
    var list = all.filter(function (r) {
      if (state.cat === ALL) return true;
      return catSame(r.category, state.cat);
    });
    if (!state.month) return list;
    return list.filter(function (r) { return r.month === state.month; });
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

  async function load() {
    var SB = SBx();
    if (!SB || state.loading) return;
    state.loading = true;
    showLoading();
    try {
      var pCh = (typeof SB.listRankChannelPics === "function")
        ? Promise.resolve(SB.listRankChannelPics({ periodType: "month" })).catch(function () { return []; })
        : Promise.resolve([]);
      var pRk = (typeof SB.listRankItems === "function")
        ? Promise.resolve(SB.listRankItems({
          periodType: "month",
          cols: "id,image_url,category,period_label,period_type,site,channel,title",
        })).catch(function () { return []; })
        : Promise.resolve([]);
      var got = await Promise.all([pCh, pRk]);
      var chRows = got[0] || [];
      var rankRows = got[1] || [];

      /* 左列：只收 P / T / S 三个渠道的图，并按图片地址去重（三个渠道可能传了同一张） */
      var merged = [], seenU = {};
      chRows.slice().sort(function (a, b) {
        var ka = CH_ORDER[chKey(a.channel)] || 9, kb = CH_ORDER[chKey(b.channel)] || 9;
        return ka - kb;
      }).forEach(function (r) {
        var ck = chKey(r.channel);
        if (!MERGE_CHANNELS[ck]) return;                 /* 其它渠道（Amazon、独立站等）不进合并列 */
        var u = imgUrl(r.image_url);
        if (!u || seenU[u]) return;
        var cat = normCat(r.category);
        if (!cat) return;
        seenU[u] = 1;
        merged.push({
          image_url: u, category: cat,
          month: normMonth(r.period_label || r.m || ""),
          site: "", channel: chShort(r.channel), title: String(r.title || ""),
        });
      });

      /* 右列：月度榜单行（有渠道归属的行属于渠道，不进榜单列，与渠道对比同一口径） */
      var rank = [], seenR = {};
      rankRows.forEach(function (r) {
        if (String(r.channel || "").trim()) return;
        var u = imgUrl(r.image_url);
        if (!u || seenU[u] || seenR[u]) return;          /* 榜单里与渠道图重复的地址不再重复摆 */
        var cat = normCat(r.category);
        if (!cat) return;
        seenR[u] = 1;
        rank.push({
          image_url: u, category: cat,
          month: normMonth(r.period_label || ""),
          site: String(r.site || ""), title: String(r.title || ""),
        });
      });

      state.merged = merged;
      state.rank = rank;
      state.items = merged.concat(rank);
      state.tags = {};
      state.tagTried = {};

      var ms = {};
      state.items.forEach(function (r) { if (r.month) ms[r.month] = 1; });
      state.months = Object.keys(ms).sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
      if (state.month === null || state.month === undefined) state.month = state.months[0] || "";
      else if (state.month && state.months.indexOf(state.month) < 0) state.month = state.months[0] || "";

      renderFilter();
      renderCats();
      renderPools();
    } catch (e) {
      var body = $("#mrg-body");
      if (body) body.innerHTML = '<div class="rk-empty">读取失败，请刷新重试</div>';
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
    chips.appendChild(chip("", "全部月份"));
    state.months.forEach(function (m) { chips.appendChild(chip(m, m)); });
    g.appendChild(name);
    g.appendChild(chips);
    box.appendChild(g);
    syncSummary();
  }

  function syncSummary() {
    var sum = $("#mrg-summary");
    if (!sum) return;
    var cols = activeCols();
    var closed = COLS.length - cols.length;
    sum.textContent = (state.month || "全部月份") + " · " + cols.length + " 列" +
      (closed ? "（另有 " + closed + " 列因其专区已在后台关闭而未显示）" : "");
  }

  /* ---------- 左侧类目菜单 ---------- */
  function monthItems() {
    return state.items.filter(function (r) { return !state.month || r.month === state.month; });
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
  function renderPools() {
    var body = $("#mrg-body");
    var bar = $("#mrg-bar");
    if (!body) return;
    var cols = activeCols();
    var lists = cols.map(function (c) { return { col: c, list: colList(c) }; });
    var total = 0;
    lists.forEach(function (x) { total += x.list.length; });

    if (bar) {
      bar.innerHTML = '<span class="rk-bar-info">共 <b>' + total + "</b> 张 · " + cols.length + " 列" +
        (state.month ? " · " + esc(state.month) : " · 全部月份") +
        (state.cat !== ALL ? " · " + esc(state.cat) : "") + "</span>";
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
      var emptyNote = s.type === "rank"
        ? "本月没有「上新节奏」的图（不会用其它月份顶替）"
        : "本月没有 P / T / S 的图（不会用其它月份顶替）";
      html += '<section class="rk-pool" data-src="' + esc(s.key) + '">';
      html += '<div class="rk-pool-head"><div class="rk-pool-name"><span>' + esc(s.label) +
        '</span><span class="rk-n">' + list.length + " 张</span></div>" +
        '<div class="rk-pool-meta">' + esc(s.type === "rank" ? "月度榜单" : "P / T / S 合并") +
        (state.month ? " · " + esc(state.month) : "") + "</div></div>";
      html += '<div class="rk-pool-grid" style="--rk-r:' + pr + '">';
      if (!list.length) {
        html += '<div class="rk-empty">' + esc(emptyNote) + "</div>";
      } else {
        list.forEach(function (it) {
          html += '<figure class="rk-card cmp-card" data-url="' + esc(it.image_url) + '" title="' +
            esc([it.category, it.month].filter(Boolean).join(" · ")) + '">' +
            '<img loading="lazy" decoding="async" src="' + esc(thumbOf(it.image_url)) +
            '" data-full="' + esc(it.image_url) + '" alt="' + esc(it.category) + '">' +
            "</figure>";
        });
      }
      html += "</div></section>";
    });
    html += "</div>";
    body.innerHTML = html;

    Array.prototype.forEach.call(body.querySelectorAll(".cmp-card"), function (fig) {
      fig.onclick = function () { openModal(fig.getAttribute("data-url")); };
    });
    fitPools();
    fitPoolsSoon();
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
