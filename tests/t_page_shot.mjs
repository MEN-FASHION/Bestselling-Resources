/* 20261113W · 「导出高清图」自检
 *
 * 目标：断言趋势上升榜「天眼」旁那个整页高清图能力，已经接到每一个有图的专区，
 * 而且在每个专区里都能真正画出一张图（不是只有一个按钮摆在那里）。
 *
 * 做法：用一套足够小的假 DOM + 假画布把 js/page-shot.js 真跑一遍：
 *   ① 未授权 → 一个按钮都不出现；授权 → 出现在工具条里、紧跟「天眼」
 *   ② 工具条重绘（innerHTML 被清空）→ 按钮自动放回去
 *   ③ 点一下 → 真跑取景和绘制：底色、卡片框、图片（等比裁切）、文字都画到了
 *   ④ 页面上不该进图的东西（固定定位的悬浮件、toast、脚本）不进图
 *   ⑤ 七個专区的挂点与取景范围都配齐了，页面里也都引了这段脚本
 */
import fs from "fs";
import vm from "vm";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

/* ======================= 一、极简 DOM ======================= */
const STYLE_OF = new Map();

function mkEl(tag, cls, id) {
  const e = {
    tagName: String(tag || "div").toUpperCase(),
    className: String(cls || ""),
    id: String(id || ""),
    textContent: "",
    children: [],
    parentNode: null,
    parentElement: null,
    offsetParent: null,
    offsetLeft: 0,
    offsetTop: 0,
    style: {},
    disabled: false,
    title: "",
    type: "",
    _attrs: {},
    _rect: { left: 0, top: 0, width: 0, height: 0 },
    scrollWidth: 0,
    scrollHeight: 0,
    scrollLeft: 0,
    scrollTop: 0,
    onclick: null,
    addEventListener() { },
  };
  e.setAttribute = (k, v) => { e._attrs[k] = String(v); };
  e.getAttribute = (k) => (k in e._attrs ? e._attrs[k] : null);
  e.appendChild = (c) => { c.parentNode = e; c.parentElement = e; e.children.push(c); return c; };
  e.removeChild = (c) => { e.children = e.children.filter((x) => x !== c); c.parentNode = null; return c; };
  e.insertBefore = (c, ref) => {
    c.parentNode = e;
    c.parentElement = e;
    const i = e.children.indexOf(ref);
    if (i < 0) e.children.push(c); else e.children.splice(i, 0, c);
    return c;
  };
  Object.defineProperty(e, "nextSibling", {
    get() {
      if (!e.parentNode) return null;
      const i = e.parentNode.children.indexOf(e);
      return i >= 0 && i + 1 < e.parentNode.children.length ? e.parentNode.children[i + 1] : null;
    },
  });
  e.contains = (n) => {
    let p = n;
    while (p) { if (p === e) return true; p = p.parentNode; }
    return false;
  };
  e.querySelector = (sel) => all(e, sel)[0] || null;
  e.querySelectorAll = (sel) => all(e, sel);
  e.getBoundingClientRect = () => ({
    left: e._rect.left, top: e._rect.top, width: e._rect.width, height: e._rect.height,
  });
  e.serial = () => e;
  STYLE_OF.set(e, {});
  return e;
}

function walk(node, out) {
  (node.children || []).forEach((c) => { out.push(c); walk(c, out); });
  return out;
}

function match(el, sel) {
  if (!sel) return false;
  if (sel === "*") return true;
  if (sel.startsWith("#")) return el.id === sel.slice(1);
  if (sel.startsWith(".")) return (" " + el.className + " ").indexOf(" " + sel.slice(1) + " ") >= 0;
  return el.tagName === sel.toUpperCase();
}

function all(root, sel) {
  /* 只支持单选择器（本工程用到的最复杂的也就 .rk-hud-bar > i，这里用不到） */
  return walk(root, []).filter((el) => match(el, sel));
}

