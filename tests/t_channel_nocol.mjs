/* 20261110G · 渠道列缺失时的兜底（实跑真实数据层）
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


console.log("六、列存在但查询仍被拒（缓存/权限问题）也要能补");
{
  // 这个桩：探测 channel 列「成功」，但带 channel 的查询一律 400
  const DB2 = { settings:{ id:1, frontend_dims:{} }, rows:[
    { id:1, period_type:"month", period_label:"2026年10月", category:"男装", site:"", image_url:"v1" },
    { id:2, period_type:"month", period_label:"2026年10月", category:"男装", site:"", image_url:"v2" },
  ]};
  function q2(table){
    const st = { table, filters:[], mode:"select", payload:null, sel:null, single:false, lim:null };
    const api = {
      select(sel,opt){ st.sel=sel; if(opt&&opt.head) st.head=true; if(opt&&opt.count) st.count=true; return api; },
      eq(k,v){ st.filters.push(r=>String(r[k])===String(v)); return api; },
      neq(k,v){ st.filters.push(r=>String(r[k])!==String(v)); return api; },
      is(k){ st.filters.push(r=>(r[k]==null)); return api; },
      not(){ return api; },
      in(k,arr){ st.filters.push(r=>arr.indexOf(r[k])>=0); return api; },
      order(){ return api; }, range(a,b){ st.lim=[a,b]; return api; }, limit(n){ st.lim=[0,n]; return api; },
      maybeSingle(){ st.single=true; return api; },
      update(p){ st.mode="update"; st.payload=p; return api; },
      insert(p){ st.mode="insert"; st.payload=p; return api; },
      then(res){
        if (st.table==="site_settings"){
          if (st.mode==="update") Object.assign(DB2.settings, st.payload);
          return res({ data: st.single? Object.assign({},DB2.settings) : [DB2.settings], error:null, count:1 });
        }
        // 探测（select channel，单行）→ 装作列存在；但带 channel 过滤/更新的 → 400
        const hasChFilter = st.filters.length && /channel/.test(st.sel || "");
        const chInSel = /channel/.test(st.sel || "");
        if (st.head && chInSel) return res({ data:null, error:null, count:0 });   // 让探测通过
        if (chInSel && st.mode==="select" && !st.head) return res({ data:[], error:{ message:"column channel does not exist", code:"42703" }, count:0 });
        if (st.mode==="update") return res({ data:[], error:{ message:"column channel does not exist" } });
        let rows = DB2.rows.slice(); st.filters.forEach(f=>{ rows=rows.filter(f); });
        if (st.lim) rows = rows.slice(st.lim[0], st.lim[1]);
        return res({ data: rows.map(r=>Object.assign({},r)), error:null, count: rows.length });
      }
    };
    return api;
  }
  const SB2 = SB.constructor ? null : null;
  // 重新加载一份独立的 SB，用 q2 作为 client
  const win2 = { CONFIG:{ SUPABASE:{url:"https://x.invalid",anonKey:"k"}, WORKER_URL:"" }, supabase:{ createClient:()=>q2 && { from:q2 } }, localStorage:{getItem(){return null},setItem(){}} };
  const ctx2 = vm.createContext({ window:win2, document:{}, localStorage:win2.localStorage, fetch:async()=>({ok:true,json:async()=>({})}), console, setTimeout, clearTimeout, Date, JSON, Math, String, Number, RegExp, Promise, Object, Array, Set, Map, URL, encodeURIComponent, decodeURIComponent, Error });
  vm.runInContext(S, ctx2);
  const SB2b = vm.runInContext("SB", ctx2);
  const n = await SB2b.setRankItemsChannelSlot({ periodLabel:"2026-10", category:"男装", onlyEmpty:true }, "SHEIN");
  ok(n === 2, "列存在但写入被拒时也应补上 2 条，实际 " + n);
  const m = DB2.settings.frontend_dims.rank_channel_map || {};
  ok(m.v1 === "SHEIN" && m.v2 === "SHEIN", "应改存字典");
  const d2 = await SB2b.diagnoseChannelSlot({ periodLabel:"2026-10", category:"男装" });
  ok(d2.storage === "map" || d2.monthTotal === 2, "自检应报出 2 条，实际 " + d2.monthTotal);
}


console.log("七、有列但写入被静默挡住（改了 0 行、不报错）也要能补上并读得出");
{
  const DB3 = { settings:{ id:1, frontend_dims:{} }, rows:[
    { id:11, period_type:"month", period_label:"2026年10月", category:"男装", site:"", image_url:"w1", channel:"" },
    { id:12, period_type:"month", period_label:"2026年10月", category:"男装", site:"", image_url:"w2", channel:"" },
    { id:13, period_type:"month", period_label:"2026年10月", category:"男装", site:"", image_url:"w3", channel:"" },
  ]};
  function q3(table){
    const st = { table, filters:[], mode:"select", payload:null, sel:"*", single:false, lim:null, head:false };
    const api = {
      select(sel,opt){ st.sel=sel; if(opt&&opt.head) st.head=true; if(opt&&opt.count) st.count=true; return api; },
      eq(k,v){ st.filters.push(r=>String(r[k])===String(v)); return api; },
      neq(k,v){ st.filters.push(r=>String(r[k])!==String(v)); return api; },
      is(k){ st.filters.push(r=>(r[k]==null)); return api; },
      not(k,op,v){ st.filters.push(r=> op==="is" ? !(r[k]==null) : String(r[k])!==String(v)); return api; },
      in(k,arr){ st.filters.push(r=>arr.map(String).indexOf(String(r[k]))>=0); return api; },
      order(){ return api; }, range(a,b){ st.lim=[a,b]; return api; }, limit(n){ st.lim=[0,n]; return api; },
      maybeSingle(){ st.single=true; return api; },
      update(p){ st.mode="update"; st.payload=p; return api; },
      insert(p){ st.mode="insert"; st.payload=p; return api; },
      then(res){
        if (st.table==="site_settings"){
          if (st.mode==="update") Object.assign(DB3.settings, st.payload);
          return res({ data: st.single? Object.assign({},DB3.settings) : [DB3.settings], error:null, count:1 });
        }
        if (st.mode==="update") return res({ data: [], error: null, count: 0 });   // 静默 0 行
        let rows = DB3.rows.map(r=>Object.assign({},r));
        st.filters.forEach(f=>{ rows=rows.filter(f); });
        if (st.lim) rows = rows.slice(st.lim[0], st.lim[1]);
        return res({ data: st.single? rows[0] : rows, error:null, count: rows.length });
      }
    };
    return api;
  }
  const win3 = { CONFIG:{ SUPABASE:{url:"https://x.invalid",anonKey:"k"}, WORKER_URL:"" }, supabase:{ createClient:()=>q3 && { from:q3 } }, localStorage:{getItem(){return null},setItem(){}} };
  const ctx3 = vm.createContext({ window:win3, document:{}, localStorage:win3.localStorage, fetch:async()=>({ok:true,json:async()=>({})}), console, setTimeout, clearTimeout, Date, JSON, Math, String, Number, RegExp, Promise, Object, Array, Set, Map, URL, encodeURIComponent, decodeURIComponent, Error });
  vm.runInContext(S, ctx3);
  const SB3 = vm.runInContext("SB", ctx3);

  const n = await SB3.countRankItemsChannelSlot({ periodLabel:"2026-10", category:"男装", onlyEmpty:true });
  ok(n === 3, "统计应能数出 3 条待补，实际 " + n);
  const m = await SB3.setRankItemsChannelSlot({ periodLabel:"2026-10", category:"男装", onlyEmpty:true }, "月度榜单");
  ok(m === 3, "写入被静默挡住也应返回 3 条，实际 " + m);
  const map = DB3.settings.frontend_dims.rank_channel_map || {};
  ok(map.w1==="月度榜单" && map.w3==="月度榜单", "归属落进字典");
  const after = await SB3.countRankItemsChannelSlot({ periodLabel:"2026-10", category:"男装", onlyEmpty:true });
  ok(after === 0, "补完再数应为 0，实际 " + after);
  const only = await SB3.listRankItems({ periodType:"month", category:"男装", periods:["2026年10月"], channelMode:"only" });
  ok(only.length === 3 && only.every(r=>r.channel==="月度榜单"), "前台应能读回这 3 条渠道图");
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
