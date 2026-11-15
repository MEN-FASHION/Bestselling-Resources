/* ============================================================================
 * title-words.js —— 标题分词 / 归位 / 统计 / 组词  计算内核
 *
 * 【口径】一切从「标题原文」来，完全不吃打标结果。
 *   打标是看图判断的属性（面料甚至带类目推断），和商家真正写在标题里的词
 *   不是一回事；拿它当标题词会失真，所以这里只对 title 做分词。
 *
 * 【算法】
 *   规范化 → 短语合并（long sleeve → long-sleeve）→ 按分隔符切片段
 *   → 正向最大匹配（中英文词典）→ 未登录块兜底
 *   词典按八类归位（风格 / 图案 / 工艺 / 版型 / 面料 / 场景 / 手感 / 品类），
 *   归不进各类的进「其它高频词」，其中「新款/时尚/2026」这类标记为空泛词。
 *
 * 【统计分母】按槽位各算：某槽位的分母 = 命中该槽位的款数，不是总款数。
 *   否则只有 3 款写了面料，某面料词会被算成 1/100 而不是 1/3。
 *
 * 【图案开关】opt.hidePattern === true 时：图案槽位整块不产出，
 *   图案词也不参与统计（跟随后台「图案印花款」开关）。
 * ==========================================================================*/
