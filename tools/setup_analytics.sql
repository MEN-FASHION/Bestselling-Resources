-- ============================================================
-- TREND BANK · 用户动向（前台访客 + 后台管理员的行为统计）
-- 版本：20261016P
-- 用法：在 Supabase SQL Editor 整段执行（可重复执行，不会重复建表、不会清数据）
-- 目的：回答「他们从哪来、干了什么、干了多久」
--   ① visit_logs：登录用户每次进入某专区的访问记录（专区 / 页面 / 来源 referrer / 停留时长 / IP / 国家地区），
--      以及「菜单点击」事件行（event='menu'，记录哪个专区的哪个菜单被点）
--   ② record_visit()：页面打开时登记一次访问
--   ③ visit_ping()：页面心跳累加停留时长（含离开页面时补最后一次）
--   ④ track_event()：菜单点击等行为上报（静默失败，统计不到不影响浏览）
--   ⑤ log_admin_action()：后台写操作留痕（谁上传了多少图、删了什么、改了什么）
--   ⑥ insight_front()：超管专用，一次返回前台访客动向（从哪来 / 谁在干什么 / 干了多久 / 专区与菜单热度 / 每日趋势）
--   ⑦ insight_admin()：超管专用，一次返回后台管理员动向（谁上传多少图 / 操作次数 / 操作明细）
--   ⑧ is_super_admin()：超管判定（本脚本一并重建，容错大小写与首尾空格）
-- 注：旧的「权限管理 → 数据看板」聚合接口已随该面板一并移除，其能力并入 ⑥ / ⑦。
-- 说明：只统计「已登录用户」的真实访问（游客不计），避免匿名流量污染口径。
--
-- 本版重点修复「明明是超级管理员，却提示没有查看看板的权限」：
--   · 明确为三个接口补齐「登录用户可调用」的授权（grant execute to authenticated）；
--   · 超管判定改为容错大小写与空格，避免角色值写成 Super_Admin / "super_admin " 时被误判为非超管；
--   · 看板接口在返回数据里附带 meta（本次判定到的账号与角色），便于一眼看出判定结果；
--   · 结尾附自检：直接列出「接口授权是否就绪 / 谁是超管账号 / 现有数据量」。
-- ============================================================

-- ---------- 0. 超管判定（容错大小写与首尾空格） ----------
-- 注意：站内多处权限策略都调用本函数，这里统一重建，避免角色值写法差异导致"明明是超管却说没权限"。
create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and lower(btrim(coalesce(p.role, ''))) = 'super_admin'
  );
$$;
grant execute on function public.is_super_admin() to authenticated, anon, service_role;

-- ---------- 1. 访问记录表 ----------
create table if not exists public.visit_logs (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  zone text,                             -- 专区 key：visual / trend / rank / marketing / recruit / bestseller / notice
  path text,                             -- 页面路径（便于后续拆分具体页面）
  ip text,                               -- 访问者 IP
  country text,                          -- 国家（由 IP 解析，如 US / CN）
  region text,                           -- 省/州（如 California）
  city text,                             -- 城市
  started_at timestamptz not null default now(),
  duration_sec integer not null default 0  -- 该次访问累计停留秒数
);

create index if not exists visit_logs_started_idx on public.visit_logs (started_at desc);
create index if not exists visit_logs_user_idx on public.visit_logs (user_id);
create index if not exists visit_logs_zone_idx on public.visit_logs (zone);

alter table public.visit_logs enable row level security;

-- 本人只能写自己的访问记录（前台上报）
drop policy if exists "insert own visit_log" on public.visit_logs;
create policy "insert own visit_log"
  on public.visit_logs for insert to authenticated
  with check (user_id = auth.uid());

-- 本人只能更新自己的记录（心跳累加时长）
drop policy if exists "update own visit_log" on public.visit_logs;
create policy "update own visit_log"
  on public.visit_logs for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 仅超管可读全量（看板数据不外泄给普通用户）
drop policy if exists "super read all visit_logs" on public.visit_logs;
create policy "super read all visit_logs"
  on public.visit_logs for select to authenticated
  using (public.is_super_admin());

