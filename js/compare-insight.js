/* ============================================================================
 * compare-insight.js —— 渠道对比 · 差异分析（20261111AD）
 * ----------------------------------------------------------------------------
 * 解决一件事：在「渠道对比」里选中若干来源（趋势上升榜 / SHEIN / Pinterest …）
 * 之后，能针对其中某一个来源回答「它和别的来源差在哪」。
 *
 * 口径：
 *   · 只统计当前页面已选的「月度 + 类目」下的图，与图片列完全一致，不多不少。
 *   · 每个打标维度各算各的分母：占比 = 该维度打了标的图里的出现率，
 *     没打这个维度的图不算进分母，避免把「没打标」当成「其它」。
 *   · 「其它专区」取各来源占比的算术平均（每个来源一票），
 *     不按张数加权，否则大样本的那一列会盖掉小样本频道。
 *   · 差值单位统一是「百分点（pp）」，不是相对百分比。
 *
 * 不写库、不改数据，纯前端只读计算。
 * ==========================================================================*/
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  function pct1(x) {
    if (!isFinite(x)) return "0";
    return String(Math.round(x * 10) / 10);
  }

  /* 维度定义：与前台大图标签面板、后台打标表保持同一套列名 */
  var DIMS = [
    { k: "style_tags", label: "风格" },
    { k: "visual_tags", label: "视觉" },
    { k: "scene_tags", label: "背景", bg: true },
    { k: "shoot_tags", label: "拍摄方式" },
    { k: "pattern_tags", label: "图案类型" },
    { k: "element_tags", label: "图案元素" },
    { k: "struct_tags", label: "结构部件" },
    { k: "craft_tags", label: "二次工艺" },
    { k: "fabric_tags", label: "面料" },
    { k: "fit_tags", label: "版型" },
    { k: "skin_tags", label: "模特" },
    { k: "culture_tags", label: "文化背景" },
    { k: "psych_tags", label: "消费心理" },
    { k: "festival_tags", label: "节日" }
  ];

  var MIN_TOT = 3;        /* 某个来源某个维度少于 3 张打过标，不参与占比比较（样本太薄） */
  var MIN_DELTA = 8;      /* 结论门槛：差异至少 8 个百分点 */
  var MIN_OWN = 12;       /* 「独有特征」：本列至少 12% */
  var MIN_OTHER = 15;     /* 「其它专区常见」：其它均值至少 15% */

  function arr(v) {
    if (v == null) return [];
    if (Object.prototype.toString.call(v) === "[object Array]") {
      return v.filter(function (x) { return x != null && String(x).trim() !== ""; }).map(function (x) { return String(x).trim(); });
    }
    if (typeof v === "string") {
      return v.split(/[,，、|；;]/).map(function (x) { return x.trim(); }).filter(Boolean);
    }
    return [];
  }

  /* 背景：优先 scene_tags；老数据把背景塞在 visual_tags 里，按词形挑出来兜底 */
  var BG_RE = /^(室内|室外)[·・]|底$|背景$|背景纸|抠图/;
  function bgOf(t) {
    var s = arr(t.scene_tags);
    if (s.length) return s;
    return arr(t.visual_tags).filter(function (v) { return BG_RE.test(v); });
  }

  function uniq(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (v) { if (!seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }

  /* ---------- 统计 ---------- */
  function buildStats(ctx) {
    return (ctx.sources || []).map(function (s) {
      var list = s.list || [];
      var st = { key: s.key, label: s.label, type: s.type, n: list.length, tagged: 0, dims: {} };
      DIMS.forEach(function (d) { st.dims[d.k] = { tot: 0, cnt: {} }; });
      list.forEach(function (it) {
        var t = ctx.tags ? ctx.tags[it.image_url] : null;
        if (!t) return;
        var any = false;
        DIMS.forEach(function (d) {
          var vals = uniq(d.bg ? bgOf(t) : arr(t[d.k]));
          if (!vals.length) return;
          any = true;
          var box = st.dims[d.k];
          box.tot++;
          vals.forEach(function (v) { box.cnt[v] = (box.cnt[v] || 0) + 1; });
        });
        if (any) st.tagged++;
      });
      return st;
    });
  }

  function pctOf(box, v) { return box.tot ? (box.cnt[v] || 0) / box.tot * 100 : 0; }

  /* 其它来源的「平均占比」：每个有样本的来源各算一个占比，再取算术平均 */
  function otherAgg(stats, focusKey, k) {
    var cols = stats.filter(function (s) { return s.key !== focusKey && s.dims[k].tot >= MIN_TOT; });
    var sum = {};
    cols.forEach(function (s) {
      var box = s.dims[k];
      Object.keys(box.cnt).forEach(function (v) { sum[v] = (sum[v] || 0) + box.cnt[v] / box.tot * 100; });
    });
    var avg = {};
    Object.keys(sum).forEach(function (v) { avg[v] = sum[v] / cols.length; });
    return { avg: avg, cols: cols.length };
  }

  /* 相似度：13 个维度逐个比较取值分布的重合度（1 - 半 L1 距离），再取各维度平均。
     相同 = 100%，完全不重合 = 0%。比余弦更直观：不会因为标签取值稀疏就一律显示很低的分数。 */
  function simOf(a, b) {
    var total = 0, dims = 0;
    DIMS.forEach(function (d) {
      var ba = a.dims[d.k], bb = b.dims[d.k];
      if (!ba || !bb || ba.tot < MIN_TOT || bb.tot < MIN_TOT) return;
      var vals = {};
      Object.keys(ba.cnt).forEach(function (v) { vals[v] = 1; });
      Object.keys(bb.cnt).forEach(function (v) { vals[v] = 1; });
      var l1 = 0;
      Object.keys(vals).forEach(function (v) {
        l1 += Math.abs((ba.cnt[v] || 0) / ba.tot - (bb.cnt[v] || 0) / bb.tot);
      });
      total += Math.max(0, 1 - l1 / 2);
      dims++;
    });
    return dims ? total / dims * 100 : null;
  }

  /* ---------- 结论 ---------- */
  function diffsOf(stats, focus) {
    var out = [];
    DIMS.forEach(function (d) {
      var box = focus.dims[d.k];
      if (box.tot < MIN_TOT) return;
      var o = otherAgg(stats, focus.key, d.k);
      if (!o.cols) return;
      var vals = {};
      Object.keys(box.cnt).forEach(function (v) { vals[v] = 1; });
      Object.keys(o.avg).forEach(function (v) { vals[v] = 1; });
      Object.keys(vals).forEach(function (v) {
        var cf = box.cnt[v] || 0;
        var pf = pctOf(box, v);
        var po = o.avg[v] || 0;
        out.push({
          dim: d.label, key: d.k, val: v,
          cf: cf, pf: pf, po: po, delta: pf - po
        });
      });
    });
    return out;
  }

  function conclusionsOf(stats, focus) {
    var concl = [];
    var used = {};
    if (!focus.tagged) {
      concl.push({
        tone: "flat",
        text: focus.n
          ? "本列 " + focus.n + " 张图还没有任何打标数据，无法比较结构差异。先到对应专区的打标面板把标打上。"
          : "本列在这个类目 / 月份下没有图，换一个月份或类目再看。"
      });
      return concl;
    }
    var ds = diffsOf(stats, focus);

    /* ① 差异最大的几条（每个维度最多两条，避免同一个维度刷屏） */
    var byDelta = ds.filter(function (x) {
      return Math.abs(x.delta) >= MIN_DELTA && (x.cf >= 2 || x.po >= 10);
    }).sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
    var perDim = {};
    byDelta.forEach(function (x) {
      if ((perDim[x.key] || 0) >= 2) return;
      perDim[x.key] = (perDim[x.key] || 0) + 1;
      used[x.dim + "|" + x.val] = 1;
      concl.push({
        tone: x.delta > 0 ? "up" : "down",
        text: "「" + x.dim + "」这一维，" + (x.delta > 0 ? "更偏 " : "明显少见于 ") +
          "「" + x.val + "」：本列 " + pct1(x.pf) + "%（" + x.cf + " 张），其它专区均值 " +
          pct1(x.po) + "%，" + (x.delta > 0 ? "高 " : "低 ") + pct1(Math.abs(x.delta)) + " 个百分点。"
      });
    });

    /* ② 只有本列有的特征 */
    var own = ds.filter(function (x) {
      return x.pf >= MIN_OWN && x.cf >= 2 && x.po < 2;
    }).sort(function (a, b) { return b.pf - a.pf; }).slice(0, 3);
    own.forEach(function (x) {
      concl.push({
        tone: "own",
        text: "独有特征：「" + x.dim + "」里的「" + x.val + "」本列有 " + x.cf + " 张（" +
          pct1(x.pf) + "%），其它专区基本没有。"
      });
    });

    /* ③ 其它专区常见、本列没有的 */
    var miss = ds.filter(function (x) {
      return x.pf < 2 && x.po >= MIN_OTHER && (x.cf === 0);
    }).sort(function (a, b) { return b.po - a.po; }).slice(0, 3);
    miss.forEach(function (x) {
      concl.push({
        tone: "miss",
        text: "缺口：「" + x.dim + "」里的「" + x.val + "」其它专区均值 " + pct1(x.po) +
          "%，本列一张都没有。"
      });
    });

    if (!concl.length) {
      concl.push({
        tone: "flat",
        text: stats.length < 2
          ? "当前只有一个来源，没有可对比的对象。至少加入两个来源才能看差异。"
          : "这个类目 / 月份下，各来源的打标结构比较接近，没有超过 " + MIN_DELTA + " 个百分点的明显差异。可以换一个类目或月份再看。"
      });
    }
    return concl;
  }

  function similarityOf(stats, focus) {
    var rows = stats.filter(function (s) { return s.key !== focus.key; }).map(function (s) {
      return { label: s.label, n: s.n, score: simOf(focus, s) };
    }).filter(function (r) { return r.score != null; });
    rows.sort(function (a, b) { return b.score - a.score; });
    return rows;
  }

  /* ---------- 渲染 ---------- */
  function bar(p) { return Math.max(0, Math.min(100, p)); }

  function renderHead(ctx, stats, focus) {
    var n = focus.n;
    var cov = n ? Math.round(focus.tagged / n * 100) : 0;
    var sims = similarityOf(stats, focus);
    var nDiff = diffsOf(stats, focus).filter(function (x) {
      return Math.abs(x.delta) >= MIN_DELTA && (x.cf >= 2 || x.po >= 10);
    }).length;
    var h = '<div class="cmi-head">';
    h += '<div class="cmi-kicker">渠道差异分析</div>';
    h += '<h2 class="cmi-title">' + esc(focus.label) + " <span>vs 其它 " + (stats.length - 1) + " 个来源</span></h2>";
    h += '<div class="cmi-meta">' + esc([ctx.month || "全部月份", ctx.cat || "全部类目"].join(" · ")) +
      " · 样本 " + n + " 张 · 打标覆盖 " + cov + "% · 生成 " + esc(nowText()) + "</div>";
    h += '<div class="cmi-cards">';
    h += card("本列样本", n + " 张", focus.tagged + " 张已打标");
    h += card("打标覆盖", cov + "%", cov < 30 ? "样本偏少，结论仅供参考" : "可做结构比较");
    h += card("差异项", String(nDiff), "差 " + MIN_DELTA + " 个百分点以上的对比");
    h += card("最接近", sims.length ? (sims[0].score != null ? Math.round(sims[0].score) + "%" : "—") : "—",
      sims.length ? sims[0].label : "无可比来源");
    h += "</div>";
    h += "</div>";
    return h;
  }

  function card(k, v, s) {
    return '<div class="cmi-card"><div class="cmi-card-k">' + esc(k) + '</div><div class="cmi-card-v">' + esc(v) +
      '</div><div class="cmi-card-s">' + esc(s) + "</div></div>";
  }

  function nowText() {
    var d = new Date();
    var p = function (x) { return x < 10 ? "0" + x : x; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function renderConcl(ctx, stats, focus) {
    var list = conclusionsOf(stats, focus);
    var h = '<section class="cmi-sec"><h3>核心结论：差异在哪里</h3><ul class="cmi-concl">';
    list.forEach(function (c) { h += '<li class="tone-' + c.tone + '">' + esc(c.text) + "</li>"; });
    h += "</ul>";
    if (focus.n && focus.tagged / focus.n < 0.3) {
      h += '<p class="cmi-warn">本列只有 ' + Math.round(focus.tagged / focus.n * 100) +
        "% 的图打过标，上面的结构比较会被未打标的图稀释。补完标再看会更准。</p>";
    }
    if (focus.n < 10) h += '<p class="cmi-warn">本列只有 ' + focus.n + " 张图，占比波动会很大，建议结合更多月份判断。</p>";
    h += "</section>";
    return h;
  }

  function renderDiffTable(stats, focus) {
    var ds = diffsOf(stats, focus).filter(function (x) {
      return Math.abs(x.delta) >= MIN_DELTA && (x.cf >= 2 || x.po >= 10);
    }).sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); }).slice(0, 14);
    if (!ds.length) return "";
    var h = '<section class="cmi-sec"><h3>差异榜单（前 14 项）</h3>' +
      '<div class="cmi-tbl-wrap"><table class="cmi-tbl"><thead><tr><th>维度</th><th>特征</th>' +
      '<th class="num">' + esc(focus.label) + "</th><th class=\"num\">其它专区均值</th><th class=\"num\">差</th></tr></thead><tbody>";
    ds.forEach(function (x) {
      var cls = x.delta > 0 ? "pos" : "neg";
      h += "<tr><td>" + esc(x.dim) + "</td><td>" + esc(x.val) + "</td><td class=\"num\">" + pct1(x.pf) + "%</td>" +
        '<td class="num">' + pct1(x.po) + '%</td><td class="num ' + cls + '">' +
        (x.delta > 0 ? "+" : "") + pct1(x.delta) + "pp</td></tr>";
    });
    h += "</tbody></table></div></section>";
    return h;
  }

  function renderSim(stats, focus) {
    var sims = similarityOf(stats, focus);
    if (!sims.length) return "";
    var h = '<section class="cmi-sec"><h3>结构相似度</h3>' +
      '<p class="cmi-sub">逐维比较 13 个维度的取值分布重合度再取平均：越接近 100%，说明这个来源的打标结构和它越像；0% 表示完全没有重合。</p>';
    sims.forEach(function (r) {
      h += '<div class="cmi-sim-row"><span class="cmi-sim-k">' + esc(r.label) + '</span>' +
        '<span class="cmi-sim-bar"><i style="width:' + bar(r.score) + '%"></i></span>' +
        '<span class="cmi-sim-v">' + Math.round(r.score) + "%</span>" +
        '<span class="cmi-sim-n">' + r.n + " 张</span></div>";
    });
    h += "</section>";
    return h;
  }

  function renderDims(stats, focus) {
    var h = '<section class="cmi-sec"><h3>逐维度对照</h3>' +
      '<p class="cmi-sub">每行是一个打标取值在该来源里的出现率（分母＝这个维度打过标的图）。括号里是张数。</p>';
    var any = false;
    DIMS.forEach(function (d) {
      var box = focus.dims[d.k];
      var o = otherAgg(stats, focus.key, d.k);
      if (box.tot < MIN_TOT && !o.cols) return;
      /* 取值：本列全部 + 其它来源占比够高的，按本列占比降序 */
      var vals = {};
      Object.keys(box.cnt).forEach(function (v) { vals[v] = 1; });
      Object.keys(o.avg).forEach(function (v) { if (o.avg[v] >= 5) vals[v] = 1; });
      var list = Object.keys(vals).map(function (v) {
        return { v: v, pf: pctOf(box, v), cf: box.cnt[v] || 0, po: o.avg[v] || 0 };
      }).sort(function (a, b) { return b.pf - a.pf || b.po - a.po; }).slice(0, 8);
      if (!list.length) return;
      any = true;
      h += '<div class="cmi-dim"><div class="cmi-dim-h">' + esc(d.label) +
        '<span>本列 ' + box.tot + " 张打过标" + (o.cols ? " · 对比 " + o.cols + " 个来源" : "") + "</span></div>" +
        '<div class="cmi-tbl-wrap"><table class="cmi-tbl cmi-tbl-sm"><thead><tr><th>特征</th>' +
        '<th class="num">本列</th><th class="num">其它均值</th><th class="num">差</th></tr></thead><tbody>';
      list.forEach(function (r) {
        var cls = r.pf - r.po > 0 ? "pos" : (r.pf - r.po < 0 ? "neg" : "");
        h += "<tr><td>" + esc(r.v) + "</td><td class=\"num\">" + pct1(r.pf) + "%<em>（" + r.cf + "）</em></td>" +
          '<td class="num">' + pct1(r.po) + "%</td><td class=\"num " + cls + '">' +
          (r.pf - r.po > 0 ? "+" : "") + pct1(r.pf - r.po) + "pp</td></tr>";
      });
      h += "</tbody></table></div></div>";
    });
    if (!any) h += '<p class="cmi-warn">本列还没有任何打标数据，先把图打上标再来看差异。</p>';
    h += "</section>";
    return h;
  }

  /* 总览：所有来源在每个维度上的取值矩阵（不含差异，只看各自结构） */
  function renderMatrix(stats, focus) {
    var cols = stats.filter(function (s) { return s.n > 0; });
    if (cols.length < 2) return "";
    var h = '<section class="cmi-sec"><h3>全景对照表</h3>' +
      '<p class="cmi-sub">同一行是同一个打标取值，横向看各来源的出现率；' + esc(focus.label) + " 那一列高亮。</p>";
    DIMS.forEach(function (d) {
      var vals = {};
      cols.forEach(function (s) {
        var box = s.dims[d.k];
        if (box.tot < MIN_TOT) return;
        Object.keys(box.cnt).forEach(function (v) { if (pctOf(box, v) >= 8) vals[v] = 1; });
      });
      var list = Object.keys(vals);
      if (!list.length) return;
      list.sort(function (a, b) {
        var fa = pctOf(focus.dims[d.k], a), fb = pctOf(focus.dims[d.k], b);
        return fb - fa || a.localeCompare(b, "zh");
      });
      list = list.slice(0, 8);
      h += '<div class="cmi-dim"><div class="cmi-dim-h">' + esc(d.label) + "</div>" +
        '<div class="cmi-tbl-wrap"><table class="cmi-tbl cmi-tbl-sm"><thead><tr><th>特征</th>';
      cols.forEach(function (s) {
        h += '<th class="num' + (s.key === focus.key ? " is-focus" : "") + '">' + esc(s.label) + "</th>";
      });
      h += "</tr></thead><tbody>";
      list.forEach(function (v) {
        h += "<tr><td>" + esc(v) + "</td>";
        cols.forEach(function (s) {
          var box = s.dims[d.k];
          var p = box.tot >= MIN_TOT ? pctOf(box, v) : null;
          var alpha = p == null ? 0 : Math.min(0.85, p / 100 * 1.6);
          h += '<td class="num' + (s.key === focus.key ? " is-focus" : "") + '"' +
            (p ? ' style="background:rgba(200,164,93,' + alpha.toFixed(2) + ')"' : "") + ">" +
            (p == null ? "—" : pct1(p) + "%") + "</td>";
        });
        h += "</tr>";
      });
      h += "</tbody></table></div></div>";
    });
    h += "</section>";
    return h;
  }

  function renderNotes(ctx) {
    return '<section class="cmi-sec cmi-notes"><h3>口径说明</h3><ul>' +
      "<li>样本＝当前「月度 + 类目」筛选下该来源的图；换月份或类目，结论会随之变化。</li>" +
      "<li>每个维度单独算分母：只统计这个维度打过标的图，没打标的图不计入，不会被当成「其它」。</li>" +
      "<li>「其它专区均值」是其它各来源占比的算术平均（每个来源一票），不按张数加权。</li>" +
      "<li>差值为「百分点（pp）」：本列占比减去其它均值，正数表示本列更多。</li>" +
      "<li>少于 " + MIN_TOT + " 张打过标的来源 / 维度不参与比较；样本不足 10 张时结论仅供参考。</li>" +
      "<li>背景一列合并了「视觉-背景」与场景标签；白底、浅灰底这类通用底也参与对比——跨渠道比稿时，用不用白底本身就是渠道差异。</li>" +
      "<li>相似度是 13 个维度逐个比较取值分布重合度后的平均值，只反映「打标结构像不像」，不代表销量或款式好坏。</li>" +
      "</ul></section>";
  }

  function renderBody(ctx, stats, focusKey) {
    var focus = stats.filter(function (s) { return s.key === focusKey; })[0] || stats.filter(function (s) { return s.n > 0; })[0] || stats[0];
    if (!focus) return '<div class="rk-empty">当前没有可分析的来源。</div>';

    var chips = '<div class="cmi-focus"><span class="cmi-focus-k">分析对象</span>';
    stats.forEach(function (s) {
      chips += '<button type="button" class="cmi-fchip' + (s.key === focus.key ? " is-on" : "") +
        '" data-key="' + esc(s.key) + '">' + esc(s.label) + '<i>' + s.n + "</i></button>";
    });
    chips += "</div>";

    var h = renderHead(ctx, stats, focus) + chips;
    h += renderConcl(ctx, stats, focus);
    h += renderDiffTable(stats, focus);
    h += renderSim(stats, focus);
    h += renderMatrix(stats, focus);
    h += renderDims(stats, focus);
    h += renderNotes(ctx);
    return h;
  }

  var CTX = null, FOCUS = "";

  /* 纯函数：给定数据返回整份报告的 HTML（不碰 DOM，便于自检） */
  function htmlOf(ctx, focusKey) {
    return renderBody(ctx || {}, buildStats(ctx || {}), focusKey || "");
  }

  function paint() {
    var box = $("#cmi-scroll");
    if (!box || !CTX) return;
    box.innerHTML = htmlOf(CTX, FOCUS);
    Array.prototype.forEach.call(box.querySelectorAll(".cmi-fchip"), function (b) {
      b.onclick = function () { FOCUS = b.getAttribute("data-key"); paint(); box.scrollTop = 0; };
    });
  }

  function open(ctx, focusKey) {
    CTX = ctx || {};
    FOCUS = focusKey || (ctx.sources[0] && ctx.sources[0].key) || "";
    var m = $("#cmi-modal");
    if (!m) return;
    m.classList.remove("hidden");
    paint();
    var sc = $("#cmi-scroll");
    if (sc) sc.scrollTop = 0;
  }

  function close() {
    var m = $("#cmi-modal");
    if (m) m.classList.add("hidden");
  }

  function bind() {
    var c = $("#cmi-close");
    if (c) c.onclick = close;
    var m = $("#cmi-modal");
    if (m) m.onclick = function (e) { if (e.target === m) close(); };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  window.CmpInsight = {
    open: open,
    close: close,
    /* 供自检测试直接验证算法，不依赖 DOM */
    _dims: DIMS,
    _stats: buildStats,
    _diffs: diffsOf,
    _other: otherAgg,
    _concl: conclusionsOf,
    _html: htmlOf,
    _sim: similarityOf,
    _simOf: simOf
  };
})();
