/* 20261114L · 后台「数据统计」面板 · 实跑自检
 *
 * 本版改动（用户要求）：
 *   1) 统计从「前台各专区顶部按钮」搬到「后台」——前台不再有任何统计入口；
 *   2) 后台新增独立面板「数据统计」，面板内每个专区一个页签，各自独立统计，互不混算；
 *   3) 面板内容不变：谁、几号、在哪些类目、各传了多少张；
 *   4) 所有管理员都能看到全员上传量。
 *
 * 本自检不复制业务逻辑：直接把 js/upload-dash.js 真跑起来（假 window / 假 DOM / 假数据库），
 * 断言「前台无入口、后台有面板、页签切换各自取数、口径正确」，并用反向用例证明用例抓得住缺陷。
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
const admSrc = read("admin.html");
const adminJs = read("js/admin.js");
const chSrc = read("js/channel-zone-front.js");
const mvSrc = read("js/movement-front.js");
const achSrc = read("js/admin-channelzone.js");
const amvSrc = read("js/admin-movement.js");

/* ---------- 1 前台：统计入口已彻底移除 ---------- */
const FRONT = [
  "index.html", "rank.html", "rhythm.html", "compare.html",
  "shein.html", "pinterest.html", "movement.html", "trends.html", "fav.html", "marketing.html"
];
FRONT.forEach((f) => {
  const s = read(f);
  ok(s.indexOf("data-updash") < 0, f + " 不再有统计入口容器");
  ok(s.indexOf("js/upload-dash.js") < 0, f + " 不再引入统计脚本");
  ok(s.indexOf("UploadDash") < 0, f + " 不再调用统计接口");
});

/* ---------- 2 后台：菜单 + 面板 + 脚本 ---------- */
ok(admSrc.indexOf('data-target="uploaddash-card"') > 0, "后台侧栏有「数据统计」菜单");
ok(admSrc.indexOf('id="uploaddash-card"') > 0, "后台有独立面板");
ok(admSrc.indexOf('id="updash-tabs"') > 0, "面板里有专区页签容器");
ok(admSrc.indexOf('id="updash-body"') > 0, "面板里有明细容器");
ok(/js\/upload-dash\.js\?v=\d{8}[A-Z]/.test(admSrc), "后台引入统计脚本（带版本号）");
ok(/data-target="uploaddash-card"[\s\S]{0,80}数据统计/.test(admSrc), "菜单名就叫「数据统计」");
ok(adminJs.indexOf('"uploaddash-card"') > 0, "admin.js 认识这个面板（授权判断/进入钩子）");
ok(/UploadDash\s*&&\s*typeof\s*window\.UploadDash\.enter/.test(adminJs), "进入面板时才挂载统计");

