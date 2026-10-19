/* 前台只读：节庆库的维护（新建 / 编辑 / 删除 / 导入 / 导出 / 恢复默认）全部在后台「营销日历」里做。 */
var MK_READONLY = true;
var STORE_KEY = 'festival_dev_timeline_v1';
var SET_KEY = 'festival_dev_timeline_settings_v2';
var DAY = 86400000;

var state = {
  festivals: [],
  settings: { useCustom:true, sample:45, produce:30, ship:15 },
  view: 'cards',
  filters: { regions:[], cats:[], starMin:0 }
};

function defaultFestivals(){
  var out = [];
  for(var i=0;i<RAW.length;i++){
    var r = RAW[i];
    out.push({
      id:'d'+i,
      name:r[0], en:r[1], region:r[2], date:r[3], cat:r[4],
      star:r[5], lead:r[6], idea:r[7], overrides:r[8] || null,
      dur:(r[9]|0) || 1,
      note:'', custom:false
    });
  }
  return out;
}
function mergeDefaults(list){
  var have = {};
  for(var i=0;i<list.length;i++){ if(list[i] && list[i].id) have[list[i].id] = 1; }
  var defs = defaultFestivals(), added = 0;
  for(var d=0; d<defs.length; d++){
    if(!have[defs[d].id]){ list.push(defs[d]); added++; }
  }
  return added;
}
function load(){
  try{
    var raw = localStorage.getItem(STORE_KEY);
    state.festivals = raw ? JSON.parse(raw) : defaultFestivals();
    if(!Array.isArray(state.festivals) || !state.festivals.length) state.festivals = defaultFestivals();
    else{
      var ch = mergeDefaults(state.festivals);
      ch += backfillDurations(state.festivals);
      if(ch > 0) saveFestivals();
    }
  }catch(e){ state.festivals = defaultFestivals(); }
  try{
    var s = localStorage.getItem(SET_KEY);
    if(s){ var o = JSON.parse(s); for(var k in o){ if(o.hasOwnProperty(k)) state.settings[k]=o[k]; } }
  }catch(e){}
}
function saveFestivals(){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(state.festivals)); }catch(e){} }
function saveSettings(){ try{ localStorage.setItem(SET_KEY, JSON.stringify(state.settings)); }catch(e){} }

/* ============ 日期工具 ============ */
function todayStart(){ var d=new Date(); d.setHours(0,0,0,0); return d; }
function toDate(y,m,d){ var x=new Date(y,m-1,d); x.setHours(0,0,0,0); return x; }
function parseISO(s){ var p=s.split('-'); return toDate(+p[0],+p[1],+p[2]); }
function daysBetween(a,b){ return Math.round((b-a)/DAY); }
function pad2(n){ return (n<10?'0':'')+n; }
var WEEKDAYS = ['周日','周一','周二','周三','周四','周五','周六'];

function fmtFull(d){
  return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日 · '+WEEKDAYS[d.getDay()];
}
function fmtShort(d){ return (d.getMonth()+1)+'/'+d.getDate(); }

/* 计算某个节日在 >= today 的最近一次发生日期 */
function nextOccurrence(h, today){
  if(/^\d{4}-\d{2}-\d{2}$/.test(h.date)) return parseISO(h.date);
  var p = h.date.split('-');
  var bm = +p[0], bd = +p[1];
  for(var off=0; off<=3; off++){
    var y = today.getFullYear()+off;
    var m = bm, dd = bd;
    if(h.overrides && h.overrides[y]){
      var q = h.overrides[y].split('-');
      m = +q[0]; dd = +q[1];
    }
    var dt = toDate(y,m,dd);
    if(dt.getTime() >= today.getTime()) return dt;
  }
  return toDate(today.getFullYear()+4,bm,bd);
}
function isVariable(h){
  return !!(h.overrides && Object.keys(h.overrides).length);
}
function durDays(h){ var d = h && h.dur; return (typeof d==='number' && d>0) ? Math.round(d) : 1; }
function festEndDate(occ, dur){ return new Date(occ.getTime() + (Math.max(1,dur)-1)*DAY); }
function backfillDurations(list){
  var defs = defaultFestivals(), byId = {}, changed = 0;
  for(var i=0;i<defs.length;i++) byId[defs[i].id] = defs[i].dur;
  for(var j=0;j<list.length;j++){
    var f = list[j];
    if(typeof f.dur === 'number' && f.dur > 0) continue;
    f.dur = byId[f.id] || 1;
    changed++;
  }
  return changed;
}
function leadDays(h){
  if(state.settings.useCustom){
    return (state.settings.sample|0)+(state.settings.produce|0)+(state.settings.ship|0);
  }
  return h.lead|0;
}
function urgency(startDaysLeft){
  if(startDaysLeft < 0) return {key:'over', label:'已过启动点', color:'#9aa0aa'};
  if(startDaysLeft <= 20) return {key:'urgent', label:'立即启动', color:'#ff3b30'};
  if(startDaysLeft <= 60) return {key:'soon', label:'即将逼近', color:'#ff9f0a'};
  return {key:'ok', label:'时间从容', color:'#12a150'};
}

/* ============ 数据装配 ============ */
function buildList(){
  var today = todayStart();
  var f = state.filters;
  var out = [];
  for(var i=0;i<state.festivals.length;i++){
    var h = state.festivals[i];
    if(f.regions.length && f.regions.indexOf(h.region) < 0) continue;
    if(f.cats.length && f.cats.indexOf(h.cat) < 0) continue;
    if((h.star|0) < (f.starMin|0)) continue;
    var occ = nextOccurrence(h, today);
    var dl = daysBetween(today, occ);
    if(dl < 0 || dl > 400) continue;
    var lead = leadDays(h);
    var start = new Date(occ.getTime() - lead*DAY);
    var sdl = daysBetween(today, start);
    var dur = durDays(h);
    out.push({ h:h, occ:occ, daysLeft:dl, lead:lead, start:start, startDaysLeft:sdl,
               dur:dur, end:festEndDate(occ, dur), u:urgency(sdl) });
  }
  out.sort(function(a,b){ return a.occ - b.occ; });
  return out;
}
function allRegions(){
  var set = {}, arr = [];
  for(var i=0;i<state.festivals.length;i++){
    var r = state.festivals[i].region;
    if(!set[r]){ set[r]=1; arr.push(r); }
  }
  return arr;
}

/* ============ 渲染：侧边栏 ============ */
var openGroups = {};
var GROUPS_CACHE = {};

