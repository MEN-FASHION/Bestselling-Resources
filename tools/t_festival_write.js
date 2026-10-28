/* 验证：节日列是否真的参与写入。修复前 applyPlan 只遍历 8 个必填维度，
   festival_tags 解析出来后被丢弃，导入报成功但库里永远 0 行。 */
const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync(__dirname + '/../js/admin-rankimport.js', 'utf8');
const sandbox = {
  window: {},
  document: { querySelector: () => null, createElement: () => ({ style: {}, classList: { add(){} } }), addEventListener(){} },
  console,
};
sandbox.window.RankExport = { ENUM: {}, VISUAL_LEGACY: [] };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const M = sandbox.window.RankTagImport;
if (!M) throw new Error('模块未挂载');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
};

/* ---- 1. 判定口径：节日不进 FIELDS（留空不算未打标） ---- */
ok('FIELDS 不含 festival_tags', M.FIELDS.indexOf('festival_tags') === -1);
ok('FIELDS 仍是 8 个必填维度', M.FIELDS.length === 8);
ok('WRITE_FIELDS 含 festival_tags', M.WRITE_FIELDS.indexOf('festival_tags') >= 0);
ok('WRITE_FIELDS = 9 个', M.WRITE_FIELDS.length === 9);

/* ---- 2. 表里有节日、库里为空 → 必须写进去 ---- */
const rows = [{
  url: 'https://x/a.jpg', category: 'T恤',
  tags: { style_tags: ['休闲'], festival_tags: ['圣诞节'] },
  provided: { style_tags: 1, festival_tags: 1 },
}];
let plan = M.applyPlan(rows, {}, ['style_tags', 'festival_tags'], { mode: 'overwrite' });
ok('节日写入 payload', plan.payload.length === 1, JSON.stringify(plan.payload));
ok('节日值已落库字段', JSON.stringify(plan.payload[0].festival_tags) === '["圣诞节"]',
   JSON.stringify(plan.payload[0] && plan.payload[0].festival_tags));
ok('节日进了历史（可撤回）', plan.history.some(h => h.field === 'festival_tags'));

/* ---- 3. 补齐模式：库里已有节日 → 不覆盖 ---- */
const exist = { 'https://x/a.jpg': { style_tags: ['休闲'], festival_tags: ['万圣节'] } };
plan = M.applyPlan(rows, exist, ['style_tags', 'festival_tags'], { mode: 'fill' });
const kept = plan.payload[0] ? plan.payload[0].festival_tags : exist['https://x/a.jpg'].festival_tags;
ok('补齐模式不动已有节日', JSON.stringify(kept) === '["万圣节"]', JSON.stringify(kept));

/* ---- 4. 覆盖模式：表里改成别的节日 → 覆盖 ---- */
plan = M.applyPlan(rows, exist, ['style_tags', 'festival_tags'], { mode: 'overwrite' });
ok('覆盖模式写入新节日', JSON.stringify(plan.payload[0].festival_tags) === '["圣诞节"]');

/* ---- 5. 覆盖 + 空单元格也清空：表里节日为空 → 清空 ---- */
const rowsNoFes = [{ url: 'https://x/a.jpg', category: 'T恤', tags: { style_tags: ['休闲'] }, provided: { style_tags: 1 } }];
plan = M.applyPlan(rowsNoFes, exist, ['style_tags', 'festival_tags'], { mode: 'overwrite', clearEmpty: true });
ok('勾选清空时节日被清掉', JSON.stringify(plan.payload[0].festival_tags) === '[]',
   JSON.stringify(plan.payload[0].festival_tags));

/* ---- 6. 覆盖 + 不勾清空：表里节日为空 → 不动，且这张图无其它变化 → 根本不写库 ---- */
plan = M.applyPlan(rowsNoFes, exist, ['style_tags', 'festival_tags'], { mode: 'overwrite', clearEmpty: false });
ok('不勾清空时该行不进写库批次（无变化）', plan.payload.length === 0, JSON.stringify(plan.payload));
ok('没有产生清空节日的历史', !plan.history.some(h => h.field === 'festival_tags'));

/* ---- 7. 只打了节日的图：仍算"未打标"（8 维判定） ---- */
const onlyFes = [{ url: 'https://x/b.jpg', tags: { festival_tags: ['圣诞节'] }, provided: { festival_tags: 1 } }];
plan = M.applyPlan(onlyFes, {}, ['festival_tags'], { mode: 'overwrite' });
ok('仅节日的行仍写库', JSON.stringify(plan.payload[0].festival_tags) === '["圣诞节"]');
const taggedByFields = M.FIELDS.some(f => (plan.payload[0][f] || []).length);
ok('但 8 维判定为未打标', taggedByFields === false);

/* ---- 8. 撤回：只写过节日的批次，节日能回到写入前 ---- */
const planFes = M.applyPlan(onlyFes, { 'https://x/b.jpg': { festival_tags: [] } }, ['festival_tags'], { mode: 'overwrite' });
const revert = M.planRevert(planFes.history, { 'https://x/b.jpg': { festival_tags: ['圣诞节'] } });
ok('撤回时节日回到写入前', JSON.stringify((revert.payload[0] || {}).festival_tags) === '[]',
   JSON.stringify((revert.payload[0] || {}).festival_tags));
ok('撤回命中 1 处', revert.restored === 1, String(revert.restored));

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