/* ---------- 3 模块形态：面板版，不再有弹窗 ---------- */
ok(dashSrc.indexOf("updash-modal") < 0, "不再有弹窗遮罩");
ok(dashSrc.indexOf("updash-slot") < 0, "不再输出前台挂载槽位");
ok(/window\.UploadDash\s*=\s*\{[\s\S]*enter:\s*enter/.test(dashSrc), "对外暴露 enter()");
ok(/function selectZone/.test(dashSrc), "有页签切换入口 selectZone()");
ok(dashSrc.indexOf("#updash-tabs") > 0, "页签渲染到 #updash-tabs");
ok(dashSrc.indexOf("#updash-body") > 0, "明细渲染到 #updash-body");
ok(/var cache = \{\}/.test(dashSrc) && /delete cache\[active\]/.test(dashSrc),
  "每个专区各自缓存，可手动重算");

/* CSS：页签样式在、弹窗样式已清掉 */
ok(css.indexOf(".updash-tab") > 0 && css.indexOf(".updash-tab.is-active") > 0, "页签样式存在（含选中态）");
ok(css.indexOf(".updash-modal") < 0, "弹窗样式已移除");
ok(css.indexOf(".updash-btn") < 0, "前台按钮样式已移除");

/* ---------- 4 卡片上的「0/13」仍然不展示（上一版成果不回退） ---------- */
ok(achSrc.indexOf('class="mv-prog') < 0, "后台 SHEIN / Pinterest 图墙卡片不再输出打标计数");
ok(amvSrc.indexOf('class="mv-prog') < 0, "后台品牌动向卡片不再输出打标计数");
ok(chSrc.indexOf("mv-prog") < 0, "前台渠道专区卡片没有打标计数");
ok(mvSrc.indexOf("mv-prog") < 0, "前台动向卡片没有打标计数");
ok(chSrc.indexOf("已打标 <b>") > 0, "前台仍保留工具条「共 N 张 · 已打标 M 张」");

/* ---------- 5 真跑模块：假 DOM + 假数据 ---------- */
function mkNode(id) {
  const node = {
    id: id || "",
    innerHTML: "",
    className: "",
    textContent: "",
    onclick: null,
    _children: {},
    _attrs: {},
    _removed: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelector(sel) {
      if (!this._children[sel]) this._children[sel] = mkNode(sel);
      return this._children[sel];
    },
    querySelectorAll() { return []; },
    remove() { this._removed = true; },
    appendChild() {},
  };
  return node;
}

function makeEnv(opts) {
  const o = opts || {};
  const nodes = {
    "#updash-tabs": mkNode("tabs"),
    "#updash-sub": mkNode("sub"),
    "#updash-body": mkNode("body"),
    "#updash-refresh": mkNode("refresh"),
  };
  const doc = {
    body: {},
    createElement() { return mkNode(); },
    querySelector(sel) { return nodes[sel] || null; },
    addEventListener() {},
  };
  const batches = o.batches || [];
  const client = {
    from(table) {
      const rows = table === "rank_batches" ? batches : [];
      return {
        select: () => ({
          order: () => ({
            range: (a, b) => (o.failBatches
              ? { error: { message: "boom" } }
              : Promise.resolve({ data: rows.slice(a, b + 1), error: null })),
          }),
          limit: (n) => Promise.resolve({ data: (o.profiles || []).slice(0, n || 500), error: null }),
        }),
        limit: (n) => Promise.resolve({ data: o.profiles || [], error: null }),
      };
    },
  };
  const SB = {
    client,
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
    window: win, document: doc, console, Date, Promise, setTimeout,
    isNaN, String, Number, Object, Array, JSON,
  };
  sandbox.globalThis = sandbox;
  return { nodes, sandbox };
}

function run(src, env) {
  vm.createContext(env.sandbox);
  vm.runInContext(src, env.sandbox);
  return env.sandbox.window.UploadDash;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/* 进面板 → 等首次取数跑完 */
async function enterWith(opts, zone) {
  const env = makeEnv(opts);
  const D = run(dashSrc, env);
  await D.enter(zone);
  await tick(); await tick();
  return {
    D, env,
    tabs: env.nodes["#updash-tabs"],
    sub: env.nodes["#updash-sub"],
    body: env.nodes["#updash-body"],
  };
}

/* --- 5.1 进面板：渲染 7 个专区页签，默认载入第一个专区 --- */
{
  const env = makeEnv({ batches: [{ id: 1, source: "rank", category: "卫衣", rows: 5 }] });
  let queried = 0;
  const orig = env.sandbox.window.SB.client.from;
  env.sandbox.window.SB.client.from = function (t) {
    if (t === "rank_batches") queried++;
    return orig(t);
  };
  const D = run(dashSrc, env);
  ok(queried === 0, "没进面板不查库（实际 " + queried + " 次）");
  await D.enter();
  await tick(); await tick();
  const tabs = env.nodes["#updash-tabs"].innerHTML;
  ok(D.ORDER.length === 8, "一共 8 个专区页签");
  ["趋势上升榜", "上新节奏", "SHEIN 专区", "Pinterest 专区", "TikTok 专区", "渠道对比", "品牌动向", "视觉专区"]
    .forEach((n) => ok(tabs.indexOf(n) > 0, "页签包含「" + n + "」"));
  ok(/is-active/.test(tabs), "默认选中一个页签");
  ok(queried >= 1, "进面板后才查库（实际 " + queried + " 次）");
}

/* --- 5.2 趋势上升榜：按「日期 → 管理员 → 类目」汇总 --- */
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
  const r = await enterWith({ ownerDoc, batches }, "rank");
  const html = r.body.innerHTML;
  ok(/数据统计 · 趋势上升榜/.test(r.sub.textContent), "面板标题带专区名");
  ok(html.indexOf("张三") > 0 && html.indexOf("李四") > 0, "两位管理员都出现在面板里");
  ok(html.indexOf("卫衣") > 0 && html.indexOf("衬衫") > 0, "类目明细出现");
  ok(html.indexOf("120") > 0 && html.indexOf("30") > 0, "张数出现");
  ok(html.indexOf("2026-11-10") > 0, "日期出现（按登记的本地日期）");
  ok(/历史数据/.test(html), "没有归属的那批单列「历史数据」");
  ok(/共 157 张/.test(r.sub.textContent), "总张数 120+30+7=157：" + r.sub.textContent.trim());
  ok(/2 位管理员/.test(r.sub.textContent), "管理员数只算有归属的两个人");
}

/* --- 5.3 同一批被两人追加：只记最早那位 --- */
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
  const r = await enterWith({ ownerDoc, batches }, "rank");
  const html = r.body.innerHTML;
  ok(html.indexOf("张三") > 0, "归属取最早登记的人（张三）");
  ok(html.indexOf("李四") < 0, "后追加的人不重复记账（李四不出现）");
  ok(/共 50 张/.test(r.sub.textContent), "总数不会翻倍：" + r.sub.textContent.trim());

  /* 反向验证：把口径改成「取最后一位」，上面两条必须失败 */
  const wrong = dashSrc.replace(
    /if \(!bestT \|\| \(t && t < bestT\)\) \{ best = o; bestT = t; \}/,
    "if (!best || (t && t > bestT)) { best = o; bestT = t; }"
  );
  ok(wrong !== dashSrc, "能构造「取最后一位」的反向版本");
  const env2 = makeEnv({ ownerDoc, batches });
  const D2 = run(wrong, env2);
  await D2.enter("rank");
  await tick(); await tick();
  const h2 = env2.nodes["#updash-body"].innerHTML;
  ok(h2.indexOf("李四") > 0 && h2.indexOf("张三") < 0, "反向版本确实记到了李四 —— 说明用例抓得住口径");
}

