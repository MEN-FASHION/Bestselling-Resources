/* 20261124A · 渠道合并对比两件事的自检
   ------------------------------------------------------------------
   需求：
     ① 右上角「其他渠道：合并 / 拆分」要放到后台去配（全站统一口径，可禁止前台自行切换）；
     ② 单独关掉某个人的「其他渠道（渠道合并对比）」权限，不能连带影响他看「渠道对比」。

   覆盖：
     A. 后台面板：读 merge_view → 回显单选/复选；保存时按界面真实值写库（含反向：不勾允许切换必须传 false）
     B. 前台 merge 页：按后台口径画（拆分 4 列 / 合并 2 列）；后台禁止切换时按钮消失且忽略本地记忆
     C. 权限：合并对比是独立专区的勾选项；前台可见性按普通专区判断；关掉它不影响渠道对比
     D. 反向验证：把「后台口径优先」拿掉，或把 merge 重新变回派生视图，必须失败
*/
import fs from "fs";
import vm from "vm";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

const SBX = fs.readFileSync("js/supabase.js", "utf8");
const ADMIN_HTML = fs.readFileSync("admin.html", "utf8");
const CMP = fs.readFileSync("js/admin-compare.js", "utf8");
const MRG = fs.readFileSync("js/merge-front.js", "utf8");
const COMMON = fs.readFileSync("js/common.js", "utf8");
const PERM = fs.readFileSync("js/admin-perm.js", "utf8");

/* ================= A. 静态接线 ================= */
console.log("A. 接线");
ok(/async getMergeView\(\)/.test(SBX) && /async setMergeView\(cfg\)/.test(SBX), "数据层新增 merge_view 读写");
ok(/dims\.merge_view = \{ split: c\.split === true, allowFront: c\.allowFront !== false \}/.test(SBX),
  "写库字段固定为 { split, allowFront }");
ok(/frontend_dims\.merge_view/.test(SBX), "存在 site_settings.frontend_dims.merge_view（不改表结构）");
ok(/④ 渠道合并对比 · 其他渠道展示方式/.test(ADMIN_HTML), "后台面板新增 ④ 展示方式区块");
ok(/id="mrgv-merge"/.test(ADMIN_HTML) && /id="mrgv-split"/.test(ADMIN_HTML), "后台可选「合并 / 拆分」");
ok(/id="mrgv-allow"/.test(ADMIN_HTML), "后台可控制「是否允许前台自行切换」");
ok(/id="mrgv-save"/.test(ADMIN_HTML), "后台有独立的保存按钮");
ok(/getMergeView/.test(CMP) && /setMergeView/.test(CMP), "后台脚本读写后台口径");
ok(/function applyMergeView\(mv\)/.test(MRG), "前台按后台口径应用展示方式");
ok(/if \(viewCfg\.allowFront === false\) \{ box\.classList\.add\("hidden"\); return; \}/.test(MRG),
  "后台禁止切换时前台不出现切换按钮");
ok(/「渠道合并对比」这个专区当前未对你开放/.test(MRG), "没有授权时给明确提示，而不是空白页");
ok(/不影响你查看「渠道对比」/.test(MRG), "提示里说明不影响「渠道对比」");
ok(/\{ key: "merge", label: "渠道合并对比" \}/.test(PERM), "权限管理里可单独勾「渠道合并对比」");
ok(/function permZonesWithMerge/.test(PERM), "老账号打开弹窗默认补勾（不悄悄丢失入口）");

/* —— 反向验证：实现被拿掉必须失败 —— */
ok(!/PERM_DERIVED_ZONES = \{ merge: 1 \}/.test(PERM), "merge 不再是派生专区（拿掉独立授权必须失败）");
ok(/if \(!selfOk\) state\.gate/.test(MRG), "前台先判本页授权，再看来源专区（顺序不能反）");

/* ================= 二、假 DOM ================= */
function mkEl(tag) {
  const e = {
    tagName: (tag || "div").toUpperCase(), children: [], style: {}, dataset: {},
    className: "", textContent: "", title: "", type: "", value: "", id: "", src: "", checked: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl("span"); },
    querySelectorAll() { return []; },
    focus() {}, click() {}, contains() { return false; }, closest() { return null; },
    get firstChild() { return this.children[0] || null; },
    onclick: null, onchange: null, onkeydown: null,
  };
  Object.defineProperty(e, "innerHTML", {
    get() { return this._h || ""; },
    set(v) { this._h = String(v); if (!v) e.children = []; },
  });
  return e;
}

