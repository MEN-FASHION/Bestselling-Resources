-- ============================================================
-- 补丁：我的收藏 —— 每个分类下再分「上装 / 下装」
-- 版本：20261023I
--
-- 背景：收藏只按「印花 / 面料 / 图案 / 工艺 / 视觉」分类，
--       但同一类目里上装和下装混在一起，挑款时来回翻。
--       现在每张收藏图可以再标一次「上装 / 下装」，与分类互不影响：
--         分类（category_id）= 是哪一类
--         二分类（sub_cat）  = 上装还是下装
--
-- 本补丁只做加法：
--   1) fav_items 新增 sub_cat（'top' | 'bottom' | null）
--   2) 加一个部分索引，按二分类筛更快
--   3) 通知 PostgREST 重载结构（不写这句，前端会一直报列不存在）
--
-- 幂等：可重复执行；不删任何既有数据；不动任何既有表。
-- 老数据的 sub_cat 为 null，界面上显示为「未分」，不会丢图。
-- ============================================================

alter table public.fav_items
  add column if not exists sub_cat text;

-- 只允许两个合法值；用约束保证脏值进不来（再加 null 表示未分）
alter table public.fav_items
  drop constraint if exists fav_items_sub_cat_chk;
alter table public.fav_items
  add constraint fav_items_sub_cat_chk
  check (sub_cat is null or sub_cat in ('top', 'bottom'));

create index if not exists idx_fav_items_subcat
  on public.fav_items (user_id, sub_cat);


-- ---------- 刷新接口缓存（关键，不能省）----------
notify pgrst, 'reload schema';


-- ---------- 自检（执行完应看到一行 sub_cat）----------
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'fav_items'
--    and column_name = 'sub_cat';
