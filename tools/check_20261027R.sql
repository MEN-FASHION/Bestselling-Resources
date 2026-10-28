-- ============================================================================
-- check_20261027R.sql —— 只看不改：排查「前台看不到文化背景 / 消费心理」
--
-- 用法：Supabase → SQL Editor 整段粘贴执行，把结果对照下面的判断表。
-- 这个文件不含任何 alter / update，跑一百次也不会改动数据。
-- ============================================================================

-- ---------------------------------------------------------------- 1. 各维度到底有多少行有值
-- 「文化背景」「消费心理」为 0 而别的有值 → 数据没进这两列（最常见）
-- 全部为 0 → 这个库根本没有打标数据（连的老库不对，或导入没成功）
select
  count(*)                                                            as "总行数",
  count(*) filter (where cardinality(style_tags)    > 0)              as "风格",
  count(*) filter (where cardinality(visual_tags)   > 0)              as "视觉",
  count(*) filter (where cardinality(element_tags)  > 0)              as "图案元素",
  count(*) filter (where cardinality(craft_tags)    > 0)              as "二次工艺",
  count(*) filter (where cardinality(shoot_tags)    > 0)              as "拍摄方式",
  count(*) filter (where cardinality(fit_tags)      > 0)              as "版型",
  count(*) filter (where cardinality(culture_tags)  > 0)              as "文化背景",
  count(*) filter (where cardinality(psych_tags)    > 0)              as "消费心理",
  count(*) filter (where cardinality(festival_tags) > 0)              as "节日"
from public.rank_image_tags;

-- ---------------------------------------------------------------- 2. 最近写入的时间与批次
-- 时间比你导入的时刻还早 → 说明这次导入压根没落到这张表
select
  max(updated_at)                    as "最后写入时间",
  count(distinct batch_id)           as "批次个数",
  count(*) filter (where batch_id is null) as "无批次行数_人工改的"
from public.rank_image_tags;

-- ---------------------------------------------------------------- 3. 抽几行看真实内容
-- 只看前 5 行，直接肉眼确认这两列是有值还是空数组
select
  right(image_url, 28)  as "图片地址尾部",
  style_tags            as "风格",
  culture_tags          as "文化背景",
  psych_tags            as "消费心理",
  festival_tags         as "节日",
  updated_at            as "写入时间"
from public.rank_image_tags
order by updated_at desc
limit 5;

-- ---------------------------------------------------------------- 4. 列是否存在（补丁 Q / R 是否真的跑过）
-- 期望 3 行全在；缺哪个就是对应补丁没跑
select column_name as "列名", data_type as "类型"
from information_schema.columns
where table_schema = 'public' and table_name = 'rank_image_tags'
  and column_name in ('culture_tags', 'psych_tags', 'festival_tags')
order by column_name;