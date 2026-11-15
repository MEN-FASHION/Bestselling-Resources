import fs from "fs";
import vm from "vm";
let pass=0,fail=0;
const ok=(c,m)=>{ if(c)pass++; else {fail++;console.log("FAIL",m);} };
const src=fs.readFileSync("js/admin-rank.js","utf8");

const pick=name=>{
  const i=src.indexOf("function "+name+"(");
  if(i<0) return "";
  let d=0,j=src.indexOf("{",i);
  for(let k=j;k<src.length;k++){ if(src[k]==="{")d++; else if(src[k]==="}"){d--; if(!d) return src.slice(i,k+1);} }
  return "";
};
const fns=["normCat","normHead","isIdHead","mapHeaderRow","groupRankRows"].map(pick).join("\n");
ok(fns.includes("groupRankRows"),"能抽出 groupRankRows");
ok(fns.includes("function normCat"),"能抽出 normCat");
/* 注入真实的类目归一模块，避免测试里退化成不归一 */
const nctx={window:{}}; nctx.globalThis=nctx; vm.createContext(nctx);
vm.runInContext(fs.readFileSync("js/rank-cat-norm.js","utf8"),nctx);
const box=new Function("window",fns+"; return {mapHeaderRow,groupRankRows};")(nctx.window);
const {mapHeaderRow,groupRankRows}=box;

/* 1) 期次列表头识别 */
ok(mapHeaderRow(["期次","货品名称","首图url","站点","叶子类目名称"]).period===0,"认「期次」列");
ok(mapHeaderRow(["周次","货品名称","首图url","站点"]).period===0,"认「周次」列");
ok(mapHeaderRow(["周期","货品名称","首图url","站点"]).period===0,"认「周期」列");
ok(mapHeaderRow(["周","货品名称","首图url","站点"]).period===0,"认「周」列");
ok(mapHeaderRow(["货品名称","首图url","站点"]).period<0,"没有期次列时不误判");

/* 2) 多期次 + 多类目 → 分组 */
const rows=[
  {period:"第41周",leaf_category:"T恤",site:"US",image_url:"u1",title:"a"},
  {period:"第41周",leaf_category:"T恤",site:"US",image_url:"u2",title:"b"},
  {period:"第41周",leaf_category:"卫衣",site:"US",image_url:"u3",title:"c"},
  {period:"第42周",leaf_category:"T恤",site:"US",image_url:"u4",title:"d"},
  {period:"第42周",leaf_category:"T恤",site:"DE",image_url:"u5",title:"e"},
];
let g=groupRankRows(rows,{periodType:"week",periodLabel:"",category:"",sites:[],useMine:false});
/* 没选类目时，表格里的类目一律不进菜单，全部归「其他」——否则每导一张表就多几个菜单项 */
ok(g.groups.length===2,"没选类目 → 只按期次拆成 2 组（表格类目完全不参与分组）");
ok(g.groups.every(x=>x.category==="其他"),"所有组的类目都是「其他」，不是表格里的值");
ok(g.groups.reduce((n,x)=>n+x.rows.length,0)===5,"5 行一条不少");
const k41t=g.groups.find(x=>x.period==="第41周");
ok(!!k41t,"能定位到 第41周 这一组");
ok(k41t.rows.length===3,"该组含 3 行（原 T恤 2 行 + 卫衣 1 行）");
ok(k41t.rows.every(r=>r.leaf_category), "表格类目原文仍写进叶子类目，便于追溯");
ok(k41t.slotSites.length===1&&k41t.slotSites[0]==="US","该组站点只有 US");
/* 长路径类目必须归一到标准名，否则后台类目菜单会被撑爆 */
const gLong=groupRankRows([
  {period:"第41周",leaf_category:"服装、鞋靴和珠宝饰品，男士时尚，男装，男士休闲运动服，男士休闲运动套装，男士运动服",site:"US",image_url:"L1",title:"t"},
],{periodType:"week",periodLabel:"",category:"",sites:[],useMine:false});
ok(gLong.groups.length===1&&gLong.groups[0].category==="其他","长路径类目也不会变成菜单项（归「其他」）");
ok(gLong.groups[0].rows[0].leaf_category.indexOf("男士运动服")>=0,"条目仍保留类目原文");
const gNum=groupRankRows([{period:"第41周",leaf_category:"30472",site:"US",image_url:"L2",title:"t"}],{periodType:"week",periodLabel:"",category:"",sites:[],useMine:false});
ok(gNum.groups[0].category==="其他","纯数字类目 ID 不会成为菜单项");
ok(gNum.groups[0].rows[0].leaf_category==="30472","数字类目原文仍完整保留在叶子类目");

