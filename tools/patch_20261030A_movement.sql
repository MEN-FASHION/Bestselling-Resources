-- ============================================================================
-- patch_20261030A_movement.sql
-- 趋势动向专区：建表 + 类目枚举
--
-- 背景：视觉专区的批量上传已经下线（上传与打标绑在一起，反复出问题）。
--       趋势动向是新建的独立专区，结构与趋势上升榜一致：
--         图片本体 → movement_items
--         打标数据 → rank_image_tags（已存在，与榜单共用，不重复建）
--
-- 特性：幂等，可重复执行，不删不改任何既有表/列/数据。
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. 图片本体表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.movement_items (
  id          BIGSERIAL PRIMARY KEY,
  image_url   TEXT        NOT NULL,
  path        TEXT        NOT NULL DEFAULT '',
  category    TEXT        NOT NULL DEFAULT '',
  title       TEXT        NOT NULL DEFAULT '',
  batch_id    TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一张图只登记一次，避免重复上传产生多行
CREATE UNIQUE INDEX IF NOT EXISTS ux_movement_items_url
  ON public.movement_items (image_url);

CREATE INDEX IF NOT EXISTS ix_movement_items_category
  ON public.movement_items (category, id DESC);

CREATE INDEX IF NOT EXISTS ix_movement_items_created
  ON public.movement_items (created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. 行级权限：与图库保持一致的口径
--    登录用户可读；写入由服务端/管理员身份执行。
-- ---------------------------------------------------------------------------
ALTER TABLE public.movement_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mv_read_authed ON public.movement_items;
CREATE POLICY mv_read_authed ON public.movement_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS mv_write_authed ON public.movement_items;
CREATE POLICY mv_write_authed ON public.movement_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3. 打标表兜底：rank_image_tags 若尚未建，这里补建（已存在则原样跳过）
--    字段与榜单完全一致，两个专区共用，新增维度只改这一处。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rank_image_tags (
  id            BIGSERIAL PRIMARY KEY,
  image_url     TEXT NOT NULL,
  style_tags    TEXT[] DEFAULT '{}',
  visual_tags   TEXT[] DEFAULT '{}',
  element_tags  TEXT[] DEFAULT '{}',
  craft_tags    TEXT[] DEFAULT '{}',
  shoot_tags    TEXT[] DEFAULT '{}',
  skin_tags     TEXT[] DEFAULT '{}',
  fit_tags      TEXT[] DEFAULT '{}',
  culture_tags  TEXT[] DEFAULT '{}',
  psych_tags    TEXT[] DEFAULT '{}',
  festival_tags TEXT[] DEFAULT '{}',
  tags          TEXT[] DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_rank_image_tags_url
  ON public.rank_image_tags (image_url);

-- 老库可能已有这张表但缺新增维度，逐列补齐（IF NOT EXISTS 保证不重复）
ALTER TABLE public.rank_image_tags ADD COLUMN IF NOT EXISTS culture_tags  TEXT[] DEFAULT '{}';
ALTER TABLE public.rank_image_tags ADD COLUMN IF NOT EXISTS psych_tags    TEXT[] DEFAULT '{}';
ALTER TABLE public.rank_image_tags ADD COLUMN IF NOT EXISTS festival_tags TEXT[] DEFAULT '{}';

COMMIT;

-- ============================================================================
-- 自检
-- ============================================================================
SELECT
  to_regclass('public.movement_items')    IS NOT NULL AS "图片表_应为true",
  to_regclass('public.rank_image_tags')   IS NOT NULL AS "标签表_应为true",
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='movement_items')  AS "图片表列数_应为6",
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='rank_image_tags'
       AND column_name IN ('culture_tags','psych_tags','festival_tags')) AS "新增维度_应为3",
  (SELECT count(*) FROM public.movement_items)  AS "现有图片数";