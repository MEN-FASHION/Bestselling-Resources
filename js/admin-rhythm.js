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
  /* 20261113L · 上传归属（同趋势上升榜）
     看得见所有人传的，改只能改自己传的；超管不限；本功能上线前的数据=历史数据，仅超管可改。 */
  let rankPeriodGate = {};
  function uoOk() { return !!(window.UO && typeof window.UO.canManage === "function"); }
  function uoReady() {
    if (!uoOk()) return Promise.resolve(false);
    return window.UO.ensure().then(function () { return true; }).catch(function () { return false; });
  }
  function batchCanRun(b) {
    if (!uoOk()) return true;
    if (window.UO.isSuper()) return true;
    if (!b || b.id == null) return true;
    return window.UO.canManage("b", b.id);
  }
  function batchOwner(b) {
    if (!uoOk() || !b || b.id == null) return "";
    return window.UO.label("b", b.id);
  }
  function batchOwnerHint(b) {
    if (!uoOk() || !b || b.id == null) return "";
    return window.UO.hint("b", b.id);
  }
  function denyTip(n) {
    if (window.UO && window.UO.isSuper()) return "";
    return n > 1
      ? "其中 " + n + " 项不是你上传的（或属于历史数据），只有上传人本人或超级管理员可以改动，已跳过"
      : "这条不是你上传的（或属于历史数据），只有上传人本人或超级管理员可以改动";
  }
  const rankPv = { cat: "", site: "", period: "", mode: "h", size: "m" };
  /* 站点名归一：交给公共模块，认不出时原样返回（绝不瞎猜） */
  function siteNormResolve(v, list) {
    if (typeof window !== "undefined" && window.SiteNorm) return window.SiteNorm.resolve(v, list);
    return String(v == null ? "" : v).trim();
  }
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
    /* 20261113E：环比列的表头写法比想象中杂。
       除了「环比比例 / 环比绝对值」，还有「环比涨幅、增长率、较上期、升降幅、变化率、增量、差额」等。
       认不出来 → ratio/abs 全为 null → 前台一张涨跌标签都没有，只剩「新上榜」。 */
    const iAbs = find(h => h.indexOf("环比绝对值") >= 0 || h.indexOf("绝对值") >= 0 && h.indexOf("比例") < 0
      || h.indexOf("增量") >= 0 || h.indexOf("差额") >= 0 || h === "环比绝对值");
    const iRatio = find(h => h.indexOf("环比比例") >= 0 || h.indexOf("环比涨幅") >= 0 || h.indexOf("涨幅") >= 0
      || h.indexOf("增长率") >= 0 || h.indexOf("增幅") >= 0 || h.indexOf("升降幅") >= 0
      || h.indexOf("变化率") >= 0 || h.indexOf("较上期") >= 0 || h.indexOf("较上月") >= 0 || h.indexOf("较上周") >= 0
      || (h.indexOf("比例") >= 0 && h.indexOf("绝对值") < 0));
    const iSite = find(h => h.indexOf("销量站点") >= 0 || h.indexOf("站点") >= 0 || h === "国家" || h.indexOf("国家") === 0);
    const iUrl = find(h => (h.indexOf("首图") >= 0 && h.indexOf("url") >= 0) || h === "首图url" || h.indexOf("首图") >= 0);
    const iLeaf = find(h => h.indexOf("叶子类目") >= 0 && !isIdHead(h));
    /* 20261113I：表里常带「排名」与「销售额」两列，过去一律忽略：
       排名是平台给的官方名次，只要两个月的表都有排名，直接相减就是真实位次变化，
       既不需要环比列，也不需要反推销量。销售额用来在没带排名的表里排出批内名次。 */
    const iPos = find(h => (h.indexOf("排名") >= 0 || h.indexOf("名次") >= 0) && !isIdHead(h));
    const iSales = find(h => (h.indexOf("销售额") >= 0 || h.indexOf("成交额") >= 0 || h.indexOf("销量金额") >= 0 || h === "gmv") && h.indexOf("合计") < 0);
    const iCat = find(h => h.indexOf("类目") >= 0 && h.indexOf("叶子") < 0 && !isIdHead(h));
    if (iAbs < 0 && iRatio < 0 && iSite < 0 && iUrl < 0) return null;
    return { abs: iAbs, ratio: iRatio, site: iSite, url: iUrl, leaf: iLeaf >= 0 ? iLeaf : iCat, pos: iPos, sales: iSales };
  }
  /* 表头行识别：在前几行里挑「识别到的列最多」的那一行。
     有些整理表在表头之上还有标题行、说明行，说明文字里常出现「环比比例」「环比绝对值」这些字样，
     逐行取「第一个像表头的行」会把说明行误判成表头 → 首图URL 列找不到 → 一行也读不出来。 */
  function scoreHeaderRow(m) {
    if (!m) return 0;
    return (m.abs >= 0 ? 1 : 0) + (m.ratio >= 0 ? 1 : 0) + (m.site >= 0 ? 1 : 0)
      + (m.url >= 0 ? 1 : 0) + (m.leaf >= 0 ? 1 : 0) + (m.pos >= 0 ? 1 : 0);
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
        if (!(await uiConfirm("把站点「" + s.name + "」改名为「" + v + "」？\n该站点已上传的榜单数据会一起改名。"))) { name.value = s.name; return; }
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
        if (!(await uiConfirm("删除站点「" + s.name + "」？\n（已上传的榜单数据不受影响，仅从站点清单移除）"))) return;
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
      const commit = async () => {
        const v = (name.value || "").trim();
        if (!v || v === g.name) { name.value = g.name; return; }
        if (rankGroups.some((x, i) => i !== gi && x.name === v)) { name.value = g.name; sbToast("已有同名地区", false); return; }
        const old = g.name;
        if (!(await uiConfirm("把地区「" + old + "」改名为「" + v + "」？\n该地区下已选的国家不受影响。"))) { name.value = old; return; }
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
        if (!(await uiConfirm("删除地区「" + g.name + "」？\n（仅删除这个分组，各国家的数据与站点清单都不受影响）"))) return;
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
          pos: toNum(head.map.pos >= 0 ? c[head.map.pos] : null),
          sales: toNum(head.map.sales >= 0 ? c[head.map.sales] : null),
          hasSiteCol: head.map.site >= 0,
        });
      }
      /* 20261113D：站点名归一到后台「站点管理」的正式名字，否则前台按站点筛不到 */
      const siteList = (rankSites || []).map(x => x && x.name).filter(Boolean);
      let siteFixed = 0; const siteUnknown = {};
      rows.forEach(r => {
        if (!r.site) return;
        const before = r.site;
        const after = siteNormResolve(before, siteList);
        if (after !== before) { r.site = after; siteFixed++; }
        if (siteList.length && after && siteList.indexOf(after) < 0) siteUnknown[after] = (siteUnknown[after] || 0) + 1;
      });
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
    /* 20261113I：位次改由系统自算（用比例 + 绝对值反推上期销量），
       所以先算一遍「这批数据里有多少行够得上自算」，导入前就能看出前台会不会有位次。 */
    const CALC = (typeof window !== "undefined" && window.RhythmCalc) ? window.RhythmCalc : null;
    const derivable = CALC ? rows.filter(function (r) { return !!CALC.derive(r); }).length : 0;
    /* 20261113I：表里带「排名 / 销售额」时，即便没有环比也能给出位次（与上一月名次相减） */
    const withPos = rows.filter(r => r.pos != null && r.pos > 0).length;
    const withSales = rows.filter(r => r.sales != null).length;
    const noRatioAtAll = (withRatio === 0 && withAbs === 0);
    /* 20261113I：位次依据统一为「销售额批内名次」——销售额优先，排名只在没有销售额列时兜底。
       这样每个月都是用同一把尺子，跨月相减才有意义。 */
    const posHint = noRatioAtAll ? (
      withSales
        ? 'ℹ️ 本批没有环比列，检测到「销售额」列 <b>' + withSales + '</b> 行：导入后<b>统一按销售额排出批内名次</b>与上一月直比，<b>能显示「上升 / 下降 N 位」</b>。'
          + (withPos ? '（表里还有「排名」列，但不采用 —— 统一用销售额，避免两个月口径不同算出差错的位次）' : '')
          + '前提是上一月的表也要导入过。'
        : (withPos
          ? '⚠️ 本批没有环比列、也<b>没有「销售额」列</b>，只能用「排名」列 <b>' + withPos + '</b> 行当名次。若上一月是按销售额算的名次，两个月口径不同，前台将<b>不做位次对比</b>（只给环比方向）。建议补一列「销售额」再导。'
          : '⚠️ 本批没有环比列、也没有「销售额 / 排名」列：导入后按<b>表格行序</b>当名次（导出表通常已按销量降序，行序≈名次）。若这张表不是按销量排序导出的，位次会失真，建议补一列「销售额」再导。')
    ) : '';
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
        '<span>可自算位次：<b>' + derivable + '</b></span>' +
        '<span>含排名列：<b>' + withPos + '</b></span>' +
        '<span>含销售额列：<b>' + withSales + '</b></span>' +
        '</div>' +
        (posHint ? '<div class="hint">' + posHint + '</div>' : '') +
        ((noRatioAtAll && !withPos && !withSales) ? '<div class="hint rank-warn">⚠️ 整批既没有环比、也没有「排名 / 销售额」列，将按<b>表格行序</b>当名次（第 1 行=第 1 名）。如果你的表确实是按销量从高到低导出的，这样算是对的；若不是，位次会失真 —— 补一列「销售额」最稳。</div>' : '') +
        (derivable === 0 && (withRatio || withAbs) ? '<div class="hint rank-warn">⚠️ 读到了环比列，但没有一行能反推出上期销量（比例 ≤ -100%、或比例与绝对值互相矛盾）。前台这些行只会显示方向标签，算不出「上升 / 下降 N 位」。</div>' : '') +
        (rankParsed.missing.length ? '<div class="hint rank-warn">未识别到列：' + escHtml(rankParsed.missing.join("、")) + '</div>' : '') +
        (rankParsed.urlWarn ? '<div class="hint rank-warn">' + escHtml(rankParsed.urlWarn) + '</div>' : '') +
        (rankParsed.dupUrls ? '<div class="hint rank-warn">表格里有 ' + rankParsed.dupUrls + ' 张图重复出现，同一个地区下会合并为一条（保留环比更强的那条）。</div>' : '') +
        (rankParsed.siteWarn ? '<div class="hint rank-warn">' + escHtml(rankParsed.siteWarn) + '</div>' : '') +
        '<div class="hint">站点归属：<b>' + (document.querySelectorAll('#rm-site-defaults input[type="checkbox"]:checked').length ? "以「国家站点」勾选的为准 —— 整张表都算这个地区，表格里的「销量站点」列不生效" : "未勾选站点 → 按表格「销量站点」列逐行取（合计表请务必先勾选，如欧盟）") + '</b>；标签按「站点 + 期次 + 类目」分池计算（每个国家各自排名）。位次口径：<b>环比比例+绝对值反推销量自算</b> → <b>表内「销售额」批内名次</b>（统一口径，表里即使有「排名」也按销售额） → <b>表内「排名」</b>（无销售额列时） → <b>表格行序</b>。两个月名次口径不一致时，前台不做位次对比。库里若有上一期整榜，仍以真实两期名次为准。</div>';
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

  /* ---------- 表内名次（20261113I / I） ----------
     用户的整理表形态很不统一：
       · 只有「销售额」+「排名」两列，环比比例 / 环比绝对值全空；
       · 有的表连「排名」都没有，只有销售额；
       · 还有的表既没排名也没销售额，但导出时按销量从高到低排序。
     这几种表在旧逻辑下一律被忽略 → 前台只能判「新上榜」。
     20261113I：口径统一为「销售额批内名次」——销售额覆盖过半就一律按销售额排序，
     表里即使带「排名」也不用（两个月各用一把尺子相减，会算出「上升 38 位」这类假数字）。
     只有整批没有销售额时才退回「排名」，再没有才按表格行序，且预览与回执都会明确告知。
     表里本来就带环比的行不动 rank_abs（那一列继续表示「环比绝对值名次」，两套口径不混）。
     两个月都用同一种口径时，前台一减就是真实位次变化，不需要环比也不需要上月销量。 */
  function isPosNum(v) { return v != null && isFinite(v) && v > 0; }
  /* 按某个数值降序给「池内」排名，值相同并列同名次；拿不到值的行不参与 */
  function rankByValue(pool, valOf) {
    const arr = pool.map(x => ({ i: x.i, v: valOf(x.r) }))
      .filter(o => o.v != null && isFinite(o.v));
    arr.sort((a, b) => b.v - a.v);
    const map = {};
    let last = null, rank = 0;
    arr.forEach((o, k) => {
      if (last === null || o.v !== last) { rank = k + 1; last = o.v; }
      map[o.i] = rank;
    });
    return map;
  }
  function applyOfficialRank(rows) {
    const list = rows || [];
    const res = { applied: false, byPos: 0, bySales: 0, byOrder: 0, basis: "", noBasis: 0, fallback: "" };
    if (!list.length) return res;
    if (list.some(r => r.ratio != null || r.abs_delta != null)) return res;
    const groups = {};
    list.forEach((r, i) => { const k = r.site || ""; (groups[k] = groups[k] || []).push({ r: r, i: i }); });
    Object.keys(groups).forEach(k => {
      const pool = groups[k];
      const n = pool.length;
      const posN = pool.filter(x => isPosNum(x.r.pos)).length;
      const saleN = pool.filter(x => x.r.sales != null && isFinite(x.r.sales)).length;
      /* 20261113I：统一按「销售额批内名次」落 rank_abs。
         理由：跨月位次是两个月名次相减，只要有一个月用了平台「排名」、另一个月用了销售额名次，
         两把尺子相减出来的数字就没有意义（用户实测出现过「上升 38 位」这种假结论）。
         所以销售额覆盖过半就一律用销售额，绝不因为表里有「排名」就改用它。 */
      const useSales = saleN > 0 && saleN >= Math.ceil(n * 0.6);
      /* 没有销售额列的表才退回「排名」；再没有就按行序。 */
      const usePos = !useSales && posN > 0 && posN >= Math.ceil(n * 0.6);

      /* ① 销售额批内名次（默认口径） */
      if (useSales) {
        const saleMap = rankByValue(pool, r => (r.sales != null && isFinite(r.sales)) ? r.sales : null);
        let maxRank = 0;
        Object.keys(saleMap).forEach(kk => { if (saleMap[kk] > maxRank) maxRank = saleMap[kk]; });
        pool.forEach((x, idx) => {
          if (saleMap[x.i] != null) { x.r.rank_abs = saleMap[x.i]; res.bySales++; }
          else { x.r.rank_abs = maxRank + idx + 1; res.byOrder++; }   /* 没销售额的排在后面，按行序 */
        });
        return;
      }
      /* ② 整批没有销售额，但有「排名」：只能用平台名次，并记下来以便提示口径不同 */
      if (usePos) {
        res.fallback = res.fallback || "pos";
        const saleMap = rankByValue(pool, r => (r.sales != null && isFinite(r.sales)) ? r.sales : null);
        pool.forEach((x, idx) => {
          if (isPosNum(x.r.pos)) { x.r.rank_abs = Math.round(x.r.pos); res.byPos++; }
          else if (saleMap[x.i] != null) { x.r.rank_abs = saleMap[x.i]; res.bySales++; }
          else { x.r.rank_abs = idx + 1; res.byOrder++; }
        });
        return;
      }
      /* ③ 既没销售额也没排名：按表格行序（导出表多按销量降序，行序≈名次） */
      res.fallback = res.fallback || "order";
      pool.forEach((x, idx) => { x.r.rank_abs = idx + 1; res.byOrder++; });
    });
    res.applied = res.byPos + res.bySales + res.byOrder > 0;
    res.basis = res.byPos ? "pos" : (res.bySales ? "sales" : (res.byOrder ? "order" : ""));
    return res;
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
          pos: r.pos,                       /* 平台排名（可能为空） */
          sales: r.sales,                   /* 销售额（可能为空） */
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
      /* 20261113I：区分「没有这一列」和「有这一列但整列为空」—— 后者更常见（整理表常常留空站点列） */
      const hasSiteCol = !!(rankParsed.rows[0] && rankParsed.rows[0].hasSiteCol);
      const msg = built.noSite
        ? (hasSiteCol
          ? "表格「销量站点」列整列为空（" + built.noSite + " 行都没有站点），请在上方「国家站点」里勾选目标站点后重试"
          : "表格没有「销量站点」列，且未选择默认站点：请在上方「国家站点」里勾选目标站点")
        : "没有可导入的有效行";
      sbToast(msg, false);
      return;
    }
    const rowsOut = built.rows;
    const mergedInFile = built.mergedInFile;
    const ignoredList = Object.keys(built.tableSites);
    const slotSites = built.slotSites;
    const batchSite = useMine ? defaults.join(",") : slotSites.join(",");
    computeFlags(rowsOut);
    /* 20261113I：没有环比列时，改用表里的「排名 / 销售额」作为位次依据 */
    const posInfo = applyOfficialRank(rowsOut);

    const mode = (document.querySelector('input[name="rm-mode"]:checked') || {}).value === "append" ? "append" : "replace";
    const btn = $("#rm-import");
    if (btn) { btn.disabled = true; btn.textContent = "导入中…"; }
    try {
      /* 20261113B：上新节奏有独立数据域，写入 / 清空 / 查重只在 rhythm 域内进行 */
      const slot = { periodType: periodType, periodLabel: periodLabel, category: category, sites: slotSites, source: "rhythm" };
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

      const batchId = await SB.createRankBatch({ periodType: periodType, periodLabel: periodLabel, category: category, site: batchSite, source: "rhythm" });
      const rows = list.map(r => {
        const o = Object.assign({}, r, { batch_id: batchId, source: "rhythm" });
        delete o.pos; delete o.sales; delete o._posSrc;   /* 辅助列，库里没有这两列 */
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

      /* 20261113L：登记上传归属（按批次 ID）。失败不阻断导入，只会让该批次显示成「历史数据」。 */
      try { if (inserted > 0 && uoOk()) await window.UO.claim("b", [batchId]); } catch (e) { /* 忽略 */ }

      if (rows.length > 0 && inserted === 0) {
        /* 安全网：一条都没写进去，必须说清楚，不能静默 */
        sbToast("导入失败：0 条写入（有效行 " + rowsOut.length + " 条）。请刷新页面后重试；若仍为 0，请把这张表发给开发者排查。", false);
      } else {
        sbToast("导入完成：" + (useMine ? "已按我定义的站点归入「" + defaults.join("、") + "」" : "已按表格站点列归入")
          + "，写入 " + inserted + " 条"
          + (mode === "replace" && cleared.items > 0 ? "（已替换该期次该类目下的旧数据 " + cleared.items + " 条）" : "")
          + (mode === "append" && skippedExisting > 0 ? "（库里已存在的 " + skippedExisting + " 条未重复写入）" : "")
          + (mergedInFile > 0 ? "（表格里同一张图重复 " + mergedInFile + " 次，已合并为 1 条）" : "")
          + (posInfo && posInfo.applied ? "（位次依据：" + ({ sales: "销售额批内名次", pos: "平台「排名」", order: "表格行序" }[posInfo.basis] || "表内名次") + "，已写入 " + (posInfo.byPos + posInfo.bySales + posInfo.byOrder) + " 条" + (posInfo.fallback === "pos" ? "；本表没有「销售额」列，与其他月份的销售额名次口径不同，跨月不做位次对比" : posInfo.fallback === "order" ? "；本表没有「销售额 / 排名」列，按行序当名次，若不是按销量排序导出会失真" : "") + "）" : "")
          + (ignoredList.length ? "（已忽略表格里的 " + ignoredList.length + " 个站点取值：" + ignoredList.slice(0, 4).join("、") + (ignoredList.length > 4 ? "…" : "") + "）" : ""), true);
      }
      rankParsed = null;
      $("#rm-file").value = "";
      $("#rm-file-tip").textContent = "";
      $("#rm-preview").innerHTML = "";
      await loadRankBatches();
      /* 20261113P：和历史数据核对一次 —— 覆盖只清「本期次 · 本类目」，
         同期别的类目会留在前台，以前没有任何提示，看起来像「选了类目没生效」。 */
      try {
        if (window.RankOtherCatsCheck) {
          const keepMap = {};
          keepMap[category] = 1;
          await window.RankOtherCatsCheck(periodType, [periodLabel], keepMap, {
            boxId: "rm-cat-alert", source: "rhythm",
            onDone: async () => { await loadRankBatches(); rankPreviewRefresh(); },
          });
        }
      } catch (e) { /* 核对失败不影响导入结果 */ }
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
    /* 20261113C：条数按本域统计，别把趋势上升榜 / 标题组词台的数据算进来 */
    const countFn = (opt && opt.countFn) || ((o) => SB.countRankSlot(Object.assign({}, o, { source: "rhythm" })));
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
    await uoReady();   /* 20261113L：先取归属，批次行要显示上传人并按归属决定能否操作 */
    /* 20261113C：只读本域台账（上新节奏） */
    try { list = await SB.listRankBatches("rhythm"); } catch (e) { list = []; }
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
    /* 20261113L：期次下每一批都归我（或我是超管），才允许整期次改名 / 切频次 / 删除 */
    rankPeriodGate = {};
    list.forEach((b) => {
      const k = b.period_type + "|" + b.period_label;
      if (rankPeriodGate[k] === undefined) rankPeriodGate[k] = true;
      if (!batchCanRun(b)) rankPeriodGate[k] = false;
    });
    renderRankPeriods();
    fillRankPvControls();
    loadRankPrintSwitch();          /* 图案印花款开关：每次进面板按库里最新值渲染 */

    if (!box) return;
    if (!list.length) { box.innerHTML = '<div class="rkadm-empty">还没有上传记录</div>'; return; }
    box.innerHTML = "";
    list.forEach((b) => {
      const row = document.createElement("div");
      row.className = "rank-batch-row";
      const can = batchCanRun(b);          /* 20261113L：只有上传人本人 / 超管能改这一批 */

      const main = document.createElement("span");
      main.className = "rank-batch-main";
      if (!can) main.classList.add("is-readonly");
      main.textContent = (b.period_type === "month" ? "月度 " : "周度 ") + b.period_label + " · " + (b.category || "未填类目") + (b.site ? " · 站点 " + b.site : "") + " · " + (cntApprox(b) ? "≈" : "") + cntOf(b) + " 条" + (b.skipped ? "（跳过 " + b.skipped + "）" : "");
      const own = document.createElement("span");
      own.className = "rank-batch-owner" + (can ? "" : " is-other");
      own.textContent = " · 上传人 " + (batchOwner(b) || "历史数据") + (can ? "" : "（不可改动）");
      own.title = batchOwnerHint(b);
      main.appendChild(own);

      const act = document.createElement("span");
      act.className = "rkadm-row-act";

      const ren = document.createElement("button");
      ren.type = "button"; ren.className = "btn-ghost small"; ren.textContent = "改期次名";
      ren.disabled = !can; ren.title = can ? "" : denyTip(1);
      ren.onclick = async () => {
        if (!can) { sbToast(denyTip(1), false); return; }
        const v = (await uiPrompt("该批次所属期次改名（会同步该期次全部数据）：", b.period_label) || "").trim();
        if (!v || v === b.period_label) return;
        if (!(await uiConfirm("把期次「" + b.period_label + "」改名为「" + v + "」？\n该期次全部数据会一起改名。"))) return;
        try {
          const mv = await SB.updateRankPeriodData(b.period_label, b.period_type, v, b.period_type, "rhythm");
          await loadRankBatches(); rankPreviewRefresh();
          sbToast("期次已改名为「" + v + "」（迁移 " + mv + " 条）", true);
        } catch (e) { sbToast((e && e.message) || "改名失败", false); }
      };

      const del = document.createElement("button");
      del.type = "button"; del.className = "btn-ghost small rank-batch-del"; del.textContent = "删除";
      del.disabled = !can; del.title = can ? "" : denyTip(1);
      del.onclick = async () => {
        if (!can) { sbToast(denyTip(1), false); return; }
        if (!(await uiConfirm("删除该批次「" + b.period_label + " · " + b.category + "」及其全部条目？"))) return;
        try {
          await SB.deleteRankBatch(b.id);
          try { if (uoOk()) await window.UO.forget("b", [b.id]); } catch (e) { /* 忽略 */ }
          await loadRankBatches(); rankPreviewRefresh(); sbToast("已删除该批次", true);
        }
        catch (e) { sbToast("删除失败", false); }
      };

      act.appendChild(ren); act.appendChild(del);
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
      /* 20261113L：整期次操作会动到该期次下所有人的数据 */
      const gate = rankPeriodGate[p.type + "|" + p.label] !== false;

      const type = document.createElement("button");
      type.type = "button";
      type.className = "rkadm-badge";
      type.textContent = p.type === "month" ? "月度" : "周度";
      type.title = gate ? "点击切换：周度 ↔ 月度" : "该期次里有别人上传的数据，只有上传人或超级管理员可切换";
      type.disabled = !gate;
      type.onclick = async () => {
        if (!gate) { sbToast("该期次里有别人上传的数据，不能整期次切换频次", false); return; }
        const nt = p.type === "month" ? "week" : "month";
        if (!(await uiConfirm("把期次「" + p.label + "」的频次改为「" + (nt === "month" ? "月度" : "周度") + "」？\n该期次全部数据会一起切换。"))) return;
        try {
          await SB.updateRankPeriodData(p.label, p.type, p.label, nt, "rhythm");
          await loadRankBatches(); rankPreviewRefresh();
          sbToast("频次已切换", true);
        } catch (e) { sbToast((e && e.message) || "切换失败", false); }
      };

      const name = document.createElement("input");
      name.type = "text";
      name.className = "rkadm-name";
      name.value = p.label;
      name.title = gate ? "点一下即可改名（该期次全部数据一起改名）"
        : "该期次里有别人上传的数据，只有上传人或超级管理员可改名";
      name.readOnly = !gate;
      if (!gate) name.classList.add("is-readonly");
      name.addEventListener && name.addEventListener("focus", () => name.select());
      let renaming = false, committed = false;
      const commit = async () => {
        if (!gate) { name.value = p.label; return; }
        const v = (name.value || "").trim();
        if (!v || v === p.label) { name.value = p.label; return; }
        if (renaming || committed) return;
        if (!(await uiConfirm("把期次「" + p.label + "」改名为「" + v + "」？\n该期次已上传的全部数据（" + p.rows + " 条）会一起改名。"))) { name.value = p.label; return; }
        renaming = true;
        try {
          const mv = await SB.updateRankPeriodData(p.label, p.type, v, p.type, "rhythm");
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
      del.type = "button"; del.className = "rkadm-icon rkadm-icon--del"; del.textContent = "✕";
      del.title = gate ? "删除整个期次" : "该期次里有别人上传的数据，只有上传人或超级管理员可删除";
      del.disabled = !gate;
      del.onclick = async () => {
        if (!gate) { sbToast("该期次里有别人上传的数据，不能整期次删除", false); return; }
        if (!(await uiConfirm("删除整个期次「" + p.label + "」及其全部数据（" + p.rows + " 条）？此操作不可恢复。"))) return;
        try { await SB.deleteRankPeriod(p.label, p.type, "rhythm"); await loadRankBatches(); rankPreviewRefresh(); sbToast("已删除该期次", true); }
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
    await fillTagExportSelects();
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
      const v = (await uiPrompt("输入新类目名称（将同步到「标签管理 → 前台类目」）：") || "").trim();
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
        say("库里还没有月度图，先上传月度数据");
      } else {
        say("导出失败，请重试");
      }
    }, () => { say("导出失败，请重试"); });
  }

  /* 月度面板里除上传之外的额外操作（打标导出 / 回填） */
  function bindMonthExtras() {
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

    /* 月度打标表导出（面板里独立的那个区块） */
    const mtb = $("#rm-tag-export-btn");
    if (mtb) mtb.onclick = () => {
      const scope = ($("#rm-tag-scope") && $("#rm-tag-scope").value || "todo");
      const cat = ($("#rm-tag-cat") && $("#rm-tag-cat").value || "").trim();
      runMonthTagExport(mtb, { scope: scope, category: cat });
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { bindRhythmPanel(); bindMonthExtras(); });
  else { bindRhythmPanel(); bindMonthExtras(); }

  Object.assign(window, {
    enterRhythmPanel, loadRhythmBatches: loadRankBatches, loadRhythmSites: loadRankSites,
    loadRhythmCats: loadRankCats, doRhythmImport: doRankImport, onRhythmFileChange: onRankFileChange,
    computeRhythmFlags: computeFlags, rhythmPreviewRefresh: rankPreviewRefresh,
    renderRhythmPeriods: renderRankPeriods, fillRhythmPvControls: fillRankPvControls,
    computeRhythmCounts: computeRankCounts, rhythmBatchSlotKey: batchSlotKey, rhythmBatchSites: batchSites,
  });
  window.RhythmAdmin = {
    enter: enterRhythmPanel, reload: enterRhythmPanel,
    preview: rankPreviewRefresh, refresh: enterRhythmPanel,
    /* 纯函数开放给自检用：表头识别 / 组行 / 名次落位（不碰页面、不发请求） */
    _mapHeader: mapHeaderRow, _buildRows: buildRankImportRows, _applyRank: applyOfficialRank,
  };
}
