/* ============================================================================
 * view-export.js —— 前台「把当前所见一键带走」（20261114G）
 * ----------------------------------------------------------------------------
 * 两种成品，都是一步到手、不需要再解压、不需要配任何文件夹：
 *
 *   ① 单页网页（.html 单文件）
 *      图片全部以 base64 内嵌在这个文件里，双击就开，微信/邮件直接发出去，
 *      对方不需要任何图片文件夹，也不会出现「图片全部裂开」。
 *
 *   ② 高清海报（.jpg）
 *      把当前页面看到的图按网格排成一张海报，2 倍分辨率（宽 2480px）。
 *      内容太长时按高度自动分页，依次生成 海报_1、海报_2……不会糊成一条。
 *
 * 核心口径仍然是：**页面怎么显示，导出就长什么样**。筛选条件（类目 / 周次 /
 *   月份 / 渠道）决定了导出范围，不是重新按全量导一遍。
 *
 *   渠道对比这一页本来就是「几列并排」看板：页面选了几个渠道就是几列、按这个
 *   顺序排。导出时同样并排成几列（网页里横向排列、海报里按列纵排），
 *   不再一列一列拆成上下堆叠。多列都摆不下一整页时，海报按列续排到下一张。
 *
 * 实现方式：直接从已经渲染出来的 DOM 取卡片。
 *     a) 「所见即所得」只有读 DOM 才能保证 —— 前端排序、分组、天眼模式、
 *        渠道对比的列顺序，全都是渲染阶段决定的，重查一遍必然走样；
 *     b) 不用再关心每个专区各自的数据来源（榜单外链 / 上传图 / 渠道图）差异。
 *
 * 权限：前台默认谁都看不到按钮。超管始终有；管理员需在后台「权限管理 →
 *   编辑用户 → 前台导出权限」里被单独勾上对应专区（site_settings.frontend_dims.export_zones）。
 *
 * 技术边界（不假装成功）：跨域图（部分榜单外链 CDN）不允许抓取时，网页里会
 *   退回「原地址 + 未内嵌」标注，海报里画成占位块，并在提示里说清有几张没拿到。
 *
 * 对外：window.VX.boot(zoneKey)   —— 页面加载后调一次即可
 *       window.VX.runHtml()       —— 导出单页网页
 *       window.VX.runPoster()     —— 导出高清海报
 *       window.VX.available()     —— 当前账号是否有本页导出权限
 * ==========================================================================*/
