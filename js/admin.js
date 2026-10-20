/* ============================================================
 * TREND BANK · 后台管理（core）
 * 说明：本文件由原单文件 admin.js 按面板拆分而来。
 *  - 共享状态在文件顶部声明（全局作用域，跨文件可见）
 *  - 函数定义在文件内 IIFE 中，末尾通过 Object.assign(window, {...}) 暴露给其它模块
 * ============================================================ */

/* ---------- 共享状态 ---------- */
const $ = (sel) => document.querySelector(sel);

let pendingFiles = [];

let uploading = false;

let currentUser = null;

let currentRole = null;

let currentZones = null;

// 当前登录用户已授权专区（manage_zones 数组；null/空 = 未配置，回退全局）
let currentFavCats = [];

// 当前管理员常用类目
let currentActiveCats = [];

// 已被删除的类目名（压住 config.js 内置候选清单，否则删完会被带回来）
let catRemoved = [];

// 前台类目（categories 表）
let currentCatOrder = [];

// 前台类目顺序 [{id,name,sort_order}]
let currentManageCat = "全部";

// 图片管理当前选中类目（"全部" = 显示全部）
let selectedImages = new Set();

//   标签管理→visual，数据看板→任一授权专区即可，公告→notice，营销日历→marketing，超管→super
const PANEL_ZONE = {
  "manage-card": "visual",
  "tag-card": "visual",
  "rank-card": "",          // 站内趋势上升榜单：任一管理员均可进入（不限专区）
  "mk-card": "super",       // 营销日历（节庆库）：全站共用的基础数据，仅超管维护
  "trend-card": "trend",
  "recruit-card": "recruit",
  "bestseller-card": "bestseller",
  "marketing-card": "marketing",
  "notice-card": "notice",
  "super-card": "super",
  "insight-card": "",       // 用户动向：任一授权专区即可（与数据看板同口径）
  "backup-card": "super",   // 版本恢复：仅超管
};

const isSuper = () => currentRole === "super_admin";

const isAdmin = () => currentRole === "admin" || currentRole === "super_admin";

// ================= 前台预览（后台内嵌，无需另开页面） =================
let previewPage = "index.html";

let panelReady = false;

// ================= 前台访问模式开关（公开浏览 / 必须登录） =================
let catVisCfg = {};

// 四个专区（key 与前端 readZone 一致）：视觉 / 趋势 / 招品 / BESTSELLER
const CAT_VIS_ZONES = [
  { key: "marketing", label: "营销日历" },
  { key: "visual", label: "视觉专区" },
  { key: "trend", label: "趋势专区" },
  { key: "recruit", label: "招品回品" },
  { key: "bestseller", label: "BESTSELLER" },
  { key: "notice", label: "公告" },
  { key: "rank", label: "趋势上升榜" }
];

// 当前生效的专区定义（内置 7 个 + 超管在「专区管理」里新增的），
// 由 reloadZoneDefs() 载入；「专区可见开关」「专区类目可见」「权限管理勾选」共用这一份。
let ZONE_DEFS = CAT_VIS_ZONES.map(z => Object.assign({}, z));

async function reloadZoneDefs() {
  let defs = null;
  try { defs = await SB.getZoneDefs(); } catch (e) { defs = null; }
  if (Array.isArray(defs) && defs.length) {
    ZONE_DEFS = defs.filter(d => d && d.key).map(d => ({ key: String(d.key), label: String(d.label || d.key), href: String(d.href || "") }));
  } else {
    ZONE_DEFS = CAT_VIS_ZONES.map(z => Object.assign({}, z));
  }
  if (window.Common && Common.zones) Common.zones.setDefs(ZONE_DEFS);
  return ZONE_DEFS;
}

