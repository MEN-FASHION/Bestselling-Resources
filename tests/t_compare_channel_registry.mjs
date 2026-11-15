/* 20261114T · 渠道对比 · 后台渠道清单可任意增减
 *
 * 要解决的问题：
 *   「可加入的专区 / 渠道」以前只能从「库里已经出现过的渠道名」推出来，
 *   没传过图的渠道根本不在候选里，看起来就像「只能配那四个」。
 *
 * 验收点：
 *   1) 渠道清单是一份可编辑名单（compare_channels），加几个都行，不限个数；
 *   2) 新增的渠道立刻进清单、进对比列，保存时两处都写库；
 *   3) 删除只动名单与对比列，不删任何图片，且刷新后不会因历史图被补回来；
 *   4) 前台读取清单，登记过但还没图的渠道也要占一列（写明无图）。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

/* ================= 一、代码层约定 ================= */
console.log("一、实现约定");
const AC = read("js/admin-compare.js");
const SUPA = read("js/supabase.js");
const FRONT = read("js/compare-front.js");

ok(/getCompareChannels/.test(SUPA) && /setCompareChannels/.test(SUPA), "数据层缺少渠道清单读写");
ok(/compare_channels/.test(SUPA), "渠道清单应存 frontend_dims.compare_channels（不改表结构）");
ok(/state\.channels/.test(AC), "后台应有独立的渠道清单状态（不再只靠数据反推）");
ok(/function dropChannel/.test(AC), "后台缺少「从清单删除渠道」");
ok(/state\.channels\.push/.test(AC), "新增渠道应写进清单而不是只写进对比列");
ok(/cmpa-chip-x/.test(AC), "清单里的渠道应有「✕」可从清单删除");
ok(/getCompareChannels/.test(FRONT), "前台应读取渠道清单");
ok(/fromList/.test(FRONT), "前台应把「清单里有、数据里还没有」的渠道补成一列");

/* ================= 二、真实执行后台脚本 ================= */
console.log("二、实跑：加第 5、第 6 个渠道，删渠道，刷新重载");

function mkEl(tag) {
  const e = {
    tagName: (tag || "div").toUpperCase(), children: [], style: {}, dataset: {},
    className: "", textContent: "", title: "", type: "", value: "", id: "", checked: false,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    appendChild(c) { this.children.push(c); c.parentNode = e; return c; },
    removeChild(c) { e.children = e.children.filter((x) => x !== c); },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, focus() {}, click() {},
    querySelector() { return mkEl("input"); },
    querySelectorAll() { return []; },
    contains() { return false; }, closest() { return null; },
    get firstChild() { return e.children[0] || null; },
    onclick: null, onchange: null, onkeydown: null,
  };
  Object.defineProperty(e, "innerHTML", {
    get() { return e._h || ""; },
    set(v) { e._h = String(v); if (!v) e.children = []; },
  });
  return e;
}

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

/* 假数据库：只记两个键，行为与真实实现一致（去重、保留顺序、写失败会抛） */
const DB = {
  channelNames: ["Pinterest", "SHEIN", "TikTok", "Amazon"],  // 数据里出现过的
  compareChannels: null,                                      // 尚未保存过清单
  compareSources: null,
  savedLists: [], savedChannels: [],
};
const SB = {
  async listRankChannelNames() { return DB.channelNames.slice(); },
  async getCompareSources() { return DB.compareSources ? JSON.parse(JSON.stringify(DB.compareSources)) : null; },
  async setCompareSources(cfg) {
    DB.compareSources = JSON.parse(JSON.stringify(cfg));
    DB.savedLists.push(JSON.parse(JSON.stringify(cfg.list)));
    return DB.compareSources;
  },
  async getCompareChannels() { return DB.compareChannels ? DB.compareChannels.slice() : null; },
  async setCompareChannels(list) {
    const seen = {}; const out = [];
    (list || []).forEach((x) => {
      const n = String(x == null ? "" : x).trim();
      const k = n.replace(/[\s_\-]/g, "").toLowerCase();
      if (!n || seen[k]) return;
      seen[k] = 1; out.push(n);
    });
    DB.compareChannels = out;
    DB.savedChannels.push(out.slice());
    return out;
  },
};