/* 国家区 HTML */
function regionDetailHTML(lab){
  var items = GROUPS_CACHE[lab] || [];
  var sel = 0;
  for(var d=0; d<items.length; d++){ if(state.filters.regions.indexOf(items[d])>=0) sel++; }
  var h = '<div class="rg-dhead">'
        +  '<span class="rg-dname">'+esc(lab)+' · 国家 / 地区</span>'
        +  '<span class="rg-dsel">已选 '+sel+'/'+items.length+'</span>'
        +  '<button class="rg-dall" data-whole="'+esc(lab)+'">'+(sel===items.length?'取消全选':'全选')+'</button>'
        +  '</div><div class="rg-cbody">';
  for(var c=0; c<items.length; c++){
    var on = state.filters.regions.indexOf(items[c])>=0;
    h += '<button class="rchip'+(on?' on':'')+'" data-region="'+esc(items[c])+'">'+esc(items[c])+'</button>';
  }
  return h + '</div>';
}

/* 悬停切换洲：只刷新洲标签状态与国家区，不重建整行（避免鼠标下方元素被替换导致反复触发） */
function refreshRegionDetail(){
  var lab = (openGroups.active && GROUPS_CACHE[openGroups.active]) ? openGroups.active : null;
  var rowEl = document.getElementById('rgRow');
  if(rowEl){
    var cards = rowEl.querySelectorAll('.rgc');
    for(var i=0; i<cards.length; i++){
      var nm = cards[i].querySelector('.rgc-name');
      var l = nm ? nm.getAttribute('data-whole') : null;
      var hit = !!l && l === lab;
      cards[i].classList.toggle('open', hit);
      var tog = cards[i].querySelector('.rgc-tog');
      if(tog) tog.setAttribute('aria-expanded', hit ? 'true' : 'false');
    }
  }
  var dEl = document.getElementById('rgDetail');
  if(dEl){
    dEl.innerHTML = lab ? regionDetailHTML(lab) : '';
    dEl.classList.toggle('show', !!lab);
  }
}
function renderFilters(){
  var regs = allRegions();

  /* ---- 地区：大洲行（点名称选整洲）+ 可展开挑国家 ---- */
  GROUPS_CACHE = {};
  for(var g=0; g<REGION_GROUPS.length; g++){
    var grp = REGION_GROUPS[g];
    var have = [];
    for(var q=0; q<grp.regions.length; q++){
      var rn = grp.regions[q];
      if(regs.indexOf(rn) >= 0) have.push(rn);
    }
    if(have.length) GROUPS_CACHE[grp.label] = have;
  }
  var covered = {};
  for(var g2=0; g2<REGION_GROUPS.length; g2++){
    for(var q2=0; q2<REGION_GROUPS[g2].regions.length; q2++) covered[REGION_GROUPS[g2].regions[q2]] = 1;
  }
  var rest = [];
  for(var z=0; z<regs.length; z++){ if(!covered[regs[z]]) rest.push(regs[z]); }
  if(rest.length) GROUPS_CACHE['其他'] = rest;

  var order = [];
  for(var g3=0; g3<REGION_GROUPS.length; g3++){
    if(GROUPS_CACHE[REGION_GROUPS[g3].label]) order.push(REGION_GROUPS[g3].label);
  }
  if(GROUPS_CACHE['其他']) order.push('其他');

  /* 保留横向滚动位置，避免重绘后跳回开头 */
  var oldRow = document.getElementById('rgRow');
  var keepScroll = oldRow ? oldRow.scrollLeft : 0;

  var activeLab = (openGroups.active && GROUPS_CACHE[openGroups.active]) ? openGroups.active : null;

  var row = '';
  for(var g4=0; g4<order.length; g4++){
    var lab = order[g4];
    var items = GROUPS_CACHE[lab];
    var selN = 0;
    for(var s=0; s<items.length; s++){ if(state.filters.regions.indexOf(items[s])>=0) selN++; }
    var cls = selN===0 ? '' : (selN===items.length ? 'on' : 'part');
    var isOpen = (lab === activeLab);
    row += '<div class="rgc ' + cls + (isOpen?' open':'') + '">'
        +  '<button class="rgc-name" data-whole="'+esc(lab)+'">'+esc(lab)
        +  '<span class="rgc-cnt">' + (selN ? selN+'/' : '') + items.length + '</span></button>'
        +  '<button class="rgc-tog" data-chev="'+esc(lab)+'" aria-label="展开 '+esc(lab)+' 的国家" aria-expanded="'+(isOpen?'true':'false')+'"></button>'
        +  '</div>';
  }

  document.getElementById('regionList').innerHTML =
      '<div class="rg-row" id="rgRow">' + row + '</div>'
    + '<div class="rg-detail'+(activeLab?' show':'')+'" id="rgDetail">'
    + (activeLab ? regionDetailHTML(activeLab) : '') + '</div>';

  var rowEl = document.getElementById('rgRow');
  if(rowEl && keepScroll) rowEl.scrollLeft = keepScroll;

  var selAll = state.filters.regions;
  var hintEl = document.getElementById('regionHint');
  if(hintEl){
    hintEl.textContent = selAll.length ? ('已选 '+selAll.length+' 个地区') : ('全部地区 · '+regs.length+' 个');
    hintEl.classList.toggle('on', selAll.length > 0);
  }
  var tagEl = document.getElementById('regionTags');
  if(tagEl){
    var show = selAll.slice(0,3), th = '';
    for(var y=0; y<show.length; y++) th += '<span class="fb-tag">'+esc(show[y])+'</span>';
    if(selAll.length > 3) th += '<span class="fb-tag more">+'+(selAll.length-3)+'</span>';
    tagEl.innerHTML = th;
  }
  var clrEl = document.getElementById('regionClear');
  if(clrEl) clrEl.classList.toggle('dim', selAll.length===0);

  var cc = document.getElementById('catChips');
  var ch = '';
  for(var k in CATS){
    if(!CATS.hasOwnProperty(k)) continue;
    var on2 = state.filters.cats.indexOf(k) >= 0;
    ch += '<button class="chip '+(on2?'active':'')+'" data-cat="'+k+'"><span class="cdot" style="background:'+CATS[k].color+'"></span>'+CATS[k].label+'</button>';
  }
  cc.innerHTML = ch;

  var sc = document.getElementById('starChips');
  var sh = '';
  var opts = [{v:0,t:'全部'},{v:3,t:'★★★ 重要以上'},{v:4,t:'★★★★ 重点'},{v:5,t:'★★★★★ 核心'}];
  for(var j=0;j<opts.length;j++){
    sh += '<button class="chip '+(state.filters.starMin===opts[j].v?'active':'')+'" data-star="'+opts[j].v+'">'+opts[j].t+'</button>';
  }
  sc.innerHTML = sh;
}
function esc(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ============ 渲染：统计 ============ */
function renderStats(list){
  var in30 = 0, needStart = 0, over = 0;
  for(var i=0;i<list.length;i++){
    if(list[i].daysLeft <= 30) in30++;
    if(list[i].startDaysLeft >= 0 && list[i].startDaysLeft <= 30) needStart++;
    if(list[i].startDaysLeft < 0) over++;
  }
  var near = list.length ? list[0] : null;
  var html = '';
  html += '<div class="stat" style="--sc:#2b46ff">'
       +  '<div class="k">未来 30 天节庆</div>'
       +  '<div class="v num">'+in30+'<small>个</small></div>'
       +  '<div class="s">当前筛选范围内的短期节点</div></div>';
  html += '<div class="stat" style="--sc:#ff9f0a">'
       +  '<div class="k">30 天内须启动开发</div>'
       +  '<div class="v num">'+needStart+'<small>个</small></div>'
       +  '<div class="s">按当前提前期倒推的最晚启动窗口</div></div>';
  html += '<div class="stat" style="--sc:#9aa1ab">'
       +  '<div class="k">已过启动点</div>'
       +  '<div class="v num">'+over+'<small>个</small></div>'
       +  '<div class="s">需压缩周期或改走快反补货</div></div>';
  html += '<div class="stat" style="--sc:#00a3a3">'
       +  '<div class="k">最近节点</div>'
       +  '<div class="v num" style="font-size:22px;line-height:1.3;margin-top:12px">'+(near?esc(near.h.name):'—')+'</div>'
       +  '<div class="s">'+(near? (near.occ.getMonth()+1)+'月'+near.occ.getDate()+'日 · 还剩 '+near.daysLeft+' 天' : '暂无数据')+'</div></div>';
  document.getElementById('stats').innerHTML = html;
}

/* ============ 渲染：时间轴 ============ */
function renderTimeline(list){
  var today = todayStart();
  var startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  var byKey = {};
  for(var i=0;i<list.length;i++){
    var o = list[i].occ;
    var k = o.getFullYear()+'-'+pad2(o.getMonth()+1);
    if(!byKey[k]) byKey[k] = [];
    byKey[k].push(list[i]);
  }
  var html = '';
  html += '<div class="sec-head"><h2>年度时间轴</h2><span class="sub">未来 12 个月 · 共 '+list.length+' 个节点</span><span class="line"></span></div>';

  for(var m=0;m<12;m++){
    var d = new Date(startMonth.getFullYear(), startMonth.getMonth()+m, 1);
    var key = d.getFullYear()+'-'+pad2(d.getMonth()+1);
    var items = byKey[key] || [];
    var isCur = (m===0);
    var delay = (m*0.035);
    html += '<div class="month-block'+(isCur?' current':'')+'" style="animation-delay:'+delay+'s">';
    html += '<div class="month-head"><span class="mnum num">'+pad2(d.getMonth()+1)+'</span><span class="mname">'+d.getFullYear()+' 年</span>'
         +  '<span class="cnt">'+items.length+' 个节点</span></div>';
    if(!items.length){
      html += '<div class="empty-month">本月暂无节庆 · 适合安排基础款打样与备货缓冲</div>';
    }else{
      html += '<div class="fest-grid">';
      for(var j=0;j<items.length;j++){
        var it = items[j];
        var c = CATS[it.h.cat] ? CATS[it.h.cat].color : '#9aa0aa';
        html += '<button class="fest" data-id="'+esc(it.h.id)+'" style="--c:'+c+';animation-delay:'+(delay+j*0.02)+'s">'
             +  '<span class="fdate"><b class="num">'+pad2(it.occ.getDate())+'</b><span>'+WEEKDAYS[it.occ.getDay()]+'</span></span>'
             +  '<span class="fmain"><span class="fname">'+esc(it.h.name)+'</span>'
             +  '<span class="fmeta">'+esc(it.h.region)+' · '+(CATS[it.h.cat]?CATS[it.h.cat].label:'')+(it.dur>1?(' · <b>持续 '+it.dur+' 天</b>'):'')+'</span></span>'
             +  '<span class="fright"><span class="fdays" style="color:'+it.u.color+'">'+it.daysLeft+'<span>天</span></span>'
             +  '<span class="fstat" style="color:'+it.u.color+'">'+it.u.label+'</span></span>'
             +  '</button>';
      }
      html += '</div>';
    }
    html += '</div>';
  }
  document.getElementById('view-timeline').innerHTML = html;
}

/* ============ 渲染：倒推推演 ============ */
function renderGantt(list){
  var today = todayStart();
  var WIN = 365;
  var monthCounts = [0,0,0,0,0,0,0,0,0,0,0,0];
  var chartIdx = [];
  var d0 = new Date(today.getFullYear(), today.getMonth(), 1);
  for(var i=0;i<12;i++){
    var dd = new Date(d0.getFullYear(), d0.getMonth()+i, 1);
    chartIdx.push({ y:dd.getFullYear(), m:dd.getMonth() });
  }
  for(var a=0;a<list.length;a++){
    var o = list[a].occ;
    for(var b=0;b<12;b++){
      if(chartIdx[b].y===o.getFullYear() && chartIdx[b].m===o.getMonth()){ monthCounts[b]++; break; }
    }
  }
  var maxC = 1;
  for(var c=0;c<12;c++){ if(monthCounts[c]>maxC) maxC = monthCounts[c]; }

  var html = '';
  html += '<div class="sec-head"><h2>开发倒推推演</h2><span class="sub">每根色带 = 从最晚启动日 → 节日当天</span><span class="line"></span></div>';

  html += '<div class="chart-wrap">';
  html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px;flex-wrap:wrap;gap:8px">'
       +  '<div style="font-family:var(--serif);font-size:15px;font-weight:700;letter-spacing:.1em">节庆密集度 · 未来 12 个月</div>'
       +  '<div style="font-size:11px;color:var(--ink-3);letter-spacing:.06em">柱高 = 该月需关注的节庆数量</div></div>';
  html += '<div class="chart">';
  for(var k=0;k<12;k++){
    var hh = Math.round((monthCounts[k]/maxC)*100);
    var isNow = (k===0);
    html += '<div class="col" title="'+chartIdx[k].m+1+'月 · '+monthCounts[k]+' 个">'
         +  '<div class="bval">'+monthCounts[k]+'</div>'
         +  '<div class="bar" style="height:'+Math.max(hh,2)+'%;animation-delay:'+(k*0.045)+'s;background:linear-gradient(180deg,'+(isNow?'#2b46ff,#1a2fd6':'#ccd2fa,#a9b3f3')+')"></div>'
         +  '<div class="blab">'+(chartIdx[k].m+1)+'月</div>'
         +  '</div>';
  }
  html += '</div>';

  var ug=0, so=0, ok=0, ov=0;
  for(var q=0;q<list.length;q++){
    var kk = list[q].u.key;
    if(kk==='urgent') ug++; else if(kk==='soon') so++; else if(kk==='ok') ok++; else ov++;
  }
  html += '<div class="press">'
       +  '<div class="pitem"><span class="pdot" style="background:#ff3b30"></span>立即启动 <b>'+ug+'</b></div>'
       +  '<div class="pitem"><span class="pdot" style="background:#ff9f0a"></span>即将逼近 <b>'+so+'</b></div>'
       +  '<div class="pitem"><span class="pdot" style="background:#12a150"></span>时间从容 <b>'+ok+'</b></div>'
       +  '<div class="pitem"><span class="pdot" style="background:#9aa0aa"></span>已过启动点 <b>'+ov+'</b></div>'
       +  '</div></div>';

  /* 甘特主体 */
  var ticks = '';
  for(var t=0;t<13;t++){
    var md = new Date(today.getFullYear(), today.getMonth()+t, 1);
    var off = daysBetween(today, md);
    if(off < 0 || off > WIN) continue;
    var lp = (off/WIN)*100;
    ticks += '<div class="tick" style="left:'+lp+'%"><span>'+(md.getMonth()+1)+'月</span></div>';
  }
  html += '<div class="gantt">';
  html += '<div class="gantt-head"><div class="gh-l">节日节点</div><div class="gh-r">'+ticks+'</div></div>';

  if(!list.length){
    html += '<div style="padding:40px;text-align:center;color:var(--ink-3);font-size:13px">当前筛选条件下没有符合条件的节庆</div>';
  }

  for(var n=0;n<list.length;n++){
    var it = list[n];
    var occOff = daysBetween(today, it.occ);
    if(occOff < 0 || occOff > WIN) continue;
    var startOff = daysBetween(today, it.start);
    var leftOff = Math.max(0, startOff);
    var leftPct = (leftOff/WIN)*100;
    var endOff = Math.min(daysBetween(today, it.end), WIN);
    var rightPct = (endOff/WIN)*100;
    var widthPct = Math.max(rightPct - leftPct, 0.6);
    var isOver = startOff < 0;
    var grid = '';
    for(var g=0;g<13;g++){
      var gd = new Date(today.getFullYear(), today.getMonth()+g, 1);
      var go = daysBetween(today, gd);
      if(go < 0 || go > WIN) continue;
      grid += '<div class="grid-line" style="left:'+((go/WIN)*100)+'%"></div>';
    }
    var barStyle = 'left:'+leftPct+'%;width:'+widthPct+'%;background:'+it.u.color+';color:'+it.u.color+';animation-delay:'+(n*0.03)+'s;';
    html += '<div class="grow">';
    html += '<div class="gl" data-id="'+esc(it.h.id)+'">'
         +  '<div class="gn">'+esc(it.h.name)+'</div>'
         +  '<div class="gm"><span class="tagline"><span class="cd" style="background:'+it.u.color+'"></span>'+it.lead+'天提前期</span>'
         +  '<span>·</span><span>'+esc(it.h.region)+'</span>'
         +  '<span>·</span><span>节期 '+fmtShort(it.occ)+(it.dur>1?('–'+fmtShort(it.end)):'')+'</span>'
         +  '<span class="durcli">持续 '+it.dur+' 天</span></div></div>';
    html += '<div class="track">'+grid
         +  '<div class="today-line" style="left:0%"></div>'
         +  '<div class="gbar'+(isOver?' overrun':'')+'" data-id="'+esc(it.h.id)+'" style="'+barStyle+'" title="'+esc(it.h.name)+'｜最晚启动：'+(isOver?'已过期':fmtShort(it.start))+'｜节期：'+fmtShort(it.occ)+(it.dur>1?('–'+fmtShort(it.end)):'')+'（持续 '+it.dur+' 天）">'
         +    '<span class="gl2"></span>'
         +    '<span class="blabel">'+it.startDaysLeft+'天</span>'
         +    '<span class="mk"></span>'
         +  '</div>'
         + '</div>';
    html += '</div>';
  }
  html += '</div>';
  document.getElementById('view-gantt').innerHTML = html;
}

/* ============ 渲染：卡片 ============ */
function renderCards(list){
  var html = '';
  html += '<div class="sec-head"><h2>节庆机会卡片</h2><span class="sub">含选品方向 · 按提前期倒推最晚启动日</span><span class="line"></span></div>';
  if(!list.length){
    html += '<div style="padding:50px;text-align:center;color:var(--ink-3);font-size:13px;letter-spacing:.05em">当前筛选条件下没有符合条件的节庆</div>';
  }
  html += '<div class="card-grid">';
  for(var i=0;i<list.length;i++){
    var it = list[i];
    var c = CATS[it.h.cat] ? CATS[it.h.cat].color : '#9aa0aa';
    var pct = Math.max(0, Math.min(1, 1 - it.daysLeft/365));
    var circ = 2*Math.PI*24;
    var dash = (circ*(it.daysLeft/365)).toFixed(1);
    html += '<article class="fcard" data-fid="'+esc(it.h.id)+'" style="--c:'+c+';animation-delay:'+(i*0.03)+'s">';
    html += '<div class="fest-edit-chip"><button type="button" data-edit="'+esc(it.h.id)+'">编辑</button>'
         +  '<button type="button" class="del" data-del="'+esc(it.h.id)+'">删除</button></div>';
    html += '<div class="band"></div>';
    html += '<div class="crow"><div><div class="cday num">'+pad2(it.occ.getDate())+'</div><div class="cmon">'+(it.occ.getMonth()+1)+' 月 · '+WEEKDAYS[it.occ.getDay()]+'</div></div>';
    html += '<div class="ring"><svg width="56" height="56"><circle cx="28" cy="28" r="24" fill="none" stroke="#eef0f3" stroke-width="4"></circle>'
         +  '<circle cx="28" cy="28" r="24" fill="none" stroke="'+it.u.color+'" stroke-width="4" stroke-linecap="round" stroke-dasharray="'+dash+' '+circ+'"></circle></svg>'
         +  '<div class="rin"><b class="num" style="color:'+it.u.color+'">'+it.daysLeft+'</b><span>天后</span></div></div></div>';
    html += '<div class="cname">'+esc(it.h.name)+'</div>';
    html += '<div class="cen">'+esc(it.h.en||'')+'</div>';
    html += '<div class="cmeta"><span class="mtag">'+esc(it.h.region)+'</span><span class="mtag" style="background:'+c+'1a;color:'+c+'">'+(CATS[it.h.cat]?CATS[it.h.cat].label:'')+'</span><span class="mtag dur">持续 '+it.dur+' 天</span><span class="mtag">'+'★'.repeat(it.h.star)+'</span>'
         +  (isVariable(it.h)?'<span class="mtag">浮动日期</span>':'')+'</div>';
    html += '<div class="cidea"><b>选品方向</b>'+esc(it.h.idea||'待补充')+'</div>';
    html += '<div class="cidea" style="border-top:none;padding-top:0;margin-top:10px"><b>时间推演</b>'
         +  '节期 <b class="num" style="font-size:13px">'+fmtShort(it.occ)+(it.dur>1?(' – '+fmtShort(it.end)):'')+'</b> · '
         +  '提前期 <b class="num" style="font-size:13px">'+it.lead+'</b> 天 · 最晚启动 '
         +  '<b class="num" style="font-size:13px">'+(it.startDaysLeft<0?'已过期':fmtShort(it.start))+'</b>'
         +  (it.startDaysLeft>=0? '（'+it.startDaysLeft+' 天后）':'')+'</div>';
    html += '</article>';
  }
  html += '</div>';
  document.getElementById('view-cards').innerHTML = html;
}

/* ============ 主渲染 ============ */
function render(){
  var list = buildList();
  renderFilters();
  renderStats(list);
  document.getElementById('view-timeline').classList.toggle('hidden', state.view!=='timeline');
  document.getElementById('view-gantt').classList.toggle('hidden', state.view!=='gantt');
  document.getElementById('view-cards').classList.toggle('hidden', state.view!=='cards');
  if(state.view==='timeline') renderTimeline(list);
  else if(state.view==='gantt') renderGantt(list);
  else renderCards(list);
  var tabs = document.querySelectorAll('#viewTabs button');
  for(var i=0;i<tabs.length;i++){
    tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view')===state.view);
  }
}

/* ============ 弹窗 ============ */
var editingId = null;
function openModal(id){
  editingId = id;
  var h = null;
  if(id){
    for(var i=0;i<state.festivals.length;i++){ if(state.festivals[i].id===id){ h = state.festivals[i]; break; } }
  }
  var isNew = !h;
  if(isNew){
    h = { id:'', name:'', en:'', region:allRegions()[0]||'全球', date:fmtISODefault(), cat:'trad', star:3, lead:120, dur:1, idea:'', note:'', overrides:null, custom:true };
  }
  var regs = allRegions();
  var regOpts = '';
  for(var r=0;r<regs.length;r++){
    regOpts += '<option value="'+esc(regs[r])+'"'+(regs[r]===h.region?' selected':'')+'>'+esc(regs[r])+'</option>';
  }
  regOpts += '<option value="__new"'+(regs.indexOf(h.region)<0?' selected':'')+'>＋ 新增地区…</option>';

  var catOpts = '';
  for(var k in CATS){ if(!CATS.hasOwnProperty(k)) continue;
    catOpts += '<option value="'+k+'"'+(k===h.cat?' selected':'')+'>'+CATS[k].label+'</option>';
  }

  var stars = '';
  for(var s=1;s<=5;s++){
    stars += '<button type="button" class="'+(s<=h.star?'on':'')+'" data-star="'+s+'">★</button>';
  }

  var repeat = !/^\d{4}-\d{2}-\d{2}$/.test(h.date);
  var dateVal = /^\d{4}-\d{2}-\d{2}$/.test(h.date) ? h.date : (todayStart().getFullYear()+'-'+h.date);

  var html = '';
  html += '<div class="modal-head"><div style="flex:1"><h2 id="mTitle">'+(isNew?'新建节庆节点':'编辑节庆节点')+'</h2>'
       +  '<p>设定节日时间后，系统会自动倒推「最晚启动开发日」</p></div>'
       +  '<button class="btn btn-ghost" id="mClose" style="padding:6px 12px">关闭</button></div>';
  html += '<div class="modal-body">';
  html += '<div class="preview" id="mPreview"></div>';

  html += '<div class="grid2">';
  html += '<div class="field"><label>节日名称 *</label><input type="text" id="fName" value="'+esc(h.name)+'" placeholder="如：万圣节"></div>';
  html += '<div class="field"><label>英文 / 别名</label><input type="text" id="fEn" value="'+esc(h.en)+'" placeholder="Halloween"></div>';
  html += '</div>';

  html += '<div class="grid2">';
  html += '<div class="field"><label>地区</label><select id="fRegion">'+regOpts+'</select>'
       +  '<input type="text" id="fRegionNew" class="hidden" style="margin-top:8px" placeholder="输入新地区名称"></div>';
  html += '<div class="field"><label>节庆类别</label><select id="fCat">'+catOpts+'</select></div>';
  html += '</div>';

  html += '<div class="grid2">';
  html += '<div class="field"><label>日期 *</label><input type="date" id="fDate" value="'+dateVal+'">'
       +  '<label class="checkline" style="margin-top:9px"><input type="checkbox" id="fRepeat" '+(repeat?'checked':'')+'> 每年重复（仅取月-日）</label></div>';
  html += '<div class="field"><label>重要度</label><div class="star-pick" id="fStars">'+stars+'</div>'
       +  '<div class="hint" id="starText">'+(h.star>=5?'核心节点':h.star>=4?'重点节点':h.star>=3?'重要节点':'一般节点')+'</div></div>';
  html += '</div>';

  html += '<div class="grid2">';
  html += '<div class="field"><label>持续时间（天）</label><input type="number" id="fDur" min="1" max="400" step="1" value="'+durDays(h)+'">'
       +  '<div class="hint">节期长度。>1 时色带会覆盖整个节期，便于预留备货窗口。</div></div>';
  html += '<div class="field"><label>推荐提前期（天）</label><input type="number" id="fLead" min="0" max="400" step="5" value="'+(h.lead|0)+'">'
       +  '<div class="hint">= 设计打样 + 大货生产 + 物流入仓。自定义周期下此值被覆盖。</div></div>';
  html += '</div>';

  html += '<div class="field"><label>选品方向 / 机会点</label><textarea id="fIdea" placeholder="如：cosplay 主题服、暗黑哥特风、南瓜橙紫配色单品">'+esc(h.idea)+'</textarea></div>';
  html += '<div class="field"><label>备注</label><textarea id="fNote" style="min-height:56px" placeholder="补充说明、渠道策略等">'+esc(h.note||'')+'</textarea></div>';

  html += '<div class="modal-foot">';
  if(!isNew){
    html += '<button class="btn btn-danger" id="mDel" data-confirm="0">删除此节点</button>';
  }
  html += '<div class="spacer"></div>';
  html += '<button class="btn btn-ghost" id="mCancel">取消</button>';
  html += '<button class="btn btn-primary" id="mSave">'+(isNew?'创建节点':'保存修改')+'</button>';
  html += '</div>';

  html += '</div>';
  document.getElementById('modal').innerHTML = html;
  document.getElementById('backdrop').classList.add('open');
  setTimeout(function(){ var el=document.getElementById('fName'); if(el) el.focus(); }, 120);
  bindModal(isNew, h);
  updatePreview();
}
function fmtISODefault(){
  var d = todayStart();
  return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
}
function closeModal(){
  document.getElementById('backdrop').classList.remove('open');
  editingId = null;
}
function currentModalStar(){
  var el = document.getElementById('fStars').querySelector('button.on');
  if(!el) return 3;
  return parseInt(el.getAttribute('data-star'),10);
}
function updatePreview(){
  var nameEl = document.getElementById('fName');
  if(!nameEl) return;
  var name = nameEl.value || '未命名节庆';
  var dateEl = document.getElementById('fDate');
  var repEl = document.getElementById('fRepeat');
  var v = dateEl.value;
  var occ;
  if(repEl.checked && v.length>=10){
    var p = v.split('-');
    var tmp = { date:p[1]+'-'+p[2], overrides:null };
    occ = nextOccurrence(tmp, todayStart());
  }else if(v.length>=10){
    occ = parseISO(v);
  }else{
    occ = null;
  }
  var lead = parseInt(document.getElementById('fLead').value,10) || 0;
  if(state.settings.useCustom){
    lead = (state.settings.sample|0)+(state.settings.produce|0)+(state.settings.ship|0);
  }
  var durEl = document.getElementById('fDur');
  var dur = durEl ? (parseInt(durEl.value,10) || 1) : 1;
  if(dur < 1) dur = 1;
  var el = document.getElementById('mPreview');
  if(!occ){ el.innerHTML = '请填写完整日期'; return; }
  var start = new Date(occ.getTime() - lead*DAY);
  var end = festEndDate(occ, dur);
  var dl = daysBetween(todayStart(), occ);
  var sdl = daysBetween(todayStart(), start);
  var u = urgency(sdl);
  el.innerHTML = '「<b>'+esc(name)+'</b>」 节期 <b>'+fmtFull(occ)+(dur>1?(' – '+fmtFull(end)):'')+'</b>'
    + '（持续 <b>'+dur+'</b> 天 · 距开始 '+dl+' 天）<br>'
    + '提前期 <b>'+lead+'</b> 天 · 最晚启动日 <b>'+(sdl<0?'已过期':fmtFull(start))+'</b> · '
    + '<span style="color:'+u.color+';font-weight:600">'+u.label+'</span>';
}
function bindModal(isNew, h){
  document.getElementById('mClose').onclick = closeModal;
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('fName').oninput = updatePreview;
  document.getElementById('fDate').oninput = updatePreview;
  document.getElementById('fRepeat').onchange = updatePreview;
  document.getElementById('fLead').oninput = updatePreview;
  document.getElementById('fDur').oninput = updatePreview;

  document.getElementById('fRegion').onchange = function(){
    var nw = document.getElementById('fRegionNew');
    if(this.value==='__new'){ nw.classList.remove('hidden'); nw.focus(); }
    else nw.classList.add('hidden');
  };
  if(document.getElementById('fRegion').value==='__new'){
    document.getElementById('fRegionNew').classList.remove('hidden');
  }

  var sb = document.getElementById('fStars').querySelectorAll('button');
  for(var i=0;i<sb.length;i++){
    sb[i].onclick = function(){
      var n = parseInt(this.getAttribute('data-star'),10);
      var all = document.getElementById('fStars').querySelectorAll('button');
      for(var j=0;j<all.length;j++){
        all[j].classList.toggle('on', parseInt(all[j].getAttribute('data-star'),10) <= n);
      }
      document.getElementById('starText').textContent = n>=5?'核心节点':n>=4?'重点节点':n>=3?'重要节点':'一般节点';
    };
  }

  var delBtn = document.getElementById('mDel');
  if(delBtn){
    delBtn.onclick = function(){
      if(this.getAttribute('data-confirm')!=='1'){
        this.setAttribute('data-confirm','1');
        this.textContent = '再点一次确认删除';
        this.style.background = 'var(--accent)';
        this.style.color = '#fff';
        return;
      }
      var idx = -1;
      for(var i=0;i<state.festivals.length;i++){ if(state.festivals[i].id===h.id){ idx=i; break; } }
      if(idx>=0) state.festivals.splice(idx,1);
      saveFestivals(); closeModal(); render(); toast('已删除「'+h.name+'」');
    };
  }

  document.getElementById('mSave').onclick = function(){
    var name = document.getElementById('fName').value.trim();
    if(!name){ toast('请填写节日名称'); return; }
    var dv = document.getElementById('fDate').value;
    if(!dv){ toast('请选择日期'); return; }
    var rep = document.getElementById('fRepeat').checked;
    var p = dv.split('-');
    var dateStr = rep ? (p[1]+'-'+p[2]) : dv;

    var regSel = document.getElementById('fRegion').value;
    var region = regSel==='__new' ? (document.getElementById('fRegionNew').value.trim() || '其他') : regSel;
    var cat = document.getElementById('fCat').value;
    var star = currentModalStar();
    var lead = parseInt(document.getElementById('fLead').value,10);
    if(isNaN(lead) || lead<0) lead = 0;
    var dur = parseInt(document.getElementById('fDur').value,10);
    if(isNaN(dur) || dur<1) dur = 1;
    var idea = document.getElementById('fIdea').value.trim();
    var note = document.getElementById('fNote').value.trim();

    if(isNew){
      var nid = 'u'+Date.now().toString(36)+Math.floor(Math.random()*1000).toString(36);
      state.festivals.push({ id:nid, name:name, en:document.getElementById('fEn').value.trim(), region:region, date:dateStr, cat:cat, star:star, lead:lead, dur:dur, idea:idea, note:note, overrides:null, custom:true });
      toast('已创建「'+name+'」');
    }else{
      h.name=name; h.en=document.getElementById('fEn').value.trim(); h.region=region; h.date=dateStr;
      h.cat=cat; h.star=star; h.lead=lead; h.dur=dur; h.idea=idea; h.note=note;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) h.overrides = h.overrides||null;
      else h.overrides = null;
      h.custom = true;
      toast('已保存「'+name+'」');
    }
    saveFestivals(); closeModal(); render();
  };
}

