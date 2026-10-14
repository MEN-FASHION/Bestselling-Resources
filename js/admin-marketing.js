/* ============================================================
 * TREND BANK · 后台管理（marketing）
 * 说明：本文件由原单文件 admin.js 按面板拆分而来。
 *  - 共享状态在文件顶部声明（全局作用域，跨文件可见）
 *  - 函数定义在文件内 IIFE 中，末尾通过 Object.assign(window, {...}) 暴露给其它模块
 * ============================================================ */

/* ---------- 共享状态 ---------- */
// 营销日历（超级管理员）状态
let mkNodes = [];

// 时间线节点
let mkArticles = [];

// 趋势文章
let mkEditingNodeId = null;

// 正在编辑的节点 id
let mkEditingArtId = null;

// 正在编辑的文章 id
let mkCoverPath = null;

// 文章封面临时路径（R2 marketing/）
let mkNodeCoverPath = null;
(function () {

// 时间线节点：可视化渲染（与前台同款 DOM，叠加管理角标）
  function renderMarketingTimeline() {
    const tl = document.getElementById("mk-viz-timeline");
    if (!tl) return;
    if (!mkNodes.length) {
      tl.innerHTML = '<div class="mk-empty">暂无时间节点，点击上方「＋ 新增时间节点」创建。</div>';
      return;
    }
    const catOf = (k) => { const c = (k || "festival").toLowerCase(); return c === "event" ? "event" : (c === "promo" ? "promo" : "festival"); };
    tl.innerHTML = mkNodes.map((n) => {
      const date = escHtml(n.date || "");
      const title = escHtml(n.title || "");
      const desc = escHtml(n.description || "");
      const k = catOf(n.category);
      const href = n.url || "javascript:void(0);";
      const target = n.url ? "_blank" : "";
      const rel = n.url ? "noopener noreferrer" : "";
      const side = "";   // 图上文下统一布局，不再上下交错
      return `<div class="mk-node cat-${k}">
        ${n.image ? `<a class="mk-tag-img" href="${href}" target="${target}" rel="${rel}" title="${title}"><img class="mk-tag-thumb" alt="" data-path="${escAttr(n.image)}" loading="lazy"></a>` : `<span class="mk-tag-img noimg"></span>`}
        <span class="mk-conn"></span>
        <span class="mk-dot"><span class="mk-dot-inner"></span></span>
        <div class="mk-tag">
          <a class="mk-tag-link" href="${href}" target="${target}" rel="${rel}">
            <div class="mk-tag-date">${date}</div>
            <div class="mk-tag-title">${title}</div>
            ${desc ? `<div class="mk-tag-desc">${desc}</div>` : ""}
          </a>
          <div class="mk-node-ops">
            <button type="button" class="op-edit" data-act="edit" data-id="${n.id}">编辑</button>
            <button type="button" class="op-del" data-act="del" data-id="${n.id}">删除</button>
          </div>
        </div>
      </div>`;
    }).join("");
    // 节点主图：鉴权URL异步填充
    tl.querySelectorAll(".mk-tag-thumb").forEach(function(imEl){
      const path = imEl.getAttribute("data-path");
      if (path) SB.marketingImageUrl(path).then(function(u){ imEl.src = u; }).catch(function(){});
    });
    // 主轴末端右箭头
    const arrow = document.createElement("div");
    arrow.className = "mk-axis-arrow";
    arrow.innerHTML = "&#9654;";
    tl.appendChild(arrow);
    // 支持鼠标按住横向拖动滑动
    enableAdminDragScroll(tl);
    // 绑定节点管理操作
    tl.querySelectorAll(".mk-node-ops button").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const act = btn.getAttribute("data-act");
        const n = mkNodes.find(x => String(x.id) === String(id));
        if (!n) return;
        if (act === "edit") openNodeModal(n);
        else if (act === "del") delMarketingNode(n);
      });
    });
  }

