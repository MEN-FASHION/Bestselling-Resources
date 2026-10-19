#!/usr/bin/env node
/*
 * SQL 列引用静态检查（不依赖数据库）
 *
 * 背景：函数体在创建时只做语法检查，字段名写错要到「被调用时」才报 42703
 *      （column ... does not exist）。这类缺陷语法检查抓不到，必须在交付前静态比对。
 *
 * 检查内容：
 *   1. 收集 create table / alter table add column 得到的真实字段清单
 *   2. 扫描函数体：alias.column 形式的引用，alias 是否绑定到真实表
 *   3. 扫描 insert into / update ... set 的字段清单
 *   4. 反向验证：内置自测，人为制造一处错误引用，检查器必须报出
 *
 * 用法：node tools/verify_sql_columns.js tools/setup.sql tools/setup_analytics.sql tools/setup_backup.sql
 */
'use strict';
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法：node tools/verify_sql_columns.js <sql 文件...>');
  process.exit(2);
}

let pass = 0, fail = 0;
const fails = [];
function ok(name) { pass++; }
function bad(name, detail) { fail++; fails.push(name + (detail ? '  → ' + detail : '')); }
function check(cond, name, detail) { cond ? ok(name) : bad(name, detail); }

// ---------- 1. 收集表字段 ----------
const cols = new Map();          // 表名 -> Set(字段)
const tablesOrder = [];

function ensure(t) {
  if (!cols.has(t)) { cols.set(t, new Set()); tablesOrder.push(t); }
  return cols.get(t);
}

function stripSqlComments(s) {
  // 去掉 -- 行注释与 /* */ 块注释（不触碰 $tag$ 字符串内部——这些脚本里函数体外的注释才需要处理）
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

// 找匹配的右括号（考虑单引号字符串与嵌套）
function matchParen(s, openIdx) {
  let depth = 0, i = openIdx, inStr = false;
  for (; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "'") {
        if (s[i + 1] === "'") { i++; continue; }
        inStr = false;
      }
      continue;
    }
    if (c === "'") { inStr = true; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const NON_COL = new Set([
  'primary', 'unique', 'check', 'constraint', 'foreign', 'references',
  'exclude', 'like', 'inherit', 'partition', 'using', 'with'
]);

for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const src = stripSqlComments(raw);

  // create table [if not exists] public.X (
  const reT = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let m;
  while ((m = reT.exec(src))) {
    const table = m[1].toLowerCase();
    const open = src.indexOf('(', m.index + m[0].length - 1);
    const close = matchParen(src, open);
    if (close < 0) continue;
    const body = src.slice(open + 1, close);
    const set = ensure(table);
    for (let line of body.split(/[\n,]/)) {
      line = line.trim();
      if (!line) continue;
      const w = line.match(/^([a-z_][a-z0-9_]*)\b/i);
      if (!w) continue;
      const name = w[1].toLowerCase();
      if (NON_COL.has(name)) continue;
      set.add(name);
    }
  }

  // alter table public.X add column [if not exists] Y
  const reA = /alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
  while ((m = reA.exec(src))) {
    ensure(m[1].toLowerCase()).add(m[2].toLowerCase());
  }
}

/* 字段清单齐备性：至少要认出核心表 */
for (const t of ['images', 'profiles', 'visit_logs', 'admin_actions']) {
  check(cols.has(t), '能识别表字段：' + t, cols.has(t) ? '' : '未在脚本中找到该表的建表语句');
}
check(cols.get('visit_logs') && [...cols.get('visit_logs')].includes('referrer'),
  'visit_logs 含 referrer 字段');
check(cols.get('visit_logs') && [...cols.get('visit_logs')].includes('duration_sec'),
  'visit_logs 含 duration_sec 字段');
check(cols.get('admin_actions') && [...cols.get('admin_actions')].includes('detail'),
  'admin_actions 含 detail 字段');

// ---------- 2. 扫描函数体 ----------
const relTokens = /^[a-z_][a-z0-9_]*$/;

function scanBody(fileName, fnName, body) {
  // 收集 别名 -> 表
  const aliasMap = new Map();
  const reFrom = /\b(?:from|join)\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+(?:as\s+)?([a-z_][a-z0-9_]*)\b/gi;
  let m;
  while ((m = reFrom.exec(body))) {
    const table = m[1].toLowerCase();
    const alias = m[2].toLowerCase();
    if (!cols.has(table)) continue;                      // 不是已知表（可能是 CTE/子查询），跳过
    if (relTokens.test(m[2]) === false) continue;
    if (NON_ALIAS.has(alias)) continue;
    aliasMap.set(alias, table);
  }
  // 子查询别名会覆盖：把 "from ( ... ) x" 里的 x 从 aliasMap 移除
  const reSub = /\)\s*(?:as\s+)?([a-z_][a-z0-9_]*)\b/gi;
  while ((m = reSub.exec(body))) {
    aliasMap.delete(m[1].toLowerCase());
  }

  for (const [alias, table] of aliasMap) {
    const set = cols.get(table);
    const reRef = new RegExp('\\b' + alias + '\\.([a-z_][a-z0-9_]*)\\b', 'g');
    let r;
    while ((r = reRef.exec(body))) {
      const c = r[1].toLowerCase();
      if (c === 'id' || c.endsWith('')) { /* 继续走统一判断 */ }
      check(set.has(c),
        `列引用有效：${fileName} › ${fnName} › ${alias}.${c}`,
        `表 ${table} 没有字段 ${c}（真实字段：${[...set].join(', ')}）`);
    }
  }

  // insert into public.X (...) / update public.X set a = , b =
  const reIns = /insert\s+into\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi;
  while ((m = reIns.exec(body))) {
    const table = m[1].toLowerCase();
    if (!cols.has(table)) continue;
    const set = cols.get(table);
    for (const c0 of m[2].split(',')) {
      const c = c0.trim().toLowerCase();
      if (!c) continue;
      check(set.has(c), `写入字段有效：${fileName} › ${fnName} › insert ${table}.${c}`,
        `表 ${table} 没有字段 ${c}`);
    }
  }
}

