import fs from "fs";
let pass=0,fail=0;
const ok=(c,m)=>{ if(c)pass++; else {fail++;console.log("FAIL",m);} };
const src=fs.readFileSync("js/admin-rank.js","utf8");

/* 抽出三个纯函数来真跑，而不是只看字符串 */
const pick=name=>{
  const i=src.indexOf("function "+name+"(");
  if(i<0) return "";
  let d=0,j=src.indexOf("{",i);
  for(let k=j;k<src.length;k++){ if(src[k]==="{")d++; else if(src[k]==="}"){d--; if(!d) return src.slice(i,k+1);} }
  return "";
};
const fns=["normHead","isIdHead","mapHeaderRow"].map(pick).join("\n");
const sandbox=new Function(fns+"; return {normHead,isIdHead,mapHeaderRow};")();
const {mapHeaderRow}=sandbox;

/* 1) 表头识别：货品名称 */
let m=mapHeaderRow(["货品名称","销量站点","首图url","环比比例","环比绝对值","叶子类目名称"]);
ok(m&&m.title>=0,"能识别「货品名称」为标题列");
ok(m&&m.site>=0&&m.url>=0&&m.ratio>=0&&m.abs>=0&&m.leaf>=0,"其余列同时识别正常");

/* 2) 商品名称 / 标题 也认 */
ok(mapHeaderRow(["商品名称","销量站点","首图url"]).title===0,"认「商品名称」");
ok(mapHeaderRow(["站点","首图url","标题"]).title===2,"认「标题」");
ok(mapHeaderRow(["item_title","站点","首图url"]).title<0,"英文列名不强认（不误判）");

/* 3) 不能把 叶子类目ID 当类目 */
m=mapHeaderRow(["叶子类目ID","叶子类目名称","站点","首图url","货品名称"]);
ok(m.leaf===1,"叶子类目取名称列而非 ID 列");

/* 4) 源码层：导入行与入库负载都带 title */
ok(/title:\s*String\(head\.map\.title/.test(src),"导入行写入 title");
ok(/title:\s*r\.title\s*\|\|\s*""/.test(src),"入库负载透传 title");
ok(/missing\.push\("货品名称/.test(src),"缺标题列时给出提示");
ok(/rows\.push\(\{\s*\n\s*title:/.test(src),"title 在 row 对象首位（便于核对）");

/* 5) 真实表格结构：标题列内容不会被当成 url */
m=mapHeaderRow(["货品名称","首图url"]);
ok(m.url===1&&m.title===0,"url 与 title 不串列");

console.log(`\nt_rank_title: PASS ${pass} / ${pass+fail}`);
process.exit(fail?1:0);
