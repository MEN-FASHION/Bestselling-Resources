-- 20261113B · 三个专区数据域隔离（幂等，可重复执行）
-- 作用：给榜单条目与上传批次各加一个「数据域」标记列。
--       趋势上升榜写 rank，上新节奏写 rhythm，标题组词台写 title。
-- 不加这一列，隔离条件无处可比，三个专区会继续相互可见。

alter table rank_items   add column if not exists source text;
alter table rank_batches add column if not exists source text;

comment on column rank_items.source   is '数据域：rank / rhythm / title；为空按 rank 处理（历史数据）';
comment on column rank_batches.source is '数据域：rank / rhythm / title；为空按 rank 处理（历史数据）';

-- 按域过滤 + 按 id 翻页是主要查询形态
create index if not exists idx_rank_items_source_id   on rank_items (source, id);
create index if not exists idx_rank_batches_source_id on rank_batches (source, id);

-- 可选：把历史数据显式标成 rank（不标也能用，代码里把空值当 rank）
-- update rank_items   set source = 'rank' where source is null;
-- update rank_batches set source = 'rank' where source is null;

-- 自检：确认列已存在
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('rank_items', 'rank_batches')
  and column_name = 'source';

-- 20261113P：加完列必须让接口层刷新表结构缓存，否则会继续报
--   Could not find the 'source' column of 'rank_batches' in the schema cache
-- 这条错误的意思是「数据库里有没有这列我不确定，缓存里没有」，
-- 只加列不刷新缓存，前端照样写不进去（表现就是导入 0 条、前台一点没变）。
notify pgrst, 'reload schema';
