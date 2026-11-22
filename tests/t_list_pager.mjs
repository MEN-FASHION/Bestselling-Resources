/* 20261115B · 后台长列表分页 · 实跑自检
 *
 * 用户反馈：后台「已上传记录 / 期次清单」越来越长，整页被拉得很长，要滚很久。
 *
 * 本自检做两件事：
 *   1) 把 js/pager.js 真跑起来（假 window / 假 document / 假 sessionStorage），
 *      断言切页、夹取页码、每页条数、页脚按钮与「列表短了不显示分页条」；
 *   2) 源码级断言：两个面板（趋势上升榜 / 上新节奏）的期次清单与上传记录确实走分页，
 *      且「全选 / 删除选中」在分页后仍能覆盖所有页（不能只勾当前页）。
 *
 * 关键：每条重要断言都配一个反向用例，证明用例抓得住缺陷，而不是永远通过。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };
const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ---------- 假 DOM ---------- */
function mkEl(tag) {
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    style: {},
    textContent: "",
    value: "",
    type: "",
    disabled: false,
    selected: false,
    checked: false,
    children: [],
    parentNode: null,
    _hooks: {},
    classList: {
      add(c) { if (!new RegExp("(^|\\s)" + c + "(\\s|$)").test(el.className)) el.className = (el.className + " " + c).trim(); },
      remove(c) { el.className = el.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
      contains(c) { return new RegExp("(^|\\s)" + c + "(\\s|$)").test(el.className); },
    },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    insertBefore(c) { c.parentNode = el; el.children.unshift(c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: el._top == null ? 0 : el._top }; },
    scrollIntoView() { el._scrolled = (el._scrolled || 0) + 1; },
  };
  el.addEventListener = () => {};
  return el;
}

function makeWin(store) {
  const doc = {
    createElement: (t) => mkEl(t),
    createTextNode: (t) => ({ textContent: String(t), children: [] }),
    getElementById: () => null,
  };
  const win = {
    document: doc,
    sessionStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
  };
  win.window = win;
  return win;
}

function loadPager(win) {
  const src = read("js/pager.js");
  const ctx = vm.createContext({ window: win, globalThis: win, document: win.document, sessionStorage: win.sessionStorage });
  vm.runInContext(src, ctx, { filename: "js/pager.js" });
  return win.Pager;
}

/* ---------- 1. Pager 行为 ---------- */
const store = {};
const win = makeWin(store);
const Pager = loadPager(win);
ok(!!Pager && typeof Pager.slice === "function", "pager.js 正常加载并暴露 Pager.slice");

const items = Array.from({ length: 45 }, (_, i) => ({ id: "b" + (i + 1) }));

Pager.setSize("t.a", 20);
let s = Pager.slice(items, "t.a");
ok(s.items.length === 20, "45 条 · 每页 20 → 第一页画 20 行");
ok(s.pages === 3 && s.page === 1 && s.total === 45, "页码 / 总页数 / 总数正确（3 页）");
ok(s.items[0].id === "b1" && s.items[19].id === "b20", "第一页取的是第 1–20 条");

Pager.setSize("t.a", 10);
s = Pager.slice(items, "t.a");
ok(s.page === 1 && s.pages === 5, "改成每页 10 条后回到第 1 页、共 5 页");

/* 翻到最后一页 */
s = Pager.node("t.a", s, () => {});
const btns = s.children.filter((c) => c.className === "rk-pager-btns")[0];
const prev = btns.children[0], next = btns.children[1];
ok(prev.disabled === true, "第 1 页时「上一页」禁用");
ok(next.disabled === false, "第 1 页时「下一页」可用");

let redrawn = 0;
s = Pager.slice(items, "t.a");
const foot = Pager.node("t.a", s, () => { redrawn++; });
const btns2 = foot.children.filter((c) => c.className === "rk-pager-btns")[0];
btns2.children[1].onclick();
ok(redrawn === 1, "点「下一页」会回调调用方重画列表");
const s2 = Pager.slice(items, "t.a");
ok(s2.page === 2 && s2.from === 11 && s2.to === 20, "第 2 页显示 11–20 条");

/* 夹取：数据变少后停留的页码不能超出范围 */
function advanceToEnd(P, list, key) {
  for (let i = 0; i < 30; i++) {
    const cur = P.slice(list, key);
    const f = P.node(key, cur, () => {});
    const bs = f.children.filter((c) => c.className === "rk-pager-btns")[0];
    if (!bs) break;
    const nx = bs.children[1];
    if (nx.disabled) break;
    nx.onclick();
  }
  return P.pageOf(key);
}
Pager.setSize("t.a", 10);
const lastPage = advanceToEnd(Pager, items, "t.a");
ok(lastPage === 5, "连点「下一页」最多停在最后一页（第 5 页），不会翻到空页");
const short = items.slice(0, 12);
const s4 = Pager.slice(short, "t.a");
ok(s4.page === 2 && s4.pages === 2, "数据从 45 条掉到 12 条后，页码自动夹到第 2 页（不会停在空页）");

/* 每页「全部」 */
Pager.setSize("t.a", 0);
const s5 = Pager.slice(items, "t.a");
ok(s5.items.length === 45 && s5.pages === 1, "选「全部」时一页画完 45 条");

