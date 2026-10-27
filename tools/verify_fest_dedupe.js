/* 校验：历史重复数据的清理能力 + 列表展示去重（纯静态 + 运行时切片） */
const fs = require('fs'), vm = require('vm'), path = require('path');
const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const sb = read('js/supabase.js');
const adm = read('js/admin-festival.js');
const front = read('js/marketing-main.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
function has(hay, needle) { return hay.indexOf(needle) >= 0; }

console.log('一、接口层：批量删除');
ok('新增 deleteFestivals', /async deleteFestivals\(ids\)/.test(sb));
ok('空数组直接返回，不发请求', /if \(!list\.length\) return \{ error: null \}/.test(sb));
ok('用 in() 批量删除', /delete\(\)\.in\("id", list\)/.test(sb));
ok('原有的单条删除与清空仍保留', /async deleteFestival\(id\)/.test(sb) && /async clearFestivals\(\)/.test(sb));

console.log('二、后台：清理重复入口');
ok('工具条有「清理重复」按钮', has(adm, 'id="mkFestDedupe"'));
ok('按钮已绑定 doDedupe', /var dd = \$\('mkFestDedupe'\);[\s\S]{0,120}doDedupe\(this\)/.test(adm));
ok('doDedupe 存在', /function doDedupe\(btn\)/.test(adm));
ok('两次点击确认', /data-confirm'\) !== '1'/.test(adm) && /再点一次确认/.test(adm));
ok('确认态 5 秒后自动复位', /setTimeout\(function \(\) \{ btn\.setAttribute\('data-confirm', '0'\)/.test(adm));
ok('先判接口可用再清理', /typeof SB\.deleteFestivals !== 'function'/.test(adm));
ok('按 200 条一批清理', /kill\.slice\(done, done \+ 200\)/.test(adm));
ok('清理有进度显示', /准备清理 0 \/ /.test(adm) && /已清理 ' \+ done/.test(adm));
ok('清理完成后重新读库', /toast\('已清理 '[\s\S]{0,80}reload\(true\)/.test(adm));

console.log('三、后台：分组与保留策略');
ok('dupGroups 按同国同名分组', /function dupGroups\(list\)/.test(adm) && /dedupeKey\(h\.region, h\.name\)/.test(adm));
ok('只返回重复组（>1）', /map\[keys\[j\]\]\.length > 1/.test(adm));
ok('dupCount 统计多余条数', /function dupCount\(\)/.test(adm) && /n \+= g\[i\]\[1\]\.length - 1/.test(adm));
ok('头部计数显示重复条数', /其中重复/.test(adm));
ok('保留字段更全的一条', /function pickKeeper\(rows\)/.test(adm) && /if \(h\.en\) n \+= 2/.test(adm));
ok('评分相同保留 sort_no 更小的', /\(rows\[i\]\.sort_no \| 0\) < \(best\.sort_no \| 0\)/.test(adm));

console.log('四、展示去重（前后台都不再出现一串重复）');
ok('后台 build 有 seen 去重', /var seen = Object\.create\(null\)/.test(adm) && /if \(seen\[dk\]\) continue/.test(adm));
ok('前台有 _dupKey 归一化', /function _dupKey\(region, name\)/.test(front));
ok('前台 buildList 有 seen 去重', /var _seen = \{\}/.test(front) && /if\(_seen\[_k\]\) continue/.test(front));

console.log('五、运行时：分组 / 保留 / 归一化');
// 抽出后台的 dedupeKey、dupGroups、pickKeeper 跑真实逻辑
function cut(src, sig, endMark) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  const j = src.indexOf(endMark, i);
  return j < 0 ? '' : src.slice(i, j + endMark.length);
}
const dedupeSrc = cut(adm, 'function dedupeKey(region, name){', '\n  }');
const groupsSrc = cut(adm, 'function dupGroups(list) {', '\n  }');
const keeperSrc = cut(adm, 'function pickKeeper(rows) {', '\n  }');
ok('三段源码均可截取', !!(dedupeSrc && groupsSrc && keeperSrc));

const ctx = { state: { list: [] }, Object };
vm.createContext(ctx);
vm.runInContext(dedupeSrc, ctx);
vm.runInContext(groupsSrc, ctx);
vm.runInContext(keeperSrc, ctx);

ok('同国同名归为同组', vm.runInContext(`
  dupGroups([{name:'感恩节',region:'美国'},{name:'感恩 节',region:'美国'},{name:'感恩节',region:'英国'}]).length === 1`, ctx));
ok('不同国家不算重复', vm.runInContext(`
  dupGroups([{name:'感恩节',region:'美国'},{name:'感恩节',region:'英国'}]).length === 0`, ctx));
const g3 = vm.runInContext(`
  dupGroups([{id:'a',name:'万圣节',region:'美国'},{id:'b',name:'万圣节',region:'美国'},{id:'c',name:'万圣节',region:'美国'}])`, ctx);
ok('三条同国同名 → 一组三行', g3.length === 1 && g3[0][1].length === 3);
ok('保留字段更全的一条', vm.runInContext(`
  pickKeeper([{id:'a',name:'x',region:'r'},{id:'b',name:'x',region:'r',en:'X',idea:'单品'}]).id === 'b'`, ctx));
ok('评分相同保留 sort_no 小的', vm.runInContext(`
  pickKeeper([{id:'a',name:'x',region:'r',sort_no:5},{id:'b',name:'x',region:'r',sort_no:2}]).id === 'b'`, ctx));
ok('「待补充」不算有效内容', vm.runInContext(`
  pickKeeper([{id:'a',name:'x',region:'r',idea:'待补充'},{id:'b',name:'x',region:'r',note:'n'}]).id === 'b'`, ctx));
ok('括号/标点差异视为同一条', vm.runInContext(`
  dupGroups([{name:'感恩节（Thanksgiving）',region:'美国'},{name:'感恩节(Thanksgiving)',region:'美国'}]).length === 1`, ctx));

// 前台 _dupKey
const frontKey = cut(front, 'function _dupKey(region, name){', '\n}');
ok('前台归一化函数可截取', !!frontKey);
const c2 = {}; vm.createContext(c2);
vm.runInContext(frontKey, c2);
ok('前台键：空格与标点差异归一', vm.runInContext(`_dupKey('美国','感恩节') === _dupKey(' 美国 ','感恩 节')`, c2));
ok('前台键：国家不同则不同', vm.runInContext(`_dupKey('美国','感恩节') !== _dupKey('英国','感恩节')`, c2));

// 清理条数计算：3 条重复应删 2 条
const dupCountSrc = cut(adm, 'function dupCount() {', '\n  }');
vm.runInContext(dupCountSrc, ctx);
ok('重复条数 = 组内多余条数之和', vm.runInContext(`
  state.list = [{name:'a',region:'r'},{name:'a',region:'r'},{name:'a',region:'r'},{name:'b',region:'r'}];
  dupCount() === 2`, ctx));

console.log('\n结果: 通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
