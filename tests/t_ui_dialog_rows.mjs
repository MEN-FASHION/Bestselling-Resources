/* 20261111AF · 站内确认弹窗 + 按视觉行删除
 *
 * 两件事：
 * 1) 全站不再弹浏览器原生 confirm / alert（那是浏览器自己画的框，位置在页面顶部，
 *    还会弹「阻止此页面创建更多对话框」）。改成站内弹窗 uiConfirm / uiAlert。
 * 2) 「删除整行」之前其实是整个类目（190 张），真正的「一排图」删除缺失。
 *    现在类目头叫「清空该类目」，每个视觉行行尾另有「删此行(N)」，两个功能分开。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

/* ---------- 一、弹窗组件本身 ---------- */
const DLG = read("js/ui-dialog.js");
ok(/window\.uiConfirm\s*=/.test(DLG), "缺少 uiConfirm 导出");
ok(/window\.uiAlert\s*=/.test(DLG), "缺少 uiAlert 导出");
ok(/window\.uiPrompt\s*=/.test(DLG), "缺少 uiPrompt 导出（原生输入框也要换掉）");
ok(/return null/.test(DLG) || /resolve\(val \?/.test(DLG), "uiPrompt 取消时应返回 null（与原生语义一致）");
ok(/Promise/.test(DLG), "uiConfirm 应返回 Promise（供 await 使用）");
ok(/uid-mask/.test(DLG) && /uid-box/.test(DLG), "缺少弹窗结构与样式");
ok(/Escape/.test(DLG) && /Enter/.test(DLG), "应支持 Esc 取消 / Enter 确定");
ok(/e\.target === mask/.test(DLG), "点遮罩应可取消");
ok(/if \(busy\)/.test(DLG), "已有一个弹窗时不应叠框");

/* ---------- 二、所有页面都必须引入 ---------- */
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
ok(pages.length >= 10, "页面数量异常：" + pages.length);
pages.forEach((f) => {
  ok(read(f).indexOf("js/ui-dialog.js") >= 0, f + " 未引入 ui-dialog.js");
});

/* ---------- 三、全站不得再有原生 confirm / alert ---------- */
const jsFiles = fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js"));
let nativeHits = [];
jsFiles.forEach((f) => {
  if (f === "ui-dialog.js") return;
  const s = read("js/" + f);
  const hits = s.split("\n").filter((ln) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return false;            // 注释
    if (/uiConfirm\(|uiAlert\(|ui-dialog/.test(ln)) return false; // 已替换
    return /\bwindow\.(confirm|alert|prompt)\s*\(|(?<![\w$.])(confirm|alert|prompt)\s*\(/.test(ln);
  });
  if (hits.length) nativeHits.push(f + "(" + hits.length + "): " + hits[0].trim().slice(0, 60));
});
ok(nativeHits.length === 0, "仍有原生 confirm / alert / prompt 调用：\n    " + nativeHits.join("\n    "));

/* ---------- 四、用了 await 的文件必须语法合法 ---------- */
import { execFileSync } from "child_process";
let bad = [];
jsFiles.forEach((f) => {
  try {
    execFileSync("node", ["--check", path.join(ROOT, "js", f)], { stdio: "pipe" });
  } catch (e) {
    bad.push(f);
  }
});
ok(bad.length === 0, "语法检查未通过：" + bad.join(", "));

/* ---------- 五、视觉行删除：实际跑一遍渲染 ---------- */
function mkEl(tag) {
  const e = {
    tagName: (tag || "div").toUpperCase(), children: [], style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    _html: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    textContent: "", value: "", className: "", type: "", title: "", id: "", src: "", checked: false,
    clientWidth: 900, clientHeight: 400,
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild() {}, remove() {}, insertBefore() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl("div"); }, querySelectorAll() { return []; },
    get firstChild() { return this.children[0] || null; },
    onclick: null, onchange: null, onerror: null, oninput: null,
    focus() {}, click() {}, add() {}, cloneNode() { return mkEl(tag); },
    closest() { return null; }, contains() { return false; }, matches() { return false; },
  };
  e.parentNode = null;
  return e;
}

const CZ = read("js/admin-channelzone.js");
ok(/function vcolsOf\(/.test(CZ), "缺少 vcolsOf 列数计算");
ok(/CZ_MIN_W = 150/.test(CZ), "列宽基准应与栅格 minmax(150px) 一致");
ok(/"repeat\(" \+ cols/.test(CZ), "视觉行应按列数显式设栅格");
ok(/ch\.map\(function \(r\) \{ return r\.id; \}\)/.test(CZ), "删此行应删除该行内的图（按 id）");
ok(/这个类目下的全部图片/.test(CZ), "类目组按钮应说明它是「整个类目」");

/* 结构上确认：删此行传的是这一排的 id，不是整个类目 */
const rowDel = CZ.slice(CZ.indexOf("cz-vrow-del"), CZ.indexOf("cz-vrow-del") + 900);
ok(/delMany\(k, ch\.map/.test(rowDel), "「删此行」应只提交这一排的 id");
ok(!/g\.items\.map\(function \(r\) \{ return r\.id; \}\)\s*,\s*"这一排/.test(CZ),
  "「删此行」不能误用整个类目的 id 列表");

/* ---------- 六、窗口变化要重算视觉行 ---------- */
ok(/addEventListener\("resize"/.test(CZ), "窗口尺寸变化后应重算每行张数");
ok(/renderGrid\(k\)/.test(CZ), "重算后应重渲染图墙");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