(function () {
  "use strict";

  var BUILD = "20261114H";

  var LABELS = {
    rank: "趋势上升榜",
    rhythm: "上新节奏",
    pinterest: "Pinterest 专区",
    shein: "SHEIN 专区",
    compare: "渠道对比",
    movement: "品牌动向"
  };

  var CONCURRENCY = 4;       // 同时下载的图片数，太大反而容易被打回
  var INLINE_MAX_W = 1000;   // 内嵌进网页/海报的图片最长边，够看清又不至于让文件爆掉
  var INLINE_Q = 0.86;

  var state = {
    zone: "",
    label: "",
    allowed: false,
    booted: false,
    busy: false,
    board: false,     // 当前页面是否为「多列并排看板」（渠道对比等）
    dock: null,
    htmlBtn: null,
    posterBtn: null,
    tip: null
  };

  function $(s, r) { return (r || document).querySelector(s); }
  function SBx() { return window.SB || null; }
  function trim(s) { return String(s == null ? "" : s).trim(); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- 提示 ---------------- */
  function toast(msg, ok) {
    var t = document.getElementById("toast");
    if (!t) { try { console.log("[导出] " + msg); } catch (e) {} return; }
    t.textContent = msg;
    t.className = "toast show" + (ok === false ? " bad" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = "toast"; }, 4200);
  }

  /* ---------------- 权限 ---------------- */
  function loadPerm() {
    var SB = SBx();
    if (!SB || typeof SB.myExportZones !== "function") return Promise.resolve(false);
    return SB.myExportZones().then(function (list) {
      if (!Array.isArray(list)) return false;
      if (list.indexOf("*") >= 0) return true;
      return list.indexOf(state.zone) >= 0;
    }).catch(function () { return false; });
  }

  /* ---------------- 悬浮入口 ---------------- */
  function buildDock() {
    if (state.dock) return state.dock;
    var d = document.createElement("div");
    d.className = "vx-dock";
    d.id = "vx-dock";

    var tip = document.createElement("span");
    tip.className = "vx-tip";
    tip.id = "vx-tip";

    var b1 = document.createElement("button");
    b1.type = "button";
    b1.className = "vx-btn";
    b1.id = "vx-btn-html";
    b1.textContent = "⤓ 单页网页";
    b1.title = "导出一个 HTML 文件，图片内嵌，双击即开、可直接转发";

    var b2 = document.createElement("button");
    b2.type = "button";
    b2.className = "vx-btn is-poster";
    b2.id = "vx-btn-poster";
    b2.textContent = "⛶ 高清海报";
    b2.title = "导出高清海报图（宽 2480px，内容过长自动分页）";

    d.appendChild(tip);
    d.appendChild(b1);
    d.appendChild(b2);
    document.body.appendChild(d);
    state.dock = d;
    state.htmlBtn = b1;
    state.posterBtn = b2;
    state.tip = tip;
    b1.onclick = function () { runHtml(); };
    b2.onclick = function () { runPoster(); };
    return d;
  }
  function showDock(on) {
    var d = buildDock();
    d.classList.toggle("on", !!on);
  }
  function setBusy(on, which) {
    state.busy = !!on;
    var b1 = state.htmlBtn, b2 = state.posterBtn;
    if (b1) { b1.disabled = !!on; b1.classList.toggle("is-busy", !!on && which === "html"); }
    if (b2) { b2.disabled = !!on; b2.classList.toggle("is-busy", !!on && which === "poster"); }
    if (b1) b1.textContent = (on && which === "html") ? "◌ 生成中…" : "⤓ 单页网页";
    if (b2) b2.textContent = (on && which === "poster") ? "◌ 绘制中…" : "⛶ 高清海报";
  }
  function setTip(t) { if (state.tip) state.tip.textContent = t || ""; }

  /* ============================================================
   * 一、从 DOM 收集「当前所见」
   * ============================================================ */

  /* 章节 = 页面上的一个分组列（榜单的类目列、渠道对比的每个来源列）。
     纯图墙（Pinterest / SHEIN / 品牌动向）没有分组，整页算一节。 */
  /* 读取这一列「每行摆几张」（页面上的图幅档位），导出时按同样张数铺，列才不至于走形 */
  function gridCols(p) {
    var g = p.querySelector(".rk-pool-grid");
    if (!g) return 0;
    var v = "";
    try { if (g.style && g.style.getPropertyValue) v = g.style.getPropertyValue("--rk-r"); } catch (e) {}
    if (!v) {
      var st = (g.getAttribute && g.getAttribute("style")) || "";
      var m = /--rk-r\s*:\s*(\d+)/.exec(st);
      if (m) v = m[1];
    }
    var n = parseInt(v, 10);
    if (n >= 1 && n <= 8) return n;
    /* 没有内联 --rk-r 时退回样式表里的档位（.sz-s=5 / .sz-l=3，默认 4），
       免得海报把一列 5 张的页面画成一列 4 张。 */
    var cls = (g.className || "") + " " + ((g.getAttribute && g.getAttribute("class")) || "");
    if (/\bsz-s\b/.test(cls)) return 5;
    if (/\bsz-l\b/.test(cls)) return 3;
    /* 天眼视图自己一套格数（--eye-r，默认 6） */
    var eye = "";
    try { if (g.style && g.style.getPropertyValue) eye = g.style.getPropertyValue("--eye-r"); } catch (e) {}
    var ne = parseInt(eye, 10);
    if (ne >= 1 && ne <= 8) return ne;
    return 4;
  }

  function collectSections() {
    var secs = [];
    var pools = document.querySelectorAll(".rk-pool");
    state.board = pools.length > 1;   // 页面是「多列并排看板」，导出也要并排
    if (pools.length) {
      Array.prototype.forEach.call(pools, function (p) {
        var nameEl = p.querySelector(".rk-pool-name > span");
        var metaEl = p.querySelector(".rk-pool-meta");
        /* 列头右上角的「N 张」与列底「已展示 48 / 200」是页面上两组真实信息，
           海报要照抄，否则拿走一张图谁也说不清这一列到底有多少张。 */
        var nEl = p.querySelector(".rk-pool-name .rk-n");
        var footEl = p.querySelector(".rk-pool-foot");
        var cards = pickCards(p);
        /* 并排看板：空列也要留着（页面上它就是一根写着「该列暂无数据」的空列，
           丢掉它列数就和页面对不上了）；堆叠模式：空组不出现。 */
        if (!cards.length && !state.board) return;
        secs.push({
          name: nameEl ? trim(nameEl.textContent) : "",
          meta: cleanMeta(metaEl ? metaEl.textContent : ""),
          nText: nEl ? trim(nEl.textContent) : "",
          foot: footEl ? trim(footEl.textContent) : "",
          cols: gridCols(p),
          cards: cards
        });
      });
    }
    if (!secs.length) {
      var cards = pickCards(document);
      if (cards.length) {
        secs.push({
          name: filterCatName() || state.label,
          meta: pageFilterSummary(),
          cards: cards
        });
      }
    }
    return secs;
  }

  /* 纯图墙（Pinterest / SHEIN）左侧菜单的当前类目 */
  function filterCatName() {
    var c = activeCat();
    if (!c || c === "全部" || c === "全部图片") return "";
    return c;
  }

  /* 纯图墙顶部筛选条的摘要（页面上写着「月度：2025-01」），导出要照抄，
     否则拿走一份只剩图的网页，谁也说不清这是哪个月的数据。 */
  function pageFilterSummary() {
    var el = document.querySelector("#cz-summary, .tf-trigger .tf-s");
    var t = el ? trim(el.textContent) : "";
    var bar = document.querySelector("#cz-bar .rk-bar-info");
    var b = bar ? trim(bar.textContent) : "";
    return dedupe([t, b].filter(Boolean)).join(" · ");
  }

  /* 「详细分析」这类按钮是操作入口，不属于展示信息，导出时剔掉 */
  function cleanMeta(t) {
    return trim(t).replace(/详细分析/g, "").replace(/\s+/g, " ").trim();
  }

  function activeCat() {
    var el = document.querySelector(".cat-menu-item.active, .cat-menu .active");
    return el ? trim(el.textContent).replace(/\s*\d+$/, "") : "";
  }

  function pickCards(root) {
    var out = [], seen = {};
    var figs = root.querySelectorAll(".rk-card[data-url]");
    if (figs.length) {
      Array.prototype.forEach.call(figs, function (f) {
        if (closest(f, "#rk-lightbox, .rk-lb, .rk-eye-loupe, .modal-mask, #vx-dock")) return;
        var url = trim(f.getAttribute("data-url"));
        if (!url || seen[url]) return;
        seen[url] = 1;
        out.push(cardOfFig(f, url));
      });
      return out;
    }
    var mvs = root.querySelectorAll(".mv-card");
    Array.prototype.forEach.call(mvs, function (c) {
      if (closest(c, "#vx-dock, .modal-mask")) return;
      var img = c.querySelector("img");
      var dUrl = trim(c.getAttribute ? c.getAttribute("data-url") : "");
      var url = dUrl || (img ? trim(img.getAttribute("src") || img.getAttribute("data-src")) : "");
      if (!url || seen[url]) return;
      seen[url] = 1;
      out.push(cardOfMv(c, url, img || { getAttribute: function () { return ""; } }));
    });
    return out;
  }

  function closest(el, sel) {
    if (!el || !el.closest) return null;
    return el.closest(sel);
  }

  function tagsOf(f) {
    var list = [];
    [" .rk-badge", ".rk-move", ".rk-share", ".rk-site"].forEach(function (s) {
      var e = f.querySelector(s.trim());
      if (e) list.push(trim(e.textContent));
    });
    var raw = trim(f.getAttribute("data-tags"));
    if (raw) raw.split("|").forEach(function (x) { if (trim(x)) list.push(trim(x)); });
    return dedupe(list);
  }

  function dedupe(a) {
    var out = [], seen = {};
    a.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }

  function cardOfFig(f, url) {
    var t = trim(f.getAttribute("data-title")) || trim(f.getAttribute("title"));
    return {
      url: url,
      title: t,
      cat: trim(f.getAttribute("data-cat")),
      site: trim(f.getAttribute("data-site")),
      period: trim(f.getAttribute("data-period")),
      tags: tagsOf(f),
      alt: trim((f.querySelector("img") || {}).alt)
    };
  }

  function cardOfMv(c, url, img) {
    var catEl = c.querySelector(".mv-card-cat");
    var badge = c.querySelector(".mv-season-badge");
    /* 图墙卡片（Pinterest / SHEIN / 品牌动向）在页面上显示的是「类目 + 月度角标」，
       导出必须跟着显示，否则拿到的是一堆没有说明的图。
       优先读卡片上挂的属性（页面渲染时写入，最准），没有再从 DOM 里取。 */
    var a = function (k) { return trim(c.getAttribute ? c.getAttribute(k) : ""); };
    var cat = a("data-cat") || (catEl ? trim(catEl.textContent) : "");
    var period = a("data-period") || (badge ? trim(badge.textContent) : "");
    var alt = trim(img.getAttribute("alt"));
    var title = a("data-title") || alt || cat;
    if (a("data-url")) url = a("data-url");
    return {
      url: url,
      title: title,
      cat: cat,
      site: "",
      period: period,
      /* 月度角标在图上是「看得见的信息」，导出成标签跟着卡片走 */
      tags: period ? [period] : [],
      alt: alt
    };
  }

  /* ============================================================
   * 二、取图：下载 → 缩小 → 变成自包含的 dataURL
   * ============================================================ */
  function fetchImage(url) {
    return fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" })
      .then(function (r) {
        if (!r || !r.ok) return null;
        return r.blob();
      })
      .then(function (b) { return (b && b.size) ? b : null; })
      .catch(function () { return null; });
  }

  /* 限并发跑完所有任务，返回与输入同序的结果 */
  function pool(tasks, limit, onStep) {
    var i = 0, done = 0, res = new Array(tasks.length);
    return new Promise(function (resolve) {
      if (!tasks.length) return resolve(res);
      function next() {
        if (i >= tasks.length) return;
        var k = i++;
        tasks[k]().then(function (v) {
          res[k] = v;
        }).catch(function () {
          res[k] = null;
        }).then(function () {
          done++;
          if (onStep) onStep(done, tasks.length);
          if (done === tasks.length) resolve(res);
          else next();
        });
      }
      for (var n = 0; n < Math.min(limit, tasks.length); n++) next();
    });
  }

  function decodeBlob(blob) {
    return new Promise(function (resolve) {
      if (typeof Image === "undefined" || typeof URL === "undefined" ||
          typeof URL.createObjectURL !== "function") return resolve(null);
      var url = null;
      try { url = URL.createObjectURL(blob); } catch (e) { return resolve(null); }
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () {
        try { URL.revokeObjectURL(url); } catch (e) {}
        resolve(null);
      };
      img.src = url;
    });
  }

  function release(dec) {
    if (!dec) return;
    try { URL.revokeObjectURL(dec.url); } catch (e) {}
  }

  /* 等比缩到最长边 maxW，转成 JPEG dataURL —— 网页内嵌与海报绘制都靠它 */
  function toDataUrl(img, maxW, q) {
    try {
      var w = img.naturalWidth || img.width || 0;
      var h = img.naturalHeight || img.height || 0;
      if (!w || !h) return "";
      var s = Math.min(1, maxW / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * s));
      var ch = Math.max(1, Math.round(h * s));
      var cv = document.createElement("canvas");
      cv.width = cw;
      cv.height = ch;
      var g = cv.getContext("2d");
      if (!g) return "";
      g.fillStyle = "#ffffff";        // 商品图多为白底，透明图转 JPEG 才不会变黑
      g.fillRect(0, 0, cw, ch);
      g.drawImage(img, 0, 0, cw, ch);
      return cv.toDataURL("image/jpeg", q || INLINE_Q);
    } catch (e) {
      return "";
    }
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (typeof Image === "undefined") return resolve(null);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  /* 把卡片上的图批量变成 dataURL（同一张图只处理一次） */
  function inlineAll(secs, onStep) {
    var uniq = [], seen = {};
    secs.forEach(function (s) {
      s.cards.forEach(function (c) {
        if (seen[c.url]) return;
        seen[c.url] = 1;
        uniq.push(c.url);
      });
    });
    var tasks = uniq.map(function (u) {
      return function () {
        return fetchImage(u).then(function (b) {
          if (!b) return null;
          return decodeBlob(b).then(function (dec) {
            if (!dec) return null;
            var data = toDataUrl(dec.img, INLINE_MAX_W, INLINE_Q);
            release(dec);
            return data || null;
          });
        });
      };
    });
    return pool(tasks, CONCURRENCY, onStep).then(function (res) {
      var map = {}, okCount = 0;
      uniq.forEach(function (u, i) {
        if (res[i]) { map[u] = res[i]; okCount++; }
      });
      secs.forEach(function (s) {
        s.cards.forEach(function (c) {
          if (map[c.url]) c.data = map[c.url];
        });
      });
      return { ok: okCount, failed: uniq.length - okCount, total: uniq.length };
    });
  }

  /* ============================================================
   * 三、成品①：单页网页（图片内嵌，一个文件）
   * ============================================================ */
  function ymd(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }
  function ymdDash(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function hhmm(d) {
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  function periodRange(secs) {
    var all = [];
    secs.forEach(function (s) {
      s.cards.forEach(function (c) { if (c.period) all.push(c.period); });
    });
    var uniq = dedupe(all).sort();
    if (!uniq.length) return "";
    return uniq.length === 1 ? uniq[0] : uniq[0] + "—" + uniq[uniq.length - 1];
  }

  /* 一张图卡（网页里的最小单元）：图片 + 悬停搜同款 + 可选标题/标签 */
  /* 并排（compact）时，渠道对比那种「只有图、没有字」的列保持干净；
     但榜单/上新节奏的列，图上本来就压着「上升 12 位 / 趋势爆款」这类字，
     这些字就是页面上看得见的信息，导出必须跟上，不能丢。 */
  function cardFigure(c, s, compact) {
    var src = c.data || c.url;
    var tip = [c.title, c.cat, c.period].filter(Boolean).join(" · ");
    var cap = (c.title ? '<span class="t">' + esc(c.title) + "</span>" : "") +
      (c.tags && c.tags.length ? '<span class="g">' + c.tags.map(function (x) {
        return "<span>" + esc(x) + "</span>";
      }).join("") + "</span>" : "");
    var hasCap = !compact || !!cap;
    return '<figure class="c">' +
      '<div class="ph">' +
      '<img loading="lazy" class="z" src="' + esc(src) + '" data-full="' + esc(src) + '"' +
      ' data-orig="' + esc(c.url) + '" title="' + esc(tip) + '"' +
      ' alt="' + esc(c.alt || c.title || s.name || "图片") + '">' +
      (c.data ? "" : '<span class="miss">未内嵌 · 原地址</span>') +
      '<button type="button" class="q" data-orig="' + esc(c.url) + '">⌕ 搜同款</button>' +
      "</div>" +
      (hasCap && cap ? "<figcaption>" + cap + "</figcaption>" : "") +
      "</figure>";
  }

  /* 排版 A：每个分组一个区块，纵向堆叠（榜单 / 上新节奏 / 纯图墙） */
  function bodyStack(secs) {
    var body = "";
    secs.forEach(function (s) {
      body += '<section class="sec">' +
        "<h2>" + esc(s.name || "未命名分组") + "</h2>" +
        (s.meta ? '<p class="m">' + esc(s.meta) + "</p>" : '<p class="m"></p>') +
        '<div class="grid">';
      s.cards.forEach(function (c) { body += cardFigure(c, s, false); });
      body += "</div></section>";
    });
    return body;
  }

  /* 排版 B：页面是几列并排（渠道对比选了哪几个渠道就有几列），导出就原样并排。
     每列保留页面上的「每行几张」，只取当前显示的这几列、这个顺序。 */
  function bodyColumns(secs) {
    var body = '<div class="cols">';
    secs.forEach(function (s) {
      var r = s.cols || 4;
      body += '<section class="col">' +
        '<div class="col-h"><span class="col-n">' + esc(s.name || "未命名列") + '</span>' +
        '<span class="col-c">' + s.cards.length + " 张</span></div>" +
        (s.meta ? '<div class="col-m">' + esc(s.meta) + "</div>" : "") +
        '<div class="cgrid" style="grid-template-columns:repeat(' + r + ',minmax(0,1fr))">';
      if (!s.cards.length) {
        body += '<div class="col-e">该列暂无数据</div>';
      }
      s.cards.forEach(function (c) { body += cardFigure(c, s, true); });
      body += "</div></section>";
    });
    return body + "</div>";
  }

  function buildHtml(secs, ctx) {
    var css = [
      "*{box-sizing:border-box}",
      "body{margin:0;background:#0e1116;color:#e8ecf3;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}",
      ".hd{padding:22px 26px 14px;border-bottom:1px solid #1e2531;position:sticky;top:0;background:rgba(14,17,22,.96);backdrop-filter:blur(8px);z-index:5}",
      ".hd h1{margin:0;font-size:19px;letter-spacing:.3px}",
      ".hd .sub{margin-top:6px;color:#8b96a8;font-size:12.5px;line-height:1.7;display:flex;flex-wrap:wrap;gap:4px 14px}",
      ".vx-note{margin:14px 26px 0;padding:10px 14px;border:1px solid #6b4a1f;background:#241a0c;color:#e7c17a;border-radius:8px;font-size:12.5px}",
      ".sec{padding:22px 26px 6px}",
      ".sec h2{margin:0 0 2px;font-size:15.5px;color:#dbe4f2}",
      ".sec .m{margin:0 0 14px;color:#7f8b9d;font-size:12px}",
      ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;align-items:start}",
      ".c{margin:0;background:#151a22;border:1px solid #1f2733;border-radius:10px;overflow:hidden}",
      ".ph{position:relative;aspect-ratio:3/4;background:#0b0f14;cursor:zoom-in;overflow:hidden}",
      ".ph img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .25s}",
      ".c:hover .ph img{transform:scale(1.03)}",
      ".ph .q{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);opacity:0;transition:opacity .16s,transform .16s;border:0;border-radius:999px;padding:8px 14px;background:rgba(17,22,30,.86);color:#eaf1ff;font-size:12.5px;cursor:pointer;backdrop-filter:blur(4px);white-space:nowrap}",
      ".c:hover .ph .q{opacity:1;transform:translate(-50%,-50%) scale(1)}",
      ".ph .miss{position:absolute;left:6px;top:6px;background:rgba(120,80,10,.92);color:#ffe6ae;font-size:11px;padding:2px 7px;border-radius:999px}",
      "figcaption{padding:9px 11px 11px}",
      ".t{display:block;font-size:12.8px;color:#dfe7f3;line-height:1.5;word-break:break-word}",
      ".g{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}",
      ".g span{font-size:11px;color:#9fb0c6;background:#1b222d;border:1px solid #26303f;border-radius:999px;padding:2px 8px}",
      ".lb{position:fixed;inset:0;background:rgba(6,8,11,.94);display:none;align-items:center;justify-content:center;z-index:99}",
      ".lb.on{display:flex}",
      ".lb img{max-width:92vw;max-height:86vh;object-fit:contain;border-radius:6px}",
      ".lb button{position:absolute;border:0;background:rgba(30,38,50,.9);color:#e8eef8;width:42px;height:42px;border-radius:50%;font-size:20px;cursor:pointer}",
      ".lb .x{right:20px;top:20px}",
      ".lb .p{left:18px;top:50%;transform:translateY(-50%)}",
      ".lb .n{right:18px;top:50%;transform:translateY(-50%)}",
      ".lb .cap{position:absolute;left:0;right:0;bottom:14px;text-align:center;color:#a9b6c8;font-size:12.5px;padding:0 60px}",
      ".cols{display:flex;gap:10px;align-items:flex-start;padding:16px 18px 28px;overflow-x:auto}",
      ".col{flex:1 1 0;min-width:170px;background:#12171f;border:1px solid #1f2733;border-radius:12px;padding:9px}",
      ".col-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:13.5px;font-weight:600;color:#e3eaf6;padding-bottom:7px;margin-bottom:8px;border-bottom:1px solid #1f2733}",
      ".col-n{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".col-c{flex:0 0 auto;font-size:11.5px;font-weight:400;color:#8b96a8}",
      ".col-m{margin:-2px 0 8px;font-size:11.5px;color:#7f8b9d;line-height:1.5}",
      ".cgrid{display:grid;gap:6px;align-content:start}",
      ".col-e{grid-column:1/-1;padding:26px 8px;text-align:center;color:#7f8b9d;font-size:12.5px;border:1px dashed #26303f;border-radius:8px}",
      ".cols .c{border-radius:8px}",
      ".cols .ph{cursor:zoom-in}",
      "@media(max-width:820px){.cols{gap:8px;padding:12px}.col{min-width:140px;padding:7px}}",
      "@media(max-width:640px){.grid{grid-template-columns:repeat(2,1fr);gap:10px}.hd,.sec{padding-left:14px;padding-right:14px}}"
    ].join("\n");

    var body = ctx.columns ? bodyColumns(secs) : bodyStack(secs);

    var note = ctx.failed ? '<div class="vx-note">有 ' + ctx.failed +
      " 张图没能抓取（对方站点不允许跨域取图），这几张在下面按原地址显示，需要联网才能看到；" +
      "其余 " + ctx.ok + " 张已全部内嵌在本文件里，转发时不用带任何附件。</div>" : "";

    var script = [
      "(function(){",
      "var imgs=[].slice.call(document.querySelectorAll('img.z'));",
      "var lb=document.getElementById('lb'),big=document.getElementById('lb-img'),cap=document.getElementById('lb-cap'),cur=0;",
      "function show(i){if(!imgs.length)return;cur=(i+imgs.length)%imgs.length;var im=imgs[cur];big.src=im.getAttribute('data-full');cap.textContent=(cur+1)+' / '+imgs.length+' · '+(im.getAttribute('alt')||'');lb.classList.add('on');}",
      "function hide(){lb.classList.remove('on');}",
      "imgs.forEach(function(im,i){im.parentNode.parentNode.addEventListener('click',function(e){if(e.target.closest('.q'))return;show(i);});});",
      "document.querySelector('.lb .x').onclick=hide;",
      "lb.addEventListener('click',function(e){if(e.target===lb)hide();});",
      "document.querySelector('.lb .p').onclick=function(e){e.stopPropagation();show(cur-1);};",
      "document.querySelector('.lb .n').onclick=function(e){e.stopPropagation();show(cur+1);};",
      "document.addEventListener('keydown',function(e){if(!lb.classList.contains('on'))return;if(e.key==='Escape')hide();if(e.key==='ArrowLeft')show(cur-1);if(e.key==='ArrowRight')show(cur+1);});",
      "[].slice.call(document.querySelectorAll('.q')).forEach(function(b){b.addEventListener('click',function(e){e.stopPropagation();e.preventDefault();var u=b.getAttribute('data-orig');if(!/^https?:/i.test(u))return;window.open('https://lens.google.com/uploadbyurl?url='+encodeURIComponent(u),'_blank','noopener');});});",
      "})();"
    ].join("");

    var subHtml = String(ctx.sub || "").split(" · ").filter(Boolean).map(function (x) {
      return "<span>" + esc(x) + "</span>";
    }).join("");

    return "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n" +
      '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
      "<title>" + esc(ctx.title) + "</title>\n<style>\n" + css + "\n</style>\n</head>\n<body>\n" +
      '<header class="hd"><h1>' + esc(ctx.title) + "</h1><div class=\"sub\">" + subHtml + "</div></header>\n" +
      note + "\n" + body +
      "\n<div class=\"lb\" id=\"lb\"><img id=\"lb-img\" alt=\"\"><button type=\"button\" class=\"x\">×</button>" +
      "<button type=\"button\" class=\"p\">‹</button><button type=\"button\" class=\"n\">›</button>" +
      '<div class="cap" id="lb-cap"></div></div>\n' +
      "<script>" + script + "</" + "script>\n</body>\n</html>";
  }


  /* ============================================================
   * 三之二、成品①的正解：把页面上那一段 DOM 原样搬走
   * ------------------------------------------------------------
   * 之前是「按采集到的卡片重新画一遍」。问题是页面上的东西不止卡片本身：
   *   · 图上压着的角标（趋势爆款 / 上升 12 位 / 共 3 国 / 国家站点）
   *   · 每列列头的「周次 · N 张」与副标题（重合度、口径说明）
   *   · 列上方的体征卡、报告头
   *   · 每行到底摆几张（由脚本按列宽实时算出来写进 --rk-r）
   * 重画一遍必然漏东西，用户看到的就是「导出的和页面上不一样」。
   *
   * 所以改成：克隆当前已经渲染出来的那块 DOM → 去掉所有能点的控件 →
   * 把图片换成内嵌数据 → 把站点自己的样式表整篇带上。
   * 位置、列数、每行张数、图上文字因此与页面完全一致（本来就是同一份 DOM）。
   * ============================================================ */
  var PAGE_CSS = "css/style.css";
  var pageCss = null;

  function loadPageCss() {
    if (pageCss != null) return Promise.resolve(pageCss);
    if (typeof fetch !== "function") { pageCss = ""; return Promise.resolve(""); }
    return fetch(PAGE_CSS, { cache: "force-cache" })
      .then(function (r) { return (r && r.ok) ? r.text() : ""; })
      .then(function (t) { pageCss = t || ""; return pageCss; })
      .catch(function () { pageCss = ""; return ""; });
  }

  /* 各前台页面「图片所在的那块主体」 */
  function viewRoot() {
    var ids = ["#rk-body", "#cmp-body", "#cz-body", "#mv-body"];
    for (var i = 0; i < ids.length; i++) {
      var el = document.querySelector(ids[i]);
      if (el && el.querySelector && el.querySelector("img")) return el;
    }
    return null;
  }

  /* 这些是「操作入口」不是「展示内容」：导出物里一律去掉（导出的东西不能再改数据） */
  var DROP_SEL = [
    "#vx-dock", "#toast", ".modal-mask", ".rk-lb", "#rk-lightbox",
    ".rk-pool-grip", ".rk-fav", ".rk-pick", ".rk-card-del", ".rk-del",
    ".cz-card-x", ".cz-del", ".mv-card-x", ".cp-del", ".fp-del",
    ".rk-more-wrap", ".rk-empty-actions",
    "input", "select", "textarea", "button", "[contenteditable]"
  ].join(",");

  function removeNode(el) {
    if (!el) return;
    if (typeof el.remove === "function") { try { el.remove(); return; } catch (e) {} }
    if (el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el);
  }

  function sanitizeClone(clone) {
    var kill = clone.querySelectorAll(DROP_SEL);
    Array.prototype.forEach.call(kill, function (el) { removeNode(el); });
    var soft = clone.querySelectorAll("[draggable],[data-pick],[data-fav]");
    Array.prototype.forEach.call(soft, function (el) {
      if (!el || !el.removeAttribute) return;
      el.removeAttribute("draggable");
      el.removeAttribute("data-pick");
      el.removeAttribute("data-fav");
    });
    return clone;
  }

  function imgUrlsOf(root) {
    var out = [], seen = {};
    var imgs = root.querySelectorAll("img");
    Array.prototype.forEach.call(imgs, function (im) {
      var u = trim((im.getAttribute && (im.getAttribute("src") || im.getAttribute("data-src"))) || "");
      if (u && !seen[u]) { seen[u] = 1; out.push(u); }
    });
    return out;
  }

  /* 把克隆体里的图逐张抓下来、转成内嵌数据（同一地址只抓一次） */
  function inlineDom(root, onStep) {
    var urls = imgUrlsOf(root);
    var tasks = urls.map(function (u) {
      return function () {
        return fetchImage(u).then(function (b) {
          if (!b) return null;
          return decodeBlob(b).then(function (dec) {
            if (!dec) return null;
            var d = toDataUrl(dec.img, INLINE_MAX_W, INLINE_Q);
            release(dec);
            return d || null;
          });
        });
      };
    });
    return pool(tasks, CONCURRENCY, onStep).then(function (res) {
      var map = {}, okCount = 0;
      urls.forEach(function (u, i) { if (res[i]) { map[u] = res[i]; okCount++; } });
      var imgs = root.querySelectorAll("img");
      Array.prototype.forEach.call(imgs, function (im) {
        if (!im || !im.getAttribute) return;
        var u = trim(im.getAttribute("src") || im.getAttribute("data-src") || "");
        var d = u ? map[u] : "";
        if (d) {
          im.setAttribute("src", d);
          im.setAttribute("data-full", d);
        } else {
          im.setAttribute("data-miss", "1");
          if (u) im.setAttribute("data-full", u);
        }
        if (im.removeAttribute) { im.removeAttribute("srcset"); im.removeAttribute("data-src"); }
        im.setAttribute("loading", "lazy");
      });
      return { ok: okCount, failed: urls.length - okCount, total: urls.length };
    });
  }

  function buildHtmlDom(clone, ctx, stat, css, wrapW) {
    var extra = [
      "html,body{margin:0;padding:0;height:auto!important;min-height:100%;overflow-x:hidden}",
      "body.vx-export{background:var(--bg,#f6f5f3);color:var(--txt,#1b1b1b)}",
      ".vx-hd{padding:14px 18px 10px;border-bottom:1px solid var(--line,#e7e4de);background:var(--bg2,#fff)}",
      ".vx-hd h1{margin:0;font-size:17px;line-height:1.4;color:var(--txt,#1b1b1b)}",
      ".vx-hd .sub{margin-top:5px;color:var(--sub,#8b8b8b);font-size:12px;line-height:1.7;display:flex;flex-wrap:wrap;gap:2px 12px}",
      ".vx-note{margin:10px 18px 0;padding:9px 12px;border:1px solid #6b4a1f;background:#241a0c;color:#e7c17a;border-radius:8px;font-size:12.5px;line-height:1.6}",
      ".vx-wrap{padding:10px 16px 28px;overflow-x:auto}",
      /* 页面靠脚本按窗口宽度算列，导出的这份必须在任何窗口下都保持「同样的几列并排」：
         否则在窄窗口/手机上会命中样式表里的窄屏断点，几列被压成一列竖排 ——
         这正是「导出来的和页面不一样」最常见的原因。 */
      "body.vx-export .rk-pools{display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:flex-start!important;max-height:none!important;overflow:visible!important}",
      "body.vx-export .rk-pools>.rk-pool{flex:1 1 0!important;min-width:0!important}",
      "body.vx-export .rk-pool-head{position:static!important}",
      "body.vx-export .rk-pool-grid{grid-template-columns:repeat(var(--rk-r,4),minmax(0,1fr))!important;gap:6px!important}",
      "body.vx-export .rk-pool-grid img{width:100%!important;height:auto!important;display:block}",
      "body.vx-export .rk-pool-foot{text-align:center}",
      ".vx-wrap img[data-miss]{outline:2px solid #6b4a1f;outline-offset:-2px}",
      ".vx-wrap .rk-card,.vx-wrap .cz-card,.vx-wrap .mv-card{cursor:zoom-in}",
      "#vx-lb{position:fixed;inset:0;background:rgba(6,8,11,.94);display:none;align-items:center;justify-content:center;z-index:9999}",
      "#vx-lb.on{display:flex}",
      "#vx-lb img{max-width:94vw;max-height:88vh;object-fit:contain;border-radius:4px}",
      "#vx-lb button{position:absolute;border:0;background:rgba(30,38,50,.92);color:#e8eef8;width:42px;height:42px;border-radius:50%;font-size:20px;cursor:pointer}",
      "#vx-lb .x{right:16px;top:14px}",
      "#vx-lb .p{left:16px;top:50%;transform:translateY(-50%)}",
      "#vx-lb .n{right:16px;top:50%;transform:translateY(-50%)}",
      "@media(max-width:760px){.vx-wrap{padding:8px}.vx-hd{padding:12px}}"
    ].join("\n");

    var subHtml = String(ctx.sub || "").split(" · ").filter(Boolean).map(function (x) {
      return "<span>" + esc(x) + "</span>";
    }).join("");

    var note = stat.failed
      ? '<div class="vx-note">有 ' + stat.failed + " 张图没能抓取（对方站点不允许跨域取图），" +
        "这几张保留原地址、需要联网才能看到；其余 " + stat.ok + " 张已内嵌在本文件里。</div>"
      : "";

    var script = [
      "(function(){",
      "var imgs=[].slice.call(document.querySelectorAll('.vx-wrap img'));",
      "if(!imgs.length)return;",
      "var lb=document.getElementById('vx-lb'),big=document.getElementById('vx-lb-img'),cur=0;",
      "function show(i){cur=(i+imgs.length)%imgs.length;var im=imgs[cur];big.src=im.getAttribute('data-full')||im.src;big.alt=im.getAttribute('alt')||'';lb.classList.add('on');}",
      "function hide(){lb.classList.remove('on');}",
      "imgs.forEach(function(im,i){im.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();show(i);});});",
      "document.getElementById('vx-x').onclick=hide;",
      "document.getElementById('vx-p').onclick=function(e){e.stopPropagation();show(cur-1);};",
      "document.getElementById('vx-n').onclick=function(e){e.stopPropagation();show(cur+1);};",
      "lb.addEventListener('click',function(e){if(e.target===lb)hide();});",
      "document.addEventListener('keydown',function(e){if(!lb.classList.contains('on'))return;if(e.key==='Escape')hide();if(e.key==='ArrowLeft')show(cur-1);if(e.key==='ArrowRight')show(cur+1);});",
      "})();"
    ].join("");

    var html = clone && clone.outerHTML ? clone.outerHTML : "";
    if (!html) return "";

    return "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n" +
      '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
      "<title>" + esc(ctx.title) + "</title>\n<style>\n" + (css || "") + "\n" + extra + "\n</style>\n</head>\n" +
      '<body class="front vx-export">\n' +
      '<header class="vx-hd"><h1>' + esc(ctx.title) + '</h1><div class="sub">' + subHtml + "</div></header>\n" +
      note + "\n" +
      '<div class="vx-wrap" style="' + (wrapW ? ("width:" + wrapW + "px;min-width:" + Math.min(wrapW, 720) + "px;") : "") + 'margin:0 auto">\n' +
      html + "\n</div>\n" +
      '<div id="vx-lb"><img id="vx-lb-img" alt=""><button type="button" class="x" id="vx-x">×</button>' +
      '<button type="button" class="p" id="vx-p">‹</button><button type="button" class="n" id="vx-n">›</button></div>\n' +
      "<script>" + script + "</" + "script>\n</body>\n</html>";
  }

  /* ============================================================
   * 四、成品②：高清海报图
   * ============================================================ */
  var POSTER = {
    W: 1240,        // 设计宽度（逻辑像素），实际输出按 SCALE 放大
    M: 44,          // 页边距
    GAP: 20,        // 卡片间距
    COLS: 4,        // 每行几张
    HEAD_H: 146,    // 页头高
    SEC_H: 56,      // 分组标题高
    CAP_H: 92,      // 图片下方文字区高
    MAX_H: 5200     // 单张海报最大高度（设计像素），超出自动分页
  };
  var SCALE = 2;    // 2 → 输出宽 2480px

  function posterFont(weight, size) {
    return weight + " " + size + 'px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
  }

  function metrics() {
    var cardW = (POSTER.W - POSTER.M * 2 - (POSTER.COLS - 1) * POSTER.GAP) / POSTER.COLS;
    var imgH = Math.round(cardW * 4 / 3);
    return {
      cardW: cardW,
      imgH: imgH,
      cardH: imgH + POSTER.CAP_H,
      rowH: imgH + POSTER.CAP_H + POSTER.GAP
    };
  }

  /* 排版：把各分组的卡片按行铺开，超过最大高度就换一张（续页带「（续）」） */
  function layout(secs) {
    var m = metrics();
    var sheets = [], cur = null, y = 0;

    function open() {
      cur = { no: sheets.length + 1, blocks: [], h: 0 };
      sheets.push(cur);
      y = POSTER.HEAD_H;
      cur.h = y;
    }
    open();

    secs.forEach(function (s) {
      var idx = 0, onSheetStart = false, shownBefore = false;
      while (idx < s.cards.length) {
        var headH = onSheetStart ? 0 : POSTER.SEC_H;
        if (y + headH + m.rowH > POSTER.MAX_H && y > POSTER.HEAD_H) {
          open();                 // 换页，本组在下一页要重画标题
          onSheetStart = false;
          continue;
        }
        if (!onSheetStart) {
          cur.blocks.push({
            type: "sec",
            name: s.name + (shownBefore ? "（续）" : ""),
            meta: s.meta
          });
          y += POSTER.SEC_H;
          onSheetStart = true;
          shownBefore = true;
        }
        cur.blocks.push({ type: "row", cards: s.cards.slice(idx, idx + POSTER.COLS) });
        idx += POSTER.COLS;
        y += m.rowH;
        cur.h = y;
      }
    });

    sheets.forEach(function (sh) {
      sh.h = Math.max(POSTER.HEAD_H + 40, sh.h + POSTER.M - POSTER.GAP);
    });
    return sheets;
  }

  /* 多列看板（渠道对比 / 榜单对比池 / 上新节奏对比池）：
     页面上是「N 列并排，每列内部又按 --rk-r 摆成一小格一小格」。
     海报必须照这个结构画；否则把「3 列 × 每列每行 6 张」画成「3 列 × 每列一张大图」，
     就不是「页面怎么显示就怎么导出」了。 */
  var COL_HEAD_H = 56;
  var COL_FOOT_H = 26;   // 列底「已展示 48 / 200」
  var COL_CGAP = 6;      // 列内小格子间距，与页面 .rk-pool-grid 一致

  /* 一列里每行摆几张：优先取页面上算好的 --rk-r，取不到按 4 张 */
  function colGridR(s) {
    var r = parseInt(s && s.cols, 10);
    if (!(r >= 1)) r = 4;
    return Math.max(2, Math.min(8, r));
  }

  function layoutCols(secs) {
    var C = Math.max(1, secs.length);
    var colW = (POSTER.W - POSTER.M * 2 - (C - 1) * POSTER.GAP) / C;
    var top = POSTER.HEAD_H + COL_HEAD_H;

    var geo = secs.map(function (s) {
      var R = colGridR(s);
      var cw = (colW - (R - 1) * COL_CGAP) / R;
      var ih = Math.round(cw * 4 / 3);        // 页面卡片是 3:4 竖图
      return { R: R, cw: cw, ih: ih, rowH: ih + COL_CGAP };
    });

    var idx = secs.map(function () { return 0; });
    var shown = secs.map(function () { return 0; });
    var sheets = [];

    for (var guard = 0; guard < 500; guard++) {
      var sh = { no: sheets.length + 1, colMode: true, colW: colW, cols: [], h: top };
      var any = false, left = false;
      for (var i = 0; i < C; i++) {
        var s = secs[i], g0 = geo[i];
        var room = POSTER.MAX_H - POSTER.M - COL_FOOT_H - top;
        var maxRows = Math.max(1, Math.floor((room + COL_CGAP) / g0.rowH));
        var take = Math.min(Math.max(0, s.cards.length - idx[i]), maxRows * g0.R);
        var slice = take > 0 ? s.cards.slice(idx[i], idx[i] + take) : [];
        idx[i] += take;
        if (take) any = true;
        if (idx[i] < s.cards.length) left = true;
        var rows = Math.ceil(slice.length / g0.R);
        var ch = rows ? top + rows * g0.rowH - COL_CGAP + COL_FOOT_H : top + COL_FOOT_H;
        sh.cols.push({
          name: s.name,
          meta: s.meta,
          nText: s.nText,
          foot: s.foot,
          cards: slice,
          R: g0.R, cw: g0.cw, ih: g0.ih, rowH: g0.rowH,
          cont: shown[i] > 0 && take > 0,          // 这一张是续列
          h: ch
        });
        if (take) shown[i] += take;
        sh.h = Math.max(sh.h, ch);
      }
      if (!any) break;
      sheets.push(sh);
      if (!left) break;
    }

    if (!sheets.length) {
      sheets.push({
        no: 1, colMode: true, colW: colW,
        cols: secs.map(function (s) {
          var R = colGridR(s), cw = (colW - (R - 1) * COL_CGAP) / R;
          return {
            name: s.name, meta: s.meta, nText: s.nText, foot: s.foot, cards: [],
            R: R, cw: cw, ih: Math.round(cw * 4 / 3), rowH: Math.round(cw * 4 / 3) + COL_CGAP,
            cont: false, h: top + COL_FOOT_H
          };
        }),
        h: top + COL_FOOT_H + 20
      });
    }
    sheets.forEach(function (sh) {
      sh.h = Math.max(top + COL_FOOT_H, sh.h + POSTER.M - 6);
    });
    return sheets;
  }

  function drawColHead(g, col, x, y, w) {
    g.fillStyle = "#6fa3f0";
    g.fillRect(x, y + 8, 4, 20);

    /* 左：期次（列名），右：该列张数 —— 与页面列头同序 */
    var rightW = 0;
    if (col.nText) {
      g.font = posterFont("400", 12.5);
      rightW = Math.min(w * 0.42, g.measureText(col.nText).width + 8);
    }
    g.fillStyle = "#dbe4f2";
    g.font = posterFont("700", 18);
    var name = wrapLines(g, (col.name || "未命名列") + (col.cont ? "（续）" : ""), w - 26 - rightW, 1)[0] || "";
    g.fillText(name, x + 13, y + 26);

    if (col.nText) {
      g.font = posterFont("400", 12.5);
      g.fillStyle = "#7f8b9d";
      g.textAlign = "right";
      g.fillText(col.nText, x + w, y + 26);
      g.textAlign = "left";
    }

    /* 副标题：页面上那句「美国 · 较上一周（W39）新上榜 73 张」，一个字都不省 */
    if (col.meta) {
      g.font = posterFont("400", 12.5);
      g.fillStyle = "#7f8b9d";
      g.fillText(wrapLines(g, col.meta, w - 8, 1)[0] || "", x, y + 46);
    }

    g.strokeStyle = "#1f2733";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y + COL_HEAD_H - 8);
    g.lineTo(x + w, y + COL_HEAD_H - 8);
    g.stroke();
  }

  /* 列底「已展示 48 / 200」：页面有，海报也要有 */
  function drawColFoot(g, col, x, y, w) {
    if (!col.foot) return;
    g.font = posterFont("400", 11.5);
    g.fillStyle = "#5c6779";
    g.textAlign = "center";
    var t = wrapLines(g, col.foot + (col.cont ? "（续）" : ""), w - 4, 1)[0] || "";
    g.fillText(t, x + w / 2, y);
    g.textAlign = "left";
  }

  function roundRect(g, x, y, w, h, r) {
    var tl, tr, br, bl;
    if (Object.prototype.toString.call(r) === "[object Array]") {
      tl = r[0]; tr = r[1]; br = r[2]; bl = r[3];
    } else { tl = tr = br = bl = r; }
    g.beginPath();
    g.moveTo(x + tl, y);
    g.lineTo(x + w - tr, y);
    g.quadraticCurveTo(x + w, y, x + w, y + tr);
    g.lineTo(x + w, y + h - br);
    g.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    g.lineTo(x + bl, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - bl);
    g.lineTo(x, y + tl);
    g.quadraticCurveTo(x, y, x + tl, y);
    g.closePath();
  }

  /* 按宽度折行，超出 maxLines 时末行加省略号 */
  function wrapLines(g, text, maxW, maxLines) {
    var t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    if (!t) return [];
    var lines = [], buf = "";
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (g.measureText(buf + ch).width > maxW && buf) {
        lines.push(buf);
        buf = ch;
        if (lines.length === maxLines) break;
      } else {
        buf += ch;
      }
    }
    if (lines.length < maxLines && buf) lines.push(buf);
    if (lines.length === maxLines) {
      var consumed = lines.join("").length;
      if (consumed < t.length) {
        var last = lines[maxLines - 1];
        while (last && g.measureText(last + "…").width > maxW) last = last.slice(0, -1);
        lines[maxLines - 1] = last + "…";
      }
    }
    return lines;
  }

  function coverDraw(g, im, x, y, w, h) {
    var iw = im.naturalWidth || im.width || 0;
    var ih = im.naturalHeight || im.height || 0;
    if (!iw || !ih) return false;
    var s = Math.max(w / iw, h / ih);
    var dw = iw * s, dh = ih * s;
    g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return true;
  }

  function drawHeader(g, ctx, W) {
    var grad = g.createLinearGradient(0, 0, W * 0.7, POSTER.HEAD_H * 1.5);
    grad.addColorStop(0, "#18202e");
    grad.addColorStop(1, "#0e1116");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, POSTER.HEAD_H);

    g.fillStyle = "#5b8fe0";
    g.fillRect(POSTER.M, 40, 5, 42);

    g.textBaseline = "alphabetic";
    g.fillStyle = "#eef3fb";
    g.font = posterFont("700", 33);
    var title = wrapLines(g, ctx.title, W - POSTER.M * 2 - 24, 1)[0] || "";
    g.fillText(title, POSTER.M + 20, 76);

    g.font = posterFont("400", 15);
    g.fillStyle = "#8b96a8";
    var sub = wrapLines(g, ctx.sub, W - POSTER.M * 2 - 20, 2);
    sub.forEach(function (ln, i) {
      g.fillText(ln, POSTER.M + 20, 104 + i * 22);
    });

    g.strokeStyle = "#1e2531";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, POSTER.HEAD_H - 1);
    g.lineTo(W, POSTER.HEAD_H - 1);
    g.stroke();
  }

  function drawSec(g, b, y, W) {
    g.fillStyle = "#6fa3f0";
    g.fillRect(POSTER.M, y + 6, 4, 22);

    g.fillStyle = "#dbe4f2";
    g.font = posterFont("700", 22);
    var name = wrapLines(g, b.name || "未命名分组", W - POSTER.M * 2 - 260, 1)[0] || "";
    g.fillText(name, POSTER.M + 15, y + 25);

    if (b.meta) {
      g.font = posterFont("400", 14);
      g.fillStyle = "#7f8b9d";
      g.textAlign = "right";
      g.fillText(wrapLines(g, b.meta, 300, 1)[0] || "", W - POSTER.M, y + 24);
      g.textAlign = "left";
    }
  }

  /* 图上角标：取卡片第一个标签（「上升 12 位」「新上榜」「美国」），画在图内左下 */
  function drawCardOverTag(g, c, x, y, cardW, imgH) {
    var t = (c && c.tags && c.tags[0]) || (c && c.title) || "";
    t = String(t).trim();
    if (!t) return;
    var fs = Math.max(9, Math.round(cardW * 0.095));
    g.font = posterFont("600", fs);
    var tw = g.measureText(t).width + fs;
    if (tw > cardW - 6) return;
    var th = fs + 8;
    var bx = x + 3, by = y + imgH - th - 3;
    roundRect(g, bx, by, tw, th, th / 2);
    g.fillStyle = "rgba(12,16,22,.78)";
    g.fill();
    g.fillStyle = "#e7eefb";
    g.fillText(t, bx + fs / 2, by + th - 5);
  }

  function drawCard(g, c, x, y, m) {
    var cardW = m.cardW, imgH = m.imgH, cardH = m.cardH, r = 10;

    roundRect(g, x, y, cardW, cardH, r);
    g.fillStyle = "#151a22";
    g.fill();

    g.save();
    roundRect(g, x, y, cardW, imgH, [r, r, 0, 0]);
    g.clip();
    g.fillStyle = "#0b0f14";
    g.fillRect(x, y, cardW, imgH);
    var drawn = c._im ? coverDraw(g, c._im, x, y, cardW, imgH) : false;
    if (!drawn) {
      g.fillStyle = "#39445a";
      g.font = posterFont("400", 13);
      g.textAlign = "center";
      g.fillText("图片未抓取", x + cardW / 2, y + imgH / 2);
      g.textAlign = "left";
    }
    g.restore();

    roundRect(g, x + 0.5, y + 0.5, cardW - 1, cardH - 1, r);
    g.strokeStyle = "#1f2733";
    g.lineWidth = 1;
    g.stroke();

    /* 紧凑卡（与页面同样的小格子）：不画标题，但页面上压在图上的
       「上升 12 位 / 新上榜 / 站点头」这类角标要跟着画，否则导出后信息就丢了 */
    if (typeof m.capH === "number" && m.capH < 30) {
      drawCardOverTag(g, c, x, y, cardW, imgH);
      return;
    }
    var tx = x + 12, tw = cardW - 24;
    var maxLines = Math.max(1, Math.min(2, Math.floor((m.capH - 10) / 21)));
    g.font = posterFont("400", 15);
    g.fillStyle = "#dfe7f3";
    var lines = wrapLines(g, c.title || c.alt || "", tw, maxLines);
    lines.forEach(function (ln, i) {
      g.fillText(ln, tx, y + imgH + 24 + i * 21);
    });

    /* 标签：最多两个，宽度不够就停 */
    var tags = (c.tags || []).slice(0, 2);
    if (tags.length) {
      var ty = y + cardH - 17;
      var cx = tx;
      g.font = posterFont("400", 11);
      tags.forEach(function (t) {
        var tw2 = g.measureText(t).width + 16;
        if (cx + tw2 > x + cardW - 10) return;
        roundRect(g, cx, ty - 11, tw2, 18, 9);
        g.fillStyle = "#1b222d";
        g.fill();
        g.strokeStyle = "#26303f";
        g.stroke();
        g.fillStyle = "#9fb0c6";
        g.fillText(t, cx + 8, ty + 2);
        cx += tw2 + 6;
      });
    }
  }

  function renderSheet(sheet, ctx) {
    var m = metrics();
    var W = POSTER.W, H = sheet.h;

    var cv = document.createElement("canvas");
    cv.width = Math.round(W * SCALE);
    cv.height = Math.round(H * SCALE);
    var g = cv.getContext("2d");
    if (!g) return null;
    g.scale(SCALE, SCALE);

    g.fillStyle = "#0e1116";
    g.fillRect(0, 0, W, H);
    drawHeader(g, ctx, W);

    if (sheet.colMode) {
      /* 与页面同构：每一列内部再按 --rk-r 铺成小格子，不是一列一张大图 */
      sheet.cols.forEach(function (col, i) {
        var x = POSTER.M + i * (sheet.colW + POSTER.GAP);
        drawColHead(g, col, x, POSTER.HEAD_H, sheet.colW);
        var y0 = POSTER.HEAD_H + COL_HEAD_H;
        var R = Math.max(1, col.R || 4);
        col.cards.forEach(function (c, k) {
          var r = Math.floor(k / R), q = k % R;
          drawCard(g, c, x + q * (col.cw + COL_CGAP), y0 + r * col.rowH, {
            cardW: col.cw, imgH: col.ih, cardH: col.ih, capH: 0
          });
        });
        var rows = Math.ceil(col.cards.length / R);
        drawColFoot(g, col, x, rows ? y0 + rows * col.rowH + 12 : y0 + 14, sheet.colW);
      });

      g.font = posterFont("400", 12);
      g.fillStyle = "#5c6779";
      g.fillText(ctx.footer + (sheet.no > 1 ? " · 第 " + sheet.no + " 张" : ""), POSTER.M, H - 12);
      return cv;
    }

    var y = POSTER.HEAD_H;
    sheet.blocks.forEach(function (b) {
      if (b.type === "sec") {
        drawSec(g, b, y, W);
        y += POSTER.SEC_H;
        return;
      }
      b.cards.forEach(function (c, i) {
        drawCard(g, c, POSTER.M + i * (m.cardW + POSTER.GAP), y, m);
      });
      y += m.rowH;
    });

    /* 页脚：来源 + 页码 */
    g.font = posterFont("400", 12);
    g.fillStyle = "#5c6779";
    g.fillText(ctx.footer + (sheet.no > 1 ? " · 第 " + sheet.no + " 张" : ""), POSTER.M, H - 18);

    return cv;
  }

  function canvasBlob(cv, type, q) {
    return new Promise(function (resolve) {
      if (cv.toBlob) {
        cv.toBlob(function (b) { resolve(b); }, type, q);
      } else resolve(null);
    });
  }

  /* 按需加载某一张海报里的图（画完就丢，避免几百张图同时挂在内存里） */
  function loadSheetImages(cards) {
    var tasks = cards.map(function (c) {
      return function () {
        if (!c.data) return Promise.resolve(null);
        return loadImage(c.data);
      };
    });
    return pool(tasks, 6).then(function (res) {
      res.forEach(function (im, i) { cards[i]._im = im || null; });
    });
  }

  /* ============================================================
   * 五、主流程
   * ============================================================ */
  function safeName(s, max) {
    var t = String(s == null ? "" : s)
      .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    if (!t) t = "未命名";
    return max && t.length > max ? t.slice(0, max) : t;
  }

  function contextOf(secs, now, totalOverride) {
    var cat = activeCat();
    var rng = periodRange(secs);
    var total = 0;
    secs.forEach(function (s) { total += s.cards.length; });
    if (typeof totalOverride === "number" && totalOverride > 0) total = totalOverride;

    var nameParts = [state.label];
    if (cat && cat !== "全部") nameParts.push(cat);
    if (rng) nameParts.push(rng);
    nameParts.push(ymd(now));

    var title = state.label + (cat && cat !== "全部" ? " · " + cat : "") + (rng ? " · " + rng : "");
    var sub = [
      "来源：前台「" + state.label + "」当前筛选所见",
      "类目：" + (cat || "全部"),
      rng ? "期次：" + rng : "",
      isBoard() ? "共 " + total + " 张 · " + secs.length + " 列并排（与页面同序）" : "共 " + total + " 张",
      "导出于 " + ymdDash(now) + " " + hhmm(now)
    ].filter(Boolean).join(" · ");

    return { total: total, cat: cat, rng: rng, baseName: safeName(nameParts.join("_"), 80), title: title, sub: sub };
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (e) {}
      a.remove();
    }, 1500);
  }

  function ready() {
    if (state.busy) return null;
    if (!state.allowed) { toast("你没有导出权限，请联系超级管理员开通", false); return null; }
    var secs = collectSections();
    var n = 0;
    secs.forEach(function (s) { n += s.cards.length; });

    /* 兜底：有的专区图片不是 .rk-card / .mv-card（或刚改过卡片结构），
       采集会一张都取不到。这种情况下不再直接报「没有可导出的图片」，
       而是按页面主体里实际存在的图片建一个分组 —— 导出的还是页面上看到的那批图。 */
    if (!secs.length || !n) {
      var root = viewRoot();
      var urls = root ? imgUrlsOf(root) : [];
      if (urls.length) {
        secs = [{
          name: state.label,
          meta: pageFilterSummary(),
          cards: urls.map(function (u) {
            return { url: u, title: "", cat: "", site: "", period: "", tags: [], alt: "" };
          })
        }];
        n = urls.length;
      }
    }

    if (!secs.length || !n) { toast("当前页面没有可导出的图片", false); return null; }
    return secs;
  }

  /* 是否按「多列并排」导出：只要页面上这些分组是横向并排画的列
     （渠道对比、趋势上升榜的对比池、上新节奏的对比池都是 .rk-pools 横排），
     导出就必须保持同样几列、同样顺序，而不是一列一列拆成上下两段。 */
  function isBoard() {
    return !!state.board;
  }

  /* ---------- ① 单页网页 ---------- */
  /* 拿到「页面那一段真 DOM」的克隆；拿不到就返回 null（退回按卡片重画的老做法） */
  function domSnapshot() {
    var root = viewRoot();
    if (!root || typeof root.cloneNode !== "function") return null;
    var clone = null;
    try { clone = root.cloneNode(true); } catch (e) { return null; }
    if (!clone || typeof clone.outerHTML !== "string" || !clone.outerHTML) return null;
    sanitizeClone(clone);
    var w = 0;
    try {
      var r = root.getBoundingClientRect ? root.getBoundingClientRect() : null;
      w = r && r.width ? Math.round(r.width) : 0;
    } catch (e) {}
    return { root: root, clone: clone, width: w };
  }

  function finishHtml(html, ctx, stat) {
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    saveBlob(blob, ctx.baseName + ".html");

    var mb = (blob.size / 1048576);
    var sizeTxt = mb >= 1 ? mb.toFixed(1) + "MB" : Math.max(1, Math.round(blob.size / 1024)) + "KB";
    setBusy(false);
    setTip("");
    toast(stat.failed
      ? "网页已生成 " + sizeTxt + "（" + stat.failed + " 张未能抓取，保留原地址）"
      : "网页已生成 " + sizeTxt + "，版式与页面一致，图片已全部内嵌", stat.failed ? undefined : true);
    state._last = { kind: "html", ok: stat.ok, failed: stat.failed, name: ctx.baseName, size: blob.size };
    return state._last;
  }

  /* ---------- ① 单页网页 ---------- */
  function runHtml() {
    var secs = ready();
    if (!secs) return Promise.resolve();

    var snap = domSnapshot();

    setBusy(true, "html");
    setTip(snap ? "正在按页面原样取图…" : "正在取图…");

    var step = function (done, all) { setTip("取图 " + done + " / " + all); };

    if (snap) {
      /* 正路：克隆当前页面 DOM → 图片内嵌 → 带上站点自己的样式表 */
      return inlineDom(snap.clone, step).then(function (stat) {
        var now = new Date();
        var ctx = contextOf(secs, now, stat.total);
        setTip("生成网页…");
        return loadPageCss().then(function (css) {
          var html = buildHtmlDom(snap.clone, {
            title: ctx.title, sub: ctx.sub
          }, stat, css, snap.width);
          if (html) return finishHtml(html, ctx, stat);
          /* 克隆体没法序列化时，退回按卡片重画 */
          var fb = buildHtml(secs, {
            title: ctx.title, sub: ctx.sub,
            failed: stat.failed, ok: stat.ok, columns: isBoard()
          });
          return finishHtml(fb, ctx, stat);
        });
      }).catch(function (e) {
        setBusy(false); setTip("");
        toast("导出失败：" + ((e && e.message) || "未知原因"), false);
      });
    }

    return inlineAll(secs, step).then(function (stat) {
      var now = new Date();
      var ctx = contextOf(secs, now);
      setTip("生成网页…");
      var html = buildHtml(secs, {
        title: ctx.title,
        sub: ctx.sub,
        failed: stat.failed,
        ok: stat.ok,
        columns: isBoard()
      });
      return finishHtml(html, ctx, stat);
    }).catch(function (e) {
      setBusy(false); setTip("");
      toast("导出失败：" + ((e && e.message) || "未知原因"), false);
    });
  }

  /* ---------- ② 高清海报 ---------- */
  function runPoster() {
    var secs = ready();
    if (!secs) return Promise.resolve();

    setBusy(true, "poster");
    setTip("正在取图…");

    return inlineAll(secs, function (done, all) {
      setTip("取图 " + done + " / " + all);
    }).then(function (stat) {
      var now = new Date();
      var ctx = contextOf(secs, now);
      var footer = "来源：前台「" + state.label + "」当前筛选所见 · " +
        (ctx.cat && ctx.cat !== "全部" ? "类目 " + ctx.cat + " · " : "") +
        (ctx.rng ? "期次 " + ctx.rng + " · " : "") +
        "导出于 " + ymdDash(now) + " " + hhmm(now);

      var sheets = isBoard() ? layoutCols(secs) : layout(secs);
      var names = [];

      function step(i) {
        if (i >= sheets.length) {
          setBusy(false); setTip("");
          var tail = sheets.length > 1 ? "（内容较长，已分成 " + sheets.length + " 张，浏览器若拦截多文件下载请选择允许）" : "";
          toast(stat.failed
            ? "海报已生成 " + sheets.length + " 张" + tail + "，其中 " + stat.failed + " 张图未能抓取"
            : "海报已生成 " + sheets.length + " 张" + tail, stat.failed ? undefined : true);
          state._last = { kind: "poster", sheets: sheets.length, ok: stat.ok, failed: stat.failed, names: names };
          return state._last;
        }
        var sh = sheets[i];
        var cards = [];
        if (sh.colMode) {
          sh.cols.forEach(function (col) {
            col.cards.forEach(function (c) { cards.push(c); });
          });
        } else {
          sh.blocks.forEach(function (b) {
            if (b.type === "row") b.cards.forEach(function (c) { cards.push(c); });
          });
        }

        setTip("绘制海报 " + (i + 1) + " / " + sheets.length);
        return loadSheetImages(cards).then(function () {
          var cv = renderSheet(sh, {
            title: ctx.title,
            sub: ctx.sub,
            footer: footer
          });
          if (!cv) throw new Error("海报绘制不可用");
          return canvasBlob(cv, "image/jpeg", 0.94).then(function (blob) {
            var nm = ctx.baseName + "_海报" + (sheets.length > 1 ? "_" + (i + 1) : "") + ".jpg";
            if (blob) { saveBlob(blob, nm); names.push(nm); }
            /* 放开画布与图像引用，避免多张海报叠加吃内存 */
            try { cv.width = 1; cv.height = 1; } catch (e) {}
            cards.forEach(function (c) { c._im = null; });
            return step(i + 1);
          });
        });
      }

      return step(0);
    }).catch(function (e) {
      setBusy(false); setTip("");
      toast("导出失败：" + ((e && e.message) || "未知原因"), false);
    });
  }

  /* ============================================================
   * 六、入口
   * ============================================================ */
  function boot(zoneKey) {
    var key = trim(zoneKey);
    if (!key) return Promise.resolve(false);
    state.zone = key;
    /* 专区名不再写死在 LABELS 里才有救：漏登记新专区时用页面标题兜底，
       否则新开的专区永远拿不到导出按钮（以前就是这个坑）。 */
    state.label = labelOf(key);
    return loadPerm().then(function (ok) {
      state.allowed = !!ok;
      state.booted = true;
      if (ok) showDock(true);
      else scheduleRecheck();
      return ok;
    });
  }

  function labelOf(key) {
    if (LABELS[key]) return LABELS[key];
    var t = trim(String((document.title || "")).split("·")[0]);
    return t || key;
  }

  /* 实测中最常见的一种「看不到按钮」：页面刚打开时登录态还没恢复好，
     权限查询回了空数组，而这一步以前只跑一次、再也不补。这里补两次复查，
     授权到了就把入口显示出来（没有权限时依旧不显示，不放开任何权限）。 */
  var RECHECK_AT = [700, 1800];
  function scheduleRecheck() {
    RECHECK_AT.forEach(function (ms) {
      try {
        setTimeout(function () { recheck(); }, ms);
      } catch (e) {}
    });
  }

  function recheck() {
    if (!state.zone || state.allowed) return Promise.resolve(state.allowed);
    return loadPerm().then(function (ok) {
      if (ok) { state.allowed = true; showDock(true); }
      return !!ok;
    });
  }

  window.VX = {
    BUILD: BUILD,
    boot: boot,
    recheck: recheck,
    runHtml: runHtml,
    runPoster: runPoster,
    available: function () { return state.allowed; },
    _collect: collectSections,   // 自检用
    _build: buildHtml,
    _buildDom: buildHtmlDom,
    _inlineDom: inlineDom,
    _snapshot: domSnapshot,
    _viewRoot: viewRoot,
    _layout: layout,
    _layoutCols: layoutCols,
    _isBoard: isBoard,
    _metrics: metrics,
    _inline: inlineAll,
    _state: function () { return state; }
  };
})();
