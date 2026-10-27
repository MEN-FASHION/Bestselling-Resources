/* ============================================================
 * 趋势上升榜：前台筛选栏「感应收缩」—— 运行时验证
 *
 * 用真实 rank.html + 真实 js/rank.js（jsdom，假 SB）验证：
 *   ① 默认收起：只占一行摘要，面板不显示、不占位；
 *   ② 鼠标上移感应展开（pointerenter），无需点击；
 *   ③ 鼠标移开延迟收起（不会一抖就闪退）；
 *   ④ 选好「单选类」条件 → 自动收起；「多选类」条件 → 保持展开；
 *   ⑤ 触屏 / 点击可开合；触摸的 pointerenter 不会抢跑；
 *   ⑥ Esc 收起；收起后摘要仍显示当前条件。
 *
 * 用法：node tools/verify_rank_filter_sense.js [仓库根目录]
 * ============================================================ */
const fs = require("fs");
const path = require("path");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) { console.error("需要先安装 jsdom"); process.exit(2); }

const ROOT = process.argv[2] || ".";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; failures.push(name + (extra ? "  [" + extra + "]" : "")); console.log("  \u2717 " + name + (extra ? "  [" + extra + "]" : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITES = ["美国", "英国", "德国", "法国"];
const PERIODS = ["2026W39", "2026W40", "2026W41", "2026W42"];

function makeItems() {
  const out = [];
  SITES.forEach((s) => PERIODS.forEach((p) => {
    for (let i = 0; i < 4; i++) {
      out.push({
        image_url: "https://img.newtrend.top/p/" + s + "_" + p + "_" + i + ".jpg",
        site: s, period_label: p, category: "卫衣", leaf_category: "卫衣",
        ratio: 1 + i, abs_delta: 60 - i * 5,
      });
    }
  }));
  return out;
}

function makeSB() {
  const items = makeItems();
  const impl = {
    getSession: async () => ({ access_token: "T", user: { id: "u1", email: "a@b.c" } }),
    onAuth: () => {}, onAuthChange: () => {}, currentToken: async () => "T",
    signOut: async () => {}, myRole: async () => "super",
    getFrontendZoneVisibility: async () => ({}),
    myFrontendZones: async () => null,
    rankFacets: async () => ({ sites: SITES.slice(), periods: PERIODS.slice(), categories: ["卫衣"] }),
    listRankSites: async () => SITES.map((n) => ({ name: n })),
    getRankGroups: async () => ([{ name: "欧洲", members: ["英国", "德国", "法国"] }]),
    getRankHidden: async () => ({ sites: [], periods: [] }),
    listRankItems: async (f) => {
      const s = (f && f.sites) || [], p = (f && f.periods) || [];
      return items.filter((it) => (!s.length || s.indexOf(it.site) >= 0) && (!p.length || p.indexOf(it.period_label) >= 0));
    },
  };
  return new Proxy(impl, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k !== "string") return undefined;
      return async () => null;
    },
  });
}

async function bootRank(query) {
  const html = read("rank.html").replace(/<script src="[^"]*"><\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://newtrend.top/rank.html" + (query || ""), runScripts: "dangerously", pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message || e.error)));
  window.addEventListener("unhandledrejection", (e) => errors.push("unhandled: " + e.reason));
  window.eval(read("js/config.js"));
  window.SB = makeSB();
  const src = read("js/rank.js");
  const hooked = src.replace(/\}\)\(\);\s*$/, "window.__F=function(){return {MODE:MODE,SEL_SITES:SEL_SITES,SEL_PERIODS:SEL_PERIODS,TAGS:TAGS};};})();");
  if (hooked === src) throw new Error("无法注入测试导出（rank.js 尾部结构变化）");
  window.eval(hooked);
  for (let i = 0; i < 60; i++) await sleep(20);
  return { dom, window, errors };
}

const isOpen = (w) => w.document.getElementById("rk-filter").classList.contains("is-open");
function firePointer(w, type, pointerType) {
  const el = w.document.getElementById("rk-filter");
  const e = new w.Event(type, { bubbles: false });
  Object.defineProperty(e, "pointerType", { value: pointerType || "mouse" });
  el.dispatchEvent(e);
}
function click(w, sel) {
  const el = w.document.querySelector(sel);
  if (!el) throw new Error("找不到元素：" + sel);
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
}

