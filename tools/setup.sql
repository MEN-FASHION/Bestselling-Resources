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
  tags text[] not null default '{}',   -- 渠道/来源标签，如 {TEMU, TIKTOK}
  uploaded_by uuid references auth.users (id) on delete set null
);

-- 已存在的库补充标签列（幂等）
alter table public.images add column if not exists tags text[] not null default '{}';
alter table public.images add column if not exists style_tags text[] not null default '{}';
alter table public.images add column if not exists element_tags text[] not null default '{}';

alter table public.images enable row level security;

-- 已登录用户可读取（前台访客浏览）
drop policy if exists "authenticated read images" on public.images;
create policy "authenticated read images"
  on public.images for select
  to authenticated
  using (true);

-- （公开浏览模式）匿名用户也可读取清单（图片本体仍由 Worker 鉴权，公开模式下才放行）
drop policy if exists "anon read images" on public.images;
create policy "anon read images"
  on public.images for select
  to anon
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

-- 仅管理员可更新图片（用于批量打渠道标签）
drop policy if exists "admin update images" on public.images;
create policy "admin update images"
  on public.images for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  )
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

-- ---------- 3.5 前台类目表（categories：管理员显式添加，含展示顺序） ----------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 1,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;

-- 匿名与登录用户均可读取（前台左侧菜单需要）
drop policy if exists "anon read categories" on public.categories;
create policy "anon read categories"
  on public.categories for select
  to anon
  using (true);

drop policy if exists "authenticated read categories" on public.categories;
create policy "authenticated read categories"
  on public.categories for select
  to authenticated
  using (true);

-- 仅管理员可增删改
drop policy if exists "admin write categories" on public.categories;
create policy "admin write categories"
  on public.categories for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "admin update categories" on public.categories;
create policy "admin update categories"
  on public.categories for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "admin delete categories" on public.categories;
create policy "admin delete categories"
  on public.categories for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  );

-- ---------- 3.6 站点设置表（前台访问模式开关） ----------
create table if not exists public.site_settings (
  id int primary key default 1,
  public_access boolean not null default false,
  updated_at timestamptz not null default now()
);

-- 默认插入一行 id=1
insert into public.site_settings (id, public_access)
values (1, false)
on conflict (id) do nothing;

alter table public.site_settings enable row level security;

-- 匿名与登录用户均可读取开关（前台首次加载需判断是否公开浏览）
drop policy if exists "anon read settings" on public.site_settings;
create policy "anon read settings"
  on public.site_settings for select
  to anon
  using (true);

drop policy if exists "authenticated read settings" on public.site_settings;
create policy "authenticated read settings"
  on public.site_settings for select
  to authenticated
  using (true);

-- 仅管理员可修改开关
drop policy if exists "admin update settings" on public.site_settings;
create policy "admin update settings"
  on public.site_settings for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  );

-- ---------- 3.7 标签定义表（风格/元素标签，后台可自定义增删） ----------
create table if not exists public.tag_defs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('style','element')),
  name text not null,
  sort_order int not null default 1,
  created_at timestamptz not null default now(),
  unique (type, name)
);

alter table public.tag_defs enable row level security;

-- 匿名与登录用户均可读取（前台筛选/展示需要）
drop policy if exists "anon read tag_defs" on public.tag_defs;
create policy "anon read tag_defs"
  on public.tag_defs for select
  to anon
  using (true);

drop policy if exists "authenticated read tag_defs" on public.tag_defs;
create policy "authenticated read tag_defs"
  on public.tag_defs for select
  to authenticated
  using (true);

-- 仅管理员可增删改标签定义
drop policy if exists "admin write tag_defs" on public.tag_defs;
create policy "admin write tag_defs"
  on public.tag_defs for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "admin update tag_defs" on public.tag_defs;
create policy "admin update tag_defs"
  on public.tag_defs for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "admin delete tag_defs" on public.tag_defs;
create policy "admin delete tag_defs"
  on public.tag_defs for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  );

-- 预设风格/元素标签（首次建库时写入，可重复执行；已有则不覆盖）
insert into public.tag_defs (type, name) values
  ('style', '复古美式'), ('style', '街头潮流'), ('style', '极简'), ('style', '商务通勤'),
  ('style', '户外机能'), ('style', '工装'), ('style', '休闲'), ('style', '学院风')
on conflict (type, name) do nothing;

insert into public.tag_defs (type, name) values
  ('element', '条纹'), ('element', '格纹'), ('element', '印花'), ('element', '字母'),
  ('element', '拼接'), ('element', '刺绣'), ('element', '牛仔'), ('element', '迷彩'),
  ('element', '扎染'), ('element', '做旧')
on conflict (type, name) do nothing;

-- ---------- 4.（可选）把某个用户设为管理员 ----------
-- 先注册一个邮箱，然后把这行里的邮箱换成你自己的，重新执行即可
-- update public.profiles set role = 'admin'
--   where email = '你的管理员邮箱@example.com';
-- ============================================================
-- 趋势专区：趋势文件清单表
-- 趋势文件本体存 R2（路径 trends/...），此处仅存清单
-- tag 限定三种：类目 / 月度 / 周度（单选）
-- ============================================================
create table if not exists public.trends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,              -- 文件标题/说明
  tag text not null check (tag in ('类目','月度','周度')),  -- 三种标签，单选
  path text not null,               -- R2 路径，如 trends/xxx.pdf
  category text default '',         -- 选填：当 tag=类目 时的具体类目名
  file_type text default 'pdf',
  uploaded_by uuid references auth.users (id) on delete set null
);

alter table public.trends enable row level security;

-- 登录用户可读取清单（趋势专区始终需登录可见）
drop policy if exists "authenticated read trends" on public.trends;
create policy "authenticated read trends"
  on public.trends for select
  to authenticated
  using (true);

-- 仅管理员可增/删/改趋势文件清单
drop policy if exists "admin insert trends" on public.trends;
create policy "admin insert trends"
  on public.trends for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "admin update trends" on public.trends;
create policy "admin update trends"
  on public.trends for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "admin delete trends" on public.trends;
create policy "admin delete trends"
  on public.trends for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role = 'admin')
  );
