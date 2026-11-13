/* 20261113N · 前台「按当前所见导出」
 *
 * 需求：有图的前台专区能把「此刻页面上看到的东西」带走 ——
 *      一份 HTML（版式照页面）+ 一批高清图片；筛选条件决定范围，不按全量重导。
 *      权限：默认谁都看不到；超管始终可导出；管理员需后台逐个专区勾选。
 *
 * 这套自检不查代码字符串了事，而是把脚本放进假 DOM 里真跑：
 *   收集 → 权限 → 下载 → 打包 → HTML 里到底有什么。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/view-export.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= 一、接入与权限口径（静态） ================= */
console.log("一、接入与权限口径");
{
  const PAGES = { "rank.html": "rank", "rhythm.html": "rhythm", "pinterest.html": "pinterest",
    "shein.html": "shein", "compare.html": "compare", "movement.html": "movement" };
  Object.keys(PAGES).forEach((f) => {
    const h = fs.readFileSync(f, "utf8");
    ok(h.indexOf("js/view-export.js") >= 0, f + " 未接入导出脚本");
    ok(h.indexOf("vendor/jszip.min.js") >= 0, f + " 未引入打包组件（导出会退化成只给 HTML）");
    ok(h.indexOf('VX.boot("' + PAGES[f] + '")') >= 0, f + " 未按自己的专区标识启动（权限会判错专区）");
  });
  const sb = fs.readFileSync("js/supabase.js", "utf8");
  ok(/myExportZones/.test(sb), "缺少读取「我的导出权限」的接口");
  ok(/setUserExportZones/.test(sb), "缺少后台写入导出权限的接口");
  ok(/export_zones/.test(sb), "导出权限应存在站点设置的字典里（不建表、不跑 SQL）");
  ok(/super_admin"\) return \["\*"\]/.test(sb) || /return \["\*"\]/.test(sb), "超管应始终可导出");
  const perm = fs.readFileSync("js/admin-perm.js", "utf8");
  ok(/PERM_EXPORT_ZONES/.test(perm), "后台权限管理应有可导出专区清单");
  ok(/setUserExportZones\(uid, exportZones\)/.test(perm), "后台保存时应写入导出权限");
  ok(!/visual"\s*,\s*label:\s*"视觉专区"[\s\S]{0,40}EXPORT/.test(perm), "未实现导出的专区不应出现在勾选框里");
}

/* ================= 二、假 DOM ================= */
function mkEl(tag, attrs, cls) {
  const e = {
    tagName: String(tag || "div").toUpperCase(),
    _attrs: Object.assign({}, attrs || {}),
    _cls: new Set(String(cls || "").split(/\s+/).filter(Boolean)),
    children: [], parentElement: null, parentNode: null,
    style: {}, textContent: "", disabled: false,
  };
  let cn = String(cls || "");
  Object.defineProperty(e, "className", {
    get: () => cn, set: (v) => { cn = String(v); e._cls = new Set(cn.split(/\s+/).filter(Boolean)); },
  });
  Object.defineProperty(e, "innerHTML", { get() { return e._h || ""; }, set(v) { e._h = String(v); } });
  e.classList = {
    add: (c) => e._cls.add(c), remove: (c) => e._cls.delete(c),
    contains: (c) => e._cls.has(c), toggle: (c, on) => { on ? e._cls.add(c) : e._cls.delete(c); },
  };
  e.setAttribute = (k, v) => { e._attrs[k] = String(v); };
  e.getAttribute = (k) => (k in e._attrs ? e._attrs[k] : null);
  e.appendChild = (c) => { e.children.push(c); c.parentElement = e; c.parentNode = e; return c; };
  e.remove = () => { if (e.parentElement) e.parentElement.children = e.parentElement.children.filter((x) => x !== e); };
  e.addEventListener = () => {};
  e.querySelector = (s) => qs(e, s);
  e.querySelectorAll = (s) => qsa(e, s);
  e.click = () => { e._clicked = true; };
  e.closest = (sel) => {
    let p = e;
    while (p) { if (sel.split(",").some((s) => matchSimple(p, s.trim()))) return p; p = p.parentElement; }
    return null;
  };
  return e;
}

function matchSimple(el, sel) {
  if (!el || !sel) return false;
  let s = sel.trim();
  let tag = null, id = null, attrs = [], cls = [];
  s = s.replace(/\[([^\]]+)\]/g, (m, g) => {
    const mm = g.split("=");
    attrs.push([mm[0].trim(), mm[1] == null ? null : mm[1].replace(/^["']|["']$/g, "")]);
    return "";
  });
  s = s.replace(/#([\w-]+)/g, (m, g) => { id = g; return ""; });
  s = s.replace(/\.([\w-]+)/g, (m, g) => { cls.push(g); return ""; });
  const t = s.trim();
  if (t) tag = t.toUpperCase();
  if (tag && el.tagName !== tag) return false;
  if (id && el._attrs.id !== id) return false;
  for (const c of cls) if (!el._cls.has(c)) return false;
  for (const [k, v] of attrs) {
    if (!(k in el._attrs)) return false;
    if (v != null && String(el._attrs[k]) !== v) return false;
  }
  return true;
}
function parseSel(sel) {
  const toks = [];
  let cur = "", b = 0, comb = " ";
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === "[") b++;
    if (ch === "]") b--;
    if (b === 0 && (ch === " " || ch === ">")) {
      if (cur) { toks.push({ comb, s: cur }); cur = ""; comb = " "; }
      if (ch === ">") comb = ">";
      continue;
    }
    cur += ch;
  }
  if (cur) toks.push({ comb, s: cur });
  return toks;
}
function matchChain(el, toks, i) {
  if (!matchSimple(el, toks[i].s)) return false;
  if (i === 0) return true;
  if (toks[i].comb === ">") return el.parentElement ? matchChain(el.parentElement, toks, i - 1) : false;
  let p = el.parentElement;
  while (p) { if (matchChain(p, toks, i - 1)) return true; p = p.parentElement; }
  return false;
}
function descendants(root) {
  const out = [];
  const walk = (n) => { n.children.forEach((c) => { out.push(c); walk(c); }); };
  walk(root);
  return out;
}
function qsa(root, selector) {
  const sels = selector.split(",").map((s) => s.trim()).filter(Boolean).map(parseSel);
  const all = descendants(root);
  return all.filter((el) => sels.some((toks) => matchChain(el, toks, toks.length - 1)));
}
function qs(root, selector) { return qsa(root, selector)[0] || null; }

/* ================= 三、造页面 ================= */
function mkPage(opts) {
  opts = opts || {};
  const body = mkEl("body");
  const doc = {
    readyState: "complete", body,
    createElement: (t) => mkEl(t),
    querySelector: (s) => qs(body, s),
    querySelectorAll: (s) => qsa(body, s),
    getElementById: (id) => qs(body, "#" + id),
  };
  // toast
  const toast = mkEl("div", { id: "toast" }, "toast");
  body.appendChild(toast);
  if (opts.pools) {
    const wrap = mkEl("div", {}, "rk-pools");
    body.appendChild(wrap);
    opts.pools.forEach((p) => {
      const sec = mkEl("section", { "data-src": p.name }, "rk-pool");
      const head = mkEl("div", {}, "rk-pool-head");
      const nm = mkEl("div", {}, "rk-pool-name");
      const sp = mkEl("span"); sp.textContent = p.name + " ";
      const n = mkEl("span", {}, "rk-n"); n.textContent = (p.cards || []).length + " 张";
      nm.appendChild(sp); nm.appendChild(n);
      const meta = mkEl("div", {}, "rk-pool-meta");
      meta.textContent = p.meta || "";
      head.appendChild(nm); head.appendChild(meta);
      sec.appendChild(head);
      const grid = mkEl("div", {}, "rk-pool-grid");
      (p.cards || []).forEach((c) => {
        const fig = mkEl("figure", { "data-url": c.url, "data-title": c.title || "", "data-cat": c.cat || "",
          "data-site": c.site || "", "data-period": c.period || "", "data-tags": c.tags || "" }, "rk-card");
        const im = mkEl("img"); im.setAttribute("src", c.url); im.setAttribute("alt", c.alt || "");
        fig.appendChild(im);
        if (c.badge) { const b = mkEl("span", {}, "rk-badge"); b.textContent = c.badge; fig.appendChild(b); }
        grid.appendChild(fig);
      });
      sec.appendChild(grid);
      wrap.appendChild(sec);
    });
  }
  if (opts.mvs) {
    const grid = mkEl("div", {}, "grid");
    body.appendChild(grid);
    opts.mvs.forEach((m) => {
      const card = mkEl("div", {}, "mv-card");
      const box = mkEl("div", {}, "mv-card-img");
      const im = mkEl("img"); im.setAttribute("src", m.url); im.setAttribute("alt", m.alt || "");
      box.appendChild(im);
      const meta = mkEl("div", {}, "mv-card-meta");
      const cat = mkEl("span", {}, "mv-card-cat"); cat.textContent = m.cat || "";
      meta.appendChild(cat);
      card.appendChild(box); card.appendChild(meta);
      grid.appendChild(card);
    });
  }
  if (opts.activeCat) {
    const menu = mkEl("nav", {}, "cat-menu");
    const it = mkEl("button", {}, "cat-menu-item active");
    it.textContent = opts.activeCat + " 12";
    menu.appendChild(it);
    body.appendChild(menu);
  }
  return { doc, body, toast };
}

function boot(opts) {
  opts = opts || {};
  const page = mkPage(opts);
  const zip = { files: {}, folders: {} };
  const downloads = [];
  const fetchCalls = [];
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, isNaN, encodeURIComponent, decodeURIComponent, parseInt, parseFloat,
    document: page.doc,
    fetch: (url) => {
      fetchCalls.push(url);
      const okUrl = opts.okUrls || [];
      if (okUrl.indexOf(url) >= 0) {
        return Promise.resolve({ ok: true, blob: () => Promise.resolve({ size: 12, type: "image/jpeg" }) });
      }
      return Promise.reject(new Error("cors"));
    },
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
    Blob: function (parts, o) { this.parts = parts; this.type = (o || {}).type; this.size = 10; },
    JSZip: function () {
      this.file = (n, c) => { zip.files[n] = c; return this; };
      this.folder = (n) => {
        const f = { file: (fn, c) => { zip.folders[n + "/" + fn] = c; } };
        return f;
      };
      this.generateAsync = () => Promise.resolve({ _zip: true });
    },
    Event: function () {},
  };
  sandbox.window = sandbox;
  if (opts.sb) sandbox.SB = opts.sb;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx);
  // 记录下载动作
  const realCreate = page.doc.createElement;
  page.doc.createElement = (t) => {
    const el = realCreate(t);
    if (String(t).toLowerCase() === "a") {
      el.click = function () { downloads.push({ name: el.download, href: el.href }); };
    }
    return el;
  };
  return { VX: sandbox.VX, page, zip, downloads, fetchCalls, sandbox };
}

/* ================= 四、收集：所见即所得 ================= */
console.log("二、收集当前所见");
{
  const S = boot({ pools: [
    { name: "男装休闲衬衫", meta: "月度榜单 · 第43周", cards: [
      { url: "http://img/a.jpg", title: "纯棉长袖衬衫", cat: "男装休闲衬衫", site: "US", period: "第43周", badge: "趋势爆款" },
      { url: "http://img/b.jpg", title: "条纹衬衫", cat: "男装休闲衬衫", period: "第43周" },
      { url: "http://img/a.jpg", title: "重复图", cat: "男装休闲衬衫", period: "第43周" },
    ] },
    { name: "空列", meta: "", cards: [] },
    { name: "女装连衣裙", meta: "渠道图", cards: [
      { url: "http://img/c.jpg", title: "碎花连衣裙", cat: "女装连衣裙", period: "第43周" },
    ] },
  ] });
  const secs = S.VX._collect();
  ok(secs.length === 2, "空列不应出现在导出里（与页面一致）");
  ok(secs[0].name === "男装休闲衬衫", "分组名取页面上那一列的名字");
  ok(secs[0].meta.indexOf("第43周") >= 0, "分组副信息要带上期次");
  ok(secs[0].cards.length === 2, "同一列里重复的图只收一次");
  ok(secs[0].cards[0].title === "纯棉长袖衬衫", "卡片标题要带过来");
  ok(secs[0].cards[0].tags.indexOf("趋势爆款") >= 0, "卡片上的标签要带过来");
  ok(secs[1].name === "女装连衣裙", "第二列独立成组");
}

/* 纯图墙（Pinterest / SHEIN / 品牌动向）：没有分组列，整页一节 */
{
  const S = boot({ mvs: [
    { url: "http://img/m1.jpg", alt: "针织开衫", cat: "针织衫" },
    { url: "http://img/m2.jpg", alt: "半身裙", cat: "半身裙" },
  ], activeCat: "全部" });
  const secs = S.VX._collect();
  ok(secs.length === 1, "纯图墙整页算一节");
  ok(secs[0].cards.length === 2, "纯图墙应收集到全部图片卡");
  ok(secs[0].cards[0].title === "针织开衫", "纯图墙用 alt 当标题");
  ok(secs[0].cards[0].cat === "针织衫", "纯图墙要带上类目");
}

/* 没有任何图片时不能假装成功 */
{
  const S = boot({});
  ok(S.VX._collect().length === 0, "没有图片时收集结果为空");
}

/* ================= 五、权限 ================= */
console.log("三、权限：默认看不到按钮");
await sleep(10);
{
  const S = boot({ sb: { myExportZones: () => Promise.resolve([]) }, pools: [{ name: "A", cards: [{ url: "http://i/1.jpg" }] }] });
  const got = await S.VX.boot("rank");
  ok(got === false, "没被授权的账号不应获得导出权限");
  ok(S.VX.available() === false, "没权限时状态应为不可导出");
  const dock = S.page.body.children.filter((c) => c._cls.has("vx-dock"))[0];
  ok(!dock || !dock._cls.has("on"), "没权限时不应显示导出入口");
}
{
  const S = boot({ sb: { myExportZones: () => Promise.resolve(["rank"]) }, pools: [{ name: "A", cards: [{ url: "http://i/1.jpg" }] }] });
  await S.VX.boot("rank");
  const dock = S.page.body.children.filter((c) => c._cls.has("vx-dock"))[0];
  ok(S.VX.available() === true && dock._cls.has("on"), "被授权本专区时应显示导出入口");
}
{
  const S = boot({ sb: { myExportZones: () => Promise.resolve(["shein"]) }, pools: [{ name: "A", cards: [{ url: "http://i/1.jpg" }] }] });
  await S.VX.boot("rank");
  ok(S.VX.available() === false, "只授权了别的专区，本页不应出现按钮");
}
{
  const S = boot({ sb: { myExportZones: () => Promise.resolve(["*"]) }, pools: [{ name: "A", cards: [{ url: "http://i/1.jpg" }] }] });
  await S.VX.boot("compare");
  ok(S.VX.available() === true, "超管（*）在任何专区都应可导出");
}
{
  const S = boot({ sb: { myExportZones: () => Promise.reject(new Error("net")) }, pools: [{ name: "A", cards: [{ url: "http://i/1.jpg" }] }] });
  await S.VX.boot("rank");
  ok(S.VX.available() === false, "权限查询失败时应按「无权限」处理（不能放开）");
}

/* ================= 六、HTML 里到底有什么 ================= */
console.log("四、导出的 HTML");
{
  const cards = [
    { url: "http://img/a.jpg", title: "纯棉<长袖>衬衫", cat: "衬衫", period: "第43周", badge: "上升 12 位" },
  ];
  const html = (function () {
    const S = boot({ sb: { myExportZones: () => Promise.resolve(["*"]) }, pools: [{ name: "衬衫", meta: "第43周", cards }] });
    const secs = S.VX._collect();
    secs[0].cards[0].file = "衬衫_第43周_01.jpg";
    return S.VX._build(secs, { title: "趋势上升榜 · 衬衫", sub: "共 1 张", failed: 2, ok: 1 });
  })();
  ok(html.indexOf("images/衬衫_第43周_01.jpg") >= 0, "下载成功的图应指向 images 文件夹里的本地文件");
  ok(html.indexOf("纯棉&lt;长袖&gt;衬衫") >= 0, "标题里的尖括号要转义（否则会破版甚至被当标签执行）");
  ok(html.indexOf("有 2 张图没能下载") >= 0, "有图没下载时要如实说明，不能假装全成功");
  ok(html.indexOf("搜同款") >= 0, "HTML 里保留悬停搜同款");
  ok(html.indexOf("lens.google.com") >= 0, "搜同款走以图搜图");
  ok(html.indexOf('id="lb"') >= 0, "HTML 里保留大图查看（点图放大）");
  ok(html.indexOf("ArrowRight") >= 0, "大图应支持左右切换");
  ok(!/删除|上传|打标/.test(html), "导出的 HTML 里不应带任何编辑/删除类入口");
  ok(html.indexOf("trendbank") < 0, "不应把整站样式带进来（单文件自带样式）");

  /* 结构完整性：标签成对、自带脚本能通过语法检查（否则双击打开是一片空白） */
  const cnt = (re) => (html.match(re) || []).length;
  ok(cnt(/<figure/g) === cnt(/<\/figure>/g), "figure 标签必须成对");
  ok(cnt(/<section/g) === cnt(/<\/section>/g), "section 标签必须成对");
  ok(cnt(/<div/g) === cnt(/<\/div>/g), "div 标签必须成对");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  ok(!!m, "导出的 HTML 应自带一段脚本");
  let scriptOk = true;
  try { new Function(m[1]); } catch (e) { scriptOk = false; }
  ok(scriptOk, "自带脚本必须语法正确（否则打开后放大/切换都点不动）");
  ok(html.indexOf("images/") < html.indexOf("<script>"), "图片引用应在正文里，不在脚本里");
}

/* ================= 七、真跑一次导出 ================= */
console.log("五、真跑一次：下载 → 打包 → 文件命名");
{
  const cards = [
    { url: "http://img/ok1.jpg", title: "衬衫A", cat: "衬衫", period: "第43周" },
    { url: "http://img/ok1.jpg", title: "衬衫A重复", cat: "衬衫", period: "第43周" },
    { url: "http://img/bad.jpg", title: "衬衫B", cat: "衬衫", period: "第43周" },
  ];
  const S = boot({
    sb: { myExportZones: () => Promise.resolve(["*"]) },
    pools: [{ name: "衬衫", meta: "第43周", cards }],
    activeCat: "衬衫",
    okUrls: ["http://img/ok1.jpg"],
  });
  await S.VX.boot("rank");
  await S.VX.run();
  await sleep(30);

  ok(S.downloads.length === 1, "应触发一次下载（一个 zip）");
  const dl = S.downloads[0] || {};
  ok(/^趋势上升榜_衬衫_第43周_\d{8}\.zip$/.test(dl.name || ""), "文件名应为「专区_类目_期次_日期.zip」，实际：" + dl.name);
  const htmlName = Object.keys(S.zip.files)[0] || "";
  ok(/\.html$/.test(htmlName), "zip 里应有一个 HTML");
  const imgs = Object.keys(S.zip.folders);
  ok(imgs.length === 1, "同一张图出现两次只下载/打包一次（实际 " + imgs.length + "）");
  ok(/^images\/衬衫_第43周_\d+\.jpg$/.test(imgs[0] || ""), "图片按「类目_期次_序号」命名，实际：" + imgs[0]);
  ok(S.fetchCalls.length === 2, "每张不同的图只请求一次（实际 " + S.fetchCalls.length + "）");

  const html = S.zip.files[htmlName] || "";
  ok(html.indexOf("images/") >= 0, "HTML 里应指向本地图片");
  ok(html.indexOf("未下载 · 原地址") >= 0, "抓取失败的图要标注，不能空白");
  ok(html.indexOf("http://img/bad.jpg") >= 0, "抓取失败的图要保留原地址兜底");
  ok(/有 1 张图没能下载/.test(html), "HTML 顶部应说明有几张没下载下来");
  const toastTxt = S.page.toast.textContent;
  ok(/已导出/.test(toastTxt) && /1 张未能下载/.test(toastTxt), "结果提示要说清成功几张、失败几张，实际：" + toastTxt);
}

/* 全部成功时不应出现「未下载」字样 */
{
  const S = boot({
    sb: { myExportZones: () => Promise.resolve(["*"]) },
    pools: [{ name: "连衣裙", cards: [{ url: "http://img/ok.jpg", cat: "连衣裙", period: "2026-01" }] }],
    okUrls: ["http://img/ok.jpg"],
  });
  await S.VX.boot("rhythm");
  await S.VX.run();
  await sleep(30);
  const html = S.zip.files[Object.keys(S.zip.files)[0]] || "";
  ok(html.indexOf("未能下载") < 0, "全部下载成功时不应出现失败说明");
  ok(S.page.toast.textContent.indexOf("1 张图片 + HTML") >= 0, "提示应给出成功张数");
}

/* 跨分组的重复图：只下载一次、只打包一次，但两处都要能显示 */
{
  const S = boot({
    sb: { myExportZones: () => Promise.resolve(["*"]) },
    pools: [
      { name: "衬衫", cards: [{ url: "http://img/same.jpg", cat: "衬衫", period: "第43周" }] },
      { name: "连衣裙", cards: [{ url: "http://img/same.jpg", cat: "连衣裙", period: "第43周" }] },
    ],
    okUrls: ["http://img/same.jpg"],
  });
  await S.VX.boot("rank");
  await S.VX.run();
  await sleep(30);
  ok(S.fetchCalls.length === 1, "跨分组同款只请求一次（实际 " + S.fetchCalls.length + "）");
  ok(Object.keys(S.zip.folders).length === 1, "跨分组同款只打包一份图（实际 " + Object.keys(S.zip.folders).length + "）");
  const html = S.zip.files[Object.keys(S.zip.files)[0]] || "";
  const hits = (html.match(/src="images\//g) || []).length;
  ok(hits === 2, "两处卡片都要指向同一张本地图（实际 " + hits + " 处）");
}

/* 没有权限时点导出：必须什么都不做 */
{
  const S = boot({ sb: { myExportZones: () => Promise.resolve([]) }, pools: [{ name: "A", cards: [{ url: "http://i/1.jpg" }] }] });
  await S.VX.boot("rank");
  await S.VX.run();
  ok(S.downloads.length === 0 && S.fetchCalls.length === 0, "没权限时不应下载任何东西、不应打包");
  ok(/没有导出权限/.test(S.page.toast.textContent), "没权限时应明确告知，而不是静默失败");
}

/* ================= 八、文件名清洗 ================= */
console.log("六、文件名清洗");
{
  const S = boot({ pools: [{ name: "A/B:C*D?", cards: [{ url: "http://i/1.jpg", cat: "A/B:C*D?", period: "第 43 周" }] }] });
  const secs = S.VX._collect();
  ok(secs[0].cards[0].cat === "A/B:C*D?", "收集时保留原始类目名，不改内容");
  // 真正落盘时通过一次导出验证会被清洗
  const S2 = boot({
    sb: { myExportZones: () => Promise.resolve(["*"]) },
    pools: [{ name: "A/B:C", cards: [{ url: "http://i/1.jpg", cat: "A/B:C", period: "第 43 周" }] }],
    okUrls: ["http://i/1.jpg"],
  });
  await S2.VX.boot("rank");
  await S2.VX.run();
  await sleep(30);
  const n = Object.keys(S2.zip.folders)[0] || "";
  const base = n.replace(/^images\//, "");
  ok(!/[\\/:*?"<>|]/.test(base), "落盘文件名不能带 / \\ : * ? 等非法字符，实际：" + n);
  ok(!/\s/.test(base), "落盘文件名不应含空格，实际：" + base);
}

console.log("\n==== 结果：" + pass + " 通过 · " + fail + " 失败 ====");
if (fail) process.exit(1);