/* --- 5.4 专区独立：上新节奏不把趋势上升榜的批次算进来 --- */
{
  const batches = [
    { id: 1, source: "rank", category: "卫衣", period_label: "第45周", rows: 100 },
    { id: 2, source: "rhythm", category: "套装", period_label: "2026-01", rows: 20 },
  ];
  const r = await enterWith({ batches }, "rhythm");
  const html = r.body.innerHTML;
  ok(html.indexOf("套装") > 0, "上新节奏统计到自己域的批次");
  ok(html.indexOf("卫衣") < 0, "上新节奏不会把趋势上升榜的批次算进来");
  ok(/共 20 张/.test(r.sub.textContent), "上新节奏总数只算自己：" + r.sub.textContent.trim());
}

/* --- 5.5 同一面板内切页签：两个专区互不串数据 --- */
{
  const batches = [
    { id: 1, source: "rank", category: "卫衣", rows: 100 },
    { id: 2, source: "rhythm", category: "套装", rows: 20 },
  ];
  const env = makeEnv({ batches });
  const D = run(dashSrc, env);
  await D.enter("rank");
  await tick(); await tick();
  ok(env.nodes["#updash-body"].innerHTML.indexOf("卫衣") > 0, "先看趋势上升榜：有卫衣");
  await D.selectZone("rhythm");
  await tick(); await tick();
  const h = env.nodes["#updash-body"].innerHTML;
  ok(h.indexOf("套装") > 0, "切到上新节奏：有套装");
  ok(h.indexOf("卫衣") < 0, "切到上新节奏：趋势上升榜的卫衣不再出现");
  ok(D._active() === "rhythm", "当前页签记录为 rhythm");
}

