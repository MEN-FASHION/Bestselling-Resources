-- =====================================================================
-- 登录区分"账号错误 / 密码错误"
-- 在 Supabase 中执行本脚本，创建一个 RPC 函数 is_email_registered(email)
-- 用于判断某个邮箱是否已注册，从而在登录失败时给出更明确的提示。
-- 说明：
--   * 该函数为 security definer，以 owner 权限查询 auth.users（邮箱注册主表），
--     不依赖 profiles 表的同步逻辑，最可靠。
--   * 允许 anon / authenticated 调用（仅返回布尔值，不泄露任何其他信息）。
-- =====================================================================

create or replace function public.is_email_registered(p_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from auth.users where lower(email) = lower(trim(p_email))
  );
$$;

revoke all on function public.is_email_registered(text) from public;
grant execute on function public.is_email_registered(text) to anon, authenticated;