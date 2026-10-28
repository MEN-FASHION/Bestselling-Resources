/* ============================================================================
 * admin-imageimport.js —— 视觉专区打标表导入（20261028A，仅后台）
 *
 * 流程：选文件 → 解析「打标表」→ 按图片URL（或图片ID）匹配 → 逐维校验 → 写回 images
 *
 * 与榜单导入（admin-rankimport.js）共用同一套枚举（js/rank-enums.js），
 * 但字段映射不同：视觉按三组分流（背景→scene_tags，构图/主体→visual_tags），
 * 版型按部位存成「领型·圆领」。
 *
 * ⚠️ 合并时必须把库里已有的 11 个标签字段一并带上再写回。
 *    早先榜单导入漏带新列，导致「导入一张只填风格的表，把别的维度清空」，
 *    这个坑在本模块里从一开始就避开。
 * ==========================================================================*/
(function () {
  var AE = window.APP_ENUM || {};
  var VE = window.RANK_VISUAL_ENUM || {};
  var VISUAL_BG = VE.bg || [];
  var VISUAL_FRAME = VE.frame || [];
  var VISUAL_SUBJECT = VE.subject || [];
  var LEGACY = VE.legacy || [];
  var FIT_LABELS = ["领型", "袖型", "袖长", "衣长", "松紧度", "裤型", "裤长", "裙长", "腰型"];

  /* 写回 images 的字段清单：合并时要全部带上，少一个就会被清空 */
  var ALL_FIELDS = ["tags", "style_tags", "scene_tags", "visual_tags", "element_tags",
    "craft_tags", "shoot_tags", "skin_tags", "fit_tags",
    "culture_tags", "psych_tags", "festival_tags"];

  var DIMS = ["风格", "视觉", "图案元素", "二次工艺", "拍摄方式", "版型", "文化背景", "消费心理"];
  var DIM_TOTAL = DIMS.length;

  function arr(v) {
    if (Array.isArray(v)) return v.filter(function (x) { return String(x || "").trim(); });
    if (v == null || v === "") return [];
    return String(v).split(/[,，、|；;]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function norm(v) { return String(v == null ? "" : v).trim(); }
  function uniq(a) { return [...new Set(a)]; }

  /* 视觉值按组归类：属于哪一组就写哪一列 */
  function splitVisual(vals) {
    var bg = [], fr = [], sj = [], bad = [];
    vals.forEach(function (v) {
      if (VISUAL_BG.indexOf(v) >= 0 || LEGACY.indexOf(v) >= 0 && VISUAL_BG.length) bg.push(v);
      else if (VISUAL_FRAME.indexOf(v) >= 0) fr.push(v);
      else if (VISUAL_SUBJECT.indexOf(v) >= 0) sj.push(v);
      else bad.push(v);
    });
    return { bg: uniq(bg), frame: uniq(fr), subject: uniq(sj), bad: uniq(bad) };
  }

  /* ---------- 解析：只读「打标表」这一张 ---------- */
  async function parseFile(file, say) {
    var buf = await file.arrayBuffer();
    var wb = XLSX.read(buf, { type: "array" });
    /* 先看目录，只解析打标表；整本解析上千行会明显变慢 */
    var name = wb.SheetNames.filter(function (n) { return /打标表/.test(n); })[0] || wb.SheetNames[0];
    if (say) say("正在解析「" + name + "」…");
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false });
    if (!rows.length) throw new Error("工作表是空的");

    var head = rows[0].map(function (h) { return norm(h); });
    /* 表头识别：URL 列名可能带各种写法 */
    var iUrl = head.findIndex(function (h) { return /图片URL|图片地址|url/i.test(h) && !/ID/i.test(h); });
    var iId = head.findIndex(function (h) { return /^图片ID$|^id$/i.test(h); });
    if (iUrl < 0 && iId < 0) throw new Error("表头里找不到「图片URL」或「图片ID」列，请用后台导出的打标表模板");
    var iStatus = head.findIndex(function (h) { return h === "打标状态"; });
    var iNote = head.findIndex(function (h) { return h === "备注"; });
    var col = {};
    head.forEach(function (h, i) { if (h) col[h] = i; });

    var out = [], badRows = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !row.length) continue;
      var url = iUrl >= 0 ? norm(row[iUrl]) : "";
      var id = iId >= 0 ? norm(row[iId]) : "";
      if (!url && !id) continue;
      var rec = { url: url, id: id, provided: {}, values: {}, note: iNote >= 0 ? norm(row[iNote]) : "" };
      /* 只有「有值」的格子才算 provided；空格代表"这次不管"，不是"清空" */
      function grab(key) {
        if (col[key] == null) return [];
        var v = arr(row[col[key]]);
        if (v.length) { rec.provided[key] = true; rec.values[key] = v; }
        return v;
      }
      grab("风格"); grab("视觉-背景"); grab("视觉-画面构成"); grab("视觉-呈现主体");
      grab("图案元素"); grab("二次工艺"); grab("拍摄方式"); grab("模特");
      FIT_LABELS.forEach(grab);
      grab("文化背景"); grab("消费心理"); grab("节日"); grab("渠道");
      if (iStatus >= 0) rec.status = norm(row[iStatus]);
      out.push(rec);
    }
    if (!out.length) throw new Error("没有解析到任何数据行（检查是否选错了文件）");
    return { head: head, col: col, rows: out, badRows: badRows, sheet: name };
  }

  /* ---------- 校验 ---------- */
  function checkOne(rec, defs) {
    var unknown = [], mismatch = [];
    var v = rec.values;
    function bad(dim, list) {
      list.forEach(function (x) { unknown.push(dim + "：" + x); });
    }
    /* 普通维度：逐值比对枚举；手动标签（tag_defs 里的）一律放行 */
    function chk(dim, list) {
      if (!list) return;
      var allow = (AE[dim] || []).concat((defs && defs[dim]) || []);
      var miss = list.filter(function (x) { return allow.indexOf(x) < 0; });
      bad(dim, miss);
    }
    chk("风格", v["风格"]);
    chk("图案元素", v["图案元素"]);
    chk("二次工艺", v["二次工艺"]);
    chk("拍摄方式", v["拍摄方式"]);
    chk("模特", v["模特"]);
    chk("文化背景", v["文化背景"]);
    chk("消费心理", v["消费心理"]);
    chk("渠道", v["渠道"]);
    FIT_LABELS.forEach(function (g) { chk(g, v[g]); });

    /* 节日：宽松匹配——节庆库里有的名字一律放行，拼错照样拦 */
    if (v["节日"]) {
      var festAllow = (AE["节日"] || []);
      v["节日"].forEach(function (f) {
        if (festAllow.indexOf(f) < 0 && !(defs && defs["节日"] && defs["节日"].indexOf(f) >= 0)) {
          unknown.push("节日：" + f);
        }
      });
    }

    /* 视觉三组：值必须属于某一组 */
    var vAll = [].concat(v["视觉-背景"] || [], v["视觉-画面构成"] || [], v["视觉-呈现主体"] || []);
    var vs = splitVisual(vAll);
    if (vs.bad.length) bad("视觉", vs.bad);

    /* 背景列里填了构图值 / 构图列里填了背景值 → 提示（占位错误，最容易发生） */
    (v["视觉-背景"] || []).forEach(function (x) {
      if (VISUAL_FRAME.indexOf(x) >= 0 || VISUAL_SUBJECT.indexOf(x) >= 0) mismatch.push("「视觉-背景」里填了「" + x + "」（应填背景/场景）");
    });
    (v["视觉-画面构成"] || []).forEach(function (x) {
      if (VISUAL_BG.indexOf(x) >= 0 || VISUAL_SUBJECT.indexOf(x) >= 0) mismatch.push("「视觉-画面构成」里填了「" + x + "」");
    });
    (v["视觉-呈现主体"] || []).forEach(function (x) {
      if (VISUAL_BG.indexOf(x) >= 0 || VISUAL_FRAME.indexOf(x) >= 0) mismatch.push("「视觉-呈现主体」里填了「" + x + "」");
    });

    /* 维度间硬矛盾（只提示不阻断） */
    var subj = v["视觉-呈现主体"] || [], shoot = v["拍摄方式"] || [];
    var isModel = subj.some(function (x) { return /模特|买家秀|手持/.test(x); });
    var plainShoot = shoot.filter(function (x) { return /^(摆拍|挂拍|平铺拍|人台拍)$/.test(x); });
    if (isModel && plainShoot.length) {
      mismatch.push("呈现主体是「" + subj.filter(function (x) { return /模特/.test(x); }).join("、") + "」，拍摄方式却是「" + plainShoot.join("、") + "」，应为「模拍」");
    }
    var els = v["图案元素"] || [], craft = v["二次工艺"] || [];
    var onlyPlain = els.length === 1 && els[0] === "纯色/无图案";
    var PRINT = ["数码印花", "丝网印花", "发泡印花", "厚板印花", "植绒印花", "反光印花",
      "夜光印花", "转移印花", "手绘印花", "喷绘", "烫图/热转印"];
    if (onlyPlain && craft.some(function (c) { return PRINT.indexOf(c) >= 0; })) {
      mismatch.push("图案是「纯色/无图案」，却填了印花工艺（" + craft.join("、") + "）");
    }
    var BIG = ["满印", "迷彩"];
    if (els.some(function (e) { return BIG.indexOf(e) >= 0; }) &&
      craft.indexOf("烫图/热转印") >= 0 && craft.indexOf("数码印花") < 0) {
      mismatch.push("图案是大幅面（" + els.join("、") + "），工艺应为「数码印花」而不是只有「烫图/热转印」");
    }

    return { unknown: uniq(unknown), mismatch: uniq(mismatch) };
  }

  /* ---------- 组装要写回的 patch ---------- */
  function buildPatch(rec, before, mode, clearEmpty) {
    /* 先把库里已有的值全部搬过来，本次没触碰的维度原样保留 */
    var next = {};
    ALL_FIELDS.forEach(function (f) { next[f] = Array.isArray(before && before[f]) ? before[f].slice() : []; });

    var v = rec.values, p = rec.provided;
    function write(field, list) {
      if (list == null) return;
      if (mode === "fill" && next[field].length) return;   /* 补齐模式：已有值不动 */
      next[field] = uniq(list.filter(Boolean));
    }
    /* 空单元格也清空：只对「表里确实有这一列、这一格为空」的维度生效 */
    function clearIfEmpty(field, hasCol) {
      if (!clearEmpty || !hasCol) return;
      if (mode === "fill") return;
      if (p[field]) return;   /* 有值就不清 */
      if (next[field] && next[field].length) next[field] = [];
    }

    var vs = splitVisual([].concat(v["视觉-背景"] || [], v["视觉-画面构成"] || [], v["视觉-呈现主体"] || []));
    /* 背景 → scene_tags；构图 + 主体 → visual_tags */
    if (p["视觉-背景"] || p["视觉-画面构成"] || p["视觉-呈现主体"]) {
      var bgWant = p["视觉-背景"] ? vs.bg : null;
      var visWant = (p["视觉-画面构成"] || p["视觉-呈现主体"]) ? vs.frame.concat(vs.subject) : null;
      if (bgWant) write("scene_tags", bgWant);
      if (visWant) write("visual_tags", visWant);
    } else if (clearEmpty && mode === "overwrite") {
      if (before && before.scene_tags && before.scene_tags.length) next.scene_tags = [];
      if (before && before.visual_tags && before.visual_tags.length) next.visual_tags = [];
    }

    if (p["风格"]) write("style_tags", v["风格"]); else clearIfEmpty("style_tags", true);
    if (p["图案元素"]) write("element_tags", v["图案元素"]); else clearIfEmpty("element_tags", true);
    if (p["二次工艺"]) write("craft_tags", v["二次工艺"]); else clearIfEmpty("craft_tags", true);
    if (p["拍摄方式"]) write("shoot_tags", v["拍摄方式"]); else clearIfEmpty("shoot_tags", true);
    if (p["模特"]) write("skin_tags", v["模特"]); else clearIfEmpty("skin_tags", true);
    if (p["文化背景"]) write("culture_tags", v["文化背景"]); else clearIfEmpty("culture_tags", true);
    if (p["消费心理"]) write("psych_tags", v["消费心理"]); else clearIfEmpty("psych_tags", true);
    if (p["节日"]) write("festival_tags", v["节日"]); else clearIfEmpty("festival_tags", true);
    if (p["渠道"]) write("tags", v["渠道"]); else clearIfEmpty("tags", true);

    /* 版型：按部位存成「领型·圆领」，只替换本次涉及的那些部位 */
    var anyFit = FIT_LABELS.some(function (g) { return p[g]; });
    if (anyFit) {
      var keep = arr(before && before.fit_tags).filter(function (x) {
        var g = String(x).split("·")[0];
        return FIT_LABELS.indexOf(g) >= 0 && !p[g];
      });
      var add = [];
      FIT_LABELS.forEach(function (g) {
        if (!p[g]) return;
        v[g].forEach(function (x) { add.push(g + "·" + x); });
      });
      if (!(mode === "fill" && arr(before && before.fit_tags).length)) {
        next.fit_tags = uniq(keep.concat(add));
      }
    } else if (clearEmpty && mode === "overwrite" && arr(before && before.fit_tags).length) {
      next.fit_tags = [];
    }

    var patch = {};
    ALL_FIELDS.forEach(function (f) {
      var a = arr(next[f]), b = arr(before && before[f]);
      if (a.join("\u0001") !== b.join("\u0001")) patch[f] = a;
    });
    return patch;
  }

  /* ---------- 主流程 ---------- */
  async function run(opts) {
    var say = opts.say || function () {};
    var mode = opts.mode === "fill" ? "fill" : "overwrite";
    var clearEmpty = !!opts.clearEmpty;

    say("读取图片清单…");
    var list = await SB.listImageIdUrls();
    var byUrl = {}, byId = {};
    list.forEach(function (r) {
      if (r.url) byUrl[String(r.url).trim()] = r;
      if (r.id != null) byId[String(r.id)] = r;
    });

    say("读取后台手动标签…");
    var defs = {};
    try {
      var MAP = { style: "风格", element: "图案元素", scene: "视觉-背景", shoot: "拍摄方式", skin: "模特" };
      var td = await SB.listTagDefs();
      (td || []).forEach(function (d) {
        var dim = MAP[d.type]; if (!dim) return;
        (defs[dim] = defs[dim] || []).push(String(d.name || "").trim());
      });
    } catch (e) { /* 读不到就只按静态枚举校验 */ }

    say("校验取值…");
    var matched = [], unmatched = 0;
    var allUnknown = [], allMismatch = [];
    opts.rows.forEach(function (rec) {
      var hit = (rec.url && byUrl[rec.url]) || (rec.id && byId[rec.id]);
      if (!hit) { unmatched++; return; }
      var ck = checkOne(rec, defs);
      if (ck.unknown.length) allUnknown.push({ url: rec.url || rec.id, list: ck.unknown });
      if (ck.mismatch.length) allMismatch.push({ url: rec.url || rec.id, list: ck.mismatch });
      matched.push({ rec: rec, img: hit });
    });

    if (opts.dryRun) {
      return { matched: matched.length, unmatched: unmatched, unknown: allUnknown, mismatch: allMismatch };
    }

    say("写入 " + matched.length + " 张…");
    var updates = [];
    matched.forEach(function (m) {
      var patch = buildPatch(m.rec, m.img, mode, clearEmpty);
      if (Object.keys(patch).length) updates.push({ id: m.img.id, patch: patch });
    });
    var res = await SB.batchUpdateImageTags(updates, 20);
    return {
      matched: matched.length, unmatched: unmatched,
      written: res.ok, failed: res.fail, errors: res.errors,
      skipped: matched.length - updates.length,
      unknown: allUnknown, mismatch: allMismatch
    };
  }

  window.ImageImport = {
    parseFile: parseFile,
    checkOne: checkOne,
    buildPatch: buildPatch,
    splitVisual: splitVisual,
    run: run,
    ALL_FIELDS: ALL_FIELDS,
    DIMS: DIMS,
    DIM_TOTAL: DIM_TOTAL,
    FIT_LABELS: FIT_LABELS
  };
})();
