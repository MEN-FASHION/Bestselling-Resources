/* ============================================================================
 * channel-front.js —— 渠道雷达 · 渠道对比（20261031A）
 *
 * 和「趋势上升榜」的区别只有一处：
 *   榜单的对比池是「一列 = 一个周次」，这里是「一列 = 一个渠道（平台）」；
 *   周次从"列"变成了顶部的筛选条件。
 * 其余全部复用既有口径：
 *   图片清单 → channel_items
 *   打标结果 → rank_image_tags（与榜单、趋势动向共用，按图片地址关联）
 *   标签枚举 → rank-enums.js 的 window.APP_ENUM（与两个专区同一份）
 * 页面只读，不提供任何写操作。
 * ==========================================================================*/
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function SBx() { return window.SB || null; }
  function toast(msg, ok) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "toast show" + (ok === false ? " bad" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = "toast"; }, 2600);
  }

  var CAP_STEP = 48;          // 每列首批展示张数
  var COLS_MAX = 8;           // 对比列数上限（再多每列就只剩一条缝）

  var state = {
    sites: [],        // 后台维护的渠道字典
    items: [],        // channel_items
    tags: {},         // url -> 打标记录
    cat: "全部",
    week: "",         // "" = 全部周次
    sel: [],          // 选中的渠道（列）
    cap: {},          // 每列已展开到多少张
    vis: {},          // 前台标签可见性
    loading: false,
    ready: false
  };

  /* 标签维度：与趋势动向、榜单面板同序 */
  var GROUPS = [
    ["风格", ["style_tags"]],
    ["视觉", ["visual_tags"]],
    ["图案元素", ["element_tags"]],
    ["二次工艺", ["craft_tags"]],
    ["拍摄方式", ["shoot_tags"]],
    ["模特", ["skin_tags"]],
    ["版型", ["fit_tags"]],
    ["文化背景", ["culture_tags"]],
    ["消费心理", ["psych_tags"]],
    ["渠道", ["tags"]],
    ["节日", ["festival_tags"]]
  ];
  var DIM_TOTAL = GROUPS.length;
  function visOn(key) { return state.vis[key] !== false; }
  function shownGroups() { return GROUPS.filter(function (g) { return g[1].some(visOn); }); }

  function imgUrl(it) {
    var SB = SBx();
    return (SB && SB.imageUrl) ? SB.imageUrl({ path: it.path }) : String(it.image_url || "");
  }

  /* ---------------- 数据 ---------------- */
  async function load() {
    var SB = SBx();
    if (!SB || state.loading) return;
    state.loading = true;
    try {
      var pair = await Promise.all([
        SB.listChannelItems(),
        SB.listChannelSites(false).catch(function () { return []; })
      ]);
      state.items = Array.isArray(pair[0]) ? pair[0] : [];
      state.sites = Array.isArray(pair[1]) ? pair[1] : [];
      try { state.vis = (await SB.getChannelTagVisibility()) || {}; } catch (e) { state.vis = {}; }

      var urls = state.items.map(function (r) { return r.image_url; }).filter(Boolean);
      state.tags = {};
      if (urls.length) {
        try { state.tags = (await SB.listChannelTags(urls)) || {}; } catch (e) { state.tags = {}; }
      }
      state.ready = true;
      /* 默认周次 = 有图的最新一周：进页面先看到"当下这一周各渠道长什么样" */
      if (state.week === "" && !state.pickedWeek) {
        var weeks = weekList();
        if (weeks.length) { state.week = weeks[0].label; state.pickedWeek = true; }
      }
      renderWeeks();
      renderCats();
      if (!state.pickedChannels) pickDefaultChannels();
      renderChannels();
      renderPools();
    } catch (e) {
      $("#ch-body").innerHTML = '<div class="rk-empty">读取失败，请刷新重试（数据库补丁是否已执行？）</div>';
    } finally {
      state.loading = false;
    }
  }

  /* 周次列表：按 week_sort 倒序（新周在前），去重 */
  function weekList() {
    var map = {};
    state.items.forEach(function (r) {
      var lb = String(r.week_label || "").trim();
      if (!lb) return;
      var s = Number(r.week_sort) || 0;
      if (!map[lb] || s > map[lb]) map[lb] = s;
    });
    return Object.keys(map).map(function (k) { return { label: k, sort: map[k] }; })
      .sort(function (a, b) { return b.sort - a.sort; });
  }
  function weekCount(label) {
    if (!label) return state.items.length;
    return state.items.filter(function (r) { return String(r.week_label || "") === label; }).length;
  }

  function renderWeeks() {
    var box = $("#ch-weeks");
    if (!box) return;
    box.innerHTML = "";
    var mk = function (label, text, n, on) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ch-chip" + (on ? " is-on" : "") + (n ? "" : " is-empty");
      b.innerHTML = esc(text) + (n != null ? ' <span class="ch-chip-n">' + n + "</span>" : "");
      b.onclick = function () { state.week = label; state.cap = {}; renderWeeks(); renderCats(); renderChannels(); renderPools(); };
      box.appendChild(b);
    };
    mk("", "全部周次", state.items.length, state.week === "");
    var weeks = weekList();
    if (!weeks.length) {
      var t = document.createElement("span");
      t.className = "hint-inline";
      t.textContent = "还没有带周次的图片";
      box.appendChild(t);
      return;
    }
    weeks.forEach(function (w) { mk(w.label, w.label, weekCount(w.label), state.week === w.label); });
  }

  /* 类目菜单：计数按「当前周次」算，点了就知道这一周这个类目有几张 */
  function catCount(name) {
    return state.items.filter(function (r) {
      if (state.week && String(r.week_label || "") !== state.week) return false;
      if (name && (r.category || "未分类") !== name) return false;
      return true;
    }).length;
  }
  function renderCats() {
    var box = $("#ch-cats");
    if (!box) return;
    box.innerHTML = "";
    var cnt = {};
    state.items.forEach(function (r) {
      if (state.week && String(r.week_label || "") !== state.week) return;
      var c = r.category || "未分类";
      cnt[c] = (cnt[c] || 0) + 1;
    });
    var names = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
    var add = function (name, n, isAll) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cat-menu-item" + (state.cat === name ? " active" : "");
      b.innerHTML = esc(isAll ? "全部" : name) + ' <span class="ch-cat-n">' + n + "</span>";
      b.onclick = function () { state.cat = name; state.cap = {}; renderCats(); renderChannels(); renderPools(); };
      box.appendChild(b);
    };
    add("全部", catCount(""), true);
    if (!names.length) {
      var t = document.createElement("div");
      t.className = "cat-menu-tip";
      t.textContent = "该周次暂无图片";
      box.appendChild(t);
      return;
    }
    names.forEach(function (c) { add(c, cnt[c]); });
  }

  /* 渠道清单：后台字典里「启用」的按 sort_order 出列。
     两类特殊处理：
       1) 后台「隐藏」的渠道 → 前台完全不出现（连同它的图），这是隐藏按钮应有的效果；
       2) 字典里根本没有、但库里还有图的渠道（字典被删过）→ 补在最后，
          否则那批历史图片会凭空消失，运营也没法再改回来。 */
  function channelOrder() {
    var names = [], seen = {};
    state.sites.forEach(function (s) {
      var n = String(s.name || "").trim();
      if (!n || seen[n]) return;
      seen[n] = 1;                     /* 停用的也记入 seen，下面就不会被"补回来" */
      if (s.active === false) return;  /* 但不出列 */
      names.push(n);
    });
    var extra = {};
    state.items.forEach(function (r) {
      var n = String(r.channel || "").trim() || "未分渠道";
      if (!seen[n]) extra[n] = (extra[n] || 0) + 1;
    });
    Object.keys(extra).sort(function (a, b) { return extra[b] - extra[a]; })
      .forEach(function (n) { seen[n] = 1; names.push(n); });
    return names;
  }
  function chItems(name) {
    return state.items.filter(function (r) {
      var c = String(r.channel || "").trim() || "未分渠道";
      if (c !== name) return false;
      if (state.cat !== "全部" && (r.category || "未分类") !== state.cat) return false;
      if (state.week && String(r.week_label || "") !== state.week) return false;
      return true;
    });
  }
  /* 首次进入：挑当前筛选下「有图的前 3 个渠道」，避免一进来先看三列空白 */
  function pickDefaultChannels() {
    var names = channelOrder().filter(function (n) { return chItems(n).length > 0; });
    if (!names.length) names = channelOrder().slice(0, 3);
    state.sel = names.slice(0, 3);
    state.pickedChannels = true;
  }

  function renderChannels() {
    var box = $("#ch-channels");
    if (!box) return;
    box.innerHTML = "";
    var names = channelOrder();
    if (!names.length) {
      var t = document.createElement("span");
      t.className = "hint-inline";
      t.textContent = "后台还没有配置渠道";
      box.appendChild(t);
      return;
    }
    names.forEach(function (n) {
      var on = state.sel.indexOf(n) >= 0;
      var n0 = chItems(n).length;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ch-chip" + (on ? " is-on" : "") + (n0 ? "" : " is-empty");
      b.innerHTML = esc(n) + ' <span class="ch-chip-n">' + n0 + "</span>";
      b.title = on ? "点击取消对比" : "点击加入对比";
      b.onclick = function () {
        var i = state.sel.indexOf(n);
        if (i >= 0) state.sel.splice(i, 1);
        else {
          if (state.sel.length >= COLS_MAX) { toast("最多同时对比 " + COLS_MAX + " 个渠道", false); return; }
          state.sel.push(n);
        }
        state.cap = {};
        renderChannels(); renderPools();
      };
      box.appendChild(b);
    });
  }

  /* 单张卡：与榜单的 .rk-card 同一套尺寸与交互（点击看大图 + 标签） */
  function cardHtml(it) {
    var t = state.tags[it.image_url] || {};
    var done = shownGroups().filter(function (g) {
      return g[1].some(function (f) { return (t[f] || []).length; });
    }).length;
    var wk = String(it.week_label || "");
    return '<figure class="rk-card" data-url="' + esc(it.image_url) + '" title="' + esc((it.title || "") + (wk ? " · " + wk : "")) + '">'
      + '<img loading="lazy" src="' + esc(imgUrl(it)) + '" alt="' + esc(it.title || "渠道图片") + '">'
      + (wk && !state.week ? '<span class="ch-wk">' + esc(wk) + "</span>" : "")
      + '<span class="rk-badge flag-opportunity" style="opacity:.92">' + done + "/" + DIM_TOTAL + "</span>"
      + "</figure>";
  }

  function renderPools() {
    var body = $("#ch-body");
    var bar = $("#ch-bar");
    if (!body) return;
    var cols = state.sel.slice();
    var total = cols.reduce(function (s, n) { return s + chItems(n).length; }, 0);

    if (bar) {
      bar.innerHTML = state.sel.length
        ? '<span class="rk-bar-info">对比 <b>' + state.sel.length + "</b> 个渠道 · 类目 <b>" + esc(state.cat === "全部" ? "全部" : state.cat) +
          "</b> · 周次 <b>" + esc(state.week || "全部") + "</b> · 共 <b>" + total + "</b> 张</span>" +
          '<span class="hint-inline">点图片看大图与标签</span>'
        : '<span class="rk-bar-info">请在上方选择要对比的渠道</span>';
    }

    if (!cols.length) {
      body.innerHTML = '<div class="rk-empty">还没有选择渠道：点筛选条里的渠道名即可加入对比</div>';
      return;
    }

    var out = ['<div class="rk-pools">'];
    cols.forEach(function (name) {
      var list = chItems(name);
      var cap = state.cap[name] || CAP_STEP;
      var shown = list.slice(0, cap);
      var tagged = list.filter(function (r) {
        var t = state.tags[r.image_url] || {};
        return shownGroups().some(function (g) { return g[1].some(function (f) { return (t[f] || []).length; }); });
      }).length;
      var cover = list.length ? Math.round(tagged / list.length * 100) : 0;
      var meta = [];
      if (state.cat !== "全部") meta.push(state.cat);
      if (state.week) meta.push(state.week);
      meta.push("打标覆盖 " + cover + "%");

      out.push('<section class="rk-pool ch-pool">');
      out.push('<div class="rk-pool-head"><div class="rk-pool-name"><span><i class="ch-dot"></i>' + esc(name) + "</span>" +
        '<span class="rk-n">' + list.length + " 张</span></div>" +
        '<div class="rk-pool-meta">' + esc(meta.join(" · ")) + "</div></div>");
      out.push('<div class="rk-pool-grid">' +
        (shown.length ? shown.map(cardHtml).join("") : '<div class="ch-card-empty">该渠道这一筛选下暂无图片</div>') + "</div>");
      if (list.length > shown.length) {
        out.push('<div class="rk-more-wrap"><button type="button" class="rk-loadmore" data-more="' + esc(name) + '">' +
          "展开更多（已展示 " + shown.length + " / " + list.length + "）</button></div>");
      }
      out.push("</section>");
    });
    out.push("</div>");
    body.innerHTML = out.join("");

    Array.prototype.slice.call(body.querySelectorAll(".rk-loadmore")).forEach(function (b) {
      b.onclick = function () {
        var n = b.getAttribute("data-more");
        state.cap[n] = (state.cap[n] || CAP_STEP) + CAP_STEP * 2;
        renderPools();
      };
    });
    Array.prototype.slice.call(body.querySelectorAll(".rk-card")).forEach(function (c) {
      c.onclick = function () {
        var u = c.getAttribute("data-url");
        var it = state.items.filter(function (x) { return x.image_url === u; })[0];
        if (it) openModal(it);
      };
    });
  }

  /* ---------------- 大图 + 标签 ---------------- */
  function splitFit(arr) {
    var out = {};
    (arr || []).forEach(function (x) {
      var s = String(x), i = s.indexOf("·");
      if (i < 0) return;
      var k = s.slice(0, i), v = s.slice(i + 1);
      (out[k] = out[k] || []).push(v);
    });
    return out;
  }

  function openModal(it) {
    var t = state.tags[it.image_url] || {};
    var big = $("#ch-big");
    if (big) big.src = imgUrl(it);
    var title = $("#ch-title");
    if (title) {
      title.textContent = [it.channel, it.week_label, it.category, it.title].filter(Boolean).join(" · ");
    }
    var box = $("#ch-tags");
    box.innerHTML = "";
    var fit = splitFit(t.fit_tags);
    var any = false;
    shownGroups().forEach(function (g) {
      var name = g[0], fields = g[1], vals = [];
      if (name === "版型") {
        Object.keys(fit).forEach(function (k) { if (fit[k].length) vals.push(k + "：" + fit[k].join("、")); });
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
    $("#ch-modal").classList.remove("hidden");
  }
  function closeModal() {
    var m = $("#ch-modal");
    if (m) m.classList.add("hidden");
  }

  function bind() {
    var c = $("#ch-close");
    if (c) c.onclick = closeModal;
    var m = $("#ch-modal");
    if (m) m.onclick = function (e) { if (e.target === m) closeModal(); };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

    var all = $("#ch-ch-all");
    if (all) all.onclick = function () {
      var names = channelOrder().filter(function (n) { return chItems(n).length > 0; });
      if (names.length > COLS_MAX) {
        toast("最多同时对比 " + COLS_MAX + " 个渠道，已取前 " + COLS_MAX + " 个", false);
        names = names.slice(0, COLS_MAX);
      }
      state.sel = names;
      state.cap = {};
      renderChannels(); renderPools();
    };
    var none = $("#ch-ch-none");
    if (none) none.onclick = function () { state.sel = []; state.cap = {}; renderChannels(); renderPools(); };
  }

  /* 导航与登录态交给公共模块，保证和其他前台页一致 */
  async function boot() {
    bind();
    var SB = SBx();
    try {
      var s = SB && SB.client && SB.client.auth ? await SB.client.auth.getSession() : null;
      var sess = s && s.data && s.data.session;
      if (!sess) { location.replace("index.html"); return; }
      var u = $("#ch-user");
      if (u) { u.textContent = (sess.user && sess.user.email) || ""; u.classList.remove("hidden"); }
      var lo = $("#ch-logout");
      if (lo) {
        lo.classList.remove("hidden");
        lo.onclick = async function () { try { await SB.client.auth.signOut(); } catch (e) {} location.href = "index.html"; };
      }
    } catch (e) { /* 无会话信息时仍尝试渲染 */ }
    try {
      if (window.Common && Common.zones && Common.zones.loadDefs) await Common.zones.loadDefs();
      if (SB && SB.getFrontendZoneVisibility) {
        var v = await SB.getFrontendZoneVisibility();
        if (window.Common && Common.zones && Common.zones.setVis) Common.zones.setVis(v || {});
      }
      if (window.Common && Common.zones && Common.zones.applyNav) Common.zones.applyNav();
    } catch (e) { /* 导航显隐失败不影响图片展示 */ }
    var tabs = document.querySelector(".top-tabs");
    if (tabs) tabs.classList.remove("is-booting");
    await load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
