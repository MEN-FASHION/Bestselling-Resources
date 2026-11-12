/* ============================================================================
 * titlelab.js —— 前台「标题组词台」
 *
 * 一句话定位：把「趋势上升榜」这一周的标题原文拿过来直接分词统计，
 * 告诉商家「同行在标题里写了哪些词」，并给出可复制的组词方案。
 *
 * 口径（20261112N 改版，重要）：
 *   ① 词全部来自**标题原文**，不吃打标结果 —— 打标是看图判断的属性，
 *      和商家实际写标题用的词不是一回事，拿它当标题词会失真；
 *   ② 数据源仍是榜单（rank_items.title），一份数据两个专区，不新增上传；
 *   ③ 类目 / 周次 / 站点筛选项与「趋势上升榜」同源（rankFacetsByType("week")）；
 *   ④ 「图案印花款」开关跟随后台：关闭时图案槽位不出现，图案词也不参与统计。
 *
 * 只读：本页不写任何数据。
 * ==========================================================================*/
(function () {
  "use strict";

  var SBX = (typeof SB !== "undefined") ? SB : (window.SB || null);
  var CORE = window.TITLE_WORDS || {};
  var KEY = "titlebank";

  var $ = function (s) { return document.querySelector(s); };
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function toast(msg, ok) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    t.style.borderColor = ok === false ? "rgba(194,94,90,.5)" : "";
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }
  function copyText(s) {
    var txt = String(s || "");
    if (!txt) return Promise.resolve(false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt).then(function () { return true; }, function () { return false; });
    }
    try {
      var ta = document.createElement("textarea");
      ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return Promise.resolve(!!ok);
    } catch (e) { return Promise.resolve(false); }
  }

  var S = {
    vis: true, gate: "",
    facets: { categories: [], periods: [], sites: [] },
    catMap: {},          /* 标准类目名 → 库里的原始类目名数组 */
    cat: "", period: "", sites: [],
    hidePattern: false,
    rows: [],              /* [{url,title,category,period,site}] —— 只用到标题 */
    tally: null,
    wordIdx: null,
    picked: {},
    mode: "space",
    tab: "detail",
    kw: "", bankKw: "",
    bank: null
  };

  /* ---------------- 启动：会话 + 专区可见性守卫 ---------------- */
  async function boot() {
    try {
      var ses = await SBX.getSession();
      var who = $("#tl-user");
      if (who) { who.textContent = (ses && ses.user && (ses.user.email || "")) || ""; who.classList.toggle("hidden", !ses); }
      var lo = $("#tl-logout");
      if (lo) {
        lo.classList.toggle("hidden", !ses);
        lo.onclick = async function () { try { await SBX.signOut(); } catch (e) {} location.href = "index.html"; };
      }
      if (!ses) { var li = $("#tl-login"); if (li) li.classList.remove("hidden"); }
    } catch (e) { /* 拿不到会话也继续 */ }

    try {
      if (window.Common && Common.zones && Common.zones.loadDefs) await Common.zones.loadDefs();
      var vis = null, myz = null;
      try { vis = await SBX.getFrontendZoneVisibility(); } catch (e) { vis = null; }
      try { myz = await SBX.myFrontendZones(); } catch (e) { myz = null; }
      if (window.Common && Common.zones) {
        Common.zones.setVis(vis || {});
        Common.zones.setMine(Array.isArray(myz) ? myz : null);
        if (Common.zones.applyNav) Common.zones.applyNav();
        S.vis = Common.zones.visible(KEY) !== false;
      }
      if (vis && vis[KEY] === false) {
        S.gate = "全站开关：该专区已在后台「前台访问设置」中被关闭";
      } else if (Array.isArray(myz) && myz.length && myz.indexOf(KEY) === -1) {
        S.gate = "账号授权：你的账号未获授权访问本专区";
      }
      if (window.Common && Common.visit) { try { Common.visit.track(KEY); } catch (e0) {} }
    } catch (e) { /* 导航显隐失败不影响展示 */ }

    var tabs = document.querySelector(".top-tabs");
    if (tabs) tabs.classList.remove("is-booting");

    if (!S.vis || S.gate) {
      var cats = $("#tl-cats"); if (cats) cats.innerHTML = '<div class="cat-menu-tip">未开放</div>';
      var body = $("#tl-body");
      if (body) body.innerHTML = '<div class="rk-empty">' + esc(S.gate || "该专区暂未对你开放，请联系管理员") + "</div>";
      return;
    }
    await loadFacets();
    await load();
  }

  /* 类目名归一：与榜单页同一套规则（平台全路径名 → 标准类目名） */
  function normCatName(x) {
    var raw = String(x == null ? "" : x).trim();
    if (!raw) return "";
    if (typeof window !== "undefined" && window.RankCatNorm) return window.RankCatNorm.normalize(raw);
    return raw;
  }
  function catsOf(label) {
    var k = String(label || "");
    return (S.catMap && S.catMap[k] && S.catMap[k].length) ? S.catMap[k].slice() : (k ? [k] : []);
  }

  /* ---------------- 筛选项（与榜单同源） ---------------- */
  async function loadFacets() {
    var f = { categories: [], periods: [], sites: [] };
    try {
      f = (typeof SBX.rankFacetsByType === "function")
        ? await SBX.rankFacetsByType("week")
        : await SBX.rankFacets();
    } catch (e) { /* 失败按空处理 */ }
    /* 类目菜单只显示标准名：库里残留的平台全路径名合并到同一类，菜单不再一堆长名字 */
    S.catMap = {};
    (function () {
      var raw = (f && f.categories) || [], merged = [];
      raw.forEach(function (c) {
        var n = normCatName(c) || "其他";
        if (!S.catMap[n]) { S.catMap[n] = []; merged.push(n); }
        if (S.catMap[n].indexOf(c) < 0) S.catMap[n].push(c);
      });
      S.facets.categories = merged;
    })();
    S.facets.periods = (f && f.periods) || [];
    S.facets.sites = (f && f.sites) || [];
    try {
      var raw = await SBX.listRankSites();
      var def = (raw || []).map(function (x) { return x && x.name; }).filter(function (v) { return v && String(v).trim(); });
      if (def.length) S.facets.sites = def.slice();
    } catch (e) { /* 读不到就用数据里出现过的站点 */ }
    try {
      if (SBX && typeof SBX.getPatternPrintVisible === "function") {
        S.hidePattern = (await SBX.getPatternPrintVisible()) === false;
      }
    } catch (e) { S.hidePattern = false; }

    if (!S.cat) S.cat = S.facets.categories.length ? S.facets.categories[0] : "";
    if (!S.period) S.period = latestPeriod(S.facets.periods);
  }

  function latestPeriod(list) {
    var arr = (list || []).slice();
    if (!arr.length) return "";
    function key(p) {
      var m = String(p).match(/(20\d{2})\D*W?\s*(\d{1,2})/i);
      if (m) return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
      return 0;
    }
    arr.sort(function (a, b) { return key(b) - key(a) || String(b).localeCompare(String(a)); });
    return arr[0];
  }

  /* ---------------- 取数：只用标题 ---------------- */
  async function load() {
    renderCats();
    renderFilter();
    var body = $("#tl-body");
    if (body) body.innerHTML = '<div class="rk-empty">正在读取该类目本周的榜单标题…</div>';
    if (!S.cat || !S.period) {
      if (body) body.innerHTML = '<div class="rk-empty">还没有榜单数据：请先在「趋势上升榜」后台导入这一周的榜单（有标题即可），这里会直接复用。</div>';
      return;
    }
    var items = [];
    try {
      var filter = {
        categories: catsOf(S.cat), periodType: "week", periods: [S.period],
        cols: "id,image_url,title,category,site,period_label,period_type"
      };
      if (S.sites.length) filter.sites = S.sites;
      items = await SBX.listRankItems(filter);
    } catch (e) {
      if (body) body.innerHTML = '<div class="rk-empty">暂时没读到榜单数据，请稍后重试。<br><button type="button" class="btn-ghost" id="tl-retry">重新加载</button></div>';
      var b0 = $("#tl-retry"); if (b0) b0.onclick = function () { load(); };
      return;
    }

    /* 同款跨站点合并：词频按「款」算，不按「站点×款」算，
       否则一个爆款铺五个站点会把词频抬五倍。 */
    var byUrl = {}, order = [];
    (items || []).forEach(function (it) {
      if (!it) return;
      var u = String(it.image_url || "").trim() || ("t:" + String(it.title || ""));
      if (!byUrl[u]) { byUrl[u] = { url: u, title: String(it.title || "").trim(), site: it.site || "", category: S.cat, period: S.period }; order.push(u); }
      else if (!byUrl[u].title && it.title) byUrl[u].title = String(it.title || "").trim();
    });
    S.rows = order.map(function (u) { return byUrl[u]; });
    rebuild();
  }

  function rebuild() {
    S.tally = CORE.tally ? CORE.tally(S.rows, { hidePattern: S.hidePattern }) : null;
    S.wordIdx = {};
    var alive = {};
    if (S.tally) {
      S.tally.slots.forEach(function (s) {
        s.words.forEach(function (w) { S.wordIdx[w.w] = s.key; alive[s.key + "|" + w.w] = 1; });
      });
      S.tally.general.forEach(function (w) { if (!(w.w in S.wordIdx)) S.wordIdx[w.w] = ""; });
    }
    /* 组词器里已不存在的词清掉 */
    Object.keys(S.picked).forEach(function (k) {
      if (k === "__hidePattern") return;
      if (!alive[k + "|" + S.picked[k]]) delete S.picked[k];
    });
    renderAll();
  }

  /* ---------------- 左侧类目 ---------------- */
  function renderCats() {
    var box = $("#tl-cats");
    if (!box) return;
    var list = S.facets.categories || [];
    if (!list.length) { box.innerHTML = '<div class="rk-empty">暂无类目</div>'; return; }
    box.innerHTML = "";
    list.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cat-menu-item" + (c === S.cat ? " active" : "");
      b.textContent = c;
      b.title = c;
      b.onclick = function () {
        if (c === S.cat) return;
        S.cat = c; S.bank = null;
        renderCats(); renderFilter(); load();
      };
      box.appendChild(b);
    });
  }

  /* ---------------- 顶部筛选（周次 + 站点） ---------------- */
  function renderFilter() {
    var box = $("#tl-groups");
    if (!box) return;
    var html = "";
    var ps = S.facets.periods || [];
    html += '<div class="tag-group"><span class="tag-group-name">周次</span><div class="tag-chips">';
    if (!ps.length) html += '<span class="rk-note">暂无周次</span>';
    ps.forEach(function (p) {
      html += '<button type="button" class="tag-chip' + (p === S.period ? " active" : "") + '" data-period="' + esc(p) + '">' + esc(p) + "</button>";
    });
    html += "</div></div>";

    var ss = S.facets.sites || [];
    if (ss.length) {
      html += '<div class="tag-group"><span class="tag-group-name">国家站点</span><div class="tag-chips">';
      html += '<button type="button" class="tag-chip' + (S.sites.length ? "" : " active") + '" data-site="">全部</button>';
      ss.forEach(function (s) {
        html += '<button type="button" class="tag-chip' + (S.sites.indexOf(s) >= 0 ? " active" : "") + '" data-site="' + esc(s) + '">' + esc(s) + "</button>";
      });
      html += "</div></div>";
    }
    box.innerHTML = html;

    Array.prototype.forEach.call(box.querySelectorAll("[data-period]"), function (b) {
      b.onclick = function () {
        var p = b.getAttribute("data-period");
        if (p === S.period) return;
        S.period = p; S.bank = null;
        renderFilter(); load();
      };
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-site]"), function (b) {
      b.onclick = function () {
        var s = b.getAttribute("data-site");
        if (!s) S.sites = [];
        else {
          var i = S.sites.indexOf(s);
          if (i >= 0) S.sites.splice(i, 1); else S.sites.push(s);
        }
        renderFilter(); load();
      };
    });

    var sum = $("#tl-summary");
    if (sum) {
      sum.textContent = (S.cat || "未选类目") + " · " + (S.period || "未选周次") +
        (S.sites.length ? " · " + S.sites.length + " 个站点" : " · 全部站点") +
        (S.hidePattern ? " · 图案印花款已隐藏" : "");
    }
  }

  /* ---------------- 主体 ---------------- */
  function renderAll() {
    var body = $("#tl-body");
    if (!body) return;
    if (!S.rows.length) {
      body.innerHTML = '<div class="rk-empty">这个类目 + 这个周次下还没有榜单数据。' +
        '<br>先到「趋势上升榜」导入这一周的榜单，标题会自动进到这里。</div>';
      return;
    }
    if (S.tally && S.tally.withTitle === 0) {
      body.innerHTML = '<div class="rk-empty">这批榜单数据没有标题字段，无法分词。请在导入时保留标题列。</div>';
      return;
    }
    body.innerHTML = renderStats() + renderSlots() + renderGeneral() + renderComposer() + renderTables();
    bindSlots(); bindComposer(); bindTables();
  }

  function renderStats() {
    var t = S.tally || { total: 0, withTitle: 0, uniq: 0, avgChars: 0, avgTokens: 0, slots: [] };
    var cover = t.total ? Math.round(t.withTitle / t.total * 100) : 0;
    var slotCnt = (t.slots || []).filter(function (s) { return s.words.length > 0; }).length;
    return '<div class="tl-stats">' +
        stat("样本量", t.total, "这一周的款数（同款跨站点已合并）") +
        stat("有标题", cover + "%", t.withTitle + " / " + t.total + " 款") +
        stat("去重词条", t.uniq, "从标题里切出的有效词") +
        stat("标题均长", t.avgChars + " 字", "平均 " + t.avgTokens + " 个词 · 覆盖 " + slotCnt + "/" + arr.length + " 类") +
      "</div>" +
      (S.hidePattern ? '<div class="tl-dropnote"><span class="tl-note">后台已关闭「图案印花款」：图案相关字眼不参与统计，也不展示</span></div>' : "");
  }
  function stat(k, v, sub) {
    return '<div class="tl-stat"><div class="tl-stat-k">' + esc(k) + "</div>" +
      '<div class="tl-stat-v">' + esc(String(v)) + "</div>" +
      '<div class="tl-stat-s">' + esc(sub) + "</div></div>";
  }

  function slotMeta(key) {
    var arr = (CORE.SLOTS || []);
    for (var i = 0; i < arr.length; i++) if (arr[i].key === key) return arr[i];
    return { no: "", label: "", hint: "" };
  }

  /* 各槽位：词来自标题，按词典归位 */
  function renderSlots() {
    var slots = (S.tally && S.tally.slots) || [];
    var head = '<div class="tl-blockhead"><span class="tl-bh-t">本周标题词表</span>' +
      '<span class="tl-bh-s">全部从标题原文切出并按类型归位 · 括号是「含该词的款数占比」 · 点词加入下方组词器</span></div>';
    var cards = slots.map(function (s) {
      var meta = slotMeta(s.key);
      var top = s.words.slice(0, 14);
      var list = top.length ? top.map(function (w) {
        return '<button type="button" class="tl-word" data-slot="' + s.key + '" data-w="' + esc(w.w) + '">' +
          esc(w.w) + '<span class="tl-pct">' + w.pct + "%</span></button>";
      }).join("") : '<span class="tl-note">这一周标题里没有这类词</span>';
      return '<div class="tl-slot" data-slot-box="' + s.key + '">' +
        '<div class="tl-slot-head"><span class="tl-no">' + esc(meta.no) + "</span>" +
        '<span class="tl-lab">' + esc(s.name) + "</span>" +
        '<span class="tl-meta">覆盖 ' + s.coverPct + "%</span></div>" +
        '<div class="tl-slot-hint">' + esc(meta.hint) + "</div>" +
        '<div class="tl-words">' + list + "</div></div>";
    }).join("");
    return '<section class="tl-sec">' + head + '<div class="tl-slots">' + cards + "</div></section>";
  }

  /* 其它高频词：不属于任何一类，但同样从标题原文切出 */
  function renderGeneral() {
    var g = (S.tally && S.tally.general) || [];
    if (!g.length) return "";
    var top = g.filter(function (x) { return !x.filler; }).slice(0, 30);
    var fill = g.filter(function (x) { return x.filler; }).slice(0, 8);
    var chip = function (w, dim) {
      return '<button type="button" class="tl-word' + (dim ? " is-dim" : "") + '" data-general="' + esc(w.w) + '">' +
        esc(w.w) + '<span class="tl-pct">' + w.pct + "%</span></button>";
    };
    return '<section class="tl-sec">' +
      '<div class="tl-blockhead"><span class="tl-bh-t">其它高频词</span>' +
      '<span class="tl-bh-s">不属于上面各类的词（性别、修饰语、年份等），同样来自标题原文</span></div>' +
      '<div class="tl-words">' + top.map(function (w) { return chip(w, false); }).join("") +
        fill.map(function (w) { return chip(w, true); }).join("") + "</div>" +
      (fill.length ? '<div class="tl-note">浅色的是「新款 / 时尚」这类空泛词，写标题时建议少用</div>' : "") +
      "</section>";
  }

  function composeNow() {
    if (!CORE.compose) return "";
    if (S.mode === "natural") return CORE.composeNatural(S.picked, "space", { hidePattern: S.hidePattern });
    var sep = S.mode === "comma" ? "comma" : S.mode === "pipe" ? "pipe" : "space";
    return CORE.compose(S.picked, sep, { hidePattern: S.hidePattern });
  }

  function scoreNow(text) {
    if (CORE.score) return CORE.score(text, S.picked);
    return { chars: text.length, filled: 0, slots: 8, score: 0, over: text.length > 60 };
  }

  function scoreHtml(sc) {
    return "字数 <b id=\"tl-chars\">" + sc.chars + "</b>" +
      "<span>槽位 <b>" + sc.filled + " / " + sc.slots + "</b></span>" +
      "<span>评分 <b>" + sc.score + "</b></span>" +
      (sc.over ? '<span class="tl-warn">超过 60 字</span>' : "");
  }

  /* 组词器 */
  function renderComposer() {
    var slots = (S.tally && S.tally.slots) || [];
    var selects = slots.map(function (s) {
      var meta = slotMeta(s.key);
      var opts = ['<option value="">— 不选 —</option>'].concat(s.words.slice(0, 60).map(function (w) {
        return '<option value="' + esc(w.w) + '"' + (S.picked[s.key] === w.w ? " selected" : "") + ">" +
          esc(w.w) + "（" + w.n + " 款 · " + w.pct + "%）</option>";
      })).join("");
      return '<label class="tl-field"><span>' + esc(meta.no) + " " + esc(s.name) + "</span>" +
        '<select data-pick="' + s.key + '">' + opts + "</select></label>";
    }).join("");

    var text = composeNow();
    return '<section class="tl-sec">' +
      '<div class="tl-blockhead"><span class="tl-bh-t">标题组词器</span>' +
      '<span class="tl-bh-s">按槽位选词，右侧实时给出标题与结构评分（只做建议，不改任何数据）</span></div>' +
      '<div class="tl-comp">' +
        '<div class="tl-comp-l">' + selects +
          '<div class="tl-modes">' + ["space|空格分隔", "comma|逗号分隔", "pipe|竖线分隔", "natural|自然语序"].map(function (x) {
            var kv = x.split("|");
            return '<button type="button" class="tl-mode' + (S.mode === kv[0] ? " active" : "") + '" data-mode="' + kv[0] + '">' + kv[1] + "</button>";
          }).join("") + "</div>" +
        "</div>" +
        '<div class="tl-comp-r">' +
          '<div class="tl-preview" id="tl-preview">' + (text ? esc(text) : '<span class="tl-note">选几个词试试</span>') + "</div>" +
          '<div class="tl-score">' + scoreHtml(scoreNow(text)) + "</div>" +
          '<div class="tl-act">' +
            '<button type="button" class="btn-ghost" id="tl-copy">复制标题</button>' +
            '<button type="button" class="btn-ghost" id="tl-clear">清空</button>' +
          "</div>" +
        "</div>" +
      "</div></section>";
  }

  /* 建议词组：每槽位 top1，按自然语序拼 */
  function suggestFor() {
    var o = {};
    (S.tally && S.tally.slots || []).forEach(function (s) { if (s.words.length) o[s.key] = s.words[0].w; });
    return CORE.composeNatural ? CORE.composeNatural(o, "space", { hidePattern: S.hidePattern }) : "";
  }

  /* 这一行标题命中了词表里的哪些词 */
  function rowHitWords(title) {
    if (!CORE.tokenize) return [];
    var out = [];
    CORE.tokenize(title).words.forEach(function (o) {
      if (S.wordIdx && (o.w in S.wordIdx)) out.push({ w: o.w, slot: S.wordIdx[o.w] });
    });
    return out;
  }

  function renderTables() {
    var tabs = '<div class="tl-tabs">' +
      '<button type="button" class="tl-tab' + (S.tab === "detail" ? " active" : "") + '" data-tab="detail">标题明细</button>' +
      '<button type="button" class="tl-tab' + (S.tab === "bank" ? " active" : "") + '" data-tab="bank">全站词库</button>' +
      "</div>";
    return '<section class="tl-sec">' + tabs + '<div id="tl-tabbody">' + (S.tab === "detail" ? detailHtml() : bankHtml()) + "</div></section>";
  }

  function detailHtml() {
    var rows = S.rows.slice();
    var kw = S.kw.trim();
    if (kw) rows = rows.filter(function (r) { return String(r.title || "").indexOf(kw) >= 0; });
    var sug = suggestFor();
    var head = '<div class="tl-tools">' +
      '<input id="tl-kw" class="tl-input" type="search" placeholder="搜标题…" value="' + esc(S.kw) + '">' +
      '<span class="tl-count">' + rows.length + " 款</span>" +
      '<button type="button" class="btn-ghost" id="tl-csv">导出明细 CSV</button></div>';
    var cols = '<tr><th>原标题</th><th>字数</th><th>命中词</th><th>操作</th></tr>';
    var body = rows.slice(0, 400).map(function (r) {
      var hits = rowHitWords(r.title);
      var chips = hits.length ? hits.map(function (h) {
        return '<span class="tl-mini">' + esc(h.w) + "</span>";
      }).join("") : '<span class="tl-note">—</span>';
      return "<tr>" +
        '<td class="tl-title">' + (esc(r.title) || '<span class="tl-note">无标题</span>') + "</td>" +
        "<td>" + String(r.title || "").length + "</td>" +
        "<td>" + chips + "</td>" +
        '<td><button type="button" class="tl-use" data-use="' + esc(r.title) + '">用这组词</button></td>' +
        "</tr>";
    }).join("");
    return head + (rows.length
      ? '<div class="tl-tblwrap"><table class="tl-tbl"><thead>' + cols + "</thead><tbody>" + body +
        "</tbody></table></div>" +
        (rows.length > 400 ? '<div class="tl-note">只显示前 400 款，导出 CSV 拿全量</div>' : "") +
        (sug ? '<div class="tl-note">本周建议词组（各槽位 top1）：<b>' + esc(sug) + "</b></div>" : "")
      : '<div class="rk-empty">没有匹配的标题</div>');
  }

  function bankHtml() {
    if (!S.bank) {
      return '<div class="tl-bank-empty"><div class="tl-note">把当前类目 + 当前周次切出的词按类型合并，按「出现款数」排序。</div>' +
        '<button type="button" class="btn-ghost" id="tl-bank-load">计算全站词库</button></div>';
    }
    var kw = S.bankKw.trim();
    var rows = (S.bank.rows || []).filter(function (x) { return !kw || String(x.w).indexOf(kw) >= 0; });
    var head = '<div class="tl-tools">' +
      '<input id="tl-bankkw" class="tl-input" type="search" placeholder="搜词…" value="' + esc(S.bankKw) + '">' +
      '<span class="tl-count">' + rows.length + " 个词</span>" +
      '<button type="button" class="btn-ghost" id="tl-bank-reload">重新计算</button></div>';
    var body = rows.slice(0, 600).map(function (x) {
      return "<tr>" +
        "<td>" + esc(x.w) + "</td>" +
        "<td>" + esc(x.group) + "</td>" +
        "<td>" + x.n + "</td>" +
        '<td><button type="button" class="tl-use" data-word="' + esc(x.w) + '" data-slot="' + esc(x.slot || "") + '">加进组词器</button></td>' +
        "</tr>";
    }).join("");
    return head + '<div class="tl-tblwrap"><table class="tl-tbl"><thead><tr><th>词</th><th>类型</th><th>出现款数</th><th>操作</th></tr></thead><tbody>' +
      body + "</tbody></table></div>";
  }

  /* ---------------- 交互 ---------------- */
  function paintSlots() {
    Array.prototype.forEach.call(document.querySelectorAll(".tl-word[data-slot]"), function (b) {
      b.classList.toggle("picked", S.picked[b.getAttribute("data-slot")] === b.getAttribute("data-w"));
    });
  }

  function syncSelects() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-pick]"), function (sel) {
      sel.value = S.picked[sel.getAttribute("data-pick")] || "";
    });
  }

  function paintComposer() {
    var txt = composeNow();
    var pv = $("#tl-preview");
    if (pv) pv.innerHTML = txt ? esc(txt) : '<span class="tl-note">选几个词试试</span>';
    var box = document.querySelector(".tl-score");
    if (box) box.innerHTML = scoreHtml(scoreNow(txt));
  }

  function bindSlots() {
    Array.prototype.forEach.call(document.querySelectorAll(".tl-word[data-slot]"), function (b) {
      b.onclick = function () {
        var k = b.getAttribute("data-slot"), w = b.getAttribute("data-w");
        if (S.picked[k] === w) delete S.picked[k]; else S.picked[k] = w;
        paintSlots(); syncSelects(); paintComposer();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tl-word[data-general]"), function (b) {
      b.onclick = function () {
        var w = b.getAttribute("data-general");
        copyText(w).then(function (ok) { toast(ok ? "已复制「" + w + "」" : "复制失败，请手动选中", ok); });
      };
    });
  }

  function bindComposer() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-pick]"), function (sel) {
      sel.onchange = function () {
        var k = sel.getAttribute("data-pick");
        if (sel.value) S.picked[k] = sel.value; else delete S.picked[k];
        paintSlots(); paintComposer();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tl-mode"), function (b) {
      b.onclick = function () {
        S.mode = b.getAttribute("data-mode");
        Array.prototype.forEach.call(document.querySelectorAll(".tl-mode"), function (x) {
          x.classList.toggle("active", x === b);
        });
        paintComposer();
      };
    });
    var cp = $("#tl-copy");
    if (cp) cp.onclick = function () {
      var txt = composeNow();
      if (!txt) { toast("还没选词", false); return; }
      copyText(txt).then(function (ok) { toast(ok ? "标题已复制" : "复制失败，请手动选中", ok); });
    };
    var cl = $("#tl-clear");
    if (cl) cl.onclick = function () {
      S.picked = {};
      syncSelects(); paintSlots(); paintComposer();
    };
  }

  function bindTables() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-tab]"), function (b) {
      b.onclick = function () {
        S.tab = b.getAttribute("data-tab");
        var tb = $("#tl-tabbody");
        if (tb) { tb.innerHTML = S.tab === "detail" ? detailHtml() : bankHtml(); bindTables(); }
        Array.prototype.forEach.call(document.querySelectorAll("[data-tab]"), function (x) {
          x.classList.toggle("active", x === b);
        });
      };
    });
    var kw = $("#tl-kw");
    if (kw) kw.onchange = function () {
      S.kw = kw.value;
      var tb = $("#tl-tabbody"); if (tb) { tb.innerHTML = detailHtml(); bindTables(); }
    };
    var bk = $("#tl-bankkw");
    if (bk) bk.onchange = function () {
      S.bankKw = bk.value;
      var tb = $("#tl-tabbody"); if (tb) { tb.innerHTML = bankHtml(); bindTables(); }
    };
    var bl = $("#tl-bank-load");
    if (bl) bl.onclick = function () {
      S.bank = CORE.bank ? CORE.bank(S.rows, { hidePattern: S.hidePattern }) : null;
      var tb = $("#tl-tabbody"); if (tb) { tb.innerHTML = bankHtml(); bindTables(); }
    };
    var br = $("#tl-bank-reload");
    if (br) br.onclick = function () {
      S.bankKw = "";
      S.bank = CORE.bank ? CORE.bank(S.rows, { hidePattern: S.hidePattern }) : null;
      var tb = $("#tl-tabbody"); if (tb) { tb.innerHTML = bankHtml(); bindTables(); }
    };

    Array.prototype.forEach.call(document.querySelectorAll("[data-use]"), function (b) {
      b.onclick = function () {
        var t = b.getAttribute("data-use");
        S.picked = {};
        rowHitWords(t).forEach(function (h) { if (h.slot && !S.picked[h.slot]) S.picked[h.slot] = h.w; });
        syncSelects(); paintSlots(); paintComposer();
        toast("已按这一行的词填入组词器");
        var pv = $("#tl-preview");
        if (pv && pv.scrollIntoView) pv.scrollIntoView({ block: "center", behavior: "smooth" });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-word]"), function (b) {
      b.onclick = function () {
        var w = b.getAttribute("data-word"), slot = b.getAttribute("data-slot");
        if (!slot) {
          copyText(w).then(function (ok) { toast(ok ? "这个词不属于任何一类，已复制" : "复制失败，请手动选中", ok); });
          return;
        }
        S.picked[slot] = w;
        syncSelects(); paintSlots(); paintComposer();
        toast("已加入「" + slotMeta(slot).label + "」");
      };
    });

    var csv = $("#tl-csv");
    if (csv) csv.onclick = function () {
      if (!CORE.toCSV) { toast("导出组件未加载", false); return; }
      var sug = suggestFor();
      var rows = S.rows.map(function (r) {
        return { category: r.category, period: r.period, site: r.site, title: r.title, words: rowHitWords(r.title), suggest: sug };
      });
      var txt = CORE.toCSV(rows, { hidePattern: S.hidePattern });
      var blob = new Blob([txt], { type: "text/csv;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "标题词明细-" + (S.cat || "全部") + "-" + (S.period || "") + ".csv";
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast("已导出 " + rows.length + " 款");
    };
  }

  /* ---------------- 启动 ---------------- */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
