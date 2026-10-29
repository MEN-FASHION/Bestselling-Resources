-- ============================================================
-- 诊断：图片表到底叫什么、在哪个 schema
--
-- 为什么需要这个：
--   补列脚本报 42P01「relation 不存在」——说明当前连接的库里，
--   public 底下没有名为 images 的表。
--   可能是：① 图片表建在别的 schema；② 表名不是 images；
--           ③ 当前 SQL Editor 连的不是站点正在用的那个库。
--   先查清楚，再决定补列怎么改，不要盲目改表名。
--
-- 只做查询，不改任何数据，可放心执行。
-- ============================================================

-- ---------- 1) 当前连的是哪个库、哪个 schema ----------
select current_database()  as 当前库,
       current_schema()    as 当前schema,
       current_user        as 当前用户;

-- ---------- 2) 全库找「名字像图片表」的表 ----------
-- 期望：能看到站点真正用的那张图片表，记下它的 schema 和表名
select table_schema  as schema名,
       table_name    as 表名
from information_schema.tables
where table_type = 'BASE TABLE'
  and (table_name ilike '%image%'
       or table_name ilike '%pic%'
       or table_name ilike '%photo%')
order by table_schema, table_name;

-- ---------- 3) public 下所有表（看看实际结构） ----------
-- 如果第 2 步没找到图片表，用这个清单人工认一下
select table_name as public下的表
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_name;

-- ---------- 4) 如果上面找到了图片表，替换表名再跑这一段 ----------
-- 作用：看它现在有哪些标签列，确认缺的是不是只有那三列
-- 把下面 two 处 <图片表> 换成第 2 步查到的「schema名.表名」，例如 public.images
/*
select column_name  as 列名,
       data_type    as 类型
from information_schema.columns
where table_schema = '<schema名>'
  and table_name   = '<表名>'
order by ordinal_position;
*/