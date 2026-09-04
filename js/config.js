/* ============================================================
 * 站点配置（部署前请按需修改）
 * ============================================================
 * 1) siteTitle 站点名称
 * 2) SUPABASE  你的 Supabase 项目配置（登录验证用）：
 *    - url      : Supabase 项目地址
 *      （登录 supabase.com -> 你的项目 -> Project Settings -> API -> Project URL）
 *    - anonKey  : 匿名公钥（同一页面 Project API keys -> anon public）
 * 3) WORKER_URL : 你的 Cloudflare Worker 地址（图片存 R2，由 Worker 鉴权代理）
 *      （格式形如 https://your-worker-name.your-subdomain.workers.dev，末尾不带 /）
 * 4) enableSignup：是否允许访客自助注册（false 则只能由管理员建号）
 *
 * 说明：图片不再直接访问 Supabase Storage，而是全部通过 Cloudflare Worker
 *       鉴权后从 R2 私有桶读取，实现"未登录拿不到图片"。
 * ============================================================ */
window.CONFIG = {
  // ---------- 站点信息 ----------
  siteTitle: "图片图鉴",
  siteSubtitle: "Browse · Collect · Share",

  // ---------- Supabase 配置（登录验证）★ 必填 ----------
  SUPABASE: {
    url: "https://qmyopvxezsluhuqzgnos.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFteW9wdnhlenNsdWh1cXpnbm9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0OTA4MDUsImV4cCI6MjEwNDA2NjgwNX0.8PONmLsj4VhGRNMaDZ_bsRgxIH1pyzW78uEn7y80_R4"
  },

  // ---------- Cloudflare Worker（图片守门员） ★ 必填 ----------
  WORKER_URL: "https://gallery-api.lisaifei7.workers.dev",

  // ---------- 功能开关 ----------
  enableSignup: true       // 前台是否允许自助注册（默认允许）
};
