/* ============================================================================
 * admin-rhythm.js —— 后台「上新节奏」（月度趋势榜）
 * 由 admin-rank.js（趋势上升榜 · 周度）复制而来，唯一差别是「期次 = 月度」：
 *   · 只读 / 只写 period_type = "month" 的数据，周度数据一条都不碰
 *   · 期次选择只有月份（如 2026-10），没有「周度 / 月度」切换
 *   · 标签口径与周度完全一致（潜力机会 / 趋势爆款 / 月度激增）
 * 站点、地区分组、图案印花款开关与周度共用同一份配置（同一批店铺、同一批国家），
 * 只有「期次」是分开的。
 * ==========================================================================*/
{
  const RANK_HOT_TOP = 20;      // 趋势爆款：环比绝对值上升的前 20 名
  const RANK_SURGE_PCT = 0.2;   // 月度激增：双重提升的前 20%

  let rankSites = [];     // [{id,name,sort_order}]
  let rankCats = [];      // 类目管理里的类目名
  let rankParsed = null;  // { rows:[], headers:[], missing:[] }
  let rankPeriods = [];   // 由上传记录聚合：[{label,type,rows,batches}]
  let itemMonths = [];    // 库里真实存在的月份（不依赖批次台账，老数据也能选到）
  let rankGroups = [];    // 地区分组：[{name, members:[站点名…]}]（如「欧洲」= 英国/德国/法国…）
  const rankPv = { cat: "", site: "", period: "", mode: "h", size: "m" };
  /* 前台显隐：哪些国家站点 / 周次在前台展示（空数组 = 全部展示）
     存于 site_settings.frontend_dims.rank_hidden，随现有配置列读写 */
  let rankHidden = { sites: [], periods: [] };

  const $ = (s) => document.querySelector(s);

  /* 期次排序键（与前台 rank.js 同一套口径：周次 < 月份 < 具体日期） */
  function admPeriodKey(p) {
    const s = String(p || "").trim();
    const ym = s.match(/(20\d{2})/);
    const year = ym ? parseInt(ym[1], 10) : 0;
    let m = s.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return parseInt(m[1], 10) * 10000 + 300 + parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
    m = s.match(/[Ww]\s*(\d{1,2})/) || s.match(/第?\s*(\d{1,2})\s*周/);
    if (m) return year * 10000 + 100 + parseInt(m[1], 10);
    m = s.match(/(20\d{2})\D{0,3}(\d{1,2})\s*月?$/) || s.match(/^(\d{1,2})\s*月$/);
    if (m) return year * 10000 + 200 + parseInt(m[m.length - 1], 10);
    m = s.match(/^(\d{1,3})$/);
    if (m) return year * 10000 + 100 + parseInt(m[1], 10);
    return 990000 + (s.charCodeAt(0) || 0);
  }

  /* ---------- 表头识别 ---------- */
  function normHead(h) {
    return String(h == null ? "" : h).replace(/\s+/g, "").replace(/[（(].*?[)）]/g, "").toLowerCase();
  }
  /* 表头是不是「ID / 编号」这类标识列。
     踩过的坑：表里同时有「叶子类目」和「叶子类目ID」两列，而 ID 列排在前面，
     按"含叶子类目"去找会先命中 ID 列 → 把一串数字当成类目名称存进去，
     之后前台和导出表里显示的全是数字。 */
  function isIdHead(h) {
    var x = String(h == null ? "" : h).toLowerCase();
    return /id$/i.test(x) || /(^|[^a-z])id([^a-z]|$)/i.test(x) || x.indexOf("编号") >= 0 || x.indexOf("code") >= 0;
  }
  // 返回列索引映射；识别不到返回 null
  function mapHeaderRow(cells) {
    const hs = cells.map(normHead);
    const find = (test) => hs.findIndex(test);
    const iAbs = find(h => h.indexOf("环比绝对值") >= 0 || (h.indexOf("绝对值") >= 0 && h.indexOf("比例") < 0));
    const iRatio = find(h => h.indexOf("环比比例") >= 0 || (h.indexOf("比例") >= 0 && h.indexOf("绝对值") < 0));
    const iSite = find(h => h.indexOf("销量站点") >= 0 || h.indexOf("站点") >= 0 || h === "国家" || h.indexOf("国家") === 0);
    const iUrl = find(h => (h.indexOf("首图") >= 0 && h.indexOf("url") >= 0) || h === "首图url" || h.indexOf("首图") >= 0);
    const iLeaf = find(h => h.indexOf("叶子类目") >= 0 && !isIdHead(h));
    const iCat = find(h => h.indexOf("类目") >= 0 && h.indexOf("叶子") < 0 && !isIdHead(h));
    if (iAbs < 0 && iRatio < 0 && iSite < 0 && iUrl < 0) return null;
    return { abs: iAbs, ratio: iRatio, site: iSite, url: iUrl, leaf: iLeaf >= 0 ? iLeaf : iCat };
  }
  /* 表头行识别：在前几行里挑「识别到的列最多」的那一行。
     有些整理表在表头之上还有标题行、说明行，说明文字里常出现「环比比例」「环比绝对值」这些字样，
     逐行取「第一个像表头的行」会把说明行误判成表头 → 首图URL 列找不到 → 一行也读不出来。 */
  function scoreHeaderRow(m) {
    if (!m) return 0;
    return (m.abs >= 0 ? 1 : 0) + (m.ratio >= 0 ? 1 : 0) + (m.site >= 0 ? 1 : 0)
      + (m.url >= 0 ? 1 : 0) + (m.leaf >= 0 ? 1 : 0);
  }
  function pickHeaderRow(rows) {
    let best = null, first = null;
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
      const m = mapHeaderRow(rows[i] || []);
      if (!m) continue;
      if (!first) first = { idx: i, map: m, score: scoreHeaderRow(m) };
      const s = scoreHeaderRow(m);
      if (s >= 2 && (!best || s > best.score)) best = { idx: i, map: m, score: s };
    }
    return best || first;   // 一行都不够 2 列时，退回老做法（取第一个像表头的行）
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
      // 月度激增：双重提升（比例上升且绝对值上升）中按环比比例降序的前 20%
      const dual = byRatio.filter(r => r.ratio > 0 && r.abs_delta != null && r.abs_delta > 0);
      const n = dual.length ? Math.max(1, Math.round(dual.length * RANK_SURGE_PCT)) : 0;
      dual.slice(0, n).forEach(r => { r.flag_surge = true; });
    });
    return rows;
  }

  /* ---------- 站点清单 ---------- */
  /* ---------- 前台显隐（站点 / 周次） ---------- */
  async function loadRankHidden() {
    try { rankHidden = await SB.getRankHidden(); }
    catch (e) { rankHidden = { sites: [], periods: [] }; }
    rankHidden = { sites: rankHidden.sites || [], periods: rankHidden.periods || [] };
  }
  function rankHiddenOn(kind, name) {
    return (rankHidden[kind] || []).indexOf(name) >= 0;
  }
  async function toggleRankHidden(kind, name) {
    const arr = (rankHidden[kind] || []).slice();
    const i = arr.indexOf(name);
    if (i >= 0) arr.splice(i, 1); else arr.push(name);
    const patch = {}; patch[kind] = arr;
    try {
      rankHidden = await SB.setRankHidden(patch);
      if (kind === "sites") renderRankSites(); else renderRankPeriods();
      fillRankPvControls();
      rankPreviewRefresh();
      sbToast(i >= 0 ? "已恢复前台展示：" + name : "已在前台隐藏：" + name, true);
    } catch (e) { sbToast((e && e.message) || "保存失败", false); }
  }
  /* ---------- 图案印花款 · 前台展示开关（20261103B） ----------
     与「视觉专区 → 标签管理」里的是同一个配置项，任一处改完另一处下次打开就是新值，
     不会出现两个开关各说各的。 */
  let rankPrintVisible = true;
  async function loadRankPrintSwitch() {
    const box = $("#rm-pattern-print-switch");
    if (!box) return;
    try { rankPrintVisible = await SB.getPatternPrintVisible(); } catch (e) { rankPrintVisible = true; }
    renderRankPrintSwitch();
  }
  function renderRankPrintSwitch() {
    const box = $("#rm-pattern-print-switch");
    if (!box) return;
    const on = rankPrintVisible !== false;
    box.innerHTML = "";
    const row = document.createElement("div");
    row.className = "fds-row" + (on ? " on" : "");
    row.innerHTML = '<span class="fds-name">图案印花款</span>'
      + '<span class="fds-switch' + (on ? " on" : "") + '"><i></i></span>'
      + '<span class="fds-state">' + (on ? "展示" : "隐藏") + '</span>';
    row.title = on ? "前台展示含印花图案的款式 · 点击关闭" : "前台已隐藏含印花图案的款式 · 点击恢复";
    row.onclick = async () => {
      const next = !(rankPrintVisible !== false);
      rankPrintVisible = next;
      renderRankPrintSwitch();
      try {
        await SB.setPatternPrintVisible(next);
        sbToast(next ? "已开启「图案印花款」前台展示" : "已关闭「图案印花款」前台展示：含印花图案的款不再出现在前台", true);
        rankPreviewRefresh();          /* 预览即前台所见，跟着刷新 */
      } catch (e) { sbToast((e && e.message) || "保存失败", false); }
    };
    box.appendChild(row);
    const note = $("#rm-pattern-print-note");
    if (note) {
      note.innerHTML = on
        ? "当前：含印花图案的款照常展示。"
        : '当前：<b>含印花图案的款在前台不展示</b> —— 榜单列表、体征卡、覆盖率与详细报告都不再计入这些款（库里数据不受影响）。';
    }
  }

  /* 眼睛图标：前台是否展示（点一下切换） */
  function rankEyeBtn(kind, name) {
    const on = !rankHiddenOn(kind, name);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rkadm-icon rkadm-icon--eye" + (on ? "" : " off");
    b.textContent = on ? "◉" : "◌";
    b.title = on ? "前台展示中 · 点击隐藏（前台不再出现，数据保留）" : "前台已隐藏 · 点击恢复展示";
    b.onclick = () => toggleRankHidden(kind, name);
    return b;
  }

  async function loadRankSites() {
    try { rankSites = await SB.listRankSites(); } catch (e) { rankSites = []; }
    renderRankSites();
    renderRankSiteDefaults();
    if (rankGroups.length) renderRankGroups();   // 站点增删后，地区分组的成员勾选面板同步刷新
  }
  function renderRankSites() {
    const box = $("#rm-site-list");
    if (!box) return;
    box.innerHTML = "";
    if (!rankSites.length) {
      box.innerHTML = '<div class="rkadm-empty">还没有站点。在上方输入框新增（例如：美国、墨西哥、德国）。</div>';
      return;
    }
    rankSites.forEach((s, idx) => {
      const row = document.createElement("div");
      row.className = "rkadm-row";

      const name = document.createElement("input");
      name.type = "text";
      name.className = "rkadm-name";
      name.value = s.name;
      name.title = "点一下即可改名（已有数据会一起改名）";
      name.addEventListener && name.addEventListener("focus", () => name.select());
      const commit = async () => {
        const v = (name.value || "").trim();
        if (!v || v === s.name) { name.value = s.name; return; }
        if (!confirm("把站点「" + s.name + "」改名为「" + v + "」？\n该站点已上传的榜单数据会一起改名。")) { name.value = s.name; return; }
        try {
          await SB.updateRankSiteById(s.id, { name: v });
          await SB.renameRankSiteData(s.name, v);
          /* 地区分组里若含旧站点名，一并改名，避免分组空掉 */
          if (rankGroups.some((g) => (g.members || []).indexOf(s.name) >= 0)) {
            rankGroups.forEach((g) => {
              const i = (g.members || []).indexOf(s.name);
              if (i >= 0) g.members[i] = v;
            });
            await SB.setRankGroups(rankGroups);
          }
          await loadRankSites();
          await loadRankBatches();
          rankPreviewRefresh();
          sbToast("已改名为「" + v + "」", true);
        } catch (e) { name.value = s.name; sbToast((e && e.message) || "改名失败", false); }
      };
      name.onblur = commit;
      name.onkeydown = (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); name.blur(); }
        if (ev.key === "Escape") { name.value = s.name; name.blur(); }
      };

      const move = async (dir) => {
        const t = rankSites[idx + dir];
        if (!t) return;
        try {
          await SB.updateRankSiteById(s.id, { sort_order: t.sort_order });
          await SB.updateRankSiteById(t.id, { sort_order: s.sort_order });
          await loadRankSites(); rankPreviewRefresh();
        } catch (e) { sbToast("排序失败", false); }
      };

      const up = document.createElement("button");
      up.type = "button"; up.className = "rkadm-icon"; up.textContent = "↑"; up.title = "上移";
      up.onclick = () => move(-1);
      const down = document.createElement("button");
      down.type = "button"; down.className = "rkadm-icon"; down.textContent = "↓"; down.title = "下移";
      down.onclick = () => move(1);
      const del = document.createElement("button");
      del.type = "button"; del.className = "rkadm-icon rkadm-icon--del"; del.textContent = "✕"; del.title = "删除站点";
      del.onclick = async () => {
        if (!confirm("删除站点「" + s.name + "」？\n（已上传的榜单数据不受影响，仅从站点清单移除）")) return;
        try { await SB.removeRankSite(s.name); await loadRankSites(); fillRankPvControls(); rankPreviewRefresh(); sbToast("已删除站点", true); }
        catch (e) { sbToast("删除失败", false); }
      };

      row.appendChild(name); row.appendChild(rankEyeBtn("sites", s.name)); row.appendChild(up); row.appendChild(down); row.appendChild(del);
      box.appendChild(row);
    });
  }

  /* ---------- 地区分组（把多个国家并成一个地区） ---------- */
  async function loadRankGroups() {
    try { rankGroups = await SB.getRankGroups(); } catch (e) { rankGroups = []; }
    renderRankGroups();
  }
  function saveRankGroups(msg) {
    return SB.setRankGroups(rankGroups).then(() => {
      renderRankGroups();
      fillRankPvControls();
      rankPreviewRefresh();
      if (msg) sbToast(msg, true);
    }).catch((e) => sbToast((e && e.message) || "保存地区分组失败", false));
  }
  function renderRankGroups() {
    const box = $("#rm-group-list");
    if (!box) return;
    box.innerHTML = "";
    if (!rankGroups.length) {
      box.innerHTML = '<div class="rkadm-empty">还没有地区。例如新增「欧洲」，再把英国 / 德国 / 法国等勾进去；前台就能按「欧洲」整区对比，也能只看其中一个国家。</div>';
      return;
    }
    rankGroups.forEach((g, gi) => {
      const wrap = document.createElement("div");
      wrap.className = "rkadm-group";

      const row = document.createElement("div");
      row.className = "rkadm-row";

      const name = document.createElement("input");
      name.type = "text";
      name.className = "rkadm-name";
      name.value = g.name;
      name.title = "点一下即可改地区名";
      name.onfocus = () => name.select();
      const commit = () => {
        const v = (name.value || "").trim();
        if (!v || v === g.name) { name.value = g.name; return; }
        if (rankGroups.some((x, i) => i !== gi && x.name === v)) { name.value = g.name; sbToast("已有同名地区", false); return; }
        const old = g.name;
        if (!confirm("把地区「" + old + "」改名为「" + v + "」？\n该地区下已选的国家不受影响。")) { name.value = old; return; }
        rankGroups[gi].name = v;
        saveRankGroups("已改名为「" + v + "」");
      };
      name.onblur = commit;
      name.onkeydown = (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); name.blur(); }
        if (ev.key === "Escape") { name.value = g.name; name.blur(); }
      };

      const cnt = document.createElement("span");
      cnt.className = "rkadm-count";
      cnt.textContent = (g.members || []).length + " 国";

      const pick = document.createElement("button");
      pick.type = "button"; pick.className = "rkadm-icon"; pick.textContent = "☑";
      pick.title = "选择该地区包含哪些国家";
      const del = document.createElement("button");
      del.type = "button"; del.className = "rkadm-icon rkadm-icon--del"; del.textContent = "✕"; del.title = "删除地区";
      del.onclick = async () => {
        if (!confirm("删除地区「" + g.name + "」？\n（仅删除这个分组，各国家的数据与站点清单都不受影响）")) return;
        rankGroups.splice(gi, 1);
        await saveRankGroups("已删除地区");
      };

      row.appendChild(name); row.appendChild(cnt); row.appendChild(pick); row.appendChild(del);

      /* 成员勾选面板（默认收起，点 ☑ 展开） */
      const mem = document.createElement("div");
      mem.className = "rkadm-members";
      mem.style.display = "none";
      if (!rankSites.length) {
        mem.innerHTML = '<span class="hint">（先在上方添加国家站点）</span>';
      } else {
        rankSites.forEach((s) => {
          const l = document.createElement("label");
          l.className = "chk";
          l.innerHTML = '<input type="checkbox" value="' + escAttr(s.name) + '"> ' + escHtml(s.name);
          const cb = l.querySelector("input");
          cb.checked = (g.members || []).indexOf(s.name) >= 0;
          cb.addEventListener("change", () => {
            const m = rankGroups[gi].members || (rankGroups[gi].members = []);
            const i = m.indexOf(s.name);
            if (cb.checked) { if (i < 0) m.push(s.name); } else if (i >= 0) m.splice(i, 1);
            cnt.textContent = rankGroups[gi].members.length + " 国";
            saveRankGroups();
          });
          mem.appendChild(l);
        });
      }
      pick.onclick = () => { mem.style.display = mem.style.display === "none" ? "flex" : "none"; };

      wrap.appendChild(row);
      wrap.appendChild(mem);
      box.appendChild(wrap);
    });
  }

  function renderRankSiteDefaults() {
    const box = $("#rm-site-defaults");
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
      const cb = l.querySelector('input');
      if (cb) cb.addEventListener("change", () => { if (rankParsed) renderRankPreview(); });
      box.appendChild(l);
    });
  }

  /* ---------- 类目下拉（复用「类目管理」，可自定义添加） ---------- */
  async function loadRankCats() {
    try { rankCats = await SB.listActiveCats(); } catch (e) { rankCats = []; }
    const sel = $("#rm-cat");
    if (!sel) return;
    const keep = sel.value;
    const CATS = window.CAT_SEARCH;
    let favs = [];
    try { favs = await SB.myFavCats(); } catch (e) { favs = []; }
    const ordered = CATS ? CATS.sortCats(rankCats, favs) : rankCats.map(n => ({ name: n, fav: false }));
    sel.innerHTML = '<option value="">请选择类目…</option>' +
      ordered.map(o => '<option value="' + escAttr(o.name) + '">' + (o.fav ? "★ " : "") + escHtml(o.name) + '</option>').join("");
    if (keep && rankCats.indexOf(keep) >= 0) sel.value = keep;
    // 类目很多时先搜再选；搜索只隐藏不匹配项，不动已选中的值
    if (CATS) {
      CATS.mountBox(sel, "cat-search-rank", "搜索类目…", (v) => { CATS.kw("rank", v); CATS.filterSelect(sel, v); });
      CATS.filterSelect(sel, CATS.kw("rank"));
    }
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

  /* 取单元格里真正的图片链接。
     很多整理表把「首图URL」列做成了超链接：单元格显示的是「查看首图」这类文字，
     真正的网址藏在超链接里（或 =HYPERLINK("网址","查看首图") 公式里）。
     只读显示文字就只会拿到「查看首图」，整列变成同一个值 → 导入时被当成重复数据全部跳过。 */
  function pickUrlFromCell(cell) {
    if (!cell) return "";
    let t = "";
    if (cell.l) {
      t = (typeof cell.l === "string") ? cell.l : (cell.l.Target || cell.l.target || "");
    } else if (cell.hyperlink) {
      t = String(cell.hyperlink);
    }
    if (!t && cell.f) {
      const m = String(cell.f).match(/HYPERLINK\(\s*"([^"]+)"/i) || String(cell.f).match(/HYPERLINK\(\s*'([^']+)'/i);
      if (m) t = m[1];
    }
    t = String(t || "").trim();
    if (t && !/^(javascript|mailto|#)/i.test(t)) return t;
    const v = String(cell.w != null ? cell.w : (cell.v != null ? cell.v : "")).trim();
    return /^https?:\/\//i.test(v) ? v : "";
  }
  const URL_PLACEHOLDER = /^(查看首图|首图|点击查看|查看图片|查看|view|open|link|图片)$/i;

  /* ---------- 解析文件 ---------- */
  async function onRankFileChange() {
    rankParsed = null;
    const btn = $("#rm-import");
    if (btn) btn.disabled = true;
    const tip = $("#rm-file-tip");
    const box = $("#rm-preview");
    if (box) box.innerHTML = "";
    const f = $("#rm-file").files && $("#rm-file").files[0];
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
      const rng = XLSX.utils.decode_range(ws["!ref"] || "A1");
      let noLink = 0, placeholderOnly = 0, resolvedFromLink = 0;
      for (let i = head.idx + 1; i < aoa.length; i++) {
        const c = aoa[i] || [];
        const ci = head.map.url;
        let url = "";
        if (ci >= 0) {
          const cell = ws[XLSX.utils.encode_cell({ r: rng.s.r + i, c: rng.s.c + ci })];
          url = pickUrlFromCell(cell);
          if (url) { resolvedFromLink++; }
          const shown = String(c[ci] || "").trim();
          if (!url && URL_PLACEHOLDER.test(shown)) placeholderOnly++;
        }
        if (!url) { noLink++; continue; }                   // 没图的行跳过
        rows.push({
          leaf_category: String(head.map.leaf >= 0 ? (c[head.map.leaf] || "") : "").trim(),
          site: String(head.map.site >= 0 ? (c[head.map.site] || "") : "").trim(),
          image_url: url,
          abs_delta: toNum(head.map.abs >= 0 ? c[head.map.abs] : null),
          ratio: toRatio(head.map.ratio >= 0 ? c[head.map.ratio] : null),
          hasSiteCol: head.map.site >= 0,
        });
      }
      // 同一张图重复出现 → 合并后只留一条（与入库去重口径一致），提前告知
      const urlSeen = {};
      rows.forEach(r => { urlSeen[r.image_url] = (urlSeen[r.image_url] || 0) + 1; });
      const dupUrls = Object.keys(urlSeen).filter(u => urlSeen[u] > 1).length;
      const missing = [];
      if (head.map.abs < 0) missing.push("环比绝对值");
      if (head.map.ratio < 0) missing.push("环比比例");
      if (head.map.site < 0) missing.push("销量站点（勾选上方站点即可）");
      const distinctSites = Object.keys(rows.reduce((m, r) => (r.site && (m[r.site] = 1), m), {}));
      const siteWarn = distinctSites.length > 1
        ? "⚠️ 表格里出现了 " + distinctSites.length + " 个站点（" + distinctSites.slice(0, 6).join("、") + (distinctSites.length > 6 ? "…" : "") + "）。若这是合计表（如欧盟），请在上方勾选目标站点，导入时会统一归入该站点。"
        : "";
      const urlWarn = (placeholderOnly > 0 && rows.length === 0)
        ? "❌ 「首图URL」列里放的是「查看首图」这类文字，没有真实网址（网址没有做成可点击的超链接）。请在表格里把该列改成纯网址（https://… 文本），或给单元格加上超链接后再上传。"
        : (noLink > 0
          ? "⚠️ 有 " + noLink + " 行没读到图片网址，已跳过（这些行的「首图URL」既不是网址、也没有超链接）。"
          : "");
      rankParsed = { rows, headers: aoa[head.idx] || [], missing, siteWarn, urlWarn, dupUrls, resolvedFromLink, fileName: f.name };
      renderRankPreview();
    } catch (e) {
      if (tip) tip.textContent = "❌ 解析失败：请确认是有效的 Excel（.xlsx/.xls）文件";
    }
  }

  function renderRankPreview() {
    const tip = $("#rm-file-tip");
    const box = $("#rm-preview");
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
        '<span>月度激增（双重提升前 ' + Math.round(RANK_SURGE_PCT * 100) + '%）：<b>' + surgeN + '</b></span>' +
        '</div>' +
        (rankParsed.missing.length ? '<div class="hint rank-warn">未识别到列：' + escHtml(rankParsed.missing.join("、")) + '</div>' : '') +
        (rankParsed.urlWarn ? '<div class="hint rank-warn">' + escHtml(rankParsed.urlWarn) + '</div>' : '') +
        (rankParsed.dupUrls ? '<div class="hint rank-warn">表格里有 ' + rankParsed.dupUrls + ' 张图重复出现，同一个地区下会合并为一条（保留环比更强的那条）。</div>' : '') +
        (rankParsed.siteWarn ? '<div class="hint rank-warn">' + escHtml(rankParsed.siteWarn) + '</div>' : '') +
        '<div class="hint">站点归属：<b>' + (document.querySelectorAll('#rm-site-defaults input[type="checkbox"]:checked').length ? "以「国家站点」勾选的为准 —— 整张表都算这个地区，表格里的「销量站点」列不生效" : "未勾选站点 → 按表格「销量站点」列逐行取（合计表请务必先勾选，如欧盟）") + '</b>；标签按「站点 + 期次 + 类目」分池计算（每个国家各自排名）。</div>';
    }
    const btn = $("#rm-import");
    if (btn) btn.disabled = rows.length === 0;
  }

  /* ---------- 期次选择（周度/月度 + 日历） ---------- */
  /* 本面板只处理月度期次（上新节奏）；周度仍由「上新节奏」面板负责 */
  function rankPeriodMode() { return "month"; }

  /* 月度专版：期次标签就是月份输入框的值（没有"选周日历"这套） */
  function syncRankPeriodLabel() {
    const lab = $("#rm-period-label");
    if (!lab) return "";
    const mv = $("#rm-period-month") ? $("#rm-period-month").value : "";
    lab.value = mv || "";
    return lab.value;
  }
  function initRankPeriodPickers() {
    const now = new Date();
    const pad = (n) => (n < 10 ? "0" : "") + n;
    const iso = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    const mEl = $("#rm-period-month");
    if (mEl && !mEl.value) mEl.value = iso.slice(0, 7);
    if (mEl && mEl.addEventListener) mEl.addEventListener("change", syncRankPeriodLabel);
    syncRankPeriodLabel();
  }

  /* ---------- 导入 ---------- */
  /* 计算「本次上传要写入的行」：站点归属展开 + 表内同一张图合并。
     纯函数（不碰页面、不发请求），便于拿真实表格做验证。
       - 勾选了站点（useMine）→ 每一行都归入勾选的站点，忽略表格里「销量站点」列的值
       - 未勾选 → 按表格里每行自带的「销量站点」取值
       - 同一站点内同一张图重复出现 → 只保留一条（mergedInFile 记录合并掉的条数） */
  function buildRankImportRows(rows, opt) {
    const o = opt || {};
    const periodType = o.periodType || "month";
    const periodLabel = o.periodLabel || "";
    const category = o.category || "";
    const sites = o.sites || [];
    const useMine = !!o.useMine && sites.length > 0;
    const out = [];
    const tableSites = {};
    let noSite = 0;
    (rows || []).forEach(r => {
      const targets = useMine ? sites : (r.site ? [r.site] : []);
      if (!targets.length) { noSite++; return; }
      if (useMine && r.site && sites.indexOf(r.site) < 0) tableSites[r.site] = 1;
      targets.forEach(s => {
        out.push({
          period_type: periodType,
          period_label: periodLabel,
          category: category,
          site: s,
          leaf_category: r.leaf_category,
          image_url: r.image_url,
          ratio: r.ratio,
          abs_delta: r.abs_delta,
        });
      });
    });
    const seen = {};
    const list = [];
    let mergedInFile = 0;
    out.forEach(r => {
      const k = r.site + "\u0000" + r.image_url;
      if (seen[k]) { mergedInFile++; return; }
      seen[k] = 1;
      list.push(r);
    });
    return {
      rows: list,
      mergedInFile: mergedInFile,
      noSite: noSite,
      tableSites: tableSites,
      slotSites: Object.keys(list.reduce((m, r) => (m[r.site] = 1, m), {})),
    };
  }

  /* 追加导入用：剔除库里已存在的图，只补新的 */
  function filterNotExisting(rows, existingUrls) {
    const has = {};
    (existingUrls || []).forEach(u => { if (u) has[u] = 1; });
    const list = [];
    let skipped = 0;
    (rows || []).forEach(r => { if (has[r.image_url]) { skipped++; return; } list.push(r); });
    return { rows: list, skipped: skipped };
  }

  async function doRankImport() {
    if (!rankParsed || !rankParsed.rows.length) { sbToast("请先上传并解析 Excel", false); return; }
    /* 本面板只写月度数据：不取单选框，直接锁死 month */
    const periodType = "month";
    const periodLabel = ($("#rm-period-label").value || "").trim();
    const category = ($("#rm-cat").value || "").trim();
    if (!periodLabel) { sbToast(periodType === "month" ? "请先用日历选择月份" : "请先用日历选择某一周", false); return; }
    if (!category) { sbToast("请选择类目", false); return; }
    const defaults = [...document.querySelectorAll('#rm-site-defaults input[type="checkbox"]:checked')].map(c => c.value);

    /* 安全网：整批网址全都一样，说明「首图URL」列里的不是真网址（例如整列都写着「查看首图」）。
       这种情况直接拦下并说清原因，避免导入后只进去一条、看起来像"识别不出来"。 */
    const uniqUrl = Object.keys(rankParsed.rows.reduce((m, r) => (m[r.image_url] = 1, m), {})).length;
    if (rankParsed.rows.length > 1 && uniqUrl === 1) {
      sbToast("「首图URL」列里 200 行都是同一个内容（不是图片网址），无法导入。请把该列改成真实网址文本、或给单元格加超链接后再上传。", false);
      return;
    }

    /* 站点归属：以「我定义的站点」为准。
       勾选了任何站点 → 全部行都归入我勾的站点（忽略表格里「销量站点」列的逐行取值，
       这样欧盟这类合计表里写满各国名字时，前台就只出现「欧盟」一个地区）。
       一个都没勾 → 才退回按表格里每行自带的「销量站点」取值。 */
    const useMine = defaults.length > 0;
    const built = buildRankImportRows(rankParsed.rows, {
      periodType: periodType, periodLabel: periodLabel, category: category, sites: defaults, useMine: useMine,
    });
    if (!built.rows.length) {
      sbToast(built.noSite ? "表格没有「销量站点」列，且未选择默认站点" : "没有可导入的有效行", false);
      return;
    }
    const rowsOut = built.rows;
    const mergedInFile = built.mergedInFile;
    const ignoredList = Object.keys(built.tableSites);
    const slotSites = built.slotSites;
    const batchSite = useMine ? defaults.join(",") : slotSites.join(",");
    computeFlags(rowsOut);

    const mode = (document.querySelector('input[name="rm-mode"]:checked') || {}).value === "append" ? "append" : "replace";
    const btn = $("#rm-import");
    if (btn) { btn.disabled = true; btn.textContent = "导入中…"; }
    try {
      const slot = { periodType: periodType, periodLabel: periodLabel, category: category, sites: slotSites };
      let cleared = { items: 0, batches: 0 };
      let skippedExisting = 0;
      let list = rowsOut;

      if (mode === "replace") {
        // 覆盖：先清掉「本期次 · 本类目 · 本次站点」下的旧数据，再整表写入 → 不与以往上传查重
        cleared = await SB.clearRankSlot(slot);
      } else {
        // 追加：保留旧数据，只补库里还没有的图
        const exist = await SB.listRankSlotUrls(slot);
        const f = filterNotExisting(rowsOut, exist);
        list = f.rows;
        skippedExisting = f.skipped;
      }

      const batchId = await SB.createRankBatch({ periodType: periodType, periodLabel: periodLabel, category: category, site: batchSite });
      const rows = list.map(r => {
        const o = Object.assign({}, r, { batch_id: batchId });
        o.flag_opportunity = !!r.flag_opportunity;
        o.flag_hot = !!r.flag_hot;
        o.flag_surge = !!r.flag_surge;
        o.rank_ratio = r.rank_ratio || null;
        o.rank_abs = r.rank_abs || null;
        return o;
      });
      const res = rows.length ? await SB.insertRankItems(rows) : { inserted: 0 };
      const inserted = (res && res.inserted) || 0;
      try { await SB.updateRankBatch(batchId, { rows: inserted, skipped: skippedExisting + mergedInFile }); } catch (e) { /* 统计失败不影响数据 */ }

      if (rows.length > 0 && inserted === 0) {
        /* 安全网：一条都没写进去，必须说清楚，不能静默 */
        sbToast("导入失败：0 条写入（有效行 " + rowsOut.length + " 条）。请刷新页面后重试；若仍为 0，请把这张表发给开发者排查。", false);
      } else {
        sbToast("导入完成：" + (useMine ? "已按我定义的站点归入「" + defaults.join("、") + "」" : "已按表格站点列归入")
          + "，写入 " + inserted + " 条"
          + (mode === "replace" && cleared.items > 0 ? "（已替换该期次该类目下的旧数据 " + cleared.items + " 条）" : "")
          + (mode === "append" && skippedExisting > 0 ? "（库里已存在的 " + skippedExisting + " 条未重复写入）" : "")
          + (mergedInFile > 0 ? "（表格里同一张图重复 " + mergedInFile + " 次，已合并为 1 条）" : "")
          + (ignoredList.length ? "（已忽略表格里的 " + ignoredList.length + " 个站点取值：" + ignoredList.slice(0, 4).join("、") + (ignoredList.length > 4 ? "…" : "") + "）" : ""), true);
      }
      rankParsed = null;
      $("#rm-file").value = "";
      $("#rm-file-tip").textContent = "";
      $("#rm-preview").innerHTML = "";
      await loadRankBatches();
    } catch (e) {
      sbToast("导入失败：" + ((e && e.message) || "请重试"), false);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "导入榜单"; }
    }
  }

  /* ---------- 已上传记录：条数口径 ----------
     条数一律按「期次 + 类目 + 站点」这个槽位向数据库精确计数。
     不采用「一次性把全表拉回来自己在浏览器里数」的做法：接口单次返回有上限，
     榜单数据一多就被截断，于是上传记录显示的条数会凭空变少（几个/几十个），
     而前台是按槽位分次查的、看到的是完整的 200 条 —— 两边就会对不上。
     精确计数失败时退回批次自带条数，绝不当成 0。 */
  function batchSites(b) {
    return String((b && b.site) || "").split(",").map(s => s.trim()).filter(Boolean);
  }
  function batchSlotKey(b) {
    return [(b && b.period_type) || "week", (b && b.period_label) || "", (b && b.category) || "",
      batchSites(b).slice().sort().join("|")].join("\u0001");
  }
  function batchPeriodKey(b) {
    return ((b && b.period_type) || "week") + "\u0001" + ((b && b.period_label) || "");
  }
  /* 算出「每个槽位」与「每个期次」的真实条数（去重后各查一次，避免重复请求） */
  async function computeRankCounts(list, opt) {
    const countFn = (opt && opt.countFn) || ((o) => SB.countRankSlot(o));
    const bySlot = {}, byPeriod = {};
    const slotDone = {}, periodDone = {};
    for (const b of (list || [])) {
      const sk = batchSlotKey(b);
      if (!slotDone[sk]) {
        slotDone[sk] = true;
        let n = null;
        try {
          n = await countFn({
            periodType: b.period_type || "week", periodLabel: b.period_label || "",
            category: b.category || "", sites: batchSites(b),
          });
        } catch (e) { n = null; }
        bySlot[sk] = (typeof n === "number" && isFinite(n)) ? n : null;
      }
      const pk = batchPeriodKey(b);
      if (!periodDone[pk]) {
        periodDone[pk] = true;
        let n = null;
        try {
          n = await countFn({
            periodType: b.period_type || "week", periodLabel: b.period_label || "",
            category: "", sites: [],
          });
        } catch (e) { n = null; }
        byPeriod[pk] = (typeof n === "number" && isFinite(n)) ? n : null;
      }
    }
    return { bySlot: bySlot, byPeriod: byPeriod };
  }

  /* ---------- 已上传记录 ---------- */
  async function loadRankBatches() {
    const box = $("#rm-batch-list");
    let list = [];
    try { list = await SB.listRankBatches(); } catch (e) { list = []; }
    /* 只保留月度期次：周度批次归「上新节奏」面板管，不能混进这里的期次清单 */
    list = (list || []).filter((b) => ((b && b.period_type) || "week") === "month");

    const counts = await computeRankCounts(list);
    const fallback = (b) => (typeof b.rows === "number" ? b.rows : 0);
    /* 条数：精确计数优先；拿不到才退回批次自带条数（标 ≈，不装作准确） */
    const cntOf = (b) => {
      const v = counts.bySlot[batchSlotKey(b)];
      return (v == null) ? fallback(b) : v;
    };
    const cntApprox = (b) => (counts.bySlot[batchSlotKey(b)] == null);

    // 聚合出「期次」清单（用于期次管理）
    const map = {};
    list.forEach((b) => {
      const k = b.period_type + "|" + b.period_label;
      if (!map[k]) map[k] = { label: b.period_label, type: b.period_type, rows: 0, batches: 0, approx: false };
      map[k].batches += 1;
    });
    Object.keys(map).forEach((k) => {
      const p = map[k];
      const exact = counts.byPeriod[batchPeriodKey({ period_type: p.type, period_label: p.label })];
      if (exact == null) {
        p.rows = list.filter(b => b.period_type === p.type && b.period_label === p.label).reduce((s, b) => s + cntOf(b), 0);
        p.approx = true;
      } else { p.rows = exact; }
    });
    rankPeriods = Object.keys(map).map((k) => map[k]).sort((a, b) => admPeriodKey(a.label) - admPeriodKey(b.label));
    renderRankPeriods();
    fillRankPvControls();
    loadRankPrintSwitch();          /* 图案印花款开关：每次进面板按库里最新值渲染 */

    if (!box) return;
    if (!list.length) { box.innerHTML = '<div class="rkadm-empty">还没有上传记录</div>'; return; }
    box.innerHTML = "";
    list.forEach((b) => {
      const row = document.createElement("div");
      row.className = "rank-batch-row";

      const main = document.createElement("span");
      main.className = "rank-batch-main";
      main.textContent = (b.period_type === "month" ? "月度 " : "周度 ") + b.period_label + " · " + (b.category || "未填类目") + (b.site ? " · 站点 " + b.site : "") + " · " + (cntApprox(b) ? "≈" : "") + cntOf(b) + " 条" + (b.skipped ? "（跳过 " + b.skipped + "）" : "");

      const act = document.createElement("span");
      act.className = "rkadm-row-act";

      const ren = document.createElement("button");
      ren.type = "button"; ren.className = "btn-ghost small"; ren.textContent = "改期次名";
      ren.onclick = async () => {
        const v = (prompt("该批次所属期次改名（会同步该期次全部数据）：", b.period_label) || "").trim();
        if (!v || v === b.period_label) return;
        if (!confirm("把期次「" + b.period_label + "」改名为「" + v + "」？\n该期次全部数据会一起改名。")) return;
        try {
          const mv = await SB.updateRankPeriodData(b.period_label, b.period_type, v, b.period_type);
          await loadRankBatches(); rankPreviewRefresh();
          sbToast("期次已改名为「" + v + "」（迁移 " + mv + " 条）", true);
        } catch (e) { sbToast((e && e.message) || "改名失败", false); }
      };

      const del = document.createElement("button");
      del.type = "button"; del.className = "btn-ghost small rank-batch-del"; del.textContent = "删除";
      del.onclick = async () => {
        if (!confirm("删除该批次「" + b.period_label + " · " + b.category + "」及其全部条目？")) return;
        try { await SB.deleteRankBatch(b.id); await loadRankBatches(); rankPreviewRefresh(); sbToast("已删除该批次", true); }
        catch (e) { sbToast("删除失败", false); }
      };

      /* 设渠道（20261109D）：不直接改数据，只把上面的「批量补渠道」填好——
         改数据是批量动作，得让人先看到范围再确认，别点一下就动几百条。 */
      const setch = document.createElement("button");
      setch.type = "button"; setch.className = "btn-ghost small"; setch.textContent = "设渠道";
      setch.onclick = () => {
        const ms = $("#rm-fixch-month"), cs = $("#rm-fixch-cat"), chs = $("#rm-fixch-channel"), t = $("#rm-fixch-tip");
        if (ms) ms.value = b.period_label || "";
        if (cs) cs.value = b.category || "";
        if (chs) { try { chs.focus(); } catch (e) {} }
        if (t) t.textContent = "已带入：月度 " + (b.period_label || "") + (b.category ? " · " + b.category : " · 全部类目") + "，填好渠道名再点「补上渠道」";
        try { document.querySelector("#rm-fixch-channel").scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
      };

      act.appendChild(setch); act.appendChild(ren); act.appendChild(del);
      row.appendChild(main); row.appendChild(act);
      box.appendChild(row);
    });
  }

  /* ---------- 期次 / 周度频次管理 ---------- */
  function renderRankPeriods() {
    const box = $("#rm-period-list");
    if (!box) return;
    box.innerHTML = "";
    if (!rankPeriods.length) {
      box.innerHTML = '<div class="rkadm-empty">还没有期次。上传榜单表格后会自动生成（如 W41）。</div>';
      return;
    }
    rankPeriods.forEach((p) => {
      const row = document.createElement("div");
      row.className = "rkadm-row";

      const type = document.createElement("button");
      type.type = "button";
      type.className = "rkadm-badge";
      type.textContent = p.type === "month" ? "月度" : "周度";
      type.title = "点击切换：周度 ↔ 月度";
      type.onclick = async () => {
        const nt = p.type === "month" ? "week" : "month";
        if (!confirm("把期次「" + p.label + "」的频次改为「" + (nt === "month" ? "月度" : "周度") + "」？\n该期次全部数据会一起切换。")) return;
        try {
          await SB.updateRankPeriodData(p.label, p.type, p.label, nt);
          await loadRankBatches(); rankPreviewRefresh();
          sbToast("频次已切换", true);
        } catch (e) { sbToast((e && e.message) || "切换失败", false); }
      };

      const name = document.createElement("input");
      name.type = "text";
      name.className = "rkadm-name";
      name.value = p.label;
      name.title = "点一下即可改名（该期次全部数据一起改名）";
      name.addEventListener && name.addEventListener("focus", () => name.select());
      let renaming = false, committed = false;
      const commit = async () => {
        const v = (name.value || "").trim();
        if (!v || v === p.label) { name.value = p.label; return; }
        if (renaming || committed) return;
        if (!confirm("把期次「" + p.label + "」改名为「" + v + "」？\n该期次已上传的全部数据（" + p.rows + " 条）会一起改名。")) { name.value = p.label; return; }
        renaming = true;
        try {
          const mv = await SB.updateRankPeriodData(p.label, p.type, v, p.type);
          committed = true;
          await loadRankBatches(); rankPreviewRefresh();
          sbToast("期次已改名为「" + v + "」（迁移 " + mv + " 条）", true);
        } catch (e) { name.value = p.label; sbToast((e && e.message) || "改名失败", false); }
        finally { renaming = false; }
      };
      name.onblur = commit;
      name.onkeydown = (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); name.blur(); }
        if (ev.key === "Escape") { name.value = p.label; committed = true; name.blur(); committed = false; }
      };

      const cnt = document.createElement("span");
      cnt.className = "rkadm-count";
      cnt.textContent = p.rows + " 条 · " + p.batches + " 批";

      const del = document.createElement("button");
      del.type = "button"; del.className = "rkadm-icon rkadm-icon--del"; del.textContent = "✕"; del.title = "删除整个期次";
      del.onclick = async () => {
        if (!confirm("删除整个期次「" + p.label + "」及其全部数据（" + p.rows + " 条）？此操作不可恢复。")) return;
        try { await SB.deleteRankPeriod(p.label, p.type); await loadRankBatches(); rankPreviewRefresh(); sbToast("已删除该期次", true); }
        catch (e) { sbToast((e && e.message) || "删除失败", false); }
      };

      row.appendChild(type); row.appendChild(name); row.appendChild(rankEyeBtn("periods", p.label)); row.appendChild(cnt); row.appendChild(del);
      box.appendChild(row);
    });
  }

  /* ---------- 实时预览（所见即所得） ---------- */
  function rankPreviewUrl() {
    const q = [];
    if (rankPv.cat) q.push("cat=" + encodeURIComponent(rankPv.cat));
    if (rankPv.site && rankPv.site.indexOf("g:") === 0) q.push("group=" + encodeURIComponent(rankPv.site.slice(2)));
    else if (rankPv.site) q.push("sites=" + encodeURIComponent(rankPv.site));
    if (rankPv.period) q.push("periods=" + encodeURIComponent(rankPv.period));
    q.push("mode=" + rankPv.mode);
    q.push("size=" + rankPv.size);
    return "rhythm.html?" + q.join("&");
  }
  function rankPreviewRefresh() {
    const f = $("#rmadm-pv-frame");
    const hint = $("#rmadm-pv-hint");
    if (!f) return;
    f.src = rankPreviewUrl();
    if (hint) hint.textContent = "正在预览：" + (rankPv.cat || "全部类目") + " · " + ((rankPv.site || "").replace(/^g:/, "地区 · ") || "全部站点") + " · " + (rankPv.period || "最新期次") + " · " + (rankPv.mode === "v" ? "纵向时间对比" : (rankPv.mode === "c" ? "横向类目对比" : "横向国家对比"));
  }
  function fillRankPvControls() {
    const mk = (sel, list, cur, allLabel) => {
      if (!sel) return;
      const keep = cur || sel.value;
      sel.innerHTML = '<option value="">' + allLabel + '</option>' + list.map((v) => '<option value="' + escAttr(v) + '">' + escHtml(v) + '</option>').join("");
      if (keep && list.indexOf(keep) >= 0) sel.value = keep; else sel.value = "";
      return sel.value;
    };
    rankPv.cat = mk($("#rmadm-pv-cat"), rankCats, rankPv.cat, "全部类目") || "";
    /* 已在前台隐藏的站点 / 周次不进预览下拉：预览即前台所见 */
    const pvSites = rankSites.map((s) => s.name).filter((n) => !rankHiddenOn("sites", n));
    const pvPeriods = rankPeriods.map((p) => p.label).filter((n) => !rankHiddenOn("periods", n));
    rankPv.site = mk($("#rmadm-pv-site"), pvSites, rankPv.site, "全部站点") || "";
    /* 地区分组也进预览下拉：选「地区 · 欧洲」= 整区对比 */
    const siteSel = $("#rmadm-pv-site");
    if (siteSel) {
      const keep = rankPv.site || siteSel.value;
      if (rankGroups.filter((g) => g.name).length) {
        let html = '<option value="">全部站点</option>';
        rankGroups.filter((g) => g.name).forEach((g) => { html += '<option value="g:' + escAttr(g.name) + '">地区 · ' + escHtml(g.name) + '</option>'; });
        pvSites.forEach((n) => { html += '<option value="' + escAttr(n) + '">' + escHtml(n) + '</option>'; });
        siteSel.innerHTML = html;
        siteSel.value = (keep && Array.prototype.some.call(siteSel.options, (o) => o.value === keep)) ? keep : "";
        rankPv.site = siteSel.value;
      }
    }
    rankPv.period = mk($("#rmadm-pv-period"), pvPeriods, rankPv.period, "自动（最新）") || "";
    if (!rankPv.period && pvPeriods.length) rankPv.period = pvPeriods[0];
    const ps = $("#rmadm-pv-period");
    if (ps && rankPv.period) ps.value = rankPv.period;
  }

  /* ---------- 面板进入 ---------- */  /* ---------- 面板进入 ---------- */
  async function enterRhythmPanel() {
    initRankPeriodPickers();
    await Promise.all([loadRankHidden(), loadRankSites(), loadRankCats(), loadRankBatches(), loadRankGroups(), loadRankPrintSwitch()]);
    /* 打标相关（20261027J）：导出范围里的类目下拉 + 批次台账 */
    /* 导出下拉增强：补上「叶子类目」一组，并给每个类目标上图数；
       同时渲染类目分布表。取不到就保留上面用配置表铺的基础选项，不影响导出。 */
    if (!rankPv.cat && rankCats.length) rankPv.cat = rankCats[0];
    if (!rankPv.site && rankSites.length) rankPv.site = rankSites[0].name;
    fillRankPvControls();
    rankPreviewRefresh();
    /* 其他渠道传图：渠道清单 / 类目下拉 / 已传列表（和榜单数据互不影响） */
    await loadChChannels();
    fillChCatSelects();
    await fillTagExportSelects();
    await loadChList();
  }

  /* ---------- 事件绑定（script 顺序保证本文件在 admin.js 之后加载） ---------- */
  function bindRhythmPanel() {
    /* 守卫用真面板 id：写错了整个面板都不会绑事件（列表一直"正在读取…"） */
    if (!$("#rhythm-card")) return;

    const siteAdd = $("#rm-site-add");
    if (siteAdd) siteAdd.onclick = async () => {
      const v = ($("#rm-site-new").value || "").trim();
      if (!v) { sbToast("请输入站点名", false); return; }
      try {
        await SB.addRankSite(v);
        $("#rm-site-new").value = "";
        await loadRankSites(); await loadRankBatches(); rankPreviewRefresh();
        sbToast("已添加站点「" + v + "」", true);
      } catch (e) { sbToast((e && e.message) || "添加失败", false); }
    };
    const siteNew = $("#rm-site-new");
    if (siteNew) siteNew.onkeydown = (ev) => { if (ev.key === "Enter" && siteAdd) siteAdd.click(); };

    const groupAdd = $("#rm-group-add");
    if (groupAdd) groupAdd.onclick = async () => {
      const inp = $("#rm-group-new");
      const v = ((inp && inp.value) || "").trim();
      if (!v) { sbToast("请输入地区名", false); return; }
      if (rankGroups.some((g) => g.name === v)) { sbToast("已有同名地区", false); return; }
      rankGroups.push({ name: v, members: [] });
      if (inp) inp.value = "";
      await saveRankGroups("已添加地区「" + v + "」，点 ☑ 勾选包含哪些国家");
    };
    const groupNew = $("#rm-group-new");
    if (groupNew) groupNew.onkeydown = (ev) => { if (ev.key === "Enter" && groupAdd) groupAdd.click(); };

    const catAdd = $("#rm-cat-add");
    if (catAdd) catAdd.onclick = async () => {
      const v = (prompt("输入新类目名称（将同步到「标签管理 → 前台类目」）：") || "").trim();
      if (!v) return;
      try {
        await SB.addCategory(v);
        await loadRankCats(); fillRankPvControls();
        const sel = $("#rm-cat");
        if (sel) sel.value = v;
        sbToast("已新增类目「" + v + "」", true);
      } catch (e) { sbToast((e && e.message) || "新增类目失败", false); }
    };

    const file = $("#rm-file");
    if (file) file.onchange = onRankFileChange;
    const imp = $("#rm-import");
    if (imp) imp.onclick = doRankImport;

    // 预览参数
    const bindPv = (sel, key) => {
      const el = $(sel);
      if (!el) return;
      el.onchange = () => { rankPv[key] = el.value; rankPreviewRefresh(); };
    };
    bindPv("#rmadm-pv-cat", "cat");
    bindPv("#rmadm-pv-site", "site");
    bindPv("#rmadm-pv-period", "period");
    bindPv("#rmadm-pv-mode", "mode");
    bindPv("#rmadm-pv-size", "size");

    const reload = $("#rmadm-pv-reload");
    if (reload) reload.onclick = () => rankPreviewRefresh();
    const full = $("#rmadm-pv-full");
    if (full) full.onclick = () => { const f = $("#rmadm-pv-frame"); if (f && f.requestFullscreen) f.requestFullscreen(); };
    const openFront = $("#rmadm-open-front");
    if (openFront) openFront.onclick = () => window.open(rankPreviewUrl(), "_blank");
    const refresh = $("#rmadm-refresh");
    if (refresh) refresh.onclick = async () => { await enterRhythmPanel(); sbToast("已刷新", true); };
  }

  /* ============================================================
   * 其他渠道传图（20261109A）
   * ------------------------------------------------------------
   * 这些渠道（Pinterest / SHEIN / 淘宝…）只有图：没有环比、没有销量、
   * 也没有国家归属。写入 rank_items 时 channel 非空、site 留空，
   * 因此它们只出现在前台的「横向 · 渠道对比」，不会混进国家 / 时间 / 类目对比，
   * 也不会被「覆盖导入」清掉（覆盖只清站点维度的榜单数据）。
   * ============================================================ */
  let rmChPending = [];      // 待传：[{file}]
  let rmChList = [];         // 已传：最近 400 条

  function rmChMonth() {
    const el = $("#rm-ch-month");
    return (el && el.value || "").trim();
  }
  function rmChSetMsg(txt, ok) {
    const el = $("#rm-ch-msg");
    if (el) el.textContent = txt || "";
    if (txt && ok === false) sbToast(txt, false);
  }

  /* 渠道候选（20261109E）：字典（默认 Pinterest / SHEIN / Amazon，可增删）∪ 历史用过的名字。
     下拉只是"候选"，真正的列由数据决定 —— 没有图的渠道前台不会出现空列。 */
  async function loadChChannels() {
    /* 先走一遍 refreshChDict：首次会把默认三个渠道灌进字典，同时铺好候选 datalist */
    let names = [];
    try { names = await refreshChDict(); } catch (e) { names = []; }
    const fsel = $("#rm-ch-filter-ch");
    if (fsel) {
      const keep = fsel.value;
      fsel.innerHTML = '<option value="">全部渠道</option>' +
        names.map((n) => '<option value="' + escAttr(n) + '">' + escHtml(n) + '</option>').join("");
      if (keep && names.indexOf(keep) >= 0) fsel.value = keep;
    }
    return names;
  }

  /* 「已配置渠道」小标签，每个带一个 × */
  function renderChDict() {
    const box = $("#rm-ch-dict");
    if (!box) return;
    const dict = rmChDict || [];
    if (!dict.length) { box.innerHTML = '<span class="hint-inline">（还没有渠道，点右边「新增渠道」）</span>'; return; }
    box.innerHTML = dict.map((n) =>
      '<span class="rk-ch-chip">' + escHtml(n) +
      '<button type="button" class="rk-ch-del" data-ch="' + escAttr(n) + '" title="从候选里删掉（不影响已传的图）">×</button></span>'
    ).join("");
    Array.prototype.forEach.call(box.querySelectorAll(".rk-ch-del"), (b) => {
      b.onclick = async () => {
        const name = b.getAttribute("data-ch") || "";
        if (!name) return;
        if (!confirm("从候选里删掉渠道「" + name + "」？\n已传的图不受影响，仍归在「" + name + "」下。")) return;
        try {
          await SB.deleteRankChannel(name);
          await refreshChDict();
          sbToast("已删除渠道「" + name + "」", true);
        } catch (e) { sbToast((e && e.message) || "删除失败", false); }
      };
    });
  }

  /* 重读字典（默认值只在第一次灌，删掉后不会自己回来） */
  async function refreshChDict() {
    try { rmChDict = await SB.ensureRankChannelDefaults(); } catch (e) { rmChDict = []; }
    renderChDict();
    const dl = $("#rm-ch-channel-list");
    let names = rmChDict.slice();
    try {
      const used = await SB.listRankChannelNames();
      used.forEach((n) => { if (n && names.indexOf(n) < 0) names.push(n); });
    } catch (e) { /* 忽略 */ }
    if (dl) dl.innerHTML = names.map((n) => '<option value="' + escAttr(n) + '"></option>').join("");
    return names;
  }

  /* 月度打标表导出区（20261109C）：类目 / 来源两个下拉，进面板时按库里实际有的值铺一遍 */
  async function fillTagExportSelects() {
    /* 期次（月份）下拉：只列库里真有月度数据的月份，新的在前 */
    const per = $("#rm-tag-period");
    if (per) {
      const keep = per.value;
      const months = (rankPeriods || [])
        .filter((p) => p && p.type === "month" && p.label)
        .map((p) => String(p.label))
        .sort((a, b) => admPeriodKey(b) - admPeriodKey(a));
      per.innerHTML = '<option value="">全部月份</option>' +
        months.map((m) => '<option value="' + escAttr(m) + '">' + escHtml(m) + '</option>').join("");
      if (keep && months.indexOf(keep) >= 0) per.value = keep;
    }
    const cat = $("#rm-tag-cat");
    if (cat) {
      const keep = cat.value;
      cat.innerHTML = '<option value="">全部类目</option>' +
        (rankCats || []).map((n) => '<option value="' + escAttr(n) + '">' + escHtml(n) + '</option>').join("");
      if (keep && (rankCats || []).indexOf(keep) >= 0) cat.value = keep;
    }
    const ch = $("#rm-tag-channel");
    if (ch) {
      const keepCh = ch.value;
      let names = [];
      try { names = await SB.listRankChannelNames(); } catch (e) { names = []; }
      ch.innerHTML = '<option value="">全部（榜单图 + 所有渠道）</option>'
        + '<option value="__rank">仅榜单表格导入的图</option>'
        + '<option value="__chonly">仅其他渠道传的图</option>'
        + names.map((n) => '<option value="ch:' + escAttr(n) + '">仅渠道：' + escHtml(n) + '</option>').join("");
      if (keepCh && Array.prototype.some.call(ch.options, (o) => o.value === keepCh)) ch.value = keepCh;
    }
  }

  /* 统一出口：月度面板里的两处导出都走这里，永远只导月度数据 */
  function runMonthTagExport(btn, o) {
    const tip = $("#rm-tag-export-tip");
    if (!window.RankExport || !window.RankExport.all) {
      sbToast("导出组件未加载，请刷新页面后再试", false);
      return;
    }
    const say = (t) => { if (tip) tip.textContent = t || ""; };
    say("正在读取月度数据…");
    /* 期次（月份）：选了就只导这一个月，数据量小、也不会被单次读取上限碰到 */
    const perSel = $("#rm-tag-period");
    const opts = Object.assign({
      scope: "todo", category: "", keyword: "", channel: "", period: "",
      periodType: "month", title: "上新节奏", tipSelector: "#rm-tag-export-tip",
    }, { period: (perSel && perSel.value) || "" }, o || {});
    Promise.resolve(window.RankExport.all(btn, opts)).then((r) => {
      if (r && r.ok) {
        say("已导出 " + (r.images || 0) + " 张图，文件名「" + (r.filename || "") + "」");
      } else if (r && r.reason === "nothing" && r.stats) {
        say("按当前范围没有可导出的图（月度共 " + r.stats.total + " 张：未打标 " + r.stats.todo
          + " / 部分 " + r.stats.partial + " / 已打标 " + r.stats.done + "）");
      } else if (r && r.reason === "empty") {
        say("库里还没有月度图，先上传或传渠道图");
      } else {
        say("导出失败，请重试");
      }
    }, () => { say("导出失败，请重试"); });
  }

  function fillChCatSelects() {
    const sel = $("#rm-ch-cat");
    if (sel && !sel.options.length) {
      sel.innerHTML = '<option value="">请选择类目…</option>' +
        (rankCats || []).map((n) => '<option value="' + escAttr(n) + '">' + escHtml(n) + '</option>').join("");
    }
    const fsel = $("#rm-ch-filter-cat");
    if (fsel) {
      const keep = fsel.value;
      fsel.innerHTML = '<option value="">全部类目</option>' +
        (rankCats || []).map((n) => '<option value="' + escAttr(n) + '">' + escHtml(n) + '</option>').join("");
      if (keep && (rankCats || []).indexOf(keep) >= 0) fsel.value = keep;
    }
    /* 类目下拉跟榜单上传保持同一偏好：默认选当前榜单类目，省得两边不一致 */
    if (sel && !sel.value) {
      const c = ($("#rm-cat") && $("#rm-cat").value || "").trim();
      if (c) sel.value = c;
    }
    /* 批量补渠道的类目 / 月份下拉（20261109D） */
    const fcat = $("#rm-fixch-cat");
    if (fcat) {
      const keepc = fcat.value;
      fcat.innerHTML = '<option value="">全部类目</option>' +
        (rankCats || []).map((n) => '<option value="' + escAttr(n) + '">' + escHtml(n) + '</option>').join("");
      if (keepc && (rankCats || []).indexOf(keepc) >= 0) fcat.value = keepc;
    }
    fillFixChMonths();
    /* 顺带拉一次库里真实存在的月份：老数据没有批次记录时，月份下拉也选得到 */
    if (!itemMonths.length && typeof SB.listRankLabels === "function") {
      SB.listRankLabels("month").then((ms) => {
        itemMonths = (ms || []).slice();
        fillFixChMonths();
      }).catch(() => {});
    }
  }

  /* 月份下拉：只列库里真正有月度数据的月份（周度不会混进来）。
     合并两个来源：批次台账 + 条目里实际出现的月份 —— 老数据没有批次记录也能选到。 */
  function fillFixChMonths() {
    const sel = $("#rm-fixch-month");
    if (!sel) return;
    const keep = sel.value;
    const bag = {};
    (rankPeriods || []).forEach((p) => { if (p && p.type === "month" && p.label) bag[String(p.label)] = 1; });
    (itemMonths || []).forEach((m) => { if (m) bag[String(m)] = 1; });
    const months = Object.keys(bag).sort((a, b) => admPeriodKey(b) - admPeriodKey(a));
    sel.innerHTML = months.map((m) => '<option value="' + escAttr(m) + '">' + escHtml(m) + '</option>').join("")
      || '<option value="">（库里还没有月度数据）</option>';
    if (keep && months.indexOf(keep) >= 0) sel.value = keep;
  }

  /* 读「批量补渠道」表单 */
  function fixChOpts() {
    const month = ($("#rm-fixch-month") && $("#rm-fixch-month").value || "").trim();
    const cat = ($("#rm-fixch-cat") && $("#rm-fixch-cat").value || "").trim();
    const ch = ($("#rm-fixch-channel") && $("#rm-fixch-channel").value || "").trim();
    const onlyEmpty = !!($("#rm-fixch-onlyempty") && $("#rm-fixch-onlyempty").checked);
    return { periodType: "month", periodLabel: month, category: cat, channel: ch, onlyEmpty: onlyEmpty };
  }

  /* 补渠道 / 清空归属 —— 两处共用：都是「按月份+类目整片改 channel」 */
  async function applyFixChannel(mode) {
    const o = fixChOpts();
    const tip = $("#rm-fixch-tip");
    const say = (t) => { if (tip) tip.textContent = t || ""; };
    if (!o.periodLabel) { sbToast("请先选月份（库里还没有月度数据？）", false); return; }
    if (mode === "set" && !o.channel) { sbToast("请填写要补的渠道名", false); return; }
    const target = (mode === "set") ? o.channel : "";
    try {
      const n = await SB.countRankItemsChannelSlot(o);
      if (!n) {
        say("这个范围里没有可改的条目" + (o.onlyEmpty ? "（可能都已有渠道了）" : ""));
        // 0 条最容易让人以为「点了没反应」，这里直接把原因摊开
        await runFixChannelDiag(o);
        return;
      }
      const scope = o.periodLabel + (o.category ? " · " + o.category : " · 全部类目");
      const what = (mode === "set")
        ? ("把这 " + n + " 条设为渠道「" + target + "」")
        : ("把这 " + n + " 条的渠道清空（退回「本站榜单」列）");
      if (!confirm("即将" + what + "\n范围：" + scope + (o.onlyEmpty ? "\n只改尚未设渠道的条目" : "\n包含已有渠道的条目（会被覆盖）") + "\n\n确定执行？")) return;
      say("正在修改…");
      const done = await SB.setRankItemsChannelSlot(o, target);
      say("已修改 " + done + " 条");
      sbToast("已修改 " + done + " 条" + (target ? "（渠道：" + target + "）" : "（已清空归属）"), true);
      await loadChChannels();
      await loadChList();
      await fillTagExportSelects();
    } catch (e) {
      say("修改失败，请重试");
      sbToast((e && e.message) || "修改失败", false);
    }
  }

  /* 自检：把「为什么改不动」拆成能看懂的数字，只做计数不写数据 */
  async function runFixChannelDiag(o) {
    const box = $("#rm-fixch-diag");
    if (!box) return;
    box.style.display = "block";
    box.textContent = "自检中…";
    let d = null;
    try { d = await SB.diagnoseChannelSlot(o || fixChOpts()); } catch (e) { d = null; }
    if (!d) {
      box.textContent = "自检失败：这次请求本身没走通（网络被拦或数据库拒绝）。请把浏览器控制台里 rank_items 那条请求的返回内容发给开发。";
      return;
    }
    const lines = [];
    lines.push("① 渠道列（rank_items.channel）：" + (d.hasColumn ? "已存在 ✓（归属存在该列里）" : "不存在 → 已自动改用字典存储 ✓"));
    if (!d.hasColumn) {
      lines.push("   说明：这一列还没加，系统已自动把渠道归属存到配置档里（图片地址 → 渠道名），");
      lines.push("         补渠道 / 渠道传图 / 前台渠道对比 都照常可用，不需要跑 SQL。");
      lines.push("   可选：想改成列存储（数据量再大也更稳），执行 sql/patch_20261110C_channel_and_tagdefs.sql 后刷新本页即可，已归属的会继续生效。");
    }
    const wantLabel = (o && o.periodLabel) || "";
    lines.push("② 本月（" + wantLabel + "）总条目：" + d.monthTotal + " 条"
      + (d.matchedLabel && d.matchedLabel !== wantLabel ? "（实际写法是「" + d.matchedLabel + "」，已自动兼容）" : ""));
    lines.push("③ 其中渠道为空（null）：" + d.emptyNull + " 条");
    lines.push("④ 其中渠道为空（空字符串）：" + d.emptyStr + " 条");
    lines.push("⑤ 其中已有渠道：" + d.filled + " 条");
    const empty = d.emptyNull + d.emptyStr;
    lines.push("");
    if (!d.monthTotal) {
      lines.push("结论：这个月份下一条条目都没有 —— 月份选错了，或这批数据是用别的期次格式存进来的。");
      lines.push("处理：换一个月份再看；若所有月份都是 0，说明月度数据还没导入成功。");
    } else if (!empty) {
      lines.push("结论：这个月份下的条目都已经有渠道了，勾着「只改尚未设渠道的」自然改不到。");
      lines.push("处理：取消勾选「只改尚未设渠道的」再点「补上渠道」（会覆盖已有归属）。");
    } else if (o && o.category) {
      lines.push("结论：不选类目时有 " + empty + " 条。你当前限定在「" + o.category + "」，那一类可能一条都没有。");
      lines.push("处理：类目改回「全部类目」再试。");
    } else {
      lines.push("结论：范围内有 " + empty + " 条可补，但仍改不动 —— 多半是数据库的写入权限（RLS）不允许更新这些行。");
      lines.push("处理：用数据库管理员账号执行 select * from pg_policies where tablename='rank_items'; 看是否有 update 策略。");
    }
    box.textContent = lines.join("\n");
  }

  function bindFixChannelCheck() {
    const b = $("#rm-fixch-check");
    if (!b || b.__bound) return;
    b.__bound = true;
    b.onclick = () => runFixChannelDiag(fixChOpts());
  }

  let rmChDict = [];

  function renderChPending() {
    const box = $("#rm-ch-pending");
    const btn = $("#rm-ch-upload");
    const tip = $("#rm-ch-tip");
    if (btn) { btn.disabled = rmChPending.length === 0; btn.textContent = "上传（" + rmChPending.length + "）"; }
    if (tip) tip.textContent = rmChPending.length ? "共 " + rmChPending.length + " 张待传" : "";
    if (!box) return;
    if (!rmChPending.length) { box.innerHTML = ""; return; }
    box.innerHTML = rmChPending.map((it, i) =>
      '<span class="mv-pend-item"><img src="' + escAttr(it.preview || "") + '" alt="">'
      + '<button type="button" data-chrm="' + i + '" title="移出待传">×</button></span>'
    ).join("");
    Array.prototype.forEach.call(box.querySelectorAll("[data-chrm]"), (b) => {
      b.onclick = () => {
        const i = parseInt(b.getAttribute("data-chrm"), 10);
        if (rmChPending[i] && rmChPending[i].preview) URL.revokeObjectURL(rmChPending[i].preview);
        rmChPending.splice(i, 1);
        renderChPending();
      };
    });
  }

  function addChFiles(files) {
    const list = Array.from(files || []).filter((f) => f && /^image\//i.test(f.type || ""));
    if (!list.length) return;
    list.forEach((f) => rmChPending.push({ file: f, preview: URL.createObjectURL(f) }));
    renderChPending();
  }

  async function uploadChPending() {
    const month = rmChMonth();
    const channel = ($("#rm-ch-channel") && $("#rm-ch-channel").value || "").trim();
    const category = ($("#rm-ch-cat") && $("#rm-ch-cat").value || "").trim();
    if (!month) { sbToast("请先选月份", false); return; }
    if (!channel) { sbToast("请先填渠道名（如 Pinterest）", false); return; }
    if (!category) { sbToast("请先选类目", false); return; }
    if (!rmChPending.length) return;

    const btn = $("#rm-ch-upload");
    const bar = $("#rm-ch-progress");
    const fill = $("#rm-ch-progress-bar");
    if (btn) btn.disabled = true;
    if (bar) bar.classList.remove("hidden");
    let done = 0;
    const total = rmChPending.length;
    const setPct = () => { if (fill) fill.style.width = Math.round((done / total) * 100) + "%"; };
    setPct();

    /* 逐张串行：R2 上传 + 写库，单张失败不影响整批 */
    const res = await SB.uploadRankChannelImages(rmChPending, {
      channel, category, periodLabel: month,
    }, (i) => { done = i; setPct(); });

    if (bar) bar.classList.add("hidden");
    if (fill) fill.style.width = "0%";
    rmChPending.forEach((it) => { if (it.preview) URL.revokeObjectURL(it.preview); });
    rmChPending = [];
    renderChPending();
    if (btn) btn.disabled = true;
    rmChSetMsg("已上传 " + res.ok.length + " 张" + (res.failed.length ? "，" + res.failed.length + " 张失败" : ""), !res.failed.length);
    if (res.failed.length) {
      const t = res.failed.slice(0, 5).map((f) => (f.name || "未命名") + "：" + f.reason).join("；");
      sbToast("有 " + res.failed.length + " 张没传上去 —— " + t
        + "（脚本版本 " + BUILD + "；若与部署包不一致，请覆盖 html 后 Ctrl+F5）", false);
    }
    await loadChChannels();
    await loadChList();
  }

  async function loadChList() {
    const box = $("#rm-ch-list");
    const cnt = $("#rm-ch-count");
    const fch = ($("#rm-ch-filter-ch") && $("#rm-ch-filter-ch").value || "").trim();
    const fcat = ($("#rm-ch-filter-cat") && $("#rm-ch-filter-cat").value || "").trim();
    if (!box) return;
    box.innerHTML = '<div class="hint">正在读取…</div>';
    try { rmChList = await SB.listRankChannelItems({ channel: fch, category: fcat, limit: 400 }); }
    catch (e) {
      box.innerHTML = '<div class="hint">读不到渠道图片：' + escHtml(String((e && e.message) || "列 channel 可能还没加（补丁未执行）")) + '</div>';
      if (cnt) cnt.textContent = "—";
      return;
    }
    if (cnt) {
      /* 把「存储里到底有多少张」一并写出来：传成功却看不到时，一眼能判断是没存进去还是没显示出来 */
      let extra = "";
      try {
        const st = await SB.channelPicStats();
        const ms = Object.keys(st.byMonth || {}).sort().reverse().slice(0, 6);
        extra = "　｜　存储共 " + st.total + " 张"
          + (ms.length ? "（" + ms.map((k) => k + " " + st.byMonth[k] + "张").join("、") + "）" : "");
      } catch (e) { extra = "　｜　存储统计读取失败"; }
      cnt.textContent = "已传 " + rmChList.length + " 张" + (rmChList.length >= 400 ? "（只显示最近 400 张，可用筛选收窄）" : "") + extra;
    }
    if (!rmChList.length) { box.innerHTML = '<div class="hint">还没有渠道图片。选好月份 / 渠道 / 类目后把图拖到上面即可。</div>'; return; }
    box.innerHTML = rmChList.map((it) => {
      const mon = it.period_label || "";
      const cat = it.category || "";
      return '<figure class="rm-ch-card" data-id="' + escAttr(String(it.id)) + '">'
        + '<img src="' + escAttr(it.image_url || "") + '" loading="lazy" alt="">'
        + '<figcaption>'
        + '<b>' + escHtml(it.channel || "") + '</b>'
        + '<span class="rm-ch-meta">' + escHtml([cat, mon].filter(Boolean).join(" · ")) + '</span>'
        + '<span class="rm-ch-acts">'
        + '<button type="button" data-chact="channel">改渠道</button>'
        + '<button type="button" data-chact="slot">改类目/月份</button>'
        + '<button type="button" data-chact="del">删除</button>'
        + '</span>'
        + '</figcaption></figure>';
    }).join("");

    Array.prototype.forEach.call(box.querySelectorAll(".rm-ch-card"), (card) => {
      const id = parseInt(card.getAttribute("data-id"), 10);
      const row = rmChList.filter((x) => x.id === id)[0] || {};
      Array.prototype.forEach.call(card.querySelectorAll("[data-chact]"), (b) => {
        b.onclick = async () => {
          const act = b.getAttribute("data-chact");
          try {
            if (act === "channel") {
              const v = (window.prompt("改成哪个渠道？", row.channel || "") || "").trim();
              if (!v) return;
              await SB.updateRankChannelItem(id, { channel: v });
            } else if (act === "slot") {
              const c = (window.prompt("改成哪个类目？", row.category || "") || "").trim();
              if (!c) return;
              const m = (window.prompt("改成哪个月份？（格式 2026-10）", row.period_label || "") || "").trim();
              if (!m) return;
              await SB.updateRankChannelItem(id, { category: c, period_label: m });
            } else if (act === "del") {
              if (!window.confirm("删除这张渠道图？（只删这条记录，不动榜单数据）")) return;
              await SB.deleteRankChannelItem(id);
            }
            await loadChChannels();
            await loadChList();
          } catch (e) { sbToast(String((e && e.message) || "操作失败"), false); }
        };
      });
    });
  }

  function bindChannelUploader() {
    if (!$("#rm-ch-drop")) return;
    const mEl = $("#rm-ch-month");
    if (mEl && !mEl.value) {
      const now = new Date();
      const pad = (n) => (n < 10 ? "0" : "") + n;
      mEl.value = now.getFullYear() + "-" + pad(now.getMonth() + 1);
    }
    const drop = $("#rm-ch-drop");
    const file = $("#rm-ch-file");
    const pick = $("#rm-ch-pick");
    if (pick && file) pick.onclick = () => file.click();
    if (file) file.onchange = () => { addChFiles(file.files); file.value = ""; };
    if (drop) {
      drop.onclick = () => { if (file) file.click(); };
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
      drop.addEventListener("drop", (e) => {
        e.preventDefault(); drop.classList.remove("is-over");
        addChFiles(e.dataTransfer && e.dataTransfer.files);
      });
    }
    const clear = $("#rm-ch-clear");
    if (clear) clear.onclick = () => {
      rmChPending.forEach((it) => { if (it.preview) URL.revokeObjectURL(it.preview); });
      rmChPending = []; renderChPending();
    };
    const up = $("#rm-ch-upload");
    if (up) up.onclick = () => uploadChPending();
    const rf = $("#rm-ch-refresh");
    if (rf) rf.onclick = async () => { await loadChChannels(); fillChCatSelects(); await loadChList(); };
    /* 导出这批图的打标表（20261109B）：
       渠道图没有环比也不影响打标 —— 打标表只按图片地址走，标签写回 rank_image_tags，
       和榜单图同一套枚举、同一张表、同一个回填入口。这里只是把导出区按当前筛选预设好再点一下。 */
    const te = $("#rm-ch-tag-export");
    if (te) te.onclick = () => {
      const fch = ($("#rm-ch-filter-ch") && $("#rm-ch-filter-ch").value || "").trim();
      const fcat = ($("#rm-ch-filter-cat") && $("#rm-ch-filter-cat").value || "").trim();
      /* 渠道区块的导出：把当前筛选带进导出选项，默认「仅未打标 + 仅月度」 */
      const fper = ($("#rm-tag-period") && $("#rm-tag-period").value || "").trim();
      runMonthTagExport(te, {
        scope: "todo",
        category: fcat,
        channel: fch ? ("ch:" + fch) : "__chonly",
        period: fper,           /* 面板上选了月份就只导那个月，和范围保持一致 */
      });
      sbToast("已按「" + (fch || "全部渠道") + (fcat ? " / " + fcat : "") + "」导出，导完直接填表即可", true);
    };

    /* 月度打标结果回填（20261109F）：走与周度同一套导入逻辑，但只认月度条目。
       UI 状态留着（选中的文件 + 上次解析结果），避免二次点按钮时让人重选文件。 */
    const tagImpFile = $("#rm-tag-imp-file");
    const tagImpBtn = $("#rm-tag-imp-btn");
    const tagImpTip = $("#rm-tag-imp-tip");
    const tagImpMode = $("#rm-tag-imp-mode");
    const tagImpClear = $("#rm-tag-imp-clear-empty");
    const sayImp = (t, ok) => {
      if (!tagImpTip) return;
      tagImpTip.textContent = t || "";
      tagImpTip.className = "rank-file-tip" + (ok === false ? " bad" : ok === true ? " good" : "");
    };
    if (tagImpMode && tagImpClear) {
      tagImpMode.onchange = () => {
        tagImpClear.disabled = tagImpMode.value !== "overwrite";
        if (tagImpClear.disabled) tagImpClear.checked = false;
      };
    }
    if (tagImpFile && tagImpBtn) {
      tagImpFile.onchange = () => {
        const f = tagImpFile.files && tagImpFile.files[0];
        tagImpBtn.disabled = !f;
        sayImp(f ? ("已选择「" + f.name + "」，点「写入标签」开始") : "");
      };
      tagImpBtn.onclick = async () => {
        const f = tagImpFile.files && tagImpFile.files[0];
        if (!f) { sayImp("请先选择填好的打标表", false); return; }
        if (!window.RankTagImport || !window.RankTagImport.importFile) {
          sayImp("导入模块未加载，请刷新页面再试", false); return;
        }
        tagImpBtn.disabled = true;
        const old = tagImpBtn.textContent;
        tagImpBtn.textContent = "写入中…";
        sayImp("正在解析并写入…");
        try {
          const r = await window.RankTagImport.importFile(f, {
            mode: tagImpMode ? tagImpMode.value : "fill",
            clearEmpty: !!(tagImpClear && tagImpClear.checked),
            periodType: "month",
          });
          const dims = Object.keys(r.dims || {});
          const dimTxt = dims.length ? " · 各维度写入行数：" + dims.map((k) => k + " " + r.dims[k]).join(" · ") : "";
          let msg = r.msg + (r.already ? "（其中 " + r.already + " 张本来就有标签）" : "") + dimTxt;
          if ((r.unknown || []).length) {
            msg += " ⚠ 枚举外标签 " + r.unknown.length + " 个未写入，例如「" + r.unknown[0].v + "」";
          }
          if ((r.missing || []).length) {
            msg += " ⚠ 数据库缺少维度列：" + r.missing.join("、") + "，这几维未写入（其余已落库）";
          }
          sayImp(msg, true);
          sbToast("已写入 " + (r.written || 0) + " 张图的标签", true);
          await loadChList();
          await fillTagExportSelects();
        } catch (e) {
          sayImp("写入失败：" + ((e && e.message) || "表格格式不对"), false);
        }
        tagImpBtn.textContent = old;
        tagImpBtn.disabled = false;
      };
    }

    /* 新增渠道（20261109E）：加完立刻进候选，下次直接选 */
    const chAdd = $("#rm-ch-add");
    if (chAdd) chAdd.onclick = async () => {
      const tip = $("#rm-ch-dict-tip");
      const v = (prompt("新增渠道名（例如 Pinterest / SHEIN / Amazon）", "") || "").trim();
      if (!v) return;
      try {
        const r = await SB.addRankChannel(v);
        await refreshChDict();
        const chs = $("#rm-ch-channel");
        if (chs && r && r.added) chs.value = r.name;
        if (tip) tip.textContent = r && r.added ? ("已新增「" + v + "」") : ("「" + v + "」本来就有");
      } catch (e) { sbToast((e && e.message) || "新增失败", false); }
    };

    /* 批量补渠道（20261109D） */
    const fcpv = $("#rm-fixch-preview");
    if (fcpv) fcpv.onclick = async () => {
      const o = fixChOpts();
      const tip = $("#rm-fixch-tip");
      if (!o.periodLabel) { if (tip) tip.textContent = "请先选月份"; return; }
      if (tip) tip.textContent = "正在统计…";
      try {
        const n = await SB.countRankItemsChannelSlot(o);
        const scope = o.periodLabel + (o.category ? " · " + o.category : " · 全部类目");
        if (tip) tip.textContent = scope + "：" + (o.onlyEmpty ? "尚未设渠道 " : "共 ") + n + " 条将被修改";
      } catch (e) { if (tip) tip.textContent = "统计失败，请重试"; }
    };
    const fcok = $("#rm-fixch-apply");
    if (fcok) fcok.onclick = () => applyFixChannel("set");
    const fccl = $("#rm-fixch-clear");
    if (fccl) fccl.onclick = () => applyFixChannel("clear");
    bindFixChannelCheck();

    /* 月度打标表导出（面板里独立的那个区块） */
    const mtb = $("#rm-tag-export-btn");
    if (mtb) mtb.onclick = () => {
      const scope = ($("#rm-tag-scope") && $("#rm-tag-scope").value || "todo");
      const cat = ($("#rm-tag-cat") && $("#rm-tag-cat").value || "").trim();
      const ch = ($("#rm-tag-channel") && $("#rm-tag-channel").value || "").trim();
      runMonthTagExport(mtb, { scope: scope, category: cat, channel: ch });
    };
    const fch = $("#rm-ch-filter-ch");
    if (fch) fch.onchange = () => loadChList();
    const fcat = $("#rm-ch-filter-cat");
    if (fcat) fcat.onchange = () => loadChList();
    renderChPending();
  }

  /* 脚本版本：页面上显示出来，传图失败时一眼能看出「页面跑的是不是旧脚本」 */
  var BUILD = "20261111H";
  function showBuild() {
    var el = document.getElementById("rm-ch-ver");
    if (el) el.textContent = "脚本版本 " + BUILD + "（若与部署包版本不一致，说明浏览器还在用旧脚本：覆盖 html 后 Ctrl+F5）";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { bindRhythmPanel(); bindChannelUploader(); showBuild(); });
  else { bindRhythmPanel(); bindChannelUploader(); showBuild(); }

  Object.assign(window, {
    enterRhythmPanel, loadRhythmBatches: loadRankBatches, loadRhythmSites: loadRankSites,
    loadRhythmCats: loadRankCats, doRhythmImport: doRankImport, onRhythmFileChange: onRankFileChange,
    computeRhythmFlags: computeFlags, rhythmPreviewRefresh: rankPreviewRefresh,
    renderRhythmPeriods: renderRankPeriods, fillRhythmPvControls: fillRankPvControls,
    computeRhythmCounts: computeRankCounts, rhythmBatchSlotKey: batchSlotKey, rhythmBatchSites: batchSites,
    loadRhythmChannelList: loadChList, uploadRhythmChannels: uploadChPending, rmChPendingState: () => rmChPending,
  });
  window.RhythmAdmin = {
    enter: enterRhythmPanel, reload: enterRhythmPanel,
    preview: rankPreviewRefresh, refresh: enterRhythmPanel,
  };
}
