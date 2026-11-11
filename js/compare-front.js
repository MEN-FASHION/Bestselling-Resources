/* ============================================================================
 * compare-front.js —— 渠道对比（多列图片横向对比，20261111V）
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
  async function load() {
    var SB = SBx();
    if (!SB || state.loading) return;
    state.loading = true;
    $("#cmp-body").innerHTML = '<div class="rk-empty">加载中…</div>';
    try {
      /* ① 渠道图（Pinterest / SHEIN / 其它渠道传图） */
      var chRows = [];
      if (typeof SB.listRankChannelPics === "function") {
        chRows = (await SB.listRankChannelPics({ periodType: "month" })) || [];
      }

      /* ② 后台配置；没有配置就按实际渠道自动生成 */
      try { state.cfg = (typeof SB.getCompareSources === "function") ? await SB.getCompareSources() : null; }
      catch (e) { state.cfg = null; }
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

      /* ③ 月度榜单（上新节奏）：按当前可见类目取；只保留没有渠道归属的行，
            渠道图另有列，混进来会重复 */
      var rankRows = [];
      var rankSrc = state.sources.filter(function (s) { return s.type === "rank"; })[0];
      if (rankSrc && typeof SB.listRankItems === "function") {
        try {
          rankRows = (await SB.listRankItems({
            periodType: "month",
            cols: "id,image_url,category,period_label,period_type,site,channel,title",
          })) || [];
        } catch (e) { rankRows = []; }
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

      /* 打标结果：按图片地址（与榜单 / 各专区共用一张表） */
      state.tags = {};
      var urls = all.map(function (r) { return r.image_url; });
      if (urls.length) {
        try {
          if (typeof SB.listMovementTags === "function") state.tags = (await SB.listMovementTags(urls)) || {};
          else if (typeof SB.listImageTags === "function") state.tags = (await SB.listImageTags(urls)) || {};
        } catch (e) { state.tags = {}; }
      }

      renderFilter();
      renderCats();
      renderPools();
    } catch (e) {
      $("#cmp-body").innerHTML = '<div class="rk-empty">读取失败，请刷新重试</div>';
    } finally {
      state.loading = false;
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
      b.onclick = function () { state.month = v; renderFilter(); renderCats(); renderPools(); };
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
      b.onclick = function () { state.cat = name; renderCats(); renderPools(); };
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
  function visibleList(s) {
    return sourceItems(s).filter(function (r) {
      return (!state.month || r.month === state.month) && (state.cat === ALL || r.category === state.cat);
    });
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
  function openInsight(key) {
    if (!window.CmpInsight || typeof window.CmpInsight.open !== "function") {
      toast("分析组件未加载，请刷新页面后重试", false);
      return;
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

  function renderPools() {
    var body = $("#cmp-body");
    var bar = $("#cmp-bar");
    if (!body) return;
    var srcs = activeSources();
    var cat = state.cat;

    var total = 0;
    srcs.forEach(function (s) {
      total += sourceItems(s).filter(function (r) {
        return (!state.month || r.month === state.month) && (cat === ALL || r.category === cat);
      }).length;
    });

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
      body.innerHTML = '<div class="rk-empty">这个月份 / 类目下还没有图片，换个月份或类目试试。</div>';
      return;
    }

    var pr = perRowOf(srcs.length);
    var html = '<div class="rk-pools">';
    srcs.forEach(function (s) {
      var list = sourceItems(s).filter(function (r) {
        return (!state.month || r.month === state.month) && (cat === ALL || r.category === cat);
      });
      html += '<section class="rk-pool" data-src="' + esc(s.key) + '">';
      html += '<div class="rk-pool-head"><div class="rk-pool-name"><span>' + esc(s.label) +
        '</span><span class="rk-n">' + list.length + " 张</span></div>" +
        '<div class="rk-pool-meta">' + esc(s.type === "rank" ? "月度榜单" : "渠道图") +
        (state.month ? " · " + esc(state.month) : "") +
        (list.length ? ' <button type="button" class="cmi-btn" data-insight="' + esc(s.key) +
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
