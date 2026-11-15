-- 20261110E · 让数据库接口层立刻认到新列（必须在加列之后执行）
--
-- 背景：ALTER TABLE 加列后，接口层（PostgREST）仍可能用缓存的表结构，
-- 于是查询里一带 channel 就被判「列不存在」→ 400。
-- 跑一遍下面的语句即可让它重新读取结构，再加列也照此处理。
--
-- 幂等：重复执行没有副作用。

select pg_notify('pgrst', 'reload schema');

-- 自检：应返回 1 行 channel（没有则说明列真的没加上，或加到了别的表/别的 schema）
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'rank_items'
  and column_name = 'channel';

-- 自检：应返回 0 行（有行说明还剩约束在拦，看 20261110A 那个补丁）
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.rank_items'::regclass
  and contype = 'c';
