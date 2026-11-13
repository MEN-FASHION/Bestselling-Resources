/* ============================================================================
 * view-export.js —— 前台「把当前所见一键带走」（20261113O）
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

  var BUILD = "20261113O";

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
  function collectSections() {
    var secs = [];
    var pools = document.querySelectorAll(".rk-pool");
    if (pools.length) {
      Array.prototype.forEach.call(pools, function (p) {
        var nameEl = p.querySelector(".rk-pool-name > span");
        var metaEl = p.querySelector(".rk-pool-meta");
        var cards = pickCards(p);
        if (!cards.length) return;   // 空列不出现，跟页面一致
        secs.push({
          name: nameEl ? trim(nameEl.textContent) : "",
          meta: cleanMeta(metaEl ? metaEl.textContent : ""),
          cards: cards
        });
      });
    }
    if (!secs.length) {
      var cards = pickCards(document);
      if (cards.length) {
        secs.push({ name: activeCat() || state.label, meta: "", cards: cards });
      }
    }
    return secs;
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
      if (!img) return;
      var url = trim(img.getAttribute("src") || img.getAttribute("data-src"));
      if (!url || seen[url]) return;
      seen[url] = 1;
      out.push(cardOfMv(c, url, img));
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
    return {
      url: url,
      title: trim(img.getAttribute("alt")),
      cat: catEl ? trim(catEl.textContent) : "",
      site: "",
      period: badge ? trim(badge.textContent) : "",
      /* 卡片右下角的「3/13」是打标进度，属于后台编辑信息，不是展示内容，导出时不要 */
      tags: [],
      alt: trim(img.getAttribute("alt"))
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
      "@media(max-width:640px){.grid{grid-template-columns:repeat(2,1fr);gap:10px}.hd,.sec{padding-left:14px;padding-right:14px}}"
    ].join("\n");

    var body = "";
    secs.forEach(function (s) {
      body += '<section class="sec">' +
        "<h2>" + esc(s.name || "未命名分组") + "</h2>" +
        (s.meta ? '<p class="m">' + esc(s.meta) + "</p>" : '<p class="m"></p>') +
        '<div class="grid">';
      s.cards.forEach(function (c) {
        var src = c.data || c.url;
        body += '<figure class="c">' +
          '<div class="ph">' +
          '<img loading="lazy" class="z" src="' + esc(src) + '" data-full="' + esc(src) + '"' +
          ' data-orig="' + esc(c.url) + '" alt="' + esc(c.alt || c.title || s.name || "图片") + '">' +
          (c.data ? "" : '<span class="miss">未内嵌 · 原地址</span>') +
          '<button type="button" class="q" data-orig="' + esc(c.url) + '">⌕ 搜同款</button>' +
          "</div>" +
          "<figcaption>" +
          (c.title ? '<span class="t">' + esc(c.title) + "</span>" : "") +
          (c.tags && c.tags.length ? '<span class="g">' + c.tags.map(function (x) {
            return "<span>" + esc(x) + "</span>";
          }).join("") + "</span>" : "") +
          "</figcaption></figure>";
      });
      body += "</div></section>";
    });

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

    /* 标题：最多两行 */
    var tx = x + 12, tw = cardW - 24;
    g.font = posterFont("400", 15);
    g.fillStyle = "#dfe7f3";
    var lines = wrapLines(g, c.title || c.alt || "", tw, 2);
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

  function contextOf(secs, now) {
    var cat = activeCat();
    var rng = periodRange(secs);
    var total = 0;
    secs.forEach(function (s) { total += s.cards.length; });

    var nameParts = [state.label];
    if (cat && cat !== "全部") nameParts.push(cat);
    if (rng) nameParts.push(rng);
    nameParts.push(ymd(now));

    var title = state.label + (cat && cat !== "全部" ? " · " + cat : "") + (rng ? " · " + rng : "");
    var sub = [
      "来源：前台「" + state.label + "」当前筛选所见",
      "类目：" + (cat || "全部"),
      rng ? "期次：" + rng : "",
      "共 " + total + " 张",
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
    if (!secs.length) { toast("当前页面没有可导出的图片", false); return null; }
    return secs;
  }

  /* ---------- ① 单页网页 ---------- */
  function runHtml() {
    var secs = ready();
    if (!secs) return Promise.resolve();

    setBusy(true, "html");
    setTip("正在取图…");

    return inlineAll(secs, function (done, all) {
      setTip("取图 " + done + " / " + all);
    }).then(function (stat) {
      var now = new Date();
      var ctx = contextOf(secs, now);

      setTip("生成网页…");

      var html = buildHtml(secs, {
        title: ctx.title,
        sub: ctx.sub,
        failed: stat.failed,
        ok: stat.ok
      });

      var blob = new Blob([html], { type: "text/html;charset=utf-8" });
      saveBlob(blob, ctx.baseName + ".html");

      var mb = (blob.size / 1048576);
      var sizeTxt = mb >= 1 ? mb.toFixed(1) + "MB" : Math.max(1, Math.round(blob.size / 1024)) + "KB";
      setBusy(false);
      setTip("");
      toast(stat.failed
        ? "网页已生成 " + sizeTxt + "（" + stat.failed + " 张未能抓取，按原地址显示）"
        : "网页已生成 " + sizeTxt + "，图片已全部内嵌，双击即开", stat.failed ? undefined : true);
      state._last = { kind: "html", ok: stat.ok, failed: stat.failed, name: ctx.baseName, size: blob.size };
      return state._last;
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

      var sheets = layout(secs);
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
        sh.blocks.forEach(function (b) {
          if (b.type === "row") b.cards.forEach(function (c) { cards.push(c); });
        });

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
    if (!key || !LABELS[key]) return Promise.resolve(false);
    state.zone = key;
    state.label = LABELS[key];
    return loadPerm().then(function (ok) {
      state.allowed = !!ok;
      state.booted = true;
      if (ok) showDock(true);
      return ok;
    });
  }

  window.VX = {
    BUILD: BUILD,
    boot: boot,
    runHtml: runHtml,
    runPoster: runPoster,
    available: function () { return state.allowed; },
    _collect: collectSections,   // 自检用
    _build: buildHtml,
    _layout: layout,
    _metrics: metrics,
    _inline: inlineAll,
    _state: function () { return state; }
  };
})();
