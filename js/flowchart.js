/* ============================================================
 * flowchart.js —— 流程图 / 泳道图（20261112G）
 *
 * 定位：后台「实用工具」里与思维导图并列的第二个工具。
 *      对标 draw.io / ProcessOn / 飞书的常用能力：
 *        · 开始 / 步骤 / 判断 / 结束 / 数据 五种节点
 *        · 泳道图（按角色/环节分道，可增删改名）
 *        · 拖动节点、拖拽连线、双击改字、Delete 删除
 *        · 自动布局（泳道内顺排，或 4 列网格）
 *        · 导出 SVG / PNG / Mermaid
 *
 * 结构：上半部分是纯函数（可在 node 里直接跑、逐项断言），
 *      下半部分 MindMapEditor 式的渲染器（内部才用 document）。
 * 数据：只存文字与坐标，不存图片，几 KB 级。
 * ============================================================ */
(function () {
  "use strict";

  /* ================= 一、纯逻辑 ================= */

  const TYPES = {
    start:    { w: 130, h: 46, label: "开始",   kind: "pill" },
    end:      { w: 130, h: 46, label: "结束",   kind: "pill" },
    process:  { w: 176, h: 58, label: "步骤",   kind: "rect" },
    decision: { w: 156, h: 88, label: "判断",   kind: "diamond" },
    data:     { w: 164, h: 56, label: "数据",   kind: "para" },
    prep:     { w: 168, h: 56, label: "准备",   kind: "hex" },
    doc:      { w: 168, h: 62, label: "文档",   kind: "doc" },
    manual:   { w: 164, h: 56, label: "人工",   kind: "trap" },
    delay:    { w: 156, h: 56, label: "等待",   kind: "round" }
  };

  const PAD_X = 46;      // 泳道左边留给道名的宽度
  const PAD_Y = 26;
  const COL_GAP = 74;    // 节点列间距（留出箭头）
  const ROW_GAP = 34;    // 泳道内节点纵向间距
  const LANE_MIN_H = 132;
  const LANE_HEAD = 30;  // 泳道顶部签名条高度

  let SEQ = 0;
  function newId(p) { SEQ += 1; return (p || "id") + "_" + Date.now().toString(36) + SEQ.toString(36); }

  function newDoc(title) {
    return {
      id: newId("fc"),
      title: title || "未命名流程图",
      swim: true,
      lanes: [{ id: newId("ln"), name: "运营" }, { id: newId("ln"), name: "商品" }],
      nodes: [],
      edges: [],
      updated: new Date().toISOString()
    };
  }

  function newNode(type, text, opt) {
    const t = TYPES[type] ? type : "process";
    const spec = TYPES[t];
    return {
      id: newId("nd"),
      type: t,
      text: String(text == null ? spec.label : text).slice(0, 120),
      lane: (opt && opt.lane) || "",
      x: Number(opt && opt.x) || 0,
      y: Number(opt && opt.y) || 0,
      w: spec.w,
      h: spec.h,
      color: (opt && opt.color) || ""
    };
  }

  function findNode(doc, id) {
    return (doc.nodes || []).filter((n) => n.id === id)[0] || null;
  }
  function findLane(doc, id) {
    return (doc.lanes || []).filter((l) => l.id === id)[0] || null;
  }

  /** 加节点：默认落到第一条泳道；坐标给 0 表示"交给自动布局" */
  function addNode(doc, node, laneId) {
    if (!node || !node.id) return null;
    if (!doc.nodes) doc.nodes = [];
    if (laneId && findLane(doc, laneId)) node.lane = laneId;
    if (!node.lane || !findLane(doc, node.lane)) node.lane = (doc.lanes && doc.lanes[0] && doc.lanes[0].id) || "";
    doc.nodes.push(node);
    return node;
  }

  /** 删节点：连带删掉它身上的所有连线，避免留下指向空气的箭头 */
  function removeNode(doc, id) {
    const before = (doc.nodes || []).length;
    doc.nodes = (doc.nodes || []).filter((n) => n.id !== id);
    doc.edges = (doc.edges || []).filter((e) => e.from !== id && e.to !== id);
    return before !== doc.nodes.length;
  }

  /** 连线：禁止自连、禁止重复（同起止算同一条） */
  function addEdge(doc, from, to, label) {
    if (!from || !to || from === to) return null;
    if (!findNode(doc, from) || !findNode(doc, to)) return null;
    if (!doc.edges) doc.edges = [];
    const dup = doc.edges.filter((e) => e.from === from && e.to === to)[0];
    if (dup) return dup;
    const e = { id: newId("eg"), from: from, to: to, label: String(label || "").slice(0, 40) };
    doc.edges.push(e);
    return e;
  }

  function removeEdge(doc, id) {
    const before = (doc.edges || []).length;
    doc.edges = (doc.edges || []).filter((e) => e.id !== id);
    return before !== doc.edges.length;
  }

  function addLane(doc, name) {
    if (!doc.lanes) doc.lanes = [];
    const l = { id: newId("ln"), name: String(name || ("泳道" + (doc.lanes.length + 1))).slice(0, 30) };
    doc.lanes.push(l);
    return l;
  }

  /** 删泳道：道里的节点回落到第一条，不允许删到一条不剩 */
  function removeLane(doc, laneId) {
    if (!doc.lanes || doc.lanes.length <= 1) return false;
    const keep = doc.lanes[0].id === laneId ? (doc.lanes[1] && doc.lanes[1].id) : doc.lanes[0].id;
    doc.lanes = doc.lanes.filter((l) => l.id !== laneId);
    (doc.nodes || []).forEach((n) => { if (n.lane === laneId) n.lane = doc.lanes[0] ? doc.lanes[0].id : ""; });
    void keep;
    return true;
  }

  function renameLane(doc, laneId, name) {
    const l = findLane(doc, laneId);
    if (!l) return false;
    l.name = String(name || "").slice(0, 30) || l.name;
    return true;
  }

  /**
   * 自动布局：
   *   泳道模式 —— 每条泳道一条横带，道内节点从左到右顺排，超过 maxPerRow 换行；带宽按内容撑开
   *   普通模式 —— 4 列网格
   * 写回 x/y 并返回整体尺寸。
   */
  function layout(doc, opt) {
    const o = opt || {};
    const maxPerRow = Math.max(1, Number(o.maxPerRow) || 4);
    const lanes = doc.lanes || [];
    const nodes = doc.nodes || [];
    const swim = doc.swim !== false && lanes.length > 0;
    const colW = maxColW(doc);
    let W = 0;

    if (swim) {
      let yCursor = PAD_Y;
      lanes.forEach((lane) => {
        const list = nodes.filter((n) => n.lane === lane.id);
        const rows = Math.max(1, Math.ceil(list.length / maxPerRow));
        let y = yCursor + LANE_HEAD + 16;
        for (let r = 0; r < rows; r++) {
          const inRow = list.filter((m, j) => Math.floor(j / maxPerRow) === r);
          const rowMaxH = inRow.reduce((a, m) => Math.max(a, m.h || 0), 0) || 58;
          inRow.forEach((m, i) => {
            m.x = PAD_X + 20 + i * (colW + COL_GAP);
            m.y = y + Math.round((rowMaxH - m.h) / 2);
          });
          y += rowMaxH + ROW_GAP;
        }
        const laneH = Math.max(LANE_MIN_H, Math.ceil(y - yCursor - ROW_GAP + 16));
        lane._y = yCursor;
        lane._h = laneH;
        yCursor += laneH;
        W = Math.max(W, laneWidth(doc, lane, maxPerRow));
      });
      return { w: Math.max(W, 560), h: yCursor + PAD_Y };
    }

    nodes.forEach((n, i) => {
      const col = i % maxPerRow, row = Math.floor(i / maxPerRow);
      n.x = PAD_X + col * (colW + COL_GAP);
      n.y = PAD_Y + row * 118;
    });
    const cols = Math.min(maxPerRow, Math.max(1, nodes.length));
    return {
      w: Math.max(560, PAD_X * 2 + cols * (colW + COL_GAP)),
      h: Math.max(240, PAD_Y * 2 + Math.ceil(nodes.length / maxPerRow) * 118)
    };
  }

  /** 泳道内可用宽度（只按节点宽度撑开，不留空列） */
  function laneWidth(doc, lane, maxPerRow) {
    const list = (doc.nodes || []).filter((n) => n.lane === lane.id);
    const cols = Math.min(maxPerRow, Math.max(1, list.length));
    return Math.max(560, PAD_X + 40 + cols * (maxColW(doc) + COL_GAP));
  }

  function maxColW(doc) {
    return (doc.nodes || []).reduce((a, n) => Math.max(a, n.w || 160), 160);
  }

  /** 泳道背景带（供渲染与导出共用） */
  function laneBands(doc, size) {
    const lanes = doc.lanes || [];
    if (!doc.swim || !lanes.length) return [];
    const total = (size && size.w) || 900;
    return lanes.map((l, i) => ({
      id: l.id,
      name: l.name,
      x: 0,
      y: l._y != null ? l._y : (PAD_Y + i * LANE_MIN_H),
      w: total,
      h: l._h != null ? l._h : LANE_MIN_H
    }));
  }

  /** 折行：中文按字数，英文按词 */
  function wrapText(text, maxChars) {
    const s = String(text == null ? "" : text);
    const max = Math.max(1, maxChars || 8);
    const out = [];
    s.split(/\n/).forEach((line) => {
      let cur = "";
      const tokens = line.match(/[\u4e00-\u9fa5]|[A-Za-z0-9'’\-.]+|\s+|./g) || [];
      tokens.forEach((tk) => {
        if (cur.length + tk.length > max && cur) { out.push(cur); cur = ""; }
        if (tk.length > max) {
          for (let i = 0; i < tk.length; i += max) out.push(tk.slice(i, i + max));
          cur = "";
        } else cur += tk;
      });
      out.push(cur);
      void out;
    });
    return out.filter((x, i, a) => !(x === "" && i === a.length - 1) || a.length === 1);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /** 单个节点的 SVG 片段 */
  function shapeSvg(n, opt) {
    const o = opt || {};
    const stroke = n.color || o.stroke || "#94a3b8";
    const fill = o.fill || "#ffffff";
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    let shape = "";
    if (n.type === "decision") {
      shape = '<polygon points="' + [cx + "," + n.y, (n.x + n.w) + "," + cy, cx + "," + (n.y + n.h), n.x + "," + cy].join(" ") + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6"/>';
    } else if (n.type === "data") {
      const k = 16;
      shape = '<polygon points="' + [(n.x + k) + "," + n.y, (n.x + n.w) + "," + n.y, (n.x + n.w - k) + "," + (n.y + n.h), n.x + "," + (n.y + n.h)].join(" ") + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6"/>';
    } else if (n.type === "start" || n.type === "end") {
      shape = '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="' + (n.h / 2) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.8"/>';
    } else if (n.type === "prep") {
      const k = 18;
      shape = '<polygon points="' + [(n.x + k) + "," + n.y, (n.x + n.w - k) + "," + n.y, (n.x + n.w) + "," + cy, (n.x + n.w - k) + "," + (n.y + n.h), (n.x + k) + "," + (n.y + n.h), n.x + "," + cy].join(" ") + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6"/>';
    } else if (n.type === "doc") {
      const bw = Math.max(18, (n.w - 26) / 2);
      shape = '<path d="M' + n.x + "," + n.y + " L" + (n.x + n.w) + "," + n.y + " L" + (n.x + n.w) + "," + (n.y + n.h - 12) +
        " q" + (-bw / 2) + ",12 " + (-bw) + ",0 q" + (-bw / 2) + ",-12 " + (-bw) + ",0 L" + n.x + "," + (n.y + n.h) +
        ' z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6"/>';
    } else if (n.type === "manual") {
      shape = '<polygon points="' + n.x + "," + n.y + " " + (n.x + n.w) + "," + n.y + " " + (n.x + n.w - 16) + "," + (n.y + n.h) + " " + (n.x + 16) + "," + (n.y + n.h) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6"/>';
    } else if (n.type === "delay") {
      shape = '<path d="M' + n.x + "," + n.y + " L" + (n.x + n.w - n.h / 2) + "," + n.y + " A" + (n.h / 2) + "," + (n.h / 2) + " 0 0 1 " + (n.x + n.w - n.h / 2) + "," + (n.y + n.h) + " L" + n.x + "," + (n.y + n.h) + ' z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6"/>';
    } else {
      shape = '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="9" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6"/>';
    }
    const maxChars = n.type === "decision" ? 7 : Math.max(6, Math.floor((n.w - 22) / 13));
    const lines = wrapText(n.text, maxChars).slice(0, 5);
    const lh = 18;
    const startY = cy - ((lines.length - 1) * lh) / 2;
    const text = lines.map((ln, i) => '<tspan x="' + cx + '" y="' + (startY + i * lh) + '">' + esc(ln) + "</tspan>").join("");
    return '<g class="fc-node" data-id="' + n.id + '">' + shape +
      '<text class="fc-label" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="' + (o.text || "#0f172a") + '">' + text + "</text>" +
      "</g>";
  }

  /** 连线路径：从源右侧中点出发，折到目标左侧中点 */
  function edgePath(a, b) {
    const x1 = a.x + a.w, y1 = a.y + a.h / 2;
    const x2 = b.x, y2 = b.y + b.h / 2;
    if (x2 < x1 + 12) {
      // 目标在左侧：绕一圈，避免线压在节点上
      const midY = (y1 + y2) / 2 + (y2 > y1 ? 40 : -40);
      return "M" + x1 + " " + y1 + " C" + (x1 + 40) + " " + y1 + " " + (x1 + 40) + " " + midY + " " + (x1 + 20) + " " + midY +
        " L" + (x2 - 30) + " " + midY + " C" + (x2 - 40) + " " + midY + " " + (x2 - 20) + " " + y2 + " " + x2 + " " + y2;
    }
    const dx = Math.max(40, (x2 - x1) / 2);
    return "M" + x1 + " " + y1 + " C" + (x1 + dx) + " " + y1 + " " + (x2 - dx) + " " + y2 + " " + x2 + " " + y2;
  }

  function edgeSvg(doc, e, opt) {
    const a = findNode(doc, e.from), b = findNode(doc, e.to);
    if (!a || !b) return "";
    const d = edgePath(a, b);
    const o = opt || {};
    let t = "";
    if (e.label) {
      const mx = (a.x + a.w + b.x) / 2, my = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
      t = '<text x="' + mx + '" y="' + (my - 6) + '" text-anchor="middle" font-size="11" fill="' + (o.sub || "#64748b") + '">' + esc(e.label) + "</text>";
    }
    return '<path class="fc-edge" data-id="' + e.id + '" d="' + d + '" fill="none" stroke="' + (o.stroke || "#94a3b8") + '" stroke-width="1.6" marker-end="url(#fcArrow)"/>' + t;
  }

  /** 导出 SVG（画布与导出共用同一套画法，保证"所见即所得"） */
  function toSVG(doc, opt) {
    const o = opt || {};
    const size = layout(doc, { maxPerRow: o.maxPerRow || 4 });
    const bg = o.bg || "#ffffff";
    const dark = !!o.dark;
    const bands = laneBands(doc, size);
    const bandSvg = bands.map((b, i) => {
      const fill = dark ? (i % 2 ? "#0f172a" : "#111c2e") : (i % 2 ? "#f8fafc" : "#f1f5f9");
      return '<g class="fc-lane"><rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" fill="' + fill + '" stroke="' + (dark ? "#1e293b" : "#e2e8f0") + '"/>' +
        '<text x="14" y="' + (b.y + 20) + '" font-size="12" fill="' + (dark ? "#94a3b8" : "#64748b") + '">' + esc(b.name) + "</text></g>";
    }).join("");
    const edges = (doc.edges || []).map((e) => edgeSvg(doc, e, { stroke: dark ? "#475569" : "#94a3b8", sub: dark ? "#64748b" : "#64748b" })).join("");
    const nodes = (doc.nodes || []).map((n) => shapeSvg(n, { fill: dark ? "#1e293b" : "#ffffff", stroke: dark ? "#64748b" : "#94a3b8", text: dark ? "#e2e8f0" : "#0f172a" })).join("");
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size.w + '" height="' + size.h + '" viewBox="0 0 ' + size.w + " " + size.h + '" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Microsoft YaHei,sans-serif">' +
      '<defs><marker id="fcArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="' + (dark ? "#64748b" : "#94a3b8") + '"/></marker></defs>' +
      '<rect width="100%" height="100%" fill="' + bg + '"/>' + bandSvg + edges + nodes + "</svg>";
  }

  /** 导出 Mermaid 文本：贴进 note / 飞书 可继续渲染 */
  function toMermaid(doc) {
    const lines = ["flowchart LR"];
    (doc.nodes || []).forEach((n) => {
      const t = String(n.text || "").replace(/"/g, "'");
      if (n.type === "decision") lines.push('  ' + n.id + '{"' + t + '"}');
      else if (n.type === "start" || n.type === "end") lines.push('  ' + n.id + '(["' + t + '"])');
      else if (n.type === "data") lines.push('  ' + n.id + '[("' + t + '")]');
      else lines.push('  ' + n.id + '["' + t + '"]');
    });
    (doc.edges || []).forEach((e) => {
      lines.push("  " + e.from + (e.label ? ' -->|"' + String(e.label).replace(/"/g, "'") + '"| ' : " --> ") + e.to);
    });
    return lines.join("\n");
  }

  /** 统计：节点数、连线数、判断数（面板上显示用） */
  function stats(doc) {
    const nodes = (doc.nodes || []).length;
    return {
      nodes: nodes,
      edges: (doc.edges || []).length,
      decisions: (doc.nodes || []).filter((n) => n.type === "decision").length,
      lanes: (doc.lanes || []).length
    };
  }

  window.FlowchartCore = {
    TYPES, newId, newDoc, newNode, findNode, findLane,
    addNode, removeNode, addEdge, removeEdge,
    addLane, removeLane, renameLane,
    layout, laneBands, laneWidth, wrapText, esc,
    shapeSvg, edgePath, edgeSvg, toSVG, toMermaid, stats
  };

  /* ================= 二、渲染器 ================= */

  function FlowchartEditor(host, opts) {
    if (!host) return null;
    const o = opts || {};
    const state = { doc: null, sel: "", linking: "", dirty: false, zoom: 1 };

    host.innerHTML =
      '<div class="fc-toolbar">' +
        '<button class="mm-btn mm-btn-primary" data-a="add-process" type="button">＋ 步骤</button>' +
        '<button class="mm-btn" data-a="add-decision" type="button">＋ 判断</button>' +
        '<button class="mm-btn" data-a="add-start" type="button">＋ 开始</button>' +
        '<button class="mm-btn" data-a="add-end" type="button">＋ 结束</button>' +
        '<button class="mm-btn" data-a="add-data" type="button">＋ 数据</button>' +
        '<button class="mm-btn" data-a="add-prep" type="button">＋ 准备</button>' +
        '<button class="mm-btn" data-a="add-doc" type="button">＋ 文档</button>' +
        '<button class="mm-btn" data-a="add-delay" type="button">＋ 等待</button>' +
        '<span class="fc-sep"></span>' +
        '<button class="mm-btn" data-a="link" type="button">连线</button>' +
        '<button class="mm-btn" data-a="layout" type="button">自动布局</button>' +
        '<button class="mm-btn" data-a="swim" type="button">泳道</button>' +
        '<button class="mm-btn" data-a="lane-add" type="button">＋ 泳道</button>' +
        '<span class="mm-grow"></span>' +
        '<span class="fc-hint" data-role="hint"></span>' +
        '<button class="mm-btn" data-a="del" type="button">删除</button>' +
        '<button class="mm-btn" data-a="svg" type="button">导出 SVG</button>' +
        '<button class="mm-btn" data-a="png" type="button">导出 PNG</button>' +
        '<button class="mm-btn" data-a="mermaid" type="button">导出 Mermaid</button>' +
      "</div>" +
      '<div class="fc-canvas" data-role="canvas"><div class="hint" style="padding:24px">加载中…</div></div>';

    host.classList.add("fc-host");
    const canvas = host.querySelector('[data-role="canvas"]');
    const hintEl = host.querySelector('[data-role="hint"]');

    function size() { return window.FlowchartCore.layout(state.doc, { maxPerRow: 4 }); }
    function esc2(s) { return window.FlowchartCore.esc(s); }

    function render() {
      if (!state.doc) { canvas.innerHTML = '<div class="hint" style="padding:24px">还没有流程图</div>'; return; }
      const core = window.FlowchartCore;
      const sz = size();
      const bands = core.laneBands(state.doc, sz);
      const bandSvg = bands.map((b, i) =>
        '<g class="fc-lane"><rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" fill="' + (i % 2 ? "#f8fafc" : "#f1f5f9") + '" stroke="#e2e8f0"/>' +
        '<text x="14" y="' + (b.y + 20) + '" font-size="12" fill="#64748b">' + esc2(b.name) + "</text></g>").join("");
      const edges = (state.doc.edges || []).map((e) => core.edgeSvg(state.doc, e, {})).join("");
      const nodes = (state.doc.nodes || []).map((n) =>
        core.shapeSvg(n, { fill: n.id === state.sel ? "#eef2ff" : "#ffffff", stroke: n.id === state.sel ? "#6366f1" : (n.color || "#94a3b8") })).join("");
      canvas.innerHTML = '<svg class="fc-svg" width="' + sz.w + '" height="' + sz.h + '" viewBox="0 0 ' + sz.w + " " + sz.h + '">' +
        '<defs><marker id="fcArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#94a3b8"/></marker></defs>' +
        bandSvg + edges + nodes + "</svg>";
      /* 画布高度跟着内容走，节点多了不会被固定小框切掉 */
      autoSize(sz);
      if (hintEl) {
        const st = core.stats(state.doc);
        hintEl.textContent = state.linking ? "连线中：请点目标节点（Esc 取消）" :
          st.nodes + " 个节点 · " + st.edges + " 条连线 · " + st.lanes + " 条泳道";
      }
    }

    function autoSize(sz) {
      const toolbar = host.querySelector(".fc-toolbar");
      const th = toolbar ? toolbar.offsetHeight : 44;
      const need = th + (sz && sz.h ? sz.h : 400) + 28;
      const vh = (typeof window !== "undefined" && window.innerHeight) || 900;
      const maxH = Math.max(460, Math.min(1400, vh - 120));
      host.style.height = Math.max(380, Math.min(maxH, need)) + "px";
    }

    function changed(silent) {
      state.doc.updated = new Date().toISOString();
      render();
      if (!silent && typeof o.onChange === "function") o.onChange(state.doc);
    }

    function selNode() { return state.doc ? window.FlowchartCore.findNode(state.doc, state.sel) : null; }

    function addOfType(type) {
      const core = window.FlowchartCore;
      const cur = selNode();
      const node = core.newNode(type, core.TYPES[type].label, { lane: cur ? cur.lane : "" });
      core.addNode(state.doc, node);
      state.sel = node.id;
      changed();
    }

    /* 就地编辑：在节点位置直接出输入框，不再弹窗打断 */
    async function rename(node) {
      if (!node) return;
      const old = canvas.querySelector(".mm-edit");
      if (old) old.remove();
      const box = document.createElement("div");
      box.className = "mm-edit fc-edit";
      box.style.left = Math.max(4, node.x) + "px";
      box.style.top = Math.max(4, node.y) + "px";
      box.style.width = Math.max(150, node.w + 30) + "px";
      const inp = document.createElement("textarea");
      inp.value = node.text || "";
      inp.rows = 2;
      box.appendChild(inp);
      const tip = document.createElement("div");
      tip.className = "mm-edit-tip";
      tip.textContent = "Enter 保存 · Shift+Enter 换行 · Esc 取消";
      box.appendChild(tip);
      canvas.appendChild(box);
      setTimeout(() => { inp.focus(); inp.select(); }, 0);

      function autogrow() { inp.style.height = "auto"; inp.style.height = Math.min(160, Math.max(40, inp.scrollHeight + 4)) + "px"; }
      inp.addEventListener("input", autogrow);
      autogrow();

      let done = false;
      function commit(save) {
        if (done) return;
        done = true;
        const v = inp.value.replace(/\s+$/, "");
        box.remove();
        if (save && v && v !== node.text) { node.text = v.slice(0, 120); changed(); }
        else render();
      }
      inp.addEventListener("blur", () => commit(true));
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); commit(false); }
        else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(true); }
      });
    }

    function download(name, blob) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }

    function exportSvg() {
      const core = window.FlowchartCore;
      const svg = core.toSVG(state.doc, {});
      download((state.doc.title || "流程图") + ".svg", new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    }

    function exportPng() {
      const core = window.FlowchartCore;
      const svg = core.toSVG(state.doc, {});
      const img = new Image();
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = img.width * 2; cv.height = img.height * 2;
        const ctx = cv.getContext("2d");
        ctx.scale(2, 2);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, img.width, img.height);
        ctx.drawImage(img, 0, 0);
        cv.toBlob((b) => download((state.doc.title || "流程图") + ".png", b), "image/png");
      };
      img.src = url;
    }

    host.addEventListener("click", (e) => {
      const a = e.target.closest ? e.target.closest("[data-a]") : null;
      if (!a) return;
      const act = a.getAttribute("data-a");
      const core = window.FlowchartCore;
      if (act === "add-process") addOfType("process");
      else if (act === "add-decision") addOfType("decision");
      else if (act === "add-start") addOfType("start");
      else if (act === "add-end") addOfType("end");
      else if (act === "link") { state.linking = state.linking ? "" : (state.sel || ""); render(); }
      else if (act === "layout") { core.layout(state.doc, { maxPerRow: 4 }); changed(); }
      else if (act === "swim") { state.doc.swim = state.doc.swim === false; changed(); }
      else if (act === "lane-add") {
        if (window.sbAsk) {
          window.sbAsk({ title: "新增泳道", desc: "一般写角色或环节名", value: "", placeholder: "如：设计" }).then((v) => {
            if (v == null) return;
            core.addLane(state.doc, v); changed();
          });
        } else { core.addLane(state.doc, ""); changed(); }
      } else if (act === "del") {
        if (!state.sel) return;
        core.removeNode(state.doc, state.sel);
        state.sel = "";
        changed();
      } else if (act === "svg") exportSvg();
      else if (act === "png") exportPng();
      else if (act === "mermaid") download((state.doc.title || "流程图") + ".mmd", new Blob([core.toMermaid(state.doc)], { type: "text/plain;charset=utf-8" }));
    });

    canvas.addEventListener("click", async (e) => {
      const g = e.target.closest ? e.target.closest(".fc-node") : null;
      const core = window.FlowchartCore;
      if (!g) { state.sel = ""; render(); return; }
      const id = g.getAttribute("data-id");
      if (state.linking && state.linking !== id) {
        core.addEdge(state.doc, state.linking, id);
        state.linking = "";
        state.sel = id;
        changed();
        return;
      }
      state.sel = id;
      render();
    });

    canvas.addEventListener("dblclick", (e) => {
      const g = e.target.closest ? e.target.closest(".fc-node") : null;
      if (!g) return;
      e.preventDefault();
      const n = window.FlowchartCore.findNode(state.doc, g.getAttribute("data-id"));
      if (n) { state.sel = n.id; render(); rename(n); }
    });

    /* 拖拽移动：pointer 事件，拖动时只改坐标不重排 */
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      const g = e.target.closest ? e.target.closest(".fc-node") : null;
      if (!g) return;
      const n = window.FlowchartCore.findNode(state.doc, g.getAttribute("data-id"));
      if (!n) return;
      const box = canvas.getBoundingClientRect();
      drag = { id: n.id, dx: e.clientX - box.left - n.x, dy: e.clientY - box.top - n.y };
      state.sel = n.id;
      g.classList.add("dragging");
      render();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const n = window.FlowchartCore.findNode(state.doc, drag.id);
      if (!n) return;
      const box = canvas.getBoundingClientRect();
      n.x = Math.max(4, e.clientX - box.left - drag.dx);
      n.y = Math.max(4, e.clientY - box.top - drag.dy);
      render();
    });
    canvas.addEventListener("pointerup", () => {
      if (!drag) return;
      drag = null;
      changed();
    });
    canvas.addEventListener("pointerleave", () => { if (drag) { drag = null; changed(); } });

    const onKey = (e) => {
      if (host.offsetParent === null && host.getClientRects().length === 0) return;
      if (/^(INPUT|TEXTAREA)$/.test((document.activeElement && document.activeElement.tagName) || "")) return;
      if (e.key === "Escape" && state.linking) { state.linking = ""; render(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && state.sel) {
        e.preventDefault();
        window.FlowchartCore.removeNode(state.doc, state.sel);
        state.sel = "";
        changed();
      }
    };
    document.addEventListener("keydown", onKey);

    const api = {
      getDoc() { return state.doc; },
      setDoc(doc) { state.doc = doc || window.FlowchartCore.newDoc(); state.sel = ""; render(); },
      render: render,
      destroy() { document.removeEventListener("keydown", onKey); }
    };
    return api;
  }

  window.FlowchartEditor = FlowchartEditor;
})();
