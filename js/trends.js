/* ============================================================
 * 趋势专区前台逻辑：登录校验 + 类目/月度/周度筛选 + 趋势文件列表 + 受控PDF预览 + 防下载
 * ============================================================ */
(function () {
  const $ = (sel) => document.querySelector(sel);

  let curTag = "全部";
  let curCat = "全部";
  let authMode = "register"; // 登录页模式：默认注册页面 register 注册 / login 登录
  let trends = [];
  let shownCats = [];
  // PDF 自绘预览状态
  let pdfDoc = null, pdfPage = 1, pdfScale = 1.0, pdfRendering = false;
  let recruitTasks = [];   // 招品任务清单
  let recruitSubs = [];    // 全部提交（前台悬浮显示用）
  let recruitCurUid = "";  // 当前登录商家 ID（前台只看自己的提交）
  let recruitCats = [];    // 招品专区类目（独立于趋势类目）
  let recruitCat = "全部"; // 招品当前选中类目
  let bestsellerTasks = [];   // BESTSELLER 任务清单
  let bestsellerSubs = [];    // 全部提交
  let bestsellerCurUid = "";  // 当前登录商家 ID
  let bestsellerCats = [];    // BESTSELLER 专区类目
  let bestsellerCat = "全部"; // BESTSELLER 当前选中类目
  let catVisibility = {};    // 各专区各类目是否前台可见
  // —— 分享预览（方案A）：管理员分享类目链接，未登录可浏览该类目缩略图 ——
  const shareQ = new URLSearchParams(location.search);
  const shareZone = shareQ.get("zone");
  const shareCat = (shareQ.get("cat") || "").trim();
  // 是否带分享类目目标（与登录态无关）：用于定位专区/类目
  const hasShareTarget = () => !!shareCat && (shareZone === "recruit" || shareZone === "bestseller");
  // 未登录时的分享预览模式：仅显示缩略图 + 登录引导
  const isSharePreview = () => !window.__loggedIn && hasShareTarget();

  function toast(msg, ok = true) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.style.background = ok ? "rgba(34,47,38,.92)" : "rgba(120,40,38,.92)";
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // 登录横幅：仅招品回品 / BESTSELLER 专区显示，趋势/视觉专区不显示
  function setBanner(visible) {
    const b = document.getElementById("login-banner");
    if (!b) return;
    b.classList.toggle("hidden", !visible || !!window.__loggedIn);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#site-title").textContent = CONFIG.siteTitle || "TREND BANK";
    document.title = (CONFIG.siteTitle || "TREND BANK") + " · 趋势专区";
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }

    // 趋势专区始终需登录 —— 监听登录态
    SB.onAuth((session) => {
      window.__loggedIn = !!session;
      refreshUI();
    });
    // 兜底：异常情况下最多等3s后揭开遮罩
    setTimeout(hideSplash, 3000);

    $("#login-form").addEventListener("submit", onLogin);
    bindEmailSuggest();
    const authToggle = $("#auth-toggle-link");
    if (authToggle) authToggle.addEventListener("click", (e) => {
      e.preventDefault();
      authMode = authMode === "login" ? "register" : "login";
      applyAuthMode();
    });
    applyAuthMode(); // 初始渲染：默认注册界面
    $("#logout-btn").onclick = onLogout;
    // 登入横幅"立即登录"→ 进入登录页
    const lbGoto = document.getElementById("lb-goto");
    if (lbGoto) lbGoto.addEventListener("click", (e) => { e.preventDefault(); showLogin(); });
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
      else if (a.dataset.viewtab === "bestseller") a.addEventListener("click", goBestseller);
      else if (a.dataset.viewtab === "trend") a.addEventListener("click", goTrend);
    });
    window.addEventListener("hashchange", () => showMain());

    // 未登录：点击跳转"视觉专区/返回视觉专区"(index.html)时强制回登录页，不允许跳到视觉专区
    document.querySelectorAll('a[href="index.html"]').forEach(a => {
      a.addEventListener("click", (e) => {
        if (window.__loggedIn) return; // 已登录正常跳转
        e.preventDefault();
        showLogin(); // 未登录一律回登录
      });
    });

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

  // 前台图片"观看无印、下载带水印"：把图片绘制到 canvas 并叠加品牌水印后下载。
  // 页面展示仍用原图（无水印），仅当用户触发下载（右键等）时生成带水印版。
  function downloadWatermarked(src, filename) {
    if (!src) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return;
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        // 低调水印：顶部来源标注 + 右下角站名，均横向、半透明、不铺满
        const fsTop = Math.max(14, Math.round(Math.min(w, h) * 0.032));
        const fsCorner = Math.max(12, Math.round(Math.min(w, h) * 0.024));
        // 顶部居中横幅：图片来源网络 · 仅供参考学习
        ctx.font = "500 " + fsTop + "px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(255,255,255,0.38)";
        ctx.strokeStyle = "rgba(0,0,0,0.12)";
        ctx.lineWidth = 1;
        const topTxt = "图片来源网络 · 仅供参考学习";
        const topY = Math.max(8, Math.round(h * 0.02));
        ctx.strokeText(topTxt, w / 2, topY);
        ctx.fillText(topTxt, w / 2, topY);
        // 底部居中横幅：newtrend.top
        ctx.font = "500 " + fsCorner + "px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillStyle = "rgba(255,255,255,0.38)";
        ctx.strokeStyle = "rgba(0,0,0,0.12)";
        ctx.lineWidth = 1;
        const cornerTxt = "newtrend.top";
        const cx = w / 2;
        const cy = h - Math.max(12, Math.round(h * 0.035));
        ctx.strokeText(cornerTxt, cx, cy);
        ctx.fillText(cornerTxt, cx, cy);
        c.toBlob((blob) => {
          if (!blob) return;
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = (filename.replace(/[\\/:*?"<>|]/g, "_") || "image") + ".png";
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 600);
        }, "image/png");
      } catch (err) { /* 水印失败则静默 */ }
    };
    img.onerror = () => {};
    img.src = src; // 保留完整 src（含鉴权 token 或 blob: 地址）
  }

  function setupAntiDownload() {
    document.addEventListener("contextmenu", (e) => {
      if (e.target.tagName === "IMG") {
        e.preventDefault();
        // 右键图片：屏蔽系统"另存为"，改为下载带水印版
        downloadWatermarked(e.target.currentSrc || e.target.src, e.target.alt || "image");
      } else if (["CANVAS", "IFRAME"].includes(e.target.tagName)) {
        e.preventDefault();
      }
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

  function hideSplash() {
    const s = document.getElementById("boot-splash");
    if (s) s.classList.add("hidden");
  }

  async function refreshUI() {
    if (window.__loggedIn) { showTrend(); } else if (isSharePreview()) {
      // 分享预览（方案A）：未登录但带 ?zone= & cat= ，直接进入分享专区显示缩略图
      showMain();
    } else { showLogin(); }
    hideSplash();
  }
  function applyAuthMode() {
    const toggle = $("#auth-toggle-link");
    if (toggle) toggle.textContent = authMode === "login" ? "没有账号？注册一个" : "已有账号？去登录";
    const t = $("#auth-title"); if (t) t.textContent = authMode === "login" ? "趋势专区登录" : "注册账号";
    const s = $("#auth-submit"); if (s) s.textContent = authMode === "login" ? "进入趋势专区" : "注册并进入";
  }
  function showAuthHint(msg) {
    const h = $("#auth-hint");
    if (h) { h.textContent = msg; h.classList.remove("hidden"); }
  }
  function hideAuthHint() {
    const h = $("#auth-hint");
    if (h) h.classList.add("hidden");
  }
  // 邮箱输入 @ 后弹出常用域名，帮助快速补全
  function bindEmailSuggest() {
    const EMAIL_DOMAINS = ["gmail.com", "outlook.com", "qq.com", "163.com", "126.com", "hotmail.com", "foxmail.com", "sina.com"];
    const input = $("#auth-email");
    const box = document.getElementById("email-suggest");
    if (!input || !box) return;
    const hide = () => { box.classList.add("hidden"); box.innerHTML = ""; };
    const apply = (d) => {
      const cur = input.value;
      const at = cur.lastIndexOf("@");
      if (at >= 0) {
        input.value = cur.slice(0, at + 1) + d;
        try { input.setSelectionRange(cur.length, cur.length); } catch (e) {}
        input.focus();
      }
      hide();
    };
    input.addEventListener("input", () => {
      const v = input.value;
      const at = v.lastIndexOf("@");
      if (at < 0) { hide(); return; }
      const tail = v.slice(at + 1).toLowerCase();
      if (tail.indexOf(".") >= 0 || tail.length > 0 && /[\s@]/.test(tail)) { hide(); return; }
      const matched = EMAIL_DOMAINS.filter(d => d.indexOf(tail) === 0);
      if (!matched.length) { hide(); return; }
      box.innerHTML = "";
      matched.forEach(d => {
        const el = document.createElement("div");
        el.textContent = d;
        el.addEventListener("mousedown", (e) => { e.preventDefault(); apply(d); });
        box.appendChild(el);
      });
      box.classList.remove("hidden");
    });
    input.addEventListener("blur", () => setTimeout(hide, 160));
    document.addEventListener("click", (e) => { if (box.contains(e.target)) return; hide(); });
    // 登录/注册成功后、以及进入登录页时清空联想
    window.addEventListener("beforeunload", hide);
  }
  function showLogin() {
    authMode = "register";
    applyAuthMode();
    hideAuthHint();
    $("#login-view").classList.remove("hidden");
    $("#trend-view").classList.add("hidden");
    $("#recruit-view").classList.add("hidden");
    $("#bestseller-view").classList.add("hidden");
    $("#logout-btn").classList.add("hidden");
    // 登录页隐藏顶部导航栏，避免专区菜单残留
    const tb = document.getElementById("front-topbar");
    if (tb) tb.classList.add("hidden");
    setBanner(false);
  }
  function showMain() {
    $("#login-view").classList.add("hidden");
    $("#logout-btn").classList.remove("hidden");
    // 进入专区恢复顶部导航栏
    const tb = document.getElementById("front-topbar");
    if (tb) tb.classList.remove("hidden");
    const hash = (location.hash || "").replace("#", "");
    let rec = hash === "recruit";
    let bs = hash === "bestseller";
    // 分享目标：URL 带 ?zone= & cat= 且当前未设置分区 hash（首次进入分享链接）时，
    // 定位到对应专区与类目；用户点击顶栏切换置入 hash 后，优先按 hash 跳转，分享目标不再覆盖。
    const isFreshShareEntry = hash === "" && hasShareTarget();
    if (isFreshShareEntry && shareZone === "recruit") { rec = true; bs = false; }
    else if (isFreshShareEntry && shareZone === "bestseller") { rec = false; bs = true; }
    if (isFreshShareEntry && shareCat) {
      if (shareZone === "recruit") recruitCat = shareCat;
      else if (shareZone === "bestseller") bestsellerCat = shareCat;
    }
    $("#trend-view").classList.toggle("hidden", rec || bs);
    $("#recruit-view").classList.toggle("hidden", !rec);
    $("#bestseller-view").classList.toggle("hidden", !bs);
    const brand = $("#front-brand");
    const zoneName = bs ? " · BESTSELLER" : (rec ? " · 招品回品" : " · 趋势专区");
    if (brand) brand.textContent = (CONFIG.siteTitle || "TREND BANK") + zoneName;
    document.title = (CONFIG.siteTitle || "TREND BANK") + zoneName;
    const activeTab = bs ? "bestseller" : (rec ? "recruit" : "trend");
    document.querySelectorAll(".top-tabs [data-viewtab]").forEach(a => a.classList.toggle("active", a.dataset.viewtab === activeTab));
    if (rec) loadRecruitView(); else if (bs) loadBestsellerView(); else loadTrends();
    // 横幅仅招品回品 / BESTSELLER 显示
    setBanner(rec || bs);
  }
  function showTrend() { showMain(); }
  // 未登录：仅当跳转目标是"分享目标专区"时才放行，否则回登录页
  function guardZone(zone) {
    if (window.__loggedIn) return true;
    // 分享预览仅在分享目标专区放行；趋势专区/其它专区一律回登录
    if (zone === "trend") { showLogin(); return false; }
    if (hasShareTarget() && shareZone === zone) return true;
    showLogin();
    return false;
  }
  function goRecruit(e) {
    if (e) { e.preventDefault(); }
    if (!guardZone("recruit")) return;
    location.hash = "recruit";
    showMain();
  }
  function goBestseller(e) {
    if (e) { e.preventDefault(); }
    if (!guardZone("bestseller")) return;
    location.hash = "bestseller";
    showMain();
  }
  function goTrend(e) {
    if (e) { e.preventDefault(); }
    if (!guardZone("trend")) return;
    location.hash = "";
    showMain();
  }

  async function onLogin(e) {
    e.preventDefault();
    const email = $("#auth-email").value.trim();
    const pass = $("#auth-pass").value;
    if (!email || !pass) return toast("请填写邮箱和密码", false);
    try {
      if (authMode === "register") {
        const { data, error } = await SB.signUp(email, pass);
        if (error) throw error;
        if (data && data.session) {
          // 后台未开启邮箱确认 → 直接自动登录
          window.__loggedIn = true;
          toast("注册成功，已登录");
          showTrend();
        } else {
          // 后台开启了邮箱确认（Confirm email）→ 需点邮件链接激活
          toast("注册成功！请前往邮箱确认", true);
          showAuthHint("确认邮件已发送至 " + email + "，请点击邮件中的链接激活账号后再登录。若未收到，请检查垃圾邮件。");
          authMode = "login";
          applyAuthMode();
        }
        return;
      }
      const { data, error } = await SB.signIn(email, pass);
      if (error) {
        // 区分"账号错误 / 密码错误"：先判断该邮箱是否已注册
        let exists = null;
        try { exists = await SB.isEmailRegistered(email); } catch (e2) { exists = null; }
        if (exists === false) {
          toast("账号错误：该邮箱未注册，请先注册", false);
        } else if (exists === true) {
          toast("密码错误：请检查密码后重试", false);
        } else {
          toast("登录失败：" + (error.message || "请检查邮箱密码"), false);
        }
        return;
      }
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
      try { catVisibility = await SB.getFrontendCatVisibility(); } catch (e) { catVisibility = {}; }
      trends = await SB.listTrends();
      const active = await SB.listActiveCats().catch(() => []);
      const activeArr = (active || []).map(c => (typeof c === "string" ? c : (c && c.name) || ""));
      const used = [...new Set(trends.map(t => t.category || "").filter(Boolean))];
      shownCats = activeArr.filter(c => used.includes(c) && catCatVisible("trend", c));
      renderCatMenu();
      renderList();
    } catch (e) {
      toast("加载趋势失败，请检查网络", false);
    }
  }

  // 某专区某类目是否前台可见（未配置默认可见）
  function catCatVisible(zone, cat) {
    const m = catVisibility && catVisibility[zone];
    return !m || m[cat] !== false;
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
      catCatVisible("trend", t.category) &&
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
      try { catVisibility = await SB.getFrontendCatVisibility(); } catch (e) { catVisibility = {}; }
      recruitCurUid = "";
      try { const sess = await SB.getSession(); recruitCurUid = (sess && sess.user && sess.user.id) || ""; } catch (e) {}
      [recruitTasks, recruitSubs, recruitCats] = await Promise.all([
        SB.listRecruitTasks({ status: "published" }),  // 前台只显示已发布
        SB.listAllRecruitSubmissions().catch(() => []),
        SB.listZoneCats("recruit").catch(() => []),
      ]);
      // 后台标记「无需回品」的任务前台不展示
      recruitTasks = recruitTasks.filter(t => !t.flag_no_refill);
      renderRecruitCatMenu();
      renderRecruitCards();
    } catch (e) {
      toast("加载招品失败", false);
    }
  }
  function renderRecruitCatMenu() {
    const menu = $("#recruit-cat-menu");
    if (!menu) return;
    const used = [...new Set(recruitTasks.map(t => t.category || "").filter(Boolean))];
    const cats = ["全部"].concat(recruitCats.map(c => c.name).filter(n => used.includes(n) && catCatVisible("recruit", n)));
    menu.innerHTML = "";
    cats.forEach(c => {
      const b = document.createElement("button");
      b.className = "cat-menu-item" + (c === recruitCat ? " active" : "");
      b.textContent = c;
      b.onclick = () => { recruitCat = c; renderRecruitCatMenu(); renderRecruitCards(); };
      menu.appendChild(b);
    });
  }
  function recruitSubsFor(taskId) {
    return recruitSubs.filter(s => s.recruit_task_id === taskId);
  }
  function renderRecruitCards() {
    const box = $("#recruit-list");
    if (!box) return;
    box.innerHTML = "";
    const list = recruitTasks.filter(t => catCatVisible("recruit", t.category) && (recruitCat === "全部" || !recruitCat || t.category === recruitCat));
    if (!list.length) {
      box.innerHTML = isSharePreview()
        ? '<div class="share-preview-tip">该分类暂无已发布内容。登录后查看全部招品任务。<a href="#recruit" onclick="location.hash=\"recruit\"">去登录</a></div>'
        : '<p class="empty-tip">该分类暂无招品任务。</p>';
      return;
    }
    list.forEach((t, idx) => {
      const mySub = recruitSubsFor(t.id).find(s => s.user_id === recruitCurUid);
      const mySpus = (mySub && mySub.spus) ? mySub.spus.filter(Boolean) : [];
      const seq = idx + 1;
      const card = document.createElement("div");
      card.className = "recruit-card";
      const previewMode = isSharePreview();
      card.innerHTML =
        '<div class="recruit-img">' +
          '<img class="recruit-thumb" alt="">' +
          '<span class="recruit-ph">图片加载中</span>' +
          '<span class="recruit-no"></span>' + (mySpus.length && !previewMode ? '<span class="recruit-done">已上传</span>' : '') +
        '</div>' +
        '<div class="recruit-body">' +
          (!previewMode
            ? '<div class="recruit-spu-sub"></div>' +
              '<div class="recruit-form hidden">' +
                '<input class="recruit-spu-input" placeholder="填写货品SPU，多个用英文逗号分隔">' +
                '<button type="button" class="btn-primary rec-save">保存</button>' +
              '</div>' +
              '<div class="recruit-ops">' +
                '<button type="button" class="btn-ghost rec-upload">上传货品SPU</button>' +
                '<button type="button" class="btn-ghost rec-edit">编辑</button>' +
              '</div>'
            : '<div class="recruit-share-cta">登录后查看高清与提交SPU <a href="#recruit">登录/注册</a></div>') +
        '</div>';
      const img = card.querySelector(".recruit-img");
      const im = card.querySelector(".recruit-thumb");
      const ph = card.querySelector(".recruit-ph");
      card.querySelector(".recruit-no").textContent = seq;
      if (t.image_path) {
        SB.recruitImageUrl(t.image_path).then(u => {
          im.onload = () => { im.style.opacity = "1"; ph.classList.add("hidden"); };
          im.onerror = () => { im.style.opacity = "0"; ph.textContent = "图片暂不可见"; };
          im.src = u;
        }).catch(() => { ph.textContent = "图片暂不可见"; });
      } else {
        ph.textContent = "暂无图片";
      }
      if (previewMode) {
        im.addEventListener("click", () => {
          location.hash = "recruit";
          toast("请登录后查看高清原图与提交SPU");
        });
        box.appendChild(card);
        return;
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
    const spus = raw.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);
    try {
      await SB.upsertRecruitSubmission(t.id, spus);
      toast(spus.length ? "已保存 " + spus.length + " 个SPU" : "已保存");
      loadRecruitView();
    } catch (e) {
      toast("保存失败：" + (e.message || ""), false);
    }
  }

  async function loadBestsellerView() {
    try {
      try { catVisibility = await SB.getFrontendCatVisibility(); } catch (e) { catVisibility = {}; }
      bestsellerCurUid = "";
      try { const sess = await SB.getSession(); bestsellerCurUid = (sess && sess.user && sess.user.id) || ""; } catch (e) {}
      [bestsellerTasks, bestsellerSubs, bestsellerCats] = await Promise.all([
        SB.listBestsellerTasks({ status: "published" }),
        SB.listAllBestsellerSubmissions().catch(() => []),
        SB.listZoneCats("bestseller").catch(() => []),
      ]);
      // 后台标记「无需回品」的任务前台不展示
      bestsellerTasks = bestsellerTasks.filter(t => !t.flag_no_refill);
      renderBestsellerCatMenu();
      renderBestsellerCards();
    } catch (e) { toast("加载BESTSELLER失败", false); }
  }
  function renderBestsellerCatMenu() {
    const menu = $("#bestseller-cat-menu");
    if (!menu) return;
    const used = [...new Set(bestsellerTasks.map(t => t.category || "").filter(Boolean))];
    const cats = ["全部"].concat(bestsellerCats.map(c => c.name).filter(n => used.includes(n) && catCatVisible("bestseller", n)));
    menu.innerHTML = "";
    cats.forEach(c => {
      const b = document.createElement("button");
      b.className = "cat-menu-item" + (c === bestsellerCat ? " active" : "");
      b.textContent = c;
      b.onclick = () => { bestsellerCat = c; renderBestsellerCatMenu(); renderBestsellerCards(); };
      menu.appendChild(b);
    });
  }
  function bestsellerSubsFor(taskId) {
    return bestsellerSubs.filter(s => s.bestseller_task_id === taskId);
  }
  function renderBestsellerCards() {
    const box = $("#bestseller-list");
    if (!box) return;
    box.innerHTML = "";
    const list = bestsellerTasks.filter(t => catCatVisible("bestseller", t.category) && (bestsellerCat === "全部" || !bestsellerCat || t.category === bestsellerCat));
    if (!list.length) {
      box.innerHTML = isSharePreview()
        ? '<div class="share-preview-tip">该分类暂无已发布内容。登录后查看全部BESTSELLER任务。<a href="#bestseller">去登录</a></div>'
        : '<p class="empty-tip">该分类暂无BESTSELLER任务。</p>';
      return;
    }
    list.forEach((t, idx) => {
      const mySub = bestsellerSubsFor(t.id).find(s => s.user_id === bestsellerCurUid);
      const mySpus = (mySub && mySub.spus) ? mySub.spus.filter(Boolean) : [];
      const seq = idx + 1;
      const card = document.createElement("div");
      card.className = "recruit-card";
      const previewMode = isSharePreview();
      card.innerHTML =
        '<div class="recruit-img">' +
          '<img class="recruit-thumb" alt="">' +
          '<span class="recruit-ph">图片加载中</span>' +
          '<span class="recruit-no"></span>' + (mySpus.length && !previewMode ? '<span class="recruit-done">已上传</span>' : '') +
          (!previewMode && t.url ? '<a class="recruit-ext" href="' + escapeHtml(t.url) + '" target="_blank" rel="noopener nofollow">🔗打开链接</a>' : '') +
          (previewMode ? '' : '<div class="bestseller-cinfo"><div class="bestseller-cinfo-inner"></div></div>') +
        '</div>' +
        '<div class="recruit-body">' +
          (!previewMode
            ? '<div class="recruit-spu-sub"></div>' +
              '<div class="recruit-form hidden">' +
                '<input class="recruit-spu-input" placeholder="填写货品SPU，多个用英文逗号分隔">' +
                '<button type="button" class="btn-primary rec-save">保存</button>' +
              '</div>' +
              '<div class="recruit-ops">' +
                '<button type="button" class="btn-ghost rec-upload">上传货品SPU</button>' +
                '<button type="button" class="btn-ghost rec-edit">编辑</button>' +
              '</div>'
            : '<div class="recruit-share-cta">登录后查看高清与提交SPU <a href="#bestseller">登录/注册</a></div>') +
        '</div>';
      const img = card.querySelector(".recruit-img");
      const im = card.querySelector(".recruit-thumb");
      const ph = card.querySelector(".recruit-ph");
      card.querySelector(".recruit-no").textContent = seq;
      if (t.main_img_url) {
        // 直接用主图URL显示
        im.onload = () => { im.style.opacity = "1"; ph.classList.add("hidden"); };
        im.onerror = () => { im.style.opacity = "0"; ph.textContent = "图片暂不可见"; };
        im.src = t.main_img_url;
      } else if (t.image_path) {
        SB.bestsellerImageUrl(t.image_path).then(u => {
          im.onload = () => { im.style.opacity = "1"; ph.classList.add("hidden"); };
          im.onerror = () => { im.style.opacity = "0"; ph.textContent = "图片暂不可见"; };
          im.src = u;
        }).catch(() => { ph.textContent = "图片暂不可见"; });
      } else { ph.textContent = "暂无图片"; }
      // 分享预览：只展示缩略图，隐藏商品信息/外链/SPU，点图弹登录
      if (previewMode) {
        im.addEventListener("click", () => {
          location.hash = "bestseller";
          toast("请登录后查看高清原图与提交SPU");
        });
        box.appendChild(card);
        return;
      }
      // 鼠标悬停图片展示商品信息（ID / SKUID / 站点 / 最新上榜时间）
      const cinfo = card.querySelector(".bestseller-cinfo");
      if (cinfo && (t.goods_id || t.sku_id || t.site || t.rank_time)) {
        const lines = [];
        if (t.goods_id) lines.push("ID：" + escapeHtml(t.goods_id));
        if (t.sku_id) lines.push("SKUID：" + escapeHtml(t.sku_id));
        if (t.site) lines.push("站点：" + escapeHtml(t.site));
        if (t.rank_time) lines.push("最新上榜时间：" + escapeHtml(t.rank_time));
        cinfo.querySelector(".bestseller-cinfo-inner").innerHTML = '<div class="bestseller-cinfo-t">信息</div>' + lines.map(l => '<div class="bestseller-cinfo-line">' + l + '</div>').join("");
      }
      // 点击图片跳转链接（main_img_url 外链或 url）
      if (img) {
        img.classList.add("bs-clickable");
      }
      const subEl = card.querySelector(".recruit-spu-sub");
      if (mySpus.length) { subEl.textContent = "我已上传 " + mySpus.length + " 个SPU"; } else { subEl.textContent = "尚未上传货品SPU"; }
      const tip = mySpus.length ? ("我上传的货品SPU：\n" + mySpus.join("\n")) : "尚未上传货品SPU";
      img.title = tip;
// 点击图片跳转链接（BESTSELLER 主图URL/链接）
      if (img) {
        img.style.cursor = t.url ? "pointer" : img.style.cursor;
        if (t.url) {
          img.addEventListener("click", () => { window.open(t.url, "_blank", "noopener,noreferrer"); });
        }
      }
      const form = card.querySelector(".recruit-form");
      const ops = card.querySelector(".recruit-ops");
      const inp = card.querySelector(".recruit-spu-input");
      const openForm = (prefill) => { inp.value = mySpus.length && prefill ? mySpus.join(",") : ""; ops.classList.add("hidden"); form.classList.remove("hidden"); inp.focus(); };
      card.querySelector(".rec-upload").addEventListener("click", () => openForm(false));
      card.querySelector(".rec-edit").addEventListener("click", () => openForm(true));
      card.querySelector(".rec-save").addEventListener("click", () => saveMyBsSpu(t, card));
      box.appendChild(card);
    });
  }
  async function saveMyBsSpu(t, card) {
    const inp = card.querySelector(".recruit-spu-input");
    const raw = inp ? inp.value.trim() : "";
    const spus = raw.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);
    try { await SB.upsertBestsellerSubmission(t.id, spus); toast(spus.length ? "已保存 " + spus.length + " 个SPU" : "已保存"); loadBestsellerView(); }
    catch (e) { toast("保存失败：" + (e.message || ""), false); }
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