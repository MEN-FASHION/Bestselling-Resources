/* 趋势上升榜 · 大图标签面板「未打标提示」自测（20261102I）
   需求：没有打标的图片，左栏不要再出现「这张图还没有打标 / 到后台导出打标表补齐后回填」
   这类提醒（那个入口也不在数据看板了）。没标签就整块不渲染。
   同时守住反向：有标签时必须照常显示打标信息，不能一起被删掉。 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };

const listeners = {};
const fakeDoc = {
  readyState: "loading",
  addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  body: { appendChild() {} }, documentElement: { style: {} },
};
const fakeWin = { __RANK_TEST__: true, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
const ctx = {
  window: fakeWin, document: fakeDoc, console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
  localStorage: { getItem: () => null, setItem() {} },
  location: { href: "", search: "" }, navigator: { userAgent: "node" },
};
ctx.window.document = fakeDoc;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8"), ctx, { filename: "rank.js" });

const T = fakeWin.__RANK_T;
ok("测试钩子已挂出", !!T);
ok("钩子暴露了面板渲染函数", typeof T.lbTagsHtml === "function");

const BANNED = ["还没有打标", "导出打标表", "补齐后回填", "这里就会出现"];

T.set({
  facets: { sites: ["美国站"], periods: ["2026-W43"], categories: ["T恤"] },
  groups: [],
  tags: {
    "https://x/a.jpg": {
      style_tags: ["运动"], visual_tags: ["室内·棚拍·纯白底"], shoot_tags: ["平铺拍"],
      craft_tags: ["无工艺"], element_tags: ["条纹"], fit_tags: ["领型·圆领", "版型·常规"],
      culture_tags: ["无特定文化"], psych_tags: ["个性表达"],
    },
  },
});

/* ---------------- 1. 未打标：整块不出现 ---------------- */
console.log("\n[1] 未打标图片");
let h = T.lbTagsHtml("https://x/none.jpg");
ok("没有标签时返回空串（不渲染占位块）", h === "", JSON.stringify(h));
BANNED.forEach(function (w) {
  ok("不含「" + w + "」", h.indexOf(w) < 0);
});
ok('不含「打标信息」标题', h.indexOf("打标信息") < 0);
ok("不含占位样式类 rk-lb-tempty", h.indexOf("rk-lb-tempty") < 0);

/* 空对象标签（有记录但所有维度为空）也应视为未打标 */
T.set({ tags: { "https://x/empty.jpg": {} } });
h = T.lbTagsHtml("https://x/empty.jpg");
ok("标签记录为空对象时同样不渲染", h === "", JSON.stringify(h));

/* 维度字段存在但数组为空 */
T.set({ tags: { "https://x/blank.jpg": { style_tags: [], shoot_tags: [] } } });
h = T.lbTagsHtml("https://x/blank.jpg");
ok("维度为空数组时同样不渲染", h === "", JSON.stringify(h));

/* ---------------- 2. 有打标：照常显示 ---------------- */
console.log("\n[2] 已打标图片");
T.set({
  tags: {
    "https://x/a.jpg": {
      style_tags: ["运动"], visual_tags: ["室内·棚拍·纯白底"], shoot_tags: ["平铺拍"],
      craft_tags: ["无工艺"], element_tags: ["条纹"], fit_tags: ["领型·圆领", "版型·常规"],
      culture_tags: ["无特定文化"], psych_tags: ["个性表达"],
    },
  },
});
h = T.lbTagsHtml("https://x/a.jpg");
ok("有标签时正常渲染", h.length > 0 && h.indexOf('class="rk-lb-tags"') >= 0);
ok("显示「打标信息」标题", h.indexOf("打标信息") >= 0);
ok("显示风格分组", h.indexOf("风格") >= 0 && h.indexOf("运动") >= 0);
ok("显示拍摄方式取值", h.indexOf("平铺拍") >= 0);
ok("显示版型拆出的部位", h.indexOf("圆领") >= 0);
ok("有标签时也不出现未打标文案", BANNED.every(function (w) { return h.indexOf(w) < 0; }));

/* ---------------- 3. 取值口径不变 ---------------- */
console.log("\n[3] 边界与兼容");
ok("带查询串的地址也能命中", T.lbTagsHtml("https://x/a.jpg?w=1").indexOf("运动") >= 0);
ok("未收录地址返回空串", T.lbTagsHtml("https://x/unknown.jpg") === "");
ok("传入 undefined 不抛错", (function () { try { return T.lbTagsHtml(undefined) === ""; } catch (e) { return false; } })());

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
