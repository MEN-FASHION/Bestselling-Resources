-- ============================================================================
-- check_20261027U.sql —— 只读排查：为什么前台看不到「文化背景 / 消费心理 / 节日」
-- 全是 select，不改任何数据，可以放心在生产库跑。
-- ============================================================================

-- ① 三列到底存不存在（不存在 → 对应补丁没跑）
select column_name,
       data_type
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'rank_image_tags'
  and column_name in ('culture_tags','psych_tags','festival_tags')
order by column_name;
-- 期望：三行。少于三行 = patch_20261027Q / R 没跑完

-- ② 每个维度各有多少行有值（最关键的一段）
select
  count(*)                                              as "总行数",
  count(*) filter (where cardinality(style_tags)   > 0) as "风格",
  count(*) filter (where cardinality(visual_tags)  > 0) as "视觉",
  count(*) filter (where cardinality(element_tags) > 0) as "图案元素",
  count(*) filter (where cardinality(craft_tags)   > 0) as "二次工艺",
  count(*) filter (where cardinality(shoot_tags)   > 0) as "拍摄方式",
  count(*) filter (where cardinality(fit_tags)     > 0) as "版型",
  count(*) filter (where cardinality(culture_tags) > 0) as "文化背景",
  count(*) filter (where cardinality(psych_tags)   > 0) as "消费心理",
  count(*) filter (where cardinality(festival_tags)> 0) as "节日"
from public.rank_image_tags;
-- 文化背景 / 消费心理 = 0 而其它有值 → 数据没写进去（用带 28 列的表重导）
-- 全部 = 0 → 这个库里没有打标数据，确认是不是站点在用的那个库

-- ③ 抽样看真实值长什么样（确认不是空字符串 / 空数组里塞了空值）
select image_url,
       culture_tags, psych_tags, festival_tags,
       updated_at
from public.rank_image_tags
where cardinality(culture_tags) > 0
   or cardinality(psych_tags)   > 0
   or cardinality(festival_tags)> 0
order by updated_at desc
limit 5;

-- ④ 只有新维度、旧维度全空的行（这类行以前会被前台当成"未打标"）
select count(*) as "只打了新维度的行数"
from public.rank_image_tags
where (cardinality(culture_tags) > 0 or cardinality(psych_tags) > 0)
  and cardinality(style_tags) = 0
  and cardinality(visual_tags) = 0
  and cardinality(element_tags) = 0
  and cardinality(craft_tags) = 0;
