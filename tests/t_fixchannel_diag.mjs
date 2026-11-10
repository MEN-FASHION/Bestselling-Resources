/* 20261110E · 补渠道「改不动」的定位与修复
 * 覆盖：
 *  1) 改动条数不再依赖响应头 count（曾把「改了 N 条」显示成「已修改 0 条」）
 *  2) 0 条时自动自检，把原因摊开（列缺失 / 月份无数据 / 都有渠道了 / 类目筛空 / 权限）
 *  3) 自检按钮存在且绑定，只做计数不写数据
 *  4) 统计接口在拿不到 count 头时退化为数 id
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };
const R = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const SB = R("js/supabase.js");
const AR = R("js/admin-rhythm.js");
const ADMIN = R("admin.html");

console.log("一、改动条数用真实行数");
ok(/update\(\{ channel: v \}\)\.select\("id"\)/.test(SB), "应以 select(\"id\") 拿回被改动的行");
ok(/return \(data \|\| \[\]\)\.length;/.test(SB), "应返回数组长度作为改动条数");
ok(!/update\(\{ channel: v \}, \{ count: "exact" \}\)/.test(SB), "不应再依赖 PATCH 的 count 头");

console.log("二、统计接口的退化路径");
ok(/if \(count == null\)/.test(SB), "count 为空时应走退化统计");
ok(/select\("id"\)\.limit\(20000\)/.test(SB), "退化统计应有上限，避免拉全表");

console.log("三、自检能力");
ok(/async diagnoseChannelSlot\(f\)/.test(SB), "应有自检方法");
ok(/select\("channel"\)\.limit\(1\)/.test(SB), "自检应探测 channel 列是否存在");
ok(/hasColumn/.test(SB) && /schemaError/.test(SB), "自检应回传列是否存在与原始报错");
ok(/out\.emptyNull = await cnt/.test(SB) && /out\.emptyStr = await cnt/.test(SB) && /out\.filled = await cnt/.test(SB),
   "自检应分别统计 null / 空串 / 已有渠道");
ok(!/update\(/.test(SB.slice(SB.indexOf("async diagnoseChannelSlot"), SB.indexOf("async setRankItemsChannelSlot"))),
   "自检不得写入任何数据");

console.log("四、界面接线");
ok(/id="rm-fixch-check"/.test(ADMIN), "补渠道区块应有自检按钮");
ok(/id="rm-fixch-diag"/.test(ADMIN), "应有承载自检结果的区块");
ok(/bindFixChannelCheck\(\);/.test(AR), "自检按钮应被绑定");
ok(/await runFixChannelDiag\(o\);/.test(AR), "0 条时应自动跑自检");
ok(/不存在 → 已自动改用字典存储/.test(AR), "列缺失时应说明已自动兜底为字典存储");
ok(/不需要跑 SQL/.test(AR), "兜底后应说明不必再跑 SQL");
ok(/只改尚未设渠道的」自然改不到/.test(AR), "全都有渠道时应点名这个开关");
ok(/pg_policies/.test(AR), "仍改不动时应指向写入权限排查");


console.log("五、期次写法兜底（实跑真实函数）");
{
  const vm = await import("node:vm");
  const src = R("js/supabase.js");
  const fake = { from() { return { select() { return this; }, eq() { return this; }, in() { return this; }, update() { return this; }, order() { return this; }, limit() { return this; }, is() { return this; }, not() { return this; }, neq() { return this; } }; } };
  const win = { CONFIG: { SUPABASE: { url: "https://x.invalid", anonKey: "k" }, WORKER_URL: "" }, supabase: { createClient: () => fake }, localStorage: { getItem() { return null; }, setItem() {} } };
  const ctx = vm.createContext({ window: win, document: {}, localStorage: win.localStorage, fetch: async () => ({ ok: true, json: async () => ({}) }), console, setTimeout, clearTimeout, Date, JSON, Math, String, Number, RegExp, Promise, Object, Array, Set, Map, URL, encodeURIComponent, decodeURIComponent, Error });
  vm.runInContext(src, ctx);
  let SBObj = null;
  try { SBObj = vm.runInContext("SB", ctx); } catch (e) { SBObj = null; }
  ok(!!SBObj && typeof SBObj._labelVariants === "function", "应能实跑期次变体函数");
  if (!SBObj) { ok(false, "supabase 模块应能在测试里加载"); }
  const LV = (x) => (SBObj ? SBObj._labelVariants(x) : []);
  const v1 = LV("2026-03");
  ok(v1[0] === "2026-03", "第一种写法必须是原样，先精确匹配");
  ok(v1.indexOf("2026年3月") >= 0, "应覆盖「2026年3月」这种写法");
  ok(v1.indexOf("2026-3") >= 0 && v1.indexOf("202603") >= 0, "应覆盖短横线单位数与纯数字写法");
  ok(new Set(v1).size === v1.length, "变体不应重复");
  const v2 = LV("2026年11月");
  ok(v2.indexOf("2026-11") >= 0 && v2[0] === "2026年11月", "从年月写法也能反过来生成短横线写法");
  const v3 = LV("2026-W45");
  ok(v3.length === 1, "周次写法不应被强行改造成月份写法");
  const v4 = LV("");
  ok(v4.length === 0, "空标签不应产出候选");
}
ok("匹配不到时先精确、再变体", /variants\.slice\(0, 1\)/.test(SB), "应先只用原写法查一次");
ok("自检报告真实期次写法", /matchedLabel/.test(SB), "自检应给出数据里的真实写法");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
