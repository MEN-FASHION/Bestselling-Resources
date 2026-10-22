/* ============================================================================
 * 前台布局回归：侧边栏必须常显、类目不得压到顶部菜单、类目搜索框不得被自动填充
 *
 * 背景（真实事故）：
 *   20261021 某轮把前台侧栏改成了「54px 细轨 + 鼠标移入才展开」的悬浮抽屉，
 *   带来三个用户可见问题：
 *     ① 类目看不见了，要先去左上角碰一下才出来；
 *     ② 展开时 z-index 55 > 顶部菜单 50，类目被画到菜单上面；
 *     ③ 类目搜索框被浏览器当成账号框自动填充了登录邮箱，
 *        用户看到的现象是「为什么侧边栏会显示我的账号」。
 *   本套件把这三条钉住，防止再被"优化"回去。
 *
 * 跑法：node tools/verify_front_layout.js [项目根]
 * ========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = process.argv[2] || ".";

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name + (extra ? "  [" + extra + "]" : "")); console.log("  ✗ " + name + (extra ? "  [" + extra + "]" : "")); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), "utf8"); }

/* 取某段 CSS 里「某个选择器之后的花括号块」内容，找不到返回 "" */
function block(css, needle) {
  const i = css.indexOf(needle);
  if (i < 0) return "";
  let s = css.indexOf("{", i);
  if (s < 0) return "";
  let d = 0;
  for (let k = s; k < css.length; k++) {
    if (css[k] === "{") d++;
    else if (css[k] === "}") { d--; if (d === 0) return css.slice(s + 1, k); }
  }
  return "";
}
/* 从 needle 开始截取 n 字符，用于看"这一段里有没有某条规则" */
function sliceFrom(css, needle, n) {
  const i = css.indexOf(needle);
  return i < 0 ? "" : css.slice(i, i + (n || 1200));
}

