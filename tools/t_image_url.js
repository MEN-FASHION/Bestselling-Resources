/* 视觉专区导出 URL 列：外链为空时必须回落到存储地址，否则整列空白 */
const fs = require('fs'), vm = require('vm');
/* 最小 XLSX 桩：把 aoa 原样留下，供断言导出表内容 */
const captured = [];
const XLSX = {
  utils: {
    aoa_to_sheet: (aoa) => { const ws = { aoa, '!cols': null, '!freeze': null }; captured.push(ws); return ws; },
    encode_cell: ({ r, c }) => String.fromCharCode(65 + c) + (r + 1),
    book_new: () => ({ SheetNames: [], Sheets: {} }),
    book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; },
  },
  write: () => new ArrayBuffer(8),
};
const sandbox = {
  window: { CONFIG: { WORKER_URL: 'https://img.example.com/' } },
  document: { querySelector: () => null, createElement: () => ({ style: {}, classList: { add(){} }, appendChild(){} }), addEventListener(){} },
  console, XLSX, Blob: function(){}, URL: { createObjectURL: () => 'blob:x' },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/../js/imageexport.js', 'utf8'), sandbox);
const M = sandbox.window.ImageExport;
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (e ? ' :: ' + e : '')); } };

ok('有外链时用外链', M.urlOf({ url: 'https://a.com/x.jpg', path: 'p/x.jpg' }) === 'https://a.com/x.jpg');
ok('外链为空时回落到存储地址',
   M.urlOf({ url: '', path: 'p/x.jpg' }) === 'https://img.example.com/p/x.jpg',
   M.urlOf({ url: '', path: 'p/x.jpg' }));
ok('外链为 null 也回落', M.urlOf({ url: null, path: 'p/y.jpg' }) === 'https://img.example.com/p/y.jpg');
ok('路径前导斜杠不会拼成双斜杠', M.urlOf({ path: '/p/z.jpg' }) === 'https://img.example.com/p/z.jpg',
   M.urlOf({ path: '/p/z.jpg' }));
ok('既无外链也无路径才返回空', M.urlOf({ url: '', path: '' }) === '');
ok('extUrlOf 只认外链', M.extUrlOf({ url: '', path: 'p/x.jpg' }) === '');

/* 露出的表头与行：URL 列必须每行有值 */
ok('COLS 首列是图片URL', M.COLS[0] === '图片URL');
ok('COLS 含图片ID', M.COLS.indexOf('图片ID') >= 0);

const book = M.buildBook([
  { id: 'u1', name: 'A', category: 'T恤', url: '', path: 'p/a.jpg', style_tags: ['休闲'] },
  { id: 'u2', name: 'B', category: 'T恤', url: 'https://ext/b.jpg', path: 'p/b.jpg', style_tags: ['休闲'] },
  { id: 'u3', name: 'C', category: 'T恤' },
], {});
const main = (captured[0] || {}).aoa || [];
const iUrl = main[0].indexOf('图片URL');
const iId = main[0].indexOf('图片ID');
const iNote = main[0].indexOf('备注');
ok('打标表有数据行', main.length === 4, 'rows=' + main.length);
ok('外链为空的图 URL 列已回落', main[1][iUrl] === 'https://img.example.com/p/a.jpg', main[1][iUrl]);
ok('有外链的图保留外链', main[2][iUrl] === 'https://ext/b.jpg', main[2][iUrl]);
ok('既无外链也无路径的行 URL 为空', main[3][iUrl] === '');
ok('图片ID 列有值', String(main[1][iId]) === 'u1' && String(main[3][iId]) === 'u3');
ok('兜底地址备注说明来源', /存储路径/.test(String(main[1][iNote])), main[1][iNote]);
ok('无地址行备注给出警告', /无法回填/.test(String(main[3][iNote])), main[3][iNote]);

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
