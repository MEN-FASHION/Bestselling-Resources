/* ============================================================================
 * compare-front.js —— 渠道对比（多列图片横向对比，20261111AC）
 * ----------------------------------------------------------------------------
 * 一屏之内把「同一个类目 · 同一个月」的各个来源的图并排摆开，一眼看差异。
 *
 * 列（来源）来自后台「渠道对比」面板的配置；没配置时自动发现：
 *   ① 上新节奏（月度榜单：rank_items，period_type=month，channel 为空的行）
 *   ② 渠道图存储里出现过的每个渠道（Pinterest / SHEIN / 其它渠道传图传的）
 * 以后新增一个渠道专区，只要它的图进了渠道图存储，这里自动多出一列，不用改代码。
 *
 * 只读页面：不传图、不打标、不删图。
 * ==========================================================================*/
(function () {
  "use strict";

  var KEY = "compare";
  var ALL = "全部";

  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  function SBx() { return window.SB || null; }
  function pad2(n) { return String(n).length < 2 ? "0" + n : String(n); }

  var state = {
    cfg: null,          // 后台配置 { list, showEmpty, perRow }
    sources: [],        // 归一后的列 [{key,label,type,channel}]
    data: {},           // sourceKey -> [item]
    items: [],          // 全部（用于类目 / 月份清单）
    tags: {},           // url -> 打标记录
    months: [],
    month: "",          // 当前月份（默认最新）
    cat: ALL,
    gate: "",
    vis: true,
    loading: false,
    /* 每列已渲染到第几张。一屏动辄上千张图，一次全铺出来浏览器要等很久，
       先给每列头一批，剩下的点「展开更多」再追加。 */
    shown: {},
    /* 已经查过打标的地址，避免切类目/月份时重复请求同一批 URL */
    tagAsked: {},
  };

  /* 首屏每列先出这么多张：够看出差异，又不用等几百张图的请求排完 */
  var PAGE = 24;
  var TAG_BATCH = 200;

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
    if (/^https?:\/\//i.test(s)) return s;
    var base = String((window.CONFIG && window.CONFIG.WORKER_URL) || "").replace(/\/$/, "");
    return base ? base + "/" + s.replace(/^\/+/, "") : s;
  }

  function toast(msg, ok) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "toast show" + (ok === false ? " bad" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = "toast"; }, 2400);
  }

  /* ---------- 列（来源） ---------- */
  /* 默认列：上新节奏 + 数据里出现过的每个渠道（按渠道名排序，保证每次打开顺序一致） */
  function defaultSources(channelRows) {
    var out = [{ key: "rank:month", label: "上新节奏", type: "rank" }];
    var seen = {};
    (channelRows || []).forEach(function (r) {
      var c = String(r.channel || "").trim();
      if (!c || seen[c]) return;
      seen[c] = 1;
      out.push({ key: "ch:" + c, label: c, type: "channel", channel: c });
    });
    return out;
  }

  function sourceItems(s) {
    return state.data[s.key] || [];
  }

  /* 三个月内没图的列：默认隐藏（免得一屏全空列），后台可强制显示 */
  function sourceHasData(s) {
    var all = sourceItems(s);
    if (!all.length) return false;
    if (!state.month) return true;
    return all.some(function (r) { return r.month === state.month; });
  }

  function activeSources() {
    var list = state.sources.slice();
    if (state.cfg && state.cfg.showEmpty === false) {
      list = list.filter(function (s) { return sourceHasData(s); });
    }
    return list;
  }

  /* ---------- 取数 ---------- */
  /* 渠道对比要读两张表，数据量都不小；原来两件事串着做，总耗时是两者之和。
     这里做四件事，解决「打开一直在加载中」：
       ① 两张表并行取（省掉一半等待）；
       ② 只取用得到的字段（原来 select("*")，每条几十字段）；
       ③ 结果在本次会话里缓存 5 分钟，来回切页秒开；
       ④ 单个查询超时也不卡死，用已经拿到的部分先渲染。 */
  var CACHE_KEY = "cmpCacheV1";
  var CACHE_TTL = 5 * 60 * 1000;
  var LOAD_TIMEOUT = 8000;

  function cacheGet() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.t || (Date.now() - o.t) > CACHE_TTL) return null;
      if (!o.ch || !o.rk) return null;
      return o;
    } catch (e) { return null; }
  }

  function cacheSet(chRows, rankRows) {
    /* 行数太大就不缓存了，免得把会话存储撑爆反而拖慢 */
    if ((chRows.length + rankRows.length) > 8000) {
      try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
      return;
    }
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), ch: chRows, rk: rankRows }));
    } catch (e) { /* 配额满就算了，不影响主流程 */ }
  }

  /* 超时保护：慢的那个查询不再拖着整页一起等 */
  function withTimeout(p, ms, fallback) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(fallback); } }, ms);
      Promise.resolve(p).then(function (v) {
        if (done) return;
        done = true; clearTimeout(t); resolve(v);
      }, function () {
        if (done) return;
        done = true; clearTimeout(t); resolve(fallback);
      });
    });
  }

  /* 没读到数据时的统一提示（带重试）。绝不把「读取失败」说成「还没有图片」。 */
  function showRetry() {
    var body = $("#cmp-body");
    if (!body) return;
    body.innerHTML = '<div class="rk-empty">暂时没读到数据（可能是网络较慢）。<br>' +
      '稍等几秒点这里重试：<button type="button" class="cmi-btn" id="cmp-retry">重新加载</button></div>';
    var b = $("#cmp-retry");
    if (b) b.onclick = function () {
      try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
      state.fetchFailed = false;
      load();
    };
  }

  function loadingSay(text) {
    var body = $("#cmp-body");
    if (body) body.innerHTML = '<div class="rk-empty">' + esc(text) + "</div>";
  }

  async function load() {
    var SB = SBx();
    if (!SB || state.loading) return;
    state.loading = true;
    loadingSay("正在读取数据…");
    /* 每秒刷新一次已等待秒数：慢的时候能看出在动，不会以为卡死 */
    var waited = 0;
    var tick = setInterval(function () {
      waited += 1;
      loadingSay("正在读取数据…已等待 " + waited + " 秒");
    }, 1000);
    try {
      var cached = cacheGet();

      /* ① 渠道图（Pinterest / SHEIN / 其它渠道传图）+ ② 后台列配置 —— 与榜单一起并行 */
      var chPromise = (typeof SB.listRankChannelPics === "function")
        ? SB.listRankChannelPics({
            periodType: "month",
            /* 只取渲染与筛选要用的字段（原来拉全表所有字段，是最大的一笔开销） */
            cols: "id,image_url,category,period_label,period_type,channel,title",
          })
        : Promise.resolve([]);
      var cfgPromise = (typeof SB.getCompareSources === "function")
        ? SB.getCompareSources().catch(function () { return null; })
        : Promise.resolve(null);

      /* 【20261111AC 重写】上一版的错：先等配置、再并行、再补取榜单 ——
         三段各自带超时，最坏要等 8+8+8 秒，用户看到的就是「一直在转圈」。
         现在改成：三个请求一开始就同时发出，只等一层 Promise.all，
         总耗时封顶 LOAD_TIMEOUT，不再有任何二次等待。 */
      var chPromise = (typeof SB.listRankChannelPics === "function")
        ? SB.listRankChannelPics({
            periodType: "month",
            /* 只取渲染与筛选要用的字段（原来拉全表所有字段，是最大的一笔开销） */
            cols: "id,image_url,category,period_label,period_type,channel,title",
          })
        : Promise.resolve([]);
      var rankPromise = (typeof SB.listRankItems === "function")
        ? SB.listRankItems({
            periodType: "month",
            cols: "id,image_url,category,period_label,period_type,site,channel,title",
          })
        : Promise.resolve([]);
      var cfgPromise = (typeof SB.getCompareSources === "function")
        ? SB.getCompareSources()
        : Promise.resolve(null);

      var chRows = [], rankRows = [], cfg = null;
      /* 哨兵：区分「请求超时/失败」和「库里确实没有图」——两者提示语必须不一样，
         否则取数失败时会说成「这个类目还没有图片」，把人误导到数据层面。 */
      var TIMEOUT = { __timeout: 1 };
      state.fetchFailed = false;

      if (cached) {
        chRows = cached.ch;
        rankRows = cached.rk;
        cfg = await withTimeout(cfgPromise, LOAD_TIMEOUT, null);
      } else {
        /* 同时发出，只等这一层；任何一个慢或失败都不影响其它两个 */
        var all3 = await Promise.all([
          withTimeout(chPromise, LOAD_TIMEOUT, TIMEOUT),
          withTimeout(rankPromise, LOAD_TIMEOUT, TIMEOUT),
          withTimeout(cfgPromise, LOAD_TIMEOUT, null),
        ]);
        state.fetchFailed = (all3[0] === TIMEOUT) || (all3[1] === TIMEOUT);
        chRows = (all3[0] === TIMEOUT) ? [] : (all3[0] || []);
        rankRows = (all3[1] === TIMEOUT) ? [] : (all3[1] || []);
        cfg = all3[2];
        if (chRows.length || rankRows.length) cacheSet(chRows, rankRows);
      }
      state.cfg = cfg;

      var conf = state.cfg && Array.isArray(state.cfg.list) ? state.cfg.list : null;
      if (conf && conf.length) {
        /* 配置里的渠道列，名字以配置为准；没有 channel 字段的渠道列补上名字 */
        state.sources = conf.map(function (x) {
          var t = x.type === "rank" ? "rank" : "channel";
          return {
            key: x.key || (t === "rank" ? "rank:month" : "ch:" + x.channel),
            label: x.label || (t === "rank" ? "上新节奏" : x.channel),
            type: t, channel: x.channel || "",
          };
        });
      } else {
        state.sources = defaultSources(chRows);
      }

      /* 渠道图 URL 集合：榜单行里与渠道图重复的地址不再进「上新节奏」列 */
      var chUrls = {};
      var byKey = {};
      var all = [];
      chRows.forEach(function (r) {
        var u = imgUrl(r.image_url);
        if (!u) return;
        var c = String(r.channel || "").trim();
        if (!c) return;
        chUrls[u] = 1;
        var k = "ch:" + c;
        var it = {
          image_url: u, category: String(r.category || "").trim(),
          month: normMonth(r.period_label || r.m || ""),
          site: "", source: k, title: String(r.title || ""),
        };
        if (!it.category) return;
        (byKey[k] = byKey[k] || []).push(it);
        all.push(it);
      });
      rankRows.forEach(function (r) {
        var u = imgUrl(r.image_url);
        if (!u || chUrls[u]) return;
        if (String(r.channel || "").trim()) return;      /* 有渠道归属的行归到渠道列 */
        var cat = String(r.category || "").trim();
        if (!cat) return;
        var it = {
          image_url: u, category: cat,
          month: normMonth(r.period_label || ""),
          site: String(r.site || ""), source: "rank:month", title: String(r.title || ""),
        };
        (byKey["rank:month"] = byKey["rank:month"] || []).push(it);
        all.push(it);
      });

      /* 同一列里同图只留一条 */
      Object.keys(byKey).forEach(function (k) {
        var seen = {}, uniq = [];
        byKey[k].forEach(function (r) { if (!seen[r.image_url]) { seen[r.image_url] = 1; uniq.push(r); } });
        byKey[k] = uniq;
      });
      state.data = byKey;
      state.items = all;

      /* 月份清单：两处并集，倒序 */
      var ms = {};
      all.forEach(function (r) { if (r.month) ms[r.month] = 1; });
      state.months = Object.keys(ms).sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
      if (!state.month || state.months.indexOf(state.month) < 0) state.month = state.months[0] || "";

      /* 打标结果：不在这里一次性拉全量（上千地址要几十个请求，页面会一直等），
         改成渲染时按「当前要显示的图」增量查，见 ensureTags。 */
      state.tags = {};
      state.tagAsked = {};
      state.shown = {};

      renderFilter();
      renderCats();
      renderPools();
    } catch (e) {
      $("#cmp-body").innerHTML = '<div class="rk-empty">读取失败，请刷新重试</div>';
    } finally {
      clearInterval(tick);
      state.loading = false;
      /* 数据一条都没拿到、且是取数失败：明确说「还没读到」，别让人对着空白猜 */
      if (!state.items.length && state.fetchFailed) showRetry();
    }
  }

  /* ---------- 上方筛选：月度（列的选择在后台，不在这里） ---------- */
  function renderFilter() {
    var box = $("#cmp-groups");
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
      b.onclick = function () { state.month = v; state.shown = {}; renderFilter(); renderCats(); renderPools(); };
      return b;
    }
    if (!state.months.length) {
      var t = document.createElement("span");
      t.className = "tag-chip";
      t.style.opacity = ".55";
      t.textContent = "暂无月份";
      chips.appendChild(t);
    }
    state.months.forEach(function (m) { chips.appendChild(chip(m, m)); });
    g.appendChild(name);
    g.appendChild(chips);
    box.appendChild(g);

    var sum = $("#cmp-summary");
    if (sum) {
      var n = activeSources().length;
      sum.textContent = (state.month || "全部月份") + " · " + n + " 列对比";
    }
  }

  /* ---------- 左侧：服装类目 ---------- */
  function monthItems() {
    return state.items.filter(function (r) { return !state.month || r.month === state.month; });
  }

  function renderCats() {
    var nav = $("#cmp-cats");
    if (!nav) return;
    var list = monthItems();
    var cnt = {};
    list.forEach(function (r) { cnt[r.category] = (cnt[r.category] || 0) + 1; });
    var names = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
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
    if (!names.length) {
      var t = document.createElement("div");
      t.className = "cat-menu-tip";
      t.textContent = "暂无类目";
      nav.appendChild(t);
      return;
    }
    names.forEach(function (c) { add(c, cnt[c]); });
  }

  /* ---------- 差异分析：把当前这一屏的数据交给分析模块 ---------- */
  /* ---------- 打标按需读取 ----------
     原来是把全站所有图片地址一次性丢进查询（上千个 URL、几十个请求），
     页面要等它们全部回来才肯渲染，所以「打开很慢」。
     现在只查当前要显示的这些地址，并记下来，翻回来时不再重复查。 */
  async function ensureTags(urls) {
    var SB = SBx();
    if (!SB) return;
    var need = [], seen = {};
    (urls || []).forEach(function (u) {
      var k = String(u || "").trim();
      if (!k || state.tagAsked[k] || seen[k]) return;
      seen[k] = 1;
      need.push(k);
    });
    if (!need.length) return;
    need.forEach(function (k) { state.tagAsked[k] = 1; });
    for (var i = 0; i < need.length; i += TAG_BATCH) {
      var part = need.slice(i, i + TAG_BATCH);
      try {
        var map = null;
        /* 打标查询也要有时限：它挂着不动时，整列渲染会一起卡在「加载中」。
           超时就先按「未打标」渲染，标签下次再补，页面不能因此打不开。 */
        var pTag = (typeof SB.listMovementTags === "function") ? SB.listMovementTags(part)
          : (typeof SB.listImageTags === "function" ? SB.listImageTags(part) : null);
        if (pTag) map = await withTimeout(pTag, 6000, null);
        Object.keys(map || {}).forEach(function (k) { state.tags[k] = map[k]; });
      } catch (e) {
        /* 查不到就当没打标：不能因为一次请求失败整页不显示。
           也不再把这批地址放回待查队列——否则每次重试都要再等 6 秒，
           叠加起来就是「一直加载中」。下次刷新页面自然会重新查。 */
      }
    }
  }

  /* 当前月份 / 类目下，某一列应该显示的全部图片 */
  function visibleList(s) {
    return sourceItems(s).filter(function (r) {
      return (!state.month || r.month === state.month) && (state.cat === ALL || r.category === state.cat);
    });
  }

  function shownOf(key) {
    var n = state.shown[key];
    return n > 0 ? n : PAGE;
  }

  function insightCtx() {
    var srcs = activeSources().filter(function (s) { return visibleList(s).length > 0; });
    return {
      month: state.month, cat: state.cat, tags: state.tags,
      sources: srcs.map(function (s) {
        return { key: s.key, label: s.label, type: s.type, list: visibleList(s) };
      }),
    };
  }

  /* 打开分析：key 指定「分析哪个来源」，为空时挑一个渠道列（通常就是用户想问的那个） */
  async function openInsight(key) {
    if (!window.CmpInsight || typeof window.CmpInsight.open !== "function") {
      toast("分析组件未加载，请刷新页面后重试", false);
      return;
    }
    /* 分析要覆盖整列（不只屏幕上那几张），先把这一层的打标补齐；
       屏幕上只查了首批，缺的标签会让差异结论偏掉。 */
    var all = [];
    activeSources().forEach(function (s) {
      visibleList(s).forEach(function (it) { all.push(it.image_url); });
    });
    if (all.length) {
      toast("正在准备打标数据…", true);
      await ensureTags(all);
    }
    var ctx = insightCtx();
    if (!ctx.sources.length) { toast("这个月份 / 类目下还没有图片，先换一个再看看", false); return; }
    var focus = key;
    if (!focus) {
      var ch = ctx.sources.filter(function (s) { return s.type !== "rank"; })[0] || ctx.sources[0];
      focus = ch ? ch.key : "";
    }
    window.CmpInsight.open(ctx, focus);
  }

  /* ---------- 多列对比池 ---------- */
  function perRowOf(n) {
    var fixed = state.cfg && Number(state.cfg.perRow);
    if (fixed >= 1) return Math.min(6, Math.max(1, fixed));
    /* 列越多，每列每行摆得越少，保证一屏能看全、图也不至于糊成一格色块 */
    if (n <= 2) return 4;
    if (n === 3) return 4;
    if (n === 4) return 3;
    if (n === 5) return 2;
    return 2;
  }

  async function renderPools() {
    var body = $("#cmp-body");
    var bar = $("#cmp-bar");
    if (!body) return;
    /* 连续切类目时会有多次渲染重叠：打标是异步的，晚发出的那次可能先返回，
       用序号只让最后一次真正落 DOM，避免「点 A 显示 B」。 */
    var seq = (state.renderSeq = (state.renderSeq || 0) + 1);
    var srcs = activeSources();
    var cat = state.cat;

    var total = 0;
    srcs.forEach(function (s) { total += visibleList(s).length; });

    if (bar) {
      bar.innerHTML = '<span class="rk-bar-info">共 <b>' + total + "</b> 张 · " + srcs.length + " 列" +
        (state.month ? " · " + esc(state.month) : "") + (cat !== ALL ? " · " + esc(cat) : "") + "</span>" +
        '<button type="button" class="cmi-btn cmi-btn-ghost" id="cmp-insight-all" title="按当前类目与月份，对比各来源的打标结构差异">渠道差异分析</button>';
    }

    if (!srcs.length) {
      body.innerHTML = '<div class="rk-empty">还没有可对比的来源。去后台「渠道对比」勾选要对比的专区，<br>或先在「Pinterest 专区 / SHEIN 专区 / 上新节奏」里传图。</div>';
      return;
    }
    if (!total) {
      if (state.fetchFailed) { showRetry(); return; }
      body.innerHTML = '<div class="rk-empty">这个月份 / 类目下还没有图片，换个月份或类目试试。</div>';
      return;
    }

    var pr = perRowOf(srcs.length);

    /* 只查即将显示的那部分打标（首屏每列 PAGE 张），不等全量 */
    var want = [];
    srcs.forEach(function (s) {
      var list = visibleList(s).slice(0, shownOf(s.key) + PAGE);
      list.forEach(function (it) { want.push(it.image_url); });
    });
    await ensureTags(want);
    if (seq !== state.renderSeq) return;      /* 期间又切了类目/月份，这次结果作废 */

    var html = '<div class="rk-pools">';
    srcs.forEach(function (s) {
      var listAll = visibleList(s);
      var lim = shownOf(s.key);
      var list = listAll.slice(0, lim);
      html += '<section class="rk-pool" data-src="' + esc(s.key) + '">';
      html += '<div class="rk-pool-head"><div class="rk-pool-name"><span>' + esc(s.label) +
        '</span><span class="rk-n">' +
        (listAll.length > list.length ? list.length + "/" + listAll.length : listAll.length) +
        " 张</span></div>" +
        '<div class="rk-pool-meta">' + esc(s.type === "rank" ? "月度榜单" : "渠道图") +
        (state.month ? " · " + esc(state.month) : "") +
        (listAll.length ? ' <button type="button" class="cmi-btn" data-insight="' + esc(s.key) +
          '" title="看这一列与其它来源的打标结构差异">详细分析</button>' : "") +
        "</div></div>";
      html += '<div class="rk-pool-grid" style="--rk-r:' + pr + '">';
      if (!list.length) {
        html += '<div class="rk-empty">该列暂无数据</div>';
      } else {
        list.forEach(function (it) {
          var t = state.tags[it.image_url] || {};
          var tagged = ["style_tags", "visual_tags", "pattern_tags", "element_tags", "struct_tags",
            "fabric_tags", "craft_tags", "shoot_tags", "skin_tags", "fit_tags",
            "culture_tags", "psych_tags", "festival_tags"].some(function (k) { return (t[k] || []).length; });
          html += '<figure class="rk-card cmp-card" data-url="' + esc(it.image_url) + '" title="' +
            esc([it.category, it.month, it.site].filter(Boolean).join(" · ")) + '">' +
            '<img loading="lazy" decoding="async" src="' + esc(it.image_url) + '" alt="' + esc(it.category) + '">' +
            (tagged ? '<span class="cmp-tagged" title="已打标">●</span>' : "") +
            "</figure>";
        });
      }
      html += "</div>";
      if (listAll.length > list.length) {
        html += '<div class="rk-more-wrap"><button type="button" class="cmi-btn" data-more="' + esc(s.key) +
          '">展开更多（已显示 ' + list.length + " / " + listAll.length + "）</button></div>";
      }
      html += "</section>";
    });
    html += "</div>";
    body.innerHTML = html;

    Array.prototype.forEach.call(body.querySelectorAll(".cmp-card"), function (fig) {
      fig.onclick = function () { openModal(fig.getAttribute("data-url")); };
      /* 榜单图是外部链接，随时可能挂掉；失败就换一个占位，别留一块一直转的空白 */
      var im = fig.querySelector("img");
      if (im) {
        im.onerror = function () {
          im.onerror = null;
          im.removeAttribute("src");
          fig.classList.add("cmp-broken");
        };
      }
    });
    Array.prototype.forEach.call(body.querySelectorAll("[data-more]"), function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var key = btn.getAttribute("data-more");
        state.shown[key] = shownOf(key) + PAGE;
        renderPools();
      };
    });
    Array.prototype.forEach.call(body.querySelectorAll(".cmi-btn[data-insight]"), function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        openInsight(btn.getAttribute("data-insight"));
      };
    });
    var allBtn = $("#cmp-insight-all");
    if (allBtn) allBtn.onclick = function () { openInsight(""); };
  }

  /* ---------- 大图 + 打标 ---------- */
  var GROUPS = [
    ["风格", ["style_tags"]], ["视觉", ["visual_tags"]], ["图案类型", ["pattern_tags"]],
    ["图案元素", ["element_tags"]], ["结构部件", ["struct_tags"]], ["面料", ["fabric_tags"]],
    ["二次工艺", ["craft_tags"]], ["拍摄方式", ["shoot_tags"]], ["模特", ["skin_tags"]],
    ["版型", ["fit_tags"]], ["文化背景", ["culture_tags"]], ["消费心理", ["psych_tags"]],
    ["节日", ["festival_tags"]]
  ];

  function openModal(url) {
    if (!url) return;
    var t = state.tags[url] || {};
    var big = $("#cmp-big");
    if (big) big.src = url;
    var it = state.items.filter(function (r) { return r.image_url === url; })[0] || {};
    var title = $("#cmp-title");
    if (title) title.textContent = [it.category, it.month, it.site].filter(Boolean).join(" · ");
    var box = $("#cmp-tags");
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
    $("#cmp-modal").classList.remove("hidden");
  }
  function closeModal() {
    var m = $("#cmp-modal");
    if (m) m.classList.add("hidden");
  }

  function bind() {
    var c = $("#cmp-close");
    if (c) c.onclick = closeModal;
    var m = $("#cmp-modal");
    if (m) m.onclick = function (e) { if (e.target === m) closeModal(); };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    bind();
    var SB = SBx();
    /* 登录态：与其它前台页一致，未登录回登录页 */
    var logged = false;
    try {
      var sess = (SB && typeof SB.getSession === "function") ? await SB.getSession() : null;
      if (sess && sess.user) {
        logged = true;
        var u = $("#cmp-user");
        if (u) { u.textContent = sess.user.email || ""; u.classList.remove("hidden"); }
        var li = $("#cmp-login"); if (li) li.classList.add("hidden");
      }
      var lo = $("#cmp-logout");
      if (lo) {
        lo.classList.toggle("hidden", !logged);
        lo.onclick = async function () { try { await SB.signOut(); } catch (e) {} location.href = "index.html"; };
      }
      if (!logged) {
        var li2 = $("#cmp-login"); if (li2) li2.classList.remove("hidden");
        location.replace("index.html");
        return;
      }
    } catch (e) { /* 拿不到会话也继续尝试渲染 */ }

    try {
      if (window.Common && Common.zones && Common.zones.loadDefs) await Common.zones.loadDefs();
      var vis = null, myz = null;
      try { vis = await SB.getFrontendZoneVisibility(); } catch (e) { vis = null; }
      try { myz = await SB.myFrontendZones(); } catch (e) { myz = null; }
      if (window.Common && Common.zones) {
        Common.zones.setVis(vis || {});
        Common.zones.setMine(Array.isArray(myz) ? myz : null);
        if (Common.zones.applyNav) Common.zones.applyNav();
        state.vis = Common.zones.visible(KEY) !== false;
      }
      if (vis && vis[KEY] === false) {
        state.gate = "全站开关：该专区已在后台「前台访问设置」中被关闭";
      } else if (Array.isArray(myz) && myz.length && myz.indexOf(KEY) === -1) {
        state.gate = "账号授权：你的账号未获授权访问本专区";
      }
      if (window.Common && Common.visit) { try { Common.visit.track(KEY); } catch (e0) {} }
    } catch (e) { /* 导航显隐失败不影响展示 */ }

    var tabs = document.querySelector(".top-tabs");
    if (tabs) tabs.classList.remove("is-booting");

    if (!state.vis || state.gate) {
      $("#cmp-cats").innerHTML = '<div class="cat-menu-tip">未开放</div>';
      $("#cmp-body").innerHTML = '<div class="rk-empty">' + esc(state.gate || "该专区暂未对你开放，请联系管理员") + "</div>";
      var bar0 = $("#cmp-bar");
      if (bar0) bar0.innerHTML = "";
      return;
    }
    await load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
