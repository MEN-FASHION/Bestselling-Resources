-- ============================================================
-- patch_20261028H3 —— 自适应补列（修正版）
--
-- 上一版报错：syntax error at or near "full"
-- 原因：full 是 SQL 保留字（FULL JOIN 用），不能直接当变量名。
--       本版所有变量统一加 v_ 前缀，避开保留字。
--
-- 前半段在赋值前就报错了，所以**上一版没有执行任何改表动作**，
-- 不需要回滚，直接跑这一版即可。
--
-- 幂等：可重复执行。只做 add column if not exists，不动数据。
-- ============================================================

-- ---------- 1) 先看能找到几张同名表 ----------
select table_schema as "schema名", table_name as "表名"
from information_schema.tables
where table_type = 'BASE TABLE'
  and table_name ilike 'images'
order by table_schema, table_name;

-- ---------- 2) 自动补列 ----------
do $$
declare
  v_rec  record;
  v_cnt  int := 0;
  v_tbl  text;
begin
  for v_rec in
    select c.table_schema, c.table_name
    from information_schema.tables c
    where c.table_type = 'BASE TABLE'
      and c.table_name ilike 'images'
  loop
    v_tbl := format('%I.%I', v_rec.table_schema, v_rec.table_name);

    execute format(
      'alter table %s
         add column if not exists culture_tags  text[] not null default ''{}''::text[],
         add column if not exists psych_tags    text[] not null default ''{}''::text[],
         add column if not exists festival_tags text[] not null default ''{}''::text[]',
      v_tbl);

    execute format('create index if not exists %I on %s using gin (culture_tags)',
      'idx_' || v_rec.table_name || '_culture', v_tbl);
    execute format('create index if not exists %I on %s using gin (psych_tags)',
      'idx_' || v_rec.table_name || '_psych', v_tbl);
    execute format('create index if not exists %I on %s using gin (festival_tags)',
      'idx_' || v_rec.table_name || '_festival', v_tbl);

    v_cnt := v_cnt + 1;
    raise notice '已补列：%', v_tbl;
  end loop;

  if v_cnt = 0 then
    raise exception '库里没有任何名为 images 的表，请先跑 diagnose_images_table.sql 确认表名';
  end if;

  raise notice '完成，共处理 % 张表', v_cnt;
end $$;

-- ---------- 3) 自检 ----------
-- 3.1 三列都在：每张表应该有 3 行
select table_schema as "schema名",
       table_name   as "表名",
       count(*)     as "三列总数_每表应为3",
       string_agg(column_name, ', ' order by column_name) as "列名"
from information_schema.columns
where table_name ilike 'images'
  and column_name in ('culture_tags', 'psych_tags', 'festival_tags')
group by table_schema, table_name;