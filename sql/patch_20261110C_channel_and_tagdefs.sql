-- ============================================================================
-- 20261110C · 补齐“渠道/补渠道”和枚举表所依赖的结构
-- ----------------------------------------------------------------------------
-- 三件事，全部幂等，可重复执行：
--   1) rank_items.channel —— 「其他渠道传图 / 批量补渠道 / 渠道对比」都依赖它。
--      没有这条列时，所有带 channel 的请求都会被数据库以 400 拒绝，
--      表现为：补渠道报错、控制台刷一大批 400、渠道对比里没有渠道列。
--   2) tag_defs.sort_order / group —— 枚举表新增取值时按这两列排序/分组。
--      老库里可能没有这两列，插入/读取会直接 400（渠道字典默认值灌不进去）。
--   3) tag_defs.type 上的 CHECK 约束 —— 把允许的枚举类型写死在库里，
--      新增类型（如 rank_channel）会被拒。删掉，交给应用层校验。
-- ============================================================================

-- 1) 渠道列
alter table rank_items add column if not exists channel text not null default '';

create index if not exists idx_rank_items_channel
  on rank_items (period_type, period_label, category, channel);

-- 2) 枚举表所需的列
alter table tag_defs add column if not exists sort_order integer not null default 0;
alter table tag_defs add column if not exists "group" text not null default '';
alter table tag_defs add column if not exists created_at timestamptz not null default now();

-- 3) 解除 tag_defs.type 的硬编码校验（只删 CHECK，不动数据）
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t      on t.oid = c.conrelid
    join pg_namespace ns on ns.oid = t.relnamespace
    where c.contype = 'c'
      and ns.nspname = 'public'
      and t.relname = 'tag_defs'
      and (c.conname ilike '%type%' or pg_get_constraintdef(c.oid) ilike '%type%')
  loop
    execute format('alter table public.tag_defs drop constraint if exists %I', r.conname);
    raise notice '已删除 tag_defs 约束：%', r.conname;
    n := n + 1;
  end loop;
  raise notice '合计删除 % 个约束', n;
end $$;

-- ---------------------------------------------------------------------------
-- 自检 1：应返回 1 行，表示 channel 列已存在
-- ---------------------------------------------------------------------------
-- select column_name from information_schema.columns
-- where table_name = 'rank_items' and column_name = 'channel';

-- 自检 2：应返回 3 行（sort_order / group / created_at）
-- select column_name from information_schema.columns
-- where table_name = 'tag_defs' and column_name in ('sort_order','group','created_at');

-- 自检 3：应返回 0 行
-- select count(*) from rank_items where channel is null;
