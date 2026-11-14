/* t_admin_upload_isolation.mjs — 后台上传也要分域（20261113C）
 *
 * 用户原话：「我的意思是后台传数据也要隔离」。
 * 上一版把「数据域」做成趋势上升榜导入区里的一个下拉：能选，就一定会有人选错，
 * 选错就是把另一份数据写脏。这一版改成「一个专区一个上传面板」，
 * 标题组词台有了自己的入口，写入 / 清空 / 查重 / 撤销 / 台账 / 类目清理 /
 * 期次归并 / 数据自检 全部只作用于自己那一域。
 *
 * 这里不是查字符串，而是用假 DOM + 假库把「上传 → 写入 → 撤销」整条链路真跑一遍，
 * 抓「有没有漏带 source」这种只有实际执行才看得见的问题。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

/* ---------------- 假 DOM ---------------- */
function mkEl(tag) {
  const e = {
    tagName: (tag || "div").toUpperCase(), children: [], style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    _html: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    textContent: "", value: "", className: "", type: "", title: "", id: "", src: "", checked: false,
    disabled: false,
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, insertBefore() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl("div"); }, querySelectorAll() { return []; },
    focus() {}, click() {}, add() {}, cloneNode() { return mkEl(tag); },
    closest() { return null; }, contains() { return false; }, matches() { return false; },
  };
  e.parentNode = null;
  return e;
}
function mkDoc(store) {
  return {
    readyState: "complete", body: mkEl("body"),
    getElementById(id) { if (!(id in store)) { store[id] = mkEl("div"); store[id].id = id; } return store[id]; },
    querySelector(sel) {
      const m = /^#([\w-]+)$/.exec(String(sel));
      if (m) return this.getElementById(m[1]);
      return mkEl("div");
    },
    querySelectorAll() { return []; },
    createElement(t) { return mkEl(t); },
    createTextNode(t) { return { nodeValue: t }; },
    addEventListener() {}, removeEventListener() {},
  };
}

/* ---------------- 假库：记录每一次调用的参数 ---------------- */
function mkSB(calls) {
  const log = (name) => (arg) => { calls.push({ fn: name, arg: arg }); return undefined; };
  return {
    listRankSites: async () => [],
    listActiveCats: async () => ["T恤", "卫衣"],
    addCategory: async () => true,
    listRankBatches: async (source) => { calls.push({ fn: "listRankBatches", arg: source }); return []; },
    countRankSlot: async (o) => { calls.push({ fn: "countRankSlot", arg: o }); return 0; },
    listRankItems: async (o) => { calls.push({ fn: "listRankItems", arg: o }); return [{ id: 1, title: "旧", image_url: "u0", period_label: "第44周", category: "T恤", site: "美国" }]; },
    clearRankSlot: async (o) => { calls.push({ fn: "clearRankSlot", arg: o }); return { items: 1, batches: 0 }; },
    listRankSlotUrls: async (o) => { calls.push({ fn: "listRankSlotUrls", arg: o }); return []; },
    createRankBatch: async (o) => { calls.push({ fn: "createRankBatch", arg: o }); return 101; },
    insertRankItems: async (rows) => { calls.push({ fn: "insertRankItems", arg: rows }); return { inserted: rows.length }; },
    updateRankBatch: async (id, patch) => { calls.push({ fn: "updateRankBatch", arg: { id: id, patch: patch } }); return true; },
    deleteRankItemsByScope: async (o) => { calls.push({ fn: "deleteRankItemsByScope", arg: o }); return 2; },
    deleteRankBatch: async (id) => { calls.push({ fn: "deleteRankBatch", arg: id }); return true; },
    listRankCategories: async (s) => { calls.push({ fn: "listRankCategories", arg: s }); return []; },
    deleteRankCategory: async (c, s) => { calls.push({ fn: "deleteRankCategory", arg: { c, s } }); return { items: 0, batches: 0 }; },
    renameRankCategory: async (f, t, s) => { calls.push({ fn: "renameRankCategory", arg: { f, t, s } }); return 0; },
    rankSelfCheck: async (s) => { calls.push({ fn: "rankSelfCheck", arg: s }); return { items: 0, byPeriod: [] }; },
    updateRankPeriodData: async (...a) => { calls.push({ fn: "updateRankPeriodData", arg: a }); return 0; },
    deleteRankPeriod: async (...a) => { calls.push({ fn: "deleteRankPeriod", arg: a }); return 0; },
    getRankHidden: async () => ({ sites: [], periods: [] }),
    setRankHidden: async () => ({}),
    getPatternPrintVisible: async () => true,
    setPatternPrintVisible: async () => true,
  };
}

