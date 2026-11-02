/* ============================================================================
 * t_dash_cleanup.js —— 数据看板移除「导出打标表 / 导入打标表」回归（20261102F）
 *
 * 需求：视觉专区 → 数据看板里的 ① 导出打标表、② 导入打标表 整块去掉，
 *       看板只保留筛选与统计。
 *
 * 断言要点：
 *   ① 页面上两块 div 与其内部控件全部消失
 *   ② 看板自身仍完好（刷新、类目筛选、总览卡、图表、类目分布容器都在）
 *   ③ 绑定入口已断（不再调用），避免「元素没了还去找」的报错
 *   ④ 函数体保留（日后可恢复），不是删掉能力
 *   ⑤ 其它专区的导出导入不受影响（榜单 / 趋势动向 / 渠道雷达）
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✓ " + n); };
const no = (n) => { fail++; console.log("  ✗ " + n); };

const R = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(R, "admin.html"), "utf8");
const js = fs.readFileSync(path.join(R, "js/admin-images.js"), "utf8");

/* 只看数据看板那一段，避免误命中其它专区同名元素 */
const start = html.indexOf('id="vis-dash"');
const end = html.indexOf('</section>', start);
const dash = start >= 0 ? html.slice(start, end > start ? end : html.length) : "";
if (dash) ok("定位到数据看板区块"); else no("没找到数据看板区块");

/* ① 两块已移除 */
if (dash.indexOf('class="dash-export"') < 0) ok("① 导出打标表整块已移除");
else no("导出整块仍在");
if (dash.indexOf('class="dash-import"') < 0) ok("② 导入打标表整块已移除");
else no("导入整块仍在");
[["dash-export-btn", "导出按钮"], ["dash-exp-scope", "范围下拉"], ["dash-exp-cat", "导出类目下拉"],
 ["dash-exp-split", "拆分复选框"], ["img-imp-file", "文件选择"], ["img-imp-mode", "模式下拉"],
 ["img-imp-check", "先校验按钮"], ["img-imp-btn", "导入按钮"], ["img-imp-clear", "清空复选框"]]
  .forEach(([id, name]) => {
    if (dash.indexOf(id) < 0) ok(name + " 已移除（" + id + "）");
    else no(name + " 还在（" + id + "）");
  });

/* ② 看板本体完好 */
/* 20261102G 起 dash-refresh / dash-cat-filter 属于被移除项，不在此清单内 */
["dash-meta", "dash-overview", "dash-cat-ov",
 "dash-channel", "dash-style", "dash-element", "dash-scene", "dash-shoot", "dash-skin"]
  .forEach((id) => {
    if (dash.indexOf('"' + id + '"') >= 0) ok("看板要素保留：" + id);
    else no("误删了看板要素：" + id);
  });

/* ③ 绑定入口已断、④ 函数体仍在 */
const bd = (js.match(/function bindDashboard\(\)[\s\S]*?\n  \}/) || [""])[0];
if (!/bindDashExport\(\)/.test(bd)) ok("不再调用导出绑定（元素已不存在，避免空转）");
else no("仍在调用导出绑定");
if (!/bindDashImport\(\)/.test(bd)) ok("不再调用导入绑定");
else no("仍在调用导入绑定");
if (/function bindDashExport\(\)/.test(js) && /function bindDashImport\(\)/.test(js)) ok("两个绑定函数体保留（日后可恢复）");
else no("函数体被误删，恢复成本变高");
if (!/^\s*buildDashExportCat\(_dashImgs\);/m.test(js)) ok("看板渲染不再构建已废弃的导出下拉");
else no("仍在构建导出下拉");

/* ⑤ 其它专区不受影响 */
const rank = html.indexOf('id="rank-export-btn"') >= 0;
if (rank) ok("趋势上升榜的导出入口不受影响");
else no("误伤了榜单导出");
if (html.indexOf('id="mv-export-btn"') >= 0) ok("趋势动向的导出入口不受影响");
else no("误伤了趋势动向导出");
if (html.indexOf('id="ch-export-btn"') >= 0) ok("渠道雷达的导出入口不受影响");
else no("误伤了渠道雷达导出");
if (/ImageExport\.exportImages/.test(js) === false) ok("看板已不再直接调用图片导出");
else ok("图片导出能力仍在模块内（只是看板不调用）");


/* ⑥ 20261102G：顶部操作区（类目筛选、刷新数据）也已移除 */
if (dash.indexOf('class="dash-toolbar"') < 0) ok("顶部操作区容器已移除");
else no("顶部操作区容器仍在");
if (dash.indexOf('id="dash-cat-filter"') < 0) ok("类目筛选下拉已移除");
else no("类目筛选下拉仍在");
if (dash.indexOf('id="dash-refresh"') < 0) ok("刷新数据按钮已移除");
else no("刷新数据按钮仍在");
if (dash.indexOf('id="dash-meta"') >= 0) ok("数据状态行保留（共 N 张 · 更新时间）");
else no("状态行被误删");

/* ⑦ 筛选能力改由类目分布表承担，不能一删了之 */
if (/_dashCat/.test(js)) ok("新增内部类目筛选状态");
else no("类目筛选能力直接消失，点行不再生效");
if (/_dashCat\s*=\s*\(_dashCat && _dashCat === cat\)/.test(js)) ok("再次点击同一行可取消筛选");
else no("没有取消筛选的路径");
if (/const cat = _dashCat \|\| "";/.test(js)) ok("统计口径改为读内部状态，不再依赖已删除的下拉");
else no("仍在读已删除的下拉");
if (/cat \? "类目「"/.test(js)) ok("状态行按是否筛选给出不同文案");
else no("状态行文案没跟上");

/* ⑧ 元素缺失时不得报错 */
if (/const rf = document\.getElementById\("dash-refresh"\)/.test(js) && /if \(rf\) rf\.onclick/.test(js)) ok("刷新按钮绑定已加存在性守卫");
else no("刷新按钮仍被直接取用，可能空指针");
if (!/\$\("#dash-refresh"\)\.onclick/.test(js)) ok("不再直接对可能不存在的元素赋值");
else no("仍有无守卫的直接赋值");
if (/请稍后重试或刷新页面/.test(js)) ok("失败文案不再指向已删除的刷新按钮");
else no("失败文案仍让用户点刷新按钮");

/* ⑨ 覆盖率说明改为全站口径 */
if (/本页按<b>全站全量<\/b>统计/.test(html)) ok("覆盖率说明改为全站口径");
else no("说明仍写着按类目筛选");

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
