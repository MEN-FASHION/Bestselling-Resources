/* 20261114F · 前台「上传看板」+ 去掉卡片上的打标计数 · 实跑自检
 *
 * 用户要求：
 *   1) 各个有图的专区不要再显示「0/13」这种打标进度；
 *   2) 每个传图的专区顶部加一块看板：哪些管理员、几号、在哪些类目、各传了多少张；
 *      所有管理员都可见。
 *
 * 本自检不复制业务逻辑：直接把 js/upload-dash.js 里的模块真跑起来（假 window / 假 DOM /
 * 假数据库），断言分组口径、归属取「最早登记人」、访客不渲染、读取失败有提示；
 * 再用反向用例证明「取最后一位归属人」会被抓住。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const dashSrc = read("js/upload-dash.js");
const chSrc = read("js/channel-zone-front.js");
const mvSrc = read("js/movement-front.js");

/* ---------- 1 结构：七个有图的专区都挂了看板 ---------- */
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
  ok(s.indexOf('data-updash="' + PAGES[f] + '"') > 0, f + " 有看板容器");
  ok(s.indexOf("js/upload-dash.js") > 0, f + " 引入上传看板脚本");
  ok(/UploadDash\s*&&\s*window\.UploadDash\.mount\("[\w-]+"\)/.test(s), f + " 调用 mount");
  /* 放在主区域最顶部：容器必须出现在 <main class="grid-wrap"> 之后的第一段 */
  const m = s.indexOf('<main class="grid-wrap">');
  const d = s.indexOf('data-updash="');
  ok(m > 0 && d > m, f + " 看板位于主区域顶部");
});

/* ---------- 2 卡片上的「0/13」已移除 ---------- */
ok(chSrc.indexOf("mv-card-done") < 0, "SHEIN / Pinterest 卡片不再输出打标计数");
ok(mvSrc.indexOf("mv-card-done") < 0, "品牌动向卡片不再输出打标计数");
ok(chSrc.indexOf("ALL_DIMS.length") < 0 || chSrc.indexOf('done + "/"') < 0, "渠道专区卡片没有 n/总数 拼接");
ok(mvSrc.indexOf('done + "/"') < 0, "动向卡片没有 n/总数 拼接");
/* 反向：如果还有人把 done/总数 塞进卡片，上面会失败；这里补一条正向确认
   —— 顶部计数条（共 N 张 · 已打标 M 张）保留，说明只是把卡片上的删掉了，不是把功能删了 */
ok(chSrc.indexOf("已打标 <b>") > 0, "渠道专区顶部仍保留整体打标进度");
/* 采集器（导出 / 分屏搜图）依赖 .mv-card 结构，删掉的只是 meta 里的一个 span */
ok(chSrc.indexOf("mv-card-meta") > 0 && mvSrc.indexOf("mv-card-meta") > 0, "卡片结构（类目行）保持");

/* ---------- 3 真跑模块：假 DOM + 假数据 ---------- */
function mkNode() {
  const node = {
    innerHTML: "",
    className: "",
    textContent: "",
    onclick: null,
    _children: {},
    _removed: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c) { if (this._s.has(c)) { this._s.delete(c); return false; } this._s.add(c); return true; },
    },
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
  const doc = {
    querySelector(sel) {
      if (sel.indexOf("data-updash") >= 0) return o.noBox ? null : box;
      return null;
    },
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
        }),
        limit: () => Promise.resolve({ data: [], error: null }),
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
  return { box, sandbox };
}

function run(src, env) {
  vm.createContext(env.sandbox);
  vm.runInContext(src, env.sandbox);
  return env.sandbox.window.UploadDash;
}

async function mountWith(opts, key) {
  const env = makeEnv(opts);
  const Dash = run(dashSrc, env);
  await Dash.mount(key);
  const body = env.box.querySelector("[data-body]");
  const roles = env.box.querySelector("[data-roles]");
  return { box: env.box, body, roles, Dash };
}

