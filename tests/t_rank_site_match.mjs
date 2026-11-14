/* 20261113D · 站点名对不上导致「数据在库里、前台一片空白」
   ---------------------------------------------------------------
   症状：后台传完数据，前台某个「类目 + 国家 + 周次」组合整片空白，
        看起来像数据没传上去（其实取到了条目，只是站点名和菜单名对不上）。

   这里锁住四件事：
     ① 站点归一：美国 / 美国站 / US / 美国(US) / 美国-全托管 都是同一个国家
     ② 前台过滤用归一键（不是字符串精确相等）
     ③ 所选站点没数据时不再给空白页，改为按全部站点显示并写明原因
     ④ 数据层的兜底查询不再丢掉筛选条件（以前会返回整表前 1000 行）
     ⑤ 导入侧把站点名归一成后台清单里的名字，并对认不出的名字点名
*/
import fs from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log("  ✓ " + n); }
  else { fail++; console.log("  ✗ " + n, extra === undefined ? "" : "→ " + JSON.stringify(extra)); }
};
const R = (p) => fs.readFileSync(p, "utf8");

/* ---- 真实加载站点归一模块 ---- */
const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(R("js/site-norm.js"), ctx);
const SN = ctx.SiteNorm;

const RANK = R("js/rank.js");
const ADMIN = R("js/admin-rank.js");
const SB = R("js/supabase.js");

/* 按大括号配对抽出函数（与其它测试同一手法，避免切到文件尾） */
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

console.log("一、站点归一：同一国家的各种写法");
{
  ok("模块已加载", !!SN && typeof SN.key === "function");
  const list = ["美国", "英国", "德国", "欧盟", "日本"];
  const cases = [
    ["美国", "美国"], ["美国站", "美国"], ["US", "美国"], ["usa", "美国"],
    ["美国(US)", "美国"], ["美国（US）", "美国"], ["美国-全托管", "美国"],
    [" United States ", "美国"], ["美区", "美国"],
    ["英国站", "英国"], ["UK", "英国"], ["gb", "英国"],
    ["DE", "德国"], ["德国站", "德国"],
    ["欧洲", "欧盟"], ["EU", "欧盟"],
    ["jp", "日本"], ["日本站", "日本"]
  ];
  cases.forEach(([raw, want]) => {
    ok("「" + raw + "」→ " + want, SN.resolve(raw, list) === want, SN.resolve(raw, list));
  });
  ok("清单里没有的写法不瞎猜（XX站 → 保留原文）", SN.resolve("XX站", list) === "XX站");
  ok("空值不炸", SN.resolve("", list) === "" && SN.resolve(null, list) === "");
  ok("两个写法指同一国家", SN.same("美国站", "US") === true);
  ok("不同国家不相等", SN.same("美国站", "英国") === false);
  ok("不认识的空串不算相等", SN.same("", "") === false);
}

console.log("二、前台过滤用归一键（真实跑 rank.js 里的 siteKey / siteCanon）");
{
  const fns = cutFn(RANK, "function siteCanon(") + "\n" + cutFn(RANK, "function siteKey(");
  ok("能抽出 siteCanon / siteKey", fns.indexOf("function siteCanon") >= 0 && fns.indexOf("function siteKey") >= 0);
  const box = new Function("window", "FACETS",
    fns + "\n return { siteCanon: siteCanon, siteKey: siteKey };")(
    { SiteNorm: SN }, { sites: ["美国", "英国"] });
  const { siteCanon, siteKey } = box;

  /* 核心场景：库里写成「美国站」，菜单里是「美国」——必须能对上 */
  const items = [
    { site: "美国站", image_url: "a" },
    { site: "US", image_url: "b" },
    { site: "美国", image_url: "c" },
    { site: "英国站", image_url: "d" }
  ];
  const canon = items.map((x) => siteCanon(x.site));
  ok("「美国站」归到菜单里的「美国」", canon[0] === "美国", canon[0]);
  ok("「US」归到「美国」", canon[1] === "美国", canon[1]);
  ok("「美国」不变", canon[2] === "美国", canon[2]);

  /* 模拟纵向对比的站点过滤（与 buildPools 同口径） */
  const scope = ["美国"];
  const scopeSet = {};
  scope.forEach((s) => { scopeSet[siteKey(s)] = 1; });
  const kept = items
    .map((it) => ({ it: it, site: siteCanon(it.site) }))
    .filter((o) => scopeSet[siteKey(o.site)])
    .map((o) => o.it.image_url);
  ok("选「美国」时，写成「美国站 / US / 美国」的三条都能显示", kept.length === 3, kept);
  ok("英国那条不会混进来", kept.indexOf("d") < 0);

  /* 旧写法（字符串精确相等）会一条都留不下 —— 这就是本次要修的病 */
  const keptOld = items.filter((it) => scope.indexOf(it.site) >= 0).map((it) => it.image_url);
  ok("对照：旧的字符串精确比对只会剩 1 条（正是线上空白的原因）", keptOld.length === 1, keptOld);
}

