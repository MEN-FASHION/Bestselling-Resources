/* 20261122Z2 · 「趋势上升榜还是不显示」的二次根治
   ------------------------------------------------------------------
   上一版（20261122Z）把站点清单改成了「从上传批次表聚合」，并加了
   「无站点时按全部站点展示」的降级。但降级没真正生效：

     ① load() 仍然以「没选到站点」为由直接返回，一句「暂无榜单数据」，
        而不再去取数 —— 降级开关打开了也白开；
     ② 筛选项只从批次表聚合，批次表读不到 / 批次里没存维度时期次也一起空，
        页面连「上传数据」都判不出来。

   本套用例锁死四件事：
     A. 站点降级态下「不加站点条件」并把空站点视作可查（含反向验证）
     B. 批次聚合为空时，从条目表兜底聚合（真跑聚合函数）
     C. 国家对比按站点名查空时，去掉站点条件再取一次（真跑 fetchItems 的这段）
     D. 站点空态文案能说清是「被前台显隐关掉」还是「数据没站点」
*/
import fs from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log("  ✓ " + n); }
  else { fail++; console.log("  ✗ " + n, extra === undefined ? "" : "→ " + JSON.stringify(extra)); }
};
const R = (p) => fs.readFileSync(p, "utf8");

const RANK = R("js/rank.js");
const SB = R("js/supabase.js");

function cutFn(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return "";
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); }
  }
  return "";
}

console.log("A、站点降级态下不再被「没选站点」挡住");

const fetchSitesSrc = cutFn(RANK, "function fetchSites()");
ok("取数站点函数存在", !!fetchSitesSrc);
ok("改前缺陷：只按 MODE 判断，站点空就会返回空数组",
  /if \(SITE_ALL \|\| NO_SITE\) return null;/.test(fetchSitesSrc));

function runFetchSites(env) {
  const ctx = {
    SITE_ALL: env.SITE_ALL, NO_SITE: env.NO_SITE, MODE: env.MODE, SEL_SITES: env.SEL_SITES,
    activeGroup: () => env.group || null,
  };
  vm.createContext(ctx);
  vm.runInContext(fetchSitesSrc.replace("function fetchSites(", "function fetchSites("), ctx);
  return ctx.fetchSites();
}
ok("无站点维度 → 不加站点条件（返回 null，取全部）", runFetchSites({ SITE_ALL: true, NO_SITE: true, MODE: "h", SEL_SITES: [] }) === null);
ok("选了「全部站点」→ 同样不加站点条件", runFetchSites({ SITE_ALL: true, NO_SITE: false, MODE: "v", SEL_SITES: [] }) === null);
ok("国家对比有站点 → 仍按所选站点取", JSON.stringify(runFetchSites({ SITE_ALL: false, NO_SITE: false, MODE: "h", SEL_SITES: ["美国"] })) === JSON.stringify(["美国"]));
ok("纵向对比 → 一直取全部站点（客户端再按站点过滤）", runFetchSites({ SITE_ALL: false, NO_SITE: false, MODE: "v", SEL_SITES: ["美国"] }) === null);
ok("地区模式 → 按地区成员取", JSON.stringify(runFetchSites({ SITE_ALL: false, NO_SITE: false, MODE: "v", SEL_SITES: [], group: { name: "欧洲", members: ["英国", "德国"] } })) === JSON.stringify(["英国", "德国"]));

const loadSrc = cutFn(RANK, "async function load()");
ok("load() 里把「站点降级」当成可查状态", /noSiteCond/.test(loadSrc) && /!noSiteCond && !sites\.length/.test(loadSrc));
ok("反向：把降级判断去掉，就会退回「站点空 → 不取数」", !/if \(!sites\.length \|\| !periods\.length\) \{ renderBody/.test(loadSrc));
ok("无站点维度时自动从国家对比切回时间对比", /if \(MODE === "h"\) MODE = "v";/.test(RANK));

console.log("B、批次聚合为空 → 从条目表兜底聚合");

const itemFacetsSrc = cutFn(SB, "async rankItemFacets(src, periodType)").replace("async rankItemFacets(", "async function rankItemFacets(");
ok("条目兜底聚合函数存在", !!itemFacetsSrc);
ok("前台 boot 里会调用它（期次为空时）", /rankItemFacets\("rank", "week"\)/.test(RANK));

function makeRows() {
  const rows = [];
  for (let i = 0; i < 6; i++) {
    rows.push({ id: i + 1, site: i % 2 ? "美国" : "美国站", period_label: "第45周", period_type: "week", category: "卫衣", source: "rank" });
  }
  rows.push({ id: 9, site: "英国", period_label: "2026年10月", period_type: "month", category: "卫衣", source: "rank" });
  rows.push({ id: 10, site: "德国", period_label: "第45周", period_type: "week", category: "卫衣", source: "rhythm" });
  return rows;
}
function makeClient(rows) {
  return {
    from() {
      let list = rows.slice();
      const api = {
        select() { return api; },
        order() { return api; },
        limit() { return api; },
        range(a, b) { list = rows.slice(a, b + 1); return api; },
        then(res) { res({ data: list, error: null }); },
      };
      return api;
    },
  };
}
async function runItemFacets(src, periodType) {
  const ctx = {
    client: makeClient(makeRows()),
    _colList: (t, c) => c,
  };
  vm.createContext(ctx);
  vm.runInContext(itemFacetsSrc, ctx);
  return await ctx.rankItemFacets(src, periodType);
}
const fb = await runItemFacets("rank", "week");
ok("条目兜底能取出周度期次", JSON.stringify(fb.periods) === JSON.stringify(["第45周"]));
ok("条目兜底能取出站点（同一国家的不同写法都保留，交由归一比对）",
  fb.sites.indexOf("美国") >= 0 && fb.sites.indexOf("美国站") >= 0);
ok("条目兜底按数据域隔离：上新节奏的德国不混进来", fb.sites.indexOf("德国") < 0);
ok("条目兜底按周度/月度隔离：月度条目不混进来", fb.periods.indexOf("2026年10月") < 0);
ok("条目兜底带类目", fb.categories.indexOf("卫衣") >= 0);

console.log("C、国家对比按站点名查空 → 去掉站点条件重取");

const fetchItemsSrc = cutFn(RANK, "async function fetchItems()");
ok("fetchItems 里有「查空则去掉站点条件」的兜底", /delete _noSite\.sites;/.test(fetchItemsSrc));
ok("兜底只在「有站点条件且结果为空」时触发", /if \(!items\.length && filter\.sites && filter\.sites\.length\)/.test(fetchItemsSrc));
ok("兜底取到了才替换（不做无意义覆盖）", /if \(\(_all \|\| \[\]\)\.length\) items = _all;/.test(fetchItemsSrc));
ok("反向：兜底不得丢掉类目/期次条件", /Object\.assign\(\{\}, filter\)/.test(fetchItemsSrc));

console.log("D、空态文案能分清两种原因");

ok("文案区分「前台显隐全关」", /前台显隐」把 /.test(RANK) && /后台「前台显隐」/.test(RANK));
ok("文案区分「数据没有站点字段」", /这批榜单数据没有国家站点字段/.test(RANK));
ok("「显隐全关」会带出被关掉的数量", /\(HIDDEN\.sites \|\| \[\]\)\.length/.test(RANK));
ok("空态下明确「图照常显示」，不再让人以为图丢了", /图照常显示/.test(RANK));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
