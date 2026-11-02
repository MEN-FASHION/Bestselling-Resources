-- ============================================================================
-- patch_20261102A_enum_v11.sql —— 打标枚举升级到总表 v11
--
-- 本次改动（与页面 js/rank-enums.js 配套，缺一不可）：
--   ① 图案拆成三列：图案类型 pattern_tags（87）、图案元素 element_tags（171）、
--      结构部件 struct_tags（20）。v10 把纹样 / 图案内容 / 服装结构件塞在同一列，
--      导出表里分不清「格纹」和「骷髅」是同一层级的东西。
--   ② 新增面料 fabric_tags（57）：图片推测维度，允许留空。
--   ③ 「视觉-背景」全量改成 室内·/室外· 前缀（纯白底这类中性底除外）。
--      第 4 步会把库里的旧值批量改写成新值，避免前台「标签还在但词表里没有」。
--
-- 幂等：可重复执行。不删列、不删数据，只补列 + 改值。
-- 依赖：patch_20261027K（rank_image_tags 表本体）。
-- ============================================================================

-- ---------------------------------------------------------------- 0. 前置自检
-- 连错库时后面全是无用功，先确认这张表在。
do $$
begin
  if to_regclass('public.rank_image_tags') is null then
    raise exception 'public.rank_image_tags 不存在：请先执行 patch_20261027K.sql，或确认当前连接的是站点真正在用的数据库';
  end if;
end $$;

-- ---------------------------------------------------------------- 1. 补三列（榜单/趋势动向/渠道雷达共用）
alter table public.rank_image_tags
  add column if not exists pattern_tags text[] not null default '{}'::text[],
  add column if not exists struct_tags  text[] not null default '{}'::text[],
  add column if not exists fabric_tags  text[] not null default '{}'::text[];

comment on column public.rank_image_tags.pattern_tags is
  '图案类型：纹样/肌理/印花方式（条纹、格纹、花卉、动物纹、民族纹样…）。与图案元素可同时填';
comment on column public.rank_image_tags.struct_tags is
  '结构部件：拉链、口袋、荷叶边等服装上的功能性/装饰性部件；既不是图案也不是工艺';
comment on column public.rank_image_tags.fabric_tags is
  '面料：口头叫法（专业叫法）。图片推测维度，允许留空';

-- ---------------------------------------------------------------- 2. 图库 images 表同步（视觉专区导入用）
do $$
begin
  if to_regclass('public.images') is not null then
    execute 'alter table public.images
      add column if not exists pattern_tags text[] not null default ''{}''::text[],
      add column if not exists struct_tags  text[] not null default ''{}''::text[],
      add column if not exists fabric_tags  text[] not null default ''{}''::text[]';
  end if;
end $$;

-- ---------------------------------------------------------------- 3. GIN 索引（按标签筛图会用到）
create index if not exists idx_rank_image_tags_pattern on public.rank_image_tags using gin (pattern_tags);
create index if not exists idx_rank_image_tags_struct  on public.rank_image_tags using gin (struct_tags);
create index if not exists idx_rank_image_tags_fabric  on public.rank_image_tags using gin (fabric_tags);

-- ---------------------------------------------------------------- 4. 背景旧值 → v11 前缀值（可重复执行）
--   v10 的「家居卧室·床品沙发」在 v11 里叫「室内·家居卧室·床品沙发」。
--   不改写的话，前台标签面板会把老值当成"词表外的历史值"单列一组，
--   导出表也和新口径对不上。这里逐条 array_replace，只替换完全相等的元素。
do $$
declare
  m record;
  n bigint;
  total bigint := 0;
