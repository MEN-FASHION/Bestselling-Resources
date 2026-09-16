-- ============================================================
-- 方案A：分享类目缩略图预览 —— 数据库策略（匿名读已发布任务）
-- 说明：为支持「管理员分享类目链接，未登录可浏览该类目缩略图预览」，
--       需让匿名用户可读【已发布】的招品/回品/BESTSELLER任务。
--       仅 published = true 且未软删除的任务对匿名可见；草稿/后台敏感数据仍受保护。
-- 到 Supabase → SQL Editor 执行一次即可（幂等）。
-- ============================================================

-- 招品回品
drop policy if exists "anon read published recruit_tasks" on public.recruit_tasks;
create policy "anon read published recruit_tasks"
  on public.recruit_tasks for select
  to anon
  using (published = true and deleted_at is null);

-- BESTSELLER
drop policy if exists "anon read published bestseller_tasks" on public.bestseller_tasks;
create policy "anon read published bestseller_tasks"
  on public.bestseller_tasks for select
  to anon
  using (published = true and deleted_at is null);

-- 校验
select tablename, policyname, roles, cmd
from pg_policies
where tablename in ('recruit_tasks','bestseller_tasks')
  and policyname like 'anon read published%';