/* --- 5.6 SHEIN / Pinterest：按 channel 分开统计 --- */
{
  const pics = [
    { image_url: "u1", category: "套装", channel: "SHEIN", month: "2026-01" },
    { image_url: "u2", category: "套装", channel: "SHEIN", month: "2026-01" },
    { image_url: "u3", category: "连衣裙", channel: "Pinterest", month: "2026-01" },
  ];
  const ownerDoc = { b: {}, i: { u1: [{ u: "u1", n: "张三", t: "2026-11-12T01:00:00.000Z" }] } };
  const a = await enterWith({ pics, ownerDoc }, "shein");
  ok(/共 2 张/.test(a.sub.textContent), "SHEIN 专区只数 SHEIN 的图：" + a.sub.textContent.trim());
  ok(a.body.innerHTML.indexOf("连衣裙") < 0, "SHEIN 专区不混入 Pinterest 的类目");
  const b = await enterWith({ pics, ownerDoc }, "pinterest");
  ok(/共 1 张/.test(b.sub.textContent), "Pinterest 专区只数自己的图：" + b.sub.textContent.trim());
  const c = await enterWith({ pics, ownerDoc }, "compare");
  ok(/共 3 张/.test(c.sub.textContent), "渠道对比数全部渠道：" + c.sub.textContent.trim());
}

/* --- 5.7 品牌动向 / 视觉专区：没登记归属也能统计 --- */
{
  const movement = [{ image_url: "m1", category: "外套", created_at: "2026-11-08T02:00:00.000Z" }];
  const r1 = await enterWith({ movement }, "movement");
  ok(/共 1 张/.test(r1.sub.textContent), "品牌动向按图片条数统计");
  ok(r1.body.innerHTML.indexOf("2026-11-08") > 0, "没有归属时用图片创建日期当日期");

  const images = [{ url: "i1", category: "套装", uploaded_by: "u9", created_at: "2026-11-07T02:00:00.000Z" }];
  const r2 = await enterWith({ images, profiles: [{ user_id: "u9", email: "wangwu@x.com" }] }, "visual");
  ok(/共 1 张/.test(r2.sub.textContent), "视觉专区按 images 表统计");
  ok(r2.body.innerHTML.indexOf("wangwu") > 0, "有邮箱时显示邮箱前缀，不显示一长串 uid");
}

/* --- 5.8 读取失败要写出来，不能假装成 0 --- */
{
  const r = await enterWith({ failBatches: true, batches: [] }, "rank");
  ok(/读取失败/.test(r.sub.textContent), "读取失败写在副标题里");
  ok(/读取不到/.test(r.body.innerHTML), "读取失败写在面板正文里");
  ok(!/共 0 张/.test(r.sub.textContent), "不会静默显示 0 张");
}

/* --- 5.9 渲染内容里不能有未转义的尖括号（防注入） --- */
{
  const ownerDoc = { b: { "5": [{ u: "u1", n: "<img src=x onerror=alert(1)>", t: "2026-11-10T02:00:00.000Z" }] }, i: {} };
  const batches = [{ id: 5, source: "rank", category: "<b>卫衣</b>", rows: 3 }];
  const r = await enterWith({ ownerDoc, batches }, "rank");
  const html = r.body.innerHTML;
  ok(html.indexOf("<img src=x") < 0, "管理员名里的 HTML 被转义");
  ok(html.indexOf("<b>卫衣</b>") < 0, "类目名里的 HTML 被转义");
  ok(html.indexOf("&lt;b&gt;卫衣") > 0, "类目名按纯文本展示");
}

/* --- 5.10 再次进入面板走缓存；「重新统计」强制重查 --- */
{
  const batches = [{ id: 1, source: "rank", category: "卫衣", rows: 9 }];
  const env = makeEnv({ batches });
  const D = run(dashSrc, env);
  await D.enter("rank");
  await tick(); await tick();
  let q = 0;
  const origFrom = env.sandbox.window.SB.client.from;
  env.sandbox.window.SB.client.from = function (t) { if (t === "rank_batches") q++; return origFrom(t); };
  await D.enter("rank");
  await tick(); await tick();
  ok(q === 0, "再次进面板直接用缓存，不重复查库（实际 " + q + " 次）");
  const rf = env.nodes["#updash-refresh"];
  ok(typeof rf.onclick === "function", "「重新统计」按钮已绑定");
  rf.onclick();
  await tick(); await tick();
  ok(q >= 1, "点「重新统计」会真的重查（实际 " + q + " 次）");
}

console.log(`\n后台数据统计面板自检：通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
