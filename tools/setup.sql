-- ============================================================
-- TREND BANK · Supabase 初始化脚本
-- 使用方法：登录 supabase.com → 你的项目 → SQL Editor → 粘贴全部执行
-- ============================================================

-- ---------- 1. 建 profiles 表（记录每个用户的角色） ----------
-- 默认所有注册用户为 visitor（访客）；管理员需手动升级
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'visitor' check (role in ('visitor', 'admin', 'super_admin')),
  -- 用户级前台可见专区白名单（manage_zones 数组；空/缺省 = 未配置，前台回退到全局 frontend_zone_visibility）
  manage_zones jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 任何人只能读自己的角色信息
drop policy if exists "select own profile" on public.profiles;
create policy "select own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

-- 超管：可读全部用户清单（权限管理页用）
drop policy if exists "super select all profiles" on public.profiles;
create policy "super select all profiles"
  on public.profiles for select
  using (public.is_super_admin());

-- 超管：可更新任意用户的角色 / 用户级可见专区白名单（manage_zones）
drop policy if exists "super update all profiles" on public.profiles;
create policy "super update all profiles"
  on public.profiles for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

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
alter table public.images add column if not exists scene_tags text[] not null default '{}';
alter table public.images add column if not exists shoot_tags text[] not null default '{}';
alter table public.images add column if not exists skin_tags text[] not null default '{}';
alter table public.images add column if not exists url text;   -- 图片外链（前台灯箱「打开链接」跳转，可由传图时Excel批量匹配）

alter table public.images enable row level security;

-- 已登录用户可读取（前台访客浏览；后台管理员仅能看到自己上传的图，超管看全部）
-- 注：公开浏览走下面 anon 策略（using true），不受此隔离影响
drop policy if exists "authenticated read images" on public.images;
create policy "authenticated read images"
  on public.images for select
  to authenticated
  using (
    public.is_super_admin() or uploaded_by = auth.uid()
  );

-- 已收紧：移除匿名读取图片清单的策略（防爬加固）
-- 访客与登录用户均需通过 authenticated 策略读取图片；不存在匿名可读
drop policy if exists "anon read images" on public.images;

-- 仅管理员可新增图片
drop policy if exists "admin insert images" on public.images;
create policy "admin insert images"
  on public.images for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

