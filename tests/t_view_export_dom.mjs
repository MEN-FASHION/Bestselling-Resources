/* 20261113U · 前台「单页网页」改为「把页面那一段 DOM 原样搬走」
 *
 * 之前的做法是按采集到的卡片重新画一遍，于是页面上真实存在的东西会被漏掉：
 *   · 图上压着的位次角标、国家角标
 *   · 列头（周次 · N 张）与列副标题
 *   · 列上方的体征卡
 *   · 每行到底摆几张（--rk-r 由脚本按列宽算出来写进内联样式）
 * 这套自检用假 DOM 真跑一遍：克隆 → 去控件 → 图片内嵌 → 带上站点样式表，
 * 然后断言「页面上有什么，导出里就有什么」「能点的控件一个都不留」。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/view-export.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

/* ================= 一、极简 DOM（带 cloneNode / outerHTML） ================= */
const VOID = { IMG: 1, INPUT: 1, BR: 1, HR: 1, META: 1, LINK: 1 };

function mkEl(tag, attrs, cls) {
  const e = {
    tagName: String(tag || "div").toUpperCase(),
    _attrs: Object.assign({}, attrs || {}),
    _cls: new Set(String(cls || "").split(/\s+/).filter(Boolean)),
    children: [], parentElement: null, parentNode: null,
    style: { _p: {}, setProperty(k, v) { this._p[k] = String(v); }, getPropertyValue(k) { return this._p[k] || ""; } },
    textContent: "", _h: "",
  };
  Object.defineProperty(e, "className", {
    get: () => Array.from(e._cls).join(" "),
    set: (v) => { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  Object.defineProperty(e, "innerHTML", { get: () => e._h, set: (v) => { e._h = String(v); } });
  e.classList = {
    add: (c) => e._cls.add(c), remove: (c) => e._cls.delete(c), contains: (c) => e._cls.has(c),
  };
  e.setAttribute = (k, v) => { e._attrs[k] = String(v); };
  e.getAttribute = (k) => (k in e._attrs ? e._attrs[k] : null);
  e.removeAttribute = (k) => { delete e._attrs[k]; };
  e.hasAttribute = (k) => k in e._attrs;
  e.appendChild = (c) => { e.children.push(c); c.parentElement = e; c.parentNode = e; return c; };
  e.remove = () => { if (e.parentElement) e.parentElement.children = e.parentElement.children.filter((x) => x !== e); };
  e.getBoundingClientRect = () => ({ width: 1180, height: 600 });
  e.addEventListener = () => {};
  e.cloneNode = (deep) => {
    const c = mkEl(e.tagName, Object.assign({}, e._attrs), Array.from(e._cls).join(" "));
    c.textContent = e.textContent;
    c._h = e._h;
    if (deep) e.children.forEach((ch) => c.appendChild(ch.cloneNode(true)));
    return c;
  };
  Object.defineProperty(e, "outerHTML", {
    get() {
      const tag = e.tagName.toLowerCase();
      const cls = Array.from(e._cls).join(" ");
      const bag = Object.assign({}, e._attrs);
      if (cls) bag.class = cls;
      const attrs = Object.keys(bag).map((k) => " " + k + '="' + String(bag[k]).replace(/"/g, "&quot;") + '"').join("");
      if (VOID[e.tagName]) return "<" + tag + attrs + ">";
      const inner = e._h || (e.textContent || "") + e.children.map((c) => c.outerHTML).join("");
      return "<" + tag + attrs + ">" + inner + "</" + tag + ">";
    },
  });
  e.querySelector = (s) => qsa(e, s)[0] || null;
  e.querySelectorAll = (s) => qsa(e, s);
  e.closest = () => null;
  return e;
}

function matchSimple(el, sel) {
  let s = String(sel || "").trim();
  if (!s || !el) return false;
  let tag = null, id = null;
  const attrs = [], cls = [];
  s = s.replace(/\[([^\]]+)\]/g, (m, g) => { attrs.push(g.trim()); return ""; });
  s = s.replace(/#([\w-]+)/g, (m, g) => { id = g; return ""; });
  s = s.replace(/\.([\w-]+)/g, (m, g) => { cls.push(g); return ""; });
  const t = s.trim();
  if (t) tag = t.toUpperCase();
  if (tag && el.tagName !== tag) return false;
  if (id && el._attrs.id !== id) return false;
  for (const c of cls) if (!el._cls.has(c)) return false;
  for (const a of attrs) if (!(a in el._attrs)) return false;
  return true;
}
function descendants(root) {
  const out = [];
  const walk = (n) => { n.children.forEach((c) => { out.push(c); walk(c); }); };
  walk(root);
  return out;
}
function qsa(root, selector) {
  const sels = String(selector).split(",").map((s) => s.trim()).filter(Boolean);
  return descendants(root).filter((el) => sels.some((s) => matchSimple(el, s)));
}

/* ================= 二、造一个「趋势上升榜 43-45 周 · 卫衣」的页面 ================= */
const CSS_MARK = "/*__PAGE_CSS_MARK__*/";
function mkPage(opts) {
  opts = opts || {};
  const body = mkEl("body", {}, "front");
  const doc = {
    readyState: "complete", body, title: "趋势上升榜 · TREND BANK",
    createElement: (t) => mkEl(t),
    querySelector: (s) => qsa(body, s)[0] || null,
    querySelectorAll: (s) => qsa(body, s),
    getElementById: (id) => qsa(body, "#" + id)[0] || null,
  };
  const toast = mkEl("div", { id: "toast" }, "toast"); body.appendChild(toast);

  const root = mkEl("div", { id: "rk-body" }, "rk-body");
  body.appendChild(root);

  /* 体征卡：页面上真实存在，之前重画卡片时整块丢掉了 */
  const vit = mkEl("div", {}, "rk-vitals");
  const one = mkEl("div", {}, "rk-vit");
  const vh = mkEl("div", {}, "rk-vit-h");
  const vn = mkEl("span", {}, "rk-vit-name"); vn.textContent = "第43周";
  vh.appendChild(vn); one.appendChild(vh);
  vit.appendChild(one); root.appendChild(vit);

  const pools = mkEl("div", { id: "rk-pools" }, "rk-pools");
  root.appendChild(pools);
  (opts.weeks || ["第43周", "第44周", "第45周"]).forEach((w, wi) => {
    const sec = mkEl("section", {}, "rk-pool");
    const head = mkEl("div", {}, "rk-pool-head");
    const nm = mkEl("div", {}, "rk-pool-name");
    const sp = mkEl("span"); sp.textContent = w + " ";
    const n = mkEl("span", {}, "rk-n"); n.textContent = "6 张";
    nm.appendChild(sp); nm.appendChild(n);
    const grip = mkEl("span", {}, "rk-pool-grip"); head.appendChild(grip);
    head.appendChild(nm);
    const meta = mkEl("div", {}, "rk-pool-meta"); meta.textContent = "与另 2 国重合 3 张 · 重合度 50%";
    head.appendChild(meta);
    sec.appendChild(head);

    const grid = mkEl("div", {}, "rk-pool-grid sz-m");
    grid.style.setProperty("--rk-r", "4");
    grid.setAttribute("style", "--rk-r:4");
    for (let i = 1; i <= 3; i++) {
      const url = "https://img.example.com/" + wi + "-" + i + ".jpg";
      const fig = mkEl("figure", {
        "data-url": url, "data-period": w, "data-site": "US", "data-cat": "卫衣",
        "data-tags": "趋势爆款|上升 2 位", draggable: "true",
      }, "rk-card");
      const im = mkEl("img"); im.setAttribute("src", url); im.setAttribute("alt", "卫衣");
      fig.appendChild(im);
      const badge = mkEl("span", {}, "rk-badge"); badge.textContent = "趋势爆款"; fig.appendChild(badge);
      const mv = mkEl("span", {}, "rk-move"); mv.textContent = "上升 2 位"; fig.appendChild(mv);
      const fav = mkEl("button", {}, "rk-fav"); fav.textContent = "☆"; fig.appendChild(fav);
      grid.appendChild(fig);
    }
    sec.appendChild(grid);
    const foot = mkEl("div", {}, "rk-pool-foot"); foot.textContent = "已展示 3 / 6";
    sec.appendChild(foot);

    /* 每列一个「详细分析」按钮：属于操作入口，导出里不能留 */
    const ib = mkEl("button", {}, "rk-insight"); ib.textContent = "详细分析"; sec.appendChild(ib);
    pools.appendChild(sec);
  });
  return { doc, body, root, toast };
}

function mkCtx2d() {
  return {
    font: "", fillStyle: "", strokeStyle: "", lineWidth: 1, textAlign: "left",
    measureText: (t) => ({ width: String(t || "").length * 8 }),
    fillRect: () => {}, fillText: () => {}, drawImage: () => {}, strokeRect: () => {},
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {},
    fill: () => {}, stroke: () => {}, save: () => {}, restore: () => {}, scale: () => {},
  };
}

function boot(opts) {
  opts = opts || {};
  const page = mkPage(opts);
  const downloads = [], fetchCalls = [];
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, isNaN, encodeURIComponent, decodeURIComponent, parseInt, parseFloat,
    document: page.doc,
    fetch: (url) => {
      fetchCalls.push(url);
      if (String(url).indexOf("style.css") >= 0) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(CSS_MARK) });
      }
      if ((opts.broken || []).indexOf(url) >= 0) return Promise.reject(new Error("cors"));
      return Promise.resolve({ ok: true, blob: () => Promise.resolve({ size: 12, type: "image/jpeg" }) });
    },
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
    Blob: function (parts, o) { this.size = String((parts && parts[0]) || "").length; this.type = (o || {}).type; },
    Image: function () {
      const im = { width: 800, height: 1066, naturalWidth: 800, naturalHeight: 1066, onload: null, onerror: null };
      let src = "";
      Object.defineProperty(im, "src", {
        get: () => src,
        set: (v) => { src = v; setTimeout(() => { if (im.onload) im.onload(); }, 0); },
      });
      return im;
    },
    SB: { myExportZones: () => Promise.resolve(["*"]), siteSettings: () => Promise.resolve({}) },
  };
  sandbox.window = sandbox;

  const realCreate = page.doc.createElement;
  page.doc.createElement = (t) => {
    const el = realCreate(t);
    if (String(t).toLowerCase() === "a") {
      el.click = function () { downloads.push({ name: el.download, href: el.href }); };
    }
    if (String(t).toLowerCase() === "canvas") {
      el.getContext = () => mkCtx2d();
      el.toDataURL = () => "data:image/jpeg;base64,FAKEIMG";
      el.toBlob = (cb) => cb({ size: 4096 });
    }
    return el;
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx);
  return { VX: sandbox.VX, page, downloads, fetchCalls, sandbox };
}

/* ================= 三、用例 ================= */
console.log("一、能认出「页面主体」并原样克隆");
{
  const { VX } = boot();
  const root = VX._viewRoot();
  ok(!!root && root.getAttribute("id") === "rk-body", "应认出 #rk-body 作为导出主体");

  const snap = VX._snapshot();
  ok(!!snap && !!snap.clone, "应能克隆出页面主体");
  ok(snap && snap.width > 0, "应记录页面主体的实际宽度（导出时保持同样比例）");
  ok(snap && snap.clone !== root, "克隆必须是副本，不能改动页面上真实的 DOM");
}

/* runHtml 内部走 Blob，取内容不方便；直接调公开的 _buildDom 验证产出 */
console.log("二、导出成品：页面上的东西一样不少（结构）");
{
  const env = boot();
  const snap = env.VX._snapshot();
  const stat = { ok: 9, failed: 0, total: 9 };
  const html = env.VX._buildDom(snap.clone, { title: "趋势上升榜 · 卫衣 · 第43周—第45周", sub: "类目：卫衣 · 期次：第43周—第45周" }, stat, CSS_MARK, snap.width);

  ok(/rk-vitals/.test(html), "体征卡应被原样带走（以前重画卡片时会整块丢掉）");
  ok(/rk-pool-head/.test(html), "列头应保留");
  ok(/第43周/.test(html) && /第45周/.test(html), "三列周次文字都应在");
  ok(/与另 2 国重合 3 张/.test(html), "列副标题（重合度）应保留");
  ok(/rk-badge[^>]*>趋势爆款/.test(html), "图上压的「趋势爆款」角标应保留");
  ok(/rk-move[^>]*>上升 2 位/.test(html), "「上升 2 位」角标应保留");
  ok(/--rk-r:4/.test(html), "每行几张（--rk-r）应原样保留，不能改成别的值");
  ok(/repeat\(4/.test(html) === false, "不应再自行编造列宽（列宽由页面样式决定）");
  ok(/rk-pool-foot|已展示 3 \/ 6/.test(html), "列脚的「已展示 N / M」属于页面显示内容");
  ok(/<div class="rk-pools"/.test(html) || /class="[^"]*rk-pools/.test(html), "三列仍是同一个横排容器（并排，不是上下堆叠）");
}

console.log("三、能点的控件一个都不留");
{
  const env = boot();
  const snap = env.VX._snapshot();
  const html = env.VX._buildDom(snap.clone, { title: "t", sub: "" }, { ok: 9, failed: 0, total: 9 }, CSS_MARK, 1180);

  const bodyPart = html.slice(html.indexOf('<div class="vx-wrap"'), html.indexOf('<div id="vx-lb">'));
  ok(!/<button/i.test(bodyPart), "导出里不应出现按钮（不能再删、再改、再看详情）");
  ok(!/rk-fav/.test(html), "收藏星标应去掉");
  ok(!/rk-pool-grip/.test(html), "拖拽小把手应去掉");
  ok(!/详细分析/.test(html), "「详细分析」是操作入口，不应带过去");
  ok(!/draggable="true"/.test(html), "不应保留可拖动标记");
  ok(!/<input|<select|<textarea/i.test(html), "不应残留任何输入控件");
}

console.log("四、图片内嵌（直接验证取图与替换）");
{
  const env = boot({ broken: ["https://img.example.com/1-2.jpg"] });
  const snap = env.VX._snapshot();
  const api = env.VX._inlineDom || env.VX._inlineDomForTest;
  ok(typeof api === "function", "应暴露 DOM 取图入口供自检使用");
  if (typeof api === "function") {
    const stat = await api(snap.clone);
    const html = snap.clone.outerHTML;
    ok(stat.total === 9, "9 张图应全部进入取图队列");
    ok(stat.ok === 8 && stat.failed === 1, "抓取失败数应如实统计（1 张）");
    ok((html.match(/<img src="data:image\/jpeg/g) || []).length === 8, "成功的图应替换成内嵌数据");
    ok(/data-miss="1"/.test(html), "抓不到的图应打上「未内嵌」标记，而不是假装成功");
    ok(html.indexOf("https://img.example.com/1-2.jpg") >= 0, "抓不到的图应保留原地址，好歹能看到");
  }
}

console.log("五、样式与标题");
{
  const env = boot();
  const snap = env.VX._snapshot();
  const html = env.VX._buildDom(snap.clone, {
    title: "趋势上升榜 · 卫衣 · 第43周—第45周",
    sub: "类目：卫衣 · 期次：第43周—第45周 · 共 9 张",
  }, { ok: 9, failed: 0, total: 9 }, CSS_MARK, 1180);

  ok(html.indexOf(CSS_MARK) >= 0, "必须把站点自己的样式表整篇带上（否则版式全散）");
  ok(/<body class="front/.test(html), "导出页要挂 site 的 front 类，变量与主题才生效");
  ok(/趋势上升榜 · 卫衣/.test(html), "标题应写明类目");
  ok(/期次：第43周—第45周/.test(html), "副标题应写明期次范围");
  /* 20261113V：从「限宽」改成「定宽」—— 只限宽时，文件在窄窗口打开会命中样式表的
     窄屏断点，几列并排被压成一列竖排，看起来就和页面不一样了。 */
  ok(/width:1180px/.test(html), "应按页面实测宽度定宽，保证列宽与列数一致");
  ok(/flex-wrap:nowrap/.test(html), "并排容器必须禁止换行，否则窄窗口会塌成一列");
  ok(/<!DOCTYPE html>/.test(html) && /<\/html>/.test(html), "应是一份完整的单文件网页");
}

console.log("六、页面上没有可导出的主体时，仍能退回按卡片重画");
{
  const src = SRC;
  ok(/function domSnapshot/.test(src) && /domSnapshot\(\)/.test(src), "应先尝试原样搬走");
  ok(/if \(snap\)/.test(src) && /buildHtml\(secs/.test(src), "拿不到 DOM 时应退回原来的重画路径（不至于导不出来）");
  ok(/buildHtmlDom/.test(src) && /loadPageCss/.test(src), "原样搬走这条路上必须有样式表加载");
}

console.log("七、卡片结构变了也不至于导不出来");
{
  ok(/imgUrlsOf\(root\)/.test(SRC), "采集不到卡片时应回退到「页面主体里的真实图片」");
  ok(/if \(!secs\.length \|\| !n\)/.test(SRC), "空采集时应有一次兜底，而不是直接报没有图片");
  ok(/function viewRoot/.test(SRC), "兜底仍以页面主体为准（不是把整页的图标都算进去）");
}

await new Promise((r) => setTimeout(r, 30));
console.log("\n" + (fail ? "✗ 失败 " + fail + " 项 / " : "") + "通过 " + pass + " 项" + (fail ? "" : "，0 失败"));
process.exit(fail ? 1 : 0);
