/* ============================================================================
 * admin-plus.js —— 后台「大码专区数据」（20261026P）
 *
 * 两件事：
 *   ① 大码数据上传：独立入口，支持多 sheet（一个 sheet 一个类目）或表内「类目」列，
 *      大批量（分块 300 条写入 + 实时进度 + 失败清单）。
 *   ② 同款匹配作业台：把「标码（趋势上升榜）」与「大码」逐类目比一遍，
 *      产出 同款 / 待确认 / 大码机会 三档结论，待确认可人工判。
 *
 * 依赖：admin.js（sbToast / escHtml）、SB、SBP（plus-sb.js）、PLUSM（plus-match.js）、XLSX
 * 本文件所有 DOM 操作都限定在 #plus-card 内，避免与其它面板的选择器相撞。
 * ==========================================================================*/
(function () {
  "use strict";

  var box = null;
  var ST = {
    parsed: null,      // { sheets:[{name,rows:[]}], rows:[], failed:[], noUrl:0, dup:0 }
    busy: false,
    batches: [],
    review: [],        // 待确认清单当前页数据
    reviewFilter: "review",
    lastRun: null,
    file: null,        // 最近一次选中的文件（改类目时要重解析）
    cats: [],          // 类目候选（标签管理里的前台类目 + 已有大码类目）
  };

  function $(s) { return box ? box.querySelector(s) : null; }
  function $$(s) { return box ? Array.prototype.slice.call(box.querySelectorAll(s)) : []; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function toast(msg, ok) {
    if (typeof window.sbToast === "function") { window.sbToast(msg, ok !== false); return; }
    if (window.console) console.log(msg);
  }

  /* ---------------- 表头识别 ---------------- */
  function normHead(h) {
    return String(h == null ? "" : h).replace(/\s+/g, "").replace(/[（(].*?[)）]/g, "").toLowerCase();
  }
  function mapHeader(cells) {
    var hs = (cells || []).map(normHead);
    var find = function (t) { for (var i = 0; i < hs.length; i++) if (t(hs[i])) return i; return -1; };
    var url = find(function (h) { return h.indexOf("首图") >= 0 || h.indexOf("图片") >= 0 || h === "imgurl" || h === "cover"; });
    var title = find(function (h) { return h.indexOf("货品名称") >= 0 || h.indexOf("商品名称") >= 0 || h.indexOf("标题") >= 0 || h === "名称" || h.indexOf("品名") >= 0; });
    var ratio = find(function (h) { return h.indexOf("环比比例") >= 0 || (h.indexOf("比例") >= 0 && h.indexOf("绝对值") < 0); });
    var abs = find(function (h) { return h.indexOf("环比绝对值") >= 0 || (h.indexOf("绝对值") >= 0 && h.indexOf("比例") < 0); });
    var leaf = find(function (h) { return h.indexOf("叶子类目") >= 0; });
    var cat = find(function (h) { return h.indexOf("类目") >= 0 && h.indexOf("叶子") < 0; });
    var site = find(function (h) { return h.indexOf("站点") >= 0 || h === "国家" || h.indexOf("国家") === 0; });
    if (url < 0) return null;
    return { url: url, title: title, ratio: ratio, abs: abs, leaf: leaf, cat: cat, site: site };
  }
  function scoreHead(m) {
    if (!m) return 0;
    return (m.url >= 0 ? 2 : 0) + (m.title >= 0 ? 1 : 0) + (m.ratio >= 0 ? 1 : 0) + (m.abs >= 0 ? 1 : 0);
  }
  function pickHeaderRow(rows) {
    var best = null;
    for (var i = 0; i < Math.min(rows.length, 8); i++) {
      var m = mapHeader(rows[i] || []);
      if (!m) continue;
      var s = scoreHead(m);
      if (!best || s > best.score) best = { idx: i, map: m, score: s };
    }
    return best;
  }
  function toNum(v) {
    if (v == null) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var s = String(v).trim().replace(/,/g, "").replace(/%，?/g, "").replace(/%/g, "");
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }
  function toRatio(v) {
    var n = toNum(v);
    if (n === null) return null;
    var s = String(v);
    if (s.indexOf("%") < 0 && Math.abs(n) > 0 && Math.abs(n) < 1) return Math.round(n * 10000) / 100;
    return n;
  }
  /* 「首图URL」列常被做成超链接：显示文字是「查看首图」，真网址藏在链接里。
     只读显示文字会整列拿到同一个值，导入后全是重复。 */
  function pickUrl(cell) {
    if (!cell) return "";
    var t = "";
    if (cell.l) t = (typeof cell.l === "string") ? cell.l : (cell.l.Target || cell.l.target || "");
    else if (cell.hyperlink) t = String(cell.hyperlink);
    if (!t && cell.f) {
      var m = String(cell.f).match(/HYPERLINK\(\s*"([^"]+)"/i) || String(cell.f).match(/HYPERLINK\(\s*'([^']+)'/i);
      if (m) t = m[1];
    }
    t = String(t || "").trim();
    if (t && !/^(javascript|mailto|#)/i.test(t)) return t;
    var v = String(cell.w != null ? cell.w : (cell.v != null ? cell.v : "")).trim();
    return /^https?:\/\//i.test(v) ? v : "";
  }
  function readBuf(f) {
    if (f && typeof f.arrayBuffer === "function") return f.arrayBuffer();
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error("读取文件失败")); };
      fr.readAsArrayBuffer(f);
    });
  }

  /* ---------------- 类目设置 ---------------- */
  function catOpt() {
    var sel = $("#pl-cat");
    var modeEl = $$('input[name="pl-catmode"]').filter(function (r) { return r.checked; })[0];
    return { cat: sel ? String(sel.value || "").trim() : "", mode: (modeEl && modeEl.value) || "force" };
  }

  /* 类目候选：标签管理里的「前台类目」+ 大码库里已出现过的类目。
     走统一的 CAT_SEARCH：常用类目排前面并带 ★，下拉上方带搜索框（宽松匹配）。 */
  async function loadPlusCats() {
    var list = [];
    try { list = await SB.listActiveCats(); } catch (e) { list = []; }
    try {
      var f = await SBP.facets();
      (f.categories || []).forEach(function (c) { if (c && list.indexOf(c) < 0) list.push(c); });
    } catch (e) { /* 补丁没跑：只用标签管理里的类目 */ }
    ST.cats = list.filter(Boolean);
    var sel = $("#pl-cat");
    if (!sel) return;
    var keep = sel.value;
    var CATS = window.CAT_SEARCH;
    var favs = [];
    try { favs = await SB.myFavCats(); } catch (e) { favs = []; }
    var ordered = CATS ? CATS.sortCats(ST.cats, favs) : ST.cats.map(function (n) { return { name: n, fav: false }; });
    sel.innerHTML = '<option value="">不指定（按 sheet 名 / 类目列）</option>'
      + ordered.map(function (o) { return '<option value="' + esc(o.name) + '">' + (o.fav ? "★ " : "") + esc(o.name) + '</option>'; }).join("");
    if (keep && ST.cats.indexOf(keep) >= 0) sel.value = keep;
    if (CATS && typeof CATS.mountBox === "function") {
      CATS.mountBox(sel, "cat-search-plus", "搜索类目…", function (v) { CATS.kw("plus", v); CATS.filterSelect(sel, v); });
      CATS.filterSelect(sel, CATS.kw("plus"));
    }
  }

  /* ---------------- 解析整本工作簿（多 sheet = 多类目） ---------------- */
  /* opt: { cat: "裤装", mode: "force" | "fallback" }
     force    → 整表都归这个类目（一张表只装一个类目时最省事）
     fallback → 只补那些「表内类目列」和「sheet 名」都拿不到类目的行 */
  function parseBook(file, opt) {
    opt = opt || {};
    var picked = String(opt.cat || "").trim();
    var force = !!picked && opt.mode !== "fallback";
    return readBuf(file).then(function (buf) {
      var wb = XLSX.read(buf, { type: "array" });
      var all = [], failed = [], noUrl = 0, sheetsMeta = [];
      wb.SheetNames.forEach(function (name) {
        var ws = wb.Sheets[name];
        if (!ws || !ws["!ref"]) { failed.push({ name: name, why: "空表" }); return; }
        var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        var head = pickHeaderRow(aoa);
        if (!head) { failed.push({ name: name, why: "没找到「首图url」列" }); return; }
        var rng = XLSX.utils.decode_range(ws["!ref"]);
        var rows = [];
        for (var i = head.idx + 1; i < aoa.length; i++) {
          var c = aoa[i] || [];
          var cell = null;
          try { cell = ws[XLSX.utils.encode_cell({ r: rng.s.r + i, c: rng.s.c + head.map.url })]; } catch (e) { cell = null; }
          var url = pickUrl(cell);
          if (!url) { noUrl++; continue; }
          var sheetCat = String(name || "").trim();
          var rowCat = head.map.cat >= 0 ? String(c[head.map.cat] || "").trim() : "";
          var finalCat = force ? picked : (rowCat || sheetCat || picked || "");
          rows.push({
            category: finalCat,
            site: head.map.site >= 0 ? String(c[head.map.site] || "").trim() : "",
            leaf_category: head.map.leaf >= 0 ? String(c[head.map.leaf] || "").trim() : "",
            title: head.map.title >= 0 ? String(c[head.map.title] || "").trim() : "",
            image_url: url,
            ratio: head.map.ratio >= 0 ? toRatio(c[head.map.ratio]) : null,
            abs_delta: head.map.abs >= 0 ? toNum(c[head.map.abs]) : null,
          });
        }
        sheetsMeta.push({ name: sheetCat, rows: rows.length });
        rows.forEach(function (r) { all.push(r); });
      });

      /* 文件内去重：同一个「类目 + 站点 + 图」只留一条（保留环比更强的） */
      var seen = {}, out = [], dup = 0;
      all.forEach(function (r) {
        var k = r.category + "\u0000" + r.site + "\u0000" + r.image_url;
        var prev = seen[k];
        if (!prev) { seen[k] = r; out.push(r); return; }
        dup++;
        var a = prev.ratio, b = r.ratio;
        if ((b != null && a == null) || (b != null && a != null && b > a)) seen[k].ratio = b;
      });
      /* 本次上传内的环比名次（每个类目各自排名） */
      var byCat = {};
      out.forEach(function (r) { (byCat[r.category] = byCat[r.category] || []).push(r); });
      Object.keys(byCat).forEach(function (cat) {
        byCat[cat].filter(function (r) { return r.ratio != null; })
          .sort(function (a, b) { return b.ratio - a.ratio; })
          .forEach(function (r, i) { r.rank_ratio = i + 1; });
      });
      return { rows: out, sheets: sheetsMeta, failed: failed, noUrl: noUrl, dup: dup };
    });
  }

  function renderPreview() {
    var tip = $("#pl-file-tip"), pv = $("#pl-preview");
    if (!tip || !pv) return;
    var st = ST.parsed;
    if (!st) { pv.innerHTML = ""; tip.textContent = ""; return; }
    var co = catOpt();
    tip.textContent = "✅ 共 " + st.rows.length + " 条有效数据 · " + st.sheets.length + " 个 sheet"
      + (co.cat ? (co.mode === "fallback" ? " · 识别不出类目的行归到「" + co.cat + "」" : " · 整表归入「" + co.cat + "」") : "");
    var byCat = {};
    st.rows.forEach(function (r) { byCat[r.category] = (byCat[r.category] || 0) + 1; });
    var catRows = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; })
      .map(function (c) { return '<span class="pl-chip">' + esc(c || "（未命名）") + ' <b>' + byCat[c] + '</b></span>'; })
      .join("");
    pv.innerHTML =
      '<div class="pl-kv"><span>有效行 <b>' + st.rows.length + '</b></span>'
      + '<span>缺图跳过 <b>' + st.noUrl + '</b></span>'
      + '<span>表内重复合并 <b>' + st.dup + '</b></span></div>'
      + '<div class="pl-chips">' + (catRows || '<span class="pl-chip">无</span>') + '</div>'
      + (st.failed.length ? '<div class="pl-warn">以下 sheet 没读到数据：'
        + st.failed.map(function (f) { return esc(f.name) + "（" + esc(f.why) + "）"; }).join("、") + '</div>' : '');
    var btn = $("#pl-import");
    if (btn) btn.disabled = st.rows.length === 0 || ST.busy;
  }

  /* ---------------- 进度条 ---------------- */
  function progress(pct, text) {
    var wrap = $("#pl-progress");
    if (!wrap) return;
    wrap.classList.remove("hidden");
    var bar = wrap.querySelector(".pl-prog-bar");
    if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
    var lab = wrap.querySelector(".pl-prog-txt");
    if (lab) lab.textContent = text || "";
  }
  function progressHide() {
    var wrap = $("#pl-progress");
    if (wrap) wrap.classList.add("hidden");
  }

  /* ---------------- 导入 ---------------- */
  async function doImport() {
    if (ST.busy) { toast("正在处理，请稍候", false); return; }
    var st = ST.parsed;
    if (!st || !st.rows.length) { toast("请先选择并解析 Excel", false); return; }
    var periodType = ($$('input[name="pl-period"]').filter(function (r) { return r.checked; })[0] || {}).value || "week";
    var periodLabel = ($("#pl-period-label").value || "").trim();
    if (!periodLabel) { toast(periodType === "month" ? "请先选月份" : "请先选某一周", false); return; }
    var note = ($("#pl-note").value || "").trim();
    var co = catOpt();
    if (co.cat) {
      st.rows.forEach(function (r) {
        if (co.mode !== "fallback" || !r.category) r.category = co.cat;
      });
    }
    var mode = ($$('input[name="pl-mode"]').filter(function (r) { return r.checked; })[0] || {}).value === "append" ? "append" : "replace";
    var cats = Object.keys(st.rows.reduce(function (m, r) { if (r.category) m[r.category] = 1; return m; }, {}));

    ST.busy = true;
    var btn = $("#pl-import");
    if (btn) { btn.disabled = true; btn.textContent = "导入中…"; }
    var failedRows = [];
    try {
      progress(3, "准备中…");
      var cleared = 0;
      var list = st.rows;
      if (mode === "replace") {
        cleared = await SBP.clearSlot({ periodLabel: periodLabel, categories: cats });
        try { await SBP.clearMatches({ periodLabel: periodLabel }); } catch (e) { /* 结论随数据作废，失败不影响导入 */ }
      } else {
        var exist = await SBP.listSlotUrls({ periodLabel: periodLabel, categories: cats });
        var has = {};
        exist.forEach(function (u) { has[u] = 1; });
        list = st.rows.filter(function (r) { return !has[r.image_url]; });
      }
      progress(12, "写入批次…");
      var batchId = await SBP.createBatch({ periodType: periodType, periodLabel: periodLabel, note: note });
      var payload = list.map(function (r) {
        return {
          batch_id: batchId, period_type: periodType, period_label: periodLabel,
          category: r.category || "", site: r.site || "", leaf_category: r.leaf_category || "",
          title: r.title || "", image_url: r.image_url,
          ratio: r.ratio, abs_delta: r.abs_delta, rank_ratio: r.rank_ratio || null,
        };
      });
      progress(18, "写入 0 / " + payload.length + " 条…");
      var inserted = 0;
      try {
        inserted = await SBP.insertItems(payload, function (done, total) {
          var pct = 18 + (total ? (done / total) * 78 : 78);
          progress(pct, "写入 " + done + " / " + total + " 条…");
        });
      } catch (e) {
        /* 中途失败：已写入的保留，把没进去的记成失败清单，让用户只补那部分 */
        failedRows = payload.slice(inserted);
        throw e;
      }
      try { await SBP.updateBatch(batchId, { rows: inserted, skipped: (st.rows.length - list.length) + st.dup }); } catch (e) { /* 统计失败不影响数据 */ }
      progress(100, "完成");
      toast("导入完成：写入 " + inserted + " 条"
        + (cleared ? "（已覆盖旧数据 " + cleared + " 条）" : "")
        + (st.rows.length - list.length ? "（库里已有 " + (st.rows.length - list.length) + " 条未重复写入）" : "")
        + (st.dup ? "（表内重复合并 " + st.dup + " 条）" : ""), true);
      ST.parsed = null;
      if ($("#pl-file")) $("#pl-file").value = "";
      renderPreview();
      await loadBatches();
      await refreshFacets();
    } catch (e) {
      progress(100, "失败");
      toast("导入失败：" + ((e && e.message) || "请重试"), false);
      if (failedRows.length) offerFailed(failedRows);
    } finally {
      ST.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = "导入大码数据"; }
      setTimeout(progressHide, 1200);
    }
  }
  /* 失败清单：只在真的失败时生成，供用户只补没进去的那部分 */
  function offerFailed(rows) {
    var panel = $("#pl-failed");
    if (!panel) return;
    panel.classList.remove("hidden");
    panel.innerHTML = '<div class="pl-warn">有 ' + rows.length + ' 条没写进去（已写入的保留）。'
      + '<button type="button" class="btn-ghost small" id="pl-failed-dl">下载失败清单</button></div>';
    var b = $("#pl-failed-dl");
    if (b) b.onclick = function () {
      var csv = "类目,站点,标题,首图url\n" + rows.map(function (r) {
        return [r.category, r.site, r.title, r.image_url].map(function (v) {
          return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
        }).join(",");
      }).join("\n");
      var a = document.createElement("a");
      a.href = "data:text/csv;charset=utf-8," + encodeURIComponent("\ufeff" + csv);
      a.download = "大码导入失败清单.csv";
      a.click();
    };
  }

  /* ---------------- 期次选择器 ---------------- */
  function isoWeekLabel(dstr) {
    var d = new Date(String(dstr || "") + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var y = t.getUTCFullYear();
    var yStart = new Date(Date.UTC(y, 0, 1));
    var wk = Math.ceil(((t - yStart) / 86400000 + 1) / 7);
    return (y === new Date().getFullYear() ? "" : y + "-") + "W" + wk;
  }
  function syncLabel() {
    var lab = $("#pl-period-label");
    if (!lab) return "";
    var isWeek = (($$('input[name="pl-period"]').filter(function (r) { return r.checked; })[0] || {}).value || "week") === "week";
    var wk = $("#pl-pw-wrap"), mo = $("#pl-pm-wrap");
    if (wk) wk.style.display = isWeek ? "" : "none";
    if (mo) mo.style.display = isWeek ? "none" : "";
    if (isWeek) {
      var dv = $("#pl-period-date") ? $("#pl-period-date").value : "";
      lab.value = dv ? isoWeekLabel(dv) : "";
      var out = $("#pl-period-week");
      if (out) out.textContent = lab.value || "—";
    } else {
      lab.value = ($("#pl-period-month") && $("#pl-period-month").value) || "";
    }
    return lab.value;
  }

  /* ---------------- 批次列表 ---------------- */
  async function loadBatches() {
    var list = $("#pl-batches");
    if (!list) return;
    try {
      ST.batches = await SBP.listBatches();
    } catch (e) {
      list.innerHTML = '<div class="pl-warn">' + esc((e && e.message) || "读取失败") + '</div>';
      return;
    }
    if (!ST.batches.length) { list.innerHTML = '<div class="hint">还没有上传过任何大码数据。</div>'; return; }
    list.innerHTML = ST.batches.map(function (b) {
      var d = String(b.created_at || "").replace("T", " ").slice(0, 16);
      return '<div class="pl-batch" data-id="' + b.id + '">'
        + '<span class="pl-batch-p">' + esc(b.period_label) + '</span>'
        + '<span class="pl-batch-n">' + (b.rows || 0) + ' 条</span>'
        + '<span class="pl-batch-t">' + esc(d) + (b.note ? " · " + esc(b.note) : "") + '</span>'
        + '<button type="button" class="btn-ghost small pl-batch-del" data-id="' + b.id + '">删除</button>'
        + '</div>';
    }).join("");
    $$(".pl-batch-del").forEach(function (b) {
      b.onclick = async function () {
        if (!window.confirm("删除这次上传的全部数据？此操作不可撤销。")) return;
        b.disabled = true;
        try { await SBP.deleteBatch(b.getAttribute("data-id")); toast("已删除", true); await loadBatches(); await refreshFacets(); }
        catch (e) { toast((e && e.message) || "删除失败", false); b.disabled = false; }
      };
    });
    fillPeriodSelects();
  }

  function fillPeriodSelects() {
    var plus = $("#pl-match-period"), std = $("#pl-match-std"), cat = $("#pl-match-cat");
    if (!plus) return;
    var periods = {};
    ST.batches.forEach(function (b) { if (b.period_label) periods[b.period_label] = 1; });
    var arr = Object.keys(periods).sort().reverse();
    var cur = plus.value;
    plus.innerHTML = arr.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join("")
      || '<option value="">（暂无大码期次）</option>';
    if (cur && arr.indexOf(cur) >= 0) plus.value = cur;
    if (std) {
      var prevStd = std.value;
      std.innerHTML = '<option value="__same__">与上面同期次</option>' + arr.map(function (p) {
        return '<option value="' + esc(p) + '">' + esc(p) + '</option>';
      }).join("");
      if (prevStd) std.value = prevStd;
    }
    if (cat) {
      SBP.facets().then(function (f) {
        var prev = cat.value;
        var CATS = window.CAT_SEARCH, favs = [];
        SB.myFavCats().then(function (v) { favs = v || []; }).catch(function () { favs = []; }).then(function () {
          var names = (f.categories || []).slice();
          var ordered = CATS ? CATS.sortCats(names, favs) : names.map(function (n) { return { name: n, fav: false }; });
          cat.innerHTML = '<option value="">全部类目</option>' + ordered.map(function (o) {
            return '<option value="' + esc(o.name) + '">' + (o.fav ? "★ " : "") + esc(o.name) + '</option>';
          }).join("");
          if (prev) cat.value = prev;
          /* 类目多时要能搜；搜索只隐藏不匹配项，不动已选值 */
          if (CATS && typeof CATS.mountBox === "function") {
            CATS.mountBox(cat, "cat-search-plus-match", "搜索类目…", function (v) { CATS.kw("plusm", v); CATS.filterSelect(cat, v); });
            CATS.filterSelect(cat, CATS.kw("plusm"));
          }
        });
      }).catch(function () { /* 忽略 */ });
    }
  }

  async function refreshFacets() {
    try {
      var f = await SBP.facets();
      var hint = $("#pl-facets");
      if (hint) {
        hint.textContent = f.categories.length
          ? "大码现有 " + f.categories.length + " 个类目 / " + f.periods.length + " 个期次：" + f.categories.join("、")
          : "还没有大码数据";
      }
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 匹配：取图算特征 ---------------- */
  function hashAll(urls, onStep) {
    var uniq = Object.keys(urls.reduce(function (m, u) { if (u) m[u] = 1; return m; }, {}));
    var out = {}, done = 0, failed = 0, i = 0;
    function next() {
      if (i >= uniq.length) return Promise.resolve({ feats: out, failed: failed });
      var u = uniq[i++];
      return PLUSM.hashUrl(u, { timeout: 12000 })
        .then(function (f) { out[u] = f; })
        .catch(function () { failed++; })
        .then(function () {
          done++;
          if (onStep) onStep(done, uniq.length);
          return next();
        });
    }
    /* 并发 4：图片站限流时不至于被整批打回 */
    return Promise.all([next(), next(), next(), next()]).then(function () {
      return { feats: out, failed: failed };
    });
  }

  function scorePair(a, b, va, vb) {
    var img = (a.feat && b.feat) ? PLUSM.imgSim(a.feat, b.feat) : null;
    var txt = PLUSM.textSim(a.title, b.title);
    var sem = (va && vb) ? PLUSM.semSim(va, vb) : null;
    var total = PLUSM.combine({ img: img, txt: txt, sem: sem });
    return { total: total, img: img, txt: txt, sem: sem };
  }

  async function runMatch() {
    if (ST.busy) { toast("正在处理，请稍候", false); return; }
    var plusPeriod = ($("#pl-match-period") && $("#pl-match-period").value) || "";
    if (!plusPeriod) { toast("请先选择大码期次", false); return; }
    var stdSel = ($("#pl-match-std") && $("#pl-match-std").value) || "__same__";
    var stdPeriod = stdSel === "__same__" ? plusPeriod : stdSel;
    var onlyCat = ($("#pl-match-cat") && $("#pl-match-cat").value) || "";
    if (!window.SB || !window.PLUSM) { toast("匹配引擎未就绪，请刷新页面", false); return; }

    ST.busy = true;
    var btn = $("#pl-run-match");
    if (btn) { btn.disabled = true; btn.textContent = "匹配中…"; }
    try {
      var facets = await SBP.facets();
      var cats = onlyCat ? [onlyCat] : (facets.categories || []);
      var totalCats = cats.length, idx = 0;
      var sum = { same: 0, review: 0, gap: 0, manual: 0, cats: 0 };
      var semEp = PLUSM.semEndpoint();

      for (idx = 0; idx < cats.length; idx++) {
        var cat = cats[idx];
        progress((idx / Math.max(1, totalCats)) * 100, "匹配 " + cat + "（" + (idx + 1) + "/" + totalCats + "）");
        var plusItems = await SBP.listItems({ periodLabel: plusPeriod, category: cat });
        if (!plusItems.length) continue;
        var stdItems = [];
        try { stdItems = await window.SB.listRankItems({ periods: [stdPeriod], category: cat }); }
        catch (e) { stdItems = []; }
        /* 标码：同一张图只留一条（多站点会出现同图多条） */
        var byUrl = {};
        stdItems.forEach(function (it) { if (it.image_url && !byUrl[it.image_url]) byUrl[it.image_url] = it; });
        var stdList = Object.keys(byUrl).map(function (u) { return byUrl[u]; });
        if (!stdList.length) continue;

        /* 语义向量（可选）：配了接口就一起算 */
        var vecPlus = {}, vecStd = {};
        if (semEp) {
          try {
            vecPlus = await PLUSM.embed(plusItems.map(function (r) { return r.image_url; }), semEp);
            vecStd = await PLUSM.embed(stdList.map(function (r) { return r.image_url; }), semEp);
          } catch (e) { vecPlus = {}; vecStd = {}; }
        }

        var hs1 = await hashAll(plusItems.map(function (r) { return r.image_url; }), function (d, t) {
          progress((idx / Math.max(1, totalCats)) * 100 + (d / Math.max(1, t)) * (100 / Math.max(1, totalCats)) * 0.5, "计算图片指纹 " + d + "/" + t + "（" + cat + "）");
        });
        var hs2 = await hashAll(stdList.map(function (r) { return r.image_url; }), function (d, t) {
          progress((idx / Math.max(1, totalCats)) * 100 + (100 / Math.max(1, totalCats)) * 0.5 + (d / Math.max(1, t)) * (100 / Math.max(1, totalCats)) * 0.4, "计算图片指纹 " + d + "/" + t + "（" + cat + "）");
        });

        var P = plusItems.map(function (r) {
          return { image_url: r.image_url, title: r.title || "", feat: hs1.feats[r.image_url] || null, vec: vecPlus[r.image_url] || null };
        });
        var S = stdList.map(function (r) {
          return { image_url: r.image_url, title: r.title || r.leaf_category || "", site: r.site || "", feat: hs2.feats[r.image_url] || null, vec: vecStd[r.image_url] || null };
        });

        /* 按站点分组：同一张标码图在不同站点是不同行，结论各自独立 */
        var sites = {};
        S.forEach(function (s) { (sites[s.site] = sites[s.site] || []).push(s); });
        var prevRows = [];
        try { prevRows = await SBP.listMatches({ periodLabel: plusPeriod, category: cat }); } catch (e) { prevRows = []; }

        var fresh = [];
        Object.keys(sites).forEach(function (site) {
          var group = sites[site];
          /* 先全量打分（同时记下每个标码款的最佳候选，供"未分配"时展示对照图） */
          var best = {};
          group.forEach(function (s) {
            P.forEach(function (p) {
              var sc = scorePair(s, p, s.vec, p.vec);
              var cur = best[s.image_url];
              if (!cur || sc.total > cur.total) best[s.image_url] = { plus: p, sc: sc };
            });
          });
          /* 一对一分配：一个标码款只认领一个大码款，反之亦然，
             避免一个爆款把相似款全"吃掉"，把本该是机会的款误判成已有。 */
          var pairs = PLUSM.assign(group, P, function (a, b) {
            return scorePair(a, b, a.vec, b.vec).total;
          });
          var pairByStd = {};
          pairs.forEach(function (pair) {
            var s = group[pair.i], p = P[pair.j];
            pairByStd[s.image_url] = { plus: p, sc: scorePair(s, p, s.vec, p.vec) };
          });

          group.forEach(function (s) {
            var hit = pairByStd[s.image_url];
            var sc = hit ? hit.sc : (best[s.image_url] || {}).sc;
            var score = sc ? sc.total : null;
            var decision = score == null ? "gap" : PLUSM.verdict(score);
            fresh.push({
              period_label: plusPeriod,
              category: cat,
              site: site || "",
              std_image_url: s.image_url,
              plus_image_url: (hit && decision !== "gap") ? hit.plus.image_url : "",
              score: score,
              score_img: sc ? sc.img : null,
              score_txt: sc ? sc.txt : null,
              score_sem: sc ? sc.sem : null,
              method: "auto",
              decision: decision,
            });
          });
        });

        /* 人工结论优先：上次是 manual 判的，这次原样保留 */
        var merged = PLUSM.mergeManual(fresh, prevRows);
        merged.forEach(function (r) {
          if (r.method === "manual") sum.manual++;
          if (r.decision === "same") sum.same++;
          else if (r.decision === "review") sum.review++;
          else sum.gap++;
        });
        await SBP.upsertMatches(merged);
        sum.cats++;
      }
      progress(100, "完成");
      ST.lastRun = { plusPeriod: plusPeriod, stdPeriod: stdPeriod, sum: sum, sem: !!semEp };
      var out = $("#pl-match-result");
      if (out) {
        out.innerHTML = '<div class="pl-kv">'
          + '<span>已比类目 <b>' + sum.cats + '</b></span>'
          + '<span>同款 <b class="ok">' + sum.same + '</b></span>'
          + '<span>待确认 <b class="warn">' + sum.review + '</b></span>'
          + '<span>大码机会 <b class="gap">' + sum.gap + '</b></span>'
          + '<span>人工已判 <b>' + sum.manual + '</b></span>'
          + '</div>'
          + '<div class="hint">大码期次 ' + esc(plusPeriod) + ' ↔ 标码期次 ' + esc(stdPeriod)
          + '；语义向量通道' + (semEp ? "已启用" : "未配置（按图片 + 标题判定）") + '</div>';
      }
      toast("匹配完成：同款 " + sum.same + " / 待确认 " + sum.review + " / 大码机会 " + sum.gap, true);
      await loadReview();
    } catch (e) {
      toast("匹配失败：" + ((e && e.message) || "请重试"), false);
    } finally {
      ST.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = "开始匹配"; }
      setTimeout(progressHide, 1000);
    }
  }

  /* ---------------- 待确认清单 ---------------- */
  async function loadReview() {
    var panel = $("#pl-review");
    if (!panel) return;
    var plusPeriod = ($("#pl-match-period") && $("#pl-match-period").value) || "";
    if (!plusPeriod) { panel.innerHTML = '<div class="hint">先选大码期次</div>'; return; }
    var cat = ($("#pl-match-cat") && $("#pl-match-cat").value) || "";
    panel.innerHTML = '<div class="hint">读取中…</div>';
    var rows = [];
    try { rows = await SBP.listMatches({ periodLabel: plusPeriod, category: cat }); }
    catch (e) { panel.innerHTML = '<div class="pl-warn">' + esc((e && e.message) || "读取失败") + '</div>'; return; }
    var f = ST.reviewFilter;
    var list = rows.filter(function (r) {
      if (f === "all") return true;
      if (f === "review") return r.decision === "review";
      if (f === "gap") return r.decision === "gap";
      if (f === "same") return r.decision === "same";
      return true;
    });
    var CAP = 120;
    var shown = list.slice(0, CAP);
    if (!rows.length) { panel.innerHTML = '<div class="hint">还没有匹配结论，先点上面的「开始匹配」。</div>'; return; }
    panel.innerHTML =
      '<div class="pl-review-bar">共 ' + rows.length + ' 条结论，当前筛选 <b>' + list.length + '</b> 条'
      + (list.length > CAP ? '（只显示前 ' + CAP + ' 条，可用筛选缩小范围）' : '') + '</div>'
      + '<div class="pl-review-grid">' + shown.map(function (r, i) {
        var d = r.decision;
        var tag = d === "same" ? "同款" : (d === "review" ? "待确认" : "大码机会");
        var score = (r.score == null) ? "—" : Math.round(Number(r.score) * 100) + "%";
        return '<div class="pl-rv" data-url="' + esc(r.std_image_url) + '" data-plus="' + esc(r.plus_image_url || "") + '">'
          + '<div class="pl-rv-pair">'
          +   '<div class="pl-rv-cell"><div class="pl-rv-t">标码</div><img loading="lazy" src="' + esc(r.std_image_url) + '" alt=""></div>'
          +   '<div class="pl-rv-cell"><div class="pl-rv-t">大码</div>'
          +     (r.plus_image_url ? '<img loading="lazy" src="' + esc(r.plus_image_url) + '" alt="">' : '<div class="pl-rv-none">未找到</div>')
          +   '</div>'
          + '</div>'
          + '<div class="pl-rv-meta"><span class="pl-tag ' + d + '">' + tag + '</span>'
          +   '<span class="pl-score">' + score + '</span>'
          +   (r.method === "manual" ? '<span class="pl-manual">人工</span>' : '')
          + '</div>'
          + '<div class="pl-rv-acts">'
          +   '<button type="button" class="btn-ghost small pl-j" data-d="same" data-i="' + i + '">同款</button>'
          +   '<button type="button" class="btn-ghost small pl-j" data-d="gap" data-i="' + i + '">不是同款</button>'
          + '</div>'
          + '</div>';
      }).join("") + '</div>';

    $$(".pl-j").forEach(function (b) {
      b.onclick = async function () {
        var i = Number(b.getAttribute("data-i"));
        var r = shown[i];
        if (!r) return;
        var d = b.getAttribute("data-d");
        b.disabled = true;
        try {
          await SBP.setDecision({
            periodLabel: plusPeriod, category: r.category, site: r.site || "",
            stdImageUrl: r.std_image_url,
            plusImageUrl: d === "same" ? (r.plus_image_url || "") : "",
            score: r.score, decision: d,
          });
          r.decision = d; r.method = "manual";
          toast(d === "same" ? "已判为同款" : "已判为大码机会", true);
          await loadReview();
        } catch (e) {
          toast((e && e.message) || "保存失败", false);
          b.disabled = false;
        }
      };
    });
  }

  /* 用当前类目设置重新解析同一个文件（改类目时调用，避免让用户重新选文件） */
  async function reparse() {
    if (!ST.file) return;
    var tip = $("#pl-file-tip");
    if (tip) tip.textContent = "正在解析 " + (ST.file.name || "文件") + " …";
    try {
      ST.parsed = await parseBook(ST.file, catOpt());
      renderPreview();
    } catch (e) {
      ST.parsed = null;
      if (tip) tip.textContent = "❌ 解析失败：请确认是有效的 Excel（.xlsx / .xls）";
      renderPreview();
    }
  }

  /* ---------------- 绑定 ---------------- */
  function bind() {
    var f = $("#pl-file");
    if (f) f.onchange = async function () {
      var file = f.files && f.files[0];
      ST.file = file || null;
      ST.parsed = null; renderPreview();
      if (!file) return;
      await reparse();
    };
    /* 换类目 / 换用法：重新解析一遍，让预览里的类目计数立刻跟着变（不重新选文件） */
    var pcat = $("#pl-cat");
    if (pcat) pcat.onchange = function () { if (ST.file) reparse(); };
    $$('input[name="pl-catmode"]').forEach(function (r) { r.onchange = function () { if (ST.file) reparse(); }; });
    var pcatAdd = $("#pl-cat-add");
    if (pcatAdd) pcatAdd.onclick = async function () {
      var v = (window.prompt("输入新类目名称（会同步到「标签管理 → 前台类目」）：") || "").trim();
      if (!v) return;
      try {
        await SB.addCategory(v);
        await loadPlusCats();
        var sel = $("#pl-cat");
        if (sel) sel.value = v;
        if (ST.file) reparse();
        toast("已新增类目「" + v + "」", true);
      } catch (e) { toast((e && e.message) || "新增类目失败", false); }
    };
    var imp = $("#pl-import");
    if (imp) imp.onclick = doImport;
    $$('input[name="pl-period"]').forEach(function (r) { r.onchange = syncLabel; });
    ["#pl-period-date", "#pl-period-month"].forEach(function (s) {
      var el = $(s); if (el) el.onchange = syncLabel;
    });
    var run = $("#pl-run-match");
    if (run) run.onclick = runMatch;
    var rl = $("#pl-review-load");
    if (rl) rl.onclick = loadReview;
    $$(".pl-rv-filter").forEach(function (b) {
      b.onclick = function () {
        ST.reviewFilter = b.getAttribute("data-f");
        $$(".pl-rv-filter").forEach(function (x) { x.classList.toggle("on", x === b); });
        loadReview();
      };
    });
    var reset = $("#pl-match-reset");
    if (reset) reset.onclick = async function () {
      var p = ($("#pl-match-period") && $("#pl-match-period").value) || "";
      var c = ($("#pl-match-cat") && $("#pl-match-cat").value) || "";
      if (!p) return;
      if (!window.confirm("清空该期次" + (c ? "该类目" : "全部类目") + "的匹配结论？人工判定也会一起清掉。")) return;
      try { await SBP.clearMatches({ periodLabel: p, category: c }); toast("已清空结论", true); await loadReview(); }
      catch (e) { toast((e && e.message) || "清空失败", false); }
    };
  }

  async function init() {
    box = document.getElementById("plus-card");
    if (!box) return;                        // 不是后台页 / 没有这个面板
    var openFront = document.getElementById("rkadm-plus-open-front");
    if (openFront) openFront.onclick = function () { window.open("plus.html", "_blank"); };
    var now = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var iso = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    var dEl = $("#pl-period-date"), mEl = $("#pl-period-month");
    if (dEl && !dEl.value) dEl.value = iso;
    if (mEl && !mEl.value) mEl.value = iso.slice(0, 7);
    syncLabel();
    bind();
    await loadPlusCats();
    await loadBatches();
    await refreshFacets();
    await loadReview();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else setTimeout(init, 0);

  /* 切到该面板时由 admin.js 调用：重新读一遍批次与结论（别处可能刚改过） */
  window.PLUSADMIN = {
    refresh: function () {
      if (!document.getElementById("plus-card")) return;
      loadBatches();
      refreshFacets();
      loadReview();
      loadPlusCats();
    },
  };
})();