const NON_ALIAS = new Set([
  'on', 'where', 'using', 'select', 'set', 'values', 'and', 'or', 'then', 'else',
  'end', 'loop', 'return', 'group', 'order', 'limit', 'offset', 'left', 'right',
  'inner', 'outer', 'full', 'cross', 'join', 'union', 'having', 'do', 'begin',
  'if', 'not', 'exists', 'as', 'over', 'filter', 'returns', 'language', 'declare'
]);

let fnCount = 0;
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const src = stripSqlComments(raw);
  const reFn = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let m;
  while ((m = reFn.exec(src))) {
    const fn = m[1].toLowerCase();
    const dollar = src.indexOf('$$', m.index);
    if (dollar < 0) continue;
    const end = src.indexOf('$$', dollar + 2);
    if (end < 0) continue;
    const body = src.slice(dollar + 2, end);
    fnCount++;
    scanBody(f.replace(/^.*[\\/]/, ''), fn, body);
  }
}
check(fnCount >= 8, '扫描到的函数数量足够（' + fnCount + ' 个）', '只扫到 ' + fnCount + ' 个函数，疑似解析失效');

// ---------- 2.5 字段对齐段覆盖度（2026-10-19 真实故障后新增）----------
// 教训：`create table if not exists` 不会给「已存在的旧表」补字段。
//      tools/setup_analytics.sql 里有「5.5 字段对齐」段负责幂等补字段，
//      但当时漏了 `visit_logs.started_at` —— 而它被 insight_front 的每一段查询使用，
//      结果旧表永远补不上该字段，后台「用户动向」一直报 42703（column does not exist）。
//      因此这里做交叉核对：凡是统计模块函数引用到的依赖表字段，必须在「5.5 字段对齐」
//      段里出现，否则旧表会漏补 → 交付后必然报 42703。
const DEP_TABLES = ['visit_logs', 'profiles', 'images', 'admin_actions', 'data_backups'];

function alignmentSet(sqlText) {
  const set = new Set();
  const i = sqlText.indexOf('5.5 字段对齐');
  const j = sqlText.indexOf('-- 6. 自检');
  if (i < 0 || j < 0 || j <= i) return set;
  const seg = sqlText.slice(i, j);
  const re = /\(\s*'(\w+)'\s*,\s*'(\w+)'\s*,/g;
  let m;
  while ((m = re.exec(seg))) set.add(m[1] + '.' + m[2]);
  return set;
}

function cleanBody(b) {
  return b.replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "'' ")
    .replace(/\$\$[\s\S]*?\$\$/g, ' ');
}

