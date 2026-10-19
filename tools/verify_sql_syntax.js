/* SQL 脚本语法体检（不依赖数据库，纯结构解析）
 *
 * 为什么需要它：本环境里没有可用的数据库，也没法把 SQL 送去真库解析，
 * 于是"括号少一个""引号没闭合""授权签名写错"这类错误只能靠人眼——事实证明看不住
 * （曾把 `...) as "别名")` 写成把别名套进括号里，数据库报 42601 语法错误并中断整段脚本）。
 *
 * 检查内容：
 *   1) 逐语句括号配平（会指出是第几个语句、起始行）
 *   2) 单引号 / 美元引用是否闭合
 *   3) 别名是否被误套进未闭合的括号（本次 42601 的那种写法）
 *   4) 授权语句引用的函数签名 vs 真实创建的函数签名
 *   5) 自检语句里 to_regprocedure / has_function_privilege 引用的签名是否对得上
 *      （对不上不会报错，但检查会静默显示 false，把"函数其实建好了"误报成"没建好"）
 *
 * 用法：node tools/verify_sql_syntax.js tools/setup_analytics.sql [更多 .sql ...]
 */
const fs = require("fs");

const files = process.argv.slice(2).filter((x) => x.endsWith(".sql"));
if (!files.length) {
  console.log("用法：node tools/verify_sql_syntax.js <脚本.sql> [更多 .sql ...]");
  process.exit(1);
}

let pass = 0;
const fails = [];
function ok(desc, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + desc); }
  else { fails.push(desc + (extra ? "（" + extra + "）" : "")); console.log("  ✗ " + desc + (extra ? "（" + extra + "）" : "")); }
}

/* ---------- 迷你词法扫描：跳过注释与字符串，只留下结构字符 ---------- */
function scan(text) {
  const chars = [];
  const lineOf = [];
  let i = 0, line = 1, inStr = false, inDollar = null;
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") line++;
    if (inStr) {
      if (c === "'") {
        if (text[i + 1] === "'") { i += 2; continue; }
        inStr = false;
      }
      i++; continue;
    }
    if (inDollar) {
      if (text.startsWith(inDollar, i)) { i += inDollar.length; inDollar = null; continue; }
      i++; continue;
    }
    if (text[i] === "-" && text[i + 1] === "-") {
      const j = text.indexOf("\n", i);
      i = j < 0 ? text.length : j; continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      const j = text.indexOf("*/", i + 2);
      const seg = text.slice(i, j < 0 ? text.length : j);
      line += (seg.match(/\n/g) || []).length;
      i = j < 0 ? text.length : j + 2; continue;
    }
    if (c === "'") { inStr = true; i++; continue; }
    if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
      if (m) { inDollar = m[0]; i += m[0].length; chars.push(" "); lineOf.push(line); continue; }
    }
    chars.push(c); lineOf.push(line); i++;
  }
  return { chars: chars.join(""), lineOf, unclosedStr: inStr, unclosedDollar: inDollar };
}

/* ---------- 真实创建的函数签名 ---------- */
function realFns(text) {
  const out = {};
  const re = /^create (?:or replace )?function public\.([a-z_]+)\(([^)]*)\)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const args = m.group ? [] : [];
    const list = m[2].split(",").map((x) => x.trim()).filter(Boolean);
    out[m[1]] = out[m[1]] || [];
    out[m[1]].push(list.length);
  }
  return out;
}

