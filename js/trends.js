/* ============================================================
 * 趋势专区前台逻辑：登录校验 + 类目/月度/周度筛选 + 趋势文件列表 + 受控PDF预览 + 防下载
 * ============================================================ */
(function () {
  const $ = (sel) => document.querySelector(sel);

  let curTag = "全部";
  let curCat = "全部";
  let trends = [];
  let shownCats = [];

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
      if (e.target.tagName === "IMG" || e.target.tagName === "IFRAME") e.preventDefault();
    });
    let lp = null;
    document.addEventListener("touchstart", (e) => {
      if (e.target.tagName === "IMG") lp = setTimeout(() => e.preventDefault(), 400);
    }, { passive: false });
    document.addEventListener("touchend", () => clearTimeout(lp));
    document.addEventListener("touchmove", () => clearTimeout(lp));
    document.addEventListener("selectstart", (e) => {
      if (e.target.tagName === "IMG") e.preventDefault();
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