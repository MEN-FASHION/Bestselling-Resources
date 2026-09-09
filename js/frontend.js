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
  let shootDefs = [];    // 拍摄方式标签定义
  let skinDefs = [];     // 肤色标签定义
  let dimSwitches = {};  // 各维度是否在前台展示

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

  document.addEventListener("DOMContentLoaded", () => {
    $("#site-title").textContent = CONFIG.siteTitle;
    $(".subtitle").textContent = CONFIG.siteSubtitle;
    $("#top-title").textContent = CONFIG.siteTitle;
    document.title = CONFIG.siteTitle + " · 视觉专区";

    if (CONFIG.enableSignup) {
      $("#auth-toggle-link").classList.remove("hidden");
    }

    SB.getPublicAccess().then((pub) => {
      window.__publicAccess = !!pub;
      window.__pubReady = true;
      maybeBoot();
    }).catch(() => { window.__publicAccess = false; window.__pubReady = true; maybeBoot(); });

    SB.onAuth((session) => {
      window.__loggedIn = !!session;
      window.__authReady = true;
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

  function setupAntiDownload() {
    document.addEventListener("contextmenu", (e) => {
      if (e.target.tagName === "IMG") e.preventDefault();
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
      shootDefs = defs.filter(d => d.type === "shoot").map(d => d.name);
      skinDefs = defs.filter(d => d.type === "skin").map(d => d.name);
      try { dimSwitches = await SB.getFrontendDims(); } catch (e) { dimSwitches = {}; }
      shownCats = activeCats.filter(c => usedCats.includes(c));
      renderCatMenu(shownCats);
      await renderGrid(currentCat);
    } catch (e) {
      Auth.toast("加载失败，请检查网络或配置", false);
    }
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

    // 场景标签按「室内 / 室外」前缀分组展示（无前缀归入「其他」）
    function sceneGroupName(t) { return t.indexOf("·") > 0 ? t.split("·")[0] : "其他"; }

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
      imgs = await SB.listImages("全部");
    } catch (e) { Auth.toast("读取图片失败", false); }
    const catImgs = imgs.slice();
    catCounts = {};
    imgs.forEach(i => { const c = i.category || "未分类"; catCounts[c] = (catCounts[c] || 0) + 1; });
    imgs = imgs.filter(_match);
    renderTagBar(catImgs);

    const hasFilter = (currentCat && currentCat !== "全部") || curChannel || curStyle || curElement || curScene || curShoot || curSkin;
    $("#empty-tip").textContent = hasFilter
      ? "没有同时满足所选类目与标签的图片。"
      : "该分类暂无可浏览的图片。";
    $("#empty-tip").classList.toggle("hidden", imgs.length > 0);
    catalog = imgs;

    const guestToken = await SB.currentToken();
    lightboxList = imgs.map(i => {
      const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      return base + "/" + i.path + (guestToken ? "?token=" + encodeURIComponent(guestToken) : "");
    });

    imgs.forEach((img, idx) => {
      const cell = document.createElement("div");
      cell.className = "cell";
      const holder = document.createElement("div");
      holder.className = "holder";
      const imgEl = document.createElement("img");
      imgEl.dataset.src = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "") + "/" + img.path + (guestToken ? "?token=" + encodeURIComponent(guestToken) : "");
      imgEl.alt = img.name || "";
      imgEl.loading = "lazy";
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
      cell.onclick = () => openLightbox(idx);
      holder.style.background = "var(--shade)";
      grid.appendChild(cell);

      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((entries, obs) => {
          entries.forEach(en => {
            if (en.isIntersecting) {
              const target = en.target;
              target.src = target.dataset.src;
              target.onload = () => target.classList.add("loaded");
              target.onerror = () => { target.classList.add("loaded", "lazy-fallback"); };
              obs.unobserve(target);
            }
          });
        }, { rootMargin: "200px" });
        io.observe(imgEl);
      } else {
        imgEl.src = imgEl.dataset.src;
        imgEl.classList.add("loaded");
      }
    });
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
    $("#lb-img").src = lightboxList[lightboxIdx] || "";
    const img = catalog[lightboxIdx];
    let parts = [(lightboxIdx + 1) + " / " + lightboxList.length];
    if (img) {
      const t = (arr) => (Array.isArray(arr) && arr.length) ? arr.join(" / ") : "";
      const s = [t(img.tags), t(img.style_tags), t(img.element_tags)].filter(Boolean).join(" · ");
      if (s) parts.push(s);
    }
    $("#lb-caption").textContent = parts.join(" · ");
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
      return;
    }
    const { error } = await SB.signIn(email, pass);
    if (error) { Auth.toast("登录失败：" + error.message, false); return; }
  });
  $("#auth-toggle-link").onclick = (e) => {
    e.preventDefault();
    authMode = authMode === "login" ? "register" : "login";
    $("#auth-toggle-link").textContent = authMode === "login" ? "没有账号？注册一个" : "已有账号？去登录";
    $("#auth-title").textContent = authMode === "login" ? "访客登录" : "注册账号";
    $("#auth-submit").textContent = authMode === "login" ? "进入图鉴" : "注册并进入";
  };
  $("#logout-btn").onclick = async () => { await SB.signOut(); refreshAuthUI(); };
})();
