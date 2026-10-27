/* ============================================================================
 * 收藏周报 · 整张高清导出（20261027E）
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

  /* ---------------------------------------------------------------- 对外 */
  NS.plan = plan;
  NS.layout = layout;
  NS.exportPng = exportPng;
  NS.download = download;
  NS.fileName = fileName;
  NS.cancel = function () { CANCEL.v = true; };
  NS._const = { LW: LW, PAD: PAD, GAP: GAP, COLS: COLS, TITLE_H: TITLE_H, HEAD_H: HEAD_H, FOOT_H: FOOT_H };
  window.FavExport = NS;
})();