/* ---------------- 假表格（真实表结构：期次/叶子类目/销量站点/首图url/货品名称/环比比例/环比绝对值） ---------------- */
const AOA = [
  ["期次", "叶子类目名称", "销量站点", "首图url", "货品名称", "环比比例", "环比绝对值"],
  ["第44周", "T 恤", "美国", "https://img.example.com/a.jpg", "Women's Vintage Striped Cotton Tee", "12%", "300"],
  ["第44周", "T 恤", "美国", "https://img.example.com/b.jpg", "Men's Oversized Hoodie Cotton", "8%", "180"],
  ["第44周", "T 恤", "美国", "https://img.example.com/c.jpg", "Retro Floral Summer Shirt", "5%", "90"],
];
const mkXLSX = () => ({
  read: () => {
    /* 造出真实单元格：首图url 那一列（D）每行给一个地址，模拟真实表格 */
    const ws = { "!ref": "A1:G4" };
    AOA.forEach((row, r) => row.forEach((v, c) => {
      ws[String.fromCharCode(65 + c) + (r + 1)] = { w: String(v), v: v };
    }));
    return { SheetNames: ["S1"], Sheets: { S1: ws } };
  },
  utils: {
    sheet_to_json: () => AOA,
    decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 3, c: 6 } }),
    encode_cell: ({ r, c }) => String.fromCharCode(65 + c) + (r + 1),
    aoa_to_sheet: () => ({}),
    book_new: () => ({}),
    book_append_sheet: () => {},
  },
  writeFile: () => {},
});

/* ---------------- 跑一遍：趋势上升榜（提供 RankParse）+ 标题组词台面板 ---------------- */
function boot() {
  const store = {};
  const calls = [];
  const document = mkDoc(store);
  const win = {
    document, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    JSON, Math, Date, Number, String, Array, Object, Map, Set,
    Promise, RegExp, Error, isFinite, parseFloat, parseInt,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    addEventListener() {}, location: { href: "http://x/admin.html" },
    SB: mkSB(calls),
    XLSX: mkXLSX(),
    sbToast: (m, s) => calls.push({ fn: "toast", arg: { m: m, s: s } }),
    escHtml: (s) => String(s == null ? "" : s),
    escAttr: (s) => String(s == null ? "" : s),
    uiConfirm: async () => true,
    uiPrompt: async () => "",
    uiAlert: async (m) => { calls.push({ fn: "uiAlert", arg: m }); },
    FileReader: function () { this.readAsArrayBuffer = () => {}; },
  };
  win.window = win;
  vm.createContext(win);
  /* 顺序同 admin.html：类目归并 / 期次归并 → 榜单面板（提供 RankParse）→ 标题组词台面板 */
  ["js/rank-cat-norm.js", "js/rank-period-norm.js", "js/admin-rank.js", "js/admin-titlelab.js"].forEach((f) => {
    try { vm.runInContext(read(f), win, { filename: f }); }
    catch (e) { calls.push({ fn: "__throw", arg: f + ": " + ((e && e.message) || "") }); }
  });
  return { store, calls, win };
}

const b = boot();
const throws = b.calls.filter((c) => c.fn === "__throw");
ok(!throws.length, "脚本执行抛错：" + throws.map((c) => c.arg).join(" | "));
ok(!!b.win.RankParse, "admin-rank.js 应暴露 RankParse（供组词台复用表头识别 / 分组）");
ok(typeof b.win.enterTiPanel === "function", "组词台数据层内核仍在（仅面板不再挂载）");