-- ---------- 2. 登记一次访问 ----------
drop function if exists public.record_visit(text, text, text, text, text, text);
create function public.record_visit(
  p_zone text, p_path text, p_ip text, p_country text, p_region text, p_city text
)
returns bigint
language plpgsql security definer volatile
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_email text;
  v_id bigint;
begin
  select auth.uid() into v_uid;
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select p.email into v_email from public.profiles p where p.user_id = v_uid;
  insert into public.visit_logs (user_id, email, zone, path, ip, country, region, city)
  values (
    v_uid, v_email,
    nullif(trim(coalesce(p_zone, '')), ''),
    nullif(trim(coalesce(p_path, '')), ''),
    nullif(trim(coalesce(p_ip, '')), ''),
    nullif(trim(coalesce(p_country, '')), ''),
    nullif(trim(coalesce(p_region, '')), ''),
    nullif(trim(coalesce(p_city, '')), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_visit(text, text, text, text, text, text) from public, anon;
grant execute on function public.record_visit(text, text, text, text, text, text) to authenticated;

-- ---------- 3. 累加停留时长（心跳） ----------
-- p_add：本次要累加的秒数（前端每 20 秒调一次，离开页面时补最后一次）
-- 单条记录上限 12 小时：防止标签页长期挂着把「在线时长」刷成不真实的天文数字
drop function if exists public.visit_ping(bigint, integer);
create function public.visit_ping(p_id bigint, p_add integer)
returns void
language plpgsql security definer volatile
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  select auth.uid() into v_uid;
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  update public.visit_logs
     set duration_sec = greatest(0, least(duration_sec + coalesce(p_add, 0), 43200))
   where id = p_id and user_id = v_uid;
end;
$$;
revoke all on function public.visit_ping(bigint, integer) from public, anon;
grant execute on function public.visit_ping(bigint, integer) to authenticated;

-- ---------- 5. 让新函数立刻对接口生效 + 自检 ----------
-- 新建或修改函数后，接口层的结构缓存可能还要一会儿才认识这些函数；
-- 这里主动通知它重载，避免出现「数据库里明明有函数、接口却报找不到」的情况。
notify pgrst, 'reload schema';

-- 自检 ①：对象是否都建好了（期望「已就绪」全是 true）
select '访问记录表 visit_logs' as "检查项", (to_regclass('public.visit_logs') is not null) as "已就绪"
union all
select '登记访问 record_visit',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'record_visit')
union all
select '停留时长 visit_ping',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'visit_ping')
union all
select '动向统计 insight_front',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'insight_front')
union all
select '管理员动向 insight_admin',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'insight_admin')
union all
select '行为上报 track_event',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'track_event')
union all
select '操作留痕 log_admin_action',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'log_admin_action')
union all
select '超管判定 is_super_admin',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'is_super_admin');

-- 自检 ②：接口授权 / 超管账号 / 现有数据量（期望：登录用户可调用 = true，匿名可调用 = false）
-- 说明：SQL Editor 里没有浏览器登录态，所以 auth.uid() 为空属正常，不影响下面这些检查。
select
  has_function_privilege('authenticated', 'public.insight_front(integer)', 'EXECUTE') as "登录用户可调用前台动向",
  has_function_privilege('anon', 'public.insight_front(integer)', 'EXECUTE') as "匿名可调用前台动向_应为false",
  has_function_privilege('authenticated', 'public.insight_admin(integer)', 'EXECUTE') as "登录用户可调用管理员动向",
  has_function_privilege('authenticated', 'public.track_event(text, text, text, text)', 'EXECUTE') as "登录用户可上报行为",
  has_function_privilege('authenticated', 'public.log_admin_action(text, text, jsonb)', 'EXECUTE') as "登录用户可写操作留痕",
  (select count(*) from public.visit_logs) as "已有访问记录数",
  (select count(*) from public.profiles where lower(btrim(coalesce(role, ''))) = 'super_admin') as "超管账号数",
  (select string_agg(coalesce(email, '(无邮箱)') || ' → ' || coalesce(role, '(空)'), '  |  ' order by email) from public.profiles) as "全部账号与角色";

