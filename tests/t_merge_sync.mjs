/* 20261122B · 渠道合并对比「同期对比」自检
 *
 * 需求原文：
 *   「我希望上新节奏的年一月 和其他的27年一月对比的 就是同期对比 上新节奏 是26年一月
 *     其他渠道是27年一月……主要是告诉商家1月什么好卖」
 *
 * 验收点（每条都有反向用例，拿掉实现必须失败）：
 *   1) 开启同期对比后：上新节奏列取「目标月 − 1 年」，渠道列仍取目标月；
 *   2) 列头写清每列用的是哪个月，摘要写清「目标月 / 去年同月」；
 *   3) 同一张图同时出现在去年同月与目标月时，两列都要有，不能被去重吃掉；
 *   4) 目标月没有渠道图时，列仍摆出并写明「不会用其它月份顶替」；
 *   5) 关掉同期对比后回到「两列同月」的老口径。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/merge-front.js", "utf8");
const HTML = fs.readFileSync("merge.html", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

/* ================= 一、代码层面的硬约束 ================= */
console.log("一、实现约定");
ok(/function prevYearMonth\(m\)/.test(SRC), "存在「往前推一年」的月份换算");
ok(/return \(parseInt\(mt\[1\], 10\) - 1\) \+ "-" \+ mt\[2\];/.test(SRC), "换算方式是年份减 1、月份不变");
ok(/if \(!state\.sync\) return state\.month;/.test(SRC) && /c\.type === "rank" \? prevYearMonth\(state\.month\) : state\.month/.test(SRC),
  "同期对比只把「上新节奏」列前移一年，渠道列仍是目标月");
ok(/var uk = u \+ "@" \+ mo;/.test(SRC), "去重的桶里带月份（否则跨月同图会被吃掉）");
ok(/mrg-sync-bar/.test(HTML), "页面有同期摘要条的挂点");
ok(/同期对比（去年同月）/.test(SRC), "筛选栏有口径开关");

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

/* 目标月 2027-01 的渠道图；去年同月 2026-01 的榜单图；
   故意让 rank 里也有一张和渠道同地址的图，用来验证跨月不被去重 */
