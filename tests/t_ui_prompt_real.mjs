/* 20261114H · 输入弹窗（uiPrompt）真实执行自检
 *
 * 事故背景：后台「类目清理…」里点「合并到…」没有任何反应，不弹框、不报错。
 * 原因：ui-dialog.js 里 `var foot` 的声明写在「需要输入时」的分支之后，
 *   分支内先执行 box.insertBefore(input, foot)（foot 此时为 undefined，等价于追加），
 *   紧接着 box.appendChild(foot) —— foot 是 undefined，浏览器直接抛 TypeError。
 *   异常发生在 Promise executor 里 → Promise 变成 rejected → await 抛错 →
 *   按钮的 onclick 静默中断，界面上什么都没发生。
 *
 * 关键：假 DOM 的 appendChild / insertBefore **必须严格校验参数是节点**，
 * 否则像旧测试那样「push 进去就完事」，永远抓不到这个缺陷。
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
    removeChild(c) { const i = e.childNodes.indexOf(c); if (i >= 0) e.childNodes.splice(i, 1); return c; },
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

function boot() {
  const body = mkEl("body");
  const document = {
    readyState: "complete", body, documentElement: mkEl("html"), head: mkEl("head"),
    getElementById() { return null; },
    createElement(t) { return mkEl(t); },
    createTextNode(t) { return { nodeValue: t }; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl("div"); }, querySelectorAll() { return []; },
  };
  const win = { document, console, setTimeout, clearTimeout, Promise, String, Error };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(read("js/ui-dialog.js"), win, { filename: "ui-dialog.js" });
  return { win, body };
}

const footOf = (box) => box.childNodes.filter((n) => n.className && n.className.indexOf("uid-foot") >= 0)[0];

/* ---------- 一、uiPrompt 不得抛错，且真的挂出弹窗 ---------- */
{
  const { win, body } = boot();
  let err = null;
  const p = win.uiPrompt("把「运动功能服」的全部条目并入哪个类目？", "运动功能服");
  p.catch((e) => { err = e; });
  await null;
  ok(err === null, "uiPrompt 不应抛异常（实际：" + (err && err.message) + "）");
  ok(body.childNodes.length > 0, "uiPrompt 应在页面上挂出遮罩与弹窗");
}

/* ---------- 二、弹窗里有输入框、带默认值、位于按钮之上 ---------- */
{
  const { win, body } = boot();
  const p = win.uiPrompt("改名", "旧名字");
  p.catch(() => {});
  const box = body.childNodes[0] && body.childNodes[0].childNodes[0];
  const input = box && box.childNodes.filter((n) => n.tagName === "INPUT")[0];
  const foot = box && footOf(box);
  ok(!!input, "uiPrompt 弹窗内应有 input");
  ok(!!input && input.value === "旧名字", "input 应带上默认值");
  ok(!!foot, "弹窗底部按钮区应存在");
  ok(!!input && !!foot && box.childNodes.indexOf(input) < box.childNodes.indexOf(foot), "输入框应在按钮之上");
}

/* ---------- 三、确定要把输入内容返回 ---------- */
{
  const { win, body } = boot();
  const p = win.uiPrompt("改名", "旧");
  p.catch(() => {});
  const box = body.childNodes[0].childNodes[0];
  box.childNodes.filter((n) => n.tagName === "INPUT")[0].value = "打底压缩";
  const foot = footOf(box);
  foot.childNodes[foot.childNodes.length - 1].onclick();
  const v = await p;
  ok(v === "打底压缩", "确定后应返回输入内容（实际：" + JSON.stringify(v) + "）");
  ok(body.childNodes.length === 0, "确定后应移除遮罩");
}

/* ---------- 四、取消返回 null ---------- */
{
  const { win, body } = boot();
  const p = win.uiPrompt("改名", "旧");
  p.catch(() => {});
  const box = body.childNodes[0].childNodes[0];
  footOf(box).childNodes[0].onclick();
  const v = await p;
  ok(v === null, "取消应返回 null（实际：" + JSON.stringify(v) + "）");
}

/* ---------- 五、uiConfirm 回归（无输入框） ---------- */
{
  const { win, body } = boot();
  const p = win.uiConfirm("删除？");
  p.catch(() => {});
  const box = body.childNodes[0].childNodes[0];
  const foot = footOf(box);
  foot.childNodes[foot.childNodes.length - 1].onclick();
  const v = await p;
  ok(v === true, "uiConfirm 点确定应返回 true");
  ok(box.childNodes.filter((n) => n.tagName === "INPUT").length === 0, "uiConfirm 不应有输入框");
}

/* ---------- 六、合并按钮确实走 uiPrompt + 迁移 ---------- */
{
  const AR = read("js/admin-rank.js");
  const i = AR.indexOf("合并到…");
  const seg = AR.slice(i, i + 1000);
  /* 20261114I：改为 askText —— 站内弹窗优先，弹窗不可用时退回原生 prompt，
     保证「点了永远有反应」。askText 内部仍然调用 uiPrompt。 */
  ok(/askText\(/.test(seg), "「合并到…」应使用 askText（内部走 uiPrompt）让用户填目标类目");
  ok(/uiPrompt\(/.test(AR.slice(AR.indexOf("const askText"), AR.indexOf("const askText") + 300)), "askText 内部应调用 uiPrompt");
  ok(/renameRankCategory/.test(seg), "「合并到…」应调用 renameRankCategory 迁移条目");
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
