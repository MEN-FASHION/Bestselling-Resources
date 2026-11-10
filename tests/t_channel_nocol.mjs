/* 20261110E · 渠道列缺失时的兜底（实跑真实数据层）
 * 场景：rank_items 没有 channel 列（SQL 补丁没执行），所有带 channel 的查询都会被拒 400。
 * 期望：自动改用配置档里的字典存储，补渠道 / 渠道传图 / 前台渠道对比 / 自检 全部照常可用。
 */
import fs from "fs"; import vm from "node:vm";
const S = fs.readFileSync(new URL("../js/supabase.js", import.meta.url), "utf8");
let pass=0, fail=0; const ok=(c,m)=>{ if(c) pass++; else { fail++; console.log("  ✗ "+m); } };

// 造一个假的 supabase client：rank_items 没有 channel 列
const DB = { settings: { id:1, frontend_dims: {} }, rows: [
  { id:1, period_type:"month", period_label:"2026年10月", category:"男装", site:"", image_url:"u1" },
  { id:2, period_type:"month", period_label:"2026年10月", category:"男装", site:"", image_url:"u2" },
  { id:3, period_type:"month", period_label:"2026年10月", category:"女装", site:"", image_url:"u3" },
]};
function q(table){
  const st = { table, filters:[], mode:"select", payload:null, sel:null, head:false, count:false, lim:null };
  const api = {
    select(sel,opt){ st.sel=sel; if(opt&&opt.head) st.head=true; if(opt&&opt.count) st.count=true; return api; },
    eq(k,v){ st.filters.push(r=>String(r[k])===String(v)); return api; },
    neq(k,v){ st.filters.push(r=>String(r[k])!==String(v)); return api; },
    is(k,v){ st.filters.push(r=>(r[k]==null)); return api; },
    not(){ return api; },
    in(k,arr){ st.filters.push(r=>arr.indexOf(r[k])>=0); return api; },
    order(){ return api; }, range(a,b){ st.lim=[a,b]; return api; }, limit(n){ st.lim=[0,n]; return api; },
    maybeSingle(){ st.single=true; return api; },
    update(p){ st.mode="update"; st.payload=p; return api; },
    insert(p){ st.mode="insert"; st.payload=p; return api; },
    then(res, rej){
      if (st.table==="site_settings"){
        if (st.mode==="update") Object.assign(DB.settings, st.payload);
        return res({ data: st.single? Object.assign({},DB.settings) : [DB.settings], error:null, count:1 });
      }
      // rank_items
      if (st.sel && /channel/.test(st.sel)) return res({ data:[], error:{ message:"column rank_items.channel does not exist", code:"42703" }, count:0 });
      if (st.mode==="update") return res({ data:[], error:{ message:"column does not exist" } });
      if (st.mode==="insert") return res({ data:[{}], error:null });
      let rows = DB.rows.slice();
      st.filters.forEach(f=>{ rows=rows.filter(f); });
      if (st.lim) rows = rows.slice(st.lim[0], st.lim[1]);
      return res({ data: rows.map(r=>Object.assign({},r)), error:null, count: rows.length });
    }
  };
  return api;
}
const client = { from: q };
const win = { CONFIG:{ SUPABASE:{url:"https://x.invalid",anonKey:"k"}, WORKER_URL:"" }, supabase:{ createClient:()=>client }, localStorage:{getItem(){return null},setItem(){}} };
const ctx = vm.createContext({ window:win, document:{}, localStorage:win.localStorage, fetch:async()=>({ok:true,json:async()=>({})}), console, setTimeout, clearTimeout, Date, JSON, Math, String, Number, RegExp, Promise, Object, Array, Set, Map, URL, encodeURIComponent, decodeURIComponent, Error });
vm.runInContext(S, ctx);
const SB = vm.runInContext("SB", ctx);
process.on("unhandledRejection", e=>{ console.log("rej", e && e.message); });

const col = await SB.rankChannelColumn();
ok(col === false, "应探测出没有 channel 列");
ok(SB.channelStorage() === "map", "无列时应切到字典存储");

const n0 = await SB.countRankItemsChannelSlot({ periodLabel:"2026-10", category:"男装", onlyEmpty:true });
ok(n0 === 2, "无列也应统计出 2 条（期次写法 2026-10 vs 2026年10月 自动兼容），实际 " + n0);

const n1 = await SB.setRankItemsChannelSlot({ periodLabel:"2026-10", category:"男装", onlyEmpty:true }, "Pinterest");
ok(n1 === 2, "无列也应补上 2 条，实际 " + n1);
const map1 = DB.settings.frontend_dims.rank_channel_map || {};
ok(map1.u1 === "Pinterest" && map1.u2 === "Pinterest", "两张图的归属应写进字典");
ok(!map1.u3, "别的类目不应被改");

const n2 = await SB.countRankItemsChannelSlot({ periodLabel:"2026-10", category:"男装", onlyEmpty:true });
ok(n2 === 0, "补完再数应为 0，实际 " + n2);

const names = await SB.listRankChannelNames();
ok(names.indexOf("Pinterest") >= 0, "渠道名列表应含 Pinterest");

const rows = await SB.listRankItems({ periods:["2026年10月"], periodType:"month", channelMode:"only" });
ok(rows.length === 2 && String(rows[0].channel)==="Pinterest", "按渠道筛应只出 2 条且带渠道名，实际 " + rows.length);
const rows2 = await SB.listRankItems({ periods:["2026年10月"], periodType:"month", channelMode:"exclude" });
ok(rows2.length === 1 && String(rows2[0].image_url)==="u3", "榜单列应只剩未归属的那 1 条，实际 " + rows2.length);

const d = await SB.diagnoseChannelSlot({ periodLabel:"2026-10", category:"男装" });
ok(d.hasColumn === false && d.storage === "map", "自检应说明走的是字典存储");
ok(d.monthTotal === 2 && d.filled === 2, "自检应报出 2 条且都已归属，实际 " + d.monthTotal + "/" + d.filled);

const n3 = await SB.setRankItemsChannelSlot({ periodLabel:"2026-10", category:"男装", onlyEmpty:false }, "");
ok(n3 === 2, "清空应改回 2 条，实际 " + n3);
const map2 = DB.settings.frontend_dims.rank_channel_map || {};
ok(!map2.u1 && !map2.u2, "清空后字典里不应再有这两张图");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
