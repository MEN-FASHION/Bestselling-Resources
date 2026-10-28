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
  let lastTagCounts = null;   // 最近一次标签栏计数（清除筛选后用于重绘标签栏）
  let pageErr = "";     // 默认视图取数失败原因（用于把空态说清楚）

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
  Common.setToast(Auth.toast); // 把本页提示条接入公共模块

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
      if (window.Common && Common.zones) Common.zones.setVis(zoneVis);
      // 视觉专区被隐藏时，即使已登录也重刷一次守卫拦截
      refreshAuthUI();
      applyZoneNav();
    }).catch(() => { zoneVis = {}; if (window.Common && Common.zones) Common.zones.setVis({}); });

    // 登录态变化（含登录/退出）：与启动时共用同一份处理逻辑
    SB.onAuth((session) => applyAuthState(session));

    // 【关键修复】启动时主动读一次登录态。
    // 本地化后的登录库（vendor/supabase.js）不再自动推送"首次登录态"，
    // 若只依赖上面的订阅，刷新页面后页面会把已登录用户误判为访客 →
    // 表现为"登录成功后仍回到登录页、反复登录，过很久才进来"。这里显式读一次即可根治。
    (async () => {
      let session = null;
      try { session = await SB.getSession(); } catch (e) { session = null; }
      applyAuthState(session);
    })();

    // 兜底：1.5s 内仍未拿到登录态，则先按未登录放出页面，避免一直卡在加载遮罩
    setTimeout(() => {
      if (!window.__authReady) { window.__authReady = true; refreshAuthUI(); }
    }, 1500);

    // 兜底：异常情况下最多等3s后揭开遮罩，避免卡在加载页
    setTimeout(hideSplash, 3000);

    $("#login-btn").onclick = () => showLogin();
    Common.setupAntiDownload(); // 防下载（统一实现）

    // ===== 公告弹窗事件（统一由 common.js 绑定） =====
    Common.zones.loadDefs().then(() => Common.zones.renderNav());

    Common.notices.configure({ autoShowNeedsLogin: false, timeStyle: "short" });
    Common.notices.bind();
  });

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

  // 统一的登录态处理：启动主动读取 + 后续登录态变化共用同一份逻辑
  function applyAuthState(session) {
    window.__loggedIn = !!session;
    window.__authReady = true;
    if (!session) {
      myZones = null;
      if (window.Common && Common.zones) Common.zones.setMine(null);
      refreshAuthUI();
      applyZoneNav();
      maybeBoot();
      return;
    }
    // 访问统计（后台「数据看板」）：登记本次进入「视觉专区」的访问与停留时长
    if (window.Common && Common.visit) Common.visit.track("visual");

    // 读取该用户的前端可见专区白名单（frontend_zones，独立于后端 manage_zones）
    SB.myFrontendZones().then((z) => {
      myZones = z;
      if (window.Common && Common.zones) Common.zones.setMine(myZones);
      refreshAuthUI();
      applyZoneNav();
      // 默认落地专区：已登录且账号可见「趋势上升榜」时，本次会话首次打开站点直接进入榜单页
      maybeLandOnRank(myZones);
    }).catch(() => { myZones = null; if (window.Common && Common.zones) Common.zones.setMine(null); refreshAuthUI(); });
    maybeBoot();
  }

  // 默认落地专区：把「趋势上升榜」作为打开站点后的默认专区。
  // 规则：①仅已登录 ②账号可见榜单专区（受全局开关 + 用户级白名单约束）③同一会话只落地一次
  //      —— 之后从顶部菜单点回「视觉专区」不会再被弹走；退出登录后重置，下次登录仍默认进榜单。
  function maybeLandOnRank(myZones) {
    try {
      if (window.__landChecked) return;
      window.__landChecked = true;
      if (sessionStorage.getItem("nl_landed")) return;
      if (location.hash) return;                                  // 带锚点（指定到某专区某位置）时不跳
      const qs = new URLSearchParams(location.search);
      if (qs.get("zone") || qs.get("cat") || qs.get("noland")) return;  // 显式指定专区/类目时不跳
      if (zoneVis && zoneVis.rank === false) return;              // 全局已关闭榜单专区 → 不落地
      const canSee = (!myZones || !myZones.length) ? true : myZones.indexOf("rank") !== -1;
      if (!canSee) return;                                        // 账号未授权榜单专区 → 留在视觉专区
      sessionStorage.setItem("nl_landed", "1");
      location.replace("rank.html");
    } catch (e) { /* 落地失败就留在视觉专区，不影响使用 */ }
  }

  function refreshAuthUI() {
    // 登录态未就绪前不做视图判定，避免"已登录却先闪回登录页"
    if (!window.__authReady) return;
    // 视觉专区不可见（全站关闭，或本账号前台可见专区未包含）→ 给出明确说明，不再弹回登录页
    if (!zoneVisible("visual")) { showZoneLocked(); return; }
    hideZoneLocked();
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
    hideZoneLocked();
    $("#login-btn").classList.add("hidden");
    $("#changepwd-btn").classList.add("hidden");
    $("#logout-btn").classList.add("hidden");
    $("#gallery-view").classList.add("hidden");
    $("#login-view").classList.remove("hidden");
  }
  function showGallery() {
    hideZoneLocked();
    $("#login-btn").classList.add("hidden");
    $("#changepwd-btn").classList.remove("hidden");
    $("#logout-btn").classList.remove("hidden");
    $("#login-view").classList.add("hidden");
    $("#gallery-view").classList.remove("hidden");
    if (!galleryLoaded) { galleryLoaded = true; loadGallery(); }
    Common.notices.load();
  }

  // 视觉专区不可用时的说明面板（替代"直接弹回登录页"，避免用户反复登录也进不去）
  const ZONE_LABELS = {
    visual: "视觉专区", trend: "趋势专区", recruit: "招品回品",
    bestseller: "BESTSELLER", marketing: "营销日历", notice: "公告", rank: "趋势上升榜"
  };
  function hideZoneLocked() {
    const b = document.getElementById("zone-locked");
    if (b) b.style.display = "none";
  }
  function showZoneLocked() {
    const globalOff = !!(zoneVis && zoneVis.visual === false);
    const white = (Array.isArray(myZones) && myZones.length) ? myZones : null;
    const lackInWhite = !!white && white.indexOf("visual") === -1;
    let box = document.getElementById("zone-locked");
    if (!box) {
      box = document.createElement("div");
      box.id = "zone-locked";
      box.setAttribute("style", "position:fixed;inset:0;z-index:60;background:rgba(24,24,28,.92);display:none;align-items:center;justify-content:center;padding:20px;overflow:auto");
      document.body.appendChild(box);
    }
    const reasons = [];
    if (globalOff) reasons.push("全站已关闭「视觉专区」的前台可见开关");
    if (lackInWhite) reasons.push("本账号被单独限定了前台可见专区，且不含「视觉专区」（当前限定：" + white.map(k => ZONE_LABELS[k] || k).join("、") + "）");
    if (!reasons.length) reasons.push("当前访问条件不满足视觉专区的开放要求");
    const fix = globalOff
      ? "进入后台 → ⑪ 超管权限 → 前台访问设置 → 把「视觉专区」切回「展示」。"
      : (lackInWhite
        ? "进入后台 → 权限管理 → 点本账号所在行的「编辑」→ 在「用户级可见专区（前台）」勾上「视觉专区」→ 保存（若全部取消勾选，则恢复为跟随全站设置）。"
        : "请联系超级管理员在后台「权限管理 / 前台访问设置」中开放「视觉专区」。");
    box.innerHTML =
      '<div style="max-width:580px;width:100%;background:#fff;border-radius:16px;padding:28px 26px;box-shadow:0 24px 60px rgba(0,0,0,.35)">' +
        '<div style="font-size:12px;letter-spacing:.2em;color:#b08d57;font-weight:700">TREND BANK</div>' +
        '<h2 style="margin:10px 0 8px;font-size:20px;color:#1f1f1f">视觉专区暂时进不去</h2>' +
        '<p style="margin:0 0 16px;color:#666;font-size:14px;line-height:1.6">' +
          (window.__loggedIn ? "你的账号已登录，但没有「视觉专区」的前台可见权限，所以之前会被反复弹回登录页。" : "「视觉专区」当前未对外开放，登录也无法进入。") +
        '</p>' +
        '<div style="background:#fdf6ec;border:1px solid #f0dfc2;border-radius:10px;padding:12px 14px;margin-bottom:14px">' +
          '<div style="font-weight:700;color:#8a6a2f;margin-bottom:6px;font-size:14px">原因</div>' +
          reasons.map(r => '<div style="color:#6b6b6b;font-size:14px;line-height:1.7">· ' + escHtml(r) + '</div>').join("") +
        '</div>' +
        '<div style="background:#f6f8fa;border-radius:10px;padding:12px 14px;margin-bottom:18px">' +
          '<div style="font-weight:700;color:#444;margin-bottom:6px;font-size:14px">怎么解决</div>' +
          '<div style="color:#666;font-size:14px;line-height:1.7">' + escHtml(fix) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<a href="trends.html" style="flex:1;min-width:150px;text-align:center;padding:11px 16px;border-radius:10px;background:#1f1f1f;color:#fff;text-decoration:none;font-size:14px;box-sizing:border-box">先去趋势专区</a>' +
          '<button id="zone-locked-out" type="button" style="flex:1;min-width:150px;padding:11px 16px;border-radius:10px;border:1px solid #e0e0e0;background:#fff;color:#444;font-size:14px;cursor:pointer;box-sizing:border-box">退出登录</button>' +
        '</div>' +
      '</div>';
    box.style.display = "flex";
    const ob = document.getElementById("zone-locked-out");
    if (ob) ob.onclick = async () => {
      try { await SB.signOut(); } catch (e) {}
      location.href = "index.html";
    };
  }

  // 中央放大展示公告全文（标题 + 富文本正文 + 附加图片）

  async function loadGallery() {
    readUrl();                     // 先按地址栏恢复上次的类目/标签，再渲染
    try {
      const [active, used, defs, favs] = await Promise.all([
        SB.listActiveCats().catch(() => []),
        SB.listUsedCats().catch(() => []),
        SB.listTagDefs().catch(() => []),
        (SB.myFavCats ? SB.myFavCats() : Promise.resolve([])).catch(() => []),
      ]);
      activeCats = active;
      usedCats = used;
      favCats = (Array.isArray(favs) ? favs : []).map(c => String(c == null ? "" : c).trim()).filter(Boolean);
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
    // 统一走公共专区模块（与榜单页/趋势页/营销日历同一套逻辑），避免各页显隐不一致
    if (window.Common && Common.zones && Common.zones.applyNav) { Common.zones.applyNav(); return; }
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

  // 后台新增的专区（静态菜单里没有的）也要出现在顶部菜单
  /* 当前账号的常用类目（登录后读取，未登录为空）：用于把常用类目排到最前 */
  let favCats = [];
  let catMenuCats = [];   // 最近一次渲染用的类目清单（搜索时按它重绘）

  function renderCatMenu(cats) {
    const menu = $("#cat-menu");
    if (!menu) return;
    catMenuCats = (cats || []).slice();
    const CATS = window.CAT_SEARCH;
    /* 硬兜底：类目关键字里出现 @ —— 类目名不可能带 @，那一定是账号自动填充物。
       直接丢弃这个关键字，否则整个类目列表会被过滤成空，
       用户看到的就是"类目筛选不见了"。 */
    if (CATS) {
      const rawKw = String(CATS.kw("front") || "");
      if (rawKw.indexOf("@") >= 0) CATS.kw("front", "");
    }
    // 搜索框：插在类目菜单上方，只插一次
    if (CATS) {
      CATS.mountBox(menu, "cat-search", "搜索类目…", (v) => { CATS.kw("front", v); renderCatMenu(catMenuCats); });
      const sb = document.getElementById("cat-search");
      if (sb && sb.value !== CATS.kw("front")) sb.value = CATS.kw("front");
    }
    const kwv = CATS ? CATS.kw("front") : "";
    const hitList = CATS ? CATS.filter(catMenuCats, kwv) : catMenuCats.slice();
    const ordered = CATS ? CATS.sortCats(hitList, favCats) : hitList.map(n => ({ name: n, fav: false }));
    // 搜索时若当前选中项被过滤掉，把它钉在顶部，避免"选中了却看不见"
    if (kwv && currentCat && currentCat !== "全部" && !ordered.some(o => o.name === currentCat)) {
      ordered.unshift({ name: currentCat, fav: favCats.indexOf(currentCat) >= 0 });
    }
    menu.innerHTML = "";
    const all = document.createElement("button");
    all.className = "cat-menu-item" + (currentCat === "全部" ? " active" : "");
    all.textContent = "全部";
    all.onclick = () => { currentCat = "全部"; renderCatMenu(catMenuCats); renderGrid("全部"); };
    menu.appendChild(all);
    if (!ordered.length) {
      const tip = document.createElement("div");
      tip.className = "cat-menu-tip";
      tip.textContent = kwv ? "没有匹配的类目（清空搜索框可看全部）" : "暂无类目";
      menu.appendChild(tip);
    }
    ordered.forEach(o => {
      const b = document.createElement("button");
      b.className = "cat-menu-item" + (o.name === currentCat ? " active" : "") + (o.fav ? " cat-menu-fav" : "");
      if (o.fav) {
        const st = document.createElement("span");
        st.className = "cat-fav"; st.title = "我的常用类目"; st.textContent = "★";
        b.appendChild(st);
      }
      b.appendChild(document.createTextNode(o.name));
      b.onclick = () => { currentCat = o.name; renderCatMenu(catMenuCats); renderGrid(o.name); };
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
    lastTagCounts = C;

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

  // 是否有任一标签维度处于筛选状态
  function anyTagFilterOn() {
    return !!(curChannel || curStyle || curElement || curScene || curShoot || curSkin);
  }

  // 清空全部标签筛选并重绘
  function clearTagFilters() {
    curChannel = ""; curStyle = ""; curElement = ""; curScene = ""; curShoot = ""; curSkin = "";
    try { renderTagBar(lastTagCounts); } catch (e) { /* 标签栏未就绪时忽略 */ }
    renderGrid(currentCat);
  }

  // 空态提示：必须说清「为什么是空的」，并给出可操作入口。
  // 历史缺陷：无论"取数接口失败"还是"被标签筛掉"，都统一显示
  //          「没有同时满足所选类目与标签的图片。」——使用者无法判断到底是
  //          数据没了、还是接口挂了，容易被误导成"以前传的图都不见了"。
  async function showEmptyHint(hasFilter, count, ctx) {
    const tip = $("#empty-tip");
    if (!tip) return;
    tip.innerHTML = "";
    if (count > 0) { tip.classList.add("hidden"); return; }
    const c = ctx || {};

    const line = (t) => { const d = document.createElement("div"); d.textContent = t; tip.appendChild(d); };
    const act = (label, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label;
      b.style.cssText = "margin-top:8px;padding:6px 14px;border:1px solid #d9c9a6;border-radius:8px;background:#fff;color:#8a6a2f;font-size:13px;cursor:pointer";
      b.onclick = fn;
      tip.appendChild(b);
    };

    tip.classList.remove("hidden");

    // ① 取数接口失败：这是"故障"，必须与"确实没图"区分开
    if (c.err) {
      line("图片没有取到：前台读图接口调用失败。");
      line("原因：" + String(c.err).slice(0, 160));
      line("若后台能正常看到图片，说明数据还在，是前台这一层没拿到（多为此接口未生效或当前登录态未就绪）。");
      act("重试", () => renderGrid(currentCat));
      return;
    }
    // ② 该分类有图，但被标签筛选清空
    if (anyTagFilterOn()) {
      line("该分类下共有 " + (c.catCount || 0) + " 张图片，但都被当前的标签筛选过滤掉了。");
      act("清除标签筛选", clearTagFilters);
      return;
    }
    // ③ 取数不完整（分页中途失败）：绝不能笼统说"没有图片"，否则会被误认为历史数据丢了
    if (c.incomplete && c.total != null && (c.loaded || 0) < c.total) {
      line("图片只取到一部分：已取 " + (c.loaded || 0) + " / 共 " + c.total + " 张，没有取完。");
      line("所以这个类目看起来是空的，但图片数据仍在（后台能看到），是前台这次没取全。");
      act("重试", () => renderGrid(currentCat));
      return;
    }
    // ④ 该分类确实没有图片
    if (hasFilter) {
      line("该分类下暂时没有图片。");
      line("该分类仍显示在清单中，可先切回「全部」确认整站图片是否正常。");
      return;
    }
    // ⑤ 整站没有图片
    line("该专区暂时没有可浏览的图片。");
  }

  async function loadNextPage() {
    if (!pageHasMore || pageLoading) return;
    pageLoading = true;
    try {
      let chunk;
      try {
        chunk = await SB.listFrontendImages(PAGE_SIZE, pageOffset);
      } catch (e) {
        // 取数失败：把真实原因显示出来，而不是让页面显示"该分类没有图片"
        pageErr = (e && (e.message || e.error_description)) || "未知原因";
        await showEmptyHint(false, 0, { err: pageErr });
        return;
      }
      pageErr = "";
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
      showEmptyHint(false, catalog.length, { err: pageErr });
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

  // 把当前视图（类目 / 标签筛选）写回地址栏：刷新后停在同一处，不会回到默认「全部」
  function syncUrl() {
    try {
      if (!window.history || !history.replaceState) return;
      const q = new URLSearchParams(location.search);
      if (currentCat && currentCat !== "全部") q.set("cat", currentCat); else q.delete("cat");
      const put = (k, v) => { if (v) q.set(k, v); else q.delete(k); };
      put("ch", curChannel); put("st", curStyle); put("el", curElement);
      put("sc", curScene); put("sh", curShoot); put("sk", curSkin);
      const next = location.pathname + "?" + q.toString();
      if (next !== location.pathname + location.search) history.replaceState(null, "", next);
    } catch (e) { /* 忽略 */ }
  }
  function readUrl() {
    try {
      const q = new URLSearchParams(location.search);
      const c = q.get("cat");
      if (c) currentCat = c;
      const ch = q.get("ch"); if (ch) curChannel = ch;
      const st = q.get("st"); if (st) curStyle = st;
      const el = q.get("el"); if (el) curElement = el;
      const sc = q.get("sc"); if (sc) curScene = sc;
      const sh = q.get("sh"); if (sh) curShoot = sh;
      const sk = q.get("sk"); if (sk) curSkin = sk;
    } catch (e) { /* 无参数 */ }
  }

  async function renderGrid(setCat) {
    if (setCat) currentCat = setCat;
    syncUrl();
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
      // 先清空上一次的空态提示，等首个分页结果回来后再按真实情况显示
      { const _et = $("#empty-tip"); if (_et) { _et.innerHTML = ""; _et.classList.add("hidden"); } }
      pageHasMore = true;
      await loadNextPage();
      return;
    }

    // ===== 筛选视图：分页取全量（保证计数准确，且不会被单次返回上限截断）=====
    let imgs = [];
    let readErr = "";
    let incomplete = false;
    let expectTotal = null;
    try {
      const r = await SB.listAllFrontendImages();
      imgs = (r && r.rows) || [];
      expectTotal = (r && typeof r.total === "number") ? r.total : null;
      incomplete = !!(r && r.complete === false);
    } catch (e) {
      readErr = (e && (e.message || e.error_description)) || "未知原因";
      Auth.toast("读取图片失败", false);
    }
    if (!readErr && incomplete) incomplete = true;
    const loadedCount = imgs.length;   // 本次实际取到的条数（用于"取数不完整"提示，不能取筛选后的数量）
    const catImgs = imgs.filter(i => catCatVisible("visual", i.category));
    catCounts = {};
    catImgs.forEach(i => { const c = i.category || "未分类"; catCounts[c] = (catCounts[c] || 0) + 1; });
    const _catImgsAll = catImgs;
    imgs = catImgs.filter(_match);
    renderTagBar(countsFromList(_catImgsAll));

    await showEmptyHint(hasFilter, imgs.length, { err: readErr, catCount: _catImgsAll.length, loaded: loadedCount, total: expectTotal, incomplete: incomplete });
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
  // 注册后若开启邮箱确认：展示醒目的确认引导面板，隐藏登录表单，支持重新发送确认邮件

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#auth-email").value.trim();
    const pass = $("#auth-pass").value;
    if (!email || !pass) { Auth.toast("请输入邮箱和密码", false); return; }
    if (authMode === "register") {
      const { data, error } = await SB.signUp(email, pass);
      if (error) { Auth.toast("注册失败：" + error.message, false); return; }
      if (data && data.session) {
        // 后台未开启邮箱确认 → 直接自动登录
        Auth.toast("注册成功，已登录");
        setTimeout(() => location.reload(), 800);
      } else {
        // 后台开启了邮箱确认 → 展示醒目的邮件确认引导
        Auth.toast("注册成功！请到邮箱完成确认", true);
        Common.authConfirm.show(email);
      }
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
  $("#logout-btn").onclick = async () => {
    await SB.signOut();
    try { sessionStorage.removeItem("nl_landed"); } catch (e) {}   // 退出后重置落地标记：下次登录仍默认进榜单
    refreshAuthUI();
  };

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

  // ---------- 视觉专区：按类目导出图片清单 ----------
  // 数据源用「前台全量取图」而不是当前已加载页：默认「全部」视图是无限滚动的，
  // catalog 里只有滚过的那部分，直接导出会少图。
  (function bindCatExport() {
    const btn = $("#cat-export-btn");
    if (!btn) return;
    btn.onclick = async () => {
      const msg = $("#cat-export-msg");
      const say = (t) => { if (msg) msg.textContent = t || ""; };
      if (!window.ImageExport) { say("导出模块未加载，请强刷页面"); return; }
      btn.disabled = true;
      say("正在读取图片清单…");
      try {
        const r = await SB.listAllFrontendImages();
        const all = ((r && r.rows) || []).filter(i => catCatVisible("visual", i.category));
        const picked = all.filter(_match);          // 复用当前类目 + 标签筛选条件
        if (!picked.length) { say("当前条件下没有可导出的图片"); btn.disabled = false; return; }
        say("正在生成文件…");
        const catName = (currentCat && currentCat !== "全部") ? currentCat : "";
        await ImageExport.exportOne(picked, { scope: "all", category: catName }, function (t) { say(t); });
      } catch (e) {
        say("导出失败：" + ((e && e.message) || "未知错误"));
      } finally {
        btn.disabled = false;
      }
    };
  })();
})();
