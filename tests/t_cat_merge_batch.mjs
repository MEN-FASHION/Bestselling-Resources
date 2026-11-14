/* 20261114J · 「合并类目提示成功、前台还是有个旧类目」的根因自检
 *
 * 事故现象：
 *   类目清理里把「工装」合并到「工装裤」，界面看起来做完了，
 *   但类目清单里「工装」还在，前台左侧菜单也还挂着一个「工装」。
 *   控制台里能看到一条 400：
 *     rank_batches?select=id,source&category=eq.工装
 *
 * 根因（两层）：
 *   1) 批次表的 source 列是后补的，补列脚本没跑时整条查询被数据库拒成 400；
 *   2) 删除批次那一步把错误吞掉了 —— 条目迁走了、批次台账还在。
 *      而前台类目菜单是按 rank_batches 聚合的，台账不删，菜单就不会消失。
 *   （顺带：探测「有没有 source 列」时问的是 rank_items，两张表补列进度不一致时必然错判。）
 *
 * 本测试用一个「rank_batches 没有 source 列」的假库真跑数据层，断言：
 *   - 对照组：直接 select("id, source") 确实被拒（证明缺陷可复现，不是空跑）；
 *   - 合并后条目全部迁到目标类目，源类目条目清零；
 *   - 合并后批次台账也清零（前台菜单才会消失）；
 *   - 台账清不掉时必须报错，不许假装成功；
 *   - 目标类目已有同一张图时按图片地址去重；
 *   - 批次表有 source 列时，只删本域的批次，别把别的专区同名类目连坐。
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "js/supabase.js"), "utf8");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

/* ---------- 假库：够用即可，但列校验必须是真的 ---------- */
function makeDb(opts) {
  const o = opts || {};
  const db = {
    rank_items: (o.items || []).map((r) => Object.assign({}, r)),
    rank_batches: (o.batches || []).map((r) => Object.assign({}, r)),
    cols: {
      rank_items: ["id", "image_url", "title", "category", "leaf_category", "site", "period_label",
        "period_type", "ratio", "abs_delta", "rank_abs", "channel", "created_at"].concat(o.noItemSource ? [] : ["source"]),
      rank_batches: ["id", "period_type", "period_label", "category", "site", "rows", "skipped", "created_at"]
        .concat(o.batchSource ? ["source"] : []),
    },
    seq: 1000,
    __opts: o,
  };
  return db;
}

function missErr(table, col) {
  return { message: "Could not find the '" + col + "' column of '" + table + "' in the schema cache" };
}

