/* ============================================================
 * common.js —— 前台公共模块（唯一实现，供 视觉专区 / 趋势专区 / 营销日历 共用）
 * ------------------------------------------------------------
 * 收拢原先在 frontend.js / trends.js / marketing.js 中各自复制多份的逻辑：
 *   1) 公告弹窗（近一个月未读 + 历史记录 + 中央放大阅读）
 *   2) 图片「观看无印、下载带水印」+ 防下载（右键 / 拖拽 / 长按 / Ctrl+S·P·U）
 *   3) 注册成功后的邮箱确认引导面板
 * 各页面通过 Common.xxx() 调用，避免"改一处漏一处"。
 * 依赖：必须在本文件之前引入 supabase.js（内部使用全局 SB）。
 * ============================================================ */
window.Common = (function () {
  "use strict";
  if (window.Common) return window.Common;

  const $ = (sel) => document.querySelector(sel);

  // ---------- 提示条适配：各页面 toast 样式不同，由其自行注入 ----------
  let _toast = function () {};
  function setToast(fn) { if (typeof fn === "function") _toast = fn; }
  function toast(msg, ok) { try { _toast(msg, ok !== false); } catch (e) {} }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // style: "short" → 月-日 时:分（视觉专区原样式）；"full" → 年-月-日 时:分（趋势专区原样式）
  function fmtTime(iso, style) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      if (style === "full") {
        const p = (n) => String(n).padStart(2, "0");
        return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
          p(d.getHours()) + ":" + p(d.getMinutes());
      }
      return (d.getMonth() + 1) + "-" + d.getDate() + " " +
        String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    } catch (e) { return ""; }
  }

  // ================= 水印下载（页面展示无水印，仅下载时叠加） =================
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
        // 低调水印：顶部来源标注 + 底部站名，均横向、半透明、不铺满
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
          a.download = (String(filename || "image").replace(/[\\/:*?"<>|]/g, "_") || "image") + ".png";
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 600);
        }, "image/png");
      } catch (err) { /* 水印失败则静默 */ }
    };
    img.onerror = () => {};
    img.src = src; // 保留完整 src（含鉴权 token 或 blob: 地址）
  }

  // ================= 防下载（统一为完整版：含 CANVAS/IFRAME 与 Ctrl+P/U/Shift+S） =================
  function setupAntiDownload() {
    document.addEventListener("contextmenu", (e) => {
      if (e.target.tagName === "IMG") {
        e.preventDefault();
        // 右键图片：屏蔽系统"另存为"，改为下载带水印版
        downloadWatermarked(e.target.currentSrc || e.target.src, e.target.alt || "image");
      } else if (["CANVAS", "IFRAME"].includes(e.target.tagName)) {
        e.preventDefault();
      }
    });
    document.addEventListener("dragstart", (e) => {
      if (["IMG", "CANVAS", "IFRAME"].includes(e.target.tagName)) e.preventDefault();
    });
    let longPress = null;
    document.addEventListener("touchstart", (e) => {
      if (["IMG", "CANVAS"].includes(e.target.tagName)) longPress = setTimeout(() => e.preventDefault(), 400);
    }, { passive: false });
    document.addEventListener("touchend", () => clearTimeout(longPress));
    document.addEventListener("touchmove", () => clearTimeout(longPress));
    document.addEventListener("selectstart", (e) => {
      if (["IMG", "CANVAS"].includes(e.target.tagName)) e.preventDefault();
    });
    document.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ["s", "p", "u"].includes(k)) e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === "s") e.preventDefault();
    });
  }

  // ================= 注册成功后的邮箱确认引导面板 =================
  const authConfirm = {
    show(email) {
      const form = $("#login-form");
      const panel = $("#auth-confirm");
      if (!panel) return;
      if (form) form.style.display = "none";
      const em = document.getElementById("auth-confirm-email");
      if (em) em.textContent = email;
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
  };

  // ================= 公告：近一个月未读 + 历史记录（弹窗 + 中央放大阅读） =================
  const notices = (function () {
    let autoShown = false;
    let unreadList = [];
    let historyList = [];
    let tab = "unread";
    const cfg = { autoShowNeedsLogin: false, timeStyle: "short" };

    function configure(o) { if (o) Object.assign(cfg, o); }

    async function load() {
      try {
        const all = await SB.listRecentPublishedAnnouncements().catch(() => []);
        const readIds = await SB.listMyReadAnnouncementIds().catch(() => []);
        const readSet = new Set(readIds || []);
        unreadList = (all || []).filter((a) => !readSet.has(String(a.id)));
        badge();
        // 首次进入且有未读 → 自动弹出（趋势专区要求已登录才自动弹）
        const allowAuto = cfg.autoShowNeedsLogin ? !!window.__loggedIn : true;
        if (!autoShown && allowAuto && unreadList.length > 0) {
          autoShown = true;
          tab = "unread";
          openModal();
        }
      } catch (e) { /* 公告加载失败不影响浏览 */ }
    }

    function badge() {
      const el = $("#notice-badge");
      if (el) {
        const n = unreadList.length;
        el.textContent = String(n);
        el.classList.toggle("hidden", n === 0);
      }
    }

    async function loadHistory() {
      if (historyList.length) return;
      try {
        historyList = await SB.listAllPublishedAnnouncements().catch(() => []);
      } catch (e) { historyList = []; }
    }

    async function openModal() {
      const modal = $("#notice-modal");
      if (!modal) return;
      modal.classList.remove("hidden");
      await renderBody();
    }

    function closeModal() {
      const modal = $("#notice-modal");
      if (modal) modal.classList.add("hidden");
    }

    // 从顶部菜单「公告」入口打开：默认看未读，无未读则看历史
    function openFromMenu() {
      tab = unreadList.length === 0 ? "history" : "unread";
      return openModal();
    }

    async function renderBody() {
      const body = $("#notice-modal-body");
      if (!body) return;
      document.querySelectorAll(".notice-tab-btn").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-ntab") === tab);
      });
      // 未读 tab：只展示未读（近一个月且未读）
      if (tab === "unread") {
        if (!unreadList.length) {
          body.innerHTML = "<div class='notice-empty'>暂无未读公告</div>";
          return;
        }
        body.innerHTML = "";
        unreadList.forEach((a) => body.appendChild(buildCard(a, true)));
        return;
      }
      // 历史 tab：全部已发布（含超一个月），标记未读状态
      await loadHistory();
      if (!historyList.length) {
        body.innerHTML = "<div class='notice-empty'>暂无历史公告</div>";
        return;
      }
      body.innerHTML = "";
      historyList.forEach((a) => {
        const isUnread = unreadList.some((u) => u && String(u.id) === String(a.id));
        body.appendChild(buildCard(a, isUnread));
      });
    }

    function buildCard(a, isUnread) {
      const card = document.createElement("div");
      card.className = "notice-card" + (isUnread ? " unread" : "");
      const head = document.createElement("button");
      head.type = "button";
      head.className = "notice-card-head";
      head.innerHTML = "<span class='notice-dot'></span><span class='notice-card-title'></span><span class='notice-card-time'></span><span class='notice-card-arrow'>↗</span>";
      head.querySelector(".notice-card-title").textContent = a.title || "公告";
      head.querySelector(".notice-card-time").textContent = fmtTime(a.created_at, cfg.timeStyle);
      // 点击卡片 → 中央放大展示全文
      head.onclick = async () => {
        openReader(a);
        if (isUnread) {
          card.classList.remove("unread");
          try {
            await SB.markAnnouncementRead(a.id);
            unreadList = unreadList.filter((u) => !u || String(u.id) !== String(a.id));
            badge();
          } catch (e) {}
        }
      };
      card.appendChild(head);
      return card;
    }

    // 中央放大展示公告全文（标题 + 富文本正文 + 附加图片）
    function openReader(a) {
      const wrap = document.getElementById("notice-reader");
      if (!wrap) return;
      const titleEl = document.getElementById("notice-reader-title");
      const metaEl = document.getElementById("notice-reader-meta");
      const bodyEl = document.getElementById("notice-reader-body");
      if (titleEl) titleEl.textContent = a.title || "公告";
      if (metaEl) metaEl.textContent = "发布于 " + fmtTime(a.created_at, cfg.timeStyle);
      if (bodyEl) {
        bodyEl.innerHTML = "";
        const raw = (a.content || "");
        const txt = document.createElement("div");
        txt.className = "notice-rich";
        if (/^<(p|h\d|div|ul|ol|blockquote|img|table|span|strong|em|u|s|b|br)/i.test(raw.trim())) {
          // 富文本：保留格式渲染，统一图片为受控 URL
          const tmp = document.createElement("div");
          tmp.innerHTML = raw;
          tmp.querySelectorAll("img").forEach((im) => {
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
          imgs.forEach((p) => {
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

    function closeReader() {
      const wrap = document.getElementById("notice-reader");
      if (wrap) wrap.classList.add("hidden");
    }

    // 一次性绑定公告弹窗的所有事件（各页面 DOM 结构一致）
    function bind() {
      const tabBtn = $("#notice-tab");
      if (tabBtn) {
        tabBtn.addEventListener("click", function (e) {
          e.preventDefault();
          openFromMenu();
        });
      }
      const closeBtn = $("#notice-close");
      if (closeBtn) closeBtn.addEventListener("click", closeModal);
      const modal = $("#notice-modal");
      if (modal) {
        modal.addEventListener("click", (e) => {
          if (e.target && e.target.id === "notice-modal") closeModal();
        });
      }
      // 公告放大阅读层关闭
      const readerClose = document.getElementById("notice-reader-close");
      if (readerClose) readerClose.addEventListener("click", closeReader);
      const readerWrap = document.getElementById("notice-reader");
      if (readerWrap) {
        readerWrap.addEventListener("click", (e) => {
          if (e.target && e.target.id === "notice-reader") closeReader();
        });
      }
      document.querySelectorAll(".notice-tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          tab = btn.getAttribute("data-ntab") || "unread";
          renderBody();
        });
      });
    }

    return {
      configure, load, badge, loadHistory, openModal, closeModal, openFromMenu,
      renderBody, buildCard, openReader, closeReader, bind,
      get unreadList() { return unreadList; },
      get historyList() { return historyList; },
      get tab() { return tab; },
      set tab(v) { tab = v; }
    };
  })();

  /* ============================================================
   * 专区定义 / 顶部菜单（支持后台「专区管理」动态新增的专区）
   *  - defs：专区列表 [{key,label,href}]（未配置时用 config.js 的 ZONE_DEFS_DEFAULT）
   *  - renderNav()：给所有页面顶部菜单补齐动态专区入口 + 按可见性显示/隐藏
   * ============================================================ */
  const zones = (function () {
    let defs = null;    // 后台配置的专区定义（null = 用默认）
    let vis = null;     // 全局可见性 { zone: bool }
    let mine = null;    // 当前用户的前台可见专区白名单（空/未登录 = 跟随全局）
    let loaded = false;

    function fallback() { return (window.ZONE_DEFS_DEFAULT || []).slice(); }
    function list() { return (defs && defs.length) ? defs : fallback(); }

    function visible(zone) {
      if (!zone) return true;
      if (Array.isArray(mine) && mine.length) {
        if (vis && vis[zone] === false) return false;
        return mine.indexOf(zone) !== -1;
      }
      return !vis || vis[zone] !== false;
    }

    function setVis(v) { vis = v || {}; }
    function setMine(m) { mine = Array.isArray(m) ? m : null; }
    function setDefs(d) { defs = (Array.isArray(d) && d.length) ? d : null; }

    async function loadDefs() {
      if (loaded) return list();
      loaded = true;
      try {
        const SBX = window.SB;
        if (SBX && SBX.getZoneDefs) setDefs(await SBX.getZoneDefs());
      } catch (e) { /* 读取失败则用默认专区列表 */ }
      return list();
    }

    // 顶部菜单：补齐动态专区入口，并按可见性显示/隐藏
    function renderNav() {
      const tabs = document.querySelector(".top-tabs");
      if (!tabs) return;
      const all = () => Array.prototype.slice.call(tabs.querySelectorAll(".tab-link"));
      const used = {};
      // 1) 已有菜单项按 href 认领专区
      all().forEach((a) => {
        if (a.getAttribute("data-zone")) { used[a.getAttribute("data-zone")] = 1; return; }
        const href = a.getAttribute("href") || "";
        const hit = list().find((d) => d.href && d.href === href && !used[d.key]);
        if (hit) { used[hit.key] = 1; a.setAttribute("data-zone", hit.key); }
      });
      // 2) 后台新增的专区（静态菜单里没有的）动态补进去
      const noticeTab = tabs.querySelector("#notice-tab");
      list().forEach((d) => {
        if (!d.href || !d.label || used[d.key]) return;
        const a = document.createElement("a");
        a.href = d.href;
        a.className = "tab-link";
        a.setAttribute("data-zone", d.key);
        a.textContent = d.label;
        if (noticeTab && noticeTab.parentNode === tabs) tabs.insertBefore(a, noticeTab);
        else tabs.appendChild(a);
        used[d.key] = 1;
      });
      // 3) 可见性
      all().forEach((a) => {
        const z = a.getAttribute("data-zone");
        if (!z) return;
        a.style.display = visible(z) ? "" : "none";
      });
    }

    return {
      visible, setVis, setMine, setDefs, loadDefs, renderNav,
      get defs() { return list(); }
    };
  })();

  return {
    setToast, toast, escHtml, fmtTime,
    downloadWatermarked, setupAntiDownload,
    authConfirm, notices, zones
  };
})();