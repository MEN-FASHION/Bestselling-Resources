/* 20261113M · 权限管理保存报错
   ------------------------------------------------------------
   真实故障：勾好类目点保存 → 「保存失败：new row for relation "zone_permissions"
   violates check constraint "zone_permissions_zone_check"」，控制台 400。
   原因：zone 列上有 CHECK 清单，新专区（上新节奏 / Pinterest / SHEIN / 渠道对比…）写不进去。

   本测试用内存模拟 PostgREST，验证三件事：
   1) 被约束拒绝时不抛错，授权自动落到站点设置字典，读回来仍然是这些类目；
   2) 不再「先删后插」——插入失败时原有授权一条都不会少；
   3) 非专区名类的错误（网络 / 登录）照旧抛错，不被吞掉。
   另外断言界面保存已逐专区容错，不再一处失败整次全断。 */
import fs from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

const S = fs.readFileSync("js/supabase.js", "utf8");
const P = fs.readFileSync("js/admin-perm.js", "utf8");

/* ---------- 内存版 PostgREST ---------- */
const BLOCKED = new Set(["rhythm", "pinterest", "shein", "compare", "titlelab"]);
let state = null, hardFail = false;

function freshState() {
  state = {
    site_settings: [{ id: 1, frontend_dims: {} }],
    zone_permissions: [
      // 视觉专区原有两条授权（用来验证「插入失败不会把旧的删掉」）
      { id: 1, user_id: "u1", zone: "visual", category: "毛衣" },
      { id: 2, user_id: "u1", zone: "visual", category: "衬衫" },
    ],
  };
}

const match = (r, filters) => filters.every(([k, v]) => Array.isArray(v) ? v.includes(r[k]) : r[k] === v);

function exec(q) {
  const rows = state[q.table] || (state[q.table] = []);
  if (q.op === "select") {
    let out = rows.filter(r => match(r, q.filters));
    if (q.cols && q.cols !== "*") {
      const cols = String(q.cols).split(",").map(s => s.trim());
      out = out.map(r => { const o = {}; cols.forEach(c => o[c] = r[c]); return o; });
    }
    if (q.single) return { data: out[0] || null, error: null };
    if (q.limit) out = out.slice(0, q.limit);
    return { data: out, error: null };
  }
  if (q.op === "insert") {
    if (hardFail) return { data: null, error: { code: "08006", message: "fetch failed" } };
    const list = Array.isArray(q.payload) ? q.payload : [q.payload];
    const bad = list.find(r => BLOCKED.has(r.zone));
    if (bad) {
      return { data: null, error: { code: "23514", message: 'new row for relation "zone_permissions" violates check constraint "zone_permissions_zone_check"' } };
    }
    list.forEach(r => rows.push(Object.assign({ id: rows.length + 1 }, r)));
    return { data: null, error: null };
  }
  if (q.op === "update") {
    rows.filter(r => match(r, q.filters)).forEach(r => Object.assign(r, q.payload));
    return { data: null, error: null };
  }
  if (q.op === "delete") {
    const killed = rows.filter(r => match(r, q.filters));
    state[q.table] = rows.filter(r => !match(r, q.filters));
    return { data: null, error: null, killed };
  }
  return { data: null, error: { message: "unknown op" } };
}

const window = {
  supabase: { createClient: () => makeClient() },
  CONFIG: { SUPABASE: { url: "http://x", anonKey: "k" } },
  localStorage: { getItem: () => null, setItem: () => {} },
};

/* builder 需要知道表名：包一层 from */
function makeClient() {
  const factory = (table) => {
    const q = { table, op: null, filters: [], payload: null, cols: "*", limit: 0, single: false };
    const api = {
      select(cols) { if (!q.op) q.op = "select"; q.cols = cols || "*"; return api; },
      insert(payload) { q.op = "insert"; q.payload = payload; return api; },
      update(payload) { q.op = "update"; q.payload = payload; return api; },
      delete() { q.op = "delete"; return api; },
      eq(k, v) { q.filters.push([k, v]); return api; },
      in(k, v) { q.filters.push([k, v]); return api; },
      limit(n) { q.limit = n; return api; },
      order() { return api; },
      maybeSingle() { q.single = true; return Promise.resolve(exec(q)); },
      then(res, rej) { return Promise.resolve(exec(q)).then(res, rej); },
    };
    return api;
  };
  return { from: factory, auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } };
}