function makeClient(db) {
  const parseCols = (cols) => String(cols || "*").split(",").map((s) => s.trim()).filter(Boolean);

  function run(q) {
    const cols = db.cols[q.table] || [];
    /* 列校验：真实 PostgREST 就是这么拒的 */
    if (q.op === "select" && q.cols !== "*") {
      const bad = parseCols(q.cols).find((c) => cols.indexOf(c) < 0);
      if (bad) return { data: null, error: missErr(q.table, bad) };
    }
    if (q.op === "insert") {
      const rows = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((r) => {
        const bad = Object.keys(r).find((k) => cols.indexOf(k) < 0);
        if (bad) return { __bad: bad };
        return r;
      });
      const bad = rows.find((r) => r && r.__bad);
      if (bad) return { data: null, error: missErr(q.table, bad.__bad) };
    }

    const rowsOf = () => db[q.table];
    const match = (r) => q.conds.every((c) => {
      const v = r[c.col];
      if (c.k === "eq") return String(v == null ? "" : v) === String(c.v);
      if (c.k === "neq") return String(v == null ? "" : v) !== String(c.v);
      if (c.k === "in") return c.v.map(String).indexOf(String(v)) >= 0;
      if (c.k === "or") return c.v.some((p) => {
        const pv = r[p.col];
        return p.k === "eq" ? String(pv == null ? "" : pv) === String(p.v) : p.k === "isnull" ? (pv == null || pv === "") : false;
      });
      return true;
    });

    if (q.op === "select") {
      let list = rowsOf().filter(match);
      if (q.count === "exact") return { data: null, count: list.length, error: null };
      if (q.orderBy) list = list.slice().sort((a, b) => (a[q.orderBy] > b[q.orderBy] ? 1 : -1));
      if (q.from != null) list = list.slice(q.from, q.to + 1);
      if (q.lim != null) list = list.slice(0, q.lim);
      const out = q.cols === "*" ? list.map((r) => Object.assign({}, r))
        : list.map((r) => { const o = {}; parseCols(q.cols).forEach((c) => { o[c] = r[c]; }); return o; });
      return { data: out, error: null };
    }
    if (q.op === "insert") {
      const rows = q.payload;
      const news = (Array.isArray(rows) ? rows : [rows]).map((r) => {
        const row = Object.assign({}, r, { id: ++db.seq });
        db[q.table].push(row);
        return { id: row.id };
      });
      return { data: news, error: null };
    }
    if (q.op === "delete") {
      if (db.__opts && db.__opts.stuckDelete && q.table === "rank_batches") return { data: null, error: null };
      const keep = rowsOf().filter((r) => !match(r));
      db[q.table] = keep;
      return { data: null, error: null };
    }
    if (q.op === "update") {
      rowsOf().filter(match).forEach((r) => Object.assign(r, q.payload));
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }

  function from(table) {
    const q = { table, op: "select", cols: "*", conds: [], lim: null, from: null, to: null,
      orderBy: null, count: null, payload: null };
    const api = {
      select(cols, opt) {
        if (q.op !== "insert" && q.op !== "update" && q.op !== "delete") q.op = "select";
        q.cols = cols || "*";
        if (opt && opt.count) q.count = opt.count;
        return api;
      },
      insert(payload) { q.op = "insert"; q.payload = payload; return api; },
      update(payload) { q.op = "update"; q.payload = payload; return api; },
      delete() { q.op = "delete"; return api; },
      eq(col, v) { q.conds.push({ k: "eq", col, v }); return api; },
      neq(col, v) { q.conds.push({ k: "neq", col, v }); return api; },
      in(col, v) { q.conds.push({ k: "in", col, v }); return api; },
      is(col, v) { q.conds.push({ k: "isnull", col, v }); return api; },
      or(expr) {
        /* 只支持 source.eq.rank,source.is.null 这种形态 */
        const parts = String(expr).split(",").map((s) => {
          const m = s.trim().match(/^([A-Za-z0-9_]+)\.(eq|is)\.(.*)$/);
          return m ? { k: m[2] === "is" ? "isnull" : "eq", col: m[1], v: m[3] } : null;
        }).filter(Boolean);
        q.conds.push({ k: "or", v: parts });
        return api;
      },
      order(col) { q.orderBy = col; return api; },
      limit(n) { q.lim = n; return api; },
      range(a, b) { q.from = a; q.to = b; return api; },
      then(res) { return Promise.resolve(run(q)).then(res); },
    };
    return api;
  }
  return { from };
}

function loadSB(db) {
  const client = makeClient(db);
  const sandbox = {
    console,
    Promise, JSON, Object, Array, String, Number, Date, Math, isFinite, isNaN,
    setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: "", href: "", search: "" },
    document: { createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }) },
  };
  sandbox.window = sandbox;
  sandbox.CONFIG = { SUPABASE: { url: "https://demo.supabase.co", anonKey: "anon" } };
  sandbox.supabase = { createClient: () => client };
  const ctx = vm.createContext(sandbox);
  const api = vm.runInContext(SRC + "\n;SB;", ctx);
  return api;
}

function itemsOf(db, cat) {
  return db.rank_items.filter((r) => r.category === cat);
}

