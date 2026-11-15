/* 20261114S · 导出「只出图，不出字」
 *
 * 需求：除了趋势上升榜和上新节奏，其余专区（渠道对比 / S / P / T 专区 /
 * 品牌动向 / 视觉专区）导出的网页与图片都不带文字。
 *
 * 这套自检用同一个假 DOM 真跑：
 *   ① 判定：哪些专区该只剩图、哪些该保留文字；
 *   ② 克隆：网页导出的克隆体里，列头、张数、列底、角标、类目/月度全被摘掉，
 *            但图片、卡片壳、每行张数（--rk-r）一个不少；
 *   ③ 网页：只出图时没有页头、筛选摘要、未抓取提示；
 *   ④ 海报：只出图时卡片高度等于图高（不留文字区）、整张更矮；
 *   ⑤ 整页高清图：快照阶段就把文字全跳过。
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
    toggle: (c, on) => { if (on === undefined) { if (e._cls.has(c)) e._cls.delete(c); else e._cls.add(c); } else if (on) e._cls.add(c); else e._cls.delete(c); },
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
  if (t && t !== "*") tag = t.toUpperCase();   /* 通配符：不过滤标签名 */
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
console.log("一、哪些专区导出只给图");
{
  for (const z of ["compare", "shein", "pinterest", "tiktok", "movement", "visual"]) {
    const env = boot();
    await env.VX.boot(z);
    ok(env.VX._state().textless === true, z + " 导出应只出图（不带文字）");
  }
  for (const z of ["rank", "rhythm"]) {
    const env = boot();
    await env.VX.boot(z);
    ok(env.VX._state().textless === false, z + " 导出应保留文字");
  }
}

console.log("二、渠道对比：克隆体里的文字被摘干净，图一张不少");
{
  const env = boot();
  await env.VX.boot("compare");
  const snap = env.VX._snapshot();
  ok(!!snap && !!snap.clone, "应能克隆出页面主体");
  const html = snap.clone.outerHTML;
  ok(!/>[^<]*第43周/.test(html), "列头周次不应出现（>=第43周< 形式）");
  ok(!/>[^<]*6 张/.test(html), "列头张数不应出现");
  ok(!/>[^<]*趋势爆款/.test(html), "图上「趋势爆款」角标不应出现");
  ok(!/>[^<]*上升 2 位/.test(html), "图上「上升 2 位」角标不应出现");
  ok(!/>[^<]*已展示/.test(html), "列底的「已展示 N / M」不应出现");
  ok(!/>[^<]*重合/.test(html), "列副标题（重合度）不应出现");
  ok((html.match(/<img/g) || []).length === 9, "9 张图必须全部留着");
  ok(/<figure/.test(html), "卡片壳（排版结构）要保留");
  ok(/--rk-r:4/.test(html), "每行张数（--rk-r）要保留，版式不走形");
  ok(/rk-pool-grid/.test(html), "列内网格要保留");
}

console.log("三、趋势上升榜：文字照旧一个字不丢");
{
  const env = boot();
  await env.VX.boot("rank");
  const snap = env.VX._snapshot();
  const html = snap.clone.outerHTML;
  ok(/>[^<]*第43周/.test(html), "周次应保留");
  ok(/>[^<]*6 张/.test(html), "张数应保留");
  ok(/>[^<]*趋势爆款/.test(html), "角标应保留");
  ok(/>[^<]*已展示/.test(html), "列底应保留");
  ok((html.match(/<img/g) || []).length === 9, "9 张图仍在");
}

console.log("四、网页成品：只出图时不带页头与摘要");
{
  const env = boot();
  await env.VX.boot("shein");
  const snap = env.VX._snapshot();
  const html = env.VX._buildDom(snap.clone, { title: "S 专区 · 卫衣", sub: "类目：卫衣" },
    { ok: 9, failed: 1, total: 10 }, CSS_MARK, 1180);
  const bodyPart = html.slice(html.indexOf("<body"), html.indexOf('<div id="vx-lb">'));
  ok(!/<header class="vx-hd"/.test(bodyPart), "不应出现页头（标题 + 摘要）");
  ok(bodyPart.indexOf("类目：卫衣") < 0, "不应出现筛选摘要");
  ok(!/class="vx-note"/.test(bodyPart), "不应出现「N 张未能抓取」这类提示文字");
  ok(/class="vx-wrap"/.test(bodyPart), "图片容器仍在");
  ok((bodyPart.match(/<img/g) || []).length === 9, "9 张图仍在");
}

