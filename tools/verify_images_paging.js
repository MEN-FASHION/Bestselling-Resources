/* ============================================================
 * 前台「分页取全量图片」运行时验证（执行生产代码 js/supabase.js）
 *
 * 背景 / 线上实况：
 *   后台看到 1875 张图，前台某类目点进去却是 0 张 —— 类目菜单有该类目、图片却没有。
 *   根因：筛选视图原本"一次调用取全量"，会被数据库 API 的「单次最大返回条数」上限截断
 *         （默认约 1000 条），旧图整批落在线外；而类目菜单走的是聚合函数（只返回 1 行），
 *         不受上限影响，于是表现为「类目还在、图没了」，很像历史数据丢失。
 *   修复：改为按页循环取全（偏移量按实际返回条数推进，兼容服务端上限比请求值更小的情况），
 *         取满即停；中途失败保留已取部分并标记"不完整"，由页面如实提示而不是说"没有图片"。
 *
 * 本脚本不做桩替代：它直接执行仓库里的生产代码 js/supabase.js，
 * 只把"数据库客户端"换成可编程的假客户端（用于制造各种截断/失败情形）。
 *
 * 用法：node tools/verify_images_paging.js
 * ============================================================ */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = process.argv[2] || path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "js/supabase.js"), "utf8");

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; failures.push(name + (extra ? "  [" + extra + "]" : "")); console.log("  \u2717 " + name + (extra ? "  [" + extra + "]" : "")); }
};

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// 用真实生产代码建一个 SB：只替换数据库客户端
function makeSB(opts) {
  const total = opts.total;
  const rows = opts.rows;
  const serverCap = opts.serverCap || 100000;
  const failOnCall = opts.failOnCall || 0;   // 第 N 次分页调用抛错（1 起算）
  let pageCalls = 0;

  const client = {
    rpc: async (name, params) => {
      if (name === "frontend_count_images") {
        if (opts.countFails) return { data: null, error: { message: "count 失败（模拟）" } };
        return { data: total, error: null };
      }
      if (name === "frontend_list_images") {
        if (opts.bulkFails) return { data: null, error: { message: "单次取全量失败（模拟）" } };
        return { data: rows, error: null };   // 旧路径：一次全量（会被上限截断）
      }
      if (name === "frontend_list_images_page") {
        pageCalls++;
        if (failOnCall && pageCalls === failOnCall) return { data: null, error: { message: "分页第 " + pageCalls + " 次失败（模拟）" } };
        const off = Math.max(0, Number(params.p_offset) || 0);
        const lim = Math.max(1, Number(params.p_limit) || 0);
        // 服务端真实行为：即使请求 1000 条，也最多返回 serverCap 条
        return { data: rows.slice(off, off + Math.min(lim, serverCap)), error: null };
      }
      return { data: null, error: null };
    },
    from: () => ({ select: () => ({ eq: () => ({}) }) }),
  };

  const sandbox = {
    console,
    JSON, Math, String, Number, Object, Array, Promise, Error, Date, RegExp,
    setTimeout, clearTimeout,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    window: {
      CONFIG: {
        SUPABASE: {
          url: "https://abcdefghijklmnop.supabase.co",
          anonKey: "eyJhbGciOiJIUzI1NiJ9." + b64url({ ref: "abcdefghijklmnop", role: "anon" }) + ".sig",
        },
        WORKER_URL: "https://img.example.test",
      },
      supabase: { createClient: () => client },
      location: { href: "https://newtrend.top/index.html" },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC + "\n;globalThis.__SB = SB;", sandbox);
  return sandbox.__SB;
}

const mk = (n, cat) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: cat + "-" + i, path: "images/" + cat + "/" + i + ".jpg", category: cat, created_at: "2026-01-01" });
  return out;
};