/* ---------- 场景 1：批次表没有 source 列（就是现在的线上库） ---------- */
console.log("一、缺 source 列的库：合并必须连台账一起清掉");
{
  const db = makeDb({
    items: [
      { id: 1, image_url: "u1", category: "工装", period_label: "第43周", period_type: "week", site: "美国", source: "rank" },
      { id: 2, image_url: "u2", category: "工装", period_label: "第43周", period_type: "week", site: "美国", source: "rank" },
      { id: 3, image_url: "u3", category: "工装", period_label: "第44周", period_type: "week", site: "美国", source: "rank" },
      { id: 4, image_url: "u4", category: "工装", period_label: "第45周", period_type: "week", site: "美国", source: null },
      { id: 5, image_url: "p1", category: "工装裤", period_label: "第43周", period_type: "week", site: "美国", source: "rank" },
    ],
    batches: [
      { id: "b1", period_type: "week", period_label: "第43周", category: "工装", rows: 0, site: "美国" },
      { id: "b2", period_type: "week", period_label: "第44周", category: "工装", rows: 0, site: "美国" },
      { id: "b3", period_type: "week", period_label: "第45周", category: "工装", rows: 0, site: "美国" },
      { id: "b4", period_type: "week", period_label: "第43周", category: "工装裤", rows: 0, site: "美国" },
    ],
    batchSource: false,
  });
  const SB = loadSB(db);

  /* 对照组：证明这条查询确实会被拒 —— 旧代码就是在这里把错误吞掉的 */
  let ctlErr = null;
  {
    const client = makeClient(db);
    const r = await client.from("rank_batches").select("id, source").eq("category", "工装");
    ctlErr = r.error;
  }
  ok(!!ctlErr, "对照组：缺列时 select(\"id, source\") 会被数据库拒绝（缺陷可复现）");
  ok(/source/.test(String(ctlErr && ctlErr.message)), "对照组：报错确实指向 source 列");

  ok((await SB.rankBatchSourceColumn()) === false, "探测结果：批次表没有 source 列");
  ok((await SB.rankSourceColumn()) === true, "探测结果：条目表有 source 列（两张表要分开问）");

  const cats0 = await SB.listRankCategories("rank");
  const g0 = cats0.find((c) => c.category === "工装");
  ok(!!g0 && g0.batches === 3, "合并前「工装」有 3 个批次");
  ok((await SB.countRankCategory("工装", "rank")) === 4, "合并前「工装」真实 4 条（不是台账里的 0 条）");

  const moved = await SB.renameRankCategory("工装", "工装裤", "rank");
  ok(moved === 4, "迁移 4 条（台账 0 条不影响迁移）");
  ok(itemsOf(db, "工装").length === 0, "源类目条目已清空");
  ok(itemsOf(db, "工装裤").length === 5, "目标类目 5 条");
  ok(db.rank_batches.filter((b) => b.category === "工装").length === 0, "批次台账已清空（前台菜单才会消失）");

  const cats1 = await SB.listRankCategories("rank");
  ok(!cats1.some((c) => c.category === "工装"), "类目清单里不再有「工装」");
  ok(!!cats1.find((c) => c.category === "工装裤"), "目标类目「工装裤」仍在");
  ok((await SB.countRankCategory("工装裤", "rank")) === 5, "合并后目标类目真实 5 条");
}

/* ---------- 场景 2：目标类目已有同一张图 → 按图片地址去重 ---------- */
console.log("二、重复图自动跳过");
{
  const db = makeDb({
    items: [
      { id: 1, image_url: "same", category: "工装", period_label: "第43周", period_type: "week", site: "美国", source: "rank" },
      { id: 2, image_url: "only", category: "工装", period_label: "第43周", period_type: "week", site: "美国", source: "rank" },
      { id: 3, image_url: "same", category: "工装裤", period_label: "第43周", period_type: "week", site: "美国", source: "rank" },
    ],
    batches: [{ id: "b1", period_type: "week", period_label: "第43周", category: "工装", rows: 0, site: "美国" }],
    batchSource: false,
  });
  const SB = loadSB(db);
  const moved = await SB.renameRankCategory("工装", "工装裤", "rank");
  ok(moved === 1, "只迁 1 条新的，重复的那张不再插一份");
  ok(itemsOf(db, "工装裤").length === 2, "目标类目 2 条，没有重复");
  ok(itemsOf(db, "工装").length === 0, "源类目清空");
  ok(db.rank_batches.filter((b) => b.category === "工装").length === 0, "台账清空");
}

