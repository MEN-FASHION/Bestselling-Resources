/* 趋势动向 · 年度/季节筛选与标签可见性 · 行为级校验
   不是"文本里有没有某个词"，而是把源码里的函数抽出来真跑一遍。
   用法：node tools/test_mv_season_vis_behavior.js */
const fs = require("fs");
const path = require("path");
const R = process.cwd();
const read = (p) => fs.readFileSync(path.join(R, p), "utf8");

let pass = 0, fail = 0;
const eq = (actual, expect, m) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expect);
  if (a === e) pass++; else { fail++; console.log("  ✗ " + m + "\n      实际 " + a + "\n      期望 " + e); }
};
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

/* 从源码里按大括号配对抽出一个函数声明 */
function grab(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("找不到函数 " + name);
  let d = 0, k = src.indexOf("{", i);
  for (; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (d === 0) break; }
  }
  return src.slice(i, k + 1);
}

const adminJs = read("js/admin-movement.js");
const frontJs = read("js/movement-front.js");

/* ---------- 1. seasonLabel ---------- */
console.log("\n[1] 季节文案（后台与前台各一份，行为须一致）");
[["admin", adminJs], ["front", frontJs]].forEach(([tag, src]) => {
  const fn = new Function(grab(src, "seasonLabel") + "; return seasonLabel;")();
  eq(fn({ season_year: 2026, season: "春" }), "2026 春", tag + " 年度+季节");
  eq(fn({ season_year: 2026, season: "" }), "2026 年", tag + " 只有年度");
  eq(fn({ season_year: 0, season: "冬" }), "冬", tag + " 只有季节");
  eq(fn({ season_year: 0, season: "" }), "", tag + " 都没有");
  eq(fn({}), "", tag + " 字段缺失");
  eq(fn({ season_year: "2025", season: "秋" }), "2025 秋", tag + " 字符串年度也认");
});

/* ---------- 2. 后台 filteredItems ---------- */
console.log("\n[2] 后台三筛选合并");
const filtered = new Function("state", grab(adminJs, "filteredItems") + "; return filteredItems;")({});
const ITEMS = [
  { id: 1, category: "T恤", season_year: 2026, season: "春" },
  { id: 2, category: "T恤", season_year: 2025, season: "冬" },
  { id: 3, category: "卫衣", season_year: 2026, season: "冬" },
  { id: 4, category: "", season_year: 0, season: "" },
];
const run = (cat, year, season) => {
  const st = { items: ITEMS, curCat: cat, curYear: year, curSeason: season };
  const f = new Function("state", grab(adminJs, "filteredItems") + "; return filteredItems;")(st);
  return f().map((r) => r.id);
};
eq(run("", "", ""), [1, 2, 3, 4], "全空 = 全部");
eq(run("T恤", "", ""), [1, 2], "只按类目");
eq(run("", "2026", ""), [1, 3], "只按年度");
eq(run("", "", "冬"), [2, 3], "只按季节");
eq(run("T恤", "2026", ""), [1], "类目+年度");
eq(run("T恤", "2026", "冬"), [], "三者互斥时为空");
eq(run("", "2026", "冬"), [3], "年度+季节");
eq(run("卫衣", "2026", "冬"), [3], "完全命中");
/* 未分类的图片应能被"未分类"这个类目筛到 */
{
  const st = { items: ITEMS, curCat: "未分类", curYear: "", curSeason: "" };
  const f = new Function("state", grab(adminJs, "filteredItems") + "; return filteredItems;")(st);
  eq(f().map((r) => r.id), [4], "未分类可被筛出");
}

/* ---------- 3. 前台可见性过滤 ---------- */
console.log("\n[3] 标签前台可见性");
const GROUPS_SRC = (() => {
  const i = frontJs.indexOf("var GROUPS = [");
  let d = 0, k = frontJs.indexOf("[", i);
  for (; k < frontJs.length; k++) {
    if (frontJs[k] === "[") d++;
    else if (frontJs[k] === "]") { d--; if (d === 0) break; }
  }
  return frontJs.slice(i, k + 1) + ";";
})();

function build(state) {
  const code = GROUPS_SRC + grab(frontJs, "visOn") + grab(frontJs, "shownGroups") +
    "; return { visOn: visOn, shownGroups: shownGroups, GROUPS: GROUPS };";
  return new Function("state", code)(state);
}

{
  const m = build({ vis: {} });
  eq(m.shownGroups().length, m.GROUPS.length, "无配置时全部展示");
  ok(m.visOn("festival_tags") === true, "默认可见");
}
{
  const m = build({ vis: { festival_tags: false } });
  const names = m.shownGroups().map((g) => g[0]);
  eq(names.indexOf("节日"), -1, "关掉的门维度不再出现");
  eq(names.length, m.GROUPS.length - 1, "只少这一组");
  ok(m.visOn("style_tags") === true, "其它维度不受影响");
}
{
  const m = build({ vis: { festival_tags: true } });
  eq(m.shownGroups().map((g) => g[0]).indexOf("节日") >= 0, true, "显式 true = 展示");
}
{
  /* 全部关掉：前台一条都不显示，但不应报错 */
  const off = {};
  const m0 = build({ vis: {} });
  m0.GROUPS.forEach((g) => { off[g[1][0]] = false; });
  const m = build({ vis: off });
  eq(m.shownGroups().length, 0, "全部关闭时返回空数组");
}

/* ---------- 4. 数据层方法签名与语义 ---------- */
console.log("\n[4] 数据层");
const sb = read("js/supabase.js");
ok(/async setMovementTagVisibility\(map\)[\s\S]{0,300}clean\[k\] = map\[k\] !== false/.test(sb),
   "写配置时统一成布尔");
ok(/getMovementTagVisibility[\s\S]{0,500}out\[k\] = data\.tag_visibility\[k\] !== false/.test(sb),
   "读配置时缺省视为可见");
ok(/async setMovementSeason\(id, seasonYear, season\)[\s\S]{0,260}season_year: y, season: s/.test(sb),
   "改季节写入两个字段");
ok(/Number\(seasonYear\) > 0 \? Number\(seasonYear\) : 0/.test(sb), "年度非法值归零");

/* ---------- 5. 补丁不写死枚举 ---------- */
console.log("\n[5] 数据库补丁");
const sql = read("tools/patch_20261030J_season_visibility.sql");
ok(!/season\s+TEXT[^;]*CHECK/i.test(sql), "季节列不加 CHECK 约束");
ok(/IF NOT EXISTS/g.test(sql), "幂等");
ok(/BEGIN;/.test(sql) && /COMMIT;/.test(sql), "事务包裹");

console.log("\n" + "=".repeat(52));
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);