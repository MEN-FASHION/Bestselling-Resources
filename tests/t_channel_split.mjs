/* 20261111I · 月度榜单 + 其他渠道：两批严格分开（榜单不变，渠道只并排看图） */
import fs from "node:fs";
import vm from "node:vm";
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };
const R = fs.readFileSync("js/rhythm.js", "utf8");
const S = fs.readFileSync("js/supabase.js", "utf8");

const DIMS = {
  rank_channel_map: { b1: "Amazon" },
  rank_channel_pics: [
    { u: "c1", ch: "Pinterest", c: "套装", m: "2026-11" },
    { u: "c2", ch: "SHEIN", c: "套装", m: "2026年11月" },
    { u: "c3", ch: "Pinterest", c: "套装", m: "2026-10" },
    { u: "c4", ch: "TEMU", c: "长裤", m: "2026-11" },
  ],
};
const ROWS = [
  { id: 5, period_type: "month", period_label: "2026-11", category: "套装", site: "美国", image_url: "b1", title: "t1" },
  { id: 6, period_type: "month", period_label: "2026-11", category: "套装", site: "德国", image_url: "b2", title: "t2" },
];

function makeClient() {
  let table = "", op = {};
  const api = {
    select() { return api; }, eq(k, v) { op[k] = v; return api; },
    in(k, v) { op["in_" + k] = v; return api; }, neq() { return api; },
    limit() { return api; }, order() { return api; },
    range(a, b) {
      let rows = ROWS.slice();
      if (op.period_type) rows = rows.filter((r) => r.period_type === op.period_type);
      if (op.category) rows = rows.filter((r) => r.category === op.category);
      return { data: rows.slice(a, b + 1), error: null };
    },
    maybeSingle() { return { data: { id: 1, frontend_dims: DIMS }, error: null }; },
    then(res) { return Promise.resolve({ data: [], error: null }).then(res); },
  };
  return { from(t) { table = t; op = {}; return api; }, storage: { from() { return { upload: async () => ({ error: null }) }; } } };
}
const window = {
  supabase: { createClient: () => makeClient(), auth: { getSession: async () => ({ data: { session: null } }) } },
  CONFIG: { SUPABASE: { url: "http://x", key: "k" } },
};
const ctx = vm.createContext({ window, document: {}, console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array, RegExp, Error });
vm.runInContext(S.replace("const SB = (() =>", "globalThis.SB = (() =>"), ctx);
const SBX = ctx.SB;

console.log("一、榜单取数口径不变");
ok(!/filter\.channelMode\s*=\s*true/.test(R), "不再给榜单查询加渠道模式开关");
ok(!/allowEmptySite: true/.test(R), "不再为渠道对比放开空站点（榜单仍按站点取）");
ok(/var fBoard = Object\.assign\(\{\}, filter\);/.test(R), "榜单沿用同一套筛选条件");

console.log("二、两批严格分开");
ok(!/mergedItems/.test(R) && !/seenU/.test(R), "不再把渠道图与榜单条目合并成一个列表");
ok(/var CH_PICS = \[\];/.test(R), "渠道图单独存放");
ok(/items = \(items \|\| \[\]\)\.filter\(function \(it\) \{ return !_chUrl\[/.test(R), "渠道图不会同时出现在榜单列");
ok(/CH_PICS\.forEach\(function \(p\) \{/.test(R), "渠道列直接由渠道图生成");
ok(/渠道图没有环比 \/ 位次 \/ 国家/.test(R), "渠道卡片不带环比与位次");

console.log("三、数据层实跑");
(async () => {
  const ch = await SBX.listRankChannelPics({ periodType: "month", category: "套装", periods: ["2026-11"] });
  const urls = ch.map((p) => p.u || p.image_url);
  ok(urls.indexOf("c1") >= 0 && urls.indexOf("c2") >= 0, "两种月份写法都算本月");
  ok(urls.indexOf("c3") < 0, "上月渠道图不混入");
  ok(urls.indexOf("c4") < 0, "别的类目不混入");
  ok(urls.indexOf("b1") < 0 && urls.indexOf("b2") < 0, "榜单图不会出现在渠道批里");
  const board = await SBX.listRankItems({ periodType: "month", periods: ["2026-11"], sites: ["美国", "德国"], cols: ["image_url", "title"] });
  const burl = board.map((r) => r.image_url);
  ok(burl.length === 2 && burl.indexOf("b1") >= 0, "榜单列仍按站点取到 2 条");
  ok(burl.indexOf("c1") < 0 && burl.indexOf("c2") < 0, "渠道图不会混进榜单批");
  console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})();
