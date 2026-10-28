-- ============================================================================
-- patch_20261027L.sql —— 榜单标签表放行访客读取 + 数据落地诊断
-- ----------------------------------------------------------------------------
-- 背景：
--   rank_image_tags 建表时配的策略是「登录用户可读、管理员可写」。
--   而前台榜单页访客是未登录身份（anon），读这张表会被行级安全策略拦掉。
--   Supabase 在"策略不通过"时返回空集而不是报错，前端拿到空就静默跳过，
--   表现就是「后台能看见标签、前台完全没有」，很容易被误判成"没打标"。
--
-- 本补丁只做一件事：加一条 anon 只读策略。
--   仍不允许匿名写入 —— 写策略只有 admin / super_admin，保持不变。
--   幂等，可重复执行。
-- ============================================================================


-- ---------------------------------------------------------------- 第 1 步：放行访客只读
drop policy if exists "anon read rank_image_tags" on public.rank_image_tags;
create policy "anon read rank_image_tags"
  on public.rank_image_tags for select
  to anon
  using (true);

notify pgrst, 'reload schema';


-- ============================================================================
-- 第 2 步：诊断 —— 数据到底进没进去
-- ----------------------------------------------------------------------------
-- 看三件事：
--   总行数         应为你在导入页看到的「写入 N 行」累加值
--   各维度有值行数  对应维度非空的行数（只打了前 10 张，就是 10 或更少）
--   最近更新时间   应接近你刚才导入的时间
-- ============================================================================
select
  count(*)                                                                        as "总行数",
  count(*) filter (where coalesce(array_length(style_tags,1),0)   > 0)             as "风格_有值行数",
  count(*) filter (where coalesce(array_length(visual_tags,1),0)  > 0)             as "视觉_有值行数",
  count(*) filter (where coalesce(array_length(element_tags,1),0) > 0)             as "图案元素_有值行数",
  count(*) filter (where coalesce(array_length(craft_tags,1),0)   > 0)             as "二次工艺_有值行数",
  count(*) filter (where coalesce(array_length(shoot_tags,1),0)   > 0)             as "拍摄方式_有值行数",
  count(*) filter (where coalesce(array_length(fit_tags,1),0)     > 0)             as "版型_有值行数",
  to_char(max(updated_at) at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS')    as "最近更新时间",
  count(distinct batch_id)                                                        as "批次数"
from public.rank_image_tags;


-- ---------------------------------------------------------------- 第 3 步：看几条样例
-- 确认标签内容与顺序符合预期（多值以数组形式存储）
select image_url, style_tags, visual_tags, element_tags, craft_tags, shoot_tags, fit_tags, batch_id
from public.rank_image_tags
order by updated_at desc
limit 3;


-- ---------------------------------------------------------------- 第 4 步：确认策略已生效
-- 期望：共 3 条 —— anon read / auth read / admin write
select policyname, roles::text, cmd
from pg_policies
where schemaname = 'public' and tablename = 'rank_image_tags'
order by policyname;