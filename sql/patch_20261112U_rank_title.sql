-- ============================================================================
-- 20261112U · 榜单条目补「标题」列
-- ----------------------------------------------------------------------------
-- 标题组词台只读 rank_items.title。此前这张表没有 title 列，导入时标题被
-- 静默丢弃（接口返回 400「column title does not exist」），于是组词台一直是空的。
-- 幂等：可重复执行。
-- 等效的无代码操作：数据库表编辑器 → rank_items → 新增列 title，类型 text，允许为空。
-- ============================================================================

alter table rank_items add column if not exists title text not null default '';

-- 校验（可选）：应返回 0
-- select count(*) from rank_items where title is null;
