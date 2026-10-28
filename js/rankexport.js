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
    "图案元素", "二次工艺", "拍摄方式",
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

  var ENUM = {
    风格: ["复古美式", "街头潮流", "高街潮牌", "极简", "商务通勤", "商务正装", "休闲", "学院风", "运动风", "户外机能", "工装", "日系cityboy", "韩系", "欧美街头", "老钱风", "轻奢", "机车风", "复古港风", "民族风", "度假风", "波西米亚", "中性风", "甜美风", "运动休闲"],
    "视觉-背景": VISUAL_BG,
    "视觉-画面构成": VISUAL_FRAME,
    "视觉-呈现主体": VISUAL_SUBJECT,
    /* 三组合并视图：只用于「打标进度 / 统计」，不参与逐列校验 */
    视觉: VISUAL_BG.concat(VISUAL_FRAME, VISUAL_SUBJECT),
    图案元素: ["纯色/无图案", "竖条纹", "横条纹", "格纹", "千鸟格", "威尔士格", "波点", "碎花", "大花/花卉", "植物叶纹", "动物纹", "豹纹", "蛇纹", "斑马纹", "迷彩", "几何图案", "卡通图案", "字母", "标语文字", "品牌LOGO", "扎染", "晕染/水墨", "渐变", "抽象图案", "民族图腾", "拼色", "满印", "局部印花", "拉链", "抽绳", "口袋", "工装口袋", "荷叶边", "蕾丝", "镂空", "绑带", "开衩", "流苏", "毛边", "撞钉", "铆钉", "拼接", "双层", "翻边", "腰带", "金属扣件", "织带"],
    二次工艺: ["刺绣", "贴布绣", "珠片绣", "钉珠", "亮片", "水钻", "烫钻", "撞钉", "铆钉", "丝网印花", "数码印花", "发泡印花", "厚板印花", "植绒印花", "反光印花", "烫图/热转印", "压花", "压皱", "绗缝", "打缆/抽褶", "抽褶", "编织", "手工钩织", "水洗", "做旧洗水", "手擦", "蜡染", "扎染", "破洞", "磨破", "毛边"],
    拍摄方式: ["摆拍", "挂拍", "平铺拍", "模拍", "人台拍", "3D", "细节特写", "买家秀", "直播截帧"],
    /* 20261027Q 两个语义维度，词表来自 js/rank-enums.js */
    文化背景: VE.culture || [],
    消费心理: VE.psych || [],
    /* 20261027R 节日（可选，取值与站点营销日历节庆库同名） */
    节日: VE.festival || [],
    领型: ["圆领", "螺纹圆领", "V领", "方领", "一字领", "高领", "半高领", "翻领", "立领", "衬衫领", "西装领", "POLO领", "连帽", "挂脖", "露肩", "斜肩", "无领"],
    袖型: ["常规袖", "落肩袖", "插肩袖", "泡泡袖", "蝙蝠袖", "喇叭袖", "荷叶袖", "羊腿袖", "削肩", "无袖"],
    袖长: ["无袖", "短袖(3分)", "五分袖", "七分袖", "九分袖", "长袖"],
    衣长: ["短款", "常规款", "中长款", "长款", "超长款"],
    松紧度: ["紧身", "修身", "常规版", "宽松", "Oversize"],
    裤型: ["直筒", "修身小脚", "阔腿", "微喇", "锥形", "工装裤", "束脚", "运动卫裤", "背带"],
    裤长: ["短裤", "五分裤", "七分裤", "九分裤", "长裤", "拖地裤"],
    裙长: ["短裙", "及膝裙", "中长裙", "长裙", "拖地长裙"]
  };

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
        hit = { url: u, cats: {}, periods: {}, sites: {}, leaf: {}, bestRank: null, bestRatio: null };
        byUrl.set(u, hit);
      }
      if (r.category) hit.cats[r.category] = 1;
      if (r.leaf_category) hit.leaf[r.leaf_category] = 1;
      if (r.period_label) hit.periods[r.period_label] = 1;
      if (r.site) hit.sites[r.site] = 1;
      if (r.rank_ratio != null && (hit.bestRank == null || r.rank_ratio < hit.bestRank)) hit.bestRank = r.rank_ratio;
      if (r.ratio != null && (hit.bestRatio == null || r.ratio > hit.bestRatio)) hit.bestRatio = r.ratio;
    });
    return byUrl;
  }

  /* 组装工作簿
     opts: { scope:'todo'|'partial'|'done'|'all', category:'', keyword:'' }
     返回 { wb, images, rows, picked:[url], stats:{total, todo, partial, done, picked} } */
  function buildBook(detail, tagMap, opts) {
    var o = opts || {};
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

      if (cat && !h.cats[cat]) return;
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
        arrOf(t.element_tags).join("，"),
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
    ws2["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 58 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];

    var enumAoa = [["维度/子分组", "允许的取值（逗号分隔，导入时逐值校验）"]];
    Object.keys(ENUM).forEach(function (k) { enumAoa.push([k, ENUM[k].join("，")]); });
    var ws3 = XLSX.utils.aoa_to_sheet(enumAoa);
    ws3["!cols"] = [{ wch: 14 }, { wch: 120 }];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "打标表");
    XLSX.utils.book_append_sheet(wb, ws2, "全量明细");
    XLSX.utils.book_append_sheet(wb, ws3, "枚举参考");
    return { wb: wb, images: picked.length, rows: picked.length, picked: picked, stats: stats };
  }

  /* 只算不导：给后台「预计导出 N 张」用 */
  async function preview(opts) {
    var detail = await SB.listRankItems({});
    if (!detail.length) return { total: 0, picked: 0, todo: 0, partial: 0, done: 0 };
    var urls = detail.map(function (r) { return r.image_url; });
    var tagMap = {};
    try { tagMap = await SB.listRankTagRows(urls); } catch (e) { tagMap = {}; }
    var pack = buildBook(detail, tagMap, opts);
    return pack.stats;
  }

  var SCOPE_NAME = { todo: "仅未打标", partial: "仅不完整", done: "仅已打标", all: "全部" };

  /* 读后台表单里的导出选项 */
  function optsFromDom() {
    var q = function (s) { return document.querySelector(s); };
    var sc = q("#rank-export-scope");
    var ct = q("#rank-export-cat");
    var kw = q("#rank-export-kw");
    return {
      scope: sc ? sc.value : "todo",
      category: ct ? String(ct.value || "").trim() : "",
      keyword: kw ? String(kw.value || "").trim() : ""
    };
  }

  async function exportAll(btn, opts) {
    var o = opts || optsFromDom();
    var old = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "导出中…"; }
    var tip = document.querySelector("#rank-export-tip");
    function say(msg, ok) {
      if (!tip) return;
      tip.textContent = msg || "";
      tip.className = "rank-file-tip" + (ok === false ? " bad" : ok === true ? " good" : "");
    }
    try {
      say("正在读取榜单与已打标签…");
      var detail = await SB.listRankItems({});
      if (!detail.length) { say("还没有榜单数据", false); return; }
      var urls = detail.map(function (r) { return r.image_url; });
      var tagMap = {};
      try { tagMap = await SB.listRankTagRows(urls); } catch (e) { tagMap = {}; }
      var pack = buildBook(detail, tagMap, o);
      if (!pack.images) {
        say("按当前范围没有可导出的图（全部 " + pack.stats.total + " 张：未打标 "
          + pack.stats.todo + " / 部分 " + pack.stats.partial + " / 已打标 " + pack.stats.done + "）", false);
        return;
      }
      var buf = XLSX.write(pack.wb, { bookType: "xlsx", type: "array" });
      var name = "趋势上升榜-打标表-" + (SCOPE_NAME[o.scope] || "全部") + "-" + stamp() + ".xlsx";
      download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
      say("已导出 " + pack.images + " 张图（" + (SCOPE_NAME[o.scope] || "全部") + "）。榜单共 "
        + pack.stats.total + " 张：未打标 " + pack.stats.todo + " / 部分 " + pack.stats.partial
        + " / 已打标 " + pack.stats.done, true);
      if (window.console) console.log("导出完成：" + name + " · " + pack.images + " 张");
    } catch (e) {
      say("导出失败，请重试", false);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old || "导出打标表"; }
    }
  }

  window.RankExport = {
    all: exportAll, preview: preview, buildBook: buildBook, collectImages: collectImages,
    dimProgress: dimProgress, ENUM: ENUM, COLS: COLS, DIMS: DIMS, OPT_DIMS: OPT_DIMS, DIM_TOTAL: DIM_TOTAL,
    VISUAL_LEGACY: VISUAL_LEGACY,
    splitArr: splitArr, scopeName: SCOPE_NAME
  };

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("rank-export-btn");
    if (btn) btn.addEventListener("click", function () { exportAll(btn); });
    var pv = document.getElementById("rank-export-preview");
    if (pv) pv.addEventListener("click", async function () {
      var tip = document.querySelector("#rank-export-tip");
      try {
        var st = await preview(optsFromDom());
        if (tip) {
          tip.textContent = "榜单共 " + st.total + " 张图：未打标 " + st.todo + " / 部分 " + st.partial
            + " / 已打标 " + st.done + "；按当前范围将导出 " + st.picked + " 张";
          tip.className = "rank-file-tip good";
        }
      } catch (e) {
        if (tip) { tip.textContent = "统计失败，请重试"; tip.className = "rank-file-tip bad"; }
      }
    });
  });
})();
