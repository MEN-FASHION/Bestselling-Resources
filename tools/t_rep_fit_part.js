/* 趋势上升榜 · 版型只统计本类目的部位（20261103D）
   问题：T恤 的详细报告里出现「长裤 7%」「九分裤」「短裙 2%」「工装裤 1%」。
   原因：版型维度存的是「部位·取值」，一张 T恤 图里模特穿着裤子时，
        打标会把模特下装一并打进来；报告把所有部位混在一个「版型」池子里统计，
        于是 T恤 的报告里混进了模特身上的裤子、裙子。
   本测试锁三件事：
     1) 上装类目（T恤 / POLO / 衬衫 / 外套…）只统计 领型 / 袖型 / 袖长 / 衣长 / 松紧度
     2) 下装类目（长裤 / 短裤 / 工装裤…）只统计 裤型 / 裤长 / 腰型 / 松紧度
     3) 全类目（全部 / 大码全类 / 套装 / 连体）不过滤，认不出的类目也不过滤（宁可多给） */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };

const fakeDoc = {
  readyState: "loading",
  addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
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

const mk = (o) => Object.assign({
  image_url: "", category: "T恤", site: "美国站", period_label: "2026-W43",
  _opp: false, _hot: false, _surge: false,
}, o);

/* T恤 4 张：模特穿着长裤 / 工装裤 / 短裙，打标把下装也打上了 */
const tee = ["t1", "t2", "t3", "t4"];
const pants = ["p1", "p2", "p3"];
const items = tee.map(function (u) { return mk({ image_url: u, category: "T恤" }); })
  .concat(pants.map(function (u) { return mk({ image_url: u, category: "长裤" }); }));

const tags = {
  t1: { fit_tags: ["领型·圆领", "袖型·常规袖", "袖长·短袖(3分)", "衣长·常规款", "松紧度·常规版", "裤长·长裤", "裤型·直筒"] },
  t2: { fit_tags: ["领型·圆领", "袖型·常规袖", "袖长·短袖(3分)", "衣长·常规款", "松紧度·常规版", "裤长·长裤"] },
  t3: { fit_tags: ["领型·V领", "袖型·常规袖", "袖长·长袖", "衣长·常规款", "松紧度·修身", "裤长·九分裤", "裤型·工装裤"] },
  t4: { fit_tags: ["领型·POLO领", "袖型·常规袖", "袖长·短袖(3分)", "衣长·短款", "松紧度·Oversize", "裙长·短裙"] },
  p1: { fit_tags: ["裤型·工装裤", "裤长·长裤", "腰型·高腰", "松紧度·常规版", "领型·圆领"] },
  p2: { fit_tags: ["裤型·直筒", "裤长·九分裤", "腰型·中腰", "松紧度·常规版", "袖长·长袖"] },
  p3: { fit_tags: ["裤型·束脚", "裤长·长裤", "腰型·中腰", "松紧度·宽松"] },
};

T.set({
  facets: { sites: ["美国站"], periods: ["2026-W43"], categories: ["T恤", "长裤"] },
  tags: tags, groups: [], mode: "c", cat: "T恤", cats: ["T恤", "长裤"],
  sites: ["美国站"], periods: ["2026-W43"], cache: { key: "fitpart", items: items },
});

/* ---------------- 1. 部位准入判定 ---------------- */
console.log("\n[1] 部位准入");
ok("T恤 → 上装部位", JSON.stringify(T.fitPartsOfCat("T恤")) === JSON.stringify(["领型", "袖型", "袖长", "衣长", "松紧度"]));
ok("长裤 → 下装部位", JSON.stringify(T.fitPartsOfCat("长裤")) === JSON.stringify(["裤型", "裤长", "腰型", "松紧度"]));
ok("全部 / 大码全类 / 套装 / 连体 → 不过滤",
  ["全部", "大码全类", "套装", "连体/背带"].every(function (c) { return T.fitPartsOfCat(c) === null; }));
ok("认不出的类目 → 不过滤（宁可多给）", T.fitPartsOfCat("某个新类目") === null);
ok("T恤 的「裤长·长裤」被判为不属于本类目", T.fitValOfFit("裤长·长裤", "T恤") === "");
ok("T恤 的「领型·圆领」保留并去掉前缀", T.fitValOfFit("领型·圆领", "T恤") === "圆领");
ok("长裤 的「裤型·工装裤」保留", T.fitValOfFit("裤型·工装裤", "长裤") === "工装裤");

/* ---------------- 2. 报告 / 体征卡的版型构成 ---------------- */
console.log("\n[2] 版型构成按类目过滤");
const V = T.vitalsOfGroups(T.vitalsGroups());
const teeCol = V.filter(function (c) { return c.cat === "T恤"; })[0];
const pantCol = V.filter(function (c) { return c.cat === "长裤"; })[0];
ok("T恤 列存在", !!teeCol);
const teeFit = (teeCol.all.fit || []).map(function (e) { return e[0]; });
console.log("    T恤 版型取值：" + teeFit.join(" / "));
ok("T恤 的版型里没有「长裤」", teeFit.indexOf("长裤") < 0);
ok("T恤 的版型里没有「九分裤」", teeFit.indexOf("九分裤") < 0);
ok("T恤 的版型里没有「工装裤」", teeFit.indexOf("工装裤") < 0);
ok("T恤 的版型里没有「直筒」", teeFit.indexOf("直筒") < 0);
ok("T恤 的版型里没有「短裙」", teeFit.indexOf("短裙") < 0);
ok("T恤 的版型里保留了 圆领 / V领 / POLO领", ["圆领", "V领", "POLO领"].every(function (k) { return teeFit.indexOf(k) >= 0; }));
ok("T恤 的版型里保留了 短袖(3分)", teeFit.indexOf("短袖(3分)") >= 0);

const pantFit = (pantCol.all.fit || []).map(function (e) { return e[0]; });
console.log("    长裤 版型取值：" + pantFit.join(" / "));
ok("长裤 的版型里有 工装裤 / 直筒 / 束脚", ["工装裤", "直筒", "束脚"].every(function (k) { return pantFit.indexOf(k) >= 0; }));
ok("长裤 的版型里没有 圆领 / 长袖（模特上装不算）", pantFit.indexOf("圆领") < 0 && pantFit.indexOf("长袖") < 0);

/* 分母也跟着变：T恤 4 张都有上装部位 → 占比仍是 4 张为底 */
ok("T恤 圆领占比 50%（2/4）", (teeCol.all.fit.filter(function (e) { return e[0] === "圆领"; })[0] || [])[1] === 50,
  JSON.stringify(teeCol.all.fit));

/* ---------------- 3. 趋势动向同样过滤 ---------------- */
console.log("\n[3] 趋势动向");
ok("趋势取值里 T恤 不出现「长裤」",
  T.trendValsOf({ image_url: "t1", category: "T恤" }, "fit_tags").indexOf("长裤") < 0,
  JSON.stringify(T.trendValsOf({ image_url: "t1", category: "T恤" }, "fit_tags")));
ok("趋势取值里 T恤 仍有「圆领」",
  T.trendValsOf({ image_url: "t1", category: "T恤" }, "fit_tags").indexOf("圆领") >= 0);

/* ---------------- 4. 报告文案写明口径 ---------------- */
console.log("\n[4] 数据说明");
const q = T.repQualityHtml ? T.repQualityHtml(V, T.vitalsDim()) : "";
if (q) {
  ok("数据说明里写清「版型只统计这类衣服自己的部位」", q.indexOf("这类衣服自己的部位") >= 0);
  ok("数据说明里点明模特身上的裤子/裙子已剔除", q.indexOf("裤子") >= 0);
} else {
  ok("未导出 repQualityHtml，跳过文案断言", true);
}

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