/* ---------- 场景 3：台账清不掉时必须报错，不许假装成功 ---------- */
console.log("三、台账删不掉要报错");
{
  const db = makeDb({
    items: [{ id: 1, image_url: "u1", category: "工装", period_label: "第43周", period_type: "week", site: "美国", source: "rank" }],
    batches: [{ id: "b1", period_type: "week", period_label: "第43周", category: "工装", rows: 0, site: "美国" }],
    batchSource: false,
    stuckDelete: true,
  });
  const SB = loadSB(db);
  let caught = "";
  try { await SB.renameRankCategory("工装", "工装裤2", "rank"); } catch (e) { caught = String((e && e.message) || ""); }
  ok(!!caught, "台账残留时必须抛错，不能静默返回成功");
  ok(/批次台账没删掉/.test(caught), "报错说清楚是台账没删掉，而不是含糊的失败");
  ok(/已把 1 条并入/.test(caught), "报错同时说明条目其实已经迁走了");
  ok(db.rank_batches.length === 1, "台账确实还在（模拟场景有效）");
  ok(!!SB._lastCatMerge && SB._lastCatMerge.left === 1, "残留数被记下来，便于排查");
}

/* ---------- 场景 4：批次表有 source 列时，只删本域 ---------- */
console.log("四、有 source 列时按域合并，别的专区同名类目不连坐");
{
  const db = makeDb({
    items: [
      { id: 1, image_url: "a", category: "工装", period_label: "第43周", period_type: "week", site: "美国", source: "rank" },
      { id: 2, image_url: "b", category: "工装", period_label: "2026年10月", period_type: "month", site: "", source: "rhythm" },
    ],
    batches: [
      { id: "b1", period_type: "week", period_label: "第43周", category: "工装", rows: 1, site: "美国", source: "rank" },
      { id: "b2", period_type: "month", period_label: "2026年10月", category: "工装", rows: 1, site: "", source: "rhythm" },
    ],
    batchSource: true,
  });
  const SB = loadSB(db);
  ok((await SB.rankBatchSourceColumn()) === true, "探测结果：批次表有 source 列");
  const moved = await SB.renameRankCategory("工装", "工装裤", "rank");
  ok(moved === 1, "只迁趋势上升榜那 1 条");
  ok(db.rank_items.filter((r) => r.source === "rhythm").length === 1, "上新节奏那条原样不动");
  ok(db.rank_batches.filter((b) => b.source === "rhythm").length === 1, "上新节奏的批次原样不动");
  ok(db.rank_batches.filter((b) => b.source === "rank").length === 0, "趋势上升榜的批次已删");
}

/* ---------- 场景 5：整类删除同理 ---------- */
console.log("五、整类删除也不能被缺列卡住");
{
  const db = makeDb({
    items: [
      { id: 1, image_url: "a", category: "工装", period_label: "第43周", period_type: "week", site: "美国", source: "rank" },
      { id: 2, image_url: "b", category: "工装", period_label: "第44周", period_type: "week", site: "美国", source: "rank" },
    ],
    batches: [
      { id: "b1", period_type: "week", period_label: "第43周", category: "工装", rows: 1, site: "美国" },
      { id: "b2", period_type: "week", period_label: "第44周", category: "工装", rows: 1, site: "美国" },
    ],
    batchSource: false,
  });
  const SB = loadSB(db);
  const r = await SB.deleteRankCategory("工装", "rank");
  ok(r.items === 2 && r.batches === 2, "删掉 2 条 + 2 个批次");
  ok(itemsOf(db, "工装").length === 0, "条目清空");
  ok(db.rank_batches.filter((b) => b.category === "工装").length === 0, "台账清空");
}

/* ---------- 六、源码层面锁死：批次查询不许再用条目表的探测结果 ---------- */
console.log("六、源码约束");
{
  const src = SRC;
  ok(/async rankBatchSourceColumn\(\)/.test(src), "有批次表专用的列探测");
  ok(/select\(bSrcOk \? "id, source" : "id"\)/.test(src), "合并/删除按批次表结构取列");
  ok(!/from\("rank_batches"\)\.select\("id, source"\)\.eq\("category", a\)/.test(src), "不再写死带 source 的批次查询");
  ok(/this\._lastCatMerge = /.test(src), "合并结果会留痕（迁移数 / 批次删除数 / 残留数）");
  ok(/还有 " \+ left\.length/.test(src), "台账没删干净会明确报错，不静默成功");
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
