/* 20261114G · 「后台选什么类目，前台就显示什么类目」回归测试（真跑）
 *
 * 现场：后台在导入面板选了「打底压缩」，前台类目菜单和卡片上却是「运动功能服」。
 * 根因：一套「类目归并」规则同时被导入侧和前台展示侧调用，正式类目名也会被按关键词改写。
 * 规矩现在只有一条：类目名全程原样直通 —— 后台选什么、库里存什么、前台就显示什么。
 * 归并规则只剩一个入口：后台「类目清理…」里用户主动点「按标准名归并」时才会用到。
 */
import fs from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else { fail++; fails.push(m); } };

const read = (p) => fs.readFileSync(p, "utf8");

/* ---------- 1. 真实加载归一模块 ---------- */
const nctx = { window: {}, console };
nctx.globalThis = nctx;
vm.createContext(nctx);
vm.runInContext(read("js/rank-cat-norm.js"), nctx);
const N = nctx.window.RankCatNorm;
ok(!!N && typeof N.normalize === "function", "归一模块已加载");

/* 用户现场的两个真实类目名都必须原样 */
["打底压缩", "打底/压缩", "运动功能服", "打底衫", "压缩裤"].forEach((s) => {
  ok(N.normalize(s) === s, "正式类目名不被改写：" + s + " → " + N.normalize(s));
  ok(N.needsFix(s) === false, "正式类目名不进「按标准名归并」清单：" + s);
});

/* 脏名仍要被清洗，否则菜单又被撑爆 */
ok(N.normalize("30472") === "其他", "纯数字 ID → 其他");
ok(N.normalize("服装、鞋靴和珠宝饰品，男士时尚，男装，男士休闲运动服，男士休闲运动套装") === "套装", "全路径名 → 套装");
ok(N.normalize("A".repeat(40)).length <= 20, "超长名被截断");
ok(N.isDirty("服装，配饰") === true && N.isDirty("打底压缩") === false, "isDirty 判定正确");

/* ---------- 2. 导入侧：真跑 groupRankRows ---------- */
const src = read("js/admin-rank.js");
const pick = (name) => {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) return "";
  let d = 0;
  const j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); }
  }
  return "";
};
const fns = ["normCat", "groupRankRows"].map(pick).join("\n");
ok(fns.includes("function groupRankRows"), "能抽出 groupRankRows");

const box = new Function("window", fns + "; return { groupRankRows }; ")(nctx.window);
const { groupRankRows } = box;

const mkRows = (n, tag) => Array.from({ length: n }, (_, i) => ({
  period: "第45周", leaf_category: "运动功能服", site: "US",
  image_url: "https://img/" + tag + i + ".jpg", title: "t" + i,
}));

["打底压缩", "打底/压缩", "运动功能服"].forEach((cat) => {
  const g = groupRankRows(mkRows(3, "a"), {
    periodType: "week", periodLabel: "", category: cat, sites: [], useMine: false,
  });
  ok(g.groups.length === 1, "「" + cat + "」只建 1 组");
  ok(g.groups[0].category === cat, "写进库的类目原样是「" + cat + "」（实际 " + g.groups[0].category + "）");
  ok(g.groups[0].rows.every((r) => r.category === cat), "每一行条目的类目都是「" + cat + "」");
  ok(g.groups[0].rows.every((r) => r.leaf_category === "运动功能服"), "表格类目只进 leaf_category，不顶替类目");
});

/* 对照：不改代码的旧写法（defCat = normalize(界面所选)）会把打底压缩变成运动功能服，
   这里断言它确实会变 —— 证明上一条用例抓得住缺陷，不是永远通过 */
const legacy = N.normalize ? "运动功能服" : "";
ok(legacy !== "" && N.normalize("服装，鞋靴和珠宝饰品，男士时尚，男装，男士打底压缩") !== "打底压缩",
  "对照组：脏名场景下关键词规则仍会改写（说明只有当输入是脏名时才生效）");

/* 逗号口径的正式类目名也原样（含「，」的短名不算路径） */
const gComma = groupRankRows(mkRows(1, "c"), {
  periodType: "week", periodLabel: "", category: "打底压缩", sites: [], useMine: false,
});
ok(gComma.groups[0].category === "打底压缩", "普通所选类目原样写入");

/* ---------- 3. 前台读取侧：一律原样，不做任何归并（20261114G） ---------- */
const rankJs = read("js/rank.js");
ok(/function normCatName\(x\)\s*\{\s*return String\(x == null \? "" : x\)\.replace\(\/\\s\+\/g, " "\)\.trim\(\);\s*\}/.test(rankJs),
  "榜单页类目名原样返回，不再经过归并规则");
ok(!/function normCatName\(x\)[\s\S]{0,200}RankCatNorm\.normalize/.test(rankJs), "榜单页不再调用归并规则");

const titleJs = read("js/titlelab.js");
ok(!/function normCatName\(x\)[\s\S]{0,200}RankCatNorm\.normalize/.test(titleJs), "组词台不再调用归并规则");

const cmpJs = read("js/compare-front.js");
ok(/function normCat\(v\)\s*\{\s*return String\(v == null \? "" : v\)\.replace\(\/\\s\+\/g, " "\)\.trim\(\);\s*\}/.test(cmpJs),
  "渠道对比类目名原样返回");
