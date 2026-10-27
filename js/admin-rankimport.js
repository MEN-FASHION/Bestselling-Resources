/* ============================================================================
 * admin-rankimport.js —— 后台「趋势上升榜 · 打标结果回填」
 * 读回「导出数据」得到的那张 Excel（或第三方按同款表头填好的表），
 * 按「图片URL」把标签写回 rank_image_tags（榜单图标签表，与图库 images 独立）。
 *
 * 三条硬规则：
 *   1) 只认图片URL 精确匹配；匹配不到的行不写、单独计数，绝不凭标题猜。
 *   2) 标签值必须落在枚举内（枚举来自 rankexport.js 的 ENUM）；枚举外的值不写，列进「未识别」清单。
 *   3) 本批写入带 batch_id，事后可按批次回滚，不会误伤人工单改的行。
 * ==========================================================================*/
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var MAP = [
    ["风格", "style_tags", "style"],
    ["图案元素", "element_tags", "element"],
    ["二次工艺", "craft_tags", "craft"],
    ["拍摄方式", "shoot_tags", "shoot"],
    ["视觉-背景", "visual_tags", "visual"],
    ["视觉-画面构成", "visual_tags", "visual"],
    ["视觉-呈现主体", "visual_tags", "visual"],
    ["领型", "fit_tags", "fit领型"],
    ["袖型", "fit_tags", "fit袖型"],
    ["袖长", "fit_tags", "fit袖长"],
    ["衣长", "fit_tags", "fit衣长"],
    ["松紧度", "fit_tags", "fit松紧度"],
    ["裤型", "fit_tags", "fit裤型"],
    ["裤长", "fit_tags", "fit裤长"],
    ["裙长", "fit_tags", "fit裙长"]
  ];

  var parsed = null;     // { rows:[{url, tags:{field:[..]}}], bad:[], unmatched:0 }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes());
  }

  function splitArr(v) {
    return String(v == null ? "" : v).split(/[,，、/|]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function enumOf(key) {
    var E = (window.RankExport && window.RankExport.ENUM) || {};
    if (key.indexOf("fit") === 0) return E[key.slice(3)] || [];
    var m = { style: "风格", element: "图案元素", craft: "二次工艺", shoot: "拍摄方式", visual: "视觉" };
    return E[m[key]] || [];
  }

  function setTip(msg, ok) {
    var el = $("#rank-tag-file-tip");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "rank-file-tip" + (ok === false ? " bad" : ok === true ? " good" : "");
  }

  /* 解析工作簿：优先取「打标表」工作表，否则取第一个 */
  function parseBook(buf) {
    var wb = XLSX.read(buf, { type: "array" });
    var name = wb.SheetNames.indexOf("打标表") >= 0 ? "打标表" : wb.SheetNames[0];
    var aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" });
    if (!aoa.length) return { rows: [], bad: [], unknown: [], headers: [] };
    var headers = (aoa[0] || []).map(function (h) { return String(h || "").trim(); });
    var iUrl = headers.indexOf("图片URL");
    if (iUrl < 0) iUrl = headers.findIndex(function (h) { return /图片\s*url|图片地址|首图/i.test(h); });
    if (iUrl < 0) throw new Error("缺少「图片URL」列");

    var rows = [], bad = [], unknown = {}, seen = {};
    for (var r = 1; r < aoa.length; r++) {
      var line = aoa[r] || [];
      var url = String(line[iUrl] || "").trim();
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) { bad.push({ row: r + 1, why: "URL 格式不对" }); continue; }
      if (seen[url]) continue;
      seen[url] = 1;
      var rec = { url: url, tags: {} };
      MAP.forEach(function (m) {
        var label = m[0], field = m[1], ekey = m[2];
        var ci = headers.indexOf(label);
        if (ci < 0) return;
        var vals = splitArr(line[ci]);
        if (!vals.length) return;
        var allow = enumOf(ekey);
        var list = rec.tags[field] || [];
        vals.forEach(function (v) {
          if (allow.length && allow.indexOf(v) < 0) { unknown[v] = (unknown[v] || 0) + 1; return; }
          if (field === "fit_tags") {
            var group = ekey.slice(3);
            v = group + "·" + v;
          }
          if (list.indexOf(v) < 0) list.push(v);
        });
        if (list.length) rec.tags[field] = list;   /* 全被拒时不写空数组，便于统计"这张图一个有效标签都没有" */
      });
      rows.push(rec);
    }
    var unknownList = Object.keys(unknown).map(function (k) { return { v: k, n: unknown[k] }; })
      .sort(function (a, b) { return b.n - a.n; });
    return { rows: rows, bad: bad, unknown: unknownList, headers: headers, sheet: name };
  }

  async function onFile(file) {
    parsed = null;
    $("#rank-tag-import").disabled = true;
    setTip("正在解析…");
    try {
      var buf = await file.arrayBuffer();
      var res = parseBook(buf);
      var detail = await SB.listRankItems({});
      var exist = {};
      detail.forEach(function (r) { exist[String(r.image_url || "").trim()] = 1; });
      var hit = res.rows.filter(function (x) { return exist[x.url]; });
      var miss = res.rows.length - hit.length;
      parsed = { rows: hit, miss: miss, unknown: res.unknown, bad: res.bad, total: res.rows.length };
      var msg = "解析完成：" + res.sheet + " · 有效 " + res.rows.length + " 张图 · 能对上榜单 "
        + hit.length + " 张" + (miss ? " · 对不上 " + miss + " 张（不会写入）" : "")
        + (res.unknown.length ? " · 枚举外标签 " + res.unknown.length + " 个（不会写入）" : "");
      setTip(msg, hit.length > 0);
      $("#rank-tag-import").disabled = hit.length === 0;
    } catch (e) {
      setTip("解析失败：" + (e && e.message ? e.message : "表格格式不对"), false);
    }
  }

  async function doImport() {
    if (!parsed || !parsed.rows.length) return;
    var btn = $("#rank-tag-import");
    btn.disabled = true;
    var old = btn.textContent;
    btn.textContent = "写入中…";
    try {
      var batch = "tagimport-" + stamp();
      var payload = parsed.rows.map(function (x) {
        return {
          image_url: x.url,
          category: "",
          style_tags: x.tags.style_tags || [],
          element_tags: x.tags.element_tags || [],
          craft_tags: x.tags.craft_tags || [],
          fit_tags: x.tags.fit_tags || [],
          visual_tags: x.tags.visual_tags || [],
          shoot_tags: x.tags.shoot_tags || [],
          scene_tags: [], skin_tags: [], tags: [],
          batch_id: batch
        };
      });
      var n = await SB.saveRankTagRows(payload);
      var msg = "已写入 " + n + " 张图的标签（批次 " + batch + "）"
        + (parsed.miss ? "；跳过对不上榜单的 " + parsed.miss + " 张" : "");
      setTip(msg, true);
      if (window.sbToast) sbToast(msg, true);
    } catch (e) {
      setTip("写入失败，请重试", false);
      if (window.sbToast) sbToast("写入失败，请重试", false);
    } finally {
      btn.disabled = false;
      btn.textContent = old || "写入标签";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var f = $("#rank-tag-file"), b = $("#rank-tag-import");
    if (!f || !b) return;
    f.addEventListener("change", function () {
      var file = f.files && f.files[0];
      if (file) onFile(file);
    });
    b.addEventListener("click", doImport);
  });

  window.RankTagImport = { parseBook: parseBook, MAP: MAP };
})();