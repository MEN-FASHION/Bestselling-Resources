/* 校验：视图切换（节庆卡片/年度时间轴/开发倒推）与视图标题处于同一行，各视图不再各自重复标题 */
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(R, 'marketing.html'), 'utf8');
const js = fs.readFileSync(path.join(R, 'js/marketing-main.js'), 'utf8');
const css = fs.readFileSync(path.join(R, 'css/style.css'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (e ? ' → ' + e : ''))); };

console.log('一、结构：标题与切换按钮同一行');
ok('工具条内含标题容器', /class="mk-head mk-toolbar"[\s\S]{0,200}id="mkViewTitle"/.test(html));
ok('工具条内含副标题', /id="mkViewSub"/.test(html));
ok('三个视图按钮仍在同一工具条内', /id="viewTabs"[\s\S]{0,400}data-view="cards"[\s\S]{0,300}data-view="timeline"[\s\S]{0,300}data-view="gantt"/.test(html));
ok('标题在切换按钮之前（左标题右按钮）', html.indexOf('id="mkViewTitle"') < html.indexOf('id="viewTabs"'));
ok('今日日期与按钮同一行右侧', /id="viewTabs"[\s\S]{0,600}id="todayText"/.test(html));
ok('页面里不再有独立的旧工具条行', (html.match(/class="mk-head mk-toolbar"/g) || []).length === 1);

console.log('二、各视图不再重复输出标题');
ok('renderCards 不再输出 sec-head', !/function renderCards\(list\)\{[\s\S]{0,200}sec-head/.test(js));
ok('renderTimeline 不再输出 sec-head', !/function renderTimeline\(list\)\{[\s\S]{0,200}sec-head/.test(js));
ok('renderGantt 不再输出 sec-head', !/function renderGantt\(list\)\{[\s\S]{0,300}sec-head/.test(js));
ok('全文仅剩「已发布营销素材」一处 sec-head', (js.match(/class="sec-head"/g) || []).length === 0, '（营销素材那块在 HTML 里）');
ok('标题随视图切换的函数存在', /function renderViewTitle\(list\)\{/.test(js));
ok('三档标题文案齐全', /'年度时间轴'/.test(js) && /'开发倒推推演'/.test(js) && /'节庆机会卡片'/.test(js));
ok('时间轴副标题带节点数', /未来 12 个月 · 共 ' \+ list\.length/.test(js));
ok('render() 内调用标题刷新', /renderFilters\(\);\s*\n\s*renderViewTitle\(list\);/.test(js));

console.log('三、样式');
ok('工具条有下边线与间距', /\.mkzone \.mk-head\.mk-toolbar \{[\s\S]{0,200}border-bottom: 1px solid/.test(css));
ok('标题字号与板块标题一致', /\.mkzone \.mk-head\.mk-toolbar h2 \{ font-size: 20px/.test(css));
ok('右侧组靠右', /\.mkzone \.mk-head\.mk-toolbar \.mk-head-r \{ margin-left: auto/.test(css));
ok('窄屏换行且按钮撑满', /@media \(max-width: 720px\)[\s\S]{0,220}mk-head-r \{ margin-left: 0; width: 100%/.test(css));

console.log('四、页面结构完整');
const d1 = (html.match(/<div\b/g) || []).length, d2 = (html.match(/<\/div>/g) || []).length;
const s1 = (html.match(/<section\b/g) || []).length, s2 = (html.match(/<\/section>/g) || []).length;
ok('div 配平', d1 === d2, d1 + '/' + d2);
ok('section 配平', s1 === s2, s1 + '/' + s2);

console.log('\n结果: 通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
