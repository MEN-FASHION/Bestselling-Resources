-- ============================================================
-- patch_20261021R.sql · 前台「我的收藏」专区
--
-- 两张表，全部按登录用户隔离（每人一套分类、一套收藏）：
--   1) fav_categories —— 用户自定义分类（带颜色，用于平铺时的类别框）
--   2) fav_items     —— 收藏条目（存快照，不依赖榜单数据是否还在）
--
-- 关键口径（用户已拍板）：
--   · 同一张图在 W40、W41 都上榜 → 收藏算【两条】，各归各的周；
--     因此唯一键是 (user_id, period_label, image_url)，不是只按图地址去重。
--   · 删除分类不删图：先把条目退回「未分类」，再删分类。
--   · 快照字段（title/leaf_category/site/ratio/rank_abs）落库，
--     这样榜单换期、旧批次被清理后，收藏里的图不会变成空白卡片。
--
-- 幂等：可重复执行；不删任何既有数据；不动任何既有表。
-- ============================================================

-- ---------- 1) 收藏分类 ----------
create table if not exists public.fav_categories (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '',
  color text not null default '',            -- 类别颜色（平铺时类别框用），空则前端按序号自动分配
  sort integer not null default 0,           -- 手动排序（越小越前）
  created_at timestamptz not null default now(),
  unique (user_id, name)                     -- 同一用户下分类名不重复，避免平铺时出现两个同名框
);

create index if not exists idx_fav_categories_user
  on public.fav_categories (user_id, sort);

alter table public.fav_categories enable row level security;

drop policy if exists "own read fav_categories" on public.fav_categories;
create policy "own read fav_categories"
  on public.fav_categories for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "own insert fav_categories" on public.fav_categories;
create policy "own insert fav_categories"
  on public.fav_categories for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "own update fav_categories" on public.fav_categories;
create policy "own update fav_categories"
  on public.fav_categories for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own delete fav_categories" on public.fav_categories;
create policy "own delete fav_categories"
  on public.fav_categories for delete
  to authenticated
  using (user_id = auth.uid());


-- ---------- 2) 收藏条目 ----------
create table if not exists public.fav_items (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id bigint references public.fav_categories (id) on delete set null,
  -- 图片与来源快照
  image_url text not null,
  title text not null default '',
  leaf_category text not null default '',
  rank_category text not null default '',      -- 来源榜单类目（不是用户分类）
  site text not null default '',
  period_type text not null default 'week',
  period_label text not null default '',       -- 周分组键（如 2026-W41）
  ratio numeric,
  rank_abs integer,
  created_at timestamptz not null default now(),
  -- 同一用户 + 同一期 + 同一张图 = 一条；同一张图出现在另一期 = 另起一条
  unique (user_id, period_label, image_url)
);

create index if not exists idx_fav_items_user_period
  on public.fav_items (user_id, period_label);
create index if not exists idx_fav_items_user_cat
  on public.fav_items (user_id, category_id);

alter table public.fav_items enable row level security;

drop policy if exists "own read fav_items" on public.fav_items;
create policy "own read fav_items"
  on public.fav_items for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "own insert fav_items" on public.fav_items;
create policy "own insert fav_items"
  on public.fav_items for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "own update fav_items" on public.fav_items;
create policy "own update fav_items"
  on public.fav_items for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own delete fav_items" on public.fav_items;
create policy "own delete fav_items"
  on public.fav_items for delete
  to authenticated
  using (user_id = auth.uid());

-- 说明：收藏只对登录用户开放（策略限定 to authenticated）。
-- 未登录访客在前台点星标会提示「请先登录」，不会产生任何写入。


-- ---------- 3) 刷新接口缓存（关键，不能省）----------
-- PostgREST 会缓存表结构。新建的表如果不通知它重载，
-- 前端请求会一直返回 404（"Could not find the table in the schema cache"），
-- 表现就是"脚本明明执行了，点收藏还是报错"。
notify pgrst, 'reload schema';


-- ---------- 4) 自检（执行完应看到两行）----------
-- select table_name from information_schema.tables
--  where table_schema = 'public' and table_name in ('fav_categories', 'fav_items');