/* ================= 三、后台面板真实执行 ================= */
async function runAdmin(saved) {
  const REG = {};
  const q = (sel) => (REG[sel] = REG[sel] || mkEl("div"));
  const doc = {
    readyState: "complete",
    querySelector: q,
    getElementById: (id) => q("#" + id),
    createElement: (t) => mkEl(t),
    addEventListener() {},
    querySelectorAll: () => [],
    head: mkEl("head"), body: mkEl("body"), documentElement: mkEl("html"),
  };
  const calls = [];
  const SB = {
    listRankChannelNames: async () => ["SHEIN", "Pinterest", "TikTok"],
    getCompareSources: async () => null,
    getCompareChannels: async () => ["SHEIN", "Pinterest", "TikTok"],
    getMergeView: async () => saved,
    setMergeView: async (cfg) => { calls.push(cfg); return cfg; },
    setCompareSources: async () => null,
    setCompareChannels: async () => null,
  };
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    document: doc, location: { href: "admin.html" },
  };
  sandbox.window = sandbox;
  sandbox.SB = SB;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(CMP, ctx);
  await new Promise((r) => setTimeout(r, 60));
  return { REG, q, calls };
}

/* ================= 四、前台 merge 页真实执行 ================= */
function mkRows() {
  return {
    ch: [
      { image_url: "http://x/p1.jpg", category: "卫衣", period_label: "2026-11", channel: "Pinterest", title: "p1" },
      { image_url: "http://x/t1.jpg", category: "卫衣", period_label: "2026-11", channel: "TikTok", title: "t1" },
      { image_url: "http://x/s1.jpg", category: "卫衣", period_label: "2026-11", channel: "SHEIN", title: "s1" },
    ],
    rank: [
      { id: 1, image_url: "http://x/r1.jpg", category: "卫衣", period_label: "2025-11", site: "美国", channel: "", title: "r1" },
    ],
  };
}

async function runMerge(opts) {
  const o = opts || {};
  const REG = {};
  const q = (sel) => (REG[sel] = REG[sel] || mkEl("div"));
  const doc = {
    readyState: "complete",
    querySelector: q,
    getElementById: (id) => q("#" + id),
    createElement: (t) => mkEl(t),
    addEventListener() {},
    querySelectorAll: () => [],
    head: mkEl("head"), body: mkEl("body"), documentElement: mkEl("html"),
  };
  const rows = mkRows();
  const store = o.local === undefined ? {} : { "tb.merge.split": o.local };
  const SB = {
    getSession: async () => ({ user: { email: "t@t" } }),
    getFrontendZoneVisibility: async () => (o.vis === undefined ? null : o.vis),
    myFrontendZones: async () => (o.mine === undefined ? null : o.mine),
    listRankChannelPics: async () => rows.ch,
    listRankItems: async () => rows.rank,
    listImageTags: async () => ({}),
    listMovementTags: async () => ({}),
    getMergeView: o.mv === undefined ? undefined : async () => o.mv,
  };
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    document: doc,
    localStorage: {
      getItem: (k) => (store[k] === undefined ? null : store[k]),
      setItem: (k, v) => { store[k] = String(v); },
    },
    location: { href: "merge.html", pathname: "/merge.html", origin: "http://x", replace() {} },
  };
  sandbox.window = sandbox;
  sandbox.SB = SB;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(MRG, ctx);
  await new Promise((r) => setTimeout(r, 120));
  const body = () => String(q("#mrg-body").innerHTML || "");
  const hasCol = (key) => body().indexOf('data-src="' + key + '"') >= 0;
  return { body, hasCol, q, REG };
}