// 各专区 本身 前台可见开关
let zoneVisCfg = {};
(function () {

// 当前角色是否被授权可进入某面板
  function canAccessPanel(target) {
    // 超管不受限
    if (isSuper()) return true;
    // 管理员之外（访客）一律不可操作后台任何面板
    if (currentRole !== "admin") return false;
    const zone = PANEL_ZONE[target];
    // 数据看板 / 趋势上升榜：任一已授权专区即可访问（不限专区）
    if (target === "rank-card" || target === "insight-card") return true;
    if (!zone) return false;
    // 超级专区（超管专属）
    if (zone === "super") return false;
    // 已配置用户级白名单：仅允许授权专区
    if (Array.isArray(currentZones) && currentZones.length) {
      return currentZones.indexOf(zone) !== -1;
    }
    // 未配置专区白名单的管理员：默认放行全部业务专区的写操作（向后兼容），超管面板除外
    return zone !== "super";
  }

// 当前角色是否可对某专区执行写/管理操作（供各写操作入口统一守卫）
  function canOperateZone(zone) {
    // 超管固定放行；访客一律禁止
    if (isSuper()) return true;
    if (currentRole !== "admin") return false;
    if (!zone) return false;
    // 管理员可管理「公告」「营销日历」「数据看板」等通用管理能力（若已授权对应面板）
    if (["notice", "marketing"].indexOf(zone) !== -1) {
      if (Array.isArray(currentZones) && currentZones.length) return currentZones.indexOf(zone) !== -1;
      return true;
    }
    // 业务专区（visual/trend/recruit/bestseller）严格按授权专区判定
    if (Array.isArray(currentZones) && currentZones.length) {
      return currentZones.indexOf(zone) !== -1;
    }
    // 未配置专区白名单的管理员：默认放行（向后兼容，其管理范围按全局可见专区）
    return true;
  }

// 统一写操作守卫：无权限时 toast 拦截并返回 false
  function guardZone(zone, msg) {
    if (!canOperateZone(zone)) { sbToast(msg || "无权限：请让超管为你的账号开放对应专区", false); return false; }
    return true;
  }

// ================= 后台侧边菜单 =================
  function bindAdminNav() {
    bindVisualTabs();
    document.querySelectorAll("#admin-panel .nav-item").forEach(item => {
      item.addEventListener("click", () => switchPanel(item.dataset.target));
    });
  }

// 视觉专区内的两个子页签：图片管理 / 数据看板
let visualTab = "manage";

function setVisualTab(name) {
    visualTab = name === "dash" ? "dash" : "manage";
    const paneM = document.getElementById("vis-manage");
    const paneD = document.getElementById("vis-dash");
    if (paneM) paneM.classList.toggle("hidden", visualTab !== "manage");
    if (paneD) paneD.classList.toggle("hidden", visualTab !== "dash");
    document.querySelectorAll("#admin-panel .vis-tab").forEach(b => {
      const on = b.dataset.vtab === visualTab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    // 数据看板：切到子页时才拉数据，避免进后台就多一次请求
    if (visualTab === "dash") { buildDashCatFilter(); loadDashboard(); }
}

function bindVisualTabs() {
    document.querySelectorAll("#admin-panel .vis-tab").forEach(b => {
      b.addEventListener("click", () => setVisualTab(b.dataset.vtab));
    });
}

function switchPanel(target) {
    // 权限守卫：当前角色无权访问该面板时拦截（防菜单隐藏后仍被 JS 调用/手动切换）
    if (!canAccessPanel(target)) {
      sbToast("无权限：当前账号不可操作该面板", false);
      return;
    }
    // 统一全隐藏所有后台面板，保证任意时刻只展示选中面板，杜绝内容堆叠
    document.querySelectorAll("#admin-panel .panel-card").forEach(el => el.classList.add("hidden"));
    const show = document.getElementById(target);
    if (show) show.classList.remove("hidden");
    // 高亮当前菜单
    document.querySelectorAll("#admin-panel .nav-item").forEach(n => {
      n.classList.toggle("active", n.dataset.target === target);
    });
    // 视觉专区：合并了「图片管理 + 数据看板」，进入时回到上次的子页签
    if (target === "manage-card") { setVisualTab(visualTab); }
    if (target === "tag-card") { loadTagDefs(); loadFavCats(); loadCatMgmt(); }
    if (target === "trend-card") { loadTrendList(); }
    if (target === "recruit-card") { loadRecruitList(); loadRecruitCatPicker(); loadRecruitCatSettings(); if (typeof window.loadRecruitDashStats === "function") window.loadRecruitDashStats(); }
    if (target === "bestseller-card") { loadBestsellerList(); loadBestsellerCatPicker(); loadBestsellerCatSettings(); }
    if (target === "super-card") { loadPermPanel(); loadNoticeAdminList(); loadAccess(); loadExportPanel(); }
    // 营销日历：节庆库（原生编辑器，直接在本页编辑；旧的素材区块已下线）
    if (target === "mk-card") {
      if (window.FEST && typeof FEST.mount === "function") FEST.mount();
    }
    if (target === "rank-card" && typeof enterRankPanel === "function") { enterRankPanel(); }
    // 用户动向：三个子页各自懒加载（只读，不发写请求）
    if (target === "insight-card" && typeof loadInsight === "function") { loadInsight(); }
    // 版本恢复：列出快照（不自动生成，避免每次进入都占用一次快照名额）
    if (target === "backup-card" && typeof loadBackupList === "function") { loadBackupList(); loadBackupPolicy(); }
  }


/* ============================================================
 * 营销日历 · 节庆库编辑器（20261019G）
 * 后台不再嵌 iframe：节庆库由 js/admin-festival.js 直接画在本面板里，
 * 与前台同一份样式与数据源，卡片/节点上就地编辑，保存写库即时生效。
 * 面板首次进入时才挂载（懒加载），避免一进后台就多一次读库请求。
 * ============================================================ */
let mkFestMounted = false;
function mountMarketingFestival(force) {
  if (!window.FEST || typeof FEST.mount !== "function") return;
  if (force) mkFestMounted = false;
  if (mkFestMounted) return;
  mkFestMounted = FEST.mount() !== false;
}

function setPreviewTab(url) {
    document.querySelectorAll("#preview-mask .preview-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.pview === url);
    });
  }

function setPreviewFrame(url) {
    const frame = $("#preview-frame");
    frame.src = "about:blank";
    setTimeout(() => { frame.src = url; }, 30);
  }

function openPreview() {
    previewPage = "index.html";
    setPreviewTab("index.html");
    $("#preview-mask").classList.remove("hidden");
    document.body.classList.add("no-scroll");
    $("#preview-frame").src = "index.html";
  }

function closePreview() {
    const mask = $("#preview-mask");
    if (!mask || mask.classList.contains("hidden")) return;
    mask.classList.add("hidden");
    document.body.classList.remove("no-scroll");
    $("#preview-frame").src = "about:blank";
  }

function refreshPreview() {
    setPreviewFrame(previewPage);
  }

function switchPreviewPage(url) {
    previewPage = url;
    setPreviewTab(url);
    setPreviewFrame(url);
  }

function openPreviewInNewTab() {
    window.open(previewPage, "_blank");
  }

/* 超管权限面板：子页签切换（公告管理 / 权限管理 / 前台访问设置 / 数据导出 / 存量图片压缩池）
 * 说明：这一段的绑定原先放在已下线的旧营销脚本里，模块删除后子页签就点不动了，
 * 现改为在本文件内实现，并由初始化清单统一绑定（20261019O 修复）。 */
function bindSuperTabs() {
  const tabs = Array.prototype.slice.call(document.querySelectorAll("#super-tabs .super-tab"));
  if (!tabs.length) return;
  const subs = Array.prototype.slice.call(document.querySelectorAll("#super-card .super-sub"));
  const apply = (key) => {
    tabs.forEach(t => t.classList.toggle("active", t.dataset.sv === key));
    subs.forEach(sp => { sp.style.display = (sp.dataset.sv === key) ? "" : "none"; });
  };
  tabs.forEach(t => {
    if (t.dataset.bound === "1") return;
    t.dataset.bound = "1";
    t.addEventListener("click", () => apply(t.dataset.sv));
  });
  const active = tabs.filter(t => t.classList.contains("active"))[0] || tabs[0];
  if (active) apply(active.dataset.sv);
}

function bindPreview() {
    const btn = $("#admin-preview-btn");
    if (btn) btn.addEventListener("click", openPreview);
    const close = $("#preview-close");
    if (close) close.addEventListener("click", closePreview);
    const refresh = $("#preview-refresh");
    if (refresh) refresh.addEventListener("click", refreshPreview);
    const open = $("#preview-open");
    if (open) open.addEventListener("click", openPreviewInNewTab);
    document.querySelectorAll("#preview-mask .preview-tab").forEach(t => {
      t.addEventListener("click", () => switchPreviewPage(t.dataset.pview));
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePreview();
    });
  }

async function saveCatOrder() {
    const rows = [...document.querySelectorAll("#cat-order-box .cat-order-item")];
    if (!rows.length) { sbToast("没有需要保存的类目", false); return; }
    try {
      for (const row of rows) {
        const id = row.dataset.id;
        const num = parseInt(row.querySelector(".order-num").value, 10);
        await SB.setCategoryOrder(id, (Number.isFinite(num) && num >= 1) ? num : 1);
      }
      currentCatOrder = await SB.listActiveCatsWithOrder();
      renderCatOrder();
      sbToast("展示顺序已保存");
      const btn = $("#cat-order-save");
      if (btn) btn.disabled = true;
    } catch (e) { sbToast("保存失败：" + (e.message || ""), false); }
  }

// 顶部显示当前用户与角色
  async function refreshUserBadge() {
    const el = $("#token-status");
    if (!currentUser) { el.textContent = "未登录"; return; }
    currentRole = await SB.myRole();
    // 加载当前用户已授权专区（前台同款白名单；null = 未配置回退全局）
    try { currentZones = await SB.myManageZones().catch(() => null); } catch (e) { currentZones = null; }
    const roleLabel = currentRole === "super_admin" ? "超级管理员" : (currentRole === "admin" ? "管理员" : "访客");
    el.textContent = currentUser.email + " · " + roleLabel;
    el.classList.toggle("bad", currentRole !== "admin" && currentRole !== "super_admin");
    const canManage = isAdmin();
    // 侧边菜单：仅展示当前角色可访问的面板
    document.querySelectorAll("#admin-panel .nav-item").forEach(n => {
      // 超管专属菜单（权限管理）仅超管可见
      if (n.dataset.super === "1") { n.classList.toggle("hidden", !isSuper()); return; }
      n.classList.toggle("hidden", !canAccessPanel(n.dataset.target));
    });
    // 类目设置等超管专属按钮（data-super="1"）仅超管可见
    document.querySelectorAll("#admin-panel [data-super='1']:not(.nav-item)").forEach(n => {
      n.classList.toggle("hidden", !isSuper());
    });
    // ── 角色就绪后的强制纠错 ──
    // 若此前因异步竞态（菜单已渲染但角色未就绪）误进入"访客无权限"分支，此处强制纠正：
    // 只要当前角色是管理员/超管，就隐藏无权限提示并重新进入后台，消除"菜单在、主区无权限"的分裂状态。
    if (isAdmin()) {
      const noPermEl = document.querySelector("#no-perm");
      if (noPermEl) noPermEl.classList.add("hidden");
      const panelEl = document.querySelector("#admin-panel");
      // 若后台面板已显示但主区仍未正常进入（卡在无权限），重置后重新进入
      if (panelReady && panelEl && !panelEl.classList.contains("hidden") && document.querySelectorAll("#admin-panel .panel-card:not(.hidden)").length === 0) {
        panelReady = false;
        enterPanel();
      }
    }
  }

// ================= 登录 / 退出 =================
  function bindLogin() {
    $("#admin-login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#admin-email").value.trim();
      const pass = $("#admin-pass").value;
      if (!email || !pass) { sbToast("请输入邮箱和密码", false); return; }
      const { error } = await SB.signIn(email, pass);
      if (error) sbToast("登录失败：" + (error.message || ""), false);
    });
  }

function bindLogout() {
    const logBtn = $("#admin-logout");
    if (!logBtn) return;
    logBtn.onclick = async () => {
      try {
        await SB.signOut();
        location.reload();
      } catch (e) {
        // 登出请求失败时给出提示并强制刷新，避免"点了没反应"
        sbToast("退出失败，请重试", false);
        location.reload();
      }
    };
  }

function bindChangepwd() {
    const btn = $("#admin-changepwd");
    const modal = $("#pwd-modal");
    if (!btn || !modal) return;
    const closeModal = () => modal.classList.add("hidden");
    btn.onclick = () => {
      const o = $("#pwd-old"), n = $("#pwd-new"), n2 = $("#pwd-new2");
      if (o) o.value = ""; if (n) n.value = ""; if (n2) n2.value = "";
      modal.classList.remove("hidden");
      if (o) o.focus();
    };
    const c1 = $("#pwd-cancel"); if (c1) c1.onclick = closeModal;
    const c2 = $("#pwd-close"); if (c2) c2.onclick = closeModal;
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
    const submit = $("#pwd-submit");
    if (submit) submit.onclick = async () => {
      const o = $("#pwd-old").value.trim();
      const n = $("#pwd-new").value;
      const n2 = $("#pwd-new2").value;
      if (!o) return sbToast("请输入旧密码", false);
      if (!n || n.length < 6) return sbToast("新密码至少6位", false);
      if (n !== n2) return sbToast("两次输入的新密码不一致", false);
      try {
        const r = await SB.changePassword(o, n);
        if (r.error) return sbToast(r.error.message || "修改失败", false);
        sbToast("密码修改成功", true);
        closeModal();
      } catch (e) { sbToast("修改失败，请重试", false); }
    };
  }

// 面板级防重入：已进入后台且用户未切换时，不再重复加载/拉回图片管理，避免反复重绘与菜单被覆盖
  async function enterPanel() {
    if (panelReady) return;
    // 角色就绪保护：若角色尚未加载完成（异步竞态），先等待加载，避免误判为"访客无权限"
    if (currentRole === null) {
      try { await refreshUserBadge(); } catch (e) {}
    }
    panelReady = true;
    $("#admin-login").classList.add("hidden");
    $("#admin-panel").classList.remove("hidden");
    if (currentRole !== "admin" && currentRole !== "super_admin") {
      // 访客（或异常角色）：不可操作后台任何功能，仅展示无权限提示
      document.querySelectorAll("#admin-panel .panel-card").forEach(el => el.classList.add("hidden"));
      document.querySelectorAll("#admin-panel .nav-item").forEach(n => n.classList.add("hidden"));
      const np = $("#no-perm");
      if (np) np.classList.remove("hidden");
      return;
    }
    const noPerm = $("#no-perm");
    if (noPerm) noPerm.classList.add("hidden");
    // 进入后台不再预加载「全部已上传图片」列表（省图片请求）；改为关闭智能打标后再加载（见 ensureManageLoaded）
    loadCats();
    if (isAdmin()) { loadFavCats(); loadCatMgmt(); loadTagDefs(); }
    loadAccess();
    // 默认进入第一个当前角色可访问的面板（超管/全量管理员：图片管理；专区受限管理员：其授权专区页面）
    const firstPanel = document.querySelector("#admin-panel .nav-item:not(.hidden)");
    const defaultTarget = firstPanel ? firstPanel.dataset.target : "manage-card";
    switchPanel(defaultTarget);
    // 需求（本版）：进入后台直接展示智能打标内容，不再展示「全部已上传图片」
    // → 默认全屏打开智能打标；关闭它之后才自动加载并显示图片列表（见 closeSmartModal）
    if (defaultTarget === "manage-card" && typeof openSmartModal === "function") {
      openSmartModal();
      if (typeof toggleSmartFullscreen === "function") {
        const _sm = document.querySelector("#smart-modal");
        if (_sm && !_sm.classList.contains("fullscreen")) toggleSmartFullscreen();
      }
    } else {
      // 其它情形（如专区受限管理员默认进其授权专区）：维持原有加载
      loadManage();
    }
  }

// ================= 登录 / 注册引导 =================
  function bindToken() {
    // 后台登录页提供“注册”入口，便于用户创建首个账号，再在数据库里赋予管理员角色
    $("#admin-toggle").onclick = (e) => {
      e.preventDefault();
      sbToast("请先用邮箱注册（下方），注册后再到数据库把该用户设为管理员（见 README）");
    };
    $("#admin-signup-btn").onclick = async () => {
      const email = $("#admin-email").value.trim();
      const pass = $("#admin-pass").value;
      if (!email || !pass) { sbToast("请填写邮箱和密码", false); return; }
      const { data, error } = await SB.signUp(email, pass);
      if (error) { sbToast("注册失败：" + (error.message || ""), false); return; }
      sbToast("注册成功，已登录。现在去 Supabase 数据库把该用户设为管理员（见 README）");
    };
  }

async function loadAccess() {
    const toggle = document.querySelector("#public-access-toggle");
    if (!toggle) return;
    try {
      const pub = await SB.getPublicAccess();
      document.querySelector("#public-access-toggle").checked = !!pub;
      document.querySelector("#access-save").disabled = true;
    } catch (e) { /* 忽略读取失败 */ }
    await reloadZoneDefs();
    await loadCatVisibility();
    await loadZoneVisibility();
  }

// { zone: true/false }
  async function loadZoneVisibility() {
    const box = document.querySelector("#zone-visibility-box");
    if (!box) return;
    try { zoneVisCfg = await SB.getFrontendZoneVisibility(); } catch (e) { zoneVisCfg = {}; }
    box.innerHTML = "";
    for (const z of ZONE_DEFS) {
      const item = document.createElement("div");
      const on = zoneVisCfg[z.key] !== false; // 未配置默认可见
      item.className = "cat-vis-item " + (on ? "on" : "off");
      item.innerHTML = `<span class="cvi-name">${escHtml(z.label)}</span><span class="fds-switch${on ? " on" : ""}"><i></i></span><span class="cvi-state" style="font-size:12px;color:var(--sub);">${on ? "展示" : "隐藏"}</span>`;
      item.onclick = async () => {
        const next = !on;
        // 乐观更新 UI
        item.className = "cat-vis-item " + (next ? "on" : "off");
        item.querySelector(".fds-switch").classList.toggle("on", next);
        item.querySelector(".cvi-state").textContent = next ? "展示" : "隐藏";
        zoneVisCfg[z.key] = next;
        try {
          await SB.setFrontendZoneVisibility(z.key, next);
          sbToast(`${z.label}专区已${next ? "开启前台展示" : "隐藏前台入口"}`);
        } catch (e) {
          // 回退
          item.className = "cat-vis-item " + (on ? "on" : "off");
          item.querySelector(".fds-switch").classList.toggle("on", on);
          item.querySelector(".cvi-state").textContent = on ? "展示" : "隐藏";
          sbToast("保存失败：" + (e.message || ""), false);
        }
      };
      box.appendChild(item);
    }
  }

// 读取可见性配置 + 各专区类目池，渲染可见开关列表
  async function loadCatVisibility() {
    const box = document.querySelector("#cat-visibility-box");
    if (!box) return;
    try { catVisCfg = await SB.getFrontendCatVisibility(); } catch (e) { catVisCfg = {}; }
    // 视觉/趋势专区：用前台类目表；招品/BESTSELLER：用各自专区类目表
    const zonesMeta = { visual: "cats", trend: "cats", recruit: "recruit", bestseller: "bestseller" };
    box.innerHTML = "";
    for (const z of ZONE_DEFS) {
      const wrap = document.createElement("div");
      wrap.className = "cat-vis-zone";
      const head = document.createElement("div");
      head.className = "cat-vis-zone-head";
      head.textContent = z.label;
      // 类目池
      let cats = [];
      try { cats = await SB.listZoneCatsForVis(z.key); } catch (e) {}
      const visMap = catVisCfg[z.key] || {};
      const listWrap = document.createElement("div");
      listWrap.className = "cat-vis-list";
      if (!cats.length) {
        const empty = document.createElement("span");
        empty.className = "cat-vis-empty";
        empty.textContent = "暂无类目";
        listWrap.appendChild(empty);
      } else {
        cats.forEach(cat => {
          const item = document.createElement("div");
          const on = visMap[cat] !== false; // 未配置默认可见
          item.className = "cat-vis-item " + (on ? "on" : "off");
          item.innerHTML = `<span class="cvi-name">${escHtml(cat)}</span><span class="fds-switch${on ? " on" : ""}"><i></i></span><span class="cvi-state" style="font-size:12px;color:var(--sub);">${on ? "展示" : "隐藏"}</span>`;
          item.onclick = async () => {
            const next = !on;
            // 乐观更新 UI
            item.className = "cat-vis-item " + (next ? "on" : "off");
            item.querySelector(".fds-switch").classList.toggle("on", next);
            item.querySelector(".cvi-state").textContent = next ? "展示" : "隐藏";
            catVisCfg[z.key] = catVisCfg[z.key] || {};
            catVisCfg[z.key][cat] = next;
            try {
              await SB.setFrontendCatVisibility(z.key, cat, next);
              sbToast(`${z.label}「${cat}」已${next ? "开启前台展示" : "隐藏前台内容"}`);
            } catch (e) {
              // 回退
              item.className = "cat-vis-item " + (on ? "on" : "off");
              item.querySelector(".fds-switch").classList.toggle("on", on);
              item.querySelector(".cvi-state").textContent = on ? "展示" : "隐藏";
              sbToast("保存失败：" + (e.message || ""), false);
            }
          };
          listWrap.appendChild(item);
        });
      }
      wrap.appendChild(head);
      wrap.appendChild(listWrap);
      box.appendChild(wrap);
    }
  }

function bindAccess() {
    const toggle = document.querySelector("#public-access-toggle");
    const save = document.querySelector("#access-save");
    if (toggle && save) {
      toggle.addEventListener("change", () => { save.disabled = false; });
      save.addEventListener("click", async () => {
        const val = toggle.checked;
        try {
          await SB.setPublicAccess(val);
          sbToast(val ? "已开启公开浏览，前台免登录可见" : "已关闭公开浏览，前台需登录可见");
          save.disabled = true;
        } catch (e) {
          sbToast("保存失败：" + (e.message || ""), false);
        }
      });
    }
  }
document.addEventListener("DOMContentLoaded", () => {
    // 先注册登录状态监听：保证任何后续界面绑定异常都不影响登录进入后台
    let enteredUserId = null; // 防重入：只跟踪真正切换的登录用户，避免 token 刷新触发重复 enterPanel

    // 未登录兜底：显示登录页、隐藏后台、揭开加载遮罩
    function showLoginView() {
      $("#admin-login").classList.remove("hidden");
      $("#admin-panel").classList.add("hidden");
      const sp = document.getElementById("boot-splash");
      if (sp) sp.classList.add("hidden");
    }

    // 统一的登录态处理：启动主动读取 + 后续登录态变化共用同一份逻辑
    async function applyAuthState(session) {
      currentUser = session ? session.user : null;
      // 先异步加载当前用户角色/专区，再进入后台，避免 enterPanel 读到尚未就绪的角色而误判为"访客无权限"
      await refreshUserBadge();
      const uid = session && session.user ? session.user.id : null;
      if (session) {
        if (enteredUserId !== uid) {
          enteredUserId = uid;
          enterPanel();
        }
        // 已进入同一用户（token 刷新等重复回调）时不重复 enterPanel，避免图片列表反复重绘闪跳
      } else {
        enteredUserId = null;
        panelReady = false; // 登出后允许下次登录重新进入后台
        currentRole = null; // 清掉上一位用户的角色，避免残留角色影响下次登录判定
        showLoginView();
      }
      // 鉴权判定完成，揭开加载遮罩，避免登录页闪现
      window.__authReady = true;
      const sp = document.getElementById("boot-splash");
      if (sp) sp.classList.add("hidden");
    }

    SB.onAuth((session) => { applyAuthState(session); });

    // 【关键修复】本地化后的登录库（vendor/supabase.js）不会在页面加载时主动推送"首次登录态"：
    // 当浏览器里没有有效会话时（例如刚点过「退出」后刷新），不会有任何登录态回调，
    // 登录页因此永远不显示、页面一直卡在加载遮罩 —— 表现为"退出后登录界面进不去"。
    // 这里在启动时显式读一次登录态，与上面的订阅共用同一份处理逻辑。
    (async () => {
      let session = null;
      try { session = await SB.getSession(); } catch (e) { session = null; }
      applyAuthState(session);
    })();

    // 兜底：3 秒内仍未拿到登录态，则先放出登录页，避免一直卡在加载遮罩
    setTimeout(() => {
      if (!window.__authReady) { window.__authReady = true; showLoginView(); }
    }, 3000);
    // 各项 UI 绑定单独容错：单个元素缺失只影响对应功能，绝不断开登录链路
    // 必须用 typeof 守卫（历史缺陷，20261019O 修复）：若直接写函数名而某模块已被删除，
    // 数组字面量求值会抛 ReferenceError，导致整个绑定序列不执行
    // （表现为「关闭 / Esc / 退出 / 修改密码」全部无反应）。
    const INITERS = [
      typeof bindLogin === "function" && bindLogin,
      typeof bindLogout === "function" && bindLogout,
      typeof bindChangepwd === "function" && bindChangepwd,
      typeof bindToken === "function" && bindToken,
      typeof bindManage === "function" && bindManage,
      typeof bindFavCats === "function" && bindFavCats,
      typeof bindCatMgmt === "function" && bindCatMgmt,
      typeof bindAccess === "function" && bindAccess,
      typeof bindTagDefs === "function" && bindTagDefs,
      typeof bindDashboard === "function" && bindDashboard,
      typeof bindAdminNav === "function" && bindAdminNav,
      typeof bindSuperTabs === "function" && bindSuperTabs,
      typeof bindSmartModal === "function" && bindSmartModal,
      typeof bindTrend === "function" && bindTrend,
      typeof bindNotice === "function" && bindNotice,
      typeof bindRecruit === "function" && bindRecruit,
      typeof bindBestseller === "function" && bindBestseller,
      typeof bindPreview === "function" && bindPreview,
      typeof bindExport === "function" && bindExport,
      typeof bindZoneCatModal === "function" && bindZoneCatModal,
      typeof bindPermission === "function" && bindPermission,
      typeof bindImagePool === "function" && bindImagePool,
      // 已下线模块：bindMarketing 随旧营销脚本一并移除（超管子页签改由本文件 bindSuperTabs 实现）
      typeof bindRankPanel === "function" && bindRankPanel,
    ].filter(fn => typeof fn === "function");
    INITERS.forEach(fn => { try { fn(); } catch (e) { console.warn("init 跳过:", fn.name, e); } });
  });

  /* 暴露给其它模块 / 事件绑定 */
  Object.assign(window, {
    canAccessPanel, canOperateZone, guardZone, bindAdminNav, switchPanel, setPreviewTab, setPreviewFrame, openPreview, closePreview, refreshPreview, switchPreviewPage, openPreviewInNewTab, bindPreview, saveCatOrder, refreshUserBadge, bindLogin, bindLogout, bindChangepwd, enterPanel, bindToken, loadAccess, loadZoneVisibility, loadCatVisibility, bindAccess, bindSuperTabs
  });

})();
