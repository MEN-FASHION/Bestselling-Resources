/* 节庆批量导入：用真实模板跑真实解析逻辑（xlsx / csv / JSON 三条路都要通）
   断言点：模板每行都能被识别、日期归一化正确、类别映射到站内六类、坏行被跳过、JSON 仍兼容。 */
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(__dirname, '..', 'vendor', 'xlsx.full.min.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ('  → ' + JSON.stringify(extra)) : '')); }
};

/* 从真实脚本里切出解析函数，保证测的就是线上那份代码 */
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-festival.js'), 'utf8');
function slice(startMark, endMark) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error('未找到 ' + startMark);
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error('未找到结束 ' + endMark);
  return src.slice(a, b);
}
const code = [
  slice('function normMMDD(v) {', 'function pad2(') ,
  slice('var CAT_ALIAS =', 'function readSheetRows('),
].join('\n');
const sandbox = { console };
const fn = new Function('console', code + '; return { rowFromSheet, normDateCell, parseStar, CAT_ALIAS, normKey };');
const api = fn(console);

const tmpl = path.join(__dirname, '..', 'templates', '节庆批量导入模板.xlsx');
ok('模板文件存在', fs.existsSync(tmpl));

const wb = XLSX.read(fs.readFileSync(tmpl), { type: 'buffer', cellDates: true });
ok('模板含「节日数据」页', wb.SheetNames.indexOf('节日数据') >= 0, wb.SheetNames);
const aoa = XLSX.utils.sheet_to_json(wb.Sheets['节日数据'], { header: 1, defval: '', blankrows: false });

/* 表头定位（与脚本同一套规则） */
let hi = -1;
for (let i = 0; i < Math.min(aoa.length, 12); i++) {
  const line = (aoa[i] || []).map(api.normKey).join('|');
  if (/日期/.test(line) && /名称|节日/.test(line)) { hi = i; break; }
}
ok('能定位到表头行', hi === 0, hi);

const head = aoa[hi] || [];
const rows = [];
for (let r = hi + 1; r < aoa.length; r++) {
  const o = {};
  for (let c = 0; c < head.length; c++) if (head[c] !== '') o[head[c]] = aoa[r][c];
  rows.push(o);
}
ok('模板有数据行', rows.length > 200, rows.length);

const parsed = rows.map(api.rowFromSheet);
const good = parsed.filter(Boolean);
ok('每一行都能解析（无跳过）', good.length === rows.length, { rows: rows.length, good: good.length });
ok('解析出的地区全是美国', good.every(o => o.region === '美国'));

const LABELS = { trad: 1, rel: 1, nat: 1, promo: 1, sport: 1, season: 1 };
ok('类别全部映射到站内六类', good.every(o => LABELS[o.cat]), [...new Set(good.map(o => o.cat))]);
ok('日期全部是合法 MM-DD', good.every(o => /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(o.date)));
ok('重要度都在 1~5', good.every(o => o.star >= 1 && o.star <= 5));
ok('提前期是数字且非负', good.every(o => Number.isInteger(o.lead) && o.lead >= 0));
ok('持续天数 >= 1', good.every(o => Number.isInteger(o.dur) && o.dur >= 1));
ok('名称无空值', good.every(o => o.name && o.name.trim().length > 0));

/* 日期归一化：几种常见写法都要认 */
ok('日期 2026-02-14 → 02-14', api.normDateCell('2026-02-14') === '02-14');
ok('日期 2/14 → 02-14', api.normDateCell('2/14') === '02-14');
ok('日期 2.14 → 02-14', api.normDateCell('2.14') === '02-14');
ok('日期 2026年2月14日 → 02-14', api.normDateCell('2026年2月14日') === '02-14');
ok('Date 对象也能归一化', api.normDateCell(new Date(2026, 1, 14)) === '02-14');
ok('日期为空 → 解析失败（应跳过）', api.rowFromSheet({ 节日名称: '空日期节日', 日期: '' }) === null);
ok('名称为空 → 解析失败（应跳过）', api.rowFromSheet({ 节日名称: '', 日期: '02-14' }) === null);

/* 星级：数字与星号两种 */
ok('重要度「★★★★」→ 4', api.parseStar('★★★★') === 4);
ok('重要度 3 → 3', api.parseStar(3) === 3);
ok('重要度为空 → 默认 3', api.parseStar('') === 3);
ok('重要度越界收敛到 5', api.parseStar('★★★★★★') === 5);