(async () => {
  console.log("B. 后台：读配置回显 / 保存回库");
  const a1 = await runAdmin({ split: true, allowFront: false });
  ok(a1.q("#mrgv-split").checked === true, "后台存的是「拆分」时，单选框要回显在拆分上");
  ok(a1.q("#mrgv-merge").checked === false, "「合并」不应被同时勾上");
  ok(a1.q("#mrgv-allow").checked === false, "后台禁止前台切换时，这个勾要去掉");
  a1.q("#mrgv-save").onclick();
  await new Promise((r) => setTimeout(r, 30));
  ok(a1.calls.length === 1, "点保存应写库一次（实际 " + a1.calls.length + "）");
  ok(a1.calls[0] && a1.calls[0].split === true && a1.calls[0].allowFront === false,
    "写回的是界面真实值（实际 " + JSON.stringify(a1.calls[0]) + "）");

  const a2 = await runAdmin(null);
  ok(a2.q("#mrgv-merge").checked === true, "没配过时默认「合并」");
  ok(a2.q("#mrgv-allow").checked === true, "没配过时默认允许前台切换（保持老行为）");

  /* 反向：界面上把允许切换取消、选合并 → 必须原样写 false/false */
  a2.q("#mrgv-split").checked = false;
  a2.q("#mrgv-merge").checked = true;
  a2.q("#mrgv-allow").checked = false;
  a2.q("#mrgv-save").onclick();
  await new Promise((r) => setTimeout(r, 30));
  ok(a2.calls[0] && a2.calls[0].split === false && a2.calls[0].allowFront === false,
    "「合并 + 前台只读」必须严格写回（实际 " + JSON.stringify(a2.calls[0]) + "）");

  console.log("C. 前台：以后台口径为准");
  const m1 = await runMerge({ mv: { split: true, allowFront: true } });
  ok(m1.hasCol("mrg:ch:pinterest") && m1.hasCol("mrg:ch:shein") && m1.hasCol("mrg:ch:tiktok"),
    "后台选「拆分」→ 前台每个渠道各占一列");
  ok(!m1.hasCol("mrg:ch"), "拆分时不再出现合并列");
  ok(m1.hasCol("mrg:rank"), "趋势列始终在最左");

  const m2 = await runMerge({ mv: { split: false, allowFront: true } });
  ok(m2.hasCol("mrg:ch") && !m2.hasCol("mrg:ch:shein"), "后台选「合并」→ 三渠道合成一列");

  const m3 = await runMerge({ mv: { split: true, allowFront: false }, local: "0" });
  ok(m3.hasCol("mrg:ch:shein"), "后台禁止切换时，必须按后台的「拆分」画");
  ok(!m3.hasCol("mrg:ch"), "本地记忆里选的是合并，也不能覆写后台口径（反向验证）");
  ok(m3.q("#mrg-switch").classList.contains("hidden"), "后台禁止切换时，前台的切换按钮要隐藏");

  const m4 = await runMerge({ mv: { split: false, allowFront: false } });
  ok(m4.hasCol("mrg:ch") && !m4.hasCol("mrg:ch:shein"), "后台「合并 + 只读」→ 前台只有合并列");
  ok(m4.q("#mrg-switch").classList.contains("hidden"), "只读时按钮同样隐藏");

  const m5 = await runMerge({ mv: { split: false, allowFront: true }, local: "1" });
  ok(m5.hasCol("mrg:ch:shein"), "允许切换时，用户上次选的「拆分」仍要记住");
  ok(!m5.q("#mrg-switch").classList.contains("hidden"), "允许切换时按钮要在");

  const m6 = await runMerge({});
  ok(m6.hasCol("mrg:ch") && !m6.hasCol("mrg:ch:shein"), "数据层没有这项配置时退回默认「合并」（老库不掉链子）");

  console.log("D. 权限：关掉合并对比不影响渠道对比");
  const p1 = await runMerge({ mine: ["rank", "compare"] });
  ok(!p1.hasCol("mrg:rank") && !p1.hasCol("mrg:ch"), "没勾「渠道合并对比」→ 这一页不给看");
  ok(/渠道合并对比/.test(p1.body()) && /未对你开放/.test(p1.body()), "给出「未对你开放」的提示");
  const p2 = await runMerge({ mine: ["rank", "compare", "merge"] });
  ok(p2.hasCol("mrg:rank"), "勾上之后恢复正常");
  ok(/myFrontendZones/.test(MRG) && /Common\.zones/.test(MRG), "同一份白名单同时驱动菜单与页面（渠道对比不受影响）");
  ok(/zone === MERGE_ZONE\) \{[\s\S]{0,200}mine\.indexOf\(zone\) !== -1/.test(COMMON),
    "导航按普通专区口径判可见（不再由来源专区代管）");

  console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})();
