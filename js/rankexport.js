/* ============================================================================
 * rankexport.js —— 趋势上升榜「导出打标表」（后台专用，20261027J 起前台不再出现）
 *
 * 只在 admin.html 里加载；前台 rank.html 已移除按钮与引用 —— 导出属于管理动作，
 * 放在前台会让所有访客都能拉走整张榜单（含未上线期次）。
 *
 * 依赖：SB（supabase.js）、XLSX（vendor/xlsx.full.min.js）
 * 三个工作表：
 *   1) 打标表   按图片地址去重，一行一张图；带「打标状态」列（已打标 / 部分 n/8 / 未打标）
 *              20261027R 起多一列「节日」——它是**可选项**，不含节日的常规款留空即可，
 *              留空不影响「已打标」判定（否则基础款会永远卡在"打标不完整"）。
 *   2) 全量明细 原始每一行（期次/站点/类目/位次/环比），不做去重
 *   3) 枚举参考 每个维度允许取的标签值，供填表与导入校验用
 *
 * 导出范围（scope）——解决「已经打过标的又被导出来」的问题：
 *   todo    仅未打标（8 个主维度一个都没填）—— 默认，增量打标就导这个
 *   partial 仅打标不完整（填了但没填全）
 *   done    仅已打标（8 个主维度齐全）—— 用来核对 / 改正打错的标
 *   all     全部（含已打标，标签预填）
 * 另外可按「类目」和「关键词（图片URL / 类目 / 叶子类目）」再收窄；
 * 改正个别打错的图时：范围选 done + 关键词输入该图地址，即可只导出这一张。
 * ==========================================================================*/
