-- ============================================================
-- 营销日历 · 节庆库（前台只读，后台可维护）
-- ------------------------------------------------------------
-- 为什么要有这张表：
--   节庆库原来是存在浏览器本地的，只有"这台电脑"看得见，
--   后台也没法统一维护。改成入库后：后台维护一份，所有前台一致。
--
-- 前台读：所有登录用户可读（authenticated select）
-- 后台写：仅超级管理员（与其它营销表同一套判定）
--
-- 可重复执行：建表 / 建索引 / 建策略都带 if not exists 或先 drop，
-- 补字段用 add column if not exists，不删任何数据。
-- ============================================================

create table if not exists public.marketing_festivals (
  id         text primary key,                    -- 稳定标识（内置库用 d0/d1…，自定义用 i+时间戳）
  name       text not null,                       -- 节日名称
  date       text not null,                       -- 日期 MM-DD（浮动节日按 overrides 年度校准）
  en         text default '',                     -- 英文名
  region     text default '其他',                 -- 地区
  cat        text default 'trad',                 -- 类别 trad/rel/nat/promo/sport/season
  star       int  default 3,                      -- 重要度 1-5
  lead       int  default 120,                    -- 推荐提前期（天）
  dur        int  default 1,                      -- 持续天数
  idea       text default '',                     -- 选品方向
  overrides  jsonb,                               -- 指定年份日期 {"2027":"02-06"}
  note       text default '',                     -- 备注
  sort_no    int  default 0,                      -- 排序（同月内顺序）
  updated_at timestamptz not null default now()
);

alter table public.marketing_festivals add column if not exists en         text default '';
alter table public.marketing_festivals add column if not exists region     text default '其他';
alter table public.marketing_festivals add column if not exists cat        text default 'trad';
alter table public.marketing_festivals add column if not exists star       int  default 3;
alter table public.marketing_festivals add column if not exists lead       int  default 120;
alter table public.marketing_festivals add column if not exists dur        int  default 1;
alter table public.marketing_festivals add column if not exists idea       text default '';
alter table public.marketing_festivals add column if not exists overrides  jsonb;
alter table public.marketing_festivals add column if not exists note       text default '';
alter table public.marketing_festivals add column if not exists sort_no    int  default 0;
alter table public.marketing_festivals add column if not exists updated_at timestamptz not null default now();

create index if not exists marketing_festivals_sort_idx on public.marketing_festivals (sort_no, date);

alter table public.marketing_festivals enable row level security;

drop policy if exists "authenticated read marketing_festivals" on public.marketing_festivals;
create policy "authenticated read marketing_festivals"
  on public.marketing_festivals for select
  to authenticated
  using (true);

-- 前台营销日历是公开页面，访客（未登录）也要能读到节庆库，否则前台只显示内置库
drop policy if exists "public read marketing_festivals" on public.marketing_festivals;
create policy "public read marketing_festivals"
  on public.marketing_festivals for select
  to anon, authenticated
  using (true);

drop policy if exists "admin all marketing_festivals" on public.marketing_festivals;
create policy "admin all marketing_festivals"
  on public.marketing_festivals for all
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'super_admin')
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'super_admin')
  );

-- ------------------------------------------------------------
-- 跑完自检：三列都应满足
--   表在不在 = true；登录用户可读 = true；匿名可读 = true
-- ------------------------------------------------------------
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name = 'marketing_festivals') > 0 as 表已创建,
  (select count(*) from public.marketing_festivals)                as 当前节庆数,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'marketing_festivals'
       and cmd = 'SELECT') > 0                                     as 读取策略已建,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'marketing_festivals'
       and cmd = 'ALL') > 0                                        as 写入策略已建;