/* ---------- 一、面板结构：三个专区各有自己的上传入口 ---------- */
const HTML = read("admin.html");
ok(!/id="rank-import-source"/.test(HTML), "趋势上升榜导入区不应再有「数据域」下拉");
ok(!/data-target="titlelab-card"/.test(HTML), "标题组词台已下线，侧栏不应再有它的入口");
ok(!/id="titlelab-card"/.test(HTML), "标题组词台已下线，不应再有它的面板容器");
["ti-file", "ti-import", "ti-undo", "ti-batch-list", "ti-selfcheck", "ti-import-progress"].forEach((id) => {
  ok(!new RegExp('id="' + id + '"').test(HTML), "标题组词台已下线，不应再有 #" + id);
});
ok(/id="rm-import"/.test(HTML) && /id="rank-import"/.test(HTML),
  "上新节奏 / 趋势上升榜各自的上传按钮应保留（三个入口并列，而不是挤在一个面板里选域）");
ok(read("admin.html").indexOf("admin-titlelab.js") < 0, "标题组词台已下线，admin.html 不应再引入它的面板脚本");

/* ---------- 二、真跑一次导入：只写 title 域 ---------- */
/* 给文件输入塞一个假文件，触发 onTiFileChange → doTiImport */
const fileInput = b.store["ti-file"] || b.document;
const fakeFile = { name: "标题.xlsx", arrayBuffer: async () => new ArrayBuffer(8) };
if (b.store["ti-file"]) b.store["ti-file"].files = [fakeFile];
if (b.store["ti-period-label"]) b.store["ti-period-label"].value = "第44周";
if (b.store["ti-cat"]) b.store["ti-cat"].value = "T恤";
if (b.store["ti-period-date"]) b.store["ti-period-date"].value = "2026-10-28";

await b.win.onTiFileChange();
const parsedTip = (b.store["ti-file-tip"] || {}).textContent || "";
ok(/共 3 行/.test(parsedTip), "应解析出 3 行，实际提示：" + parsedTip);
ok(!/未有标题|带标题：0/.test(parsedTip), "应识别到标题列（组词台全靠标题）");

const before = b.calls.length;
await b.win.doTiImport();
const after = b.calls.slice(before);

const by = (n) => after.filter((c) => c.fn === n);
ok(by("listRankItems").length === 1, "覆盖模式应先读旧数据留底（1 次）");
ok(by("listRankItems").every((c) => c.arg.source === "title"), "留底读取必须带 source=title（只留本域的底）");
ok(by("clearRankSlot").length === 1, "覆盖模式应清空该槽位（1 次）");
ok(by("clearRankSlot").every((c) => c.arg.source === "title"), "清空槽位必须带 source=title");
ok(by("createRankBatch").every((c) => c.arg.source === "title"), "批次记录必须带 source=title");
const ins = by("insertRankItems")[0];
ok(!!ins, "应写入条目");
ok(ins && ins.arg.every((r) => r.source === "title"), "每一条条目都必须带 source=title");
ok(ins && ins.arg.every((r) => !!r.title), "每条都要带标题（否则组词台没有词）");
ok(ins && ins.arg.length === 3, "应有 3 条写入，实际 " + (ins && ins.arg.length));
ok(by("updateRankBatch").every((c) => !!c.arg.id), "写批次统计时要有批次 id");
/* 类目只认后台所选：「T 恤」（表格里）不能变成类目 */
ok(ins && ins.arg.every((r) => r.category === "T恤"), "类目必须取后台所选，不能用表格里的「T 恤」");
ok(ins && ins.arg.some((r) => r.leaf_category === "T 恤"), "表格类目仍应存进 leaf_category 便于追溯");

/* 撤销：只清本域本次槽位 */
const b2 = b.calls.length;
await b.win.doTiUndo();
const undo = b.calls.slice(b2).filter((c) => c.fn === "deleteRankItemsByScope");
ok(undo.length === 1, "撤销应清 1 个槽位");
ok(undo.every((c) => c.arg.source === "title"), "撤销必须带 source=title，不能连带清掉别的专区");