/* ======================= 二、假画布 ======================= */
function mkCanvas() {
  const ctx = {
    ops: [],
    fillStyle: "#000", strokeStyle: "#000", lineWidth: 1,
    font: "12px sans", textBaseline: "", textAlign: "",
    fillRect(x, y, w, h) { ctx.ops.push({ t: "fillRect", x, y, w, h, fill: ctx.fillStyle }); },
    beginPath() { ctx.ops.push({ t: "beginPath" }); },
    rect() { }, moveTo() { }, arcTo() { }, closePath() { },
    fill() { ctx.ops.push({ t: "fill", fill: ctx.fillStyle }); },
    stroke() { ctx.ops.push({ t: "stroke", stroke: ctx.strokeStyle }); },
    save() { }, restore() { }, clip() { },
    drawImage(im, x, y, w, h) { ctx.ops.push({ t: "drawImage", x, y, w, h, url: im && im._url }); },
    measureText(s) {
      const m = /(\d+(\.\d+)?)px/.exec(ctx.font || "12px");
      const size = m ? parseFloat(m[1]) : 12;
      return { width: String(s).length * size * 0.6 };
    },
    fillText(s, x, y) { ctx.ops.push({ t: "fillText", text: String(s), x, y, fill: ctx.fillStyle, font: ctx.font }); },
  };
  return {
    width: 0, height: 0,
    getContext() { return ctx; },
    toBlob(cb) { cb({ size: 1234, _blob: true }); },
    toDataURL() { return "data:image/png;base64,AAA"; },
    _ctx: ctx,
  };
}

/* ======================= 三、搭一个榜单页 ======================= */
function buildPage(opts) {
  opts = opts || {};
  const body = mkEl("body", "", "body");

  const toast = mkEl("div", "toast", "toast");
  const hudHost = mkEl("div", "", "");
  body.appendChild(toast);
  body.appendChild(hudHost);

  const bar = mkEl("div", "rk-bar", "rk-bar");
  const modes = mkEl("div", "rk-modes", "");
  const eye = mkEl("button", "rk-eye-btn", "rk-eye-btn");
  eye.textContent = "天眼 · 查看全部对比图";
  bar.appendChild(modes);
  bar.appendChild(eye);
  /* 榜单原有的同功能按钮（只给超管），新版应收起它，避免一排两个一样的按钮 */
  const legacy = mkEl("button", "rk-exp-img on", "rk-exp-img");
  legacy.textContent = "导出图片（整页 · 高清）";
  bar.appendChild(legacy);
  body.appendChild(bar);

  const root = mkEl("div", "rk-body", "rk-body");
  root._rect = { left: 0, top: 100, width: 1180, height: 620 };
  root.scrollWidth = 1180;
  root.scrollHeight = 620;
  body.appendChild(root);

  const pool = mkEl("section", "rk-pool", "");
  pool._rect = { left: 8, top: 104, width: 560, height: 600 };
  STYLE_OF.get(pool).backgroundColor = "rgb(255, 255, 255)";
  STYLE_OF.get(pool).borderTopWidth = "1px";
  STYLE_OF.get(pool).borderTopColor = "rgb(238, 232, 222)";
  STYLE_OF.get(pool).borderTopLeftRadius = "10px";
  root.appendChild(pool);

  const head = mkEl("div", "rk-pool-head", "");
  head._rect = { left: 16, top: 110, width: 544, height: 26 };
  pool.appendChild(head);
  const name = mkEl("span", "", "");
  name.textContent = "W43 · 12 张";
  name._rect = { left: 16, top: 112, width: 120, height: 20 };
  STYLE_OF.get(name).fontSize = "12.5px";
  STYLE_OF.get(name).color = "rgb(44, 44, 44)";
  head.appendChild(name);
  if (opts.sticky) {
    /* 真实场景：往下滚了很多，列头被吸在屏幕顶部（top 与容器顶齐平），但它本该在池内更靠下的位置。导出必须按后者放，否则列头会跑到长图中间。 */
    STYLE_OF.get(head).position = "sticky";
    pool.offsetParent = root;
    pool.offsetLeft = 8;
    pool.offsetTop = 4;
    head.offsetParent = pool;
    head.offsetLeft = 0;
    head.offsetTop = 300;      /* 它本该在池内往下 300px 处 */
    head._rect = { left: 16, top: 100, width: 544, height: 26 };   /* 吸顶后的屏幕坐标 */
    name.offsetParent = head;
    name.offsetTop = 2;
  }

  const card = mkEl("figure", "rk-card", "");
  card._rect = { left: 16, top: 145, width: 264, height: 380 };
  STYLE_OF.get(card).backgroundColor = "rgb(250, 248, 244)";
  STYLE_OF.get(card).borderTopLeftRadius = "8px";
  pool.appendChild(card);
  const img = mkEl("img", "", "");
  img._url = "https://cdn.example.com/a.jpg";
  img.setAttribute("src", img._url);
  img._rect = { left: 18, top: 147, width: 260, height: 260 };
  STYLE_OF.get(img).borderTopLeftRadius = "8px";
  card.appendChild(img);

  /* 图上压着的位次角标 */
  const badge = mkEl("span", "rk-badge", "");
  badge.textContent = "上升 12 位";
  badge._rect = { left: 24, top: 152, width: 70, height: 18 };
  badge.textContent = "上升 12 位";
  STYLE_OF.get(badge).fontSize = "11px";
  STYLE_OF.get(badge).borderTopLeftRadius = "999px";
  STYLE_OF.get(badge).backgroundColor = "rgb(255, 215, 94)";
  card.appendChild(badge);

  /* 固定定位的悬浮件（搜同款那类）：不该进图 */
  const float = mkEl("div", "fs-quick", "");
  float.textContent = "搜同款";
  float._rect = { left: 500, top: 300, width: 80, height: 26 };
  STYLE_OF.get(float).position = "fixed";
  STYLE_OF.get(float).backgroundColor = "rgb(17, 24, 39)";
  body.appendChild(float);
  /* 藏起来的元素也不该进图 */
  const hidden = mkEl("div", "rk-extra", "");
  hidden.textContent = "不该出现的文字";
  hidden._rect = { left: 16, top: 560, width: 200, height: 20 };
  STYLE_OF.get(hidden).display = "none";
  pool.appendChild(hidden);

  return { body, bar, eye, legacy, root, pool, card, img, badge, float, hidden };
}

