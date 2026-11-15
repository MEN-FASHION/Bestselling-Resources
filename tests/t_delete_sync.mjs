/* 20261114W · 「删了图片不立刻消失，非要刷新整页」的回归自检
 *
 * 事故现象：后台删掉一张图，界面上那张图还在，必须手动刷新整个网页才消失。
 * 根因两层：
 *   1) 页面之间没有任何通知机制（后台删完，已打开着的前台不知道要重取）；
 *   2) 数据层有内存缓存（榜单条目 CACHE_MAP、渠道图文档 30 秒缓存），
 *      即使重新取数，读回来的仍是缓存里那份，删掉的那张依旧在。
 *
 * 本测试做两件事：
 *   A. 真跑 js/data-sync.js（假 localStorage / BroadcastChannel / document）：
 *      广播发出、其它标签页收到后先清缓存再重取、页面不可见时延后到切回来再补、
 *      同一条通知不重复处理、页面没登记重取函数时不许抛错。
 *   B. 静态核对接线是否齐全：各前台页面引了 data-sync.js、各模块登记了 __tbReload、
 *      各后台删除入口都广播、数据层有 invalidateCaches 且真的清了缓存变量。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 假环境 ---------------- */
function makeEnv() {
  const store = {};
  const listeners = {};
  const channels = [];
  const calls = [];

  class FakeBC {
    constructor(name) { this.name = name; this.onmessage = null; this.posted = []; channels.push(this); }
    postMessage(d) { this.posted.push(d); }
  }

  const document = {
    readyState: "complete",
    hidden: false,
    _vis: [],
    addEventListener(t, fn) { (this._vis = this._vis || []).push([t, fn]); },
    dispatch(t) { (this._vis || []).forEach(([k, fn]) => { if (k === t) fn(); }); },
  };

  const window = {
    SB: { invalidateCaches() { calls.push("invalidate"); } },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    dispatch(t, ev) { (listeners[t] || []).forEach((fn) => fn(ev)); },
  };
  document.dispatchEvent = document.dispatch;

  const sandbox = {
    window, document,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    BroadcastChannel: FakeBC,
    setTimeout, clearTimeout, Date, JSON, console,
  };
  sandbox.globalThis = sandbox;
  window.localStorage = sandbox.localStorage;
  return { sandbox, store, listeners, channels, calls, window, document };
}

function bootSync() {
  const env = makeEnv();
  const src = read("js/data-sync.js");
  vm.runInNewContext(src, env.sandbox, { filename: "js/data-sync.js" });
  return env;
}

/* ============ A. 真跑模块 ============ */
{
  const env = bootSync();
  const DS = env.window.DataSync;
  ok(!!DS && typeof DS.bump === "function" && typeof DS.watch === "function", "data-sync.js 暴露了 DataSync.bump / watch");
  ok(env.channels.length === 1, "创建了一个广播通道");

  /* 1. bump 同时写 localStorage 与广播 */
  DS.bump("images");
  const raw = env.store["tb_data_rev"];
  ok(!!raw, "bump 写了 localStorage（兜底通道）");
  const payload = JSON.parse(raw || "{}");
  ok(payload.kind === "images" && payload.t > 0, "广播内容带 kind 与时间戳");
  ok(env.channels[0].posted.length === 1, "bump 同时发出了一条广播");

  /* 2. 别的标签页：收到广播 → 先清缓存，再重取 */
  let reloaded = 0;
  env.window.__tbReload = () => { reloaded++; env.calls.push("reload"); };
  env.channels[0].onmessage({ data: { t: Date.now() + 5, kind: "images" } });
  ok(reloaded === 0, "收到通知后不立刻重取（250ms 合并，避免连续删除时反复重绘）");
  await sleep(320);
  ok(reloaded === 1, "收到其它标签页的通知后自动重取一次，不需要手动刷新");
  ok(env.calls[0] === "invalidate" && env.calls[1] === "reload", "重取之前先清数据层缓存（否则读回来还是旧数据）");

  /* 3. 同一条通知不重复处理（广播与 storage 可能同时到） */
  const t0 = Date.now() + 100;
  env.channels[0].onmessage({ data: { t: t0, kind: "images" } });
  env.window.dispatch("storage", { key: "tb_data_rev", newValue: JSON.stringify({ t: t0, kind: "images" }) });
  await sleep(320);
  ok(reloaded === 2, "同一条通知只处理一次（广播 + storage 双通道不产生两次重绘）");

  /* 4. 页面不可见时先记着，切回来才补 */
  env.document.hidden = true;
  env.channels[0].onmessage({ data: { t: Date.now() + 200, kind: "images" } });
  await sleep(320);
  ok(reloaded === 2, "页面在后台时不重绘（不做白工）");
  env.document.hidden = false;
  env.document.dispatch("visibilitychange");
  await sleep(320);
  ok(reloaded === 3, "切回页面时补一次重取，回到前台就是最新的");

  /* 5. 页面没登记重取函数 => 静默跳过，不抛错 */
  delete env.window.__tbReload;
  let threw = false;
  try {
    env.channels[0].onmessage({ data: { t: Date.now() + 300, kind: "x" } });
    await sleep(320);
  } catch (e) { threw = true; }
  ok(!threw, "页面没有 __tbReload 时静默跳过，不产生报错");

  /* 6. 数据层没有 invalidateCaches 也不许崩 */
  const env2 = bootSync();
  env2.window.SB = {};
  env2.window.__tbReload = () => {};
  let threw2 = false;
  try {
    env2.window.DataSync.bump("x");
    env2.channels[0].onmessage({ data: { t: Date.now() + 1, kind: "x" } });
    await sleep(320);
  } catch (e) { threw2 = true; }
  ok(!threw2, "数据层缺少清缓存方法时不影响重取");
}

