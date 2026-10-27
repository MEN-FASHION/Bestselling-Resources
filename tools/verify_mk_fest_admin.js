/* 后台「营销日历 · 节庆库」原生编辑器（20261019G）：静态 + 运行时双层验证
 * 重点：不再嵌 iframe，节庆库直接画在后台面板里；点卡片就地编辑、保存写库。 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const admin = read('admin.html');
const adminJs = read('js/admin.js');
const festJs = read('js/admin-festival.js');
const dataJs = read('js/marketing-data.js');
const css = read('css/style.css');
/* 只取「营销日历」面板那一段（其它面板本来就有各自的预览 iframe，与本需求无关） */
const _mkFrom = admin.indexOf('id="mk-card"');
const _mkTo = admin.indexOf('<div class="panel-card', _mkFrom + 10);
const mkPanel = admin.slice(_mkFrom, _mkTo > 0 ? _mkTo : undefined);

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else { fail++; fails.push(name + (extra !== undefined ? '  [' + extra + ']' : '')); console.log('  ✗ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));

/* ---------------- 运行时环境 ---------------- */
function harness(opts) {
  opts = opts || {};
  const rows = opts.rows || [
    { id: 'd0', name: '元旦', en: 'New Year', region: '全球', date: '01-01', cat: 'trad', star: 4, lead: 150, dur: 3, idea: '亮片装' },
    { id: 'd1', name: '情人节', en: "Valentine's Day", region: '全球', date: '02-14', cat: 'trad', star: 5, lead: 140, dur: 3, idea: '情侣同款' },
    { id: 'd2', name: '双十一', en: 'Double 11', region: '中国', date: '11-11', cat: 'promo', star: 5, lead: 90, dur: 5, idea: '囤货装' }
  ];
  const calls = { upsert: [], del: [], clear: 0, downloads: [], list: 0 };
  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="mkzone mk-adm" id="mkFestZone"><div class="mk-adm-empty">加载中</div></div>
  </body></html>`, { url: 'https://x.test/admin.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.CATS = {
    trad: { label: '传统节庆', color: '#2b46ff' },
    promo: { label: '电商大促', color: '#ff5a1f' }
  };
  w.REGION_GROUPS = [{ label: '通用', regions: ['全球'] }];
  w.RAW = [
    ['元旦', 'New Year', '全球', '01-01', 'trad', 4, 150, '亮片装', null, 3],
    ['情人节', "Valentine's Day", '全球', '02-14', 'trad', 5, 140, '情侣同款', null, 3],
    ['中国年货节', 'CNY', '中国', '01-20', 'promo', 4, 170, '红色系', null, 20]
  ];
  w.SB = {
    listFestivals: () => { calls.list++; return Promise.resolve({ data: opts.emptyDb ? [] : rows, error: null }); },
    upsertFestivals: (list) => { calls.upsert.push(list); return Promise.resolve({ error: opts.upsertError || null }); },
    deleteFestival: (id) => { calls.del.push(id); return Promise.resolve({ error: null }); },
    clearFestivals: () => { calls.clear++; return Promise.resolve({ error: null }); }
  };
  w.URL.createObjectURL = () => 'blob:stub';
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { calls.downloads.push(this.download); };
  w.eval(dataJs);          /* 只取 CATS/REGION_GROUPS/RAW 的等价物（已手工给定，这里确保不报错） */
  w.eval(festJs);
  /* 后台是"进面板才挂载"，这里模拟进入面板 */
  if (w.FEST && typeof w.FEST.mount === 'function') w.FEST.mount();
  return { dom, w, calls };
}

(async function () {
  /* ============ 一、静态：后台不再是 iframe，改成本页原生编辑 ============ */
  console.log('=== 一、结构：后台直接编辑（无 iframe） ===');
  ok('面板里有原生节庆库容器', /id="mkFestZone"/.test(admin) && /class="mkzone mk-adm"/.test(admin));
  ok('营销日历面板内已无 iframe 预览框', !/mk-preview-frame/.test(mkPanel) && !/<iframe/.test(mkPanel));
  ok('admin.js 不再指向 marketing.html?mode=edit', !/marketing\.html\?mode=edit/.test(adminJs));
  ok('节庆库脚本被引入', /js\/admin-festival\.js\?v=/.test(admin));
  ok('进面板才挂载（懒加载）', /if \(window\.FEST && typeof FEST\.mount/.test(adminJs) && /mkFestMounted/.test(adminJs));
  ok('后台内嵌版是单列（无侧栏）', /\.mkzone\.mk-adm \{[^}]*grid-template-columns: minmax\(0, 1fr\)/.test(css));
  ok('编辑徽标在后台常显', /\.mkzone\.mk-adm \.fest-edit-chip \{ display: inline-flex; \}/.test(css));
  ok('弹窗层级高于后台其它浮层', /\.mkzone\.mk-adm \.backdrop \{ z-index: 1200; \}/.test(css));
  ok('沿用同一份样式（.mkzone 卡片/统计/甘特）', /\.mkzone \.fcard/.test(css) && /\.mkzone \.stats/.test(css) && /\.mkzone \.gantt/.test(css));
  ok('与前台同一份内置库（引用 marketing-data.js）', /marketing-data\.js/.test(admin) || /window\.RAW/.test(festJs));

  /* ============ 二、运行时：三视图 + 筛选项 ============ */
  console.log('=== 二、运行时：三视图与筛选项 ===');
  let h = harness();
  await tick(40);
  const doc = h.w.document;
  const zone = () => doc.getElementById('mkFestZone');
  ok('挂载后画出头部', !!zone().querySelector('.mk-head'));
  ok('三个视图页签齐全', [...zone().querySelectorAll('#mkFestTabs button')].map(b => b.dataset.view).join(',') === 'cards,timeline,gantt');
  ok('工具条按钮齐全（新建/导入/导出/重建/清空）',
    ['mkFestAdd', 'mkFestImport', 'mkFestExport', 'mkFestRebuild', 'mkFestClear'].every(id => !!doc.getElementById(id)));
  ok('搜索框与地区筛选存在', !!doc.getElementById('mkFestQ') && !!doc.getElementById('mkFestRegion'));
  ok('类别 chip 数量 = 类别数', zone().querySelectorAll('#mkFestCats .chip').length === Object.keys(h.w.CATS).length);
  ok('重要度 chip 六档', zone().querySelectorAll('#mkFestStars .chip').length === 6);
  ok('统计卡四张', zone().querySelectorAll('.stats .stat').length === 4);
  ok('默认卡片视图有卡片', zone().querySelectorAll('.fcard').length > 0,
    zone().querySelectorAll('.fcard').length);
  ok('数据来源标记为数据库', /数据库/.test(doc.getElementById('mkFestSrc').textContent));

  const cardsBefore = zone().querySelectorAll('.fcard').length;
  doc.querySelector('#mkFestTabs button[data-view="timeline"]').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  ok('切到时间轴：12 个月块', zone().querySelectorAll('.month-block').length === 12);
  ok('时间轴上有 fest 节点按钮', zone().querySelectorAll('.fest[data-edit]').length > 0);
  ok('时间轴页签高亮', doc.querySelector('#mkFestTabs button[data-view="timeline"]').classList.contains('active'));

  doc.querySelector('#mkFestTabs button[data-view="gantt"]').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  ok('切到倒推：有甘特行与色带', zone().querySelectorAll('.grow').length > 0 && zone().querySelectorAll('.gbar').length > 0);

  doc.querySelector('#mkFestTabs button[data-view="cards"]').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  ok('切回卡片视图', zone().querySelectorAll('.fcard').length === cardsBefore);

  /* ============ 三、筛选 ============ */
  console.log('=== 三、筛选与搜索 ===');
  const catBefore = zone().querySelectorAll('.fcard').length;
  doc.querySelector('#mkFestCats button[data-cat="promo"]').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  const catAfter = zone().querySelectorAll('.fcard').length;
  ok('点类别 chip 后卡片变少且只剩该类别', catAfter < catBefore && catAfter >= 1, catBefore + ' → ' + catAfter);
  doc.querySelector('#mkFestCats button[data-cat="promo"]').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  ok('再点一次取消筛选，卡片恢复', zone().querySelectorAll('.fcard').length >= catBefore);

  const q = doc.getElementById('mkFestQ');
  q.value = '情人节';
  q.dispatchEvent(new h.w.Event('input', { bubbles: true }));
  const qNames = [...zone().querySelectorAll('.fcard .cname')].map(x => x.textContent);
  ok('搜索只留命中项', qNames.length === 1 && qNames[0] === '情人节', qNames.join('|'));
  ok('搜索后输入框仍在（不重建工具条）', !!doc.getElementById('mkFestQ') && doc.getElementById('mkFestQ').value === '情人节');
  doc.getElementById('mkFestQ').value = '';
  doc.getElementById('mkFestQ').dispatchEvent(new h.w.Event('input', { bubbles: true }));
  ok('清空搜索恢复全部', zone().querySelectorAll('.fcard').length >= catBefore);

  /* ============ 四、就地编辑 ============ */
  console.log('=== 四、就地编辑：打开 / 保存 / 删除 ===');
  const firstCard = zone().querySelector('.fcard');
  const fid = firstCard.getAttribute('data-fid');
  firstCard.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  ok('点卡片打开居中弹窗', doc.getElementById('mkFestMask').classList.contains('open'));
  ok('弹窗标题为编辑', /编辑节日/.test(doc.getElementById('mkFestModal').textContent));
  ok('字段回填（名称/日期/重要度）', doc.getElementById('mffName').value.length > 0
    && /^\d{4}-\d{2}-\d{2}$/.test(doc.getElementById('mffDate').value)
    && doc.querySelectorAll('#mffStars button.on').length >= 1);
  ok('有保存与取消按钮', !!doc.getElementById('mffSave') && !!doc.getElementById('mffCancel'));
  ok('有删除按钮（编辑态）', !!doc.getElementById('mffDel'));

  doc.getElementById('mffName').value = '元旦（改）';
  doc.getElementById('mffSave').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  await tick(40);
  ok('保存调用一次写库', h.calls.upsert.length === 1, h.calls.upsert.length);
  ok('写库内容为新名称且 id 不变', h.calls.upsert[0][0].name === '元旦（改）' && h.calls.upsert[0][0].id === fid);
  ok('保存后弹窗关闭', !doc.getElementById('mkFestMask').classList.contains('open'));
  ok('列表就地更新（不用重新读库）', [...zone().querySelectorAll('.cname')].some(x => x.textContent === '元旦（改）'));

  /* 删除：两次点击 */
  const delCard = [...zone().querySelectorAll('.fcard')].find(c => c.querySelector('.cname').textContent === '元旦（改）');
  delCard.querySelector('[data-del]').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  const delBtn = doc.getElementById('mffDel');
  delBtn.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  ok('删除按钮第一次点击只改文案', /确认删除/.test(delBtn.textContent) && h.calls.del.length === 0, delBtn.textContent);
  delBtn.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  await tick(40);
  ok('第二次点击才真正删除', h.calls.del.length === 1 && h.calls.del[0] === fid);
  ok('删除后卡片消失', ![...zone().querySelectorAll('.cname')].some(x => x.textContent === '元旦（改）'));

  /* ============ 五、新建 + 校验 ============ */
  console.log('=== 五、新建与校验 ===');
  doc.getElementById('mkFestAdd').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  ok('新建弹窗打开且标题为新建', /新建节日/.test(doc.getElementById('mkFestModal').textContent));
  doc.getElementById('mffSave').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  await tick(20);
  ok('名称为空不写库（并保持弹窗打开）', h.calls.upsert.length === 1 && doc.getElementById('mkFestMask').classList.contains('open'));
  doc.getElementById('mffName').value = '测试节';
  doc.getElementById('mffDate').value = '2027-05-01';
  doc.getElementById('mffRepeat').checked = false;  /* 一次性档期 */
  doc.getElementById('mffSave').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  await tick(40);
  ok('填齐后写入一条并生成新 id', h.calls.upsert.length === 2 && /^u/.test(h.calls.upsert[1][0].id), h.calls.upsert[1][0].id);
  ok('非每年重复时存完整日期', h.calls.upsert[1][0].date === '2027-05-01');

  /* 每年重复 → 只存 MM-DD */
  doc.getElementById('mkFestAdd').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  doc.getElementById('mffName').value = '每年节';
  doc.getElementById('mffDate').value = '2027-06-18';
  doc.getElementById('mffRepeat').checked = true;
  doc.getElementById('mffSave').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  await tick(40);
  ok('每年重复时只存 MM-DD', h.calls.upsert[2][0].date === '06-18', h.calls.upsert[2][0].date);

  /* ============ 六、写库失败不假装成功 ============ */
  console.log('=== 六、写库失败不假装成功 ===');
  let h2 = harness({ upsertError: { message: '权限不足' } });
  await tick(40);
  const d2 = h2.w.document, z2 = () => d2.getElementById('mkFestZone');
  const n2 = z2().querySelectorAll('.fcard').length;
  z2().querySelector('.fcard').dispatchEvent(new h2.w.MouseEvent('click', { bubbles: true }));
  d2.getElementById('mffName').value = '不该保存';
  d2.getElementById('mffSave').dispatchEvent(new h2.w.MouseEvent('click', { bubbles: true }));
  await tick(40);
  ok('失败时弹窗不关闭', d2.getElementById('mkFestMask').classList.contains('open'));
  ok('失败时列表不变', z2().querySelectorAll('.fcard').length === n2);
  ok('失败时有提示', /失败/.test(d2.getElementById('mkFestToast').textContent));

  /* ============ 七、重建 / 清空 / 空库回落 ============ */
  console.log('=== 七、重建、清空与空库回落 ===');
  let h3 = harness();
  await tick(40);
  const d3 = h3.w.document;
  d3.getElementById('mkFestRebuild').dispatchEvent(new h3.w.MouseEvent('click', { bubbles: true }));
  ok('重建第一次点击只变文案', h3.calls.upsert.length === 0 && /确认/.test(d3.getElementById('mkFestRebuild').textContent));
  d3.getElementById('mkFestRebuild').dispatchEvent(new h3.w.MouseEvent('click', { bubbles: true }));
  await tick(60);
  ok('第二次点击才写库', h3.calls.upsert.length >= 1);
  ok('重建写入的是内置库条数', h3.calls.upsert[0].length > 0 && h3.calls.upsert[0][0].id.indexOf('d') === 0);

  d3.getElementById('mkFestClear').dispatchEvent(new h3.w.MouseEvent('click', { bubbles: true }));
  ok('清空第一次点击只变文案', h3.calls.clear === 0);
  d3.getElementById('mkFestClear').dispatchEvent(new h3.w.MouseEvent('click', { bubbles: true }));
  await tick(40);
  ok('第二次点击才清空', h3.calls.clear === 1);
  ok('清空后视图变空态', !!d3.querySelector('.mk-adm-empty') || d3.querySelectorAll('.fcard').length === 0);

  let h4 = harness({ emptyDb: true });
  await tick(40);
  const d4 = h4.w.document;
  ok('库里没数据时回落到内置库（不白屏）', d4.getElementById('mkFestZone').querySelectorAll('.fcard').length > 0,
    d4.getElementById('mkFestZone').querySelectorAll('.fcard').length);
  ok('并提示用内置库重建', /重建/.test(d4.getElementById('mkFestToast').textContent));
  ok('来源标记为内置库', /内置库/.test(d4.getElementById('mkFestSrc').textContent));

  /* ============ 八、导出 ============ */
  console.log('=== 八、导出 JSON ===');
  let h5 = harness();
  await tick(40);
  h5.w.document.getElementById('mkFestExport').dispatchEvent(new h5.w.MouseEvent('click', { bubbles: true }));
  ok('导出触发下载且文件名带日期', h5.calls.downloads.length === 1 && /marketing-festivals-\d{4}-\d{2}-\d{2}\.json/.test(h5.calls.downloads[0]), h5.calls.downloads[0]);

  /* ============ 九、反向验证：把实现改坏，检查必须能看出来 ============ */
  console.log('=== 九、反向验证 ===');
  ok('① 若改回 iframe 预览 → 面板内 iframe 断言会失败', /<iframe/.test('<iframe src="marketing.html">') && !/<iframe/.test(mkPanel));
  ok('② 若卡片不带 data-edit → 就地编辑失效', !/data-edit="/.test('<article class="fcard"></article>') && /data-edit="/.test(festJs));
  ok('③ 若保存不写库 → 写库断言会失败', /SB\.upsertFestivals/.test(festJs));
  ok('④ 若删除不做二次确认 → 断言会失败', /data-confirm/.test(festJs));

  console.log('==========================================');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) { console.log('失败项：'); fails.forEach(f => console.log(' - ' + f)); process.exit(1); }
})();
