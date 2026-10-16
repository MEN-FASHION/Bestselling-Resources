-- ============================================================
-- TREND BANK · 数据看板（访问统计 / 用户增长 / 地区分布）
-- 版本：20261016H
-- 用法：在 Supabase SQL Editor 整段执行（可重复执行，不会重复建表、不会清数据）
-- 目的：回答「用户从哪来、有多少、在干什么、干了多久」
--   ① visit_logs：登录用户每次进入某专区的访问记录（专区 / 停留时长 / IP / 国家地区）
--   ② record_visit()：页面打开时登记一次访问
--   ③ visit_ping()：页面心跳累加停留时长（含离开页面时补最后一次）
--   ④ admin_dashboard()：超管专用，一次返回全部看板指标（用户增长 / 在线时长 / 各专区 / 地区分布 / 最近活跃）
--   ⑤ is_super_admin()：超管判定（本脚本一并重建，容错大小写与首尾空格）
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

-- ---------- 4. 数据看板（超管专用，一次返回全部指标） ----------
drop function if exists public.admin_dashboard();
create function public.admin_dashboard()
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_role text;
  v_is_super boolean;
  -- 时间口径统一按北京时间（Asia/Shanghai）切分「今日/昨日/本周/本月」，避免按 UTC 结算导致跨天偏差
  v_today timestamptz;
  v_yday timestamptz;
  v_week timestamptz;
  v_month timestamptz;
  v_last_month timestamptz;
  v jsonb;
begin
  -- 超管判定：直接读自己的 profiles 角色并做容错归一化（不依赖外部函数是否存在）
  select auth.uid() into v_uid;
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select p.role into v_role from public.profiles p where p.user_id = v_uid;
  v_is_super := (lower(btrim(coalesce(v_role, ''))) = 'super_admin');
  if not v_is_super then
    return null;  -- 非超管返回 null（不给任何数据）
  end if;

  v_today := (((now() at time zone 'Asia/Shanghai')::date)::timestamp at time zone 'Asia/Shanghai');
  v_yday := v_today - interval '1 day';
  v_week := ((( (now() at time zone 'Asia/Shanghai')::date
               - extract(dow from (now() at time zone 'Asia/Shanghai')::date)::int ))::timestamp at time zone 'Asia/Shanghai');
  v_month := ((date_trunc('month', (now() at time zone 'Asia/Shanghai')::date))::timestamp at time zone 'Asia/Shanghai');
  v_last_month := (((date_trunc('month', (now() at time zone 'Asia/Shanghai')::date)) - interval '1 month')::timestamp at time zone 'Asia/Shanghai');

  select jsonb_build_object(
    -- ===== 本次调用元信息（便于确认"服务端认为你是谁"） =====
    'meta', jsonb_build_object(
      'script', '20261016H',
      'uid', v_uid::text,
      'role', coalesce(v_role, ''),
      'isSuper', true
    ),
    -- ===== 用户增长 =====
    'users', (
      select jsonb_build_object(
        'total',      count(*)::int,
        'newToday',   count(*) filter (where created_at >= v_today)::int,
        'newYday',    count(*) filter (where created_at >= v_yday and created_at < v_today)::int,
        'newWeek',    count(*) filter (where created_at >= v_week)::int,
        'newMonth',   count(*) filter (where created_at >= v_month)::int,
        'newLastMonth', count(*) filter (where created_at >= v_last_month and created_at < v_month)::int,
        'newPrev7',   count(*) filter (where created_at >= v_today - interval '7 day' and created_at < v_today)::int
      )
      from public.profiles
    ),
    -- ===== 访问 / 在线时长 =====
    'visits', (
      select jsonb_build_object(
        'pvToday',  count(*) filter (where started_at >= v_today)::int,
        'pvYday',   count(*) filter (where started_at >= v_yday and started_at < v_today)::int,
        'pvTotal',  count(*)::int,
        'uvToday',  count(distinct user_id) filter (where started_at >= v_today)::int,
        'uvYday',   count(distinct user_id) filter (where started_at >= v_yday and started_at < v_today)::int,
        'uvTotal',  count(distinct user_id)::int,
        'durToday', coalesce(sum(duration_sec) filter (where started_at >= v_today), 0)::int,
        'durYday',  coalesce(sum(duration_sec) filter (where started_at >= v_yday and started_at < v_today), 0)::int,
        'durTotal', coalesce(sum(duration_sec), 0)::int,
        'durAvg',   coalesce(round(avg(nullif(duration_sec, 0))), 0)::int
      )
      from public.visit_logs
    ),
    -- ===== 各专区：今日/累计 访问量 + 停留时长（回答"在干什么、干了多久"） =====
    'zones', coalesce((
      select jsonb_agg(x order by (x->>'pvTotal')::int desc)
      from (
        select jsonb_build_object(
          'zone',     zone,
          'pvToday',  count(*) filter (where started_at >= v_today)::int,
          'pvTotal',  count(*)::int,
          'uvTotal',  count(distinct user_id)::int,
          'uvToday',  count(distinct user_id) filter (where started_at >= v_today)::int,
          'durToday', coalesce(sum(duration_sec) filter (where started_at >= v_today), 0)::int,
          'durTotal', coalesce(sum(duration_sec), 0)::int
        ) as x
        from public.visit_logs
        where zone is not null
        group by zone
      ) t
    ), '[]'::jsonb),
    -- ===== 地区分布（按 IP 解析出的国家/省州聚合；回答"用户从哪来"） =====
    'regions', coalesce((
      select jsonb_agg(x order by (x->>'pvTotal')::int desc)
      from (
        select jsonb_build_object(
          'country', coalesce(nullif(country, ''), '未知'),
          'region',  coalesce(nullif(region, ''), nullif(country, ''), '未知'),
          'city',    coalesce(nullif(city, ''), ''),
          'users',   count(distinct user_id)::int,
          'pvToday', count(*) filter (where started_at >= v_today)::int,
          'pvTotal', count(*)::int,
          'durTotal', coalesce(sum(duration_sec), 0)::int
        ) as x
        from public.visit_logs
        -- ⚠️ 必须按「表达式」分组，不能用 group by 1,2,3：
        -- 本子查询的输出只有一列（jsonb_build_object(...) as x），
        -- 而 group by 序号指的是「输出列的位置」。group by 2 会因为「select 列表里没有第 2 列」
        -- 直接报错 42803（GROUP BY position 2 is not in select list）—— 而且每次调用都会报，
        -- 导致看板接口永远 400、页面读不到任何数据。
        -- 该错误只在函数被调用（首次执行）时抛出，所以"函数是否存在"的自检会显示为已建好，掩盖这个问题。
        group by coalesce(nullif(country, ''), '未知'),
                 coalesce(nullif(region, ''), nullif(country, ''), '未知'),
                 coalesce(nullif(city, ''), '')
      ) t
    ), '[]'::jsonb),
    -- ===== 最近活跃（谁、在哪个专区、停留多久、从哪个地区来） =====
    'recent', coalesce((
      select jsonb_agg(x order by (x->>'startedAt') desc)
      from (
        select jsonb_build_object(
          'email',    coalesce(nullif(l.email, ''), '（未知用户）'),
          'zone',     coalesce(l.zone, ''),
          'country',  coalesce(nullif(l.country, ''), ''),
          'region',   coalesce(nullif(l.region, ''), ''),
          'city',     coalesce(nullif(l.city, ''), ''),
          'ip',       coalesce(l.ip, ''),
          'duration', l.duration_sec,
          'startedAt', l.started_at
        ) as x
        from public.visit_logs l
        order by l.started_at desc
        limit 20
      ) t
    ), '[]'::jsonb),
    'serverTime', now()
  ) into v;

  return v;
