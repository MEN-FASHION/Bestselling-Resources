/* ============================================================
 * Cloudflare Worker —— 图片图鉴站的"守门员"
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

// Supabase 用户查询：通过令牌换 user id
async function getUserId(token, env) {
  if (!token) return null;
  const res = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
    headers: { Authorization: "Bearer " + token, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user?.id || null;
}

// 查询某用户在 profiles 表中的角色
async function getRole(userId, token, env) {
  const url = `${env.SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=role`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: "Bearer " + token,
    },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows && rows.length ? rows[0].role : null;
}

// CORS 头
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

async function handleRequest(request, env) {
  const url = new URL(request.url);
  // 关键修复：浏览器请求时中文类目会被 URL 编码，这里必须还原成本地字符再查 R2（否则中文类目图片 404）
  let path;
  try {
    path = decodeURIComponent(url.pathname).replace(/^\//, "");
  } catch (e) {
    path = url.pathname.replace(/^\//, "");
  }
  const method = request.method;

  // 预检
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // 登录令牌：优先 Authorization，其次 query 的 token（<img> 无法带头）
  const auth = request.headers.get("Authorization") || "";
  let token = auth.startsWith("Bearer ") ? auth.slice(7) : (url.searchParams.get("token") || "");
  const userId = await getUserId(token, env);

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

  // 兼容新旧存储：新图明文存中文路径，旧图曾以编码形式存储，先取解码后路径，取不到再取原始编码路径
  async function getObject(decodedPath, rawPath) {
    let obj = await env.IMAGES.get(decodedPath);
    if (!obj && rawPath && rawPath !== decodedPath) obj = await env.IMAGES.get(rawPath);
    return obj;
  }

  // ---------- 1. GET 看图：登录即可；公开浏览模式下免登录 ----------
  if (method === "GET" && path.startsWith("images/")) {
    if (!userId) {
      const pub = await isPublicAccess(env);
      if (!pub) return json({ error: "未登录" }, 401, CORS);
    }
    const rawPath = url.pathname.replace(/^\//, "");
    const object = await getObject(path, rawPath);
    if (!object) return json({ error: "文件不存在" }, 404, CORS);
    const headers = new Headers(CORS);
    headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
    // 防下载：禁止嗅探、禁止作为附件下载、禁止被外站引用，且不暴露令牌页面
    headers.set("Cache-Control", "public, max-age=3600");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    // 不设 Content-Disposition: attachment，避免图片变成"下载"。inline 仅用于提示
    headers.set("Content-Disposition", "inline");
    return new Response(object.body, { headers });
  }

  // ---------- 2. POST 上传：需要管理员 ----------
  if (method === "POST" && path === "upload") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (role !== "admin") return json({ error: "无管理员权限" }, 403, CORS);

    const form = await request.formData();
    const file = form.get("file");
    const category = (form.get("category") || "").trim();
    if (!file || !category) return json({ error: "缺少文件或分类" }, 400, CORS);

    // 唯一文件名，防覆盖
    const cleanName = file.name.replace(/[^\w.\-]/g, "_");
    const stamp = Date.now() + "_" + Math.floor(Math.random() * 1e4);
    // 中文类目统一明文存储（与取图时 decodeURIComponent 还原后的中文路径完全一致），避免 404
    const key = `images/${category}/${stamp}_${cleanName}`;

    await env.IMAGES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    return json({ ok: true, path: key }, 200, CORS);
  }

  // ---------- 3. DELETE 删除：需要管理员 ----------
  if (method === "DELETE" && path.startsWith("images/")) {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token, env);
    if (role !== "admin") return json({ error: "无管理员权限" }, 403, CORS);
    const rawPath = url.pathname.replace(/^\//, "");
    // 先删解码后路径，若不存在再删原始编码路径，兼容新旧存储
    await env.IMAGES.delete(path).catch(() => {});
    if (rawPath !== path) await env.IMAGES.delete(rawPath).catch(() => {});
    return json({ ok: true }, 200, CORS);
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