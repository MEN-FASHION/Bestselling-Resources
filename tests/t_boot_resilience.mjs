/* 20261111AB · 加载防卡死自检
 *
 * 用户报「网站打不开，一直转圈」。转圈 = 加载遮罩 (boot-splash) 没被揭开。
 * 根因往往不是网络，而是：**揭开遮罩的那行代码排在启动逻辑中间，
 * 前面任意一句抛错（例如某个标题元素被改名/删掉），定时器就再也注册不上**，
 * 于是页面永久停在遮罩上，且用户看不到任何错误。
 *
 * 这里验证三件事：
 *  1. 每个带遮罩的页面，都有一段「不依赖外部脚本」的内联兜底；
 *  2. 这段兜底真的能把遮罩关掉（用假 DOM 实际跑一遍）；
 *  3. 启动逻辑不再有「取到空元素就直接赋值」的裸写法（这种写法一碰就整页卡死）。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

const PAGES = ["index.html", "admin.html", "trends.html", "marketing.html"];
const splashed = PAGES.filter((f) => /id="boot-splash"/.test(read(f)));
ok(splashed.length >= 4, "带加载遮罩的页面应至少 4 个（index/admin/trends/marketing），实际 " + splashed.length);

/* ---------- 一、每页都要有内联兜底 ---------- */
splashed.forEach((f) => {
  const s = read(f);
  ok(/加载兜底（内联）/.test(s), f + " 缺少内联加载兜底（外部脚本挂了就永远转圈）");
  /* 兜底必须自己 set 一个隐藏动作，不能只靠外部 js */
  const seg = s.slice(s.indexOf("加载兜底（内联）"), s.indexOf("加载兜底（内联）") + 1200);
  ok(/classList\.add\("hidden"\)/.test(seg), f + " 的兜底里没有真正关闭遮罩的动作");
  ok(/setTimeout\(/.test(seg), f + " 的兜底没有定时器（等于没兜）");
});

/* ---------- 二、兜底真的能关掉遮罩（实际执行） ---------- */
function runInlineFallback(html) {
  const start = html.indexOf("加载兜底（内联）");
  const open = html.indexOf("<script>", start);
  const close = html.indexOf("</script>", open);
  const code = html.slice(open + "<script>".length, close);
  const timers = [];
  const el = {
    _cls: new Set(["boot-splash"]),
    classList: {
      add(c) { el._cls.add(c); },
      contains(c) { return el._cls.has(c); },
    },
    querySelector() { return { textContent: "TREND BANK" }; },
  };
  const doc = {
    getElementById(id) { return id === "boot-splash" ? el : null; },
  };
  const win = {
    document: doc,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    addEventListener() {},
    console,
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(code, win, { filename: "inline-fallback.js" });
  /* 只推进到最长那个定时器，模拟页面长时间加载 */
  const maxMs = Math.max.apply(null, timers.map((t) => t.ms || 0));
  timers.forEach((t) => { if ((t.ms || 0) <= maxMs) t.fn(); });
  return { hidden: el._cls.has("hidden"), timers: timers.map((t) => t.ms) };
}

splashed.forEach((f) => {
  const r = runInlineFallback(read(f));
  ok(r.hidden === true, f + " 的兜底跑完仍未关闭遮罩（等于还是转圈）");
  ok(r.timers.some((ms) => ms >= 3000 && ms <= 15000), f + " 的兜底时限不合理，实际 " + JSON.stringify(r.timers));
});

/* ---------- 三、启动逻辑不能有裸赋值 ---------- */
const FE = read("js/frontend.js");
const TR = read("js/trends.js");

/* 裸写法：「$("#x").textContent = ...」直接把取到的结果当对象用，取不到就 TypeError */
function hasRawAssign(src, sel) {
  const re = new RegExp('\\$\\("' + sel.replace(/[.#]/g, "\\$&") + '"\\)\\.textContent');
  return re.test(src);
}
ok(!hasRawAssign(FE, "#site-title"), "frontend.js 仍有裸赋值 $(#site-title).textContent（元素缺失会卡死整页启动）");
ok(!hasRawAssign(FE, "#top-title"), "frontend.js 仍有裸赋值 $(#top-title).textContent");
ok(/function setText\(sel, val\)/.test(FE), "frontend.js 缺少安全的 setText 赋值helper");
ok(!hasRawAssign(TR, "#site-title"), "trends.js 仍有裸赋值 $(#site-title).textContent");

/* ---------- 四、遮罩必须在启动回调之外也能被关 ---------- */
const feBoot = FE.slice(0, FE.indexOf('document.addEventListener("DOMContentLoaded"'));
ok(/setTimeout\(hide, 3000\)/.test(feBoot), "frontend.js 的遮罩兜底应注册在启动回调之外（回调抛错也能生效）");
const trBoot = TR.slice(0, TR.indexOf('document.addEventListener("DOMContentLoaded"'));
ok(/setTimeout\(hide, 3000\)/.test(trBoot), "trends.js 的遮罩兜底应注册在启动回调之外");

/* ---------- 五、首页启动依赖的元素确实存在 ---------- */
const idx = read("index.html");
["site-title", "top-title", "login-view", "boot-splash"].forEach((id) => {
  ok(new RegExp('id="' + id + '"').test(idx), "index.html 缺少元素 #" + id + "（启动逻辑会取不到）");
});
ok(/class="subtitle"/.test(idx), "index.html 缺少 .subtitle");

/* ---------- 六、页面引用的脚本文件必须真实存在 ---------- */
const allPages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
allPages.forEach((f) => {
  const s = read(f);
  const srcs = [...s.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  srcs.forEach((u) => {
    if (!u || /^https?:/i.test(u)) return;          /* 外链不查 */
    const rel = u.split("?")[0];
    ok(fs.existsSync(path.join(ROOT, rel)), f + " 引用了不存在的脚本：" + rel);
  });
});

/* ---------- 七、自检页必须零依赖 ---------- */
const ST = read("selftest.html");
ok(/id="v-verdict"/.test(ST), "自检页缺少判定结果区");
ok(!/<script[^>]+src=/.test(ST), "自检页不能引用外部脚本（脚本坏了自检也会跟着挂）");
ok(!/<link[^>]+href="css\//.test(ST), "自检页不能依赖外部样式表");
["index.html", "css/style.css", "js/config.js", "js/supabase.js", "js/frontend.js", "admin.html"]
  .forEach((f) => ok(ST.indexOf(f) >= 0, "自检页没有检查 " + f));

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
