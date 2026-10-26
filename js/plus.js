/* ============================================================================
 * plus.js —— 前台「大码专区」（20261026P）
 *
 * 一个类目一组，组内左右两列：左 = 大码（本期上传），右 = 标码（趋势上升榜）。
 * 三条硬规则：
 *   ① 类目集合以大码为准 —— 大码没做的类目，标码再满也不出现；
 *   ② 标码该个类目没有数据 → 该列整列不渲染（不留空壳，剩下的列铺满）；
 *   ③ 标码有、大码没有的款 → 打「大码机会」标，可一键只看这类。
 *
 * 期次配对：默认「大码期次 = 标码期次」，点「解锁」后可让两边各选各的。
 * ==========================================================================*/
(function () {
  "use strict";
  var SBX = window.SB || null;
  var $ = function (s) { return document.querySelector(s); };
  var CAP = 60;

  var ST = {
    cats: [], periods: [], sites: [],
    cat: "", plusPeriod: "", stdPeriod: "", site: "",
    unlock: false, onlyGap: false, onlyReview: false,
    plus: [], std: [], matches: {}, loading: false, pending: false,
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function ratioTxt(v) {
    var n = num(v);
    if (n == null) return "—";
    var s = (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
    return (n > 0 ? "+" : "") + s + "%";
  }
  function toast(msg, ok) {
    var el = $("#plz-toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast show" + (ok === false ? " bad" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = "toast"; }, 2600);
  }

  /* ---------------- 期次排序（与榜单同一套口径） ---------------- */
  function periodKey(p) {
    var s = String(p || "").trim();
    var ym = s.match(/(20\d{2})/);
    var year = ym ? parseInt(ym[1], 10) : 0;
    var m = s.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return parseInt(m[1], 10) * 10000 + 300 + parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
    m = s.match(/[Ww]\s*(\d{1,2})/) || s.match(/第?\s*(\d{1,2})\s*周/);
    if (m) return year * 10000 + 100 + parseInt(m[1], 10);
    m = s.match(/(20\d{2})\D{0,3}(\d{1,2})\s*月?$/);
    if (m) return year * 10000 + 200 + parseInt(m[m.length - 1], 10);
    m = s.match(/^(\d{1,3})$/);
    if (m) return year * 10000 + 100 + parseInt(m[1], 10);
    return 990000 + (s.charCodeAt(0) || 0);
  }
  function sortPeriods(a) { return (a || []).slice().sort(function (x, y) { return periodKey(x) - periodKey(y); }); }

  /* ---------------- 筛选条 ---------------- */
  function fillSelects() {
    var ps = $("#plz-plus-period"), ss = $("#plz-std-period"), st = $("#plz-site");
    if (ps) {
      ps.innerHTML = ST.periods.length
        ? ST.periods.slice().reverse().map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join("")
        : '<option value="">（暂无大码期次）</option>';
      ps.value = ST.plusPeriod || (ST.periods[ST.periods.length - 1] || "");
    }
    if (ss) {
      ss.innerHTML = ST.periods.length
        ? ST.periods.slice().reverse().map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join("")
        : '<option value="">—</option>';
      ss.value = ST.stdPeriod || ST.plusPeriod || "";
      ss.disabled = !ST.unlock;
    }
    if (st) {
      var opts = ['<option value="">全部站点</option>'].concat(ST.sites.map(function (s) {
        return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
      }));
      st.innerHTML = opts.join("");
      st.value = ST.site || "";
    }
    var lk = $("#plz-unlock");
    if (lk) lk.classList.toggle("on", !!ST.unlock);
    var og = $("#plz-only-gap");
    if (og) og.classList.toggle("on", !!ST.onlyGap);
    var orv = $("#plz-only-review");
    if (orv) orv.classList.toggle("on", !!ST.onlyReview);
  }

  function renderCats() {
    var box = $("#plz-cats");
    if (!box) return;
    if (!ST.cats.length) {
      box.innerHTML = '<div class="rk-empty">这个大码期次没有带类目的数据：请让管理员在后台「大码专区」上传时选一个类目（或按一个 sheet 一个类目拆表）后重传。</div>';
      return;
    }
    var html = ['<button type="button" class="cat-menu-item' + (ST.cat ? "" : " active") + '" data-cat="">全部类目</button>'];
    ST.cats.forEach(function (c) {
      html.push('<button type="button" class="cat-menu-item' + (ST.cat === c ? " active" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>');
    });
    box.innerHTML = html.join("");
    Array.prototype.forEach.call(box.querySelectorAll(".cat-menu-item"), function (b) {
      b.onclick = function () {
        ST.cat = b.getAttribute("data-cat") || "";
        renderCats();
        load();
      };
    });
  }

  /* 类目名宽松匹配：大码写「裤装」、标码写「加绒裤装 / 裤装（女）」也算同一类。
     榜单的类目名是运营各自写的，强求一字不差会让标码那一列整列消失。 */
  function normCat(v) {
    return String(v == null ? "" : v).replace(/[\s（）()【】\[\]·・\-—_/、,，.。]/g, "").toLowerCase();
  }
  function catSame(a, b) {
    var x = normCat(a), y = normCat(b);
    if (!x || !y) return x === y;
    if (x === y) return true;
    if (x.length >= 2 && y.length >= 2 && (x.indexOf(y) >= 0 || y.indexOf(x) >= 0)) return true;
    return false;
  }

  /* ---------------- 取数 ---------------- */
  async function loadFacets() {
    var g = { sites: [], periods: [], categories: [] };
    try { g = await SBX.rankFacets(); } catch (e) { g = { sites: [] }; }
    ST.sites = g.sites || [];
    var f = { periods: [], categories: [] };
    try { f = await SBP.facets(); } catch (e) { f = { periods: [], categories: [] }; }
    ST.periods = sortPeriods(f.periods || []);
    ST.cats = (f.categories || []).slice();
    ST.plusPeriod = ST.plusPeriod || (ST.periods[ST.periods.length - 1] || "");
    ST.stdPeriod = ST.plusPeriod;
  }
  async function loadMatches() {
    var rows = [];
    try { rows = await SBP.listMatches({ periodLabel: ST.plusPeriod, category: ST.cat || "" }); }
    catch (e) { rows = []; }
    var map = {};
    rows.forEach(function (r) { map[r.std_image_url] = r; });
    ST.matches = map;
  }
  async function load() {
    if (ST.loading) { ST.pending = true; return; }   // 正在加载时点了类目：记下来，加载完再跑一遍
    var body = $("#plz-body");
    if (!ST.plusPeriod) {
      if (body) body.innerHTML = '<div class="rk-empty">还没有上传过大码数据，请联系管理员在后台「大码专区」上传。</div>';
      return;
    }
    ST.loading = true;
    if (body) body.innerHTML = '<div class="rk-empty">加载中…</div>';
    try {
      var plus = [], std = [];
      try { plus = await SBP.listItems({ periodLabel: ST.plusPeriod, category: ST.cat || "" }); } catch (e) { plus = []; }
      var q = { periods: [ST.stdPeriod] };
      if (ST.cat) q.category = ST.cat;
      try { std = await SBX.listRankItems(q); } catch (e) { std = []; }
      /* 标码那边类目名和大码不完全一致时，精确取会空 → 退一步取该期次全部，再按宽松规则筛 */
      if (ST.cat && !(std || []).length) {
        try {
          var all = await SBX.listRankItems({ periods: [ST.stdPeriod] });
          std = (all || []).filter(function (r) { return catSame(r.category, ST.cat); });
        } catch (e) { std = []; }
      }
      if (ST.site) std = std.filter(function (it) { return it.site === ST.site; });
      ST.plus = plus; ST.std = std;
      await loadMatches();
      renderBody();
    } finally {
      ST.loading = false;
      if (ST.pending) { ST.pending = false; load(); }
    }
  }

  /* ---------------- 渲染 ---------------- */
  function cardHtml(it, kind, dec) {
    var badge = "";
    if (kind === "std") {
      if (dec && dec.decision === "gap") badge = '<span class="plz-badge gap">大码机会</span>';
      else if (dec && dec.decision === "review") badge = '<span class="plz-badge review">待确认</span>';
    }
    var ratio = ratioTxt(it.ratio);
    var cls = ratio.indexOf("-") === 0 ? "down" : "up";
    return '<figure class="plz-card" data-url="' + esc(it.image_url) + '">'
      + '<div class="plz-img"><img loading="lazy" src="' + esc(it.image_url) + '" alt="">' + badge + '</div>'
      + '<figcaption class="plz-cap">'
      +   '<span class="plz-title">' + esc(it.title || it.leaf_category || "") + '</span>'
      +   '<span class="plz-ratio ' + cls + '">' + ratio + '</span>'
      + '</figcaption>'
      + '</figure>';
  }

  function renderBody() {
    var body = $("#plz-body");
    if (!body) return;
    if (!ST.plus.length) {
      body.innerHTML = '<div class="rk-empty">该期次' + (ST.cat ? "（" + esc(ST.cat) + "）" : "") + '还没有大码数据。</div>';
      renderSummary(0, 0, 0, 0);
      return;
    }
    /* 类目集合以大码为准 */
    var cats = (ST.cat ? [ST.cat] : ST.cats.length ? ST.cats : []).filter(Boolean);
    if (!cats.length) {
      cats = Object.keys(ST.plus.reduce(function (m, r) { if (r.category) m[r.category] = 1; return m; }, {}));
    }
    var groups = cats.map(function (c) {
      var plus = ST.plus.filter(function (r) { return (r.category || "") === c; });
      var std = ST.std.filter(function (r) { return catSame(r.category, c); });
      /* 标码同图去重（多站点会重复） */
      var seen = {}, stdU = [];
      std.forEach(function (r) { if (!seen[r.image_url]) { seen[r.image_url] = 1; stdU.push(r); } });
      return { cat: c, plus: plus, std: stdU };
    }).filter(function (g) { return g.plus.length || g.std.length; });

    var totals = { plus: 0, std: 0, gap: 0, review: 0 };
    var html = groups.map(function (g) {
      var gap = 0, review = 0;
      g.std.forEach(function (s) {
        var d = ST.matches[s.image_url];
        if (!d) { gap++; return; }               // 还没跑过匹配：按"大码没有"处理，标机会
        if (d.decision === "gap") gap++;
        else if (d.decision === "review") review++;
      });
      totals.plus += g.plus.length;
      totals.std += g.std.length;
      totals.gap += gap;
      totals.review += review;

      var stdShow = g.std.filter(function (s) {
        var d = ST.matches[s.image_url];
        if (ST.onlyGap) return !d || d.decision === "gap";
        if (ST.onlyReview) return d && d.decision === "review";
        return true;
      });
      var plusShow = g.plus;
      if (ST.onlyGap || ST.onlyReview) plusShow = [];

      var head = '<h3 class="plz-h3">' + esc(g.cat || "（未分类）")
        + '<span class="plz-stat">标码 ' + g.std.length + ' · 大码 ' + g.plus.length
        + ' · 大码机会 ' + gap + (review ? ' · 待确认 ' + review : '') + '</span></h3>';

      /* 规则②：无数据的一侧整列不渲染，剩下的列铺满 */
      var cols = [];
      if (plusShow.length) {
        cols.push('<div class="plz-col plus">'
          + '<div class="plz-col-h">大码 <b>' + plusShow.length + '</b></div>'
          + '<div class="plz-grid">' + plusShow.slice(0, CAP).map(function (r) { return cardHtml(r, "plus", null); }).join("")
          + (plusShow.length > CAP ? '<div class="plz-more">仅显示前 ' + CAP + ' 张</div>' : "") + '</div></div>');
      }
      if (stdShow.length) {
        cols.push('<div class="plz-col std">'
          + '<div class="plz-col-h">标码 <b>' + stdShow.length + '</b></div>'
          + '<div class="plz-grid">' + stdShow.slice(0, CAP).map(function (r) {
            return cardHtml(r, "std", ST.matches[r.image_url]);
          }).join("")
          + (stdShow.length > CAP ? '<div class="plz-more">仅显示前 ' + CAP + ' 张</div>' : "") + '</div></div>');
      }
      if (!cols.length) {
        cols.push('<div class="plz-col none"><div class="plz-none">该筛选下这个类目没有可显示的款</div></div>');
      }
      return '<section class="plz-group">' + head + '<div class="plz-cols' + (cols.length === 1 ? " one" : "") + '">' + cols.join("") + '</div></section>';
    }).join("");

    body.innerHTML = html || '<div class="rk-empty">当前期次没有可比的数据。</div>';
    renderSummary(totals.plus, totals.std, totals.gap, totals.review);
  }

  function renderSummary(plusN, stdN, gapN, reviewN) {
    var bar = $("#plz-sum");
    if (!bar) return;
    bar.innerHTML = '<span>大码期次 <b>' + esc(ST.plusPeriod || "—") + '</b></span>'
      + '<span>标码期次 <b>' + esc(ST.stdPeriod || "—") + '</b></span>'
      + '<span>大码 <b>' + plusN + '</b> 款</span>'
      + '<span>标码 <b>' + stdN + '</b> 款</span>'
      + '<span class="plz-sum-gap">大码机会 <b>' + gapN + '</b></span>'
      + (reviewN ? '<span class="plz-sum-review">待确认 <b>' + reviewN + '</b></span>' : '');
    var head = $("#plz-count");
    if (head) head.textContent = "共 " + plusN + " 张大码图";
  }

  /* ---------------- 绑定 ---------------- */
  function bind() {
    var ps = $("#plz-plus-period");
    if (ps) ps.onchange = function () {
      ST.plusPeriod = ps.value;
      if (!ST.unlock) ST.stdPeriod = ST.plusPeriod;
      fillSelects();
      load();
    };
    var ss = $("#plz-std-period");
    if (ss) ss.onchange = function () { ST.stdPeriod = ss.value; load(); };
    var st = $("#plz-site");
    if (st) st.onchange = function () { ST.site = st.value; load(); };
    var lk = $("#plz-unlock");
    if (lk) lk.onclick = function () {
      ST.unlock = !ST.unlock;
      if (!ST.unlock) ST.stdPeriod = ST.plusPeriod;
      fillSelects();
      toast(ST.unlock ? "已解锁：两边可各选期次" : "已锁定：标码跟随大码期次", true);
      load();
    };
    var og = $("#plz-only-gap");
    if (og) og.onclick = function () {
      ST.onlyGap = !ST.onlyGap;
      if (ST.onlyGap) ST.onlyReview = false;
      fillSelects();
      renderBody();
    };
    var orv = $("#plz-only-review");
    if (orv) orv.onclick = function () {
      ST.onlyReview = !ST.onlyReview;
      if (ST.onlyReview) ST.onlyGap = false;
      fillSelects();
      renderBody();
    };
    var rf = $("#plz-refresh");
    if (rf) rf.onclick = function () { loadFacets().then(load); };
    /* 点图看大图 */
    var body = $("#plz-body");
    if (body) body.onclick = function (e) {
      var card = e.target.closest ? e.target.closest(".plz-card") : null;
      if (!card) return;
      var url = card.getAttribute("data-url");
      var lb = $("#plz-lb");
      if (!lb || !url) return;
      lb.querySelector("img").src = url;
      lb.classList.add("show");
    };
    var lb = $("#plz-lb");
    if (lb) lb.onclick = function () { lb.classList.remove("show"); };
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && lb) lb.classList.remove("show");
    });
  }

  async function renderAuth() {
    var email = "", ok = false;
    try {
      var s = await SBX.getSession();
      if (s && s.user) { email = s.user.email || ""; ok = true; }
    } catch (e) { /* 忽略 */ }
    var u = $("#plz-user"), lo = $("#plz-logout"), li = $("#plz-login");
    if (u) { u.textContent = email; u.classList.toggle("hidden", !ok); }
    if (lo) {
      lo.classList.toggle("hidden", !ok);
      lo.onclick = async function () { try { await SBX.signOut(); } catch (e) { } location.href = "index.html"; };
    }
    if (li) li.classList.toggle("hidden", ok);
    return ok;
  }

  /* 专区被关上时给一句能自证原因的话，而不是空白页 */
  function renderGate(why) {
    var body = $("#plz-body");
    if (body) {
      body.innerHTML = '<div class="rk-empty">' + why + '<br><span style="opacity:.7">如需查看，请联系超级管理员在后台「前台访问设置 / 权限管理」中开放「大码专区」。</span></div>';
    }
    var cats = $("#plz-cats");
    if (cats) cats.innerHTML = '<div class="rk-empty">—</div>';
  }

  async function boot() {
    if (!SBX || !window.SBP) {
      $("#plz-body").innerHTML = '<div class="rk-empty">数据服务未就绪，请刷新页面重试。</div>';
      return;
    }
    var ok = await renderAuth();
    if (!ok) {
      $("#plz-body").innerHTML = '<div class="rk-empty">请先 <a href="index.html">登录</a> 后查看大码专区。</div>';
      return;
    }
    /* 专区可见性守门（两级，与榜单页同一套）：
       ①全站开关（后台「前台访问设置」）②用户级白名单（后台「权限管理」勾选） */
    var vis = null, myz = null;
    try { vis = await SBX.getFrontendZoneVisibility(); } catch (e) { /* 读不到就照常展示 */ }
    try { myz = await SBX.myFrontendZones(); } catch (e) { myz = null; }
    if (window.Common && Common.zones) {
      Common.zones.setVis(vis || {});
      Common.zones.setMine(Array.isArray(myz) ? myz : null);
      if (Common.zones.applyNav) Common.zones.applyNav();
    }
    if (vis && vis.plus === false) { renderGate("全站开关：该专区已在后台「前台访问设置」中被关闭"); return; }
    if (Array.isArray(myz) && myz.length && myz.indexOf("plus") === -1) { renderGate("账号授权：你的账号未获授权访问本专区"); return; }
    bind();
    await loadFacets();
    renderCats();
    fillSelects();
    await load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();