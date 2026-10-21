/* ============================================================
 * 节庆读库容错与报错自证：静态 + 真实源码切片运行时
 * 覆盖：缺 sort_no 自动降级、缺 id 再降级、错误原样返回、
 *       写库缺可选字段时剥离重试、错误翻译区分原因、诊断入口齐备
 * ============================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

const sb = read('js/supabase.js');
const mk = read('js/marketing-main.js');
const adm = read('js/admin-festival.js');
const css = read('css/style.css');

console.log('— 1. 静态：接口层具备降级与诊断 —');
ok(/async listFestivals\(\)/.test(sb), 'listFestivals 存在');
ok(/run\(\["sort_no", "id"\]\)/.test(sb), '首选按 sort_no + id 稳定排序');
ok(/missingColumn\(res\.error\) === "sort_no"\) res = await run\(\["id"\]\)/.test(sb), '缺 sort_no 时降级为按 id');
ok(/missingColumn\(res\.error\) === "id"\) res = await run\(\[\]\)/.test(sb), '缺 id 时降级为不排序');
ok(/\.range\(from, from \+ PAGE - 1\)/.test(sb), '分页拉全量（规避 1000 行截断）');
ok(/async probeFestivals\(\)/.test(sb), '存在诊断方法 probeFestivals');
ok(/function missingColumn\(/.test(sb) && /function missingTable\(/.test(sb) && /function errText\(/.test(sb), '错误解析三件套齐备');
ok(/checkConfigHealth\(\)[\s\S]{0,200}code: "CONFIG"/.test(sb), '读库前先做配置自检');
ok(/dropped\.push\(col\)/.test(sb) && /delete c\[col\]/.test(sb), '写库遇到缺列时剥离该列重试');
ok(/try \{ window\.SB = SB; \}/.test(sb), '接口对象已显式挂到 window');

console.log('— 2. 运行时：用假客户端跑真实 listFestivals —');
const helperSrc = sb.slice(sb.indexOf('  function errText(e) {'), sb.indexOf('  // 取当前登录令牌'));
const methodSrc = sb.slice(sb.indexOf('    async listFestivals() {'), sb.indexOf('    /* 诊断：'));

function makeSB(opts) {
  const state = { calls: [], pages: opts.pages || 0, failOn: opts.failOn || [], rowsPerPage: opts.rowsPerPage || 1000 };
  const client = {
    from() {
      const q = {
        _order: [], _from: 0,
        select() { return q; },
        order(col) { q._order.push(col); return q; },
        range(a) { q._from = a; return q; },
        then(resolve) {
          const key = q._order.join(',');
          state.calls.push({ orders: key, from: q._from });
          const bad = state.failOn.find((f) => f.when === key);
          if (bad) return resolve({ data: null, error: bad.err });
          const total = state.pages * state.rowsPerPage;
          const from = q._from;
          const n = Math.max(0, Math.min(state.rowsPerPage, total - from));
          const rows = Array.from({ length: n }, (_, i) => ({ id: String(from + i), name: 'F' + (from + i), date: '01-01', sort_no: from + i }));
          return resolve({ data: rows, error: null });
        },
      };
      return q;
    },
  };
  const sandbox = {
    client,
    errText: null, missingColumn: null,
    checkConfigHealth: () => ({ ok: true, problems: [] }),
    console,
  };
  const src = helperSrc.replace(/^ {2}/gm, '') + '\n' + methodSrc.replace(/^ {4}/gm, '  ');
  const obj = vm.runInNewContext('({' + src.trim().replace(/^async listFestivals\(\) \{/, 'async listFestivals() {') + '})', sandbox);
  return { api: obj, state };
}
// 把方法包成对象字面量成员
function makeApi(opts) {
  const state = { calls: [], pages: opts.pages != null ? opts.pages : 3, failOn: opts.failOn || [], rowsPerPage: opts.rowsPerPage || 1000 };
  const client = {
    from() {
      const q = {
        _order: [], _from: 0,
        select() { return q; }, order(c) { q._order.push(c); return q; }, range(a) { q._from = a; return q; },
        then(resolve) {
          const key = q._order.join(',');
          state.calls.push({ orders: key, from: q._from });
          const bad = state.failOn.find((f) => f.when === key);
          if (bad) return resolve({ data: null, error: bad.err });
          const total = state.pages * state.rowsPerPage;
          const from = q._from;
          const n = Math.max(0, Math.min(state.rowsPerPage, total - from));
          const rows = Array.from({ length: n }, (_, i) => ({ id: String(from + i), name: 'F' + (from + i), date: '01-01' }));
          resolve({ data: rows, error: null });
        },
      };
      return q;
    },
  };
  const sandbox = { client, checkConfigHealth: () => ({ ok: true, problems: [] }), console };
  const pre = helperSrc.replace(/^ {2}/gm, '');
  const body = methodSrc.replace(/^ {4}/gm, '').replace(/\}\),?\s*$/, '}');
  const api = vm.runInNewContext('(function(){' + pre + '; return ({' + body + '}) })()', sandbox);
  return { api, state };
}

(async () => {
  let h = makeApi({ pages: 3 });
  let r = await h.api.listFestivals();
  ok(r.error === null && r.data.length === 3000, '3000 行分 3 页全部读回（不截断）');
  ok(h.state.calls.length === 4 && h.state.calls.every((c) => c.orders === 'sort_no,id'), '始终按 sort_no,id 排序分页（末页空表用于确认读完）');
  ok(h.state.calls.map((c) => c.from).join(',') === '0,1000,2000,3000', '分页区间连续且不重叠');

  h = makeApi({ pages: 2, failOn: [{ when: 'sort_no,id', err: { code: 'PGRST204', message: "Could not find the 'sort_no' column of 'marketing_festivals' in the schema cache" } }] });
  r = await h.api.listFestivals();
  ok(r.error === null, '老库缺 sort_no 时不报错');
  ok(r.data.length === 2000, '降级后仍读回全部 2000 行');
  ok(r.degraded === true, '返回 degraded 标记（告知走了降级排序）');
  ok(h.state.calls.some((c) => c.orders === 'id'), '确实改为按 id 排序重试');

  h = makeApi({ pages: 1, failOn: [
    { when: 'sort_no,id', err: { code: 'PGRST204', message: "Could not find the 'sort_no' column of 'x' in the schema cache" } },
    { when: 'id', err: { code: 'PGRST204', message: "Could not find the 'id' column of 'x' in the schema cache" } },
  ] });
  r = await h.api.listFestivals();
  ok(r.error === null && r.data.length === 1000, '缺 sort_no 且缺 id 时退回不排序仍可读');
  ok(h.state.calls.some((c) => c.orders === ''), '发起过无排序请求');

  h = makeApi({ pages: 1, failOn: [{ when: 'sort_no,id', err: { code: '42501', message: 'permission denied for table marketing_festivals' } }] });
  r = await h.api.listFestivals();
  ok(!!r.error && r.error.code === '42501', '权限类错误原样返回（不假装成功）');

  console.log('— 3. 错误翻译：每种原因给出不同人话 —');
  const reasonSrc = mk.slice(mk.indexOf('function dbReason(err){'), mk.indexOf('function renderDataBar(){'));
  const dbReason = vm.runInNewContext('(' + reasonSrc.trim() + ')', {});
  const cases = [
    [{ code: 'PGRST204', message: "Could not find the 'sort_no' column of 'x' in the schema cache" }, /缺少字段「sort_no」/],
    [{ code: '42501', message: 'permission denied for table x' }, /没有读取节庆库的权限/],
    [{ code: '42P01', message: 'Could not find the table public.x in the schema cache' }, /还没建好/],
    [{ code: '401', message: 'JWT expired' }, /登录状态已过期/],
    [{ message: 'Failed to fetch' }, /网络中断/],
    [{ code: 'CONFIG', message: '页面数据库配置不完整：配置里缺少访问密钥' }, /配置不完整/],
    [{ code: 'XX999', message: 'something odd happened' }, /XX999/],
  ];
  for (const [err, re] of cases) ok(re.test(dbReason(err)), '错误 → ' + re.source.replace(/\\/g, ''));
  ok(!/没有读取节庆库的权限/.test(dbReason({ code: 'XX999', message: 'boom' })), '未知错误不会被误报成"没有权限"（避免误导去改权限）');

  console.log('— 4. 前台入口：诊断按钮与输出区齐备 —');
  ok(/id="mkDbProbe"/.test(mk) || /'\+ '<button type="button" class="mkdb-btn" id="mkDbProbe">/.test(mk), '失败提示条上有「诊断」按钮');
  ok(/id="mkDbProbeOut"/.test(mk), '存在诊断输出区');
  ok(/function runDbProbe\(/.test(mk), '存在诊断执行函数');
  ok(/SB\.probeFestivals\(\)/.test(mk), '诊断走接口层 probeFestivals');
  ok(/mkdb-probe/.test(css), '诊断输出区有样式');
  ok(/\.mkdb-probe\.hidden\{display:none\}/.test(css), '输出区默认隐藏');
  ok(/dbHint\(res\.error\)/.test(adm) && /PGRST204/.test(adm), '后台错误翻译同样识别新版缺列文案');

  console.log('— 5. 页面引用 —');
  const html = read('marketing.html');
  ok(/js\/supabase\.js/.test(html) && html.indexOf('supabase.js') < html.indexOf('marketing-main.js'), '接口脚本先于页面脚本加载');
  ok(/id="mkDataBar"/.test(html), '数据状态条容器存在');

  console.log('\n结果: 通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
