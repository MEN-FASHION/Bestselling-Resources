/* ============================================================================
 * admin-rankimport.js —— 后台「趋势上升榜 · 打标结果回填 + 批次撤回」
 *
 * 读回「导出打标表」得到的那张 Excel（或第三方按同款表头填好的表），
 * 按「图片URL」把标签写回 rank_image_tags（榜单图标签表，与图库 images 独立）。
 *
 * 五条硬规则：
 *   1) 只认图片URL 精确匹配；匹配不到的行不写、单独计数，绝不凭标题猜。
 *   2) 标签值必须落在枚举内（枚举来自 rankexport.js 的 ENUM）；枚举外的值不写，列进「未识别」清单。
 *   3) 两种写入模式，解决「重复导入会不会把已有标签冲掉」：
 *        fill       只补空白（默认）—— 已有值的维度一律不动，重复导入同一份表完全无副作用
 *        overwrite  覆盖同名列 —— 用来改错：表里填什么就写什么
 *      覆盖模式下再给一个开关「空单元格也清空」：勾了才会把错标删掉，不勾空单元格=不动。
 *   4) 每一次改动都记 before/after 到 rank_tag_history，撤回时按 before 写回；
 *      且只回滚「当前值仍等于当时写入值」的字段 —— 后来人工改过的不动。
 *   5) 本批写入带 batch_id，事后可按批次撤回，不会误伤别的批次与人工单改的行。
 * ==========================================================================*/
