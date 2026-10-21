/* ============================================================
 * 地区分组 & 条数口径 & 素材区块下线 自证
 * 1) 洲分组：7 组、覆盖导入表 205 国与内置库全部地区、无重复归属
 * 2) 条数：进度计数与列表同口径（历史重复行不计数）
 * 3) 前台不再有「已发布营销素材」区块，且有构建标识
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

const dataJs = read('js/marketing-data.js');
const mainJs = read('js/marketing-main.js');
const html = read('marketing.html');
const map = JSON.parse(read('tools/regions_map.json'));

console.log('— 1. 洲分组结构 —');
const gm = dataJs.match(/var REGION_GROUPS = \[([\s\S]*?)\];/);
ok(!!gm, 'REGION_GROUPS 存在');
const groups = [];
(gm[1].match(/\{ label:'([^']+)', regions:\[([^\]]*)\]/g) || []).forEach((blk) => {
  const lab = blk.match(/label:'([^']+)'/)[1];
  const regs = (blk.match(/regions:\[([^\]]*)\]/)[1].match(/'[^']*'/g) || []).map((s) => s.slice(1, -1));
  groups.push({ lab, regs });
});
ok(groups.length === 7, '共 7 个分组（通用 + 六大洲），实际 ' + groups.length);
['通用区域', '亚洲', '欧洲', '北美洲', '南美洲', '大洋洲', '非洲'].forEach((g) => {
  ok(groups.some((x) => x.lab === g), '包含分组：' + g);
});
groups.forEach((g) => ok(g.regs.length > 0, g.lab + ' 下国家数 > 0（' + g.regs.length + '）'));

console.log('— 2. 覆盖与唯一归属 —');
const owner = {};
let dup = [];
groups.forEach((g) => g.regs.forEach((r) => { if (owner[r]) dup.push(r); owner[r] = g.lab; }));
ok(dup.length === 0, '同一地区不重复出现在多个分组（重复 ' + dup.length + '）');
const builtinRegions = [...new Set((dataJs.match(/^\["[^"]+", "[^"]*", "([^"]+)"/gm) || []).map((l) => l.match(/"([^"]+)"$/)[1]))];
const missBuiltin = builtinRegions.filter((r) => !owner[r]);
ok(missBuiltin.length === 0, '内置库全部地区均已归组（未归组 ' + missBuiltin.length + (missBuiltin.length ? '：' + missBuiltin.slice(0, 5) : '') + '）');
const mapped = Object.keys(map.country);
const missMap = mapped.filter((r) => !owner[r]);
ok(missMap.length === 0, '导入表 ' + mapped.length + ' 个国家/地区全部归组（未归组 ' + missMap.length + '）');
ok(mapped.length >= 200, '映射表国家数 >= 200（' + mapped.length + '）');
const africa = (groups.find((g) => g.lab === '非洲') || { regs: [] }).regs.length;
ok(africa > 30, '非洲不再被塞进「其他」（' + africa + ' 个）');

console.log('— 3. 条数口径：历史重复不计入 —');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/marketing.html', pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.confirm = () => true; w.alert = () => {}; w.scrollTo = () => {};
const mv = d.getElementById('marketing-view'); if (mv) mv.classList.remove('hidden');
try { w.eval(dataJs); w.eval(mainJs); } catch (e) { ok('脚本可执行', false, e.message); }

const res = w.eval(`(function(){
  var base = state.festivals.filter(function(f){ return !f.custom; }).slice(0, 6).map(function(f){ return JSON.parse(JSON.stringify(f)); });
  var dupRows = [ JSON.parse(JSON.stringify(base[0])), JSON.parse(JSON.stringify(base[0])), JSON.parse(JSON.stringify(base[1])) ];
  state.festivals = base.concat(dupRows);
  var c = progCounts();
  render();                                   /* 重绘侧栏，读取实际角标 */
  return { rows: c.rows, uniq: c.uniq, chips: [].map.call(document.querySelectorAll('#progChips .pn'), function(n){ return parseInt(n.textContent, 10); }) };
})()`);
ok(res.rows === 9, '原始行数按实际行统计（9 行，实际 ' + res.rows + '）');
ok(res.uniq === 6, '去重后仅统计唯一节日（6，实际 ' + res.uniq + '）');
ok(res.chips.length === 4, '进度筛选四个选项均带数量（' + res.chips.length + '）');
ok(res.chips[0] <= 6, '「全部」角标不含重复行（' + res.chips[0] + ' <= 6）');
ok(/历史重复行不参与计数/.test(mainJs), '源码注明重复行不参与计数');
ok(/_seenC\[_k\]/.test(mainJs), 'progCounts 内使用同国同名去重键');
ok(/_dupKey\(h\.region, h\.name\)/.test(mainJs), '去重键与列表一致（地区+名称）');

console.log('— 4. 素材区块下线与构建标识 —');
ok(!/已发布营销素材/.test(html), '页面无「已发布营销素材」标题');
ok(!/后台「营销日历」中已发布的节点与文章/.test(html), '页面无该区块副标题');
ok(!/id="mk-cards"/.test(html) && !/id="mk-timeline"/.test(html), '旧素材容器已移除');
ok(/id="mkBuild"/.test(html) && /构建 2026102/.test(html), '页脚有构建标识，可核对线上版本');
ok(/2026102\d[A-Z]/.test(html), '资源版本号已升级且为当前构建');

console.log('\n结果: 通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
