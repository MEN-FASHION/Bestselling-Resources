-- ============================================================================
-- patch_20261031A_channel.sql
-- 渠道雷达 · 渠道对比专区：建表 + 默认渠道
--
-- 定位：与「趋势上升榜」「趋势动向」同构，但对比维度不是周次，而是「渠道（平台）」。
--   渠道清单   → channel_sites（后台可增删改排序，前台按此出列）
--   图片本体   → channel_items（类目 + 渠道 + 周次 三个坐标）
--   打标数据   → rank_image_tags（已存在，与榜单/趋势动向共用，不重复建）
--   前台开关   → channel_settings（标签维度前台可见性，与趋势动向同机制）
--
-- 特性：幂等。可重复执行；不删列、不改既有表结构、不动既有数据。
-- ============================================================================

-- ============================================================================
-- 第 0 步：先自证「我连的是不是站点那个库」（别跳过）
--   期望：站点核心表命中数 = 6。小于 6 → 连错项目了，不要往下跑。
-- ============================================================================
SELECT
  current_database() AS "当前数据库",
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN ('images','categories','rank_items','profiles','site_settings','rank_batches')
  ) AS "站点核心表命中数_应为6",
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema='public' AND table_name='rank_image_tags'
  ) AS "rank_image_tags_是否已存在_1存在0不存在";

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. 渠道清单（平台）
--    为什么单独一张表：渠道是运营会不断增删的业务字典（SHEIN 之外可能还有
--    区域站、独立站、新平台），写死在前端会导致"加一个渠道要发版"。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channel_sites (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  sort_order  INT         NOT NULL DEFAULT 0,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_channel_sites_name
  ON public.channel_sites (name);

CREATE INDEX IF NOT EXISTS ix_channel_sites_sort
  ON public.channel_sites (sort_order, name);

-- ---------------------------------------------------------------------------
-- 2. 图片本体
--    week_label 存可读周次（如 2026-W44），week_sort 存可排序整数（202644）。
--    只存标签不存 sort 会导致"W9 排在 W44 后面"这种低级错。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channel_items (
  id          BIGSERIAL PRIMARY KEY,
  image_url   TEXT        NOT NULL,
  path        TEXT        NOT NULL DEFAULT '',
  category    TEXT        NOT NULL DEFAULT '',
  channel     TEXT        NOT NULL DEFAULT '',
  week_label  TEXT        NOT NULL DEFAULT '',
  week_sort   INT         NOT NULL DEFAULT 0,
  title       TEXT        NOT NULL DEFAULT '',
  batch_id    TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一张图只登记一次，避免重复上传产生多行
CREATE UNIQUE INDEX IF NOT EXISTS ux_channel_items_url
  ON public.channel_items (image_url);

CREATE INDEX IF NOT EXISTS ix_channel_items_cat
  ON public.channel_items (category, id DESC);

CREATE INDEX IF NOT EXISTS ix_channel_items_channel
  ON public.channel_items (channel, week_sort DESC, id DESC);

CREATE INDEX IF NOT EXISTS ix_channel_items_week
  ON public.channel_items (week_sort DESC);

-- ---------------------------------------------------------------------------
-- 3. 前台标签可见性（只影响前台大图里显不显示某个维度，不影响后台打标）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channel_settings (
  id            INT PRIMARY KEY,
  tag_visibility JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.channel_settings (id, tag_visibility)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. 行级权限：与图库/趋势动向同一口径（登录可读，写入同样要求登录）
-- ---------------------------------------------------------------------------
ALTER TABLE public.channel_sites   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ch_read_sites   ON public.channel_sites;
CREATE POLICY ch_read_sites   ON public.channel_sites   FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS ch_write_sites  ON public.channel_sites;
CREATE POLICY ch_write_sites  ON public.channel_sites   FOR ALL    TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ch_read_items   ON public.channel_items;
CREATE POLICY ch_read_items   ON public.channel_items   FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS ch_write_items  ON public.channel_items;
CREATE POLICY ch_write_items  ON public.channel_items   FOR ALL    TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ch_read_set     ON public.channel_settings;
CREATE POLICY ch_read_set     ON public.channel_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS ch_write_set    ON public.channel_settings;
CREATE POLICY ch_write_set    ON public.channel_settings FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 5. 默认渠道：与打标枚举里的「渠道」词表同口径（SHEIN / TEMU / …）
--    表已有数据时不动（ON CONFLICT DO NOTHING），运营删掉的不会被带回来。
-- ---------------------------------------------------------------------------
INSERT INTO public.channel_sites (name, sort_order) VALUES
  ('SHEIN',       10),
  ('TEMU',        20),
  ('AMAZON',      30),
  ('ALIEXPRESS',  40),
  ('EBAY',        50),
  ('WALMART',     60),
  ('TIKTOK',      70),
  ('PINTEREST',   80),
  ('FACEBOOK',    90),
  ('独立站',       100),
  ('其他',         110)
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- 刷新 PostgREST 结构缓存（否则前端可能仍报「表不存在」）
notify pgrst, 'reload schema';

-- ============================================================================
-- 自检
-- ============================================================================
SELECT
  to_regclass('public.channel_sites')    IS NOT NULL AS "渠道表_应为true",
  to_regclass('public.channel_items')    IS NOT NULL AS "图片表_应为true",
  to_regclass('public.channel_settings') IS NOT NULL AS "设置表_应为true",
  to_regclass('public.rank_image_tags')  IS NOT NULL AS "打标表_应为true",
  (SELECT count(*) FROM public.channel_sites)  AS "渠道数_应为11",
  (SELECT count(*) FROM public.channel_items)  AS "现有图片数";
