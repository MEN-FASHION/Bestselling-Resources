/* ============================================================================
 * compare-front.js —— 渠道对比（多列图片横向对比，20261112B）
 * ----------------------------------------------------------------------------
 * 一屏之内把「同一个类目 · 同一个月」的各个来源的图并排摆开，一眼看差异。
 *
 * 列（来源）来自后台「渠道对比」面板的配置；没配置时自动发现：
 *   ① 上新节奏（月度榜单：rank_items，period_type=month，channel 为空的行）
 *   ② 渠道图存储里出现过的每个渠道（Pinterest / SHEIN / 其它渠道传图传的）
 * 以后新增一个渠道专区，只要它的图进了渠道图存储，这里自动多出一列，不用改代码。
 *
 * 只读页面：不传图、不打标、不删图。
 * ==========================================================================*/
(function () {
  "use strict";

  var KEY = "compare";
  var ALL = "全部";

  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  function SBx() { return window.SB || null; }
  function pad2(n) { return String(n).length < 2 ? "0" + n : String(n); }

  /* 渠道显示名（20261114Q）：SHEIN → S、Pinterest → P、TikTok → T，
     别的渠道原样。只改显示，不改库里的值，筛选口径不受影响。 */
  var CH_SHORT = { shein: "S", pinterest: "P", tiktok: "T" };
  function chShort(name) {
    var raw = String(name == null ? "" : name).trim();
    if (!raw) return "";
    var k = raw.replace(/[\s_\-]/g, "").toLowerCase();
    return CH_SHORT[k] || raw;
  }

  var state = {
    cfg: null,          // 后台配置 { list, showEmpty, perRow }
    sources: [],        // 归一后的列 [{key,label,type,channel}]
    data: {},           // sourceKey -> [item]
    items: [],          // 全部（用于类目 / 月份清单）
    tags: {},           // url -> 打标记录
    tagTried: {},       // url -> 已经问过库（避免重复请求）
    months: [],
    month: null,        // 当前月份（null = 还没选，默认最新月；"" = 全部月份）
    cat: ALL,
    gate: "",
    vis: true,
    loading: false,
    srcOn: {},          // 用户手动打开的列 key（默认按「有没有图」自动决定）
    srcOff: {},         // 用户手动关掉的列 key
    cols: { add: [], del: [] },   // 用户自定义增 / 减的渠道（记忆在本机）
    base: [],           // 后台配置（或自动发现）算出来的原始列，不含用户自定义增删
    zoneVis: null,      // 全站「前台可见专区」开关（后台关掉的专区，它的渠道列不应出现）
    myZones: null,      // 当前账号的专区白名单（未配置 = 跟随全站）
    zoneHidden: 0,      // 因为对应专区被关闭而没摆出来的渠道列数（用于提示，不摆空列）
    zoneDropped: [],    // 因为专区关闭被剔掉的列（用于具名说明，让用户知道少了哪一列）
  };

  function baseSources() { return state.base || []; }

  /* 20261114Y：渠道的增删统一在后台「渠道对比 · 对比列配置」里做，
     前台只按后台配置摆列（只读），不再有「本机自定义增删」这一层。 */
  function computeSources() {
    return baseSources().filter(function (s) { return srcZoneOpen(s); });
  }

  function normMonth(v) {
    var SB = SBx();
    if (SB && typeof SB._normMonth === "function") {
      try { return SB._normMonth(v); } catch (e) { /* 本地兜底 */ }
    }
    var s = String(v || "").trim();
    var m = s.match(/(20\d{2})\D{0,2}(\d{1,2})/);
    return m ? m[1] + "-" + pad2(parseInt(m[2], 10)) : s;
  }

  function imgUrl(u) {
    var s = String(u || "");
    if (!s) return "";
    /* 20261115G：统一走 window.imgSrc（相对路径与本站完整地址都会补令牌），避免「部分图不显示」 */
    if (typeof window.imgSrc === "function") return window.imgSrc(s);
    if (/^https?:\/\//i.test(s)) return s;
    var base = String((window.CONFIG && window.CONFIG.WORKER_URL) || "").replace(/\/$/, "");
    return base ? base + "/" + s.replace(/^\/+/, "") : s;
  }

  /* 20261116B：卡片用缩略图（图片服务缩到 340px，约 20KB），点开大图仍用原图 */
  function thumbOf(u) {
    try { return window.imgThumb ? window.imgThumb(u) : u; } catch (e) { return u; }
  }

  function toast(msg, ok) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "toast show" + (ok === false ? " bad" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = "toast"; }, 2400);
  }

  /* ---------- 列（来源） ---------- */
  /* 列名：如果列名就是渠道名（没被人改过），显示首字母 S / P / T；
     管理员在后台把列名改成别的（比如「S · 女装」），就照他写的显示。 */
  function srcLabel(label, channel) {
    var l = String(label == null ? "" : label).trim();
    var c = String(channel == null ? "" : channel).trim();
    if (!l) return chShort(c);
    if (!c) return l;
    return chKey(l) === chKey(c) ? chShort(l) : l;
  }

  /* 默认列：上新节奏 + 数据里出现过的每个渠道（按渠道名排序，保证每次打开顺序一致） */
  /* 20261121D：榜单列的判定 ------------------------------------------------
     用户反馈：「上新节奏怎么没了，渠道对比前台不显示这个筛选项了，也没有对比池子」。
     查下来有两种来源，都会让这一列整列消失：
       ① 后台对比列配置里没有它（早期保存时被移出过，或者保存时 type 丢了变成空渠道列）；
       ② 这个月没有上新节奏的图，旧逻辑「没图就不摆列」，池子跟着一起没了。
     口径（本轮定死）：
       · 榜单列是**内置列**，不以后台配置为准 —— 配置里没有就自动补在最前面；
       · 名字写成「上新节奏 / 榜单 / 月度榜单」的配置项，一律认回榜单列；
       · 选了月份而这个月没有榜单图时，列**仍然摆**，池子里说明「本月无图」并给出有图的月份，
         绝不拿别的月份的图顶替（沿用 20261114Y 的口径）。
     数据一条都不动，列自己会回来。 */
  var RANK_KEY = "rank:month";
  function isRankName(v) {
    var k = String(v == null ? "" : v).replace(/[\s_\-:：]/g, "");
    if (!k) return false;
    return k === "rankmonth" || k === "上新节奏" || k === "榜单" || k === "月度榜单" ||
           k === "上新节奏榜单";
  }
  function rankSource() {
    return { key: RANK_KEY, label: "上新节奏", type: "rank", channel: "", builtin: true };
  }

  /* 默认列：上新节奏 + 数据里出现过的每个渠道（按渠道名排序，保证每次打开顺序一致） */
  function defaultSources(channelRows) {
    var out = [rankSource()];
    var seen = {};
    (channelRows || []).forEach(function (r) {
      var raw = String(r.channel || "").trim();
      var k = chKey(raw);
      if (!k || seen[k]) return;
      seen[k] = 1;
      out.push({ key: "ch:" + k, label: chShort(raw), type: "channel", channel: raw });
    });
    return out;
  }

  function sourceItems(s) {
    return state.data[s.key] || [];
  }

  /* 某一列在当前「类目 + 月份」下到底摆哪些图（20261114Y）：
     · 选了月份 → 只摆这个月的图；这个月一张都没有，就一张都不摆；
     · 没有用别的月份的图来顶替（旧版会摆「它全部的 N 张」并加一行提示，
       那行字很容易被误读成「这个月其实有图」，现在彻底去掉）。 */
  function colItems(s) {
    var cat = state.cat;
    var list = sourceItems(s).filter(function (r) {
      if (cat === ALL) return true;
      /* 选「营装」时，库里写成全路径的同一类目也要算进来（否则这列会假空） */
      return catSame(r.category, cat);
    });
    if (!state.month) return { list: list };
    return { list: list.filter(function (r) { return r.month === state.month; }) };
  }

  /* 三个月内没图的列：默认隐藏（免得一屏全空列），后台可强制显示 */
  function sourceHasData(s) {
    var all = sourceItems(s);
    if (!all.length) return false;
    if (!state.month) return true;
    return all.some(function (r) { return r.month === state.month; });
  }

  /* 某一列在「当前月份」下到底有没有图 */
  function colHasData(s) { return sourceHasData(s); }

  /* 现在到底显示哪几列：
     - 选了月份时：这个月没有图的列一律不摆（后台「显示空列」也不摆，
       因为没图就该是空的，摆出来只会让人以为丢了图）；
     - 没选月份（全部月份）：后台勾了「显示空列」就全显示，否则只显示有图的列；
     - 顶部「渠道」筛选里手动关掉的一律不显示。
     这些判断全在本地做，不发任何请求，不影响打开速度。 */
  function activeSources() {
    var forceAll = !!(state.cfg && state.cfg.showEmpty === true);
    return state.sources.filter(function (s) {
      if (state.srcOff[s.key]) return false;
      if (state.month) {
        if (colHasData(s)) return true;
        /* 20261121D：榜单列即使这个月没图也留位（池子里说明「本月无图」），
           否则「列没了 + 池子没了」看起来就是功能坏了。其它渠道列维持原口径：没图不摆。 */
        return s.type === "rank";
      }
      if (state.srcOn[s.key]) return true;
      return forceAll ? true : colHasData(s);
    });
  }

  /* 被自动隐藏的列（有图与否决定），用于在筛选里提示「已隐藏 N 个没有图的渠道」 */
  function hiddenByEmpty() {
    var forceAll = !!(state.cfg && state.cfg.showEmpty === true);
    if (forceAll) return [];
    return state.sources.filter(function (s) {
      /* 20261121C：榜单列在筛选里始终可见，不算「看不见的渠道」，由摘要单独说明「本月无榜单图」 */
      if (s.type === "rank") return false;
      return !state.srcOff[s.key] && !state.srcOn[s.key] && !colHasData(s);
    });
  }

  /* ---------- 归一（渠道名 / 类目名） ----------
     · 渠道名：库里可能同时存在 SHEIN / Shein / shein / SHE-IN。严格按原文分组，
       同一个渠道会裂成几列；而「S 专区」那边是忽略大小写和分隔符比较的，
       于是会出现「专区里有图，对比页这一列却空」。这里跟专区对齐。
     · 类目名（20261114G）：一律原样，不做任何归并改写。
       以前这里会把类目名再过一遍关键词规则，后台选 A、这里显示 B，
       一个类目裂成好几列。现在库里存什么就显示什么、就按什么查。 */
  function chKey(v) {
    return String(v == null ? "" : v).replace(/[\s_\-]/g, "").toLowerCase();
  }

  /* ---------- 专区开关（20261114T） ----------
     问题：后台把 S 专区 / T 专区这类专区关掉以后，渠道对比里因为这些渠道还有历史图，
     仍然会摆出一列 —— 前台看起来就像「关了也没关」。
     口径：一个渠道列能不能出现，看它所属专区是否对当前用户可见；
           「上新节奏」列跟随 rhythm 专区；后台自己加的渠道（Amazon、独立站等）没有对应专区，
           一律照常显示，不受影响。
     · 只影响「默认就摆出来」的列，不影响你在本页手动加的那一列；
     · 不删任何数据，重新打开专区后列自动回来。 */
  var CH_ZONE = {
    shein: "shein", pinterest: "pinterest", tiktok: "tiktok",
    s: "shein", p: "pinterest", t: "tiktok",
  };
  function chZone(raw) {
    var k = chKey(String(raw == null ? "" : raw).replace(/^ch:/i, ""));
    if (!k) return "";
    return CH_ZONE[k] || "";
  }
  /* 某专区的列到底摆不摆：全站开关关了就是不摆；账号白名单非空时还必须在白名单里 */
  function zoneOpen(zone) {
    if (!zone) return true;
    if (state.zoneVis && state.zoneVis[zone] === false) return false;
    if (Array.isArray(state.myZones) && state.myZones.length) {
      return state.myZones.indexOf(zone) !== -1;
    }
    return true;
  }
  function srcZoneOf(s) {
    if (!s) return "";
    if (s.type === "rank") return "rhythm";
    return chZone(s.channel || s.key || "");
  }
  /* 20261121C · 榜单列不再只认「上新节奏」一个专区
     ------------------------------------------------------------------
     现象：账号被授权了「趋势上升榜」，但没被授权（或后台关掉了）「上新节奏」时，
           渠道对比的榜单列整列消失 —— 筛选里只剩 S / P / T 三个，看着就像
           「趋势上升榜不在对比栏里了」。
     原因：榜单列的数据是 rank_items 里的月度榜单行，它同时来自「趋势上升榜」与
           「上新节奏」两个专区；但判定只写了 rhythm，于是 rank 被授权也不管用。
     口径：榜单列属于「趋势上升榜 + 上新节奏」两个专区，**任意一个开放就摆**；
           两个都关掉 / 都没授权才不摆。渠道列仍严格跟随各自专区。
     不删任何数据，重新开启专区后列自动回来。 */
  var RANK_ZONES = ["rank", "rhythm"];
  function srcZoneOpen(s) {
    if (s && s.type === "rank") {
      for (var i = 0; i < RANK_ZONES.length; i++) {
        if (zoneOpen(RANK_ZONES[i])) return true;
      }
      return false;
    }
    return zoneOpen(srcZoneOf(s));
  }

  function normCat(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }

  /* ---------- 类目「同一个类目」的判定（20261114Y） ----------
     库里的类目名有两种写法：
       · 后台类目管理里维护的标准名，例如「营装」「卫衣」；
       · 平台全路径名，例如「服装、鞋靴和珠宝饰品，男士时尚，男装，男士休闲营装」。
     它们指同一个类目。以前这里用「字符串完全相等」比对，选「营装」时
     全路径那批图就一张都匹配不上 —— 于是那一列在页面上是空的、被隐藏，
     看起来就像「传了图却没显示」。
     现在只把「同一个类目」这件事判对：
       · 名字完全相同（忽略空格）→ 同一个；
       · 一个是全路径、末段与另一个相同 → 同一个。
     注意：**只用于匹配，不改任何一处的显示名**。名字叫什么，前台就显示什么。 */
  var CAT_SEP = /[，,、＞>｜|;；:：]/;
  function catLastSeg(v) {
    var t = normCat(v);
    if (!CAT_SEP.test(t)) return t;
    var parts = t.split(CAT_SEP).map(function (x) { return x.trim(); }).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : t;
  }
  function catCompact(v) { return normCat(v).replace(/\s+/g, ""); }
  function catSame(a, b) {
    var x = catCompact(a), y = catCompact(b);
    if (!x || !y) return x === y;
    if (x === y) return true;
    /* 模糊匹配只用在「全路径名」上：路径末段里包含标准名即视为同一个类目。
       两个短名之间永远只认完全相等，避免「卫衣」和「卫衣外套」被混成一个。 */
    if (CAT_SEP.test(String(a))) {
      var la = catCompact(catLastSeg(a));
      if (la.indexOf(y) >= 0 || y.indexOf(la) >= 0) return true;
    }
    if (CAT_SEP.test(String(b))) {
      var lb = catCompact(catLastSeg(b));
      if (lb.indexOf(x) >= 0 || x.indexOf(lb) >= 0) return true;
    }
    return false;
  }
  /* 一个类目组代表名：组里最短的那个（标准名通常最短，全路径最长） */
  function catPickLabel(names) {
    var best = "";
    names.forEach(function (n) {
      if (!n) return;
      if (!best) { best = n; return; }
      var bn = catCompact(best), cn = catCompact(n);
      if (cn.length < bn.length || (cn.length === bn.length && n < best)) best = n;
    });
    return best;
  }

  /* 加载提示：每秒报一次已等待秒数，绝不出现「永远是加载中」的观感 */
  var _tickTimer = null;
  function showLoading() {
    var body = $("#cmp-body");
    if (body) body.innerHTML = '<div class="rk-empty" id="cmp-loading">加载中…</div>';
    var t0 = Date.now();
    if (_tickTimer) clearTimeout(_tickTimer);
    (function tick() {
      var el = $("#cmp-loading");
      if (!el) { _tickTimer = null; return; }
      var s = Math.round((Date.now() - t0) / 1000);
      el.innerHTML = "加载中…" + (s >= 2 ? "（已 " + s + " 秒）" : "");
      _tickTimer = setTimeout(tick, 1000);
    })();
  }
  function stopLoading() {
    if (_tickTimer) clearTimeout(_tickTimer);
    _tickTimer = null;
  }

  /* ---------- 取数 ----------
     三条取数一开始就同时发出，只等最慢的一条；打标结果不挡首屏（见 loadTags）。
     之前是「先取渠道图 → 再取配置 → 再取榜单 → 最后取打标」，四段串行，
     每段都等上一次返回，叠起来就是「一直加载中」。 */
  async function load() {
    var SB = SBx();
    if (!SB || state.loading) return;
    state.loading = true;
    showLoading();
    try {
      var pCh = (typeof SB.listRankChannelPics === "function")
        ? Promise.resolve(SB.listRankChannelPics({ periodType: "month" })).catch(function () { return []; })
        : Promise.resolve([]);
      var pCfg = (typeof SB.getCompareSources === "function")
        ? Promise.resolve(SB.getCompareSources()).catch(function () { return null; })
        : Promise.resolve(null);
      var pRk = (typeof SB.listRankItems === "function")
        ? Promise.resolve(SB.listRankItems({
          periodType: "month",
          cols: "id,image_url,category,period_label,period_type,site,channel,title",
        })).catch(function () { return []; })
        : Promise.resolve([]);
      /* ①.3 后台「渠道清单」（20261114T）：清单里登记过的渠道，即使还没有图，
         也要出现在「渠道」筛选里。以前只看数据里出现过的渠道，后台加了一个
         还没传图的渠道，前台就像没加一样。 */
      var pReg = (typeof SB.getCompareChannels === "function")
        ? Promise.resolve(SB.getCompareChannels()).catch(function () { return null; })
        : Promise.resolve(null);

      var got = await Promise.all([pCh, pCfg, pRk, pReg]);
      var chRows = got[0] || [];
      state.cfg = got[1] || null;
      var rankRows = got[2] || [];
      var regChannels = Array.isArray(got[3]) ? got[3] : [];

      /* ① 列（来源）：后台配了就以配置为准，没配就按实际渠道自动生成 */
      var conf = state.cfg && Array.isArray(state.cfg.list) ? state.cfg.list : null;
      var base = [];
      if (conf && conf.length) {
        var seenSrc = {};
        base = conf.map(function (x) {
          /* 20261121D：配置里可能把「上新节奏」这一列存成了普通渠道
             （早期版本保存时丢过 type，或者名字被写成「榜单」）。
             这里按名字认回来，否则它会变成一条没有数据的空渠道列，
             前台看起来就是「上新节奏没了」。 */
          var t = (x.type === "rank" || isRankName(x.channel) || isRankName(x.label) || isRankName(x.key))
            ? "rank" : "channel";
          /* 配置里存的是渠道原文；这里按归一键对齐，写法差异不会把一列变成空列 */
          var k = t === "rank" ? "rank:month" : "ch:" + chKey(x.channel || x.label || x.key);
          return {
            key: k,
            label: srcLabel(x.label, t === "rank" ? "上新节奏" : x.channel),
            type: t, channel: x.channel || "",
          };
        }).filter(function (s) {
          if (!s.key || s.key === "ch:" || seenSrc[s.key]) return false;
          seenSrc[s.key] = 1;
          return true;
        });
      } else {
        base = defaultSources(chRows);
      }
      /* ①.2 清单里登记过、但数据里还没有图的渠道：补成一列（显示「无图」，点开可看）
         口径：清单是「能配置哪些渠道」的唯一来源；数据里出现的渠道名只要还在清单里
         就照常出列，不在清单里的按原有自动发现逻辑照旧，不会突然消失。 */
      if (regChannels.length) {
        var haveKey = {};
        base.forEach(function (s) { haveKey[s.key] = 1; });
        regChannels.forEach(function (raw) {
          var c = String(raw || "").trim();
          if (!c) return;
          var k = "ch:" + chKey(c);
          if (!k || k === "ch:" || haveKey[k]) return;
          haveKey[k] = 1;
          base.push({ key: k, label: chShort(c), type: "channel", channel: c, fromList: true });
        });
      }

      /* ①.1 榜单列是内置列：配置里没有就补在最前面（20261121D）
         以前这里完全听配置的，配置里一旦没有 rank 项（保存时被移出 / type 丢了），
         这一列就永久消失，前端没有任何入口能加回来 —— 这就是「上新节奏不见了」。 */
      (function ensureRank() {
        var has = false;
        base.forEach(function (s) { if (s && s.type === "rank") has = true; });
        if (!has) base.unshift(rankSource());
      })();

      /* ①.5 后台关掉的专区：它的渠道列不摆（20261114T）
         以前这里只看「库里有没有这个渠道的图」，后台关掉 S / T 专区后，
         历史图仍在库里，于是照样多出一列 —— 现在按专区开关先剔一遍。 */
      var zoneOff = 0;
      var zoneDropped = [];
      base = base.filter(function (s) {
        if (srcZoneOpen(s)) return true;
        zoneOff++;
        zoneDropped.push(s);
        return false;
      });
      state.zoneHidden = zoneOff;
      state.zoneDropped = zoneDropped;

      state.base = base;
      /* 列 = 后台配置 / 自动发现，再按「专区开关」过一遍（20261114T）：
         后台关掉的专区，它的渠道列不出现，前台也不能自己加回来。 */
      state.sources = computeSources();

      /* ② 渠道图 URL 集合：榜单行里与渠道图重复的地址不再进「上新节奏」列 */
      var chUrls = {};
      var byKey = {};
      var all = [];
      chRows.forEach(function (r) {
        var u = imgUrl(r.image_url);
        if (!u) return;
        var k = chKey(r.channel);
        if (!k) return;
        chUrls[u] = 1;
        var cat = normCat(r.category);
        if (!cat) return;
        var it = {
          image_url: u, category: cat,
          month: normMonth(r.period_label || r.m || ""),
          site: "", source: "ch:" + k, title: String(r.title || ""),
        };
        (byKey[it.source] = byKey[it.source] || []).push(it);
        all.push(it);
      });
      rankRows.forEach(function (r) {
        var u = imgUrl(r.image_url);
        if (!u || chUrls[u]) return;
        if (String(r.channel || "").trim()) return;      /* 有渠道归属的行归到渠道列 */
        var cat = normCat(r.category);
        if (!cat) return;
        var it = {
          image_url: u, category: cat,
          month: normMonth(r.period_label || ""),
          site: String(r.site || ""), source: "rank:month", title: String(r.title || ""),
        };
        (byKey["rank:month"] = byKey["rank:month"] || []).push(it);
        all.push(it);
      });

      /* 同一列里同图只留一条 */
      Object.keys(byKey).forEach(function (k) {
        var seen = {}, uniq = [];
        byKey[k].forEach(function (r) { if (!seen[r.image_url]) { seen[r.image_url] = 1; uniq.push(r); } });
        byKey[k] = uniq;
      });
      state.data = byKey;
      state.items = all;
      state.tags = {};
      state.tagTried = {};

      /* 月份清单：两处并集，倒序 */
      var ms = {};
      all.forEach(function (r) { if (r.month) ms[r.month] = 1; });
      state.months = Object.keys(ms).sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
      /* null = 用户还没选过 → 默认落到最新月份；"" = 用户主动选了「全部月份」，不要覆盖他 */
      if (state.month === null || state.month === undefined) state.month = state.months[0] || "";
      else if (state.month && state.months.indexOf(state.month) < 0) state.month = state.months[0] || "";

      /* 首屏立刻画出来：打标结果在后台补，不再让它挡住列表 */
      renderFilter();
      renderCats();
      renderPools();
      loadTags();
    } catch (e) {
      $("#cmp-body").innerHTML = '<div class="rk-empty">读取失败，请刷新重试</div>';
    } finally {
      stopLoading();
      state.loading = false;
    }
  }

  /* ---------- 打标结果：只取当前屏幕上真正会显示的图，取到后补小圆点 ---------- */
  function visibleUrls() {
    var out = [], seen = {};
    activeSources().forEach(function (s) {
      colItems(s).list.forEach(function (r) {
        if (out.length >= 1200 || seen[r.image_url]) return;
        seen[r.image_url] = 1;
        out.push(r.image_url);
      });
    });
    return out;
  }

  async function fetchTags(urls) {
    var SB = SBx();
    var list = (urls || []).filter(function (u) { return u && !state.tagTried[u]; });
    if (!SB || !list.length) return;
    list.forEach(function (u) { state.tagTried[u] = 1; });
    try {
      var got = null;
      if (typeof SB.listMovementTags === "function") got = await SB.listMovementTags(list);
      else if (typeof SB.listImageTags === "function") got = await SB.listImageTags(list);
      if (got) Object.keys(got).forEach(function (u) { state.tags[u] = got[u]; });
    } catch (e) { /* 打标读不到不该让页面白屏，图标不显示即可 */ }
  }

  function taggedOf(url) {
    var t = state.tags[url] || {};
    var KEYS = ["style_tags", "visual_tags", "pattern_tags", "element_tags", "struct_tags",
      "fabric_tags", "craft_tags", "shoot_tags", "skin_tags", "fit_tags",
      "culture_tags", "psych_tags", "festival_tags"];
    for (var i = 0; i < KEYS.length; i++) { if ((t[KEYS[i]] || []).length) return true; }
    return false;
  }

  function patchTaggedDots() {
    var body = $("#cmp-body");
    if (!body || typeof body.querySelectorAll !== "function") return;
    Array.prototype.forEach.call(body.querySelectorAll(".cmp-card"), function (fig) {
      var u = fig.getAttribute("data-url");
      if (!taggedOf(u) || fig.querySelector(".cmp-tagged")) return;
      var dot = document.createElement("span");
      dot.className = "cmp-tagged";
      dot.title = "已打标";
      dot.textContent = "●";
      fig.appendChild(dot);
    });
  }

  async function loadTags() {
    var urls = visibleUrls();
    if (!urls.length) return;
    await fetchTags(urls);
    patchTaggedDots();
  }

  /* ---------- 上方筛选：月度（列的选择在后台，不在这里） ---------- */
  function renderFilter() {
    var box = $("#cmp-groups");
    if (!box) return;
    box.innerHTML = "";
    var g = document.createElement("div");
    g.className = "tag-group";
    var name = document.createElement("div");
    name.className = "tag-group-name";
    name.textContent = "月度";
    var chips = document.createElement("div");
    chips.className = "tag-chips";
    function chip(v, text) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tag-chip" + (state.month === v ? " active" : "");
      b.textContent = text;
      /* 换月份时把类目回到「全部」：否则原来选的类目在新月份可能没有图，
         会看起来像「这个月什么都没有」 */
      b.onclick = function () { state.month = v; state.cat = ALL; renderFilter(); renderCats(); renderPools(); loadTags(); };
      return b;
    }
    if (!state.months.length) {
      var t = document.createElement("span");
      t.className = "tag-chip";
      t.style.opacity = ".55";
      t.textContent = "暂无月份";
      chips.appendChild(t);
    }
    /* 「全部月份」：各来源的月份写法不一致时（例如一边 2026-11、一边 第45周），
       只有选全部才能把它们摆在一起看 */
    chips.appendChild(chip("", "全部月份"));
    state.months.forEach(function (m) { chips.appendChild(chip(m, m)); });
    g.appendChild(name);
    g.appendChild(chips);
    box.appendChild(g);

    /* ---------- 渠道筛选：决定下面到底摆哪几列 ---------- */
    box.appendChild(srcGroup());

    syncSummary();
  }

  /* 「渠道」筛选组：只控制显示哪些列（本地过滤，不重新取数）
     - 当前月份没有图的渠道，默认不显示，不再占一列空白；
     - 想在筛选里点名看某个空渠道，点它就能强制显示。 */
  function srcGroup() {
    var g = document.createElement("div");
    g.className = "tag-group";
    var name = document.createElement("div");
    name.className = "tag-group-name";
    name.textContent = "渠道";
    var chips = document.createElement("div");
    chips.className = "tag-chips";

    var shown = activeSources();
    var shownKey = {};
    shown.forEach(function (s) { shownKey[s.key] = 1; });

    /* 全部：清掉手动开关，显示这个月份下有图的全部渠道 */
    var allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "tag-chip" + (shown.length === state.sources.length ? " active" : "");
    allBtn.textContent = "全部";
    allBtn.title = "显示这个月份下有图的全部渠道";
    allBtn.onclick = function () {
      state.srcOn = {};
      state.srcOff = {};
      renderFilter(); renderCats(); renderPools(); loadTags();
    };
    chips.appendChild(allBtn);

    /* 20261114Y：筛选里只列「这个月真的有图」的渠道。
       这个月没图的渠道不再出现在这里，也不写"无图（另有 N 张在别的月份）"这种容易被误读的文案 ——
       没图就是没有，不用别的月份顶替。渠道本身的增删在后台「渠道对比」里配置。
       20261121C：榜单列例外 —— 它始终列在这里，哪怕这个月没有榜单图。
       原因：榜单列一消失，看起来就像「趋势上升榜不在对比栏里了」，
             而且用户无从判断是没图、还是被专区开关挡了、还是被删了。
             保留它 + 标「本月无图」，点一下会说明原因，比静默消失清楚得多。 */
    state.sources.filter(function (s) {
      if (s.type === "rank") return true;
      return !state.month || colHasData(s);
    }).forEach(function (s) {
      var n = sourceItems(s).filter(function (r) {
        return !state.month || r.month === state.month;
      }).length;
      var on = !!shownKey[s.key];
      var empty = !n;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tag-chip" + (on ? " active" : "") + (empty ? " is-empty" : "");
      b.setAttribute("data-src", s.key);
      if (empty) {
        b.title = s.type === "rank"
          ? "这个月还没有" + s.label + "的图（换一个有图的月份，或先在后台导入月度榜单）"
          : "这个月还没有这个渠道的图";
      } else {
        b.title = on ? "点一下隐藏这一列" : "点一下显示这一列";
      }
      b.textContent = s.label + (n ? " " + n : " 本月无图");
      b.onclick = function () {
        /* 20261121D：本月无图的项，点一下只解释原因，不切换显示（空列没有可看的图，
           更不该「点了没反应」）。榜单列的空列本身仍然摆在池子里，并写明本月无图。 */
        if (empty) {
          toast(s.type === "rank"
            ? "「" + s.label + "」这个月没有图：换一个有图的月份（上方月份筛选），或先在后台导入月度榜单"
            : "「" + s.label + "」这个月没有图", false);
          return;
        }
        var willHide = !!shownKey[s.key];
        if (willHide) {
          /* 至少留一列，否则整页空白 */
          if (shown.length <= 1) { toast("至少要保留一列", false); return; }
          delete state.srcOn[s.key];
          state.srcOff[s.key] = 1;
        } else {
          delete state.srcOff[s.key];
          state.srcOn[s.key] = 1;
        }
        renderFilter(); renderCats(); renderPools(); loadTags();
      };
      chips.appendChild(b);
    });

    /* 20261121D：被「专区开关 / 账号白名单」挡掉的列，具名列在这里（灰态、点一下说明原因）。
       以前只在摘要里写一个数字，用户看到「上新节奏没了」根本不知道是被关了还是没数据。 */
    (state.zoneDropped || []).forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tag-chip is-empty";
      b.setAttribute("data-src-hidden", s.key);
      b.textContent = (s.label || s.key) + " 未显示";
      b.title = "这一列被专区开关挡住了";
      b.onclick = function () {
        toast(s.type === "rank"
          ? "「" + (s.label || "上新节奏") + "」列没有摆出来：它属于「趋势上升榜 / 上新节奏」两个专区，两个都被后台关闭或你的账号都未授权。请让超管在后台「前台访问设置」里开启其一。"
          : "「" + (s.label || s.key) + "」列没有摆出来：它所属的专区已在后台关闭，或你的账号未获授权。", false);
      };
      chips.appendChild(b);
    });

    g.appendChild(name);
    g.appendChild(chips);
    return g;
  }

  function syncSummary() {
    var sum = $("#cmp-summary");
    if (!sum) return;
    var n = activeSources().length;
    var hid = hiddenByEmpty();
    /* 20261121C：榜单列本月没有图时，摘要里点明一句。
       否则筛选里虽然看得见「本月无图」，用户仍会怀疑是数据丢了 / 专区被关了。 */
    var rankEmpty = state.sources.some(function (s) {
      return s.type === "rank" && !colHasData(s);
    });
    /* 20261114Y：这个月没有图的渠道，直接不摆、也不再用别的月份的图顶替，
       所以这里只说「有几个渠道这个月没有图」，不再引导去点别的月份。 */
    sum.textContent = (state.month || "全部月份") + " · " + n + " 列对比" +
      (rankEmpty ? "（本月无榜单图）" : "") +
      (hid.length ? "（另有 " + hid.length + " 个渠道这个月没有图，未显示）" : "") +
      (state.zoneHidden ? "（" + zoneDroppedText() + " 因其专区已在后台关闭而未显示）" : "");
  }

  /* 20261121D：把「被专区开关挡掉」的列具名写出来，不再只说一个数字 */
  function zoneDroppedText() {
    var arr = state.zoneDropped || [];
    if (!arr.length) return state.zoneHidden + " 列";
    var names = arr.map(function (s) { return "「" + (s.label || s.key) + "」"; });
    var head = names.slice(0, 3).join("、");
    if (names.length > 3) head += " 等 " + names.length + " 列";
    return head;
  }

  /* ---------- 左侧：服装类目 ---------- */
  function monthItems() {
    return state.items.filter(function (r) { return !state.month || r.month === state.month; });
  }

  function renderCats() {
    var nav = $("#cmp-cats");
    if (!nav) return;
    var list = monthItems();
    /* 按「同一个类目」分组：全路径名与标准名合成一条，菜单里显示最短的那个
       （也就是后台类目管理里的标准名），计数是这一组的总数。 */
    var groups = [];
    list.forEach(function (r) {
      var c = normCat(r.category);
      if (!c) return;
      for (var i = 0; i < groups.length; i++) {
        if (catSame(groups[i].names[0], c)) {
          groups[i].names.push(c); groups[i].count++;
          return;
        }
      }
      groups.push({ names: [c], count: 1 });
    });
    groups = groups.map(function (g) {
      return { label: catPickLabel(g.names), count: g.count };
    }).sort(function (a, b) { return b.count - a.count; });
    var names = groups.map(function (g) { return g.label; });
    var cnt = {};
    groups.forEach(function (g) { cnt[g.label] = g.count; });

    nav.innerHTML = "";
    function add(name, count) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cat-menu-item" + (state.cat === name ? " active" : "");
      b.innerHTML = esc(name) + (count != null ? ' <span class="cvi-state">' + count + "</span>" : "");
      b.onclick = function () { state.cat = name; renderCats(); renderPools(); loadTags(); };
      nav.appendChild(b);
    }
    add(ALL, list.length);
    if (!names.length) {
      var t = document.createElement("div");
      t.className = "cat-menu-tip";
      t.textContent = "暂无类目";
      nav.appendChild(t);
      return;
    }
    names.forEach(function (c) { add(c, cnt[c] || null); });
  }

  /* ---------- 差异分析：把当前这一屏的数据交给分析模块 ---------- */
  function visibleList(s) {
    return colItems(s).list;
  }

  function insightCtx() {
    var srcs = activeSources().filter(function (s) { return visibleList(s).length > 0; });
    return {
      month: state.month, cat: state.cat, tags: state.tags,
      sources: srcs.map(function (s) {
        return { key: s.key, label: s.label, type: s.type, list: visibleList(s) };
      }),
    };
  }

  /* 打开分析：key 指定「分析哪个来源」，为空时挑一个渠道列（通常就是用户想问的那个） */
  async function openInsight(key) {
    if (!window.CmpInsight || typeof window.CmpInsight.open !== "function") {
      toast("分析组件未加载，请刷新页面后重试", false);
      return;
    }
    var ctx = insightCtx();
    if (!ctx.sources.length) { toast("这个月份 / 类目下还没有图片，先换一个再看看", false); return; }
    var need = [];
    ctx.sources.forEach(function (s) {
      s.list.forEach(function (r) {
        if (need.length < 1500 && r.image_url && !state.tagTried[r.image_url]) need.push(r.image_url);
      });
    });
    if (need.length) {
      toast("正在准备打标数据…");
      await fetchTags(need);
    }
    var focus = key;
    if (!focus) {
      var ch = ctx.sources.filter(function (s) { return s.type !== "rank"; })[0] || ctx.sources[0];
      focus = ch ? ch.key : "";
    }
    window.CmpInsight.open(ctx, focus);
  }

  /* ---------- 多列对比池 ---------- */
  /* 每行几张：与趋势上升榜同一套算法 ——「列宽 ÷ 目标卡宽（130px）」。
     因此列数减少（每列更宽）时，每行自动摆更多；列数增多时，每行自动变少，
     图不会被压成一小格。这里只是渲染前的估算，插入 DOM 后 fitPools 会按实测列宽校正。 */
  function perRowOf(n, containerW) {
    var fixed = state.cfg && Number(state.cfg.perRow);
    if (fixed >= 1) return Math.min(6, Math.max(1, fixed));
    var cg = window.CardGrid;
    var W = Number(containerW) || 0;
    if (!W) { var host = $("#cmp-body"); W = host ? host.clientWidth || 0 : 0; }
    if (W > 0 && n > 0 && cg && cg.cols) {
      /* 减去列间距与列内边距，得到单列内部的可用宽度 */
      var colW = (W - (n - 1) * 10) / n - 22;
      var c = cg.cols(colW);
      if (c) return c;
    }
    if (n <= 2) return 6;
    if (n === 3) return 4;
    if (n === 4) return 3;
    return 2;
  }

  /* 插入 DOM 后按每列实测宽度重算，保证「页面实际多宽就摆多少张」。
     20261114Q 提速：原来「读宽度 → 写样式」在循环里交替进行，每一轮都会强制
     浏览器重排一次；列多、卡片多时切「小/中/大」要等好几百毫秒。
     现在先一次性把宽度读完，再统一写，只触发一次重排。 */
  function fitPools() {
    var body = $("#cmp-body");
    if (!body) return;
    var cg = window.CardGrid;
    var fixed = state.cfg && Number(state.cfg.perRow);
    var grids = body.querySelectorAll(".rk-pool-grid");
    var list = [];
    for (var i = 0; i < grids.length; i++) {
      var w = grids[i].clientWidth || 0;   /* 先读完 */
      list.push({ el: grids[i], w: w });
    }
    for (var j = 0; j < list.length; j++) {
      if (!list[j].w) continue;
      var el = list[j].el;
      var n = el.querySelectorAll(".rk-card").length;
      var c = fixed >= 1 ? Math.min(6, Math.max(1, fixed))
                         : (cg && cg.cols ? cg.cols(list[j].w) : 0);
      if (!c) continue;
      if (n) c = Math.min(c, Math.max(1, n));
      el.style.setProperty("--rk-r", String(c));   /* 再统一写 */
    }
  }

  var _fitTimer = null;
  function fitPoolsSoon() {
    if (_fitTimer) clearTimeout(_fitTimer);
    _fitTimer = setTimeout(function () { _fitTimer = null; try { fitPools(); } catch (e) {} }, 50);
  }
  /* 20261114Q · 图幅「小 / 中 / 大」即时生效
     以前切档只重排别的专区，这一页的每行张数要等窗口尺寸变化才更新，
     表现就是「点了半天没反应」。现在监听图幅变化，只按已有列宽重算每列的
     --rk-r：不重新取数、不重画卡片、不动筛选，所以是瞬时的。 */
  function onImgSizeChange() {
    if (_fitTimer) clearTimeout(_fitTimer);
    _fitTimer = setTimeout(function () { _fitTimer = null; try { fitPools(); } catch (e) {} }, 0);
  }
  if (window && typeof window.addEventListener === "function") {
    window.addEventListener("resize", fitPoolsSoon);
    window.addEventListener("load", fitPoolsSoon);
    window.addEventListener("cardgrid:size", onImgSizeChange);
    try { if (window.CardGrid && window.CardGrid.onChange) window.CardGrid.onChange(onImgSizeChange); } catch (e) {}
  }

  function renderPools() {
    var body = $("#cmp-body");
    var bar = $("#cmp-bar");
    if (!body) return;
    var srcs = activeSources();
    var cat = state.cat;

    var total = 0;
    srcs.forEach(function (s) {
      total += colItems(s).list.length;
    });

    if (bar) {
      bar.innerHTML = '<span class="rk-bar-info">共 <b>' + total + "</b> 张 · " + srcs.length + " 列" +
        (state.month ? " · " + esc(state.month) : " · 全部月份") + (cat !== ALL ? " · " + esc(cat) : "") + "</span>" +
        '<span class="cmp-bar-actions">' +
        '<button type="button" class="cmi-btn cmi-btn-ghost" id="cmp-insight-all" title="按当前类目与月份，对比各来源的打标结构差异">渠道差异分析</button>' +
        "</span>";
    }

    if (!srcs.length) {
      body.innerHTML = '<div class="rk-empty">这个月份 / 类目下还没有可对比的来源。<br>先在「趋势上升榜 / 上新节奏 / S 专区 / P 专区 / T 专区」里传图；<br>想增加对比渠道，请超管在后台「渠道对比 · 对比列配置」里添加。' +
        (state.zoneHidden ? '<br><br>' + state.zoneHidden + ' 个渠道没有摆出来：它们对应的专区已在后台关闭。' +
          '<br>想看到它们，请让超管在后台「前台访问设置」里重新开启该专区。' : "") +
        "</div>";
      return;
    }
    /* 20261121D：以前「一张图都没有」时整块池子不画，用户看到的就是「没有渠道对比池子」。
       现在照常把列画出来，每一列自己说明「本月无图 / 该列暂无数据」，
       顶部再给一句能直接操作的提示（尤其是有图的月份可以一键切过去）。 */
    var notice = "";
    var rankS0 = srcs.filter(function (s) { return s.type === "rank"; })[0];
    var rankEmptyCol = !!(rankS0 && !colItems(rankS0).list.length);
    if (rankEmptyCol) {
      /* 榜单列这个月没图：即使别的渠道有图，也要在顶部说清楚（否则用户以为这一列坏了） */
      var ms0 = {};
      sourceItems(rankS0).forEach(function (r) { if (r.month) ms0[r.month] = 1; });
      var otherMonths = Object.keys(ms0).sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
      notice = '<div class="rk-empty">' + esc(state.month || "全部月份") + " 这个月份没有「" +
        esc(rankS0.label) + "」的图" +
        (cat !== ALL ? "（类目：" + esc(cat) + "）" : "") + "。" +
        (otherMonths.length
          ? '<br>库里其它月份有：' + otherMonths.slice(0, 6).map(function (m) {
              return '<button type="button" class="cmi-btn" data-jump-month="' + esc(m) + '">' + esc(m) + "</button>";
            }).join(" ")
          : "") +
        '<br><span class="hint">想先看别的渠道，点上方「筛选 → 渠道」换成有图的月份；本列不会用别的月份的图顶替。</span></div>';
    } else if (!total) {
      var hasAny = state.sources.some(function (s) { return colItems(s).list.length > 0; });
      notice = hasAny
        ? '<div class="rk-empty">当前显示的 ' + srcs.length + " 列在这个月份 / 类目下都没有图片。<br>点上方「筛选 → 渠道」打开其它渠道再看看。</div>"
        : '<div class="rk-empty">这个月份 / 类目下还没有图片，换个月份或类目试试。</div>';
    }

    var pr = perRowOf(srcs.length, body.clientWidth || 0);
    var html = notice + '<div class="rk-pools">';
    srcs.forEach(function (s) {
      var got = colItems(s);
      var list = got.list;
      var emptyNote = (s.type === "rank" && state.month)
        ? "本月没有「" + esc(s.label) + "」的图（不会用其它月份顶替）"
        : "该列暂无数据";
      html += '<section class="rk-pool" data-src="' + esc(s.key) + '">';
      html += '<div class="rk-pool-head"><div class="rk-pool-name"><span>' + esc(s.label) +
        '</span><span class="rk-n">' + list.length + " 张</span></div>" +
        '<div class="rk-pool-meta">' + esc(s.type === "rank" ? "月度榜单" : "渠道图") +
        (state.month ? " · " + esc(state.month) : "") +
        (list.length ? ' <button type="button" class="cmi-btn" data-insight="' + esc(s.key) +
          '" title="看这一列与其它来源的打标结构差异">详细分析</button>' : "") +
        "</div></div>";
      html += '<div class="rk-pool-grid" style="--rk-r:' + pr + '">';
      if (!list.length) {
        html += '<div class="rk-empty">' + emptyNote + "</div>";
      } else {
        list.forEach(function (it) {
          html += '<figure class="rk-card cmp-card" data-url="' + esc(it.image_url) + '" title="' +
            esc([it.category, it.month, it.site].filter(Boolean).join(" · ")) + '">' +
            '<img loading="lazy" decoding="async" src="' + esc(thumbOf(it.image_url)) + '" data-full="' + esc(it.image_url) + '" alt="' + esc(it.category) + '">' +
            (taggedOf(it.image_url) ? '<span class="cmp-tagged" title="已打标">●</span>' : "") +
            "</figure>";
        });
      }
      html += "</div></section>";
    });
    html += "</div>";
    body.innerHTML = html;

    Array.prototype.forEach.call(body.querySelectorAll(".cmp-card"), function (fig) {
      fig.onclick = function () { openModal(fig.getAttribute("data-url")); };
    });
    Array.prototype.forEach.call(body.querySelectorAll(".cmi-btn[data-insight]"), function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        openInsight(btn.getAttribute("data-insight"));
      };
    });
    var allBtn = $("#cmp-insight-all");
    if (allBtn) allBtn.onclick = function () { openInsight(""); };
    /* 20261121D：没图的月份旁边直接给出「有图的月份」，点一下切过去 */
    Array.prototype.forEach.call(body.querySelectorAll("[data-jump-month]"), function (btn) {
      btn.onclick = function () {
        state.month = btn.getAttribute("data-jump-month") || "";
        state.srcOff = {};
        renderFilter(); renderCats(); renderPools(); loadTags();
      };
    });
    /* 首屏按实测列宽再校正一次（渲染前只能估算） */
    fitPools();
    fitPoolsSoon();
  }

  /* ---------- 大图 + 打标 ---------- */
  var GROUPS = [
    ["风格", ["style_tags"]], ["视觉", ["visual_tags"]], ["图案类型", ["pattern_tags"]],
    ["图案元素", ["element_tags"]], ["结构部件", ["struct_tags"]], ["面料", ["fabric_tags"]],
    ["二次工艺", ["craft_tags"]], ["拍摄方式", ["shoot_tags"]], ["模特", ["skin_tags"]],
    ["版型", ["fit_tags"]], ["文化背景", ["culture_tags"]], ["消费心理", ["psych_tags"]],
    ["节日", ["festival_tags"]]
  ];

  function openModal(url) {
    if (!url) return;
    /* 打标结果改成按需取：点开哪张只查那一张，首屏不再为上万张图排队等标签 */
    if (state.tagTried[url]) { paintModal(url); return; }
    paintModal(url);
    fetchTags([url]).then(function () { paintModal(url); });
  }

  function paintModal(url) {
    var t = state.tags[url] || {};
    var big = $("#cmp-big");
    if (big) big.src = url;
    var it = state.items.filter(function (r) { return r.image_url === url; })[0] || {};
    var title = $("#cmp-title");
    if (title) title.textContent = [it.category, it.month, it.site].filter(Boolean).join(" · ");
    var box = $("#cmp-tags");
    if (!box) return;
    box.innerHTML = "";
    var any = false;
    GROUPS.forEach(function (g) {
      var vals = [];
      g[1].forEach(function (f) {
        (t[f] || []).forEach(function (v) { if (vals.indexOf(v) < 0) vals.push(v); });
      });
      if (!vals.length) return;
      any = true;
      var row = document.createElement("div");
      row.className = "mv-tag-row";
      row.innerHTML = '<div class="mv-tag-k">' + esc(g[0]) + '</div><div class="mv-tag-v">' +
        vals.map(function (v) { return '<span class="mv-chip">' + esc(v) + "</span>"; }).join("") + "</div>";
      box.appendChild(row);
    });
    if (!any) box.innerHTML = '<div class="mv-empty-tag">这张图还没有打标</div>';
    $("#cmp-modal").classList.remove("hidden");
  }
  function closeModal() {
    var m = $("#cmp-modal");
    if (m) m.classList.add("hidden");
  }

  function bind() {
    var c = $("#cmp-close");
    if (c) c.onclick = closeModal;
    var m = $("#cmp-modal");
    if (m) m.onclick = function (e) { if (e.target === m) closeModal(); };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    bind();
    var SB = SBx();
    /* 登录态：与其它前台页一致，未登录回登录页 */
    var logged = false;
    try {
      var sess = (SB && typeof SB.getSession === "function") ? await SB.getSession() : null;
      if (sess && sess.user) {
        logged = true;
        var u = $("#cmp-user");
        if (u) { u.textContent = sess.user.email || ""; u.classList.remove("hidden"); }
        var li = $("#cmp-login"); if (li) li.classList.add("hidden");
      }
      var lo = $("#cmp-logout");
      if (lo) {
        lo.classList.toggle("hidden", !logged);
        lo.onclick = async function () { try { await SB.signOut(); } catch (e) {} location.href = "index.html"; };
      }
      if (!logged) {
        var li2 = $("#cmp-login"); if (li2) li2.classList.remove("hidden");
        location.replace("index.html");
        return;
      }
    } catch (e) { /* 拿不到会话也继续尝试渲染 */ }

    try {
      if (window.Common && Common.zones && Common.zones.loadDefs) await Common.zones.loadDefs();
      var vis = null, myz = null;
      try { vis = await SB.getFrontendZoneVisibility(); } catch (e) { vis = null; }
      try { myz = await SB.myFrontendZones(); } catch (e) { myz = null; }
      /* 渠道列也要受这些开关约束（20261114T）：关掉的专区不该再在对比里出现一列 */
      state.zoneVis = vis || null;
      state.myZones = Array.isArray(myz) ? myz : null;
      if (window.Common && Common.zones) {
        Common.zones.setVis(vis || {});
        Common.zones.setMine(Array.isArray(myz) ? myz : null);
        if (Common.zones.applyNav) Common.zones.applyNav();
        state.vis = Common.zones.visible(KEY) !== false;
      }
      if (vis && vis[KEY] === false) {
        state.gate = "全站开关：该专区已在后台「前台访问设置」中被关闭";
      } else if (Array.isArray(myz) && myz.length && myz.indexOf(KEY) === -1) {
        state.gate = "账号授权：你的账号未获授权访问本专区";
      }
      if (window.Common && Common.visit) { try { Common.visit.track(KEY); } catch (e0) {} }
    } catch (e) { /* 导航显隐失败不影响展示 */ }

    var tabs = document.querySelector(".top-tabs");
    if (tabs) tabs.classList.remove("is-booting");

    if (!state.vis || state.gate) {
      $("#cmp-cats").innerHTML = '<div class="cat-menu-tip">未开放</div>';
      $("#cmp-body").innerHTML = '<div class="rk-empty">' + esc(state.gate || "该专区暂未对你开放，请联系管理员") + "</div>";
      var bar0 = $("#cmp-bar");
      if (bar0) bar0.innerHTML = "";
      return;
    }
    await load();
  }

  /* 20261114W：别的标签页删了图 / 改了数据时，本页立刻重取（详见 js/data-sync.js） */
  window.__tbReload = function () { return load(); };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
