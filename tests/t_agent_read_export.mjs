// 外部只读开关：导出地址拼接验证（真实加载 imageexport.js）
import fs from 'fs';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x === undefined ? '' : '→ ' + JSON.stringify(x)); } };

const src = fs.readFileSync(new URL('../js/imageexport.js', import.meta.url), 'utf8');

function boot(win) {
  const fn = new Function('window', 'document', 'XLSX', 'console', src + '\n;return window.ImageExport;');
  return fn(win, { addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; } }, {}, console);
}

console.log('\n【1】开关关闭：导出裸地址，不带任何凭证');
{
  globalThis.window = { CONFIG: { WORKER_URL: 'https://img.example.com' } };
  const E = boot(globalThis.window);
  const u = E.storageUrlOf({ path: 'images/T恤/a.avif' });
  ok('地址为裸路径', u === 'https://img.example.com/images/T恤/a.avif', u);
  ok('不含 read_key', u.indexOf('read_key') < 0, u);
}

console.log('\n【2】开关开启：地址自动带上密钥');
{
  globalThis.window = { CONFIG: { WORKER_URL: 'https://img.example.com' }, __agentReadOn: true, __agentReadKey: 'k123' };
  const E = boot(globalThis.window);
  const u = E.storageUrlOf({ path: 'images/T恤/a.avif' });
  ok('含 read_key=k123', u.indexOf('read_key=k123') > 0, u);
}

console.log('\n【3】开关开但密钥为空：不拼空的参数');
{
  globalThis.window = { CONFIG: { WORKER_URL: 'https://img.example.com' }, __agentReadOn: true, __agentReadKey: '' };
  const E = boot(globalThis.window);
  const u = E.storageUrlOf({ path: 'images/a.avif' });
  ok('不带 read_key', u.indexOf('read_key') < 0, u);
}

console.log('\n【4】开关关但残留旧密钥：以开关为准，不拼');
{
  globalThis.window = { CONFIG: { WORKER_URL: 'https://img.example.com' }, __agentReadOn: false, __agentReadKey: 'old' };
  const E = boot(globalThis.window);
  const u = E.storageUrlOf({ path: 'images/a.avif' });
  ok('不带 read_key', u.indexOf('read_key') < 0, u);
}

console.log('\n【5】有外链时优先外链，不受影响');
{
  globalThis.window = { CONFIG: { WORKER_URL: 'https://img.example.com' }, __agentReadOn: true, __agentReadKey: 'k123' };
  const E = boot(globalThis.window);
  const u = E.urlOf({ url: 'https://ext.example.com/x.jpg', path: 'images/a.avif' });
  ok('用外链', u === 'https://ext.example.com/x.jpg', u);
}

console.log('\n【6】无 path 时不崩，返回空');
{
  globalThis.window = { CONFIG: { WORKER_URL: 'https://img.example.com' }, __agentReadOn: true, __agentReadKey: 'k' };
  const E = boot(globalThis.window);
  ok('返回空串', E.storageUrlOf({}) === '', E.storageUrlOf({}));
}

console.log(`\n结果：${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
