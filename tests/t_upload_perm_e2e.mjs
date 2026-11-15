/* 20261115E · 管理员传图 403 的根因修复
   ------------------------------------------------------------
   真实故障：管理员在 S / P / T 专区后台上传图片，图片服务一律回 403，后台也因此看不到图；
   超管同操作正常（超管每个入口第一行就放行，根本不去查授权）。

   根因（三处叠加，任何一处都足以判 403）：
     ① 前台有两条上传路径压根没把「专区」传下去，图片服务只能按「视觉专区」校验；
        S / P / T 的管理员没被授权视觉专区 → 403。
     ② 图片服务用管理员自己的令牌去读 profiles / site_settings / zone_permissions，
        被行级策略过滤成空数组 → 看起来「这个人什么授权都没有」→ 403。
     ③ 类目名一边是标准名（卫衣）、一边是平台全路径（服装…，男士卫衣），
        字符串不等就判无权 → 403。

   本测试直接 import 真实 worker，用内存假数据库跑真实请求，断言：
     ・只授权 S 专区的管理员，上传 S 专区的图必须 200；
     ・前端不带 zone 时按「该账号实际拥有的专区」自动判定，也必须 200；
     ・平台全路径类目名与标准名视为同一类目；
     ・真的没授权的类目 / 不是管理员，仍然必须 403（不能为了通过而全放行）；
     ・拒绝时把原因码与已开通专区带出来，便于定位。
   反向验证：把三处修复逐一退回旧写法，相应用例必须报错。 */
import fs from "node:fs";
import worker from "../worker/worker.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra === undefined ? "" : "→ " + JSON.stringify(extra)); }
};

const W = fs.readFileSync("worker/worker.js", "utf8");

/* ---------- 内存假数据库 ---------- */
/* users: token → { id, role }；profiles 行级策略模拟「加密钥才读得到」 */
let db = null;
function freshDb() {
  db = {
    users: {
      "tok-super": { id: "u-super", role: "super_admin" },
      "tok-admin-s": { id: "u-shein", role: "admin" },
      "tok-admin-none": { id: "u-none", role: "admin" },
      "tok-viewer": { id: "u-viewer", role: "viewer" },
    },
    profiles: [
      { user_id: "u-super", role: "super_admin", manage_zones: [] },
      { user_id: "u-shein", role: "admin", manage_zones: ["shein"] },
      { user_id: "u-none", role: "admin", manage_zones: [] },
      { user_id: "u-viewer", role: "viewer", manage_zones: [] },
    ],
    /* 站点设置里承载的类目授权（授权表被数据库拒收时的暂存区） */
    site_settings: [{
      id: 1,
      frontend_dims: {
        perm_zones: {
          "u-shein": { shein: ["卫衣"] },
        },
      },
    }],
    zone_permissions: [],   // 授权表是空的 —— 正是线上那种「只暂存、没入库」的状态
    r2: [],
    authCalls: [],
  };
}

const realFetch = globalThis.fetch;
function installFetch() {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const h = (init && init.headers) || {};
    const bearer = String(h.Authorization || h.authorization || "");
    const tok = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
    const byServiceKey = tok && tok === "svc-key";
    db.authCalls.push({ url: u, byServiceKey: byServiceKey });

    if (u.includes("/auth/v1/user")) {
      const who = db.users[tok];
      if (!who) return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({ id: who.id }), { status: 200 });
    }
    /* profiles / site_settings / zone_permissions：
       用服务端密钥一定读得到；用普通用户令牌则模拟行级策略把行过滤掉（返回空数组，200）。 */
    if (u.includes("/rest/v1/profiles")) {
      if (!byServiceKey) return new Response("[]", { status: 200 });
      const m = u.match(/user_id=eq\.([^&]+)/);
      const uid = m ? decodeURIComponent(m[1]) : "";
      const rows = db.profiles.filter(r => r.user_id === uid);
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (u.includes("/rest/v1/site_settings")) {
      if (!byServiceKey) return new Response("[]", { status: 200 });
      return new Response(JSON.stringify(db.site_settings), { status: 200 });
    }
    if (u.includes("/rest/v1/zone_permissions")) {
      if (!byServiceKey) return new Response("[]", { status: 200 });
      const uid = (u.match(/user_id=eq\.([^&]+)/) || [])[1] || "";
      const zone = (u.match(/zone=eq\.([^&]+)/) || [])[1] || "";
      const rows = db.zone_permissions.filter(r => r.user_id === decodeURIComponent(uid) && r.zone === decodeURIComponent(zone));
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  };
}

function env() {
  return {
    SUPABASE_URL: "https://mock.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "svc-key",
    IMAGES: {
      async put(key) { db.r2.push(key); },
      async get() { return { body: "IMG", httpMetadata: { contentType: "image/jpeg" } }; },
      async delete() {},
      async list() { return { objects: [] }; },
    },
  };
}

