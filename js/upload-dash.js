/* ============================================================================
 * upload-dash.js —— 前台「上传看板」（20261114G）
 * ----------------------------------------------------------------------------
 * 需求：
 *   1) 每个有图的专区顶部放一块看板：谁、几号、在哪些类目、各传了多少张；
 *   2) 所有管理员都能看到（不按上传人过滤，就是给协作看的）；
 *   3) 只在前台展示，后台作业台不动。
 *
 * 数据从哪来（不新建表、不跑 SQL）：
 *   · 「谁 + 什么时候」→ 上传归属（site_settings.frontend_dims.upload_owners，由 upload-owner.js 维护）
 *        榜单/上新节奏/标题组词台：按批次 ID（kind "b"）
 *        SHEIN / Pinterest / 品牌动向：按图片地址（kind "i"）
 *        视觉专区：images.uploaded_by + images.created_at（图库本来就有这两个字段）
 *   · 「哪些类目 + 多少张」→ 各专区自己的数据：
 *        rank_batches（类目 / 期次 / 行数）  → 趋势上升榜、上新节奏
 *        rank_items（channel 有值的那批）    → SHEIN / Pinterest
 *        movement_items                      → 品牌动向
 *        images                              → 视觉专区
 *
 * 归属口径（重要，避免同一个人被算两遍）：
 *   一个槽位可能登记了多个上传人（A 传了这批、B 后来又往同一批追加）。
 *   统计时只按「最早登记的那个人」记一次账，否则一张图会被记成两张。
 *   没有归属的历史数据单列一行「历史数据」，仍然算进总数。
 *
 * 降级：任何一路读取失败都不影响页面主体，只在看板里写「部分数据读取失败」。
 * ==========================================================================*/
