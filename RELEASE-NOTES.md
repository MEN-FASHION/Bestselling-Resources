# 20261030A —— 下线视觉专区批量上传，新建「趋势动向」专区

## 一句话
视觉专区的批量上传去掉了；趋势动向作为独立专区上线，结构与「趋势上升榜」
完全一致，可以批量传图 + 批量打标 + 导入导出。

## 一、视觉专区：批量上传下线
起因：上传和打标原来绑在同一个弹窗（智能打标）里。这带来两个麻烦：
  · 图片本体（谁传的、类目）和打标数据（全组共享的标签）混在一起，
    批量导入要写别人上传的图，撞上「只能改自己上传的」策略 → 存不进去；
  · 每加一个打标维度就要动图片表，补丁没跑或跑错库，导入整表 400。

处理：弹窗里的上传入口卡片去掉，只留纯打标能力。
      原上传代码（smartPick / doSmartUpload 等）保留未删，
      日后要恢复只需去掉 admin-smart.js 里那行 return。

## 二、趋势动向：新专区
结构与榜单一致：
    movement_items  → 图片本体：image_url / path / category / title / batch_id
    rank_image_tags → 打标数据：image_url 唯一，与榜单共用同一张表

好处：
  · 批量传图不影响图片本体与标签的边界
  · 打标维度只认 rank_image_tags，再加维度不用动图片表
  · 导出/导入沿用榜单那套列与校验，两个专区口径一致

页面能力：
  · 拖拽或点选多张图片 → 选类目 → 批量上传（逐张回显进度，失败不中断）
  · 左侧按类目分组，右侧网格；卡片只显示打标进度，不铺标签内容
  · 点图打开打标面板：左侧大图固定，右侧按维度分组（风格/视觉/图案元素/
    二次工艺/拍摄方式/模特/版型/文化背景/消费心理/渠道/节日），逐项下拉选择
  · 导出打标表 / 导入打标表（导入只写本次有值的格子，空单元格不覆盖）

## 三、枚举
打标维度与榜单同一份来源（js/rank-enums.js），新增维度只改这一处，两个专区同时生效。
渠道枚举此前误设为托管模式（半托管/全托管…），已改为货源平台：
    SHEIN / TEMU / PINTEREST / ALIEXPRESS / AMAZON / FACEBOOK /
    TIKTOK / EBAY / WALMART / 独立站 / 其他
后台「标签管理」里手工加的标签会自动并入枚举，不会出现「能选但导入判未识别」。

## 四、数据库
tools/patch_20261030A_movement.sql（幂等，可重复执行，不删不改既有数据）
  1. 建 movement_items + 唯一索引（同一张图只登记一次）
  2. 行级权限：登录可读，写入需登录身份
  3. rank_image_tags 兜底建表；老库缺 culture_tags/psych_tags/festival_tags 时补齐
末段带自检：图片表列数应为 6、新增维度应为 3。

## 五、文件清单
新增
  js/admin-movement.js                       趋势动向全部前端逻辑
  tools/patch_20261030A_movement.sql         建表与补列
  tools/t_movement.mjs                       结构校验（30 项）

改动
  admin.html            新增趋势动向面板 + 打标弹窗 + 导航入口
  js/supabase.js        新增 listMovementItems / uploadMovementImages /
                        saveMovementTags / listMovementTags / deleteMovementItem
  js/admin-smart.js     关闭视觉专区的上传入口（逻辑保留）
  js/admin.js           PANEL_ZONE 登记 + 面板切换时加载数据
  css/style.css         趋势动向样式（上传区/网格/打标面板）
  js/rank-enums.js      渠道枚举改为平台

## 六、部署
1. 数据库执行 tools/patch_20261030A_movement.sql，看自检两项
2. 上传整包并重新部署 Worker（不重新部署，页面可打开但接口不通）
3. 强制刷新后台（Ctrl+F5）
4. 进入「趋势动向」→ 选类目 → 传图 → 点图打标
