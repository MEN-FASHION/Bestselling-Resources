-- ============================================================================
-- patch_20261027Q.sql —— 打标体系新增「文化背景 / 消费心理」两个语义层维度
--
-- 背景：
--   原来的六维（风格 / 视觉 / 图案元素 / 二次工艺 / 拍摄方式 / 版型）全部是
--   「画面里能看到什么」。它答得出"这是圆领还是连帽""背景是白底还是街头"，
--   但答不出"这身衣服来自哪种文化、这张图想打动谁"——而后者才是做趋势判断
--   时真正需要的东西。本次新增两列承载这两个语义维度。
--
--   文化背景：衣服/画面承载的文化语境与圈层来源
--             （美式文化、滑板文化、复古90s、国潮复兴、老钱静奢…）
--   消费心理：这张图试图触发的购买动机
--             （身份认同、个性表达、理性性价比、悦己舒适…）
--             注意：这是推断项，依据是画面气质/场景/模特状态/图案与文案，
--             判断不了应当留空，不要求填满。
--
-- 幂等：可重复执行，已存在则跳过。
-- 依赖：patch_20261027K（rank_image_tags 表本体）。
-- ============================================================================

-- ---------------------------------------------------------------- 0. 前置自检
-- 连错库时后面全是无用功，先确认这张表在。
do $$
begin
  if to_regclass('public.rank_image_tags') is null then
    raise exception 'public.rank_image_tags 不存在：请先执行 patch_20261027K.sql，或确认当前连接的是站点真正在用的数据库';
  end if;
end $$;

-- ---------------------------------------------------------------- 1. 补两列
alter table public.rank_image_tags
  add column if not exists culture_tags text[] not null default '{}'::text[],
  add column if not exists psych_tags   text[] not null default '{}'::text[];

comment on column public.rank_image_tags.culture_tags is
  '文化背景：文化语境/圈层来源/时代印记。枚举见后台「导出打标表 → 枚举参考」';
comment on column public.rank_image_tags.psych_tags is
  '消费心理：购买动机推断（画面气质/场景/模特/图案文案），允许留空';

-- ---------------------------------------------------------------- 2. GIN 索引
-- 与其它标签列口径一致：数组包含查询（@> / &&）走 GIN，否则几千行也会全表扫。
create index if not exists idx_rank_image_tags_culture on public.rank_image_tags using gin (culture_tags);
create index if not exists idx_rank_image_tags_psych   on public.rank_image_tags using gin (psych_tags);

-- ---------------------------------------------------------------- 3. 刷新缓存
-- 必须单引号：双引号会被当成标识符，报 column "reload schema" does not exist。
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------- 4. 自检
-- 期望：新增列 2 / culture GIN 1 / psych GIN 1
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'rank_image_tags'
      and column_name in ('culture_tags', 'psych_tags'))                        as "新增列_应为2",
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename = 'rank_image_tags'
      and indexname = 'idx_rank_image_tags_culture')                            as "culture索引_应为1",
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename = 'rank_image_tags'
      and indexname = 'idx_rank_image_tags_psych')                              as "psych索引_应为1";

-- 看看这两个维度目前各有值多少行（新建列必然全 0，回填后才会有数）
select
  count(*)                                                          as "总行数",
  count(*) filter (where cardinality(culture_tags) > 0)             as "有文化背景",
  count(*) filter (where cardinality(psych_tags) > 0)               as "有消费心理"
from public.rank_image_tags;