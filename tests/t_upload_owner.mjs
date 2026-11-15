/* 20261113L · 上传归属（谁能管理谁传的图）
 *
 * 需求原文：
 *   「这些能传图的地方（趋势上升榜 / 上新节奏 / SHEIN / PIN），管理员可以自己传图，
 *     但是每个管理员只能管理自己传的图 —— 管理员可以看所有人传的图，
 *     但后台管理只能管理他自己传的图，包括各种记录、操作。」
 *
 * 验收点：
 *   1) 归属模块能识别「我自己传的」「别人传的」「历史数据（无归属）」三种情况；
 *   2) 超管全放行，普通管理员只放行自己传的；
 *   3) 一个槽位多个归属人时，两人都能管（A 传了这批、B 往里追加过图）；
 *   4) 没登录（拿不到用户 id）时不认领、不放行；
 *   5) 四个面板都把这条规则接上了：能看见全部，但改动入口对别人的图是关的；
 *   6) 批量操作不会「整批拒绝」也不会「整批放行」——按张拆开，只动自己的，其余跳过并说明；
 *   7) 导入打标表的白名单只含自己传的图，别人的不会被导表改掉；
 *   8) 台账里「类目清理 / 期次归并 / 整期次删改」这类整片改动只对超管开放。
 */
import fs from "fs";
import vm from "vm";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const read = (f) => fs.readFileSync(f, "utf8");
const SRC = read("js/upload-owner.js");
const CZ = read("js/admin-channelzone.js");
const RK = read("js/admin-rank.js");
const RH = read("js/admin-rhythm.js");
const HTML = read("admin.html");
const TL = read("js/admin-titlelab.js");

/* ================= 假环境：真跑归属模块 ================= */
function mkEnv(opts) {
  const o = opts || {};
  const store = {};
  let saved = null;
  const remote = { frontend_dims: o.dims || {} };
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: o.noRow ? null : remote, error: null }) }) }),
      update: (patch) => ({ eq: async () => { saved = patch; remote.frontend_dims = patch.frontend_dims; return { error: null }; } }),
    }),
    auth: {
      getSession: async () => (o.uid ? { data: { session: { user: { id: o.uid, email: (o.email || "a@b.com") } } } } : { data: { session: null } }),
    },
  };
  const ctx = {
    window: {},
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    SB: {
      client,
      getSession: async () => (o.uid ? { user: { id: o.uid, email: (o.email || "a@b.com") } } : null),
    },
    Date,
    JSON,
    console,
  };
  ctx.window = ctx;               // 模块里用 window.UO / window.SB
  ctx.currentRole = o.role || "admin";
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { UO: ctx.UO, ctx, saved: () => saved, store };
}

