-- ============================================================
-- 版本恢复（数据快照 / 一键回滚）—— 超管专用
-- 目的：防止误删、误改造成站内数据丢失。
--
-- 口径说明（务必知悉）：
--   1) 快照存的是「数据库里的记录」（图片记录、类目、标签、榜单、公告、设置、
--      权限配置等），**不包含 R2 上的图片文件本身**。所以恢复能找回"哪些图在库里、
--      属于哪个类目/标签"，但若图片文件已被从 R2 物理删除，文件本身无法靠快照找回。
--   2) 恢复 = 先把当前状态自动再存一份「恢复前自动备份」，再按快照回写。
--      整个过程在一个函数（一个事务）里执行：任何一步失败 → 全部回滚，原数据完好。
--   3) 只保留最近 10 份快照，超出自动清理最早的。
--   4) data_backups 开了 RLS 且**不建任何策略**：任何账号都不能直接读写，
--      只能用下面几个函数，函数内部校验超管身份。
--   5) 本脚本可重复执行（幂等）。
-- ============================================================

drop function if exists public.backup_create(text, text);
drop function if exists public.backup_list();
drop function if exists public.backup_get(bigint);
drop function if exists public.backup_delete(bigint);
drop function if exists public.backup_restore(bigint);
drop function if exists public.backup_tables();

create table if not exists public.data_backups (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  created_by uuid,
  email text,
  note text not null default '',
  kind text not null default 'manual',        -- manual = 手动 / auto = 恢复前自动
  table_counts jsonb not null default '{}'::jsonb,
  bytes bigint not null default 0,
  payload jsonb not null
);

create index if not exists data_backups_created_idx on public.data_backups (created_at desc);

alter table public.data_backups enable row level security;
-- 刻意不建任何策略（既不开放 select 也不开放 insert）：只能走下面的 security definer 函数。

-- 纳入快照的表：**顺序即插入顺序（父表在前）**；删除时按反序进行，避免外键报错。
create or replace function public.backup_tables()
returns text[]
language sql immutable
set search_path = public, pg_temp
as $$
  select array[
    'categories', 'tag_defs', 'site_settings', 'zone_permissions',
    'rank_sites', 'rank_batches', 'marketing_nodes',
    'images', 'announcements', 'trends',
    'rank_items', 'marketing_articles',
    'recruit_categories', 'bestseller_categories'
  ]::text[];
$$;

-- ---------- 生成快照 ----------
create function public.backup_create(p_note text, p_kind text default 'manual')
returns jsonb
language plpgsql security definer volatile
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_email text;
  v_id bigint;
  v_tbl text;
  v_arr jsonb;
  v_payload jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  v_bytes bigint;
begin
  if not public.is_super_admin() then
    raise exception 'not allowed';
  end if;
  select auth.uid() into v_uid;
  select p.email into v_email from public.profiles p where p.user_id = v_uid;

  foreach v_tbl in array public.backup_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t', v_tbl) into v_arr;
    execute format('select count(*) from public.%I', v_tbl) into v_n;
    v_payload := v_payload || jsonb_build_object(v_tbl, v_arr);
    v_counts := v_counts || jsonb_build_object(v_tbl, v_n);
  end loop;

  -- 权限相关字段单独存一份（不整表快照，恢复时只回写权限列，避免误删后来新增的账号）
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', p.user_id, 'email', p.email, 'role', p.role,
           'user_tag', p.user_tag, 'user_note', p.user_note,
           'manage_zones', p.manage_zones, 'frontend_zones', p.frontend_zones
         )), '[]'::jsonb)
    into v_arr from public.profiles p;
  v_payload := v_payload || jsonb_build_object('profiles', v_arr);
  select count(*) into v_n from public.profiles;
  v_counts := v_counts || jsonb_build_object('profiles', v_n);

  v_bytes := pg_column_size(v_payload);

  insert into public.data_backups (created_by, email, note, kind, table_counts, bytes, payload)
  values (
    v_uid, v_email,
    coalesce(nullif(trim(coalesce(p_note, '')), ''), '手动快照'),
    case when coalesce(p_kind, '') = 'auto' then 'auto' else 'manual' end,
    v_counts, v_bytes, v_payload
  )
  returning id into v_id;

  -- 只保留最近 10 份
  delete from public.data_backups where id in (
    select id from public.data_backups order by created_at desc, id desc offset 10
  );

  return jsonb_build_object('id', v_id, 'counts', v_counts, 'bytes', v_bytes);
