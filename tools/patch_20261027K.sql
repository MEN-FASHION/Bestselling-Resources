-- ============================================================================
-- patch_20261027K.sql —— 榜单标签表 rank_image_tags：建表 + 补齐九列 + 索引 + 权限
-- ----------------------------------------------------------------------------
-- 为什么需要这个补丁：
--   patch_20261027H.sql 只做了一件事 —— 给 rank_image_tags 「加三列」。
--   它默认这张表已经存在。但这张表是更早时候手工建在某个库里的，
--   仓库里从来没有它的建表脚本。所以一旦：
--     · 换了 Supabase 项目 / 重建过库 / 在别的 project 里跑补丁
--   就会直接报：ERROR 42P01: relation "public.rank_image_tags" does not exist
--   而且因为表都不存在，「三列不存在」的自检也永远返回 0。
--
-- 本补丁做的事（幂等、只做加法、可重复执行）：
--   1) 先确认你连的是不是站点那个库（站点核心表命中数必须 = 6，否则别往下跑）
--   2) 表不存在 → 按代码实际读写的字段建全表（含 H 的三列，跑完 H 就变成空操作）
--      表已存在 → 只补缺失的列，不动任何既有列与数据
--   3) image_url 唯一索引（saveRankTagRows 用的是 upsert onConflict:"image_url"，必须有）
--   4) 三个新列的 GIN 索引
--   5) RLS：登录用户可读，admin / super_admin 可写（与 patch_20261027J 同口径）
--   6) 刷新 PostgREST 缓存（否则前端仍报「列不存在 / 表不存在」）
--
-- 执行位置：Supabase → SQL Editor → 整段粘贴 → Run
-- 执行顺序：本补丁 与 patch_20261027H / J 顺序无关，建议本补丁先跑
-- ============================================================================


-- ============================================================================
-- 第 0 步：先自证「我连的是不是站点那个库」（重要，别跳过）
-- ----------------------------------------------------------------------------
-- 期望：站点核心表命中数 = 6
--   < 6  → 你连错项目了，或者这个库还没初始化。不要往下跑，
--          先去 Settings → API 对一下 Project URL 与站点配置里的是否一致。
--   = 6  → 是对的库，继续往下执行。
-- ============================================================================
select
  current_database() as "当前数据库",
  (select count(*) from information_schema.tables
     where table_schema = 'public'
       and table_name in ('images','categories','rank_items','profiles','site_settings','rank_batches')
  ) as "站点核心表命中数_应为6",
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name = 'rank_image_tags'
  ) as "rank_image_tags_是否已存在_1存在0不存在";


-- ============================================================================
-- 第 1 步：建表（已存在则跳过）
-- ----------------------------------------------------------------------------
-- 字段来源：js/supabase.js 的 listRankTagRows / saveRankTagRows 实际读写的列，
--           包括更新时写回的 updated_by，以及 20261027H 新增的三列。
-- ============================================================================
create table if not exists public.rank_image_tags (
  id           bigserial   primary key,
  image_url    text        not null,                              -- 图片外链地址（唯一键）
  category     text        not null default '',                   -- 类目
  style_tags   text[]      not null default '{}'::text[],         -- 风格
  visual_tags  text[]      not null default '{}'::text[],         -- 视觉（20261027H）
  element_tags text[]      not null default '{}'::text[],         -- 图案元素
  scene_tags   text[]      not null default '{}'::text[],         -- 场景
  craft_tags   text[]      not null default '{}'::text[],         -- 二次工艺（20261027H）
  shoot_tags   text[]      not null default '{}'::text[],         -- 拍摄方式
  skin_tags    text[]      not null default '{}'::text[],         -- 肤色
  fit_tags     text[]      not null default '{}'::text[],         -- 版型（20261027H）
  tags         text[]      not null default '{}'::text[],         -- 旧版综合标签（保留兼容）
  batch_id     text,                                              -- 写入批次号，用于按批回滚
  updated_by   uuid,                                              -- 最后修改人
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);


-- ============================================================================
-- 第 2 步：补齐缺列（表已存在但列不全时生效；表是新建的则全部是空操作）
-- ============================================================================
alter table public.rank_image_tags add column if not exists category     text   not null default '';
alter table public.rank_image_tags add column if not exists style_tags   text[] not null default '{}'::text[];
alter table public.rank_image_tags add column if not exists visual_tags  text[] not null default '{}'::text[];
alter table public.rank_image_tags add column if not exists element_tags text[] not null default '{}'::text[];
alter table public.rank_image_tags add column if not exists scene_tags   text[] not null default '{}'::text[];
alter table public.rank_image_tags add column if not exists craft_tags   text[] not null default '{}'::text[];
alter table public.rank_image_tags add column if not exists shoot_tags   text[] not null default '{}'::text[];
alter table public.rank_image_tags add column if not exists skin_tags    text[] not null default '{}'::text[];
alter table public.rank_image_tags add column if not exists fit_tags     text[] not null default '{}'::text[];
alter table public.rank_image_tags add column if not exists tags         text[] not null default '{}'::text[];
alter table public.rank_image_tags add column if not exists batch_id     text;
alter table public.rank_image_tags add column if not exists updated_by   uuid;
alter table public.rank_image_tags add column if not exists created_at   timestamptz not null default now();
alter table public.rank_image_tags add column if not exists updated_at   timestamptz not null default now();


