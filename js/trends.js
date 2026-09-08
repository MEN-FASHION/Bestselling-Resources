/* ============================================================
 * 趋势专区前台逻辑：登录校验 + 类目/月度/周度筛选 + 趋势文件列表 + 受控PDF预览 + 防下载
 * ============================================================ */
(function () {
  const $ = (sel) => document.querySelector(sel);

  let curTag = "全部";
  let curCat = "全部";
  let trends = [];
  let shownCats = [];
  // PDF 自绘预览状态
  let pdfDoc = null, pdfPage = 1, pdfScale = 1.0, pdfRendering = false;
  let recruitTasks = [];   // 招品任务清单
  let recruitSubs = [];    // 全部提交（前台悬浮显示用）
  let recruitCurUid = "";  // 当前登录商家 ID（前台只看自己的提交）

  function toast(msg, ok = true) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.style.background = ok ? "rgba(34,47,38,.92)" : "rgba(120,40,38,.92)";
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#site-title").textContent = CONFIG.siteTitle || "图片图鉴";
    document.title = (CONFIG.siteTitle || "图片图鉴") + " · 趋势专区";
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }

    // 趋势专区始终需登录 —— 监听登录态
    SB.onAuth((session) => {
      window.__loggedIn = !!session;
      refreshUI();
    });

    $("#login-form").addEventListener("submit", onLogin);
    $("#logout-btn").onclick = onLogout;
    $("#pdf-close").onclick = closePdf;
    $("#pdf-prev").onclick = () => goPage(-1);
    $("#pdf-next").onclick = () => goPage(1);
    $("#pdf-zoom-out").onclick = () => setPdfZoom(pdfScale - 0.1);
    $("#pdf-zoom-in").onclick = () => setPdfZoom(pdfScale + 0.1);
    $("#pdf-modal").addEventListener("click", (e) => { if (e.target.id === "pdf-modal") closePdf(); });
    window.addEventListener("keydown", (e) => {
      const m = $("#pdf-modal");
      if (m && !m.classList.contains("hidden")) {
        if (e.key === "Escape") closePdf();
        else if (e.key === "ArrowRight") goPage(1);
        else if (e.key === "ArrowLeft") goPage(-1);
      }
    });

    // 标签筛选
    document.querySelectorAll(".trend-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        curTag = btn.dataset.tag;
        document.querySelectorAll(".trend-filter-btn").forEach(b => b.classList.toggle("active", b === btn));
        renderList();
      });
    });

    setupAntiDownload();
    // 立即判断当前是否已登录
    SB.getSession().then(s => { window.__loggedIn = !!s; refreshUI(); }).catch(() => refreshUI());

    // ===== 公告弹窗事件 =====
    document.querySelectorAll(".top-tabs [data-viewtab]").forEach(a => {
      if (a.dataset.viewtab === "recruit") a.addEventListener("click", goRecruit);
      else if (a.dataset.viewtab === "trend") a.addEventListener("click", goTrend);
    });
    window.addEventListener("hashchange", () => showMain());

    $("#notice-tab").addEventListener("click", function (e) {
      e.preventDefault();
      noticeTabActive = noticeUnreadList.length === 0 ? "history" : "unread";
      openNoticeModal();
    });
    $("#notice-close").addEventListener("click", closeNoticeModal);
    $("#notice-modal").addEventListener("click", (e) => {
      if (e.target && e.target.id === "notice-modal") closeNoticeModal();
    });
    const readerClose = document.getElementById("notice-reader-close");
    if (readerClose) readerClose.addEventListener("click", closeNoticeReader);
    const readerWrap = document.getElementById("notice-reader");
    if (readerWrap) readerWrap.addEventListener("click", (e) => {
      if (e.target && e.target.id === "notice-reader") closeNoticeReader();
    });
    document.querySelectorAll(".notice-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        noticeTabActive = btn.getAttribute("data-ntab") || "unread";
        renderNoticeBody();
      });
    });
    onAuthRefreshNotices();
  });

  // ================= 公告：近一个月未读 + 历史记录（弹窗） =================
  let noticeAutoShown = false;
  let noticeUnreadList = [];
  let noticeHistoryList = [];
  let noticeTabActive = "unread";

  async function onAuthRefreshNotices() {
    loadNotices();
    SB.onAuth(() => loadNotices());
  }
  async function loadNotices() {
    try {
      const all = await SB.listRecentPublishedAnnouncements().catch(() => []);
      const readIds = await SB.listMyReadAnnouncementIds().catch(() => []);
      const readSet = new Set(readIds || []);
      noticeUnreadList = (all || []).filter(a => !readSet.has(String(a.id)));
      updateNoticeBadge();
      if (!noticeAutoShown && window.__loggedIn && noticeUnreadList.length > 0) {
        noticeAutoShown = true;
        noticeTabActive = "unread";
        openNoticeModal();
      }
    } catch (e) {}
  }
  function updateNoticeBadge() {
    const badge = $("#notice-badge");
    if (badge) {
      const n = noticeUnreadList.length;
      badge.textContent = String(n);
      badge.classList.toggle("hidden", n === 0);
    }
  }
  async function loadHistory() {
    if (noticeHistoryList.length) return;
    try { noticeHistoryList = await SB.listAllPublishedAnnouncements().catch(() => []); } catch (e) { noticeHistoryList = []; }
  }
  async function openNoticeModal() {
    const modal = $("#notice-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    await renderNoticeBody();
  }
  function closeNoticeModal() {
    const modal = $("#notice-modal");
    if (modal) modal.classList.add("hidden");
  }
  async function renderNoticeBody() {
    const body = $("#notice-modal-body");
    if (!body) return;
    document.querySelectorAll(".notice-tab-btn").forEach(b => {
      b.classList.toggle("active", b.getAttribute("data-ntab") === noticeTabActive);
    });
    if (noticeTabActive === "unread") {
      if (!noticeUnreadList.length) { body.innerHTML = "<div class='notice-empty'>暂无未读公告</div>"; return; }
      body.innerHTML = "";
      noticeUnreadList.forEach(a => body.appendChild(buildNoticeCard(a, true)));
      return;
    }
    await loadHistory();
    if (!noticeHistoryList.length) { body.innerHTML = "<div class='notice-empty'>暂无历史公告</div>"; return; }
    body.innerHTML = "";
    noticeHistoryList.forEach(a => {
      const isUnread = noticeUnreadList.some(u => u && String(u.id) === String(a.id));
      body.appendChild(buildNoticeCard(a, isUnread));
    });
  }
  function buildNoticeCard(a, isUnread) {
    const card = document.createElement("div");
    card.className = "notice-card" + (isUnread ? " unread" : "");
    const head = document.createElement("button");
    head.type = "button";
    head.className = "notice-card-head";
    head.innerHTML = "<span class='notice-dot'></span><span class='notice-card-title'></span><span class='notice-card-time'></span><span class='notice-card-arrow'>↗</span>";
    head.querySelector(".notice-card-title").textContent = a.title || "公告";
    head.querySelector(".notice-card-time").textContent = fmtTime(a.created_at);
    head.onclick = async () => {
      openNoticeReader(a);
      if (isUnread) {
        card.classList.remove("unread");
        try {
          await SB.markAnnouncementRead(a.id);
          noticeUnreadList = noticeUnreadList.filter(u => !u || String(u.id) !== String(a.id));
          updateNoticeBadge();
        } catch (e) {}
      }
    };
    card.appendChild(head);
    return card;
  }

  function openNoticeReader(a) {
    const wrap = document.getElementById("notice-reader");
    if (!wrap) return;
    const titleEl = document.getElementById("notice-reader-title");
    const metaEl = document.getElementById("notice-reader-meta");
    const bodyEl = document.getElementById("notice-reader-body");
    if (titleEl) titleEl.textContent = a.title || "公告";
    if (metaEl) metaEl.textContent = "发布于 " + fmtTime(a.created_at);
    if (bodyEl) {
      bodyEl.innerHTML = "";
      const raw = (a.content || "");
      const txt = document.createElement("div");
      txt.className = "notice-rich";
      if (/^<(p|h\d|div|ul|ol|blockquote|img|table|span|strong|em|u|s|b|br)/i.test(raw.trim())) {
        const tmp = document.createElement("div");
        tmp.innerHTML = raw;
        tmp.querySelectorAll("img").forEach(im => {
          const s = im.getAttribute("src") || "";
          if (s && s.indexOf("http") !== 0) im.src = SB.noticeImageUrl(s);
          im.loading = "lazy";
        });
        txt.appendChild(tmp);
      } else {
        txt.textContent = raw;
      }
      bodyEl.appendChild(txt);
      const imgs = a.images || [];
      if (imgs.length) {
        const fig = document.createElement("div");
        fig.className = "notice-card-imgs reader-imgs";
        imgs.forEach(p => {
          const im = document.createElement("img");
          im.alt = "";
          im.src = SB.noticeImageUrl(p);
          im.loading = "lazy";
          fig.appendChild(im);
        });
        bodyEl.appendChild(fig);
      }
    }
    wrap.classList.remove("hidden");
  }

  function closeNoticeReader() {
    const wrap = document.getElementById("notice-reader");
    if (wrap) wrap.classList.add("hidden");
  }
  function fmtTime(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const p = n => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) { return ""; }
  }

  function setupAntiDownload() {
    document.addEventListener("contextmenu", (e) => {
      if (["IMG", "CANVAS", "IFRAME"].includes(e.target.tagName)) e.preventDefault();
    });
    document.addEventListener("dragstart", (e) => {
      if (["IMG", "CANVAS", "IFRAME"].includes(e.target.tagName)) e.preventDefault();
    });
    let lp = null;
    document.addEventListener("touchstart", (e) => {
      if (["IMG", "CANVAS"].includes(e.target.tagName)) lp = setTimeout(() => e.preventDefault(), 400);
    }, { passive: false });
    document.addEventListener("touchend", () => clearTimeout(lp));
    document.addEventListener("touchmove", () => clearTimeout(lp));
    document.addEventListener("selectstart", (e) => {
      if (["IMG", "CANVAS"].includes(e.target.tagName)) e.preventDefault();
    });
    document.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ["s", "p", "u"].includes(k)) e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === "s") e.preventDefault();
    });
  }

  async function refreshUI() {
    if (window.__loggedIn) { showTrend(); } else { showLogin(); }
  }
  function showLogin() {
    $("#login-view").classList.remove("hidden");
    $("#trend-view").classList.add("hidden");
    $("#logout-btn").classList.add("hidden");
  }
  function showMain() {
    $("#login-view").classList.add("hidden");
    $("#logout-btn").classList.remove("hidden");
    const rec = location.hash === "#recruit";
    $("#trend-view").classList.toggle("hidden", rec);
    $("#recruit-view").classList.toggle("hidden", !rec);
    const brand = $("#front-brand");
    if (brand) brand.textContent = (CONFIG.siteTitle || "图片图鉴") + (rec ? " · 招品回品" : " · 趋势专区");
    document.title = (CONFIG.siteTitle || "图片图鉴") + (rec ? " · 招品回品" : " · 趋势专区");
    document.querySelectorAll(".top-tabs [data-viewtab]").forEach(a => a.classList.toggle("active", (a.dataset.viewtab === "trend") !== rec));
    if (rec) loadRecruitView(); else loadTrends();
  }
  function showTrend() { showMain(); }
  function goRecruit(e) {
    if (e) { e.preventDefault(); }
    location.hash = "recruit";
    showMain();
  }
  function goTrend(e) {
    if (e) { e.preventDefault(); }
    location.hash = "";
    showMain();
  }

  async function onLogin(e) {
    e.preventDefault();
    const email = $("#auth-email").value.trim();
    const pass = $("#auth-pass").value;
    if (!email || !pass) return toast("请填写邮箱和密码", false);
    try {
      const { data, error } = await SB.signIn(email, pass);
      if (error) throw error;
      window.__loggedIn = true;
      toast("登录成功");
      showTrend();
    } catch (err) {
      toast("登录失败：" + (err.message || "请检查邮箱密码"), false);
    }
  }

  async function onLogout() {
    try {
      await SB.signOut();
      window.__loggedIn = false;
      toast("已退出");
      showLogin();
    } catch (e) {
      toast("退出失败", false);
    }
  }

  async function loadTrends() {
    try {
      trends = await SB.listTrends();
      const active = await SB.listActiveCats().catch(() => []);
      const activeArr = (active || []).map(c => (typeof c === "string" ? c : (c && c.name) || ""));
      const used = [...new Set(trends.map(t => t.category || "").filter(Boolean))];
      shownCats = activeArr.filter(c => used.includes(c));
      renderCatMenu();
      renderList();
    } catch (e) {
      toast("加载趋势失败，请检查网络", false);
    }
  }

  function renderCatMenu() {
    const menu = $("#cat-menu");
    if (!menu) return;
    menu.innerHTML = "";
    ["全部"].concat(shownCats).forEach(c => {
      const b = document.createElement("button");
      b.className = "cat-menu-item" + (c === curCat ? " active" : "");
      b.textContent = c;
      b.onclick = () => { curCat = c; renderCatMenu(); renderList(); };
      menu.appendChild(b);
    });
  }

  function renderList() {
    const list = trends.filter(t =>
      (curTag === "全部" || t.tag === curTag) &&
      (curCat === "全部" || !curCat || t.category === curCat)
    );
    const box = $("#trend-list");
    if (!box) return;
    box.innerHTML = "";
    $("#trend-empty").classList.toggle("hidden", list.length > 0);
    list.forEach(t => {
      const card = document.createElement("div");
      card.className = "trend-card tc-grid";
      const cov = document.createElement("div");
      cov.className = "trend-card-cover";
      if (t.cover) {
        cov.classList.add("img");
        SB.trendCoverUrl(t.cover).then(u => {
          const im = document.createElement("img");
          im.src = u; im.alt = ""; im.draggable = false; im.loading = "lazy";
          im.addEventListener("contextmenu", (e) => e.preventDefault());
          cov.appendChild(im);
        }).catch(() => {});
      } else {
        cov.innerHTML = '<span class="tcov-ic">PDF</span>';
      }
      const body = document.createElement("div");
      body.className = "trend-card-body";
      const title = document.createElement("div");
      title.className = "trend-card-title";
      title.textContent = t.title || "未命名";
      const meta = document.createElement("div");
      meta.className = "trend-card-meta";
      meta.innerHTML = '<span class="trend-tag">' + escapeHtml(t.tag || "") + '</span>' +
        (t.category ? '<span class="trend-tag trend-cat">' + escapeHtml(t.category) + '</span>' : '');
      body.appendChild(title);
      if (t.description) {
        const d = document.createElement("div");
        d.className = "trend-card-desc";
        d.textContent = t.description;
        body.appendChild(d);
      }
      body.appendChild(meta);
      const open = document.createElement("button");
      open.className = "btn-ghost trend-open";
      open.textContent = "预览";
      open.addEventListener("click", () => openPdf(t));
      card.appendChild(cov);
      card.appendChild(body);
      card.appendChild(open);
      box.appendChild(card);
    });
  }

  async function loadRecruitView() {
    try {
      recruitCurUid = "";
      try { const sess = await SB.getSession(); recruitCurUid = (sess && sess.user && sess.user.id) || ""; } catch (e) {}
      recruitTasks = await SB.listRecruitTasks();
      recruitSubs = await SB.listAllRecruitSubmissions().catch(() => []);
      renderRecruitCards();
    } catch (e) {
      toast("加载招品失败", false);
    }
  }
  function recruitSubsFor(taskId) {
    return recruitSubs.filter(s => s.recruit_task_id === taskId);
  }
  function renderRecruitCards() {
    const box = $("#recruit-list");
    if (!box) return;
    box.innerHTML = "";
    if (!recruitTasks.length) {
      box.innerHTML = '<p class="empty-tip">暂无招品任务。</p>';
      return;
    }
    recruitTasks.forEach((t, idx) => {
      const mySub = recruitSubsFor(t.id).find(s => s.user_id === recruitCurUid);
      const mySpus = (mySub && mySub.spus) ? mySub.spus.filter(Boolean) : [];
      const seq = idx + 1;
      const card = document.createElement("div");
      card.className = "recruit-card";
      card.innerHTML =
        '<div class="recruit-img"><span class="recruit-no"></span>' + (mySpus.length ? '<span class="recruit-done">已上传</span>' : '') + '</div>' +
        '<div class="recruit-body">' +
          '<div class="recruit-spu-sub"></div>' +
          '<div class="recruit-form hidden">' +
            '<input class="recruit-spu-input" placeholder="填写货品SPU，多个用英文逗号分隔">' +
            '<button type="button" class="btn-primary rec-save">保存</button>' +
          '</div>' +
          '<div class="recruit-ops">' +
            '<button type="button" class="btn-ghost rec-upload">上传货品SPU</button>' +
            '<button type="button" class="btn-ghost rec-edit">编辑</button>' +
          '</div>' +
        '</div>';
      const img = card.querySelector(".recruit-img");
      card.querySelector(".recruit-no").textContent = seq;
      if (t.image_path) {
        SB.recruitImageUrl(t.image_path).then(u => { if (!img.dataset.loaded) { img.style.backgroundImage = "url('" + u + "')"; img.dataset.loaded = "1"; } }).catch(() => { if (!img.dataset.loaded) img.innerHTML = '<span class="rtip">图</span>'; });
      } else {
        img.innerHTML = '<span class="rtip">图</span>';
      }
      const subEl = card.querySelector(".recruit-spu-sub");
      if (mySpus.length) { subEl.textContent = "我已上传 " + mySpus.length + " 个SPU"; } else { subEl.textContent = "尚未上传货品SPU"; }
      const tip = mySpus.length ? ("我上传的货品SPU：\n" + mySpus.join("\n")) : "尚未上传货品SPU";
      img.title = tip;
      const form = card.querySelector(".recruit-form");
      const ops = card.querySelector(".recruit-ops");
      const inp = card.querySelector(".recruit-spu-input");
      const openForm = (prefill) => {
        inp.value = mySpus.length && prefill ? mySpus.join(",") : "";
        ops.classList.add("hidden");
        form.classList.remove("hidden");
        inp.focus();
      };
      card.querySelector(".rec-upload").addEventListener("click", () => openForm(false));
      card.querySelector(".rec-edit").addEventListener("click", () => openForm(true));
      card.querySelector(".rec-save").addEventListener("click", () => saveMySpu(t, card, ops, form));
      box.appendChild(card);
    });
  }
  async function saveMySpu(t, card, ops, form) {
    const inp = card.querySelector(".recruit-spu-input");
    const raw = inp ? inp.value.trim() : "";
    if (!raw) return toast("请填写货品SPU", false);
    const spus = raw.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);
    if (!spus.length) return toast("请填写货品SPU", false);
    try {
      await SB.upsertRecruitSubmission(t.id, spus);
      toast("已保存 " + spus.length + " 个SPU");
      loadRecruitView();
    } catch (e) {
      toast("保存失败：" + (e.message || ""), false);
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // 受控预览：登录后经 Worker 取 PDF 二进制，用 pdf.js 自绘渲染（无任何下载/打印按钮），防下载
  async function openPdf(t) {
    try {
      if (!window.pdfjsLib) { toast("预览组件未就绪，请刷新重试", false); return; }
      closePdf();
      $("#pdf-title").textContent = t.title || "预览";
      $("#pdf-modal").classList.remove("hidden");
      const loading = $("#pdf-loading");
      loading.textContent = "正在加载预览…";
      loading.classList.remove("hidden");
      const url = await SB.trendPreviewUrl(t.path);
      const res = await fetch(url);
      if (!res.ok) throw new Error("load");
      const buf = await res.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      pdfDoc = pdf;
      pdfPage = 1;
      pdfScale = 1.0;
      await renderPdfPage();
      loading.classList.add("hidden");
    } catch (e) {
      const loading = $("#pdf-loading");
      if (loading) { loading.textContent = "预览加载失败，请稍后重试"; loading.classList.remove("hidden"); }
      toast("预览打开失败", false);
    }
  }

  async function renderPdfPage() {
    if (!pdfDoc || pdfRendering) return;
    pdfRendering = true;
    try {
      const page = await pdfDoc.getPage(pdfPage);
      const vp1 = page.getViewport({ scale: 1 });
      const base = Math.min(1.4, 900 / vp1.width);
      const vp = page.getViewport({ scale: pdfScale * base });
      const canvas = $("#pdf-canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.display = "block";
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      $("#pdf-page").textContent = pdfPage + " / " + pdfDoc.numPages;
      $("#pdf-zoom").textContent = Math.round(pdfScale * 100) + "%";
      const prev = $("#pdf-prev"), next = $("#pdf-next");
      if (prev) prev.disabled = pdfPage <= 1;
      if (next) next.disabled = pdfPage >= pdfDoc.numPages;
    } finally {
      pdfRendering = false;
    }
  }

  function goPage(d) {
    if (!pdfDoc) return;
    const n = pdfPage + d;
    if (n < 1 || n > pdfDoc.numPages) return;
    pdfPage = n;
    renderPdfPage();
  }

  function setPdfZoom(z) {
    if (!pdfDoc) return;
    pdfScale = Math.min(3, Math.max(0.5, z));
    renderPdfPage();
  }

  function closePdf() {
    $("#pdf-modal").classList.add("hidden");
    if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) {} }
    pdfDoc = null;
    const canvas = $("#pdf-canvas");
    if (canvas) canvas.style.display = "none";
  }
})();