end;
$$;
revoke all on function public.backup_create(text, text) from public, anon;
grant execute on function public.backup_create(text, text) to authenticated;

-- ---------- 快照列表（不含快照内容本身，避免把页面撑爆） ----------
create function public.backup_list()
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if not public.is_super_admin() then
    raise exception 'not allowed';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'created_at', b.created_at, 'email', b.email,
             'note', b.note, 'kind', b.kind, 'counts', b.table_counts, 'bytes', b.bytes
           ) order by b.created_at desc, b.id desc)
    from public.data_backups b
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.backup_list() from public, anon;
grant execute on function public.backup_list() to authenticated;

-- ---------- 单份快照概要（各表条数；用于恢复前预览） ----------
create function public.backup_get(p_id bigint)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'not allowed';
  end if;
  select jsonb_build_object('id', b.id, 'created_at', b.created_at, 'note', b.note,
                            'kind', b.kind, 'email', b.email, 'bytes', b.bytes,
                            'counts', b.table_counts)
    into v
    from public.data_backups b where b.id = p_id;
  return v;
end;
$$;
revoke all on function public.backup_get(bigint) from public, anon;
grant execute on function public.backup_get(bigint) to authenticated;

-- ---------- 删除某份快照 ----------
create function public.backup_delete(p_id bigint)
returns boolean
language plpgsql security definer volatile
set search_path = public, pg_temp
as $$
begin
  if not public.is_super_admin() then
    raise exception 'not allowed';
  end if;
  delete from public.data_backups where id = p_id;
  return true;
end;
$$;
revoke all on function public.backup_delete(bigint) from public, anon;
grant execute on function public.backup_delete(bigint) to authenticated;

-- ---------- 恢复到某份快照 ----------
-- 恢复前会自动先存一份「恢复前自动备份」，万一恢复错了还能退回上一步。
create function public.backup_restore(p_id bigint)
returns jsonb
language plpgsql security definer volatile
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
  v_tables text[];
  v_tbl text;
  v_rows jsonb;
  v_n bigint;
  v_result jsonb := '{}'::jsonb;
  v_safety jsonb;
  i integer;
begin
  if not public.is_super_admin() then
    raise exception 'not allowed';
  end if;

  select b.payload into v_payload from public.data_backups b where b.id = p_id;
  if v_payload is null then
    raise exception 'snapshot not found';
  end if;

  v_safety := public.backup_create('恢复前自动备份', 'auto');

  v_tables := public.backup_tables();
  if v_tables is null or array_length(v_tables, 1) is null then
    raise exception 'snapshot table list is empty';
  end if;

  -- 第一遍：按反序清空（子表在前，避免外键报错）
  for i in reverse array_length(v_tables, 1) .. 1 loop
    v_tbl := v_tables[i];
    if v_payload ? v_tbl then
      execute format('delete from public.%I', v_tbl);
    end if;
  end loop;

  -- 第二遍：按正序回写（父表在前）
  for i in 1 .. array_length(v_tables, 1) loop
    v_tbl := v_tables[i];
    if v_payload ? v_tbl then
      v_rows := coalesce(v_payload -> v_tbl, '[]'::jsonb);
      execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)', v_tbl, v_tbl)
        using v_rows;
      execute format('select count(*) from public.%I', v_tbl) into v_n;
      v_result := v_result || jsonb_build_object(v_tbl, v_n);
    end if;
  end loop;

  -- 权限字段：只更新已存在的账号（不新建、不删除账号）
  if v_payload ? 'profiles' then
    update public.profiles p set
      role = coalesce(e.r ->> 'role', p.role),
      user_tag = coalesce(e.r ->> 'user_tag', p.user_tag),
      user_note = coalesce(e.r ->> 'user_note', p.user_note),
      manage_zones = coalesce(e.r -> 'manage_zones', p.manage_zones),
      frontend_zones = coalesce(e.r -> 'frontend_zones', p.frontend_zones)
    from (
      select value as r from jsonb_array_elements(coalesce(v_payload -> 'profiles', '[]'::jsonb))
    ) e
    where p.user_id::text = (e.r ->> 'user_id');
    get diagnostics v_n = row_count;
    v_result := v_result || jsonb_build_object('profiles', v_n);
  end if;

  return jsonb_build_object(
    'ok', true,
    'restored', v_result,
    'safety_id', (v_safety ->> 'id')::bigint
  );
end;
$$;
revoke all on function public.backup_restore(bigint) from public, anon;
grant execute on function public.backup_restore(bigint) to authenticated;