const k42t=g.groups.find(x=>x.period==="第42周");
ok(k42t.slotSites.length===2,"42周T恤组含 US、DE 两个站点");
ok(k42t.rows.length===2,"两个站点的行都进同一组（随后按站点各自建批次）");

/* 3) 每行都带上自己的期次与类目（不再被单值覆盖） */
ok(k41t.rows.every(r=>r.period_label==="第41周"),"行内期次取自表格");
ok(k42t.rows.every(r=>r.period_label==="第42周"),"另一组行内期次正确");

/* 4) 表格没带期次/类目时，回退到界面所选 */
g=groupRankRows([{period:"",leaf_category:"",site:"US",image_url:"u1"}],
  {periodType:"week",periodLabel:"W41",category:"T恤",sites:[],useMine:false});
ok(g.groups.length===1&&g.groups[0].period==="W41"&&g.groups[0].category==="T恤","缺列时用界面所选期次与类目");

/* 5) 一个都没选 → 计入 noPeriod / noCat，不产生空组 */
g=groupRankRows([{period:"",leaf_category:"",site:"US",image_url:"u1"}],
  {periodType:"week",periodLabel:"",category:"",sites:[],useMine:false});
ok(g.groups.length===0,"缺期次时不建组（类目缺失已不再阻断，归「其他」）");
ok(g.noPeriod===1&&g.noCat===1,"分别计数，便于提示到底缺哪个");

/* 6) 勾选了「我的站点」→ 按勾选取值，忽略表格站点列 */
g=groupRankRows([{period:"W1",leaf_category:"T恤",site:"德国",image_url:"u1"}],
  {periodType:"week",periodLabel:"",category:"",sites:["欧盟"],useMine:true});
ok(g.groups.length===1&&g.groups[0].slotSites[0]==="欧盟","勾选站点时整批归入该站点");

/* 7) 没有站点列也没勾选 → 计入 noSite */
g=groupRankRows([{period:"W1",leaf_category:"T恤",site:"",image_url:"u1"}],
  {periodType:"week",periodLabel:"",category:"",sites:[],useMine:false});
ok(g.groups.length===0&&g.noSite===1,"无站点可取时计入 noSite");

/* 8) 源码层：多组循环写入 + 逐组覆盖 + 汇总提示 */
ok(/const g = gf\.groups\[i\]/.test(src) && /const TOTAL = gf\.groups\.length/.test(src),"导入按组循环（并行 worker 按组号取组）");
ok(/await SB\.clearRankSlot\(slot\)/.test(src),"每组各自覆盖旧数据");
ok(/await SB\.createRankBatch\(/.test(src),"每组各自建上传批次");
ok(/已按时段与类目拆成/.test(src),"多组时提示实际拆了几组");
ok(/失败 " \+ failed\.length \+ " 组/.test(src),"有组失败时明确报出");
ok(/groups\.length\) \{\s*\n\s*if \(gf\.noCat\)/.test(src),"一组都没有时说清缺的是类目/期次/站点");

/* 9) 读取工作簿全部工作表（否则一次导入只进第一个 sheet） */
ok(/for \(const sn of wb\.SheetNames\)/.test(src),"遍历所有工作表");
ok(/if \(!head\) continue;/.test(src),"说明页/空页跳过而不是整体失败");
ok(/usedSheets\.push\(sn\)/.test(src),"记录实际用到的表");
ok(/if \(!usedSheets\.length\)/.test(src),"一个表都没识别到时明确报错");
ok(!/wb\.Sheets\[wb\.SheetNames\[0\]\]/.test(src),"不再只读第一个工作表");

/* 10) 预览里先算清楚会拆成几组 */
ok(/按期次拆成/.test(src),"预览说明会拆成几批");
ok(/const cat = defCat \|\| "其他"/.test(src),"类目只认后台所选，未选归「其他」");
ok(!/normCat\(r\.leaf_category\)/.test(src),"表格类目绝不参与建类目");
ok(/function normCat\(/.test(src),"表格类目在建批次前先归一");
ok(/只作为叶子类目记录|只存为叶子类目/.test(src),"预览说明表格类目不会新建类目");

/* 11) 表头映射不得引用循环内变量（曾导致运行时报错） */
ok(!/if \(head\.map\.title < 0\)/.test(src),"缺列提示改用 firstHead 重算");

console.log(`\nt_rank_multigroup: PASS ${pass} / ${pass+fail}`);
process.exit(fail?1:0);