// 文章卡片：可视化渲染（与前台同款 DOM，叠加管理角标）
  function renderMarketingCards() {
    const grid = document.getElementById("mk-viz-grid");
    if (!grid) return;
    if (!mkArticles.length) {
      grid.innerHTML = '<div class="mk-empty">暂无趋势文章，点击上方「＋ 发布趋势文章」创建。</div>';
      return;
    }
    grid.innerHTML = "";
    mkArticles.forEach(a => {
      const card = document.createElement("div");
      card.className = "mk-card";
      card.dataset.id = a.id;

      const imgWrap = document.createElement("div");
      imgWrap.className = "mk-card-img";
      if (a.image) {
        const img = document.createElement("img");
        img.alt = a.title || "";
        img.loading = "lazy";
        SB.marketingImageUrl(a.image).then(u => { img.src = u; }).catch(() => {});
        img.onerror = () => { imgWrap.classList.add("noimg"); img.style.display = "none"; };
        imgWrap.appendChild(img);
      } else {
        imgWrap.classList.add("noimg");
        const ph = document.createElement("span");
        ph.className = "mk-card-ph";
        ph.textContent = a.title || "营销日历";
        imgWrap.appendChild(ph);
      }

      // 管理角标（悬浮显示）
      const ops = document.createElement("div");
      ops.className = "mk-viz-ops";
      const mkOps = [
        { t: "编辑", c: "op-edit", act: "edit" },
        { t: a.published ? "下架" : "发布", c: "op-toggle", act: "toggle" },
        { t: "微信", c: "op-toggle", act: "qr" },
        { t: "预览", c: "op-toggle", act: "view" },
        { t: "删除", c: "op-del", act: "del" },
      ];
      mkOps.forEach(o => {
        const b = document.createElement("button");
        b.type = "button"; b.className = o.c; b.textContent = o.t;
        b.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          const id = a.id;
          if (o.act === "edit") openArtModal(a);
          else if (o.act === "toggle") toggleMarketingArticle(a);
          else if (o.act === "qr") showMarketingShare(a);
          else if (o.act === "view") { if (a.url) window.open(a.url, "_blank"); else sbToast("暂无文章链接", false); }
          else if (o.act === "del") delMarketingArticle(a);
        });
        ops.appendChild(b);
      });
      imgWrap.appendChild(ops);

      const body = document.createElement("div");
      body.className = "mk-card-body";
      const tt = document.createElement("div");
      tt.className = "mk-card-title";
      tt.textContent = a.title || "";
      const meta = document.createElement("div");
      meta.className = "mk-card-sub";
      meta.textContent = (a.published ? "已发布" : "已下架") + (a.summary ? " · " + a.summary : "");
      body.appendChild(tt); body.appendChild(meta);

      card.appendChild(imgWrap); card.appendChild(body);
      grid.appendChild(card);
    });
  }

// 全量刷新营销可视化
  function refreshMarketingViz() {
    renderMarketingTimeline();
    renderMarketingCards();
  }