-- ============================================================
-- 执行完成后：前台各页面打开时会自动登记访问（仅登录用户），点击菜单会上报菜单事件，
-- 后台的每一次写操作会留痕。超管后台「⑬ 用户动向」即可看到：
--   前台用户 = 从哪来 / 在哪个专区待了多久 / 最近访问明细
--   专区 · 菜单热度 = 哪些专区、哪些菜单被点最多、浏览时间最长
--   后台管理员 = 谁上传了多少图、做了什么操作
-- 若执行后后台仍提示"没有执行授权"，请在「用户动向」面板点「重新执行自检」，
-- 页面会直接给出是哪一层断了（配置 / 登录态 / 最小读写 / 动向接口）。
-- ============================================================
-- ============================================================
-- 5. 用户动向（前台访客 + 后台管理员）—— 2026-10-18 扩展
--    本段可重复执行（幂等）。
-- ============================================================

-- ---------- 5.1 访问记录补充三列：来源 / 事件 / 菜单 ----------
alter table public.visit_logs add column if not exists referrer text;   -- 从哪来（外链来源，空=直接进入）
alter table public.visit_logs add column if not exists event text;      -- 行为类型：空=页面浏览 / menu=菜单点击
alter table public.visit_logs add column if not exists menu text;       -- 被点击的菜单名

create index if not exists visit_logs_event_idx on public.visit_logs (event);
create index if not exists visit_logs_menu_idx on public.visit_logs (menu);

-- ---------- 5.2 record_visit：增补「来源」参数 ----------
-- 末参带默认值：老的 6 参调用方式依然可用（前端未刷新时也不会报错）。
create or replace function public.record_visit(
  p_zone text, p_path text, p_ip text, p_country text, p_region text, p_city text,
  p_referrer text default ''
)
returns bigint
language plpgsql security definer volatile
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_email text;
  v_id bigint;
