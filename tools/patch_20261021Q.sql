-- ============================================================================
-- patch_20261021Q.sql —— 趋势上升榜「榜单打标」独立标签表
-- ----------------------------------------------------------------------------
-- 背景：
--   后台「图片管理 → 智能打标」打的是图库（images）里的图；
--   但趋势上升榜的图只存在于 rank_items（表格里的「首图url」外链），图库里没有这些记录，
--   所以在图片管理里根本看不到它们，也就无从打标 —— 周报六个维度页因此长期为空。
--
-- 本脚本新建一张独立的标签表 rank_image_tags，专门存榜单图的打标结果：
--   * 一张图一行（image_url 主键），同一张图出现在多期/多站点也只打一次标、全站复用；
--   * 与 images 表完全解耦，不污染图片管理列表与数据看板；
--   * 后台新增的「榜单打标」面板读写这张表，周报按地址把两张表的结果合并（本表优先）。
--
-- 幂等：可重复执行，不会删任何既有数据。
-- 执行位置：Supabase → SQL Editor → 整段粘贴运行。
-- ============================================================================

create table if not exists public.rank_image_tags (
  image_url    text primary key,                                        -- 首图 url（与 rank_items.image_url 对应）
  category     text not null default '',                                -- 类目（打标时顺带记录，便于按类目筛）
  leaf_category text not null default '',                               -- 叶子类目（来自榜单表格）
  style_tags   text[] not null default '{}',                            -- 款式与版型
  element_tags text[] not null default '{}',                            -- 图案印花与设计元素（二次工艺由此派生）
  scene_tags   text[] not null default '{}',                            -- 场景与背景构成
  shoot_tags   text[] not null default '{}',                            -- 主图视觉
  skin_tags    text[] not null default '{}',                            -- 模特肤色
  tags         text[] not null default '{}',                            -- 渠道/其它（与图库同名字段，保留兼容）
  batch_id     text,                                                    -- 写入批次（用于"一键回滚本批次"）
  updated_by   uuid,                                                    -- 最后修改人
  updated_at   timestamptz not null default now()
);

-- 老库补列（若表已存在但缺列）
alter table public.rank_image_tags add column if not exists leaf_category text not null default '';
alter table public.rank_image_tags add column if not exists style_tags   text[] not null default '{}';
alter table public.rank_image_tags add column if not exists element_tags text[] not null default '{}';
alter table public.rank_image_tags add column if not exists scene_tags   text[] not null default '{}';
alter table public.rank_image_tags add column if not exists shoot_tags   text[] not null default '{}';
alter table public.rank_image_tags add column if not exists skin_tags    text[] not null default '{}';
alter table public.rank_image_tags add column if not exists tags         text[] not null default '{}';
alter table public.rank_image_tags add column if not exists batch_id     text;
alter table public.rank_image_tags add column if not exists updated_by   uuid;
alter table public.rank_image_tags add column if not exists updated_at   timestamptz not null default now();

create index if not exists idx_rank_image_tags_batch on public.rank_image_tags (batch_id);
create index if not exists idx_rank_image_tags_cat   on public.rank_image_tags (category);

-- ---------------------------------------------------------------------------
-- 权限：与「趋势上升榜」后台面板同口径 —— 任一管理员可读写，登录用户可读
-- （不挂视觉专区的类目级授权，避免榜单打标被图片库的写策略卡住）
-- ---------------------------------------------------------------------------
alter table public.rank_image_tags enable row level security;

drop policy if exists "auth read rank_image_tags" on public.rank_image_tags;
create policy "auth read rank_image_tags"
  on public.rank_image_tags for select
  to authenticated
  using (true);

drop policy if exists "admin insert rank_image_tags" on public.rank_image_tags;
create policy "admin insert rank_image_tags"
  on public.rank_image_tags for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin update rank_image_tags" on public.rank_image_tags;
create policy "admin update rank_image_tags"
  on public.rank_image_tags for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin delete rank_image_tags" on public.rank_image_tags;
create policy "admin delete rank_image_tags"
  on public.rank_image_tags for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

-- ---------------------------------------------------------------------------
-- 自检（执行后应看到：表已创建=t / 策略数=4 / 行数=0 或已有行数）
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name = 'rank_image_tags') as "表已创建_应为1",
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'rank_image_tags')          as "策略数_应为4",
  (select count(*) from public.rank_image_tags)                            as "已打标图片数",
  (select count(*) from public.rank_items where image_url <> '')           as "榜单图总数（参考）";