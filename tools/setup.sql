-- ============================================================
-- 图片图鉴站 · Supabase 初始化脚本
-- 使用方法：登录 supabase.com → 你的项目 → SQL Editor → 粘贴全部执行
-- ============================================================

-- ---------- 1. 建 profiles 表（记录每个用户的角色） ----------
-- 默认所有注册用户为 visitor（访客）；管理员需手动升级
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'visitor' check (role in ('visitor', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 任何人只能读自己的角色信息
drop policy if exists "select own profile" on public.profiles;
create policy "select own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

-- 允许用户首次登录时自动插入自己的 profile
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, email, role)
  values (new.id, new.email, 'visitor')
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- 3. 建图片清单表 ----------
create table if not exists public.images (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  category text not null,
  name text not null,
  path text not null,          -- R2 里的存储路径，如 images/分类/xxx.jpg
  uploaded_by uuid references auth.users (id) on delete set null
);

alter table public.images enable row level security;

-- 已登录用户可读取（前台访客浏览）
drop policy if exists "authenticated read images" on public.images;
create policy "authenticated read images"
  on public.images for select
  to authenticated
  using (true);

-- 仅管理员可新增图片
drop policy if exists "admin insert images" on public.images;
create policy "admin insert images"
  on public.images for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  );

-- 仅管理员可删除图片
drop policy if exists "admin delete images" on public.images;
create policy "admin delete images"
  on public.images for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  );

-- ---------- 4.（可选）把某个用户设为管理员 ----------
-- 先注册一个邮箱，然后把这行里的邮箱换成你自己的，重新执行即可
-- update public.profiles set role = 'admin'
--   where email = '你的管理员邮箱@example.com';