begin
  select auth.uid() into v_uid;
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select p.email into v_email from public.profiles p where p.user_id = v_uid;
  insert into public.visit_logs (user_id, email, zone, path, ip, country, region, city, referrer)
  values (
    v_uid, v_email,
    nullif(trim(coalesce(p_zone, '')), ''),
    nullif(trim(coalesce(p_path, '')), ''),
    nullif(trim(coalesce(p_ip, '')), ''),
    nullif(trim(coalesce(p_country, '')), ''),
    nullif(trim(coalesce(p_region, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_referrer, '')), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;
-- 新签名建好之后再删掉旧的 6 参版本，避免出现「函数不存在」的空窗
drop function if exists public.record_visit(text, text, text, text, text, text);
revoke all on function public.record_visit(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.record_visit(text, text, text, text, text, text, text) to authenticated;

-- ---------- 5.3 菜单点击等事件上报 ----------
create function public.track_event(
  p_event text, p_zone text default '', p_menu text default '', p_path text default ''
)
returns bigint
language plpgsql security definer volatile
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_email text;
  v_ev text;
  v_id bigint;
begin
  select auth.uid() into v_uid;
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  v_ev := nullif(trim(coalesce(p_event, '')), '');
  if v_ev is null then
    raise exception 'event required';
  end if;
  select p.email into v_email from public.profiles p where p.user_id = v_uid;
  insert into public.visit_logs (user_id, email, zone, path, event, menu)
  values (
    v_uid, v_email,
    nullif(trim(coalesce(p_zone, '')), ''),
    nullif(trim(coalesce(p_path, '')), ''),
    left(v_ev, 40),
    nullif(left(trim(coalesce(p_menu, '')), 60), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.track_event(text, text, text, text) from public, anon;
grant execute on function public.track_event(text, text, text, text) to authenticated;

-- ---------- 5.4 后台管理员操作日志 ----------
create table if not exists public.admin_actions (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  email text,
  action text not null,                       -- 如 image_upload / notice_publish / perm_update
  target text,                                -- 作用对象（类目名 / 期次 / 用户邮箱 …）
  detail jsonb not null default '{}'::jsonb
);
create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);
create index if not exists admin_actions_user_idx on public.admin_actions (user_id);

alter table public.admin_actions enable row level security;

-- 本人只能写自己的操作记录；读取只走下面的超管函数（不建 select 策略）
drop policy if exists "insert own admin action" on public.admin_actions;
create policy "insert own admin action"
  on public.admin_actions for insert to authenticated
  with check (user_id = auth.uid());

create or replace function public.log_admin_action(
  p_action text, p_target text default '', p_detail jsonb default '{}'::jsonb
)
returns bigint
language plpgsql security definer volatile
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_email text;
  v_role text;
  v_act text;
  v_id bigint;
begin
  select auth.uid() into v_uid;
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select p.email, p.role into v_email, v_role from public.profiles p where p.user_id = v_uid;
  -- 只有管理员/超管才是「后台操作」，访客不算
  if coalesce(v_role, 'visitor') not in ('admin', 'super_admin') then
    raise exception 'not allowed';
  end if;
  v_act := nullif(trim(coalesce(p_action, '')), '');
  if v_act is null then
    raise exception 'action required';
  end if;
  insert into public.admin_actions (user_id, email, action, target, detail)
  values (
    v_uid, v_email, left(v_act, 60),
    nullif(left(trim(coalesce(p_target, '')), 200), ''),
    coalesce(p_detail, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.log_admin_action(text, text, jsonb) from public, anon;
grant execute on function public.log_admin_action(text, text, jsonb) to authenticated;

-- ---------- 5.5 前台用户动向汇总（超管专用） ----------
create function public.insight_front(p_days integer default 30)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_days integer;
  v_from timestamptz;
  v_out jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'not allowed';
  end if;
  v_days := greatest(1, least(coalesce(p_days, 30), 365));
  v_from := now() - make_interval(days => v_days);

  with v as (
    select * from public.visit_logs
    where started_at >= v_from and coalesce(event, '') = ''
  )
  select jsonb_build_object(
    'script', '20261016P',
    'days', v_days,
    'from', v_from,
    'totals', (
      select jsonb_build_object(
        'views', count(*),
        'users', count(distinct user_id),
        'sec', coalesce(sum(duration_sec), 0),
        'avg_sec', coalesce(round(avg(duration_sec)), 0)
      ) from v
    ),
    'visitors', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select user_id, max(email) as email, count(*) as visits,
               coalesce(sum(duration_sec), 0) as sec,
               coalesce(round(avg(duration_sec)), 0) as avg_sec,
               count(distinct zone) as zones,
               max(started_at) as last_at,
               (array_agg(coalesce(nullif(country, ''), '') order by started_at))[1] as country,
               (array_agg(coalesce(nullif(referrer, ''), '') order by started_at))[1] as first_referrer
        from v
        group by user_id
        order by coalesce(sum(duration_sec), 0) desc, count(*) desc
        limit 200
      ) x
    ),
    'sources', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(nullif(referrer, ''), '(直接进入)') as referrer,
               count(*) as n, count(distinct user_id) as users
        from v
        group by coalesce(nullif(referrer, ''), '(直接进入)')
        order by count(*) desc
        limit 30
      ) x
    ),
    'countries', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(nullif(country, ''), '(未知)') as country,
               count(*) as n, count(distinct user_id) as users
        from v
        group by coalesce(nullif(country, ''), '(未知)')
        order by count(*) desc
        limit 30
      ) x
    ),
    'zones', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select zone, count(*) as views, count(distinct user_id) as users,
               coalesce(sum(duration_sec), 0) as sec,
               coalesce(round(avg(duration_sec)), 0) as avg_sec
        from v
        where coalesce(zone, '') <> ''
        group by zone
        order by count(*) desc
      ) x
    ),
    'menus', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(zone, '') as zone, menu, count(*) as n, count(distinct user_id) as users
        from public.visit_logs
        where started_at >= v_from and event = 'menu' and coalesce(menu, '') <> ''
        group by coalesce(zone, ''), menu
        order by count(*) desc
        limit 120
      ) x
    ),
    'daily', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select to_char(date_trunc('day', started_at), 'YYYY-MM-DD') as d,
               count(*) as views, count(distinct user_id) as users,
               coalesce(sum(duration_sec), 0) as sec
        from v
        group by date_trunc('day', started_at)
        order by date_trunc('day', started_at)
      ) x
    ),
    'recent', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object(
                 'at', started_at, 'email', email, 'zone', zone, 'path', path,
                 'referrer', referrer, 'country', country, 'sec', duration_sec
               ) as x
        from v
        order by started_at desc
        limit 80
      ) y
    )
  ) into v_out;

  return v_out;
