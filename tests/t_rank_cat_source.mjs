/* 专区菜单的类目「只能来自后台选择」的专项验证。
   规则：后台选了类目 → 全部归到该类目；
        后台没选 → 统一归「其他」；
        表格里的任何信息（叶子类目名称、平台全路径名、数字 ID）都不得成为类目。 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("FAIL " + n); } };

const admin = read("js/admin-rank.js");

/* ---------- 一、导入侧 ---------- */
ok(/const cat = defCat \|\| "其他"/.test(admin), "类目只来自后台所选，未选时归「其他」");
ok(!/normCat\(r\.leaf_category\)/.test(admin), "表格类目不再参与建类目");
ok(/leaf_category: r\.leaf_category/.test(admin), "表格类目原文仍写进叶子类目字段（可追溯）");
ok(/if \(!defCat\) noCat\+\+/.test(admin), "未选类目会被计数，便于提示");

/* 分组键里不能出现表格类目 */
ok(/const key = period \+ "\\u0000" \+ cat/.test(admin), "分组键是 期次+类目（类目已只来自后台）");
ok(!/period \+ "\\u0000" \+ normCat/.test(admin), "分组键不含表格类目");

/* 预览必须把这件事写在脸上 */
ok(/类目只认上方所选/.test(admin), "预览明确说明类目只认上方所选");
ok(/不会出现在类目菜单/.test(admin), "预览说明表格类目不会进菜单");

/* ---------- 二、其它写入路径不得回填表格类目 ---------- */
const sb = read("js/supabase.js");
ok(!/category: *item\.leaf_category/.test(sb), "写入接口不会拿叶子类目顶替类目");

/* ---------- 三、前台菜单只显示标准名 ---------- */
const rankJs = read("js/rank.js");
ok(/FACETS\.categories = merged/.test(rankJs), "前台菜单使用归一后的标准名列表");
ok(/RAW_CATS = \(FACETS\.categories \|\| \[\]\)\.slice\(\)/.test(rankJs), "保留原始名用于查询");
ok(/normCatName\(c\) \|\| "其他"/.test(rankJs), "归一为空的名字归「其他」，不产生空菜单项");

/* ---------- 四、端到端：用真实导入函数跑一遍 ---------- */
const head = admin.slice(admin.indexOf("function groupRankRows"));
const fnSrc = head.slice(0, head.indexOf("\n  async function doRankImport"));
const sandbox = { window: { RankCatNorm: { normalize: (x) => String(x || "").trim() } }, console };
sandbox.globalThis = sandbox;
const vm = await import("node:vm");
const ctx = vm.createContext(sandbox);
vm.runInContext("function normCat(x){var r=String(x==null?'':x).trim();return r;}\n" + fnSrc, ctx);

const rows = [
  { period: "第41周", leaf_category: "T恤", site: "US", image_url: "u1", title: "a" },
  { period: "第41周", leaf_category: "卫衣", site: "US", image_url: "u2", title: "b" },
  { period: "第41周", leaf_category: "服装，鞋靴和珠宝饰品，男士时尚，男装，男士休闲运动套装", site: "US", image_url: "u3", title: "c" },
  { period: "第41周", leaf_category: "30472", site: "US", image_url: "u4", title: "d" },
];
let r = ctx.groupRankRows(rows, { periodType: "week", periodLabel: "", category: "", sites: [], useMine: false });
ok(r.groups.length === 1, "四种表格类目 → 只产生 1 个类目（全部归「其他」）");
ok(r.groups[0].category === "其他", "该类目是「其他」，不是表格里的任何一个值");
ok(r.groups[0].rows.length === 4, "4 行全部保留");
ok(r.groups[0].rows.every((x) => x.leaf_category), "每行叶子类目原文都在");
ok(r.noCat === 4, "未选类目被计数（4 行）");

r = ctx.groupRankRows(rows, { periodType: "week", periodLabel: "", category: "外套夹克", sites: [], useMine: false });
ok(r.groups.length === 1 && r.groups[0].category === "外套夹克", "后台选了类目 → 全部归到该类目");
ok(r.groups[0].rows.every((x) => x.category === "外套夹克"), "行内类目也是后台所选值");
ok(r.noCat === 0, "选了类目就不算未选");

/* 多期次：类目仍只有一个 */
r = ctx.groupRankRows(
  rows.concat([{ period: "第42周", leaf_category: "POLO", site: "US", image_url: "u5", title: "e" }]),
  { periodType: "week", periodLabel: "", category: "", sites: [], useMine: false }
);
ok(r.groups.length === 2, "两个期次 → 两组");
ok(new Set(r.groups.map((g) => g.category)).size === 1, "两个期次的类目都是同一个（其他），菜单不会多出条目");

console.log(`\nt_rank_cat_source: PASS ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
