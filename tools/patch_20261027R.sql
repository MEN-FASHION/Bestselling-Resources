-- ============================================================================
-- patch_20261027R.sql —— 打标体系新增「节日」维度（可选项）
--
-- 为什么单独成一个维度：
--   同一件卫衣，绑不绑定节日节点，是两门生意。万圣节骷髅款、圣诞丑毛衣、
--   情人节心形印花、春节红、亡灵节骷髅妆——这些款的爆发曲线完全跟着节日走，
--   而「风格/视觉/图案/工艺/版型/文化背景/消费心理」都答不出"它押的是哪个节日"。
--
--   ⚠️ 与其他 8 个维度不同，节日是**可选项**：
--      绝大多数常规款跟节日无关，留空是正常状态，不允许填「无节日」占位值。
--      因此前端「打标状态」的判定里故意不把这一列计入分母——
--      否则所有基础款都会永远卡在「部分 n/9」，统计和筛选就废了。
--
-- 取值来源：与站点「营销日历」的节庆库同名，导入时库里存在的节日名一律放行。
--
-- 幂等：可重复执行，已存在则跳过。
-- 依赖：patch_20261027K（rank_image_tags 表本体）。
-- ============================================================================

-- ---------------------------------------------------------------- 0. 前置自检
do $$
begin
  if to_regclass('public.rank_image_tags') is null then
    raise exception 'public.rank_image_tags 不存在：请先执行 patch_20261027K.sql，或确认当前连接的是站点真正在用的数据库';
  end if;
end $$;

-- ---------------------------------------------------------------- 1. 补列
alter table public.rank_image_tags
  add column if not exists festival_tags text[] not null default '{}'::text[];

comment on column public.rank_image_tags.festival_tags is
  '节日：绑定的节日节点（万圣节/圣诞节/春节…）。可选项，不含节日元素则留空，禁止填「无节日」占位';

-- ---------------------------------------------------------------- 2. GIN 索引
-- 用途：查「所有押万圣节的款」这类数组包含查询，不加会全表扫。
create index if not exists idx_rank_image_tags_festival
  on public.rank_image_tags using gin (festival_tags);

-- ---------------------------------------------------------------- 3. 刷新缓存
-- 必须单引号：双引号会被当成标识符，报 column "reload schema" does not exist。
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------- 4. 自检
-- 期望：新增列 1 / 索引 1
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'rank_image_tags'
      and column_name = 'festival_tags')                                       as "新增列_应为1",
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename = 'rank_image_tags'
      and indexname = 'idx_rank_image_tags_festival')                          as "节日索引_应为1";

-- 节日分布：预期「有节日」远小于总行数，绝大多数应当留空（这是对的，不是漏标）
select
  count(*)                                                    as "总行数",
  count(*) filter (where cardinality(festival_tags) > 0)      as "有节日",
  count(*) filter (where cardinality(festival_tags) = 0)      as "无节日_正常留空"
from public.rank_image_tags;

-- 押注最多的节日 TOP10（回填后才有数据）
select unnest(festival_tags) as "节日", count(*) as "款数"
from public.rank_image_tags
group by 1
order by 2 desc
limit 10;