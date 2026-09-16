-- 招品回品 / BESTSELLER 后台审核标记字段（IP / 品牌 / 类目错放 / 无需回品）
-- 仅后台可见，前台不展示。在 Supabase SQL Editor 执行一次即可（幂等）。
alter table public.recruit_tasks add column if not exists flag_ip boolean not null default false;
alter table public.recruit_tasks add column if not exists flag_brand boolean not null default false;
alter table public.recruit_tasks add column if not exists flag_cat_mismatch boolean not null default false;
alter table public.recruit_tasks add column if not exists flag_no_refill boolean not null default false;
alter table public.bestseller_tasks add column if not exists flag_ip boolean not null default false;
alter table public.bestseller_tasks add column if not exists flag_brand boolean not null default false;
alter table public.bestseller_tasks add column if not exists flag_cat_mismatch boolean not null default false;
alter table public.bestseller_tasks add column if not exists flag_no_refill boolean not null default false;