/* ============================================================================
 * upload-dash.js —— 后台「数据统计」+ 可视化图表（20261114N）
 * ----------------------------------------------------------------------------
 * 相对上一版的改动（用户要求）：
 *   1) 加可视化图表：谁、什么时候、哪个周次/哪个月、传了多少张，一屏直观看完；
 *   2) 可筛选可下钻：账号 / 类目 / 周次或月份 / 日期区间，点柱子就等于点筛选；
 *   3) 明细表补「期次」列，图上怎么显示、表里就怎么列。
 *
 * 统计口径与上一版一致（未改）：
 *   · 一个槽位只按「最早登记的人」记一次账，否则一张图会被记成两张；
 *   · 没有归属的历史数据单列「历史数据」，仍算进总数；
 *   · 每个专区各自独立统计，互不混算；所有管理员都能看到全员上传量。
 *
 * 「周次 / 月份」从哪来（不改表结构、不跑 SQL）：
 *   · 榜单 / 上新节奏批次：rank_batches.period_label + period_type（周度/月度）
 *   · SHEIN / Pinterest / 渠道对比：rank_items.period_label（月度）
 *   · 品牌动向 / 视觉专区：只有创建时间，按日期推算 ISO 周次与月份
 *
 * 图表实现：纯 HTML + 内联 SVG，不引任何外部库（离线可开、单文件交付）。
 * 性能：进入面板或切页签才查询；同一专区一次会话只查一次；筛选在前端内存里做，
 *       点筛选不再查库。首屏不为统计付出任何代价。
 * 降级：任何一路读取失败都不影响页面，只在面板里注明。
 * ==========================================================================*/