/* --- 3.1 趋势上升榜：按「日期 → 管理员 → 类目」汇总 --- */
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
  ok(/上传看板/.test(r.box.innerHTML), "看板标题渲染出来");
  ok(html.indexOf("张三") > 0 && html.indexOf("李四") > 0, "两位管理员都出现在看板里");
  ok(html.indexOf("卫衣") > 0 && html.indexOf("衬衫") > 0, "类目明细出现");
  ok(html.indexOf("120") > 0 && html.indexOf("30") > 0, "张数出现");
  ok(html.indexOf("2026-11-10") > 0, "日期出现（按登记的本地日期）");
  ok(/历史数据/.test(html), "没有归属的那批单列「历史数据」");
  ok(/共 157 张/.test(r.roles.textContent), "总张数 120+30+7=157：" + r.roles.textContent.trim());
  ok(/2 位管理员/.test(r.roles.textContent), "管理员数只算有归属的两个人");
}

/* --- 3.2 同一批被两人追加：只记最早那位，不能算两遍 --- */
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
  const h2 = env2.box.querySelector("[data-body]").innerHTML;
  ok(h2.indexOf("李四") > 0 && h2.indexOf("张三") < 0, "反向版本确实记到了李四 —— 说明用例抓得住口径");
}

/* --- 3.3 数据域隔离：上新节奏不把趋势上升榜的批次算进来 --- */
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

/* --- 3.4 SHEIN / Pinterest：按 channel 分开统计 --- */
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

/* --- 3.5 品牌动向 / 视觉专区：没登记归属也能统计（按 uploaded_by / created_at） --- */
{
  const movement = [{ image_url: "m1", category: "外套", created_at: "2026-11-08T02:00:00.000Z" }];
  const r1 = await mountWith({ movement }, "movement");
  ok(/共 1 张/.test(r1.roles.textContent), "品牌动向按图片条数统计");
  ok(r1.body.innerHTML.indexOf("2026-11-08") > 0, "没有归属时用图片创建日期当日期");

  const images = [
    { url: "i1", category: "套装", uploaded_by: "u9", created_at: "2026-11-07T02:00:00.000Z" },
  ];
  const r2 = await mountWith({ images }, "visual");
  ok(/共 1 张/.test(r2.roles.textContent), "视觉专区按 images 表统计");
  ok(r2.body.innerHTML.indexOf("管理员") > 0, "只有 uid 时显示「管理员」而不是空白");
}

/* --- 3.6 访客不渲染 --- */
{
  const env = makeEnv({ role: "visitor", batches: [] });
  const D = run(dashSrc, env);
  await D.mount("rank");
  ok(env.box._removed === true, "访客/非管理员：看板直接移除");
}

/* --- 3.7 读取失败要有提示，不能假装成 0 --- */
{
  const ownerDoc = { b: {}, i: {} };
  const env = makeEnv({ ownerDoc, batches: [] });
  /* 让批次查询直接抛错 */
  env.sandbox.window.SB.client.from = () => ({
    select: () => ({
      order: () => ({ range: () => { throw new Error("boom"); } }),
    }),
  });
  const D = run(dashSrc, env);
  let threw = false;
  try { await D.mount("rank"); } catch (e) { threw = true; }
  ok(!threw, "读取失败不会把整页搞挂");
  const html = env.box.querySelector("[data-body]").innerHTML;
  ok(/读取失败|读取不到/.test(env.box.querySelector("[data-roles]").textContent + html),
    "读取失败会在看板里写出来，而不是静默显示 0");
}

/* --- 3.8 渲染内容里不能有未转义的尖括号（防注入） --- */
{
  const ownerDoc = { b: { "5": [{ u: "u1", n: "<img src=x onerror=alert(1)>", t: "2026-11-10T02:00:00.000Z" }] }, i: {} };
  const batches = [{ id: 5, source: "rank", category: "<b>卫衣</b>", period_label: "第45周", rows: 3 }];
  const r = await mountWith({ ownerDoc, batches }, "rank");
  const html = r.body.innerHTML;
  ok(html.indexOf("<img src=x") < 0, "管理员名里的 HTML 被转义");
  ok(html.indexOf("<b>卫衣</b>") < 0, "类目名里的 HTML 被转义");
  ok(html.indexOf("&lt;b&gt;卫衣") > 0, "类目名按纯文本展示");
}

console.log(`\n上传看板自检：通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
