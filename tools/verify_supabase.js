/* 针对 js/supabase.js 的两项修复做行为验证：
 *  A. 看板接口错误分类：不同错误码/文本 → 不同 diag（页面提示才不会张冠李戴）
 *  B. 令牌读取：过期令牌必须先续期，避免把过期令牌发给接口被判「未登录」
 * 用法：node verify_supabase.js <supabase.js 路径>
 */
const fs = require("fs");
const vm = require("vm");
const path = process.argv[2];

function buildCtx(opts) {
  const calls = { refresh: 0, session: 0 };
  let session = opts.session || null;
  const fakeClient = {
    auth: {
      getSession: async () => { calls.session++; return { data: { session } }; },
      refreshSession: async () => { calls.refresh++; if (opts.afterRefresh) session = opts.afterRefresh; return { data: { session } }; },
      onAuthStateChange: () => {},
      signInWithPassword: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    rpc: async () => ({ data: opts.rpcData || null, error: opts.rpcError || null }),
  };
  const win = { CONFIG: { SUPABASE: { url: "https://probe.supabase.co", anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWYiOiAicHJvYmUiLCAicm9sZSI6ICJhbm9uIn0.sig" }, WORKER_URL: "" }, supabase: { createClient: () => fakeClient }, console };
  const ctx = {
    window: win, console, setTimeout, clearTimeout,
    document: { addEventListener: () => {} }, navigator: { userAgent: "node" },
    fetch: async () => ({ ok: false }),
    location: { href: "" },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URLSearchParams, Date, JSON, Math, atob, btoa, Buffer,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, "utf8"), ctx, { filename: path });
  // 脚本内用 const 声明 SB，需在上下文内取出来
  ctx.SB = vm.runInContext("SB", ctx);
  return { ctx, calls };
}

(async () => {
  let pass = 0, fail = 0;
  const check = (name, ok, extra) => {
    if (ok) { pass++; console.log("  ✓ " + name); }
    else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
  };

  // ---------- A. 错误分类 ----------
  const cases = [
    { name: "权限不足（错误码 42501）", err: { code: "42501", message: "permission denied for function admin_dashboard" }, want: "forbidden" },
    { name: "接口不存在（错误码 PGRST202）", err: { code: "PGRST202", message: "Could not find the function public.admin_dashboard in the schema cache" }, want: "missing_function" },
    { name: "函数不存在（文本提示）", err: { code: "", message: "function public.admin_dashboard() does not exist" }, want: "missing_function" },
    { name: "登录态失效（错误码 PGRST301）", err: { code: "PGRST301", message: "JWT expired" }, want: "not_authenticated" },
    { name: "403 文本", err: { code: "", message: "403 Forbidden" }, want: "forbidden" },
    { name: "网关未收到密钥", err: { code: "", message: "No API key found in request" }, want: "no_api_key" },
    // === 2026-10-16 生产故障回归用例 ===
    // 统计脚本内 `group by 1,2,3` → 数据库报 42803「aggregate functions are not allowed in GROUP BY」。
    // 这类错误是「函数内部 SQL 写错了」，与账号权限无关；
    // 且报文里含 "not allowed" 字样，若不单独归类会被误判成 forbidden（把用户引向去改权限）。
    { name: "统计脚本内部 SQL 报错（42803 + 聚合函数）", err: { code: "42803", message: "aggregate functions are not allowed in GROUP BY" }, want: "sql_exec" },
    { name: "统计脚本内部 SQL 报错（42803 + 序号越界）", err: { code: "42803", message: "GROUP BY position 2 is not in select list" }, want: "sql_exec" },
    { name: "统计脚本内部 SQL 报错（仅文本，无错误码）", err: { code: "", message: "aggregate functions are not allowed in GROUP BY" }, want: "sql_exec" },
    { name: "SQL 语法错误（42601）", err: { code: "42601", message: "syntax error at or near \"group\"" }, want: "sql_exec" },
    { name: "其它错误", err: { code: "XX000", message: "internal error" }, want: "other" },
  ];
  const future = Math.floor(Date.now() / 1000) + 3600;
  for (const c of cases) {
    // 这些分类场景都是"已登录用户"的调用失败，因此带上有效令牌（否则会在调用前就被拦下）
    const { ctx } = buildCtx({ session: { access_token: "GOOD", expires_at: future }, rpcError: c.err });
    let diag = null, code = null;
    try { await ctx.SB.adminDashboard(); } catch (e) { diag = e.diag; code = e.code; }
    check("分类：" + c.name + " → " + c.want, diag === c.want, "实际 " + diag);
    check("      错误码透传（" + (c.err.code || "空") + "）", code === (c.err.code || ""), "实际 " + code);
  }
  // 无登录态：必须在调用前就拦下，不能把注定失败的请求发出去（否则页面会误报"没有权限"）
  {

    const { ctx } = buildCtx({});




    let diag = null;
    try { await ctx.SB.adminDashboard(); } catch (e) { diag = e.diag; }
    check("无登录态：调用前拦截，归类为「登录态失效」而不是「没有权限」", diag === "not_authenticated", "实际 " + diag);
  }
  // 配置自检：能判断"密钥是否可用"，并能在密钥缺失/错项目时给出人话原因
  {
    const { ctx } = buildCtx({ session: { access_token: "GOOD", expires_at: future } });
    let cc = null;
    try { cc = ctx.SB.configCheck(); } catch (e) { cc = null; }
    check("配置自检：可用（地址与密钥同一项目）", !!(cc && cc.ok === true), cc ? JSON.stringify(cc.problems) : "无返回");
    // 密钥换成"另一个项目"的密钥时，应判定为不匹配
    const { ctx: ctx2 } = buildCtx({ session: { access_token: "GOOD", expires_at: future } });
    const otherKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." + Buffer.from(JSON.stringify({ ref: "someoneelseproject", role: "anon" })).toString("base64url") + ".sig";
    ctx2.window.CONFIG.SUPABASE.anonKey = otherKey;
    let cc2 = null;
    try { cc2 = ctx2.SB.configCheck(); } catch (e) { cc2 = null; }
    check("配置自检：能识别「密钥与地址不是同一项目」", !!(cc2 && cc2.ok === false && /同一个项目/.test((cc2.problems || []).join())), cc2 ? JSON.stringify(cc2.problems) : "无返回");
  }
  // 正常返回
  {
    const { ctx } = buildCtx({ session: { access_token: "GOOD", expires_at: Math.floor(Date.now() / 1000) + 3600 }, rpcData: { visits: { pvTotal: 3 }, meta: { role: "super_admin" } } });
    const d = await ctx.SB.adminDashboard();
    check("正常返回：拿到数据", !!(d && d.visits && d.visits.pvTotal === 3));
  }

  // ---------- B. 令牌续期 ----------
  {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const { ctx, calls } = buildCtx({
      session: { access_token: "STALE", expires_at: past },
      afterRefresh: { access_token: "FRESH", expires_at: Math.floor(Date.now() / 1000) + 3600 },
    });
    const t = await ctx.SB.currentToken();
    check("过期令牌：先续期再返回", calls.refresh > 0 && t === "FRESH", "refresh=" + calls.refresh + " token=" + t);
  }
  {
    const soon = Math.floor(Date.now() / 1000) + 10;   // 10 秒后过期 → 视为需要续期
    const { ctx, calls } = buildCtx({
      session: { access_token: "SOON", expires_at: soon },
      afterRefresh: { access_token: "FRESH2", expires_at: Math.floor(Date.now() / 1000) + 3600 },
    });
    const t = await ctx.SB.currentToken();
    check("即将过期：提前续期", calls.refresh > 0 && t === "FRESH2", "refresh=" + calls.refresh + " token=" + t);
  }
  {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const { ctx, calls } = buildCtx({ session: { access_token: "GOOD", expires_at: future } });
    const t = await ctx.SB.currentToken();
    check("未过期：不做无谓刷新（避免列表反复重绘）", calls.refresh === 0 && t === "GOOD", "refresh=" + calls.refresh + " token=" + t);
  }

  console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})();