console.log("三、所选站点没数据时不再给空白页");
{
  ok("有「自动按全部站点显示」的兜底", /AUTO_ALL = true/.test(RANK));
  ok("兜底条件：只有取到了条目才兜底（真空数据不假装有）", /scopeSet && !mineOnly\.length && all\.length/.test(RANK));
  ok("页面上写明原因", /所选站点（[\s\S]{0,40}）在这些期次里没有数据，已按全部站点显示/.test(RANK));
  ok("空态摊开取到的期次 / 站点 / 条数", /function fetchedDiag\(\)/.test(RANK) && /本次实际取到/.test(RANK));
  ok("空态带上当前选择，便于一眼定位", /当前选择：类目/.test(RANK));
  ok("空态提示「全部站点」这条出口", /点上方的「全部站点」/.test(RANK));
  ok("空态不再只有一句「暂无榜单数据」", !/rk-empty">该组合下暂无榜单数据<\/div>/.test(RANK));
  ok("条目载入时统一站点写法", /if \(it\.site != null\) it\.site = siteCanon\(it\.site\);/.test(RANK));
  ok("站点菜单合并「后台清单 + 数据里出现过的写法」", /FACETS\.sites = _use;/.test(RANK));
  ok("菜单按归一键去重，同一国家不会两个按钮", /_seen\[siteKey\(n\)\] = 1/.test(RANK) || /_seen\[siteKey\(s\)\]/.test(RANK));
  ok("类目对比也按归一键过滤", /_cSet\[siteKey\(it\.site\)\]/.test(RANK));
}

console.log("四、数据层兜底不再丢掉筛选条件");
{
  const li = cutFn(SB, "async listRankItems(filter) {");
  ok("能抽出 listRankItems", li.length > 200);
  ok("已删掉「整表前 1000 行」这种兜底", !/const plain = await client\.from\("rank_items"\)\.select\("\*"\)\.range\(from, to\)/.test(li));
  ok("兜底只放宽列与数据域，类目 / 期次 / 站点条件保留", /noSrc/.test(li) && /q2\.in\("period_label"/.test(li) && /q2\.in\("site"/.test(li));
  ok("两次都失败就明确报错（不再假装没数据）", /读取榜单数据失败，请刷新重试/.test(li));
}

console.log("五、导入侧把站点名写成后台认得的名字");
{
  ok("榜单导入有站点归一", /siteNormResolve\(before, siteList\)/.test(ADMIN));
  ok("归一数量会在预览里说明", /站点名已自动归一/.test(ADMIN));
  ok("后台清单里没有的名字会被点名", /这些站点名在后台「站点管理」里没有/.test(ADMIN));
  const fns = cutFn(ADMIN, "function siteNormResolve(");
  ok("能抽出 siteNormResolve", fns.length > 0);
  const box = new Function("window", fns + "\n return siteNormResolve;")({ SiteNorm: SN });
  ok("实跑：美国站 → 美国", box("美国站", ["美国", "英国"]) === "美国");
  ok("实跑：认不出时原样返回", box("火星站", ["美国"]) === "火星站");
  ok("实跑：清单为空时，认得出的写法用标准名", box("美国站", []) === "美国");
  ok("实跑：清单为空、认不出时不动原文", box("火星站", []) === "火星站");
  ok("上新节奏同样归一", /siteNormResolve\(before, siteList\)/.test(R("js/admin-rhythm.js")));
  ok("标题组词台同样归一", /siteNormResolve\(r\.site, siteList\)/.test(R("js/admin-titlelab.js")));
}

console.log("五·二、上新节奏（月度）同一口径");
{
  const RHY = R("js/rhythm.js");
  ok("有 siteCanon / siteKey / sameSite", /function siteCanon\(/.test(RHY) && /function siteKey\(/.test(RHY) && /function sameSite\(/.test(RHY));
  ok("条目载入时统一站点写法", /if \(it\.site != null\) it\.site = siteCanon\(it\.site\);/.test(RHY));
  ok("纵向按月对比用归一键过滤", /var mineOnly = all\.filter\(function \(it\) \{ return sameSite\(it\.site, site\); \}\)/.test(RHY));
  ok("横向按国家分桶用归一键", /var bk = siteBucket\[siteKey\(it\.site\)\]/.test(RHY));
  ok("体征卡分组用归一键", /sameSite\(it\.site, s\)/.test(RHY) && /sameSite\(it\.site, siteV\)/.test(RHY));
  ok("新上榜判定用归一键", /sameSite\(it\.site, \(items\[0\] \|\| \{\}\)\.site\)/.test(RHY));
  ok("地区合并成员用归一键", /some\(function \(m\) \{ return sameSite\(m, it\.site\); \}\)/.test(RHY));
  ok("所选国家没数据时给降级提示而不是空白", /已按全部国家显示/.test(RHY));
  ok("不再残留按原文精确比对站点", !/it\.site === s \|\| /.test(RHY) && !/\(it\.site \|\| ""\) === site/.test(RHY));
}

console.log("六、页面都引入了归一模块");
{
    const BUILD = (RANK.match(/var BUILD\s*=\s*"([^"]+)"/) || [])[1] || "";
  const pages = ["index.html", "rank.html", "rhythm.html", "admin.html", "compare.html",
    "fav.html", "marketing.html", "movement.html", "pinterest.html", "shein.html", "trends.html"];
  pages.forEach((p) => {
    const s = R(p);
    ok(p + " 引入 site-norm.js", s.indexOf("js/site-norm.js") >= 0);
    /* 版本戳不写死：每次发版都要跟着升，写死会让这套测试在发版后必红（假失败） */
    ok(p + " 版本戳与脚本一致（" + BUILD + "）", s.indexOf("?v=" + BUILD) >= 0);
  });
  ok("榜单页版本常量与之一致", new RegExp('var BUILD = "' + BUILD + '"').test(RANK));
  ok("上新节奏版本常量与之一致", new RegExp('var BUILD = "' + BUILD + '"').test(R("js/rhythm.js")));
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
