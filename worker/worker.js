/* ============================================================
 * Cloudflare Worker —— TREND BANK 的"守门员"
 *
 * 职责：
 *   1) GET   /images/{category}/{file}  访客看图（必须携带 Supabase 登录令牌）
 *   2) POST  /upload                    管理员上传图片（令牌 + admin 角色）
 *   3) DELETE /images/{category}/{file} 管理员删除图片（令牌 + admin 角色）
 *
 * 部署方式（详见 README）：
 *   - R2 桶名与 Worker Binding 名都叫 IMAGES（可自行修改）
 *   - 环境变量：SUPABASE_URL（例如 https://xxxx.supabase.co）
 *   - 环境变量：SUPABASE_ANON_KEY（你的 anon public key）
 * ============================================================ */

// Supabase 用户查询：通过令牌换 user id（带短期缓存，避免每张图片请求都重复鉴权）
// 同一令牌 5 分钟内只校验一次，大幅减少一页多图时的鉴权往返
const _uidCache = new Map();
// 图片读取限流计数器：ip -> { count, resetAt }（内存级，零成本，防批量抓取）
const _imgHits = new Map();
async function getUserId(token, env) {
  if (!token) return null;
  const now = Date.now();
  const hit = _uidCache.get(token);
  if (hit && (now - hit.at) < 5 * 60 * 1000) return hit.id;
  const res = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
    headers: { Authorization: "Bearer " + token, apikey: env.SUPABASE_ANON_KEY },
  });
  let id = null;
  if (res.ok) {
    const user = await res.json();
    id = user?.id || null;
  }
  // 只缓存「成功解析出用户」的结果。
  // 鉴权失败往往是一次性的（访问令牌刚过期、瞬时网络抖动），若把失败也缓存 5 分钟，
  // 该令牌后续所有图片请求都会被判未登录，表现为整页图片/图片清单打不开。
  if (id) _uidCache.set(token, { id, at: now });
  else _uidCache.delete(token);
  return id;
}

/* 20261115G · 守门员读权限数据一律「服务端密钥优先，用户令牌兜底」
   ------------------------------------------------------------
   上一版的病根：守门员用「管理员自己的令牌」去读 profiles / site_settings / zone_permissions。
   这三张表的行级策略（RLS）看一眼就把行过滤掉了 —— 返回 200 + 空数组，看上去「这个人什么都没有」，
   于是明明超管在后台勾好了，管理员一点上传还是 403。
   守门员本身就是在做鉴权，读这几张表不该被它们自己的行级策略左右：
   先用服务端密钥读（一定读得到），读不到（没配密钥 / 网络异常）再用用户令牌兜底。 */
async function restRows(env, token, pathAndQuery) {
  const tries = [];
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    tries.push({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY });
  }
  if (token) {
    tries.push({ apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token });
  }
  let first = null;
  for (const h of tries) {
    try {
      const res = await fetch(env.SUPABASE_URL + "/rest/v1/" + pathAndQuery, { headers: h });
      if (!res.ok) { if (!first) first = { rows: null, status: res.status }; continue; }
      const rows = await res.json().catch(() => null);
      if (Array.isArray(rows)) return rows;
      if (!first) first = { rows: null, status: res.status };
    } catch (e) { /* 换下一种方式 */ }
  }
  return first && first.rows !== undefined ? first.rows : null;
}

// 查询某用户在 profiles 表中的角色
async function getRole(userId, token, env) {
  const rows = await restRows(env, token, `profiles?user_id=eq.${encodeURIComponent(userId)}&select=role`);
  return rows && rows.length ? rows[0].role : null;
}

// 管理员判定：admin 与 super_admin 均具备管理员权限（超管拥有全部权限）
// 归一化：去首尾空格 + 转小写，避免角色值含空格/大小写差异导致误判
function isAdminRole(role) {
  const r = String(role || "").trim().toLowerCase();
  return r === "admin" || r === "super_admin";
}

// 超管判定：仅超级管理员（营销日历等超管专属能力）
function isSuperRole(role) {
  const r = String(role || "").trim().toLowerCase();
  return r === "super_admin";
}

// 查询某用户在 profiles 表中的专区白名单（manage_zones 数组）
// 20261115G：改用服务端密钥优先（见 restRows），不再被 profiles 的行级策略过滤成空数组
async function getManageZones(userId, token, env) {
  try {
    const rows = await restRows(env, token, `profiles?user_id=eq.${encodeURIComponent(userId)}&select=manage_zones`);
    const z = rows && rows.length ? rows[0].manage_zones : null;
    return Array.isArray(z) ? z.map(x => String(x || "").trim()).filter(Boolean) : [];
  } catch (e) { return []; }
}
/* ============================================================
 * 20261115G · 上传/改图的权限判定（守门员唯一口径）
 * ------------------------------------------------------------
 * 上一版有三处会被判成 403，而它们都不是真的没权限：
 *   ① 前台有两条上传路径压根没把「专区」传给守门员，守门员只能按「视觉专区」校验；
 *      S / P / T 专区只授权了渠道专区的管理员于是被判「未授权该专区」。
 *   ② 守门员用管理员自己的令牌去读 profiles / site_settings / zone_permissions，
 *      被行级策略过滤成空数组 → 看起来「这个人什么授权都没有」。
 *   ③ 类目名一边是标准名、一边是平台全路径（"服装、鞋靴… ，男士卫衣"），
 *      字符串不等就判无权，明明授权的是同一个类目。
 * 现在改成：专区缺省按「该账号实际拥有的专区」自动判定；权限数据用服务端密钥读；
 * 类目名按「整串 + 逐段」双向归一后比较；两处授权（字典/表）合并，任一处允许即通过。
 * ============================================================ */

// 类目名归一：整串 + 平台全路径逐段，忽略空白/大小写/全角分隔符
function catKeys(s) {
  const raw = String(s == null ? "" : s).trim().toLowerCase();
  if (!raw) return [];
  const norm = (x) => x.replace(/\s+/g, "");
  const out = [];
  const add = (x) => { const t = norm(x); if (t && out.indexOf(t) === -1) out.push(t); };
  add(raw);
  raw.split(/[，,>＞／\/|、;；]+/).forEach(add);
  return out;
}
function catMatch(a, b) {
  const A = catKeys(a), B = catKeys(b);
  for (const x of A) {
    for (const y of B) {
      if (x === y) return true;
      /* 授权用的是标准短名（卫衣），表格给的是平台全路径（…，男士卫衣）：
         逐段之后短名就落在某段的末尾（或反过来），也要算同一类目。
         只做「首尾相接」的包含，且双方至少 2 个字，避免「裤」这类单字把一堆类目都放进来。 */
      if (x.length >= 2 && y.endsWith(x)) return true;
      if (y.length >= 2 && x.endsWith(y)) return true;
    }
  }
  return false;
}

// 渠道专区与视觉专区的历史兼容通道（有些管理员的白名单里只有 visual，却一直在传 S/P/T 的图）
const CHANNEL_ZONES = ["pinterest", "shein", "tiktok", "compare"];

