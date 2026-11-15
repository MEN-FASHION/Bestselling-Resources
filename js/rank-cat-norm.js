/* 类目名清洗与归并 —— 仅用于后台「类目清理…」里用户主动点击的那个归并按钮。
   20261114G：导入与前台展示都不再调用这里的规则。后台选什么类目，写进库就是什么、
   前台就显示什么，全程原样直通，不会因为名字里带某个词就被改成另一个类目。
   这里保留的唯一用途：用户明确要「把一批早年的长名字合并成一个标准名」时，由他点按钮触发。 */
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

  /* 分隔符：平台全路径名（服装、鞋靴和珠宝饰品，男士时尚，…）才会带。
     注意不要把「/」算进来 ——「打底/压缩」这类正式类目名本身就带斜杠。 */
  var SEP = /[，,、＞>｜|;；:：]/;

  /* 只有「看起来就不像类目名」的值才需要清洗：
       ① 纯数字（平台类目 ID）
       ② 带路径分隔符（平台全路径名）
       ③ 超过 20 字
     20261114G：短名一律不动。以前按关键词改写真名，把后台选好的
     「打底压缩」改成「运动功能服」（命中 压缩 关键词），后台选什么前台就该显示什么。 */
  function isDirty(name) {
    var t = String(name == null ? "" : name).replace(/\s+/g, " ").trim();
    if (!t) return false;
    if (/^\d+$/.test(t)) return true;
    if (SEP.test(t)) return true;
    if (t.length > 20) return true;
    return false;
  }

  function lastSeg(s) {
    var t = s.replace(/[，,、＞>/／|｜;；:：]/g, "，");
    if (t.indexOf("，") < 0) return s;
    var parts = t.split("，").map(function (x) { return x.trim(); }).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : s;
  }

  /* 把「脏」类目名归一成标准名。
     20261114G：干净短名（含后台所选的正式类目名）原样返回，绝不按关键词改写；
     只有全路径名 / 纯数字 ID / 超长名才走规则表清洗。 */
  function normalize(name) {
    var s = String(name == null ? "" : name).replace(/\s+/g, " ").trim();
    if (!s) return "其他";
    /* 纯数字是平台类目 ID，没有语义，统一进其他 */
    if (/^\d+$/.test(s)) return "其他";
    /* 关键：短名视为正式类目名，原样保留（后台选「打底压缩」就显示「打底压缩」） */
    if (!isDirty(s)) return s;

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

  global.RankCatNorm = { normalize: normalize, needsFix: needsFix, isDirty: isDirty, RULES: RULES };
})(typeof window !== "undefined" ? window : globalThis);
