/* ============================================================================
 * imageexport.js —— 视觉专区（图库）打标表导出（20261028E，仅后台）
 *
 * 与趋势上升榜共用同一套枚举（js/rank-enums.js），数据源不同：
 *   榜单：rank_items + rank_image_tags（外链图）
 *   视觉专区：images 表（真实上传的图）
 *
 * 导出三张工作表（与榜单导出一致，填完可直接导回）：
 *   1) 打标表   一行一张图，含「打标状态」，URL 带超链接
 *   2) 全量明细 图片原始字段（URL / 名称 / 类目 / 上传时间 / 上传人）
 *   3) 枚举参考 所有维度允许值 + 二次工艺逐值口径 + 后台手动标签
 *
 * 维度与字段映射（images 表）：
 *   风格          → style_tags
 *   视觉-背景     → scene_tags     （图库原生「场景」，前台筛选在用）
 *   视觉-构图/主体→ visual_tags
 *   图案元素      → element_tags
 *   二次工艺      → craft_tags      ★新增列
 *   拍摄方式      → shoot_tags
 *   模特          → skin_tags       ★原「肤色」，拓宽为模特特征
 *   版型          → fit_tags        ★新增列，存「领型·圆领」形式
 *   文化背景      → culture_tags    ★新增列
 *   消费心理      → psych_tags      ★新增列
 *   节日          → festival_tags   ★新增列（可选）
 *   渠道          → tags
 *
 * 前台不再提供导出：打标是后台编辑动作，出入都在后台完成。
 * ==========================================================================*/
