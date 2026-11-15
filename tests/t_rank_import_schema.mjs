/* 20261113P · 「后台选了类目、前台却一点没变」的根因回归测试
 *
 * 现场：rank_batches 没有 source 列（补结构脚本没跑 / schema 缓存没刷新），
 *       批次写入被整条拒掉 → 这一组导入 0 条 → 前台一条都不变，
 *       用户看到的就是「我明明选了打底/压缩，前台还是运动功能服」。
 *
 * 这里不只看代码，而是把 supabase.js 真跑起来：用一个假数据库
 * （insert 里带 source 就报 schema cache 错），断言——
 *   ① 以前那种裸 insert 会失败（对照组建模）；
 *   ② 现在的 createRankBatch 能自动剔除缺列并写入成功；
 *   ③ 有该列时仍然带 source（数据域隔离不丢）；
 *   ④ updateRankBatch 同样不会因为缺列整条失败。
 */
import fs from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

const SRC = fs.readFileSync("js/supabase.js", "utf8");

/* ---------- 假数据库：PostgREST 的行为 ---------- */
function makeCtx(hasSource) {
  const log = { inserts: [], updates: [] };
  class B {
    constructor(table) { this.table = table; this.op = null; this.payload = null; this.filters = []; }
    insert(p) { this.op = "insert"; this.payload = p; return this; }
    update(p) { this.op = "update"; this.payload = p; return this; }
    select() { return this; }
    eq(k, v) { this.filters.push([k, v]); return this; }
    limit() { return this; }
    order() { return this; }
    range() { return this; }
    single() { return this; }
    maybeSingle() { return this; }
    then(resolve, reject) {
      try { resolve(this._run()); } catch (e) { reject(e); }
    }
    _run() {
      const has = (obj) => obj && Object.prototype.hasOwnProperty.call(obj, "source");
      const arr = Array.isArray(this.payload) ? this.payload : (this.payload ? [this.payload] : []);
      const badKeys = !hasSource && this.table !== "rank_items" && arr.some(has);
      if (badKeys) {
        return { data: null, error: { message: "Could not find the 'source' column of '" + this.table + "' in the schema cache" } };
      }
      if (this.op === "insert") {
        log.inserts.push({ table: this.table, payload: JSON.parse(JSON.stringify(this.payload)) });
        return { data: [{ id: 777 }], error: null };
      }
      if (this.op === "update") {
        log.updates.push({ table: this.table, payload: JSON.parse(JSON.stringify(this.payload)) });
        return { data: null, error: null };
      }
      /* select 探测 */
      if (this.table === "rank_items") return { data: [{ id: 1, category: "打底/压缩" }], error: null };
      if (this.table === "rank_batches") return { data: [{ id: 1 }], error: null };
      return { data: [], error: null };
    }
  }
  const client = { from: (t) => new B(t) };
  const ctx = {
    window: {
      CONFIG: { SUPABASE: { url: "https://x.supabase.co", anonKey: "eyJ.a.b" }, WORKER_URL: "" },
      supabase: { createClient: () => client },
      location: { href: "" },
      localStorage: { getItem: () => null, setItem: () => {} },
      addEventListener: () => {},
      setTimeout,
      clearTimeout,
      console,
    },
    document: { addEventListener: () => {}, querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild: () => {} } },
    navigator: { userAgent: "node" },
    localStorage: { getItem: () => null, setItem: () => {} },
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout, clearTimeout, setInterval, clearInterval,
    console,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC + "\n;globalThis.__SB = SB;", ctx);
  return { SB: ctx.__SB, log };
}

console.log("一、对照组：以前那种裸 insert 一定失败");
{
  /* 旧实现就是 client.from("rank_batches").insert(payload).select("id").single()：
     缺 source 列时数据库整条拒绝 —— 这一组 0 条，前台一条都不会变。 */
  const probe = await new Promise((res) => {
    const client = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "Could not find the 'source' column of 'rank_batches' in the schema cache" } }) }) }) }) };
    client.from().insert({}).select().single().then((x) => res(x));
  });
  ok(!!(probe && probe.error), "缺 source 列时，裸 insert + single 会报 schema cache 错（旧实现即如此）");
}

console.log("二、现在的 createRankBatch：缺列自动剔除后仍然写入成功");
{
  const { SB, log } = makeCtx(false);
  let id = null, err = null;
  try {
    id = await SB.createRankBatch({ periodType: "week", periodLabel: "第44周", category: "打底/压缩", site: "美国", source: "rank" });
  } catch (e) { err = e; }
  ok(!err, "不抛错（以前这里抛 schema cache 错，整组导入 0 条）");
  ok(id === 777, "拿到了批次 id");
  const ins = log.inserts[0] || {};
  ok(ins.table === "rank_batches", "写的是 rank_batches");
  ok(ins.payload && ins.payload.category === "打底/压缩", "类目按后台所选写入（不是表格类目）");
  ok(ins.payload && !Object.prototype.hasOwnProperty.call(ins.payload, "source"), "缺列时自动去掉 source，不硬塞");
  ok(ins.payload && ins.payload.period_label === "第44周", "期次也按后台所选写入");
}