/* ============ Toast ============ */
var toastTimer = null;
function toast(msg){
  var el = document.getElementById('mkToast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove('show'); }, 2200);
}

/* ============ 交互绑定 ============ */
function bindGlobal(){
  document.getElementById('backdrop').onclick = function(e){
    if(e.target === this) closeModal();
  };
  /* 外部收起：用 pointerdown 判定（早于 click 重绘，目标仍在文档中） */
  document.addEventListener('pointerdown', function(e){
    var fb = document.getElementById('filterbar');
    if(!fb || !fb.classList.contains('open')) return;
    var t = e.target;
    if(fb.contains(t) || !document.documentElement.contains(t)) return;
    fb.classList.remove('open');
  }, true);
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeModal(); });


  document.getElementById('viewTabs').addEventListener('click', function(e){
    var b = e.target.closest('button');
    if(!b) return;
    state.view = b.getAttribute('data-view');
    render();
    window.scrollTo({ top:0, behavior:'smooth' });
  });

  /* 筛选 */
  /* 地区筛选：悬停自动展开，移开缓冲收起 */
  var fbEl = document.getElementById('filterbar');
  var fbTrigger = document.getElementById('fbTrigger');
  var fbPanel = document.getElementById('regionPanel');
  var fbOpenTimer = null, fbCloseTimer = null;
  function fbSync(){
    fbTrigger.setAttribute('aria-expanded', fbEl.classList.contains('open') ? 'true' : 'false');
  }
  function fbOpen(delay){
    clearTimeout(fbCloseTimer); clearTimeout(fbOpenTimer);
    if(fbEl.classList.contains('open')) return;
    fbOpenTimer = setTimeout(function(){ fbEl.classList.add('open'); fbSync(); }, delay || 0);
  }
  function fbClose(delay){
    clearTimeout(fbOpenTimer); clearTimeout(fbCloseTimer);
    fbCloseTimer = setTimeout(function(){ fbEl.classList.remove('open'); fbSync(); }, delay || 0);
  }
  var canHover = !!(window.matchMedia && window.matchMedia('(hover:hover)').matches);

  if(canHover){
    fbEl.addEventListener('mouseenter', function(){ fbOpen(80); });
    fbEl.addEventListener('mouseleave', function(){ fbClose(340); });
    fbPanel.addEventListener('mouseenter', function(){ clearTimeout(fbCloseTimer); });
    fbPanel.addEventListener('mouseleave', function(){ fbClose(340); });

    /* 悬停到某个洲 → 自动展开该洲国家；移出国家区 → 缓冲收起 */
    var rgOpenTimer = null, rgCloseTimer = null;
    var rgList = document.getElementById('regionList');
    if(rgList){
      rgList.addEventListener('mouseover', function(e){
        clearTimeout(rgCloseTimer);
        var card = (e.target && e.target.closest) ? e.target.closest('.rgc') : null;
        if(!card) return;
        var nm = card.querySelector('.rgc-name');
        var lab = nm ? nm.getAttribute('data-whole') : null;
        if(!lab || lab === openGroups.active) return;
        clearTimeout(rgOpenTimer);
        rgOpenTimer = setTimeout(function(){
          openGroups.active = lab;
          refreshRegionDetail();   /* 切到哪个洲，下面就直接展开那个洲的国家 */
        }, 60);
      });
      rgList.addEventListener('mouseleave', function(){
        clearTimeout(rgOpenTimer);
        rgCloseTimer = setTimeout(function(){
          openGroups.active = null;
          refreshRegionDetail();
        }, 700);   /* 给足时间从洲名移到国家区，不要一离开就收起 */
      });
    }
    fbTrigger.addEventListener('focus', function(){ fbOpen(0); });
    fbEl.addEventListener('focusout', function(e){
      if(!fbEl.contains(e.relatedTarget)) fbClose(120);
    });
  }
  fbTrigger.addEventListener('click', function(){
    if(canHover) return;              /* 支持悬停的设备由悬停控制，点击不误关 */
    if(fbEl.classList.contains('open')) fbClose(0); else fbOpen(0);
  });
  document.getElementById('regionClear').addEventListener('click', function(e){
    e.stopPropagation();
    state.filters.regions = [];
    render();
  });
  document.getElementById('regionList').addEventListener('click', function(e){
    var b = e.target.closest('button');
    if(!b) return;
    if(b.hasAttribute('data-chev')){
      var gb = b.getAttribute('data-chev');
      openGroups.active = (openGroups.active === gb) ? null : gb;
      renderFilters();
      return;
    }
    if(b.hasAttribute('data-whole')){
      var lab = b.getAttribute('data-whole');
      var items = GROUPS_CACHE[lab] || [];
      openGroups.active = lab;
      var allOn = items.length > 0;
      for(var i=0;i<items.length;i++){ if(state.filters.regions.indexOf(items[i])<0){ allOn=false; break; } }
      for(var j=0;j<items.length;j++){
        var idx = state.filters.regions.indexOf(items[j]);
        if(allOn){ if(idx>=0) state.filters.regions.splice(idx,1); }
        else if(idx<0) state.filters.regions.push(items[j]);
      }
      render();
      return;
    }
    if(b.hasAttribute('data-region')){
      var v = b.getAttribute('data-region');
      var i2 = state.filters.regions.indexOf(v);
      if(i2>=0) state.filters.regions.splice(i2,1); else state.filters.regions.push(v);
      render();
    }
  });
  document.getElementById('catChips').addEventListener('click', function(e){
    var b = e.target.closest('.chip');
    if(!b) return;
    var v = b.getAttribute('data-cat');
    var i = state.filters.cats.indexOf(v);
    if(i>=0) state.filters.cats.splice(i,1); else state.filters.cats.push(v);
    render();
  });
  document.getElementById('starChips').addEventListener('click', function(e){
    var b = e.target.closest('.chip');
    if(!b) return;
    state.filters.starMin = parseInt(b.getAttribute('data-star'),10);
    render();
  });

  /* 周期模式 */
  document.getElementById('modeRec').onclick = function(){
    state.settings.useCustom = false; saveSettings(); syncMode(); render();
  };
  document.getElementById('modeCus').onclick = function(){
    state.settings.useCustom = true; saveSettings(); syncMode(); render();
  };
  ['Sample','Produce','Ship'].forEach(function(key){
    var sid = 's'+key, vid = 'v'+key;
    document.getElementById(sid).addEventListener('input', function(){
      state.settings[key.toLowerCase()] = parseInt(this.value,10)||0;
      document.getElementById(vid).textContent = state.settings[key.toLowerCase()];
      var tot = (state.settings.sample|0)+(state.settings.produce|0)+(state.settings.ship|0);
      document.getElementById('vTotal').textContent = tot;
      saveSettings();
      if(state.view!=='timeline') render(); else render();
    });
  });

  /* 卡片操作 / 时间轴 / 甘特点击 */
  document.querySelector('.main-inner').addEventListener('click', function(e){
    var actBtn = e.target.closest('button[data-act]');
    if(actBtn && MK_READONLY){ return; }   /* 前台只读：不响应任何编辑/删除 */
    if(actBtn){
      var id = actBtn.getAttribute('data-id');
      if(actBtn.getAttribute('data-act')==='edit'){ openModal(id); return; }
      if(actBtn.getAttribute('data-act')==='del'){
        var h = null;
        for(var i=0;i<state.festivals.length;i++){ if(state.festivals[i].id===id){ h=state.festivals[i]; break; } }
        if(h && confirm('确认删除「'+h.name+'」？此操作不可撤销。')){
          state.festivals.splice(i,1); saveFestivals(); render(); toast('已删除「'+h.name+'」');
        }
        return;
      }
    }
    /* 前台只读：点卡片不再打开编辑弹窗（维护在后台「营销日历」） */
  });

  /* 日期归一化：支持 02-17 / 2-17 / 2027-02-17 / 2027/2/17 */