(function () {
  /* 枚举一律懒取（调用时才读 window）。
     之前在这里一次性取 window.APP_ENUM / RANK_VISUAL_ENUM，但定义这两个全局的脚本
     比本文件晚加载，取值时全是 undefined —— 结果是「枚举参考」表大部分维度空白，
     导入校验的允许值也是空数组，任何值都会被判未识别。 */
  function AE() { return window.APP_ENUM || {}; }
  function VE() { return window.RANK_VISUAL_ENUM || {}; }
  function VISUAL_BG() { return VE().bg || []; }
  function VISUAL_FRAME() { return VE().frame || []; }
  function VISUAL_SUBJECT() { return VE().subject || []; }
  function LEGACY() { return VE().legacy || []; }
  function FIT_GROUPS() { return (window.APP_ENUM_GROUPS && window.APP_ENUM_GROUPS.fit) || []; }

  /* 榜单那套全量枚举（rank-enums.js 组装好的合并版），视觉专区与之共用 */
  function RANK_ENUM() {
    var RE = window.RankExport;
    return (RE && RE.ENUM) || window.RANK_ENUM || {};
  }
  /* 取某维度的允许值：榜单全量枚举 → 图库原生枚举 → 视觉三组，逐级兜底 */
  function enumOf(k) {
    var v = RANK_ENUM()[k];
    if (v && v.length) return v.slice();
    v = AE()[k];
    if (v && v.length) return v.slice();
    if (k === "视觉-背景") return VISUAL_BG().slice();
    if (k === "视觉-画面构成") return VISUAL_FRAME().slice();
    if (k === "视觉-呈现主体") return VISUAL_SUBJECT().slice();
    return [];
  }
  function fitGroups() { return FIT_GROUPS(); }

  /* 计入「打标是否完整」的 8 个主维度（与榜单口径一致） */
  var DIMS = [
    ["风格", "style_tags"],
    ["视觉", "__visual"],
    ["图案元素", "element_tags"],
    ["二次工艺", "craft_tags"],
    ["拍摄方式", "shoot_tags"],
    ["版型", "fit_tags"],
    ["文化背景", "culture_tags"],
    ["消费心理", "psych_tags"]
  ];
  var DIM_TOTAL = DIMS.length;
  /* 可选维度：不计入分母，留空是正常状态 */
  var OPT_DIMS = [["节日", "festival_tags"]];

  var COLS = [
    "图片URL", "图片ID", "名称", "类目", "上传时间", "打标状态",
    "风格", "视觉-背景", "视觉-画面构成", "视觉-呈现主体",
    "图案元素", "二次工艺", "拍摄方式", "模特",
    "领型", "袖型", "袖长", "衣长", "松紧度", "裤型", "裤长", "裙长", "腰型",
    "文化背景", "消费心理", "节日", "渠道", "备注"
  ];

  function arr(v) {
    if (Array.isArray(v)) return v.filter(function (x) { return String(x || "").trim(); });
    if (v == null || v === "") return [];
    return String(v).split(/[,，、|；;]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function catOf(img) { return String((img && img.category) || "").trim() || "未分类"; }
  /* 图库里有两套地址，含义完全不同：
       img.url       外链（可选，运营手工填的跳转地址），上传图绝大多数没有
       img.path      图片在 R2 的存储路径，图片本体就在这里
     导出表只取 url 时整列全空——「导出来没有 URL」就是这么来的。
     所以按 外链 → 存储地址 逐级兜底，保证每一行都有可打开看图的地址。 */
  function extUrlOf(img) { return String((img && (img.url || img.image_url)) || "").trim(); }
  /* 导出前确保已经拿到「外部只读密钥」。
     开关开启时把密钥拼进图片地址，导出的表拿去哪台机器都能直接看图；
     开关关闭时不拼任何东西，地址仍是裸地址（对外不可读）——这是默认状态。 */
  async function ensureAgentReadKey() {
    if (window.__agentReadLoaded === true) return;
    try {
      var base = String((window.CONFIG && window.CONFIG.WORKER_URL) || "").replace(/\/$/, "");
      if (!base || typeof SB === "undefined" || !SB.currentToken) return;
      var tok = await SB.currentToken();
      if (!tok) return;
      var r = await fetch(base + "/agent-read", { headers: { Authorization: "Bearer " + tok } });
      if (!r.ok) return;
      var d = await r.json();
      window.__agentReadOn = !!d.on;
      window.__agentReadKey = d.key || "";
      window.__agentReadLoaded = true;
    } catch (e) { /* 拿不到就导出裸地址，不影响导出本身 */ }
  }

  function storageUrlOf(img) {
    var p = String((img && img.path) || "").trim().replace(/^\/+/, "");
    if (!p) return "";
    var base = String((window.CONFIG && window.CONFIG.WORKER_URL) || "").replace(/\/$/, "");
    if (!base) return p;
    var u = base + "/" + p;
    /* 外部只读开关开着才带上密钥；关着就是普通地址，外部读不到 */
    var k = window.__agentReadOn ? String(window.__agentReadKey || "") : "";
    if (k) u += "?read_key=" + encodeURIComponent(k);
    return u;
  }
  function urlOf(img) { return extUrlOf(img) || storageUrlOf(img); }

  /* 视觉三个子组：背景走 scene_tags，构图/主体走 visual_tags */
  function visualParts(img) {
    var bg = arr(img && img.scene_tags)
      .filter(function (x) { return VISUAL_BG().indexOf(String(x)) >= 0 || LEGACY().indexOf(String(x)) >= 0; });
    var vis = arr(img && img.visual_tags);
    var fr = vis.filter(function (x) { return VISUAL_FRAME().indexOf(String(x)) >= 0; });
    var sj = vis.filter(function (x) { return VISUAL_SUBJECT().indexOf(String(x)) >= 0; });
    /* 存量数据兼容：visual_tags 里可能直接放了背景值 */
    vis.forEach(function (x) {
      if (VISUAL_BG().indexOf(String(x)) >= 0 && bg.indexOf(x) < 0) bg.push(x);
    });
    return { bg: bg, frame: fr, subject: sj, all: bg.concat(fr, sj) };
  }

  function fitPick(img, group) {
    return arr(img && img.fit_tags)
      .filter(function (x) { return String(x).indexOf(group + "·") === 0; })
      .map(function (x) { return String(x).split("·")[1]; });
  }

  /* 打标进度：8 个主维度填了几个 */
  function progress(img) {
    var filled = 0;
    DIMS.forEach(function (d) {
      var v = d[1] === "__visual" ? visualParts(img).all : arr(img && img[d[1]]);
      if (v.length) filled++;
    });
    var optFilled = arr(img && img.festival_tags).length > 0;
    var status;
    if (filled === 0) status = optFilled ? "部分 0/" + DIM_TOTAL + "（仅节日）" : "未打标";
    else if (filled === DIM_TOTAL) status = "已打标";
    else status = "部分 " + filled + "/" + DIM_TOTAL;
    return { filled: filled, optFilled: optFilled, status: status };
  }

  function inScope(img, scope) {
    var pr = progress(img);
    if (!scope || scope === "all") return true;
    if (scope === "none") return pr.filled === 0 && !pr.optFilled;
    if (scope === "partial") return pr.filled > 0 && pr.filled < DIM_TOTAL;
    if (scope === "done") return pr.filled === DIM_TOTAL;
    return true;
  }

  function matchCat(img, sel) {
    var v = String(sel || "").trim();
    return !v || catOf(img) === v;
  }

  function filterImages(images, o) {
    o = o || {};
    return (images || []).filter(function (img) {
      if (!matchCat(img, o.category)) return false;
      if (!inScope(img, o.scope)) return false;
      if (o.keyword) {
        var hay = [urlOf(img), img.name, img.category, img.id].join(" ").toLowerCase();
        if (hay.indexOf(String(o.keyword).toLowerCase()) < 0) return false;
      }
      return true;
    });
  }

  /* 类目分布 */
  function catStats(images) {
    var map = {}, total = 0;
    (images || []).forEach(function (img) {
      var c = catOf(img), pr = progress(img);
      var o = map[c] || (map[c] = { name: c, total: 0, none: 0, partial: 0, done: 0 });
      o.total++; total++;
      if (pr.filled === 0) o.none++;
      else if (pr.filled === DIM_TOTAL) o.done++;
      else o.partial++;
    });
    var list = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name); });
    list.forEach(function (o) { o.pct = o.total ? Math.round(o.done * 100 / o.total) : 0; });
    return { cats: list, total: total };
  }

  /* 各维度有值行数（维度体检：判断"打了标却没显示"是数据没进还是没打） */
  function dimCount(images) {
    var r = {};
    DIMS.forEach(function (d) { r[d[0]] = 0; });
    OPT_DIMS.forEach(function (d) { r[d[0]] = 0; });
    (images || []).forEach(function (img) {
      DIMS.forEach(function (d) {
        var v = d[1] === "__visual" ? visualParts(img).all : arr(img && img[d[1]]);
        if (v.length) r[d[0]]++;
      });
      OPT_DIMS.forEach(function (d) { if (arr(img && img[d[1]]).length) r[d[0]]++; });
    });
    return r;
  }

  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }
  function safeName(v) {
    return String(v == null ? "" : v).replace(/[\\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "未分类";
  }
  function fmtTime(v) {
    if (!v) return "";
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* URL 列加超链接：Excel 里点一下就能开图，不用复制粘贴 */
  function linkUrls(ws, aoa, colIdx) {
    for (var i = 1; i < aoa.length; i++) {
      var u = aoa[i][colIdx];
      if (!u || !/^https?:\/\//i.test(u)) continue;
      var addr = XLSX.utils.encode_cell({ r: i, c: colIdx });
      if (ws[addr]) ws[addr].l = { Target: u, Tooltip: "打开图片" };
    }
  }

  /* 生成工作簿。
     opts: { scope, category, keyword, manualTags:{维度:[{name,manual:true}]} } */
  function buildBook(images, opts) {
    var o = opts || {};
    var picked = filterImages(images, o);
    var stats = { total: (images || []).length, picked: 0, todo: 0, partial: 0, done: 0 };
    (images || []).forEach(function (img) {
      var pr = progress(img);
      if (pr.filled === 0 && !pr.optFilled) stats.todo++;
      else if (pr.filled === DIM_TOTAL) stats.done++;
      else stats.partial++;
    });

    var aoa = [COLS.slice()];
    var urlMissing = 0;
    picked.forEach(function (img) {
      var pr = progress(img), vp = visualParts(img);
      var u = urlOf(img);
      var uNote = extUrlOf(img) ? ""
        : (u ? "地址取自存储路径（非外链）" : "⚠ 无外链且无存储路径，无法回填");
      if (!u) urlMissing++;
      aoa.push([
        urlOf(img), img.id == null ? "" : String(img.id), img.name || "", catOf(img),
        fmtTime(img.created_at), pr.status,
        arr(img.style_tags).join("，"),
        vp.bg.join("，"), vp.frame.join("，"), vp.subject.join("，"),
        arr(img.element_tags).join("，"),
        arr(img.craft_tags).join("，"),
        arr(img.shoot_tags).join("，"),
        arr(img.skin_tags).join("，"),
        fitPick(img, "领型").join("，"), fitPick(img, "袖型").join("，"),
        fitPick(img, "袖长").join("，"), fitPick(img, "衣长").join("，"),
        fitPick(img, "松紧度").join("，"), fitPick(img, "裤型").join("，"),
        fitPick(img, "裤长").join("，"), fitPick(img, "裙长").join("，"),
        fitPick(img, "腰型").join("，"),
        arr(img.culture_tags).join("，"),
        arr(img.psych_tags).join("，"),
        arr(img.festival_tags).join("，"),
        arr(img.tags).join("，"),
        uNote
      ]);
    });
    stats.picked = picked.length;
    stats.urlMissing = urlMissing;

    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = COLS.map(function (h) {
      if (h === "图片URL") return { wch: 58 };
      if (h === "图片ID") return { wch: 38 };
      if (h === "名称") return { wch: 26 };
      if (h === "类目") return { wch: 16 };
      if (h === "上传时间") return { wch: 18 };
      if (h === "打标状态") return { wch: 15 };
      if (h === "备注") return { wch: 24 };
      return { wch: 14 };
    });
    ws["!freeze"] = { xSplit: 1, ySplit: 1 };
    linkUrls(ws, aoa, 0);

    /* 全量明细：图片原始字段，方便核对 URL / ID */
    var detailAoa = [["图片ID", "图片URL", "名称", "类目", "上传时间", "打标状态"]];
    picked.forEach(function (img) {
      detailAoa.push([img.id == null ? "" : String(img.id), urlOf(img), img.name || "",
        catOf(img), fmtTime(img.created_at), progress(img).status]);
    });
    var ws2 = XLSX.utils.aoa_to_sheet(detailAoa);
    ws2["!cols"] = [{ wch: 38 }, { wch: 58 }, { wch: 26 }, { wch: 16 }, { wch: 18 }, { wch: 15 }];
    linkUrls(ws2, detailAoa, 1);

    /* 枚举参考：允许值 + 手动标签标注 */
    var enumAoa = [["维度/子分组", "允许的取值（逗号分隔，导入时逐值校验）", "判定口径 / 备注"]];
    var dimOrder = ["风格", "视觉-背景", "视觉-画面构成", "视觉-呈现主体", "图案元素", "二次工艺",
      "拍摄方式", "模特", "领型", "袖型", "袖长", "衣长", "松紧度", "裤型", "裤长", "裙长", "腰型",
      "文化背景", "消费心理", "节日", "渠道"];
    dimOrder.forEach(function (k) {
      var vals = enumOf(k);
      var mt = (o.manualTags && o.manualTags[k]) || [];
      mt.forEach(function (m) { if (vals.indexOf(m) < 0) vals.push(m); });
      var note = "";
      if (k === "二次工艺") note = "局部小图案（胸花、单个卡通/字母/标语）默认「烫图/热转印」；只有满印、定位印花这类大幅面才是「数码印花」";
      if (k === "节日") note = "可选维度：不含节日元素就留空，不要填「无节日」";
      if (mt.length) note = (note ? note + "；" : "") + "含 " + mt.length + " 个后台手动标签（标 ★）";
      var disp = vals.map(function (v) {
        var isManual = mt.some(function (m) { return m.name === v || m === v; });
        return isManual ? "★" + v : v;
      });
      enumAoa.push([k, disp.join("，"), note]);
    });
    /* 版型按部位拆开列，避免把「圆领」填到「裤型」里 */
    enumAoa.push([]);
    enumAoa.push(["版型 · 按部位填写", "部位", "说明"]);
    fitGroups().forEach(function (g) {
      enumAoa.push(["", g.label + "：" + g.values.join("、"), "填在打标表对应的「" + g.label + "」列，导入时按列校验"]);
    });
    var ws3 = XLSX.utils.aoa_to_sheet(enumAoa);
    ws3["!cols"] = [{ wch: 22 }, { wch: 120 }, { wch: 80 }];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "打标表");
    XLSX.utils.book_append_sheet(wb, ws2, "全量明细");
    XLSX.utils.book_append_sheet(wb, ws3, "枚举参考");
    return { wb: wb, images: picked.length, stats: stats, urlMissing: urlMissing };
  }

  function download(wb, name) {
    var out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    var blob = new Blob([out], { type: "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* 读后台手动标签，合并进枚举参考 */
  async function loadManualTags() {
    var out = {};
    var MAP = { style: "风格", element: "图案元素", scene: "视觉-背景", shoot: "拍摄方式", skin: "模特" };
    try {
      var defs = await SB.listTagDefs();
      (defs || []).forEach(function (d) {
        var dim = MAP[d.type];
        if (!dim) return;
        (out[dim] = out[dim] || []).push(String(d.name || "").trim());
      });
    } catch (e) { /* 手动标签读取失败不影响导出 */ }
    return out;
  }

  /* 导出（单文件 / 按类目拆分 zip） */
  async function exportImages(images, opts, say) {
    await ensureAgentReadKey();
    var o = opts || {};
    var manual = await loadManualTags();
    var tag = stamp();

    if (o.split) {
      var cats = catStats(images).cats.filter(function (c) {
        return c.total > 0 && (!o.scope || o.scope === "all" || true);
      });
      /* 拆分时按「当前范围下确有图」的类目拆，避免生成空文件 */
      var keep = {};
      filterImages(images, { scope: o.scope, keyword: o.keyword }).forEach(function (img) { keep[catOf(img)] = 1; });
      var files = 0;
      var zip = new JSZip();
      cats.forEach(function (c) {
        if (!keep[c.name]) return;
        var sub = images.filter(function (i) { return catOf(i) === c.name; });
        var pack = buildBook(sub, { scope: o.scope, keyword: o.keyword, category: c.name, manualTags: manual });
        if (!pack.images) return;
        var buf = XLSX.write(pack.wb, { bookType: "xlsx", type: "array" });
        zip.file("视觉专区-" + safeName(c.name) + "-" + tag + ".xlsx", buf);
        files++;
      });
      if (!files) throw new Error("当前条件下没有可导出的图片");
      if (say) say("正在打包 " + files + " 个类目…");
      var blob = await zip.generateAsync({ type: "blob" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "视觉专区-按类目-" + tag + ".zip";
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      return { files: files };
    }

    var pack = buildBook(images, {
      scope: o.scope, category: o.category, keyword: o.keyword, manualTags: manual
    });
    if (!pack.images) throw new Error("当前条件下没有可导出的图片");
    var nm = "视觉专区-打标表-" + (o.category ? safeName(o.category) + "-" : "全部-") + tag + ".xlsx";
    download(pack.wb, nm);
    if (say) {
      var msg = "已导出 " + pack.images + " 张";
      if (pack.urlMissing) msg += "（其中 " + pack.urlMissing + " 张既无外链也无存储路径，导入时请靠「图片ID」列匹配）";
      say(msg);
    }
    return { files: 1, rows: pack.images, urlMissing: pack.urlMissing };
  }


  /* 类目分布表：每个主类目一行，看覆盖率，点行可联动筛选 */
  function renderOverview(box, images, onPick) {
    if (!box) return;
    var st = catStats(images);
    var dc = dimCount(images);
    var dimHtml = Object.keys(dc).map(function (k) {
      var isOpt = k === "节日";
      var warn = (!isOpt && dc[k] === 0) ? ' style="color:#d9534f;font-weight:600"' : '';
      return '<span class="rk-ov-dim"' + warn + '>' + k + " " + dc[k] + "</span>";
    }).join("");
    var rows = st.cats.map(function (c) {
      var color = c.pct >= 80 ? "#2e9e5b" : (c.pct >= 40 ? "#d99b2b" : "#d9534f");
      return '<tr data-cat="' + String(c.name).replace(/"/g, "&quot;") + '" style="cursor:pointer">' +
        "<td>" + (window.escHtml ? escHtml(c.name) : c.name) + "</td>" +
        "<td>" + c.total + "</td><td>" + c.none + "</td><td>" + c.partial + "</td><td>" + c.done + "</td>" +
        '<td><div style="background:#eee;border-radius:4px;height:8px;width:90px;display:inline-block;vertical-align:middle">' +
        '<div style="background:' + color + ';height:8px;border-radius:4px;width:' + c.pct + '%"></div></div> ' + c.pct + "%</td></tr>";
    }).join("");
    box.innerHTML =
      '<div class="dash-cat-ov-head">各维度有值行数：' + dimHtml + "</div>" +
      '<table class="dash-cat-ov-tb"><thead><tr><th>类目</th><th>图片数</th><th>未打标</th><th>不完整</th><th>已打标</th><th>覆盖率</th></tr></thead>' +
      "<tbody>" + rows + '</tbody></table>';
    Array.prototype.forEach.call(box.querySelectorAll("tbody tr"), function (tr) {
      tr.onclick = function () { if (onPick) onPick(tr.getAttribute("data-cat")); };
    });
  }

  window.ImageExport = {
    COLS: COLS,
    DIMS: DIMS,
    DIM_TOTAL: DIM_TOTAL,
    progress: progress,
    catStats: catStats,
    dimCount: dimCount,
    filterImages: filterImages,
    buildBook: buildBook,
    urlOf: urlOf,
    extUrlOf: extUrlOf,
    storageUrlOf: storageUrlOf,
    exportImages: exportImages,
    renderOverview: renderOverview,
    exportSplit: function (images, opts, say) { return exportImages(images, Object.assign({}, opts, { split: true }), say); },
    catOf: catOf,
    urlOf: urlOf,
    visualParts: visualParts,
    fitPick: fitPick,
    arr: arr,
    safeName: safeName,
    stamp: stamp,
    /* 兼容旧调用（前台已移除导出，这里保留避免其他模块报错） */
    exportOne: function (images, opts, say) { return exportImages(images, opts || {}, say); }
  };
})();