const ctx = vm.createContext({
  window, document: {}, console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number,
  Object, Array, RegExp, Error, localStorage: window.localStorage, fetch: async () => ({ ok: true, json: async () => ({}) }),
});
window.supabase.createClient = () => makeClient();
vm.runInContext(S.replace("const SB = (() =>", "globalThis.SB = (() =>"), ctx);
const SB = ctx.SB;

(async () => {
  console.log("一、被 CHECK 约束拒绝时：不抛错，自动落字典");
  freshState();
  let r = null, thrown = null;
  try { r = await SB.setUserPermissions("u1", "rhythm", ["毛衣", "衬衫"]); } catch (e) { thrown = e; }
  ok(!thrown, "保存不抛错（用户不再看到「保存失败」）");
  ok(r && r.via === "dict", "返回 via=dict，界面可据此说明已降级");
  ok(state.zone_permissions.filter(x => x.zone === "rhythm").length === 0, "表里确实没写进去（约束仍在）");
  const dims = state.site_settings[0].frontend_dims || {};
  ok(dims.perm_zones && dims.perm_zones.u1 && Array.isArray(dims.perm_zones.u1.rhythm), "授权已写入站点设置字典");
  ok((dims.perm_zones.u1.rhythm || []).join(",") === "毛衣,衬衫", "字典里就是勾选的类目");

  console.log("二、读回来要一样（前台/上传下拉靠这条）");
  const back = await SB.listUserPermissions("u1", "rhythm");
  ok(back.join(",") === "毛衣,衬衫", "权限表读得到（列表展示）");
  const mine = await SB.myZonePermissions("rhythm");
  ok(mine.join(",") === "毛衣,衬衫", "当前登录用户读得到（实际上传拦截靠这条）");
  const all = await SB.listUserPermissions("u1");
  ok(all.includes("毛衣") && all.includes("衬衫"), "不传专区时并集里也有");

  console.log("三、不再「先删后插」：失败也不丢原有授权");
  freshState();
  hardFail = false;
  // 先给 visual 写一次会失败的新专区没关系，这里验证 visual 正常写入时的旧行处理
  await SB.setUserPermissions("u1", "visual", ["毛衣"]);
  const vis = state.zone_permissions.filter(x => x.user_id === "u1" && x.zone === "visual").map(x => x.category).sort();
  ok(vis.join(",") === "毛衣", "取消勾选的「衬衫」被删掉，勾着的「毛衣」保留");

  freshState();
  await SB.setUserPermissions("u1", "rhythm", ["毛衣"]);   // 这个专区会被拒
  const visAfter = state.zone_permissions.filter(x => x.zone === "visual").map(x => x.category).sort();
  ok(visAfter.join(",") === "毛衣,衬衫", "拒绝发生在别的专区时，visual 原有两条授权一条不少");

  console.log("四、非专区名类的错误照旧抛出，不吞掉");
  freshState();
  hardFail = true;
  let e2 = null;
  try { await SB.setUserPermissions("u1", "visual", ["外套"]); } catch (e) { e2 = e; }
  ok(!!e2, "网络/登录类错误仍然抛出（不会让用户以为保存成功）");
  ok(!((state.site_settings[0].frontend_dims || {}).perm_zones), "这种错误不写字典");

  console.log("五、正常写入成功时保持单一来源");
  freshState();
  hardFail = false;
  const r3 = await SB.setUserPermissions("u1", "recruit", ["外套"]);
  ok(r3 && r3.via === "table", "能写表就走表");
  ok(state.zone_permissions.some(x => x.zone === "recruit" && x.category === "外套"), "表里有了");
  const d3 = (state.site_settings[0].frontend_dims || {}).perm_zones || {};
  ok(!(d3.u1 && d3.u1.recruit), "字典里不留同一专区的副本（避免两处并存）");

  console.log("六、界面保存已逐专区容错");
  ok(/const viaDict = \[\], hardFail = \[\]/.test(P), "收集各专区结果而不是一处失败整次中断");
  ok(/if \(r && r\.via === "dict"\) viaDict\.push/.test(P), "降级专区会被记下来并说明");
  ok(/已保存，但有部分未生效/.test(P), "真有专区没存进去时明确点名，而不是一句「保存失败」");
  ok(/await step\("备注"/.test(P), "资料各项写入互不阻断（缺一列不至于整次保存失败）");

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})();
