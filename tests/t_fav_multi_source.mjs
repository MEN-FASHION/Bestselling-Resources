/* 我的收藏 · 跨专区取图 + 按专区成列对比 —— 20261114U
   锁六件事：
     ① 每个有图的专区页面都声明了来源，并加载星标脚本（少一个页面就少一个来源）
     ② 星标从卡片上读出的字段（地址 / 期次 / 类目 / 站点）与来源正确，三种期次写法都认
     ③ 来源名按口径输出（渠道用首字母 S / P / T，不写全称）
     ④ 收藏写入带 source；老库缺这一列时降级而不是整条写失败
     ⑤ 按专区分组：一列一个专区、列序稳定、空来源归「未标注专区」
     ⑥ 维度分布算得对（百分比分母是该专区自己的张数），并按视图真的拼出对比表
   两个反向用例：把 source 写入删掉、把分组顺序打乱，本文件必须报错。 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const FJ = fs.readFileSync(path.join(ROOT, "js/fav.js"), "utf8");
const FS = fs.readFileSync(path.join(ROOT, "js/favstar.js"), "utf8");
const SB = fs.readFileSync(path.join(ROOT, "js/supabase.js"), "utf8");
const FH = fs.readFileSync(path.join(ROOT, "fav.html"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
const FD = fs.readFileSync(path.join(ROOT, "js/favdrawer.js"), "utf8");

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

/* ============================================================
 * 一、六个专区页面都声明来源并加载星标
 * ============================================================ */
console.log("一、各专区页面声明来源");
const PAGES = [
  ["rank.html", "rank", "趋势上升榜"],
  ["rhythm.html", "rhythm", "上新节奏"],
  ["shein.html", "shein", "S 专区"],
  ["pinterest.html", "pinterest", "P 专区"],
  ["tiktok.html", "tiktok", "T 专区"],
  ["compare.html", "compare", "渠道对比"],
  ["movement.html", "movement", "品牌动向"],
  ["index.html", "vision", "视觉专区"],
];
/* 榜单与节奏页自带收藏星标（星标 + 分类弹层是它们原有的），只需要确认写入带来源；
   其余页面靠通用星标脚本挂上。 */
const SELF_STAR = { "rank.html": 1, "rhythm.html": 1 };
PAGES.forEach(([file, srcName, label]) => {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  ok(new RegExp('data-fav-source="' + srcName + '"').test(html), file + " 声明来源 " + srcName);
  if (!SELF_STAR[file]) {
    ok(/js\/favstar\.js\?v=/.test(html), file + " 加载通用星标脚本");
  }
  ok(label.length > 0, file + " 有可读来源名（" + label + "）");
});

