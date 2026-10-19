/* ============================================================
 * 统计脚本静态检查（tools/verify_sql.js）
 * ------------------------------------------------------------
 * 背景（2026-10-16 生产故障）：
 *   超管打开数据看板，接口返回 HTTP 400 + 错误码 42803。
 *   根因：admin_dashboard() 里"地区分布"那段用了 `group by 1, 2, 3`，
 *   而该子查询的 select 列表只有「1 列」（jsonb_build_object(...) as x）。
 *   PostgreSQL 文档规定：group by 里的序号指的是**输出列（select 列表项）的位置**，
 *   因此 group by 2 会因为"select 列表里没有第 2 列"直接报 42803（grouping_error）。
 *
 *   为什么此前没被发现：PL/pgSQL 函数在 CREATE 时**只做语法检查**，
 *   这类语义错误只在**函数被调用（首次执行）时**才抛出。
 *   → 所以"函数是否存在"的自检会显示已建好，而一调用就 400，极具迷惑性。
 *
 * 本脚本做的检查：
 *   ① 全文件扫描 `group by <序号>`，按「所属 select 列表的列数」校验序号是否越界
 *      （这正是本次故障的成因，可拦住同类回归）；
 *   ② 每个 create function 必须有配套的 grant execute（避免"函数在却调不动"）；
 *   ③ 脚本头部版本号必须与函数返回的 meta.script 版本号一致（避免版本漂移）。
 *
 * ⚠️ 局限说明：本脚本是**静态检查**，不连接数据库。
 *    本次沙箱内没有可用的 PostgreSQL 实例（内部源也没有相应依赖包），
 *    因此改用「官方文档确认规则 + 静态检查拦截」的方式把关；
 *    真正执行时是否还报错，由 SQL Editor 里那条一句话验证（见交付说明）来确认。
 *
 * 运行：node tools/verify_sql.js [待检查文件，默认 tools/setup_analytics.sql]
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "setup_analytics.sql");

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name + (extra ? " → " + extra : "")); console.log("  ✗ " + name + (extra ? " → " + extra : "")); }
}

/* ---------- 1. 去注释 / 去字符串字面量（保留 $$ 函数体内容，否则看不见函数内部） ---------- */
function sanitize(src) {
  let out = "", i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    // 行注释
    if (c === "-" && c2 === "-") { while (i < n && src[i] !== "\n") i++; continue; }
    // 块注释
    if (c === "/" && c2 === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    // 字符串字面量：整段吞掉（其中的逗号/括号会干扰列数统计）
    if (c === "'") {
      i++;
      while (i < n) { if (src[i] === "'" && src[i + 1] === "'") { i += 2; continue; } if (src[i] === "'") { i++; break; } i++; }
      out += " '' ";
      continue;
    }
    // 美元引用标记（$$ 或 $tag$）：只吞掉标记本身，**保留内部函数体**，否则查不到函数内的隐患
    if (c === "$") {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(src.slice(i));
      if (m) { out += " "; i += m[0].length; continue; }
    }
    out += c; i++;
  }
  return out;
}

/* ---------- 2. 分词 ---------- */
function tokenize(s) {
  const re = /[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|\(|\)|,|;/g;
  const toks = [];
  let m;
  while ((m = re.exec(s)) !== null) toks.push({ v: m[0], i: m.index });
  return toks;
}

const BOUNDARY = new Set(["where", "having", "order", "limit", "union", "except", "intersect",
  "returning", "window", "fetch", "for", "group"]);

/* 取 group by 子句的 token 范围；返回 {start,end} 或 null */
function clauseEnd(toks, start) {
  let depth = 0;
  for (let k = start; k < toks.length; k++) {
    const t = toks[k].v.toLowerCase();
    if (t === "(") depth++;
    else if (t === ")") { if (depth === 0) return k; depth--; }
    else if (t === ";" && depth === 0) return k;
    else if (depth === 0 && BOUNDARY.has(t)) return k;
  }
  return toks.length;
}

/* 找与 group by 同层级的 select，返回它的各个输出列（select 列表项）的 token 文本 */
function selectItemRange(toks, groupIdx) {
  let depth = 0;
  let sel = -1;
  for (let k = groupIdx - 1; k >= 0; k--) {
    const t = toks[k].v.toLowerCase();
    if (t === ")") depth++;
    else if (t === "(") { if (depth === 0) break; depth--; }
    else if (t === "select" && depth === 0) { sel = k; break; }
  }
  if (sel < 0) return null;
  let d = 0, start = sel + 1, items = [], sawFrom = false;
  for (let k = sel + 1; k < toks.length; k++) {
    const t = toks[k].v.toLowerCase();
    if (t === "(") d++;
    else if (t === ")") { if (d === 0) { items.push(toks.slice(start, k).map((x) => x.v).join(" ")); break; } d--; }
    else if (d === 0 && t === "from") { sawFrom = true; items.push(toks.slice(start, k).map((x) => x.v).join(" ")); break; }
    else if (d === 0 && t === ";") { items.push(toks.slice(start, k).map((x) => x.v).join(" ")); break; }
    else if (d === 0 && t === ",") { items.push(toks.slice(start, k).map((x) => x.v).join(" ")); start = k + 1; }
  }
  if (!sawFrom || !items.length) return null;
  return { items: items };
}

/* ---------- 3. 检查 ①：group by 序号越界 / 引用了含聚合的列 ---------- */
// 生产实况（2026-10-16）：数据库返回 42803 "aggregate functions are not allowed in GROUP BY"。
// 成因：`group by 1, 2, 3` 里的序号会被解析成「输出列」，而那个输出列
//       （jsonb_build_object('users', count(distinct user_id), ...)）内部含聚合函数，
//       于是数据库判定「GROUP BY 里不允许出现聚合函数」→ 报 42803。
//       另一种表现是序号超出 select 列表列数时报 "position N is not in select list"。
//       两种都是「用序号引用输出列」导致，统一在本检查里拦下。
const AGG_RE = /\b(count|sum|avg|min|max|jsonb_agg|json_agg|array_agg|string_agg|bool_and|bool_or|every|stddev|variance)\s*\(/i;

function checkGroupByOrdinals(toks) {
  let scanned = 0;
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].v.toLowerCase() !== "group") continue;
    if (!toks[k + 1] || toks[k + 1].v.toLowerCase() !== "by") continue;
    const from = k + 2;
    const to = clauseEnd(toks, from);
    if (to <= from) continue;
    const clause = toks.slice(from, to);
    // 只关心「纯序号」写法
    const onlyOrdinals = clause.every((t) => /^\d+$/.test(t.v) || t.v === ",");
    if (!onlyOrdinals) continue;
    const ords = clause.filter((t) => /^\d+$/.test(t.v)).map((t) => parseInt(t.v, 10));
    scanned++;
    const range = selectItemRange(toks, k);
    if (range) {
      const count = range.items.length;
      // ① 序号越界
      const bad = ords.filter((o) => o < 1 || o > count);
      if (bad.length) return { kind: "range", bad: bad, ords: ords, count: count, scanned: scanned };
      // ② 序号指向的那个输出列里含聚合函数
      const aggHit = ords.filter((o) => AGG_RE.test(range.items[o - 1] || ""));
      if (aggHit.length) return { kind: "aggregate", bad: aggHit, ords: ords, count: count, scanned: scanned };
    }
  }
  return { kind: "", bad: [], ords: [], count: null, scanned: scanned };
}

