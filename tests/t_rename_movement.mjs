/* 20261112B · 专区「趋势动向」改名为「品牌动向」
 *
 * 要求：专区名称统一改为「品牌动向」。
 * 注意两点容易被漏掉：
 *   1) 专区名称有一部分存在数据库设置里（超管可自定义），读取时是「保存值覆盖内置名」，
 *      只改代码不改读取逻辑 → 前台导航 / 权限勾选 / 专区管理里会继续显示旧名。
 *   2) 榜单分析报告里也有一个叫「趋势动向」的小节（第四章后的第五节），那是报告章节，
 *      和本专区无关，不能连带改掉。
 */
import fs from "fs";
import path from "path";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };
const read = (f) => fs.readFileSync(f, "utf8");

console.log("一、内置专区名称");
const CFG = read("js/config.js");
const mvLine = (CFG.match(/\{ key: "movement".*?\},/) || [""])[0];
ok(/品牌动向/.test(mvLine), "config.js 的专区名称应为「品牌动向」");
ok(!/趋势动向/.test(CFG), "config.js 不应再有「趋势动向」");
ok(/"movement"/.test(mvLine), "movement 这个 key 必须保持不变（否则历史数据/权限失效）");
ok(/movement\.html/.test(mvLine), "前台链接不应被改动");

console.log("二、库里旧名字不得覆盖新名字");
const SBJS = read("js/supabase.js");
ok(/const RENAMED = \{[^}]*movement: 1[^}]*\}/.test(SBJS),
  "读取专区定义时未把 movement 标记为「代码已改名」，库里旧名会覆盖新名");
ok(/if \(d\.label && !RENAMED\[k\]\) t\.label/.test(SBJS),
  "旧的 label 覆盖逻辑未按 RENAMED 放行，改名不会生效");

console.log("三、后台");
const ADMIN = read("admin.html");
ok(/data-target="movement-card">品牌动向</.test(ADMIN), "后台侧栏菜单应显示「品牌动向」");
ok(/<h2>品牌动向/.test(ADMIN), "后台面板标题应显示「品牌动向」");
ok(!/趋势动向/.test(ADMIN), "admin.html 不应再有「趋势动向」");
const PERM = read("js/admin-perm.js");
ok(/\{ key: "movement", label: "品牌动向" \}/.test(PERM), "权限管理的专区列表应显示「品牌动向」");

console.log("四、前台页面");
const MV = read("movement.html");
ok(/<title>品牌动向/.test(MV), "页面标题应改为「品牌动向」");
ok(/class="tab-link active">品牌动向</.test(MV), "顶部导航当前项应显示「品牌动向」");
ok(!/趋势动向/.test(MV), "movement.html 不应再有「趋势动向」");
ok(/movement\.html/.test(MV), "页面文件名不变，链接继续有效");

console.log("五、导出文件名");
const MVA = read("js/admin-movement.js");
ok(/"品牌动向-打标表-"/.test(MVA), "导出打标表的文件名前缀应改为「品牌动向」");
ok(!/趋势动向-打标表/.test(MVA), "导出文件名不应残留旧名");

console.log("六、榜单报告里的同名小节不得被误改");
["js/rank.js", "js/rhythm.js"].forEach((f) => {
  ok(/趋势动向/.test(read(f)), f + " 的报告小节「趋势动向」被误改（那是报告章节，与专区无关）");
  ok(!/品牌动向/.test(read(f)), f + " 不应出现「品牌动向」（报告章节不属于专区）");
});

console.log("七、全站面向用户的文字不得残留旧名");
const SKIP = new Set(["js/rank.js", "js/rhythm.js", "js/rank-enums.js", "js/supabase.js"]);
let left = [];
fs.readdirSync(".").filter((f) => f.endsWith(".html")).forEach((f) => {
  if (SKIP.has(f)) return;
  if (/趋势动向/.test(read(f))) left.push(f);
});
fs.readdirSync("js").filter((f) => f.endsWith(".js")).forEach((f) => {
  const p = "js/" + f;
  if (SKIP.has(p)) return;
  if (/趋势动向/.test(read(p))) left.push(p);
});
ok(left.length === 0, "以下文件仍含旧名：" + left.join("、"));

console.log("八、脚本引用完整性（改名不应引入坏引用）");
let missing = [];
["movement.html", "admin.html", "index.html"].forEach((p) => {
  const s = read(p);
  const re = /<script[^>]+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(s))) {
    const src = m[1].split("?")[0];
    if (/^https?:|^\/\//.test(src)) continue;
    if (!fs.existsSync(path.normalize(src))) missing.push(p + " → " + src);
  }
});
ok(missing.length === 0, "脚本引用指向不存在的文件：" + missing.join("；"));

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