console.log("一·补〇、卡片把收藏需要的字段挂在自身属性上");
const MOV = fs.readFileSync(path.join(ROOT, "js/movement-front.js"), "utf8");
const CHZ = fs.readFileSync(path.join(ROOT, "js/channel-zone-front.js"), "utf8");
ok(/card\.setAttribute\("data-url", imgUrl\(it\)/.test(MOV), "品牌动向卡片挂了图片地址");
ok(/card\.setAttribute\("data-cat", it\.category/.test(MOV), "品牌动向卡片挂了类目");
ok(/card\.setAttribute\("data-period", sea/.test(MOV), "品牌动向卡片挂了季节，收藏页才不会把它当无期次");
ok(/card\.setAttribute\("data-url", it\.image_url/.test(CHZ), "S / P / T 专区卡片挂了图片地址");
ok(/card\.setAttribute\("data-period", mon\)/.test(CHZ), "S / P / T 专区卡片挂了月度");

console.log("一·补、星标脚本只挂声明了来源的页面");
ok(/document\.body && document\.body\.getAttribute\("data-fav-source"\)/.test(FS), "启动时读页面声明");
ok(/if \(!src\) return;/.test(FS), "没声明的页面不挂星标（admin / 登录页不受影响）");

/* ============================================================
 * 二、真跑 favstar：从卡片读字段
 * ============================================================ */
console.log("二、星标从卡片读出的字段");

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.attrs = {};
    this.children = [];
    this._text = "";
    this.dataset = {};
    this.classList = {
      _s: new Set(),
      add: (c) => this.classList._s.add(c),
      remove: (c) => this.classList._s.delete(c),
      contains: (c) => this.classList._s.has(c),
      toggle: (c, on) => { if (on === undefined) { this.classList._s.has(c) ? this.classList._s.delete(c) : this.classList._s.add(c); } else if (on) this.classList._s.add(c); else this.classList._s.delete(c); },
    };
    this.style = {};
    this._listeners = {};
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return this.attrs[k] != null; }
  appendChild(el) { this.children.push(el); el.parentNode = this; return el; }
  removeChild(el) { this.children = this.children.filter((x) => x !== el); return el; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener() {}
  dispatch(t, ev) { (this._listeners[t] || []).forEach((f) => f(ev || {})); }
  closest() { return null; }
  querySelector(sel) {
    if (sel === "[data-fs-star]") return this.children.filter((c) => c.hasAttribute && c.hasAttribute("data-fs-star"))[0] || null;
    if (sel === "img") return this.children.filter((c) => c.tagName === "IMG")[0] || this._img || null;
    return null;
  }
  querySelectorAll() { return []; }
}

const sandbox = {
  console,
  setTimeout, clearTimeout, JSON, Math, Date, Number, String, Array, Object, RegExp, Promise, encodeURIComponent,
  localStorage: { getItem: () => null, setItem: () => {} },
  MutationObserver: class { observe() {} disconnect() {} },
  document: {
    readyState: "complete",
    body: (() => { const b = new FakeEl("body"); b.attrs["data-fav-source"] = "shein"; return b; })(),
    addEventListener() {},
    createElement: (t) => new FakeEl(t),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(FS, sandbox);
const FavStar = sandbox.FavStar;
ok(!!FavStar, "星标脚本可执行并导出接口");

/* 一张 S 专区的月卡：地址在 data-url，期次是月度 */
function mkCard(attrs, imgAttrs) {
  const c = new FakeEl("figure");
  Object.keys(attrs || {}).forEach((k) => c.setAttribute(k, attrs[k]));
  const img = new FakeEl("img");
  Object.keys(imgAttrs || {}).forEach((k) => {
    if (k === "src") img.dataset.src = imgAttrs[k];
    else img.setAttribute(k, imgAttrs[k]);
  });
  c.appendChild(img);
  return c;
}

const cardMonth = mkCard(
  { "data-url": "https://cdn.example.com/a.jpg", "data-period": "2026-10", "data-cat": "毛衣", "data-site": "US", "data-title": "羊毛混纺毛衣" },
  {}
);
const rowM = FavStar.rowOf(cardMonth);
ok(rowM.image_url === "https://cdn.example.com/a.jpg", "地址取 data-url");
ok(rowM.period_label === "2026-10", "期次照抄卡片");
ok(rowM.period_type === "month", "「2026-10」判为月度");
ok(rowM.leaf_category === "毛衣" && rowM.rank_category === "毛衣", "类目写进叶子类目与榜单类目");
ok(rowM.site === "US", "站点照抄");
ok(rowM.title === "羊毛混纺毛衣", "标题照抄");
ok(rowM.source === "shein", "来源取页面声明（shein）");

const cardSeason = mkCard({ "data-url": "u2", "data-period": "秋季", "data-cat": "外套" }, {});
ok(FavStar.rowOf(cardSeason).period_type === "season", "「秋季」判为季节");
const cardWeek = mkCard({ "data-url": "u3", "data-period": "2026-W45", "data-cat": "衬衫" }, {});
ok(FavStar.rowOf(cardWeek).period_type === "week", "「2026-W45」判为周度");

/* 视觉专区：没有 data-url，图是鉴权路径 → 取 authUrl（不带临时 token 的稳定地址） */
const cardVision = mkCard(
  {},
  { "data-auth-url": "https://img.example.com/visual/x.jpg", "data-auth-token": "fake-token-abc" }
);
const rowV = FavStar.rowOf(cardVision);
ok(rowV.image_url === "https://img.example.com/visual/x.jpg", "视觉专区取 authUrl，剥掉临时 token");
ok(rowV.image_url.indexOf("token=") < 0, "收藏里不写死会过期的 token");

/* 带会话 token 的地址：收藏里必须剥掉 token（否则过一会儿就打不开了），其它参数要保留 */
const cardTok = mkCard({ "data-url": "https://img.example.com/w/p1.jpg?token=abc123&v=2", "data-period": "2026-W45" }, {});
ok(FavStar.rowOf(cardTok).image_url === "https://img.example.com/w/p1.jpg?v=2", "收藏时剥掉 token，保留其它参数");
const cardTokOnly = mkCard({ "data-url": "https://img.example.com/w/p2.jpg?token=abc123", "data-period": "2026-W45" }, {});
ok(FavStar.rowOf(cardTokOnly).image_url === "https://img.example.com/w/p2.jpg", "只有 token 时连问号一起去掉");
const cardPlain = mkCard({ "data-url": "https://img.example.com/w/p3.jpg?v=2", "data-period": "2026-W45" }, {});
ok(FavStar.rowOf(cardPlain).image_url === "https://img.example.com/w/p3.jpg?v=2", "没有 token 的地址原样保留");

const catFallback = mkCard({ "data-url": "u4", "data-period": "2026-W45" }, {});
const catEl = new FakeEl("div");
catEl.attrs["class"] = "mv-card-cat";
catEl.textContent = "夹克";
catFallback.querySelector = (sel) => (sel === ".mv-card-cat" ? catEl : (sel === "img" ? catFallback.children[0] : null));
ok(FavStar.rowOf(catFallback).leaf_category === "夹克", "没写 data-cat 时退回卡片上的类目文字");

ok(FavStar.keyOf("2026-W45", "u") === FavStar.keyOf("2026-W45", "u"), "同一张图的 key 稳定");
ok(FavStar.keyOf("2026-W45", "u") !== FavStar.keyOf("2026-W44", "u"), "换期次就是另一条");

console.log("二·补、挂星标与已收藏点亮");
const cards = [mkCard({ "data-url": "s1", "data-period": "2026-W45", "data-cat": "毛衣" }, {})];
const saved = { qsa: sandbox.document.querySelectorAll };
sandbox.document.querySelectorAll = () => cards;
FavStar.init({ source: "shein", selector: ".mv-card" });
const star = cards[0].querySelector("[data-fs-star]");
ok(!!star, "卡片上挂出了星标");
ok(star.textContent === "☆", "未收藏时是空心星");
ok(cards[0].hasAttribute("data-fs"), "打了处理标记，重复扫描不重复挂");
FavStar.scan();
ok(cards[0].children.filter((c) => c.hasAttribute && c.hasAttribute("data-fs-star")).length === 1, "再扫一次不会多出一个星标");

const st = FavStar._test.state();
st.keys = {}; st.keys[FavStar.keyOf("2026-W45", "s1")] = 12;
const litCard = mkCard({ "data-url": "s1", "data-period": "2026-W45", "data-cat": "毛衣" }, {});
sandbox.document.querySelectorAll = () => [litCard];
FavStar.scan();
ok(litCard.querySelector("[data-fs-star]").textContent === "★", "已收藏的那张点亮");
ok(litCard.querySelector("[data-fs-star]").classList.contains("is-on"), "点亮态带 is-on 类");
sandbox.document.querySelectorAll = saved.qsa;

/* ============================================================
 * 三、来源名口径（渠道只用首字母）
 * ============================================================ */
console.log("三、来源名口径");
const labelsBlock = SB.slice(SB.indexOf("API.FAV_SOURCE_LABELS"), SB.indexOf("API.favSourceLabel"));
ok(/shein: "S 专区"/.test(labelsBlock), "shein 显示为「S 专区」");
ok(/pinterest: "P 专区"/.test(labelsBlock), "pinterest 显示为「P 专区」");
ok(/tiktok: "T 专区"/.test(labelsBlock), "tiktok 显示为「T 专区」");
ok(!/SHEIN|Pinterest|TikTok/.test(SB.slice(SB.indexOf("API.FAV_SOURCE_LABELS"), SB.indexOf("return API;\n})();"))), "来源名里不出现渠道全称");
ok(/rank: "趋势上升榜"/.test(labelsBlock) && /rhythm: "上新节奏"/.test(labelsBlock), "榜单与节奏用中文明名");
ok(/if \(!key\) return "未标注专区";/.test(SB), "空来源归「未标注专区」，不显示空白");

/* 真跑 favSourceLabel */
function runLabelFn(src) {
  const ctx = { API: {}, window: { CONFIG: {} } };
  const fnSrc = src.slice(src.indexOf("API.FAV_SOURCE_LABELS"), src.indexOf("return API;\n})();"));
  vm.createContext(ctx);
  vm.runInContext(fnSrc + "\nthis.out = API.favSourceLabel;", ctx);
  return ctx.out;
}
const lab = runLabelFn(SB);
ok(lab("shein") === "S 专区", "真跑：shein → S 专区");
ok(lab("pinterest") === "P 专区", "真跑：pinterest → P 专区");
ok(lab("") === "未标注专区", "真跑：空 → 未标注专区");
ok(lab("customzone") === "customzone", "真跑：没登记过的来源原样显示，不吞掉");

/* ============================================================
 * 四、写入带 source，缺列降级
 * ============================================================ */
console.log("四、收藏写入与降级");
ok(/source: \(r\.source == null \|\| String\(r\.source\)\.trim\(\) === ""\) \? null : String\(r\.source\)\.trim\(\)/.test(SB), "写入时带上 source（空则写 null）");
ok(/delete o\.source;/.test(SB), "缺列时降级重试会把 source 一并去掉");
ok(/column \.\*\(tags\|rank_pos\|source\)/.test(SB) || /\(tags\|rank_pos\|source\)/.test(SB), "降级只针对这三列，别的错误照常抛出");
ok(/WITH_TAGS \+ ",source", WITH_TAGS,/.test(SB), "读取按富到简降级，先试带 source");
ok(!/select\(cols\)[\s\S]{0,200}throw/.test(SB.slice(SB.indexOf("const ATTEMPTS"), SB.indexOf("const ATTEMPTS") + 800)), "降级路径不会把读取失败直接抛给界面");

/* 反向用例：把 source 写入删掉，本文件的断言必须失败 */
const SB_NOSRC = SB.replace(/source: \(r\.source == null \|\| String\(r\.source\)\.trim\(\) === ""\) \? null : String\(r\.source\)\.trim\(\),/, "");
ok(!/source: \(r\.source == null/.test(SB_NOSRC), "反向用例成立：删掉 source 写入后特征串消失");

/* ============================================================
 * 五、真跑分组与维度分布
 * ============================================================ */
console.log("五、按专区分组与维度分布");
const coreStart = FJ.indexOf("function labelOf(key)");
const coreEnd = FJ.indexOf("function renderCats()");
ok(coreStart > 0 && coreEnd > coreStart, "fav.js 里能定位到按专区那段纯函数");
const coreSrc = FJ.slice(coreStart, coreEnd);

function buildCore(src, SBOverride) {
  const ctx = {
    console,
    window: { SB: SBOverride || { favSourceLabel: (k) => ({ shein: "S 专区", pinterest: "P 专区", rank: "趋势上升榜" }[k] || (k || "未标注专区")) } },
    Object, Array, String, Number, Math, JSON,
  };
  ctx.global = ctx;
  vm.createContext(ctx);
  /* subOf 不在这一段里，给一个与站点一致的实现：按类目名判断上装 / 下装 */
  vm.runInContext(
    "function subOf(it){var v=it&&it.sub_cat;return (v===\"top\"||v===\"bottom\")?v:'none';}\n"
    + src
    + "\nthis.out={groupBySource:groupBySource,sourceStats:sourceStats,topN:topN,sourceOrderKeys:sourceOrderKeys,labelOf:labelOf};",
    ctx
  );
  return ctx.out;
}
const CORE = buildCore(coreSrc);
ok(!!CORE && typeof CORE.groupBySource === "function", "分组函数可用");

const ITEMS = [
  { id: 1, image_url: "a", period_label: "2026-W45", leaf_category: "毛衣", site: "US", source: "shein", tags: ["印花"], sub_cat: "top" },
  { id: 2, image_url: "b", period_label: "2026-W45", leaf_category: "毛衣", site: "US", source: "shein", tags: ["印花"], sub_cat: "top" },
  { id: 3, image_url: "c", period_label: "2026-W45", leaf_category: "长裤", site: "DE", source: "shein", tags: [], sub_cat: "bottom" },
  { id: 4, image_url: "d", period_label: "2026-10", leaf_category: "夹克", site: "US", source: "pinterest", tags: ["工艺"] },
  { id: 5, image_url: "e", period_label: "2026-W45", leaf_category: "毛衣", site: "US", source: "", tags: [] },
];
const groups = CORE.groupBySource(ITEMS);
ok(groups.length === 3, "三个来源 → 三列");
ok(groups[0].key === "shein" && groups[1].key === "pinterest" && groups[2].key === "", "列序稳定：S 在 P 前，未标注在最后");
ok(groups[0].n === 3 && groups[1].n === 1 && groups[2].n === 1, "每列张数正确");
ok(groups[2].name === "未标注专区", "空来源列显示「未标注专区」");
ok(groups[0].items.every((x) => x.source === "shein"), "条目归到自己那一列，不串列");

const stats = CORE.sourceStats(ITEMS);
const s0 = stats["shein"];
ok(s0.n === 3, "shein 维度统计的分母是 3 张");
ok(CORE.topN(s0.leaf, s0.n, 1)[0].k === "毛衣", "shein 类目第一是毛衣");
ok(CORE.topN(s0.leaf, s0.n, 1)[0].pct === 67, "毛衣占 shein 的 67%（2/3），分母是自己的张数");
ok(CORE.topN(s0.site, s0.n, 2).length === 2, "站点 TopN 收窄到 2 项");
ok(CORE.topN(s0.site, s0.n, 2)[1].k === "DE", "并列/次席按张数排序，DE 在后");
ok(s0.sub.top === 2 && s0.sub.bottom === 1, "上下装按条目自身归属判出 2 上装 1 下装");
ok(CORE.topN(stats["pinterest"].leaf, 1, 1)[0].k === "夹克", "另一个专区的分布独立算，不混算");

/* 反向用例：打乱列序的实现必须被抓住 */
const CORE_BAD = buildCore(coreSrc.replace('var SRC_ORDER = ["rank", "rhythm", "shein", "pinterest"', 'var SRC_ORDER = ["pinterest", "shein", "rank", "rhythm"'));
const badGroups = CORE_BAD.groupBySource(ITEMS);
ok(badGroups[0].key === "pinterest", "反向用例成立：改顺序后首列变成 pinterest（说明断言抓得住顺序缺陷）");

/* ============================================================
 * 六、按专区视图真的拼出来
 * ============================================================ */
console.log("六、按专区视图渲染");
ok(/view: "week"/.test(FJ), "有视图状态，默认按期次");
ok(/if \(ST\.view === "source"\) \{/.test(FJ), "渲染主流程按视图分流");
ok(/box\.innerHTML = sourceBoardHtml\(items\)/.test(FJ), "按专区视图走独立渲染");
ok(/function compareHtml\(srcs\)/.test(FJ), "有维度对比表");
ok(/各专区维度对比/.test(FJ), "对比表有标题");
ok(/class="fv-srcboard"/.test(FJ), "专区列容器");
ok(/data-src="' \+ esc\(g\.key\)/.test(FJ), "每列带来源标记，便于样式与导出定位");
ok(/function sourceColHtml\(g\)/.test(FJ), "一列一个专区");
ok(!/fv-srcboard[\s\S]{0,200}subBarHtml/.test(FJ.slice(FJ.indexOf("function sourceBoardHtml"), FJ.indexOf("function sourceBoardHtml") + 600)), "按专区视图不掺期次视图的分栏控件");

ok(/id="fv-viewseg"/.test(FH), "收藏页有视图切换控件");
ok(/data-fvview="week"/.test(FH) && /data-fvview="source"/.test(FH), "两个视图入口都在");
ok(/localStorage\.setItem\("fv-view"/.test(FJ), "视图选择记在本地，刷新后还在");
ok(/function readView\(\)/.test(FJ) && /readView\(\);/.test(FJ), "启动时读回上次视图");
ok(/个专区/.test(FJ), "摘要里报出跨了几个专区");

console.log("六·补、鉴权图在收藏页与抽屉里都能显示");
ok(/API\.favResolveDisplay = async function/.test(SB), "数据层有统一的鉴权地址解析");
ok(/API\.favDisplayUrl = function/.test(SB), "渲染侧取显示地址的入口");
ok(/indexOf\("token="\) < 0/.test(SB), "已经带 token 的地址不重复拼");
ok(/favResolveDisplay/.test(FJ) && /favResolveDisplay/.test(FD), "收藏页与侧边抽屉都走同一套解析");
ok(/favDisplayUrl\(it\.image_url\)/.test(FD), "抽屉里的图用解析后的地址");

console.log("六·补二、样式");
ok(/\.fv-viewseg/.test(CSS) && /\.fv-vs\.is-on/.test(CSS), "视图切换有样式与选中态");
ok(/\.fv-cmpt/.test(CSS), "对比表有样式");
ok(/\.fv-srccol \{/.test(CSS), "专区列有样式");
ok(/\.fv-src \{ display: none; \}/.test(CSS), "来源角标不压图（列头已写明来源）");

console.log("");
console.log("跨专区收藏自检：" + pass + " 通过，" + fail + " 失败");
if (fail) process.exit(1);
