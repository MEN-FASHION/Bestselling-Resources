/* 访问统计链路验证（「数据看板一直没数据」的根因防线）
 *
 * 链路：页面打开 → 解析访问者地区 → 登记一次访问（写库）→ 每 20 秒累加停留时长
 * 关键约束：地区解析失败/卡住，绝不能挡住「登记访问」，否则看板永远没有数据。
 *
 * 断言：
 *   A. 未登录：不产生任何上报
 *   B. 已登录但地区解析卡住（网络不通）：仍必须在数秒内完成上报（兜底超时生效）
 *   C. 已登录且地区解析正常：上报内容带上地区信息
 *   D. 同一会话重复进入同一专区：只登记一次（避免来回切页刷出重复记录）
 *   E. 上报失败（接口异常）不影响页面：track 不抛错
 *
 * 用法：node verify_tracking.js <站点根目录>
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = process.argv[2] || ".";

function buildCtx(opts) {
  const state = { visits: [], pings: [], sessions: 0 };
  const store = {};
  const fakeSB = {
    getSession: async () => (opts.session === undefined ? { user: { id: "u1" } } : opts.session),
    geoInfo: opts.geoInfo || (async () => ({ ip: "1.2.3.4", country: "US", region: "CA", city: "LA" })),
    recordVisit: async (o) => {
      if (opts.recordFails) throw new Error("登记访问失败");
      state.visits.push(o);
      return 900 + state.visits.length;
    },
    visitPing: async (id, add) => { state.pings.push([id, add]); },
    geoInfoCalls: 0,
  };
  const ctx = {
    window: {
      SB: fakeSB,
      Common: undefined,
      CONFIG: {},
      addEventListener: () => {},
      setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    },
    console,
    setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    document: { addEventListener: () => {}, visibilityState: "visible" },
    navigator: { userAgent: "node" },
    location: { pathname: "/index.html", hash: "" },
    sessionStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Promise, Date, JSON, Math, Number, String, Object, Array, Error,
  };
  ctx.globalThis = ctx;
  ctx.SB = fakeSB;            // 页面里以裸标识符 SB 访问（等价于 window.SB）
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "common.js"), "utf8"), ctx, { filename: "common.js" });
  const Common = vm.runInContext("window.Common", ctx);
  return { ctx, Common, state, store };
}

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};

(async () => {
  console.log("【A】未登录不上报");
  {
    const { Common, state } = buildCtx({ session: null });
    await Common.visit.track("visual");
    check("未登录：无上报记录", state.visits.length === 0, "实际 " + state.visits.length);
  }

  console.log("【B】地区解析卡住时仍能完成上报（核心防线）");
  {
    const hang = () => new Promise(() => {});   // 永不 resolve，模拟网络黑洞
    const { Common, state } = buildCtx({ geoInfo: hang });
    const t0 = Date.now();
    await Common.visit.track("visual");
    const ms = Date.now() - t0;
    check("地区解析卡住：仍完成了上报", state.visits.length === 1, "实际 " + state.visits.length);
    check("耗时可接受（≤ 4 秒）", ms <= 4000, ms + " ms");
  }

  console.log("【C】地区解析正常：上报带地区信息");
  {
    const { Common, state } = buildCtx({});
    await Common.visit.track("trend");
    const v = state.visits[0] || {};
    check("上报 1 条", state.visits.length === 1, "实际 " + state.visits.length);
    check("专区正确（trend）", v.zone === "trend", String(v.zone));
    check("带上国家/省州", v.country === "US" && v.region === "CA", v.country + "/" + v.region);
    check("带上访问 IP", v.ip === "1.2.3.4", String(v.ip));
    check("带上页面路径", !!v.path, String(v.path));
  }

  console.log("【D】同一会话重复进入同一专区只登记一次");
  {
    const { Common, state } = buildCtx({});
    await Common.visit.track("visual");
    await Common.visit.track("visual");
    check("重复进入：仅 1 条上报", state.visits.length === 1, "实际 " + state.visits.length);
    const { Common: C2, state: s2 } = buildCtx({});
    await C2.visit.track("visual");
    await C2.visit.track("rank");
    check("不同专区：各记 1 条", s2.visits.length === 2, "实际 " + s2.visits.length);
  }

  console.log("【E】上报失败不影响页面");
  {
    const { Common } = buildCtx({ recordFails: true });
    let threw = false;
    try { await Common.visit.track("visual"); } catch (e) { threw = true; }
    check("接口异常：track 不抛错（静默）", !threw);
  }

  console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})();