/* ============================================================
 * 前台逻辑：Supabase 登录/注册 + 左侧类目菜单 + 渠道/风格/元素标签筛选 + 图片网格 + 灯箱 + 防下载
 * ============================================================ */
(function () {
  const $ = (sel) => document.querySelector(sel);

  let currentCat = "全部";
  let curChannel = "";   // 渠道标签筛选
  let curStyle = "";     // 风格标签筛选
  let curElement = "";   // 元素标签筛选
  let lightboxList = [];
  let lightboxIdx = 0;
  let catalog = [];
  let galleryLoaded = false;
  let styleDefs = [];    // 风格标签定义
  let elementDefs = [];  // 元素标签定义

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
    document.title = CONFIG.siteTitle + " · 前台";

    if (CONFIG.enableSignup) {
      $("#auth-toggle-link").classList.remove("hidden");
    }

    SB.getPublicAccess().then((pub) => {
      window.__publicAccess = !!pub;
      refreshAuthUI();
    }).catch(() => { window.__publicAccess = false; refreshAuthUI(); });

    SB.onAuth((session) => {
      if (session) { window.__loggedIn = true; refreshAuthUI(); }
      else { window.__loggedIn = false; refreshAuthUI(); }
    });

    $("#login-btn").onclick = () => showLogin();
    setupAntiDownload();
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
  function _match(img) {
    if (currentCat && currentCat !== "全部" && img.category !== currentCat) return false;
    if (curChannel && !(Array.isArray(img.tags) && img.tags.includes(curChannel))) return false;
    if (curStyle && !(Array.isArray(img.style_tags) && img.style_tags.includes(curStyle))) return false;
    if (curElement && !(Array.isArray(img.element_tags) && img.element_tags.includes(curElement))) return false;
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
      { key: "element", label: "元素", items: elementDefs, cur: (v) => curElement === v, field: "element_tags" }
    ];

    grpMeta.forEach(g => {
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
      g.items.forEach(t => {
        const active = g.key === "category" ? (currentCat === t) : g.cur(t);
        const cnt = list.filter(i => g.key === "category"
          ? (i.category === t)
          : (Array.isArray(i[g.field]) && i[g.field].includes(t))).length;
        chips.appendChild(mkChip(g.key, t, t, cnt, active));
      });
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
    if (curChannel) parts.push("渠道:" + curChannel);
    if (curStyle) parts.push("风格:" + curStyle);
    if (curElement) parts.push("元素:" + curElement);
    el.textContent = parts.length ? parts.join(" · ") : "类目·渠道·风格·元素";
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

    const hasFilter = (currentCat && currentCat !== "全部") || curChannel || curStyle || curElement;
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
      // 底部显示渠道/风格/元素标签（不显示文件名）
      const cap = document.createElement("div");
      cap.className = "cell-cap";
      const mk = (lab, arr, cls) => `<span class="cap-row ${cls}"><i>${lab}</i>${(Array.isArray(arr) && arr.length) ? escHtml(arr.join(" / ")) : "未打标"}</span>`;
      cap.innerHTML =
        mk("渠道", img.tags, "ch") +
        mk("风格", img.style_tags, "st") +
        mk("元素", img.element_tags, "el");
      cell.appendChild(holder);
      cell.appendChild(cap);
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