/* ---------- 三、追加模式：查重也只看本域 ---------- */
const b3 = b.calls.length;
const modeRadio = { value: "append" };
b.win.document.querySelector = ((orig) => function (sel) {
  if (String(sel).indexOf('name="ti-mode"') >= 0) return modeRadio;
  return orig.call(this, sel);
})(b.win.document.querySelector);
if (b.store["ti-file"]) b.store["ti-file"].files = [fakeFile];
await b.win.onTiFileChange();
await b.win.doTiImport();
const add = b.calls.slice(b3);
ok(add.filter((c) => c.fn === "listRankSlotUrls").every((c) => c.arg.source === "title"),
  "追加模式的查重必须只查本域已有的图");
ok(add.filter((c) => c.fn === "clearRankSlot").length === 0, "追加模式不应清空槽位");

/* ---------- 四、台账 / 清理 / 自检：都只读本域 ---------- */
const b4 = b.calls.length;
await b.win.loadTiBatches();
ok(b.calls.slice(b4).filter((c) => c.fn === "listRankBatches").every((c) => c.arg === "title"),
  "台账只读 title 域");
const b5 = b.calls.length;
await b.win.doTiSelfCheck();
ok(b.calls.slice(b5).filter((c) => c.fn === "rankSelfCheck").every((c) => c.arg === "title"),
  "数据自检只查 title 域");

/* ---------- 五、趋势上升榜面板：固定 rank，且类目清理只影响本域 ---------- */
const ADM = read("js/admin-rank.js");
ok(/const SOURCE = "rank";/.test(ADM), "趋势上升榜面板应固定写 rank 域");
ok(!/srcSel && srcSel\.value/.test(ADM), "趋势上升榜面板不应再读下拉（下拉会选错）");
ok(/SB\.listRankBatches\(SOURCE\)/.test(ADM), "趋势上升榜台账只读本域");
ok(/只作用于本专区（趋势上升榜）/.test(ADM), "类目清理要说明只影响本专区");
ok(!/作用于全部三个专区/.test(ADM), "类目清理不能再声称影响全部专区");
["deleteRankCategory", "renameRankCategory"].forEach((fn) => {
  const re = new RegExp("SB\\." + fn + "\\([^)]*SOURCE\\)");
  ok(re.test(ADM), fn + " 必须带本域参数，否则会跨专区改动同名类目");
});
ok(/updateRankPeriodData\([^)]*SOURCE\)/.test(ADM), "期次改名必须带本域参数");
ok(/deleteRankPeriod\([^)]*SOURCE\)/.test(ADM), "期次删除必须带本域参数");
ok(/rankSelfCheck\(SOURCE\)/.test(ADM), "数据自检必须带本域参数");

/* ---------- 六、上新节奏面板：固定 rhythm ---------- */
const RHM = read("js/admin-rhythm.js");
ok(/source: "rhythm"/.test(RHM), "上新节奏写入清空要带 rhythm 域");
ok(/SB\.listRankBatches\("rhythm"\)/.test(RHM), "上新节奏台账只读 rhythm 域");
ok(/countRankSlot\(Object\.assign\(\{\}, o, \{ source: "rhythm" \}\)\)/.test(RHM), "上新节奏条数只统计本域");
ok(/updateRankPeriodData\([^)]*"rhythm"\)/.test(RHM), "上新节奏期次改名必须带本域");
ok(/deleteRankPeriod\([^)]*"rhythm"\)/.test(RHM), "上新节奏期次删除必须带本域");

/* ---------- 七、版本戳 ---------- */
const BUILD = (read("js/rhythm.js").match(/var BUILD = "([^"]+)"/) || [])[1];
ok(!!BUILD, "前台 BUILD 常量应存在，实际 " + BUILD);
/* 版本号以代码为准，不再写死：每次发版都硬断言某个字符串，只会把发版卡住 */
/* 每个页面引用的脚本版本都必须等于 BUILD（旧戳会让浏览器一直用缓存） */
["index.html", "rank.html", "rhythm.html", "admin.html"].forEach((f) => {
  const vs = [...read(f).matchAll(/\?v=([0-9A-Za-z]+)/g)].map((m) => m[1]);
  ok(vs.length > 0 && vs.every((v) => v === BUILD), f + " 脚本版本戳应全部为 " + BUILD + "（实际 " + vs.join(",") + "）");
});

console.log("\n=== t_admin_upload_isolation: " + pass + " pass / " + fail + " fail ===");
process.exit(fail ? 1 : 0);
