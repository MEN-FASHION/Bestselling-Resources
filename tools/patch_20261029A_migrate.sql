-- ============================================================
-- patch_20261029A —— 图库打标数据迁移（images → rank_image_tags）
--
-- 背景：图库原来把打标值直接存在 images 的 *_tags 列上。
--       20261029A 起统一存到 rank_image_tags（与趋势上升榜同一套）。
--       本脚本把 images 上的历史标签搬进新表，一次性、可重复执行。
--
-- 特性：
--   · 幂等：只补空字段，不覆盖新表里已有的值；重复执行无副作用
--   · 只读 images，不删不改 images 里的任何数据（回滚不需要）
--   · 搬迁后 images 上的列保持原样，代码里保留兜底读取，双保险
-- ============================================================

-- ---------- 1) 迁移前：老位置到底有多少行带标签 ----------
select
  count(*) filter (where coalesce(array_length(style_tags,1),0)   > 0) as "风格_有值",
  count(*) filter (where coalesce(array_length(element_tags,1),0) > 0) as "元素_有值",
  count(*) filter (where coalesce(array_length(scene_tags,1),0)   > 0) as "场景_有值",
  count(*) filter (where coalesce(array_length(shoot_tags,1),0)   > 0) as "拍摄_有值",
  count(*) filter (where coalesce(array_length(skin_tags,1),0)    > 0) as "模特_有值",
  count(*) filter (where coalesce(array_length(tags,1),0)         > 0) as "渠道_有值"
from public.images;

-- ---------- 2) 迁移 ----------
do $$
declare
  v_n int := 0;
  v_r record;
begin
  -- 逐行处理：按地址 upsert，只填新表里还空着的字段
  for v_r in
    select id, url, category,
           style_tags, element_tags, scene_tags, shoot_tags, skin_tags, tags
    from public.images
    where url is not null and btrim(url) <> ''
      and (
        coalesce(array_length(style_tags,1),0) > 0 or
        coalesce(array_length(element_tags,1),0) > 0 or
        coalesce(array_length(scene_tags,1),0) > 0 or
        coalesce(array_length(shoot_tags,1),0) > 0 or
        coalesce(array_length(skin_tags,1),0) > 0 or
        coalesce(array_length(tags,1),0) > 0
      )
  loop
    insert into public.rank_image_tags
      (image_url, category, style_tags, element_tags, scene_tags, shoot_tags, skin_tags, tags)
    values
      (v_r.url, coalesce(v_r.category,''), coalesce(v_r.style_tags,'{}'), coalesce(v_r.element_tags,'{}'),
       coalesce(v_r.scene_tags,'{}'), coalesce(v_r.shoot_tags,'{}'), coalesce(v_r.skin_tags,'{}'),
       coalesce(v_r.tags,'{}'))
    on conflict (image_url) do update set
      category     = case when coalesce(public.rank_image_tags.category,'')      = '' then excluded.category     else public.rank_image_tags.category     end,
      style_tags   = case when coalesce(array_length(public.rank_image_tags.style_tags,1),0)  = 0 then excluded.style_tags   else public.rank_image_tags.style_tags   end,
      element_tags = case when coalesce(array_length(public.rank_image_tags.element_tags,1),0)= 0 then excluded.element_tags else public.rank_image_tags.element_tags end,
      scene_tags   = case when coalesce(array_length(public.rank_image_tags.scene_tags,1),0)  = 0 then excluded.scene_tags   else public.rank_image_tags.scene_tags   end,
      shoot_tags   = case when coalesce(array_length(public.rank_image_tags.shoot_tags,1),0)  = 0 then excluded.shoot_tags   else public.rank_image_tags.shoot_tags   end,
      skin_tags    = case when coalesce(array_length(public.rank_image_tags.skin_tags,1),0)   = 0 then excluded.skin_tags    else public.rank_image_tags.skin_tags    end,
      tags         = case when coalesce(array_length(public.rank_image_tags.tags,1),0)        = 0 then excluded.tags         else public.rank_image_tags.tags         end,
      updated_at   = now();
    v_n := v_n + 1;
  end loop;
  raise notice '迁移完成，处理 % 行', v_n;
end $$;

-- ---------- 3) 迁移后自检 ----------
-- 3.1 新表标签行数应与上面「有值」行数大体一致
select count(*) as "标签表总行数",
       count(*) filter (where coalesce(array_length(style_tags,1),0) > 0) as "风格_有值"
from public.rank_image_tags;

-- 3.2 抽查 5 行，确认标签确实搬过来了
select image_url, category, style_tags, element_tags, tags
from public.rank_image_tags
where coalesce(array_length(style_tags,1),0) > 0
limit 5;
