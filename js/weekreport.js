/* ============================================================================
 *  周对比分析报告（PPT）——  trendbank / 趋势上升榜 · 纵向·时间对比视图
 *  ----------------------------------------------------------------------------
 *  用户口径：选好「周 vs 周」之后，一键生成一份可以直接拿去汇报的分析报告。
 *
 *  ★ 内容边界（用户明确要求，务必遵守）：
 *    报告只做「分析」，**不要**开发建议 / P0-P2 优先级 / 落地路径 / 排期节奏 /
 *    风险提示 / 本周可启动事项 这类建议性与计划性页面。谁要建议，谁自己补。
 *
 *  页序：① 封面 ② 样本与统计口径 ③ 核心结论 ④ 两周总览
 *        ⑤ 新上榜 ⑥ 掉榜 ⑦ 位次上升榜 ⑧ 位次下降榜 ⑨ 类目结构变化
 *        ⑩ 六维差异 ×6（款式 / 图案印花与设计元素 / 二次工艺 / 场景与背景构成 / 主图视觉 / 模特肤色）
 *           每页 = 上方标签分布表 + 下方按标签分组的配图墙（一眼看到"这一类长什么样"）
 *        ⑪ 图片对照墙
 *
 *  六维数据来自后台给图片打的标签（image_url 为键）。取不到就退化为「该维度无可比数据」，
 *  不阻断成稿；覆盖率低于 60% 会在结论页明确提示置信度受限。
 * ==========================================================================*/