// 鼠标/触摸按住横向拖动时间线（后台同款）
  function enableAdminDragScroll(el) {
    if (!el || el._dragBound) return;
    el._dragBound = true;
    let isDown = false, startX = 0, scrollLeft = 0, moved = false;
    el.addEventListener("mousedown", (e) => {
      if (e.target.closest("a,button,input,select")) return;
      isDown = true; moved = false;
      startX = e.pageX; scrollLeft = el.scrollLeft;
      el.style.cursor = "grabbing"; el.style.userSelect = "none";
    });
    el.addEventListener("mousemove", (e) => {
      if (!isDown) return;
      const dx = e.pageX - startX;
      if (Math.abs(dx) > 3) moved = true;
      el.scrollLeft = scrollLeft - dx;
    });
    const up = () => { if (!isDown) return; isDown = false; el.style.cursor = ""; el.style.userSelect = ""; };
    el.addEventListener("mouseup", up);
    el.addEventListener("mouseleave", up);
    el.addEventListener("click", (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
  }

async function loadMarketingNodes() {
    if (currentRole !== "super_admin") return;
    try { const r = await SB.listMarketingNodes(); mkNodes = (r && r.data) || []; } catch (e) { mkNodes = []; }
    refreshMarketingViz();
    loadMarketingArticlePick();
  }

async function loadMarketingArticles() {
    if (currentRole !== "super_admin") return;
    let list = [];
    try { const r = await SB.listMarketingArticles(false); list = (r && r.data) || []; } catch (e) { list = []; }
    mkArticles = list;
    refreshMarketingViz();
  }

function loadMarketingArticlePick() {
    const sel = document.querySelector("#mk-art-node");
    if (!sel) return;
    sel.innerHTML = "";
    if (!mkNodes.length) {
      sel.innerHTML = '<option value="">（请先添加时间线节点）</option>';
      return;
    }
    mkNodes.forEach(n => {
      const o = document.createElement("option");
      o.value = n.id; o.textContent = n.title || n.date || "节点";
      sel.appendChild(o);
    });
  }

// ---------- 节点：弹窗管理 ----------
function fmtInputDate(v) {
    if (!v) return "";
    const s = String(v).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (m) return m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5];
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const p = n => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
    }
    return s;
  }

function openNodeModal(n) {
    const modal = document.getElementById("mk-node-modal");
    if (!modal) return;
    mkEditingNodeId = n ? n.id : null;
    mkNodeCoverPath = n ? (n.image || null) : null;
    if (document.getElementById("mk-node-modal-title")) document.getElementById("mk-node-modal-title").textContent = n ? "编辑时间节点" : "新增时间节点";
    const titleEl = document.getElementById("mk-node-title");
    const dateEl = document.getElementById("mk-node-date");
    const urlEl = document.getElementById("mk-node-url");
    const catEl = document.getElementById("mk-node-category");
    if (titleEl) titleEl.value = n ? (n.title || "") : "";
    if (dateEl) dateEl.value = n ? fmtInputDate(n.date) : "";
    if (urlEl) urlEl.value = n ? (n.url || "") : "";
    if (catEl) catEl.value = n ? (n.category || "festival") : "festival";
    if (document.getElementById("mk-node-cover-name")) document.getElementById("mk-node-cover-name").textContent = mkNodeCoverPath || "";
    renderMarketingNodeCoverPreview();
    modal.classList.remove("hidden");
    if (titleEl) titleEl.focus();
  }

function closeNodeModal() {
    const modal = document.getElementById("mk-node-modal");
    if (modal) modal.classList.add("hidden");
  }

async function saveMarketingNode() {
    if (currentRole !== "super_admin") return;
    const title = (document.getElementById("mk-node-title") ? document.getElementById("mk-node-title").value : "").trim();
    if (!title) return sbToast("请填写节点标题", false);
    const dateEl = document.getElementById("mk-node-date");
    const date = dateEl && dateEl.value ? dateEl.value : new Date().toISOString();
    const urlEl = document.getElementById("mk-node-url");
    const url = urlEl ? urlEl.value.trim() : "";
    const catEl = document.getElementById("mk-node-category");
    const category = catEl ? catEl.value : "festival";
    try {
      const payload = { title, date, category, image: mkNodeCoverPath || "", url };
      const r = mkEditingNodeId
        ? await SB.updateMarketingNode(mkEditingNodeId, payload)
        : await SB.addMarketingNode(payload);
      if (r.error) return sbToast("保存节点失败：" + (r.error.message || r.error), false);
      sbToast(mkEditingNodeId ? "节点已更新" : "节点已添加");
      mkEditingNodeId = null;
      closeNodeModal();
      loadMarketingNodes();
      loadMarketingArticlePick();
    } catch (e) { sbToast("保存节点失败：" + (e.message || ""), false); }
  }