/* ======================= 四、运行环境 ======================= */
function runCase(opts) {
  opts = opts || {};
  const page = buildPage(opts);
  const zones = opts.zones;

  const document = {
    body: page.body,
    documentElement: page.body,
    currentScript: null,
    getElementById: (id) => {
      const hit = walk(page.body, []).filter((e) => e.id === id)[0];
      return hit || (id === "toast" ? walk(page.body, []).filter((e) => e.id === "toast")[0] : null);
    },
    querySelector: (sel) => document._q(sel)[0] || null,
    querySelectorAll: (sel) => document._q(sel),
    _q(sel) {
      if (sel.startsWith("#")) {
        const id = sel.slice(1);
        return walk(page.body, []).filter((e) => e.id === id);
      }
      if (sel.startsWith(".")) {
        const c = sel.slice(1);
        return walk(page.body, []).filter((e) => (" " + e.className + " ").indexOf(" " + c + " ") >= 0);
      }
      return [];
    },
    createElement: (tag) => {
      if (String(tag).toLowerCase() === "canvas") return mkCanvas();
      return mkEl(tag, "", "");
    },
  };

  let moCb = null;
  function MutationObserver(cb) { moCb = cb; }
  MutationObserver.prototype.observe = function () { };
  MutationObserver.prototype.disconnect = function () { moCb = null; };

  const win = {
    document,
    getComputedStyle: (el) => {
      const s = Object.assign({
        display: "block", visibility: "visible", opacity: "1", position: "static",
        backgroundColor: "rgba(0, 0, 0, 0)", borderTopWidth: "0px", borderTopColor: "rgb(0, 0, 0)",
        borderTopLeftRadius: "0px", fontSize: "12px", lineHeight: "normal",
        fontWeight: "400", color: "rgb(26, 26, 26)",
      }, STYLE_OF.get(el) || {});
      return s;
    },
    Image: function () {
      const im = this;
      im.crossOrigin = ""; im.naturalWidth = 800; im.naturalHeight = 800;
      Object.defineProperty(im, "src", {
        get() { return im._src; },
        set(v) {
          im._src = v; im._url = v;
          im.width = 800; im.height = 800;
          setTimeout(() => { im.onload && im.onload(); }, 0);
        },
      });
    },
    MutationObserver,
    setTimeout, clearTimeout, Promise, console, Math, Date, Number, String, Array, Object, JSON,
    URL: { createObjectURL: () => "blob:x", revokeObjectURL() { } },
  };
  win.window = win;
  win.SB = {
    myExportZones: () => Promise.resolve(opts.zones2 || opts.perm || []),
  };

  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync("js/page-shot.js", "utf8"), ctx, { filename: "page-shot.js" });

  /* 收集下载动作 */
  const downloads = [];
  const realCreate = document.createElement;
  document.createElement = (tag) => {
    if (String(tag).toLowerCase() === "canvas") return mkCanvas();
    const el = mkEl(tag, "", "");
    if (String(tag).toLowerCase() === "a") el.click = () => downloads.push({ name: el.download, href: el.href });
    return el;
  };
  if (zones) win.PageShot.mount(zones);
  return { win, page, document, downloads, fire: () => moCb && moCb(), moHas: () => !!moCb };
}

