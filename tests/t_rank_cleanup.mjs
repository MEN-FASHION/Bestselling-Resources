import fs from 'fs';
import path from 'path';
const root = path.resolve('.');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };

const sb = read('js/supabase.js');
const ar = read('js/admin-rank.js');
const css = read('css/style.css');
const sql = fs.existsSync('sql/patch_20261112U_rank_title.sql') ? read('sql/patch_20261112U_rank_title.sql') : '';

/* 1. 缺列探测 */
ok(/probeRankTitleColumn\s*\(/.test(sb), 'supabase 缺少 probeRankTitleColumn');
ok(/select\("title"\)/.test(sb), '探测应查 title 列');
ok(/missing:\s*true/.test(sb), '探测应能标记缺列');
ok(/checkRankTitleColumn\s*\(/.test(ar), '后台应调用缺列检查');
ok(/榜单表缺少「标题」列/.test(ar), '缺列提示文案缺失');
ok(/title<\/b>|title\b.*text/.test(ar), '缺列提示应给出加列办法');

/* 2. 类目清单 / 删除 / 合并 */
ok(/async listRankCategories\s*\(/.test(sb), '缺少 listRankCategories');
ok(/async deleteRankCategory\s*\(/.test(sb), '缺少 deleteRankCategory');
ok(/async renameRankCategory\s*\(/.test(sb), '缺少 renameRankCategory');
ok(/async listRankCategoryUrls\s*\(/.test(sb), '缺少 listRankCategoryUrls');
const dc = sb.slice(sb.indexOf('async deleteRankCategory'), sb.indexOf('async listRankCategoryUrls'));
ok(/limit\(500\)/.test(dc), '整类删除应分批读取');
ok(/deleteRankItemsByIds/.test(dc), '整类删除应删条目');
ok(/from\("rank_batches"\)/.test(dc), '整类删除应删批次');
const rc = sb.slice(sb.indexOf('async renameRankCategory'), sb.indexOf('probeRankTitleColumn'));
ok(rc.indexOf('_insertRankItemsStrict') < rc.indexOf('deleteRankItemsByIds'), '合并必须先写入新数据、再删原数据');
ok(/exist\.has/.test(rc), '合并应按图片地址跳过重复');
ok(/category:\s*b/.test(rc), '合并应写入目标类目');

/* 3. 后台渲染：勾选批量删除 + 类目清理 */
ok(/rank-batch-pick/.test(ar), '批次行缺少勾选框');
ok(/删除选中/.test(ar), '缺少删除选中按钮');
ok(/ensureBatchToolbar/.test(ar), '缺少批次工具栏');
ok(/openRankCategoryTools/.test(ar), '缺少类目清理面板');
ok(/整类删除/.test(ar), '缺少整类删除按钮');
ok(/合并到…/.test(ar), '缺少合并入口');
ok(/全部条目并入哪个类目/.test(ar), '合并应询问目标类目');
ok(/rank-cat-row/.test(ar), '类目行未渲染');

/* 4. 样式 */
ok(/\.rank-batch-pick/.test(css), '缺少勾选框样式');
ok(/\.rank-cat-tools/.test(css), '缺少类目面板样式');
ok(/\.rkadm-warn/.test(css), '缺少警示条样式');

/* 5. SQL 迁移 */
ok(/add column if not exists title/.test(sql), 'SQL 应幂等地补 title 列');
ok(/rank_items/.test(sql), 'SQL 应作用于 rank_items');

/* 6. 版本戳统一 */
const ver = (read('js/rhythm.js').match(/BUILD\s*=\s*"([^"]+)"/) || [])[1];
ok(!!ver, '未取到 BUILD 版本号');
const pages = ['index.html', 'admin.html', 'rank.html', 'compare.html', 'shein.html', 'pinterest.html', 'trends.html', 'rhythm.html', 'marketing.html', 'fav.html', 'movement.html'];
pages.forEach((p) => {
  const t = read(p);
  const vs = Array.from(t.matchAll(/\?v=([0-9A-Za-z]+)/g)).map((m) => m[1]).filter((v) => /^2026/.test(v));
  ok(vs.every((v) => v === ver), p + ' 版本戳不一致：' + Array.from(new Set(vs)).join(',') + ' ≠ ' + ver);
});

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) process.exit(1);