(function () {
  "use strict";

  var SLOTS = [
    { key: "style", no: "①", name: "风格调性", label: "风格", hint: "整体调性 / 风格标签，决定人群与审美取向" },
    { key: "pattern", no: "②", name: "图案卖点", label: "图案", hint: "图案类型与图案元素（由后台「图案印花款」开关控制显隐）" },
    { key: "craft", no: "③", name: "二次工艺", label: "工艺", hint: "洗水、做旧、破洞、刺绣、烫钻等工艺卖点" },
    { key: "fit", no: "④", name: "版型结构", label: "版型", hint: "廓形、松紧、领型袖型、长短等结构信息" },
    { key: "fabric", no: "⑤", name: "面料成分", label: "面料", hint: "材质与成分，买家最关心的品质信号" },
    { key: "scene", no: "⑥", name: "场景文化", label: "场景", hint: "穿着场合 / 节日 / 文化氛围" },
    { key: "handfeel", no: "⑦", name: "手感质感", label: "手感", hint: "软硬厚薄、垂感挺括等手感描述" },
    { key: "category", no: "⑧", name: "品类归属", label: "品类", hint: "商品品类词与件数形态（外套 / 夹克 / 卫衣 / 3件套…）" },
    { key: "season", no: "⑨", name: "季节时令", label: "季节", hint: "春夏秋冬与换季表述，决定上架时机" },
    { key: "aud", no: "⑩", name: "人群尺码", label: "人群", hint: "性别与尺码段（男士 / 女士 / 情侣 / 大码 / 显瘦…）" },
    { key: "func", no: "⑪", name: "功能卖点", label: "功能", hint: "可机洗 / 快干 / 耐磨 / 防晒 / 弹力等功能性表述" }
  ];

  /* ---------------- 八类词典（中文）：数组顺序即归位优先级 ---------------- */
  var LEX = {
    /* 归位优先级：场景 → 工艺 → 版型 → 品类 → 手感 → 面料 → 图案 → 风格，先到先得 */
    scene: "日常 通勤 上班 办公 工作 工作服 工装服 通勤上班 上班穿 工作穿 穿搭 通勤穿搭 职场穿搭 街头穿搭 显瘦穿搭 户外活动 户外运动 狩猎 钓鱼 篮球 训练 健身房 骑车 约会 度假 海边 沙滩 海岛 旅行 出游 旅游 运动 健身 跑步 瑜伽 打球 户外 登山 露营 徒步 高尔夫 高尔夫球 骑行 滑雪 居家 在家 睡衣 家居服 睡裙 聚会 派对 晚宴 年会 婚礼 伴娘 新娘 出席 宴会 节日 圣诞 圣诞节 万圣节 万圣 新年 春节 情人节 感恩节 复活节 开学 校园 军训 实习 面试 拍照 写真 街拍 出片 拍照款 打卡 演出 舞台 舞蹈 音乐节 演唱会 漫展 上学 返校 秋游 春游 野餐 亲子 姐妹装 闺蜜装 家庭 假日 假期 周末 学生 中考 高考 生日 礼物 送礼 礼品 伴手礼 节日礼物 圣诞礼物 露营风 海边度假 度假风 通勤风 运动风 居家风 日常穿 外穿 内搭 单穿 叠穿 出街 逛街 约会穿 旅行穿 户外活动 户外穿着 通勤穿 日常通勤",
    craft: "水洗 水洗做旧 做旧 磨破 破洞 破边 毛边 流苏 抽绳 系带 绑带 腰带 松紧腰 松紧 褶皱 压褶 打褶 抽褶 百褶 蕾丝 镂空 网眼 拼接 拼接设计 撞色拼接 拉链 半拉链 拉链款 纽扣 单排扣 双排扣 暗扣 按扣 口袋 贴袋 侧袋 插袋 挖空 露背 露肩 开叉 开衩 卷边 翻边 收腰 抽腰 弹力腰 压线 明线 绗缝 夹棉 加绒 加厚 加棉 摇粒绒 磨毛 起绒 抓绒 抓毛 涂层 防水 防风 免烫 抗皱 速干 透气 吸汗 防晒 upf 冰感 凉感 发热 保暖 加长 拖地 收口 罗纹 罗纹收口 织带 蝴蝶结 荷叶边 木耳 花边 包边 双层 里布 内衬 可拆 可脱卸 拆卸 背带 垫肩 内置胸垫 无痕 无缝 一片式 挂脖 露脐 短版 长版 打结 绑结 扎结 腰带款 系带款 抽绳款 拉链开衫 半开襟 全开襟 前开 后开 交叉 交叉带 绑带式 抹胸 裹身 包裹 刺绣工艺 印花工艺 烧花 烂花 剪花 破口 割破 金属扣 铆钉 亮片装饰 刺绣 绣花 刺绣工艺",
    fit: "修身 宽松 阔版 oversize oversized 大版 直筒 阔腿 微喇 喇叭 锥形 小脚 紧身 贴身 高腰 中腰 低腰 收腰 收腰款 a字 h型 x型 o型 廓形 正肩 落肩 插肩 蝙蝠袖 泡泡袖 羊腿袖 喇叭袖 灯笼袖 荷叶袖 无袖 短袖 长袖 七分袖 五分袖 九分袖 中袖 长款 中长款 短款 超短 及膝 过膝 及踝 拖地款 常规款 标准版 加长款 v领 圆领 方领 一字领 大圆领 小圆领 深v 半高领 高领 立领 翻领 polo领 衬衫领 西装领 连帽款 无帽 帽衫款 套头款 背心款 吊带款 挂脖款 束脚 修身型 宽松型 微弹版 直筒型 松紧款 束腰 溜肩 平肩 直角肩 宽肩 窄肩 短身材 高腰线 低腰线 收脚 微阔 超大版 均码 自由码 开衫 套头 连帽",
    category: "外套 夹克 衬衫 衬衣 t恤 卫衣 毛衣 针织衫 毛衫 马甲 背心 吊带 大衣 风衣 西装 西服 棉服 棉衣 羽绒服 派克 冲锋衣 皮衣 牛仔外套 工装外套 棒球服 运动外套 衬衫夹克 长裤 短裤 休闲裤 工装裤 牛仔裤 运动裤 西裤 卫裤 打底裤 阔腿裤 半身裙 连衣裙 长裙 短裙 连体裤 睡裙 家居服 睡衣 泳衣 泳裤 打底衫 polo衫 上衣 下装 套装 两件套 三件套 四件套 裤子 裙子 服饰 服装",
    handfeel: "柔软 亲肤 轻薄 厚实 挺括 垂感 悬垂 软糯 细腻 顺滑 丝滑 蓬松 干爽 爽滑 柔顺 柔滑 硬挺 有型 轻便 轻盈 冰感 凉感 温暖 暖和 舒适 服帖 不扎 软软 软绒 加厚感 微弹感",
    fabric: "纯棉 全棉 棉 棉质 棉混纺 精梳棉 水洗棉 棉麻 亚麻 麻 苎麻 真丝 桑蚕丝 丝 丝绸 雪纺 乔其 欧根纱 网纱 纱 蕾丝布 牛仔 牛仔布 水洗牛仔 弹力牛仔 针织 梭织 毛织 毛线 羊毛 羊绒 混纺 兔毛 貂绒 珊瑚绒 法兰绒 颗粒绒 羊羔绒 仿羊羔绒 皮草 人造皮草 皮革 真皮 仿皮 pu皮 麂皮 绒面 灯芯绒 天鹅绒 金丝绒 丝绒 醋酸 缎面 缎 仿真丝 涤纶 聚酯纤维 锦纶 尼龙 氨纶 弹力 高弹 四面弹 莫代尔 天丝 冰丝 竹纤维 再生纤维 粘纤 粘胶 羽绒 羽绒棉 白鸭绒 灰鸭绒 充绒 毛呢 呢子 羊毛呢 双面呢 粗花呢 泡泡纱 提花布 印花布 色织 帆布 牛津布 涤棉 无纺布 冰感面料 速干面料 抗菌 微弹 无弹 有弹 羊驼毛 呢料 涤塔夫 太空棉 银狐绒 牛奶丝 奥代尔 罗马布 华夫格 卫衣布 螺纹布",
    pattern: "条纹 竖条纹 横条纹 细条纹 宽条纹 格纹 格子 千鸟格 方格 菱格 波纹 波点 圆点 碎花 小碎花 大花 花卉 花朵 印花 满印 局部印花 提花 纯色 素色 单色 字母 字母印花 文字 logo 标 卡通 动漫 动物 动物纹 豹纹 蛇纹 斑马纹 鳄鱼纹 迷彩 渐变色 渐变 拼色 撞色 扎染 蜡染 晕染 手绘 涂鸦 花卉印花 蝴蝶 星星 爱心 心形 几何 几何图案 菱形 圆形 三角 线条 网格 棋盘格 千鸟 亮片 烫钻 钉珠 珠片 水钻 亮丝 闪 镭射 反光 3D印花 数码印花 胶印 丝印 油墨印 抽象 复古印花 民族印花 花 植物 叶子 树叶 热带 樱花 玫瑰 蘑菇 太阳 月亮 云 海浪 贝壳 笑脸 熊猫 猫 狗 兔子 小熊 色块 双色 多色 三色 无图案 白色 黑色 花色 彩色 彩色印花",
    style: "欧美 欧美风 个性 个性风格 复古风 街头 休闲 休闲风 商务休闲 商务 美式复古 美式 复古 法式 法风 港风 韩版 韩系 日系 日式 意式 英伦 英伦风 ins风 ins 网红 小众 高级感 高级 精致 简约 极简 百搭 基础款 街头 街头风 工装 工装风 学院风 学院 纯欲 辣妹 辣妹风 甜辣 甜酷 甜美 气质 轻熟 老钱风 老钱 美拉德 男友风 中性风 慵懒风 慵懒 随性 潮牌 潮流 时尚 洋气 显瘦 减龄 温柔 森系 波西米亚 巴洛克 前卫 复古港风 复古风 机能风 户外风 居家风 甜心 少女 淑女 知性 都市 轻奢 奢华 简约风 极简风 极简主义 冷淡风 暗黑 哥特 朋克 y2k 千禧 新中式 国潮 国风 民族风 波普 洛丽塔 学院派 美式街头 复古学院 摩登 经典 传统 甜妹 千金风 富家 显白 显高 遮肉 修身显瘦 气质款 高级款 百搭款",
    /* ⑨ 季节时令：用户裁决单独立类（时间维度，与场景的「场合」区分） */
    season: "春季 夏季 秋季 冬季 春夏 秋冬 春秋 四季 早春 初春 早秋 初秋 初夏 深秋 寒冬 严冬 冬款 夏款 秋款 春款 换季 上新季 当季 本季 过季 反季 应季 保暖季 spring summer autumn fall winter all-season season four-season",
    aud: "男士 男装 男式 男款 女装 女式 女款 女士 男女同款 男女 情侣 情侣款 情侣装 中性 成人 大童 中童 小童 少年 青年 中青年 中年 中老年 老人 老年人 老爸 爸爸装 男友 老爸款 大码 加大码 加加大 特大码 胖mm 大码女装 大码男装 微胖 高个 高个子 瘦高 加肥 加肥加大 妈妈装 孕妇装 学生党 上班族 plus-size plus size big-size big-and-tall oversized-fit curvy tall petite men women mens womens ladies menswear womenswear unisex couple couples teen teens junior maternity",
    func: "可机洗 机洗 手洗 免烫 抗皱 防皱 不易皱 不易起球 不起球 抗起球 耐磨 耐穿 快干 速干 排汗 吸湿 透气 弹力 高弹 微弹 四面弹 拉伸 防晒 防紫外线 upf 防水 防风 防泼水 防雨 防污 三防 抗菌 除臭 保暖 蓄热 发热 加厚 降温 凉感 冰感 免熨 易打理 好打理 免维护 多功能 可收纳 轻量 便携 户外级 专业级 防护 速干型 washable machine-washable quick-dry quickdry moisture-wicking breathable stretch stretchy elastic waterproof windproof water-repellent anti-wrinkle wrinkle-free durable antibacterial thermal insulated insulated warm cooling lightweight portable functional upf50"
  };

  /* ---------------- 八类词典（英文，跨境标题大量使用） ---------------- */
  var LEX_EN = {
    /* 归位优先级：场景 → 工艺 → 版型 → 品类 → 手感 → 面料 → 图案 → 风格，先到先得 */
    scene: "daily work office party beach vacation holiday wedding bridal bridesmaid sport gym fitness yoga running golf outdoor hiking camping home sleep lounge pajama school campus date travel festival christmas halloween new-year valentine easter thanksgiving birthday vacation-wear beachwear sportswear casual-wear office-wear date-night street-style gift gifts present presents",
    craft: "washed wash distressed ripped rip frayed raw-hem fringe tassel drawstring lace-up lace up hollow cutout cut-out spliced patchwork zipper zip button buttons pocket pockets quilted padded fleece-lined brushed pleated ruched belted tie bow ruffle ruffles layered double-layer lined removable detachable shoulder-pad seamless knot wrap crossover smocked shirred crinkle crinkled studded rivet beaded pearl sequined laser reflective waterproof windproof wrinkle-free anti-wrinkle quick-dry breathable sweat-absorbent sun-protection thermal warm embroidered embroidery",
    fit: "oversized loose slim skinny straight wide-leg wideleg bootcut flare flared tapered high-waist highwaist high-waisted mid-rise low-rise cropped long midi maxi mini sleeveless long-sleeve short-sleeve half-sleeve three-quarter-sleeve v-neck vneck crewneck round-neck o-neck square-neck halter off-shoulder one-shoulder turtleneck hooded-collar lapel collar bodycon a-line regular relaxed drop-shoulder puff-sleeve lantern-sleeve bat-sleeve flare-sleeve wide-shoulder regular-fit slim-fit loose-fit plus-size big-size tall petite elastic-waist drawstring-waist belted-waist empire-waist hooded open-front cardigan-style pullover-style",
    category: "jacket coat shirt tshirt tee hoodie sweatshirt sweater cardigan pullover vest tank 打底 打底衫 打底裤 长袍 坎肩 马甲背心 dress skirt pants trousers jeans shorts suit blazer uniform pajamas swimsuit jumpsuit romper blouse set sets outfit outfits piece pieces",
    handfeel: "soft light lightweight thick cozy comfy smooth silky crisp drapey fluffy plush breathable-feel",
    fabric: "cotton linen silk satin chiffon denim knit knitted weaving woven wool cashmere fleece velvet corduroy mesh polyester spandex nylon modal rayon acrylic faux-leather leather pu fur sherpa flannel jersey canvas tweed terry ribbed rib velvet-velour lace-fabric tulle organza crepe georgette velvet-velvet cotton-blend linen-blend wool-blend polyester-blend cotton-poly breathable skin-friendly stretch stretchy non-stretch thick-fabric",
    pattern: "striped stripe stripes plaid check checked checks floral flower flowers print printed prints graphic letter letters polka dot dots camo camouflage leopard snake snakeskin zebra crocodile tie-dye tie dye solid colorblock colourblock patchwork sequin sequins rhinestone rhinestones glitter sparkle heart hearts star stars butterfly butterflies cartoon anime animal animals abstract gradient ombre geometric geometry diamond checkered checked-grid houndstooth flower-print leaf leaves tropical cherry rose mushroom sun moon cloud wave shell smile panda cat dog rabbit bear multiple-color two-tone",
    style: "vintage retro american french korean japanese british italian chic elegant sexy cute sweet lovely aesthetic minimalist minimal classic traditional casual basic trendy fashionable stylish streetwear street harajuku y2k boho bohemian preppy business office ol ins hot sale new-arrival fashion fancy luxury premium quality slimming"
  };

  /* ---------------- 其它高频词（品类 / 性别 / 时间 / 套装 / 泛用） ---------------- */
  var GENERAL = "t恤 t恤衫 短袖t恤 长袖t恤 衬衫 衬衣 上衣 卫衣 帽衫 连衣裙 裙 半身裙 短裙 长裙 连衣裤 裤 裤子 长裤 短裤 牛仔裤 阔腿裤 休闲裤 运动裤 打底裤 瑜伽裤 工装裤 西裤 外套 外衣 夹克 风衣 大衣 棉服 羽绒服 马甲 背心 吊带 吊带衫 西装 西服 套装 两件套 三件套 四件套 家居服 睡衣 泳衣 泳装 内衣 文胸 运动内衣 打底衫 针织衫 毛衣 开衫 卫裤 波衫 雪纺衫 罩衫 披肩 配件 帽子 围巾 袜子 腰带 包 包臀裙 鱼尾裙 伞裙 百褶裙 直筒裙 铅笔裤 五分裤 七分裤 九分裤 微喇裤 连体裤 连衣裙款 女装 男装 女 男 女士 男士 女性 男性 女款 男款 中性 男女同款 情侣 情侣款 亲子 亲子款 姐妹 闺蜜 儿童 童装 男童 女童 宝宝 婴儿 大码 加大码 胖mm 胖妹妹 小个子 高个子 高个 显高 青少年 学生 学生党 少女 成年 中老年 中年 老年 妈妈 孕妇 春季 夏季 秋季 冬季 春夏 秋冬 春秋 四季 早春 初秋 初夏 冬款 夏款 秋款 春款 保暖款 秋冬款 春夏款 新款 新品 新 时尚 潮流 潮 热卖 爆款 爆 好看 漂亮 精选 优选 品质 高质量 好物 推荐 必入 必备 超值 划算 便宜 实惠 折扣 清仓 特价 促销 秒杀 包邮 现货 预售 代发 一件代发 工厂 直销 批发 厂家 直供 正品 原单 尾单 库存 上新 上新款 当季 应季 换季 本命年 生肖 龙年 兔年 马年 蛇年 一件 单件 2件 3件 3件套 2件套 4件套 五件 三件 两件 装 套 款 内搭款 外穿款 女式 男式 欧美 欧美风 欧货 外贸 跨境 亚马逊 速卖通 temu shein 常规 通用 四季款 百搭款 单件套 混搭";

  var GENERAL_EN = "t-shirt tshirt tee shirt shirts blouse blouses dress dresses skirt skirts pants trousers jeans coat jacket jackets hoodie hoodies sweatshirt sweater sweaters top tops set sets suit suits vest tank shorts leggings jumpsuit romper pajamas pajama swimsuit bikini lingerie underwear bra camisole cardigan pullover overalls blazer uniform costume women woman womens men man mens menswear kids kid children boy boys girl girls baby infant toddler plus size big size tall petite multipack pcs pack piece pieces vests uniform";

  /* 空泛词：统计里保留但标灰，提示少用 */
  var FILLER = ("新款 新品 新 时尚 潮流 潮 热卖 爆款 爆 好看 漂亮 精选 优选 品质 高质量 好物 推荐 必入 必备 超值 划算 便宜 实惠 折扣 清仓 特价 促销 秒杀 包邮 现货 预售 代发 一件代发 工厂 直销 批发 厂家 直供 正品 原单 尾单 库存 上新 上新款 当季 应季 换季 款 装 套 女 男 中性 女装 男装 女款 男款 女式 男式 常规 通用 外贸 跨境 亚马逊 速卖通 women men woman man kids fashion hot sale new trendy women men woman man mens womens kids children baby").split(/\s+/);

  /* 停用词：纯功能词，不参与统计 */
  var STOP = "the for and with of a an to in on at by or is are be this that it its from as your you our we all more best fit multi blend pcs pack piece pieces".split(/\s+/);
  var STOP_MAP = {};
  STOP.forEach(function (w) { STOP_MAP[w] = 1; });
  var FILLER_MAP = {};

  /* 噪音词：卖家写的元词与虚词，本身不是卖点，逐条丢弃、不进统计。
     例：「XX面料」「版型设计」「适合日常」里的「面料/版型/设计/适合」都是元词。 */
  var NOISE = ("非常适合 可穿 可搭配 均可 都行 适合 适用于 适用 用于 设计 款式设计 可选 可选购 可选颜色 通用 常规 常规款 常规版 品质 高品质 必备 穿着 穿搭必备 搭配 活动 面料 版型 图案 风格 舒适 轻便 防寒 加热 件装 条装 件套 一套 本品 以上 如下 说明 提示 注意 备注 图片 颜色随机 手工测量 误差 参考 尺寸表 尺码表 拍大 拍小 建议 推荐搭配 同款 相似款 店铺 关注 收藏 加购 优惠 领券 券后 到手价 好评 五星 服务 售后 退换 包退 保修 正装 童装款 suitability designed suitable used ideal perfect great good nice beautiful wonderful amazing high low quality basic simple easy convenient multi various different assorted mixed random").split(/\s+/);
  var NOISE_MAP = {};
  NOISE.forEach(function (w) { NOISE_MAP[w] = 1; });
  FILLER.forEach(function (w) { FILLER_MAP[w] = 1; });

  /* 多词英文短语先合并成连字符形式，才能整体匹配 */
  var PHRASES = [
    "long sleeve", "short sleeve", "half sleeve", "three quarter sleeve", "puff sleeve",
    "lantern sleeve", "bat sleeve", "flare sleeve", "drop shoulder", "wide leg",
    "high waist", "high waist", "mid rise", "low rise", "v neck", "round neck",
    "o neck", "square neck", "off shoulder", "one shoulder", "crew neck",
    "plus size", "big size", "elastic waist", "drawstring waist", "belted waist",
    "empire waist", "slim fit", "loose fit", "regular fit", "a line", "double layer",
    "tie dye", "tie dye", "faux leather", "faux fur", "cotton blend", "linen blend",
    "wool blend", "polyester blend", "cotton poly", "fleece lined", "raw hem",
    "lace up", "cut out", "shoulder pad", "new year", "date night", "street style",
    "casual wear", "office wear", "beach wear", "vacation wear", "sport wear",
    "sports wear", "anti wrinkle", "quick dry", "sun protection", "sweat absorbent",
    "skin friendly", "non stretch", "two tone", "multi color", "light weight",
    "hot sale", "new arrival", "multiple color"
  ].sort(function (a, b) { return b.length - a.length; });

  /* 建索引：词 → 槽位 */
  var DICT = {};
  var WORDMAX = 1;
  function addDict(src, slot) {
    String(src).split(/\s+/).forEach(function (w) {
      w = w.trim();
      if (!w) return;
      if (!(w in DICT)) DICT[w] = slot;
      if (w.length > WORDMAX) WORDMAX = w.length;
    });
  }
  /* 归位优先级（硬规则，先注册者优先）：人群 → 季节 → 功能 → 场景 → 工艺 → 版型 → 品类 → 手感 → 面料 → 图案 → 风格 */
  var PRIORITY = ["aud", "season", "func", "scene", "craft", "fit", "category", "handfeel", "fabric", "pattern", "style"];
  function ordered(obj) {
    var keys = PRIORITY.filter(function (k) { return obj[k]; });
    Object.keys(obj).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    return keys;
  }
  ordered(LEX).forEach(function (k) { addDict(LEX[k], k); });
  ordered(LEX_EN).forEach(function (k) { addDict(LEX_EN[k], k); });
  Object.keys(LEX).forEach(function (k) { /* 中文词长优先 */ });

  var GEN_DICT = {};
  String(GENERAL).split(/\s+/).forEach(function (w) {
    w = w.trim(); if (!w) return;
    GEN_DICT[w] = 1;
    if (!(w in DICT)) DICT[w] = "";
    if (w.length > WORDMAX) WORDMAX = w.length;
  });
  String(GENERAL_EN).split(/\s+/).forEach(function (w) {
    w = w.trim(); if (!w) return;
    GEN_DICT[w] = 1;
    if (!(w in DICT)) DICT[w] = "";
    if (w.length > WORDMAX) WORDMAX = w.length;
  });

  if (WORDMAX > 14) WORDMAX = 14;

  /* ---------------- 规范化 ---------------- */
  var SEP = /[\s,，、;；/|｜\\+＋·•—–_~～*＊"'“”‘’()（）\[\]【】{}<>《》:：!！?？。.…]+/;

  function norm(s) {
    var t = String(s == null ? "" : s);
    t = t.replace(/[\uFF01-\uFF5E]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    }).replace(/\u3000/g, " ");
    t = t.toLowerCase();
    t = t.replace(/[^\u4e00-\u9fa5a-z0-9+#.\s\-]/g, " ");
    t = t.replace(/\s+/g, " ").trim();
    /* 短语合并：long sleeve → long-sleeve */
    if (t) {
      PHRASES.forEach(function (p) {
        if (t.indexOf(p) === -1) return;
        var re = new RegExp("(^|\\s)" + p.replace(/ /g, "\\s+") + "(?=\\s|$)", "g");
        t = t.replace(re, function (m, pre) { return pre + p.replace(/ /g, "-"); });
      });
    }
    return t.replace(/\s+/g, " ").trim();
  }

  function isHan(c) { return /[\u4e00-\u9fa5]/.test(c); }
  function isAlnum(c) { return /[a-z0-9]/.test(c); }

  /* ---------------- 分词 ---------------- */
  function segWord(seg) {
    var out = [];
    /* 整段命中词典（long-sleeve / t-shirt / loose-fit 这类复合词）直接取，
       否则会被内部的短词抢先切开 */
    if (seg.length <= 24 && seg in DICT) return [seg];
    var i = 0, n = seg.length;
    while (i < n) {
      /* ① 词典最长匹配（含「t恤」这类中英混合词条） */
      var hit = "", maxL = Math.min(WORDMAX, n - i);
      for (var L = maxL; L >= 1; L--) {
        var cand = seg.substr(i, L);
        if (cand in DICT && !(L === 1 && isAlnum(cand) && !GEN_DICT[cand])) { hit = cand; break; }
      }
      if (hit) { out.push(hit); i += hit.length; continue; }

      /* ② 英文 / 数字串整段取（保留 zipper-pull、2pcs 这类） */
      if (isAlnum(seg[i])) {
        var m = seg.slice(i).match(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:[+#.][a-z0-9]+)*/);
        if (m && m[0]) { out.push(m[0]); i += m[0].length; continue; }
        i++; continue;
      }

      /* ③ 未登录汉字块：2-4 字整块保留（可能是新词），过长视为噪音丢弃 */
      var j = i, block = "";
      while (j < n && isHan(seg[j])) {
        var two = (j + 1 <= n) ? seg.substr(j, 2) : "";
        if (two && two.length === 2 && two in DICT) break;
        block += seg[j]; j++;
        if (block.length >= 6) break;
      }
      if (block.length) {
        if (block.length >= 2 && block.length <= 4) out.push(block);
        i = j;
        continue;
      }
      i++;
    }
    return out;
  }

  function tokenize(title) {
    var t = norm(title);
    var raws = [];
    if (!t) return { raw: "", words: [] };
    t.split(SEP).forEach(function (seg) {
      seg = seg.trim();
      if (!seg) return;
      segWord(seg).forEach(function (w) { raws.push(w); });
    });

    var seen = {}, words = [];
    raws.forEach(function (w) {
      if (!w) return;
      if (/^[\d.]+$/.test(w)) return;
      if (w.length === 1) {
        /* 单字：仅保留词典收录的汉字（棉 / 纱 / 麻） */
        if (!(isHan(w) && (w in DICT))) return;
      }
      if (STOP_MAP[w]) return;
      if (NOISE_MAP[w]) return;          /* 元词/虚词：不进任何统计 */
      if (seen[w]) return;
      seen[w] = 1;
      /* 件数规格（3件 / 2件装 / 三件套）→ 品类形态信息 */
      var qty = /^([0-9一二两三四五六七八九十]+)(件|件装|件套|套|条|只|双|入)$/.test(w);
      words.push({ w: w, slot: qty ? "category" : ((w in DICT) ? DICT[w] : "") });
    });

    /* 年份单独保留（2026 之类跨境标题常用） */
    var y = t.match(/\b20\d{2}\b/g) || [];
    y.forEach(function (v) {
      if (!seen[v]) { seen[v] = 1; words.push({ w: v, slot: "" }); }
    });
    return { raw: t, words: words };
  }

  /* ---------------- 统计 ---------------- */
  function tally(rows, opt) {
    opt = opt || {};
    var hidePattern = opt.hidePattern === true;
    var list = rows || [];
    var total = list.length;
    var withTitle = 0;
    var sumChars = 0, sumTokens = 0;

    var cnt = {}, slotDenom = {}, genCnt = {}, uniqSet = {}, noTitle = 0;

    list.forEach(function (r) {
      var title = String((r && r.title) || "").trim();
      if (!title) { noTitle++; return; }
      withTitle++;
      sumChars += title.length;
      var tk = tokenize(title);
      sumTokens += tk.words.length;

      var slotHit = {};
      tk.words.forEach(function (o) {
        if (hidePattern && o.slot === "pattern") return;
        if (!o.slot) {
          genCnt[o.w] = (genCnt[o.w] || 0) + 1;
          uniqSet[o.w] = 1;
          return;
        }
        var k = o.slot + "|" + o.w;
        cnt[k] = (cnt[k] || 0) + 1;
        slotHit[o.slot] = 1;
        uniqSet[o.w] = 1;
      });
      Object.keys(slotHit).forEach(function (s) { slotDenom[s] = (slotDenom[s] || 0) + 1; });
    });

    var slots = SLOTS.filter(function (s) { return !(hidePattern && s.key === "pattern"); }).map(function (s) {
      var denom = slotDenom[s.key] || 0;
      var words = [];
      Object.keys(cnt).forEach(function (k) {
        var p = k.split("|");
        if (p[0] !== s.key) return;
        var n = cnt[k];
        words.push({
          w: p[1], n: n,
          pct: denom ? Math.round(n / denom * 1000) / 10 : 0,
          ofTotal: total ? Math.round(n / total * 1000) / 10 : 0
        });
      });
      words.sort(function (a, b) { return b.n - a.n || a.w.length - b.w.length || a.w.localeCompare(b.w); });
      return {
        key: s.key, no: s.no, name: s.name, label: s.label,
        words: words, denom: denom,
        coverPct: total ? Math.round(denom / total * 1000) / 10 : 0
      };
    });

    var general = Object.keys(genCnt).map(function (w) {
      return {
        w: w, n: genCnt[w],
        pct: total ? Math.round(genCnt[w] / total * 1000) / 10 : 0,
        filler: !!FILLER_MAP[w]
      };
    }).filter(function (x) { return x.n > 1 || x.w.length > 1; })
      .sort(function (a, b) { return b.n - a.n || a.w.length - b.w.length || a.w.localeCompare(b.w); });

    return {
      total: total, withTitle: withTitle, noTitle: noTitle,
      uniq: Object.keys(uniqSet).length,
      avgChars: withTitle ? Math.round(sumChars / withTitle) : 0,
      avgTokens: withTitle ? Math.round(sumTokens / withTitle * 10) / 10 : 0,
      slots: slots, general: general, hidePattern: hidePattern
    };
  }

  /* ---------------- 组词 ---------------- */
  /* 组词语序（自然读法）：风格 → 图案 → 工艺 → 版型 → 面料 → 手感 → 场景 → 品类 */
  var ORDER = ["season", "aud", "style", "pattern", "craft", "fit", "fabric", "func", "handfeel", "scene", "category"];

  function pickList(picked, opt) {
    opt = opt || {};
    var out = [], seen = {};
    ORDER.forEach(function (k) {
      if (opt.hidePattern && k === "pattern") return;
      var w = picked && picked[k];
      if (!w) return;
      var v = String(w).trim();
      if (!v || seen[v]) return;
      seen[v] = 1;
      out.push({ key: k, w: v });
    });
    return out;
  }

  function compose(picked, sep, opt) {
    var arr = pickList(picked, opt).map(function (x) { return x.w; });
    var d = sep === "comma" ? "，" : sep === "pipe" ? " | " : " ";
    return arr.join(d);
  }

  /* 自然语序：风格 → 图案 → 工艺 → 版型 → 面料 → 场景（中文标题常见读法） */
  function composeNatural(picked, sep, opt) {
    var src = pickList(picked, opt), out = [], seen = {};
    ORDER.forEach(function (k) {
      var f = src.filter(function (x) { return x.key === k; })[0];
      if (f && !seen[f.w]) { seen[f.w] = 1; out.push(f.w); }
    });
    var d = sep === "comma" ? "，" : sep === "pipe" ? " | " : " ";
    return out.join(d);
  }

  /* 评分：字数 + 槽位覆盖 + 长度结构，满分 100 */
  function score(text, picked, opt) {
    var t = String(text || "");
    var chars = t.length;
    var filled = pickList(picked, opt).length;
    var slots = SLOTS.length - ((opt && opt.hidePattern) ? 1 : 0);
    if (chars === 0) return { chars: 0, filled: 0, slots: slots, score: 0, over: false };

    var s = 0;
    if (chars < 10) s += 10;
    else if (chars < 18) s += 18;
    else if (chars <= 60) s += 30;
    else s += Math.max(0, 30 - (chars - 60));

    s += filled * 8;

    var parts = t.split(/[\s，|]+/).filter(function (x) { return x; });
    if (parts.length >= 3) s += 8;
    else if (parts.length === 2) s += 4;

    var lens = parts.map(function (x) { return x.length; });
    var avg = lens.length ? lens.reduce(function (a, b) { return a + b; }, 0) / lens.length : 0;
    if (avg >= 2 && avg <= 6) s += 6;

    var seen = {}, dup = 0;
    parts.forEach(function (x) { if (seen[x]) dup++; seen[x] = 1; });
    s -= dup * 6;

    s = Math.max(0, Math.min(100, Math.round(s)));
    return { chars: chars, filled: filled, slots: slots, score: s, over: chars > 60 };
  }

  /* ---------------- 词库 / CSV ---------------- */
  function bank(rows, opt) {
    var t = tally(rows, opt);
    var out = [];
    t.slots.forEach(function (s) {
      s.words.forEach(function (w) {
        out.push({ w: w.w, n: w.n, pct: w.pct, slot: s.key, group: s.name });
      });
    });
    t.general.forEach(function (w) {
      out.push({ w: w.w, n: w.n, pct: w.pct, slot: "", group: w.filler ? "泛用词" : "其它" });
    });
    out.sort(function (a, b) { return b.n - a.n || a.w.localeCompare(b.w); });
    return { rows: out, total: t.total };
  }

  function q(v) {
    var s = String(v == null ? "" : v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCSV(rows) {
    var head = ["类目", "周次", "站点", "原标题", "字数", "命中词", "建议词组"];
    var lines = [head.map(q).join(",")];
    (rows || []).forEach(function (r) {
      var words = (r.words || []).map(function (x) { return x.w; }).join(" / ");
      lines.push([r.category, r.period, r.site, r.title,
        String(r.title || "").length, words, r.suggest || ""].map(q).join(","));
    });
    return "\uFEFF" + lines.join("\r\n");
  }

  window.TITLE_WORDS = {
    SLOTS: SLOTS,
    DICT: DICT,
    FILLER: FILLER,
    norm: norm,
    tokenize: tokenize,
    tally: tally,
    compose: compose,
    composeNatural: composeNatural,
    score: score,
    bank: bank,
    toCSV: toCSV
  };
})();
