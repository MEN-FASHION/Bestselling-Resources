/* ============================================================================
 * admin-titlelab.js —— 后台「标题组词台」独立上传面板
 *
 * 20261113C 新增。背景：三个专区（趋势上升榜 / 上新节奏 / 标题组词台）的数据已经分域隔离，
 * 但后台上传入口挤在一起（趋势上升榜的导入区里挂了个「数据域」下拉），
 * 导错一次就把另一个专区的数据弄脏 —— 用户的要求是「后台传数据也要隔离」。
 *
 * 本面板只做一件事：把表格写进 source = "title" 这一份数据，并管好它自己的台账。
 *   · 写入 / 清空 / 查重 / 撤销 全部带 source = "title"，绝不动趋势上升榜与上新节奏
 *   · 台账、类目清理、期次归并、数据自检 也只读 / 只改本域
 *   · 表头识别、分组、标签计算复用 admin-rank.js 暴露的 window.RankParse，不另写一套
 * 依赖：admin.js（sbToast / escHtml / escAttr / uiConfirm / uiPrompt）、supabase.js、vendor/xlsx
 * ==========================================================================*/
{
  const SOURCE = "title";
  const PTYPE = "week";          // 组词台按周统计标题用词
  const CONC = 4;                // 同时写入的组数
  const GROUP_TIMEOUT_MS = 90000;

  const $ = (s) => document.querySelector(s);
  const P = () => (window.RankParse || null);

  /* 站点名归一：交给公共模块，认不出时原样返回 */
  function siteNormResolve(v, list) {
    if (typeof window !== "undefined" && window.SiteNorm) return window.SiteNorm.resolve(v, list);
    return String(v == null ? "" : v).trim();
  }
  let tiParsed = null;           // { rows:[], fileName, missing:[], urlWarn, siteWarn, dupUrls }
  let tiPeriods = [];            // 本域期次清单
  let tiCats = [];
  let tiSites = [];
  let tiUndo = null;             // { at, groups:[{period,category,sites}], backup:[...] }

  /* ---------- 站点 / 类目 ---------- */
  async function loadTiSites() {
    try { tiSites = await SB.listRankSites(); } catch (e) { tiSites = []; }
    const box = $("#ti-site-defaults");
    if (!box) return;
    box.innerHTML = "";
    if (!tiSites.length) { box.innerHTML = '<span class="hint">（还没有站点，请先到「趋势上升榜 / 上新节奏」面板添加国家站点）</span>'; return; }
    tiSites.forEach((s) => {
      const l = document.createElement("label");
      l.className = "chk";
      l.innerHTML = '<input type="checkbox" value="' + escAttr(s.name) + '"> ' + escHtml(s.name);
      const cb = l.querySelector("input");
      if (cb) cb.addEventListener("change", () => { if (tiParsed) renderTiPreview(); });
      box.appendChild(l);
    });
  }

  async function loadTiCats() {
    try { tiCats = await SB.listActiveCats(); } catch (e) { tiCats = []; }
    const sel = $("#ti-cat");
    if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = '<option value="">请选择类目…</option>'
      + tiCats.map((n) => '<option value="' + escAttr(n) + '">' + escHtml(n) + '</option>').join("");
    if (keep && tiCats.indexOf(keep) >= 0) sel.value = keep;
  }

  /* ---------- 期次（日历 → 第N周） ---------- */
  function isoWeekLabel(dstr) {
    const d = new Date(String(dstr || "") + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = t.getUTCFullYear();
    const yStart = new Date(Date.UTC(y, 0, 1));
    const wk = Math.ceil(((t - yStart) / 86400000 + 1) / 7);
    const nowY = new Date().getFullYear();
    return (y === nowY ? "" : y + "-") + "W" + wk;
  }
  function syncTiPeriod() {
    const lab = $("#ti-period-label");
    const dv = $("#ti-period-date") ? $("#ti-period-date").value : "";
    const w = dv ? isoWeekLabel(dv) : "";
    if (lab) lab.value = w || "";
    const out = $("#ti-period-week");
    if (out) out.textContent = w || "—";
    if (tiParsed) renderTiPreview();
    return w;
  }

  /* ---------- 解析文件 ---------- */
  function readFileBuf(f) {
    if (f && typeof f.arrayBuffer === "function") return f.arrayBuffer();
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error("读取文件失败"));
      fr.readAsArrayBuffer(f);
    });
  }

  async function onTiFileChange() {
    tiParsed = null;
    const tip = $("#ti-file-tip");
    const box = $("#ti-preview");
    const btn = $("#ti-import");
    if (box) box.innerHTML = "";
    if (btn) btn.disabled = true;
    const api = P();
    if (!api) { if (tip) tip.textContent = "❌ 解析组件未就绪，请刷新页面后重试"; return; }
    const f = $("#ti-file") && $("#ti-file").files && $("#ti-file").files[0];
    if (!f) { if (tip) tip.textContent = ""; return; }
    if (tip) tip.textContent = "正在解析 " + f.name + " …";
    try {
      const buf = await readFileBuf(f);
      const wb = XLSX.read(buf, { type: "array" });
      const rows = [];
      let noLink = 0, firstHead = null, usedSheets = [];
      for (const sn of wb.SheetNames) {
        const ws = wb.Sheets[sn];
        if (!ws || !ws["!ref"]) continue;
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        const head = api.pickHeaderRow(aoa);
        if (!head) continue;
        usedSheets.push(sn);
        if (!firstHead) firstHead = aoa[head.idx] || [];
        const rng = XLSX.utils.decode_range(ws["!ref"] || "A1");
        for (let i = head.idx + 1; i < aoa.length; i++) {
          const c = aoa[i] || [];
          const ci = head.map.url;
          let url = "";
          if (ci >= 0) {
            const cell = ws[XLSX.utils.encode_cell({ r: rng.s.r + i, c: rng.s.c + ci })];
            url = api.pickUrlFromCell(cell);
          }
          if (!url) { noLink++; continue; }
          rows.push({
            title: String(head.map.title >= 0 ? (c[head.map.title] || "") : "").trim(),
            period: String(head.map.period >= 0 ? (c[head.map.period] || "") : "").trim(),
            leaf_category: String(head.map.leaf >= 0 ? (c[head.map.leaf] || "") : "").trim(),
            site: String(head.map.site >= 0 ? (c[head.map.site] || "") : "").trim(),
            image_url: url,
            abs_delta: api.toNum(head.map.abs >= 0 ? c[head.map.abs] : null),
            ratio: api.toRatio(head.map.ratio >= 0 ? c[head.map.ratio] : null),
          });
        }
      }
      if (!usedSheets.length) {
        if (tip) tip.textContent = "❌ 未识别到表头，请确认表格含：货品名称（标题） / 首图url / 销量站点 / 期次";
        return;
      }
      const hm = api.mapHeaderRow(firstHead || []) || {};
      const hasCol = (k) => typeof hm[k] === "number" && hm[k] >= 0;
      const missing = [];
      if (!hasCol("title")) missing.push("货品名称（组词台只吃标题，缺这一列就没有词可用）");
      if (!hasCol("site")) missing.push("销量站点（勾选上方站点即可）");
      /* 20261113D：站点名归一到后台「站点管理」的正式名字，否则前台按站点筛不到 */
      const siteList = (tiSites || []).map((x) => x && (x.name || x)).filter(Boolean);
      rows.forEach((r) => {
        if (!r.site) return;
        r.site = siteNormResolve(r.site, siteList);
      });
      const urlSeen = {};
      rows.forEach((r) => { urlSeen[r.image_url] = (urlSeen[r.image_url] || 0) + 1; });
      const dupUrls = Object.keys(urlSeen).filter((u) => urlSeen[u] > 1).length;
      tiParsed = {
        rows, fileName: f.name, missing,
        dupUrls,
        noLink,
        urlWarn: noLink > 0 && !rows.length
          ? "❌ 「首图url」列里没有真实网址（可能是「查看首图」这类文字且没做超链接），一行也读不出来。"
          : (noLink > 0 ? "⚠️ 有 " + noLink + " 行没读到图片网址，已跳过。" : ""),
        sheets: usedSheets,
      };
      renderTiPreview();
    } catch (e) {
      if (tip) tip.textContent = "❌ 解析失败：请确认是有效的 Excel（.xlsx/.xls）文件";
    }
  }

  function renderTiPreview() {
    const tip = $("#ti-file-tip");
    const box = $("#ti-preview");
    const btn = $("#ti-import");
    if (!tiParsed) { if (box) box.innerHTML = ""; if (btn) btn.disabled = true; return; }
    const rows = tiParsed.rows;
    const withTitle = rows.filter((r) => r.title).length;
    const perSet = {};
    rows.forEach((r) => { if (r.period) perSet[r.period] = 1; });
    const perList = Object.keys(perSet);
    const pickedCat = ($("#ti-cat").value || "").trim();
    const periodPicked = ($("#ti-period-label").value || "").trim();
    const groupNote = groupText(rows, pickedCat, periodPicked);
    if (tip) tip.textContent = "✅ 已识别 " + tiParsed.fileName + "：共 " + rows.length + " 行，其中有标题 "
      + withTitle + " 行" + (groupNote ? " · " + groupNote : "");
    if (box) {
      box.innerHTML =
        '<div class="rank-kv">'
        + '<span>有效数据行：<b>' + rows.length + '</b></span>'
        + '<span>带标题：<b>' + withTitle + '</b></span>'
        + '<span>表格期次：<b>' + (perList.length ? escHtml(perList.slice(0, 5).join("、")) + (perList.length > 5 ? "…" : "") : "无") + '</b></span>'
        + '</div>'
        + (tiParsed.missing.length ? '<div class="hint rank-warn">未识别到列：' + escHtml(tiParsed.missing.join("、")) + '</div>' : "")
        + (tiParsed.urlWarn ? '<div class="hint rank-warn">' + escHtml(tiParsed.urlWarn) + '</div>' : "")
        + (tiParsed.dupUrls ? '<div class="hint rank-warn">表格里有 ' + tiParsed.dupUrls + ' 张图重复出现，同一站点下会合并为一条。</div>' : "")
        + '<div class="hint">本次只写入<b>标题组词台</b>：趋势上升榜与上新节奏的数据不会被动到。</div>';
    }
    if (btn) btn.disabled = rows.length === 0;
  }

  /* 分组口径与榜单一致：类目只认后台所选（没选就归「其他」），期次界面优先 */
  function groupInfo(rows, cat, periodLabel) {
    const api = P();
    const sites = [...document.querySelectorAll('#ti-site-defaults input[type="checkbox"]:checked')].map((c) => c.value);
    const useMine = sites.length > 0;
    return api.groupRankRows(rows || [], {
      periodType: PTYPE, periodLabel: periodLabel, category: cat,
      sites: sites, useMine: useMine, source: SOURCE,
    });
  }

  function groupText(rows, cat, periodLabel) {
    const gf = groupInfo(rows, cat, periodLabel);
    if (!gf.groups.length) {
      if (gf.noPeriod) return "还缺期次（用日历选一周，或让表格带「期次」列）";
      if (gf.noSite) return "还缺站点（勾选上方站点，或让表格带「销量站点」列）";
      return "";
    }
    const cats = {};
    gf.groups.forEach((g) => { cats[g.category] = 1; });
    const per = {};
    gf.groups.forEach((g) => { per[g.period] = 1; });
    return "将写入 " + gf.groups.length + " 组（" + Object.keys(per).length + " 个期次 × "
      + Object.keys(cats).join("、") + "）";
  }

  /* ---------- 导入 ---------- */
  async function doTiImport() {
    if (!tiParsed || !tiParsed.rows.length) { sbToast("请先上传并解析 Excel", false); return; }
    const periodLabel = ($("#ti-period-label").value || "").trim();
    const category = ($("#ti-cat").value || "").trim();
    const sites = [...document.querySelectorAll('#ti-site-defaults input[type="checkbox"]:checked')].map((c) => c.value);
    const useMine = sites.length > 0;

    const uniqUrl = Object.keys(tiParsed.rows.reduce((m, r) => (m[r.image_url] = 1, m), {})).length;
    if (tiParsed.rows.length > 1 && uniqUrl === 1) {
      sbToast("「首图url」列里全是同一个内容（不是图片网址），无法导入。请把该列改成真实网址文本，或给单元格加超链接。", false);
      return;
    }

    const gf = groupInfo(tiParsed.rows, category, periodLabel);
    if (!gf.groups.length) {
      if (gf.noPeriod) sbToast("请先用日历选择某一周，或让表格带上「期次」列", false);
      else if (gf.noSite) sbToast("表格没有「销量站点」列，且未勾选站点", false);
      else sbToast("没有可导入的有效行", false);
      return;
    }

    const mode = (document.querySelector('input[name="ti-mode"]:checked') || {}).value === "append" ? "append" : "replace";
    const btn = $("#ti-import");
    if (btn) { btn.disabled = true; btn.textContent = "导入中…"; }

    const TOTAL = gf.groups.length;
    const t0 = Date.now();
    let inserted = 0, skippedExisting = 0, mergedInFile = 0, clearedItems = 0, done = 0;
    const failed = [];
    const undoGroups = [], backupRows = [];
    const myBatchIds = [];   /* 20261113L：本次导入新建的批次号，用来登记上传归属 */
    let backupFail = false;
    let cursor = 0;

    const prog = document.getElementById("ti-import-progress");
    const paint = (finished) => {
      if (!prog) return;
      const sec = Math.round((Date.now() - t0) / 1000);
      prog.textContent = (finished ? "✅ " : "⏳ ")
        + (finished ? "已处理完 " + TOTAL + " 组" : "导入中 · 已运行 " + sec + " 秒 · 已完成 " + done + "/" + TOTAL + " 组")
        + " · 已写入 " + inserted + " 条"
        + (failed.length ? " · 失败 " + failed.length + " 组" : "");
    };
    paint(false);
    const ticker = setInterval(() => paint(false), 1000);

    const runGroup = async (g) => {
      try {
        const seen = {};
        const list = [];
        let merged = 0;
        g.rows.forEach((r) => {
          const k = r.site + "\u0000" + r.image_url;
          if (seen[k]) { merged++; return; }
          seen[k] = 1; list.push(r);
        });
        P().computeFlags(list);

        const slot = { periodType: PTYPE, periodLabel: g.period, category: g.category, sites: g.slotSites, source: SOURCE };
        let cleared = { items: 0 };
        let skipped = 0;
        let rows = list;
        if (mode === "replace") {
          try {
            const old = await SB.listRankItems({
              periodType: PTYPE, periods: [g.period], category: g.category,
              sites: g.slotSites, max: 60000, source: SOURCE,
            });
            (old || []).forEach((r) => backupRows.push(r));
          } catch (e) { backupFail = true; }
          cleared = await SB.clearRankSlot(slot);
        } else {
          const exist = await SB.listRankSlotUrls(slot);
          const f = P().filterNotExisting(list, exist);
          rows = f.rows; skipped = f.skipped;
        }
        const batchSite = useMine ? sites.join(",") : g.slotSites.join(",");
        const batchId = await SB.createRankBatch({ periodType: PTYPE, periodLabel: g.period, category: g.category, site: batchSite, source: SOURCE });
        const payload = rows.map((r) => {
          const o = Object.assign({}, r, { batch_id: batchId, source: SOURCE });
          o.flag_opportunity = !!r.flag_opportunity;
          o.flag_hot = !!r.flag_hot;
          o.flag_surge = !!r.flag_surge;
          o.rank_ratio = r.rank_ratio || null;
          o.rank_abs = r.rank_abs || null;
          return o;
        });
        const res = payload.length ? await SB.insertRankItems(payload) : { inserted: 0 };
        const ins = (res && res.inserted) || 0;
        try { await SB.updateRankBatch(batchId, { rows: ins, skipped: skipped + merged }); } catch (e) { /* 统计失败不影响数据 */ }
        inserted += ins;
        clearedItems += (cleared && cleared.items) || 0;
        skippedExisting += skipped;
        mergedInFile += merged;
        done++;
        /* 20261113L：记下批次号，导入结束后登记上传归属（谁能改这批） */
        if (ins > 0) myBatchIds.push(batchId);
        if (ins > 0) undoGroups.push({ period: g.period, category: g.category, sites: g.slotSites, source: SOURCE, batchId: batchId });
        if (payload.length > 0 && ins === 0) failed.push(g.period + " · " + g.category + "：0 条写入");
      } catch (e) {
        failed.push(g.period + " · " + g.category + "：" + ((e && e.message) || "失败"));
      }
    };

    try {
      const workers = Array.from({ length: Math.max(1, Math.min(CONC, TOTAL)) }, async () => {
        while (cursor < gf.groups.length) {
          const i = cursor++;
          await runGroup(gf.groups[i]);
        }
      });
      await Promise.all(workers);
    } finally {
      clearInterval(ticker);
      paint(true);
      if (btn) { btn.disabled = false; btn.textContent = "导入标题数据"; }
    }

    tiUndo = undoGroups.length ? { at: new Date(), groups: undoGroups, backup: backupRows } : null;
    /* 20261113L：登记上传归属（按批次 ID）。写失败不阻断导入，只会让这批显示成「历史数据」。 */
    try {
      if (myBatchIds.length && window.UO && typeof window.UO.claim === "function") {
        await window.UO.claim("b", myBatchIds);
      }
    } catch (e) { /* 忽略 */ }
    renderTiUndo();

    const msg = "已写入【标题组词台】" + inserted + " 条"
      + (mergedInFile ? " · 表内重复合并 " + mergedInFile : "")
      + (skippedExisting ? " · 追加跳过已有 " + skippedExisting : "")
      + (clearedItems ? " · 覆盖前清掉 " + clearedItems : "")
      + (failed.length ? " · 失败 " + failed.length + " 组" : "")
      + (backupFail ? "（本次没有留底）" : "");
    sbToast(msg, failed.length === 0);
    downloadTiBackup();
    await loadTiBatches();
  }

  /* ---------- 留底 / 撤销 ---------- */
  function downloadTiBackup() {
    if (!tiUndo || !tiUndo.backup.length) return;
    try {
      const rows = [["期次", "叶子类目名称", "销量站点", "首图url", "货品名称", "环比比例", "环比绝对值"]];
      tiUndo.backup.forEach((r) => rows.push([
        r.period_label || "", r.leaf_category || "", r.site || "", r.image_url || "",
        r.title || "", r.ratio == null ? "" : r.ratio, r.abs_delta == null ? "" : r.abs_delta,
      ]));
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "标题组词台原数据");
      const d = new Date();
      const pad = (n) => (n < 10 ? "0" : "") + n;
      const name = "标题组词台原数据留底_" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
        + "_" + pad(d.getHours()) + pad(d.getMinutes()) + ".xlsx";
      XLSX.writeFile(wb, name);
    } catch (e) { /* 留底下载失败不影响导入结果 */ }
  }

  function renderTiUndo() {
    const tip = $("#ti-undo-tip");
    const btn = $("#ti-undo");
    if (btn) btn.style.display = tiUndo ? "" : "none";
    if (!tip) return;
    if (!tiUndo) { tip.textContent = ""; return; }
    const d = tiUndo.at;
    const pad = (n) => (n < 10 ? "0" : "") + n;
    tip.textContent = "本次导入 " + tiUndo.groups.length + " 组于 "
      + pad(d.getHours()) + ":" + pad(d.getMinutes()) + " 完成"
      + (tiUndo.backup.length ? "，已自动下载留底 " + tiUndo.backup.length + " 条" : "（无旧数据，未生成留底）")
      + "。点「撤销本次导入」只清本次写入的槽位。";
  }

  async function doTiUndo() {
    if (!tiUndo) return;
    if (!(await uiConfirm("撤销刚才这次导入？\n会清空本次写入的 " + tiUndo.groups.length + " 个槽位（期次 + 类目 + 站点），只影响【标题组词台】。\n图片标签不受影响。"))) return;
    const btn = $("#ti-undo");
    if (btn) btn.disabled = true;
    let removed = 0, bad = 0;
    for (const g of tiUndo.groups) {
      try {
        const n = await SB.deleteRankItemsByScope({
          periodType: PTYPE, periodLabel: g.period, category: g.category,
          sites: g.sites || [], source: SOURCE,
        });
        removed += Number(n) || 0;
      } catch (e) { bad++; }
    }
    tiUndo = null;
    renderTiUndo();
    if (btn) btn.disabled = false;
    await loadTiBatches();
    sbToast("已撤销：清空 " + removed + " 条" + (bad ? " · " + bad + " 组失败" : ""), bad === 0);
  }

  /* ---------- 台账 ---------- */
  async function loadTiBatches() {
    const box = $("#ti-batch-list");
    let list = [];
    /* 20261113L：先取归属，台账要显示上传人，并据此决定能不能删 */
    try { if (window.UO && typeof window.UO.ensure === "function") await window.UO.ensure(); } catch (e) { /* 忽略 */ }
    try { list = await SB.listRankBatches(SOURCE); } catch (e) { list = []; }
    const per = {};
    list.forEach((b) => { if (b.period_label) per[b.period_label] = 1; });
    tiPeriods = Object.keys(per);
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<div class="rkadm-empty">还没有上传记录（标题组词台的数据需要在这里上传）</div>';
      return;
    }
    const counts = await Promise.all(list.slice(0, 60).map((b) => SB.countRankSlot({
      periodType: b.period_type || PTYPE, periodLabel: b.period_label || "",
      category: b.category || "", sites: String(b.site || "").split(",").map((s) => s.trim()).filter(Boolean),
      source: SOURCE,
    }).catch(() => null)));
    box.innerHTML = "";
    list.forEach((b, i) => {
      const row = document.createElement("div");
      row.className = "rank-batch-row";
      const n = i < counts.length ? counts[i] : null;
      const cnt = (typeof n === "number") ? n : (b.rows || 0);
      /* 20261113L：谁传的谁能删。别人的（含历史数据）看得见，但删除按钮是关的 */
      const can = !(window.UO && typeof window.UO.canManage === "function")
        ? true : (window.UO.isSuper() || window.UO.canManage("b", b.id));
      const owner = (window.UO && typeof window.UO.label === "function") ? window.UO.label("b", b.id) : "";
      row.innerHTML = '<span class="rank-batch-meta">'
        + escHtml(b.period_label || "(空期次)") + ' · ' + escHtml(b.category || "其他")
        + ' · ' + escHtml(b.site || "—") + ' · ' + cnt + ' 条'
        + '<span class="rank-batch-owner' + (can ? "" : " is-other") + '"> · 上传人 '
        + escHtml(owner || "历史数据") + (can ? "" : "（不可改动）") + '</span>'
        + '</span>';
      const del = document.createElement("button");
      del.type = "button"; del.className = "btn-ghost small danger"; del.textContent = "删除";
      del.disabled = !can;
      del.title = can ? "" : "这批不是你上传的（或属于历史数据），只有上传人本人或超级管理员可以删除";
      del.onclick = async () => {
        if (!can) { sbToast("这批不是你上传的（或属于历史数据），只有上传人本人或超级管理员可以删除", false); return; }
        if (!(await uiConfirm("删除这批记录（只影响标题组词台）？\n会清空它的槽位条目与台账，删了不会自动回来。"))) return;
        try {
          await SB.deleteRankBatch(b.id);
          try { if (window.UO) await window.UO.forget("b", [b.id]); } catch (e2) { /* 忽略 */ }
          await loadTiBatches(); sbToast("已删除该批次", true);
        }
        catch (e) { sbToast((e && e.message) || "删除失败", false); }
      };
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  /* ---------- 类目清理（仅本域） ---------- */
  async function openTiCatTools() {
    const bar = $("#ti-toolbar");
    let panel = $("#ti-cat-tools");
    if (panel && panel.dataset.open === "1") { panel.dataset.open = "0"; panel.innerHTML = ""; return; }
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "ti-cat-tools";
      panel.className = "rank-cat-tools";
      if (bar && bar.parentNode) bar.parentNode.insertBefore(panel, bar.nextSibling);
    }
    panel.dataset.open = "1";
    panel.innerHTML = '<div class="hint">正在读取类目…</div>';
    let cats = [];
    try { cats = await SB.listRankCategories(SOURCE); } catch (e) { cats = null; }
    if (!cats) { panel.innerHTML = '<div class="hint">类目读取失败，请重试。</div>'; return; }
    if (!cats.length) { panel.innerHTML = '<div class="hint">标题组词台还没有类目。</div>'; return; }
    panel.innerHTML = '<div class="hint">共 ' + cats.length + ' 个类目（只统计<b>标题组词台</b>这一份数据）。</div>';
    /* 20261114I · 与趋势上升榜同一套保护：弹窗不可用就退回原生弹窗，出错必给提示 */
    const guard = (label, fn) => async () => {
      try { await fn(); }
      catch (e) {
        const m = (e && e.message) ? e.message : String(e || "未知错误");
        try { sbToast(label + "失败：" + m, false); }
        catch (e2) { try { window.alert(label + "失败：" + m); } catch (e3) {} } /* native-fallback */
      }
    };
    const askText = async (msg, def) => {
      if (typeof uiPrompt === "function") { try { return await uiPrompt(msg, def); } catch (e) {} }
      try { return window.prompt(msg, def == null ? "" : def); } catch (e) { return null; } /* native-fallback */
    };
    const askYes = async (msg) => {
      if (typeof uiConfirm === "function") { try { return await uiConfirm(msg); } catch (e) {} }
      try { return window.confirm(msg); } catch (e) { return false; } /* native-fallback */
    };
    cats.forEach((c) => {
      const row = document.createElement("div");
      row.className = "rank-cat-row";
      const name = document.createElement("span");
      name.className = "rank-cat-name";
      name.textContent = c.category || "(未填类目)";
      const meta = document.createElement("span");
      meta.className = "rank-cat-meta";
      meta.textContent = (c.batches || 0) + " 批 · " + (c.exact ? "" : "约 ") + c.rows + " 条 · " + c.periods + " 个期次";
      const merge = document.createElement("button");
      merge.type = "button"; merge.className = "btn-ghost small"; merge.textContent = "合并到…";
      merge.onclick = guard("合并", async () => {
        const v = (await askText("把「" + (c.category || "(未填类目)") + "」的条目并入哪个类目？\n填目标类目名：", c.category) || "").trim();
        if (!v) return;
        if (v === c.category) { sbToast("目标类目和源类目是同一个，没有需要合并的内容", false); return; }
        if (!(await askYes("确认把「" + c.category + "」并入「" + v + "」？（只影响标题组词台）\n重复的图会自动跳过，源类目随后删除。"))) return;
        try {
          const n = await SB.renameRankCategory(c.category, v, SOURCE);
          await loadTiBatches();
          sbToast("已并入「" + v + "」（迁移 " + n + " 条）", true);
          panel.dataset.open = "0"; panel.innerHTML = ""; openTiCatTools();
        } catch (e) { sbToast((e && e.message) || "合并失败", false); }
      });
      const wipe = document.createElement("button");
      wipe.type = "button"; wipe.className = "btn-ghost small danger"; wipe.textContent = "整类删除";
      wipe.onclick = guard("删除", async () => {
        if (!(await askYes("删除「" + (c.category || "(未填类目)") + "」的全部数据？\n含 " + (c.batches || 0) + " 个批次、约 " + c.rows + " 条；只影响标题组词台。"))) return;
        try {
          const r = await SB.deleteRankCategory(c.category, SOURCE);
          await loadTiBatches();
          sbToast("已删除该类目（" + r.items + " 条 / " + r.batches + " 批）", true);
          panel.dataset.open = "0"; panel.innerHTML = ""; openTiCatTools();
        } catch (e) { sbToast((e && e.message) || "删除失败", false); }
      });
      row.appendChild(name); row.appendChild(meta); row.appendChild(merge); row.appendChild(wipe);
      panel.appendChild(row);
    });
  }

  /* ---------- 期次归并 / 数据自检（仅本域） ---------- */
  async function openTiPeriodTools() {
    const bar = $("#ti-toolbar");
    let panel = $("#ti-period-tools");
    if (panel && panel.dataset.open === "1") { panel.dataset.open = "0"; panel.innerHTML = ""; return; }
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "ti-period-tools";
      panel.className = "rank-cat-tools";
      if (bar && bar.parentNode) bar.parentNode.insertBefore(panel, bar.nextSibling);
    }
    panel.dataset.open = "1";
    panel.innerHTML = '<div class="hint">正在读取期次…</div>';
    let r = null;
    try { r = await SB.rankSelfCheck(SOURCE); } catch (e) { r = null; }
    const list = (r && r.byPeriod) || [];
    if (!list.length) { panel.innerHTML = '<div class="hint">标题组词台还没有期次数据。</div>'; return; }
    const npl = (v) => (typeof normPeriodLabel === "function" ? normPeriodLabel(v) : String(v == null ? "" : v).trim());
    const groups = {};
    list.forEach((p) => {
      const k = npl(p.period_label);
      (groups[k] = groups[k] || { target: k, items: [] }).items.push(p);
    });
    const keys = Object.keys(groups).sort();
    panel.innerHTML = '<div class="hint">共 ' + list.length + ' 个期次写法（只统计标题组词台）。</div>'
      + keys.map((k) => {
        const g = groups[k];
        const total = g.items.reduce((a, x) => a + x.n, 0);
        const mixed = g.items.length > 1;
        return '<div class="rank-cat-row">'
          + '<span class="rank-cat-name">' + escHtml(k) + '</span>'
          + '<span class="rank-cat-meta">' + g.items.map((x) => escHtml(x.period_label || "(空)") + " " + x.n + " 条").join("、") + ' · 共 ' + total + ' 条</span>'
          + (mixed ? '<button type="button" class="btn-ghost small" data-ti-per-merge="' + escHtml(k) + '">合并为「' + escHtml(k) + '」</button>'
                   : '<span class="rank-cat-ok">已是标准写法</span>')
          + '</div>';
      }).join("");
    Array.prototype.forEach.call(panel.querySelectorAll("[data-ti-per-merge]"), (btn) => {
      btn.onclick = async () => {
        const target = btn.getAttribute("data-ti-per-merge");
        const g = groups[target];
        const todo = g.items.filter((x) => x.period_label !== target);
        if (!todo.length) return;
        if (!(await uiConfirm("把这些写法合并到「" + target + "」？（只影响标题组词台）\n做法：先复制到新名字并核对条数，成功后才删旧名字。"))) return;
        btn.disabled = true;
        let done = 0, bad = 0, moved = 0;
        for (const x of todo) {
          try {
            moved += Number(await SB.updateRankPeriodData(x.period_label, x.period_type || PTYPE, target, x.period_type || PTYPE, SOURCE)) || 0;
            done++;
          } catch (e) { bad++; }
          btn.textContent = "合并中 " + (done + bad) + "/" + todo.length;
        }
        await loadTiBatches();
        sbToast("已合并 " + done + " 个写法" + (moved ? "，迁移 " + moved + " 条" : "") + (bad ? "，失败 " + bad + " 个" : ""), bad === 0);
        panel.dataset.open = "0"; panel.innerHTML = "";
      };
    });
  }

  async function doTiSelfCheck() {
    const btn = $("#ti-selfcheck");
    if (btn) { btn.disabled = true; btn.textContent = "自检中…"; }
    try {
      const r = await SB.rankSelfCheck(SOURCE);
      const L = [];
      L.push("【标题组词台 · 库里】条目 " + (r.items || 0) + " 条");
      if ((r.byPeriod || []).length) L.push("　　期次：" + r.byPeriod.slice(0, 8).map((p) => (p.period_label || "(空)") + " " + p.n + " 条").join("、"));
      L.push("");
      L.push("【前台能筛到的】期次 " + (r.periods || []).length + " 个 · 类目 " + (r.categories || []).length + " 个");
      if ((r.categories || []).length) L.push("　　类目：" + r.categories.slice(0, 8).join("、"));
      L.push("");
      L.push(r.items
        ? "结论：数据已写入标题组词台。前台若仍没词，先确认标题是否为空（本面板预览里「带标题」行数为 0 就说明表里没有标题列）。"
        : "结论：标题组词台一条数据都没有，需要在本面板上传表格。");
      await uiAlert(L.join("\n"), { title: "标题组词台 · 数据自检" });
    } catch (e) {
      sbToast("自检失败：" + ((e && e.message) || "请重试"), false);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "数据自检…"; }
    }
  }

  /* ---------- 初始化 ---------- */
  function bindTiPanel() {
    const panel = $("#titlelab-card");
    if (!panel) return;
    const d = $("#ti-period-date");
    if (d && !d.value) {
      const now = new Date();
      const pad = (n) => (n < 10 ? "0" : "") + n;
      d.value = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    }
    syncTiPeriod();
    if (d) d.onchange = syncTiPeriod;
    const file = $("#ti-file");
    if (file) file.onchange = onTiFileChange;
    const imp = $("#ti-import");
    if (imp) imp.onclick = doTiImport;
    const undoBtn = $("#ti-undo");
    if (undoBtn) undoBtn.onclick = doTiUndo;
    const catSel = $("#ti-cat");
    if (catSel) catSel.onchange = () => { if (tiParsed) renderTiPreview(); };
    const catAdd = $("#ti-cat-add");
    if (catAdd) catAdd.onclick = async () => {
      const v = (await uiPrompt("输入新类目名称（同步到「标签管理 → 前台类目」）：") || "").trim();
      if (!v) return;
      try {
        await SB.addCategory(v);
        await loadTiCats();
        const sel = $("#ti-cat");
        if (sel) sel.value = v;
        if (tiParsed) renderTiPreview();
        sbToast("已新增类目「" + v + "」", true);
      } catch (e) { sbToast((e && e.message) || "新增类目失败", false); }
    };
    const catTools = $("#ti-cat-tools-btn");
    if (catTools) catTools.onclick = () => openTiCatTools();
    const perTools = $("#ti-period-tools-btn");
    if (perTools) perTools.onclick = () => openTiPeriodTools();
    const sc = $("#ti-selfcheck");
    if (sc) sc.onclick = doTiSelfCheck;
    const refresh = $("#ti-refresh");
    if (refresh) refresh.onclick = async () => { await enterTiPanel(); sbToast("已刷新", true); };
    const openFront = $("#ti-open-front");
    if (openFront) openFront.onclick = () => window.open("titlelab.html", "_blank");
  }

  async function enterTiPanel() {
    await loadTiSites();
    await loadTiCats();
    await loadTiBatches();
    renderTiUndo();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindTiPanel);
  else bindTiPanel();

  Object.assign(window, {
    enterTiPanel, loadTiBatches, loadTiCats, loadTiSites,
    doTiImport, onTiFileChange, doTiUndo, doTiSelfCheck,
    openTiCatTools, openTiPeriodTools, groupInfo,
    TITLE_SOURCE: SOURCE,
  });
}
