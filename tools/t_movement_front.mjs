/* 趋势动向前后台连通校验：注册 → 授权 → 前台可见 → 前台取数 */
import fs from 'fs';
const R = { pass: 0, fail: 0, msgs: [] };
const ok = (c, m) => c ? R.pass++ : (R.fail++, R.msgs.push(m));
const rd = f => fs.readFileSync(f, 'utf8');

const cfg = rd('js/config.js'), adm = rd('js/admin.js'), perm = rd('js/admin-perm.js');
const fh = rd('movement.html'), fj = rd('js/movement-front.js'), css = rd('css/style.css');
const sb = rd('js/supabase.js'), cm = rd('js/common.js');

// 1. 专区注册带前台链接（否则前台菜单不注入）
ok(/\{ key: "movement",\s*label: "趋势动向",\s*href: "movement\.html" \}/.test(cfg), 'config 里 movement 缺前台链接');

// 2. 后台归属专区
ok(/movement-card": "movement"/.test(adm), '面板未归属 movement 专区');
ok(/key: "movement", label: "趋势动向"/.test(perm), '权限面板缺 movement');

// 3. 类目授权覆盖
ok(/"movement"\]/.test(perm), '类目授权未覆盖 movement');

// 4. 前台页结构
ok(/id="mv-cats"/.test(fh) && /id="mv-body"/.test(fh), '前台页缺容器');
ok(/id="mv-modal"/.test(fh), '前台页缺大图面板');
ok(/rank-enums\.js/.test(fh), '前台页未引入枚举');
ok(/movement-front\.js/.test(fh), '前台页未引入脚本');

// 5. 前台只读取，不得有写操作
ok(!/saveMovementTags|uploadMovementImages|deleteMovementItem/.test(fj), '前台页出现了写操作');
ok(/listMovementItems/.test(fj) && /listMovementTags/.test(fj), '前台页未接读取接口');

// 6. 标签按维度分组展示
['风格','视觉','图案元素','二次工艺','拍摄方式','模特','版型','文化背景','消费心理','渠道','节日']
  .forEach(k => ok(fj.includes(k), '前台分组缺 ' + k));

// 7. 导航注入依赖 href 非空
ok(/if \(!d\.href \|\| !d\.label \|\| used\[d\.key\]\) return;/.test(cm), '公共导航注入逻辑已变，需复核');

// 8. 样式齐备
['mv-card', 'mv-modal', 'mv-tag-row', 'mv-chip'].forEach(k => ok(css.includes('.' + k), '缺样式 .' + k));

// 9. 版本号统一
const pages = ['admin.html','rank.html','plus.html','marketing.html','trends.html','index.html','fav.html','movement.html'];
pages.forEach(p => {
  const s = rd(p);
  ok(!/v=2026103(0A|0B)/.test(s), p + ' 版本号未同步到 C');
});

// 10. 读取接口存在
ok(/async listMovementItems/.test(sb) && /async listMovementTags/.test(sb), '数据层接口缺失');

console.log(JSON.stringify(R, null, 2));
process.exit(R.fail ? 1 : 0);