/* ---------- 4. 执行检查 ---------- */
console.log("== 统计脚本静态检查 ==");
console.log("文件：" + path.basename(target));

if (!fs.existsSync(target)) {
  console.error("找不到待检查文件");
  process.exit(2);
}
const raw = fs.readFileSync(target, "utf8");
const toks = tokenize(sanitize(raw));

console.log("\n[1] group by 序号写法（本次故障成因）");
const g = checkGroupByOrdinals(toks);
if (g.kind === "range") {
  ok(false, "group by 序号未越界",
    "序号 " + g.ords.join(",") + " 越界（该 select 只有 " + g.count + " 列）→ 调用时会报 42803 position N is not in select list");
} else if (g.kind === "aggregate") {
  ok(false, "group by 序号未指向含聚合函数的输出列",
    "序号 " + g.bad.join(",") + " 指向的输出列内含聚合函数 → 调用时会报 42803 aggregate functions are not allowed in GROUP BY");
} else {
  ok(true, "未发现用序号引用输出列的写法（扫描到 " + (g.scanned || 0) + " 处序号写法）");
}

console.log("\n[2] 地区分布分区是否已改为按表达式分组");
ok(!/group\s+by\s+1\s*,\s*2\s*,\s*3/i.test(sanitize(raw)),
  "不存在 `group by 1, 2, 3` 这类依赖输出列位置的写法");
ok(/group by coalesce\(nullif\(country/i.test(sanitize(raw).replace(/\s+/g, " ")),
  "地区分布已按 coalesce(...) 表达式分组（与 select 输出一致）");

console.log("\n[3] 函数授权是否配套（避免「函数在却调不动」）");
// 逐个函数扫描：拿到「函数名 + 返回类型」，用来判定是否为触发器函数
const defs = [...raw.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_][a-z0-9_]*)\s*\([^)]*\)\s*returns\s+([a-z_][a-z0-9_ ]*)/gi)]
  .map((m) => ({ name: m[1].toLowerCase(), ret: (m[2] || "").trim().toLowerCase() }));
const uniq = [...new Set(defs.map((d) => d.name))];
for (const f of uniq) {
  const ret = (defs.find((d) => d.name === f) || {}).ret || "";
  // 触发器函数只能由触发器调用，PostgREST 无法通过接口调用它，
  // 因此不要求（也不应该假装）授予 execute 权限。
  if (ret === "trigger") {
    ok(!new RegExp("grant\\s+execute\\s+on\\s+function\\s+public\\." + f + "\\s*\\(", "i").test(raw),
      "触发器函数 " + f + " 未授予 execute（触发器函数不能被接口调用，无需授权）");
    continue;
  }
  const re = new RegExp("grant\\s+execute\\s+on\\s+function\\s+public\\." + f + "\\s*\\(", "i");
  ok(re.test(raw), "函数 " + f + " 有 grant execute 授权");
}

console.log("\n[4] 版本号一致性");
const headVer = (raw.match(/版本：\s*(20\d{6}[A-Z])/) || [])[1];
const metaVer = (raw.match(/'script'\s*,\s*'(20\d{6}[A-Z])'/) || [])[1];
ok(!!headVer, "脚本头部标注了版本号", headVer || "未找到");
ok(!!metaVer, "统计接口返回的 meta 里标注了版本号", metaVer || "未找到");
ok(headVer && metaVer && headVer === metaVer,
  "两处版本号一致", "头部 " + headVer + " / meta " + metaVer);

console.log("\n[5] 接口缓存刷新");
ok(/notify\s+pgrst\s*,\s*'reload schema'/i.test(raw), "包含 notify pgrst reload schema（避免接口缓存不认识新函数）");

console.log("\n== 结果：" + pass + " 项通过，" + fail + " 项失败 ==");
if (fail) { console.log("失败项：\n - " + failures.join("\n - ")); process.exit(1); }
process.exit(0);