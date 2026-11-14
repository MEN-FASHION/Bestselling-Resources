/* ============================================================================
 * page-shot.js —— 前台「导出高清图」（20261114G）
 * ----------------------------------------------------------------------------
 * 就是趋势上升榜里「天眼」旁边那个「导出图片（整页 · 高清）」的同款能力，
 * 现在接到每一个有图的专区：趋势上升榜 / 上新节奏 / 渠道对比 / SHEIN /
 * Pinterest / 品牌动向 / 视觉专区。
 *
 * 做法（与榜单那一个完全一致，所以出来的图才是「页面此刻的样子」）：
 *   ① 从已经渲染好的 DOM 里读出每个元素的位置、底色、边框、圆角；
 *   ② 图片按它在页面上的位置和裁切方式铺回去；
 *   ③ 文字按原位、原字号、原色重排（短标签整段画，宁可缩字号也不丢字）；
 *   ④ 按 2 倍分辨率画成一张 PNG 长图，页面多长图就多长，放大能看清。
 *
 * 口径：页面怎么显示，图就怎么出。选了哪几列、每行几张、天眼开着没开、
 *   列头写着什么、图上压着什么角标，全部照抄 —— 因为读的就是屏幕上那份 DOM，
 *   不是重新查一遍数据。
 *
 * 权限：前台默认谁都看不到按钮。超管始终有；管理员需在后台
 *   「权限管理 → 编辑用户 → 前台导出权限」里被勾上对应专区。
 *
 * 对外：window.PageShot.mount("rank")   —— 页面加载后调一次即可
 *       window.PageShot.run()           —— 直接导一次（调试用）
 *       window.PageShot.recheck()       —— 登录态晚到后重新校对权限
 * ==========================================================================*/