(function () {
  var $ = function (s) { return document.querySelector(s); };

  /* 表头列 → [存储字段, 枚举键] */
  var MAP = [
    ["风格", "style_tags", "style"],
    ["图案元素", "element_tags", "element"],
    ["二次工艺", "craft_tags", "craft"],
    ["拍摄方式", "shoot_tags", "shoot"],
    ["视觉-背景", "visual_tags", "visual"],
    ["视觉-画面构成", "visual_tags", "visual"],
    ["视觉-呈现主体", "visual_tags", "visual"],
    ["领型", "fit_tags", "fit领型"],
    ["袖型", "fit_tags", "fit袖型"],
    ["袖长", "fit_tags", "fit袖长"],
    ["衣长", "fit_tags", "fit衣长"],
    ["松紧度", "fit_tags", "fit松紧度"],
    ["裤型", "fit_tags", "fit裤型"],
    ["裤长", "fit_tags", "fit裤长"],
    ["裙长", "fit_tags", "fit裙长"]
  ];

  /* 参与「是否已打标」判断的 6 个主维度 */
  var FIELDS = ["style_tags", "visual_tags", "element_tags", "craft_tags", "shoot_tags", "fit_tags"];

  var parsed = null;     // { rows:[{url, tags, provided}], fields:[], bad, unknown, headers, sheet }
  var historyOK = null;  // 历史表是否可用（null=未探测）

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes());
  }
  function fmtTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
      + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function splitArr(v) {
    return String(v == null ? "" : v).split(/[,，、|；;]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function enumOf(key) {
    var E = (window.RankExport && window.RankExport.ENUM) || {};
    if (key.indexOf("fit") === 0) return E[key.slice(3)] || [];
    var m = { style: "风格", element: "图案元素", craft: "二次工艺", shoot: "拍摄方式", visual: "视觉" };
    return E[m[key]] || [];
  }

  function sameArr(a, b) {
    var x = Array.isArray(a) ? a : [], y = Array.isArray(b) ? b : [];
    if (x.length !== y.length) return false;
    for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  function setTip(sel, msg, ok) {
    var el = $(sel || "#rank-tag-file-tip");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "rank-file-tip" + (ok === false ? " bad" : ok === true ? " good" : "");
  }

  /* 解析工作簿：优先取「打标表」工作表，否则取第一个
     返回 rows 里每行带 provided（这张图本次真正要写的维度），空白单元格不算"要写" */
  function parseBook(buf) {
    var wb = XLSX.read(buf, { type: "array" });
    var name = wb.SheetNames.indexOf("打标表") >= 0 ? "打标表" : wb.SheetNames[0];
    var aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" });
    if (!aoa.length) return { rows: [], bad: [], unknown: [], headers: [], fields: [] };
    var headers = (aoa[0] || []).map(function (h) { return String(h || "").trim(); });
    var iUrl = headers.indexOf("图片URL");
    if (iUrl < 0) iUrl = headers.findIndex(function (h) { return /图片\s*url|图片地址|首图/i.test(h); });
    if (iUrl < 0) throw new Error("缺少「图片URL」列");
    var iCat = headers.indexOf("类目");

    /* 表里出现了哪些维度的列（列在就算「本表管这个维度」，用于覆盖模式下的清空判断） */
    var fileFields = [];
    MAP.forEach(function (m) { if (headers.indexOf(m[0]) >= 0 && fileFields.indexOf(m[1]) < 0) fileFields.push(m[1]); });

    var rows = [], bad = [], unknown = {}, seen = {};
    for (var r = 1; r < aoa.length; r++) {
      var line = aoa[r] || [];
      var url = String(line[iUrl] || "").trim();
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) { bad.push({ row: r + 1, why: "URL 格式不对" }); continue; }
      if (seen[url]) continue;
      seen[url] = 1;
      var rec = { url: url, tags: {}, provided: {}, category: iCat >= 0 ? String(line[iCat] || "").trim() : "" };
      MAP.forEach(function (m) {
        var label = m[0], field = m[1], ekey = m[2];
        var ci = headers.indexOf(label);
        if (ci < 0) return;
        var vals = splitArr(line[ci]);
        if (!vals.length) return;
        var allow = enumOf(ekey);
        var list = rec.tags[field] || [];
        vals.forEach(function (v) {
          if (allow.length && allow.indexOf(v) < 0) { unknown[v] = (unknown[v] || 0) + 1; return; }
          if (field === "fit_tags") v = ekey.slice(3) + "·" + v;
          if (list.indexOf(v) < 0) list.push(v);
        });
        if (list.length) { rec.tags[field] = list; rec.provided[field] = 1; }
      });
      rows.push(rec);
    }
    var unknownList = Object.keys(unknown).map(function (k) { return { v: k, n: unknown[k] }; })
      .sort(function (a, b) { return b.n - a.n; });
    return { rows: rows, bad: bad, unknown: unknownList, headers: headers, fields: fileFields, sheet: name };
  }

  /* 纯函数：把「解析结果 + 库里现状」合并成最终要写的行与历史
     opts: { mode:'fill'|'overwrite', clearEmpty:bool }
     返回 { payload, history, stats:{changed, skipped, fields, untouched} } */
  function applyPlan(rows, exist, fileFields, opts) {
    var o = opts || {};
    var mode = o.mode === "overwrite" ? "overwrite" : "fill";
    var clearEmpty = !!o.clearEmpty;
    var payload = [], history = [];
    var stats = { changed: 0, skipped: 0, fields: 0, untouched: 0 };

    (rows || []).forEach(function (rec) {
      var c = (exist && exist[rec.url]) || {};
      var next = {
        image_url: rec.url,
        category: c.category || rec.category || "",
        style_tags: (c.style_tags || []).slice(),
        element_tags: (c.element_tags || []).slice(),
        scene_tags: (c.scene_tags || []).slice(),
        shoot_tags: (c.shoot_tags || []).slice(),
        skin_tags: (c.skin_tags || []).slice(),
        tags: (c.tags || []).slice(),
        visual_tags: (c.visual_tags || []).slice(),
        craft_tags: (c.craft_tags || []).slice(),
        fit_tags: (c.fit_tags || []).slice()
      };
      var changes = [];
      FIELDS.forEach(function (f) {
        var before = (c[f] || []).slice();
        var has = !!rec.provided[f];
        if (has) {
          /* 补齐模式：已有值的一律不动 */
          if (mode === "fill" && before.length) { stats.skipped++; return; }
          var after = (rec.tags[f] || []).slice();
          if (!sameArr(before, after)) { next[f] = after; changes.push({ field: f, before: before, after: after }); }
          return;
        }
        /* 覆盖模式 + 空单元格也清空：只有表里确实有这一列才清 */
        if (mode === "overwrite" && clearEmpty && (fileFields || []).indexOf(f) >= 0 && before.length) {
          next[f] = [];
          changes.push({ field: f, before: before, after: [] });
        }
      });
      if (!changes.length) { stats.untouched++; return; }
      stats.changed++;
      stats.fields += changes.length;
      payload.push(next);
      changes.forEach(function (ch) {
        history.push({ image_url: rec.url, field: ch.field, before_tags: ch.before, after_tags: ch.after });
      });
    });
    return { payload: payload, history: history, stats: stats };
  }

  async function onFile(file) {
    parsed = null;
    $("#rank-tag-import").disabled = true;
    setTip(null, "正在解析…");
    try {
      var buf = await file.arrayBuffer();
      var res = parseBook(buf);
      var detail = await SB.listRankItems({});
      var exist = {};
      detail.forEach(function (r) { exist[String(r.image_url || "").trim()] = 1; });

      /* 取库里已有标签，用来看"这张图已经打过了没有" */
      var hitUrls = res.rows.map(function (x) { return x.url; }).filter(function (u) { return exist[u]; });
      var tagged = {};
      try { tagged = await SB.listRankTagRows(hitUrls); } catch (e) { tagged = {}; }

      var hit = res.rows.filter(function (x) { return exist[x.url]; });
      var already = hit.filter(function (x) {
        var t = tagged[x.url] || {};
        return FIELDS.some(function (f) { return Array.isArray(t[f]) && t[f].length; });
      }).length;

      var miss = res.rows.length - hit.length;
      parsed = { rows: hit, miss: miss, unknown: res.unknown, bad: res.bad, total: res.rows.length,
        exist: tagged, fields: res.fields, fileName: file.name || "", scope: "" };
      var msg = "解析完成：" + res.sheet + " · 有效 " + res.rows.length + " 张图 · 能对上榜单 " + hit.length + " 张"
        + (miss ? " · 对不上 " + miss + " 张（不会写入）" : "")
        + (already ? " · 其中 " + already + " 张已有标签（补齐模式下会跳过）" : "")
        + (res.unknown.length ? " · 枚举外标签 " + res.unknown.length + " 个（不会写入）" : "");
      setTip(null, msg, hit.length > 0);
      refreshPlan();
      $("#rank-tag-import").disabled = hit.length === 0;
    } catch (e) {
      setTip(null, "解析失败：" + (e && e.message ? e.message : "表格格式不对"), false);
    }
  }

  function modeOpts() {
    var m = $("#rank-tag-mode");
    var ce = $("#rank-tag-clear-empty");
    return { mode: m ? m.value : "fill", clearEmpty: !!(ce && ce.checked) };
  }

  /* 按当前模式预估：会改多少张、跳过多少 */
  function refreshPlan() {
    if (!parsed) return null;
    var plan = applyPlan(parsed.rows, parsed.exist, parsed.fields, modeOpts());
    var tip = $("#rank-tag-plan-tip");
    if (tip) {
      tip.textContent = "按当前模式：将改动 " + plan.stats.changed + " 张图（" + plan.stats.fields + " 个字段）"
        + (plan.stats.skipped ? "；因已有标签跳过 " + plan.stats.skipped + " 处" : "")
        + (plan.stats.untouched ? "；无变化 " + plan.stats.untouched + " 张" : "");
    }
    return plan;
  }

  async function checkHistory() {
    if (historyOK !== null) return historyOK;
    try {
      await SB.listRankTagHistory("__probe__");
      await SB.listRankTagBatches(1);
      historyOK = true;
    } catch (e) {
      historyOK = false;
    }
    return historyOK;
  }

  async function doImport() {
    if (!parsed || !parsed.rows.length) return;
    var btn = $("#rank-tag-import");
    var opts = modeOpts();
    var plan = applyPlan(parsed.rows, parsed.exist, parsed.fields, opts);
    if (!plan.payload.length) {
      setTip(null, "没有需要写入的改动（当前模式下所有行要么已有标签、要么没填）", false);
      return;
    }
    btn.disabled = true;
    var old = btn.textContent;
    btn.textContent = "写入中…";
    try {
      var canHistory = await checkHistory();
      var batch = "tagimport-" + stamp();
      var payload = plan.payload.map(function (x) {
        var r = {};
        Object.keys(x).forEach(function (k) { r[k] = x[k]; });
        r.batch_id = batch;
        return r;
      });
      var n = await SB.saveRankTagRows(payload);

      var historySaved = 0, historyWarn = "";
      if (canHistory) {
        try {
          var hist = plan.history.map(function (h) {
            return { batch_id: batch, image_url: h.image_url, field: h.field, before_tags: h.before_tags, after_tags: h.after_tags };
          });
          historySaved = await SB.saveRankTagHistory(hist);
        } catch (e) { historyWarn = "；历史记录写入失败，本批无法精确撤回"; }
      } else {
        historyWarn = "；历史表不可用（未执行 patch_20261027J），本批只能整批清空、不能精确撤回";
      }

      if (canHistory) {
        try {
          await SB.saveRankTagBatch({
            batch_id: batch,
            file_name: parsed.fileName,
            mode: opts.mode,
            image_count: parsed.total,
            changed_count: plan.stats.changed,
            field_count: plan.stats.fields,
            skipped_count: plan.stats.skipped,
            unmatched_count: parsed.miss,
            unknown_tags: parsed.unknown.map(function (x) { return x.v; }),
            status: "applied",
            note: (opts.clearEmpty ? "空单元格清空" : ""),
          });
        } catch (e) { historyWarn += "；批次台账写入失败"; }
      }

      var msg = "已写入 " + n + " 张图的标签（批次 " + batch + "，"
        + (opts.mode === "overwrite" ? "覆盖" : "补齐") + "模式）"
        + (plan.stats.skipped ? "；跳过已有标签 " + plan.stats.skipped + " 处" : "")
        + (parsed.miss ? "；跳过对不上榜单的 " + parsed.miss + " 张" : "")
        + historyWarn;
      setTip(null, msg, true);
      if (window.sbToast) sbToast("已写入 " + n + " 张图的标签", true);
      loadTagBatches();
    } catch (e) {
      setTip(null, "写入失败，请重试", false);
      if (window.sbToast) sbToast("写入失败，请重试", false);
    } finally {
      btn.disabled = false;
      btn.textContent = old || "写入标签";
    }
  }

  /* 纯函数：算「撤回某批次」要写回什么
     hist: [{image_url, field, before_tags, after_tags}]
     cur : { 图片URL: 库里当前那一行 }
     规则：只回滚「当前值仍 === 当时写入值」的字段；
           该字段之后又被别的批次或人工改过 → 跳过并计数，绝不覆盖新改动。 */
  function planRevert(hist, cur) {
    var byUrl = new Map();
    (hist || []).forEach(function (h) {
      var u = String(h.image_url || "").trim();
      var f = String(h.field || "").trim();
      if (!u || !f) return;
      var m = byUrl.get(u);
      if (!m) { m = {}; byUrl.set(u, m); }
      m[f] = { before: Array.isArray(h.before_tags) ? h.before_tags : [], after: Array.isArray(h.after_tags) ? h.after_tags : [] };
    });
    var payload = [], restored = 0, conflict = 0;
    byUrl.forEach(function (fields, u) {
      var c = (cur || {})[u];
      if (!c) { conflict += Object.keys(fields).length; return; }
      var next = {
        image_url: u,
        category: c.category || "",
        style_tags: (c.style_tags || []).slice(),
        element_tags: (c.element_tags || []).slice(),
        scene_tags: (c.scene_tags || []).slice(),
        shoot_tags: (c.shoot_tags || []).slice(),
        skin_tags: (c.skin_tags || []).slice(),
        tags: (c.tags || []).slice(),
        visual_tags: (c.visual_tags || []).slice(),
        craft_tags: (c.craft_tags || []).slice(),
        fit_tags: (c.fit_tags || []).slice(),
        batch_id: null
      };
      var touched = false;
      Object.keys(fields).forEach(function (f) {
        var h = fields[f];
        if (sameArr(next[f], h.after)) { next[f] = h.before.slice(); restored++; touched = true; }
        else conflict++;
      });
      if (touched) payload.push(next);
    });
    return { payload: payload, restored: restored, conflict: conflict, total: byUrl.size };
  }

  /* ---------------- 批次列表 + 撤回 ---------------- */
  async function loadTagBatches() {
    var box = $("#rank-tag-batch-list");
    if (!box) return;
    box.innerHTML = '<div class="hint">正在读取…</div>';
    var list = [];
    try { list = await SB.listRankTagBatches(60); }
    catch (e) {
      box.innerHTML = '<div class="hint">批次台账不可用：请先执行 patch_20261027J.sql，之后每批导入都会留下可撤回的记录</div>';
      return;
    }
    if (!list.length) { box.innerHTML = '<div class="rkadm-empty">还没有打标导入记录</div>'; return; }
    box.innerHTML = "";
    list.forEach(function (b) {
      var row = document.createElement("div");
      row.className = "rank-batch-row";

      var main = document.createElement("span");
      main.className = "rank-batch-main";
      var st = b.status === "reverted" ? "已撤回" : "已写入";
      main.textContent = fmtTime(b.created_at) + " · " + b.batch_id
        + " · " + (b.mode === "overwrite" ? "覆盖" : "补齐")
        + " · 改动 " + (b.changed_count || 0) + " 张 / " + (b.field_count || 0) + " 字段"
        + (b.skipped_count ? " · 跳过 " + b.skipped_count : "")
        + (b.unmatched_count ? " · 对不上 " + b.unmatched_count : "")
        + " · " + st + (b.file_name ? " · " + b.file_name : "");

      var act = document.createElement("span");
      act.className = "rkadm-row-act";

      var undo = document.createElement("button");
      undo.type = "button";
      undo.className = "btn-ghost small rank-batch-del";
      undo.textContent = b.status === "reverted" ? "已撤回" : "撤回本批";
      undo.disabled = b.status === "reverted";
      undo.onclick = async function () {
        if (!confirm("撤回批次「" + b.batch_id + "」？\n\n会把这次改动前的标签写回去（涉及 "
          + (b.changed_count || 0) + " 张图）。\n此后再被人改过的字段会跳过、不会被覆盖。\n撤回本身也记在案，撤回后不能重做。")) return;
        undo.disabled = true;
        undo.textContent = "撤回中…";
        try {
          var hist = await SB.listRankTagHistory(b.batch_id);
          if (!hist.length) throw new Error("该批次没有历史记录，无法精确撤回（可能是建在 20261027J 之前）");
          var urls = [];
          hist.forEach(function (h) { if (urls.indexOf(h.image_url) < 0) urls.push(h.image_url); });
          var cur = await SB.listRankTagRows(urls);
          var plan = planRevert(hist, cur);
          if (plan.payload.length) await SB.saveRankTagRows(plan.payload);
          await SB.updateRankTagBatch(b.batch_id, { status: "reverted", reverted_at: new Date().toISOString() });
          var m = "已撤回：恢复 " + plan.restored + " 个字段（" + plan.payload.length + " 张图）"
            + (plan.conflict ? "；跳过 " + plan.conflict + " 个已被后续修改的字段" : "");
          setTip("#rank-tag-batch-tip", m, true);
          if (window.sbToast) sbToast(m, true);
        } catch (e) {
          var why = (e && e.message) || "撤回失败";
          setTip("#rank-tag-batch-tip", why, false);
          if (window.sbToast) sbToast(why, false);
        }
        loadTagBatches();
      };

      act.appendChild(undo);
      row.appendChild(main);
      row.appendChild(act);
      box.appendChild(row);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var f = $("#rank-tag-file"), b = $("#rank-tag-import");
    if (f && b) {
      f.addEventListener("change", function () {
        var file = f.files && f.files[0];
        if (file) onFile(file);
      });
      b.addEventListener("click", doImport);
    }
    var m = $("#rank-tag-mode"), ce = $("#rank-tag-clear-empty");
    if (m) m.addEventListener("change", function () {
      if (ce) ce.disabled = m.value !== "overwrite";
      if (ce && m.value !== "overwrite") ce.checked = false;
      refreshPlan();
    });
    if (ce) ce.addEventListener("change", refreshPlan);
    var rf = $("#rank-tag-batch-refresh");
    if (rf) rf.addEventListener("click", loadTagBatches);
  });

  window.RankTagImport = { parseBook: parseBook, MAP: MAP, applyPlan: applyPlan, planRevert: planRevert, FIELDS: FIELDS };

  /* 后台榜单面板打开时才读批次，避免进后台就发请求 */
  window.RankTagBatches = { load: loadTagBatches };
})();