// 某账号的权限快照：后台白名单 ∪ 字典里配过类目的专区
async function accessSnapshot(userId, token, env) {
  const mz = await getManageZones(userId, token, env);
  const dict = (await getPermDict(userId, token, env)) || {};
  const dictZones = Object.keys(dict).filter(k => Array.isArray(dict[k]) && dict[k].length);
  const allowed = mz.slice();
  dictZones.forEach(k => { if (allowed.indexOf(k) === -1) allowed.push(k); });
  return { manageZones: mz, dict, dictZones, allowed };
}

// 某用户某专区的类目授权（字典 ∪ 授权表，两处任一为准）
async function getZoneCats(userId, token, env, zone, dict) {
  const out = [];
  const push = (arr) => (arr || []).forEach(c => {
    const s = String(c == null ? "" : c).trim();
    if (s && !out.some(x => catMatch(x, s))) out.push(s);
  });
  const d = dict || (await getPermDict(userId, token, env)) || {};
  if (Array.isArray(d[zone])) push(d[zone]);
  try {
    const rows = await restRows(env, token,
      `zone_permissions?user_id=eq.${encodeURIComponent(userId)}&zone=eq.${encodeURIComponent(zone)}&select=category`);
    push((rows || []).map(r => r.category));
  } catch (e) { /* 读不到表就用字典那份 */ }
  return out;
}

// 专区授权判定：超管放行；未配置白名单默认放行；已配置按白名单（含视觉↔渠道兼容）
async function canManageZone(userId, role, token, env, zone) {
  if (isSuperRole(role)) return true;
  if (!isAdminRole(role)) return false;
  const snap = await accessSnapshot(userId, token, env);
  if (!snap.allowed.length) return true;            // 完全没配置：按全局放行（兼容）
  const z = String(zone || "").trim();
  if (!z || z === "auto") return true;              // 未指定专区：由调用方按类目再判
  if (snap.allowed.indexOf(z) !== -1) return true;
  if (CHANNEL_ZONES.indexOf(z) !== -1 && snap.allowed.indexOf("visual") !== -1) return true;
  return false;
}

/* 上传/改图的核心判定：返回 { ok, code, reason, allowed, cats }
   code：super / role / zone / category / ok / no-config */
async function checkUploadAccess(userId, role, token, env, zone, category) {
  if (isSuperRole(role)) return { ok: true, code: "super" };
  if (!isAdminRole(role)) {
    return { ok: false, code: "role", reason: "当前账号的角色不是管理员（" + String(role || "空") + "）" };
  }
  const snap = await accessSnapshot(userId, token, env);
  const noZoneCfg = !snap.allowed.length;
  const z = String(zone || "").trim();
  const auto = !z || z === "auto";

  if (!auto) {
    let zoneOk = noZoneCfg || snap.allowed.indexOf(z) !== -1;
    if (!zoneOk && CHANNEL_ZONES.indexOf(z) !== -1 && snap.allowed.indexOf("visual") !== -1) zoneOk = true;
    if (!zoneOk) {
      return {
        ok: false, code: "zone",
        reason: "该账号未开通「" + z + "」专区（已开通：" + (snap.allowed.join("、") || "无") + "）",
        allowed: snap.allowed,
      };
    }
  }

  const cat = String(category || "").trim();
  if (!cat) return { ok: true, code: "ok", reason: "只按专区校验，未指定类目", allowed: snap.allowed };

  /* 候选专区：指定了就看那一个（不够再回看全部已开通的），没指定就看全部已开通的 */
  const pool = auto ? snap.allowed.slice() : [z];
  if (!pool.length) return { ok: true, code: "no-config", reason: "该账号没有配置任何专区/类目限制，按放行处理" };

  let anyCfg = false, matchedIn = "";
  const detail = [];
  for (const cz of pool.concat(snap.allowed.filter(x => pool.indexOf(x) === -1))) {
    const cats = await getZoneCats(userId, token, env, cz, snap.dict);
    if (cats.length) anyCfg = true;
    detail.push(cz + ":" + cats.length + "类目");
    if (!matchedIn && cats.some(c => catMatch(c, cat))) matchedIn = cz;
  }
  if (matchedIn) return { ok: true, code: "ok", matchedIn, allowed: snap.allowed, detail };
  if (!anyCfg) {
    return { ok: true, code: "no-config", reason: "该账号没有配置类目授权，按放行处理", allowed: snap.allowed, detail };
  }
  return {
    ok: false, code: "category",
    reason: "该账号在「" + z + "」下没有被授权类目「" + cat + "」（已授权类目见授权管理）",
    allowed: snap.allowed, detail,
  };
}

// 类目授权判定（保留旧函数名，内部走统一口径）
async function canManageZoneCat(userId, role, token, env, zone, category) {
  const r = await checkUploadAccess(userId, role, token, env, zone, category);
  return !!r.ok;
}

// 读取「站点设置」里的类目授权暂存字典：{ zone: [category...] }
// 20261115G：改用服务端密钥优先，避免被 site_settings 的行级策略过滤成 null
async function getPermDict(userId, token, env) {
  try {
    const rows = await restRows(env, token, "site_settings?id=eq.1&select=frontend_dims");
    if (!rows) return null;
    const dims = (rows[0] && rows[0].frontend_dims) || {};
    const m = dims.perm_zones || {};
    const u = m[userId];
    return (u && typeof u === "object") ? u : null;
  } catch (e) { return null; }
}