end;
$$;
-- 授权：只有登录用户可调用（匿名用户不可调用；非超管调用会返回空）
revoke all on function public.admin_dashboard() from public, anon;
grant execute on function public.admin_dashboard() to authenticated;

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
select '看板接口 admin_dashboard',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'admin_dashboard')
union all
select '超管判定 is_super_admin',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'is_super_admin');

-- 自检 ②：接口授权 / 超管账号 / 现有数据量（期望：登录用户可调用 = true，匿名可调用 = false）
-- 说明：SQL Editor 里没有浏览器登录态，所以 auth.uid() 为空属正常，不影响下面这些检查。
select
  has_function_privilege('authenticated', 'public.admin_dashboard()', 'EXECUTE') as "登录用户可调用看板",
  has_function_privilege('anon', 'public.admin_dashboard()', 'EXECUTE') as "匿名可调用看板_应为false",
  (select count(*) from public.visit_logs) as "已有访问记录数",
  (select count(*) from public.profiles where lower(btrim(coalesce(role, ''))) = 'super_admin') as "超管账号数",
  (select string_agg(coalesce(email, '(无邮箱)') || ' → ' || coalesce(role, '(空)'), '  |  ' order by email) from public.profiles) as "全部账号与角色";

-- ============================================================
-- 执行完成后：前台各页面打开时会自动登记访问（仅登录用户），
-- 超管后台「权限管理 → 数据看板」即可看到今天谁来了、从哪来、看了哪个专区、待了多久。
-- 若执行后后台仍提示"没有看板权限"，请点后台的「看板自检」按钮，
-- 并用浏览器 F12 → Console 查看「[看板诊断]」开头的记录（里面含接口返回的真实错误码）。
-- ============================================================