-- ============================================================
-- 节日维度「前台不显示」专项排查（纯查询，不改任何数据）
-- 逐段执行，看每段的结果，对照下面的判读表即可定位原因。
-- ============================================================


-- ① 列在不在？（R 补丁建的就是这一列）
-- 判读：返回 3 行（culture_tags / psych_tags / festival_tags）= 补丁跑过；
--       只有 2 行、缺 festival_tags = R 补丁没跑 → 跑 tools/patch_20261027R.sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'rank_image_tags'
  and column_name in ('culture_tags', 'psych_tags', 'festival_tags')
order by column_name;


-- ② 有值行数：三个新维度各有多少行真的带值
-- 判读：文化/心理有数、节日为 0 → 数据没写进去（导入的表里没有节日列，或导入时被跳过）
--       三个都是 0 但总行数 > 0 → 这一批导入的其实是旧版表（没有这三个维度）
select
  count(*)                                                              as 总行数,
  count(*) filter (where coalesce(array_length(culture_tags, 1), 0) > 0) as 文化背景有值,
  count(*) filter (where coalesce(array_length(psych_tags, 1), 0) > 0)   as 消费心理有值,
  count(*) filter (where coalesce(array_length(festival_tags, 1), 0) > 0) as 节日有值,
  max(updated_at)                                                        as 最近写入时间
from public.rank_image_tags;


-- ③ 抽 10 行看节日到底存在什么样
-- 判读：能看到「圣诞节」等值 = 库里确实有，问题在前端读取 → 强刷页面；
--       一行都没有 = 库里就没有，回到 ② 的结论去重导。
select image_url, festival_tags, culture_tags, psych_tags, updated_at
from public.rank_image_tags
where coalesce(array_length(festival_tags, 1), 0) > 0
order by updated_at desc
limit 10;


-- ④ 索引是否建上（只影响查询速度，不影响显示）
select indexname
from pg_indexes
where schemaname = 'public'
  and tablename = 'rank_image_tags'
  and indexname like '%festival%';


-- ============================================================
-- 常见三种结果的处理办法
-- ------------------------------------------------------------
-- A) ① 缺 festival_tags
--    → R 补丁没跑。执行 tools/patch_20261027R.sql，然后重导一次带节日的表。
--    → 注意：补丁没跑时，前端会静默降级（读不到这一列就整列不显示），
--      后续版本会在覆盖率那行直接提示「节日维度暂不可用」。
--
-- B) ① 有列、② 节日有值 = 0、文化/心理有值 > 0
--    → 列有了但数据没进去：导入用的表里没有「节日」这一列。
--      用含节日列的导出表（28 列）重导一次，
--      模式选「覆盖同名列」，不要勾「空单元格也清空」。
--
-- C) ① ② ③ 都正常（能看到节日值）
--    → 数据没问题，是前端读取/缓存：
--      1. 确认页面资源版本已刷新（地址栏带 v=最新版号）；
--      2. 强刷一次（Ctrl+F5）再点开大图看左栏。
-- ============================================================