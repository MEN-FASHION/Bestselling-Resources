/* ============================================================
 * 作用域体检：找出「函数被嵌套定义、却在看不见它的地方被调用」
 * —— 这类问题不报语法错，运行到那一行才炸（本次 normMMDD 事故即此类）。
 * 纯静态：屏蔽字符串/注释/正则后做括号配对 + 函数作用域链比较。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

/* 把字符串、模板、注释、正则替换成空格（保持长度不变），便于安全配对括号 */
function mask(src) {
  const out = src.split('');
  let i = 0, n = src.length;
  let prevSig = '';
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') { out[i] = ' '; i++; } continue; }
    if (c === '/' && c2 === '*') { out[i] = ' '; out[i + 1] = ' '; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out[i] = ' '; i++; } if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; } continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out[i] = ' '; i++;
      while (i < n) {
        if (src[i] === '\\') { out[i] = ' '; if (i + 1 < n) out[i + 1] = ' '; i += 2; continue; }
        if (src[i] === q) { out[i] = ' '; i++; break; }
        out[i] = ' '; i++;
      }
      prevSig = 'x'; continue;
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%~^<>]|^$/.test(prevSig)) {
      // 正则字面量
      out[i] = ' '; i++;
      let inClass = false;
      while (i < n) {
        if (src[i] === '\\') { out[i] = ' '; if (i + 1 < n) out[i + 1] = ' '; i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) { out[i] = ' '; i++; break; }
        else if (src[i] === '\n') { break; }
        out[i] = ' '; i++;
      }
      prevSig = 'x'; continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.join('');
}

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = mask(src);
  const n = m.length;
  // 括号配对表
  const match = new Int32Array(n).fill(-1);
  const stack = [];
  for (let i = 0; i < n; i++) {
    const c = m[i];
    if (c === '{' || c === '(' || c === '[') stack.push(i);
    else if (c === '}' || c === ')' || c === ']') {
      const o = stack.pop();
      if (o != null) { match[o] = i; match[i] = o; }
    }
  }
  // 函数定义（含具名函数表达式）
  const decls = [];
  const reFn = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let mm;
  while ((mm = reFn.exec(m))) {
    const name = mm[1];
    const parenOpen = m.indexOf('(', mm.index);
    const parenClose = match[parenOpen];
    if (parenClose < 0) continue;
    let braceOpen = m.indexOf('{', parenClose);
    if (braceOpen < 0) continue;
    const braceClose = match[braceOpen];
    if (braceClose < 0) continue;
    decls.push({ name, start: mm.index, bodyStart: braceOpen, bodyEnd: braceClose });
  }
  const chainAt = (pos) => {
    const chain = [];
    for (const d of decls) if (pos > d.bodyStart && pos < d.bodyEnd) chain.push(d);
    chain.sort((a, b) => (a.bodyEnd - a.bodyStart) - (b.bodyEnd - b.bodyStart));
    return chain.map((d) => d.name + '@' + d.start);
  };
  // 声明自身的可见链（不含自己）
  for (const d of decls) d.chain = chainAt(d.start).filter((x) => !x.startsWith(d.name + '@' + d.start));
  // 调用点
  const skip = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'do', 'else', 'new', 'in', 'of', 'delete', 'void', 'throw', 'case', 'yield', 'await']);
  const reCall = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  const problems = [];
  const byName = new Map();
  for (const d of decls) { if (!byName.has(d.name)) byName.set(d.name, []); byName.get(d.name).push(d); }
  let cm;
  while ((cm = reCall.exec(m))) {
    const name = cm[1];
    const pos = cm.index;
    if (skip.has(name)) continue;
    if (/\.\s*$/.test(m.slice(Math.max(0, pos - 3), pos))) continue;   // obj.name( 视为成员调用，跳过
    const ds = byName.get(name);
    if (!ds) continue;                          // 其它文件/全局定义的，跳过
    if (ds.some((d) => pos > d.start - 9 && pos < d.bodyEnd && m.slice(d.start, d.start + 9) === 'function ')) continue; // 声明自身
    const callChain = chainAt(pos);
    const visible = ds.some((d) => d.chain.every((x) => callChain.indexOf(x) >= 0));  // 祖先集合包含即可见
    if (!visible) {
      const line = src.slice(0, pos).split('\n').length;
      const encl = (ds[0].chain[0] || '顶层').split('@')[0];
      problems.push({ name, line, encl });
    }
  }
  return problems;
}

const files = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'js', f));
let total = 0;
for (const f of files) {
  const problems = scan(f);
  const name = path.basename(f);
  ok(problems.length === 0, name + (problems.length ? '：' : ' 无跨作用域调用'));
  for (const p of problems) {
    total++;
    console.log('      → 第 ' + p.line + ' 行调用 ' + p.name + '()，但它被嵌套定义在 ' + p.encl + ' 内部');
  }
}

/* 反向验证：合成一个"嵌套定义 + 外部调用"的片段，检查器必须报出来 */
const tmp = path.join('/tmp', 'scope_case.js');
fs.writeFileSync(tmp, 'function outer(){\n  function inner(){ return 1; }\n}\nfunction user(){ return inner(); }\n');
ok(scan(tmp).length === 1, '反向验证：嵌套定义被外部调用时必须报出');
fs.writeFileSync(tmp, 'function inner(){ return 1; }\nfunction user(){ return inner(); }\n');
ok(scan(tmp).length === 0, '反向验证：同一层的调用不误报');

console.log('\n扫描 ' + files.length + ' 个脚本，问题 ' + total + ' 处');
console.log('结果: 通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
