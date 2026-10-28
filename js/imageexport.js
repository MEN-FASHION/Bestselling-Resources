/* ============================================================================
 * imageexport.js —— 视觉专区「按类目导出图片清单」（前台 + 后台共用）
 *
 * 与趋势上升榜的导出（rankexport.js）是两套数据：
 *   榜单导出读 rank_items + rank_image_tags（外链图，9 个维度）；
 *   这里读 images 表（图库真实上传的图，6 个维度：渠道/风格/元素/场景/拍摄方式/肤色）。
 *
 * 能力：
 *   1) 类目分布：每个类目多少张、已打标多少、覆盖率 —— 先看再决定优化哪类
 *   2) 按类目筛选导出：单个文件
 *   3) 按类目拆分导出：每个类目一个 xlsx，打包 zip
 *
 * 前台只有「导出当前类目」，后台可全量 / 拆分。
 * xlsx 与 jszip 体积较大，前台首屏不加载，点导出时才按需引入。
 * ==========================================================================*/
(function () {
  var DIMS = [
    ["渠道", "tags"],
    ["风格", "style_tags"],
    ["元素", "element_tags"],
    ["场景", "scene_tags"],
    ["拍摄方式", "shoot_tags"],
    ["肤色", "skin_tags"]
  ];
  var DIM_TOTAL = DIMS.length;

  var COLS = ["图片URL", "名称", "类目", "上传时间", "打标状态"]
    .concat(DIMS.map(function (d) { return d[0]; }));

  function arr(v) {
    if (Array.isArray(v)) return v.filter(function (x) { return String(x || "").trim(); });
    if (v == null || v === "") return [];
    return String(v).split(/[,，、|；;]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* 打标进度：6 个维度填了几个 */
  function progress(img) {
    var filled = 0;
    DIMS.forEach(function (d) { if (arr(img && img[d[1]]).length) filled++; });
    var status = filled === 0 ? "未打标" : (filled === DIM_TOTAL ? "已打标" : "部分 " + filled + "/" + DIM_TOTAL);
    return { filled: filled, status: status };
  }

  function catOf(img) { return String((img && img.category) || "").trim() || "未分类"; }

  /* 类目分布：总数 / 未打标 / 部分 / 已打标 / 覆盖率 */
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

  function matchCat(img, sel) {
    var v = String(sel || "").trim();
    if (!v) return true;
    return catOf(img) === v;
  }

  /* 打标状态范围：all / none（未打标）/ partial（不完整）/ done（已打标） */
  function inScope(img, scope) {
    var f = progress(img).filled;
    if (!scope || scope === "all") return true;
    if (scope === "none") return f === 0;
    if (scope === "partial") return f > 0 && f < DIM_TOTAL;
    if (scope === "done") return f === DIM_TOTAL;
    return true;
  }

  function filterImages(images, o) {
    o = o || {};
    return (images || []).filter(function (img) {
      if (!matchCat(img, o.category)) return false;
      if (!inScope(img, o.scope)) return false;
      if (o.keyword) {
        var hay = [img.url, img.image_url, img.name, img.category].join(" ").toLowerCase();
        if (hay.indexOf(String(o.keyword).toLowerCase()) < 0) return false;
      }
      return true;
    });
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

  /* 生成工作簿：图片清单（一行一张）+ 类目分布 */
  function buildBook(images, opts) {
    var o = opts || {};
    var picked = filterImages(images, o);
    var aoa = [COLS.slice()];
    picked.forEach(function (img) {
      var pr = progress(img);
      var row = [
        img.url || img.image_url || "",
        img.name || "",
        catOf(img),
        fmtTime(img.created_at),
        pr.status
      ];
      DIMS.forEach(function (d) { row.push(arr(img[d[1]]).join("，")); });
      aoa.push(row);
    });

    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = COLS.map(function (h) {
      if (h === "图片URL") return { wch: 58 };
      if (h === "名称") return { wch: 26 };
      if (h === "类目") return { wch: 16 };
      if (h === "上传时间") return { wch: 18 };
      if (h === "打标状态") return { wch: 11 };
      return { wch: 16 };
    });
    ws["!freeze"] = { xSplit: 1, ySplit: 1 };

    /* 类目分布：导出的这份文件里也带一张，方便直接核对覆盖率 */
    var st = catStats(picked);
    var ovAoa = [["类目", "图片数", "未打标", "不完整", "已打标", "覆盖率%"]];
    st.cats.forEach(function (c) {
      ovAoa.push([c.name, c.total, c.none, c.partial, c.done, c.pct]);
    });
    ovAoa.push(["合计", st.total, "", "", "", ""]);
    var ws2 = XLSX.utils.aoa_to_sheet(ovAoa);
    ws2["!cols"] = [{ wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "图片清单");
    XLSX.utils.book_append_sheet(wb, ws2, "类目分布");
    return { wb: wb, images: picked.length, picked: picked, stats: st };
  }

  function download(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* xlsx / jszip 按需加载（前台首屏不背这两个大文件） */
  var LOADED = {};
  function loadScript(src) {
    if (LOADED[src]) return LOADED[src];
    LOADED[src] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("资源加载失败")); };
      document.head.appendChild(s);
    });
    return LOADED[src];
  }
  function ensureXLSX() {
    if (window.XLSX) return Promise.resolve();
    return loadScript("vendor/xlsx.full.min.js?v=" + (window.ASSET_V || "20261027Y"));
  }
  function ensureJSZip() {
    if (window.JSZip) return Promise.resolve();
    return loadScript("vendor/jszip.min.js?v=" + (window.ASSET_V || "20261027Y"));
  }

  var SCOPE_NAME = { all: "全部", none: "仅未打标", partial: "仅不完整", done: "仅已打标" };

  /* 单文件导出 */
  async function exportOne(images, opts, say) {
    opts = opts || {};
    await ensureXLSX();
    var pack = buildBook(images, opts);
    if (!pack.images) { if (say) say("按当前条件没有可导出的图片", false); return 0; }
    var buf = XLSX.write(pack.wb, { bookType: "xlsx", type: "array" });
    var cat = opts.category ? "-" + safeName(opts.category) : "";
    download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "视觉专区-图片清单-" + (SCOPE_NAME[opts.scope] || "全部") + cat + "-" + stamp() + ".xlsx");
    if (say) say("已导出 " + pack.images + " 张图（" + (SCOPE_NAME[opts.scope] || "全部") + "）", true);
    return pack.images;
  }

  /* 按类目拆分：每个类目一个 xlsx，打包 zip */
  async function exportSplit(images, opts, say) {
    opts = opts || {};
    await ensureXLSX();
    await ensureJSZip();
    var st = catStats(filterImages(images, { scope: opts.scope, keyword: opts.keyword }));
    var list = st.cats.filter(function (c) { return c.total > 0; });
    if (!list.length) { if (say) say("没有可拆分的类目", false); return 0; }

    var zip = new JSZip(), files = 0, imgs = 0;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var pack = buildBook(images, {
        scope: opts.scope, keyword: opts.keyword, category: c.name
      });
      if (!pack.images) continue;
      zip.file(safeName(c.name) + ".xlsx", XLSX.write(pack.wb, { bookType: "xlsx", type: "array" }));
      files++; imgs += pack.images;
    }
    if (!files) { if (say) say("按当前条件没有可导出的图片", false); return 0; }
    var blob = await zip.generateAsync({ type: "blob" });
    download(blob, "视觉专区-图片清单-按类目拆分-" + stamp() + ".zip");
    if (say) say("已按类目拆成 " + files + " 个文件，合计 " + imgs + " 张图", true);
    return imgs;
  }

  /* 类目分布表：可点行联动筛选 */
  function renderOverview(box, images, onPick) {
    if (!box) return;
    var st = catStats(images);
    if (!st.cats.length) { box.innerHTML = ""; return; }
    var rows = st.cats.map(function (c) {
      return '<tr data-cat="' + esc(c.name) + '">'
        + '<td class="rk-ov-name">' + esc(c.name) + '</td>'
        + '<td class="rk-ov-num">' + c.total + '</td>'
        + '<td class="rk-ov-num">' + c.none + '</td>'
        + '<td class="rk-ov-num">' + c.done + '</td>'
        + '<td class="rk-ov-bar"><span style="display:inline-block;width:76px;height:6px;background:#e5e7eb;border-radius:3px;vertical-align:middle">'
        + '<i style="display:block;height:6px;border-radius:3px;background:' + (c.pct >= 80 ? "#16a34a" : c.pct >= 40 ? "#d97706" : "#dc2626")
        + ';width:' + c.pct + '%"></i></span> ' + c.pct + '%</td>'
        + '</tr>';
    }).join("");
    box.innerHTML = '<div class="rk-ov-cap">类目分布（共 ' + st.total + ' 张图 / ' + st.cats.length + ' 个类目）</div>'
      + '<table class="rk-ov"><thead><tr><th>类目</th><th>图片数</th><th>未打标</th><th>已打标</th><th>覆盖率</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table>';
    Array.prototype.forEach.call(box.querySelectorAll("tr[data-cat]"), function (tr) {
      tr.onclick = function () { if (onPick) onPick(tr.getAttribute("data-cat")); };
    });
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  window.ImageExport = {
    COLS: COLS, DIMS: DIMS, DIM_TOTAL: DIM_TOTAL, SCOPE_NAME: SCOPE_NAME,
    progress: progress, catStats: catStats, filterImages: filterImages,
    buildBook: buildBook, exportOne: exportOne, exportSplit: exportSplit,
    renderOverview: renderOverview, ensureXLSX: ensureXLSX
  };
})();