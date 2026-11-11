/* 20261111AC · 渠道对比「一直加载中」回归测试
 *
 * 背景：这一页每次「优化加载」都会变成一直转圈。
 * 上一版的真实原因是取数分了多段串行等待：
 *   先等列配置（8 秒上限）→ 再并行等两张表（8 秒）→ 再补取一次榜单（8 秒）
 * 三段串起来最坏 24 秒，期间屏幕只有「加载中」。
 *
 * 所以这里不只看代码里有没有某个字符串，而是**用假 DOM + 假数据层真的把页面跑一遍**：
 *   用例 A：所有请求永远不返回 → 必须在超时后给出内容与重试入口，不能停在加载中；
 *   用例 B：数据正常返回 → 必须真的渲染出多列图片池。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const CF = fs.readFileSync(path.join(ROOT, "js/compare-front.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

/* ---------------- 假 DOM ---------------- */
function mkEl(tag) {
  const e = {
    tagName: (tag || "div").toUpperCase(), children: [], style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    _html: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    textContent: "", value: "", className: "", type: "", title: "", id: "", src: "", checked: false,
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, insertBefore() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl("div"); }, querySelectorAll() { return []; },
    get firstChild() { return this.children[0] || null; },
    onclick: null, onchange: null, onerror: null, oninput: null,
    focus() {}, click() {}, add() {}, cloneNode() { return mkEl(tag); },
    closest() { return null; }, contains() { return false; }, matches() { return false; },
  };
  e.parentNode = null;
  return e;
}

function makeEnv(SB) {
  const bySel = {};
  const doc = {
    readyState: "complete",
    body: mkEl("body"),
    title: "",
    getElementById(id) {
      const key = "#" + id;
      if (!bySel[key]) { bySel[key] = mkEl("div"); bySel[key].id = id; }
      return bySel[key];
    },
    querySelector(sel) {
      if (!bySel[sel]) bySel[sel] = mkEl("div");
      return bySel[sel];
    },
    querySelectorAll() { return []; },
    createElement(t) { return mkEl(t); },
    createTextNode(t) { return { nodeValue: t }; },
    addEventListener() {}, removeEventListener() {},
  };
  const win = {
    document: doc, console, setTimeout, clearTimeout, setInterval, clearInterval,
    JSON, Math, Date, Number, String, Array, Object, Promise, RegExp,
    SB, Common: {
      zones: {
        loadDefs: async () => [],
        setVis() {}, setMine() {}, applyNav() {},
        visible() { return true; },
      },
      visit: { track() {} },
    },
    CONFIG: { WORKER_URL: "https://example.invalid", siteTitle: "T" },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    addEventListener() {}, location: { href: "http://x/compare.html", search: "" },
    alert() {}, confirm() { return true; },
  };
  win.window = win;
  return { win, doc, bySel };
}

function bootWith(SB) {
  const env = makeEnv(SB);
  vm.createContext(env.win);
  vm.runInContext(CF, env.win, { filename: "compare-front.js" });
  return env;
}

const bodyText = (env) => String((env.bySel["#cmp-body"] || {}).innerHTML || "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 结构检查 ---------------- */
ok(/var all3 = await Promise\.all\(\[[\s\S]{0,500}?\]\);/.test(CF),
  "取数不是「一次性并行等一层」，可能又退化成分段等待");
ok(CF.indexOf("补取一次") < 0, "load 里仍有二次补取（会叠加超时，最坏等 24 秒）");
ok(/var LOAD_TIMEOUT = 8000;/.test(CF), "取数超时应为 8 秒");
ok(/clearInterval\(tick\)/.test(CF), "等待计时器没有清理（会一直跳秒）");
ok(/已等待/.test(CF), "加载时应显示已等待秒数，让人看出没卡死");
/* 打标失败不得放回队列（否则每次重试再等 6 秒，叠成「一直加载」） */
ok(CF.indexOf("delete state.tagAsked[k]") < 0, "打标失败仍放回待查队列，会反复各等 6 秒");

/* ---------------- 用例 A：请求永不返回 ---------------- */
const forever = () => new Promise(() => {});
{
  const env = bootWith({
    getFrontendZoneVisibility: async () => ({}),
    myFrontendZones: async () => null,
    listRankChannelPics: forever,
    listRankItems: forever,
    getCompareSources: forever,
  });
  const t0 = Date.now();
  await sleep(9000);
  const html = bodyText(env);
  const cost = Date.now() - t0;
  ok(cost < 11000, "超时用例耗时异常：" + cost + "ms");
  ok(html.indexOf("加载中…") < 0 || html.indexOf("读取数据…") < 0, "9 秒后仍停在加载文案上");
  ok(/暂时没读到数据|重新加载|读取失败/.test(html),
    "请求全挂时应给出明确说明与重试入口，实际：" + html.slice(0, 80));
}

/* ---------------- 用例 B：数据正常 ---------------- */
{
  const rows = [
    { id: 1, image_url: "https://img.example.invalid/a.jpg", category: "T恤", period_label: "2026-03", channel: "SHEIN", title: "A" },
    { id: 2, image_url: "https://img.example.invalid/b.jpg", category: "T恤", period_label: "2026-03", channel: "Pinterest", title: "B" },
  ];
  const env = bootWith({
    getFrontendZoneVisibility: async () => ({}),
    myFrontendZones: async () => null,
    listRankChannelPics: async () => rows,
    listRankItems: async () => [],
    getCompareSources: async () => null,
    listMovementTags: async () => ({}),
  });
  await sleep(600);
  const html = bodyText(env);
  ok(/rk-pools/.test(html), "有数据时应渲染出多列图片池");
  ok(/cmp-card/.test(html), "应渲染出图片卡片");
  ok(html.indexOf("SHEIN") >= 0, "列名应出现 SHEIN");
  ok(html.indexOf("Pinterest") >= 0, "列名应出现 Pinterest");
  ok(html.indexOf("加载中…") < 0 && html.indexOf("正在读取数据…") < 0, "有数据后不应残留加载文案");
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