files.forEach((f) => {
  if (!fs.existsSync(f)) { console.log("\n找不到文件：" + f); fails.push("缺少文件 " + f); return; }
  const raw = fs.readFileSync(f, "utf8");
  const { chars, lineOf, unclosedStr, unclosedDollar } = scan(raw);
  console.log("\n=========== " + f + " ===========");

  console.log("[1] 引号与块闭合");
  ok("单引号全部闭合", !unclosedStr);
  ok("美元引用（$$ … $$）全部闭合", !unclosedDollar);

  console.log("[2] 逐语句括号配平（本次 42601 的那类问题）");
  const stmts = [];
  let start = 0;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === ";") { stmts.push([start, i]); start = i + 1; }
  }
  if (start < chars.length && chars.slice(start).trim()) stmts.push([start, chars.length]);
  const unbal = [];
  stmts.forEach(([a, b], idx) => {
    const seg = chars.slice(a, b);
    const l = (seg.match(/\(/g) || []).length, r = (seg.match(/\)/g) || []).length;
    if (l !== r) unbal.push("第 " + (idx + 1) + " 个语句（第 " + lineOf[a] + " 行）左 " + l + " 右 " + r);
  });
  ok("全部 " + stmts.length + " 个语句括号配平", unbal.length === 0, unbal.join("；"));

  console.log("[3] 别名位置（别名不能被套进未闭合的括号）");
  const badAlias = [];
  let depth = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "a" && /^as\s+"/.test(chars.slice(i, i + 12)) && depth > 0) {
      badAlias.push("第 " + lineOf[i] + " 行");
      const re = /as\s+"/g; re.lastIndex = i;
    }
  }
  ok("没有「别名写在未闭合括号里」的写法", badAlias.length === 0, badAlias.slice(0, 5).join("、"));

  console.log("[4] 签名一致性");
  const real = realFns(raw);
  const sigProblems = [];
  const grantRe = /^(grant|revoke)[^;]*?function public\.([a-z_]+)\(([^)]*)\)/gm;
  let g;
  while ((g = grantRe.exec(raw)) !== null) {
    const n = g[3].split(",").map((x) => x.trim()).filter(Boolean).length;
    if (!(real[g[2]] || []).some((c) => n === c)) sigProblems.push("第 " + raw.slice(0, g.index).split("\n").length + " 行 " + g[1] + " " + g[2] + "（" + n + " 参）");
  }
  ok("授权语句引用的签名与真实创建一致", sigProblems.length === 0, sigProblems.slice(0, 4).join("；"));

  const refProblems = [];
  const refRe = /(?:to_regprocedure|has_function_privilege)\(\s*(?:'[a-z]+'\s*,\s*)?'public\.([a-z_]+)\(([^)]*)\)'/gm;
  let r2;
  while ((r2 = refRe.exec(raw)) !== null) {
    const n = r2[2].split(",").map((x) => x.trim()).filter(Boolean).length;
    if (!real[r2[1]]) refProblems.push("第 " + raw.slice(0, r2.index).split("\n").length + " 行 " + r2[1] + "：脚本里没有创建它");
    else if (!real[r2[1]].some((c) => c === n)) refProblems.push("第 " + raw.slice(0, r2.index).split("\n").length + " 行 " + r2[1] + " 引用 " + n + " 参、实际 " + real[r2[1]].join("/") + " 参");
  }
  ok("自检语句引用的签名与真实创建一致（对不上会静默显示 false）", refProblems.length === 0, refProblems.slice(0, 4).join("；"));

  console.log("[5] 建函数语句的覆盖保护（本次 42723「函数已存在」的那类问题）");
  // 裸 create function 只有在「库里还没有这个函数」时才成功；
  // 脚本一旦被重复执行（前面失败中断过就是这样），就会报 42723 整段中断。
  // 正确做法：用 create or replace，或在其前几行放 drop function if exists 守卫。
  const findNoGuard = (txt) => {
    const out = [];
    const re = /^[ \t]*create[ \t]+(or[ \t]+replace[ \t]+)?function[ \t]+public\.([a-z_]+)[ \t]*\(/gim;
    let m;
    while ((m = re.exec(txt)) !== null) {
      if (m[1]) continue;
      const nm = m[2];
      const tail = txt.slice(0, m.index).split("\n").slice(-6).join("\n");
      if (!new RegExp("drop\\s+function\\s+if\\s+exists\\s+public\\." + nm + "\\s*\\(", "i").test(tail))
        out.push("第 " + txt.slice(0, m.index).split("\n").length + " 行 " + nm);
    }
    return out;
  };
  const noGuard = findNoGuard(raw);
  ok("每个建函数语句都带覆盖保护（可覆盖写法，或紧邻的 drop 守卫）", noGuard.length === 0, noGuard.slice(0, 4).join("；"));

  // 同一类问题在「策略」上同样会发生：裸 create policy 重复执行会报「策略已存在」
  const findNoPolGuard = (txt) => {
    const out = [];
    const re = /^[ \t]*create[ \t]+policy[ \t]+"([^"]+)"/gim;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const tail = txt.slice(0, m.index).split("\n").slice(-4).join("\n");
      const esc = m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp('drop\\s+policy\\s+if\\s+exists\\s+"' + esc + '"', "i").test(tail))
        out.push("第 " + txt.slice(0, m.index).split("\n").length + " 行 " + m[1]);
    }
    return out;
  };
  const noPol = findNoPolGuard(raw);
  ok("每个建策略语句都有紧邻的 drop policy 守卫（否则重复执行报「策略已存在」）", noPol.length === 0, noPol.slice(0, 4).join("；"));

  console.log("[6] 反向验证（还原成坏写法，检查必须失败）");
  // 通用做法：删掉脚本里任意一个右括号，配平检查必须报出来
  const cut = chars.indexOf(")");
  const mutated = cut < 0 ? chars : chars.slice(0, cut) + chars.slice(cut + 1);
  const mParts = [];
  let mStart = 0;
  for (let i = 0; i < mutated.length; i++) if (mutated[i] === ";") { mParts.push(mutated.slice(mStart, i)); mStart = i + 1; }
  if (mStart < mutated.length && mutated.slice(mStart).trim()) mParts.push(mutated.slice(mStart));
  const stillBalanced = mParts.every((p) => (p.match(/\(/g) || []).length === (p.match(/\)/g) || []).length);
  ok("还原：删掉一个右括号后，配平检查会失败", cut >= 0 && !stillBalanced);

  const wrongSig = raw.replace(/grant execute on function public\.([a-z_]+)\(([^)]*)\)/, "grant execute on function public.$1(text, text, text, text, text, text, text)");
  const real2 = realFns(wrongSig);
  const m3 = /grant execute on function public\.([a-z_]+)\(([^)]*)\)/.exec(wrongSig);
  let caught = false;
  if (m3) {
    const n = m3[2].split(",").filter(Boolean).length;
    caught = !(real2[m3[1]] || []).some((c) => c === n);
  }
  ok("还原：把授权签名写错后，签名一致性检查会失败", caught);

  // 反向：挑一个「前几行没有 drop 守卫」的函数，把它改回裸 create，覆盖保护检查必须报出来
  let bareCaught = false, bareName = "";
  const reAny = /^[ \t]*create\s+or\s+replace\s+function\s+public\.([a-z_]+)[ \t]*\(/gim;
  let m4;
  while ((m4 = reAny.exec(raw)) !== null) {
    const nm = m4[1];
    const tail = raw.slice(0, m4.index).split("\n").slice(-6).join("\n");
    if (new RegExp("drop\\s+function\\s+if\\s+exists\\s+public\\." + nm + "\\s*\\(", "i").test(tail)) continue;
    bareName = nm;
    const mut = raw.slice(0, m4.index) + "create function public." + nm + "(" + raw.slice(m4.index + m4[0].length);
    bareCaught = findNoGuard(mut).length > 0;
    break;
  }
  ok("还原：把函数 " + (bareName || "?") + " 改回裸 create 后，覆盖保护检查会失败", bareCaught);

  // 反向：凭空加一条没有 drop 守卫的策略，策略保护检查必须报出来
  const synth = raw + '\ncreate policy "zz_should_be_flagged" on public.zz_t for select to authenticated using (true);\n';
  ok("还原：新增一条没有 drop 守卫的策略后，策略保护检查会失败", findNoPolGuard(synth).length > 0);
});

console.log("\n== 结果：" + pass + " 项通过，" + fails.length + " 项失败 ==");
if (fails.length) { console.log("失败项："); fails.forEach((x) => console.log(" - " + x)); process.exit(1); }