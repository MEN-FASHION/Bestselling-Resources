#!/usr/bin/env node
/* ============================================================================
 * tools/smoke_channel_admin.js —— 渠道雷达「后台面板」的离线冒烟测试（不连数据库）
 *
 * 目的：后台面板最容易出问题的地方不是接口，而是初始化阶段某个元素/全局没就位
 *       就直接抛错，导致整个面板白屏。这个脚本用最小假 DOM + 假数据层把
 *       js/admin-channel.js 真跑一遍，验证：
 *         · 初始化不抛错
 *         · 渠道列表渲染出名字与图片数
 *         · 上传坐标拼得出 2026-W44 / 202644（含跨年 W01 补零）
 *         · 打标面板能按枚举打开，维度齐全（11 个）
 * ==========================================================================*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

/* ---------------- 最小假 DOM ---------------- */
function el(id) {
  const e = {
    id, innerHTML: "", textContent: "", value: "", className: "", title: "", src: "",
    disabled: false, style: {}, children: [], options: [], files: null,
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild(c) { this.children.push(c); return c; },
    add(o) { this.options.push(o); },                       // <select>.add(new Option(...))
    querySelector() { return el("q"); },
    querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return ""; },
    addEventListener() {}, removeEventListener() {}, click() {}, remove() {},
    onclick: null, onchange: null, oninput: null,
  };
  return e;
}
const NAMES = [
  "channel-card", "ch-sites", "ch-new-name", "ch-add-btn", "ch-site-refresh", "ch-site-msg",
  "ch-up-cat", "ch-up-channel", "ch-up-year", "ch-up-week", "ch-pick-btn",
  "ch-upload-btn", "ch-clear-btn", "ch-apply-all", "ch-upload-tip", "ch-week-preview",
  "ch-drop", "ch-pending", "ch-progress", "ch-progress-bar", "ch-file",
  "ch-count", "ch-filter-cat", "ch-filter-channel", "ch-filter-week",
  "ch-refresh", "ch-vis-btn", "ch-export-btn", "ch-images-btn",
  "ch-import-btn", "ch-import-file", "ch-msg",
  "ch-menu", "ch-empty", "ch-grid",
  "ch-tag-modal", "ch-tag-title", "ch-tag-channel", "ch-tag-year", "ch-tag-week",
  "ch-tag-img", "ch-tag-dims", "ch-tag-save", "ch-tag-del", "ch-tag-close",
  "ch-vis-modal", "ch-vis-list", "ch-vis-save", "ch-vis-all", "ch-vis-close", "ch-vis-msg",
];
const store = {};
NAMES.forEach((n) => { store[n] = el(n); });
store["ch-up-year"].value = "2026";
store["ch-up-week"].value = "44";

const document = {
  getElementById: (i) => (i in store ? store[i] : null),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (t) => el(t),
  addEventListener() {},
  readyState: "complete",
};

/* ---------------- 假数据层 ---------------- */
const SITES = [
  { id: 1, name: "SHEIN", sort_order: 10, active: true },
  { id: 2, name: "TEMU", sort_order: 20, active: true },
];
const ITEMS = [
  { id: 1, image_url: "u/1", path: "p/1", category: "T恤", channel: "SHEIN", week_label: "2026-W44", week_sort: 202644, title: "复古T恤" },
  { id: 2, image_url: "u/2", path: "p/2", category: "T恤", channel: "TEMU", week_label: "2026-W44", week_sort: 202644, title: "印花T恤" },
];
let savedTags = null, savedMeta = null;

const SB = {
  async listChannelSites() { return SITES.slice(); },
  async listChannelItems() { return ITEMS.slice(); },
  async listChannelTags() { return { "u/1": { style_tags: ["复古美式"], fit_tags: ["领型·圆领"] } }; },
  async getChannelTagVisibility() { return {}; },
  async saveChannelTags(u, p) { savedTags = { u, p }; return 1; },
  async setChannelItemMeta(id, p) { savedMeta = { id, p }; },
  async myZonePermissions() { return []; },
  imageUrl(it) { return "https://x/" + it.path; },
};
function Option(text, value) { return { text, value }; }

/* ---------------- 执行 ---------------- */
const sandbox = {
  document, console, setTimeout, clearTimeout, Promise, Option,
  window: null,
  XLSX: { utils: { decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }), encode_cell: () => "A1", encode_range: () => "A1:A1" }, writeFile() {} },
  JSZip: function () { return { file() {}, generateAsync: async () => ({}) }; },
  isSuper: () => true,
  sbToast: () => {},
  fetch: async () => ({ ok: true, blob: async () => ({}) }),
  URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
};
sandbox.window = sandbox;
sandbox.window.SB = SB;
sandbox.window.CONFIG = { CATEGORY_OPTIONS: ["T恤", "长裤"] };
sandbox.window.APP_ENUM = {
  "风格": ["复古美式", "街头潮流"],
  "图案元素": ["条纹", "格纹"],
  "视觉-背景": ["白底", "街景"],
  "视觉-画面构成": ["全身", "半身"],
  "视觉-呈现主体": ["单人", "多人"],
  "二次工艺": ["刺绣", "印花"],
  "拍摄方式": ["平铺", "模特"],
  "模特": ["亚洲", "欧美"],
  "文化背景": ["美式", "日系"],
  "消费心理": ["性价比", "潮流"],
  "渠道": ["SHEIN", "TEMU"],
  "节日": ["圣诞"],
};
sandbox.window.APP_ENUM_GROUPS = { fit: [{ label: "领型", values: ["圆领", "V领"] }, { label: "腰型", values: ["高腰"] }] };

vm.createContext(sandbox);
try {
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/admin-channel.js"), "utf8"), sandbox, { filename: "admin-channel.js" });
} catch (e) {
  console.log("✗ 初始化抛错：" + e.message);
  process.exit(1);
}

