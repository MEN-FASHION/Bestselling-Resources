/* ============================================================================
 * admin-rank.js —— 后台「站内趋势上升榜单」
 * 用 Excel 上传榜单数据（叶子类目名称 / 销量站点 / 首图url / 环比绝对值 / 环比比例），
 * 自动打三种标签（潜力机会 / 趋势爆款 / 周度激增），前台「趋势上升榜」专区做国家或周次对比。
 * 依赖：admin.js（sbToast / escHtml / escAttr）、SB（supabase.js）、XLSX（vendor）
 * 说明：本文件不产生全局重名（顶层只声明一个块级作用域内的变量与函数）。
 * ==========================================================================*/
{
  const RANK_HOT_TOP = 20;      // 趋势爆款：环比绝对值上升的前 20 名
  const RANK_SURGE_PCT = 0.2;   // 周度激增：双重提升的前 20%

  let rankSites = [];     // [{id,name,sort_order}]
  let rankCats = [];      // 类目管理里的类目名
  let rankParsed = null;  // { rows:[], headers:[], missing:[] }

  const $ = (s) => document.querySelector(s);

  /* ---------- 表头识别 ---------- */
  function normHead(h) {
    return String(h == null ? "" : h).replace(/\s+/g, "").replace(/[（(].*?[)）]/g, "").toLowerCase();
  }
  // 返回列索引映射；识别不到返回 null
  function mapHeaderRow(cells) {
    const hs = cells.map(normHead);
    const find = (test) => hs.findIndex(test);
    const iAbs = find(h => h.indexOf("环比绝对值") >= 0 || (h.indexOf("绝对值") >= 0 && h.indexOf("比例") < 0));
    const iRatio = find(h => h.indexOf("环比比例") >= 0 || (h.indexOf("比例") >= 0 && h.indexOf("绝对值") < 0));
    const iSite = find(h => h.indexOf("销量站点") >= 0 || h.indexOf("站点") >= 0 || h === "国家" || h.indexOf("国家") === 0);
    const iUrl = find(h => (h.indexOf("首图") >= 0 && h.indexOf("url") >= 0) || h === "首图url" || h.indexOf("首图") >= 0);
    const iLeaf = find(h => h.indexOf("叶子类目") >= 0);
    const iCat = find(h => h.indexOf("类目") >= 0 && h.indexOf("叶子") < 0);
    if (iAbs < 0 && iRatio < 0 && iSite < 0 && iUrl < 0) return null;
    return { abs: iAbs, ratio: iRatio, site: iSite, url: iUrl, leaf: iLeaf >= 0 ? iLeaf : iCat };
  }
  function pickHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      const m = mapHeaderRow(rows[i] || []);
      if (m) return { idx: i, map: m };
    }
    return null;
  }
  // 数值解析：兼容 "52220%"、"1,234.5"、数值型
  function toNum(v) {
    if (v == null) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    let s = String(v).trim();
    if (!s) return null;
    s = s.replace(/,/g, "").replace(/%/g, "").replace(/[，]/g, "");
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  /* ---------- 标签与名次（按「站点 + 期次 + 类目」分池计算） ---------- */
  function computeFlags(rows) {
    const pools = {};
    rows.forEach(r => { const k = r.site || "__none__"; (pools[k] = pools[k] || []).push(r); });
    Object.keys(pools).forEach(k => {
      const pool = pools[k];
      // 名次：环比比例 / 环比绝对值 各自降序
      const byRatio = pool.filter(r => r.ratio != null).sort((a, b) => b.ratio - a.ratio);
      byRatio.forEach((r, i) => { r.rank_ratio = i + 1; });
      const byAbs = pool.filter(r => r.abs_delta != null).sort((a, b) => b.abs_delta - a.abs_delta);
      byAbs.forEach((r, i) => { r.rank_abs = i + 1; });
      // 潜力机会：环比比例上升的每一条
      pool.forEach(r => { r.flag_opportunity = r.ratio != null && r.ratio > 0; });
      // 趋势爆款：环比绝对值上升的 TOP20
      byAbs.filter(r => r.abs_delta > 0).slice(0, RANK_HOT_TOP).forEach(r => { r.flag_hot = true; });
      // 周度激增：双重提升（比例上升且绝对值上升）中按环比比例降序的前 20%
      const dual = byRatio.filter(r => r.ratio > 0 && r.abs_delta != null && r.abs_delta > 0);
      const n = dual.length ? Math.max(1, Math.round(dual.length * RANK_SURGE_PCT)) : 0;
      dual.slice(0, n).forEach(r => { r.flag_surge = true; });
    });
    return rows;
  }

  /* ---------- 站点清单 ---------- */
  async function loadRankSites() {
    try { rankSites = await SB.listRankSites(); } catch (e) { rankSites = []; }
    renderRankSites();
    renderRankSiteDefaults();
  }
  function renderRankSites() {
    const box = $("#rank-site-list");
    if (!box) return;
    box.innerHTML = "";
    if (!rankSites.length) {
      box.innerHTML = '<div class="hint">暂无站点，请在上方添加（例如：美国、墨西哥、德国）</div>';
      return;
    }
    rankSites.forEach(s => {
      const chip = document.createElement("span");
      chip.className = "rank-site-chip";
      chip.innerHTML = escHtml(s.name) + ' <button type="button" class="rank-site-del" title="删除站点">✕</button>';
      chip.querySelector(".rank-site-del").onclick = async () => {
        if (!confirm("删除站点「" + s.name + "」？（已上传的榜单数据不受影响）")) return;
        try { await SB.removeRankSite(s.name); await loadRankSites(); sbToast("已删除站点", true); }
        catch (e) { sbToast("删除失败", false); }
      };
      box.appendChild(chip);
    });
  }
  function renderRankSiteDefaults() {
    const box = $("#rank-site-defaults");
    if (!box) return;
    box.innerHTML = "";
    if (!rankSites.length) {
      box.innerHTML = '<span class="hint">（先添加站点）</span>';
      return;
    }
    rankSites.forEach(s => {
      const l = document.createElement("label");
      l.className = "chk";
      l.innerHTML = '<input type="checkbox" value="' + escAttr(s.name) + '"> ' + escHtml(s.name);
      box.appendChild(l);
    });
  }

  /* ---------- 类目下拉（复用「类目管理」，可自定义添加） ---------- */
  async function loadRankCats() {
    try { rankCats = await SB.listActiveCats(); } catch (e) { rankCats = []; }
    const sel = $("#rank-cat");
    if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = '<option value="">请选择类目…</option>' + rankCats.map(c => '<option value="' + escAttr(c) + '">' + escHtml(c) + '</option>').join("");
    if (keep && rankCats.indexOf(keep) >= 0) sel.value = keep;
  }

  // 读取文件为 ArrayBuffer：优先标准 API，旧内核回退 FileReader
  function readFileBuf(f) {
    if (f && typeof f.arrayBuffer === "function") return f.arrayBuffer();
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error("读取文件失败"));
      fr.readAsArrayBuffer(f);
    });
  }

  // 环比比例：优先按「显示值」解析；小数视为百分比单元格（格式信息缺失时）换算为百分数
  function toRatio(v) {
    const s = (v === null || v === undefined) ? "" : String(v).trim();
    const n = toNum(v);
    if (n === null) return null;
    if (s.indexOf("%") < 0 && Math.abs(n) > 0 && Math.abs(n) < 1) return Math.round(n * 10000) / 100;
    return n;
  }

  /* ---------- 解析文件 ---------- */
  async function onRankFileChange() {
    rankParsed = null;
    const btn = $("#rank-import");
    if (btn) btn.disabled = true;
    const tip = $("#rank-file-tip");
    const box = $("#rank-preview");
    if (box) box.innerHTML = "";
    const f = $("#rank-file").files && $("#rank-file").files[0];
    if (!f) { if (tip) tip.textContent = ""; return; }
    if (tip) tip.textContent = "正在解析 " + f.name + " …";
    try {
      const buf = await readFileBuf(f);
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // raw:false → 取「显示值」，这样百分比格式的单元格拿到的是 "52220%" 而不是小数
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      const head = pickHeaderRow(aoa);
      if (!head) {
        if (tip) tip.textContent = "❌ 未识别到表头，请确认表格含：销量站点 / 首图url / 环比绝对值 / 环比比例";
        return;
      }
      const rows = [];
      for (let i = head.idx + 1; i < aoa.length; i++) {
        const c = aoa[i] || [];
        const url = String(head.map.url >= 0 ? (c[head.map.url] || "") : "").trim();
        if (!url) continue;                                  // 没图的行跳过
        rows.push({
          leaf_category: String(head.map.leaf >= 0 ? (c[head.map.leaf] || "") : "").trim(),
          site: String(head.map.site >= 0 ? (c[head.map.site] || "") : "").trim(),
          image_url: url,
          abs_delta: toNum(head.map.abs >= 0 ? c[head.map.abs] : null),
          ratio: toRatio(head.map.ratio >= 0 ? c[head.map.ratio] : null),
          hasSiteCol: head.map.site >= 0,
        });
      }
      const missing = [];
      if (head.map.abs < 0) missing.push("环比绝对值");
      if (head.map.ratio < 0) missing.push("环比比例");
      if (head.map.site < 0) missing.push("销量站点（将使用下方选择的默认站点）");
      rankParsed = { rows, headers: aoa[head.idx] || [], missing, fileName: f.name };
      renderRankPreview();
    } catch (e) {
      if (tip) tip.textContent = "❌ 解析失败：请确认是有效的 Excel（.xlsx/.xls）文件";
    }
  }

  function renderRankPreview() {
    const tip = $("#rank-file-tip");
    const box = $("#rank-preview");
    if (!rankParsed) { if (box) box.innerHTML = ""; return; }
    const rows = rankParsed.rows;
    const withAbs = rows.filter(r => r.abs_delta != null).length;
    const withRatio = rows.filter(r => r.ratio != null).length;
    const upRatio = rows.filter(r => r.ratio != null && r.ratio > 0).length;
    const upAbs = rows.filter(r => r.abs_delta != null && r.abs_delta > 0).length;
    const dual = rows.filter(r => r.ratio > 0 && r.abs_delta > 0).length;
    const surgeN = dual ? Math.max(1, Math.round(dual * RANK_SURGE_PCT)) : 0;
    if (tip) tip.textContent = "✅ 已识别 " + rankParsed.fileName + "：共 " + rows.length + " 行";
    if (box) {
      box.innerHTML =
        '<div class="rank-kv">' +
        '<span>有效数据行：<b>' + rows.length + '</b></span>' +
        '<span>含环比比例：<b>' + withRatio + '</b></span>' +
        '<span>含环比绝对值：<b>' + withAbs + '</b></span>' +
        '</div>' +
        '<div class="rank-kv">' +
        '<span>潜力机会（环比比例上升）：<b>' + upRatio + '</b></span>' +
        '<span>趋势爆款（绝对值上升 TOP' + RANK_HOT_TOP + '）：<b>' + Math.min(upAbs, RANK_HOT_TOP) + '</b></span>' +
        '<span>周度激增（双重提升前 ' + Math.round(RANK_SURGE_PCT * 100) + '%）：<b>' + surgeN + '</b></span>' +
        '</div>' +
        (rankParsed.missing.length ? '<div class="hint rank-warn">未识别到列：' + escHtml(rankParsed.missing.join("、")) + '</div>' : '') +
        '<div class="hint">标签按「站点 + 期次 + 类目」分池计算（每个国家各自排名）。</div>';
    }
    const btn = $("#rank-import");
    if (btn) btn.disabled = rows.length === 0;
  }

  /* ---------- 导入 ---------- */
  async function doRankImport() {
    if (!rankParsed || !rankParsed.rows.length) { sbToast("请先上传并解析 Excel", false); return; }
    const periodType = (document.querySelector('input[name="rank-period"]:checked') || {}).value || "week";
    const periodLabel = ($("#rank-period-label").value || "").trim();
    const category = ($("#rank-cat").value || "").trim();
    if (!periodLabel) { sbToast(periodType === "month" ? "请填写月份（如 2026-09）" : "请填写周次（如 W41）", false); return; }
    if (!category) { sbToast("请选择类目", false); return; }
    const defaults = [...document.querySelectorAll('#rank-site-defaults input[type="checkbox"]:checked')].map(c => c.value);

    // 展开：行内自带站点 → 用之；否则用所选默认站点（可多个）
    const out = [];
    let noSite = 0;
    rankParsed.rows.forEach(r => {
      const sites = r.site ? [r.site] : defaults;
      if (!sites.length) { noSite++; return; }
      sites.forEach(s => {
        out.push({
          period_type: periodType,
          period_label: periodLabel,
          category,
          site: s,
          leaf_category: r.leaf_category,
          image_url: r.image_url,
          ratio: r.ratio,
          abs_delta: r.abs_delta,
        });
      });
    });
    if (!out.length) {
      sbToast(noSite ? "表格没有「销量站点」列，且未选择默认站点" : "没有可导入的有效行", false);
      return;
    }
    computeFlags(out);
    const btn = $("#rank-import");
    if (btn) { btn.disabled = true; btn.textContent = "导入中…"; }
    try {
      const batchId = await SB.createRankBatch({ periodType, periodLabel, category, site: defaults.join(",") });
      const rows = out.map(r => {
        const o = Object.assign({}, r, { batch_id: batchId });
        o.flag_opportunity = !!r.flag_opportunity;
        o.flag_hot = !!r.flag_hot;
        o.flag_surge = !!r.flag_surge;
        o.rank_ratio = r.rank_ratio || null;
        o.rank_abs = r.rank_abs || null;
        return o;
      });
      const res = await SB.insertRankItems(rows);
      const inserted = (res && res.inserted) || 0;
      const skipped = rows.length - inserted;
      try { await SB.updateRankBatch(batchId, { rows: inserted, skipped }); } catch (e) { /* 统计失败不影响数据 */ }
      sbToast("导入完成：新增 " + inserted + " 条" + (skipped > 0 ? "，重复跳过 " + skipped + " 条" : ""), true);
      rankParsed = null;
      $("#rank-file").value = "";
      $("#rank-file-tip").textContent = "";
      $("#rank-preview").innerHTML = "";
      await loadRankBatches();
    } catch (e) {
      sbToast("导入失败：" + ((e && e.message) || "请重试"), false);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "导入榜单"; }
    }
  }

  /* ---------- 已上传记录 ---------- */
  async function loadRankBatches() {
    const box = $("#rank-batch-list");
    if (!box) return;
    let list = [];
    try { list = await SB.listRankBatches(); } catch (e) { list = []; }
    if (!list.length) { box.innerHTML = '<div class="hint">还没有上传记录</div>'; return; }
    box.innerHTML = "";
    list.forEach(b => {
      const row = document.createElement("div");
      row.className = "rank-batch-row";
      const cell = document.createElement("span");
      cell.className = "rank-batch-main";
      cell.textContent = (b.period_type === "month" ? "月度 " : "周度 ") + b.period_label + " · " + (b.category || "未填类目") + (b.site ? " · 默认站点 " + b.site : "") + " · " + (b.rows || 0) + " 条" + (b.skipped ? "（跳过 " + b.skipped + "）" : "");
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-ghost rank-batch-del";
      del.textContent = "删除";
      del.onclick = async () => {
        if (!confirm("删除该批次「" + b.period_label + " · " + b.category + "」及其全部条目？")) return;
        try { await SB.deleteRankBatch(b.id); await loadRankBatches(); sbToast("已删除该批次", true); }
        catch (e) { sbToast("删除失败", false); }
      };
      row.appendChild(cell);
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  /* ---------- 面板进入 ---------- */
  async function enterRankPanel() {
    await Promise.all([loadRankSites(), loadRankCats(), loadRankBatches()]);
  }

  /* ---------- 事件绑定（script 顺序保证本文件在 admin.js 之后加载） ---------- */
  function bindRankPanel() {
    if (!$("#rank-card")) return;
    const siteAdd = $("#rank-site-add");
    if (siteAdd) siteAdd.onclick = async () => {
      const v = ($("#rank-site-new").value || "").trim();
      if (!v) { sbToast("请输入站点名", false); return; }
      try {
        await SB.addRankSite(v);
        $("#rank-site-new").value = "";
        await loadRankSites();
        sbToast("已添加站点「" + v + "」", true);
      } catch (e) { sbToast((e && e.message) || "添加失败", false); }
    };
    const catAdd = $("#rank-cat-add");
    if (catAdd) catAdd.onclick = async () => {
      const v = (prompt("输入新类目名称（将同步到「标签管理 → 前台类目」）：") || "").trim();
      if (!v) return;
      try {
        await SB.addCategory(v);
        await loadRankCats();
        const sel = $("#rank-cat");
        if (sel) sel.value = v;
        sbToast("已新增类目「" + v + "」", true);
      } catch (e) { sbToast((e && e.message) || "新增类目失败", false); }
    };
    const file = $("#rank-file");
    if (file) file.onchange = onRankFileChange;
    const imp = $("#rank-import");
    if (imp) imp.onclick = doRankImport;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindRankPanel);
  else bindRankPanel();

  Object.assign(window, {
    enterRankPanel, loadRankBatches, loadRankSites, loadRankCats,
    doRankImport, onRankFileChange, computeRankFlags: computeFlags,
  });
}