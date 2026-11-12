/* 20261112B · 渠道图片专区的删除与批量编辑
 * 覆盖：
 *  1) 单张删除 / 整行删除 / 批量删除三个入口都在（原来只有打标弹层里能删）
 *  2) 批量删除走数据层批接口：文档存储与 rank_items 两条都要照顾，且分块发请求
 *  3) 删除不连带删打标记录（打标按图片地址存，删图后记录保留）
 *  4) 批量编辑只改填写的字段：留空 = 不动（不能顺手把类目清空）
 *  5) 批量编辑支持 月份 / 上传日期 / 类目 / 渠道名，上传日期写对位置
 *  6) 删除与批量编辑都受专区权限守卫，且都要二次确认
 *  7) 勾选状态：全选本屏、取消选择、计数与按钮禁用态同步
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

const AD = read("js/admin-channelzone.js");
const DB = read("js/supabase.js");

/* ---------- 1. 三个删除入口 ---------- */
ok(/cz-card-del/.test(AD), "卡片上缺少单张删除按钮（列表里无法直接删）");
/* 20261112B：类目组那个按钮其实是「清空该类目」（=全部），
   真正的「一行」由视觉行行尾的「删此行」承担，两个功能分开。 */
ok(/delRow\.textContent\s*=\s*"清空该类目（"/.test(AD), "缺少「清空该类目」按钮");
ok(/cz-vrow-del/.test(AD) && /删此行/.test(AD), "缺少「删此行」（按视觉行删除）按钮");
ok(/vcolsOf/.test(AD), "缺少列数计算：一行几张要和实际栅格一致");
ok(/id="' \+ id\(k, "del-sel"\) \+ '"/.test(AD) || /"del-sel"/.test(AD), "工具栏缺少批量删除按钮");
ok(/id="' \+ id\(k, "batch-edit"\)/.test(AD) || /"batch-edit"/.test(AD), "工具栏缺少批量编辑按钮");
ok(/function delMany\(k, ids, what\)/.test(AD), "缺少统一删除函数（三个入口应共用同一条路径）");
ok(/delMany\(k, \[r\.id\]/.test(AD), "单张删除应复用批量删除通道");
ok(/delMany\(k, g\.items\.map/.test(AD), "整行删除应复用批量删除通道");
ok(/delMany\(k, ids, "选中的 "/.test(AD), "批量删除应把选中项交给同一通道");

/* ---------- 2. 数据层批接口 ---------- */
ok(/API\.deleteRankChannelItems\s*=\s*async function/.test(DB), "数据层缺少批量删除接口");
ok(/API\.updateRankChannelItems\s*=\s*async function/.test(DB), "数据层缺少批量修改接口");
const delBlock = DB.slice(DB.indexOf("API.deleteRankChannelItems"), DB.indexOf("API.updateRankChannelItems"));
ok(/isCpId\(id\)/.test(delBlock) && /urls\.push/.test(delBlock), "批量删除要区分文档存储的图");
ok(/\.in\("id", part\)/.test(delBlock), "批量删除要按 id 批量删，不能一张一张删");
ok(/CHUNK\s*=\s*80/.test(delBlock), "批量删除要分块（in 列表过长会被网关截断）");
ok(/count:\s*"exact"/.test(delBlock), "批量删除要拿真实删除条数，不能按提交条数假装成功");
ok(/failed\.push/.test(delBlock), "批量删除要逐条记录失败原因");

/* 文档存储：一次读、一次写，不逐张写（避免写一半失败） */
ok((delBlock.match(/chPicSave\(/g) || []).length === 1, "文档存储应一次写回，不能逐张写");

/* ---------- 3. 不连带删打标记录 ---------- */
ok(!/rank_image_tags/.test(delBlock), "删除渠道图不应动打标表（打标按图片地址保留）");
ok(/打标记录会保留/.test(AD), "确认框应说明打标记录保留");

/* ---------- 4/5. 批量编辑只改填写的字段 ---------- */
const upBlock = DB.slice(DB.indexOf("API.updateRankChannelItems"), DB.indexOf("API.deleteRankChannelItems") > DB.indexOf("API.updateRankChannelItems") ? DB.indexOf("API.updateRankChannelItems") + 4000 : DB.length);
ok(/const has = \(k\) =>/.test(upBlock), "批量修改应用 has() 判断字段是否填写，留空即不改");
ok(/!has\("channel"\) && !has\("category"\) && !has\("period_label"\) && !has\("uploaded"\)/.test(upBlock),
  "一个字段都没填时应直接返回，不做任何写入");
ok(!/o2\.category\s*=\s*String\(p\.category \|\| ""\)/.test(upBlock), "类目不能用 p.category || '' 兜底（会把留空当成清空）");
ok(/if \(has\("uploaded"\)\)\s*x\.t\s*=/.test(upBlock), "文档存储的上传日期应写 t 字段（列表就是读它）");
ok(/created_at\s*=\s*new Date\(d\[0\], d\[1\] - 1, d\[2\], 12, 0, 0\)/.test(upBlock),
  "库里的上传日期应取当天中午换算，避免时区把日期推前一天");
ok(/\.in\("id", part\)/.test(upBlock), "库里的批量修改应按 id 批量更新");

/* 面板侧：四个字段都在，且空值不提交 */
ok(/batch-month/.test(AD) && /batch-date/.test(AD) && /batch-cat/.test(AD) && /batch-ch/.test(AD),
  "批量编辑弹窗缺少字段（月份 / 上传日期 / 类目 / 渠道名）");
ok(/if \(mo\) patch\.period_label = mo;/.test(AD) && /if \(dt\) patch\.uploaded = dt;/.test(AD) &&
   /if \(ca\) patch\.category = ca;/.test(AD) && /if \(ch\) patch\.channel = ch;/.test(AD),
  "空值不应提交（否则会把原值覆盖成空）");
ok(/没有填写任何要改的字段/.test(AD), "全空提交时应提示，而不是静默无反应");
ok(/list="' \+ id\(k, "batch-cat-list"\)/.test(AD) || /batch-cat-list/.test(AD), "类目应可输入新类目（带候选）");

/* 上传日期可见：列表里能看出来，才谈得上批量改 */
ok(/uploaded:\s*String\(r\.created_at \|\| r\.t \|\| ""\)\.slice\(0, 10\)/.test(AD), "列表未读取上传日期");
ok(/cz-up/.test(AD) && /上传 ' \+ esc\(r\.uploaded\)/.test(AD), "卡片未展示上传日期");
ok(/t: new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(DB), "新上传的图应记下上传日期");

/* ---------- 6. 权限守卫与二次确认 ---------- */
const delFn = AD.slice(AD.indexOf("async function delMany"), AD.indexOf("async function delMany") + 1400);
ok(/guardZone/.test(delFn), "批量删除必须走专区权限守卫");
/* 20261112B：不再用浏览器原生 confirm，改为站内弹窗 uiConfirm（仍是二次确认） */
ok(/await uiConfirm\(/.test(delFn), "删除必须二次确认（站内弹窗）");
const batchFn = AD.slice(AD.indexOf("async function applyBatch"), AD.indexOf("async function applyBatch") + 2200);
ok(/guardZone/.test(batchFn), "批量编辑必须走专区权限守卫");
ok(/await uiConfirm\(/.test(batchFn), "批量编辑必须二次确认，并列出将要改成什么");
ok(/专区的图/.test(batchFn) || /where/.test(batchFn) || /what\.push/.test(batchFn), "确认框应说明改哪些字段");
ok(/数据层版本偏旧/.test(delFn), "接口缺失时应提示强刷，而不是静默失败");

/* ---------- 7. 勾选状态 ---------- */
ok(/sel:\s*\{\}/.test(AD), "面板状态缺少选择集合");
ok(/function selIds\(k\)/.test(AD), "缺少选中项读取（且要过滤掉已不存在的图）");
ok(/st\.items\.some\(function \(r\) \{ return String\(r\.id\) === id; \}\)/.test(AD), "选中项应只保留仍存在的图");
ok(/sel-all/.test(AD) && /全选本屏/.test(AD), "缺少「全选本屏」");
ok(/sel-none/.test(AD) && /取消选择/.test(AD), "缺少「取消选择」");
ok(/del\.textContent = "删除选中（" \+ n \+ "）"/.test(AD), "删除按钮应带上选中数量");
ok(/del\.disabled = !n/.test(AD) && /be\.disabled = !n/.test(AD), "未选中时批量按钮应禁用");

/* 勾选只做局部同步，不重建图墙（几百张图重建会闪） */
ok(/function syncPickUI\(k\)/.test(AD), "缺少勾选局部同步函数");
ok(/pick\.onclick = function \(e\) \{[\s\S]{0,220}syncPickUI\(k\);/.test(AD), "卡片勾选后应走局部同步，而不是重建图墙");
ok(/cbx\.onclick = function \(e\) \{[\s\S]{0,300}syncPickUI\(k\);/.test(AD), "行勾选后应走局部同步");
ok(!/cbx\.checked[\s\S]{0,80}renderGrid\(k\)/.test(AD), "行勾选不应触发整屏重建");
ok(/replace\(\/　·　已选 \\d\+ 张\/g, ""\)/.test(AD), "取消选择后要清掉计数残字");

/* 勾选框和卡片点击不能互相触发（否则一勾选就弹打标窗） */
ok(/pick\.onclick = function \(e\) \{\s*e\.stopPropagation\(\);/.test(AD), "勾选框必须阻止冒泡");
ok(/del\.onclick = function \(e\) \{\s*e\.stopPropagation\(\);/.test(AD), "卡片删除按钮必须阻止冒泡");

/* 成行分组：一行一个类目，行头才有整行删除 */
ok(/function renderGrid\(k\)/.test(AD) && /groups = \[\{ cat: st\.curCat/.test(AD), "未按类目成行，整行删除无从下手");
ok(/cz-rows/.test(AD), "网格容器需切换成行式布局（否则行会被当成格子排开）");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
