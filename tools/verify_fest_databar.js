/* 校验：前台「导入后看不到」的三类原因必须说清楚（读库失败 / 库空 / 节期已过），且可重试、可一键切到已过期 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const html = read('marketing.html');
const js = read('js/marketing-main.js');
const css = read('css/style.css');
let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (e ? ' → ' + e : ''))); };

console.log('一、结构与样式');
ok('主区有提示条容器', /id="mkDataBar"/.test(html));
ok('容器在 main-inner 内、筛选项之前', html.indexOf('id="mkDataBar"') < html.indexOf('id="filterbar"'));
ok('样式已定义', /\.mk-data-bar\{/.test(css) && /\.mkdb-btn\{/.test(css));
ok('有隐藏态样式', /\.mk-data-bar\.hidden\{display:none\}/.test(css));

console.log('二、读库状态不再静默');
ok('有状态对象 dbMeta', /var dbMeta = \{ status:'none'/.test(js));
ok('有失败分支（带原因）', /status:'failed'/.test(js) && /dbReason\(res\.error\)/.test(js));
ok('有 catch 分支也记失败', /\.catch\(function\(e\)\{[\s\S]{0,120}status:'failed'/.test(js));
ok('库为空单独提示（不冒充"没数据"）', /'empty'/.test(js) && /还是空的/.test(js));
ok('成功分支统计已过期条数', /status:'loaded', count:list\.length, past:countPast\(list\)/.test(js));
ok('失败时可重试', /id="mkDbRetry"/.test(js) && /loadFestivalsFromDb\(true\)/.test(js));
ok('已过期可一键切过去', /id="mkDbShowPast"/.test(js) && /state\.filters\.prog = 'expired'/.test(js));
ok('提示文案点明"默认只显示未来节期"', /默认视图只显示未来节期/.test(js));
ok('无内容时隐藏提示条', /el\.classList\.add\('hidden'\)/.test(js));

console.log('三、错误翻译（不暴露内部细节）');
function cutFn(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return '';
}
const reasonSrc = cutFn(js, 'function dbReason(err){');
ok('dbReason 可截取', !!reasonSrc);
const c = { String };
vm.createContext(c);
vm.runInContext(reasonSrc, c);
const r = (m) => vm.runInContext('dbReason({message:' + JSON.stringify(m) + '})', c);
ok('权限 → 提示无权限', /权限/.test(r('permission denied for table marketing_festivals')));
ok('缺表 → 提示需初始化', /初始化/.test(r('relation "marketing_festivals" does not exist')));
ok('缺字段 → 提示补字段', /补一次字段/.test(r('column "overrides" does not exist')));
ok('登录过期 → 提示重登', /重新登录/.test(r('JWT expired')));
ok('网络 → 提示网络', /网络/.test(r('Failed to fetch')));
ok('未知错误不抛出原文以外的内部细节', r('boom') === '读取失败');

console.log('四、已过期计数（运行时）');
const countSrc = cutFn(js, 'function countPast(list){');
ok('countPast 可截取', !!countSrc);
const c2 = {
  todayStart: () => new Date(2026, 9, 21),            // 2026-10-21
  nextOccurrence: (h, t) => {
    // 简化：h.occ 直接给下次发生日
    return h.occ;
  },
  daysBetween: (a, b) => Math.round((b - a) / 86400000),
};
vm.createContext(c2);
vm.runInContext(countSrc, c2);
ok('节期已过（下次在 400 天后）计入', vm.runInContext(
  'countPast([{occ:new Date(2027,11,25)}]) === 1', c2));
ok('节期未到（近期）不计入', vm.runInContext(
  'countPast([{occ:new Date(2026,11,25)}]) === 0', c2));
ok('混合列表计数正确', vm.runInContext(
  'countPast([{occ:new Date(2026,11,25)},{occ:new Date(2027,11,25)},{occ:new Date(2028,1,1)}]) === 2', c2));

console.log('五、访客（未登录）也能读到库');
const sqlSetup = read('tools/setup_marketing.sql');
const sqlPatch = read('tools/patch_20261021E.sql');
ok('初始化脚本已放行匿名只读', /create policy "public read marketing_festivals"[\s\S]{0,120}to anon, authenticated/.test(sqlSetup));
ok('补丁脚本可重复执行（先 drop 再 create）', /drop policy if exists "public read marketing_festivals"[\s\S]{0,200}create policy "public read marketing_festivals"/.test(sqlPatch));
ok('匿名只拿 SELECT，不给写权限', /for select[\s\S]{0,60}to anon/.test(sqlPatch) && !/to anon[\s\S]{0,40}for (all|insert|update|delete)/i.test(sqlPatch));
ok('补丁带自检列（匿名可读）', /as 匿名可读/.test(sqlPatch));
ok('前台区分「访客未读权限」与「库确实为空」', /status: guest \? 'noguest' : 'empty'/.test(js) || /status: guest \? 'noguest' : 'empty'/.test(js));
ok('访客态提示写明原因与解决方式', /访客（未登录）/.test(js) && /匿名只读/.test(js));
ok('读取库时先判断会话', /SB\.getSession/.test(js));

console.log('六、与既有逻辑不冲突');
ok('仍保留 400 天窗口过滤', /dl < 0 \|\| dl > 400/.test(js));
ok('仍保留展示去重', /if\(_seen\[_k\]\) continue/.test(js));
ok('提示条不影响三视图渲染入口', /function render\(\)\{/.test(js) && /renderDataBar\(\)/.test(js));

console.log('\n结果: 通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
