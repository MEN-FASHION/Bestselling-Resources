-- ============================================================
-- 补丁 20261019D：数据看板「全站统计」函数
-- 用途：后台数据看板要让所有管理员看到全员的上传与打标数据，
--       而 images 表的 select 策略只允许超管读全部、普通管理员只读自己上传的，
--       该策略必须保留（保证管理员只能编辑/删除自己上传的图）。
--       故新增一个 security definer 只读函数，函数内校验角色：仅 admin / super_admin。
-- 特性：可重复执行；只新增函数与授权；不改表结构、不动任何数据。
-- ============================================================

drop function if exists public.dashboard_images();
create or replace function public.dashboard_images()
returns setof public.images
language plpgsql security definer stable
as $$
begin
  if not exists (
    select 1 from public.profiles p
     where p.user_id = auth.uid()
       and p.role in ('admin', 'super_admin')
  ) then
    raise exception '仅管理员可查看数据看板';
  end if;
  return query select * from public.images order by created_at desc;
end;
$$;

grant execute on function public.dashboard_images() to authenticated;

notify pgrst, 'reload schema';

-- ---------- 自检：函数是否就位、是否已授权 ----------
select
  exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'dashboard_images') as "函数已创建_应为true",
  has_function_privilege('authenticated', 'public.dashboard_images()', 'execute') as "登录用户可调用_应为true",
  (select count(*) from public.images) as "图片总数";
