-- ============================================================================
-- 20261109A · 「上新节奏」其他渠道传图
-- ----------------------------------------------------------------------------
-- 渠道图（Pinterest / SHEIN / 淘宝…）与榜单条目放在同一张 rank_items 里，
-- 靠 channel 列区分：
--   channel = ''（空串）→ 榜单表格导入的图，原有口径完全不变
--   channel = 'Pinterest' 等 → 后台「其他渠道传图」传进来的图（site 一律为空）
-- 幂等：可重复执行。
-- ============================================================================

alter table rank_items add column if not exists channel text not null default '';

-- 渠道图按「期次 + 类目 + 渠道」取，前台渠道对比也是这个口径
create index if not exists idx_rank_items_channel
  on rank_items (period_type, period_label, category, channel);

-- 校验（可选）：应返回 0，表示没有历史数据被误标成渠道图
-- select count(*) from rank_items where channel is null;
