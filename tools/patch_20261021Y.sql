-- ============================================================
-- 补丁：我的收藏 —— 保留原图标签与排位信息
-- 版本：20261021Y
--
-- 背景：收藏只存了 title/类目/站点/环比/位次，但榜单卡片上
--       原本显示的「标签」（趋势爆款、周度激增、位次上升 12、共 3 国同款等）
--       没有跟着存，进收藏后这些信息就看不到了。
--
-- 本补丁只做加法：
--   1) fav_items 新增 tags（卡片标签快照，文本数组）
--   2) fav_items 新增 rank_pos（来源榜单位次，独立于 rank_abs，便于以后区分口径）
--   3) 通知 PostgREST 重载结构（不写这句，前端会一直 404）
--
-- 幂等：可重复执行；不删任何既有数据；不动任何既有表。
-- ============================================================

alter table public.fav_items
  add column if not exists tags text[] not null default '{}';

alter table public.fav_items
  add column if not exists rank_pos integer;

-- 便于按「标签」筛收藏（可选索引，数据量小也无害）
create index if not exists idx_fav_items_tags
  on public.fav_items using gin (tags);


-- ---------- 刷新接口缓存（关键，不能省）----------
notify pgrst, 'reload schema';


-- ---------- 自检（执行完应看到两行）----------
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'fav_items'
--    and column_name in ('tags', 'rank_pos');