async function delMarketingNode(n) {
    if (!confirm("确定删除时间线节点「" + (n.title || "") + "」？该节点下文章会一并移除。")) return;
    try { const r = await SB.removeMarketingNode(n.id); if (r.error) return sbToast("删除失败：" + (r.error.message || r.error), false); sbToast("节点已删除"); mkEditingNodeId = null; loadMarketingNodes(); loadMarketingArticlePick(); } catch (e) { sbToast("删除失败：" + (e.message || ""), false); }
  }

// ---------- 文章：弹窗管理 ----------
  function openArtModal(a) {
    const modal = document.getElementById("mk-art-modal");
    if (!modal) return;
    mkEditingArtId = a ? a.id : null;
    mkCoverPath = a ? (a.image || null) : null;
    loadMarketingArticlePick();
    if (document.getElementById("mk-art-modal-title")) document.getElementById("mk-art-modal-title").textContent = a ? "编辑趋势文章" : "发布趋势文章";
    const nodeEl = document.getElementById("mk-art-node");
    if (nodeEl) nodeEl.value = a ? (a.node_id || "") : (mkNodes.length ? mkNodes[0].id : "");
    if (document.getElementById("mk-art-title")) document.getElementById("mk-art-title").value = a ? (a.title || "") : "";
    if (document.getElementById("mk-art-content")) document.getElementById("mk-art-content").value = a ? (a.content || "") : "";
    if (document.getElementById("mk-art-url")) document.getElementById("mk-art-url").value = a ? (a.url || "") : "";
    if (document.getElementById("mk-art-summary")) document.getElementById("mk-art-summary").value = a ? (a.summary || "") : "";
    if (document.getElementById("mk-art-published")) document.getElementById("mk-art-published").checked = a ? !!a.published : true;
    if (document.getElementById("mk-art-cover-name")) document.getElementById("mk-art-cover-name").textContent = mkCoverPath || "";
    renderMarketingCoverPreview();
    modal.classList.remove("hidden");
  }

function closeArtModal() {
    const modal = document.getElementById("mk-art-modal");
    if (modal) modal.classList.add("hidden");
  }

function resetMarketingArticle() {
    mkEditingArtId = null;
    mkCoverPath = null;
    modal = document.getElementById("mk-art-modal");
    if (modal) modal.classList.add("hidden");
  }

function renderMarketingCoverPreview() {
    const pre = document.querySelector("#mk-art-cover-preview");
    if (!pre) return;
    pre.innerHTML = "";
    if (!mkCoverPath) return;
    const img = document.createElement("img");
    img.alt = ""; SB.marketingImageUrl(mkCoverPath).then(u => { img.src = u; }).catch(() => {});
    pre.appendChild(img);
  }

// 节点主图预览（与文章封面上传一致）
  function renderMarketingNodeCoverPreview() {
    const pre = document.querySelector("#mk-node-cover-preview");
    if (!pre) return;
    pre.innerHTML = "";
    if (!mkNodeCoverPath) return;
    const img = document.createElement("img");
    img.alt = ""; SB.marketingImageUrl(mkNodeCoverPath).then(u => { img.src = u; }).catch(() => {});
    pre.appendChild(img);
  }

async function saveMarketingArticle() {
    if (currentRole !== "super_admin") return;
    const nodeId = document.getElementById("mk-art-node") ? document.getElementById("mk-art-node").value : "";
    const title = document.getElementById("mk-art-title") ? document.getElementById("mk-art-title").value.trim() : "";
    const content = document.getElementById("mk-art-content") ? document.getElementById("mk-art-content").value : "";
    const url = document.getElementById("mk-art-url") ? document.getElementById("mk-art-url").value.trim() : "";
    const summary = document.getElementById("mk-art-summary") ? document.getElementById("mk-art-summary").value.trim() : "";
    const published = document.getElementById("mk-art-published") ? document.getElementById("mk-art-published").checked : true;
    if (!nodeId) return sbToast("请选择所属时间线节点", false);
    if (!title) return sbToast("请填写文章标题", false);
    if (!url && !content.trim()) return sbToast("请填写文章正文（或提供文章链接）", false);
    try {
      const payload = { node_id: nodeId, title, url, summary, content, image: mkCoverPath, published };
      const r = mkEditingArtId
        ? await SB.updateMarketingArticle(mkEditingArtId, payload)
        : await SB.addMarketingArticle(payload);
      if (r.error) return sbToast("保存文章失败：" + (r.error.message || r.error), false);
      sbToast(mkEditingArtId ? "文章已更新" : "文章已发布");
      mkEditingArtId = null;
      closeArtModal();
      loadMarketingArticles();
    } catch (e) { sbToast("保存文章失败：" + (e.message || ""), false); }
  }

