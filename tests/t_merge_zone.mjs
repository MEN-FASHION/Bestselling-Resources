/* 20261122A / 20261123B · 渠道合并对比（merge.html）基础摆法自检
 *
 * 需求原文：
 *   「这个专区里一列只展示 P / T / S 渠道的图，另一列只展示上新节奏的图；
 *     P / T / S 三个渠道的图不需要分列，直接合并为站外展示。」
 *   20261123B 追加：趋势榜单（去年同月）永远在最左，其他渠道在右。
 *
 * 验收点（每条都有反向用例，拿掉实现必须失败）：
 *   1) 默认两列：最左是趋势榜单，右边是 P / T / S 合并列（不是三列）；
 *   2) 合并列只收这三个渠道，其它渠道（Amazon / 独立站）一张都不进，同图只摆一次；
 *   3) 趋势榜单列只收「没有渠道归属」的月度榜单行，且只取去年同月；
 *   4) 只摆所选月份的图，当月没图就写明「不会用其它月份顶替」；
 *   5) 列的显隐跟随来源专区：P / S / T 全关 → 合并列不摆；榜单两个专区都关 → 趋势列不摆；
 *   6) 原「渠道对比」一行没改，合并页不读对比列配置。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/merge-front.js", "utf8");
const HTML = fs.readFileSync("merge.html", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

/* ================= 一、代码层面的硬约束 ================= */
console.log("一、实现约定");
ok(/var CANON = \{ pinterest: 1, shein: 1, tiktok: 1 \};/.test(SRC), "合并列只收 P / S / T 三个渠道");
ok(/if \(!CANON\[ck\]\) return;/.test(SRC), "其它渠道必须被挡在合并列之外");
ok(/function mergeOf\(chFull\)/.test(SRC) && /var k = dedupKey\(r\.image_url, r\.month\);/.test(SRC),
  "合并列按「图片地址 + 月份」跨渠道去重（三个渠道传同一张只留一张）");
