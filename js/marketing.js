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
  // 注册后若开启邮箱确认：展示醒目的确认引导面板，隐藏登录表单，支持重新发送确认邮件
  function showAuthConfirm(email) {
    const form = $("#login-form");
    const panel = $("#auth-confirm");
    if (!panel) return;
    if (form) form.style.display = "none";
    const em = document.getElementById("auth-confirm-email"); if (em) em.textContent = email;
    panel.classList.remove("hidden");
    const resend = document.getElementById("auth-resend");
    if (resend) {
      resend.onclick = async () => {
        resend.disabled = true;
        const oldText = resend.textContent;
        resend.textContent = "发送中…";
        const { error } = await SB.resendConfirm(email);
        if (error) toast("发送失败：" + error.message, false);
        else toast("确认邮件已重新发送，请查收", true);
        resend.disabled = false;
        resend.textContent = oldText;
      };
    }
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
          toast("注册成功！请到邮箱完成确认", true);
          showAuthConfirm(email);
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

  // 顶部横向时间轴：一条横线，节点为亮点，节点上方为主题文字，下方为主图（点击查看趋势）
  function renderNodes() {
    const tl = document.getElementById("mk-timeline");
    if (!tl) return;
    if (!nodes.length) {
      tl.innerHTML = '<div class="mk-empty">暂无时间节点，请等待管理员发布。</div>';
      return;
    }
    // 每个节点取一张主图与跳转链接：优先节点自带，否则取该节点下第一篇已发布文章
    const coverOf = (n) => {
      const rel = articles.filter(a => String(a.node_id) === String(n.id));
      const a = rel[0] || null;
      return {
        img: (n.image || (a && a.image)) || "",
        url: (n.url || (a && a.url)) || "",
        text: (a && a.title) || ""
      };
    };
    // 交错时间线：相邻节点一上一下交替排布，节点圆点落在主轴上，竖虚线悬挂说明卡
    tl.innerHTML = nodes.map((n, i) => {
      const date = escHtml(n.date || "");
      const title = escHtml(n.title || "");
      const desc = escHtml(n.description || "");
      const c = coverOf(n);
      const href = c.url || "javascript:void(0);";
      const target = c.url ? "_blank" : "";
      const rel = c.url ? "noopener noreferrer" : "";
      const side = i % 2 === 0 ? "up" : "down";
      return `<div class="mk-node ${side}">
        <div class="mk-card">
          <a class="mk-card-link" href="${href}" target="${target}" rel="${rel}">
            ${c.img ? `<img class="mk-card-img" src="${SB.marketingImageUrl(c.img)}" alt="${title}" loading="lazy">` : ""}
            <div class="mk-card-date">${date}</div>
            <div class="mk-card-title">${title}</div>
            ${desc ? `<div class="mk-card-desc">${desc}</div>` : ""}
          </a>
        </div>
        <span class="mk-conn"></span>
        <span class="mk-dot"><span class="mk-dot-inner"></span></span>
      </div>`;
    }).join("");
    // 图片加载失败回退占位
    tl.querySelectorAll(".mk-card-img").forEach(img => {
      img.onerror = () => { img.style.display = "none"; };
    });
    // 支持鼠标按住横向拖动滑动
    enableDragScroll(tl);
  }

  // 鼠标/触摸按住横向拖动时间线
  function enableDragScroll(el) {
    if (!el || el._dragBound) return;
    el._dragBound = true;
    let isDown = false, startX = 0, scrollLeft = 0, moved = false;
    el.addEventListener("mousedown", (e) => {
      // 不拦截主图/按钮点击
      if (e.target.closest("a,button,input,select")) return;
      isDown = true; moved = false;
      startX = e.pageX; scrollLeft = el.scrollLeft;
      el.style.cursor = "grabbing"; el.style.userSelect = "none";
    });
    el.addEventListener("mousemove", (e) => {
      if (!isDown) return;
      const dx = e.pageX - startX;
      if (Math.abs(dx) > 3) moved = true;
      el.scrollLeft = scrollLeft - dx;
    });
    const up = () => { if (!isDown) return; isDown = false; el.style.cursor = ""; el.style.userSelect = ""; };
    el.addEventListener("mouseup", up);
    el.addEventListener("mouseleave", up);
    el.addEventListener("click", (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
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
      if (a.url) { card.href = a.url; card.target = "_blank"; card.rel = "noopener noreferrer"; }
      else { card.href = "javascript:void(0);"; }
      card.dataset.id = a.id;
      if (a.id === activeArticleId) card.classList.add("active");
      // 无外链 → 点击打开站内文章详情
      if (!a.url) {
        card.addEventListener("click", (e) => {
          if (e.target.closest(".share-btn")) return;
          e.preventDefault();
          openArticleDetail(a);
        });
      }

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

  // 打开站内文章详情弹窗（无外链时使用；正文从 posts 加载）
  async function openArticleDetail(a) {
    if (!a || !a.id) return;
    const modal = document.getElementById("mk-article-modal");
    if (!modal) return;
    let t = a.title || "";
    let c = a.content || "";
    let img = a.image || "";
    if (!c) {
      // 尝试从已加载文章列表中带出正文
      const full = articles.find(x => x.id === a.id);
      if (full && full.content) c = full.content;
      else if (full && full.image) img = full.image;
    }
    if (document.getElementById("mk-article-title")) document.getElementById("mk-article-title").textContent = t;
    const body = document.getElementById("mk-article-body");
    if (body) {
      body.innerHTML = "";
      if (img) {
        const im = document.createElement("img");
        im.className = "mk-article-cover";
        im.alt = t; im.src = SB.marketingImageUrl(img);
        im.onerror = () => { im.remove(); };
        body.appendChild(im);
      }
      const para = document.createElement("div");
      para.className = "mk-article-text";
      para.textContent = c || "（暂无正文）";
      // 支持分段显示
      para.innerHTML = (c || "").split(/\n{2,}/).map(p => "<p>" + (p || "").replace(/\n/g, "<br>") + "</p>").join("");
      body.appendChild(para);
    }
    modal.classList.remove("hidden");
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
function bindArticleModalClose() {
    const modal = document.getElementById("mk-article-modal");
    if (!modal) return;
    const close = () => modal.classList.add("hidden");
    const c1 = document.getElementById("mk-article-close"); if (c1) c1.onclick = close;
    const c2 = document.getElementById("mk-article-close-x"); if (c2) c2.onclick = close;
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
    bindArticleModalClose();

    // 兜底：异常情况下最多等 3s 后揭开遮罩
    setTimeout(hideSplash, 3000);
    // 首次恢复会话后刷新
    SB.getSession().then(s => { window.__loggedIn = !!s; refreshUI(); }).catch(() => refreshUI());
  });
})();