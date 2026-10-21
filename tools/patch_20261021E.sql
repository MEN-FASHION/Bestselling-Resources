-- ============================================================
-- 补丁 20261021E · 让访客也能读到节庆库（前台营销日历是公开页）
-- 只新增一条「只读」策略，不改表结构、不改数据、可重复执行
-- ============================================================

alter table public.marketing_festivals enable row level security;

drop policy if exists "public read marketing_festivals" on public.marketing_festivals;
create policy "public read marketing_festivals"
  on public.marketing_festivals for select
  to anon, authenticated
  using (true);

-- 说明：匿名只拿到 SELECT，写操作仍只属于超管（沿用原有 admin all 策略）

-- ------------------------------------------------------------
-- 跑完自检：两列都应为 true
-- ------------------------------------------------------------
select
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'marketing_festivals'
       and cmd = 'SELECT' and 'anon' = any(roles)) > 0   as 匿名可读,
  (select count(*) from public.marketing_festivals)      as 当前节庆数;
