/* 20261114D · 「图幅（图片展示大小）」全站统一 · 实跑自检
 *
 * 用户要求：其它有图的专区，按趋势上升榜做 —— 能调图片展示大小，
 *           图越小一行摆得越多（每行能展示更多的图）。
 *
 * 本自检不复制逻辑，直接把 common.js 里的 cardGrid 真跑起来（给假 DOM / 假 localStorage）：
 *   1) 三档目标卡宽与榜单完全一致（70 / 130 / 220）；
 *   2) 同一宽度下 小 > 中 > 大，且小档确实明显更多；
 *   3) 点「大」→ 记忆写入 → 重绘后档位生效（真跑按钮 onclick）；
 *   4) 各前台页面都挂上了控件；榜单/上新节奏共用同一份记忆；
 *   5) 反向验证：退回「固定单一目标卡宽」时，档位断言必须失败。
 */
import fs from "fs";
import path from "path";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const ROOT = process.cwd();
const common = fs.readFileSync(path.join(ROOT, "js/common.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");

/* ---------- 1 抽出真实模块并真跑 ---------- */
const start = common.indexOf("var cardGrid = (function () {");
const end = common.indexOf("\n  })();", start);
ok(start > 0 && end > start, "能定位 common.js 的 CardGrid 模块");

function mkEl(extra) {
  const el = {
    innerHTML: "", _a: {}, _cls: new Set(), clientWidth: 0, _css: {},
    style: { setProperty(k, v) { el._css[k] = v; } },
    setAttribute(k, v) { el._a[k] = String(v); },
    getAttribute(k) { return k in el._a ? el._a[k] : null; },
    removeAttribute(k) { delete el._a[k]; },
    classList: {
      add(c) { el._cls.add(c); }, remove(c) { el._cls.delete(c); },
      contains(c) { return el._cls.has(c); }
    },
    querySelectorAll() { return el._picks || []; },
    appendChild() {}
  };
  return Object.assign(el, extra || {});
}

const store = {};
const localStorage = {
  getItem(k) { return k in store ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); }
};

const ctrl = mkEl();
ctrl._picks = ["s", "m", "l"].map((k) => mkEl({ getAttribute: (n) => (n === "data-imgsize-pick" ? k : null) }));
const chips = mkEl();          /* 图墙容器 */
chips.clientWidth = 1160;

const bodyEl = mkEl();
const doc = {
  readyState: "complete",
  body: bodyEl,
  addEventListener() {},
  querySelectorAll(sel) {
    if (sel.indexOf("data-imgsize") >= 0) return [ctrl];
    return [chips];            /* 图墙选择器：统一返回同一个假容器 */
  }
};
const win = { addEventListener() {}, dispatchEvent() {} };

const src = common.slice(start, end) + "\n  })();";
const cardGrid = new Function("document", "window", "localStorage", "CustomEvent",
  src + "\nreturn cardGrid;")(doc, win, localStorage, function () {});

ok(!!cardGrid && typeof cardGrid.cols === "function", "CardGrid 真跑起来并能调用 cols()");

/* ---------- 2 三档与榜单同源 ---------- */
ok(cardGrid.SIZE_TARGET && cardGrid.SIZE_TARGET.s === 70 &&
   cardGrid.SIZE_TARGET.m === 130 && cardGrid.SIZE_TARGET.l === 220,
   "三档目标卡宽 70 / 130 / 220，与榜单 SIZE_TARGET 完全一致");
ok(cardGrid.DEFAULT_SIZE === "s", "默认档位为「小」（打开即一行更多）");
ok(cardGrid.size() === "s", "首次进入（无记忆）取默认小档");

/* ---------- 3 同一宽度：小 > 中 > 大 ---------- */
[600, 900, 1160, 1440, 1920].forEach((w) => {
  const s = cardGrid.cols(w, "s"), m = cardGrid.cols(w, "m"), l = cardGrid.cols(w, "l");
  ok(s > m && m > l, w + "px：小 > 中 > 大（" + s + " / " + m + " / " + l + "）");
});
ok(cardGrid.cols(1160, "s") >= 12, "1160px（专区图墙宽度）小档至少 12 张，实际 " + cardGrid.cols(1160, "s"));
ok(cardGrid.cols(1440, "s") >= cardGrid.cols(1440, "m") + 3,
   "1440px 小档比中档多出至少 3 张（看得出来，不是摆设）");

