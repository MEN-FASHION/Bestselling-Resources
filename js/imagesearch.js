/* imagesearch.js —— 前台大图「站外找相似款」（20261111X）
 *
 * 做什么：任意站点页面里把图放大后，右下角出现「找相似款」按钮，
 *         一键跳到 Google 以图搜图（Lens）去站外找同款/相似款。
 *         下拉里还给了 Bing / Yandex / TinEye / Google 图片（兼容入口）。
 *
 * 为什么能这么做：本站的图都是可直连的 http(s) 地址（榜单外链、专区上传、
 * 图库直链），而 Google Lens 支持「按图片地址搜索」
 * （lens.google.com/uploadbyurl?url=...），所以不需要任何后端、不需要下载再上传，
 * 浏览器开新标签即可出结果。
 *
 * 一个必须处理的例外：视觉专区的大图在直连失败时会退化成 blob: 地址
 * （带 token 取回后生成的本地对象 URL）。blob 只有当前页面能用，外部搜图站点
 * 拿不到，所以这种情况不硬跳，明确提示并给「下载原图」，用户拖进搜索框即可。
 *
 * 全站只此一份，任何页面引入即可；不做任何写库动作。
 */
(function () {
  "use strict";

  var ENGINES = [
    {
      id: "lens",
      name: "Google 以图搜图",
      hint: "Lens · 默认，找同款最准",
      build: function (u) { return "https://lens.google.com/uploadbyurl?url=" + encodeURIComponent(u); },
    },
    {
      id: "google",
      name: "Google 图片（兼容入口）",
      hint: "老接口，Lens 打不开时用",
      build: function (u) { return "https://www.google.com/searchbyimage?image_url=" + encodeURIComponent(u); },
    },
    {
      id: "bing",
      name: "Bing 以图搜图",
      hint: "有时电商款召回更好",
      build: function (u) { return "https://www.bing.com/images/searchbyimage?cbir=sbi&imgurl=" + encodeURIComponent(u); },
    },
    {
      id: "yandex",
      name: "Yandex 以图搜图",
      hint: "找同款/换色款有一手",
      build: function (u) { return "https://yandex.com/images/search?rpt=imageview&url=" + encodeURIComponent(u); },
    },
    {
      id: "tineye",
      name: "TinEye 反查出处",
      hint: "查这张图最早出现在哪",
      build: function (u) { return "https://tineye.com/search?url=" + encodeURIComponent(u); },
    },
  ];

  /* 大图容器候选：命中第一个「可见且里面有图」的就算当前正在看的图。
     覆盖视觉专区灯箱、上新节奏/专区/渠道对比的 mv-modal、趋势上升榜的放大层、
     大码专区的预览层。新增页面只要用上这些容器，无需改这里。 */
  var SLOTS = [
    { sel: "#lb-img", host: "#lightbox" },
    { sel: "#mv-big", host: "#mv-modal" },
    { sel: "#cz-big", host: "#cz-modal" },
    { sel: "#cmp-big", host: "#cmp-modal" },
    { sel: "#plz-lb img", host: "#plz-lb" },
    { sel: ".rk-zoom-ov img", host: ".rk-zoom-ov" },
  ];

  function visible(node) {
    if (!node || !node.isConnected) return false;
    if (node.classList && node.classList.contains("hidden")) return false;
    var st = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (st && (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0)) return false;
    var r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    return !!(r && r.width > 8 && r.height > 8);
  }

  /* 当前正在看的大图；没有则返回 null */
  function current() {
    for (var i = 0; i < SLOTS.length; i++) {
      var host = document.querySelector(SLOTS[i].host);
      if (!visible(host)) continue;
      var img = document.querySelector(SLOTS[i].sel);
      if (!img) continue;
      var src = String(img.currentSrc || img.src || "").trim();
      if (!src) continue;
      return { img: img, host: host, src: src, kind: kindOf(src) };
    }
    return null;
  }

  /* http(s) 才能交给外部站点；blob:/data: 只有本页能用 */
  function kindOf(url) {
    if (/^https?:\/\//i.test(url)) return "remote";
    if (/^(blob|data|filesystem):/i.test(url)) return "local";
    return "other";
  }

  function engineById(id) {
    for (var i = 0; i < ENGINES.length; i++) if (ENGINES[i].id === id) return ENGINES[i];
    return ENGINES[0];
  }

  function toast(msg, ok) {
    if (typeof window.toast === "function") { try { window.toast(msg, ok !== false); return; } catch (e) {} }
    var t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.__t);
    toast.__t = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  function download(src, name) {
    var a = document.createElement("a");
    a.href = src;
    a.download = name || ("similar-search-" + Date.now() + ".jpg");
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    if (typeof a.click === "function") a.click();
    else { try { window.open(src, "_blank", "noopener"); } catch (e) {} }
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
  }

  /* 打开某个引擎 */
  function search(engineId, optUrl) {
    var cur = optUrl ? { src: String(optUrl).trim(), kind: kindOf(String(optUrl).trim()) } : current();
    if (!cur || !cur.src) { toast("先点开一张大图再试"); return false; }
    var eng = engineById(engineId);
    if (cur.kind !== "remote") {
      /* blob/data 只有本页可读，外部站点拿不到：不硬跳，改给下载 + 提示 */
      toast("这张图不是公开链接，需先下载再拖进搜索框", false);
      download(cur.src, "image-" + Date.now() + ".jpg");
      try { window.open("https://lens.google.com/", "_blank", "noopener"); } catch (e) {}
      return false;
    }
    var url = eng.build(cur.src);
    var w = window.open(url, "_blank", "noopener");
    if (!w) toast("浏览器拦了新标签，请允许弹窗后重试", false);
    return true;
  }

  /* ---------- 悬浮按钮 ---------- */
  var BAR = null, MENU = null, LAST_SRC = "";

  function ensureBar() {
    if (BAR && BAR.isConnected) return BAR;
    BAR = document.createElement("div");
    BAR.id = "imgsearch-bar";
    BAR.className = "imgsearch-bar hidden";
    BAR.innerHTML =
      '<button type="button" class="is-main" data-is="go">' +
        '<span class="is-ico" aria-hidden="true">⌕</span>找相似款' +
      "</button>" +
      '<button type="button" class="is-caret" data-is="menu" aria-label="选择搜索引擎">▾</button>';
    document.body.appendChild(BAR);

    MENU = document.createElement("div");
    MENU.id = "imgsearch-menu";
    MENU.className = "imgsearch-menu hidden";
    document.body.appendChild(MENU);

    BAR.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-is]") : null;
      if (!b) return;
      var act = b.getAttribute("data-is");
      if (act === "go") { search("lens"); closeMenu(); }
      else if (act === "menu") { toggleMenu(); }
    });
    MENU.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-is-eng]") : null;
      if (b) { search(b.getAttribute("data-is-eng")); closeMenu(); return; }
      var d = e.target.closest ? e.target.closest("[data-is-dl]") : null;
      if (d) {
        var cur = current();
        if (cur && cur.src) download(cur.src);
        closeMenu();
      }
    });
    document.addEventListener("click", function (e) {
      if (!MENU || MENU.classList.contains("hidden")) return;
      if (MENU.contains(e.target) || (BAR && BAR.contains(e.target))) return;
      closeMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && MENU && !MENU.classList.contains("hidden")) closeMenu();
    });
    return BAR;
  }

  function buildMenu(cur) {
    var local = cur && cur.kind !== "remote";
    var h = "";
    if (local) {
      h += '<div class="is-note">这张图只在当前页面可见（非公开链接），' +
        "外部站点取不到。请先「下载图片」，再拖进搜索框。</div>" +
        '<button type="button" data-is-dl="1" class="is-dl">下载图片</button>' +
        '<button type="button" data-is-eng="lens" class="is-item"><span>打开 Google 以图搜图</span>' +
        '<em>上传已下载的图</em></button>';
    } else {
      ENGINES.forEach(function (e) {
        h += '<button type="button" data-is-eng="' + e.id + '" class="is-item">' +
          "<span>" + e.name + "</span><em>" + e.hint + "</em></button>";
      });
      h += '<div class="is-sep"></div><button type="button" data-is-dl="1" class="is-sub">下载原图</button>';
    }
    MENU.innerHTML = h;
  }

  function openMenu() {
    var cur = current();
    if (!cur) return;
    buildMenu(cur);
    MENU.classList.remove("hidden");
    var r = BAR.getBoundingClientRect();
    MENU.style.left = Math.max(8, Math.min(r.left, window.innerWidth - MENU.offsetWidth - 8)) + "px";
    MENU.style.top = Math.max(8, r.top - MENU.offsetHeight - 8) + "px";
  }
  function closeMenu() { if (MENU) MENU.classList.add("hidden"); }
  function toggleMenu() {
    if (!MENU) return;
    if (MENU.classList.contains("hidden")) openMenu(); else closeMenu();
  }

  /* 只在「有大图」时出现；切换图片时按钮跟着闪一下，避免误以为点了没反应 */
  function sync() {
    if (!document.body) return;
    var cur = current();
    var bar = ensureBar();
    if (!cur) {
      bar.classList.add("hidden");
      if (MENU && !MENU.classList.contains("hidden")) closeMenu();
      return;
    }
    bar.classList.remove("hidden");
    if (cur.src !== LAST_SRC) {
      LAST_SRC = cur.src;
      bar.classList.remove("is-flash");
      void bar.offsetWidth;
      bar.classList.add("is-flash");
    }
    if (MENU && !MENU.classList.contains("hidden")) openMenu(); /* 跟着图换内容 */
  }

  function start() {
    ensureBar();
    sync();
    /* 大图是弹层/动态插入的，class 与节点都在变：观察 + 低频兜底轮询双保险 */
    try {
      var mo = new MutationObserver(function () { sync(); });
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "src"] });
    } catch (e) {}
    setInterval(sync, 600);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, { passive: true });
  }

  window.ImageSearch = {
    engines: ENGINES,
    current: current,
    search: search,
    download: download,
    /* 给页面自己留的入口：知道自己当前大图地址时可直接调 */
    searchUrl: function (url, engineId) { return search(engineId || "lens", url); },
    refresh: sync,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else { start(); }
})();
