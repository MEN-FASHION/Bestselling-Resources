/* ============================================================
 * 站点配置（部署前请按需修改）
 * ============================================================
 * 1) siteTitle 站点名称
 * 2) SUPABASE  你的 Supabase 项目配置（登录验证用）：
 *    - url      : Supabase 项目地址
 *      （登录 supabase.com -> 你的项目 -> Project Settings -> API -> Project URL）
 *    - anonKey  : 匿名公钥（同一页面 Project API keys -> anon public）
 * 3) WORKER_URL : 你的 Cloudflare Worker 地址（图片存 R2，由 Worker 鉴权代理）
 *      （格式形如 https://your-worker-name.your-subdomain.workers.dev，末尾不带 /）
 * 4) enableSignup：是否允许访客自助注册（false 则只能由管理员建号）
 *
 * 说明：图片不再直接访问 Supabase Storage，而是全部通过 Cloudflare Worker
 *       鉴权后从 R2 私有桶读取，实现"未登录拿不到图片"。
 * ============================================================ */
window.CONFIG = {
  // ---------- 站点信息 ----------
  siteTitle: "TREND BANK",
  siteSubtitle: "Trend Archive · Product Imagery",

  // ---------- Supabase 配置（登录验证）★ 必填 ----------
  SUPABASE: {
    url: "https://qmyopvxezsluhuqzgnos.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFteW9wdnhlenNsdWh1cXpnbm9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0OTA4MDUsImV4cCI6MjEwNDA2NjgwNX0.8PONmLsj4VhGRNMaDZ_bsRgxIH1pyzW78uEn7y80_R4"
  },

  // ---------- Cloudflare Worker（图片守门员） ★ 必填 ----------
  WORKER_URL: "https://img.newtrend.top",

  // ---------- 功能开关 ----------
  enableSignup: true,      // 前台是否允许自助注册（默认允许）

  // ---------- 招品回品：站点ID ↔ 站点名映射表（站点.xlsx） ----------
  // 上传表格中的「站点id」在前台/后台展示为映射后的「站点名」；未命中则原样显示站点id。
  SITE_MAP: {
    "100": "美国", "101": "加拿大", "103": "澳大利亚", "104": "新西兰",
    "118": "日本", "119": "韩国", "127": "菲律宾", "121": "新加坡",
    "125": "智利", "126": "马来西亚", "129": "泰国", "128": "台湾",
    "163": "秘鲁", "164": "哥伦比亚", "110": "墨西哥", "202": "牙买加",
    "132": "巴西", "169": "乌拉圭", "189": "阿根廷", "182": "洪都拉斯",
    "172": "多米尼加", "173": "哥斯达黎加", "178": "厄瓜多尔", "179": "特立尼达和多巴哥",
    "183": "萨尔瓦多", "187": "越南", "188": "文莱", "176": "巴拿马",
    "180": "危地马拉", "191": "柬埔寨", "200": "巴拉圭"
  },
  // 站点ID转站点名；找不到时返回原值
  siteName: function (sid) {
    const s = String(sid == null ? "" : sid).trim();
    return (window.CONFIG.SITE_MAP && window.CONFIG.SITE_MAP[s]) ? window.CONFIG.SITE_MAP[s] : (s || "");
  },

  // ---------- 趋势专区：文件分类标签（每种是单选） ----------
  // tag 限定以下三种，后台上传趋势文件时选择其一；前台按这三种标签筛选展示。
  TREND_TAGS: ["类目", "月度", "周度"],

  // ---------- 渠道/来源标签（图片打标 + 前台筛选） ----------
  // 渠道标签为固定分组，后台不可增删；风格/元素标签可在后台「标签管理」自定义增删。
  CHANNEL_TAGS: [
    { group: "市场站", tags: ["TEMU", "AMAZON", "ALIEXPRESS"] },
    { group: "社媒", tags: ["TIKTOK", "INS", "FACEBOOK"] },
    { group: "灵感", tags: ["PINTEREST"] },
    { group: "品牌网站", tags: ["SHEIN"] }
  ],

  // ---------- 各类标签维度统一描述（打标 + 前台筛选 + 数据看板共用） ----------
  // field     : images 表对应存储列
  // source    : fixed = 固定清单（渠道, 读 CHANNEL_TAGS）；defs = 自定义标签表（风格/元素, 读 tag_defs）
  // defType   : source 为 defs 时读取 tag_defs 的 type
  TAG_GROUPS: [
    { key: "channel", label: "渠道",  field: "tags",         source: "fixed", defType: "" },
    { key: "style",   label: "风格",  field: "style_tags",   source: "defs",  defType: "style" },
    { key: "element", label: "元素",  field: "element_tags", source: "defs",  defType: "element" },
    { key: "scene",   label: "场景",  field: "scene_tags",   source: "defs",  defType: "scene" },
    { key: "shoot",   label: "拍摄方式", field: "shoot_tags", source: "defs", defType: "shoot" },
    { key: "skin",    label: "肤色",  field: "skin_tags",    source: "defs",  defType: "skin" }
  ],

  // ---------- 预设风格 / 元素标签（首次建库时写入 tag_defs，可在后台自定义增删） ----------
  PRESET_STYLE_TAGS: ["复古美式", "街头潮流", "极简", "商务通勤", "户外机能", "工装", "休闲", "学院风"],
  PRESET_ELEMENT_TAGS: ["条纹", "格纹", "印花", "字母", "拼接", "刺绣", "牛仔", "迷彩", "扎染", "做旧"],

  // ---------- 场景标签：室内 / 室外两大类（后台「标签管理」可自定义增删） ----------
  // 标签名采用「室内·卧室」「室外·街道」前缀命名，前台按前缀自动分成「室内」「室外」两大组展示。
  PRESET_SCENE_TAGS: [
    "室内·卧室", "室内·客厅", "室内·教室", "室内·书房", "室内·厨房", "室内·卫生间", "室内·玄关", "室内·衣帽间", "室内·办公室",
    "室外·街道", "室外·商场", "室外·户外", "室外·园区", "室外·广场", "室外·公园", "室外·建筑外景", "室外·交通工具"
  ],

  // ---------- 预设拍摄方式 / 肤色标签（登入 tag_defs，可在后台自定义增删） ----------
  PRESET_SHOOT_TAGS: ["摆拍", "挂拍", "模拍", "3D"],
  PRESET_SKIN_TAGS: ["黑", "白", "黄"],

  // ---------- 候选类目清单（后台「类目管理」可选列表，来自类目表） ----------
  // 管理员可在后台据此勾选/添加类目；也可输入自定义类目。
  CATEGORY_OPTIONS: [
    "传统服饰","T恤","背心","长裤","毛衣","开衫","卫衣","防晒衫","泳衣泳裤","外套夹克",
    "风衣/大衣","功能服","棉服","皮革外套夹克","牛仔夹克","羽绒服","马甲","打底/压缩","连帽衫","短裤",
    "POLO","衬衫","上衣","套装","牛仔短裤","牛仔裤","正装","长筒厚袜","比基尼内裤","平角内裤",
    "三角内裤","丁字内裤","塑身裤","塑身衣","紧身衣","保暖裤子","保暖连衫裤","保暖上衣","保暖套装","长款平角内裤",
    "汗衫","内裤","睡衣","睡袍/浴袍","家居服裤子","家居服套装","家居服上衣","护档","睡裙","袜子",
    "连袜便鞋","短袜","运动袜","骑行背心","护臂","护腿","压缩紧身袜","压缩单品","骑行内衣","情趣内裤",
    "情趣用品","裤子","连体衣","睡袍","角色扮演","新奇短袜","新奇比基尼内裤","新奇丁字裤","新奇平角内裤","新奇三角内裤",
    "新奇连体睡衣","新奇睡裤","新奇睡袍","新奇睡衣","新奇家居服套装","塑身衣套装","篮球袜","骑行袜","橄榄球袜","高尔夫袜",
    "滑雪袜","足球袜","网球袜","排球袜","瑜伽袜","冰球袜","舞蹈裤袜","垒球袜","棒球袜","滑冰裤袜",
    "压缩袜","橄榄球","连体/背带","球衣","连衣裙/半裙","连体睡衣","及膝袜","中筒袜","船袜","高筒袜",
    "运动文胸","文胸","运动内衣","运动背心","新奇内裤","新奇家居服上衣","新奇紧身裤袜","新奇袜套","新奇文胸","新奇长睡袍",
    "内衣套装","袜套","军制服","塑形衣","家居服/裙/袍","洗礼服"
  ]
};

