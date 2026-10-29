/* ============================================================================
 * 收藏周报 · 整张高清导出（20261027F）
 *
 * 用途：把「我的收藏」里的图，按 期次 → 类目 → 上装/下装 → 元素标签 排成一张
 *       长图（PNG），一次导出，不用一张张存。
 *
 * 分成两半，互不依赖：
 *   ① plan()   —— 纯函数，只做分组与版面计算，不碰 DOM / canvas（可单测）
 *   ② render() —— 按 plan 给出的坐标往 canvas 上画，再 toBlob 下载
 *
 * 关键取舍：
 *   · 自己算坐标而不是拿 html2canvas 抓 DOM：导出的图不该受浏览器宽度、
 *     抽屉开合、滚动位置影响；自己算才能保证同一份收藏每次都出同样一张图。
 *   · 图片一律 crossOrigin="anonymous" 取；取不到（对方不给跨域头）就画占位块
 *     并计数，最后如实告诉用户"有 N 张没能取到"，而不是给一张骗人的图。
 *   · 输出 2 倍尺寸（默认 1600×2 = 3200px 宽），长图缩放后仍清晰。
 * ========================================================================== */
(function () {
  "use strict";

  var NS = {};
  var CANCEL = { v: false };

  /* ---------------------------------------------------------------- 版面常量 */
  var LW = 1600;                 /* 逻辑宽度，最终乘 SCALE 输出 */
  var PAD = 56;                  /* 左右内边距 */
  var GAP = 18;                  /* 卡片间距 */
  var COLS = 6;                  /* 每行 6 张 */
  var HEAD_H = 208;              /* 页头高度 */
  var WEEK_H = 66;               /* 期次标题条 */
  var CAT_H = 54;                /* 类目标题条 */
  var SUB_H = 38;                /* 上装/下装行头 */
  var TITLE_H = 44;              /* 卡片下方的标题 + 元素标签 */
  var FOOT_H = 96;               /* 页脚 */
  var BLOCK_GAP = 26;            /* 类目块之间 */
  var SUB_GAP = 14;              /* 行之间 */

  var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';
  var C = {
    bg: "#f6f2ea",
    panel: "#ffffff",
    ink: "#2b2620",
    ink2: "#6a5f50",
    ink3: "#9a8e7c",
    gold: "#b08948",
    line: "#e6ddcd",
    ph: "#ddd5c6",
  };

  /* ---------------------------------------------------------------- 小工具 */
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function str(v) { return v == null ? "" : String(v); }
  function esc(s) { return str(s); }

  /* 期次排序：W42 / 2026-09 这类都能比，取不到数字的排最后 */
  function periodKey(p) {
    var m = str(p).match(/(\d{4})\s*[-/]?\s*W?(\d{1,2})/);
    if (m) return Number(m[1]) * 100 + Number(m[2]);
    var m2 = str(p).match(/(\d{1,3})/);
    return m2 ? Number(m2[1]) : -1;
  }

  function subOf(it) {
    var v = it && it.sub_cat;
    return (v === "top" || v === "bottom") ? v : null;
  }

  /* ---------------------------------------------------------------- ① 分组 */
  /* 返回：{ weeks: [{ period, total, cats: [{ name,color,count, subs:[{key,name,count,items}] }], others }], totals } */
  function plan(items, cats) {
    var list = (items || []).slice();
    var catOrder = [], catMap = {};
    (cats || []).forEach(function (c, i) {
      var id = Number(c.id);
      catOrder.push(id);
      catMap[id] = { id: id, name: str(c.name) || "未命名分类", color: str(c.color) || "#8b7355", ord: i };
    });

    /* 按周聚合，周内再按类目、再按上装/下装 */
    var weeks = [], wIdx = {};
    list.forEach(function (it) {
      var p = str(it.period_label || "未标注期次");
      if (!wIdx[p]) { wIdx[p] = { period: p, items: [] }; weeks.push(wIdx[p]); }
      wIdx[p].items.push(it);
    });

    var totals = { weeks: weeks.length, cats: 0, items: 0, top: 0, bottom: 0, none: 0 };

    var out = weeks.map(function (w) {
      var byCat = {}, others = [];
      w.items.forEach(function (it) {
        var cid = it.category_id == null ? null : Number(it.category_id);
        if (cid != null && catMap[cid]) (byCat[cid] = byCat[cid] || []).push(it);
        else others.push(it);
      });

      var catList = catOrder.filter(function (cid) { return byCat[cid] && byCat[cid].length; })
        .map(function (cid) {
          var meta = catMap[cid];
          var arr = byCat[cid];
          var bucket = { top: [], bottom: [], none: [] };
          arr.forEach(function (it) {
            var v = subOf(it);
            bucket[v === "top" ? "top" : (v === "bottom" ? "bottom" : "none")].push(it);
          });
          var subs = [
            { key: "top", name: "上装", items: bucket.top },
            { key: "bottom", name: "下装", items: bucket.bottom },
            { key: "none", name: "未分", items: bucket.none }
          ].filter(function (s) { return s.items.length; })
            .map(function (s) { return { key: s.key, name: s.name, count: s.items.length, items: s.items }; });
          return { cid: cid, name: meta.name, color: meta.color, count: arr.length, subs: subs };
        });

      /* 未分类（含分类已删的脏数据）：单独一块，不算进"类目数" */
      var othersBlock = null;
      if (others.length) {
        var ob = { top: [], bottom: [], none: [] };
        others.forEach(function (it) {
          var v = subOf(it);
          ob[v === "top" ? "top" : (v === "bottom" ? "bottom" : "none")].push(it);
        });
        othersBlock = {
          cid: null, name: "未分类", color: "", count: others.length,
          subs: [
            { key: "top", name: "上装", items: ob.top },
            { key: "bottom", name: "下装", items: ob.bottom },
            { key: "none", name: "未分", items: ob.none }
          ].filter(function (s) { return s.items.length; })
            .map(function (s) { return { key: s.key, name: s.name, count: s.items.length, items: s.items }; })
        };
      }

      var weekTop = 0, weekBottom = 0, weekNone = 0;
      w.items.forEach(function (it) {
        var v = subOf(it);
        if (v === "top") weekTop++; else if (v === "bottom") weekBottom++; else weekNone++;
      });

      totals.items += w.items.length;
      totals.top += weekTop; totals.bottom += weekBottom; totals.none += weekNone;
      if (catList.length) totals.cats = Math.max(totals.cats, catList.length);

      return {
        period: w.period,
        total: w.items.length,
        top: weekTop, bottom: weekBottom, none: weekNone,
        cats: catList,
        others: othersBlock,
      };
    });

    /* 期次从新到旧（用户看收藏通常是看最近的） */
    out.sort(function (a, b) { return periodKey(b.period) - periodKey(a.period); });
    return { weeks: out, totals: totals, cats: (cats || []).length };
  }

  /* ---------------------------------------------------------------- ② 版面 */
  /* 只算坐标，不画。返回 { width, height, cards:[{x,y,w,h,item,sub,cat,week}], 结构块坐标 } */
  function layout(p, opts) {
    opts = opts || {};
    var cols = num(opts.cols) || COLS;
    var cw = Math.floor((LW - PAD * 2 - GAP * (cols - 1)) / cols);
    var ch = Math.round(cw * 1.3);        /* 图片区高度：竖构图为主 */
    var cellH = ch + TITLE_H;
    var blocks = [];
    var cards = [];
    var y = HEAD_H;

    (p.weeks || []).forEach(function (w) {
      var weekY = y;
      y += WEEK_H;
      w.cats.concat(w.others ? [w.others] : []).forEach(function (c) {
        var catY = y;
        y += CAT_H;
        c.subs.forEach(function (s) {
          var subY = y;
          y += SUB_H;
          var n = s.items.length;
          var rows = Math.ceil(n / cols);
          s.items.forEach(function (it, i) {
            var r = Math.floor(i / cols), col = i % cols;
            cards.push({
              x: PAD + col * (cw + GAP),
              y: y + r * (cellH + GAP),
              w: cw, h: ch, cellH: cellH,
              item: it, sub: s.key, subName: s.name,
              cat: c.name, catColor: c.color, week: w.period,
            });
          });
          if (n) y += rows * (cellH + GAP);
          blocks.push({ kind: "sub", week: w.period, cat: c.name, sub: s.key, name: s.name, count: n, y: subY, h: y - subY });
        });
        y += BLOCK_GAP;
        blocks.push({ kind: "cat", week: w.period, cat: c.name, color: c.color, count: c.count, y: catY, h: y - catY - BLOCK_GAP });
      });
      blocks.push({ kind: "week", week: w.period, count: w.total, y: weekY, h: WEEK_H });
    });

    return {
      width: LW,
      height: Math.max(y + FOOT_H, HEAD_H + FOOT_H),
      cardW: cw, cardH: ch, cellH: cellH, cols: cols,
      cards: cards, blocks: blocks, pad: PAD,
    };
  }

  /* ---------------------------------------------------------------- ③ 绘制 */
  function rr(ctx, x, y, w, h, r) {
    var rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function clipText(ctx, text, maxW) {
    var t = str(text);
    if (ctx.measureText(t).width <= maxW) return t;
    var lo = 0, hi = t.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(t.slice(0, mid) + "…").width <= maxW) lo = mid; else hi = mid - 1;
    }
    return t.slice(0, lo) + "…";
  }

  /* 载入一张图；失败返回 null（不抛错，避免一张坏图废掉整张长图） */
  function loadImg(url, timeout) {
    return new Promise(function (resolve) {
      if (!url) return resolve(null);
      var img = new Image();
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, timeout || 9000);
      img.crossOrigin = "anonymous";
      img.onload = function () { if (done) return; done = true; clearTimeout(t); resolve(img); };
      img.onerror = function () { if (done) return; done = true; clearTimeout(t); resolve(null); };
      img.src = url;
    });
  }

  /* 按 cover 方式把图铺进矩形（不拉伸变形，多余部分居中裁掉） */
  function drawCover(ctx, img, x, y, w, h) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    var scale = Math.max(w / iw, h / ih);
    var dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function fmtDate(d) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
      + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* 真正的导出：onProgress(loaded,total) */
  async function exportPng(items, cats, opts) {
    opts = opts || {};
    var p = plan(items, cats);
    if (!p.totals.items) throw new Error("没有收藏内容，先把图拖进收藏再导出。");

    var box = layout(p, opts);
    var scale = num(opts.scale) || 2;
    var cv = document.createElement("canvas");
    cv.width = Math.round(box.width * scale);
    cv.height = Math.round(box.height * scale);
    var ctx = cv.getContext("2d");
    ctx.scale(scale, scale);

    /* 底色 */
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, box.width, box.height);

    /* ---- 页头 ---- */
    var x0 = PAD;
    ctx.fillStyle = C.ink;
    ctx.font = "700 30px " + FONT;
    ctx.textBaseline = "alphabetic";
    ctx.fillText("我的收藏 · 周报趋势", x0, 84);

    ctx.font = "400 16px " + FONT;
    ctx.fillStyle = C.ink2;
    var rangeTxt = p.weeks.length
      ? p.weeks.map(function (w) { return w.period; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 6).join(" · ")
      : "";
    ctx.fillText("期次：" + (rangeTxt || "—") + "　　导出：" + fmtDate(opts.now || new Date()), x0, 118);

    /* 统计胶囊 */
    var stats = [
      p.totals.weeks + " 个期次",
      p.totals.cats + " 个类目",
      p.totals.items + " 张图",
      "上装 " + p.totals.top,
      "下装 " + p.totals.bottom,
      "未分 " + p.totals.none,
    ];
    ctx.font = "600 15px " + FONT;
    var sx = x0;
    stats.forEach(function (s) {
      var w = ctx.measureText(s).width + 30;
      ctx.fillStyle = "#efe7d8";
      rr(ctx, sx, 138, w, 36, 18); ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.fillText(s, sx + 15, 162);
      sx += w + 10;
    });
    ctx.fillStyle = C.line;
    ctx.fillRect(x0, HEAD_H - 26, box.width - PAD * 2, 1);

    /* ---- 期内结构 ---- */
    var byWeek = {};
    box.blocks.forEach(function (b) { (byWeek[b.week] = byWeek[b.week] || []).push(b); });
    var weekMeta = {};
    p.weeks.forEach(function (w) { weekMeta[w.period] = w; });

    Object.keys(byWeek).forEach(function (wk) {
      var bl = byWeek[wk];
      bl.forEach(function (b) {
        if (b.kind === "week") {
          var wm = weekMeta[wk] || {};
          ctx.fillStyle = C.ink;
          ctx.font = "700 24px " + FONT;
          ctx.fillText(wk, PAD, b.y + 40);
          ctx.font = "600 15px " + FONT;
          ctx.fillStyle = C.ink2;
          var right = wm.total + " 张 · 上装 " + num(wm.top) + " · 下装 " + num(wm.bottom) + " · 未分 " + num(wm.none);
          ctx.textAlign = "right";
          ctx.fillText(right, box.width - PAD, b.y + 38);
          ctx.textAlign = "left";
          ctx.fillStyle = C.line;
          ctx.fillRect(PAD, b.y + 52, box.width - PAD * 2, 1);
        } else if (b.kind === "cat") {
          var dotX = PAD + 6;
          ctx.beginPath();
          ctx.arc(dotX, b.y + 24, 6, 0, Math.PI * 2);
          ctx.fillStyle = b.color || "#b9ac96";
          ctx.fill();
          ctx.font = "700 19px " + FONT;
          ctx.fillStyle = C.ink;
          ctx.fillText(b.cat, PAD + 22, b.y + 31);
          var nm = b.cat;
          var tw = ctx.measureText(nm).width;
          ctx.font = "600 14px " + FONT;
          ctx.fillStyle = C.ink3;
          ctx.fillText(b.count + " 张", PAD + 22 + tw + 12, b.y + 30);
        } else if (b.kind === "sub") {
          if (b.name === "未分" && b.count === 0) return;
          ctx.font = "700 14px " + FONT;
          ctx.fillStyle = b.sub === "top" ? "#96702a" : (b.sub === "bottom" ? "#7b736a" : C.ink3);
          ctx.fillText(b.name, PAD + 22, b.y + 24);
          var nw = ctx.measureText(b.name).width;
          ctx.font = "600 12.5px " + FONT;
          ctx.fillStyle = C.ink3;
          ctx.fillText(b.count + " 张", PAD + 22 + nw + 8, b.y + 24);
        }
      });
    });

    /* ---- 卡片（先画框架，图后填） ---- */
    var total = box.cards.length;
    var loaded = 0, failed = 0;
    ctx.textBaseline = "alphabetic";
    box.cards.forEach(function (c) {
      ctx.fillStyle = C.panel;
      rr(ctx, c.x, c.y, c.w, c.h + TITLE_H - 8, 12); ctx.fill();
      ctx.fillStyle = C.ph;
      rr(ctx, c.x, c.y, c.w, c.h, 12); ctx.fill();
    });

    /* ---- 并行取图：限制 6 路，避免一口气几百个请求把浏览器打满 ---- */
    var queue = box.cards.slice();
    var CONC = 6;
    async function worker() {
      while (queue.length) {
        if (CANCEL.v) return;
        var c = queue.shift();
        var img = await loadImg(c.item && c.item.image_url, opts.imgTimeout);
        if (img) drawCover(ctx, img, c.x, c.y, c.w, c.h);
        else {
          failed++;
          ctx.fillStyle = C.ink3;
          ctx.font = "600 12px " + FONT;
          ctx.textAlign = "center";
          ctx.fillText("图片未能载入", c.x + c.w / 2, c.y + c.h / 2);
          ctx.textAlign = "left";
        }
        loaded++;
        if (opts.onProgress) { try { opts.onProgress(loaded, total); } catch (e) { } }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONC, total) }, worker));

    /* 图片圆角收边：用一层描边把直角压掉（canvas 没有 clip 圆角绘图的廉价写法） */
    box.cards.forEach(function (c) {
      ctx.save();
      rr(ctx, c.x, c.y, c.w, c.h, 12);
      ctx.clip();
      ctx.restore();
      ctx.strokeStyle = "rgba(0,0,0,.06)";
      ctx.lineWidth = 1;
      rr(ctx, c.x + .5, c.y + .5, c.w - 1, c.h - 1, 12);
      ctx.stroke();
    });

    /* ---- 标题与元素标签 ---- */
    box.cards.forEach(function (c) {
      var it = c.item || {};
      var tx = c.x + 2, ty = c.y + c.h + 18;
      ctx.font = "600 13.5px " + FONT;
      ctx.fillStyle = C.ink;
      var title = str(it.title || it.leaf_category || "未命名");
      ctx.fillText(clipText(ctx, title, c.w - 4), tx, ty);

      /* 元素标签：最多两枚，超出用 +N */
      var tags = Array.isArray(it.tags) ? it.tags.filter(function (x) { return str(x).trim(); }) : [];
      var chipY = c.y + c.h + 26;
      var chipX = tx;
      var shown = tags.slice(0, 2);
      ctx.font = "600 11px " + FONT;
      shown.forEach(function (t) {
        var label = str(t);
        var w = Math.min(ctx.measureText(label).width + 14, c.w - 4);
        ctx.fillStyle = "rgba(176,137,72,.14)";
        rr(ctx, chipX, chipY, w, 18, 9); ctx.fill();
        ctx.fillStyle = "#8b6b28";
        ctx.fillText(clipText(ctx, label, w - 12), chipX + 7, chipY + 13);
        chipX += w + 5;
      });
      if (tags.length > 2 && chipX + 26 < c.x + c.w) {
        ctx.fillStyle = C.ink3;
        ctx.font = "600 11px " + FONT;
        ctx.fillText("+" + (tags.length - 2), chipX + 2, chipY + 13);
      }

      /* 位次：有就标在图片左上角 */
      var rk = (it.rank_pos != null && it.rank_pos !== "") ? it.rank_pos : it.rank_abs;
      if (rk != null && rk !== "") {
        ctx.font = "700 11px " + FONT;
        var lb = "#" + rk;
        var lw = ctx.measureText(lb).width + 14;
        ctx.fillStyle = "rgba(30,26,20,.72)";
        rr(ctx, c.x + 8, c.y + 8, lw, 20, 10); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(lb, c.x + 15, c.y + 22);
      }
    });

    /* ---- 页脚 ---- */
    var fy = box.height - 56;
    ctx.fillStyle = C.line;
    ctx.fillRect(PAD, fy - 26, box.width - PAD * 2, 1);
    ctx.font = "400 13px " + FONT;
    ctx.fillStyle = C.ink3;
    ctx.fillText("由我的收藏生成 · 共 " + total + " 张图 · 按 期次 / 类目 / 上装下装 / 元素 归集", PAD, fy);
    ctx.textAlign = "right";
    ctx.fillText("TREND BANK", box.width - PAD, fy);
    ctx.textAlign = "left";

    /* ---- 出图 ---- */
    var blob = await new Promise(function (resolve, reject) {
      try {
        if (cv.toBlob) cv.toBlob(function (b) { b ? resolve(b) : reject(new Error("toBlob 返回空")); }, "image/png");
        else resolve(null);
      } catch (e) { reject(e); }
    });

    return {
      blob: blob,
      width: cv.width, height: cv.height,
      count: total, failed: failed,
      periods: p.weeks.length, cats: p.totals.cats,
      canvas: cv,
      blocks: box.blocks,          /* 分页要用块边界，避免把卡片切两半 */
      scale: scale,
    };
  }

  /* ============================================================================
   * ⑧ 收藏周报 → PDF → 趋势专区（20261030F）
   * ----------------------------------------------------------------------------
   * 20261030F 是按 A4 横版切成多页，读起来一页一断开，很碎。
   * 现在改成**一张连续长页**：页宽固定 297mm，页高按内容等比延伸，
   * 整份报告就是一条不断开的竖长页，滚动阅读。
   *
   * 两个必要的处理：
   *   · PDF 单页高度有上限（规范 14400pt ≈ 5080mm），超过才被迫分页；
   *   · 长图先在内存里分段转 JPEG 再逐段贴上，避免一次转出超大图片把内存撑爆。
   *
   * 这里只负责产出文件与元信息（标题 / 标签 / 简介），不碰上传 ——
   * 上传和登记放在页面脚本里，导出模块保持无网络依赖。
   * ==========================================================================*/
  var PDF_W_MM = 297, PDF_H_MM = 210;
  var LONG_W_MM = 297;        /* 长页宽度 = A4 宽 */
  var LONG_MAX_H_MM = 4800;   /* 单页高度上限，留足余量；超过才分页 */
  var LONG_CHUNK_PX = 6000;   /* 每段贴图的最大像素高度，控制内存峰值 */

  async function loadJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return true;
    if (!window.__jsPdfLoading) {
      window.__jsPdfLoading = new Promise(function (resolve) {
        var s = document.createElement("script");
        var v = (function () {
          try {
            var t = document.querySelector('script[src*="js/favexport.js"]');
            var m = t && String(t.getAttribute("src") || "").match(/[?&]v=([^&]+)/);
            return m ? m[1] : "";
          } catch (e) { return ""; }
        })();
        s.src = "vendor/jspdf.umd.min.js" + (v ? "?v=" + v : "");
        s.onload = function () { resolve(!!(window.jspdf && window.jspdf.jsPDF)); };
        s.onerror = function () { resolve(false); };
        document.head.appendChild(s);
      });
    }
    try { await window.__jsPdfLoading; } catch (e) { /* 落到判定 */ }
    return !!(window.jspdf && window.jspdf.jsPDF);
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* 封面：与长图页头同一套配色，单独成页，同时用作趋势专区的卡片图 */
  function buildCover(p, now) {
    var W = 1600, H = Math.round(1600 * PDF_H_MM / PDF_W_MM);
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var c = cv.getContext("2d");
    var t = p.totals;

    c.fillStyle = C.bg; c.fillRect(0, 0, W, H);
    c.fillStyle = C.gold; c.fillRect(0, 0, W, 10);
    c.fillStyle = "rgba(176,137,72,.10)"; c.fillRect(W * 0.66, 0, W * 0.34, H);

    c.fillStyle = C.gold;
    c.font = "600 24px " + FONT;
    c.fillText("TREND BANK · 我的收藏", 96, 132);

    c.fillStyle = C.ink;
    c.font = "700 88px " + FONT;
    c.fillText("收藏趋势周报", 96, 274);

    var range = (p.weeks || []).map(function (w) { return w.period; })
      .filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    var rangeTxt = range.slice(0, 5).join("　·　") + (range.length > 5 ? "　等 " + range.length + " 个期次" : "");
    c.fillStyle = C.ink2;
    c.font = "400 34px " + FONT;
    c.fillText(rangeTxt || "全部期次", 96, 342);

    c.fillStyle = C.ink3;
    c.font = "400 24px " + FONT;
    c.fillText("导出时间　" + fmtDate(now), 96, 400);

    var stats = [
      [String(t.items), "张图片"],
      [String(t.weeks), "个期次"],
      [String(t.cats), "个类目"],
      ["上装 " + t.top, "下装 " + t.bottom]
    ];
    stats.forEach(function (s, i) {
      var x = 96 + i * 320;
      c.fillStyle = C.ink;
      c.font = "700 52px " + FONT;
      c.fillText(s[0], x, H - 200);
      c.fillStyle = C.ink3;
      c.font = "400 22px " + FONT;
      c.fillText(s[1], x, H - 162);
    });

    c.fillStyle = C.ink3;
    c.font = "400 22px " + FONT;
    c.fillText("由「我的收藏」导出并发布至趋势专区 · 仅供内部使用 · 请勿外传", 96, H - 68);

    c.fillStyle = "rgba(176,137,72,.16)";
    c.font = "700 " + Math.round(H * 0.42) + "px " + FONT;
    c.fillText("TB", W - 470, H - 120);

    return cv;
  }

  /* 按块边界分页：每页从某个块的开头切，尽量不把一张卡片切两半 */
  function paginate(canvas, blocks, scale) {
    var pw = canvas.width;
    var ph = Math.round(pw * PDF_H_MM / PDF_W_MM);
    var total = canvas.height;
    var bounds = (blocks || []).map(function (b) { return Math.round(num(b.y) * scale); })
      .filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });

    var cuts = [0];
    var y = 0, guard = 0;
    while (y < total && guard++ < 400) {
      var target = y + ph;
      if (target >= total) { cuts.push(total); break; }
      var best = -1;
      for (var i = 0; i < bounds.length; i++) {
        var v = bounds[i];
        /* 至少占满一页的 1/3 再考虑切，否则会切出一堆很短的页 */
        if (v > y + ph * 0.34 && v <= target) best = v;
      }
      var cut = best > 0 ? best : target;
      if (cut <= y) cut = target;          /* 防死循环 */
      cuts.push(cut);
      y = cut;
    }
    if (cuts[cuts.length - 1] < total) cuts.push(total);
    return { pw: pw, ph: ph, cuts: cuts };
  }

  function sliceToCanvas(src, y0, y1, pw, ph) {
    var cv = document.createElement("canvas");
    cv.width = pw; cv.height = ph;
    var c = cv.getContext("2d");
    c.fillStyle = C.bg; c.fillRect(0, 0, pw, ph);
    var h = Math.min(y1 - y0, ph);
    if (h > 0) c.drawImage(src, 0, y0, pw, h, 0, 0, pw, h);
    return cv;
  }

  /* 元信息：标题 / 标签 / 简介都由收藏内容推导，用户不用填 */
  function trendMeta(p, now) {
    var t = p.totals;
    var range = (p.weeks || []).map(function (w) { return w.period; })
      .filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    var title = "收藏趋势周报 " + (range.length ? (range.length > 2 ? range[0] + " 等" : range.join(" ")) + " " : "")
      + fmtDate(now).slice(0, 10);
    if (title.length > 60) title = title.slice(0, 60);

    /* 与前台三个页签对齐：多数期次是 W 格式 → 周度；含年月 → 月度；否则归到类目 */
    var wCount = range.filter(function (r) { return /W\d{1,2}/i.test(r); }).length;
    var mCount = range.filter(function (r) { return /\d{4}[-年]\d{1,2}/.test(r); }).length;
    var tag = "类目";
    if (wCount && wCount >= mCount) tag = "周度";
    else if (mCount) tag = "月度";

    var desc = "共 " + t.items + " 张图片，" + t.weeks + " 个期次、" + t.cats + " 个类目"
      + "（上装 " + t.top + " / 下装 " + t.bottom + "）。"
      + "由「我的收藏」导出并发布，生成于 " + fmtDate(now) + "。";

    /* 收藏通常跨类目，写死某一个类目会让前台按类目筛错位，所以留空 */
    return { title: title, tag: tag, category: "", description: desc };
  }

  /* 收藏 → PDF（一张连续长页）。返回 { pdfBlob, coverBlob, meta, pages, count, failed } */
  async function exportPdfForTrend(items, cats, opts) {
    opts = opts || {};
    var p = plan(items, cats);
    if (!p.totals.items) throw new Error("没有收藏内容，先把图拖进收藏再导出。");

    var okPdf = await loadJsPdf();
    if (!okPdf) throw new Error("PDF 组件加载失败，请刷新页面重试。");

    /* 长图与 ①同一套画法，保证「导出图」和「发布到专区的报告」看起来是一回事 */
    var res = await exportPng(items, cats, {
      scale: num(opts.scale) || 2,
      now: opts.now,
      onProgress: opts.onProgress,
    });
    var now = opts.now || new Date();
    if (opts.onPage) opts.onPage("正在拼装长页…");

    var cover = buildCover(p, now);
    var src = res.canvas;

    /* 长条贴图先降到 2200px 宽（297mm 上约 190dpi，看清字足够），体积和内存都小很多 */
    var targetW = 2200;
    var ratio = Math.min(1, targetW / src.width);
    var drawW = Math.round(src.width * ratio);
    var stripH = Math.round(src.height * ratio);

    var mmPerPx = LONG_W_MM / drawW;
    var totalMm = stripH * mmPerPx;
    var pageCount = Math.max(1, Math.ceil(totalMm / LONG_MAX_H_MM));
    var firstH = Math.min(LONG_MAX_H_MM, totalMm);

    var jsPDF = window.jspdf.jsPDF;
    /* 第一页就按长页实际高度建，省掉「先建一张 A4 再删掉」的兼容风险 */
    var pdf = new jsPDF({
      orientation: firstH >= LONG_W_MM ? "portrait" : "landscape",
      unit: "mm",
      format: [LONG_W_MM, firstH],
    });

    for (var pg = 0; pg < pageCount; pg++) {
      var topMm = pg * LONG_MAX_H_MM;
      var pageHMm = Math.min(LONG_MAX_H_MM, totalMm - topMm);
      if (pg > 0) pdf.addPage([LONG_W_MM, pageHMm], "portrait");

      var y0 = Math.round(topMm / mmPerPx);
      var y1 = Math.min(stripH, Math.round((topMm + pageHMm) / mmPerPx));
      var cur = y0;
      var guard = 0;
      while (cur < y1 && guard++ < 200) {
        var hPx = Math.min(LONG_CHUNK_PX, y1 - cur);
        var piece = document.createElement("canvas");
        piece.width = drawW;
        piece.height = hPx;
        var pc = piece.getContext("2d");
        pc.fillStyle = C.bg;
        pc.fillRect(0, 0, drawW, hPx);
        pc.drawImage(src, 0, Math.round(cur / ratio), src.width,
          Math.round(hPx / ratio), 0, 0, drawW, hPx);

        if (opts.onPage) {
          opts.onPage("正在拼装长页 " + Math.round(((cur - y0) / Math.max(1, y1 - y0)) * 100) + "%");
        }
        pdf.addImage(
          piece.toDataURL("image/jpeg", 0.85), "JPEG",
          0, (cur - y0) * mmPerPx, LONG_W_MM, hPx * mmPerPx
        );
        piece.width = piece.height = 0;    /* 及时释放 */
        cur += hPx;
        await new Promise(function (r) { setTimeout(r, 0); });   /* 让出主线程 */
      }
    }

    var coverBlob = await new Promise(function (resolve) {
      if (cover.toBlob) cover.toBlob(resolve, "image/png");
      else resolve(null);
    });

    return {
      pdfBlob: pdf.output("blob"),
      coverBlob: coverBlob,
      meta: trendMeta(p, now),
      pages: pageCount,
      count: res.count,
      failed: res.failed,
      canvas: res.canvas,
    };
  }

  /* ---------------------------------------------------------------- 下载 */
  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name || ("收藏周报-" + fmtDate(new Date()).replace(/[: ]/g, "") + ".png");
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (e) { }
      a.remove();
    }, 1500);
  }

  function fileName(now) {
    var d = now || new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return "收藏周报-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + ".png";
  }

  /* ---------------------------------------------------------------- ⑦ 网页（单文件 HTML） */
  /* 与 PNG 同一套分组，但输出成一张可直接双击打开的网页：
     带筛选（全部/上装/下装）、搜索、类目跳转、打印样式；不引用任何外部脚本或样式。 */
  function h(s) {
    return str(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function buildHtml(p, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var s = p.totals;

    /* 类目导航（按出现过的类目去重，保留顺序） */
    var navSeen = {}, navs = [];
    p.weeks.forEach(function (w) {
      w.cats.concat(w.others ? [w.others] : []).forEach(function (c) {
        var k = c.cid == null ? "__none" : String(c.cid);
        if (navSeen[k]) return;
        navSeen[k] = 1;
        navs.push({ key: k, name: c.name, color: c.color || "#b9ae9c" });
      });
    });

    var css = [
      ":root{--ink:#221d17;--ink2:#5c5346;--ink3:#8c8175;--gold:#b08948;--line:#e6ddcd;--bg:#faf8f4;--card:#fff}",
      "*{box-sizing:border-box}",
      "body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased}",
      "a{color:var(--gold);text-decoration:none}",
      ".wrap{max-width:1440px;margin:0 auto;padding:0 28px}",
      "header.top{background:#fff;border-bottom:1px solid var(--line);padding:26px 0 18px}",
      ".brand{font:600 12px/1 inherit;letter-spacing:.34em;color:var(--gold);text-transform:uppercase}",
      "h1{margin:10px 0 6px;font-size:27px;font-weight:700;letter-spacing:.5px}",
      ".meta{color:var(--ink3);font-size:12.5px}",
      ".chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}",
      ".chip{border:1px solid var(--line);background:#fdfbf7;border-radius:999px;padding:4px 12px;font-size:12px;color:var(--ink2)}",
      ".chip b{color:var(--ink);font-weight:600}",
      ".bar{position:sticky;top:0;z-index:9;background:rgba(250,248,244,.94);backdrop-filter:saturate(1.4) blur(8px);border-bottom:1px solid var(--line)}",
      ".barin{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:11px 0}",
      ".tabs{display:flex;gap:2px}",
      ".tab{border:0;background:none;font:600 13px/1 inherit;color:var(--ink3);padding:8px 12px;border-radius:8px;cursor:pointer;position:relative}",
      ".tab[aria-selected=true]{color:var(--gold)}",
      ".tab[aria-selected=true]:after{content:'';position:absolute;left:12px;right:12px;bottom:2px;height:2px;background:var(--gold);border-radius:2px}",
      ".tab i{font-style:normal;font-size:11px;opacity:.62;margin-left:4px}",
      ".search{margin-left:auto;display:flex;align-items:center;gap:8px}",
      ".search input{width:220px;border:1px solid var(--line);background:#fff;border-radius:9px;padding:8px 11px;font:inherit;font-size:13px;outline:none}",
      ".search input:focus{border-color:var(--gold)}",
      ".navcats{display:flex;flex-wrap:wrap;gap:6px;padding:0 0 12px}",
      ".navcat{border:1px solid var(--line);background:#fff;border-radius:8px;padding:4px 10px;font-size:12px;color:var(--ink2);cursor:pointer;display:inline-flex;align-items:center;gap:6px}",
      ".navcat:hover{border-color:var(--gold);color:var(--gold)}",
      ".dot{width:8px;height:8px;border-radius:50%;display:inline-block}",
      "main{padding:26px 0 60px}",
      ".week{margin-bottom:34px}",
      ".week-h{display:flex;align-items:baseline;gap:10px;margin:0 0 12px;font-size:20px;font-weight:700}",
      ".week-h span{font-size:12.5px;font-weight:400;color:var(--ink3)}",
      ".week-h:after{content:'';flex:1;height:1px;background:var(--line);margin-left:6px}",
      ".cat{margin:0 0 18px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:15px 16px 16px}",
      ".cat-h{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:700;margin-bottom:2px}",
      ".cat-h .n{margin-left:auto;font-size:12px;font-weight:400;color:var(--ink3)}",
      ".sub{margin-top:11px;padding-top:11px;border-top:1px dashed #efe7d9}",
      ".sub:first-of-type{border-top:0;padding-top:6px}",
      ".sub-h{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:9px;letter-spacing:.3px}",
      ".sub-h em{font-style:normal;font-weight:400;color:var(--ink3)}",
      ".sub-h.top{color:#8a6a1f}.sub-h.bottom{color:#6d655c}",
      ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px}",
      ".card{border:1px solid #eee7db;border-radius:11px;overflow:hidden;background:#fdfbf7;transition:transform .2s ease,box-shadow .2s ease}",
      ".card:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(60,50,38,.09)}",
      ".card .ph{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;background:#efeae2}",
      ".card .tx{padding:8px 9px 10px}",
      ".card .ti{font-size:12.5px;line-height:1.35;color:var(--ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
      ".card .tg{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}",
      ".card .tg span{font-size:10.5px;color:var(--gold);background:rgba(176,137,72,.1);border-radius:6px;padding:1px 6px}",
      ".empty{padding:40px 0;color:var(--ink3);text-align:center}",
      "footer{border-top:1px solid var(--line);color:var(--ink3);font-size:12px;padding:18px 0 40px}",
      "@media print{body{background:#fff}.bar{position:static}.search{display:none}.card:hover{transform:none;box-shadow:none}.cat{break-inside:avoid}}",
      "@media (max-width:760px){.wrap{padding:0 14px}h1{font-size:22px}.search input{width:100%}.grid{grid-template-columns:repeat(auto-fill,minmax(132px,1fr))}}",
    ].join("");

    var payload = {
      title: "收藏周报",
      generated: fmtDate(now),
      stats: s,
      weeks: p.weeks.map(function (w) {
        return {
          period: w.period,
          total: w.total,
          cats: w.cats.concat(w.others ? [w.others] : []).map(function (c) {
            return {
              key: c.cid == null ? "__none" : String(c.cid),
              name: c.name,
              color: c.color || "#b9ae9c",
              count: c.count,
              subs: c.subs.map(function (sb) {
                return {
                  key: sb.key,
                  name: sb.name,
                  items: sb.items.map(function (it) {
                    return {
                      id: it.id == null ? "" : String(it.id),
                      title: str(it.title || it.leaf_category || ""),
                      img: str(it.image_url || ""),
                      _sub: str(it.sub_cat || "none"),
                      tags: (Array.isArray(it.tags) ? it.tags : []).slice(0, 3).map(str).filter(Boolean),
                    };
                  }),
                };
              }),
            };
          }),
        };
      }),
    };
    /* </script> 出现在数据里会提前闭合脚本，必须转义 */
    var json = JSON.stringify(payload).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

    var navHtml = navs.map(function (n) {
      return '<button type="button" class="navcat" data-jump="' + h(n.key) + '"><i class="dot" style="background:' + h(n.color) + '"></i>' + h(n.name) + "</button>";
    }).join("");

    var js = [
      "(function(){",
      "var D=JSON.parse(document.getElementById('data').textContent);",
      "var app=document.getElementById('app'),bar=document.getElementById('tabs'),q=document.getElementById('q');",
      "var cur='all',kw='';",
      "function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}",
      "function img(u,t){var i=document.createElement('img');i.className='ph';i.loading='lazy';i.decoding='async';if(u){i.src=u;}else{i.alt='无图'}i.alt=i.alt||t;return i}",
      "function card(it){var d=el('div','card'),a=document.createElement('a');a.href=it.img||'#';a.target='_blank';a.rel='noopener';a.appendChild(img(it.img,it.title));d.appendChild(a);var tx=el('div','tx');tx.appendChild(el('div','ti',it.title||'（无标题）'));if(it.tags&&it.tags.length){var g=el('div','tg');it.tags.forEach(function(t){g.appendChild(el('span',null,t))});tx.appendChild(g)}d.appendChild(tx);d.dataset.sub=it._sub||'none';d.dataset.kw=(it.title||'').toLowerCase();return d}",
      "function render(){app.textContent='';var shown=0;",
      " D.weeks.forEach(function(w){var wk=el('section','week');var hd=el('h2','week-h');hd.appendChild(document.createTextNode(w.period));hd.appendChild(el('span',null,w.total+' 张'));wk.appendChild(hd);",
      "  var wkShown=0;",
      "  w.cats.forEach(function(c){var box=el('div','cat');box.id='c-'+c.key;var ch=el('div','cat-h');var dot=el('i','dot');dot.style.background=c.color;ch.appendChild(dot);ch.appendChild(document.createTextNode(c.name));ch.appendChild(el('i','n',c.count+' 张'));box.appendChild(ch);",
      "   var boxShown=0;",
      "   c.subs.forEach(function(sb){var row=el('div','sub');if(sb.name){var sh=el('div','sub-h'+(sb.key?' '+sb.key:''));sh.appendChild(document.createTextNode(sb.name));sh.appendChild(el('em',null,sb.items.length+' 张'));row.appendChild(sh)}var g=el('div','grid');var n=0;",
      "    sb.items.forEach(function(it){if(cur!=='all'&&(it._sub||'none')!==cur)return;if(kw&&(it.title||'').toLowerCase().indexOf(kw)<0)return;var d=card(it);d.dataset.sub=sb.key||'none';g.appendChild(d);n++;});",
      "    if(n){row.appendChild(g);box.appendChild(row);boxShown+=n;} });",
      "   if(boxShown){wk.appendChild(box);wkShown+=boxShown;} });",
      "  if(wkShown){app.appendChild(wk);shown+=wkShown;} });",
      " if(!shown){var e=el('div','empty');e.textContent=(kw||cur!=='all')?'没有符合条件的图，换个筛选试试':'这份收藏还没有图';app.appendChild(e)}",
      " document.getElementById('cnt').textContent='显示 '+shown+' / '+D.stats.items+' 张';",
      "}",
      "function counts(){var c={all:0,top:0,bottom:0,none:0};D.weeks.forEach(function(w){w.cats.forEach(function(x){x.subs.forEach(function(sb){sb.items.forEach(function(it){c.all++;var k=it._sub||'none';c[k]=(c[k]||0)+1;})})})});return c}",
      "var C=counts();",
      "Array.prototype.forEach.call(bar.querySelectorAll('.tab'),function(b){var k=b.dataset.k;var n=C[k]||0;b.querySelector('i').textContent=n;b.setAttribute('aria-selected',k===cur?'true':'false');b.addEventListener('click',function(){cur=k;Array.prototype.forEach.call(bar.querySelectorAll('.tab'),function(x){x.setAttribute('aria-selected',x.dataset.k===k?'true':'false')});render()})});",
      "q.addEventListener('input',function(){kw=q.value.trim().toLowerCase();render()});",
      "Array.prototype.forEach.call(document.querySelectorAll('.navcat'),function(b){b.addEventListener('click',function(){var t=document.getElementById('c-'+b.dataset.jump);if(t){t.scrollIntoView({behavior:'smooth',block:'start'});t.style.outline='2px solid var(--gold)';setTimeout(function(){t.style.outline=''},1200)}})});",
      "var _ac=document.getElementById('allcount');if(_ac)_ac.textContent=D.stats.items;",
      "render();",
      "})();",
    ].join("\n");

    var tags = [
      "<!doctype html>",
      '<html lang="zh-CN"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      "<title>收藏周报 · " + h(fmtDate(now)) + "</title>",
      "<style>" + css + "</style></head><body>",
      '<header class="top"><div class="wrap">',
      '<div class="brand">Trend Bank</div>',
      "<h1>收藏周报</h1>",
      '<div class="meta">导出时间 ' + h(fmtDate(now)) + " · 共 " + s.items + " 张图 · " + p.weeks.length + " 个期次</div>",
      '<div class="chips">',
      '<span class="chip">期次 <b>' + p.weeks.length + "</b></span>",
      '<span class="chip">类目 <b>' + s.cats + "</b></span>",
      '<span class="chip">上装 <b>' + s.top + "</b></span>",
      '<span class="chip">下装 <b>' + s.bottom + "</b></span>",
      '<span class="chip">未分 <b>' + s.none + "</b></span>",
      "</div></div></header>",
      '<div class="bar"><div class="wrap"><div class="barin">',
      '<div class="tabs" id="tabs" role="tablist">',
      '<button type="button" class="tab" data-k="all" role="tab" aria-selected="true">全部<i>0</i></button>',
      '<button type="button" class="tab" data-k="top" role="tab" aria-selected="false">上装<i>0</i></button>',
      '<button type="button" class="tab" data-k="bottom" role="tab" aria-selected="false">下装<i>0</i></button>',
      '<button type="button" class="tab" data-k="none" role="tab" aria-selected="false">未分<i>0</i></button>',
      "</div>",
      '<div class="search"><span class="meta" id="cnt">显示 0 / 0 张</span><input id="q" type="search" placeholder="搜索标题…" autocomplete="off"></div>',
      '</div><div class="navcats">' + navHtml + "</div>",
      "</div></div>",
      '<main><div class="wrap"><div id="app"></div></div></main>',
      '<footer><div class="wrap">© 2026 TREND BANK · 收藏周报 · 单文件导出，可离线打开 · 数据来自「我的收藏」</div></footer>',
      '<script type="application/json" id="data">' + json + "</script>",
      "<script>" + js + "</script>",
      "</body></html>",
    ].join("\n");

    return tags;
  }

  async function exportHtml(items, cats, opts) {
    opts = opts || {};
    var p = plan(items, cats);
    if (!p.totals.items) throw new Error("没有收藏内容，先把图拖进收藏再导出。");
    var html = buildHtml(p, opts);
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    return {
      blob: blob,
      html: html,
      count: p.totals.items,
      weeks: p.weeks.length,
      cats: p.totals.cats,
    };
  }

  function htmlName(now) {
    var d = now || new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return "收藏周报-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + ".html";
  }

  /* ---------------------------------------------------------------- 对外 */
  NS.plan = plan;
  NS.exportHtml = exportHtml;
  NS.buildHtml = buildHtml;
  NS.htmlName = htmlName;
  NS.layout = layout;
  NS.exportPng = exportPng;
  NS.exportPdfForTrend = exportPdfForTrend;   /* 收藏 → PDF + 元信息，供页面脚本上传趋势专区 */
  NS.loadJsPdf = loadJsPdf;
  NS.trendMeta = trendMeta;
  NS.paginate = paginate;
  NS.download = download;
  NS.fileName = fileName;
  NS.cancel = function () { CANCEL.v = true; };
  NS._const = { LW: LW, PAD: PAD, GAP: GAP, COLS: COLS, TITLE_H: TITLE_H, HEAD_H: HEAD_H, FOOT_H: FOOT_H };
  window.FavExport = NS;
})();