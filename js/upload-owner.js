/* ============================================================
 * 20261113L · 上传归属（谁能管理谁传的图）
 * ------------------------------------------------------------
 * 需求：
 *   1) 所有管理员都能看到所有人上传的图；
 *   2) 但「会改动别人数据」的操作只能对自己上传的那部分做：
 *      删除（单张 / 一整行 / 勾选批量 / 整批 / 整期次）、批量编辑（月份、日期、类目、渠道）、
 *      改期次名、切频次。
 *   3) 超级管理员不受限制。
 *   4) 本功能上线前导入/上传的数据没有归属，记作「历史数据」，只有超管能改。
 *
 * 为什么不做成「只看自己的」：
 *   看是协作需要（互相参考选品），管是责任边界（别把别人传的删了）。两者分开。
 *
 * 归属存在 site_settings.frontend_dims.upload_owners —— 不改表结构、不用跑 SQL：
 *   {
 *     b: { "<批次ID>": [ {u:uid, n:显示名, t:时间}, … ] },   // 榜单批次（趋势上升榜 / 上新节奏）
 *     i: { "<图片地址>": [ {u:uid, n:显示名, t:时间}, … ] }   // 渠道图（Pinterest / SHEIN 等专区）
 *   }
 * 一个槽位允许多个归属人：A 传了这批、B 又往同一批追加过图，两人都能管，不会互相卡死。
 *
 * 20261116A · 上传日期更正
 *   后台「数据统计」的日期取的是归属记录里的 t（登记上传那一刻）。要纠正历史日期，
 *   直接改 t 会把「谁在什么时候登记的」这条痕迹一起抹掉，所以另存一份覆盖值 d：
 *     · 统计优先用 d，没有 d 再用 t，最后才用记录自身的 created_at；
 *     · 只覆盖「显示日期」，不动上传人、不动榜单/图片数据；
 *     · 日期键做归一（去掉域名与查询串），同一张图存成完整地址或相对路径都认得出。
 *
 * 另外在 localStorage 留一份镜像：写库失败（权限/网络）时，至少本机当场还能认出自己传的，
 * 不会出现「刚传完就删不掉自己的图」。
 * ============================================================ */
