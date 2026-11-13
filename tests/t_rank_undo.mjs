import fs from "fs";
let pass=0,fail=0;
const ok=(c,m)=>{ if(c)pass++; else {fail++;console.log("FAIL",m);} };
const src=fs.readFileSync("js/admin-rank.js","utf8");

/* ---------- 1) 把回撤相关的实现整块抽出来，在沙箱里真跑 ---------- */
const start=src.indexOf('const RANK_UNDO_KEY');
const end=src.indexOf("function batchSites(b) {");
ok(start>0 && end>start, "能定位回撤实现代码块");
const block=src.slice(start,end);

function makeEnv(opt){
  const o=opt||{};
  const store={};
  const els={
    "#rank-undo":{style:{},textContent:"",disabled:false},
    "#rank-undo-tip":{textContent:""},
  };
  const calls=[], toasts=[], writes=[];
  const XLSX={
    utils:{
      aoa_to_sheet:(a)=>({rows:a}),
      book_new:()=>({}),
      book_append_sheet:(wb,ws,name)=>{ (wb.__sheets=wb.__sheets||{})[name]=ws; },
    },
    writeFile:(wb,name)=>{ writes.push({wb,name}); },
  };
  const env={
    $:(sel)=>els[sel]||null,
    localStorage:{
      _s:store,
      getItem:(k)=>(k in store?store[k]:null),
      setItem:(k,v)=>{store[k]=String(v);},
      removeItem:(k)=>{delete store[k];},
    },
    window:{XLSX:XLSX},
    XLSX:XLSX,
    SB:{ deleteRankItemsByScope: async (arg)=>{ calls.push(arg); if(o.throwOn && o.throwOn(arg)) throw new Error("接口失败"); return o.perGroup===undefined?3:o.perGroup; } },
    sbToast:(t,okk)=>{ toasts.push([t,okk]); },
    uiConfirm: async ()=>{ return o.confirm===undefined?true:o.confirm; },
    loadRankBatches: async ()=>{},
  };
  const fn=new Function(...Object.keys(env),
    block+"\n; return {rankUndoInfo,setRankUndoInfo,rankUndoText,renderRankUndo,exportRankBackup,doRankUndo,RANK_UNDO_KEY};");
  const api=fn(...Object.values(env));
  return {api,els,calls,toasts,writes,store};
}

const sampleInfo={
  at:new Date("2026-11-12T10:30:00").getTime(), periodType:"week", inserted:500,
  groups:[{period:"第41周",category:"T恤",sites:["US"]},{period:"第41周",category:"卫衣",sites:["US","DE"]}],
  backupRows:120, mode:"replace",
};

/* ---------- 2) 按钮与状态文案 ---------- */
{
  const e=makeEnv();
  ok(e.els["#rank-undo"].style.display!=="", "没有导入记录时撤销按钮不显示");
  e.api.setRankUndoInfo(sampleInfo);
  e.api.renderRankUndo();
  ok(e.els["#rank-undo"].style.display==="", "有记录时撤销按钮显示");
  ok(e.els["#rank-undo"].textContent.indexOf("500")>=0, "按钮文案带上本次写入条数");
  const tip=e.els["#rank-undo-tip"].textContent;
  ok(tip.indexOf("2 组")>=0, "提示写明涉及分组数");
  ok(tip.indexOf("120")>=0, "提示写明留底条数");
  ok(tip.indexOf("11-12")>=0 && tip.indexOf("10:30")>=0, "提示写明导入时间");
}
{
  const e=makeEnv();
  const txt=e.api.rankUndoText(Object.assign({},sampleInfo,{backupRows:0}));
  ok(txt.indexOf("没有数据")>=0, "导入前无数据时提示改为「没有数据」，不说留底");
  ok(e.api.rankUndoText(null)==="", "没有记录时文案为空");
}

/* ---------- 3) 留底表结构与导入表一致 ---------- */
{
  const e=makeEnv();
  const rows=[
    {period_label:"第41周",category:"T恤",site:"US",image_url:"https://a/1.jpg",title:"纯棉T恤",rank_ratio:52.5,rank_abs:12},
    {period_label:"第41周",category:"T恤",site:"US",image_url:"https://a/2.jpg",title:"",rank_ratio:null,rank_abs:null},
  ];
  const saved=e.api.exportRankBackup(rows,sampleInfo);
  ok(saved===true, "能生成留底表");
  ok(e.writes.length===1, "写出一个文件");
  ok(e.writes[0].name.indexOf("榜单原数据留底")>=0, "文件名可辨识");
  const wb=e.writes[0].wb;
  const ws=wb.__sheets["原数据"], note=wb.__sheets["说明"];
  ok(!!ws && !!note, "含「原数据」「说明」两页");
  const header=ws.rows[0];
  ok(JSON.stringify(header)===JSON.stringify(["期次","叶子类目名称","销量站点","首图url","货品名称","环比比例","环比绝对值"]),
    "留底表表头与导入表完全一致，能原样导回");
  ok(ws.rows.length===3, "两条数据 + 一行表头");
  ok(ws.rows[1][6]===12, "环比绝对值原样保留");
  ok(ws.rows[1][5]==="52.5%", "环比比例带上百分号，导回时不会被当成 0.525");
  ok(ws.rows[2][4]==="" && ws.rows[2][5]==="" && ws.rows[2][6]==="", "缺值写成空串而不是 null/undefined");
  const noteText=JSON.stringify(note.rows);
  ok(noteText.indexOf("还原方法")>=0, "说明页写明还原方法");
  ok(noteText.indexOf("第41周 · T恤")>=0, "说明页列出涉及的槽位");
}
{
  const e=makeEnv({});
  e.api.setRankUndoInfo(null);
  const saved=e.api.exportRankBackup([],sampleInfo);
  ok(saved===true, "空数据也能生成（不报错）");
  ok(e.writes[0].wb.__sheets["原数据"].rows.length===1, "只有表头一行");
}

