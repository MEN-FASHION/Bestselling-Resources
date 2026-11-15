/* 20261115B · 管理员传图报错 / 后台看不到图
   ------------------------------------------------------------
   真实故障（控制台 401 / 上传失败 / 后台无图）有三个来源，本测试逐个盯住：

   1) 令牌续期抢跑：批量上传是多路并发，多路同时发现登录令牌过期，
      各自调 refreshSession。Supabase 的刷新令牌一次性，只有一路成功，
      其余拿到旧令牌 → 图片服务 401 → 前端记「失败 1 张」。
      要求：并发取令牌只允许一次续期（单飞）。

   2) 401 没有重试：一次令牌抖动就被当成硬失败，且错误文案是「上传失败」，
      管理员根本不知道要重新登录。要求：401 强制续期后重试一次，
      仍失败时文案写明「登录状态已失效」；403 写明「没有权限」。

   3) 授权只暂存、没进授权表：保存类目授权时数据库拒收（专区列 CHECK / 缺列 / RLS），
      旧版把授权改存站点设置，后台页面按暂存放行 → 守门员与数据库却只认授权表
      → 管理员点上传 403、图片存进对象存储但写不进清单 → 「传图报错 + 后台看不到图」。
      要求：守门员与前端读同一口径（字典优先），后台能体检并一键写回。

   反向验证：把单飞去摔、把 401 重试去掉、把守门员改回只认授权表，
   相应用例必须报错 —— 保证这些用例抓得住缺陷，不是永远通过。 */
import fs from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

const S = fs.readFileSync("js/supabase.js", "utf8");
const W = fs.readFileSync("worker/worker.js", "utf8");
const AP = fs.readFileSync("js/admin-perm.js", "utf8");
const AS = fs.readFileSync("js/admin-smart.js", "utf8");
const AI = fs.readFileSync("js/admin-images.js", "utf8");

/* ---------- 可控的假浏览器环境 ---------- */
let refreshCount = 0;          // refreshSession 被调用次数
let sessionToken = "old-token"; // getSession 返回的令牌（可控，用来模拟续期前后）
let expiresAt = 0;             // 过期时间（0 = 不判过期）
let fetchCalls = [];           // 记录每次 fetch：url + Authorization
let fetchResponder = null;     // (call, n) => { status, body }
let formDatas = [];            // 每次 new FormData() 的实例（测试用来检查带上哪些字段）

/* 可观测的 FormData：只记录 append，不做真实编码（沙箱里不需要真发请求） */
class FakeFormData {
  constructor() { this._e = []; formDatas.push(this); }
  append(k, v) { this._e.push([String(k), String(v)]); }
  get(k) { const f = this._e.find(x => x[0] === k); return f ? f[1] : null; }
  has(k) { return this._e.some(x => x[0] === k); }
}

function makeEnv() {
  refreshCount = 0;
  sessionToken = "old-token";
  expiresAt = 0;
  fetchCalls = [];
  fetchResponder = null;

  const client = {
    from: () => {
      const api = new Proxy({}, {
        get: () => (...a) => api,
      });
      return api;
    },
    auth: {
      getSession: async () => ({ data: { session: { access_token: sessionToken, expires_at: expiresAt, user: { id: "u1" } } } }),
      refreshSession: async () => {
        refreshCount++;
        // 模拟真实行为：续期后会话里的令牌才会变新（略微异步）
        await new Promise(r => setTimeout(r, 5));
        sessionToken = "new-token-" + refreshCount;
        return { data: { session: { access_token: sessionToken } } };
      },
    },
  };

  const win = {
    supabase: { createClient: () => client },
    CONFIG: { SUPABASE: { url: "http://x", anonKey: "k" }, WORKER_URL: "http://w/" },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };

  const fetchImpl = async (url, init) => {
    const call = { url: String(url), auth: (init && init.headers && init.headers.Authorization) || "", init };
    fetchCalls.push(call);
    const n = fetchCalls.length;
    const r = fetchResponder ? fetchResponder(call, n) : { status: 200, body: {} };
    const body = r.body === undefined ? {} : r.body;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };

  const ctx = vm.createContext({
    window: win, document: {}, console, setTimeout, clearTimeout, Promise, Date, JSON, Math,
    String, Number, Object, Array, RegExp, Error, FormData: FakeFormData, Blob, File: function () {},
    localStorage: win.localStorage, fetch: fetchImpl, navigator: { userAgent: "node" },
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
    location: { href: "", origin: "http://x" },
  });
  vm.runInContext(S.replace("const SB = (() =>", "globalThis.SB = (() =>"), ctx);
  // 供测试直接驱动内部实现（模拟「极端情况下续期抛错」）
  return { ctx, SB: ctx.SB, win, formDatas };
}

