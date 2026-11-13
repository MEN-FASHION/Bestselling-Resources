/* 类目名清洗与归并
   用途：导入榜单时，表格里的「叶子类目名称」有时是平台全路径
   （如「服装、鞋靴和珠宝饰品，男士时尚，男装，男士休闲运动服，男士休闲运动套装，男士运动服」），
   直接拿来建类目，后台类目菜单就会被一堆长名字撑爆。
   这里把它归一到固定的一组标准类目名。 */
(function (global) {
  "use strict";

  /* 顺序即优先级：越具体的先判，避免「男士休闲运动套装」被「运动」抢走 */
  var RULES = [
    ["背带裤", /背带/],
    ["马甲背心", /马甲|背心|vest|tank/i],
    ["西装正装", /西装|西服|正装|tuxedo|blazer|suit jacket/i],
    ["棉服羽绒", /棉服|羽绒|棉衣|派克|down|puffer/i],
    ["抓绒衫", /抓绒|摇粒绒|fleece/i],
    ["开衫", /开衫|cardigan/i],
    ["卫衣", /卫衣|帽衫|连帽衫|hoodie/i],
    ["毛衣", /毛衣|毛衫|针织衫|套头衫|针织套头|sweater|pullover|knitwear/i],
    ["衬衫", /衬衫|shirt/i],
    ["POLO", /polo/i],
    ["T恤", /t\s*恤|亨利衫|t-shirt|tee\b/i],
    ["球衣", /球衣|篮球|橄榄球|足球|棒球|排球|战袍|jersey/i],
    ["牛仔", /牛仔|denim|jean/i],
    ["工装", /工装|军服|厨师|行政|workwear/i],
    ["短裤", /短裤|shorts/i],
    ["裤装", /长裤|休闲裤|运动裤|西裤|裤/i],
    ["套装", /套装|（套）|set\b/i],
    ["运动功能服", /运动|健身|训练|滑雪|单板|徒步|登山|露营|钓鱼|骑行|高尔夫|瑜伽|田径|径赛|跑步|拳击|紧身衣|紧身连体|压缩|sport|activewear|outdoor/i],
    ["传统服饰", /传统|汉服|民族|旗袍|traditional/i],
    ["外套夹克", /外套|夹克|大衣|风衣|雨衣|赛车|摩托|彩弹|防护|jacket|coat/i],
  ];

  /* 制服、礼服这类小众品类统一进「其他」，避免菜单被单例类目塞满 */
  var MISC = /礼服|毕业|啦啦队|吉祥物|制服|校服|舞会|燕尾服|长袍|迪沙沙|装扮|cosplay|童装|宠物/;

  function pickRule(s) {
    if (MISC.test(s)) return "其他";
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i][1].test(s)) return RULES[i][0];
    }
    return null;
  }

  function lastSeg(s) {
    var t = s.replace(/[，,、＞>/／|｜;；:：]/g, "，");
    if (t.indexOf("，") < 0) return s;
    var parts = t.split("，").map(function (x) { return x.trim(); }).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : s;
  }

  /* 把任意类目名归一成标准名；归不进标准类目时，返回清洗后的短名 */
  function normalize(name) {
    var s = String(name == null ? "" : name).replace(/\s+/g, " ").trim();
    if (!s) return "其他";
    /* 纯数字是平台类目 ID，没有语义，统一进其他 */
    if (/^\d+$/.test(s)) return "其他";

    var hit = pickRule(s);
    if (hit) return hit;

    var seg = lastSeg(s);
    if (seg !== s) {
      hit = pickRule(seg);
      if (hit) return hit;
      /* 末段若仍是「男士休闲运动」这种没品类信息的描述，继续退到「其他」 */
      if (/^男|^女|^男士|^女士|^情侣|^中性/.test(seg) && seg.length > 6) return "其他";
      s = seg;
    }
    return s.length > 20 ? s.slice(0, 20) : s;
  }

  /* 判断是否需要归并（归一后与原名不同） */
  function needsFix(name) {
    var s = String(name == null ? "" : name).trim();
    return !!s && normalize(s) !== s;
  }

  global.RankCatNorm = { normalize: normalize, needsFix: needsFix, RULES: RULES };
})(typeof window !== "undefined" ? window : globalThis);
