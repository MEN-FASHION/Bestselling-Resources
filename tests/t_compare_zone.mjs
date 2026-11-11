/* 20261111X · 渠道对比（多渠道图片多列并排）
 * 覆盖：
 *  1) 前台页存在：左侧类目与趋势上升榜一致，上方只筛月度
 *  2) 多列布局复用趋势上升榜的池子结构（不另起一套）
 *  3) 数据来自「上新节奏（月度榜单）」+「各渠道图」，渠道自动发现，新增渠道不用改代码
 *  4) 列配置存 frontend_dims.compare_sources（不改表结构），后台可配顺序/名称/空列/每行张数
 *  5) 只读页：前台没有任何写操作
 *  6) 专区定义、权限清单、各页导航、专区开关都补齐
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

/* ---------- 1. 前台页 ---------- */
ok(fs.existsSync(path.join(ROOT, "compare.html")), "compare.html 缺失");
const H = read("compare.html");
ok(H.includes('class="sidebar"') && H.includes("服装类目"), "左侧菜单应与趋势上升榜一致（服装类目）");
ok(H.includes('id="cmp-cats"'), "缺少类目菜单容器");
ok(H.includes('class="tag-filter"') && H.includes('id="cmp-groups"'), "缺少筛选栏");
ok(!/国家站点|周次/.test(H), "顶部筛选项只应保留月度，不应出现国家/周次");
ok(H.includes("compare-front.js"), "未引用前台脚本");
ok(H.includes('href="compare.html" class="tab-link active"'), "自身菜单项未高亮");
ok(H.includes("vendor/supabase.js"), "缺少登录依赖");

/* ---------- 2. 多列布局复用 ---------- */
const F = read("js/compare-front.js");
ok(/class="rk-pools"/.test(F), "多列容器应复用 rk-pools");
ok(/rk-pool-head/.test(F) && /rk-pool-grid/.test(F) && /rk-card/.test(F), "列头 / 图格 / 卡片应复用榜单结构");
ok(/--rk-r:/.test(F), "每列每行张数应通过 --rk-r 控制（与榜单同机制）");
ok(/ALL = "全部"/.test(F), "类目菜单应含「全部」（与榜单一致）");

/* ---------- 3. 数据来源 ---------- */
ok(/listRankChannelPics\(\{\s*periodType:\s*"month"/.test(F), "渠道图应按月度读取");
ok(/listRankItems\(\{[\s\S]{0,120}periodType:\s*"month"/.test(F), "上新节奏应按月度榜单读取");
ok(/chUrls/.test(F), "榜单行与渠道图重复的地址要去重，避免同一张图出现两次");
ok(/defaultSources/.test(F), "未配置时应自动发现渠道列（新增渠道不用改代码）");
ok(/listMovementTags|listImageTags/.test(F), "打标结果按图片地址读取");

/* ---------- 4. 只读 ---------- */
ok(!/uploadRankChannel|deleteRankChannel|saveMovementTags|updateRankChannelItem/.test(F), "前台是只读页，不应有写操作");

/* ---------- 5. 数据层 ---------- */
const D = read("js/supabase.js");
ok(/getCompareSources\(/.test(D) && /setCompareSources\(/.test(D), "数据层缺少对比列配置读写");
ok(/compare_sources/.test(D), "配置应存 frontend_dims.compare_sources（不改表结构）");
ok(!/create table[^;]*compare/i.test(D), "不应为此新建数据表");

/* ---------- 6. 后台 ---------- */
const A = read("admin.html");
ok(A.includes('id="compare-card"'), "后台缺少渠道对比面板");
ok(/data-target="compare-card"/.test(A), "后台侧栏缺少渠道对比入口");
ok(A.includes("admin-compare.js"), "后台未引用渠道对比脚本");
const AC = read("js/admin-compare.js");
ok(/setCompareSources/.test(AC), "后台应能保存列配置");
ok(/cmpa-up|cmpa-down/.test(AC), "后台应能调整列顺序");
ok(/showEmpty/.test(AC) && /perRow/.test(AC), "后台应能配置空列与每行张数");

/* ---------- 7. 专区定义 / 权限 / 导航 ---------- */
ok(/key:\s*"compare",\s*label:\s*"渠道对比",\s*href:\s*"compare\.html"/.test(read("js/config.js")), "专区定义缺少渠道对比");
const perm = read("js/admin-perm.js");
ok(/key:\s*"compare",\s*label:\s*"渠道对比"/.test(perm), "权限勾选应含渠道对比");
ok(/ALL_CAT_ZONES\s*=\s*\[[^\]]*"compare"/.test(perm), "类目授权应覆盖 compare");
ok(/渠道对比 \(compare\.html\)/.test(perm), "专区管理的前台链接预设应含渠道对比");
ok(/"compare-card":\s*"compare"/.test(read("js/admin.js")), "PANEL_ZONE 未绑定 compare");
ok(/key:\s*"compare",\s*label:\s*"渠道对比",\s*href:\s*"compare\.html"/.test(read("js/admin.js")), "前台访问设置应可开关渠道对比");

const navPages = ["index.html", "rank.html", "rhythm.html", "plus.html", "trends.html", "marketing.html", "fav.html", "movement.html", "pinterest.html", "shein.html"];
for (const f of navPages) ok(read(f).includes('href="compare.html"'), `${f} 顶部菜单缺少渠道对比入口`);

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
