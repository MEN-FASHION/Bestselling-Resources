-- ============================================================================
-- 趋势上升榜专区（前台「趋势上升榜」+ 后台「站内趋势上升榜单」）
-- 可在 Supabase SQL Editor 反复执行（幂等）
-- 说明：本脚本只新增 3 张表 + 1 个聚合函数，不改动任何现有表/策略
-- ============================================================================

-- ---------- 1) 国家站点清单（后台可自定义添加/删除） ----------
create table if not exists public.rank_sites (
  id bigserial primary key,
  name text not null unique,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

alter table public.rank_sites enable row level security;

drop policy if exists "auth read rank_sites" on public.rank_sites;
create policy "auth read rank_sites"
  on public.rank_sites for select
  to authenticated
  using (true);

drop policy if exists "admin write rank_sites" on public.rank_sites;
create policy "admin write rank_sites"
  on public.rank_sites for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin update rank_sites" on public.rank_sites;
create policy "admin update rank_sites"
  on public.rank_sites for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin delete rank_sites" on public.rank_sites;
create policy "admin delete rank_sites"
  on public.rank_sites for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );


-- ---------- 2) 上传批次 ----------
create table if not exists public.rank_batches (
  id bigserial primary key,
  period_type text not null default 'week',      -- week（周度）/ month（月度）
  period_label text not null,                    -- 如 W41 / 2026-09
  category text not null default '',             -- 类目（复用「类目管理」的类目名）
  site text not null default '',                 -- 表格缺「销量站点」列时使用的默认站点
  rows integer not null default 0,               -- 本次成功写入条数
  skipped integer not null default 0,            -- 重复跳过的条数
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.rank_batches enable row level security;

drop policy if exists "auth read rank_batches" on public.rank_batches;
create policy "auth read rank_batches"
  on public.rank_batches for select
  to authenticated
  using (true);

drop policy if exists "admin write rank_batches" on public.rank_batches;
create policy "admin write rank_batches"
  on public.rank_batches for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin delete rank_batches" on public.rank_batches;
create policy "admin delete rank_batches"
  on public.rank_batches for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );


-- ---------- 3) 榜单条目 ----------
create table if not exists public.rank_items (
  id bigserial primary key,
  batch_id bigint references public.rank_batches (id) on delete cascade,
  period_type text not null default 'week',
  period_label text not null,
  category text not null default '',
  site text not null default '',
  leaf_category text not null default '',         -- 表格「叶子类目名称」
  image_url text not null,                        -- 表格「首图url」（前台展示用图）
  ratio numeric,                                  -- 表格「环比比例」（原始数值，如 522.2 表示 522.2%）
  abs_delta numeric,                              -- 表格「环比绝对值」
  flag_opportunity boolean not null default false,-- 潜力机会（环比比例上升）
  flag_hot boolean not null default false,        -- 趋势爆款（绝对值上升 TOP20）
  flag_surge boolean not null default false,      -- 周度激增（双重提升的前 20%）
  rank_ratio integer,                             -- 本批次内按环比比例降序名次
  rank_abs integer,                               -- 本批次内按环比绝对值降序名次
  created_at timestamptz not null default now(),
  unique (category, site, period_type, period_label, image_url)
);

create index if not exists idx_rank_items_lookup
  on public.rank_items (period_type, period_label, category, site);
create index if not exists idx_rank_items_period
  on public.rank_items (period_label);

alter table public.rank_items enable row level security;

drop policy if exists "auth read rank_items" on public.rank_items;
create policy "auth read rank_items"
  on public.rank_items for select
  to authenticated
  using (true);

drop policy if exists "admin write rank_items" on public.rank_items;
create policy "admin write rank_items"
  on public.rank_items for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin delete rank_items" on public.rank_items;
create policy "admin delete rank_items"
  on public.rank_items for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );


-- ---------- 4) 前台筛选所需的分面（类目 / 周次 / 国家站点） ----------
-- 前台要按「类目 → 周次 → 国家」逐级筛选，直接拉全表明细再前端去重会浪费流量，
-- 因此用 security definer 函数在服务端聚合出三份清单。
create or replace function public.rank_facets()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'sites', coalesce((select json_agg(t.name order by t.sort_order, t.name) from (
        select name, min(sort_order) as sort_order from (
          select site as name, 100 as sort_order from public.rank_items where site <> ''
          union all
          select name, sort_order from public.rank_sites
        ) u group by name
      ) t), '[]'::json),
    'periods', coalesce((select json_agg(p order by p) from (
        select distinct period_label as p from public.rank_items where period_label <> ''
      ) q), '[]'::json),
    'categories', coalesce((select json_agg(c order by c) from (
        select distinct category as c from public.rank_items where category <> ''
     ) r), '[]'::json)
  );
$$;

grant execute on function public.rank_facets() to authenticated;