console.log("五、网页成品：榜单仍带页头与摘要");
{
  const env = boot();
  await env.VX.boot("rank");
  const snap = env.VX._snapshot();
  const html = env.VX._buildDom(snap.clone, { title: "趋势上升榜 · 卫衣", sub: "类目：卫衣" },
    { ok: 9, failed: 0, total: 9 }, CSS_MARK, 1180);
  const bodyPart = html.slice(html.indexOf("<body"), html.indexOf('<div id="vx-lb">'));
  ok(/<header class="vx-hd"/.test(bodyPart), "页头应保留");
  ok(bodyPart.indexOf("类目：卫衣") >= 0, "摘要应保留");
  ok(bodyPart.indexOf("趋势上升榜 · 卫衣") >= 0, "标题应保留");
}

console.log("六、兜底路径（克隆失败，按卡片重画）同样只出图");
{
  const env = boot();
  await env.VX.boot("compare");
  const secs = env.VX._collect();
  ok(secs.length > 0, "应能采集到分组");
  const html = env.VX._build(secs, { title: "渠道对比 · 卫衣", sub: "类目：卫衣", failed: 0, ok: 9, columns: true });
  ok(!/<h2>/.test(html), "不应出现分组标题");
  ok(!/class="col-h"/.test(html), "不应出现列头");
  ok(!/<figcaption>/.test(html), "不应出现图下说明");
  ok(!/<header class="hd"/.test(html), "不应出现页头");
  /* 9 张图卡（页尾那个放大用的 <img id="lb-img"> 不算） */
  ok((html.match(/<figure class="c">/g) || []).length === 9, "9 张图卡仍在");
}

console.log("七、海报：只出图时没有文字位");
{
  const env = boot();
  await env.VX.boot("compare");
  const m1 = env.VX._metrics();
  ok(m1.cardH === m1.imgH, "只出图：卡片高度应等于图高（不留图下文字区）");
  const sh1 = env.VX._layoutCols(env.VX._collect());

  const env2 = boot();
  await env2.VX.boot("rank");
  const m2 = env2.VX._metrics();
  ok(m2.cardH > m2.imgH, "榜单：卡片仍保留图下文字区");
  const sh2 = env2.VX._layoutCols(env2.VX._collect());

  ok(sh1.length > 0 && sh1[0].colMode, "多列并排版式应可用");
  ok(sh1[0].h < sh2[0].h, "同一批图，只出图的海报应比带文字的更矮（页头/列头/列底归零）");
  ok(sh1[0].h < 3000, "只出图的海报高度应在合理范围");
}

console.log("八、整页高清图（天眼旁那个按钮）同样的口径");
{
  const PS = fs.readFileSync("js/page-shot.js", "utf8");
  ok(/var TEXT_KEEP = \{ rank: 1, rhythm: 1 \}/.test(PS), "整页图也只给两个专区留文字");
  ok(/ST\.textless = !TEXT_KEEP\[ST\.key\]/.test(PS), "挂载时按专区判定");
  const iSkip = PS.indexOf("if (ST.textless) return;");
  const iPush = PS.indexOf('k: "text"');
  ok(iSkip > 0 && iPush > iSkip, "文字跳过必须发生在写入快照之前（否则等于没跳过）");
  ok(/if \(!state\.textless\) drawHeader/.test(fs.readFileSync("js/view-export.js", "utf8")), "海报页头按开关跳过");
}

console.log("九、版本戳");
{
  const VJ = fs.readFileSync("js/view-export.js", "utf8");
  const PJ = fs.readFileSync("js/page-shot.js", "utf8");
  /* 版本戳断言不再写死某一天的版本号：两个模块必须都有 BUILD，
     且必须与页面引用的版本一致 —— 这样每次发版不会误报，但漏改仍会被抓住。 */
  const bV = (VJ.match(/var BUILD = "([^"]+)"/) || [])[1] || "";
  const bP = (PJ.match(/var BUILD = "([^"]+)"/) || [])[1] || "";
  ok(/^2026\d{4}[A-Z]$/.test(bV), "导出模块应有合法版本戳，实际：" + bV);
  ok(bV === bP, "导出与整页图模块版本必须一致，" + bV + " vs " + bP);
  const htmlPages = fs.readdirSync(".").filter((f) => f.endsWith(".html"));
  let stale = [];
  htmlPages.forEach((f) => {
    const t = fs.readFileSync(f, "utf8");
    if (/\?v=20261114Q/.test(t)) stale.push(f);
  });
  ok(stale.length === 0, "页面不应再引用旧版本脚本：" + stale.join(","));
}

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
if (fail) process.exit(1);