(function () {
  var COLS = [
    "图片URL", "类目", "叶子类目", "出现期次", "站点", "最优位次", "最高环比%", "打标状态",
    "风格", "视觉-背景", "视觉-画面构成", "视觉-呈现主体",
    "图案类型", "图案元素", "结构部件", "面料", "二次工艺", "拍摄方式",
    "文化背景", "消费心理",
    "节日",
    "领型", "袖型", "袖长", "衣长", "松紧度", "裤型", "裤长", "裙长",
    "备注"
  ];

  /* 判断「打没打全」用的 8 个主维度 → 对应表里的字段
     20261027Q：新增「文化背景」「消费心理」两个语义层维度（原来 6 个只覆盖
     可见的视觉属性，答不出"这身衣服来自哪种文化、想打动谁"）。 */
  var DIMS = [
    ["风格", "style_tags"],
    ["视觉", "visual_tags"],
    ["图案元素", "element_tags"],
    ["二次工艺", "craft_tags"],
    ["拍摄方式", "shoot_tags"],
    ["版型", "fit_tags"],
    ["文化背景", "culture_tags"],
    ["消费心理", "psych_tags"]
  ];
  var DIM_TOTAL = DIMS.length;

  /* 可选项：节日。
     「不含节日元素的常规款」是多数，所以节日留空是正常状态，不能算作"打标不完整"，
     否则每件基础款都会永远卡在「部分 n/8」，统计和筛选全废。
     因此它不进 DIMS（不计入分母），单独列在这里只用于导出取值与状态提示。 */
  var OPT_DIMS = [["节日", "festival_tags"]];

  /* ---------------- 视觉三个子分组 ----------------
     20261027O：原来「视觉」是一个 19 项的大枚举，三列共用，导致
       ① 场景只写「场景实景」，看不出用了什么场景、什么道具；
       ② 平铺被当成背景/构图，和摆拍挂拍这些「衣服怎么呈现」混在一起。
     现在按语义拆成三组，各自独立枚举、各自校验：
       视觉-背景     = 衣服身后/底下是什么（含具体场景与道具）
       视觉-画面构成 = 一张图怎么排版（单图 / 拼图 / 带角标 …）
       视觉-呈现主体 = 衣服以什么形态出现（平铺 / 摆拍 / 挂拍 / 模特 / 人台 …）
     平铺按用户要求归入「呈现主体」，与摆拍、挂拍同类。 */
  /* 视觉三组枚举来自 js/rank-enums.js（前后台共用同一份，避免各写一套走样） */
  var VE = window.RANK_VISUAL_ENUM || {};
  var VISUAL_BG = VE.bg || [];
  var VISUAL_FRAME = VE.frame || [];
  var VISUAL_SUBJECT = VE.subject || [];
  var VISUAL_LEGACY = VE.legacy || [];

  /* ============================================================
   * 二次工艺判定口径（20261027Y）
   * ------------------------------------------------------------
   * 为什么要写死这张表：运营反馈「胸花、局部小图案基本都是烫画（烫图/热转印），
   * 数码印花的其实很少——只有满印和定位印花（大幅面）才算数码」，
   * 而实际打出来的标里，一堆小面积卡通 / 标语图案被标成了数码印花。
   * 根因是「数码印花」这个词听起来最高级、最泛，模型没有面积概念就会默认选它。
   *
   * 这张表把判定依据固定成「图案覆盖面积 + 颜色数」，填表时按此判断，
   * 导出的「枚举参考」工作表第三列会带上这些口径，人和模型都能对照。
   * ============================================================ */
  var CRAFT_GUIDE = {
    "烫图/热转印": "【默认项】单个图案、胸花、局部小面积印花（含卡通、字母、标语、LOGO、单朵花）。绝大多数局部图案都是烫画，拿不准时选这个",
    "数码印花": "只用于【满印】或【定位印花】（图案大幅面覆盖、整幅铺开、多色渐变照片级）。小块图案不要选这个",
    "丝网印花": "单色或少色、大面积色块的平涂印（前胸大色块、条杠），非照片级、无明显渐变",
    "刺绣": "有绣线立体感、针脚可见（含贴布绣/珠片绣另选）",
    "烫钻": "有水钻/烫钻颗粒反光，不是印上去的图案",
    "发泡印花": "图案有立体发泡凸起、边缘厚实",
    "植绒印花": "图案表面有绒毛质感",
    "反光印花": "图案在光下有反光条/反光涂层"
  };
  /* 面积口径速查：局部（单个图案/胸花）→ 烫图；整幅铺满 → 数码；大色块 → 丝网 */
  var CRAFT_HINT = "局部小图案（胸花、单个卡通/字母/标语）默认烫图/热转印；只有满印、定位印花这类大幅面才是数码印花";

  /* 所有枚举统一来自 js/rank-enums.js（全站唯一来源）。
     本文件不再维护任何词表——榜单、视觉专区、周报三处共用一份，
     改词只改 rank-enums.js，不会出现两边取值对不上。 */
  var AE = window.APP_ENUM || {};
  var ENUM = {
    风格: AE["风格"] || [],
    "视觉-背景": VISUAL_BG,
    "视觉-画面构成": VISUAL_FRAME,
    "视觉-呈现主体": VISUAL_SUBJECT,
    /* 三组合并视图：只用于「打标进度 / 统计」，不参与逐列校验 */
    视觉: VISUAL_BG.concat(VISUAL_FRAME, VISUAL_SUBJECT),
    图案类型: AE["图案类型"] || [],
    图案元素: AE["图案元素"] || [],
    结构部件: AE["结构部件"] || [],
    面料: AE["面料"] || [],
    二次工艺: AE["二次工艺"] || [],
    拍摄方式: AE["拍摄方式"] || [],
    模特: AE["模特"] || [],
    文化背景: VE.culture || [],
    消费心理: VE.psych || [],
    节日: VE.festival || [],
    领型: AE["领型"] || [],
    袖型: AE["袖型"] || [],
    袖长: AE["袖长"] || [],
    衣长: AE["衣长"] || [],
    松紧度: AE["松紧度"] || [],
    裤型: AE["裤型"] || [],
    裤长: AE["裤长"] || [],
    裙长: AE["裙长"] || [],
    腰型: AE["腰型"] || []
  };
;

  function splitArr(v) {
    return String(v == null ? "" : v).split(/[,，、|；;]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes());
  }

  function arrOf(v) {
    return Array.isArray(v) ? v.filter(function (x) { return String(x == null ? "" : x).trim(); }) : [];
  }

  /* 一张图的打标进度：填了几个主维度、状态文案 */
  function dimProgress(tag) {
    var t = tag || {};
    var filled = 0;
    DIMS.forEach(function (d) { if (arrOf(t[d[1]]).length) filled++; });
    /* 节日是可选维度：只有它填了不算"已打标"，但也别当成"完全没打"，
       否则导出「仅未打标」时会把它反复导出来。 */
    var optFilled = 0;
    OPT_DIMS.forEach(function (d) { if (arrOf(t[d[1]]).length) optFilled++; });
    var status;
    if (filled === 0) status = optFilled ? "部分 0/" + DIM_TOTAL + "（仅节日）" : "未打标";
    else if (filled === DIM_TOTAL) status = "已打标";
    else status = "部分 " + filled + "/" + DIM_TOTAL;
    return { filled: filled, optFilled: optFilled, status: status };
  }

  /* 按 scope 判断这张图要不要导出 */
  function inScope(filled, scope, optFilled) {
    var s = String(scope || "todo");
    var opt = optFilled || 0;
    if (s === "all") return true;
    /* 「仅未打标」= 8 维一个都没填 **且** 节日也没填。
       只有节日的不算未打标，否则每次导出都会把它重复导出来。 */
    if (s === "todo") return filled === 0 && !opt;
    if (s === "partial") return filled > 0 && filled < DIM_TOTAL;
    if (s === "done") return filled === DIM_TOTAL;
    return true;
  }

  function download(blob, name) {
    var a = document.createElement("a");
    var url = URL.createObjectURL(blob);
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* 按图片地址聚合成「一行一张图」 */
  function collectImages(detail) {
    var byUrl = new Map();
    (detail || []).forEach(function (r) {
      var u = String(r.image_url || "").trim();
      if (!u) return;
      var hit = byUrl.get(u);
      if (!hit) {
        hit = { url: u, cats: {}, periods: {}, sites: {}, leaf: {}, leafLeaf: {}, bestRank: null, bestRatio: null };
        byUrl.set(u, hit);
      }
      if (r.category) hit.cats[r.category] = 1;
      if (r.leaf_category) {
        hit.leaf[r.leaf_category] = 1;
        /* 叶子类目是整条路径（「服装、鞋靴和珠宝饰品,男士时尚,男装,T 恤」），
           做类目维度统计和筛选时，真正有用的是最后一级。 */
        var lv = String(r.leaf_category).split(/[,，]/).pop().trim();
        if (lv) hit.leafLeaf[lv] = 1;
      }
      if (r.period_label) hit.periods[r.period_label] = 1;
      if (r.site) hit.sites[r.site] = 1;
      if (r.rank_ratio != null && (hit.bestRank == null || r.rank_ratio < hit.bestRank)) hit.bestRank = r.rank_ratio;
      if (r.ratio != null && (hit.bestRatio == null || r.ratio > hit.bestRatio)) hit.bestRatio = r.ratio;
    });
    return byUrl;
  }

  /* 类目筛选：支持两种粒度
       c:主类目      —— 与榜单里的「类目」完全一致
       l:叶子末级    —— 匹配叶子路径的最后一段（「男士 T 恤和背心」这类）
     不带前缀时两种都试，兼容旧的选择值。 */
  function hitCat(h, sel) {
    var v = String(sel || "").trim();
    if (!v) return true;
    if (v.indexOf("c:") === 0) return !!h.cats[v.slice(2)];
    if (v.indexOf("l:") === 0) return !!h.leafLeaf[v.slice(2)];
    return !!h.cats[v] || !!h.leafLeaf[v];
  }

  /* 类目分布：每个主类目 / 叶子末级各有多少张图、打标进度如何
     用途一：导出下拉里带出「共 N 张」，选之前就知道量级；
     用途二：后台的类目概览，先看哪一类没打满，再决定优化哪一类。 */
  function catStats(detail, tagMap) {
    var byUrl = collectImages(detail);
    var map = { c: {}, l: {} };
    byUrl.forEach(function (h) {
      var t = (tagMap && tagMap[h.url]) || {};
      var pr = dimProgress(t);
      var st = pr.filled === 0 && !pr.optFilled ? "todo" : (pr.filled === DIM_TOTAL ? "done" : "partial");
      var add = function (box, name) {
        var o = box[name] || (box[name] = { name: name, total: 0, todo: 0, partial: 0, done: 0 });
        o.total++;
        o[st]++;
      };
      Object.keys(h.cats).forEach(function (n) { add(map.c, n); });
      Object.keys(h.leafLeaf).forEach(function (n) { add(map.l, n); });
    });
    var sortDesc = function (box) {
      return Object.keys(box).map(function (k) { return box[k]; })
        .sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name); });
    };

    /* 维度体检（20261027Y）：数一遍每个维度到底有多少行有值。
       运营反复反馈「打了标前台看不到」，光看覆盖率看不出来是"数据没写进去"
       还是"列不存在"还是"确实没打"。这里把 9 个维度各自的有值行数摆出来，
       哪个维度是 0 一眼就知道。节日是可选维度，为 0 属正常（多数款没有节日元素）。 */
    var dims = [
      ["风格", "style_tags"], ["视觉", "visual_tags"], ["图案元素", "element_tags"],
      ["图案类型", "pattern_tags"], ["结构部件", "struct_tags"], ["面料", "fabric_tags"],
      ["二次工艺", "craft_tags"], ["拍摄方式", "shoot_tags"], ["版型", "fit_tags"],
      ["文化背景", "culture_tags"], ["消费心理", "psych_tags"], ["节日", "festival_tags"]
    ];
    var dimCount = {};
    dims.forEach(function (d) { dimCount[d[0]] = 0; });
    byUrl.forEach(function (h) {
      var t = (tagMap && tagMap[h.url]) || {};
      dims.forEach(function (d) {
        var v = t[d[1]];
        if (Array.isArray(v) && v.length) dimCount[d[0]]++;
      });
    });

    return { cats: sortDesc(map.c), leaves: sortDesc(map.l), total: byUrl.size,
             dims: dims.map(function (d) { return { name: d[0], field: d[1], has: dimCount[d[0]] }; }),
             taggedRows: Object.keys(tagMap || {}).length };
  }

  /* 组装工作簿
     opts: { scope:'todo'|'partial'|'done'|'all', category:'', keyword:'', periodType:'', title:'' }
     返回 { wb, images, rows, picked:[url], stats:{total, todo, partial, done, picked} } */
  function buildBook(detail, tagMap, opts) {
    var o = opts || {};
    /* 期次类型过滤（20261109C）：月度面板里导出时只导月度图，别把周度的也带出去。
       week / month，留空 = 全部（周度面板沿用这个默认，行为不变）。 */
    if (o.periodType) {
      detail = (detail || []).filter(function (r) { return ((r && r.period_type) || "week") === o.periodType; });
    }
    /* 20261109H：再按期次收窄（导出普通调用也会走这里，取数层已经收窄，这里兜一次底） */
    if (o.period) {
      detail = (detail || []).filter(function (r) { return String((r && r.period_label) || "") === o.period; });
    }
    var byUrl = collectImages(detail);
    var stats = { total: byUrl.size, todo: 0, partial: 0, done: 0, picked: 0 };
    var kw = String(o.keyword || "").trim().toLowerCase();
    var cat = String(o.category || "").trim();

    var head = COLS.slice();
    var aoa = [head];
    var picked = [];

    Array.from(byUrl.keys()).sort().forEach(function (u) {
      var h = byUrl.get(u);
      var t = (tagMap && tagMap[u]) || {};
      var pr = dimProgress(t);
      if (pr.filled === 0 && !pr.optFilled) stats.todo++;
      else if (pr.filled === DIM_TOTAL) stats.done++;
      else stats.partial++;

      if (!hitCat(h, cat)) return;
      if (kw) {
        var hay = [u, Object.keys(h.cats).join(" "), Object.keys(h.leaf).join(" ")].join(" ").toLowerCase();
        if (hay.indexOf(kw) < 0) return;
      }
      if (!inScope(pr.filled, o.scope, pr.optFilled)) return;

      /* 视觉按三组分流填到对应列：不再一股脑塞进「视觉-背景」，
         否则在导出表里根本看不出哪一项属于背景、哪一项属于呈现主体。 */
      var vAll = arrOf(t.visual_tags);
      var vBg = vAll.filter(function (x) { return VISUAL_BG.indexOf(String(x)) >= 0 || VISUAL_LEGACY.indexOf(String(x)) >= 0; }).join("，");
      var vFr = vAll.filter(function (x) { return VISUAL_FRAME.indexOf(String(x)) >= 0; }).join("，");
      var vSj = vAll.filter(function (x) { return VISUAL_SUBJECT.indexOf(String(x)) >= 0; }).join("，");
      var fit = arrOf(t.fit_tags);
      var pickFit = function (g) {
        var hit = fit.filter(function (x) { return String(x).indexOf(g + "·") === 0; });
        return hit.length ? hit[0].split("·")[1] : "";
      };
      aoa.push([
        u,
        Object.keys(h.cats).join("，"),
        Object.keys(h.leaf).join("，"),
        Object.keys(h.periods).sort().join("，"),
        Object.keys(h.sites).join("，"),
        h.bestRank == null ? "" : h.bestRank,
        h.bestRatio == null ? "" : h.bestRatio,
        pr.status,
        arrOf(t.style_tags).join("，"),
        vBg,
        vFr, vSj,
        arrOf(t.pattern_tags).join("，"),
        arrOf(t.element_tags).join("，"),
        arrOf(t.struct_tags).join("，"),
        arrOf(t.fabric_tags).join("，"),
        arrOf(t.craft_tags).join("，"),
        arrOf(t.shoot_tags).join("，"),
        arrOf(t.culture_tags).join("，"),
        arrOf(t.psych_tags).join("，"),
        arrOf(t.festival_tags).join("，"),
        pickFit("领型"), pickFit("袖型"), pickFit("袖长"), pickFit("衣长"),
        pickFit("松紧度"), pickFit("裤型"), pickFit("裤长"), pickFit("裙长"),
        ""
      ]);
      picked.push(u);
    });
    stats.picked = picked.length;

    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = head.map(function (h) {
      if (h === "图片URL") return { wch: 58 };
      if (h === "出现期次" || h === "叶子类目" || h === "类目") return { wch: 18 };
      if (h === "打标状态") return { wch: 11 };
      if (h === "备注") return { wch: 24 };
      return { wch: 13 };
    });
    ws["!freeze"] = { xSplit: 1, ySplit: 1 };

    var keep = {};
    picked.forEach(function (u) { keep[u] = 1; });
    var detailAoa = [["期次类型", "期次", "类目", "站点", "叶子类目", "图片URL", "环比比例%", "环比绝对值", "潜力机会", "趋势爆款", "周度激增"]];
    (detail || []).forEach(function (r) {
      if (!keep[String(r.image_url || "").trim()]) return;
      detailAoa.push([
        r.period_type || "", r.period_label || "", r.category || "", r.site || "",
        r.leaf_category || "", r.image_url || "",
        r.ratio == null ? "" : r.ratio, r.abs_delta == null ? "" : r.abs_delta,
        r.flag_opportunity ? "是" : "", r.flag_hot ? "是" : "", r.flag_surge ? "是" : ""
      ]);
    });
    var ws2 = XLSX.utils.aoa_to_sheet(detailAoa);
    ws2["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 58 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];

    var enumAoa = [["维度/子分组", "允许的取值（逗号分隔，导入时逐值校验）", "判定口径 / 备注"]];
    Object.keys(ENUM).forEach(function (k) {
      var note = "";
      if (k === "二次工艺") note = CRAFT_HINT;
      if (k === "图案类型") note = "纹样/肌理/印花方式；与「图案元素」互不替代，可同时填（格纹衬衫印骷髅＝类型填格纹、元素填骷髅）";
      if (k === "图案元素") note = "图案里画的是什么；不要在这里填拉链/口袋等结构件（那是「结构部件」），也不要填条纹/格纹（那是「图案类型」）";
      if (k === "结构部件") note = "服装上的功能性/装饰性部件（拉链、口袋、荷叶边…），既不是图案也不是工艺";
      if (k === "面料") note = "图片推测维度：口头叫法（专业叫法），无法代替吊牌成分，允许留空";
      if (k === "视觉-背景") note = "场景一律带 室内·/室外· 前缀；纯白底/浅灰底/无背景这类中性底不带前缀";
      if (k === "拍摄方式") note = "7 个互斥值，按支撑物判定：有真人→模拍；有衣架挂钩→挂拍；平放台面→平铺拍/俯拍平铺；有实体人台→人台拍；无头无手浮空→3D；礼盒分格→商品图合成";
      enumAoa.push([k, ENUM[k].join("，"), note]);
    });
    /* 二次工艺逐值口径：单独列在下面，方便填表时逐个对照 */
    enumAoa.push([]);
    enumAoa.push(["二次工艺 · 逐值口径", "取值", "什么情况下选它"]);
    Object.keys(CRAFT_GUIDE).forEach(function (k) { enumAoa.push(["", k, CRAFT_GUIDE[k]]); });
    var ws3 = XLSX.utils.aoa_to_sheet(enumAoa);
    ws3["!cols"] = [{ wch: 20 }, { wch: 110 }, { wch: 90 }];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "打标表");
    XLSX.utils.book_append_sheet(wb, ws2, "全量明细");
    XLSX.utils.book_append_sheet(wb, ws3, "枚举参考");
    return { wb: wb, images: picked.length, rows: picked.length, picked: picked, stats: stats };
  }

  /* 只算不导：给后台「预计导出 N 张」用 */
  async function preview(opts) {
    var detail = await fetchDetail(opts);
    if (opts && opts.periodType) {
      detail = detail.filter(function (r) { return ((r && r.period_type) || "week") === opts.periodType; });
    }
    if (!detail.length) return { total: 0, picked: 0, todo: 0, partial: 0, done: 0 };
    var urls = detail.map(function (r) { return r.image_url; });
    var tagMap = {};
    try { tagMap = await SB.listRankTagRows(urls); } catch (e) { tagMap = {}; }
    var pack = buildBook(detail, tagMap, opts);
    /* 被上限截断时把这件事带出去，别让"预计 N 张"看起来像全量 */
    pack.stats.truncated = !!(SB.rankItemsTruncated && SB.rankItemsTruncated());
    return pack.stats;
  }

  var SCOPE_NAME = { todo: "仅未打标", partial: "仅不完整", done: "仅已打标", all: "全部" };

  /* 读后台表单里的导出选项 */
  function optsFromDom() {
    var q = function (s) { return document.querySelector(s); };
    var sc = q("#rank-export-scope");
    var ct = q("#rank-export-cat");
    var kw = q("#rank-export-kw");
    var sp = q("#rank-export-split");
    var lv = q("#rank-export-split-level");
    return {
      scope: sc ? sc.value : "todo",
      category: ct ? String(ct.value || "").trim() : "",
      keyword: kw ? String(kw.value || "").trim() : "",
      split: !!(sp && sp.checked),
      splitLevel: (lv && lv.value === "leaf") ? "leaf" : "cat",
      /* 20261109H：按周（月度则按月）导出。选定期次后只查这一期，数据量小、速度也快，
         更重要的是不再受单次读取上限影响 —— 分期导永远取不到"被截断"的那一半。 */
      period: (function () { var p = q("#rank-export-period"); return p ? String(p.value || "").trim() : ""; })()
    };
  }

  /* 按需取数：指定了期次就只取那一期，否则全量（此时才可能碰到上限） */
  async function fetchDetail(o, maxRows) {
    var f = { max: maxRows || 200000 };
    if (o && o.period) f.periods = [o.period];
    if (o && o.periodType) f.periodType = o.periodType;
    return await SB.listRankItems(f);
  }

  /* 文件名里不能出现的字符统一换掉，避免 zip 内文件名非法 */
  function safeName(v) {
    return String(v == null ? "" : v).replace(/[\\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "未命名";
  }

  /* 按类目拆分导出：每个类目一个 xlsx，打包成 zip
     给「分头优化不同类目」用 —— 一个类目一份，谁负责哪类就发给谁。 */
  async function exportSplit(btn, o, detail, tagMap, say) {
    if (typeof JSZip === "undefined") { say("缺少打包组件，无法拆分导出", false); return; }
    var st = catStats(detail, tagMap);
    var isLeaf = o.splitLevel === "leaf";
    var list = (isLeaf ? st.leaves : st.cats).filter(function (x) { return x.total > 0; });
    if (!list.length) { say("没有可拆分的类目", false); return; }

    var zip = new JSZip();
    var files = 0, imgs = 0;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var pack = buildBook(detail, tagMap, {
        scope: o.scope, keyword: o.keyword,
        category: (isLeaf ? "l:" : "c:") + it.name
      });
      if (!pack.images) continue;
      zip.file(safeName(it.name) + ".xlsx",
        XLSX.write(pack.wb, { bookType: "xlsx", type: "array" }));
      files++; imgs += pack.images;
      if (btn) btn.textContent = "打包中… " + files + "/" + list.length;
    }
    if (!files) { say("按当前范围没有可导出的图", false); return; }
    say("正在压缩 " + files + " 个文件…");
    var blob = await zip.generateAsync({ type: "blob" });
    download(blob, "趋势上升榜-打标表-按" + (isLeaf ? "叶子类目" : "类目") + "拆分-" + stamp() + ".zip");
    say("已按" + (isLeaf ? "叶子类目" : "类目") + "拆成 " + files + " 个文件，合计 " + imgs + " 张图", true);
  }

  /* 填充导出用的类目下拉：分「主类目 / 叶子类目」两组，各带图数。
     原来只有主类目，且不带数量 —— 选之前不知道这一类有多大，
     想针对某一类优化时不好判断先做哪一类。 */
  var CAT_CACHE = null;
  async function loadCats(force) {
    var sel = document.querySelector("#rank-export-cat");
    if (!sel) return;
    try {
      if (!CAT_CACHE || force) {
        /* 导出必须是全量：这里把单次读取上限再放宽，避免"最新几周被截掉" */
      var detail = await SB.listRankItems({ max: 200000 });
        var urls = detail.map(function (r) { return r.image_url; });
        var tagMap = {};
        try { tagMap = await SB.listRankTagRows(urls); } catch (e) { tagMap = {}; }
        CAT_CACHE = catStats(detail, tagMap);
        renderOverview(CAT_CACHE);
      }
      var keep = sel.value;
      var html = '<option value="">全部类目</option>';
      html += '<optgroup label="主类目">' + CAT_CACHE.cats.map(function (x) {
        return '<option value="c:' + esc(x.name) + '">' + esc(x.name) + '（' + x.total + ' 张）</option>';
      }).join("") + '</optgroup>';
      if (CAT_CACHE.leaves.length) {
        html += '<optgroup label="叶子类目">' + CAT_CACHE.leaves.map(function (x) {
          return '<option value="l:' + esc(x.name) + '">' + esc(x.name) + '（' + x.total + ' 张）</option>';
        }).join("") + '</optgroup>';
      }
      sel.innerHTML = html;
      if (keep) sel.value = keep;
    } catch (e) { /* 取不到就保留原来的选项，不影响导出 */ }
  }

  /* 类目概览：每类总图数 / 已打标 / 未打标 / 覆盖率，点一行就把筛选设好 */
  function renderOverview(st) {
    var box = document.querySelector("#rank-cat-overview");
    if (!box) return;
    if (!st || !st.cats.length) { box.innerHTML = ""; return; }
    var rows = st.cats.map(function (x) {
      var pct = x.total ? Math.round(x.done * 100 / x.total) : 0;
      return '<tr data-cat="c:' + esc(x.name) + '" title="点这一行 → 筛选该类目">'
        + '<td class="rk-ov-name">' + esc(x.name) + '</td>'
        + '<td class="rk-ov-num">' + x.total + '</td>'
        + '<td class="rk-ov-num">' + x.done + '</td>'
        + '<td class="rk-ov-num">' + (x.total - x.done) + '</td>'
        + '<td class="rk-ov-bar"><span style="display:inline-block;width:76px;height:6px;background:#e5e7eb;border-radius:3px;vertical-align:middle">'
        + '<i style="display:block;height:6px;border-radius:3px;background:' + (pct >= 80 ? "#16a34a" : pct >= 40 ? "#d97706" : "#dc2626")
        + ';width:' + pct + '%"></i></span> ' + pct + '%</td>'
        + '</tr>';
    }).join("");
    /* 维度体检条：哪个维度是 0 一眼可见 */
    var dimLine = "";
    if (st.dims && st.dims.length) {
      var parts = st.dims.map(function (d) {
        var warn = d.has === 0 && d.name !== "节日";
        return '<span style="' + (warn ? "color:#dc2626;font-weight:600" : "")
          + '">' + esc(d.name) + ' ' + d.has + '</span>';
      });
      dimLine = '<div class="rk-ov-dim">各维度有值行数（共 ' + (st.taggedRows || 0) + ' 行打标记录）：'
        + parts.join(' · ') + '</div>';
    }

    box.innerHTML = '<div class="rk-ov-cap">类目分布（共 ' + st.total + ' 张图 / ' + st.cats.length + ' 个类目，点某行即按该类目筛选）</div>'
      + dimLine
      + '<table class="rk-ov"><thead><tr><th>类目</th><th>总图数</th><th>已打标</th><th>未打标</th><th>覆盖率</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table>';
    Array.prototype.forEach.call(box.querySelectorAll("tr[data-cat]"), function (tr) {
      tr.onclick = function () {
        var sel = document.querySelector("#rank-export-cat");
        if (sel) { sel.value = tr.getAttribute("data-cat"); sel.dispatchEvent(new Event("change")); }
      };
    });
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async function exportAll(btn, opts) {
    var o = opts || optsFromDom();
    var old = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "导出中…"; }
    /* 提示可以指到别的容器（月度面板有自己的一块提示位），默认仍是周度面板那个 */
    var tip = document.querySelector(o.tipSelector || "#rank-export-tip");
    function say(msg, ok) {
      if (!tip) return;
      tip.textContent = msg || "";
      tip.className = "rank-file-tip" + (ok === false ? " bad" : ok === true ? " good" : "");
    }
    try {
      say("正在读取榜单与已打标签…" + (o.period ? "（只读 " + o.period + " 这一期）" : ""));
      /* 指定了期次就只查这一期；没指定才全量 */
      var detail = await fetchDetail(o);
      if (o.periodType) {
        detail = detail.filter(function (r) { return ((r && r.period_type) || "week") === o.periodType; });
      }
      if (!detail.length) { say("还没有可导出的数据", false); return { ok: false, reason: "empty" }; }
      /* 取数被上限截断时必须说出来："导出的表里少了几周"这种问题，
         不说的话只能靠人去猜，而且会怀疑数据没传上去。 */
      var cut = !!(SB.rankItemsTruncated && SB.rankItemsTruncated());
      var cutWarn = cut ? " ⚠ 库里条目超过单次读取上限，本次只导出了较早的一部分（最新上传的期次可能不在表里），请联系维护者调高上限。" : "";
      var urls = detail.map(function (r) { return r.image_url; });
      var tagMap = {};
      try { tagMap = await SB.listRankTagRows(urls); } catch (e) { tagMap = {}; }
      if (o.split && !o.category) { await exportSplit(btn, o, detail, tagMap, say); return { ok: true }; }
      var pack = buildBook(detail, tagMap, o);
      pack.truncated = cut;
      if (!pack.images) {
        say("按当前范围没有可导出的图（全部 " + pack.stats.total + " 张：未打标 "
          + pack.stats.todo + " / 部分 " + pack.stats.partial + " / 已打标 " + pack.stats.done + "）", false);
        return { ok: false, reason: "nothing", stats: pack.stats };
      }
      var buf = XLSX.write(pack.wb, { bookType: "xlsx", type: "array" });
      var name = (o.title || "趋势上升榜") + "-打标表-" + (o.period ? o.period + "-" : "")
        + (SCOPE_NAME[o.scope] || "全部") + "-" + stamp() + ".xlsx";
      download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
      say("已导出 " + pack.images + " 张图（" + (o.period ? o.period + " · " : "") + (SCOPE_NAME[o.scope] || "全部") + "）。榜单共 "
        + pack.stats.total + " 张：未打标 " + pack.stats.todo + " / 部分 " + pack.stats.partial
        + " / 已打标 " + pack.stats.done + cutWarn, !cut);
      if (window.console) console.log("导出完成：" + name + " · " + pack.images + " 张");
      return { ok: true, images: pack.images, stats: pack.stats, filename: name };
    } catch (e) {
      say("导出失败，请重试", false);
      return { ok: false, reason: "error" };
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old || "导出打标表"; }
    }
  }

  /* ============================================================================
   * 按类目分表导出（20261111Y）
   * ----------------------------------------------------------------------------
   * 用户痛点：一个专区的图横跨多个类目，一张表全导出来后要自己筛；
   * 分头打标时也不方便各自导回。这里每个类目出一个工作表，表头与单表完全一致
   * （首列仍是「图片URL」），改完可以直接分别导回。
   *
   * 口径：
   *   · 空类目（该范围下没有符合条件的图）不生成空表，计入 emptyCats 由界面提示
   *   · 工作表名按 Excel 规则清洗（禁 : \ / ? * [ ]，31 字上限，重名加序号）
   *   · 末尾附一张「枚举参考」，与单表导出的那张同源
   * ==========================================================================*/
  function safeSheetName(name, used) {
    var s = String(name || "未分类").replace(/[:\\\/\?\*\[\]]/g, "-").trim() || "未分类";
    if (s.length > 31) s = s.slice(0, 31);
    var base = s, i = 2;
    while (used[s]) { s = (base.slice(0, 28) + "(" + i + ")").slice(0, 31); i++; }
    used[s] = 1;
    return s;
  }

  function buildBookSplit(detail, tagMap, opts) {
    var o = opts || {};
    var byCat = {};
    (detail || []).forEach(function (r) {
      var c = String((r && r.category) || "").trim() || "未分类";
      (byCat[c] = byCat[c] || []).push(r);
    });
    var order = Object.keys(byCat).sort(function (a, b) { return byCat[b].length - byCat[a].length; });
    var wb = XLSX.utils.book_new();
    var used = {}, total = 0, sheets = 0, emptyCats = [], enumAoa = null;

    order.forEach(function (c) {
      var p = buildBook(byCat[c], tagMap, { scope: o.scope });
      /* 必须用 stats.picked（真正写进表的张数）。stats.total 是「这个类目下有多少图」，
         范围过滤把图全筛掉时它仍然大于 0，按它判断会生成一张只有表头的空表。 */
      var n = (p.stats && p.stats.picked) || 0;
      if (!n) { emptyCats.push(c); return; }
      if (!enumAoa && p.wb.Sheets["枚举参考"]) {
        enumAoa = XLSX.utils.sheet_to_json(p.wb.Sheets["枚举参考"], { header: 1, defval: "", raw: false });
      }
      var ws = p.wb.Sheets[p.wb.SheetNames[0]];
      var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
      var name = safeSheetName(c, used);
      var nws = XLSX.utils.aoa_to_sheet(aoa);
      if (aoa[0]) {
        var cw = [{ wch: 46 }];
        for (var i = 1; i < aoa[0].length; i++) cw.push({ wch: 14 });
        nws["!cols"] = cw;
      }
      wb.Sheets[name] = nws;
      wb.SheetNames.push(name);
      total += n;
      sheets++;
    });

    if (sheets) {
      var en = safeSheetName("枚举参考", used);
      wb.Sheets[en] = XLSX.utils.aoa_to_sheet(enumAoa && enumAoa.length ? enumAoa : [["（无）"]]);
      wb.SheetNames.push(en);
    }
    return { wb: wb, total: total, sheets: sheets, emptyCats: emptyCats, picked: total };
  }

  window.RankExport = {
    all: exportAll, preview: preview, buildBook: buildBook, collectImages: collectImages,
    dimProgress: dimProgress, ENUM: ENUM, COLS: COLS, DIMS: DIMS, OPT_DIMS: OPT_DIMS, DIM_TOTAL: DIM_TOTAL,
    VISUAL_LEGACY: VISUAL_LEGACY,
    splitArr: splitArr, scopeName: SCOPE_NAME,
    /* 20261111Y：清单里曾引用一个随「渠道列」下线时一起删掉的函数，浏览器在加载阶段
       就抛 ReferenceError，导致 window.RankExport 永远不被赋值 —— 表现就是后台点
       导出提示「导出模块未加载」，强刷也没用。只导出真正还存在的成员。 */
    catStats: catStats, loadCats: loadCats, hitCat: hitCat,
    buildBookSplit: buildBookSplit, safeSheetName: safeSheetName,
    CRAFT_GUIDE: CRAFT_GUIDE, CRAFT_HINT: CRAFT_HINT
  };

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("rank-export-btn");
    if (btn) btn.addEventListener("click", function () { exportAll(btn); });
    var pv = document.getElementById("rank-export-preview");
    if (pv) pv.addEventListener("click", async function () {
      var tip = document.querySelector("#rank-export-tip");
      try {
        var o = optsFromDom();
        if (o.split && !o.category) {
          var dd = await SB.listRankItems({ max: 200000 });
          var uu = dd.map(function (r) { return r.image_url; });
          var tm = {};
          try { tm = await SB.listRankTagRows(uu); } catch (e) { tm = {}; }
          var cs = catStats(dd, tm);
          var lv = (o.splitLevel === "leaf") ? cs.leaves : cs.cats;
          if (tip) {
            tip.textContent = "将按「" + (o.splitLevel === "leaf" ? "叶子类目" : "主类目") + "」拆成 "
              + lv.length + " 个文件（每个类目一个 xlsx，打包为 zip）";
            tip.className = "rank-file-tip good";
          }
          return;
        }
        var st = await preview(o);
        if (tip) {
          tip.textContent = "榜单共 " + st.total + " 张图：未打标 " + st.todo + " / 部分 " + st.partial
            + " / 已打标 " + st.done + "；按当前范围将导出 " + st.picked + " 张"
            + (st.truncated ? "（⚠ 条目数超过单次读取上限，统计的只是较早的一部分，最新期次可能没算进来）" : "");
          tip.className = "rank-file-tip" + (st.truncated ? "" : " good");
        }
      } catch (e) {
        if (tip) { tip.textContent = "统计失败，请重试"; tip.className = "rank-file-tip bad"; }
      }
    });
  });
})();
