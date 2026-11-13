/* 类目名清洗与归并（rank-cat-norm.js）
   背景：导入时表格里的「叶子类目名称」是平台全路径，
   直接建类目会把后台类目菜单撑出几十条长名字。 */
import fs from "fs";
import path from "path";
import vm from "vm";

const root = path.resolve(process.cwd());
let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; fails.push(msg); }
}

/* 在沙箱里加载，模拟浏览器 globalThis */
const code = fs.readFileSync(path.join(root, "js/rank-cat-norm.js"), "utf8");
const ctx = { window: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(code, ctx);
const N = ctx.window.RankCatNorm;
ok(!!N && typeof N.normalize === "function", "模块已导出 normalize");
ok(Array.isArray(N.RULES) && N.RULES.length >= 15, "标准类目规则不少于 15 条");

/* 1. 长路径名必须归一 —— 这是用户截图里菜单被撑爆的直接原因 */
const longNames = [
  ["服装、鞋靴和珠宝饰品，男士时尚，男装，男士休闲运动服，男士休闲运动套装，男士运动服", "套装"],
  ["服装、鞋靴和珠宝饰品，男士时尚，男装，男士休闲运动服，男士休闲运动套装，男士运动上装和下装套装", "套装"],
  ["服装、鞋靴和珠宝饰品，新奇物品，新奇服装和产品，新奇服装，男士新奇服装，男士新奇服饰套装", "套装"],
  ["运动与户外用品，健身、训练用品，健身服，男士，男士休闲运动套装，男士休", "套装"],
];
longNames.forEach(([input, want], i) => {
  ok(N.normalize(input) === want, "长路径名归一到「" + want + "」#" + (i + 1) + "（实际 " + N.normalize(input) + "）");
  ok(N.normalize(input).length <= 20, "归一结果长度受控 #" + (i + 1));
  ok(N.needsFix(input) === true, "长路径名被判定需要归并 #" + (i + 1));
});

/* 2. 已经是标准名的不能被改动（否则归并会来回震荡） */
const stable = ["套装", "工装", "开衫", "抓绒衫", "棉服羽绒", "毛衣", "牛仔", "球衣", "短裤", "背带裤", "衬衫", "西装正装", "运动功能服", "POLO", "T恤", "卫衣", "马甲背心", "裤装", "外套夹克", "传统服饰", "其他"];
stable.forEach((s) => {
  ok(N.normalize(s) === s, "标准名保持原样：" + s + "（实际 " + N.normalize(s) + "）");
  ok(N.needsFix(s) === false, "标准名不需要归并：" + s);
});

/* 3. 常见写法差异 */
ok(N.normalize("T 恤") === "T恤", "「T 恤」→ T恤");
ok(N.normalize("t恤") === "T恤", "「t恤」→ T恤");
ok(N.normalize("polo衫") === "POLO", "「polo衫」→ POLO");
ok(N.normalize("Polo 衬衫") === "衬衫", "含衬衫优先于 polo（先判衬衫）");
ok(N.normalize("男士休闲运动套装") === "套装", "「男士休闲运动套装」→ 套装");
ok(N.normalize("健身服") === "运动功能服", "「健身服」→ 运动功能服");
ok(N.normalize("男士运动服") === "运动功能服", "「男士运动服」→ 运动功能服");
ok(N.normalize("羽绒服") === "棉服羽绒", "「羽绒服」→ 棉服羽绒");
ok(N.normalize("摇粒绒外套") === "抓绒衫", "抓绒优先于外套");
ok(N.normalize("休闲长裤") === "裤装", "「休闲长裤」→ 裤装");
ok(N.normalize("汉服") === "传统服饰", "「汉服」→ 传统服饰");
ok(N.normalize("cardigan") === "开衫", "英文 cardigan → 开衫");
ok(N.normalize("Hoodie") === "卫衣", "英文 hoodie → 卫衣");

/* 4. 平台类目 ID 与空值 */
ok(N.normalize("30472") === "其他", "纯数字类目 ID → 其他");
ok(N.normalize("") === "其他", "空值 → 其他");
ok(N.normalize(null) === "其他", "null → 其他");
ok(N.normalize("   ") === "其他", "空白 → 其他");

/* 5. 无关键词的末段：取最后一段并限长 */
ok(N.normalize("服装，配饰，围巾") === "围巾", "无关键词时取路径末段");
ok(N.normalize("A".repeat(50)).length <= 20, "超长无关键词名被截断到 20 字内");

/* 6. 幂等：归一两次结果相同（归并按钮重复点也不会继续变） */
const samples = [...longNames.map((x) => x[0]), "T 恤", "30472", "服装，配饰，围巾", "汉服"];
samples.forEach((s) => {
  const once = N.normalize(s);
  ok(N.normalize(once) === once, "归一幂等：" + s.slice(0, 18));
});

/* 7. 导入链路真的用了归一（源码级） */
const adminRank = fs.readFileSync(path.join(root, "js/admin-rank.js"), "utf8");
ok(/function normCat\(/.test(adminRank), "admin-rank 定义了 normCat");
ok(/const cat = defCat \|\| "其他"/.test(adminRank), "类目只来自后台所选，未选时统一归「其他」");
ok(!/normCat\(r\.leaf_category\)/.test(adminRank), "表格里的类目不再用来建类目（只留叶子类目原文）");
ok(/const defCat = normCat\(o\.category\)/.test(adminRank), "界面所选类目同样归一");
ok(/按标准名归并/.test(adminRank), "类目清理面板提供一键归并");
ok(/renameRankCategory\(c\.category, target, SOURCE\)/.test(adminRank), "归并复用既有的类目改名接口（带本域，不跨专区）");
ok(/归并中 " \+ \(done \+ bad\)/.test(adminRank), "归并过程有进度提示");

/* 8. 页面引用了该模块（且排在 admin-rank 之前） */
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const iNorm = adminHtml.indexOf("rank-cat-norm.js");
const iRank = adminHtml.indexOf("admin-rank.js");
ok(iNorm > 0, "admin.html 引用了类目归一模块");
ok(iRank > iNorm, "归一模块在 admin-rank 之前加载");

console.log("\nt_rank_cat_norm: " + (fail === 0 ? "PASS" : "FAIL") + " " + pass + " / " + (pass + fail));
if (fail) { fails.slice(0, 12).forEach((f) => console.log("  ✗ " + f)); }
process.exit(fail === 0 ? 0 : 1);