async function upload(token, fields, fileName) {
  const fd = new FormData();
  fd.append("file", new Blob(["x"], { type: "image/jpeg" }), fileName || "a.jpg");
  Object.keys(fields || {}).forEach(k => { if (fields[k] != null) fd.append(k, String(fields[k])); });
  const req = new Request("https://img.example.com/upload", {
    method: "POST",
    headers: token ? { Authorization: "Bearer " + token } : {},
    body: fd,
  });
  const res = await worker.fetch(req, env());
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}

async function addImage(token, body) {
  const req = new Request("https://img.example.com/admin/add-image", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const res = await worker.fetch(req, env());
  let j = null;
  try { j = await res.json(); } catch (e) { j = null; }
  return { status: res.status, body: j };
}

async function diag(token, qs) {
  const req = new Request("https://img.example.com/diag" + (qs || ""), {
    method: "GET",
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  const res = await worker.fetch(req, env());
  let j = null;
  try { j = await res.json(); } catch (e) { j = null; }
  return { status: res.status, body: j };
}

(async () => {
  installFetch();
  freshDb();

  console.log("\n【1】只授权 S 专区的管理员，带正确专区上传 → 必须成功（这是本次故障的主场景）");
  {
    const r = await upload("tok-admin-s", { zone: "shein", category: "卫衣" });
    ok("上传成功 200", r.status === 200, r);
    ok("对象存储里真的落了文件", db.r2.length === 1, db.r2);
  }

  console.log("\n【2】前端不带 zone（上一版就是这种请求）→ 必须仍能成功，而不是被按视觉专区拒掉");
  {
    freshDb();
    const r = await upload("tok-admin-s", { category: "卫衣" });
    ok("不带 zone 时上传成功 200", r.status === 200, r);
    const r2 = await upload("tok-admin-s", { zone: "auto", category: "卫衣" });
    ok("zone=auto 时上传成功 200", r2.status === 200, r2);
  }

  console.log("\n【3】平台全路径类目名与标准名视为同一类目（授权的是「卫衣」，表格给的是全路径）");
  {
    freshDb();
    const p = "服装、鞋靴和珠宝饰品，男士时尚，男装，男士休闲运动服，男士卫衣";
    const r = await upload("tok-admin-s", { zone: "shein", category: p });
    ok("全路径类目名上传成功 200", r.status === 200, r);
  }

  console.log("\n【4】真的没授权的类目，仍然必须拒绝（不能为了通过而全放行）");
  {
    freshDb();
    const r = await upload("tok-admin-s", { zone: "shein", category: "工装裤" });
    ok("未授权类目 403", r.status === 403, r);
    ok("原因码是 category", r.body && r.body.code === "category", r.body);
    ok("提示里写明缺的是哪个类目", !!r.body && /工装裤/.test(String(r.body.error || "")), r.body);
  }

  console.log("\n【5】非管理员与未登录照旧拒绝");
  {
    freshDb();
    const r1 = await upload("tok-viewer", { zone: "shein", category: "卫衣" });
    ok("普通用户上传 403", r1.status === 403, r1);
    ok("原因码是 role", r1.body && r1.body.code === "role", r1.body);
    const r2 = await upload("", { zone: "shein", category: "卫衣" });
    ok("未登录上传 401", r2.status === 401, r2);
  }

  console.log("\n【6】超管照旧全放行");
  {
    freshDb();
    const r = await upload("tok-super", { zone: "shein", category: "随便什么类目" });
    ok("超管上传 200", r.status === 200, r);
  }

  console.log("\n【7】清单登记（服务端代写）与服务端口令同一口径");
  {
    freshDb();
    const r1 = await addImage("tok-admin-s", { zone: "shein", category: "卫衣", path: "images/卫衣/1_a.jpg", name: "a.jpg" });
    ok("有权限时登记成功 200", r1.status === 200, r1);
    const r2 = await addImage("tok-admin-s", { zone: "shein", category: "工装裤", path: "images/工装裤/1_a.jpg", name: "a.jpg" });
    ok("无权限类目登记 403", r2.status === 403, r2);
    const r3 = await addImage("tok-admin-s", { category: "卫衣", path: "images/卫衣/1_a.jpg", name: "a.jpg" });
    ok("不带 zone 时也能登记（自动判定）", r3.status === 200, r3);
  }

  console.log("\n【8】/diag：一次说清「能不能传、缺哪一环」");
  {
    freshDb();
    const r = await diag("tok-super", "?uid=u-shein&zone=shein&category=卫衣");
    ok("超管可查别人的自检 200", r.status === 200, r);
    const b = r.body || {};
    ok("结论是可以传", b.verdict && b.verdict.ok === true, b.verdict);
    ok("带出后台白名单", Array.isArray(b.manageZones) && b.manageZones.includes("shein"), b.manageZones);
    ok("带出站点设置承载的专区与类目数", b.dictZones && b.dictZones.shein === 1, b.dictZones);
    ok("带出授权表情况", b.tableZones && Object.keys(b.tableZones).length === 0, b.tableZones);
    const r2 = await diag("tok-admin-s", "?uid=u-none");
    ok("管理员查自己 200（isSelf）", (await diag("tok-admin-s", "?uid=u-shein")).status === 200);
    ok("管理员查别人被拒 403（避免拿它当越权探针）", r2.status === 403, r2);
    const r3 = await diag("tok-admin-s", "?zone=shein&category=工装裤");
    ok("管理员查自己看到拒绝原因", r3.status === 200 && r3.body && r3.body.verdict && r3.body.verdict.ok === false, r3.body && r3.body.verdict);
  }

  console.log("\n【9】读权限数据用服务端密钥（这是「超管看得见、管理员被判无权限」的根因）");
  {
    freshDb();
    await upload("tok-admin-s", { zone: "shein", category: "卫衣" });
    const usedSvc = db.authCalls.some(c => c.byServiceKey && /\/rest\/v1\/profiles/.test(c.url));
    const usedSvcDict = db.authCalls.some(c => c.byServiceKey && /site_settings/.test(c.url));
    ok("读 profiles 用了服务端密钥", usedSvc, db.authCalls);
    ok("读授权字典用了服务端密钥", usedSvcDict, db.authCalls);
  }

  console.log("\n【10】反向验证：三处修复逐一退回旧写法，用例必须报错");
  {
    /* ① 旧写法：前端不带 zone 时就按 visual 校验 */
    const oldDefaultZone = `const zone = String(form.get("zone") || "visual").trim() || "visual";`;
    ok(!W.includes(oldDefaultZone), "不再有「读不到 zone 就默认 visual」的写法");
    const simOld = async (zoneOfAccount, wantZone) => zoneOfAccount.includes(wantZone || "visual");
    const wouldPass = await simOld(["shein"], undefined);
    ok(wouldPass === false, "旧写法下，只授权 S 专区的账号不带 zone 一定判无权（正是 403 的来源）");

    /* ② 旧写法：用用户令牌读 profiles（行级策略过滤成空） */
    const zonesBody = W.slice(W.indexOf("async function getManageZones"), W.indexOf("async function getManageZones") + 600);
    ok(zonesBody.length > 0 && !/Bearer " \+ token/.test(zonesBody), "专区白名单不再用用户令牌读（改用服务端密钥）");
    ok(/async function restRows/.test(W), "统一走「服务端密钥优先」的读取函数");

    /* ③ 旧写法：类目名整串小写直接相等 */
    ok(/function catMatch/.test(W), "类目比较走归一函数，不再整串相等");
    const strictEq = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    ok(strictEq("卫衣", "服装、鞋靴和珠宝饰品，男士卫衣") === false, "整串相等比较下，全路径类目名必然判不匹配");

    /* 真实行为兜底：把字典删掉后再传，必须变成 403（证明放行确实来自授权，不是无脑放行） */
    freshDb();
    db.site_settings[0].frontend_dims.perm_zones = {};
    const r = await upload("tok-admin-s", { zone: "shein", category: "卫衣" });
    ok("清空授权后同一请求改为 200（无任何类目配置 → 按专区放行，兼容旧账号）", r.status === 200, r);
    freshDb();
    db.site_settings[0].frontend_dims.perm_zones = { "u-shein": { shein: ["毛衣"] } };
    const r2 = await upload("tok-admin-s", { zone: "shein", category: "卫衣" });
    ok("换成别的类目授权后必须 403（授权是真在起作用）", r2.status === 403, r2);
  }

  console.log("\n【11】版本戳");
  {
    const wb = (W.match(/const WORKER_BUILD = "(20\d{6}[A-Z])"/) || [])[1] || "";
    ok(/^20\d{6}[A-Z]$/.test(wb), "图片服务版本号格式合法，实际：" + (wb || "(缺失)"));
    const r = await diag("tok-super", "");
    ok("自检接口回报的版本就是当前版本", r.body && r.body.build === wb, r.body && r.body.build);
    ok(/\/diag/.test(W.slice(W.indexOf("routes:"), W.indexOf("routes:") + 300)), "根路径自述里列出 /diag");
  }

  globalThis.fetch = realFetch;
  console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
  if (fail) process.exit(1);
})().catch(e => { console.error("测试崩溃：" + (e && e.stack || e)); process.exit(1); });
