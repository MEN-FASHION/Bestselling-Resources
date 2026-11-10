/* 20261111F · 实跑：渠道图独立读取（不依赖真实数据库，用假数据源跑真实代码） */
import fs from "node:fs";
import vm from "node:vm";
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

const ROWS = [
  /* 渠道图：月份写成「2026年11月」、站点为空 */
  { id: 1, period_type: "month", period_label: "2026年11月", category: "套装", site: "", image_url: "u1", channel: "Pinterest" },
  { id: 2, period_type: "month", period_label: "2026-11", category: "套装", site: "", image_url: "u2", channel: "" },
  { id: 3, period_type: "month", period_label: "202611", category: "套装", site: "", image_url: "u3", channel: "SHEIN" },
  /* 上个月的渠道图：不该混进来 */
  { id: 4, period_type: "month", period_label: "2026-10", category: "套装", site: "", image_url: "u4", channel: "Pinterest" },
  /* 榜单表格导入的图：没有渠道 */
  { id: 5, period_type: "month", period_label: "2026-11", category: "套装", site: "美国", image_url: "b1", channel: "" },
  /* 别的类目 */
  { id: 6, period_type: "month", period_label: "2026-11", category: "长裤", site: "", image_url: "u6", channel: "TEMU" },
  /* 周度数据：不参与 */
  { id: 7, period_type: "week", period_label: "2026-W45", category: "套装", site: "", image_url: "u7", channel: "Pinterest" },
];

function builder() {
  let table = "", op = {};
  const api = {
    select() { return api; },
    eq(k, v) { op[k] = v; return api; },
    in(k, v) { op["in_" + k] = v; return api; },
    neq() { return api; },
    order() { return api; },
    range(a, b) {
      let rows = ROWS.filter((r) => r.period_type === "month");
      if (table === "site_settings") return { data: [{ id: 1, frontend_dims: { rank_channel_map: { u2: "Amazon" } } }], error: null };
      if (op.period_type) rows = rows.filter((r) => r.period_type === op.period_type);
      if (op.category) rows = rows.filter((r) => r.category === op.category);
      if (op["in_category"]) rows = rows.filter((r) => op["in_category"].includes(r.category));
      return { data: rows.slice(a, b + 1), error: null };
    },
    maybeSingle() { return { data: { id: 1, frontend_dims: { rank_channel_map: { u2: "Amazon" } } }, error: null }; },
    then(res) { return Promise.resolve({ data: [], error: null }).then(res); },
  };
  return { from(t) { table = t; op = {}; return api; } };
}
const window = {
  supabase: { createClient: () => builder(), auth: { getSession: async () => ({ data: { session: null } }) } },
  CONFIG: { SUPABASE: { url: "http://x", key: "k" } },
};
const ctx = vm.createContext({ window, document: {}, console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array, RegExp, Error });
vm.runInContext(fs.readFileSync("js/supabase.js", "utf8").replace("const SB = (() =>", "globalThis.SB = (() =>"), ctx);
const SB = ctx.SB;

console.log("一、渠道图独立读取");
const rows = await SB.listRankChannelPics({ periodType: "month", category: "套装", periods: ["2026-11"] });
console.log("  实际条数:", rows.length, rows.map(r=>[r.image_url,r.period_label,r.channel]));
ok(rows.length === 3, "取到 3 张（月份三种写法都认，上个月与周度不混入）");
ok(rows.every((r) => String(r.channel || "").trim()), "每张都有渠道（其中一张来自归属字典）");
ok(rows.some((r) => r.channel === "Amazon"), "字典里的归属也生效");
ok(!rows.some((r) => r.site === "美国"), "榜单表格导入的图不会混进渠道批");

console.log("二、月份归一与同月判断");
ok(SB._normMonth("2026年3月") === "2026-03", "2026年3月 → 2026-03");
ok(SB._normMonth("202603") === "2026-03", "202603 → 2026-03");
ok(SB._normMonth("2026-W45") === "2026-W45", "周次原样保留");
ok(SB._sameMonth("2026年11月", "2026-11") === true, "两种写法视为同月");
ok(SB._sameMonth("2026-11", "2026-12") === false, "不同月不相等");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
