/* 20261116A · 「批量更正上传日期」自检
 *
 * 用户需求：传过的图想批量改上传日期。
 *
 * 本自检做三件事（不是只查字符串）：
 *   1) 把 js/upload-owner.js 真放进假环境跑起来：写入日期、读出来、撤销、权限（本人/超管/别人）、
 *      地址归一（完整地址与相对路径认成同一张图）、删除时连带清理；
 *   2) 源码级断言：五个后台入口（趋势上升榜 / 上新节奏 / S·P·T 渠道专区 / 品牌动向 / 视觉专区）
 *      都接上了日期更正，且统计侧优先读更正日期、其次才是登记时间；
 *   3) 每条关键断言配反向用例：把「优先读更正日期」拆掉、把地址归一拆掉、把权限判定拆掉，
 *      断言必须报错 —— 证明用例抓得住缺陷，而不是永远通过。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };
const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ---------------- 假环境：跑 upload-owner.js ---------------- */
function makeEnv(roles, shared) {
  const store = shared || { dims: {} };
  let sessions = null;
  const client = {
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        update(patch) {
          this._patch = patch;
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: { frontend_dims: JSON.parse(JSON.stringify(store.dims)) } });
        },
        then(res) {
          /* update(...).eq() 被 await：把 frontend_dims 落进假库 */
          if (this._patch && this._patch.frontend_dims) store.dims = JSON.parse(JSON.stringify(this._patch.frontend_dims));
          return Promise.resolve({ data: null, error: null }).then(res);
        },
      };
    },
  };
  const ls = {};
  const win = {
    SB: {
      client,
      getSession: () => Promise.resolve({ user: sessions }),
    },
  };
  const ctx = {
    window: win,
    localStorage: {
      getItem: (k) => (k in ls ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: (k) => { delete ls[k]; },
    },
    console,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    RegExp,
    Promise,
    setTimeout,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("js/upload-owner.js"), ctx, { filename: "upload-owner.js" });
  /* 超管判定：直接把 currentRole 塞进上下文（源码里 try/catch 读的就是它） */
  vm.runInContext("var currentRole = " + JSON.stringify(roles || "admin") + ";", ctx);
  return {
    win,
    UO: ctx.window.UO,
    setUser(u) { sessions = u; },
    store,
  };
}

const U1 = { id: "u1", email: "zhangsan@x.com" };
const U2 = { id: "u2", email: "lisi@x.com" };

/* ---------------- 一、真跑：写 / 读 / 撤销 ---------------- */
{
  const env = makeEnv("super_admin");
  env.setUser(U1);
  await env.UO.ensure();
  /* 一个超管先把两个槽位登记成 u1 的（模拟上传时记了归属） */
  await env.UO.claim("b", ["101", "102"]);
  await env.UO.claim("i", ["https://cdn.example.com/images/a/1.jpg"]);

  const r1 = await env.UO.setDate("b", ["101"], "2026-11-03");
  ok(r1.ok.length === 1, "超管可以给批次写日期");
  ok(env.UO.dateOf("b", "101") === "2026-11-03", "批次日期读回来是 2026-11-03");
  ok(env.UO.dateOf("b", "102") === "", "没改的批次不受影响");

  /* 地址归一：完整地址 / 相对路径 / 带查询串，都认成同一张图 */
  const r2 = await env.UO.setDate("i", ["https://cdn.example.com/images/a/1.jpg"], "2026-10-01");
  ok(r2.ok.length === 1, "超管可以给图片写日期");
  ok(env.UO.dateOf("i", "images/a/1.jpg") === "2026-10-01", "相对路径能读到同一张图的日期");
  ok(env.UO.dateOf("i", "https://cdn.example.com/images/a/1.jpg?token=abc") === "2026-10-01", "带 token 的地址仍是同一张图");

  /* 撤销 */
  const r3 = await env.UO.clearDate("b", ["101"]);
  ok(r3.ok.length === 1, "撤销日期返回成功");
  ok(env.UO.dateOf("b", "101") === "", "撤销后日期回到空（统计会退回登记时间）");

  /* 删除记录时连带清理日期更正 */
  await env.UO.setDate("b", ["102"], "2026-09-09");
  await env.UO.forget("b", ["102"]);
  ok(env.UO.dateOf("b", "102") === "", "删掉批次后，日期更正也一并清掉");

  /* 非法日期直接拒绝（不能写进脏值） */
  const r4 = await env.UO.setDate("b", ["103"], "2026/11/03");
  ok(r4.ok.length === 0, "非法日期（斜杠）不写入");
}

/* ---------------- 二、真跑：权限 ---------------- */
{
  const env = makeEnv("admin");           /* 普通管理员 u1 */
  env.setUser(U1);
  await env.UO.ensure();
  await env.UO.claim("b", ["201"]);       /* u1 名下 */

  /* 换成 u2（另一个人，另开一个「浏览器」但读同一份库），试图改 u1 的批次 */
  const envB = makeEnv("admin", env.store);
  envB.setUser(U2);
  await envB.UO.ensure();
  const deny = await envB.UO.setDate("b", ["201"], "2026-11-05");
  ok(deny.ok.length === 0 && deny.denied.length === 1, "别人上传的批次不能改日期");

  /* u2 改自己的 */
  await envB.UO.claim("b", ["202"]);
  const own = await envB.UO.setDate("b", ["202"], "2026-11-05");
  ok(own.ok.length === 1, "自己上传的批次可以改日期");

  /* 历史数据（没有归属）：普通管理员改不了 */
  const hist = await envB.UO.setDate("b", ["999"], "2026-11-05");
  ok(hist.ok.length === 0 && hist.denied.length === 1, "没有归属的历史数据，普通管理员不能改");

  /* 超管可以改历史数据 */
  const env3 = makeEnv("super_admin", env.store);
  env3.setUser(U1);
  await env3.UO.ensure();
  const sup = await env3.UO.setDate("b", ["999"], "2026-11-05");
  ok(sup.ok.length === 1, "超管可以给历史数据补日期");

  /* 混合选择：本人的改、别人的跳过（不整批失败） */
  const mix = await envB.UO.setDate("b", ["201", "202"], "2026-11-06");
  ok(mix.ok.length === 1 && mix.denied.length === 1, "混选时只改本人的，别人的跳过");
}

