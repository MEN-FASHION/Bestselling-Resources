/* 20261111K · 控制台 400：列探测与批次枚举不再制造「必失败」的请求 */
import fs from "node:fs";
import vm from "node:vm";
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };
const S = fs.readFileSync("js/supabase.js", "utf8");

console.log("一、列探测不再必然报错");
ok(!/from\("rank_items"\)\.select\("channel"\)\.limit\(1\)/.test(S), "不再用「必失败」的探测请求（直接取 channel 列）");
ok(/select\("\*"\)\.limit\(1\)/.test(S), "改成取一行全字段判断有没有 channel 键");
ok(/hasOwnProperty\.call\(row, "channel"\)/.test(S), "按返回对象里是否存在该键判断");
ok(/已自动改用归属字典存储/.test(S), "没有这一列时给出明确说明而不是报错");

console.log("二、批次枚举按需取全字段");
ok(!/select\("period_type, period_label, category, site"\)/.test(S), "不再写死批次表的列名");
ok(/from\("rank_batches"\)\s*\n?\s*\.select\("\*"\)/.test(S) || /\.select\("\*"\)\s*\n?\s*\.order\("id"/.test(S), "批次分页读取改为全字段，缺列也不会整条被拒");

console.log("三、实跑：没有 channel 列也不发失败请求");
const asked = [];
const ROWS = [{ id: 1, image_url: "b1", period_label: "2026-11", period_type: "month", category: "套装", site: "美国" }];
function builder() {
  let op = {};
  const api = {
    select(cols) { op.cols = cols; asked.push(cols); return api; },
    eq() { return api; }, neq() { return api; }, in() { return api; },
    order() { return api; }, limit() { return api; },
    range(a, b) { return { data: ROWS.slice(a, b + 1), error: null }; },
    maybeSingle() { return { data: { id: 1, frontend_dims: {} }, error: null }; },
    then(res) { return Promise.resolve({ data: [], error: null }).then(res); },
  };
  return { from() { op = {}; return api; } };
}
const window = { supabase: { createClient: () => builder(), auth: { getSession: async () => ({ data: { session: null } }) } }, CONFIG: { SUPABASE: { url: "http://x", key: "k" } } };
const ctx = vm.createContext({ window, document: {}, console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array, RegExp, Error });
vm.runInContext(S.replace("const SB = (() =>", "globalThis.SB = (() =>"), ctx);
const SB = ctx.SB;
(async () => {
  const has = await SB.rankChannelColumn();
  ok(has === false, "返回对象里没有 channel 键 → 判定为无列");
  ok(SB.channelStorage() === "map", "自动切到「归属字典」存储，功能照常");
  ok(asked.indexOf("channel") < 0, "整个过程没有发出 select(channel) 这种必然 400 的请求");
  ok(await SB.rankChannelColumn() === false, "探测结果被记住，不会每次刷新都再问一次");
  console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})();
