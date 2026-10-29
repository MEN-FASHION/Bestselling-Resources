-- ============================================================
-- patch_20261028H2 —— 自适应补列：自动找到图片表，补三个维度
--
-- 为什么改成自适应：
--   前一版写死了 public.images，执行时报 42P01「relation 不存在」。
--   说明这张表要么不在 public、要么所在库不同。
--   这里不再假设 schema，先用表名匹配找到它，再补列。
--
-- 幂等：可重复执行。
-- 安全：只做 add column if not exists，不删列、不改类型、不动数据。
-- ============================================================

-- ---------- 1) 先看看能找到几张同名表 ----------
select table_schema as schema名, table_name as 表名
from information_schema.tables
where table_type = 'BASE TABLE'
  and table_name ilike 'images'
order by table_schema, table_name;

-- ---------- 2) 自动补列 ----------
-- 若第 1 步返回 0 行，本段会直接报错并停止（不会误改别的表）
do $$
declare
  r    record;
  cnt  int := 0;
  full text;
begin
  for r in
    select c.table_schema, c.table_name
    from information_schema.tables c
    where c.table_type = 'BASE TABLE'
      and c.table_name ilike 'images'
  loop
    full := format('%I.%I', r.table_schema, r.table_name);

    execute format('alter table %s
      add column if not exists culture_tags  text[] not null default ''{}''::text[],
      add column if not exists psych_tags    text[] not null default ''{}''::text[],
      add column if not exists festival_tags text[] not null default ''{}''::text[]', full);

    execute format('create index if not exists %I on %s using gin (culture_tags)',
                   'idx_' || replace(r.table_name, '.', '_') || '_culture', full);
    execute format('create index if not exists %I on %s using gin (psych_tags)',
                   'idx_' || replace(r.table_name, '.', '_') || '_psych', full);
    execute format('create index if not exists %I on %s using gin (festival_tags)',
                   'idx_' || replace(r.table_name, '.', '_') || '_festival', full);

    cnt := cnt + 1;
    raise notice '已补列：%', full;
  end loop;

  if cnt = 0 then
    raise exception '库里没有任何名为 images 的表。请先执行 diagnose_images_table.sql，确认图片表的真实名称';
  end if;

  raise notice '完成，共处理 % 张表', cnt;
end $$;

-- ---------- 3) 自检 ----------
-- 3.1 三列都在（每张匹配到的表都应有 3 行）
select table_schema      as schema名,
       table_name        as 表名,
       count(*)          as 三列总数_每表应为3,
       string_agg(column_name, ', ' order by column_name) as 列名
from information_schema.columns
where table_name ilike 'images'
  and column_name in ('culture_tags', 'psych_tags', 'festival_tags')
group by table_schema, table_name;

-- 3.2 没有 NULL（把 <schema名>.<表名> 换成上面查到的）
/*
select count(*) filter (where culture_tags  is null) as "文化背景_空值行数",
       count(*) filter (where psych_tags    is null) as "消费心理_空值行数",
       count(*) filter (where festival_tags is null) as "节日_空值行数"
from <schema名>.<表名>;
*/