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
      $("#logout-btn").classList.add("hidden");
      $("#gallery-view").classList.add("hidden");
      $("#login-view").classList.remove("hidden");
      if (window.__loggedIn) $("#logout-btn").classList.remove("hidden");
      Auth.toast("该专区暂未开放", false);
      return;
    }
    if (window.__loggedIn) { showGallery(); return; }
    if (window.__publicAccess) {
      $("#login-btn").classList.remove("hidden");
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
    $("#logout-btn").classList.add("hidden");
    $("#gallery-view").classList.add("hidden");
    $("#login-view").classList.remove("hidden");
  }
  function showGallery() {
    $("#login-btn").classList.add("hidden");
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
      let z = null;
      if (href === "index.html") z = "visual";
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
  function renderTagBar(list) {
    const groupsBox = $("#tf-groups");
    if (!groupsBox) return;
    groupsBox.innerHTML = "";

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
        renderTagBar(list);
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

    // 场景标签按「室内 / 室外」二级分组展示（以 group 字段为准，缺失时按名称前缀兜底）
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
      // 「全部」选项
      const allActive = g.key === "category" ? (currentCat === "全部") : (g.cur(""));
      chips.appendChild(mkChip(g.key, "", "全部", list.length, allActive));

      if (g.key === "scene") {
        // 场景标签按「室内/室外/其他」分组渲染
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
            const cnt = list.filter(i => Array.isArray(i[g.field]) && i[g.field].includes(t)).length;
            // 子组内只显示细分名，避免「室内·卧室」在「室内」分组下重复冗长
            const short = t.split("·")[1] || t;
            subChips.appendChild(mkChip(g.key, t, short, cnt, active));
          });
          
          sub.appendChild(subChips);
          chips.appendChild(sub);
        });
        // 其他未覆盖前缀场景标签一律展示（防御）
        g.items.forEach(t => {
          if (["室内", "室外", "其他"].includes(sceneGroupName(t))) return;
          const active = g.cur(t);
          const cnt = list.filter(i => Array.isArray(i[g.field]) && i[g.field].includes(t)).length;
          chips.appendChild(mkChip(g.key, t, t, cnt, active));
        });
      } else {
        g.items.forEach(t => {
          const active = g.key === "category" ? (currentCat === t) : g.cur(t);
          const cnt = list.filter(i => g.key === "category"
            ? (i.category === t)
            : (Array.isArray(i[g.field]) && i[g.field].includes(t))).length;
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

  async function renderGrid(setCat) {
    if (setCat) currentCat = setCat;
    const grid = $("#grid");
    grid.innerHTML = "";
    let imgs = [];
    try {
      imgs = await SB.listFrontendImages();
    } catch (e) { Auth.toast("读取图片失败", false); }
    const catImgs = imgs.filter(i => catCatVisible("visual", i.category));
    catCounts = {};
    catImgs.forEach(i => { const c = i.category || "未分类"; catCounts[c] = (catCounts[c] || 0) + 1; });
    imgs = catImgs.filter(_match);
    renderTagBar(catImgs);

    const hasFilter = (currentCat && currentCat !== "全部") || curChannel || curStyle || curElement || curScene || curShoot || curSkin;
    $("#empty-tip").textContent = hasFilter
      ? "没有同时满足所选类目与标签的图片。"
      : "该分类暂无可浏览的图片。";
    $("#empty-tip").classList.toggle("hidden", imgs.length > 0);
    catalog = imgs;

    const guestToken = await SB.currentToken();
    window.__guestToken = guestToken;
    lightboxList = imgs.map(i => {
      const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      return base + "/" + i.path + (guestToken ? "?token=" + encodeURIComponent(guestToken) : "");
    });

    // 图片并发加载限制：同一时刻最多同时加载 4 张，其余排队，避免手机一次性几十个请求同时打导致卡顿
    const LAZY_CONC = 4;
    let lazyInflight = 0;
    const lazyQueue = [];
    function lazyPump() {
      while (lazyInflight < LAZY_CONC && lazyQueue.length) {
        const p = lazyQueue.shift();
        if (!p) break;
        lazyInflight++;
        let settled = false;
        // 兜底拉取：改用 fetch + Authorization 头（与列表接口同链路，规避移动端超长 token URL 挂起）
        const fetchFallback = async () => {
          const au = p.dataset.authUrl;
          const at = p.dataset.authToken;
          // 先销毁挂起的 src 请求，避免其继续占着请求
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
              p.onerror = null;
              p.onload = null;
              p.src = obj;
              lazyPump();
            }
            return;
          } catch (e) { /* fall through */ }
          if (!settled) {
            settled = true;
            lazyInflight--;
            p.classList.add("loaded", "lazy-fallback");
            p.onerror = null;
            p.onload = null;
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
          // 报错也走 Authorization 头兜底（不额外加并发计数，settled 已释放）
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
                p.onerror = null;
                p.onload = null;
                p.src = obj;
                return;
              } catch (e) { /* fall through */ }
            }
            p.classList.add("loaded", "lazy-fallback");
            p.onerror = null;
            p.onload = null;
            lazyPump();
          })();
        };
        p.dataset.loading = "1";
        hangTimer = setTimeout(() => {
          // 看门狗：4s 内既没 onload 也没 onerror → 移动端"挂起"。强制走 Authorization 头兜底。
          if (!settled) {
            settled = true;
            clearTimeout(hangTimer);
            lazyInflight--;
            p.onerror = null;
            p.onload = null;
            // 无论兜底成功与否，先推进队列，避免并发槽一直被占用
            lazyPump();
            fetchFallback();
          }
        }, 4000);
        p.src = p.dataset.src;
      }
    }
    function lazyEnqueue(el) { lazyQueue.push(el); lazyPump(); }

    imgs.forEach((img, idx) => {
      const cell = document.createElement("div");
      cell.className = "cell";
      const holder = document.createElement("div");
      holder.className = "holder";
      const imgEl = document.createElement("img");
      const _imgBase = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      imgEl.dataset.src = _imgBase + "/" + img.path + (guestToken ? "?token=" + encodeURIComponent(guestToken) : "");
      // 供 fetch 兜底用：干净的图片URL（不带超长 token query）＋ 明文 token。
      // 部分移动端浏览器（微信内核/自带）对带数百字符 token 的超长图片 URL 请求会挂起（不返回也不报错），
      // 导致图片一直停留在灰色占位。此处改用与"图片列表接口"完全相同的鉴权链路（Authorization 头）兜底加载。
      imgEl.dataset.authUrl = _imgBase + "/" + img.path;
      imgEl.dataset.authToken = guestToken || "";
      imgEl.alt = img.name || "";
      imgEl.decoding = "async";
      // 注意：不再设置 loading="lazy"。原生懒加载与下方自建的 IntersectionObserver 懒加载 + 并发池在部分移动端浏览器（iOS Safari / 微信内核 / 安卓 WebView）上会冲突，
      // 导致动态赋值 src 的图片一直停在"待加载"灰色状态（既不加载成功也不报错）。去掉原生懒加载，统一由自建按需加载控制，桌面与移动端行为一致。
      imgEl.draggable = false;
      imgEl.addEventListener("contextmenu", (e) => e.preventDefault());
      holder.appendChild(imgEl);
      // 标签信息改为「鼠标悬浮」展示（不再常驻图片下方）
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
      // 图片外链角标：有外链时在卡片右上角显示「开」标识，点击直接打开该外链（不触发灯箱）
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
      grid.appendChild(cell);

      // 使用自建的按需加载（IntersectionObserver）。为避免个别移动端浏览器 IO 不触发导致图片一直空白，
      // 同时给每张图记录"是否已开始加载"，并设一道看门狗定时器兜底。
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((entries, obs) => {
          entries.forEach(en => {
            if (en.isIntersecting) {
              const target = en.target;
              target.setAttribute("data-started", "1");
              lazyEnqueue(target);
              obs.unobserve(target);
            }
          });
        }, { rootMargin: "300px" });
        io.observe(imgEl);
      } else {
        imgEl.setAttribute("data-started", "1");
        imgEl.src = imgEl.dataset.src;
        // 无 IO 环境：同样记录干净 URL 与 token，供超时/失败时 fetch 兜底
        if (!imgEl.dataset.authUrl) {
          const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
          imgEl.dataset.authUrl = base + "/" + (img.path || "");
          imgEl.dataset.authToken = guestToken || "";
        }
        imgEl.classList.add("loaded");
      }

      // 看门狗兜底：无论 IO 是否正常触发，1.5s 后强制把仍未开始加载的图全部排队加载，确保任何设备都能出图
      setTimeout(() => {
        const pending = grid.querySelectorAll("img:not([data-started])");
        if (pending.length) {
          pending.forEach(p => { p.setAttribute("data-started", "1"); lazyEnqueue(p); });
        }
      }, 1500);
    });

    // 主看门狗：渲染完成后 2.5s 统一兜底，处理 IO 未触发 / 排队异常等边缘情况
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
})();
