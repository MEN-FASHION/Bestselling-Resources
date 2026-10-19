-- ============================================================
-- 【一键修复脚本】2026-10-19 · 版本 20261016V
-- ============================================================
-- 用途：修复线上库里两处「脚本跑不到、所以一直缺」的东西。可重复执行、只补不删、不动任何数据。
--
--   缺口 A：早期建的表缺字段
--           → 表现：「用户动向」面板报 42703 column a.created_at does not exist
--           → 原因：之前几轮执行中途报错中断，脚本里「补字段」那段（第 5.5 段）根本没跑到
--   缺口 B：「常用类目」相关字段与函数缺失
--           → 表现：控制台 404（get_my_favorite_categories 找不到）、常用类目存不住、类目删了还挂着
--           → 原因：常用类目那一段是后来才加进 tools/setup.sql 的，线上库还没执行过
--
-- 用法：整段复制到 SQL 编辑器，执行一次。执行完成后会输出一张自检表，对照「应为」列即可。
--       本脚本与 tools/setup_analytics.sql 内容一致（片段完全取自脚本原文），不会产生两套定义。
-- ============================================================


-- ============================================================
-- 缺口 A：补齐缺失字段（片段取自 tools/setup_analytics.sql 第 5.5 段）
-- ============================================================
-- 5.5 字段对齐（幂等 · 只补不删 · 不动数据）
-- ============================================================
-- 为什么必须有这一段：
--   `create table if not exists` 只保证「表存在」，**不会给已存在的旧表补字段**。
--   如果某张表是早期版本建出来的，而统计函数用到了后来新增的字段，
--   那么在「函数被调用的那一刻」数据库才会报 42703（column ... does not exist），
--   而建表、建函数、授权、前面的自检全都显示正常 —— 极难定位。
--   这里把统计/备份模块依赖到的字段全部幂等补齐：
--     表不存在 → 跳过；字段已存在 → 跳过；缺字段 → 补上（带安全默认值）。
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- ⚠️ 这份清单必须是「统计模块真正用到的字段」的全集，少一个就会出现 42703。
      --    2026-10-19 真实故障：`visit_logs.started_at` 被 insight_front 的每一段查询使用，
      --    却漏在这份清单里 → 旧表永远补不上 → 后台「用户动向」一直报 42703。
      --    下面的清单已补全（含各表主键与 created_at/started_at 等时间戳），并由
      --    tools/verify_sql_columns.js 自动交叉核对，防止再次漏项。
      -- 用户表
      ('profiles','user_id','uuid'),
      ('profiles','email','text'),
      ('profiles','role','text'),
      ('profiles','created_at','timestamptz not null default now()'),
      ('profiles','user_tag','text not null default '''' '),
      ('profiles','user_note','text not null default '''' '),
      ('profiles','manage_zones','jsonb not null default ''[]''::jsonb'),
      ('profiles','frontend_zones','jsonb not null default ''[]''::jsonb'),
      -- 访问记录表（id 供 record_visit 返回、visit_ping 心跳定位；started_at 是统计的时间轴）
      ('visit_logs','id','bigserial'),
      ('visit_logs','started_at','timestamptz not null default now()'),
      ('visit_logs','user_id','uuid'),
      ('visit_logs','email','text'),
      ('visit_logs','zone','text'),
      ('visit_logs','path','text'),
      ('visit_logs','ip','text'),
      ('visit_logs','country','text'),
      ('visit_logs','region','text'),
      ('visit_logs','city','text'),
      ('visit_logs','referrer','text'),
      ('visit_logs','event','text'),
      ('visit_logs','menu','text'),
      ('visit_logs','duration_sec','integer not null default 0'),
      -- 图片表（上传数统计依赖 uploaded_by + created_at；path/category 等供记录引用）
      ('images','id','uuid default gen_random_uuid()'),
      ('images','created_at','timestamptz not null default now()'),
      ('images','uploaded_by','uuid'),
      ('images','category','text'),
      ('images','name','text'),
      ('images','path','text'),
      ('images','tags','text[] not null default ''{}'''),
      -- 后台操作日志（id 主键；created_at 是动向趋势的时间轴）
      ('admin_actions','id','bigserial'),
      ('admin_actions','created_at','timestamptz not null default now()'),
      ('admin_actions','user_id','uuid'),
      ('admin_actions','email','text'),
      ('admin_actions','action','text'),
      ('admin_actions','target','text'),
      ('admin_actions','detail','jsonb not null default ''{}''::jsonb'),
      -- 备份表（由 tools/setup_backup.sql 建立；未建则整表跳过）
      ('data_backups','id','bigserial'),
      ('data_backups','created_at','timestamptz not null default now()'),
      ('data_backups','kind','text'),
      ('data_backups','note','text'),
      ('data_backups','created_by','uuid'),
      ('data_backups','email','text'),
      ('data_backups','bytes','bigint'),
      ('data_backups','table_counts','jsonb'),
      ('data_backups','payload','jsonb')
    ) as t(tbl, col, coltype)
  loop
    if to_regclass('public.' || r.tbl) is null then
      continue;                                   -- 表还不存在，跳过
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = r.tbl and column_name = r.col
    ) then
      continue;                                   -- 字段已存在，跳过
    end if;
    execute format('alter table public.%I add column %I %s', r.tbl, r.col, r.coltype);
  end loop;
