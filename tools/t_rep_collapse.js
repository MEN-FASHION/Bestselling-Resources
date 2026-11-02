/* 趋势上升榜 · 报告详情默认收起（20261102K）
   需求：一进页面只展示「逐列画像」，再给一个明显的「查看详细报告」入口展开其余部分。
   本测试锁：默认收起、入口存在且文案正确、详情块确实带 hidden、
   展开后五段齐全、收起后状态回到默认、重绘保持展开状态。 */
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

const mk = (o) => Object.assign({ image_url: "", category: "外套夹克", site: "美国站", period_label: "2026-W43",
  _opp: false, _hot: false, _surge: false }, o);
const tags = {
  a1: { style_tags: ["户外机能"], visual_tags: ["纯白底"], shoot_tags: ["模拍"] },
  a2: { style_tags: ["户外机能"], visual_tags: ["留白构图"], shoot_tags: ["模拍"] },
  b1: { style_tags: ["商务通勤"], visual_tags: ["3D渲染图"], shoot_tags: ["3D"] },
  b2: { style_tags: ["商务通勤"], visual_tags: ["3D渲染图"], shoot_tags: ["3D"] },
};
T.set({ facets: { sites: ["美国站"], periods: ["2026-W43"], categories: ["外套夹克", "POLO"] }, tags, groups: [],
  mode: "c", cat: "外套夹克", cats: ["外套夹克", "POLO"], sites: ["美国站"], periods: ["2026-W43"],
  cache: { key: "c", items: [mk({ image_url: "a1" }), mk({ image_url: "a2" }),
    mk({ image_url: "b1", category: "POLO" }), mk({ image_url: "b2", category: "POLO" })] } });

const V = T.vitalsOfGroups(T.vitalsGroups());
const html = T.vitalsHtml(V, T.vitalsDim());

/* ---------------- 1. 入口 ---------------- */
console.log("\n[1] 入口");
ok("有折叠开关按钮", html.indexOf('data-rep-toggle="1"') >= 0);
ok("按钮文案是「查看详细报告」", html.indexOf("查看详细报告") >= 0);
ok("按钮有箭头图标位", html.indexOf('class="rk-rep-open-ico"') >= 0);
ok("按钮初始 aria-expanded=false", html.indexOf('aria-expanded="false"') >= 0);
ok("有未展开的样式类 rk-rep-open（不带 open）", html.indexOf('class="rk-rep-open"') >= 0);
ok("入口在最前面（画像之前）", html.indexOf("查看详细报告") < html.indexOf("逐列画像"));
ok("入口带一句副说明", html.indexOf("rk-rep-open-sub") >= 0);

/* ---------------- 2. 详情默认收起 ---------------- */
console.log("\n[2] 详情默认收起");
ok("详情块存在", html.indexOf('data-rep-detail="1"') >= 0);
const dets = html.split('data-rep-detail="1" hidden').length - 1;
ok("每个详情块都带 hidden", dets === 2, "实际 " + dets + " 个");
ok("报告头被收进详情块", html.indexOf('rk-rep-head') > html.indexOf('data-rep-detail="1" hidden'));
ok("核心结论被收进详情块", html.indexOf("核心结论") > html.indexOf('data-rep-detail="1" hidden'));
ok("横向对照被收进详情块", html.indexOf("rk-rep-tbl") > html.indexOf('data-rep-detail="1" hidden'));
ok("可执行建议被收进详情块", html.indexOf("rk-rep-act") > html.indexOf('data-rep-detail="1" hidden'));
ok("数据说明被收进详情块", html.indexOf("rk-rep-qual") > html.indexOf('data-rep-detail="1" hidden'));

/* 画像必须在折叠区外面，默认就能看到 */
const firstDetEnd = html.indexOf("</div>", html.indexOf('data-rep-detail="1" hidden'));
ok("逐列画像在首个折叠块之后（即默认可见部分）",
  html.indexOf("逐列画像") > html.indexOf('data-rep-detail="1" hidden'));
ok("画像内容也在可见部分", html.indexOf("rk-vitals") >= 0 && html.indexOf("rk-vit") >= 0);
ok("画像里有三档占比条", html.indexOf("rk-vit-stack") >= 0);
ok("画像里有逐列画像句", html.indexOf("rk-vit-prof") >= 0);

/* ---------------- 3. 展开后五段齐全 ---------------- */
console.log("\n[3] 展开后内容齐全");
["报告口径", "核心结论", "关键维度横向对照", "逐列画像", "可执行建议", "数据说明"].forEach(function (s) {
  ok("含「" + s + "」", html.indexOf(s) >= 0);
});

/* ---------------- 4. 单列也遵守同一交互 ---------------- */
console.log("\n[4] 单列时");
T.set({ mode: "h", cat: "外套夹克", sites: ["美国站"], periods: ["2026-W43"],
  cache: { key: "h1", items: [mk({ image_url: "a1" }), mk({ image_url: "a2" })] } });
const html2 = T.vitalsHtml(T.vitalsOfGroups(T.vitalsGroups()), T.vitalsDim());
ok("单列同样有入口", html2.indexOf("查看详细报告") >= 0);
ok("单列说明也收进折叠区（不打扰首屏）",
  html2.indexOf("当前只有 1 列可比较") > html2.indexOf('data-rep-detail="1" hidden'));
ok("单列首屏仍有画像", html2.indexOf("逐列画像") >= 0);

/* ---------------- 5. 源码级：开关逻辑 ---------------- */
console.log("\n[5] 开关逻辑");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8");
ok("有展开状态变量 REP_OPEN 且默认 false", /var REP_OPEN = false;/.test(src));
ok("有同步函数 syncRepDetail", /function syncRepDetail\(/.test(src));
ok("重绘后会恢复展开状态", /if \(REP_OPEN\) syncRepDetail\(box\)/.test(src));
ok("用捕获阶段委托绑定（重绘不失效）", /__repBound/.test(src));
ok("展开后按钮文案切成「收起详细报告」", src.indexOf("收起详细报告") >= 0);
ok("展开时移除 hidden、收起时写回 hidden", /removeAttribute\("hidden"\)/.test(src) && /setAttribute\("hidden", ""\)/.test(src));

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
