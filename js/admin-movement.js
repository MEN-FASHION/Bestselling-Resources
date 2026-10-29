/* ============================================================================
 * admin-movement.js —— 趋势动向专区（20261030A）
 *
 * 定位：批量传图 + 打标，结构与「趋势上升榜」一致。
 *   图片本体 → movement_items
 *   打标数据 → rank_image_tags（按图片地址唯一，与榜单共用同一张表、同一套维度）
 *
 * 为什么不复用视觉专区：
 *   视觉专区面向"图库运营"（谁传的谁改、类目授权），上传与打标权限绑在一起；
 *   趋势动向面向"批量收集 + 批量打标"，图片进来就是全组共享的素材，
 *   不需要按上传人隔离。两件事混在一张表里，正是之前导入反复失败的原因。
 *
 * 打标维度直接读 window.APP_ENUM（与榜单、视觉专区同一份枚举），
 * 新增维度只要改枚举文件，本页自动出现，不需要改这里。
 * ==========================================================================*/
(function () {
  var SBRef = null;
  function SBx() { return window.SB || SBRef || window.supabaseClient || null; }

  var state = {
    items: [],          // movement_items 行
    tagMap: {},         // url -> 打标记录
    pending: [],        // 待上传文件
    curCat: "",         // 当前类目筛选
    curId: null,        // 打标面板当前图片 id
    ready: false,
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(t, ok) {
    if (window.sbToast) return window.sbToast(t, ok !== false);
    var el = document.getElementById("mv-msg");
    if (el) el.textContent = t;
  }
  function say(t) { var el = document.getElementById("mv-msg"); if (el) el.textContent = t || ""; }

  /* 打标维度：与榜单面板同序，节日放最后（可选维度） */
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
    { key: "festival_tags", label: "节日（可选）", enum: "节日" },
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

  /* 版型的值按「部位·值」存（与导入导出格式一致），这里把部位展开成可选值 */
  function fitExpand() {
    var FIT = (window.APP_ENUM_GROUPS && window.APP_ENUM_GROUPS.fit) || [];
    var out = [];
    FIT.forEach(function (g) {
      (g.values || []).forEach(function (v) { out.push((g.label || "") + "·" + v); });
    });
    return out;
  }
  function fitCollapse(arr) {
    var FIT = (window.APP_ENUM_GROUPS && window.APP_ENUM_GROUPS.fit) || [];
    return FIT.map(function (g) {
      var hit = (arr || []).filter(function (x) { return String(x).indexOf((g.label || "") + "·") === 0; })
        .map(function (x) { return String(x).split("·")[1]; }).filter(Boolean);
      return { group: g.label, values: hit };
    });
  }

  /* ---------- 数据加载 ---------- */
  async function loadAll() {
    var SB = SBx();
    if (!SB) { say("数据层未就绪，请强刷页面重试"); return; }
    say("加载中…");
    try {
      var items = await SB.listMovementItems(state.curCat || null);
      state.items = items || [];
    } catch (e) {
      say("读取失败：" + ((e && e.message) || "未知错误"));
      return;
    }
    var urls = state.items.map(function (r) { return r.image_url; }).filter(Boolean);
    state.tagMap = {};
    if (urls.length) {
      try { state.tagMap = await SB.listMovementTags(urls); } catch (e) { state.tagMap = {}; }
    }
    state.ready = true;
    renderMenu();
    renderGrid();
    renderCount();
    say("");
  }

  function renderCount() {
    var el = document.getElementById("mv-count");
    if (!el) return;
    var n = state.items.length;
    var done = state.items.filter(function (r) {
      var t = state.tagMap[r.image_url] || {};
      return DIMS.some(function (d) { return (t[d.key] || []).length; });
    }).length;
    el.textContent = n + " 张，已打标 " + done + " 张";
  }

  function renderMenu() {
    var nav = document.getElementById("mv-menu");
    if (!nav) return;
    var cnt = {};
    state.items.forEach(function (r) { var c = r.category || "未分类"; cnt[c] = (cnt[c] || 0) + 1; });
    var names = Object.keys(cnt).sort();
    nav.innerHTML = "";
    var all = document.createElement("button");
    all.className = "cat-item" + (state.curCat ? "" : " is-active");
    all.textContent = "全部（" + state.items.length + "）";
    all.onclick = function () { state.curCat = ""; syncFilterSelect(); loadAll(); };
    nav.appendChild(all);
    names.forEach(function (c) {
      var b = document.createElement("button");
      b.className = "cat-item" + (state.curCat === c ? " is-active" : "");
      b.textContent = c + "（" + cnt[c] + "）";
      b.onclick = function () { state.curCat = c; syncFilterSelect(); loadAll(); };
      nav.appendChild(b);
    });
  }
  function syncFilterSelect() {
    var sel = document.getElementById("mv-filter-cat");
    if (sel) sel.value = state.curCat || "";
  }

  function renderGrid() {
    var box = document.getElementById("mv-grid");
    var empty = document.getElementById("mv-empty");
    if (!box) return;
    box.innerHTML = "";
    if (!state.items.length) {
      if (empty) empty.classList.remove("hidden");
      return;
    }
    if (empty) empty.classList.add("hidden");
    state.items.forEach(function (r) {
      var t = state.tagMap[r.image_url] || {};
      var filled = DIMS.filter(function (d) { return (t[d.key] || []).length; }).length;
      var card = document.createElement("div");
      card.className = "gcard";
      card.innerHTML =
        '<div class="gthumb"><img loading="lazy" src="' + esc(r.image_url) + '" alt=""></div>' +
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
    var fi = document.getElementById("mv-file");
    var pick = document.getElementById("mv-pick-btn");
    var up = document.getElementById("mv-upload-btn");
    var clr = document.getElementById("mv-clear-btn");
    var drop = document.getElementById("mv-drop");
    if (pick && fi) pick.onclick = function () { fi.click(); };
    if (fi) fi.onchange = function () { addFiles(fi.files); fi.value = ""; };
    if (clr) clr.onclick = function () { state.pending = []; renderPending(); };
    if (up) up.onclick = doUpload;
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
  }

  function addFiles(list) {
    var imgs = Array.prototype.slice.call(list || []).filter(function (f) { return /^image\//.test(f.type); });
    if (!imgs.length) { toast("请选择图片文件", false); return; }
    state.pending = state.pending.concat(imgs);
    renderPending();
  }

  function renderPending() {
    var box = document.getElementById("mv-pending");
    var btn = document.getElementById("mv-upload-btn");
    var tip = document.getElementById("mv-upload-tip");
    if (btn) {
      btn.disabled = !state.pending.length;
      btn.textContent = "上传（" + state.pending.length + "）";
    }
    if (tip) tip.textContent = state.pending.length ? "待传 " + state.pending.length + " 张" : "";
    if (!box) return;
    box.innerHTML = "";
    state.pending.forEach(function (f, i) {
      var d = document.createElement("div");
      d.className = "mv-pend-item";
      d.innerHTML = '<span class="mv-pend-name">' + esc(f.name) + "</span>";
      var x = document.createElement("button");
      x.className = "mv-pend-x";
      x.textContent = "×";
      x.onclick = function (e) { e.stopPropagation(); state.pending.splice(i, 1); renderPending(); };
      d.appendChild(x);
      box.appendChild(d);
    });
  }

  async function doUpload() {
    var SB = SBx();
    if (!SB || !state.pending.length) return;
    var sel = document.getElementById("mv-upload-cat");
    var cat = sel ? String(sel.value || "").trim() : "";
    if (!cat) { toast("请先选择上传类目", false); return; }
    /* 类目授权：超管不受限；被分配了具体类目的管理员只能传自己那几个类目。
       未配置任何类目时视为不限（与其它专区的口径一致）。 */
    if (typeof isSuper === "function" && !isSuper()) {
      var mine = [];
      try { mine = await SB.myZonePermissions("movement"); } catch (e) { mine = []; }
      if (mine.length && mine.indexOf(cat) < 0) {
        toast("你没有「" + cat + "」类目的上传权限", false);
        return;
      }
    }
    var btn = document.getElementById("mv-upload-btn");
    var prog = document.getElementById("mv-progress");
    var bar = document.getElementById("mv-progress-bar");
    if (btn) btn.disabled = true;
    if (prog) prog.classList.remove("hidden");
    var files = state.pending.slice();
    try {
      var res = await SB.uploadMovementImages(files, cat, function (done, total) {
        if (bar) bar.style.width = Math.round(done / total * 100) + "%";
        say("上传中 " + done + "/" + total);
      });
      state.pending = [];
      renderPending();
      say("已上传 " + res.ok.length + " 张" + (res.failed.length ? "，失败 " + res.failed.length + " 张" : ""));
      if (res.failed.length) {
        toast("部分失败：" + res.failed.slice(0, 3).map(function (x) { return x.name; }).join("、"), false);
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
  function openTag(id) {
    var item = state.items.filter(function (r) { return String(r.id) === String(id); })[0];
    if (!item) return;
    state.curId = item.id;
    var img = document.getElementById("mv-tag-img");
    if (img) img.src = item.image_url;
    var tt = document.getElementById("mv-tag-title");
    if (tt) tt.textContent = (item.title || item.category || "") + " · " + (item.image_url || "").split("/").pop();
    renderDims(item);
    var m = document.getElementById("mv-tag-modal");
    if (m) m.classList.remove("hidden");
  }
  function closeTag() {
    var m = document.getElementById("mv-tag-modal");
    if (m) m.classList.add("hidden");
    state.curId = null;
  }

  function curItem() {
    return state.items.filter(function (r) { return String(r.id) === String(state.curId); })[0] || null;
  }

  function renderDims(item) {
    var box = document.getElementById("mv-tag-dims");
    if (!box) return;
    box.innerHTML = "";
    var t = state.tagMap[item.image_url] || {};
    DIMS.forEach(function (d) {
      var cur = (t[d.key] || []).slice();
      var wrap = document.createElement("div");
      wrap.className = "mv-dim";
      var head = document.createElement("div");
      head.className = "mv-dim-head";
      head.innerHTML = '<b>' + esc(d.label) + "</b><span>" + cur.length + " 项</span>";
      wrap.appendChild(head);

      var vals = (d.key === "fit_tags") ? fitExpand() : enumValues(d);
      var chosen = document.createElement("div");
      chosen.className = "mv-chosen";
      cur.forEach(function (v) {
        var tag = document.createElement("span");
        tag.className = "mv-chip";
        tag.innerHTML = esc(v) + '<i>×</i>';
        tag.querySelector("i").onclick = function () {
          var next = cur.filter(function (x) { return x !== v; });
          state.tagMap[item.image_url] = Object.assign({}, t, (function () { var o = {}; o[d.key] = next; return o; })());
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
      await SB.saveMovementTags(item.image_url, patch);
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
      await SB.deleteMovementItem(item.id);
      closeTag();
      await loadAll();
      toast("已删除");
    } catch (e) {
      toast("删除失败：" + ((e && e.message) || "未知错误"), false);
    }
  }

  /* ---------- 导出 / 导入（复用榜单那套列与校验） ---------- */
  function buildDetail() {
    return state.items.map(function (r) {
      return { image_url: r.image_url, category: r.category || "" };
    });
  }
  /* 榜单导出的列里没有「模特」「渠道」「腰型」这三项（榜单用不到），
     但趋势动向要打这两类标签，所以导出后按图片URL就地补列。
     直接改单元格而不是重建整张表，是为了不破坏原表已经设好的列宽与样式。 */
  function appendCol(ws, headName, valueByUrl) {
    if (!ws || !ws["!ref"]) return;
    var range = XLSX.utils.decode_range(ws["!ref"]);
    var col = range.e.c + 1;
    // 找「图片URL」所在列，用它把每行和 URL 对上
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
    return col;
  }

  async function doExport() {
    var RE = window.RankExport;
    if (!RE || typeof XLSX === "undefined") { toast("导出模块未加载，请强刷页面", false); return; }
    if (!state.items.length) { toast("当前没有图片", false); return; }
    try {
      say("导出中…");
      var pack = RE.buildBook(buildDetail(), state.tagMap, {});
      var ws = pack.wb.Sheets[pack.wb.SheetNames[0]];
      var modelMap = {}, chanMap = {}, waistMap = {};
      state.items.forEach(function (r) {
        var t = state.tagMap[r.image_url] || {};
        if ((t.skin_tags || []).length) modelMap[r.image_url] = t.skin_tags.join("，");
        if ((t.tags || []).length) chanMap[r.image_url] = t.tags.join("，");
        var w = (t.fit_tags || []).filter(function (x) { return String(x).indexOf("腰型·") === 0; })
          .map(function (x) { return String(x).split("·")[1]; });
        if (w.length) waistMap[r.image_url] = w.join("，");
      });
      appendCol(ws, "模特", modelMap);
      appendCol(ws, "腰型", waistMap);
      appendCol(ws, "渠道", chanMap);
      XLSX.writeFile(pack.wb, "趋势动向-打标表-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + ".xlsx");
      say("已导出 " + state.items.length + " 张");
    } catch (e) {
      say("导出失败：" + ((e && e.message) || "未知错误"));
    }
  }

  /* 把解析出来的中文维度名映射到列名。
     版型按部位存成「部位·值」，与导出/榜单完全一致，导入时反向拼回去。 */
  var FIT_GROUPS = ["领型", "袖型", "袖长", "衣长", "松紧度", "裤型", "裤长", "裙长", "腰型"];

  function recToPatch(v) {
    var patch = {};
    function arr(a) { return Array.isArray(a) ? a.filter(Boolean) : []; }
    if (v["风格"]) patch.style_tags = arr(v["风格"]);
    var vis = [].concat(arr(v["视觉-背景"]), arr(v["视觉-画面构成"]), arr(v["视觉-呈现主体"]));
    if (vis.length || v["视觉-背景"] || v["视觉-画面构成"] || v["视觉-呈现主体"]) {
      patch.visual_tags = vis;
    }
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
    var btn = document.getElementById("mv-import-btn");
    var fi = document.getElementById("mv-import-file");
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
          /* rec.values 是「本次填了值」的格子；空格代表不管，不覆盖 */
          var patch = recToPatch(rec.values || {});
          if (!Object.keys(patch).length) { empty++; continue; }
          await SB.saveMovementTags(u, patch);
          hit++;
        }
        await loadAll();
        say("导入完成：写入 " + hit + " 行，未匹配 " + miss + " 行" + (empty ? "，空行 " + empty : ""));
      } catch (e) {
        say("导入失败：" + ((e && e.message) || "未知错误"));
      }
    };
  }

  /* ---------- 初始化 ---------- */
  function fillCatSelects() {
    var opts = (window.CONFIG && window.CONFIG.CATEGORY_OPTIONS) || [];
    ["mv-upload-cat", "mv-filter-cat"].forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      var keep = sel.value;
      sel.innerHTML = "";
      sel.add(new Option(id === "mv-filter-cat" ? "全部类目" : "选择类目…", ""));
      opts.forEach(function (c) { sel.add(new Option(c, c)); });
      if (keep) sel.value = keep;
    });
    var f = document.getElementById("mv-filter-cat");
    if (f) f.onchange = function () { state.curCat = f.value; loadAll(); };
  }

  function init() {
    if (!document.getElementById("movement-card")) return;
    fillCatSelects();
    bindUpload();
    bindImport();
    var ref = document.getElementById("mv-refresh");
    if (ref) ref.onclick = loadAll;
    var ex = document.getElementById("mv-export-btn");
    if (ex) ex.onclick = doExport;
    var sv = document.getElementById("mv-tag-save");
    if (sv) sv.onclick = saveTag;
    var dl = document.getElementById("mv-tag-del");
    if (dl) dl.onclick = delItem;
    var cl = document.getElementById("mv-tag-close");
    if (cl) cl.onclick = closeTag;
    renderPending();
    loadAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }

  window.MovementAdmin = { reload: loadAll, state: state };
})();