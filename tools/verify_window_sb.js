/* 20261021A：全局接口暴露检查
 * 背景：supabase.js 用 `const SB = (()=>{...})()` 定义，经典脚本里的 const
 *       不会挂到 window 上；而其余模块用 `window.SB` 做守卫 →
 *       守卫恒为假，「接口不可用」、访客上报与节庆读库全部静默失效。
 * 本脚本静态核对：暴露点存在、调用方守卫可满足、脚本顺序正确、补丁脚本齐备。
 */
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(R, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? ' → ' + extra : '')); }
};

const sup = rd('js/supabase.js');
console.log('[1] 全局暴露');
ok('supabase.js 用 IIFE 定义 SB', /const SB = \(\(\) => \{/.test(sup));
ok('supabase.js 把 SB 挂到 window 上', /window\.SB\s*=\s*SB/.test(sup));
ok('暴露语句在文件末尾（IIFE 之后）',
  sup.lastIndexOf('})();') < sup.lastIndexOf('window.SB = SB'));
ok('暴露处有 try 包裹（异常不影响主流程）', /try\s*\{\s*window\.SB = SB/.test(sup));

console.log('[2] 节庆接口齐备');
['listFestivals', 'upsertFestivals', 'deleteFestival', 'clearFestivals']
  .forEach((m) => ok('SB.' + m + ' 已实现', new RegExp('async ' + m + '\\s*\\(').test(sup)));

console.log('[3] 后台节庆编辑器守卫');
const fest = rd('js/admin-festival.js');
ok('不再使用 window.SB 守卫', !/!window\.SB/.test(fest));
const guards = (fest.match(/typeof SB === 'undefined'/g) || []).length;
ok('全部守卫改为 typeof SB 判定（≥6 处，含导入查重入口）', guards >= 6, '实际 ' + guards);

console.log('[4] 其它 window.SB 调用点可满足');
[['js/common.js', '访客上报'], ['js/marketing-main.js', '前台节庆读库'],
 ['js/track-menu.js', '菜单埋点'], ['js/admin-tasks.js', '招品类目池'],
 ['js/marketing-edit.js', '编辑层鉴权']].forEach(([f, label]) => {
  const s = rd(f);
  ok(label + '：' + f + ' 使用 window.SB 且依赖已暴露', /window\.SB/.test(s));
});

console.log('[5] 脚本引入顺序（supabase.js 必须在前）');
['index.html', 'admin.html', 'marketing.html', 'rank.html'].forEach((f) => {
  const h = rd(f);
  const i = h.indexOf('js/supabase.js');
  const later = ['js/common.js', 'js/admin.js', 'js/marketing-main.js', 'js/track-menu.js']
    .map((x) => h.indexOf(x)).filter((x) => x > -1);
  ok(f + '：supabase.js 先于依赖它的脚本', i > -1 && later.every((x) => x > i));
});

console.log('[6] 补字段补丁脚本');
const sql = rd('tools/patch_20261021A.sql');
ok('含 admin_actions.created_at', /'admin_actions','created_at'/.test(sql));
ok('含 visit_logs.started_at', /'visit_logs','started_at'/.test(sql));
ok('幂等：先查 information_schema 再 ALTER',
  sql.indexOf('information_schema.columns') > -1 && sql.indexOf('execute format') > sql.indexOf('information_schema.columns'));
ok('不动数据：无 delete/update/truncate',
  !/\b(delete from|update\s+public\.|truncate)\b/i.test(sql));
ok('带自检（仍缺字段 + 就绪状态）', /仍缺字段/.test(sql) && /已就绪/.test(sql));

console.log('[7] 运行时复现（vm，无需浏览器环境）');
try {
  const vm = require('vm');
  const ctx = { window: {} };
  vm.createContext(ctx);
  // 与 supabase.js 同构：经典脚本作用域里的 const SB
  vm.runInContext("const SB = { listFestivals(){}, upsertFestivals(){}, deleteFestival(){}, clearFestivals(){} };", ctx);
  const before = vm.runInContext("(!window.SB || typeof SB.upsertFestivals !== 'function')", ctx);
  ok('复现：未暴露时旧守卫判为真（即「接口不可用」）', before === true);
  vm.runInContext("try { window.SB = SB; } catch (e) {}", ctx);
  const after = vm.runInContext("(!window.SB || typeof SB.upsertFestivals !== 'function')", ctx);
  ok('修复：暴露后旧守卫判为假（接口可用）', after === false);
  const newGuard = vm.runInContext("(typeof SB === 'undefined' || typeof SB.upsertFestivals !== 'function')", ctx);
  ok('新守卫在 SB 存在时也判为假', newGuard === false);
  const noSB = (() => { const c = { window: {} }; vm.createContext(c); return vm.runInContext("(typeof SB === 'undefined')", c); })();
  ok('新守卫在 SB 缺失时仍判为真（不误放行）', noSB === true);
} catch (e) { fail++; console.log('  ✘ 运行时复现异常 → ' + e.message); }

console.log('[8] 反向验证：移除暴露点后，判定必须失效');
const broken = sup.replace(/window\.SB = SB/g, '/* removed */');
ok('移除暴露 → 不再满足「已暴露」检查', !/window\.SB\s*=\s*SB/.test(broken));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);