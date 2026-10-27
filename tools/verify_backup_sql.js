/* 备份模块（tools/setup_backup.sql）结构自检
 *
 * 为什么要单独给备份脚本做自检：它是最"重"的一个模块——能整库回滚、能导出全量数据。
 * 一旦守卫丢失、授权签名写错、或者不小心给表加了读策略，后果都不是"少个按钮"，
 * 而是数据泄露或被普通用户回滚。这类问题肉眼很难发现，所以固定成脚本每次核对。
 *
 * 用法：node tools/verify_backup_sql.js            （默认读 tools/setup_backup.sql）
 *       node tools/verify_backup_sql.js <路径>
 */
const fs = require("fs");
const path = require("path");

const target = process.argv[2] || "tools/setup_backup.sql";
const setupPath = path.join(path.dirname(target), "setup.sql");

let pass = 0;
const fails = [];
function ok(desc, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + desc); }
  else { fails.push(desc + (extra ? "（" + extra + "）" : "")); console.log("  ✗ " + desc + (extra ? "（" + extra + "）" : "")); }
}

if (!fs.existsSync(target)) {
  console.log("找不到脚本：" + target);
  process.exit(1);
}
const sql = fs.readFileSync(target, "utf8");
const lines = sql.split("\n");

/* ---------- 提取创建的函数（签名 + 安全属性 + 函数体） ---------- */
function extractFns(text) {
  const out = [];
  const re = /^create (?:or replace )?function public\.([a-z_]+)\(([^)]*)\)\s*\n\s*returns[\s\S]*?\n\s*as\s*\$\$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const head = text.slice(m.index, m.index + m[0].length);
    const bodyEnd = text.indexOf("\n$$;", m.index + m[0].length);
    const body = bodyEnd < 0 ? text.slice(m.index + m[0].length) : text.slice(m.index + m[0].length, bodyEnd);
    out.push({
      name: m[1],
      args: m[2].split(",").map((x) => x.trim()).filter(Boolean),
      line: text.slice(0, m.index).split("\n").length,
      definer: /security\s+definer/.test(head),
      invoker: /security\s+invoker/.test(head),
      searchPath: /set\s+search_path/.test(head),
      body: body,
    });
  }
  return out;
}
const fns = extractFns(sql);
const byName = {};
fns.forEach((f) => { byName[f.name] = f; });

console.log("\n[1] 备份表与访问控制");
ok("建了 data_backups 表", /create table if not exists public\.data_backups/.test(sql));
ok("data_backups 已开启行级安全（RLS）", /alter table public\.data_backups enable row level security/.test(sql));
const policies = sql.match(/create policy[^;]*on public\.data_backups/gi) || [];
ok("data_backups 有意不建任何策略（只能经函数访问，账号无法直连读写）", policies.length === 0,
  "发现 " + policies.length + " 条策略");

console.log("\n[2] 函数安全属性");
const expected = ["backup_tables", "backup_create", "backup_list", "backup_get", "backup_delete", "backup_restore"];
expected.forEach((n) => ok("存在函数 " + n, !!byName[n]));
const externals = ["backup_create", "backup_list", "backup_get", "backup_delete", "backup_restore"];
externals.forEach((n) => {
  if (!byName[n]) return;
  ok(n + " 带超管守卫 public.is_super_admin()", byName[n].body.includes("public.is_super_admin()"));
});
externals.forEach((n) => {
  if (!byName[n]) return;
  ok(n + " 是 security definer（需绕过 RLS 读全表）", byName[n].definer && !byName[n].invoker);
});
const helper = byName["backup_tables"];
if (helper) {
  const pure = !/from\s+public\./i.test(helper.body);
  ok("内部辅助函数 backup_tables 是纯常量清单（不读表，故不需要 definer）", pure,
    pure ? "" : "它读了库表，那就必须改成 security definer 并补守卫");
}
fns.forEach((f) => ok(f.name + " 固定了 search_path（防检索路径攻击）", f.searchPath));

console.log("\n[3] 授权与签名一致性（统计脚本那次 42883 就是这类问题）");
const grants = [];
const grantRe = /^(grant|revoke)[^;]*?function public\.([a-z_]+)\(([^)]*)\)([^;]*);/gm;
let g;
while ((g = grantRe.exec(sql)) !== null) {
  grants.push({
    kind: g[1], name: g[2],
    argc: g[3].split(",").map((x) => x.trim()).filter(Boolean).length,
    rest: g[4],
    line: sql.slice(0, g.index).split("\n").length,
  });
}
const badSig = grants.filter((x) => {
  const f = byName[x.name];
  if (!f) return true;
  // 允许：参数个数一致，或函数尾部参数有默认值（授权时可省略）
  const defaults = f.args.filter((a) => /default/i.test(a)).length;
  return !(x.argc === f.args.length || (x.argc <= f.args.length && x.argc >= f.args.length - defaults));
});
ok("授权语句引用的函数签名都能对上真实创建的函数", badSig.length === 0,
  badSig.map((x) => x.line + " 行 " + x.kind + " " + x.name).join(", "));

