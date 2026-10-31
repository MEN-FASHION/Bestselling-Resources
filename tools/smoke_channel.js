#!/usr/bin/env node
/* ============================================================================
 * tools/smoke_channel.js —— 渠道雷达前端逻辑的离线冒烟测试（不连数据库）
 *
 * 目的：在不接真实库的沙箱里，验证 channel-front.js 的核心纯逻辑没错：
 *   · 周次列表按 week_sort 倒序（2026-W9 不会排到 2026-W44 后面）
 *   · 渠道顺序 = 后台字典顺序；停用的渠道不出列；字典里没有但库里有图的补在最后
 *   · 类目 / 渠道 / 周次 三层筛选取交集
 * 做法：给源码套一个最小的假 DOM + 假数据层，跑真实文件里的函数。
 *       只断言"算出来的清单对不对"，不校验视觉。
 * ==========================================================================*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "js/channel-front.js"), "utf8");

/* ---------------- 最小假 DOM ---------------- */
function makeEl(id) {
  const el = {
    id, innerHTML: "", textContent: "", className: "", style: {}, children: [],
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return ""; },
    addEventListener() {}, onclick: null, title: "", src: "", type: "",
  };
  return el;
}
const ids = ["ch-weeks", "ch-cats", "ch-channels", "ch-bar", "ch-body", "ch-toast",
  "ch-modal", "ch-close", "ch-ch-all", "ch-ch-none", "ch-big", "ch-title", "ch-tags"];
const store = {};
ids.forEach((i) => { store[i] = makeEl(i); });

const document = {
  getElementById: (i) => store[i] || null,
  querySelector: (sel) => store[String(sel).replace(/^#/, "")] || makeEl(sel),
  querySelectorAll: () => [],
  createElement: (t) => makeEl(t),
  addEventListener() {},
  readyState: "complete",
  body: makeEl("body"),
};

/* ---------------- 假数据 ---------------- */
const SITES = [
  { id: 1, name: "SHEIN", sort_order: 10, active: true },
  { id: 2, name: "TEMU", sort_order: 20, active: true },
  { id: 3, name: "旧渠道", sort_order: 30, active: false },   // 停用 → 不应出列
  { id: 4, name: "AMAZON", sort_order: 40, active: true },
];
function item(id, cat, ch, week, sort) {
  return { id, image_url: "u/" + id, path: "p/" + id, category: cat, channel: ch,
    week_label: week, week_sort: sort, title: "t" + id, batch_id: "b" };
}
const ITEMS = [
  item(1, "T恤", "SHEIN", "2026-W44", 202644),
  item(2, "T恤", "SHEIN", "2026-W9", 202609),
  item(3, "T恤", "TEMU", "2026-W44", 202644),
  item(4, "长裤", "TEMU", "2026-W44", 202644),
  item(5, "T恤", "旧渠道", "2026-W44", 202644),   // 停用渠道的图 → 前台不应出现
  item(6, "T恤", "野渠道", "2026-W43", 202643),   // 字典里没有 → 应补在最后
  item(7, "T恤", "", "2026-W44", 202644),         // 无渠道 → 归到「未分渠道」
];

const SB = {
  async listChannelSites() { return SITES.slice(); },
  async listChannelItems() { return ITEMS.slice(); },
  async listChannelTags() { return { "u/1": { style_tags: ["复古"] } }; },
  async getChannelTagVisibility() { return {}; },
  async getFrontendZoneVisibility() { return {}; },
  imageUrl(it) { return "https://x/" + it.path; },
  client: { auth: { async getSession() { return { data: { session: { user: { email: "a@b" } } } }; } } },
};

const Common = { zones: {
  async loadDefs() {}, setVis() {}, applyNav() {}, renderNav() {},
} };

const sandbox = { document, window: {}, console, setTimeout, clearTimeout, location: { replace() {}, href: "" } };
sandbox.window = sandbox;
sandbox.window.SB = SB;
sandbox.window.Common = Common;
sandbox.window.document = document;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox, { filename: "channel-front.js" });

/* ---------------- 断言 ---------------- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

/* 把 el 的「innerHTML + 子节点文字」拼成一串，用来断言渲染结果 */
function dump(el) {
  if (!el) return "";
  return String(el.innerHTML || "") + (el.children || []).map(dump).join("|");
}

setTimeout(() => {
  const body = store["ch-body"].innerHTML || "";
  const chText = dump(store["ch-channels"]);
  const wkText = dump(store["ch-weeks"]);

  console.log("\n[1] 渠道列");
  ok("TEMU 有列", body.indexOf("TEMU") >= 0);
  ok("SHEIN 有列", body.indexOf("SHEIN") >= 0);
  ok("停用渠道不出列", body.indexOf("旧渠道") < 0, "旧渠道应被隐藏");
  ok("渠道胶囊里也不出现停用渠道", chText.indexOf("旧渠道") < 0);
  ok("字典外渠道补在最后（胶囊里能看到）", chText.indexOf("野渠道") >= 0, chText);
  ok("列顺序 = 字典顺序（SHEIN 在 TEMU 前）",
    body.indexOf("SHEIN") < body.indexOf("TEMU"), "SHEIN 应排在 TEMU 之前");

  console.log("\n[2] 周次");
  ok("W44 排在 W9 前面", wkText.indexOf("2026-W44") < wkText.indexOf("2026-W9"),
    "周次必须按 week_sort 排，不能按字符串排：" + wkText);
  ok("默认选中最新一周 W44", body.indexOf("2026-W44") >= 0);

  console.log("\n[3] 未分渠道");
  ok("空渠道归入「未分渠道」并出现在胶囊里", chText.indexOf("未分渠道") >= 0, chText);
  const colN = (body.match(/class="rk-pool ch-pool"/g) || []).length;
  ok("默认并排 3 列", colN === 3, "实际 " + colN + " 列");

  console.log("\n结果：通过 " + pass + "，失败 " + fail);
  process.exit(fail ? 1 : 0);
}, 60);
