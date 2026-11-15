/* ============================================================
 * admin-tools.js —— 后台「实用工具」面板（20261112G）
 *
 * 定位：后台侧栏一个独立入口，装那些「跟某个专区无关、但干活时常用」的工具。
 * 现在并列三个：
 *   ① 思维导图      —— 梳理思路（对标 XMind / 幕布）
 *   ② 流程图/泳道图  —— 按角色分道把流程画清楚（对标 draw.io / ProcessOn）
 *   ③ 上新甘特图     —— 服装各类目开发排期与进度跟踪（对标 Smartsheet / 飞书甘特）
 *
 * 三个工具共用同一套「左列表 + 右画布 + 自动保存」骨架，
 * 以后加第四个工具只需在 TOOLS 里加一项配置 + 一个 render 函数，侧栏不用再动。
 *
 * 数据：都存 site_settings.frontend_dims 下，不改表结构
 *   tools_mindmaps / tools_flowcharts / tools_gantts
 * ============================================================ */
(function () {
  "use strict";

  const MOUNT_ID = "tools-card";
  const SAVE_DELAY = 1200;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function toast(msg, ok) { if (window.sbToast) window.sbToast(msg, ok !== false); }
  function nowISO() { return new Date().toISOString(); }
  function fmtTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  /* 站内弹窗；组件缺失时给提示而不是回退浏览器原生框 */
  async function ask(opts) {
    if (window.sbAsk) return await window.sbAsk(opts);
    toast("弹窗组件未加载，请强刷页面", false);
    return null;
  }
  async function confirmBox(opts) {
    if (window.sbConfirm) return await window.sbConfirm(opts);
    toast("弹窗组件未加载，请强刷页面", false);
    return false;
  }

  /* ================= 示例数据 ================= */

  function sampleMind() {
    const core = window.MindMapCore;
    const root = core.newNode("我的思维导图");
    const a = core.addChild(root, root.id, "选品方向");
    core.addChild(root, a.id, "夏日清凉");
    core.addChild(root, a.id, "复古学院");
    core.addChild(root, a.id, "运动休闲");
    const b = core.addChild(root, root.id, "视觉表达");
    core.addChild(root, b.id, "纯色背景");
    core.addChild(root, b.id, "场景实拍");
    const c = core.addChild(root, root.id, "下一步");
    core.addChild(root, c.id, "双击改名，回车加同级，Tab 加子级");
    return root;
  }

  function sampleFlow() {
    const C = window.FlowchartCore;
    const doc = C.newDoc("上新流程图");
    doc.lanes[0].name = "运营";
    doc.lanes[1].name = "商品";
    const L1 = doc.lanes[0].id, L2 = doc.lanes[1].id;
    const n1 = C.addNode(doc, C.newNode("start", "开始", { lane: L1 }));
    const n2 = C.addNode(doc, C.newNode("process", "选品定款", { lane: L1 }));
    const n3 = C.addNode(doc, C.newNode("decision", "是否打样", { lane: L1 }));
    const n4 = C.addNode(doc, C.newNode("process", "寄样制版", { lane: L2 }));
    const n5 = C.addNode(doc, C.newNode("process", "主图拍摄", { lane: L2 }));
    const n6 = C.addNode(doc, C.newNode("end", "上架", { lane: L1 }));
    C.addEdge(doc, n1.id, n2.id);
    C.addEdge(doc, n2.id, n3.id);
    C.addEdge(doc, n3.id, n4.id, "是");
    C.addEdge(doc, n4.id, n5.id);
    C.addEdge(doc, n5.id, n6.id);
    C.layout(doc, { maxPerRow: 4 });
    return doc;
  }

  function sampleGantt() {
    const C = window.GanttCore;
    const doc = C.newDoc("服装上新排期");
    C.sampleTasks().forEach((t) => C.addTask(doc, t));
    return doc;
  }

  /* ================= 三个工具的配置 ================= */

  const TOOLS = [
    {
      key: "mm",
      label: "思维导图",
      side: "我的导图",
      hint: "双击改名（支持多行）· Tab 加子级 · Enter 加同级 · 空格折叠 · 右上「结构」可切左右/树状/架构图 · 「属性」加标签/优先级/进度",
      get: () => window.SB.getMindmaps(),
      set: (l) => window.SB.setMindmaps(l),
      ready: () => !!(window.MindMapCore && window.MindMapEditor),
      missMsg: "思维导图组件没加载成功，请强刷页面（Ctrl/Cmd + Shift + R）后重试。",
      make: () => ({ id: "mm_" + Date.now().toString(36), title: "我的思维导图", updated: nowISO(), root: sampleMind() }),
      count: (it) => window.MindMapCore.countNodes(it.root) + " 个节点",
      render(el, item, api) {
        const ed = window.MindMapEditor(el, { onChange(root) { item.root = root; api.touch(); } });
        ed.setRoot(window.MindMapCore.clone(item.root));
        return ed;
      }
    },
    {
      key: "fc",
      label: "流程图 / 泳道图",
      side: "我的流程图",
      hint: "双击节点就地改字；拖节点移动；「连线」后依次点两个节点；支持开始/结束/步骤/判断/数据/准备/文档/人工/等待",
      get: () => window.SB.getFlowcharts(),
      set: (l) => window.SB.setFlowcharts(l),
      ready: () => !!window.FlowchartCore,
      missMsg: "流程图组件没加载成功，请强刷页面（Ctrl/Cmd + Shift + R）后重试。",
      make: () => ({ id: "fc_" + Date.now().toString(36), title: "未命名流程图", updated: nowISO(), doc: sampleFlow() }),
      count: (it) => window.FlowchartCore.stats(it.doc).nodes + " 个节点",
      render(el, item, api) {
        const ed = window.FlowchartEditor(el, { onChange(doc) { item.doc = doc; api.touch(); } });
        ed.setDoc(JSON.parse(JSON.stringify(item.doc)));
        return ed;
      }
    },
    {
      key: "gt",
      label: "上新甘特图",
      side: "我的排期",
      hint: "拖条形整体平移，拖右端改结束日；「依赖连线」先点前置再点后继；「关键路径」「基线」「刻度」在工具条上",
      get: () => window.SB.getGantts(),
      set: (l) => window.SB.setGantts(l),
      ready: () => !!window.GanttCore,
      missMsg: "甘特图组件没加载成功，请强刷页面（Ctrl/Cmd + Shift + R）后重试。",
      make: () => ({ id: "gt_" + Date.now().toString(36), title: "服装上新排期", updated: nowISO(), doc: sampleGantt() }),
      count: (it) => (it.doc.tasks || []).length + " 项任务",
      render(el, item, api) {
        const bd = window.GanttBoard(el, { onChange(doc) { item.doc = doc; api.touch(); } });
        bd.setDoc(JSON.parse(JSON.stringify(item.doc)));
        return bd;
      }
    }
  ];

  /* ================= 复制时重建 id（两份内容互不串改） ================= */

  function reidTree(root) {
    const core = window.MindMapCore;
    if (!core || !root) return;
    core.walk(root, (n) => { n.id = core.uid("n"); });
  }
  void reidTree;
  function reidDoc(doc) {
    const C = window.FlowchartCore, G = window.GanttCore;
    if (doc.lanes) doc.lanes.forEach((l) => { l.id = C.newId("ln"); });
    if (doc.nodes) {
      const map = {};
      doc.nodes.forEach((n) => { const old = n.id; n.id = C.newId("nd"); map[old] = n.id; });
      doc.edges = (doc.edges || []).map((e) => ({ id: C.newId("eg"), from: map[e.from] || e.from, to: map[e.to] || e.to, label: e.label }));
    }
    if (doc.tasks) doc.tasks.forEach((tk) => { tk.id = G.newId("tk"); });
    return doc;
  }

  /* ================= 通用工具面板 ================= */

  function shellHtml(t) {
    return '' +
      '<div class="mm-tools">' +
        '<aside class="mm-side">' +
          '<div class="mm-side-head">' +
            '<span class="mm-side-title">' + esc(t.side) + "</span>" +
            '<button class="mm-btn mm-btn-primary" data-p="new" type="button">＋ 新建</button>' +
          "</div>" +
          '<div class="mm-list" data-r="list"><div class="hint">加载中…</div></div>' +
        "</aside>" +
        '<section class="mm-main">' +
          '<div class="mm-main-head">' +
            '<input class="mm-title" data-r="title" type="text" placeholder="名称" maxlength="60">' +
            '<span class="mm-save" data-r="save">—</span>' +
            '<span class="mm-grow"></span>' +
            '<button class="mm-btn" data-p="dup" type="button">复制一份</button>' +
            '<button class="mm-btn mm-btn-danger" data-p="del" type="button">删除</button>' +
          "</div>" +
          '<div class="mm-stage" data-r="stage"><div class="hint" style="padding:24px">选择一个，或点「新建」</div></div>' +
        "</section>" +
      "</div>";
  }

  function makePanel(t) {
    const st = { list: [], curId: "", editor: null, loaded: false, saving: false, dirty: false, timer: null, root: null };

    function el(role) { return st.root ? st.root.querySelector('[data-r="' + role + '"]') : null; }
    function current() { return st.list.filter((m) => m.id === st.curId)[0] || null; }
    function setSaveText(txt, cls) {
      const e = el("save");
      if (!e) return;
      e.textContent = txt;
      e.className = "mm-save" + (cls ? " " + cls : "");
    }

    async function load() {
      try { st.list = await t.get(); } catch (e) { st.list = []; }
      if (!Array.isArray(st.list)) st.list = [];
      if (!st.list.length) {
        st.list = [t.make()];
        st.loaded = true;
        await persist(true);
      }
      st.loaded = true;
      if (!st.curId || !st.list.some((m) => m.id === st.curId)) st.curId = st.list[0].id;
      renderList();
      openCurrent();
    }

    async function persist(silent) {
      if (st.saving) { st.dirty = true; return; }
      st.saving = true;
      setSaveText("保存中…", "");
      try {
        await t.set(st.list);
        setSaveText("已保存 " + fmtTime(nowISO()).slice(11), "ok");
        void silent;
      } catch (e) {
        setSaveText("保存失败", "bad");
        toast("保存失败，请检查网络后重试", false);
      } finally {
        st.saving = false;
        if (st.dirty) { st.dirty = false; scheduleSave(); }
      }
    }

    function scheduleSave() {
      if (st.timer) clearTimeout(st.timer);
      setSaveText("编辑中…", "");
      st.timer = setTimeout(() => { st.timer = null; persist(); }, SAVE_DELAY);
    }

    function renderList() {
      const box = el("list");
      if (!box) return;
      if (!st.list.length) { box.innerHTML = '<div class="hint" style="padding:10px">还没有内容，点「新建」</div>'; return; }
      box.innerHTML = st.list.map((m) =>
        '<div class="mm-item' + (m.id === st.curId ? " active" : "") + '" data-id="' + esc(m.id) + '">' +
          '<div class="mm-item-title">' + esc(m.title || "未命名") + "</div>" +
          '<div class="mm-item-meta">' + esc(t.count(m)) + " · " + fmtTime(m.updated) + "</div>" +
        "</div>").join("");
    }

    function openCurrent() {
      const stage = el("stage");
      const titleEl = el("title");
      const m = current();
      if (!m) {
        if (stage) stage.innerHTML = '<div class="hint" style="padding:24px">还没有内容，点「新建」开始</div>';
        if (titleEl) titleEl.value = "";
        return;
      }
      if (st.editor && st.editor.destroy) { try { st.editor.destroy(); } catch (e) { /* 忽略 */ } }
      st.editor = null;
      if (titleEl) titleEl.value = m.title || "";
      if (stage) {
        stage.innerHTML = "";
        st.editor = t.render(stage, m, { touch() { m.updated = nowISO(); scheduleSave(); } });
      }
      renderList();
    }

    async function actNew() {
      const m = t.make();
      m.title = "未命名" + t.label;
      st.list.unshift(m);
      st.curId = m.id;
      renderList();
      openCurrent();
      await persist();
      toast("已新建");
    }

    async function actDup() {
      const m = current();
      if (!m) return;
      const copy = JSON.parse(JSON.stringify(m));
      copy.id = t.key + "_" + Date.now().toString(36);
      copy.title = (m.title || "未命名") + " 副本";
      copy.updated = nowISO();
      const core = window.MindMapCore;
      if (copy.root && core) core.walk(copy.root, (n) => { n.id = core.uid("n"); });
      if (copy.doc) copy.doc = reidDoc(copy.doc);
      st.list.unshift(copy);
      st.curId = copy.id;
      renderList();
      openCurrent();
      await persist();
      toast("已复制一份");
    }

    async function actDel() {
      const m = current();
      if (!m) return;
      const okc = await confirmBox({ title: "删除「" + (m.title || "未命名") + "」", desc: "删除后无法恢复。", ok: "删除", danger: true });
      if (!okc) return;
      st.list = st.list.filter((x) => x.id !== m.id);
      st.curId = st.list[0] ? st.list[0].id : "";
      renderList();
      openCurrent();
      await persist();
      toast("已删除");
    }

    function mount(parent) {
      const pane = document.createElement("div");
      pane.className = "tp-pane";
      pane.setAttribute("data-pane", t.key);
      if (!t.ready()) {
        pane.innerHTML = '<div class="hint" style="padding:20px">' + esc(t.missMsg) + "</div>";
        parent.appendChild(pane);
        return pane;
      }
      pane.innerHTML = shellHtml(t);
      parent.appendChild(pane);
      st.root = pane;

      pane.addEventListener("click", (e) => {
        const b = e.target.closest ? e.target.closest("[data-p]") : null;
        if (b) {
          const p = b.getAttribute("data-p");
          if (p === "new") actNew();
          else if (p === "dup") actDup();
          else if (p === "del") actDel();
          return;
        }
        const it = e.target.closest ? e.target.closest(".mm-item") : null;
        if (it) {
          st.curId = it.getAttribute("data-id");
          renderList();
          openCurrent();
        }
      });

      const titleEl = pane.querySelector('[data-r="title"]');
      if (titleEl) {
        titleEl.addEventListener("input", () => {
          const m = current();
          if (!m) return;
          m.title = (titleEl.value || "").slice(0, 60);
          m.updated = nowISO();
          scheduleSave();
          renderList();
        });
      }
      if (!st.loaded) load();
      return pane;
    }

    return { mount, state: st, ask: ask };
  }

  /* ================= 面板骨架与工具切换 ================= */

  const panels = {};
  const ui = { mounted: false, tab: "mm", card: null };

  function shell() {
    return '' +
      '<div class="rkadm-head">' +
        "<div>" +
          '<h2>实用工具 <span class="hint-inline">（思维导图 · 流程图 / 泳道图 · 上新甘特图）</span></h2>' +
          '<p class="hint">三个工具同一套用法：左边是清单，右边是画布，<b>改动自动保存</b>，关掉页面再回来还在。每个都能导出图片或文本，拿去贴文档、发群。</p>' +
        "</div>" +
      "</div>" +
      '<div class="tp-tabs">' +
        TOOLS.map((t, i) => '<button class="tp-tab' + (i === 0 ? " active" : "") + '" data-tab="' + t.key + '" type="button">' + esc(t.label) + "</button>").join("") +
      "</div>" +
      '<p class="tp-hint" data-role="tip">' + esc(TOOLS[0].hint) + "</p>" +
      '<div data-role="panes"></div>';
  }

  function switchTab(key) {
    if (!panels[key]) return;
    ui.tab = key;
    const card = ui.card;
    if (!card) return;
    card.querySelectorAll(".tp-tab").forEach((b) => { b.classList.toggle("active", b.getAttribute("data-tab") === key); });
    card.querySelectorAll(".tp-pane").forEach((p) => { p.classList.toggle("hidden", p.getAttribute("data-pane") !== key); });
    const tip = card.querySelector('[data-role="tip"]');
    const t = TOOLS.filter((x) => x.key === key)[0];
    if (tip && t) tip.textContent = t.hint;
  }

  function mount() {
    const card = document.getElementById(MOUNT_ID);
    if (!card) return false;
    if (!ui.mounted) {
      card.innerHTML = shell();
      const panes = card.querySelector('[data-role="panes"]');
      /* 三个工具各自独立初始化：某个出错只影响它自己，不会让整个面板空白 */
      TOOLS.forEach((t) => {
        try {
          panels[t.key] = makePanel(t);
          panels[t.key].mount(panes);
        } catch (e) {
          const box = document.createElement("div");
          box.className = "tp-pane";
          box.setAttribute("data-pane", t.key);
          box.innerHTML = '<div class="hint" style="padding:20px">' + esc(t.label) + " 初始化出错，请强刷页面后重试。</div>";
          panes.appendChild(box);
          panels[t.key] = { mount: () => box };
        }
      });
      card.addEventListener("click", (e) => {
        const b = e.target.closest ? e.target.closest("[data-tab]") : null;
        if (b) switchTab(b.getAttribute("data-tab"));
      });
      ui.mounted = true;
      ui.card = card;
      switchTab(ui.tab);
    }
    return true;
  }

  window.ToolsAdmin = {
    enter() { return mount(); },
    mount: mount,
    switchTab: switchTab,
    _panels: panels,
    _ui: ui
  };
})();
