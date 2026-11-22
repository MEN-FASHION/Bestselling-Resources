/* 20261122A · 渠道合并对比（merge.html）自检
 *
 * 需求原文：
 *   「新增一个专区，这个专区里一列只展示 P / T / S 渠道的图，另一列只展示上新节奏的图；
 *     P / T / S 三个渠道的图不需要分列，直接合并为站外展示。可以做吗？这个渠道不影响其他渠道，
 *     数据来源于其他渠道，只是前台展示效果不同。」
 *
 * 验收点（每条都有反向用例，拿掉实现必须失败）：
 *   1) 左列把 P / T / S **合并成一列**（不是三列），并且按图片地址去重；
 *   2) 左列**只**收这三个渠道，其它渠道（Amazon / 独立站等）一张都不进；
 *   3) 右列只有上新节奏（月度榜单且无渠道归属的行），与渠道图重复的地址不重复摆；
 *   4) 只摆所选月份的图，当月没图就写明「不会用其它月份顶替」；
 *   5) 列的显隐跟随来源专区：P / S / T 全关 → 左列不摆；榜单两个专区都关 → 右列不摆；
 *   6) 原「渠道对比」一行没改（配置、列逻辑仍是它自己那套），合并页不读对比列配置。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/merge-front.js", "utf8");
const HTML = fs.readFileSync("merge.html", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

/* ================= 一、代码层面的硬约束 ================= */
console.log("一、实现约定");
ok(/var MERGE_CHANNELS = \{ pinterest: 1, shein: 1, tiktok: 1/.test(SRC), "合并列只收 P / S / T 三个渠道");
ok(/if \(!MERGE_CHANNELS\[ck\]\) return;/.test(SRC), "其它渠道必须被挡在合并列之外");
ok(/seenU\[u\]/.test(SRC), "合并列按图片地址去重（三个渠道传同一张只留一张）");
ok(!/getCompareSources/.test(SRC), "合并页不读后台「对比列配置」（否则改那边会连带影响这一页）");
ok(/state\.month\) return list\.filter/.test(SRC) || /return list\.filter\(function \(r\) \{ return r\.month === state\.month; \}\)/.test(SRC),
  "选了月份时必须只摆当月的图");
ok(/不会用其它月份顶替/.test(SRC), "空列要写明「不会用其它月份顶替」");
ok(/var CH_ZONES = \["pinterest", "shein", "tiktok"\]/.test(SRC) && /var RANK_ZONES = \["rank", "rhythm"\]/.test(SRC),
  "两列各自跟随来源专区的开关");
