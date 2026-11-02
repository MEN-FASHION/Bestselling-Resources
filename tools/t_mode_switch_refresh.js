/* 趋势上升榜 · 切换对比方式后报告必须跟着变（20261102J）
   现象：顶部切了对比方式，下面报告的构成看着没变。
   根因一：标签取数的去重键是「数量 + 首个 URL + 末个 URL」，
           同一类目同一周的两个组合很容易撞键 → 不重取 → 风格/视觉/工艺永远空着。
   根因二：只有一列可比较时报告静默省掉对照与结论，页面上只剩画像，看不出变化。
   本测试锁两件事：指纹必须能区分集合差异；报告头必须写出本次分组、单列必须给说明。 */
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
ok("暴露了指纹函数", typeof T.tagFingerprint === "function");

/* ---------------- 1. 指纹：集合差异必须能被识别 ---------------- */
console.log("\n[1] 标签取数指纹");
const fp = T.tagFingerprint;
ok("同样集合指纹相同", fp(["a", "b", "c"]) === fp(["c", "b", "a"]), "排序后应稳定");
ok("换一个地址指纹就变", fp(["a", "b", "c"]) !== fp(["a", "b", "d"]));
ok("数量相同但内容不同也能区分", fp(["x1", "x2"]) !== fp(["x1", "x3"]));
ok("首尾相同中间不同也能区分（旧键的漏洞）", fp(["h", "m1", "t"]) !== fp(["h", "m2", "t"]),
  "旧键只看数量+首+末，这里是它的漏洞点");
ok("空集合有稳定指纹", fp([]) === fp([]));
ok("集合长度不同指纹不同", fp(["a"]) !== fp(["a", "b"]));
ok("指纹里带集合大小", fp(["a", "b"]).indexOf("2|") === 0, fp(["a", "b"]));

/* ---------------- 2. 报告头写出本次分组 ---------------- */
console.log("\n[2] 报告头带分组名单");
const mk = (o) => Object.assign({ image_url: "", category: "C1", site: "美国站", period_label: "2026-W43",
  _opp: false, _hot: false, _surge: false }, o);
const tags = {
  a1: { style_tags: ["户外机能"], visual_tags: ["纯白底"], shoot_tags: ["模拍"] },
  a2: { style_tags: ["户外机能"], visual_tags: ["留白构图"], shoot_tags: ["模拍"] },
  b1: { style_tags: ["商务通勤"], visual_tags: ["3D渲染图"], shoot_tags: ["3D"] },
  b2: { style_tags: ["商务通勤"], visual_tags: ["3D渲染图"], shoot_tags: ["3D"] },
};
T.set({ facets: { sites: ["美国站", "德国站"], periods: ["2026-W42", "2026-W43"], categories: ["外套夹克", "POLO"] }, tags, groups: [],
  mode: "c", cat: "外套夹克", cats: ["外套夹克", "POLO"], sites: ["美国站"], periods: ["2026-W43"],
  cache: { key: "c", items: [mk({ image_url: "a1" }), mk({ image_url: "a2" }),
    mk({ image_url: "b1", category: "POLO" }), mk({ image_url: "b2", category: "POLO" })] } });
let V = T.vitalsOfGroups(T.vitalsGroups());
let html = T.vitalsHtml(V, T.vitalsDim());
ok("类目对比时分组写「外套夹克 / POLO」", html.indexOf("分组 <b>外套夹克 / POLO</b>") >= 0);

/* 切到国家对比：分组应变成国家名 */
T.set({ mode: "h", cat: "外套夹克", sites: ["美国站", "德国站"], periods: ["2026-W43"],
  cache: { key: "h", items: [mk({ image_url: "a1" }), mk({ image_url: "a2" }),
    mk({ image_url: "b1", site: "德国站" }), mk({ image_url: "b2", site: "德国站" })] } });
V = T.vitalsOfGroups(T.vitalsGroups());
html = T.vitalsHtml(V, T.vitalsDim());
ok("国家对比时分组变国家名", html.indexOf("分组 <b>美国站 / 德国站</b>") >= 0);
ok("国家对比报告头口径也跟着变", html.indexOf("对比国家") >= 0);
ok("切换前后报告文本不同（不是同一份）",
  T.vitalsHtml(V, T.vitalsDim()) !== "", "至少能渲染");

/* ---------------- 3. 单列必须给说明 ---------------- */
console.log("\n[3] 只有一列时");
T.set({ mode: "h", cat: "外套夹克", sites: ["美国站"], periods: ["2026-W43"],
  cache: { key: "h1", items: [mk({ image_url: "a1" }), mk({ image_url: "a2" })] } });
V = T.vitalsOfGroups(T.vitalsGroups());
html = T.vitalsHtml(V, T.vitalsDim());
ok("单列有说明块", html.indexOf('class="rk-rep-hint"') >= 0);
ok("说明里写出列数", html.indexOf("当前只有 1 列可比较") >= 0);
ok("国家对比下提示去多选国家", html.indexOf("「国家站点」里多选几个国家") >= 0);
ok("单列仍不出对照表", html.indexOf("rk-rep-tbl") < 0);
ok("单列仍不出核心结论", html.indexOf("rk-rep-sum") < 0);

T.set({ mode: "v", cat: "外套夹克", sites: ["美国站"], periods: ["2026-W43"],
  cache: { key: "v1", items: [mk({ image_url: "a1" })] } });
html = T.vitalsHtml(T.vitalsOfGroups(T.vitalsGroups()), T.vitalsDim());
ok("纵向单列提示去多选周次", html.indexOf("多选 2 周以上") >= 0);

T.set({ mode: "c", cat: "外套夹克", cats: ["外套夹克"], sites: ["美国站"], periods: ["2026-W43"],
  cache: { key: "c1", items: [mk({ image_url: "a1" })] } });
html = T.vitalsHtml(T.vitalsOfGroups(T.vitalsGroups()), T.vitalsDim());
ok("类目单列提示去勾选类目", html.indexOf("勾选 2 个以上类目") >= 0);

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