(async function main() {
  /* ---------- 1) 未登录：不认领、不放行 ---------- */
  {
    const { UO } = mkEnv({ uid: null });
    await UO.ensure();
    ok(UO.canManage("i", "http://x/1.jpg") === false, "未登录时应一律不放行");
    ok((await UO.claim("i", ["http://x/1.jpg"])) === false, "未登录时不应写归属");
    ok(UO.isSuper() === false, "普通管理员不应被判成超管");
  }

  /* ---------- 2) 管理员认领自己的图 ---------- */
  {
    const { UO, saved } = mkEnv({ uid: "u-1", email: "alice@shop.com" });
    const r = await UO.claim("i", ["http://x/a.jpg", "http://x/b.jpg"]);
    ok(r === true, "认领应写库成功");
    ok(saved() && saved().frontend_dims && saved().frontend_dims.upload_owners,
      "归属应写进 site_settings.frontend_dims.upload_owners（不改表结构）");
    const doc = saved().frontend_dims.upload_owners;
    ok(doc.i["http://x/a.jpg"][0].u === "u-1", "归属应记到当前账号 id");
    ok(doc.i["http://x/a.jpg"][0].n === "alice", "显示名取邮箱前缀，便于人眼辨认");

    await UO.ensure();
    ok(UO.canManage("i", "http://x/a.jpg") === true, "自己传的应可管理");
    ok(UO.canManage("i", "http://x/other.jpg") === false, "没有归属的（历史数据）普通管理员不可改");
    ok(UO.label("i", "http://x/other.jpg") === "历史数据", "无归属应显示为历史数据");
    ok(/只有超级管理员/.test(UO.hint("i", "http://x/other.jpg")), "历史数据的提示应写明只有超管可改");
    ok(/你上传的/.test(UO.hint("i", "http://x/a.jpg")), "自己的图应提示可改动");
  }

  /* ---------- 3) 超管全放行 ---------- */
  {
    const { UO } = mkEnv({ uid: "u-9", role: "super_admin" });
    await UO.ensure();
    ok(UO.isSuper() === true, "super_admin 应被判成超管");
    ok(UO.canManage("b", 12345) === true, "超管对任何批次都可管理");
    ok(UO.canManage("i", "http://x/whatever.jpg") === true, "超管对任何图都可管理");
    ok(/超级管理员/.test(UO.hint("i", "http://x/whatever.jpg")), "超管的提示应说明权限来源");
  }

  /* ---------- 4) 多人共管同一批（A 传过、B 追加过） ---------- */
  {
    const dims = { upload_owners: { b: { 77: [{ u: "u-1", n: "alice", t: "2026-01-01" }] }, i: {} } };
    const A = mkEnv({ uid: "u-1", dims: JSON.parse(JSON.stringify(dims)) });
    await A.UO.ensure();
    ok(A.UO.canManage("b", 77) === true, "先传的人可管理该批次");
    // B 往同一批追加 → 追加时也会登记自己
    A.ctx.SB.client.auth.getSession = async () => ({ data: { session: { user: { id: "u-2", email: "bob@shop.com" } } } });
    // 用同一份远端数据模拟 B 的会话
    const B = mkEnv({ uid: "u-2", dims: { upload_owners: { b: { 77: [{ u: "u-1", n: "alice", t: "2026-01-01" }, { u: "u-2", n: "bob", t: "2026-01-02" }] }, i: {} } } });
    await B.UO.ensure();
    ok(B.UO.canManage("b", 77) === true, "追加过图的第二个人也应可管理（不互相卡死）");
    ok(B.UO.label("b", 77) === "alice、bob", "上传人应列出全部归属人");
  }

  /* ---------- 5) 批量判断：按项拆开，不整批连坐 ---------- */
  {
    const dims = { upload_owners: { b: { 1: [{ u: "u-1", n: "alice" }], 3: [{ u: "u-1", n: "alice" }] }, i: {} } };
    const { UO } = mkEnv({ uid: "u-1", dims });
    await UO.ensure();
    const g = UO.canManageList("b", [1, 2, 3, 4]);
    ok(g.ok.join(",") === "1,3", "只应放行自己传的那几项");
    ok(g.denied.join(",") === "2,4", "其余应被拦下并回报，而不是静默丢弃");
  }

  /* ---------- 6) 写库失败时本机镜像仍能认出自己 ---------- */
  {
    const env = mkEnv({ uid: "u-1", noRow: true });
    await env.UO.ensure();
    await env.UO.claim("i", ["http://x/c.jpg"]);
    const ls = JSON.parse(env.store[Object.keys(env.store)[0]] || "{}");
    ok(ls.i && ls.i["http://x/c.jpg"], "写库拿不到行时应退回本机镜像，别让刚传的图立刻变成「历史数据」");
  }

  /* ---------- 7) 四个面板都接上了（静态检查关键挂点） ---------- */
  ok(/js\/upload-owner\.js/.test(HTML), "后台页面未引入归属模块");
  const tag = (f) => HTML.indexOf('<script src="js/' + f);
  const idxOwner = tag("upload-owner.js");
  const idxRank = tag("admin-rank.js");
  const idxRhythm = tag("admin-rhythm.js");
  const idxCz = tag("admin-channelzone.js");
  ok(idxOwner > 0 && idxOwner < idxRank && idxOwner < idxRhythm && idxOwner < idxCz,
    "归属模块必须在这三个面板脚本之前加载，否则首屏渲染时判定不到");

  /* 专区（Pinterest / SHEIN） */
  ok(/st\.own\[String\(r\.id\)\]/.test(CZ), "专区图墙未按归属标记每张图");
  ok(/is-locked/.test(CZ) && /cz-lock-badge/.test(CZ), "别人的图应加只读标记（看得见但改不了）");
  ok(/function splitOwn\(k, ids\)/.test(CZ), "缺少批量操作的白名单拆分");
  ok(/gate\.denied\.length/.test(CZ) && /跳过/.test(CZ), "批量操作应说明跳过了几张别人的图");
  ok(/if \(!gate\.ok\.length\) \{ toast\(denyMsgN\(list\.length\), false\); return; \}/.test(CZ),
    "全选都是别人的图时应直接拒绝并说明原因");
  ok(/st\.own && st\.own\[String\(item\.id\)\] === false\) \{ toast\(denyMsg\(\), false\); return; \}/.test(CZ),
    "打标保存必须拦住别人的图");
  ok(/UO\.claim\("i"/.test(CZ), "上传成功后应登记归属");
  ok(/lockedN/.test(CZ), "导入打标表应把别人的图排除在白名单外并说明");

  /* 趋势上升榜 / 上新节奏 */
  [["趋势上升榜", RK], ["上新节奏", RH]].forEach(([name, src]) => {
    ok(/function batchCanRun\(b\)/.test(src), name + "缺少批次级归属判定");
    ok(/UO\.claim\("b"/.test(src), name + "导入成功后应登记归属");
    ok(/rank-batch-owner/.test(src), name + "批次行应显示上传人");
    if (name === "趋势上升榜") ok(/pick\.disabled = !can/.test(src), name + "别人的批次不应能勾选");
    ok(/den\.disabled = !can/.test(src) || /del\.disabled = !can/.test(src), name + "别人的批次不应能删除");
    ok(/readOnly = !gate/.test(src), name + "别人的期次不应能改名");
    ok(/rankPeriodGate/.test(src), name + "缺少期次级归属汇总");
  });
  ok(/认领历史数据/.test(RK), "超管应能把历史数据认领到自己名下");
  ok(/仅超级管理员可用/.test(RK), "类目清理 / 期次归并应说明只对超管开放");

  /* 标题组词台（同样有上传入口，规则一致） */
  ok(/UO\.claim\("b"/.test(TL), "标题组词台导入后应登记归属");
  ok(/不可改动/.test(TL), "标题组词台台账应标出别人的批次不可改动");
  ok(/del\.disabled = !can/.test(TL), "标题组词台别人的批次不应能删除");

  /* 面板间不互相干扰：两个专区各有自己的状态，归属判定按图片地址，不按面板 */
  ok(/st\.own = \{\}/.test(CZ) && /st\.ownerLabel = \{\}/.test(CZ), "两个专区应各自独立计算归属映射");

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) process.exit(1);
})();