/* ============ B. 接线核对 ============ */
{
  /* B1. 各页面都引了 data-sync.js（且排在 supabase.js 之后） */
  const pages = ["index.html", "rank.html", "rhythm.html", "trends.html", "movement.html",
    "compare.html", "shein.html", "pinterest.html", "tiktok.html", "fav.html", "admin.html", "marketing.html"];
  pages.forEach((p) => {
    const html = read(p);
    ok(html.indexOf("js/data-sync.js") >= 0, p + " 引入了 data-sync.js");
    const iSup = html.indexOf("js/supabase.js");
    const iSync = html.indexOf("js/data-sync.js");
    ok(iSup >= 0 && iSync > iSup, p + " 里 data-sync.js 排在数据层之后加载");
  });

  /* B2. 需要自动重取的页面都登记了 __tbReload */
  const hooks = {
    "js/rank.js": "window.__tbReload",
    "js/rhythm.js": "window.__tbReload",
    "js/frontend.js": "window.__tbReload",
    "js/channel-zone-front.js": "window.__tbReload",
    "js/movement-front.js": "window.__tbReload",
    "js/compare-front.js": "window.__tbReload",
    "js/trends.js": "window.__tbReload",
    "js/fav.js": "window.__tbReload",
  };
  Object.keys(hooks).forEach((f) => {
    ok(read(f).indexOf(hooks[f]) >= 0, f + " 登记了重新取数钩子");
  });

  /* B3. 榜单页重取前必须清掉自己的条目缓存（只调 load() 会命中旧缓存） */
  const rankSrc = read("js/rank.js");
  const m = rankSrc.match(/window\.__tbReload = function \(\) \{[\s\S]{0,600}?\n  \};/);
  ok(!!m, "rank.js 的 __tbReload 是函数实现");
  const body = m ? m[0] : "";
  ok(/CACHE\s*=\s*null/.test(body) && /CACHE_MAP\s*=\s*\{\}/.test(body), "rank.js 重取前清空了 CACHE 与 CACHE_MAP");
  ok(/load\(\)/.test(body), "rank.js 重取时会真的重新取数");
  ok(/CACHE_MAP\s*=\s*\{\}/.test(read("js/rhythm.js")), "rhythm.js 重取前同样清空缓存");

  /* B4. 后台各个删除入口都要广播 */
  const bumps = {
    "js/admin-channelzone.js": "DataSync.bump",
    "js/admin-images.js": "DataSync.bump",
    "js/admin-smart.js": "DataSync.bump",
    "js/admin-movement.js": "DataSync.bump",
    "js/admin-rank.js": "DataSync.bump",
    "js/admin-rhythm.js": "DataSync.bump",
    "js/admin-titlelab.js": "DataSync.bump",
  };
  Object.keys(bumps).forEach((f) => {
    ok(read(f).indexOf(bumps[f]) >= 0, f + " 删除后会广播变更");
  });
  const czSrc = read("js/admin-channelzone.js");
  ok((czSrc.match(/DataSync\.bump/g) || []).length >= 2, "渠道专区单张删除与批量删除都会广播");
  ok(/removeChild\(card\)/.test(czSrc), "渠道专区删除成功后先把卡片从图墙摘掉，不等取数回来");
  ok(/dropMgrCells\(\[img\.id\]\)/.test(read("js/admin-images.js")), "视觉专区单张删除后立刻摘掉网格卡片");
  ok(/dropMgrCells\(targets\.map/.test(read("js/admin-images.js")), "视觉专区批量删除后立刻摘掉网格卡片");

  /* B5. 数据层真的能清缓存（清的是那个 30 秒文档缓存变量） */
  const sbSrc = read("js/supabase.js");
  const inv = sbSrc.match(/API\.invalidateCaches = function \(\) \{[\s\S]{0,400}?\};/);
  ok(!!inv, "数据层提供 invalidateCaches");
  ok(!!inv && /_chPic = null/.test(inv[0]) && /_chPicAt = 0/.test(inv[0]), "清缓存把渠道图文档缓存一起失效（否则删掉的图会被读回来）");
  ok(!!inv && /return true/.test(inv[0]), "invalidateCaches 正常返回");
}

console.log(`\nt_delete_sync: ${pass} 项通过, ${fail} 项失败`);
if (fail) process.exit(1);
