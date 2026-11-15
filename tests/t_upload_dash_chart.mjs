/* 20261114N · 后台「数据统计」可视化图表与筛选 · 实跑自检
 *
 * 本版改动（用户要求）：
 *   1) 加可视化图表：谁、什么时候、哪个周次/哪个月、传了多少张；
 *   2) 可按账号 / 类目 / 期次 / 日期筛选，点柱子即筛选；
 *   3) 明细表补「期次」列。
 *
 * 自检方式：把 js/upload-dash.js 真跑起来（假 window / 假 DOM / 假数据库），
 * 断言周次推算、筛选、图表结构与聚合数字；并构造反向版本证明用例抓得住缺陷。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const src = read("js/upload-dash.js");
const css = read("css/style.css");
const admSrc = read("admin.html");

/* ---------- 1 结构：图表容器与样式都在 ---------- */
ok(src.indexOf("updash-kpis") > 0, "模块输出 KPI 卡片");
ok(src.indexOf("updash-hbars") > 0 && src.indexOf("updash-vbars") > 0, "模块输出条形图与柱状图");
ok(src.indexOf("<svg") > 0 && src.indexOf("updash-spark") > 0, "模块输出 SVG 折线图（不引外部库）");
ok(src.indexOf("updash-mx") > 0, "模块输出「账号 × 期次」热力图");
ok(src.indexOf("updash-filter") > 0, "模块输出筛选条");
ok(src.indexOf("http://") < 0 && src.indexOf("https://") < 0, "不引任何外链资源（离线可开）");
ok(src.indexOf("<script src") < 0, "不引外部脚本");
[
  ".updash-filter", ".updash-kpi", ".updash-card", ".updash-hb", ".updash-vb",
  ".updash-spark", ".updash-mx", ".updash-p"
].forEach((s) => ok(css.indexOf(s) > 0, "样式里有 " + s));
ok(admSrc.indexOf("可视化图表") > 0, "后台面板说明里写明了图表与筛选");