externals.forEach((n) => {
  const rev = grants.find((x) => x.name === n && x.kind === "revoke" && /from public, anon/.test(x.rest));
  ok(n + " 先从 public/anon 收回（匿名不可调用）", !!rev);
  const gr = grants.find((x) => x.name === n && x.kind === "grant" && /to authenticated/.test(x.rest));
  ok(n + " 只授予登录用户（authenticated）", !!gr);
  const f = byName[n];
  if (f && gr) ok(n + " 的授权紧跟创建之后（不会先授权后创建）", gr.line > f.line);
});
ok("内部辅助函数 backup_tables 未对外授权（只在函数内部用）",
  !grants.some((x) => x.name === "backup_tables" && x.kind === "grant"));
ok("没有对 anon 角色授予任何备份函数", !grants.some((x) => x.kind === "grant" && /\bto anon/.test(x.rest)));

console.log("\n[4] 业务规则");
const restore = byName["backup_restore"];
ok("恢复前会自动先存一份快照（回滚错了能退回）",
  !!restore && /public\.backup_create\(/.test(restore.body));
ok("快照有上限、超出的自动清理（只保留最近 10 份）",
  /order by created_at desc, id desc\s+offset 10/.test(sql));
ok("导出/恢复都按白名单表逐表处理（不写死表名列表之外的库对象）",
  /public\.backup_tables\(\)/.test(sql));

console.log("\n[5] 跨文件依赖");
if (fs.existsSync(setupPath)) {
  const setup = fs.readFileSync(setupPath, "utf8");
  const cols = ["user_tag", "user_note", "manage_zones", "frontend_zones"];
  cols.forEach((c) => ok("恢复用到的 profiles." + c + " 在建库脚本里存在", setup.includes(c)));
  ok("is_super_admin() 在建库脚本或本脚本里有定义（否则守卫会报函数不存在）",
    /create (?:or replace )?function public\.is_super_admin/.test(setup) ||
    /create (?:or replace )?function public\.is_super_admin/.test(sql));
} else {
  console.log("  · 跳过（没找到同目录的 setup.sql）");
}

console.log("\n[6] 反向验证（把关键实现还原成坏写法，检查项必须失败）");
const backupFns = fns.filter((f) => externals.includes(f.name));

let n1 = 0;
backupFns.forEach((f) => {
  const broken = sql.split("if not public.is_super_admin() then").join("if false then");
  if (!extractFns(broken).find((x) => x.name === f.name).body.includes("public.is_super_admin()")) n1++;
});
ok("还原：去掉超管守卫后，守卫检查会失败", n1 === backupFns.length);

let n2 = 0;
backupFns.forEach((f) => {
  const broken = sql.replace(/^revoke all on function public\./gm, "-- revoke all on function public.");
  const gs = [];
  const re = /^(grant|revoke)[^;]*?function public\.([a-z_]+)\([^)]*\)([^;]*);/gm;
  let m;
  while ((m = re.exec(broken)) !== null) gs.push({ kind: m[1], name: m[2], rest: m[3] });
  if (!gs.some((x) => x.name === f.name && x.kind === "revoke" && /from public, anon/.test(x.rest))) n2++;
});
ok("还原：去掉 revoke 后，收回权限检查会失败", n2 === backupFns.length);

const withPolicy = sql + "\ncreate policy t on public.data_backups for select to authenticated using (true);\n";
ok("还原：给备份表加一条读策略后，策略检查会失败",
  (withPolicy.match(/create policy[^;]*on public\.data_backups/gi) || []).length > 0);

const wrongSig = sql.replace("grant execute on function public.backup_get(bigint) to authenticated;",
  "grant execute on function public.backup_get(text, text) to authenticated;");
const getFn = byName["backup_get"];
const wsBad = wrongSig.match(/grant execute on function public\.backup_get\(([^)]*)\)/) [1].split(",").length;
ok("还原：授权签名写错后，签名一致性检查会失败", wsBad !== getFn.args.length);

console.log("\n== 结果：" + pass + " 项通过，" + fails.length + " 项失败 ==");
if (fails.length) { console.log("失败项："); fails.forEach((f) => console.log(" - " + f)); process.exit(1); }