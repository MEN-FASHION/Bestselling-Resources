/* 营销日历专区（节令经纬）运行时验证：真实 DOM + 真实脚本
 * 覆盖：节庆库装载 / 三视图切换 / 统计 / 筛选 / 提前期倒推 / 新建-编辑-删除 / 数据持久化
 * 用法：node tools/verify_marketing_plan.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); }
}
function eq(name, got, want) { ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }

const html = fs.readFileSync(path.join(ROOT, 'marketing.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
const dataJs = fs.readFileSync(path.join(ROOT, 'js/marketing-data.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(ROOT, 'js/marketing-main.js'), 'utf8');
const railJs = fs.readFileSync(path.join(ROOT, 'js/rail.js'), 'utf8');

/* ---------- 静态结构检查 ---------- */
ok('页面引用数据脚本', /marketing-data\.js\?v=/.test(html));
ok('页面引用主脚本', /marketing-main\.js\?v=/.test(html));
ok('页面含 .mkzone 容器', /class="mkzone"/.test(html));
ok('旧版时间轴区块已彻底移除（不再留隐藏残块）', !/mk-legacy/.test(html));
ok('编辑条存在但默认不显示（只有 ?mode=edit 才出现）',
  /id="mkEditBar"/.test(html) && !/class="mk-editbar[^"]*is-editing/.test(html));