end;
$$;
revoke all on function public.insight_front(integer) from public, anon;
grant execute on function public.insight_front(integer) to authenticated;

-- ---------- 5.6 后台管理员动向汇总（超管专用） ----------
create function public.insight_admin(p_days integer default 30)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_days integer;
  v_from timestamptz;
  v_out jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'not allowed';
  end if;
  v_days := greatest(1, least(coalesce(p_days, 30), 365));
  v_from := now() - make_interval(days => v_days);

  select jsonb_build_object(
    'days', v_days,
    'from', v_from,
    'uploads', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(p.email, i.uploaded_by::text, '(未知)') as email, count(*) as n
        from public.images i
        left join public.profiles p on p.user_id = i.uploaded_by
        where i.created_at >= v_from
        group by coalesce(p.email, i.uploaded_by::text, '(未知)')
        order by count(*) desc
        limit 50
      ) x
    ),
    'uploads_total', (
      select count(*) from public.images i where i.created_at >= v_from
    ),
    'actions', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(a.email, a.user_id::text, '(未知)') as email, a.action,
               count(*) as n, max(a.created_at) as last_at
        from public.admin_actions a
        where a.created_at >= v_from
        group by coalesce(a.email, a.user_id::text, '(未知)'), a.action
        order by count(*) desc
        limit 200
      ) x
    ),
    'by_user', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(a.email, a.user_id::text, '(未知)') as email,
               count(*) as n, max(a.created_at) as last_at,
               jsonb_object_agg(a.action, a.c) as types
        from (
          select email, user_id, action, count(*) as c
          from public.admin_actions
          where created_at >= v_from
          group by email, user_id, action
        ) a
        group by coalesce(a.email, a.user_id::text, '(未知)')
        order by count(*) desc
        limit 50
      ) x
    ),
    'recent', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object(
                 'at', a.created_at, 'email', a.email, 'action', a.action,
                 'target', a.target, 'detail', a.detail
               ) as x
        from public.admin_actions a
        order by a.created_at desc
        limit 100
      ) y
    ),
    'actions_total', (
      select count(*) from public.admin_actions a where a.created_at >= v_from
    )
  ) into v_out;

  return v_out;
end;
$$;
revoke all on function public.insight_admin(integer) from public, anon;
grant execute on function public.insight_admin(integer) to authenticated;

-- ============================================================
-- 5.7 管理员操作留痕（数据库侧自动记录，覆盖所有写入路径）
-- ------------------------------------------------------------
-- 为什么放在数据库而不是前端逐个埋点：后台的写操作分散在十几个面板里
-- （上传、批量删除、批量打标、类目/标签、周次/站点、导入、权限、公告、营销日历…），
-- 前端埋点必然漏记；这里用「语句级触发器」统一记录，任何面板、任何写法都跑不掉。
-- 口径：
--   * 只有 admin / super_admin 的写入才记（与 log_admin_action 一致，访客不记）；
--   * 一条写入语句记一条（detail.n = 本次影响行数），避免批量上传刷出成千上万条日志；
--   * 只记业务数据表；访问日志、操作日志自身、快照表、登录日志不记；
--   * 触发器为 security definer，不受 RLS 影响，也不会因为记日志失败而挡住业务写入。
-- ============================================================

create or replace function public.log_admin_tbl()
returns trigger
language plpgsql security definer volatile
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_role text;
  v_email text;
  v_n bigint := 0;
  v_lab text;
