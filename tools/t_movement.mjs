/* 趋势动向专区结构校验：确认上传/打标/导出/导入四段链路各自落点正确 */
import fs from 'fs';
const R = { pass: 0, fail: 0, msgs: [] };
function ok(c, m) { if (c) { R.pass++; } else { R.fail++; R.msgs.push(m); } }

const sb = fs.readFileSync('js/supabase.js', 'utf8');
const mv = fs.readFileSync('js/admin-movement.js', 'utf8');
const adm = fs.readFileSync('admin.html', 'utf8');
const sm = fs.readFileSync('js/admin-smart.js', 'utf8');
const sql = fs.readFileSync('tools/patch_20261030A_movement.sql', 'utf8');

// 1. 图片本体表存在且字段齐
ok(/CREATE TABLE IF NOT EXISTS public\.movement_items/.test(sql), 'movement_items 建表缺失');
['image_url', 'path', 'category', 'title', 'batch_id', 'created_at'].forEach(f =>
  ok(sql.includes(f), 'movement_items 缺字段 ' + f));
ok(/UNIQUE INDEX IF NOT EXISTS ux_movement_items_url/.test(sql), '图片地址唯一索引缺失');

// 2. 打标表兜底 + 三列
ok(/CREATE TABLE IF NOT EXISTS public\.rank_image_tags/.test(sql), '标签表兜底缺失');
['culture_tags', 'psych_tags', 'festival_tags'].forEach(f =>
  ok(new RegExp('ADD COLUMN IF NOT EXISTS ' + f).test(sql), '缺补列 ' + f));
ok(!/public\.images/.test(sql), '不应再给 images 补列（结构已分离）');

// 3. 数据层落点
ok(/from\("movement_items"\)/.test(sb), '未接 movement_items');
ok(/insert\(\{\s*image_url/.test(sb), '上传写库缺 image_url');
ok(/_upsertTagsByUrl/.test(sb), '打标未走标签表');
ok(/listMovementTags[\s\S]{0,120}listRankTagRows/.test(sb), '打标读取未复用榜单口径');

// 4. 前端面板
ok(/id="movement-card"/.test(adm), '页面缺趋势动向面板');
ok(/id="mv-tag-modal"/.test(adm), '页面缺打标弹窗');
ok(/data-target="movement-card"/.test(adm), '导航缺入口');
ok(/admin-movement\.js/.test(adm), '未引入脚本');

// 5. 视觉专区批量上传已下线
ok(/smart-up-entry[\s\S]{0,200}return;/.test(sm) || /不再提供批量上传/.test(sm), '视觉专区上传入口未关闭');

// 6. 导出补列
['模特', '渠道', '腰型'].forEach(k => ok(mv.includes('"' + k + '"'), '导出缺补列 ' + k));

// 7. 导入按中文维度映射
ok(/function recToPatch/.test(mv), '导入缺维度映射');
['culture_tags', 'psych_tags', 'festival_tags'].forEach(k => ok(mv.includes(k), '导入漏 ' + k));

// 8. 枚举来源唯一
ok(/window\.APP_ENUM/.test(mv), '前端未读统一枚举');

console.log(JSON.stringify(R, null, 2));
process.exit(R.fail ? 1 : 0);
