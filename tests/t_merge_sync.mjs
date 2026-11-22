/* 20261123B · 渠道合并对比：同期口径写死（趋势榜单永远比渠道少一年）+ 其他渠道「合并 / 拆分」
 *
 * 需求原文：
 *   「上新节奏榜单的 26年1月 和 27年1月 的其他渠道对比，2月和27年2月的其他渠道对比，以此类推，
 *     趋势榜单永远比其他渠道少一年，这个逻辑要写死。每一列都是同月跨年对照。」
 *   「右上角加一个切换按钮：合并（默认）＝其他渠道合成一列；拆分＝展开成三列。
 *     切换只重算其他渠道这一侧，趋势列在任何模式下都不动、位置永远在最左。」
 *
 * 验收点：
 *   1) 趋势列取「目标月 − 1 年」，渠道列取目标月，两列月份各自写在列头；
 *   2) 不再有「同月对照 / 同期对比」的口径开关（同一时间只有一种口径）；
 *   3) 合并视图：两列（趋势 + 站外合并），合并列跨渠道去重，但跨月不算重复；
 *   4) 拆分视图：趋势 + 每渠道各一列，顺序在合并视图基础上展开，趋势列永远第一；
 *   5) 两种视图都给出「较趋势 ×…」的同期比值；
 *   6) 反向验证：拿掉「减一年」、拿掉比值基准、去重不带月份，都必须报错。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/merge-front.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

/* ================= 一、静态约定 ================= */
console.log("一、口径写死与切换按钮");
ok(/function colMonth\(c\) \{[\s\S]{0,200}c\.type === "rank" \? prevYearMonth\(state\.month\)/.test(SRC),
  "趋势列月份必须写死为「目标月 − 1 年」");
ok(!/同期对比（去年同月）/.test(SRC) && !/state\.sync/.test(SRC),
  "不再保留「同期对比」口径开关（口径已写死，留着会让人以为可以关）");
ok(/var SPLIT_KEY = "tb\.merge\.split"/.test(SRC) && /state\.split/.test(SRC),
  "拆分 / 合并视图可切换，并记住选择");
ok(/function columns\(\) \{[\s\S]{0,700}state\.split/.test(SRC), "列结构由视图决定（合并 2 列 / 拆分 N+1 列）");
ok(/function ratioText\(n, base\)/.test(SRC) && /较趋势 ×/.test(SRC),
  "每一列都给出「较趋势 ×…」的同期比值");
ok(/var out = \[\{ key: "mrg:rank", label: "趋势榜单"/.test(SRC), "趋势榜单列在列定义里固定第一");

/* ================= 二、真实执行 ================= */
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

/* 目标月 2027-01：渠道 P 1 张、T 2 张（含与 S 重复的一张）、S 3 张（含重复那张）
   趋势列 2026-01：r1 / r2 / 与渠道 p1 同一张（跨月不算重复）＋ 目标月榜单一条（不该进趋势列） */
function mkRows() {
  return {
    ch: [
      { image_url: "http://x/p1.jpg", category: "卫衣", period_label: "2027-01", channel: "Pinterest", title: "p1" },
      { image_url: "http://x/t1.jpg", category: "卫衣", period_label: "2027-01", channel: "TikTok", title: "t1" },
      { image_url: "http://x/s1.jpg", category: "卫衣", period_label: "2027-01", channel: "SHEIN", title: "s1" },
      { image_url: "http://x/s2.jpg", category: "卫衣", period_label: "2027-01", channel: "SHEIN", title: "s2" },
      { image_url: "http://x/dup.jpg", category: "卫衣", period_label: "2027-01", channel: "SHEIN", title: "dup" },
      { image_url: "http://x/dup.jpg", category: "卫衣", period_label: "2027-01", channel: "TikTok", title: "dup" },
    ],
    rank: [
      { id: 1, image_url: "http://x/r1.jpg", category: "卫衣", period_label: "2026-01", site: "美国", channel: "", title: "r1" },
      { id: 2, image_url: "http://x/r2.jpg", category: "卫衣", period_label: "2026年1月", site: "美国", channel: "", title: "r2" },
      { id: 3, image_url: "http://x/p1.jpg", category: "卫衣", period_label: "2026-01", site: "美国", channel: "", title: "去年同月的同款" },
      { id: 4, image_url: "http://x/rnow.jpg", category: "卫衣", period_label: "2027-01", site: "美国", channel: "", title: "目标月榜单（不该进趋势列）" },
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
  const rows = mkRows();
  const SB = {
    getSession: async () => ({ user: { email: "t@t" } }),
    getFrontendZoneVisibility: async () => null,
    myFrontendZones: async () => null,
    listRankChannelPics: async () => rows.ch,
    listRankItems: async () => rows.rank,
    listImageTags: async () => ({}), listMovementTags: async () => ({}),
  };
  const m = new Map();
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    document: doc,
    localStorage: {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: (k) => m.delete(k),
    },
    location: { href: "merge.html", pathname: "/merge.html", origin: "http://x", replace() {} },
  };
  sandbox.window = sandbox;
  sandbox.SB = SB;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(o.src || SRC, ctx);
  await new Promise((r) => setTimeout(r, 120));
  return { q, REG, sandbox };
}

function view(env) {
  const q = env.q;
  const body = () => String(q("#mrg-body").innerHTML || "");
  const seg = (key) => {
    const h = body();
    const i = h.indexOf('data-src="' + key + '"');
    if (i < 0) return "";
    const j = h.indexOf("</section>", i);
    return h.slice(i, j < 0 ? h.length : j);
  };
  const cards = (key) => (seg(key).match(/class="rk-card cmp-card"/g) || []).length;
  const urls = (key) => (seg(key).match(/data-url="[^"]+"/g) || []).map((x) => x.slice(10, -1));
  const order = () => (body().match(/data-src="[^"]+"/g) || []).map((x) => x.slice(10, -1));
  return {
    body, seg, cards, urls, order,
    pools: () => (body().match(/class="rk-pool"/g) || []).length,
    summary: () => String(q("#mrg-summary").textContent || ""),
    barInfo: () => String(q("#mrg-bar-info").innerHTML || ""),
    sw: () => textOf(q("#mrg-switch")),
  };
}

function textOf(n) {
  if (!n) return "";
  var t = String(n.textContent || "") + String(n.innerHTML || "");
  (n.children || []).forEach(function (c) { t += textOf(c); });
  return t;
}
function clickBtn(box, text) {
  let hit = null;
  (function walk(n) {
    if (!n || hit) return;
    const t = String(n.textContent || "") + String(n.innerHTML || "");
    if (n.tagName === "BUTTON" && t.indexOf(text) >= 0) { hit = n; return; }
    (n.children || []).forEach(walk);
  })(box);
  if (hit && typeof hit.onclick === "function") hit.onclick();
  return !!hit;
}

(async () => {
  /* ---------- 二、默认：合并视图 + 写死的同期口径 ---------- */
  console.log("二、合并视图：趋势 2026-01 ｜ 渠道 2027-01");
  const env = await run({});
  const v = view(env);
  ok(v.pools() === 2, "合并视图默认两列（实际 " + v.pools() + " 列）");
  ok(v.order()[0] === "mrg:rank", "趋势榜单永远在最左（实际 " + JSON.stringify(v.order()) + "）");
  ok(/>合并<|>合 并<|合并/.test(v.sw()) && /拆分/.test(v.sw()), "右上角有「合并 / 拆分」切换");
  ok(/去年同期|去年同月/.test(v.seg("mrg:rank")), "趋势列头写明是去年同月");
  ok(/2026-01/.test(v.seg("mrg:rank")), "趋势列头给出具体月份 2026-01");
  ok(/2027-01/.test(v.seg("mrg:ch")), "渠道列头给出目标月 2027-01");

  const rk = v.urls("mrg:rank");
  ok(rk.indexOf("http://x/r1.jpg") >= 0 && rk.indexOf("http://x/r2.jpg") >= 0,
    "趋势列摆 2026-01 的图（两种月份写法都认，实际 " + JSON.stringify(rk) + "）");
  ok(rk.indexOf("http://x/rnow.jpg") < 0, "趋势列不能摆目标月（2027-01）的榜单图");
  ok(rk.indexOf("http://x/p1.jpg") >= 0, "同一张图同时出现在去年同月与目标月时，趋势列仍要有（跨月不算重复）");

  const ch = v.urls("mrg:ch");
  ok(ch.length === 5, "合并列 5 张（p1/t1/s1/s2/dup 各一次，实际 " + ch.length + "）");
  ok(ch.filter((u) => /dup\.jpg$/.test(u)).length === 1, "同一张图被 S / T 两个渠道传过，合并列只摆一次");
  ok(ch.indexOf("http://x/s1.jpg") >= 0 && ch.indexOf("http://x/t1.jpg") >= 0 && ch.indexOf("http://x/p1.jpg") >= 0,
    "三个渠道都在这一列里");

  console.log("三、同期比值");
  ok(/较趋势 ×/.test(v.seg("mrg:rank")) || /较趋势 ×/.test(v.seg("mrg:ch")), "列头给出「较趋势 ×…」的比值");
  ok(/×1\.67/.test(v.seg("mrg:ch")), "合并列 5 张 / 趋势 3 张 = ×1.67（实际「" +
    (v.seg("mrg:ch").match(/较趋势 ×[\d.]+/) || ["无"])[0] + "」）");
  ok(/目标月 2027-01/.test(v.summary()) && /趋势 2026-01|去年同期 2026-01/.test(v.summary()),
    "筛选摘要写清两列各自的月份（实际「" + v.summary() + "」）");
  ok(/2027-01/.test(v.barInfo()) && /2026-01/.test(v.barInfo()), "工具条摘要同样写清两个月份");

  /* ---------- 四、拆分视图 ---------- */
  console.log("四、拆分视图：趋势 + 每渠道各一列");
  ok(clickBtn(env.REG["#mrg-switch"], "拆分"), "能点开「拆分」");
  await new Promise((r) => setTimeout(r, 40));
  const v2 = view(env);
  ok(v2.pools() === 4, "拆分后 4 列（趋势 + P + T + S，实际 " + v2.pools() + " 列）");
  ok(v2.order()[0] === "mrg:rank", "拆分后趋势列仍在最左（实际 " + JSON.stringify(v2.order()) + "）");
  ok(v2.order().join(",") === "mrg:rank,mrg:ch:pinterest,mrg:ch:tiktok,mrg:ch:shein",
    "拆分列顺序固定 P → T → S（实际 " + JSON.stringify(v2.order()) + "）");
  ok(v2.urls("mrg:ch:pinterest").length === 1, "P 列 1 张");
  ok(v2.urls("mrg:ch:tiktok").length === 2, "T 列 2 张（t1 + dup）");
  ok(v2.urls("mrg:ch:shein").length === 3, "S 列 3 张（s1 + s2 + dup）");
  ok(v2.urls("mrg:ch:pinterest").indexOf("http://x/s1.jpg") < 0, "拆分后各渠道互不串列");
  ok(v2.urls("mrg:rank").join(",") === v.urls("mrg:rank").join(","), "拆分时趋势列完全不动");
  ok(/×0\.33/.test(v2.seg("mrg:ch:pinterest")), "P 列 1 张 / 趋势 3 张 = ×0.33（实际「" +
    (v2.seg("mrg:ch:pinterest").match(/较趋势 ×[\d.]+/) || ["无"])[0] + "」）");
  ok(/×1\.00/.test(v2.seg("mrg:ch:shein")), "S 列 3 张 / 趋势 3 张 = ×1.00");

  console.log("五、切回合并");
  ok(clickBtn(env.REG["#mrg-switch"], "合并"), "能切回「合并」");
  await new Promise((r) => setTimeout(r, 40));
  ok(view(env).pools() === 2, "切回合并后回到两列（实际 " + view(env).pools() + " 列）");
  ok(view(env).urls("mrg:ch").length === 5, "合并列仍是 5 张");

  /* ---------- 六、反向验证 ---------- */
  console.log("六、反向验证：拿掉实现必须失败");
  const noMinus = SRC.replace('return (parseInt(mt[1], 10) - 1) + "-" + mt[2];', 'return mt[1] + "-" + mt[2];');
  ok(noMinus !== SRC, "「减一年」被改动（用例本身有效）");
  const bad1 = await run({ src: noMinus });
  ok(!(view(bad1).urls("mrg:rank").indexOf("http://x/r1.jpg") >= 0),
    "不做「减一年」时，趋势列会去摆目标月，本用例必须报错");

  const noMonthKey = SRC.replace('if (!uk) return;\n      seen[uk] = 1;', 'if (!uk) return;\n      seen[r.image_url] = 1;');
  const dedupNoMonth = /function dedupKey\(u, mo\) \{ return u \+ "@" \+ mo; \}/.test(SRC)
    ? SRC.replace('function dedupKey(u, mo) { return u + "@" + mo; }', 'function dedupKey(u, mo) { return u; }')
    : noMonthKey;
  ok(dedupNoMonth !== SRC, "去重桶被改动（用例本身有效）");
  const bad2 = await run({ src: dedupNoMonth });
  ok(view(bad2).urls("mrg:rank").indexOf("http://x/p1.jpg") < 0,
    "去重不带月份时，去年同月的同款图会被目标月吃掉（用例必须抓住）");

  const noRatio = SRC.replace(/return "较趋势 ×" \+ /, 'return "" + ');
  ok(noRatio !== SRC, "比值输出被改动（用例本身有效）");
  const bad3 = await run({ src: noRatio });
  ok(!/较趋势 ×/.test(view(bad3).seg("mrg:ch")), "去掉比值后，用例必须报错");

  console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})();
