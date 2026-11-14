/* ============================================================================
 * compare-front.js —— 渠道对比（多列图片横向对比，20261112B）
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
    tagTried: {},       // url -> 已经问过库（避免重复请求）
    months: [],
    month: null,        // 当前月份（null = 还没选，默认最新月；"" = 全部月份）
    cat: ALL,
    gate: "",
    vis: true,
    loading: false,
    srcOn: {},          // 用户手动打开的列 key（默认按「有没有图」自动决定）
    srcOff: {},         // 用户手动关掉的列 key
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
      var raw = String(r.channel || "").trim();
      var k = chKey(raw);
      if (!k || seen[k]) return;
      seen[k] = 1;
      out.push({ key: "ch:" + k, label: raw, type: "channel", channel: raw });
    });
    return out;
  }

  function sourceItems(s) {
    return state.data[s.key] || [];
  }

  /* 某一列在当前「类目 + 月份」下到底摆哪些图：
     · 本月有图 → 只摆本月的；
     · 本月一张都没有、但这个类目下别处有图 → 摆这一列自己的全部，并在页面上注明月份，
       绝不再出现「明明传了图，这一列却是空的」；
     · 连类目下都没有图 → 空。 */
  function colItems(s) {
    var cat = state.cat;
    var list = sourceItems(s).filter(function (r) { return cat === ALL || r.category === cat; });
    if (!state.month || !list.length) return { list: list, monthFallback: false };
    var inMonth = list.filter(function (r) { return r.month === state.month; });
    if (inMonth.length) return { list: inMonth, monthFallback: false };
    var ms = {};
    list.forEach(function (r) { if (r.month) ms[r.month] = 1; });
    return { list: list, monthFallback: true, months: Object.keys(ms).sort() };
  }

  /* 三个月内没图的列：默认隐藏（免得一屏全空列），后台可强制显示 */
  function sourceHasData(s) {
    var all = sourceItems(s);
    if (!all.length) return false;
    if (!state.month) return true;
    return all.some(function (r) { return r.month === state.month; });
  }

  /* 某一列在「当前月份」下到底有没有图 */
  function colHasData(s) { return sourceHasData(s); }

  /* 现在到底显示哪几列：
     - 后台勾了「显示空列」→ 全部显示；
     - 否则默认只显示这个月份有图的列（空列不再占位置）；
     - 但顶部「渠道」筛选里手动点开的列一律显示、手动关掉的一律不显示。
     这三个分支都只做本地过滤，不发任何请求，不会影响打开速度。 */
  function activeSources() {
    var forceAll = !!(state.cfg && state.cfg.showEmpty === true);
    return state.sources.filter(function (s) {
      if (state.srcOff[s.key]) return false;
      if (state.srcOn[s.key]) return true;
      return forceAll ? true : colHasData(s);
    });
  }

  /* 被自动隐藏的列（有图与否决定），用于在筛选里提示「已隐藏 N 个没有图的渠道」 */
  function hiddenByEmpty() {
    var forceAll = !!(state.cfg && state.cfg.showEmpty === true);
    if (forceAll) return [];
    return state.sources.filter(function (s) {
      return !state.srcOff[s.key] && !state.srcOn[s.key] && !colHasData(s);
    });
  }

  /* ---------- 归一（渠道名 / 类目名） ----------
     · 渠道名：库里可能同时存在 SHEIN / Shein / shein / SHE-IN。严格按原文分组，
       同一个渠道会裂成几列；而「SHEIN 专区」那边是忽略大小写和分隔符比较的，
       于是会出现「专区里有图，对比页这一列却空」。这里跟专区对齐。
     · 类目名（20261114G）：一律原样，不做任何归并改写。
       以前这里会把类目名再过一遍关键词规则，后台选 A、这里显示 B，
       一个类目裂成好几列。现在库里存什么就显示什么、就按什么查。 */
  function chKey(v) {
    return String(v == null ? "" : v).replace(/[\s_\-]/g, "").toLowerCase();
  }
  function normCat(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }

  /* 加载提示：每秒报一次已等待秒数，绝不出现「永远是加载中」的观感 */
  var _tickTimer = null;
  function showLoading() {
    var body = $("#cmp-body");
    if (body) body.innerHTML = '<div class="rk-empty" id="cmp-loading">加载中…</div>';
    var t0 = Date.now();
    if (_tickTimer) clearTimeout(_tickTimer);
    (function tick() {
      var el = $("#cmp-loading");
      if (!el) { _tickTimer = null; return; }
      var s = Math.round((Date.now() - t0) / 1000);
      el.innerHTML = "加载中…" + (s >= 2 ? "（已 " + s + " 秒）" : "");
      _tickTimer = setTimeout(tick, 1000);
    })();
  }
  function stopLoading() {
    if (_tickTimer) clearTimeout(_tickTimer);
    _tickTimer = null;
  }

  /* ---------- 取数 ----------
     三条取数一开始就同时发出，只等最慢的一条；打标结果不挡首屏（见 loadTags）。
     之前是「先取渠道图 → 再取配置 → 再取榜单 → 最后取打标」，四段串行，
     每段都等上一次返回，叠起来就是「一直加载中」。 */
  async function load() {
    var SB = SBx();
    if (!SB || state.loading) return;
    state.loading = true;
    showLoading();
    try {
      var pCh = (typeof SB.listRankChannelPics === "function")
        ? Promise.resolve(SB.listRankChannelPics({ periodType: "month" })).catch(function () { return []; })
        : Promise.resolve([]);
      var pCfg = (typeof SB.getCompareSources === "function")
        ? Promise.resolve(SB.getCompareSources()).catch(function () { return null; })
        : Promise.resolve(null);
      var pRk = (typeof SB.listRankItems === "function")
        ? Promise.resolve(SB.listRankItems({
          periodType: "month",
          cols: "id,image_url,category,period_label,period_type,site,channel,title",
        })).catch(function () { return []; })
        : Promise.resolve([]);

      var got = await Promise.all([pCh, pCfg, pRk]);
      var chRows = got[0] || [];
      state.cfg = got[1] || null;
      var rankRows = got[2] || [];

      /* ① 列（来源）：后台配了就以配置为准，没配就按实际渠道自动生成 */
      var conf = state.cfg && Array.isArray(state.cfg.list) ? state.cfg.list : null;
      if (conf && conf.length) {
        var seenSrc = {};
        state.sources = conf.map(function (x) {
          var t = x.type === "rank" ? "rank" : "channel";
          /* 配置里存的是渠道原文；这里按归一键对齐，写法差异不会把一列变成空列 */
          var k = t === "rank" ? "rank:month" : "ch:" + chKey(x.channel || x.label || x.key);
          return {
            key: k,
            label: x.label || (t === "rank" ? "上新节奏" : x.channel),
            type: t, channel: x.channel || "",
          };
        }).filter(function (s) {
          if (!s.key || s.key === "ch:" || seenSrc[s.key]) return false;
          seenSrc[s.key] = 1;
          return true;
        });
      } else {
        state.sources = defaultSources(chRows);
      }

      /* ② 渠道图 URL 集合：榜单行里与渠道图重复的地址不再进「上新节奏」列 */
      var chUrls = {};
      var byKey = {};
      var all = [];
      chRows.forEach(function (r) {
        var u = imgUrl(r.image_url);
        if (!u) return;
        var k = chKey(r.channel);
        if (!k) return;
        chUrls[u] = 1;
        var cat = normCat(r.category);
        if (!cat) return;
        var it = {
          image_url: u, category: cat,
          month: normMonth(r.period_label || r.m || ""),
          site: "", source: "ch:" + k, title: String(r.title || ""),
        };
        (byKey[it.source] = byKey[it.source] || []).push(it);
        all.push(it);
      });
      rankRows.forEach(function (r) {
        var u = imgUrl(r.image_url);
        if (!u || chUrls[u]) return;
        if (String(r.channel || "").trim()) return;      /* 有渠道归属的行归到渠道列 */
        var cat = normCat(r.category);
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
      state.tags = {};
      state.tagTried = {};

      /* 月份清单：两处并集，倒序 */
      var ms = {};
      all.forEach(function (r) { if (r.month) ms[r.month] = 1; });
      state.months = Object.keys(ms).sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
      /* null = 用户还没选过 → 默认落到最新月份；"" = 用户主动选了「全部月份」，不要覆盖他 */
      if (state.month === null || state.month === undefined) state.month = state.months[0] || "";
      else if (state.month && state.months.indexOf(state.month) < 0) state.month = state.months[0] || "";

      /* 首屏立刻画出来：打标结果在后台补，不再让它挡住列表 */
      renderFilter();
      renderCats();
      renderPools();
      loadTags();
    } catch (e) {
      $("#cmp-body").innerHTML = '<div class="rk-empty">读取失败，请刷新重试</div>';
    } finally {
      stopLoading();
      state.loading = false;
    }
  }

  /* ---------- 打标结果：只取当前屏幕上真正会显示的图，取到后补小圆点 ---------- */
  function visibleUrls() {
    var out = [], seen = {};
    activeSources().forEach(function (s) {
      colItems(s).list.forEach(function (r) {
        if (out.length >= 1200 || seen[r.image_url]) return;
        seen[r.image_url] = 1;
        out.push(r.image_url);
      });
    });
    return out;
  }

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
    } catch (e) { /* 打标读不到不该让页面白屏，图标不显示即可 */ }
  }

  function taggedOf(url) {
    var t = state.tags[url] || {};
    var KEYS = ["style_tags", "visual_tags", "pattern_tags", "element_tags", "struct_tags",
      "fabric_tags", "craft_tags", "shoot_tags", "skin_tags", "fit_tags",
      "culture_tags", "psych_tags", "festival_tags"];
    for (var i = 0; i < KEYS.length; i++) { if ((t[KEYS[i]] || []).length) return true; }
    return false;
  }

  function patchTaggedDots() {
    var body = $("#cmp-body");
    if (!body || typeof body.querySelectorAll !== "function") return;
    Array.prototype.forEach.call(body.querySelectorAll(".cmp-card"), function (fig) {
      var u = fig.getAttribute("data-url");
      if (!taggedOf(u) || fig.querySelector(".cmp-tagged")) return;
      var dot = document.createElement("span");
      dot.className = "cmp-tagged";
      dot.title = "已打标";
      dot.textContent = "●";
      fig.appendChild(dot);
    });
  }

  async function loadTags() {
    var urls = visibleUrls();
    if (!urls.length) return;
    await fetchTags(urls);
    patchTaggedDots();
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
      b.onclick = function () { state.month = v; renderFilter(); renderCats(); renderPools(); loadTags(); };
      return b;
    }
    if (!state.months.length) {
      var t = document.createElement("span");
      t.className = "tag-chip";
      t.style.opacity = ".55";
      t.textContent = "暂无月份";
      chips.appendChild(t);
    }
    /* 「全部月份」：各来源的月份写法不一致时（例如一边 2026-11、一边 第45周），
       只有选全部才能把它们摆在一起看 */
    chips.appendChild(chip("", "全部月份"));
    state.months.forEach(function (m) { chips.appendChild(chip(m, m)); });
    g.appendChild(name);
    g.appendChild(chips);
    box.appendChild(g);

    /* ---------- 渠道筛选：决定下面到底摆哪几列 ---------- */
    box.appendChild(srcGroup());

    syncSummary();
  }

  /* 「渠道」筛选组：只控制显示哪些列（本地过滤，不重新取数）
     - 当前月份没有图的渠道，默认不显示，不再占一列空白；
     - 想在筛选里点名看某个空渠道，点它就能强制显示。 */
  function srcGroup() {
    var g = document.createElement("div");
    g.className = "tag-group";
    var name = document.createElement("div");
    name.className = "tag-group-name";
    name.textContent = "渠道";
    var chips = document.createElement("div");
    chips.className = "tag-chips";

    var shown = activeSources();
    var shownKey = {};
    shown.forEach(function (s) { shownKey[s.key] = 1; });

    /* 全部：回到默认（有图的都显示），并清掉手动开关 */
    var allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "tag-chip" + (shown.length === state.sources.length ? " active" : "");
    allBtn.textContent = "全部";
    allBtn.title = "恢复默认：显示这个月份下有图的全部渠道";
    allBtn.onclick = function () {
      state.srcOn = {};
      state.srcOff = {};
      renderFilter(); renderCats(); renderPools(); loadTags();
    };
    chips.appendChild(allBtn);

    state.sources.forEach(function (s) {
      var every = sourceItems(s);
      var n = every.filter(function (r) {
        return !state.month || r.month === state.month;
      }).length;
      var other = every.length - n;
      var on = !!shownKey[s.key];
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tag-chip" + (on ? " active" : "");
      b.title = on ? "点一下隐藏这一列" : (n ? "点一下显示这一列" : "这个月份下没有图，点一下仍可显示");
      /* 本月没图但别的月份有图 —— 必须写出来，否则看起来就像「传了图却没了」 */
      b.textContent = s.label + (n ? " " + n : " 无图") + (other > 0 ? "（其它月份 " + other + "）" : "");
      if (!n) b.style.opacity = on ? ".85" : ".5";
      b.onclick = function () {
        var willHide = !!shownKey[s.key];
        if (willHide) {
          /* 至少留一列，否则整页空白 */
          if (shown.length <= 1) { toast("至少要保留一列", false); return; }
          delete state.srcOn[s.key];
          state.srcOff[s.key] = 1;
        } else {
          delete state.srcOff[s.key];
          state.srcOn[s.key] = 1;
        }
        renderFilter(); renderCats(); renderPools(); loadTags();
      };
      chips.appendChild(b);
    });

    g.appendChild(name);
    g.appendChild(chips);
    return g;
  }

  function syncSummary() {
    var sum = $("#cmp-summary");
    if (!sum) return;
    var n = activeSources().length;
    var hid = hiddenByEmpty();
    /* 被隐藏的列里，有多少只是在「别的月份」有图 —— 这一句能直接解释「传了图却没显示」 */
    var other = 0, otherN = 0;
    hid.forEach(function (s) {
      var tot = sourceItems(s).length;
      if (tot > 0) { other++; otherN += tot; }
    });
    sum.textContent = (state.month || "全部月份") + " · " + n + " 列对比" +
      (hid.length ? "（已隐藏 " + hid.length + " 个无图渠道" +
        (other ? "，其中 " + other + " 个在其它月份有 " + otherN + " 张，点它即可查看" : "") + "）" : "");
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
    /* 当前月没有、但别的月份有的类目也要列出来：
       否则「其它月份传的图」在左侧找不到类目，等于看不见。 */
    var allCnt = {};
    state.items.forEach(function (r) { if (r.category) allCnt[r.category] = (allCnt[r.category] || 0) + 1; });
    var names = Object.keys(allCnt).sort(function (a, b) {
      return ((cnt[b] || 0) - (cnt[a] || 0)) || (allCnt[b] - allCnt[a]);
    });
    nav.innerHTML = "";
    function add(name, count) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cat-menu-item" + (state.cat === name ? " active" : "");
      b.innerHTML = esc(name) + (count != null ? ' <span class="cvi-state">' + count + "</span>" : "");
      b.onclick = function () { state.cat = name; renderCats(); renderPools(); loadTags(); };
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
    names.forEach(function (c) { add(c, cnt[c] || null); });
  }

  /* ---------- 差异分析：把当前这一屏的数据交给分析模块 ---------- */
  function visibleList(s) {
    return colItems(s).list;
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
    var ctx = insightCtx();
    if (!ctx.sources.length) { toast("这个月份 / 类目下还没有图片，先换一个再看看", false); return; }
    var need = [];
    ctx.sources.forEach(function (s) {
      s.list.forEach(function (r) {
        if (need.length < 1500 && r.image_url && !state.tagTried[r.image_url]) need.push(r.image_url);
      });
    });
    if (need.length) {
      toast("正在准备打标数据…");
      await fetchTags(need);
    }
    var focus = key;
    if (!focus) {
      var ch = ctx.sources.filter(function (s) { return s.type !== "rank"; })[0] || ctx.sources[0];
      focus = ch ? ch.key : "";
    }
    window.CmpInsight.open(ctx, focus);
  }

  /* ---------- 多列对比池 ---------- */
  /* 每行几张：与趋势上升榜同一套算法 ——「列宽 ÷ 目标卡宽（130px）」。
     因此列数减少（每列更宽）时，每行自动摆更多；列数增多时，每行自动变少，
     图不会被压成一小格。这里只是渲染前的估算，插入 DOM 后 fitPools 会按实测列宽校正。 */
  function perRowOf(n, containerW) {
    var fixed = state.cfg && Number(state.cfg.perRow);
    if (fixed >= 1) return Math.min(6, Math.max(1, fixed));
    var cg = window.CardGrid;
    var W = Number(containerW) || 0;
    if (!W) { var host = $("#cmp-body"); W = host ? host.clientWidth || 0 : 0; }
    if (W > 0 && n > 0 && cg && cg.cols) {
      /* 减去列间距与列内边距，得到单列内部的可用宽度 */
      var colW = (W - (n - 1) * 10) / n - 22;
      var c = cg.cols(colW);
      if (c) return c;
    }
    if (n <= 2) return 6;
    if (n === 3) return 4;
    if (n === 4) return 3;
    return 2;
  }

  /* 插入 DOM 后按每列实测宽度重算，保证「页面实际多宽就摆多少张」 */
  function fitPools() {
    var body = $("#cmp-body");
    if (!body) return;
    var cg = window.CardGrid;
    var fixed = state.cfg && Number(state.cfg.perRow);
    var grids = body.querySelectorAll(".rk-pool-grid");
    for (var i = 0; i < grids.length; i++) {
      var g = grids[i];
      var w = g.clientWidth || 0;
      if (!w) continue;
      var n = g.querySelectorAll(".rk-card").length;
      var c = fixed >= 1 ? Math.min(6, Math.max(1, fixed))
                         : (cg && cg.cols ? cg.cols(w) : 0);
      if (!c) continue;
      if (n) c = Math.min(c, Math.max(1, n));
      g.style.setProperty("--rk-r", String(c));
    }
  }

  var _fitTimer = null;
  function fitPoolsSoon() {
    if (_fitTimer) clearTimeout(_fitTimer);
    _fitTimer = setTimeout(function () { _fitTimer = null; try { fitPools(); } catch (e) {} }, 50);
  }
  if (window && typeof window.addEventListener === "function") {
    window.addEventListener("resize", fitPoolsSoon);
    window.addEventListener("load", fitPoolsSoon);
  }

  function renderPools() {
    var body = $("#cmp-body");
    var bar = $("#cmp-bar");
    if (!body) return;
    var srcs = activeSources();
    var cat = state.cat;

    var total = 0;
    srcs.forEach(function (s) {
      total += colItems(s).list.length;
    });

    if (bar) {
      bar.innerHTML = '<span class="rk-bar-info">共 <b>' + total + "</b> 张 · " + srcs.length + " 列" +
        (state.month ? " · " + esc(state.month) : " · 全部月份") + (cat !== ALL ? " · " + esc(cat) : "") + "</span>" +
        '<button type="button" class="cmi-btn cmi-btn-ghost" id="cmp-insight-all" title="按当前类目与月份，对比各来源的打标结构差异">渠道差异分析</button>';
    }

    if (!srcs.length) {
      body.innerHTML = '<div class="rk-empty">还没有可对比的来源。去后台「渠道对比」勾选要对比的专区，<br>或先在「Pinterest 专区 / SHEIN 专区 / TikTok 专区 / 上新节奏」里传图。</div>';
      return;
    }
    if (!total) {
      /* 分清两种情况：真的没图 vs 被渠道筛选筛空了 */
      var hasAny = state.sources.some(function (s) { return colItems(s).list.length > 0; });
      body.innerHTML = hasAny
        ? '<div class="rk-empty">当前显示的 ' + srcs.length + ' 列在这个月份 / 类目下都没有图片。<br>点上方「筛选 → 渠道」打开其它渠道再看看。</div>'
        : '<div class="rk-empty">这个月份 / 类目下还没有图片，换个月份或类目试试。</div>';
      return;
    }

    var pr = perRowOf(srcs.length, body.clientWidth || 0);
    var html = '<div class="rk-pools">';
    srcs.forEach(function (s) {
      var got = colItems(s);
      var list = got.list;
      html += '<section class="rk-pool" data-src="' + esc(s.key) + '">';
      html += '<div class="rk-pool-head"><div class="rk-pool-name"><span>' + esc(s.label) +
        '</span><span class="rk-n">' + list.length + " 张</span></div>" +
        '<div class="rk-pool-meta">' + esc(s.type === "rank" ? "月度榜单" : "渠道图") +
        (state.month ? " · " + esc(state.month) : "") +
        (list.length ? ' <button type="button" class="cmi-btn" data-insight="' + esc(s.key) +
          '" title="看这一列与其它来源的打标结构差异">详细分析</button>' : "") +
        "</div></div>";
      if (got.monthFallback) {
        html += '<div class="rk-pool-note">这一列在 ' + esc(state.month) + " 没有图，下面是它全部的 " +
          list.length + " 张（月份：" + esc((got.months || []).join(" / ") || "未标注") +
          "）。点上方「全部月份」可以把各列放在同一个月里看。</div>";
      }
      html += '<div class="rk-pool-grid" style="--rk-r:' + pr + '">';
      if (!list.length) {
        html += '<div class="rk-empty">该列暂无数据</div>';
      } else {
        list.forEach(function (it) {
          html += '<figure class="rk-card cmp-card" data-url="' + esc(it.image_url) + '" title="' +
            esc([it.category, it.month, it.site].filter(Boolean).join(" · ")) + '">' +
            '<img loading="lazy" decoding="async" src="' + esc(it.image_url) + '" alt="' + esc(it.category) + '">' +
            (taggedOf(it.image_url) ? '<span class="cmp-tagged" title="已打标">●</span>' : "") +
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
    Array.prototype.forEach.call(body.querySelectorAll(".cmi-btn[data-insight]"), function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        openInsight(btn.getAttribute("data-insight"));
      };
    });
    var allBtn = $("#cmp-insight-all");
    if (allBtn) allBtn.onclick = function () { openInsight(""); };

    /* 首屏按实测列宽再校正一次（渲染前只能估算） */
    fitPools();
    fitPoolsSoon();
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
    /* 打标结果改成按需取：点开哪张只查那一张，首屏不再为上万张图排队等标签 */
    if (state.tagTried[url]) { paintModal(url); return; }
    paintModal(url);
    fetchTags([url]).then(function () { paintModal(url); });
  }

  function paintModal(url) {
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
