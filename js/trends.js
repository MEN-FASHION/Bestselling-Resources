/* ============================================================
 * 趋势专区前台逻辑：登录校验 + 类目/月度/周度筛选 + 趋势文件列表 + 受控PDF预览 + 防下载
 * ============================================================ */
(function () {
  const $ = (sel) => document.querySelector(sel);

  let curTag = "全部";
  let trends = [];

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

    // 趋势专区始终需登录 —— 监听登录态
    SB.onAuth((session) => {
      window.__loggedIn = !!session;
      refreshUI();
    });

    $("#login-form").addEventListener("submit", onLogin);
    $("#logout-btn").onclick = onLogout;
    $("#pdf-close").onclick = closePdf;
    $("#pdf-modal").addEventListener("click", (e) => { if (e.target.id === "pdf-modal") closePdf(); });

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
  });

  function setupAntiDownload() {
    document.addEventListener("contextmenu", (e) => {
      if (e.target.tagName === "IMG" || e.target.tagName === "IFRAME") e.preventDefault();
    });
    document.addEventListener("dragstart", (e) => {
      if (e.target.tagName === "IMG") e.preventDefault();
    });
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") e.preventDefault();
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
  function showTrend() {
    $("#login-view").classList.add("hidden");
    $("#trend-view").classList.remove("hidden");
    $("#logout-btn").classList.remove("hidden");
    loadTrends();
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
      renderList();
    } catch (e) {
      toast("加载趋势失败，请检查网络", false);
    }
  }

  function renderList() {
    const list = trends.filter(t => curTag === "全部" || t.tag === curTag);
    const box = $("#trend-list");
    box.innerHTML = "";
    $("#trend-empty").classList.toggle("hidden", list.length > 0);
    list.forEach(t => {
      const card = document.createElement("div");
      card.className = "trend-card";
      const icon = t.file_type === "pdf" ? "PDF" : "DOC";
      card.innerHTML =
        '<div class="trend-card-icon">' + icon + '</div>' +
        '<div class="trend-card-body">' +
          '<div class="trend-card-title"></div>' +
          '<div class="trend-card-meta"><span class="trend-tag">' + escapeHtml(t.tag || "") + '</span></div>' +
        '</div>' +
        '<button class="btn-ghost trend-open">预览</button>';
      card.querySelector(".trend-card-title").textContent = t.title || "未命名";
      card.querySelector(".trend-open").addEventListener("click", () => openPdf(t));
      box.appendChild(card);
    });
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // 受控预览：带上当前登录令牌，由 Worker 鉴权后内联返回 PDF，不暴露 R2 直链，防下载
  async function openPdf(t) {
    try {
      const frame = $("#pdf-frame");
      frame.src = "";
      $("#pdf-title").textContent = t.title || "预览";
      $("#pdf-modal").classList.remove("hidden");
      const url = await SB.trendPreviewUrl(t.path);
      frame.src = url;
      toast("正在打开预览…");
    } catch (e) {
      toast("预览打开失败", false);
    }
  }
  function closePdf() {
    $("#pdf-modal").classList.add("hidden");
    $("#pdf-frame").src = "";
  }
})();