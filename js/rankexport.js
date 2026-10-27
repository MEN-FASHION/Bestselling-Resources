/* ============================================================================
 * rankexport.js —— 趋势上升榜「导出数据」
 * 把榜单全量数据导成一个 Excel，供逐个打标后再导回后台。
 * 依赖：SB（supabase.js）、XLSX（vendor/xlsx.full.min.js）
 * 三个工作表：
 *   1) 打标表   按图片地址去重，一行一张图，附空标签列（也可预填已有标签）
 *   2) 全量明细 原始每一行（期次/站点/类目/位次/环比），不做去重
 *   3) 枚举参考 每个维度允许取的标签值，供填表与导入校验用
 * ==========================================================================*/
(function () {
  var COLS = [
    "图片URL", "类目", "叶子类目", "出现期次", "站点", "最优位次", "最高环比%",
    "风格", "视觉-背景", "视觉-画面构成", "视觉-呈现主体",
    "图案元素", "二次工艺", "拍摄方式",
    "领型", "袖型", "袖长", "衣长", "松紧度", "裤型", "裤长", "裙长",
    "备注"
  ];

  var ENUM = {
    风格: ["复古美式", "街头潮流", "高街潮牌", "极简", "商务通勤", "商务正装", "休闲", "学院风", "运动风", "户外机能", "工装", "日系cityboy", "韩系", "欧美街头", "老钱风", "轻奢", "机车风", "复古港风", "民族风", "度假风", "波西米亚", "中性风", "甜美风", "运动休闲"],
    视觉: ["纯白底", "浅灰底", "纯色背景", "渐变色背景", "场景实景", "画布纹理", "单件平铺", "多件组合", "拼图/九宫格", "主图+细节小图", "带文字标签", "带促销角标", "模特全身", "模特半身", "模特局部", "人台（假人）", "无人台挂拍", "手持展示", "3D渲染图"],
    图案元素: ["纯色/无图案", "竖条纹", "横条纹", "格纹", "千鸟格", "威尔士格", "波点", "碎花", "大花/花卉", "植物叶纹", "动物纹", "豹纹", "蛇纹", "斑马纹", "迷彩", "几何图案", "卡通图案", "字母", "标语文字", "品牌LOGO", "扎染", "晕染/水墨", "渐变", "抽象图案", "民族图腾", "拼色", "满印", "局部印花", "拉链", "抽绳", "口袋", "工装口袋", "荷叶边", "蕾丝", "镂空", "绑带", "开衩", "流苏", "毛边", "撞钉", "铆钉", "拼接", "双层", "翻边", "腰带", "金属扣件", "织带"],
    二次工艺: ["刺绣", "贴布绣", "珠片绣", "钉珠", "亮片", "水钻", "烫钻", "撞钉", "铆钉", "丝网印花", "数码印花", "发泡印花", "厚板印花", "植绒印花", "反光印花", "烫图/热转印", "压花", "压皱", "绗缝", "打缆/抽褶", "抽褶", "编织", "手工钩织", "水洗", "做旧洗水", "手擦", "蜡染", "扎染", "破洞", "磨破", "毛边"],
    拍摄方式: ["摆拍", "挂拍", "平铺拍", "模拍", "人台拍", "3D", "细节特写", "买家秀", "直播截帧"],
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
    return String(v == null ? "" : v).split(/[,，、/|]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes());
  }

  function download(blob, name) {
    var a = document.createElement("a");
    var url = URL.createObjectURL(blob);
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* 组装工作簿：labels 为按图片去重后的行，detail 为原始行，tagMap 为已有标签 */
  function buildBook(detail, tagMap) {
    var byUrl = new Map();
    detail.forEach(function (r) {
      var u = String(r.image_url || "").trim();
      if (!u) return;
      var hit = byUrl.get(u);
      if (!hit) {
        hit = {
          url: u, cats: {}, periods: {}, sites: {}, leaf: {}, bestRank: null, bestRatio: null
        };
        byUrl.set(u, hit);
      }
      if (r.category) hit.cats[r.category] = 1;
      if (r.leaf_category) hit.leaf[r.leaf_category] = 1;
      if (r.period_label) hit.periods[r.period_label] = 1;
      if (r.site) hit.sites[r.site] = 1;
      if (r.rank_ratio != null && (hit.bestRank == null || r.rank_ratio < hit.bestRank)) hit.bestRank = r.rank_ratio;
      if (r.ratio != null && (hit.bestRatio == null || r.ratio > hit.bestRatio)) hit.bestRatio = r.ratio;
    });

    var head = COLS.slice();
    var aoa = [head];
    Array.from(byUrl.keys()).sort().forEach(function (u) {
      var h = byUrl.get(u);
      var t = (tagMap && tagMap[u]) || {};
      var visual = (t.visual_tags || []).join("，");
      var fit = (t.fit_tags || []);
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
        (t.style_tags || []).join("，"),
        visual,
        "", "",
        (t.element_tags || []).join("，"),
        (t.craft_tags || []).join("，"),
        (t.shoot_tags || []).join("，"),
        pickFit("领型"), pickFit("袖型"), pickFit("袖长"), pickFit("衣长"),
        pickFit("松紧度"), pickFit("裤型"), pickFit("裤长"), pickFit("裙长"),
        ""
      ]);
    });

    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = head.map(function (h) {
      if (h === "图片URL") return { wch: 58 };
      if (h === "出现期次" || h === "叶子类目" || h === "类目") return { wch: 18 };
      if (h === "备注") return { wch: 24 };
      return { wch: 13 };
    });
    ws["!freeze"] = { xSplit: 1, ySplit: 1 };

    var detailAoa = [["期次类型", "期次", "类目", "站点", "叶子类目", "图片URL", "环比比例%", "环比绝对值", "潜力机会", "趋势爆款", "周度激增"]];
    detail.forEach(function (r) {
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
    return { wb: wb, images: byUrl.size, rows: detail.length };
  }

  async function exportAll(btn) {
    var old = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "导出中…"; }
    try {
      var detail = await SB.listRankItems({});
      if (!detail.length) { alert("还没有榜单数据"); return; }
      var urls = detail.map(function (r) { return r.image_url; });
      var tagMap = {};
      try { tagMap = await SB.listRankTagRows(urls); } catch (e) { tagMap = {}; }
      var pack = buildBook(detail, tagMap);
      var buf = XLSX.write(pack.wb, { bookType: "xlsx", type: "array" });
      download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "趋势上升榜-导出数据-" + stamp() + ".xlsx");
      if (window.console) console.log("导出完成：" + pack.images + " 张图 / " + pack.rows + " 行");
    } catch (e) {
      alert("导出失败，请重试");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old || "导出数据"; }
    }
  }

  window.RankExport = { all: exportAll, buildBook: buildBook, ENUM: ENUM, COLS: COLS, splitArr: splitArr };

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("rk-export-btn");
    if (btn) btn.addEventListener("click", function () { exportAll(btn); });
  });
})();