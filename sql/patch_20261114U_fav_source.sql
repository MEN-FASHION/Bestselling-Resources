-- ============================================================================
-- 20261114U · 我的收藏支持「跨专区取图」
--
-- 干什么：给 fav_items 增加 source 列，记下这张图是从哪个专区收藏的。
--         收藏页据此按专区成列，并给出各专区的类目 / 站点 / 期次 / 上下装 / 标签分布对比。
--
-- 影响面：只加一列、只建一个索引。不动任何已有数据，不删除、不改写。
--
-- 要不要跑：不跑也能用 —— 前端读写都做了缺列降级，只是所有收藏会归到「未标注专区」，
--           看不到按专区分列与对比。想让「跨专区」这个能力真正生效，跑一次这份脚本。
--           重复执行安全（IF NOT EXISTS），以前跑过也不会报错。
-- ============================================================================

alter table public.fav_items
  add column if not exists source text;

comment on column public.fav_items.source is
  '收藏来源专区：rank / rhythm / shein / pinterest / tiktok / compare / movement / vision；历史数据为空，前端归到「未标注专区」';

-- 按来源筛选与分组都会走到这一列
create index if not exists fav_items_user_source_idx
  on public.fav_items (user_id, source);

-- 核对：查一下这一列在不在，空了就是还没跑成功
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'fav_items'
   and column_name = 'source';

-- 核对：现有收藏按来源分布（历史数据都会是 null，属正常）
select coalesce(source, '(未标注)') as source, count(*) as n
  from public.fav_items
 group by 1
 order by 2 desc;