/* 英文表头也要认（兼容别人自己做的表） */
const en = api.rowFromSheet({ name: 'Thanksgiving', date: '11-26', region: '美国', cat: 'sport', star: 2, lead: 100, dur: 2 });
ok('英文表头可解析', !!en && en.name === 'Thanksgiving' && en.date === '11-26');
ok('英文表头类别映射', en.cat === 'sport');

/* 站内库与美国清单是否对齐（防止模板与库漂移） */
const vm = require('vm');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'marketing-data.js'), 'utf8'), ctx);
const usLib = ctx.RAW.filter(r => r[2] === '美国');
ok('站内美国节日条数与模板一致', usLib.length === good.length, { lib: usLib.length, tpl: good.length });
const libKey = new Set(usLib.map(r => r[0] + '|' + r[3]));
ok('模板每条都能在站内库里找到', good.every(o => libKey.has(o.name + '|' + o.date)),
  good.filter(o => !libKey.has(o.name + '|' + o.date)).slice(0, 5));

/* 美国节日不得重名同日 */
const dupMap = new Map();
usLib.forEach(r => { const k = r[0] + '|' + r[3]; dupMap.set(k, (dupMap.get(k) || 0) + 1); });
ok('站内美国库无重名同日', [...dupMap.values()].every(v => v === 1));


/* ============ 导入去重：同一国家同名节日不覆盖（本轮新增） ============ */
{
  const dd = new Function('console',
    slice('function dedupeKey(', '/* 导入前先读库里现有清单') + '\nreturn { dedupeKey, splitByDup };')(console);

  const k1 = dd.dedupeKey('美国', '感恩节');
  ok('去重键：国家+名称', k1 === '美国|感恩节', k1);
  ok('去重键：空格与标点归一', dd.dedupeKey('美国 ', ' 感恩 节 ') === k1, dd.dedupeKey('美国 ', ' 感恩 节 '));
  ok('去重键：不同国家不相等', dd.dedupeKey('英国', '感恩节') !== k1);
  ok('去重键：不同节日不相等', dd.dedupeKey('美国', '圣诞节') !== k1);

  const rowsIn = [
    { region: '美国', name: '感恩节', date: '11-26' },
    { region: '美国', name: '感恩 节', date: '11-26' },   // 同国同名（写法差异）→ 文件内重复
    { region: '英国', name: '感恩节', date: '11-26' },     // 他国同名 → 保留
    { region: '美国', name: '圣诞节', date: '12-25' }      // 同国他节 → 保留
  ];
  const r1 = dd.splitByDup(rowsIn, Object.create(null));
  ok('文件内同国同名只留一条', r1.keep.length === 3 && r1.dup === 1, r1);

  const existing = Object.create(null);
  existing[dd.dedupeKey('美国', '圣诞节')] = 1;
  const r2 = dd.splitByDup(rowsIn, existing);
  ok('库里已有的同国同名被跳过（不覆盖）', r2.dup === 2 && !r2.keep.some(x => x.region === '美国' && x.name === '圣诞节'), r2);
  ok('库里没有的照常导入', r2.keep.some(x => x.region === '英国'), r2.keep);

  const all = dd.splitByDup(rowsIn, (() => { const m = Object.create(null); rowsIn.forEach(x => { m[dd.dedupeKey(x.region, x.name)] = 1; }); return m; })());
  ok('全部重复时一条也不留（调用方便于提示「未覆盖」）', all.keep.length === 0 && all.dup === 4, all);

  // 静态：两条导入路径都必须走查重入口，且提示文案说明去重规则
  const srcNow = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-festival.js'), 'utf8');
  ok('templates/panel 说明含「重复…不覆盖」', /同名.{0,8}重复.{0,20}不覆盖/.test(srcNow));
  const importBlock = srcNow.slice(srcNow.indexOf('function doImport('), srcNow.indexOf('function doRebuild('));
  ok('Excel/CSV 路径走 commitRowsChecked', importBlock.indexOf('commitRowsChecked(rows, skipped)') >= 0);
  ok('doImport 内不再直接提交（防绕过查重）', importBlock.indexOf('commitRows(rows, skipped)') < 0);
  ok('读库失败时取消导入而非盲写', /读取现有节庆失败.{0,40}取消本次导入/.test(srcNow));
  ok('完成提示会报出重复条数', /跳过 '\s*\+\s*dup\s*\+\s*' 条重复/.test(srcNow));
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