begin
  select auth.uid() into v_uid;
  if v_uid is null then return null; end if;
  select p.role, p.email into v_role, v_email from public.profiles p where p.user_id = v_uid;
  -- 只有管理员/超管算「后台操作」，访客不算
  if v_role is null or v_role not in ('admin', 'super_admin') then return null; end if;
  v_lab := coalesce(tg_argv[0], tg_table_name);
  begin
    if tg_op = 'INSERT' then select count(*) into v_n from newtab;
    elsif tg_op = 'DELETE' then select count(*) into v_n from oldtab;
    else select count(*) into v_n from newtab;
    end if;
  exception when others then v_n := 0;
  end;
  if v_n = 0 then return null; end if;
  insert into public.admin_actions (user_id, email, action, target, detail)
  values (
    v_uid, coalesce(v_email, ''),
    case tg_op when 'INSERT' then '新增' when 'UPDATE' then '修改' else '删除' end || v_lab,
    v_lab,
    jsonb_build_object('tbl', tg_table_name, 'op', lower(tg_op), 'n', v_n)
  );
  return null;
end;
$$;

-- 账号资料单独处理：只看真正变了的字段，避免管理员改自己的「常用类目」也刷出一条日志
create or replace function public.log_admin_profile()
returns trigger
language plpgsql security definer volatile
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_role text;
  v_email text;
  v_n bigint := 0;
begin
  select auth.uid() into v_uid;
  if v_uid is null then return null; end if;
  select p.role, p.email into v_role, v_email from public.profiles p where p.user_id = v_uid;
  if v_role is null or v_role not in ('admin', 'super_admin') then return null; end if;
  begin
    if tg_op = 'INSERT' then
      select count(*) into v_n from newtab where role in ('admin', 'super_admin');
    elsif tg_op = 'DELETE' then
      select count(*) into v_n from oldtab where role in ('admin', 'super_admin');
    else
      select count(*) into v_n
      from newtab n join oldtab o using (user_id)
      where n.role is distinct from o.role
         or n.manage_zones is distinct from o.manage_zones
         or n.frontend_zones is distinct from o.frontend_zones
         or n.user_tag is distinct from o.user_tag
         or n.user_note is distinct from o.user_note;
    end if;
  exception when others then v_n := 0;
  end;
  if v_n = 0 then return null; end if;
  insert into public.admin_actions (user_id, email, action, target, detail)
  values (
    v_uid, coalesce(v_email, ''), '调整账号权限', '账号',
    jsonb_build_object('tbl', 'profiles', 'op', lower(tg_op), 'n', v_n)
  );
  return null;
end;
$$;

-- 逐个挂触发器：表不存在（未启用该模块）就跳过；单个失败只提示、不中断整段脚本
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('images', '图片'),
      ('categories', '类目'),
      ('tag_defs', '标签'),
      ('site_settings', '站点设置'),
      ('trends', '趋势'),
      ('announcements', '公告'),
      ('recruit_tasks', '招品任务'),
      ('recruit_submissions', '回品提交'),
      ('recruit_categories', '招品类目'),
      ('bestseller_tasks', 'BESTSELLER任务'),
      ('bestseller_submissions', 'BESTSELLER提交'),
      ('bestseller_categories', 'BESTSELLER类目'),
      ('zone_permissions', '专区权限'),
      ('marketing_nodes', '营销日历节点'),
      ('marketing_articles', '营销日历文章'),
      ('rank_sites', '榜单站点'),
      ('rank_batches', '榜单期次'),
      ('rank_items', '榜单条目')
    ) as x(tbl, lab)
  loop
    if to_regclass('public.' || t.tbl) is null then
      raise notice '操作留痕：跳过（表不存在） %', t.tbl;
      continue;
    end if;
    execute format('drop trigger if exists trg_adminlog on public.%I', t.tbl);
    begin
      execute format(
        'create trigger trg_adminlog after insert or update or delete on public.%I '
        'referencing old table as oldtab new table as newtab '
        'for each statement execute function public.log_admin_tbl(%L)',
        t.tbl, t.lab);
    exception when others then
      raise notice '操作留痕：跳过 %（%）', t.tbl, sqlerrm;
    end;
  end loop;

  if to_regclass('public.profiles') is not null then
    execute 'drop trigger if exists trg_adminlog on public.profiles';
    begin
      execute 'create trigger trg_adminlog after insert or update or delete on public.profiles '
           || 'referencing old table as oldtab new table as newtab '
           || 'for each statement execute function public.log_admin_profile()';
    exception when others then
      raise notice '操作留痕：跳过 profiles（%）', sqlerrm;
    end;
  end if;
end $$;