function normMMDD(v){
  if(typeof v !== 'string') return '';
  var s = v.trim().replace(/[\/.]/g, '-');
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if(!m) m = /^(\d{1,2})-(\d{1,2})$/.exec(s);
  if(!m) return '';
  var mo = parseInt(m[m.length-2], 10), d = parseInt(m[m.length-1], 10);
  if(!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
  return (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
}

/* 数据管理（导出 / 导入 / 恢复默认）已迁到后台「营销日历」，前台只读，这里不再有任何写入口。 */
}
function syncMode(){
  document.getElementById('modeRec').classList.toggle('active', !state.settings.useCustom);
  document.getElementById('modeCus').classList.toggle('active', state.settings.useCustom);
  document.getElementById('customPanel').classList.toggle('hidden', !state.settings.useCustom);
  document.getElementById('sSample').value = state.settings.sample;
  document.getElementById('sProduce').value = state.settings.produce;
  document.getElementById('sShip').value = state.settings.ship;
  document.getElementById('vSample').textContent = state.settings.sample;
  document.getElementById('vProduce').textContent = state.settings.produce;
  document.getElementById('vShip').textContent = state.settings.ship;
  document.getElementById('vTotal').textContent = (state.settings.sample|0)+(state.settings.produce|0)+(state.settings.ship|0);
}

/* ============ 节庆库数据源：后台维护的数据库（前台只读） ============
 * 顺序：先用内置库把页面画出来（不会白屏）→ 再异步取数据库里那一份 → 有数据就替换并重绘。
 * 数据库为空（后台还没点过"恢复默认节庆库"）时保持内置库，保证前台永远有内容。
 * ============================================================ */
function dbRowToFestival(r){
  return {
    id: String(r.id),
    name: r.name || '',
    en: r.en || '',
    region: r.region || '其他',
    date: normMMDD(r.date) || r.date || '',
    cat: CATS[r.cat] ? r.cat : 'trad',
    star: Math.min(5, Math.max(1, parseInt(r.star,10) || 3)),
    lead: Math.max(0, parseInt(r.lead,10) || 120),
    dur: Math.max(1, parseInt(r.dur,10) || 1),
    idea: r.idea || '',
    note: r.note || '',
    overrides: (r.overrides && typeof r.overrides === 'object') ? r.overrides : null,
    custom: true
  };
}
function loadFestivalsFromDb(){
  if(!window.SB || typeof SB.listFestivals !== 'function') return;
  Promise.resolve()
    .then(function(){ return SB.listFestivals(); })
    .then(function(res){
      var rows = (res && res.data) || [];
      if(!rows.length) return;                       /* 后台还没维护过 → 保留内置库 */
      var list = [];
      for(var i=0;i<rows.length;i++){
        var f = dbRowToFestival(rows[i]);
        if(f.name && f.date) list.push(f);
      }
      if(!list.length) return;
      backfillDurations(list);
      state.festivals = list;
      render();
    })
    .catch(function(){ /* 读不到就用内置库，绝不让页面报错 */ });
}

/* ============ 启动 ============ */
(function init(){
  load();
  loadFestivalsFromDb();
  document.getElementById('todayText').textContent = '今天 ' + fmtFull(todayStart());
  syncMode();
  bindGlobal();
  render();
})();

/* ============================================================
 * 已发布营销素材（数据库内容）
 * 后台「营销日历管理」里已发布的节点与文章，在新界面底部以统一风格列出，
 * 便于与节庆库对照；无数据时整块隐藏。
 * ============================================================ */
(function () {
  var loaded = false, tries = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtDate(v) {
    var s = String(v == null ? '' : v).trim();
    var m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return m[2] + '月' + m[3] + '日';
    return s;
  }

  function openDoc(it) {
    var wrap = document.querySelector('.mkzone');
    if (!wrap) return;
    var bd = document.createElement('div');
    bd.className = 'backdrop open';
    bd.innerHTML = '<div class="modal" role="dialog" aria-modal="true">'
      + '<div class="modal-head"><div style="flex:1"><h2>' + esc(it.title) + '</h2>'
      + (it.date ? '<p>' + esc(fmtDate(it.date)) + '</p>' : '') + '</div>'
      + '<button class="btn btn-ghost" data-close="1">关闭</button></div>'
      + '<div class="modal-body" style="padding-bottom:20px"><div style="font-size:13px;line-height:1.85;color:var(--mk-ink2);white-space:pre-wrap">'
      + esc(it.desc || it.content || '暂无正文') + '</div></div></div>';
    wrap.appendChild(bd);
    bd.addEventListener('click', function (e) {
      if (e.target === bd || e.target.getAttribute('data-close')) bd.remove();
    });
  }

  async function render() {
    var box = document.getElementById('mk-db');
    var grid = document.getElementById('mk-db-grid');
    if (!box || !grid || !window.SB) return;
    var nodes = [], arts = [];
    try { var r1 = await SB.listMarketingNodes(); nodes = (r1 && r1.data) || []; } catch (e) {}
    try { var r2 = await SB.listMarketingArticles(true); arts = (r2 && r2.data) || []; } catch (e) {}

    var items = [];
    arts.forEach(function (a) {
      items.push({ title: a.title, desc: a.summary || a.content || '', image: a.image || '',
                   url: a.url || '', date: a.created_at, content: a.content || '' });
    });
    nodes.forEach(function (n) {
      var has = arts.some(function (a) { return String(a.node_id) === String(n.id); });
      if (!has) items.push({ title: n.title, desc: n.description || '', image: n.image || '', url: n.url || '', date: n.date });
    });
    if (!items.length) { box.classList.add('hidden'); return; }

    var html = '';
    items.forEach(function (it, i) {
      html += '<button class="db-card" data-i="' + i + '">'
        + '<div class="db-img">' + (it.image ? '<img alt="" data-path="' + esc(it.image) + '" loading="lazy">' : '') + '</div>'
        + '<div class="db-body">'
        + (it.date ? '<div class="db-date">' + esc(fmtDate(it.date)) + '</div>' : '')
        + '<div class="db-title">' + esc(it.title) + '</div>'
        + (it.desc ? '<div class="db-desc">' + esc(it.desc) + '</div>' : '')
        + '</div></button>';
    });
    grid.innerHTML = html;
    box.classList.remove('hidden');

    grid.querySelectorAll('img[data-path]').forEach(function (im) {
      var p = im.getAttribute('data-path');
      if (!p) return;
      if (typeof SB.marketingImageUrl === 'function') {
        SB.marketingImageUrl(p).then(function (u) { if (u) im.src = u; }).catch(function () {});
      } else { im.src = p; }
    });
    grid.addEventListener('click', function (e) {
      var c = e.target.closest('.db-card');
      if (!c) return;
      var it = items[parseInt(c.getAttribute('data-i'), 10)];
      if (!it) return;
      if (it.url) window.open(it.url, '_blank', 'noopener,noreferrer');
      else openDoc(it);
    });
  }

  function tick() {
    if (loaded) return;
    var v = document.getElementById('marketing-view');
    if (v && !v.classList.contains('hidden')) {
      loaded = true;
      render();
      return;
    }
    if (++tries > 600) { loaded = true; return; }   // 约 12 分钟仍未见页面则停止
    setTimeout(tick, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
  else tick();
})();
