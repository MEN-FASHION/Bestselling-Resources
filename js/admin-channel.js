/* ============================================================================
 * admin-channel.js —— 渠道雷达 · 渠道对比（20261031A）
 *
 * 定位：渠道字典维护 + 按「类目 / 渠道 / 周次」批量传图 + 打标 + 导入导出 + 打包下载。
 *   渠道字典 → channel_sites（前台按它并排出列）
 *   图片本体 → channel_items（类目 + 渠道 + 周次）
 *   打标数据 → rank_image_tags（按图片地址唯一，与榜单、趋势动向共用同一套维度）
 *
 * 为什么另起一页而不是复用趋势动向：
 *   趋势动向的坐标是"年度 + 季节"，渠道雷达的坐标是"渠道 + 周次"——
 *   强行塞进同一张表，会让两个专区的筛选互相污染（后台一改筛选，另一个专区跟着变）。
 *   打标维度、枚举、导出导入格式三处完全共用，只有坐标不同。
 * ==========================================================================*/
(function () {
  var SBRef = null;
  function SBx() { return window.SB || SBRef || window.supabaseClient || null; }

  var state = {
    sites: [],        // channel_sites 行
    items: [],        // channel_items 行
    tagMap: {},       // url -> 打标记录
    pending: [],      // 待上传文件
    curCat: "",
    curChannel: "",
    curWeek: "",
    curId: null,
    vis: {},
    ready: false
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(t, ok) {
    if (window.sbToast) return window.sbToast(t, ok !== false);
    var el = document.getElementById("ch-msg");
    if (el) el.textContent = t;
  }
  function say(t) { var el = document.getElementById("ch-msg"); if (el) el.textContent = t || ""; }

  /* 打标维度：与趋势动向、榜单面板同序（渠道标签 = 图片来自哪个平台这个"属性"，
     与页面结构上的"渠道列"是两回事：列是组织方式，标签是图片自身的描述） */
  var DIMS = [
    { key: "style_tags", label: "风格", enum: "风格" },
    { key: "visual_tags", label: "视觉", enum: "视觉" },
    { key: "element_tags", label: "图案元素", enum: "图案元素" },
    { key: "craft_tags", label: "二次工艺", enum: "二次工艺" },
    { key: "shoot_tags", label: "拍摄方式", enum: "拍摄方式" },
    { key: "skin_tags", label: "模特", enum: "模特" },
    { key: "fit_tags", label: "版型", enum: "版型" },
    { key: "culture_tags", label: "文化背景", enum: "文化背景" },
    { key: "psych_tags", label: "消费心理", enum: "消费心理" },
    { key: "tags", label: "渠道", enum: "渠道" },
    { key: "festival_tags", label: "节日（可选）", enum: "节日" }
  ];

  function enumValues(d) {
    var E = window.APP_ENUM || {};
    if (d.key === "visual_tags") {
      return [].concat(E["视觉-背景"] || [], E["视觉-画面构成"] || [], E["视觉-呈现主体"] || []);
    }
    if (d.key === "fit_tags") {
      var FIT = (window.APP_ENUM_GROUPS && window.APP_ENUM_GROUPS.fit) || [];
      var all = [];
      FIT.forEach(function (g) { (g.values || []).forEach(function (v) { all.push(v); }); });
      return all;
    }
    return E[d.enum] || [];
  }
  function fitExpand() {
    var FIT = (window.APP_ENUM_GROUPS && window.APP_ENUM_GROUPS.fit) || [];
    var out = [];
    FIT.forEach(function (g) {
      (g.values || []).forEach(function (v) { out.push((g.label || "") + "·" + v); });
    });
    return out;
  }

  /* ---------- 周次工具 ---------- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function weekLabelOf(year, week) {
    var y = Number(year) || 0, w = Number(week) || 0;
    if (!y || !w) return "";
    return y + "-W" + pad2(w);
  }
  function weekSortOf(year, week) {
    var y = Number(year) || 0, w = Number(week) || 0;
    if (!y || !w) return 0;
    return y * 100 + w;
  }
  function isoWeekNow() {
    var d = new Date();
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var yStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return { year: t.getUTCFullYear(), week: Math.ceil(((t - yStart) / 86400000 + 1) / 7) };
  }

  /* ---------- 渠道字典 ---------- */
  async function loadSites() {
    var SB = SBx();
    if (!SB) { say("数据层未就绪，请强刷页面重试"); return; }
    try {
      state.sites = await SB.listChannelSites();
    } catch (e) {
      state.sites = [];
      say("读取渠道失败：" + ((e && e.message) || "未知错误"));
    }
    renderSites();
    fillChannelSelects();
  }

  function siteCount(name) {
    return state.items.filter(function (r) { return String(r.channel || "") === name; }).length;
  }

  function renderSites() {
    var box = document.getElementById("ch-sites");
    if (!box) return;
    box.innerHTML = "";
    if (!state.sites.length) {
      var t = document.createElement("span");
      t.className = "hint-inline";
      t.textContent = "还没有渠道，先在上面的输入框里加一个（如 SHEIN）";
      box.appendChild(t);
      return;
    }
    state.sites.forEach(function (s, i) {
      var n = siteCount(s.name);
      var el = document.createElement("div");
      el.className = "ch-site" + (s.active === false ? " is-off" : "");
      el.innerHTML =
        '<span class="ch-site-name" title="' + esc(s.name) + '">' + esc(s.name) + "</span>" +
        '<span class="ch-site-n">' + n + " 张</span>";
      var mk = function (txt, title, cls, fn) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "ch-site-btn" + (cls ? " " + cls : "");
        b.textContent = txt;
        b.title = title;
        b.onclick = fn;
        return b;
      };
      /* 排序：上移 / 下移（前台按 sort_order 出列，运营点两下就调好） */
      if (i > 0) el.appendChild(mk("↑", "上移一位", "", function () { moveSite(i, -1); }));
      if (i < state.sites.length - 1) el.appendChild(mk("↓", "下移一位", "", function () { moveSite(i, 1); }));
      el.appendChild(mk("✎", "改名", "", function () { renameSite(s); }));
      el.appendChild(mk(s.active === false ? "○" : "●", s.active === false ? "目前前台隐藏，点击启用" : "目前前台可见，点击隐藏", "", function () { toggleSite(s); }));
      el.appendChild(mk("×", "删除渠道（图片保留，归到「未分渠道」）", "is-danger", function () { delSite(s); }));
      box.appendChild(el);
    });
  }

  async function moveSite(i, dir) {
    var SB = SBx();
    var a = state.sites[i], b = state.sites[i + dir];
    if (!SB || !a || !b) return;
    try {
      var sa = Number(a.sort_order) || 0, sb = Number(b.sort_order) || 0;
      /* 排序值相同（历史数据）时，用序号补一个差值，保证换位真的换得动 */
      if (sa === sb) { sa = i * 10; sb = (i + dir) * 10; }
      await SB.reorderChannelSite(a.id, sb);
      await SB.reorderChannelSite(b.id, sa);
      await loadSites();
    } catch (e) { toast("调整顺序失败：" + ((e && e.message) || "未知错误"), false); }
  }

  async function renameSite(s) {
    var SB = SBx();
    var n = window.prompt("渠道改名（已有图片上的渠道名会一起改）：", s.name);
    if (n == null) return;
    n = String(n).trim();
    if (!n || n === s.name) return;
    try {
      await SB.renameChannelSite(s.id, s.name, n);
      await loadSites();
      await loadAll();
      toast("已改名");
    } catch (e) { toast("改名失败：" + ((e && e.message) || "未知错误"), false); }
  }

  async function toggleSite(s) {
    var SB = SBx();
    try {
      await SB.setChannelSiteActive(s.id, s.active === false);
      await loadSites();
      toast(s.active === false ? "已在前台显示" : "已在前台隐藏");
    } catch (e) { toast("保存失败：" + ((e && e.message) || "未知错误"), false); }
  }

  async function delSite(s) {
    var SB = SBx();
    if (!window.confirm("删除渠道「" + s.name + "」？\n只删渠道名，已有图片不会被删，会显示为「未分渠道」。")) return;
    try {
      await SB.deleteChannelSite(s.id);
      await loadSites();
      await loadAll();
      toast("已删除");
    } catch (e) { toast("删除失败：" + ((e && e.message) || "未知错误"), false); }
  }

  async function addSite() {
    var SB = SBx();
    var el = document.getElementById("ch-new-name");
    var n = el ? String(el.value || "").trim() : "";
    if (!n) { toast("请输入渠道名称", false); return; }
    try {
      await SB.addChannelSite(n);
      if (el) el.value = "";
      await loadSites();
      toast("已添加「" + n + "」");
    } catch (e) { toast(String((e && e.message) || "新增失败"), false); }
  }

  /* ---------- 下拉与筛选 ---------- */
  function siteNames() {
    var names = state.sites.map(function (s) { return String(s.name || "").trim(); }).filter(Boolean);
    /* 库里存在、字典里没有的渠道（字典被删过）也要能选到，否则那些图改不回来 */
    var extra = {};
    state.items.forEach(function (r) {
      var c = String(r.channel || "").trim() || "未分渠道";
      if (names.indexOf(c) < 0) extra[c] = 1;
    });
    Object.keys(extra).forEach(function (c) { names.push(c); });
    return names;
  }

  function fillChannelSelects() {
    var names = siteNames();
    var up = document.getElementById("ch-up-channel");
    if (up) {
      var keep = up.value;
      up.innerHTML = "";
      if (!names.length) up.add(new Option("请先添加渠道", ""));
      names.forEach(function (n) { up.add(new Option(n, n)); });
      if (keep && names.indexOf(keep) >= 0) up.value = keep;
    }
    var fl = document.getElementById("ch-filter-channel");
    if (fl) {
      var keepF = state.curChannel;
      fl.innerHTML = "";
      fl.add(new Option("全部渠道", ""));
      names.forEach(function (n) { fl.add(new Option(n, n)); });
      fl.value = keepF || "";
    }
    var tg = document.getElementById("ch-tag-channel");
    if (tg) {
      tg.innerHTML = "";
      tg.add(new Option("不指定", ""));
      names.forEach(function (n) { tg.add(new Option(n, n)); });
    }
  }

  function fillCatSelects() {
    var opts = (window.CONFIG && window.CONFIG.CATEGORY_OPTIONS) || [];
    ["ch-up-cat", "ch-filter-cat"].forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      var keep = sel.value;
      sel.innerHTML = "";
      sel.add(new Option(id === "ch-filter-cat" ? "全部类目" : "选择类目…", ""));
      opts.forEach(function (c) { sel.add(new Option(c, c)); });
      if (keep) sel.value = keep;
    });
  }

  function fillWeekFilter() {
    var sel = document.getElementById("ch-filter-week");
    if (!sel) return;
    var map = {};
    state.items.forEach(function (r) {
      var lb = String(r.week_label || "").trim();
      if (!lb) return;
      var s = Number(r.week_sort) || 0;
      if (!map[lb] || s > map[lb]) map[lb] = s;
    });
    var weeks = Object.keys(map).map(function (k) { return { label: k, sort: map[k] }; })
      .sort(function (a, b) { return b.sort - a.sort; });
    var keep = state.curWeek;
    sel.innerHTML = "";
    sel.add(new Option("全部周次", ""));
    weeks.forEach(function (w) {
      var n = state.items.filter(function (r) { return String(r.week_label || "") === w.label; }).length;
      sel.add(new Option(w.label + "（" + n + "）", w.label));
    });
    sel.value = keep || "";
  }

  /* ---------- 数据 ---------- */
  async function loadAll() {
    var SB = SBx();
    if (!SB) return;
    say("加载中…");
    try {
      state.items = (await SB.listChannelItems()) || [];
    } catch (e) {
      say("读取失败：" + ((e && e.message) || "未知错误"));
      return;
    }
    var urls = state.items.map(function (r) { return r.image_url; }).filter(Boolean);
    state.tagMap = {};
    if (urls.length) {
      try { state.tagMap = await SB.listChannelTags(urls); } catch (e) { state.tagMap = {}; }
    }
    state.ready = true;
    renderSites();          /* 数量随图片变化，顺便刷新 */
    fillChannelSelects();
    fillWeekFilter();
    renderMenu();
    renderGrid();
    renderCount();
    say("");
  }

  function filteredItems() {
    return state.items.filter(function (r) {
      if (state.curCat && (r.category || "未分类") !== state.curCat) return false;
      if (state.curChannel && String(r.channel || "") !== state.curChannel) return false;
      if (state.curWeek && String(r.week_label || "") !== state.curWeek) return false;
      return true;
    });
  }

  function renderCount() {
    var el = document.getElementById("ch-count");
    if (!el) return;
    var list = filteredItems();
    var done = list.filter(function (r) {
      var t = state.tagMap[r.image_url] || {};
      return DIMS.some(function (d) { return (t[d.key] || []).length; });
    }).length;
    var tail = (state.curChannel || state.curWeek) ? "（筛选后）" : "";
    el.textContent = list.length + " 张，已打标 " + done + " 张" + tail;
  }

  function renderMenu() {
    var nav = document.getElementById("ch-menu");
    if (!nav) return;
    var cnt = {};
    state.items.forEach(function (r) { var c = r.category || "未分类"; cnt[c] = (cnt[c] || 0) + 1; });
    var names = Object.keys(cnt).sort();
    nav.innerHTML = "";
    var all = document.createElement("button");
    all.className = "cat-menu-item" + (state.curCat ? "" : " active");
    all.innerHTML = "全部 <span class=\"ch-cat-n\">" + state.items.length + "</span>";
    all.onclick = function () { state.curCat = ""; syncCatSelect(); renderMenu(); renderGrid(); renderCount(); };
    nav.appendChild(all);
    names.forEach(function (c) {
      var b = document.createElement("button");
      b.className = "cat-menu-item" + (state.curCat === c ? " active" : "");
      b.innerHTML = esc(c) + ' <span class="ch-cat-n">' + cnt[c] + "</span>";
      b.onclick = function () { state.curCat = c; syncCatSelect(); renderMenu(); renderGrid(); renderCount(); };
      nav.appendChild(b);
    });
  }
  function syncCatSelect() {
    var sel = document.getElementById("ch-filter-cat");
    if (sel) sel.value = state.curCat || "";
  }

  function weekTag(r) {
    var lb = String(r.week_label || "").trim();
    return lb;
  }

  function renderGrid() {
    var box = document.getElementById("ch-grid");
    var empty = document.getElementById("ch-empty");
    if (!box) return;
    box.innerHTML = "";
    var list = filteredItems();
    if (!list.length) {
      if (empty) {
        empty.classList.remove("hidden");
        empty.textContent = state.items.length ? "当前筛选下没有图片" : "暂无图片";
      }
      return;
    }
    if (empty) empty.classList.add("hidden");
    list.forEach(function (r) {
      var t = state.tagMap[r.image_url] || {};
      var filled = DIMS.filter(function (d) { return (t[d.key] || []).length; }).length;
      var badge = [String(r.channel || "未分渠道"), weekTag(r)].filter(Boolean).join(" · ");
      var card = document.createElement("div");
      card.className = "gcard";
      card.innerHTML =
        '<div class="gthumb"><img loading="lazy" src="' + esc(r.image_url) + '" alt="">' +
        (badge ? '<span class="mv-season-badge">' + esc(badge) + "</span>" : "") +
        "</div>" +
        '<div class="gmeta">' +
        '<div class="gname">' + esc((r.title || "").slice(0, 40) || "—") + "</div>" +
        '<div class="gsub">' + esc(r.category || "未分类") +
        '<span class="mv-prog' + (filled >= DIMS.length ? " is-done" : "") + '">' + filled + "/" + DIMS.length + "</span></div>" +
        "</div>";
      card.onclick = function () { openTag(r.id); };
      box.appendChild(card);
    });
  }

  /* ---------- 上传 ---------- */
  function bindUpload() {
    var fi = document.getElementById("ch-file");
    var pick = document.getElementById("ch-pick-btn");
    var up = document.getElementById("ch-upload-btn");
    var clr = document.getElementById("ch-clear-btn");
    var drop = document.getElementById("ch-drop");
    if (pick && fi) pick.onclick = function () { fi.click(); };
    if (fi) fi.onchange = function () { addFiles(fi.files); fi.value = ""; };
    if (clr) clr.onclick = function () { state.pending = []; renderPending(); };
    if (up) up.onclick = doUpload;
    var ap = document.getElementById("ch-apply-all");
    if (ap) ap.onclick = applyDefaultsToAll;
    /* 顶部默认值一变，提示语跟着变；已加入的图不动，避免手改的被覆盖 */
    ["ch-up-cat", "ch-up-channel", "ch-up-year", "ch-up-week"].forEach(function (id) {
      var e = document.getElementById(id);
      if (e) e.addEventListener("change", function () { renderPending(); });
    });
    if (drop) {
      ["dragenter", "dragover"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); });
      });
      drop.addEventListener("drop", function (e) {
        if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
      });
    }
    var y = document.getElementById("ch-up-year");
    var w = document.getElementById("ch-up-week");
    var now = isoWeekNow();
    if (y && !y.value) y.value = now.year;
    if (w && !w.value) w.value = now.week;
    if (y) y.oninput = previewWeek;
    if (w) w.oninput = previewWeek;
    previewWeek();
  }

  function previewWeek() {
    var y = document.getElementById("ch-up-year");
    var w = document.getElementById("ch-up-week");
    var el = document.getElementById("ch-week-preview");
    if (!el) return;
    var lab = weekLabelOf(y && y.value, w && w.value);
    el.textContent = lab ? "本次周次：" + lab : "请填年份与周数（如 2026 / 44）";
  }

  /* 新加入的图片先带上「当前默认值」，之后每张都能单独改 */
  function defaults() {
    var catEl = document.getElementById("ch-up-cat");
    var chEl = document.getElementById("ch-up-channel");
    var yEl = document.getElementById("ch-up-year");
    var wEl = document.getElementById("ch-up-week");
    return {
      category: catEl ? String(catEl.value || "").trim() : "",
      channel: chEl ? String(chEl.value || "").trim() : "",
      weekLabel: weekLabelOf(yEl && yEl.value, wEl && wEl.value),
      weekSort: weekSortOf(yEl && yEl.value, wEl && wEl.value),
    };
  }

  function addFiles(list) {
    var imgs = Array.prototype.slice.call(list || []).filter(function (f) { return /^image\//.test(f.type); });
    if (!imgs.length) { toast("请选择图片文件", false); return; }
    var d = defaults();
    imgs.forEach(function (f) {
      state.pending.push({
        file: f, category: d.category, channel: d.channel,
        weekLabel: d.weekLabel, weekSort: d.weekSort,
      });
    });
    renderPending();
  }

  /* 把顶部默认值重新套到全部待传图片（改了默认值又想让所有图跟着变时用） */
  function applyDefaultsToAll() {
    if (!state.pending.length) { toast("待传列表是空的", false); return; }
    var d = defaults();
    if (!d.category || !d.channel || !d.weekLabel) { toast("请先在顶部选好类目 / 渠道 / 周次", false); return; }
    state.pending.forEach(function (it) {
      it.category = d.category; it.channel = d.channel;
      it.weekLabel = d.weekLabel; it.weekSort = d.weekSort;
    });
    renderPending();
    toast("已把默认值套用到 " + state.pending.length + " 张");
  }

  function renderPending() {
    var box = document.getElementById("ch-pending");
    var btn = document.getElementById("ch-upload-btn");
    var tip = document.getElementById("ch-upload-tip");
    if (btn) {
      btn.disabled = !state.pending.length;
      btn.textContent = "上传（" + state.pending.length + "）";
    }
    if (tip) {
      var miss = state.pending.filter(function (it) {
        return !it.category || !it.channel || !it.weekLabel;
      }).length;
      tip.textContent = state.pending.length
        ? ("待传 " + state.pending.length + " 张" + (miss ? "，其中 " + miss + " 张还没选全（类目/渠道/周次）" : ""))
        : "";
    }
    if (!box) return;
    box.innerHTML = "";
    if (!state.pending.length) return;

    var cats = (window.CONFIG && window.CONFIG.CATEGORY_OPTIONS) || [];
    var chans = siteNames();

    state.pending.forEach(function (it, i) {
      var d = document.createElement("div");
      d.className = "mv-pend-item ch-pend-row";

      var nm = document.createElement("span");
      nm.className = "mv-pend-name ch-pend-name";
      nm.textContent = it.file.name;
      nm.title = it.file.name;
      d.appendChild(nm);

      /* 类目：每张图各自选，不再一批共用一个 */
      var sc = document.createElement("select");
      sc.className = "input ch-pend-sel";
      sc.title = "这张图的类目";
      sc.add(new Option("类目…", ""));
      cats.forEach(function (c) { sc.add(new Option(c, c)); });
      /* 已有值不在标准清单里（历史类目）时补一个，否则会显示成空 */
      if (it.category && cats.indexOf(it.category) < 0) sc.add(new Option(it.category, it.category));
      sc.value = it.category || "";
      sc.onchange = function () { it.category = sc.value; renderPending(); };
      d.appendChild(sc);

      var sh = document.createElement("select");
      sh.className = "input ch-pend-sel";
      sh.title = "这张图的渠道";
      sh.add(new Option("渠道…", ""));
      chans.forEach(function (c) { sh.add(new Option(c, c)); });
      if (it.channel && chans.indexOf(it.channel) < 0) sh.add(new Option(it.channel, it.channel));
      sh.value = it.channel || "";
      sh.onchange = function () { it.channel = sh.value; renderPending(); };
      d.appendChild(sh);

      var sw = document.createElement("input");
      sw.className = "input ch-pend-week";
      sw.type = "text";
      sw.placeholder = "2026-W44";
      sw.title = "这张图的周次，格式 2026-W44";
      sw.value = it.weekLabel || "";
      sw.onchange = function () {
        var parsed = parseWeekInput(sw.value);
        it.weekLabel = parsed.label;
        it.weekSort = parsed.sort;
        sw.value = parsed.label;
        renderPending();
      };
      d.appendChild(sw);

      var x = document.createElement("button");
      x.className = "mv-pend-x";
      x.textContent = "×";
      x.onclick = function (e) { e.stopPropagation(); state.pending.splice(i, 1); renderPending(); };
      d.appendChild(x);
      box.appendChild(d);
    });
  }

  /* 允许手敲 2026-W44 / 2026w44 / 2026-44 / 202644 这几种写法 */
  function parseWeekInput(v) {
    var s = String(v == null ? "" : v).trim().toUpperCase();
    var m = s.match(/^(\d{4})\s*[-/\s]?\s*W?\s*(\d{1,2})$/);
    if (!m) {
      /* 纯 6 位数字 202644 也认 */
      var m2 = s.match(/^(\d{4})(\d{2})$/);
      if (m2) m = m2; else return { label: "", sort: 0 };
    }
    var y = Number(m[1]) || 0, w = Number(m[2]) || 0;
    if (!y || w < 1 || w > 53) return { label: "", sort: 0 };
    return { label: y + "-W" + pad2(w), sort: y * 100 + w };
  }

  async function doUpload() {
    var SB = SBx();
    if (!SB || !state.pending.length) return;

    /* 逐张校验：每张图都必须有自己的类目 / 渠道 / 周次 */
    var lacking = state.pending.filter(function (it) {
      return !it.category || !it.channel || !it.weekLabel;
    });
    if (lacking.length) {
      toast("还有 " + lacking.length + " 张没选全（类目/渠道/周次），先补齐再传", false);
      return;
    }

    /* 类目授权：超管不受限；被分配了具体类目的管理员只能传自己那几个类目 */
    if (typeof isSuper === "function" && !isSuper()) {
      var mine = [];
      try { mine = await SB.myZonePermissions("channel"); } catch (e) { mine = []; }
      if (mine.length) {
        var bad = {};
        state.pending.forEach(function (it) {
          if (mine.indexOf(it.category) < 0) bad[it.category] = 1;
        });
        var badList = Object.keys(bad);
        if (badList.length) {
          toast("你没有「" + badList.join("、") + "」类目的上传权限", false);
          return;
        }
      }
    }

    var btn = document.getElementById("ch-upload-btn");
    var prog = document.getElementById("ch-progress");
    var bar = document.getElementById("ch-progress-bar");
    if (btn) btn.disabled = true;
    if (prog) prog.classList.remove("hidden");

    /* 按「类目|渠道|周次」分组，同组一次提交，不同组各自提交；
       进度按总张数算，不按组数算 */
    var groups = {}, order = [];
    state.pending.forEach(function (it) {
      var k = it.category + "\u0001" + it.channel + "\u0001" + it.weekLabel;
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(it);
    });

    var total = state.pending.length;
    var done = 0;
    var okN = 0, failed = [];
    var combo = 0;

    try {
      for (var gi = 0; gi < order.length; gi++) {
        var list = groups[order[gi]];
        combo++;
        await SB.uploadChannelImages(list, {}, function () {
          done++;
          if (bar) bar.style.width = Math.round(done / total * 100) + "%";
          say("上传中 " + done + "/" + total + "（第 " + combo + "/" + order.length + " 组）");
        }).then(function (r) {
          okN += r.ok.length;
          failed = failed.concat(r.failed || []);
        });
      }

      state.pending = [];
      renderPending();

      var comboN = order.length;
      say("已上传 " + okN + " 张" +
        (comboN > 1 ? "（跨 " + comboN + " 个类目/渠道/周次组合）" : "") +
        (failed.length ? "，失败 " + failed.length + " 张" : ""));
      if (failed.length) {
        var reasons = {};
        failed.forEach(function (x) { reasons[x.reason || "未知"] = (reasons[x.reason || "未知"] || 0) + 1; });
        toast("失败 " + failed.length + " 张：" + Object.keys(reasons).slice(0, 2).join("；"), false);
        /* 失败的留在待传列表里，改完可以重传，不用重新挑图 */
        state.pending = failed.map(function (x) {
          var src = null;
          for (var i = 0; i < order.length; i++) {
            var g = groups[order[i]];
            for (var j = 0; j < g.length; j++) {
              if (g[j].file && g[j].file.name === x.name && !g[j]._kept) { src = g[j]; g[j]._kept = 1; break; }
            }
            if (src) break;
          }
          return src;
        }).filter(Boolean);
        if (state.pending.length) renderPending();
      }
      await loadAll();
    } catch (e) {
      toast("上传失败：" + ((e && e.message) || "未知错误"), false);
    } finally {
      if (prog) prog.classList.add("hidden");
      if (bar) bar.style.width = "0%";
      if (btn) btn.disabled = false;
    }
  }

  /* ---------- 打标面板 ---------- */
  function curItem() {
    return state.items.filter(function (r) { return String(r.id) === String(state.curId); })[0] || null;
  }

  function openTag(id) {
    var item = state.items.filter(function (r) { return String(r.id) === String(id); })[0];
    if (!item) return;
    state.curId = item.id;
    var img = document.getElementById("ch-tag-img");
    if (img) img.src = item.image_url;
    var tt = document.getElementById("ch-tag-title");
    if (tt) tt.textContent = [item.category, item.channel, item.week_label].filter(Boolean).join(" · ");
    fillChannelSelects();
    var tc = document.getElementById("ch-tag-channel");
    if (tc) tc.value = String(item.channel || "");
    var wr = weekParts(item.week_label);
    var ty = document.getElementById("ch-tag-year");
    var tw = document.getElementById("ch-tag-week");
    if (ty) ty.value = wr.year || "";
    if (tw) tw.value = wr.week || "";
    renderDims(item);
    var m = document.getElementById("ch-tag-modal");
    if (m) m.classList.remove("hidden");
  }

  function weekParts(label) {
    var m = String(label || "").match(/^(\d{4})-W(\d{1,2})$/);
    if (!m) return { year: "", week: "" };
    return { year: Number(m[1]), week: Number(m[2]) };
  }

  function closeTag() {
    var m = document.getElementById("ch-tag-modal");
    if (m) m.classList.add("hidden");
    state.curId = null;
  }

  /* 大图面板里改渠道 / 周次：改完立刻落库（传错批次不用删了重传） */
  async function saveMetaQuick() {
    var item = curItem();
    var SB = SBx();
    if (!item || !SB) return;
    var tc = document.getElementById("ch-tag-channel");
    var ty = document.getElementById("ch-tag-year");
    var tw = document.getElementById("ch-tag-week");
    var channel = tc ? String(tc.value || "").trim() : "";
    var lab = weekLabelOf(ty && ty.value, tw && tw.value);
    try {
      await SB.setChannelItemMeta(item.id, {
        channel: channel, weekLabel: lab, weekSort: weekSortOf(ty && ty.value, tw && tw.value)
      });
      item.channel = channel;
      item.week_label = lab;
      item.week_sort = weekSortOf(ty && ty.value, tw && tw.value);
      renderGrid(); renderCount(); fillWeekFilter(); renderSites();
      toast("已保存", true);
    } catch (e) {
      toast("保存失败：" + ((e && e.message) || "未知错误"), false);
    }
  }

  function renderDims(item) {
    var box = document.getElementById("ch-tag-dims");
    if (!box) return;
    box.innerHTML = "";
    var t = state.tagMap[item.image_url] || {};
    DIMS.forEach(function (d) {
      var cur = (t[d.key] || []).slice();
      var wrap = document.createElement("div");
      wrap.className = "mv-dim";
      var head = document.createElement("div");
      head.className = "mv-dim-head";
      head.innerHTML = "<b>" + esc(d.label) + "</b><span>" + cur.length + " 项</span>";
      wrap.appendChild(head);

      var vals = (d.key === "fit_tags") ? fitExpand() : enumValues(d);
      var chosen = document.createElement("div");
      chosen.className = "mv-chosen";
      cur.forEach(function (v) {
        var tag = document.createElement("span");
        tag.className = "mv-chip";
        tag.innerHTML = esc(v) + "<i>×</i>";
        tag.querySelector("i").onclick = function () {
          var o = state.tagMap[item.image_url] || {};
          o[d.key] = cur.filter(function (x) { return x !== v; });
          state.tagMap[item.image_url] = o;
          renderDims(item);
        };
        chosen.appendChild(tag);
      });
      wrap.appendChild(chosen);

      var sel = document.createElement("select");
      sel.className = "input mv-dim-sel";
      sel.add(new Option("＋ 选择…", ""));
      vals.forEach(function (v) { sel.add(new Option(v, v)); });
      sel.onchange = function () {
        var v = sel.value;
        if (!v) return;
        var o = state.tagMap[item.image_url] || {};
        var arr = (o[d.key] || []).slice();
        if (arr.indexOf(v) < 0) arr.push(v);
        o[d.key] = arr;
        state.tagMap[item.image_url] = o;
        renderDims(item);
      };
      wrap.appendChild(sel);
      box.appendChild(wrap);
    });
  }

  async function saveTag() {
    var SB = SBx();
    var item = curItem();
    if (!SB || !item) return;
    var t = state.tagMap[item.image_url] || {};
    var patch = {};
    DIMS.forEach(function (d) {
      if (t[d.key] !== undefined) patch[d.key] = (t[d.key] || []).slice();
    });
    try {
      await SB.saveChannelTags(item.image_url, patch);
      closeTag();
      await loadAll();
      toast("已保存");
    } catch (e) {
      toast("保存失败：" + ((e && e.message) || "未知错误"), false);
    }
  }

  async function delItem() {
    var SB = SBx();
    var item = curItem();
    if (!SB || !item) return;
    if (!window.confirm("删除这张图？打标记录会一并清空。")) return;
    try {
      await SB.deleteChannelItem(item.id);
      closeTag();
      await loadAll();
      toast("已删除");
    } catch (e) {
      toast("删除失败：" + ((e && e.message) || "未知错误"), false);
    }
  }

  /* ---------- 导出打标表（含图片 URL，可直接批量下载） ---------- */
  function buildDetail() {
    return filteredItems().map(function (r) {
      return { image_url: r.image_url, category: r.category || "" };
    });
  }

  function appendCol(ws, headName, valueByUrl) {
    if (!ws || !ws["!ref"]) return;
    var range = XLSX.utils.decode_range(ws["!ref"]);
    var col = range.e.c + 1;
    var urlCol = -1;
    for (var c = range.s.c; c <= range.e.c; c++) {
      var cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c: c })];
      if (cell && String(cell.v) === "图片URL") { urlCol = c; break; }
    }
    if (urlCol < 0) return;
    ws[XLSX.utils.encode_cell({ r: range.s.r, c: col })] = { t: "s", v: headName };
    for (var r = range.s.r + 1; r <= range.e.r; r++) {
      var u = ws[XLSX.utils.encode_cell({ r: r, c: urlCol })];
      var key = u && u.v ? String(u.v) : "";
      var val = valueByUrl[key] || "";
      if (val) ws[XLSX.utils.encode_cell({ r: r, c: col })] = { t: "s", v: val };
    }
    range.e.c = col;
    ws["!ref"] = XLSX.utils.encode_range(range);
  }

  async function doExport() {
    var RE = window.RankExport;
    if (!RE || typeof XLSX === "undefined") { toast("导出模块未加载，请强刷页面", false); return; }
    var list = filteredItems();
    if (!list.length) { toast("当前筛选下没有图片", false); return; }
    try {
      say("导出中…");
      var detail = list.map(function (r) { return { image_url: r.image_url, category: r.category || "" }; });
      var pack = RE.buildBook(detail, state.tagMap, {});
      var ws = pack.wb.Sheets[pack.wb.SheetNames[0]];
      var modelMap = {}, chanMap = {}, waistMap = {}, platMap = {}, wkMap = {};
      list.forEach(function (r) {
        var t = state.tagMap[r.image_url] || {};
        if ((t.skin_tags || []).length) modelMap[r.image_url] = t.skin_tags.join("，");
        if ((t.tags || []).length) chanMap[r.image_url] = t.tags.join("，");
        var w = (t.fit_tags || []).filter(function (x) { return String(x).indexOf("腰型·") === 0; })
          .map(function (x) { return String(x).split("·")[1]; });
        if (w.length) waistMap[r.image_url] = w.join("，");
        if (r.channel) platMap[r.image_url] = r.channel;
        if (r.week_label) wkMap[r.image_url] = r.week_label;
      });
      appendCol(ws, "模特", modelMap);
      appendCol(ws, "腰型", waistMap);
      appendCol(ws, "渠道", chanMap);
      /* 结构坐标用「渠道平台 / 周次」，与打标里的「渠道」标签区分开，避免表里两列同名 */
      appendCol(ws, "渠道平台", platMap);
      appendCol(ws, "周次", wkMap);
      var stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      XLSX.writeFile(pack.wb, "渠道雷达-打标表-" + stamp + ".xlsx");
      say("已导出 " + list.length + " 张");
    } catch (e) {
      say("导出失败：" + ((e && e.message) || "未知错误"));
    }
  }

  /* ---------- 打包下载图片（当前筛选） ---------- */
  async function doDownloadImages() {
    var SB = SBx();
    var list = filteredItems();
    if (!SB || !list.length) { toast("当前筛选下没有图片", false); return; }
    if (typeof JSZip === "undefined") { toast("打包组件未加载，请强刷页面", false); return; }
    var btn = document.getElementById("ch-images-btn");
    if (btn) btn.disabled = true;
    try {
      var zip = new JSZip();
      var okN = 0, badN = 0;
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        say("打包中 " + (i + 1) + "/" + list.length);
        try {
          var url = await SB.imageUrlWithToken(r);
          var res = await fetch(url);
          if (!res.ok) throw new Error("下载失败");
          var blob = await res.blob();
          var ext = (blob.type && blob.type.indexOf("png") >= 0) ? ".png" : ".jpg";
          var base = [r.category, r.channel, r.week_label].filter(Boolean).join("_");
          zip.file((base ? base + "_" : "") + (i + 1) + "_" + String(r.id) + ext, blob);
          okN++;
        } catch (e) { badN++; }
      }
      var out = await zip.generateAsync({ type: "blob" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(out);
      var name = ["渠道雷达", state.curCat || "全部类目", state.curChannel || "全部渠道", state.curWeek || "全部周次"]
        .join("_") + ".zip";
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      say("已打包 " + okN + " 张" + (badN ? "，失败 " + badN + " 张" : ""));
    } catch (e) {
      say("打包失败：" + ((e && e.message) || "未知错误"));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ---------- 导入打标表 ---------- */
  var FIT_GROUPS = ["领型", "袖型", "袖长", "衣长", "松紧度", "裤型", "裤长", "裙长", "腰型"];

  function recToPatch(v) {
    var patch = {};
    function arr(a) { return Array.isArray(a) ? a.filter(Boolean) : []; }
    if (v["风格"]) patch.style_tags = arr(v["风格"]);
    var visArr = [].concat(arr(v["视觉-背景"]), arr(v["视觉-画面构成"]), arr(v["视觉-呈现主体"]));
    if (visArr.length || v["视觉-背景"] || v["视觉-画面构成"] || v["视觉-呈现主体"]) patch.visual_tags = visArr;
    if (v["图案元素"]) patch.element_tags = arr(v["图案元素"]);
    if (v["二次工艺"]) patch.craft_tags = arr(v["二次工艺"]);
    if (v["拍摄方式"]) patch.shoot_tags = arr(v["拍摄方式"]);
    if (v["模特"]) patch.skin_tags = arr(v["模特"]);
    if (v["文化背景"]) patch.culture_tags = arr(v["文化背景"]);
    if (v["消费心理"]) patch.psych_tags = arr(v["消费心理"]);
    if (v["节日"]) patch.festival_tags = arr(v["节日"]);
    if (v["渠道"]) patch.tags = arr(v["渠道"]);
    var fit = [], anyFit = false;
    FIT_GROUPS.forEach(function (g) {
      if (v[g] === undefined) return;
      anyFit = true;
      arr(v[g]).forEach(function (x) { fit.push(g + "·" + x); });
    });
    if (anyFit) patch.fit_tags = fit;
    return patch;
  }

  function bindImport() {
    var btn = document.getElementById("ch-import-btn");
    var fi = document.getElementById("ch-import-file");
    if (btn && fi) btn.onclick = function () { fi.click(); };
    if (!fi) return;
    fi.onchange = async function () {
      var f = fi.files && fi.files[0];
      fi.value = "";
      if (!f) return;
      var IM = window.ImageImport;
      if (!IM || !IM.parseFile) { toast("导入模块未加载，请强刷页面", false); return; }
      try {
        say("解析表格…");
        var parsed = await IM.parseFile(f);
        var rows = (parsed && parsed.rows) || [];
        var set = {};
        state.items.forEach(function (r) { set[r.image_url] = 1; });
        var hit = 0, miss = 0, empty = 0;
        var SB = SBx();
        for (var i = 0; i < rows.length; i++) {
          var rec = rows[i];
          var u = String(rec.url || "").trim();
          if (!u || !set[u]) { miss++; continue; }
          var patch = recToPatch(rec.values || {});
          if (!Object.keys(patch).length) { empty++; continue; }
          await SB.saveChannelTags(u, patch);
          hit++;
        }
        await loadAll();
        say("导入完成：写入 " + hit + " 行，未匹配 " + miss + " 行" + (empty ? "，空行 " + empty : ""));
      } catch (e) {
        say("导入失败：" + ((e && e.message) || "未知错误"));
      }
    };
  }

  /* ---------- 前台标签可见性 ---------- */
  function isVis(key) { return state.vis[key] !== false; }
  async function loadVis() {
    var SB = SBx();
    if (!SB) return;
    try { state.vis = (await SB.getChannelTagVisibility()) || {}; } catch (e) { state.vis = {}; }
  }
  function renderVisList() {
    var box = document.getElementById("ch-vis-list");
    if (!box) return;
    box.innerHTML = "";
    DIMS.forEach(function (d) {
      var on = isVis(d.key);
      var row = document.createElement("label");
      row.className = "mv-vis-row" + (on ? "" : " is-off");
      row.innerHTML =
        '<span class="mv-vis-name">' + esc(d.label) + "</span>" +
        '<input type="checkbox" data-key="' + esc(d.key) + '"' + (on ? " checked" : "") + ">" +
        '<span class="mv-vis-state">' + (on ? "前台可见" : "仅后台") + "</span>";
      var cb = row.querySelector("input");
      cb.onchange = function () {
        state.vis[d.key] = cb.checked;
        row.className = "mv-vis-row" + (cb.checked ? "" : " is-off");
        var st = row.querySelector(".mv-vis-state");
        if (st) st.textContent = cb.checked ? "前台可见" : "仅后台";
      };
      box.appendChild(row);
    });
  }
  async function openVis() {
    await loadVis();
    renderVisList();
    var msg = document.getElementById("ch-vis-msg");
    if (msg) msg.textContent = "";
    var m = document.getElementById("ch-vis-modal");
    if (m) m.classList.remove("hidden");
  }
  function closeVis() {
    var m = document.getElementById("ch-vis-modal");
    if (m) m.classList.add("hidden");
  }
  async function saveVis() {
    var SB = SBx();
    if (!SB) return;
    var map = {};
    DIMS.forEach(function (d) { map[d.key] = isVis(d.key); });
    var msg = document.getElementById("ch-vis-msg");
    try {
      state.vis = await SB.setChannelTagVisibility(map);
      if (msg) msg.textContent = "已保存 " + new Date().toLocaleTimeString();
      toast("前台可见性已保存", true);
    } catch (e) {
      if (msg) msg.textContent = "保存失败";
      toast("保存失败：" + ((e && e.message) || "未知错误"), false);
    }
  }
  function showAllVis() {
    DIMS.forEach(function (d) { state.vis[d.key] = true; });
    renderVisList();
  }

  /* ---------- 初始化 ---------- */
  function init() {
    if (!document.getElementById("channel-card")) return;
    fillCatSelects();
    bindUpload();
    bindImport();

    var addBtn = document.getElementById("ch-add-btn");
    if (addBtn) addBtn.onclick = addSite;
    var newName = document.getElementById("ch-new-name");
    if (newName) newName.addEventListener("keydown", function (e) { if (e.key === "Enter") addSite(); });
    var sr = document.getElementById("ch-site-refresh");
    if (sr) sr.onclick = function () { loadSites(); };

    var ref = document.getElementById("ch-refresh");
    if (ref) ref.onclick = loadAll;

    var fc = document.getElementById("ch-filter-cat");
    if (fc) fc.onchange = function () { state.curCat = fc.value || ""; renderMenu(); renderGrid(); renderCount(); };
    var fch = document.getElementById("ch-filter-channel");
    if (fch) fch.onchange = function () { state.curChannel = fch.value || ""; renderGrid(); renderCount(); };
    var fw = document.getElementById("ch-filter-week");
    if (fw) fw.onchange = function () { state.curWeek = fw.value || ""; renderGrid(); renderCount(); };

    /* 大图面板里改渠道 / 周次：改完即存 */
    var tc = document.getElementById("ch-tag-channel");
    if (tc) tc.onchange = saveMetaQuick;
    var ty = document.getElementById("ch-tag-year");
    if (ty) ty.onchange = saveMetaQuick;
    var tw = document.getElementById("ch-tag-week");
    if (tw) tw.onchange = saveMetaQuick;

    var vb = document.getElementById("ch-vis-btn");
    if (vb) vb.onclick = openVis;
    var vs = document.getElementById("ch-vis-save");
    if (vs) vs.onclick = saveVis;
    var va = document.getElementById("ch-vis-all");
    if (va) va.onclick = showAllVis;
    var vc = document.getElementById("ch-vis-close");
    if (vc) vc.onclick = closeVis;

    var ex = document.getElementById("ch-export-btn");
    if (ex) ex.onclick = doExport;
    var im = document.getElementById("ch-images-btn");
    if (im) im.onclick = doDownloadImages;

    var sv = document.getElementById("ch-tag-save");
    if (sv) sv.onclick = saveTag;
    var dl = document.getElementById("ch-tag-del");
    if (dl) dl.onclick = delItem;
    var cl = document.getElementById("ch-tag-close");
    if (cl) cl.onclick = closeTag;

    renderPending();
    loadSites().then(loadAll);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  /* 对外只暴露三样：reload（进面板时刷新）、upload（自测用）、state（只读排查用） */
  window.ChannelAdmin = {
    reload: function () { loadSites().then(loadAll); },
    upload: function () { return doUpload(); },
    render: function () { renderPending(); },
    state: state,
  };
})();