/* ======================= 五、用例 ======================= */
console.log("== 1. 未授权：一个按钮都不出现 ==");
{
  const r = runCase({ perm: [] });
  await new Promise((res) => setTimeout(res, 20));
  ok(!r.page.bar.children.some((c) => c.className === "ps-btn"), "没有导出权限时不挂按钮");
  ok(r.win.PageShot.run, "模块对外暴露 run");
}

console.log("== 2. 授权：按钮出现在工具条里、紧跟天眼 ==");
const R = runCase({ perm: ["rank"], zones: "rank" });
await new Promise((res) => setTimeout(res, 20));
{
  const btns = R.page.bar.children.filter((c) => c.className === "ps-btn");
  ok(btns.length === 1, "工具条里恰好一个导出按钮");
  const iBtn = R.page.bar.children.indexOf(btns[0]);
  const iEye = R.page.bar.children.indexOf(R.page.eye);
  ok(iEye >= 0 && iBtn === iEye + 1, "按钮紧跟在「天眼」后面（位置与截图一致）");
  ok(btns[0].textContent.indexOf("导出高清图") >= 0, "按钮文字是「导出高清图」");
  ok(R.moHas(), "工具条挂了观察者，重绘后能自己放回去");
  ok(R.page.legacy.style.display === "none", "榜单原有的同功能按钮被收起（只留一个）");
}

console.log("== 3. 工具条重绘后按钮自动回来 ==");
{
  R.page.bar.children = [];      /* 模拟 innerHTML = "" 重绘 */
  R.fire();
  const btns = R.page.bar.children.filter((c) => c.className === "ps-btn");
  ok(btns.length === 1, "重绘后按钮自动放回");
}

console.log("== 4. 真跑一次出图 ==");
{
  const cv = mkCanvas();
  await R.win.PageShot.run();
  await new Promise((res) => setTimeout(res, 40));
  await new Promise((res) => setTimeout(res, 1600));
  const shots = R.page.body.children.filter((c) => c.className === "ps-hud");
  ok(shots.length === 0, "进度浮层跑完会收掉（不在页面上留残留）");
  ok(R.downloads.length === 1, "触发了一次下载（得到一张 png）");
  const d = R.downloads[0] || {};
  ok(/\.png$/.test(d.name || ""), "文件名是 .png：" + d.name);
  ok((d.name || "").indexOf("趋势上升榜") >= 0, "文件名带专区名");
  ok((d.name || "").indexOf("整页高清") >= 0, "文件名带「整页高清」");
}

console.log("== 5. 取景/绘制的实际内容 ==");
{
  /* 直接调内部：把绘制结果抓出来（用同一套假画布重建一遍） */
  const canvasOps = [];
  const r2 = runCase({ perm: ["*"], zones: "rank" });
  await new Promise((res) => setTimeout(res, 20));
  /* 替换 createElement 返回的画布，记录 ops */
  const origCreate = r2.document.createElement;
  r2.document.createElement = (tag) => {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === "canvas") {
      const ctx2 = el._ctx;
      const push = (o) => canvasOps.push(o);
      ["fillRect", "fill", "stroke", "drawImage", "fillText"].forEach((k) => {
        const fn = ctx2[k].bind(ctx2);
        ctx2[k] = function () { push({ t: k, args: Array.from(arguments), fill: ctx2.fillStyle, font: ctx2.font }); return fn.apply(null, arguments); };
      });
    }
    return el;
  };
  await r2.win.PageShot.run();
  await new Promise((res) => setTimeout(res, 60));

  const drawn = canvasOps.filter((o) => o.t === "drawImage");
  const texts = canvasOps.filter((o) => o.t === "fillText").map((o) => o.args[0]);
  const fills = canvasOps.filter((o) => o.t === "fill");
  ok(drawn.length === 1, "图里的那一张图被画上了（drawImage 次数 " + drawn.length + "）");
  ok(/a\.jpg/.test((drawn[0] || {}).args && (drawn[0].args[0]._url || "")), "画的是页面里那张图的地址");
  ok(texts.some((t) => String(t).indexOf("W43") >= 0), "列头「W43 · 12 张」被画上");
  ok(texts.some((t) => String(t).indexOf("上升 12 位") >= 0), "图上压着的角标被画上");
  ok(!texts.some((t) => String(t).indexOf("搜同款") >= 0), "固定定位的悬浮件不进图");
  ok(!texts.some((t) => String(t).indexOf("不该出现的文字") >= 0), "display:none 的内容不进图");
  ok(fills.length >= 1, "卡片底色被铺上（fill 次数 " + fills.length + "）");
}

