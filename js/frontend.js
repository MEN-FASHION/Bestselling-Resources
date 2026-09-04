/* ============================================================
 * 前台逻辑：Supabase 登录/注册 + 左侧类目菜单 + 图片网格 + 灯箱大图 + 防下载
 * ============================================================ */
(function () {
  const $ = (sel) => document.querySelector(sel);

  let currentCat = "全部";
  let lightboxList = [];
  let lightboxIdx = 0;
  let catalog = [];      // 当前分类下的图片

  // 前台展示的类目 = 管理员显式添加的类目 ∩ 实际有图的类目
  let activeCats = [];   // categories 表（管理员显式添加）
  let usedCats = [];     // images 表去重（有图）

  document.addEventListener("DOMContentLoaded", () => {
    $("#site-title").textContent = CONFIG.siteTitle;
    $(".subtitle").textContent = CONFIG.siteSubtitle;
    $("#top-title").textContent = CONFIG.siteTitle;
    document.title = CONFIG.siteTitle + " · 前台";

    if (CONFIG.enableSignup) {
      $("#auth-toggle-link").classList.remove("hidden");
    }

    // 恢复登录态
    SB.onAuth((session) => {
      if (session) showGallery(); else showLogin();
    });

    // ===== 全局防下载 =====
    setupAntiDownload();
  });

  // ---------- 防下载：禁右键/拖拽/长按/选中 ----------
  function setupAntiDownload() {
    document.addEventListener("contextmenu", (e) => {
      if (e.target.tagName === "IMG") e.preventDefault();
    });
    document.addEventListener("dragstart", (e) => {
      if (e.target.tagName === "IMG") e.preventDefault();
    });
    // 长按保存（移动端）阻止
    let longPress = null;
    document.addEventListener("touchstart", (e) => {
      if (e.target.tagName === "IMG") {
        longPress = setTimeout(() => e.preventDefault(), 400);
      }
    }, { passive: false });
    document.addEventListener("touchend", () => clearTimeout(longPress));
    document.addEventListener("touchmove", () => clearTimeout(longPress));
    // 禁止选中图片文本
    document.addEventListener("selectstart", (e) => {
      if (e.target.tagName === "IMG") e.preventDefault();
    });
    // 禁止 Ctrl/Command + S 直接保存页面（尽力而为）
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
      }
    });
  }

  function showLogin() {
    $("#gallery-view").classList.add("hidden");
    $("#login-view").classList.remove("hidden");
  }
  function showGallery() {
    $("#login-view").classList.add("hidden");
    $("#gallery-view").classList.remove("hidden");
    loadGallery();
  }
  async function loadGallery() {
    try {
      // 并行取：显式添加的类目 + 实际有图的类目
      const [active, used] = await Promise.all([
        SB.listActiveCats().catch(() => []),
        SB.listUsedCats().catch(() => []),
      ]);
      activeCats = active;
      usedCats = used;
      // 交集，并按字母/拼音顺序
      const shown = activeCats.filter(c => usedCats.includes(c));
      renderCatMenu(shown);
      await renderGrid(currentCat);
    } catch (e) {
      Auth.toast("加载失败，请检查网络或配置", false);
    }
  }

  // ---------- 左侧类目菜单 ----------
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

  // ---------- 图片网格 ----------
  async function renderGrid(cat) {
    const grid = $("#grid");
    grid.innerHTML = "";
    let imgs = [];
    try {
      imgs = await SB.listImages(cat);
    } catch (e) { Auth.toast("读取图片失败", false); }
    $("#empty-tip").classList.toggle("hidden", imgs.length > 0);
    catalog = imgs;
    // 一次性取当前登录令牌，避免每个图片都重复请求
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
      const cap = document.createElement("div");
      cap.className = "cell-cap";
      cap.textContent = img.name || "";
      cell.appendChild(holder);
      cell.appendChild(cap);
      cell.onclick = () => openLightbox(idx);
      holder.style.background = "var(--shade)";
      grid.appendChild(cell);

      // 懒加载：进入视口才加载图片
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((entries, obs) => {
          entries.forEach(en => {
            if (en.isIntersecting) {
              const target = en.target;
              target.src = target.dataset.src;
              target.onload = () => target.classList.add("loaded");
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

  // ---------- 灯箱 ----------
  function openLightbox(idx) {
    lightboxIdx = idx;
    showLbImage();
    $("#lightbox").classList.remove("hidden");
  }
  function showLbImage() {
    $("#lb-img").src = lightboxList[lightboxIdx] || "";
    $("#lb-caption").textContent = (lightboxIdx + 1) + " / " + lightboxList.length;
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

  // ---------- 登录 / 注册切换 ----------
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#auth-email").value.trim();
    const pass = $("#auth-pass").value;
    if (!email || !pass) { Auth.toast("请输入邮箱和密码", false); return; }
    if (authMode === "register") {
      const { error } = await SB.signUp(email, pass);
      if (error) { Auth.toast("注册失败：" + error.message, false); return; }
      Auth.toast("注册成功，已登录");
      return; // onAuth 回调会进入画廊
    }
    const { error } = await SB.signIn(email, pass);
    if (error) { Auth.toast("登录失败：" + error.message, false); return; }
  });

  // 切换登录/注册模式
  let authMode = "login";
  $("#auth-toggle-link").onclick = (e) => {
    e.preventDefault();
    authMode = authMode === "login" ? "register" : "login";
    $("#auth-toggle-link").textContent = authMode === "login" ? "没有账号？注册一个" : "已有账号？去登录";
    $("#auth-title").textContent = authMode === "login" ? "访客登录" : "注册账号";
    $("#auth-submit").textContent = authMode === "login" ? "进入图鉴" : "注册并进入";
  };

  // ---------- 退出 ----------
  $("#logout-btn").onclick = async () => { await SB.signOut(); showLogin(); };
})();