(function () {
  "use strict";

  var KEY = "upload_owners";      // site_settings.frontend_dims.upload_owners
  var LS = "sb.upload_owners_v1"; // 本机镜像
  var TTL = 30000;
  var MAX_OWNERS = 8;             // 一个槽位最多记这么多归属人，防止无限增长

  var doc = null, docAt = 0, loading = null;
  var meUid = null, meName = "", meAt = 0;

  function SB() { return window.SB || null; }
  function trim(v) { return String(v == null ? "" : v).trim(); }
  function nowIso() { return new Date().toISOString(); }
  function emptyDoc() { return { b: {}, i: {}, d: { b: {}, i: {} } }; }
  /* 图片地址归一：去掉域名、查询串、开头的斜杠，同一张图不同写法落到同一个键上 */
  function normKey(kind, key) {
    var s = trim(key);
    if (kind !== "i" || !s) return s;
    s = s.split("#")[0].split("?")[0];
    var m = /^[a-z]+:\/\/[^/]+\/(.*)$/i.exec(s);
    if (m) s = m[1];
    return s.replace(/^\/+/, "");
  }

  function normDoc(d) {
    var o = emptyDoc();
    if (d && typeof d === "object") {
      if (d.b && typeof d.b === "object" && !Array.isArray(d.b)) o.b = d.b;
      if (d.i && typeof d.i === "object" && !Array.isArray(d.i)) o.i = d.i;
      if (d.d && typeof d.d === "object") {
        ["b", "i"].forEach(function (k) {
          if (d.d[k] && typeof d.d[k] === "object" && !Array.isArray(d.d[k])) o.d[k] = d.d[k];
        });
      }
    }
    return o;
  }

  /* 本机镜像：只用来兜底，结构相同 */
  function lsRead() {
    try { return normDoc(JSON.parse(localStorage.getItem(LS) || "null")); } catch (e) { return emptyDoc(); }
  }
  function lsWrite(d) {
    try { localStorage.setItem(LS, JSON.stringify(d)); } catch (e) { /* 配额满就放弃镜像 */ }
  }
  /* 服务端 + 本机镜像合并：两边都有时取并集（同一个人只算一次） */
  function mergeDocs(a, b) {
    var out = emptyDoc();
    ["b", "i"].forEach(function (k) {
      var src = [a && a[k], b && b[k]];
      src.forEach(function (map) {
        if (!map) return;
        Object.keys(map).forEach(function (key) {
          var list = Array.isArray(map[key]) ? map[key] : [];
          var cur = out[k][key] || (out[k][key] = []);
          list.forEach(function (o) {
            if (!o || !o.u) return;
            if (!cur.some(function (x) { return x && x.u === o.u; })) cur.push({ u: o.u, n: trim(o.n), t: trim(o.t) });
          });
        });
      });
    });
    /* 日期更正：同一条记录两边都有时，取「改动更晚」的那份（at 大的赢） */
    [a && a.d, b && b.d].forEach(function (dd) {
      if (!dd) return;
      ["b", "i"].forEach(function (k) {
        var m = dd[k];
        if (!m || typeof m !== "object" || Array.isArray(m)) return;
        Object.keys(m).forEach(function (key) {
          var nv = m[key];
          if (!nv || !trim(nv.v)) return;
          var cur = out.d[k][key];
          if (!cur || String(nv.at || "") >= String(cur.at || "")) out.d[k][key] = { v: trim(nv.v), u: trim(nv.u), n: trim(nv.n), at: trim(nv.at) };
        });
      });
    });
    return out;
  }

  /* ---------- 当前登录人 ---------- */
  async function whoami(force) {
    if (!force && meUid && Date.now() - meAt < 60000) return { uid: meUid, name: meName };
    meAt = Date.now();
    try {
      var s = SB();
      var sess = s && typeof s.getSession === "function" ? await s.getSession() : null;
      var u = sess && sess.user;
      meUid = (u && u.id) || null;
      var email = trim(u && u.email);
      meName = email ? email.split("@")[0] : (meUid ? "管理员" : "");
    } catch (e) { meUid = null; meName = ""; }
    return { uid: meUid, name: meName };
  }

  /* 超级管理员：admin.js 里的 currentRole 在全局词法作用域，其它经典脚本能直接读到；
     读不到就按「不是超管」处理，宁可收紧也不放开。 */
  function isSuper() {
    try {
      if (typeof currentRole !== "undefined" && currentRole === "super_admin") return true;
    } catch (e) { /* 忽略 */ }
    try { if (typeof window.isSuper === "function" && window.isSuper()) return true; } catch (e) { /* 忽略 */ }
    return false;
  }

  /* ---------- 读写 ---------- */
  async function load(force) {
    if (!force && doc && Date.now() - docAt < TTL) return doc;
    if (loading) return loading;
    loading = (async function () {
      var remote = emptyDoc();
      try {
        var c = SB() && SB().client;
        if (c) {
          var r = await c.from("site_settings").select("frontend_dims").eq("id", 1).maybeSingle();
          var dims = (r && r.data && r.data.frontend_dims) || {};
          remote = normDoc(dims[KEY]);
        }
      } catch (e) { remote = emptyDoc(); }
      doc = mergeDocs(remote, lsRead());
      docAt = Date.now();
      loading = null;
      return doc;
    })();
    return loading;
  }

  /* merge=true：先取库里最新值再与本地的并集，避免两个管理员同时传图时互相覆盖归属 */
  async function save(next, merge) {
    doc = normDoc(next);
    docAt = Date.now();
    lsWrite(doc);
    try {
      var c = SB() && SB().client;
      if (!c) return false;
      var r = await c.from("site_settings").select("frontend_dims").eq("id", 1).maybeSingle();
      var dims = Object.assign({}, (r && r.data && r.data.frontend_dims) || {});
      var out = doc;
      if (merge) {
        var remote = normDoc(dims[KEY]);
        out = mergeDocs(remote, doc);   // 并集：谁新登记的都不丢
      }
      dims[KEY] = out;   // 只替换本键，其它配置（导图 / 分组 / 可见性）原样保留
      var e = await c.from("site_settings")
        .update({ frontend_dims: dims, updated_at: nowIso() }).eq("id", 1);
      if (merge) { doc = out; lsWrite(out); }
      return !(e && e.error);
    } catch (e) { return false; }
  }

  function listOf(kind, key) {
    var k = trim(key);
    if (!k || !doc || !doc[kind]) return [];
    var v = doc[kind][k];
    return Array.isArray(v) ? v : [];
  }

  /* ---------- 对外：能不能管 ----------
     面板渲染是同步循环，所以这里拆成「先 ensure 一次，再同步判断」：
     渲染前 await UO.ensure()，之后每个格子直接 UO.canManage(...) 同步取，不用 await 几百次。 */
  async function ensure() {
    await load();
    await whoami();
    return true;
  }

  function canManage(kind, key) {
    if (isSuper()) return true;
    if (!meUid) return false;
    return listOf(kind, key).some(function (o) { return o && o.u === meUid; });
  }

  function canManageList(kind, keys) {
    var list = (keys || []).map(trim).filter(Boolean);
    if (isSuper()) return { ok: list.slice(), denied: [] };
    var okList = [], denied = [];
    list.forEach(function (k) {
      var mine = !!(meUid && listOf(kind, k).some(function (o) { return o && o.u === meUid; }));
      (mine ? okList : denied).push(k);
    });
    return { ok: okList, denied: denied };
  }

  /* 没有归属的（本功能上线前的历史数据）只有超管能动 */
  function label(kind, key) {
    var list = listOf(kind, key);
    if (!list.length) return "历史数据";
    return list.map(function (o) { return trim(o.n) || "管理员"; }).join("、");
  }

  function hint(kind, key) {
    var list = listOf(kind, key);
    if (!list.length) return "上传人：历史数据（本功能上线前导入/上传，只有超级管理员可改动）";
    var who = list.map(function (o) { return trim(o.n) || "管理员"; }).join("、");
    if (isSuper()) return "上传人：" + who + "（你是超级管理员，可改动）";
    return "上传人：" + who + (canManage(kind, key) ? "（你上传的，可改动）" : "（只有上传人本人或超级管理员可改动）");
  }

  /* ---------- 对外：登记归属 ---------- */
  async function claim(kind, keys) {
    var list = (Array.isArray(keys) ? keys : [keys]).map(trim).filter(Boolean);
    if (!list.length) return false;
    var me = await whoami();
    if (!me.uid) return false;             // 访客/未登录：不记归属
    await load();
    var next = normDoc(JSON.parse(JSON.stringify(doc || emptyDoc())));
    var map = next[kind] || (next[kind] = {});
    var at = nowIso();
    list.forEach(function (k) {
      var cur = Array.isArray(map[k]) ? map[k] : [];
      var hit = null;
      cur.forEach(function (o) { if (o && o.u === me.uid) hit = o; });
      if (hit) { hit.n = me.name || hit.n; hit.t = at; }
      else cur.push({ u: me.uid, n: me.name, t: at });
      if (cur.length > MAX_OWNERS) cur = cur.slice(cur.length - MAX_OWNERS);
      map[k] = cur;
    });
    /* 认领只做加法：库里若已有别人刚登记的归属，不能被这次覆盖掉 */
    return await save(next, true);
  }

  /* 认领全部历史数据（超管用）：把这些 key 记到当前账号名下 */
  async function adopt(kind, keys) {
    if (!isSuper()) return false;
    return await claim(kind, keys);
  }

  /* 删档后顺手清理，避免这张表越积越大（同 key 反复导入不会无限膨胀） */
  async function forget(kind, keys) {
    var list = (Array.isArray(keys) ? keys : [keys]).map(trim).filter(Boolean);
    if (!list.length) return false;
    await load();
    var next = normDoc(JSON.parse(JSON.stringify(doc || emptyDoc())));
    var map = next[kind] || {};
    var dmap = (next.d && next.d[kind]) || {};
    var hit = false;
    list.forEach(function (k) {
      if (map[k]) { delete map[k]; hit = true; }
      /* 20261116A：日期更正跟着一起清，不留孤儿键 */
      var nk = normKey(kind, k);
      if (dmap[nk]) { delete dmap[nk]; hit = true; }
    });
    if (!hit) return true;
    return await save(next);
  }

  /* ---------- 对外：上传日期更正 ----------
     dateOf  : 取某条记录被更正后的日期（没有就返回空串，交给调用方回退到 t / created_at）
     setDate : 批量写入日期（权限与「能不能改」同一套：本人或超管）
     clearDate: 撤销更正，回到原来的登记时间 */
  function dayOk(v) {
    var s = trim(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  }

  function dateOf(kind, key) {
    try {
      if (!doc || !doc.d || !doc.d[kind]) return "";
      var hit = doc.d[kind][normKey(kind, key)];
      return hit ? dayOk(hit.v) : "";
    } catch (e) { return ""; }
  }

  function dateInfo(kind, key) {
    try {
      var hit = doc && doc.d && doc.d[kind] ? doc.d[kind][normKey(kind, key)] : null;
      return hit || null;
    } catch (e) { return null; }
  }

  async function setDate(kind, keys, day) {
    var d = dayOk(day);
    var list = (Array.isArray(keys) ? keys : [keys]).map(trim).filter(Boolean);
    if (!d || !list.length) return { ok: [], denied: list };
    await load();
    await whoami();
    /* 没有归属的历史数据只有超管能改（与本模块其它改动口径一致） */
    var gate = canManageList(kind, list);
    if (!gate.ok.length) return { ok: [], denied: gate.denied };
    var next = normDoc(JSON.parse(JSON.stringify(doc || emptyDoc())));
    var map = next.d[kind] || (next.d[kind] = {});
    var at = nowIso();
    gate.ok.forEach(function (k) {
      map[normKey(kind, k)] = { v: d, u: meUid || "", n: meName || "", at: at };
    });
    var saved = await save(next, true);
    return { ok: gate.ok, denied: gate.denied, saved: saved };
  }

  async function clearDate(kind, keys) {
    var list = (Array.isArray(keys) ? keys : [keys]).map(trim).filter(Boolean);
    if (!list.length) return { ok: [], denied: list };
    await load();
    await whoami();
    var gate = canManageList(kind, list);
    if (!gate.ok.length) return { ok: [], denied: gate.denied };
    var next = normDoc(JSON.parse(JSON.stringify(doc || emptyDoc())));
    var map = next.d[kind] || {};
    var hit = false;
    gate.ok.forEach(function (k) { var nk = normKey(kind, k); if (map[nk]) { delete map[nk]; hit = true; } });
    if (!hit) return { ok: gate.ok, denied: gate.denied, saved: true };
    var saved = await save(next);
    return { ok: gate.ok, denied: gate.denied, saved: saved };
  }

  /* 删档后顺手把日期更正也清掉，别留孤儿键 */
  async function forgetDates(kind, keys) {
    var list = (Array.isArray(keys) ? keys : [keys]).map(trim).filter(Boolean);
    if (!list.length) return true;
    await load();
    var next = normDoc(JSON.parse(JSON.stringify(doc || emptyDoc())));
    var map = next.d[kind] || {};
    var hit = false;
    list.forEach(function (k) { var nk = normKey(kind, k); if (map[nk]) { delete map[nk]; hit = true; } });
    if (!hit) return true;
    return await save(next);
  }

  /* 交互：问一个日期（YYYY-MM-DD）。优先用站点自己的日期弹窗，取不到再退回文本提示 */
  function askDate(desc, cur) {
    var def = dayOk(cur) || new Date().toISOString().slice(0, 10);
    if (typeof window.sbAskDate === "function") {
      return window.sbAskDate({
        title: "更正上传日期",
        desc: (desc || "") + "\n只改「数据统计」里显示的日期 / 周次 / 月份；上传人、榜单数据、图片本身都不动。",
        value: def,
        okText: "应用"
      });
    }
    if (typeof window.uiPrompt === "function") return window.uiPrompt((desc || "") + "（YYYY-MM-DD）", def);
    return Promise.resolve(null);
  }

  window.UO = {
    ensure: ensure,
    load: load,
    reload: function () { docAt = 0; return load(true); },
    whoami: whoami,
    isSuper: isSuper,
    canManage: canManage,
    canManageList: canManageList,
    label: label,
    hint: hint,
    claim: claim,
    adopt: adopt,
    forget: forget,
    dateOf: dateOf,
    dateInfo: dateInfo,
    setDate: setDate,
    clearDate: clearDate,
    forgetDates: forgetDates,
    normKey: normKey,
    askDate: askDate,
    _state: function () { return { doc: doc, at: docAt, key: KEY, ls: LS, uid: meUid, name: meName }; },
  };
})();
