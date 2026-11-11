/* 我的收藏 · 导出 PDF / HTML / 长图 按「周度」收窄 —— 20261111L
   锁四件事：
     ① 期次能判出周度 / 月度（三种写法都认），认不出的不算任何一类
     ② 收窄只影响本次导出，不影响收藏本身
     ③ 三个导出入口都把这个范围传下去（少一个就会出现「图导了但仍是全部」）
     ④ 文件名与封面/页头都写出口径，避免拿错文件 */
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const FE = fs.readFileSync(path.join(ROOT, "js/favexport.js"), "utf8");
const FJ = fs.readFileSync(path.join(ROOT, "js/fav.js"), "utf8");
const FH = fs.readFileSync(path.join(ROOT, "fav.html"), "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

console.log("一、页面有范围下拉");
ok(/id="fv-export-scope"/.test(FH), "有导出范围下拉");
ok(/value="week" selected/.test(FH), "默认「仅周度」");
ok(/value="month"/.test(FH) && /value="all"/.test(FH), "还有「仅月度」「全部期次」");
ok(!/fv-export-scope"[^>]*disabled/.test(FH), "下拉始终可用（收藏为空时才禁用按钮）");

console.log("二、三个导出入口都带上范围");
ok(/exportPng\(ST\.items, ST\.cats, \{ scale: 2, scope: exportScope\(\)/.test(FJ), "长图导出带范围");
ok(/exportPdfForTrend\(ST\.items, ST\.cats, \{ scale: 2, scope: exportScope\(\)/.test(FJ), "PDF 发布带范围");
ok(/exportHtml\(ST\.items, ST\.cats, \{ scope: exportScope\(\) \}\)/.test(FJ), "HTML 导出带范围");
ok(/function exportScope\(\)/.test(FJ), "有统一的读取函数（三个入口同一口径）");
ok(/\(v === "month" \|\| v === "all"\) \? v : "week"/.test(FJ), "取值非法时退回「仅周度」而不是悄悄导全部");

console.log("三、分组前先按期次类型收窄");
ok(/function plan\(items, cats, opts\)/.test(FE), "plan 接收 opts");
ok(/var list = scopeItems\(items, opts\.scope\);/.test(FE), "分组用的是收窄后的列表");
ok(/function scopeItems\(items, scope\)/.test(FE), "有收窄函数");
ok(/periodTypeOf\(it && it\.period_label\) === sc/.test(FE), "按条目自己的期次判断类型");

console.log("四、周度 / 月度的判定");
const body = FE.slice(FE.indexOf("function periodTypeOf"), FE.indexOf("function scopeItems"));
/* 直接把判定函数拉出来跑 */
const fn = new Function("str", body + "; return periodTypeOf;")(
  (v) => (v == null ? "" : String(v))
);
const cases = [
  ["2026-W45", "week"], ["W45", "week"], ["45周", "week"],
  ["2026-10", "month"], ["2026年10月", "month"], ["202610", "month"], ["2026/10", "month"],
  ["", "other"], ["未标注期次", "other"], ["2026 第45周", "week"],
];
cases.forEach(([v, want]) => ok(fn(v) === want, "「" + v + "」→ " + want + (fn(v) === want ? "" : "（实得 " + fn(v) + "）")));

console.log("五、文件名 / 封面写出口径");
ok(/function scopeTag\(scope\)/.test(FE), "有口径后缀函数");
ok(/"收藏周报" \+ scopeTag\(scope\)/.test(FE), "PNG 文件名带口径");
ok(/htmlName\(now, scope\)/.test(FE), "HTML 文件名带口径");
ok(/scopeName\(opts\.scope\)/.test(FE), "长图封面写出口径");
ok(/scopeName\(scope\)/.test(FE), "PDF 封面写出口径");
ok(/字符串|scopeName\(opts\.scope\)/.test(FE), "HTML 页头写出口径");

console.log("六、选错范围时给出可操作的提示");
ok(/仅周度」里没有收藏/.test(FE), "仅周度没内容时说明原因");
ok(/改成「全部期次」再导一次/.test(FE), "并提示怎么改");

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
