-- ============================================================================
-- diagnose_zone_menu.sql —— 前台看不到「趋势动向」时，一次定位卡在哪一层
-- ----------------------------------------------------------------------------
-- 前台顶部菜单是否出现某专区，由三层共同决定：
--   ① 专区定义里有没有它、有没有前台链接   → site_settings.frontend_zone_visibility.__defs
--   ② 全站开关有没有把它关掉               → site_settings.frontend_zone_visibility.<zone>
--   ③ 当前账号的白名单里有没有它            → profiles.frontend_zones（超管不受此限）
-- 本脚本只读，不修改任何数据。逐段看结果即可定位。
-- ============================================================================

-- ---------- 1. 当前登录账号是谁、角色、白名单 ----------
-- 说明：SQL 编辑器里没有"当前登录用户"的概念，这里列出全部账号，按需对照你的账号
SELECT user_id,
       role                                   AS 角色,
       COALESCE(frontend_zones, '{}')         AS 前台可见白名单,
       COALESCE(manage_zones, '{}')           AS 后台管理白名单
FROM public.profiles
ORDER BY CASE role WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, user_id;

-- ---------- 2. 专区定义里有没有「趋势动向」、链接是否为空 ----------
-- 期望：defs 里能看到 movement 且 href 为 movement.html
SELECT jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(frontend_zone_visibility::jsonb -> '__defs') = 'array'
             THEN frontend_zone_visibility::jsonb -> '__defs'
           ELSE '[]'::jsonb
         END
       ) AS 保存的专区定义
FROM public.site_settings
WHERE id = 1;

-- ---------- 3. 全站可见性开关（是否有 zone 被显式关掉） ----------
-- 期望：没有任何 movement: false
SELECT key AS 专区, value AS 值
FROM public.site_settings,
     LATERAL jsonb_each_text(frontend_zone_visibility::jsonb)
WHERE id = 1
  AND key <> '__defs'
ORDER BY key;

-- ---------- 4. 专区字段上是否还残留 CHECK 约束（会挡住保存权限） ----------
-- 期望：0 行。有结果就先执行 patch_20261030H_zone_constraint.sql
SELECT c.relname                      AS 表名,
       con.conname                    AS 约束名,
       pg_get_constraintdef(con.oid)  AS 约束定义
FROM pg_constraint con
JOIN pg_class c     ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND con.contype = 'c'
  AND c.relname IN ('zone_permissions', 'frontend_zone_visibility', 'frontend_cat_visibility', 'zone_cats')
  AND pg_get_constraintdef(con.oid) ILIKE '%zone%';

-- ---------- 5. 现有权限里出现过的专区值 ----------
-- 期望：patch 跑完后能写入 movement
SELECT zone AS 专区, COUNT(*) AS 授权条数
FROM public.zone_permissions
GROUP BY zone
ORDER BY zone;