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

const BUCKET = "IMAGES"; // r2 binding 名称

// Supabase 用户查询：通过令牌换 user id
async function getUserId(token) {
  if (!token) return null;
  const res = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { Authorization: "Bearer " + token, apikey: SUPABASE_ANON_KEY },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user?.id || null;
}

// 查询某用户在 profiles 表中的角色
async function getRole(userId, token) {
  const url = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=role`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
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

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\//, "");           // 如 upload / images/xx/yy.jpg
  const method = request.method;

  // 预检
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // 登录令牌：优先 Authorization，其次 query 的 token（<img> 无法带头）
  const auth = request.headers.get("Authorization") || "";
  let token = auth.startsWith("Bearer ") ? auth.slice(7) : (url.searchParams.get("token") || "");
  const userId = await getUserId(token);

  // ---------- 1. GET 看图：只要登录即可 ----------
  if (method === "GET" && path.startsWith("images/")) {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const object = await IMAGES.get(path);
    if (!object) return json({ error: "文件不存在" }, 404, CORS);
    const headers = new Headers(CORS);
    headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
    headers.set("Cache-Control", "public, max-age=3600");
    return new Response(object.body, { headers });
  }

  // ---------- 2. POST 上传：需要管理员 ----------
  if (method === "POST" && path === "upload") {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token);
    if (role !== "admin") return json({ error: "无管理员权限" }, 403, CORS);

    const form = await request.formData();
    const file = form.get("file");
    const category = (form.get("category") || "").trim();
    if (!file || !category) return json({ error: "缺少文件或分类" }, 400, CORS);

    // 唯一文件名，防覆盖
    const cleanName = file.name.replace(/[^\w.\-]/g, "_");
    const stamp = Date.now() + "_" + Math.floor(Math.random() * 1e4);
    const key = `images/${category}/${stamp}_${cleanName}`;

    await IMAGES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    return json({ ok: true, path: key }, 200, CORS);
  }

  // ---------- 3. DELETE 删除：需要管理员 ----------
  if (method === "DELETE" && path.startsWith("images/")) {
    if (!userId) return json({ error: "未登录" }, 401, CORS);
    const role = await getRole(userId, token);
    if (role !== "admin") return json({ error: "无管理员权限" }, 403, CORS);
    await IMAGES.delete(path);
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
  async fetch(request) {
    try {
      return await handleRequest(request);
    } catch (e) {
      return json({ error: "服务异常" }, 500, CORS);
    }
  },
};