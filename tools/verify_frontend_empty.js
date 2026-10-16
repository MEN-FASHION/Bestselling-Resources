/* ============================================================
 * 前台「视觉专区图片为空」运行时验证（真实 DOM + 真实前台脚本）
 *
 * 目的：用真浏览器环境（jsdom 解析真实 index.html + 执行真实 js/frontend.js）
 *       复现并验证：
 *         ① 取数接口报错时，页面是否把真实原因说出来（而不是含糊提示）
 *         ② 标签筛选把结果滤空时，是否明确指出"是标签筛掉的"并给出清除入口
 *         ③ 无数据与接口故障是否能区分
 *         ④ 正常有数据时网格正常渲染、空态不显示
 *
 * 用法：node verify_frontend_empty.js <站点仓库根目录>
 * ============================================================ */
const fs = require("fs");
const path = require("path");
let JSDOM;
try {
  JSDOM = require("jsdom").JSDOM;
} catch (e) {
  console.error("需要先安装 jsdom（本脚本用真实浏览器环境跑前台脚本，做运行时验证）：");
  console.error("  npm install jsdom@22.1.0 --registry=<你的内部 npm 源>");
  console.error("  或在项目根目录执行：npm i jsdom@22.1.0");
  process.exit(2);
}

const ROOT = process.argv[2] || ".";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  " + "\u2713" + " " + name); }
  else { fail++; failures.push(name + (extra ? "  [" + extra + "]" : "")); console.log("  " + "\u2717" + " " + name + (extra ? "  [" + extra + "]" : "")); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 构造可控的假数据层：只覆盖本站前台真正会调用的方法，
// 其余方法一律返回安全默认值（避免用桩掩盖真实执行路径）。
function makeSB(window, cfg) {
  const calls = [];
  const imgs = cfg.images || [];
  const s = cfg.session === undefined ? { access_token: "T", user: { id: "u1", email: "a@b.c" } } : cfg.session;

  const impl = {
    // 登录与配置
    getSession: async () => s,
    onAuth: () => {},
    onAuthChange: () => {},
    currentToken: async () => "T",
    myFrontendZones: async () => cfg.myZones || null,
    getPublicAccess: async () => false,
    getFrontendZoneVisibility: async () => cfg.zoneVis || {},
    getFrontendCatVisibility: async () => cfg.catVis || {},
    getFrontendDims: async () => ({}),
    // 类目/标签元数据
    listActiveCats: async () => cfg.activeCats || ["T恤", "卫衣"],
    listUsedCats: async () => cfg.usedCats || [],
    listTagDefs: async () => cfg.tagDefs || [],
    // 图片取数
    frontendTagStats: async () => cfg.stats || { total: imgs.length, categories: {} },
    countFrontendImages: async () => imgs.length,
    listFrontendImages: async (limit, offset) => {
      calls.push({ m: "listFrontendImages", limit, offset });
      // failList：两条链路都失败；failNoArgOnly：仅"无参取全量"这条失败（用于验证回退）
      if (cfg.failList) throw new Error(cfg.failList);
      if (cfg.failNoArgOnly && typeof limit !== "number") throw new Error(cfg.failNoArgOnly);
      if (typeof limit === "number") return imgs.slice(offset || 0, (offset || 0) + limit);
      return imgs;
    },
  };

  // 其余未显式实现的方法：按需返回安全默认值，保证真实代码继续往下跑
  return new Proxy(impl, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k !== "string") return undefined;
      return async () => null;
    },
  });
}

