/* ============================================================================
 * report.js —— 前台「生成报告」：导出 PDF / PPT（仅超级管理员可见）
 *
 * 目标：网页上看到什么排版，导出的报告就是这个排版。
 *   · PDF：用浏览器原生打印生成 —— 矢量文字、中文可搜索、可打印存档，
 *          排版由报表专用样式表按所选画幅（A3/A4）重新分栏，一页页输出。
 *   · PPT：真 .pptx 文件 —— 封面 + 整体对照 + 每列一页（图片形式，与网页一致）
 *          + 可编辑明细表（原生文本，可在 PowerPoint 里直接改）。
 *
 * 依赖（按需懒加载，平时不下载）：
 *   vendor/html2canvas.min.js —— 把对比池抓成图片（只在生成 PPT 时加载）
 *   vendor/pptxgen.min.js     —— 生成 .pptx（只在生成 PPT 时加载）
 *
 * 权限：只有超级管理员能看到并使用本功能（按钮默认隐藏）。
 * ==========================================================================*/
(function () {
  "use strict";

  /* ---------------- 小工具 ---------------- */
  function $(s) { return document.querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function fmtTime(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
      + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function fmtDate(d) { return "" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }

  /* 资源版本号：跟当前页面 script 标签上的 ?v= 保持一致 */
  function assetV() {
    var s = document.querySelector('script[src*="js/report.js"]');
    var m = s && String(s.getAttribute("src") || "").match(/[?&]v=([^&]+)/);
    return m ? m[1] : "";
  }

  /* ---------------- 画幅规格 ----------------
   * PDF：毫米 + 每页分几栏（cols）+ 每栏里卡片排几列（inner）
   * PPT：英寸（PptxGenJS 单位） */
  var PDF_SPECS = {
    a3h: { name: "A3 横版", desc: "大图最清晰，推荐", page: "A3 landscape", margin: 12, cols: 4, inner: 3 },
    a4h: { name: "A4 横版", desc: "普通打印机常用", page: "A4 landscape", margin: 10, cols: 3, inner: 2 },
    a4v: { name: "A4 竖版", desc: "普通打印机纵向", page: "A4 portrait", margin: 10, cols: 2, inner: 2 }
  };
  var PPT_SPECS = {
    wide: { name: "16:9 宽屏", desc: "PPT / 投屏标准，推荐", w: 13.333, h: 7.5 },
    std: { name: "4:3", desc: "老版本演示模板", w: 10, h: 7.5 }
  };
  var FONT = "Microsoft YaHei";
  var ROW_PER_SLIDE = 20;      // 明细表每页行数
  var TABLE_MAX_ROWS = 200;    // 明细表最多逐条列出多少行（超出只提示，不无限翻页）
  var TBL_BOX = { x: 0.4, y: 1.0, w: 0 };

  /* ---------------- 运行期配置（由 rank.js 注入） ---------------- */
  var CFG = {
    state: null,        // function(): 当前筛选口径（类目/站点/期次/标签…）
    itemOf: null,       // function(url): 由图片地址取条目详情
    isSuper: null,      // function(): 是否超级管理员
    expandAll: null,    // function(): 把每列展开到上限
    poolsEl: null,      // function(): 对比池容器（#rk-pools）
    super: false
  };
  var FMT = "pdf";      // pdf | ppt
  var SPEC_PDF = "a3h";
  var SPEC_PPT = "wide";
  var SCOPE = "now";    // now | all
  var BUSY = false;

  /* ==========================================================================
   *  一、读取「屏幕上正在显示的内容」（报表内容 = 所见内容，从 DOM 取，避免两套口径）
   * ========================================================================*/
  function readPools() {
    var wrap = CFG.poolsEl ? CFG.poolsEl() : null;
    if (!wrap) return [];
    return $$(".rk-pool", wrap).map(function (p) {
      var nameEl = p.querySelector(".rk-pool-name span");
      var cntEl = p.querySelector(".rk-pool-name .rk-n");
      var metaEl = p.querySelector(".rk-pool-meta");
      var cards = $$(".rk-card", p).map(function (c) {
        var url = c.getAttribute("data-url") || "";
        var it = {};
        try { it = (CFG.itemOf ? CFG.itemOf(url) : null) || {}; } catch (e) { it = {}; }
        var b = c.querySelector(".rk-badge");
        var mv = c.querySelector(".rk-move");
        return {
          url: url,
          site: it.site || "",
          period: it.period_label || "",
          cat: it.leaf_category || "",
          tag: b ? String(b.textContent || "").trim() : "",
          move: mv ? String(mv.textContent || "").trim() : ""
        };
      });
      return {
        name: (nameEl ? String(nameEl.textContent || "") : "").trim(),
        spec: (cntEl ? String(cntEl.textContent || "") : "").trim(),
        meta: (metaEl ? String(metaEl.textContent || "") : "").trim(),
        cards: cards
      };
    }).filter(function (p) { return p.name || p.cards.length; });
  }

  /* 本站图片服务域名（来自站点配置）：只有这个域名上的图能跨域读取、被画进 PPT */
  var IMG_HOST = (function () {
    try {
      var v = (window.CONFIG && window.CONFIG.WORKER_URL) || "";
      return String(v).replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
    } catch (e) { return ""; }
  })();

  function isSiteImg(u) {
    var v = String(u || "");
    if (!IMG_HOST || !/^https?:\/\//i.test(v)) return false;
    return v.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase() === IMG_HOST;
  }

  /* 站外图片数量：这些图无法进入 PPT 截图（PDF 不受影响），明细表页会附上图片地址 */
  function offSiteCount(pools) {
    var n = 0;
    (pools || []).forEach(function (p) {
      ((p && p.cards) || []).forEach(function (c) { if (c && c.url && !isSiteImg(c.url)) n++; });
    });
    return n;
  }

  /* 抓图前，把本站图片以跨域方式重新取一次：
     浏览器对同一张图会分「跨域 / 非跨域」两份缓存，直接抓非跨域那份会拿不到像素；
     重取一次可保证 PPT 截图稳定出图。同一张图只重取一次；站外图不重取（省请求）。 */
  async function prepCorsImages(node) {
    if (!node) return 0;
    var list = $$("img", node), hit = 0;
    list.forEach(function (im) {
      var src = im.getAttribute("src") || "";
      if (!isSiteImg(src)) return;
      if (im.dataset && im.dataset.rpCors === "1") return;
      hit++;
      if (im.dataset) im.dataset.rpCors = "1";
      im.crossOrigin = "anonymous";
      im.src = src;            // 同址重取一次，这一次走跨域模式
    });
    if (hit) await waitImages(node, 6000);
    return hit;
  }

  /* 是否有可导出内容：列存在但全部为空（一张图都没有）同样算无数据 */
  function contentTotal(pools) {
    return (pools || []).reduce(function (n, p) { return n + (p.cards ? p.cards.length : 0); }, 0);
  }
  function hasContent(pools) {
    return !!(pools && pools.length) && contentTotal(pools) > 0;
  }
  var NO_DATA_TXT = "当前筛选下没有可导出的内容：请先选好类目、站点与期次。";

  /* 一行口径说明（封面 / 报表页眉共用） */
  function stateLine(st) {
    if (!st) return "";
    var bits = [];
    if (st.modeLabel) bits.push(st.modeLabel);
    var place = st.group ? ("地区：" + st.group) : ((st.sites && st.sites.length) ? ("站点：" + st.sites.join("、")) : "");
    if (place) bits.push(place);
    if (st.periods && st.periods.length) bits.push("期次：" + st.periods.join("、"));
    if (st.tags) bits.push("趋势标签：" + st.tags);
    if (st.sizeLabel) bits.push("图幅：" + st.sizeLabel);
    return bits.join("　｜　");
  }

  /* ==========================================================================
   *  二、文件命名
   * ========================================================================*/
  function safeName(s) {
    var v = String(s == null ? "" : s)
      .replace(/[\\/:*?"<>|\r\n\t]+/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    return v.slice(0, 120) || "趋势上升榜";
  }
  function fileNameOf(st, ext, now) {
    st = st || {};
    var parts = [st.zone || "趋势上升榜"];
    if (st.cat && st.cat !== "全部") parts.push(st.cat);
    var place = st.group || ((st.sites && st.sites.length) ? st.sites.join("、") : "");
    if (place) parts.push(place);
    if (st.periods && st.periods.length) parts.push(st.periods.join("、"));
    parts.push(fmtDate(now || new Date()));
    return safeName(parts.join("_")) + "." + ext;
  }

  /* ==========================================================================
   *  三、PDF：排版 → 原生打印
   * ========================================================================*/
  function injectPageStyle(spec) {
    var id = "rp-page-style";
    var e = document.getElementById(id);
    if (!e) { e = document.createElement("style"); e.id = id; document.head.appendChild(e); }
    e.textContent = "@page{ size:" + spec.page + "; margin:" + spec.margin + "mm; }";
    return e;
  }

  function cardNode(c) {
    var fig = el("figure", "rp-card");
    var img = document.createElement("img");
    img.src = c.url || "";
    img.alt = c.cat || "榜单图片";
    img.setAttribute("loading", "eager");
    fig.appendChild(img);
    if (c.tag) fig.appendChild(el("span", "rp-badge", c.tag));
    if (c.move) fig.appendChild(el("span", "rp-move", c.move));
    return fig;
  }

  function buildSheet(spec, pools, st, now) {
    st = st || {};
    var sheet = el("div", "rp-sheet");
    sheet.id = "rp-sheet";
    sheet.style.setProperty("--rp-cols", spec.cols);
    sheet.style.setProperty("--rp-inner", spec.inner);

    var head = el("header", "rp-head");
    var left = el("div", "rp-h-l");
    var title = (st.zone || "趋势上升榜") + (st.cat && st.cat !== "全部" ? " · " + st.cat : "");
    left.appendChild(el("div", "rp-h-t", title));
    left.appendChild(el("div", "rp-h-s", stateLine(st)));
    head.appendChild(left);

    var right = el("div", "rp-h-r");
    right.appendChild(el("div", "rp-h-brand", "TREND BANK"));
    right.appendChild(el("div", "rp-h-time", fmtTime(now || new Date())));
    var total = pools.reduce(function (n, p) { return n + p.cards.length; }, 0);
    right.appendChild(el("div", "rp-h-total", "共 " + total + " 张"));
    head.appendChild(right);
    sheet.appendChild(head);

    var grid = el("div", "rp-grid");
    pools.forEach(function (p) {
      var sec = el("section", "rp-col");
      var ph = el("div", "rp-col-head");
      var nameWrap = el("div", "rp-col-title");
      nameWrap.appendChild(el("b", null, p.name));
      nameWrap.appendChild(el("span", "rp-col-n", p.spec || (p.cards.length + " 张")));
      ph.appendChild(nameWrap);
      if (p.meta) ph.appendChild(el("div", "rp-col-meta", p.meta));
      sec.appendChild(ph);

      var cards = el("div", "rp-cards");
      if (!p.cards.length) cards.appendChild(el("div", "rp-none", "该列暂无数据"));
      p.cards.forEach(function (c) { cards.appendChild(cardNode(c)); });
      sec.appendChild(cards);
      grid.appendChild(sec);
    });
    sheet.appendChild(grid);

    var foot = el("footer", "rp-foot");
    foot.appendChild(el("span", null, "TREND BANK · 趋势上升榜"));
    foot.appendChild(el("span", null, "本报告由前台「生成报告」导出 · 仅供内部使用 · 请勿外传"));
    sheet.appendChild(foot);
    return sheet;
  }

  function waitImages(root, timeout) {
    var imgs = $$("img", root);
    if (!imgs.length) return Promise.resolve();
    return new Promise(function (res) {
      var left = imgs.length, done = false;
      var timer = setTimeout(function () { if (!done) { done = true; res(); } }, timeout || 20000);
      function one() {
        if (done) return;
        left--;
        if (left <= 0) { done = true; clearTimeout(timer); res(); }
      }
      imgs.forEach(function (i) {
        i.addEventListener("load", one, { once: true });
        i.addEventListener("error", one, { once: true });
        if (i.complete) one();
      });
    });
  }

  async function makePDF(specKey) {
    var spec = PDF_SPECS[specKey] || PDF_SPECS.a3h;
    var pools = readPools();
    if (!hasContent(pools)) { setProgress(NO_DATA_TXT, 100, true); return; }
    setProgress("正在按网页排版生成报表…", 25);
    var now = new Date();
    var sheet = buildSheet(spec, pools, CFG.state ? CFG.state() : {}, now);
    injectPageStyle(spec);
    document.body.appendChild(sheet);
    document.body.classList.add("rp-printing");
    await waitImages(sheet, 25000);

    var cleaned = false;
    function done() {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener("afterprint", done);
      if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
      document.body.classList.remove("rp-printing");
    }
    setProgress("正在打开打印窗口：目标请选「另存为 PDF」。", 92);
    window.addEventListener("afterprint", done, { once: true });
    setTimeout(done, 120000);           // 兜底清理，防止样式残留
    try {
      window.print();
    } catch (e) {
      done();
      setProgress("打印窗口未能打开，请重试。", 100, true);
    }
  }

  /* ==========================================================================
   *  四、PPT：抓图 → 组装 .pptx
   * ========================================================================*/
  function fitBox(boxW, boxH, imgW, imgH) {
    if (!imgW || !imgH || !boxW || !boxH) return { x: 0, y: 0, w: boxW || 1, h: boxH || 1 };
    var r = Math.min(boxW / imgW, boxH / imgH);
    return { x: (boxW - imgW * r) / 2, y: (boxH - imgH * r) / 2, w: imgW * r, h: imgH * r };
  }

  function detailRows(pools) {
    var rows = [];
    pools.forEach(function (p) {
      p.cards.forEach(function (c, i) {
        rows.push([String(i + 1), p.name, c.site || "", c.period || "", c.cat || "", c.tag || "", c.move || "", c.url || ""]);
      });
    });
    return rows;
  }
  function splitRows(rows, perPage) {
    var per = perPage || ROW_PER_SLIDE, out = [];
    for (var i = 0; i < rows.length; i += per) out.push(rows.slice(i, i + per));
    return out;
  }

  /* 组装幻灯片（pptx 可为真实 PptxGenJS 实例，测试时也可为记录型替身） */
  function assemble(pptx, o) {
    var spec = o.spec, W = spec.w, H = spec.h;
    try {
      pptx.defineLayout({ name: "RP_LAYOUT", width: W, height: H });
      pptx.layout = "RP_LAYOUT";
    } catch (e) { /* 替身对象可忽略 */ }
    var st = o.state || {};
    var cursor = o.cursor || { i: 0 };
    function page(background) {
      var s = pptx.addSlide();
      s.background = { color: background || "FFFFFF" };
      return s;
    }

    /* 1) 封面 */
    var s1 = page("F7F6F3");
    s1.addText("TREND BANK · 趋势上升榜", {
      x: 0.7, y: 0.75, w: W - 1.4, h: 0.4, fontSize: 13, color: "8B7355", charSpacing: 3, fontFace: FONT
    });
    s1.addText((st.cat && st.cat !== "全部" ? st.cat : "趋势上升榜") + "　" + (st.group || ((st.sites || []).join(" / ")) || ""), {
      x: 0.7, y: 1.35, w: W - 1.4, h: 0.9, fontSize: spec.w > 12 ? 34 : 28, bold: true, color: "2C2C2C", fontFace: FONT
    });
    s1.addText(stateLine(st), {
      x: 0.7, y: 2.4, w: W - 1.4, h: 0.7, fontSize: 12, color: "8A857C", fontFace: FONT, lineSpacingMultiple: 1.4
    });
    var total = (o.pools || []).reduce(function (n, p) { return n + p.cards.length; }, 0);
    s1.addText("共 " + total + " 张　·　" + (o.pools || []).length + " 列　·　" + fmtTime(o.now || new Date()) + " 生成", {
      x: 0.7, y: H - 1.35, w: W - 1.4, h: 0.4, fontSize: 12, color: "2C2C2C", fontFace: FONT
    });
    s1.addText("本报告由前台「生成报告」导出 · 仅供内部使用 · 请勿外传", {
      x: 0.7, y: H - 0.85, w: W - 1.4, h: 0.35, fontSize: 10, color: "8A857C", fontFace: FONT
    });

    /* 2) 整体对照（整块对比池一张图，与网页完全一致） */
    if (o.shots && o.shots.all) {
      var s2 = page("FFFFFF");
      s2.addText("整体对照 · " + (st.cat && st.cat !== "全部" ? st.cat : "") + "（与网页排版一致）", {
        x: 0.4, y: 0.3, w: W - 0.8, h: 0.45, fontSize: 16, bold: true, color: "2C2C2C", fontFace: FONT
      });
      var sh0 = o.shots.all;
      var f0 = fitBox(W - 0.8, H - 1.35, sh0.w, sh0.h);
      s2.addImage({ data: sh0.data, x: 0.4 + f0.x, y: 1.05 + f0.y, w: f0.w, h: f0.h });
    }

    /* 3) 每列一页 */
    (o.pools || []).forEach(function (p, i) {
      var s = page("FFFFFF");
      var head = p.name + (p.spec ? " · " + p.spec : "") + (p.meta ? " · " + p.meta : "");
      s.addText(head, {
        x: 0.4, y: 0.3, w: W - 0.8, h: 0.45, fontSize: 15, bold: true, color: "2C2C2C", fontFace: FONT
      });
      var sh = (o.shots && o.shots.pools) ? o.shots.pools[i] : null;
      if (sh) {
        var f = fitBox(W - 0.8, H - 1.35, sh.w, sh.h);
        s.addImage({ data: sh.data, x: 0.4 + f.x, y: 1.05 + f.y, w: f.w, h: f.h });
      } else {
        s.addText("（本列图片未能抓取，可参考后面的明细表）", {
          x: 0.4, y: 1.2, w: W - 0.8, h: 0.4, fontSize: 12, color: "C25E5A", fontFace: FONT
        });
      }
    });

    /* 4) 明细表（原生文本，可在 PowerPoint 里直接编辑） */
    var rows = detailRows(o.pools || []);
    var shown = rows.slice(0, TABLE_MAX_ROWS);
    var header = ["序号", "列（站点 / 期次）", "站点", "期次", "类目", "趋势标签", "位次变化", "图片地址"];
    var headRow = header.map(function (h) {
      return { text: h, options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" } } };
    });
    splitRows(shown, ROW_PER_SLIDE).forEach(function (chunk, idx) {
      var s = page("FFFFFF");
      s.addText("明细表" + (idx === 0 ? "（可在 PowerPoint 中直接编辑）" : "（续）") + " · 第 " + (idx + 1) + " 页 / 共 " + Math.ceil(shown.length / ROW_PER_SLIDE) + " 页", {
        x: 0.4, y: 0.3, w: W - 0.8, h: 0.4, fontSize: 14, bold: true, color: "2C2C2C", fontFace: FONT
      });
      var body = chunk.map(function (r) { return r.map(function (c) { return { text: c }; }); });
      var boxW = W - 0.8;
      s.addTable([headRow].concat(body), {
        x: TBL_BOX.x, y: TBL_BOX.y, w: boxW,
        colW: [0.6, 2.4, 1.5, 1.2, 1.8, 1.6, 1.6].map(function (v, i, arr) {
          var sum = arr.reduce(function (a, b) { return a + b; }, 0);
          return boxW * v / sum;
        }),
        fontSize: 10, fontFace: FONT, color: "2C2C2C", valign: "middle",
        border: { type: "solid", pt: 0.5, color: "E5E1DA" }, autoPage: false
      });
    });
    if (rows.length > shown.length) {
      var sN = page("FFFFFF");
      sN.addText("另有 " + (rows.length - shown.length) + " 条未逐条列出（图片页已完整包含）。如需完整清单，请改用 PDF 导出。", {
        x: 0.4, y: 1.0, w: W - 0.8, h: 0.5, fontSize: 13, color: "8A857C", fontFace: FONT
      });
    }
    cursor.i = (pptx.slides ? pptx.slides.length : ((o.pools || []).length + 3));
    return pptx;
  }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { res(true); };
      s.onerror = function () { rej(new Error("load-fail")); };
      document.head.appendChild(s);
    });
  }
  async function ensureLibs() {
    var v = assetV();
    var q = v ? ("?v=" + v) : "";
    /* 顺序不能改：pptxgen 是 (JSZip) 形式的立即执行函数，必须先有 JSZip，否则报未定义 */
    try {
      if (!window.JSZip) await loadScript("vendor/jszip.min.js" + q);
      if (!window.html2canvas) await loadScript("vendor/html2canvas.min.js" + q);
      if (!window.PptxGenJS) await loadScript("vendor/pptxgen.min.js" + q);
    } catch (e) { /* 文件缺失/网络异常：统一落到下面的存在性判定，不向上抛 */ }
    /* 逐项判定：任何一个没就绪都算失败，交给调用方给出明确提示 */
    return !!(window.JSZip && window.html2canvas && window.PptxGenJS);
  }

  async function shoot(node) {
    if (!node || !window.html2canvas) return null;
    await prepCorsImages(node);
    node.classList.add("rp-capture");
    var w = node.scrollWidth, h = node.scrollHeight;
    var scale = Math.max(1, Math.min(2, 4000 / Math.max(w, h, 1)));
    var out = null;
    try {
      var cv = await window.html2canvas(node, {
        backgroundColor: "#ffffff", scale: scale, useCORS: true, allowTaint: false,
        logging: false, width: w, height: h,
        windowWidth: Math.max(document.documentElement.clientWidth || 0, w)
      });
      out = { data: cv.toDataURL("image/png"), w: cv.width, h: cv.height };
    } catch (e) {
      out = null;
    }
    node.classList.remove("rp-capture");
    return out;
  }

  async function makePPT(specKey) {
    var spec = PPT_SPECS[specKey] || PPT_SPECS.wide;
    var pools = readPools();
    if (!hasContent(pools)) { setProgress(NO_DATA_TXT, 100, true); return; }
    setProgress("正在加载导出组件…", 6);
    var ok = await ensureLibs();
    if (!ok) { setProgress("导出组件加载失败，请刷新页面重试。", 100, true); return; }

    var wrap = CFG.poolsEl ? CFG.poolsEl() : null;
    var poolEls = wrap ? $$(".rk-pool", wrap) : [];
    var shots = { all: null, pools: [] };

    setProgress("正在抓取「整体对照」图…", 14);
    shots.all = await shoot(wrap);
    for (var i = 0; i < pools.length; i++) {
      setProgress("正在抓取第 " + (i + 1) + " / " + pools.length + " 列…", 14 + Math.round((i + 1) / pools.length * 66));
      shots.pools.push(await shoot(poolEls[i]));
      await new Promise(function (r) { setTimeout(r, 40); });   // 让出主线程，避免页面卡死
    }

    setProgress("正在组装 PPT…", 88);
    var pptx = new window.PptxGenJS();
    assemble(pptx, { spec: spec, specKey: specKey, pools: pools, state: CFG.state ? CFG.state() : {}, shots: shots, now: new Date() });
    var name = fileNameOf(CFG.state ? CFG.state() : {}, "pptx", new Date());
    await pptx.writeFile({ fileName: name });
    var off = offSiteCount(pools);
    setProgress("已生成：" + name
      + (off ? "（其中 " + off + " 张为站外图片，截图里可能留空，明细表页已附图片地址）" : ""), 100);
  }

  /* ==========================================================================
   *  五、弹窗界面
   * ========================================================================*/
  function specButtons(host, specs, cur, attr) {
    if (!host) return;
    host.innerHTML = "";
    Object.keys(specs).forEach(function (k) {
      var b = el("button", "rp-opt" + (k === cur ? " on" : ""));
      b.type = "button";
      b.setAttribute(attr, k);
      b.appendChild(el("b", null, specs[k].name));
      b.appendChild(el("span", null, specs[k].desc));
      host.appendChild(b);
    });
  }

  function buildModal() {
    if ($("#rp-modal")) return;
    var m = el("div", "rp-modal hidden");
    m.id = "rp-modal";
    m.innerHTML = ''
      + '<div class="rp-mbox">'
      +   '<div class="rp-mhead">'
      +     '<div>'
      +       '<div class="rp-mtitle">生成报告</div>'
      +       '<div class="rp-msub">内容与你当前屏幕上的排版完全一致 —— 网页什么样，导出的报告就什么样。</div>'
      +     '</div>'
      +     '<button type="button" class="rp-mx" id="rp-close">×</button>'
      +   '</div>'
      +   '<div class="rp-sec">'
      +     '<div class="rp-lab">选择格式</div>'
      +     '<div class="rp-opts" id="rp-fmt">'
      +       '<button type="button" class="rp-opt on" data-fmt="pdf"><b>PDF（推荐）</b><span>矢量文字、中文可搜索、可直接打印或存档</span></button>'
      +       '<button type="button" class="rp-opt" data-fmt="ppt"><b>PPT（.pptx）</b><span>可编辑演示文件：封面 + 整体对照 + 每列一页图 + 明细表</span></button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="rp-sec" id="rp-sec-pdf">'
      +     '<div class="rp-lab">画幅（PDF）</div>'
      +     '<div class="rp-opts" id="rp-pdfspec"></div>'
      +   '</div>'
      +   '<div class="rp-sec hidden" id="rp-sec-ppt">'
      +     '<div class="rp-lab">画幅（PPT）</div>'
      +     '<div class="rp-opts" id="rp-pptspec"></div>'
      +   '</div>'
      +   '<div class="rp-sec">'
      +     '<div class="rp-lab">导出范围</div>'
      +     '<div class="rp-opts" id="rp-scope">'
      +       '<button type="button" class="rp-opt on" data-scope="now"><b>当前屏幕上的内容</b><span>最快，不额外拉取图片</span></button>'
      +       '<button type="button" class="rp-opt" data-scope="all"><b>每列全部条目</b><span>把每列展开到上限，会多取一批图片</span></button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="rp-act">'
      +     '<button type="button" class="rp-go" id="rp-go">生成</button>'
      +     '<button type="button" class="rp-ghost" id="rp-cancel">取消</button>'
      +   '</div>'
      +   '<div class="rp-prog hidden" id="rp-prog">'
      +     '<div class="rp-pbar"><i id="rp-pfill"></i></div>'
      +     '<div class="rp-ptxt" id="rp-ptxt"></div>'
      +   '</div>'
      +   '<div class="rp-tip" id="rp-tip"></div>'
      + '</div>';
    document.body.appendChild(m);

    m.addEventListener("click", function (e) { if (e.target === m) closeModal(); });
    var x = $("#rp-close"); if (x) x.onclick = closeModal;
    var c = $("#rp-cancel"); if (c) c.onclick = closeModal;

    Array.prototype.forEach.call(m.querySelectorAll("[data-fmt]"), function (b) {
      b.onclick = function () {
        FMT = b.getAttribute("data-fmt");
        Array.prototype.forEach.call(m.querySelectorAll("[data-fmt]"), function (o) { o.classList.toggle("on", o === b); });
        var sp = $("#rp-sec-pdf"), st2 = $("#rp-sec-ppt");
        if (sp) sp.classList.toggle("hidden", FMT !== "pdf");
        if (st2) st2.classList.toggle("hidden", FMT !== "ppt");
        updateTip();
      };
    });
    Array.prototype.forEach.call(m.querySelectorAll("#rp-scope [data-scope]"), function (b) {
      b.onclick = function () {
        SCOPE = b.getAttribute("data-scope");
        Array.prototype.forEach.call(m.querySelectorAll("#rp-scope [data-scope]"), function (o) { o.classList.toggle("on", o === b); });
      };
    });
    var go = $("#rp-go"); if (go) go.onclick = generate;
  }

  function bindSpecHost(hostSel, specs, attr) {
    var host = $(hostSel);
    if (!host) return;
    host.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[" + attr + "]") : null;
      if (!b) return;
      var k = b.getAttribute(attr);
      if (attr === "data-pdfspec") SPEC_PDF = k; else SPEC_PPT = k;
      Array.prototype.forEach.call(host.querySelectorAll("[" + attr + "]"), function (o) { o.classList.toggle("on", o === b); });
    });
  }

  function updateTip() {
    var t = $("#rp-tip");
    if (!t) return;
    t.textContent = FMT === "pdf"
      ? "PDF：浏览器会弹出打印窗口，把「目标 / 打印机」选成「另存为 PDF」即可；建议在「更多设置」里勾选「背景图形」，效果最佳。"
      : "PPT：会生成一个真正的 .pptx 文件。图片页与网页排版一致（图片形式）；最后的「明细表」是原生文字，可在 PowerPoint 里直接编辑。";
  }

  function setProgress(txt, pct, isErr) {
    var box = $("#rp-prog"), fill = $("#rp-pfill"), t = $("#rp-ptxt");
    if (box) box.classList.remove("hidden");
    if (fill) fill.style.width = Math.max(0, Math.min(100, pct || 0)) + "%";
    if (t) { t.textContent = txt || ""; t.classList.toggle("bad", !!isErr); }
  }

  function openModal() {
    var m = $("#rp-modal");
    if (!m) return;
    var pools = readPools();
    setProgress("", 0);
    var box = $("#rp-prog"); if (box) box.classList.add("hidden");
    updateTip();
    if (!hasContent(pools)) setProgress(NO_DATA_TXT, 100, true);
    m.classList.remove("hidden");
  }
  function closeModal() {
    var m = $("#rp-modal");
    if (m) m.classList.add("hidden");
  }

  async function generate() {
    if (BUSY) return;
    BUSY = true;
    var go = $("#rp-go");
    if (go) { go.disabled = true; go.textContent = "生成中…"; }
    try {
      if (!hasContent(readPools())) { setProgress(NO_DATA_TXT, 100, true); return; }
      if (SCOPE === "all" && CFG.expandAll) {
        setProgress("正在展开每列全部条目…", 8);
        await CFG.expandAll();
      }
      if (FMT === "pdf") await makePDF(SPEC_PDF);
      else await makePPT(SPEC_PPT);
    } catch (e) {
      setProgress("导出失败，请重试。", 100, true);
    } finally {
      BUSY = false;
      if (go) { go.disabled = false; go.textContent = "生成"; }
    }
  }

  /* ==========================================================================
   *  六、对外接口
   * ========================================================================*/
  function init(o) {
    o = o || {};
    CFG.state = o.state || null;
    CFG.itemOf = o.itemOf || null;
    CFG.expandAll = o.expandAll || null;
    CFG.poolsEl = o.poolsEl || function () { return $("#rk-pools"); };
    CFG.isSuper = o.isSuper || null;

    buildModal();
    specButtons($("#rp-pdfspec"), PDF_SPECS, SPEC_PDF, "data-pdfspec");
    specButtons($("#rp-pptspec"), PPT_SPECS, SPEC_PPT, "data-pptspec");
    bindSpecHost("#rp-pdfspec", PDF_SPECS, "data-pdfspec");
    bindSpecHost("#rp-pptspec", PPT_SPECS, "data-pptspec");
    updateTip();

    var btn = document.querySelector(o.btn || "#rk-report-btn");
    if (!btn) return;

    // 权限：默认隐藏，确认是超级管理员后才显示
    btn.classList.add("hidden");
    btn.onclick = function () { if (!CFG.super) return; openModal(); };
    var p;
    try { p = CFG.isSuper ? CFG.isSuper() : false; } catch (e) { p = false; }
    Promise.resolve(p).then(function (ok) {
      CFG.super = !!ok;
      btn.classList.toggle("hidden", !CFG.super);
    }).catch(function () {
      CFG.super = false;
      btn.classList.add("hidden");
    });

    return true;
  }

  window.ReportKit = {
    init: init,
    open: openModal,
    close: closeModal,
    _: {
      PDF_SPECS: PDF_SPECS, PPT_SPECS: PPT_SPECS,
      readPools: readPools, buildSheet: buildSheet, injectPageStyle: injectPageStyle,
      cardNode: cardNode, stateLine: stateLine, safeName: safeName, fileNameOf: fileNameOf,
      fitBox: fitBox, detailRows: detailRows, splitRows: splitRows, assemble: assemble,
      hasContent: hasContent, contentTotal: contentTotal, NO_DATA_TXT: NO_DATA_TXT,
      isSiteImg: isSiteImg, offSiteCount: offSiteCount, prepCorsImages: prepCorsImages,
      waitImages: waitImages, setProgress: setProgress, openModal: openModal,
      makePDF: makePDF, makePPT: makePPT,
      cfg: CFG, getFmt: function () { return FMT; }, getScope: function () { return SCOPE; },
      ROW_PER_SLIDE: ROW_PER_SLIDE, TABLE_MAX_ROWS: TABLE_MAX_ROWS
    }
  };
})();