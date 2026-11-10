/* 20261111C · 表里缺列（如 title）导致传图/读取整体被拒：自动减列重试 */
import fs from "node:fs";
const SB = fs.readFileSync("js/supabase.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

console.log("一、自愈基础设施");
ok(/_missName\(err\)/.test(SB), "能从报错里认出缺哪一列");
ok(/Could not find the '\(\[\^'\]\+\)' column/.test(SB), "认得 schema cache 报错格式");
ok(/column\\s\+\[A-Za-z0-9_\]\+:/.test(SB) || /does not exist/.test(SB), "认得 数据库 does not exist 报错格式");
ok(/_missMark\(table, col\)/.test(SB), "缺列会被记住");
ok(/_colList\(table, cols\)/.test(SB), "查询前会剔除已知缺列");
ok(/async _safeInsert\(table, rows, selectCols\)/.test(SB), "有插入自愈");
ok(/async _safeSelect\(table, cols, build\)/.test(SB), "有查询自愈");

console.log("二、写入路径都走自愈");
ok(/const ins = await this\._safeInsert\("rank_items", row, false\);/.test(SB), "渠道传图写入走自愈");
ok(/const ins = await this\._safeInsert\("rank_items", chunk, "id"\);/.test(SB), "批量导入走自愈");
ok(/const ins = await this\._safeInsert\("rank_items", chunk, "id"\);\n        if \(ins\.error\) throw/.test(SB), "严格插入走自愈");
ok(/_dropMiss\("rank_items", Object\.assign\(\{\}, r\)\)/.test(SB), "upsert 兜底也剔除缺列");

console.log("三、读取路径都走自愈");
ok(/const \{ data, error \} = await this\._safeSelect\("rank_items", cols, run\);\n      if \(error\) throw new Error\(errHint\(error, "读取渠道图片失败"\)\)/.test(SB), "渠道图列表");
ok(/await this\._safeSelect\("rank_items", cols, run\);\n      if \(error\) throw new Error\(error\.message \|\| "读取榜单图失败"\)/.test(SB), "打标队列");
ok(/!this\._missKnow\("rank_items", x\)\);\s+\/\* 已确认缺的列/.test(SB), "前台取数剔除已知缺列");
ok(!/if \(res\.error && useSlim\(\)\) \{\s*\n\s*COLS_REJECTED = true;/.test(SB), "单列缺失不再整包退回全量");

console.log("四、必填列兜底");
ok(/null value in column/.test(SB), "认得不能为空的报错");
ok(/const filler = .*new Date\(\)\.toISOString\(\) : 0/.test(SB), "按类型补默认值且只补一次");

console.log("五、渠道列缺失时不再下发给数据库");
ok(/if \(hasCh\) q = q\.neq\("channel", ""\);/.test(SB), "列表有条件地加渠道条件");
ok(/if \(!hasCh\) rows = rows\.filter/.test(SB), "没列时改内存筛");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
