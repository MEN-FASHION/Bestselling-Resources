/* ============================================================================
 * admin-ranktag.js —— 后台「趋势上升榜 · 榜单打标作业台」
 * ----------------------------------------------------------------------------
 * 为什么单独一个面板（与「图片管理 → 智能打标」分开）：
 *   1) 数据源不同：榜单图只存在于 rank_items（表格里的「首图url」外链），
 *      图库 images 里没有这些记录 —— 所以在图片管理里根本筛不出来，也就没法打标；
 *   2) 存储不同：本页标签写 rank_image_tags，一张图一行（image_url 唯一），
 *      不进图库、不占存储、不出现在图片管理列表与数据看板里；
 *   3) 权限不同：与「趋势上升榜」同口径（任一管理员可用），
 *      不会被 images 表的「视觉专区 + 类目授权 + 只能改自己上传的」卡住。
 *   周报按图片地址把「图库标签 + 本表标签」合并使用，本表优先。
 *
 * 交互设计（方案 B · 零外部依赖）：
 *   原来：一次只看一个维度，按维度分池反复找图 → 一张图要被打标 6 遍、找 6 次。
 *   现在：一张大图 + 六维标签横排 → 判断一次、六维一次打完；键盘 1–9 落标签；
 *        同批同款可整批套用；顶部实时进度与各维覆盖率；批量套用可整批撤销。
 *   注意：这里不做任何图像识别，标签完全由人判断 —— 只是把找图、切换、拖拽这些体力活去掉。
 * ==========================================================================*/
