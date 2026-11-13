/* ============================================================================
 * rank.js —— 前台「趋势上升榜」专区
 *
 * 布局：与「视觉专区」一致 —— 左侧类目菜单栏 + 上方筛选栏（悬停/点击展开）+ 多列对比池
 *
 * 两种对比模式（严格按需求口径）：
 *   ① 横向 · 国家对比：选 1 个类目 + 选 1 个周次 + 多选国家 → 每国一列并排；
 *      列头标注「与其余所选国家重合多少张 / 重合度」；同一张图出现在多国时卡片角标「共 N 国」。
 *   ② 纵向 · 时间对比：选 1 个类目 + 选 1 个国家 + 多选周次 → 每期一列并排；
 *      相同图标注「新上榜 / 上升 N 位 / 下降 N 位」。
 *
 * 三档标签（与后台同口径 · A 口径：同 类目+站点+期次 各自一池）：
 *   潜力机会 = 环比比例上升；趋势爆款 = 环比绝对值上升前 20 名；
 *   周度激增 = 比例与绝对值双重提升的前 20%（至少 1 个）。
 *
 * 硬性约束：前台不出现任何环比具体数值，只用标签与位次变化表达。
 * ==========================================================================*/
(function () {
  "use strict";

  var SBX = (typeof SB !== "undefined") ? SB : (window.SB || null);
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };

  /* 叶子类目取值可能有三种情况：
     ① 正常名称（「服装、鞋靴和珠宝饰品,男士时尚,男装,T 恤」）；
     ② 上游表里「叶子类目ID」列排在名称列前面，被误当成名称存进来的一串数字；
     ③ 空。
     只有 ① 才值得展示 —— ②③ 一律当空处理，避免页面和导出表里出现裸 ID。 */
  function leafOf(it) {
    var v = String((it && it.leaf_category) || "").trim();
    if (!v) return "";
    if (/^[\d\s,，、|_\-.]+$/.test(v)) return "";
    return v;
  }

  /* 类目名归一：库里可能残留平台全路径名
     （「服装，鞋靴和珠宝饰品，男士时尚，男装，男士休闲运动服，男士休闲运动套装，男士运动服」），
     前台菜单不能照原样一条条列出来 —— 合并成标准类目显示，
     查询时再用映射把标准名展开成它包含的所有原始类目名。 */
  function normCatName(x) {
    var raw = String(x == null ? "" : x).trim();
    if (!raw) return "";
    if (typeof window !== "undefined" && window.RankCatNorm) return window.RankCatNorm.normalize(raw);
    return raw;
  }
  var RAW_CATS = [];      /* 库里真实的类目名（可能很脏） */
  var CAT_MAP = {};       /* 标准名 → 原始类目名数组 */
  function catsOf(label) {
    var k = String(label || "");
    return (CAT_MAP && CAT_MAP[k] && CAT_MAP[k].length) ? CAT_MAP[k].slice() : (k ? [k] : []);
  }

  var ALL = "全部";
  var CAP_STEP = 48;         // 每列初始展示张数（先小，避免一次拉太多图片）
  var CAP_MAX = 288;         // 每列上限

  var FACETS = { sites: [], periods: [], categories: [] };
  var BUILD = "20261113V";   /* 前台脚本版本：空态/诊断里会显示，用于核对是不是旧缓存 */
  var MODE = "v";            // 默认「纵向 · 时间对比」；h=横向·国家对比 / v=纵向·时间对比 / c=横向·类目对比
  var CAT = ALL;
  var SEL_CATS = [];         // 横向·类目对比：并排显示的类目（1–4 个，列数 = 勾选数，可拖动换序）
  var SEL_CATS_LEN = 0;      // 上一次的类目个数：切类目时保持列数不突然变
  var TAG_INDEX = {};        // 图片打标索引（url → 打标维度），类目对比用它算拍摄方式 / 元素
  /* 20261103A：图案印花款前台展示开关（后台可关）。
     false = 展示（默认）；true = 有印花图案的款整款不展示，榜单 / 统计 / 报告一起变。 */
  var PRINT_HIDE = false;
  var TAG_KEY = "";          // 已加载的索引对应哪一批图，避免重复请求
  var TAG_BUSY = false;
  /* 20261103G：改为按「这张图核对过了没」记账，不再比整批指纹。
     以前比指纹有两个坑：① SBX 没有标签接口时 key 永远是空 → 永远判未就绪，
     页面就一直停在等待提示上；② 两次请求的图集稍有差别就对不上。 */
  var TAG_SEEN = {};
  /* 已核对过的标签落本地缓存：第二次看同一批图直接命中，
     不用再等网络，等待提示也就不会出现。 */
  var TAG_STORE_KEY = "rk_tag_store_v2", TAG_STORE = null, TAG_STORE_ORDER = [], TAG_STORE_MAX = 6000;
  /* 20261103I：整表预取状态。
     以前是"切到哪一类目才去取那一批图的标签"，每换一次类目都要重新核对一遍，
     用户体感就是"每次切类目都在等"。现在页面打开后后台把整张打标表读一次，
     之后所有类目 / 周次 / 国家的切换都直接命中内存与本地缓存，不再等网络。 */
  var TAG_ALL_STATE = 0;     // 0 未开始 1 进行中 2 已完成 3 接口不支持
  var TAG_ALL_AT = 0;
  var TAG_GATE_AT = 0;       // 首次因"未核对"而挡住渲染的时间点
  var TAG_GATE_WAIT = 700;  // 最多等这么久，超时先出图（后台补完会自动重绘）
  function tagStoreInit() {
    if (TAG_STORE) return;
    TAG_STORE = {};
    try {
      var raw = (window.localStorage || {}).getItem(TAG_STORE_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.m && o.o) { TAG_STORE = o.m; TAG_STORE_ORDER = o.o.slice(0); }
      }
    } catch (e) { TAG_STORE = {}; TAG_STORE_ORDER = []; }
  }
  function tagStoreGet(u) {
    if (!u) return null;
    tagStoreInit();
    var k = tagStoreKey(u);
    return TAG_STORE[k] || null;
  }
  function tagStorePut(u, rec) {
    if (!u) return;
    tagStoreInit();
    var k = tagStoreKey(u);
    TAG_STORE[k] = rec;
    var i = TAG_STORE_ORDER.indexOf(k);
    if (i >= 0) TAG_STORE_ORDER.splice(i, 1);
    TAG_STORE_ORDER.push(k);
    while (TAG_STORE_ORDER.length > TAG_STORE_MAX) {
      var old = TAG_STORE_ORDER.shift();
      delete TAG_STORE[old];
    }
    tagStoreSave();
  }
  var _tagSaveAt = 0;
  function tagStoreSave() {
    var now = Date.now();
    if (now - _tagSaveAt < 800) return;      /* 连续渲染时别每次写盘 */
    _tagSaveAt = now;
    try {
      (window.localStorage || {}).setItem(TAG_STORE_KEY, JSON.stringify({ m: TAG_STORE, o: TAG_STORE_ORDER }));
    } catch (e) { /* 容量满了就算了，不影响功能 */ }
  }
  var LAST_POOL_KEYS = null, LAST_POOL_MODE = "", LAST_POOL_DROPPED = [];
  /* 20261113A：上一张池子实际画出来的列（期次 / 类目 / 站点）。
     体征卡与详细报告要按它对齐 —— 之前池子折叠了空周，报告却仍把空周算一列，
     于是出现「选 3 列、报告只 2 列」「报告比池多一列」这类不一致。 */
  var LAST_COLS = 0;         // 上一次真正画出来的列数（空类目 / 空周次会折叠，顶栏按实际列数显示）
  var LAST_COLS_MODE = "";
  var REP_OPEN = false;      /* 报告详情是否展开；默认收起，只给逐列画像 */
  var LAST_KEPT = 0;         // 上一次真正画进各列的张数合计（类目对比不含上一周基线）
  var SEL_SITES = [];        // h：多选；v：仅第一个生效
  var SEL_PERIODS = [];      // h：仅第一个生效；v：多选
  /* 20261104C：最近 N 周是「系统默认带入」的，不是用户勾的。
     用户第一次手点周次时以这次选择为准重新开始，否则会出现
     「我只选了 43、44，报告却多出一列 45」——45 是默认带的，从没被勾过。 */
  var PERIODS_AUTO = true;
  var CAT_MAX = 4;           // 类目对比最多四个类目（列数 = 勾选的类目数，不再单独选「几列」）
  var COLS = 3;              // 对比列数：纵向=最近几周、横向=前几个国家，可选 2/3/4（默认 3 = 美国近三周对比）
  var COLS_OPTS = [2, 3, 4];
  var COLS_MAX = 4;          // 列数硬上限（再多就看不清了）
  var DEFAULT_CAT = "卫衣";   // 默认进入时优先选中的类目
  var DEFAULT_SITE = "美国";  // 默认进入时优先选中的站点
  var SITE_ORDER = [];       // 站点顺序：有数据的优先，其余按后台定义顺序
  var GROUPS = [];           // 后台定义的地区分组：[{name, members:[站点名…]}]（如「欧洲」= 英国/德国/法国…）
  var HIDDEN = { sites: [], periods: [] };   // 后台控制前台显隐：这些国家站点 / 周次不在前台出现
  var SEL_GROUP = "";        // 选中的地区名；非空时按整个地区合并成一列，只能单选
  /* 20261113D：「全部站点」。
     以前纵向 / 类目对比只查「第一个站点」，其余站点的图既不出现在页面上，
     也没有任何提示 —— 于是「我导了 100 多张，这里只显示 18 张」变成了反复出现的问题：
     数据没丢，是另外几个站点根本没查。现在取数一律取全站点，视图再按所选站点过滤，
     想看全部就点「全部站点」（同一款在多国上榜只算一次）。 */
  var SITE_ALL = false;
  var SITE_ALL_KEY = "__all_sites__";
  var LAST_OFFSITE = 0;      // 当前期次里「属于其它站点、本次未显示」的张数
  var TAGS = ["all"];        // all | surge | hot | opportunity
  var SORT = "ratio_desc";   // ratio_desc / ratio_asc / abs_desc / abs_asc
  var MOVE = "off";          // off | move（位次上升最多） | new（新上榜优先）——仅纵向·时间对比有效
  var MOVE_SCOPE = "all";
  var ONLY = "off";          /* 只看标签：off | up（位次上升）| new（新上榜）——仅纵向·时间对比有效 */
  var TAGGED = "off";        /* 打标筛选：off（全部）| yes（只看已打标）| no（只看未打标）——任何模式都有效 */
  var EXPORT_ITEMS = [];     /* 当前屏幕上这批图（含位次标签），供「导出 PPT」范围说明使用 */

  /* 某期某张图的位次标签（与卡片上「上升 N 位 / 下降 N 位 / 新上榜」同源）：
     排序、卡片标签、「只看标签」筛选三处共用同一套计算，
     保证"筛出来的东西"和"图上显示的东西"永远一致，不会各算各的。 */
  /* 20261113E：跨期认同一张首图不能只看字符串完全相等。
     同一款在两次导出里常被加上 ?width= / _400x400 之类的后缀，
     原文一比就全认成「新图」→ 满屏「新上榜」。这里做无损归一（只用于比对，不改库里的地址）。 */
  function imgKey(u) {
    var t = String(u == null ? "" : u).trim();
    if (!t) return "";
    t = t.split("#")[0].split("?")[0];
    t = t.replace(/^https?:\/\//i, "");
    t = t.replace(/_\d+x\d+(?=\.|$)/i, "");        /* xxx_400x400.jpg */
    t = t.replace(/(@|!)\d+[wx]\d*$/i, "");          /* xxx.jpg@400w */
    t = t.replace(/(\.(?:jpe?g|png|webp|gif))_\d+$/i, "$1");
    return t.toLowerCase();
  }
  /* 20261113E：位次对比的前提必须先成立 —— 上一期在该类目/站点下有没有数据，
     与「上一期有没有这一款」是两件事。前者不成立时把每张图都写成「新上榜」是错的。 */
  function moveOf(it, p, prev, hasOf, rankOf, prevEmpty) {
    if (!prev) return { move: "", isNew: false, diff: 0, prevEmpty: false };
    if (prevEmpty) return { move: "", isNew: false, diff: 0, prevEmpty: true };
    if (!hasOf[prev] || !hasOf[prev][imgKey(it.image_url)]) return { move: "新上榜", isNew: true, diff: 0, prevEmpty: false };
    var pr = (rankOf[prev] || {})[imgKey(it.image_url)];
    var cr = (rankOf[p] || {})[imgKey(it.image_url)];
    if (pr != null && cr != null) {
      var d = pr - cr;
      if (d > 0) return { move: "上升 " + d + " 位", isNew: false, diff: d, prevEmpty: false };
      if (d < 0) return { move: "下降 " + (-d) + " 位", isNew: false, diff: d, prevEmpty: false };
    }
    return { move: "", isNew: false, diff: 0, prevEmpty: false };
  }
  function onlyLabel() {
    if (ONLY === "up") return "只看位次上升";
    if (ONLY === "new") return "只看新上榜";
    if (ONLY === "rup") return "只看环比上升";
    if (ONLY === "rdown") return "只看环比下降";
    return "";
  }
  /* 20261113E：无可比位次时，至少给出「环比上升 / 环比下降」方向（只给方向、不给数值） */
  function ratioMove(it) {
    var r = (it && it.ratio);
    if (r == null || isNaN(r) || Number(r) === 0) return "";
    return Number(r) > 0 ? "环比上升" : "环比下降";
  }
  function moveText(mv, it) {
    var m = (mv && mv.move) || "";
    var r = ratioMove(it);
    if (!m) return r;
    if (m === "新上榜") return r ? ("新上榜 · " + r) : m;
    return m;
  }
  function colMetaNote(prev, prevEmpty, st) {
    var rTxt = (st.rup + st.rdn) ? ("环比上升 " + st.rup + " / 下降 " + st.rdn + " 张") : "本批数据未带环比列";
    if (!prev) return " · 首期（无上一周）· " + rTxt;
    if (prevEmpty) return " · 上一周（" + prev + "）该类目/站点没有数据，无法比对位次 · " + rTxt;
    return " · 较上一周（" + prev + "）：新上榜 " + st.ne + " 张"
      + ((st.up || st.down) ? ("，位次上升 " + st.up + " / 下降 " + st.down) : "")
      + " · " + rTxt;
  }
  /* 「只看标签」命中判定：与卡片标签文案同源 */
  function hitOnly(mv, it) {
    if (ONLY === "off") return true;
    if (ONLY === "rup") return ratioMove(it) === "环比上升";
    if (ONLY === "rdown") return ratioMove(it) === "环比下降";
    var s = (mv && mv.move) || "";
    if (ONLY === "new") return s === "新上榜";
    return s.indexOf("上升") === 0;                 /* 位次上升（含「上升 N 位」） */
  }
  /* 这张图有没有打标数据（8 个必填维度任一非空）。用 TAG_INDEX，与大图标签面板同源。
     20261027T：原来只查 6 个维度，只打了「文化背景 / 消费心理」的图会被当成
     未打标 —— 覆盖率不算它、"只看已打标"也筛不出它，等于白打。
     节日是可选维度，不代表"打过标"，故不计入。 */
  function hasTagData(it) {
    var u = String((it && it.image_url) || "");
    var t = TAG_INDEX[u] || TAG_INDEX[u.split("?")[0].split("#")[0]];
    if (!t) return false;
    return ["style_tags", "visual_tags", "element_tags", "craft_tags", "shoot_tags", "fit_tags",
            "culture_tags", "psych_tags"]
      .some(function (k) { return tagArr(t[k]).length > 0; });
  }
  function hitTagged(it) {
    return TAGGED === "off" ? true : (hasTagData(it) === (TAGGED === "yes"));
  }
  /* 打标覆盖率：用户不想一张张悬停去数，这里直接给出「本视图共几张、几张有标」 */
  function coverageOf() {
    /* 分母跟展示口径一致：印花款开关关闭时，被隐藏的款不计入「共 N 张图」 */
    var items = ((CACHE && CACHE.items) || []).filter(printOk);
    var total = items.length, has = 0;
    items.forEach(function (it) { if (hasTagData(it)) has++; });
    return { total: total, has: has, pct: total ? Math.round(has / total * 100) : 0 };
  }

  /* 导出图片 / PPT 时写进文件名与封面的范围文字 */
  function exportScope() {
    var parts = [MODE === "c" ? ("类目 " + (activeCats().join(" / ") || "未选")) : (CAT || "全部类目")];
    var _g = activeGroup();
    parts.push(_g ? ("地区 " + _g.name) : (sitesForQuery().join("/") || "未选国家"));
    parts.push(activePeriods().join("、") || "未选周次");
    if (MODE === "v" && ONLY !== "off") parts.push(onlyLabel());
    return parts.join(" · ");
  }

  /* 把当前屏幕上的对比池「定格」成一份绘制指令（供整页高清图使用）。
     采集顺序 = 底色/边框 → 图片 → 文字，与网页的视觉层次一致；
     位置取相对对比池容器的坐标，滚动到哪里都不影响结果。 */
  function snapshotOps() {
    var root = document.querySelector("#rk-pools");
    if (!root) return null;
    var r0 = root.getBoundingClientRect();
    var baseX = r0.left - (root.scrollLeft || 0);
    var baseY = r0.top - (root.scrollTop || 0);
    var boxes = [], imgs = [], texts = [];

    function rectOf(el) {
      var r = el.getBoundingClientRect();
      if (!(r.width >= 1) || !(r.height >= 1)) return null;
      return { x: Math.round(r.left - baseX), y: Math.round(r.top - baseY), w: Math.round(r.width), h: Math.round(r.height) };
    }
    function shown(el) {
      var cs = window.getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity || 1) > 0.05;
    }

    Array.prototype.forEach.call(root.querySelectorAll("*"), function (el) {
      if (!shown(el)) return;
      var tag = (el.tagName || "").toLowerCase();
      var rr = rectOf(el);
      if (!rr) return;
      if (tag === "img") {
        var src = el.getAttribute("src");
        if (src) imgs.push({ k: "img", x: rr.x, y: rr.y, w: rr.w, h: rr.h, url: src, radius: 8 });
        return;
      }
      var cs = window.getComputedStyle(el);
      var bg = cs.backgroundColor || "";
      var lw = parseFloat(cs.borderTopWidth) || 0;
      var hasBg = bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)";
      if (hasBg || lw > 0) {
        boxes.push({ k: "box", x: rr.x, y: rr.y, w: rr.w, h: rr.h,
          fill: hasBg ? bg : "", stroke: lw > 0 ? cs.borderTopColor : "", lw: lw,
          radius: parseFloat(cs.borderTopLeftRadius) || 0 });
      }
      /* 只画叶子节点的文字，避免父节点把同一句重复画一遍。
         同时记下「这行文字在网页上是不是单行显示」：单行短标签（周次、计数、位次）在导出时
         必须整段完整绘制，不能被折行后截断（曾出现 W42 → W4 的丢字）。 */
      var txt = (el.textContent || "").trim();
      if (txt && (!el.children || !el.children.length)) {
        var fs = parseFloat(cs.fontSize) || 12;
        var lh = parseFloat(cs.lineHeight) || fs * 1.4;
        var oneLine = (rr.h <= lh * 1.6);
        texts.push({ k: "text", x: rr.x, y: rr.y, w: rr.w, h: rr.h, text: txt,
          size: fs, weight: cs.fontWeight, color: cs.color,
          nowrap: oneLine && txt.length <= 16 });   /* 短的单行标签：整段画，宁可缩字号也不丢字 */
      }
    });

    return {
      root: { w: Math.round(root.scrollWidth || r0.width), h: Math.round(root.scrollHeight || r0.height) },
      ops: boxes.concat(imgs, texts)
    };
  }    // all = 全部期次都按位次重排；或某个具体期次（只重排该列）
  var SIZE = "m";            // s | m | l
  var CAP = CAP_STEP;
  var CACHE = null;
  /* 20261103F：以前 CACHE 只存一个组合，切一次类目就整批重新请求，
     来回切「卫衣 → 工装裤 → 卫衣」要把同一批数据拉两遍，图也要重新解码。
     改成按组合键缓存最近 8 组，切回来直接命中，不再等网络。 */
  /* 20261104F：缓存从 8 组放宽到 24 组。
     后台预取会给每个类目各存一组，8 组装不下 12 个类目，切回来又得重新查。 */
  var CACHE_MAP = {}, CACHE_ORDER = [], CACHE_MAX = 24;

  /* 榜单渲染真正要用的列（白名单）。
     导出 / 后台那些页面要 flag_* 等列，仍走全量；这里只给榜单页提速，不动别人的口径。 */
  var REL_COLS = "id,image_url,site,period_label,period_type,category,leaf_category,title,ratio,abs_delta,rank_abs";
  /* 取数失败原因（null = 正常）。只用来区分「空数据」和「加载失败」，不展示原始报错。 */
  var LOAD_ERR = null;
  function cacheGet(key) {
    var c = CACHE_MAP[key];
    if (!c) return null;
    /* 命中就提到最新，避免被淘汰 */
    var i = CACHE_ORDER.indexOf(key);
    if (i >= 0) CACHE_ORDER.splice(i, 1);
    CACHE_ORDER.push(key);
    return c;
  }
  function cachePut(key, items) {
    CACHE_MAP[key] = { key: key, items: items };
    var i = CACHE_ORDER.indexOf(key);
    if (i >= 0) CACHE_ORDER.splice(i, 1);
    CACHE_ORDER.push(key);
    while (CACHE_ORDER.length > CACHE_MAX) {
      var old = CACHE_ORDER.shift();
      delete CACHE_MAP[old];
    }
    return CACHE_MAP[key];
  }          // { key, items }
  var ITEMS_BY_URL = {};     // 灯箱用：url → 条目

  /* ---------------- 期次排序 ---------------- */
  function periodKey(p) {
    var s = String(p || "").trim();
    var ym = s.match(/(20\d{2})/);
    var year = ym ? parseInt(ym[1], 10) : 0;
    var m;
    /* 1) 明确日期 2026-10-14 */
    m = s.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return parseInt(m[1], 10) * 10000 + 300 + parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
    /* 2) 周次：W41 / w41 / 41周 / 第41周 / 2026-W41 */
    m = s.match(/[Ww]\s*(\d{1,2})/) || s.match(/第?\s*(\d{1,2})\s*周/);
    if (m) return year * 10000 + 100 + parseInt(m[1], 10);
    /* 3) 月份：2026-09 / 2026年9月 / 9月 */
    m = s.match(/(20\d{2})\D{0,3}(\d{1,2})\s*月?$/) || s.match(/^(\d{1,2})\s*月$/);
    if (m) return year * 10000 + 200 + parseInt(m[m.length - 1], 10);
    /* 4) 纯数字当周次 */
    m = s.match(/^(\d{1,3})$/);
    if (m) return year * 10000 + 100 + parseInt(m[1], 10);
    return 990000 + (s.charCodeAt(0) || 0);
  }
  function sortPeriods(arr) { return arr.slice().sort(function (a, b) { return periodKey(a) - periodKey(b); }); }

  /* 数据时间轴里排在某一期次前面的那一期（不受当前勾选影响；纵向对比永远比"上一周"） */
  function prevOfPeriod(p) {
    var all = sortPeriods(FACETS.periods);
    var i = all.indexOf(p);
    return i > 0 ? all[i - 1] : null;
  }
  function withBasePeriods(periods) {
    var need = periods.slice();
    periods.forEach(function (p) {
      var q = prevOfPeriod(p);
      if (q && need.indexOf(q) < 0) need.push(q);
    });
    return need;
  }

  /* ---------------- 三档标签（A 口径：类目+站点+期次 各自一池） ---------------- */
  function flagPools(items) {
    var pools = {};
    items.forEach(function (it) {
      var k = (it.category || "") + "\u0001" + (it.site || "") + "\u0001" + (it.period_label || "");
      (pools[k] = pools[k] || []).push(it);
    });
    Object.keys(pools).forEach(function (k) {
      var pool = pools[k];
      pool.forEach(function (r) { r._opp = false; r._hot = false; r._surge = false; });
      var byRatio = pool.filter(function (r) { return r.ratio != null; })
        .sort(function (a, b) { return b.ratio - a.ratio; });
      byRatio.forEach(function (r, i) { r._rk = i + 1; });
      var byAbs = pool.filter(function (r) { return r.abs_delta != null; })
        .sort(function (a, b) { return b.abs_delta - a.abs_delta; });
      byAbs.forEach(function (r, i) { r._ak = i + 1; });
      pool.forEach(function (r) { r._opp = (r.ratio != null && r.ratio > 0); });
      byAbs.filter(function (r) { return r.abs_delta > 0; }).slice(0, 20).forEach(function (r) { r._hot = true; });
      var dual = byRatio.filter(function (r) { return r.ratio > 0 && r.abs_delta != null && r.abs_delta > 0; });
      var n = dual.length ? Math.max(1, Math.round(dual.length * 0.2)) : 0;
      dual.slice(0, n).forEach(function (r) { r._surge = true; });
    });
    return items;
  }

  /* ---------- 图案印花款判定（20261103A） ----------
     先把「章仔 / 织唛 / 印花标」这类辅料牌剔出去：它们的名字里带「印花」，但那是印在标上的字，
     不是衣服上的印花图案 —— 之前会被误判成印花款一起隐藏。 */
  var PATCH_LABEL_RE = /章仔|织唛|烫标|印花标|皮标|绣标|刺绣贴|肩章|臂章|商标|吊牌|洗标|尺码标|挂牌|标识牌/;
  function isPatchLabel(v) { return PATCH_LABEL_RE.test(String(v || "")); }

  /* 图案类型 / 图案元素里的印花类取值（满印、定位印花、局部印花、热带印花…） */
  function patternIsPrint(v) {
    var x = String(v || "");
    if (!x || isPatchLabel(x)) return false;
    return /印花|满印|局部印|定位印|数码印|丝印|胶印|喷绘|喷墨|烫画|烫图|热转印|转移印|升华/.test(x);
  }

  /* 20261103C：只认「印花」三个字会大量漏判。
     实际情况是：字母 / 文字标语 / 卡通人物 这类图案，打标时写在「图案元素」里，不写"印花"；
     几何图案 / 格纹 / 迷彩 / 大花 写在「图案类型」里，也不写"印花"。
     这些都是有图案的款，按旧口径全被判成"没印花"，于是开关关了也还留在前台。
     现在改成按「有没有图案」判：
       · 图案类型：除了「纯色/无图案」和纯配色类（拼色、撞色、双色拼接、色块拼接），都算有图案
       · 图案元素：只要有实质内容就算有图案
       · 明写印花的（满印 / 定位印花 / 热带印花…）仍然优先命中
       · 结构件（拉链、荷叶边…）不是图案，单独排除 */
  var NO_PATTERN_VALS = ["纯色/无图案", "纯色", "无图案", "无", "none", "-"];
  var COLOR_BLOCK_VALS = ["拼色", "撞色", "双色拼接", "色块拼接"];
  var STRUCT_VALS = ["拉链", "抽绳", "口袋", "工装口袋", "贴袋", "口袋盖", "荷叶边", "蕾丝", "镂空",
    "绑带", "开衩", "翻边", "双层", "腰带", "金属扣件", "织带", "肩章", "臂章", "反光条", "褶皱"];

  function graphicVal(v) {
    var x = String(v || "").trim();
    if (!x || isPatchLabel(x)) return false;
    if (NO_PATTERN_VALS.indexOf(x) >= 0) return false;
    if (COLOR_BLOCK_VALS.indexOf(x) >= 0) return false;
    if (STRUCT_VALS.indexOf(x) >= 0) return false;
    return true;
  }
  /* 图案类型里「有图案」：纯色 / 纯配色 之外的取值 */
  function patternTypeIsPattern(v) { return graphicVal(v); }
  /* 图案元素里「有内容」：写了具体图案内容 */
  function elementHasGraphic(v) { return graphicVal(v); }

  /* 一张图是不是「有图案（印花）款」：
     图案类型有图案 / 图案元素有内容 / 二次工艺是图案复制类，任一处命中即算。
     标签还没取到的图一律不隐藏 —— 宁可不藏，也不要把没数据的款误伤掉。 */
  function itemIsPrint(it) {
    var u = String((it && it.image_url) || "");
    if (!u) return false;
    var t = TAG_INDEX[u] || TAG_INDEX[u.split("?")[0].split("#")[0]];
    if (!t) return false;
    var P = tagArr(t.pattern_tags), E = tagArr(t.element_tags), C = tagArr(t.craft_tags);
    if (P.some(patternIsPrint) || E.some(patternIsPrint)) return true;
    if (P.some(patternTypeIsPattern)) return true;
    if (E.some(elementHasGraphic)) return true;
    return C.some(function (v) { return !isPatchLabel(v) && craftIsPrint(v); });
  }
  function printOk(it) { return !PRINT_HIDE || !itemIsPrint(it); }

  function hitTagsRaw(it) {
    if (!TAGS.length || TAGS.indexOf("all") >= 0) return true;
    if (TAGS.indexOf("surge") >= 0 && it._surge) return true;
    if (TAGS.indexOf("hot") >= 0 && it._hot) return true;
    if (TAGS.indexOf("opportunity") >= 0 && it._opp) return true;
    return false;
  }
  /* 榜单 / 统计 / 报告统一走这一个入口：印花款开关在这里生效 */
  function hitTags(it) { return hitTagsRaw(it) && printOk(it); }
  /* 被开关挡掉的张数（用于页面上说明「隐藏了几个款」） */
  function hiddenPrintCount(items) {
    if (!PRINT_HIDE) return 0;
    return (items || []).filter(function (it) { return hitTagsRaw(it) && !printOk(it); }).length;
  }

  function sortItems(arr) {
    var a = arr.slice();
    if (SORT === "ratio_desc") a.sort(function (x, y) { return (y.ratio == null ? -Infinity : y.ratio) - (x.ratio == null ? -Infinity : x.ratio); });
    else if (SORT === "ratio_asc") a.sort(function (x, y) { return (x.ratio == null ? Infinity : x.ratio) - (y.ratio == null ? Infinity : y.ratio); });
    else if (SORT === "abs_desc") a.sort(function (x, y) { return (y.abs_delta == null ? -Infinity : y.abs_delta) - (x.abs_delta == null ? -Infinity : x.abs_delta); });
    else a.sort(function (x, y) { return (x.abs_delta == null ? Infinity : x.abs_delta) - (y.abs_delta == null ? Infinity : y.abs_delta); });
    return a;
  }

  function badgeOf(it) {
    if (it._surge) return { cls: "flag-surge", txt: "周度激增" };
    if (it._hot) return { cls: "flag-hot", txt: "趋势爆款" };
    if (it._opp) return { cls: "flag-opportunity", txt: "潜力机会" };
    return null;
  }

  /* ---------------- 轻提示 ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ---------------- 取数 ---------------- */
  function activeSites() { return MODE === "h" ? SEL_SITES.slice() : SEL_SITES.slice(0, 1); }

  /* 类目对比要并排的几个类目：至少 2 个才有意义，最多 4 个（再多就看不清了）。
     用户没手动选就把「当前类目」放第一，其余按后台类目顺序补足。 */
  function activeCats() {
    var list = (SEL_CATS || []).filter(function (c) { return c && c !== ALL; });
    if (list.length) return list.slice(0, CAT_MAX);
    var pool = FACETS.categories || [];
    var out = (CAT && CAT !== ALL) ? [CAT] : (pool[0] ? [pool[0]] : []);
    for (var i = 0; i < pool.length && out.length < 2; i++) if (out.indexOf(pool[i]) < 0) out.push(pool[i]);
    return out.slice(0, CAT_MAX);
  }

  /* ---------------- 地区分组：把多个国家并成一列 ----------------
     后台把「英国 / 德国 / 法国…」放进「欧洲」这个地区后：
     选中国 → 多国数据合并成「欧洲」一列（同一张图在多国都上榜时只留一条）；
     不选地区 → 仍可按单个国家对比（两种方式随你切）。 */
  function activeGroup() {
    if (!SEL_GROUP) return null;
    if (MODE === "v") { /* 纵向也要能用：单列显示该地区 */ }
    var g = GROUPS.filter(function (x) { return x.name === SEL_GROUP; })[0];
    if (!g) return null;
    var mem = (g.members || []).filter(function (m) { return FACETS.sites.indexOf(m) >= 0; });
    return { name: g.name, members: mem };
  }
  /* 去数据库取数时用的站点清单：选了地区 → 该地区的所有国家 */
  function sitesForQuery() {
    var g = activeGroup();
    if (g) return g.members.slice();
    return activeSites();
  }
  /* 取数范围（20261113D）：纵向 / 类目对比一次把「该类目该期次的全部站点」都取回来，
     而不是只取一个站点。只取一个站点时，页面上那句「共 18 张」会被当成数据缺失，
     实际是另外几个站点的图根本没查；取全站点后再按所选站点过滤，切站点也不必再发请求。
     返回 null = 不加站点条件。 */
  function fetchSites() {
    var g = activeGroup();
    if (g) return g.members.slice();
    if (MODE === "h") return SEL_SITES.slice();
    return null;
  }
  /* 当前视图要显示哪些站点的图：null = 全部站点（合并成一列） */
  function viewSites() {
    var g = activeGroup();
    if (g) return [g.name];            /* 地区已按地区名合并成一条，按地区名过滤 */
    if (SITE_ALL) return null;
    var s = activeSites();
    return s.length ? s : null;
  }
  function pLabel(v) {
    return (typeof normPeriodLabel === "function") ? normPeriodLabel(v) : String(v == null ? "" : v).trim();
  }
  /* 同一张图在多个站点都上榜 → 只算一条（取环比更强的那个），
     否则「全部站点」会把 1 个款显示成 4 张，「共 N 张」也跟着虚高。 */
  function uniqByUrl(list) {
    var by = {}, order = [];
    (list || []).forEach(function (it) {
      var u = String((it && it.image_url) || "");
      if (!u) { order.push(it); return; }
      var prev = by[u];
      if (!prev) { by[u] = it; order.push(it); return; }
      var a = prev.ratio == null ? -Infinity : prev.ratio;
      var b = it.ratio == null ? -Infinity : it.ratio;
      if (b > a) {
        var i = order.indexOf(prev);
        if (i >= 0) order[i] = it;
        by[u] = it;
      }
    });
    return order;
  }
  function siteCountText(list) {
    var m = {};
    (list || []).forEach(function (it) {
      var s = String(it.site || "");
      if (!s) return;
      m[s] = (m[s] || 0) + 1;
    });
    var keys = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
    return keys.map(function (k) { return k + " " + m[k]; }).join(" / ");
  }
  /* 对比池的列名：选了地区 → 一列「欧洲」 */
  function poolSites() {
    var g = activeGroup();
    return g ? [g.name] : activeSites();
  }
  /* 把地区内多国的同名商品合并成一条（取环比更强的那个） */
  function mergeGroupItems(items, g) {
    var byKey = {};
    (items || []).forEach(function (it) {
      if (g.members.indexOf(it.site) < 0) return;
      var k = it.image_url || ((it.leaf_category || "") + "\u0001" + (it.title || "") + "\u0001" + (it.period_label || ""));
      var prev = byKey[k];
      it.site = g.name;
      if (!prev) { byKey[k] = it; return; }
      var a = prev.ratio, b = it.ratio;
      var better;
      if (b != null && a == null) better = true;
      else if (b != null && a != null) better = b > a;
      else if (b == null && a == null) better = Number(it.abs_delta || 0) > Number(prev.abs_delta || 0);
      else better = false;
      if (better) byKey[k] = it;
    });
    return Object.keys(byKey).map(function (k) { return byKey[k]; });
  }
  function activePeriods() {
    /* 只有纵向·时间对比才允许多周；横向（国家 / 类目）都固定单周，否则列会成倍膨胀 */
    if (MODE !== "v") { var sp = sortPeriods(SEL_PERIODS); return sp.length ? [sp[sp.length - 1]] : []; }
    return sortPeriods(SEL_PERIODS);
  }

  /* 周次勾选（菜单点击与离屏测试共用一份逻辑，避免两处口径不一致） */
  function togglePeriodPick(v) {
    if (MODE !== "v") { SEL_PERIODS = [v]; PERIODS_AUTO = false; return { ok: true }; }
    if (PERIODS_AUTO) {
      /* 第一次手选：默认带入的那几周全部丢掉，只留这一次点的。
         默认带入的周次本来就亮着，若按"再点一次=取消"处理，用户点 43、44
         会变成取消 43、44，45 反而留着 —— 就是"我明明选了 43、44，
         报告却多出一列 45"的由来。所以首次点击一律视为重新开始。 */
      SEL_PERIODS = [v]; PERIODS_AUTO = false;
    } else {
      var i = SEL_PERIODS.indexOf(v);
      if (i >= 0) SEL_PERIODS.splice(i, 1);
      else {
        if (SEL_PERIODS.length >= COLS_MAX) return { ok: false, msg: "最多同时对比 " + COLS_MAX + " 列，可先取消一个期次" };
        SEL_PERIODS.push(v);
      }
    }
    SEL_PERIODS = sortPeriods(SEL_PERIODS);
    COLS = Math.max(2, Math.min(COLS_MAX, SEL_PERIODS.length || 2));
    return { ok: true };
  }

  /* 当前组合的缓存键（取数与「是否要显示加载中」都用它，避免两处口径不一致） */
  function itemsKey(catOverride) {
    var sites = fetchSites();
    var periods = activePeriods();
    var cats = MODE === "c" ? activeCats() : [];
    var cat = (catOverride === undefined ? CAT : catOverride);
    /* 缓存键用「取数范围」而不是「显示范围」：纵向 / 类目对比不看站点取数，
       所以在站点之间切换时直接命中同一份缓存，秒出图，也不会重复请求。 */
    return [cat, MODE, SEL_GROUP || "", (sites ? sites.join("|") : "*"), periods.join("|"), cats.join("|")].join("\u00a7");
  }

  /* 报告/类目对比需要的"基线周"：纵向与类目对比都要多取上一周做对比 */
  function needPeriodsFor(periods) {
    return (MODE === "v" || MODE === "c") ? withBasePeriods(periods) : periods;
  }

  /* 条目归一：ratio / abs_delta 必须是数字，否则排序与阈值判断会按字符串比较 */
  /* 站点名归一（20261113D）：
     库里同一国家可能是「美国」「美国站」「US」「美国-全托管」…
     而前台站点菜单只认后台维护的那个名字，字符串对不上就等于这条数据不存在
     （页面显示「暂无榜单数据」，其实是数据在库里、只是名字不一样）。
     这里把每条的站点统一成菜单里的那个名字；菜单里没有的写法原样保留，
     并会在下面并进站点清单，保证它仍然能被看到、可以被选中。 */
  function siteCanon(v) {
    var raw = String(v == null ? "" : v).trim();
    if (!raw) return raw;
    if (typeof window !== "undefined" && window.SiteNorm) {
      return window.SiteNorm.resolve(raw, FACETS.sites || []);
    }
    return raw;
  }
  /* 站点比对键：不管写成「美国」「美国站」还是「US」，都算同一个国家 */
  function siteKey(v) {
    if (typeof window !== "undefined" && window.SiteNorm) return window.SiteNorm.key(v);
    return String(v == null ? "" : v).trim();
  }
  function normItems(rows) {
    return (rows || []).map(function (it) {
      it.ratio = (it.ratio == null ? null : Number(it.ratio));
      it.abs_delta = (it.abs_delta == null ? null : Number(it.abs_delta));
      if (it.site != null) it.site = siteCanon(it.site);
      return it;
    });
  }

  /* 20261104F：类目预取。
     切类目慢的根因不是渲染，是"每切一次就现查一遍库"：
     请求要走分页（每页 1000 行、串行翻页）、还要拉回几十列，
     冷类目一次就是几百毫秒到一两秒。
     首屏画完之后在后台把同级类目按顺序各取一次（并发 1、最多 10 个，不抢首屏带宽），
     之后切类目直接命中缓存 —— 不发请求、不闪"加载中"、立即出图。 */
  var CAT_PF_ON = false, CAT_PF_SEEN = {};
  function prefetchCategories() {
    if (CAT_PF_ON) return;
    if (!SBX || typeof SBX.listRankItems !== "function") return;
    if (MODE === "c") return;        /* 类目对比一次就取多个类目，不用逐个补 */
    var list = (FACETS.categories || []).filter(function (c) { return c && c !== ALL; });
    if (list.length < 2) return;
    CAT_PF_ON = true;
    var i = 0, took = 0;
    var next = function () {
      if (i >= list.length || took >= 10) { CAT_PF_ON = false; return; }
      var c = list[i++];
      if (c === CAT) { setTimeout(next, 0); return; }
      var key = itemsKey(c);
      if (CAT_PF_SEEN[key] || CACHE_MAP[key] || (CACHE && CACHE.key === key)) { setTimeout(next, 0); return; }
      CAT_PF_SEEN[key] = 1;
      var periods = activePeriods();
      if (!periods.length) { CAT_PF_ON = false; return; }
      var filter = { sites: (function () { var fs = fetchSites(); return (fs && fs.length) ? fs : undefined; })(), periods: needPeriodsFor(periods), category: c, cols: REL_COLS, source: "rank" };
      Promise.resolve()
        .then(function () { return SBX.listRankItems(filter); })
        .then(function (rows) {
          var items = normItems(rows);
          var g = activeGroup();
          if (g) items = mergeGroupItems(items, g);
          flagPools(items);
          cachePut(key, items);
          took++;
        })
        .catch(function () { /* 预取失败无所谓：真切过去时 fetchItems 会正常再取一次 */ })
        .then(function () { setTimeout(next, 120); });
    };
    setTimeout(next, 600);           /* 先让首屏画完，再开始占带宽 */
  }

  async function fetchItems() {
    var sites = fetchSites();                 /* null = 全部站点（纵向 / 类目对比） */
    var periods = activePeriods();
    if (!periods.length) return [];
    if (MODE === "h" && (!sites || !sites.length)) return [];
    var cats = MODE === "c" ? activeCats() : [];
    if (MODE === "c" && !cats.length) return [];
    /* 缓存键必须带上类目数组：否则从「卫衣×毛衣」切到「卫衣×外套」会拿到上一次的图 */
    var key = itemsKey();
    if (CACHE && CACHE.key === key) return CACHE.items;
    var _hit = cacheGet(key);
    if (_hit) { CACHE = _hit; if (TAG_ALL_STATE === 0) prefetchAllTags(); return _hit.items; }

    /* 纵向 / 类目对比都要拿到「上一周」的数据做基线，一并取回但不单独成列 */
    var needPeriods = needPeriodsFor(periods);
    /* 20261113B：只读「趋势上升榜」这一域的数据，不再与上新节奏 / 标题组词台混读 */
    var filter = { sites: (sites && sites.length) ? sites : undefined, periods: needPeriods, cols: REL_COLS, source: "rank" };
    if (MODE === "c") {
      var _exp = [];
      cats.forEach(function (c) { _exp = _exp.concat(catsOf(c)); });
      filter.categories = _exp;
    }
    else if (CAT && CAT !== ALL) filter.categories = catsOf(CAT);
    else if (FACETS.categories.length) filter.categories = RAW_CATS.slice();

    var items = [];
    /* 20261104G：取数失败不能静默变成「暂无数据」——那会让人以为数据被删了。
       这里记下失败，渲染时明确提示"加载失败 + 可刷新重试"。 */
    try { items = await SBX.listRankItems(filter); LOAD_ERR = null; }
    catch (e) { items = []; LOAD_ERR = String((e && e.message) || e || "load failed"); }
    items = normItems(items);
    var _g = activeGroup();
    if (_g) items = mergeGroupItems(items, _g);   // 地区模式：多国合并成一列，同名商品只留最强的那个
    flagPools(items);
    ITEMS_BY_URL = {};
    items.forEach(function (it) { if (it.image_url) ITEMS_BY_URL[it.image_url] = it; });
    CACHE = cachePut(key, items);
    /* 20261103I：换了批次就把"最多等多久"重新计时，避免上一批的计时把这一批也一起放行；
       同时把整表预取拉起来（只会在第一次真正触发，之后直接返回）。 */
    TAG_GATE_AT = 0;
    if (TAG_ALL_STATE === 0) prefetchAllTags();
    return items;
  }

  /* ---------------- 类目菜单（同视觉专区） ---------------- */
  /* ---------------- 默认口径与「对比列数」 ---------------- */
  /* 命中优先（默认类目「卫衣」/ 默认站点「美国」），命中不到退回兜底值 */
  function pickDefault(list, want, fallback) {
    list = list || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i]).indexOf(want) >= 0) return list[i];
    }
    return fallback;
  }

  function orderedSites() {
    return (SITE_ORDER && SITE_ORDER.length) ? SITE_ORDER : (FACETS.sites || []);
  }

  /* ---------------- 后台可控的前台显隐 + 单选归一化 ---------------- */
  function siteVisible(s) { return (HIDDEN.sites || []).indexOf(s) < 0; }
  function periodVisible(p) {
    /* 后台隐藏列表里可能存的是 W45，这里的 p 已经归一成「第45周」，两边都归一后再比 */
    var np = (typeof normPeriodLabel === "function") ? normPeriodLabel(p) : p;
    var list = (HIDDEN.periods || []).map(function (x) {
      return (typeof normPeriodLabel === "function") ? normPeriodLabel(x) : x;
    });
    return list.indexOf(np) < 0;
  }
  /* 把后台隐藏的国家站点 / 周次从筛选项、地区分组、当前选择里统一摘掉 */
  function applyHiddenFilter() {
    var before = (SEL_SITES || []).length + "|" + (SEL_PERIODS || []).length;
    FACETS.sites = (FACETS.sites || []).filter(siteVisible);
    FACETS.periods = sortPeriods((FACETS.periods || []).filter(periodVisible));
    SITE_ORDER = (SITE_ORDER || []).filter(siteVisible);
    GROUPS = (GROUPS || []).map(function (g) {
      return { name: g.name, members: (g.members || []).filter(siteVisible) };
    }).filter(function (g) { return g && g.name && g.members.length; });
    if (SEL_GROUP && !GROUPS.some(function (g) { return g.name === SEL_GROUP; })) SEL_GROUP = "";
    SEL_SITES = (SEL_SITES || []).filter(siteVisible);
    SEL_PERIODS = (SEL_PERIODS || []).filter(periodVisible);
    SEL_CATS = (SEL_CATS || []).filter(function (c) { return (FACETS.categories || []).indexOf(c) >= 0; });
    normalizeSingle();
    return before;
  }
  /* 横向对比 = 单选一周（国家可比）；纵向对比 = 单选一国（周次可比）；另一维度才是多列对比 */
  function normalizeSingle() {
    if (MODE !== "v" && MODE !== "c") SITE_ALL = false;   /* 横向·国家对比本来就是一列一个国家，不需要「全部站点」 */
    if (MODE === "v") {
      if (SEL_SITES.length > 1) SEL_SITES = [SEL_SITES[0]];
    } else if (MODE === "c") {
      /* 类目对比：国家与周次都单选，只有类目是多列 */
      if (SEL_SITES.length > 1) SEL_SITES = [SEL_SITES[0]];
      if (SEL_PERIODS.length > 1) SEL_PERIODS = [SEL_PERIODS[SEL_PERIODS.length - 1]];
      if (!SEL_CATS.length) SEL_CATS = pickCats(2);      /* 一个都没选时才兜底两个 */
      SEL_CATS = SEL_CATS.slice(0, CAT_MAX);
    } else {
      if (SEL_PERIODS.length > 1) SEL_PERIODS = [SEL_PERIODS[SEL_PERIODS.length - 1]];
      /* 位次标签只存在于「纵向·时间对比」（与上一周比），横向没有可比基线 →
         切到横向时自动回到「全部」，避免出现"界面高亮只看上升、实际没筛"的错位 */
      ONLY = "off";
    }
  }

  /* 类目对比的默认选中：当前类目排第一，其余按后台类目顺序补足到 N 个 */
  function pickCats(n) {
    n = Math.max(1, Math.min(CAT_MAX, n || 2));
    var pool = (FACETS.categories || []).filter(function (c) { return c && c !== ALL; });
    var keep = (SEL_CATS || []).filter(function (c) { return pool.indexOf(c) >= 0; });
    if (CAT && CAT !== ALL && pool.indexOf(CAT) >= 0 && keep.indexOf(CAT) < 0) keep.unshift(CAT);
    var out = keep.slice(0, n);
    for (var i = 0; i < pool.length && out.length < n; i++) if (out.indexOf(pool[i]) < 0) out.push(pool[i]);
    return out;
  }

  /* 按「对比列数」重排选择：纵向=最近 N 周（保留当前站点）；横向=前 N 个国家（保留最新一周） */
  /* 报告详情展开/收起：按钮文案、箭头、aria 与各详情块同步 */
  function syncRepDetail(box) {
    box = box || $("#rk-body");
    if (!box) return;
    if (REP_OPEN) fillRepDetail(box);
    var dets = box.querySelectorAll("[data-rep-detail]");
    Array.prototype.forEach.call(dets, function (d) {
      if (REP_OPEN) d.removeAttribute("hidden"); else d.setAttribute("hidden", "");
      /* 图表动画用「暂停/播放」控制：展开时才播放，收起后保持终态不重跑 */
      if (REP_OPEN) d.classList.add("in"); else d.classList.remove("in");
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-rep-toggle]"), function (b) {
      b.setAttribute("aria-expanded", REP_OPEN ? "true" : "false");
      b.className = "rk-rep-open" + (REP_OPEN ? " open" : "");
      var ico = b.querySelector(".rk-rep-open-ico");
      var txt = b.querySelector(".rk-rep-open-txt");
      if (ico) ico.textContent = REP_OPEN ? "▾" : "▸";
      if (txt) txt.textContent = REP_OPEN ? "收起详细报告" : "查看详细报告";
    });
  }

  function applyCols() {
    var n = Math.max(2, Math.min(COLS_MAX, COLS));
    if (MODE === "v") {
      var sp = sortPeriods(FACETS.periods);
      SEL_PERIODS = sp.slice(Math.max(0, sp.length - n));
      var all = orderedSites();
      var keep = SEL_SITES[0] || "";
      var one = (keep && all.indexOf(keep) >= 0) ? keep : (all[0] || "");
      SEL_SITES = one ? [one] : [];
    } else if (MODE === "c") {
      /* 类目对比：国家 / 周次各取一个，类目补足到 N 个 */
      var allC = orderedSites();
      var keepC = SEL_SITES[0] || "";
      var oneC = (keepC && allC.indexOf(keepC) >= 0) ? keepC : (allC[0] || "");
      SEL_SITES = oneC ? [oneC] : [];
      var spC = sortPeriods(FACETS.periods);
      SEL_PERIODS = spC.length ? [spC[spC.length - 1]] : [];
      /* 列数 = 勾选的类目数：这里不再按「几列」重排，只在空选时兜底 */
      if (!SEL_CATS.length) SEL_CATS = pickCats(2);
      SEL_CATS = SEL_CATS.slice(0, CAT_MAX);
    } else {
      var all2 = orderedSites();
      var kept = SEL_SITES.filter(function (x) { return all2.indexOf(x) >= 0; });
      var pick = kept.slice(0, n);
      /* 补足到 N 个国家：只留下已选的会变成「1 列」，横向对比就没意义了 */
      for (var q = 0; q < all2.length && pick.length < n; q++) {
        if (pick.indexOf(all2[q]) < 0) pick.push(all2[q]);
      }
      SEL_SITES = pick;
      var sp2 = sortPeriods(FACETS.periods);
      SEL_PERIODS = sp2.length ? [sp2[sp2.length - 1]] : [];
    }
    normalizeSingle();
    CACHE = null; CAP = CAP_STEP;
  }

  function renderCats() {
    var box = $("#rk-cats");
    if (!box) return;
    var list = FACETS.categories.slice();
    if (!list.length) { box.innerHTML = '<div class="rk-empty">暂无类目</div>'; return; }
    box.innerHTML = "";
    [ALL].concat(list).forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cat-menu-item" + (c === CAT ? " active" : "");
      b.textContent = c;
      b.onclick = function () {
        CAT = c; CACHE = null; CAP = CAP_STEP;
        /* 类目对比下点左侧类目 = 把它提到第一列，其余照旧补足（导航语义不变，不改成多选器） */
        if (MODE === "c") { SEL_CATS = []; SEL_CATS = pickCats(Math.max(2, SEL_CATS_LEN || 2)); }
        renderCats(); renderPanel(); renderSummary(); load();
      };
      box.appendChild(b);
    });
  }

  /* ---------------- 筛选面板（悬停/点击展开） ---------------- */
  function chip(val, label, on, attr) {
    return '<button type="button" class="tag-chip' + (on ? " active" : "") + '" ' + attr + '="' + esc(val) + '">' + esc(label) + '</button>';
  }

  function renderPanel() {
    var box = $("#rk-groups");
    if (!box) return;
    var periods = sortPeriods(FACETS.periods);

    /* 20261113D：纵向 / 类目对比增加「全部站点」。
       以前这两个模式只查第一个站点，其余站点的图不显示也没有提示 ——
       「导了 100 多张只显示 18 张」多数是这个原因。 */
    var sitesHtml = FACETS.sites.length
      ? ((MODE === "h" ? "" : chip(SITE_ALL_KEY, "全部站点", SITE_ALL && !SEL_GROUP, "data-site"))
        + FACETS.sites.map(function (s) { return chip(s, s, !SITE_ALL && SEL_SITES.indexOf(s) >= 0 && !SEL_GROUP, "data-site"); }).join(""))
      : '<span class="rk-note">后台还没有维护国家站点</span>';

    /* 地区（后台把多个国家并成一个地区）：选中即整区合并成一列；也可以不选，直接挑单个国家 */
    var grpList = GROUPS.filter(function (g) { return g.name && (g.members || []).length; });
    var groupHtml = "";
    if (grpList.length) {
      groupHtml = '<div class="tag-group"><span class="tag-group-name">地区（合并整区对比）</span><div class="tag-chips" id="rk-g-groups">' +
        grpList.map(function (g) {
          return chip(g.name, g.name + "（" + g.members.length + " 国）", SEL_GROUP === g.name, "data-group");
        }).join("") +
        (SEL_GROUP ? chip("", "取消地区", false, "data-group") : "") +
        '</div></div>';
    }

    var periodsHtml = periods.length
      ? periods.map(function (p) { return chip(p, p, SEL_PERIODS.indexOf(p) >= 0, "data-period"); }).join("")
      : '<span class="rk-note">后台还没有上传榜单数据</span>';

    var tagList = [["all", "全部"], ["surge", "周度激增"], ["hot", "趋势爆款"], ["opportunity", "潜力机会"]];
    var tagsHtml = tagList.map(function (t) { return chip(t[0], t[1], TAGS.indexOf(t[0]) >= 0, "data-tag"); }).join("");

    var sortList = [["ratio_desc", "环比比例 高→低"], ["ratio_asc", "环比比例 低→高"], ["abs_desc", "环比绝对值 高→低"], ["abs_asc", "环比绝对值 低→高"]];
    var sortHtml = sortList.map(function (t) { return chip(t[0], t[1], SORT === t[0], "data-sort"); }).join("");

    var sizeList = [["s", "小"], ["m", "中"], ["l", "大"]];
    var sizeHtml = sizeList.map(function (t) { return chip(t[0], t[1], SIZE === t[0], "data-size"); }).join("");

    var modeHtml =
      chip("h", "横向 · 国家对比", MODE === "h", "data-mode") +
      chip("v", "纵向 · 时间对比", MODE === "v", "data-mode") +
      chip("c", "横向 · 类目对比", MODE === "c", "data-mode");

    /* 对比列数：纵向=对比几周、横向国家=对比几国、横向类目=对比几个类目 */
    var colsHtml = COLS_OPTS.map(function (n) { return chip(String(n), n + " 列", COLS === n, "data-cols"); }).join("");
    var colsLabel = (MODE === "v" ? "对比列数（周）" : (MODE === "c" ? "对比列数（类目）" : "对比列数（国家）"));

    /* 位次排序（仅纵向有效）：新上榜 / 上升位次最多的排最前面 */
    var moveHtml =
      chip("off", "默认（环比）", MOVE === "off", "data-move") +
      chip("move", "位次上升最多", MOVE === "move", "data-move") +
      chip("new", "新上榜优先", MOVE === "new", "data-move");
    var scopeHtml = "";
    if (MODE === "v" && MOVE !== "off") {
      scopeHtml = chip("all", "全部期次", MOVE_SCOPE === "all", "data-scope") +
        sortPeriods(SEL_PERIODS).map(function (p) { return chip(p, "仅 " + p, MOVE_SCOPE === p, "data-scope"); }).join("");
    }
    /* 只看标签：点了就只显示带该标签的图，再点一次可取消（仅纵向·时间对比有效） */
    var onlyGroup = (MODE === "v" || MODE === "c")
      ? '<div class="tag-group"><span class="tag-group-name">只看标签（单选，点已选中的可取消）</span><div class="tag-chips" id="rk-g-only">' +
          chip("off", "全部", ONLY === "off", "data-only") +
          chip("up", "只看位次上升", ONLY === "up", "data-only") +
          chip("new", "只看新上榜", ONLY === "new", "data-only") +
          chip("rup", "只看环比上升", ONLY === "rup", "data-only") +
          chip("rdown", "只看环比下降", ONLY === "rdown", "data-only") +
        '</div></div>'
      : "";

    /* 打标筛选：任何模式都可用。用户要「一眼确认标有没有进前台」，
       不必一张张悬停去数 —— 选「只看已打标」就能把有标的图单独挑出来。 */
    var taggedGroup =
      '<div class="tag-group"><span class="tag-group-name">打标筛选（按是否已打标筛图，任何模式都有效）</span><div class="tag-chips" id="rk-g-tagged">' +
        chip("off", "全部", TAGGED === "off", "data-tagged") +
        chip("yes", "只看已打标", TAGGED === "yes", "data-tagged") +
        chip("no", "只看未打标", TAGGED === "no", "data-tagged") +
      '</div></div>';

    /* 趋势标签 + 排序 / 图幅 / 位次排序 全部并列在同一排直接展示，无需再点开 */
    var mergedRow =
      '<div class="tag-group"><span class="tag-group-name">趋势标签 / 排序（均为单选）</span><div class="tag-chips" id="rk-g-merge">' +
        '<span class="tag-inline" id="rk-g-tags">' + tagsHtml + '</span>' +
        '<span class="tag-sep"></span><span class="tag-sub">排序</span>' +
        '<span class="tag-inline" id="rk-g-sort">' + sortHtml + '</span>' +
        '<span class="tag-sep"></span><span class="tag-sub">图幅</span>' +
        '<span class="tag-inline" id="rk-g-size">' + sizeHtml + '</span>' +
        '<span class="tag-sep"></span><span class="tag-sub">位次排序' +
          (MODE === "v" || MODE === "c" ? "（对比上一周）" : "（仅纵向 / 类目有效）") + '</span>' +
        '<span class="tag-inline" id="rk-g-move">' + moveHtml + '</span>' +
        (scopeHtml
          ? '<span class="tag-sep"></span><span class="tag-sub">范围</span><span class="tag-inline" id="rk-g-scope">' + scopeHtml + '</span>'
          : '') +
      '</div></div>';

    /* 类目对比专用：并排哪几个类目（多选 2–4 个）。放在筛选面板里，左侧类目菜单仍保持"单选导航"语义 */
    var catsGroup = "";
    if (MODE === "c") {
      var catPick = activeCats();
      var catChips = (FACETS.categories || []).map(function (c) {
        return chip(c, c, catPick.indexOf(c) >= 0, "data-cat");
      }).join("");
      catsGroup = '<div class="tag-group"><span class="tag-group-name">对比类目（勾几个就对比几个，最多四个 · 列顺序可拖动调整）</span>'
        + '<div class="tag-chips" id="rk-g-cats">' + catChips + '</div></div>';
    }

    box.innerHTML =
      '<div class="tag-group"><span class="tag-group-name">对比模式</span><div class="tag-chips" id="rk-g-mode">' + modeHtml + '</div></div>' +
      (MODE === "c" ? '' : '<div class="tag-group"><span class="tag-group-name">' + colsLabel + '</span><div class="tag-chips" id="rk-g-cols">' + colsHtml + '</div></div>') +
      groupHtml +
      catsGroup +
      '<div class="tag-group"><span class="tag-group-name">国家站点' + (SEL_GROUP ? "（已按地区合并，点上方「取消地区」可单选国家）" : (MODE === "h" ? "（可多选，最多 " + COLS_MAX + " 个）" : "（单选，选一个其它自动取消）")) + '</span><div class="tag-chips" id="rk-g-sites">' + sitesHtml + '</div></div>' +
      '<div class="tag-group"><span class="tag-group-name">周次 / 期次' + (MODE === "v"
        ? (PERIODS_AUTO
            ? "（现为最近 " + SEL_PERIODS.length + " 周，点选即改为你自己选的周次）"
            : "（可多选，最多 " + COLS_MAX + " 个）")
        : "（单选，选一个其它自动取消）") + '</span><div class="tag-chips" id="rk-g-periods">' + periodsHtml + '</div></div>' +
      mergedRow + taggedGroup + onlyGroup;

    bindPanel();
  }

  function bindPanel() {
    var tagBox0 = $("#rk-g-tagged");
    if (tagBox0) Array.prototype.forEach.call(tagBox0.querySelectorAll("[data-tagged]"), function (b) {
      b.onclick = function () {
        var v = b.getAttribute("data-tagged");
        TAGGED = v;
        renderPanel(); renderSummary(); renderBody();
      };
    });
    var modeBox = $("#rk-g-mode");
    if (modeBox) Array.prototype.forEach.call(modeBox.querySelectorAll("[data-mode]"), function (b) {
      b.onclick = function () {
        var m = b.getAttribute("data-mode");
        if (m === MODE) return;
        MODE = m;
        applyCols();                       /* 切换模式后按「对比列数」重排站点 / 期次 */
        renderPanel(); renderSummary(); renderBar(); load();
      };
    });

    var colsBox = $("#rk-g-cols");
    if (colsBox) Array.prototype.forEach.call(colsBox.querySelectorAll("[data-cols]"), function (b) {
      b.onclick = function () {
        var n = parseInt(b.getAttribute("data-cols"), 10);
        if (!n || n === COLS) return;
        COLS = n;
        applyCols();
        renderPanel(); renderSummary(); renderBar(); load();
      };
    });

    /* 类目对比：勾选 / 取消要并排的类目（勾几个就几个，最多四个） */
    var catBox = $("#rk-g-cats");
    if (catBox) Array.prototype.forEach.call(catBox.querySelectorAll("[data-cat]"), function (b) {
      b.onclick = function () {
        var v = b.getAttribute("data-cat");
        var i = SEL_CATS.indexOf(v);
        if (i >= 0) {
          if (SEL_CATS.length <= 1) { toast("至少保留一个类目"); return; }
          SEL_CATS.splice(i, 1);
        } else {
          if (SEL_CATS.length >= CAT_MAX) { toast("最多四个类目同时对比，可先取消一个"); return; }
          SEL_CATS.push(v);
        }
        SEL_CATS_LEN = SEL_CATS.length;
        COLS = Math.max(1, Math.min(CAT_MAX, SEL_CATS.length));
        CACHE = null; CAP = CAP_STEP;
        renderPanel(); renderSummary(); renderBar(); load();
      };
    });

    var siteBox = $("#rk-g-sites");
    if (siteBox) Array.prototype.forEach.call(siteBox.querySelectorAll("[data-site]"), function (b) {
      b.onclick = function () {
        var v = b.getAttribute("data-site");
        SEL_GROUP = "";                       /* 选单个国家 / 全部站点 → 取消地区合并 */
        if (v === SITE_ALL_KEY) {
          SITE_ALL = !SITE_ALL;               /* 再点一次回到单站点视图 */
          CACHE = null; CAP = CAP_STEP;
          renderPanel(); renderSummary(); renderBar(); load();
          return;
        }
        SITE_ALL = false;
        if (MODE !== "h") {
          SEL_SITES = [v];                    /* 纵向·时间对比：国家单选，选中即自动取消其它国家 */
        } else {
          var i = SEL_SITES.indexOf(v);
          if (i >= 0) SEL_SITES.splice(i, 1);
          else {
            if (SEL_SITES.length >= COLS_MAX) { toast("最多同时对比 " + COLS_MAX + " 个国家，可先取消一个"); return; }
            SEL_SITES.push(v);
          }
          COLS = Math.max(2, Math.min(COLS_MAX, SEL_SITES.length));   /* 手选后列数跟着走 */
        }
        if (!SEL_SITES.length) SEL_SITES = orderedSites().slice(0, COLS);   /* 全取消时回落到前几个，避免空页 */
        CACHE = null; CAP = CAP_STEP;
        renderPanel(); renderSummary(); renderBar(); load();
      };
    });

    var grpBox = $("#rk-g-groups");
    if (grpBox) Array.prototype.forEach.call(grpBox.querySelectorAll("[data-group]"), function (b) {
      b.onclick = function () {
        var v = b.getAttribute("data-group");
        SEL_GROUP = (v && v !== SEL_GROUP) ? v : "";
        SITE_ALL = false;                    /* 选地区 = 按地区合并成一条，与「全部站点」互斥 */
        CACHE = null; CAP = CAP_STEP;
        renderPanel(); renderSummary(); renderBar(); load();
      };
    });

    var pBox = $("#rk-g-periods");
    if (pBox) Array.prototype.forEach.call(pBox.querySelectorAll("[data-period]"), function (b) {
      b.onclick = function () {
        var r = togglePeriodPick(b.getAttribute("data-period"));   /* 横向=单选；纵向=多选，首次手选重置 */
        if (!r.ok) { toast(r.msg); return; }
        CACHE = null; CAP = CAP_STEP;
        renderPanel(); renderSummary(); renderBar(); load();
      };
    });

    var tagBox = $("#rk-g-tags");
    if (tagBox) Array.prototype.forEach.call(tagBox.querySelectorAll("[data-tag]"), function (b) {
      b.onclick = function () {
        /* 趋势标签为单选：选中一个，其余自动取消 */
        TAGS = [b.getAttribute("data-tag")];
        renderPanel(); renderSummary(); renderBody();
      };
    });

    var moveBox = $("#rk-g-move");
    if (moveBox) Array.prototype.forEach.call(moveBox.querySelectorAll("[data-move]"), function (b) {
      b.onclick = function () {
        MOVE = b.getAttribute("data-move");
        if (MOVE === "off") MOVE_SCOPE = "all";
        renderPanel(); renderSummary(); renderBody();
      };
    });

    var scopeBox = $("#rk-g-scope");
    if (scopeBox) Array.prototype.forEach.call(scopeBox.querySelectorAll("[data-scope]"), function (b) {
      b.onclick = function () {
        MOVE_SCOPE = b.getAttribute("data-scope");
        renderPanel(); renderSummary(); renderBody();
      };
    });

    var onlyBox = $("#rk-g-only");
    if (onlyBox) Array.prototype.forEach.call(onlyBox.querySelectorAll("[data-only]"), function (b) {
      b.onclick = function () {
        var v = b.getAttribute("data-only");
        ONLY = (v === ONLY) ? "off" : v;             /* 点已选中的 → 取消，回到全部 */
        renderPanel(); renderSummary(); renderBody();
      };
    });

    var sortBox = $("#rk-g-sort");
    if (sortBox) Array.prototype.forEach.call(sortBox.querySelectorAll("[data-sort]"), function (b) {
      b.onclick = function () {
        SORT = b.getAttribute("data-sort");
        renderPanel(); renderSummary(); renderBody();
      };
    });

    var sizeBox = $("#rk-g-size");
    if (sizeBox) Array.prototype.forEach.call(sizeBox.querySelectorAll("[data-size]"), function (b) {
      b.onclick = function () {
        SIZE = b.getAttribute("data-size");
        renderPanel(); renderBody();
      };
    });
  }

  /* ---------------- 摘要条 ---------------- */
  function tagLabel() {
    if (!TAGS.length || TAGS.indexOf("all") >= 0) return "全部";
    var map = { surge: "周度激增", hot: "趋势爆款", opportunity: "潜力机会" };
    return TAGS.map(function (t) { return map[t] || t; }).join(" / ");
  }

  function renderSummary() {
    var el = $("#rk-summary");
    if (!el) return;
    var sites = activeSites();
    var periods = activePeriods();
    var parts = [];
    parts.push(MODE === "c" ? (activeCats().join(" / ") || CAT || ALL) : (CAT || ALL));
    parts.push(periods.length ? periods.join("、") : "未选周次");
    var _g = activeGroup();
    parts.push(_g ? ("地区 " + _g.name) : (SITE_ALL ? "全部站点" : (sites.length ? sites.join(" / ") : "未选国家")));
    parts.push(tagLabel());
    if ((MODE === "v" || MODE === "c") && MOVE !== "off") parts.push(moveLabel());
    if ((MODE === "v" || MODE === "c") && ONLY !== "off") parts.push(onlyLabel());
    el.textContent = parts.join(" · ");
  }

  function moveLabel() {
    var base = (MOVE === "move") ? "位次上升最多优先" : "新上榜优先";
    if (MOVE_SCOPE === "all") return base + "（全部期次）";
    return base + "（仅 " + MOVE_SCOPE + "）";
  }

  /* ---------------- 把当前视图写回地址栏 ----------------
     目的：**刷新后停在同一处**。以前所有筛选只存在内存里，F5 一按就回到默认口径，
     用户会以为"刷新就跳回首页"。这里把选择同步进 URL（replaceState，不产生历史记录），
     刷新时再走上面那段 URL 解析，状态自然就回来了。 */
  function syncUrl() {
    try {
      if (!window.history || !history.replaceState) return;
      var q = new URLSearchParams(location.search);
      q.set("mode", MODE);
      q.set("size", SIZE);
      if (CAT && CAT !== ALL) q.set("cat", CAT); else q.delete("cat");
      var sites = (MODE === "h") ? SEL_SITES.slice() : SEL_SITES.slice(0, 1);
      if (SITE_ALL) q.set("sites", SITE_ALL_KEY);
      else if (sites.length) q.set("sites", sites.join(",")); else q.delete("sites");
      if (SEL_GROUP) q.set("group", SEL_GROUP); else q.delete("group");
      if (SEL_PERIODS && SEL_PERIODS.length) q.set("periods", SEL_PERIODS.join(",")); else q.delete("periods");
      var cats = (MODE === "c") ? SEL_CATS.slice() : [];
      if (cats.length) q.set("cats", cats.join(",")); else q.delete("cats");
      var next = location.pathname + "?" + q.toString();
      if (next !== location.pathname + location.search) history.replaceState(null, "", next);
    } catch (e) { /* 地址栏写不进去不影响功能 */ }
  }

  function renderBar() {
    var el = $("#rk-bar");
    if (!el) return;
    syncUrl();
    var sites = sitesForQuery();
    var periods = activePeriods();
    /* 类目对比：CACHE 里含「上一周基线」（只为算位次），直接拿它当总数会把上周的图也算进来，
       于是出现「共 1000 张，但下面只有 200 张」。这里改成按实际画进各列的张数算。
       20261113D：纵向也一样 —— 取数改成全站点后，CACHE 里带着别国的图，
       直接数 CACHE 会把没显示的图算成「共 N 张」，必须用实际画进列里的张数。 */
    var total = (CACHE && CACHE.items) ? CACHE.items.length : 0;
    if ((MODE === "c" || MODE === "v") && LAST_COLS_MODE === MODE) total = LAST_KEPT;
    var shown = total ? Math.min(CAP, total) : 0;
    var h = '<div class="rk-modes">' +
      '<button type="button" class="rk-mode-btn' + (MODE === "h" ? " on" : "") + '" data-mode="h">横向 · 国家对比（多国 × 单周）</button>' +
      '<button type="button" class="rk-mode-btn' + (MODE === "v" ? " on" : "") + '" data-mode="v">纵向 · 时间对比（单国 × 多周）</button>' +
      '<button type="button" class="rk-mode-btn' + (MODE === "c" ? " on" : "") + '" data-mode="c">横向 · 类目对比（单周 × 多类目）</button>' +
      '</div>';
    /* 列数一律以「上一次真正画出来的列数」为准：三类模式都可能折叠空列，
       按已选数量显示会出现「写着 2 列、下面只有 1 列」这种对不上。 */
    var cols = (LAST_COLS_MODE === MODE && LAST_COLS) ? LAST_COLS
      : (MODE === "v" ? periods.length : (MODE === "c" ? activeCats().length : sites.length));
    h += '<button type="button" class="rk-eye-btn" id="rk-eye-btn" title="一次看到所有对比列的全部图片">天眼 · 查看全部对比图</button>';
    h += '<button type="button" class="rk-exp-img" id="rk-exp-img" title="把当前这个页面此刻的样子定格成一张高清长图（列、卡片、位次标签都在原位，可放大看清）">导出图片（整页 · 高清）</button>';
    h += '<button type="button" class="rk-rep-btn" id="rk-week-report" title="按当前选中的两周生成一份对比分析报告（PPT）：款式 / 图案印花与设计元素 / 二次工艺 / 场景与背景构成 / 主图视觉 / 类目结构 六维差异 + 趋势结论">生成周对比分析报告</button>';
    h += '<button type="button" class="rk-batch-fav hidden" id="rk-batch-fav">批量收藏（0）</button>';
    h += '<div class="rk-bar-info">';
    if (!sites.length || !periods.length) h += '请选择国家站点与周次';
    else h += '共 <b>' + total + '</b> 张 · <b>' + cols + '</b> 列 · 每列最多展示 <b>' + shown + '</b> 张';
    /* 20261113D：把「没显示的张数」直接说出来，避免再被当成数据丢失 */
    if (MODE === "v" && LAST_OFFSITE > 0 && !SEL_GROUP && !SITE_ALL) {
      h += ' <span class="rk-bar-hint">另有 <b>' + LAST_OFFSITE + '</b> 张属于其它站点（未显示）—— 点上方「全部站点」可一并查看</span>';
    }
    h += '</div>';
    el.innerHTML = h;
    /* 导出图片（整页 · 高清）：与「导出 PPT」同一套权限口径 —— 只允许超级管理员
       （按钮默认不可见，确认身份后才出现；调用时还会再校验一次） */
    var exb = $("#rk-exp-img");
    if (exb) {
      exb.onclick = function () {
        if (!window.ReportKit || !window.ReportKit.exportImages) { toast("导出组件不可用，请刷新页面后重试"); return; }
        var snap = snapshotOps();
        if (!snap || !snap.ops.length) { toast("当前筛选下没有可导出的内容"); return; }
        window.ReportKit.exportImages({ ops: snap.ops, root: snap.root, scope: exportScope() });
      };
      eyeIsSuper().then(function (ok) { if (ok) exb.className = "rk-exp-img on"; });
    }

    var eye = $("#rk-eye-btn");
    if (eye) eye.onclick = openEye;

    /* 生成周对比分析报告：只在「纵向 · 时间对比」且选中 ≥2 周时才有意义。
       权限口径与「导出图片」「导出 PPT」一致 —— 只给超级管理员。
       报告里除数据类页面外，还有款式 / 印花 / 工艺 / 场景 / 主图视觉 / 类目 六维差异页，
       维度数据取自后台给图片打的标签（缺标时该维度页会说明"无打标数据"，不影响成稿）。 */
    var rep = $("#rk-week-report");
    if (rep) {
      var canRep = (MODE === "v" && periods.length >= 2);
      rep.disabled = !canRep;
      rep.style.display = "none";   /* 默认不可见，确认是超级管理员后才出现 */
      rep.title = canRep
        ? rep.getAttribute("title")
        : "请先用「纵向 · 时间对比」并选中 2 周以上，再生成对比报告";
      rep.onclick = function () {
        if (!window.WeekReport) { toast("报告组件未加载，请刷新页面后重试"); return; }
        if (MODE !== "v" || activePeriods().length < 2) { toast("请切到「纵向 · 时间对比」并选中两周以上"); return; }
        var scope = exportScope();
        var now = new Date();
        var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
        rep.disabled = true;
        var oldTxt = rep.textContent;
        rep.textContent = "正在生成报告…";
        var done = function (msg, bad) {
          rep.disabled = false; rep.textContent = oldTxt;
          if (msg) toast(msg, bad);
        };
        window.WeekReport.run({
          root: document.querySelector("#rk-pools"),
          spec: "wide",
          scope: scope,
          nowText: now.getFullYear() + "-" + p2(now.getMonth() + 1) + "-" + p2(now.getDate()) + " " + p2(now.getHours()) + ":" + p2(now.getMinutes()),
          v: (function () { var s = document.querySelector('script[src*="js/rank.js"]'); return (s && (String(s.getAttribute("src")).match(/[?&]v=([^&]+)/) || [])[1]) || ""; })(),
          onProgress: function (t) { rep.textContent = t; },
          tagOf: function (urls) {
            if (!SBX) return Promise.resolve({});
            /* 先读「图库标签 + 榜单独立标签」的合并结果（后者是历史上榜单打标写下的，数据保留、入口已下线）；
               老版本没有合并方法时退回只读图库，保证不会因此报错。 */
            var fn = SBX.listImageTagsForReport || SBX.listImageTags;
            if (!fn) return Promise.resolve({});
            return fn.call(SBX, urls).catch(function () { return {}; });
          }
        }).then(function (r) {
          if (!r || !r.ok) { done((r && r.reason) || "生成失败，请重试", true); return; }
          done("已生成：" + r.name);
        }, function () { done("生成失败，请重试", true); });
      };
      eyeIsSuper().then(function (ok) { if (ok) rep.style.display = ""; else rep.style.display = "none"; });
    }
    Array.prototype.forEach.call(el.querySelectorAll("[data-mode]"), function (b) {
      b.onclick = function () {
        var m = b.getAttribute("data-mode");
        if (m === MODE) return;
        MODE = m;
        applyCols();                       /* 切换模式后按「对比列数」重排站点 / 期次 */
        renderPanel(); renderSummary(); renderBar(); load();
      };
    });
  }

  /* ---------------- 卡片 ---------------- */
  function cardHtml(it, opt) {
    opt = opt || {};
    var b = badgeOf(it);
    var share = (opt.share && opt.share.length >= 2) ? opt.share : null;
    var title = [it.site, it.period_label, leafOf(it), b ? b.txt : ""].filter(Boolean).join(" · ");
    /* 天眼模式：图上不叠任何文字（打开后就是一面纯图墙，密密麻麻的字不再挡图）。
       标签改挂在 data-* 上，鼠标移到那张图上时由放大浮窗显示 —— 放大图 + 图下方标签。 */
    var eyeMeta = "", eyeTags = [];
    if (opt.eye) {
      eyeMeta = [it.site, it.period_label, leafOf(it)].filter(Boolean).join(" · ");
      if (b) eyeTags.push(b.txt);
      if (opt.move) eyeTags.push(opt.move);
      if (share) eyeTags.push("共 " + share.length + " 国同款");
    }
    /* 收藏要保留卡片上原本显示的「标签」：趋势爆款 / 上升 12 位 / 共 3 国同款 …
       直接快照到 data-tags，收藏时一并落库，进收藏后这些信息不会消失。 */
    var cardTags = [];
    if (b) cardTags.push(b.txt);
    if (opt.move) cardTags.push(opt.move);
    if (share) cardTags.push("共 " + share.length + " 国同款");
    var h = '<figure class="rk-card' + (opt.isNew ? " is-new" : "") + '" data-url="' + esc(it.image_url) + '" title="' + esc(title) + '"'
      + ' draggable="true" data-tags="' + esc(cardTags.join("|")) + '"'
      + ' data-period="' + esc(it.period_label || "") + '" data-ptype="' + esc(it.period_type || "week") + '"'
      + ' data-title="' + esc(it.title || "") + '" data-leaf="' + esc(leafOf(it)) + '"'
      + ' data-cat="' + esc(it.category || "") + '" data-site="' + esc(it.site || "") + '"'
      + ' data-ratio="' + esc(it.ratio == null ? "" : it.ratio) + '" data-rank="' + esc(it.rank_abs == null ? "" : it.rank_abs) + '"'
      + (opt.eye ? ' data-eye-meta="' + esc(eyeMeta) + '" data-eye-tags="' + esc(eyeTags.join("|")) + '"' : '') + '>';
    /* 天眼要求「一次全加载、不用下滑」：这些图都在首屏内，直接加载；其余场景保持懒加载省流量 */
    h += '<img' + (opt.eager ? '' : ' loading="lazy"') + ' decoding="async" src="' + esc(it.image_url) + '" alt="' + esc(leafOf(it) || "榜单图片") + '"'
      + (opt.eager ? ' fetchpriority="high"' : '') + '>';
    if (!opt.eye) {
      if (b) h += '<span class="rk-badge ' + b.cls + '">' + esc(b.txt) + '</span>';
      if (opt.siteTag && it.site) h += '<span class="rk-site">' + esc(it.site) + '</span>';
      if (share) h += '<span class="rk-share" title="与 ' + esc(share.join("、")) + ' 相同">共 ' + share.length + ' 国</span>';
      if (opt.move) h += '<span class="rk-move">' + esc(opt.move) + '</span>';
      /* 我的收藏：右上角星标（点一次收藏/取消），左上角多选勾选（攒够一次批量收藏） */
      h += '<button type="button" class="rk-fav" data-fav="0" title="收藏到「我的收藏」">☆</button>';
      h += '<span class="rk-pick" data-pick="0" title="选中，稍后批量收藏"></span>';
    }
    /* 天眼标签（可开关）：文字一律放在【图片下方】的独立栏里，绝不叠在图上、不盖图。
       顶栏固定蓝栏里的「眼睛」按钮随时开关；关掉后整条隐藏，图片区自然变大。 */
    if (opt.eye) {
      h += '<figcaption class="rk-eye-cap">' +
        (eyeMeta ? '<span class="rk-eye-cap-m">' + esc(eyeMeta) + '</span>' : '') +
        (eyeTags.length ? '<span class="rk-eye-cap-t">' + esc(eyeTags.join(" · ")) + '</span>' : '') +
        '</figcaption>';
    }
    h += '</figure>';
    return h;
  }

  function poolHtml(name, meta, n, cardsHtml, shownN, o) {
    o = o || {};
    /* 类目对比的列可拖动换序：只有 grips 可拖，卡片本身的拖动（收藏）不受影响 */
    var grip = o.dragKey
      ? '<span class="rk-pool-grip" draggable="true" data-rk-cat="' + esc(o.dragKey) + '"'
        + ' title="按住拖动，可调整这一列的位置" aria-label="拖动调整列顺序">⋮⋮</span>'
      : "";
    var h = '<section class="rk-pool' + (o.dragKey ? " rk-pool-dnd" : "") + '"'
      + (o.dragKey ? ' data-rk-cat="' + esc(o.dragKey) + '"' : '') + '>';
    h += '<div class="rk-pool-head">' + grip +
      '<div class="rk-pool-name"><span>' + esc(name) + '</span><span class="rk-n">' + n + ' 张</span></div>' +
      (meta ? '<div class="rk-pool-meta">' + esc(meta) + '</div>' : "") +
      '</div>';
    h += '<div class="rk-pool-grid sz-' + SIZE + '">' + (cardsHtml || '<div class="rk-empty">该列暂无数据</div>') + '</div>';
    if (shownN != null) h += '<div class="rk-pool-foot">已展示 ' + shownN + ' / ' + n + '</div>';
    h += '</section>';
    return h;
  }

  /* ---------------- 类目列拖动换序 ----------------
     为什么只给列头一个把手：卡片本身已经是"可拖动收藏"的来源，
     整列 draggable 会把卡片的拖拽吞掉。把手单独可拖，两件事互不干扰。
     换序只改「谁在左边」，不动筛选与数据 → 不重新取数，秒回。 */
  var POOL_DRAG = { cat: "" };

  function bindPoolDrag(root) {
    if (MODE !== "c" || !root) return;
    var pools = Array.prototype.slice.call(root.querySelectorAll("#rk-pools .rk-pool[data-rk-cat]"));
    if (pools.length < 2) return;

    pools.forEach(function (sec) {
      var grip = sec.querySelector(".rk-pool-grip");
      if (grip) {
        grip.addEventListener("dragstart", function (e) {
          POOL_DRAG.cat = grip.getAttribute("data-rk-cat") || "";
          sec.classList.add("is-drag-src");
          try {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("application/x-rk-cat", POOL_DRAG.cat);
            e.dataTransfer.setData("text/plain", POOL_DRAG.cat);
          } catch (x) {}
        });
        grip.addEventListener("dragend", function () {
          POOL_DRAG.cat = "";
          pools.forEach(function (s2) { s2.classList.remove("is-drag-src", "is-drop-l", "is-drop-r"); });
        });
      }

      sec.addEventListener("dragover", function (e) {
        if (!POOL_DRAG.cat) return;
        var target = sec.getAttribute("data-rk-cat");
        if (!target || target === POOL_DRAG.cat) return;
        e.preventDefault();                       /* 允许放下：不 preventDefault 浏览器会拒绝 */
        try { e.dataTransfer.dropEffect = "move"; } catch (x) {}
        var r = sec.getBoundingClientRect();
        var right = (e.clientX > r.left + r.width / 2);
        sec.classList.toggle("is-drop-r", right);
        sec.classList.toggle("is-drop-l", !right);
      });
      sec.addEventListener("dragleave", function () {
        sec.classList.remove("is-drop-l", "is-drop-r");
      });
      sec.addEventListener("drop", function (e) {
        if (!POOL_DRAG.cat) return;
        var target = sec.getAttribute("data-rk-cat");
        if (!target || target === POOL_DRAG.cat) return;
        e.preventDefault();
        var r = sec.getBoundingClientRect();
        var after = (e.clientX > r.left + r.width / 2);
        var src = POOL_DRAG.cat;
        POOL_DRAG.cat = "";
        if (moveCatTo(src, target, after)) {
          renderPanel(); renderSummary(); renderBar(); renderBody();
          toast("已调整列顺序");
        }
      });
    });
  }

  /* 把 src 类目移到 target 之前 / 之后（就地改 SEL_CATS 的顺序） */
  function moveCatTo(src, target, after) {
    var list = (SEL_CATS || []).slice();
    var from = list.indexOf(src);
    if (from < 0) return false;
    list.splice(from, 1);
    var to = list.indexOf(target);
    if (to < 0) return false;
    list.splice(after ? to + 1 : to, 0, src);
    SEL_CATS = list;
    SEL_CATS_LEN = list.length;
    /* 只换显示顺序：同一批数据重排即可，不必重新取数（也不清缓存，避免整页闪成空态） */
    return true;
  }

  /* ---------------- 主体：多列对比池 ---------------- */
  /* 组装多列对比池 HTML（只出列，不含外层容器）。
     limit = 每列最多渲染多少张；天眼传 Infinity，一次把该列全部图片都出出来。 */
  function buildPools(limit, opts) {
    opts = opts || {};
    var sites = opts.sites || poolSites();
    var periods = opts.periods || activePeriods();
    var src = opts.items || (CACHE && CACHE.items) || [];
    var all = src.filter(hitTags);
    EXPORT_ITEMS = [];                                   /* 每次重排都重新累计，避免残留上一次的范围 */
    var html = "", maxLen = 0, kept = 0, cols = 0, dropped = 0, dropKind = "";
    var poolKeys = [], dropNames = [];   /* 实际画出的列 / 被折叠的列名 */

    /* ===== 横向 · 国家对比：每国一列 ===== */
    if (MODE === "h") {
      var bySite = {};
      sites.forEach(function (s) { bySite[s] = []; });
      var urlSites = {};
      all.forEach(function (it) {
        if (bySite[it.site]) bySite[it.site].push(it);
        if (sites.indexOf(it.site) >= 0) {
          if (!urlSites[it.image_url]) urlSites[it.image_url] = [];
          if (urlSites[it.image_url].indexOf(it.site) < 0) urlSites[it.image_url].push(it.site);
        }
      });

      sites.forEach(function (s) {
        var mine = bySite[s] || [];
        var others = sites.filter(function (x) { return x !== s; });
        var over = 0;
        if (others.length) {
          var union = {};
          others.forEach(function (o) { (bySite[o] || []).forEach(function (i) { union[i.image_url] = 1; }); });
          var seen = {};
          mine.forEach(function (i) { if (union[i.image_url] && !seen[i.image_url]) { seen[i.image_url] = 1; over++; } });
        }
        var total = mine.length;
        var rate = total ? Math.round(over / total * 100) : 0;
        var _gp = activeGroup();
        var meta = others.length
          ? ("与 " + (others.length <= 2 ? others.join("、") : ("另 " + others.length + " 国")) + " 重合 " + over + " 张 · 重合度 " + rate + "%")
          : (_gp ? ("地区合并 · 含 " + _gp.members.length + " 国，同名商品只保留一条") : "单国视图");
        var list = sortItems(mine);
        /* 该国这一期在这个类目下没有图 → 整列不输出（横向国家对比同理：
           选了几个国家、但其中某个国家本期没上传，留一个空列既难看又白占宽度）。
           去掉后剩下的列由 flex 均分：只剩 1 国就整行铺满，2 国就两等分。 */
        if (!list.length) { dropped++; dropKind = "site"; dropNames.push(s); return; }
        if (list.length > maxLen) maxLen = list.length;
        var cards = list.slice(0, limit).map(function (it) { return cardHtml(it, { share: urlSites[it.image_url], eager: opts.eager, eye: opts.eye }); }).join("");
        html += poolHtml(s, meta, total, cards, opts.noFoot ? null : Math.min(limit, total));
        kept += list.length; cols++; poolKeys.push(s);
        /* 导出用清单：整列（不按「每列最多展示」截断）；横向按国家比，没有位次标签 */
        list.forEach(function (it) {
          EXPORT_ITEMS.push({
            url: it.image_url, label: "", site: s,
            period: it.period_label || "",
            cat: it.leaf_category || it.category || CAT || ""
          });
        });
      });
    } else if (MODE === "c") {
      /* ===== 横向 · 类目对比：每类目一列（同一周 · 同一站点） =====
         列内仍与「自己上一周」比 → 新上榜 / 上升位次 标签照旧成立；
         列与列之间不比重合度（不同类目的图天然不重复），要看差异看体征卡。 */
      var catsC = (opts.cats || activeCats()).slice();
      /* 20261113D：类目对比也一次取全站点，这里按当前视图（单个站点 / 全部站点）过滤，
         否则「只选美国」时其它国家的图会混进同一列，张数看着虚高。 */
      var _cScope = viewSites();
      var _cSet = null;
      if (_cScope) { _cSet = {}; _cScope.forEach(function (x) { _cSet[siteKey(x)] = 1; }); }
      var siteC = _cScope ? (_cScope[0] || "") : "全部站点";
      var pC = periods[periods.length - 1] || "";
      var prevC = prevOfPeriod(pC);
      var baseC = pC ? withBasePeriods([pC]) : [];
      catsC.forEach(function (cat) {
        var mine = all.filter(function (it) {
          if ((it.category || "") !== cat) return false;
          return !_cSet || !!_cSet[siteKey(it.site)];
        });
        var byP = {};
        baseC.forEach(function (p) { byP[p] = []; });
        mine.forEach(function (it) { var p = pLabel(it.period_label); if (byP[p]) byP[p].push(it); });
        if (!_cScope) baseC.forEach(function (p) { byP[p] = uniqByUrl(byP[p]); });
        /* 位次只在「同一个类目内部」有意义，所以每类目各自算一套 */
        var hasOf = {}, rankOf = {};
        baseC.forEach(function (p) {
          var lst = sortItems(byP[p] || []);
          var hs = {}, m = {};
          lst.forEach(function (i) { hs[imgKey(i.image_url)] = 1; });
          lst.filter(function (i) { return i.ratio != null; }).forEach(function (i, idx) { m[imgKey(i.image_url)] = idx + 1; });
          hasOf[p] = hs; rankOf[p] = m;
        });
        var prevEmptyC = !!prevC && ((byP[prevC] || []).length === 0);
        var list = sortItems(byP[pC] || []);
        if (MOVE !== "off" && prevC) {
          var keyedC = list.map(function (it, i) {
            var mv0 = moveOf(it, pC, prevC, hasOf, rankOf, prevEmptyC);
            var key = (MOVE === "new") ? (mv0.isNew ? 1e9 : 0) : (mv0.isNew ? -1e9 : mv0.diff);
            return { it: it, i: i, key: key };
          });
          keyedC.sort(function (a, b) { return (b.key - a.key) || (a.i - b.i); });
          list = keyedC.map(function (o) { return o.it; });
        }
        var mvStatC = { up: 0, down: 0, ne: 0, rup: 0, rdn: 0 };
        if (prevC && !prevEmptyC) list.forEach(function (i) {
          var mv0 = moveOf(i, pC, prevC, hasOf, rankOf, prevEmptyC);
          if (mv0.move === "新上榜") mvStatC.ne++;
          else if (mv0.diff > 0) mvStatC.up++;
          else if (mv0.diff < 0) mvStatC.down++;
        });
        list.forEach(function (i) {
          var r = ratioMove(i);
          if (r === "环比上升") mvStatC.rup++; else if (r === "环比下降") mvStatC.rdn++;
        });
        var newCnt = mvStatC.ne;
        var full = list.length;
        if (ONLY !== "off" && (prevC || ONLY.charAt(0) === "r")) {
          list = list.filter(function (it) { return hitOnly(moveOf(it, pC, prevC, hasOf, rankOf, prevEmptyC), it); });
        }
        if (TAGGED !== "off") list = list.filter(hitTagged);
        if (list.length > maxLen) maxLen = list.length;
        var metaC = siteC + colMetaNote(prevC, prevEmptyC, mvStatC);
        if (ONLY !== "off") metaC += " · " + onlyLabel() + "：" + list.length + " 张（该列共 " + full + " 张）";
        /* 这个类目当周没有图 → 保留整列并写明原因。
           折叠列会让「上面勾了 4 个类目、下面只剩 1 列」看着像丢数据，用户会以为漏了。 */
        if (!list.length) {
          var lastP = "";
          for (var pi2 = baseC.length - 1; pi2 >= 0; pi2--) {
            if ((byP[baseC[pi2]] || []).length) { lastP = baseC[pi2]; break; }
          }
          var emptyTxt = '该类目 ' + esc(pC) + ' 没有上榜数据'
            + (lastP ? '（最近一次有数据是 ' + esc(lastP) + '）' : '')
            + '。换一个周次，或在上面取消勾选这个类目。';
          html += poolHtml(cat, siteC + " · " + pC + " · 本周无上传", 0, '<div class="rk-empty">' + emptyTxt + '</div>', null, { dragKey: cat });
          cols++; poolKeys.push(cat);
          return;
        }
        var cardsC = list.slice(0, limit).map(function (it) {
          var mv = moveOf(it, pC, prevC, hasOf, rankOf, prevEmptyC);
          return cardHtml(it, { move: moveText(mv, it), isNew: mv.isNew, eager: opts.eager, eye: opts.eye, siteTag: !_cScope });
        }).join("");
        html += poolHtml(cat, metaC, list.length, cardsC, opts.noFoot ? null : Math.min(limit, list.length), { dragKey: cat });
        kept += list.length; cols++; poolKeys.push(cat);
        list.forEach(function (it) {
          EXPORT_ITEMS.push({
            url: it.image_url, label: moveText(moveOf(it, pC, prevC, hasOf, rankOf, prevEmptyC), it),
            site: it.site || siteC, period: pC,
            cat: it.leaf_category || it.category || cat
          });
        });
      });
    } else {
      /* ===== 纵向 · 时间对比：每期一列 ===== */
      /* 20261113D：站点不再是「只取第一个」，而是按当前视图取：
         · 选了地区 → 一条地区合并数据
         · 选了「全部站点」→ 所有站点合并（同一款多国上榜只算一次）
         · 否则 → 只显示所选站点，但同时算清「该期全站点合计多少张」，
           并在列头写明「另有 N 张属于其它站点」，不再让人怀疑数据丢了 */
      var scope = viewSites();
      var scopeSet = null;
      if (scope) { scopeSet = {}; scope.forEach(function (s) { scopeSet[siteKey(s)] = 1; }); }
      var siteName = scope ? ((scope.length > 1) ? scope.join(" / ") : (scope[0] || "")) : "全部站点";
      /* 比对用「归一键」：库里写成「美国站 / US」和菜单里的「美国」算同一个国家，
         否则取到了数据也会被整列过滤掉 —— 表现为页面空白，其实是名字对不上。 */
      var mineOnly = all.filter(function (it) { return !scopeSet || scopeSet[siteKey(it.site)]; });
      /* 20261113D：所选站点在这些期次里一条都没有，但库里明明有数据 →
         绝大多数是站点写法对不上（「美国」vs「美国站」），个别是这批货确实不是该国的。
         两种情况下给一张空白页都是最差的选择：直接按全部站点显示，并在页面上写明原因。
         以前这种情况页面只有一句「暂无榜单数据」，看起来像数据没传上去。 */
      var AUTO_ALL = false;
      if (scopeSet && !mineOnly.length && all.length) {
        AUTO_ALL = true;
        scopeSet = null; scope = null;
        siteName = "全部站点";
        mineOnly = all.slice();
      }
      var basePeriods = withBasePeriods(periods);
      var byPeriod = {}, allPeriod = {};
      basePeriods.forEach(function (p) { byPeriod[p] = []; allPeriod[p] = []; });
      /* 期次按归一后的名字入桶：库里可能同时存在 W45 / 45周 / 第45周，
         查询会把它们一起取回来，若这里按原文精确匹配，取回来却进不了桶 —— 静默丢数据。 */
      mineOnly.forEach(function (it) { var p = pLabel(it.period_label); if (byPeriod[p]) byPeriod[p].push(it); });
      all.forEach(function (it) { var p = pLabel(it.period_label); if (allPeriod[p]) allPeriod[p].push(it); });
      if (!scopeSet) {
        basePeriods.forEach(function (p) { byPeriod[p] = uniqByUrl(byPeriod[p]); });
      }
      var offsite = 0;
      if (scopeSet) {
        all.forEach(function (it) {
          if (!scopeSet[siteKey(it.site)] && byPeriod[pLabel(it.period_label)]) offsite++;
        });
      }
      LAST_OFFSITE = offsite;

      var hasOf = {}, rankOf = {};
      basePeriods.forEach(function (p) {
        var lst = sortItems(byPeriod[p] || []);
        var hs = {}, m = {};
        lst.forEach(function (i) { hs[imgKey(i.image_url)] = 1; });
        lst.filter(function (i) { return i.ratio != null; }).forEach(function (i, idx) { m[imgKey(i.image_url)] = idx + 1; });
        hasOf[p] = hs; rankOf[p] = m;
      });
      /* 20261113E：上一期有没有数据 vs 有没有这一款，必须分开判断 */
      var prevEmptyOf = {};
      periods.forEach(function (p) {
        var q = prevOfPeriod(p);
        prevEmptyOf[p] = !!q && ((byPeriod[q] || []).length === 0);
      });

      periods.forEach(function (p) {
        var prev = prevOfPeriod(p);
        var list = sortItems(byPeriod[p] || []);
        /* 位次排序：与该列的「上一周」比较 —— 新上榜置顶 / 上升位次最多的排前面。
           排序用的位次与卡片上「上升 N 位」标签同源（同一套 rankOf），保证显示与顺序一致。 */
        if (MOVE !== "off" && (MOVE_SCOPE === "all" || MOVE_SCOPE === p) && prev) {
          var keyed = list.map(function (it, i) {
            var mv0 = moveOf(it, p, prev, hasOf, rankOf, prevEmptyOf[p]);
            var isNew = mv0.isNew;
            var d = mv0.diff;
            /* 「新上榜优先」：新上榜的排最前；
               「位次上升最多」：只按上升位次排（新上榜无位次可比，沉到末尾），
               两种模式结果明显区分。 */
            var key = (MOVE === "new") ? (isNew ? 1e9 : 0) : (isNew ? -1e9 : d);
            return { it: it, i: i, key: key };
          });
          keyed.sort(function (a, b) { return (b.key - a.key) || (a.i - b.i); });
          list = keyed.map(function (o) { return o.it; });
        }
        var mvStat = { up: 0, down: 0, ne: 0, rup: 0, rdn: 0 };
        if (prev && !prevEmptyOf[p]) list.forEach(function (i) {
          var mv0 = moveOf(i, p, prev, hasOf, rankOf, prevEmptyOf[p]);
          if (mv0.move === "新上榜") mvStat.ne++;
          else if (mv0.diff > 0) mvStat.up++;
          else if (mv0.diff < 0) mvStat.down++;
        });
        list.forEach(function (i) {
          var r = ratioMove(i);
          if (r === "环比上升") mvStat.rup++; else if (r === "环比下降") mvStat.rdn++;
        });
        var newCnt = mvStat.ne;
        var full = list.length;
        /* 只看标签：位次上升 / 新上榜 —— 命中判定与卡片标签同源（同一套 moveOf），
           筛出来的和图上的标签永远一致；在排序之后筛，顺序仍是同一套口径 */
        if (ONLY !== "off" && (prev || ONLY.charAt(0) === "r")) {
          list = list.filter(function (it) { return hitOnly(moveOf(it, p, prev, hasOf, rankOf, prevEmptyOf[p]), it); });
        }
        if (TAGGED !== "off") list = list.filter(hitTagged);
        if (list.length > maxLen) maxLen = list.length;
        var meta = siteName + colMetaNote(prev, prevEmptyOf[p], mvStat);
        /* 张数口径必须写得明明白白：这一列显示几张、该期全站点合计几张、
           其它站点各几张。以前只有一句「共 18 张」，用户以为数据只导进来 18 条。 */
        if (scopeSet) {
          var allN = uniqByUrl(allPeriod[p] || []).length;
          if (allN > full) {
            meta += " · 本列 " + full + " 张，该期全站点合计 " + allN + " 张（另有 " + (allN - full) + " 张属于其它站点）";
          }
        } else {
          meta += " · 已合并全部站点（同一款只算一次）";
        }
        if (AUTO_ALL) {
          meta = "⚠ 所选站点（" + (viewSites() || []).join(" / ") + "）在这些期次里没有数据，已按全部站点显示 · " + meta;
        }
        if (ONLY !== "off") meta += " · " + onlyLabel() + "：" + list.length + " 张（该列共 " + full + " 张）";
        /* 该周在这个「国家 + 类目」下没有任何图 → 不输出这一列：
           各国家/类目的周度本来就不齐，留一个空列既难看又占宽；
           去掉后剩下的列由 flex 均分，1 列就铺满、2 列就两等分。 */
        if (!list.length) { dropped++; dropKind = "period"; dropNames.push(p); return; }
        var cards = list.slice(0, limit).map(function (it) {
          var mv = moveOf(it, p, prev, hasOf, rankOf, prevEmptyOf[p]);
          return cardHtml(it, { move: moveText(mv, it), isNew: mv.isNew, eager: opts.eager, eye: opts.eye, siteTag: !scopeSet });
        }).join("");
        html += poolHtml(p, meta, list.length, cards, opts.noFoot ? null : Math.min(limit, list.length));
        kept += list.length; cols++; poolKeys.push(p);
        /* 导出用清单：整列（不按「每列最多展示」截断），带站点 / 期次 / 类目 / 位次标签 */
        list.forEach(function (it) {
          EXPORT_ITEMS.push({
            url: it.image_url, label: moveText(moveOf(it, p, prev, hasOf, rankOf, prevEmptyOf[p]), it),
            site: it.site || siteName, period: p,
            cat: it.leaf_category || it.category || CAT || ""
          });
        });
      });
    }
    LAST_COLS = cols; LAST_COLS_MODE = MODE; LAST_KEPT = kept;
    LAST_POOL_KEYS = poolKeys; LAST_POOL_MODE = MODE; LAST_POOL_DROPPED = dropNames;
    return { html: html, maxLen: maxLen, kept: kept, cols: cols, dropped: dropped, dropKind: dropKind, dropNames: dropNames };
  }

  /* ---------------- 体征（三种对比模式通用） ----------------
     原来这块叫「类目体征」，只服务「类目对比」。现在纵向时间 / 横向国家也要看构成，
     所以改成「按当前并排的那一列各算一套指标」：
       横向 · 类目对比  → 每个类目一组（同一周 · 同一站点）
       横向 · 国家对比  → 每个国家一组（同一类目 · 同一周）
       纵向 · 时间对比  → 每一周一组（同一类目 · 同一国家）
     口径不变：**只比构成，不比张数**。
     张数取决于你这一期上传了多少图（上传量），不是热度；拿它横比会把"上传得多"误读成"卖得好"。
     所以所有横条都是百分比：三档标签占比 / 拍摄方式占比 / 元素标签出现率。 */
  /* 打标字段可能是数组，也可能是「模拍」这样的单个字符串（单值维度），统一成数组再统计 */
  function tagArr(v) {
    if (v == null) return [];
    if (Object.prototype.toString.call(v) === "[object Array]") {
      return v.filter(function (x) { return x != null && x !== ""; });
    }
    if (typeof v === "string") {
      return v.split(/[,，、|；;]/).map(function (x) { return String(x).trim(); }).filter(Boolean);
    }
    return [];
  }

  /* 当前模式下的「对比列」→ 每组一把待统计的图。
     与 buildPools 的列口径保持一致：列有哪几个，体征卡就有哪几张。 */
  function vitalsGroups() {
    var items = ((CACHE && CACHE.items) || []).filter(printOk);   /* 印花款开关同样管到体征卡与报告 */
    var periods = activePeriods();
    var pLast = periods[periods.length - 1] || "";
    var sites = poolSites();

    if (MODE === "c") {
      var _cV = viewSites();
      return activeCats().map(function (cat) {
        var mine = items.filter(function (it) {
          if ((it.category || "") !== cat) return false;
          if (_cV && _cV.indexOf(it.site) < 0) return false;
          return !pLast || pLabel(it.period_label) === pLast;
        });
        if (!_cV) mine = uniqByUrl(mine);
        return {
          key: cat, label: cat,
          empty: "该类目这一周没有上榜数据，下面的图片列会是空的 —— 换一周，或在上面取消勾选它。",
          items: mine
        };
      });
    }

    if (MODE === "h") {
      /* 选了地区 → 多国已经并成一列，没有第二个国家可比，比较块不出 */
      if (activeGroup()) return [];
      return sites.map(function (s) {
        return {
          key: s, label: s,
          empty: "这个国家这一周在这个类目下没有上榜数据。",
          items: items.filter(function (it) {
            return it.site === s && (!pLast || pLabel(it.period_label) === pLast);
          })
        };
      });
    }

    /* 纵向 · 时间对比：每一周一组（同一类目 · 同一站点；选了「全部站点」则合并） */
    var _vScope = viewSites();
    return periods.map(function (p) {
      var mine = items.filter(function (it) {
        if (_vScope && _vScope.indexOf(it.site) < 0) return false;
        return pLabel(it.period_label) === p;
      });
      if (!_vScope) mine = uniqByUrl(mine);
      return {
        key: p, label: p,
        empty: "这一周这个国家 / 类目没有上榜数据。",
        items: mine
      };
    });
  }

  function vitalsOfGroups(G) {
    return (G || []).map(function (g) {
      var mine = g.items || [];
      var n = mine.length;
      /* 这张卡属于哪个类目：类目对比取列名，其它模式取图上的类目，兜底用当前类目 */
      var _fitCat = (mine[0] && mine[0].category) || (MODE === "c" ? g.key : CAT) || "";
      var opp = 0, hot = 0, srg = 0;
      mine.forEach(function (it) {
        if (it._opp) opp++;
        if (it._hot) hot++;
        if (it._surge) srg++;
      });
      var pct = function (k, t) { return (t ? Math.round(k / t * 100) : 0); };
      /* 打标维度：分母只用「打过这个维度」的图，避免把"没打标"算成"其它" */
      var tagAny = 0;   /* 20261102H：至少有一个维度打了标的图数，用于报告里的覆盖率 */
      var sCnt = {}, sTot = 0, eCnt = {}, eTot = 0;
      var stCnt = {}, stTot = 0, vCnt = {}, vTot = 0, fCnt = {}, fTot = 0;
      /* 20261103E：视觉背景单独统计。
         导入时视觉三组分流写库：背景 → scene_tags，构图 + 主体 → visual_tags。
         报告却只读 visual_tags，于是「视觉背景」两张图里一条背景值都没有，
         全被算成「中性底·其它」——看起来就是"这一列没数据"。 */
      var bgCnt = {}, bgTot = 0;
      var cfCnt = {}, cfTot = 0, cuCnt = {}, cuTot = 0, psCnt = {}, psTot = 0;
      /* 20261102L：结构部件 / 面料进统计。这两个维度是商家真正能改的东西
         （拉链、口袋、荷叶边怎么加，面料选什么），过去只在画廊标签里能看到，
         报告里没参与对照，等于白打。 */
      var sdCnt = {}, sdTot = 0, fbCnt = {}, fbTot = 0, cfRawTot = 0;
      mine.forEach(function (it) {
        var t = TAG_INDEX[it.image_url];
        if (!t) return;
        if (tagArr(t.style_tags).length || tagArr(t.visual_tags).length || tagArr(t.scene_tags).length || tagArr(t.shoot_tags).length
          || tagArr(t.element_tags).length || tagArr(t.craft_tags).length || tagArr(t.fit_tags).length
          || tagArr(t.culture_tags).length || tagArr(t.psych_tags).length
          || tagArr(t.struct_tags).length || tagArr(t.fabric_tags).length) tagAny++;
        /* 同一张图同一个维度里若出现重复值，只算一次（否则占比会超过 100%） */
        var sSet = {}, nS = 0;
        tagArr(t.shoot_tags).forEach(function (v) { if (sSet[v] === undefined) { sSet[v] = 1; sCnt[v] = (sCnt[v] || 0) + 1; nS++; } });
        if (nS) sTot++;
        var eSet = {}, nE = 0;
        tagArr(t.element_tags).forEach(function (v) { if (eSet[v] === undefined) { eSet[v] = 1; eCnt[v] = (eCnt[v] || 0) + 1; nE++; } });
        if (nE) eTot++;
        /* 20261027K 新增的三个维度：风格 / 视觉 / 版型（版型存的是「领型·圆领」，展示时去掉前缀） */
        var stSet = {}, nSt = 0;
        tagArr(t.style_tags).forEach(function (v) { if (stSet[v] === undefined) { stSet[v] = 1; stCnt[v] = (stCnt[v] || 0) + 1; nSt++; } });
        if (nSt) stTot++;
        var vSet = {}, nV = 0;
        tagArr(t.visual_tags).forEach(function (v) { if (vSet[v] === undefined) { vSet[v] = 1; vCnt[v] = (vCnt[v] || 0) + 1; nV++; } });
        if (nV) vTot++;
        /* 背景：值形如「室内·客厅·电视墙」「室外·街头·墙面栏杆」，直接按值统计。
           20261103E：老数据的导入把背景和构图 / 主体一起塞进了 visual_tags，
           scene_tags 是空的。所以 scene_tags 没有值时，从 visual_tags 里按词表
           把背景值挑出来用，避免升级后背景一栏突然全空。 */
        var bgSet = {}, nBg = 0;
        bgValuesOf(t).forEach(function (k) {
          if (!k || bgSet[k] !== undefined) return;
          bgSet[k] = 1; bgCnt[k] = (bgCnt[k] || 0) + 1; nBg++;
        });
        if (nBg) bgTot++;
        var fSet = {}, nF = 0;
        tagArr(t.fit_tags).forEach(function (v) {
          /* 20261103D：只收本类目自己的部位，模特身上的裤子/裙子不计入 */
          var k = fitValOfFit(v, _fitCat);
          if (!k || fSet[k] !== undefined) return;
          fSet[k] = 1; fCnt[k] = (fCnt[k] || 0) + 1; nF++;
        });
        /* 20261027T 补：二次工艺 / 文化背景 / 消费心理 也要进体征卡，
           否则后台打了标，统计块里依然看不到，和"没生效"一样。 */
        /* 20261102V：「无工艺」不进工艺统计。
           它不是一个做法，写进推荐等于建议"别做工艺"，对商家没有意义。
           分母（cfTot）仍然算上这些图，所以刺绣 30% 还是 30%，不会被抬高。 */
        var cfSet = {}, nCf = 0, cfAny = 0;
        tagArr(t.craft_tags).forEach(function (v) {
          if (v !== null && v !== undefined && String(v) !== "") cfAny = 1;   /* 有标签就算进分母 */
          if (skill_none(v)) return;
          /* 20261102Z：印花 / 烫画 / 烫金 / 烫钻这类「图案复制类」整类不进统计，
             报告里不出现它们的数字（不只是不推荐）。分母仍按已打标图数算，
             所以刺绣 30% 还是 30%，不会被抬高。 */
          cfRawTot++;                    /* 记下"有工艺标签"，供判定是否为全图案类 */
          if (craftIsPrint(v)) return;
          if (cfSet[v] === undefined) { cfSet[v] = 1; cfCnt[v] = (cfCnt[v] || 0) + 1; nCf++; }
        });
        if (cfAny) cfTot++;
        var cuSet = {}, nCu = 0;
        tagArr(t.culture_tags).forEach(function (v) { if (cuSet[v] === undefined) { cuSet[v] = 1; cuCnt[v] = (cuCnt[v] || 0) + 1; nCu++; } });
        if (nCu) cuTot++;
        var psSet = {}, nPs = 0;
        tagArr(t.psych_tags).forEach(function (v) { if (psSet[v] === undefined) { psSet[v] = 1; psCnt[v] = (psCnt[v] || 0) + 1; nPs++; } });
        if (nPs) psTot++;
        /* 结构部件：值形如「拉链」「荷叶边」，直接按值统计 */
        var sdSet = {}, nSd = 0;
        tagArr(t.struct_tags).forEach(function (v) { if (sdSet[v] === undefined) { sdSet[v] = 1; sdCnt[v] = (sdCnt[v] || 0) + 1; nSd++; } });
        if (nSd) sdTot++;
        /* 面料：值可能是「纯棉（100%棉）」这类带括注的写法，按原样统计；
           同一张图若有多个候选，各算一次（分母是本维度已打标的图数） */
        var fbSet = {}, nFb = 0;
        tagArr(t.fabric_tags).forEach(function (v) { if (fbSet[v] === undefined) { fbSet[v] = 1; fbCnt[v] = (fbCnt[v] || 0) + 1; nFb++; } });
        if (nFb) fbTot++;
        if (nF) fTot++;
      });
      /* 20261102N：返回 [值, 占比, 张数]。第三个是「有多少张图带这个值」，
         建议里要写「3 张 / 12%」，只有百分比读者无法判断样本厚薄。 */
      var tops = function (obj, tot, lim) {
        if (!tot) return [];
        return Object.keys(obj).map(function (k) { return [k, Math.round(obj[k] / tot * 100), obj[k]]; })
          .sort(function (a, b) { return b[1] - a[1]; }).slice(0, lim);
      };
      /* 20261102Z：报告「全量数据」需要不截断的完整取值表，
         卡片与对照表仍用上面的 top3/top4（省地方），这里单独给一份 all。 */
      var allOf = function (obj, tot) { return tops(obj, tot, 1e9); };
      return {
        cat: g.label, key: g.key, empty: g.empty, n: n,
        all: {
          style: allOf(stCnt, stTot), visual: allOf(vCnt, vTot), shoot: allOf(sCnt, sTot),
          bg: allOf(bgCnt, bgTot),
          elems: allOf(eCnt, eTot), craft: allOf(cfCnt, cfTot), struct: allOf(sdCnt, sdTot),
          fabric: allOf(fbCnt, fbTot), fit: allOf(fCnt, fTot),
          culture: allOf(cuCnt, cuTot), psych: allOf(psCnt, psTot)
        },
        oppP: pct(opp, n), hotP: pct(hot, n), srgP: pct(srg, n),
        shoot: tops(sCnt, sTot, 4), elems: tops(eCnt, eTot, 3),
        style: tops(stCnt, stTot, 3), visual: tops(vCnt, vTot, 3), fit: tops(fCnt, fTot, 3), bg: tops(bgCnt, bgTot, 3),
        craft: tops(cfCnt, cfTot, 3), culture: tops(cuCnt, cuTot, 3), psych: tops(psCnt, psTot, 3),
        /* 有工艺标签、但全部是图案复制类（已整类剔除）→ 这一列没有可推荐的质感工艺 */
        printOnly: cfTot > 0 && cfRawTot > 0 && !Object.keys(cfCnt).length,
        struct: tops(sdCnt, sdTot, 3), fabric: tops(fbCnt, fbTot, 3),
        hasTag: sTot > 0 || eTot > 0 || stTot > 0 || cfTot > 0 || cuTot > 0 || psTot > 0 || sdTot > 0 || fbTot > 0 || bgTot > 0,
        tagged: sTot, tagAny: tagAny
      };
    });   /* 没上传的那一列也保留卡片：写「无数据」，不要静默消失 */
  }

  /* 每种对比模式的文案口径（差异洞察里要说清"比的是什么"） */
  function vitalsDim() {
    if (MODE === "h") return { noun: "国家", head: "这几个国家，差别在哪", same: "同一周内" };
    if (MODE === "v") return { noun: "周次", head: "这几周，差别在哪", same: "从上一周到这一周" };
    return { noun: "类目", head: "这一周，这几个类目差别在哪", same: "同一周内" };
  }

  /* 差异洞察：从体征里挑出「差距最大」的几条，直接给结论，不罗列数据。
     dim 决定文案里说"类目"还是"国家"还是"周次"，口径跟着当前对比模式走。 */
  function insightsOf(V, dim) {
    var out = [];
    dim = dim || vitalsDim();
    var noun = dim.noun;
    V = (V || []).filter(function (c) { return c.n > 0; });   /* 没数据的那一列不参与「差别在哪」的结论 */
    if (V.length < 2) return out;
    /* ① 拍摄方式落差：某一列某种拍法明显高于其余列均值（≥10 个百分点才值得说） */
    var withShoot = V.filter(function (c) { return c.shoot.length; });
    if (withShoot.length >= 2) {
      var keys = {};
      withShoot.forEach(function (c) { c.shoot.forEach(function (s) { keys[s[0]] = 1; }); });
      var best = null;
      Object.keys(keys).forEach(function (k) {
        var vals = withShoot.map(function (c) {
          var hit = c.shoot.filter(function (s) { return s[0] === k; })[0];
          return { cat: c.cat, v: hit ? hit[1] : 0 };
        });
        var mx = vals.slice().sort(function (a, b) { return b.v - a.v; })[0];
        var rest = vals.filter(function (x) { return x.cat !== mx.cat; });
        var avg = rest.length ? Math.round(rest.reduce(function (a, b) { return a + b.v; }, 0) / rest.length) : 0;
        var gap = mx.v - avg;
        if (!best || gap > best.gap) best = { k: k, cat: mx.cat, v: mx.v, avg: avg, gap: gap };
      });
      if (best && best.gap >= 10) {
        out.push("「" + best.cat + "」的" + best.k + "占 " + best.v + "%，比其余" + noun + "均值（" + best.avg + "%）高 " + best.gap + " 个百分点，呈现方式上更吃这一种。");
      }
    }
    /* ② 三档标签落差：最能解释"为什么这一列更热" */
    var defs = [["srgP", "周度激增"], ["hotP", "趋势爆款"], ["oppP", "潜力机会"]];
    var bestT = null;
    defs.forEach(function (d) {
      var sorted = V.slice().sort(function (a, b) { return b[d[0]] - a[d[0]]; });
      var mx = sorted[0], mn = sorted[sorted.length - 1];
      if (!mx || !mn || mx.cat === mn.cat) return;
      var gap = mx[d[0]] - mn[d[0]];
      if (!bestT || gap > bestT.gap) bestT = { key: d[0], name: d[1], hi: mx, lo: mn, gap: gap };
    });
    if (bestT && bestT.gap >= 4) {
      out.push("「" + bestT.hi.cat + "」的" + bestT.name + "占比 " + bestT.hi[bestT.key] + "%，是这几个" + noun + "里最高的；"
        + "「" + bestT.lo.cat + "」只有 " + bestT.lo[bestT.key] + "% —— " + dim.same + "，爆发款密度相差 " + bestT.gap + " 个百分点。");
    }
    /* ③ 首位元素独有性：只有它把这个元素排第一，辨识度就在这儿 */
    var withElem = V.filter(function (c) { return c.elems.length; });
    if (withElem.length >= 2) {
      withElem.forEach(function (c) {
        if (out.length >= 3) return;
        var top1 = c.elems[0][0];
        var others = withElem.filter(function (x) { return x.cat !== c.cat; });
        var inOthers = others.some(function (x) {
          return x.elems.some(function (e) { return e[0] === top1; });
        });
        if (!inOthers) {
          out.push("「" + c.cat + "」的首位元素是「" + top1 + "」（" + c.elems[0][1] + "%），其余" + noun + "都没把它排第一，辨识度主要来自这个细节。");
        }
      });
    }
    return out.slice(0, 3);
  }

  /* ============================================================
     20261102H：体征区块从「三列数据卡」升级为「一份可直读的报告」
     ------------------------------------------------------------
     原来的问题是：只有一堆百分比，读者要自己在脑子里做减法才知道
     "谁跟谁不一样、差多少、所以该怎么做"。现在按报告结构补四层：
       ① 报告头：口径（比的是什么）+ 样本量 + 打标覆盖率 + 生成时间
       ② 核心结论：带编号的判定句，全部由数据算出，不写套话
       ③ 横向对照：关键维度逐列并排，差值用 ▲/▼ 标出，一眼看出落差
       ④ 逐列画像 + 可执行建议 + 数据说明（样本不足要提示）
     数据层不动：全部复用 vitalsOfGroups 已算好的占比。
     ============================================================ */
  /* 20261102L：报告口径改为「面向商家」。
     商家能立刻改的只有四件事：加什么工艺、加什么结构件、版型怎么修、用什皮料/面料。
     所以对照表与结论只在这四个维度里挑重点，风格 / 视觉 / 拍摄方式退为参考项；
     图案与印花（元素 / 图案类型）不再进对照表，也不再出现在建议里 ——
     印花是设计端一次性决定的事，商家照着抄只会撞款。 */
  var REP_MERCH = [["二次工艺", "craft"], ["结构部件", "struct"], ["版型", "fit"], ["面料", "fabric"]];
  /* 对照表展示顺序：商家四维在前，参考项在后 */
  /* 20261103E：视觉背景单独成维（库里在 scene_tags），不再和构图 / 主体挤在一行 */
  var REP_DIMS = REP_MERCH.concat([["视觉背景", "bg"], ["视觉", "visual"], ["拍摄方式", "shoot"], ["风格", "style"]]);

  /* 20261102R：白底不参与推荐。
     纯白底 / 白背景是平台通用底，几乎每个类目都在用，把它当成"这一列的做法"
     推荐给商家，照做只是换成通用底，不产生任何差异，还会把真正有辨识度的背景盖掉。
     所以：结论的「差异最集中 / 独有打法」、可执行建议、画像句、对照表、趋势抬头
     一律剔除白底值；逐列画像的标签清单也不展示白底，
     原始标签仍可在逐张看图时查看。 */
  function isWhiteBg(v) { return /白底|纯白|白背景|白色背景/.test(String(v || "")); }
  /* 背景取值判定：新词表里的 125 个值、旧值别名、室内·/室外· 前缀都算 */
  function isBgValue(v) {
    var k = String(v == null ? "" : v).trim();
    if (!k) return false;
    if (/^(室内|室外)·/.test(k)) return true;
    var A = window.APP_ENUM || {};
    if ((A["视觉-背景"] || []).indexOf(k) >= 0) return true;
    if (A.bgAlias && A.bgAlias[k]) return true;
    return false;
  }
  /* 一张图的背景取值：优先 scene_tags；没有就从 visual_tags 里按词表挑 */
  function bgValuesOf(t) {
    if (!t) return [];
    var out = [], seen = {};
    var push = function (v) {
      var k = String(v == null ? "" : v).trim();
      if (!k || seen[k]) return;
      seen[k] = 1; out.push(k);
    };
    tagArr(t.scene_tags).forEach(push);
    if (out.length) return out;
    tagArr(t.visual_tags).forEach(function (v) { if (isBgValue(v)) push(v); });
    return out;
  }

  /* 背景值很长（室内·餐厅门店·卡座吧台），句子里的短引用去掉前缀即可 */
  function narrowBg(v) {
    return String(v == null ? "" : v).replace(/^(室内|室外)·/, "");
  }
  /* 取该维度第一个非白底值；rest 为其余非白底值，供并列列举用 */
  function repPick(list) {
    var arr = (list || []).filter(function (e) { return e && !isWhiteBg(e[0]); });
    return { top: arr[0] || null, rest: arr.slice(1) };
  }

  /* 某维度在「其余列」的最高占比，用来给某一格算落差 */
  function repOthersMax(V, self, key) {
    var mx = -1;
    (V || []).forEach(function (c) {
      if (c === self || !c.n) return;
      var t = key === "visual" ? repPick(c.visual).top
        : key === "bg" ? repPick(c.bg).top
        : (c[key] || [])[0];
      if (t && t[1] > mx) mx = t[1];
    });
    return mx;
  }

  /* 20261102Z：取该列的完整取值表（不截断）；老数据没有 all 时退回截断表 */
  function repAll(col, key) {
    if (!col) return [];
    var a = col.all && col.all[key];
    return (a && a.length) ? a : (col[key] || []);
  }

  /* 20261103F：全量数据表与背景文案会对「每个取值 × 每一列」反复取占比，
     原来每次都是一遍 filter（取值几百个 × 列若干 ⇒ 几十万次比较），
     报告因此明显发顿。改成每列每个维度先建一次索引表，之后 O(1) 命中。 */
  function repPctMap(col, key) {
    if (!col.__pct) col.__pct = {};
    if (col.__pct[key]) return col.__pct[key];
    var m = {};
    repAll(col, key).forEach(function (e) { if (e && e[0] != null) m[String(e[0])] = e[1]; });
    col.__pct[key] = m;
    return m;
  }
  function repCntMap(col, key) {
    if (!col.__cnt) col.__cnt = {};
    if (col.__cnt[key]) return col.__cnt[key];
    var m = {};
    repAll(col, key).forEach(function (e) { if (e && e[0] != null) m[String(e[0])] = e[2] || 0; });
    col.__cnt[key] = m;
    return m;
  }
  /* 某具体标签在某一列的占比（没有则 0）—— 必须查全量表，
     否则排在第 4 位之后的值会被算成 0% */
  function repTagPct(col, key, name) {
    var v = repPctMap(col, key)[String(name)];
    return v == null ? 0 : v;
  }

  function repScopeText(dim) {
    var parts = [];
    if (MODE === "c") parts.push("对比类目：" + (SEL_CATS && SEL_CATS.length ? SEL_CATS.join(" / ") : CAT));
    else if (MODE === "h") parts.push("对比国家：" + ((SEL_SITES && SEL_SITES.length) ? SEL_SITES.join(" / ") : "—"));
    else parts.push("对比周次：" + ((SEL_PERIODS && SEL_PERIODS.length) ? sortPeriods(SEL_PERIODS).join(" / ") : "—")
      + (PERIODS_AUTO ? "（最近 " + SEL_PERIODS.length + " 周 · 系统默认，在菜单里点选即可改）" : "（菜单勾选）"));
    if (MODE !== "c") parts.push("类目：" + (CAT || ALL));
    if (MODE === "v") parts.push("国家：" + ((SEL_SITES && SEL_SITES[0]) || "—"));
    var o = onlyLabel();
    if (o) parts.push(o);
    return parts.join("　·　");
  }

  /* ================= 图表层（20261102Q）
     报告要"看图就懂"，所以在结论与对照之间插入三类动态图表：
       ① 爆发密度对照：同一列三个点（潜力机会 / 趋势爆款 / 周度激增）
       ② 维度构成对照：每个商家维度一行一个值，点=各列占比，按列着色
       ③ 趋势动向落差：本列整体 → 抬头子集，用线连起来看拉升幅度
     全部纯 DOM/CSS，不引第三方图表库：不增体积、离线可用、导出 PDF 不掉图。
     动画用「暂停 → 播放」控制，折叠展开时才跑，切筛选重绘时自然重播。 */
  var REP_COLORS = ["#9c8b74", "#5b7f95", "#7d8f6a", "#a9705f", "#7c6b96", "#8f8a5e", "#6f7f8c"];
  function repColor(i) { return REP_COLORS[i % REP_COLORS.length]; }

  /* 点阵图：一行一个对象，每个点带百分比；connect=true 时把同行点连成线（落差图） */
  function repDotChart(o) {
    o = o || {};
    var rows = (o.rows || []).filter(function (r) { return r && r.dots && r.dots.length; });
    if (!rows.length) return "";
    var grid = [0, 25, 50, 75, 100].map(function (x) {
      return '<i class="rk-ch-gl" style="left:' + x + '%"></i>';
    }).join("");
    var legend = (o.legend || []).map(function (l) {
      return '<span class="rk-ch-lg"><em style="background:' + l.color + '"></em>' + esc(l.name) + "</span>";
    }).join("");
    var body = rows.map(function (r, ri) {
      var ds = r.dots.slice().sort(function (a, b) { return a.v - b.v; });
      /* 0% 的点贴在最左边，圆点会压到行标签上，所以把落点收进 1.2%~98.8%，
         数值本身不动（点旁标签仍显示真实百分比） */
      var clamp = function (v) { return Math.max(1.2, Math.min(98.8, Number(v) || 0)); };
      var line = "";
      if (o.connect && ds.length > 1) {
        var lo = clamp(ds[0].v), hi = clamp(ds[ds.length - 1].v);
        line = '<i class="rk-ch-conn" style="left:' + lo + "%;width:" + Math.max(0, hi - lo)
          + "%;--d:" + (0.06 * ri).toFixed(2) + 's"></i>';
      }
      var dots = ds.map(function (d, di) {
        var v = clamp(d.v);
        return '<i class="rk-ch-d' + (di % 2 ? " alt" : "") + '" style="left:' + v + "%;background:" + d.color
          + ";--d:" + (0.06 * ri + 0.05 * di).toFixed(2) + 's" title="'
          + esc((d.name || "") + " " + d.v + "%") + '"><u>' + Math.round(d.v) + "%</u></i>";
      }).join("");
      return '<div class="rk-ch-r"><span class="rk-ch-rl">' + esc(r.label)
        + (r.note ? '<em>' + esc(r.note) + "</em>" : "") + '</span>'
        + '<span class="rk-ch-t">' + grid + line + dots + "</span>"
        + (r.tail ? '<span class="rk-ch-tail">' + r.tail + "</span>" : "") + "</div>";
    }).join("");
    return '<div class="rk-ch"><div class="rk-ch-hd"><span class="rk-ch-title">' + esc(o.title || "")
      + "</span>" + (legend ? '<span class="rk-ch-legend">' + legend + "</span>" : "") + "</div>"
      + '<div class="rk-ch-axis"><span>0</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>'
      + '<div class="rk-ch-body">' + body + "</div>"
      + (o.foot ? '<p class="rk-ch-foot">' + o.foot + "</p>" : "")
      + "</div>";
  }

  /* ① 爆发密度图 */
  function repDensityChart(V) {
    var live = V.filter(function (c) { return c.n > 0; });
    if (live.length < 2) return "";
    return repDotChart({
      title: "图 1 · 爆发密度对照",
      legend: [{ name: "潜力机会", color: "#b8ab94" }, { name: "趋势爆款", color: "#5b7f95" }, { name: "周度激增", color: "#a9705f" }],
      rows: live.map(function (c) {
        return {
          label: c.cat, note: c.n + " 张",
          dots: [{ v: c.oppP, color: "#b8ab94", name: "潜力机会" },
                 { v: c.hotP, color: "#5b7f95", name: "趋势爆款" },
                 { v: c.srgP, color: "#a9705f", name: "周度激增" }]
        };
      }),
      foot: "点越靠右表示该档占比越高。周度激增那一档最靠右的列，新款式更容易跑出爆发款。"
    });
  }

  /* ② 商家四维构成对照：每维一张点阵图，点按列着色，直接看同一值在不同列的热度差 */
  function repDimCharts(V) {
    var live = V.filter(function (c) { return c.n > 0; });
    if (live.length < 2) return "";
    var legend = live.map(function (c, i) { return { name: c.cat, color: repColor(i) }; });

    /* 20261102S：四格网格里出现空位时用参考维度补上。
       商家四维里某一维暂时没有数据（例如面料还没打标）时，网格会空出一格，
       看起来像图表坏了。所以留一组后备维度按顺序补位：视觉 → 拍摄方式 → 风格。
       视觉补位时剔除白底（通用底，与报告其它位置口径一致）。 */
    var FALLBACK = [["视觉", "visual"], ["拍摄方式", "shoot"], ["风格", "style"]];

    var one = function (d) {
      var names = {};
      live.forEach(function (c) { repAll(c, d[1]).forEach(function (e) { names[e[0]] = 1; }); });
      var keys = Object.keys(names).map(function (nm) {
        var mx = 0;
        live.forEach(function (c) { mx = Math.max(mx, repTagPct(c, d[1], nm)); });
        return { nm: nm, mx: mx };
      }).filter(function (k) {
        if (!(k.mx > 0)) return false;
        if (d[1] === "visual" && isWhiteBg(k.nm)) return false;
        return true;
      }).sort(function (a, b) { return b.mx - a.mx; });
      if (!keys.length) return "";
      return repDotChart({
        title: "图 · " + d[0],
        legend: legend,
        rows: keys.map(function (k) {
          return {
            label: k.nm, note: "最高 " + k.mx + "%",
            dots: live.map(function (c, i) {
              return { v: repTagPct(c, d[1], k.nm), color: repColor(i), name: c.cat };
            })
          };
        })
      });
    };

    var out = "", shown = 0, used = {};
    REP_MERCH.forEach(function (d) {
      var h = one(d);
      if (!h) return;
      used[d[1]] = 1; out += h; shown++;
    });
    FALLBACK.forEach(function (d) {
      if (shown >= REP_MERCH.length) return;
      if (used[d[1]]) return;
      var h = one(d);
      if (!h) return;
      out += h; shown++;
    });
    if (!out) return "";
    return '<div class="rk-ch-grid">' + out + "</div>";
  }

  /* 20261102T：视觉背景单独成节分析。
     视觉这一维在报告里原本只是"补位参考"，但背景恰恰是商家最容易低成本改、
     也最容易一眼看出区别的一维（同一件衣服换场景，转化差异很明显）。
     所以把「视觉-背景」拆成两组图 + 一段解读：
       图 A：室内 / 室外 / 中性底 的大类构成，看这一列整体调性
       图 B：具体背景值 TOP5，看具体用了哪些场景
     白底仍按 20261102R 的口径剔除（通用底，不参与比较与推荐）。 */
  var REP_BG_GROUP = ["室外", "室内", "中性底·其它"];
  var BG_TOP = 24;                 /* 具体背景值最多列这么多行，与右侧文化图保持相近高度 */
  function repBgGroups(c) {
    var o = { "室外": 0, "室内": 0, "中性底·其它": 0 };
    (c.bg || []).forEach(function (e) {
      var nm = String(e[0] || "");
      if (isWhiteBg(nm)) return;
      if (nm.indexOf("室外·") === 0) o["室外"] += (e[1] || 0);
      else if (nm.indexOf("室内·") === 0) o["室内"] += (e[1] || 0);
      else o["中性底·其它"] += (e[1] || 0);
    });
    return o;
  }

  function repBgCharts(V) {
    var live = V.filter(function (c) { return c.n > 0; });
    if (!live.length) return "";
    var legend = live.map(function (c, i) { return { name: c.cat, color: repColor(i) }; });
    var out = "";

    /* 20261104D：只留具体值，不再先画「室内 / 室外」母结构。
       母结构只有三行，看完仍不知道该搭什么景；商家要的是「街道·沥青路面」
       这种能照着拍的值，所以直接给具体值。 */
    /* 具体背景值（全量，20261102Z 起不再只取前 5） */
    var names = {};
    live.forEach(function (c) {
      repAll(c, "bg").forEach(function (e) { if (!isWhiteBg(e[0])) names[e[0]] = 1; });
    });
    var keys = Object.keys(names).map(function (nm) {
      var mx = 0;
      live.forEach(function (c) { mx = Math.max(mx, repTagPct(c, "bg", nm)); });
      return { nm: nm, mx: mx };
    }).filter(function (k) { return k.mx > 0; })
      .sort(function (a, b) { return b.mx - a.mx; });
    if (keys.length) {
      var cutBg = keys.length > BG_TOP;
      out += repDotChart({
        title: cutBg ? "图 · 视觉背景（具体取值 · 前 " + BG_TOP + "）" : "图 · 视觉背景（具体取值）",
        legend: legend,
        rows: keys.slice(0, BG_TOP).map(function (k) {
          return {
            /* 保留「室内·/室外·」前缀：母结构没了，这个前缀就是判断取景的唯一线索 */
            label: k.nm, note: "最高 " + k.mx + "%",
            dots: live.map(function (c, i) {
              return { v: repTagPct(c, "bg", k.nm), color: repColor(i), name: c.cat };
            })
          };
        }),
        foot: cutBg
          ? "共 " + keys.length + " 个具体取值，图上按最高占比列前 " + BG_TOP + " 个，其余见「全量数据」；纯白底属平台通用底，不计入。"
          : "占比以该列「已打标视觉背景」的图作分母；纯白底属平台通用底，不计入。"
      });
    }
    if (!out) return "";

    var txt = repBgText(live);
    return '<div class="rk-bg-block"><h5>视觉背景</h5>'
      + (txt ? '<p class="rk-bg-say">' + txt + "</p>" : "")
      + '<div class="rk-ch-grid">' + out + "</div></div>";
  }

  /* 视觉背景的解读：只说能改的东西（场景换一换），不下"必须重拍"的结论 */
  function repBgText(live) {
    if (live.length < 2) return "";
    var parts = [];
    /* 具体场景：找跨列最高的那个值 */
    var names = {};
    live.forEach(function (c) {
      (c.bg || []).forEach(function (e) { if (!isWhiteBg(e[0])) names[e[0]] = 1; });
    });
    var best = null;
    Object.keys(names).forEach(function (nm) {
      var mx = 0, who = "";
      live.forEach(function (c) {
        var v = repTagPct(c, "bg", nm);
        if (v > mx) { mx = v; who = c.cat; }
      });
      if (mx > 0 && (!best || mx > best.p)) best = { nm: nm, p: mx, who: who };
    });
    if (best) {
      parts.push("具体场景里最常见的是「" + esc(best.nm) + "」，在「" + esc(best.who) + "」占到 " + Math.round(best.p) + "%。"
        + "背景是成本最低的差异点，可优先考虑沿用这一列的取景方式；换场景前建议先确认新场景不增加拍摄与场地成本。");
    }
    if (!parts.length) return "";
    return parts.join("");
  }

  /* 20261104A：详情报告里这一节从「视觉背景」换成「文化背景」。
     背景回答"在哪拍的"，文化背景回答"这身衣服属于哪个圈层、卖给谁"，
     后者直接决定标题与卖点怎么写，更值得单独一节。
     背景没有删：逐列画像、横向对照、全量数据里仍按原样呈现。 */
  var CU_NEUTRAL = "无特定文化";   /* 中性值，不算文化定位，剔除出分母 */
  var CU_TOP = 24;                 /* 全部取值图最多列这么多行，再多就看不清 */

  function cuMother(v) {
    var s = String(v || "");
    var i = s.indexOf("-");
    return i > 0 ? s.slice(0, i) : s;
  }

  /* 母文化占比 = 其下所有子文化之和（「无特定文化」不进分母） */
  function repCuGroups(c) {
    var o = {};
    repAll(c, "culture").forEach(function (e) {
      var nm = String((e && e[0]) || "");
      if (!nm || nm === CU_NEUTRAL) return;
      var k = cuMother(nm);
      o[k] = (o[k] || 0) + (Number(e[1]) || 0);
    });
    return o;
  }

  function repCuCharts(V) {
    var live = V.filter(function (c) { return c.n > 0; });
    if (!live.length) return "";
    var legend = live.map(function (c, i) { return { name: c.cat, color: repColor(i) }; });
    var out = "";

    /* 20261104D：只留具体取值，不再先画母文化结构（「美式文化」这种大词
       落不到选款上，要看的是「美式文化-复古90s街头」这一层）。 */
    var names = {};
    live.forEach(function (c) {
      repAll(c, "culture").forEach(function (e) {
        var nm = String((e && e[0]) || "");
        if (nm && nm !== CU_NEUTRAL) names[nm] = 1;
      });
    });
    var keys = Object.keys(names).map(function (nm) {
      var mx = 0;
      live.forEach(function (c) { mx = Math.max(mx, repTagPct(c, "culture", nm)); });
      return { nm: nm, mx: mx };
    }).filter(function (k) { return k.mx > 0; })
      .sort(function (a, b) { return b.mx - a.mx; });
    if (keys.length) {
      var cut = keys.length > CU_TOP;
      out += repDotChart({
        title: cut ? "图 · 文化背景（具体取值 · 前 " + CU_TOP + "）" : "图 · 文化背景（具体取值）",
        legend: legend,
        rows: keys.slice(0, CU_TOP).map(function (k) {
          return {
            label: k.nm, note: "最高 " + Math.round(k.mx) + "%",
            dots: live.map(function (c, i) {
              return { v: Math.round(repTagPct(c, "culture", k.nm)), color: repColor(i), name: c.cat };
            }),
          };
        }),
        foot: cut
          ? "共 " + keys.length + " 个取值，图上按最高占比列前 " + CU_TOP + " 个，其余见「全量数据」。"
          : "「" + CU_NEUTRAL + "」不展示——它表示这张图没有明确文化指向，不属于某个圈层。",
      });
    }

    if (!out) return "";
    var say = repCuText(live);
    return '<div class="rk-cu-block"><h5>文化背景</h5>'
      + (say ? '<p class="rk-cu-say">' + say + "</p>" : "")
      + '<div class="rk-ch-grid">' + out + "</div></div>";
  }

  /* 文化背景解读：哪个圈层最集中、具体落到哪个细分、多少图没有文化指向 */
  function repCuText(live) {
    if (!live.length) return "";
    var parts = [];
    /* 20261104D：母文化不画了，解读也直接说具体圈层：
       每列取占比最高的「具体文化值」（带 "-" 的细分），再看跨列谁最集中。 */
    var seg = live.map(function (c) {
      var top = null;
      repAll(c, "culture").forEach(function (e) {
        var nm = String((e && e[0]) || "");
        if (!nm || nm === CU_NEUTRAL) return;
        var v = Number(e[1]) || 0;
        if (v > 0 && (!top || v > top.p)) top = { k: nm, p: v };
      });
      return { cat: c.cat, top: top };
    }).filter(function (x) { return x.top && x.top.p > 0; });

    if (seg.length >= 2) {
      var hi = seg.slice().sort(function (a, b) { return b.top.p - a.top.p; })[0];
      var lo = seg.slice().sort(function (a, b) { return a.top.p - b.top.p; })[0];
      var gap = Math.round(hi.top.p - lo.top.p);
      if (gap <= 0 && seg.length >= 2) {
        /* 两列集中度打平：别硬说"最高 / 只有"，把前两列并列写出来 */
        var p1 = seg[0], p2 = seg[1];
        parts.push("两列文化指向的集中度相当：「" + esc(p1.cat) + "」是<b>" + esc(p1.top.k) + "</b>占 "
          + Math.round(p1.top.p) + "%，「" + esc(p2.cat) + "」是<b>" + esc(p2.top.k) + "</b>占 "
          + Math.round(p2.top.p) + "%。");
      } else if (hi.cat !== lo.cat) {
        parts.push("文化指向最集中在「" + esc(hi.cat) + "」——<b>" + esc(hi.top.k) + "</b>占 "
          + Math.round(hi.top.p) + "%；「" + esc(lo.cat) + "」这一列最集中的 " + esc(lo.top.k)
          + " 只有 " + Math.round(lo.top.p) + "%，两列相差 " + gap + " 个百分点。");
      } else {
        parts.push("「" + esc(hi.cat) + "」的文化指向最集中，<b>" + esc(hi.top.k) + "</b>占 "
          + Math.round(hi.top.p) + "%。");
      }
    }

    /* 细分到「母-子」层的那个值单独点一句：它比任何母类都更接近选款决策 */
    var best = null;
    live.forEach(function (c) {
      repAll(c, "culture").forEach(function (e) {
        var nm = String((e && e[0]) || "");
        if (!nm || nm === CU_NEUTRAL) return;
        if (nm.indexOf("-") < 0) return;
        var v = Number(e[1]) || 0;
        if (v > 0 && (!best || v > best.p)) { best = { nm: nm, p: v, cat: c.cat }; }
      });
    });
    if (best && !(seg[0] && seg[0].top && seg[0].top.k === best.nm)) {
      parts.push("细分到圈层，最常见的是「" + esc(best.nm) + "」，在「" + esc(best.cat) + "」占 "
        + Math.round(best.p) + "%。");
    }

    /* 没有文化指向的比例：这部分要靠风格与图案区分，别硬套文化标签 */
    var neu = 0, neuCat = "";
    live.forEach(function (c) {
      var v = repTagPct(c, "culture", CU_NEUTRAL);
      if (v > neu) { neu = v; neuCat = c.cat; }
    });
    if (neu >= 30) {
      parts.push("有 " + Math.round(neu) + "% 的图（「" + esc(neuCat) + "」最多）属于「" + CU_NEUTRAL
        + "」，这类款不必硬套文化标签，靠风格与图案区分就够。");
    }

    if (!parts.length) return "";
    parts.push("文化背景是推断维度，可当选题线索用；写标题、做主图文案时点明圈层会更容易被认出来。"
      + "涉及宗教、神话图腾这类符号时，建议先确认目标市场能不能接受，别为差异化冒犯到人。");
    return parts.join("");
  }

  /* 覆盖率环：SVG 圆环，展开时描边动画一次 */
  function repRing(pct) {
    var C = 2 * Math.PI * 26;
    var p = Math.max(0, Math.min(100, pct || 0));
    var off = C * (1 - p / 100);
    return '<span class="rk-kpi-ring"><svg viewBox="0 0 64 64" aria-hidden="true">'
      + '<circle class="rk-ring-bg" cx="32" cy="32" r="26"/>'
      + '<circle class="rk-ring-v" cx="32" cy="32" r="26" transform="rotate(-90 32 32)" style="--c:'
      + C.toFixed(1) + ";--o:" + off.toFixed(1) + '"/>'
      + "</svg><b>" + p + "%</b></span>";
  }

  /* ① 报告头：口径 + 样本 + 覆盖率 + 时间 */
  function repHeadHtml(V, dim) {
    var sum = 0, tagged = 0;
    V.forEach(function (c) { sum += c.n || 0; tagged += (c.tagAny || 0); });
    var cov = sum ? Math.round(tagged / sum * 100) : 0;
    var now = new Date();
    var pad = function (x) { return (x < 10 ? "0" : "") + x; };
    var ts = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate())
      + " " + pad(now.getHours()) + ":" + pad(now.getMinutes());
    return '<div class="rk-rep-head">'
      + '<div class="rk-rep-title">趋势构成分析报告<span class="rk-rep-sub">' + esc(dim.head)
      + ' · 商家视角（工艺 / 结构部件 / 版型 / 面料）</span></div>'
      + '<div class="rk-rep-meta">'
      + '<span>' + esc(repScopeText(dim)) + '</span>'
      + '<span>分组 <b>' + esc(V.map(function (c) { return c.cat; }).join(" / ")) + '</b></span>'
      + (LAST_POOL_DROPPED && LAST_POOL_DROPPED.length
        ? '<span>已折叠 <b>' + LAST_POOL_DROPPED.length + '</b> 个无数据列（' + esc(LAST_POOL_DROPPED.join(" / ")) + '），未参与对比</span>'
        : '')
      + '<span>样本 <b>' + sum + '</b> 张上榜图</span>'
      + '<span>生成于 ' + ts + '</span>'
      + '</div>'
      + '<div class="rk-rep-kpi">'
      +   '<div class="rk-kpi rk-kpi-ring-card">' + repRing(cov)
      +     '<span class="rk-kpi-t"><b>打标覆盖</b><em>' + tagged + ' / ' + sum + ' 张带标签</em></span></div>'
      +   '<div class="rk-kpi"><span class="rk-kpi-n">' + sum + '</span>'
      +     '<span class="rk-kpi-t"><b>样本张数</b><em>参与本次对比的上榜图</em></span></div>'
      +   '<div class="rk-kpi"><span class="rk-kpi-n">' + V.length + '</span>'
      +     '<span class="rk-kpi-t"><b>对比列数</b><em>' + esc(dim.noun) + '维度并列</em></span></div>'
      + '</div>'
      + '</div>';
  }

  /* ② 核心结论：每条都是"判定 + 依据"，不出现没有数字的形容词 */
  function repSummaryHtml(V, dim) {
    var live = V.filter(function (c) { return c.n > 0; });
    if (live.length < 2) return "";
    var items = [];

    /* 结论 1：爆发密度最高的一列（周度激增 → 趋势爆款 → 潜力机会 依次兜底） */
    var dens = null;
    [["srgP", "周度激增"], ["hotP", "趋势爆款"], ["oppP", "潜力机会"]].forEach(function (d) {
      if (dens) return;
      var sorted = live.slice().sort(function (a, b) { return b[d[0]] - a[d[0]]; });
      var mx = sorted[0], mn = sorted[sorted.length - 1];
      if (mx && mn && mx[d[0]] > 0 && (mx[d[0]] - mn[d[0]]) >= 3) dens = { key: d[0], name: d[1], hi: mx, lo: mn };
    });
    if (dens) {
      items.push("<b>" + esc(dens.hi.cat) + "</b> 的爆发密度最强：" + dens.name + "占 " + dens.hi[dens.key]
        + "%，比最低的「" + esc(dens.lo.cat) + "」（" + dens.lo[dens.key] + "%）高 "
        + (dens.hi[dens.key] - dens.lo[dens.key]) + " 个百分点，新款式更容易在这一列跑出来。");
    } else {
      var top = live.slice().sort(function (a, b) { return b.n - a.n; })[0];
      items.push("各列爆发密度接近，没有单列明显占优；<b>" + esc(top.cat) + "</b> 上榜量最大（" + top.n + " 张），可作为基准盘观察。");
    }

    /* 结论 2：最有辨识度的维度——找出跨列落差最大的「同一维度顶级标签」 */
    var sig = null;
    REP_MERCH.concat([["风格", "style"], ["视觉", "visual"]]).forEach(function (d) {
      var names = {};
      live.forEach(function (c) { (c[d[1]] || []).forEach(function (e) { names[e[0]] = 1; }); });
      Object.keys(names).forEach(function (nm) {
        /* 白底属通用底，不参与「差异最集中」的评选 */
        if (d[1] === "visual" && isWhiteBg(nm)) return;
        var vals = live.map(function (c) { return { cat: c.cat, v: repTagPct(c, d[1], nm) }; });
        var mx = vals.slice().sort(function (a, b) { return b.v - a.v; })[0];
        if (!mx || !mx.v) return;
        var rest = vals.filter(function (x) { return x.cat !== mx.cat; });
        var avg = rest.length ? Math.round(rest.reduce(function (a, b) { return a + b.v; }, 0) / rest.length) : 0;
        var gap = mx.v - avg;
        if (!sig || gap > sig.gap) sig = { dimName: d[0], name: nm, cat: mx.cat, v: mx.v, avg: avg, gap: gap };
      });
    });
    if (sig && sig.gap >= 8) {
      items.push("差异最集中在<b>" + sig.dimName + "</b>：「" + esc(sig.name) + "」在「" + esc(sig.cat)
        + "」占 " + sig.v + "%，其余" + dim.noun + "平均只有 " + sig.avg + "%（高出 " + sig.gap
        + " 个百分点）——这是该列最可复用的一条做法，直接对着改就行。");
    }

    /* 结论 3：各列独有标签（只有它出现），说明是对手的空白区 */
    var solo = [];
    live.forEach(function (c) {
      REP_MERCH.forEach(function (d) {
        if (solo.length >= 2) return;
        var t = (c[d[1]] || [])[0];
        if (!t || t[1] < 12) return;
        var othersHave = live.some(function (x) {
          if (x === c) return false;
          return (x[d[1]] || []).some(function (e) { return e[0] === t[0]; });
        });
        if (!othersHave) solo.push("「" + esc(c.cat) + "」的" + d[0] + "首位是「" + esc(t[0]) + "」（" + t[1] + "%），其余" + dim.noun + "都没进前列，属独有打法。");
      });
    });
    solo.forEach(function (s) { items.push(s); });

    /* 结论 4：样本量提示——小样本的百分比不能当结论用 */
    var small = live.filter(function (c) { return c.n < 30; });
    if (small.length) {
      items.push("注意：" + small.map(function (c) { return esc(c.cat) + "（" + c.n + " 张）"; }).join("、")
        + " 样本不足 30 张，其百分比波动较大，只作方向参考。");
    }
    if (!items.length) return "";
    return '<section class="rk-rep-sec rk-rep-sum"><h4><em>一</em>核心结论</h4><ol>'
      + items.slice(0, 5).map(function (t) { return "<li>" + t + "</li>"; }).join("")
      + "</ol></section>";
  }

  /* ③-0 逐列画像句：把四个首位维度串成一句可读的话，替代让读者自己拼 */
  function repProfile(c, V) {
    if (!c.n) return "";
    var seg = [];
    var cf = (c.craft || [])[0], sd = (c.struct || [])[0], ft = (c.fit || [])[0], fb = (c.fabric || [])[0];
    /* 20261102L：画像句改成商家口径 —— 先说"能改的四件事"（工艺 / 结构件 / 版型 / 面料），
       视觉怎么拍放最后一句补，印花不作为画像主线。 */
    if (cf) seg.push("工艺主打「" + cf[0] + "」（" + cf[1] + "%）");
    if (sd) seg.push("结构件集中在「" + sd[0] + "」（" + sd[1] + "%）");
    if (ft) seg.push("版型以「" + ft[0] + "」为主（" + ft[1] + "%）");
    if (fb) seg.push("面料多为「" + fb[0] + "」（" + fb[1] + "%）");
    var vbg = repPick(c.bg).top;
    if (vbg) seg.push("背景多是「" + narrowBg(vbg[0]) + "」（" + vbg[1] + "%）");
    var vs = repPick(c.visual).top, sh = (c.shoot || [])[0];
    if (vs && sh) seg.push("画面偏「" + vs[0] + "」、多为" + sh[0]);
    else if (vs) seg.push("画面偏「" + vs[0] + "」");
    else if (sh) seg.push("呈现多为" + sh[0]);
    if (!seg.length) return "";
    var tail = "";
    if (c.srgP >= 10) tail = "爆发密度偏高，值得优先跟。";
    else if (c.oppP >= 50 && c.hotP <= 10) tail = "有量但缺爆点，需要差异化。";
    else if (c.hotP >= 15) tail = "爆款密度在这几列里靠前。";
    return '<p class="rk-vit-prof">' + esc(seg.join("，")) + "。" + esc(tail) + "</p>";
  }

  /* ③ 横向对照表：维度 × 各列 TOP1，用 ▲/▼ 标出与其余列的落差 */
  function repMatrixHtml(V, dim) {
    var live = V.filter(function (c) { return c.n > 0; });
    if (live.length < 2) return "";
    var rows = "";
    REP_DIMS.forEach(function (d) {
      var any = live.some(function (c) { return (c[d[1]] || []).length; });
      if (!any) return;
      var tds = live.map(function (c) {
        /* 视觉行取非白底值；整列都是白底就留空，不把通用底放进对照表 */
        var t = (d[1] === "visual" || d[1] === "bg")
          ? repPick(d[1] === "bg" ? c.bg : c.visual).top
          : (c[d[1]] || [])[0];
        if (!t) return '<td class="na">—</td>';
        var om = repOthersMax(V, c, d[1]);
        var mark = "";
        if (om >= 0) {
          var gap = t[1] - om;
          if (gap >= 8) mark = '<i class="up">▲' + gap + '</i>';
          else if (gap <= -8) mark = '<i class="down">▼' + Math.abs(gap) + '</i>';
        }
        /* 20261102Q：单元格里补一条占比底纹条，扫一眼就能比大小 */
        return '<td><span class="rk-cell"><span class="rk-cell-k">' + esc(t[0]) + ' <b>' + t[1]
          + '%</b>' + mark + '</span><i class="rk-cell-bar"><u style="--w:' + Math.min(100, t[1])
          + '%"></u></i></span></td>';
      }).join("");
      rows += '<tr><th>' + esc(d[0]) + "</th>" + tds + "</tr>";
    });
    if (!rows) return "";
    var head = live.map(function (c) { return "<th>" + esc(c.cat) + '<span class="rk-rep-th-n">' + c.n + " 张</span></th>"; }).join("");
    return '<section class="rk-rep-sec"><h4><em>二</em>关键维度横向对照</h4>'
      + '<p class="rk-rep-note">每格为该' + esc(dim.noun) + '的<b>首位标签</b>及其占比；▲/▼ 表示与其余' + esc(dim.noun)
      + '首位标签相比高/低多少个百分点（≥8 才标注）。</p>'
      + '<div class="rk-rep-tbl-wrap"><table class="rk-rep-tbl"><thead><tr><th>维度</th>' + head + "</tr></thead><tbody>"
      + rows + "</tbody></table></div></section>";
  }

  /* ④ 可执行建议：只按数据触发，宁缺毋滥。
     20261102L：全部换成商家能直接落地的动作（工艺 / 结构部件 / 版型 / 面料），
     并把「用某个印花元素做区分」整条删掉 —— 印花是设计端一次性的决定，
     商家照抄只会撞款，不该出现在采购侧的建议里。
     20261102N：每条补上「几张 / 多少占比」与「次选是什么」。
     20261102O：语气从"命令"改回"推荐"。
       这些结论是从一批上榜图的构成里推出来的取舍，不是板上钉钉的做法 ——
       所以不再写「直接」「必须」「别」「不要」，改用「可优先考虑 / 值得试 / 前提是」，
       并且每条都带上它成立的条件与代价。占比本身也不是绝对口径：
       36% 只能说"出现最多"，不能说"就该这么做"。 */
  function pctTxt(t) {
    if (!t) return "";
    return "<b>" + esc(t[0]) + "</b>（" + t[1] + "%，" + (t[2] || 0) + " 张）";
  }
  function listTxt(arr, skip, lim) {
    var out = (arr || []).filter(function (x) { return x[0] !== skip; }).slice(0, lim || 2)
      .map(function (x) { return esc(x[0]) + " " + x[1] + "%"; });
    return out.length ? "（同列还有 " + out.join(" / ") + "）" : "";
  }
  /* 「其余列最高多少」只在真的低于本列时才写出来；
     否则会出现「出现率 65%（其余最高仅 75%）」这种自相矛盾的句子。 */
  function othersTxt(V, c, key, p) {
    var mx = repOthersMax(V, c, key);
    if (mx < 0) return "";
    if (mx < p) return "，其余" + "列最高 " + mx + "%";
    if (mx > p) return "，其余列有的到 " + mx + "%";
    return "，与其余列基本持平";
  }

  /* 20261102P：二次工艺里区分「图案复制类」与「质感结构类」。
     印花、烫画、烫金、烫钻这些本质是把图案贴到布上，跟印花是一回事：
     只换图案、不换质感，撞款概率最高。商家要的是能拉开差异的工艺，
     所以推荐时把刺绣、洗水、压褶、绗缝、毛边、铆钉这类排在前面，
     图案类只在没有非图案候选时降级提一句，并说明它不解决质感问题。 */
  /* 「无工艺 / 无二次工艺 / 无」这类占位值不是做法，统计与推荐里一律不出现 */
  function skill_none(v) { return /^\s*无/.test(String(v || "")) || /无工艺/.test(String(v || "")); }

  function craftIsPrint(v) {
    /* 20261102Z：「图案复制类」判定补全 —— 数码印花 / 烫画 / 丝印 / 胶印 / 升华 等都属同一类，
       本质是把图案贴到布上，不改变面料质感与手感。 */
    return /印花|喷绘|喷墨|拔印|局部印|满印|烫图|烫画|热转印|转移印|烫印|烫金|烫银|烫钻|水钻|镭射|夜光|反光印|植绒印|丝印|丝网|胶印|升华|数码印/.test(String(v || ""));
  }
  /* 挑工艺：非图案类优先，图案类只留一个作补充 */
  function pickCraft(list) {
    var arr = (list || []).slice();
    arr = arr.filter(function (x) { return !skill_none(x[0]); });
    var other = arr.filter(function (x) { return !craftIsPrint(x[0]); });
    var pr = arr.filter(function (x) { return craftIsPrint(x[0]); });
    return {
      other: other, print: pr,
      main: other[0] || pr[0] || null,
      onlyPrint: !other.length && !!pr.length
    };
  }

  /* 20261103H：可执行建议只写最近一周。
     时间对比下原来每周各给一组（W42 / W43 / W44 三套几乎一样的建议），
     既长又难用 —— 结论本该只对"现在"负责。
     现在只取最新一周那一列给建议，其余周次不再罗列（数据仍在上面的对照表里）。 */
  function repLatestWeekCols(V) {
    var live = (V || []).filter(function (c) { return c.n > 0; });
    if (MODE !== "v" || live.length <= 1) return { cols: live, latest: "", dropped: [] };
    var ps = sortPeriods(live.map(function (c) { return String(c.key || ""); }));
    var latest = ps[ps.length - 1] || "";
    var keep = live.filter(function (c) { return String(c.key || "") === latest; });
    if (!keep.length) {
      /* 最新一周没有数据就往前退到最近有数据的那一周，不能让建议整段消失 */
      for (var i = ps.length - 1; i >= 0 && !keep.length; i--) {
        latest = ps[i];
        keep = live.filter(function (c) { return String(c.key || "") === latest; });
      }
    }
    return {
      cols: keep,
      latest: latest,
      dropped: live.map(function (c) { return String(c.cat || c.key || ""); })
        .filter(function (x, i, a) { return x !== latest && a.indexOf(x) === i; })
    };
  }

  function repActionHtml(V, dim) {
    var _pick = repLatestWeekCols(V);
    var live = _pick.cols;
    if (!live.length) return "";
    var out = [];
    live.forEach(function (c) {
      var nm = "「" + esc(c.cat) + "」";
      /* 二次工艺：先挑质感结构类（刺绣 / 洗水 / 压褶 …），图案复制类降级 */
      var ck = pickCraft(c.craft);
      if (ck.other.length && ck.other[0][1] >= 20) {
        var prtOne = null;   /* 20261102Z：图案复制类已在统计层剔除，不再作为补充说明出现 */
        out.push(nm + "的二次工艺里，质感类出现最多的是 " + pctTxt(ck.other[0])
          + listTxt(ck.other, ck.other[0][0], 2)
          + (prtOne ? "；印花 / 烫画类也有 " + esc(prtOne[0]) + "（" + prtOne[1] + "%），但那只是把图案贴到布上、不增加质感差异" : "")
          + "。若要找加价点，可优先考虑刺绣、洗水、压褶这类能看出工艺感的；前提是工厂能做、且不额外增加合规成本"
          + "（占比只说明它在上榜图里常见，不是非加不可）。");
      } else if (ck.other.length) {
        /* 占比不高但确有工艺：照样推荐，只是把"参考"讲清楚，不夸大成主做法 */
        out.push(nm + "的二次工艺里，质感类出现最多的是 " + pctTxt(ck.other[0])
          + listTxt(ck.other, ck.other[0][0], 2)
          + "，占比不高，只作方向参考。若想在这一维做出差异，可优先从这类能看出工艺感的方向试"
          + "（前提是工厂能做、且不额外增加合规成本）。");
      }
      /* 只有图案类工艺的列：这类值已不在报告数据里，就不给工艺建议，
         改为一句中性的补空白提示，避免读者以为"这一列没有工艺"就是结论。 */
      else if (c.printOnly || ck.onlyPrint) {
        out.push(nm + "的二次工艺在上榜图里只有图案复制类（不展示），这类工艺只换图案、不带来质感差异。"
          + "若想在这一维做区分，可考虑往刺绣 / 压褶 / 洗水 / 毛边这些方向试"
          + "（本列暂时没有这类工艺的数据支撑，属于补空白的思路，不是结论）。");
      }
      /* 结构部件：改动小、不牵动版型，性价比通常最高 */
      var sd = (c.struct || [])[0];
      if (sd && sd[1] >= 20) {
        out.push(nm + "的结构部件里 " + pctTxt(sd) + " 出现最多"
          + othersTxt(V, c, "struct", sd[1])
          + listTxt(c.struct, sd[0], 2)
          + "。若只想动一处，这类改动通常不牵动版型、成本也低，可优先试一到两个。");
      }
      /* 版型：给取舍建议，明确不是硬性要求 */
      var ft = (c.fit || [])[0];
      if (ft && ft[1] >= 30) {
        out.push(nm + "的版型以 " + pctTxt(ft) + " 为主"
          + listTxt(c.fit, ft[0], 3)
          + "。打版时可优先沿用这套值，把试错成本留给面料与工艺 —— 这是取舍建议，不是硬性要求。");
      }
      /* 面料：候选 + 成分标注风险 */
      var fb = (c.fabric || [])[0];
      if (fb && fb[1] >= 20) {
        out.push(nm + "的面料候选里 " + pctTxt(fb) + " 最多"
          + listTxt(c.fabric, fb[0], 2)
          + "。下单前建议对照成分标核实：口头叫法与真实成分不一致，更容易被判标签不符。");
      }
      /* 视觉：不涉及改款，且白底不推荐（通用底，照做没有差异） */
      var vp = repPick(c.visual), vs = vp.top;
      if (vs && vs[1] >= 35) {
        var vRest = vp.rest.slice(0, 2).map(function (x) { return esc(x[0]) + " " + x[1] + "%"; });
        out.push(nm + "的主图视觉以 " + pctTxt(vs) + " 居多"
          + (vRest.length ? "（同列还有 " + vRest.join(" / ") + "）" : "")
          + "。这是展示方式、不涉及改款，沿用现有拍法就行，不必为此重拍。");
      }
      /* 拍摄方式：明显高于其余列才提，且写成可选 */
      var sh = (c.shoot || [])[0];
      if (sh && sh[1] >= 30 && repOthersMax(V, c, "shoot") + 8 <= sh[1]) {
        out.push(nm + "的拍摄方式以 " + pctTxt(sh) + " 居多，比其余" + dim.noun
          + "明显集中，主图可优先沿用这个拍法。");
      }
      /* 潜力机会高但爆款低 → 用商家手段补差异化 */
      if (c.oppP >= 50 && c.hotP <= 10) {
        out.push(nm + "潜力机会 " + c.oppP + "% 而趋势爆款只有 " + c.hotP
          + "%（" + c.n + " 张里爆款约 " + Math.round(c.n * c.hotP / 100) + " 张），偏<b>有量无爆</b>："
          + "相比继续加大上新量，更值得先补结构件与工艺上的差异。");
      }
    });
    if (!out.length) return "";
    var _sub = _pick.latest
      ? ('只写最近一周（' + esc(_pick.latest) + '）'
        + (_pick.dropped.length ? '；' + esc(_pick.dropped.join(" / ")) + ' 的建议已省略（结论只对最新一期负责，其余周次的构成仍见上面的对照表）' : '')
        + '。以下是基于占比的取舍参考，不是硬性要求；括号内为该值在本列的占比与张数，占比只代表"上榜图里常见"，不等于应当照做')
      : '以下是基于占比的取舍参考，不是硬性要求；括号内为该值在本列的占比与张数，占比只代表"上榜图里常见"，不等于应当照做';
    return '<section class="rk-rep-sec"><h4><em>四</em>可执行建议<span class="rk-rep-h4-sub">'
      + _sub + '</span></h4>'
      + '<ul class="rk-rep-act">'
      + out.slice(0, 14).map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ul></section>";
  }

  /* ④-2 趋势动向：新上榜 & 上升最多，各自在打什么
     ------------------------------------------------------------
     20261102N：这是「从画像到动向」的一步。画像回答"这一列是什么样"，
     动向回答"正在变的是什么"。做法是把每列切成两个子集再各自统计：
       · 上升最多 = 本期被标为「周度激增」的图（环比涨、绝对值也涨）
       · 新上榜   = 上一期不在榜、本期才进榜的图（同分类同站点对比）
     再拿子集的构成与该列整体构成比：某个值在子集里高出整体一大截，
     说明新增长的那部分正在往这个值上集中 —— 这就是一条新动向。
     列举维度按商家关心的顺序：版型 / 图案元素 / 视觉 / 结构部件 / 二次工艺 / 面料。
     这里只做<b>描述</b>（哪个值在抬头），建议仍由第④节给，印花不写成"照抄"动作。
     ============================================================ */
  var TREND_DIMS = [["版型", "fit", "fit_tags"], ["图案元素", "elems", "element_tags"],
    ["视觉背景", "bg", "scene_tags"], ["视觉", "visual", "visual_tags"], ["结构部件", "struct", "struct_tags"],
    ["二次工艺", "craft", "craft_tags"], ["面料", "fabric", "fabric_tags"]];

  function trendValsOf(it, col) {
    var t = TAG_INDEX[it.image_url];
    if (!t) return [];
    var arr = tagArr(t[col]).map(function (v) { return String(v); });
    if (col === "fit_tags") {
      arr = arr.map(function (v) { return fitValOfFit(v, it.category); }).filter(Boolean);
    }
    /* 白底不参与抬头统计：它是通用底，变多不代表趋势 */
    if (col === "visual_tags" || col === "scene_tags") arr = arr.filter(function (v) { return !isWhiteBg(v); });
    /* 「无工艺」同理：它不是一个做法，抬头说明不了任何趋势 */
    if (col === "craft_tags") arr = arr.filter(function (v) { return !skill_none(v); });
    return arr;
  }
  /* 一个子集在某一维度的分布：分母只用「该维度有打标」的图 */
  function trendAgg(list, col) {
    var cnt = {}, tot = 0;
    (list || []).forEach(function (it) {
      var vs = trendValsOf(it, col);
      if (!vs.length) return;
      tot++;
      var seen = {};
      vs.forEach(function (v) { if (seen[v]) return; seen[v] = 1; cnt[v] = (cnt[v] || 0) + 1; });
    });
    return { tot: tot, cnt: cnt };
  }
  /* 抬头值：子集占比 ≥25%、至少 3 张、且比本列整体高 ≥15 个百分点 */
  function trendLifts(sub, base) {
    if (!sub.tot || sub.tot < 5) return [];
    var out = [];
    Object.keys(sub.cnt).forEach(function (k) {
      var n = sub.cnt[k];
      if (n < 3) return;
      var p = Math.round(n / sub.tot * 100);
      if (p < 25) return;
      var bp = base.tot ? Math.round((base.cnt[k] || 0) / base.tot * 100) : 0;
      var lift = p - bp;
      if (lift < 15) return;
      out.push({ v: k, n: n, p: p, bp: bp, lift: lift });
    });
    return out.sort(function (a, b) { return b.lift - a.lift; }).slice(0, 3);
  }

  function repTrendHtml(V, dim) {
    var live = V.filter(function (c) { return c.n > 0; });
    if (!live.length) return "";
    var groups = vitalsGroups();
    var byKey = {};
    groups.forEach(function (g) { byKey[g.key] = g; });

    /* 期次序列：判定「新上榜」要与上一期比 */
    var all = (CACHE && CACHE.items) || [];
    var per = {};
    all.forEach(function (it) { var p = it.period_label || ""; if (p) per[p] = 1; });
    var plist = Object.keys(per).sort();
    var prevOf = function (p) {
      var i = plist.indexOf(p);
      return i > 0 ? plist[i - 1] : "";
    };

    var blocks = [], notes = [];
    live.slice(0, 4).forEach(function (c) {
      var g = byKey[c.key];
      var items = (g && g.items) || [];
      if (!items.length) return;
      var p = String(items[0].period_label || "");
      var prev = prevOf(p);

      /* 上升最多：周度激增优先；没有环比数据时退回「环比涨幅前 20%」 */
      var upList = items.filter(function (it) { return it._surge; });
      var upTag = "周度激增";
      if (!upList.length) {
        var pos = items.filter(function (it) { return it.ratio != null && it.ratio > 0; })
          .sort(function (a, b) { return b.ratio - a.ratio; });
        upList = pos.slice(0, Math.max(1, Math.round(pos.length * 0.2)));
        upTag = "环比涨幅前 20%";
      }

      /* 新上榜：上一期同分类同站点没有这张图 */
      var newList = [], newNote = "";
      if (!prev) {
        newNote = "首期，无上一周可比";
      } else {
        var prevSet = {};
        all.forEach(function (it) {
          if ((it.period_label || "") !== prev) return;
          if ((it.category || "") !== (items[0].category || "")) return;
          if ((it.site || "") !== (items[0].site || "")) return;
          prevSet[it.image_url] = 1;
        });
        if (!Object.keys(prevSet).length) newNote = "上一期（" + prev + "）无数据，无法判新上榜";
        else newList = items.filter(function (it) { return !prevSet[it.image_url]; });
      }

      var rows = "";
      TREND_DIMS.forEach(function (d) {
        var base = trendAgg(items, d[2]);
        var lu = trendLifts(trendAgg(upList, d[2]), base);
        var ln = trendLifts(trendAgg(newList, d[2]), base);
        if (!lu.length && !ln.length) return;
        var cell = function (arr, tot) {
          if (!tot) return '<td class="na">—</td>';
          if (tot < 5) return '<td class="na">样本 ' + tot + ' 张，太少</td>';
          if (!arr.length) return '<td class="na">无明显抬头</td>';
          return "<td>" + arr.map(function (x) {
            return esc(x.v) + ' <b class="up">+' + x.lift + '</b>'
              + '<span class="rk-trend-n">' + x.p + '%（本列 ' + x.bp + '%，' + x.n + ' 张）</span>';
          }).join("<br>") + "</td>";
        };
        rows += "<tr><th>" + d[0] + "</th>"
          + cell(lu, trendAgg(upList, d[2]).tot)
          + cell(ln, trendAgg(newList, d[2]).tot) + "</tr>";
      });

      /* 最值得说的两条：跨维度挑 lift 最大的 */
      var best = [];
      TREND_DIMS.forEach(function (d) {
        var base = trendAgg(items, d[2]);
        var lu = trendLifts(trendAgg(upList, d[2]), base);
        var ln = trendLifts(trendAgg(newList, d[2]), base);
        if (lu[0]) best.push({ d: d[0], x: lu[0], which: "上升最多", total: trendAgg(upList, d[2]).tot });
        if (ln[0]) best.push({ d: d[0], x: ln[0], which: "新上榜", total: trendAgg(newList, d[2]).tot });
      });
      best.sort(function (a, b) { return b.x.lift - a.x.lift; });
      best.slice(0, 2).forEach(function (b) {
        notes.push("「" + c.cat + "」的" + b.which + "那批里，<b>" + b.d + "</b>冒出了「" + b.x.v + "」："
          + b.total + " 张中 " + b.x.n + " 张（" + b.x.p + "%），本列整体只有 " + b.x.bp
          + "%，高出 " + b.x.lift + " 个百分点。");
      });

      /* 20261102Q：抬头幅度用落差图表达 —— 浅点=本列整体，深点=该批，
         中间的连线就是拉升幅度，比读两列数字快。 */
      var dbRows = [];
      TREND_DIMS.forEach(function (d) {
        var base = trendAgg(items, d[2]);
        var lu = trendLifts(trendAgg(upList, d[2]), base);
        var ln = trendLifts(trendAgg(newList, d[2]), base);
        if (lu[0]) dbRows.push({ lift: lu[0].lift, label: d[0] + " · " + lu[0].v, note: "上升最多",
          dots: [{ v: lu[0].bp, color: "#cfc7b6", name: "本列整体" }, { v: lu[0].p, color: "#a9705f", name: "该批" }],
          tail: '<b class="up">+' + lu[0].lift + "</b>" });
        if (ln[0]) dbRows.push({ lift: ln[0].lift, label: d[0] + " · " + ln[0].v, note: "新上榜",
          dots: [{ v: ln[0].bp, color: "#cfc7b6", name: "本列整体" }, { v: ln[0].p, color: "#5b7f95", name: "该批" }],
          tail: '<b class="up">+' + ln[0].lift + "</b>" });
      });
      dbRows.sort(function (a, b) { return b.lift - a.lift; });
      var dbChart = dbRows.length
        ? repDotChart({
            title: "抬头幅度（本列整体 → 该批）",
            connect: true,
            legend: [{ name: "本列整体", color: "#cfc7b6" }, { name: "上升最多那批", color: "#a9705f" },
                     { name: "新上榜那批", color: "#5b7f95" }],
            rows: dbRows.slice(0, 5)
          })
        : "";

      blocks.push('<div class="rk-trend-blk">'
        + '<div class="rk-trend-h">' + esc(c.cat) + '<span class="rk-trend-meta">' + esc(p)
        + ' · 上升最多 ' + upList.length + ' 张（' + upTag + '）'
        + (prev ? ' · 新上榜 ' + newList.length + ' 张（较 ' + esc(prev) + '）' : ' · ' + esc(newNote))
        + '</span></div>'
        + dbChart
        + (rows
          ? '<div class="rk-rep-tbl-wrap"><table class="rk-rep-tbl rk-trend-tbl"><thead><tr><th>维度</th>'
            + '<th>上升最多那批</th><th>新上榜那批</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<div class="rk-trend-none">这两批里没有出现明显抬头的值（要求：占比 ≥25%、至少 3 张、比本列整体高 ≥15 个百分点）。</div>')
        + '</div>');
    });

    if (!blocks.length) return "";
    return '<section class="rk-rep-sec rk-rep-trend"><h4><em>五</em>趋势动向<span class="rk-rep-h4-sub">'
      + '上升最多 = 本期周度激增；新上榜 = 较上一期才进榜。百分比为该值在这批里的占比，括号内是本列整体占比</span></h4>'
      + (notes.length ? '<ol class="rk-trend-notes">' + notes.map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ol>" : "")
      + blocks.join("")
      + '<p class="rk-rep-note">这一节只描述「哪个值在抬头」，不构成照抄建议：印花类值出现，说明它在新增榜单里变多，'
      + '不代表适合跟进 —— 印花是设计端一次性的决定，跟做容易撞款。</p>'
      + '</section>';
  }

  /* ⑤ 数据说明：口径与限制，避免被误读 */
  function repQualityHtml(V, dim) {
    var sum = 0, tagged = 0, minN = 1e9;
    V.forEach(function (c) {
      sum += c.n || 0; tagged += (c.tagAny || 0);
      if (c.n > 0 && c.n < minN) minN = c.n;
    });
    var cov = sum ? Math.round(tagged / sum * 100) : 0;
    var rows = [
      '口径：只比<b>构成</b>（各维度占比），不比张数。张数取决于这一期上了多少图，横比会把「上传得多」误读成「卖得好」。',
      '分母：每个维度只用<b>该维度已打标</b>的图片，未打标的图不计入分母，所以各维度占比之和不一定等于 100%。',
      '覆盖：本次样本 ' + sum + ' 张，其中 <b>' + cov + '%</b> 带打标数据；覆盖不足时结论以方向为主。',
      /* 20261102R：把白底的处理写进口径，避免把「没推荐白底」当成漏算 */
      '白底：「纯白底 / 白背景」属平台通用底，<b>不参与</b>差异比较与推荐，报告中也不展示，以免被当成可以照做的做法；原始标签仍可在逐张看图时查看。',
      /* 20261103D：说明版型只统计本类目自己的部位，避免把模特身上的裤子/裙子算进 T恤 */
      '版型：只统计<b>这类衣服自己的部位</b>——上装看领型 / 袖型 / 袖长 / 衣长 / 松紧度，下装看裤型 / 裤长 / 腰型 / 松紧度；模特身上穿的裤子、裙子不算这件商品的版型，已剔除。原始标签仍在逐张看图时可见。'
    ];
    if (minN < 30 && minN < 1e9) rows.push('最小样本列仅 <b>' + minN + ' 张</b>，占比波动较大，建议累积 2–3 周再看趋势。');
    return '<section class="rk-rep-sec rk-rep-qual"><h4><em>六</em>数据说明</h4><ul>'
      + rows.map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ul></section>";
  }


  /* 20261102Z：全量数据明细。
     图表为了能一眼看懂会挑重点，但核对时经常需要「这一列到底有哪些值、各多少张」。
     这里把每个维度、每个取值、张数与占比全部摊开，不截断。
     口径与正文一致：白底不展示、图案复制类工艺不展示、分母是该维度已打标的图数。 */
  function repFullDataHtml(V, dim) {
    var live = (V || []).filter(function (c) { return c.n > 0; });
    if (!live.length) return "";
    var cols = 4 + live.length;   /* 维度 / 取值 / 张数 / 占比 + 每列占比 */
    var thead = '<tr><th>维度</th><th>取值</th><th>张数</th><th>占比</th>'
      + live.map(function (c) { return '<th>' + esc(c.cat) + "</th>"; }).join("") + "</tr>";
    var body = "", rows = 0;
    REP_DIMS.forEach(function (d) {
      /* 该维度在全列出现过的所有取值（并集），按最高占比排序 */
      var names = {};
      live.forEach(function (c) {
        repAll(c, d[1]).forEach(function (e) {
          if (!e || !e[0]) return;
          if ((d[1] === "visual" || d[1] === "bg") && isWhiteBg(e[0])) return;   /* 白底不展示 */
          if (d[1] === "craft" && craftIsPrint(e[0])) return; /* 图案复制类不展示 */
          names[e[0]] = 1;
        });
      });
      /* 索引表建一次，取值几百个也不再有多重循环 */
      var pMaps = live.map(function (c) { return repPctMap(c, d[1]); });
      var cMaps = live.map(function (c) { return repCntMap(c, d[1]); });
      var keys = Object.keys(names).map(function (nm) {
        var mx = 0, cnt = 0;
        for (var li = 0; li < pMaps.length; li++) {
          var p = pMaps[li][nm];
          if (p != null && p > mx) mx = p;
          var n2 = cMaps[li][nm];
          if (n2 != null && n2 > cnt) cnt = n2;
        }
        return { nm: nm, mx: mx, cnt: cnt };
      }).sort(function (a, b) { return b.mx - a.mx; });
      if (!keys.length) return;
      keys.forEach(function (k, ki) {
        rows++;
        body += '<tr>' + (ki === 0 ? '<th rowspan="' + keys.length + '">' + esc(d[0]) + "</th>" : "")
          + "<td>" + esc(k.nm) + "</td><td>" + k.cnt + "</td><td>" + k.mx + "%</td>"
          + live.map(function (c) { return "<td>" + repTagPct(c, d[1], k.nm) + "%</td>"; }).join("")
          + "</tr>";
      });
    });
    if (!body) return "";
    return '<section class="rk-rep-sec rk-rep-full"><h4><em>七</em>全量数据<span class="rk-rep-h4-sub">'
      + '每个维度的全部取值，不截断。张数 = 该取值在列内出现最多的张数，占比 = 占该列该维度已打标图数的比例</span></h4>'
      + '<div class="rk-rep-scroll"><table class="rk-full-table"><thead>' + thead + "</thead><tbody>"
      + body + '</tbody></table></div>'
      + (PRINT_HIDE ? '<p class="rk-rep-note">口径：后台已关闭「图案印花款」前台展示，含图案的款式不参与本报告的样本、占比与结论。判定范围：图案类型不是「纯色/无图案」或纯配色（拼色 / 撞色 / 双色拼接 / 色块拼接）、图案元素写了具体图案内容（字母 / 文字标语 / 卡通人物 / 花朵…）、二次工艺属图案复制类，满足任一即计入；章仔 / 织唛 / 印花标这类辅料标牌与拉链 / 荷叶边这类结构件不属于图案，仍计入。</p>' : '')
      + '<p class="rk-rep-note">口径：纯白底属平台通用底，不展示；印花 / 烫画 / 烫金 / 烫钻这类「图案复制类」二次工艺'
      + '只换图案、不带来质感差异，整类不展示（原始标签仍可在逐张看图时查看）。共 ' + rows + ' 行。</p>'
      + "</section>";
  }

  /* 报告详情的上半段（头 / 结论 / 对照 / 各图） */
  function repDetailTopHtml(V, dim) {
    var detailTop = repHeadHtml(V, dim);
    /* 只有一列可比较时，横向对照与核心结论本就无从谈起。
       以前是静默省略，页面上只剩画像，容易让人以为"切换了却没变化"。
       现在明确说明原因，并提示怎样让对比成立。 */
    var _liveCnt = V.filter(function (c) { return c.n > 0; }).length;
    if (_liveCnt < 2) {
      detailTop += '<p class="rk-rep-hint">当前只有 ' + _liveCnt + ' 列可比较，横向对照与核心结论暂不生成。'
        + (MODE === "h" ? "在上方「国家站点」里多选几个国家，" : MODE === "v" ? "在「周次」里多选 2 周以上，" : "在「对比类目」里勾选 2 个以上类目，")
        + '再看差异。</p>';
    }
    /* 20261102Q：结论后面先给图，再给表 —— 图看趋势，表查细节。
       只有一列时不画（没有对比对象），图与表同时省略，口径说明已在上面提示。 */
    detailTop += repSummaryHtml(V, dim) + repDensityChart(V)
      + repMatrixHtml(V, dim) + repDimCharts(V, dim)
      /* 视觉背景与文化背景并排两列：背景讲"在哪拍"，文化讲"卖给谁"，
         放一起看，一眼就能对上"这个取景配哪种圈层"，比上下排更省滚动 */
      + (function () {
        var b = repBgCharts(V), c = repCuCharts(V);
        if (!b || !c) return b + c;   /* 只有一边有数据时不摆空栏 */
        return '<div class="rk-dim-pair"><div class="rk-dim-col">' + b + "</div>"
          + '<div class="rk-dim-col">' + c + "</div></div>";
      })();
    return detailTop;
  }
  /* 报告详情的下半段（建议 / 趋势 / 数据说明 / 全量数据） */
  function repDetailBottomHtml(V, dim) {
    return repActionHtml(V, dim) + repTrendHtml(V, dim) + repQualityHtml(V, dim)
      + repFullDataHtml(V, dim);
  }

  /* 20261103F：报告详情默认收起，但以前每次重绘都会把七节内容全部算一遍
     （全量数据表是「维度 × 取值 × 列」的三重循环，最重的那块）。
     用户根本没展开也要付这份成本，切类目时就表现为"报告很慢"。
     现在收起点只放占位，首次展开才生成，之后复用。 */
  var REP_LAZY = { V: null, dim: null, box: null };
  function fillRepDetail(box) {
    if (!box || !REP_LAZY.V) return;
    var t = box.querySelector('[data-rep-lazy="top"]');
    if (t && !t.__filled) {
      t.innerHTML = repDetailTopHtml(REP_LAZY.V, REP_LAZY.dim);
      t.__filled = 1; t.removeAttribute("data-rep-lazy");
    }
    var b = box.querySelector('[data-rep-lazy="bottom"]');
    if (b && !b.__filled) {
      b.innerHTML = repDetailBottomHtml(REP_LAZY.V, REP_LAZY.dim);
      b.__filled = 1; b.removeAttribute("data-rep-lazy");
    }
  }

  function vitalsHtml(V, dim, opt) {
    if (!V.length) return "";
    opt = opt || {};
    dim = dim || vitalsDim();
    /* 20261102H：报告层。头 / 结论 / 对照表在前，底部再补建议与数据说明，
       三列体征卡作为「逐列画像」放在中间，仍是原卡片（数据底稿不变）。 */
    /* 20261102K：详情默认收起。
       一进来只给「逐列画像」——它是最直观的一屏，三列并列、一眼看差异。
       报告头 / 核心结论 / 横向对照 / 可执行建议 / 数据说明全部收进折叠区，
       由一个显眼的「查看详细报告」入口展开，避免首次进页面就被一大段文字压住。 */
    var detailTop = opt.lazyDetail ? "" : repDetailTopHtml(V, dim);

    var h = '';
    h += '<div class="rk-rep-toggle-bar">'
      +   '<button type="button" class="rk-rep-open" data-rep-toggle="1" aria-expanded="false">'
      +     '<span class="rk-rep-open-ico">▸</span><span class="rk-rep-open-txt">查看详细报告</span>'
      +   '</button>'
      +   '<span class="rk-rep-open-sub">展开后可见报告口径、结论、维度对照与数据说明</span>'
      + '</div>';
    if (opt.lazyDetail) {
      REP_LAZY = { V: V, dim: dim, box: null };
      h += '<div class="rk-rep-detail" data-rep-detail="1" data-rep-lazy="top" hidden></div>';
    } else {
      h += '<div class="rk-rep-detail" data-rep-detail="1" hidden>' + detailTop + '</div>';
    }
    /* 20261104E：逐列画像的列必须和对比池完全一致。
       对比池（上面那组周次/国家/类目列）遇到某列 0 张会直接不画这一列，
       画像原来却还留一张「无数据」空卡 —— 于是池子 2 列、画像 3 列，对不上。
       这里改成同一套取舍：没有上榜数据的列不建卡，另起一行说明哪几列被略过。 */
    var vLive = V.filter(function (c) { return c.n; });
    var vDead = V.filter(function (c) { return !c.n; }).map(function (c) { return c.cat; });
    if (!vLive.length) vLive = V;   /* 全都空：退回原样，至少给个空态，不要整节消失 */
    h += '<section class="rk-rep-sec rk-rep-cols"><h4><em>三</em>逐列画像'
      + (vLive.length ? '<span class="rk-rep-cols-n">' + vLive.length + ' 列，与上方对比池一致</span>' : '')
      + '</h4>';
    h += '<div class="rk-vitals" data-cols="' + vLive.length + '">';
    vLive.forEach(function (c) {
      h += '<div class="rk-vit">'
        + '<div class="rk-vit-h"><span class="rk-vit-name">' + esc(c.cat) + '</span>'
        + (c.n
          ? '<span class="rk-vit-n"><b>' + c.n + '</b> 张上榜</span></div>'
          : '<span class="rk-vit-n rk-vit-none">无数据</span></div>'
            + '<div class="rk-vit-empty">' + esc(c.empty || "这一列没有上榜数据。") + '</div>')
        + '<div class="rk-vit-stack" title="三档标签占比（占比之和可能不足 100%：没打上标签的图不计入）">'
        + '<i class="v-opp" style="width:' + c.oppP + '%"></i>'
        + '<i class="v-hot" style="width:' + c.hotP + '%"></i>'
        + '<i class="v-srg" style="width:' + c.srgP + '%"></i></div>'
        + repProfile(c, V)
        + (c.n
          ? '<div class="rk-vit-legend">'
            + '<span><em class="v-opp"></em>潜力机会 ' + c.oppP + '%</span>'
            + '<span><em class="v-hot"></em>趋势爆款 ' + c.hotP + '%</span>'
            + '<span><em class="v-srg"></em>周度激增 ' + c.srgP + '%</span>'
            + '</div>'
          : '');
      /* 20261102L：画像卡也按商家顺序排 —— 工艺 / 结构部件 / 版型 / 面料在前，
         风格 / 视觉 / 文化 / 心理作为背景信息在后。 */
      [["二次工艺", c.craft], ["结构部件", c.struct], ["版型", c.fit], ["面料", c.fabric],
       ["风格", c.style], ["视觉背景", c.bg], ["视觉", c.visual], ["文化背景", c.culture], ["消费心理", c.psych]].forEach(function (g) {
        if (!g[1] || !g[1].length) return;
        /* 视觉 / 视觉背景剔除白底：报告里不展示，避免被当成"可以照做的做法" */
        if (g[0] === "视觉" || g[0] === "视觉背景") g = [g[0], g[1].filter(function (e) { return !isWhiteBg(e[0]); })];
        /* 二次工艺同理：「无工艺」不作为做法展示 */
        if (g[0] === "二次工艺") g = [g[0], g[1].filter(function (e) { return !skill_none(e[0]); })];
        if (!g[1].length) return;
        h += '<div class="rk-vit-sub">' + g[0] + '</div><div class="rk-vit-tags">'
          + g[1].map(function (e) { return '<span class="rk-vit-tag">' + esc(e[0]) + ' <b>' + e[1] + '%</b></span>'; }).join("")
          + '</div>';
      });
      if (c.shoot.length) {
        h += '<div class="rk-vit-sub">拍摄方式</div>';
        c.shoot.forEach(function (s) {
          h += '<div class="rk-vit-bar"><span class="b-k">' + esc(s[0]) + '</span>'
            + '<span class="b-t"><i style="width:' + s[1] + '%"></i></span>'
            + '<span class="b-v">' + s[1] + '%</span></div>';
        });
      }
      /* 20261102L：画像卡里不再展示「元素标签 TOP3」。
         印花是设计端一次性的决定，商家照抄只会撞款；报告口径改为商家视角后，
         这一块整体撤掉（原始标签仍可在大图标签面板里逐张查看，数据没丢）。 */
      h += '</div>';
    });
    h += '</div>'
      + (vDead.length
        ? '<p class="rk-rep-cols-skip">其余 ' + vDead.length + ' 列无数据（' + vDead.map(esc).join("、")
          + '），对比池里同样不画这些列，画像这里也不单列一张空卡，免得两边列数对不上。</p>'
        : '');
    /* 差异洞察紧跟画像，作为「谁跟谁不一样」的短结论（标题沿用原口径文案） */
    var ins = insightsOf(V, dim);
    if (ins.length) {
      h += '<div class="rk-insight"><div class="rk-insight-h">' + esc(dim.head) + '</div><ul>'
        + ins.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("") + '</ul></div>';
    }
    h += '</section>';
    if (opt.lazyDetail) {
      h += '<div class="rk-rep-detail" data-rep-detail="1" data-rep-lazy="bottom" hidden></div>';
    } else {
      h += '<div class="rk-rep-detail" data-rep-detail="1" hidden>' + repDetailBottomHtml(V, dim) + '</div>';
    }
    return h;
  }

  /* ---------------------------------------------------------------- 大图标签面板
     20261027P：标签不再挂在卡片上（悬停浮层已取消），改为
     「点开大图 → 标签整齐排在图片左侧」，一屏看全，不用逐张悬停。
     按维度分组，视觉拆成 背景 / 构图 / 主体，版型按部位拆开，避免一大坨。 */
  /* 20261027Q：新增「文化背景」「消费心理」两个语义层维度，紧跟风格之后。
     阅读顺序按"从抽象到具体"：先说这身衣服属于哪种文化、想打动谁，
     再说画面怎么拍、衣服什么版型。 */
  var LB_GROUPS = [
    ["风格", "style_tags", "style"],
    ["文化背景", "culture_tags", "culture"],
    ["消费心理", "psych_tags", "psych"],
    /* 20261027R 节日：只有绑定了节日节点才显示，常规款整组不出现。
       第三个参数留空 = 不做枚举过滤：导入允许节庆库里的任意名字，
       若在这里按 45 个常用节日硬过滤，库里那些节日会在前台被静默吃掉。
       节日值本身独占一列，不存在与其它维度混在一列的问题，不筛也串不了。 */
    ["节日", "festival_tags", ""],
    ["视觉 · 背景", "visual_tags", "视觉-背景"],
    ["视觉 · 构图", "visual_tags", "视觉-画面构成"],
    ["视觉 · 主体", "visual_tags", "视觉-呈现主体"],
    /* 20261102A 枚举 v11：图案拆成类型/元素/结构件三栏，面料单独一栏。
       「图案元素」这里不做枚举过滤（第三参留空）：库里还有 v10 的旧词（卡通图案等），
       硬过滤会让这些老标签在前台静默消失。 */
    ["图案类型", "pattern_tags", "图案类型"],
    ["图案元素", "element_tags", ""],
    ["结构部件", "struct_tags", "结构部件"],
    /* 20261102B 面料第三参留空：打标表里的面料是候选池，含「羊毛混纺 / 毛呢 /
       各类内里」等枚举外常用词。这里若按 57 项硬过滤，这些值会被当成
       "不属于视觉"而塞进「视觉 · 其他」，反而串了组；不筛就按原样留在面料栏。 */
    ["面料", "fabric_tags", ""],
    ["二次工艺", "craft_tags", "craft"],
    ["拍摄方式", "shoot_tags", "shoot"]
  ];
  /* 20261103D：版型只统计「这件衣服自己」的部位。
     版型维度存的是「部位·取值」（领型·圆领 / 裤长·长裤）。一张 T恤 图里如果模特穿着长裤，
     打标会把模特下装也打进来，于是 T恤 的报告里冒出「长裤 7%」「短裙 2%」「工装裤 1%」
     这种跟 T恤 毫无关系的行。这里按类目限定部位：
       上装 → 领型 / 袖型 / 袖长 / 衣长 / 松紧度
       下装 → 裤型 / 裤长 / 腰型 / 松紧度
       全类目（全部 / 大码全类 / 套装 / 连体）→ 不过滤 */
  var FIT_PARTS_UPPER = ["领型", "袖型", "袖长", "衣长", "松紧度"];
  var FIT_PARTS_LOWER = ["裤型", "裤长", "腰型", "松紧度"];
  var CAT_FIT_ALL = /全部|大码全类|套装|连体/;
  var CAT_FIT_LOWER = /长裤|短裤|工装裤|背带裤|牛仔/;
  var CAT_FIT_UPPER = /T恤|POLO|衬衫|卫衣|连帽|毛衣|开衫|外套|风衣|大衣|棉服|西装|背心|球衣|功能服|打底|压缩|传统服饰/;

  function fitPartsOfCat(cat) {
    var c = String(cat || "");
    if (!c || CAT_FIT_ALL.test(c)) return null;          /* 全类目：不过滤 */
    if (CAT_FIT_LOWER.test(c)) return FIT_PARTS_LOWER;
    if (CAT_FIT_UPPER.test(c)) return FIT_PARTS_UPPER;
    return null;                                          /* 认不出的类目：不过滤，宁可多给 */
  }
  /* 去掉部位前缀后的取值；部位不属于这个类目时返回空串（这一条不计入） */
  /* 版型里真正存在的部位。前缀不是这些（例如老数据的「版型·收腰」）就当成没写部位，
     原样放行 —— 只有明确是「别的衣服的部位」时才剔除，避免把老数据整列清空。 */
  var FIT_PARTS_ALL = ["领型", "袖型", "袖长", "衣长", "松紧度", "裤型", "裤长", "裙长", "腰型"];
  function fitValOfFit(v, cat) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return "";
    var cut = s.indexOf("·");
    var part = cut >= 0 ? s.slice(0, cut) : "";
    var name = cut >= 0 ? s.slice(cut + 1) : s;
    var allow = fitPartsOfCat(cat);
    if (part && allow && FIT_PARTS_ALL.indexOf(part) >= 0 && allow.indexOf(part) < 0) return "";
    return name;
  }

  var FIT_ORDER = ["领型", "袖型", "袖长", "衣长", "松紧度", "裤型", "裤长", "裙长"];

  /* 取某个枚举键的允许值，用来把 visual_tags 里混在一起的值分到三个子组。
     词表来自 js/rank-enums.js（与后台导出/导入同一份）；万一没加载到，
     退回到「全部归入背景组」，只会分组粗一点，不会丢标签。 */
  function enumList(key) {
    var VE = window.RANK_VISUAL_ENUM || {};
    if (key === "视觉-背景") return (VE.bg || []).concat(VE.legacy || []);
    if (key === "视觉-画面构成") return VE.frame || [];
    if (key === "视觉-呈现主体") return VE.subject || [];
    var E = (window.RankExport && window.RankExport.ENUM) || {};
    if (E[key] && E[key].length) return E[key];
    /* 20261102X：榜单页并没有加载导出模块，RankExport 是空的，
       于是「图案类型 / 结构部件 / 面料」取不到词表，分组全都只落回「图案元素」。
       词表本体在 rank-enums.js 里已经挂到 APP_ENUM，这里直接兜底取它。 */
    var A = window.APP_ENUM || {};
    return (A[key] || []).slice();
  }

  /* 三个视觉子组的并集（含旧值）：用来判断"这个值到底属不属于视觉" */
  function VISUAL_ALL() {
    return (enumList("视觉-背景") || []).concat(enumList("视觉-画面构成") || [], enumList("视觉-呈现主体") || []);
  }

  /* 20261102X：三处「看起来没分开」的根因修复（纯前端归一，不动库）
     ------------------------------------------------------------
     ① 图案三列：v11 才把「图案」拆成 类型 / 元素 / 结构部件 三列。
        存量图仍是 v10 的写法——三样东西全挤在「图案元素」一列。
        所以面板只能显示一个「图案元素」，看不到 图案类型 与 结构部件。
        这里按词表把三列的值重新分拣一遍：格纹/条纹 归类型，拉链/口袋 归结构件，
        认不出的留在图案元素。库没迁移也能正确分列显示。
     ② 视觉背景：v11 给背景全量加了 室内·/室外· 前缀。旧值（家居卧室·床品沙发 等）
        匹配不上新词表，全被兜进「视觉 · 其他」，看上去就是"背景没分开"。
        这里先用旧值 → 新值映射改写，再分组。
     ③ 面料：纯数据问题（列不存在或整列为空），前端无法凭空还原，
        已单独在结果里说明。 */
  function lbPatternMap() {
    var A = window.APP_ENUM || {};
    return { pat: A["图案类型"] || [], el: A["图案元素"] || [], st: A["结构部件"] || [] };
  }
  function lbNormalize(t) {
    if (!t) return t;
    var n = {};
    Object.keys(t).forEach(function (k) { n[k] = t[k]; });

    /* ① 图案三列重分拣 */
    var P = lbPatternMap();
    if (P.pat.length || P.st.length) {
      var src = [
        ["pattern_tags", t.pattern_tags],
        ["element_tags", t.element_tags],
        ["struct_tags", t.struct_tags]
      ];
      var out = { pattern_tags: [], element_tags: [], struct_tags: [] };
      var seen = {};
      src.forEach(function (pair) {
        tagArr(pair[1]).forEach(function (v) {
          var k = String(v).trim();
          if (!k) return;
          var to = pair[0];
          if (P.st.indexOf(k) >= 0) to = "struct_tags";
          else if (P.pat.indexOf(k) >= 0) to = "pattern_tags";
          else if (P.el.indexOf(k) >= 0) to = "element_tags";
          var uid = to + "\u0001" + k;
          if (seen[uid]) return;
          seen[uid] = 1;
          out[to].push(k);
        });
      });
      n.pattern_tags = out.pattern_tags;
      n.element_tags = out.element_tags;
      n.struct_tags = out.struct_tags;
    }

    /* ② 背景旧值 → 新值（带 室内·/室外· 前缀） */
    var AL = (window.APP_ENUM && window.APP_ENUM.bgAlias) || {};
    if (Object.keys(AL).length) {
      var vis = [], seenV = {};
      tagArr(t.visual_tags).forEach(function (v) {
        var k = String(v).trim();
        if (!k) return;
        var m = AL[k] || k;
        if (seenV[m]) return;
        seenV[m] = 1;
        vis.push(m);
      });
      n.visual_tags = vis;
    }
    return n;
  }

  function lbTagGroups(t) {
    t = lbNormalize(t);
    /* 20261027T 修两处「标签被吞」：
       ① 原来用全局 seen 去重，而「摆拍/挂拍/细节特写/买家秀」这几个值
          在「视觉-主体」和「拍摄方式」里都存在。主体先收走，拍摄方式那一组
          就整个消失——看起来像"没打标"。改成按维度去重，同词可在不同维度各显示一次。
       ② 视觉子组的白名单过严：库里存了不在词表里的旧值（场景实景等）时
          直接 return，标签彻底不显示。改成"认不出来的不丢，单独归到视觉·其他"。 */
    var groups = [], seenIn = {};
    var take = function (list, arr, label, key, dropIfUnknown) {
      var allow = key ? (enumList(key) || []) : null;
      tagArr(arr).forEach(function (v) {
        var k = String(v).trim();
        if (!k) return;
        var uid = label + "\u0001" + k;
        if (seenIn[uid]) return;
        if (allow && allow.length && allow.indexOf(k) < 0) {
          if (dropIfUnknown) return;
          /* 值属于另外的视觉子组 → 跳过，它会在自己那组显示，别重复兜底 */
          if (VISUAL_ALL().indexOf(k) >= 0) return;
          var og = list.filter(function (x) { return x[0] === "视觉 · 其他"; })[0];
          if (!og) { og = ["视觉 · 其他", []]; list.push(og); }
          if (og[1].indexOf(k) < 0) og[1].push(k);
          seenIn[uid] = 1;
          return;
        }
        seenIn[uid] = 1;
        var g = list.filter(function (x) { return x[0] === label; })[0];
        if (!g) { g = [label, []]; list.push(g); }
        if (g[1].indexOf(k) < 0) g[1].push(k);
      });
    };
    if (!t) return groups;
    LB_GROUPS.forEach(function (m) {
      /* 视觉三组认不出来的值不丢（兜到"视觉·其他"），其它维度本来就不校验 */
      var isVisual = m[2] && m[2].indexOf("视觉-") === 0;
      /* 20261103F：视觉三组在库里是分流存的 —— 背景进 scene_tags，构图 / 主体进 visual_tags。
         面板一直只读 visual_tags，于是「视觉 · 背景」整组永远空着（图上明明有车、有街景）。
         这里「视觉 · 背景」改读背景字段（scene_tags，老数据从 visual_tags 里挑），其余照旧。 */
      var src = m[2] === "视觉-背景" ? bgValuesOf(t) : t[m[1]];
      take(groups, src, m[0], m[2], !isVisual);
    });

    /* 版型：库里存成「领型·圆领」这种带前缀的值，按部位拆成多组 */
    var fitRest = [];
    var seenFit = {};
    tagArr(t.fit_tags).forEach(function (v) {
      var s2 = String(v).trim();
      if (!s2 || seenFit[s2]) return;
      seenFit[s2] = 1;
      var cut = s2.indexOf("·");
      if (cut > 0) {
        var part = s2.slice(0, cut), val = s2.slice(cut + 1);
        var gi = FIT_ORDER.indexOf(part);
        var label = "版型 · " + part;
        var g = groups.filter(function (x) { return x[0] === label; })[0];
        if (!g) { g = [label, []]; groups.push(g); }
        if (gi >= 0) g.__ord = gi;
        g[1].push(val);
      } else fitRest.push(s2);
    });
    if (fitRest.length) groups.push(["版型", fitRest]);
    return groups.filter(function (g) { return g[1].length; });
  }

  function lbTagsHtml(url) {
    var t = TAG_INDEX[url] || TAG_INDEX[String(url).split("?")[0].split("#")[0]] || null;
    var groups = lbTagGroups(t);
    /* 20261102I：未打标不再给提示。以前这里会渲染「这张图还没有打标 / 到后台导出打标表补齐后回填」，
       既多一块占位，也在引导用户去一个已经不在数据看板的入口。没标签就整块不出现，
       左侧只留图片信息，面板更干净。 */
    if (!groups.length) return "";
    var h = '<div class="rk-lb-tags"><div class="rk-lb-th">打标信息</div>';
    groups.forEach(function (g) {
      h += '<div class="rk-lb-tg"><div class="rk-lb-tl">' + esc(g[0]) + '</div><div class="rk-lb-tc">'
        + g[1].map(function (v) { return '<i>' + esc(v) + '</i>'; }).join("")
        + '</div></div>';
    });
    h += '</div>';
    return h;
  }

  /* 打标维度按当前这批图异步取一次；取不到就只显示三档占比，不阻塞主流程 */
  /* 20261102J：标签取数的去重键原来是「数量 + 首个 URL + 末个 URL」。
     切换对比方式后如果两个组合的图片数量与首末地址恰好相同（同一类目同一周很常见），
     就会被判成"取过了"而不重新拉，于是切到新组合后报告里风格/视觉/工艺永远是空的，
     看着像"切了没反应"。这里改成对整个 URL 集合做稳定指纹（排序后逐字符哈希），
     集合只要变一个地址，键就变，必定重取。 */
  function tagFingerprint(urls) {
    var a = (urls || []).slice().sort();
    var h = 5381;
    for (var i = 0; i < a.length; i++) {
      var s = String(a[i]);
      for (var j = 0; j < s.length; j++) h = ((h << 5) + h + s.charCodeAt(j)) | 0;
    }
    return a.length + "|" + (h >>> 0);
  }

  /* 20261103F：开关打开（=隐藏图案款）时，标签还没取回来的那一瞬间，
     所有图都"看起来没图案"，于是列表先被完整渲染一次，等标签到了再重绘、图案款才消失 ——
     用户看到的就是"先暴露一下、过一会才隐藏"。
     现在改成：开关打开时，标签核对没完成就先不出图，等核对完再一次性渲染。 */
  function tagsSettled(items) {
    if (!SBX || (!SBX.listImageTags && !SBX.listImageTagsForReport)) return true;   /* 取不了标签，不阻塞 */
    var urls = (items || []).map(function (it) { return it.image_url; }).filter(Boolean);
    if (!urls.length) return true;
    for (var i = 0; i < urls.length; i++) {
      if (!TAG_SEEN[tagStoreKey(urls[i])]) {
        /* 20261103I：整表已预取完成，却没记上"核对过" → 说明这些图打标表里没有记录，
           直接按"没有标签"放行，不能让页面继续等一个永远不会到的结果。 */
        if (TAG_ALL_STATE === 2) { TAG_SEEN[tagStoreKey(urls[i])] = 1; continue; }
        /* 网络慢时的逃逸阀：最多等 TAG_GATE_WAIT 毫秒，到点先出图；
           后台补完标签会再重绘一次，图案款照样会被隐藏，只是不再"先白等一大截"。 */
        if (!TAG_GATE_AT) TAG_GATE_AT = Date.now();      /* 第一次挡住就开始计时 */
        if (Date.now() - TAG_GATE_AT > TAG_GATE_WAIT) return true;
        return false;
      }
    }
    return true;
  }

  /* 图地址归一：去掉查询串与锚点，本地缓存与索引都按它对齐 */
  function tagStoreKey(u) {
    var s = String(u || "");
    var i = s.indexOf("?");
    if (i >= 0) s = s.slice(0, i);
    var j = s.indexOf("#");
    if (j >= 0) s = s.slice(0, j);
    return s.trim();
  }

  /* 20261103I：标签取数改成队列式。
     以前是"单飞"（TAG_BUSY）：一个请求还在飞的时候，切类目进来的新批次会被直接跳过，
     而跳过的那批图永远不会被记成"核对过" —— 于是要么卡在等待态，要么被迫再等一次。
     现在把缺的图推进队列，3 路并发按块取，取到哪块就先渲染哪块。 */
  var TAG_QUEUE = [], TAG_PEND = {}, TAG_RUN = 0, TAG_RUN_MAX = 3, TAG_BATCH = 220;
  var _tagRefreshTimer = 0;

  /* 取完一块只重绘一次，避免连续多块来回重排 */
  function tagScheduleRefresh() {
    if (_tagRefreshTimer) return;
    _tagRefreshTimer = setTimeout(function () {
      _tagRefreshTimer = 0;
      try { renderBody(); } catch (e) { }
    }, 160);
  }

  function tagAbsorb(map) {
    var got = 0;
    Object.keys(map || {}).forEach(function (u) {
      var rec = lbNormalize(map[u]);
      TAG_INDEX[u] = rec;
      TAG_INDEX[tagStoreKey(u)] = rec;
      TAG_SEEN[tagStoreKey(u)] = 1;
      tagStorePut(u, rec);
      got++;
    });
    return got;
  }

  function tagQueuePump() {
    while (TAG_RUN < TAG_RUN_MAX && TAG_QUEUE.length) {
      (function () {
        var batch = TAG_QUEUE.splice(0, TAG_BATCH);
        TAG_RUN++;
        var done = function () {
          TAG_RUN--;
          batch.forEach(function (u) { delete TAG_PEND[tagStoreKey(u)]; });
          tagStoreSave();
          tagScheduleRefresh();
          tagQueuePump();
        };
        try {
          var _fn = SBX.listImageTagsForReport || SBX.listImageTags;
          var p = _fn.call(SBX, batch);
          if (!p || typeof p.then !== "function") { done(); return; }
          p.then(function (m) {
            tagAbsorb(m);
            /* 没标签的图也要记"核对过"，否则永远不会就绪 */
            batch.forEach(function (u) { TAG_SEEN[tagStoreKey(u)] = 1; });
            done();
          }, function () {
            batch.forEach(function (u) { TAG_SEEN[tagStoreKey(u)] = 1; });
            done();
          });
        } catch (e) {
          batch.forEach(function (u) { TAG_SEEN[tagStoreKey(u)] = 1; });
          done();
        }
      })();
    }
  }

  function tagQueuePush(urls) {
    var added = 0;
    (urls || []).forEach(function (u) {
      if (!u) return;
      var k = tagStoreKey(u);
      if (TAG_SEEN[k] || TAG_PEND[k]) return;
      TAG_PEND[k] = 1;
      TAG_QUEUE.push(u);
      added++;
    });
    return added;
  }

  /* 整表一次性预取：页面打开后在后台跑一次，之后切类目 / 周次 / 国家都不再等标签。
     每读完一块就落内存与本地缓存，所以是"边读边能用"，不是等全部读完才好。 */
  function prefetchAllTags() {
    if (TAG_ALL_STATE === 1 || TAG_ALL_STATE === 2) return;
    if (!SBX || typeof SBX.listAllImageTags !== "function") { TAG_ALL_STATE = 3; return; }
    TAG_ALL_STATE = 1;
    TAG_ALL_AT = Date.now();
    var n = 0;
    try {
      SBX.listAllImageTags({
        size: 1000, conc: 4, onChunk: function (chunk) {
          n += tagAbsorb(chunk);
          tagStoreSave();
          if (n >= 800) { n = 0; tagScheduleRefresh(); }
        }
      }).then(function () {
        TAG_ALL_STATE = 2;
        tagStoreSave();
        tagScheduleRefresh();
      }, function () {
        /* 预取失败不算错：退回按需取，功能照常 */
        TAG_ALL_STATE = 0;
      });
    } catch (e) { TAG_ALL_STATE = 0; }
  }

  function ensureTags(items) {
    if (!SBX || (!SBX.listImageTags && !SBX.listImageTagsForReport)) return;
    var urls = (items || []).map(function (it) { return it.image_url; }).filter(Boolean);
    if (!urls.length) return;

    /* ① 先用本地缓存补齐：看过的那部分立刻算"已核对"，不必等网络 */
    var miss = [];
    urls.forEach(function (u) {
      var k = tagStoreKey(u);
      if (TAG_SEEN[k]) {
        if (!TAG_INDEX[u] && TAG_STORE && TAG_STORE[k]) TAG_INDEX[u] = lbNormalize(TAG_STORE[k]);
        return;
      }
      var rec = tagStoreGet(u);
      if (rec) { TAG_INDEX[u] = lbNormalize(rec); TAG_SEEN[k] = 1; }
      else miss.push(u);
    });
    if (!miss.length) return;            /* 全都在缓存里，不用发请求 */

    /* ② 整表预取还没启动就先拉起来：它是"一次换长期快"的关键 */
    if (TAG_ALL_STATE === 0) prefetchAllTags();

    /* ③ 缺的推进队列；同时启动逃逸计时，最多等 TAG_GATE_WAIT */
    if (!TAG_GATE_AT) TAG_GATE_AT = Date.now();
    if (tagQueuePush(miss)) tagQueuePump();
  }

  /* 20261113D：空态必须自述「取到了什么、缺什么」。
     以前只有一句「该组合下暂无榜单数据」，站点名对不上、期次写法不同、
     数据确实没传，三种情况在页面上长得一模一样，只能靠猜。
     这里把本次真实查到的期次 / 站点 / 条数摊开写清楚。 */
  function fetchedDiag() {
    var items = (CACHE && CACHE.items) || [];
    var bySite = {}, order = [], byPeriod = {};
    items.forEach(function (it) {
      var s = String(it.site == null ? "" : it.site).trim() || "（站点为空）";
      if (!bySite[s]) { bySite[s] = 0; order.push(s); }
      bySite[s]++;
      var p = pLabel(it.period_label) || "（期次为空）";
      byPeriod[p] = (byPeriod[p] || 0) + 1;
    });
    order.sort(function (a, b) { return bySite[b] - bySite[a]; });
    var siteTxt = order.length
      ? order.slice(0, 12).map(function (s) { return s + " " + bySite[s]; }).join("、") + (order.length > 12 ? " 等 " + order.length + " 个" : "")
      : "无";
    var perTxt = Object.keys(byPeriod).length
      ? Object.keys(byPeriod).map(function (p) { return p + " " + byPeriod[p]; }).join("、")
      : "无";
    return '<br><span class="rk-note">本次实际取到 <b>' + items.length + '</b> 条：期次 ' + esc(perTxt)
      + '；站点 ' + esc(siteTxt)
      + '<br>当前选择：类目 ' + esc(CAT || "全部") + ' · 期次 ' + esc((activePeriods() || []).join(" / ") || "未选")
      + ' · 站点 ' + esc((viewSites() || []).join(" / ") || "全部站点")
      + ' · 对比模式 ' + esc(MODE === "c" ? "类目对比" : (MODE === "h" ? "国家对比" : "时间对比"))
      + ' · 脚本 ' + esc(BUILD || "") + '</span>';
  }

  function renderBody() {
    var box = $("#rk-body");
    if (!box) return;
    var sites = poolSites();
    var periods = activePeriods();

    if (!FACETS.periods.length) {
      box.innerHTML = '<div class="rk-empty">后台还没有上传榜单数据。上传后这里会按「类目 + 周次 + 国家」自动生成对比池。</div>';
      return;
    }
    if (!CAT) { box.innerHTML = '<div class="rk-empty">请先在左侧选择一个类目</div>'; return; }
    if (MODE === "c" && !activeCats().length) { box.innerHTML = '<div class="rk-empty">请在上方「对比类目」里勾选要比的类目（最多四个）。</div>'; return; }
    var _gchk = activeGroup();
    if (_gchk && !_gchk.members.length) { box.innerHTML = '<div class="rk-empty">地区「' + esc(_gchk.name) + '」还没有勾选国家。到后台「趋势上升榜 → 地区分组」点 ☑ 把国家勾进去即可。</div>'; return; }
    if (!sites.length) { box.innerHTML = '<div class="rk-empty">请在上方筛选中选择「国家站点」或「地区」</div>'; return; }
    if (!periods.length) { box.innerHTML = '<div class="rk-empty">请在上方筛选中选择周次 / 期次</div>'; return; }
    if (LOAD_ERR && (!CACHE || !CACHE.items.length)) {
      box.innerHTML = '<div class="rk-empty">数据加载失败，本次没有取到榜单数据（不是数据被删除）。'
        + '<br><a href="javascript:location.reload()">点这里刷新重试</a>；'
        + '若刷新后仍然如此，请把这次选中的类目 / 期次 / 站点截图发我，并让管理员在后台点一次「数据自检」，就能定位是没写进去还是读不到。</div>';
      return;
    }
    if (!CACHE || !CACHE.items.length) {
      box.innerHTML = '<div class="rk-empty">该组合下暂无榜单数据。'
        + '<br>多半是这三件事之一：①这批数据传到别的专区了（趋势上升榜 / 上新节奏 / 标题组词台 各自独立）；'
        + '②期次写法不同（第45周 / W45 / 45周）；③站点名对不上。'
        + fetchedDiag() + '</div>';
      return;
    }

    /* 先把标签取数发出去（并行），再看是否已核对完成 */
    ensureTags(CACHE.items);
    if (PRINT_HIDE && !tagsSettled(CACHE.items)) {
      box.innerHTML = '<div class="rk-empty rk-wait"><span class="rk-spin"></span>正在核对图案标签，稍候出图…（「图案印花款」已关闭展示，核对完才渲染，避免图案款先闪一下；同一批图第二次看会直接出图）</div>';
      return;
    }

    var all = CACHE.items.filter(hitTags);
    var _hidPrt = hiddenPrintCount(CACHE.items);
    if (!all.length) {
      box.innerHTML = _hidPrt
        ? '<div class="rk-empty">当前标签下的 ' + _hidPrt + ' 个款都是有图案的款，后台「图案印花款」开关已关闭，因此这里没有图。<br>要看到它们，请到后台把那项开关打开。</div>'
        : '<div class="rk-empty">当前标签下没有匹配的图片，试试切换「趋势标签」。</div>';
      return;
    }

    /* 三种对比模式都先出「体征卡」（只比构成、不比张数），再出图片列：
       类目对比比类目、国家对比比国家、时间对比比周次。
       以前这里锁死在 MODE === "c"，所以切到另外两种模式就整块消失。 */
    var vit = "";
    /* 20261113A：先算对比池，再算体征卡 —— 体征卡要用「池子实际画出来的列」过滤空列，
       顺序反了就会拿到上一次的列，仍会出现两边列数不一致。 */
    var R = buildPools(CAP);
    var VG = vitalsGroups();
    /* 20261113A：与对比池同口径 —— 池子里折叠掉的无数据列，体征卡与详细报告不再把它算作一列，
       否则会出现「上面 3 列、报告只 2 列」这种两边对不上的情况。 */
    if (LAST_POOL_MODE === MODE && LAST_POOL_KEYS) {
      var _kmap = {};
      LAST_POOL_KEYS.forEach(function (k) { _kmap[k] = 1; });
      VG = VG.filter(function (g) { return _kmap[g.key]; });
    }
    /* 详情默认收起 → 只有用户展开时才生成，切类目不再白算七节 */
    if (VG.length) vit = vitalsHtml(vitalsOfGroups(VG), vitalsDim(), { lazyDetail: !REP_OPEN });
    /* 打标数据已在函数开头取过一次（与展示模式无关） */
    if (ONLY !== "off" && !R.kept) {
      box.innerHTML = '<div class="rk-empty">当前筛选里没有「' + onlyLabel() + '」的图片。点筛选里的「全部」可以看回所有图。</div>';
      return;
    }
    /* 选中的周列里有几列在本组合下确实没有图 → 已折叠；全部为空时给出空态而不是大片留白 */
    if (!R.cols) {
      /* 取到了数据却一列都画不出来：把取到的站点摊开写清楚，
         并给出「点全部站点」这条唯一有效的出口，不再让人对着空白页猜。 */
      var _ss = (viewSites() || []);
      box.innerHTML = '<div class="rk-empty">该组合下暂无榜单数据'
        + (_ss.length ? '（所选站点「' + esc(_ss.join(" / ")) + '」在这些期次、这个类目下没有图）' : '')
        + '。换一个周次或站点试试，也可以点上方的「全部站点」把各国合并看。'
        + fetchedDiag() + '</div>';
      return;
    }
    var html = '';
    if (R.dropped) {
      var _dtxt = R.dropKind === "site"
        ? ('已自动隐藏 <b>' + R.dropped + '</b> 个国家列（该国这一期在这个类目下没有上传）')
        : (R.dropKind === "cat"
          ? ('已自动隐藏 <b>' + R.dropped + '</b> 个无数据的类目列（该类目这一周没有上传）')
          : ('已自动隐藏 <b>' + R.dropped + '</b> 个无数据的周列（该周这个国家 / 类目没有上传）'));
      if (R.dropNames && R.dropNames.length) _dtxt += '：<b>' + esc(R.dropNames.join(" / ")) + '</b>';
      html += '<div class="rk-dropnote">' + _dtxt + '，'
        + '剩余 <b>' + R.cols + '</b> 列已铺满宽度。</div>';
    }
    if (_hidPrt) {
      html += '<div class="rk-dropnote">后台已关闭「图案印花款」前台展示，本次隐藏 <b>' + _hidPrt
        + '</b> 个含图案的款式（章仔 / 织唛 / 印花标这类辅料、拉链 / 荷叶边这类结构件不计入）。</div>';
    }
    var cov = coverageOf();
    if (cov.total) {
      var covTxt = '本视图共 <b>' + cov.total + '</b> 张图，其中 <b>' + cov.has + '</b> 张已打标（' + cov.pct + '%）';
      /* 降级提示：读标签时若因为「节日列不存在」退了一级，节日维度会静默消失，
         看起来就像"这条标没打上"。这里明确说出来，避免再靠猜。 */
      if (SBX && typeof SBX.__rankTagLevel === "number" && SBX.__rankTagLevel >= 1) {
        covTxt += ' <span style="color:#b45309">· 节日维度暂不可用（数据库未执行 R 补丁），其余维度正常</span>';
      }
      if (!cov.has) covTxt += ' —— 一张都没有读到标签：请先确认后台「导出打标表 → 回填」是否真的写入，以及数据库补丁是否已执行。';
      else if (TAGGED === "off") covTxt += '；点上方「只看已打标」可只显示这部分图。';
      html += '<div class="rk-covnote">' + covTxt + '</div>';
    }
    html += vit + '<div class="rk-pools" id="rk-pools">' + R.html + '</div>';
    var maxLen = R.maxLen;

    if (maxLen > CAP) {
      html += '<div class="rk-more-wrap"><button type="button" class="rk-loadmore" id="rk-loadmore">展开更多（已展示 ' + CAP + ' / 最多 ' + maxLen + '）</button></div>';
    }
    box.innerHTML = html;
    if (REP_OPEN) syncRepDetail(box);   /* 重绘后保持展开状态 */

    var more = $("#rk-loadmore");
    if (more) more.onclick = function () {
      CAP = Math.min(CAP_MAX, CAP + CAP_STEP);
      renderBody(); renderBar();
    };

    bindPoolDrag(box);

    // 卡片点击 → 灯箱
    Array.prototype.forEach.call(box.querySelectorAll(".rk-card"), function (el) {
      el.onclick = function () { openLB(el.getAttribute("data-url")); };
    });

    fitPoolsSoon();
    syncFavUI();
  }

  /* ================= 我的收藏：收藏 / 多选批量 / 取消 =================
     · 星标状态按「期次 + 图地址」判定：同一张图在 W40 与 W41 各算一条，
       所以在 W40 收藏了不会把 W41 那一列也点亮（用户明确要求两条）。
     · 未登录、或建表脚本还没执行 → 只提示，不发任何写请求。 */
  var FAV = { ready: null, uid: null, cats: [], keys: {}, sel: {}, rows: [], batch: false, catId: null, pop: null };
  var FAV_COLORS = ["#8b7355", "#c25e5a", "#4a9c6d", "#5b7c9d", "#b08a4f", "#8a6fa8", "#4f8f8a", "#a0685a"];

  function favKey(period, url) { return String(period || "") + "\u0001" + String(url || ""); }
  function favColorOf(i) { return FAV_COLORS[((i % FAV_COLORS.length) + FAV_COLORS.length) % FAV_COLORS.length]; }
  function favColorFor(cat, idx) { return (cat && cat.color) || favColorOf(idx); }

  async function loadFavState() {
    FAV.ready = false;
    if (!SBX || typeof SBX.favReady !== "function") return;
    try { FAV.ready = await SBX.favReady(); } catch (e) { FAV.ready = false; }
    try { FAV.uid = (await SBX.favUid()) || null; } catch (e) { FAV.uid = null; }
    if (!FAV.uid || !FAV.ready) return;
    try { FAV.cats = await SBX.listFavCategories(); } catch (e) { FAV.cats = []; }
    try {
      var rows = await SBX.listFavKeys();
      var m = {};
      (rows || []).forEach(function (r) { m[favKey(r.period_label, r.image_url)] = r.id || 1; });
      FAV.keys = m;
    } catch (e) { FAV.keys = {}; }
  }

  function syncFavUI() {
    var box = $("#rk-body");
    if (box) {
      Array.prototype.forEach.call(box.querySelectorAll(".rk-card[data-url]"), function (fig) {
        var k = favKey(fig.getAttribute("data-period"), fig.getAttribute("data-url"));
        var on = !!FAV.keys[k];
        var b = fig.querySelector(".rk-fav");
        if (b) { b.setAttribute("data-fav", on ? "1" : "0"); b.textContent = on ? "★" : "☆"; }
        var p = fig.querySelector(".rk-pick");
        if (p) p.setAttribute("data-pick", FAV.sel[k] ? "1" : "0");
      });
    }
    var n = Object.keys(FAV.sel).length;
    var bb = $("#rk-batch-fav");
    if (bb) {
      bb.textContent = "批量收藏（" + n + "）";
      bb.classList.toggle("hidden", !n || !FAV.uid);
    }
  }

  function favCardData(fig) {
    return {
      image_url: fig.getAttribute("data-url") || "",
      period_label: fig.getAttribute("data-period") || "",
      period_type: fig.getAttribute("data-ptype") || "week",
      title: fig.getAttribute("data-title") || "",
      leaf_category: fig.getAttribute("data-leaf") || "",
      rank_category: fig.getAttribute("data-cat") || "",
      site: fig.getAttribute("data-site") || "",
      ratio: fig.getAttribute("data-ratio") || null,
      rank_abs: fig.getAttribute("data-rank") || null,
      rank_pos: fig.getAttribute("data-rank") || null,
      tags: String(fig.getAttribute("data-tags") || "").split("|")
        .filter(function (x) { return x && x.trim(); })
    };
  }

  function favNeedLogin() {
    if (!FAV.uid) { toast("请先登录后再收藏"); return true; }
    if (!FAV.ready) { toast("收藏表还没建好，请先执行 tools/patch_20261021R.sql"); return true; }
    return false;
  }

  function closeFavPop() {
    if (FAV.pop && FAV.pop.parentNode) FAV.pop.parentNode.removeChild(FAV.pop);
    FAV.pop = null; FAV.rows = []; FAV.batch = false; FAV.catId = null;
  }

  function openFavPop(rows, opt) {
    var o = opt || {};
    closeFavPop();
    FAV.rows = rows || [];
    if (!FAV.rows.length) return;
    FAV.batch = !!o.batch;
    FAV.catId = null;
    var already = (!FAV.batch && FAV.rows.length === 1)
      ? !!FAV.keys[favKey(FAV.rows[0].period_label, FAV.rows[0].image_url)] : false;

    var head = already ? "已收藏" : (FAV.batch ? "批量收藏 " + FAV.rows.length + " 张" : "收藏到「我的收藏」");
    var h = '<div class="fp-mask" data-fp="mask"></div><div class="fp-box" role="dialog" aria-label="我的收藏">';
    h += '<div class="fp-head"><span class="fp-t">' + esc(head) + '</span>'
      + '<button type="button" class="fp-x" data-fp="close" aria-label="关闭">×</button></div>';
    if (!FAV.ready) {
      /* 表还没建好：不要等用户点「收藏」才报错，进来就把原因和下一步说清楚 */
      h += '<div class="fp-body">'
        + '<div class="fp-miss">收藏功能还没启用。</div>'
        + '<div class="fp-hint">需要管理员在数据库执行一次建表脚本 <code>tools/patch_20261021R.sql</code>。'
        + '脚本末尾会刷新接口缓存，执行完点下面的按钮即可，不用重新部署。</div>'
        + '</div>'
        + '<div class="fp-foot"><button type="button" class="fp-cancel" data-fp="close">关闭</button>'
        + '<button type="button" class="fp-ok" data-fp="recheck">我建好了，重新检测</button></div>';
    } else if (already) {
      h += '<div class="fp-body"><div class="fp-done">这张图已经收藏过了（' + esc(FAV.rows[0].period_label || "本批") + '）。</div>'
        + '<div class="fp-hint">同一个分类下想调整位置，可以到「我的收藏」里拖拽。</div></div>';
      h += '<div class="fp-foot"><button type="button" class="fp-cancel" data-fp="close">关闭</button>'
        + '<button type="button" class="fp-del" data-fp="unfav">取消收藏</button></div>';
    } else {
      h += '<div class="fp-body"><div class="fp-sub">选择分类</div><div class="fp-cats">';
      FAV.cats.forEach(function (c, i) {
        h += '<button type="button" class="fp-cat' + (FAV.catId === c.id ? " is-on" : "") + '" data-cat="' + c.id + '">'
          + '<i class="fp-dot" style="background:' + favColorFor(c, i) + '"></i>'
          + '<span class="fp-cn">' + esc(c.name) + '</span></button>';
      });
      h += '<button type="button" class="fp-cat is-none" data-cat=""><i class="fp-dot is-empty"></i><span class="fp-cn">不分类（直接收藏）</span></button>';
      h += '</div>';
      h += '<div class="fp-new"><input class="fp-input" maxlength="40" placeholder="或者新建一个分类…" data-fp="name">'
        + '<button type="button" class="fp-addbtn" data-fp="newcat">新建并收藏</button></div>';
      h += '</div>';
      h += '<div class="fp-foot"><button type="button" class="fp-cancel" data-fp="close">取消</button>'
        + '<button type="button" class="fp-ok" data-fp="ok">收藏</button></div>';
    }
    h += '</div>';

    var wrap = document.createElement("div");
    wrap.className = "fav-pop-wrap";
    wrap.id = "rk-fav-pop";
    wrap.innerHTML = h;
    document.body.appendChild(wrap);
    FAV.pop = wrap;

    wrap.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-fp="mask"]') || t.closest('[data-fp="close"]')) { closeFavPop(); return; }
      var cat = t.closest(".fp-cat");
      if (cat) {
        var v = cat.getAttribute("data-cat");
        FAV.catId = v ? Number(v) : null;
        Array.prototype.forEach.call(wrap.querySelectorAll(".fp-cat"), function (x) { x.classList.remove("is-on"); });
        cat.classList.add("is-on");
        return;
      }
      if (t.closest('[data-fp="recheck"]')) { favRecheck(wrap); return; }
      if (t.closest('[data-fp="newcat"]')) { favCreateAndSave(wrap); return; }
      if (t.closest('[data-fp="ok"]')) { favSave(wrap, FAV.catId); return; }
      if (t.closest('[data-fp="unfav"]')) { favRemoveOne(wrap); return; }
    });
    wrap.addEventListener("keydown", function (e) {
      if (!e || !e.key) return;
      if (e.key === "Escape") { closeFavPop(); return; }
      if (e.key === "Enter" && e.target && e.target.getAttribute && e.target.getAttribute("data-fp") === "name") {
        favCreateAndSave(wrap);
      }
    });
  }

  /* 用户执行完建表脚本后，不刷新页面直接重新检测一次 */
  async function favRecheck(wrap) {
    var btn = wrap.querySelector('[data-fp="recheck"]');
    if (btn) { btn.disabled = true; btn.textContent = "检测中…"; }
    var rows = FAV.rows.slice();
    var batch = FAV.batch;
    await loadFavState();
    if (FAV.ready) {
      syncFavUI();
      closeFavPop();
      openFavPop(rows, { batch: batch });
      toast("收藏功能已就绪");
    } else {
      if (btn) { btn.disabled = false; btn.textContent = "我建好了，重新检测"; }
      toast("还是连不上：请确认脚本执行在这个站点对应的数据库里");
    }
  }

  async function favSave(wrap, catId) {
    if (favNeedLogin()) { closeFavPop(); return; }
    var btn = wrap.querySelector('[data-fp="ok"]');
    if (btn) { btn.disabled = true; btn.textContent = "收藏中…"; }
    try {
      var n = await SBX.addFavItems(FAV.rows, catId);
      FAV.rows.forEach(function (r) { FAV.keys[favKey(r.period_label, r.image_url)] = 1; });
      var wasBatch = FAV.batch;
      if (wasBatch) FAV.sel = {};
      closeFavPop();
      syncFavUI();
      favDrawerSync();
      toast("已收藏 " + n + " 张 · 右侧「我的收藏」可查看");
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "收藏"; }
      toast((e && e.message) ? e.message : "收藏失败");
    }
  }

  async function favCreateAndSave(wrap) {
    var inp = wrap.querySelector('[data-fp="name"]');
    var name = inp ? String(inp.value || "").trim() : "";
    if (!name) { toast("先给新分类起个名字"); if (inp && inp.focus) inp.focus(); return; }
    if (favNeedLogin()) { closeFavPop(); return; }
    var add = wrap.querySelector('[data-fp="newcat"]');
    if (add) { add.disabled = true; add.textContent = "新建中…"; }
    try {
      var c = await SBX.createFavCategory(name, favColorOf(FAV.cats.length));
      try { FAV.cats = await SBX.listFavCategories(); } catch (e2) { FAV.cats = FAV.cats.concat([c]); }
      await favSave(wrap, (c && c.id) ? c.id : null);
    } catch (e) {
      if (add) { add.disabled = false; add.textContent = "新建并收藏"; }
      toast((e && e.message) ? e.message : "新建分类失败");
    }
  }

  /* 收藏变动后同步右侧抽屉：抽屉开着即时刷新，关着只更新角标 */
  function favDrawerSync() {
    try { if (window.FavDrawer && FavDrawer.refresh) FavDrawer.refresh(); } catch (e) { /* 抽屉异常不影响收藏主流程 */ }
  }

  async function favRemoveOne(wrap) {
    var r = FAV.rows[0];
    if (!r) { closeFavPop(); return; }
    try {
      var id = FAV.keys[favKey(r.period_label, r.image_url)];
      if (!id || id === 1) {
        var list = await SBX.listFavItems({ period: r.period_label });
        var hit = (list || []).filter(function (x) { return x.image_url === r.image_url; })[0];
        if (hit) id = hit.id;
      }
      if (id) await SBX.removeFavItems([id]);
      delete FAV.keys[favKey(r.period_label, r.image_url)];
      closeFavPop(); syncFavUI();
      favDrawerSync();
      toast("已取消收藏");
    } catch (e) {
      toast((e && e.message) ? e.message : "取消收藏失败");
    }
  }

  /* 20261102Y：图表「点击」放大，弹窗不再占满全屏。
     -----------------------------------------------------------------
     之前的悬停全屏有两个问题：
       ① 鼠标扫过就弹，看图过程中容易被反复打断；
       ② 放大卡铺满整屏并锁了背景滚动，想接着看下一张图得先关掉。
     现在改成：点一下才放大；弹窗控制在 980×72vh 以内、居中浮起，
     背景页面仍可正常滚动（滚轮不会再用不了），看完点窗口外或按 Esc 收起。 */
  var ZOOM_OV = null, ZOOM_SRC = null;
  function repZoomClose() {
    if (ZOOM_OV && ZOOM_OV.parentNode) ZOOM_OV.parentNode.removeChild(ZOOM_OV);
    ZOOM_OV = null; ZOOM_SRC = null;
  }
  function repZoomOpen(ch) {
    if (ZOOM_OV && ZOOM_OV.parentNode) ZOOM_OV.parentNode.removeChild(ZOOM_OV);
    var ov = document.createElement("div");
    ov.className = "rk-zoom-ov";

    /* 克隆一份：原图留在原位，关闭后页面不重排 */
    var card = ch.cloneNode(true);
    card.className = "rk-ch rk-zoom-card";

    var x = document.createElement("button");
    x.type = "button";
    x.className = "rk-zoom-x";
    x.setAttribute("aria-label", "关闭放大");
    x.textContent = "×";
    x.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); repZoomClose(); });
    card.appendChild(x);

    var tip = document.createElement("div");
    tip.className = "rk-zoom-tip";
    tip.textContent = "点窗口外或按 Esc 收起 · 页面仍可继续滚动";
    ov.appendChild(card);
    ov.appendChild(tip);

    /* 点遮罩空白处关闭（卡内点击不会关，方便选中/滚动卡内内容） */
    ov.addEventListener("click", function (e) {
      if (e.target === ov) repZoomClose();
    });

    (document.body || document.documentElement).appendChild(ov);
    ZOOM_SRC = ch;
    ZOOM_OV = ov;
  }
  function bindRepZoom() {
    if (bindRepZoom.__b) return;
    bindRepZoom.__b = true;

    /* 点击才放大：不再用 mouseover，鼠标扫过不会再弹 */
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest(".rk-zoom-ov")) return;          /* 放大层内部不再套一层 */
      if (t.closest(".rk-zoom-x")) return;
      var ch = t.closest(".rk-ch");
      if (!ch) return;
      /* 卡片里如果有可点的行/图例，别被放大抢走 */
      if (t.closest("a,button,select,input,label")) return;
      e.preventDefault();
      repZoomOpen(ch);
    });

    /* Esc 关闭 */
    document.addEventListener("keydown", function (e) {
      if ((e.key === "Escape" || e.key === "Esc" || e.keyCode === 27) && ZOOM_OV) repZoomClose();
    });

    /* 只在这两种情况下自动收起：改窗口大小、切走标签页。
       滚动**不再**关闭——用户就是想边看放大图边往下翻。 */
    window.addEventListener("resize", repZoomClose);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) repZoomClose();
    });
  }

  function bindFav() {
    var box = $("#rk-body");
    /* 20261102K：报告详情折叠。详情块是每次重绘都换新的 DOM，
       用捕获阶段的委托来开关，重绘后不用重新绑定。展开状态记在 REP_OPEN 上，
       切筛选重绘也保持展开，不会一刷新就收回去。 */
    if (box && !box.__repBound) {
      box.__repBound = true;
      box.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var btn = t.closest("[data-rep-toggle]");
        if (!btn) return;
        e.preventDefault(); e.stopPropagation();
        REP_OPEN = !REP_OPEN;
        syncRepDetail(box);
      }, true);
    }
    bindRepZoom();
    if (box && !box.__favBound) {
      box.__favBound = true;
      /* 捕获阶段拦截：卡片自身有「点击开灯箱」，星标与勾选必须先被我们吃掉 */
      box.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var favBtn = t.closest(".rk-fav");
        if (favBtn) {
          e.preventDefault(); e.stopPropagation();
          var fig = favBtn.closest(".rk-card");
          if (!fig) return;
          if (favNeedLogin()) return;
          openFavPop([favCardData(fig)], {});
          return;
        }
        var pick = t.closest(".rk-pick");
        if (pick) {
          e.preventDefault(); e.stopPropagation();
          var fig2 = pick.closest(".rk-card");
          if (!fig2) return;
          if (favNeedLogin()) return;
          var k = favKey(fig2.getAttribute("data-period"), fig2.getAttribute("data-url"));
          if (FAV.sel[k]) delete FAV.sel[k]; else FAV.sel[k] = 1;
          syncFavUI();
          return;
        }
      }, true);
    }
    if (box && !box.__favDragBound) {
      box.__favDragBound = true;
      /* 直接从榜单把图拖到某个分类上 = 收藏并归类。
         拖动一开始把分类以「横向扇形」贴右侧摊开（向右展开，不压住正在拖的那张图），
         一步到位；右侧抽屉若已展开，其分类按钮仍是有效落点，两条路径都通。 */
      box.addEventListener("dragstart", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var fig = t.closest(".rk-card");
        if (!fig) return;
        if (favNeedLogin()) { try { e.preventDefault(); } catch (x) {} return; }
        var row = favCardData(fig);
        FAV.dragRow = row;
        try {
          e.dataTransfer.setData("application/x-fav-row", JSON.stringify(row));
          e.dataTransfer.setData("text/plain", row.title || row.image_url);
          e.dataTransfer.effectAllowed = "copy";
        } catch (x) {}
        fig.classList.add("is-fav-dragging");
        if (window.FavFan && typeof FavFan.show === "function") {
          /* 把起点交过去：菜单先贴在不挡来路的一侧，等看出拖动方向再滑过去 */
          try { FavFan.show(e); } catch (x) {}
        }
      }, true);
      box.addEventListener("dragend", function (e) {
        var t = e.target;
        var fig = (t && t.closest) ? t.closest(".rk-card") : null;
        if (fig) fig.classList.remove("is-fav-dragging");
        FAV.dragRow = null;
        if (window.FavFan && typeof FavFan.hide === "function") {
          try { FavFan.hide(); } catch (x) {}
        }
        if (window.FavDrawer && typeof FavDrawer.endDropMode === "function") {
          try { FavDrawer.endDropMode(); } catch (x) {}
        }
      }, true);
    }

    if (!document.__favBatchBound) {
      document.__favBatchBound = true;
      document.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (!t.closest("#rk-batch-fav")) return;
        if (favNeedLogin()) return;
        var rows = [];
        var box2 = $("#rk-body");
        if (box2) {
          Array.prototype.forEach.call(box2.querySelectorAll(".rk-card[data-url]"), function (fig) {
            var k = favKey(fig.getAttribute("data-period"), fig.getAttribute("data-url"));
            if (FAV.sel[k]) rows.push(favCardData(fig));
          });
        }
        if (!rows.length) { toast("先点图左上角的勾选，再批量收藏"); return; }
        openFavPop(rows, { batch: true });
      });
    }
  }

  async function initFav() {
    bindFav();
    await loadFavState();
    syncFavUI();
  }

  /* ---------------- 对比池：横向铺满 + 纵向自然向下排 ----------------
     需求口径（用户明确）：不管选了几列对比，横向都要铺满、不溢出到右侧、不需要横向滚动；
     而且**不要为了塞进一屏把图片缩小** —— 图多就往下排，页面自己纵向滚动。
     所以这里只按「列宽 + 图幅档位目标卡宽」反推每行几张：卡片大小与列数、屏幕高度都无关。 */
  var POOL_GAP = 10;          /* 列与列之间的缝（px）—— 必须与 CSS 的 .rk-pools gap 一致 */
  var POOL_VGAP = 6;          /* 图与图之间的缝（px）—— 必须与 CSS 的 .rk-pool-grid gap 一致 */
  var POOL_MIN_CARD = 34;     /* 卡片最小可读宽度（px）：硬下限 */
  /* 每行张数上限：这里曾经是 12 —— 那正是「小档和中档一样大」的根因：
     单列时两档的目标宽度都算到 12 以上，被这个上限一起截到 12，于是三档看不出区别；
     同时列数一多（3/4 列），列宽变小、每行张数却没跟着变小，图片就被压小了。
     现在上限放宽到 40，真正决定张数的是「列宽 ÷ 档位目标卡宽」。 */
  var POOL_R_MAX = 40;
  /* 图幅档位 → 目标卡片宽度（px）。三档目标宽度拉得足够开，保证四舍五入后仍不撞档。 */
  var SIZE_TARGET = { s: 70, m: 130, l: 220 };
  function sizeTargetW() { return SIZE_TARGET[SIZE] || SIZE_TARGET.m; }
  var poolFitTimer = null;

  /* 每行排几张：只由「该列实际宽度 + 图幅档位目标卡宽」决定 ——
     卡片的绝对大小 ≈ 档位目标宽度，与**选了几列对比**、屏幕高度都无关。
     这一条是用户明确要求：3 列、4 列时图片不能被压小，图多就继续往下排。
     做法：先各自按目标宽度算出张数，再强制保证档位顺序（小 > 中 > 大）——
     否则窄列时四舍五入会把两档撞成同一个张数，又变成「点了没反应」。
     最后由 grid 的 1fr 把整行拉满（横向铺满、不溢出、不出现横向滚动条）。 */
  function poolColsFromWidth(colW, n) {
    var gap = POOL_VGAP;
    var avail = colW + gap;
    var rS = Math.max(1, Math.round(avail / (SIZE_TARGET.s + gap)));
    var rM = Math.max(1, Math.round(avail / (SIZE_TARGET.m + gap)));
    var rL = Math.max(1, Math.round(avail / (SIZE_TARGET.l + gap)));
    if (rM <= rL) rM = rL + 1;                 /* 档位顺序硬保证：中 > 大 */
    if (rS <= rM) rS = rM + 1;                 /* 档位顺序硬保证：小 > 中 */
    var r = SIZE === "s" ? rS : (SIZE === "l" ? rL : rM);
    var maxCols = Math.floor(avail / (POOL_MIN_CARD + gap));   /* 硬下限：不低于最小可读宽度 */
    r = Math.min(r, POOL_R_MAX, Math.max(1, maxCols), Math.max(1, n));
    return Math.max(1, r);
  }

  function fitPools() {
    var pools = document.querySelector("#rank-view .rk-pools") || document.querySelector(".rk-pools");
    if (!pools) return;
    var cols = pools.querySelectorAll(".rk-pool");
    if (!cols.length) return;
    var K = cols.length;

    Array.prototype.forEach.call(cols, function (col) {
      var grid = col.querySelector(".rk-pool-grid");
      if (!grid) return;
      var n = grid.querySelectorAll(".rk-card").length;
      if (!n) return;
      var colW = grid.clientWidth || 0;
      if (!colW) {
        /* 刚写入 DOM 还没排版出来时按容器宽度估一个（下一帧 resize 会再校正） */
        colW = Math.max(1, ((pools.clientWidth || 0) - (K - 1) * POOL_GAP) / K);
      }
      grid.style.setProperty("--rk-r", String(poolColsFromWidth(colW, n)));
    });
    /* 不再有「一屏塞不下就裁掉」的概念：图多就往下排、页面纵向滚动，图片尺寸保持不变 */
    pools.setAttribute("data-pool-clip", "0");
  }

  function fitPoolsSoon() {
    if (poolFitTimer) clearTimeout(poolFitTimer);
    poolFitTimer = setTimeout(function () { poolFitTimer = null; try { fitPools(); } catch (e) {} }, 60);
  }

  /* ---------------- 天眼：一屏铺满「每一列的全部图」 ---------------- */
  /* 需求口径：打开天眼 → 每一列（每个国家 / 每个期次）的【全部图片】都在，
     不受「每列最多展示 N 张」限制、不需要点「加载更多」；图片全部直接加载（不懒加载）、
     比例自适应、尽量铺满一屏——一眼就能看全，不用下滑。
     列范围可切换：默认=当前对比列（2/3/4 列），另可切「全部站点 × 全部期次」。 */
  var EYE_ALL = false;        /* 列范围：false=当前对比列，true=全部站点×全部期次 */
  var EYE_PERIODS_MAX = 2;    /* 天眼默认最多对比的周数：列少了每列更宽，图片能明显放大 */
  var EYE_PERIOD_CLAMPED = false;  /* 本次是否真的发生了「按默认收紧到最近 N 周」 */
  var EYE_EAGER_MAX = 1500;   /* 图数超过此上限才退回懒加载，避免一次拉爆（默认全加载） */
  var EYE_R_MAX = 60;         /* 每行最多排几张（真正的下限由「最小卡片宽度」兜住） */
  var EYE_MIN_CARD = 20;      /* 卡片最小宽度（px）：低于这个就看不清了 */
  var EYE_TARGET_CARD = 150;  /* 天眼里卡片的自然宽度（px）：每行几张只按列宽算，不按屏幕高度缩图 */
  var EYE_GAP = 2;            /* 同列里图与图的横向缝（px）——必须与 CSS 的 --eye-gap 保持一致 */
  var EYE_VGAP = 2;           /* 同列里图与图的纵向缝（px）——必须与 CSS 的 gap 保持一致 */
  /* 天眼标签开关（固定蓝栏里的眼睛按钮）：默认显示，但标签一律画在【图片上方/下方】的正常流里，
     不会叠在图上；关掉后整条隐藏、图片区自然变大。选择会记住，下次打开保持上次状态。 */
  var EYE_LABELS = true;
  try { if (localStorage.getItem("rk-eye-labels") === "0") EYE_LABELS = false; } catch (eL) { /* 取不到就用默认值 */ }
  function saveEyeLabels() {
    try { localStorage.setItem("rk-eye-labels", EYE_LABELS ? "1" : "0"); } catch (eL2) { /* 忽略 */ }
  }
  function applyEyeLabels(panel) {
    if (!panel) return;
    panel.classList.toggle("labels-off", !EYE_LABELS);
    var btn = panel.querySelector("#rk-eye-tag");
    if (btn) {
      btn.classList.toggle("on", EYE_LABELS);
      btn.setAttribute("aria-pressed", EYE_LABELS ? "true" : "false");
      btn.title = EYE_LABELS ? "标签：显示中（点击隐藏）" : "标签：已隐藏（点击显示）";
    }
  }
  var eyeFitBound = null, eyeFsBound = null;

  /* 天眼要铺开的列范围 */
  function eyeScope() {
    /* 纵向 / 类目对比：站点口径跟页面一致（选了「全部站点」就取全部），
       否则天眼会把「只选一个站点」时看不到的图也画进来，张数与页面列头对不上。 */
    function eyeSites() {
      if (MODE === "h") return poolSites();
      var vs = viewSites();
      return vs || orderedSites();
    }
    /* 类目对比：天眼守死「同一周 · 同一站点 · 当前这几个类目」，
       不提供「全部站点 × 全部期次」那种范围（那会把列数乘起来，图上没法看） */
    if (MODE === "c") {
      EYE_PERIOD_CLAMPED = false;
      return { sites: eyeSites(), periods: activePeriods(), cats: activeCats() };
    }
    if (!EYE_ALL) {
      /* 天眼默认只对比最近两周：列数少了，每列更宽，图自然更大。
         需要看更多周时，点顶栏的「范围」切到「全部站点 × 全部期次」。 */
      var ps = activePeriods();
      EYE_PERIOD_CLAMPED = ps.length > EYE_PERIODS_MAX;
      if (EYE_PERIOD_CLAMPED) ps = ps.slice(ps.length - EYE_PERIODS_MAX);
      return { sites: eyeSites(), periods: ps };
    }
    /* 「全部站点 × 全部期次」不受两周限制，顶栏的「默认两周」提示也必须随之消失
       （否则切一次范围后提示会一直挂着，与屏幕上的实际列数对不上）。 */
    EYE_PERIOD_CLAMPED = false;
    if (MODE === "h") return { sites: orderedSites(), periods: sortPeriods(FACETS.periods).slice(-1) };
    return { sites: eyeSites(), periods: sortPeriods(FACETS.periods) };
  }

  /* 天眼自己的取数（独立于页面缓存口径；纵向仍需取「上一期」做基线） */
  async function eyeFetch(sc) {
    var sites = sc.sites || [], periods = sc.periods || [];
    if (!sites.length || !periods.length) return { items: [], sites: sites, periods: periods };
    var needPeriods = MODE === "v" ? withBasePeriods(periods) : periods;
    var cats = sc.cats || (MODE === "c" ? activeCats() : []);
    var filter = { sites: sites, periods: needPeriods };
    if (MODE === "c") {
      var _exp2 = [];
      cats.forEach(function (c) { _exp2 = _exp2.concat(catsOf(c)); });
      filter.categories = _exp2;
    }
    else if (CAT && CAT !== ALL) filter.categories = catsOf(CAT);
    else if (FACETS.categories.length) filter.categories = RAW_CATS.slice();
    var items = [];
    try { items = await SBX.listRankItems(filter); } catch (e) { items = []; }
    items = (items || []).map(function (it) {
      it.ratio = (it.ratio == null ? null : Number(it.ratio));
      it.abs_delta = (it.abs_delta == null ? null : Number(it.abs_delta));
      return it;
    });
    flagPools(items);
    /* 补进「图 → 归属信息」索引，天眼里点开大图也能看到站点/期次/标签 */
    items.forEach(function (it) { if (it.image_url && !ITEMS_BY_URL[it.image_url]) ITEMS_BY_URL[it.image_url] = it; });
    return { items: items, sites: sites, periods: periods, cats: cats };
  }

  /* 纯计算（天眼）：每行排几张 = 只由「列宽」决定。
     用户口径（明确）：不管几列对比都要横向铺满；**不要再为了塞进一屏把图片缩小** ——
     列数越多、屏幕越矮，都不允许把图压小，图多就直接往下排、页面自己纵向滚动。
     所以这里不再从「最小张数」往回试高度，而是按自然卡宽（EYE_TARGET_CARD）算张数；
     高度只用来判断「要不要允许下滑」（clipped）。 */
  function eyeFitCalc(availW, availH, K, maxN, opt) {
    opt = opt || {};
    var gap = opt.gap == null ? EYE_GAP : opt.gap;
    var vgap = opt.vgap == null ? EYE_VGAP : opt.vgap;
    var headH = opt.headH == null ? 46 : opt.headH;
    var capH = opt.capH == null ? 0 : opt.capH;   /* 每张图【上方/下方】标签栏的高度（天眼开着标签时才 > 0） */
    var minW = opt.minW == null ? EYE_MIN_CARD : opt.minW;
    var target = opt.target == null ? EYE_TARGET_CARD : opt.target;
    K = Math.max(1, K || 1);
    var colW = (availW - gap * (K - 1)) / K;
    if (!(colW > 0) || !(maxN > 0)) {
      return { r: 1, cardW: Math.max(minW, colW > 0 ? colW : minW), clipped: false };
    }
    var r = Math.round((colW + gap) / (target + gap));              /* 四舍五入 → 实际卡宽最接近自然卡宽 */
    var maxCols = Math.floor((colW + gap) / (minW + gap));          /* 硬下限：不低于最小可读宽度 */
    r = Math.max(1, Math.min(r, EYE_R_MAX, maxCols, Math.max(1, maxN)));
    var cardW = (colW - gap * (r - 1)) / r;
    var rows = Math.ceil(maxN / r);
    var needH = headH + rows * (cardW * 4 / 3 + vgap + capH);
    /* 一屏放得下 → 不用下滑；图多放不下 → 允许下滑（此时也不缩图，图片尺寸与列数无关） */
    var clipped = !(availH > 0) || needH > availH;
    return { r: r, cardW: cardW, clipped: clipped };
  }

  /* 把算出来的「每行几张 / 卡片宽 / 字号」落到样式变量上，并决定是否还需要下滑 */
  function fitEye(panel) {
    var body = panel.querySelector("#rk-eye-body") || panel.querySelector(".rk-eye-body");
    var pools = body ? body.querySelector(".rk-pools") : null;
    if (!body || !pools) return;
    var cols = pools.querySelectorAll(".rk-pool");
    var K = cols.length || 1;
    var maxN = 0;
    Array.prototype.forEach.call(cols, function (c) {
      var n = c.querySelectorAll(".rk-card").length;
      if (n > maxN) maxN = n;
    });
    if (!maxN) return;
    /* 单列可用宽度 = 该列网格的实测宽度（比「整行宽 ÷ 列数」准：
       列与列之间的缝、列自身的左右内边距都已被排掉，算出的「每行几张」不会偏大而把图挤出可视高度）。 */
    var g0 = cols[0] ? cols[0].querySelector(".rk-pool-grid") : null;
    var colW = (g0 && g0.clientWidth) ? g0.clientWidth : 0;
    if (!colW) {
      var poolPad = 0;
      try {
        var cstyle = getComputedStyle(cols[0]);
        poolPad = (parseFloat(cstyle.paddingLeft) || 0) + (parseFloat(cstyle.paddingRight) || 0);
      } catch (e) { poolPad = 0; }
      var poolsW = pools.clientWidth || body.clientWidth;
      colW = Math.max(1, (poolsW - (K - 1) * 4) / Math.max(1, K) - poolPad);
    }
    /* 天眼列头（周度）与卡片标签：开启时都画在【正常流内】的独立栏里（图片上方 / 下方），
       绝不叠在图上；这里把它们的实测高度扣掉，保证「一屏看全」的口径仍然成立。 */
    var headH = 0, capH = 0;
    if (EYE_LABELS) {
      var hz = cols[0] ? cols[0].querySelector(".rk-pool-head") : null;
      var cz = cols[0] ? cols[0].querySelector(".rk-eye-cap") : null;
      headH = hz ? (hz.offsetHeight || 0) : 0;
      capH = cz ? (cz.offsetHeight || 0) : 0;
    }
    /* 可用高度要扣掉外层内边距（clientHeight 含 padding），否则会把图算高一点、挤出行外 */
    var availH = body.clientHeight;
    try {
      var bstyle = getComputedStyle(body);
      availH = Math.max(1, body.clientHeight - (parseFloat(bstyle.paddingTop) || 0) - (parseFloat(bstyle.paddingBottom) || 0));
    } catch (e2) { /* 取不到样式就用原值 */ }
    var fit = eyeFitCalc(colW, availH, 1, maxN, { headH: headH, gap: EYE_GAP, vgap: EYE_VGAP, capH: capH });
    pools.style.setProperty("--eye-gap", EYE_GAP + "px");
    pools.style.setProperty("--eye-r", String(fit.r));
    pools.style.setProperty("--eye-card", fit.cardW.toFixed(1) + "px");
    pools.style.setProperty("--eye-fs", Math.max(7, Math.min(12, fit.cardW * 0.22)).toFixed(1) + "px");
    body.style.overflowY = fit.clipped ? "auto" : "hidden";
    panel.setAttribute("data-eye-clip", fit.clipped ? "1" : "0");
    var note = panel.querySelector("#rk-eye-clip");
    if (note) note.style.display = fit.clipped ? "" : "none";
  }

  function openEye() {
    var old = $("#rk-eye");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var d = document.createElement("div");
    d.id = "rk-eye";
    d.className = "rk-eye";
    d.innerHTML = '<div class="rk-eye-mask" id="rk-eye-mask"></div>' +
      '<div class="rk-eye-panel">' +
        /* 顶部固定蓝栏（正常流第一条，永不压图）：范围 / 排序 / 标签开关（眼睛）/ 导出 PPT / 关闭
           全部常显，点开就能用，不需要鼠标悬浮才出现。 */
        '<div class="rk-eye-head" id="rk-eye-head">' +
          '<span class="rk-eye-brand">天眼 · 全部对比图</span>' +
          '<span class="rk-eye-sub" id="rk-eye-sub">加载中…</span>' +
          '<span class="rk-eye-clip" id="rk-eye-clip" style="display:none">图数较多，已按最小尺寸铺满；剩余可下滑查看</span>' +
          '<span class="rk-eye-sp"></span>' +
          '<label class="rk-eye-sortwrap"><span class="rk-eye-sortlab">排序</span>' +
            '<select class="rk-eye-sortsel" id="rk-eye-sortsel" title="排序方式">' +
              '<option value="ratio_desc">环比比例 高→低</option>' +
              '<option value="ratio_asc">环比比例 低→高</option>' +
              '<option value="abs_desc">环比绝对值 高→低</option>' +
              '<option value="abs_asc">环比绝对值 低→高</option>' +
            '</select>' +
          '</label>' +
          '<button type="button" class="rk-eye-scope" id="rk-eye-scope"></button>' +
          '<button type="button" class="rk-eye-tag" id="rk-eye-tag" title="标签：显示中（点击隐藏）" aria-pressed="true"><span class="rk-eye-tagicon">👁</span><span class="rk-eye-tagtxt">标签</span></button>' +
          '<button type="button" class="rk-eye-ppt" id="rk-eye-ppt">导出 PPT</button>' +
          '<button type="button" class="rk-eye-close" id="rk-eye-close" title="关闭（Esc）">×</button>' +
        '</div>' +
        '<div class="rk-eye-body" id="rk-eye-body"><div class="rk-empty">加载中…</div></div>' +
        /* 悬浮放大镜：鼠标放到某张图上时，在旁边放大显示这张图，标签显示在放大图的下方 */
        '<div class="rk-eye-loupe" id="rk-eye-loupe" style="display:none">' +
          '<img id="rk-eye-loupe-img" alt="">' +
          '<div class="rk-eye-loupe-tags" id="rk-eye-loupe-tags"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);
    document.documentElement.classList.add("rk-eye-on");
    bindEye(d);
    applyEyeLabels(d);
    wireEyePpt(d);
    fillEye(d);
    enterEyeFullscreen(d);     /* 真·全屏：占满电脑屏幕；不支持或被拒时自动退化为「占满视口」 */
  }

  /* ---- 天眼 · 真全屏（占满电脑屏幕）---- */
  function eyeFsEl() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
  }
  function enterEyeFullscreen(d) {
    if (eyeFsEl()) return;                      /* 已在全屏中就不再重复请求 */
    try {
      var fn = d.requestFullscreen || d.webkitRequestFullscreen || d.msRequestFullscreen;
      if (!fn) return;
      var p = fn.call(d);
      if (p && p.catch) p.catch(function () { /* 忽略：未获授权时按「占满视口」显示，不影响使用 */ });
    } catch (e) { /* 忽略 */ }
  }
  function exitEyeFullscreen() {
    if (!eyeFsEl()) return;
    try {
      var fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (fn) { var p = fn.call(document); if (p && p.catch) p.catch(function () {}); }
    } catch (e) { /* 忽略 */ }
  }

  function bindEye(d) {
    d.addEventListener("click", function (e) {
      var t = e.target;
      if (t && (t.id === "rk-eye-close" || t.id === "rk-eye-mask")) { closeEye(); return; }
      if (t && t.id === "rk-eye-scope") { EYE_ALL = !EYE_ALL; openEye(); return; }   /* 切换列范围 */
      if (t && t.id === "rk-eye-tag") {                       /* 标签开关：图片上方/下方的标签整条显隐 */
        EYE_LABELS = !EYE_LABELS; saveEyeLabels(); applyEyeLabels(d);
        try { fitEye(d); } catch (e) { /* 重排失败不影响看图 */ }
        return;
      }
      if (t && t.id === "rk-eye-sortsel") return;             /* 排序下拉由自己的 change 处理 */
      if (t && t.id === "rk-eye-ppt") return;                  /* 导出 PPT 由按钮自己的 onclick 处理 */
      if (t && t.closest && t.closest("#rk-eye-loupe")) return; /* 放大镜不参与点击 */
      var card = (t && t.closest) ? t.closest(".rk-card") : null;
      if (card) openLB(card.getAttribute("data-url"));
    });
    /* 鼠标移到某张图上 → 旁边放大显示 + 图下方显示标签；移开即收起 */
    var body = d.querySelector("#rk-eye-body");
    if (body) {
      body.addEventListener("mouseover", function (e) {
        var card = (e.target && e.target.closest) ? e.target.closest(".rk-card") : null;
        if (!card || card === eyeHoverCard) return;
        eyeHoverCard = card;
        showEyeLoupe(d, card);
      });
      body.addEventListener("mouseout", function (e) {
        var card = (e.target && e.target.closest) ? e.target.closest(".rk-card") : null;
        if (!card || card !== eyeHoverCard) return;
        var to = e.relatedTarget;
        if (to && to.closest && to.closest(".rk-card") === card) return;   /* 还在同一张卡片内部移动 */
        eyeHoverCard = null;
        hideEyeLoupe(d);
      });
      body.addEventListener("mouseleave", function () { eyeHoverCard = null; hideEyeLoupe(d); });
    }
    var ssel = d.querySelector("#rk-eye-sortsel");
    if (ssel) {
      ssel.value = SORT;
      ssel.addEventListener("change", function () {
        SORT = ssel.value;
        try { fillEye(d); } catch (e) { /* 排序失败不影响看图 */ }
      });
    }
    document.addEventListener("keydown", eyeEsc);
    eyeFitBound = function () { fitEye(d); };
    window.addEventListener("resize", eyeFitBound);      /* 窗口变化重新铺满 */
    eyeFsBound = function () { fitEye(d); };             /* 进出全屏后视口尺寸变了，重新铺排一次 */
    document.addEventListener("fullscreenchange", eyeFsBound);
    document.addEventListener("webkitfullscreenchange", eyeFsBound);
  }

  async function fillEye(d) {
    var body = d.querySelector("#rk-eye-body");
    var sub = d.querySelector("#rk-eye-sub");
    var scb = d.querySelector("#rk-eye-scope");
    if (scb) scb.textContent = EYE_ALL ? "范围：全部站点 × 全部期次" : "范围：当前对比列";
    var sc = eyeScope();
    var R = { items: [], sites: sc.sites, periods: sc.periods };
    try { R = await eyeFetch(sc); } catch (e) { R = { items: [], sites: sc.sites, periods: sc.periods }; }
    if (!d.parentNode) return;                            /* 取数期间被关掉就不画了 */
    var total = (R.items || []).length;
    var eager = total <= EYE_EAGER_MAX;                   /* 默认「全部加载」，只有极端量级才退回懒加载 */
    var built = buildPools(Infinity, { items: R.items, sites: sc.sites, periods: sc.periods, cats: sc.cats, noFoot: true, eager: eager, eye: true });
    var n = 0;
    if (built.html) {
      body.innerHTML = '<div class="rk-pools">' + built.html + '</div>';
      n = body.querySelectorAll(".rk-card").length;
    } else {
      body.innerHTML = '<div class="rk-empty">当前口径下没有可显示的图片</div>';
    }
    var ss = d.querySelector("#rk-eye-sortsel");
    if (ss && ss.value !== SORT) ss.value = SORT;
    if (sub) {
      var colsN = (MODE === "v") ? sc.periods.length : (MODE === "c" ? (built.cols || (sc.cats || []).length) : sc.sites.length);
      var scopeTxt = (MODE === "v") ? (R.sites.join("、") || "—")
        : (MODE === "c" ? ((sc.cats || []).join("、") || "—") : (R.periods.join("、") || "—"));
      var colsTxt = (MODE === "v") ? "周" : (MODE === "c" ? "类目" : "国");
      /* 顶栏只留一行关键信息（类目 / 列数 / 张数）；范围明细收进悬浮提示，
         避免顶栏文字又长又大把图挤掉、甚至盖住图。 */
      sub.innerHTML = esc(MODE === "c" ? (activeCats().join(" / ") || CAT) : CAT) + ' · ' + colsN + ' ' + colsTxt + ' · 共 <b>' + n + '</b> 张' +
        (EYE_PERIOD_CLAMPED ? ' · <span class="rk-eye-dflt">默认只对比最近 ' + EYE_PERIODS_MAX + ' 周</span>' : '') +
        (eager ? '' : ' · <span class="rk-eye-warn">图数过多，已改为随滚动加载</span>');
      sub.title = (MODE === "v" ? "国家：" : (MODE === "c" ? "对比类目：" : "期次：")) + scopeTxt;
    }
    if (n) fitEye(d);
  }

  /* ---- 天眼 · 悬浮放大镜（纯图墙的必要补充：信息按需出现）----
     鼠标移到某张图上：在旁边浮出这张图的放大预览，标签贴在放大图的下方；
     移开即收起。放大镜不吃鼠标事件（pointer-events:none），不会打断滑动与点击。 */
  var eyeHoverCard = null;
  function hideEyeLoupe(d) {
    var l = d ? d.querySelector("#rk-eye-loupe") : null;
    if (l) l.style.display = "none";
  }
  function showEyeLoupe(d, card) {
    var l = d.querySelector("#rk-eye-loupe");
    if (!l) return;
    var im = card.querySelector("img");
    var url = card.getAttribute("data-url") || (im ? im.getAttribute("src") : "");
    if (!url) { hideEyeLoupe(d); return; }
    var li = l.querySelector("#rk-eye-loupe-img");
    if (li && li.getAttribute("src") !== url) li.setAttribute("src", url);
    var tb = l.querySelector("#rk-eye-loupe-tags");
    if (tb) {
      var meta = card.getAttribute("data-eye-meta") || "";
      var tags = (card.getAttribute("data-eye-tags") || "").split("|").filter(Boolean);
      var h = "";
      if (meta) h += '<div class="l-meta">' + esc(meta) + '</div>';
      if (tags.length) h += '<div class="l-chips">' + tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join("") + '</div>';
      if (!h) h = '<div class="l-meta">—</div>';
      tb.innerHTML = h;
    }
    l.style.display = "block";
    var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    var LW = Math.max(180, Math.min(340, Math.round(vw * 0.22)));
    var LH = Math.round(LW * 4 / 3) + 54;                    /* 图（3:4）+ 下方标签区 */
    var r = card.getBoundingClientRect();
    var x = r.right + 12;
    if (x + LW > vw - 8) x = r.left - LW - 12;
    if (x < 8) x = Math.max(8, Math.min(r.left, vw - LW - 8));
    var y = r.top;
    if (y + LH > vh - 8) y = Math.max(8, vh - LH - 8);
    l.style.width = LW + "px";
    l.style.left = Math.round(x) + "px";
    l.style.top = Math.round(Math.max(8, y)) + "px";
  }

  /* ---- 天眼 · 导出 PPT（仅超管可见；按钮放在悬浮才显现的顶栏里，不占图、不压图）---- */
  var eyeSuper = null;
  function eyeIsSuper() {
    if (eyeSuper !== null) return Promise.resolve(eyeSuper);
    return Promise.resolve()
      .then(function () { return isSuperAdmin(); })
      .then(function (ok) { eyeSuper = !!ok; return eyeSuper; })
      .catch(function () { eyeSuper = false; return false; });
  }
  function wireEyePpt(d) {
    var b = d.querySelector("#rk-eye-ppt");
    if (!b) return;
    b.onclick = function () {
      if (!window.ReportKit || !window.ReportKit.exportEye) return;
      window.ReportKit.exportEye();
    };
    eyeIsSuper().then(function (ok) { if (ok) b.className = "rk-eye-ppt on"; });
  }

  function eyeEsc(e) {
    if (e.key !== "Escape") return;
    if ($("#rk-lb")) return;              /* 灯箱开着时，先交给灯箱自己的 Esc 处理 */
    closeEye();
  }

  function closeEye() {
    var d = $("#rk-eye");
    if (d && d.parentNode) d.parentNode.removeChild(d);
    eyeHoverCard = null;
    document.documentElement.classList.remove("rk-eye-on");
    document.removeEventListener("keydown", eyeEsc);
    if (eyeFitBound) { window.removeEventListener("resize", eyeFitBound); eyeFitBound = null; }
    if (eyeFsBound) {
      document.removeEventListener("fullscreenchange", eyeFsBound);
      document.removeEventListener("webkitfullscreenchange", eyeFsBound);
      eyeFsBound = null;
    }
    exitEyeFullscreen();       /* 关天眼时一并退出全屏（若本次是由天眼进入的） */
  }

  /* ---------------- 灯箱（看图 + 左侧打标面板，不显示任何环比数值） ----------------
     20261027P：标签从卡片悬停浮层搬到这里。点开大图，左侧一列完整列出
     风格 / 文化背景 / 消费心理 / 视觉（背景·构图·主体）/ 图案类型 / 图案元素 / 结构部件 / 面料
     / 二次工艺 / 拍摄方式 / 版型，一次看全，不必在图墙上逐张悬停。
     20261102A：图案按 v11 拆成类型/元素/结构件三栏，另加面料一栏。 */
  function lbMetaBits(it) {
    var bits = [], b = badgeOf(it || {});
    if (it.site) bits.push(['站点', it.site]);
    if (it.period_label) bits.push(['期次', it.period_label]);
    var leaf = leafOf(it);
    if (leaf) bits.push(['叶子类目', leaf]);
    if (it.category && it.category !== it.leaf_category) bits.push(['类目', it.category]);
    if (b) bits.push(['趋势', b.txt]);
    return bits;
  }

  function openLB(url) {
    if (!url) return;
    var it = ITEMS_BY_URL[url] || {};
    var old = $("#rk-lb");
    if (old) old.parentNode.removeChild(old);
    var d = document.createElement("div");
    d.id = "rk-lb";
    d.className = "rk-lb";

    var meta = lbMetaBits(it).map(function (m) {
      return '<div class="rk-lb-mrow"><span class="rk-lb-mk">' + esc(m[0]) + '</span>'
        + '<span class="rk-lb-mv">' + esc(m[1]) + '</span></div>';
    }).join("");

    d.innerHTML = '<div class="rk-lb-stage" role="dialog" aria-label="榜单图片与打标信息">'
      + '<aside class="rk-lb-side">'
      +   '<div class="rk-lb-sh"><span class="rk-lb-smark">◆</span>图片信息</div>'
      +   (meta ? '<div class="rk-lb-meta">' + meta + '</div>' : '')
      +   lbTagsHtml(url)
      + '</aside>'
      + '<div class="rk-lb-main"><img src="' + esc(url) + '" alt="榜单图片"></div>'
      + '</div>'
      + '<button type="button" class="rk-lb-close" id="rk-lb-close" aria-label="关闭">×</button>';

    document.body.appendChild(d);
    document.documentElement.classList.add("rk-lb-open");
    d.onclick = function (e) {
      if (e.target === d || e.target.id === "rk-lb-close" || e.target.className === "rk-lb-close") closeLB();
    };
    document.addEventListener("keydown", lbEsc);
  }
  function lbEsc(e) { if (e.key === "Escape") closeLB(); }
  function closeLB() {
    var d = $("#rk-lb");
    if (d) d.parentNode.removeChild(d);
    document.documentElement.classList.remove("rk-lb-open");
    document.removeEventListener("keydown", lbEsc);
  }

  /* ---------------- 加载 ---------------- */
  async function load() {
    var box = $("#rk-body");
    var sites = sitesForQuery();
    var periods = activePeriods();
    if (!sites.length || !periods.length) { renderBody(); renderBar(); return; }
    /* 命中缓存就别闪「加载中」——闪一下反而更显得卡 */
    var _k = itemsKey();
    var _cached = (CACHE && CACHE.key === _k) || !!cacheGet(_k);
    if (box && !_cached) box.innerHTML = '<div class="rk-empty">加载中…</div>';
    await fetchItems();
    renderBody();
    renderBar();
    prefetchCategories();            /* 首屏出来后在后台把其它类目补进来 */
  }

  /* ---------------- 登录态（顶部显示 + 退出） ---------------- */
  async function renderAuth() {
    var email = "", ok = false;
    try {
      var s = await SBX.getSession();
      if (s && s.user) { email = s.user.email || ""; ok = true; }
    } catch (e) { /* 忽略 */ }
    var u = $("#rk-user"), lo = $("#rk-logout"), li = $("#rk-login");
    if (u) { u.textContent = email; u.classList.toggle("hidden", !ok); }
    if (lo) {
      lo.classList.toggle("hidden", !ok);
      lo.onclick = async function () {
        try { await SBX.signOut(); } catch (e) { /* 忽略 */ }
        location.href = "index.html";
      };
    }
    if (li) li.classList.toggle("hidden", ok);
    return ok;
  }

  /* ---------------- 无权限时的说明面板 ---------------- */
  function renderGate(box, why) {
    if ($("#rk-groups")) $("#rk-groups").innerHTML = '<div class="rk-note">当前账号不可访问该专区</div>';
    if ($("#rk-cats")) $("#rk-cats").innerHTML = '<div class="rk-empty">—</div>';
    if ($("#rk-bar")) $("#rk-bar").innerHTML = "";
    if ($("#rk-summary")) $("#rk-summary").textContent = "";
    if (!box) return;
    box.innerHTML = ''
      + '<div class="rk-gate">'
      +   '<div class="rk-gate-ico">🔒</div>'
      +   '<div class="rk-gate-title">暂无法查看「趋势上升榜」</div>'
      +   '<div class="rk-gate-why">' + String(why || "当前账号不可访问该专区").replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }) + '</div>'
      +   '<div class="rk-gate-tip">'
      +     '<div class="rk-gate-h">怎么解决</div>'
      +     '<div class="rk-gate-steps">'
      +       '① 请联系超级管理员，在后台 <b>权限管理 → 该用户「编辑」</b> 中勾选「<b>趋势上升榜</b>」并保存；<br>'
      +       '② 若为全站开关问题，请在后台 <b>超管权限 → 前台访问设置 → 顶部菜单项·前台可见</b> 中将「趋势上升榜」设为「展示」；<br>'
      +       '③ 改完后回到本页强制刷新（Ctrl+F5）即可。'
      +     '</div>'
      +   '</div>'
      +   '<div class="rk-gate-btns">'
      +     '<a class="rk-gate-btn ghost" href="index.html">返回视觉专区</a>'
      +     '<button class="rk-gate-btn" id="rk-gate-out" type="button">退出登录</button>'
      +   '</div>'
      + '</div>';
    var out = $("#rk-gate-out");
    if (out) out.onclick = async function () {
      try { await SBX.signOut(); } catch (e) { /* 忽略 */ }
      location.href = "index.html";
    };
  }

  /* ---------------- 初始化 ---------------- */
  async function boot() {
    var box = $("#rk-body");
    if (!SBX) {
      if (box) box.innerHTML = '<div class="rk-empty">数据服务未就绪，请刷新页面重试。</div>';
      return;
    }

    var logged = await renderAuth();
    /* 窗口尺寸变化 → 重新按列数与高度铺排对比池 */
    if (!window.__rkPoolFitBound) {
      window.__rkPoolFitBound = true;
      window.addEventListener("resize", fitPoolsSoon);
    }
    try { sessionStorage.setItem("nl_landed", "1"); } catch (e) {}   // 已落地过：避免从榜单点回视觉专区又被弹回来
    if (logged && window.Common && Common.visit) Common.visit.track("rank");   // 访问统计（后台数据看板）

    // 专区可见性守门（两级）：①全站开关（后台「前台访问设置」） ②用户级白名单（后台「权限管理」勾选）
    var vis = null, myz = null;
    try { vis = await SBX.getFrontendZoneVisibility(); } catch (e) { /* 读取失败时照常展示 */ }
    try { myz = await SBX.myFrontendZones(); } catch (e) { myz = null; }
    if (window.Common && Common.zones) {
      Common.zones.setVis(vis || {});
      Common.zones.setMine(Array.isArray(myz) ? myz : null);
      if (Common.zones.applyNav) Common.zones.applyNav(); else Common.zones.renderNav();
    }
    var gateWhy = "";
    if (vis && vis.rank === false) {
      gateWhy = "全站开关：该专区已在后台「前台访问设置」中被关闭";
    } else if (logged && Array.isArray(myz) && myz.length && myz.indexOf("rank") === -1) {
      gateWhy = "账号授权：你的账号未获授权访问本专区";
    }
    if (gateWhy) {
      renderGate(box, gateWhy);
      return;
    }

    /* 期次按「周度」筛：月度数据（上新节奏专区）与周度共用同一张表，
       不筛的话周度页的期次里会冒出「2026年10月」这种月份，与页面口径不符。 */
    try {
      FACETS = (typeof SBX.rankFacetsBySource === "function")
        ? await SBX.rankFacetsBySource("rank", "week")
        : (typeof SBX.rankFacetsByType === "function" ? await SBX.rankFacetsByType("week") : await SBX.rankFacets());
    } catch (e) { FACETS = { sites: [], periods: [], categories: [] }; }
    /* 类目菜单只显示标准名：把平台全路径名合并到同一类，菜单不再出现一堆长名字 */
    RAW_CATS = (FACETS.categories || []).slice();
    CAT_MAP = {};
    (function () {
      var merged = [];
      RAW_CATS.forEach(function (c) {
        var n = normCatName(c) || "其他";
        if (!CAT_MAP[n]) { CAT_MAP[n] = []; merged.push(n); }
        if (CAT_MAP[n].indexOf(c) < 0) CAT_MAP[n].push(c);
      });
      FACETS.categories = merged;
    })();
    /* 后台可以控制哪些国家站点 / 周次在前台展示：整页统一过滤（筛选项、默认值、地区分组、分享链接都跟着走） */
    /* 图案印花款前台展示开关：关掉时含印花图案的款不参与榜单、统计与报告 */
    try {
      if (SBX && typeof SBX.getPatternPrintVisible === "function") PRINT_HIDE = (await SBX.getPatternPrintVisible()) === false;
    } catch (e) { PRINT_HIDE = false; }
    try { HIDDEN = await SBX.getRankHidden(); } catch (e) { HIDDEN = { sites: [], periods: [] }; }
    HIDDEN = { sites: (HIDDEN && HIDDEN.sites) || [], periods: (HIDDEN && HIDDEN.periods) || [] };
    FACETS.sites = FACETS.sites || [];
    /* 期次统一命名：W45 / 第45周 / 45周 只出现一个按钮（查询时数据层会展开各种写法） */
    FACETS.periods = sortPeriods((typeof normPeriodList === "function")
      ? normPeriodList(FACETS.periods || [])
      : (FACETS.periods || []));
    FACETS.categories = FACETS.categories || [];

    /* 国家站点（地区）以后台「站点管理」里我自定义的清单为准。
       表格里自带的一堆国名（如欧盟合计表里写满各国）不作为前台筛选项。
       若后台一个站点都没定义，才退回按数据里出现过的站点展示（避免筛选项为空）。 */
    var _dataSites = FACETS.sites.slice();
    var _defined = [];
    try {
      var _raw = await SBX.listRankSites();
      _defined = (_raw || []).map(function (s) { return s && s.name; }).filter(function (v) { return v && String(v).trim(); });
    } catch (e) { _defined = []; }
    if (_defined.length) {
      /* 20261113D：菜单 = 后台维护的站点 + 数据里出现但后台没维护的写法。
         以前只列后台那批，于是站点写成「美国站 / US」的数据在页面上彻底看不见 ——
         看上去就是"数据没传上去"。现在按归一后去重，同一个国家只留一个按钮
         （优先用后台的正式名字），照顾不到的历史写法也照样能点。 */
      var _use = _defined.slice();
      var _seen = {};
      _use.forEach(function (n) { _seen[siteKey(n)] = 1; });
      _dataSites.forEach(function (s) {
        var k = siteKey(s);
        if (!k || _seen[k]) return;
        _seen[k] = 1;
        _use.push(String(s).trim());
      });
      FACETS.sites = _use;
    }
    applyHiddenFilter();                       /* 隐藏的站点 / 周次不参与前台筛选 */

    // 站点顺序：有数据的优先，其余按后台定义顺序（横向按这个顺序取前 N 个）
    var _withData = FACETS.sites.filter(function (s) { return _dataSites.indexOf(s) >= 0; });
    var _rest = FACETS.sites.filter(function (s) { return _dataSites.indexOf(s) < 0; });
    SITE_ORDER = _withData.concat(_rest);

    // 默认进入口径：纵向 · 时间对比（已默认） + 美国站 + 卫衣；命中不到就退回「有数据的第一个」/ 全部类目
    CAT = pickDefault(FACETS.categories, DEFAULT_CAT, FACETS.categories.length ? FACETS.categories[0] : ALL);
    var _firstSite = pickDefault(SITE_ORDER, DEFAULT_SITE, SITE_ORDER[0] || "");
    SEL_SITES = _firstSite ? [_firstSite] : [];
    SEL_PERIODS = sortPeriods(FACETS.periods).slice(-COLS);

    try { GROUPS = await SBX.getRankGroups(); } catch (e) { GROUPS = []; }
    GROUPS = (GROUPS || []).filter(function (g) { return g && g.name; });
    applyHiddenFilter();                       /* 地区分组里若含被隐藏的国家，一并摘掉 */

    // URL 参数（后台实时预览 / 分享链接）：mode / size / cat / sites / periods / group
    var _modeFromUrl = false, _urlPickedCols = false;
    try {
      var _qs = new URLSearchParams(location.search);
      var _m = _qs.get("mode"); if (_m === "h" || _m === "v" || _m === "c") { if (_m !== MODE) _modeFromUrl = true; MODE = _m; }
      var _z = _qs.get("size"); if (_z === "s" || _z === "m" || _z === "l") SIZE = _z;
      var _c = _qs.get("cat"); if (_c) CAT = _c;
      var _ss = (_qs.get("sites") || "").split(",").filter(function (v) { return v.trim(); });
      if (_ss.length) {
        if (_ss.indexOf(SITE_ALL_KEY) >= 0) SITE_ALL = true;
        else SEL_SITES = _ss;
      }
      var _g = _qs.get("group");
      if (_g && GROUPS.some(function (x) { return x.name === _g; })) SEL_GROUP = _g;
      var _pp = (_qs.get("periods") || "").split(",").filter(function (v) { return v.trim(); });
      if (_pp.length) { SEL_PERIODS = _pp; PERIODS_AUTO = false; if (MODE === "h") MODE = "v"; }
      var _cc = (_qs.get("cats") || "").split(",").filter(function (v) { return v.trim(); });
      if (_cc.length) { SEL_CATS = _cc; if (MODE !== "c") { MODE = "c"; _modeFromUrl = true; } }
      /* 链接里已经点名了对比类目，就不能再按「默认列数」重排，否则 4 个类目会被截成 3 个 */
      _urlPickedCols = !!(_ss.length || _pp.length || _cc.length);
    } catch (e) { /* 无参数时忽略 */ }

    /* 分享链接 / 后台预览带的参数里可能含已隐藏项：再收一遍；收空了就回落到默认口径 */
    applyHiddenFilter();
    /* 链接里指定了对比模式、又没点名具体列：按该模式重排列（与手动点「对比模式」一致），
       否则用 mode=h 打开会只剩 1 列，横向对比失去意义 */
    if (_modeFromUrl && !_urlPickedCols) applyCols();
    if (!SEL_SITES.length || !SEL_PERIODS.length) applyCols();

    /* 「对比列数」跟着当前实际列数走：分享链接 / 后台预览带参数时也能对上 */
    if (MODE === "v") COLS = Math.max(2, Math.min(COLS_MAX, SEL_PERIODS.length || COLS));
    else if (MODE === "c") COLS = Math.max(1, Math.min(CAT_MAX, activeCats().length || COLS));
    else COLS = Math.max(2, Math.min(COLS_MAX, SEL_SITES.length || COLS));

    renderCats();
    renderPanel();
    renderSummary();
    renderBar();
    bindTrigger();

    // 「生成报告」（PDF / PPT）：只有超级管理员会看到按钮；封装在 report.js 里，失败不影响榜单页
    if (window.ReportKit) {
      try {
        window.ReportKit.init({
          btn: "#rk-report-btn",
          isSuper: isSuperAdmin,
          state: reportState,
          itemOf: function (url) { return ITEMS_BY_URL[url] || null; },
          poolsEl: function () { return document.querySelector("#rk-pools"); },
          expandAll: expandAllForReport
        });
      } catch (e) { /* 报告功能不可用时不阻塞页面 */ }
    }

    await load();
    /* 收藏状态（星标点亮 + 分类清单）在榜单渲染完之后再同步一次：
       否则首屏渲染时还不知道哪些图已收藏，星标会全部是空心。 */
    try { await initFav(); } catch (e) { /* 收藏不可用不影响榜单本身 */ }

    // 未登录 / 无数据时的兜底提示
    if (!CACHE || !CACHE.items.length) {
      var s2 = null;
      try { s2 = await SBX.getSession(); } catch (e) { /* 忽略 */ }
      if (!s2 && box) {
        box.innerHTML = '<div class="rk-empty">暂无可查看的数据：本页需要登录后查看，请先到<a href="index.html">视觉专区</a>登录。</div>';
      }
    } else if (!logged && box && !CACHE.items.length) {
      if (box) box.innerHTML = '<div class="rk-empty">暂无可查看的数据。</div>';
    }
  }

  /* ---------------- 生成报告（PDF / PPT）用的桥接 ----------------
   * 报表内容直接取自屏幕上正在渲染的对比池（DOM），
   * 因此「网页什么样、导出就什么样」，不会出现两套口径。 */
  async function isSuperAdmin() {
    try {
      if (!SBX || !SBX.myRole) return false;
      return (await SBX.myRole()) === "super_admin";
    } catch (e) { return false; }
  }

  function reportState() {
    var items = (CACHE && CACHE.items) ? CACHE.items.filter(hitTags) : [];
    var sizeMap = { s: "小图", m: "中图", l: "大图" };
    return {
      zone: "趋势上升榜",
      cat: MODE === "c" ? activeCats().join(" / ") : (CAT || ALL),
      modeLabel: MODE === "h" ? "横向 · 国家对比（多国 × 单周）"
        : (MODE === "c" ? "横向 · 类目对比（单周 × 多类目）" : "纵向 · 时间对比（单国 × 多周）"),
      sites: poolSites(),
      group: activeGroup() ? activeGroup().name : "",
      periods: activePeriods(),
      tags: tagLabel(),
      sizeLabel: sizeMap[SIZE] || "",
      total: items.length
    };
  }

  /* 「每列全部条目」：把每列展开到上限，并等图片加载完再交给报告模块 */
  async function expandAllForReport() {
    if (CAP < CAP_MAX) { CAP = CAP_MAX; renderBody(); renderBar(); }
    var box = document.querySelector("#rk-pools");
    if (box && window.ReportKit && window.ReportKit._ && window.ReportKit._.waitImages) {
      await window.ReportKit._.waitImages(box, 15000);
    }
  }

  /* ---------------- 筛选栏：感应收缩 ----------------
   * 收起态只有一行摘要（当前类目 · 周次 · 国家 · 标签），不占版面；
   * 鼠标移到筛选条上（含上方 10px 感应带、下方 8px 过桥带）就自动展开 —— 不用点；
   * 选好「单选类」条件后自动收起；鼠标移开也会延迟收起，手抖不会闪退；
   * 触屏 / 键盘没有悬停：点一下筛选条展开，再点一下收起，Tab 也能进去。 */
  var F_CLOSE_DELAY = 200;    /* 鼠标移开后多久收起 */
  var F_PICK_DELAY = 340;     /* 单选完成后多久收起：留一点时间让用户看清选中态 */
  var _fCloseTimer = null;

  function filterEl() { return $("#rk-filter"); }

  function filterOpen() {
    var f = filterEl();
    if (!f) return;
    if (_fCloseTimer) { clearTimeout(_fCloseTimer); _fCloseTimer = null; }
    f.classList.add("is-open");
  }

  function filterClose(delay) {
    var f = filterEl();
    if (!f) return;
    if (_fCloseTimer) clearTimeout(_fCloseTimer);
    _fCloseTimer = setTimeout(function () {
      _fCloseTimer = null;
      var el = filterEl();
      if (el) el.classList.remove("is-open");
    }, delay == null ? F_CLOSE_DELAY : delay);
  }

  /* 多选类条件不自动收起（横向要多选国家、纵向要多选周次，连着点才对）；
     其余单选类条件点完就收起。 */
  var PICK_ATTRS = "[data-mode],[data-cols],[data-cat],[data-site],[data-period],[data-group],[data-tag],[data-sort],[data-size],[data-move],[data-scope],[data-only]";
  function isMultiPick(el) {
    if (!el || !el.hasAttribute) return false;
    if (el.hasAttribute("data-site")) return MODE !== "v";      /* 横向：国家可多选 */
    if (el.hasAttribute("data-period")) return MODE !== "h";    /* 纵向：周次可多选 */
    return false;
  }

  function bindTrigger() {
    var f = filterEl(), t = $("#rk-trigger");
    if (!f) return;

    /* 悬停感应：只认鼠标 / 触控笔，触屏不要被 pointerenter 抢跑 */
    function byPointer(e) {
      var pt = e.pointerType;
      return !pt || pt === "mouse" || pt === "pen";
    }
    f.addEventListener("pointerenter", function (e) { if (byPointer(e)) filterOpen(); });
    f.addEventListener("pointerleave", function (e) { if (byPointer(e)) filterClose(); });

    /* 点击开合（触屏 / 不想悬停时） */
    if (t) t.addEventListener("click", function () {
      var el = filterEl();
      if (!el) return;
      if (el.classList.contains("is-open")) filterClose(0);
      else filterOpen();
    });

    /* 面板内选完条件：单选类自动收起 */
    f.addEventListener("click", function (e) {
      var node = e.target;
      if (!node || !node.closest) return;
      var chip = node.closest(PICK_ATTRS);
      if (!chip) return;
      if (isMultiPick(chip)) return;
      filterClose(F_PICK_DELAY);
    });

    /* Esc 收起 */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") filterClose(0);
    });

    /* 面板重新渲染（点击后整块重绘）会丢焦点：保证收起态时不会被 focus-within 顶开 */
    if (f.matches(":focus-within") && !f.classList.contains("is-open")) {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
  }

  /* 离屏测试钩子：只有显式打开 window.__RANK_TEST__ 才挂出去，线上完全不生效 */
  if (typeof window !== "undefined" && window.__RANK_TEST__) {
    window.__RANK_T = {
      set: function (o) {
        o = o || {};
        if (o.mode !== undefined) MODE = o.mode;
        if (o.cat !== undefined) CAT = o.cat;
        if (o.cats) SEL_CATS = o.cats.slice();
        if (o.sites) SEL_SITES = o.sites.slice();
        if (o.periods) SEL_PERIODS = o.periods.slice();
        if (o.group !== undefined) SEL_GROUP = o.group;
        if (o.cache) CACHE = o.cache;
        if (o.tags) {
          var _t = {};
          Object.keys(o.tags).forEach(function (u) { _t[u] = lbNormalize(o.tags[u]); });
          TAG_INDEX = _t;
        }
        if (o.facets) FACETS = o.facets;
        if (o.groups) GROUPS = o.groups;
      },
      vitalsGroups: vitalsGroups,
      vitalsOfGroups: vitalsOfGroups,
      vitalsDim: vitalsDim,
      vitalsHtml: vitalsHtml,
      insightsOf: insightsOf,
      lbTagsHtml: lbTagsHtml,
      lbTagGroups: lbTagGroups,
      tagFingerprint: tagFingerprint,
      /* 20261103A：图案印花款开关相关的内部函数，供离屏测试直接调用 */
      itemIsPrint: itemIsPrint,
      patternIsPrint: patternIsPrint,
      patternTypeIsPattern: patternTypeIsPattern,
      fitPartsOfCat: fitPartsOfCat,
      fitValOfFit: fitValOfFit,
      trendValsOf: trendValsOf,
      repQualityHtml: repQualityHtml,
      /* 20261103E：视觉背景（scene_tags）相关的内部函数 */
      repBgCharts: repBgCharts,
      repBgGroups: repBgGroups,
      repCuCharts: repCuCharts,
      repCuGroups: repCuGroups,
      repCuText: repCuText,
      /* 20261104C：周次勾选（首次手选重置默认带入的周次） */
      togglePeriodPick: togglePeriodPick,
      periodsAuto: function () { return PERIODS_AUTO; },
      setPeriodsAuto: function (v) { PERIODS_AUTO = !!v; },
      cols: function () { return COLS; },
      selPeriods: function () { return sortPeriods(SEL_PERIODS); },
      repScopeText: repScopeText,
      repBgText: repBgText,
      repFullDataHtml: repFullDataHtml,
      repMatrixHtml: repMatrixHtml,
      repProfile: repProfile,
      /* 20261103F：标签就绪门控 / 报告懒加载 / 多组合缓存 */
      tagsSettled: tagsSettled,
      fillRepDetail: fillRepDetail,
      repDetailTopHtml: repDetailTopHtml,
      repDetailBottomHtml: repDetailBottomHtml,
      cacheGet: cacheGet,
      cachePut: cachePut,
      setRepOpen: function (v) { REP_OPEN = !!v; },
      setTagState: function (k, busy) { TAG_KEY = k || ""; TAG_BUSY = !!busy; },
      tagSeen: function (u) { return !!TAG_SEEN[tagStoreKey(u)]; },
      prefetchAllTags: prefetchAllTags,
      /* 20261104F：类目预取与列白名单，供离屏测试直接驱动 */
      prefetchCategories: prefetchCategories,
      catPfOn: function () { return CAT_PF_ON; },
      resetCatPf: function () { CAT_PF_ON = false; CAT_PF_SEEN = {}; },
      itemsKey: itemsKey,
      itemCacheKeys: function () { return CACHE_ORDER.slice(); },
      relCols: function () { return REL_COLS; },
      tagGateWait: function () { return TAG_GATE_WAIT; },
      tagAllState: function () { return TAG_ALL_STATE; },
      setTagAllState: function (v) { TAG_ALL_STATE = v; },
      tagGateAt: function () { return TAG_GATE_AT; },
      tagQueueLen: function () { return TAG_QUEUE.length; },
      tagAbsorb: tagAbsorb,
      markTagSeen: function (u) { TAG_SEEN[tagStoreKey(u)] = 1; },
      tagStoreGet: tagStoreGet,
      tagStorePut: tagStorePut,
      tagStoreKey: tagStoreKey,
      repTagPct: repTagPct,
      repActionHtml: repActionHtml,
      repLatestWeekCols: repLatestWeekCols,
      elementHasGraphic: elementHasGraphic,
      isPatchLabel: isPatchLabel,
      craftIsPrint: craftIsPrint,
      PRINT_HIDE: function () { return PRINT_HIDE; },
      setPrintHide: function (v) { PRINT_HIDE = !!v; },
      hiddenPrintCount: hiddenPrintCount,
      coverageOf: coverageOf,
      visibleItems: function () { return ((CACHE && CACHE.items) || []).filter(function (it) { return hitTagsRaw(it) && printOk(it); }); }
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();