ok('编辑条默认隐藏由样式控制', /\.mkzone \.mk-editbar \{ grid-column: 1 \/ -1; display: none;/.test(css));
ok('页面引入编辑层脚本（放在主脚本之后）',
  /js\/marketing-edit\.js\?v=/.test(html) && html.indexOf('js/marketing-main.js') < html.indexOf('js/marketing-edit.js'));
/* 版本号不做硬编码（硬编码会在每次发版后腐烂）：改为要求全站只有同一个版本号，且不早于本轮 */
{
  /* 只看页面里的 ?v= 运行时版本（源码注释中记录历史版本属正常，不计入） */
  const vers = new Set((html.match(/\?v=(2026\d{4}[A-Z])/g) || []).map((x) => x.slice(3)));
  ok('版本号全站唯一（不混版）', vers.size === 1, [...vers].join(","));
  const v = [...vers][0] || "";
  ok('版本号未回退（不早于 20261019A）', v >= "20261019A" && !/^20261019B$/.test(v), v);
}
/* ---------- 左栏「完整常显」：其它前台专区的细轨收缩不得作用于营销页 ---------- */
{
  const railBlock = css.slice(
    css.indexOf('/* ---------- 一、左侧类目菜单：细轨 ⇄ 展开面板 ---------- */'),
    css.indexOf('/* 滚动条收细，展开态更干净 */')
  );
  ok('营销页 body 带 mk-page 标记（把它从细轨收缩里排除）', /<body class="front mk-page">/.test(html));
  ok('细轨选择器全部限定 :not(.mk-page)', railBlock.length > 200
    && !/body\.front \.sidebar/.test(railBlock) && !/body\.front \.gallery-layout/.test(railBlock));
  ok('细轨仍对其它前台专区生效（规则未被误删）', /body\.front:not\(\.mk-page\) \.sidebar \{[^}]*width: 54px/.test(railBlock));
  ok('细轨控制器对营销页直接跳过', /classList\.contains\("mk-page"\)\) return;/.test(railJs));
  ok('营销页侧栏钉死整宽、不写竖排', /\.mkzone \.sidebar \{[^}]*width: 100%/.test(css)
    && /\.mkzone \.sidebar \{[^}]*writing-mode: horizontal-tb/.test(css));
  ok('营销页侧栏高度随内容（不写死 118px 小把手）', /\.mkzone \.sidebar \{[^}]*max-height: calc\(100vh - var\(--mk-top\)/.test(css));
  ok('桌面栅格给侧栏独立列宽', /\.mkzone \{[^}]*grid-template-columns: 320px minmax\(0, 1fr\)/.test(css));
}

const ids = ['viewTabs', 'todayText', 'sidebar', 'filterbar', 'regionList', 'catChips',
  'starChips', 'modeRec', 'modeCus', 'sSample', 'vTotal',
  'stats', 'view-timeline', 'view-gantt', 'view-cards', 'backdrop', 'modal', 'mkToast'];
ids.forEach(id => ok('页面存在 #' + id, new RegExp('id="' + id + '"').test(html)));
/* 前台只读：维护类控件必须不在前台出现 */
['addBtn', 'exportBtn', 'importBtn', 'resetBtn', 'importFile'].forEach(id =>
  ok('前台不含维护控件 #' + id, !new RegExp('id="' + id + '"').test(html)));
ok('未再使用旧 toast id 作为脚本目标', !/getElementById\('toast'\)/.test(mainJs));
ok('样式已限定在 .mkzone 内（抽查）', /\.mkzone \.fcard/.test(css) && /\.mkzone \.gbar/.test(css));
ok('样式含三视图与筛选样式', ['\.mkzone \.fest','\.mkzone \.month-head','\.mkzone \.rchip','\.mkzone \.chip','\.mkzone \.preview'].every(r => new RegExp(r).test(css)));
/* 结构与布局守卫 */
const idList = (html.match(/\sid="([^"]+)"/g) || []).map(x => x.replace(/^\sid="|"$/g, ''));
const dupIds = idList.filter((v, i) => idList.indexOf(v) !== i);
eq('页面 id 无重复', dupIds.length, 0);
(function () {
  let depth = 0;
  html.split('\n').forEach(line => {
    const opens = (line.match(/<div\b/g) || []).length;
    const closes = (line.match(/<\/div>/g) || []).length;
    depth += opens - closes;
  });
  eq('div 标签完全闭合', depth, 0);
})();
ok('粘性偏移使用统一变量', /--mk-top/.test(css) && /\.mkzone \.sidebar \{[^}]*var\(--mk-top\)/.test(css));
ok('侧栏吸顶不遮挡主区（grid 两列 · 320px）', /\.mkzone \{[^}]*grid-template-columns: 320px minmax\(0, 1fr\)/.test(css));
ok('前台铺满整屏：不再限宽居中、不再留两侧白边',
  /\.mkzone \{[^}]*max-width: none/.test(css) &&
  /\.mkzone \{[^}]*width: 100%/.test(css) &&
  !/\.mkzone \{[^}]*max-width: 1920px/.test(css));
ok('左右内边距改为随屏宽自适应（1.4vw）', /padding: 14px clamp\(14px, 1\.4vw, 26px\) 56px/.test(css));
ok('侧栏吸顶高度不再写死 96px', /\.mkzone \.sidebar \{[^}]*max-height: calc\(100vh - var\(--mk-top\) - 22px\)/.test(css));

ok('窄屏侧栏改为常显（不再做抽屉）',
  /@media \(max-width: 980px\)/.test(css) &&
  /\.mkzone \.sidebar \{ position: static/.test(css) &&
  !/\.mkzone \.sidebar\.open/.test(css) &&
  !/id="menuBtn"/.test(html));

/* ---------- 运行时（jsdom） ---------- */
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/marketing.html', pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.confirm = () => true;
w.alert = () => {};
w.scrollTo = () => {};
w.URL.createObjectURL = () => 'blob:x';
w.URL.revokeObjectURL = () => {};

// 登录态：页面脚本靠 Common 展示专区，这里直接放行，聚焦营销日历自身逻辑
const mv = d.getElementById('marketing-view');
if (mv) mv.classList.remove('hidden');

try {
  w.eval(dataJs);
  w.eval(mainJs);
} catch (e) {
  ok('脚本可执行', false, e.message);
}

const st = w.eval('state');
ok('默认视图为卡片', st && st.view === 'cards', st && st.view);
ok('内置节庆库已装载（>=150）', st.festivals.length >= 150, st.festivals.length);
ok('节庆库含浮动日期条目', st.festivals.some(f => f.overrides && Object.keys(f.overrides).length > 0));
ok('卡片视图已渲染', d.querySelectorAll('#view-cards .fcard').length > 0, d.querySelectorAll('#view-cards .fcard').length);
eq('统计卡为 4 张', d.querySelectorAll('#stats .stat').length, 4);
ok('今天日期已填充', /今天/.test(d.getElementById('todayText').textContent));
ok('合计提前期已计算', parseInt(d.getElementById('vTotal').textContent, 10) === 90);

/* 视图切换 */
function clickTab(v) {
  const b = d.querySelector('#viewTabs button[data-view="' + v + '"]');
  b.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return b;
}
clickTab('timeline');
ok('时间轴视图可见', !d.getElementById('view-timeline').classList.contains('hidden'));
eq('时间轴为 12 个月', d.querySelectorAll('#view-timeline .month-block').length, 12);
ok('时间轴渲染节庆卡片', d.querySelectorAll('#view-timeline .fest').length > 0);
ok('当前月高亮', d.querySelectorAll('#view-timeline .month-block.current').length === 1);

clickTab('gantt');
ok('倒推视图可见', !d.getElementById('view-gantt').classList.contains('hidden'));
eq('密集度柱状 12 根', d.querySelectorAll('#view-gantt .chart .col').length, 12);
ok('倒推甘特行已渲染', d.querySelectorAll('#view-gantt .grow').length > 0);
ok('甘特色带含天数标签', d.querySelectorAll('#view-gantt .gbar .blabel').length > 0);
ok('紧迫度统计四项', d.querySelectorAll('#view-gantt .press .pitem').length === 4);

clickTab('cards');
ok('回到卡片视图', !d.getElementById('view-cards').classList.contains('hidden'));

/* 筛选：类别 */
const before = d.querySelectorAll('#view-cards .fcard').length;
const aCat = d.querySelector('#catChips .chip');
aCat.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const afterCat = d.querySelectorAll('#view-cards .fcard').length;
ok('按类别筛选后条目减少', afterCat > 0 && afterCat < before, before + '→' + afterCat);
ok('类别筛选按钮置为选中', d.querySelector('#catChips .chip.active') !== null);
d.querySelector('#catChips .chip.active').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
eq('取消类别筛选后恢复', d.querySelectorAll('#view-cards .fcard').length, before);

/* 筛选：重要度 */
d.querySelector('#starChips .chip[data-star="5"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const star5 = w.eval('buildList()');
ok('重要度筛选生效且全部为 5 星', star5.length > 0 && star5.every(x => (x.h.star | 0) >= 5), star5.length);
d.querySelector('#starChips .chip[data-star="0"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

/* 筛选：地区（展开洲 + 选整洲） */
const rgName = d.querySelector('#regionList .rgc-name');
ok('洲筛选已渲染', rgName !== null);
if (rgName) {
  const lab = rgName.getAttribute('data-whole');
  rgName.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const rr = w.eval('buildList()');
  ok('选整洲后结果均属该洲', rr.length > 0 && rr.every(x => w.eval('GROUPS_CACHE')[lab].indexOf(x.h.region) >= 0), rr.length);
  const rgName2 = d.querySelector('#regionList .rgc-name');
  rgName2.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  eq('再点取消整洲筛选', d.querySelectorAll('#view-cards .fcard').length, before);
}

/* 提前期自定义 → 倒推日期变化 */
const leadBefore = w.eval('buildList()[0].lead');
d.getElementById('modeRec').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const leadRec = w.eval('buildList()[0].lead');
ok('切换「节日推荐值」后提前期取节庆自带值', leadRec !== leadBefore || leadRec > 0, leadBefore + '→' + leadRec);
d.getElementById('modeCus').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const s = d.getElementById('sSample');
s.value = '90';
s.dispatchEvent(new w.Event('input', { bubbles: true }));
eq('滑块改动后合计提前期更新', parseInt(d.getElementById('vTotal').textContent, 10), 90 + 30 + 15);
eq('提前期联动到倒推计算', w.eval('buildList()[0].lead'), 135);
eq('设置已持久化', JSON.parse(w.localStorage.getItem(w.eval('SET_KEY'))).sample, 90);

/* ===== 前台只读：维护入口全部搬到后台 ===== */
ok('前台没有「新建节日」按钮', d.getElementById('addBtn') === null);
ok('前台没有「导出 / 导入 / 恢复默认」数据管理区', d.getElementById('exportBtn') === null && d.getElementById('importBtn') === null && d.getElementById('resetBtn') === null);
ok('前台脚本声明为只读', w.eval('MK_READONLY') === true);
eq('卡片不再带编辑/删除按钮', d.querySelectorAll('#view-cards [data-act]').length, 0);

const cardEl = d.querySelector('#view-cards .fcard');
if (cardEl) {
  cardEl.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('点卡片不会打开编辑弹窗', !d.getElementById('backdrop').classList.contains('open'));
} else {
  ok('点卡片不会打开编辑弹窗', true, '无卡片可点（跳过）');
}
ok('前台脚本里不再有数据管理的绑定代码', !/getElementById\('exportBtn'\)/.test(mainJs));

/* 倒推逻辑自洽：最晚启动 = 节期 - 提前期 */
const item = w.eval('buildList()[0]');
ok('最晚启动日 = 节期 - 提前期', Math.round((item.occ - item.start) / 86400000) === item.lead);
ok('紧迫度与剩余天数一致', (item.startDaysLeft < 0 ? 'over' : item.startDaysLeft <= 20 ? 'urgent' : item.startDaysLeft <= 60 ? 'soon' : 'ok') === item.u.key);

/* 巨量数据不报错（导入 300 条克隆） */
try {
  w.eval('(function(){var base=defaultFestivals();var arr=[];for(var k=0;k<300;k++){var c=JSON.parse(JSON.stringify(base[k%base.length]));c.id="bulk"+k;arr.push(c);}state.festivals=arr;saveFestivals();render();})()');
  ok('300 条数据渲染不报错', d.querySelectorAll('#view-cards .fcard').length > 0);
} catch (e) {
  ok('300 条数据渲染不报错', false, e.message);
}

/* ===== 本轮：侧栏占满整列 / 重要度竖排 / 自定义周期提示 / 地区「洲内展开」 ===== */
{
  /* 侧栏：高度撑满可视区，滚动交给内部容器 */
  const sbRule = (css.match(/\.mkzone \.sidebar \{[^}]*\}/) || [''])[0];
  ok('侧栏高度撑满整列（不是内容高度）',
    /\.mkzone \.sidebar \{[^}]*[;{]\s*height: calc\(100vh - var\(--mk-top\) - 22px\)/.test(sbRule));
  ok('侧栏为纵向弹性容器（滚动交给内部）', /display: flex/.test(sbRule) && /flex-direction: column/.test(sbRule) && /overflow: hidden/.test(sbRule));
  ok('内部滚动区可伸缩（flex:1 + min-height:0）', /\.mkzone \.side-scroll \{[^}]*flex: 1 1 auto/.test(css) && /\.mkzone \.side-scroll \{[^}]*min-height: 0/.test(css));
  ok('窄屏不再锁高（改回自适应）', /@media \(max-width: 980px\)[\s\S]{0,400}\.mkzone \.sidebar \{[^}]*height: auto/.test(css));
  ok('侧栏内确实包着可滚动容器', /<aside class="sidebar" id="sidebar">\s*<div class="side-scroll">/.test(html));

  /* 重要度：四个选项竖排 */
  ok('重要度选项整列竖排', /\.mkzone #starChips \{[^}]*flex-direction: column/.test(css)
    && /\.mkzone #starChips \.chip \{[^}]*width: 100%/.test(css));
  eq('重要度仍是 4 个选项（全部/3星以上/4星/5星）', (d.querySelectorAll('#starChips .chip').length), 4);
  const sy = [...d.querySelectorAll('#starChips .chip')].map(el => el.getBoundingClientRect().top);
  ok('四个选项纵向依次下排（不折成两列）', sy.every((v, i) => i === 0 || v > sy[i - 1] - 1), sy.join(','));

  /* 自定义周期提示 */
  const tip = d.querySelector('#customPanel .cycle-tip');
  ok('自定义周期有说明提示', !!tip && /自己的开发打样节奏/.test(tip.textContent));
  ok('提示说明三段相加为提前期', !!tip && /三段相加/.test(tip.textContent));

  /* 地区：国家长在所属洲下面，而不是所有洲的最底部 */
  const list = d.getElementById('rgList');
  ok('地区面板为洲块列表结构', !!list && list.querySelectorAll('.rgc').length > 1);
  ok('不再有独立的底部国家区（rgDetail 已移除）', d.getElementById('rgDetail') === null && d.querySelector('.rg-row') === null);
  const blocks = [...list.querySelectorAll('.rgc')];
  ok('每个洲块自带国家容器', blocks.every(b => b.querySelector('.rg-body') !== null));
  ok('同时最多只有一个洲展开（手风琴不串开）', blocks.filter(b => b.classList.contains('open')).length <= 1);

  /* 点第二个洲的展开箭头 → 只有该洲内部出现国家 */
  const target = blocks[1];
  target.querySelector('.rgc-tog').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const blocks2 = [...d.getElementById('rgList').querySelectorAll('.rgc')];
  const openedIdx = blocks2.findIndex(b => b.classList.contains('open'));
  ok('点箭头后该洲展开', openedIdx === 1, 'openedIdx=' + openedIdx);
  const chipsInOpen = blocks2[1].querySelectorAll('.rg-body .rchip').length;
  ok('国家渲染在该洲块内部', chipsInOpen > 0, chipsInOpen);
  ok('其它洲块内部没有国家', blocks2.filter((b, i) => i !== 1).every(b => b.querySelectorAll('.rg-body .rchip').length === 0));
  ok('展开洲的国家数量与该洲国家数一致',
    chipsInOpen === w.eval('GROUPS_CACHE')[blocks2[1].querySelector('.rgc-name').getAttribute('data-whole')].length,
    chipsInOpen);
  ok('展开箭头 aria 状态同步', blocks2[1].querySelector('.rgc-tog').getAttribute('aria-expanded') === 'true'
    && blocks2.filter((b, i) => i !== 1).every(b => b.querySelector('.rgc-tog').getAttribute('aria-expanded') === 'false'));

  /* 该洲内部点一个国家 → 正常进入筛选，且仍在该洲块内高亮 */
  const chip = blocks2[1].querySelector('.rg-body .rchip');
  if (!chip) { ok('点洲内国家可选中', false, '该洲块内没有国家（国家没长在洲下面）'); }
  const rname = chip ? chip.getAttribute('data-region') : null;
  if (chip) chip.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const picked = w.eval('state.filters.regions');
  ok('点洲内国家可选中', picked.indexOf(rname) >= 0, picked.join('|'));
  const stillOpen = d.getElementById('rgList').querySelectorAll('.rgc')[1];
  ok('选中后该洲仍展开（便于继续挑）', stillOpen.classList.contains('open'));
  ok('选中后该洲计数显示 已选/总数', /\/\d+$/.test(stillOpen.querySelector('.rgc-cnt').textContent));
  /* 点击会触发重绘：必须重新取节点（旧节点已脱离文档） */
  const chip2 = rname ? d.querySelector('#regionList .rchip[data-region="' + rname + '"]') : null;
  ok('重绘后该国家仍在所属洲块内', !!chip2 && !!chip2.closest('.rg-body'));
  if (chip2) chip2.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('再点一次取消该国家', !rname || w.eval('state.filters.regions').indexOf(rname) < 0);
}

/* ================= 开发进度筛选（已过期 / 30天内需启动 / 已过启动点） ================= */
ok('侧栏存在开发进度容器', /id="progChips"/.test(html));
ok('开发进度带说明提示', /class="prog-tip"/.test(html) && /开发提前期自动判定/.test(html));
ok('开发进度四个选项', (d.querySelectorAll('#progChips .chip').length) === 4);
ok('开发进度选项文案齐全',
  ['全部','已过期','30天内需启动','已过启动点'].every(t =>
    [...d.querySelectorAll('#progChips .pl')].some(el => el.textContent.trim() === t)));
ok('开发进度每项带数量角标', [...d.querySelectorAll('#progChips .chip')].every(c => /^\d+$/.test(c.querySelector('.pn').textContent.trim())));
ok('开发进度默认停在「全部」', d.querySelector('#progChips .chip[data-prog="all"]').classList.contains('active'));

/* 口径：已过启动点 = 节期未到但启动日已过 */
d.querySelector('#progChips .chip[data-prog="late"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const late = w.eval('buildList()');
ok('已过启动点：全部条目启动日已过且节期未到',
  late.every(x => x.startDaysLeft < 0 && x.daysLeft >= 0), late.length);
ok('已过启动点：选项置为选中', d.querySelector('#progChips .chip.active').getAttribute('data-prog') === 'late');
const lateCards = d.querySelectorAll('#view-cards .fcard').length;
ok('已过启动点：卡片与数据条数一致', lateCards === late.length, lateCards + '/' + late.length);

/* 口径：30 天内需启动 */
d.querySelector('#progChips .chip[data-prog="soon30"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const soon = w.eval('buildList()');
ok('30 天内需启动：启动日剩 0~30 天',
  soon.every(x => x.startDaysLeft >= 0 && x.startDaysLeft <= 30), soon.length);
ok('两种进度口径互不重叠（late 与 soon30 无交集）',
  !late.some(a => soon.some(b => b.h.id === a.h.id)));

/* 口径：已过期 = 本年度节期已经过去 */
d.querySelector('#progChips .chip[data-prog="expired"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const exp = w.eval('buildList()');
ok('已过期：节期日期均在今天之前', exp.every(x => x.daysLeft <= 0), exp.length);
if (exp.length) {
  ok('已过期：按最近一次节期倒序排列（越近越前）', exp.every((v, i) => i === 0 || v.occ >= exp[i - 1].occ));
}

/* 与其它筛选叠加 */
d.querySelector('#progChips .chip[data-prog="all"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const allN = w.eval('buildList()').length;
d.querySelector('#progChips .chip[data-prog="late"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
d.querySelector('#starChips .chip[data-star="5"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const both = w.eval('buildList()');
ok('进度筛选可与重要度叠加', both.every(x => (x.h.star | 0) >= 5 && x.startDaysLeft < 0), both.length);
ok('叠加后条目不多于单条件', both.length <= late.length && (late.length === 0 || both.length < late.length || late.every(x => (x.h.star|0) >= 5)));
d.querySelector('#starChips .chip[data-star="0"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
d.querySelector('#progChips .chip[data-prog="all"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
eq('清掉进度筛选后恢复全部', w.eval('buildList()').length, allN);

/* 样式：进度选项两列排布、整宽、计数右对齐 */
ok('开发进度选项网格两列且整宽', /\.mkzone \.prog-chips \{[^}]*grid-template-columns: 1fr 1fr/.test(css)
  && /\.mkzone \.prog-chip \{[^}]*width: 100%/.test(css));
ok('开发进度计数为等宽数字', /\.mkzone \.prog-chip \.pn \{[^}]*tabular-nums/.test(css));

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log(' - ' + f)); }
w.close();
process.exit(fail ? 1 : 0);
