-- ============================================================
-- patch_20261028F —— 外部只读取图开关（独立于「前台公开浏览」）
--
-- 用途：需要把图片地址交给外部工具（打标、批量取图等）时，临时开启；
--       开启后凭密钥可只读图片，不传密钥一律拒绝。用完关闭或重置密钥即刻失效。
--
-- 设计要点：
--   1) 开关与密钥存在独立表 site_secrets，且 RLS 全禁、不建任何 policy，
--      因此只有服务端（service_role）能读写，前端/访客无论如何都读不到密钥；
--      （site_settings 对匿名可读，密钥放那里等于公开）
--   2) 只影响「读图」这一个动作。上传、删除仍只认管理员令牌，开关不会放宽写权限。
--
-- 幂等：可重复执行。
-- ============================================================

create table if not exists public.site_secrets (
  id            int primary key default 1,
  agent_read    boolean not null default false,
  agent_read_key text,
  updated_at    timestamptz not null default now()
);

-- 只允许服务端访问：启用 RLS 且不创建任何 policy
alter table public.site_secrets enable row level security;
revoke all on public.site_secrets from anon, authenticated;

-- 固定单行配置
insert into public.site_secrets (id, agent_read, agent_read_key)
values (1, false, null)
on conflict (id) do nothing;

-- ============ 自检 ============
-- 1) 表存在且只有一行
select
  (select count(*) from public.site_secrets)                                   as 行数_应为1,
  (select agent_read from public.site_secrets where id = 1)                     as 外部读取_默认false,
  (select coalesce(agent_read_key, '') = '' from public.site_secrets where id = 1) as 密钥_默认为空;

-- 2) RLS 已开（rowsecurity 应为 true）
select relname as 表名, relrowsecurity as RLS已启用
from pg_class where relname = 'site_secrets';