async function toggleMarketingArticle(a) {
    try { const r = await SB.updateMarketingArticle(a.id, { published: !a.published }); if (r.error) return sbToast("操作失败：" + (r.error.message || r.error), false); sbToast(a.published ? "文章已下架" : "文章已发布"); loadMarketingArticles(); } catch (e) { sbToast("操作失败：" + (e.message || ""), false); }
  }

async function delMarketingArticle(a) {
    if (!confirm("确定删除文章「" + (a.title || "") + "」？")) return;
    try { const r = await SB.removeMarketingArticle(a.id); if (r.error) return sbToast("删除失败：" + (r.error.message || r.error), false); sbToast("文章已删除"); if (mkEditingArtId === a.id) { mkEditingArtId = null; closeArtModal(); } loadMarketingArticles(); } catch (e) { sbToast("删除失败：" + (e.message || ""), false); }
  }

function showMarketingShare(a) {
    if (!a || !a.url) return sbToast("该文章暂无链接可分享", false);
    const url = a.url || "";
    const box = document.getElementById("mk-share-mask");
    if (!box) return;
    box.classList.remove("hidden");
    const titleEl = document.getElementById("mk-share-title");
    const qrEl = document.getElementById("mk-share-qr");
    if (titleEl) titleEl.textContent = (a.title || "文章") + " · 分享到微信";
    if (qrEl) {
      qrEl.innerHTML = "";
      if (typeof window.QRCode !== "undefined") {
        try { new window.QRCode(qrEl, { text: url, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.H }); }
        catch (e) { qrEl.textContent = "二维码生成失败"; }
      } else { qrEl.textContent = "二维码组件未加载"; }
    }
    const linkEl = document.getElementById("mk-share-link");
    if (linkEl) linkEl.textContent = url;
  }

function hideMarketingShare() {
    const box = document.getElementById("mk-share-mask");
    if (box) box.classList.add("hidden");
  }

