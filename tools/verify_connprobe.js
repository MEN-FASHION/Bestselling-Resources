/* ============================================================
 * 连通性自检（connProbe / adminDashboard）分层判定验证
 * ------------------------------------------------------------
 * 背景（2026-10-16 用户反馈）：
 *   超管打开数据看板被提示"没有权限"，Network 面板里失败请求的响应体是
 *   { "message": "No API key found in request" } —— 这是「浏览器层把请求拦下了」
 *   （跨域预检被拒）的表现，而预检请求(OPTIONS)本来就不带密钥。
 *   旧代码把这类失败一律读成"没有权限"，把超管引向"改权限"的错误方向。
 *
 * 本脚本用假浏览器环境真实执行 js/supabase.js，逐层验证自检结论：
 *   配置 → 登录态 → 最小读写 → 看板接口
 * 并断言：不该发请求的时候绝不出手（避免产生令人误解的 400）。
 *
 * 运行：node tools/verify_connprobe.js
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "js", "supabase.js"), "utf8");

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name + (extra ? " → " + extra : "")); console.log("  ✗ " + name + (extra ? " → " + extra : "")); }
}

// 造一个 JWT 形态的 anon 密钥（payload 内含 ref / role，供配置自检解析）
function makeKey(ref, role) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." + b64({ ref: ref, role: role || "anon" }) + ".c2ln";
}

// 加载 supabase.js 并注入可控的假客户端
function loadSB(opts) {
  const o = opts || {};
  const calls = { rpc: [], select: [] };
  const session = o.session === undefined
    ? { access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "boss@x.com" } }
    : o.session;

  const fakeClient = {
    auth: {
      getSession: async () => ({ data: { session: session } }),
      refreshSession: async () => ({ data: { session: session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
    },
    from: (table) => {
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, is: () => chain, not: () => chain,
        order: () => chain, limit: () => chain, range: () => chain, maybeSingle: async () => ({ data: null, error: null }),
        then: (res, rej) => {
          calls.select.push(table);
          // 模拟真实浏览器里 fetch 失败：客户端直接抛错（等同于网络被拦）
          if (o.minimalThrow) { rej(new Error("TypeError: Failed to fetch")); return; }
          if (o.minimalError) return Promise.resolve(res({ data: null, error: { code: o.minimalError.code, message: o.minimalError.message }, status: o.minimalError.status }));
          return Promise.resolve(res({ data: [{ role: "super_admin" }], error: null, status: 200 }));
        },
      };
      return chain;
    },
    rpc: async (name, args) => {
      calls.rpc.push(name);
      if (o.dashThrow) throw new Error(o.dashThrow);
      if (o.dashError) return { data: null, error: o.dashError, status: o.dashError.status || 400 };
      if (o.dashData !== undefined) return { data: o.dashData, error: null, status: 200 };
      return { data: { meta: { is_super_admin: true, uid: "u1" }, users: { total: 3 }, visits: { pvTotal: 42, uvTotal: 7 } }, error: null, status: 200 };
    },
  };

  const cfg = o.config || { url: "https://abcdefgh.supabase.co", anonKey: makeKey("abcdefgh", "anon") };
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    setTimeout, clearTimeout, AbortController, Date, JSON, Math, Promise, String, Number, Object, Array, Error, RegExp, encodeURIComponent,
    navigator: { userAgent: "node" },
    location: { href: "https://newtrend.top/admin.html" },
    document: { createElement: () => ({ getContext: () => null, toBlob: () => {} }) },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    window: {
      CONFIG: { SUPABASE: cfg, WORKER_URL: "https://img.newtrend.top" },
      ZONE_DEFS_DEFAULT: [],
      supabase: { createClient: () => fakeClient },
    },
  };
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC + "\n;globalThis.__SB = SB;", ctx, { filename: "supabase.js" });
  return { SB: sandbox.__SB, calls: calls };
}

(async () => {
  console.log("== 连通性自检（connProbe）分层判定验证 ==");

  // --- 1. 一切正常且有数据 ---
  {
    console.log("\n[1] 配置·登录态·读写·看板 全部正常（已有数据）");
    const { SB } = loadSB({});
    const r = await SB.connProbe();
    ok(r.config.ok === true, "配置自检通过");
    ok(r.session === true, "登录态已就绪");
    ok(r.minimal.ok === true, "最小读写成功");
    ok(r.dashboard.ok === true && r.dashboard.empty === false, "看板接口有数据");
    ok(/接口连通且有数据/.test(r.verdict), "结论指向「接口连通」", r.verdict);
  }

  // --- 2. 接口通但无访问记录 ---
  {
    console.log("\n[2] 看板接口可用但没有访问记录");
    const { SB } = loadSB({ dashData: { meta: { is_super_admin: true }, users: { total: 1 }, visits: { pvTotal: 0, uvTotal: 0 } } });
    const r = await SB.connProbe();
    ok(r.dashboard.empty === true, "识别为「暂无数据」");
    ok(/还没有访问记录/.test(r.verdict), "结论提示去前台产生第一条", r.verdict);
  }

  // --- 3. 配置未生效（密钥与地址不是同一项目）---
  {
    console.log("\n[3] 配置未生效（密钥属于另一个项目）");
    const { SB, calls } = loadSB({ config: { url: "https://abcdefgh.supabase.co", anonKey: makeKey("zzzzzzzz", "anon") } });
    const r = await SB.connProbe();
    ok(r.config.ok === false, "配置自检不通过");
    ok(r.config.problems.join("").indexOf("不属于同一个项目") >= 0, "指出「不是同一个项目」");
    ok(/配置未生效/.test(r.verdict), "结论指向配置（而非权限）", r.verdict);
    ok(calls.rpc.length === 0, "未发出任何看板请求（不产生误导性的失败请求）");
  }

  // --- 4. 登录态未就绪 ---
  {
    console.log("\n[4] 登录态未就绪（会话为空）");
    const { SB, calls } = loadSB({ session: null });
    const r = await SB.connProbe();
    ok(r.session === false, "识别为未登录");
    ok(/登录态未就绪/.test(r.verdict), "结论指向登录（而非权限）", r.verdict);
    ok(calls.rpc.length === 0, "未发出看板请求");
  }

  // --- 5. 请求没抵达数据库（浏览器层被拦）---
  {
    console.log("\n[5] 请求根本没发出（跨域预检被拒/断网）");
    const { SB } = loadSB({ minimalThrow: true, dashThrow: "TypeError: Failed to fetch" });
    const r = await SB.connProbe();
    ok(r.minimal.ok === false && r.minimal.http === 0, "最小读写判定为「没抵达」");
    ok(/没能抵达数据库/.test(r.verdict), "结论指向网络/配置层（与账号权限无关）", r.verdict);
  }

  // --- 6. 网关拒绝（密钥或授权问题）---
  {
    console.log("\n[6] 数据库网关拒绝请求");
    const { SB } = loadSB({ minimalError: { code: "401", message: "No API key found in request", status: 401 } });
    const r = await SB.connProbe();
    ok(r.minimal.ok === false && r.minimal.http === 401, "最小读写判定为「被网关拒绝」");
    ok(/网关拒绝了请求/.test(r.verdict), "结论指向密钥/授权", r.verdict);
  }

  // --- 7. 只有看板这一层失败：浏览器层被拦 ---
  {
    console.log("\n[7] 其余读写正常，仅看板请求被浏览器层拦下");
    const { SB } = loadSB({ dashThrow: "TypeError: Failed to fetch" });
    const r = await SB.connProbe();
    ok(r.minimal.ok === true, "最小读写正常（说明配置与权限没问题）");
    ok(r.dashboard.ok === false && r.dashboard.diag === "blocked", "看板失败归类为 blocked");
    ok(/仅看板接口这一层失败/.test(r.verdict), "结论明确「只有看板这层失败」", r.verdict);
  }

  // --- 8~10. 看板错误码归类 ---
  const cases = [
    [{ code: "PGRST202", message: "Could not find the function public.admin_dashboard", status: 404 }, "missing_function", "函数不存在"],
    [{ code: "", message: "No API key found in request", status: 401 }, "no_api_key", "未携带访问密钥"],
    [{ code: "42501", message: "permission denied for function admin_dashboard", status: 403 }, "forbidden", "无执行权限"],
    [{ code: "PGRST301", message: "JWT expired", status: 401 }, "not_authenticated", "登录态失效"],
  ];
  for (const [err, want, label] of cases) {
    console.log("\n[归类] " + label);
    const { SB } = loadSB({ dashError: err });
    const r = await SB.connProbe();
    ok(r.dashboard.diag === want, "归类为 " + want, "实际 " + r.dashboard.diag);
  }

  // --- 11. adminDashboard：没有令牌时不该发请求 ---
  {
    console.log("\n[11] 无登录态时直接判定，不发注定失败的请求");
    const { SB, calls } = loadSB({ session: null });
    let diag = "";
    try { await SB.adminDashboard(); } catch (e) { diag = e.diag; }
    ok(diag === "not_authenticated", "归因为「登录态失效」（不误报没权限）", "实际 " + diag);
    ok(calls.rpc.length === 0, "未发出看板请求（不产生 400）");
  }

  // --- 12. 配置坏了同样不发请求 ---
  {
    console.log("\n[12] 配置未生效时直接判定，不发请求");
    const { SB, calls } = loadSB({ config: { url: "", anonKey: "" } });
    let diag = "", detail = "";
    try { await SB.adminDashboard(); } catch (e) { diag = e.diag; detail = e.detail; }
    ok(diag === "no_api_key", "归因为「未携带访问密钥」", "实际 " + diag);
    ok(/缺少数据库地址|缺少访问密钥/.test(detail), "明细说明缺什么", detail);
    ok(calls.rpc.length === 0, "未发出看板请求");
  }

  // --- 13. 提示文案：blocked 必须说清「与账号权限无关」---
  {
    console.log("\n[13] 页面提示文案检查（admin-perm.js）");
    const perm = fs.readFileSync(path.join(ROOT, "js", "admin-perm.js"), "utf8");
    ok(/blocked:/.test(perm), "存在 blocked 分类文案");
    ok(/与账号权限无关/.test(perm), "文案明确「与账号权限无关」");
    ok(/跨域|CORS|预检/.test(perm), "文案说明是浏览器层拦截");
    const idx = perm.indexOf("async function dashSelfCheck");
    const body = perm.slice(idx, idx + 3000);
    ok(/connProbe/.test(body), "自检入口调用分层自检");
    ok(/minimal/.test(body) && /dashboard/.test(body), "自检覆盖最小读写与看板两层");
  }

  console.log("\n== 结果：" + pass + " 项通过，" + fail + " 项失败 ==");
  if (fail) { console.log("失败项：\n - " + failures.join("\n - ")); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error("验证脚本异常：" + (e && e.message)); process.exit(2); });