ok(!/getCompareSources/.test(SRC), "合并页不读后台「对比列配置」（否则改那边会连带影响这一页）");
ok(/function colMonth\(c\) \{[\s\S]{0,160}c\.type === "rank" \? prevYearMonth\(state\.month\) : state\.month/.test(SRC),
  "趋势榜单列取去年同月，其他渠道取目标月");
ok(/不会用其它月份顶替/.test(SRC), "空列要写明「不会用其它月份顶替」");
ok(/var CH_ZONE = \{ pinterest: "pinterest", tiktok: "tiktok", shein: "shein" \}/.test(SRC) &&
   /var RANK_ZONES = \["rank", "rhythm"\]/.test(SRC), "每一列各自跟随来源专区的开关");
ok(!/listRankChannelPics\(\{ periodType: "week"/.test(SRC), "取数口径与渠道对比一致：只取月度");
ok(/rk-pool/.test(SRC) && /rk-pool-name/.test(SRC) && /rk-n/.test(SRC),
  "复用 .rk-pool 结构，全站导出（单页网页 / 高清海报 / 高清图）才认得出这几列");
ok(/var out = \[\{ key: "mrg:rank", label: "趋势榜单"/.test(SRC), "列定义里趋势榜单固定排第一");

/* ================= 二、静态接线（菜单 / 导出 / 权限） ================= */
console.log("二、静态接线");
ok(/merge\.html/.test(HTML) && /merge-front\.js/.test(HTML), "merge.html 已接入 merge-front.js");
ok(/VX && window\.VX\.boot\("merge"\)/.test(HTML), "导出模块以 merge 启动");
ok(/PageShot\.mount\(\{ label: "渠道合并对比", bar: "#mrg-bar", root: "#mrg-body" \}\)/.test(HTML), "高清图导出挂点已接");
ok(/id="mrg-bar-info"/.test(HTML) && /id="mrg-switch"/.test(HTML), "工具条分成「摘要 + 合并/拆分切换」两块（互不被覆盖）");
const CFG = fs.readFileSync("js/config.js", "utf8");
ok(/key: "merge"[\s\S]{0,80}href: "merge\.html"/.test(CFG), "默认专区清单里登记了合并对比");
const COMMON = fs.readFileSync("js/common.js", "utf8");
ok(/function pinMerge/.test(COMMON) && /pinMerge\(/.test(COMMON),
  "菜单会为旧配置自动补位（否则数据库里的老配置会让新专区永远不出现）");
ok(/zone === MERGE_ZONE\) \{[\s\S]{0,220}mine\.indexOf\(zone\) !== -1/.test(COMMON),
  "合并对比按普通专区口径判授权（20261124A 起独立勾选、独立关闭）");
const PERM = fs.readFileSync("js/admin-perm.js", "utf8");
ok(/\{ key: "merge", label: "渠道合并对比" \}/.test(PERM), "权限管理里「渠道合并对比」是可独立勾选的专区");
ok(/if \(!PERM_ZONES\.some\(z => z\.key === "merge"\)\)/.test(PERM), "专区定义里没有它时也要补进可授权清单");
ok(/function permZonesWithMerge/.test(PERM), "老账号（改版前没有这一项）打开弹窗时默认补勾，保存即生效");
ok(!/PERM_DERIVED_ZONES = \{ merge: 1 \}/.test(PERM), "不再把合并对比当派生视图（否则关不掉也开不了）");
ok(/\{ key: "merge", label: "渠道合并对比" \}/.test(PERM), "导出权限里可以单独勾合并对比");
const VX = fs.readFileSync("js/view-export.js", "utf8");
ok(/merge: "渠道合并对比"/.test(VX), "导出模块认识 merge 这个专区名");

/* ================= 三、真实执行 ================= */
function mkEl(tag) {
  const e = {
    tagName: (tag || "div").toUpperCase(), children: [], style: {}, dataset: {},
    className: "", textContent: "", title: "", type: "", value: "", id: "", src: "", checked: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, click() {}, contains() { return false; }, closest() { return null; },
    get firstChild() { return this.children[0] || null; },
    onclick: null,
  };
  Object.defineProperty(e, "innerHTML", {
    get() { return this._h || ""; },
    set(v) { this._h = String(v); if (!v) e.children = []; },
  });
  return e;
}

/* 三个渠道各一张 + 另一个类目一张 + 另一渠道（Amazon，不该进合并列）+ 跨渠道重复一张；
   榜单：去年同月（趋势列该有）两条、目标月（不该进趋势列）一条、有渠道归属一条 */
function mkRows(rankMonth, extra) {
  const o = extra || {};
  return {
    ch: [
      { image_url: "http://x/p1.jpg", category: "卫衣", period_label: "2026-11", channel: "Pinterest", title: "p1" },
      { image_url: "http://x/t1.jpg", category: "卫衣", period_label: "2026-11", channel: "TikTok", title: "t1" },
      { image_url: "http://x/s1.jpg", category: "卫衣", period_label: "2026-11", channel: "SHEIN", title: "s1" },
      { image_url: "http://x/a1.jpg", category: "卫衣", period_label: "2026-11", channel: "Amazon", title: "a1" },
      { image_url: "http://x/dup.jpg", category: "卫衣", period_label: "2026-11", channel: "SHEIN", title: "dup" },
      { image_url: "http://x/dup.jpg", category: "卫衣", period_label: "2026-11", channel: "TikTok", title: "dup" },
      { image_url: "http://x/c1.jpg", category: "外套", period_label: "2026-11", channel: "SHEIN", title: "c1" },
    ],
    rank: [
      { id: 1, image_url: "http://x/r1.jpg", category: "卫衣", period_label: rankMonth || "2025-11", site: "美国", channel: "", title: "r1" },
      { id: 2, image_url: "http://x/r2.jpg", category: "卫衣", period_label: rankMonth || "2025年11月", site: "美国", channel: "", title: "r2" },
      { id: 3, image_url: "http://x/rnow.jpg", category: "卫衣", period_label: "2026-11", site: "美国", channel: "", title: "目标月榜单（不该进趋势列）" },
      { id: 4, image_url: "http://x/rch.jpg", category: "卫衣", period_label: rankMonth || "2025-11", site: "美国", channel: "SHEIN", title: "有渠道归属" },
    ],
  };
}

async function run(opts) {
  const o = opts || {};
  const REG = {};
  const q = (sel) => (REG[sel] = REG[sel] || mkEl("div"));
  const doc = {
    readyState: "complete",
    querySelector: q,
    getElementById: (id) => q("#" + id),
    createElement: (t) => mkEl(t),
    addEventListener() {},
    querySelectorAll: () => [],
    head: mkEl("head"), body: mkEl("body"), documentElement: mkEl("html"),
  };
  const rows = mkRows(o.rankMonth, o.extra);
  const SB = {
    getSession: async () => ({ user: { email: "t@t" } }),
    getFrontendZoneVisibility: async () => (o.vis === undefined ? null : o.vis),
    myFrontendZones: async () => (o.mine === undefined ? null : o.mine),
    listRankChannelPics: async () => rows.ch,
    listRankItems: async () => rows.rank,
    listImageTags: async () => ({}),
    listMovementTags: async () => ({}),
  };
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    document: doc,
    location: { href: "merge.html", pathname: "/merge.html", origin: "http://x", replace() {} },
  };
  sandbox.window = sandbox;
  sandbox.SB = SB;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(o.src || SRC, ctx);
  await new Promise((r) => setTimeout(r, 100));

  const body = () => String(q("#mrg-body").innerHTML || "");
  const hasCol = (key) => body().indexOf('data-src="' + key + '"') >= 0;
  const poolCount = () => (body().match(/class="rk-pool"/g) || []).length;
  const seg = (key) => {
    const h = body();
    const i = h.indexOf('data-src="' + key + '"');
    if (i < 0) return "";
    const j = h.indexOf("</section>", i);
    return h.slice(i, j < 0 ? h.length : j);
  };
  const cardsIn = (key) => (seg(key).match(/class="rk-card cmp-card"/g) || []).length;
  const urlsIn = (key) => (seg(key).match(/data-url="[^"]+"/g) || []).map((x) => x.slice(10, -1));
  return { body, hasCol, poolCount, seg, cardsIn, urlsIn, q, REG };
}

function clickChip(box, text) {
  let hit = null;
  (function walk(n) {
    if (!n || hit) return;
    if (n.tagName === "BUTTON" && (String(n.textContent || "") + String(n.innerHTML || "")).indexOf(text) >= 0) { hit = n; return; }
    (n.children || []).forEach(walk);
  })(box);
  if (hit && typeof hit.onclick === "function") hit.onclick();
  return !!hit;
}

(async () => {
  /* ---------- 基本摆法 ---------- */
  console.log("三、基本摆法：两列，左趋势榜单、右 P / T / S 合并");
  const base = await run({});
  ok(base.hasCol("mrg:ch"), "合并列（P / T / S）应存在");
  ok(base.hasCol("mrg:rank"), "趋势榜单列应存在");
  ok(base.poolCount() === 2, "只应有两列（实际 " + base.poolCount() + " 列）");
  ok(base.body().indexOf('data-src="mrg:rank"') < base.body().indexOf('data-src="mrg:ch"'),
    "趋势榜单必须排在最左（其他渠道在右）");
  const merged = base.urlsIn("mrg:ch");
  ok(merged.indexOf("http://x/p1.jpg") >= 0 && merged.indexOf("http://x/t1.jpg") >= 0 && merged.indexOf("http://x/s1.jpg") >= 0,
    "三个渠道的图都要在这一列里（实际 " + JSON.stringify(merged) + "）");
  ok(merged.indexOf("http://x/a1.jpg") < 0, "Amazon 等其它渠道不该混进合并列");
  ok(merged.filter((u) => /dup\.jpg$/.test(u)).length === 1, "同一张图被两个渠道传过时，合并列只摆一次");
  ok(!base.hasCol("mrg:ch:pinterest") && !base.hasCol("mrg:ch:shein") && !base.hasCol("mrg:ch:tiktok"),
    "默认是合并视图，不许退回「一个渠道一列」");

  const rankUrls = base.urlsIn("mrg:rank");
  ok(rankUrls.indexOf("http://x/r1.jpg") >= 0 && rankUrls.indexOf("http://x/r2.jpg") >= 0,
    "趋势榜单摆去年同月的图（两种月份写法都要认）");
  ok(rankUrls.indexOf("http://x/rnow.jpg") < 0, "目标月的榜单图不该进趋势列（趋势永远少一年）");
  ok(rankUrls.indexOf("http://x/rch.jpg") < 0, "有渠道归属的榜单行不进趋势列（与渠道对比同一口径）");

  /* ---------- 专区开关 ---------- */
  console.log("四、列的显隐跟随来源专区");
  const chOff = await run({ vis: { pinterest: false, shein: false, tiktok: false } });
  ok(!chOff.hasCol("mrg:ch"), "P / S / T 三个专区都关掉时，合并列不应出现");
  ok(chOff.hasCol("mrg:rank"), "趋势列不受影响");
  const rankOff = await run({ vis: { rank: false, rhythm: false } });
  ok(!rankOff.hasCol("mrg:rank"), "榜单两个专区都关掉时，趋势列不应出现");
  ok(rankOff.hasCol("mrg:ch"), "合并列不受影响");
  const allOff = await run({ vis: { rank: false, rhythm: false, pinterest: false, shein: false, tiktok: false } });
  ok(!allOff.hasCol("mrg:ch") && !allOff.hasCol("mrg:rank"), "全部关闭时两列都不摆");
  ok(/没有可对比的列|未对你开放|未开放/.test(allOff.body()), "全部关闭时要给说明，而不是一片空白");
  const mineOnlyRank = await run({ mine: ["rank", "compare"] });
  ok(!mineOnlyRank.hasCol("mrg:ch") && !mineOnlyRank.hasCol("mrg:rank"),
    "没有「渠道合并对比」授权时整页不摆图（独立授权，20261124A 起）");
  ok(/渠道合并对比/.test(mineOnlyRank.body()) && /未对你开放/.test(mineOnlyRank.body()),
    "要提示「渠道合并对比未对你开放」，而不是一片空白");
  ok(!/渠道对比/.test(mineOnlyRank.body()) || /不影响/.test(mineOnlyRank.body()),
    "提示里要说明不影响「渠道对比」，避免误以为连带被关");
  const withMerge = await run({ mine: ["rank", "compare", "merge"] });
  ok(withMerge.hasCol("mrg:rank"), "有合并授权 + 趋势上升榜授权 → 趋势列照常出现");
  ok(!withMerge.hasCol("mrg:ch"), "三个渠道专区都没授权 → 合并列不出现");
  const oneCh = await run({ vis: { pinterest: false, tiktok: false } });
  ok(oneCh.hasCol("mrg:ch"), "只剩 S 渠道开放时，合并列仍在");
  ok(oneCh.urlsIn("mrg:ch").indexOf("http://x/p1.jpg") < 0, "被关掉渠道的图不该再参与合计（P 的图不出现）");
  ok(oneCh.urlsIn("mrg:ch").indexOf("http://x/s1.jpg") >= 0, "仍开放渠道的图照常摆");

  /* ---------- 月份严格 ---------- */
  console.log("五、只摆所选月份");
  const crossMonth = await run({ rankMonth: "2025-10" });
  ok(crossMonth.hasCol("mrg:rank"), "去年同月没有榜单图时，这一列仍要摆出来（不许整列消失）");
  ok(crossMonth.cardsIn("mrg:rank") === 0, "不许拿别的月份的图顶替（实际摆了 " + crossMonth.cardsIn("mrg:rank") + " 张）");
  ok(/不会用其它月份顶替/.test(crossMonth.body()), "空列要写明原因");

  /* ---------- 类目筛选 ---------- */
  console.log("六、类目筛选");
  ok(clickChip(base.REG["#mrg-cats"], "外套"), "左侧类目菜单能找到「外套」并点它");
  await new Promise((r) => setTimeout(r, 30));
  ok(base.urlsIn("mrg:ch").length === 1 && base.urlsIn("mrg:ch")[0] === "http://x/c1.jpg",
    "切到「外套」后合并列只留外套图（实际 " + JSON.stringify(base.urlsIn("mrg:ch")) + "）");

  console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})();