/* ============================================================
 * 专区定义（默认值）
 * 超管可在后台「权限管理 → 专区管理」里改名 / 新增 / 删除专区：
 *   - 改完即时生效于「用户级可见专区」「后台可管理专区」「前台访问设置」
 *   - 带「前台链接」的专区会出现在前台顶部菜单（可单独开关可见性）
 * 实际配置存于 site_settings.frontend_zone_visibility.__defs（无需改数据库）
 * ============================================================ */
window.ZONE_DEFS_DEFAULT = [
  { key: "rank",          label: "趋势上升榜",     href: "rank.html" },
  { key: "plus",          label: "大码专区",      href: "plus.html" },
  { key: "marketing",     label: "营销日历",      href: "marketing.html" },
  { key: "visual",        label: "视觉专区",      href: "index.html" },
  { key: "trend",         label: "趋势专区",      href: "trends.html" },
  { key: "recruit",       label: "招品回品",      href: "trends.html#recruit" },
  { key: "bestseller",    label: "BESTSELLER",  href: "trends.html#bestseller" },
  { key: "fav",           label: "我的收藏",     href: "fav.html" },
  { key: "movement",      label: "趋势动向",     href: "movement.html" },
  { key: "notice",        label: "公告",        href: "" }
];


/* ============================================================
 * 类目搜索（宽松模糊） + 常用类目置顶 —— 前后台共用
 * ============================================================
 * 1) 所有「需要选择类目」的入口都提供搜索框，搜索尽量宽松：
 *    · 忽略大小写、空格与常见分隔符（- _ / \ | , ， . 。 : ： ( ) （ ） [ ] 【 】 · ・）
 *    · 子串命中：关键词出现在候选里（输入 t 恤 能搜到 T恤）
 *    · 反向包含：关键词比候选长时也算命中（多打了字不会突然搜不到）
 *    · 逐字命中：关键词的每个字按顺序出现在候选里（连衣 → 连衣裙）
 *    · 空格分词＝且：多段关键词要求每段都命中
 * 2) 常用类目置顶：当前账号的常用类目排在最前并带 ★
 * ============================================================ */
