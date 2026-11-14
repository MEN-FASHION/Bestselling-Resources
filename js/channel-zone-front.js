/* ============================================================================
 * channel-zone-front.js —— 渠道图片专区（Pinterest / SHEIN）前台
 * ----------------------------------------------------------------------------
 * 定位：与「趋势上升榜」同构的纯图片专区 ——
 *   左侧「服装类目」菜单栏（与趋势上升榜一致）
 *   上方筛选项只保留「月度」
 *   右侧图片卡片；点图看大图 + 按维度分组的打标结果
 *
 * 数据来源不另起一套（传图在后台这两个专区里做）：
 *   图片本体 → SB.listRankChannelPics({ periodType:"month" }) 里 channel = 本专区渠道的那批
 *   打标结果 → rank_image_tags（按图片地址，与榜单 / 品牌动向共用）
 * 页面只读，不提供任何写操作。
 *
 * 由页面声明 window.CZONE = { key, label, channel } 决定展示哪个渠道。
 * ==========================================================================*/
(function () {
  "use strict";

  var CFG = window.CZONE || {};
  var KEY = String(CFG.key || "pinterest");
  var LABEL = String(CFG.label || "Pinterest 专区");
  var CH = String(CFG.channel || "Pinterest");

  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  function SBx() { return window.SB || null; }

  var state = {
    items: [],        // { id, image_url, category, period_label }
    tags: {},         // url -> 打标记录
    months: [],       // 归一后的月份，倒序
    cat: "全部",
    month: "",        // 空 = 全部月份
    vis: true,        // 当前账号是否可见本专区
    gate: "",         // 未开放原因（空 = 正常）
    loading: false,
  };

  /* 展示顺序按语义分组；空维度直接不显示。
     渠道维度不在前台出现 —— 本专区本身就是某个渠道。 */
  var GROUPS = [
    ["风格", ["style_tags"]],
    ["视觉", ["visual_tags"]],
    ["图案类型", ["pattern_tags"]],
    ["图案元素", ["element_tags"]],
    ["结构部件", ["struct_tags"]],
    ["面料", ["fabric_tags"]],
    ["二次工艺", ["craft_tags"]],
    ["拍摄方式", ["shoot_tags"]],
    ["模特", ["skin_tags"]],
    ["版型", ["fit_tags"]],
    ["文化背景", ["culture_tags"]],
    ["消费心理", ["psych_tags"]],
    ["节日", ["festival_tags"]]
  ];
  var ALL_DIMS = ["style_tags", "visual_tags", "pattern_tags", "element_tags", "struct_tags",
    "fabric_tags", "craft_tags", "shoot_tags", "skin_tags", "fit_tags",
    "culture_tags", "psych_tags", "festival_tags"];

  function toast(msg, ok) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "toast show" + (ok === false ? " bad" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = "toast"; }, 2400);
  }

  function normMonth(v) {
    var SB = SBx();
    if (SB && typeof SB._normMonth === "function") {
      try { return SB._normMonth(v); } catch (e) { /* 退回本地实现 */ }
    }
    var s = String(v || "").trim();
    var m = s.match(/(20\d{2})\D{0,2}(\d{1,2})/);
    if (!m) return s;
    return m[1] + "-" + String(parseInt(m[2], 10)).padStart(2, "0");
  }

  function sameChannel(v) {
    var a = String(v || "").replace(/[\s_\-]/g, "").toLowerCase();
    var b = String(CH).replace(/[\s_\-]/g, "").toLowerCase();
    return !!a && !!b && a === b;
  }

  function imgUrl(it) {
    var u = String(it.image_url || it.u || "");
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    var base = String((window.CONFIG && window.CONFIG.WORKER_URL) || "").replace(/\/$/, "");
    return base ? base + "/" + u.replace(/^\/+/, "") : u;
  }

  function splitFit(arr) {
    var out = {};
    (arr || []).forEach(function (x) {
      var s = String(x);
      var i = s.indexOf("·");
      if (i < 0) return;
      var k = s.slice(0, i), v = s.slice(i + 1);
      (out[k] = out[k] || []).push(v);
    });
    return out;
  }

  /* ---------- 读取 ---------- */
  async function load() {
    var SB = SBx();
    if (!SB || state.loading) return;
    state.loading = true;
    $("#cz-body").innerHTML = '<div class="rk-empty">加载中…</div>';
    try {
      var rows = [];
      if (typeof SB.listRankChannelPics === "function") {
        rows = await SB.listRankChannelPics({ periodType: "month" });
      }
      var list = (rows || []).filter(function (r) { return sameChannel(r.channel); })
        .map(function (r) {
          return {
            id: r.id || ("cp:" + r.image_url),
            image_url: imgUrl(r),
            category: String(r.category || "").trim(),
            month: normMonth(r.period_label || r.m || ""),
            channel: String(r.channel || "").trim(),
          };
        })
        .filter(function (r) { return r.image_url && r.category; });

      /* 同一张图只留一条 */
      var seen = {}, uniq = [];
      list.forEach(function (r) { if (!seen[r.image_url]) { seen[r.image_url] = 1; uniq.push(r); } });
      state.items = uniq;

      /* 月份清单（倒序）+ 打标结果 */
      var ms = {};
      uniq.forEach(function (r) { if (r.month) ms[r.month] = 1; });
      state.months = Object.keys(ms).sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });

      state.tags = {};
      var urls = uniq.map(function (r) { return r.image_url; }).filter(Boolean);
      if (urls.length) {
        try {
          if (typeof SB.listMovementTags === "function") state.tags = (await SB.listMovementTags(urls)) || {};
          else if (typeof SB.listImageTags === "function") state.tags = (await SB.listImageTags(urls)) || {};
        } catch (e) { state.tags = {}; }
      }

      renderFilter();
      renderCats();
      renderGrid();
    } catch (e) {
      $("#cz-body").innerHTML = '<div class="rk-empty">读取失败，请刷新重试</div>';
    } finally {
      state.loading = false;
    }
  }

  /* ---------- 上方筛选：只保留「月度」 ---------- */
  function renderFilter() {
    var box = $("#cz-groups");
    var sum = $("#cz-summary");
    if (!box) return;
    box.innerHTML = "";
    var group = document.createElement("div");
    group.className = "tag-group";
    var name = document.createElement("div");
    name.className = "tag-group-name";
    name.textContent = "月度";
    var chips = document.createElement("div");
    chips.className = "tag-chips";

    function chip(val, text) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tag-chip" + (state.month === val ? " active" : "");
      b.textContent = text;
      b.onclick = function () {
        state.month = val;
        renderFilter();
        renderCats();
        renderGrid();
      };
      return b;
    }
    chips.appendChild(chip("", "全部月份"));
    if (!state.months.length) {
      var tip = document.createElement("span");
      tip.className = "tag-chip";
      tip.style.opacity = ".55";
      tip.textContent = "暂无月份";
      chips.appendChild(tip);
    }
    state.months.forEach(function (m) { chips.appendChild(chip(m, m)); });
    group.appendChild(name);
    group.appendChild(chips);
    box.appendChild(group);

    if (sum) sum.textContent = "月度" + (state.month ? "：" + state.month : "：全部");
  }

  /* ---------- 左侧：服装类目（与趋势上升榜一致） ---------- */
  function monthFiltered() {
    return state.items.filter(function (r) { return !state.month || r.month === state.month; });
  }

  function renderCats() {
    var nav = $("#cz-cats");
    if (!nav) return;
    var list = monthFiltered();
    var cnt = {};
    list.forEach(function (r) { cnt[r.category] = (cnt[r.category] || 0) + 1; });
    var names = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
    nav.innerHTML = "";

    function add(name, count) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cat-menu-item" + (state.cat === name ? " active" : "");
      b.innerHTML = esc(name) + (count != null ? ' <span class="cvi-state">' + count + "</span>" : "");
      b.onclick = function () { state.cat = name; renderCats(); renderGrid(); };
      nav.appendChild(b);
    }
    add("全部", list.length);
    if (!names.length) {
      var t = document.createElement("div");
      t.className = "cat-menu-tip";
      t.textContent = "暂无类目";
      nav.appendChild(t);
      return;
    }
    names.forEach(function (c) { add(c, cnt[c]); });
  }

  /* ---------- 右侧：图片网格 ---------- */
  function visibleItems() {
    return monthFiltered().filter(function (r) {
      return state.cat === "全部" || r.category === state.cat;
    });
  }

  function renderGrid() {
    var body = $("#cz-body");
    var bar = $("#cz-bar");
    if (!body) return;
    var list = visibleItems();
    var tagged = list.filter(function (r) {
      var t = state.tags[r.image_url] || {};
      return ALL_DIMS.some(function (k) { return (t[k] || []).length; });
    }).length;
    if (bar) {
      bar.innerHTML = '<span class="rk-bar-info">共 <b>' + list.length + "</b> 张 · 已打标 <b>" +
        tagged + "</b> 张" + (state.month ? " · " + esc(state.month) : "") + "</span>";
    }
    if (!list.length) {
      body.innerHTML = '<div class="rk-empty">这个筛选下还没有图片，去后台「' + esc(LABEL) + "」传图吧</div>";
      return;
    }
    body.innerHTML = '<div class="grid" id="cz-grid"></div>';
    var grid = $("#cz-grid");
    list.forEach(function (it) {
      /* 20261114G：卡片右下角不再显示「已打标 n/13」——前台是给运营选图看的，
         这张打标了没有跟他们无关，一屏几十个数字反而干扰判断。进度仍在顶部计数条里。 */
      var cat = it.category || "未分类";
      var mon = it.month || "";
      var card = document.createElement("div");
      card.className = "mv-card";
      card.setAttribute("data-url", it.image_url || "");
      card.setAttribute("data-cat", cat);
      card.setAttribute("data-period", mon);
      card.setAttribute("data-title", cat + (mon ? " · " + mon : ""));
      card.innerHTML =
        '<div class="mv-card-img"><img loading="lazy" src="' + esc(it.image_url) + '" alt="' + esc(cat) + '">' +
        (mon ? '<span class="mv-season-badge">' + esc(mon) + "</span>" : "") + "</div>" +
        '<div class="mv-card-meta"><span class="mv-card-cat">' + esc(cat) + "</span></div>";
      card.onclick = function () { openModal(it); };
      grid.appendChild(card);
    });
    /* 图全部渲染完再复查一次导出权限：页面刚打开时登录态可能还没恢复，
       一次性检查会让「明明授权了却看不到导出按钮」变成常态。 */
    try { window.VX && window.VX.recheck && window.VX.recheck(); } catch (e) {}
  }

  /* ---------- 大图 + 打标结果 ---------- */
  function openModal(it) {
    var t = state.tags[it.image_url] || {};
    var big = $("#cz-big");
    if (big) big.src = it.image_url;
    var title = $("#cz-title");
    if (title) title.textContent = (it.category || "未分类") + (it.month ? " · " + it.month : "");
    var box = $("#cz-tags");
    if (!box) return;
    box.innerHTML = "";
    var fit = splitFit(t.fit_tags);
    var any = false;
    GROUPS.forEach(function (g) {
      var name = g[0], fields = g[1], vals = [];
      if (name === "版型") {
        Object.keys(fit).forEach(function (k) {
          if (fit[k].length) vals.push(k + "：" + fit[k].join("、"));
        });
      } else {
        fields.forEach(function (f) {
          (t[f] || []).forEach(function (v) { if (vals.indexOf(v) < 0) vals.push(v); });
        });
      }
      if (!vals.length) return;
      any = true;
      var row = document.createElement("div");
      row.className = "mv-tag-row";
      row.innerHTML = '<div class="mv-tag-k">' + esc(name) + '</div><div class="mv-tag-v">' +
        vals.map(function (v) { return '<span class="mv-chip">' + esc(v) + "</span>"; }).join("") + "</div>";
      box.appendChild(row);
    });
    if (!any) box.innerHTML = '<div class="mv-empty-tag">这张图还没有打标</div>';
    $("#cz-modal").classList.remove("hidden");
  }

  function closeModal() {
    var m = $("#cz-modal");
    if (m) m.classList.add("hidden");
  }

  function bind() {
    var c = $("#cz-close");
    if (c) c.onclick = closeModal;
    var m = $("#cz-modal");
    if (m) m.onclick = function (e) { if (e.target === m) closeModal(); };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  }

  /* ---------- 启动：登录态 + 专区可见性 ---------- */
  async function boot() {
    bind();
    var SB = SBx();
    try {
      var s = SB && SB.client && SB.client.auth ? await SB.client.auth.getSession() : null;
      var sess = s && s.data && s.data.session;
      if (!sess) { location.replace("index.html"); return; }
      var u = $("#cz-user");
      if (u) { u.textContent = (sess.user && sess.user.email) || ""; u.classList.remove("hidden"); }
      var lo = $("#cz-logout");
      if (lo) {
        lo.classList.remove("hidden");
        lo.onclick = async function () { try { await SB.client.auth.signOut(); } catch (e) {} location.href = "index.html"; };
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
      /* 两级守门：全站开关 → 用户级白名单 */
      if (vis && vis[KEY] === false) {
        state.gate = "全站开关：该专区已在后台「前台访问设置」中被关闭";
      } else if (Array.isArray(myz) && myz.length && myz.indexOf(KEY) === -1) {
        state.gate = "账号授权：你的账号未获授权访问本专区";
      }
      if (window.Common && Common.visit) { try { Common.visit.track(KEY); } catch (e0) {} }
    } catch (e) { /* 导航显隐失败不影响图片展示 */ }

    var tabs = document.querySelector(".top-tabs");
    if (tabs) tabs.classList.remove("is-booting");

    if (!state.vis || state.gate) {
      $("#cz-cats").innerHTML = '<div class="cat-menu-tip">未开放</div>';
      $("#cz-body").innerHTML = '<div class="rk-empty">' +
        esc(state.gate || ("该专区暂未对你开放，请联系管理员开通「" + LABEL + "」")) + "</div>";
      var bar0 = $("#cz-bar");
      if (bar0) bar0.innerHTML = "";
      return;
    }
    await load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