/* ---------- 2 假环境 ---------- */
function mkNode(id) {
  const node = {
    id: id || "", innerHTML: "", className: "", textContent: "", onclick: null,
    _children: {}, _attrs: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelector(sel) { if (!this._children[sel]) this._children[sel] = mkNode(sel); return this._children[sel]; },
    querySelectorAll() { return []; },
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
  const doc = { body: {}, createElement() { return mkNode(); }, querySelector(s) { return nodes[s] || null; }, addEventListener() {} };
  const batches = o.batches || [];
  const client = {
    from(table) {
      const rows = table === "rank_batches" ? batches : [];
      return {
        select: () => ({
          order: () => ({ range: (a, b) => Promise.resolve({ data: rows.slice(a, b + 1), error: null }) }),
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
  const win = { SB, UO: { ensure: async () => true, _state: () => ({ doc: o.ownerDoc || { b: {}, i: {} } }) } };
  const sandbox = { window: win, document: doc, console, Date, Promise, setTimeout, isNaN, String, Number, Object, Array, JSON, Math, parseInt, parseFloat };
  sandbox.globalThis = sandbox;
  return { nodes, sandbox };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
function load(opts) {
  const env = makeEnv(opts);
  vm.createContext(env.sandbox);
  vm.runInContext(src, env.sandbox);
  return { D: env.sandbox.window.UploadDash, env };
}

/* ---------- 3 期次 / 周次推算 ---------- */
{
  const { D } = load({});
  const T = D._t;
  ok(T.isoWeekOf("2026-01-01") === "第1周", "2026-01-01 是第1周（实际 " + T.isoWeekOf("2026-01-01") + "）");
  ok(T.isoWeekOf("2026-11-10") === "第46周", "2026-11-10 是第46周（实际 " + T.isoWeekOf("2026-11-10") + "）");
  ok(T.isoWeekOf("") === "", "空日期不给周次");
  ok(T.normWeek("W45") === "第45周", "W45 → 第45周");
  ok(T.normWeek("45周") === "第45周", "45周 → 第45周");
  ok(T.normWeek("2026-W45") === "第45周", "2026-W45 → 第45周");
  ok(T.normWeek("2026-01") === "2026-01", "月份原样保留");
  ok(T.periodCmp("第9周", "第45周") < 0, "第9周排在第45周前面（不是字符串比较）");
  ok(T.periodCmp("2026-01", "2026-02") < 0, "月份按字典序");
}

/* ---------- 4 筛选 ---------- */
{
  const { D } = load({});
  const T = D._t;
  const recs = [
    { who: "张三", day: "2026-11-10", cat: "卫衣", n: 10, week: "第46周", month: "2026-11" },
    { who: "李四", day: "2026-11-12", cat: "衬衫", n: 5, week: "第46周", month: "2026-11" },
    { who: "张三", day: "2026-10-02", cat: "卫衣", n: 3, week: "第40周", month: "2026-10" },
  ];
  const f = { who: "", cat: "", mode: "week", period: "", from: "", to: "" };
  ok(T.applyFilter(recs, f).length === 3, "不筛选时全给");
  ok(T.applyFilter(recs, Object.assign({}, f, { who: "张三" })).length === 2, "按账号筛选");
  ok(T.applyFilter(recs, Object.assign({}, f, { cat: "衬衫" })).length === 1, "按类目筛选");
  ok(T.applyFilter(recs, Object.assign({}, f, { period: "第46周" })).length === 2, "按周次筛选");
  ok(T.applyFilter(recs, Object.assign({}, f, { mode: "month", period: "2026-10" })).length === 1, "切到月份后按月份筛选");
  ok(T.applyFilter(recs, Object.assign({}, f, { from: "2026-11-01" })).length === 2, "按起始日期筛选");
  ok(T.applyFilter(recs, Object.assign({}, f, { to: "2026-10-31" })).length === 1, "按截止日期筛选");
  ok(T.applyFilter(recs, Object.assign({}, f, { who: "张三", from: "2026-11-01" })).length === 1, "多个条件同时生效");
}

/* ---------- 5 真跑：面板结构与聚合数字 ---------- */
async function render(opts, zone) {
  const { D, env } = load(opts);
  await D.enter(zone);
  await tick(); await tick();
  return { D, env, body: env.nodes["#updash-body"].innerHTML, sub: env.nodes["#updash-sub"].textContent };
}

{
  const ownerDoc = {
    b: {
      "1": [{ u: "u1", n: "张三", t: "2026-11-10T02:00:00.000Z" }],
      "2": [{ u: "u2", n: "李四", t: "2026-11-12T02:00:00.000Z" }],
    },
    i: {},
  };
  const batches = [
    { id: 1, source: "rank", category: "卫衣", period_type: "week", period_label: "W45", rows: 120 },
    { id: 2, source: "rank", category: "衬衫", period_type: "week", period_label: "第45周", rows: 30 },
  ];
  const r = await render({ ownerDoc, batches }, "rank");

  ok(r.body.indexOf("updash-kpis") > 0, "渲染出 KPI 卡片");
  ok(r.body.indexOf("updash-filter") > 0, "渲染出筛选条");
  ok(r.body.indexOf("updash-hbars") > 0, "渲染出横向条形图");
  ok(r.body.indexOf("updash-vbars") > 0, "渲染出柱状图");
  ok(r.body.indexOf("<svg") > 0, "渲染出 SVG 折线图");
  ok(r.body.indexOf("updash-mx") > 0, "渲染出热力图");
  ok(r.body.indexOf("按周次看上传量") > 0, "趋势上升榜默认按周次（实际文案里带「周次」）");
  ok(r.body.indexOf("第45周") > 0, "W45 与 第45周 归并成同一个期次");
  ok(r.body.indexOf("第46周") < 0, "周度批次按期次归并，不因上传日期不同而拆成两列");
  /* 热力图：张三 × 第45周 = 120，李四 × 第45周 = 30 */
  ok(/张三[\s\S]{0,200}?120/.test(r.body), "热力图里张三该行有 120");
  ok(/李四[\s\S]{0,200}?30/.test(r.body), "热力图里李四该行有 30");
  ok(r.body.indexOf(">150<") > 0 || r.body.indexOf("150") > 0, "合计 150 张出现在图表区");
  ok(/共 150 张/.test(r.sub), "副标题总数 150：" + r.sub);
  ok(r.body.indexOf('data-f="who"') > 0, "有账号筛选控件");
  ok(r.body.indexOf('data-f="cat"') > 0, "有类目筛选控件");
  ok(r.body.indexOf('data-f="period"') > 0, "有期次筛选控件");
  ok(r.body.indexOf('data-f="from"') > 0, "有日期筛选控件");
  ok(r.body.indexOf('data-f="mode"') > 0, "有周次/月份口径切换");
  ok(r.body.indexOf("updash-p") > 0, "明细表有「期次」列");
}

/* ---------- 6 上新节奏默认按月份 ---------- */
{
  const batches = [
    { id: 11, source: "rhythm", category: "套装", period_type: "month", period_label: "2026-01", rows: 8 },
    { id: 12, source: "rhythm", category: "套装", period_type: "month", period_label: "2026-02", rows: 4 },
  ];
  const r = await render({ batches }, "rhythm");
  ok(r.body.indexOf("按月份看上传量") > 0, "上新节奏默认按月份看");
  ok(r.body.indexOf("2026-01") > 0 && r.body.indexOf("2026-02") > 0, "两个月都出现在柱状图里");
  ok(/共 12 张/.test(r.sub), "上新节奏总数 12：" + r.sub);
}

/* ---------- 7 反向验证：筛选形同虚设时必须被抓到 ---------- */
{
  const broken = src.replace(
    "if (f.who && r.who !== f.who) return false;",
    "if (f.who && r.who !== f.who) return true;"
  );
  ok(broken !== src, "能构造「账号筛选失效」的反向版本");
  const env = makeEnv({});
  vm.createContext(env.sandbox);
  vm.runInContext(broken, env.sandbox);
  const T2 = env.sandbox.window.UploadDash._t;
  const recs = [
    { who: "张三", day: "2026-11-10", cat: "卫衣", n: 1, week: "第46周", month: "2026-11" },
    { who: "李四", day: "2026-11-11", cat: "衬衫", n: 1, week: "第46周", month: "2026-11" },
  ];
  const got = T2.applyFilter(recs, { who: "张三", cat: "", mode: "week", period: "", from: "", to: "" });
  ok(got.length === 2, "反向版本确实没筛掉李四 —— 说明用例抓得住缺陷");
}

/* ---------- 8 反向验证：周次字符串比较会排错 ---------- */
{
  const { D } = load({});
  const T = D._t;
  const list = ["第45周", "第9周", "第10周"].sort(T.periodCmp);
  ok(list[0] === "第9周" && list[1] === "第10周" && list[2] === "第45周", "周次按数字排序：" + list.join(","));
  const bad = ["第45周", "第9周", "第10周"].sort();
  ok(bad[0] === "第10周", "纯字符串排序确实会把第9周放到最后 —— 说明必须用 periodCmp");
}

/* ---------- 9 无数据 / 读取失败仍然不假装 ---------- */
{
  const r1 = await render({ batches: [] }, "rank");
  ok(r1.body.indexOf("还没有可统计的上传记录") > 0, "没有数据时给出明确空态");
  ok(r1.body.indexOf("updash-kpis") < 0, "空态不画空图表");
}

console.log(`\n数据统计图表自检：通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