// 通过 Auth Admin API 创建用户（邮箱 + 密码），仅超管可触发，需 service_role
async function adminCreateAuthUser(env, email, password) {
  const res = await fetch(env.SUPABASE_URL + "/auth/v1/admin/users", {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.msg || j.message || "创建用户失败");
  return j;
}
// 通过 Auth Admin API 删除用户（级联删除 profiles 等，需服务端 RLS/RU 权限配合），仅超管
async function adminDeleteAuthUser(env, uid) {
  const res = await fetch(env.SUPABASE_URL + "/auth/v1/admin/users/" + encodeURIComponent(uid), {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.msg || j.message || "删除用户失败");
  }
}

// 图片服务版本号（前端 /ver 会读它，用于确认这次有没有把本文件重新部署）
const WORKER_BUILD = "20261116B";

// CORS 头
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const method = request.method;
  // 关键修复：浏览器请求时中文类目会被 URL 编码，这里必须还原成本地字符再查 R2（否则中文类目图片 404）
  /* 20261115G · 致命顺序缺陷修复：
     上一版把 /ver 与 /admin/add-image 两段处理写在了「方法/路径还没解析」的位置，
     里面引用的 method 在那一刻尚处于暂时性死区（尚未声明），一进函数就抛异常，
     图片服务的所有请求（含正常上传、看图）全部变成 500。
     规则：先解析 method/path，再挂路由。下面任何新增路由都必须在这两行之后。 */
  let path;
  try {
    path = decodeURIComponent(url.pathname).replace(/^\//, "");
  } catch (e) {
    path = url.pathname.replace(/^\//, "");
  }

  // 预检
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  /* ---------- GET /ver：图片服务自己的版本号 ----------
     前端用它判断「这次到底有没有把图片服务重新部署」。案板上的坑：
     站点推 GitHub 只部署前台静态页，图片服务要单独部署；
     没部署时前台已经是新版、图片服务还是旧逻辑，排查会一直在原地打转。
     注意：本段必须在 method / path 解析之后（20261115G 修复过这里的位置）。 */
  if (method === "GET" && (path === "ver" || path === "version")) {
    return json({ ok: true, build: WORKER_BUILD, dictAuth: true }, 200, CORS);
  }
  // 根路径也给一份自述：浏览器直接打开域名就能看到版本，不必记具体路径
  if (method === "GET" && path === "") {
    return json({
      ok: true,
      service: "TREND BANK 图片服务",
      build: WORKER_BUILD,
      dictAuth: true,
      routes: ["/ver", "/diag", "/diag/img", "/geo", "/uploads/{zone}/{category}/{file}", "/upload", "/admin/add-image"],
    }, 200, CORS);
  }

  // 登录令牌：优先 Authorization，其次 query 的 token（<img> 无法带头）
  const auth = request.headers.get("Authorization") || "";
  let token = auth.startsWith("Bearer ") ? auth.slice(7) : (url.searchParams.get("token") || "");
  const userId = await getUserId(token, env);

  /* ---------- GET /diag：传图自检 ----------
     作用：把「这个人到底能不能传这张图」一次说清 —— 角色、后台白名单、站点设置里的类目授权、
     授权表里的行数，以及守门员最终的判定和原因。
     用途：管理员说「传图 403」时，超管在后台点一下就能看到是哪一环缺，不用再猜。 */
  if (method === "GET" && path === "diag") {
    if (!userId) return json({ error: "未登录", code: "auth" }, 401, CORS);
    const myRole = await getRole(userId, token, env);
    const askUid = String(url.searchParams.get("uid") || "").trim();
    const target = askUid && askUid !== userId ? askUid : userId;
    if (target !== userId && !isSuperRole(myRole)) {
      return json({ error: "只有超级管理员可以检查别人的授权", code: "role" }, 403, CORS);
    }
    const targetRole = target === userId ? myRole : (await getRole(target, token, env));
    const zone = String(url.searchParams.get("zone") || "").trim();
    const category = String(url.searchParams.get("category") || "").trim();
    const snap = await accessSnapshot(target, token, env);
    const dictCount = {};
    Object.keys(snap.dict || {}).forEach(k => { dictCount[k] = Array.isArray(snap.dict[k]) ? snap.dict[k].length : 0; });
    const tableCount = {};
    try {
      const rows = await restRows(env, token, `zone_permissions?user_id=eq.${encodeURIComponent(target)}&select=zone`);
      (rows || []).forEach(r => {
        const k = String(r.zone || "").trim() || "(空)";
        tableCount[k] = (tableCount[k] || 0) + 1;
      });
    } catch (e) { /* 读不到表不影响结论 */ }
    const verdict = await checkUploadAccess(target, targetRole, token, env, zone, category);
    return json({
      ok: true, build: WORKER_BUILD,
      checkedUser: target, isSelf: target === userId,
      role: targetRole,
      isAdmin: isAdminRole(targetRole),
      manageZones: snap.manageZones,
      dictZones: dictCount,
      tableZones: tableCount,
      zone: zone || "auto",
      category,
      verdict: {
        ok: !!verdict.ok, code: verdict.code || "",
        reason: verdict.reason || "",
        matchedIn: verdict.matchedIn || "",
        allowed: verdict.allowed || [],
        detail: verdict.detail || [],
      },
    }, 200, CORS);
  }

  /* ---------- POST /admin/add-image：登记一条图片清单（服务端写，绕开行级策略）----------
     故障背景：图片已经存进对象存储，但浏览器直接往数据库插这条记录被拒（400/401），
     结果「后台看不到这张图」。图片服务用服务端密钥写入，不受浏览器会话的写入策略影响。
     鉴权与直接上传一致：必须是管理员，且对该专区、该类目有权限。 */
  if (method === "POST" && path === "admin/add-image") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const roleA = await getRole(userId, token, env);
    if (!isAdminRole(roleA)) return json({ error: "无管理员权限", code: "role" }, 403, CORS);
    const bodyA = await request.json().catch(() => ({}));
    const categoryA = String(bodyA.category || "").trim();
    const pathA = String(bodyA.path || "").trim();
    /* 20261115G：专区缺省不再硬按 visual —— 按该账号实际拥有的专区自动判定 */
    const zoneA = String(bodyA.zone || "").trim();
    if (!categoryA || !pathA) return json({ error: "缺少类目或路径" }, 400, CORS);
    const accA = await checkUploadAccess(userId, roleA, token, env, zoneA, categoryA);
    if (!accA.ok) {
      return json({
        error: accA.reason || "没有权限登记该图片",
        code: accA.code || "deny",
        zone: zoneA || "auto",
        category: categoryA,
        allowed: accA.allowed || [],
        detail: accA.detail || [],
      }, 403, CORS);
    }
    const rowA = {
      category: categoryA,
      name: String(bodyA.name || pathA.split("/").pop() || "").trim(),
      path: pathA,
      url: bodyA.url || null,
      uploaded_by: userId,
    };
    const insA = await fetch(`${env.SUPABASE_URL}/rest/v1/images`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rowA),
    });
    if (!insA.ok) {
      const tA = await insA.text().catch(() => "");
      return json({ error: "写入清单失败：" + (tA || insA.status) }, 500, CORS);
    }
    return json({ ok: true }, 200, CORS);
  }

  /* ---------- GET /diag/img?path=xxx：单张图「为什么打不开」的现场报告 ----------
     返回：这条 path 试过哪些 key、桶里到底有没有、同目录现存哪些文件、有没有同名文件。
     用途：界面上一张图 404 时，一眼看清是「记录地址写错了」还是「文件真的不在」，
     不用再靠猜、也不用把整桶清单拉下来找。 */
  if (method === "GET" && path === "diag/img") {
    if (!userId) {
      return json({
        error: token ? "登录令牌已失效，请退出重新登录" : "请求没有带上登录令牌",
        code: token ? "token-invalid" : "token-missing",
        build: WORKER_BUILD,
      }, 401, CORS);
    }
    const p = String(url.searchParams.get("path") || "").replace(/^\/+/, "").trim();
    if (!p) return json({ error: "缺少 path" }, 400, CORS);
    const cands = [p];
    if (p.indexOf("images/") !== 0) cands.push("images/" + p);
    const tried = [];
    let exists = false, hitKey = "";
    for (const k of cands) {
      let has = false;
      try { has = !!(await env.IMAGES.head(k)); } catch (e) { has = false; }
      tried.push({ key: k, exists: has });
      if (has && !hitKey) { exists = true; hitKey = k; }
    }
    const name = _baseOf(p), stem = _stemOf(p);
    const dir = _dirOf(p);
    let nearby = [];
    try {
      const page = await env.IMAGES.list({ prefix: dir ? dir + "/" : "images/", limit: 200 });
      nearby = (page.objects || []).map(function (o) { return o.key; }).slice(0, 20);
    } catch (e) { /* 列不出就不给 */ }
    let sameStem = [];
    if (!exists) {
      let cursor, pages = 0;
      try {
        do {
          const page = await env.IMAGES.list({ prefix: "images/", cursor, limit: 1000 });
          for (const o of (page.objects || [])) {
            if (_matchKey(o.key, name, stem) && sameStem.length < 10) sameStem.push(o.key);
          }
          cursor = page.truncated ? page.cursor : undefined;
          pages++;
        } while (cursor && pages < 30 && sameStem.length < 10);
      } catch (e) { /* 扫桶失败就不给 */ }
    }
    return json({
      ok: true,
      build: WORKER_BUILD,
      path: p,
      exists: exists,
      resolved: hitKey || (sameStem[0] || ""),
      tried: tried,
      dir: dir,
      nearby: nearby,
      sameStem: sameStem,
    }, 200, CORS);
  }

  // ---------- 0. GET /geo：返回访问者的网络出口信息（国家 / 省州 / 城市 / IP）----------  // 供前台「数据看板」记录用户来源地区。只返回调用者自己的信息，不查库、不读他人数据。
  if (method === "GET" && path === "geo") {
    const cf = request.cf || {};
    return json({
      ip: request.headers.get("CF-Connecting-IP") || "",
      country: (cf.country || cf.countryCode || "").toString(),
      region: (cf.region || cf.regionCode || "").toString(),
      city: (cf.city || "").toString(),
    }, 200, CORS);
  }