begin
  for m in
    select * from (values
    ('街头·墙面栏杆', '室外·街头·墙面栏杆'),
    ('街拍·人行道', '室外·街拍·人行道'),
    ('巷弄·涂鸦墙', '室外·巷弄·涂鸦墙'),
    ('停车场·车辆', '室外·停车场·车辆'),
    ('草地树林', '室外·草地树林'),
    ('公园·长椅树木', '室外·公园·长椅树木'),
    ('广场·地砖台阶', '室外·广场·地砖台阶'),
    ('园区·楼宇绿化', '室外·园区·楼宇绿化'),
    ('海边·沙滩躺椅', '室外·海边·沙滩躺椅'),
    ('海滩·礁石海浪', '室外·海滩·礁石海浪'),
    ('雪山·雪地', '室外·雪山·雪地'),
    ('雪地·木屋', '室外·雪地·木屋'),
    ('沙漠·沙丘', '室外·沙漠·沙丘'),
    ('山野·岩石溪流', '室外·山野·岩石溪流'),
    ('花田·花丛', '室外·花田·花丛'),
    ('湖畔·木栈道', '室外·湖畔·木栈道'),
    ('篮球场·球架', '室外·篮球场·球架'),
    ('球场·草坪', '室外·球场·草坪'),
    ('球场·看台', '室外·球场·看台'),
    ('跑道·田径场', '室外·跑道·田径场'),
    ('滑板场·坡道', '室外·滑板场·坡道'),
    ('汽车·后备箱行李箱', '室外·交通工具·汽车后备箱'),
    ('天台·城市天际线', '室外·天台·城市天际线'),
    ('泳池边·躺椅', '室外·泳池边·躺椅'),
    ('露营·帐篷篝火', '室外·露营·帐篷篝火'),
    ('市集·摊位货架', '室外·市集·摊位货架'),
    ('建筑外景·外墙', '室外·房屋建筑·外墙'),
    ('砖墙背景', '室外·建筑·红砖墙'),
    ('水泥墙背景', '室内·水泥墙'),
    ('家居卧室·床品沙发', '室内·家居卧室·床品沙发'),
    ('客厅·沙发茶几', '室内·客厅·沙发茶几'),
    ('衣帽间·挂杆衣架', '室内·衣帽间·挂杆衣架'),
    ('浴室·毛巾镜面', '室内·浴室·毛巾镜面'),
    ('玄关·鞋柜挂架', '室内·玄关·鞋柜挂架'),
    ('阳台·绿植晾衣', '室内·阳台·绿植晾衣'),
    ('厨房·厨具台面', '室内·厨房·厨具台面'),
    ('书房·书架书桌', '室内·书房·书架书桌'),
    ('办公室·工位电脑', '室内·办公室·工位电脑'),
    ('办公桌·电脑键盘', '室内·办公桌·电脑键盘'),
    ('教室·课桌黑板', '室内·教室·课桌黑板'),
    ('卫生间·瓷砖镜面', '室内·卫生间·瓷砖镜面'),
    ('咖啡厅·桌椅绿植', '室内·咖啡厅·桌椅绿植'),
    ('餐厅·餐具桌布', '室内·餐厅·餐具桌布'),
    ('商场·橱窗灯光', '室内·商场·橱窗灯光'),
    ('书店·书架', '室内·书店·书架'),
    ('试衣间·镜子挂钩', '室内·试衣间·镜子挂钩'),
    ('健身房·器械镜面', '室内·健身房·器械镜面'),
    ('健身房·瑜伽垫', '室内·健身房·瑜伽垫'),
    ('舞蹈室·镜墙地板', '室内·舞蹈室·镜墙地板'),
    ('艺术展·画框墙面', '室内·艺术展·画框墙面'),
    ('楼梯间·扶手台阶', '室内·楼梯间·扶手台阶'),
    ('地铁站·扶梯', '室内·地铁站·扶梯'),
    ('机场·候机座椅', '室内·机场·候机座椅'),
    ('工厂·车间', '室内·工厂·车间'),
    ('快递拆包台·纸箱', '室内·快递拆包台·纸箱'),
    ('摄影棚·道具地台', '室内·摄影棚·道具地台'),
    ('摄影棚·纯色背景纸', '室内·摄影棚·纯色背景纸'),
    ('摄影棚·布幔', '室内·摄影棚·布幔'),
    ('水泥地板', '室内·水泥地板'),
    ('木质地板', '室内·木质地板'),
    ('纯色墙面', '室内·纯色墙面'),
    ('窗帘窗光', '室内·窗边·窗帘窗光'),
    ('灯光投影墙', '室内·灯光投影墙')
    ) as t(old_v, new_v)
  loop
    update public.rank_image_tags
       set visual_tags = array_replace(visual_tags, m.old_v, m.new_v)
     where m.old_v = any(visual_tags);
    get diagnostics n = row_count;
    total := total + n;

    update public.rank_image_tags
       set scene_tags = array_replace(scene_tags, m.old_v, m.new_v)
     where m.old_v = any(scene_tags);
    get diagnostics n = row_count;
    total := total + n;

    if to_regclass('public.images') is not null then
      execute 'update public.images set scene_tags = array_replace(scene_tags, $1, $2) where $1 = any(scene_tags)'
        using m.old_v, m.new_v;
      get diagnostics n = row_count;
      total := total + n;
    end if;
  end loop;
  raise notice '背景改值完成，共改写 % 行次', total;
end $$;