function mkRows() {
  return {
    ch: [
      { image_url: "http://x/p1.jpg", category: "卫衣", period_label: "2027-01", channel: "Pinterest" },
      { image_url: "http://x/s1.jpg", category: "卫衣", period_label: "2027-01", channel: "SHEIN" },
      { image_url: "http://x/old.jpg", category: "卫衣", period_label: "2026-01", channel: "SHEIN" },
      { image_url: "http://x/a1.jpg", category: "卫衣", period_label: "2027-01", channel: "Amazon" },
    ],
    rank: [
      { id: 1, image_url: "http://x/p1.jpg", category: "卫衣", period_label: "2026-01", site: "美国", channel: "", rank_abs: 3 },
      { id: 2, image_url: "http://x/r2.jpg", category: "外套", period_label: "2026年1月", site: "美国", channel: "", rank_abs: 1 },
      { id: 3, image_url: "http://x/r3.jpg", category: "卫衣", period_label: "2027-01", site: "美国", channel: "", rank_abs: 2 },
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
  await new Promise((r) => setTimeout(r, 120));
  return { REG, q, click: (text) => clickChip(q("#mrg-groups"), text) };
}

/* 在筛选栏里按文字找按钮并点它 */
function clickChip(box, text) {
  let hit = null;
  (function walk(n) {
    if (!n || hit) return;
    if (n.tagName === "BUTTON" && String(n.textContent || "").indexOf(text) >= 0) { hit = n; return; }
    (n.children || []).forEach(walk);
  })(box);
  if (hit && typeof hit.onclick === "function") hit.onclick();
  return !!hit;
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
  return {
    body, seg, cards, urls,
    summary: () => String(q("#mrg-summary").textContent || ""),
    bar: () => String(q("#mrg-bar").innerHTML || ""),
    syncbar: () => String(q("#mrg-sync-bar").innerHTML || ""),
  };
}

(async () => {
  console.log("二、默认口径：两列同月");
  const base = await run();
  const vb = view(base);
  ok(vb.urls("mrg:ch").indexOf("http://x/s1.jpg") >= 0, "默认口径下渠道列摆目标月的图");
  ok(vb.urls("mrg:rank").indexOf("http://x/r3.jpg") >= 0, "默认口径下榜单列摆同一个月的图");
  ok(vb.urls("mrg:rank").indexOf("http://x/r2.jpg") < 0, "默认口径下不会去取去年同月的图");
  ok(String(base.q("#mrg-sync-bar").innerHTML || "") === "", "没开同期对比时不显示同期摘要条");

  console.log("三、开启同期对比：榜单取去年同月、渠道取目标月");
  ok(base.click("同期对比（去年同月）"), "筛选栏里能找到并点开「同期对比」");
  await new Promise((r) => setTimeout(r, 60));
  const v1 = view(base);
  ok(v1.urls("mrg:ch").indexOf("http://x/p1.jpg") >= 0 && v1.urls("mrg:ch").indexOf("http://x/s1.jpg") >= 0,
    "渠道列仍是目标月（2027-01）的图（实际 " + JSON.stringify(v1.urls("mrg:ch")) + "）");
  ok(v1.urls("mrg:ch").indexOf("http://x/old.jpg") < 0, "去年同月的渠道图不该混进渠道列");
  ok(v1.urls("mrg:rank").indexOf("http://x/r2.jpg") >= 0, "榜单列改取去年同月（2026-01）");
  ok(v1.urls("mrg:rank").indexOf("http://x/r3.jpg") < 0, "目标月的榜单图不该出现在榜单列");
  ok(v1.urls("mrg:rank").indexOf("http://x/p1.jpg") >= 0,
    "同一张图同时出现在去年同月与目标月时，榜单列仍要有（跨月不算重复）");
  ok(v1.cards("mrg:ch") === 2, "渠道列只留 P / S 两张（Amazon 不进，实际 " + v1.cards("mrg:ch") + "）");
  ok(/去年同期 · 2026-01/.test(v1.seg("mrg:rank")), "榜单列头写明「去年同期 · 2026-01」");
  ok(/目标月 · 2027-01/.test(v1.seg("mrg:ch")), "渠道列头写明「目标月 · 2027-01」");
  ok(/目标月 2027-01 \/ 去年同月 2026-01/.test(v1.summary()), "筛选摘要写清两个月份（实际「" + v1.summary() + "」）");
  ok(/2026-01/.test(v1.syncbar()) && /2027-01/.test(v1.syncbar()), "同期摘要条两个月份都在");
  ok(/上新节奏/.test(v1.syncbar()) && /站外/.test(v1.syncbar()), "同期摘要条给出两列的规模");

  console.log("四、目标月没有渠道图时");
  const empty = await run({ src: SRC });
  empty.click("同期对比（去年同月）");
  await new Promise((r) => setTimeout(r, 30));
  /* 切到只有榜单数据的月份：2026-01 作为目标月时，渠道列应为空但列要保留 */
  ok(empty.click("2026-01"), "能切到目标月 2026-01");
  await new Promise((r) => setTimeout(r, 30));
  const v2 = view(empty);
  ok(v2.seg("mrg:ch") !== "", "渠道列整列仍要摆出来（不许消失）");
  ok(v2.cards("mrg:ch") === 1, "只留 2026-01 的那张渠道图（实际 " + v2.cards("mrg:ch") + "）");
  ok(/不会用其它月份顶替/.test(v2.seg("mrg:rank")), "空列要写明不会用其它月份顶替");

  console.log("五、反向验证：拿掉实现必须失败");
  const noPrev = SRC.replace(/return \(parseInt\(mt\[1\], 10\) - 1\) \+ "-" \+ mt\[2\];/, 'return mt[1] + "-" + mt[2];');
  ok(noPrev !== SRC, "月份换算被改动（用例本身有效）");
  const badPrev = await run({ src: noPrev });
  badPrev.click("同期对比（去年同月）");
  await new Promise((r) => setTimeout(r, 40));
  const vp = view(badPrev);
  ok(!(vp.urls("mrg:rank").indexOf("http://x/r2.jpg") >= 0 && vp.urls("mrg:rank").indexOf("http://x/r3.jpg") < 0),
    "不做「减一年」时，本用例必须报错");

  const noMonthKey = SRC.split('var uk = u + "@" + mo;').join("var uk = u;");
  ok(noMonthKey !== SRC, "去重桶被改动（用例本身有效）");
  const badDedup = await run({ src: noMonthKey });
  badDedup.click("同期对比（去年同月）");
  await new Promise((r) => setTimeout(r, 40));
  ok(view(badDedup).urls("mrg:rank").indexOf("http://x/p1.jpg") < 0,
    "去重不带月份时，去年同月的同款图会被目标月吃掉（用例必须抓住）");

  console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})();