function bindMarketing() {
    // 工具条
    const addNode = document.querySelector("#mk-add-node");
    const addArt = document.querySelector("#mk-add-art");
    if (addNode) addNode.addEventListener("click", () => openNodeModal(null));
    if (addArt) addArt.addEventListener("click", () => openArtModal(null));

    // 节点弹窗
    const nodeSave = document.getElementById("mk-node-save");
    const nodeCancel = document.getElementById("mk-node-cancel");
    const nodeCloseX = document.getElementById("mk-node-close-x");
    if (nodeSave) nodeSave.addEventListener("click", saveMarketingNode);
    if (nodeCancel) nodeCancel.addEventListener("click", closeNodeModal);
    if (nodeCloseX) nodeCloseX.addEventListener("click", closeNodeModal);
    const nodeModal = document.getElementById("mk-node-modal");
    if (nodeModal) nodeModal.addEventListener("click", e => { if (e.target === nodeModal) closeNodeModal(); });
    const nodeDate = document.getElementById("mk-node-date");
    if (nodeDate) nodeDate.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); saveMarketingNode(); } });

    // 文章弹窗
    const artSave = document.getElementById("mk-art-save");
    const artCancel = document.getElementById("mk-art-cancel");
    const artCloseX = document.getElementById("mk-art-close-x");
    if (artSave) artSave.addEventListener("click", saveMarketingArticle);
    if (artCancel) artCancel.addEventListener("click", closeArtModal);
    if (artCloseX) artCloseX.addEventListener("click", closeArtModal);
    const artModal = document.getElementById("mk-art-modal");
    if (artModal) artModal.addEventListener("click", e => { if (e.target === artModal) closeArtModal(); });

    // 封面选择/上传
    const coverPick = document.getElementById("mk-art-cover-pick");
    const coverInput = document.getElementById("mk-art-cover-input");
    if (coverPick && coverInput) {
      coverPick.addEventListener("click", () => coverInput.click());
      coverInput.addEventListener("change", async () => {
        const f = coverInput.files && coverInput.files[0];
        coverInput.value = "";
        if (!f) return;
        if (f.type && f.type.indexOf("image/") !== 0) return sbToast("仅支持图片文件", false);
        try {
          const path = await SB.uploadMarketingImage(f);
          mkCoverPath = path;
          if (document.getElementById("mk-art-cover-name")) document.getElementById("mk-art-cover-name").textContent = path;
          renderMarketingCoverPreview();
          sbToast("封面图已上传");
        } catch (e) { sbToast("封面上传失败：" + (e.message || ""), false); }
      });
    }

    // 节点主图选择/上传
    const nodeCoverPick = document.getElementById("mk-node-cover-pick");
    const nodeCoverInput = document.getElementById("mk-node-cover-input");
    if (nodeCoverPick && nodeCoverInput) {
      nodeCoverPick.addEventListener("click", () => nodeCoverInput.click());
      nodeCoverInput.addEventListener("change", async () => {
        const f = nodeCoverInput.files && nodeCoverInput.files[0];
        nodeCoverInput.value = "";
        if (!f) return;
        if (f.type && f.type.indexOf("image/") !== 0) return sbToast("仅支持图片文件", false);
        try {
          const path = await SB.uploadMarketingImage(f);
          mkNodeCoverPath = path;
          if (document.getElementById("mk-node-cover-name")) document.getElementById("mk-node-cover-name").textContent = path;
          renderMarketingNodeCoverPreview();
          sbToast("节点主图已上传");
        } catch (e) { sbToast("主图上传失败：" + (e.message || ""), false); }
      });
    }

    // 分享弹窗关闭
    const shareMask = document.getElementById("mk-share-mask");
    if (shareMask) {
      shareMask.addEventListener("click", e => { if (e.target === shareMask) hideMarketingShare(); });
      const shareClose = document.getElementById("mk-share-close");
      if (shareClose) shareClose.addEventListener("click", hideMarketingShare);
    }

    loadMarketingNodes();
    loadMarketingArticles();
  }

function bindSuperTabs() {
    const bar = document.getElementById("super-tabs");
    if (!bar) return;
    bar.addEventListener("click", (e) => {
      const btn = e.target.closest(".super-tab");
      if (!btn) return;
      const sv = btn.getAttribute("data-sv");
      if (!sv) return;
      bar.querySelectorAll(".super-tab").forEach(b => b.classList.toggle("active", b === btn));
      document.querySelectorAll("#super-card .super-sub").forEach(sub => {
        sub.style.display = (sub.getAttribute("data-sv") === sv) ? "" : "none";
      });
    });
  }

  /* 暴露给其它模块 / 事件绑定 */
  Object.assign(window, {
    renderMarketingTimeline, renderMarketingCards, refreshMarketingViz, enableAdminDragScroll, loadMarketingNodes, loadMarketingArticles, loadMarketingArticlePick, fmtInputDate, openNodeModal, closeNodeModal, saveMarketingNode, delMarketingNode, openArtModal, closeArtModal, resetMarketingArticle, renderMarketingCoverPreview, renderMarketingNodeCoverPreview, saveMarketingArticle, toggleMarketingArticle, delMarketingArticle, showMarketingShare, hideMarketingShare, bindMarketing, bindSuperTabs
  });

})();
