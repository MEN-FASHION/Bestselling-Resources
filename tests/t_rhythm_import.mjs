/* 月度「导入打标结果」（20261109F）
   出口有了，入口也得在同一个面板里，而且要保证：
     ① 只有一套导入实现（不复制 800 行），月度调的是同一份 parseBook / applyPlan
     ② 月度只把月度条目算"能对上"，误传周度表不会写错
     ③ 界面状态齐全：模式切换、清空开关、未选文件时按钮不可点
     ④ 写入后刷新渠道列表与导出下拉（否则刚写的标签看起来没生效）
*/
import fs from "fs";
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };
const R = (p) => fs.readFileSync(p, "utf8");

const A = R("admin.html");
const AR = R("js/admin-rhythm.js");
const AI = R("js/admin-rankimport.js");
const S = R("js/supabase.js");

console.log("一、界面");
ok("月度面板有「导入月度打标结果」区块", /h4>导入月度打标结果/.test(A));
["rm-tag-imp-mode", "rm-tag-imp-clear-empty", "rm-tag-imp-file", "rm-tag-imp-btn", "rm-tag-imp-tip"].forEach((id) => {
  ok("控件存在：" + id, A.indexOf('id="' + id + '"') >= 0);
});
ok("默认补齐模式", /id="rm-tag-imp-mode"[\s\S]{0,120}value="fill" selected/.test(A));
ok("清空开关默认禁用（只有覆盖模式才开）", /id="rm-tag-imp-clear-empty" type="checkbox" disabled/.test(A));
ok("按钮默认不可点", /id="rm-tag-imp-btn"[^>]*disabled/.test(A));
ok("说明里讲清按图片 URL 匹配", /按「图片URL」精确匹配/.test(A));
ok("说明里讲清只认月度", /只把月度条目视为可匹配范围/.test(A));
ok("说明里讲清误传周度表也不会写错", /误把周度的表传进来也不会写到月度图上/.test(A));

console.log("二、接线");
ok("选文件后按钮才可点", /tagImpBtn\.disabled = !f;/.test(AR));
ok("模式切换会开关「清空」", /tagImpClear\.disabled = tagImpMode\.value !== "overwrite";/.test(AR));
ok("切回补齐模式会取消勾选", /if \(tagImpClear\.disabled\) tagImpClear\.checked = false;/.test(AR));
ok("导入固定 periodType=month", /periodType: "month",/.test(AR));
ok("写入前有「写入中」状态并复原", /tagImpBtn\.textContent = "写入中…"/.test(AR) && /tagImpBtn\.textContent = old;/.test(AR));
ok("模块没加载时明确提示刷新而不是静默", /导入模块未加载，请刷新页面再试/.test(AR));
ok("失败时提示原因", /写入失败：/.test(AR));
ok("枚举外标签会点名举例", /枚举外标签/.test(AR) && /未写入，例如/.test(AR));
ok("缺列会明确说清哪几维没写", /数据库缺少维度列/.test(AR));
ok("写完后刷新渠道列表与导出下拉", /await loadChList\(\);[\s\S]{0,120}await fillTagExportSelects\(\);/.test(AR));

console.log("三、只有一套实现");
ok("导入入口挂在同一个模块上", /importFile: importFile/.test(AI));
ok("月度调的是它", /window\.RankTagImport\.importFile\(f,/.test(AR));
ok("parseBook 只定义一次", (AI.match(/function parseBook\(/g) || []).length === 1);
ok("applyPlan 只定义一次", (AI.match(/function applyPlan\(/g) || []).length === 1);
ok("写库调用集中在同一模块（周度 + 共用入口）", (AI.match(/SB\.saveRankTagRows\(/g) || []).length >= 2 && !/SB\.saveRankTagRows/.test(AR));
ok("月度不再另写一份解析代码", !/function parseBook/.test(AR) && !/saveRankTagRows/.test(AR));

console.log("四、范围收窄语义");
ok("importFile 支持 periodType 过滤", /if \(opts\.periodType\) f\.periodType = opts\.periodType;/.test(AI));
ok("不传 periodType 时行为不变（周度零影响）", /var f = \{ cols: "image_url" \};/.test(AI));
ok("对不上的张数单独统计", /miss: res\.rows\.length - hit\.length/.test(AI));
ok("枚举外标签跟着返回", /unknown: res\.unknown/.test(AI));
ok("没有可写改动时返回明确文案而不是报错", /没有需要写入的改动/.test(AI));
ok("历史写失败不阻断本批", /历史写失败只影响精确撤回，不阻断本批/.test(AI));
ok("台账写失败不影响已写标签", /台账失败不影响标签已写入/.test(AI));
ok("缺列时把该维从写入里剔除（不是整批失败）", /var skipCols = missingDims\.map\(function \(d\) \{ return d\.col; \}\);/.test(AI));
ok("各维度写入行数会返回", /out\.dims\[dimOf\[k\]\]/.test(AI));

console.log("五、数据层");
ok("listRankItems 支持 periodType", /periodType/.test(S.split("async listRankItems")[1] || ""));
ok("支持按渠道收窄（只渠道图 / 排除渠道图）", /chMode === "only"/.test(S) && /chMode === "exclude"/.test(S));
ok("列白名单被拒会退回全量（不会白屏）", /COLS_REJECTED = true/.test(S));

console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