-- ---------------------------------------------------------------- 4b. 图案旧值分拣（v10 一列 → v11 三列）
--   v10 的「图案元素」里混着纹样（格纹、条纹）和服装结构件（拉链、口袋）。
--   这里把这些值从 element_tags 搬到 pattern_tags / struct_tags，
--   避免前台把「格纹」和「骷髅」显示在同一栏里。搬过的值不会重复追加。
do $$
declare
  m record;
  n bigint;
  total bigint := 0;
begin
  for m in
    select * from (values
      ('纯色/无图案', 'pattern_tags'),
      ('拼色', 'pattern_tags'),
      ('撞色', 'pattern_tags'),
      ('竖条纹', 'pattern_tags'),
      ('横条纹', 'pattern_tags'),
      ('细条纹', 'pattern_tags'),
      ('宽条纹', 'pattern_tags'),
      ('格纹', 'pattern_tags'),
      ('千鸟格', 'pattern_tags'),
      ('威尔士格', 'pattern_tags'),
      ('窗格', 'pattern_tags'),
      ('维希格', 'pattern_tags'),
      ('波点', 'pattern_tags'),
      ('碎花', 'pattern_tags'),
      ('大花/花卉', 'pattern_tags'),
      ('植物叶纹', 'pattern_tags'),
      ('藤蔓', 'pattern_tags'),
      ('豹纹', 'pattern_tags'),
      ('蛇纹', 'pattern_tags'),
      ('斑马纹', 'pattern_tags'),
      ('虎纹', 'pattern_tags'),
      ('奶牛纹', 'pattern_tags'),
      ('鳄鱼纹', 'pattern_tags'),
      ('迷彩', 'pattern_tags'),
      ('几何图案', 'pattern_tags'),
      ('菱格', 'pattern_tags'),
      ('棋盘格', 'pattern_tags'),
      ('人字纹', 'pattern_tags'),
      ('抽象图案', 'pattern_tags'),
      ('涂鸦', 'pattern_tags'),
      ('泼墨', 'pattern_tags'),
      ('扎染', 'pattern_tags'),
      ('晕染/水墨', 'pattern_tags'),
      ('渐变', 'pattern_tags'),
      ('满印', 'pattern_tags'),
      ('定位印花', 'pattern_tags'),
      ('局部印花', 'pattern_tags'),
      ('拉链', 'struct_tags'),
      ('抽绳', 'struct_tags'),
      ('口袋', 'struct_tags'),
      ('工装口袋', 'struct_tags'),
      ('贴袋', 'struct_tags'),
      ('荷叶边', 'struct_tags'),
      ('蕾丝', 'struct_tags'),
      ('镂空', 'struct_tags'),
      ('绑带', 'struct_tags'),
      ('开衩', 'struct_tags'),
      ('双层', 'struct_tags'),
      ('翻边', 'struct_tags'),
      ('腰带', 'struct_tags'),
      ('金属扣件', 'struct_tags'),
      ('织带', 'struct_tags'),
      ('肩章', 'struct_tags'),
      ('臂章', 'struct_tags'),
      ('反光条', 'struct_tags'),
      ('褶皱', 'struct_tags'),
      ('口袋盖', 'struct_tags')
    ) as t(v, target)
  loop
    if m.target = 'pattern_tags' then
      update public.rank_image_tags
         set pattern_tags = case when m.v = any(pattern_tags) then pattern_tags
                                 else array_append(pattern_tags, m.v) end,
             element_tags = array_remove(element_tags, m.v)
       where m.v = any(element_tags);
      get diagnostics n = row_count;
      total := total + n;
    else
      update public.rank_image_tags
         set struct_tags = case when m.v = any(struct_tags) then struct_tags
                                else array_append(struct_tags, m.v) end,
             element_tags = array_remove(element_tags, m.v)
       where m.v = any(element_tags);
      get diagnostics n = row_count;
      total := total + n;
    end if;
  end loop;
  raise notice '图案旧值分拣完成，共改写 % 行次', total;
end $$;

-- ---------------------------------------------------------------- 5. 核对
--   三列应当都在；取值分布可以顺手看一眼是否为空（新维度没打过标就是 0）。
select
  count(*)                                                        as "总行数",
  count(*) filter (where array_length(pattern_tags, 1) > 0)        as "图案类型已填",
  count(*) filter (where array_length(struct_tags, 1) > 0)         as "结构部件已填",
  count(*) filter (where array_length(fabric_tags, 1) > 0)         as "面料已填",
  count(*) filter (where array_length(visual_tags, 1) > 0)         as "视觉已填"
from public.rank_image_tags;