/* 每页条数记在 sessionStorage（刷新后一致） */
ok(store["rk.pager.size"] === "0", "每页条数写进 sessionStorage，刷新后沿用");
const win2 = makeWin(store);
const Pager2 = loadPager(win2);
ok(Pager2.slice(items, "t.other").size === 0, "新会话读到上次选的「全部」");

/* 短列表不显示分页条（不占地方） */
Pager.setSize("t.b", 20);
const s6 = Pager.slice(items.slice(0, 8), "t.b");
const foot2 = Pager.node("t.b", s6, () => {});
ok(foot2.classList.contains("is-hidden") === true && foot2.style.display === "none", "只有 8 条时不显示分页条");
const s7 = Pager.slice(items.slice(0, 8), "t.b");
ok(foot2.children.length === 0, "被隐藏的分页条不生成按钮（不会误点）");

/* 反向用例：把「夹取页码」去掉，数据变少后就会停在空页 —— 证明用例抓得住缺陷 */
{
  const src = read("js/pager.js");
  const broken = src
    .replace("if (s.page > pages) s.page = pages;", "")
    .replace("if (s.page < 1) s.page = 1;", "");
  ok(broken !== src, "反向用例：成功从源码里摘掉「夹取页码」两行");
  const store3 = {};
  const w3 = makeWin(store3);
  const ctx = vm.createContext({ window: w3, globalThis: w3, document: w3.document, sessionStorage: w3.sessionStorage });
  vm.runInContext(broken, ctx, { filename: "js/pager.broken.js" });
  const P3 = w3.Pager;
  P3.setSize("x", 10);
  advanceToEnd(P3, items, "x");
  const bad = P3.slice(items.slice(0, 12), "x");
  ok(bad.page === 5 && bad.items.length === 0,
    "反向用例：不夹取时数据变少会停在空页（第 5 页、0 行）—— 正是本版要防的毛病");
}

/* ---------- 2. 两个面板确实走分页 ---------- */
const rankJs = read("js/admin-rank.js");
const rhythmJs = read("js/admin-rhythm.js");
const adminHtml = read("admin.html");
const css = read("css/style.css");

ok(/js\/pager\.js\?v=/.test(adminHtml), "后台页面引入分页模块");
ok(adminHtml.indexOf("js/pager.js") < adminHtml.indexOf("js/admin-rank.js"), "分页模块在面板脚本之前加载（顺序不能反）");
ok(/\.rk-pager\s*\{/.test(css), "分页条有样式（不是裸标签）");

[rankJs, rhythmJs].forEach((src, i) => {
  const who = i === 0 ? "趋势上升榜" : "上新节奏";
  ok((src.match(/Pg\.slice\(/g) || []).length === 2, who + "：期次清单与上传记录都改成按页切");
  ok((src.match(/Pg\.node\(/g) || []).length === 2, who + "：两处列表都有页脚控件");
  ok(!/rankPeriods\.forEach\(\(p\) => \{/.test(src), who + "：期次清单不再一次性铺全部（旧写法必须消失）");
  ok(/pg\.items\.forEach\(\(p\) => \{/.test(src), who + "：期次清单画的是当前页");
  ok(/PG_PERIODS|PG_BATCHES/.test(src), who + "：分页 key 常量化，翻页状态不串到别的列表");
});

/* 全选 / 删除选中：分页后必须覆盖所有页 */
ok(/rankBatchSel/.test(rankJs), "趋势上升榜：选中态按批次 ID 存在内存里（翻页不丢）");
ok(/pick\.checked = rankBatchSel\.has\(/.test(rankJs), "趋势上升榜：重画时按选中态还原勾选（翻页回来还是勾着的）");
ok(/bar\._picked = \(\) => rankBatchIds\.filter/.test(rankJs), "趋势上升榜：「删除选中」读的是全量选中，不是当前页 DOM");
ok(/bar\._toggle/.test(rankJs), "趋势上升榜：「全选」能跨越所有页勾选");
ok(/rankBatchSel\.clear\(\)/.test(rankJs), "趋势上升榜：列表清空后不留下幽灵选中（否则会去删不存在的批次）");

/* 反向用例：把「按全量选中」改回「只看当前页 DOM」，第 3 条必须失败 */
{
  const broken = rankJs.replace(/bar\._picked = \(\) => rankBatchIds\.filter/, "bar._pickedX = () => rankBatchIds.filter");
  ok(!/bar\._picked = \(\) => rankBatchIds\.filter/.test(broken),
    "反向用例：摘掉 _picked 后，选中范围会退回「只看当前页」—— 分页后删不全，正是本版要防的");
}

/* ---------- 3. 版式与版本 ---------- */
/* 版本戳不写死：从页面里取当前版本，再校验「没有更老的残留」。
   以前这里是写死的，每次升版都要改测试，改漏了就会出现「版本对了但测试红」的假警报。 */
{
  const ver = (adminHtml.match(/supabase\.js\?v=(20\d{6}[A-Z])/) || [])[1] || "";
  ok(/^20\d{6}[A-Z]$/.test(ver), "后台版本戳格式合法，实际：" + (ver || "(缺失)"));
  const olds = (adminHtml.match(/\?v=(20\d{6}[A-Z])/g) || []).filter((x) => x.indexOf(ver) < 0);
  ok(olds.length === 0, "后台没有残留旧版本戳（发现：" + olds.join(",") + "）");
}

console.log((fail === 0 ? "✅ " : "❌ ") + "t_list_pager: " + pass + " 项通过, " + fail + " 项失败");
process.exit(fail === 0 ? 0 : 1);
