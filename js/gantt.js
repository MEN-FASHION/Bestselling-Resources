/* ============================================================
 * gantt.js —— 服装类目上新甘特图（20261112G）
 *
 * 定位：后台「实用工具」里第三个工具，用来跟踪各服装类目的开发规划：
 *        打样 → 拍图 → 审核 → 上架，哪一类卡在哪一步一眼看到。
 *      对标 Smartsheet / 飞书多维表格甘特 / 简道云的常用能力：
 *        · 按类目分组（T恤、衬衫、裤装、裙装、外套…）
 *        · 周 / 月两种刻度，今天线，逾期标红
 *        · 拖动条形整体平移，拖右端改结束日
 *        · 进度百分比、负责人、状态
 *        · 导出 SVG / CSV
 *
 * 结构：上半部分纯函数（日期换算、分组、统计、SVG / CSV 生成），可在 node 里直接断言；
 *      下半部分 GanttBoard 渲染器（内部才用 document）。
 * 数据：只存文字与日期，KB 级。
 * ============================================================ */
(function () {
  "use strict";

  /* ================= 一、纯逻辑 ================= */

  const CATS = ["T恤", "衬衫", "卫衣", "针织", "外套", "裤装", "裙装", "套装", "内衣家居", "鞋靴", "配饰"];
  const STATUS = ["未开始", "进行中", "已完成", "延期"];
  const DAY = 86400000;

  let SEQ = 0;
  function newId(p) { SEQ += 1; return (p || "id") + "_" + Date.now().toString(36) + SEQ.toString(36); }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function parseDate(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(d) {
    if (!d) return "";
    const x = d instanceof Date ? d : parseDate(d);
    if (!x) return "";
    return x.getFullYear() + "-" + pad2(x.getMonth() + 1) + "-" + pad2(x.getDate());
  }
  function addDays(d, n) {
    const x = d instanceof Date ? new Date(d.getTime()) : parseDate(d);
    if (!x) return null;
    x.setDate(x.getDate() + n);
    return x;
  }
  /** 相差天数（b - a），只按日期算，不受时分影响 */
  function diffDays(a, b) {
    const x = a instanceof Date ? a : parseDate(a);
    const y = b instanceof Date ? b : parseDate(b);
    if (!x || !y) return 0;
    const ua = Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
    const ub = Date.UTC(y.getFullYear(), y.getMonth(), y.getDate());
    return Math.round((ub - ua) / DAY);
  }
  function today() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function minDate(list) {
    let m = null;
    list.forEach((d) => { if (d && (!m || d < m)) m = d; });
    return m;
  }
  function maxDate(list) {
    let m = null;
    list.forEach((d) => { if (d && (!m || d > m)) m = d; });
    return m;
  }

  function newDoc(title) {
    const t = today();
    return {
      id: newId("gt"),
      title: title || "服装上新甘特图",
      tasks: [],
      updated: new Date().toISOString(),
      _start: fmtDate(addDays(t, -7))
    };
  }

  function newTask(o) {
    const t = o || {};
    const start = parseDate(t.start) || today();
    let end = parseDate(t.end) || addDays(start, 6);
    if (end < start) end = addDays(start, 1);
    return {
      id: newId("tk"),
      name: String(t.name || "新任务").slice(0, 60),
      cat: CATS.indexOf(t.cat) >= 0 ? t.cat : (t.cat ? String(t.cat).slice(0, 12) : CATS[0]),
      start: fmtDate(start),
      end: fmtDate(end),
      progress: Math.min(100, Math.max(0, Number(t.progress) || 0)),
      owner: String(t.owner || "").slice(0, 20),
      status: STATUS.indexOf(t.status) >= 0 ? t.status : "未开始",
      note: String(t.note || "").slice(0, 200),
      milestone: !!t.milestone,          /* 里程碑：零工期，画成菱形 */
      deps: Array.isArray(t.deps) ? t.deps.slice(0, 20) : []   /* 前置任务 id，支持多条 */
    };
  }

  function findTask(doc, id) { return (doc.tasks || []).filter((t) => t.id === id)[0] || null; }

  function addTask(doc, task) {
    if (!doc.tasks) doc.tasks = [];
    const t = newTask(task);
    doc.tasks.push(t);
    return t;
  }

  function removeTask(doc, id) {
    const before = (doc.tasks || []).length;
    doc.tasks = (doc.tasks || []).filter((t) => t.id !== id);
    return before !== doc.tasks.length;
  }

  /** 改时长：右端拖动时保持开始日，结束日往前推一天也算合法（最短 1 天） */
  function shiftTask(task, days) {
    const s = addDays(parseDate(task.start), days);
    const e = addDays(parseDate(task.end), days);
    if (!s || !e) return false;
    task.start = fmtDate(s);
    task.end = fmtDate(e);
    return true;
  }

  function resizeTask(task, newEnd) {
    const s = parseDate(task.start);
    let e = parseDate(newEnd);
    if (!s || !e) return false;
    if (e < s) e = s;
    task.end = fmtDate(e);
    return true;
  }

  function isOverdue(task, now) {
    const e = parseDate(task.end);
    const n = now ? (now instanceof Date ? now : parseDate(now)) : today();
    if (!e || !n) return false;
    if (task.status === "已完成") return false;
    return diffDays(n, e) < 0;
  }

  /** 整体时间范围：`全部任务` 的最早开始 ~ 最晚结束，两侧留 3 天，最少 14 天 */
  function rangeOf(doc, now) {
    const list = doc.tasks || [];
    const starts = list.map((t) => parseDate(t.start));
    const ends = list.map((t) => parseDate(t.end));
    const n = now ? (now instanceof Date ? now : parseDate(now)) : today();
    let s = minDate(starts.concat([n]));
    let e = maxDate(ends.concat([n]));
    if (!s || !e) { s = n; e = addDays(n, 13); }
    s = addDays(s, -3);
    e = addDays(e, 3);
    if (diffDays(s, e) < 13) e = addDays(s, 13);
    return { start: fmtDate(s), end: fmtDate(e), days: diffDays(s, e) + 1 };
  }

  /** 按月切分表头：[{label, days, year}] */
  function monthSegments(range) {
    const s = parseDate(range.start), e = parseDate(range.end);
    if (!s || !e) return [];
    const out = [];
    let cur = new Date(s.getFullYear(), s.getMonth(), 1);
    while (cur <= e) {
      const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      const segStart = cur < s ? s : cur;
      const segEnd = mEnd > e ? e : mEnd;
      out.push({
        label: cur.getFullYear() + "-" + pad2(cur.getMonth() + 1),
        year: cur.getFullYear(),
        days: diffDays(segStart, segEnd) + 1
      });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    return out;
  }

  /** 按类目分组：类目顺序跟 CATS 一致，自定义类目排在后面；组内按开始日排 */
  function buildRows(doc, opt) {
    const o = opt || {};
    const tasks = (doc.tasks || []).slice();
    /* 组内按开始日升序：diffDays(a,b) 是 b-a，取反才是「早的在前」 */
    tasks.sort((a, b) => (-diffDays(parseDate(a.start), parseDate(b.start)) || a.name.localeCompare(b.name)));
    const cats = [];
    const seen = {};
    CATS.forEach((c) => { seen[c] = true; });
    tasks.forEach((t) => { if (!seen[t.cat]) { seen[t.cat] = true; cats.push(t.cat); } });
    const order = (o.sortCat === false) ? cats : (CATS.filter((c) => tasks.some((t) => t.cat === c))).concat(cats);
    const rows = [];
    order.forEach((cat) => {
      const list = tasks.filter((t) => t.cat === cat);
      if (!list.length) return;
      rows.push({ cat: cat, tasks: list });
    });
    return rows;
  }

  /** 统计：总数 / 已完成 / 逾期 / 平均进度 / 分类目明细 */
  function stats(doc, now) {
    const tasks = doc.tasks || [];
    const byCat = {};
    let sum = 0, done = 0, over = 0;
    tasks.forEach((t) => {
      const g = byCat[t.cat] || (byCat[t.cat] = { cat: t.cat, total: 0, done: 0, overdue: 0, progress: 0 });
      g.total += 1;
      g.progress += Number(t.progress) || 0;
      sum += Number(t.progress) || 0;
      if (t.status === "已完成" || Number(t.progress) >= 100) { g.done += 1; done += 1; }
      if (isOverdue(t, now)) { g.overdue += 1; over += 1; }
    });
    Object.keys(byCat).forEach((k) => { byCat[k].progress = byCat[k].total ? Math.round(byCat[k].progress / byCat[k].total) : 0; });
    return {
      total: tasks.length,
      done: done,
      overdue: over,
      avgProgress: tasks.length ? Math.round(sum / tasks.length) : 0,
      byCat: Object.keys(byCat).map((k) => byCat[k])
    };
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------- 依赖 / 排期 / 关键路径 / 基线 ---------------- */

  /** 加依赖：a 是 b 的前置（b 必须在 a 结束后开始）。自动拒绝成环 */
  function addDep(doc, fromId, toId) {
    const a = findTask(doc, fromId), b = findTask(doc, toId);
    if (!a || !b || fromId === toId) return false;
    if (!Array.isArray(b.deps)) b.deps = [];
    if (b.deps.indexOf(fromId) >= 0) return false;
    b.deps.push(fromId);
    if (hasCycle(doc)) { b.deps.pop(); return false; }
    return true;
  }
  function removeDep(doc, fromId, toId) {
    const b = findTask(doc, toId);
    if (!b || !Array.isArray(b.deps)) return false;
    const i = b.deps.indexOf(fromId);
    if (i < 0) return false;
    b.deps.splice(i, 1);
    return true;
  }
  /** 深度优先找环：存在循环依赖返回 true */
  function hasCycle(doc) {
    const list = doc.tasks || [];
    const map = {};
    list.forEach((t) => { map[t.id] = t; });
    const state = {};   /* 0=未访问 1=在栈上 2=完成 */
    function dfs(id) {
      if (state[id] === 1) return true;
      if (state[id] === 2) return false;
      state[id] = 1;
      const t = map[id];
      const deps = (t && t.deps) || [];
      for (let i = 0; i < deps.length; i++) {
        if (!map[deps[i]]) continue;
        if (dfs(deps[i])) return true;
      }
      state[id] = 2;
      return false;
    }
    for (let i = 0; i < list.length; i++) if (dfs(list[i].id)) return true;
    return false;
  }
  function durationOf(t) {
    if (t.milestone) return 0;
    return Math.max(0, diffDays(parseDate(t.start), parseDate(t.end)));
  }
  /** 按依赖顺延：若有前置，后继最早应该在「所有前置都结束」的次日开始。
   *  只往后推、不往回拉（避免把用户手动提前的排期改掉）；返回被移动的数量 */
  function autoSchedule(doc) {
    const list = doc.tasks || [];
    const map = {};
    list.forEach((t) => { map[t.id] = t; });
    let moved = 0;
    for (let guard = 0; guard < list.length + 2; guard++) {
      let changed = false;
      list.forEach((t) => {
        const deps = (t.deps || []).map((id) => map[id]).filter(Boolean);
        if (!deps.length) return;
        const latest = maxDate(deps.map((d) => parseDate(d.end)));
        if (!latest) return;
        const want = addDays(latest, 1);
        const cur = parseDate(t.start);
        if (!cur || want > cur) {
          const dur = t.milestone ? 0 : Math.max(0, diffDays(cur, parseDate(t.end)));
          t.start = fmtDate(want);
          t.end = fmtDate(t.milestone ? want : addDays(want, Math.max(0, dur)));
          moved += 1;
          changed = true;
        }
      });
      if (!changed) break;
    }
    return moved;
  }
  /** 关键路径：按「最早开始/最晚开始」算总浮动，浮动为 0 的任务即关键任务。
   *  返回 {ids:{}, total:天数, path:[任务名...]} */
  function criticalPath(doc) {
    const list = doc.tasks || [];
    if (!list.length) return { ids: {}, total: 0, path: [] };
    const map = {};
    list.forEach((t) => { map[t.id] = t; });
    /* 拓扑序 */
    const order = [];
    const seen = {};
    function visit(t) {
      if (!t || seen[t.id]) return;
      seen[t.id] = 1;
      (t.deps || []).forEach((id) => visit(map[id]));
      order.push(t);
    }
    list.forEach(visit);

    const es = {}, ef = {}, ls = {}, lf = {};
    let projStart = minDate(list.map((t) => parseDate(t.start)));
    if (!projStart) return { ids: {}, total: 0, path: [] };
    order.forEach((t) => {
      const dur = durationOf(t);
      let s = parseDate(t.start);
      (t.deps || []).forEach((id) => {
        const p = map[id];
        if (p && ef[p.id]) { const cand = addDays(ef[p.id], 1); if (cand > s) s = cand; }
      });
      es[t.id] = s;
      ef[t.id] = addDays(s, dur);
    });
    let projEnd = maxDate(list.map((t) => ef[t.id]));
    if (!projEnd) projEnd = projStart;
    order.slice().reverse().forEach((t) => {
      const dur = durationOf(t);
      const succ = list.filter((x) => (x.deps || []).indexOf(t.id) >= 0);
      let lfD = projEnd;
      succ.forEach((x) => {
        if (ls[x.id]) { const cand = addDays(ls[x.id], -1); if (cand < lfD) lfD = cand; }
      });
      lf[t.id] = lfD;
      ls[t.id] = addDays(lfD, -dur);
    });
    const ids = {};
    const critical = [];
    list.forEach((t) => {
      /* 浮动 = 最晚开始 - 最早开始；diffDays(a,b) = b - a，所以要按这个方向取 */
      const float = diffDays(es[t.id], ls[t.id]);
      if (float <= 0) { ids[t.id] = 1; critical.push(t); }
    });
    critical.sort((a, b) => (es[a.id] - es[b.id]));
    return {
      ids: ids,
      total: diffDays(projStart, projEnd) + 1,
      floatOf: (id) => (ls[id] && es[id]) ? Math.max(0, diffDays(es[id], ls[id])) : null,
      path: critical.map((t) => t.name)
    };
  }

  /** 基线：把当前排期存一份快照，之后可对比「计划 vs 现在」 */
  function setBaseline(doc) {
    const b = {};
    (doc.tasks || []).forEach((t) => { b[t.id] = { start: t.start, end: t.end, name: t.name }; });
    doc.baseline = { at: new Date().toISOString(), tasks: b };
    return doc.baseline;
  }
  function baselineDiff(doc) {
    const base = (doc.baseline && doc.baseline.tasks) || null;
    if (!base) return [];
    const out = [];
    (doc.tasks || []).forEach((t) => {
      const b = base[t.id];
      if (!b) { out.push({ id: t.id, name: t.name, kind: "new", days: 0 }); return; }
      const ds = diffDays(parseDate(b.start), parseDate(t.start));
      const de = diffDays(parseDate(b.end), parseDate(t.end));
      if (ds || de) out.push({ id: t.id, name: t.name, kind: "moved", startShift: ds, endShift: de, days: de });
    });
    return out;
  }

  /** 周刻度分段：[{label, days}]，跨月时以周一为界 */
  function weekSegments(range) {
    const s = parseDate(range.start), e = parseDate(range.end);
    if (!s || !e) return [];
    const out = [];
    let cur = new Date(s);
    const dow = (cur.getDay() + 6) % 7;   /* 周一=0 */
    /* 第一段从范围起点开始，之后每 7 天一段 */
    let segStart = cur;
    let remain = 7 - 0;
    let first = true;
    while (segStart <= e) {
      let segEnd = addDays(segStart, first ? (7 - dow - 1) : 6);
      if (segEnd > e) segEnd = e;
      out.push({
        label: pad2(segStart.getMonth() + 1) + "-" + pad2(segStart.getDate()),
        days: diffDays(segStart, segEnd) + 1
      });
      segStart = addDays(segEnd, 1);
      first = false;
    }
    return out;
  }

  /** 导出 SVG：与页面上看到的同一套口径（左列任务、右侧天刻度、类目分组、今天线） */
  function toSVG(doc, opt) {
    const o = opt || {};
    const now = o.now ? (o.now instanceof Date ? o.now : parseDate(o.now)) : today();
    const dayW = Number(o.dayW) || 20;
    const LEFT = 236, ROW = 34, HEAD = 58, CATROW = 28;
    const range = rangeOf(doc, now);
    const rows = buildRows(doc);
    const bodyH = rows.reduce((a, r) => a + CATROW + r.tasks.length * ROW, 0) || ROW;
    const W = LEFT + range.days * dayW + 20;
    const H = HEAD + bodyH + 16;
    const bg = o.dark ? "#0f172a" : "#ffffff";
    const line = o.dark ? "#1e293b" : "#e2e8f0";
    const ink = o.dark ? "#e2e8f0" : "#0f172a";
    const sub = o.dark ? "#94a3b8" : "#64748b";
    const xOf = (d) => LEFT + diffDays(parseDate(range.start), d) * dayW;

    let grid = "";
    const months = monthSegments(range);
    let acc = 0;
    months.forEach((m) => {
      grid += '<rect x="' + (LEFT + acc * dayW) + '" y="0" width="' + (m.days * dayW) + '" height="' + HEAD + '" fill="' + (o.dark ? "#111c2e" : "#f8fafc") + '" stroke="' + line + '"/>';
      grid += '<text x="' + (LEFT + acc * dayW + 8) + '" y="24" font-size="12" fill="' + sub + '">' + esc(m.label) + "</text>";
      acc += m.days;
    });
    let vlines = "";
    for (let i = 0; i <= range.days; i++) {
      const x = LEFT + i * dayW;
      const strong = dayW >= 16 && (parseDate(range.start) && addDays(range.start, i) && addDays(range.start, i).getDay() === 1);
      vlines += '<line x1="' + x + '" y1="' + HEAD + '" x2="' + x + '" y2="' + H + '" stroke="' + line + '" stroke-dasharray="' + (strong ? "3 3" : "0") + '"/>';
    }
    const tx = xOf(now);
    const todayLine = '<line x1="' + tx + '" y1="' + HEAD + '" x2="' + tx + '" y2="' + H + '" stroke="#ef4444" stroke-width="1.4"/>' +
      '<text x="' + (tx + 4) + '" y="' + (HEAD - 6) + '" font-size="11" fill="#ef4444">今天</text>';

    let body = "", y = HEAD;
    rows.forEach((row) => {
      body += '<rect x="0" y="' + y + '" width="' + (W - 20) + '" height="' + CATROW + '" fill="' + (o.dark ? "#111c2e" : "#f1f5f9") + '"/>';
      body += '<text x="12" y="' + (y + 19) + '" font-size="12" font-weight="600" fill="' + ink + '">' + esc(row.cat) + " (" + row.tasks.length + ")</text>";
      y += CATROW;
      row.tasks.forEach((t) => {
        const sx = xOf(t.start);
        const w = Math.max(dayW, diffDays(parseDate(t.start), parseDate(t.end)) * dayW + dayW);
        const od = isOverdue(t, now);
        const col = t.status === "已完成" ? "#22c55e" : (od ? "#ef4444" : "#6366f1");
        body += '<line x1="0" y1="' + (y + ROW) + '" x2="' + (W - 20) + '" y2="' + (y + ROW) + '" stroke="' + line + '"/>';
        body += '<text x="12" y="' + (y + 21) + '" font-size="12" fill="' + ink + '">' + esc(t.name.slice(0, 16)) + "</text>";
        body += '<rect x="' + sx + '" y="' + (y + 8) + '" width="' + w + '" height="' + (ROW - 16) + '" rx="6" fill="' + col + '" opacity="' + (t.progress ? "1" : "0.35") + '"/>';
        if (t.progress > 0 && t.progress < 100) {
          body += '<rect x="' + sx + '" y="' + (y + 8) + '" width="' + (w * t.progress / 100) + '" height="' + (ROW - 16) + '" rx="6" fill="' + col + '"/>';
        }
        if (w > 54) {
          body += '<text x="' + (sx + 8) + '" y="' + (y + 22) + '" font-size="11" fill="#ffffff">' + t.progress + "%" + (t.owner ? " · " + esc(t.owner) : "") + "</text>";
        }
        y += ROW;
      });
    });

    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Microsoft YaHei,sans-serif">' +
      '<rect width="100%" height="100%" fill="' + bg + '"/>' +
      '<text x="12" y="24" font-size="14" font-weight="600" fill="' + ink + '">' + esc(doc.title || "上新甘特图") + "</text>" +
      grid + vlines + body + todayLine + "</svg>";
  }

  /** 导出 CSV（带 BOM，Excel 双击不乱码） */
  function toCSV(doc) {
    const head = ["类目", "任务", "开始", "结束", "天数", "进度%", "负责人", "状态", "逾期", "备注"];
    const lines = [head.join(",")];
    const now = today();
    (doc.tasks || []).forEach((t) => {
      const days = diffDays(parseDate(t.start), parseDate(t.end)) + 1;
      const cells = [t.cat, t.name, t.start, t.end, days, t.progress, t.owner, t.status, isOverdue(t, now) ? "是" : "否", t.note];
      lines.push(cells.map((c) => {
        const s = String(c == null ? "" : c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(","));
    });
    return "\ufeff" + lines.join("\r\n");
  }

  /* 首次使用的示例：一条完整的服装上新链路 */
  function sampleTasks(baseDate) {
    const b = baseDate ? (baseDate instanceof Date ? baseDate : parseDate(baseDate)) : today();
    const mk = (name, cat, d0, len, prog, owner, status) => ({
      name: name, cat: cat, start: fmtDate(addDays(b, d0)), end: fmtDate(addDays(b, d0 + len)),
      progress: prog, owner: owner, status: status
    });
    return [
      mk("夏季 T恤 泡泡袖打样", "T恤", -6, 8, 100, "王蕾", "已完成"),
      mk("T恤 主图拍摄", "T恤", 2, 5, 60, "李想", "进行中"),
      mk("T恤 上架审核", "T恤", 8, 3, 0, "赵敏", "未开始"),
      mk("衬衫 通勤款打版", "衬衫", -2, 10, 40, "陈青", "进行中"),
      mk("衬衫 面料确认", "衬衫", 9, 4, 0, "陈青", "未开始"),
      mk("裤装 阔腿西裤开发", "裤装", 0, 12, 25, "周洋", "进行中"),
      mk("裙装 碎花连衣裙打样", "裙装", 5, 9, 0, "王蕾", "未开始"),
      mk("外套 轻薄防晒衣", "外套", -10, 14, 100, "李想", "已完成"),
      mk("卫衣 落肩款开发", "卫衣", 12, 10, 0, "周洋", "未开始")
    ];
  }

  window.GanttCore = {
    CATS, STATUS,
    newId, parseDate, fmtDate, addDays, diffDays, today, minDate, maxDate,
    newDoc, newTask, findTask, addTask, removeTask, shiftTask, resizeTask, isOverdue,
    rangeOf, monthSegments, weekSegments, buildRows, stats, toSVG, toCSV, sampleTasks,
    addDep, removeDep, hasCycle, autoSchedule, criticalPath, setBaseline, baselineDiff, durationOf
  };

  /* ================= 二、渲染器 ================= */

  function GanttBoard(host, opts) {
    if (!host) return null;
    const o = opts || {};
    const state = {
      doc: null, sel: "", dayW: 22,
      scale: "auto",      /* auto | month | week | day */
      filterCat: "",
      onlyOverdue: false,
      keyOn: false,       /* 关键路径高亮 */
      baseOn: false,      /* 显示基线幽灵条 */
      depFrom: "",        /* 连线起点任务 */
      hover: ""
    };
    const LEFT = 236;

    host.classList.add("gt-host");
    host.innerHTML =
      '<div class="gt-toolbar">' +
        '<button class="mm-btn mm-btn-primary" data-g="add" type="button">＋ 任务</button>' +
        '<button class="mm-btn" data-g="auto" type="button" title="按依赖关系把后继顺延">自动排期</button>' +
        '<button class="mm-btn" data-g="dep" type="button" title="先点前置任务，再点后继任务">依赖连线</button>' +
        '<button class="mm-btn" data-g="key" type="button" title="高亮关键路径">关键路径</button>' +
        '<button class="mm-btn" data-g="base" type="button" title="保存 / 对比基线">基线</button>' +
        '<span class="fc-sep"></span>' +
        '<select class="mm-select" data-g="scale">' +
          '<option value="auto">刻度自动</option><option value="month">按月</option>' +
          '<option value="week">按周</option><option value="day">按天</option></select>' +
        '<select class="mm-select" data-g="cat" data-role="cat"><option value="">全部类目</option></select>' +
        '<label class="gt-chk"><input type="checkbox" data-g="overdue"> 只看逾期</label>' +
        '<span class="mm-grow"></span>' +
        '<span class="gt-kpi" data-role="kpi"></span>' +
        '<span class="fc-sep"></span>' +
        '<button class="mm-btn" data-g="zoom-out" type="button">－</button>' +
        '<button class="mm-btn" data-g="zoom-in" type="button">＋</button>' +
        '<button class="mm-btn" data-g="svg" type="button">SVG</button>' +
        '<button class="mm-btn" data-g="png" type="button">PNG</button>' +
        '<button class="mm-btn" data-g="csv" type="button">CSV</button>' +
      "</div>" +
      '<div class="gt-edit" data-role="edit" style="display:none"></div>' +
      '<div class="gt-wrap" data-role="wrap"><div class="hint" style="padding:24px">加载中…</div></div>';

    const wrap = host.querySelector('[data-role="wrap"]');
    const editBox = host.querySelector('[data-role="edit"]');
    const kpi = host.querySelector('[data-role="kpi"]');
    const catSel = host.querySelector('[data-role="cat"]');

    const core = () => window.GanttCore;
    function C_esc(v) { return core().esc(v); }

    /* 行高常量与 CSS 保持一致：类目行 28、任务行 34 */
    const ROW = 34, CATROW = 28;

    function visibleRows() {
      const C = core();
      let rows = C.buildRows(state.doc);
      if (state.filterCat) rows = rows.filter((r) => r.cat === state.filterCat);
      if (state.onlyOverdue) {
        rows = rows.map((r) => ({ cat: r.cat, tasks: r.tasks.filter((t) => C.isOverdue(t)) })).filter((r) => r.tasks.length);
      }
      return rows;
    }

    /* 容器随行数自动长高：任务多了不再被固定高度挤成一小条 */
    function autoSize(rowCount) {
      const toolbar = host.querySelector(".gt-toolbar");
      const th = toolbar ? toolbar.offsetHeight : 44;
      const editH = editBox.style.display === "none" ? 0 : (editBox.offsetHeight || 0);
      const need = th + editH + 58 + rowCount * ROW + 24;
      const vh = (typeof window !== "undefined" && window.innerHeight) || 900;
      const maxH = Math.max(480, Math.min(1400, vh - 120));
      host.style.height = Math.max(420, Math.min(maxH, need)) + "px";
    }

    function render() {
      const C = core();
      if (!state.doc) { wrap.innerHTML = '<div class="hint" style="padding:24px">还没有任务</div>'; autoSize(0); return; }
      const range = C.rangeOf(state.doc);
      const rows = visibleRows();
      const dayW = state.dayW;
      const st = C.stats(state.doc);
      const cp = state.keyOn ? C.criticalPath(state.doc) : null;
      const diffs = (state.baseOn && state.doc.baseline) ? C.baselineDiff(state.doc) : [];
      if (kpi) {
        kpi.textContent = st.total + " 项 · 完成 " + st.done + " · 逾期 " + st.overdue + " · 平均 " + st.avgProgress + "%" +
          (cp ? " · 关键 " + cp.path.length : "");
      }

      /* 类目筛选下拉 */
      if (catSel) {
        const cats = (C.buildRows(state.doc) || []).map((r) => r.cat);
        const cur = state.filterCat;
        if (catSel.dataset.sig !== cats.join("|")) {
          catSel.innerHTML = '<option value="">全部类目</option>' + cats.map((c) => '<option value="' + C_esc(c) + '">' + C_esc(c) + "</option>").join("");
          catSel.dataset.sig = cats.join("|");
        }
        catSel.value = cur || "";
      }

      /* 表头：按刻度决定分段 */
      const months = C.monthSegments(range);
      const weeks = C.weekSegments(range);
      const segRow = state.scale === "week" || (state.scale === "auto" && dayW < 14)
        ? { list: weeks, cls: "gt-week" }
        : { list: months, cls: "gt-month" };
      let head = '<div class="gt-head"><div class="gt-left-head">任务 / 类目</div><div class="gt-time-head" style="width:' + (range.days * dayW) + 'px">';
      head += '<div class="gt-months">';
      segRow.list.forEach((m) => { head += '<span class="' + segRow.cls + '" style="width:' + (m.days * dayW) + 'px">' + m.label + "</span>"; });
      head += '</div><div class="gt-days">';
      for (let k = 0; k < range.days; k++) {
        const d = C.addDays(range.start, k);
        const isToday = C.fmtDate(d) === C.fmtDate(C.today());
        const wd = d.getDay();
        head += '<span class="gt-day' + (isToday ? " gt-today" : "") + (wd === 0 || wd === 6 ? " gt-weekend" : "") + '" style="width:' + dayW + 'px">' + (dayW >= 18 ? d.getDate() : "") + "</span>";
      }
      head += "</div></div></div>";

      /* 行：同时记录每行的 y 位置，供依赖线使用 */
      let body = "";
      let y = 0;
      const rowY = {};
      const diffMap = {};
      diffs.forEach((d) => { diffMap[d.id] = d; });
      rows.forEach((row) => {
        body += '<div class="gt-catrow" style="height:' + CATROW + 'px"><span>' + C_esc(row.cat) + " · " + row.tasks.length + " 项</span></div>";
        y += CATROW;
        row.tasks.forEach((t) => {
          rowY[t.id] = y + ROW / 2;
          const od = C.isOverdue(t);
          const isKey = cp && cp.ids[t.id];
          const sx = C.diffDays(C.parseDate(range.start), C.parseDate(t.start)) * dayW;
          const w = t.milestone ? Math.max(14, dayW) : Math.max(dayW, (C.diffDays(C.parseDate(t.start), C.parseDate(t.end)) + 1) * dayW - 2);
          const col = t.status === "已完成" ? "gt-done" : (od ? "gt-over" : "gt-run");
          let ghost = "";
          if (state.baseOn && state.doc.baseline && state.doc.baseline.tasks[t.id]) {
            const b = state.doc.baseline.tasks[t.id];
            const gx = C.diffDays(C.parseDate(range.start), C.parseDate(b.start)) * dayW;
            const gw = Math.max(dayW, (C.diffDays(C.parseDate(b.start), C.parseDate(b.end)) + 1) * dayW - 2);
            ghost = '<span class="gt-baseline" style="left:' + gx + "px;width:" + gw + 'px"></span>';
          }
          const depMark = (t.deps || []).length ? '<span class="gt-depcount" title="有前置任务">⇠' + t.deps.length + "</span>" : "";
          const dShift = diffMap[t.id] ? (diffMap[t.id].kind === "new" ? "新增" : (diffMap[t.id].endShift ? (diffMap[t.id].endShift > 0 ? "延后" + diffMap[t.id].endShift + "天" : "提前" + (-diffMap[t.id].endShift) + "天") : "")) : "";
          body += '<div class="gt-row' + (t.id === state.sel ? " gt-sel" : "") + (isKey ? " gt-key" : "") + '" data-id="' + t.id + '" style="height:' + ROW + 'px">' +
            '<div class="gt-left">' +
              '<span class="gt-name" title="' + C_esc(t.name) + '">' + C_esc(t.name) + "</span>" +
              '<span class="gt-meta">' + (t.owner ? C_esc(t.owner) + " · " : "") + t.progress + "%" + (od ? ' · <b class="gt-red">逾期</b>' : "") +
                depMark + (dShift ? ' · <b class="gt-shift">' + dShift + "</b>" : "") + "</span>" +
            "</div>" +
            '<div class="gt-track" style="width:' + (range.days * dayW) + 'px">' +
              ghost +
              (t.milestone
                ? '<span class="gt-ms" data-id="' + t.id + '" style="left:' + sx + 'px" title="里程碑 ' + C_esc(t.start) + '"></span>'
                : '<div class="gt-bar ' + col + (isKey ? " gt-bar-key" : "") + '" data-id="' + t.id + '" style="left:' + sx + "px;width:" + w + 'px">' +
                    '<span class="gt-fill" style="width:' + Math.min(100, t.progress) + '%"></span>' +
                    '<span class="gt-bar-text">' + t.progress + "%</span>" +
                    '<span class="gt-handle" data-handle="1"></span>' +
                  "</div>") +
            "</div></div>";
          y += ROW;
        });
      });

      const tx = C.diffDays(C.parseDate(range.start), C.today()) * dayW;
      const todayLine = (tx >= 0 && tx <= range.days * dayW) ? '<div class="gt-now" style="left:' + (LEFT + tx) + 'px"></div>' : "";

      /* 依赖线：SVG 覆盖在轨道区上方，用绝对坐标画折线 + 箭头 */
      const deps = [];
      (state.doc.tasks || []).forEach((t) => {
        (t.deps || []).forEach((from) => {
          if (rowY[from] != null && rowY[t.id] != null) {
            deps.push({ from: from, to: t.id, y1: rowY[from], y2: rowY[t.id] });
          }
        });
      });
      let depSvg = "";
      if (deps.length) {
        const W = LEFT + range.days * dayW, H = y;
        depSvg = '<svg class="gt-dep-svg" width="' + W + '" height="' + H + '">' +
          '<defs><marker id="gtArrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">' +
          '<path d="M0,0 L7,3 L0,6 z" fill="#8a93a5"/></marker></defs>' +
          deps.map((d) => {
            const ta = core().findTask(state.doc, d.from), tb = core().findTask(state.doc, d.to);
            if (!ta || !tb) return "";
            const x1 = LEFT + (core().diffDays(core().parseDate(range.start), core().parseDate(ta.end)) + 1) * dayW - 2;
            const x2 = LEFT + core().diffDays(core().parseDate(range.start), core().parseDate(tb.start)) * dayW;
            const midX = Math.min(x1 + 14, x2 - 6);
            return '<path class="gt-dep" d="M' + x1 + ',' + d.y1 + " L" + midX + "," + d.y1 + " L" + midX + "," + d.y2 + " L" + x2 + "," + d.y2 + '" marker-end="url(#gtArrow)"/>';
          }).join("") + "</svg>";
      }

      wrap.innerHTML = '<div class="gt-inner" style="position:relative">' + head + body + depSvg + "</div>" + todayLine;
      if (state.sel) renderEdit();
      autoSize(y + CATROW);
    }

    function renderEdit() {
      const C = core();
      const t = C.findTask(state.doc, state.sel);
      if (!t) { editBox.style.display = "none"; return; }
      editBox.style.display = "";
      const cats = C.CATS.slice();
      if (cats.indexOf(t.cat) < 0) cats.push(t.cat);
      const pre = (t.deps || []).map((id) => {
        const p = C.findTask(state.doc, id);
        return p ? C_esc(p.name) : "";
      }).filter(Boolean).join("、");
      editBox.innerHTML =
        '<div class="gt-edit-row">' +
          '<label>任务<input type="text" data-f="name" value="' + C_esc(t.name) + '" maxlength="60"></label>' +
          '<label>类目<select data-f="cat">' + cats.map((c) => '<option' + (c === t.cat ? " selected" : "") + ">" + C_esc(c) + "</option>").join("") + "</select></label>" +
          '<label>开始<input type="date" data-f="start" value="' + t.start + '"></label>' +
          '<label>结束<input type="date" data-f="end" value="' + t.end + '"></label>' +
          '<label>进度<input type="number" data-f="progress" min="0" max="100" value="' + t.progress + '"></label>' +
          '<label>负责人<input type="text" data-f="owner" value="' + C_esc(t.owner) + '" maxlength="20"></label>' +
          '<label>状态<select data-f="status">' + C.STATUS.map((x) => '<option' + (x === t.status ? " selected" : "") + ">" + x + "</option>").join("") + "</select></label>" +
          '<label class="gt-chk"><input type="checkbox" data-f="milestone"' + (t.milestone ? " checked" : "") + '> 里程碑</label>' +
        "</div>" +
        '<div class="gt-edit-row2">' +
          '<span class="gt-depinfo">前置：' + (pre || "无") + "</span>" +
          '<button class="mm-btn" data-g="shift-1" type="button">后移 1 天</button>' +
          '<button class="mm-btn" data-g="shift+1" type="button">前移 1 天</button>' +
          '<span class="mm-grow"></span>' +
          '<button class="mm-btn mm-btn-danger" data-g="del" type="button">删除任务</button>' +
          '<button class="mm-btn" data-g="close" type="button">收起</button>' +
        "</div>";
    }

    function changed() {
      if (!state.doc) return;
      state.doc.updated = new Date().toISOString();
      render();
      if (typeof o.onChange === "function") o.onChange(state.doc);
    }

    /* ---- 工具条 ---- */
    host.addEventListener("click", (e) => {
      const b = e.target.closest ? e.target.closest("[data-g]") : null;
      if (!b) return;
      const act = b.getAttribute("data-g");
      const C = core();
      if (act === "add") {
        const t = C.addTask(state.doc, { name: "新任务", cat: state.filterCat || C.CATS[0], start: C.fmtDate(C.today()), end: C.fmtDate(C.addDays(C.today(), 6)), progress: 0 });
        state.sel = t.id;
        changed();
      } else if (act === "zoom-in") { state.dayW = Math.min(48, state.dayW + 6); state.scale = "day"; render(); }
      else if (act === "zoom-out") { state.dayW = Math.max(6, state.dayW - 6); render(); }
      else if (act === "auto") {
        const n = C.autoSchedule(state.doc);
        changed();
        if (o.toast !== false && window.sbToast) window.sbToast(n ? "已按依赖顺延 " + n + " 项任务" : "排期已满足所有依赖，无需调整");
      } else if (act === "dep") {
        state.depFrom = state.sel || "";
        if (window.sbToast) window.sbToast(state.depFrom ? "已选前置任务，再点一个任务建立依赖（Esc 取消）" : "先点选一个任务作为前置", !!state.depFrom);
      } else if (act === "key") {
        state.keyOn = !state.keyOn;
        b.classList.toggle("is-on", state.keyOn);
        render();
      } else if (act === "base") {
        if (!state.doc.baseline) { C.setBaseline(state.doc); state.baseOn = true; b.classList.add("is-on"); changed(); if (window.sbToast) window.sbToast("已保存当前排期为基线"); }
        else { state.baseOn = !state.baseOn; b.classList.toggle("is-on", state.baseOn); render(); }
      } else if (act === "del") {
        if (!state.sel) return;
        C.removeTask(state.doc, state.sel);
        state.sel = "";
        changed();
      } else if (act === "close") { state.sel = ""; editBox.style.display = "none"; render(); }
      else if (act === "shift-1" || act === "shift+1") {
        const t = C.findTask(state.doc, state.sel);
        if (t) { C.shiftTask(t, act === "shift-1" ? 1 : -1); changed(); }
      } else if (act === "svg") {
        download((state.doc.title || "甘特图") + ".svg", new Blob([C.toSVG(state.doc, { dayW: state.dayW })], { type: "image/svg+xml;charset=utf-8" }));
      } else if (act === "png") {
        exportPng();
      } else if (act === "csv") {
        download((state.doc.title || "甘特图") + ".csv", new Blob([C.toCSV(state.doc)], { type: "text/csv;charset=utf-8" }));
      }
    });

    /* 下拉与勾选 */
    host.addEventListener("change", (e) => {
      const t = e.target;
      const act = t.getAttribute && t.getAttribute("data-g");
      if (act === "scale") { state.scale = t.value; state.dayW = t.value === "day" ? 26 : (t.value === "week" ? 12 : 22); render(); }
      else if (act === "cat") { state.filterCat = t.value; render(); }
      else if (act === "overdue") { state.onlyOverdue = t.checked; render(); }
      const f = t.getAttribute && t.getAttribute("data-f");
      if (f) {
        const task = core().findTask(state.doc, state.sel);
        if (!task) return;
        if (f === "progress") task.progress = Math.max(0, Math.min(100, Number(t.value) || 0));
        else if (f === "milestone") task.milestone = !!t.checked;
        else if (f === "cat") task.cat = t.value;
        else if (f === "status") task.status = t.value;
        else if (f === "start") { task.start = t.value; if (core().parseDate(task.end) < core().parseDate(task.start)) task.end = task.start; }
        else if (f === "end") { task.end = t.value; if (core().parseDate(task.end) < core().parseDate(task.start)) task.start = task.end; }
        else task[f] = t.value;
        changed();
      }
    });

    /* ---- 点选 / 依赖连线 / 拖拽改期 ---- */
    wrap.addEventListener("mousedown", (e) => {
      const C = core();
      const el = e.target;
      const bar = el.closest ? el.closest(".gt-bar") : null;
      const row = el.closest ? el.closest(".gt-row") : null;
      const ms = el.closest ? el.closest(".gt-ms") : null;
      if (!row && !bar && !ms) return;
      const id = (bar || row || ms).getAttribute("data-id");

      /* 依赖连线模式：第二次点击建立依赖 */
      if (state.depFrom && id && state.depFrom !== id) {
        const ok = C.addDep(state.doc, state.depFrom, id);
        const from = state.depFrom;
        state.depFrom = "";
        if (ok) { changed(); if (window.sbToast) window.sbToast("已建立依赖"); }
        else if (window.sbToast) window.sbToast("未能建立依赖（可能已存在或会形成循环）", false);
        e.preventDefault();
        return;
      }

      state.sel = id;
      renderEdit();
      render();
      if (!bar) return;

      /* 拖拽：整体平移或改结束日 */
      const handle = el.classList && el.classList.contains("gt-handle");
      const startX = e.clientX;
      const task = C.findTask(state.doc, id);
      if (!task) return;
      const orig = { start: task.start, end: task.end };
      const dayW = state.dayW;
      let lastDays = 0;
      function move(ev) {
        const days = Math.round((ev.clientX - startX) / dayW);
        if (days === lastDays) return;
        lastDays = days;
        if (handle) {
          C.resizeTask(task, C.fmtDate(C.addDays(C.parseDate(orig.end), days)));
        } else {
          task.start = C.fmtDate(C.addDays(C.parseDate(orig.start), days));
          task.end = C.fmtDate(C.addDays(C.parseDate(orig.end), days));
        }
        render();
      }
      function up() {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        if (lastDays) changed();
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      e.preventDefault();
    });

    document.addEventListener("keydown", function onEsc(e) {
      if (e.key === "Escape" && state.depFrom) { state.depFrom = ""; if (window.sbToast) window.sbToast("已取消依赖连线"); }
    });

    /* PNG：把导出的 SVG 画到 canvas，2 倍图 */
    function exportPng() {
      const C = core();
      const svgStr = C.toSVG(state.doc, { dayW: state.dayW });
      const m = /width="(\d+)"/.exec(svgStr);
      const w = m ? Number(m[1]) : 1200;
      const mh = /height="(\d+)"/.exec(svgStr);
      const h = mh ? Number(mh[1]) : 800;
      const img = new Image();
      img.onload = () => {
        const k = 2;
        const cv = document.createElement("canvas");
        cv.width = w * k; cv.height = h * k;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob((b) => download((state.doc.title || "甘特图") + ".png", b), "image/png");
      };
      img.onerror = () => { if (window.sbToast) window.sbToast("导出 PNG 失败，请改用 SVG", false); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
    }

    function download(name, blob) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }

    return {
      getDoc() { return state.doc; },
      setDoc(d) { state.doc = d || core().newDoc(); state.sel = ""; state.depFrom = ""; render(); },
      render: render,
      state: state
    };
  }

  window.GanttBoard = GanttBoard;
})();
