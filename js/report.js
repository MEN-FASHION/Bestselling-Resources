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
  function readPoolsFrom(root) {
    var wrap = root || (CFG.poolsEl ? CFG.poolsEl() : null);
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
  function readPools() { return readPoolsFrom(null); }

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
   *  四·B、天眼对比页 → PPT（真实图片 + 图片下方标签）
   *  --------------------------------------------------------------------------
   *  与上面「截图式」PPT 的区别：这里不再把整页拍成一张图片，
   *  而是把每一张图片都以「真实图片对象」放进幻灯片 —— 在 PowerPoint 里可以点开放大；
   *  标签放在该图片的正下方。默认「一列一页」，整页对比内容都在这一个 PPT 里。
   * ========================================================================*/
  var EYE_PPT = { maxImg: 600, maxW: 380, quality: 0.78, conc: 6 };
  var EYE_GRID = { minCols: 4, maxCols: 16, gap: 0.06, tagH: 0.34 };

  /* 独立进度条：天眼是全屏浮层，弹窗在里面不方便，改成右下角浮动小条 */
  function hud(show, txt, pct, bad) {
    var h = $("#rp-hud");
    if (!show) { if (h && h.parentNode) h.parentNode.removeChild(h); return; }
    if (!h) {
      h = el("div", "rp-hud");
      h.id = "rp-hud";
      h.innerHTML = '<div class="rp-hud-txt"></div><div class="rp-hud-bar"><i></i></div>';
      document.body.appendChild(h);
    }
    var t = h.querySelector(".rp-hud-txt"), f = h.querySelector(".rp-hud-bar i");
    if (t) { t.textContent = txt || ""; t.classList.toggle("bad", !!bad); }
    if (f) f.style.width = Math.max(0, Math.min(100, pct || 0)) + "%";
  }

  /* 图片 → base64（缩到 maxW 宽，控制文件体积）。
     取不到像素时返回 null，由调用方留白 —— 不假装有图。 */
  function imgDataUrl(img) {
    return new Promise(function (res) {
      try {
        var iw = img.naturalWidth || 0, ih = img.naturalHeight || 0;
        if (!iw || !ih) { res(null); return; }
        var sc = Math.min(1, EYE_PPT.maxW / iw);
        var w = Math.max(1, Math.round(iw * sc)), h = Math.max(1, Math.round(ih * sc));
        var cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        var ctx = cv.getContext("2d");
        if (!ctx) { res(null); return; }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        res(cv.toDataURL("image/jpeg", EYE_PPT.quality));
      } catch (e) { res(null); }
    });
  }

  /* 排布：先试「一屏放下这一列全部图」（图片最大），放不下再按行拆页 */
  function eyeSlice(n, availW, availH) {
    n = Math.max(1, n | 0);
    for (var c = EYE_GRID.minCols; c <= EYE_GRID.maxCols; c++) {
      var cw = (availW - EYE_GRID.gap * (c - 1)) / c;
      var ch = cw * 4 / 3 + EYE_GRID.tagH;
      var rows = Math.ceil(n / c);
      if (rows * ch + EYE_GRID.gap * (rows - 1) <= availH) return { cols: c, cw: cw, ch: ch, per: n };
    }
    var C = EYE_GRID.maxCols;
    var w2 = (availW - EYE_GRID.gap * (C - 1)) / C;
    var h2 = w2 * 4 / 3 + EYE_GRID.tagH;
    var rowsPer = Math.max(1, Math.floor((availH + EYE_GRID.gap) / (h2 + EYE_GRID.gap)));
    return { cols: C, cw: w2, ch: h2, per: C * rowsPer };
  }

  /* 组装幻灯片（pptx 可为真实 PptxGenJS 实例，测试时也可为记录型替身） */
  function assembleEye(pptx, o) {
    var spec = o.spec, W = spec.w, H = spec.h;
    try {
      pptx.defineLayout({ name: "RP_EYE", width: W, height: H });
      pptx.layout = "RP_EYE";
    } catch (e) { /* 替身对象可忽略 */ }
    var M = 0.3, TOP = 0.78;
    var availW = W - M * 2, availH = H - TOP - M;
    var st = o.state || {};
    function page(bg) {
      var s = pptx.addSlide();
      s.background = { color: bg || "FFFFFF" };
      return s;
    }
    /* 1) 封面 */
    var total = 0, ncol = (o.pools || []).length;
    (o.pools || []).forEach(function (p) { total += (p.cards || []).length; });
    var s0 = page("F7F6F3");
    s0.addText("TREND BANK · 趋势上升榜 · 天眼对比", {
      x: 0.7, y: 0.7, w: W - 1.4, h: 0.4, fontSize: 13, color: "8B7355", charSpacing: 3, fontFace: FONT
    });
    s0.addText((st.cat && st.cat !== "全部" ? st.cat : "趋势上升榜") + "　全部对比图", {
      x: 0.7, y: 1.3, w: W - 1.4, h: 0.9, fontSize: spec.w > 12 ? 32 : 26, bold: true, color: "2C2C2C", fontFace: FONT
    });
    s0.addText(stateLine(st) + (o.scope ? ("　｜　范围：" + o.scope) : ""), {
      x: 0.7, y: 2.35, w: W - 1.4, h: 0.8, fontSize: 12, color: "8A857C", fontFace: FONT, lineSpacingMultiple: 1.4
    });
    s0.addText("共 " + total + " 张　·　" + ncol + " 列　·　每张都是真实图片，可在 PowerPoint 里点开放大；标签在该图下方", {
      x: 0.7, y: 3.3, w: W - 1.4, h: 0.5, fontSize: 12, color: "2C2C2C", fontFace: FONT
    });
    s0.addText(fmtTime(o.now || new Date()) + " 生成　·　仅供内部使用　·　请勿外传", {
      x: 0.7, y: H - 0.85, w: W - 1.4, h: 0.35, fontSize: 10, color: "8A857C", fontFace: FONT
    });

    /* 2) 每列一页：图片 + 图片正下方的标签 */
    (o.pools || []).forEach(function (p, i) {
      var cards = p.cards || [];
      if (!cards.length) return;
      var dataArr = (o.data && o.data[i]) || [];
      var g = eyeSlice(cards.length, availW, availH);
      var chunks = [];
      for (var s = 0; s < cards.length; s += g.per) chunks.push(cards.slice(s, s + g.per));
      chunks.forEach(function (chunk, ci) {
        var sl = page("FFFFFF");
        sl.addText(p.name + (p.spec ? " · " + p.spec : "") + (p.meta ? " · " + p.meta : "")
          + (chunks.length > 1 ? "（第 " + (ci + 1) + " / " + chunks.length + " 页）" : ""), {
          x: M, y: M, w: availW, h: 0.42, fontSize: 14, bold: true, color: "2C2C2C", fontFace: FONT
        });
        var fs = Math.max(6, Math.min(9, g.cw * 8));
        chunk.forEach(function (c0, k) {
          var gi = ci * g.per + k;
          var col = k % g.cols, row = Math.floor(k / g.cols);
          var x = M + col * (g.cw + EYE_GRID.gap);
          var y = TOP + row * (g.ch + EYE_GRID.gap);
          var imgH = g.cw * 4 / 3;
          var d = dataArr[gi];
          if (d) sl.addImage({ data: d, x: x, y: y, w: g.cw, h: imgH });
          else sl.addText("图片未取到", {
            x: x, y: y, w: g.cw, h: imgH, align: "center", valign: "middle",
            fontSize: 6, color: "B9B2A8", fontFace: FONT, fill: { color: "F2F0EC" }
          });
          /* 标签放在图片正下方 */
          var bits = [];
          if (c0.tag) bits.push(c0.tag);
          if (c0.move) bits.push(c0.move);
          if (!bits.length) {
            if (c0.period && c0.period !== p.name) bits.push(c0.period);
            else if (c0.cat) bits.push(c0.cat);
          }
          var txt = bits.join(" · ");
          if (txt) {
            sl.addText(txt, {
              x: x, y: y + imgH + 0.03, w: g.cw, h: EYE_GRID.tagH - 0.06,
              fontSize: fs, color: "8A857C", align: "center", valign: "top", fontFace: FONT,
              wrap: true, lineSpacingMultiple: 1.05
            });
          }
        });
      });
    });
    return pptx;
  }

  /* 天眼导出的口径（给封面与文件名用） */
  function eyeState() {
    var st = {};
    try { st = (CFG.state ? CFG.state() : {}) || {}; } catch (e) { st = {}; }
    var out = {};
    for (var k in st) if (Object.prototype.hasOwnProperty.call(st, k)) out[k] = st[k];
    out.zone = "趋势上升榜-天眼";
    return out;
  }
  function eyeScopeTxt() {
    var sc = document.querySelector("#rk-eye-scope");
    var t = sc ? String(sc.textContent || "").replace(/^范围：/, "").trim() : "";
    return t;
  }

  async function makeEyePPT(specKey) {
    var spec = PPT_SPECS[specKey] || PPT_SPECS.wide;
    var wrap = document.querySelector("#rk-eye-body .rk-pools");
    if (!wrap) {
      hud(true, "请先打开「天眼」再导出 PPT。", 100, true);
      setTimeout(function () { hud(false); }, 2800);
      return;
    }
    var pools = readPoolsFrom(wrap);
    if (!hasContent(pools)) {
      hud(true, NO_DATA_TXT, 100, true);
      setTimeout(function () { hud(false); }, 2800);
      return;
    }
    hud(true, "正在加载导出组件…", 4);
    var ok = await ensureLibs();
    if (!ok) {
      hud(true, "导出组件加载失败，请刷新页面重试。", 100, true);
      setTimeout(function () { hud(false); }, 2800);
      return;
    }
    hud(true, "正在准备图片…", 7);
    /* 先把本站图片以跨域方式重取一次：否则 canvas 取不到像素，导出的 PPT 会全是空白 */
    await prepCorsImages(wrap);

    var poolEls = $$(".rk-pool", wrap);
    var data = [], plan = [], capped = false;
    for (var i = 0; i < pools.length; i++) {
      var cardsEl = $$(".rk-card", poolEls[i] || wrap);
      var arr = [];
      for (var j = 0; j < pools[i].cards.length; j++) {
        if (plan.length >= EYE_PPT.maxImg) { capped = true; arr.push(null); continue; }
        arr.push(null);
        plan.push({ arr: arr, idx: arr.length - 1, im: cardsEl[j] ? cardsEl[j].querySelector("img") : null });
      }
      data.push(arr);
    }
    var kept = 0, missed = 0;
    var step = Math.max(1, EYE_PPT.conc | 0);
    var job = jobStart("正在导出 PPT");
    if (job) job.update(7, "正在准备图片…");
    for (var s = 0; s < plan.length; s += step) {
      if (job && !(await job.gate())) {
        job.done("已取消导出 PPT（未生成文件）", true);
        return;
      }
      await Promise.all(plan.slice(s, s + step).map(function (t) {
        return (t.im ? imgDataUrl(t.im) : Promise.resolve(null)).then(function (d) {
          if (!d) { missed++; return; }
          kept++;
          t.arr[t.idx] = d;
        });
      }));
      if (job) {
        job.update(7 + Math.round(Math.min(1, (s + step) / Math.max(1, plan.length)) * 66),
          "正在读取图片 " + Math.min(plan.length, s + step) + " / " + plan.length + "…");
      } else {
        hud(true, "正在读取图片 " + Math.min(plan.length, s + step) + " / " + plan.length + "…",
          7 + Math.round(Math.min(1, (s + step) / Math.max(1, plan.length)) * 66));
      }
      await new Promise(function (r) { setTimeout(r, 0); });   /* 让出主线程，避免页面卡死 */
    }

    /* 组装前最后一道闸：这之后再点「取消」就来不及了（文件已开始写） */
    if (job && !(await job.gate())) {
      job.done("已取消导出 PPT（未生成文件）", true);
      return;
    }
    if (job) job.update(82, "正在组装 PPT…");
    else hud(true, "正在组装 PPT…", 82);
    var st = eyeState();
    var scope = eyeScopeTxt();
    var pptx = new window.PptxGenJS();
    assembleEye(pptx, { spec: spec, specKey: specKey, pools: pools, data: data, state: st, scope: scope, now: new Date() });
    var name = fileNameOf(st, "pptx", new Date());
    await pptx.writeFile({ fileName: name });
    var extra = [];
    if (capped) extra.push("图片超过 " + EYE_PPT.maxImg + " 张，只放了前 " + EYE_PPT.maxImg + " 张（可缩小范围后再导）");
    if (missed) extra.push(missed + " 张未能取到像素（站外图片或加载失败），已在原位留白");
    if (scope) extra.push("范围：" + scope);
    if (job) {
      job.done("已生成：" + name + (extra.length ? "（" + extra.join("；") + "）" : ""));
    } else {
      hud(true, "已生成：" + name + (extra.length ? "（" + extra.join("；") + "）" : ""), 100);
      setTimeout(function () { hud(false); }, 5000);
    }
  }

  /* 天眼里的「导出 PPT」入口（只有超级管理员看得到按钮） */
  async function exportEye() {
    try {
      var ok = CFG.super;
      if (!ok && CFG.isSuper) { try { ok = await CFG.isSuper(); } catch (e2) { ok = false; } }
      if (!ok) {
        hud(true, "只有超级管理员可以导出报告。", 100, true);
        setTimeout(function () { hud(false); }, 2800);
        return;
      }
      await makeEyePPT(SPEC_PPT);
    } catch (e) {
      hud(true, "导出失败，请重试。", 100, true);
      setTimeout(function () { hud(false); }, 2800);
    }
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
      +       '<button type="button" class="rp-opt" data-fmt="trend"><b>PDF 并上传趋势专区</b><span>自动生成封面、标题、标签与简介，生成后直接登记到前台趋势专区</span></button>'
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
      : FMT === "trend"
      ? "上传趋势专区：生成 A4 横版 PDF（封面 + 整体对照 + 每列一页），同时自动填好标题、标签分类、类目与简介并直接登记到前台趋势专区。封面即前台卡片图。"
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
      else if (FMT === "trend") await publishToTrend();
      else await makePPT(SPEC_PPT);
    } catch (e) {
      setProgress("导出失败，请重试。", 100, true);
    } finally {
      BUSY = false;
      if (go) { go.disabled = false; go.textContent = "生成"; }
    }
  }

  /* ==========================================================================
   *  四·C、趋势上升榜 → 趋势专区（20261030D）
   *  --------------------------------------------------------------------------
   *  为什么单独做一条路径：
   *   已有的「PDF」走浏览器原生打印，好处是文字是矢量的、可搜索，但那一步
   *   产出的文件由浏览器直接交给用户，程序拿不到字节流，也就没法替用户上传。
   *   趋势专区要一份真实的 PDF 文件，所以这里用绘制式 PDF：把同样的内容
   *   （封面 + 整体对照 + 每列）按页画进 PDF，拿到字节后再上传。
   *
   *  自动带齐趋势专区的必填项：
   *    文件标题 / 标签分类 / 类目 / 封面图 / 简介 —— 都从当前筛选与内容推导，
   *    上传后前台趋势专区即可看到，不需要再到后台补。
   * ========================================================================*/
  var TREND_SPEC = { name: "A4 横版", w: 297, h: 210, margin: 10 };

  async function loadJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return true;
    var v = assetV();
    try { await loadScript("vendor/jspdf.umd.min.js" + (v ? "?v=" + v : "")); } catch (e) { /* 落到下面判定 */ }
    return !!(window.jspdf && window.jspdf.jsPDF);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* 封面：纯 canvas 绘制，文字全部由当前筛选自动生成。
     封面同时有两个用途 —— 塞进 PDF 第一页、作为趋势专区的前台卡片图。 */
  function buildCoverCanvas(st, total, cols, now) {
    st = st || {};
    var W = 1600, H = 1000;
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var c = cv.getContext("2d");
    var FONT_CJK = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

    // 底色 + 右侧浅色块，避免纯白显得空
    c.fillStyle = "#F7F6F3"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#EFEBE4"; c.fillRect(W * 0.66, 0, W * 0.34, H);
    c.fillStyle = "#C9B79C"; c.fillRect(0, 0, W, 10);

    // 品牌行
    c.fillStyle = "#8B7355";
    c.font = "500 26px " + FONT_CJK;
    c.fillText("TREND BANK · 趋势上升榜", 96, 132);

    // 主标题：类目 + 趋势报告
    var cat = (st.cat && st.cat !== "全部") ? st.cat : "全类目";
    var title = cat + "趋势报告";
    c.fillStyle = "#2C2C2C";
    c.font = "700 92px " + FONT_CJK;
    var tw = c.measureText(title).width;
    if (tw > W - 200) {                       // 类目名过长时自动降字号，避免溢出
      var fs = Math.max(48, Math.floor(92 * (W - 200) / tw));
      c.font = "700 " + fs + "px " + FONT_CJK;
    }
    c.fillText(title, 96, 300);

    // 副标题：地区 / 站点 · 期次
    var place = st.group || ((st.sites && st.sites.length) ? st.sites.join(" / ") : "");
    var sub = [place, (st.periods && st.periods.length) ? st.periods.join("、") : ""]
      .filter(Boolean).join("　·　") || "全部站点";
    c.fillStyle = "#5C5C5C";
    c.font = "400 38px " + FONT_CJK;
    c.fillText(sub, 96, 372);

    // 口径行：同一行文字也出现在报表页眉，保持一致
    var line = stateLine(st);
    if (line) {
      c.fillStyle = "#8A857C";
      c.font = "400 26px " + FONT_CJK;
      var words = line.split("　｜　");
      var y = 440;
      words.forEach(function (t) {
        if (c.measureText(t).width > W - 220) {
          while (t.length > 4 && c.measureText(t + "…").width > W - 220) t = t.slice(0, -1);
          t += "…";
        }
        c.fillText(t, 96, y); y += 40;
      });
    }

    // 三个数字块
    var stats = [[String(total), "张图片"], [String(cols), "个对比列"], [fmtDate(now), "生成日期"]];
    stats.forEach(function (s, i) {
      var x = 96 + i * 300;
      c.fillStyle = "#2C2C2C";
      c.font = "700 56px " + FONT_CJK;
      c.fillText(s[0], x, H - 190);
      c.fillStyle = "#8A857C";
      c.font = "400 24px " + FONT_CJK;
      c.fillText(s[1], x, H - 150);
    });

    // 页脚
    c.fillStyle = "#8A857C";
    c.font = "400 22px " + FONT_CJK;
    c.fillText("本报告由前台「生成报告 · 上传趋势专区」导出 · 仅供内部使用 · 请勿外传", 96, H - 68);

    // 右下角装饰：品牌字
    c.fillStyle = "rgba(139,115,85,0.18)";
    c.font = "700 180px " + FONT_CJK;
    c.fillText("TB", W - 400, H - 120);

    return cv;
  }

  function canvasBlob(cv, type, quality) {
    return new Promise(function (resolve) {
      if (cv.toBlob) cv.toBlob(function (b) { resolve(b); }, type || "image/png", quality);
      else resolve(null);
    });
  }

  /* 内页也整页画成图片再贴进 PDF —— 原因：PDF 库内置字体不含中文字形，
     直接写字会把中文丢成方块或空白。交给浏览器 canvas 渲染，中文才对，
     且与网页排版完全一致。折中代价是内页文字不可搜索，
     需要可搜索版本时用上面的「PDF（推荐）」原生打印即可。 */
  function loadImage(src) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };
      im.src = src;
    });
  }

  async function buildInnerPageCanvas(head, shot) {
    var W = 1684, H = 1191;                  // A4 横版比例（297:210），约 150dpi
    var PAD = 56, HEAD_H = 66;
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var c = cv.getContext("2d");
    var FONT_CJK = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

    c.fillStyle = "#FFFFFF"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#C9B79C"; c.fillRect(0, 0, W, 6);

    c.fillStyle = "#2C2C2C";
    c.font = "600 30px " + FONT_CJK;
    var t = String(head || "");
    while (t.length > 4 && c.measureText(t).width > W - PAD * 2) t = t.slice(0, -1);
    if (t !== String(head || "")) t += "…";
    c.fillText(t, PAD, HEAD_H);

    if (!shot || !shot.data) {
      c.fillStyle = "#C25E5A";
      c.font = "400 24px " + FONT_CJK;
      c.fillText("（本页图片未能抓取，可在网页上查看）", PAD, HEAD_H + 56);
      return cv;
    }
    var bx = PAD, by = HEAD_H + 26;
    var bw = W - PAD * 2, bh = H - by - PAD;
    var r = Math.min(bw / shot.w, bh / shot.h);
    var w = shot.w * r, h = shot.h * r;
    var img = await loadImage(shot.data);
    if (img) {
      try { c.drawImage(img, bx + (bw - w) / 2, by + (bh - h) / 2, w, h); }
      catch (e) { img = null; }
    }
    if (!img) {
      c.fillStyle = "#C25E5A";
      c.font = "400 24px " + FONT_CJK;
      c.fillText("（本页图片未能绘制，可在网页上查看）", PAD, by + 40);
    }
    return cv;
  }

  /* 把封面 + 整体对照 + 每列拼成一份 A4 横版 PDF，返回 Blob 与封面 Blob */
  async function buildTrendPdf(o) {
    var st = o.state || {};
    var pools = o.pools || [];
    var total = pools.reduce(function (n, p) { return n + p.cards.length; }, 0);
    var now = o.now || new Date();

    var cover = buildCoverCanvas(st, total, pools.length, now);
    var coverBlob = await canvasBlob(cover, "image/png");

    var jsPDF = window.jspdf.jsPDF;
    var pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [TREND_SPEC.w, TREND_SPEC.h] });
    var PW = TREND_SPEC.w, PH = TREND_SPEC.h;

    // 第 1 页：封面铺满
    pdf.addImage(cover.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, PW, PH);

    async function addPage(head, shot) {
      pdf.addPage([PW, PH], "landscape");
      var cv = await buildInnerPageCanvas(head, shot);
      pdf.addImage(cv.toDataURL("image/jpeg", 0.86), "JPEG", 0, 0, PW, PH);
    }

    if (o.shots && o.shots.all) {
      await addPage("整体对照 · " + ((st.cat && st.cat !== "全部") ? st.cat : ""), o.shots.all);
    }
    for (var i = 0; i < pools.length; i++) {
      var p = pools[i];
      var head = p.name + (p.spec ? " · " + p.spec : "") + (p.meta ? " · " + p.meta : "");
      setProgress("正在排版第 " + (i + 2) + " / " + (pools.length + 1) + " 页…", 64 + Math.round((i + 1) / (pools.length + 1) * 10));
      await addPage(head, (o.shots && o.shots.pools) ? o.shots.pools[i] : null);
    }

    var blob = pdf.output("blob");
    return { pdfBlob: blob, coverBlob: coverBlob, total: total, cols: pools.length };
  }

  /* 趋势专区的必填项由当前筛选推导，用户不用再填一遍 */
  function autoTrendMeta(st, total, cols, now) {
    st = st || {};
    var cat = (st.cat && st.cat !== "全部") ? st.cat : "全类目";
    var place = st.group || ((st.sites && st.sites.length) ? st.sites.join("、") : "");
    var per = (st.periods && st.periods.length) ? st.periods.join("、") : "";

    var title = [cat, place, per, "趋势报告"].filter(Boolean).join(" ");
    if (title.length > 60) title = title.slice(0, 60);

    /* 标签分类三选一：期次里带 W 视为周度，带年月视为月度，其余归到类目。
       这样前台按「周度/月度」筛的时候，这份报告能落在正确的分组里。 */
    var tag = "类目";
    if (/W\d{1,2}/i.test(per) || /周/.test(per)) tag = "周度";
    else if (/\d{4}[-年]\d{1,2}/.test(per) || /月/.test(per)) tag = "月度";

    var desc = "共 " + total + " 张图片、" + cols + " 个对比列"
      + (place ? "，覆盖 " + place : "")
      + (per ? "，期次 " + per : "")
      + "。由趋势上升榜自动生成于 " + fmtTime(now) + "。";

    return { title: title, tag: tag, category: (st.cat && st.cat !== "全部") ? st.cat : "", description: desc };
  }

  async function publishToTrend() {
    var SBX = window.SB;
    if (!SBX || !SBX.uploadTrendFile || !SBX.addTrendRecord) {
      setProgress("当前页面未加载上传组件，请刷新后重试。", 100, true); return;
    }
    var pools = readPools();
    if (!hasContent(pools)) { setProgress(NO_DATA_TXT, 100, true); return; }

    setProgress("正在准备导出组件…", 4);
    var okLib = await ensureLibs();          // html2canvas（抓图）在这里面
    var okPdf = await loadJsPdf();
    if (!okLib || !okPdf) { setProgress("导出组件加载失败，请刷新页面重试。", 100, true); return; }

    var wrap = CFG.poolsEl ? CFG.poolsEl() : null;
    var poolEls = wrap ? $$(".rk-pool", wrap) : [];

    setProgress("正在抓取「整体对照」图…", 12);
    var shots = { all: null, pools: [] };
    shots.all = await shoot(wrap);
    for (var i = 0; i < pools.length; i++) {
      setProgress("正在抓取第 " + (i + 1) + " / " + pools.length + " 列…", 12 + Math.round((i + 1) / pools.length * 48));
      shots.pools.push(await shoot(poolEls[i]));
      await new Promise(function (r) { setTimeout(r, 40); });
    }

    setProgress("正在生成 PDF…", 64);
    var st = CFG.state ? CFG.state() : {};
    var now = new Date();
    var pack = await buildTrendPdf({ state: st, pools: pools, shots: shots, now: now });
    var meta = autoTrendMeta(st, pack.total, pack.cols, now);

    var fname = safeName(meta.title) + ".pdf";
    var pdfFile = new File([pack.pdfBlob], fname, { type: "application/pdf" });
    var coverFile = pack.coverBlob ? new File([pack.coverBlob], safeName(meta.title) + "-cover.png", { type: "image/png" }) : null;

    setProgress("正在上传到趋势专区…", 74);
    var onUp = function (p) {
      setProgress("正在上传到趋势专区… " + p + "%", 74 + Math.round(p * 0.2));
    };
    var up = SBX.uploadTrendFileXHR
      ? await SBX.uploadTrendFileXHR(pdfFile, coverFile, onUp)
      : await SBX.uploadTrendFile(pdfFile, coverFile);

    setProgress("正在登记到趋势清单…", 96);
    try {
      await SBX.addTrendRecord({
        title: meta.title,
        tag: meta.tag,
        path: up.path,
        category: meta.category,
        file_type: "pdf",
        cover: up.cover || "",
        description: meta.description
      });
    } catch (e) {
      /* 文件已经进了存储，只是清单没写成。这时候提示必须说清楚，
         否则用户会重复上传，在存储里留下多份同样的文件。 */
      setProgress("文件已上传成功，但登记到趋势清单失败：" + (e && e.message ? e.message : "未知原因")
        + "。请到后台趋势专区手动补录，不要重复上传。", 100, true);
      return;
    }

    setProgress("已上传趋势专区：" + meta.title + "（" + meta.tag + "）· 前台趋势专区可直接查看", 100);
  }

  /* ==========================================================================
   *  五、对外接口
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

/* ============ 导出任务：进度 + 暂停 / 取消 ============
     统一用右下角那条浮动进度条承载（不弹窗、不遮图）。导出期间多出两个按钮：
       「暂停 / 继续」—— 停在当前进度，点「继续」接着干；
       「取消」      —— 立刻停下，**不产出任何文件**（不会给你一个半截的包）。 */
  var JOB = null;

  function jobStart(title) {
    hud(true, (title || "正在导出") + " …", 0);
    var h = $("#rp-hud");
    if (!h) return null;
    if (!h.querySelector(".rp-hud-ops")) {
      var ops = document.createElement("div");
      ops.className = "rp-hud-ops";
      ops.innerHTML = '<button type="button" class="rp-hud-b" data-job="pause">暂停</button>'
        + '<button type="button" class="rp-hud-b rp-hud-x" data-job="cancel">取消</button>';
      h.appendChild(ops);
    }
    var pb = h.querySelector('[data-job="pause"]');
    var cb = h.querySelector('[data-job="cancel"]');
    var job = {
      cancelled: false, paused: false, title: title || "", pct: 0, text: "",
      update: function (pct, text) {
        if (this.cancelled) return;
        if (pct != null) this.pct = Math.max(0, Math.min(100, pct));
        if (text != null) this.text = String(text);
        /* 暂停期间不再刷新进度：否则正在飞的那一张图读完会把「已暂停」冲掉 */
        if (this.paused) return;
        hud(true, (this.title ? this.title + " · " : "") + this.text, this.pct);
      },
      /* 每个工作单元开工前调用：已取消 → false；暂停中 → 一直等（点「继续」才放行） */
      gate: function () {
        var self = this;
        return new Promise(function (res) {
          (function tick() {
            if (self.cancelled) return res(false);
            if (!self.paused) return res(true);
            setTimeout(tick, 120);
          })();
        });
      },
      close: function () { JOB = null; hud(false); },
      done: function (msg, bad) {
        JOB = null;
        if (msg) hud(true, msg, 100, !!bad);
        setTimeout(function () { hud(false); }, bad ? 3000 : 5600);
      }
    };
    if (pb) {
      pb.onclick = function () {
        job.paused = !job.paused;
        pb.textContent = job.paused ? "继续" : "暂停";
        hud(true, (job.title ? job.title + " · " : "")
          + (job.paused ? "已暂停（点「继续」接着导出）" : job.text), job.pct);
      };
    }
    if (cb) {
      cb.onclick = function () { job.cancelled = true; job.paused = false; };
    }
    JOB = job;
    return job;
  }

  /* ============ 导出图片（整页定格 · 高清可放大） ============
     与「导出 PPT」不同：这里导出的是**当前这个页面此刻的样子** —— 一次成像的整页长图。
     列、卡片、图片、位次标签都落在它们在屏幕上的位置，按 2 倍绘制（可放大看清细节）。
     权限口径与「导出 PPT」一致：只有超级管理员可导出（按钮不可见 + 调用时再校验一次）。 */
  var IMG_EXP = { scale: 2, maxPixels: 48e6, maxW: 6000, maxN: 300 };

  function isSuperNow() {
    return Promise.resolve()
      .then(function () {
        if (CFG.super) return true;
        if (typeof CFG.isSuper === "function") return CFG.isSuper();
        return false;
      })
      .then(function (v) { return !!v; }, function () { return false; });
  }

  function ensureZip() {
    if (window.JSZip) return Promise.resolve(true);
    var v = assetV();
    return loadScript("vendor/jszip.min.js" + (v ? ("?v=" + v) : "")).then(function () {
      return !!window.JSZip;
    }, function () { return false; });
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

  /* 一段文字：按元素宽度折行，最多排到元素高度（不会画到别人身上）。
     两条硬约束（曾经因此丢字）：
     ① 网页上本来只占一行、完整显示的短标签（如周次「W42」），导出时必须整段画出来；
        原来的做法是按元素宽度逐字折行，只要某个字比框宽一点点就掉到第二行，
        而「最多排到元素高度」会把第二行整行丢掉 —— 于是「W42」变成「W4」。
        现在改为：先逐级缩小字号去适配（最多缩到 55%），仍放不下时对短标签宁可整段画出，也不许少字。
     ② 确实很长的文字才允许折行；折行后仍有余量时补省略号，不再是静默吞掉结尾。 */
  var TEXT_SHRINK_MIN = 0.55;   /* 最小缩到原字号的 55%，再小就看不清了 */
  var TEXT_SHRINK_STEP = 0.05;

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

  function drawTextOp(ctx, op, S) {
    var txt = String(op.text == null ? "" : op.text);
    if (!txt) return;
    var baseSize = Math.max(1, (op.size || 12) * S);
    var bold = op.weight && Number(op.weight) >= 600;
    ctx.fillStyle = op.color || "#1a1a1a";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    var x = op.x * S, w = Math.max(1, op.w * S) + S, h = Math.max(1, op.h * S);

    function setFont(sz) { ctx.font = (bold ? "bold " : "") + sz + "px " + FONT; }
    function lineH(sz) { return sz * 1.34; }

    /* 第一轮：从原字号开始按 5% 递减，找第一个「整段文字能装进可用行数」的字号 */
    var size = baseSize, lines = null;
    for (var k = 0; k * TEXT_SHRINK_STEP <= 1 - TEXT_SHRINK_MIN + 1e-6; k++) {
      var sz = baseSize * (1 - k * TEXT_SHRINK_STEP);
      setFont(sz);
      var ls = wrapByWidth(ctx, txt, w);
      var allow = op.nowrap ? 1 : Math.max(1, Math.floor(h / lineH(sz)));
      if (ls.length <= allow) { size = sz; lines = ls; break; }
    }

    if (!lines) {
      /* 缩到最小仍放不下：短标签整段画出（宁可轻微出框，也不能少了数字）；
         长文本按可用行数截断并明确加省略号。 */
      size = baseSize * TEXT_SHRINK_MIN;
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

  /* 把图铺满指定框（等比裁切，和网页里 object-fit: cover 一致） */
  function drawCover(ctx, im, x, y, w, h) {
    var iw = im.naturalWidth || im.width || 0, ih = im.naturalHeight || im.height || 0;
    if (!iw || !ih) return false;
    var s = Math.max(w / iw, h / ih);
    var dw = iw * s, dh = ih * s;
    ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return true;
  }

  /* payload: { root:{w,h}, ops:[box|img|text], scope:"范围文字" }
     box  : {k,x,y,w,h,fill,stroke,lw,radius}
     img  : {k,x,y,w,h,url,radius}
     text : {k,x,y,w,h,text,size,weight,color} */
  function exportImages(payload) {
    var ops = (((payload || {}).ops) || []).filter(function (o) { return o && o.k; });
    var root = (payload || {}).root || { w: 0, h: 0 };
    return isSuperNow().then(function (ok) {
      if (!ok) {
        hud(true, "只有超级管理员可以导出图片。", 100, true);
        setTimeout(function () { hud(false); }, 2800);
        return false;
      }
      if (!ops.length || !(root.w > 0) || !(root.h > 0)) {
        hud(true, "当前页面没有可导出的内容。", 100, true);
        setTimeout(function () { hud(false); }, 2800);
        return false;
      }
      /* 倍数自适应：页面很长时自动降倍数，避免画布过大被浏览器拒绝 */
      var S = IMG_EXP.scale;
      while (S > 1 && ((root.w * S > IMG_EXP.maxW) || (root.w * root.h * S * S > IMG_EXP.maxPixels))) S -= 0.25;
      var W = Math.max(1, Math.round(root.w * S)), H = Math.max(1, Math.round(root.h * S));
      var cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      var ctx = cv.getContext && cv.getContext("2d");
      if (!ctx) {
        hud(true, "当前环境不支持画布导出，请换电脑浏览器再试。", 100, true);
        setTimeout(function () { hud(false); }, 3000);
        return false;
      }
      var job = jobStart("正在生成整页高清图");
      if (!job) return false;

      var boxes = ops.filter(function (o) { return o.k === "box"; });
      var imgs = ops.filter(function (o) { return o.k === "img" && /^https?:\/\//i.test(o.url || ""); });
      var texts = ops.filter(function (o) { return o.k === "text"; });
      var miss = 0, drawn = 0;

      return (async function () {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, W, H);

        /* ① 底色与边框 */
        for (var i = 0; i < boxes.length; i++) {
          if (i % 12 === 0 && !(await job.gate())) return "cancel";
          var b = boxes[i];
          ctx.beginPath();
          roundRect(ctx, b.x * S, b.y * S, b.w * S, b.h * S, (b.radius || 0) * S);
          if (b.fill && b.fill !== "transparent" && b.fill !== "rgba(0, 0, 0, 0)") {
            ctx.fillStyle = b.fill;
            ctx.fill();
          }
          if (b.stroke && b.lw > 0) {
            ctx.lineWidth = Math.max(1, b.lw * S);
            ctx.strokeStyle = b.stroke;
            ctx.stroke();
          }
          job.update(4 + Math.round((i + 1) / Math.max(1, boxes.length) * 24), "正在铺版面 " + (i + 1) + " / " + boxes.length);
        }

        /* ② 图片（等比裁切铺满原位；取不到像素就留白标注，不假装有图） */
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
            ctx.fillStyle = "#f0ece4";
            ctx.fillRect(o.x * S, o.y * S, o.w * S, o.h * S);
            ctx.font = Math.max(12, Math.min(o.w, o.h) * S * 0.12) + "px " + FONT;
            ctx.fillStyle = "#9a938a";
            ctx.textBaseline = "middle";
            ctx.textAlign = "center";
            try { ctx.fillText("取不到图", (o.x + o.w / 2) * S, (o.y + o.h / 2) * S); } catch (e) { }
          } else drawn++;
          ctx.restore();
          if (j % 5 === 0 || j === imgs.length - 1) {
            job.update(28 + Math.round((j + 1) / Math.max(1, imgs.length) * 56),
              "正在贴图 " + (j + 1) + " / " + imgs.length);
          }
        }

        /* ③ 文字（列标题、位次标签、标题…按原位重排） */
        for (var k = 0; k < texts.length; k++) {
          if (k % 16 === 0 && !(await job.gate())) return "cancel";
          drawTextOp(ctx, texts[k], S);
          if (k % 8 === 0 || k === texts.length - 1) {
            job.update(84 + Math.round((k + 1) / Math.max(1, texts.length) * 12),
              "正在写文字 " + (k + 1) + " / " + texts.length);
          }
        }

        if (!(await job.gate())) return "cancel";
        job.update(97, "正在生成图片文件…");
        var name = safeName("趋势上升榜_整页_" + (((payload || {}).scope) || "") + "_" + fmtDate(new Date())) + ".png";
        var out = await new Promise(function (res) {
          if (typeof cv.toBlob === "function") {
            try { cv.toBlob(function (b) { res(b || null); }, "image/png"); return; } catch (e) { }
          }
          try { res({ dataUrl: cv.toDataURL("image/png") }); } catch (e) { res(null); }
        });
        if (!out) {
          job.done("生成图片失败，请重试（可缩小范围后再导）。", true);
          return false;
        }
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
        var extra = [];
        extra.push("整页 " + W + " × " + H + " 像素（可放大查看）");
        extra.push("含图 " + drawn + " 张");
        if (miss) extra.push(miss + " 张取不到像素，已留白标注");
        job.done(name + "：" + extra.join("；"));
        return true;
      })().then(function (r) {
        if (r === "cancel") {
          job.done("已取消导出（未生成任何文件）", true);
          return false;
        }
        return r;
      });
    }).then(function (r) { return r; }, function () {
      hud(true, "导出失败，请重试。", 100, true);
      setTimeout(function () { hud(false); }, 2800);
      return false;
    });
  }
  window.ReportKit = {
    init: init,
    open: openModal,
    close: closeModal,
    exportEye: exportEye,
    exportImages: exportImages,
    _: {
      PDF_SPECS: PDF_SPECS, PPT_SPECS: PPT_SPECS,
      readPools: readPools, buildSheet: buildSheet, injectPageStyle: injectPageStyle,
      cardNode: cardNode, stateLine: stateLine, safeName: safeName, fileNameOf: fileNameOf,
      fitBox: fitBox, detailRows: detailRows, splitRows: splitRows, assemble: assemble,
      hasContent: hasContent, contentTotal: contentTotal, NO_DATA_TXT: NO_DATA_TXT,
      isSiteImg: isSiteImg, offSiteCount: offSiteCount, prepCorsImages: prepCorsImages,
      waitImages: waitImages, setProgress: setProgress, openModal: openModal,
      makePDF: makePDF, makePPT: makePPT,
      makeEyePPT: makeEyePPT, assembleEye: assembleEye, eyeSlice: eyeSlice,
      readPoolsFrom: readPoolsFrom, imgDataUrl: imgDataUrl, hud: hud, exportEye: exportEye,
      exportImages: exportImages, jobStart: jobStart, IMG_EXP: IMG_EXP, isSuperNow: isSuperNow,
      drawTextOp: drawTextOp, wrapByWidth: wrapByWidth, TEXT_SHRINK_MIN: TEXT_SHRINK_MIN,
      EYE_PPT: EYE_PPT, EYE_GRID: EYE_GRID,
      cfg: CFG, getFmt: function () { return FMT; }, getScope: function () { return SCOPE; },
      ROW_PER_SLIDE: ROW_PER_SLIDE, TABLE_MAX_ROWS: TABLE_MAX_ROWS
    }
  };
})();