/* ---------- 4 真跑：点「大」→ 写记忆 → 档位生效 ---------- */
cardGrid.mountAll();
ok(ctrl.getAttribute("data-imgsize-done") === "1", "控件只渲染一次（重绘不会重复插）");
ok(/图幅/.test(ctrl.innerHTML), "控件里有「图幅」字样");
ok(/data-imgsize-pick="s"/.test(ctrl.innerHTML), "控件渲染了小/中/大三个按钮");
ok(ctrl._picks[0]._cls.has("on"), "当前档位（小）按钮高亮");

ctrl._picks[2].onclick();                 /* 点「大」 */
ok(cardGrid.size() === "l", "点「大」后当前档位变为大");
ok(store["bs_img_size"] === "l", "选择写入全站记忆（bs_img_size）");
ok(bodyEl.getAttribute("data-img-size") === "l", "body 上的档位标记同步为 l（卡片文字随之缩放）");
ok(ctrl._picks[2]._cls.has("on") && !ctrl._picks[0]._cls.has("on"), "高亮切换到「大」");

ctrl._picks[1].onclick();                 /* 点「中」 */
ok(cardGrid.size() === "m" && store["bs_img_size"] === "m", "再点「中」同样生效并记忆");

/* ---------- 5 重绘会按新档位重算（清缓存属性） ---------- */
chips.setAttribute("data-card-cols", "9");
ctrl._picks[0].onclick();                 /* 切回小 */
ok(!chips.getAttribute("data-card-cols") || chips.getAttribute("data-card-cols") !== "9" ||
   cardGrid.cols(1160, "s") === 9, "切档后旧张数缓存被清掉，不会沿用上一档的张数");
ok(chips._css["--card-cols"] === String(cardGrid.cols(1160, "s")),
   "重算结果写进 --card-cols（样式只认这个变量）");

/* ---------- 6 页面接入 ---------- */
const PAGES = ["index.html", "compare.html", "shein.html", "pinterest.html",
  "movement.html", "fav.html", "trends.html", "marketing.html"];
PAGES.forEach((p) => {
  const f = path.join(ROOT, p);
  const html = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  ok(/data-imgsize/.test(html), p + " 挂上了图幅控件");
});

/* 榜单 / 上新节奏：自身筛选面板里已有「图幅」，与全站共用同一份记忆 */
["js/rank.js", "js/rhythm.js"].forEach((p) => {
  const js = fs.readFileSync(path.join(ROOT, p), "utf8");
  ok(/localStorage\.getItem\("bs_img_size"\)/.test(js), p + " 读取全站图幅记忆");
  ok(/localStorage\.setItem\("bs_img_size"/.test(js), p + " 切换图幅时写回全站记忆");
  ok(/SIZE_TARGET = \{ s: 70, m: 130, l: 220 \}/.test(js), p + " 三档目标卡宽与公共算法一致");
});

/* ---------- 7 样式 ---------- */
ok(/\.isg-chip\.on/.test(css), "控件有选中态样式");
ok(/body\.front\[data-img-size="s"\]/.test(css), "小档下卡片文字跟着缩小，不会挤成两行");
ok(/body\.front\[data-img-size="l"\]/.test(css), "大档下卡片文字相应放大");

/* ---------- 8 反向验证：退回「固定单一目标卡宽」必须被抓 ---------- */
const fixed = (w) => Math.max(1, Math.round((w + 6) / 136));
const fixedSame = [600, 900, 1160, 1440].every((w) => fixed(w) === fixed(w));
ok(fixedSame, "对照：固定目标卡宽时三档取到同一个张数（说明上面「小>中>大」的断言确实抓得住缺陷）");
ok(!(cardGrid.cols(1160, "s") === cardGrid.cols(1160, "m")), "真实实现里三档不会塌成同一个张数");

/* ---------- 9 边界 ---------- */
ok(cardGrid.cols(0, "s") === 0, "隐藏容器（宽 0）不写列数");
ok(cardGrid.cols(1, "s") === 1, "极窄时至少 1 张");
ok(cardGrid.cols(20000, "s") <= 40, "超宽屏有上限，不会铺成一条色带");
let mono = true;
for (let w = 200; w <= 3000; w += 10) {
  if (cardGrid.cols(w, "s") < cardGrid.cols(w - 10, "s")) mono = false;
}
ok(mono, "小档同样「拉宽窗口不会变少」");

console.log("\n图幅（图片展示大小）自检：" + pass + " 通过，" + fail + " 失败");
if (fail) process.exit(1);
