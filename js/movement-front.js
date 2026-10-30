/* 趋势动向 · 前台展示
   ------------------------------------------------------------
   数据来源与其他专区一致，不另起一套：
     图片清单 → movement_items（与图库、榜单各自独立）
     打标结果 → rank_image_tags（与榜单共用，按图片地址关联）
   页面只读，不提供任何写操作。 */

(function () {
  "use strict";

  var state = { items: [], tags: {}, cat: "全部", year: "", season: "", vis: {}, loading: false };
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  var SEASONS = ["春", "夏", "秋", "冬"];
  function yearOptions() {
    var now = new Date().getFullYear();
    var out = [];
    for (var y = now + 1; y >= now - 6; y--) out.push(y);
    return out;
  }
  /* 某维度是否允许前台展示；后台把它关掉后，这里就不再渲染这一组 */
  function visOn(key) { return state.vis[key] !== false; }
  function shownGroups() {
    return GROUPS.filter(function (g) {
      return g[1].some(function (f) { return visOn(f); });
    });
  }

  /* 展示顺序按语义分组，空维度直接不显示，避免右侧一片"未填写" */
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

  function SBx() { return window.SB || null; }
  function toast(msg, ok) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "toast show" + (ok === false ? " bad" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = "toast"; }, 2600);
  }

  /* 版型是复合标签（如「领型·圆领」），展示时拆出部位名更易读 */
  function splitFit(arr) {
    var out = { 领型: [], 袖型: [], 袖长: [], 衣长: [], 松紧度: [], 裤型: [], 裤长: [], 裙长: [], 腰型: [] };
    (arr || []).forEach(function (x) {
      var s = String(x);
      var i = s.indexOf("·");
      if (i < 0) return;
      var k = s.slice(0, i), v = s.slice(i + 1);
      if (out[k]) out[k].push(v);
    });
    return out;
  }

  function tagsOf(t) { return t || {}; }

  function imgUrl(it) {
    var SB = SBx();
    return (SB && SB.imageUrl) ? SB.imageUrl({ path: it.path }) : String(it.image_url || "");
  }

  async function load() {
    var SB = SBx();
    if (!SB) return;
    state.loading = true;
    try {
      /* 图片清单与「标签前台可见性」并行取；可见性取不到时按全部展示处理 */
      var pair = await Promise.all([
        SB.listMovementItems(),
        (async function () {
          try { return (await SB.getMovementTagVisibility()) || {}; } catch (e) { return {}; }
        })(),
      ]);
      var items = pair[0];
      state.vis = pair[1] || {};
      state.items = Array.isArray(items) ? items : [];
      var urls = state.items.map(function (x) { return x.image_url; }).filter(Boolean);
      if (urls.length) {
        try { state.tags = (await SB.listMovementTags(urls)) || {}; }
        catch (e) { state.tags = {}; }
      }
      fillFilters();
      renderCats();
      renderGrid();
    } catch (e) {
      $("#mv-body").innerHTML = '<div class="rk-empty">读取失败，请刷新重试</div>';
    } finally {
      state.loading = false;
    }
  }

  /* 年度 / 季节筛选：选项来自库中实际存在的值，避免给出选了没结果的空档 */
  function fillFilters() {
    var ys = {}, ss = {};
    state.items.forEach(function (r) {
      var y = Number(r.season_year) || 0;
      if (y) ys[y] = 1;
      var s = String(r.season || "").trim();
      if (s) ss[s] = 1;
    });
    var fy = $("#mv-f-year");
    if (fy) {
      var keepY = state.year;
      fy.innerHTML = "";
      fy.add(new Option("全部年度", ""));
      Object.keys(ys).map(Number).sort(function (a, b) { return b - a; }).forEach(function (y) {
        fy.add(new Option(y + " 年", String(y)));
      });
      fy.value = keepY || "";
      fy.onchange = function () { state.year = fy.value || ""; renderGrid(); };
    }
    var fs = $("#mv-f-season");
    if (fs) {
      var keepS = state.season;
      fs.innerHTML = "";
      fs.add(new Option("全部季节", ""));
      SEASONS.forEach(function (s) { if (ss[s]) fs.add(new Option(s, s)); });
      fs.value = keepS || "";
      fs.onchange = function () { state.season = fs.value || ""; renderGrid(); };
    }
  }

  function catList() {
    var m = {};
    state.items.forEach(function (it) { if (it.category) m[it.category] = (m[it.category] || 0) + 1; });
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
  }

  function renderCats() {
    var box = $("#mv-cats");
    if (!box) return;
    var cats = catList();
    box.innerHTML = "";
    function add(name, count) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cat-menu-item" + (state.cat === name ? " active" : "");
      b.innerHTML = esc(name) + (count != null ? ' <span class="cvi-state">' + count + "</span>" : "");
      b.onclick = function () { state.cat = name; renderCats(); renderGrid(); };
      box.appendChild(b);
    }
    add("全部", state.items.length);
    if (!cats.length) {
      var t = document.createElement("div");
      t.className = "cat-menu-tip";
      t.textContent = "暂无类目";
      box.appendChild(t);
    }
    cats.forEach(function (c) {
      var n = state.items.filter(function (i) { return i.category === c; }).length;
      add(c, n);
    });
  }

  function renderGrid() {
    var body = $("#mv-body");
    var bar = $("#mv-bar");
    if (!body) return;
    var list = state.items.filter(function (it) {
      if (state.cat !== "全部" && it.category !== state.cat) return false;
      if (state.year && String(Number(it.season_year) || 0) !== String(state.year)) return false;
      if (state.season && String(it.season || "") !== state.season) return false;
      return true;
    });
    if (bar) bar.textContent = "共 " + list.length + " 张";
    if (!list.length) {
      body.innerHTML = '<div class="rk-empty">这个筛选下还没有图片</div>';
      return;
    }
    body.innerHTML = "";
    list.forEach(function (it) {
      var t = tagsOf(state.tags[it.image_url]);
      var shown = shownGroups();
      var done = shown.filter(function (g) {
        return g[1].some(function (f) { return (t[f] || []).length; });
      }).length;
      var sea = seasonLabel(it);
      var card = document.createElement("div");
      card.className = "mv-card";
      card.innerHTML =
        '<div class="mv-card-img"><img loading="lazy" src="' + esc(imgUrl(it)) + '" alt="' + esc(it.title || "") + '">' +
        (sea ? '<span class="mv-season-badge">' + esc(sea) + "</span>" : "") +
        "</div>" +
        '<div class="mv-card-meta"><span class="mv-card-cat">' + esc(it.category || "未分类") + "</span>" +
        '<span class="mv-card-done">' + done + "/" + shown.length + "</span></div>";
      card.onclick = function () { openModal(it); };
      body.appendChild(card);
    });
  }

  function seasonLabel(it) {
    var y = Number(it.season_year) || 0;
    var s = String(it.season || "").trim();
    if (!y && !s) return "";
    if (y && s) return y + " " + s;
    return y ? (y + " 年") : s;
  }

  function openModal(it) {
    var t = tagsOf(state.tags[it.image_url]);
    var big = $("#mv-big");
    if (big) big.src = imgUrl(it);
    var title = $("#mv-title");
    if (title) {
      var sea = seasonLabel(it);
      title.textContent = (it.title || (it.category || "")) + (sea ? "  ·  " + sea : "");
    }
    var box = $("#mv-tags");
    if (!box) return;
    box.innerHTML = "";
    var fit = splitFit(t.fit_tags);
    var any = false;
    shownGroups().forEach(function (g) {
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
    $("#mv-modal").classList.remove("hidden");
  }

  function closeModal() {
    var m = $("#mv-modal");
    if (m) m.classList.add("hidden");
  }

  function bind() {
    var c = $("#mv-close");
    if (c) c.onclick = closeModal;
    var m = $("#mv-modal");
    if (m) m.onclick = function (e) { if (e.target === m) closeModal(); };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  }

  /* 导航与登录态交给公共模块，保证和其他前台页一致 */
  async function boot() {
    bind();
    var SB = SBx();
    /* 图片地址走 Worker 鉴权，未登录拿不到图，所以先确认登录态 */
    try {
      var s = SB && SB.client && SB.client.auth ? await SB.client.auth.getSession() : null;
      var sess = s && s.data && s.data.session;
      if (!sess) { location.replace("index.html"); return; }
      var u = $("#mv-user");
      if (u) { u.textContent = (sess.user && sess.user.email) || ""; u.classList.remove("hidden"); }
      var lo = $("#mv-logout");
      if (lo) {
        lo.classList.remove("hidden");
        lo.onclick = async function () { try { await SB.client.auth.signOut(); } catch (e) {} location.href = "index.html"; };
      }
    } catch (e) { /* 无会话信息时仍尝试渲染，失败再提示 */ }
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