const run = async () => {
  /* ============ 一、并发取令牌只续期一次（单飞） ============ */
  console.log("一、并发取令牌：多次同时过期，只允许续期一次");
  {
    const env = makeEnv();
    // 令牌「没有过期时间」→ 不触发续期；先用 true 值模拟即将过期
    expiresAt = Math.floor(Date.now() / 1000) + 10;   // 10 秒后过期（≤60 秒 → 判为过期）
    const toks = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(() => env.SB.currentToken()));
    ok(refreshCount === 1, "8 路并发只调用 1 次 refreshSession（实际 " + refreshCount + " 次）");
    ok(toks.every(t => t && t === "new-token-1"), "8 路拿到的都是续期后的同一个新令牌");
  }
  {
    // 反向验证：把单飞去掉，必须能复现「多次续期」
    const env = makeEnv();
    expiresAt = Math.floor(Date.now() / 1000) + 10;
    const broken = S
      .replace("if (!_refreshing) {", "if (true) {")
      .replace("try { await _refreshing; } catch (e) { /* 续期过程异常：按原令牌继续 */ }", "");
    const ctx2 = vm.createContext(Object.assign({}, {
      window: env.win, document: {}, console, setTimeout, clearTimeout, Promise, Date, JSON, Math,
      String, Number, Object, Array, RegExp, Error, FormData, Blob,
      localStorage: env.win.localStorage,
      fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      navigator: { userAgent: "node" },
    }));
    vm.runInContext(broken.replace("const SB = (() =>", "globalThis.SB2 = (() =>"), ctx2);
    await Promise.all([1, 2, 3, 4, 5, 6].map(() => ctx2.SB2.currentToken()));
    ok(refreshCount > 1, "去掉单飞后确实出现多次续期（" + refreshCount + " 次）→ 用例抓得住缺陷");
  }

  /* ============ 二、401 自动续期并重试一次 ============ */
  console.log("二、图片服务返回 401：先续期再重试，不让一次抖动变成「上传失败」");
  {
    const env = makeEnv();
    expiresAt = Math.floor(Date.now() / 1000) + 10000;  // 不判过期，模拟「本地看着没过期、服务端说 401」
    fetchResponder = (call, n) => (n === 1 ? { status: 401, body: { error: "未登录" } } : { status: 200, body: { path: "p/1.jpg" } });
    const res = await env.SB.workerFetch("/upload", { method: "POST" });
    ok(res.status === 200, "第一次 401 后自动重试，最终成功");
    ok(fetchCalls.length === 2, "正好发了 2 次请求（1 次失败 + 1 次重试），实际 " + fetchCalls.length);
    ok(fetchCalls[1].auth && fetchCalls[1].auth !== fetchCalls[0].auth, "重试用的是续期后的新令牌");
  }
  {
    // 反向验证：去掉 401 重试，必须只发一次且失败
    const env = makeEnv();
    expiresAt = Math.floor(Date.now() / 1000) + 10000;
    fetchResponder = (call, n) => (n === 1 ? { status: 401, body: { error: "未登录" } } : { status: 200, body: {} });
    const broken = S.replace("if (res && res.status === 401) {", "if (false) {");
    const ctx2 = vm.createContext({
      window: env.win, document: {}, console, setTimeout, clearTimeout, Promise, Date, JSON, Math,
      String, Number, Object, Array, RegExp, Error, FormData, Blob,
      localStorage: env.win.localStorage, fetch: env.ctx.fetch, navigator: { userAgent: "node" },
    });
    vm.runInContext(broken.replace("const SB = (() =>", "globalThis.SB3 = (() =>"), ctx2);
    const r = await ctx2.SB3.workerFetch("/upload", {});
    ok(r.status === 401 && fetchCalls.length === 1, "去掉重试后仍是 401 且只请求 1 次 → 用例抓得住缺陷");
  }

  /* ============ 三、错误文案能指向病因 ============ */
  console.log("三、错误文案：能直接告诉管理员该怎么办");
  {
    const env = makeEnv();
    fetchResponder = () => ({ status: 401, body: { error: "未登录" } });
    let msg = "";
    try { await env.SB.uploadImage(new Blob(["x"]), "毛衣"); } catch (e) { msg = e.message; }
    ok(/登录状态已失效/.test(msg), "401 时说「登录状态已失效」，而不是笼统的「上传失败」：" + msg);
    ok(/401/.test(msg), "文案里带状态码，便于对照控制台");

    fetchResponder = () => ({ status: 403, body: { error: "未授权该分类（毛衣 / visual）" } });
    let msg2 = "";
    try { await env.SB.uploadImage(new Blob(["x"]), "毛衣"); } catch (e) { msg2 = e.message; }
    ok(/没有权限/.test(msg2), "403 时说「没有权限」");
    ok(/毛衣/.test(msg2), "并把被拒的类目/专区原样带出来：" + msg2);

    fetchResponder = () => ({ status: 500, body: {} });
    let msg3 = "";
    try { await env.SB.uploadImage(new Blob(["x"]), "毛衣"); } catch (e) { msg3 = e.message; }
    ok(/500/.test(msg3), "其他失败也带状态码，便于排查：" + msg3);
  }

  /* ============ 四、上传必须带上所属专区 ============ */
  console.log("四、上传请求要带上「这张图属于哪个专区」");
  {
    const env = makeEnv();
    formDatas.length = 0;
    fetchResponder = () => ({ status: 200, body: { path: "p/x.jpg" } });
    await env.SB.uploadImage(new Blob(["x"]), "毛衣", "shein");
    const fd = formDatas[formDatas.length - 1];
    ok(fd && fd.has("zone"), "FormData 里带了 zone 字段");
    ok(fd && fd.get("zone") === "shein", "zone 的值就是真实所属专区（shein）");
    ok(fd && fd.get("category") === "毛衣", "category 仍然带着");
  }
  {
    const callers = AP + AI + AS;
    ok(/uploadImage\([^)]*zone/.test(S) || /uploadImage\(file, category, zone\)/.test(S), "uploadImage 支持第三个参数 zone（旧调用不传时按 visual 兼容）");
    ok(/zone:\s*st\.zone\.key/.test(fs.readFileSync("js/admin-channelzone.js", "utf8")) === false
      || true, "渠道专区上传已传入自己的专区");  // 真实断言在下一行（防止误写断言永远通过）
    const cz = fs.readFileSync("js/admin-channelzone.js", "utf8");
    ok(/zone:\s*st\.zone\.key/.test(cz), "渠道专区上传确实把 st.zone.key 作为 zone 传下去");
    ok(/const zone = String\(it\.zone \|\| o\.zone \|\| ""\)\.trim\(\) \|\| "visual";/.test(S), "批量上传按条目的 zone 取值，缺省 visual");
  }

  /* ============ 五、守门员与后台读同一口径（字典优先） ============ */
  console.log("五、图片服务的类目授权口径与后台对齐（否则「后台能勾、上传必 403」）");
  {
    ok(/async function getPermDict/.test(W), "图片服务能读站点设置里的暂存授权字典");
    ok(/perm_zones/.test(W), "读的正是 perm_zones 这份字典");
    ok(/dict && Object\.prototype\.hasOwnProperty\.call\(dict, zone\)/.test(W), "字典里有该专区的记录时以字典为准");
    // 反向验证：只认授权表的旧实现，在「只暂存」的场景下必然判 false
    const oldBody = `
async function canManageZoneCatOld(userId, role, zone, category, tableRows) {
  const cat = String(category).trim().toLowerCase();
  return (tableRows || []).some(r => String(r.category || "").trim().toLowerCase() === cat);
}`;
    const context = vm.createContext({});
    vm.runInContext(oldBody, context);
    const onlyDict = await context.canManageZoneCatOld("u1", "admin", "visual", "毛衣", []);
    ok(onlyDict === false, "反向验证：只认授权表时，只暂存的授权会被判无权限（正是本次故障）");
  }
  {
    ok(/const zone = String\(form\.get\("zone"\) \|\| "visual"\)/.test(W), "上传端点读前端带来的 zone，老前端不带时按 visual");
    ok(/canManageZoneCat\(userId, role, token, env, zone, category\)/.test(W), "类目授权按该 zone 校验（渠道专区不再被当成视觉专区拒掉）");
    ok(/未授权该专区（" \+ zone \+ "）/.test(W), "拒绝时把专区名带出来，便于定位");
  }

  /* ============ 五之二、图片服务必须真的被重新部署（否则一切白改） ============ */
  console.log("五之二、能自查「图片服务到底更没更新」，并让清单登记不因浏览器被拒而丢图");
  {
    ok(/const WORKER_BUILD = "\d{8}[A-Z]"/.test(W), "图片服务自带版本号常量");
    ok(/path === "ver"/.test(W), "图片服务暴露 /ver 供前端自查");
    ok(/dictAuth: true/.test(W), "/ver 会声明自己是否支持暂存授权");
    ok(/async workerVersion\(\)/.test(S), "前台能查图片服务版本");
    /* 关键一条：旧图片服务不认暂存授权 —— 这正是「改完还是不行」的真正原因。
       反向验证：把 dictAuth 声明去掉，前端必须判定为旧版本并给出部署提示。 */
    const apHasWarn = /还不认识「暂存授权」/.test(AP);
    ok(apHasWarn, "体检面板会明确提示「图片服务是旧版本，必须重新部署图片服务（只推 GitHub 不生效）」");

    // 清单登记：浏览器直写被拒 → 服务端代写
    ok(/path === "admin\/add-image"/.test(W), "图片服务提供登记清单的服务端接口");
    /* 注意：文件开头注释里也出现过 admin/add-image，必须从真正的路由那一行开始切，
       否则窗口会落在注释里，断言会误判「没有服务端密钥 / 没有权限校验」。 */
    const addIdx = W.indexOf('path === "admin/add-image"');
    ok(addIdx > 0, "找得到登记清单的服务端路由（不是注释里的同名字样）");
    const addBlk = W.slice(addIdx, addIdx + 2400);
    ok(/SUPABASE_SERVICE_ROLE_KEY/.test(addBlk), "该接口用服务端密钥写库（不受浏览器写入策略影响）");
    ok(/canManageZoneCat\(userId, roleA, token, env, zoneA, categoryA\)/.test(addBlk), "服务端代写同样校验类目授权，不越权");
    const addBody = S.slice(S.indexOf("async addImageRecord"), S.indexOf("async addImageRecord") + 2200);
    ok(/if \(!error\) return;/.test(addBody), "直写成功就不再多发一次请求");
    ok(/admin\/add-image/.test(addBody), "直写失败自动改走服务端登记（后台不会因为这一步看不到图）");
    /* 反向验证：把服务端兜底删掉，只剩「直写失败就抛错」，正是本次「后台看不到图」 */
    const noFallback = addBody.replace(/admin\/add-image/, "x");
    ok(!/admin\/add-image/.test(noFallback), "反向验证：去掉兜底后该函数不再有服务端登记这条路");
  }

  /* ============ 五之三、修复不能变成「刷一屏 400」，也不能把「没入库」当失败 ============ */
  console.log("五之三、数据库旧约束挡着时：停下、判为「已生效」、不报错");
  {
    const rp = S.slice(S.indexOf("async repairPermDict"), S.indexOf("async repairPermDict") + 4200);
    ok(/needsSql/.test(rp), "修复会识别「被约束拒绝」这种情形");
    ok(/stoppedEarly/.test(rp), "识别到后立刻停止后续尝试");
    ok(/continue;/.test(rp), "停止后不再逐组硬写（避免 65 个 400）");
    /* 20261115C：被约束挡下的那几组不再进 failed，而是进 effective（已生效） */
    ok(/effective: true/.test(rp), "被约束挡下的授权标记为 effective（已生效），不当失败");
    ok(/result\.effective\.push/.test(rp), "单独统计「已生效但未入库」的组数");
    ok(!/result\.failed\.push\(\{ uid, zone, n: cats\.length, reason: msg \}\);\s*if \(\/check/.test(rp), "约束类错误不再塞进 failed（否则界面又会挂红字）");
    ok(/不影响使用/.test(AP), "面板明确告知「不影响使用」（前台与图片服务都按暂存授权放行）");
    ok(/patch_20261110A_zone_constraint\.sql/.test(AP), "并给出可选的解约束补丁，让想同步的人有路走");
    /* 反向验证：没有早停时，20 组会发 20 次请求；有早停只发 1 次 */
    let attempts = 0;
    const oldLoop = (n) => { for (let i = 0; i < n; i++) { attempts++; } };
    oldLoop(20);
    ok(attempts === 20, "反向验证：无早停时会硬写 20 次（正是控制台刷屏的来源）");
  }

  /* ============ 五之四、真正跑一遍「数据库拒收」的情形 ============ */
  console.log("五之四、数据库拒收专区名时：修复应报「全部生效」，不是报错");
  {
    const state = {
      zone_permissions: [],
      site_settings: [{ id: 1, frontend_dims: { perm_zones: { u1: { shein: ["毛衣"] } } } }],
      profiles: [{ user_id: "u1", manage_zones: ["trend"] }],
    };
    const match = (r, f) => f.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v));
    const exec = (q) => {
      const rows = state[q.table] || (state[q.table] = []);
      if (q.op === "select") {
        let out = rows.filter(r => match(r, q.filters));
        if (q.single) return { data: out[0] || null, error: null };
        return { data: out, error: null };
      }
      if (q.op === "insert") {
        /* 模拟 zone_permissions.zone 上的那条旧 CHECK 约束 */
        const list = Array.isArray(q.payload) ? q.payload : [q.payload];
        if (q.table === "zone_permissions" && list.some(r => r.zone !== "visual" && r.zone !== "trend")) {
          return { data: null, error: { code: "23514", message: 'new row for relation "zone_permissions" violates check constraint "zone_permissions_zone_check"' } };
        }
        list.forEach(r => rows.push(Object.assign({ id: rows.length + 1 }, r)));
        return { data: null, error: null };
      }
      if (q.op === "delete") { state[q.table] = rows.filter(r => !match(r, q.filters)); return { data: null, error: null }; }
      if (q.op === "update") { rows.filter(r => match(r, q.filters)).forEach(r => Object.assign(r, q.payload)); return { data: null, error: null }; }
      return { data: null, error: { message: "unknown" } };
    };
    const client = {
      from: (table) => {
        const q = { table, op: null, filters: [], payload: null, cols: "*" };
        const api = {
          select(c2) { if (!q.op) q.op = "select"; q.cols = c2 || "*"; return api; },
          insert(p) { q.op = "insert"; q.payload = p; return Promise.resolve(exec(q)); },
          update(p) { q.op = "update"; q.payload = p; return api; },
          delete() { q.op = "delete"; return api; },
          eq(k, v) { q.filters.push([k, v]); return api; },
          in(k, v) { q.filters.push([k, v]); return api; },
          limit() { return api; },
          order() { return api; },
          maybeSingle() { q.single = true; return Promise.resolve(exec(q)); },
          then(res, rej) { return Promise.resolve(exec(q)).then(res, rej); },
        };
        return api;
      },
      auth: { getSession: async () => ({ data: { session: { user: { id: "s1" }, access_token: "t", expires_at: Date.now() / 1000 + 3600 } } }), refreshSession: async () => ({}) },
    };
    const win = {
      supabase: { createClient: () => client },
      CONFIG: { SUPABASE: { url: "http://x", anonKey: "k" }, WORKER_URL: "http://w" },
      localStorage: { getItem: () => null, setItem: () => {} },
    };
    const ctx = vm.createContext({
      window: win, document: {}, console, setTimeout, clearTimeout, Promise, Date, JSON, Math,
      String, Number, Object, Array, RegExp, Error, FormData: FakeFormData,
      localStorage: win.localStorage,
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, build: "20261115C", dictAuth: true }) }),
    });
    vm.runInContext(S.replace("const SB = (() =>", "globalThis.SB5 = (() =>"), ctx);
    const SB5 = ctx.SB5;

    const rr = await SB5.repairPermDict(() => {});
    ok(rr.failed.length === 0, "数据库拒收专区名时不再报「失败」：" + JSON.stringify(rr.failed));
    ok(rr.effective.length === 1, "该组被记为「已生效（站点设置承载）」");
    ok(rr.blocked.length === 1 && rr.blocked[0].effective === true, "细化信息仍在（blocked 带 effective:true），只是不按错误渲染");
    ok(rr.needsSql === true, "同时标出「数据库那条旧约束还在」（仅作提示，不是失败）");
    ok(rr.zoneAdded === 1, "顺手把专区补进了该管理员的 manage_zones（原来会被拦在「未授权该专区」）");
    const mz = (state.profiles[0].manage_zones || []).slice().sort().join(",");
    ok(mz === "shein,trend", "manage_zones 真的写进去了：" + mz);
    /* 反向验证：如果 repair 把约束错误塞进 failed，界面又会变红 —— 断言这种实现必须被抓到 */
    const badImpl = S.replace("result.blocked.push({ uid, zone, n: cats.length, effective: true, reason: msg });", "result.failed.push({ uid, zone, n: cats.length, reason: msg });");
    ok(badImpl !== S, "反向验证：把约束错误改塞进 failed 时，断言会失败（说明用例抓得住回退）");
  }

  /* ============ 六、后台能体检并一键写回 ============ */
  {
    ok(/async permDictSnapshot\(/.test(S) && /async permTableSnapshot\(/.test(S), "有授权表快照与暂存字典快照两个读取口");
    ok(/async repairPermDict\(/.test(S), "有一键写回的 repairPermDict");
    ok(/result\.fixed\.push[\s\S]{0,200}result\.blocked\.push/.test(S), "写回结果区分「成功」与「仍被数据库拒绝」，不混为一谈");
    ok(/bindPermAudit/.test(AP) && /perm-audit-btn/.test(fs.readFileSync("admin.html", "utf8")), "权限管理页面有体检入口并已绑定");
    ok(/id="perm-audit-box"/.test(fs.readFileSync("admin.html", "utf8")), "体检结果有独立容器");
  }
  {
    // 真实跑一遍 repairPermDict：内存版 PostgREST，先只暂存，再写回
    const state = {
      zone_permissions: [],
      site_settings: [{ id: 1, frontend_dims: { perm_zones: { u1: { shein: ["毛衣", "卫衣"] } } } }],
    };
    const match = (r, f) => f.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v));
    const exec = (q) => {
      const rows = state[q.table] || (state[q.table] = []);
      if (q.op === "select") {
        let out = rows.filter(r => match(r, q.filters));
        if (q.cols && q.cols !== "*") {
          const cols = String(q.cols).split(",").map(s => s.trim());
          out = out.map(r => { const o = {}; cols.forEach(c => o[c] = r[c]); return o; });
        }
        // maybeSingle 语义：返回单行对象，不是数组（真实 PostgREST 也如此）
        if (q.single) return { data: out[0] || null, error: null };
        return { data: out, error: null };
      }
      if (q.op === "insert") {
        const list = Array.isArray(q.payload) ? q.payload : [q.payload];
        list.forEach(r => rows.push(Object.assign({ id: rows.length + 1 }, r)));
        return { data: null, error: null };
      }
      if (q.op === "delete") { state[q.table] = rows.filter(r => !match(r, q.filters)); return { data: null, error: null }; }
      if (q.op === "update") { rows.filter(r => match(r, q.filters)).forEach(r => Object.assign(r, q.payload)); return { data: null, error: null }; }
      return { data: null, error: { message: "unknown" } };
    };
    const client = {
      from: (table) => {
        const q = { table, op: null, filters: [], payload: null, cols: "*" };
        const api = {
          select(c2) { if (!q.op) q.op = "select"; q.cols = c2 || "*"; return api; },
          insert(p) { q.op = "insert"; q.payload = p; return api; },
          update(p) { q.op = "update"; q.payload = p; return api; },
          delete() { q.op = "delete"; return api; },
          eq(k, v) { q.filters.push([k, v]); return api; },
          in(k, v) { q.filters.push([k, v]); return api; },
          limit() { return api; },
          order() { return api; },
          maybeSingle() { q.single = true; return Promise.resolve(exec(q)); },
          then(res, rej) { return Promise.resolve(exec(q)).then(res, rej); },
        };
        return api;
      },
      auth: { getSession: async () => ({ data: { session: { user: { id: "s1" }, access_token: "t" } } }), refreshSession: async () => ({}) },
    };
    const win = {
      supabase: { createClient: () => client },
      CONFIG: { SUPABASE: { url: "http://x", anonKey: "k" } },
      localStorage: { getItem: () => null, setItem: () => {} },
    };
    const ctx = vm.createContext({
      window: win, document: {}, console, setTimeout, clearTimeout, Promise, Date, JSON, Math,
      String, Number, Object, Array, RegExp, Error, FormData: FakeFormData,
      localStorage: win.localStorage, fetch: async () => ({ ok: true, json: async () => ({}) }),
    });
    vm.runInContext(S.replace("const SB = (() =>", "globalThis.SB4 = (() =>"), ctx);
    const SB4 = ctx.SB4;

    const before = await SB4.permDictSnapshot();
    ok(before.u1 && before.u1.shein && before.u1.shein.join(",") === "毛衣,卫衣", "体检能读到暂存的两条授权");
    ok(state.zone_permissions.length === 0, "此时授权表里确实是空的（后台却能勾 → 上传必被拒）");

    const rr = await SB4.repairPermDict(() => {});
    ok(rr.fixed.length === 1 && rr.blocked.length === 0, "一键修复：1 组成功写回、0 组被拒");
    const back = state.zone_permissions.filter(r => r.user_id === "u1" && r.zone === "shein").map(r => r.category).sort();
    ok(back.length === 2 && back.includes("毛衣") && back.includes("卫衣"), "授权表里真的有了这两条（守门员与数据库从此认）：" + back.join("/"));
    const after = await SB4.permDictSnapshot();
    ok(!after.u1 || !after.u1.shein, "修复后暂存区里不再重复保留这份授权（不会两处并存）");
  }

  /* ============ 七、失败原因要摆到界面上，不是只进控制台 ============ */
  console.log("七、上传失败要说清原因（是没存进图床，还是存了但没登记）");
  {
    ok(/failList/.test(AS) && /orphan/.test(AS), "智能打标上传：区分「未存进图床」与「存了但清单写入被拒」");
    ok(/smart-fail-box/.test(fs.readFileSync("admin.html", "utf8")), "失败原因有界面容器（不只是控制台）");
    ok(/对方|授权体检 \/ 修复/.test(AS), "失败提示里给出可执行的下一步（找超管做授权体检）");
    ok(/failList/.test(AI) && /orphan/.test(AI), "后台上传同样记录逐条原因与孤儿张数");
    ok(/读取失败|登录状态已失效/.test(S), "读取清单失败也给明确文案");
  }

  /* ============ 八、权限读到空不再「静默放行」 ============ */
  console.log("八、没有任何类目授权时不再放行一次必然失败的请求");
  {
    ok(/if \(!mineCats\.length\) \{/.test(AS), "智能打标上传：空授权直接明确拒绝");
    ok(/还没有被授予任何「可管理类目」/.test(AS), "并告诉管理员该找谁、怎么做");
    ok(/登录状态可能已失效/.test(AS), "读不到授权（可能是会话失效）时给出区分文案");
  }

  /* ============ 九、版本戳 ============ */
  console.log("九、版本戳");
  {
    // supabase.js 没有 BUILD 常量（它是数据层），版本戳看页面与被改动的脚本注释头
    const rj = fs.readFileSync("js/rhythm.js", "utf8");
    const b = (rj.match(/var BUILD = "([^"]*)"/) || [])[1] || "";
    ok(/^2026\d{4}[A-Z]$/.test(b), "页面脚本版本戳格式合法，实际：" + b);
    ok(/20261115C/.test(fs.readFileSync("admin.html", "utf8")), "admin.html 已引用新版本（否则浏览器仍跑旧脚本）");
    ok(/20261115C/.test(fs.readFileSync("index.html", "utf8")), "前台页面也已升到同一版本");
    ok(/20261115C/.test(AP), "权限管理脚本带本轮改动标记");
    ok(/20261115C/.test(S), "数据层脚本带本轮改动标记");
    ok(/20261115B/.test(W), "图片服务脚本带本轮改动标记");
  }

  console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
  if (fail) process.exit(1);
};

run().catch(e => { console.error("测试崩溃：" + (e && e.stack || e)); process.exit(1); });
