/* 20261114K · 前台「数据统计」按钮 + 弹窗 · 实跑自检
 *
 * 本版改动（用户要求）：
 *   1) 统计不再常驻页面顶部 —— 顶部只留一个「数据统计」按钮，点开才出弹窗；
 *   2) 面板内容不变：谁、几号、在哪些类目、各传了多少张；
 *   3) 所有管理员都能看到全部人的上传量；
 *   4) 卡片上的「0/13」打标计数不再展示（前台与后台专区图墙）。
 *
 * 本自检不复制业务逻辑：直接把 js/upload-dash.js 真跑起来（假 window / 假 DOM / 假数据库），
 * 断言「按钮才挂载、点开才查询、弹窗里口径正确」，并用反向用例证明用例抓得住缺陷。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const dashSrc = read("js/upload-dash.js");
const css = read("css/style.css");
const chSrc = read("js/channel-zone-front.js");
const mvSrc = read("js/movement-front.js");
const achSrc = read("js/admin-channelzone.js");
const amvSrc = read("js/admin-movement.js");
const admSrc = read("admin.html");

/* ---------- 1 结构：七个有图的专区都挂了「数据统计」入口 ---------- */
const PAGES = {
  "rank.html": "rank",
  "rhythm.html": "rhythm",
  "compare.html": "compare",
  "shein.html": "shein",
  "pinterest.html": "pinterest",
  "movement.html": "movement",
  "index.html": "visual",
};
Object.keys(PAGES).forEach((f) => {
  const s = read(f);
  ok(s.indexOf('data-updash="' + PAGES[f] + '"') > 0, f + " 有统计入口容器");
  ok(s.indexOf("js/upload-dash.js") > 0, f + " 引入数据统计脚本");
  ok(/UploadDash\s*&&\s*window\.UploadDash\.mount\("[\w-]+"\)/.test(s), f + " 调用 mount");
  /* 按钮留在主区域顶部，位置不变（只是内容从整块看板变成一行按钮） */
  const m = s.indexOf('<main class="grid-wrap">');
  const d = s.indexOf('data-updash="');
  ok(m > 0 && d > m, f + " 入口位于主区域顶部");
});

