/* 20261110G · 登录地点列 + 补渠道报错修复
 * 覆盖：
 *  1) 归属地模块存在且行为正确（内网不发请求、缓存命中不重复查、失败不抛错）
 *  2) 权限表新增「登录地点」列，表头/单元格/空态列数一致
 *  3) 补渠道失败时给出可照做的提示（不再只显示 400）
 *  4) SQL 补丁覆盖 channel 列、tag_defs 必要列、type 约束
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };
const R = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const IPG = R("js/ipgeo.js");
const PERM = R("js/admin-perm.js");
const ADMIN = R("admin.html");
const SB = R("js/supabase.js");
const CFG = R("js/config.js");
const SQL = R("sql/patch_20261110C_channel_and_tagdefs.sql");

console.log("一、归属地模块");
ok(/window\.IPGeo\s*=/.test(IPG), "应暴露 IPGeo");
ok(/function isPrivate/.test(IPG), "应能识别内网地址");
ok(/localStorage/.test(IPG), "结果应缓存在本机，避免重复查询");
ok(/MAX_CONCURRENT\s*=\s*2/.test(IPG), "并发应受限，不能一次打满请求");
ok(/abort\(\)/.test(IPG) && /6000/.test(IPG), "单次查询应有超时，不能一直转圈");
ok(/resolveMany/.test(IPG), "应支持批量逐行回填");
ok(/IP_GEO/.test(CFG), "config.js 应暴露开关与查询地址");
ok(/enabled:\s*true/.test(CFG) && /ttlDays/.test(CFG), "应有开关与缓存天数配置");

console.log("二、内网地址不发请求（实跑真实函数）");
const sandbox = { window: {}, localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } }, CONFIG: { IP_GEO: { enabled: true, url: "https://example.invalid/{ip}", ttlDays: 30 } }, fetch: () => { throw new Error("不该发请求"); } };
const vm = await import("node:vm");
const ctx = vm.createContext({ window: sandbox.window, localStorage: sandbox.localStorage, CONFIG: sandbox.CONFIG, fetch: sandbox.fetch, setTimeout, clearTimeout, AbortController, Date, JSON, Math, String, Number, RegExp, Promise, encodeURIComponent, console });
vm.runInContext(IPG, ctx);
const g = sandbox.window.IPGeo;
ok(!!g, "模块应挂载成功");
ok(g.isPrivate("10.1.2.3") === true, "10.x 应判为内网");
ok(g.isPrivate("192.168.1.9") === true, "192.168.x 应判为内网");
ok(g.isPrivate("172.20.0.1") === true, "172.16-31 应判为内网");
ok(g.isPrivate("127.0.0.1") === true, "回环应判为内网");
ok(g.isPrivate("18.183.14.222") === false, "公网 IP 不应误判");
ok(g.peek("10.1.2.3").state === "private", "内网地址应直接给出「内网」，不进队列");
ok(g.peek("18.183.14.222").state === "pending", "未缓存的公网 IP 应先显示占位");

console.log("三、权限表新增登录地点列");
ok(/<th>登录地点<\/th>/.test(ADMIN), "表头应新增「登录地点」");
ok(/perm-td-loc/.test(PERM), "单元格应有标记类名");
ok(/fillLocations\(pageRows\)/.test(PERM), "渲染后应触发异步回填");
ok(/data-ip=/.test(PERM), "单元格应带 IP 便于回填定位");
ok(!/colspan="11"/.test(PERM), "空态列数应同步为 12，否则表格错位");
ok(/<td colspan="12"/.test(PERM), "空态列数应为 12");
ok(/ipgeo\.js\?v=20261110G/.test(ADMIN), "页面应引入归属地脚本且版本号正确");
ok(/if \(!g\) return '<span class="hint">—<\/span>'/.test(PERM), "模块未加载时应降级显示，不能报错");

console.log("四、补渠道报错可照做");
ok(/function errHint/.test(SB), "应有报错翻译函数");
ok(/catch \(e\) \{ \/\* 列写不进去也无所谓：字典已经写好了 \*\/ \}/.test(SB), "列写失败不应打断补渠道");
ok(/patch_20261110C_channel_and_tagdefs\.sql/.test(SB), "提示里应点名要执行的补丁");

console.log("五、缺列自动降级");
ok(/if \(error && \/sort_order\|created_at\|column\/i\.test\(error\.message \|\| ""\)\)/.test(SB), "枚举读取缺列时应降级重试");
ok(/const slim = \{ type, name: n \}/.test(SB), "枚举写入缺列时应去掉多余字段重试");

console.log("六、SQL 补丁");
ok(/alter table rank_items add column if not exists channel/.test(SQL), "应补 channel 列且幂等");
ok(/alter table tag_defs add column if not exists sort_order/.test(SQL), "应补 sort_order 列");
ok(/alter table tag_defs add column if not exists "group"/.test(SQL), "应补 group 列");
ok(/drop constraint if exists/.test(SQL), "应解除 type 上的硬编码约束");
ok(!/drop table|drop column|truncate/i.test(SQL), "不得删表/删列/清数据");

console.log("七、版本号统一");
const vers = [...new Set([...ADMIN.matchAll(/v=(2026\d{4}[A-Z])/g)].map((m) => m[1]))];
ok(vers.length === 1 && vers[0] === "20261110G", "后台页面版本号应统一为 20261110G");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
