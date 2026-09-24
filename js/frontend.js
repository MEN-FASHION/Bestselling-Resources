/* ============================================================
 * 前台逻辑：Supabase 登录/注册 + 左侧类目菜单 + 渠道/风格/元素标签筛选 + 图片网格 + 灯箱 + 防下载
 * ============================================================ */
(function () {
  const $ = (sel) => document.querySelector(sel);

  let currentCat = "全部";
  let curChannel = "";   // 渠道标签筛选
  let curStyle = "";     // 风格标签筛选
  let curElement = "";   // 元素标签筛选
  let curScene = "";     // 场景标签筛选
  let curShoot = "";     // 拍摄方式标签筛选
  let curSkin = "";      // 肤色标签筛选
  let lightboxList = [];
  let lightboxIdx = 0;
  let catalog = [];
  let galleryLoaded = false;
  let styleDefs = [];    // 风格标签定义
  let elementDefs = [];  // 元素标签定义
  let sceneDefs = [];    // 场景标签定义（室内/室外）
  let sceneGroupMap = {}; // 场景标签名 -> indoor/outdoor 二级分组映射
  let shootDefs = [];    // 拍摄方式标签定义
  let skinDefs = [];     // 肤色标签定义
  let dimSwitches = {};  // 各维度是否在前台展示
  let catVisibility = {}; // 各专区各类目是否前台可见
  let zoneVis = {};       // 各专区本身是否前台可见
  let myZones = null;      // 当前登录用户级可见专区白名单（null/空 = 未配置，回退全局）

  let activeCats = [];
  let usedCats = [];
  let shownCats = [];   // 有图且管理员展示的类目（用于顶栏类目筛选）
  let catCounts = {};   // 各类目图片数（类目筛选计数）

  const Auth = {
    toast(msg, ok = true) {
      const t = document.getElementById("toast");
      if (!t) return;
      t.textContent = msg;
      t.style.background = ok ? "rgba(34,47,38,.92)" : "rgba(120,40,38,.92)";
      t.classList.add("show");
      clearTimeout(t._timer);
      t._timer = setTimeout(() => t.classList.remove("show"), 2600);
    }
  };

/* ---------- 免责协议（首次确认 + 底部随时查看） ---------- */
  const legalKey = "btrLegalV1";
  let _legalOverlay = null, _legalClose = null, _legalAgree = null, _legalEnter = null;

  function _qtabs() {
    return _legalOverlay ? _legalOverlay.querySelectorAll(".legal-tab") : [];
  }
  function openLegal(mode, tab) {
    if (!_legalOverlay) return;
    if (mode === "view") {
      if (tab) {
        const t = _legalOverlay.querySelector('.legal-tab[data-ltab="' + tab + '"]');
        if (t) t.click();
      }
      if (_legalClose) _legalClose.classList.remove("hidden");
    } else {
      if (_legalClose) _legalClose.classList.add("hidden");
    }
    _legalOverlay.classList.remove("hidden");
  }
  function initLegal() {
    _legalOverlay = document.getElementById("legal-overlay");
    if (!_legalOverlay) return;
    _legalClose = document.getElementById("legal-close");
    _legalAgree = document.getElementById("legal-agree");
    _legalEnter = document.getElementById("legal-enter");

    _qtabs().forEach((tab) => {
      tab.addEventListener("click", () => {
        _qtabs().forEach((t) => t.classList.remove("active"));
        _legalOverlay.querySelectorAll(".legal-panel").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        const panel = _legalOverlay.querySelector('.legal-panel[data-lpanel="' + tab.dataset.ltab + '"]');
        if (panel) panel.classList.add("active");
      });
    });

    document.querySelectorAll(".legal-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        openLegal("view", link.dataset.legal);
      });
    });

    if (_legalClose) {
      _legalClose.addEventListener("click", () => { _legalOverlay.classList.add("hidden"); });
    }
    if (_legalEnter) {
      _legalEnter.addEventListener("click", () => {
        if (!_legalAgree || !_legalAgree.checked) {
          _legalEnter.textContent = "请先勾选同意";
          _legalEnter.classList.add("shake");
          setTimeout(() => { _legalEnter.textContent = "同意并进入"; _legalEnter.classList.remove("shake"); }, 1200);
          return;
        }
        try { localStorage.setItem(legalKey, "1"); } catch (e) {}
        _legalOverlay.classList.add("hidden");
      });
    }

    const copy = document.getElementById("sf-copyright");
    if (copy) copy.textContent = "© " + new Date().getFullYear() + " " + (CONFIG.siteTitle || "本站") + " · 仅供学习与参考";

    let seen = "0";
    try { seen = localStorage.getItem(legalKey) || "0"; } catch (e) {}
    if (seen !== "1") openLegal("force");
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("#site-title").textContent = CONFIG.siteTitle;
    $(".subtitle").textContent = CONFIG.siteSubtitle;
    $("#top-title").textContent = CONFIG.siteTitle;
    document.title = CONFIG.siteTitle + " · 视觉专区";

    initLegal();

    if (CONFIG.enableSignup) {
      $("#auth-toggle-link").classList.remove("hidden");
    }

    SB.getPublicAccess().then((pub) => {
      window.__publicAccess = !!pub;
      window.__pubReady = true;
      maybeBoot();
    }).catch(() => { window.__publicAccess = false; window.__pubReady = true; maybeBoot(); });

    // 提前读取各专区前台可见性配置，用于视觉专区"被隐藏即拦截"守卫
    SB.getFrontendZoneVisibility().then((z) => {
      zoneVis = z || {};
      // 视觉专区被隐藏时，即使已登录也重刷一次守卫拦截
      refreshAuthUI();
      applyZoneNav();
    }).catch(() => { zoneVis = {}; });

    SB.onAuth((session) => {
      window.__loggedIn = !!session;
      window.__authReady = true;
      // 登录态变化后刷新用户级可见专区白名单，重跑守卫
      SB.myManageZones().then((z) => {
        myZones = z;
        refreshAuthUI();
        applyZoneNav();
      }).catch(() => { myZones = null; });
      maybeBoot();
    });

    // 兜底：异常情况下最多等3s后揭开遮罩，避免卡在加载页
    setTimeout(hideSplash, 3000);

    $("#login-btn").onclick = () => showLogin();
    setupAntiDownload();

    // ===== 公告弹窗事件 =====
    $("#notice-tab").addEventListener("click", function (e) {
      e.preventDefault();
      noticeTabActive = "unread"; // 从菜单进入默认看未读
      if (noticeUnreadList.length === 0) noticeTabActive = "history";
      openNoticeModal();
    });
    $("#notice-close").addEventListener("click", closeNoticeModal);
    $("#notice-modal").addEventListener("click", (e) => {
      if (e.target && e.target.id === "notice-modal") closeNoticeModal();
    });
    // 公告放大阅读层关闭
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
  });

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
      }
    });
    document.addEventListener("dragstart", (e) => {
      if (e.target.tagName === "IMG") e.preventDefault();
    });
    let longPress = null;
    document.addEventListener("touchstart", (e) => {
      if (e.target.tagName === "IMG") longPress = setTimeout(() => e.preventDefault(), 400);
    }, { passive: false });
    document.addEventListener("touchend", () => clearTimeout(longPress));
    document.addEventListener("touchmove", () => clearTimeout(longPress));
    document.addEventListener("selectstart", (e) => {
      if (e.target.tagName === "IMG") e.preventDefault();
    });
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") e.preventDefault();
    });
  }

  // 登录态与公开访问标志都就绪后，才决定显示哪个视图并揭开加载遮罩，避免登录页闪现
  function maybeBoot() {
    if (!(window.__authReady && window.__pubReady)) return;
    hideSplash();
    refreshAuthUI();
  }
  function hideSplash() {
    const s = document.getElementById("boot-splash");
    if (s) s.classList.add("hidden");
  }

  function refreshAuthUI() {
    // 视觉专区被隐藏守卫：即使直接访问首页也拦截，提示暂未开放
    if (!zoneVisible("visual")) {
      $("#login-btn").classList.add("hidden");
      $("#changepwd-btn").classList.add("hidden");
      $("#logout-btn").classList.add("hidden");
      $("#gallery-view").classList.add("hidden");
      $("#login-view").classList.remove("hidden");
      if (window.__loggedIn) { $("#logout-btn").classList.remove("hidden"); $("#changepwd-btn").classList.remove("hidden"); }
      Auth.toast("该专区暂未开放", false);
      return;
    }
    if (window.__loggedIn) { showGallery(); return; }
    if (window.__publicAccess) {
      $("#login-btn").classList.remove("hidden");
      $("#changepwd-btn").classList.add("hidden");
      $("#logout-btn").classList.add("hidden");
      $("#gallery-view").classList.remove("hidden");
      $("#login-view").classList.add("hidden");
      if (!galleryLoaded) { galleryLoaded = true; loadGallery(); }
      return;
    }
    showLogin();
  }
  function showLogin() {
    $("#login-btn").classList.add("hidden");
    $("#changepwd-btn").classList.add("hidden");
    $("#logout-btn").classList.add("hidden");
    $("#gallery-view").classList.add("hidden");
    $("#login-view").classList.remove("hidden");
  }
  function showGallery() {
    $("#login-btn").classList.add("hidden");
    $("#changepwd-btn").classList.remove("hidden");
    $("#logout-btn").classList.remove("hidden");
    $("#login-view").classList.add("hidden");
    $("#gallery-view").classList.remove("hidden");
    if (!galleryLoaded) { galleryLoaded = true; loadGallery(); }
    loadNotices();
  }

  // ================= 公告：近一个月未读 + 历史记录（弹窗） =================
  let noticeAutoShown = false;
  let noticeUnreadList = [];
  let noticeHistoryList = [];
  let noticeTabActive = "unread";

  async function loadNotices() {
    try {
      const all = await SB.listRecentPublishedAnnouncements().catch(() => []);
      const readIds = await SB.listMyReadAnnouncementIds().catch(() => []);
      const readSet = new Set(readIds || []);
      noticeUnreadList = (all || []).filter(a => !readSet.has(String(a.id)));
      updateNoticeBadge();
      // 首次进入且有未读 → 自动弹出
      if (!noticeAutoShown && noticeUnreadList.length > 0) {
        noticeAutoShown = true;
        noticeTabActive = "unread";
        openNoticeModal();
      }
    } catch (e) { /* 公告加载失败不影响浏览 */ }
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
    try {
      noticeHistoryList = await SB.listAllPublishedAnnouncements().catch(() => []);
    } catch (e) { noticeHistoryList = []; }
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
    // 未读 tab：只展示未读（近一个月且未读）
    if (noticeTabActive === "unread") {
      if (!noticeUnreadList.length) {
        body.innerHTML = "<div class='notice-empty'>暂无未读公告</div>";
        return;
      }
      body.innerHTML = "";
      noticeUnreadList.forEach(a => body.appendChild(buildNoticeCard(a, true)));
      return;
    }
    // 历史 tab：全部已发布（含超一个月），标记未读状态
    await loadHistory();
    if (!noticeHistoryList.length) {
      body.innerHTML = "<div class='notice-empty'>暂无历史公告</div>";
      return;
    }
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
    // 点击卡片 → 中央放大展示全文
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

  // 中央放大展示公告全文（标题 + 富文本正文 + 附加图片）
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
        // 富文本：保留格式渲染，统一图片为受控 URL
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
      // 附加图片（正文下方）
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
      return (d.getMonth() + 1) + "-" + d.getDate() + " " +
        String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    } catch (e) { return ""; }
  }
  async function loadGallery() {
    try {
      const [active, used, defs] = await Promise.all([
        SB.listActiveCats().catch(() => []),
        SB.listUsedCats().catch(() => []),
        SB.listTagDefs().catch(() => []),
      ]);
      activeCats = active;
      usedCats = used;
      styleDefs = defs.filter(d => d.type === "style").map(d => d.name);
      elementDefs = defs.filter(d => d.type === "element").map(d => d.name);
      sceneDefs = defs.filter(d => d.type === "scene").map(d => d.name);
      // 场景标签记录二级分组（indoor/outdoor，用于「室内/室外」分组展示），缺失时按名称前缀兜底
      sceneGroupMap = {};
      defs.filter(d => d.type === "scene").forEach(d => {
        const grp = (d.group === "indoor" || d.group === "outdoor") ? d.group : (d.name.indexOf("室外") === 0 ? "outdoor" : "indoor");
        sceneGroupMap[d.name] = grp;
      });
      shootDefs = defs.filter(d => d.type === "shoot").map(d => d.name);
      skinDefs = defs.filter(d => d.type === "skin").map(d => d.name);
      try { dimSwitches = await SB.getFrontendDims(); } catch (e) { dimSwitches = {}; }
      // 各专区各类目前台可见性（视觉专区 = visual；未配置默认可见）
      try { catVisibility = await SB.getFrontendCatVisibility(); } catch (e) { catVisibility = {}; }
      try { zoneVis = await SB.getFrontendZoneVisibility(); } catch (e) { zoneVis = {}; }
      applyZoneNav();
      shownCats = activeCats.filter(c => usedCats.includes(c) && catCatVisible("visual", c));
      renderCatMenu(shownCats);
      await renderGrid(currentCat);
    } catch (e) {
      Auth.toast("加载失败，请检查网络或配置", false);
    }
  }

  // 某专区某类目是否前台可见（未配置默认可见）
  function catCatVisible(zone, cat) {
    const m = catVisibility && catVisibility[zone];
    return !m || m[cat] !== false;
  }

  // 某专区本身是否前台可见（未配置默认可见）
  // 优先按当前登录用户级白名单（myZones 非空数组）判断；未配置/未登录回退到全局 frontend_zone_visibility。
  function zoneVisible(zone) {
    if (Array.isArray(myZones) && myZones.length) {
      if (zoneVis && zoneVis[zone] === false) return false;
      return myZones.indexOf(zone) !== -1;
    }
    return !zoneVis || zoneVis[zone] !== false;
  }

  // 顶部菜单：每个菜单项（视觉/趋势/招品/BESTSELLER/公告）都可单独在前台被隐藏
  function applyZoneNav() {
    document.querySelectorAll(".top-tabs .tab-link").forEach(a => {
      const href = a.getAttribute("href") || "";
      const vt = a.getAttribute("data-viewtab") || "";
      let z = null;
      if (vt === "marketing" || href === "marketing.html") z = "marketing";
      else if (href === "index.html") z = "visual";
      else if (href === "trends.html") z = "trend";
      else if (href === "trends.html#recruit") z = "recruit";
      else if (href === "trends.html#bestseller") z = "bestseller";
      else if (a.id === "notice-tab") z = "notice";
      a.style.display = (z && !zoneVisible(z)) ? "none" : "";
    });
  }

  function renderCatMenu(cats) {
    const menu = $("#cat-menu");
    menu.innerHTML = "";
    ["全部"].concat(cats).forEach(c => {
      const b = document.createElement("button");
      b.className = "cat-menu-item" + (c === currentCat ? " active" : "");
      b.textContent = c;
      b.onclick = () => { currentCat = c; renderCatMenu(cats); renderGrid(c); };
      menu.appendChild(b);
    });
  }

  // 单张图片是否命中「类目 + 三个标签维度」的组合筛选
  function _dimOn(key) { return dimSwitches[key] !== false; }

  function _match(img) {
    if (currentCat && currentCat !== "全部" && img.category !== currentCat) return false;
    if (_dimOn("channel") && curChannel && !(Array.isArray(img.tags) && img.tags.includes(curChannel))) return false;
    if (_dimOn("style") && curStyle && !(Array.isArray(img.style_tags) && img.style_tags.includes(curStyle))) return false;
    if (_dimOn("element") && curElement && !(Array.isArray(img.element_tags) && img.element_tags.includes(curElement))) return false;
    if (_dimOn("scene") && curScene && !(Array.isArray(img.scene_tags) && img.scene_tags.includes(curScene))) return false;
    if (_dimOn("shoot") && curShoot && !(Array.isArray(img.shoot_tags) && img.shoot_tags.includes(curShoot))) return false;
    if (_dimOn("skin") && curSkin && !(Array.isArray(img.skin_tags) && img.skin_tags.includes(curSkin))) return false;
    return true;
  }

  // 标签筛选栏（吸顶）：类目/渠道/风格/元素 四组，每组可单选，四维组合过滤
  // ---------- 图片懒加载并发池（模块级，供分页追加复用）----------
  const LAZY_CONC = 4;
  let lazyInflight = 0;
  const lazyQueue = [];
  function lazyPump() {
    while (lazyInflight < LAZY_CONC && lazyQueue.length) {
      const p = lazyQueue.shift();
      if (!p) break;
      lazyInflight++;
      let settled = false;
      const fetchFallback = async () => {
        const au = p.dataset.authUrl;
        const at = p.dataset.authToken;
        p.removeAttribute("src");
        try {
          const headers = at ? { "Authorization": "Bearer " + at } : {};
          const resp = await fetch(au, { headers, cache: "no-store" });
          if (!resp.ok) throw new Error(String(resp.status));
          const blob = await resp.blob();
          const obj = URL.createObjectURL(blob);
          if (!settled) {
            settled = true;
            lazyInflight--;
            p.classList.add("loaded");
            p.onerror = null; p.onload = null;
            p.src = obj;
            lazyPump();
          }
          return;
        } catch (e) { /* fall through */ }
        if (!settled) {
          settled = true;
          lazyInflight--;
          p.classList.add("loaded", "lazy-fallback");
          p.onerror = null; p.onload = null;
          lazyPump();
        }
      };
      let hangTimer = 0;
      p.onload = () => {
        if (settled) return;
        settled = true;
        clearTimeout(hangTimer);
        lazyInflight--;
        p.classList.add("loaded");
        lazyPump();
      };
      p.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(hangTimer);
        lazyInflight--;
        (async () => {
          const au = p.dataset.authUrl;
          const at = p.dataset.authToken;
          if (au) {
            try {
              const headers = at ? { "Authorization": "Bearer " + at } : {};
              const resp = await fetch(au, { headers, cache: "no-store" });
              if (!resp.ok) throw new Error(String(resp.status));
              const blob = await resp.blob();
              const obj = URL.createObjectURL(blob);
              p.classList.add("loaded");
              p.onerror = null; p.onload = null;
              p.src = obj;
              return;
            } catch (e) { /* fall through */ }
          }
          p.classList.add("loaded", "lazy-fallback");
          p.onerror = null; p.onload = null;
        })();
      };
      p.dataset.loading = "1";
      hangTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          clearTimeout(hangTimer);
          lazyInflight--;
          p.onerror = null; p.onload = null;
          lazyPump();
          fetchFallback();
        }
      }, 4000);
      p.src = p.dataset.src;
    }
  }
  function lazyEnqueue(el) { lazyQueue.push(el); lazyPump(); }

  // 由全量列表构造计数对象（筛选视图使用）
  function countsFromList(list) {
    const C = { total: (list || []).length, category: {}, channel: {}, style: {}, element: {}, scene: {}, shoot: {}, skin: {} };
    (list || []).forEach(i => {
      const c = i.category || "未分类";
      C.category[c] = (C.category[c] || 0) + 1;
      const dims = { channel: i.tags, style: i.style_tags, element: i.element_tags, scene: i.scene_tags, shoot: i.shoot_tags, skin: i.skin_tags };
      Object.keys(dims).forEach(k => {
        const arr = dims[k];
        if (Array.isArray(arr)) arr.forEach(v => { if (v) C[k][v] = (C[k][v] || 0) + 1; });
      });
    });
    return C;
  }

  function renderTagBar(counts) {
    const groupsBox = $("#tf-groups");
    if (!groupsBox) return;
    groupsBox.innerHTML = "";
    const C = counts || { total: 0 };

    const countOf = (groupKey, value) => {
      if (value === "" || value == null) return C.total || 0;
      const m = C[groupKey];
      return (m && m[value] != null) ? m[value] : 0;
    };

    const mkChip = (groupKey, value, label, count, active) => {
      const b = document.createElement("button");
      b.className = "tag-chip" + (active ? " active" : "") + (count === 0 ? " zero" : "");
      b.dataset.group = groupKey;
      b.dataset.tag = value || "";
      const nm = document.createElement("span");
      nm.className = "tc-name";
      nm.textContent = label;
      const cnt = document.createElement("span");
      cnt.className = "tc-count";
      cnt.textContent = count;
      b.appendChild(nm);
      b.appendChild(cnt);
      b.onclick = () => {
        if (groupKey === "category") { currentCat = value || "全部"; renderCatMenu(shownCats); }
        else if (groupKey === "channel") curChannel = value;
        else if (groupKey === "style") curStyle = value;
        else if (groupKey === "element") curElement = value;
        else if (groupKey === "scene") curScene = value;
        else if (groupKey === "shoot") curShoot = value;
        else if (groupKey === "skin") curSkin = value;
        else { curElement = value; }
        renderTagBar(C);
        renderGrid();
      };
      return b;
    };

    const grpMeta = [
      { key: "category", label: "类目", items: shownCats, cur: (v) => currentCat === (v || "全部"), field: null, catIdx: true },
      { key: "channel", label: "渠道", items: (window.CONFIG.CHANNEL_TAGS || []).flatMap(g => g.tags || []), cur: (v) => curChannel === v, field: "tags" },
      { key: "style", label: "风格", items: styleDefs, cur: (v) => curStyle === v, field: "style_tags" },
      { key: "element", label: "元素", items: elementDefs, cur: (v) => curElement === v, field: "element_tags" },
      { key: "scene", label: "场景", items: sceneDefs, cur: (v) => curScene === v, field: "scene_tags" },
      { key: "shoot", label: "拍摄方式", items: shootDefs, cur: (v) => curShoot === v, field: "shoot_tags" },
      { key: "skin", label: "肤色", items: skinDefs, cur: (v) => curSkin === v, field: "skin_tags" }
    ];

    function sceneGroupName(t) {
      const g = sceneGroupMap[t];
      if (g === "indoor") return "室内";
      if (g === "outdoor") return "室外";
      return t.indexOf("·") > 0 ? t.split("·")[0] : "其他";
    }

    const visibleGrp = grpMeta.filter(g => g.key === "category" || _dimOn(g.key));
    visibleGrp.forEach(g => {
      const wrap = document.createElement("div");
      wrap.className = "tag-group";
      const gName = document.createElement("span");
      gName.className = "tag-group-name";
      gName.textContent = g.label;
      wrap.appendChild(gName);
      const chips = document.createElement("div");
      chips.className = "tag-chips";
      const allActive = g.key === "category" ? (currentCat === "全部") : (g.cur(""));
      chips.appendChild(mkChip(g.key, "", "全部", C.total || 0, allActive));

      if (g.key === "scene") {
        const order = ["室内", "室外", "其他"];
        const buckets = {};
        g.items.forEach(t => {
          const k = sceneGroupName(t);
          (buckets[k] = buckets[k] || []).push(t);
        });
        order.forEach(k => {
          if (!buckets[k] || !buckets[k].length) return;
          const sub = document.createElement("div");
          sub.className = "tag-subgroup";
          const subN = document.createElement("span");
          subN.className = "tag-subgroup-name";
          subN.textContent = k;
          sub.appendChild(subN);
          const subChips = document.createElement("div");
          subChips.className = "tag-chips";
          buckets[k].forEach(t => {
            const active = g.cur(t);
            const cnt = countOf(g.key, t);
            const short = t.split("·")[1] || t;
            subChips.appendChild(mkChip(g.key, t, short, cnt, active));
          });
          sub.appendChild(subChips);
          chips.appendChild(sub);
        });
        g.items.forEach(t => {
          if (["室内", "室外", "其他"].includes(sceneGroupName(t))) return;
          const active = g.cur(t);
          const cnt = countOf(g.key, t);
          chips.appendChild(mkChip(g.key, t, t, cnt, active));
        });
      } else {
        g.items.forEach(t => {
          const active = g.key === "category" ? (currentCat === t) : g.cur(t);
          const cnt = countOf(g.key, t);
          chips.appendChild(mkChip(g.key, t, t, cnt, active));
        });
      }
      wrap.appendChild(chips);
      groupsBox.appendChild(wrap);
    });

    updateTagSummary();
  }

  // 更新折叠条的当前筛选摘要
  function updateTagSummary() {
    const el = $("#tf-summary");
    if (!el) return;
    const parts = [];
    if (currentCat && currentCat !== "全部") parts.push("类目:" + currentCat);
    if (_dimOn("channel") && curChannel) parts.push("渠道:" + curChannel);
    if (_dimOn("style") && curStyle) parts.push("风格:" + curStyle);
    if (_dimOn("element") && curElement) parts.push("元素:" + curElement);
    if (_dimOn("scene") && curScene) parts.push("场景:" + curScene);
    if (_dimOn("shoot") && curShoot) parts.push("拍摄:" + curShoot);
    if (_dimOn("skin") && curSkin) parts.push("肤色:" + curSkin);
    el.textContent = parts.length ? parts.join(" · ") : "类目·渠道·风格·元素·场景·拍摄·肤色";
  }

  // ---------- 前台网格：服务端分页 + 无限滚动 ----------
  const PAGE_SIZE = 60;            // 每页加载条数
  let pageAll = [];                // 当前默认「全部」视图已累计加载的图片
  let pageOffset = 0;              // 下一页偏移
  let pageHasMore = false;         // 是否还有下一页
  let pageLoading = false;         // 是否正在加载下一页（防重）
  let pageSentinel = null;         // 无限滚动哨兵元素
  let pageObserver = null;         // 哨兵观察器
  let pageCounts = { total: 0 };   // 默认视图的标签/类目计数（来自前端聚合统计）

  function removePageSentinel() {
    if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
    if (pageSentinel && pageSentinel.parentNode) pageSentinel.parentNode.removeChild(pageSentinel);
    pageSentinel = null;
  }

  // 渲染一批图片（DDOM）：支持追加到已有网格
  function buildCell(img, idx) {
    const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
    const guestToken = window.__guestToken || "";
    const cell = document.createElement("div");
    cell.className = "cell";
    const holder = document.createElement("div");
    holder.className = "holder";
    const imgEl = document.createElement("img");
    imgEl.dataset.src = base + "/" + img.path + (guestToken ? "?token=" + encodeURIComponent(guestToken) : "");
    imgEl.dataset.authUrl = base + "/" + img.path;
    imgEl.dataset.authToken = guestToken || "";
    imgEl.alt = img.name || "";
    imgEl.decoding = "async";
    imgEl.draggable = false;
    imgEl.addEventListener("contextmenu", (e) => e.preventDefault());
    holder.appendChild(imgEl);
    const mask = document.createElement("div");
    mask.className = "cell-hover-mask";
    const mk = (lab, arr, cls) => {
      const list = Array.isArray(arr) ? arr.filter(Boolean) : [];
      return list.length ? `<div class="hcap-row ${cls}"><b>${lab}</b><span>${escHtml(list.join("、"))}</span></div>` : "";
    };
    const inner = (_dimOn("channel") ? mk("渠道", img.tags, "ch") : "") + (_dimOn("style") ? mk("风格", img.style_tags, "st") : "") + (_dimOn("element") ? mk("元素", img.element_tags, "el") : "") + (_dimOn("scene") ? mk("场景", img.scene_tags, "sc") : "") + (_dimOn("shoot") ? mk("拍摄", img.shoot_tags, "sh") : "") + (_dimOn("skin") ? mk("肤色", img.skin_tags, "sk") : "");
    mask.innerHTML = inner || `<div class="hcap-empty">暂无标签</div>`;
    holder.appendChild(mask);
    cell.appendChild(holder);
    if (img && img.url && String(img.url).trim()) {
      const lbadge = document.createElement("a");
      lbadge.className = "cell-link-badge";
      lbadge.href = String(img.url).trim();
      lbadge.target = "_blank";
      lbadge.rel = "noopener noreferrer";
      lbadge.title = "打开外链：" + String(img.url).trim();
      lbadge.textContent = "开";
      lbadge.addEventListener("click", (e) => e.stopPropagation());
      cell.appendChild(lbadge);
    }
    cell.onclick = () => openLightbox(idx);
    holder.style.background = "var(--shade)";
    return cell;
  }

  // 设置一张图片的懒加载 + 并发池（追加渲染时复用）
  function setupLazy(grid, imgEl) {
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(en => {
          if (en.isIntersecting) {
            en.target.setAttribute("data-started", "1");
            lazyEnqueue(en.target);
            obs.unobserve(en.target);
          }
        });
      }, { rootMargin: "300px" });
      io.observe(imgEl);
    } else {
      imgEl.setAttribute("data-started", "1");
      const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      imgEl.dataset.authUrl = base + "/" + (imgEl.dataset.path || "");
      imgEl.src = imgEl.dataset.src;
      imgEl.classList.add("loaded");
    }
  }

  async function showEmptyHint(hasFilter, count) {
    const tip = $("#empty-tip");
    if (!tip) return;
    tip.textContent = hasFilter
      ? "没有同时满足所选类目与标签的图片。"
      : "该分类暂无可浏览的图片。";
    tip.classList.toggle("hidden", count > 0);
  }

  async function loadNextPage() {
    if (!pageHasMore || pageLoading) return;
    pageLoading = true;
    try {
      const chunk = await SB.listFrontendImages(PAGE_SIZE, pageOffset);
      pageAll = pageAll.concat(chunk || []);
      catalog = pageAll;
      const guestToken = window.__guestToken || "";
      lightboxList = lightboxList.concat((chunk || []).map(i => {
        const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
        return base + "/" + i.path + (guestToken ? "?token=" + encodeURIComponent(guestToken) : "");
      }));
      const grid = $("#grid");
      const newCells = [];
      chunk.forEach(img => {
        const idx = catalog.indexOf(img);
        const cell = buildCell(img, idx);
        grid.appendChild(cell);
        newCells.push(cell);
        const imgEl = cell.querySelector("img");
        setupLazy(grid, imgEl);
      });
      // 批量兜底
      newCells.forEach(cell => {
        const imgEl = cell.querySelector("img");
        setTimeout(() => {
          const pending = grid.querySelectorAll("img:not([data-started])");
          if (pending.length) {
            pending.forEach(p => { p.setAttribute("data-started", "1"); lazyEnqueue(p); });
          }
        }, 1500);
      });
      pageOffset += (chunk || []).length;
      pageHasMore = (chunk && chunk.length >= PAGE_SIZE);
      showEmptyHint(false, catalog.length);
      // 滚动到底自动加载更多
      setupSentinel();
    } finally {
      pageLoading = false;
    }
  }

  function setupSentinel() {
    if (!pageSentinel) {
      const grid = $("#grid");
      pageSentinel = document.createElement("div");
      pageSentinel.className = "page-sentinel";
      pageSentinel.style.height = "1px";
      grid.parentNode.appendChild(pageSentinel);
      pageObserver = new IntersectionObserver(() => {
        loadNextPage();
      }, { rootMargin: "600px" });
      pageObserver.observe(pageSentinel);
    }
  }

  // 由聚合统计构造计数对象：{ total, category:{}, channel:{}, style:{}, element:{}, scene:{}, shoot:{}, skin:{} }
  function countsFromStats(stats) {
    const s = stats || {};
    const n = (o) => (o && typeof o === "object" ? o : {});
    return {
      total: Number(s.total) || 0,
      category: n(s.categories),
      channel: n(s.channel),
      style: n(s.style),
      element: n(s.element),
      scene: n(s.scene),
      shoot: n(s.shoot),
      skin: n(s.skin)
    };
  }

  async function renderGrid(setCat) {
    if (setCat) currentCat = setCat;
    const grid = $("#grid");
    grid.innerHTML = "";
    removePageSentinel();
    pageAll = [];
    pageOffset = 0;
    pageHasMore = false;
    pageLoading = false;
    pageCounts = { total: 0 };

    const hasFilter = (currentCat && currentCat !== "全部") || curChannel || curStyle || curElement || curScene || curShoot || curSkin;
    const isDefaultView = currentCat === "全部" && !curChannel && !curStyle && !curElement && !curScene && !curShoot && !curSkin;

    if (isDefaultView) {
      // ===== 服务端分页 + 无限滚动（默认「全部」视图）=====
      catalog = [];
      lightboxList = [];
      window.__guestToken = await SB.currentToken().catch(() => "");
      // 计数用聚合统计（真实总数，不依赖已加载页）
      try {
        const stats = await SB.frontendTagStats();
        pageCounts = countsFromStats(stats);
      } catch (e) { pageCounts = { total: 0 }; }
      renderTagBar(pageCounts);
      renderCatMenu(shownCats);
      await showEmptyHint(false, 0);
      pageHasMore = true;
      await loadNextPage();
      return;
    }

    // ===== 筛选视图：一次加载全量（结果集已收敛，保证计数准确）=====
    let imgs = [];
    try {
      imgs = await SB.listFrontendImages();
    } catch (e) { Auth.toast("读取图片失败", false); }
    const catImgs = imgs.filter(i => catCatVisible("visual", i.category));
    catCounts = {};
    catImgs.forEach(i => { const c = i.category || "未分类"; catCounts[c] = (catCounts[c] || 0) + 1; });
    const _catImgsAll = catImgs;
    imgs = catImgs.filter(_match);
    renderTagBar(countsFromList(_catImgsAll));

    await showEmptyHint(hasFilter, imgs.length);
    catalog = imgs;
    const guestToken = await SB.currentToken().catch(() => "");
    window.__guestToken = guestToken;
    lightboxList = imgs.map(i => {
      const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      return base + "/" + i.path + (guestToken ? "?token=" + encodeURIComponent(guestToken) : "");
    });

    const _catalog = catalog;
    imgs.forEach(img => {
      const idx = _catalog.indexOf(img);
      const cell = buildCell(img, idx);
      grid.appendChild(cell);
      setupLazy(grid, cell.querySelector("img"));
    });
    setTimeout(() => {
      const still = grid.querySelectorAll("img:not([data-started])");
      if (still.length) {
        still.forEach(p => { p.setAttribute("data-started", "1"); lazyEnqueue(p); });
      }
    }, 1500);
    setTimeout(() => {
      const still = grid.querySelectorAll("img:not([data-started])");
      if (still.length) {
        still.forEach(p => { p.setAttribute("data-started", "1"); lazyEnqueue(p); });
      }
    }, 2500);
  }


  // ASCII 文本转义封装（依赖 frontend.html 内无函数时本地兜底）
  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ---------- 灯箱 ----------
  function openLightbox(idx) {
    lightboxIdx = idx;
    showLbImage();
    $("#lightbox").classList.remove("hidden");
  }
  function showLbImage() {
    const url = lightboxList[lightboxIdx] || "";
    const img = catalog[lightboxIdx];
    const lbImg = $("#lb-img");
    let lbDone = false;
    let lbHangTimer = 0;
    const lbFallback = () => {
      if (lbDone || !img) return;
      lbDone = true;
      clearTimeout(lbHangTimer);
      const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      const au = base + "/" + img.path;
      const at = (window.__guestToken || "");
      lbImg.onerror = null;
      lbImg.onload = null;
      (async () => {
        try {
          const headers = at ? { "Authorization": "Bearer " + at } : {};
          const resp = await fetch(au, { headers, cache: "no-store" });
          if (!resp.ok) throw new Error(String(resp.status));
          const blob = await resp.blob();
          lbImg.src = URL.createObjectURL(blob);
        } catch (e) { /* 保留原状 */ }
      })();
    };
    lbImg.onload = () => { lbDone = true; clearTimeout(lbHangTimer); };
    lbImg.onerror = lbFallback;
    // 看门狗：4s 内既没 onload 也没 onerror → 手机端长 token URL 挂起，强制转 Authorization 头兜底
    lbHangTimer = setTimeout(lbFallback, 4000);
    lbImg.src = url;
    let parts = [(lightboxIdx + 1) + " / " + lightboxList.length];
    if (img) {
      const t = (arr) => (Array.isArray(arr) && arr.length) ? arr.join(" / ") : "";
      const s = [t(img.tags), t(img.style_tags), t(img.element_tags)].filter(Boolean).join(" · ");
      if (s) parts.push(s);
    }
    $("#lb-caption").textContent = parts.join(" · ");
    // 图片外链：有链接时显示「打开链接」按钮，无链接隐藏
    const linkEl = $("#lb-open-link");
    if (linkEl) {
      const linkUrl = img && img.url ? String(img.url).trim() : "";
      if (linkUrl) { linkEl.href = linkUrl; linkEl.classList.remove("hidden"); }
      else { linkEl.href = "#"; linkEl.classList.add("hidden"); }
    }
  }
  $("#lb-close").onclick = () => $("#lightbox").classList.add("hidden");
  $("#lb-prev").onclick = (e) => { e.stopPropagation(); lightboxIdx = (lightboxIdx - 1 + lightboxList.length) % lightboxList.length; showLbImage(); };
  $("#lb-next").onclick = (e) => { e.stopPropagation(); lightboxIdx = (lightboxIdx + 1) % lightboxList.length; showLbImage(); };
  $("#lightbox").onclick = (e) => { if (e.target.id === "lightbox") $("#lightbox").classList.add("hidden"); };
  document.addEventListener("keydown", (e) => {
    if ($("#lightbox").classList.contains("hidden")) return;
    if (e.key === "Escape") $("#lightbox").classList.add("hidden");
    if (e.key === "ArrowLeft") $("#lb-prev").click();
    if (e.key === "ArrowRight") $("#lb-next").click();
  });

  // ---------- 登录 / 注册 ----------
  let authMode = "login";
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#auth-email").value.trim();
    const pass = $("#auth-pass").value;
    if (!email || !pass) { Auth.toast("请输入邮箱和密码", false); return; }
    if (authMode === "register") {
      const { error } = await SB.signUp(email, pass);
      if (error) { Auth.toast("注册失败：" + error.message, false); return; }
      Auth.toast("注册成功，已登录");
      setTimeout(() => location.reload(), 800); // 用新令牌重载，重建带令牌图片URL
      return;
    }
    const { error } = await SB.signIn(email, pass);
    if (error) { Auth.toast("登录失败：" + error.message, false); return; }
    Auth.toast("登录成功");
    setTimeout(() => location.reload(), 800); // 用新令牌重载，重建带令牌图片URL
  });
  $("#auth-toggle-link").onclick = (e) => {
    e.preventDefault();
    authMode = authMode === "login" ? "register" : "login";
    $("#auth-toggle-link").textContent = authMode === "login" ? "没有账号？注册一个" : "已有账号？去登录";
    $("#auth-title").textContent = authMode === "login" ? "访客登录" : "注册账号";
    $("#auth-submit").textContent = authMode === "login" ? "进入网站" : "注册并进入";
  };
  $("#logout-btn").onclick = async () => { await SB.signOut(); refreshAuthUI(); };

  // ---------- 修改密码（安全设置） ----------
  const pwdModal = $("#pwd-modal");
  if (pwdModal) {
    const openPwd = () => {
      const o = $("#pwd-old"), n = $("#pwd-new"), n2 = $("#pwd-new2");
      if (o) o.value = ""; if (n) n.value = ""; if (n2) n2.value = "";
      pwdModal.classList.remove("hidden");
      if (o) o.focus();
    };
    const closePwd = () => pwdModal.classList.add("hidden");
    const bp = $("#changepwd-btn");
    if (bp) bp.onclick = openPwd;
    const c1 = $("#pwd-cancel"); if (c1) c1.onclick = closePwd;
    const c2 = $("#pwd-close"); if (c2) c2.onclick = closePwd;
    if (pwdModal) pwdModal.addEventListener("click", (e) => { if (e.target === pwdModal) closePwd(); });
    const doSubmit = async () => {
      const o = $("#pwd-old").value.trim();
      const n = $("#pwd-new").value;
      const n2 = $("#pwd-new2").value;
      if (!o) return Auth.toast("请输入旧密码", false);
      if (!n || n.length < 6) return Auth.toast("新密码至少6位", false);
      if (n !== n2) return Auth.toast("两次输入的新密码不一致", false);
      const r = await SB.changePassword(o, n);
      if (r.error) return Auth.toast(r.error.message || "修改失败", false);
      Auth.toast("密码修改成功", true);
      closePwd();
    };
    const btn = $("#pwd-submit"); if (btn) btn.onclick = doSubmit;
  }
})();
