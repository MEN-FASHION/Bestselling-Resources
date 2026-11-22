/* ============================================================================
 * 20261116B · 图片加载提速（全站统一入口）
 * ----------------------------------------------------------------------------
 * 现象：P / S / T 专区、渠道对比、视觉专区，一进去图要等很久才出来；
 *       关掉页面再进又要重新等一遍。
 *
 * 三个原因，对应这里的三个做法：
 *
 * ① 卡片只有 70~220px，下载的却是上传时的整张大图（约 200KB / 每张 1200×1600）。
 *    一屏 40 张就是 8MB，解码还要吃内存。→ imgThumb()：卡片图带上 ?w=340，
 *    由图片服务就地缩到卡片够用的宽度（图片服务不支持时会原样返回，不会坏图）。
 *    卡片上的 data-full 始终保留原始大图地址，看大图 / 导出 / 搜同款都用它。
 *
 * ② 浏览器缓存用不上：地址每次重新拼、令牌每次都扫一遍 localStorage。
 *    → 令牌 60 秒记忆一次；图片地址稳定，缓存才命中。
 *
 * ③ 一堆图同时抢带宽，首屏那几张反而排在后面。
 *    → 懒加载图统一 fetchpriority="low"，首屏图保持高优先级；
 *      并且提前和图片服务建连（preconnect），省掉首次 TLS 握手。
 *
 * 只做「加载更快」，不改任何数据、不改权限、不改图片内容。
 * ========================================================================== */
