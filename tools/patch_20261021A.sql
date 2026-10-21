-- ============================================================
-- 补字段补丁（20261021A）
-- 目的：修复后台「用户动向」报 42703（column a.created_at does not exist），
--       以及同类「旧表缺字段」问题（旧表不会自动补字段）。
-- 特点：幂等（已有则跳过）、只加字段不动数据、可重复执行。
-- 说明：补列清单与 tools/setup_analytics.sql 第 5 段完全同源，自检清单由同一份清单生成。
-- 用法：在 SQL Editor 里整段运行，然后看末尾两段自检输出。
-- ============================================================

-- 1) 逐表补字段：表不存在则跳过；字段已存在则跳过
do $$
declare
  r record;
begin
  for r in
    select * from (values
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
      continue;
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = r.tbl and column_name = r.col
    ) then
      continue;
    end if;
    execute format('alter table public.%I add column %I %s', r.tbl, r.col, r.coltype);
  end loop;
end $$;

-- 2) 索引（缺则补；表不存在时跳过，避免中断）
do $$
begin
  if to_regclass('public.admin_actions') is not null then
    create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);
  end if;
  if to_regclass('public.visit_logs') is not null then
    create index if not exists visit_logs_started_idx on public.visit_logs (started_at desc);
  end if;
end $$;

-- 3) 自检 A：仍缺字段（期望 0 行；清单与上面的补列清单同源）
with need(tbl, col) as (
  values
         ('profiles','user_id'),
         ('profiles','email'),
         ('profiles','role'),
         ('profiles','created_at'),
         ('profiles','user_tag'),
         ('profiles','user_note'),
         ('profiles','manage_zones'),
         ('profiles','frontend_zones'),
         ('visit_logs','id'),
         ('visit_logs','started_at'),
         ('visit_logs','user_id'),
         ('visit_logs','email'),
         ('visit_logs','zone'),
         ('visit_logs','path'),
         ('visit_logs','ip'),
         ('visit_logs','country'),
         ('visit_logs','region'),
         ('visit_logs','city'),
         ('visit_logs','referrer'),
         ('visit_logs','event'),
         ('visit_logs','menu'),
         ('visit_logs','duration_sec'),
         ('images','id'),
         ('images','created_at'),
         ('images','uploaded_by'),
         ('images','category'),
         ('images','name'),
         ('images','path'),
         ('images','tags'),
         ('admin_actions','id'),
         ('admin_actions','created_at'),
         ('admin_actions','user_id'),
         ('admin_actions','email'),
         ('admin_actions','action'),
         ('admin_actions','target'),
         ('admin_actions','detail'),
         ('data_backups','id'),
         ('data_backups','created_at'),
         ('data_backups','kind'),
         ('data_backups','note'),
         ('data_backups','created_by'),
         ('data_backups','email'),
         ('data_backups','bytes'),
         ('data_backups','table_counts'),
         ('data_backups','payload')
)
select '仍缺字段' as "检查项", need.tbl as "表", need.col as "字段"
from need
where to_regclass('public.' || need.tbl) is not null
  and not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = need.tbl and c.column_name = need.col
  );

-- 4) 自检 B：关键表与函数是否就绪（期望全部 true）
select 'admin_actions 表' as "检查项", (to_regclass('public.admin_actions') is not null) as "已就绪"
union all
select 'visit_logs 表', (to_regclass('public.visit_logs') is not null)
union all
select 'marketing_festivals 表', (to_regclass('public.marketing_festivals') is not null)
union all
select 'insight_admin 函数',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'insight_admin');
