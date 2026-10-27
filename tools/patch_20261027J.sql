-- ============================================================================
-- patch_20261027J.sql —— 榜单打标：批次台账 + 改动历史（用于「撤回导入」）
-- ----------------------------------------------------------------------------
-- 背景：
--   20261027H 的回填只把 batch_id 写在 rank_image_tags 上，能「按批次清空」，
--   但清空不是撤回 —— 一旦某张图在前一批已打过标、后一批又覆盖过，
--   清空后一批只能把它变成空标签，原来那批的标也一起没了。
--
--   本补丁加两张表，让「撤回」变成真正的撤销：
--     rank_tag_batches  批次台账：一次导入一行（文件名、模式、写入/跳过/不匹配张数、状态）
--     rank_tag_history  改动明细：每个被改动的「图片 × 字段」记一条 before/after
--   撤回某批次时按 history 把 before 写回去，且只回滚「当前值仍等于当时写入值」的字段 ——
--   后来被人手改过的不动（避免撤回把新做的修正又冲掉）。
--
-- 幂等：可重复执行，只做加法，不改任何既有列与数据。
-- 执行位置：Supabase → SQL Editor → 整段粘贴运行。
-- ============================================================================

-- ---------------------------------------------------------------- 批次台账
create table if not exists public.rank_tag_batches (
  batch_id        text primary key,                             -- 批次号（tagimport-YYYYMMDD-HHMM）
  file_name       text not null default '',                     -- 导入的文件名
  mode            text not null default 'fill',                 -- fill=补齐空白 / overwrite=覆盖同名列
  scope           text not null default '',                     -- 该批对应的导出来源（仅记录）
  image_count     int  not null default 0,                      -- 表里有效图数
  changed_count   int  not null default 0,                      -- 实际发生改动的图数
  field_count     int  not null default 0,                      -- 改动的「图×字段」条数
  skipped_count   int  not null default 0,                      -- 因模式或值未变而跳过
  unmatched_count int  not null default 0,                      -- 对不上榜单的图数
  unknown_tags    text[] not null default '{}',                 -- 枚举外被拒的取值（最多留 200 个）
  status          text not null default 'applied',              -- applied / reverted / empty
  note            text not null default '',
  created_by      uuid,
  created_at      timestamptz not null default now(),
  reverted_at     timestamptz
);

alter table public.rank_tag_batches add column if not exists file_name       text not null default '';
alter table public.rank_tag_batches add column if not exists mode            text not null default 'fill';
alter table public.rank_tag_batches add column if not exists scope           text not null default '';
alter table public.rank_tag_batches add column if not exists image_count     int  not null default 0;
alter table public.rank_tag_batches add column if not exists changed_count   int  not null default 0;
alter table public.rank_tag_batches add column if not exists field_count     int  not null default 0;
alter table public.rank_tag_batches add column if not exists skipped_count   int  not null default 0;
alter table public.rank_tag_batches add column if not exists unmatched_count int  not null default 0;
alter table public.rank_tag_batches add column if not exists unknown_tags    text[] not null default '{}';
alter table public.rank_tag_batches add column if not exists status          text not null default 'applied';
alter table public.rank_tag_batches add column if not exists note            text not null default '';
alter table public.rank_tag_batches add column if not exists created_by      uuid;
alter table public.rank_tag_batches add column if not exists created_at      timestamptz not null default now();
alter table public.rank_tag_batches add column if not exists reverted_at     timestamptz;

create index if not exists idx_rank_tag_batches_created on public.rank_tag_batches (created_at desc);

-- ---------------------------------------------------------------- 改动历史
create table if not exists public.rank_tag_history (
  id          bigserial primary key,
  batch_id    text not null,
  image_url   text not null,
  field       text not null,                                   -- style_tags / visual_tags / craft_tags / fit_tags / ...
  before_tags text[] not null default '{}',                    -- 写入前的值（撤回时写回）
  after_tags  text[] not null default '{}',                    -- 本次写入的值（撤回时用来判断"有没有被人改过"）
  created_at  timestamptz not null default now()
);

create index if not exists idx_rank_tag_history_batch on public.rank_tag_history (batch_id);
create index if not exists idx_rank_tag_history_url   on public.rank_tag_history (image_url);

-- ---------------------------------------------------------------------------
-- 权限：与 rank_image_tags 同口径 —— 任一管理员可读写，登录用户可读
-- ---------------------------------------------------------------------------
alter table public.rank_tag_batches enable row level security;

drop policy if exists "auth read rank_tag_batches" on public.rank_tag_batches;
create policy "auth read rank_tag_batches"
  on public.rank_tag_batches for select
  to authenticated
  using (true);

drop policy if exists "admin write rank_tag_batches" on public.rank_tag_batches;
create policy "admin write rank_tag_batches"
  on public.rank_tag_batches for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin','super_admin')))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin','super_admin')));

alter table public.rank_tag_history enable row level security;

drop policy if exists "auth read rank_tag_history" on public.rank_tag_history;
create policy "auth read rank_tag_history"
  on public.rank_tag_history for select
  to authenticated
  using (true);

drop policy if exists "admin write rank_tag_history" on public.rank_tag_history;
create policy "admin write rank_tag_history"
  on public.rank_tag_history for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin','super_admin')))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin','super_admin')));

-- 刷新接口缓存，让前端立刻能读写新表（不执行会报「表不存在」）
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------- 自检
-- 期望：表已创建=2 / 策略数=4 / 已有批次=0（跑过一次回填后会 >0）
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name in ('rank_tag_batches','rank_tag_history')) as "表已创建_应为2",
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename in ('rank_tag_batches','rank_tag_history'))    as "策略数_应为4",
  (select count(*) from public.rank_tag_batches)                                            as "已有批次（参考）",
  (select count(*) from public.rank_tag_history)                                            as "历史条数（参考）";