/* 20261124A：本轮未改取图逻辑，版本戳随站点统一升级（后台配置「合并 / 拆分」、合并对比独立授权） */
/* 20261123B：本轮未改取图逻辑，版本戳随站点统一升级（渠道合并对比：取数按需月份 + 分批渲染） */
(function () {
  "use strict";

  var THUMB_W = 400;      /* 卡片缩略图宽（px）：大档卡 220px × 2 倍屏仍清晰，体积约 25KB */
  var THUMB_Q = 76;       /* WebP 质量，卡片尺寸下肉眼无损 */
  var TOKEN_TTL = 60000;  /* 令牌记忆 60 秒（过期自动重扫，不会读到失效值） */

  function workerBase() {
    try {
      return String((window.CONFIG && window.CONFIG.WORKER_URL) || "").replace(/\/$/, "");
    } catch (e) { return ""; }
  }

  /* ---------- 令牌：60 秒记忆一次，避免每个 <img> 都扫一遍 localStorage ---------- */
  var _tok = "", _tokAt = 0;

  function scanToken() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf("-auth-token") < 0) continue;
        var o = JSON.parse(localStorage.getItem(k) || "");
        var t = (o && (o.access_token || (o.currentSession && o.currentSession.access_token))) || "";
        if (t) return t;
      }
    } catch (e) { /* 隐私模式 / 无 localStorage */ }
    return "";
  }

  function token() {
    var now = Date.now();
    if (_tok && now - _tokAt < TOKEN_TTL) return _tok;
    _tok = scanToken();
    _tokAt = now;
    return _tok;
  }

  /* 令牌换了（续期 / 重新登录）时让缓存立刻失效，下一次拼地址就用新的 */
  function resetToken() { _tok = ""; _tokAt = 0; }

  /* 上层拿到最新令牌时调用：只有真的变了才作废缓存，避免每张图都重扫 */
  function syncToken(t) {
    var v = String(t || "");
    if (!v) return;
    if (_tok && v !== _tok) { _tok = v; _tokAt = Date.now(); }
  }
  window.imgTokenSync = syncToken;

  /* ---------- 图片地址统一出口（语义与原 window.imgSrc 完全一致） ---------- */
  function buildSrc(p) {
    var s = String(p == null ? "" : p).trim();
    if (!s) return "";
    var base = workerBase();
    var abs;
    if (/^https?:\/\//i.test(s)) {
      if (!base || s.indexOf(base + "/") !== 0) return s;   /* 外链原样返回 */
      abs = s;
    } else {
      if (!base) return s;
      abs = base + "/" + s.replace(/^\/+/, "");
    }
    var t = token();
    if (!t) return abs;
    if (/[?&]token=/.test(abs)) return abs;
    return abs + (abs.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(t);
  }

  /* 是否是我们自己的图片服务地址（只有它能缩图、能带令牌） */
  function isOwn(abs) {
    var base = workerBase();
    return !!base && String(abs).indexOf(base + "/") === 0;
  }

  /* 把地址拆成「路径 + 参数表」，方便安全地增删参数（不靠字符串拼接，避免拼出 ?&） */
  function splitQuery(abs) {
    var s = String(abs || "");
    var q = s.indexOf("?");
    if (q < 0) return { head: s, pairs: [] };
    return {
      head: s.slice(0, q),
      pairs: s.slice(q + 1).split("&").filter(function (kv) { return !!kv; })
    };
  }

  /* 给本站图片地址加 / 改缩略图参数；外链一律原样返回 */
  function withThumb(abs, w) {
    var s = String(abs || "");
    if (!s || !isOwn(s)) return s;
    if (/\/ver$|\/diag|\/api\//.test(s)) return s;
    var width = Math.max(60, Math.min(1200, Math.round(Number(w) || THUMB_W)));
    var parts = splitQuery(s);
    var keep = parts.pairs.filter(function (kv) {
      return !/^w=\d+$/.test(kv) && !/^q=\d+$/.test(kv);
    });
    keep.push("w=" + width);
    keep.push("q=" + THUMB_Q);
    return parts.head + "?" + keep.join("&");
  }

  /* 去掉缩略图参数，拿回原图地址（导出、搜同款、看大图用）。
     按参数逐个过滤，避免「删完 w/q 留下 ?q= 或 & 尾巴」把地址拼坏。 */
  function stripThumb(abs) {
    var parts = splitQuery(abs);
    if (!parts.pairs.length) return parts.head;
    var keep = parts.pairs.filter(function (kv) {
      return !/^w=\d+$/.test(kv) && !/^q=\d+$/.test(kv);
    });
    return keep.length ? parts.head + "?" + keep.join("&") : parts.head;
  }

  window.imgTokenReset = resetToken;
  window.imgSrc = buildSrc;                                      /* 覆盖 common.js 的慢版本 */
  window.imgThumb = function (p, w) { return withThumb(buildSrc(p), w); };
  window.imgThumbOf = function (abs, w) { return withThumb(abs, w); };
  window.imgFull = function (p) { return stripThumb(buildSrc(p)); };

  /* ---------- 提前和图片服务建连 ---------- */
  function preconnect() {
    var base = workerBase();
    if (!base || !document.head) return;
    try {
      if (document.querySelector('link[data-imgfast-pc]')) return;
      var l = document.createElement("link");
      l.rel = "preconnect";
      l.href = base;
      l.crossOrigin = "anonymous";
      l.setAttribute("data-imgfast-pc", "1");
      document.head.appendChild(l);
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 给页面上每张图补齐加载属性 ----------
     · decoding="async"：解码不挡主线程（已有则不动）
     · 懒加载图 fetchpriority="low"：把带宽让给首屏
     · 缩略图失败自动回退原图：图片服务没开缩图 / 缩图出错时，最多多一次请求，不会出现灰底
     · data-full：这张图的原始大图地址（导出 / 搜同款优先用它，避免用到缩略图） */
  function mark(img) {
    if (!img || img.nodeType !== 1 || img.tagName !== "IMG") return;
    if (img.getAttribute("data-imgfast") === "1") return;
    img.setAttribute("data-imgfast", "1");

    if (!img.getAttribute("decoding")) img.setAttribute("decoding", "async");

    var src = img.getAttribute("src") || img.dataset.src || "";
    var full = "";
    if (src && isOwn(src)) {
      full = stripThumb(src);
      if (full !== src) {
        img.setAttribute("data-full", full);
        if (img.getAttribute("data-src")) img.setAttribute("data-src", full);
      }
    } else if (src && /^https?:\/\//i.test(src)) {
      img.setAttribute("data-full", src);
    }

    if (img.getAttribute("loading") === "lazy" && !img.getAttribute("fetchpriority")) {
      img.setAttribute("fetchpriority", "low");
    }

    if (!img.__imgfastErr) {
      img.__imgfastErr = 1;
      img.addEventListener("error", function () {
        if (img.getAttribute("data-imgfast-retry") === "1") return;
        var cur = img.getAttribute("src") || "";
        if (!/[?&]w=\d+/.test(cur)) return;
        img.setAttribute("data-imgfast-retry", "1");
        /* 第一次失败：去掉缩略参数，用原图再试一次 */
        img.setAttribute("src", stripThumb(cur));
      });
    }
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.tagName === "IMG") mark(root);
    var list;
    try { list = root.querySelectorAll ? root.querySelectorAll("img") : []; } catch (e) { return; }
    for (var i = 0; i < list.length; i++) mark(list[i]);
  }

  function boot() {
    preconnect();
    scan(document.body || document.documentElement);
    if (typeof MutationObserver !== "function") return;
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === "attributes") { mark(m.target); continue; }
        var added = m.addedNodes || [];
        for (var j = 0; j < added.length; j++) scan(added[j]);
      }
    });
    try {
      mo.observe(document.documentElement, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ["src"]
      });
    } catch (e) { /* 老浏览器降级为只扫一次 */ }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