(function () {
  "use strict";

  var BUILD = "20261114H";

  /* 各专区的统计来源。channels 用大写比较，写错大小写不影响。 */
  var ZONES = {
    rank: { label: "趋势上升榜", batches: ["rank"] },
    rhythm: { label: "上新节奏", batches: ["rhythm"] },
    shein: { label: "SHEIN 专区", channels: ["SHEIN"] },
    pinterest: { label: "Pinterest 专区", channels: ["PINTEREST"] },
    compare: { label: "渠道对比", batches: ["*"], channels: ["*"], movement: true, images: true },
    movement: { label: "品牌动向", movement: true },
    visual: { label: "视觉专区", images: true }
  };

  var HIST = "历史数据";

  function SB() { return window.SB || null; }
  function $(s, r) { return (r || document).querySelector(s); }
  function trim(v) { return String(v == null ? "" : v).trim(); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ISO → 本地日期（YYYY-MM-DD）。取不到就返回空串，界面上归到「日期未记录」。 */
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

  /* 名字：优先归属记录里的显示名，其次 profiles 的邮箱前缀，最后兜底 */
  /* 拿不到邮箱时也要能区分人：给 uid 留个短尾巴，别让几位管理员并成一行「管理员」 */
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

  /* ---------------- 各类数据 → 统一记录 ---------------- */
  /* 统一记录：{ who, day, cat, n }
       who = 管理员显示名（历史数据单列）
       day = YYYY-MM-DD（空串=日期未记录）
       cat = 类目名
       n   = 张数 */

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
        out.push({
          who: resolveName(own, names),
          day: own ? dayOf(own.t) : "",
          cat: trim(b && b.category) || "未分类",
          n: n
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
      out.push({
        who: resolveName(own, names),
        day: own ? dayOf(own.t) : "",
        cat: trim(r && r.category) || "未分类",
        n: 1
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
      out.push({
        who: resolveName(own, names),
        day: own ? dayOf(own.t) : dayOf(r.created_at),
        cat: trim(r && r.category) || "未分类",
        n: 1
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
      out.push({
        who: uid ? (names[uid] || uidLabel(uid)) : HIST,
        day: dayOf(r && (r.created_at || "")),
        cat: trim(r && r.category) || "未分类",
        n: 1
      });
    });
    return true;
  }

  /* ---------------- 汇总 ---------------- */
  /* 按「日期 → 管理员」分组，类目明细在组内聚合 */
  function group(records) {
    var byDay = {};
    (records || []).forEach(function (r) {
      var d = r.day || "";
      var key = d + "\u0001" + r.who;
      var g = byDay[key] || (byDay[key] = { day: d, who: r.who, cats: {}, n: 0 });
      g.cats[r.cat] = (g.cats[r.cat] || 0) + r.n;
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

  /* ---------------- 渲染 ---------------- */
  function renderShell(box, cfg) {
    box.innerHTML =
      '<div class="updash-head">' +
        '<span class="updash-t">上传看板 · ' + esc(cfg.label) + "</span>" +
        '<span class="updash-sub" data-roles>统计中…</span>' +
        '<button type="button" class="updash-toggle" data-toggle>收起</button>' +
      "</div>" +
      '<div class="updash-body" data-body><div class="updash-load">正在汇总上传记录…</div></div>';
    box.classList.add("updash");
  }

  function renderData(box, records, warn) {
    var sub = box.querySelector("[data-roles]");
    var body = box.querySelector("[data-body]");
    if (!body) return;
    var admins = perAdmin(records);
    var total = 0, realAdmins = 0;
    admins.forEach(function (a) { total += a.n; if (a.who !== HIST) realAdmins++; });
    if (sub) {
      sub.textContent = admins.length
        ? (realAdmins + " 位管理员 · 共 " + total.toLocaleString() + " 张" + (warn ? " · 部分数据读取失败" : ""))
        : ("还没有上传记录" + (warn ? " · 部分数据读取失败" : ""));
    }
    if (!admins.length) {
      body.innerHTML = '<div class="updash-empty">这个专区还没有可统计的上传记录。传图后这里会按「日期 / 管理员 / 类目」自动汇总，所有管理员都能看到。</div>';
      return;
    }
    var chips = admins.map(function (a) {
      return '<span class="updash-chip' + (a.who === HIST ? " is-hist" : "") + '"><b>' + esc(a.who) + "</b> " +
        a.n.toLocaleString() + " 张" +
        (a.last ? ' <i>最近 ' + esc(a.last.slice(5)) + "</i>" : "") + "</span>";
    }).join("");

    var rows = group(records).map(function (g) {
      var cats = Object.keys(g.cats).sort(function (a, b) { return g.cats[b] - g.cats[a]; })
        .map(function (c) { return '<span class="updash-cat">' + esc(c) + " <b>" + g.cats[c] + "</b></span>"; })
        .join("");
      return "<tr>" +
        '<td class="updash-d">' + (g.day ? esc(g.day) : '<span class="updash-nod">未记录日期</span>') + "</td>" +
        '<td class="updash-w">' + esc(g.who) + "</td>" +
        '<td class="updash-c">' + cats + "</td>" +
        '<td class="updash-n">' + g.n.toLocaleString() + "</td>" +
        "</tr>";
    }).join("");

    body.innerHTML =
      '<div class="updash-chips">' + chips + "</div>" +
      '<div class="updash-scroll"><table class="updash-tb">' +
        "<thead><tr><th>日期</th><th>管理员</th><th>类目（张数）</th><th>小计</th></tr></thead>" +
        "<tbody>" + rows + "</tbody>" +
      "</table></div>" +
      '<div class="updash-tip">口径：按每次上传登记的人与时间统计；同一批后来被别人追加过的，只记在最早那一位名下。' +
      "「" + HIST + "」是本功能上线前上传的图，没有归属记录。" +
      (warn ? " 本次有部分数据读取失败，数字可能偏少。" : "") + "</div>";

    var tg = box.querySelector("[data-toggle]");
    if (tg) {
      tg.onclick = function () {
        var closed = box.classList.toggle("is-closed");
        tg.textContent = closed ? "展开" : "收起";
      };
    }
  }

  /* ---------------- 主流程 ---------------- */
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

    var settled = await Promise.all(tasks.map(function (p) { return p.catch(function () { warn = true; }); }));
    void settled;
    return { records: records, warn: warn };
  }

  async function mount(key) {
    var cfg = ZONES[key];
    if (!cfg) return;
    var box = $('[data-updash="' + key + '"]');
    if (!box) return;
    /* 只给管理员看：访客连登录都没有，没必要多跑几次查询 */
    var role = null;
    try {
      var s = SB();
      if (s && typeof s.myRole === "function") role = await s.myRole();
    } catch (e) { role = null; }
    if (role !== "admin" && role !== "super_admin") { box.remove(); return; }

    renderShell(box, cfg);
    /* 稍等一下再统计：页面自己那一屏图先出来，别让统计查询跟首屏抢带宽。
       看板先显示「正在汇总…」，不影响主体内容。 */
    await new Promise(function (r) { setTimeout(r, 500); });
    var res = null;
    try { res = await build(key); } catch (e) { res = null; }
    if (!res) {
      var body = box.querySelector("[data-body]");
      if (body) body.innerHTML = '<div class="updash-empty">上传记录暂时读取不到，稍后刷新页面再试。</div>';
      return;
    }
    renderData(box, res.records, res.warn);
  }

  window.UploadDash = { BUILD: BUILD, mount: mount, ZONES: ZONES };
})();
