/* ============================================================
 * 营销节日日历前台逻辑：登录校验 + 时间线 + 3:4 卡片区 + 文章跳转 + 微信分享二维码
 * 顶部时间线分布时间节点，每个时间节点对应一张展示图卡片（3:4）；
 * 图片点击跳转对应文章外链；文章可分享到微信（专属链接 + 二维码）。
 * ============================================================ */
(function () {
  const $ = (sel) => document.querySelector(sel);

  let authMode = "register"; // 登录页模式：register 注册 / login 登录
  let nodes = [];            // 时间节点清单
  let articles = [];         // 已发布文章清单
  let zoneVis = {};          // 各专区本身是否前台可见
  let zoneVisLoaded = false; // 专区可见性是否已加载
  let myZones = null;        // 当前登录用户级可见专区白名单
  let activeArticleId = "";  // 当前通过 ?article= 定位的文章
  // 是否开启二维码库（若 qrcode CDN 未加载则仅显示链接，不阻塞主功能）
  const HasQR = () => typeof window.QRCode !== "undefined";

  // HTML转义（卡片标题/描述防注入）
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function toast(msg, ok = true) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.style.background = ok ? "rgba(34,47,38,.92)" : "rgba(120,40,38,.92)";
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function hideSplash() {
    const s = document.getElementById("boot-splash");
    if (s) s.classList.add("hidden");
  }

  // —— 某专区本身是否前台可见（未配置默认可见，支持用户级白名单覆盖） ——
  function zoneVisible(zone) {
    if (Array.isArray(myZones) && myZones.length) {
      if (zoneVis && zoneVis[zone] === false) return false;
      return myZones.indexOf(zone) !== -1;
    }
    return !zoneVis || zoneVis[zone] !== false;
  }

  // 顶部菜单：每个菜单项都可单独被隐藏；营销日历(本页)= marketing
  function applyZoneNav() {
    document.querySelectorAll(".top-tabs .tab-link").forEach(a => {
      const href = a.getAttribute("href") || "";
      const vt = a.getAttribute("data-viewtab") || "";
      let z = null;
      if (href === "index.html") z = "visual";
      else if (vt === "trend" || href === "trends.html") z = "trend";
      else if (vt === "recruit" || href === "trends.html#recruit") z = "recruit";
      else if (vt === "bestseller" || href === "trends.html#bestseller") z = "bestseller";
      else if (vt === "marketing" || href === "marketing.html") z = "marketing";
      else if (a.id === "notice-tab") z = "notice";
      a.style.display = (z && !zoneVisible(z)) ? "none" : "";
    });
  }

  async function ensureZoneVis() {
    if (zoneVisLoaded) return;
    try { zoneVis = await SB.getFrontendZoneVisibility(); } catch (e) { zoneVis = {}; }
    try { myZones = await SB.myManageZones(); } catch (e) { myZones = null; }
    zoneVisLoaded = true;
    applyZoneNav();
  }

  // —— 登录页界面 ——
  function applyAuthMode() {
    const toggle = $("#auth-toggle-link");
    if (toggle) toggle.textContent = authMode === "login" ? "没有账号？注册一个" : "已有账号？去登录";
    const t = $("#auth-title"); if (t) t.textContent = authMode === "login" ? "营销日历登录" : "注册账号";
    const s = $("#auth-submit"); if (s) s.textContent = authMode === "login" ? "进入营销日历" : "注册并进入";
  }
  function showAuthHint(msg) {
    const h = $("#auth-hint");
    if (h) { h.textContent = msg; h.classList.remove("hidden"); }
  }
  function hideAuthHint() {
    const h = $("#auth-hint");
    if (h) h.classList.add("hidden");
  }
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
        input.focus();
      }
      hide();
    };
    input.addEventListener("input", () => {
      const v = input.value;
      const at = v.lastIndexOf("@");
      if (at < 0) { hide(); return; }
      const tail = v.slice(at + 1).toLowerCase();
      if (tail.indexOf(".") >= 0 || (tail.length > 0 && /[\s@]/.test(tail))) { hide(); return; }
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
    window.addEventListener("beforeunload", hide);
  }

  function showLogin() {
    authMode = "register";
    applyAuthMode();
    hideAuthHint();
    const lv = $("#login-view"); if (lv) lv.classList.remove("hidden");
    const mv = $("#marketing-view"); if (mv) mv.classList.add("hidden");
    const cb = $("#changepwd-btn"); if (cb) cb.classList.add("hidden");
    const lo = $("#logout-btn"); if (lo) lo.classList.add("hidden");
    const tb = document.getElementById("front-topbar"); if (tb) tb.classList.add("hidden");
  }

  function showMain() {
    const lv = $("#login-view"); if (lv) lv.classList.add("hidden");
    const cb = $("#changepwd-btn"); if (cb) cb.classList.remove("hidden");
    const lo = $("#logout-btn"); if (lo) lo.classList.remove("hidden");
    const tb = document.getElementById("front-topbar"); if (tb) tb.classList.remove("hidden");
    const mv = $("#marketing-view"); if (mv) mv.classList.remove("hidden");

    // —— 专区守卫：营销日历在前台被隐藏时，即使直接输入地址也拦截进入 ——
    if (!zoneVisible("marketing")) {
      toast("该专区暂未开放", false);
      showLogin();
      return;
    }
    // 顶部菜单高亮本页
    document.querySelectorAll(".top-tabs [data-viewtab]").forEach(a => a.classList.toggle("active", a.dataset.viewtab === "marketing"));
    const brand = $("#front-brand");
    if (brand) brand.textContent = (CONFIG.siteTitle || "TREND BANK") + " · 营销日历";
    document.title = (CONFIG.siteTitle || "TREND BANK") + " · 营销日历";
    loadMarketing();
  }

  async function refreshUI() {
    await ensureZoneVis();
    if (window.__loggedIn) { showMain(); }
    else { showLogin(); }
    hideSplash();
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
          window.__loggedIn = true;
          toast("注册成功，已登录");
          showMain();
        } else {
          toast("注册成功！请前往邮箱确认", true);
          showAuthHint("确认邮件已发送至 " + email + "，请点击邮件中的链接激活账号后再登录。若未收到，请检查垃圾邮件。");
          authMode = "login";
          applyAuthMode();
        }
        return;
      }
      const { data, error } = await SB.signIn(email, pass);
      if (error) {
        let exists = null;
        try { exists = await SB.isEmailRegistered(email); } catch (e2) { exists = null; }
        if (exists === false) toast("账号错误：该邮箱未注册，请先注册", false);
        else if (exists === true) toast("密码错误：请检查密码后重试", false);
        else toast("登录失败：" + (error.message || "请检查邮箱密码"), false);
        return;
      }
      window.__loggedIn = true;
      toast("登录成功");
      showMain();
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

  // —— 加载营销日历数据并渲染 ——
  async function loadMarketing() {
    try {
      await ensureZoneVis();
      const nodeRes = await SB.listMarketingNodes();
      nodes = nodeRes.data || [];
      const artRes = await SB.listMarketingArticles(true);   // 仅已发布
      articles = artRes.data || [];
      renderNodes();
      renderCards();
      maybeFocusArticle();
    } catch (e) {
      toast("加载营销日历失败，请检查网络", false);
    }
  }

  // 顶部时间线：按 sort_order 排列的时间节点
  function renderNodes() {
    const tl = document.getElementById("mk-timeline");
    if (!tl) return;
    if (!nodes.length) {
      tl.innerHTML = '<div class="mk-empty">暂无时间节点，请等待管理员发布。</div>';
      return;
    }
    tl.innerHTML = nodes.map((n, i) => {
      const label = escHtml(n.desc == null ? "" : n.date || n.title);
      const date = escHtml(n.date || "");
      return `<div class="mk-node ${i + 1 === nodes.length ? "last" : ""}">
        <div class="mk-node-dot"><span class="mk-node-inner"></span></div>
        <div class="mk-node-card">
          <div class="mk-node-date">${date}</div>
          <div class="mk-node-title">${escHtml(n.title)}</div>
        </div>
      </div>`;
    }).join("");
  }

  // 已发布文章 → 3:4 卡片区（每个时间节点对应一张展示图）
  async function renderCards() {
    const grid = document.getElementById("mk-grid");
    if (!grid) return;
    if (!articles.length) {
      grid.innerHTML = '<div class="mk-empty">暂无已发布的营销日历文章。</div>';
      return;
    }
    grid.innerHTML = "";
    for (const a of articles) {
      const card = document.createElement("a");
      card.className = "mk-card";
      if (a.url) card.href = a.url; else card.href = "javascript:void(0);";
      card.target = a.url ? "_blank" : "";
      card.rel = a.url ? "noopener noreferrer" : "";
      card.dataset.id = a.id;
      if (a.id === activeArticleId) card.classList.add("active");

      const imgWrap = document.createElement("div");
      imgWrap.className = "mk-card-img";
      if (a.image) {
        const img = document.createElement("img");
        img.alt = a.title || "";
        img.loading = "lazy";
        img.src = SB.marketingImageUrl(a.image);
        img.onerror = () => { imgWrap.classList.add("noimg"); img.style.display = "none"; };
        imgWrap.appendChild(img);
      } else {
        imgWrap.classList.add("noimg");
        const ph = document.createElement("span");
        ph.className = "mk-card-ph";
        ph.textContent = a.title || "营销日历";
        imgWrap.appendChild(ph);
      }
      // 右上角分享按钮（wx）
      const share = document.createElement("button");
      share.className = "mk-wx share-btn";
      share.type = "button";
      share.title = "分享到微信";
      share.textContent = "分享";
      share.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        openShareModal(a);
      });
      imgWrap.appendChild(share);

      const body = document.createElement("div");
      body.className = "mk-card-body";
      const tt = document.createElement("div");
      tt.className = "mk-card-title";
      tt.textContent = a.title || "";
      const meta = document.createElement("div");
      meta.className = "mk-card-sub";
      meta.textContent = a.summary || "点击查看";
      body.appendChild(tt); body.appendChild(meta);

      card.appendChild(imgWrap); card.appendChild(body);
      grid.appendChild(card);
    }
  }

  // 二维码分享弹窗：专属链接 + 二维码，可保存分享到微信
  function openShareModal(a) {
    const modal = document.getElementById("mk-share-modal");
    if (!modal) return;
    const link = location.origin + location.pathname + "?article=" + encodeURIComponent(a.id);
    const linkEl = document.getElementById("mk-share-link");
    if (linkEl) linkEl.value = link;
    const titleEl = document.getElementById("mk-share-title");
    if (titleEl) titleEl.textContent = a.title || "营销日历文章";

    const qrBox = document.getElementById("mk-share-qr");
    if (qrBox) {
      qrBox.innerHTML = "";
      if (HasQR()) {
        new window.QRCode(qrBox, { text: link, width: 200, height: 200, correctLevel: window.QRCode.CorrectLevel.M });
      } else {
        qrBox.textContent = "二维码库未加载，请复制上方链接分享";
      }
    }
    // 复制链接
    const copyBtn = document.getElementById("mk-share-copy");
    if (copyBtn) {
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(link);
          toast("链接已复制，可粘贴分享到微信");
        } catch (e) {
          if (linkEl) { linkEl.select(); document.execCommand("copy"); toast("链接已复制，可粘贴分享到微信"); }
          else toast("复制失败，请手动复制", false);
        }
      };
    }
    modal.classList.remove("hidden");
  }

  function maybeFocusArticle() {
    if (!activeArticleId) return;
    const card = document.querySelector('.mk-card[data-id="' + activeArticleId + '"]');
    if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }

  function bindChangepwd() {
    const modal = document.getElementById("pwd-modal");
    if (!modal) return;
    const open = () => {
      const o = document.getElementById("pwd-old"), n = document.getElementById("pwd-new"), n2 = document.getElementById("pwd-new2");
      if (o) o.value = ""; if (n) n.value = ""; if (n2) n2.value = "";
      modal.classList.remove("hidden");
      if (o) o.focus();
    };
    const close = () => modal.classList.add("hidden");
    const bp = document.getElementById("changepwd-btn");
    if (bp) bp.onclick = open;
    const c1 = document.getElementById("pwd-cancel"); if (c1) c1.onclick = close;
    const c2 = document.getElementById("pwd-close"); if (c2) c2.onclick = close;
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    const btn = document.getElementById("pwd-submit");
    if (btn) btn.onclick = async () => {
      const o = document.getElementById("pwd-old").value.trim();
      const n = document.getElementById("pwd-new").value;
      const n2 = document.getElementById("pwd-new2").value;
      if (!o) return toast("请输入旧密码", false);
      if (!n || n.length < 6) return toast("新密码至少6位", false);
      if (n !== n2) return toast("两次输入的新密码不一致", false);
      const r = await SB.changePassword(o, n);
      if (r.error) return toast(r.error.message || "修改失败", false);
      toast("密码修改成功", true);
      close();
    };
  }

  // 分享弹窗关闭
  function bindShareModalClose() {
    const modal = document.getElementById("mk-share-modal");
    if (!modal) return;
    const close = () => modal.classList.add("hidden");
    const c1 = document.getElementById("mk-share-close"); if (c1) c1.onclick = close;
    const c2 = document.getElementById("mk-share-close-x"); if (c2) c2.onclick = close;
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const st = $("#site-title");
    if (st) st.textContent = CONFIG.siteTitle || "TREND BANK";

    // 解析 ?article= 定位文章
    const qs = new URLSearchParams(location.search);
    activeArticleId = (qs.get("article") || "").trim();

    // 始终需登录 —— 监听登录态
    SB.onAuth((session) => {
      window.__loggedIn = !!session;
      refreshUI();
    });

    $("#login-form").addEventListener("submit", onLogin);
    bindEmailSuggest();
    const authToggle = $("#auth-toggle-link");
    if (authToggle) authToggle.addEventListener("click", (e) => {
      e.preventDefault();
      authMode = authMode === "login" ? "register" : "login";
      applyAuthMode();
    });
    applyAuthMode();
    const lo = $("#logout-btn"); if (lo) lo.onclick = onLogout;
    bindChangepwd();
    bindShareModalClose();

    // 兜底：异常情况下最多等 3s 后揭开遮罩
    setTimeout(hideSplash, 3000);
    // 首次恢复会话后刷新
    SB.getSession().then(s => { window.__loggedIn = !!s; refreshUI(); }).catch(() => refreshUI());
  });
})();