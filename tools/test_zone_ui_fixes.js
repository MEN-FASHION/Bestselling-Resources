#!/usr/bin/env node
/**
 * 后台「前台访问设置」三处缺陷的回归测试
 *
 * 覆盖：
 *  1. 超管前台不受用户级专区白名单约束（否则新专区入口不出现）
 *  2. 专区可见开关：连点两次状态要真的来回切换（闭包常量缺陷）
 *  3. 类目可见开关：同上
 *  4. 「各专区·各类目」列表不重复渲染（并发交错缺陷）
 *  5. 相关文件语法可解析
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra) {
  if (cond) { pass++; results.push(`  ✅ ${name}`); }
  else { fail++; results.push(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
}
function group(t) { results.push(`\n【${t}】`); }

// ---------- 1. 超管白名单放行 ----------
group("超管专区可见性");
const sbsrc = read("js/supabase.js");
const mfw = (sbsrc.match(/async myFrontendZones\(\)[\s\S]{0,900}?\n    \},/) || [""])[0];
ok("读取白名单时同时取 role 字段", /select\(\s*["'][^"']*frontend_zones[^"']*role|select\(\s*["'][^"']*role[^"']*frontend_zones/.test(mfw));
ok("超管返回 null（表示不限专区）", /super_admin[\s\S]{0,40}return null/.test(mfw) || /String\(data\.role[\s\S]{0,60}super_admin["'][\s\S]{0,40}return null/.test(mfw));
ok("角色字符串必须是 super_admin（写成 super 会永远不成立）", /super_admin/.test(mfw) && !/===\s*["']super["']/.test(mfw));
ok("普通账号仍按白名单返回数组", /Array\.isArray\(data\.frontend_zones\)/.test(mfw));

const fesrc = read("js/frontend.js");
ok("白名单为 null 时前端视为全部可见", /!myZones\s*\|\|\s*!myZones\.length[\s\S]{0,30}true/.test(fesrc) || /Array\.isArray\(myZones\)\s*&&\s*myZones\.length/.test(fesrc));
const csrc = read("js/common.js");
ok("common 白名单为空即不限制", /Array\.isArray\(mine\)\s*&&\s*mine\.length\)\s*return\s+mine\.indexOf\(zone\)/.test(csrc));

// ---------- 2/3. 开关闭包缺陷 ----------
group("开关二次点击有效性");
const asrc = read("js/admin.js");

// 定位两个渲染函数体
const zoneFn = (asrc.match(/async function loadZoneVisibility\(\)[\s\S]*?\n  \}/) || [""])[0];
const catFn = (asrc.match(/async function loadCatVisibility\(\)[\s\S]*?\n  \}/) || [""])[0];
ok("已定位专区可见渲染函数", zoneFn.length > 200);
ok("已定位类目可见渲染函数", catFn.length > 400);

for (const [label, body] of [["专区可见", zoneFn], ["类目可见", catFn]]) {
  ok(`${label}：状态用可变变量承载`, /\blet\s+state\s*=/.test(body));
  ok(`${label}：取反基于当前状态`, /const\s+next\s*=\s*!state/.test(body));
  ok(`${label}：成功后提交状态`, /state\s*=\s*next/.test(body));
  ok(`${label}：失败回退到真实状态`, /paint\(state\)/.test(body));
  ok(`${label}：不再有闭包常量 on 取反`, !/const\s+on\s*=[^\n]*\n[\s\S]{0,400}?const\s+next\s*=\s*!on/.test(body));
}

// ---------- 4. 类目列表不重复 ----------
group("类目列表不重复渲染");
ok("使用渲染代际序号", /const\s+seq\s*=\s*\+\+catVisRenderSeq/.test(catFn));
ok("过期渲染直接丢弃", /if\s*\(seq\s*!==\s*catVisRenderSeq\)\s*return/.test(catFn));
ok("类目池并行获取", /Promise\.all\(ZONE_DEFS\.map/.test(catFn));
ok("一次性替换 DOM（DocumentFragment）", /createDocumentFragment\(\)/.test(catFn) && /box\.appendChild\(frag\)/.test(catFn));
ok("替换前清空容器", /box\.innerHTML\s*=\s*""/.test(catFn));
ok("不再在循环内串行 await", !/for\s*\(const\s+z\s+of\s+ZONE_DEFS\)[\s\S]{0,300}?await\s+SB\.listZoneCatsForVis/.test(catFn));
ok("代际变量已声明", /let\s+catVisRenderSeq\s*=\s*0/.test(asrc));

// 每个专区只渲染一次：key 使用数组下标一一对应
ok("专区与类目池按下标一一对应", /ZONE_DEFS\.forEach\(\(z,\s*zi\)/.test(catFn) && /zoneCats\[zi\]/.test(catFn));

// ---------- 4b. 折叠与去噪 ----------
group("类目列表折叠与去噪");
ok("个人专区（我的收藏）不列类目", /CAT_VIS_SKIP\s*=\s*\{\s*fav:\s*1\s*\}/.test(catFn));
ok("按白名单跳过该专区", /if\s*\(CAT_VIS_SKIP\[z\.key\]\)\s*return/.test(catFn));
ok("默认折叠", /let\s+open\s*=\s*hiddenCnt\s*>\s*0/.test(catFn));
ok("折叠时列表隐藏", /listWrap\.style\.display\s*=\s*open\s*\?\s*""\s*:\s*"none"/.test(catFn));
ok("标题可点击展开收起", /head\.onclick\s*=/.test(catFn) && /open\s*=\s*!open/.test(catFn));
ok("显示类目总数统计", /cvz-meta/.test(catFn) && /个类目/.test(catFn));
ok("显示已隐藏数量", /已隐藏/.test(catFn));
ok("展开态维护箭头朝向", /cvz-caret/.test(catFn) && /open\s*\?\s*"▾"/.test(catFn));

const css = read("css/style.css");
ok("折叠标题有样式", /\.cat-vis-zone-head\s*\{[^}]*cursor:\s*pointer/.test(css));
ok("统计文字样式存在", /\.cvz-meta\s*\{/.test(css));

// ---------- 4c. 数据库层：专区字段约束与诊断脚本 ----------
group("数据库层补丁");
const patchSql = read("tools/patch_20261030H_zone_constraint.sql");
ok("补丁动态查找 zone 相关 CHECK 约束", /pg_constraint/.test(patchSql) && /pg_get_constraintdef\(con\.oid\)\s+ILIKE\s+'%zone%'/.test(patchSql));
ok("补丁用 ALTER TABLE DROP CONSTRAINT 放开", /ALTER TABLE public\.%I DROP CONSTRAINT %I/.test(patchSql));
ok("补丁覆盖四张涉及专区的表", ["zone_permissions", "frontend_zone_visibility", "frontend_cat_visibility", "zone_cats"].every(t => patchSql.includes(t)));
ok("补丁幂等（循环内只删存在的约束）", /FOR v_rec IN/.test(patchSql) && /LOOP/.test(patchSql));
ok("补丁不改数据（无 delete/update/insert）", !/\b(DELETE\s+FROM|UPDATE\s+public\.|INSERT\s+INTO)\b/i.test(patchSql));
ok("补丁带改后自检", /改后自检/.test(patchSql));
ok("诊断脚本只读（无写语句）", (() => { const d = read("tools/diagnose_zone_menu.sql"); return !/\b(DELETE\s+FROM|UPDATE\s+public\.|INSERT\s+INTO|ALTER\s+TABLE)\b/i.test(d); })());
ok("诊断覆盖三层来源", (() => { const d = read("tools/diagnose_zone_menu.sql"); return /frontend_zones/.test(d) && /__defs/.test(d) && /frontend_zone_visibility/.test(d); })());
ok("权限写入清单包含趋势动向", /ALL_CAT_ZONES\s*=\s*\[[^\]]*movement/.test(read("js/admin-perm.js")));
ok("权限可选专区含趋势动向", /key:\s*"movement",\s*label:\s*"趋势动向"/.test(read("js/admin-perm.js")));

// ---------- 5. 语法 ----------
group("语法解析");
for (const f of ["js/admin.js", "js/supabase.js", "js/frontend.js", "js/common.js", "js/admin-perm.js"]) {
  let okk = true, err = "";
  try { execFileSync(process.execPath, ["--check", path.join(ROOT, f)], { stdio: "pipe" }); }
  catch (e) { okk = false; err = String(e.stderr || e.message).split("\n")[0]; }
  ok(`${f} 可解析`, okk, err);
}

console.log(results.join("\n"));
console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);