console.log("== 5b. 吸顶的列头按布局位置搬（不会跑到长图中间） ==");
{
  const ops = [];
  const r3 = runCase({ perm: ["*"], zones: "rank", sticky: true });
  await new Promise((res) => setTimeout(res, 20));
  const origCreate = r3.document.createElement;
  r3.document.createElement = (tag) => {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === "canvas") {
      const c = el._ctx;
      const fn = c.fillText.bind(c);
      c.fillText = function (t, x, y) { ops.push({ t, x, y }); return fn(t, x, y); };
    }
    return el;
  };
  await r3.win.PageShot.run();
  await new Promise((res) => setTimeout(res, 60));
  const hit = ops.filter((o) => String(o.t).indexOf("W43") >= 0)[0];
  ok(!!hit, "列头文字被画上");
  /* 吸顶位置 y=0（乘以 2 倍后仍在 0 附近），布局位置 y≈10 → 2 倍后 20 上下 */
  ok(hit && hit.y >= 300, "列头按布局位置绘制（y=" + (hit ? hit.y : "?") + "，不是吸顶后的 12）");
}

console.log("== 6. 各专区挂点配齐、页面都引了脚本 ==");
{
  const mod = fs.readFileSync("js/page-shot.js", "utf8");
  const want = {
    rank: ["#rk-bar", "#rk-body"],
    rhythm: ["#rk-bar", "#rk-body"],
    compare: ["#cmp-bar", "#cmp-body"],
    shein: ["#cz-bar", "#cz-body"],
    pinterest: ["#cz-bar", "#cz-body"],
    movement: ["#mv-bar", "#mv-body"],
    visual: ["#grid-bar", "#grid"],
  };
  Object.keys(want).forEach((k) => {
    ok(new RegExp(k + ':\\s*\\{[^}]*bar:\\s*"' + want[k][0].replace("#", "#") + '"').test(mod), k + " 的按钮挂点 = " + want[k][0]);
    ok(new RegExp(k + ':\\s*\\{[^}]*root:\\s*"' + want[k][1] + '"').test(mod), k + " 的取景范围 = " + want[k][1]);
  });
  const pages = {
    "rank.html": "rank", "rhythm.html": "rhythm", "compare.html": "compare",
    "shein.html": "shein", "pinterest.html": "pinterest", "movement.html": "movement",
    "index.html": "visual",
  };
  Object.keys(pages).forEach((f) => {
    const s = fs.readFileSync(f, "utf8");
    ok(s.indexOf("page-shot.js") >= 0, f + " 引了 page-shot.js");
    ok(new RegExp('PageShot\\.mount\\("' + pages[f] + '"\\)').test(s), f + " 挂载了 " + pages[f]);
  });
  /* 后台要能勾这个权限，否则配不了 */
  const perm = fs.readFileSync("js/admin-perm.js", "utf8");
  ["rank", "rhythm", "pinterest", "shein", "compare", "movement", "visual"].forEach((k) => {
    ok(new RegExp('key:\\s*"' + k + '"').test(perm), "后台导出权限勾选框含 " + k);
  });
  ok(/\.ps-btn\b/.test(fs.readFileSync("css/style.css", "utf8")), "样式里补了 .ps-btn");
}

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
if (fail) process.exit(1);
