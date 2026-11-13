/* ============================================================================
 * rhythm-calc.js —— 榜单「环比 / 位次」自算引擎（上新节奏、趋势上升榜共用）
 *
 * 要解决的问题：
 *   导入表通常只有「环比比例」和「环比绝对值」两列，没有销量列；
 *   而前台的「上升 N 位 / 下降 N 位」原本要求库里存着上一期整榜数据来比对。
 *   只导入当期时，上一期一条数据都没有 → 每张图都被判成「新上榜」，
 *   页面看起来就是「全是新上榜、没有任何涨跌」。
 *
 * 自算原理（只用表里已有的两列，不新增字段、不改表结构）：
 *   ratio = (本期销量 - 上期销量) / 上期销量      ← 注意库里存的是「百分数」（65.81 表示 +65.81%）
 *   abs   =  本期销量 - 上期销量
 *   ⇒ 上期销量 = abs / (ratio / 100)
 *   ⇒ 本期销量 = 上期销量 + abs
 *
 * 口径已用真实数据核过（第43周·男装休闲衬衫）：销售额 2560.02、环比绝对值 142、
 * 环比比例原表 0.05873（=5.87%，导入时换算成百分数 5.87）→ 上期 = 142/0.0587 = 2419，
 * 与 2560.02-142=2418.02 吻合，说明必须按百分数（除以 100）才与绝对值同量纲。
 *   由此对每一款反推出「本期销量 / 上期销量」；
 *   在同一池（类目 + 站点 + 期次）内按本期销量降序得到本期名次，
 *   按上期销量降序得到上期名次，两者相减即真实位次变化。
 *
 * 判定口径：
 *   · 有条目带环比（ratio / abs 任一非空）→ 一律不判「新上榜」，能反推就给升降位；
 *   · 环比两列都空 → 该款在上一期榜上没有可比数据 → 「新上榜」；
 *   · 反推不成立（上期销量 ≤ 0、超出合理量级、ratio 为 0）→ 不给标签，也不冤枉成新上榜。
 *
 * 注意：这里算的是「本次导入这一批款」内部的名次，上期榜里未进本批的款不在范围内，
 *       所以位次是同一批内可比的相对名次，方向和幅度可直接用，不等同平台官方名次。
 * ==========================================================================*/
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;   /* 供 node 自检直接 require */
  if (root) root.RhythmCalc = api;
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : null), function () {
  "use strict";

  var MAX_SALES = 1e8;      /* 单款销量上限：超过这个量级说明反推不成立，宁可不算也不给错标签 */

  /* 数值解析：兼容 数值型 / "1,234.5" / "12.5%" / 带正负号。
     口径统一为「百分数」：字符串 "12.5%" 返回 12.5（不是 0.125），
     与库里 ratio 字段的口径一致，避免同一个值两套量纲。 */
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var s = String(v).trim().replace(/,/g, "").replace(/\s/g, "");
    if (!s) return null;
    if (s.charAt(s.length - 1) === "%") s = s.slice(0, -1);
    if (!/^[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?$/.test(s)) return null;
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    return n;                                 /* 百分号只作标记，数值仍按百分数口径返回 */
  }

  /* 有没有环比信息（任一列非空）——用来区分「真新品」与「反推失败」 */
  function hasRatio(it) {
    if (!it) return false;
    return num(it.ratio) !== null || num(it.abs_delta) !== null;
  }

  /* 由 ratio + abs 反推本期 / 上期销量；不成立返回 null */
  function derive(it) {
    if (!it) return null;
    var ratio = num(it.ratio), abs = num(it.abs_delta);
    if (ratio === null || abs === null) return null;
    if (ratio === 0) return null;              /* 零增长：上期=本期，但绝对量无从得知，名次不可比 */
    /* 增长超过 10000%（上期不到本期的 1%）时，反推出的上期销量只是个零头，
       名次结论几乎必然是最末位跃升，属于「算得出但不靠谱」——宁可不给位次。 */
    if (Math.abs(ratio) > 10000) return null;
    var prev = abs / (ratio / 100);            /* ratio 是百分数，化成倍数才能与绝对值相除 */
    var cur = prev + abs;
    if (!isFinite(prev) || !isFinite(cur)) return null;
    if (prev <= 0 || cur <= 0) return null;    /* 销量必须为正，否则是脏数据 */
    if (prev > MAX_SALES || cur > MAX_SALES) return null;
    return { prev: prev, cur: cur };
  }

  /* 名次口径判别（20261113I）：
     库里 rank_abs 只存一个数字，历史上它可能是三种东西之一 ——
       · 销售额批内名次 / 表格行序名次：跨度与条数相当，1..N 之间（style = "batch"）
       · 平台整类目排名：只有 6 条数据也可能出现「第 50 名」，跨度远大于条数（style = "platform"）
     两种口径的数字相减没有意义（会算出「上升 38 位」这类假结论），
     所以这里先判口径，跨月口径不同就不做位次对比。 */
  function rankStyleOf(posN, posMax) {
    if (!posN || !posMax) return "";
    return posMax <= posN * 1.5 + 2 ? "batch" : "platform";
  }

  /* 降序排名，销量相同共享同一名次（1,1,3 式） */
  function rankOf(pairs) {
    pairs.sort(function (a, b) { return b[1] - a[1]; });
    var map = {}, last = null, rank = 0;
    pairs.forEach(function (x, i) {
      if (last === null || x[1] !== last) { rank = i + 1; last = x[1]; }
      map[x[0]] = rank;
    });
    return map;
  }

  /* 构建某一期的自算上下文
   * items  ：该期（类目 + 站点口径下）的全部条目
   * keyOf  ：首图归一函数（跨期认同一张图）
   * 返回 { hasOf, curRank, prevRank, derived, studied, noRatio, failed }
   */
  function contextOf(items, keyOf) {
    var hasOf = {}, derived = {}, cur = [], prev = [];
    var posByKey = {}, posN = 0, posMax = 0;  /* 20261113I：条目自带的名次（销售额批内名次 / 平台「排名」） */
    var ratioN = 0;                      /* 20261113I：带环比的行数，用来区分 rank_abs 的两套口径 */
    var studied = 0, noRatio = 0, failed = 0;
    (items || []).forEach(function (it) {
      var k = keyOf ? keyOf(it.image_url) : String((it && it.image_url) || "");
      if (!k) return;
      hasOf[k] = 1;
      var rp = num(it.rank_abs);
      if (rp !== null && rp > 0) { posByKey[k] = rp; posN++; if (rp > posMax) posMax = rp; }
      if (num(it.ratio) !== null || num(it.abs_delta) !== null) ratioN++;
      var d = derive(it);
      if (d) {
        derived[k] = d;
        cur.push([k, d.cur]);
        prev.push([k, d.prev]);
        studied++;
      } else if (hasRatio(it)) {
        failed++;
      } else {
        noRatio++;
      }
    });
    return {
      hasOf: hasOf,
      curRank: rankOf(cur),
      prevRank: rankOf(prev),
      derived: derived,
      posByKey: posByKey,
      posN: posN,
      posMax: posMax,
      style: rankStyleOf(posN, posMax),
      ratioN: ratioN,
      studied: studied,
      noRatio: noRatio,
      failed: failed
    };
  }

  /* 单条位次判定
   * it / p / prev：条目、本期次、上一期次
   * ctxNow    ：本期上下文（用它的 curRank / derived / hasRatio）
   * ctxPrev   ：上一期上下文（库里有上一期数据时才有；没有就传 null）
   * 返回 { move, isNew, diff, prevEmpty, by }
   *   by = "actual" 用库里上一期真实数据；"self" 用自算销量；"" 无可比
   */
  function moveOf(it, p, prev, ctxNow, ctxPrev, keyOf) {
    if (!prev) return { move: "", isNew: false, diff: 0, prevEmpty: false, by: "" };
    var key = keyOf ? keyOf(it && it.image_url) : String((it && it.image_url) || "");
    var now = ctxNow || { hasOf: {}, curRank: {}, derived: {} };
    var prevCtx = ctxPrev || null;

    /* ⓪ 20261113I：两期都带「名次」时直接相减 —— 这是最准的一路，
          不需要环比、不需要反推销量，也不需要上一期的销量数据。
          名次数字越小越靠前，所以 prev - cur > 0 就是「上升」。 */
    /* 只在「两期都没带环比」时启用：这种批次的 rank_abs 存的是名次，
       与「环比绝对值名次」是两套口径，不能混着比。 */
    if (prevCtx && prevCtx.posByKey && now.posByKey && now.ratioN === 0 && prevCtx.ratioN === 0) {
      /* 20261113I：口径必须先对齐 —— 一个月是「销售额批内名次」、另一个月是「平台整类目排名」时，
         两个数字相减没有任何意义（会算出「上升 38 位」这种假数字）。这种情况一律不做位次对比。 */
      var stN = now.style || "", stP = prevCtx.style || "";
      if (stN && stP && stN === stP) {
        var curPos = now.posByKey[key];
        var oldPos = prevCtx.posByKey[key];
        if (curPos != null && oldPos != null) {
          var dPos = oldPos - curPos;
          if (dPos > 0) return { move: "上升 " + dPos + " 位", isNew: false, diff: dPos, prevEmpty: false, by: "official" };
          if (dPos < 0) return { move: "下降 " + (-dPos) + " 位", isNew: false, diff: dPos, prevEmpty: false, by: "official" };
          return { move: "", isNew: false, diff: 0, prevEmpty: false, by: "official" };
        }
      } else if (stN && stP && !hasRatio(it)) {
        /* 两月都有名次、但口径不同，且没有环比可反推 → 不给位次，也不冤枉成「新上榜」 */
        return { move: "", isNew: false, diff: 0, prevEmpty: false, basisMixed: true, by: "" };
      }
    }

    /* ① 库里有上一期整榜数据（调用方保证量级够用才传进来）：
          上一期也有这张图 → 用真实两期名次；上一期整榜里没有 → 确实是新上榜 */
    if (prevCtx && prevCtx.hasOf) {
      if (prevCtx.hasOf[key]) {
        var pr0 = (prevCtx.curRank || {})[key];
        var c0 = (now.curRank || {})[key];
        if (pr0 != null && c0 != null) {
          var d0 = pr0 - c0;
          if (d0 > 0) return { move: "上升 " + d0 + " 位", isNew: false, diff: d0, prevEmpty: false, by: "actual" };
          if (d0 < 0) return { move: "下降 " + (-d0) + " 位", isNew: false, diff: d0, prevEmpty: false, by: "actual" };
          return { move: "", isNew: false, diff: 0, prevEmpty: false, by: "actual" };
        }
        /* 上期确实有这张图、本期却没有可反推的环比：宁可不给标签，也不能说成新上榜 */
        if (!((now.derived || {})[key])) {
          return { move: "", isNew: false, diff: 0, prevEmpty: false, by: "actual" };
        }
      } else if (!hasRatio(it)) {
        return { move: "新上榜", isNew: true, diff: 0, prevEmpty: false, by: "actual" };
      }
    }

    /* ② 库里没有上一期 → 用反推出来的上期销量排名自算（本次新增的核心能力） */
    var d = (now.derived || {})[key];
    var pr = (now.prevRank || {})[key];
    var cr = (now.curRank || {})[key];
    if (d && pr != null && cr != null) {
      var diff = pr - cr;
      if (diff > 0) return { move: "上升 " + diff + " 位", isNew: false, diff: diff, prevEmpty: false, by: "self" };
      if (diff < 0) return { move: "下降 " + (-diff) + " 位", isNew: false, diff: diff, prevEmpty: false, by: "self" };
      return { move: "", isNew: false, diff: 0, prevEmpty: false, by: "self" };
    }

    /* ③ 两条路都算不出：只有在「完全没有环比信息」时才判新上榜，
          有环比但反推不成立（脏数据）不冤枉成新上榜 */
    if (!hasRatio(it)) {
      var prevEmpty = !!(prevCtx && (!prevCtx.hasOf || Object.keys(prevCtx.hasOf).length === 0));
      return { move: "新上榜", isNew: true, diff: 0, prevEmpty: prevEmpty, by: "" };
    }
    return { move: "", isNew: false, diff: 0, prevEmpty: false, by: "" };
  }

  /* 该池这一期「能不能比对位次」：
     库里上一期有数据 → 能；否则只要有任一条能反推 → 也能（自算）；都没有才不能。
     返回 { ok, mode: "actual" | "self" | "none", studied, noRatio, failed } */
  function capability(ctxNow, ctxPrev) {
    /* 20261113I：两期都有名次 → 能比，且口径是名次直比；
       20261113I：两期名次口径不同（平台排名 vs 销售额批内名次）→ 不能比，如实报 mixed。 */
    if (ctxPrev && ctxNow && ctxPrev.posN > 0 && ctxNow.posN > 0 && ctxNow.ratioN === 0 && ctxPrev.ratioN === 0) {
      var stN = ctxNow.style || "", stP = ctxPrev.style || "";
      if (stN && stP && stN === stP) {
        return { ok: true, mode: "official", studied: ctxNow.posN, noRatio: ctxNow.noRatio, failed: ctxNow.failed };
      }
      if (stN && stP) {
        return { ok: false, mode: "mixed", studied: ctxNow.posN, noRatio: ctxNow.noRatio, failed: ctxNow.failed };
      }
    }
    if (ctxPrev && ctxPrev.studied > 0) {
      return { ok: true, mode: "actual", studied: ctxPrev.studied, noRatio: ctxNow ? ctxNow.noRatio : 0, failed: ctxNow ? ctxNow.failed : 0 };
    }
    if (ctxNow && ctxNow.studied > 0) {
      return { ok: true, mode: "self", studied: ctxNow.studied, noRatio: ctxNow.noRatio, failed: ctxNow.failed };
    }
    return { ok: false, mode: "none", studied: 0, noRatio: ctxNow ? ctxNow.noRatio : 0, failed: ctxNow ? ctxNow.failed : 0 };
  }

  return {
    MAX_SALES: MAX_SALES,
    num: num,
    hasRatio: hasRatio,
    derive: derive,
    rankOf: rankOf,
    rankStyleOf: rankStyleOf,
    contextOf: contextOf,
    moveOf: moveOf,
    capability: capability
  };
});