(function () {
  "use strict";

  var FONT = "Microsoft YaHei";
  var SPECS = {
    wide: { name: "16:9 宽屏", w: 13.333, h: 7.5 },
    std: { name: "4:3", w: 10, h: 7.5 }
  };
  var MAX_ROWS = 22;          /* 每页清单最多列多少条，超出只提示“另有 N 条” */
  var MAX_WALL = 12;          /* 图片对照墙每页每列最多几张 */
  var DIM_ROWS = 8;           /* 维度页上方的表最多几行（下方要留给配图） */
  var DIM_TAGS = 3;           /* 维度页配图展示几个标签 */
  var DIM_PICS = 4;           /* 每个标签配几张图 */
  var COL = { ink: "1A1A1A", sub: "6B6B6B", line: "E2DED5", brand: "8B7355", bg: "FFFFFF", head: "F5F1E8" };

  /* ---------------------------------------------------------------- 取数 */
  function txt(el) { return el ? String(el.textContent || "").replace(/\s+/g, " ").trim() : ""; }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* 从对比池里读出「每一列＝一周」的清单。
     位置即位次（1 起），与界面上看到的顺序一致（界面已按当前排序规则排好）。 */
  function collect(root) {
    var wrap = root || q("#rk-pools");
    if (!wrap) return { cols: [], scope: "" };
    var cols = qa(".rk-pool", wrap).map(function (p, ci) {
      var nameEl = q(".rk-pool-name > span", p);
      var cntEl = q(".rk-pool-name .rk-n", p);
      var metaEl = q(".rk-pool-meta", p);
      var cards = qa(".rk-card", p).map(function (c, i) {
        var img = c.querySelector("img");
        var b = c.querySelector(".rk-badge");
        var mv = c.querySelector(".rk-move");
        return {
          url: c.getAttribute("data-url") || (img ? img.getAttribute("src") : "") || "",
          title: c.getAttribute("title") || (img ? img.getAttribute("alt") : "") || "",
          cat: (img && img.getAttribute("alt")) || "",
          rank: i + 1,
          badge: b ? txt(b) : "",
          move: mv ? txt(mv) : ""
        };
      }).filter(function (c) { return c.url; });
      return {
        idx: ci,
        name: txt(nameEl) || ("第 " + (ci + 1) + " 列"),
        spec: txt(cntEl),
        meta: txt(metaEl),
        cards: cards
      };
    }).filter(function (c) { return c.cards.length || c.name; });
    return { cols: cols, scope: txt(q(".rk-bar-info", q("#rk-bar") || document)) };
  }

  /* ------------------------------------------------- 六个维度（款式 / 印花 / 工艺 / 场景 / 主图视觉 / 肤色）
     数据来自后台给图片打的标签（style / element / scene / shoot / skin / category）。
     一图可带多个标签，因此各维度占比之和可能超过 100%；差异统一用「百分点（pt）」表达。
     二次工艺没有独立字段，从元素标签里按工艺词抽取（打标习惯就是把工艺写在元素里）。 */
  var DIMS = [
    { key: "style_tags", zh: "款式与版型", hint: "版型、廓形、长度、领型" },
    { key: "element_tags", zh: "图案印花与设计元素", hint: "图案主题、印花、装饰元素" },
    { key: "craft", zh: "二次工艺", hint: "刺绣 / 印花工艺 / 水洗做旧 / 拼接 / 烫钻等" },
    { key: "scene_tags", zh: "场景与背景构成", hint: "外景 / 室内 / 平铺 / 背景元素" },
    { key: "shoot_tags", zh: "主图视觉", hint: "拍摄手法 · 光线 · 质感 · 姿势" },
    { key: "skin_tags", zh: "模特肤色", hint: "肤色取向" },
    /* 20261027Q：两个语义层维度。前面几维答「看起来是什么」，
       这两维答「它来自哪种文化、想打动谁」——是真正能做趋势判断的部分。 */
    { key: "culture_tags", zh: "文化背景", hint: "文化语境 · 圈层来源 · 时代印记" },
    { key: "psych_tags", zh: "消费心理", hint: "购买动机 · 情感诉求" },
    /* 20261027R 节日：可选维度，只有绑定节日的图才计入 */
    { key: "festival_tags", zh: "节日", hint: "节日节点绑定 · 不含节日则留空" }
  ];
  var CRAFT_WORDS = [
    "刺绣", "绣花", "胶印", "水印", "数码印花", "丝网印", "烫印", "烫钻", "烫金", "烫银",
    "水洗", "做旧", "破坏", "破洞", "磨破", "磨毛", "抓绒", "压褶", "压花", "绗缝",
    "拼接", "撞色拼接", "亮片", "珠片", "铆钉", "拉链", "抽绳", "荷叶边", "蕾丝", "植绒",
    "发泡印", "龟裂印", "反光", "夜光", "手工缝制", "织带", "罗纹", "包边"
  ];

  function pctOf(n, d) { return d ? Math.round(n / d * 1000) / 10 : 0; }

  /* 页面上的图片地址常带缩放/裁剪参数，库里存的是原地址；两级匹配，避免整页维度全部落空 */
  function tagFor(tagMap, url) {
    if (!tagMap) return {};
    var u = String(url || "");
    if (tagMap[u]) return tagMap[u];
    var bare = u.split("?")[0].split("#")[0];
    if (tagMap[bare]) return tagMap[bare];
    return {};
  }

  /* 取某个维度在一条打标记录上的全部取值。
     20261027K 之前的问题：榜单打标新增的 craft_tags / visual_tags / fit_tags
     没有任何一处被读取，所以后台打好的工艺、视觉、版型在报告里永远是空的。
     现在的取法：字段有值就用字段；没有才退回旧口径（工艺从元素词里抽）。 */
  function valsOf(t, dimKey) {
    var vals = [];
    var push = function (arr) {
      (Array.isArray(arr) ? arr : (arr ? [arr] : [])).forEach(function (x) { if (x) vals.push(String(x)); });
    };
    if (dimKey === "craft") {
      if (Array.isArray(t.craft_tags) && t.craft_tags.length) push(t.craft_tags);
      else push(extractCraft(Array.isArray(t.element_tags) ? t.element_tags : []));
      return vals;
    }
    if (dimKey === "style_tags") {
      push(t.style_tags);
      push(t.fit_tags);              /* 版型标签形如「领型·圆领」，带前缀更利于阅读 */
      return vals;
    }
    if (dimKey === "shoot_tags") {
      push(t.shoot_tags);
      push(t.visual_tags);           /* 画面视觉：背景 / 构图 / 呈现主体 */
      return vals;
    }
    push(t[dimKey]);
    return vals;
  }

  function extractCraft(el) {
    var out = [];
    (el || []).forEach(function (x) {
      var s = String(x || "");
      CRAFT_WORDS.forEach(function (w) { if (s.indexOf(w) >= 0) out.push(w); });
    });
    return out;
  }

  /* 单期的维度计数：{ dimKey: { 标签: 次数 } } */
  function dimCount(cards, tagMap) {
    var m = {};
    cards.forEach(function (c) {
      var t = tagFor(tagMap, c.url);
      DIMS.forEach(function (d) {
        if (!m[d.key]) m[d.key] = {};
        valsOf(t, d.key).forEach(function (v) { m[d.key][v] = (m[d.key][v] || 0) + 1; });
      });
    });
    return m;
  }

  /* 打标覆盖率：有任一维度标签的图 / 总图数。口径页必须写明，否则维度结论会被误读 */
  function coverOf(cards, tagMap) {
    var has = 0;
    cards.forEach(function (c) {
      var t = tagFor(tagMap, c.url);
      var any = ["style_tags", "element_tags", "scene_tags", "shoot_tags", "skin_tags", "category",
                 "visual_tags", "craft_tags", "fit_tags", "culture_tags", "psych_tags", "festival_tags"].some(function (k) {
        return Array.isArray(t[k]) ? t[k].length > 0 : !!t[k];
      });
      if (any) has++;
    });
    return { has: has, total: cards.length, pct: pctOf(has, cards.length) };
  }

  /* 某张图是否带某个维度标签（工艺走"元素里含该词"） */
  function hasTag(tagMap, url, dimKey, tag) {
    var t = tagFor(tagMap, url);
    if (dimKey === "craft") {
      var cs = Array.isArray(t.craft_tags) ? t.craft_tags : [];
      if (cs.map(String).indexOf(String(tag)) >= 0) return true;
      var el = Array.isArray(t.element_tags) ? t.element_tags : [];
      return el.some(function (x) { return String(x || "").indexOf(tag) >= 0; });
    }
    return valsOf(t, dimKey).indexOf(String(tag)) >= 0;
  }

  /* 找出带某标签的卡片（保持页面上原有的位次顺序） */
  function tagCards(cards, tagMap, dimKey, tag) {
    return (cards || []).filter(function (c) { return hasTag(tagMap, c.url, dimKey, tag); });
  }

  /* 两周各维度对比：按变化幅度排序，报告里先看到"变了的" */
  function dimensions(prevCards, curCards, tagMap) {
    var a = dimCount(prevCards, tagMap), b = dimCount(curCards, tagMap);
    return DIMS.map(function (d) {
      var ma = a[d.key] || {}, mb = b[d.key] || {};
      var keys = Object.keys(ma).concat(Object.keys(mb)).filter(function (v, i, arr) { return arr.indexOf(v) === i; });
      var rows = keys.map(function (k) {
        var na = ma[k] || 0, nb = mb[k] || 0;
        var pa = pctOf(na, prevCards.length), pb = pctOf(nb, curCards.length);
        return { tag: k, prev: na, cur: nb, pa: pa, pb: pb, delta: Math.round((pb - pa) * 10) / 10 };
      });
      rows.sort(function (x, y) { return Math.abs(y.delta) - Math.abs(x.delta) || y.cur - x.cur; });
      return { key: d.key, zh: d.zh, hint: d.hint, rows: rows };
    });
  }

  /* ---------------------------------------------------------------- 分析 */
  function analyze(data, tagMap) {
    var cols = (data && data.cols) || [];
    var res = { cols: [], pair: null, ok: false, reason: "" };
    res.stats = cols.map(function (c) {
      return { name: c.name, n: c.cards.length, spec: c.spec };
    });
    if (cols.length < 2) {
      res.reason = cols.length ? "只检测到 1 列：请把对比列数设为 2 列以上（周 vs 周）。" : "当前没有可对比的列，请选择周次后重试。";
      return res;
    }
    /* 相邻两周对比：取最后两列（界面按时间顺序排列，最后一列＝本期，前一列＝上期） */
    var cur = cols[cols.length - 1], prev = cols[cols.length - 2];
    var mapPrev = {}, mapCur = {};
    prev.cards.forEach(function (c) { if (!mapPrev[c.url]) mapPrev[c.url] = c; });
    cur.cards.forEach(function (c) { if (!mapCur[c.url]) mapCur[c.url] = c; });

    var added = cur.cards.filter(function (c) { return !mapPrev[c.url]; });
    var dropped = prev.cards.filter(function (c) { return !mapCur[c.url]; });
    var kept = cur.cards.filter(function (c) { return !!mapPrev[c.url]; });
    var up = [], down = [];
    kept.forEach(function (c) {
      var before = mapPrev[c.url].rank;
      var delta = before - c.rank;         /* 正数＝位次上升 */
      var row = { url: c.url, title: c.title, cat: c.cat, before: before, now: c.rank, delta: delta };
      if (delta > 0) up.push(row); else if (delta < 0) down.push(row);
    });
    up.sort(function (a, b) { return b.delta - a.delta; });
    down.sort(function (a, b) { return a.delta - b.delta; });

    /* 类目结构（用图片 alt 里的叶子类目；取不到就归“未标注”） */
    function catCount(cards) {
      var m = {};
      cards.forEach(function (c) {
        var k = String(c.cat || "").trim() || "未标注";
        m[k] = (m[k] || 0) + 1;
      });
      return m;
    }
    var catPrev = catCount(prev.cards), catCur = catCount(cur.cards);
    var catKeys = {};
    Object.keys(catPrev).concat(Object.keys(catCur)).forEach(function (k) { catKeys[k] = 1; });
    var cats = Object.keys(catKeys).map(function (k) {
      return { cat: k, prev: catPrev[k] || 0, cur: catCur[k] || 0, delta: (catCur[k] || 0) - (catPrev[k] || 0) };
    }).sort(function (a, b) { return b.cur - a.cur || b.delta - a.delta; });

    var baseN = prev.cards.length || 0;
    res.pair = {
      prev: prev.name, cur: cur.name,
      prevN: prev.cards.length, curN: cur.cards.length,
      prevCards: prev.cards, curCards: cur.cards,   /* 图片对照墙要用（prev/cur 存的是列名） */
      added: added, dropped: dropped, kept: kept,
      up: up, down: down,
      keepRate: baseN ? Math.round(kept.length / baseN * 1000) / 10 : 0,
      addRate: cur.cards.length ? Math.round(added.length / cur.cards.length * 1000) / 10 : 0,
      cats: cats,
      dims: dimensions(prev.cards, cur.cards, tagMap || {}),
      tagMap: tagMap || {},
      coverPrev: coverOf(prev.cards, tagMap || {}),
      coverCur: coverOf(cur.cards, tagMap || {}),
      churn: kept.length + added.length + dropped.length
    };
    res.ok = true;
    return res;
  }

  /* ------------------------------------------------------- 文案（只要分析） */
  function verdicts(a) {
    var p = a.pair, out = [];
    if (p.added.length || p.dropped.length) {
      out.push("两周之间有 " + p.added.length + " 款新上榜、" + p.dropped.length + " 款掉榜，重合 " + p.kept.length
        + " 款，榜单留存率 " + p.keepRate + "%。");
    } else {
      out.push("两周榜单完全一致（各 " + p.curN + " 款），没有新增与掉榜。");
    }
    if (p.curN && p.prevN) {
      var diff = p.curN - p.prevN;
      out.push("样本量由 " + p.prevN + " 款变为 " + p.curN + " 款"
        + (diff === 0 ? "，与上期持平。" : (diff > 0 ? "，增加 " + diff + " 款。" : "，减少 " + (-diff) + " 款。")));
    }
    if (p.up.length || p.down.length) {
      var top = p.up[0], bot = p.down[0];
      var bits = [];
      if (top) bits.push("位次上升最多的是第 " + top.before + " 位升至第 " + top.now + " 位（+" + top.delta + " 位）");
      if (bot) bits.push("下滑最多的是第 " + bot.before + " 位降至第 " + bot.now + " 位（" + bot.delta + " 位）");
      out.push(bits.join("；") + "。共 " + p.up.length + " 款位次上升、" + p.down.length + " 款下滑。");
    }
    if (p.cats.length) {
      var grew = p.cats.filter(function (c) { return c.delta > 0; })[0];
      var fell = p.cats.slice().sort(function (x, y) { return x.delta - y.delta; })[0];
      var bits2 = ["本期占比最高的是「" + p.cats[0].cat + "」(" + p.cats[0].cur + " 款)"];
      if (grew) bits2.push("增量最多的是「" + grew.cat + "」(+" + grew.delta + ")");
      if (fell && fell.delta < 0) bits2.push("减量最多的是「" + fell.cat + "」(" + fell.delta + ")");
      out.push(bits2.join("，") + "。");
    }
    /* 六个视觉/结构维度：只陈述"哪类变多、哪类变少"，幅度门槛 3pt 且两周合计至少 2 次 */
    (p.dims || []).forEach(function (dim) {
      if (!dim.rows.length) return;
      var ch = dim.rows.filter(function (r) { return Math.abs(r.delta) >= 3 && (r.prev + r.cur) >= 2; });
      if (!ch.length) return;
      var rise = ch.filter(function (r) { return r.delta > 0; }).slice(0, 2);
      var fall = ch.filter(function (r) { return r.delta < 0; }).slice(0, 2);
      var seg = [];
      if (rise.length) seg.push(rise.map(function (r) { return r.tag + "（+" + r.delta.toFixed(1) + "pt）"; }).join("、") + " 上升");
      if (fall.length) seg.push(fall.map(function (r) { return r.tag + "（" + r.delta.toFixed(1) + "pt）"; }).join("、") + " 下降");
      if (seg.length) out.push(dim.zh + "：" + seg.join("；") + "。");
    });
    var low = Math.min(p.coverPrev ? p.coverPrev.pct : 0, p.coverCur ? p.coverCur.pct : 0);
    if (low < 60) {
      out.push("注意：打标覆盖率偏低（最低一期 " + low + "%），以上维度结论的置信度受限，建议先在后台补齐打标再复看。");
    }
    return out;
  }

  /* ---------------------------------------------------------------- 绘图工具 */
  function slide(pptx, spec) {
    var s = pptx.addSlide();
    s.background = { color: COL.bg };
    return s;
  }
  function titleBar(s, spec, t, sub) {
    s.addText(String(t || ""), { x: 0.5, y: 0.34, w: spec.w - 1.0, h: 0.5, fontSize: 22, bold: true, color: COL.ink, fontFace: FONT });
    if (sub) s.addText(String(sub), { x: 0.5, y: 0.82, w: spec.w - 1.0, h: 0.3, fontSize: 11, color: COL.sub, fontFace: FONT });
    s.addShape("rect", { x: 0.5, y: sub ? 1.14 : 0.9, w: spec.w - 1.0, h: 0.02, fill: { color: COL.line }, line: { color: COL.line } });
    return sub ? 1.3 : 1.06;
  }
  function table(s, rows, opt) {
    opt = opt || {};
    var y = opt.y || 1.3;
    s.addTable(rows, {
      x: opt.x || 0.5, y: y, w: opt.w || 12.3,
      colW: opt.colW,
      fontSize: opt.fontSize || 10,
      fontFace: FONT,
      color: COL.ink,
      border: { type: "solid", color: COL.line, pt: 0.5 },
      rowH: opt.rowH || 0.3,
      valign: "middle",
      fill: { color: COL.bg }
    });
  }
  function head(rows, cells) { rows.push(cells.map(function (c) { return { text: c, bold: true, color: "FFFFFF", fill: { color: COL.brand } }; })); }
  function row(rows, cells) { rows.push(cells.map(function (c) { return { text: String(c == null ? "" : c) }; })); }

  /* 维度配图墙：挑「变化最大且确实有图」的若干个标签，每个标签一排小图。
     取图规则：本期有就取本期（这才是"现在长什么样"），本期没有才退回上期，并在组标题注明。 */
  function dimPix(s, spec, a, dim) {
    var p = a.pair, tagMap = p.tagMap || {};
    if (!p.curCards && !p.prevCards) return 0;
    var picks = [];
    dim.rows.forEach(function (r) {
      if (picks.length >= DIM_TAGS) return;
      var cs = tagCards(p.curCards, tagMap, dim.key, r.tag);
      var from = "本期", list = cs;
      if (!list.length) { list = tagCards(p.prevCards, tagMap, dim.key, r.tag); from = "上期"; }
      if (list.length) picks.push({ tag: r.tag, list: list.slice(0, DIM_PICS), from: from, total: list.length, delta: r.delta });
    });
    if (!picks.length) {
      s.addText("该维度的图片还没有打标，暂无法配图（在后台补齐打标后会出现）。",
        { x: 0.6, y: 4.3, w: spec.w - 1.2, h: 0.4, fontSize: 11, color: COL.sub, fontFace: FONT });
      return 0;
    }
    var top = 4.05, gap = 0.12;
    var groupW = (spec.w - 1.0) / DIM_TAGS;
    var picW = Math.min(1.15, (groupW - 0.2 - (DIM_PICS - 1) * 0.08) / DIM_PICS);
    var picH = picW * 1.25;
    picks.forEach(function (g, gi) {
      var baseX = 0.5 + gi * groupW;
      s.addText(g.tag + "　" + g.from + " " + g.total + " 张" + (g.delta ? "（" + (g.delta > 0 ? "+" : "") + g.delta.toFixed(1) + "pt）" : ""),
        { x: baseX, y: top - 0.3, w: groupW - 0.1, h: 0.26, fontSize: 11, bold: true, color: COL.brand, fontFace: FONT });
      g.list.forEach(function (c, i) {
        var cx = baseX + i * (picW + 0.08);
        try {
          s.addImage({ path: c.url, x: cx, y: top, w: picW, h: picH, sizing: { type: "cover", w: picW, h: picH } });
        } catch (e) { /* 取不到像素就跳过这一张，不中断成稿 */ }
        s.addText("#" + c.rank + " " + String(c.title || "").slice(0, 10),
          { x: cx, y: top + picH + 0.01, w: picW, h: 0.22, fontSize: 7, color: COL.sub, fontFace: FONT });
      });
    });
    s.addText("小图说明：按标签分组，优先取本期代表款（本期没有才取上期），每张上方标位次；" +
      "仅展示变化最大的 " + picks.length + " 个标签。",
      { x: 0.5, y: spec.h - 0.45, w: spec.w - 1.0, h: 0.25, fontSize: 9, color: COL.sub, fontFace: FONT });
    return picks.length;
  }

  /* 图片对照墙：两周并排，每列同一批图（按各自位次顺序） */
  function wall(s, spec, a, budget) {
    var p = a.pair;
    var n = Math.min(MAX_WALL, Math.max((p.prevCards || []).length, (p.curCards || []).length));
    if (!n) return 0;
    var top = 1.45, bottom = spec.h - 0.5;
    var rows = Math.min(n, Math.max(1, Math.floor((bottom - top) / (budget.boxH + 0.32))));
    var colsPerWeek = 1;
    var boxW = Math.min(1.5, (spec.w - 1.0 - 0.6) / (2 * 2) - 0.2 / 2);
    var shown = Math.min(n, rows * colsPerWeek);
    [["上期 " + p.prev, p.prevCards || []], ["本期 " + p.cur, p.curCards || []]].forEach(function (grp, gi) {
      var baseX = 0.5 + gi * ((spec.w - 1.0) / 2);
      s.addText(grp[0], { x: baseX, y: top - 0.34, w: (spec.w - 1.0) / 2, h: 0.28, fontSize: 12, bold: true, color: COL.brand, fontFace: FONT });
      grp[1].slice(0, shown).forEach(function (c, i) {
        var cx = baseX + (i % 2) * (boxW + 0.16);
        var cy = top + Math.floor(i / 2) * (budget.boxH + 0.32);
        try {
          s.addImage({ path: c.url, x: cx, y: cy, w: boxW, h: budget.boxH, sizing: { type: "cover", w: boxW, h: budget.boxH } });
        } catch (e) { /* 站外图 / 取不到像素：放过，不中断生成 */ }
        s.addText("#" + c.rank + " " + (c.title || "").slice(0, 16), {
          x: cx, y: cy + budget.boxH + 0.01, w: boxW, h: 0.22, fontSize: 7, color: COL.sub, fontFace: FONT
        });
      });
    });
    return shown;
  }

  /* ---------------------------------------------------------------- 组装 */
  function assemble(pptx, a, opt) {
    var spec = SPECS[opt && opt.spec] || SPECS.wide;
    var p = a.pair;
    var scope = (opt && opt.scope) || "";

    /* ① 封面 */
    var s = slide(pptx, spec);
    s.addText("周对比分析报告", { x: 0.9, y: 2.2, w: spec.w - 1.8, h: 0.9, fontSize: 40, bold: true, color: COL.ink, fontFace: FONT });
    s.addText(p.prev + "  →  " + p.cur, { x: 0.95, y: 3.15, w: spec.w - 1.9, h: 0.5, fontSize: 20, color: COL.brand, fontFace: FONT });
    s.addShape("rect", { x: 0.95, y: 3.8, w: 2.2, h: 0.035, fill: { color: COL.brand }, line: { color: COL.brand } });
    if (scope) s.addText(scope, { x: 0.95, y: 4.0, w: spec.w - 1.9, h: 0.5, fontSize: 12, color: COL.sub, fontFace: FONT });
    s.addText("生成时间 " + (opt && opt.nowText ? opt.nowText : ""), { x: 0.95, y: spec.h - 0.9, w: spec.w - 1.9, h: 0.3, fontSize: 10, color: COL.sub, fontFace: FONT });

    /* ② 样本与统计口径 */
    s = slide(pptx, spec);
    var y = titleBar(s, spec, "样本与统计口径", "本报告的取数范围与判定规则，便于复现");
    var r0 = [];
    head(r0, ["项", "说明"]);
    row(r0, ["对比期次", p.prev + "（上期） → " + p.cur + "（本期）"]);
    row(r0, ["样本量", "上期 " + p.prevN + " 款，本期 " + p.curN + " 款"]);
    row(r0, ["筛选范围", scope || "当前页面筛选条件"]);
    row(r0, ["新上榜", "本期出现、上期未出现（按图片地址判定同一款）"]);
    row(r0, ["掉榜", "上期出现、本期未出现"]);
    row(r0, ["位次变化", "以两列在页面上的实际排列顺序为位次（第 1 位起），上升为正、下滑为负"]);
    row(r0, ["类目结构", "取每款图片的叶子类目，未标注的归入「未标注」"]);
    row(r0, ["维度来源", "款式 / 元素 / 场景 / 主图视觉 / 肤色 / 类目 取自图片打标；二次工艺从元素标签中按工艺词抽取"]);
    row(r0, ["维度口径", "一图可带多个标签，各维度占比之和可能超过 100%；差异以「百分点（pt）」表示"]);
    row(r0, ["打标覆盖率", "上期 " + (p.coverPrev ? p.coverPrev.has + "/" + p.coverPrev.total + "（" + p.coverPrev.pct + "%）" : "—")
      + "　本期 " + (p.coverCur ? p.coverCur.has + "/" + p.coverCur.total + "（" + p.coverCur.pct + "%）" : "—")]);
    table(s, r0, { y: y, colW: [2.6, 9.7], fontSize: 10.5, rowH: 0.36 });

    /* ③ 核心结论 */
    s = slide(pptx, spec);
    y = titleBar(s, spec, "核心结论", "由两周数据直接得出的变化，不含任何建议");
    verdicts(a).forEach(function (t, i) {
      s.addShape("rect", { x: 0.6, y: y + i * 1.05, w: 0.06, h: 0.8, fill: { color: COL.brand }, line: { color: COL.brand } });
      s.addText(t, { x: 0.85, y: y + i * 1.05, w: spec.w - 1.5, h: 0.8, fontSize: 13, color: COL.ink, fontFace: FONT, valign: "middle" });
    });

    /* ④ 两周总览 */
    s = slide(pptx, spec);
    y = titleBar(s, spec, "两周总览", "数量、重合与流动");
    var r1 = [];
    head(r1, ["指标", p.prev, p.cur, "变化"]);
    row(r1, ["榜单款数", p.prevN, p.curN, (p.curN - p.prevN >= 0 ? "+" : "") + (p.curN - p.prevN)]);
    row(r1, ["重合款数", p.kept.length, p.kept.length, "—"]);
    row(r1, ["新上榜", "—", p.added.length, "占本期 " + p.addRate + "%"]);
    row(r1, ["掉榜", p.dropped.length, "—", "—"]);
    row(r1, ["留存率", "—", p.keepRate + "%", "重合 / 上期"]);
    row(r1, ["位次上升 / 下滑", "—", p.up.length + " / " + p.down.length, "—"]);
    table(s, r1, { y: y, colW: [3.4, 2.6, 2.6, 3.7], fontSize: 11, rowH: 0.42 });

    /* ⑤⑥ 新上榜 / 掉榜 */
    [["新上榜清单", p.added, "本期新进入榜单的款式"], ["掉榜清单", p.dropped, "上期在榜、本期已不在榜单"]].forEach(function (grp) {
      s = slide(pptx, spec);
      y = titleBar(s, spec, grp[0], grp[2] + "（共 " + grp[1].length + " 款）");
      if (!grp[1].length) {
        s.addText("本期没有" + grp[0].replace("清单", "") + "。", { x: 0.6, y: y + 0.3, w: spec.w - 1.2, h: 0.5, fontSize: 13, color: COL.sub, fontFace: FONT });
        return;
      }
      var rr = [];
      head(rr, ["位次", "款号 / 标题", "类目"]);
      grp[1].slice(0, MAX_ROWS).forEach(function (c) {
        row(rr, ["#" + c.rank, (c.title || "—").slice(0, 60), c.cat || "—"]);
      });
      table(s, rr, { y: y, colW: [1.2, 8.2, 2.9], fontSize: 10, rowH: 0.26 });
      if (grp[1].length > MAX_ROWS) {
        s.addText("另有 " + (grp[1].length - MAX_ROWS) + " 款未列出", { x: 0.5, y: spec.h - 0.55, w: spec.w - 1.0, h: 0.3, fontSize: 10, color: COL.sub, fontFace: FONT });
      }
    });

    /* ⑦⑧ 位次上升 / 下降 */
    [["位次上升榜", p.up, "上期 → 本期位次变化为正"], ["位次下降榜", p.down, "上期 → 本期位次变化为负"]].forEach(function (grp) {
      s = slide(pptx, spec);
      y = titleBar(s, spec, grp[0], grp[2] + "（共 " + grp[1].length + " 款）");
      if (!grp[1].length) {
        s.addText("本期没有符合条件的款式。", { x: 0.6, y: y + 0.3, w: spec.w - 1.2, h: 0.5, fontSize: 13, color: COL.sub, fontFace: FONT });
        return;
      }
      var rr2 = [];
      head(rr2, ["上期位次", "本期位次", "变化", "款号 / 标题"]);
      grp[1].slice(0, MAX_ROWS).forEach(function (c) {
        row(rr2, ["#" + c.before, "#" + c.now, (c.delta > 0 ? "+" : "") + c.delta, (c.title || "—").slice(0, 52)]);
      });
      table(s, rr2, { y: y, colW: [1.6, 1.6, 1.4, 7.7], fontSize: 10, rowH: 0.26 });
    });

    /* ⑨ 类目结构变化 */
    s = slide(pptx, spec);
    y = titleBar(s, spec, "类目结构变化", "两年周各叶子类目的款数对比");
    if (!p.cats.length) {
      s.addText("未取到类目信息。", { x: 0.6, y: y + 0.3, w: spec.w - 1.2, h: 0.5, fontSize: 13, color: COL.sub, fontFace: FONT });
    } else {
      var rr3 = [];
      head(rr3, ["类目", "上期", "本期", "变化"]);
      p.cats.slice(0, MAX_ROWS).forEach(function (c) {
        row(rr3, [c.cat, c.prev, c.cur, (c.delta > 0 ? "+" : "") + (c.delta || 0)]);
      });
      table(s, rr3, { y: y, colW: [6.3, 2.0, 2.0, 2.0], fontSize: 10, rowH: 0.26 });
    }

    /* ⑩ 六个维度：款式 / 印花与元素 / 二次工艺 / 场景构成 / 主图视觉 / 肤色 —— 每维一页 */
    (p.dims || []).forEach(function (dim) {
      s = slide(pptx, spec);
      var sub = "口径：" + dim.hint + "；按变化幅度排序，差异单位＝百分点（pt）";
      if (dim.key === "craft") sub += "　（工艺词从元素标签中抽取，与上一页有重叠属正常）";
      y = titleBar(s, spec, dim.zh + "：两周分布差异", sub);
      if (!dim.rows.length) {
        s.addText("该维度两周都没有打标数据，无法比较（先在后台补齐打标即可出现）。",
          { x: 0.6, y: y + 0.3, w: spec.w - 1.2, h: 0.6, fontSize: 13, color: COL.sub, fontFace: FONT });
        return;
      }
      /* 上：标签分布表（配图要占下半页，行数收敛到 8 行） */
      var rowsShown = DIM_ROWS;
      var rd = [];
      head(rd, ["标签", "上期 " + p.prev, "本期 " + p.cur, "占比差（pt）"]);
      dim.rows.slice(0, rowsShown).forEach(function (r) {
        row(rd, [r.tag, r.prev + "（" + r.pa + "%）", r.cur + "（" + r.pb + "%）", (r.delta > 0 ? "+" : "") + r.delta.toFixed(1)]);
      });
      table(s, rd, { y: y, colW: [5.6, 2.2, 2.2, 2.3], fontSize: 10, rowH: 0.24 });
      if (dim.rows.length > rowsShown) {
        s.addText("另有 " + (dim.rows.length - rowsShown) + " 个标签未列出",
          { x: 6.6, y: y + 0.24 * (rowsShown + 1) + 0.04, w: 6.2, h: 0.24, fontSize: 9, color: COL.sub, fontFace: FONT, align: "right" });
      }
      /* 下：按标签分组的配图墙 —— 一眼看到"这一类长什么样" */
      dimPix(s, spec, a, dim);
    });

    /* ⑪ 图片对照墙 */
    s = slide(pptx, spec);
    y = titleBar(s, spec, "图片对照墙", "左：上期　右：本期（按各自位次排列）");
    var shown = wall(s, spec, a, { boxH: Math.max(0.9, (spec.h - 2.0) / 4) });
    if (!shown) s.addText("没有可用于对照的图片。", { x: 0.6, y: y + 0.3, w: spec.w - 1.2, h: 0.5, fontSize: 13, color: COL.sub, fontFace: FONT });

    return pptx;
  }

  /* ---------------------------------------------------------------- 入口 */
  function loadPptx(v) {
    if (window.PptxGenJS) return Promise.resolve(true);
    var qs = v ? ("?v=" + v) : "";
    return ["vendor/jszip.min.js", "vendor/pptxgen.min.js"].reduce(function (p, src) {
      return p.then(function (ok) {
        if (ok === false) return false;
        if (window.PptxGenJS) return true;
        return new Promise(function (res) {
          var s = document.createElement("script");
          s.src = src + qs;
          s.onload = function () { res(true); };
          s.onerror = function () { res(false); };
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve(true)).then(function () { return !!window.PptxGenJS; });
  }

  function fileName(a, now) {
    function d2(n) { return (n < 10 ? "0" : "") + n; }
    var stamp = now.getFullYear() + d2(now.getMonth() + 1) + d2(now.getDate());
    var nm = ("周对比分析_" + (a && a.pair ? a.pair.prev + "-" + a.pair.cur : "")).replace(/[\\/:*?"<>|\s]+/g, "_");
    return nm + "_" + stamp + ".pptx";
  }

  /* run(opts) → Promise<{ok, reason, name, pages}>
     opts: { root, spec, scope, nowText, v, onProgress(txt, pct), tagOf(urls)->Promise<map> } */
  function run(opts) {
    opts = opts || {};
    var prog = opts.onProgress || function () { };
    var data = collect(opts.root);
    var urls = [];
    data.cols.forEach(function (c) { c.cards.forEach(function (x) { urls.push(x.url); }); });
    prog("正在读取图片打标维度…", 8);
    /* 取不到打标数据时不阻断：只是维度页显示"无打标数据"，数据类页面照常出 */
    return Promise.resolve()
      .then(function () { return opts.tagOf ? opts.tagOf(urls) : null; })
      .then(function (tagMap) { return tagMap || {}; }, function () { return {}; })
      .then(function (tagMap) {
        var a = analyze(data, tagMap);
        if (!a.ok) return { ok: false, reason: a.reason };
        prog("正在加载导出组件…", 22);
        return loadPptx(opts.v).then(function (ready) {
          if (!ready) return { ok: false, reason: "导出组件加载失败，请刷新页面后重试。" };
          prog("正在组装报告…", 62);
          var pptx = new window.PptxGenJS();
          pptx.layout = (opts.spec === "std") ? "LAYOUT_4x3" : "LAYOUT_16x9";
          assemble(pptx, a, { spec: opts.spec || "wide", scope: opts.scope || data.scope, nowText: opts.nowText || "" });
          var name = fileName(a, new Date());
          var pages = 10 + (a.pair.dims || []).length;
          return Promise.resolve(pptx.writeFile({ fileName: name })).then(function () {
            prog("已生成：" + name, 100);
            return { ok: true, name: name, pages: pages, analysis: a };
          });
        }).catch(function () {
          return { ok: false, reason: "生成失败，请重试。" };
        });
      });
  }

  window.WeekReport = {
    collect: collect, analyze: analyze, verdicts: verdicts,
    assemble: assemble, run: run, fileName: fileName,
    dimensions: dimensions, dimCount: dimCount, coverOf: coverOf, tagFor: tagFor,
    hasTag: hasTag, tagCards: tagCards, dimPix: dimPix,
    DIMS: DIMS, CRAFT_WORDS: CRAFT_WORDS,
    _: { SPECS: SPECS, MAX_ROWS: MAX_ROWS, MAX_WALL: MAX_WALL, wall: wall, table: table, titleBar: titleBar }
  };
})();