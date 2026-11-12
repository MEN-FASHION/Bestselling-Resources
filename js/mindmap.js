/* ============================================================
 * mindmap.js —— 思维导图引擎（20261112G）
 *
 * 目标：后台「实用工具」里的思维导图，交互与能力对标 XMind / 幕布 / GitMind。
 *
 * 分层：
 *   window.MindMapCore   —— 纯逻辑（布局 / 文本换行 / 节点增删移动 / 导出文本），无 DOM 依赖，可单测
 *   window.MindMapEditor —— 渲染与交互（SVG 画布），挂到指定容器
 *
 * 数据模型（一棵树，直接可 JSON 序列化）：
 *   { id, text, note, color, collapsed, children: [ ... ] }
 *
 * 刻意不引第三方图库：全部用原生 SVG 画，离线可用、体积小、样式可完全控制。
 * ============================================================ */
(function () {
  "use strict";

  /* ---------------- 基础工具 ---------------- */
  function uid(prefix) {
    return (prefix || "n") + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function newNode(text, extra) {
    return Object.assign({
      id: uid("n"), text: text == null ? "" : String(text),
      note: "", color: "", collapsed: false, children: [],
      tags: [],        /* 标签，用于筛选与标注 */
      prio: 0,         /* 优先级 1~3，0=未设 */
      progress: -1,    /* 进度 0~100，-1=不显示 */
      mark: "",        /* 图标/表情标记 */
      link: ""         /* 超链接 */
    }, extra || {});
  }

  /* ---------------- 文本尺寸估算 ----------------
   * 不依赖 canvas 测量（无 DOM 环境也能算，保证布局可单测）。
   * 中文/全角按 1em，英文数字按 0.56em，空格 0.3em，其余符号保守按 0.6em。
   * ------------------------------------------------------------ */
  function charW(ch) {
    const c = ch.codePointAt(0);
    if (c === 32) return 0.30;
    if (c >= 0x2E80 && c <= 0x9FFF) return 1.00;   // 中日韩
    if (c >= 0xF900 && c <= 0xFAFF) return 1.00;
    if (c >= 0xFF00 && c <= 0xFF60) return 1.00;   // 全角
    if (c >= 0x3000 && c <= 0x303F) return 1.00;   // 中文标点
    if (c >= 0xAC00 && c <= 0xD7AF) return 1.00;   // 韩文
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57)) return 0.56;
    return 0.60;
  }
  function textWidth(str, fontSize) {
    let w = 0;
    const s = String(str || "");
    for (const ch of s) w += charW(ch);
    return w * fontSize;
  }

  /* 按像素宽度折行：中文可任意断，英文按单词整体（超长单词强制断） */
  function wrapText(text, maxWidth, fontSize) {
    const s = String(text == null ? "" : text).replace(/\r/g, "");
    const out = [];
    String(s).split("\n").forEach((para) => {
      if (!para) { out.push(""); return; }
      let line = "";
      let lineW = 0;
      const tokens = para.match(/[A-Za-z0-9_.\-]+|\s+|[\s\S]/g) || [];
      tokens.forEach((tk) => {
        const tkW = textWidth(tk, fontSize);
        // 单个 token 就超宽：逐字硬断
        if (tkW > maxWidth && !/^\s+$/.test(tk)) {
          for (const ch of tk) {
            const cw = textWidth(ch, fontSize);
            if (lineW + cw > maxWidth && line) { out.push(line); line = ""; lineW = 0; }
            line += ch; lineW += cw;
          }
          return;
        }
        if (lineW + tkW > maxWidth && line.trim()) {
          out.push(line.replace(/\s+$/, ""));
          line = /^\s+$/.test(tk) ? "" : tk;
          lineW = /^\s+$/.test(tk) ? 0 : tkW;
        } else {
          line += tk; lineW += tkW;
        }
      });
      out.push(line.replace(/\s+$/, ""));
    });
    return out.length ? out : [""];
  }

  /* ---------------- 结构与主题 ----------------
   * 结构影响布局方向：both=思维导图（中心向左右发散）、right=逻辑图/树状图、
   * down=组织架构图。切换结构只改渲染方向，节点内容与层级完全不动。
   * ------------------------------------------------------------------ */
  const STRUCTURES = [
    { key: "both", name: "思维导图（左右）" },
    { key: "right", name: "逻辑图 / 树状图" },
    { key: "down", name: "组织架构图（向下）" }
  ];
  const THEMES = [
    { key: "default", name: "经典蓝", bg: "#ffffff", text: "#1f2733", colors: ["#3b7ddd", "#f0994a", "#4aa96c", "#9b6bd6", "#e05d6f", "#2fa8a0"] },
    { key: "mint", name: "薄荷", bg: "#f7fdfb", text: "#16413a", colors: ["#0f9d8a", "#3ab795", "#7ac74f", "#2d8f7b", "#59b8a8", "#a3d9a5"] },
    { key: "warm", name: "暖橙", bg: "#fffaf4", text: "#4a3418", colors: ["#e8813a", "#d9542b", "#f0b429", "#c96f3a", "#b8552e", "#e2a04a"] },
    { key: "mono", name: "单色灰", bg: "#ffffff", text: "#24292f", colors: ["#5c6b7a", "#7a8a99", "#8f9ba8", "#6b7a89", "#a0aab5", "#7f8b96"] },
    { key: "berry", name: "莓果", bg: "#fff8fb", text: "#3d1f2e", colors: ["#c2418a", "#8d5bd6", "#e0654f", "#a33d7d", "#6f52b8", "#d4708f"] }
  ];
  function themeOf(key) {
    return THEMES.filter((t) => t.key === key)[0] || THEMES[0];
  }

  /* ---------------- 布局 ---------------- */
  const DEF = {
    fontSize: 14,
    rootFontSize: 17,
    padX: 14,
    padY: 9,
    lineH: 20,
    maxTextW: 240,      // 单节点文本最大宽（超了折行）
    minNodeW: 56,
    gapX: 56,           // 父右边缘 → 子左边缘
    gapY: 12,           // 兄弟节点间距
    rootGapX: 72
  };

  /* 节点副信息（一行小字）：优先级 · 进度 · 标签 · 备注标记 */
  function metaText(node) {
    const parts = [];
    if (node && node.prio > 0) parts.push("★".repeat(Math.min(3, node.prio | 0)));
    if (node && typeof node.progress === "number" && node.progress >= 0) parts.push((node.progress | 0) + "%");
    (node && node.tags || []).forEach((t) => parts.push("#" + t));
    if (node && node.note) parts.push("注");
    if (node && node.link) parts.push("链");
    return parts.join(" · ");
  }

  function measure(node, depth, opt) {
    const o = Object.assign({}, DEF, opt || {});
    const fs = depth === 0 ? o.rootFontSize : o.fontSize;
    const maxW = depth === 0 ? o.maxTextW + 40 : o.maxTextW;
    const lines = wrapText(node.text || "（空）", maxW, fs);
    const meta = metaText(node);
    const metaFs = 11;
    /* 副信息比正文长时，节点要跟着变宽，不能把它挤成省略号 */
    const metaW = meta ? Math.min(maxW, textWidth(meta, metaFs)) : 0;
    const tw = Math.min(maxW, Math.max.apply(null, lines.map((l) => textWidth(l, fs)).concat([metaW, 0])));
    const w = Math.max(o.minNodeW, Math.round(tw + o.padX * 2));
    const metaH = meta ? 16 : 0;
    const needLines = lines.length;
    const h = Math.max((depth === 0 ? 44 : 36) + metaH, Math.round(needLines * o.lineH + o.padY * 2 + metaH));
    return { w: w, h: h, lines: lines, fontSize: fs, meta: meta, metaH: metaH, metaFontSize: metaFs };
  }

  /* 可见子节点（折叠=不可见） */
  function visibleChildren(n) {
    return (!n.collapsed && Array.isArray(n.children)) ? n.children : [];
  }

  /* 右向布局（内部用）：返回原始坐标，供各种结构做变换 */
  function buildRight(root, o) {
    const nodes = [];
    const edges = [];
    const levelMaxW = [];
    let cursorY = 0;

    (function measureTree(n, depth, parentId) {
      const m = measure(n, depth, o);
      levelMaxW[depth] = Math.max(levelMaxW[depth] || 0, m.w);
      const rec = {
        id: n.id, text: n.text, depth: depth,
        w: m.w, h: m.h, lines: m.lines, fontSize: m.fontSize,
        meta: m.meta, metaH: m.metaH, metaFontSize: m.metaFontSize,
        color: n.color || "", collapsed: !!n.collapsed,
        hasChildren: !!(n.children && n.children.length),
        childCount: (n.children || []).length,
        prio: n.prio | 0, progress: typeof n.progress === "number" ? n.progress : -1,
        tags: (n.tags || []).slice(), note: n.note || "", mark: n.mark || "", link: n.link || "",
        parentId: parentId || null, x: 0, y: 0, cx: 0, cy: 0
      };
      nodes.push(rec);
      rec._node = n;
      visibleChildren(n).forEach((c) => measureTree(c, depth + 1, n.id));
    })(root, 0, null);

    const colX = [];
    let acc = 0;
    levelMaxW.forEach((mw, d) => { colX[d] = acc; acc += mw + (d === 0 ? o.rootGapX : o.gapX); });

    const byId = {};
    nodes.forEach((n) => { byId[n.id] = n; });

    (function place(n, depth) {
      const rec = byId[n.id];
      rec.x = colX[depth] || 0;
      const kids = visibleChildren(n);
      if (!kids.length) {
        rec.y = cursorY;
        cursorY += rec.h + o.gapY;
        rec.cy = rec.y + rec.h / 2;
        return rec;
      }
      kids.forEach((c) => place(c, depth + 1));
      const first = byId[kids[0].id], last = byId[kids[kids.length - 1].id];
      const top = first.y, bottom = last.y + last.h;
      rec.y = Math.round((top + bottom) / 2 - rec.h / 2);
      rec.cy = rec.y + rec.h / 2;
      return rec;
    })(root, 0);

    nodes.forEach((n) => {
      if (!n.parentId) return;
      const p = byId[n.parentId];
      if (!p) return;
      edges.push({
        id: p.id + ">" + n.id,
        x1: p.x + p.w, y1: p.cy,
        x2: n.x, y2: n.cy,
        color: n.color || p.color || "",
        depth: n.depth
      });
    });
    return { nodes: nodes, edges: edges, colX: colX };
  }

  /* 向下布局（组织架构图）：子节点横向排列，父节点居中于子之上 */
  function buildDown(root, o) {
    const nodes = [], edges = [];
    const levelMaxH = [];
    let cursorX = 0;

    (function measureTree(n, depth, parentId) {
      const m = measure(n, depth, o);
      levelMaxH[depth] = Math.max(levelMaxH[depth] || 0, m.h);
      const rec = {
        id: n.id, text: n.text, depth: depth,
        w: m.w, h: m.h, lines: m.lines, fontSize: m.fontSize,
        meta: m.meta, metaH: m.metaH, metaFontSize: m.metaFontSize,
        color: n.color || "", collapsed: !!n.collapsed,
        hasChildren: !!(n.children && n.children.length),
        childCount: (n.children || []).length,
        prio: n.prio | 0, progress: typeof n.progress === "number" ? n.progress : -1,
        tags: (n.tags || []).slice(), note: n.note || "", mark: n.mark || "", link: n.link || "",
        parentId: parentId || null, x: 0, y: 0, cx: 0, cy: 0
      };
      nodes.push(rec);
      visibleChildren(n).forEach((c) => measureTree(c, depth + 1, n.id));
    })(root, 0, null);

    const rowY = [];
    let acc = 0;
    levelMaxH.forEach((mh, d) => { rowY[d] = acc; acc += mh + (d === 0 ? o.rootGapX : o.gapX + 12); });

    const byId = {};
    nodes.forEach((n) => { byId[n.id] = n; });

    (function place(n, depth) {
      const rec = byId[n.id];
      rec.y = rowY[depth] || 0;
      const kids = visibleChildren(n);
      if (!kids.length) {
        rec.x = cursorX;
        cursorX += rec.w + o.gapY + 6;
        rec.cx = rec.x + rec.w / 2;
        return rec;
      }
      kids.forEach((c) => place(c, depth + 1));
      const first = byId[kids[0].id], last = byId[kids[kids.length - 1].id];
      rec.x = Math.round((first.x + last.x + last.w) / 2 - rec.w / 2);
      rec.cx = rec.x + rec.w / 2;
      return rec;
    })(root, 0);

    nodes.forEach((n) => {
      if (!n.parentId) return;
      const p = byId[n.parentId];
      if (!p) return;
      edges.push({
        id: p.id + ">" + n.id,
        x1: p.cx, y1: p.y + p.h,
        x2: n.cx, y2: n.y,
        color: n.color || p.color || "",
        depth: n.depth
      });
    });
    return { nodes: nodes, edges: edges };
  }

  /* 对外布局：dir = both | right | down
   * both：根的子节点分成左右两半，右半照常、左半镜像，整体垂直居中。
   * ---------------------------------------------------------------- */
  function layout(root, opt) {
    const o = Object.assign({}, DEF, opt || {});
    const dir = o.dir || "right";
    if (!root) return { nodes: [], edges: [], relations: [], width: 0, height: 0, dir: dir };

    if (dir === "down") {
      const r = buildDown(root, o);
      let maxR = 0, maxB = 0;
      r.nodes.forEach((n) => { maxR = Math.max(maxR, n.x + n.w); maxB = Math.max(maxB, n.y + n.h); });
      r.nodes.forEach((n) => { delete n._node; });
      return { nodes: r.nodes, edges: r.edges, relations: [], width: maxR, height: maxB, dir: dir };
    }

    const base = buildRight(root, o);
    if (dir !== "both" || !root.children || root.children.length < 2) {
      let maxR = 0, maxB = 0;
      base.nodes.forEach((n) => { maxR = Math.max(maxR, n.x + n.w); maxB = Math.max(maxB, n.y + n.h); });
      base.nodes.forEach((n) => { delete n._node; });
      return { nodes: base.nodes, edges: base.edges, relations: [], width: maxR, height: maxB, dir: "right" };
    }

    /* 分左右两组：前半在右，后半在左（左组按原顺序，镜像后视觉顺序仍自然） */
    const kids = visibleChildren(root);
    const half = Math.ceil(kids.length / 2);
    const rightIds = {}, leftIds = {};
    (function mark(list, bag) {
      list.forEach((k) => walk(k, (n) => { bag[n.id] = 1; }));
    })(kids.slice(0, half), rightIds);
    (function mark(list, bag) {
      list.forEach((k) => walk(k, (n) => { bag[n.id] = 1; }));
    })(kids.slice(half), leftIds);

    const rootRec = base.nodes.filter((n) => !n.parentId)[0];
    const d1 = base.nodes.filter((n) => n.depth === 1)[0];
    const x1 = d1 ? d1.x : (rootRec.x + rootRec.w + o.rootGapX);

    const out = [];
    let minY = Infinity, maxY = -Infinity;
    base.nodes.forEach((n) => {
      const c = JSON.parse(JSON.stringify(n));
      if (leftIds[n.id]) {
        /* 镜像：所有节点从左往右反向排列，深度 1 的右边缘贴住根左侧 */
        c.x = -c.x - c.w - o.gapX + x1;
      }
      out.push(c);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y + c.h);
    });

    /* 垂直居中：根的纵向中心落在整幅内容中心 */
    const mid = (minY + maxY) / 2;
    out.forEach((n) => {
      n.y = Math.round(n.y - mid + (rootRec.h / 2));
      n.y = Math.max(0, n.y);
      n.cy = n.y + n.h / 2;
      n.cx = n.x + n.w / 2;
    });
    const byId2 = {};
    out.forEach((n) => { byId2[n.id] = n; });

    const edges = [];
    out.forEach((n) => {
      if (!n.parentId) return;
      const p = byId2[n.parentId];
      if (!p) return;
      const isLeft = !!leftIds[n.id];
      edges.push({
        id: p.id + ">" + n.id,
        x1: isLeft ? p.x : p.x + p.w,
        y1: p.cy,
        x2: isLeft ? n.x + n.w : n.x,
        y2: n.cy,
        color: n.color || p.color || "",
        depth: n.depth,
        side: isLeft ? "l" : "r"
      });
    });

    let minX = 0, maxR = 0, maxB = 0;
    out.forEach((n) => { minX = Math.min(minX, n.x); maxR = Math.max(maxR, n.x + n.w); maxB = Math.max(maxB, n.y + n.h); });
    out.forEach((n) => { delete n._node; });
    return { nodes: out, edges: edges, relations: [], width: maxR - minX, height: maxB, minX: minX, dir: "both" };
  }

  /* 联系线（跨分支关联）：按 id 取两端节点中心，画虚线 */
  function relationPaths(lay, relations) {
    const pos = {};
    lay.nodes.forEach((n) => { pos[n.id] = n; });
    return (relations || []).map((r) => {
      const a = pos[r.from], b = pos[r.to];
      if (!a || !b) return null;
      return {
        id: r.id, label: r.label || "",
        x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy
      };
    }).filter(Boolean);
  }

  /* ---------------- 树操作（纯函数） ---------------- */
  function walk(node, fn, parent) {
    if (!node) return;
    if (fn(node, parent) === false) return;   // 返回 false 可中止
    (node.children || []).forEach((c) => walk(c, fn, node));
  }
  function findNode(root, id) {
    let hit = null;
    walk(root, (n) => { if (n.id === id) { hit = n; return false; } if (hit) return false; });
    return hit;
  }
  function findParent(root, id, parent) {
    const p = parent || null;
    if (!root) return null;
    if (root.id === id) return p;
    for (const c of (root.children || [])) {
      const r = findParent(c, id, root);
      if (r !== null && r !== undefined) return r;
    }
    return null;
  }
  function isDescendant(ancestor, id) {
    let yes = false;
    walk(ancestor, (n) => { if (n.id === id) { yes = true; return false; } if (yes) return false; });
    return yes;
  }
  /* 加子节点（可选插在指定兄弟之后） */
  function addChild(root, parentId, text, afterId) {
    const p = findNode(root, parentId) || root;
    const n = newNode(text == null ? "" : text);
    if (afterId) {
      const i = (p.children || []).findIndex((c) => c.id === afterId);
      if (i >= 0) { p.children.splice(i + 1, 0, n); return n; }
    }
    p.children = p.children || [];
    p.children.push(n);
    return n;
  }
  /* 加同级（根节点没有同级 → 退回加子节点） */
  function addSibling(root, id, text) {
    if (id === root.id) return addChild(root, root.id, text);
    const parent = findParent(root, id);
    if (!parent) return addChild(root, root.id, text);
    return addChild(root, parent.id, text, id);
  }
  /* 删除节点（返回被删节点；根节点不可删） */
  function removeNode(root, id) {
    if (!root || root.id === id) return null;
    const parent = findParent(root, id);
    if (!parent) return null;
    const i = (parent.children || []).findIndex((c) => c.id === id);
    if (i < 0) return null;
    const [gone] = parent.children.splice(i, 1);
    return gone;
  }
  /* 移动节点到新父级（插到 afterId 之后；不能移到自身或自己的子孙下） */
  function moveNode(root, id, newParentId, afterId) {
    if (!root || id === root.id) return false;
    const node = findNode(root, id);
    const target = findNode(root, newParentId);
    if (!node || !target) return false;
    if (node.id === target.id) return false;
    if (isDescendant(node, target.id)) return false;   // 不能把父节点塞进自己的子树
    const oldParent = findParent(root, id);
    if (!oldParent) return false;
    const i = oldParent.children.findIndex((c) => c.id === id);
    if (i < 0) return false;
    oldParent.children.splice(i, 1);
    if (afterId) {
      const j = target.children.findIndex((c) => c.id === afterId);
      if (j >= 0) { target.children.splice(j + 1, 0, node); return true; }
    }
    target.children.push(node);
    return true;
  }
  /* 前移 / 后移一位（同级内换序） */
  function moveSibling(root, id, dir) {
    const parent = findParent(root, id);
    if (!parent) return false;
    const arr = parent.children || [];
    const i = arr.findIndex((c) => c.id === id);
    const j = i + (dir > 0 ? 1 : -1);
    if (i < 0 || j < 0 || j >= arr.length) return false;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    return true;
  }
  function countNodes(root) {
    let n = 0;
    walk(root, () => { n++; });
    return n;
  }

  /* ---------------- 导入 / 导出（纯函数） ---------------- */
  function toMarkdown(root, depth) {
    depth = depth || 0;
    if (!root) return "";
    const pad = "  ".repeat(depth);
    const line = pad + "- " + String(root.text == null ? "" : root.text).replace(/\n/g, " ");
    const note = root.note ? "  \n" + pad + "  > " + String(root.note).replace(/\n/g, " ") : "";
    const kids = (root.children || []).map((c) => toMarkdown(c, depth + 1)).join("\n");
    return line + note + (kids ? "\n" + kids : "");
  }

  /* 从缩进大纲文本建树：支持 "- " / "* " / "1. " / "• " / Tab 缩进 */
  function fromMarkdown(text) {
    const lines = String(text || "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
    if (!lines.length) { const r0 = newNode("中心主题"); r0.children.push(newNode("子主题")); return r0; }
    // 第一个顶层条目直接作为根，这样 toMarkdown → fromMarkdown 往返不会多出一层
    let root = null;
    const stack = [];
    lines.forEach((raw) => {
      const indent = (raw.match(/^[\t ]*/) || [""])[0].replace(/\t/g, "  ").length;
      const body = raw.trim().replace(/^([-*•]|\d+[.)])\s*/, "");
      const n = newNode(body);
      if (!root) { root = n; stack.push({ node: n, indent: indent }); return; }
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      // 与根同级（缩进相同）时挂到根下，避免出现第二个根
      if (indent <= stack[0].indent) stack.length = 1;
      const parent = stack[stack.length - 1].node;
      parent.children.push(n);
      stack.push({ node: n, indent: indent });
    });
    return root;
  }

  /* XMind（Zen / 2020+）content.json 结构 */
  function toXmindContent(root, sheetTitle) {
    function topic(n) {
      const t = { id: String(n.id || uid("t")), "class": "topic", title: String(n.text == null ? "" : n.text) };
      if (n.note) t.notes = { plain: { content: String(n.note) } };
      if (n.collapsed) t.folded = true;
      const kids = (n.children || []).map(topic);
      if (kids.length) t.children = { attached: kids };
      return t;
    }
    const rootTopic = topic(root || newNode("中心主题"));
    rootTopic.structureClass = "org.xmind.ui.logic.right";
    return [{
      id: uid("sheet"),
      "class": "sheet",
      title: String(sheetTitle || "Sheet 1"),
      rootTopic: rootTopic,
      topicPositioning: "fixed"
    }];
  }

  /* OPML：通用大纲格式，幕布 / XMind / 各类大纲工具都能导入 */
  function xmlEsc(t) {
    return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function toOpml(root, title) {
    const t = title || "思维导图";
    function node(n) {
      const kids = (n.children || []).map(node).join("");
      return '<outline text="' + xmlEsc(n.text) + '"' + (n.note ? ' _note="' + xmlEsc(n.note) + '"' : "") + '>' + kids + "</outline>";
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<opml version="2.0"><head><title>' + xmlEsc(t) + '</title></head><body>' +
      node(root || newNode("中心主题")) + '</body></opml>';
  }
  function fromOpml(text) {
    const doc = parseXml(text);
    const first = doc.querySelector("outline");
    if (!first) return fromMarkdown("");
    function rec(o) {
      const n = newNode(o.getAttribute("text") || "");
      n.note = o.getAttribute("_note") || "";
      Array.prototype.forEach.call(o.children, (c) => { if (c.tagName && c.tagName.toLowerCase() === "outline") n.children.push(rec(c)); });
      return n;
    }
    return rec(first);
  }
  /* FreeMind：.mm 文件 */
  function fromFreeMind(text) {
    const doc = parseXml(text);
    const rootNode = doc.querySelector("map > node") || doc.querySelector("node");
    if (!rootNode) return fromMarkdown("");
    function rec(o) {
      const n = newNode(o.getAttribute("TEXT") || o.getAttribute("text") || "");
      n.note = o.getAttribute("NOTE") || "";
      Array.prototype.forEach.call(o.children, (c) => {
        if (c.tagName && c.tagName.toLowerCase() === "node") n.children.push(rec(c));
      });
      return n;
    }
    return rec(rootNode);
  }
  function parseXml(text) {
    if (typeof DOMParser === "undefined") throw new Error("no DOMParser");
    const doc = new DOMParser().parseFromString(String(text), "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("bad xml");
    return doc;
  }

  /* 独立 HTML：一份可直接双击打开、节点可折叠的浏览版 */
  function toStandaloneHtml(root, title, dark) {
    function rec(n) {
      const kids = (n.children || []).map(rec).join("");
      const note = n.note ? '<div class="note">' + xmlEsc(n.note) + "</div>" : "";
      const meta = metaText(n);
      const met = meta ? '<i class="meta">' + xmlEsc(meta) + "</i>" : "";
      return '<li><span class="t">' + xmlEsc(n.text) + "</span>" + met + note +
        (kids ? "<ul>" + kids + "</ul>" : "") + "</li>";
    }
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + xmlEsc(title || "思维导图") + "</title>" +
      '<style>body{margin:0;padding:28px 20px;font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:' +
      (dark ? "#12161d;color:#dfe6ef" : "#fff;color:#1f2733") + '}' +
      'h1{font-size:19px;margin:0 0 18px}ul{list-style:none;padding-left:22px;border-left:1px dashed ' + (dark ? "#39424f" : "#d5dde8") + '}' +
      'body>ul{border:0;padding-left:0}li{position:relative;margin:6px 0}' +
      '.t{display:inline-block;background:' + (dark ? "#1c232d" : "#f2f6fc") + ';border:1px solid ' + (dark ? "#2b3542" : "#d8e2f0") +
      ';border-radius:8px;padding:3px 10px;cursor:pointer}.t:hover{border-color:#3b7ddd}' +
      '.meta{color:#8b93a3;font-size:12px;margin-left:6px;font-style:normal}.note{color:#7a8494;font-size:12.5px;margin:4px 0 0 12px}' +
      'li.collapsed>ul{display:none}li.has>span.t:before{content:"▾ ";color:#8b93a3}' +
      'li.collapsed>span.t:before{content:"▸ "}</style></head><body>' +
      '<h1>' + xmlEsc(title || "思维导图") + "</h1><ul>" + rec(root || newNode("中心主题")) + "</ul>" +
      "<script>document.querySelectorAll('li').forEach(function(li){if(li.querySelector('ul')){li.classList.add('has');" +
      "li.querySelector('.t').onclick=function(){li.classList.toggle('collapsed')}}})<\/script></body></html>";
  }

  /* ---------------- 渲染 + 交互 ---------------- */
  const SVG_NS = "http://www.w3.org/2000/svg";
  const BRANCH_COLORS = ["#3b7ddd", "#e8833a", "#0f9d76", "#9b5fd6", "#e2547a", "#c8971b", "#2aa8c4", "#7a8b3f"];

  function el(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach((k) => n.setAttribute(k, attrs[k]));
    return n;
  }

  function MindMapEditor(host, opts) {
    const o = opts || {};
    const state = {
      root: null,
      selected: null,
      editing: null,
      zoom: 1,
      tx: 0, ty: 0,
      search: "",
      hits: [], hitIdx: -1,
      dark: !!o.dark,
      undo: [], redo: [],
      drag: null,
      panning: null,
      dir: (o.dir || "both"),
      theme: (o.theme || "default"),
      focusId: null,
      relations: [],       /* 联系线：[{id, from, to, label}] */
      present: null,       /* 演示模式：{order:[id...], idx:number} */
      lastClick: null,     /* 双击判定（不依赖 dblclick，元素重绘也能触发） */
      viewH: 0
    };

    /* ---- DOM ---- */
    host.classList.add("mm-host");
    host.innerHTML =
      '<div class="mm-top">' +
        '<div class="mm-top-left">' +
          '<button class="mm-btn" data-a="add-child" title="加子主题（Tab）">＋ 子主题</button>' +
          '<button class="mm-btn" data-a="add-sib" title="加同级主题（Enter）">＋ 同级</button>' +
          '<button class="mm-btn" data-a="del" title="删除（Delete）">删除</button>' +
          '<button class="mm-btn" data-a="fold" title="折叠 / 展开（空格）">折叠</button>' +
          '<span class="mm-sep"></span>' +
          '<button class="mm-btn" data-a="undo" title="撤销（Ctrl+Z）">↶</button>' +
          '<button class="mm-btn" data-a="redo" title="重做（Ctrl+Shift+Z）">↷</button>' +
          '<span class="mm-sep"></span>' +
          '<button class="mm-btn" data-a="props" title="备注 / 标签 / 优先级 / 进度">属性</button>' +
          '<button class="mm-btn" data-a="rel" title="在两个节点之间加关联">联系线</button>' +
          '<button class="mm-btn" data-a="num" title="按层级自动编号">编号</button>' +
          '<button class="mm-btn" data-a="focus" title="只看当前分支">聚焦</button>' +
          '<button class="mm-btn" data-a="outline" title="大纲视图（可编辑）">大纲</button>' +
          '<button class="mm-btn" data-a="present" title="演示模式（方向键翻页）">演示</button>' +
        '</div>' +
        '<div class="mm-top-right">' +
          '<input class="mm-search" type="search" placeholder="搜索节点（Enter 下一个）">' +
          '<button class="mm-btn" data-a="zoom-out" title="缩小">－</button>' +
          '<span class="mm-zoom">100%</span>' +
          '<button class="mm-btn" data-a="zoom-in" title="放大">＋</button>' +
          '<button class="mm-btn" data-a="fit" title="适应屏幕">适应</button>' +
          '<select class="mm-select" data-a="struct" title="结构类型">' +
            STRUCTURES.map((x) => '<option value="' + x.key + '">' + x.name + '</option>').join("") +
          '</select>' +
          '<select class="mm-select" data-a="palette" title="主题配色">' +
            THEMES.map((x) => '<option value="' + x.key + '">' + x.name + '</option>').join("") +
          '</select>' +
          '<button class="mm-btn" data-a="theme" title="深色 / 浅色">◐</button>' +
          '<button class="mm-btn" data-a="export" title="导出">导出 ▾</button>' +
        '</div>' +
      '</div>' +
      '<div class="mm-canvas-wrap">' +
        '<div class="mm-canvas-scroll"><svg class="mm-svg" tabindex="0"></svg></div>' +
        '<div class="mm-outline hidden">' +
          '<div class="mm-outline-head"><b>大纲</b><span class="mm-outline-tip">缩进即层级，改完自动同步</span>' +
          '<button class="mm-btn" data-a="outline-close" type="button">收起</button></div>' +
          '<textarea class="mm-outline-box" spellcheck="false"></textarea>' +
        '</div>' +
        '<div class="mm-hint">双击改名 · Tab 加子级 · Enter 加同级 · Delete 删除 · 空格折叠 · 拖动节点可换父级 · Ctrl+滚轮缩放</div>' +
        '<div class="mm-menu hidden">' +
          '<button data-x="svg">导出 SVG（矢量）</button>' +
          '<button data-x="png">导出 PNG（2 倍图）</button>' +
          '<button data-x="md">导出 Markdown 大纲</button>' +
          '<button data-x="xmind">导出 XMind（.xmind）</button>' +
          '<button data-x="opml">导出 OPML（通用大纲）</button>' +
          '<button data-x="html">导出 HTML（可折叠浏览）</button>' +
          '<button data-x="import">导入大纲（Markdown / OPML / FreeMind）</button>' +
        '</div>' +
      '</div>';

    const svg = host.querySelector(".mm-svg");
    const wrap = host.querySelector(".mm-canvas-wrap");
    const zoomOut = host.querySelector(".mm-zoom");
    const menu = host.querySelector(".mm-menu");
    let viewport = null;

    /* ---- 变更通知（自动保存） ---- */
    function changed(structural) {
      if (structural) {
        state.undo.push(JSON.stringify(snapRoot()));
        if (state.undo.length > 60) state.undo.shift();
        state.redo.length = 0;
      }
      render();
      if (typeof o.onChange === "function") o.onChange(snapRoot());
    }
    function snapRoot() { return state.root; }

    /* ---- 渲染 ---- */
    function curRoot() { return (state.focusId && findNode(state.root, state.focusId)) || state.root; }
    function curLayout() {
      return layout(curRoot(), { dir: state.dir || "both" });
    }
    function theme() { return themeOf(state.theme); }

    /* 容器高度随内容自动扩展：内容多就长高，不再被固定 640px 挤成一小块 */
    function autoSize(lay) {
      const pad = 60;
      const top = host.querySelector(".mm-top");
      const topH = top ? (top.offsetHeight || 46) : 46;
      const need = lay.height + pad * 2 + topH + 28;
      const vh = (typeof window !== "undefined" && window.innerHeight) || 900;
      const maxH = Math.max(560, Math.min(1500, vh - 110));
      const h = Math.max(560, Math.min(maxH, Math.ceil(need)));
      host.style.height = h + "px";
      state.viewH = h;
    }

    function render() {
      const lay = curLayout();
      const th = theme();
      const colors = th.colors;
      const pad = 60;
      const W = Math.max(760, lay.width + pad * 2);
      const H = Math.max(420, lay.height + pad * 2);
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.innerHTML = "";
      svg.classList.toggle("is-dark", !!state.dark);
      if (!state.dark) svg.style.background = th.bg;

      const bg = el("rect", { x: 0, y: 0, width: "100%", height: "100%", "class": "mm-bg" });
      if (!state.dark) bg.style.fill = th.bg;
      svg.appendChild(bg);

      viewport = el("g", { transform: "translate(" + state.tx + "," + state.ty + ") scale(" + state.zoom + ")" });
      svg.appendChild(viewport);

      const content = el("g", { transform: "translate(" + pad + "," + pad + ")" });
      viewport.appendChild(content);

      const hitSet = {};
      (state.hits || []).forEach((id) => { hitSet[id] = 1; });

      /* 连线（both 结构左右两侧都用平滑曲线，down 用折线） */
      lay.edges.forEach((e) => {
        const child = lay.nodes.filter((n) => n.id === e.id.split(">")[1])[0];
        const depthColor = e.color || colors[(child ? child.depth - 1 : 0) % colors.length];
        let d;
        if (lay.dir === "down") {
          const my = (e.y1 + e.y2) / 2;
          d = "M" + e.x1 + "," + e.y1 + " L" + e.x1 + "," + my + " L" + e.x2 + "," + my + " L" + e.x2 + "," + e.y2;
        } else {
          const dx = Math.max(24, Math.abs(e.x2 - e.x1) * 0.5) * (e.x2 < e.x1 ? -1 : 1);
          d = "M" + e.x1 + "," + e.y1 + " C" + (e.x1 + dx) + "," + e.y1 + " " + (e.x2 - dx) + "," + e.y2 + " " + e.x2 + "," + e.y2;
        }
        content.appendChild(el("path", {
          d: d, fill: "none", stroke: depthColor, "stroke-width": e.depth <= 1 ? 2.4 : 1.6,
          "stroke-linecap": "round", "opacity": ".85"
        }));
      });

      /* 节点 */
      lay.nodes.forEach((n) => {
        const isRoot = n.depth === 0;
        const node = findNode(state.root, n.id) || {};
        const branch = node.color || (isRoot ? "" : colors[(n.depth - 1) % colors.length]);
        const g = el("g", { "class": "mm-node", "data-id": n.id, transform: "translate(" + n.x + "," + n.y + ")" });

        const rect = el("rect", {
          x: 0, y: 0, width: n.w, height: n.h, rx: isRoot ? 10 : 8, ry: isRoot ? 10 : 8,
          "class": "mm-node-rect" + (isRoot ? " mm-root" : "") + (state.selected === n.id ? " is-sel" : "") + (hitSet[n.id] ? " is-hit" : ""),
          stroke: branch || (state.dark ? "#3a4757" : "#cfd8e6"),
          "stroke-width": isRoot ? 2 : 1.4,
          "data-sel": n.id
        });
        if (branch) rect.style.fill = hexA(branch, isRoot ? 0.16 : 0.10);
        g.appendChild(rect);

        const textH = n.lines.length * 20;
        const blockH = textH + (n.metaH || 0);
        const top0 = (n.h - blockH) / 2;
        n.lines.forEach((line, i) => {
          const t = el("text", {
            x: n.w / 2, y: top0 + 20 * i + 15,
            "text-anchor": "middle", "font-size": n.fontSize,
            "class": "mm-node-text" + (isRoot ? " mm-root-text" : "")
          });
          t.textContent = line;
          g.appendChild(t);
        });

        /* 副信息一行：★优先级 · 进度 · #标签 */
        if (n.meta) {
          const mt = el("text", {
            x: n.w / 2, y: top0 + textH + 12, "text-anchor": "middle",
            "font-size": n.metaFontSize || 11, "class": "mm-node-meta",
            fill: branch ? hexA(branch, 0.95) : "#8b93a3"
          });
          mt.textContent = n.meta;
          g.appendChild(mt);
          if (typeof n.progress === "number" && n.progress >= 0) {
            const bw = Math.max(20, n.w - 24), bh = 3;
            const bx = 12, by = n.h - 6;
            g.appendChild(el("rect", { x: bx, y: by, width: bw, height: bh, rx: 1.5, fill: hexA(branch || "#3b7ddd", 0.22) }));
            g.appendChild(el("rect", { x: bx, y: by, width: Math.max(1, bw * n.progress / 100), height: bh, rx: 1.5, fill: branch || "#3b7ddd" }));
          }
        }

        /* 折叠按钮：有子节点时显示 */
        if (n.hasChildren) {
          const by = n.h / 2;
          const fg = el("g", { "class": "mm-fold", "data-fold": n.id, transform: "translate(" + (n.w + 11) + "," + by + ")" });
          fg.appendChild(el("circle", { r: 9, fill: state.dark ? "#1b222c" : "#fff", stroke: branch || "#9aa8bd", "stroke-width": 1.4 }));
          const sign = el("text", { x: 0, y: 4, "text-anchor": "middle", "font-size": 11, fill: branch || "#6b7a90" });
          sign.textContent = n.collapsed ? String(n.childCount) : "−";
          fg.appendChild(sign);
          g.appendChild(fg);
        }

        /* 备注 / 链接 / 标记 */
        if (n.note) {
          const ng = el("g", { transform: "translate(-6,6)" });
          ng.appendChild(el("circle", { r: 6, fill: "#8b93a3" }));
          const nt = el("text", { x: 0, y: 3.5, "text-anchor": "middle", "font-size": 9, fill: "#fff" });
          nt.textContent = "i";
          ng.appendChild(nt);
          g.appendChild(ng);
        }
        if (n.link) {
          const lg = el("g", { transform: "translate(" + (n.w + 6) + "," + (n.h - 4) + ")" });
          const lt = el("text", { x: 0, y: 0, "font-size": 10, fill: "#3b7ddd", "class": "mm-link-mark" });
          lt.textContent = "↗";
          lg.appendChild(lt);
          g.appendChild(lg);
        }
        if (n.mark) {
          const mk = el("text", { x: 6, y: 14, "font-size": 12 });
          mk.textContent = n.mark;
          g.appendChild(mk);
        }

        content.appendChild(g);
      });

      /* 联系线（跨分支关联，虚线，画在节点之上但很淡） */
      const rels = relationPaths(lay, state.relations || []);
      rels.forEach((r) => {
        const mx = (r.x1 + r.x2) / 2;
        const d = "M" + r.x1 + "," + r.y1 + " C" + mx + "," + r.y1 + " " + mx + "," + r.y2 + " " + r.x2 + "," + r.y2;
        content.appendChild(el("path", {
          d: d, fill: "none", stroke: "#b26bd6", "stroke-width": 1.5, "stroke-dasharray": "5 4", opacity: ".9",
          "class": "mm-rel"
        }));
        if (r.label) {
          const t = el("text", { x: mx, y: (r.y1 + r.y2) / 2 - 4, "text-anchor": "middle", "font-size": 10, fill: "#8c4bb0" });
          t.textContent = r.label;
          content.appendChild(t);
        }
      });

      zoomOut.textContent = Math.round(state.zoom * 100) + "%";
      svg.dataset.contentW = String(lay.width + pad * 2);
      svg.dataset.contentH = String(lay.height + pad * 2);
      svg.dataset.w = String(lay.width);
      svg.dataset.h = String(lay.height);
      autoSize(lay);
      const selS = host.querySelector('[data-a="struct"]');
      if (selS && selS.value !== (state.dir || "both")) selS.value = (state.dir || "both");
      const selP = host.querySelector('[data-a="palette"]');
      if (selP && selP.value !== (state.theme || "default")) selP.value = (state.theme || "default");
    }

    function hexA(hex, a) {
      const h = String(hex).replace("#", "");
      const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
      const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
      return "rgba(" + r + "," + g + "," + b + "," + a + ")";
    }

    /* 只切换选中描边，不重建 DOM —— 重建会让双击凑不齐两次点击，导致"文字没法编辑" */
    function paintSelection() {
      const nodes = svg.querySelectorAll(".mm-node-rect");
      Array.prototype.forEach.call(nodes, (r) => {
        const id = r.getAttribute("data-sel");
        if (id && id === state.selected) r.classList.add("is-sel");
        else r.classList.remove("is-sel");
      });
    }

    /* ---- 视图操作 ---- */
    function applyView() {
      if (viewport) viewport.setAttribute("transform", "translate(" + state.tx + "," + state.ty + ") scale(" + state.zoom + ")");
      zoomOut.textContent = Math.round(state.zoom * 100) + "%";
    }
    function zoomAt(k, cx, cy) {
      const nz = Math.min(2.5, Math.max(0.25, state.zoom * k));
      const r = wrap.getBoundingClientRect();
      const px = (cx == null ? r.width / 2 : cx), py = (cy == null ? r.height / 2 : cy);
      state.tx = px - (px - state.tx) * (nz / state.zoom);
      state.ty = py - (py - state.ty) * (nz / state.zoom);
      state.zoom = nz;
      applyView();
    }
    function fit() {
      const r = wrap.getBoundingClientRect();
      const cw = Number(svg.dataset.contentW || 800), chh = Number(svg.dataset.contentH || 600);
      const k = Math.min((r.width - 24) / cw, (r.height - 24) / chh, 1.15);
      state.zoom = Math.max(0.25, k);
      state.tx = (r.width - cw * state.zoom) / 2;
      state.ty = (r.height - chh * state.zoom) / 2;
      applyView();
    }
    function focusNode(id) {
      const node = (curLayout().nodes || []).filter((n) => n.id === id)[0];
      if (!node) return;
      const r = wrap.getBoundingClientRect();
      const pad = 60;
      state.tx = r.width / 2 - (node.x + pad + node.w / 2) * state.zoom;
      state.ty = r.height / 2 - (node.y + pad + node.h / 2) * state.zoom;
      applyView();
    }
    /* 新节点只在超出可视区时才平移，避免每次加节点都"跳一下" */
    function ensureVisible(id) {
      const lay = curLayout();
      const n = lay.nodes.filter((x) => x.id === id)[0];
      if (!n) return;
      const r = wrap.getBoundingClientRect();
      const pad = 60;
      const vx = state.tx + (n.x + pad) * state.zoom;
      const vy = state.ty + (n.y + pad) * state.zoom;
      const vw = n.w * state.zoom, vh = n.h * state.zoom;
      let dx = 0, dy = 0;
      if (vx < 16) dx = 16 - vx;
      else if (vx + vw > r.width - 16) dx = r.width - 16 - (vx + vw);
      if (vy < 12) dy = 12 - vy;
      else if (vy + vh > r.height - 34) dy = r.height - 34 - (vy + vh);
      if (dx || dy) { state.tx += dx; state.ty += dy; applyView(); }
    }

    /* ---- 编辑（就地输入，支持多行） ---- */
    function beginEdit(id) {
      const node = findNode(state.root, id);
      if (!node) return;
      const lay = curLayout();
      const rec = lay.nodes.filter((n) => n.id === id)[0];
      if (!rec) return;
      const pad = 60;
      const box = document.createElement("div");
      box.className = "mm-edit";
      const w = Math.max(160, (rec.w + 40) * state.zoom);
      box.style.width = w + "px";
      box.style.left = Math.max(4, state.tx + (rec.x + pad) * state.zoom) + "px";
      box.style.top = Math.max(4, state.ty + (rec.y + pad) * state.zoom) + "px";

      const inp = document.createElement("textarea");
      inp.value = node.text || "";
      inp.rows = Math.max(2, rec.lines.length + 1);
      inp.style.width = "100%";
      box.appendChild(inp);
      const tip = document.createElement("div");
      tip.className = "mm-edit-tip";
      tip.textContent = "Enter 保存 · Shift+Enter 换行 · Esc 取消";
      box.appendChild(tip);
      wrap.appendChild(box);
      state.editing = id;

      /* 输入时自动增高，长文本不被切掉 */
      function autogrow() {
        inp.style.height = "auto";
        inp.style.height = Math.min(220, Math.max(44, inp.scrollHeight + 4)) + "px";
      }
      inp.addEventListener("input", autogrow);
      autogrow();

      setTimeout(() => {
        inp.focus();
        try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {}
      }, 0);

      let done = false;
      function commit(save) {
        if (done) return;
        done = true;
        const v = save ? inp.value.replace(/\s+$/, "") : (node.text || "");
        state.editing = null;
        box.remove();
        if (save && v !== (node.text || "")) { node.text = v; changed(true); }
        else render();
      }
      inp.addEventListener("blur", () => commit(true));
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); commit(false); }
        else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(true); }
      });
    }

    /* ---- 选中 ---- */
    function select(id) { state.selected = id; paintSelection(); }
    function selectedNode() { return state.selected ? findNode(state.root, state.selected) : null; }

    /* ---- 增删改（带撤销） ---- */
    function doAddChild() {
      const cur = selectedNode() || state.root;
      if (cur.collapsed) cur.collapsed = false;
      const n = addChild(state.root, cur.id, "新主题");
      state.selected = n.id;
      changed(true);
      ensureVisible(n.id);
      beginEdit(n.id);
    }
    function doAddSibling() {
      const cur = selectedNode();
      if (!cur) return doAddChild();
      const n = addSibling(state.root, cur.id, "新主题");
      state.selected = n.id;
      changed(true);
      ensureVisible(n.id);
      beginEdit(n.id);
    }
    function doDelete() {
      const cur = selectedNode();
      if (!cur) return;
      if (cur.id === state.root.id) { if (o.toast) o.toast("中心主题不能删除", false); return; }
      const go = () => {
        const parent = findParent(state.root, cur.id);
        removeNode(state.root, cur.id);
        state.selected = parent ? parent.id : state.root.id;
        changed(true);
      };
      if ((cur.children || []).length && o.confirm) o.confirm("这个主题下还有 " + cur.children.length + " 个子主题，一并删除？", go);
      else go();
    }
    function doFold() {
      const cur = selectedNode();
      if (!cur || !(cur.children || []).length) return;
      cur.collapsed = !cur.collapsed;
      changed(true);
    }
    function undo() {
      if (!state.undo.length) return;
      state.redo.push(JSON.stringify(state.root));
      state.root = JSON.parse(state.undo.pop());
      render();
      if (o.onChange) o.onChange(state.root);
    }
    function redo() {
      if (!state.redo.length) return;
      state.undo.push(JSON.stringify(state.root));
      state.root = JSON.parse(state.redo.pop());
      render();
      if (o.onChange) o.onChange(state.root);
    }

    /* ---- 事件：节点点击 / 双击 / 折叠 / 拖拽 ---- */
    svg.addEventListener("mousedown", (e) => {
      const foldEl = e.target.closest ? e.target.closest(".mm-fold") : null;
      if (foldEl) {
        const id = foldEl.getAttribute("data-fold");
        const n = findNode(state.root, id);
        if (n) { n.collapsed = !n.collapsed; state.selected = id; changed(true); }
        e.preventDefault();
        return;
      }
      if (svg.focus) { try { svg.focus({ preventScroll: true }); } catch (err) { svg.focus(); } }
      const g = e.target.closest ? e.target.closest(".mm-node") : null;
      if (g) {
        const id = g.getAttribute("data-id");
        /* 注意：这里绝不能整块 render()。重绘会把元素换掉，
           浏览器就再也凑不齐两次点击，双击永远不触发 → 表现成"文字改不了"。 */
        if (state.relFrom) {
          if (state.relFrom === id) { state.relFrom = null; if (o.toast) o.toast("已取消联系线"); return; }
          addRelation(state.relFrom, id);
          state.relFrom = null;
          e.preventDefault();
          return;
        }
        const now = Date.now();
        const dbl = state.lastClick && state.lastClick.id === id && (now - state.lastClick.t) < 420;
        state.lastClick = { id: id, t: now };
        state.selected = id;
        paintSelection();
        if (dbl) {
          state.drag = null;
          beginEdit(id);
          e.preventDefault();
          return;
        }
        state.drag = { id: id, x0: e.clientX, y0: e.clientY, moved: false };
        e.preventDefault();
        return;
      }
      // 空白：平移
      state.panning = { x0: e.clientX, y0: e.clientY, tx: state.tx, ty: state.ty };
    });

    window.addEventListener("mousemove", (e) => {
      if (state.panning) {
        state.tx = state.panning.tx + (e.clientX - state.panning.x0);
        state.ty = state.panning.ty + (e.clientY - state.panning.y0);
        applyView();
        return;
      }
      if (state.drag && !state.editing) {
        const dx = e.clientX - state.drag.x0, dy = e.clientY - state.drag.y0;
        if (!state.drag.moved && Math.abs(dx) + Math.abs(dy) > 5) state.drag.moved = true;
        if (state.drag.moved) {
          const t = document.elementFromPoint(e.clientX, e.clientY);
          const tg = t && t.closest ? t.closest(".mm-node") : null;
          svg.querySelectorAll(".mm-node-rect").forEach((r) => r.classList.remove("is-drop"));
          if (tg) {
            const rect = tg.querySelector(".mm-node-rect");
            if (rect) rect.classList.add("is-drop");
          }
        }
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (state.panning) { state.panning = null; return; }
      const d = state.drag;
      state.drag = null;
      if (!d || !d.moved) return;
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const tg = t && t.closest ? t.closest(".mm-node") : null;
      svg.querySelectorAll(".mm-node-rect").forEach((r) => r.classList.remove("is-drop"));
      if (!tg) return;
      const targetId = tg.getAttribute("data-id");
      if (targetId === d.id) return;
      if (moveNode(state.root, d.id, targetId)) {
        state.selected = d.id;
        changed(true);
      } else if (o.toast) {
        o.toast("不能移动到它自己的子主题里", false);
      }
    });

    svg.addEventListener("dblclick", (e) => {
      const g = e.target.closest ? e.target.closest(".mm-node") : null;
      if (!g) return;
      e.preventDefault();
      state.selected = g.getAttribute("data-id");
      beginEdit(g.getAttribute("data-id"));
    });

    /* 滚轮：普通=上下平移，Ctrl/⌘=缩放 */
    wrap.addEventListener("wheel", (e) => {
      const r = wrap.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - r.left, e.clientY - r.top);
      } else {
        e.preventDefault();
        state.ty -= e.deltaY;
        state.tx -= e.deltaX;
        applyView();
      }
    }, { passive: false });

    /* ---- 键盘 ----
     * 早期把监听挂在 host 上，但 host 是普通 div、不可聚焦，
     * 点击节点后焦点仍在 body，keydown 不会冒泡到 host —— 表现就是"快捷键全都没反应、改不了名"。
     * 改为监听 document，并用「面板是否可见」+「是否正在输入」两道闸门，避免影响后台其它输入框。
     */
    function panelVisible() {
      if (state.editing) return false;
      if (host.offsetParent === null && host.getClientRects().length === 0) return false;
      return true;
    }
    function onKey(e) {
      if (!panelVisible()) return;
      if (state.editing) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") {
        if (e.target.classList.contains("mm-search")) {
          if (e.key === "Enter") { e.preventDefault(); nextHit(); }
        }
        return;
      }
      if (state.present) {
        if (e.key === "Escape") { e.preventDefault(); togglePresent(); return; }
        if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " " || e.key === "PageDown") { e.preventDefault(); stepPresent(1); return; }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); stepPresent(-1); return; }
      }
      if (e.key === "Escape" && state.relFrom) { state.relFrom = null; if (o.toast) o.toast("已取消联系线"); return; }
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (meta && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (e.key === "Tab") { e.preventDefault(); doAddChild(); return; }
      if (e.key === "Enter") { e.preventDefault(); doAddSibling(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); doDelete(); return; }
      if (e.key === "F2") { e.preventDefault(); if (state.selected) beginEdit(state.selected); return; }
      if (e.key === " ") { e.preventDefault(); doFold(); return; }
      // 方向键导航
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const cur = selectedNode(); if (!cur) return;
        const parent = findParent(state.root, cur.id);
        const sibs = parent ? parent.children : [state.root];
        const i = sibs.findIndex((c) => c.id === cur.id);
        const j = i + (e.key === "ArrowDown" ? 1 : -1);
        if (j >= 0 && j < sibs.length) { state.selected = sibs[j].id; paintSelection(); focusNode(state.selected); }
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const cur = selectedNode(); if (!cur) return;
        const parent = findParent(state.root, cur.id);
        if (parent) { state.selected = parent.id; paintSelection(); focusNode(state.selected); }
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const cur = selectedNode(); if (!cur) return;
        if (cur.collapsed) { cur.collapsed = false; changed(true); return; }
        if ((cur.children || []).length) { state.selected = cur.children[0].id; paintSelection(); focusNode(state.selected); }
        return;
      }
    }
    state._onKey = onKey;
    document.addEventListener("keydown", onKey);

    /* ---- 工具栏 ---- */
    host.addEventListener("change", (e) => {
      const t = e.target;
      if (!t || !t.getAttribute) return;
      const a = t.getAttribute("data-a");
      if (a === "struct") { state.dir = t.value; changed(false); fit(); }
      else if (a === "palette") { state.theme = t.value; changed(false); }
    });

    host.addEventListener("click", (e) => {
      const b = e.target.closest ? e.target.closest("[data-a]") : null;
      if (b) {
        const a = b.getAttribute("data-a");
        if (a === "add-child") doAddChild();
        else if (a === "add-sib") doAddSibling();
        else if (a === "del") doDelete();
        else if (a === "fold") doFold();
        else if (a === "undo") undo();
        else if (a === "redo") redo();
        else if (a === "zoom-in") zoomAt(1.2);
        else if (a === "zoom-out") zoomAt(0.83);
        else if (a === "fit") fit();
        else if (a === "theme") { state.dark = !state.dark; render(); }
        else if (a === "props") openProps();
        else if (a === "rel") startRelation();
        else if (a === "num") doNumber();
        else if (a === "focus") toggleFocus();
        else if (a === "outline") toggleOutline();
        else if (a === "outline-close") toggleOutline(false);
        else if (a === "present") togglePresent();
        else if (a === "export") menu.classList.toggle("hidden");
        return;
      }
      const x = e.target.closest ? e.target.closest("[data-x]") : null;
      if (x) {
        menu.classList.add("hidden");
        handleExport(x.getAttribute("data-x"));
      }
    });

    host.querySelector(".mm-search").addEventListener("input", (e) => {
      state.search = e.target.value.trim();
      state.hits = [];
      state.hitIdx = -1;
      if (state.search) {
        const kw = state.search.toLowerCase();
        walk(state.root, (n) => { if (String(n.text || "").toLowerCase().indexOf(kw) >= 0) state.hits.push(n.id); });
        if (state.hits.length) { state.hitIdx = 0; state.selected = state.hits[0]; focusNode(state.hits[0]); }
      }
      render();
    });
    function nextHit() {
      if (!state.hits.length) return;
      state.hitIdx = (state.hitIdx + 1) % state.hits.length;
      state.selected = state.hits[state.hitIdx];
      render();
      focusNode(state.selected);
    }

    /* ---- 导出 ---- */
    function buildCleanSvg() {
      const lay = layout(state.root, {});
      const pad = 40;
      const W = Math.round(lay.width + pad * 2);
      const H = Math.round(lay.height + pad * 2);
      const out = el("svg", {
        xmlns: SVG_NS, width: W, height: H, viewBox: "0 0 " + W + " " + H
      });
      out.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: state.dark ? "#12161d" : "#ffffff" }));
      const content = el("g", { transform: "translate(" + pad + "," + pad + ")" });
      out.appendChild(content);

      lay.edges.forEach((e) => {
        const child = lay.nodes.filter((n) => n.id === e.id.split(">")[1])[0];
        const color = e.color || BRANCH_COLORS[(child ? child.depth - 1 : 0) % BRANCH_COLORS.length];
        const dx = Math.max(24, (e.x2 - e.x1) * 0.5);
        content.appendChild(el("path", {
          d: "M" + e.x1 + "," + e.y1 + " C" + (e.x1 + dx) + "," + e.y1 + " " + (e.x2 - dx) + "," + e.y2 + " " + e.x2 + "," + e.y2,
          fill: "none", stroke: color, "stroke-width": e.depth <= 1 ? 2.4 : 1.6, "stroke-linecap": "round"
        }));
      });

      lay.nodes.forEach((n) => {
        const isRoot = n.depth === 0;
        const node = findNode(state.root, n.id) || {};
        const branch = node.color || (isRoot ? "#3b7ddd" : BRANCH_COLORS[(n.depth - 1) % BRANCH_COLORS.length]);
        const g = el("g", { transform: "translate(" + n.x + "," + n.y + ")" });
        const rect = el("rect", {
          x: 0, y: 0, width: n.w, height: n.h, rx: isRoot ? 10 : 8, ry: isRoot ? 10 : 8,
          fill: hexA(branch, isRoot ? 0.18 : 0.10), stroke: branch, "stroke-width": isRoot ? 2 : 1.4
        });
        g.appendChild(rect);
        n.lines.forEach((line, i) => {
          const t = el("text", {
            x: n.w / 2, y: (n.h - n.lines.length * 20) / 2 + 20 * i + 15,
            "text-anchor": "middle", "font-size": n.fontSize,
            fill: state.dark ? "#e8edf5" : "#1f2733",
            "font-weight": isRoot ? "700" : "500",
            "font-family": "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"
          });
          t.textContent = line;
          g.appendChild(t);
        });
        if (n.hasChildren && n.collapsed) {
          g.appendChild(el("text", { x: n.w + 10, y: n.h / 2 + 4, "font-size": 11, fill: branch })).textContent = "+" + n.childCount;
        }
        content.appendChild(g);
      });
      return { svg: out, width: W, height: H };
    }

    function download(blob, name) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
    }
    function safeName() {
      return String((o.getTitle && o.getTitle()) || "思维导图").replace(/[\\/:*?"<>|]/g, "-");
    }

    /* ---- 属性（备注/标签/优先级/进度/链接） ---- */
    function openProps() {
      const id = state.selected;
      const node = id && findNode(state.root, id);
      if (!node) { if (o.toast) o.toast("先点选一个节点", false); return; }
      const old = wrap.querySelector(".mm-props");
      if (old) old.remove();
      const box = document.createElement("div");
      box.className = "mm-props";
      box.innerHTML =
        '<div class="mm-props-head">节点属性</div>' +
        '<label>标签<input class="p-tags" placeholder="用逗号分隔，如：爆款,夏季"></label>' +
        '<label>优先级<select class="p-prio"><option value="0">不标</option><option value="1">★</option><option value="2">★★</option><option value="3">★★★</option></select></label>' +
        '<label>进度<div class="p-progrow"><input type="range" class="p-prog" min="0" max="100" step="5"><span class="p-progv">—</span></div></label>' +
        '<label>备注<textarea class="p-note" rows="3" placeholder="补充说明，导出 XMind 会带上"></textarea></label>' +
        '<label>链接<input class="p-link" placeholder="https://…"></label>' +
        '<div class="mm-props-foot"><button class="mm-btn" data-p="cancel" type="button">取消</button>' +
        '<button class="mm-btn mm-btn-primary" data-p="ok" type="button">保存</button></div>';
      wrap.appendChild(box);

      const q = (sel) => box.querySelector(sel);
      q(".p-tags").value = (node.tags || []).join(",");
      q(".p-prio").value = String(node.prio | 0);
      const hasProg = typeof node.progress === "number" && node.progress >= 0;
      q(".p-prog").value = hasProg ? node.progress : 0;
      q(".p-progv").textContent = hasProg ? (node.progress + "%") : "—";
      q(".p-note").value = node.note || "";
      q(".p-link").value = node.link || "";
      q(".p-prog").addEventListener("input", () => { q(".p-progv").textContent = q(".p-prog").value + "%"; });

      box.addEventListener("click", (ev) => {
        const b = ev.target.closest ? ev.target.closest("[data-p]") : null;
        if (!b) return;
        if (b.getAttribute("data-p") === "cancel") { box.remove(); return; }
        node.tags = String(q(".p-tags").value || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 8);
        node.prio = Number(q(".p-prio").value) || 0;
        const pv = q(".p-prog").value;
        node.progress = hasProg ? Number(pv) : -1;
        if (!hasProg && Number(pv) > 0) node.progress = Number(pv);
        node.note = String(q(".p-note").value || "");
        node.link = String(q(".p-link").value || "").trim();
        box.remove();
        changed(true);
      });
    }

    /* ---- 联系线 ---- */
    function startRelation() {
      if (!state.selected) { if (o.toast) o.toast("先点选起点节点", false); return; }
      state.relFrom = state.selected;
      if (o.toast) o.toast("再点一个节点，建立联系线（Esc 取消）");
    }
    function addRelation(from, to) {
      state.relations = state.relations || [];
      if (state.relations.some((r) => (r.from === from && r.to === to) || (r.from === to && r.to === from))) {
        if (o.toast) o.toast("这两个节点已经有联系线了", false);
        return;
      }
      state.relations.push({ id: uid("rel"), from: from, to: to, label: "" });
      changed(true);
      if (o.toast) o.toast("已添加联系线");
    }

    /* ---- 自动编号 ---- */
    function doNumber() {
      const root = state.root;
      if (!root) return;
      let n = 0;
      (function rec(node, prefix) {
        (node.children || []).forEach((c, i) => {
          const no = prefix ? prefix + "." + (i + 1) : String(i + 1);
          c.text = String(c.text || "").replace(/^\s*\d+(\.\d+)*[.、\s]+/, "").trim();
          c.text = no + " " + c.text;
          n++;
          rec(c, no);
        });
      })(root, "");
      changed(true);
      if (o.toast) o.toast("已按层级编号 " + n + " 个节点");
    }

    /* ---- 聚焦分支 ---- */
    function toggleFocus() {
      if (state.focusId) { state.focusId = null; changed(false); fit(); if (o.toast) o.toast("已退出聚焦"); return; }
      if (!state.selected || state.selected === state.root.id) { if (o.toast) o.toast("先选中要聚焦的分支节点", false); return; }
      state.focusId = state.selected;
      changed(false);
      fit();
      if (o.toast) o.toast("只看这个分支，再点一次「聚焦」返回全图");
    }

    /* ---- 大纲视图 ---- */
    function toggleOutline(force) {
      const box = wrap.querySelector(".mm-outline");
      if (!box) return;
      const show = force === undefined ? box.classList.contains("hidden") : !!force;
      box.classList.toggle("hidden", !show);
      if (show) {
        const ta = box.querySelector(".mm-outline-box");
        ta.value = outlineText(state.root);
        ta.oninput = () => {
          clearTimeout(state._outTimer);
          state._outTimer = setTimeout(() => {
            const lines = String(ta.value || "").split("\n");
            state.root = fromMarkdown(lines.map((l) => l.replace(/\t/g, "  ")).join("\n"));
            state.focusId = null;
            state.selected = state.root.id;
            changed(true);
            fit();
          }, 700);
        };
      }
    }
    function outlineText(node, depth) {
      depth = depth || 0;
      let out = [];
      (node.children || []).forEach((c) => {
        out.push(new Array(depth + 1).join("  ") + (c.text || ""));
        if ((c.children || []).length) out = out.concat(outlineText(c, depth + 1).split("\n").filter(Boolean));
      });
      return out.join("\n");
    }

    /* ---- 演示模式 ---- */
    function togglePresent() {
      if (state.present) { state.present = null; hidePresent(); render(); return; }
      const order = [];
      (function rec(n) {
        order.push(n.id);
        if (!n.collapsed) (n.children || []).forEach(rec);
      })(state.root);
      state.present = { order: order, idx: 0 };
      showPresent();
      focusNode(state.root.id);
    }
    function stepPresent(d) {
      const p = state.present;
      if (!p) return;
      p.idx = Math.max(0, Math.min(p.order.length - 1, p.idx + d));
      state.selected = p.order[p.idx];
      paintSelection();
      focusNode(state.selected);
      showPresent();
    }
    function showPresent() {
      let bar = wrap.querySelector(".mm-present");
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "mm-present";
        wrap.appendChild(bar);
      }
      const p = state.present;
      bar.innerHTML = '<button class="mm-btn" data-pp="-1" type="button">‹</button>' +
        '<span>' + (p ? (p.idx + 1) + " / " + p.order.length : "") + '</span>' +
        '<button class="mm-btn" data-pp="1" type="button">›</button>' +
        '<button class="mm-btn" data-pp="x" type="button">退出</button>';
      bar.onclick = (e) => {
        const b = e.target.closest ? e.target.closest("[data-pp]") : null;
        if (!b) return;
        const v = b.getAttribute("data-pp");
        if (v === "x") togglePresent(); else stepPresent(Number(v));
      };
    }
    function hidePresent() {
      const bar = wrap.querySelector(".mm-present");
      if (bar) bar.remove();
    }

    function handleExport(kind) {
      if (kind === "svg") {
        const s = buildCleanSvg();
        const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(s.svg);
        download(new Blob([str], { type: "image/svg+xml;charset=utf-8" }), safeName() + ".svg");
        return;
      }
      if (kind === "png") {
        const s = buildCleanSvg();
        const str = new XMLSerializer().serializeToString(s.svg);
        const img = new Image();
        const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(str);
        img.onload = () => {
          const k = 2;
          const cv = document.createElement("canvas");
          cv.width = s.width * k;
          cv.height = s.height * k;
          const ctx = cv.getContext("2d");
          ctx.fillStyle = state.dark ? "#12161d" : "#fff";
          ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          cv.toBlob((b) => download(b, safeName() + ".png"), "image/png");
        };
        img.onerror = () => { if (o.toast) o.toast("导出 PNG 失败，请改用 SVG", false); };
        img.src = url;
        return;
      }
      if (kind === "md") {
        download(new Blob([toMarkdown(state.root)], { type: "text/markdown;charset=utf-8" }), safeName() + ".md");
        return;
      }
      if (kind === "xmind") {
        const JSZipLib = window.JSZip;
        if (!JSZipLib) { if (o.toast) o.toast("缺少打包组件，导出失败", false); return; }
        const zip = new JSZipLib();
        zip.file("content.json", JSON.stringify(toXmindContent(state.root, safeName())));
        zip.file("metadata.json", JSON.stringify({ creator: { name: "Xmind", version: "12.0.0" } }));
        zip.file("manifest.json", JSON.stringify({ "file-entries": { "content.json": {}, "metadata.json": {} } }));
        zip.generateAsync({ type: "blob", mimeType: "application/zip" }).then((b) => download(b, safeName() + ".xmind"));
        return;
      }
      if (kind === "opml") {
        download(new Blob([toOpml(state.root, safeName())], { type: "text/x-opml;charset=utf-8" }), safeName() + ".opml");
        return;
      }
      if (kind === "html") {
        download(new Blob([toStandaloneHtml(state.root, safeName(), state.dark)], { type: "text/html;charset=utf-8" }), safeName() + ".html");
        return;
      }
      if (kind === "import") {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = ".md,.txt,.markdown,.opml,.xml,.mm";
        inp.onchange = () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          const fr = new FileReader();
          fr.onload = () => {
            state.root = fromMarkdown(String(fr.result || ""));
            state.selected = state.root.id;
            changed(true);
            fit();
          };
          const txt = String(fr.result || "");
          try {
            if (/<opml/i.test(txt)) state.root = fromOpml(txt);
            else if (/<map[\s>]/i.test(txt)) state.root = fromFreeMind(txt);
            else state.root = fromMarkdown(txt);
          } catch (err) {
            if (o.toast) o.toast("文件解析失败，请检查格式", false);
            return;
          }
          state.selected = state.root.id;
          state.focusId = null;
          state.relations = [];
          changed(true);
          fit();
        };
        inp.click();
      }
    }

    /* ---- 对外接口 ---- */
    const api = {
      setRoot(root) {
        state.root = root || newNode("中心主题");
        state.selected = state.root.id;
        state.undo.length = 0;
        state.redo.length = 0;
        render();
        fit();
      },
      getRoot() { return state.root; },
      setDark(v) { state.dark = !!v; render(); },
      isDark() { return state.dark; },
      fit: fit,
      render: render,
      addChild: doAddChild,
      addSibling: doAddSibling,
      remove: doDelete,
      undo: undo,
      redo: redo,
      exportAs: handleExport,
      stats() { return { nodes: countNodes(state.root) }; },
      destroy() { document.removeEventListener("keydown", state._onKey); }
    };
    state.root = newNode("中心主题");
    state.selected = state.root.id;
    render();
    return api;
  }

  window.MindMapCore = {
    DEF: DEF,
    uid: uid,
    clone: clone,
    newNode: newNode,
    wrapText: wrapText,
    textWidth: textWidth,
    measure: measure,
    layout: layout,
    walk: walk,
    findNode: findNode,
    findParent: findParent,
    isDescendant: isDescendant,
    addChild: addChild,
    addSibling: addSibling,
    removeNode: removeNode,
    moveNode: moveNode,
    moveSibling: moveSibling,
    countNodes: countNodes,
    toMarkdown: toMarkdown,
    fromMarkdown: fromMarkdown,
    toXmindContent: toXmindContent,
    toOpml: toOpml,
    fromOpml: fromOpml,
    fromFreeMind: fromFreeMind,
    toStandaloneHtml: toStandaloneHtml,
    metaText: metaText
  };
  window.MindMapEditor = MindMapEditor;
})();
