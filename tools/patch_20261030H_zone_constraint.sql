-- ============================================================================
-- patch_20261030H_zone_constraint.sql
-- 放开「专区字段」的数据库级枚举限制
-- ----------------------------------------------------------------------------
-- 问题现象：
--   给管理员勾选「趋势动向」权限时保存失败，提示
--   new row for relation "zone_permissions" violates check constraint
--   "zone_permissions_zone_check"
--
-- 根本原因：
--   这些表的 zone 字段在数据库里带了一条 CHECK 约束，把允许的专区写成固定清单
--   （early 的几个专区）。后来新增的「趋势动向」不在清单里，写入被数据库直接拒绝。
--   这不是前端问题，前端的枚举已包含新专区，是数据库这一层还停在旧清单。
--
--   同类风险还会出现在：每新增一个专区，都要回来改这条约束，
--   否则「权限管理」「前台可见开关」「专区类目」三处一保存就报同样的错。
--
-- 本补丁的做法：
--   删掉这些表 zone 字段上的 CHECK 约束，改为「不做数据库级枚举校验」。
--   专区的合法性统一由应用层（config.js 的专区定义 + 后台校验）负责 ——
--   应用层本来就在校验，数据库再用硬编码清单校验只会成为新专区的拦路石。
--
-- 安全性说明：
--   · 只删除「约束定义里出现 zone 字样」的 CHECK 约束，不碰其他约束；
--   · 不删除任何列、不删除任何数据、不加任何列；
--   · 主键、唯一键、外键、非空约束全部保留；
--   · 行级安全策略（RLS）不受影响，谁能写这两张表仍由策略决定。
--
-- 幂等：约束不存在时什么也不做，可重复执行。
-- ============================================================================

-- ---------- 0. 改前诊断：列出当前所有 zone 相关的 CHECK 约束 ----------
SELECT c.relname                      AS 表名,
       con.conname                    AS 约束名,
       pg_get_constraintdef(con.oid)  AS 约束定义
FROM pg_constraint con
JOIN pg_class c       ON c.oid = con.conrelid
JOIN pg_namespace n   ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND con.contype = 'c'
  AND c.relname IN ('zone_permissions', 'frontend_zone_visibility', 'frontend_cat_visibility', 'zone_cats', 'profiles')
  AND pg_get_constraintdef(con.oid) ILIKE '%zone%'
ORDER BY c.relname, con.conname;

-- ---------- 1. 删除这些约束 ----------
DO $$
DECLARE
  v_rec   record;
  v_count int := 0;
BEGIN
  FOR v_rec IN
    SELECT c.relname AS tbl, con.conname AS cname
    FROM pg_constraint con
    JOIN pg_class c     ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND con.contype = 'c'
      AND c.relname IN ('zone_permissions', 'frontend_zone_visibility', 'frontend_cat_visibility', 'zone_cats')
      AND pg_get_constraintdef(con.oid) ILIKE '%zone%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_rec.tbl, v_rec.cname);
    RAISE NOTICE '已删除约束：%.%', v_rec.tbl, v_rec.cname;
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE '本次共删除 % 条 zone 相关 CHECK 约束', v_count;
END $$;

-- ---------- 2. 改后自检 ----------
-- 2.1 剩余的 zone 相关 CHECK 约束应为 0 行
SELECT c.relname                      AS 表名,
       con.conname                    AS 约束名,
       pg_get_constraintdef(con.oid)  AS 约束定义
FROM pg_constraint con
JOIN pg_class c       ON c.oid = con.conrelid
JOIN pg_namespace n   ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND con.contype = 'c'
  AND c.relname IN ('zone_permissions', 'frontend_zone_visibility', 'frontend_cat_visibility', 'zone_cats')
  AND pg_get_constraintdef(con.oid) ILIKE '%zone%';

-- 2.2 确认四张表都还在、且结构完整（应各返回 1 行）
SELECT 'zone_permissions' AS 表名, COUNT(*) AS 列数
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'zone_permissions'
UNION ALL
SELECT 'frontend_zone_visibility', COUNT(*)
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'frontend_zone_visibility'
UNION ALL
SELECT 'frontend_cat_visibility', COUNT(*)
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'frontend_cat_visibility'
UNION ALL
SELECT 'zone_cats', COUNT(*)
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'zone_cats';

-- 2.3 数据未受影响：现有授权条数（改前改后应一致）
SELECT 'zone_permissions 现有授权' AS 项目, COUNT(*) AS 数量 FROM public.zone_permissions;