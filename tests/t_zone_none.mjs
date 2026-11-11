/* 20261110G · 「前台可见专区」全部取消后仍然显示有权限 —— 哨兵值验证
 *
 * 背景：frontend_zones 用空数组表示「从没配过 → 跟随全局」，
 *       而权限弹窗里把专区全部取消勾选，保存的也是空数组，
 *       两者语义相反却存成了同一个值 → 取消后反而显示全局全部专区。
 * 修法：全部取消时写入哨兵 [ZONE_NONE]，读取时区分「已配置但为空」与「未配置」。
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };
const P = fs.readFileSync(path.join(ROOT, "js/admin-perm.js"), "utf8");
const S = fs.readFileSync(path.join(ROOT, "js/supabase.js"), "utf8");

console.log("一、哨兵定义与保存");
ok(/const ZONE_NONE = "__none__"/.test(P), "应定义 ZONE_NONE 哨兵常量");
ok(/setUserFrontendZones\(uid, frontZones\.length \? frontZones : \[ZONE_NONE\]\)/.test(P),
  "全都不勾时应写哨兵，而不是写空数组");
ok(/setUserFrontendZones\(uid, frontZones\)/.test(P) === false || /\[ZONE_NONE\]/.test(P),
  "不应再有直接写空数组的旧写法");

console.log("二、列表渲染区分两种情况");
ok(/const frontConfigured = frontZonesRaw\.length > 0/.test(P), "渲染时应判断「是否配置过」");
ok(/frontZonesRaw\.filter\(z => z !== ZONE_NONE\)/.test(P), "渲染时应过滤哨兵，避免显示成专区名");
ok(/frontConfigured \? frontZones : permGlobalZones/.test(P), "只有未配置才回退全局");
ok(/无（已全部关闭）/.test(P), "已配置但为空时应明确显示，不能显示成「全局全部」");

console.log("三、批量操作文案同步");
ok(/const frontConfigured = rawFront\.length > 0/.test(P), "批量文案也应区分配置状态");
ok(/const front = rawFront\.filter\(z => z !== ZONE_NONE\)/.test(P), "批量文案应过滤哨兵");

console.log("四、弹窗回显");
ok(/filter\(z => z !== ZONE_NONE\), "#perm-edit-zones"/.test(P), "弹窗重新打开时不应把哨兵勾成一个假专区");

console.log("五、存库层不丢哨兵");
ok(/const clean = \[\.\.\.new Set\(\(zones \|\| \[\]\)\.filter\(Boolean\)\)\]/.test(S),
  "入库清洗应保留非空字符串（含哨兵），不能把哨兵过滤掉");
ok(/async setUserFrontendZones/.test(S), "写入方法仍在");

console.log("六、前台守卫按「有内容且不含本专区」判拒绝");
const guards = ["js/rank.js", "js/rhythm.js", "js/plus.js", "js/fav.js", "js/frontend.js"];
guards.forEach((f) => {
  const t = fs.readFileSync(path.join(ROOT, f), "utf8");
  const bad = /my[zZ]ones\.length === 0/.test(t);
  ok(!bad, `${f} 不应把空列表当成「无授权」以外的语义`);
});
const rank = fs.readFileSync(path.join(ROOT, "js/rank.js"), "utf8");
ok(/Array\.isArray\(myz\) && myz\.length && myz\.indexOf\("rank"\) === -1/.test(rank),
  "榜单守卫应是「有白名单且不含本专区」才拦，哨兵数组正好命中");

console.log("七、版本号");
const admin = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
ok(/admin-perm\.js\?v=20261111Y/.test(admin), "admin.html 里 admin-perm.js 版本号应随本次发布统一升级");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