// 读取前台公开浏览开关（site_settings.public_access），带 60 秒时间戳缓存避免每次查库
let _pubVal = false;
let _pubAt = 0;
async function isPublicAccess(env) {
  const now = Date.now();
  if (now - _pubAt < 60000) return _pubVal;
  try {
    const url = env.SUPABASE_URL + "/rest/v1/site_settings?select=public_access&id=eq.1";
    const res = await fetch(url, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
    });
    const arr = await res.json();
    _pubVal = !!(Array.isArray(arr) && arr[0] && arr[0].public_access);
  } catch (e) {
    _pubVal = false;
  }
  _pubAt = now;
  return _pubVal;
}

// 外部只读取图开关（site_secrets）：独立于「前台公开浏览」，只影响匿名读图，不影响写操作
// 密钥存独立表且 RLS 全禁，只有服务端能读，前端与访客都拿不到
let _arVal = null;
let _arAt = 0;
async function getAgentRead(env, force) {
  const now = Date.now();
  if (!force && _arVal && now - _arAt < 60000) return _arVal;
  try {
    const res = await fetch(
      env.SUPABASE_URL + "/rest/v1/site_secrets?select=agent_read,agent_read_key&id=eq.1",
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    const arr = await res.json();
    const r = Array.isArray(arr) && arr[0];
    _arVal = { on: !!(r && r.agent_read), key: (r && r.agent_read_key) || "" };
  } catch (e) {
    _arVal = { on: false, key: "" };
  }
  _arAt = now;
  return _arVal;
}

// 生成只读密钥（32 位十六进制）
function genReadKey() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
}

  /* 20261115G：老记录里 path 可能缺 "images/" 前缀（早期上传只存了「类目/文件.jpg」）。
     缺前缀时不会命中 images/ 路由，会落到最后的「未知请求」，表现同样是「图不显示」。
     这里按「扩展名像图片」一并纳入读图路由，并在取对象时补一次前缀。 */
  /* 20261116B · 缩略图的存储键：thumbs/<原路径去扩展名>.webp
     放在 thumbs/ 前缀下，不会被「图片池清单」（只列 images/）当成原图统计。 */
  function thumbKeyOf(p) {
    const s = String(p || "").replace(/^\/+/, "");
    if (!s || s.indexOf("thumbs/") === 0) return "";
    const i = s.lastIndexOf("/");
    const dir = i < 0 ? "" : s.slice(0, i + 1);
    let name = i < 0 ? s : s.slice(i + 1);
    name = name.replace(/\.[a-z0-9]+$/i, "");
    if (!name) return "";
    return "thumbs/" + dir + name + ".webp";
  }

  function isImgReadPath(p) {
    if (!p) return false;
    if (p.indexOf("images/") === 0) return true;
    if (/^(admin|trend|trends|trend-covers|diag|ver|geo|agent-read|upload)/.test(p)) return false;
    return /\.(jpe?g|png|webp|gif|bmp|avif|svg)$/i.test(p);
  }

  /* 20261115H · 按「同名文件」把丢失的地址找回来
     ------------------------------------------------------------
     记录里的 path 和桶里的 key 只要差一点点，以前一律 404，界面就是一块灰底：
       · 压缩池把 .jpg 转成 .webp 后换了扩展名
       · 类目名里的「/」被规范化（打底/压缩 → 打底压缩）导致目录层级变了
       · 文件名大小写、前后空白、多一层少一层目录
     这里在取不到对象时按「文件名(忽略扩展名、忽略大小写)」在桶里找一遍：
     先同目录，再 images/ 下，最后整桶（有界）。命中一次就缓存，同 isolate 内不再扫桶。 */
  const _rescueHit = new Map();
  const _rescueMiss = new Map();
  function _dirOf(p) { const i = String(p).lastIndexOf("/"); return i < 0 ? "" : String(p).slice(0, i); }
  function _baseOf(p) { const s = String(p); return s.slice(s.lastIndexOf("/") + 1).toLowerCase(); }
  function _stemOf(p) { const b = _baseOf(p); const d = b.lastIndexOf("."); return d > 0 ? b.slice(0, d) : b; }
  function _matchKey(k, name, stem) {
    const b = String(k || "").slice(String(k).lastIndexOf("/") + 1).toLowerCase();
    if (b === name) return true;
    const d = b.lastIndexOf(".");
    return (d > 0 ? b.slice(0, d) : b) === stem;
  }
  async function _scan(prefix, name, stem, maxPages) {
    let cursor, pages = 0;
    try {
      do {
        const page = await env.IMAGES.list({ prefix: prefix || "", cursor, limit: 1000 });
        for (const o of (page.objects || [])) { if (_matchKey(o.key, name, stem)) return o.key; }
        cursor = page.truncated ? page.cursor : undefined;
        pages++;
      } while (cursor && pages < (maxPages || 20));
    } catch (e) { /* 扫桶失败就当没找到 */ }
    return "";
  }
  async function resolveKey(decodedPath, rawPath) {
    const cands = [decodedPath];
    if (rawPath && rawPath !== decodedPath) cands.push(rawPath);
    if (String(decodedPath).indexOf("images/") !== 0) cands.push("images/" + decodedPath);
    for (const k of cands) { try { if (await env.IMAGES.head(k)) return k; } catch (e) {} }
    if (String(decodedPath).indexOf("..") >= 0) return "";
    if (_rescueHit.has(decodedPath)) return _rescueHit.get(decodedPath);
    const last = _rescueMiss.get(decodedPath);
    if (last && Date.now() - last < 60000) return "";
    const name = _baseOf(decodedPath);
    const stem = _stemOf(decodedPath);
    let hit = "";
    if (name) {
      const dir = _dirOf(decodedPath);
      if (dir) hit = await _scan(dir + "/", name, stem, 5);
      if (!hit) hit = await _scan("images/", name, stem, 30);
      if (!hit) hit = await _scan("", name, stem, 30);
    }
    if (hit) _rescueHit.set(decodedPath, hit);
    else {
      _rescueMiss.set(decodedPath, Date.now());
      if (_rescueMiss.size > 500) _rescueMiss.clear();
    }
    return hit;
  }

  // 兼容新旧存储：新图明文存中文路径，旧图曾以编码形式存储，先取解码后路径，取不到再取原始编码路径
  async function getObject(decodedPath, rawPath) {
    let obj = await env.IMAGES.get(decodedPath);
    if (!obj && rawPath && rawPath !== decodedPath) obj = await env.IMAGES.get(rawPath);
    // 缺 images/ 前缀的老记录：补前缀再试一次
    if (!obj && decodedPath.indexOf("images/") !== 0) obj = await env.IMAGES.get("images/" + decodedPath);
    // 20261115H：仍取不到 → 按同名文件找（扩展名/目录/大小写不一致都能救回来）
    if (!obj) {
      const k = await resolveKey(decodedPath, rawPath);
      if (k && k !== decodedPath && k !== rawPath) {
        try { obj = await env.IMAGES.get(k); } catch (e) {}
      }
    }
    return obj;
  }

  // ---------- 图片读取限流 + 异常审计（防批量、事后兜底）----------
  // 每 IP 每分钟图片请求上限，超过则 429 并记录审计日志（内存级，零成本）
  if (method === "GET" && isImgReadPath(path)) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const now = Date.now();
    const WLIM = 20000;    // 每分钟上限（每 IP）。原 2000 太低：一屏几十张图 + 多标签翻页很容易撞上，
                           // 撞上后整屏图变成灰底，表现就是「有的图不显示」「刷新一下又好了」。
    const WWIN = 60000;    // 窗口：1 分钟
    let h = _imgHits.get(ip);
    if (!h || now > h.resetAt) { h = { count: 0, resetAt: now + WWIN }; _imgHits.set(ip, h); }
    h.count++;
    if (h.count > WLIM) {
      console.log("[IMG-AUDIT] rate-limit ip=" + ip + " count=" + h.count + " path=" + path);
      const hd = new Headers(CORS);
      hd.set("Retry-After", "15");
      return new Response(JSON.stringify({ error: "请求过于频繁", code: "rate" }), {
        status: 429, headers: hd,
      });
    }
    if (h.count === Math.floor(WLIM * 0.9)) {
      console.log("[IMG-AUDIT] near-limit ip=" + ip + " count=" + h.count);
    }
  }

  // ---------- 1. GET 看图：登录即可；公开浏览模式或外部只读密钥放行 ----------
  if (method === "GET" && isImgReadPath(path)) {
    if (!userId) {
      const pub = await isPublicAccess(env);
      if (!pub) {
        // 外部只读取图：开关开着且密钥匹配才放行，否则与未登录同等对待
        const ar = await getAgentRead(env);
        const gotKey = url.searchParams.get("read_key") || "";
        if (!(ar.on && ar.key && gotKey === ar.key)) {
          return json({ error: "未登录" }, 401, CORS);
        }
      }
    }
    const rawPath = url.pathname.replace(/^\//, "");
    let object = null;
    let isThumb = false;
    /* 20261116B · 缩略图：卡片带 ?w=340 时优先取 thumbs/ 下的缩略图（约 20KB）。
       取不到就照旧返回原图 —— 不额外多一次请求，也不会因为没缩略图而变成灰底。 */
    if (url.searchParams.get("w")) {
      const tk = thumbKeyOf(path);
      if (tk) {
        try { object = await env.IMAGES.get(tk); } catch (e) { object = null; }
        if (object) isThumb = true;
      }
    }
    if (!object) object = await getObject(path, rawPath);
    if (!object) return json({ error: "文件不存在" }, 404, CORS);
    const headers = new Headers(CORS);
    headers.set("Content-Type", isThumb ? "image/webp" : (object.httpMetadata?.contentType || "application/octet-stream"));
    // 防下载：禁止嗅探、禁止作为附件下载、禁止被外站引用，且不暴露令牌页面
    // 20261116B：缓存从 1 小时提到 1 天（缩略图永久）。文件名带时间戳、内容不会变，
    //          第二次打开这些页面直接读本地缓存，不再每张都回源 —— 这是「又慢又要重下」的主因之一。
    headers.set("Cache-Control", isThumb ? "public, max-age=31536000, immutable" : "public, max-age=86400");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    // 不设 Content-Disposition: attachment，避免图片变成"下载"。inline 仅用于提示
    headers.set("Content-Disposition", "inline");
    return new Response(object.body, { headers });
  }

  // ---------- 1.5 外部只读取图设置（仅超级管理员）：开关 + 密钥管理 ----------
  // 界面入口在「超管权限 → 前台访问设置」，接口同样只放超管，避免普通管理员绕过界面直接调用
  if (path === "agent-read" && (method === "GET" || method === "POST")) {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isSuperRole(role)) return json({ error: "仅超级管理员可操作" }, 403, CORS);
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "服务端未配置读写权限" }, 500, CORS);

    const base = env.SUPABASE_URL + "/rest/v1/site_secrets";
    const srv = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    };

    // 读取当前设置（强制刷新，拿最新密钥）
    if (method === "GET") {
      const cur = await getAgentRead(env, true);
      return json({ ok: true, on: cur.on, key: cur.key }, 200, CORS);
    }

    // 修改：开关、重置密钥
    const body = await request.json().catch(function () { return {}; });
    const cur = await getAgentRead(env, true);
    const patch = { updated_at: new Date().toISOString() };
    if (typeof body.on === "boolean") patch.agent_read = body.on;
    if (body.reset === true) patch.agent_read_key = genReadKey();

    // 开启时若还没有密钥，自动补一个
    const willBeOn = typeof body.on === "boolean" ? body.on : cur.on;
    const willHaveKey = patch.agent_read_key || cur.key;
    if (willBeOn && !willHaveKey) patch.agent_read_key = genReadKey();

    const res2 = await fetch(base + "?id=eq.1", {
      method: "PATCH",
      headers: Object.assign({ Prefer: "return=representation" }, srv),
      body: JSON.stringify(patch),
    });
    if (!res2.ok) return json({ error: "保存失败" }, 502, CORS);
    const arr2 = await res2.json().catch(function () { return []; });
    const r2 = Array.isArray(arr2) && arr2[0];

    // 清掉 60 秒缓存，开关切换后下一次读图立刻按新状态判定
    _arVal = null;
    _arAt = 0;

    return json({
      ok: true,
      on: !!(r2 && r2.agent_read),
      key: (r2 && r2.agent_read_key) || "",
    }, 200, CORS);
  }

  // ---------- 2. POST 上传：需要管理员 ----------
  if (method === "POST" && path === "upload") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isAdminRole(role)) {
      return json({ error: "无管理员权限", reason: "当前账号的角色不是管理员", code: "role" }, 403, CORS);
    }
    const form = await request.formData();
    /* 20261115G：这个端点同时服务「视觉专区」和「渠道专区（S/P/T/渠道对比）」。
       以前前端不带 zone 时一律按 visual 校验 —— 只被授权了 S 专区的管理员，
       上传被按视觉专区判定，必然是 403。
       现在：前端带了 zone 就按那个专区判；没带就按「该账号实际拥有的专区」自动判定，
       不再替用户猜一个最容易被拒的默认值。 */
    const zone = String(form.get("zone") || "").trim();
    const file = form.get("file");
    const category = (form.get("category") || "").trim();
    if (!file || !category) return json({ error: "缺少文件或分类" }, 400, CORS);
    const acc = await checkUploadAccess(userId, role, token, env, zone, category);
    if (!acc.ok) {
      return json({
        error: acc.reason || "没有权限上传",
        code: acc.code || "deny",
        zone: zone || "auto",
        category: category,
        allowed: acc.allowed || [],
        detail: acc.detail || [],
      }, 403, CORS);
    }

    // 唯一文件名，防覆盖
    const cleanName = file.name.replace(/[^\w.\-]/g, "_");
    const stamp = Date.now() + "_" + Math.floor(Math.random() * 1e4);
    // 中文类目统一明文存储（与取图时 decodeURIComponent 还原后的中文路径完全一致），避免 404
    const key = `images/${category}/${stamp}_${cleanName}`;

    await env.IMAGES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    /* 20261116B · 同一次上传顺带存一张卡片用的缩略图（前端生成，约 20KB）。
       存不进去不影响上传本身 —— 前台取不到缩略图会自动回退原图。 */
    try {
      const thumb = form.get("thumb");
      if (thumb && typeof thumb !== "string" && thumb.size > 0) {
        await env.IMAGES.put(thumbKeyOf(key), thumb.stream(), {
          httpMetadata: { contentType: "image/webp" },
        });
      }
    } catch (e) { /* 缩略图失败不阻断 */ }
    return json({ ok: true, path: key }, 200, CORS);
  }

  // ---------- 3. DELETE 删除：需要管理员 ----------
  if (method === "DELETE" && path.startsWith("images/")) {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isAdminRole(role)) return json({ error: "无管理员权限" }, 403, CORS);
    const rawPath = url.pathname.replace(/^\//, "");
    // 先删解码后路径，若不存在再删原始编码路径，兼容新旧存储
    await env.IMAGES.delete(path).catch(() => {});
    if (rawPath !== path) await env.IMAGES.delete(rawPath).catch(() => {});
    return json({ ok: true }, 200, CORS);
  }

  // ---------- 4. 趋势专区（趋势文件存 R2，由本 Worker 受控代理，不暴露直链） ----------

  // 4.1 POST /trend/upload 上传趋势文件（管理员）→ 返回 R2 path
  if (method === "POST" && path === "trend/upload") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isAdminRole(role)) return json({ error: "无管理员权限" }, 403, CORS);
    if (!(await canManageZone(userId, role, token, env, "trend"))) return json({ error: "未授权该专区" }, 403, CORS);

    const form = await request.formData();
    const file = form.get("file");
    if (!file) return json({ error: "缺少文件" }, 400, CORS);
    // 仅允许 pdf（可放宽为常见文档，但预览窗口为 pdf）
    const isPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name || "");
    if (!isPdf) return json({ error: "暂仅支持 PDF" }, 400, CORS);

    // 唯一文件名：英文/数字/下划线/点，避免中文 URL 编码问题
    const cleanName = (file.name || "trend.pdf").replace(/[^\w.\-]/g, "_");
    const stamp = Date.now() + "_" + Math.floor(Math.random() * 1e4);
    const key = "trends/" + stamp + "_" + cleanName;
    await env.IMAGES.put(key, file.stream(), {
      httpMetadata: { contentType: "application/pdf" },
    });

    // 可选封面图：存 trends_covers/ 目录，同样受控代理，不暴露直链
    let coverPath = "";
    const coverFile = form.get("cover");
    if (coverFile && coverFile.size > 0) {
      if (!/^image\//i.test(coverFile.type || "")) return json({ error: "封面仅支持图片" }, 400, CORS);
      const cName = (coverFile.name || "cover.jpg").replace(/[^\w.\-]/g, "_");
      coverPath = "trends_covers/" + stamp + "_" + cName;
      await env.IMAGES.put(coverPath, coverFile.stream(), {
        httpMetadata: { contentType: coverFile.type || "image/jpeg" },
      });
    }
    return json({ ok: true, path: key, cover: coverPath }, 200, CORS);
  }

  // 4.1b POST /trend/uploadCover 单独上传/替换趋势封面（管理员）→ 返回新 R2 cover 路径
  if (method === "POST" && path === "trend/uploadCover") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isAdminRole(role)) return json({ error: "无管理员权限" }, 403, CORS);
    if (!(await canManageZone(userId, role, token, env, "trend"))) return json({ error: "未授权该专区" }, 403, CORS);
    const form = await request.formData();
    const coverFile = form.get("cover");
    if (!coverFile || coverFile.size <= 0) return json({ error: "缺少封面" }, 400, CORS);
    if (!/^image\//i.test(coverFile.type || "")) return json({ error: "封面仅支持图片" }, 400, CORS);
    const cName = (coverFile.name || "cover.jpg").replace(/[^\w.\-]/g, "_");
    const stamp = Date.now() + "_" + Math.floor(Math.random() * 1e4);
    const coverPath = "trends_covers/" + stamp + "_" + cName;
    await env.IMAGES.put(coverPath, coverFile.stream(), {
      httpMetadata: { contentType: coverFile.type || "image/jpeg" },
    });
    return json({ ok: true, cover: coverPath }, 200, CORS);
  }

  // 4.2 GET /trend/preview?path=trends/xxx   受控预览：必须登录，返回 PDF 内联，防下载/防另存
  if (method === "GET" && path === "trend/preview") {
    // 趋势专区始终需登录可见（不受公开浏览开关影响）
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const p = url.searchParams.get("path") || "";
    if (!p.startsWith("trends/")) return json({ error: "参数错误" }, 400, CORS);
    const object = await env.IMAGES.get(p);
    if (!object) return json({ error: "文件不存在" }, 404, CORS);
    const headers = new Headers(CORS);
    headers.set("Content-Type", "application/pdf");
    // 内联打开，而非附件下载；明确禁止浏览器把它当可下载附件
    headers.set("Content-Disposition", "inline");
    // 防下载/防另存：禁止嗅探、禁止被外站直链引用、不缓存原始字节（避免留痕便于另存）
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    return new Response(object.body, { headers });
  }

  // 4.3 GET /trend/cover?path=trends_covers/xxx  受控封面图：必须登录，内联展示，防下载
  if (method === "GET" && path === "trend/cover") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const p = url.searchParams.get("path") || "";
    if (!p.startsWith("trends_covers/")) return json({ error: "参数错误" }, 400, CORS);
    const object = await env.IMAGES.get(p);
    if (!object) return json({ error: "文件不存在" }, 404, CORS);
    const headers = new Headers(CORS);
    headers.set("Content-Type", object.httpMetadata?.contentType || "image/jpeg");
    headers.set("Content-Disposition", "inline");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    return new Response(object.body, { headers });
  }

  // 4.4 DELETE /trend/delete?path=trends/xxx&cover=trends_covers/xxx  删除趋势文件（管理员）
  if (method === "DELETE" && path === "trend/delete") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isAdminRole(role)) return json({ error: "无管理员权限" }, 403, CORS);
    if (!(await canManageZone(userId, role, token, env, "trend"))) return json({ error: "未授权该专区" }, 403, CORS);
    const p = url.searchParams.get("path") || "";
    if (!p.startsWith("trends/")) return json({ error: "参数错误" }, 400, CORS);
    await env.IMAGES.delete(p).catch(() => {});
    const coverParam = url.searchParams.get("cover") || "";
    if (coverParam.startsWith("trends_covers/")) await env.IMAGES.delete(coverParam).catch(() => {});
    return json({ ok: true }, 200, CORS);
  }

  // ---------- 5. 公告专区（公告图片存 R2，受控代理，不暴露直链） ----------
  // 5.1 POST /notice/uploadimg 上传公告图片（管理员）→ 返回 notices/ 路径
  if (method === "POST" && path === "notice/uploadimg") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isAdminRole(role)) return json({ error: "无管理员权限" }, 403, CORS);
    if (!(await canManageZone(userId, role, token, env, "notice"))) return json({ error: "未授权该专区" }, 403, CORS);

    const form = await request.formData();
    const file = form.get("file");
    if (!file) return json({ error: "缺少图片" }, 400, CORS);
    if (!/^image\//i.test(file.type || "") && !/\.(jpe?g|png|webp)$/i.test(file.name || "")) {
      return json({ error: "仅支持图片" }, 400, CORS);
    }
    const cleanName = (file.name || "img").replace(/[^\w.\-]/g, "_");
    const stamp = Date.now() + "_" + Math.floor(Math.random() * 1e4);
    const key = "notices/" + stamp + "_" + cleanName;
    await env.IMAGES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "image/jpeg" },
    });
    return json({ ok: true, path: key }, 200, CORS);
  }

  // 5.2 GET /notice/img?path=notices/xxx  受控公告图片：必须登录，内联展示，防下载
  if (method === "GET" && path === "notice/img") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const p = url.searchParams.get("path") || "";
    if (!p.startsWith("notices/")) return json({ error: "参数错误" }, 400, CORS);
    const object = await env.IMAGES.get(p);
    if (!object) return json({ error: "文件不存在" }, 404, CORS);
    const headers = new Headers(CORS);
    headers.set("Content-Type", object.httpMetadata?.contentType || "image/jpeg");
    headers.set("Content-Disposition", "inline");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    return new Response(object.body, { headers });
  }

  // 5.3 POST /marketing/uploadimg 上传营销日历图片（管理员）→ 返回 marketing/ 路径
  if (method === "POST" && path === "marketing/uploadimg") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isSuperRole(role)) return json({ error: "仅超级管理员可操作" }, 403, CORS);

    const form = await request.formData();
    const file = form.get("file");
    if (!file) return json({ error: "缺少图片" }, 400, CORS);
    if (!/^image\//i.test(file.type || "") && !/\.(jpe?g|png|webp)$/i.test(file.name || "")) {
      return json({ error: "仅支持图片" }, 400, CORS);
    }
    const cleanName = (file.name || "img").replace(/[^\w.\-]/g, "_");
    const stamp = Date.now() + "_" + Math.floor(Math.random() * 1e4);
    const key = "marketing/" + stamp + "_" + cleanName;
    await env.IMAGES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "image/jpeg" },
    });
    return json({ ok: true, path: key }, 200, CORS);
  }

  // 5.4 GET /marketing/img?path=marketing/xxx  受控营销日历图片：必须登录，内联展示，防下载
  if (method === "GET" && path === "marketing/img") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const p = url.searchParams.get("path") || "";
    if (!p.startsWith("marketing/")) return json({ error: "参数错误" }, 400, CORS);
    const object = await env.IMAGES.get(p);
    if (!object) return json({ error: "文件不存在" }, 404, CORS);
    const headers = new Headers(CORS);
    headers.set("Content-Type", object.httpMetadata?.contentType || "image/jpeg");
    headers.set("Content-Disposition", "inline");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    return new Response(object.body, { headers });
  }

  // ---------- 6. 招品回品专区（招品图片存 R2，受控代理，不暴露直链） ----------
  // 6.1 POST /recruit/upload 上传招品图片（管理员）→ 返回 recruits/ 路径
  if (method === "POST" && path === "recruit/upload") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isAdminRole(role)) return json({ error: "无管理员权限" }, 403, CORS);
    if (!(await canManageZone(userId, role, token, env, "recruit"))) return json({ error: "未授权该专区" }, 403, CORS);

    const form = await request.formData();
    const file = form.get("file");
    if (!file) return json({ error: "缺少图片" }, 400, CORS);
    if (!/^image\//i.test(file.type || "") && !/\.(jpe?g|png|webp)$/i.test(file.name || "")) {
      return json({ error: "仅支持图片" }, 400, CORS);
    }
    const cleanName = (file.name || "img").replace(/[^\w.\-]/g, "_");
    const stamp = Date.now() + "_" + Math.floor(Math.random() * 1e4);
    const key = "recruits/" + stamp + "_" + cleanName;
    await env.IMAGES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "image/jpeg" },
    });
    return json({ ok: true, path: key }, 200, CORS);
  }

  // 6.2 GET /recruit/img?path=recruits/xxx  受控招品图片：登录可见，内联展示，防下载
  if (method === "GET" && path === "recruit/img") {
    // 方案A：未登录预览放行（分享类目缩略图），原图受限流+审计兜底；不回退拦截
    const p = (url.searchParams.get("path") || "").trim();
    // 兼容历史/不同前缀的图片路径：只要不包含目录穿越且非空即放行，避免误拦 400
    if (!p || p.includes("..") || p.startsWith("/")) return json({ error: "参数错误" }, 400, CORS);
    const object = await env.IMAGES.get(p);
    if (!object) return json({ error: "文件不存在" }, 404, CORS);
    const headers = new Headers(CORS);
    headers.set("Content-Type", object.httpMetadata?.contentType || "image/jpeg");
    headers.set("Content-Disposition", "inline");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    return new Response(object.body, { headers });
  }

  // 6.3 DELETE /recruit/delete?path=recruits/xxx  删除招品图片（管理员）
  if (method === "DELETE" && path === "recruit/delete") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isAdminRole(role)) return json({ error: "无管理员权限" }, 403, CORS);
    if (!(await canManageZone(userId, role, token, env, "recruit"))) return json({ error: "未授权该专区" }, 403, CORS);
    const p = url.searchParams.get("path") || "";
    if (!p.startsWith("recruits/")) return json({ error: "参数错误" }, 400, CORS);
    await env.IMAGES.delete(p).catch(() => {});
    return json({ ok: true }, 200, CORS);
  }

  // ---------- 6. BESTSELLER回品专区（BESTSELLER图片存 R2，受控代理，不暴露直链） ----------
  // 6.1 POST /bestseller/upload 上传BESTSELLER图片（管理员）→ 返回 bestsellers/ 路径
  if (method === "POST" && path === "bestseller/upload") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isAdminRole(role)) return json({ error: "无管理员权限" }, 403, CORS);
    if (!(await canManageZone(userId, role, token, env, "bestseller"))) return json({ error: "未授权该专区" }, 403, CORS);

    const form = await request.formData();
    const file = form.get("file");
    if (!file) return json({ error: "缺少图片" }, 400, CORS);
    if (!/^image\//i.test(file.type || "") && !/\.(jpe?g|png|webp)$/i.test(file.name || "")) {
      return json({ error: "仅支持图片" }, 400, CORS);
    }
    const cleanName = (file.name || "img").replace(/[^\w.\-]/g, "_");
    const stamp = Date.now() + "_" + Math.floor(Math.random() * 1e4);
    const key = "bestsellers/" + stamp + "_" + cleanName;
    await env.IMAGES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "image/jpeg" },
    });
    return json({ ok: true, path: key }, 200, CORS);
  }

  // 6.2 GET /bestseller/img?path=bestsellers/xxx  受控BESTSELLER图片：登录可见，内联展示，防下载
  if (method === "GET" && path === "bestseller/img") {
    // 方案A：未登录预览放行（分享类目缩略图）
    const p = (url.searchParams.get("path") || "").trim();
    // 兼容历史/不同前缀的图片路径：只要不包含目录穿越且非空即放行，避免误拦 400
    if (!p || p.includes("..") || p.startsWith("/")) return json({ error: "参数错误" }, 400, CORS);
    const object = await env.IMAGES.get(p);
    if (!object) return json({ error: "文件不存在" }, 404, CORS);
    const headers = new Headers(CORS);
    headers.set("Content-Type", object.httpMetadata?.contentType || "image/jpeg");
    headers.set("Content-Disposition", "inline");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    return new Response(object.body, { headers });
  }

  // 6.3 DELETE /bestseller/delete?path=bestsellers/xxx  删除BESTSELLER图片（管理员）
  if (method === "DELETE" && path === "bestseller/delete") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isAdminRole(role)) return json({ error: "无管理员权限" }, 403, CORS);
    if (!(await canManageZone(userId, role, token, env, "bestseller"))) return json({ error: "未授权该专区" }, 403, CORS);
    const p = url.searchParams.get("path") || "";
    if (!p.startsWith("bestsellers/")) return json({ error: "参数错误" }, 400, CORS);
    await env.IMAGES.delete(p).catch(() => {});
    return json({ ok: true }, 200, CORS);
  }

  // 7. 存量图片压缩池：列出存储全部图片（key + size），仅管理员
  if (method === "GET" && path === "admin/list-imgs") {
    /* 20261115G：截图里的 401 就是这一行返回的 —— 请求没带令牌（会话过期后前端又没刷新成功）。
       以前只说「未登录」，看不出是没带令牌还是令牌无效，排查会绕圈。
       现在把「有没有带令牌」与「令牌是否有效」分开写清楚，前端也好给出「重新登录」的指引。 */
    if (!userId) {
      return json({
        error: token ? "登录令牌已失效，请退出重新登录" : "请求没有带上登录令牌（可能刚退出登录或页面是旧版本）",
        code: token ? "token-invalid" : "token-missing",
        build: WORKER_BUILD,
      }, 401, CORS);
    }
    const role = await getRole(userId, token, env);
    if (!isAdminRole(role)) {
      return json({ error: "无管理员权限", code: "role", role: role || "空" }, 403, CORS);
    }
    const items = [];
    let cursor;
    do {
      const page = await env.IMAGES.list({ cursor, limit: 1000 });
      for (const o of (page.objects || [])) {
        // 只保留视觉专区图片（key 以 images/ 开头），排除趋势/招品/回品等其它专区
        if (o.key && o.key.startsWith("images/")) items.push({ key: o.key, size: o.size });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return json({ ok: true, items }, 200, CORS);
  }

  // 8. 存量图片压缩池：按原路径覆盖写回压缩后的图（转 WebP），仅管理员
  if (method === "POST" && path === "admin/overwrite") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isAdminRole(role)) return json({ error: "无管理员权限" }, 403, CORS);
    const p = url.searchParams.get("path") || "";
    if (!p) return json({ error: "参数错误" }, 400, CORS);
    const form = await request.formData().catch(() => null);
    const file = form ? form.get("file") : null;
    if (!file) return json({ error: "缺少文件" }, 400, CORS);
    await env.IMAGES.put(p, file.stream(), {
      httpMetadata: { contentType: file.type || "image/webp" },
    });
    return json({ ok: true }, 200, CORS);
  }

  /* 20261116B · 存量图片补缩略图：POST /admin/thumb?path=images/xxx.jpg
     老图上传时没有缩略图，卡片只能下整张（约 200KB）。后台「图片池」提供一键回填：
     浏览器把原图拉下来缩成 340px 再传回这里，存进 thumbs/，之后前台就取小图。 */
  if (method === "POST" && path === "admin/thumb") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role0 = await getRole(userId, token, env);
    if (!isAdminRole(role0)) return json({ error: "无管理员权限" }, 403, CORS);
    const p0 = String(url.searchParams.get("path") || "").replace(/^\/+/, "");
    if (!p0 || !p0.startsWith("images/")) return json({ error: "参数错误" }, 400, CORS);
    const form0 = await request.formData().catch(() => null);
    const file0 = form0 ? form0.get("file") : null;
    if (!file0 || typeof file0 === "string") return json({ error: "缺少文件" }, 400, CORS);
    const tk0 = thumbKeyOf(p0);
    if (!tk0) return json({ error: "参数错误" }, 400, CORS);
    await env.IMAGES.put(tk0, file0.stream(), { httpMetadata: { contentType: "image/webp" } });
    return json({ ok: true, thumb: tk0 }, 200, CORS);
  }

  // 9. 超管用户管理——创建 Auth 用户（邮箱 + 密码），仅超级管理员
  if (method === "POST" && path === "admin/user/create") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isSuperRole(role)) return json({ error: "仅超级管理员可操作" }, 403, CORS);
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "服务端未配置 service_role" }, 500, CORS);
    const body = await request.json().catch(() => ({}));
    const email = (body.email || "").trim();
    const password = (body.password || "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "邮箱格式不正确" }, 400, CORS);
    if (!password || password.length < 6) return json({ error: "密码至少 6 位" }, 400, CORS);
    try {
      const u = await adminCreateAuthUser(env, email, password);
      return json({ ok: true, user: u }, 200, CORS);
    } catch (e) {
      return json({ error: e.message || "创建用户失败" }, 400, CORS);
    }
  }
  // 9.1 超管用户管理——删除 Auth 用户（级联清理 profiles），仅超级管理员
  if (method === "DELETE" && path === "admin/user/delete") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (!isSuperRole(role)) return json({ error: "仅超级管理员可操作" }, 403, CORS);
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "服务端未配置 service_role" }, 500, CORS);
    const uid = (url.searchParams.get("uid") || "").trim();
    if (!uid) return json({ error: "缺少用户 ID" }, 400, CORS);
    // 先删 profiles（防外键/触发器报错），再删 auth 用户；均忽略单步失败
    await fetch(env.SUPABASE_URL + "/rest/v1/profiles?user_id=eq." + encodeURIComponent(uid), {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      },
    }).catch(() => {});
    try {
      await adminDeleteAuthUser(env, uid);
      return json({ ok: true }, 200, CORS);
    } catch (e) {
      return json({ error: e.message || "删除用户失败" }, 400, CORS);
    }
  }

  return json({ error: "未知请求" }, 404, CORS);
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (e) {
      return json({ error: "服务异常" }, 500, CORS);
    }
  },
};