async function boot(cfg) {
  const html = read("index.html").replace(/<script src="[^"]*"><\/script>/g, "");
  const dom = new JSDOM(html, {
    url: "https://newtrend.top/index.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message || e.error)));
  window.addEventListener("unhandledrejection", (e) => errors.push("unhandled: " + e.reason));

  window.eval(read("js/config.js"));
  window.SB = makeSB(window, cfg);
  // 跳过"默认落地到榜单页"的跳转，避免 jsdom 导航告警干扰
  try { window.sessionStorage.setItem("nl_landed", "1"); } catch (e) {}
  window.eval(read("js/common.js"));
  window.eval(read("js/frontend.js"));

  // 等启动流程（登录态→loadGallery→renderGrid）跑完
  for (let i = 0; i < 40; i++) { await sleep(50); }
  const $ = (sel) => window.document.querySelector(sel);
  const tip = $("#empty-tip");
  const tipText = tip ? tip.textContent.trim() : "";
  const tipVisible = !!(tip && !tip.classList.contains("hidden"));
  const cells = window.document.querySelectorAll("#grid > *").length;
  return { dom, window, errors, tip, tipText, tipVisible, cells, $ };
}

const IMG = (cat, extra) => Object.assign({
  id: "i" + Math.random().toString(36).slice(2, 7), name: "n", path: "images/a.jpg",
  category: cat, tags: [], style_tags: [], element_tags: [], scene_tags: [], shoot_tags: [], skin_tags: [],
}, extra || {});

(async function main() {
  console.log("== 前台视觉专区空态：运行时验证 ==");
  console.log("仓库根目录：" + path.resolve(ROOT));

  // ---------- 场景 1：取数接口报错（后台有图、前台接口读不到）----------
  {
    console.log("\n[1] 取数接口报错（后台能看到图，前台取数失败）");
    const r = await boot({ session: { access_token: "T", user: { id: "u1", email: "a@b.c" } },
      usedCats: ["T恤", "卫衣"], activeCats: ["T恤", "卫衣"],
      failList: "接口不存在或未授权（模拟）", images: [] });
    ok("类目菜单仍然渲染出「T恤」（说明类目走的是另一条链路）", /T恤/.test(r.$("#cat-menu").textContent));
    // 点开「T恤」→ 走筛选视图（调用无参取数接口）
    const btns = [...r.window.document.querySelectorAll("#cat-menu button")];
    const t = btns.find(b => b.textContent.trim() === "T恤");
    ok("存在「T恤」类目按钮", !!t);
    if (t) { t.click(); for (let i = 0; i < 20; i++) await sleep(50); }
    const tip2 = r.$("#empty-tip");
    const vis = tip2 && !tip2.classList.contains("hidden");
    const txt = tip2 ? tip2.textContent.trim() : "";
    ok("空态提示可见", vis);
    ok("提示中说明了「图片读取失败」这一真实原因，而不是含糊地说没有图片",
      /读取失败|读取不到|接口/.test(txt), txt.slice(0, 60));
    ok("提示中给出可操作入口（重试）", !!r.$("#empty-tip button"), txt.slice(0, 60));
    console.log("    实际提示：" + txt.slice(0, 120));
  }

  // ---------- 场景 2：标签筛选把结果滤空 ----------
  {
    console.log("\n[2] 该分类有图，但被标签筛选全部滤掉");
    const r = await boot({
      session: { access_token: "T", user: { id: "u1", email: "a@b.c" } },
      usedCats: ["T恤"], activeCats: ["T恤"],
      tagDefs: [{ name: "通勤", type: "style", group: "" }],
      images: [IMG("T恤", { style_tags: ["街头"] }), IMG("T恤", { style_tags: ["街头"] })],
    });
    const btns = [...r.window.document.querySelectorAll("#cat-menu button")];
    const t = btns.find(b => b.textContent.trim() === "T恤");
    if (t) t.click();
    for (let i = 0; i < 20; i++) await sleep(50);
    // 点一个不存在的标签（通勤），把结果滤空
    const chips = [...r.window.document.querySelectorAll(".tag-bar button, .tagchip, [data-tag]")];
    const chip = chips.find(c => /通勤/.test(c.textContent));
    if (chip) { chip.click(); for (let i = 0; i < 20; i++) await sleep(50); }
    const tip = r.$("#empty-tip");
    const txt = tip ? tip.textContent.trim() : "";
    console.log("    标签候选数=" + chips.length + "，实际提示：" + txt.slice(0, 140));
    ok("提示明确指出是「标签筛选」造成的空结果", /标签/.test(txt), txt.slice(0, 80));
    ok("提示给出「清除筛选」入口", !!r.$("#empty-tip button"), txt.slice(0, 80));
  }

  // ---------- 场景 3：真的一开始就没有图片 ----------
  {
    console.log("\n[3] 该专区确实没有图片");
    const r = await boot({ session: { access_token: "T", user: { id: "u1", email: "a@b.c" } },
      usedCats: [], activeCats: [], images: [] });
    ok("空态提示可见", r.tipVisible);
    ok("提示不含「读取失败」等故障字样（与接口故障区分开）",
      !/读取失败|失败|接口异常/.test(r.tipText), r.tipText.slice(0, 80));
    console.log("    实际提示：" + r.tipText.slice(0, 100));
  }

  // ---------- 场景 4：正常有图 ----------
  {
    console.log("\n[4] 正常有图：网格渲染、空态隐藏");
    const imgs = [IMG("T恤"), IMG("T恤"), IMG("卫衣")];
    const r = await boot({ session: { access_token: "T", user: { id: "u1", email: "a@b.c" } },
      usedCats: ["T恤", "卫衣"], activeCats: ["T恤", "卫衣"], images: imgs,
      stats: { total: 3, categories: { "T恤": 2, "卫衣": 1 } } });
    ok("默认「全部」视图渲染出图片卡片", r.cells >= 3, "cells=" + r.cells);
    ok("空态提示隐藏", !r.tipVisible, r.tipText.slice(0, 60));
    const btns = [...r.window.document.querySelectorAll("#cat-menu button")];
    const t = btns.find(b => b.textContent.trim() === "T恤");
    if (t) { t.click(); for (let i = 0; i < 20; i++) await sleep(50); }
    ok("切到「T恤」后渲染出该类目图片", r.window.document.querySelectorAll("#grid > *").length === 2,
      "cells=" + r.window.document.querySelectorAll("#grid > *").length);
    ok("无未捕获脚本错误", r.errors.length === 0, r.errors.join(" | ").slice(0, 120));
  }

  // ---------- 场景 5：无参取数失败，但分页接口可用 → 自动回退，图片照常显示 ----------
  {
    console.log("\n[5] 两条读图链路互为备份：无参失败时自动回退到分页接口");
    const imgs = [IMG("T恤"), IMG("T恤"), IMG("卫衣")];
    const r = await boot({ session: { access_token: "T", user: { id: "u1", email: "a@b.c" } },
      usedCats: ["T恤", "卫衣"], activeCats: ["T恤", "卫衣"], images: imgs,
      failNoArgOnly: "无参取全量失败（模拟）",
      stats: { total: 3, categories: { "T恤": 2, "卫衣": 1 } } });
    const btns = [...r.window.document.querySelectorAll("#cat-menu button")];
    const t = btns.find(b => b.textContent.trim() === "T恤");
    if (t) { t.click(); for (let i = 0; i < 24; i++) await sleep(50); }
    const cells = r.window.document.querySelectorAll("#grid > *").length;
    ok("回退生效：该类目图片正常渲染出来", cells === 2, "cells=" + cells);
    ok("回退成功时不显示空态（不误报数据没了）", !(r.$("#empty-tip") && !r.$("#empty-tip").classList.contains("hidden")));
  }

  // ---------- 场景 6：「清除标签筛选」按钮真能恢复出图 ----------
  {
    console.log("\n[6] 点「清除标签筛选」后图片恢复显示");
    const r = await boot({
      session: { access_token: "T", user: { id: "u1", email: "a@b.c" } },
      usedCats: ["T恤"], activeCats: ["T恤"],
      tagDefs: [{ name: "通勤", type: "style", group: "" }],
      images: [IMG("T恤", { style_tags: ["街头"] }), IMG("T恤", { style_tags: ["街头"] })],
    });
    const cv = r.$("#empty-tip button");
    const btns = [...r.window.document.querySelectorAll("#cat-menu button")];
    const t = btns.find(b => b.textContent.trim() === "T恤");
    if (t) t.click();
    for (let i = 0; i < 20; i++) await sleep(50);
    const chips = [...r.window.document.querySelectorAll(".tag-chip")];
    const chip = chips.find(c => /通勤/.test(c.textContent));
    if (chip) { chip.click(); for (let i = 0; i < 20; i++) await sleep(50); }
    const btn = r.$("#empty-tip button");
    ok("出现「清除标签筛选」按钮", !!btn && /清除/.test(btn.textContent));
    if (btn) {
      btn.click();
      for (let i = 0; i < 20; i++) await sleep(50);
      const cells = r.window.document.querySelectorAll("#grid > *").length;
      ok("点击后图片恢复显示", cells === 2, "cells=" + cells);
      ok("点击后空态隐藏", !!(r.$("#empty-tip") && r.$("#empty-tip").classList.contains("hidden")));
    }
  }

  console.log("\n== 结果：" + pass + " 项通过，" + fail + " 项失败 ==");
  if (fail) { console.log("失败项：\n - " + failures.join("\n - ")); process.exit(1); }
})();