(function () {
  "use strict";

  var BUILD = "20261114N";

  /* 每个专区一条独立通道；channels 用大写比较，写错大小写不影响。
     ptype：该专区默认按「周次」还是「月份」看。 */
  var ZONES = {
    rank: { label: "趋势上升榜", batches: ["rank"], ptype: "week" },
    rhythm: { label: "上新节奏", batches: ["rhythm"], ptype: "month" },
    shein: { label: "SHEIN 专区", channels: ["SHEIN"], ptype: "month" },
    pinterest: { label: "Pinterest 专区", channels: ["PINTEREST"], ptype: "month" },
    compare: { label: "渠道对比", channels: ["*"], ptype: "month" },
    movement: { label: "品牌动向", movement: true, ptype: "month" },
    visual: { label: "视觉专区", images: true, ptype: "month" }
  };
  var ORDER = ["rank", "rhythm", "shein", "pinterest", "compare", "movement", "visual"];

  var HIST = "历史数据";

  function SB() { return window.SB || null; }
  function $(s, r) { return (r || document).querySelector(s); }
  function trim(v) { return String(v == null ? "" : v).trim(); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(n) { return Number(n || 0).toLocaleString(); }

  /* ---------------- 日期 / 期次 ---------------- */

  /* ISO → 本地日期（YYYY-MM-DD）；取不到返回空串，界面归到「未记录日期」 */
  function dayOf(iso) {
    var s = trim(iso);
    if (!s) return "";
    var d = new Date(s);
    if (isNaN(d.getTime())) return "";
    var m = String(d.getMonth() + 1), day = String(d.getDate());
    if (m.length < 2) m = "0" + m;
    if (day.length < 2) day = "0" + day;
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function monthOf(day) {
    var s = trim(day);
    return s.length >= 7 ? s.slice(0, 7) : "";
  }

  /* 2026-11-10 → 第46周（ISO 周，周一起算） */
  function isoWeekOf(day) {
    var s = trim(day);
    if (s.length < 10) return "";
    var p = s.split("-");
    var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    if (isNaN(d.getTime())) return "";
    var dow = (d.getUTCDay() + 6) % 7;               /* 周一 = 0 */
    d.setUTCDate(d.getUTCDate() - dow + 3);          /* 本周周四 */
    var firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    var fdow = (firstThu.getUTCDay() + 6) % 7;
    firstThu.setUTCDate(firstThu.getUTCDate() - fdow + 3);
    var wk = 1 + Math.round((d.getTime() - firstThu.getTime()) / 604800000);
    return wk > 0 ? "第" + wk + "周" : "";
  }

  /* 期次名归一：W45 / 45周 / 第45周 / 2026-W45 / 纯数字 45 → 第45周；月份原样保留 */
  function normWeek(v) {
    var s = trim(v);
    if (!s) return "";
    var n = 0, m;
    if ((m = s.match(/[Ww]\s*0*(\d{1,2})/))) n = parseInt(m[1], 10);
    else if ((m = s.match(/第\s*0*(\d{1,2})\s*周/))) n = parseInt(m[1], 10);
    else if ((m = s.match(/^0*(\d{1,2})\s*周$/))) n = parseInt(m[1], 10);
    else if (/^0*\d{1,2}$/.test(s)) n = parseInt(s, 10);
    if (n >= 1 && n <= 53) return "第" + n + "周";
    return s;
  }

  /* 期次排序：第N周按数字，月份按字典序 */
  function periodCmp(a, b) {
    var na = /^第(\d+)周$/.exec(a), nb = /^第(\d+)周$/.exec(b);
    if (na && nb) return Number(na[1]) - Number(nb[1]);
    if (na) return -1;
    if (nb) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /* 期次统一取一个字段交给界面：mode=week 取 week，mode=month 取 month */
  function periodOf(r, mode) {
    return (mode === "week" ? r.week : r.month) || "";
  }

  /* ---------------- 上传归属 ---------------- */
  function ownersOf(kind, key) {
    try {
      var U = window.UO;
      if (!U || !U._state) return [];
      var st = U._state();
      var doc = st && st.doc;
      var map = doc && doc[kind];
      var v = map && map[trim(key)];
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  /* 一个槽位只认最早登记的人（见文件头「归属口径」） */
  function firstOwner(list) {
    var best = null, bestT = null;
    (list || []).forEach(function (o) {
      if (!o || !o.u) return;
      var t = trim(o.t);
      if (!best) { best = o; bestT = t; return; }
      if (!bestT || (t && t < bestT)) { best = o; bestT = t; }
    });
    return best;
  }

  /* 拿不到名字时也要能区分人：给 uid 留个短尾巴，别把几位管理员并成一行「管理员」 */
  function uidLabel(uid) {
    var s = trim(uid);
    return s ? "管理员（" + s.slice(0, 4) + "）" : "管理员";
  }

  function resolveName(owner, names) {
    if (!owner) return HIST;
    var n = trim(owner.n);
    if (n) return n;
    var byId = names && owner.u ? names[owner.u] : "";
    if (byId) return byId;
    return uidLabel(owner.u);
  }

  async function loadNames() {
    var out = {};
    try {
      var s = SB();
      var c = s && s.client;
      if (!c) return out;
      var r = await c.from("profiles").select("user_id,email").limit(500);
      ((r && r.data) || []).forEach(function (p) {
        if (!p || !p.user_id) return;
        var e = trim(p.email);
        if (e) out[p.user_id] = e.split("@")[0];
      });
    } catch (e) { /* 读不到就按归属记录里的名字显示 */ }
    return out;
  }

  /* ---------------- 各类数据 → 统一记录 { who, day, cat, n, week, month } ---------------- */

  async function loadBatches(want, names, out) {
    var s = SB();
    var c = s && s.client;
    if (!c) return false;
    var all = want.indexOf("*") >= 0;
    for (var page = 0; page < 20; page++) {
      var r = await c.from("rank_batches").select("*")
        .order("id", { ascending: true }).range(page * 1000, page * 1000 + 999);
      if (r && r.error) return false;
      var rows = (r && r.data) || [];
      rows.forEach(function (b) {
        var src = trim(b && b.source);
        var domain = src || "rank";
        if (!all && want.indexOf(domain) < 0) return;
        var n = Number(b && b.rows);
        if (!n || n < 0) return;
        var own = firstOwner(ownersOf("b", String(b.id)));
        var day = own ? dayOf(own.t) : "";
        var label = trim(b && (b.period_label || b.period));
        var pt = (trim(b && b.period_type) || "week").toLowerCase();
        var week = pt === "month" ? isoWeekOf(day) : (label ? normWeek(label) : isoWeekOf(day));
        var month = pt === "month" ? (label || monthOf(day)) : monthOf(day);
        out.push({
          who: resolveName(own, names),
          day: day,
          cat: trim(b && b.category) || "未分类",
          n: n,
          week: week,
          month: month
        });
      });
      if (rows.length < 1000) break;
    }
    return true;
  }

  async function loadChannelPics(want, names, out) {
    var s = SB();
    if (!s || typeof s.listRankChannelPics !== "function") return false;
    var rows = await s.listRankChannelPics({ periodType: "month" });
    var all = want.indexOf("*") >= 0;
    (rows || []).forEach(function (r) {
      var ch = trim(r && r.channel).toUpperCase();
      if (!ch) return;
      if (!all && want.indexOf(ch) < 0) return;
      var own = firstOwner(ownersOf("i", String(r.image_url || "")));
      var day = own ? dayOf(own.t) : "";
      var label = trim(r && (r.period_label || r.month));
      out.push({
        who: resolveName(own, names),
        day: day,
        cat: trim(r && r.category) || "未分类",
        n: 1,
        week: isoWeekOf(day),
        month: label ? (monthOf(label.replace(/\//g, "-")) || label) : monthOf(day)
      });
    });
    return true;
  }

  async function loadMovement(names, out) {
    var s = SB();
    if (!s || typeof s.listMovementItems !== "function") return false;
    var rows = await s.listMovementItems(null);
    (rows || []).forEach(function (r) {
      var own = firstOwner(ownersOf("i", String(r.image_url || "")));
      var day = own ? dayOf(own.t) : dayOf(r.created_at);
      out.push({
        who: resolveName(own, names),
        day: day,
        cat: trim(r && r.category) || "未分类",
        n: 1,
        week: isoWeekOf(day),
        month: monthOf(day)
      });
    });
    return true;
  }

  async function loadImages(names, out) {
    var s = SB();
    if (!s) return false;
    var rows = [];
    try {
      rows = (typeof s.listAllImagesPaged === "function")
        ? await s.listAllImagesPaged()
        : await s.listImages(null);
    } catch (e) { return false; }
    (rows || []).forEach(function (r) {
      var uid = trim(r && r.uploaded_by);
      var day = dayOf(r && (r.created_at || ""));
      out.push({
        who: uid ? (names[uid] || uidLabel(uid)) : HIST,
        day: day,
        cat: trim(r && r.category) || "未分类",
        n: 1,
        week: isoWeekOf(day),
        month: monthOf(day)
      });
    });
    return true;
  }

  /* ---------------- 汇总 ---------------- */
  /* 按「日期 + 管理员」分组，类目与期次明细在组内聚合 */
  function group(records) {
    var byDay = {};
    (records || []).forEach(function (r) {
      var d = r.day || "";
      var key = d + "\u0001" + r.who;
      var g = byDay[key] || (byDay[key] = { day: d, who: r.who, cats: {}, ps: {}, n: 0 });
      g.cats[r.cat] = (g.cats[r.cat] || 0) + r.n;
      var p = r.week || r.month;
      if (p) g.ps[p] = 1;
      g.n += r.n;
    });
    var list = Object.keys(byDay).map(function (k) { return byDay[k]; });
    list.sort(function (a, b) {
      if (a.day !== b.day) {
        if (!a.day) return 1;
        if (!b.day) return -1;
        return a.day < b.day ? 1 : -1;
      }
      if (a.who === HIST && b.who !== HIST) return 1;
      if (b.who === HIST && a.who !== HIST) return -1;
      return b.n - a.n;
    });
    return list;
  }

  function perAdmin(records) {
    var m = {};
    (records || []).forEach(function (r) {
      var g = m[r.who] || (m[r.who] = { who: r.who, n: 0, days: {}, last: "" });
      g.n += r.n;
      if (r.day) {
        g.days[r.day] = 1;
        if (!g.last || r.day > g.last) g.last = r.day;
      }
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) {
      if (a.who === HIST && b.who !== HIST) return 1;
      if (b.who === HIST && a.who !== HIST) return -1;
      return b.n - a.n;
    });
  }

  /* 通用：按某个取值聚合张数 → [{label,n}]，desc */
  function sumBy(records, pick) {
    var m = {};
    (records || []).forEach(function (r) {
      var k = pick(r);
      if (!k) return;
      m[k] = (m[k] || 0) + r.n;
    });
    return Object.keys(m).map(function (k) { return { label: k, n: m[k] }; })
      .sort(function (a, b) { return b.n - a.n; });
  }

  /* ---------------- 筛选 ---------------- */
  var EMPTY_F = { who: "", cat: "", mode: "", period: "", from: "", to: "" };

  function filterState(key) {
    var f = fstate[key];
    if (!f) {
      f = fstate[key] = {};
      Object.keys(EMPTY_F).forEach(function (k) { f[k] = EMPTY_F[k]; });
      var cfg = ZONES[key] || {};
      f.mode = cfg.ptype === "week" ? "week" : "month";
    }
    return f;
  }

  function resetFilter(key) {
    var f = filterState(key);
    Object.keys(EMPTY_F).forEach(function (k) { f[k] = EMPTY_F[k]; });
    var cfg = ZONES[key] || {};
    f.mode = cfg.ptype === "week" ? "week" : "month";
    return f;
  }

  function applyFilter(records, f) {
    return (records || []).filter(function (r) {
      if (f.who && r.who !== f.who) return false;
      if (f.cat && r.cat !== f.cat) return false;
      if (f.period && periodOf(r, f.mode) !== f.period) return false;
      if (f.from && (!r.day || r.day < f.from)) return false;
      if (f.to && (!r.day || r.day > f.to)) return false;
      return true;
    });
  }

  function isFiltered(f) {
    return !!(f.who || f.cat || f.period || f.from || f.to);
  }

  /* 可选期次列表（按当前口径去重排序） */
  function periodList(records, mode) {
    var seen = {}, out = [];
    (records || []).forEach(function (r) {
      var p = periodOf(r, mode);
      if (!p || seen[p]) return;
      seen[p] = 1;
      out.push(p);
    });
    return out.sort(periodCmp);
  }

  /* ---------------- 图表（纯 HTML + 内联 SVG） ---------------- */

  function card(title, sub, inner) {
    return '<section class="updash-card">' +
      '<div class="updash-card-h"><h4>' + esc(title) + "</h4>" +
      (sub ? '<span class="updash-card-s">' + esc(sub) + "</span>" : "") + "</div>" +
      inner + "</section>";
  }

  /* 横向条形：点一下等于把筛选设成该值 */
  function hbars(items, field, opt) {
    var o = opt || {};
    var list = (items || []).slice(0, o.max || 8);
    if (!list.length) return '<div class="updash-none">暂无数据</div>';
    var max = list[0].n || 1;
    var html = list.map(function (it) {
      var w = Math.max(1.5, (it.n / max) * 100);
      var on = o.active && o.active === it.label;
      return '<button type="button" class="updash-hb' + (on ? " is-on" : "") + '"' +
        ' data-f="' + esc(field) + '" data-v="' + esc(it.label) + '" title="' + esc(it.label) + "：" + fmt(it.n) + ' 张">' +
        '<span class="updash-hbl">' + esc(it.label) + "</span>" +
        '<span class="updash-hbt"><i style="width:' + w.toFixed(1) + '%"></i></span>' +
        '<span class="updash-hbn">' + fmt(it.n) + "</span>" +
        "</button>";
    }).join("");
    var more = (items || []).length > list.length
      ? '<div class="updash-more">另有 ' + ((items || []).length - list.length) + " 项未列出</div>" : "";
    return '<div class="updash-hbars">' + html + "</div>" + more;
  }

  /* 纵向柱：周次 / 月份，点一下按该期次筛选 */
  function vbars(items, field, opt) {
    var o = opt || {};
    if (!items || !items.length) return '<div class="updash-none">暂无数据</div>';
    var max = 0;
    items.forEach(function (it) { if (it.n > max) max = it.n; });
    if (max <= 0) max = 1;
    var html = items.map(function (it) {
      var h = Math.max(2, (it.n / max) * 100);
      var on = o.active && o.active === it.label;
      return '<button type="button" class="updash-vb' + (on ? " is-on" : "") + '"' +
        ' data-f="' + esc(field) + '" data-v="' + esc(it.label) + '" title="' + esc(it.label) + "：" + fmt(it.n) + ' 张">' +
        '<span class="updash-vbn">' + fmt(it.n) + "</span>" +
        '<span class="updash-vbt"><i style="height:' + h.toFixed(1) + '%"></i></span>' +
        '<span class="updash-vbl">' + esc(it.label) + "</span>" +
        "</button>";
    }).join("");
    return '<div class="updash-vbars">' + html + "</div>";
  }

  /* 逐日趋势：SVG 面积 + 折线 + 数据点 */
  function spark(items) {
    var list = (items || []).slice();
    if (!list.length) return '<div class="updash-none">暂无数据</div>';
    var W = 760, H = 170, PL = 12, PR = 12, PT = 22, PB = 30;
    var iw = W - PL - PR, ih = H - PT - PB;
    var max = 0;
    list.forEach(function (d) { if (d.n > max) max = d.n; });
    if (max <= 0) max = 1;
    var n = list.length;
    var step = n > 1 ? iw / (n - 1) : 0;
    var pts = list.map(function (d, i) {
      var x = PL + (n > 1 ? i * step : iw / 2);
      var y = PT + ih - (d.n / max) * ih;
      return { x: x, y: y, d: d };
    });
    var line = pts.map(function (p, i) {
      return (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1);
    }).join(" ");
    var baseY = (PT + ih).toFixed(1);
    var area = line + " L" + (PL + iw).toFixed(1) + " " + baseY + " L" + PL.toFixed(1) + " " + baseY + " Z";
    var dots = pts.map(function (p) {
      return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="2.6">' +
        "<title>" + esc(p.d.label) + "：" + fmt(p.d.n) + " 张</title></circle>";
    }).join("");
    var every = Math.max(1, Math.ceil(n / 9));
    var xlabels = pts.map(function (p, i) {
      if (i % every !== 0 && i !== n - 1) return "";
      return '<text x="' + p.x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' +
        esc(String(p.d.label).slice(5) || p.d.label) + "</text>";
    }).join("");
    return '<div class="updash-spark"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img">' +
      '<path class="updash-ar" d="' + area + '"/>' +
      '<path class="updash-ln" d="' + line + '"/>' +
      '<g class="updash-dots">' + dots + "</g>" +
      '<g class="updash-xl">' + xlabels + "</g>" +
      "</svg></div>";
  }

  /* 管理员 × 期次 热力图：谁在哪个周次/月份传了多少 */
  function matrix(records, mode) {
    var admins = perAdmin(records).slice(0, 8);
    var cols = periodList(records, mode);
    if (!admins.length || !cols.length) return '<div class="updash-none">暂无数据</div>';
    if (cols.length > 14) cols = cols.slice(cols.length - 14);
    var cell = {};
    var max = 0;
    (records || []).forEach(function (r) {
      var p = periodOf(r, mode);
      if (!p || cols.indexOf(p) < 0) return;
      var k = r.who + "\u0001" + p;
      cell[k] = (cell[k] || 0) + r.n;
      if (cell[k] > max) max = cell[k];
    });
    if (max <= 0) max = 1;
    var head = '<tr><th class="updash-mx-w">管理员</th>' +
      cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") +
      "<th>合计</th></tr>";
    var body = admins.map(function (a) {
      var rowN = 0;
      var tds = cols.map(function (c) {
        var v = cell[a.who + "\u0001" + c] || 0;
        rowN += v;
        if (!v) return '<td class="updash-mx-0">·</td>';
        var al = 0.12 + (v / max) * 0.78;
        var fg = al > 0.5 ? "#fff" : "#3a3428";
        return '<td><span class="updash-mx-c" style="background:rgba(58,52,40,' + al.toFixed(2) +
          ");color:" + fg + '" title="' + esc(a.who) + " · " + esc(c) + "：" + v + ' 张">' + v + "</span></td>";
      }).join("");
      return '<tr><th class="updash-mx-w">' + esc(a.who) + "</th>" + tds +
        '<td class="updash-mx-t">' + fmt(rowN) + "</td></tr>";
    }).join("");
    return '<div class="updash-mx-scroll"><table class="updash-mx">' +
      "<thead>" + head + "</thead><tbody>" + body + "</tbody></table></div>";
  }

  /* ---------------- KPI ---------------- */
  function kpi(records) {
    var admins = perAdmin(records);
    var total = 0, realAdmins = 0, days = {}, cats = {}, minD = "", maxD = "";
    admins.forEach(function (a) { total += a.n; if (a.who !== HIST) realAdmins++; });
    (records || []).forEach(function (r) {
      if (r.day) {
        days[r.day] = 1;
        if (!minD || r.day < minD) minD = r.day;
        if (!maxD || r.day > maxD) maxD = r.day;
      }
      cats[r.cat] = 1;
    });
    var span = (minD && maxD) ? (minD === maxD ? minD : minD + " ~ " + maxD) : "未记录";
    function box(k, v, s) {
      return '<div class="updash-kpi"><b>' + v + "</b><span>" + esc(k) + "</span>" +
        (s ? '<i title="' + esc(s) + '">' + esc(s) + "</i>" : "") + "</div>";
    }
    return '<div class="updash-kpis">' +
      box("总张数", fmt(total)) +
      box("管理员", realAdmins + " 位") +
      box("类目", Object.keys(cats).length + " 个") +
      box("有记录的天数", Object.keys(days).length + " 天") +
      box("时间跨度", span) +
      "</div>";
  }

  /* ---------------- 筛选条 ---------------- */
  function filterBar(all, f, recs) {
    var admins = perAdmin(all).map(function (a) { return a.who; });
    var cats = sumBy(all, function (r) { return r.cat; }).map(function (x) { return x.label; });
    var periods = periodList(all, f.mode);
    if (f.period && periods.indexOf(f.period) < 0) f.period = "";
    function opts(list, cur, allLabel) {
      return '<option value="">' + esc(allLabel) + "</option>" +
        list.map(function (v) {
          return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(v) + "</option>";
        }).join("");
    }
    var nSel = 0;
    (recs || []).forEach(function (r) { nSel += r.n; });
    var nAll = 0;
    (all || []).forEach(function (r) { nAll += r.n; });
    return '<div class="updash-filter">' +
      "<label>账号<select data-f=\"who\">" + opts(admins, f.who, "全部账号") + "</select></label>" +
      "<label>类目<select data-f=\"cat\">" + opts(cats, f.cat, "全部类目") + "</select></label>" +
      "<label>口径<select data-f=\"mode\">" +
        '<option value="week"' + (f.mode === "week" ? " selected" : "") + ">按周次</option>" +
        '<option value="month"' + (f.mode === "month" ? " selected" : "") + ">按月份</option>" +
      "</select></label>" +
      "<label>期次<select data-f=\"period\">" + opts(periods, f.period, f.mode === "week" ? "全部周次" : "全部月份") + "</select></label>" +
      '<label>日期<input type="date" data-f="from" value="' + esc(f.from) + '"> ~ ' +
        '<input type="date" data-f="to" value="' + esc(f.to) + '"></label>' +
      '<button type="button" class="updash-reset" data-f="reset">重置筛选</button>' +
      '<span class="updash-fsum">显示 <b>' + fmt(nSel) + "</b> / 全部 " + fmt(nAll) + " 张" +
        (isFiltered(f) ? " <em>已筛选</em>" : "") + "</span>" +
      "</div>";
  }

  /* ---------------- 面板内容 ---------------- */
  function headText(records, warn) {
    var admins = perAdmin(records);
    var total = 0, realAdmins = 0;
    admins.forEach(function (a) { total += a.n; if (a.who !== HIST) realAdmins++; });
    if (!admins.length) return "还没有上传记录" + (warn ? " · 部分数据读取失败" : "");
    return realAdmins + " 位管理员 · 共 " + total.toLocaleString() + " 张" + (warn ? " · 部分数据读取失败" : "");
  }

  function tableHtml(records) {
    var rows = group(records).map(function (g) {
      var cats = Object.keys(g.cats).sort(function (a, b) { return g.cats[b] - g.cats[a]; })
        .map(function (c) { return '<span class="updash-cat">' + esc(c) + " <b>" + g.cats[c] + "</b></span>"; })
        .join("");
      var pTxt = Object.keys(g.ps || {}).sort(periodCmp).join(" / ");
      return "<tr>" +
        '<td class="updash-d">' + (g.day ? esc(g.day) : '<span class="updash-nod">未记录日期</span>') + "</td>" +
        '<td class="updash-p">' + (pTxt ? esc(pTxt) : '<span class="updash-nod">—</span>') + "</td>" +
        '<td class="updash-w">' + esc(g.who) + "</td>" +
        '<td class="updash-c">' + cats + "</td>" +
        '<td class="updash-n">' + g.n.toLocaleString() + "</td>" +
        "</tr>";
    }).join("");
    if (!rows) return '<div class="updash-none">没有符合当前筛选条件的记录。</div>';
    return '<div class="updash-scroll"><table class="updash-tb">' +
      "<thead><tr><th>日期</th><th>期次</th><th>管理员</th><th>类目（张数）</th><th>小计</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div>";
  }

  function bodyHtml(all, recs, f, warn) {
    all = all || [];
    if (!all.length) {
      if (warn) return '<div class="updash-empty">上传记录暂时读取不到，稍后再点一次「重新统计」。</div>';
      return '<div class="updash-empty">这个专区还没有可统计的上传记录。传图后这里会按「日期 / 管理员 / 类目 / 期次」自动汇总，并画出图表。</div>';
    }
    f = f || filterState("_");
    var mode = f.mode === "week" ? "week" : "month";
    var modeLabel = mode === "week" ? "周次" : "月份";
    var byAdmin = perAdmin(recs).map(function (a) { return { label: a.who, n: a.n }; });
    var byCat = sumBy(recs, function (r) { return r.cat; });
    var byPeriod = sumBy(recs, function (r) { return periodOf(r, mode); })
      .sort(function (a, b) { return periodCmp(a.label, b.label); });
    var byDay = sumBy(recs, function (r) { return r.day; })
      .sort(function (a, b) { return a.label < b.label ? -1 : 1; });

    var charts =
      card("按" + modeLabel + "看上传量", "点柱子只看那一" + (mode === "week" ? "周" : "个月"), vbars(byPeriod, "period", { active: f.period })) +
      card("按账号看上传量", "点一下只看这个人", hbars(byAdmin, "who", { max: 8, active: f.who })) +
      card("逐日上传趋势", byDay.length + " 天有记录", spark(byDay)) +
      card("账号 × " + modeLabel + "（热力）", "越深表示传得越多", matrix(recs, mode)) +
      card("类目 TOP", "点一下只看这个类目", hbars(byCat, "cat", { max: 10, active: f.cat }));

    return filterBar(all, f, recs) +
      kpi(recs) +
      '<div class="updash-grid">' + charts + "</div>" +
      '<div class="updash-tbwrap">' + tableHtml(recs) + "</div>" +
      '<div class="updash-tip">口径：按每次上传登记的人与时间统计；同一批后来被别人追加过的，只记在最早那一位名下。' +
      "「" + HIST + "」是本功能上线前上传的图，没有归属记录。" +
      "周次为 ISO 周（周一起算），期次取自导入时填写的期次；图表里的筛选只影响本页显示，不改动任何数据。" +
      (warn ? " 本次有部分数据读取失败，数字可能偏少。" : "") + "</div>";
  }

  /* ---------------- 取数（按专区各自缓存） ---------------- */
  var cache = {};    /* zoneKey → { records, warn, at } */
  var fstate = {};   /* zoneKey → 筛选条件 */

  async function build(key) {
    var cfg = ZONES[key];
    if (!cfg) return null;
    var names = {};
    try {
      if (window.UO && typeof window.UO.ensure === "function") await window.UO.ensure();
    } catch (e) { /* 归属读不到 → 全部落「历史数据」，仍能看出类目与张数 */ }
    try { names = await loadNames(); } catch (e) { names = {}; }

    var records = [], warn = false;
    var tasks = [];
    if (cfg.batches) tasks.push(loadBatches(cfg.batches, names, records).then(function (ok) { if (!ok) warn = true; }));
    if (cfg.channels) tasks.push(loadChannelPics(cfg.channels, names, records).then(function (ok) { if (!ok) warn = true; }));
    if (cfg.movement) tasks.push(loadMovement(names, records).then(function (ok) { if (!ok) warn = true; }));
    if (cfg.images) tasks.push(loadImages(names, records).then(function (ok) { if (!ok) warn = true; }));

    await Promise.all(tasks.map(function (p) { return p.catch(function () { warn = true; }); }));
    var res = { records: records, warn: warn, at: Date.now() };
    cache[key] = res;
    return res;
  }

  /* ---------------- 后台面板渲染 ---------------- */
  var active = "";      /* 当前选中的专区 */
  var mounted = false;

  function tabsHtml() {
    return ORDER.map(function (k) {
      var cfg = ZONES[k];
      return '<button type="button" class="updash-tab' + (k === active ? " is-active" : "") +
        '" data-zone="' + k + '" role="tab">' + esc(cfg.label) + "</button>";
    }).join("");
  }

  function paintTabs() {
    var box = $("#updash-tabs");
    if (!box) return;
    box.innerHTML = tabsHtml();
    var btns = (box.querySelectorAll ? box.querySelectorAll(".updash-tab") : []) || [];
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.onclick = function () { selectZone(b.getAttribute("data-zone")); };
      })(btns[i]);
    }
  }

  function setSub(text) {
    var el = $("#updash-sub");
    if (el) el.textContent = text || "";
  }

  function setBody(html) {
    var el = $("#updash-body");
    if (el) el.innerHTML = html;
  }

  /* 筛选控件与图表点击：改状态 → 重绘（不再查库） */
  function bindBody() {
    var box = $("#updash-body");
    if (!box || !box.querySelectorAll) return;
    var els = box.querySelectorAll("[data-f]") || [];
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        var fld = el.getAttribute("data-f");
        if (fld === "reset") {
          el.onclick = function () {
            resetFilter(active);
            paintBody();
          };
          return;
        }
        if (el.tagName === "SELECT" || el.tagName === "INPUT") {
          el.onchange = function () {
            var f = filterState(active);
            if (fld === "mode") {
              f.mode = el.value === "week" ? "week" : "month";
              f.period = "";
            } else {
              f[fld] = trim(el.value);
            }
            paintBody();
          };
          return;
        }
        el.onclick = function () {
          var f = filterState(active);
          var v = el.getAttribute("data-v") || "";
          if (fld === "who" || fld === "cat" || fld === "period") f[fld] = (f[fld] === v ? "" : v);
          paintBody();
        };
      })(els[i]);
    }
  }

  function paintBody() {
    var res = cache[active];
    if (!res) return;
    var f = filterState(active);
    var recs = applyFilter(res.records, f);
    var cfg = ZONES[active] || { label: "" };
    setSub("数据统计 · " + cfg.label + " · " + headText(recs, res.warn));
    setBody(bodyHtml(res.records, recs, f, res.warn));
    bindBody();
  }

  async function selectZone(key) {
    if (!ZONES[key]) return;
    active = key;
    paintTabs();
    var cfg = ZONES[key];
    setSub("数据统计 · " + cfg.label + " · 统计中…");
    var res = cache[key];
    if (!res) {
      setBody('<div class="updash-load">正在汇总「' + esc(cfg.label) + "」的上传记录…</div>");
      try { res = await build(key); } catch (e) { res = null; }
    }
    /* 期间可能已切到别的专区 */
    if (active !== key) return;
    if (!res) {
      setSub("数据统计 · " + cfg.label + " · 读取失败");
      setBody('<div class="updash-empty">上传记录暂时读取不到，稍后再点一次「重新统计」。</div>');
      return;
    }
    paintBody();
  }

  /* 进入后台面板时调用（首次渲染页签 + 载入默认专区） */
  function enter(key) {
    var box = $("#updash-tabs");
    if (!box) return;
    if (key && ZONES[key]) active = key;
    if (!active) active = ORDER[0];
    if (!mounted) {
      mounted = true;
      var rf = $("#updash-refresh");
      if (rf) rf.onclick = function () {
        if (!active) return;
        delete cache[active];
        selectZone(active);
      };
    }
    paintTabs();
    selectZone(active);
  }

  window.UploadDash = {
    BUILD: BUILD,
    enter: enter,
    selectZone: selectZone,
    ZONES: ZONES,
    ORDER: ORDER,
    _active: function () { return active; },
    _reset: function () { cache = {}; fstate = {}; mounted = false; active = ""; },
    _t: {
      group: group, perAdmin: perAdmin, bodyHtml: bodyHtml, headText: headText,
      isoWeekOf: isoWeekOf, normWeek: normWeek, applyFilter: applyFilter,
      periodCmp: periodCmp, sumBy: sumBy, matrix: matrix, spark: spark,
      filterState: filterState, resetFilter: resetFilter
    }
  };
})();