(function () {
  "use strict";

  var SBX = window.SB || null;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  var toast = function (m, ok) { if (typeof sbToast === "function") sbToast(m, ok !== false); };
  var confirmBox = function (o) {
    if (typeof sbConfirm === "function") return sbConfirm(o);
    return Promise.resolve(window.confirm(o.title || "确定？"));
  };

  /* 六个维度：五个视觉维度直接用图库同名字段，类目是单值字符串。
     二次工艺不单独打标 —— 报告侧从「元素」标签里按工艺词派生，保持一套口径。 */
  var DIMS = [
    { key: "style",    field: "style_tags",   label: "款式与版型", hint: "版型 · 廓形 · 领型 · 长度" },
    { key: "element",  field: "element_tags", label: "图案印花",   hint: "图案主题 · 印花 · 装饰元素" },
    { key: "scene",    field: "scene_tags",   label: "场景与背景", hint: "室内 / 外景 / 纯色背景" },
    { key: "shoot",    field: "shoot_tags",   label: "主图视觉",   hint: "拍摄手法 · 光线 · 姿势" },
    { key: "skin",     field: "skin_tags",    label: "模特肤色",   hint: "浅 / 中 / 深" },
    { key: "category", field: "category",     label: "类目",       hint: "单选 · 与类目管理同口径" }
  ];
  var VISUAL = ["style_tags", "element_tags", "scene_tags", "shoot_tags", "skin_tags"];

  var inited = false;
  var ready = false;        // 建表脚本是否已执行
  var defs = {};            // dimKey -> [标签名]
  var catCands = [];        // 类目候选
  var all = [];             // 当前筛选下的全部榜单图
  var list = [];            // 应用「队列」筛选后可见的图
  var tags = {};            // image_url -> 标签行
  var idx = 0;
  var activeDim = "style";
  var filter = { cat: "", site: "", period: "", scope: "all" };
  var batchId = "";
  var bulkBatch = "";
  var bulkUrls = [];
  var visible = {};         // dimKey -> 当前可见标签（决定 1–9 对应哪一个）
  var searchKw = "";
  var saveTimers = {};
  var saveState = {};       // url -> saving / saved / error
  var queueShown = 240;

  function newBatchId() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return "rt-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function dimOf(key) {
    for (var i = 0; i < DIMS.length; i++) if (DIMS[i].key === key) return DIMS[i];
    return DIMS[0];
  }
  function rowOf(url) { return tags[url] || {}; }
  function hasAny(row) {
    if (!row) return false;
    for (var i = 0; i < VISUAL.length; i++) {
      if (Array.isArray(row[VISUAL[i]]) && row[VISUAL[i]].length) return true;
    }
    return !!row.category;
  }
  function currentItem() { return list[idx] || null; }

  /* ---------------- 数据加载 ---------------- */
  async function loadDefs() {
    var rows = [];
    try { rows = await SBX.listTagDefs(); } catch (e) { rows = []; }
    var map = {};
    (rows || []).forEach(function (r) {
      var t = String(r.type || "").trim();
      var n = String(r.name || "").trim();
      if (!t || !n) return;
      (map[t] = map[t] || []).push(n);
    });
    Object.keys(map).forEach(function (k) {
      var seen = {};
      map[k] = map[k].filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; });
    });
    defs = map;
  }

  async function loadCatCands(rankCats) {
    var set = {};
    try { (await SBX.listActiveCats()).forEach(function (c) { if (c) set[c] = 1; }); } catch (e) { }
    try { (await SBX.listUsedCats()).forEach(function (c) { if (c) set[c] = 1; }); } catch (e) { }
    ((window.CONFIG && window.CONFIG.CATEGORY_OPTIONS) || []).forEach(function (c) { if (c) set[c] = 1; });
    (rankCats || []).forEach(function (c) { if (c) set[c] = 1; });
    catCands = Object.keys(set).sort(function (a, b) { return String(a).localeCompare(String(b), "zh"); });
  }

  function fillSelect(sel, items, allLabel) {
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(allLabel || "全部") + "</option>" +
      items.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + "</option>"; }).join("");
    if (cur && items.indexOf(cur) >= 0) sel.value = cur;
  }

  async function loadFacets() {
    var f = { sites: [], periods: [], categories: [] };
    try { f = await SBX.rankFacets(); } catch (e) { f = { sites: [], periods: [], categories: [] }; }
    fillSelect($("#rt-f-cat"), f.categories || [], "全部类目");
    fillSelect($("#rt-f-site"), f.sites || [], "全部站点");
    fillSelect($("#rt-f-period"), f.periods || [], "全部期次");
    await loadCatCands(f.categories || []);
  }

  function showWarn() {
    var el = $("#rt-warn");
    if (!el) return;
    el.classList.remove("hidden");
    el.innerHTML =
      "<b>还差一步：执行一次建表脚本（约 10 秒）</b><br>" +
      "本页的标签要单独存一张表（不写图库），否则打了也存不住。请在数据库 SQL 编辑器里执行 <code>tools/patch_20261021Q.sql</code>，" +
      "然后点右上角「刷新队列」。<br>" +
      '<span class="rt-warn-sub">脚本是幂等的：可重复执行，不会删除任何现有图片与标签。</span>';
  }
  function hideWarn() {
    var el = $("#rt-warn");
    if (el) el.classList.add("hidden");
  }

  async function loadQueue() {
    if (!SBX) { toast("数据层未加载，请刷新页面", false); return; }
    var btn = $("#rt-load");
    if (btn) { btn.disabled = true; btn.textContent = "载入中…"; }
    try {
      ready = await SBX.rankTagReady();
      if (!ready) showWarn(); else hideWarn();
      var items = await SBX.listRankTagQueue({ category: filter.cat, site: filter.site, period: filter.period });
      all = items || [];
      if (ready) {
        tags = await SBX.listRankTagRows(all.map(function (x) { return x.image_url; }));
      } else {
        tags = {};
      }
      saveState = {};
      applyScope();
      idx = 0;
      renderAll();
      toast("已载入 " + all.length + " 张榜单图");
    } catch (e) {
      toast("载入队列失败，请稍后重试", false);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "载入队列"; }
    }
  }

  function readFilters() {
    filter.cat = ($("#rt-f-cat") && $("#rt-f-cat").value) || "";
    filter.site = ($("#rt-f-site") && $("#rt-f-site").value) || "";
    filter.period = ($("#rt-f-period") && $("#rt-f-period").value) || "";
    filter.scope = ($("#rt-f-scope") && $("#rt-f-scope").value) || "all";
  }

  function applyScope() {
    list = all.filter(function (it) {
      var done = hasAny(tags[it.image_url] || {});
      if (filter.scope === "undone") return !done;
      if (filter.scope === "done") return done;
      return true;
    });
    if (idx >= list.length) idx = Math.max(0, list.length - 1);
    if (idx < 0) idx = 0;
    queueShown = 240;
  }

  /* ---------------- 渲染 ---------------- */
  function renderAll() {
    renderStage();
    renderDimBodies();
    renderProgress();
    renderQueue();
    markQueueCur();
    renderQueueCount();
  }

  function renderQueueCount() {
    var el = $("#rt-queue-count");
    if (!el) return;
    el.textContent = all.length
      ? ("筛选后 " + all.length + " 张 · 当前队列 " + list.length + " 张")
      : "";
  }

  function renderStage() {
    var it = currentItem();
    var img = $("#rt-photo"), empty = $("#rt-photo-empty");
    if (!it) {
      if (img) { img.removeAttribute("src"); img.style.display = "none"; }
      if (empty) {
        empty.style.display = "";
        empty.textContent = all.length
          ? "当前队列为空 —— 把「队列」切回「全部图」试试"
          : "选择筛选条件后点「载入队列」";
      }
      if ($("#rt-idx")) $("#rt-idx").textContent = "—";
      if ($("#rt-meta")) $("#rt-meta").textContent = "";
      return;
    }
    if (empty) empty.style.display = "none";
    if (img) {
      img.style.display = "";
      img.onerror = function () {
        img.style.display = "none";
        if (empty) {
          empty.style.display = "";
          empty.textContent = "这张图打不开（对方图床可能做了防盗链）。可以点「看原图」确认，或按空格跳过 —— 不写标签不会污染统计。";
        }
      };
      if (img.getAttribute("src") !== it.image_url) img.src = it.image_url;
    }
    if ($("#rt-idx")) $("#rt-idx").textContent = (idx + 1) + " / " + list.length;
    renderStageMeta();
    var a = $("#rt-open-src");
    if (a) { a.href = it.image_url; a.style.display = ""; }
  }

  function renderStageMeta() {
    var it = currentItem();
    var el = $("#rt-meta");
    if (!it || !el) return;
    var row = rowOf(it.image_url);
    var st = saveState[it.image_url];
    var badges = [];
    if (st === "saving") badges.push('<i class="rt-st rt-st--ing">保存中…</i>');
    else if (st === "saved") badges.push('<i class="rt-st rt-st--ok">已保存</i>');
    else if (st === "error") badges.push('<i class="rt-st rt-st--bad">保存失败</i>');
    var n = 0;
    VISUAL.forEach(function (f) { n += (Array.isArray(row[f]) ? row[f].length : 0); });
    el.innerHTML =
      '<span class="rt-tagcat">' + esc(it.category || "未分类") + "</span>" +
      (it.leaf_category ? '<span class="rt-leaf">' + esc(it.leaf_category) + "</span>" : "") +
      (it.site ? '<span class="rt-site">' + esc(it.site) + "</span>" : "") +
      (it.periods && it.periods.length ? '<span class="rt-period">' + esc(it.periods.join(" / ")) + "</span>" : "") +
      (n ? '<span class="rt-count">已打 ' + n + " 个标签</span>" : '<span class="rt-count rt-count--none">还没打标</span>') +
      badges.join("");
  }

  function renderDimBodies() {
    var box = $("#rt-dims");
    if (!box) return;
    var it = currentItem();
    var row = it ? rowOf(it.image_url) : {};
    var kw = searchKw.toLowerCase();
    box.innerHTML = "";
    DIMS.forEach(function (d) {
      var cands = d.key === "category" ? catCands : (defs[d.key] || []);
      var shown = kw ? cands.filter(function (x) { return String(x).toLowerCase().indexOf(kw) >= 0; }) : cands;
      visible[d.key] = shown;
      var picked = d.key === "category"
        ? (row.category ? [row.category] : [])
        : (Array.isArray(row[d.field]) ? row[d.field] : []);
      var card = document.createElement("div");
      card.className = "rt-dim" + (d.key === activeDim ? " active" : "");
      card.setAttribute("data-dim", d.key);

      var head = document.createElement("div");
      head.className = "rt-dim-head";
      head.innerHTML = '<b>' + esc(d.label) + "</b>" +
        '<span class="rt-dim-hint">' + esc(d.hint) + "</span>" +
        '<span class="rt-dim-n">' + picked.length + " 个</span>";
      head.addEventListener("click", function () { activeDim = d.key; renderDimBodies(); });
      card.appendChild(head);

      var body = document.createElement("div");
      body.className = "rt-dim-body";
      if (!cands.length) {
        body.innerHTML = '<span class="rt-dim-empty">' +
          (d.key === "category" ? "还没有类目候选" : "该维度还没有标签 —— 去「标签管理」里加") + "</span>";
      } else if (!shown.length) {
        body.innerHTML = '<span class="rt-dim-empty">没有匹配「' + esc(searchKw) + "」的标签</span>";
      } else {
        shown.slice(0, 240).forEach(function (name, i) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "rt-tag" + (picked.indexOf(name) >= 0 ? " on" : "");
          var k = d.key === activeDim && i < 9;
          b.innerHTML = esc(name) + (k ? '<i class="rt-k">' + (i + 1) + "</i>" : "");
          b.title = k ? "快捷键 " + (i + 1) : "";
          b.addEventListener("click", function (e) { e.stopPropagation(); toggleTag(d.key, name); });
          body.appendChild(b);
        });
      }
      card.appendChild(body);
      box.appendChild(card);
    });
  }

  function renderProgress() {
    var total = all.length, done = 0, per = {};
    all.forEach(function (it) {
      var row = tags[it.image_url] || {};
      var any = false;
      VISUAL.forEach(function (f) {
        if (Array.isArray(row[f]) && row[f].length) { any = true; per[f] = (per[f] || 0) + 1; }
      });
      if (any) done++;
    });
    var pct = total ? Math.round(done * 100 / total) : 0;
    var c = $("#rt-pg-count");
    if (c) c.textContent = total ? ("本批 " + total + " 张 · 已打 " + done + " 张 · " + pct + "%") : "本批 0 张";
    var bar = $("#rt-pg-bar");
    if (bar) bar.style.width = pct + "%";
    var dims = $("#rt-pg-dims");
    if (dims) {
      dims.innerHTML = DIMS.filter(function (d) { return d.key !== "category"; }).map(function (d) {
        var n = per[d.field] || 0;
        var p = total ? Math.round(n * 100 / total) : 0;
        return '<span class="rt-pg-dim">' + esc(d.label) + " <b>" + p + "%</b> <i>" + n + "/" + total + "</i></span>";
      }).join("");
    }
  }

  function renderQueue() {
    var box = $("#rt-queue");
    if (!box) return;
    if (!list.length) { box.innerHTML = '<div class="hint">队列为空</div>'; return; }
    var show = list.slice(0, queueShown);
    box.innerHTML = show.map(function (it, i) {
      var done = hasAny(tags[it.image_url] || {});
      return '<button type="button" class="rt-thumb' + (done ? " done" : "") + '" data-i="' + i + '" title="' + esc(it.image_url) + '">' +
        '<img src="' + esc(it.image_url) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
        (done ? '<i class="rt-dot"></i>' : "") +
        "</button>";
    }).join("") +
      (list.length > show.length
        ? '<button type="button" class="rt-more" id="rt-more">再显示 ' + Math.min(240, list.length - show.length) + " 张</button>"
        : "");
    Array.prototype.forEach.call(box.querySelectorAll(".rt-thumb"), function (b) {
      b.addEventListener("click", function () {
        idx = Number(b.getAttribute("data-i")) || 0;
        renderStage(); renderDimBodies(); markQueueCur();
      });
    });
    var more = $("#rt-more");
    if (more) more.addEventListener("click", function () { queueShown += 240; renderQueue(); markQueueCur(); });
  }

  function markQueueCur() {
    var box = $("#rt-queue");
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll(".rt-thumb"), function (b) {
      b.classList.toggle("cur", Number(b.getAttribute("data-i")) === idx);
    });
    var cur = box.querySelector(".rt-thumb.cur");
    if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) { } }
  }

  function refreshThumb(i) {
    var box = $("#rt-queue");
    if (!box) return;
    var b = box.querySelector('.rt-thumb[data-i="' + i + '"]');
    if (!b) return;
    var it = list[i];
    var done = it ? hasAny(tags[it.image_url] || {}) : false;
    b.classList.toggle("done", done);
    var dot = b.querySelector(".rt-dot");
    if (done && !dot) { var d = document.createElement("i"); d.className = "rt-dot"; b.appendChild(d); }
    if (!done && dot) dot.remove();
  }

  /* ---------------- 打标与保存 ---------------- */
  function toggleTag(dimKey, name) {
    var it = currentItem();
    if (!it) return;
    if (!ready) { toast("标签表还没建好，打了也存不住（见顶部提示）", false); return; }
    var row = Object.assign({}, tags[it.image_url] || {});
    if (dimKey === "category") {
      row.category = (row.category === name ? "" : name);
    } else {
      var d = dimOf(dimKey);
      var arr = Array.isArray(row[d.field]) ? row[d.field].slice() : [];
      var i = arr.indexOf(name);
      if (i >= 0) arr.splice(i, 1); else arr.push(name);
      row[d.field] = arr;
    }
    tags[it.image_url] = row;
    renderDimBodies();
    renderStageMeta();
    renderProgress();
    refreshThumb(idx);
    renderQueueCount();
    scheduleSave(it.image_url);
  }

  function scheduleSave(url) {
    saveState[url] = "saving";
    clearTimeout(saveTimers[url]);
    renderStageMeta();
    saveTimers[url] = setTimeout(function () { saveOne(url); }, 450);
  }

  async function saveOne(url) {
    if (!ready || !SBX) return;
    var row = tags[url] || {};
    try {
      await SBX.saveRankTagRows([{
        image_url: url,
        category: row.category || "",
        style_tags: row.style_tags || [],
        element_tags: row.element_tags || [],
        scene_tags: row.scene_tags || [],
        shoot_tags: row.shoot_tags || [],
        skin_tags: row.skin_tags || [],
        tags: row.tags || [],
        batch_id: batchId
      }]);
      saveState[url] = "saved";
    } catch (e) {
      saveState[url] = "error";
      toast("保存失败：这次点的标签没写进库，请重试", false);
    }
    if (currentItem() && currentItem().image_url === url) renderStageMeta();
  }

  async function clearCurrent() {
    var it = currentItem();
    if (!it) return;
    var ok = await confirmBox({
      title: "清空本张标签",
      desc: "将把这张图的六个维度标签全部清空（只影响榜单标签表，不影响图库）。",
      danger: true,
      okText: "清空"
    });
    if (!ok) return;
    tags[it.image_url] = { image_url: it.image_url, category: "", style_tags: [], element_tags: [], scene_tags: [], shoot_tags: [], skin_tags: [] };
    renderDimBodies(); renderStageMeta(); renderProgress(); refreshThumb(idx);
    await saveOne(it.image_url);
    toast("已清空本张");
  }

  /* ---------------- 翻页 / 维度切换 ---------------- */
  function go(delta) {
    if (!list.length) return;
    idx = (idx + delta + list.length) % list.length;
    renderStage();
    renderDimBodies();
    markQueueCur();
  }

  function cycleDim(step) {
    var i = 0;
    DIMS.forEach(function (d, k) { if (d.key === activeDim) i = k; });
    activeDim = DIMS[(i + step + DIMS.length) % DIMS.length].key;
    renderDimBodies();
  }

  /* ---------------- 批量套用 / 撤销 ---------------- */
  async function applyBulk() {
    var it = currentItem();
    if (!it) { toast("先选一张图", false); return; }
    var src = tags[it.image_url] || {};
    if (!hasAny(src)) { toast("当前这张还没有任何标签", false); return; }
    var targets = all.filter(function (x) { return !hasAny(tags[x.image_url] || {}); });
    if (!targets.length) { toast("队列里已经没有未打标的图了"); return; }
    var ok = await confirmBox({
      title: "批量套用",
      desc: "将把当前这张图的标签，套给当前筛选下的 " + targets.length + " 张还没打标的图。套用后可点「撤销上次批量套用」一次性撤回，不影响你手动打的标。",
      okText: "套用 " + targets.length + " 张"
    });
    if (!ok) return;
    var bid = batchId + "-bulk-" + Date.now().toString(36);
    var rows = targets.map(function (x) {
      return {
        image_url: x.image_url,
        category: src.category || x.category || "",
        style_tags: (src.style_tags || []).slice(),
        element_tags: (src.element_tags || []).slice(),
        scene_tags: (src.scene_tags || []).slice(),
        shoot_tags: (src.shoot_tags || []).slice(),
        skin_tags: (src.skin_tags || []).slice(),
        tags: (src.tags || []).slice(),
        batch_id: bid
      };
    });
    try {
      for (var i = 0; i < rows.length; i += 100) {
        await SBX.saveRankTagRows(rows.slice(i, i + 100));
      }
      rows.forEach(function (r) { tags[r.image_url] = r; saveState[r.image_url] = "saved"; });
      bulkBatch = bid;
      bulkUrls = rows.map(function (r) { return r.image_url; });
      var undo = $("#rt-undo-bulk");
      if (undo) undo.classList.remove("hidden");
      applyScope();
      renderAll();
      toast("已套用 " + rows.length + " 张");
    } catch (e) {
      toast("批量套用失败：可能中途断开，请重试", false);
    }
  }

  async function undoBulk() {
    if (!bulkBatch) return;
    var ok = await confirmBox({
      title: "撤销批量套用",
      desc: "将清空上一次批量套用写入的标签（" + bulkUrls.length + " 张）。这一批里你后来手动改过的图也会一并清空 —— 只影响这一批被套用的图。",
      danger: true,
      okText: "撤销"
    });
    if (!ok) return;
    try {
      await SBX.clearRankTagBatch(bulkBatch);
      bulkUrls.forEach(function (u) {
        tags[u] = { image_url: u, category: "", style_tags: [], element_tags: [], scene_tags: [], shoot_tags: [], skin_tags: [] };
        saveState[u] = "saved";
      });
      bulkBatch = "";
      bulkUrls = [];
      var undo = $("#rt-undo-bulk");
      if (undo) undo.classList.add("hidden");
      applyScope();
      renderAll();
      toast("已撤销批量套用");
    } catch (e) {
      toast("撤销失败，请稍后重试", false);
    }
  }

  /* ---------------- 绑定 ---------------- */
  function bindUI() {
    var load = function () { readFilters(); loadQueue(); };
    if ($("#rt-load")) $("#rt-load").addEventListener("click", load);
    if ($("#rt-refresh")) $("#rt-refresh").addEventListener("click", load);
    if ($("#rt-f-scope")) $("#rt-f-scope").addEventListener("change", function () {
      filter.scope = this.value;
      idx = 0;
      applyScope();
      renderAll();
    });
    if ($("#rt-prev")) $("#rt-prev").addEventListener("click", function () { go(-1); });
    if ($("#rt-next")) $("#rt-next").addEventListener("click", function () { go(1); });
    if ($("#rt-clear")) $("#rt-clear").addEventListener("click", clearCurrent);
    if ($("#rt-apply")) $("#rt-apply").addEventListener("click", applyBulk);
    if ($("#rt-undo-bulk")) $("#rt-undo-bulk").addEventListener("click", undoBulk);

    /* 标签搜索：只重画标签区，输入框本身不重建，避免输入时丢焦点 */
    var host = $("#rt-dims");
    if (host && !$("#rt-tag-search-box")) {
      var box = document.createElement("div");
      box.id = "rt-tag-search-box";
      box.className = "rt-search";
      box.innerHTML = '<input id="rt-tag-search" class="input" type="text" placeholder="搜索标签：输入后各维度只显示匹配项">' +
        '<span class="rt-search-hint">1–9 = 当前高亮维度的第 n 个标签</span>';
      host.parentNode.insertBefore(box, host);
      box.querySelector("input").addEventListener("input", function (e) {
        searchKw = String(e.target.value || "").trim();
        renderDimBodies();
      });
    }

    /* 键盘：仅在面板可见、且焦点不在输入控件时生效 */
    document.addEventListener("keydown", function (e) {
      var card = document.getElementById("rank-tag-card");
      if (!card || card.classList.contains("hidden")) return;
      var t = e.target || {};
      var tag = String(t.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea" || t.isContentEditable) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); return; }
      if (e.key === " ") { e.preventDefault(); go(1); return; }
      if (e.key === "Tab") { e.preventDefault(); cycleDim(e.shiftKey ? -1 : 1); return; }
      if (/^[1-9]$/.test(e.key)) {
        var arr = visible[activeDim] || [];
        var n = Number(e.key) - 1;
        if (arr[n]) { e.preventDefault(); toggleTag(activeDim, arr[n]); }
      }
    });
  }

  async function enterRankTagPanel() {
    if (!batchId) batchId = newBatchId();
    var b = $("#rt-batch");
    if (b) b.textContent = "批次 " + batchId;
    if (!inited) {
      inited = true;
      bindUI();
      await loadDefs();
      await loadFacets();
    }
    if (!all.length) await loadQueue();
  }

  window.enterRankTagPanel = enterRankTagPanel;
  /* 供验证套件直接调用（真实页面仍只通过菜单进入，不改变对外行为） */
  window.RankTag = {
    enter: enterRankTagPanel,
    dims: function () { return DIMS.map(function (d) { return d.key; }); },
    state: function () { return { all: all, list: list, idx: idx, tags: tags, ready: ready, batch: batchId }; },
    toggle: function (key, name) { return toggleTag(key, name); },
    setFilter: function (p) { Object.assign(filter, p || {}); applyScope(); renderAll(); },
    go: function (n) { go(n); }
  };
})();