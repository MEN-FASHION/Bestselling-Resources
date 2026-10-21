const fs=require("fs"),path=require("path");const {JSDOM}=require("jsdom");
const ROOT=".";const read=(p)=>fs.readFileSync(path.join(ROOT,p),"utf8");
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const SITES=["美国","英国"],PERIODS=["2026W40","2026W41","2026W42"],CATS=["卫衣","T恤","鞋"];
function items(){const out=[];const add=(cat,period,n)=>{for(let i=0;i<n;i++)out.push({image_url:"https://img.newtrend.top/p/"+cat+period+i+".jpg",site:"美国",period_label:period,category:cat,leaf_category:cat,ratio:1+i,abs_delta:100-i*3});};
add("卫衣","2026W40",5);add("T恤","2026W40",5);add("T恤","2026W41",5);return out;}
function makeSB(){const it=items();const impl={getSession:async()=>({access_token:"T",user:{id:"u1",email:"a@b.c"}}),myRole:async()=>"super",getFrontendZoneVisibility:async()=>({}),rankFacets:async()=>({sites:SITES.slice(),periods:PERIODS.slice(),categories:CATS.slice()}),listRankSites:async()=>SITES.map(n=>({name:n})),getRankGroups:async()=>[{name:"欧洲",members:["英国"]}],getRankHidden:async()=>({sites:[],periods:[]}),listRankItems:async(f)=>{const s=(f&&f.sites)||[],p=(f&&f.periods)||[];return it.filter(x=>(!s.length||s.indexOf(x.site)>=0)&&(!p.length||p.indexOf(x.period_label)>=0));}};
return new Proxy(impl,{get(t,k){if(k in t)return t[k];if(typeof k!=="string")return undefined;return async()=>null;}});}
(async()=>{
for(const q of ["?mode=v&cat="+encodeURIComponent("卫衣")+"&sites="+encodeURIComponent("美国")+"&periods=2026W40,2026W41,2026W42","?mode=v&cat="+encodeURIComponent("鞋")+"&sites="+encodeURIComponent("美国")+"&periods=2026W40,2026W41,2026W42","?mode=h&cat="+encodeURIComponent("卫衣")+"&sites="+encodeURIComponent("美国,英国")+"&periods=2026W40"]){
const html=read("rank.html").replace(/<script src="[^"]*"><\/script>/g,"");
const dom=new JSDOM(html,{url:"https://newtrend.top/rank.html"+q,runScripts:"dangerously",pretendToBeVisual:true});
const w=dom.window;w.eval(read("js/config.js"));w.SB=makeSB();w.eval(read("js/rank.js"));
for(let i=0;i<70;i++)await sleep(20);
console.log("\n=== "+q);
console.log("pools:",Array.prototype.map.call(w.document.querySelectorAll("#rk-pools .rk-pool"),e=>e.querySelector(".rk-pool-head")?e.querySelector(".rk-pool-head").textContent.trim():e.className));
console.log("bodytext:",(w.document.querySelector("#rk-body").textContent||"").replace(/\s+/g," ").slice(0,200));
}
process.exit(0);})();
