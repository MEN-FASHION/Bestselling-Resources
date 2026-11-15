-- ============================================================================
-- 20261110A · 解除数据库对「专区」的硬编码校验
-- ----------------------------------------------------------------------------
-- 现象：权限管理里保存勾选时报
--   new row for relation "zone_permissions" violates check constraint
--   "zone_permissions_zone_check"
--
-- 原因：zone_permissions 等表的 zone 列上有一条 CHECK 约束，把允许的专区
--       写成了固定清单（视觉/趋势/招品/BESTSELLER/趋势动向…）。
--       后来新增的「上新节奏」（key = rhythm）不在清单里，写库直接被数据库拒绝。
--
-- 做法：把「带 zone 列的表」上的 zone 相关 CHECK 约束删掉，枚举校验交给应用层。
--       （应用层本来就在校验专区 key，数据库再硬编码只会拦住新专区）
--
-- 安全：只删 CHECK 约束；不删列、不删数据、不加列；
--       主键 / 唯一键 / 外键 / 非空 / 行级安全策略全部不动。
-- 幂等：可重复执行。
-- ============================================================================

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select distinct c.conname, c.conrelid::regclass::text as tbl
    from pg_constraint c
    join pg_class t      on t.oid = c.conrelid
    join pg_namespace ns on ns.oid = t.relnamespace
    join pg_attribute a  on a.attrelid = c.conrelid and a.attname = 'zone' and a.attnum > 0
    where c.contype = 'c'
      and ns.nspname = 'public'
      and (c.conname ilike '%zone%' or pg_get_constraintdef(c.oid) ilike '%zone%')
  loop
    execute format('alter table %s drop constraint if exists %I', r.tbl, r.conname);
    raise notice '已删除约束：% （表 %）', r.conname, r.tbl;
    n := n + 1;
  end loop;
  raise notice '合计删除 % 个与 zone 相关的 CHECK 约束', n;
end $$;

-- ---------------------------------------------------------------------------
-- 自检：下面这条应返回 0 行，表示已经没有拦专区的 CHECK 约束了
-- ---------------------------------------------------------------------------
-- select c.conrelid::regclass as tbl, c.conname, pg_get_constraintdef(c.oid) as def
-- from pg_constraint c
-- join pg_class t      on t.oid = c.conrelid
-- join pg_namespace ns on ns.oid = t.relnamespace
-- join pg_attribute a  on a.attrelid = c.conrelid and a.attname = 'zone' and a.attnum > 0
-- where c.contype = 'c' and ns.nspname = 'public'
--   and (c.conname ilike '%zone%' or pg_get_constraintdef(c.oid) ilike '%zone%');
