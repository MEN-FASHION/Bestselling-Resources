/* 前台类目菜单归一：库里残留的平台全路径名不能原样出现在前台菜单里。
   规则：菜单只列标准类目名；查询时把标准名展开成它包含的所有原始类目名。
   这样「后台选了类目」和「前台显示的类目」对得上，菜单不再被长名字撑爆。 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.log("FAIL " + msg); }
}

/* ---------- 1. 归一引擎（真跑） ---------- */
const sandbox = { window: undefined, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read("js/rank-cat-norm.js"), sandbox);
const NC = sandbox.RankCatNorm;
ok(NC && typeof NC.normalize === "function", "归一引擎导出 normalize");

const dirty = [
  "服装，鞋靴和珠宝饰品，男士时尚，男装，男士休闲运动服，男士休闲运动套装，男士运动服",
  "服装，鞋靴和珠宝饰品，男士时尚，男装，男士休闲运动服，男士休闲运动套装，男士休闲运动上衣",
  "服装，鞋靴和珠宝饰品，女士时尚，女装，女士休闲运动服，女士休闲运动上衣",
  "服装，鞋靴和珠宝饰品，女士时尚，女装，女士内衣，女士打底衫",
  "30472",
  "30467",
];
dirty.forEach((d) => {
  const n = NC.normalize(d);
  ok(!!n && n.length <= 20, "归一结果长度合理: " + d.slice(0, 16) + " → " + n);
  ok(!/[，,]/.test(n), "归一结果不含分隔符: " + n);
  ok(!/^\d+$/.test(n), "纯数字类目 ID 不进菜单: " + d + " → " + n);
});

/* 同一个平台路径下的「套装 / 上衣」应落到同一个标准类目 */
const a = NC.normalize(dirty[0]), b = NC.normalize(dirty[1]);
ok(a === b, "同族全路径名合并到同一类: " + a + " == " + b);

/* ---------- 2. 页面接入 ---------- */
const rankJs = read("js/rank.js");
ok(/var RAW_CATS\s*=/.test(rankJs), "榜单页保留原始类目名 RAW_CATS");
ok(/var CAT_MAP\s*=\s*\{/.test(rankJs), "榜单页有标准名→原始名映射");
ok(/function catsOf\(/.test(rankJs), "榜单页有 catsOf 展开函数");
ok(/FACETS\.categories\s*=\s*merged/.test(rankJs), "菜单改写为标准名列表");
ok(/filter\.categories\s*=\s*catsOf\(CAT\)/.test(rankJs), "单选类目按映射展开查询");
ok(/filter\.categories\s*=\s*RAW_CATS\.slice\(\)/.test(rankJs), "全部类目时查询全部原始名");
ok(!/filter\.category\s*=\s*CAT\b/.test(rankJs), "不再用单值类目查询（会漏掉同族类目）");
ok(/catsOf\(c\)/.test(rankJs), "类目对比模式也展开映射");

const titleJs = read("js/titlelab.js");
ok(/S\.catMap\s*=\s*\{\}/.test(titleJs), "组词台也有类目映射");
ok(/categories:\s*catsOf\(S\.cat\)/.test(titleJs), "组词台查询用展开后的类目");

/* ---------- 3. 脚本引用顺序 ---------- */
[["rank.html", "js/rank.js"], ["titlelab.html", "js/titlelab.js"]].forEach(([page, dep]) => {
  const html = read(page);
  const iNorm = html.indexOf("js/rank-cat-norm.js");
  const iDep = html.indexOf(dep);
  ok(iNorm > -1, page + " 引用了类目归一脚本");
  ok(iNorm > -1 && iDep > -1 && iNorm < iDep, page + " 归一脚本必须在使用者之前加载");
});

/* ---------- 4. 全站版本戳一致 ---------- */
const build = (read("js/rhythm.js").match(/BUILD\s*=\s*"([^"]+)"/) || [])[1];
ok(!!build, "存在 BUILD 常量");
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
let stale = 0;
pages.forEach((f) => {
  const html = read(f);
  const vs = [...html.matchAll(/\?v=(\d{8}[A-Z]{1,3})/g)].map((m) => m[1]);
  vs.forEach((v) => { if (v !== build) stale++; });
});
ok(stale === 0, "全站脚本版本戳与 BUILD 一致（不一致的引用数 " + stale + "）");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