window.CAT_SEARCH = (function () {
  var kwMap = Object.create(null);
  function kw(key, val) {
    if (arguments.length > 1) kwMap[key] = String(val == null ? "" : val);
    return kwMap[key] || "";
  }
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase()
      .replace(/[\s\u00b7\u30fb\-_\\|,，.。;；:：()（）\[\]【】<>《》"'`+]+/g, "");
  }
  function seqHit(text, k) {
    if (!k) return true;
    var i = 0;
    for (var p = 0; p < text.length && i < k.length; p++) {
      if (text.charAt(p) === k.charAt(i)) i++;
    }
    return i >= k.length;
  }
  function hit(name, keyword) {
    var raw = String(keyword == null ? "" : keyword).trim();
    if (!raw) return true;
    var t = norm(name);
    if (!t) return false;
    var segs = raw.split(/\s+/).filter(Boolean);
    return segs.every(function (seg) {
      var k = norm(seg);
      if (!k) return true;
      if (t.indexOf(k) >= 0) return true;   /* 子串命中 */
      if (k.indexOf(t) >= 0) return true;   /* 反向包含 */
      return seqHit(t, k);                  /* 逐字按顺序命中 */
    });
  }
  function filter(list, keyword) {
    return (list || []).filter(function (x) { return hit(x, keyword); });
  }
  /* 常用类目置顶：favs 顺序在前，其余保持原顺序；返回 [{name, fav}] */
  function sortCats(list, favs) {
    var fav = (favs || []).map(function (x) { return String(x == null ? "" : x).trim(); }).filter(Boolean);
    var src = list || [], seen = Object.create(null), out = [];
    fav.forEach(function (f) {
      if (!seen[f] && src.indexOf(f) >= 0) { seen[f] = 1; out.push({ name: f, fav: true }); }
    });
    src.forEach(function (c) {
      if (!seen[c]) { seen[c] = 1; out.push({ name: c, fav: false }); }
    });
    return out;
  }
  /* 过滤 <select> 的选项：保留占位项与当前选中项，避免过滤后丢值 */
  function filterSelect(sel, keyword) {
    if (!sel) return 0;
    var shown = 0;
    Array.prototype.forEach.call(sel.options, function (o) {
      var keep = o.value === "" || (sel.value !== "" && o.value === sel.value);
      var ok = !keyword || keep || hit(o.value, keyword);
      try { o.hidden = !ok; } catch (e) { }
      o.style.display = ok ? "" : "none";
      if (ok) shown++;
    });
    return shown;
  }
  /* 在 target 前插入搜索框（已存在则复用），返回该输入框 */
  function mountBox(target, id, placeholder, onInput) {
    if (!target || !target.parentNode) return null;
    /* 用 target 自己所属的文档去查找：后台有「前台预览」iframe，
       若用外层 document 查找会找不到已插入的框，从而重复插入一个搜索框 */
    var doc = target.ownerDocument || document;
    var el = doc.getElementById(id);
    if (!el) {
      el = document.createElement("input");
      el.id = id;
      /* 用 text + inputmode 而不是 type=search：type=search 会被部分浏览器的
         账号自动填充当成"搜索账号"，把登录邮箱直接填进类目搜索框，
         看起来就像"侧边栏里显示了账号"。 */
      el.type = "text"; el.inputMode = "search";
      el.className = "cat-search";
      /* Chrome 的账号自动填充会无视 autocomplete=off（实测仍会填邮箱），
         new-password 是目前唯一对它有效的抑制值 —— 浏览器不会往这里填账号。 */
      el.autocomplete = "new-password";
      el.setAttribute("autocapitalize", "off");
      el.setAttribute("autocorrect", "off");
      el.setAttribute("spellcheck", "false");
      /* 给密码管理器明确的"别填这里"信号（Chrome / 1Password / LastPass） */
      el.setAttribute("data-form-type", "other");
      el.setAttribute("data-lpignore", "true");
      el.setAttribute("data-1p-ignore", "");
      el.setAttribute("aria-autocomplete", "none");
      /* name 不用 search 之类的通用词，避免被启发式判定成账号框 */
      el.setAttribute("name", "cat-filter-q");
      el.title = "模糊搜索：忽略大小写与符号，可隔字匹配（如输入「连衣」可搜到「连衣裙」）";
      target.parentNode.insertBefore(el, target);
      /* 只读态下浏览器不会填充；聚焦后才允许输入，失焦且为空则恢复只读 */
      el.setAttribute("readonly", "readonly");
      if (el.addEventListener) {
        el.addEventListener("focus", function () { el.removeAttribute("readonly"); });
        el.addEventListener("blur", function () { if (!el.value) el.setAttribute("readonly", "readonly"); });
      }
    }
    el.placeholder = placeholder || "搜索类目…";
    el.oninput = function () {
      try { onInput(el.value); } catch (e) { }
    };
    /* 真人才会按键/粘贴；自动填充即使触发 input 也不会触发 keydown，
       所以 typed 只由键盘与粘贴事件置位 —— 这是区分二者的可靠判据。 */
    if (!el.dataset.typedHook) {
      el.dataset.typedHook = "1";
      var markTyped = function () { try { el.dataset.typed = "1"; } catch (e) { } };
      if (el.addEventListener) {
        el.addEventListener("keydown", function (e) {
          var k = e && e.key;
          if (k === "Backspace" || k === "Delete" || k === "Enter" || (k && k.length === 1)) markTyped();
        });
        el.addEventListener("paste", markTyped);
        el.addEventListener("compositionend", markTyped);
      }
    }
    /* 兜底：浏览器/密码管理器在页面加载后偷偷填入的内容要清掉。
       判据是「框里有值，但用户从未按键」——正常使用者不可能凭空有值。
       之前只扫 300/1200ms 两次，Chrome 常在这之后才填（首次与页面交互时），
       于是漏掉、邮箱留在框里、类目被当成关键字过滤成空 —— 现在持续守护 15 秒。 */
    if (!el.dataset.autofillGuard) {
      el.dataset.autofillGuard = "1";
      var sweep = function () {
        try {
          if (!el.dataset.typed && el.value && el.value !== "") {
            el.value = "";
            if (typeof onInput === "function") onInput("");
          }
        } catch (e) { }
      };
      setTimeout(sweep, 200);
      setTimeout(sweep, 600);
      setTimeout(sweep, 1200);
      var ticks = 0;
      var timer = setInterval(function () {
        ticks++;
        sweep();
        if (ticks >= 60) clearInterval(timer);   /* 60 × 250ms ≈ 15 秒后收工 */
      }, 250);
    }
    return el;
  }
  function star(fav) { return fav ? "★" : ""; }
  return {
    kw: kw, norm: norm, hit: hit, filter: filter,
    sortCats: sortCats, filterSelect: filterSelect, mountBox: mountBox, star: star
  };
})();
