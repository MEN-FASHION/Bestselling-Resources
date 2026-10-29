const fs=require('fs'),vm=require('vm');
const captured=[];
const XLSX={utils:{aoa_to_sheet:(a)=>{const w={aoa:a};captured.push(w);return w;},
  encode_cell:({r,c})=>String.fromCharCode(65+c)+(r+1),
  book_new:()=>({SheetNames:[],Sheets:{}}),
  book_append_sheet:(wb,ws,n)=>{wb.SheetNames.push(n);wb.Sheets[n]=ws;},
  write:()=>new ArrayBuffer(8)}};
const sb={window:{CONFIG:{WORKER_URL:'https://img.x.com'}},document:{querySelector:()=>null,createElement:()=>({style:{},classList:{add(){}},appendChild(){}}),addEventListener(){}},console,XLSX,Blob:function(){},URL:{createObjectURL:()=>'blob:x'}};
vm.createContext(sb);
// 严格按 admin.html 新顺序加载
for(const f of ['js/rank-enums.js','js/imageexport.js','js/admin-imageimport.js','js/rankexport.js']){
  vm.runInContext(fs.readFileSync(__dirname + '/../' + f,'utf8'),sb);
}
const M=sb.window.ImageExport;
M.buildBook([{id:'1',name:'a',category:'T恤',url:'u',path:'p/a.jpg',style_tags:['休闲']}],{});
// 枚举参考是第三个 aoa_to_sheet 输出
const aoa=captured[2].aoa;
const rows={};
aoa.forEach(r=>{ if(r&&r[0]) rows[r[0]]=String(r[1]||''); });
let pass=0,fail=0;
const ok=(n,c,e)=>{c?(pass++,console.log('  PASS '+n)):(fail++,console.log('  FAIL '+n+(e?' :: '+e:'')));};
const must=['风格','视觉-背景','视觉-画面构成','视觉-呈现主体','图案元素','二次工艺','拍摄方式','模特','领型','袖型','袖长','衣长','松紧度','裤型','裤长','裙长','腰型','文化背景','消费心理','节日','渠道'];
must.forEach(k=>{ ok('枚举参考「'+k+'」有取值', (rows[k]||'').length>0, JSON.stringify(rows[k]||'').slice(0,60)); });
ok('视觉-画面构成 含 拼图/九宫格', (rows['视觉-画面构成']||'').includes('拼图/九宫格'));
ok('二次工艺 含 数码印花', (rows['二次工艺']||'').includes('数码印花'));
ok('文化背景 含 美式文化', (rows['文化背景']||'').includes('美式文化'));
ok('消费心理 含 身份认同', (rows['消费心理']||'').includes('身份认同'));
ok('节日 含 圣诞节', (rows['节日']||'').includes('圣诞节'));
console.log('\n'+pass+' pass, '+fail+' fail');
process.exit(fail?1:0);