const win = {
  SB, document: doc,
  uiConfirm: () => Promise.resolve(true),
  sbToast: () => {},
  open() {},
};
win.window = win;
const ctx = vm.createContext({ window: win, document: doc, console, Promise, setTimeout, JSON, String, Array, Object, Number, Date, RegExp, Math, localStorage: { getItem: () => null, setItem() {} } });
ctx.globalThis = ctx;
vm.runInContext(AC, ctx, { filename: "admin-compare.js" });

const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  const CA = win.CompareAdmin;
  ok(!!CA, "脚本未导出 CompareAdmin");
  await tick(); await tick();

  /* 初始：还没保存过清单 → 用数据里出现过的渠道生成名单 */
  ok(CA.state.channels.length === 4, "初始清单应包含数据里出现过的 4 个渠道，实际 " + CA.state.channels.length);
  ok(CA.state.list.length === 5, "初始对比列应为 4 渠道 + 上新节奏，实际 " + CA.state.list.length);

  /* 加第 5、第 6 个（库里完全没有的渠道） */
  ok(CA.addChannel("AliExpress") === true, "应能新增库里没有的渠道");
  ok(CA.addChannel("独立站") === true, "应能新增中文渠道名");
  ok(CA.addChannel("aliexpress") === false, "重复渠道（忽略大小写）不应重复加");
  ok(CA.state.channels.length === 6, "新增后清单应为 6 个，实际 " + CA.state.channels.length);
  ok(CA.state.list.some((x) => x.channel === "AliExpress"), "新增渠道应同时进对比列");
  ok(CA.state.list.some((x) => x.channel === "独立站"), "新增渠道应同时进对比列（中文名）");

  await CA.reload(); await tick(); await tick();
  ok(CA.state.channels.length === 4, "未保存时重新读取应回到库里出现的渠道（不该假装已存）");

  /* 保存：清单与对比列都要写库 */
  CA.addChannel("AliExpress");
  const saveBtn = doc.querySelector("#cmpa-save");
  saveBtn.onclick();
  await tick(); await tick();
  ok((DB.savedChannels[0] || []).indexOf("AliExpress") >= 0, "保存时应写入渠道清单");
  ok(JSON.stringify(DB.savedLists[0]).indexOf("aliexpress") >= 0, "保存时应写入对比列");
  ok(DB.compareChannels.length === 5, "清单应存 5 个渠道，实际 " + (DB.compareChannels || []).length);

  /* 刷新重载：以保存的清单为准 */
  await CA.reload(); await tick(); await tick();
  ok(CA.state.channels.indexOf("AliExpress") >= 0, "刷新后应保留已保存的渠道");
  ok(CA.state.channels.length === 5, "刷新后清单为 5 个，实际 " + CA.state.channels.length);

  /* 删掉一个渠道：只动清单与对比列 */
  const before = DB.channelNames.length;
  const ch = CA.state.channels.filter((c) => /^amazon$/i.test(c))[0];
  ok(!!ch, "清单里应有 Amazon 用于删除测试");
  /* 直接调用界面上的 ✕（渲染后池子里有它） */
  const pool = doc.querySelector("#cmpa-pool");
  let clicked = false;
  (function walk(el) {
    (el.children || []).forEach((c) => {
      if (c.className && String(c.className).indexOf("cmpa-chip-x") >= 0) {
        const wrapTitle = (c.title || "");
        if (/Amazon/i.test(wrapTitle)) { c.onclick({ stopPropagation() {} }); clicked = true; }
      }
      walk(c);
    });
  })(pool);
  await tick(); await tick();
  ok(clicked, "清单里的渠道应能点到 ✕");
  ok(CA.state.channels.filter((c) => /^amazon$/i.test(c)).length === 0, "删除后清单不应再有 Amazon");
  ok(CA.state.list.filter((x) => /^amazon$/i.test(x.channel || "")).length === 0, "删除后对比列不应再有 Amazon");
  ok(DB.channelNames.length === before, "删除渠道不得改动图片数据");

  saveBtn.onclick(); await tick(); await tick();
  ok((DB.compareChannels || []).filter((c) => /^amazon$/i.test(c)).length === 0, "删除后保存，清单里也不该再有它");

  /* 关键：删掉的渠道即使数据里还有图，刷新后也不能被自动补回来 */
  await CA.reload(); await tick(); await tick();
  ok(CA.state.channels.filter((c) => /^amazon$/i.test(c)).length === 0, "刷新后不得因历史图把删掉的渠道补回来");

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) process.exit(1);
})();
