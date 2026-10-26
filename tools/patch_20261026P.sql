-- ============================================================================
-- 大码专区（大码 × 标码 同类目对比）—— 20261026P
-- 可在 Supabase SQL Editor 反复执行（幂等）
-- 说明：本脚本只新增 3 张表 + 1 个聚合函数，不改动任何现有表 / 策略 / 数据。
--   rank_plus_batches  大码上传批次（每次上传一条，独立思考「大码自己的期次」）
--   rank_plus_items    大码榜单条目（与 rank_items 完全分离，互不影响）
--   rank_plus_matches  同款匹配结论（标码某张图 ↔ 大码某张图 / 判定为大码机会）
-- 标码侧不新建表：直接沿用现有 rank_items（趋势上升榜）。
-- ============================================================================

-- ---------- 1) 大码上传批次 ----------
create table if not exists public.rank_plus_batches (
  id bigserial primary key,
  period_type text not null default 'week',   -- week / month
  period_label text not null,                 -- 如 W43 / 2026-09（大码自己的期次）
  rows integer not null default 0,            -- 本次成功写入条数
  skipped integer not null default 0,         -- 合并 / 跳过条数
  note text not null default '',              -- 备注（可写文件说明）
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.rank_plus_batches enable row level security;

drop policy if exists "auth read rank_plus_batches" on public.rank_plus_batches;
create policy "auth read rank_plus_batches"
  on public.rank_plus_batches for select
  to authenticated
  using (true);

drop policy if exists "admin write rank_plus_batches" on public.rank_plus_batches;
create policy "admin write rank_plus_batches"
  on public.rank_plus_batches for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin update rank_plus_batches" on public.rank_plus_batches;
create policy "admin update rank_plus_batches"
  on public.rank_plus_batches for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin delete rank_plus_batches" on public.rank_plus_batches;
create policy "admin delete rank_plus_batches"
  on public.rank_plus_batches for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );


-- ---------- 2) 大码榜单条目 ----------
create table if not exists public.rank_plus_items (
  id bigserial primary key,
  batch_id bigint references public.rank_plus_batches (id) on delete cascade,
  period_type text not null default 'week',
  period_label text not null,
  category text not null default '',          -- 类目（一个 sheet 一个类目，或表内「类目」列）
  site text not null default '',              -- 站点（可空：大码常按「全部站点」上传）
  leaf_category text not null default '',
  title text not null default '',             -- 货品名称（同款匹配要用）
  image_url text not null,                    -- 首图 url（前台展示 + 视觉匹配用）
  ratio numeric,                              -- 环比比例（原始百分数，如 522.2）
  abs_delta numeric,                          -- 环比绝对值
  rank_ratio integer,                         -- 本次上传内按环比比例降序名次
  created_at timestamptz not null default now()
);

create index if not exists idx_rank_plus_items_lookup
  on public.rank_plus_items (period_label, category, site);
create index if not exists idx_rank_plus_items_period
  on public.rank_plus_items (period_label);

alter table public.rank_plus_items enable row level security;

drop policy if exists "auth read rank_plus_items" on public.rank_plus_items;
create policy "auth read rank_plus_items"
  on public.rank_plus_items for select
  to authenticated
  using (true);

drop policy if exists "admin write rank_plus_items" on public.rank_plus_items;
create policy "admin write rank_plus_items"
  on public.rank_plus_items for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin delete rank_plus_items" on public.rank_plus_items;
create policy "admin delete rank_plus_items"
  on public.rank_plus_items for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );


-- ---------- 3) 同款匹配结论 ----------
-- 一行 = 一条「标码商品」的判定结果：
--   decision = 'same'   标码这个款，大码里有同款（不打「大码机会」）
--   decision = 'gap'    标码这个款，大码里没有 → 打「大码机会」
--   decision = 'review' 相似度落在边界档，等人工判
-- method：auto（算法判定）/ manual（人工判定）
-- 人工结论（method = 'manual'）在重算时会被优先保留，不会被算法覆盖。
create table if not exists public.rank_plus_matches (
  id bigserial primary key,
  period_label text not null,                 -- 大码期次（对比锚点）
  category text not null default '',
  site text not null default '',
  std_image_url text not null,                -- 标码侧：rank_items.image_url
  plus_image_url text not null default '',    -- 大码侧：命中的 rank_plus_items.image_url（未命中为空）
  score numeric,                              -- 综合相似度 0~1
  score_img numeric,                          -- 分项：图片
  score_txt numeric,                          -- 分项：标题
  score_sem numeric,                          -- 分项：语义向量（未启用为空）
  method text not null default 'auto',
  decision text not null default 'review',
  decided_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (period_label, category, site, std_image_url)
);

create index if not exists idx_rank_plus_matches_lookup
  on public.rank_plus_matches (period_label, category);

alter table public.rank_plus_matches enable row level security;

drop policy if exists "auth read rank_plus_matches" on public.rank_plus_matches;
create policy "auth read rank_plus_matches"
  on public.rank_plus_matches for select
  to authenticated
  using (true);

drop policy if exists "admin write rank_plus_matches" on public.rank_plus_matches;
create policy "admin write rank_plus_matches"
  on public.rank_plus_matches for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin update rank_plus_matches" on public.rank_plus_matches;
create policy "admin update rank_plus_matches"
  on public.rank_plus_matches for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin delete rank_plus_matches" on public.rank_plus_matches;
create policy "admin delete rank_plus_matches"
  on public.rank_plus_matches for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );



-- ---------- 4) 授权：Supabase 新建表默认不一定带 authenticated 的权限，这里显式给上 ----------
-- 只给「读 + 写」，且写权限仍受上面的 RLS 策略约束（非 admin / super_admin 写不进去）。
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.rank_plus_batches  to authenticated;
grant select, insert, update, delete on public.rank_plus_items    to authenticated;
grant select, insert, update, delete on public.rank_plus_matches  to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- 5) 大码侧的分面（类目 / 期次） ----------
-- 前台「大码专区」的类目集合以大码为准，因此这里只聚合 rank_plus_items，
-- 不去碰 rank_items（标码侧有哪些类目，不影响专区的类目清单）。
create or replace function public.rank_plus_facets()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'periods', coalesce((select json_agg(p order by p) from (
        select distinct period_label as p from public.rank_plus_items where period_label <> ''
      ) q), '[]'::json),
    'categories', coalesce((select json_agg(c order by c) from (
        select distinct category as c from public.rank_plus_items where category <> ''
      ) r), '[]'::json)
  );
$$;

grant execute on function public.rank_plus_facets() to authenticated;

-- ---------- 6) 让接口层立刻认识新表 / 新函数（否则前端会报「表不存在」直到缓存过期） ----------
notify pgrst, 'reload schema';

-- 完成。自检（可选）：下面三条应各返回一行计数
-- select count(*) from public.rank_plus_batches;
-- select count(*) from public.rank_plus_items;
-- select public.rank_plus_facets();
