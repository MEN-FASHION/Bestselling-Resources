/* 后台「营销日历 · 节庆库」+ 顶部菜单不闪 + 洲筛选体验：静态与运行时双层验证 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'js/admin.js'), 'utf8');
const festJs = fs.readFileSync(path.join(ROOT, 'js/admin-festivals.js'), 'utf8');
const sbJs = fs.readFileSync(path.join(ROOT, 'js/supabase.js'), 'utf8');
const dataJs = fs.readFileSync(path.join(ROOT, 'js/marketing-data.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(ROOT, 'js/marketing-main.js'), 'utf8');
const commonJs = fs.readFileSync(path.join(ROOT, 'js/common.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
const sql = fs.readFileSync(path.join(ROOT, 'tools/setup_marketing.sql'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else { fail++; fails.push(name + (extra !== undefined ? '  [' + extra + ']' : '')); console.log('  ✗ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
}
function eq(name, a, b) { ok(name, a === b, a + ' vs ' + b); }

(async function () {
  console.log('=== 一、后台结构 ===');
  ok('侧栏有独立「营销日历」菜单', /<a class="nav-item" data-target="mk-card" data-super="1">营销日历<\/a>/.test(admin));
  ok('面板 #mk-card 存在', /id="mk-card"/.test(admin));
  const posMk = admin.indexOf('id="mk-card"'), posSuper = admin.indexOf('id="super-card"');
  ok('面板独立于超管面板（位于其之前）', posMk > 0 && posSuper > 0 && posMk < posSuper);
  ok('超管面板里旧的营销日历页签已移除', !/data-sv="sv-6"/.test(admin));
  ok('节庆库控件齐全', ['fest-list', 'fest-add', 'fest-export', 'fest-import', 'fest-import-file', 'fest-reset', 'fest-clear', 'fest-search']
    .every(id => new RegExp('id="' + id + '"').test(admin)));
  ok('编辑弹窗控件齐全', ['fest-mask', 'fest-name', 'fest-date', 'fest-region', 'fest-cat', 'fest-star', 'fest-lead', 'fest-dur', 'fest-save', 'fest-cancel']
    .every(id => new RegExp('id="' + id + '"').test(admin)));
  ok('后台引入了节庆数据与面板脚本',
    /js\/marketing-data\.js/.test(admin) && /js\/admin-festivals\.js/.test(admin));
  ok('admin-festivals.js 在 marketing-data.js 之后加载',
    admin.indexOf('js/marketing-data.js') < admin.indexOf('js/admin-festivals.js'));

  const ids = (admin.match(/\sid="([^"]+)"/g) || []).map(x => x.replace(/^\sid="|"$/g, ''));
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  ok('后台无重复 id', dup.length === 0, dup.slice(0, 3).join(','));
  const divO = (admin.match(/<div\b/g) || []).length, divC = (admin.match(/<\/div>/g) || []).length;
  ok('后台 div 标签闭合平衡', divO === divC, divO + '/' + divC);

  ok('面板权限归到超管', /"mk-card":\s*"super"/.test(adminJs));
  ok('进入面板时加载节庆库', /target === "mk-card"[\s\S]{0,120}loadFestivalsPanel/.test(adminJs));
  ok('超管面板不再负责营销加载', !/target === "super-card"\)\s*\{[^}]*loadMarketingNodes/.test(adminJs));

  console.log('\n=== 二、建表脚本 ===');
  ok('节庆库表已定义', /create table if not exists public\.marketing_festivals/.test(sql));
  ok('补字段可重复执行', (sql.match(/add column if not exists/g) || []).length >= 10);
  ok('开启了行级安全', /alter table public\.marketing_festivals enable row level security/.test(sql));
  ok('登录可读、仅超管可写',
    /for select[\s\S]{0,120}using \(true\)/.test(sql) &&
    /role = 'super_admin'/.test(sql));
  ok('建策略前先 drop（可重复执行）', /drop policy if exists "authenticated read marketing_festivals"/.test(sql));
  ok('接口已就位', /async listFestivals/.test(sbJs) && /async upsertFestivals/.test(sbJs) && /async clearFestivals/.test(sbJs));

  console.log('\n=== 三、顶部菜单不再闪 ===');
  ['index.html', 'rank.html', 'marketing.html', 'trends.html'].forEach(p => {
    const h = fs.readFileSync(path.join(ROOT, p), 'utf8');
    ok(p + ' 顶部菜单带启动态（先不画、判定后再露出）', /class="top-tabs is-booting"/.test(h));
  });
  ok('启动态样式存在', /\.top-tabs\.is-booting \.tab-link \{ visibility: hidden; \}/.test(css));
  ok('判定完成后解除启动态', /renderNav\(\);\s*tabs\.classList\.remove\("is-booting"\);/.test(commonJs));
  ok('配置读不到时有兜底计时器', /__navBootTimer/.test(commonJs) && /1500/.test(commonJs));

  console.log('\n=== 四、洲筛选体验 ===');
  ok('洲行钉在面板顶部（滚动不丢）', /\.mkzone \.rg-row \{[^}]*position: sticky/.test(css));
  ok('国家区紧跟洲行（无虚线分隔）', !/\.mkzone \.rg-detail \{[^}]*border-top: 1px dashed/.test(css));
  ok('面板内可滚动', /\.mkzone \.region-list \{[^}]*max-height/.test(css));
  ok('移出后收起有更长的缓冲', /}, 700\);\s*\/\* 给足时间从洲名移到国家区/.test(mainJs));
  ok('切洲延时更短（更跟手）', /}, 60\);/.test(mainJs));

  console.log('\n=== 五、面板运行时 ===');
  const startMark = '<div class="panel-card hidden" id="mk-card">';
  const endMark = '<div class="panel-card hidden" id="super-card">';
  const frag = admin.slice(admin.indexOf(startMark), admin.indexOf(endMark));
  const dom = new JSDOM('<!doctype html><html><body>' + frag + '</body></html>', { runScripts: 'outside-only', url: 'https://x.test/admin' });
  const w = dom.window, d = w.document;

  const store = { rows: [] };
  const calls = { upsert: 0, del: 0, clear: 0 };
  w.SB = {
    listFestivals: async () => ({ data: store.rows.map(r => Object.assign({}, r)), error: null }),
    upsertFestivals: async (rows) => {
      calls.upsert++;
      (rows || []).forEach(r => {
        const i = store.rows.findIndex(x => x.id === r.id);
        if (i >= 0) store.rows[i] = Object.assign({}, r); else store.rows.push(Object.assign({}, r));
      });
      return { error: null };
    },
    deleteFestival: async (id) => { calls.del++; store.rows = store.rows.filter(r => r.id !== id); return { error: null }; },
    clearFestivals: async () => { calls.clear++; store.rows = []; return { error: null }; },
  };
  w.confirm = () => w.__confirmAnswer !== false;
  w.alert = () => {};

  w.eval(dataJs);
  w.eval(festJs);
  ok('面板脚本导出加载入口', typeof w.loadFestivalsPanel === 'function');

  w.loadFestivalsPanel();
  await new Promise(r => setTimeout(r, 60));
  ok('空库时给出明确空态提示', /数据库里还没有节庆/.test(d.getElementById('fest-empty').textContent), d.getElementById('fest-empty').textContent.slice(0, 24));
  ok('空库时统计文案正确', /还没有节庆/.test(d.getElementById('fest-stat').textContent));

  store.rows = [
    { id: 'd0', name: '元旦', date: '01-01', region: '全球', cat: 'trad', star: 4, lead: 150, dur: 3, sort_no: 0 },
    { id: 'd1', name: '万圣节', date: '10-31', region: '美国', cat: 'trad', star: 5, lead: 120, dur: 1, sort_no: 1 },
    { id: 'd2', name: '圣诞节', date: '12-25', region: '欧美', cat: 'rel', star: 5, lead: 130, dur: 2, sort_no: 2, overrides: { '2027': '12-25' } },
  ];
  w.loadFestivalsPanel();
  await new Promise(r => setTimeout(r, 60));
  eq('读到 3 条并渲染 3 行', d.querySelectorAll('#fest-list .fest-row:not(.fest-head)').length, 3);
  ok('浮动节日有标记', /年度浮动/.test(d.getElementById('fest-list').innerHTML));
  ok('统计显示总数', /共 3 个节庆/.test(d.getElementById('fest-stat').textContent));

  const search = d.getElementById('fest-search');
  search.value = '美国';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  eq('搜索按地区过滤', d.querySelectorAll('#fest-list .fest-row:not(.fest-head)').length, 1);
  search.value = '';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  eq('清空搜索恢复全部', d.querySelectorAll('#fest-list .fest-row:not(.fest-head)').length, 3);

  /* 新建 */
  d.getElementById('fest-add').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('新建弹窗打开', !d.getElementById('fest-mask').classList.contains('hidden'));
  eq('类别下拉已填充', d.getElementById('fest-cat').options.length >= 6, true);
  d.getElementById('fest-name').value = '测试新节';
  d.getElementById('fest-date').value = '2027-03-08';
  d.getElementById('fest-region').value = '日本';
  d.getElementById('fest-save').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  eq('新建写入数据库', calls.upsert, 1);
  eq('数据库多了一条', store.rows.length, 4);
  ok('日期被归一化为 MM-DD', store.rows.some(r => r.name === '测试新节' && r.date === '03-08'));
  ok('保存后弹窗关闭', d.getElementById('fest-mask').classList.contains('hidden'));
  eq('列表同步为 4 行', d.querySelectorAll('#fest-list .fest-row:not(.fest-head)').length, 4);

  /* 校验拦截 */
  d.getElementById('fest-add').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  d.getElementById('fest-name').value = '';
  d.getElementById('fest-save').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  eq('名称为空时不写库', calls.upsert, 1);
  d.getElementById('fest-name').value = '日期非法';
  d.getElementById('fest-date').value = '13-45';
  d.getElementById('fest-save').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  eq('日期非法时不写库', calls.upsert, 1);
  d.getElementById('fest-cancel').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('取消关闭弹窗', d.getElementById('fest-mask').classList.contains('hidden'));

  /* 编辑 */
  const rowWan = Array.from(d.querySelectorAll('#fest-list .fest-row')).find(r => /万圣节/.test(r.textContent));
  rowWan.querySelector('button[data-act="edit"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  eq('编辑回填名称', d.getElementById('fest-name').value, '万圣节');
  d.getElementById('fest-name').value = '万圣节(改)';
  d.getElementById('fest-save').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  ok('编辑已落库', store.rows.some(r => r.name === '万圣节(改)'));
  eq('编辑不再新增记录', store.rows.length, 4);

  /* 删除：先拒绝再确认 */
  w.__confirmAnswer = false;
  let rowT = Array.from(d.querySelectorAll('#fest-list .fest-row')).find(r => /万圣节/.test(r.textContent));
  rowT.querySelector('button[data-act="del"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  eq('取消确认时不删除', calls.del, 0);
  w.__confirmAnswer = true;
  rowT = Array.from(d.querySelectorAll('#fest-list .fest-row')).find(r => /万圣节/.test(r.textContent));
  rowT.querySelector('button[data-act="del"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  eq('确认后删除', calls.del, 1);
  eq('数据库剩 3 条', store.rows.length, 3);

  /* 重建 + 清空 */
  d.getElementById('fest-reset').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  ok('用内置库重建写入 >=150 条', store.rows.length >= 150, store.rows.length);
  ok('重建后列表已刷新', d.querySelectorAll('#fest-list .fest-row:not(.fest-head)').length >= 150);
  d.getElementById('fest-clear').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  eq('清空调用一次', calls.clear, 1);
  eq('清空后无记录', store.rows.length, 0);
  ok('清空后回到空态提示', /数据库里还没有节庆/.test(d.getElementById('fest-empty').textContent));

  /* 导出：捕获 Blob 内容 */
  store.rows = [{ id: 'x1', name: '导出用', date: '05-05', region: '全球', cat: 'trad', star: 3, lead: 100, dur: 1, sort_no: 0 }];
  w.loadFestivalsPanel();
  await new Promise(r => setTimeout(r, 60));
  let captured = null, fileName = '';
  const origCreate = w.document.createElement.bind(w.document);
  w.document.createElement = function (tag) {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === 'a') {
      el.click = function () { fileName = el.download; };
    }
    return el;
  };
  const OrigBlob = w.Blob;
  w.Blob = function (parts, opts) { captured = String(parts[0]); return new OrigBlob(parts, opts); };
  w.URL.createObjectURL = () => 'blob:fake';
  w.URL.revokeObjectURL = () => {};
  d.getElementById('fest-export').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  ok('导出文件名带日期', /^festival-library-\d{4}-\d{2}-\d{2}\.json$/.test(fileName), fileName);
  let expObj = null;
  try { expObj = JSON.parse(captured); } catch (e) {}
  ok('导出内容是合法 JSON 且含节庆数组', !!expObj && Array.isArray(expObj.festivals) && expObj.festivals.length === 1);
  ok('导出保留了地区与类别', expObj && expObj.festivals[0].region === '全球' && expObj.festivals[0].cat === 'trad');

  /* 导入：混入坏数据 */
  const before = calls.upsert;
  const fileInput = d.getElementById('fest-import-file');
  const payload = JSON.stringify({ festivals: [
    { name: '导入好节', date: '06-06', region: '韩国', cat: 'trad', star: 4, lead: 90, dur: 2 },
    { name: '', date: '07-07' },
    { name: '日期坏', date: 'abc' },
  ] });
  const fakeFile = new w.File([payload], 'a.json', { type: 'application/json' });
  Object.defineProperty(fileInput, 'files', { value: [fakeFile], configurable: true });
  fileInput.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  ok('导入触发一次写库', calls.upsert === before + 1, calls.upsert + '/' + (before + 1));
  ok('导入写入合法记录并跳过坏记录', store.rows.some(r => r.name === '导入好节') && store.rows.length === 2, store.rows.length);

  w.close();

  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('运行异常：', e && e.message); process.exit(1); });