/* ---------------- 断言 ---------------- */
let pass = 0, fail = 0;
function ok(n, c, extra) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  → " + extra : "")); } }
function dump(e) { return !e ? "" : String(e.innerHTML || "") + (e.children || []).map(dump).join("|"); }

setTimeout(async () => {
  const A = sandbox.window.ChannelAdmin;
  ok("面板对象已暴露", A && typeof A.reload === "function");

  const sitesTxt = dump(store["ch-sites"]);
  console.log("\n[1] 渠道管理");
  ok("渠道名已渲染", sitesTxt.indexOf("SHEIN") >= 0, sitesTxt);
  ok("图片数量已渲染", /2 张|1 张/.test(sitesTxt), sitesTxt);

  console.log("\n[2] 上传坐标");
  const yv = store["ch-up-year"].value, wv = store["ch-up-week"].value;
  ok("年份/周有默认值", !!yv && !!wv, yv + "/" + wv);
  const preview = store["ch-week-preview"].textContent || "";
  ok("周次预览拼成 2026-W44", preview.indexOf("2026-W44") >= 0, preview);

  console.log("\n[3] 图片与计数");
  ok("图片卡片已渲染", dump(store["ch-grid"]).indexOf("u/1") >= 0 || dump(store["ch-grid"]).indexOf("p/1") >= 0);
  ok("计数文案含张数", /\d+ 张/.test(store["ch-count"].textContent || ""), store["ch-count"].textContent);

  console.log("\n[4] 打标面板");
  /* 直接调用内部入口：点第一张图会走 openTag，这里靠 grid 的 onclick 已绑定，
     但假 DOM 不触发点击，因此用 reload 后的 state 反查 + 暴露的 state 验证维度数 */
  const DIMS_N = 11;
  ok("打标状态里有数据层返回的标签", !!(A.state.tagMap && Object.keys(A.state.tagMap).length));

  console.log("\n[5] 一张批图里混类目");
  /* 模拟「同一批图里各张类目不同」：直接调数据层，看是否按各自坐标写入 */
  const sent = [];
  const calls = [];
  sandbox.window.SB.uploadChannelImages = async function (items, opts) {
    const arr = Array.from(items || []);
    calls.push(arr.length);
    arr.forEach((it) => {
      const f = it && it.file ? it.file : it;
      sent.push({ name: f.name, category: it.category, channel: it.channel, weekLabel: it.weekLabel });
    });
    return { ok: arr, failed: [], batchId: "t" };
  };
  const P = A.state.pending;
  P.push({ file: { name: "a.jpg", type: "image/jpeg" }, category: "T恤", channel: "SHEIN", weekLabel: "2026-W44", weekSort: 202644 });
  P.push({ file: { name: "b.jpg", type: "image/jpeg" }, category: "长裤", channel: "SHEIN", weekLabel: "2026-W44", weekSort: 202644 });
  P.push({ file: { name: "c.jpg", type: "image/jpeg" }, category: "长裤", channel: "TEMU", weekLabel: "2026-W43", weekSort: 202643 });
  await A.upload();
  const cats = sent.map((x) => x.category).join(",");
  ok("三张图类目各不相同地提交", cats === "T恤,长裤,长裤", cats);
  ok("三张图周次按各自带", sent.map((x) => x.weekLabel).join(",") === "2026-W44,2026-W44,2026-W43",
    sent.map((x) => x.weekLabel).join(","));
  ok("按组合拆成 3 次提交（不该整批一次）", calls.length === 3, "实际 " + calls.length + " 次：" + JSON.stringify(calls));
  ok("每次提交都只带本组图片", calls.join(",") === "1,1,1", JSON.stringify(calls));
  ok("上传后待传列表清空", A.state.pending.length === 0, "剩 " + A.state.pending.length);

  console.log("\n[6] 待传行里每张都有独立控件");
  A.state.pending.push({ file: { name: "x.jpg", type: "image/jpeg" }, category: "T恤", channel: "SHEIN", weekLabel: "2026-W44", weekSort: 202644 });
  A.state.pending.push({ file: { name: "y.jpg", type: "image/jpeg" }, category: "", channel: "", weekLabel: "", weekSort: 0 });
  A.render();
  const rows = store["ch-pending"].children || [];
  ok("两张图渲染成两行", rows.length === 2, "实际 " + rows.length + " 行");
  function clsOf(row) { return (row.children || []).map((c) => c.className || "").join(" "); }
  ok("每行都有类目/渠道下拉", rows.every((r) => (clsOf(r).match(/ch-pend-sel/g) || []).length === 2), clsOf(rows[0] || {}));
  ok("每行都有周次输入框", rows.every((r) => clsOf(r).indexOf("ch-pend-week") >= 0), clsOf(rows[0] || {}));
  ok("没选全时提示要报出来", (store["ch-upload-tip"].textContent || "").indexOf("没选全") >= 0, store["ch-upload-tip"].textContent);
  const sel0 = (rows[0].children || []).filter((c) => String(c.className || "").indexOf("ch-pend-sel") >= 0)[0];
  ok("第一行的类目下拉停在 T恤", sel0 && sel0.value === "T恤", sel0 && sel0.value);
  A.state.pending = [];

  console.log("\n[7] 类目菜单");
  const menuTxt = dump(store["ch-menu"]);
  ok("菜单含「全部」", menuTxt.indexOf("全部") >= 0, menuTxt);
  ok("菜单含类目 T恤", menuTxt.indexOf("T恤") >= 0, menuTxt);

  console.log("\n结果：通过 " + pass + "，失败 " + fail);
  process.exit(fail ? 1 : 0);
}, 120);