-- 仅管理员可更新图片（用于批量打渠道标签）
-- 隔离：普通管理员只能更新「自己上传」的图（uploaded_by = auth.uid()）；超管可更新全部
drop policy if exists "admin update images" on public.images;
create policy "admin update images"
  on public.images for update
  to authenticated
  using (
    public.is_super_admin() or (exists (select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')) and uploaded_by = auth.uid())
  )
  with check (
    public.is_super_admin() or (exists (select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')) and uploaded_by = auth.uid())
  );

-- 仅管理员可删除图片
-- 隔离：普通管理员只能删除「自己上传」的图；超管可删除全部
drop policy if exists "admin delete images" on public.images;
create policy "admin delete images"
  on public.images for delete
  to authenticated
  using (
    public.is_super_admin() or (exists (select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')) and uploaded_by = auth.uid())
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
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin update categories" on public.categories;
create policy "admin update categories"
  on public.categories for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin delete categories" on public.categories;
create policy "admin delete categories"
  on public.categories for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
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

-- 各标签维度是否在前台展示（channel/style/element/scene/shoot/skin）
alter table public.site_settings
  add column if not exists frontend_dims jsonb not null default '{"channel":true,"style":true,"element":true,"scene":true,"shoot":true,"skin":true}'::jsonb;

-- 各专区 · 各类目 是否在前台可见（frontend_cat_visibility）
-- 结构示例：{"visual":{"类目A":true,"类目B":false},"trend":{...},"recruit":{...},"bestseller":{...}}
-- 缺省未配置 = 该类目前台可见；false = 前台隐藏该类目下内容
alter table public.site_settings
  add column if not exists frontend_cat_visibility jsonb not null default '{}'::jsonb;
alter table public.site_settings
  add column if not exists frontend_cat_visibility jsonb not null default '{}'::jsonb;

-- 各专区 本身 是否在前台可见（frontend_zone_visibility）
-- 结构示例：{"visual":true,"trend":true,"recruit":true,"bestseller":true}
-- 缺省未配置 = 该专区前台可见；false = 前台隐藏整个专区入口
alter table public.site_settings
  add column if not exists frontend_zone_visibility jsonb not null default '{"visual":true,"trend":true,"recruit":true,"bestseller":true}'::jsonb;

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
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

-- ---------- 3.7 标签定义表（风格/元素标签，后台可自定义增删） ----------
create table if not exists public.tag_defs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('style','element','scene','shoot','skin')),
  name text not null,
  "group" text,                            -- 场景二级分组：indoor(室内)/outdoor(室外)，其余维度为 null
  sort_order int not null default 1,
  created_at timestamptz not null default now(),
  unique (type, name)
);
-- 兼容旧库：已存在的 tag_defs 表补 group 列 + 索引（幂等）
alter table public.tag_defs add column if not exists "group" text;
create index if not exists tag_defs_group_idx on public.tag_defs (type, "group");
-- 存量场景标签按名称前缀自动归类到二级分组（不依赖新增时的选择，保证统计连续）
update public.tag_defs set "group" = 'indoor'  where type = 'scene' and "group" is null and name like '室内%';
update public.tag_defs set "group" = 'outdoor' where type = 'scene' and "group" is null and name like '室外%';

-- 兼容旧库：已存在的 tag_defs 表可能仍是旧的 type 检查约束（不含 scene/shoot/skin），
-- 这里幂等地重建约束以允许全部六种标签维度，避免插入新维度时报 23514 错误。
alter table public.tag_defs drop constraint if exists tag_defs_type_check;
alter table public.tag_defs add constraint tag_defs_type_check
  check (type in ('style','element','scene','shoot','skin'));

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
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin update tag_defs" on public.tag_defs;
create policy "admin update tag_defs"
  on public.tag_defs for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin delete tag_defs" on public.tag_defs;
create policy "admin delete tag_defs"
  on public.tag_defs for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
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

-- 预设场景标签（室内/室外两大类二级分组，可自定义增删）
-- 存量库若已插入上述名称但未更新 group，用下方 update 语句归类；此处插入时直接带 group。
insert into public.tag_defs (type, name, "group") values
  ('scene', '室内·卧室', 'indoor'), ('scene', '室内·客厅', 'indoor'), ('scene', '室内·教室', 'indoor'), ('scene', '室内·书房', 'indoor'),
  ('scene', '室内·厨房', 'indoor'), ('scene', '室内·卫生间', 'indoor'), ('scene', '室内·玄关', 'indoor'), ('scene', '室内·衣帽间', 'indoor'),
  ('scene', '室内·办公室', 'indoor'), ('scene', '室外·街道', 'outdoor'), ('scene', '室外·商场', 'outdoor'), ('scene', '室外·户外', 'outdoor'),
  ('scene', '室外·园区', 'outdoor'), ('scene', '室外·广场', 'outdoor'), ('scene', '室外·公园', 'outdoor'), ('scene', '室外·建筑外景', 'outdoor'),
  ('scene', '室外·交通工具', 'outdoor')
on conflict (type, name) do update set "group" = excluded."group";

-- 预设拍摄方式标签（摆拍/挂拍/模拍/3D，可自定义增删）
insert into public.tag_defs (type, name) values
  ('shoot', '摆拍'), ('shoot', '挂拍'), ('shoot', '模拍'), ('shoot', '3D')
on conflict (type, name) do nothing;

-- 预设肤色标签（黑/白/黄，可自定义增删）
insert into public.tag_defs (type, name) values
  ('skin', '黑'), ('skin', '白'), ('skin', '黄')
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
  category text default '',         -- 类目名（复用视觉专区的 categories 表，前台按类目筛选）
  file_type text default 'pdf',
  cover text default '',            -- 封面图 R2 路径，如 trends_covers/xxx.jpg（可空，前台卡片显示封面）
  description text default '',      -- 简介/说明（可空，前台卡片展示）
  uploaded_by uuid references auth.users (id) on delete set null
);

alter table public.trends enable row level security;

-- （幂等）已建库补充封面与介绍列
alter table public.trends add column if not exists cover text default '';
alter table public.trends add column if not exists description text default '';

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
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin update trends" on public.trends;
create policy "admin update trends"
  on public.trends for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin delete trends" on public.trends;
create policy "admin delete trends"
  on public.trends for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

-- ============================================================
-- 公告功能：公告表 + 已读记录表
-- 前台：展示最近一个月内发布且该用户未读的公告；点开即为已读
-- 后台：⑦ 公告管理，可编辑/发布/下架/删除
-- ============================================================
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text default '',
  images text[] default '{}',       -- 公告配图：R2 notices/ 相对路径数组
  published boolean not null default true,   -- 是否已发布到前台
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 兼容旧表：补 images 列（若已存在则忽略）
alter table public.announcements add column if not exists images text[] default '{}';

alter table public.announcements enable row level security;

-- 登录用户可读取【已发布】的公告（前台）；后台管理需读全部，见 admin 策略
drop policy if exists "authenticated read published announcements" on public.announcements;
create policy "authenticated read published announcements"
  on public.announcements for select
  to authenticated
  using (published = true);

-- 仅管理员可读全部公告（含草稿/下架）
drop policy if exists "admin read all announcements" on public.announcements;
create policy "admin read all announcements"
  on public.announcements for select
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

-- 仅管理员可新增公告
drop policy if exists "admin insert announcements" on public.announcements;
create policy "admin insert announcements"
  on public.announcements for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

-- 仅管理员可更新公告
drop policy if exists "admin update announcements" on public.announcements;
create policy "admin update announcements"
  on public.announcements for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

-- 仅管理员可删除公告
drop policy if exists "admin delete announcements" on public.announcements;
create policy "admin delete announcements"
  on public.announcements for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

-- ---------- 公告已读记录 ----------
create table if not exists public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (announcement_id, user_id)
);

alter table public.announcement_reads enable row level security;

-- 用户可读取自己的已读记录
drop policy if exists "select own announcement reads" on public.announcement_reads;
create policy "select own announcement reads"
  on public.announcement_reads for select
  to authenticated
  using (auth.uid() = user_id);

-- 用户可写入自己的已读记录
drop policy if exists "insert own announcement reads" on public.announcement_reads;
create policy "insert own announcement reads"
  on public.announcement_reads for insert
  to authenticated
  with check (auth.uid() = user_id);

-- ============================================================
-- 招品回品专区：招品任务表 + 商家提交货品SPU表
-- 后台：⑧ 招品回品，管理员上传招品图片（配任务ID、前台序号sort_no）
-- 前台：显示招品图片+序号映射，商家填写货品SPU并保存
-- ============================================================
create table if not exists public.recruit_tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text default '',            -- 招品任务标题/说明（可空）
  task_id text not null,            -- 管理员定义的任务ID（商家据此关联，需唯一）
  sort_no int default 0,            -- 前台序号映射（数字小越靠前）
  image_path text default '',       -- 招品图片 R2 路径，如 recruits/xxx.jpg
  status text not null default 'draft',  -- 状态：draft=未发布/草稿，published=已发布
  bound boolean not null default false,  -- 已绑定标记：管理员处理后勾选
  bound_at timestamptz,             -- 绑定时间
  tags jsonb not null default '[]',      -- 管理员为该任务打的标签（字符数组）
  uploaded_by uuid references auth.users (id) on delete set null
);
alter table public.recruit_tasks enable row level security;
-- 兼容旧表：补列（幂等）
alter table public.recruit_tasks add column if not exists status text not null default 'draft';
alter table public.recruit_tasks add column if not exists bound boolean not null default false;
alter table public.recruit_tasks add column if not exists bound_at timestamptz;
alter table public.recruit_tasks add column if not exists tags jsonb not null default '[]';
alter table public.recruit_tasks add column if not exists deleted_at timestamptz;  -- 软删除：删除进回收站
-- 招品回品改版：新增差异化字段（表格直接导入）
alter table public.recruit_tasks add column if not exists site_id text default '';        -- 站点id（展示映射为站点名）
alter table public.recruit_tasks add column if not exists industry_link text default '';  -- 行业链接
alter table public.recruit_tasks add column if not exists open_priority text default '';  -- 开款优先级
alter table public.recruit_tasks add column if not exists open_type text default '';      -- 开款类型
alter table public.recruit_tasks add column if not exists recruit_reason text default ''; -- 招品原因
alter table public.recruit_tasks add column if not exists required_at text default '';    -- 提需时间（前台只展示到日）

-- 登录用户可读招品任务清单（前台商家浏览；后台管理员也经此读取）
drop policy if exists "authenticated read recruit_tasks" on public.recruit_tasks;
create policy "authenticated read recruit_tasks"
  on public.recruit_tasks for select
  to authenticated
  using (true);

-- 方案A：未登录可读已发布的招品任务（分享类目缩略图预览）；仅已发布，草稿/敏感不可见
drop policy if exists "anon read published recruit_tasks" on public.recruit_tasks;
create policy "anon read published recruit_tasks"
  on public.recruit_tasks for select
  to anon
  using (status = 'published' and deleted_at is null);

-- 仅管理员可增/改/删招品任务
drop policy if exists "admin insert recruit_tasks" on public.recruit_tasks;
create policy "admin insert recruit_tasks"
  on public.recruit_tasks for insert
  to authenticated
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')));

drop policy if exists "admin update recruit_tasks" on public.recruit_tasks;
create policy "admin update recruit_tasks"
  on public.recruit_tasks for update
  to authenticated
  using (public.is_super_admin() or (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')) and uploaded_by = auth.uid()))
  with check (public.is_super_admin() or (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')) and uploaded_by = auth.uid()));

drop policy if exists "admin delete recruit_tasks" on public.recruit_tasks;
create policy "admin delete recruit_tasks"
  on public.recruit_tasks for delete
  to authenticated
  using (public.is_super_admin() or (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')) and uploaded_by = auth.uid()));

-- ---------- 商家提交：每个用户对每个任务一条记录（spus 可多个，逗号分隔存储） ----------
create table if not exists public.recruit_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  recruit_task_id uuid not null references public.recruit_tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  spus text[] default '{}',         -- 商家提交的货品SPU（可多个）
  unique (recruit_task_id, user_id)
);
alter table public.recruit_submissions enable row level security;

-- 用户可读取自己的提交（前台回显自己已传的SPU）
drop policy if exists "select own recruit submissions" on public.recruit_submissions;
create policy "select own recruit submissions"
  on public.recruit_submissions for select
  to authenticated
  using (auth.uid() = user_id);

-- 管理员可读取全部提交（后台查看所有用户上传的SPU、导出）
drop policy if exists "admin read all recruit submissions" on public.recruit_submissions;
create policy "admin read all recruit submissions"
  on public.recruit_submissions for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')));

-- 用户可提交/更新自己的记录
drop policy if exists "upsert own recruit submissions" on public.recruit_submissions;
create policy "upsert own recruit submissions"
  on public.recruit_submissions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "update own recruit submissions" on public.recruit_submissions;
create policy "update own recruit submissions"
  on public.recruit_submissions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 仅管理员可删除提交记录
drop policy if exists "admin delete recruit submissions" on public.recruit_submissions;
create policy "admin delete recruit submissions"
  on public.recruit_submissions for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')));

-- 所有登录商家可读取全部提交（前台悬浮任务ID/图片时显示已提交的货品SPU，避免重复提交）
drop policy if exists "authenticated read all recruit submissions" on public.recruit_submissions;
create policy "authenticated read all recruit submissions"
  on public.recruit_submissions for select
  to authenticated
  using (true);

-- ================= BESTSELLER 专区（独立任务表 + 提交表） =================
create table if not exists public.bestseller_tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text default '',            -- BESTSELLER任务标题/说明（可空）
  task_id text not null,            -- 管理员定义的任务ID（商家据此关联，需唯一）
  sort_no int default 0,            -- 前台序号映射（数字小越靠前）
  image_path text default '',       -- BESTSELLER图片 R2 路径，如 bestsellers/xxx.jpg
  status text not null default 'draft',  -- 状态：draft=未发布/草稿，published=已发布
  bound boolean not null default false,  -- 已绑定标记：管理员处理后勾选
  bound_at timestamptz,             -- 绑定时间
  tags jsonb not null default '[]',      -- 管理员为该任务打的标签（字符数组）
  uploaded_by uuid references auth.users (id) on delete set null
);
alter table public.bestseller_tasks enable row level security;
-- 兼容旧表：补列（幂等）
alter table public.bestseller_tasks add column if not exists status text not null default 'draft';
alter table public.bestseller_tasks add column if not exists bound boolean not null default false;
alter table public.bestseller_tasks add column if not exists bound_at timestamptz;
alter table public.bestseller_tasks add column if not exists tags jsonb not null default '[]';
alter table public.bestseller_tasks add column if not exists deleted_at timestamptz;  -- 软删除：删除进回收站

-- 登录用户可读BESTSELLER任务清单（前台商家浏览；后台管理员也经此读取）
drop policy if exists "authenticated read bestseller_tasks" on public.bestseller_tasks;
create policy "authenticated read bestseller_tasks"
  on public.bestseller_tasks for select
  to authenticated
  using (true);

-- 方案A：未登录可读已发布的BESTSELLER任务（分享类目缩略图预览）
drop policy if exists "anon read published bestseller_tasks" on public.bestseller_tasks;
create policy "anon read published bestseller_tasks"
  on public.bestseller_tasks for select
  to anon
  using (status = 'published' and deleted_at is null);

-- 仅管理员可增/改/删BESTSELLER任务
drop policy if exists "admin insert bestseller_tasks" on public.bestseller_tasks;
create policy "admin insert bestseller_tasks"
  on public.bestseller_tasks for insert
  to authenticated
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')));

drop policy if exists "admin update bestseller_tasks" on public.bestseller_tasks;
create policy "admin update bestseller_tasks"
  on public.bestseller_tasks for update
  to authenticated
  using (public.is_super_admin() or (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')) and uploaded_by = auth.uid()))
  with check (public.is_super_admin() or (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')) and uploaded_by = auth.uid()));

drop policy if exists "admin delete bestseller_tasks" on public.bestseller_tasks;
create policy "admin delete bestseller_tasks"
  on public.bestseller_tasks for delete
  to authenticated
  using (public.is_super_admin() or (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')) and uploaded_by = auth.uid()));

-- ---------- 商家提交：每个用户对每个任务一条记录（spus 可多个，逗号分隔存储） ----------
create table if not exists public.bestseller_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  bestseller_task_id uuid not null references public.bestseller_tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  spus text[] default '{}',         -- 商家提交的货品SPU（可多个）
  unique (bestseller_task_id, user_id)
);
alter table public.bestseller_submissions enable row level security;

-- 用户可读取自己的提交（前台回显自己已传的SPU）
drop policy if exists "select own bestseller submissions" on public.bestseller_submissions;
create policy "select own bestseller submissions"
  on public.bestseller_submissions for select
  to authenticated
  using (auth.uid() = user_id);

-- 管理员可读取全部提交（后台查看所有用户上传的SPU、导出）
drop policy if exists "admin read all bestseller submissions" on public.bestseller_submissions;
create policy "admin read all bestseller submissions"
  on public.bestseller_submissions for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')));

-- 用户可提交/更新自己的记录
drop policy if exists "upsert own bestseller submissions" on public.bestseller_submissions;
create policy "upsert own bestseller submissions"
  on public.bestseller_submissions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "update own bestseller submissions" on public.bestseller_submissions;
create policy "update own bestseller submissions"
  on public.bestseller_submissions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 仅管理员可删除提交记录
drop policy if exists "admin delete bestseller submissions" on public.bestseller_submissions;
create policy "admin delete bestseller submissions"
  on public.bestseller_submissions for delete
  to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')));

-- 所有登录商家可读取全部提交（前台悬浮任务ID/图片时显示已提交的货品SPU，避免重复提交）
drop policy if exists "authenticated read all bestseller submissions" on public.bestseller_submissions;
create policy "authenticated read all bestseller submissions"
  on public.bestseller_submissions for select
  to authenticated
  using (true);

-- ============================================================
-- 专区类目与超管权限体系（分类目 / 权限分配）
-- ============================================================
-- ---------- 给招品/BESTSELLER 任务表补 category 列（幂等） ----------
alter table public.recruit_tasks add column if not exists category text default '';
alter table public.bestseller_tasks add column if not exists category text default '';
-- 专区任务内链/外链（BESTSELLER 差异化：Excel 按「竞品ID」匹配文件名后绑定网页链接，前台卡片可点击打开）
alter table public.recruit_tasks add column if not exists url text;
alter table public.bestseller_tasks add column if not exists url text;
alter table public.recruit_tasks add column if not exists url text;
alter table public.bestseller_tasks add column if not exists url text;
-- 后台审核标记（IP/品牌/类目错放/无需回品，仅后台可见，前台不展示）——2026-09新增
alter table public.recruit_tasks add column if not exists flag_ip boolean not null default false;        -- 涉IP/版权
alter table public.recruit_tasks add column if not exists flag_brand boolean not null default false;     -- 涉品牌
alter table public.recruit_tasks add column if not exists flag_cat_mismatch boolean not null default false; -- 类目错放
alter table public.recruit_tasks add column if not exists flag_no_refill boolean not null default false; -- 无需回品
alter table public.bestseller_tasks add column if not exists flag_ip boolean not null default false;
alter table public.bestseller_tasks add column if not exists flag_brand boolean not null default false;
alter table public.bestseller_tasks add column if not exists flag_cat_mismatch boolean not null default false;
alter table public.bestseller_tasks add column if not exists flag_no_refill boolean not null default false;
-- BESTSELLER 差异化：直接用主图URL + 竞品商品信息（2026-09新增）
alter table public.bestseller_tasks add column if not exists main_img_url text;   -- 主图URL（优先显示，替代上传文件）
alter table public.bestseller_tasks add column if not exists goods_id text;      -- 竞品Goods ID
alter table public.bestseller_tasks add column if not exists sku_id text;        -- 竞品SKUID
alter table public.bestseller_tasks add column if not exists site text;          -- 站点
alter table public.bestseller_tasks add column if not exists rank_time text;     -- 最新上榜时间
alter table public.recruit_tasks add column if not exists main_img_url text;     -- 招品同步兼容（可选）

-- ---------- 招品回品专区类目表（独立于视觉专区类目，可增删改） ----------
create table if not exists public.recruit_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 1,
  created_at timestamptz not null default now()
);
alter table public.recruit_categories enable row level security;
-- 登录用户可读（前台左栏需要）
drop policy if exists "authenticated read recruit_categories" on public.recruit_categories;
create policy "authenticated read recruit_categories"
  on public.recruit_categories for select to authenticated using (true);
-- 管理员/超管可增删改
drop policy if exists "admin insert recruit_categories" on public.recruit_categories;
create policy "admin insert recruit_categories"
  on public.recruit_categories for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')));
drop policy if exists "admin update recruit_categories" on public.recruit_categories;
create policy "admin update recruit_categories"
  on public.recruit_categories for update to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')));
drop policy if exists "admin delete recruit_categories" on public.recruit_categories;
create policy "admin delete recruit_categories"
  on public.recruit_categories for delete to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')));

-- ---------- BESTSELLER 专区类目表 ----------
create table if not exists public.bestseller_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 1,
  created_at timestamptz not null default now()
);
alter table public.bestseller_categories enable row level security;
drop policy if exists "authenticated read bestseller_categories" on public.bestseller_categories;
create policy "authenticated read bestseller_categories"
  on public.bestseller_categories for select to authenticated using (true);
drop policy if exists "admin insert bestseller_categories" on public.bestseller_categories;
create policy "admin insert bestseller_categories"
  on public.bestseller_categories for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')));
drop policy if exists "admin update bestseller_categories" on public.bestseller_categories;
create policy "admin update bestseller_categories"
  on public.bestseller_categories for update to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')));
drop policy if exists "admin delete bestseller_categories" on public.bestseller_categories;
create policy "admin delete bestseller_categories"
  on public.bestseller_categories for delete to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role in ('admin', 'super_admin')));

-- ---------- 专区类目权限分配表（超管分配：哪个管理员可管理哪个专区的哪些类目） ----------
-- 普通管理员只能发布/管理自己获授权的类目；超管不受此表限制
create table if not exists public.zone_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  zone text not null check (zone in ('recruit', 'bestseller')),
  category text not null,
  created_at timestamptz not null default now(),
  unique (user_id, zone, category)
);
alter table public.zone_permissions enable row level security;
-- 登录用户可读自己的权限（前台/后台按权限过滤发布下拉）
drop policy if exists "authenticated read own zone_permissions" on public.zone_permissions;
create policy "authenticated read own zone_permissions"
  on public.zone_permissions for select to authenticated
  using (auth.uid() = user_id);
-- 超管可读取全部权限（权限管理页需要）
drop policy if exists "super read all zone_permissions" on public.zone_permissions;
create policy "super read all zone_permissions"
  on public.zone_permissions for select to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin'));
-- 超管可写权限
drop policy if exists "super insert zone_permissions" on public.zone_permissions;
create policy "super insert zone_permissions"
  on public.zone_permissions for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin'));
drop policy if exists "super delete zone_permissions" on public.zone_permissions;
create policy "super delete zone_permissions"
  on public.zone_permissions for delete to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin'));

-- ---------- 安全函数：判定当前登录用户是否为超级管理员（用 security definer，避免 RLS 自引用递归） ----------
create or replace function public.is_super_admin()
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'super_admin'
  );
$$;

-- ---------- 角色枚举约束：允许超管（幂等，处理已建旧表） ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('visitor', 'admin', 'super_admin'));

-- ---------- profiles：超管可读所有用户 & 更新任何用户角色（权限管理） ----------
drop policy if exists "super read all profiles" on public.profiles;
create policy "super read all profiles"
  on public.profiles for select to authenticated
  using (public.is_super_admin());

drop policy if exists "super update profiles role" on public.profiles;
create policy "super update profiles role"
  on public.profiles for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------- 初始化专区类目：把前台类目(categories)复制进招品/BESTSELLER两张独立表（幂等去重） ----------
insert into public.recruit_categories (name, sort_order)
select c.name, c.sort_order
from public.categories c
on conflict (name) do nothing;

insert into public.bestseller_categories (name, sort_order)
select c.name, c.sort_order
from public.categories c
on conflict (name) do nothing;

-- ---------- 前台浏览专用：所有登录用户可读取全部已发布图片 ----------
-- 说明：images 表默认只让 super_admin 读全部、其它人只看自己上传的（后台智能打标专用 RLS）。
--       前台浏览（视觉专区）需要让所有登录用户看到全部图，故用 security definer 函数绕过该 RLS。
--       仅前台（frontend.js）调用，后台智能打标仍走受 RLS 限制的 listImages（管理员只看自己上传的）。
drop function if exists public.frontend_list_images();
create function public.frontend_list_images()
returns setof public.images
language sql security definer stable
as $$
  select * from public.images
  order by created_at desc;
$$;
grant execute on function public.frontend_list_images() to authenticated;

-- ---------- 前台类目菜单专用：所有登录用户可读取图片实际用到的全部类目 ----------
-- 说明：前台类目菜单的 listUsedCats 若直接查 images 表会受 RLS 限制（普通管理员/访客
--       只看到自己上传图的类目），故同样用 security definer 函数绕过，返回全量图片类目。
--       仅前台（js/supabase.js 的 listUsedCats）调用。
drop function if exists public.frontend_list_used_cats();
create function public.frontend_list_used_cats()
returns text[]
language sql security definer stable
as $$
  select array_agg(distinct category) from public.images where category is not null;
$$;
grant execute on function public.frontend_list_used_cats() to authenticated;


-- ---------- 登录设备 / IP 记录（安全设置） ----------
-- 说明：记录每个用户登录时的设备（浏览器/系统）与公网 IP，供超管后台「用户权限分配表」展示。
--       用户登录成功时由前端调用 record_login 写入；超管经 get_last_login_logs 读取全量最近记录。
create table if not exists public.login_logs (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  device text,
  ip text,
  login_at timestamptz not null default now()
);

alter table public.login_logs enable row level security;

-- 允许已登录用户写入自己的登录记录（首次/每次登录前端调用）
drop policy if exists "insert own login_log" on public.login_logs;
create policy "insert own login_log"
  on public.login_logs for insert to authenticated
  with check (auth.uid() = user_id);

-- 超管：可读取全部登录记录
drop policy if exists "super read all login_logs" on public.login_logs;
create policy "super read all login_logs"
  on public.login_logs for select to authenticated
  using (public.is_super_admin());

-- ---------- 记录一次登录（security definer，仅能写自己） ----------
drop function if exists public.record_login(p_device text, p_ip text);
create function public.record_login(p_device text default null, p_ip text default null)
returns void
language plpgsql security definer volatile
as $$
declare v_uid uuid;
begin
  select auth.uid() into v_uid;
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  insert into public.login_logs (user_id, email, device, ip)
  select v_uid, p.email, p_device, p_ip
  from public.profiles p
  where p.user_id = v_uid;
end;
$$;
grant execute on function public.record_login(text, text) to authenticated;

-- ---------- 读取每个用户最近一次登录记录（仅超管） ----------
-- 返回 user_id, email, device, ip, login_at，用于后台「用户权限分配表」两列展示。
-- 函数内部校验调用者必须是超管，否则返回空集，防止普通用户调用泄露他人 IP。
drop function if exists public.get_last_login_logs();
create function public.get_last_login_logs()
returns table (user_id uuid, email text, device text, ip text, login_at timestamptz)
language plpgsql security definer stable
as $$
declare v_is_super boolean;
begin
  select public.is_super_admin() into v_is_super;
  if not coalesce(v_is_super, false) then
    return;
  end if;
  return query
    select distinct on (l.user_id) l.user_id, l.email, l.device, l.ip, l.login_at
    from public.login_logs l
    order by l.user_id, l.login_at desc;
end;
$$;
grant execute on function public.get_last_login_logs() to authenticated;

-- ---------- 营销节日日历（营销日历）：时间节点 + 趋势文章 ----------
-- 前台「营销日历」（marketing.html）顶部时间线 + 3:4 卡片区；
-- 每个时间节点对应一张展示图，图片点击跳转文章外链；文章可在后台发布，带微信分享二维码。
-- 规则与公告保持一致：登录用户可读已发布内容；管理员（admin/super_admin）可管理全部。

create table if not exists public.marketing_nodes (
  id uuid primary key default gen_random_uuid(),
  title text not null,                 -- 时间节点名称（如"万圣节""双11"）
  date text default '',                -- 节点日期（YYYY-MM-DD 或自由文本，用于时间线定位/排序）
  sort_order int not null default 0,   -- 时间线显示顺序（升序）
  image text default '',               -- 节点展示图路径（R2 marketing/ 相对路径），可为空（前台显示标题卡）
  url text default '',                 -- 节点对应文章外链（点击跳转），可空
  description text default '',         -- 节点简述（可选，卡片下方小字）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_nodes enable row level security;

drop policy if exists "authenticated read published marketing_nodes" on public.marketing_nodes;
create policy "authenticated read published marketing_nodes"
  on public.marketing_nodes for select
  to authenticated
  using (true);

drop policy if exists "admin all marketing_nodes" on public.marketing_nodes;
create policy "admin all marketing_nodes"
  on public.marketing_nodes for all
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

create table if not exists public.marketing_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,                 -- 文章标题
  url text default '',                 -- 文章外链（点击卡片跳转）
  image text default '',               -- 文章封面/展示图路径（R2 marketing/ 相对路径）
  summary text default '',             -- 文章摘要（可选）
  node_id uuid references public.marketing_nodes (id) on delete set null, -- 关联时间节点（可空）
  published boolean not null default true,   -- 是否发布到前台
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_articles enable row level security;

drop policy if exists "authenticated read published marketing_articles" on public.marketing_articles;
create policy "authenticated read published marketing_articles"
  on public.marketing_articles for select
  to authenticated
  using (published = true);

drop policy if exists "admin read all marketing_articles" on public.marketing_articles;
create policy "admin read all marketing_articles"
  on public.marketing_articles for select
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin insert marketing_articles" on public.marketing_articles;
create policy "admin insert marketing_articles"
  on public.marketing_articles for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin update marketing_articles" on public.marketing_articles;
create policy "admin update marketing_articles"
  on public.marketing_articles for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );

drop policy if exists "admin delete marketing_articles" on public.marketing_articles;
create policy "admin delete marketing_articles"
  on public.marketing_articles for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.role in ('admin', 'super_admin'))
  );
