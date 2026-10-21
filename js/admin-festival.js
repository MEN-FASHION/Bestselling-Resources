/* ============================================================================
 * 后台「营销日历」· 节庆库原生编辑器（20261019G）
 * ----------------------------------------------------------------------------
 * 为什么不再用 iframe：
 *   后台需要的不是"另一个页面"，而是"就在这一页上编辑"。
 *   所以这里用与前台完全相同的视觉（同一份 css/style.css 的 .mkzone 样式、
 *   同一份内置节庆库 marketing-data.js），把三视图直接画在后台面板里，
 *   卡片/节点上带编辑与删除入口，保存直接写数据库，前台刷新即生效。
 * 权限：面板本身只有超级管理员可见（admin.html 的 data-super 控制，且库侧策略只放行超管写入）。
 * ============================================================================ */
(function () {
  'use strict';

  var DAY = 86400000;
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var ZONE_ID = 'mkFestZone';

  var CATS = window.CATS || {};
  var GROUPS = window.REGION_GROUPS || [];

  var SHOW_STEP = 120;                 /* 一次渲染多少张卡片，多的按「加载更多」追加 */
  var state = {
    list: [], view: 'cards', loaded: false, fromDb: false,
    q: '', cats: {}, starMin: 0, region: '', editing: null,
    showN: SHOW_STEP
  };

  /* ---------------- 小工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function todayStart() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function toDate(y, m, d) { var x = new Date(y, m - 1, d); x.setHours(0, 0, 0, 0); return x; }
  function parseISO(s) { var p = String(s).split('-'); return toDate(+p[0], +p[1], +p[2]); }
  function daysBetween(a, b) { return Math.round((b - a) / DAY); }
  function fmtShort(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }

  /* 日期统一成 MM-DD（允许历史数据是 YYYY-MM-DD 或 M-D） */
  function normMMDD(v) {
    if (typeof v !== 'string') return '';
    var s = v.trim().replace(/[/.]/g, '-');
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) m = /^(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) return '';
    var mo = parseInt(m[m.length - 2], 10), dd = parseInt(m[m.length - 1], 10);
    if (!(mo >= 1 && mo <= 12) || !(dd >= 1 && dd <= 31)) return '';
    return pad2(mo) + '-' + pad2(dd);
  }

  /* ---------------- 内置节庆库（与前台同一份数据源） ---------------- */
  function defaults() {
    var raw = window.RAW || [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var r = raw[i];
      out.push({
        id: 'd' + i, name: r[0], en: r[1] || '', region: r[2] || '其他',
        date: r[3], cat: r[4] || 'trad', star: r[5] | 0 || 3,
        lead: r[6] == null ? 120 : (r[6] | 0), idea: r[7] || '',
        overrides: r[8] || null, dur: (r[9] | 0) || 1, note: '', custom: false
      });
    }
    return out;
  }

  function dbRowToFestival(r) {
    return {
      id: String(r.id), name: r.name || '', en: r.en || '',
      region: r.region || '其他',
      date: normMMDD(r.date) || String(r.date || ''),
      cat: CATS[r.cat] ? r.cat : 'trad',
      star: Math.min(5, Math.max(1, parseInt(r.star, 10) || 3)),
      lead: Math.max(0, parseInt(r.lead, 10) || 0),
      dur: Math.max(1, parseInt(r.dur, 10) || 1),
      idea: r.idea || '', note: r.note || '',
      overrides: (r.overrides && typeof r.overrides === 'object') ? r.overrides : null,
      custom: true
    };
  }

  /* ---------------- 时间推演（与前台同一套算法） ---------------- */
  function nextOccurrence(h, today) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(h.date)) return parseISO(h.date);
    var p = String(h.date || '').split('-');
    var bm = +p[0], bd = +p[1];
    for (var off = 0; off <= 4; off++) {
      var y = today.getFullYear() + off, m = bm, dd = bd;
      if (h.overrides && h.overrides[y]) {
        var q = String(h.overrides[y]).split('-');
        m = +q[0]; dd = +q[1];
      }
      var dt = toDate(y, m, dd);
      if (dt.getTime() >= today.getTime()) return dt;
    }
    return toDate(today.getFullYear() + 4, bm, bd);
  }
  function durOf(h) { var d = h && h.dur; return (typeof d === 'number' && d > 0) ? Math.round(d) : 1; }
  function leadOf(h) { var l = h && h.lead; return (typeof l === 'number' && l >= 0) ? Math.round(l) : 120; }
  function urgency(sdl) {
    if (sdl < 0) return { key: 'over', label: '已过启动点', color: '#9aa0aa' };
    if (sdl <= 20) return { key: 'urgent', label: '立即启动', color: '#ff3b30' };
    if (sdl <= 60) return { key: 'soon', label: '即将逼近', color: '#ff9f0a' };
    return { key: 'ok', label: '时间从容', color: '#12a150' };
  }
  function isVariable(h) { return !!(h.overrides && Object.keys(h.overrides).length); }

  /* ---------------- 装配：筛选 + 计算 ---------------- */
  function build() {
    var today = todayStart(), out = [];
    var q = (state.q || '').trim().toLowerCase();
    for (var i = 0; i < state.list.length; i++) {
      var h = state.list[i];
      if (!h || !h.name || !h.date) continue;
      if (state.region && h.region !== state.region) continue;
      var catOn = Object.keys(state.cats).filter(function (k) { return state.cats[k]; });
      if (catOn.length && catOn.indexOf(h.cat) < 0) continue;
      if ((h.star | 0) < (state.starMin | 0)) continue;
      if (q) {
        var hay = (h.name + ' ' + (h.en || '') + ' ' + (h.region || '') + ' ' + (h.idea || '')).toLowerCase();
        if (hay.indexOf(q) < 0) continue;
      }
      var occ = nextOccurrence(h, today);
      var dl = daysBetween(today, occ);
      if (dl < 0 || dl > 400) continue;
      var lead = leadOf(h), dur = durOf(h);
      var start = new Date(occ.getTime() - lead * DAY);
      var sdl = daysBetween(today, start);
      out.push({
        h: h, occ: occ, daysLeft: dl, lead: lead, dur: dur, start: start,
        startDaysLeft: sdl, end: new Date(occ.getTime() + (dur - 1) * DAY), u: urgency(sdl)
      });
    }
    out.sort(function (a, b) { return a.occ - b.occ; });
    return out;
  }

  function regions() {
    var seen = {}, arr = [];
    for (var i = 0; i < state.list.length; i++) {
      var r = state.list[i].region;
      if (r && !seen[r]) { seen[r] = 1; arr.push(r); }
    }
    return arr.sort();
  }

  /* ---------------- 渲染：头部 + 工具条 + 筛选 ---------------- */
  function headHTML() {
    var tabs = [['cards', '节庆卡片'], ['timeline', '年度时间轴'], ['gantt', '开发倒推']];
    var seg = '<div class="seg" id="mkFestTabs">' + tabs.map(function (t) {
      return '<button type="button" data-view="' + t[0] + '"' + (state.view === t[0] ? ' class="active"' : '') + '>' + t[1] + '</button>';
    }).join('') + '</div>';

    return '<div class="mk-head">'
      + '<div class="mk-head-l"><h1>节庆库</h1>'
      + '<p>在这里直接改 · 保存即写库 · 前台刷新即见（与前台同一份数据、同一套版式）</p></div>'
      + '<div class="mk-head-r">' + seg
      + '<span class="today-pill" id="mkFestCount"><span>共 <b class="num">' + state.list.length + '</b> 条</span></span>'
      + '<span class="today-pill" id="mkFestSrc"><span class="dot"></span><span>数据来源：内置库</span></span>'
      + '</div></div>'
      + '<div class="mk-adm-tools">'
      + '<button type="button" class="btn btn-primary" id="mkFestAdd">＋ 新建节日</button>'
      + '<button type="button" class="btn" id="mkFestImport">导入节庆</button>'
      + '<button type="button" class="btn" id="mkFestExport">导出 JSON</button>'
      + '<button type="button" class="btn" id="mkFestRebuild">用内置库重建</button>'
      + '<button type="button" class="btn btn-danger" id="mkFestClear">清空库</button>'
      + '<span class="mk-adm-grow"></span>'
      + '<input type="search" class="mk-adm-search" id="mkFestQ" placeholder="搜索名称 / 英文 / 地区 / 选品方向" value="' + esc(state.q) + '">'
      + '</div>'
      + '<p class="hint-inline" style="margin:8px 0 0">'
      + '「导入节庆」支持 <b>Excel（xlsx / xls）</b>、<b>CSV</b> 与 JSON：把模板（交付包内「节庆批量导入模板.xlsx」）换成你的数据即可，表头用中文、日期填 <code>MM-DD</code> 或 <code>YYYY-MM-DD</code>，同一份表可混装多个国家。缺名称或日期的行会自动跳过；<b>同一国家同名的节日视为重复，导入时跳过、不覆盖库里原有那条</b>。'
      + '</p>'
      + '<div class="mk-adm-row">'
      + '<select class="mk-adm-sel" id="mkFestRegion"><option value="">全部地区</option>'
      + regions().map(function (r) { return '<option value="' + esc(r) + '"' + (state.region === r ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('')
      + '</select>'
      + '<input type="file" id="mkFestFile" accept=".xlsx,.xls,.csv,.json,application/json" hidden>'
      + '</div>'
      + '<div class="mk-adm-filters">'
      + '<div class="chips" id="mkFestCats">' + Object.keys(CATS).map(function (k) {
        return '<button type="button" class="chip' + (state.cats[k] ? ' active' : '') + '" data-cat="' + k + '">'
          + '<span class="cdot" style="background:' + CATS[k].color + '"></span>' + CATS[k].label + '</button>';
      }).join('') + '</div>'
      + '<div class="chips" id="mkFestStars">' + [0, 1, 2, 3, 4, 5].map(function (s) {
        return '<button type="button" class="chip' + (state.starMin === s ? ' active' : '') + '" data-star="' + s + '">'
          + (s === 0 ? '不限重要度' : '★' + s + (s === 5 ? '' : ' 以上')) + '</button>';
      }).join('') + '</div>'
      + '</div>';
  }

  function statsHTML(list) {
    var t = todayStart();
    var soon = 0, urgent = 0, leadSum = 0, star5 = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].daysLeft <= 30) soon++;
      if (list[i].u.key === 'urgent') urgent++;
      leadSum += list[i].lead;
      if ((list[i].h.star | 0) >= 5) star5++;
    }
    var avg = list.length ? Math.round(leadSum / list.length) : 0;
    return '<div class="stats">'
      + '<div class="stat" style="--sc:#8b7355"><div class="k">节庆总数</div><div class="v num">' + list.length + '<small>个</small></div><div class="s">当前筛选条件下</div></div>'
      + '<div class="stat" style="--sc:#ff9f0a"><div class="k">30 天内</div><div class="v num">' + soon + '<small>个</small></div><div class="s">需要马上安排备货</div></div>'
      + '<div class="stat" style="--sc:#ff3b30"><div class="k">立即启动</div><div class="v num">' + urgent + '<small>个</small></div><div class="s">已进入最晚启动窗口</div></div>'
      + '<div class="stat" style="--sc:#12a150"><div class="k">平均提前期</div><div class="v num">' + avg + '<small>天</small></div><div class="s">★5 重点节庆 ' + star5 + ' 个</div></div>'
      + '</div>';
  }

  /* ---------------- 渲染：三种视图 ---------------- */
  function cardsHTML(list) {
    if (!list.length) return '<div class="mk-adm-empty">当前筛选条件下没有符合条件的节庆。清空搜索或点「不限重要度」可以看回全部。</div>';
    var shown = list.slice(0, state.showN);
    var html = '<div class="card-grid">';
    for (var i = 0; i < shown.length; i++) {
      var it = shown[i];
      var c = CATS[it.h.cat] ? CATS[it.h.cat].color : '#9aa0aa';
      var pctCirc = 2 * Math.PI * 24;
      var dash = (pctCirc * (it.daysLeft / 365)).toFixed(1);
      html += '<article class="fcard" data-fid="' + esc(it.h.id) + '" style="--c:' + c + ';animation-delay:' + (i * 0.02) + 's">'
        + '<div class="fest-edit-chip"><button type="button" data-edit="' + esc(it.h.id) + '">编辑</button>'
        + '<button type="button" class="del" data-del="' + esc(it.h.id) + '">删除</button></div>'
        + '<div class="band"></div>'
        + '<div class="crow"><div><div class="cday num">' + pad2(it.occ.getDate()) + '</div>'
        + '<div class="cmon">' + (it.occ.getMonth() + 1) + ' 月 · ' + WEEKDAYS[it.occ.getDay()] + '</div></div>'
        + '<div class="ring"><svg width="56" height="56"><circle cx="28" cy="28" r="24" fill="none" stroke="#eef0f3" stroke-width="4"></circle>'
        + '<circle cx="28" cy="28" r="24" fill="none" stroke="' + it.u.color + '" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + pctCirc + '"></circle></svg>'
        + '<div class="rin"><b class="num" style="color:' + it.u.color + '">' + it.daysLeft + '</b><span>天后</span></div></div></div>'
        + '<div class="cname">' + esc(it.h.name) + '</div>'
        + '<div class="cen">' + esc(it.h.en || '—') + '</div>'
        + '<div class="cmeta"><span class="mtag">' + esc(it.h.region) + '</span>'
        + '<span class="mtag" style="background:' + c + '1a;color:' + c + '">' + (CATS[it.h.cat] ? CATS[it.h.cat].label : '其他') + '</span>'
        + '<span class="mtag dur">持续 ' + it.dur + ' 天</span><span class="mtag">' + new Array((it.h.star | 0) + 1).join('★') + '</span>'
        + (isVariable(it.h) ? '<span class="mtag">浮动日期</span>' : '') + '</div>'
        + '<div class="cidea"><b>选品方向</b>' + esc(it.h.idea || '待补充') + '</div>'
        + '<div class="cidea" style="border-top:none;padding-top:0;margin-top:10px"><b>时间推演</b>节期 '
        + '<b class="num" style="font-size:13px">' + fmtShort(it.occ) + (it.dur > 1 ? (' – ' + fmtShort(it.end)) : '') + '</b> · 提前期 '
        + '<b class="num" style="font-size:13px">' + it.lead + '</b> 天 · 最晚启动 '
        + '<b class="num" style="font-size:13px">' + (it.startDaysLeft < 0 ? '已过期' : fmtShort(it.start)) + '</b>'
        + (it.startDaysLeft >= 0 ? '（' + it.startDaysLeft + ' 天后）' : '') + '</div>'
        + '</article>';
    }
    html += '</div>';
    if (list.length > shown.length) {
      html += '<div class="mk-more-wrap"><button type="button" class="btn" id="mkFestMore">'
        + '加载更多（已显示 ' + shown.length + ' / 共 ' + list.length + ' 条）</button></div>';
    }
    return html;
  }

  function timelineHTML(list) {
    var today = todayStart();
    var startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    var byKey = {};
    for (var i = 0; i < list.length; i++) {
      var k = list[i].occ.getFullYear() + '-' + pad2(list[i].occ.getMonth() + 1);
      (byKey[k] = byKey[k] || []).push(list[i]);
    }
    var html = '<div class="sec-head"><h2>年度时间轴</h2><span class="sub">未来 12 个月 · 共 ' + list.length + ' 个节点</span><span class="line"></span></div>';
    for (var m = 0; m < 12; m++) {
      var d = new Date(startMonth.getFullYear(), startMonth.getMonth() + m, 1);
      var key = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
      var items = byKey[key] || [];
      var delay = m * 0.03;
      html += '<div class="month-block' + (m === 0 ? ' current' : '') + '" style="animation-delay:' + delay + 's">'
        + '<div class="month-head"><span class="mnum num">' + pad2(d.getMonth() + 1) + '</span>'
        + '<span class="mname">' + d.getFullYear() + ' 年</span>'
        + '<span class="cnt">' + items.length + ' 个节点</span></div>';
      if (!items.length) {
        html += '<div class="empty-month">本月暂无节庆 · 适合安排基础款打样与备货缓冲</div>';
      } else {
        html += '<div class="fest-grid">';
        for (var j = 0; j < items.length; j++) {
          var it = items[j];
          var c = CATS[it.h.cat] ? CATS[it.h.cat].color : '#9aa0aa';
          html += '<button type="button" class="fest" data-edit="' + esc(it.h.id) + '" style="--c:' + c + ';animation-delay:' + (delay + j * 0.02) + 's">'
            + '<span class="fdate"><b class="num">' + pad2(it.occ.getDate()) + '</b><span>' + WEEKDAYS[it.occ.getDay()] + '</span></span>'
            + '<span class="fmain"><span class="fname">' + esc(it.h.name) + '</span>'
            + '<span class="fmeta">' + esc(it.h.region) + ' · ' + (CATS[it.h.cat] ? CATS[it.h.cat].label : '')
            + (it.dur > 1 ? (' · <b>持续 ' + it.dur + ' 天</b>') : '') + '</span></span>'
            + '<span class="fright"><span class="fdays" style="color:' + it.u.color + '">' + it.daysLeft + '<span>天</span></span>'
            + '<span class="fstat" style="color:' + it.u.color + '">' + it.u.label + '</span></span>'
            + '</button>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    return html;
  }

  function ganttHTML(list) {
    if (list.length > state.showN) list = list.slice(0, state.showN);
    var today = todayStart(), WIN = 365;
    var html = '<div class="sec-head"><h2>开发倒推推演</h2><span class="sub">每根色带 = 从最晚启动日 → 节日当天</span><span class="line"></span></div>';
    html += '<div class="gantt"><div class="gantt-head"><div class="gh-l">节日节点</div><div class="gh-r">';
    for (var t = 0; t < 13; t++) {
      var md = new Date(today.getFullYear(), today.getMonth() + t, 1);
      var off = daysBetween(today, md);
      if (off < 0 || off > WIN) continue;
      html += '<div class="tick" style="left:' + ((off / WIN) * 100) + '%"><span>' + (md.getMonth() + 1) + '月</span></div>';
    }
    html += '</div></div>';
    if (!list.length) html += '<div class="mk-adm-empty">当前筛选条件下没有符合条件的节庆。</div>';
    for (var n = 0; n < list.length; n++) {
      var it = list[n];
      var occOff = daysBetween(today, it.occ);
      if (occOff < 0 || occOff > WIN) continue;
      var startOff = daysBetween(today, it.start);
      var leftPct = (Math.max(0, startOff) / WIN) * 100;
      var endOff = Math.min(daysBetween(today, it.end), WIN);
      var widthPct = Math.max((endOff / WIN) * 100 - leftPct, 0.6);
      var isOver = startOff < 0;
      html += '<div class="grow"><div class="gl" data-edit="' + esc(it.h.id) + '">'
        + '<div class="gn">' + esc(it.h.name) + '</div>'
        + '<div class="gm"><span class="tagline"><span class="cd" style="background:' + it.u.color + '"></span>' + it.lead + '天提前期</span>'
        + '<span>·</span><span>' + esc(it.h.region) + '</span>'
        + '<span>·</span><span>节期 ' + fmtShort(it.occ) + (it.dur > 1 ? ('–' + fmtShort(it.end)) : '') + '</span></div></div>'
        + '<div class="track"><div class="today-line" style="left:0%"></div>'
        + '<div class="gbar' + (isOver ? ' overrun' : '') + '" data-edit="' + esc(it.h.id) + '" style="left:' + leftPct + '%;width:' + widthPct + '%;background:' + it.u.color + ';color:' + it.u.color + '">'
        + '<span class="blabel">' + it.startDaysLeft + '天</span><span class="mk"></span></div></div></div>';
    }
    return html + '</div>';
  }

  /* ---------------- 主渲染 ---------------- */
  function render() {
    var zone = $(ZONE_ID);
    if (!zone) return;
    var list = build();
    var viewHTML = state.view === 'timeline' ? timelineHTML(list)
      : state.view === 'gantt' ? ganttHTML(list) : cardsHTML(list);

    zone.innerHTML = headHTML() + statsHTML(list)
      + '<div class="view mk-adm-view" id="mkFestView">' + viewHTML + '</div>'
      + '<div class="mk-prog" id="mkFestProg" hidden><div class="mk-prog-bar"><i></i></div>'
      + '<div class="mk-prog-txt" id="mkFestProgTxt"></div></div>'
      + '<div class="backdrop" id="mkFestMask"><div class="modal" id="mkFestModal"></div></div>'
      + '<div class="mktoast" id="mkFestToast"></div>';

    var more = $('mkFestMore');
    if (more) more.onclick = function () { state.showN += SHOW_STEP; render(); };

    var src = $('mkFestSrc');
    if (src) src.innerHTML = '<span class="dot"></span><span>数据来源：' + (state.fromDb ? '数据库' : '内置库（库里还没有数据）') + '</span>';
    bind();
  }

  /* 把数据库错误翻译成可执行的下一步（避免只报一个英文 message） */
  function dbHint(err) {
    var msg = String((err && err.message) || '');
    var code = String((err && err.code) || '');
    if (code === '42P01' || /does not exist|找不到|不存在/.test(msg) && /relation|table|表/.test(msg)) {
      return '数据表未建：请先在 SQL Editor 运行 tools/setup_marketing.sql';
    }
    if (code === '42703' || /column .* does not exist/.test(msg)) {
      return '表缺字段：请运行 tools/patch_20261021A.sql 补齐后再试';
    }
    if (code === '42501' || /row-level security|permission denied|权限/.test(msg)) {
      return '当前账号没有写入权限（仅管理员可维护节庆库）';
    }
    if (code === '23505') return '主键冲突，请重试';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return '网络中断，请检查连接后重试';
    return msg || '请检查权限与建表脚本';
  }

  function toast(msg) {
    var t = $('mkFestToast');
    if (!t) { return; }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    var zone = $(ZONE_ID);
    if (!zone) return;

    var tabs = $('mkFestTabs');
    if (tabs) tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-view]');
      if (!b) return;
      state.view = b.getAttribute('data-view');
      render();
    });

    var cats = $('mkFestCats');
    if (cats) cats.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-cat]');
      if (!b) return;
      var k = b.getAttribute('data-cat');
      state.cats[k] = !state.cats[k];
      render();
    });

    var stars = $('mkFestStars');
    if (stars) stars.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-star]');
      if (!b) return;
      state.starMin = parseInt(b.getAttribute('data-star'), 10) || 0;
      render();
    });

    var q = $('mkFestQ');
    if (q) {
      q.addEventListener('input', function () {
        state.q = this.value;
        var box = $('mkFestView');
        var list = build();
        /* 只重画内容区，输入框不丢焦点 */
        if (box) box.innerHTML = state.view === 'timeline' ? timelineHTML(list)
          : state.view === 'gantt' ? ganttHTML(list) : cardsHTML(list);
        var st = zone.querySelector('.stats');
        if (st) st.outerHTML = statsHTML(list);
        bindView();
      });
    }

    var rg = $('mkFestRegion');
    if (rg) rg.addEventListener('change', function () { state.region = this.value; render(); });

    var add = $('mkFestAdd');
    if (add) add.onclick = function () { openEdit(null); };

    var exp = $('mkFestExport');
    if (exp) exp.onclick = doExport;

    var imp = $('mkFestImport');
    var file = $('mkFestFile');
    if (imp && file) {
      imp.onclick = function () { file.value = ''; file.click(); };
      file.onchange = function () { if (file.files && file.files[0]) doImport(file.files[0]); };
    }

    var reb = $('mkFestRebuild');
    if (reb) reb.onclick = function () { doRebuild(this); };

    var clr = $('mkFestClear');
    if (clr) clr.onclick = function () { doClear(this); };

    bindView();
  }

  function bindView() {
    var zone = $(ZONE_ID);
    if (!zone) return;
    zone.querySelectorAll('[data-edit]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openEdit(el.getAttribute('data-edit'));
      });
    });
    zone.querySelectorAll('[data-del]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openEdit(el.getAttribute('data-del'), true);
      });
    });
    zone.querySelectorAll('.fcard').forEach(function (el) {
      el.addEventListener('click', function () { openEdit(el.getAttribute('data-fid')); });
    });
  }

  /* ---------------- 编辑弹窗（居中） ---------------- */
  function regionOptions(cur) {
    var list = regions();
    if (cur && list.indexOf(cur) < 0) list.push(cur);
    return list.map(function (r) {
      return '<option value="' + esc(r) + '"' + (r === cur ? ' selected' : '') + '>' + esc(r) + '</option>';
    }).join('') + '<option value="__new">＋ 其他地区…</option>';
  }

  function openEdit(id, wantDelete) {
    var h = null;
    for (var i = 0; i < state.list.length; i++) { if (state.list[i].id === id) { h = state.list[i]; break; } }
    var isNew = !h;
    state.editing = isNew ? null : h.id;

    var f = h || { name: '', en: '', region: '其他', date: '', cat: 'trad', star: 3, lead: 120, dur: 1, idea: '', note: '', overrides: null };
    var repeat = !/^\d{4}-\d{2}-\d{2}$/.test(String(f.date || ''));
    var dateVal = String(f.date || '');
    if (repeat && /^\d{2}-\d{2}$/.test(dateVal)) {
      var ty = new Date().getFullYear();
      dateVal = ty + '-' + dateVal;
    }

    var body = '<div class="modal-head"><h2>' + (isNew ? '新建节日' : '编辑节日') + '</h2>'
      + (isNew ? '' : '<p>' + esc(f.id) + ' · 保存后前台刷新即见</p>')
      + '</div><div class="modal-body">'
      + '<div class="preview">改完点「保存」直接写数据库，前台营销日历刷新后立刻生效；取消不会改动任何数据。</div>'
      + '<div class="grid2">'
      + '<div class="field"><label>节日名称 *</label><input id="mffName" maxlength="40" value="' + esc(f.name) + '" placeholder="如：情人节"></div>'
      + '<div class="field"><label>英文名</label><input id="mffEn" maxlength="60" value="' + esc(f.en || '') + '" placeholder="Valentine\'s Day"></div>'
      + '</div><div class="grid2">'
      + '<div class="field"><label>日期 *</label><input id="mffDate" type="date" value="' + esc(dateVal) + '">'
      + '<div class="checkline" style="margin-top:6px"><input type="checkbox" id="mffRepeat"' + (repeat ? ' checked' : '') + '><label for="mffRepeat" style="margin:0">每年重复（只按 MM-DD 记）</label></div></div>'
      + '<div class="field"><label>地区</label><select id="mffRegion">' + regionOptions(f.region) + '</select>'
      + '<input id="mffRegionNew" class="input" style="margin-top:6px;display:none" placeholder="填写地区名，如：荷兰"></div>'
      + '</div><div class="grid2">'
      + '<div class="field"><label>类别</label><select id="mffCat">' + Object.keys(CATS).map(function (k) {
        return '<option value="' + k + '"' + (f.cat === k ? ' selected' : '') + '>' + CATS[k].label + '</option>';
      }).join('') + '</select></div>'
      + '<div class="field"><label>重要度</label><div class="star-pick" id="mffStars">' + [1, 2, 3, 4, 5].map(function (s) {
        return '<button type="button" data-star="' + s + '" class="' + (s <= (f.star | 0) ? 'on' : '') + '">★</button>';
      }).join('') + '</div></div>'
      + '</div><div class="grid2">'
      + '<div class="field"><label>推荐提前期（天）</label><input id="mffLead" type="number" min="0" max="365" value="' + (f.lead == null ? 120 : f.lead) + '"></div>'
      + '<div class="field"><label>持续天数</label><input id="mffDur" type="number" min="1" max="90" value="' + (f.dur || 1) + '"></div>'
      + '</div>'
      + '<div class="field"><label>选品方向</label><textarea id="mffIdea" maxlength="200" placeholder="如：情侣同款上衣、心形印花、粉红配色连衣裙">' + esc(f.idea || '') + '</textarea></div>'
      + '<div class="field"><label>备注</label><input id="mffNote" maxlength="100" value="' + esc(f.note || '') + '" placeholder="内部备注，不对前台展示"></div>'
      + '</div><div class="modal-foot">'
      + (isNew ? '' : '<button type="button" class="btn btn-danger" id="mffDel">删除</button>')
      + '<span class="spacer"></span>'
      + '<button type="button" class="btn" id="mffCancel">取消</button>'
      + '<button type="button" class="btn btn-primary" id="mffSave">保存</button>'
      + '</div>';

    var modal = $('mkFestModal'), mask = $('mkFestMask');
    if (!modal || !mask) return;
    modal.innerHTML = body;
    mask.classList.add('open');

    var starVal = f.star | 0;
    var starBox = $('mffStars');
    if (starBox) starBox.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-star]');
      if (!b) return;
      starVal = parseInt(b.getAttribute('data-star'), 10) || 3;
      starBox.querySelectorAll('button').forEach(function (x) {
        x.classList.toggle('on', (parseInt(x.getAttribute('data-star'), 10) || 0) <= starVal);
      });
    });

    var regSel = $('mffRegion'), regNew = $('mffRegionNew');
    function syncRegionNew() {
      if (!regNew) return;
      regNew.style.display = regSel && regSel.value === '__new' ? 'block' : 'none';
    }
    if (regSel) regSel.addEventListener('change', syncRegionNew);
    syncRegionNew();

    function close() { mask.classList.remove('open'); modal.innerHTML = ''; }
    var cancel = $('mffCancel');
    if (cancel) cancel.onclick = close;
    mask.onclick = function (e) { if (e.target === mask) close(); };
    document.addEventListener('keydown', function escClose(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
    });
    document.addEventListener('keydown', function escSave(e) {
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') {
        var btn = $('mffSave'); if (btn) btn.click();
      }
    });

    if (wantDelete && !isNew) { /* 从卡片「删除」进来：直接停在弹窗里，按钮已可见 */ }

    var save = $('mffSave');
    if (save) save.onclick = function () { saveRow(f, starVal, isNew, save); };

    var del = $('mffDel');
    if (del) del.onclick = function () { removeRow(f, this); };
  }

  function saveRow(orig, starVal, isNew, btn) {
    var name = ($('mffName').value || '').trim();
    if (!name) { toast('请填写节日名称'); return; }
    var dv = $('mffDate').value;
    if (!dv) { toast('请选择日期'); return; }

    var repeat = $('mffRepeat').checked;
    var dateStr;
    if (repeat) {
      var p = dv.split('-');
      dateStr = p[1] + '-' + p[2];
    } else {
      dateStr = dv;
    }

    var regSel = $('mffRegion').value;
    var region = regSel === '__new' ? (($('mffRegionNew').value || '').trim() || '其他') : regSel;
    var lead = parseInt($('mffLead').value, 10); if (isNaN(lead) || lead < 0) lead = 0;
    var dur = parseInt($('mffDur').value, 10); if (isNaN(dur) || dur < 1) dur = 1;

    var id = isNew ? ('u' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36)) : orig.id;
    var row = {
      id: id, name: name, en: ($('mffEn').value || '').trim(), region: region,
      date: dateStr, cat: $('mffCat').value, star: starVal || 3,
      lead: lead, dur: dur, idea: ($('mffIdea').value || '').trim(),
      note: ($('mffNote').value || '').trim(), overrides: orig.overrides || null,
      sort_no: 0
    };

    if (typeof SB === 'undefined' || typeof SB.upsertFestivals !== 'function') { toast('接口未就绪（请刷新页面），无法保存'); return; }
    btn.disabled = true; btn.textContent = '保存中…';
    Promise.resolve().then(function () { return SB.upsertFestivals([row]); }).then(function (res) {
      btn.disabled = false; btn.textContent = '保存';
      if (res && res.error) { toast('保存失败：' + dbHint(res.error)); return; }
      var local = dbRowToFestival(row);
      var hit = -1;
      for (var i = 0; i < state.list.length; i++) { if (state.list[i].id === local.id) { hit = i; break; } }
      if (hit >= 0) state.list[hit] = local; else state.list.push(local);
      state.fromDb = true;
      var mask = $('mkFestMask'); if (mask) mask.classList.remove('open');
      render();
      toast((isNew ? '已创建「' : '已保存「') + name + '」');
    }).catch(function () {
      btn.disabled = false; btn.textContent = '保存';
      toast('保存失败，请稍后重试');
    });
  }

  function removeRow(f, btn) {
    if (btn.getAttribute('data-confirm') !== '1') {
      btn.setAttribute('data-confirm', '1');
      btn.textContent = '再点一次确认删除';
      return;
    }
    if (typeof SB === 'undefined' || typeof SB.deleteFestival !== 'function') { toast('接口未就绪（请刷新页面），无法删除'); return; }
    btn.disabled = true;
    Promise.resolve().then(function () { return SB.deleteFestival(f.id); }).then(function (res) {
      if (res && res.error) { btn.disabled = false; toast('删除失败：' + dbHint(res.error)); return; }
      state.list = state.list.filter(function (x) { return x.id !== f.id; });
      var mask = $('mkFestMask'); if (mask) mask.classList.remove('open');
      render();
      toast('已删除「' + f.name + '」');
    }).catch(function () { btn.disabled = false; toast('删除失败，请稍后重试'); });
  }

  /* ---------------- 导入 / 导出 / 重建 / 清空 ---------------- */
  function doExport() {
    var rows = state.list.map(function (f) {
      return {
        id: f.id, name: f.name, en: f.en, region: f.region, date: f.date,
        cat: f.cat, star: f.star, lead: f.lead, dur: f.dur,
        idea: f.idea, note: f.note, overrides: f.overrides || null
      };
    });
    var blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'marketing-festivals-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    toast('已导出 ' + rows.length + ' 条节庆');
  }

  /* ---------- 表格（xlsx / xls / csv）读取：表头中文英文都认 ---------- */
  var CAT_ALIAS = {
    '传统节庆':'trad','宗教节日':'rel','国家纪念':'nat','电商大促':'promo','体育赛事':'sport','季节档期':'season',
    '联邦法定假日':'nat','公众节假日':'nat','地方州节日':'nat','当地节日':'nat','节日庆典':'trad',
    '基督教节日':'rel','东正教节日':'rel','犹太教节日':'rel','犹太教纪念日':'rel','穆斯林节日':'rel','印度教节日':'rel',
    trad:'trad', rel:'rel', nat:'nat', promo:'promo', sport:'sport', season:'season'
  };
  /* 去掉表头里的括号说明与空格，便于精确比对 */
  function normKey(k){ return String(k || '').replace(/[（(][^）)]*[）)]/g, '').replace(/\s|[:：]/g, '').trim(); }

  function pickField(row, names){
    var want = names.map(normKey), k;
    for (var i = 0; i < want.length; i++) {
      for (k in row) { if (normKey(k) === want[i]) return row[k]; }
    }
    for (var j = 0; j < want.length; j++) {
      for (k in row) { if (normKey(k).indexOf(want[j]) >= 0) return row[k]; }
    }
    return '';
  }

  function pad2(n){ n = String(n); return n.length < 2 ? '0' + n : n; }

  function normDateCell(v){
    if (v instanceof Date) return pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
    var s = String(v == null ? '' : v).trim().replace(/[\/\.年月]/g, '-').replace(/日/g, '').replace(/-+$/,'');
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return pad2(m[2]) + '-' + pad2(m[3]);
    m = s.match(/^(\d{1,2})-(\d{1,2})$/);
    if (m) return pad2(m[1]) + '-' + pad2(m[2]);
    return normMMDD(s);
  }

  function parseStar(v){
    var raw = String(v == null ? '' : v).trim();
    var stars = (raw.match(/[★⭐]/g) || []).length;
    if (stars) return Math.min(5, stars);
    var n = parseInt(raw.replace(/[^0-9]/g, ''), 10);
    return n ? Math.min(5, Math.max(1, n)) : 3;
  }

  /* 把表格行（对象）转成导入结构；缺名称或日期返回 null */
  function rowFromSheet(r){
    var name = String(pickField(r, ['节日名称','名称','节日(中)','节日','name']) || '').trim();
    var date = normDateCell(pickField(r, ['日期','date']));
    if (!name || !date) return null;
    var catRaw = String(pickField(r, ['类别','分类','cat']) || '').trim();
    var leadRaw = parseInt(String(pickField(r, ['提前期','提前天数','lead']) || '').replace(/[^0-9]/g, ''), 10);
    var durRaw = parseInt(String(pickField(r, ['持续天数','持续','dur']) || '').replace(/[^0-9]/g, ''), 10);
    return {
      name: name,
      en: String(pickField(r, ['英文名','英文','节日(英)','en']) || '').trim(),
      region: String(pickField(r, ['地区','国家','region']) || '').trim() || '其他',
      date: date,
      cat: CAT_ALIAS[catRaw] || 'trad',
      star: parseStar(pickField(r, ['重要度','星级','star'])),
      lead: leadRaw >= 0 ? leadRaw : 120,
      dur: durRaw > 0 ? durRaw : 1,
      idea: String(pickField(r, ['选品方向','思路','idea']) || '').trim(),
      note: String(pickField(r, ['备注','note']) || '').trim(),
      overrides: null
    };
  }

  function readSheetRows(file, cb){
    var rd = new FileReader();
    rd.onload = function () {
      var wb;
      try { wb = XLSX.read(new Uint8Array(rd.result), { type: 'array', cellDates: true }); }
      catch (e) { toast('表格读不出来，请确认是 xlsx / xls / csv'); return; }
      /* 优先取「节日数据」页，否则取第一页 */
      var name = wb.SheetNames.indexOf('节日数据') >= 0 ? '节日数据' : wb.SheetNames[0];
      var ws = wb.Sheets[name];
      var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
      /* 找到含「名称 / 节日」与「日期」的表头行 */
      var hi = -1;
      for (var i = 0; i < Math.min(aoa.length, 12); i++) {
        var line = (aoa[i] || []).map(normKey).join('|');
        if (/日期/.test(line) && /名称|节日/.test(line)) { hi = i; break; }
      }
      if (hi < 0) { toast('表里没找到表头（需要含「节日名称」与「日期」两列）'); return; }
      var head = aoa[hi] || [];
      var list = [];
      for (var r = hi + 1; r < aoa.length; r++) {
        var obj = {};
        for (var c = 0; c < head.length; c++) { if (head[c] !== '') obj[head[c]] = aoa[r][c]; }
        list.push(obj);
      }
      cb(list);
    };
    rd.readAsArrayBuffer(file);
  }

  /* ---------------- 重复判定：同一国家 + 同一节日名 = 重复，导入时不覆盖 ---------------- */
  function dedupeKey(region, name){
    var r = String(region || '').replace(/\s+/g, '').toLowerCase();
    var n = String(name || '').replace(/[\s·・\-—_()（）\[\]【】]/g, '').toLowerCase();
    return r + '|' + n;
  }
  /* 与库里已有的、以及本文件内前面的行比对，重复的丢弃（保留库里原有的，不覆盖） */
  function splitByDup(rows, existingKeys){
    var seen = Object.create(null), keep = [], dup = 0;
    for (var i = 0; i < rows.length; i++) {
      var k = dedupeKey(rows[i].region, rows[i].name);
      if (existingKeys[k] || seen[k]) { dup++; continue; }
      seen[k] = 1;
      keep.push(rows[i]);
    }
    return { keep: keep, dup: dup };
  }
  /* 导入前先读库里现有清单，命中「同国同名」的直接跳过，绝不覆盖 */
  function commitRowsChecked(rows, skipped){
    if (!rows.length) { toast('没有可导入的有效数据（需要名称与日期）'); return; }
    if (typeof SB === 'undefined' || typeof SB.listFestivals !== 'function' || typeof SB.upsertFestivals !== 'function') {
      toast('接口未就绪（请刷新页面），无法导入'); return;
    }
    Promise.resolve().then(function () { return SB.listFestivals(); }).then(function (res) {
      if (res && res.error) { toast('读取现有节庆失败，为避免产生重复，已取消本次导入，请稍后重试'); return; }
      var keys = Object.create(null);
      var list = (res && res.data) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].name) keys[dedupeKey(list[i].region, list[i].name)] = 1;
      }
      var r = splitByDup(rows, keys);
      if (!r.keep.length) {
        toast('这 ' + rows.length + ' 条在库里都已存在（同一国家、同一节日），未覆盖任何数据');
        return;
      }
      commitRows(r.keep, skipped, r.dup);
    }).catch(function () {
      toast('读取现有节庆失败，为避免产生重复，已取消本次导入，请稍后重试');
    });
  }

  /* 导入进度：ratio 0~1 */
  function setProgress(ratio, label){
    var box = $('mkFestProg'), txt = $('mkFestProgTxt');
    if (!box) return;
    box.hidden = false;
    box.classList.add('on');
    var i = box.querySelector('.mk-prog-bar i');
    if (i) i.style.width = Math.max(0, Math.min(100, Math.round(ratio * 1000) / 10)) + '%';
    if (txt) txt.textContent = label || '';
  }
  function hideProgress(delay){
    setTimeout(function () {
      var box = $('mkFestProg');
      if (box) { box.classList.remove('on'); box.hidden = true; }
    }, delay || 1400);
  }

  /* 统一入库：rows 已是标准结构 */
  function commitRows(rows, skipped, dup) {
    if (!rows.length) { toast('没有可导入的有效数据（需要名称与日期）'); return; }
    if (typeof SB === 'undefined' || typeof SB.upsertFestivals !== 'function') { toast('接口未就绪（请刷新页面），无法导入'); return; }
    var done = 0;
    setProgress(0, '准备写入 0 / ' + rows.length + ' 条…');
    function next() {
      if (done >= rows.length) {
        setProgress(1, '完成：共写入 ' + rows.length + ' 条');
        hideProgress(1600);
        toast('新增 ' + rows.length + ' 条'
          + (skipped ? ('，跳过 ' + skipped + ' 条缺名称/日期') : '')
          + (dup ? ('，跳过 ' + dup + ' 条重复（同国同名，未覆盖原有）') : ''));
        reload(true);
        return;
      }
      var slice = rows.slice(done, done + 200);
      SB.upsertFestivals(slice).then(function (res) {
        if (res && res.error) { hideProgress(0); toast('导入失败：' + dbHint(res.error)); return; }
        done += slice.length;
        setProgress(done / rows.length, '已写入 ' + done + ' / ' + rows.length + ' 条（' + Math.round(done / rows.length * 100) + '%）');
        next();
      }).catch(function () { hideProgress(0); toast('导入失败，请稍后重试'); });
    }
    next();
  }

  function doImport(file) {
    var isSheet = !/\.json$/i.test(file.name || '');
    if (isSheet) {
      readSheetRows(file, function (list) {
        var rows = [], skipped = 0;
        for (var i = 0; i < list.length; i++) {
          var one = rowFromSheet(list[i] || {});
          if (!one) { skipped++; continue; }
          one.id = 'i' + Date.now().toString(36) + '_' + i;
          one.sort_no = 0;
          rows.push(one);
        }
        commitRowsChecked(rows, skipped);
      });
      return;
    }
    var rd = new FileReader();
    rd.onload = function () {
      var arr;
      try { arr = JSON.parse(String(rd.result || '[]')); } catch (e) { toast('文件不是合法 JSON'); return; }
      if (!Array.isArray(arr)) { toast('JSON 需要是数组'); return; }
      var rows = [], skipped = 0;
      for (var i = 0; i < arr.length; i++) {
        var r = arr[i] || {};
        var name = String(r.name || '').trim();
        var date = normMMDD(String(r.date || ''));
        if (!name || !date) { skipped++; continue; }
        rows.push({
          id: String(r.id || ('i' + Date.now().toString(36) + '_' + i)),
          name: name, en: String(r.en || ''), region: String(r.region || '其他'),
          date: date, cat: CATS[r.cat] ? r.cat : 'trad',
          star: Math.min(5, Math.max(1, parseInt(r.star, 10) || 3)),
          lead: Math.max(0, parseInt(r.lead, 10) || 120),
          dur: Math.max(1, parseInt(r.dur, 10) || 1),
          idea: String(r.idea || ''), note: String(r.note || ''),
          overrides: (r.overrides && typeof r.overrides === 'object') ? r.overrides : null,
          sort_no: 0
        });
      }
      commitRowsChecked(rows, skipped);
    };
    rd.readAsText(file);
  }

  function doRebuild(btn) {
    if (btn.getAttribute('data-confirm') !== '1') {
      btn.setAttribute('data-confirm', '1');
      btn.textContent = '再点一次确认';
      setTimeout(function () { btn.setAttribute('data-confirm', '0'); btn.textContent = '用内置库重建'; }, 4000);
      return;
    }
    btn.setAttribute('data-confirm', '0'); btn.textContent = '用内置库重建';
    var rows = defaults().map(function (f) {
      return {
        id: f.id, name: f.name, en: f.en, region: f.region, date: f.date,
        cat: f.cat, star: f.star, lead: f.lead, dur: f.dur, idea: f.idea,
        note: '', overrides: f.overrides, sort_no: 0
      };
    });
    if (typeof SB === 'undefined' || typeof SB.upsertFestivals !== 'function') { toast('接口未就绪（请刷新页面），无法重建'); return; }
    var done = 0;
    (function next() {
      if (done >= rows.length) { toast('已写入 ' + rows.length + ' 条内置节庆'); reload(true); return; }
      var slice = rows.slice(done, done + 200);
      done += slice.length;
      SB.upsertFestivals(slice).then(function (res) {
        if (res && res.error) { toast('写入失败：' + dbHint(res.error)); return; }
        next();
      }).catch(function () { toast('写入失败，请稍后重试'); });
    })();
  }

  function doClear(btn) {
    if (btn.getAttribute('data-confirm') !== '1') {
      btn.setAttribute('data-confirm', '1');
      btn.textContent = '再点一次清空';
      setTimeout(function () { btn.setAttribute('data-confirm', '0'); btn.textContent = '清空库'; }, 4000);
      return;
    }
    btn.setAttribute('data-confirm', '0'); btn.textContent = '清空库';
    if (typeof SB === 'undefined' || typeof SB.clearFestivals !== 'function') { toast('接口未就绪（请刷新页面），无法清空'); return; }
    Promise.resolve().then(function () { return SB.clearFestivals(); }).then(function (res) {
      if (res && res.error) { toast('清空失败：' + dbHint(res.error)); return; }
      state.list = []; state.fromDb = true;
      render();
      toast('已清空节庆库（可点「用内置库重建」恢复）');
    }).catch(function () { toast('清空失败，请稍后重试'); });
  }

  /* ---------------- 读库 ---------------- */
  function reload(force) {
    if (state.loaded && !force) return;
    state.loaded = true;
    if (typeof SB === 'undefined' || typeof SB.listFestivals !== 'function') {
      state.list = defaults();
      render();
      return;
    }
    Promise.resolve().then(function () { return SB.listFestivals(); }).then(function (res) {
      var rows = (res && res.data) || [];
      if (!rows.length) {
        /* 库里还没数据：先用内置库把界面画出来，并提示重建 */
        state.list = defaults();
        state.fromDb = false;
        render();
        toast('库里还没有节庆数据 · 点「用内置库重建」可一键写入 ' + state.list.length + ' 条');
        return;
      }
      var list = [];
      for (var i = 0; i < rows.length; i++) {
        var f = dbRowToFestival(rows[i]);
        if (f.name && f.date) list.push(f);
      }
      state.list = list.length ? list : defaults();
      state.fromDb = list.length > 0;
      render();
    }).catch(function () {
      state.list = defaults();
      state.fromDb = false;
      render();
    });
  }

  function mount() {
    var zone = $(ZONE_ID);
    if (!zone) return false;
    if (!state.list.length) state.list = defaults();
    render();
    reload(false);
    return true;
  }

  window.FEST = { mount: mount, reload: reload, state: state, _defaults: defaults };
})();
