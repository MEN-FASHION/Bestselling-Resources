/* ============================================================
 * admin-tools.js —— 后台「实用工具」面板（20261112C）
 *
 * 定位：后台侧栏一个独立入口，装那些「跟某个专区无关、但干活时常用」的小工具。
 * 目前第一个工具是思维导图（对标 XMind / 幕布 / GitMind 的常用能力）。
 * 以后加工具只需在 TOOLS 里加一项 + 一个挂载函数，侧栏不用再动。
 *
 * 数据：存在 site_settings.frontend_dims.tools_mindmaps（不改表结构）
 *      每份导图 = { id, title, updated, root:{节点树} }
 *      节点只存文字与结构，不存图片，几十 KB 级。
 * ============================================================ */
(function () {
  "use strict";

  const MOUNT_ID = "tools-card";
  const SAVE_DELAY = 1200;

  const state = {
    inited: false,
    mounted: false,
    loaded: false,
    list: [],          // 全部导图
    curId: "",         // 当前打开
    editor: null,
    saving: false,
    dirty: false,
    timer: null
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function toast(msg, ok) {
    if (window.sbToast) window.sbToast(msg, ok !== false);
  }
  function nowISO() { return new Date().toISOString(); }
  function fmtTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* 首次使用的示例导图：比空画布更容易上手 */
  function sampleRoot() {
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

  /* ---------------- 面板骨架 ---------------- */
  function panelHtml() {
    return '' +
      '<div class="rkadm-head">' +
        '<div>' +
          '<h2>实用工具 <span class="hint-inline">（思维导图 · 自动保存 · 可导出 SVG / PNG / Markdown / XMind）</span></h2>' +
          '<p class="hint">' +
            '画布上双击节点改名，<b>Tab</b> 加子主题，<b>Enter</b> 加同级，<b>Delete</b> 删除，<b>空格</b> 折叠，' +
            '拖动节点可换父级，<b>Ctrl + 滚轮</b> 缩放。<b>改动会自动保存</b>，关掉页面再回来还在。' +
          '</p>' +
        '</div>' +
      '</div>' +
      '<div class="mm-tools">' +
        '<aside class="mm-side">' +
          '<div class="mm-side-head">' +
            '<span class="mm-side-title">我的导图</span>' +
            '<button class="mm-btn mm-btn-primary" data-t="new" type="button">＋ 新建</button>' +
          '</div>' +
          '<div class="mm-list" id="mm-list"><div class="hint">加载中…</div></div>' +
        '</aside>' +
        '<section class="mm-main">' +
          '<div class="mm-main-head">' +
            '<input class="mm-title" id="mm-title" type="text" placeholder="导图名称" maxlength="60">' +
            '<span class="mm-save" id="mm-save">—</span>' +
            '<span class="mm-grow"></span>' +
            '<button class="mm-btn" data-t="rename" type="button">重命名</button>' +
            '<button class="mm-btn" data-t="dup" type="button">复制一份</button>' +
            '<button class="mm-btn mm-btn-danger" data-t="del" type="button">删除导图</button>' +
          '</div>' +
          '<div class="mm-stage" id="mm-stage"><div class="hint" style="padding:24px">选择一个导图，或点「新建」</div></div>' +
        '</section>' +
      '</div>';
  }

  /* ---------------- 数据 ---------------- */
  async function load() {
    try {
      state.list = await window.SB.getMindmaps();
    } catch (e) {
      state.list = [];
    }
    if (!state.list.length) {
      // 第一次进入：给一份示例，用户可以直接改
      state.list = [{ id: "mm_" + Date.now().toString(36), title: "我的思维导图", updated: nowISO(), root: sampleRoot() }];
      await persist(true);
    }
    state.loaded = true;
    if (!state.curId || !state.list.some((m) => m.id === state.curId)) state.curId = state.list[0].id;
    renderList();
    openCurrent();
  }

  async function persist(silent) {
    if (state.saving) { state.dirty = true; return; }
    state.saving = true;
    setSaveText("保存中…", "");
    try {
      await window.SB.setMindmaps(state.list);
      setSaveText("已保存 " + fmtTime(nowISO()).slice(11), "ok");
      if (!silent) { /* 静默保存不打扰 */ }
    } catch (e) {
      setSaveText("保存失败，稍后重试", "err");
      if (!silent) toast("保存失败，请检查网络后重试", false);
    } finally {
      state.saving = false;
      if (state.dirty) { state.dirty = false; scheduleSave(); }
    }
  }
  function scheduleSave() {
    state.dirty = true;
    setSaveText("有改动…", "");
    clearTimeout(state.timer);
    state.timer = setTimeout(() => { state.dirty = false; persist(true); }, SAVE_DELAY);
  }
  function setSaveText(txt, cls) {
    const el = document.getElementById("mm-save");
    if (!el) return;
    el.textContent = txt;
    el.className = "mm-save" + (cls ? " is-" + cls : "");
  }
  function current() { return state.list.filter((m) => m.id === state.curId)[0] || null; }

  /* ---------------- 列表 ---------------- */
  function renderList() {
    const box = document.getElementById("mm-list");
    if (!box) return;
    if (!state.list.length) { box.innerHTML = '<div class="hint">还没有导图，点「新建」开始</div>'; return; }
    box.innerHTML = state.list.map((m) => {
      const cnt = window.MindMapCore.countNodes(m.root);
      return '<button type="button" class="mm-item' + (m.id === state.curId ? " is-on" : "") + '" data-id="' + esc(m.id) + '">' +
        '<b>' + esc(m.title || "未命名导图") + '</b>' +
        '<span>' + cnt + ' 个节点 · ' + fmtTime(m.updated) + '</span>' +
      '</button>';
    }).join("");
    box.querySelectorAll(".mm-item").forEach((b) => {
      b.onclick = () => { switchTo(b.getAttribute("data-id")); };
    });
  }

  /* ---------------- 打开 / 切换 ---------------- */
  function openCurrent() {
    const m = current();
    const stage = document.getElementById("mm-stage");
    const titleEl = document.getElementById("mm-title");
    if (!stage) return;
    if (!m) {
      stage.innerHTML = '<div class="hint" style="padding:24px">请先新建一个导图</div>';
      if (titleEl) titleEl.value = "";
      return;
    }
    if (titleEl) titleEl.value = m.title || "";
    if (!state.editor) {
      stage.innerHTML = "";
      state.editor = window.MindMapEditor(stage, {
        getTitle: () => (current() ? current().title : "思维导图"),
        toast: toast,
        onChange: (root) => {
          const cur = current();
          if (!cur) return;
          cur.root = root;
          cur.updated = nowISO();
          scheduleSave();
        }
      });
    }
    state.editor.setRoot(window.MindMapCore.clone(m.root));
  }

  function switchTo(id) {
    if (id === state.curId) return;
    state.curId = id;
    renderList();
    openCurrent();
  }

  /* ---------------- 操作 ---------------- */
  async function actNew() {
    const core = window.MindMapCore;
    const root = core.newNode("新的思维导图");
    core.addChild(root, root.id, "子主题");
    const m = { id: "mm_" + Date.now().toString(36), title: "新的思维导图", updated: nowISO(), root: root };
    state.list.unshift(m);
    state.curId = m.id;
    renderList();
    openCurrent();
    await persist();
    toast("已新建导图");
  }
  async function actRename() {
    const m = current();
    if (!m) return;
    const v = await window.sbAsk({ title: "重命名导图", desc: "只改名字，节点内容不变。", value: m.title || "", placeholder: "导图名称" });
    if (v === null) return;                       // 取消
    const name = String(v == null ? "" : v).trim();
    if (!name || name === m.title) return;
    m.title = name.slice(0, 60);
    m.updated = nowISO();
    const t = document.getElementById("mm-title");
    if (t) t.value = m.title;
    renderList();
    await persist();
    toast("已重命名");
  }
  async function actDup() {
    const m = current();
    if (!m) return;
    const copy = JSON.parse(JSON.stringify(m));
    copy.id = "mm_" + Date.now().toString(36);
    copy.title = (m.title || "导图") + " 副本";
    copy.updated = nowISO();
    // 节点 id 也要重生成，避免两棵树共用 id 后互相干扰
    const core = window.MindMapCore;
    core.walk(copy.root, (n) => { n.id = core.uid("n"); });
    state.list.unshift(copy);
    state.curId = copy.id;
    renderList();
    openCurrent();
    await persist();
    toast("已复制一份");
  }
  async function actDel() {
    const m = current();
    if (!m) return;
    const ok = await window.sbConfirm({
      title: "删除导图「" + (m.title || "未命名") + "」",
      desc: "删除后无法恢复（导图里的节点会一起消失）。",
      okText: "删除", danger: true
    });
    if (!ok) return;
    state.list = state.list.filter((x) => x.id !== m.id);
    state.curId = state.list.length ? state.list[0].id : "";
    state.editor = null;
    const stage = document.getElementById("mm-stage");
    if (stage) stage.innerHTML = "";
    renderList();
    if (state.curId) openCurrent();
    else {
      const st = document.getElementById("mm-stage");
      if (st) st.innerHTML = '<div class="hint" style="padding:24px">还没有导图，点「新建」开始</div>';
      const t = document.getElementById("mm-title");
      if (t) t.value = "";
    }
    await persist();
    toast("已删除");
  }

  /* ---------------- 挂载 ---------------- */
  function mount() {
    const card = document.getElementById(MOUNT_ID);
    if (!card) return false;
    if (!window.MindMapCore || !window.MindMapEditor) {
      card.innerHTML = '<div class="rkadm-head"><h2>实用工具</h2></div>' +
        '<div class="hint" style="padding:20px">思维导图组件没加载成功，请强刷页面（Ctrl/Cmd + Shift + R）后重试。</div>';
      return true;
    }
    if (!state.mounted) {
      card.innerHTML = panelHtml();
      state.mounted = true;
      card.addEventListener("click", (e) => {
        const b = e.target.closest ? e.target.closest("[data-t]") : null;
        if (!b) return;
        const t = b.getAttribute("data-t");
        if (t === "new") actNew();
        else if (t === "rename") actRename();
        else if (t === "dup") actDup();
        else if (t === "del") actDel();
      });
      const titleEl = document.getElementById("mm-title");
      if (titleEl) {
        titleEl.addEventListener("input", () => {
          const m = current();
          if (!m) return;
          m.title = (titleEl.value || "").slice(0, 60);
          m.updated = nowISO();
          scheduleSave();
        });
      }
    }
    if (!state.loaded) load();
    return true;
  }

  window.ToolsAdmin = {
    enter() { return mount(); },
    mount: mount,
    /* 供自检使用 */
    _state: state
  };
})();
