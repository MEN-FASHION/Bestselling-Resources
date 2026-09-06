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
  siteTitle: "图片图鉴",
  siteSubtitle: "Browse · Collect · Share",

  // ---------- Supabase 配置（登录验证）★ 必填 ----------
  SUPABASE: {
    url: "https://qmyopvxezsluhuqzgnos.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFteW9wdnhlenNsdWh1cXpnbm9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0OTA4MDUsImV4cCI6MjEwNDA2NjgwNX0.8PONmLsj4VhGRNMaDZ_bsRgxIH1pyzW78uEn7y80_R4"
  },

  // ---------- Cloudflare Worker（图片守门员） ★ 必填 ----------
  WORKER_URL: "https://gallery-api.lisaifei7.workers.dev",

  // ---------- 功能开关 ----------
  enableSignup: true,      // 前台是否允许自助注册（默认允许）

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
    { key: "element", label: "元素",  field: "element_tags", source: "defs",  defType: "element" }
  ],

  // ---------- 预设风格 / 元素标签（首次建库时写入 tag_defs，可在后台自定义增删） ----------
  PRESET_STYLE_TAGS: ["复古美式", "街头潮流", "极简", "商务通勤", "户外机能", "工装", "休闲", "学院风"],
  PRESET_ELEMENT_TAGS: ["条纹", "格纹", "印花", "字母", "拼接", "刺绣", "牛仔", "迷彩", "扎染", "做旧"],

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
