/* 20261114M · 导出单页网页时，「对比的列」必须一起带走
 *
 * 现象：前台选了 3 列（或 2 列做对比），页面上明明有逐列画像 / 横向对照表，
 *      导出的网页里却只剩图片列 —— 因为「详细报告」默认是折叠的，
 *      而且内容要「首次展开」才会生成，克隆时它既 hidden 又空。
 *
 * 这套自检用一个假 DOM 真跑：折叠 → 导出 → 断言对比列进了文件、
 * 导出完把页面折回原状、用户自己已展开时不再多点一次。
 */
import fs from "fs";
import vm from "vm";

const SRC = fs.readFileSync("js/view-export.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const VOID = { IMG: 1, INPUT: 1, BR: 1, HR: 1, META: 1, LINK: 1 };

function mkEl(tag, attrs, cls) {
  const e = {
    tagName: String(tag || "div").toUpperCase(),
    _attrs: Object.assign({}, attrs || {}),
    _cls: new Set(String(cls || "").split(/\s+/).filter(Boolean)),
    children: [], parentElement: null, parentNode: null,
    style: { setProperty() {} },
    textContent: "", _h: "", _clicks: 0,
  };
  Object.defineProperty(e, "className", {
    get: () => Array.from(e._cls).join(" "),
    set: (v) => { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  Object.defineProperty(e, "innerHTML", { get: () => e._h, set: (v) => { e._h = String(v); } });
  e.classList = { add: (c) => e._cls.add(c), remove: (c) => e._cls.delete(c), contains: (c) => e._cls.has(c),
    toggle: (c, on) => { if (on === undefined) { if (e._cls.has(c)) e._cls.delete(c); else e._cls.add(c); } else if (on) e._cls.add(c); else e._cls.delete(c); } };
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
    c.textContent = e.textContent; c._h = e._h;
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

/* ============ 造一个「趋势上升榜 · 3 列对比」的页面 ============
   opts.expanded = true  → 用户自己已经展开过详细报告（内容已在 DOM 里） */
function mkPage(opts) {
  opts = opts || {};
  const body = mkEl("body", {}, "front");
  const root = mkEl("div", { id: "rk-body" }, "rk-body");
  body.appendChild(root);

  const bar = mkEl("div", {}, "rk-rep-toggle-bar");
  const btn = mkEl("button", { "data-rep-toggle": "1", "aria-expanded": "false" }, "rk-rep-open");
  btn.textContent = "查看详细报告";
  bar.appendChild(btn);
  root.appendChild(bar);

  const top = mkEl("div", { "data-rep-detail": "1", "data-rep-lazy": "top", hidden: "" }, "rk-rep-detail");
  root.appendChild(top);

  const sheet = mkEl("div", {}, "rk-sheet-x");
  root.appendChild(sheet);

  /* 对比池：3 列 */
  const pools = mkEl("div", { id: "rk-pools" }, "rk-pools");
  root.appendChild(pools);
  ["第43周", "第44周", "第45周"].forEach((w, wi) => {
    const sec = mkEl("section", {}, "rk-pool");
    const head = mkEl("div", {}, "rk-pool-head");
    const nm = mkEl("div", {}, "rk-pool-name");
    const sp = mkEl("span"); sp.textContent = w;
    const n = mkEl("span", {}, "rk-n"); n.textContent = "6 张";
    nm.appendChild(sp); nm.appendChild(n); head.appendChild(nm); sec.appendChild(head);
    const grid = mkEl("div", {}, "rk-pool-grid");
    const fig = mkEl("figure", { "data-url": "https://img.example.com/" + wi + ".jpg" }, "rk-card");
    const im = mkEl("img"); im.setAttribute("src", "https://img.example.com/" + wi + ".jpg");
    fig.appendChild(im); grid.appendChild(fig); sec.appendChild(grid);
    pools.appendChild(sec);
  });

  /* 模拟站点的展开/收起：展开时才把「对比的列」生成进 DOM */
  const OPEN_HTML = '<div class="rk-rep-sec"><h4>横向对照</h4>'
    + '<table class="rk-mx"><thead><tr><th>维度</th><th>第43周</th><th>第44周</th><th>第45周</th></tr></thead>'
    + '<tbody><tr><td>趋势爆款</td><td>40%</td><td>55%</td><td>62%</td></tr></tbody></table></div>';
  let opened = !!opts.expanded;
  if (opened) { top._h = OPEN_HTML; top.removeAttribute("hidden"); btn.setAttribute("aria-expanded", "true"); }
  btn.click = function () {
    btn._clicks++;
    opened = !opened;
    if (opened) {
      if (!top._h) top._h = OPEN_HTML;       /* 懒生成：只有展开才出现 */
      top.removeAttribute("hidden");
      btn.setAttribute("aria-expanded", "true");
    } else {
      top.setAttribute("hidden", "");
      btn.setAttribute("aria-expanded", "false");
    }
  };
  if (opts.noToggle) { removeNodeSimple(bar, root); }

  function removeNodeSimple(el, parent) {
    if (parent) parent.children = parent.children.filter((x) => x !== el);
  }

  const doc = {
    readyState: "complete", body, title: "趋势上升榜 · TREND BANK",
    createElement: (t) => mkEl(t),
    querySelector: (s) => qsa(body, s)[0] || null,
    querySelectorAll: (s) => qsa(body, s),
    getElementById: (id) => qsa(body, "#" + id)[0] || null,
  };
  return { doc, body, root, btn, top, pools };
}

function boot(opts) {
  const page = mkPage(opts);
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array,
    RegExp, Error, isNaN, encodeURIComponent, decodeURIComponent, parseInt, parseFloat,
    document: page.doc,
    fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve("/*css*/"), blob: () => Promise.resolve({ size: 12 }) }),
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
    Blob: function (p, o) { this.size = String((p && p[0]) || "").length; this.type = (o || {}).type; },
    Image: function () { const im = { onload: null, onerror: null }; Object.defineProperty(im, "src", { set(v) { setTimeout(() => im.onload && im.onload(), 0); } }); return im; },
    SB: { myExportZones: () => Promise.resolve(["*"]), siteSettings: () => Promise.resolve({}) },
    localStorage: {
      _d: Object.assign({}, (opts && opts.store) || {}),
      getItem(k) { return (k in this._d) ? this._d[k] : null; },
      setItem(k, v) { this._d[k] = String(v); },
    },
  };
  sandbox.window = sandbox;
  const realCreate = page.doc.createElement;
  page.doc.createElement = (t) => {
    const el = realCreate(t);
    if (String(t).toLowerCase() === "canvas") { el.getContext = () => ({ measureText: () => ({ width: 10 }) }); el.toDataURL = () => "data:image/jpeg;base64,X"; }
    return el;
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx);
  return { VX: sandbox.VX, page };
}

console.log("一、折叠状态下导出：对比的列必须进文件");
{
  const env = boot();
  const snap = env.VX._snapshot();
  ok(!!snap && !!snap.clone, "应能克隆出页面主体");
  const html = snap ? snap.clone.outerHTML : "";
  ok(/横向对照/.test(html), "详细报告里的「横向对照」应被导出（以前是空的/隐藏的）");
  ok(/第43周<\/th><th>第44周<\/th><th>第45周<\/th>/.test(html), "对照表的列数应与页面选中的列数一致（3 列）");
  ok(/rk-mx/.test(html), "对照表本体应保留");
  ok(!/data-rep-detail[^>]*hidden/.test(html), "详情块不能再带 hidden（否则静态网页里永远是隐藏的）");
  ok(!/rk-rep-toggle-bar/.test(html), "「查看详细报告」折叠条是操作入口，导出里应去掉");
}

console.log("二、导出完把页面折回原状（不改变用户看到的界面）");
{
  const env = boot();
  ok(env.page.top.hasAttribute("hidden"), "导出前：详情块处于折叠（hidden）状态");
  env.VX._snapshot();
  ok(env.page.top.hasAttribute("hidden"), "导出后：详情块必须重新折起");
  ok(env.page.btn.getAttribute("aria-expanded") === "false", "导出后：按钮 aria-expanded 应回到 false");
  ok(env.page.btn._clicks === 2, "应只做「展开→收起」一对点击，不多点");
  ok(env.page.top._h.length > 0, "展开过一次后内容留在内存里（下次导出不必重新生成）");
}

console.log("三、用户本来就展开着：不许再点，也不许把它收起来");
{
  const env = boot({ expanded: true });
  env.VX._snapshot();
  ok(env.page.btn._clicks === 0, "已展开时不应再点击");
  ok(!env.page.top.hasAttribute("hidden"), "已展开时不能被收起（不能改用户界面）");
}

console.log("四、没有折叠控件的页面（渠道对比 / SHEIN / PIN）：原样克隆，不报错");
{
  const env = boot({ noToggle: true });
  let snap = null, err = null;
  try { snap = env.VX._snapshot(); } catch (e) { err = e; }
  ok(!err, "没有折叠控件时不应抛错");
  ok(!!snap && !!snap.clone, "仍应正常克隆页面主体");
}

console.log("五、「带对比分析」开关：关掉就只导图片列");
{
  const off = boot({ store: { vx_with_rep: "0" } });
  await off.VX.boot("rank");
  ok(off.VX._state().withRep === false, "开关记在浏览器里，重建后仍为「关」");
  const snap = off.VX._snapshot();
  const html = snap.clone.outerHTML;
  ok(!/横向对照/.test(html), "关掉时导出里不该有对照表");
  ok(!/rk-rep-detail/.test(html), "关掉时详细报告整块都不带走");
  ok(!/rk-rep-cols/.test(html), "关掉时逐列画像也一并去掉（只剩图片列）");
  ok(off.page.top.hasAttribute("hidden"), "关掉时页面保持折叠原状");
  ok(off.page.btn._clicks === 0, "关掉时不去展开页面");
}
{
  const on = boot({ store: { vx_with_rep: "1" } });
  await on.VX.boot("rank");
  ok(on.VX._state().withRep === true, "开关为「开」时应带对比分析");
  const snap = on.VX._snapshot();
  ok(/横向对照/.test(snap.clone.outerHTML), "开着时对照表应被带走");
}

console.log("六、源码层面：导出路径真的接了这一步");
{
  ok(/function openRepForExport/.test(SRC), "应有开报告的实现");
  ok(/var restore = openRepForExport\(\)/.test(SRC), "克隆前必须调用它");
  ok(/if \(restore\) \{ try \{ restore\(\); \}/.test(SRC), "克隆/异常后必须收回去");
  ok(/data-rep-detail/.test(SRC) && /removeAttribute\("hidden"\)/.test(SRC), "克隆体里要摘掉 hidden");
}

await new Promise((r) => setTimeout(r, 20));
console.log("\n" + (fail ? "✗ 失败 " + fail + " 项 / " : "") + "通过 " + pass + " 项" + (fail ? "" : "，0 失败"));
process.exit(fail ? 1 : 0);