function functionBodies(sqlText) {
  const out = [];
  const re = /create (?:or replace )?function public\.(\w+)\s*\([\s\S]*?as \$\$([\s\S]*?)\$\$;/g;
  let m;
  while ((m = re.exec(sqlText))) out.push([m[1], cleanBody(m[2])]);
  return out;
}

{
  const anPath = files.find((f) => /setup_analytics\.sql$/.test(f));
  if (!anPath) {
    bad('字段对齐覆盖度：找不到 setup_analytics.sql，无法核对', '请把该文件一并传给本检查器');
  } else {
    const anSql = fs.readFileSync(anPath, 'utf8');
    const aligned = alignmentSet(anSql);
    const bodies = functionBodies(anSql).filter(([, b]) =>
      DEP_TABLES.some((t) => new RegExp('public\\.' + t + '\\b').test(b)));
    check(aligned.size >= 30, '字段对齐段可解析（覆盖 ' + aligned.size + ' 个字段）', '只解析到 ' + aligned.size + ' 个，疑似段落被改动');
    check(bodies.length >= 5, '可定位到读取依赖表的函数（' + bodies.length + ' 个）', '只定位到 ' + bodies.length + ' 个');

    // 缺口判定：给定一份对齐集合，算出「被引用却未覆盖」的字段
    function computeGaps(alignedSet) {
      const out = [];
      for (const t of DEP_TABLES) {
        const set = cols.get(t);
        if (!set) continue;
        for (const c of set) {
          if (alignedSet.has(t + '.' + c)) continue;
          const hit = bodies.filter(([, b]) => new RegExp('\\b' + c + '\\b').test(b)).map(([n]) => n);
          if (hit.length) out.push(t + '.' + c + ' ← ' + hit.join('/'));
        }
      }
      return out;
    }

    const gaps = computeGaps(aligned);
    check(gaps.length === 0,
      '字段对齐段覆盖了全部被引用的依赖字段（旧表不会漏补）',
      '漏补字段：' + gaps.join('；') + '  —— 旧表调用时会报 42703');

    // 反向验证：真的从对齐集合里删掉一个「被引用」的字段，缺口判定必须报出它
    {
      let victim = null;
      for (const t of DEP_TABLES) {
        for (const c of (cols.get(t) || [])) {
          if (!aligned.has(t + '.' + c)) continue;
          if (bodies.some(([, b]) => new RegExp('\\b' + c + '\\b').test(b))) { victim = t + '.' + c; break; }
        }
        if (victim) break;
      }
      if (!victim) bad('反向验证：找不到可用于自测的字段', '依赖表字段解析异常');
      else {
        const tmp = new Set(aligned);
        tmp.delete(victim);
        const detected = computeGaps(tmp);
        check(detected.length > 0 && detected.some((s) => s.indexOf(victim + ' ') === 0),
          '反向验证：人为漏补 ' + victim + ' 必须被判定为缺口');
      }
    }
  }
}
// ---------- 3. 反向验证 ----------
{
  const fake = ensure('__selfcheck_table');
  fake.add('a');
  const fakeBody = 'begin select t.missing_col from public.__selfcheck_table t; end;';
  const before = fail;
  scanBody('自测', 'self', fakeBody);
  check(fail > before, '反向验证：故意写错字段名必须被报出');
  cols.delete('__selfcheck_table');
  // 清掉这次自测产生的失败计数，避免污染正式统计
  const leaked = fails.filter(s => s.includes('__selfcheck_table'));
  for (const l of leaked) {
    fails.splice(fails.indexOf(l), 1);
    fail--; pass++;
  }
}

// ---------- 输出 ----------
console.log('== SQL 列引用静态检查 ==');
console.log('扫描文件：' + files.join('、'));
console.log('识别表数量：' + cols.size + '，函数数量：' + fnCount);
if (fails.length) {
  console.log('\n失败项：');
  for (const f of fails) console.log('  ✗ ' + f);
}
console.log(`\n== 结果：${pass} 项通过，${fail} 项失败 ==`);
process.exit(fail ? 1 : 0);