/* ---------- 2 模块结构：常驻区块已改成按钮 + 弹窗 ---------- */
ok(dashSrc.indexOf("updash-head") < 0, "不再输出常驻看板头部");
ok(dashSrc.indexOf("updash-toggle") < 0, "不再输出常驻折叠按钮");
ok(/updash-btn/.test(dashSrc) && /data-open/.test(dashSrc), "顶部是一个「数据统计」按钮");
ok(/updash-modal/.test(dashSrc) && /is-open/.test(dashSrc), "内容放进弹窗，点开才显示");
ok(/Escape|keyCode === 27/.test(dashSrc), "支持 Esc 关闭");
ok(/document\.body/.test(dashSrc), "弹窗挂在 body 上（不挤占页面流）");
/* 首屏不查询：点开按钮之前不该发起统计请求 */
ok(/function openPanel/.test(dashSrc) && /await build\(/.test(dashSrc), "只有打开面板才取数");
ok(/var cache = \{\}/.test(dashSrc) && /delete cache\[modalKey\]/.test(dashSrc),
  "同一专区一次会话只统计一次，可手动重算");

/* CSS：常驻块样式换成按钮 / 遮罩 / 卡片 */
ok(css.indexOf(".updash-btn") > 0, "按钮样式存在");
ok(css.indexOf(".updash-modal") > 0 && /\.updash-modal\.is-open\s*\{[^}]*display:\s*flex/.test(css),
  "弹窗默认 display:none，is-open 才显示");
ok(css.indexOf(".updash {") < 0, "旧的常驻整块样式已移除");

/* ---------- 3 卡片上的「0/13」不再展示 ---------- */
ok(achSrc.indexOf("class=\"mv-prog") < 0, "后台 SHEIN / Pinterest 图墙卡片不再输出打标计数");
ok(amvSrc.indexOf("class=\"mv-prog") < 0, "后台品牌动向卡片不再输出打标计数");
ok(chSrc.indexOf("mv-prog") < 0, "前台渠道专区卡片没有打标计数");
ok(mvSrc.indexOf("mv-prog") < 0, "前台动向卡片没有打标计数");
/* 反向保护：删的只是卡片上的数字，工具条的整体进度必须还在 */
ok(chSrc.indexOf("已打标 <b>") > 0, "前台仍保留工具条「共 N 张 · 已打标 M 张」");
ok(achSrc.indexOf("已打标") > 0 || achSrc.indexOf("已打标") >= 0, "后台工具条进度保留");
ok(achSrc.indexOf("cz-up") > 0, "后台卡片的上传时间行保留（删的只是数字徽标）");

/* ---------- 4 真跑模块：假 DOM + 假数据 ---------- */
function mkNode() {
  const node = {
    innerHTML: "",
    className: "",
    textContent: "",
    onclick: null,
    name: "",
    _children: {},
    _removed: false,
    _attrs: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelector(sel) {
      if (!this._children[sel]) this._children[sel] = mkNode();
      return this._children[sel];
    },
    remove() { this._removed = true; },
    appendChild() {},
  };
  return node;
}

function makeEnv(opts) {
  const o = opts || {};
  const box = mkNode();
  const modal = mkNode();
  const doc = {
    body: { appendChild() {} },
    createElement() { return modal; },
    querySelector(sel) {
      if (sel.indexOf("data-updash") >= 0) return o.noBox ? null : box;
      return null;
    },
    addEventListener() {},
  };
  const batches = o.batches || [];
  const client = {
    from(table) {
      const rows = table === "rank_batches" ? batches : [];
      return {
        select: () => ({
          order: () => ({
            range: (a, b) => Promise.resolve({ data: rows.slice(a, b + 1), error: null }),
          }),
          limit: (n) => Promise.resolve({ data: (o.profiles || []).slice(0, n || 500), error: null }),
        }),
        limit: (n) => Promise.resolve({ data: o.profiles || [], error: null }),
      };
    },
  };
  const SB = {
    client,
    myRole: async () => (o.role === undefined ? "admin" : o.role),
    listRankChannelPics: async () => o.pics || [],
    listMovementItems: async () => o.movement || [],
    listAllImagesPaged: async () => o.images || [],
  };
  const win = {
    SB,
    UO: {
      ensure: async () => true,
      _state: () => ({ doc: o.ownerDoc || { b: {}, i: {} } }),
    },
  };
  const sandbox = {
    window: win,
    document: doc,
    console,
    Date,
    Promise,
    setTimeout,
    isNaN,
    String,
    Number,
    Object,
    Array,
    JSON,
  };
  sandbox.globalThis = sandbox;
  return { box, modal, sandbox };
}

function run(src, env) {
  vm.createContext(env.sandbox);
  vm.runInContext(src, env.sandbox);
  return env.sandbox.window.UploadDash;
}

/* 模拟「进页面 → 点按钮 → 等弹窗填好」 */
async function mountWith(opts, key) {
  const env = makeEnv(opts);
  const Dash = run(dashSrc, env);
  await Dash.mount(key);
  const btn = env.box.querySelector("[data-open]");
  if (btn && btn.onclick) btn.onclick();
  /* openPanel 里 refresh 是异步的，等微任务跑完 */
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return {
    box: env.box,
    modal: env.modal,
    body: env.modal.querySelector("[data-body]"),
    roles: env.modal.querySelector("[data-roles]"),
    title: env.modal.querySelector("[data-title]"),
    Dash,
    env,
  };
}

/* --- 4.1 挂载后只有按钮，没有查询 --- */
{
  const env = makeEnv({ batches: [{ id: 1, source: "rank", category: "卫衣", rows: 5 }] });
  let queried = 0;
  const orig = env.sandbox.window.SB.client.from;
  env.sandbox.window.SB.client.from = function (t) { queried++; return orig(t); };
  const D = run(dashSrc, env);
  await D.mount("rank");
  ok(/数据统计/.test(env.box.innerHTML), "顶部渲染出「数据统计」按钮");
  ok(/updash-btn/.test(env.box.className + env.box.innerHTML), "按钮带自己的样式类");
  ok(queried === 0, "首屏不查库（点开才查），实际查询次数：" + queried);
  ok(env.modal.classList.contains("is-open") === false, "默认不展开弹窗");
}

/* --- 4.2 趋势上升榜：按「日期 → 管理员 → 类目」汇总 --- */
{
  const ownerDoc = {
    b: {
      "1": [{ u: "u1", n: "张三", t: "2026-11-10T02:00:00.000Z" }],
      "2": [{ u: "u2", n: "李四", t: "2026-11-11T03:00:00.000Z" }],
    },
    i: {},
  };
  const batches = [
    { id: 1, source: "rank", category: "卫衣", period_label: "第45周", rows: 120 },
    { id: 2, source: "rank", category: "衬衫", period_label: "第45周", rows: 30 },
    { id: 3, source: "rank", category: "长裤", period_label: "第44周", rows: 7 },
  ];
  const r = await mountWith({ ownerDoc, batches }, "rank");
  const html = r.body.innerHTML;
  ok(/数据统计 · 趋势上升榜/.test(r.title.textContent), "弹窗标题带专区名");
  ok(html.indexOf("张三") > 0 && html.indexOf("李四") > 0, "两位管理员都出现在面板里");
  ok(html.indexOf("卫衣") > 0 && html.indexOf("衬衫") > 0, "类目明细出现");
  ok(html.indexOf("120") > 0 && html.indexOf("30") > 0, "张数出现");
  ok(html.indexOf("2026-11-10") > 0, "日期出现（按登记的本地日期）");
  ok(/历史数据/.test(html), "没有归属的那批单列「历史数据」");
  ok(/共 157 张/.test(r.roles.textContent), "总张数 120+30+7=157：" + r.roles.textContent.trim());
  ok(/2 位管理员/.test(r.roles.textContent), "管理员数只算有归属的两个人");
}

/* --- 4.3 同一批被两人追加：只记最早那位 --- */
{
  const ownerDoc = {
    b: {
      "9": [
        { u: "u2", n: "李四", t: "2026-11-12T03:00:00.000Z" },
        { u: "u1", n: "张三", t: "2026-11-09T03:00:00.000Z" },
      ],
    },
    i: {},
  };
  const batches = [{ id: 9, source: "rank", category: "套装", period_label: "第45周", rows: 50 }];
  const r = await mountWith({ ownerDoc, batches }, "rank");
  const html = r.body.innerHTML;
  ok(html.indexOf("张三") > 0, "归属取最早登记的人（张三）");
  ok(html.indexOf("李四") < 0, "后追加的人不重复记账（李四不出现）");
  ok(/共 50 张/.test(r.roles.textContent), "总数不会翻倍：" + r.roles.textContent.trim());

  /* 反向验证：把口径改成「取最后一位」，上面两条必须失败 */
  const wrong = dashSrc.replace(
    /if \(!bestT \|\| \(t && t < bestT\)\) \{ best = o; bestT = t; \}/,
    "if (!best || (t && t > bestT)) { best = o; bestT = t; }"
  );
  ok(wrong !== dashSrc, "能构造「取最后一位」的反向版本");
  const env2 = makeEnv({ ownerDoc, batches });
  const D2 = run(wrong, env2);
  await D2.mount("rank");
  env2.box.querySelector("[data-open]").onclick();
  await new Promise((res) => setTimeout(res, 0));
  const h2 = env2.modal.querySelector("[data-body]").innerHTML;
  ok(h2.indexOf("李四") > 0 && h2.indexOf("张三") < 0, "反向版本确实记到了李四 —— 说明用例抓得住口径");
}

/* --- 4.4 数据域隔离：上新节奏不把趋势上升榜的批次算进来 --- */
{
  const batches = [
    { id: 1, source: "rank", category: "卫衣", period_label: "第45周", rows: 100 },
    { id: 2, source: "rhythm", category: "套装", period_label: "2026-01", rows: 20 },
  ];
  const r = await mountWith({ batches }, "rhythm");
  const html = r.body.innerHTML;
  ok(html.indexOf("套装") > 0, "上新节奏统计到自己域的批次");
  ok(html.indexOf("卫衣") < 0, "上新节奏不会把趋势上升榜的批次算进来");
}

/* --- 4.5 SHEIN / Pinterest：按 channel 分开统计 --- */
{
  const pics = [
    { image_url: "u1", category: "套装", channel: "SHEIN", month: "2026-01" },
    { image_url: "u2", category: "套装", channel: "SHEIN", month: "2026-01" },
    { image_url: "u3", category: "连衣裙", channel: "Pinterest", month: "2026-01" },
  ];
  const ownerDoc = { b: {}, i: { u1: [{ u: "u1", n: "张三", t: "2026-11-12T01:00:00.000Z" }] } };
  const a = await mountWith({ pics, ownerDoc }, "shein");
  ok(/共 2 张/.test(a.roles.textContent), "SHEIN 专区只数 SHEIN 的图：" + a.roles.textContent.trim());
  ok(a.body.innerHTML.indexOf("连衣裙") < 0, "SHEIN 专区不混入 Pinterest 的类目");
  const b = await mountWith({ pics, ownerDoc }, "pinterest");
  ok(/共 1 张/.test(b.roles.textContent), "Pinterest 专区只数自己的图：" + b.roles.textContent.trim());
}

/* --- 4.6 品牌动向 / 视觉专区：没登记归属也能统计 --- */
{
  const movement = [{ image_url: "m1", category: "外套", created_at: "2026-11-08T02:00:00.000Z" }];
  const r1 = await mountWith({ movement }, "movement");
  ok(/共 1 张/.test(r1.roles.textContent), "品牌动向按图片条数统计");
  ok(r1.body.innerHTML.indexOf("2026-11-08") > 0, "没有归属时用图片创建日期当日期");

  const images = [{ url: "i1", category: "套装", uploaded_by: "u9", created_at: "2026-11-07T02:00:00.000Z" }];
  const r2 = await mountWith({ images, profiles: [{ user_id: "u9", email: "wangwu@x.com" }] }, "visual");
  ok(/共 1 张/.test(r2.roles.textContent), "视觉专区按 images 表统计");
  ok(r2.body.innerHTML.indexOf("wangwu") > 0, "有邮箱时显示邮箱前缀，不显示一长串 uid");
}

/* --- 4.7 访客不渲染（连按钮都不出现） --- */
{
  const env = makeEnv({ role: "visitor", batches: [] });
  const D = run(dashSrc, env);
  await D.mount("rank");
  ok(env.box._removed === true, "访客/非管理员：连入口一起移除");
}

/* --- 4.8 读取失败要有提示，不能假装成 0 --- */
{
  const env = makeEnv({ ownerDoc: { b: {}, i: {} }, batches: [] });
  env.sandbox.window.SB.client.from = () => ({
    select: () => ({
      order: () => ({ range: () => { throw new Error("boom"); } }),
    }),
  });
  const D = run(dashSrc, env);
  let threw = false;
  try {
    await D.mount("rank");
    env.box.querySelector("[data-open]").onclick();
    await new Promise((r) => setTimeout(r, 0));
  } catch (e) { threw = true; }
  ok(!threw, "读取失败不会把整页搞挂");
  const body = env.modal.querySelector("[data-body]").innerHTML;
  const sub = env.modal.querySelector("[data-roles]").textContent;
  ok(/读取失败|读取不到/.test(sub + body), "读取失败会在面板里写出来，而不是静默显示 0");
}

/* --- 4.9 渲染内容里不能有未转义的尖括号（防注入） --- */
{
  const ownerDoc = { b: { "5": [{ u: "u1", n: "<img src=x onerror=alert(1)>", t: "2026-11-10T02:00:00.000Z" }] }, i: {} };
  const batches = [{ id: 5, source: "rank", category: "<b>卫衣</b>", period_label: "第45周", rows: 3 }];
  const r = await mountWith({ ownerDoc, batches }, "rank");
  const html = r.body.innerHTML;
  ok(html.indexOf("<img src=x") < 0, "管理员名里的 HTML 被转义");
  ok(html.indexOf("<b>卫衣</b>") < 0, "类目名里的 HTML 被转义");
  ok(html.indexOf("&lt;b&gt;卫衣") > 0, "类目名按纯文本展示");
}

/* --- 4.10 关闭后不再展开；再次打开走缓存不重复取数 --- */
{
  const batches = [{ id: 1, source: "rank", category: "卫衣", rows: 9 }];
  const r = await mountWith({ batches }, "rank");
  r.Dash.close();
  ok(r.modal.classList.contains("is-open") === false, "close() 收起弹窗");
  let q = 0;
  const origFrom = r.env.sandbox.window.SB.client.from;
  r.env.sandbox.window.SB.client.from = function (t) { q++; return origFrom(t); };
  r.Dash.open("rank");
  await new Promise((res) => setTimeout(res, 0));
  ok(q === 0, "同一专区第二次打开直接用缓存，不重复查库（实际 " + q + " 次）");
}

console.log(`\n数据统计面板自检：通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