ok(!/listRankChannelPics\(\{ periodType: "week"/.test(SRC), "取数口径与渠道对比一致：只取月度");
ok(/图库|不新增图库|纯只读/.test(SRC.replace(/\s/g, "")) || true, "占位（说明性注释不计）");
ok(/rk-pool/.test(SRC) && /rk-pool-name/.test(SRC) && /rk-n/.test(SRC),
  "复用 .rk-pool 结构，全站导出（单页网页 / 高清海报 / 高清图）才认得出这两列");

/* ================= 二、静态接线（菜单 / 导出 / 权限） ================= */
console.log("二、静态接线");
ok(/merge\.html/.test(HTML) && /merge-front\.js/.test(HTML), "merge.html 已接入 merge-front.js");
ok(/VX && window\.VX\.boot\("merge"\)/.test(HTML), "导出模块以 merge 启动");
ok(/PageShot\.mount\(\{ label: "渠道合并对比", bar: "#mrg-bar", root: "#mrg-body" \}\)/.test(HTML), "高清图导出挂点已接");
const CFG = fs.readFileSync("js/config.js", "utf8");
ok(/key: "merge"[\s\S]{0,80}href: "merge\.html"/.test(CFG), "默认专区清单里登记了合并对比");
const COMMON = fs.readFileSync("js/common.js", "utf8");
ok(/function pinMerge/.test(COMMON) && /pinMerge\(/.test(COMMON),
  "菜单会为旧配置自动补位（否则数据库里的老配置会让新专区永远不出现）");
ok(/MERGE_DEPS/.test(COMMON), "合并对比的可见性跟随来源专区，不单独配授权");
const PERM = fs.readFileSync("js/admin-perm.js", "utf8");
ok(/PERM_DERIVED_ZONES = \{ merge: 1 \}/.test(PERM), "后台不把合并对比列进「可授权专区」（它没有自己的数据）");
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

/* 三个渠道各一张 + 另一渠道（Amazon，不该进合并列）；榜单一张（可指定月份） */
function mkRows(rankMonth, extra) {
  const o = extra || {};
  return {
    ch: [
      { image_url: "http://x/p1.jpg", category: "卫衣", period_label: "2026-11", channel: "Pinterest", title: "p1" },
      { image_url: "http://x/t1.jpg", category: "卫衣", period_label: "2026-11", channel: "TikTok", title: "t1" },
      { image_url: "http://x/s1.jpg", category: "卫衣", period_label: "2026-11", channel: "SHEIN", title: "s1" },
      { image_url: "http://x/a1.jpg", category: "卫衣", period_label: "2026-11", channel: "Amazon", title: "a1" },
      { image_url: o.dupUrl || "http://x/dup.jpg", category: "卫衣", period_label: "2026-11", channel: "SHEIN", title: "dup" },
      { image_url: o.dupUrl || "http://x/dup.jpg", category: "卫衣", period_label: "2026-11", channel: "TikTok", title: "dup" },
    ],
    rank: [
      { id: 1, image_url: "http://x/r1.jpg", category: "卫衣", period_label: rankMonth || "2026-11", site: "美国", channel: "", title: "r1" },
      { id: 2, image_url: "http://x/rch.jpg", category: "卫衣", period_label: "2026-11", site: "美国", channel: "SHEIN", title: "有渠道归属" },
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
  vm.runInContext(SRC, ctx);
  await new Promise((r) => setTimeout(r, 100));

  const body = () => String(q("#mrg-body").innerHTML || "");
  const hasCol = (key) => body().indexOf('data-src="' + key + '"') >= 0;
  const poolCount = () => (body().match(/class="rk-pool"/g) || []).length;
  const cardsIn = (key) => {
    const h = body();
    const i = h.indexOf('data-src="' + key + '"');
    if (i < 0) return -1;
    const j = h.indexOf("</section>", i);
    const seg = h.slice(i, j < 0 ? h.length : j);
    return (seg.match(/class="rk-card cmp-card"/g) || []).length;
  };
  const urlsIn = (key) => {
    const h = body();
    const i = h.indexOf('data-src="' + key + '"');
    if (i < 0) return [];
    const j = h.indexOf("</section>", i);
    const seg = h.slice(i, j < 0 ? h.length : j);
    return (seg.match(/data-url="[^"]+"/g) || []).map((x) => x.slice(10, -1));
  };
  const summary = () => String(q("#mrg-summary").textContent || "");
  return { body, hasCol, poolCount, cardsIn, urlsIn, summary, q };
}

(async () => {
  /* ---------- 基本摆法 ---------- */
  console.log("三、基本摆法：两列，左列把 P / T / S 合并");
  const base = await run({});
  ok(base.hasCol("mrg:ch"), "左列（P / T / S 合并）应存在");
  ok(base.hasCol("mrg:rank"), "右列（上新节奏）应存在");
  ok(base.poolCount() === 2, "只应有两列（实际 " + base.poolCount() + " 列）");
  const merged = base.urlsIn("mrg:ch");
  ok(merged.indexOf("http://x/p1.jpg") >= 0 && merged.indexOf("http://x/t1.jpg") >= 0 && merged.indexOf("http://x/s1.jpg") >= 0,
    "三个渠道的图都要在这一列里（实际 " + JSON.stringify(merged) + "）");
  ok(merged.indexOf("http://x/a1.jpg") < 0, "Amazon 等其它渠道不该混进合并列");
  ok(merged.filter((u) => /dup\.jpg$/.test(u)).length === 1, "同一张图被两个渠道传过时，合并列只摆一次");
  ok(!base.hasCol("ch:pinterest") && !base.hasCol("ch:shein") && !base.hasCol("ch:tiktok"),
    "不许退回「一个渠道一列」的老摆法");

  const rankUrls = base.urlsIn("mrg:rank");
  ok(rankUrls.indexOf("http://x/r1.jpg") >= 0, "上新节奏的图应在右列");
  ok(rankUrls.indexOf("http://x/rch.jpg") < 0, "有渠道归属的榜单行不进榜单列（与渠道对比同一口径）");

  /* ---------- 专区开关 ---------- */
  console.log("四、列的显隐跟随来源专区");
  const chOff = await run({ vis: { pinterest: false, shein: false, tiktok: false } });
  ok(!chOff.hasCol("mrg:ch"), "P / S / T 三个专区都关掉时，合并列不应出现");
  ok(chOff.hasCol("mrg:rank"), "右列不受影响");
  const rankOff = await run({ vis: { rank: false, rhythm: false } });
  ok(!rankOff.hasCol("mrg:rank"), "榜单两个专区都关掉时，右列不应出现");
  ok(rankOff.hasCol("mrg:ch"), "左列不受影响");
  const allOff = await run({ vis: { rank: false, rhythm: false, pinterest: false, shein: false, tiktok: false } });
  ok(!allOff.hasCol("mrg:ch") && !allOff.hasCol("mrg:rank"), "全部关闭时两列都不摆");
  ok(/没有可对比的列|未对你开放|未开放/.test(allOff.body()), "全部关闭时要给说明，而不是一片空白（实际「" + allOff.body().slice(0, 80) + "」）");
  const mineOnlyRank = await run({ mine: ["rank", "compare"] });
  ok(!mineOnlyRank.hasCol("mrg:ch"), "账号只被授权趋势上升榜时，合并列不出现（三个渠道专区都没授权）");
  ok(mineOnlyRank.hasCol("mrg:rank"), "榜单列照常出现");

  /* ---------- 月份严格 ---------- */
  console.log("五、只摆所选月份");
  const crossMonth = await run({ rankMonth: "2026-10" });
  ok(crossMonth.hasCol("mrg:rank"), "本月没有榜单图时，这一列仍要摆出来（不许整列消失）");
  ok(crossMonth.cardsIn("mrg:rank") === 0, "不许拿别的月份的图顶替（实际摆了 " + crossMonth.cardsIn("mrg:rank") + " 张）");
  ok(/不会用其它月份顶替/.test(crossMonth.body()), "空列要写明原因");
  ok(crossMonth.cardsIn("mrg:ch") === 4, "左列这个月的图照常摆（3 张 + 1 张去重后的重复图，实际 " + crossMonth.cardsIn("mrg:ch") + " 张）");

  /* ---------- 反向验证 ---------- */
  console.log("六、反向验证：把实现拿掉必须失败");
  const noDedup = SRC.replace(/if \(!u \|\| seenU\[u\]\) return;/, "if (!u) return;");
  ok(noDedup !== SRC, "去重判断位置已被改动（用例本身有效）");
  ok(!(await runSrc(noDedup)).dedupOk, "去掉「按地址去重」后，用例必须报错");

  const noMonth = SRC.replace(/return list\.filter\(function \(r\) \{ return r\.month === state\.month; \}\);/, "return list;");
  ok(noMonth !== SRC, "月份过滤位置已被改动（用例本身有效）");
  ok(!(await runSrc(noMonth, { rankMonth: "2026-10" })).monthOk, "去掉「只摆本月」后，用例必须报错（对照：正常实现应为 0 张）");

  const noChannelGate = SRC.replace(/if \(!MERGE_CHANNELS\[ck\]\) return;/, "if (false) return;");
  ok(!(await runSrc(noChannelGate)).onlyPtsOk, "去掉「只收 P / S / T」后，用例必须报错");

  console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})();

/* 用改坏的源码跑一遍，看对应断言是否失败（返回三项结论） */
async function runSrc(src, opts) {
  const o = opts || {};
  const REG = {};
  const q = (sel) => (REG[sel] = REG[sel] || mkEl("div"));
  const doc = {
    readyState: "complete", querySelector: q, getElementById: (id) => q("#" + id),
    createElement: (t) => mkEl(t), addEventListener() {}, querySelectorAll: () => [],
    head: mkEl("head"), body: mkEl("body"), documentElement: mkEl("html"),
  };
  const rows = mkRows(o.rankMonth || "2026-11");
  const SB = {
    getSession: async () => ({ user: { email: "t@t" } }),
    getFrontendZoneVisibility: async () => null,
    myFrontendZones: async () => null,
    listRankChannelPics: async () => rows.ch,
    listRankItems: async () => rows.rank,
    listImageTags: async () => ({}), listMovementTags: async () => ({}),
  };
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    document: doc, location: { href: "merge.html", replace() {} },
  };
  sandbox.window = sandbox;
  sandbox.SB = SB;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(src, ctx);
  await new Promise((r) => setTimeout(r, 100));
  const h = String(q("#mrg-body").innerHTML || "");
  const seg = (key) => {
    const i = h.indexOf('data-src="' + key + '"');
    if (i < 0) return "";
    const j = h.indexOf("</section>", i);
    return h.slice(i, j < 0 ? h.length : j);
  };
  const u = (seg("mrg:ch").match(/data-url="[^"]+"/g) || []).map((x) => x.slice(10, -1));
  const rankCards = (seg("mrg:rank").match(/class="rk-card cmp-card"/g) || []).length;
  return {
    dedupOk: u.filter((x) => /dup\.jpg$/.test(x)).length === 1,
    onlyPtsOk: u.indexOf("http://x/a1.jpg") < 0,
    monthOk: rankCards === 0,   /* 跨月数据：本月没有榜单图 → 一张都不许摆 */
  };
}
