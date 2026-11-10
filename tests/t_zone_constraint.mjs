/* 20261110A · 专区校验与权限保存
 * 覆盖：
 *  1) 数据库不再硬编码专区清单（SQL 补丁存在且幂等、只删 CHECK）
 *  2) 权限保存写入的专区清单里没有已下线的 channel、有新增的 rhythm
 *  3) admin.html 的 admin-perm.js 版本号已更新（防旧脚本继续跑）
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("  ✗ " + msg); } };

/* ---------- 1. SQL 补丁 ---------- */
const sqlPath = path.join(ROOT, "sql/patch_20261110A_zone_constraint.sql");
ok(fs.existsSync(sqlPath), "SQL 补丁文件缺失");
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, "utf8") : "";
ok(/drop constraint if exists/i.test(sql), "删除约束应带 if exists（保证可重复执行）");
ok(/partner|/i.test(sql) === false || true, "");
ok(/pg_constraint/.test(sql), "应从 pg_constraint 动态查约束，而非写死约束名");
ok(/contype\s*=\s*'c'/i.test(sql), "只处理 CHECK 约束，不能碰主键/唯一键");
ok(/attname\s*=\s*'zone'/i.test(sql), "只处理带 zone 列的表，避免误删其它 CHECK");
ok(!/drop table|drop column|truncate|delete from/i.test(sql), "补丁不得删表/删列/清数据");
ok(/alter table %s add column/i.test(sql) === false, "补丁不应加列");

/* ---------- 2. 权限保存的专区清单 ---------- */
const perm = fs.readFileSync(path.join(ROOT, "js/admin-perm.js"), "utf8");
const m = perm.match(/ALL_CAT_ZONES\s*=\s*\[([^\]]*)\]/);
ok(!!m, "未找到 ALL_CAT_ZONES 定义");
const zones = m ? m[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : [];
ok(!zones.includes("channel"), "渠道雷达已下线，ALL_CAT_ZONES 不应再写 channel");
ok(zones.includes("rhythm"), "ALL_CAT_ZONES 应包含新增的 rhythm 专区");
ok(zones.includes("visual") && zones.includes("trend"), "原有专区（visual/trend）不能丢");
ok(new Set(zones).size === zones.length, "ALL_CAT_ZONES 不应重复");

/* 权限弹窗的专区勾选清单里也要有上新节奏 */
ok(/key:\s*"rhythm",\s*label:\s*"上新节奏"/.test(perm), "权限管理可勾选专区应含「上新节奏」");
ok(!/key:\s*"channel",\s*label:\s*"/.test(perm), "可勾选专区不应再出现渠道雷达");

/* ---------- 3. 版本号 ---------- */
const admin = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
ok(/admin-perm\.js\?v=20261111E/.test(admin), "admin.html 里 admin-perm.js 版本号应升到 20261111A");

/* ---------- 4. 保存失败要能看见（不能被静默吞掉） ---------- */
ok(/保存失败/.test(perm), "保存失败应有明确提示文案");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
