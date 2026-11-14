import fs from "fs";
let pass=0,fail=0;
const ok=(c,m)=>{ if(c)pass++; else {fail++;console.log("FAIL",m);} };
const src=fs.readFileSync("js/admin-rank.js","utf8");
const css=fs.readFileSync("css/style.css","utf8");

/* 1) 类目面板批量清理能力存在 */
const gi=src.indexOf("async function openRankCategoryTools");
const ge=src.indexOf("async function loadRankBatches");
ok(gi>0 && ge>gi, "能定位类目清理面板实现");
const block=src.slice(gi,ge);

ok(/\.rank-cat-pick/.test(block), "每个类目行带勾选框");
ok(/dataset\.cat\s*=/.test(block), "勾选框记住类目名（含空类目）");
ok(/pickedCats/.test(block), "能取出勾选的类目集合");
ok(/删除选中/.test(block), "有批量删除按钮");
ok(/deleteRankCategory\(c, SOURCE\)/.test(block), "批量删除复用整类删除接口（且带本域，不跨专区），未新造写入路径");
ok(/只选数字类目/.test(block), "能一键选中纯数字脏类目");
ok(/\/\^\\\\d\+\$\//.test(block) || /\^\\d\+\$/.test(block), "数字类目判定用纯数字正则");

/* 2) 按钮初始不可点，避免空删 */
ok(/cDel\.disabled\s*=\s*n\s*===\s*0/.test(block), "无勾选时删除按钮禁用");
ok(/refreshCbar\(\)/.test(block), "勾选变化后刷新按钮状态");

/* 3) 删除必须逐类目执行并统计，不静默吞错 */
ok(/for \(const c of cats_\)/.test(block), "逐类目循环删除");
ok(/bad\s*\+=\s*1/.test(block), "单类目失败计入失败数，不中断整批");
ok(/sbToast\([\s\S]{0,160}bad\s*===\s*0\)/.test(block), "结束后给出成功/失败汇总提示");

/* 4) 删除后必须刷新批次列表，否则界面留着已删的类目 */
ok(/await loadRankBatches\(\); rankPreviewRefresh\(\);/.test(block), "删除后刷新批次与预览");

/* 5) 危险操作要有二次确认 */
ok(/(askYes|uiConfirm)\([\s\S]{0,220}全部条目都会被删掉/.test(block), "批量删除前二次确认并说明后果");
/* 20261114I：确认统一走 askYes（站内弹窗优先，弹窗不可用才退回原生），
   主确认路径不再直接调 window.confirm；带 native-fallback 标记的兜底行放行 */
{
  const lines = block.split("\n").filter((ln) => !/native-fallback/.test(ln));
  const body = lines.join("\n");
  ok(/askYes\(/.test(body) && !/window\.confirm\(/.test(body), "使用站内确认弹窗（askYes），不用原生 confirm");
}

/* 6) 样式 */
ok(/\.rank-cat-bar/.test(css), "批量工具条有样式");
ok(/\.rank-cat-pick/.test(css), "勾选框有样式");

/* 7) 版本戳一致（防止只改一处，浏览器读旧脚本） */
const files=["index.html","admin.html"];
const vers=new Set();
files.forEach(f=>{ const t=fs.readFileSync(f,"utf8"); (t.match(/\?v=(\d{8}[A-Z]{1,3})/g)||[]).forEach(m=>vers.add(m.slice(3))); });
ok(vers.size===1, "所有页面版本戳一致");
const v=[...vers][0];
ok(new RegExp('BUILD = "'+v+'"').test(fs.readFileSync("js/rhythm.js","utf8")), "前台脚本版本戳与页面一致");


/* 8) 上传记录为空时，工具条与「类目清理」入口必须仍在（否则恰恰在需要清理时找不到） */
const lb=src.indexOf("async function loadRankBatches");
const lbBlock=src.slice(lb, lb+7000);
ok(/还没有上传记录/.test(lbBlock), "空记录分支存在");
ok(/if \(!list\.length\)[\s\S]{0,400}ensureBatchToolbar\(box\)/.test(lbBlock), "空记录时仍创建工具条");
ok(!/tb\.style\.display = "none"/.test(lbBlock), "空记录时不再隐藏工具条");
ok(/selAll\.disabled = !boxes\.length/.test(src), "无记录时全选禁用");

/* 9) 类目清单必须能从条目表兜底，否则台账被删光后面板显示「还没有类目」 */
const supa=fs.readFileSync("js/supabase.js","utf8");
const lc=supa.slice(supa.indexOf("async listRankCategories"), supa.indexOf("async deleteRankCategory")>0?supa.indexOf("async deleteRankCategory"):supa.indexOf("async listRankCategories")+4000);
ok(/from\("rank_items"\)/.test(lc), "类目清单同时统计条目表");
ok(/exact: e\.rows > 0/.test(lc), "区分真实条数与台账估算");
ok(/无台账/.test(src), "无台账的类目在界面上标出");

/* 10) 删批次必须真删条目，且不在 clearRankSlot 里回调 deleteRankBatch（防递归） */
const dr=supa.slice(supa.indexOf("async deleteRankBatch"), supa.indexOf("async listRankCategories"));
ok(/clearRankSlot/.test(dr), "删批次时显式清槽位条目，不依赖数据库级联");
const cs=supa.slice(supa.indexOf("async clearRankSlot"), supa.indexOf("async listRankSlotUrls"));
ok(!/this\.deleteRankBatch\(/.test(cs), "clearRankSlot 内部不回调 deleteRankBatch，避免递归");
ok(/client\.from\("rank_batches"\)\.delete\(\)/.test(cs), "clearRankSlot 直接删台账");

if (pass+fail>0) console.log((fail===0?"PASS ":"FAIL ")+pass+"/"+(pass+fail));
process.exit(fail?1:0);