/* ---------- 4) 撤销：确认与删除范围 ---------- */
{
  const e=makeEnv({confirm:false, perGroup:3});
  e.api.setRankUndoInfo(sampleInfo);
  await e.api.doRankUndo();
  ok(e.calls.length===0, "取消确认时一条都不删");
  ok(!!e.store["sb.rank.lastImport"], "取消后导入记录仍在，可以下次再撤");
}
{
  const e=makeEnv({confirm:true, perGroup:3});
  e.api.setRankUndoInfo(sampleInfo);
  await e.api.doRankUndo();
  ok(e.calls.length===2, "按记录的 2 组各删一次，不碰其它期次/类目");
  ok(e.calls[0].periodLabel==="第41周" && e.calls[0].category==="T恤", "第一组参数正确");
  ok(JSON.stringify(e.calls[1].sites)===JSON.stringify(["US","DE"]), "多站点槽位按站点列表删除");
  ok(e.calls[0].periodType==="week", "期次类型带上了");
  ok(!e.store["sb.rank.lastImport"], "撤销成功后清掉记录，避免重复撤销");
  ok(e.els["#rank-undo"].style.display!=="", "撤销后按钮隐藏");
  const t=e.toasts[e.toasts.length-1];
  ok(t[0].indexOf("清空 6 条")>=0, "提示写明实际清空条数（3+3）");
  ok(t[0].indexOf("留底表")>=0, "提示引导用留底表还原");
  ok(t[1]===true, "全部成功时按成功样式提示");
}
{
  const e=makeEnv({confirm:true, perGroup:2, throwOn:(a)=>a.category==="卫衣"});
  e.api.setRankUndoInfo(sampleInfo);
  await e.api.doRankUndo();
  ok(e.calls.length===2, "某组失败时仍继续处理后面的组");
  const t=e.toasts[e.toasts.length-1];
  ok(t[0].indexOf("1 组失败")>=0, "提示写明失败组数");
  ok(t[1]===false, "有失败时按失败样式提示");
  ok(!e.store["sb.rank.lastImport"], "即使部分失败也清记录（避免误以为还能再撤一次）");
}
{
  const e=makeEnv({confirm:true});
  e.api.setRankUndoInfo(null);
  await e.api.doRankUndo();
  ok(e.calls.length===0, "没有记录时点了也不删任何东西");
  ok(e.toasts[e.toasts.length-1][0].indexOf("没有可撤销")>=0, "给出明确提示");
}

/* ---------- 5) 导入流程里的接线（源码级） ---------- */
const impStart=src.indexOf("const mode = (document.querySelector");
const impEnd=src.indexOf("async function computeRankCounts");
const impSrc=src.slice(impStart>0?impStart:0, impEnd>0?impEnd:src.length);
ok(impSrc.indexOf("undoGroups")>=0, "导入流程登记了本次动过的槽位");
ok(impSrc.indexOf("backupRows")>=0, "导入流程收集了旧数据");
const iList=impSrc.indexOf("step0-placeholder");
ok(impSrc.indexOf("SB.listRankItems")>=0 && impSrc.indexOf("SB.clearRankSlot")>=0, "覆盖模式下既有读取也有清空");
ok(impSrc.indexOf("SB.listRankItems") < impSrc.indexOf("cleared = await SB.clearRankSlot"),
  "先留底再清空：读取旧数据必须早于 clearRankSlot");
ok(impSrc.indexOf("setRankUndoInfo(info)")>=0, "导入结束写入可撤销记录");
ok(impSrc.indexOf("exportRankBackup(backupRows")>=0, "有旧数据时自动导出留底表");
ok(impSrc.indexOf("if (ins > 0) undoGroups.push")>=0, "只把真正写入成功的组登记为可撤销");
ok(impSrc.indexOf("没有生成留底表")>=0, "读取旧数据失败时明确提示这次没有留底");

/* 面板挂载时渲染按钮状态 */
ok(src.indexOf("undoBtn.onclick = doRankUndo")>=0, "撤销按钮已绑定");
ok(src.indexOf("renderRankUndo();")>=0, "面板加载时会同步按钮状态");

/* supabase 层：按范围删除 */
const sbSrc=fs.readFileSync("js/supabase.js","utf8");
ok(sbSrc.indexOf("async deleteRankItemsByScope")>=0, "数据层提供按「期次+类目+站点」清空的方法");
const delBody=sbSrc.slice(sbSrc.indexOf("async deleteRankItemsByScope"), sbSrc.indexOf("async deleteRankItemsByScope")+1200);
ok(delBody.indexOf('eq("period_type"')>=0 && delBody.indexOf('eq("category"')>=0, "删除条件限定到期次与类目");
ok(delBody.indexOf('in("site"')>=0, "站点也参与限定，不会误删其它站点同款");
ok(delBody.indexOf("400")>=0, "分批循环有上限保护，不会无限循环");

/* 页面接线 */
const html=fs.readFileSync("admin.html","utf8");
ok(html.indexOf('id="rank-undo"')>=0, "后台页面有撤销按钮");
ok(html.indexOf('id="rank-undo-tip"')>=0, "后台页面有状态提示位");
ok(html.indexOf("撤销本次导入")>=0, "按钮文案可辨识");

console.log(`\nt_rank_undo: pass ${pass} / fail ${fail}`);
if(fail) process.exit(1);
