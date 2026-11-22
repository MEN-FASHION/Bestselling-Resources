-- 20261122Z · 榜单「必需维度列」补齐（幂等，可重复执行）
-- 背景：趋势上升榜 / 上新节奏的站点、期次、类目、首图是必需维度。
--       任一列缺失时，前端不再"悄悄剔掉该列硬写进去"（那会造成库里有图、前台却没有
--       国家站点可选、整页空白），而是明确报错并提示执行本脚本。
-- 本脚本只做「缺则补」，不删数据、不改已有值。

alter table public.rank_items   add column if not exists site          text;
alter table public.rank_items   add column if not exists period_type   text;
alter table public.rank_items   add column if not exists period_label  text;
alter table public.rank_items   add column if not exists category      text;
alter table public.rank_items   add column if not exists image_url     text;

alter table public.rank_batches add column if not exists site          text;
alter table public.rank_batches add column if not exists period_type   text;
alter table public.rank_batches add column if not exists period_label  text;
alter table public.rank_batches add column if not exists category      text;

comment on column public.rank_items.site         is '国家站点（必需维度：前台按它做国家筛选）';
comment on column public.rank_items.period_label is '期次（第N周 / YYYY-MM）';
comment on column public.rank_items.period_type  is 'week / month';
comment on column public.rank_items.category     is '类目（后台所选，原样存储）';
comment on column public.rank_items.image_url    is '首图地址';

-- 读完加列后必须让接口层刷新表结构缓存，否则前端仍会报
--   Could not find the 'site' column of 'rank_items' in the schema cache
notify pgrst, 'reload schema';

-- 自检：确认必需列都在
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('rank_items', 'rank_batches')
  and column_name in ('site','period_type','period_label','category','image_url')
order by table_name, column_name;

-- 参考：查一下有多少条「站点为空」的历史数据（需要补站点时用后台「站点修复…」按钮）
-- select count(*) from public.rank_items where site is null or site = '';
