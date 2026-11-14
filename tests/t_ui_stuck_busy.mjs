/* 20261114I · 「合并 / 删除点了没反应」的根因自检
 *
 * 事故现象：类目清理里「合并到…」「整类删除」都点不动，不弹框、不报错，像按钮坏了。
 * 根因：弹窗组件内部一旦抛异常，模块级 `busy` 标记会永久停在 true。
 *   之后每一次 uiConfirm / uiPrompt 都在入口处 resolve(false) 直接返回，
 *   界面上表现为「所有确认类按钮静默失效」。
 *
 * 本测试用「让 createElement('input') 抛错」人为制造该异常，断言：
 *   1) 弹窗组件不会把异常抛给调用方，而是退回原生 prompt；
 *   2) busy 被复位 —— 紧接着的第二次调用仍能正常弹出并拿到结果；
 *   3) 类目清理的四个按钮都包了 guard（出错给提示），弹窗调用走兜底版本。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

function mkEl(tag) {
  const e = {
    tagName: (tag || "div").toUpperCase(), childNodes: [], style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    _html: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    textContent: "", value: "", className: "", type: "", title: "", id: "", src: "",
    checked: false, parentNode: null, disabled: false,
    appendChild(c) {
      if (!c || typeof c !== "object") throw new TypeError("appendChild: parameter 1 is not of type 'Node'.");
      c.parentNode = e; e.childNodes.push(c); return c;
    },
    insertBefore(c, ref) {
      if (!c || typeof c !== "object") throw new TypeError("insertBefore: parameter 1 is not of type 'Node'.");
      if (ref != null && typeof ref !== "object") throw new TypeError("insertBefore: parameter 2 is not of type 'Node'.");
      c.parentNode = e;
      if (ref == null) { e.childNodes.push(c); return c; }
      const i = e.childNodes.indexOf(ref);
      if (i < 0) e.childNodes.push(c); else e.childNodes.splice(i, 0, c);
      return c;
    },
    removeChild(c) { const i = e.childNodes.indexOf(c); if (i >= 0) { e.childNodes.splice(i, 1); c.parentNode = null; } return c; },
    remove() { if (e.parentNode) e.parentNode.removeChild(e); },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl("div"); }, querySelectorAll() { return []; },
    get firstChild() { return e.childNodes[0] || null; },
    onclick: null, focus() {}, click() {}, select() {}, add() {},
    cloneNode() { return mkEl(tag); },
    closest() { return null; }, contains() { return false; }, matches() { return false; },
  };
  return e;
}

/* bombInput=true 时，createElement("input") 抛错 —— 模拟「弹窗构建中途出事」 */
function boot(bombInput) {
  const body = mkEl("body");
  const document = {
    readyState: "complete", body, documentElement: mkEl("html"), head: mkEl("head"),
    getElementById() { return null; },
    createElement(t) {
      if (bombInput && String(t).toLowerCase() === "input") throw new TypeError("createElement(input): boom");
      return mkEl(t);
    },
    createTextNode(t) { return { nodeValue: t }; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl("div"); }, querySelectorAll() { return []; },
  };
  const prompts = [];
  const win = {
    document, console: { error() {}, log() {}, warn() {} }, setTimeout, clearTimeout, Promise, String, Error,
    prompt(msg, def) { prompts.push({ msg, def }); return "打底压缩"; },
    confirm() { return true; },
    alert() {},
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(read("js/ui-dialog.js"), win, { filename: "ui-dialog.js" });
  return { win, body, prompts };
}

/* ---------- 一、构建出错时：不抛异常，退回原生 prompt ---------- */
{
  const { win, prompts } = boot(true);
  let err = null, v;
  try { v = await win.uiPrompt("把「运动功能服」并入哪个类目？", "运动功能服"); }
  catch (e) { err = e; }
  ok(err === null, "弹窗内部出错时不应把异常抛给调用方（实际：" + (err && err.message) + "）");
  ok(v === "打底压缩", "出错时应退回原生 prompt 并把输入值返回（实际：" + JSON.stringify(v) + "）");
  ok(prompts.length === 1, "应调用过一次原生 prompt");
}

/* ---------- 二、关键：出错之后不能把后面所有弹窗一起废掉 ---------- */
{
  const { win, body } = boot(false);
  /* 先人为制造一次异常：临时把 createElement 变成会抛错的函数 */
  const realCreate = win.document.createElement;
  let thrown = false;
  win.document.createElement = (t) => {
    if (!thrown && String(t).toLowerCase() === "input") { thrown = true; throw new TypeError("boom"); }
    return realCreate(t);
  };
  const p1 = win.uiPrompt("第一次（会出错）", "x");
  let v1; try { v1 = await p1; } catch (e) { v1 = "THREW"; }
  ok(v1 === "打底压缩", "第一次出错后应走原生兜底（实际：" + JSON.stringify(v1) + "）");
  win.document.createElement = realCreate;

  /* 第二次：必须正常弹出站内弹窗，而不是被 busy 挡住静默返回 */
  const p2 = win.uiConfirm("把「运动功能服」并入「打底压缩」？");
  p2.catch(() => {});
  await null;
  const mask = body.childNodes.filter((n) => n.className && n.className.indexOf("uid-mask") >= 0)[0];
  ok(!!mask, "第一次出错后，第二次弹窗必须能正常挂出（旧版 busy 卡死时这里会是空）");
  if (mask) {
    const foot = mask.childNodes[0].childNodes.filter((n) => n.className && n.className.indexOf("uid-foot") >= 0)[0];
    ok(!!foot, "第二次弹窗应有按钮区");
    if (foot) foot.childNodes[foot.childNodes.length - 1].onclick();
  }
  const v2 = await p2;
  ok(v2 === true, "第二次点「确定」应返回 true（实际：" + JSON.stringify(v2) + "）");
  const left = body.childNodes.filter((n) => n.className && n.className.indexOf("uid-mask") >= 0);
  ok(left.length === 0, "关闭后不应残留遮罩（残留会挡住整页点击）");
}

/* ---------- 三、类目清理四个按钮都包了 guard，且弹窗调用有兜底 ---------- */
{
  const RANK = read("js/admin-rank.js");
  const i = RANK.indexOf("async function openRankCategoryTools");
  const j = RANK.indexOf("async function loadRankBatches");
  const seg = RANK.slice(i, j);
  ok(/cMerge\.onclick\s*=\s*guard\(/.test(seg), "「合并选中…」按钮应走 guard");
  ok(/cDel\.onclick\s*=\s*guard\(/.test(seg), "「删除选中」按钮应走 guard");
  ok(/cNorm\.onclick\s*=\s*guard\(/.test(seg), "「按标准名归并」按钮应走 guard");
  ok(/merge\.onclick\s*=\s*guard\(/.test(seg), "行内「合并到…」应走 guard");
  ok(/wipe\.onclick\s*=\s*guard\(/.test(seg), "行内「整类删除」应走 guard");
  ok(/const askText\s*=/.test(seg) && /const askYes\s*=/.test(seg), "应提供 askText / askYes 兜底封装");
  {
    /* 只允许在 askText / askYes 两个兜底封装里出现（各一次），业务代码不得直连 */
    const nP = (seg.match(/await uiPrompt\(/g) || []).length;
    const nC = (seg.match(/await uiConfirm\(/g) || []).length;
    ok(nP === 1 && nC === 1, "面板业务代码不应直接 await 站内弹窗（只允许出现在兜底封装里），实际 uiPrompt=" + nP + " / uiConfirm=" + nC);
  }
  ok(/window\.prompt\(/.test(seg) && /window\.confirm\(/.test(seg), "弹窗不可用时应退回原生 prompt / confirm");
  /* 兜底封装自己不能调用自己（曾因整段替换导致 askText 递归调用自身，永远不弹窗） */
  {
    const at = seg.indexOf("const askText");
    const body = seg.slice(at, at + 260);
    ok(/await uiPrompt\(msg/.test(body), "askText 内部必须调用 uiPrompt，不能调用自身");
    const ay = seg.indexOf("const askYes");
    const body2 = seg.slice(ay, ay + 260);
    ok(/await uiConfirm\(msg/.test(body2), "askYes 内部必须调用 uiConfirm，不能调用自身");
  }
}

/* ---------- 四、标题组词台同一套保护 ---------- */
{
  const TI = read("js/admin-titlelab.js");
  const i = TI.indexOf("async function openTiCatTools");
  const j = TI.indexOf("async function openTiPeriodTools");
  const seg = TI.slice(i, j);
  ok(/merge\.onclick\s*=\s*guard\(/.test(seg), "标题组词台「合并到…」应走 guard");
  ok(/wipe\.onclick\s*=\s*guard\(/.test(seg), "标题组词台「整类删除」应走 guard");
  ok(/const askText\s*=/.test(seg) && /const askYes\s*=/.test(seg), "标题组词台应有 askText / askYes 兜底");
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
