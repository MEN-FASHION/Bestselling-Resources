/* ============================================================================
 * admin-rankimport.js —— 后台「趋势上升榜 · 打标结果回填 + 批次撤回」
 *
 * 读回「导出打标表」得到的那张 Excel（或第三方按同款表头填好的表），
 * 按「图片URL」把标签写回 rank_image_tags（榜单图标签表，与图库 images 独立）。
 *
 * 五条硬规则：
 *   1) 只认图片URL 精确匹配；匹配不到的行不写、单独计数，绝不凭标题猜。
 *   2) 标签值必须落在枚举内（枚举来自 rankexport.js 的 ENUM）；枚举外的值不写，列进「未识别」清单。
 *   3) 两种写入模式，解决「重复导入会不会把已有标签冲掉」：
 *        fill       只补空白（默认）—— 已有值的维度一律不动，重复导入同一份表完全无副作用
 *        overwrite  覆盖同名列 —— 用来改错：表里填什么就写什么
 *      覆盖模式下再给一个开关「空单元格也清空」：勾了才会把错标删掉，不勾空单元格=不动。
 *   4) 每一次改动都记 before/after 到 rank_tag_history，撤回时按 before 写回；
 *      且只回滚「当前值仍等于当时写入值」的字段 —— 后来人工改过的不动。
 *   5) 本批写入带 batch_id，事后可按批次撤回，不会误伤别的批次与人工单改的行。
 * ==========================================================================*/