-- ============================================================================
-- 第 3 步：image_url 唯一索引
-- ----------------------------------------------------------------------------
-- saveRankTagRows 用 upsert(..., { onConflict: "image_url" })，
-- 没有唯一约束会报 42P10 / "there is no unique or exclusion constraint"。
-- 建索引前先查重，有重复就明确报错让你先清理，而不是给一个看不懂的索引报错。
-- ============================================================================
do $$
declare
  dup_groups int;
begin
  select count(*) into dup_groups
  from (
    select image_url
    from public.rank_image_tags
    group by image_url
    having count(*) > 1
  ) t;

  if dup_groups > 0 then
    raise exception '存在 % 组重复的 image_url，无法建唯一索引。请先清理重复行，再重新执行本补丁。', dup_groups;
  end if;
end $$;

create unique index if not exists uq_rank_image_tags_url
  on public.rank_image_tags (image_url);


-- ============================================================================
-- 第 4 步：GIN 索引（数组包含查询用；与 patch_20261027H 一致）
-- ============================================================================
create index if not exists idx_rank_image_tags_visual on public.rank_image_tags using gin (visual_tags);
create index if not exists idx_rank_image_tags_craft  on public.rank_image_tags using gin (craft_tags);
create index if not exists idx_rank_image_tags_fit    on public.rank_image_tags using gin (fit_tags);

-- 按批次回滚（clearRankTagBatch 用 batch_id 过滤）
create index if not exists idx_rank_image_tags_batch  on public.rank_image_tags (batch_id);


-- ============================================================================
-- 第 5 步：行级安全策略（与 patch_20261027J 的 rank_tag_* 两张表同口径）
--   读：任意登录用户
--   写：admin / super_admin
-- ============================================================================
alter table public.rank_image_tags enable row level security;

drop policy if exists "auth read rank_image_tags" on public.rank_image_tags;
create policy "auth read rank_image_tags"
  on public.rank_image_tags for select
  to authenticated
  using (true);

drop policy if exists "admin write rank_image_tags" on public.rank_image_tags;
create policy "admin write rank_image_tags"
  on public.rank_image_tags for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role in ('admin','super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role in ('admin','super_admin')
    )
  );

-- 说明：如果前台（未登录访客）也需要看到榜单标签，可再放开匿名读，见文末可选块。


-- ============================================================================
-- 第 6 步：刷新 PostgREST 缓存
-- ----------------------------------------------------------------------------
-- 必须用单引号。写成双引号 "reload schema" 会被当成标识符解析，
-- 报 column "reload schema" does not exist —— 这正是之前那条脚本的坑。
-- ============================================================================
notify pgrst, 'reload schema';


-- ============================================================================
-- 第 7 步：自检
--   期望：标签列_应为9 / 唯一索引_应为1 / GIN索引_应为3 / 策略_应为2
--   现有行数：0 表示这是全新表（之前从未在库里建过，历史打标数据也不在这个库）
-- ============================================================================
select
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'rank_image_tags'
       and column_name in ('style_tags','element_tags','scene_tags','shoot_tags',
                           'skin_tags','tags','visual_tags','craft_tags','fit_tags')
  ) as "标签列_应为9",

  (select count(*) from pg_indexes
     where schemaname = 'public'
       and tablename = 'rank_image_tags'
       and indexname = 'uq_rank_image_tags_url'
  ) as "唯一索引_应为1",

  (select count(*) from pg_indexes
     where schemaname = 'public'
       and tablename = 'rank_image_tags'
       and indexname in ('idx_rank_image_tags_visual',
                         'idx_rank_image_tags_craft',
                         'idx_rank_image_tags_fit')
  ) as "GIN索引_应为3",

  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'rank_image_tags'
  ) as "策略_应为2",

  (select count(*) from public.rank_image_tags) as "现有行数_参考";


-- ============================================================================
-- 可选块：前台未登录访客也要读标签时才执行（默认不执行）
-- ----------------------------------------------------------------------------
-- create policy "anon read rank_image_tags"
--   on public.rank_image_tags for select
--   to anon
--   using (true);
-- ============================================================================