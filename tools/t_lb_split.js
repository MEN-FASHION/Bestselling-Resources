/* 趋势上升榜前台大图面板 · 图案三列与视觉背景分列（20261102X）
   需求（用户报的现象）：前台只显示「图案元素」，图案类型/结构部件没分开；
   视觉背景也没分开；面料整组不显示。
   本测试锁四件事：
     1) v10 老数据（三样挤在 element_tags）也要在前台分成 图案类型 / 图案元素 / 结构部件
     2) 背景旧值（无 室内·/室外· 前缀）要改写成新值并落进「视觉 · 背景」
     3) 面料有值才出现，没值不出现（列不存在时的表现）
     4) 同一个词不重复出现；认不出的老词仍留在图案元素，不静默丢掉 */
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

/* 先加载词表（与页面一致：rank-enums.js 在前，rank.js 在后） */
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "rank-enums.js"), "utf8"), ctx, { filename: "rank-enums.js" });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8"), ctx, { filename: "rank.js" });
const T = fakeWin.__RANK_T;
ok("测试钩子已挂出", !!T);
ok("词表已挂到 APP_ENUM（面板兜底取它）", !!(fakeWin.APP_ENUM && fakeWin.APP_ENUM["图案类型"] && fakeWin.APP_ENUM["结构部件"]));

/* 按组名取该组的取值 */
const g = (gs, name) => { const x = gs.filter(v => v[0] === name)[0]; return x ? x[1].slice() : null; };

/* ---------------- 1. v10 老数据：三样挤在 element_tags ---------------- */
console.log("\n[1] v10 老数据（图案未分列）");
T.set({ tags: { u1: {
  style_tags: ["街头潮流"], culture_tags: [], psych_tags: [], festival_tags: [],
  visual_tags: ["街头·墙面栏杆", "留白构图", "摆拍"],     /* 旧背景值 + 画面构图 + 呈现主体 */
  element_tags: ["格纹", "拉链", "骷髅", "卡通图案"],       /* 纹样 + 结构件 + 元素 + v10 老词 */
  craft_tags: ["刺绣"], shoot_tags: ["模拍"], fit_tags: ["领型·圆领"],
  pattern_tags: [], struct_tags: [], fabric_tags: []
} } });
/* 用 lbTagsHtml 走真实路径：它内部会从 TAG_INDEX 取 */
const html1 = T.lbTagsHtml("u1");
ok("面板有内容", html1.length > 0);
ok("出现「图案类型」组", html1.indexOf("图案类型") >= 0);
ok("出现「图案元素」组", html1.indexOf("图案元素") >= 0);
ok("出现「结构部件」组", html1.indexOf("结构部件") >= 0);
ok("格纹落在图案类型", /图案类型<\/div><div class="rk-lb-tc"><i>格纹<\/i>/.test(html1), html1.slice(0, 400));
ok("拉链落在结构部件", /结构部件<\/div><div class="rk-lb-tc"><i>拉链<\/i>/.test(html1));
ok("骷髅落在图案元素", /图案元素<\/div><div class="rk-lb-tc">[^<]*<i>骷髅<\/i>|图案元素<\/div><div class="rk-lb-tc"><i>骷髅<\/i>/.test(html1));
ok("v10 老词「卡通图案」仍留在图案元素（不丢）", html1.indexOf("卡通图案") >= 0);
ok("旧背景值被改写成新值", html1.indexOf("室外·街头·墙面栏杆") >= 0);
ok("旧值原样不再出现", html1.indexOf(">街头·墙面栏杆<") < 0);
ok("背景落进「视觉 · 背景」组", /视觉 · 背景<\/div><div class="rk-lb-tc"><i>室外·街头·墙面栏杆<\/i>/.test(html1));
ok("构图落进「视觉 · 构图」组", /视觉 · 构图<\/div><div class="rk-lb-tc"><i>留白构图<\/i>/.test(html1));
ok("主体落进「视觉 · 主体」组", /视觉 · 主体<\/div><div class="rk-lb-tc"><i>摆拍<\/i>/.test(html1));
ok("没有出现「视觉 · 其他」兜底组", html1.indexOf("视觉 · 其他") < 0);
ok("面料无值时整组不出现", html1.indexOf("面料") < 0);

/* ---------------- 2. v11 新数据：本来就在各自列 ---------------- */
console.log("\n[2] v11 新数据（已经分列）");
T.set({ tags: { u2: {
  style_tags: [], culture_tags: [], psych_tags: [], festival_tags: [],
  visual_tags: ["室内·客厅·沙发茶几"],
  element_tags: ["骷髅"], pattern_tags: ["格纹"], struct_tags: ["拉链"],
  craft_tags: [], shoot_tags: [], fit_tags: [], fabric_tags: ["纯棉（100%棉）"]
} } });
const html2 = T.lbTagsHtml("u2");
ok("图案类型仍是格纹", /图案类型<\/div><div class="rk-lb-tc"><i>格纹<\/i>/.test(html2));
ok("结构部件仍是拉链", /结构部件<\/div><div class="rk-lb-tc"><i>拉链<\/i>/.test(html2));
ok("图案元素仍是骷髅", /图案元素<\/div><div class="rk-lb-tc"><i>骷髅<\/i>/.test(html2));
ok("面料有值时出现", /面料<\/div><div class="rk-lb-tc"><i>纯棉（100%棉）<\/i>/.test(html2));
ok("面料候选池（枚举外词）也照常显示", (function () {
  T.set({ tags: { u3: { visual_tags: [], element_tags: [], pattern_tags: [], struct_tags: [],
    fabric_tags: ["羊毛混纺（毛+涤）", "纯棉（100%棉）"], style_tags: [], culture_tags: [], psych_tags: [],
    festival_tags: [], craft_tags: [], shoot_tags: [], fit_tags: [] } } });
  const h = T.lbTagsHtml("u3");
  return h.indexOf("羊毛混纺（毛+涤）") >= 0 && /面料<\/div>/.test(h);
})());

/* ---------------- 3. 不重复、不丢 ---------------- */
console.log("\n[3] 去重与兜底");
T.set({ tags: { u4: {
  visual_tags: ["室内·客厅·沙发茶几"], element_tags: ["拉链", "格纹"],
  pattern_tags: ["格纹"], struct_tags: ["拉链"], fabric_tags: [],
  style_tags: [], culture_tags: [], psych_tags: [], festival_tags: [], craft_tags: [], shoot_tags: [], fit_tags: []
} } });
const html4 = T.lbTagsHtml("u4");
const cnt = (s) => (html4.match(new RegExp("<i>" + s + "</i>", "g")) || []).length;
ok("格纹只出现一次", cnt("格纹") === 1, String(cnt("格纹")));
ok("拉链只出现一次", cnt("拉链") === 1, String(cnt("拉链")));

/* ---------------- 4. 空标签不渲染 ---------------- */
console.log("\n[4] 边界");
T.set({ tags: { u5: { visual_tags: [], element_tags: [], pattern_tags: [], struct_tags: [], fabric_tags: [],
  style_tags: [], culture_tags: [], psych_tags: [], festival_tags: [], craft_tags: [], shoot_tags: [], fit_tags: [] } } });
ok("全空不输出面板", T.lbTagsHtml("u5") === "");
ok("索引里没有的地址返回空", T.lbTagsHtml("nope") === "");

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
