/* ============================================================================
 * t_dim_stat_paging.js —— 打标数据体检「面料 0 行」+ 看板 404 回归（20261102M）
 *
 * 症状一：导入页面体检说「库里共 1000 行打标记录」，且「面料」显示 0 行，
 *          却误报「这些维度目前一行都没有：面料」。
 * 根因：统计维度时用了一次 .limit(50000) 取全表，但服务端单次返回有行数上限，
 *       实际只读到前 1000 行；面料是后期才补写的维度，抽样没抽到就是 0。
 *
 * 症状二：打开数据看板，控制台打一条 404。
 * 根因：先调用一个从未建进库的统计函数，必然 404，再走兜底。
 *
 * 本测试用「服务端每次最多返回 1000 行」的桩模拟真实上限：
 *   ① 逐页读全后 total 是真实行数（2500），不是 1000
 *   ② 面料只出现在后 1000 行，统计必须能读到（不再显示 0）
 *   ③ 某一维整列为空时仍能正确报 0（不能把上限问题修好后误伤真 0）
 *   ④ 看板不再发起那个必然 404 的调用
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (d ? "  → " + d : ""))); };

const R = path.resolve(__dirname, "..");
const sbSrc = fs.readFileSync(path.join(R, "js/supabase.js"), "utf8");

/* ---------- 构造 2500 行打标记录：服务端单页上限 1000 ---------- */
const TOTAL = 2500;
const SERVER_CAP = 1000;          /* 关键：模拟服务端 max rows */
const allRows = [];
for (let i = 0; i < TOTAL; i++) {
  const r = { image_url: "u" + i, style_tags: ["工装"], visual_tags: [], element_tags: [],
    pattern_tags: [], struct_tags: [], fabric_tags: [], craft_tags: ["印花"],
    shoot_tags: ["平铺拍"], fit_tags: [], culture_tags: [], psych_tags: [], festival_tags: [] };
  /* 面料只在最后 800 行有值（模拟「前期没写、后期补写」） */
  if (i >= 1700) r.fabric_tags = ["纯棉（100%棉）"];
  /* 结构部件只在第 5 行有值 */
  if (i === 5) r.struct_tags = ["拉链"];
  /* 节日全表为空：验证真 0 仍报 0 */
  allRows.push(r);
}

let rpcCalls = [], rangeCalls = [];

function qb(table) {
  const st = { table, from: 0, to: -1 };
  const api = {
    select() { return api; },
    eq() { return api; }, in() { return api; }, order() { return api; }, limit() { return api; },
    range(from, to) {
      st.from = from; st.to = to;
      rangeCalls.push({ table, from, to });
      if (table !== "rank_image_tags") {
        return Promise.resolve({ data: [], error: null });
      }
      /* 服务端最多给 SERVER_CAP 行，且不超过请求区间 */
      const want = (to < 0 ? 1e9 : to - from + 1);
      const n = Math.min(want, SERVER_CAP);
      return Promise.resolve({ data: allRows.slice(from, from + n), error: null });
    },
    then(res) {
      /* 没有调用 .range 的查询：按服务端上限返回，模拟被截断 */
      if (table !== "rank_image_tags") return Promise.resolve({ data: [], error: null }).then(res);
      rangeCalls.push({ table, from: "no-range" });
      return Promise.resolve({ data: allRows.slice(0, SERVER_CAP), error: null }).then(res);
    },
  };
  return api;
}

global.window = global;
global.window.CONFIG = { WORKER_URL: "https://worker.example.com/", SUPABASE: { url: "https://abc.supabase.co", anonKey: "eyJhbGciOiJIUzI1NiJ9.eyJyZWYiOiJhYmMifQ.x" } };
global.window.supabase = {
  createClient: () => ({
    from: (t) => qb(t),
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async (name) => { rpcCalls.push(name); return { data: [], error: { message: "not found" } }; },
  }),
};
global.navigator = { userAgent: "node" };
global.document = { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) };

// eslint-disable-next-line no-eval
eval(sbSrc);
const SB = window.SB;
ok("数据层已加载", !!SB);

/* ---------------- 1. 逐页读全 ---------------- */
console.log("\n[1] 体检统计不再被单页上限截断");
(async function () {
  const r = await SB.statRankTagDims();

  ok("统计行数是真实全量 " + TOTAL, r.total === TOTAL, "实际 " + r.total);
  ok("确实翻了多页", rangeCalls.filter((c) => c.table === "rank_image_tags").length >= 3,
    "翻了 " + rangeCalls.filter((c) => c.table === "rank_image_tags").length + " 次");
  ok("没有出现「不指定区间」的查询（那样必被截断）",
    !rangeCalls.some((c) => c.from === "no-range"));

  /* ---------------- 2. 面料不再误报 0 ---------------- */
  console.log("\n[2] 面料（后期才补写的维度）");
  ok("面料有值行数 = 800", r.stat["面料"].n === 800, "实际 " + r.stat["面料"].n);
  ok("面料不再被列进「一行都没有」的那批", r.stat["面料"].n > 0);
  ok("结构部件 1 行仍能准确统计", r.stat["结构部件"].n === 1, "实际 " + r.stat["结构部件"].n);

  /* ---------------- 3. 真 0 仍然报 0（别误伤） ---------------- */
  console.log("\n[3] 真的空维度");
  ok("节日全表为空 → 仍报 0", r.stat["节日"].n === 0);
  ok("视觉全表为空 → 仍报 0", r.stat["视觉"].n === 0);
  ok("风格 2500 行全部有值", r.stat["风格"].n === TOTAL, "实际 " + r.stat["风格"].n);

  /* ---------------- 4. 看板不再打 404 ---------------- */
  console.log("\n[4] 数据看板 404");
  rpcCalls = [];
  const imgs = await SB.listDashboardImages();
  ok("不再调用那个必然失败的统计接口", rpcCalls.indexOf("dashboard_images") < 0,
    "调用记录：" + JSON.stringify(rpcCalls));
  ok("看板取数仍能返回数组（走兜底）", Array.isArray(imgs));

  /* ---------------- 5. 源码级约束 ---------------- */
  console.log("\n[5] 源码约束");
  ok("源码里已无 dashboard_images 调用", sbSrc.indexOf('rpc("dashboard_images")') < 0);
  ok("统计用 range 分页", /runPage\(|\.range\(from, to\)/.test(sbSrc));
  ok("有翻页上限保护（不会死循环）", /MAX_PAGES/.test(sbSrc));

  const impSrc = fs.readFileSync(path.join(R, "js/admin-rankimport.js"), "utf8");
  console.log("\n[6] 写入汇总覆盖三维");
  ok("汇总含图案类型", /pattern_tags: "图案类型"/.test(impSrc));
  ok("汇总含结构部件", /struct_tags: "结构部件"/.test(impSrc));
  ok("汇总含面料", /fabric_tags: "面料"/.test(impSrc));

  console.log("\n结果：通过 " + pass + "，失败 " + fail);
  process.exit(fail ? 1 : 0);
})();