async function main() {
console.log("== 前台布局回归：常显侧栏 / 层级 / 搜索框自动填充 ==");

/* ---------------------------------------------------------------
 * 一、侧边栏必须是「常显」形态，抽屉形态的三件套都不许再出现
 * ------------------------------------------------------------- */
console.log("\n[1] 侧边栏恢复常显（不是 54px 细轨抽屉）");
{
  const css = read("css/style.css");

  ok("样式里不再有 54px 细轨列宽", css.indexOf("grid-template-columns: 54px 1fr") < 0);
  ok("样式里不再有 118px 小卡片高度（抽屉收起态）", css.indexOf("max-height: 118px") < 0);
  {
    /* 只查前台侧栏这一段：后台「智能打标」里有个竖排小按钮，与本次无关 */
    const iFront = css.indexOf("body.front:not(.mk-page) .sidebar");
    const frontSeg = iFront < 0 ? "" : css.slice(iFront, iFront + 900);
    ok("前台侧栏规则里不再有竖排标题（writing-mode: vertical-rl）",
      frontSeg.indexOf("vertical-rl") < 0, frontSeg.slice(0, 60));
  }
  ok("样式里不再有 rail-open 展开态钩子", css.indexOf("rail-open") < 0);
  ok("样式里不再有「›」把手（::after content: \"›\"）", css.indexOf('content: "›"') < 0);

  /* 前台布局列宽：左侧必须给类目留出真实宽度 */
  const lay = sliceFrom(css, "body.front:not(.mk-page) .gallery-layout", 300);
  ok("前台布局左侧列宽恢复为 210px", /grid-template-columns:\s*210px\s+1fr/.test(lay), lay.slice(0, 80));

  /* 侧栏本体：常显、可滚动、跟随滚动 */
  const sb = sliceFrom(css, "body.front:not(.mk-page) .sidebar {", 400);
  ok("侧栏恢复为 sticky 跟随（top: 78px）", /position:\s*sticky/.test(sb) && /top:\s*78px/.test(sb), sb.slice(0, 80));
  ok("侧栏可滚动（overflow-y: auto）", /overflow-y:\s*auto/.test(sb));
  ok("侧栏不再固定窄宽（width: auto）", /width:\s*auto/.test(sb), sb.slice(0, 80));

  /* 类目常显：不允许 opacity:0 隐藏 */
  const menu = sliceFrom(css, "body.front:not(.mk-page) .sidebar .cat-menu", 220);
  ok("类目菜单常显（opacity: 1，不是 0）", /opacity:\s*1/.test(menu) && !/opacity:\s*0/.test(menu), menu.slice(0, 90));
  ok("类目菜单不吃掉点击（pointer-events: auto）", /pointer-events:\s*auto/.test(menu));

  /* 标题横排 */
  const head = sliceFrom(css, "body.front:not(.mk-page) .sidebar .side-head", 320);
  ok("标题恢复横排（writing-mode: horizontal-tb）", /writing-mode:\s*horizontal-tb/.test(head), head.slice(0, 90));
}

/* ---------------------------------------------------------------
 * 二、层级：类目绝不能压到顶部菜单上面
 * ------------------------------------------------------------- */
console.log("\n[2] 层级：侧栏不得盖住顶部菜单");
{
  const css = read("css/style.css");
  const topbar = block(css, ".topbar {");
  const topZ = (topbar.match(/z-index:\s*(\d+)/) || [])[1];
  ok("顶部菜单有明确层级", !!topZ, topZ || "没读到");

  const sb = sliceFrom(css, "body.front:not(.mk-page) .sidebar {", 400);
  const sbZ = (sb.match(/z-index:\s*([a-z0-9]+)/) || [])[1];
  ok("侧栏不再使用 55 这类高于菜单的层级", sbZ !== "55", sbZ || "");
  ok("侧栏层级为 auto（或小于菜单）",
    sbZ === "auto" || (sbZ && Number(sbZ) < Number(topZ)), "侧栏=" + (sbZ || "无") + " 菜单=" + (topZ || "无"));

  /* 旧机器：整段样式里不允许再出现 z-index: 55 之类的抽屉层级 */
  ok("全站不再出现侧栏专用的 z-index: 55", css.indexOf("z-index: 55") < 0);
}

/* ---------------------------------------------------------------
 * 三、抽屉脚本不该再被任何前台页面加载
 * ------------------------------------------------------------- */
console.log("\n[3] 抽屉控制器不再加载");
{
  ["index.html", "rank.html", "trends.html"].forEach((f) => {
    const html = read(f);
    ok(f + " 不再引入 rail.js", html.indexOf("rail.js") < 0);
  });
  /* 文件本身保留无妨，但不能再被引用 */
  ok("rail.js 文件存在但已无人引用（保留以便回溯）", fs.existsSync(path.join(ROOT, "js/rail.js")));
}

/* ---------------------------------------------------------------
 * 四、类目搜索框：不许被浏览器当成账号框自动填充
 *     （2026-10-22 线上问题：首次进入类目正常，点一下侧栏就全没了 ——
 *       Chrome 在首次交互时把登录邮箱填进这个框，关键字变成邮箱，
 *       类目全被过滤掉，页面显示"没有匹配的类目"。）
 * ------------------------------------------------------------- */
console.log("\n[4] 类目搜索框：拿掉自动填充");
{
  const cfg = read("js/config.js");
  const i = cfg.indexOf("function mountBox(");
  ok("能找到 mountBox 实现", i > 0);
  const seg = cfg.slice(i, i + 4200);

  ok("不再使用 type=\"search\"（会被账号填充误判）", !/el\.type\s*=\s*"search"/.test(seg));
  ok("改用 type=\"text\" + inputmode=search", /el\.type\s*=\s*"text"/.test(seg) && /inputMode\s*=\s*"search"/.test(seg));
  ok("autocomplete 用 new-password（off 对 Chrome 填充无效）",
    /el\.autocomplete\s*=\s*"new-password"/.test(seg) && !/el\.autocomplete\s*=\s*"off"/.test(seg));
  ok("给密码管理器忽略标记（data-lpignore / data-1p-ignore）",
    /data-lpignore/.test(seg) && /data-1p-ignore/.test(seg));
  ok("声明 data-form-type=other", /data-form-type".*other|data-form-type.*other/.test(seg));
  ok("name 不用通用词（改为 cat-filter-q）", /cat-filter-q/.test(seg));

  ok("初始只读，聚焦才可输入（只读框不会被填充）",
    /setAttribute\("readonly",\s*"readonly"\)/.test(seg) && /addEventListener\("focus"/.test(seg)
    && /removeAttribute\("readonly"\)/.test(seg));

  /* 兜底：用户没敲过却有值 → 一律清空 */
  ok("有「用户没按键却有值就清空」的兜底", /dataset\.typed/.test(seg) && /el\.value\s*=\s*""/.test(seg));
  ok("typed 只由键盘/粘贴置位（input 事件不算，自动填充会触发 input）",
    /addEventListener\("keydown"/.test(seg) && /addEventListener\("paste"/.test(seg)
    && !/el\.oninput\s*=\s*function\s*\(\)\s*\{[^}]*dataset\.typed/.test(seg));
  ok("兜底不只扫一两次，改为持续守护（setInterval）", /setInterval\(/.test(seg), "");
  ok("守护有上限，不会一直跑", /clearInterval\(timer\)/.test(seg));

  /* 行为层硬兜底：邮箱绝不可能作为类目关键字生效 */
  const fe = read("js/frontend.js");
  ok("类目关键字含 @ 时直接丢弃（防止列表被过滤成空）",
    fe.indexOf('rawKw.indexOf("@"') >= 0 && fe.indexOf('CATS.kw("front", "")') >= 0);
  ok("兜底后把搜索框同步清空", /sb\.value !== CATS\.kw\("front"\)/.test(fe));
}

/* ---------------------------------------------------------------
 * 五、真跑：模拟浏览器自动填充后是否被清掉
 * ------------------------------------------------------------- */
console.log("\n[5] 真跑：模拟自动填充后是否被清掉");
{
  const code = read("js/config.js");
  let CURRENT = null;
  const docProxy = {
    getElementById: () => (CURRENT ? CURRENT.doc.getElementById.apply(null, arguments) : null),
    createElement: () => CURRENT.doc.createElement(),
  };
  const winProxy = { document: docProxy };
  const fn = new Function("window", "document", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    code + "\nreturn window.CAT_SEARCH;");
  const CAT = fn(winProxy, docProxy, setTimeout, clearTimeout, setInterval, clearInterval);
  ok("CAT_SEARCH 导出可调用", !!CAT && typeof CAT.mountBox === "function");

  function makeDom() {
    const created = [];
    const doc = {
      getElementById: (id) => created.find((e) => e.id === id) || null,
      createElement: () => {
        const el = {
          id: "", type: "", value: "", className: "", placeholder: "", title: "",
          dataset: {}, attrs: {}, handlers: {},
          setAttribute(k, v) { this.attrs[k] = v; },
          getAttribute(k) { return this.attrs[k]; },
          removeAttribute(k) { delete this.attrs[k]; },
          addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); },
          dispatch(t, ev) { (this.handlers[t] || []).forEach((f) => f(ev || {})); },
        };
        return el;
      },
    };
    const parent = { insertBefore(el) { created.push(el); } };
    const target = { parentNode: parent, ownerDocument: doc };
    const box = { doc, target, created };
    CURRENT = box;
    return box;
  }

  const d1 = makeDom();
  const calls = [];
  const el = CAT.mountBox(d1.target, "cat-search", "搜索类目…", (v) => calls.push(v));
  ok("挂载返回输入框", !!el);
  ok("输入框带抗填充属性", el && el.attrs["data-lpignore"] === "true" && el.getAttribute("name") === "cat-filter-q");
  ok("输入框不是 type=search", el && el.type === "text", el && el.type);
  ok("挂载后处于只读态", el && el.attrs["readonly"] === "readonly");
  el.dispatch("focus");
  ok("聚焦后解除只读", el.attrs["readonly"] === undefined);

  /* 模拟浏览器在 300ms 内把邮箱填进去 */
  el.value = "1062443632@qq.com";
  await new Promise((r) => setTimeout(r, 450));
  ok("自动填充的邮箱被清空", el.value === "", JSON.stringify(el.value));
  ok("清空后同步触发了筛选回调（列表回到全部）", calls.indexOf("") >= 0, JSON.stringify(calls));

  /* 模拟 Chrome 在首次交互之后才填（这正是线上漏网的那次） */
  calls.length = 0;
  el.value = "1062443632@qq.com";
  el.dispatch("input");                 /* 自动填充会触发 input，但不会有 keydown */
  await new Promise((r) => setTimeout(r, 700));
  ok("交互之后才被填充的邮箱同样被清掉", el.value === "", JSON.stringify(el.value));
  ok("并且不会因为 input 事件就认为用户输入过", !el.dataset.typed);

  /* 用户真实输入：不能被误清 */
  const d2 = makeDom();
  const el2 = CAT.mountBox(d2.target, "cat-search2", "搜索类目…", () => { });
  el2.dispatch("focus");
  el2.value = "连";
  el2.dispatch("keydown", { key: "连" });
  el2.dispatch("input");
  await new Promise((r) => setTimeout(r, 1400));
  ok("用户自己输入的「连」不会被兜底清掉", el2.value === "连", el2.value);

  /* 复用同一输入框时不该重复挂挂钩子 */
  const el3 = CAT.mountBox(d1.target, "cat-search", "搜索类目…", () => { });
  ok("重复挂载复用同一个输入框", el3 === el);
  ok("重复挂载不重复打兜底标记", el3.dataset.autofillGuard === "1");
  ok("重复挂载不重复挂键盘钩子", el3.dataset.typedHook === "1");
}

console.log("\n================ 汇总 ================");
console.log("PASS " + pass + " / FAIL " + fail);
if (fail) {
  console.log("\n失败项：");
  failures.forEach((f) => console.log("  · " + f));
  process.exit(1);
}
}

main().catch(function (e) { console.error(e); process.exit(1); });