/* ---------------- 三、源码：五个入口都接上 ---------------- */
const rank = read("js/admin-rank.js");
const rhythm = read("js/admin-rhythm.js");
const cz = read("js/admin-channelzone.js");
const mv = read("js/admin-movement.js");
const imgs = read("js/admin-images.js");
const dash = read("js/upload-dash.js");
const html = read("admin.html");

ok(/改上传日期/.test(rank), "趋势上升榜有「改上传日期」入口");
ok(/backdateBatches\(/.test(rank) && /UO\.setDate\("b"/.test(rank), "趋势上升榜调用日期更正（批次）");
ok(/dateSel/.test(rank), "趋势上升榜支持勾选多批一起改");
ok(/改上传日期/.test(rhythm) && /backdateBatch\(/.test(rhythm), "上新节奏有单批改日期");
ok(/backdateBatch/.test(rhythm) && /UO\.setDate\("b"/.test(rhythm), "上新节奏调用日期更正（批次）");
ok(/tag-date/.test(cz) && /setDate\("i"/.test(cz), "S/P/T 单张编辑可改日期并同步统计");
ok(/批量编辑|batch-date/.test(cz) && /patch\.uploaded/.test(cz), "S/P/T 批量编辑仍可改日期");
ok(/UO\.setDate\("i", urls/.test(cz), "S/P/T 批量改日期同时写进日期更正");
ok(/mv-tag-date/.test(html) && /mv-tag-date/.test(mv), "品牌动向弹层有改日期按钮");
ok(/setMovementDate/.test(read("js/supabase.js")), "品牌动向有日期写库接口");
ok(/batch-date-btn/.test(html) && /batchBackdate/.test(imgs), "视觉专区有批量改日期按钮");
ok(/setImageSingleField\(img\.id, "created_at"/.test(imgs), "视觉专区写 images.created_at");

/* 统计侧优先级：更正日期 > 归属登记时间 > 记录自身 created_at */
function statsOrderOk(src) {
  const b = /loadBatches[\s\S]*?var day = ([^;]+);/.exec(src);
  const c = /loadChannelPics[\s\S]*?var day = ([^;]+);/.exec(src);
  const m = /loadMovement[\s\S]*?var day = ([^;]+);/.exec(src);
  const okB = b && /dateOv\("b"/.test(b[1]) && b[1].indexOf("dateOv") < b[1].indexOf("own.t");
  const okC = c && /dateOv\("i"/.test(c[1]) && c[1].indexOf("dateOv") < c[1].indexOf("own.t");
  const okM = m && /dateOv\("i"/.test(m[1]) && m[1].indexOf("dateOv") < m[1].indexOf("own.t");
  return !!(okB && okC && okM);
}
ok(statsOrderOk(dash), "数据统计优先读「更正后的日期」");
/* 反向：把优先级拆掉必须报错 */
const brokenDash = dash
  .replace(/var day = dateOv\("b"[^\n]*\n/, 'var day = (own ? dayOf(own.t) : "");\n')
  .replace(/var day = dateOv\("i", r\.image_url\) \|\| \(own \? dayOf\(own\.t\) : ""\);/g, 'var day = own ? dayOf(own.t) : "";');
ok(!statsOrderOk(brokenDash), "反向：去掉「更正日期优先」后，检查必须失败");

/* 地址归一：拆掉就必须报错 */
function normOk(src) { return /function normKey\(kind, key\)[\s\S]{0,400}replace\(\/\^\\\/\+\/, ""\)/.test(src); }
const owner = read("js/upload-owner.js");
ok(normOk(owner), "图片地址做了归一（域名 / 查询串 / 前导斜杠）");
ok(!normOk(owner.replace(/var m = \/\^\[a-z\]\+:[\s\S]{0,120}/, "")), "反向：去掉域名归一后，检查必须失败");

/* 权限：改日期必须走 canManageList，否则普通管理员能改别人的数据 */
ok(/async function setDate[\s\S]{0,800}canManageList\(kind, list\)/.test(owner), "改日期前先做权限判定");
ok(!/async function setDate[\s\S]{0,800}canManageList\(kind, list\)/.test(owner.replace(/canManageList\(kind, list\)/g, "({ok: list, denied: []})")), "反向：去掉权限判定后，检查必须失败");

/* 撤销接口存在 */
ok(/async function clearDate/.test(owner) && /clearDate: clearDate/.test(owner), "提供「撤销日期更正」接口");
ok(/forgetDates/.test(owner), "删除记录时可清理日期更正");
ok(/askDate/.test(owner) && /sbAskDate/.test(read("js/admin-dialog.js")), "日期输入走站点自己的弹窗");

/* 版本戳：前台页面与脚本一致（避免旧缓存） */
ok(/20261122A/.test(html), "后台页面版本戳为 20261122A");
ok(/var BUILD = "20261122A"/.test(dash), "统计脚本版本戳为 20261122A");

console.log(pass + " 项通过" + (fail ? "，" + fail + " 项失败" : ""));
process.exit(fail ? 1 : 0);
