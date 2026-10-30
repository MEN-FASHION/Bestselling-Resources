-- ============================================================================
-- patch_20261030J_season_visibility.sql
-- 趋势动向：新增「发布会年度 + 季节」，以及「打标标签前台可见性」配置
--
-- 内容：
--   1. movement_items 增加两列：season_year（年度，0=未设置）、season（季节，空=未设置）
--   2. 新建 movement_settings（单行），存 tag_visibility：{ 维度键: false } 表示该维度前台不展示
--
-- 特性：幂等，可重复执行；只增列/建表/建索引，不删不改任何既有数据。
-- 刻意不加任何 CHECK 约束 —— 专区/标签这类枚举值会持续增加，
-- 数据库层写死清单会在下次新增时把写入挡住（此前 zone 字段就是这么踩坑的）。
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. 图片本体：发布会年度 + 季节
-- ---------------------------------------------------------------------------
ALTER TABLE public.movement_items ADD COLUMN IF NOT EXISTS season_year INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.movement_items ADD COLUMN IF NOT EXISTS season      TEXT    NOT NULL DEFAULT '';

COMMENT ON COLUMN public.movement_items.season_year IS '发布会年度，如 2026；0 表示未设置';
COMMENT ON COLUMN public.movement_items.season      IS '发布会季节：春/夏/秋/冬；空串表示未设置';

-- 按「年度+季节」筛图
CREATE INDEX IF NOT EXISTS ix_movement_items_season
  ON public.movement_items (season_year DESC, season);

-- ---------------------------------------------------------------------------
-- 2. 前台标签可见性（单行配置）
--    tag_visibility 形如 {"festival_tags": false}：
--      有键且为 false → 前台不展示该维度；无键 → 默认展示
--    只影响前台展示，不影响后台打标与导入导出。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.movement_settings (
  id             INTEGER PRIMARY KEY DEFAULT 1,
  tag_visibility JSONB   NOT NULL DEFAULT '{}'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT movement_settings_single_row CHECK (id = 1)
);

ALTER TABLE public.movement_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mvset_read  ON public.movement_settings;
CREATE POLICY mvset_read ON public.movement_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS mvset_write ON public.movement_settings;
CREATE POLICY mvset_write ON public.movement_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.movement_settings (id, tag_visibility)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ============================================================================
-- 自检
-- ============================================================================
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'movement_items'
       AND column_name IN ('season_year', 'season'))                    AS "新增列_应为2",
  to_regclass('public.movement_settings') IS NOT NULL                    AS "配置表_应为true",
  (SELECT count(*) FROM public.movement_settings)                       AS "配置行数_应为1",
  (SELECT count(*) FROM public.movement_items WHERE season_year = 0)    AS "图片未设年度_存量",
  (SELECT count(*) FROM public.movement_items)                          AS "图片总数";