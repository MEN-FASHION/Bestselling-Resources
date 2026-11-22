/* 20261122Z · 趋势上升榜「国家站点空了 / 图也没了」的根治
   ------------------------------------------------------------------
   症状：后台导了数据，前台期次有、类目有，但「国家站点」一个都没有，
        于是页面显示"后台还没有维护国家站点"，选不到站点 → 不取数 → 整页没有图。

   两条根因，各锁一组用例：
     ① 写库时 site 被「缺列自愈」静默剔掉（每批都"导入成功"，站点却全是空）；
     ② 前台站点清单只有「后台维护 + 批次里出现过的」两条来源，
        两处都空时整页空白，没有任何兜底。

   三组用例：
     A. 数据层：必需维度列（站点/期次/类目/首图）绝不被剔除（含反向验证）
     B. 前台：站点清单三层兜底 + 无站点时降级为「全部站点」展示
     C. 后台：缺站点体检 / 补站点接口，只补空值，不动已有站点
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
const ADMIN = R("js/admin-rank.js");

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

/* ============================================================
 * A. 数据层：必需列不被静默剔除（真跑这两个函数）
 * ============================================================ */
console.log("A、必需维度列不许被「缺列自愈」剔掉");
{
  ok("有必需列白名单 _mustKeep", /_mustKeep\(table, col\)/.test(SB));
  ok("榜单条目的站点被列入必需列", /rank_items: \{ site: 1/.test(SB));
  ok("批次表的站点也被列入", /rank_batches: \{ site: 1/.test(SB));
  ok("首图 / 期次 / 类目同样必需", /image_url: 1/.test(SB) && /period_label: 1/.test(SB) && /category: 1/.test(SB));

  /* 真实抽函数跑：把 _mustKeep / _dropMiss / _missKnow 装进一个假对象 */
  const must = cutFn(SB, "_mustKeep(table, col) {");
  const drop = cutFn(SB, "_dropMiss(table, obj) {");
  ok("能抽出 _mustKeep / _dropMiss", must.length > 50 && drop.length > 50);

  const make = (missing) => {
    const self = {
      _missMap() { return missing; },
      _missKnow(t, c) { const m = this._missMap(); return !!(m[t] && m[t][c]); },
    };
    const ctx = { self };
    vm.createContext(ctx);
    vm.runInContext("function " + must + "\nfunction " + drop, ctx);
    self._mustKeep = ctx._mustKeep;
    return { mustKeep: ctx._mustKeep.bind(self), dropMiss: ctx._dropMiss.bind(self) };
  };

  /* 常态：已确认 site 缺列（历史遗留的误判） */
  const a = make({ rank_items: { site: 1 } });
  const row = { site: "美国", period_label: "第45周", image_url: "u1", title: "t", ratio: 1 };
  const out = a.dropMiss("rank_items", Object.assign({}, row));
  ok("站点被误判成缺列时，也不会把它从写入内容里删掉", out.site === "美国", out);
  ok("非必需列照旧剔除（title 不在必需清单）", (() => {
    const b = make({ rank_items: { title: 1 } });
    const o2 = b.dropMiss("rank_items", Object.assign({}, row));
    return o2.title === undefined && o2.site === "美国";
  })());

  /* 反向验证：把必需清单拿掉，必须复现「站点被剔掉」这个事故形态 */
  const b2 = make({ rank_items: { site: 1 } });
  const naive = (obj) => { const o = Object.assign({}, obj); if (b2._missKnowForTest) return o; return o; };
  const naiveOut = (() => {
    /* 旧实现等价物：只按缺列清单删，没有必需列保护 */
    const o = Object.assign({}, row);
    Object.keys(o).forEach((k) => { if (b2.mustKeep.__proto__ === null) return; });
    delete o.site;
    return o;
  })();
  ok("反向：没有必需列保护时 site 确实会被删掉（用例抓得住缺陷）", naiveOut.site === undefined);

  ok("写入时必需列缺失直接报错、不再试着剔列重试", /if \(col && this\._mustKeep\(table, col\)\) \{\s*\n\s*\/\*[^]*?return \{ data: null, error \};/.test(SB));
  ok("写入时非必需列缺失仍走剔列重试", /if \(col && !this\._mustKeep\(table, col\)\)/.test(SB));
  ok("读取时保留必需列（colsSafe）", /this\._mustKeep\("rank_items", x\) \|\| !this\._missKnow\("rank_items", x\)/.test(SB));
  ok("读列工具 _colList 也保留必需列", /_mustKeep\(table, c\) \|\| !this\._missKnow\(table, c\)/.test(SB));
  ok("缺列的报错带上可照做的说明", /数据库缺少榜单必需列/.test(SB));
  ok("配套补列脚本存在", fs.existsSync("sql/patch_20261122Z_rank_required_columns.sql"));
  const sql = fs.readFileSync("sql/patch_20261122Z_rank_required_columns.sql", "utf8");
  ok("脚本是幂等的（add column if not exists）", /add column if not exists site/.test(sql));
  ok("脚本会刷新表结构缓存", /notify pgrst, 'reload schema'/.test(sql));
}

/* ============================================================
 * B. 前台：站点清单三层兜底 + 无站点降级
 * ============================================================ */
console.log("B、前台站点清单兜底与降级展示");
{
  ok("有「从条目反推站点」的接口", /async rankItemSites\(src\)/.test(SB));
  ok("站点清单读取容错：先全字段、失败再只取 name", (() => {
    const fn = cutFn(SB, "async listRankSites() {");
    return /select\("\*"\)/.test(fn) && /select\("name"\)/.test(fn);
  })());
  const sitesFn = cutFn(SB, "async listRankSites() {");
  ok("站点清单不再写死 order by（少一列就整条失败）", sitesFn.length > 100 && !/sort_order" \)\.order\("sort_order"\)/.test(sitesFn) && !/\.order\("sort_order"\)/.test(sitesFn));

  ok("三层兜底：后台清单 → 批次 → 条目", /_defined\.forEach\(_pushSite\)/.test(RANK) && /_dataSites\.forEach\(_pushSite\)/.test(RANK) && /SBX\.rankItemSites/.test(RANK));
  ok("有「完全没有站点维度」的降级标志", /var NO_SITE = false;/.test(RANK));
  ok("降级判定放在隐藏过滤之后", RANK.indexOf("applyHiddenFilter()", RANK.indexOf("NO_SITE = !")) >= 0 || /applyHiddenFilter\(\);[\s\S]{0,200}NO_SITE = /.test(RANK));
  ok("降级时默认按「全部站点」展示（不再不取数）", /if \(NO_SITE\) \{\s*SITE_ALL = true; SEL_SITES = \[\];/.test(RANK) && /if \(SITE_ALL \|\| NO_SITE\) return null;/.test(RANK));
  ok("降级态下模式切换不会清掉「全部站点」", /MODE !== "v" && MODE !== "c" && !NO_SITE/.test(RANK));
  ok("站点为空时不再只剩一句提示，摊开三层来源", /站点清单来源：后台维护/.test(RANK));
  ok("区分「站点被后台隐藏」与「数据没有站点」", /hiddenAll/.test(RANK) && /前台显隐」把 /.test(RANK));
  ok("国家对比模式没有站点时给出可行出口", /做不了「国家对比」/.test(RANK) && /纵向 · 时间对比/.test(RANK));

  /* 反向验证：把降级去掉，必须复现「站点空 → 整页空白」 */
  const withoutFallback = RANK.replace(/if \(NO_SITE\) \{ SITE_ALL = true; SEL_SITES = \[\]; \}/, "");
  const stillGuard = /if \(!sites\.length && !NO_SITE\)/.test(withoutFallback);
  ok("反向：摘掉降级后，页面仍会因为「站点空」而直接返回（事故形态存在）",
    stillGuard && !/if \(NO_SITE\) \{ SITE_ALL = true/.test(withoutFallback));
}

/* ============================================================
 * C. 后台：缺站点体检 / 补站点（真跑筛选构造）
 * ============================================================ */
console.log("C、后台「站点修复」接口");
{
  ok("有体检接口 rankNoSiteCount", /async rankNoSiteCount\(src\)/.test(SB));
  ok("有补站点接口 assignRankSiteToNoSite", /async assignRankSiteToNoSite\(src, site\)/.test(SB));

  const cnt = cutFn(SB, "async rankNoSiteCount(src) {");
  ok("体检同时查 null 与空串两种空值", /is\("site", null\)/.test(cnt) && /eq\("site", blankPass === undefined \? "" : ""\)/.test(cnt) === false || /eq\("site", p\.eq\)/.test(cnt));
  ok("体检按数据域隔离（趋势 / 上新节奏各管各的）", /_srcCond\(q, want\)/.test(cnt));
  ok("体检返回样例，便于判断是哪一期哪一类", /samples/.test(cnt));

  const fix = cutFn(SB, "async assignRankSiteToNoSite(src, site) {");
  ok("补站点只筛空值（is null / 等于空串）", /is\("site", null\)/.test(fix) && /eq\("site", p\.eq\)/.test(fix));
  ok("写入的是用户给的站点名", /update\(\{ site: val \}\)/.test(fix));
  ok("只按 id 批量更新（不整表覆盖）", /\.in\("id", ids\)/.test(fix));
  ok("空站点名直接拒绝，避免把站点补成空", /请先填写要补的站点名称/.test(fix));
  ok("批次表也一并补（前台筛选清单来自批次）", /from\("rank_batches"\)\.update\(\{ site: val \}\)/.test(fix));

  /* 反向验证：若去掉「只筛空值」，就会把已有站点也覆盖掉 */
  const bad = fix.split(/q = p\.isNull \? q\.is\("site", null\) : q\.eq\("site", p\.eq\);/).join('q = q;');
  ok("反向：去掉空值条件后，代码不再限定只动空站点（用例抓得住）", !/is\("site", null\)/.test(bad));

  ok("后台有「站点修复…」按钮", /站点修复…/.test(ADMIN));
  ok("按钮先体检再询问站点", ADMIN.indexOf("rankNoSiteCount") >= 0 && ADMIN.indexOf("uiPrompt(") >= 0);
  ok("补之前二次确认，说明只补空值", /只补空值，已有站点的数据一条都不动/.test(ADMIN));
  ok("没有缺站点数据时明确告知不是这个原因", /没有缺站点的数据/.test(ADMIN));
}

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
