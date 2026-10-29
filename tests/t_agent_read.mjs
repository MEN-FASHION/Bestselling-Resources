// 外部只读取图开关：worker 侧鉴权矩阵验证
import worker from '../worker/worker.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra === undefined ? '' : '→ ' + JSON.stringify(extra)); }
};

// ---- mock 环境 ----
function makeEnv(cfg) {
  const calls = [];
  return {
    calls,
    SUPABASE_URL: 'https://mock.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    IMAGES: {
      async get(key) {
        calls.push(key);
        return { body: 'IMG', httpMetadata: { contentType: 'image/avif' } };
      },
      async put() {}, async delete() {},
    },
    // 拦截所有 fetch：按 URL 返回对应 mock 数据
    _cfg: cfg,
  };
}

const realFetch = globalThis.fetch;
function installFetch(cfg) {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/site_settings')) {
      return new Response(JSON.stringify([{ public_access: !!cfg.publicAccess }]), { status: 200 });
    }
    if (u.includes('/site_secrets')) {
      return new Response(JSON.stringify([{ agent_read: !!cfg.agentRead, agent_read_key: cfg.key || '' }]), { status: 200 });
    }
    const authOf = () => ((init && init.headers && (init.headers.Authorization || init.headers.authorization)) || '');
    if (u.includes('/auth/v1/user')) {
      // good=超管，adminOnly=普通管理员，其他视为未登录
      const a = authOf();
      if (a.includes('good') || a.includes('adminOnly')) return new Response(JSON.stringify({ id: 'u1' }), { status: 200 });
      return new Response('{}', { status: 401 });
    }
    if (u.includes('/rest/v1/profiles')) {
      const a = authOf();
      const role = a.includes('adminOnly') ? 'admin' : 'super_admin';
      return new Response(JSON.stringify([{ role }]), { status: 200 });
    }
    if (u.includes('/rest/v1/user_roles')) {
      return new Response(JSON.stringify([{ role: 'admin' }]), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  };
}

async function req(url, opts) {
  const r = new Request(url, opts);
  const res = await worker.fetch(r, globalThis.__env);
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}

const IMG = 'https://img.example.com/images/T恤/x.avif';

console.log('\n【1】默认：开关关、未登录、无密钥 → 拒绝');
{
  globalThis.__env = makeEnv({ publicAccess: false, agentRead: false, key: '' });
  installFetch({ publicAccess: false, agentRead: false, key: '' });
  const r = await req(IMG);
  ok('返回 401', r.status === 401, r);
  ok('提示未登录', r.body && r.body.error === '未登录', r.body);
}

console.log('\n【2】开关开 + 正确密钥 → 放行');
{
  const KEY = 'abc123';
  globalThis.__env = makeEnv({ publicAccess: false, agentRead: true, key: KEY });
  installFetch({ publicAccess: false, agentRead: true, key: KEY });
  const r = await req(IMG + '?read_key=' + KEY);
  ok('返回 200', r.status === 200, r);
}

console.log('\n【3】开关开 + 错误密钥 → 拒绝');
{
  globalThis.__env = makeEnv({ publicAccess: false, agentRead: true, key: 'abc123' });
  installFetch({ publicAccess: false, agentRead: true, key: 'abc123' });
  const r = await req(IMG + '?read_key=wrong');
  ok('返回 401', r.status === 401, r);
}

console.log('\n【4】开关开但没带密钥 → 拒绝');
{
  globalThis.__env = makeEnv({ publicAccess: false, agentRead: true, key: 'abc123' });
  installFetch({ publicAccess: false, agentRead: true, key: 'abc123' });
  const r = await req(IMG);
  ok('返回 401', r.status === 401, r);
}

console.log('\n【5】开关关 + 带着旧密钥 → 仍然拒绝（关闭即失效）');
{
  globalThis.__env = makeEnv({ publicAccess: false, agentRead: false, key: 'abc123' });
  installFetch({ publicAccess: false, agentRead: false, key: 'abc123' });
  const r = await req(IMG + '?read_key=abc123');
  ok('返回 401', r.status === 401, r);
}

console.log('\n【6】开关开但密钥被清空 → 拒绝（不能空密钥放行）');
{
  globalThis.__env = makeEnv({ publicAccess: false, agentRead: true, key: '' });
  installFetch({ publicAccess: false, agentRead: true, key: '' });
  const r1 = await req(IMG);
  const r2 = await req(IMG + '?read_key=');
  ok('无密钥 401', r1.status === 401, r1);
  ok('空密钥 401', r2.status === 401, r2);
}

console.log('\n【7】管理员登录 → 不受开关影响，照常看图');
{
  globalThis.__env = makeEnv({ publicAccess: false, agentRead: false, key: '' });
  installFetch({ publicAccess: false, agentRead: false, key: '' });
  const r = await req(IMG, { headers: { Authorization: 'Bearer good' } });
  ok('返回 200', r.status === 200, r);
}

console.log('\n【8】原有公开浏览行为未被破坏');
{
  globalThis.__env = makeEnv({ publicAccess: true, agentRead: false, key: '' });
  installFetch({ publicAccess: true, agentRead: false, key: '' });
  const r = await req(IMG);
  ok('public_access 开启时匿名可取图', r.status === 200, r);
}

console.log('\n【9】写操作不受开关影响：匿名上传/删除仍拒绝');
{
  globalThis.__env = makeEnv({ publicAccess: true, agentRead: true, key: 'k' });
  installFetch({ publicAccess: true, agentRead: true, key: 'k' });
  const del = await req(IMG, { method: 'DELETE' });
  ok('DELETE 匿名 401', del.status === 401, del);
}

console.log('\n【10】开关管理接口需管理员');
{
  globalThis.__env = makeEnv({ publicAccess: false, agentRead: true, key: 'k' });
  installFetch({ publicAccess: false, agentRead: true, key: 'k' });
  const anon = await req('https://img.example.com/agent-read');
  ok('匿名读设置 401', anon.status === 401, anon);
}

console.log('\n【11】开关管理接口：仅超级管理员可操作');
{
  globalThis.__env = makeEnv({ publicAccess: false, agentRead: true, key: 'k' });
  installFetch({ publicAccess: false, agentRead: true, key: 'k' });
  const admin = await req('https://img.example.com/agent-read', { headers: { Authorization: 'Bearer adminOnly' } });
  ok('普通管理员读设置 403', admin.status === 403, admin);
  const adminPost = await req('https://img.example.com/agent-read', {
    method: 'POST',
    headers: { Authorization: 'Bearer adminOnly', 'Content-Type': 'application/json' },
    body: JSON.stringify({ on: true }),
  });
  ok('普通管理员改开关 403', adminPost.status === 403, adminPost);
  const sup = await req('https://img.example.com/agent-read', { headers: { Authorization: 'Bearer good' } });
  ok('超级管理员读设置 200', sup.status === 200, sup);
}

console.log(`\n结果：${pass} pass, ${fail} fail`);
globalThis.fetch = realFetch;
if (fail > 0) process.exit(1);
