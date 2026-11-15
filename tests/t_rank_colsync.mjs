import fs from "fs";

/* 对比池 / 体征卡 / 详细报告 三处列口径必须一致
   ------------------------------------------------------------
   用户反馈：选了 3 周只显示 2 列、选 2 周只出 1 列；详细报告有时比对比池少一列。
   根因：对比池会把「这一周在这个国家/类目下没有图」的空列折叠掉，
        而体征卡与报告仍按「选了几周」算列，两边各算一套，永远对不上。
   修法：对比池记录实际画出来的列（LAST_POOL_KEYS）与被折叠的列名（LAST_POOL_DROPPED），
        体征卡按它过滤，报告头按实际列数显示，并在页面上写明折叠了哪几列。 */

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const src = fs.readFileSync("js/rank.js", "utf8");

/* ---------- 1) 记录机制存在 ---------- */
ok(/var LAST_POOL_KEYS = null, LAST_POOL_MODE = "", LAST_POOL_DROPPED = \[\];/.test(src),
  "声明了池子实际列与被折叠列两个变量");
ok(/var poolKeys = \[\], dropNames = \[\];/.test(src), "buildPools 内有收集容器");

/* ---------- 2) 每处画出一列，都要登记到 poolKeys ---------- */
const colsInc = (src.match(/cols\+\+/g) || []).length;
const keyPush = (src.match(/poolKeys\.push\(/g) || []).length;
ok(colsInc >= 3, "buildPools 内至少三处计数 cols++（国家/类目/周次）");
ok(keyPush === colsInc, "每处 cols++ 都同步 poolKeys.push（" + keyPush + " vs " + colsInc + "）");
ok(/cols\+\+; poolKeys\.push\(s\)/.test(src), "国家列登记");
ok(/cols\+\+; poolKeys\.push\(cat\)/.test(src), "类目列登记（含空类目保留列）");
ok(/cols\+\+; poolKeys\.push\(p\)/.test(src), "周次列登记");

/* ---------- 3) 折叠的列要记名字 ---------- */
ok(/dropped\+\+; dropKind = "site"; dropNames\.push\(s\)/.test(src), "折叠国家列时记名字");
ok(/dropped\+\+; dropKind = "period"; dropNames\.push\(p\)/.test(src), "折叠周列时记名字");
ok(/LAST_POOL_KEYS = poolKeys; LAST_POOL_MODE = MODE; LAST_POOL_DROPPED = dropNames;/.test(src),
  "在返回前写回全局，供体征卡与报告取用");
ok(/dropNames: dropNames/.test(src), "返回值带上折叠列名，池子上方提示才能写出是哪几列");

/* ---------- 4) 体征卡按池子过滤 ---------- */
ok(/LAST_POOL_MODE === MODE && LAST_POOL_KEYS/.test(src), "体征卡按同模式的池子列过滤");
ok(/VG = VG\.filter\(function \(g\) \{ return _kmap\[g\.key\]; \}\)/.test(src),
  "空周不再被体征卡当成一列");

/* ---------- 5) 报告头用实际列数 ---------- */
/* 报告头里的「对比列数」必须等于池子里实际画出的列数（V 已按池子过滤），
   不能再用 filter(n>0) 另外数一遍 —— 那是第二套口径，正是列数对不上的来源。
   注：报告正文判断「是否只有一列可比较」时仍用非空列，那是文案提示，不参与列数展示。 */
const pick = (name) => {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) return "";
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); } }
  return "";
};
const headFn = pick("repHeadHtml");
ok(headFn.length > 0, "能抽出 repHeadHtml");
ok(!/filter\(function \(c\) \{ return c\.n > 0; \}\)\.length/.test(headFn),
  "报告头的「对比列数」不再自己数非空列（那是第二套口径）");
ok(/V\.length/.test(headFn), "报告头按实际列数显示");
ok(/'<b>对比列数<\/b>/.test(src) || /对比列数/.test(src), "报告里仍有对比列数这一项");
ok(/已折叠 <b>'/.test(src), "报告头写明折叠了几列");

/* ---------- 6) 页面提示写出具体列名 ---------- */
ok(/R\.dropNames\.join\(" \/ "\)/.test(src), "池子上方提示写出是哪几列被折叠");

/* ---------- 7) 顺序：先算池子（写 LAST_POOL_KEYS），再用它过滤体征卡 ---------- */
const iPools = src.indexOf("var R = buildPools(CAP);");
const iVital = src.indexOf("var VG = vitalsGroups();");
const iFilter = src.indexOf("VG = VG.filter(function (g) { return _kmap[g.key]; });");
ok(iVital > 0 && iFilter > iVital, "体征卡取数后立即过滤");
ok(iPools < iVital, "对比池先算好（LAST_POOL_KEYS 已有值），再算体征卡");

/* ---------- 8) 版本戳全站一致 ---------- */
const htmls = fs.readdirSync(".").filter(f => f.endsWith(".html"));
const vers = {};
htmls.forEach(f => {
  const m = fs.readFileSync(f, "utf8").match(/\?v=(\d{8}[A-Z]+)/g) || [];
  m.forEach(v => { vers[v.slice(3)] = (vers[v.slice(3)] || 0) + 1; });
});
const versList = Object.keys(vers);
ok(versList.length === 1, "所有页面引用同一个版本戳（实际：" + versList.join(",") + "）");

console.log(`\n=== t_rank_colsync: ${pass} pass / ${fail} fail ===`);
if (fail) process.exit(1);