(function () {
  var $ = function (s) { return document.querySelector(s); };

  /* 表头列 → [存储字段, 枚举键] */
  var MAP = [
    ["风格", "style_tags", "style"],
    ["图案元素", "element_tags", "element"],
    ["二次工艺", "craft_tags", "craft"],
    ["拍摄方式", "shoot_tags", "shoot"],
    /* 20261027Q 语义维度：各自独立枚举，填错会被判「未识别」而不是静默写入 */
    ["文化背景", "culture_tags", "culture"],
    ["消费心理", "psych_tags", "psych"],
    /* 20261027R 节日：可选项，留空即「不含节日」，不算未打标 */
    ["节日", "festival_tags", "festival"],
    /* 视觉三列各自校验各自的枚举：旧版三列共用「视觉」大枚举，
       往里填什么都能过，等于没校验。 */
    ["视觉-背景", "visual_tags", "视觉-背景"],
    ["视觉-画面构成", "visual_tags", "视觉-画面构成"],
    ["视觉-呈现主体", "visual_tags", "视觉-呈现主体"],
    ["领型", "fit_tags", "fit领型"],
    ["袖型", "fit_tags", "fit袖型"],
    ["袖长", "fit_tags", "fit袖长"],
    ["衣长", "fit_tags", "fit衣长"],
    ["松紧度", "fit_tags", "fit松紧度"],
    ["裤型", "fit_tags", "fit裤型"],
    ["裤长", "fit_tags", "fit裤长"],
    ["裙长", "fit_tags", "fit裙长"]
  ];

  /* 参与「是否已打标」判断的 8 个主维度（20261027Q 起加入文化背景 / 消费心理）
     20261027R：「节日」是可选维度，**故意不放进这里**——它留空是正常状态，
     放进来会让所有不含节日的基础款永远判成"打标不完整"。 */
  var FIELDS = ["style_tags", "visual_tags", "element_tags", "craft_tags", "shoot_tags", "fit_tags",
                "culture_tags", "psych_tags"];

  var parsed = null;     // { rows:[{url, tags, provided}], fields:[], bad, unknown, headers, sheet }
  var historyOK = null;  // 历史表是否可用（null=未探测）

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes());
  }
  function fmtTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
      + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function splitArr(v) {
    return String(v == null ? "" : v).split(/[,，、|；;]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* 每次调用都重建数组（尤其「节日」要把节庆库 300 多条 concat 一遍），
     上万行的表光这一步就要跑上万次。值表在整个导入过程中不变，缓存即可。 */
  var ENUM_CACHE = {};
  function enumOf(key, noCache) {
    if (!noCache && ENUM_CACHE[key]) return ENUM_CACHE[key];
    var out = enumOfRaw(key);
    if (!noCache) ENUM_CACHE[key] = out;
    return out;
  }
  function enumOfRaw(key) {
    var E = (window.RankExport && window.RankExport.ENUM) || {};
    var list;
    if (E[key]) list = E[key];                       /* 视觉-背景 / 视觉-画面构成 / 视觉-呈现主体 ... */
    else if (key.indexOf("fit") === 0) list = E[key.slice(3)] || [];
    else {
      var m = { style: "风格", element: "图案元素", craft: "二次工艺", shoot: "拍摄方式", visual: "视觉",
                culture: "文化背景", psych: "消费心理", festival: "节日" };
      list = E[m[key]] || [];
    }
    /* 旧口径遗留值继续放行：库里已有的老标签（如「场景实景」）再导回来时
       不该被当成「未识别」丢掉，但导出下拉里不再提供这些老词。 */
    var legacy = (window.RankExport && window.RankExport.VISUAL_LEGACY) || [];
    if (key === "视觉-背景" && legacy.length) return list.concat(legacy);
    /* 节日宽松匹配：后台已加载营销日历的节庆库（window.RAW），
       库里存在的节日名一律放行。这样运营在表里手写「泰国守夏节」这类
       库里有的节日不会被判「未识别」，而拼错的名字照样拦得住。 */
    if (key === "festival") {
      var lib = (typeof window !== "undefined" && Array.isArray(window.RAW)) ? window.RAW : [];
      var extra = [];
      lib.forEach(function (r) {
        var n = r && r[0];
        if (n && list.indexOf(n) < 0 && extra.indexOf(n) < 0) extra.push(n);
      });
      return list.concat(extra);
    }
    return list;
  }

  /* ============================================================
   * 维度间一致性校验（20261027T）
   * ------------------------------------------------------------
   * 为什么要有：这 9 个维度是分别判断的，模型很容易各自"看起来合理"、
   * 合起来自相矛盾。真实踩到的例子——「视觉-呈现主体 = 模特半身」，
   * 同时「拍摄方式 = 摆拍」：有真人穿着就不可能是摆拍。40 张里一次错 16 张。
   *
   * 这里列出几组硬约束（不是风格偏好，是逻辑上互斥）：
   *   模特全身/半身/局部、买家秀 → 只能是「模拍」（可再加「直播截帧」）
   *   人台（假人）                → 只能是「人台拍」
   *   单件平铺/多件组合平铺        → 「平铺拍」或「摆拍」（摆拍=把衣服摆出造型，无人）
   *   挂拍                        → 「挂拍」
   *   3D渲染图                    → 「3D」
   *   细节特写                    → 「细节特写」或「模拍」
   *   手持展示                    → 「模拍」或「摆拍」
   * 只做提示、不阻断导入：口径可能随业务调整，报出来让人判断，比强行改写安全。
   * ============================================================ */
  var SHOOT_RULE = {
    "模特全身": ["模拍", "直播截帧"],
    "模特半身": ["模拍", "直播截帧"],
    "模特局部": ["模拍", "直播截帧"],
    "买家秀": ["模拍", "买家秀"],
    "人台（假人）": ["人台拍"],
    "单件平铺": ["平铺拍", "摆拍"],
    "多件组合平铺": ["平铺拍", "摆拍"],
    "挂拍": ["挂拍"],
    "3D渲染图": ["3D"],
    "细节特写": ["细节特写", "模拍"],
    "手持展示": ["模拍", "摆拍"],
    "摆拍": ["摆拍"]
  };

  /* ------------------------------------------------------------
   * 工艺 vs 图案元素 交叉校验（20261027Y）
   * ------------------------------------------------------------
   * 运营反馈：胸花、局部小图案基本都是烫画（烫图/热转印），数码印花其实很少，
   * 只有满印和定位印花（大幅面）才算数码。实际打出来的标里一堆小图案被标成数码。
   *
   * 所以这里按「图案覆盖面积」判两条硬约束：
   *   a) 元素含「满印 / 局部印花（定位）」而工艺是烫图/热转印 → 大概率应为数码印花
   *   b) 工艺是「数码印花」但元素里没有任何满印/定位类大面积图案 → 大概率应为烫图
   * 另加一条：元素是「纯色/无图案」却填了印花类工艺 → 自相矛盾。
   * 同样只提示、不改写。 */
  /* 只有「满印」能明确表达"整件铺满"。迷彩多数是满印。
     注意「局部印花」字面就是局部，不能算大面积（早先误放进这里，
     导致棒球服后背大面积烫金音符被误报成"大面积却标烫图"）。 */
  var BIG_AREA_PAT = ["满印", "迷彩"];
  var PRINT_CRAFT = ["数码印花", "丝网印花", "发泡印花", "厚板印花", "植绒印花", "反光印花", "烫图/热转印"];

  function checkCraft(rows) {
    var out = [];
    (rows || []).forEach(function (rec) {
      var t = rec.tags || {};
      var els = t.element_tags || [];
      var crs = t.craft_tags || [];
      if (!crs.length) return;

      var hasBig = els.some(function (e) { return BIG_AREA_PAT.indexOf(e) >= 0; });
      var onlyPlain = els.length === 1 && els[0] === "纯色/无图案";
      var hasHeat = crs.indexOf("烫图/热转印") >= 0;
      var hasDigital = crs.indexOf("数码印花") >= 0;

      if (onlyPlain && crs.some(function (c) { return PRINT_CRAFT.indexOf(c) >= 0; })) {
        out.push({ url: rec.url, kind: "craft", msg: "图案元素是「纯色/无图案」，却填了印花类工艺「" + crs.join("，") + "」", expect: "删掉印花工艺，或补上对应的图案元素" });
        return;
      }
      if (hasBig && hasHeat && !hasDigital) {
        out.push({ url: rec.url, kind: "craft", msg: "元素含「" + els.filter(function (e) { return BIG_AREA_PAT.indexOf(e) >= 0; }).join("，") + "」（大幅面）却只填了烫图/热转印", expect: "满印 / 定位印花 应为「数码印花」" });
        return;
      }
      /* 不自动判「数码印花是否该改成烫图」：
         元素名（字母 / 标语文字 / 卡通图案）只说明图案内容，不说明覆盖面积。
         实测 40 张里按元素名推断会误报 11 张——后背整幅大字标语确实用数码印，
         但元素只能写「标语文字」，看起来就像小图案。
         面积要靠看图判断，代码不做这个推断，只保留上面两条硬矛盾。 */
    });
    return out;
  }

  /* 返回矛盾清单：[{ url, subject, shoot, expect }] */
  function checkConsistency(rows) {
    var out = [];
    (rows || []).forEach(function (rec) {
      var t = (rec.tags) || {};
      var subs = t.visual_tags || [];
      var shoots = t.shoot_tags || [];
      if (!subs.length || !shoots.length) return;
      /* 一张图可能有多个主体（如「挂拍，手持展示」）：
         只要有一个主体和拍摄方式对得上，这张图就不算矛盾，避免误报。 */
      var anyHit = false, firstAllow = null;
      subs.forEach(function (sv) {
        var allow = SHOOT_RULE[sv];
        if (!allow) return;
        if (!firstAllow) firstAllow = allow;
        if (shoots.some(function (x) { return allow.indexOf(x) >= 0; })) anyHit = true;
      });
      if (!anyHit && firstAllow) {
        out.push({ url: rec.url, subject: subs.join("，"), shoot: shoots.join("，"), expect: firstAllow.join(" 或 ") });
      }
    });
    return out;
  }

  function sameArr(a, b) {
    var x = Array.isArray(a) ? a : [], y = Array.isArray(b) ? b : [];
    if (x.length !== y.length) return false;
    for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  function setTip(sel, msg, ok) {
    var el = $(sel || "#rank-tag-file-tip");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "rank-file-tip" + (ok === false ? " bad" : ok === true ? " good" : "");
  }

  /* 解析工作簿：优先取「打标表」工作表，否则取第一个
     返回 rows 里每行带 provided（这张图本次真正要写的维度），空白单元格不算"要写" */
  function parseBook(buf) {
    /* 20261027V：先只读工作簿目录（bookSheets，不解单元格），拿到表名后再
       单独解析「打标表」一张。导出的表里还有「全量明细」「枚举参考」两张，
       其中全量明细动辄上万行 —— 整个工作簿一起解析会让解析慢一倍以上。 */
    var wbIndex = XLSX.read(buf, { type: "array", bookSheets: true });
    var name = wbIndex.SheetNames.indexOf("打标表") >= 0 ? "打标表" : (wbIndex.SheetNames[0] || "Sheet1");
    var wb = XLSX.read(buf, { type: "array", sheets: [name] });
    var aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" });
    if (!aoa.length) return { rows: [], bad: [], unknown: [], headers: [], fields: [], sheet: "空表" };
    var headers = (aoa[0] || []).map(function (h) { return String(h || "").trim(); });
    var iUrl = headers.indexOf("图片URL");
    if (iUrl < 0) iUrl = headers.findIndex(function (h) { return /图片\s*url|图片地址|首图/i.test(h); });
    if (iUrl < 0) throw new Error("缺少「图片URL」列");
    var iCat = headers.indexOf("类目");

    /* 表里出现了哪些维度的列（列在就算「本表管这个维度」，用于覆盖模式下的清空判断） */
    var fileFields = [];
    MAP.forEach(function (m) { if (headers.indexOf(m[0]) >= 0 && fileFields.indexOf(m[1]) < 0) fileFields.push(m[1]); });

    var parsed = parseRows(aoa, headers, true);
    /* 字段名要说清楚：parseRows 返回的清单叫 unknown，早先这里读成 unknownList
       → 拿到 undefined → 调用方 res.unknown.length 直接抛
       「Cannot read properties of undefined (reading 'length')」，
       整份表解析失败。 */
    return { rows: parsed.rows, bad: parsed.bad, unknown: parsed.unknown || [],
             headers: headers, fields: fileFields, sheet: name };
  }

  /* 纯函数：表头 + 行数据 → 逐列按各自枚举校验后的结果。
     抽出来是为了能单独测（不必造一个真的 Excel 文件）。 */
  function parseRows(aoa, headersIn, hasHeader) {
    var headers = headersIn || ((aoa && aoa[0]) || []).map(function (h) { return String(h || "").trim(); });
    var iUrl = headers.indexOf("图片URL");
    var iCat = headers.indexOf("类目");
    var rows = [], bad = [], unknown = {}, seen = {};
    /* 早先这里用 headersIn 的有无来推「第一行是不是表头」，但 parseBook 既传 headers
       又传含表头的 aoa —— 表头行被当成数据行读，报「第1行 URL 格式不对」。
       现在由 hasHeader 明确指定：整体表（parseBook）传 true，只传数据行（测试）传 false。 */
    var start = (hasHeader === undefined ? !headersIn : !!hasHeader) ? 1 : 0;
    for (var r = start; r < aoa.length; r++) {
      var line = aoa[r] || [];
      var url = String(line[iUrl] || "").trim();
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) { bad.push({ row: r + 1, why: "URL 格式不对" }); continue; }
      if (seen[url]) continue;
      seen[url] = 1;
      var rec = { url: url, tags: {}, provided: {}, category: iCat >= 0 ? String(line[iCat] || "").trim() : "" };
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
          if (field === "fit_tags") v = ekey.slice(3) + "·" + v;
          if (list.indexOf(v) < 0) list.push(v);
        });
        if (list.length) { rec.tags[field] = list; rec.provided[field] = 1; }
      });
      rows.push(rec);
    }
    var unknownList = Object.keys(unknown).map(function (k) { return { v: k, n: unknown[k] }; })
      .sort(function (a, b) { return b.n - a.n; });
    return { rows: rows, bad: bad, unknown: unknownList, unknownMap: unknown, headers: headers };
  }

  /* 纯函数：把「解析结果 + 库里现状」合并成最终要写的行与历史
     opts: { mode:'fill'|'overwrite', clearEmpty:bool }
     返回 { payload, history, stats:{changed, skipped, fields, untouched} } */
  function applyPlan(rows, exist, fileFields, opts) {
    var o = opts || {};
    var mode = o.mode === "overwrite" ? "overwrite" : "fill";
    var clearEmpty = !!o.clearEmpty;
    var payload = [], history = [];
    var stats = { changed: 0, skipped: 0, fields: 0, untouched: 0 };

    (rows || []).forEach(function (rec) {
      var c = (exist && exist[rec.url]) || {};
      var next = {
        image_url: rec.url,
        category: c.category || rec.category || "",
        style_tags: (c.style_tags || []).slice(),
        element_tags: (c.element_tags || []).slice(),
        scene_tags: (c.scene_tags || []).slice(),
        shoot_tags: (c.shoot_tags || []).slice(),
        skin_tags: (c.skin_tags || []).slice(),
        tags: (c.tags || []).slice(),
        visual_tags: (c.visual_tags || []).slice(),
        craft_tags: (c.craft_tags || []).slice(),
        fit_tags: (c.fit_tags || []).slice(),
        /* 20261027Q / R 新增的三列必须一并从库里带过来。
           否则：本次只改了风格 → 写回时这三列是 undefined → 落库被当成 []，
           原来打好的文化背景/消费心理/节日被静默清空（页面只显示"写入 N 行"，看不出丢数据）。 */
        culture_tags: (c.culture_tags || []).slice(),
        psych_tags: (c.psych_tags || []).slice(),
        festival_tags: (c.festival_tags || []).slice()
      };
      var changes = [];
      FIELDS.forEach(function (f) {
        var before = (c[f] || []).slice();
        var has = !!rec.provided[f];
        if (has) {
          /* 补齐模式：已有值的一律不动 */
          if (mode === "fill" && before.length) { stats.skipped++; return; }
          var after = (rec.tags[f] || []).slice();
          if (!sameArr(before, after)) { next[f] = after; changes.push({ field: f, before: before, after: after }); }
          return;
        }
        /* 覆盖模式 + 空单元格也清空：只有表里确实有这一列才清 */
        if (mode === "overwrite" && clearEmpty && (fileFields || []).indexOf(f) >= 0 && before.length) {
          next[f] = [];
          changes.push({ field: f, before: before, after: [] });
        }
      });
      if (!changes.length) { stats.untouched++; return; }
      stats.changed++;
      stats.fields += changes.length;
      payload.push(next);
      changes.forEach(function (ch) {
        history.push({ image_url: rec.url, field: ch.field, before_tags: ch.before, after_tags: ch.after });
      });
    });
    return { payload: payload, history: history, stats: stats };
  }

  async function onFile(file) {
    parsed = null;
    $("#rank-tag-import").disabled = true;
    setTip(null, "正在解析…");
    try {
      var buf = await file.arrayBuffer();
      var res = parseBook(buf);
      /* 这里只用来判断"表里的图在不在榜单里"，不需要每条记录的全部字段 */
      var detail = await SB.listRankItems({ cols: "image_url" });
      var exist = {};
      detail.forEach(function (r) { exist[String(r.image_url || "").trim()] = 1; });

      /* 取库里已有标签，用来看"这张图已经打过了没有" */
      var hitUrls = res.rows.map(function (x) { return x.url; }).filter(function (u) { return exist[u]; });
      var tagged = {};
      try { tagged = await SB.listRankTagRows(hitUrls); } catch (e) { tagged = {}; }

      var hit = res.rows.filter(function (x) { return exist[x.url]; });
      var already = hit.filter(function (x) {
        var t = tagged[x.url] || {};
        return FIELDS.some(function (f) { return Array.isArray(t[f]) && t[f].length; });
      }).length;

      var miss = res.rows.length - hit.length;
      parsed = { rows: hit, miss: miss, unknown: res.unknown, bad: res.bad, total: res.rows.length,
        exist: tagged, fields: res.fields, fileName: file.name || "", scope: "" };
      /* 维度间自相矛盾：不阻断，但必须显式报出来——
         这类错误在页面上"看着挺正常"，不提示就永远发现不了。 */
      var conflicts = checkConsistency(hit).filter(function (c) {
        var t = tagged[c.url] || {};
        return !(Array.isArray(t.shoot_tags) && t.shoot_tags.length
                 && t.shoot_tags.join("，") === c.shoot);
      });
      parsed.conflicts = conflicts;

      /* 工艺 vs 图案元素：胸花/局部小图案被标成数码印花是高频错误，单独报 */
      var craftIss = checkCraft(hit);
      parsed.craftIssues = craftIss;

      var msg = "解析完成：" + res.sheet + " · 有效 " + res.rows.length + " 张图 · 能对上榜单 " + hit.length + " 张"
        + (miss ? " · 对不上 " + miss + " 张（不会写入）" : "")
        + (already ? " · 其中 " + already + " 张已有标签（补齐模式下会跳过）" : "")
        + (res.unknown.length ? " · 枚举外标签 " + res.unknown.length + " 个（不会写入）" : "");
      if (conflicts.length) {
        var s0 = conflicts[0];
        msg += " ⚠ " + conflicts.length + " 张存在维度矛盾，例如「" + s0.subject + "」却填了「" + s0.shoot
             + "」，应为「" + s0.expect + "」。建议先在表里改掉再导入。";
      }
      if (craftIss.length) {
        var c0 = craftIss[0];
        msg += " ⚠ " + craftIss.length + " 张工艺与图案对不上，例如：" + c0.msg + "，" + c0.expect + "。";
      }
      setTip(null, msg, hit.length > 0);
      refreshPlan();
      $("#rank-tag-import").disabled = hit.length === 0;
    } catch (e) {
      setTip(null, "解析失败：" + (e && e.message ? e.message : "表格格式不对"), false);
    }
  }

  function modeOpts() {
    var m = $("#rank-tag-mode");
    var ce = $("#rank-tag-clear-empty");
    return { mode: m ? m.value : "fill", clearEmpty: !!(ce && ce.checked) };
  }

  /* 按当前模式预估：会改多少张、跳过多少 */
  function refreshPlan() {
    if (!parsed) return null;
    var plan = applyPlan(parsed.rows, parsed.exist, parsed.fields, modeOpts());
    var tip = $("#rank-tag-plan-tip");
    if (tip) {
      tip.textContent = "按当前模式：将改动 " + plan.stats.changed + " 张图（" + plan.stats.fields + " 个字段）"
        + (plan.stats.skipped ? "；因已有标签跳过 " + plan.stats.skipped + " 处" : "")
        + (plan.stats.untouched ? "；无变化 " + plan.stats.untouched + " 张" : "");
    }
    return plan;
  }

  async function checkHistory() {
    if (historyOK !== null) return historyOK;
    try {
      await SB.listRankTagHistory("__probe__");
      await SB.listRankTagBatches(1);
      historyOK = true;
    } catch (e) {
      historyOK = false;
    }
    return historyOK;
  }

  async function doImport() {
    if (!parsed || !parsed.rows.length) return;
    var btn = $("#rank-tag-import");
    var opts = modeOpts();
    var plan = applyPlan(parsed.rows, parsed.exist, parsed.fields, opts);
    if (!plan.payload.length) {
      setTip(null, "没有需要写入的改动（当前模式下所有行要么已有标签、要么没填）", false);
      return;
    }
    btn.disabled = true;
    var old = btn.textContent;
    btn.textContent = "写入中…";
    try {
      var canHistory = await checkHistory();
      var batch = "tagimport-" + stamp();
      var payload = plan.payload.map(function (x) {
        var r = {};
        Object.keys(x).forEach(function (k) { r[k] = x[k]; });
        r.batch_id = batch;
        return r;
      });
      var n = await SB.saveRankTagRows(payload);

      var historySaved = 0, historyWarn = "";
      if (canHistory) {
        try {
          var hist = plan.history.map(function (h) {
            return { batch_id: batch, image_url: h.image_url, field: h.field, before_tags: h.before_tags, after_tags: h.after_tags };
          });
          historySaved = await SB.saveRankTagHistory(hist);
        } catch (e) { historyWarn = "；历史记录写入失败，本批无法精确撤回"; }
      } else {
        historyWarn = "；历史表不可用（未执行 patch_20261027J），本批只能整批清空、不能精确撤回";
      }

      if (canHistory) {
        try {
          await SB.saveRankTagBatch({
            batch_id: batch,
            file_name: parsed.fileName,
            mode: opts.mode,
            image_count: parsed.total,
            changed_count: plan.stats.changed,
            field_count: plan.stats.fields,
            skipped_count: plan.stats.skipped,
            unmatched_count: parsed.miss,
            unknown_tags: parsed.unknown.map(function (x) { return x.v; }),
            status: "applied",
            note: (opts.clearEmpty ? "空单元格清空" : ""),
          });
        } catch (e) { historyWarn += "；批次台账写入失败"; }
      }

      /* 逐维统计本批真正写进去的行数：节日这类可选维度，
         用户在表里填了却因为「列不存在」被判"写入成功"，会一直找不到原因。
         这里把每一维写了几行报出来，数不对立刻能看出来。 */
      var dimOf = { style_tags: "风格", visual_tags: "视觉", element_tags: "图案元素", craft_tags: "二次工艺",
                    shoot_tags: "拍摄方式", fit_tags: "版型", culture_tags: "文化背景",
                    psych_tags: "消费心理", festival_tags: "节日" };
      var cntDim = {};
      (plan.payload || []).forEach(function (r) {
        Object.keys(dimOf).forEach(function (f) {
          if ((r[f] || []).length) cntDim[f] = (cntDim[f] || 0) + 1;
        });
      });
      var dimTxt = Object.keys(dimOf).map(function (f) {
        return dimOf[f] + " " + (cntDim[f] || 0);
      }).join(" · ");

      var msg = "已写入 " + n + " 张图的标签（批次 " + batch + "，"
        + (opts.mode === "overwrite" ? "覆盖" : "补齐") + "模式）"
        + (plan.stats.skipped ? "；跳过已有标签 " + plan.stats.skipped + " 处" : "")
        + (parsed.miss ? "；跳过对不上榜单的 " + parsed.miss + " 张" : "")
        + historyWarn
        + "。本批各维度写入行数：" + dimTxt;
      if (!(cntDim.festival_tags || 0)) {
        msg += "（节日 0 行＝表里这列是空的，或该列在数据库里不存在）";
      }
      setTip(null, msg, true);
      if (window.sbToast) sbToast("已写入 " + n + " 张图的标签", true);
      loadTagBatches();
    } catch (e) {
      setTip(null, "写入失败，请重试", false);
      if (window.sbToast) sbToast("写入失败，请重试", false);
    } finally {
      btn.disabled = false;
      btn.textContent = old || "写入标签";
    }
  }

  /* 纯函数：算「撤回某批次」要写回什么
     hist: [{image_url, field, before_tags, after_tags}]
     cur : { 图片URL: 库里当前那一行 }
     规则：只回滚「当前值仍 === 当时写入值」的字段；
           该字段之后又被别的批次或人工改过 → 跳过并计数，绝不覆盖新改动。 */
  function planRevert(hist, cur) {
    var byUrl = new Map();
    (hist || []).forEach(function (h) {
      var u = String(h.image_url || "").trim();
      var f = String(h.field || "").trim();
      if (!u || !f) return;
      var m = byUrl.get(u);
      if (!m) { m = {}; byUrl.set(u, m); }
      m[f] = { before: Array.isArray(h.before_tags) ? h.before_tags : [], after: Array.isArray(h.after_tags) ? h.after_tags : [] };
    });
    var payload = [], restored = 0, conflict = 0;
    byUrl.forEach(function (fields, u) {
      var c = (cur || {})[u];
      if (!c) { conflict += Object.keys(fields).length; return; }
      var next = {
        image_url: u,
        category: c.category || "",
        style_tags: (c.style_tags || []).slice(),
        element_tags: (c.element_tags || []).slice(),
        scene_tags: (c.scene_tags || []).slice(),
        shoot_tags: (c.shoot_tags || []).slice(),
        skin_tags: (c.skin_tags || []).slice(),
        tags: (c.tags || []).slice(),
        visual_tags: (c.visual_tags || []).slice(),
        craft_tags: (c.craft_tags || []).slice(),
        fit_tags: (c.fit_tags || []).slice(),
        /* 与 applyPlan 同理：撤回时若不带上这三列，写回会把它们清成空数组，
           表现为「撤回一批旧标签，顺手把文化背景/消费心理/节日也删了」。 */
        culture_tags: (c.culture_tags || []).slice(),
        psych_tags: (c.psych_tags || []).slice(),
        festival_tags: (c.festival_tags || []).slice(),
        batch_id: null
      };
      var touched = false;
      Object.keys(fields).forEach(function (f) {
        var h = fields[f];
        if (sameArr(next[f], h.after)) { next[f] = h.before.slice(); restored++; touched = true; }
        else conflict++;
      });
      if (touched) payload.push(next);
    });
    return { payload: payload, restored: restored, conflict: conflict, total: byUrl.size };
  }

  /* ---------------- 批次列表 + 撤回 ---------------- */
  async function loadTagBatches() {
    var box = $("#rank-tag-batch-list");
    if (!box) return;
    box.innerHTML = '<div class="hint">正在读取…</div>';
    var list = [];
    try { list = await SB.listRankTagBatches(60); }
    catch (e) {
      box.innerHTML = '<div class="hint">批次台账不可用：请先执行 patch_20261027J.sql，之后每批导入都会留下可撤回的记录</div>';
      return;
    }
    if (!list.length) { box.innerHTML = '<div class="rkadm-empty">还没有打标导入记录</div>'; return; }
    box.innerHTML = "";
    list.forEach(function (b) {
      var row = document.createElement("div");
      row.className = "rank-batch-row";

      var main = document.createElement("span");
      main.className = "rank-batch-main";
      var st = b.status === "reverted" ? "已撤回" : "已写入";
      main.textContent = fmtTime(b.created_at) + " · " + b.batch_id
        + " · " + (b.mode === "overwrite" ? "覆盖" : "补齐")
        + " · 改动 " + (b.changed_count || 0) + " 张 / " + (b.field_count || 0) + " 字段"
        + (b.skipped_count ? " · 跳过 " + b.skipped_count : "")
        + (b.unmatched_count ? " · 对不上 " + b.unmatched_count : "")
        + " · " + st + (b.file_name ? " · " + b.file_name : "");

      var act = document.createElement("span");
      act.className = "rkadm-row-act";

      var undo = document.createElement("button");
      undo.type = "button";
      undo.className = "btn-ghost small rank-batch-del";
      undo.textContent = b.status === "reverted" ? "已撤回" : "撤回本批";
      undo.disabled = b.status === "reverted";
      undo.onclick = async function () {
        if (!confirm("撤回批次「" + b.batch_id + "」？\n\n会把这次改动前的标签写回去（涉及 "
          + (b.changed_count || 0) + " 张图）。\n此后再被人改过的字段会跳过、不会被覆盖。\n撤回本身也记在案，撤回后不能重做。")) return;
        undo.disabled = true;
        undo.textContent = "撤回中…";
        try {
          var hist = await SB.listRankTagHistory(b.batch_id);
          if (!hist.length) throw new Error("该批次没有历史记录，无法精确撤回（可能是建在 20261027J 之前）");
          var urls = [];
          hist.forEach(function (h) { if (urls.indexOf(h.image_url) < 0) urls.push(h.image_url); });
          var cur = await SB.listRankTagRows(urls);
          var plan = planRevert(hist, cur);
          if (plan.payload.length) await SB.saveRankTagRows(plan.payload);
          await SB.updateRankTagBatch(b.batch_id, { status: "reverted", reverted_at: new Date().toISOString() });
          var m = "已撤回：恢复 " + plan.restored + " 个字段（" + plan.payload.length + " 张图）"
            + (plan.conflict ? "；跳过 " + plan.conflict + " 个已被后续修改的字段" : "");
          setTip("#rank-tag-batch-tip", m, true);
          if (window.sbToast) sbToast(m, true);
        } catch (e) {
          var why = (e && e.message) || "撤回失败";
          setTip("#rank-tag-batch-tip", why, false);
          if (window.sbToast) sbToast(why, false);
        }
        loadTagBatches();
      };

      act.appendChild(undo);
      row.appendChild(main);
      row.appendChild(act);
      box.appendChild(row);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var f = $("#rank-tag-file"), b = $("#rank-tag-import");
    if (f && b) {
      f.addEventListener("change", function () {
        var file = f.files && f.files[0];
        if (file) onFile(file);
      });
      b.addEventListener("click", doImport);
    }
    var m = $("#rank-tag-mode"), ce = $("#rank-tag-clear-empty");
    if (m) m.addEventListener("change", function () {
      if (ce) ce.disabled = m.value !== "overwrite";
      if (ce && m.value !== "overwrite") ce.checked = false;
      refreshPlan();
    });
    if (ce) ce.addEventListener("change", refreshPlan);
    var rf = $("#rank-tag-batch-refresh");
    if (rf) rf.addEventListener("click", loadTagBatches);
    probeCols();
  });

  window.RankTagImport = {
    parseBook: parseBook, MAP: MAP, applyPlan: applyPlan, planRevert: planRevert, FIELDS: FIELDS,
    checkConsistency: checkConsistency, checkCraft: checkCraft,
    SHOOT_RULE: SHOOT_RULE, CRAFT_BIG_AREA: BIG_AREA_PAT,
    /* 测试入口：传入的 aoa 仍以「表头行」开头（与 parseBook 同语义） */
    __test: { parseRows: function (rows) { return parseRows(rows, null, true); } },
    probeCols: probeCols
  };

  /* 数据库列自检：某个补丁没跑时，读取会「静默降级」——
     页面只是少一栏，不报错，用户根本看不出是数据没打还是列不存在。
     这里直接把缺哪一列写出来。 */
  /* 打标数据体检：一次问清三件事——
     ① 该有的列在不在（补丁跑没跑）
     ② 每一维在库里到底有多少行有值（打没打进去）
     ③ 哪一维是 0（通常是漏了这一步）
     "打了标却看不到"这个问题，90% 是①②之一，不用再靠猜。 */
  function probeCols() {
    var box = $("#rank-tag-colstatus");
    if (!box || !window.SB || !SB.statRankTagDims) return;
    box.textContent = "正在体检打标数据…";
    box.style.color = "";
    SB.statRankTagDims().then(function (r) {
      var missing = [], zero = [], parts = [];
      Object.keys(r.stat).forEach(function (k) {
        var o = r.stat[k];
        if (o.missing) { missing.push(k); return; }
        parts.push(k + " " + o.n);
        if (!o.n) zero.push(k);
      });
      var h = "";
      if (missing.length) {
        h += '<span style="color:#b91c1c">⚠ 数据库缺少维度列：<b>' + missing.join("、") + '</b>'
          + '（节日 → <code>tools/patch_20261027R.sql</code>；文化/心理 → <code>tools/patch_20261027Q.sql</code>）</span>'
          + '<br><span style="color:#666">缺列时这几维写不进去、也读不出来，页面不会报错，只会「少一栏」。</span><br>';
      }
      h += '库里共 <b>' + r.total + '</b> 行打标记录 · 各维度有值行数：' + parts.join(" · ");
      if (zero.length) {
        h += '<br><span style="color:#b45309">⚠ 这些维度目前一行都没有：<b>' + zero.join("、")
          + '</b>。如果表里填过，检查导入时是否被判「未识别」，或这列的列名和表头不一致。</span>';
      }
      if (!missing.length && !zero.length) {
        h += '<br><span style="color:#15803d">✓ 数据齐全，前台应能正常显示。</span>';
      }
      box.innerHTML = h;
    }, function () {
      box.textContent = "体检失败：无法读取打标表（可能表还没建）";
      box.style.color = "#b91c1c";
    });
  }

  /* 后台榜单面板打开时才读批次，避免进后台就发请求 */
  window.RankTagBatches = { load: loadTagBatches };
})();
