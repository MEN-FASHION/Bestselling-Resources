/* ============================================================
 * mindmap.js —— 思维导图引擎（20261112C）
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
    return Object.assign({ id: uid("n"), text: text == null ? "" : String(text), note: "", color: "", collapsed: false, children: [] }, extra || {});
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

  function measure(node, depth, opt) {
    const o = Object.assign({}, DEF, opt || {});
    const fs = depth === 0 ? o.rootFontSize : o.fontSize;
    const maxW = depth === 0 ? o.maxTextW + 40 : o.maxTextW;
    const lines = wrapText(node.text || "（空）", maxW, fs);
    const tw = Math.min(maxW, Math.max.apply(null, lines.map((l) => textWidth(l, fs)).concat([0])));
    const w = Math.max(o.minNodeW, Math.round(tw + o.padX * 2));
    const needLines = lines.length;
    const h = Math.max(depth === 0 ? 44 : 36, Math.round(needLines * o.lineH + o.padY * 2));
    return { w: w, h: h, lines: lines, fontSize: fs };
  }

  /* 可见子节点（折叠=不可见） */
  function visibleChildren(n) {
    return (!n.collapsed && Array.isArray(n.children)) ? n.children : [];
  }

  /* 右侧水平树布局
   * 返回 { nodes, edges, width, height }，坐标以内容左上角为 (0,0)
   * nodes[i] = { id, text, depth, x, y, w, h, cx, cy, lines, fontSize, color,
   *              hasChildren, collapsed, childCount, parentId }
   */
  function layout(root, opt) {
    const o = Object.assign({}, DEF, opt || {});
    if (!root) return { nodes: [], edges: [], width: 0, height: 0 };

    const nodes = [];
    const edges = [];
    const levelMaxW = [];   // 每层最大宽度（用来算列的 x）
    let cursorY = 0;

    // 先递归算尺寸与层级宽度
    (function measureTree(n, depth, parentId) {
      const m = measure(n, depth, o);
      levelMaxW[depth] = Math.max(levelMaxW[depth] || 0, m.w);
      const rec = {
        id: n.id, text: n.text, note: n.note || "", depth: depth,
        w: m.w, h: m.h, lines: m.lines, fontSize: m.fontSize,
        color: n.color || "", collapsed: !!n.collapsed,
        hasChildren: !!(n.children && n.children.length),
        childCount: (n.children || []).length,
        parentId: parentId || null, x: 0, y: 0, cx: 0, cy: 0
      };
      nodes.push(rec);
      rec._node = n;
      visibleChildren(n).forEach((c) => measureTree(c, depth + 1, n.id));
    })(root, 0, null);

    // 列起点：colX[d] = 前面所有层的最大宽之和 + 层间间隙
    const colX = [];
    let acc = 0;
    levelMaxW.forEach((mw, d) => {
      colX[d] = acc;
      acc += mw + (d === 0 ? o.rootGapX : o.gapX);
    });

    // 后序分配 y：叶子依次排，父节点居中于首末子之间
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

    // 连线：父右侧中点 → 子左侧中点
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

    let maxR = 0, maxB = 0;
    nodes.forEach((n) => { maxR = Math.max(maxR, n.x + n.w); maxB = Math.max(maxB, n.y + n.h); });
    nodes.forEach((n) => { delete n._node; });
    return { nodes: nodes, edges: edges, width: maxR, height: maxB, colX: colX };
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
      panning: null
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
        '</div>' +
        '<div class="mm-top-right">' +
          '<input class="mm-search" type="search" placeholder="搜索节点（Enter 下一个）">' +
          '<button class="mm-btn" data-a="zoom-out" title="缩小">－</button>' +
          '<span class="mm-zoom">100%</span>' +
          '<button class="mm-btn" data-a="zoom-in" title="放大">＋</button>' +
          '<button class="mm-btn" data-a="fit" title="适应屏幕">适应</button>' +
          '<button class="mm-btn" data-a="theme" title="深色 / 浅色">◐</button>' +
          '<button class="mm-btn" data-a="export" title="导出">导出 ▾</button>' +
        '</div>' +
      '</div>' +
      '<div class="mm-canvas-wrap">' +
        '<div class="mm-canvas-scroll"><svg class="mm-svg" tabindex="0"></svg></div>' +
        '<div class="mm-hint">双击改名 · Tab 加子级 · Enter 加同级 · Delete 删除 · 空格折叠 · 拖动节点可换父级 · Ctrl+滚轮缩放</div>' +
        '<div class="mm-menu hidden">' +
          '<button data-x="svg">导出 SVG（矢量）</button>' +
          '<button data-x="png">导出 PNG（2 倍图）</button>' +
          '<button data-x="md">导出 Markdown 大纲</button>' +
          '<button data-x="xmind">导出 XMind（.xmind）</button>' +
          '<button data-x="import">导入 Markdown 大纲</button>' +
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
    function render() {
      const lay = layout(state.root, {});
      const pad = 60;
      const W = Math.max(760, lay.width + pad * 2);
      const H = Math.max(420, lay.height + pad * 2);
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.innerHTML = "";
      svg.classList.toggle("is-dark", state.dark);

      const bg = el("rect", { x: 0, y: 0, width: "100%", height: "100%", "class": "mm-bg" });
      svg.appendChild(bg);

      viewport = el("g", { transform: "translate(" + state.tx + "," + state.ty + ") scale(" + state.zoom + ")" });
      svg.appendChild(viewport);

      const content = el("g", { transform: "translate(" + pad + "," + pad + ")" });
      viewport.appendChild(content);

      const hitSet = {};
      (state.hits || []).forEach((id) => { hitSet[id] = 1; });

      /* 连线 */
      lay.edges.forEach((e) => {
        const child = lay.nodes.filter((n) => n.id === e.id.split(">")[1])[0];
        const depthColor = e.color || BRANCH_COLORS[(child ? child.depth - 1 : 0) % BRANCH_COLORS.length];
        const dx = Math.max(24, (e.x2 - e.x1) * 0.5);
        const d = "M" + e.x1 + "," + e.y1 + " C" + (e.x1 + dx) + "," + e.y1 + " " + (e.x2 - dx) + "," + e.y2 + " " + e.x2 + "," + e.y2;
        content.appendChild(el("path", {
          d: d, fill: "none", stroke: depthColor, "stroke-width": e.depth <= 1 ? 2.4 : 1.6,
          "stroke-linecap": "round", "opacity": ".85"
        }));
      });

      /* 节点 */
      lay.nodes.forEach((n) => {
        const isRoot = n.depth === 0;
        const node = findNode(state.root, n.id) || {};
        const branch = node.color || (isRoot ? "" : BRANCH_COLORS[(n.depth - 1) % BRANCH_COLORS.length]);
        const g = el("g", { "class": "mm-node", "data-id": n.id, transform: "translate(" + n.x + "," + n.y + ")" });

        const rect = el("rect", {
          x: 0, y: 0, width: n.w, height: n.h, rx: isRoot ? 10 : 8, ry: isRoot ? 10 : 8,
          "class": "mm-node-rect" + (isRoot ? " mm-root" : "") + (state.selected === n.id ? " is-sel" : "") + (hitSet[n.id] ? " is-hit" : ""),
          stroke: branch || "#cfd8e6",
          "stroke-width": isRoot ? 2 : 1.4
        });
        if (branch) rect.style.fill = hexA(branch, isRoot ? 0.16 : 0.10);
        g.appendChild(rect);

        const textW = n.w;
        n.lines.forEach((line, i) => {
          const t = el("text", {
            x: textW / 2, y: (n.h - n.lines.length * 20) / 2 + 20 * i + 15,
            "text-anchor": "middle", "font-size": n.fontSize,
            "class": "mm-node-text" + (isRoot ? " mm-root-text" : "")
          });
          t.textContent = line;
          g.appendChild(t);
        });

        /* 折叠按钮：有子节点时显示，圆点在节点右侧 */
        if (n.hasChildren) {
          const by = n.h / 2;
          const cg = el("g", { "class": "mm-fold", "data-fold": n.id, transform: "translate(" + (n.w + 11) + "," + by + ")" });
          cg.appendChild(el("circle", { r: 9, fill: "#fff", stroke: branch || "#9aa8bd", "stroke-width": 1.4 }));
          const sign = el("text", { x: 0, y: 4, "text-anchor": "middle", "font-size": 11, fill: branch || "#6b7a90" });
          sign.textContent = n.collapsed ? String(n.childCount) : "−";
          cg.appendChild(sign);
          g.appendChild(cg);
        }

        /* 备注标记 */
        if (n.note) {
          const ng = el("g", { transform: "translate(-6,6)" });
          ng.appendChild(el("circle", { r: 6, fill: "#8b93a3" }));
          const nt = el("text", { x: 0, y: 3.5, "text-anchor": "middle", "font-size": 9, fill: "#fff" });
          nt.textContent = "i";
          ng.appendChild(nt);
          g.appendChild(ng);
        }

        content.appendChild(g);
      });

      zoomOut.textContent = Math.round(state.zoom * 100) + "%";
      svg.dataset.contentW = String(lay.width + pad * 2);
      svg.dataset.contentH = String(lay.height + pad * 2);
      svg.dataset.w = String(lay.width);
      svg.dataset.h = String(lay.height);
    }

    function hexA(hex, a) {
      const h = String(hex).replace("#", "");
      const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
      const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
      return "rgba(" + r + "," + g + "," + b + "," + a + ")";
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
      const node = (layout(state.root, {}).nodes || []).filter((n) => n.id === id)[0];
      if (!node) return;
      const r = wrap.getBoundingClientRect();
      const pad = 60;
      state.tx = r.width / 2 - (node.x + pad + node.w / 2) * state.zoom;
      state.ty = r.height / 2 - (node.y + pad + node.h / 2) * state.zoom;
      applyView();
    }

    /* ---- 编辑（就地输入） ---- */
    function beginEdit(id) {
      const node = findNode(state.root, id);
      if (!node) return;
      const lay = layout(state.root, {});
      const rec = lay.nodes.filter((n) => n.id === id)[0];
      if (!rec) return;
      const r = wrap.getBoundingClientRect();
      const pad = 60;
      const box = document.createElement("div");
      box.className = "mm-edit";
      box.style.left = (state.tx + (rec.x + pad) * state.zoom) + "px";
      box.style.top = (state.ty + (rec.y + pad) * state.zoom) + "px";
      box.style.width = Math.max(120, rec.w * state.zoom) + "px";
      const inp = document.createElement("textarea");
      inp.value = node.text || "";
      inp.rows = Math.max(1, rec.lines.length);
      box.appendChild(inp);
      wrap.appendChild(box);
      state.editing = id;
      inp.focus();
      inp.select();
      function commit() {
        if (state.editing !== id) return;
        const v = inp.value.replace(/\s+$/, "");
        state.editing = null;
        box.remove();
        if (v !== (node.text || "")) { node.text = v; changed(true); }
        else render();
      }
      inp.addEventListener("blur", commit);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { state.editing = null; box.remove(); render(); }
        e.stopPropagation();
      });
    }

    /* ---- 选中 ---- */
    function select(id) { state.selected = id; render(); }
    function selectedNode() { return state.selected ? findNode(state.root, state.selected) : null; }

    /* ---- 增删改（带撤销） ---- */
    function doAddChild() {
      const cur = selectedNode() || state.root;
      if (cur.collapsed) cur.collapsed = false;
      const n = addChild(state.root, cur.id, "新主题");
      state.selected = n.id;
      changed(true);
      beginEdit(n.id);
    }
    function doAddSibling() {
      const cur = selectedNode();
      if (!cur) return doAddChild();
      const n = addSibling(state.root, cur.id, "新主题");
      state.selected = n.id;
      changed(true);
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
      const g = e.target.closest ? e.target.closest(".mm-node") : null;
      if (g) {
        const id = g.getAttribute("data-id");
        state.selected = id;
        render();
        // 记录潜在拖拽
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
      beginEdit(g.getAttribute("data-id"));
      e.preventDefault();
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

    /* ---- 键盘 ---- */
    host.addEventListener("keydown", (e) => {
      if (state.editing) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") {
        if (e.target.classList.contains("mm-search")) {
          if (e.key === "Enter") { e.preventDefault(); nextHit(); }
        }
        return;
      }
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
        if (j >= 0 && j < sibs.length) { state.selected = sibs[j].id; render(); focusNode(state.selected); }
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const cur = selectedNode(); if (!cur) return;
        const parent = findParent(state.root, cur.id);
        if (parent) { state.selected = parent.id; render(); focusNode(state.selected); }
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const cur = selectedNode(); if (!cur) return;
        if (cur.collapsed) { cur.collapsed = false; changed(true); return; }
        if ((cur.children || []).length) { state.selected = cur.children[0].id; render(); focusNode(state.selected); }
        return;
      }
    });

    /* ---- 工具栏 ---- */
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
      if (kind === "import") {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = ".md,.txt,.markdown";
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
          fr.readAsText(f);
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
      stats() { return { nodes: countNodes(state.root) }; }
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
    toXmindContent: toXmindContent
  };
  window.MindMapEditor = MindMapEditor;
})();
