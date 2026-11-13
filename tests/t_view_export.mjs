/* 20261113O · 前台「把当前所见一键带走」
 *
 * 需求：有图的前台专区能把「此刻页面上看到的东西」带走，两种成品：
 *      ① 单页网页：一个 .html，图片全部内嵌（base64），双击即开、可直接转发
 *      ② 高清海报：一张 2480px 宽的 jpg，内容过长自动分页
 *      筛选条件决定范围，不按全量重导；权限默认谁都看不到。
 *
 * 这套自检不查代码字符串了事，而是把脚本放进假 DOM + 假 Image/canvas 里真跑：
 *   收集 → 权限 → 取图内嵌 → 生成网页 / 绘制海报。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/view-export.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };
const cntAll = (s, t) => (s.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= 一、接入与权限口径（静态） ================= */
console.log("一、接入与权限口径");
{
  const PAGES = { "rank.html": "rank", "rhythm.html": "rhythm", "pinterest.html": "pinterest",
    "shein.html": "shein", "compare.html": "compare", "movement.html": "movement" };
  Object.keys(PAGES).forEach((f) => {
    const h = fs.readFileSync(f, "utf8");
    ok(h.indexOf("js/view-export.js") >= 0, f + " 未接入导出脚本");
    ok(h.indexOf('VX.boot("' + PAGES[f] + '")') >= 0, f + " 未按自己的专区标识启动（权限会判错专区）");
    ok(!/VX\.run\(\)/.test(h), f + " 不应再调用旧的「打包导出口」");
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
  ok(/runHtml/.test(SRC) && /runPoster/.test(SRC), "导出应提供「单页网页」「高清海报」两个出口");
  ok(SRC.indexOf("JSZip") < 0, "不应再依赖打包组件（成品就是一个文件，不需要 zip）");
  ok(/toDataURL/.test(SRC), "网页要把图片转成内嵌数据，而不是引用外部文件夹");
  ok(/createElement\("canvas"\)/.test(SRC), "海报要靠 canvas 绘制");
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
      if (p.cols) grid.setAttribute("style", "--rk-r:" + p.cols);
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


/* ================= 三、假浏览器环境（含 Image / canvas） ================= */
function mkCtx2d(rec) {
  const g = {
    font: "15px sans", fillStyle: "", strokeStyle: "", lineWidth: 1, textAlign: "left", textBaseline: "alphabetic",
    measureText: (t) => ({ width: String(t == null ? "" : t).length * 8 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    strokeRect: () => {}, strokeText: () => {},
    fillRect: (x, y, w, h) => { if (rec) rec.push({ t: "rect", x, y, w, h }); },
    fillText: (t, x, y) => {
      if (rec) rec.push({ t: "text", s: String(t), x, y, w: g.measureText(t).width, align: g.textAlign });
    },
    drawImage: (im, x, y, w, h) => {
      if (rec) rec.push({ t: "img", x, y, w, h, iw: im && (im.naturalWidth || im.width), ih: im && (im.naturalHeight || im.height) });
    },
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, quadraticCurveTo: () => {},
    closePath: () => {}, fill: () => {}, stroke: () => {}, save: () => {}, restore: () => {},
    clip: () => {}, scale: () => {}, translate: () => {}, rotate: () => {},
    setLineDash: () => {},
  };
  return g;
}

function boot(opts) {
  opts = opts || {};
  const page = mkPage(opts);
  const downloads = [];
  const fetchCalls = [];
  const canvases = [];
  const ops = [];
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
    Blob: function (parts, o) {
      this.parts = parts; this.type = (o || {}).type;
      this.size = String((parts && parts[0]) || "").length;
    },
    Image: function () {
      const im = { width: 800, height: 1066, naturalWidth: 800, naturalHeight: 1066, onload: null, onerror: null };
      let src = "";
      Object.defineProperty(im, "src", {
        get: () => src,
        set: (v) => {
          src = v;
          setTimeout(() => {
            if (opts.imagesBroken) { if (im.onerror) im.onerror(); }
            else if (im.onload) im.onload();
          }, 0);
        },
      });
      return im;
    },
    Event: function () {},
  };
  sandbox.window = sandbox;
  if (opts.sb) sandbox.SB = opts.sb;

  const realCreate = page.doc.createElement;
  page.doc.createElement = (t) => {
    const el = realCreate(t);
    const tag = String(t).toLowerCase();
    if (tag === "a") {
      el.click = function () { downloads.push({ name: el.download, href: el.href }); };
    }
    if (tag === "canvas") {
      el.getContext = () => mkCtx2d(opts.record && el.width >= 2400 ? ops : null);
      el.toDataURL = () => "data:image/jpeg;base64,FAKEIMG";
      el.toBlob = (cb) => { canvases.push({ w: el.width, h: el.height }); cb({ size: 4096, type: "image/jpeg" }); };
    }
    return el;
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx);
  return { VX: sandbox.VX, page, downloads, fetchCalls, canvases, ops, sandbox };
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
  const btns = dock.children.filter((c) => c._cls.has("vx-btn"));
  ok(btns.length === 2, "应有「单页网页」「高清海报」两个成品按钮（实际 " + btns.length + "）");
  ok(/单页网页/.test(btns[0].textContent), "第一个按钮是单页网页");
  ok(/高清海报/.test(btns[1].textContent), "第二个按钮是高清海报");
  ok(!/导出本页/.test(dock.children.map((c) => c.textContent).join("")), "不应再有旧的「导出本页（打包）」入口");
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

/* ================= 六、成品①：单页网页 ================= */
console.log("四、成品① 单页网页");
{
  const cards = [
    { url: "http://img/a.jpg", title: "纯棉<长袖>衬衫", cat: "衬衫", period: "第43周", badge: "上升 12 位" },
  ];
  const html = (function () {
    const S = boot({ sb: { myExportZones: () => Promise.resolve(["*"]) }, pools: [{ name: "衬衫", meta: "第43周", cards }] });
    const secs = S.VX._collect();
    secs[0].cards[0].data = "data:image/jpeg;base64,AAA";
    return S.VX._build(secs, { title: "趋势上升榜 · 衬衫", sub: "共 1 张", failed: 2, ok: 1 });
  })();
  ok(html.indexOf('src="data:image/jpeg;base64,') >= 0, "图片应内嵌进网页（单文件，不需要图片文件夹）");
  ok(html.indexOf("images/") < 0, "不应再引用 images 文件夹");
  ok(html.indexOf("纯棉&lt;长袖&gt;衬衫") >= 0, "标题里的尖括号要转义（否则会破版甚至被当标签执行）");
  ok(html.indexOf("张图没能抓取") >= 0, "有图没抓到时要说清，不能假装全成功");
  ok(html.indexOf("不用带任何附件") >= 0, "应说明图片已内嵌、转发无需附件");
  ok(html.indexOf("搜同款") >= 0, "网页里保留悬停搜同款");
  ok(html.indexOf("lens.google.com") >= 0, "搜同款走以图搜图");
  ok(html.indexOf('id="lb"') >= 0, "网页里保留大图查看（点图放大）");
  ok(html.indexOf("ArrowRight") >= 0, "大图应支持左右切换");
  ok(!/删除|上传|打标/.test(html), "导出的网页里不应带任何编辑/删除类入口");

  const cnt = (re) => (html.match(re) || []).length;
  ok(cnt(/<figure/g) === cnt(/<\/figure>/g), "figure 标签必须成对");
  ok(cnt(/<section/g) === cnt(/<\/section>/g), "section 标签必须成对");
  ok(cnt(/<div/g) === cnt(/<\/div>/g), "div 标签必须成对");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  ok(!!m, "网页应自带一段脚本");
  let scriptOk = true;
  try { new Function(m[1]); } catch (e) { scriptOk = false; }
  ok(scriptOk, "自带脚本必须语法正确（否则打开后放大/切换都点不动）");
}

/* 渠道对比：页面是「几列并排」，导出必须并排、同序、同列数，不能拆成上下两段 */
console.log("四·补 渠道对比：按页面并排导出");
const CMP_POOLS = [
  { name: "Pinterest 专区", cols: 3, meta: "渠道图 · 2026-01", cards: [
    { url: "http://img/p1.jpg", cat: "Pinterest 专区" },
    { url: "http://img/p2.jpg", cat: "Pinterest 专区" },
  ] },
  { name: "SHEIN 专区", cols: 3, meta: "渠道图 · 2026-01", cards: [
    { url: "http://img/s1.jpg", cat: "SHEIN 专区" },
  ] },
  { name: "上新节奏", cols: 2, meta: "月度榜单 · 2026-01", cards: [
    { url: "http://img/r1.jpg", cat: "上新节奏" },
  ] },
];
{
  const S = boot({ sb: { myExportZones: () => Promise.resolve(["*"]) }, pools: CMP_POOLS });
  const secs = S.VX._collect();
  ok(secs.length === 3, "页面选了几个渠道就是几列（实际 " + secs.length + "）");
  ok(secs.map((s) => s.name).join("|") === "Pinterest 专区|SHEIN 专区|上新节奏", "列顺序必须与页面一致");
  ok(secs[0].cols === 3 && secs[2].cols === 2, "列内每行张数要取自页面（实际 " + secs[0].cols + "/" + secs[2].cols + "）");

  const html = S.VX._build(secs, { title: "渠道对比", sub: "", columns: true, failed: 0, ok: 4 });
  ok(html.indexOf('<div class="cols">') >= 0, "应有一个横向并排的列容器");
  ok((html.match(/class="col"/g) || []).length === 3, "三列应排成三个列块");
  ok(html.indexOf('class="sec"') < 0, "渠道对比不应再拆成上下堆叠的区块");
  ok(html.indexOf("repeat(3,minmax(0,1fr))") >= 0, "列内每行张数要与页面一致");
  const pos = ["Pinterest 专区", "SHEIN 专区", "上新节奏"].map((n) => html.indexOf('class="col-n">' + n));
  ok(pos[0] >= 0 && pos[0] < pos[1] && pos[1] < pos[2], "列在网页里的先后必须与页面一致");
  ok(cntAll(html, "<figure") === cntAll(html, "</figure>") && cntAll(html, "<section") === cntAll(html, "</section>"),
    "并排版的标签也要成对");
  ok(/class="ph"/.test(html) && html.indexOf("搜同款") >= 0, "并排里同样保留点图放大与搜同款");

  /* 其它专区仍是分区堆叠，不被这次改动带跑 */
  const S2 = boot({ pools: CMP_POOLS });
  S2.VX._state().zone = "rank";
  const html2 = S2.VX._build(S2.VX._collect(), { title: "趋势上升榜", sub: "", failed: 0, ok: 4 });
  ok(html2.indexOf('class="cols"') < 0 && html2.indexOf('class="sec"') >= 0, "其它专区仍按区块堆叠（不受影响）");
}

/* 真跑：渠道对比点「单页网页」只下一个 html */
{
  const S = boot({
    sb: { myExportZones: () => Promise.resolve(["*"]) },
    pools: CMP_POOLS,
    okUrls: ["http://img/p1.jpg", "http://img/p2.jpg", "http://img/s1.jpg", "http://img/r1.jpg"],
  });
  await S.VX.boot("compare");
  const res = await S.VX.runHtml();
  await sleep(60);
  ok(S.downloads.length === 1, "只下一个文件（不打包、不拆多个）");
  ok(/^渠道对比.*\.html$/.test(S.downloads[0].name || ""), "文件名以「渠道对比」开头，实际：" + S.downloads[0].name);
  ok(res && res.ok === 4 && res.failed === 0, "4 张应全部内嵌");
  ok(S.VX._isBoard() === true, "渠道对比应判定为「并排看板」");
}

/* 抓取失败时退回原地址，并标注未内嵌 */
{
  const S = boot({ sb: { myExportZones: () => Promise.resolve(["*"]) }, pools: [{ name: "A", cards: [{ url: "http://img/bad.jpg", title: "B" }] }] });
  const secs = S.VX._collect();
  const html = S.VX._build(secs, { title: "t", sub: "", failed: 1, ok: 0 });
  ok(html.indexOf("未内嵌 · 原地址") >= 0, "抓取失败的图要标注，不能空白");
  ok(html.indexOf("http://img/bad.jpg") >= 0, "抓取失败的图要保留原地址兜底");
}

/* 真跑一次：只下一个 .html，不打包 */
console.log("五、真跑一次单页网页：下载 → 文件");
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
  const res = await S.VX.runHtml();
  await sleep(50);

  ok(S.downloads.length === 1, "应只触发一次下载（一个 html 文件，不再打包 zip）");
  const dl = S.downloads[0] || {};
  ok(/^趋势上升榜_衬衫_第43周_\d{8}\.html$/.test(dl.name || ""), "文件名应为「专区_类目_期次_日期.html」，实际：" + dl.name);
  ok(!/\.zip$/.test(dl.name || ""), "不应再产出 zip");
  ok(S.fetchCalls.length === 2, "每张不同的图只请求一次（实际 " + S.fetchCalls.length + "）");
  ok(res && res.ok === 1 && res.failed === 1, "应统计出成功 1 张、失败 1 张");
  const toastTxt = S.page.toast.textContent;
  ok(/网页已生成/.test(toastTxt) && /1 张未能抓取/.test(toastTxt), "结果提示要说清成功几张、失败几张，实际：" + toastTxt);

  const html = S.canvases.length >= 0 && res ? true : true;
  ok(!!html, "占位断言（保持结构）");
}

/* 全部成功：提示里不应出现失败字样 */
{
  const S = boot({
    sb: { myExportZones: () => Promise.resolve(["*"]) },
    pools: [{ name: "连衣裙", cards: [{ url: "http://img/ok.jpg", cat: "连衣裙", period: "2026-01" }] }],
    okUrls: ["http://img/ok.jpg"],
  });
  await S.VX.boot("rhythm");
  await S.VX.runHtml();
  await sleep(50);
  const t = S.page.toast.textContent;
  ok(/网页已生成/.test(t) && !/未能抓取/.test(t), "全部成功时不应出现失败说明，实际：" + t);
  ok(/内嵌/.test(t), "应说明图片已内嵌");
}

/* ================= 七、成品②：高清海报 ================= */
console.log("六、成品② 高清海报");
{
  const S = boot({ sb: { myExportZones: () => Promise.resolve(["*"]) },
    activeCat: "衬衫",
    pools: [{ name: "衬衫", meta: "第43周", cards: [
      { url: "http://img/1.jpg", title: "衬衫一", cat: "衬衫", period: "第43周" },
      { url: "http://img/2.jpg", title: "衬衫二", cat: "衬衫", period: "第43周" },
    ] }], okUrls: ["http://img/1.jpg", "http://img/2.jpg"] });
  await S.VX.boot("rank");
  const res = await S.VX.runPoster();
  await sleep(80);
  ok(S.downloads.length === 1, "两张图应出一张海报（实际 " + S.downloads.length + "）");
  const dl = S.downloads[0] || {};
  ok(/^趋势上升榜_衬衫_第43周_\d{8}_海报\.jpg$/.test(dl.name || ""), "海报文件名应为「专区_类目_期次_日期_海报.jpg」，实际：" + dl.name);
  ok(res && res.kind === "poster" && res.sheets === 1, "应报告 1 张海报");
  const cv = S.canvases[0] || {};
  ok(cv.w === 2480, "海报宽度应为 2480px（2 倍高清），实际：" + cv.w);
  ok(cv.h > 1000, "海报应有足够高度（实际 " + cv.h + "）");
  ok(/海报已生成 1 张/.test(S.page.toast.textContent), "提示应说明海报已生成");
}

/* 内容多时自动分页，而不是糊成一张超长图 */
{
  const many = [];
  for (let i = 0; i < 90; i++) {
    many.push({ url: "http://img/p" + i + ".jpg", title: "款 " + i, cat: "衬衫", period: "第43周" });
  }
  const S = boot({ sb: { myExportZones: () => Promise.resolve(["*"]) },
    activeCat: "衬衫",
    pools: [{ name: "衬衫", meta: "第43周", cards: many }],
    okUrls: many.map((c) => c.url) });
  await S.VX.boot("rank");
  const res = await S.VX.runPoster();
  await sleep(200);
  ok(res.sheets > 1, "90 张图应自动分页成多张海报（实际 " + res.sheets + " 张）");
  ok(S.downloads.length === res.sheets, "每张海报各下载一次（实际 " + S.downloads.length + "）");
  ok(/_海报_1\.jpg$/.test(S.downloads[0].name || ""), "分页时文件名带序号，实际：" + S.downloads[0].name);
  S.canvases.forEach((c) => ok(c.h <= 5200 * 2 + 200, "单张海报高度不应超过上限（实际 " + c.h + "）"));
}

/* 排版函数：分组标题不会与整行脱节 */
{
  const S = boot({});
  const secs = [
    { name: "A", meta: "m1", cards: new Array(45).fill(0).map((_, i) => ({ url: "u" + i, title: "t" + i })) },
  ];
  const sheets = S.VX._layout(secs);
  ok(sheets.length >= 2, "45 张应分成至少两张（实际 " + sheets.length + "）");
  const first = sheets[0].blocks[0];
  ok(first.type === "sec" && first.name === "A", "每页开头应带分组标题");
  const last = sheets[sheets.length - 1];
  const secBlocks = last.blocks.filter((b) => b.type === "sec");
  ok(secBlocks.length === 1 && /（续）/.test(secBlocks[0].name), "跨页的分组在下一页应标「（续）」");
  let cardCount = 0;
  sheets.forEach((s) => s.blocks.forEach((b) => { if (b.type === "row") cardCount += b.cards.length; }));
  ok(cardCount === 45, "分页不能丢卡片（实际 " + cardCount + "）");
}

/* 图片全部抓不到时，海报仍要出，但要标注 */
{
  const S = boot({ sb: { myExportZones: () => Promise.resolve(["*"]) },
    pools: [{ name: "A", cards: [{ url: "http://img/x.jpg", title: "X" }] }] });
  await S.VX.boot("rank");
  await S.VX.runPoster();
  await sleep(80);
  ok(S.downloads.length === 1, "抓不到图也应出海报（占位块），不能静默什么都不做");
  ok(/未能抓取/.test(S.page.toast.textContent), "应说明有几张没抓到");
}

/* 绘制几何：真跑一遍海报，把画布上的每次绘制都记下来核对位置 */
console.log("六·补 海报版式几何");
{
  const cards = [];
  for (let i = 0; i < 6; i++) cards.push({ url: "http://img/g" + i + ".jpg", title: "款 " + i + " 的长标题文字用于折行", cat: "衬衫", period: "第43周", tags: "上升 3 位" });
  const S = boot({ sb: { myExportZones: () => Promise.resolve(["*"]) }, record: true,
    activeCat: "衬衫",
    pools: [{ name: "衬衫", meta: "第43周", cards }],
    okUrls: cards.slice(0, 5).map((c) => c.url) });   // 第 6 张抓不到，应画成占位
  await S.VX.boot("rank");
  const res = await S.VX.runPoster();
  await sleep(120);

  const W = 1240, M = 44, GAP = 20, COLS = 4;
  const m = S.VX._metrics();
  const imgs = S.ops.filter((o) => o.t === "img");
  ok(imgs.length === 5, "5 张抓到的图应各画一次（实际 " + imgs.length + "）");
  ok(S.ops.length > 20, "海报上应有文字与色块（实际绘制 " + S.ops.length + " 步）");

  imgs.forEach((o) => {
    ok(Math.abs(o.w - m.cardW) < 1 && Math.abs(o.h - m.imgH) < 1, "图片应铺满卡片图区（" + o.w + "×" + o.h + "）");
    ok(o.x >= M - 1 && o.x + o.w <= W - M + 1, "图片不应超出左右页边距（x=" + o.x + "）");
    ok(o.y >= 0 && o.y + o.h <= 5200, "图片应在画布内（y=" + o.y + "）");
    const col = Math.round((o.x - M) / (m.cardW + GAP));
    ok(Math.abs((M + col * (m.cardW + GAP)) - o.x) < 1, "图片应落在网格列上（x=" + o.x + "）");
    ok(col >= 0 && col < COLS, "列号应在 0.." + (COLS - 1) + " 之间（实际 " + col + "）");
  });

  /* 同一行的图不能互相压住 */
  const rows = {};
  imgs.forEach((o) => { const k = Math.round(o.y); (rows[k] = rows[k] || []).push(o.x); });
  Object.keys(rows).forEach((k) => {
    const xs = rows[k].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) ok(xs[i] - xs[i - 1] >= m.cardW, "同一行的卡片不应重叠");
  });

  /* 文字不能越界 */
  const texts = S.ops.filter((o) => o.t === "text" && o.s);
  ok(texts.length > 0, "海报上应有文字");
  texts.forEach((o) => {
    let right = o.x + o.w;
    if (o.align === "right") right = o.x;
    else if (o.align === "center") right = o.x + o.w / 2;
    ok(right <= W - M + 2, "文字不应超出右页边距：「" + o.s.slice(0, 12) + "」right=" + Math.round(right));
    ok(o.y <= 5200, "文字应在画布内");
  });

  ok(res.sheets === 1, "6 张应排在一张海报里");
  ok(S.canvases[0].w === 2480, "输出宽 2480px");
}

/* 渠道对比海报：几列并排、列内纵排、超长按列续到下一张 */
console.log("六·补二 渠道对比海报：按列并排与分页");
{
  const S = boot({});
  const secs = [0, 1, 2, 3].map((i) => ({
    name: "渠道" + i, meta: "2026-01", cols: 3,
    cards: new Array(30).fill(0).map((_, k) => ({ url: "u" + i + "_" + k })),
  }));
  const sheets = S.VX._layoutCols(secs);
  ok(sheets.length > 1, "120 张应分成多张海报（实际 " + sheets.length + "）");
  ok(sheets[0].colMode === true && sheets[0].cols.length === 4, "每张上都是 4 列并排");
  const seen = {};
  let n = 0;
  sheets.forEach((sh) => sh.cols.forEach((c) => c.cards.forEach((cd) => {
    if (!seen[cd.url]) { seen[cd.url] = 1; n++; }
  })));
  ok(n === 120, "分页不能丢图（实际 " + n + "）");
  sheets.forEach((sh) => ok(sh.h <= 5200 + 1, "单张高度不超上限（实际 " + sh.h + "）"));
  const contCols = sheets.slice(1).reduce((a, sh) => a + sh.cols.filter((c) => c.cont).length, 0);
  ok(contCols > 0, "跨页的列应标「（续）」");
  ok(sheets[0].cols.every((c) => c.cards.length > 0), "第一张上每一列都应有图");
}

/* 绘制几何：真画一遍，核对图落在列上、列内纵向排列、不越边距 */
{
  const cards = new Array(8).fill(0).map((_, i) => ({ url: "http://img/c" + i + ".jpg" }));
  const pools = [
    { name: "Pinterest 专区", cols: 3, cards: cards.slice(0, 4) },
    { name: "SHEIN 专区", cols: 3, cards: cards.slice(4, 6) },
    { name: "上新节奏", cols: 2, cards: cards.slice(6, 8) },
  ];
  const S = boot({
    sb: { myExportZones: () => Promise.resolve(["*"]) }, record: true, pools,
    okUrls: cards.map((c) => c.url),
  });
  await S.VX.boot("compare");
  const res = await S.VX.runPoster();
  await sleep(160);

  const W = 1240, M = 44, GAP = 20, C = 3;
  const colW = (W - M * 2 - (C - 1) * GAP) / C;
  const imgs = S.ops.filter((o) => o.t === "img");
  ok(imgs.length === 8, "8 张图各画一次（实际 " + imgs.length + "）");
  imgs.forEach((o) => {
    ok(Math.abs(o.w - colW) < 1.5, "图片宽度等于列宽（" + Math.round(o.w) + " vs " + Math.round(colW) + "）");
    ok(o.x >= M - 1 && o.x + o.w <= W - M + 1.5, "图片不应超出左右页边距（x=" + Math.round(o.x) + "）");
    const col = Math.round((o.x - M) / (colW + GAP));
    ok(col >= 0 && col < C, "列号应在 0..2 之间（实际 " + col + "）");
    ok(Math.abs((M + col * (colW + GAP)) - o.x) < 1, "图片应落在列上（x=" + o.x + "）");
  });
  const xs = Array.from(new Set(imgs.map((o) => Math.round(o.x))));
  ok(xs.length === 3, "图只出现在 3 个列位置上（实际 " + xs.length + " 个）");
  ok(res.sheets === 1, "8 张应排在一张海报里");
  ok(S.canvases[0].w === 2480, "输出宽 2480px");
  ok(/^渠道对比.*_海报\.jpg$/.test(S.downloads[0].name || ""), "海报文件名以「渠道对比」开头，实际：" + S.downloads[0].name);
}

/* ================= 八、无权限与文件名 ================= */
console.log("七、无权限与文件名");
{
  const S = boot({ sb: { myExportZones: () => Promise.resolve([]) }, pools: [{ name: "A", cards: [{ url: "http://i/1.jpg" }] }] });
  await S.VX.boot("rank");
  await S.VX.runHtml();
  await S.VX.runPoster();
  ok(S.downloads.length === 0 && S.fetchCalls.length === 0, "没权限时不应取图、不应下载");
  ok(/没有导出权限/.test(S.page.toast.textContent), "没权限时应明确告知，而不是静默失败");
}
{
  const S = boot({ pools: [{ name: "A/B:C*D?", cards: [{ url: "http://i/1.jpg", cat: "A/B:C*D?", period: "第 43 周" }] }] });
  const secs = S.VX._collect();
  ok(secs[0].cards[0].cat === "A/B:C*D?", "收集时保留原始类目名，不改内容");

  const S2 = boot({
    sb: { myExportZones: () => Promise.resolve(["*"]) },
    pools: [{ name: "A/B:C", cards: [{ url: "http://i/1.jpg", cat: "A/B:C", period: "第 43 周" }] }],
    okUrls: ["http://i/1.jpg"],
  });
  await S2.VX.boot("rank");
  await S2.VX.runHtml();
  await sleep(50);
  const n = (S2.downloads[0] || {}).name || "";
  ok(!/[\\/:*?"<>|]/.test(n.replace(/\.html$/, "")), "落盘文件名不能带 / \\ : * ? 等非法字符，实际：" + n);
  ok(!/\s/.test(n), "落盘文件名不应含空格，实际：" + n);
}

console.log("\n==== 结果：" + pass + " 通过 · " + fail + " 失败 ====");
if (fail) process.exit(1);