end $$;


-- ============================================================
-- 缺口 B：常用类目（片段取自 tools/setup.sql 原文）
-- ============================================================
-- ============================================================
-- 【2026-10-18】常用类目（每个管理员自己的快捷清单）+ 类目删除时的一致性清理
-- ============================================================
-- 历史缺陷：profiles 表从未建立 favorite_categories 字段，而且 profiles 的 update 策略只给了超管，
-- 普通账号无权更新自己的 profiles。结果是「我的常用类目」能勾、能点保存、还提示成功，
-- 实际一个字节都没写进库；「常用置顶」从来没生效过，类目删掉后旧项也一直挂着。
-- 这里补上字段，并用 security definer 函数完成读写 —— 不放开 profiles 的 update 策略，避免提权风险。
alter table public.profiles
  add column if not exists favorite_categories text[] not null default '{}';

-- 读：当前账号自己的常用类目
create or replace function public.get_my_favorite_categories()
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare v text[];
begin
  if auth.uid() is null then return '{}'::text[]; end if;
  select favorite_categories into v from public.profiles where user_id = auth.uid();
  return coalesce(v, '{}'::text[]);
end $$;

-- 写：只写自己那一行，去空 + 去重
create or replace function public.set_my_favorite_categories(p_list text[])
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare v text[];
begin
  if auth.uid() is null then raise exception '未登录'; end if;
  select array_agg(distinct btrim(x)) into v
    from unnest(coalesce(p_list, '{}'::text[])) as x
   where btrim(coalesce(x, '')) <> '';
  v := coalesce(v, '{}'::text[]);
  update public.profiles set favorite_categories = v where user_id = auth.uid();
  return v;
end $$;

-- 类目被删除时：把该类目从所有管理员的常用类目里一并移除
create or replace function public.remove_category_from_profiles(p_name text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer := 0;
begin
  if not exists (select 1 from public.profiles p
                 where p.user_id = auth.uid() and p.role in ('admin','super_admin')) then
    raise exception '没有权限';
  end if;
  if coalesce(btrim(p_name), '') = '' then return 0; end if;
  update public.profiles
     set favorite_categories = array_remove(coalesce(favorite_categories, '{}'), btrim(p_name))
   where coalesce(favorite_categories, '{}') @> array[btrim(p_name)];
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.get_my_favorite_categories() to authenticated;
grant execute on function public.set_my_favorite_categories(text[]) to authenticated;
grant execute on function public.remove_category_from_profiles(text) to authenticated;


-- ============================================================
-- 自检：执行后看这张表。所有「应为」列都相等即为修复完成。
-- ============================================================
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='admin_actions' and column_name='created_at') as "留痕表_created_at_应为1",
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='visit_logs' and column_name='started_at')    as "访问表_started_at_应为1",
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='favorite_categories') as "资料表_常用类目_应为1",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname in ('insight_front','insight_admin','track_event')) as "动向函数数_应为3",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname in
      ('get_my_favorite_categories','set_my_favorite_categories','remove_category_from_profiles')) as "常用类目函数数_应为3";

-- 逐表列出仍然缺的字段（期望结果：0 行 = 字段已齐备）
with need(tbl, col) as (values
  ('visit_logs','id'), ('visit_logs','user_id'), ('visit_logs','email'), ('visit_logs','path'),
  ('visit_logs','started_at'), ('visit_logs','last_seen_at'), ('visit_logs','duration_sec'),
  ('visit_logs','referrer'), ('visit_logs','device'), ('visit_logs','event'), ('visit_logs','menu'),
  ('images','id'), ('images','created_at'), ('images','uploaded_by'), ('images','category'),
  ('images','name'), ('images','path'), ('images','tags'),
  ('admin_actions','id'), ('admin_actions','created_at'), ('admin_actions','user_id'),
  ('admin_actions','email'), ('admin_actions','action'), ('admin_actions','target'), ('admin_actions','detail'),
  ('profiles','user_id'), ('profiles','created_at'), ('profiles','favorite_categories')
)
select n.tbl as "表", n.col as "缺失字段"
from need n
where to_regclass('public.' || n.tbl) is not null
  and not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name=n.tbl and c.column_name=n.col
  )
order by 1, 2;
