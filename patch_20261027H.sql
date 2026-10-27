-- ============================================================
-- patch_20261027H.sql —— 榜单图打标：新增「视觉 / 二次工艺 / 版型」三列
--
-- 背景：
--   趋势上升榜的图只存在于 rank_items（外链地址），标签单独存 rank_image_tags。
--   本次打标维度从 6 个扩到 9 个，新增：
--     视觉（主图视觉）、二次工艺、版型（领型/袖型/袖长/衣长/松紧度/裤型/裤长/裙长，存成「领型·圆领」这种带组前缀的值）
--   原来的 style/element/scene/shoot/skin/tags 六列保持不变。
--
-- 特性：幂等、只做加法、不改任何既有列与数据。可重复执行。
-- ============================================================

alter table public.rank_image_tags add column if not exists visual_tags text[] not null default '{}';
alter table public.rank_image_tags add column if not exists craft_tags  text[] not null default '{}';
alter table public.rank_image_tags add column if not exists fit_tags    text[] not null default '{}';

-- 版型与工艺会按标签反查，建 GIN 索引（数组包含查询用得上）
create index if not exists idx_rank_image_tags_visual on public.rank_image_tags using gin (visual_tags);
create index if not exists idx_rank_image_tags_craft  on public.rank_image_tags using gin (craft_tags);
create index if not exists idx_rank_image_tags_fit    on public.rank_image_tags using gin (fit_tags);

-- 刷新接口缓存，让前端立刻能读写新列（不执行会出现「列不存在」写入失败）
notify pgrst, 'reload schema';

-- ---------- 自检 ----------
select count(*) as "三列齐全应为3"
from information_schema.columns
where table_schema = 'public'
  and table_name = 'rank_image_tags'
  and column_name in ('visual_tags', 'craft_tags', 'fit_tags');

select count(*) as "GIN索引应为3"
from pg_indexes
where schemaname = 'public'
  and tablename = 'rank_image_tags'
  and indexname in ('idx_rank_image_tags_visual', 'idx_rank_image_tags_craft', 'idx_rank_image_tags_fit');