(async function main() {
  console.log("== 趋势上升榜：筛选栏「感应收缩」运行时验证 ==");
  const css = read("css/style.css");

  /* ---------- 静态：样式层面的收缩 / 展开规则 ---------- */
  console.log("\n[1] 样式：收起态隐藏面板，展开态才显示");
  ok("存在收起态规则（#rk-filter:not(.is-open) .tf-body 隐藏）",
    /#rk-filter:not\(\.is-open\) \.tf-body\s*\{[^}]*visibility:\s*hidden/.test(css));
  ok("存在展开态规则（#rk-filter.is-open .tf-body 可见）",
    /#rk-filter\.is-open \.tf-body\s*\{[^}]*visibility:\s*visible/.test(css));
  ok("面板改为悬浮（不再 static 占位）",
    /#rk-filter \.tf-body\s*\{[^}]*position:\s*absolute/.test(css) && !/#rk-filter \.tf-body\s*\{[^}]*position:\s*static/.test(css));
  ok("触发条恢复可点的指针样式", /#rk-filter \.tf-trigger\s*\{[^}]*cursor:\s*pointer/.test(css));
  ok("箭头恢复显示（收起时也有开合提示）", /#rk-filter \.tf-arrow\s*\{[^}]*display:\s*inline-block/.test(css));
  ok("上方有感应带、下方有过桥带（鼠标上下滑不掉线）",
    /#rk-filter \.tf-trigger::before\s*\{[^}]*bottom:\s*100%/.test(css) &&
    /#rk-filter \.tf-trigger::after\s*\{[^}]*top:\s*100%/.test(css));

  /* ---------- ① 默认收起 ---------- */
  console.log("\n[2] 默认收起：只占一行摘要");
  {
    const ctx = await bootRank("");
    const w = ctx.window;
    ok("初始未展开", !isOpen(w));
    const sum = w.document.getElementById("rk-summary").textContent.trim();
    ok("收起态摘要已填好当前条件", sum.length > 0 && sum.indexOf("·") > 0, sum);
    ok("面板在 DOM 里但被收起（visibility 由样式控制）",
      w.document.querySelector("#rk-filter .tf-body") !== null);
    ok("无未捕获错误", ctx.errors.length === 0, ctx.errors.join(" | ").slice(0, 160));

    /* ---------- ② 鼠标上移感应展开 ---------- */
    console.log("\n[3] 鼠标移到筛选条上 → 自动展开（不用点）");
    firePointer(w, "pointerenter", "mouse");
    await sleep(30);
    ok("pointerenter 后已展开", isOpen(w));

    /* ---------- ③ 移开延迟收起 ---------- */
    console.log("\n[4] 鼠标移开 → 延迟收起（不会一抖就闪退）");
    firePointer(w, "pointerleave", "mouse");
    await sleep(60);
    ok("移开后 60ms 内仍然展开（留出滑回的时间）", isOpen(w));
    await sleep(260);
    ok("约 200ms 后收起", !isOpen(w));

    /* ---------- ④a 单选类条件 → 自动收起 ---------- */
    console.log("\n[5] 选好「单选类」条件后自动收起");
    firePointer(w, "pointerenter", "mouse");
    await sleep(30);
    click(w, '#rk-g-tags [data-tag="hot"]');
    await sleep(80);
    ok("刚点完还在展开态（让人看清高亮）", isOpen(w));
    await sleep(360);
    ok("约 340ms 后自动收起", !isOpen(w));
    ok("条件确实生效（标签=趋势爆款）", (w.__F().TAGS || []).join(",") === "hot", JSON.stringify(w.__F().TAGS));

    /* 触发条 / 排序 / 图幅 同样单选 → 收起 */
    firePointer(w, "pointerenter", "mouse");
    await sleep(30);
    click(w, '#rk-g-sort [data-sort="abs_desc"]');
    await sleep(400);
    ok("点排序项后也自动收起", !isOpen(w));

    firePointer(w, "pointerenter", "mouse");
    await sleep(30);
    click(w, '#rk-g-size [data-size="l"]');
    await sleep(400);
    ok("点图幅档位后也自动收起", !isOpen(w));

    /* ---------- ④b 纵向模式下「国家」是单选 → 同样收起 ---------- */
    console.log("\n[6] 纵向模式下国家是单选（点完同样自动收起）");
    ok("当前是纵向·时间对比（站点默认模式）", w.__F().MODE === "v", w.__F().MODE);
    firePointer(w, "pointerenter", "mouse");
    await sleep(30);
    const siteChipsV = Array.prototype.slice.call(w.document.querySelectorAll("#rk-g-sites [data-site]"));
    siteChipsV[1].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(420);
    ok("点完一个国家（单选）后自动收起", !isOpen(w));
    ok("国家确实只剩一个", (w.__F().SEL_SITES || []).length === 1, JSON.stringify(w.__F().SEL_SITES));

    /* ---------- ⑤ 点击开合（触屏） ---------- */
    console.log("\n[7] 触屏 / 点击：点一下展开，再点一下收起");
    firePointer(w, "pointerleave", "mouse");
    await sleep(260);
    ok("先回到收起态", !isOpen(w));
    click(w, "#rk-trigger");
    await sleep(20);
    ok("点击触发条 → 展开", isOpen(w));
    click(w, "#rk-trigger");
    await sleep(20);
    ok("再点一下 → 收起", !isOpen(w));
    firePointer(w, "pointerenter", "touch");
    await sleep(30);
    ok("触摸的 pointerenter 不会抢跑展开（避免一点就开又立刻关）", !isOpen(w));

    /* ---------- ⑥ Esc ---------- */
    console.log("\n[8] 键盘：Esc 收起");
    firePointer(w, "pointerenter", "mouse");
    await sleep(30);
    ok("先展开", isOpen(w));
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    ok("按 Esc 立即收起", !isOpen(w));

    /* ---------- ⑦ 收起后仍能继续操作 + 无报错 ---------- */
    console.log("\n[9] 收起态摘要跟随条件变化，且全程无报错");
    const sum2 = w.document.getElementById("rk-summary").textContent.trim();
    ok("摘要随条件更新（含趋势标签名）", /趋势|全部/.test(sum2), sum2);
    ok("无未捕获错误", ctx.errors.length === 0, ctx.errors.join(" | ").slice(0, 200));
    w.close();
  }

  /* ---------- ⑧ 横向模式：国家多选不自动收起 ---------- */
  console.log("\n[10] 横向·国家对比：国家多选保持展开，方便连着点");
  {
    const ctx = await bootRank("?mode=h");
    const w = ctx.window;
    ok("当前是横向·国家对比", w.__F().MODE === "h", w.__F().MODE);
    firePointer(w, "pointerenter", "mouse");
    await sleep(30);
    ok("横向模式已展开", isOpen(w));
    const siteChips = Array.prototype.slice.call(w.document.querySelectorAll("#rk-g-sites [data-site]"));
    ok("国家是多选（有多个可点项）", siteChips.length >= 2, String(siteChips.length));
    /* 注意：点完会整块重绘，必须重新取节点，否则点到的是已脱离文档的旧节点 */
    const before = (w.__F().SEL_SITES || []).slice();
    const pickOff = () => {
      const cur = w.__F().SEL_SITES || [];
      const cands = Array.prototype.slice.call(w.document.querySelectorAll("#rk-g-sites [data-site]"))
        .filter((b) => cur.indexOf(b.getAttribute("data-site")) < 0);
      return cands[0];
    };
    const target = pickOff();
    target.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(420);
    ok("点完一个国家后仍保持展开（可继续加对比列）", isOpen(w));
    ok("确实加进了一个国家", (w.__F().SEL_SITES || []).length === before.length + 1, before + " -> " + w.__F().SEL_SITES);
    /* 再点一枪（这次点一个已选中的，取消它）—— 仍不应收起 */
    const chosen = (w.__F().SEL_SITES || [])[0];
    const again = Array.prototype.slice.call(w.document.querySelectorAll("#rk-g-sites [data-site]"))
      .filter((b) => b.getAttribute("data-site") === chosen)[0];
    again.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(420);
    ok("再点一个（取消它）仍保持展开", isOpen(w));
    ok("取消确实生效（该国家被摘掉）", (w.__F().SEL_SITES || []).indexOf(chosen) < 0, chosen + " / " + JSON.stringify(w.__F().SEL_SITES));
    ok("横向可同时对比多个国家（>=2）", (w.__F().SEL_SITES || []).length >= 2, JSON.stringify(w.__F().SEL_SITES));
    ok("无未捕获错误", ctx.errors.length === 0, ctx.errors.join(" | ").slice(0, 160));
    w.close();
  }

  /* ---------- ⑨ 纵向模式：周次多选不自动收起 ---------- */
  console.log("\n[11] 纵向·时间对比：周次多选同样保持展开");
  {
    const ctx = await bootRank("?mode=v");
    const w = ctx.window;
    firePointer(w, "pointerenter", "mouse");
    await sleep(30);
    ok("纵向模式已展开", isOpen(w));
    const pchips = Array.prototype.slice.call(w.document.querySelectorAll("#rk-g-periods [data-period]"));
    pchips[pchips.length - 1].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(420);
    ok("点完一个周次后仍保持展开（可继续多选列）", isOpen(w));
    ok("周次确实变多了", (w.__F().SEL_PERIODS || []).length >= 2, JSON.stringify(w.__F().SEL_PERIODS));

    /* 纵向模式下国家是单选 → 点完应收起 */
    const schips = Array.prototype.slice.call(w.document.querySelectorAll("#rk-g-sites [data-site]"));
    schips[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(420);
    ok("纵向模式下点国家（单选）后自动收起", !isOpen(w));
    ok("国家确实变成单个", (w.__F().SEL_SITES || []).length === 1, JSON.stringify(w.__F().SEL_SITES));
    ok("无未捕获错误", ctx.errors.length === 0, ctx.errors.join(" | ").slice(0, 160));
    w.close();
  }

  console.log("\n== 结果：" + pass + " 项通过，" + fail + " 项失败 ==");
  if (failures.length) { console.log("失败项："); failures.forEach((f) => console.log(" - " + f)); }
  process.exit(fail ? 1 : 0);
})();