(async function main() {
  console.log("== 前台分页取全量：生产代码运行时验证 ==");
  console.log("被验证文件：js/supabase.js（直接执行，未做逻辑替换）\n");

  // ---------- A：总量超过单次上限（线上实况：1875 张、上限 1000）----------
  {
    console.log("[A] 总量 1875、服务端单次上限 1000：必须取全 1875 张");
    const rows = mk(1875, "all");
    const SB = makeSB({ total: 1875, rows, serverCap: 1000 });
    const r = await SB.listAllFrontendImages();
    ok("返回条数 = 1875（不再被上限截断）", r.rows.length === 1875, "rows=" + r.rows.length);
    ok("标记为已取全（complete=true）", r.complete === true);
    ok("总数透传正确", r.total === 1875, "total=" + r.total);
    ok("顺序保持不变（首尾一致）", r.rows[0].id === "all-0" && r.rows[1874].id === "all-1874",
      r.rows[0].id + " .. " + r.rows[r.rows.length - 1].id);
    ok("无重复行", new Set(r.rows.map(x => x.id)).size === 1875);
  }

  // ---------- B：服务端上限比请求页大小更小（自适应推进）----------
  {
    console.log("\n[B] 请求每页 1000、服务端每次最多只给 300：偏移量须按实际返回推进，仍取全");
    const rows = mk(1875, "all");
    const SB = makeSB({ total: 1875, rows, serverCap: 300 });
    const r = await SB.listAllFrontendImages();
    ok("仍能取全 1875 张", r.rows.length === 1875, "rows=" + r.rows.length);
    ok("标记为已取全", r.complete === true);
    ok("无重复行", new Set(r.rows.map(x => x.id)).size === 1875);
  }

  // ---------- C：取到一半失败 → 保留已取部分并标记不完整（不能当成"没有图片"）----------
  {
    console.log("\n[C] 第 2 页失败：保留已取到的 1000 张，并标记 complete=false");
    const rows = mk(1875, "all");
    const SB = makeSB({ total: 1875, rows, serverCap: 1000, failOnCall: 2 });
    const r = await SB.listAllFrontendImages();
    ok("保留已取到的部分（1000 张）", r.rows.length === 1000, "rows=" + r.rows.length);
    ok("标记为不完整（complete=false）", r.complete === false);
    ok("总数仍然透传（便于提示「已取/共」）", r.total === 1875, "total=" + r.total);
  }

  // ---------- D：第 1 页就失败 → 必须如实抛错（交给页面显示真实原因）----------
  {
    console.log("\n[D] 第 1 页就失败：必须抛错，不能返回空数组假装没数据");
    const rows = mk(1875, "all");
    const SB = makeSB({ total: 1875, rows, serverCap: 1000, failOnCall: 1 });
    let threw = false, msg = "";
    try { await SB.listAllFrontendImages(); } catch (e) { threw = true; msg = String(e && e.message || e); }
    ok("如实抛出错误", threw, msg.slice(0, 60));
    ok("错误信息保留原始原因", /失败/.test(msg), msg.slice(0, 60));
  }

  // ---------- E：取不到总数（计数接口失败）时，靠"不足一页"终止 ----------
  {
    console.log("\n[E] 计数接口失败（total=null）：按页取到不足一页即停止，不无限循环");
    const rows = mk(250, "all");
    const SB = makeSB({ total: 250, rows, serverCap: 1000, countFails: true });
    const r = await SB.listAllFrontendImages();
    ok("取全 250 张", r.rows.length === 250, "rows=" + r.rows.length);
    ok("total 为 null（未拿到总数）", r.total === null, "total=" + r.total);
    ok("complete 不为 false（未发生失败）", r.complete !== false);
  }

  // ---------- F：本次修复针对的"类目菜单可见、该类目图片为 0"场景回归 ----------
  {
    console.log("\n[F] 回归：单次上限截断时，旧类目不会再变成 0 张");
    // 最新 1000 张都是"卫衣"，较旧的 875 张里有 58 张"T恤"（与线上数据形态一致）
    const rows = mk(1000, "卫衣").concat(mk(58, "T恤")).concat(mk(817, "其他"));
    const SB = makeSB({ total: 1875, rows, serverCap: 1000 });
    const r = await SB.listAllFrontendImages();
    const tees = r.rows.filter(x => x.category === "T恤").length;
    ok("T恤 取到 58 张（修复前为 0）", tees === 58, "tees=" + tees);
    ok("总数完整 1875", r.rows.length === 1875, "rows=" + r.rows.length);
  }

  console.log("\n== 结果：" + pass + " 项通过，" + fail + " 项失败 ==");
  if (fail) { console.log("失败项：\n - " + failures.join("\n - ")); process.exit(1); }
})();