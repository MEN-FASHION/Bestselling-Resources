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
  let rankPeriods = [];   // 由上传记录聚合：[{label,type,rows,batches}]
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
    /* 标题列（20261112N）：组词台要吃 rank_items.title，但原先导入完全不读这一列，
       导致「榜单导进去了、组词台却是空的」。货品名称 / 商品名称 / 标题 都认。 */
    const iTitle = find(h => h.indexOf("货品名称") >= 0 || h.indexOf("商品名称") >= 0
      || h.indexOf("商品标题") >= 0 || h === "标题" || h.indexOf("货品标题") >= 0);
    const iLeaf = find(h => h.indexOf("叶子类目") >= 0 && !isIdHead(h));
    const iCat = find(h => h.indexOf("类目") >= 0 && h.indexOf("叶子") < 0 && !isIdHead(h));
    /* 期次列（一次导入多周用）：期次 / 周次 / 周期 / 周 */
    const iPeriod = find(h => h.indexOf("期次") >= 0 || h.indexOf("周次") >= 0
      || h.indexOf("周期") >= 0 || h === "周" || h === "week" || h === "period");
    if (iAbs < 0 && iRatio < 0 && iSite < 0 && iUrl < 0) return null;
    return { abs: iAbs, ratio: iRatio, site: iSite, url: iUrl,
             leaf: iLeaf >= 0 ? iLeaf : iCat, title: iTitle, period: iPeriod };
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
      // 周度激增：双重提升（比例上升且绝对值上升）中按环比比例降序的前 20%
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
    const box = $("#rank-pattern-print-switch");
    if (!box) return;
    try { rankPrintVisible = await SB.getPatternPrintVisible(); } catch (e) { rankPrintVisible = true; }
    renderRankPrintSwitch();
  }
  function renderRankPrintSwitch() {
    const box = $("#rank-pattern-print-switch");
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
    const note = $("#rank-pattern-print-note");
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
    const box = $("#rank-site-list");
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
    const box = $("#rank-group-list");
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
      const cb = l.querySelector('input');
      if (cb) cb.addEventListener("change", () => { if (rankParsed) renderRankPreview(); });
      box.appendChild(l);
    });
  }

  /* ---------- 类目下拉（复用「类目管理」，可自定义添加） ---------- */
  async function loadRankCats() {
    try { rankCats = await SB.listActiveCats(); } catch (e) { rankCats = []; }
    const sel = $("#rank-cat");
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
      /* 读取「所有能识别出表头的工作表」：
         一份工作簿常按周 / 按类目分成多个 sheet，原先只读第一个，
         结果是「一次导入」只能进一部分数据，其余 sheet 被静默丢掉。 */
      const rows = [];
      let noLink = 0, placeholderOnly = 0, resolvedFromLink = 0;
      const usedSheets = [];
      let firstHead = null;
      for (const sn of wb.SheetNames) {
        const ws = wb.Sheets[sn];
        if (!ws || !ws["!ref"]) continue;
        // raw:false → 取「显示值」，这样百分比格式的单元格拿到的是 "52220%" 而不是小数
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        const head = pickHeaderRow(aoa);
        if (!head) continue;                       // 说明页 / 空页：没有表头就跳过
        usedSheets.push(sn);
        if (!firstHead) firstHead = aoa[head.idx] || [];
        const rng = XLSX.utils.decode_range(ws["!ref"] || "A1");
        for (let i = head.idx + 1; i < aoa.length; i++) {
          const c = aoa[i] || [];
          const ci = head.map.url;
          let url = "";
          if (ci >= 0) {
            const cell = ws[XLSX.utils.encode_cell({ r: rng.s.r + i, c: rng.s.c + ci })];
            url = pickUrlFromCell(cell);
            if (url) resolvedFromLink++;
            const shown = String(c[ci] || "").trim();
            if (!url && URL_PLACEHOLDER.test(shown)) placeholderOnly++;
          }
          if (!url) { noLink++; continue; }
          rows.push({
            title: String(head.map.title >= 0 ? (c[head.map.title] || "") : "").trim(),
            period: String(head.map.period >= 0 ? (c[head.map.period] || "") : "").trim(),
            leaf_category: String(head.map.leaf >= 0 ? (c[head.map.leaf] || "") : "").trim(),
            site: String(head.map.site >= 0 ? (c[head.map.site] || "") : "").trim(),
            image_url: url,
            abs_delta: toNum(head.map.abs >= 0 ? c[head.map.abs] : null),
            ratio: toRatio(head.map.ratio >= 0 ? c[head.map.ratio] : null),
            hasSiteCol: head.map.site >= 0,
          });
        }
      }
      if (!usedSheets.length) {
        if (tip) tip.textContent = "❌ 未识别到表头，请确认表格含：销量站点 / 首图url / 环比绝对值 / 环比比例";
        return;
      }
      // 同一张图重复出现 → 合并后只留一条（与入库去重口径一致），提前告知
      const urlSeen = {};
      rows.forEach(r => { urlSeen[r.image_url] = (urlSeen[r.image_url] || 0) + 1; });
      const dupUrls = Object.keys(urlSeen).filter(u => urlSeen[u] > 1).length;
      const missing = [];
      /* 表头映射改从 firstHead 重新算（多 sheet 时 head 是循环内变量，出了循环不可见） */
      const hm = mapHeaderRow(firstHead || []) || {};
      const hasCol = (k) => typeof hm[k] === "number" && hm[k] >= 0;
      if (!hasCol("title")) missing.push("货品名称（标题组词台需要，缺这一列时组词台没有词可用）");
      if (!hasCol("abs")) missing.push("环比绝对值");
      if (!hasCol("ratio")) missing.push("环比比例");
      if (!hasCol("site")) missing.push("销量站点（勾选上方站点即可）");
      if (!hasCol("leaf")) missing.push("叶子类目名称（一次导入多个类目时需要）");
      const distinctSites = Object.keys(rows.reduce((m, r) => (r.site && (m[r.site] = 1), m), {}));
      const siteWarn = distinctSites.length > 1
        ? "⚠️ 表格里出现了 " + distinctSites.length + " 个站点（" + distinctSites.slice(0, 6).join("、") + (distinctSites.length > 6 ? "…" : "") + "）。若这是合计表（如欧盟），请在上方勾选目标站点，导入时会统一归入该站点。"
        : "";
      const urlWarn = (placeholderOnly > 0 && rows.length === 0)
        ? "❌ 「首图URL」列里放的是「查看首图」这类文字，没有真实网址（网址没有做成可点击的超链接）。请在表格里把该列改成纯网址（https://… 文本），或给单元格加上超链接后再上传。"
        : (noLink > 0
          ? "⚠️ 有 " + noLink + " 行没读到图片网址，已跳过（这些行的「首图URL」既不是网址、也没有超链接）。"
          : "");
      rankParsed = { rows, headers: firstHead || [], missing, siteWarn, urlWarn, dupUrls, resolvedFromLink,
        fileName: f.name, sheets: usedSheets };
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
    /* 表里同时带「期次」「叶子类目名称」时，可以一次导入多周多类目：
       预览里先算清楚会拆成几组，避免导完才发现类目对不上。 */
    const catSet = {}, perSet = {};
    rows.forEach(r => {
      if (r.leaf_category) catSet[r.leaf_category] = 1;
      if (r.period) perSet[r.period] = 1;
    });
    const nCats = Object.keys(catSet).length;
    const nPers = Object.keys(perSet).length;
    const groupNote = (nCats > 1 || nPers > 1)
      ? "将自动拆成 " + (nCats * (nPers || 1)) + " 组导入（期次 " + (nPers || 1) + " 个 · 类目 " + (nCats || 1) + " 个）"
      : "";
    /* 期次取值的来源必须写在脸上：上方那个日历是「表格没带期次列」时的兜底，
       表格自带期次时日历可以留空。不写清楚，用户会以为必须先挑一周才能导。 */
    const perList = Object.keys(perSet);
    const periodNote = perList.length
      ? "表格自带期次：" + perList.slice(0, 6).join("、")
        + (perList.length > 6 ? " ……（共 " + perList.length + " 个）" : "")
        + " —— 上方日历可以留空"
      : "";
    if (tip) tip.textContent = "✅ 已识别 " + rankParsed.fileName + "：共 " + rows.length + " 行"
      + (groupNote ? " · " + groupNote : "")
      + (periodNote ? " · " + periodNote : "");
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
        (rankParsed.urlWarn ? '<div class="hint rank-warn">' + escHtml(rankParsed.urlWarn) + '</div>' : '') +
        (rankParsed.dupUrls ? '<div class="hint rank-warn">表格里有 ' + rankParsed.dupUrls + ' 张图重复出现，同一个地区下会合并为一条（保留环比更强的那条）。</div>' : '') +
        (rankParsed.siteWarn ? '<div class="hint rank-warn">' + escHtml(rankParsed.siteWarn) + '</div>' : '') +
        (groupNote ? '<div class="hint"><b>' + groupNote + '</b> —— 表格自带「期次」/「叶子类目名称」列时，上方不用选期次和类目也可以导入（选了也不影响分组）。</div>' : '') +
        (periodNote ? '<div class="hint"><b>' + escHtml(periodNote) + '</b>。导入后前台就按这些期次名显示，若与「已上传记录」里已有的写法不同（例如旧的写 W41），会变成两个不同期次 —— 想让旧数据被覆盖，就把表格这一列改成旧写法。</div>' : '') +
        '<div class="hint">站点归属：<b>' + (document.querySelectorAll('#rank-site-defaults input[type="checkbox"]:checked').length ? "以「国家站点」勾选的为准 —— 整张表都算这个地区，表格里的「销量站点」列不生效" : "未勾选站点 → 按表格「销量站点」列逐行取（合计表请务必先勾选，如欧盟）") + '</b>；标签按「站点 + 期次 + 类目」分池计算（每个国家各自排名）。</div>';
    }
    const btn = $("#rank-import");
    if (btn) btn.disabled = rows.length === 0;
  }

  /* ---------- 期次选择（周度/月度 + 日历） ---------- */
  function rankPeriodMode() {
    const el = document.querySelector('input[name="rank-period"]:checked');
    return el ? el.value : "week";
  }
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
  function syncRankPeriodLabel() {
    const lab = $("#rank-period-label");
    if (!lab) return "";
    if (rankPeriodMode() === "month") {
      const mv = $("#rank-period-month") ? $("#rank-period-month").value : "";
      lab.value = mv || "";
    } else {
      const dv = $("#rank-period-date") ? $("#rank-period-date").value : "";
      const w = dv ? isoWeekLabel(dv) : "";
      lab.value = w || "";
      const out = $("#rank-period-week");
      if (out) out.textContent = w || "—";
    }
    return lab.value;
  }
  function initRankPeriodPickers() {
    const now = new Date();
    const pad = (n) => (n < 10 ? "0" : "") + n;
    const iso = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    const dEl = $("#rank-period-date"), mEl = $("#rank-period-month");
    if (dEl && !dEl.value) dEl.value = iso;
    if (mEl && !mEl.value) mEl.value = iso.slice(0, 7);
    const flip = () => {
      const wk = $("#rank-pw-wrap"), mo = $("#rank-pm-wrap");
      const isWeek = rankPeriodMode() === "week";
      if (wk) wk.style.display = isWeek ? "" : "none";
      if (mo) mo.style.display = isWeek ? "none" : "";
      syncRankPeriodLabel();
    };
    const rs = document.querySelectorAll('input[name="rank-period"]');
    Array.prototype.forEach.call(rs, (r) => { if (r.addEventListener) r.addEventListener("change", flip); });
    if (dEl && dEl.addEventListener) dEl.addEventListener("change", syncRankPeriodLabel);
    if (mEl && mEl.addEventListener) mEl.addEventListener("change", syncRankPeriodLabel);
    flip();
  }

  /* ---------- 导入 ---------- */
  /* 计算「本次上传要写入的行」：站点归属展开 + 表内同一张图合并。
     纯函数（不碰页面、不发请求），便于拿真实表格做验证。
       - 勾选了站点（useMine）→ 每一行都归入勾选的站点，忽略表格里「销量站点」列的值
       - 未勾选 → 按表格里每行自带的「销量站点」取值
       - 同一站点内同一张图重复出现 → 只保留一条（mergedInFile 记录合并掉的条数） */
  function buildRankImportRows(rows, opt) {
    const o = opt || {};
    const periodType = o.periodType || "week";
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
          title: r.title || "",
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

  /* 一次导入多期次 / 多类目：按「期次 + 类目」把行分组，每组各建一个上传批次。
     以前只能「一个批次 = 一个期次 + 一个类目」，所以一周 200 个类目要传 200 次；
     现在表里带「期次」「叶子类目名称」列，一次上传就能全部分好组。
     组内仍然走原来的口径（覆盖 / 追加、站点归属、同图合并），行为一致。 */
  function groupRankRows(rows, opt) {
    const o = opt || {};
    const periodType = o.periodType || "week";
    const defPeriod = String(o.periodLabel || "").trim();
    const defCat = String(o.category || "").trim();
    const useMine = !!o.useMine && (o.sites || []).length > 0;
    const groups = new Map();
    let noSite = 0, noCat = 0, noPeriod = 0, tableCatOverrode = 0;
    (rows || []).forEach(r => {
      const period = String(r.period || "").trim() || defPeriod;
      /* 类目为空不再丢行：先落到界面选的类目，再落到「其他」。
         以前这里直接 return，导致原表类目栏为空的整批行被静默丢掉
         （一次导入少几千条，看着像导入失败）。 */
      let cat = String(r.leaf_category || "").trim() || defCat;
      if (!cat) { cat = "其他"; noCat++; }
      if (!period) noPeriod++;
      if (!period) return;
      if (r.leaf_category && defCat && String(r.leaf_category).trim() !== defCat) tableCatOverrode++;
      const targets = useMine ? o.sites : (r.site ? [r.site] : []);
      if (!targets.length) { noSite++; return; }
      const key = period + "\u0000" + cat;
      let g = groups.get(key);
      if (!g) { g = { period: period, category: cat, rows: [], siteSet: {} }; groups.set(key, g); }
      targets.forEach(site => {
        g.rows.push({
          period_type: periodType, period_label: period, category: cat, site: site,
          leaf_category: r.leaf_category, image_url: r.image_url, title: r.title || "",
          ratio: r.ratio, abs_delta: r.abs_delta,
        });
        g.siteSet[site] = 1;
      });
    });
    const list = Array.from(groups.values());
    list.forEach(g => { g.slotSites = Object.keys(g.siteSet); });
    return { groups: list, noSite: noSite, noCat: noCat, noPeriod: noPeriod, tableCatOverrode: tableCatOverrode };
  }

  async function doRankImport() {
    if (!rankParsed || !rankParsed.rows.length) { sbToast("请先上传并解析 Excel", false); return; }
    const periodType = (document.querySelector('input[name="rank-period"]:checked') || {}).value || "week";
    const periodLabel = ($("#rank-period-label").value || "").trim();
    const category = ($("#rank-cat").value || "").trim();
    const defaults = [...document.querySelectorAll('#rank-site-defaults input[type="checkbox"]:checked')].map(c => c.value);

    /* 安全网：整批网址全都一样，说明「首图URL」列里的不是真网址（例如整列都写着「查看首图」）。 */
    const uniqUrl = Object.keys(rankParsed.rows.reduce((m, r) => (m[r.image_url] = 1, m), {})).length;
    if (rankParsed.rows.length > 1 && uniqUrl === 1) {
      sbToast("「首图URL」列里 200 行都是同一个内容（不是图片网址），无法导入。请把该列改成真实网址文本、或给单元格加超链接后再上传。", false);
      return;
    }

    const useMine = defaults.length > 0;
    const gf = groupRankRows(rankParsed.rows, {
      periodType: periodType, periodLabel: periodLabel, category: category, sites: defaults, useMine: useMine,
    });
    if (!gf.groups.length) {
      if (gf.noCat) sbToast("表格没有「叶子类目」列，且未选择类目 —— 请选一个类目，或让表格带上类目列", false);
      else if (gf.noPeriod) sbToast(periodType === "month" ? "请先用日历选择月份，或让表格带上「期次」列" : "请先用日历选择某一周，或让表格带上「期次」列", false);
      else if (gf.noSite) sbToast("表格没有「销量站点」列，且未选择默认站点", false);
      else sbToast("没有可导入的有效行", false);
      return;
    }

    const mode = (document.querySelector('input[name="rank-mode"]:checked') || {}).value === "append" ? "append" : "replace";
    const btn = $("#rank-import");
    if (btn) { btn.disabled = true; btn.textContent = "导入中…"; }
    const multi = gf.groups.length > 1;
    try {
      let inserted = 0, clearedItems = 0, skippedExisting = 0, mergedInFile = 0;
      let done = 0;
      const failed = [];
      /* 回撤用：本次动过的槽位 + 覆盖前读到的旧数据（留底） */
      const undoGroups = [];
      const backupRows = [];
      let backupFail = false;
      const periodSet = {}, catSet = {};

      /* 串行导入在「一周上百个类目」时等于几百次串行网络往返，界面只显示「导入中…」
         一直不动，用户会以为卡死。改成固定并发的小池子，并把进度打到按钮上。 */
      const TOTAL = gf.groups.length;
      const CONC = 4;
      const GROUP_TIMEOUT_MS = 90000;
      let cursor = 0;
      if (btn && TOTAL > 4) btn.textContent = "导入中 0/" + TOTAL;
      if (TOTAL > 4) {
        sbToast("共 " + TOTAL + " 组，正在导入（每批同时进行 4 组）。按钮上会显示进度，导完前请不要关闭页面。", true);
      }
      const runGroup = async (g) => {
        try {
          const seen = {};
          const list = [];
          let merged = 0;
          g.rows.forEach(r => {
            const k = r.site + "\u0000" + r.image_url;
            if (seen[k]) { merged++; return; }
            seen[k] = 1; list.push(r);
          });
          computeFlags(list);

          const slot = { periodType: periodType, periodLabel: g.period, category: g.category, sites: g.slotSites };
          let cleared = { items: 0, batches: 0 };
          let skipped = 0;
          let rows = list;
          if (mode === "replace") {
            /* 先留底再清空：读不到旧数据时宁可不留底也要继续，
               但会标记出来，导入完成后明确提示「这次没有留底」。 */
            try {
              const old = await SB.listRankItems({
                periodType: periodType, periods: [g.period], category: g.category,
                sites: g.slotSites, max: 60000,
              });
              for (const r of (old || [])) backupRows.push(r);
            } catch (e) { backupFail = true; }
            cleared = await SB.clearRankSlot(slot);
          } else {
            const exist = await SB.listRankSlotUrls(slot);
            const f = filterNotExisting(list, exist);
            rows = f.rows;
            skipped = f.skipped;
          }
          const batchSite = useMine ? defaults.join(",") : g.slotSites.join(",");
          const batchId = await SB.createRankBatch({ periodType: periodType, periodLabel: g.period, category: g.category, site: batchSite });
          const payload = rows.map(r => {
            const o = Object.assign({}, r, { batch_id: batchId });
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
          periodSet[g.period] = 1;
          catSet[g.category] = 1;
          if (ins > 0) undoGroups.push({ period: g.period, category: g.category, sites: g.slotSites });
          if (payload.length > 0 && ins === 0) failed.push(g.period + " · " + g.category + "：0 条写入");
        } catch (e) {
          failed.push(g.period + " · " + g.category + "：" + ((e && e.message) || "失败"));
        }
      };
      /* 光靠按钮文字不够显眼（按钮在很下面，用户视线往往停在页面上方），
         这里再挂一条常驻进度：每秒刷新一次「已运行 / 完成组数 / 已写入条数」，
         即使某一组很慢，也能看到秒数在动，不会误以为卡死。 */
      const t0 = Date.now();
      let progEl = null;
      try {
        progEl = document.getElementById("rank-import-progress");
        if (!progEl && btn && btn.parentNode) {
          progEl = document.createElement("div");
          progEl.id = "rank-import-progress";
          progEl.className = "hint rank-progress";
          btn.parentNode.insertBefore(progEl, btn);
        }
      } catch (e) { progEl = null; }
      const paintBar = () => {
        if (!progEl) return;
        const sec = Math.max(0, Math.round((Date.now() - t0) / 1000));
        progEl.textContent = "⏳ 导入中 · 已运行 " + sec + " 秒 · 已完成 " + done + "/" + TOTAL
          + " 组 · 已写入 " + inserted + " 条" + (failed.length ? " · 失败 " + failed.length + " 组" : "");
      };
      paintBar();
      const ticker = setInterval(paintBar, 1000);
      try { window.__rankImportTicker = ticker; } catch (e) { /* 忽略 */ }

      const paintProgress = () => {
        if (!btn) return;
        btn.textContent = TOTAL > 4
          ? ("导入中 " + done + "/" + TOTAL + "（已写入 " + inserted + " 条）")
          : "导入中…";
      };
      await Promise.all(Array.from({ length: Math.min(CONC, TOTAL) }, async () => {
        for (;;) {
          const i = cursor++;
          if (i >= TOTAL) return;
          const g = gf.groups[i];
          /* 单组卡住也要有个上限：超时记为失败，继续下一组，不至于整批永远转。
             超时的组可能已经在服务端写入，所以文案要说明「可能已部分写入」。 */
          await Promise.race([
            runGroup(g),
            new Promise(resolve => setTimeout(() => {
              failed.push(g.period + " · " + g.category + "：等待超时（可能已部分写入，导完请核对）");
              resolve();
            }, GROUP_TIMEOUT_MS)),
          ]);
          paintProgress();
          paintBar();
        }
      }));
      clearInterval(ticker);
      try { window.__rankImportTicker = null; } catch (e) { /* 忽略 */ }
      if (progEl) { progEl.textContent = "✅ " + TOTAL + " 组已处理完 · 共 " + Math.round((Date.now() - t0) / 1000) + " 秒"; }

      const nPeriod = Object.keys(periodSet).length;
      const nCat = Object.keys(catSet).length;
      const head = multi
        ? "已按时段与类目拆成 " + gf.groups.length + " 组（期次 " + nPeriod + " 个 · 类目 " + nCat + " 个）导入："
        : "导入完成：";
      let msg = head
        + (useMine ? "按我定义的站点归入「" + defaults.join("、") + "」" : "按表格站点列归入")
        + "，写入 " + inserted + " 条";
      if (mode === "replace" && clearedItems > 0) msg += "（已替换旧数据 " + clearedItems + " 条）";
      if (mode === "append" && skippedExisting > 0) msg += "（库里已存在 " + skippedExisting + " 条未重复写入）";
      if (mergedInFile > 0) msg += "（表内同图重复 " + mergedInFile + " 次，已合并）";
      if (failed.length) msg += " · 失败 " + failed.length + " 组：" + failed.slice(0, 3).join("；") + (failed.length > 3 ? "…" : "");
      sbToast(msg, failed.length === 0 && inserted > 0);

      /* 记录下一次可撤销的导入，并在有旧数据时自动下载留底表 */
      if (undoGroups.length) {
        const info = {
          at: Date.now(), periodType: periodType, inserted: inserted,
          groups: undoGroups, backupRows: backupRows.length, mode: mode,
        };
        setRankUndoInfo(info);
        renderRankUndo();
        if (backupRows.length) {
          try {
            const saved = exportRankBackup(backupRows, info);
            if (saved) {
              sbToast("导入前原有 " + backupRows.length + " 条数据已留底：已下载「榜单原数据留底」表。"
                + "若要还原，把这张表原样导回来即可；也可以先点「撤销本次导入」。", true);
            }
          } catch (e) {
            sbToast("留底表生成失败，但数据已记录，可点「撤销本次导入」回退。", false);
          }
        } else if (backupFail) {
          sbToast("提示：这次覆盖前未能读到旧数据，没有生成留底表。若发现数据不对，请立刻点「撤销本次导入」并停止继续导入。", false);
        }
      }

      rankParsed = null;
      $("#rank-file").value = "";
      $("#rank-file-tip").textContent = "";
      $("#rank-preview").innerHTML = "";
      await loadRankBatches();
    } catch (e) {
      sbToast("导入失败：" + ((e && e.message) || "请重试"), false);
    } finally {
      /* 异常路径也要停掉进度计时器，否则文字会一直跳 */
      try { if (window.__rankImportTicker) { clearInterval(window.__rankImportTicker); window.__rankImportTicker = null; } } catch (e) { /* 忽略 */ }
      if (btn) { btn.disabled = false; btn.textContent = "导入榜单"; }
    }
  }

  /* ---------- 已上传记录：条数口径 ----------
     条数一律按「期次 + 类目 + 站点」这个槽位向数据库精确计数。
     不采用「一次性把全表拉回来自己在浏览器里数」的做法：接口单次返回有上限，
     榜单数据一多就被截断，于是上传记录显示的条数会凭空变少（几个/几十个），
     而前台是按槽位分次查的、看到的是完整的 200 条 —— 两边就会对不上。
     精确计数失败时退回批次自带条数，绝不当成 0。 */
  /* ---------- 回撤：导入前自动留底 + 一键撤销 ----------
     用户担心的场景：一次批量导入（一次可能几百组）中途失败或把类目/站点认错，
     旧数据已经被「覆盖」清掉，就再也找不回来。
     两道保护：
       ① 覆盖前先把该槽位的原有数据整份读出来，导入结束自动下载成「留底表」；
          留底表的列与导入表完全一致，原样再导入一遍即可还原。
       ② 「撤销本次导入」按钮：把本次写入的槽位整体清空，回到导入前的空状态，
          再导留底表即可回到原样。撤销不碰其它期次与类目。 */
  const RANK_UNDO_KEY = "sb.rank.lastImport";

  function rankUndoInfo() {
    try { return JSON.parse(localStorage.getItem(RANK_UNDO_KEY) || "null"); } catch (e) { return null; }
  }
  function setRankUndoInfo(o) {
    try {
      if (o) localStorage.setItem(RANK_UNDO_KEY, JSON.stringify(o));
      else localStorage.removeItem(RANK_UNDO_KEY);
    } catch (e) { /* 无痕模式等不可写时忽略 */ }
  }
  function rankUndoText(info) {
    if (!info) return "";
    let when = "";
    try {
      const t = new Date(info.at);
      const p2 = (n) => String(n).padStart(2, "0");
      when = (t.getMonth() + 1) + "-" + t.getDate() + " " + p2(t.getHours()) + ":" + p2(t.getMinutes());
    } catch (e) { when = ""; }
    return "最近一次导入：" + (when ? when + " · " : "")
      + (info.groups || []).length + " 组 · 写入 " + info.inserted + " 条"
      + (info.backupRows > 0
        ? " · 原数据 " + info.backupRows + " 条已随留底表下载"
        : " · 这些槽位导入前没有数据");
  }
  function renderRankUndo() {
    const btn = $("#rank-undo"), tip = $("#rank-undo-tip");
    const info = rankUndoInfo();
    if (btn) {
      if (info && (info.groups || []).length) {
        btn.style.display = "";
        btn.textContent = "撤销本次导入（" + info.inserted + " 条）";
      } else {
        btn.style.display = "none";
      }
    }
    if (tip) tip.textContent = info ? rankUndoText(info) : "";
  }

  /* 把导入前读到的旧数据写成与导入表同结构的表格，供还原时原样导入 */
  function exportRankBackup(rows, info) {
    if (!window.XLSX) return false;
    const header = ["期次", "叶子类目名称", "销量站点", "首图url", "货品名称", "环比比例", "环比绝对值"];
    const body = (rows || []).map((r) => [
      r.period_label || "", r.category || "", r.site || "", r.image_url || "", r.title || "",
      (r.rank_ratio === null || r.rank_ratio === undefined || r.rank_ratio === "") ? "" : (String(r.rank_ratio) + "%"),
      (r.rank_abs === null || r.rank_abs === undefined) ? "" : r.rank_abs,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header].concat(body));
    const note = XLSX.utils.aoa_to_sheet([
      ["导入前留底（原样可再导入）"],
      [""],
      ["用途", "这张表是「本次导入之前」库里的原有数据，覆盖前的快照。"],
      ["还原方法", "到「趋势上升榜」导入区，用这张表按原样导入：期次与类目列已带，站点一个都不勾，模式选覆盖。"],
      ["导入时间", info && info.at ? new Date(info.at).toLocaleString() : new Date().toLocaleString()],
      ["本次写入", info ? info.inserted : ""],
      ["留底条数", body.length],
      ["涉及槽位", (info && info.groups ? info.groups.map((g) => g.period + " · " + g.category).join("；") : "")],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "原数据");
    XLSX.utils.book_append_sheet(wb, note, "说明");
    const d = new Date();
    const stamp = "" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0")
      + "_" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0");
    XLSX.writeFile(wb, "榜单原数据留底_" + stamp + ".xlsx");
    return true;
  }

  async function doRankUndo() {
    const info = rankUndoInfo();
    const groups = (info && info.groups) || [];
    if (!groups.length) { sbToast("没有可撤销的导入记录", false); return; }
    const ask = "撤销这次导入？\n\n"
      + "将清空本次写入的 " + info.inserted + " 条（" + groups.length + " 组）。"
      + (info.backupRows > 0
        ? "\n\n导入前的原数据已留底在那份「榜单原数据留底」表里 —— 撤销后把那张表原样导入，就能还原。"
        : "\n\n这些槽位导入前本来就没有数据，撤销后即为空。")
      + "\n\n不会影响其它期次与类目。";
    /* 只用站内确认弹窗：原生 confirm 会被浏览器拦成「阻止此页面创建更多对话框」，
       并且在部分环境里直接返回 false，看起来就像按钮点了没反应。 */
    if (typeof uiConfirm !== "function") {
      sbToast("确认弹窗未加载，请强刷页面后重试（未做任何删除）", false);
      return;
    }
    let ok = false;
    try { ok = await uiConfirm(ask); } catch (e) { ok = false; }
    if (!ok) return;

    const btn = $("#rank-undo");
    if (btn) { btn.disabled = true; btn.textContent = "撤销中…"; }
    try {
      let removed = 0;
      const failed = [];
      for (const g of groups) {
        try {
          const n = await SB.deleteRankItemsByScope({
            periodType: info.periodType || "week",
            periodLabel: g.period, category: g.category, sites: g.sites || [],
          });
          removed += n;
        } catch (e) {
          failed.push(g.period + " · " + g.category);
        }
      }
      setRankUndoInfo(null);
      renderRankUndo();
      try { await loadRankBatches(); } catch (e) { /* 列表刷新失败不影响撤销结果 */ }
      const msg = "已撤销：清空 " + removed + " 条"
        + (failed.length ? " · " + failed.length + " 组失败（" + failed.slice(0, 3).join("；") + "）" : "")
        + (removed > 0 ? " · 如需还原，导入留底表即可" : "");
      sbToast(msg, failed.length === 0);
    } catch (e) {
      sbToast("撤销失败：" + ((e && e.message) || "请重试"), false);
    } finally {
      if (btn) btn.disabled = false;
      renderRankUndo();
    }
  }

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
  /* 限并发执行：串行发几百个计数请求会让「已上传记录」一直转圈 */
  async function rankPool(tasks, size) {
    const list = tasks || [];
    const out = new Array(list.length);
    let idx = 0;
    const worker = async () => {
      while (idx < list.length) {
        const i = idx++;
        try { out[i] = await list[i](); } catch (e) { out[i] = null; }
      }
    };
    const n = Math.max(1, Math.min(size || 6, list.length || 1));
    await Promise.all(Array.from({ length: n }, worker));
    return out;
  }

  /* 算出「每个槽位」与「每个期次」的真实条数（去重后各查一次，避免重复请求）
     注意：必须并发。类目多时（一次批量导入能建出两百多个槽位）串行等于把
     几百次往返排成一列，界面上就是一直「正在加载…」。 */
  async function computeRankCounts(list, opt) {
    const countFn = (opt && opt.countFn) || ((o) => SB.countRankSlot(o));
    const bySlot = {}, byPeriod = {};
    const slotSeen = new Map(), periodSeen = new Map();
    (list || []).forEach((b) => {
      const sk = batchSlotKey(b);
      if (!slotSeen.has(sk)) slotSeen.set(sk, {
        periodType: b.period_type || "week", periodLabel: b.period_label || "",
        category: b.category || "", sites: batchSites(b),
      });
      const pk = batchPeriodKey(b);
      if (!periodSeen.has(pk)) periodSeen.set(pk, {
        periodType: b.period_type || "week", periodLabel: b.period_label || "",
        category: "", sites: [],
      });
    });
    const tasks = [];
    /* 槽位太多时（批量导入能建出两百多个）改用量级兜底：期次仍然精确查，
       槽位沿用上传记录里的条数（界面标 ≈）。否则光计数就要发两百多次请求。 */
    const slotBudget = 80;
    const doSlot = slotSeen.size <= slotBudget;
    if (doSlot) slotSeen.forEach((o, k) => tasks.push(async () => {
      let n = null;
      try { n = await countFn(o); } catch (e) { n = null; }
      bySlot[k] = (typeof n === "number" && isFinite(n)) ? n : null;
    }));
    periodSeen.forEach((o, k) => tasks.push(async () => {
      let n = null;
      try { n = await countFn(o); } catch (e) { n = null; }
      byPeriod[k] = (typeof n === "number" && isFinite(n)) ? n : null;
    }));
    await rankPool(tasks, 8);
    return { bySlot: bySlot, byPeriod: byPeriod };
  }

  /* ---------- 已上传记录 ---------- */
  let rankTitleWarned = false;
  /* 缺 title 列时接口会刷 400、标题写不进去 —— 这里主动查一次并说清楚 */
  async function checkRankTitleColumn(box) {
    if (!box || rankTitleWarned) return;
    let r = null;
    try { r = await SB.probeRankTitleColumn(); } catch (e) { r = null; }
    if (!r || r.ok || !r.missing) return;
    rankTitleWarned = true;
    const tip = document.createElement("div");
    tip.className = "rkadm-warn";
    tip.innerHTML = "⚠️ 榜单表缺少「标题」列：导入时标题写不进去，标题组词台会一直没词。"
      + "处理办法——在数据库 rank_items 表里新增一列 <b>title</b>（text，可空），刷新本页后重新导入。"
      + "控制台里那些 400 就是这条缺列报出来的。";
    const host = box.parentNode;
    if (host) host.insertBefore(tip, box);
  }

  /* 勾选删除：一次批量导入会建出上百个批次，逐条删太慢 */
  function ensureBatchToolbar(box) {
    const host = box && box.parentNode;
    if (!host) return null;
    let bar = host.querySelector("#rank-batch-toolbar");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "rank-batch-toolbar";
    bar.className = "rank-batch-toolbar";
    const selAll = document.createElement("button");
    selAll.type = "button"; selAll.className = "btn-ghost small"; selAll.textContent = "全选";
    const delSel = document.createElement("button");
    delSel.type = "button"; delSel.className = "btn-ghost small"; delSel.textContent = "删除选中（0）";
    delSel.disabled = true;
    const catBtn = document.createElement("button");
    catBtn.type = "button"; catBtn.className = "btn-ghost small"; catBtn.textContent = "类目清理…";
    const chkBtn = document.createElement("button");
    chkBtn.type = "button"; chkBtn.className = "btn-ghost small"; chkBtn.textContent = "数据自检…";
    bar.appendChild(selAll); bar.appendChild(delSel); bar.appendChild(catBtn); bar.appendChild(chkBtn);
    host.insertBefore(bar, box);

    const picked = () => Array.from(box.querySelectorAll(".rank-batch-pick:checked")).map((el) => el.value);
    const refresh = () => {
      const n = picked().length;
      delSel.textContent = "删除选中（" + n + "）";
      delSel.disabled = n === 0;
      const boxes = box ? box.querySelectorAll(".rank-batch-pick") : [];
      selAll.disabled = !boxes.length;
      if (!boxes.length) selAll.textContent = "全选";
    };
    bar._refresh = refresh;
    /* 导入看起来成功、前台却看不到数据时，先跑这个：说清「库里有多少条」和「前台筛选读到什么」 */
    chkBtn.onclick = async () => {
      if (chkBtn.disabled) return;
      chkBtn.disabled = true;
      chkBtn.textContent = "自检中…";
      try {
        const r = await SB.rankSelfCheck();
        const L = [];
        L.push("【库里】榜单条目 " + (r.items || 0) + " 条");
        const types = Object.keys(r.byType || {});
        if (types.length) L.push("　　按类型：" + types.map((k) => (k === "month" ? "月度" : "周度") + " " + r.byType[k] + " 条").join("、"));
        if ((r.byPeriod || []).length) L.push("　　期次：" + r.byPeriod.slice(0, 6).map((p) => (p.period_label || "(空)") + " " + p.n + " 条").join("、"));
        L.push("");
        L.push("【前台能筛选到的】期次 " + (r.periods || []).length + " 个 · 类目 " + (r.categories || []).length + " 个 · 站点 " + (r.sites || []).length + " 个");
        if ((r.periods || []).length) L.push("　　期次：" + r.periods.slice(0, 6).join("、"));
        if ((r.categories || []).length) L.push("　　类目：" + r.categories.slice(0, 6).join("、"));
        L.push("");
        if (!r.items) {
          L.push("结论：库里一条都没有，导入没真正写进去。请重导一次，并看导入结束时列出的失败组。");
        } else if (!(r.periods || []).length) {
          L.push("结论：条目在，但前台筛选清单是空的 —— 前台读不到。请重新导一次（会重建汇总），或联系我处理。");
        } else {
          L.push("结论：数据与前台筛选都正常。若前台页面仍空白，多半是页面上的类目/期次/站点筛选没选对，或还没强刷。");
        }
        if (r.error) L.push("（附带提示：" + r.error + "）");
        await uiAlert(L.join("\n"), { title: "榜单数据自检" });
      } catch (e) {
        sbToast("自检失败：" + ((e && e.message) || "请重试"), false);
      } finally {
        chkBtn.disabled = false;
        chkBtn.textContent = "数据自检…";
      }
    };
    selAll.onclick = () => {
      const boxes = Array.from(box.querySelectorAll(".rank-batch-pick"));
      const allOn = boxes.length && boxes.every((el) => el.checked);
      boxes.forEach((el) => { el.checked = !allOn; });
      selAll.textContent = allOn ? "全选" : "取消全选";
      refresh();
    };
    delSel.onclick = async () => {
      const ids = picked();
      if (!ids.length) return;
      if (!(await uiConfirm("删除选中的 " + ids.length + " 个批次，并清空它们所在槽位（期次+类目+站点）的全部榜单条目？\n若同一槽位还有别的批次，那些数据也会一起被清掉。图片标签不受影响。\n删掉后不会自动回来。"))) return;
      delSel.disabled = true;
      let done = 0, bad = 0;
      for (const id of ids) {
        try { await SB.deleteRankBatch(id); done += 1; } catch (e) { bad += 1; }
        delSel.textContent = "删除中 " + (done + bad) + "/" + ids.length;
      }
      await loadRankBatches(); rankPreviewRefresh();
      sbToast("已删除 " + done + " 个批次" + (bad ? "，失败 " + bad + " 个" : ""), bad === 0);
    };
    catBtn.onclick = () => openRankCategoryTools(bar);
    return bar;
  }

  /* 类目清理：一次导入按表格里的类目名建批次，很容易冒出「POLO / Polo 衫 / T 恤 / T恤」这类重复 */
  async function openRankCategoryTools(bar) {
    let panel = document.getElementById("rank-cat-tools");
    if (panel && panel.dataset.open === "1") { panel.dataset.open = "0"; panel.innerHTML = ""; return; }
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "rank-cat-tools";
      panel.className = "rank-cat-tools";
      bar.parentNode.insertBefore(panel, bar.nextSibling);
    }
    panel.dataset.open = "1";
    panel.innerHTML = '<div class="hint">正在读取类目…</div>';
    let cats = [];
    try { cats = await SB.listRankCategories(); } catch (e) { cats = null; }
    if (!cats) { panel.innerHTML = '<div class="hint">类目读取失败，请重试。</div>'; return; }
    if (!cats.length) { panel.innerHTML = '<div class="hint">还没有类目。</div>'; return; }
    panel.innerHTML = '<div class="hint">共 ' + cats.length + ' 个类目。可疑重复（同音/大小写/空格/全半角不同）可直接合并，多余的整类删除。</div>';

    /* 批量清理：一次导入可能带进几十上百个类目，逐个点不现实 */
    const cbar = document.createElement("div");
    cbar.className = "rank-cat-bar";
    const cAll = document.createElement("button");
    cAll.type = "button"; cAll.className = "btn-ghost small"; cAll.textContent = "全选";
    const cNum = document.createElement("button");
    cNum.type = "button"; cNum.className = "btn-ghost small"; cNum.textContent = "只选数字类目";
    const cDel = document.createElement("button");
    cDel.type = "button"; cDel.className = "btn-ghost small danger"; cDel.textContent = "删除选中";
    const cNote = document.createElement("span");
    cNote.className = "rank-cat-meta";
    const pickedCats = () => Array.from(panel.querySelectorAll(".rank-cat-pick:checked")).map((x) => x.dataset.cat);
    const refreshCbar = () => {
      const n = pickedCats().length;
      cDel.textContent = "删除选中" + (n ? "（" + n + "）" : "");
      cDel.disabled = n === 0;
      const allOn = panel.querySelectorAll(".rank-cat-pick").length === n && n > 0;
      cAll.textContent = allOn ? "取消全选" : "全选";
    };
    cAll.onclick = () => {
      const allOn = cAll.textContent === "取消全选";
      panel.querySelectorAll(".rank-cat-pick").forEach((x) => { x.checked = !allOn; });
      refreshCbar();
    };
    cNum.onclick = () => {
      panel.querySelectorAll(".rank-cat-pick").forEach((x) => { x.checked = /^\d+$/.test(x.dataset.cat); });
      refreshCbar();
    };
    cDel.onclick = async () => {
      const cats_ = pickedCats();
      if (!cats_.length) return;
      if (!(await uiConfirm("删除选中的 " + cats_.length + " 个类目？\n这些类目在所有期次下的全部条目都会被删掉，删了不会自动回来。"))) return;
      cDel.disabled = true;
      let done = 0, bad = 0, rows = 0;
      for (const c of cats_) {
        try { const r = await SB.deleteRankCategory(c); rows += (r && r.items) || 0; done += 1; }
        catch (e) { bad += 1; }
        cNote.textContent = "清理中 " + (done + bad) + "/" + cats_.length + " · 已删 " + rows + " 条";
      }
      await loadRankBatches(); rankPreviewRefresh();
      sbToast("已删除 " + done + " 个类目（" + rows + " 条）" + (bad ? "，失败 " + bad + " 个" : ""), bad === 0);
      openRankCategoryTools(bar);
    };
    cbar.appendChild(cAll); cbar.appendChild(cNum); cbar.appendChild(cDel); cbar.appendChild(cNote);
    panel.appendChild(cbar);

    cats.forEach((c) => {
      const row = document.createElement("div");
      row.className = "rank-cat-row";
      const pick = document.createElement("input");
      pick.type = "checkbox"; pick.className = "rank-cat-pick";
      pick.dataset.cat = c.category || "";
      pick.onchange = refreshCbar;
      row.appendChild(pick);
      const name = document.createElement("span");
      name.className = "rank-cat-name";
      name.textContent = c.category || "(未填类目)";
      const meta = document.createElement("span");
      meta.className = "rank-cat-meta";
      meta.textContent = (c.batches || 0) + " 批 · " + (c.exact ? "" : "约 ") + c.rows + " 条 · " + c.periods + " 个期次" + (c.batches ? "" : " · 无台账");
      const merge = document.createElement("button");
      merge.type = "button"; merge.className = "btn-ghost small"; merge.textContent = "合并到…";
      merge.onclick = async () => {
        const v = (await uiPrompt("把「" + (c.category || "(未填类目)") + "」的全部条目并入哪个类目？\n填目标类目名（不存在会新建）：", c.category) || "").trim();
        if (!v || v === c.category) return;
        if (!(await uiConfirm("确认把「" + c.category + "」并入「" + v + "」？\n重复的图会自动跳过，源类目随后删除。"))) return;
        try {
          const n = await SB.renameRankCategory(c.category, v);
          await loadRankBatches(); rankPreviewRefresh();
          sbToast("已并入「" + v + "」（迁移 " + n + " 条）", true);
          panel.dataset.open = "0"; openRankCategoryTools(bar);
        } catch (e) { sbToast((e && e.message) || "合并失败", false); }
      };
      const wipe = document.createElement("button");
      wipe.type = "button"; wipe.className = "btn-ghost small"; wipe.textContent = "整类删除";
      wipe.onclick = async () => {
        if (!(await uiConfirm("删除类目「" + (c.category || "(未填类目)") + "」的全部数据？\n含 " + c.batches + " 个批次、约 " + c.rows + " 条，所有期次都会删。"))) return;
        try {
          const r = await SB.deleteRankCategory(c.category);
          await loadRankBatches(); rankPreviewRefresh();
          sbToast("已删除该类目（" + r.items + " 条 / " + r.batches + " 批）", true);
          panel.dataset.open = "0"; openRankCategoryTools(bar);
        } catch (e) { sbToast((e && e.message) || "删除失败", false); }
      };
      row.appendChild(name); row.appendChild(meta); row.appendChild(merge); row.appendChild(wipe);
      panel.appendChild(row);
    });
    refreshCbar();
  }

  async function loadRankBatches() {
    const box = $("#rank-batch-list");
    let list = [];
    try { list = await SB.listRankBatches(); } catch (e) { list = []; }

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
    fillExportPeriods();
    fillRankPvControls();
    loadRankPrintSwitch();          /* 图案印花款开关：每次进面板按库里最新值渲染 */

    if (!box) return;
    checkRankTitleColumn(box);
    if (!list.length) {
      box.innerHTML = '<div class="rkadm-empty">还没有上传记录。若类目仍存在，点上方「类目清理…」查看并删除。</div>';
      const tb = document.getElementById("rank-batch-toolbar");
      if (tb) { tb.style.display = ""; if (tb._refresh) tb._refresh(); }
      else {
        const fresh = ensureBatchToolbar(box);
        if (fresh) { fresh.style.display = ""; if (fresh._refresh) fresh._refresh(); }
      }
      return;
    }
    const bar = ensureBatchToolbar(box);
    if (bar) bar.style.display = "";
    box.innerHTML = "";
    list.forEach((b) => {
      const row = document.createElement("div");
      row.className = "rank-batch-row";

      const pick = document.createElement("input");
      pick.type = "checkbox"; pick.className = "rank-batch-pick"; pick.value = b.id;
      pick.onchange = () => { if (bar && bar._refresh) bar._refresh(); };

      const main = document.createElement("span");
      main.className = "rank-batch-main";
      main.textContent = (b.period_type === "month" ? "月度 " : "周度 ") + b.period_label + " · " + (b.category || "未填类目") + (b.site ? " · 站点 " + b.site : "") + " · " + (cntApprox(b) ? "≈" : "") + cntOf(b) + " 条" + (b.skipped ? "（跳过 " + b.skipped + "）" : "");

      const act = document.createElement("span");
      act.className = "rkadm-row-act";

      const ren = document.createElement("button");
      ren.type = "button"; ren.className = "btn-ghost small"; ren.textContent = "改期次名";
      ren.onclick = async () => {
        const v = (await uiPrompt("该批次所属期次改名（会同步该期次全部数据）：", b.period_label) || "").trim();
        if (!v || v === b.period_label) return;
        if (!(await uiConfirm("把期次「" + b.period_label + "」改名为「" + v + "」？\n该期次全部数据会一起改名。"))) return;
        try {
          const mv = await SB.updateRankPeriodData(b.period_label, b.period_type, v, b.period_type);
          await loadRankBatches(); rankPreviewRefresh();
          sbToast("期次已改名为「" + v + "」（迁移 " + mv + " 条）", true);
        } catch (e) { sbToast((e && e.message) || "改名失败", false); }
      };

      const del = document.createElement("button");
      del.type = "button"; del.className = "btn-ghost small rank-batch-del"; del.textContent = "删除";
      del.onclick = async () => {
        if (!(await uiConfirm("删除该批次「" + b.period_label + " · " + b.category + "」及其全部条目？"))) return;
        try { await SB.deleteRankBatch(b.id); await loadRankBatches(); rankPreviewRefresh(); sbToast("已删除该批次", true); }
        catch (e) { sbToast("删除失败", false); }
      };

      act.appendChild(ren); act.appendChild(del);
      row.appendChild(pick); row.appendChild(main); row.appendChild(act);
      box.appendChild(row);
    });
    if (bar && bar._refresh) bar._refresh();
  }

  /* ---------- 期次 / 周度频次管理 ---------- */
  function renderRankPeriods() {
    const box = $("#rank-period-list");
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
        if (!(await uiConfirm("把期次「" + p.label + "」的频次改为「" + (nt === "month" ? "月度" : "周度") + "」？\n该期次全部数据会一起切换。"))) return;
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
        if (!(await uiConfirm("把期次「" + p.label + "」改名为「" + v + "」？\n该期次已上传的全部数据（" + p.rows + " 条）会一起改名。"))) { name.value = p.label; return; }
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
        if (!(await uiConfirm("删除整个期次「" + p.label + "」及其全部数据（" + p.rows + " 条）？此操作不可恢复。"))) return;
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
    return "rank.html?" + q.join("&");
  }
  function rankPreviewRefresh() {
    const f = $("#rkadm-pv-frame");
    const hint = $("#rkadm-pv-hint");
    if (!f) return;
    f.src = rankPreviewUrl();
    if (hint) hint.textContent = "正在预览：" + (rankPv.cat || "全部类目") + " · " + ((rankPv.site || "").replace(/^g:/, "地区 · ") || "全部站点") + " · " + (rankPv.period || "最新期次") + " · " + (rankPv.mode === "v" ? "纵向时间对比" : (rankPv.mode === "c" ? "横向类目对比" : "横向国家对比"));
  }
  /* 导出用的期次下拉（20261109H）：按周导出，只查这一期 —— 数据量小、也不吃读取上限。
     只列周度期次，月度期次归「上新节奏」面板导。 */
  function fillExportPeriods() {
    const sel = document.querySelector("#rank-export-period");
    if (!sel) return;
    const keep = sel.value;
    const weeks = (rankPeriods || [])
      .filter((p) => p && ((p.type || "week") === "week") && p.label)
      .map((p) => String(p.label))
      .sort((a, b) => admPeriodKey(b) - admPeriodKey(a));
    sel.innerHTML = '<option value="">全部期次</option>' +
      weeks.map((w) => '<option value="' + escAttr(w) + '">' + escHtml(w) + '</option>').join("");
    if (keep && weeks.indexOf(keep) >= 0) sel.value = keep;
  }

  function fillRankPvControls() {
    const mk = (sel, list, cur, allLabel) => {
      if (!sel) return;
      const keep = cur || sel.value;
      sel.innerHTML = '<option value="">' + allLabel + '</option>' + list.map((v) => '<option value="' + escAttr(v) + '">' + escHtml(v) + '</option>').join("");
      if (keep && list.indexOf(keep) >= 0) sel.value = keep; else sel.value = "";
      return sel.value;
    };
    rankPv.cat = mk($("#rkadm-pv-cat"), rankCats, rankPv.cat, "全部类目") || "";
    /* 已在前台隐藏的站点 / 周次不进预览下拉：预览即前台所见 */
    const pvSites = rankSites.map((s) => s.name).filter((n) => !rankHiddenOn("sites", n));
    const pvPeriods = rankPeriods.map((p) => p.label).filter((n) => !rankHiddenOn("periods", n));
    rankPv.site = mk($("#rkadm-pv-site"), pvSites, rankPv.site, "全部站点") || "";
    /* 地区分组也进预览下拉：选「地区 · 欧洲」= 整区对比 */
    const siteSel = $("#rkadm-pv-site");
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
    rankPv.period = mk($("#rkadm-pv-period"), pvPeriods, rankPv.period, "自动（最新）") || "";
    if (!rankPv.period && pvPeriods.length) rankPv.period = pvPeriods[0];
    const ps = $("#rkadm-pv-period");
    if (ps && rankPv.period) ps.value = rankPv.period;
  }

  /* ---------- 面板进入 ---------- */  /* ---------- 面板进入 ---------- */
  async function enterRankPanel() {
    initRankPeriodPickers();
    await Promise.all([loadRankHidden(), loadRankSites(), loadRankCats(), loadRankBatches(), loadRankGroups(), loadRankPrintSwitch()]);
    /* 打标相关（20261027J）：导出范围里的类目下拉 + 批次台账 */
    const ecat = $("#rank-export-cat");
    if (ecat) {
      const keep = ecat.value;
      ecat.innerHTML = '<option value="">全部类目</option>' +
        rankCats.map((n) => '<option value="' + escAttr(n) + '">' + escHtml(n) + '</option>').join("");
      if (keep && rankCats.indexOf(keep) >= 0) ecat.value = keep;
    }
    /* 导出下拉增强：补上「叶子类目」一组，并给每个类目标上图数；
       同时渲染类目分布表。取不到就保留上面用配置表铺的基础选项，不影响导出。 */
    if (window.RankExport && window.RankExport.loadCats) {
      try { await window.RankExport.loadCats(); } catch (e) { /* 忽略 */ }
    }
    if (window.RankTagBatches) window.RankTagBatches.load();
    if (!rankPv.cat && rankCats.length) rankPv.cat = rankCats[0];
    if (!rankPv.site && rankSites.length) rankPv.site = rankSites[0].name;
    fillRankPvControls();
    rankPreviewRefresh();
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
        await loadRankSites(); await loadRankBatches(); rankPreviewRefresh();
        sbToast("已添加站点「" + v + "」", true);
      } catch (e) { sbToast((e && e.message) || "添加失败", false); }
    };
    const siteNew = $("#rank-site-new");
    if (siteNew) siteNew.onkeydown = (ev) => { if (ev.key === "Enter" && siteAdd) siteAdd.click(); };

    const groupAdd = $("#rank-group-add");
    if (groupAdd) groupAdd.onclick = async () => {
      const inp = $("#rank-group-new");
      const v = ((inp && inp.value) || "").trim();
      if (!v) { sbToast("请输入地区名", false); return; }
      if (rankGroups.some((g) => g.name === v)) { sbToast("已有同名地区", false); return; }
      rankGroups.push({ name: v, members: [] });
      if (inp) inp.value = "";
      await saveRankGroups("已添加地区「" + v + "」，点 ☑ 勾选包含哪些国家");
    };
    const groupNew = $("#rank-group-new");
    if (groupNew) groupNew.onkeydown = (ev) => { if (ev.key === "Enter" && groupAdd) groupAdd.click(); };

    const catAdd = $("#rank-cat-add");
    if (catAdd) catAdd.onclick = async () => {
      const v = (await uiPrompt("输入新类目名称（将同步到「标签管理 → 前台类目」）：") || "").trim();
      if (!v) return;
      try {
        await SB.addCategory(v);
        await loadRankCats(); fillRankPvControls();
        const sel = $("#rank-cat");
        if (sel) sel.value = v;
        sbToast("已新增类目「" + v + "」", true);
      } catch (e) { sbToast((e && e.message) || "新增类目失败", false); }
    };

    const file = $("#rank-file");
    if (file) file.onchange = onRankFileChange;
    const undoBtn = $("#rank-undo");
    if (undoBtn) undoBtn.onclick = doRankUndo;
    renderRankUndo();

    const imp = $("#rank-import");
    if (imp) imp.onclick = doRankImport;

    // 预览参数
    const bindPv = (sel, key) => {
      const el = $(sel);
      if (!el) return;
      el.onchange = () => { rankPv[key] = el.value; rankPreviewRefresh(); };
    };
    bindPv("#rkadm-pv-cat", "cat");
    bindPv("#rkadm-pv-site", "site");
    bindPv("#rkadm-pv-period", "period");
    bindPv("#rkadm-pv-mode", "mode");
    bindPv("#rkadm-pv-size", "size");

    const reload = $("#rkadm-pv-reload");
    if (reload) reload.onclick = () => rankPreviewRefresh();
    const full = $("#rkadm-pv-full");
    if (full) full.onclick = () => { const f = $("#rkadm-pv-frame"); if (f && f.requestFullscreen) f.requestFullscreen(); };
    const openFront = $("#rkadm-open-front");
    if (openFront) openFront.onclick = () => window.open(rankPreviewUrl(), "_blank");
    const refresh = $("#rkadm-refresh");
    if (refresh) refresh.onclick = async () => { await enterRankPanel(); sbToast("已刷新", true); };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindRankPanel);
  else bindRankPanel();

  Object.assign(window, {
    enterRankPanel, loadRankBatches, loadRankSites, loadRankCats,
    doRankImport, onRankFileChange, computeRankFlags: computeFlags,
    rankPreviewRefresh, renderRankPeriods, fillRankPvControls,
    computeRankCounts, batchSlotKey, batchSites,
  });
}