(function () {
  "use strict";

  var BUILD = "20261114H";

  /* 各专区的按钮挂点（工具条）与取景范围（内容区） */
  var ZONES = {
    rank: { label: "趋势上升榜", bar: "#rk-bar", root: "#rk-body" },
    rhythm: { label: "上新节奏", bar: "#rk-bar", root: "#rk-body" },
    compare: { label: "渠道对比", bar: "#cmp-bar", root: "#cmp-body" },
    shein: { label: "SHEIN 专区", bar: "#cz-bar", root: "#cz-body" },
    pinterest: { label: "Pinterest 专区", bar: "#cz-bar", root: "#cz-body" },
    movement: { label: "品牌动向", bar: "#mv-bar", root: "#mv-body" },
    visual: { label: "视觉专区", bar: "#grid-bar", root: "#grid" }
  };

  /* 画布上限：超了浏览器会直接给空白图，所以宁可自动降倍数 */
  var CAP = { scale: 2, minScale: 1, maxPixels: 44e6, maxW: 6000, maxH: 30000 };
  var FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

  var ST = { key: "", cfg: null, allowed: false, btn: null, obs: null, busy: false };

  function $(s, r) { return (r || document).querySelector(s); }
  function trim(s) { return String(s == null ? "" : s).trim(); }

  /* ---------------- 提示 ---------------- */
  function toast(msg, bad) {
    var t = document.getElementById("toast");
    if (!t) { try { console.log("[导出高清图] " + msg); } catch (e) { } return; }
    t.textContent = msg;
    t.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = "toast"; }, 4200);
  }

  /* ---------------- 进度浮层（带取消） ---------------- */
  function hudStart(title) {
    var box = document.createElement("div");
    box.className = "ps-hud";

    var inner = document.createElement("div");
    inner.className = "ps-hud-box";
    var tEl = document.createElement("div");
    tEl.className = "ps-hud-t";
    var barEl = document.createElement("div");
    barEl.className = "ps-hud-bar";
    var iEl = document.createElement("i");
    var mEl = document.createElement("div");
    mEl.className = "ps-hud-msg";
    var xEl = document.createElement("button");
    xEl.type = "button";
    xEl.className = "ps-hud-x";
    xEl.textContent = "取消";

    barEl.appendChild(iEl);
    inner.appendChild(tEl);
    inner.appendChild(barEl);
    inner.appendChild(mEl);
    inner.appendChild(xEl);
    box.appendChild(inner);
    document.body.appendChild(box);

    var job = { cancelled: false, dead: false };
    tEl.textContent = title || "正在生成高清图";
    xEl.onclick = function () { job.cancelled = true; mEl.textContent = "正在取消…"; };
    job.update = function (pct, msg) {
      if (job.dead) return;
      if (typeof pct === "number") iEl.style.width = Math.max(0, Math.min(100, pct)) + "%";
      if (msg) mEl.textContent = msg;
    };
    job.gate = function () {
      return new Promise(function (res) { setTimeout(function () { res(!job.cancelled); }, 0); });
    };
    job.done = function (msg, bad) {
      if (job.dead) return;
      job.dead = true;
      mEl.textContent = msg || "";
      mEl.className = "ps-hud-msg" + (bad ? " bad" : "");
      iEl.style.width = "100%";
      setTimeout(function () { try { document.body.removeChild(box); } catch (e) { } }, bad ? 3600 : 1400);
    };
    return job;
  }

  /* ---------------- 权限 ---------------- */
  function allowedNow() {
    var SB = window.SB;
    if (!SB || typeof SB.myExportZones !== "function") return Promise.resolve(false);
    return Promise.resolve()
      .then(function () { return SB.myExportZones(); })
      .then(function (list) {
        if (!Array.isArray(list)) return false;
        if (list.indexOf("*") >= 0) return true;
        return list.indexOf(ST.key) >= 0;
      })
      .catch(function () { return false; });
  }

  /* ---------------- 画图小工具 ---------------- */
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    if (!r) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapByWidth(ctx, txt, w) {
    var lines = [], cur = "";
    for (var i = 0; i < txt.length; i++) {
      var t = cur + txt.charAt(i);
      if (cur && ctx.measureText(t).width > w) { lines.push(cur); cur = txt.charAt(i); }
      else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function ellipsizeTo(ctx, txt, w) {
    var s = txt;
    while (s.length > 1 && ctx.measureText(s + "…").width > w) s = s.slice(0, -1);
    return s + "…";
  }

  /* 文字：先逐级缩小字号去适配；缩到 55% 仍放不下的短标签整段画出（宁可轻微出框也不丢字），
     长文本才折行并显式加省略号。这是榜单那一版踩过「W42 变成 W4」之后定下来的规矩。 */
  var SHRINK_MIN = 0.55, SHRINK_STEP = 0.05;

  function drawText(ctx, op, S) {
    var txt = String(op.text == null ? "" : op.text);
    if (!txt) return;
    var base = Math.max(1, (op.size || 12) * S);
    var bold = Number(op.weight) >= 600;
    ctx.fillStyle = op.color || "#1a1a1a";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    var x = op.x * S, w = Math.max(1, op.w * S) + S, h = Math.max(1, op.h * S);

    function setFont(sz) { ctx.font = (bold ? "bold " : "") + sz + "px " + FONT; }
    function lineH(sz) { return sz * 1.34; }

    var size = base, lines = null;
    for (var k = 0; k * SHRINK_STEP <= 1 - SHRINK_MIN + 1e-6; k++) {
      var sz = base * (1 - k * SHRINK_STEP);
      setFont(sz);
      var ls = wrapByWidth(ctx, txt, w);
      var allow = op.nowrap ? 1 : Math.max(1, Math.floor(h / lineH(sz)));
      if (ls.length <= allow) { size = sz; lines = ls; break; }
    }
    if (!lines) {
      size = base * SHRINK_MIN;
      setFont(size);
      if (op.nowrap) {
        lines = [txt];
      } else {
        lines = wrapByWidth(ctx, txt, w);
        var cap = Math.max(1, Math.floor(h / lineH(size)));
        if (lines.length > cap) {
          lines = lines.slice(0, cap);
          lines[cap - 1] = ellipsizeTo(ctx, lines[cap - 1], w);
        }
      }
    }
    var lh = lineH(size);
    var top = op.y * S + Math.max(lh / 2, (h - lines.length * lh) / 2 + lh / 2);
    for (var j = 0; j < lines.length; j++) ctx.fillText(lines[j], x, top + j * lh);
  }

  function drawCover(ctx, im, x, y, w, h) {
    var iw = im.naturalWidth || im.width || 0, ih = im.naturalHeight || im.height || 0;
    if (!iw || !ih) return false;
    var s = Math.max(w / iw, h / ih);
    var dw = iw * s, dh = ih * s;
    ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return true;
  }

  function loadImg(url) {
    return new Promise(function (res) {
      var im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = url;
    });
  }

  /* ---------------- 一、取景：把屏幕上的 DOM 读成绘制指令 ---------------- */
  function visible(el) {
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (Number(cs.opacity || 1) <= 0.05) return false;
    return true;
  }
  function skipEl(el) {
    var cls = (el.className && typeof el.className === "string") ? el.className : "";
    /* 浮在页面上、不属于版面内容的东西：搜同款悬浮件、导出浮层、进度条、提示条 */
    if (/(^|\s)(ps-|fs-|vx-|rk-eye|toast)/.test(cls)) return true;
    if (el.id === "toast") return true;
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template" || tag === "svg") return true;
    return false;
  }

  /* 元素在「没被粘住时」应该在的位置（相对取景容器的内容坐标）。
     用法只有一处：.rk-pool-head 这类 position:sticky 的列头。
     页面往下滚时列头会被吸在屏幕顶部，直接按屏幕坐标搬，它就会跑到长图中间去。
     所以对粘性元素改按布局位置算，并把位移量补给它的所有子孙。 */
  function layoutXY(el, root) {
    var x = 0, y = 0, p = el;
    while (p && p !== root) {
      x += p.offsetLeft || 0;
      y += p.offsetTop || 0;
      p = p.offsetParent;
    }
    return p === root ? { x: x, y: y } : null;
  }
  function stickyShift(el, root, baseX, baseY) {
    var dx = 0, dy = 0, p = el;
    while (p && p !== root) {
      var cs = window.getComputedStyle(p);
      if (cs.position === "sticky") {
        var n = layoutXY(p, root);
        if (n) {
          var r = p.getBoundingClientRect();
          dx += n.x - (r.left - baseX);
          dy += n.y - (r.top - baseY);
        }
      }
      p = p.parentElement;
    }
    return (dx || dy) ? { dx: dx, dy: dy } : null;
  }

  function snapshot(root) {
    var r0 = root.getBoundingClientRect();
    var baseX = r0.left - (root.scrollLeft || 0);
    var baseY = r0.top - (root.scrollTop || 0);
    var boxes = [], imgs = [], texts = [];

    function rectOf(el) {
      var r = el.getBoundingClientRect();
      if (!(r.width >= 1) || !(r.height >= 1)) return null;
      var x = r.left - baseX, y = r.top - baseY;
      var sh = stickyShift(el, root, baseX, baseY);
      if (sh) { x += sh.dx; y += sh.dy; }
      return { x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height) };
    }

    Array.prototype.forEach.call(root.querySelectorAll("*"), function (el) {
      if (!visible(el) || skipEl(el)) return;
      var cs = window.getComputedStyle(el);
      /* 固定定位（悬浮件、浮层）不属于版面内容，跳过；
         粘性定位（列头吸顶）不跳过，改按布局位置搬，见 stickyShift */
      if (cs.position === "fixed") return;
      var tag = (el.tagName || "").toLowerCase();
      var rr = rectOf(el);
      if (!rr) return;

      if (tag === "img") {
        var src = el.currentSrc || el.getAttribute("src") || "";
        if (src) imgs.push({
          k: "img", x: rr.x, y: rr.y, w: rr.w, h: rr.h, url: src,
          radius: parseFloat(cs.borderTopLeftRadius) || 0
        });
        return;
      }

      var bg = cs.backgroundColor || "";
      var lw = parseFloat(cs.borderTopWidth) || 0;
      var hasBg = bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)";
      if (hasBg || lw > 0) {
        boxes.push({
          k: "box", x: rr.x, y: rr.y, w: rr.w, h: rr.h,
          fill: hasBg ? bg : "", stroke: lw > 0 ? cs.borderTopColor : "", lw: lw,
          radius: parseFloat(cs.borderTopLeftRadius) || 0
        });
      }
      /* 只画叶子节点的文字，避免父节点把同一句重复画一遍 */
      var txt = trim(el.textContent);
      if (txt && (!el.children || !el.children.length)) {
        var fs = parseFloat(cs.fontSize) || 12;
        var lh = parseFloat(cs.lineHeight) || fs * 1.4;
        var oneLine = rr.h <= lh * 1.6;
        texts.push({
          k: "text", x: rr.x, y: rr.y, w: rr.w, h: rr.h, text: txt,
          size: fs, weight: cs.fontWeight, color: cs.color,
          nowrap: oneLine && txt.length <= 16
        });
      }
    });

    return {
      root: {
        w: Math.round(root.scrollWidth || Math.max(1, r0.width)),
        h: Math.round(root.scrollHeight || Math.max(1, r0.height))
      },
      ops: boxes.concat(imgs, texts)
    };
  }

  /* 懒加载的图在屏幕外可能还没下载，先催一遍再画，否则图上是一片空白框 */
  function warmImages(root) {
    var list = [];
    Array.prototype.forEach.call(root.querySelectorAll("img"), function (im) {
      try { if (im.getAttribute("loading") === "lazy") im.setAttribute("loading", "eager"); } catch (e) { }
      if (!im.complete || !im.naturalWidth) list.push(im);
    });
    if (!list.length) return Promise.resolve(0);
    return new Promise(function (res) {
      var left = list.length, done = false;
      var t = setTimeout(function () { if (!done) { done = true; res(left); } }, 9000);
      function one() {
        left--;
        if (left <= 0 && !done) { done = true; clearTimeout(t); res(0); }
      }
      list.forEach(function (im) {
        im.addEventListener("load", one, { once: true });
        im.addEventListener("error", one, { once: true });
      });
    });
  }

  /* ---------------- 二、出图 ---------------- */
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
  }
  function safeName(s) {
    return String(s == null ? "" : s).replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").replace(/_+/g, "_").slice(0, 120);
  }
  function scopeText() {
    /* 工具条上那行「共 N 张 · 3 列 · 第43周」就是最好的范围说明，直接照抄进文件名 */
    var bar = ST.cfg && ST.cfg.bar ? $(ST.cfg.bar) : null;
    if (bar) {
      var inf = bar.querySelector(".rk-bar-info");
      if (inf) {
        var t = trim(inf.textContent);
        if (t) return t.replace(/\s+/g, " ").slice(0, 60);
      }
    }
    var sum = $("#rk-summary") || $("#cz-summary") || $("#cmp-summary");
    return sum ? trim(sum.textContent) : "";
  }

  function pickRoot() {
    var cfg = ST.cfg || {};
    var root = cfg.root ? $(cfg.root) : null;
    if (root && root.getBoundingClientRect().height >= 40) return root;
    var alt = $("main.grid-wrap");
    return alt || root || null;
  }

  function run() {
    if (ST.busy) return Promise.resolve(false);
    var cfg = ST.cfg || {};
    var root = pickRoot();
    if (!root) { toast("当前页面没有可导出的内容", true); return Promise.resolve(false); }

    return allowedNow().then(function (ok) {
      if (!ok) { toast("你没有这个专区的导出权限，请联系超级管理员开通", true); return false; }
      ST.busy = true;
      if (ST.btn) { ST.btn.disabled = true; ST.btn.textContent = "◌ 绘制中…"; }
      var job = hudStart("正在生成整页高清图");
      function restore() {
        ST.busy = false;
        if (ST.btn) { ST.btn.disabled = false; ST.btn.textContent = "⤓ 导出高清图"; }
      }
      function fail(msg) { job.done(msg, true); restore(); return false; }

      job.update(3, "正在读取页面版式…");
      return warmImages(root).then(function () {
        var snap = snapshot(root);
        if (!snap || !snap.ops.length || !(snap.root.w > 0) || !(snap.root.h > 0)) {
          return fail("当前筛选下没有可导出的内容");
        }
        /* 倍数自适应：页面很长时自动降倍数，避免画布超限被浏览器拒绝 */
        var S = CAP.scale;
        while (S > CAP.minScale && (
          snap.root.w * S > CAP.maxW ||
          snap.root.h * S > CAP.maxH ||
          snap.root.w * snap.root.h * S * S > CAP.maxPixels)) S -= 0.25;
        var W = Math.max(1, Math.round(snap.root.w * S));
        var H = Math.max(1, Math.round(snap.root.h * S));

        var cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        var ctx = cv.getContext && cv.getContext("2d");
        if (!ctx) return fail("当前浏览器不支持画布导出，请换电脑浏览器再试");

        var boxes = snap.ops.filter(function (o) { return o.k === "box"; });
        var imgs = snap.ops.filter(function (o) { return o.k === "img" && /^(https?:|data:)/i.test(o.url || ""); });
        var texts = snap.ops.filter(function (o) { return o.k === "text"; });
        var miss = 0, drawn = 0;

        return (async function () {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, W, H);

          for (var i = 0; i < boxes.length; i++) {
            if (i % 24 === 0 && !(await job.gate())) return "cancel";
            var b = boxes[i];
            ctx.beginPath();
            roundRect(ctx, b.x * S, b.y * S, b.w * S, b.h * S, (b.radius || 0) * S);
            if (b.fill) { ctx.fillStyle = b.fill; ctx.fill(); }
            if (b.stroke && b.lw > 0) {
              ctx.lineWidth = Math.max(1, b.lw * S);
              ctx.strokeStyle = b.stroke;
              ctx.stroke();
            }
            if (i % 12 === 0) job.update(4 + Math.round((i + 1) / Math.max(1, boxes.length) * 24), "正在铺版面 " + (i + 1) + " / " + boxes.length);
          }

          for (var j = 0; j < imgs.length; j++) {
            if (!(await job.gate())) return "cancel";
            var o = imgs[j], im = await loadImg(o.url);
            ctx.save();
            ctx.beginPath();
            roundRect(ctx, o.x * S, o.y * S, o.w * S, o.h * S, (o.radius || 0) * S);
            ctx.clip();
            var ok2 = im ? drawCover(ctx, im, o.x * S, o.y * S, o.w * S, o.h * S) : false;
            if (!ok2) {
              miss++;
              ctx.fillStyle = "#f1ede6";
              ctx.fillRect(o.x * S, o.y * S, o.w * S, o.h * S);
              ctx.font = Math.max(12, Math.min(o.w, o.h) * S * 0.12) + "px " + FONT;
              ctx.fillStyle = "#9a938a";
              ctx.textBaseline = "middle";
              ctx.textAlign = "center";
              try { ctx.fillText("取不到图", (o.x + o.w / 2) * S, (o.y + o.h / 2) * S); } catch (e) { }
            } else drawn++;
            ctx.restore();
            if (j % 5 === 0 || j === imgs.length - 1) {
              job.update(28 + Math.round((j + 1) / Math.max(1, imgs.length) * 56), "正在贴图 " + (j + 1) + " / " + imgs.length);
            }
          }

          for (var k = 0; k < texts.length; k++) {
            if (k % 40 === 0 && !(await job.gate())) return "cancel";
            drawText(ctx, texts[k], S);
            if (k % 20 === 0 || k === texts.length - 1) {
              job.update(84 + Math.round((k + 1) / Math.max(1, texts.length) * 12), "正在写文字 " + (k + 1) + " / " + texts.length);
            }
          }

          if (!(await job.gate())) return "cancel";
          job.update(97, "正在生成图片文件…");

          var scope = scopeText();
          var name = safeName((cfg.label || "前台") + "_整页高清_" + (scope ? scope + "_" : "") + stamp()) + ".png";
          var out = await new Promise(function (res) {
            if (typeof cv.toBlob === "function") {
              try { cv.toBlob(function (b) { res(b || null); }, "image/png"); return; } catch (e) { }
            }
            try { res({ dataUrl: cv.toDataURL("image/png") }); } catch (e) { res(null); }
          });
          if (!out) return fail("生成图片失败，请缩小范围后重试");

          if (out.dataUrl) {
            var a0 = document.createElement("a");
            a0.href = out.dataUrl; a0.download = name;
            document.body.appendChild(a0); a0.click();
            setTimeout(function () { try { document.body.removeChild(a0); } catch (e) { } }, 1500);
          } else {
            var url = URL.createObjectURL(out);
            var a = document.createElement("a");
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click();
            setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) { } }, 2500);
          }

          var extra = ["整页 " + W + " × " + H + " 像素（可放大查看）", "含图 " + drawn + " 张"];
          if (miss) extra.push(miss + " 张取不到像素，已留白标注");
          job.done(name + "：" + extra.join("；"));
          restore();
          return true;
        })().then(function (r) {
          if (r === "cancel") {
            job.done("已取消导出（未生成任何文件）", true);
            restore();
            return false;
          }
          return r;
        }, function () {
          job.done("导出失败，请重试", true);
          restore();
          return false;
        });
      });
    });
  }

  /* ---------------- 三、按钮挂载 ---------------- */
  function makeBtn() {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ps-btn";
    b.id = "ps-btn-" + ST.key;
    b.textContent = "⤓ 导出高清图";
    b.title = "把当前页面此刻的样子定格成一张高清长图（列、卡片、角标都在原位，2 倍分辨率可放大）";
    b.onclick = function () { run(); };
    return b;
  }

  /* 按钮放进工具条；工具条每次重绘都会被清空，所以挂一个观察者，重绘后再放回去。
     榜单 / 上新节奏那一行里「天眼」用 margin-left:auto 顶到右边，我们接在它后面即可。 */
  function placeButton() {
    var cfg = ST.cfg;
    if (!cfg) return;
    var b = ST.btn || makeBtn();
    ST.btn = b;
    var bar = cfg.bar ? $(cfg.bar) : null;
    if (bar) {
      if (isChild(bar, b)) return;
      var eye = bar.querySelector("#rk-eye-btn");
      if (eye) {
        if (eye.nextSibling) bar.insertBefore(b, eye.nextSibling);
        else bar.appendChild(b);
      } else {
        bar.appendChild(b);
      }
      /* 趋势上升榜原本就有一个同功能的「导出图片（整页 · 高清）」（只给超管）。
         我们这个按钮已经取代它，且多了「按专区授权」，所以把它收起来，避免一排两个一样的按钮。 */
      var legacy = bar.querySelector("#rk-exp-img");
      if (legacy) { try { legacy.style.display = "none"; } catch (e) { } }
      watchBar(bar);
    }
  }

  /* 节点是否还是这个父节点的直接子节点：工具条 innerHTML 被清空后，
     旧节点的 parentNode 仍指向工具条，只用 parentNode 判断会误以为它还在 */
  function isChild(parent, child) {
    if (!parent || !child || child.parentNode !== parent) return false;
    var kids = parent.children || [];
    return Array.prototype.indexOf.call(kids, child) >= 0;
  }

  function watchBar(bar) {
    if (ST.obs) { try { ST.obs.disconnect(); } catch (e) { } }
    if (typeof MutationObserver !== "function") return;
    var mo = new MutationObserver(function () {
      if (!ST.allowed) return;
      var b = ST.btn;
      if (!b) return;
      if (!isChild(bar, b)) placeButton();
    });
    mo.observe(bar, { childList: true });
    ST.obs = mo;
  }

  function mount(arg) {
    var cfg = typeof arg === "string" ? ZONES[arg] : arg;
    if (!cfg) return;
    ST.key = (typeof arg === "string") ? arg : (cfg.key || cfg.label || "");
    if (!cfg.key) cfg.key = ST.key;
    ST.cfg = cfg;
    allowedNow().then(function (ok) {
      ST.allowed = !!ok;
      if (!ok) return;
      placeButton();
    });
  }

  window.PageShot = {
    BUILD: BUILD,
    ZONES: ZONES,
    mount: mount,
    run: run,
    /* 图渲染完 / 登录态晚到后，页面可以再喊一次，避免「明明授权了却看不到按钮」 */
    recheck: function () {
      if (!ST.cfg) return;
      var key = ST.key;
      ST.key = key;
      allowedNow().then(function (ok) {
        ST.allowed = !!ok;
        if (ok) placeButton();
        else if (ST.btn && ST.btn.parentNode) { try { ST.btn.parentNode.removeChild(ST.btn); } catch (e) { } }
      });
    }
  };
})();