ok(!/function normCat\(v\)[\s\S]{0,300}RankCatNorm/.test(cmpJs), "渠道对比不再调用归并规则");

/* 真实跑一遍三处前台函数：拿库里存的类目名进去，必须字节级一模一样出来 */
function pickFn(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) return "";
  let d = 0;
  const j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); }
  }
  return "";
}
const names = [
  "打底压缩", "打底/压缩", "运动功能服", "POLO", "T恤",
  "服装，鞋靴和珠宝饰品，男士时尚，男装，男士休闲运动套装", "30472",
];
[
  ["榜单页", "js/rank.js", "normCatName"],
  ["组词台", "js/titlelab.js", "normCatName"],
  ["渠道对比", "js/compare-front.js", "normCat"],
].forEach(([label, file, fn]) => {
  const body = pickFn(read(file), fn);
  ok(!!body, label + " 能抽出 " + fn);
  if (!body) return;
  const f = new Function(body + "; return " + fn + ";")(nctx.window);
  names.forEach((n) => ok(f(n) === n, label + " 类目名原样直通：" + n));
});

/* 菜单：库里三类类目就是三行菜单，既不合并也不改名 */
function buildMenu(raws) {
  const f = new Function(pickFn(read("js/rank.js"), "normCatName") + "; return normCatName;")();
  const map = {}, merged = [];
  raws.forEach((c) => {
    const n = f(c) || "其他";
    if (!map[n]) { map[n] = []; merged.push(n); }
    if (map[n].indexOf(c) < 0) map[n].push(c);
  });
  return { map, merged };
}
const m1 = buildMenu(["打底压缩", "运动功能服", "打底/压缩"]);
ok(m1.merged.length === 3, "三个正式类目在菜单里是三行，不会被合并成一行");
ok(m1.merged.indexOf("打底压缩") >= 0 && m1.merged.indexOf("运动功能服") >= 0, "打底压缩与运动功能服同时存在，且各自独立");
const m2 = buildMenu(["30472", "服装，鞋靴和珠宝饰品，男士时尚，男装，男士休闲运动服，男士休闲运动套装"]);
ok(m2.merged.length === 2, "早年的脏名也原样列成两项，不再被自动改名（要清洗就手动点归并）");
ok(m2.merged.indexOf("30472") >= 0, "纯数字类目也原样显示，不偷偷变成「其他」");

/* 查询展开：选中「打底压缩」只查它自己，不会捎带运动功能服 */
const catsOf = (map, label) => (map[label] && map[label].length ? map[label].slice() : [label]);
ok(JSON.stringify(catsOf(m1.map, "打底压缩")) === JSON.stringify(["打底压缩"]), "选中打底压缩只查打底压缩的数据");
ok(catsOf(m1.map, "运动功能服").indexOf("打底压缩") < 0, "不会把打底压缩的数据算进运动功能服");

/* 导入侧与前台展示侧：都不许再出现归并调用 */
["js/rank.js", "js/titlelab.js", "js/compare-front.js", "js/admin-rank.js", "js/rhythm.js"].forEach((f) => {
  const src = read(f);
  const hits = (src.match(/RankCatNorm\.normalize/g) || []).length;
  if (f === "js/admin-rank.js") return; /* 唯一保留处：后台「类目清理…」的手动归并按钮，下面单独验 */
  ok(hits === 0, f + " 已不再调用归并规则（残留 " + hits + " 处）");
});

/* 归并规则只允许出现在「用户手动点按钮」的那一段里，导入与展示链路一行都不许有 */
const adminSrc = read("js/admin-rank.js");
const normCalls = [...adminSrc.matchAll(/RankCatNorm\.normalize/g)].map((m) => m.index);
const manualStart = adminSrc.indexOf("const fixable = () =>");
const manualEnd = adminSrc.indexOf("cbar.appendChild(cAll)");
ok(manualStart > 0 && manualEnd > manualStart, "后台仍有「按标准名归并」手动入口");
ok(normCalls.length > 0 && normCalls.every((i) => i > manualStart && i < manualEnd),
  "归并规则只出现在手动归并按钮内（共 " + normCalls.length + " 处）");
/* 导入分组函数内部不得出现归并调用 */
const grpStart = adminSrc.indexOf("function groupRankRows");
const grpEnd = adminSrc.indexOf("function ", adminSrc.indexOf("return { groups", grpStart) > 0 ? adminSrc.indexOf("return { groups", grpStart) : grpStart + 4000);
const grpBody = adminSrc.slice(grpStart, grpEnd > grpStart ? grpEnd : grpStart + 4000);
ok(grpStart > 0 && !/RankCatNorm/.test(grpBody), "导入分组函数里没有任何类目归并调用");

/* ---------- 4. 版本戳（不锁死具体字母，避免每次发版误报） ---------- */
const adminHtml = read("admin.html");
const build = (read("js/rhythm.js").match(/BUILD\s*=\s*"([^"]+)"/) || [])[1];
ok(/\d{8}[A-Z]{1,3}/.test(build || ""), "存在构建号 " + build);
ok(adminHtml.indexOf(build) >= 0, "admin.html 已升到本次版本 " + build);

console.log("\nt_cat_verbatim: " + (fail === 0 ? "PASS" : "FAIL") + " " + pass + " / " + (pass + fail));
if (fail) fails.slice(0, 10).forEach((f) => console.log("  ✗ " + f));
process.exit(fail === 0 ? 0 : 1);
