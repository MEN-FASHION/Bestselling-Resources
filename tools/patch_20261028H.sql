-- ============================================================
-- patch_20261028H —— 图片表补齐「文化背景 / 消费心理 / 节日」三列
--
-- 背景：
--   新增的三个语义维度（culture_tags / psych_tags / festival_tags）
--   之前只加到了榜单表 rank_image_tags 上（见 patch_20261027Q / R），
--   但视觉专区的打标数据实际写在 **public.images** 表里。
--   images 表缺这三列 → 导入时 PATCH 带上了不存在的字段 → 数据库直接 400，
--   表现就是「导入 0 张，失败 58 张」，控制台一片 400。
--
-- 作用：
--   给 public.images 补三列，均为 text[]，默认空数组、非空约束。
--   与既有 style_tags / scene_tags / visual_tags 等的类型保持一致。
--
-- 安全性：
--   - 只做 ADD COLUMN IF NOT EXISTS，可重复执行，不报错、不覆盖数据；
--   - 默认值 '{}'，存量行不会变成 NULL，读出来是空数组；
--   - 不删列、不改既有列、不动 RLS；
--   - 节日为空数组即「不含节日元素」，不需要额外占位值。
-- ============================================================

-- ---------- 0) 改之前先看一眼：这三列现在有没有 ----------
select column_name                as 列名,
       data_type                  as 类型,
       is_nullable                as 可空
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'images'
  and column_name in ('culture_tags', 'psych_tags', 'festival_tags')
order by column_name;
-- 预期：0 行（一列都没有）→ 继续往下执行

-- ---------- 1) 补列 ----------
alter table public.images
  add column if not exists culture_tags  text[] not null default '{}'::text[],
  add column if not exists psych_tags    text[] not null default '{}'::text[],
  add column if not exists festival_tags text[] not null default '{}'::text[];

comment on column public.images.culture_tags  is '文化背景（如 美式文化、嘻哈Hip-Hop、日系文化；可多值）';
comment on column public.images.psych_tags    is '消费心理（如 个性表达、圈层归属、休闲放松；可多值）';
comment on column public.images.festival_tags is '节日（如 圣诞、万圣节；可选维度，不含节日元素留空）';

-- ---------- 2) 索引（按维度筛选时用） ----------
create index if not exists idx_images_culture  on public.images using gin (culture_tags);
create index if not exists idx_images_psych    on public.images using gin (psych_tags);
create index if not exists idx_images_festival on public.images using gin (festival_tags);

-- ---------- 3) 自检 ----------
-- 3.1 三列都建好了（期望 新增列_应为3 = 3）
select count(*) as "新增列_应为3"
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'images'
  and column_name in ('culture_tags', 'psych_tags', 'festival_tags');

-- 3.2 没有 NULL（期望 空值行数 全为 0）
select count(*) filter (where culture_tags  is null) as "文化背景_空值行数",
       count(*) filter (where psych_tags    is null) as "消费心理_空值行数",
       count(*) filter (where festival_tags is null) as "节日_空值行数"
from public.images;

-- 3.3 当前填写情况（T恤类目）
select category                                                   as 类目,
       count(*)                                                   as 图片数,
       count(*) filter (where cardinality(culture_tags)  > 0)     as 有文化背景,
       count(*) filter (where cardinality(psych_tags)    > 0)     as 有消费心理,
       count(*) filter (where cardinality(festival_tags) > 0)     as 有节日
from public.images
group by category
order by category;