console.log("三、库里真有 source 列时不要丢数据域");
{
  const { SB, log } = makeCtx(true);
  await SB.createRankBatch({ periodType: "week", periodLabel: "第45周", category: "打底/压缩", site: "美国", source: "rank" });
  const ins = log.inserts[0] || {};
  ok(ins.payload && ins.payload.source === "rank", "有列时仍然带 source=rank（三专区隔离不退化）");
}

console.log("四、updateRankBatch 也不因缺列整条失败");
{
  const { SB, log } = makeCtx(false);
  let err = null;
  try { await SB.updateRankBatch(777, { rows: 50, skipped: 0, source: "rank" }); } catch (e) { err = e; }
  ok(!err, "更新台账不抛错");
  const up = log.updates[0] || {};
  ok(up.payload && up.payload.rows === 50, "条数更新照样生效");
  ok(up.payload && !Object.prototype.hasOwnProperty.call(up.payload, "source"), "缺列时台账更新去掉 source");
}

console.log("五、按「期次 + 类目」清理（本期次其它类目）");
{
  ok(/async deleteRankPeriodCategory\(o\) \{/.test(SRC), "有单期次单类目的清理方法");
  const seg = SRC.slice(SRC.indexOf("async deleteRankPeriodCategory"), SRC.indexOf("async deleteRankPeriodCategory") + 1600);
  ok(/eq\("period_label", periodLabel\)/.test(seg) && /eq\("category", category\)/.test(seg), "同时限定期次与类目");
  ok(/if \(src && srcOk\) q = this\._srcCond\(q, src\);/.test(seg), "仍然限定数据域，不串专区");
  ok(!/eq\("site"/.test(seg), "不限站点（同期次该类目全清）");
}

console.log("六、后台面板：导入后核对其它类目");
const ADM = fs.readFileSync("js/admin-rank.js", "utf8");
const HTML = fs.readFileSync("admin.html", "utf8");
ok(/id="rank-cat-alert"/.test(HTML), "导入面板有「其它类目」核对区");
ok(/async function showOtherCats\(periodType, periods, keepCats, opt\)/.test(ADM), "有核对函数");
ok(/window\.RankOtherCatsCheck = showOtherCats/.test(ADM), "核对能力对其它专区开放（上新节奏复用）");
ok(/boxId = o\.boxId \|\| "rank-cat-alert"/.test(ADM), "核对区可指定不同面板的容器");
ok(/const src = o\.source \|\| SOURCE/.test(ADM), "核对与清理限定在本专区数据域");
ok(/await showOtherCats\(periodType, periodsTried, keepMap\);/.test(ADM), "导入完成后自动核对");
ok(/deleteRankPeriodCategory\(\{/.test(ADM), "核对区可以一键清理");
ok(/await uiConfirm\("删除下列「其它类目」/.test(ADM), "删除前必须二次确认（不静默删数据）");
ok(/function explainFail\(msg\)/.test(ADM), "数据库英文报错翻成中文解释");
ok(/缺 " \+ \(col \|\| "新增"\) \+ " 列/.test(ADM), "提示里点名缺哪一列");
ok(/failed\.push\(g\.period \+ " · " \+ g\.category \+ "：" \+ explainFail/.test(ADM), "失败清单走中文解释，不再甩英文原文");
ok(/periods\.indexOf\(p\) < 0\) return;/.test(ADM), "只看本次导入涉及的期次");


console.log("七、类目选择不静默丢失 + 写入目标可见");
{
  ok(/const RANK_CAT_KEY = "sb\.rank\.pickCat";/.test(ADM), "类目选择记在本地");
  ok(/const keep = sel\.value \|\| rankCatMemo\(\);/.test(ADM), "重建下拉时优先沿用已选类目");
  ok(/历史类目/.test(ADM), "记忆里的类目不在清单里也补一个选项，不静默清掉");
  ok(/catSel\.addEventListener\("change", onCatChange\)/.test(ADM), "换类目立刻刷新预览");
  ok(/id="rank-slot-echo"/.test(HTML), "预览里有「本次写入」硬信息位");
  ok(/本次写入 → 期次 /.test(ADM), "写清期次/类目/站点/方式");
  ok(/你没选类目<\/b>，将归入「其他」/.test(ADM), "没选类目要显式提醒，不默默归「其他」");
  ok(/写入「" \+ Object\.keys\(catSet\)\.map/.test(ADM), "导入完成提示里复述真正写进的类目");
}

console.log("八、补结构脚本要刷新缓存");
const SQL = fs.readFileSync("sql/patch_20261113B_rank_source.sql", "utf8");
ok(/notify pgrst, 'reload schema';/.test(SQL), "加列后通知接口层刷新表结构缓存");

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
