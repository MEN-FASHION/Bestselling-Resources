/* ============================================================================
 * rank.js —— 前台「趋势上升榜」专区
 * 两种对比模式：
 *   ① 横向 · 国家对比：选类目 + 选周次，多选国家多列对比，列头标注「与其他国家重合多少张 / 重合度」
 *   ② 纵向 · 时间对比：选国家 + 多选周次，多列对比，标注「新上榜 / 上升N位 / 下降N位」
 * 附加筛选：全部 / 周度激增 / 趋势爆款 / 潜力机会（可多选）
 * 排序：环比比例高低 / 环比绝对值高低
 * 注意：页面不展示任何具体数值（百分比等一律不外露），只用笼统标签与位次变化表达趋势。
 * ==========================================================================*/
(function () {
  // 数据层在 supabase.js 中以顶层 const 暴露（全局词法作用域），这里做兼容取值
  const SBX = (typeof SB !== "undefined") ? SB : (window.SB || null);
  const PERCENT_SCALE = 100;   // ← 如发现前台百分比识别不对，改这里（先按百分比口径=×100）
  const COL_CAP = 60;          // 每列默认最多展示张数（先少后多，避免一次拉太多图片）
  const COL_CAP_MAX = 240;     // 点「展开全部」后的上限

  let FACETS = { sites: [], periods: [], categories: [] };
  let MODE = "h";              // h=横向国家对比 / v=纵向时间对比
  let CAT = "";
  let SEL_SITES = [];          // 横向：多选；纵向：仅取第一个作为所选国家
  let SEL_PERIODS = [];        // 横向：可一个或多个；纵向：多选
  let TAGS = ["all"];          // all | surge | hot | opportunity
  let SORT = "ratio_desc";     // ratio_desc / ratio_asc / abs_desc / abs_asc
  let COL_CAP_NOW = COL_CAP;
  let CACHE = null;            // { key, items }

  const $ = (s) => document.querySelector(s);
  const escHtml = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const escAttr = (s) => escHtml(s).replace(/'/g, "&#39;");

  /* ---------- 期次排序键 ---------- */
  function periodKey(p) {
    const s = String(p || "");
    let m = s.match(/W\s*(\d+)/i);
    if (m) return 100000 + parseInt(m[1], 10);
    m = s.match(/(\d{4})\D{0,3}(\d{1,2})/);
    if (m) return 200000 + parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
    m = s.match(/(\d+)/);
    if (m) return 300000 + parseInt(m[1], 10);
    return 900000;
  }
  const sortPeriods = (arr) => arr.slice().sort((a, b) => periodKey(a) - periodKey(b));

  /* ---------- 标签判定（与后台同口径，按「站点 + 期次」分池） ---------- */
  function flagPools(items) {
    const pools = {};
    items.forEach(it => { const k = it.site + "\u0001" + it.period_label; (pools[k] = pools[k] || []).push(it); });
    Object.keys(pools).forEach(k => {
      const pool = pools[k];
      const byRatio = pool.filter(r => r.ratio != null).sort((a, b) => b.ratio - a.ratio);
      byRatio.forEach((r, i) => { r._rk = i + 1; });
      const byAbs = pool.filter(r => r.abs_delta != null).sort((a, b) => b.abs_delta - a.abs_delta);
      byAbs.forEach((r, i) => { r._ak = i + 1; });
      pool.forEach(r => { r._opp = r.ratio != null && r.ratio > 0; r._hot = false; r._surge = false; });
      byAbs.filter(r => r.abs_delta > 0).slice(0, 20).forEach(r => { r._hot = true; });
      const dual = byRatio.filter(r => r.ratio > 0 && r.abs_delta != null && r.abs_delta > 0);
      const n = dual.length ? Math.max(1, Math.round(dual.length * 0.2)) : 0;
      dual.slice(0, n).forEach(r => { r._surge = true; });
    });
    return items;
  }
  function hitTags(it) {
    if (TAGS.indexOf("all") >= 0 || !TAGS.length) return true;
    if (TAGS.indexOf("surge") >= 0 && it._surge) return true;
    if (TAGS.indexOf("hot") >= 0 && it._hot) return true;
    if (TAGS.indexOf("opportunity") >= 0 && it._opp) return true;
    return false;
  }
  function sortItems(arr) {
    const a = arr.slice();
    if (SORT === "ratio_desc") a.sort((x, y) => (y.ratio == null ? -Infinity : y.ratio) - (x.ratio == null ? -Infinity : x.ratio));
    else if (SORT === "ratio_asc") a.sort((x, y) => (x.ratio == null ? Infinity : x.ratio) - (y.ratio == null ? Infinity : y.ratio));
    else if (SORT === "abs_desc") a.sort((x, y) => (y.abs_delta == null ? -Infinity : y.abs_delta) - (x.abs_delta == null ? -Infinity : x.abs_delta));
    else a.sort((x, y) => (x.abs_delta == null ? Infinity : x.abs_delta) - (y.abs_delta == null ? Infinity : y.abs_delta));
    return a;
  }
  function badgeOf(it) {
    if (it._surge) return { cls: "flag-surge", txt: "周度激增" };
    if (it._hot) return { cls: "flag-hot", txt: "趋势爆款" };
    if (it._opp) return { cls: "flag-opportunity", txt: "潜力机会" };
    return null;
  }

  /* ---------- 筛选区渲染 ---------- */
  function renderHead() {
    const head = $("#rk-head");
    if (!head) return;
    const periods = sortPeriods(FACETS.periods);
    const chips = (arr, sel, attr) => arr.map(v =>
      '<button type="button" class="rk-chip' + (sel.indexOf(v) >= 0 ? " on" : "") + '" ' + attr + '="' + escAttr(v) + '">' + escHtml(v) + '</button>'
    ).join("");

    let html = "";
    if (MODE === "h") {
      html +=
        '<div class="rk-group"><span class="rk-label">国家站点（可多选）</span><div class="rk-chips" id="rk-sites">' + chips(FACETS.sites, SEL_SITES, "data-site") + '</div></div>' +
        '<div class="rk-group"><span class="rk-label">周次 / 期次（可多选）</span><div class="rk-chips" id="rk-periods">' + chips(periods, SEL_PERIODS, "data-period") + '</div></div>';
    } else {
      html +=
        '<div class="rk-group"><span class="rk-label">国家站点（单选）</span><div class="rk-chips" id="rk-sites">' + chips(FACETS.sites, SEL_SITES.slice(0, 1), "data-site") + '</div></div>' +
        '<div class="rk-group"><span class="rk-label">周次 / 期次（可多选，按时间先后对比）</span><div class="rk-chips" id="rk-periods">' + chips(periods, SEL_PERIODS, "data-period") + '</div></div>';
    }
    html +=
      '<div class="rk-group"><span class="rk-label">标签</span><div class="rk-chips" id="rk-tags">' +
        chips([["all", "全部"], ["surge", "周度激增"], ["hot", "趋势爆款"], ["opportunity", "潜力机会"]].map(p => p[0]), TAGS, "data-tag") +
      '</div></div>' +
      '<div class="rk-group"><span class="rk-label">排序</span><div class="rk-chips" id="rk-sort">' +
        [["ratio_desc", "环比比例 高→低"], ["ratio_asc", "环比比例 低→高"], ["abs_desc", "环比绝对值 高→低"], ["abs_asc", "环比绝对值 低→高"]]
          .map(p => '<button type="button" class="rk-chip' + (SORT === p[0] ? " on" : "") + '" data-sort="' + p[0] + '">' + p[1] + '</button>').join("") +
      '</div></div>';

    head.innerHTML = html;
    // 标签重命名（全部/周度激增/趋势爆款/潜力机会）
    const tagBox = $("#rk-tags");
    if (tagBox) {
      const labels = { all: "全部", surge: "周度激增", hot: "趋势爆款", opportunity: "潜力机会" };
      [...tagBox.querySelectorAll("[data-tag]")].forEach(b => { b.textContent = labels[b.dataset.tag] || b.dataset.tag; });
    }
    bindHead();
  }

  function bindHead() {
    const sites = $("#rk-sites");
    if (sites) [...sites.querySelectorAll("[data-site]")].forEach(b => b.onclick = () => {
      const v = b.dataset.site;
      if (MODE === "v") { SEL_SITES = [v]; }
      else {
        const i = SEL_SITES.indexOf(v);
        if (i >= 0) SEL_SITES.splice(i, 1); else SEL_SITES.push(v);
      }
      COL_CAP_NOW = COL_CAP;
      renderHead(); load();
    });
    const ps = $("#rk-periods");
    if (ps) [...ps.querySelectorAll("[data-period]")].forEach(b => b.onclick = () => {
      const v = b.dataset.period;
      const i = SEL_PERIODS.indexOf(v);
      if (i >= 0) SEL_PERIODS.splice(i, 1); else SEL_PERIODS.push(v);
      COL_CAP_NOW = COL_CAP;
      renderHead(); load();
    });
    const tags = $("#rk-tags");
    if (tags) [...tags.querySelectorAll("[data-tag]")].forEach(b => b.onclick = () => {
      const v = b.dataset.tag;
      if (v === "all") TAGS = ["all"];
      else {
        TAGS = TAGS.filter(t => t !== "all");
        const i = TAGS.indexOf(v);
        if (i >= 0) TAGS.splice(i, 1); else TAGS.push(v);
        if (!TAGS.length) TAGS = ["all"];
      }
      renderHead(); renderBody();
    });
    const sortBox = $("#rk-sort");
    if (sortBox) [...sortBox.querySelectorAll("[data-sort]")].forEach(b => b.onclick = () => {
      SORT = b.dataset.sort; renderHead(); renderBody();
    });
  }

  /* ---------- 类目菜单 ---------- */
  function renderCats() {
    const box = $("#rk-cats");
    if (!box) return;
    if (!FACETS.categories.length) { box.innerHTML = '<div class="hint">暂无类目数据</div>'; return; }
    box.innerHTML = FACETS.categories.map(c =>
      '<button type="button" class="rk-cat' + (c === CAT ? " active" : "") + '" data-cat="' + escAttr(c) + '">' + escHtml(c) + '</button>'
    ).join("");
    [...box.querySelectorAll("[data-cat]")].forEach(b => b.onclick = () => {
      CAT = b.dataset.cat; CACHE = null; COL_CAP_NOW = COL_CAP; renderCats(); renderHead(); load();
    });
  }

  /* ---------- 取数 ---------- */
  async function fetchItems() {
    const sites = MODE === "v" ? SEL_SITES.slice(0, 1) : SEL_SITES;
    if (!CAT || !sites.length || !SEL_PERIODS.length) return [];
    const key = [CAT, sites.join("|"), SEL_PERIODS.join("|")].join("§");
    if (CACHE && CACHE.key === key) return CACHE.items;
    let items = [];
    try { items = await SBX.listRankItems({ category: CAT, sites: sites, periods: SEL_PERIODS }); }
    catch (e) { items = []; }
    items.forEach(it => {
      it.ratio = (it.ratio == null ? null : Number(it.ratio) / PERCENT_SCALE);
      it.abs_delta = (it.abs_delta == null ? null : Number(it.abs_delta));
    });
    flagPools(items);
    CACHE = { key: key, items: items };
    return items;
  }

  /* ---------- 卡片 ---------- */
  function card(it, extra) {
    const b = badgeOf(it);
    let html = '<div class="rk-card' + (extra && extra.isNew ? " is-new" : "") + '">';
    html += '<img loading="lazy" src="' + escAttr(it.image_url || "") + '" alt="' + escAttr(it.leaf_category || "") + '">';
    if (b) html += '<span class="rk-badge ' + b.cls + '">' + b.txt + '</span>';
    if (extra && extra.move) html += '<span class="rk-move">' + escHtml(extra.move) + '</span>';
    html += '</div>';
    return html;
  }
  function column(title, tag, cards) {
    return '<div class="rk-col"><div class="rk-col-head"><span>' + escHtml(title) + '</span>' +
      (tag ? '<span class="rk-tag">' + escHtml(tag) + '</span>' : '') + '</div>' +
      '<div class="rk-cards">' + cards + '</div></div>';
  }

  /* ---------- 主体渲染 ---------- */
  function renderBody() {
    const box = $("#rk-body");
    if (!box) return;
    if (!CAT) { box.innerHTML = '<div class="rk-empty">请先在左侧选择一个类目</div>'; return; }
    const sites = MODE === "v" ? SEL_SITES.slice(0, 1) : SEL_SITES;
    if (!sites.length) { box.innerHTML = '<div class="rk-empty">请选择国家站点</div>'; return; }
    if (!SEL_PERIODS.length) { box.innerHTML = '<div class="rk-empty">请选择周次 / 期次</div>'; return; }
    if (!CACHE || !CACHE.items.length) { box.innerHTML = '<div class="rk-empty">该类目下暂无榜单数据</div>'; return; }

    const all = CACHE.items.filter(hitTags);
    const periodsSel = sortPeriods(SEL_PERIODS);

    /* ===== 横向：国家对比 ===== */
    if (MODE === "h") {
      const bySite = {};
      all.forEach(it => { (bySite[it.site] = bySite[it.site] || []).push(it); });
      const sets = {};
      sites.forEach(s => { sets[s] = new Set((bySite[s] || []).map(i => i.image_url)); });
      let html = '<div class="rk-stack">';
      sites.forEach(s => {
        const others = sites.filter(x => x !== s);
        let over = 0;
        if (others.length) {
          const union = new Set();
          others.forEach(o => sets[o].forEach(u => union.add(u)));
          sets[s].forEach(u => { if (union.has(u)) over++; });
        }
        const total = sets[s].size;
        const rate = total ? Math.round(over / total * 100) : 0;
        const tag = others.length
          ? ("与 " + (others.length <= 2 ? others.join("、") : "其他 " + others.length + " 国") + " 重合 " + over + " 张 · 重合度 " + rate + "%")
          : "单国视图";
        const list = sortItems(bySite[s] || []);
        const shown = list.slice(0, COL_CAP_NOW);
        html += column(s, tag, shown.map(i => card(i)).join("") || '<div class="rk-empty">无数据</div>');
      });
      html += '</div>';
      const maxLen = Math.max.apply(null, sites.map(s => (bySite[s] || []).length).concat([0]));
      if (maxLen > COL_CAP_NOW) {
        html += '<div style="text-align:center;margin-top:14px"><button type="button" class="rk-chip" id="rk-more">展开更多（每列最多 ' + COL_CAP_MAX + ' 张）</button></div>';
      } else {
        html += '<div class="rk-empty" style="margin-top:14px">每列已展示全部（每列上限 ' + COL_CAP_MAX + ' 张）</div>';
      }
      box.innerHTML = html;
    } else {
      /* ===== 纵向：时间对比 ===== */
      const site = sites[0];
      const byPeriod = {};
      all.forEach(it => { (byPeriod[it.period_label] = byPeriod[it.period_label] || []).push(it); });
      // 各期名次（按环比比例降序）
      const rankOf = {}, orderOf = {};
      periodsSel.forEach(p => {
        const lst = sortItems(byPeriod[p] || []).filter(i => i.ratio != null);
        const m = {};
        lst.forEach((i, idx) => { m[i.image_url] = idx + 1; });
        rankOf[p] = m;
        orderOf[p] = (byPeriod[p] || []).length;
      });
      let html = '<div class="rk-stack">';
      periodsSel.forEach((p, pi) => {
        const prev = pi > 0 ? periodsSel[pi - 1] : null;
        const list = sortItems(byPeriod[p] || []);
        const shown = list.slice(0, COL_CAP_NOW);
        const cards = shown.map(it => {
          let move = "", isNew = false;
          if (prev) {
            const pr = rankOf[prev] || {};
            if (!(it.image_url in pr)) { move = "新上榜"; isNew = true; }
            else if (it.ratio != null && pr[it.image_url] != null) {
              const cur = (rankOf[p] || {})[it.image_url];
              const diff = pr[it.image_url] - cur;
              if (diff > 0) move = "上升 " + diff + " 位";
              else if (diff < 0) move = "下降 " + (-diff) + " 位";
            }
          }
          return card(it, { move: move, isNew: isNew });
        }).join("");
        html += column(p, site + " · 共 " + orderOf[p] + " 张", cards || '<div class="rk-empty">无数据</div>');
      });
      html += '</div>';
      const maxLen = Math.max.apply(null, periodsSel.map(p => (byPeriod[p] || []).length).concat([0]));
      if (maxLen > COL_CAP_NOW) {
        html += '<div style="text-align:center;margin-top:14px"><button type="button" class="rk-chip" id="rk-more">展开更多（每列最多 ' + COL_CAP_MAX + ' 张）</button></div>';
      } else {
        html += '<div class="rk-empty" style="margin-top:14px">每期已展示全部（每列上限 ' + COL_CAP_MAX + ' 张）</div>';
      }
      box.innerHTML = html;
    }

    const more = $("#rk-more");
    if (more) more.onclick = () => { COL_CAP_NOW = COL_CAP_MAX; renderBody(); };
  }

  async function load() {
    const box = $("#rk-body");
    const sites = MODE === "v" ? SEL_SITES.slice(0, 1) : SEL_SITES;
    if (!CAT || !sites.length || !SEL_PERIODS.length) { renderBody(); return; }
    if (box) box.innerHTML = '<div class="rk-loading">加载中…</div>';
    await fetchItems();
    renderBody();
  }

  /* ---------- 初始化 ---------- */
  async function boot() {
    if (!SBX) {
      const b0 = $("#rk-body");
      if (b0) b0.innerHTML = '<div class="rk-empty">数据服务未就绪，请刷新页面重试</div>';
      return;
    }
    // 专区可见性守门：超管在「前台访问设置」关闭该专区时，前台不展示内容
    try {
      const vis = await SBX.getFrontendZoneVisibility();
      if (vis && vis.rank === false) {
        const b0 = $("#rk-body");
        if (b0) b0.innerHTML = '<div class="rk-empty">该专区暂未开放</div>';
        return;
      }
    } catch (e) { /* 读取失败时照常展示 */ }
    try { FACETS = await SBX.rankFacets(); } catch (e) { FACETS = { sites: [], periods: [], categories: [] }; }
    CAT = (FACETS.categories[0] || "");
    const ps = sortPeriods(FACETS.periods);
    SEL_PERIODS = ps.length ? [ps[ps.length - 1]] : [];
    SEL_SITES = FACETS.sites.slice(0, 2);
    renderCats();
    renderHead();
    const hm = $("#rk-mode-h"), vm = $("#rk-mode-v");
    if (hm) hm.onclick = () => {
      MODE = "h"; SEL_SITES = SEL_SITES.slice(0, 2); COL_CAP_NOW = COL_CAP;
      hm.classList.add("on"); if (vm) vm.classList.remove("on"); renderHead(); load();
    };
    if (vm) vm.onclick = () => {
      MODE = "v"; SEL_SITES = SEL_SITES.slice(0, 1); COL_CAP_NOW = COL_CAP;
      vm.classList.add("on"); if (hm) hm.classList.remove("on"); renderHead(); load();
    };
    await load();
    if (!CACHE || !CACHE.items.length) {
      const s = await SBX.getSession().catch(() => null);
      if (!s && $("#rk-body")) {
        $("#rk-body").innerHTML = '<div class="rk-empty">暂无可查看的数据（若站点未开启公开浏览，请先登录后再查看）</div>';
      }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();