/* 站点名归一
   ---------------------------------------------------------------
   同一个国家在数据里有无数种写法：美国 / 美国站 / 美国(US) / US / USA /
   United States / 美国-全托管 …… 而前台「国家站点」菜单只认后台
   「站点管理」里维护的那一个名字。

   两边对不上时的后果非常隐蔽：数据明明在库里，前台按「美国」过滤后
   一条都匹配不上 —— 页面显示「该组合下暂无榜单数据」，看起来像数据丢了。
   （「导了 100 多张只显示 18 张」也是同一类问题：18 张是站点恰好写成
   「美国」的那几条，其余写成别的样子，被当成别的国家。）

   这里只做一件事：给任意写法算出一个「归一键」。
   resolve() 用这个键在后台清单里找对应的正式名字，找不到就返回原文，
   绝不会把数据改成认不出的样子。
   --------------------------------------------------------------- */
(function (global) {
  "use strict";

  /* 常见写法 → 统一键（键本身不用来显示，只用来比对） */
  var ALIAS = {
    "美国": ["美国", "美国站", "美区", "us", "usa", "u.s.", "u.s.a.", "us站", "unitedstates", "america", "美国us"],
    "英国": ["英国", "英国站", "uk", "gb", "unitedkingdom", "britain", "england"],
    "德国": ["德国", "德国站", "de", "germany", "deutschland"],
    "法国": ["法国", "法国站", "fr", "france"],
    "意大利": ["意大利", "意大利站", "it", "italy", "italia"],
    "西班牙": ["西班牙", "西班牙站", "es", "spain", "espana"],
    "荷兰": ["荷兰", "荷兰站", "nl", "netherlands", "holland"],
    "波兰": ["波兰", "波兰站", "pl", "poland"],
    "葡萄牙": ["葡萄牙", "葡萄牙站", "pt", "portugal"],
    "瑞典": ["瑞典", "瑞典站", "se", "sweden"],
    "比利时": ["比利时", "比利时站", "be", "belgium"],
    "奥地利": ["奥地利", "奥地利站", "at", "austria"],
    "爱尔兰": ["爱尔兰", "爱尔兰站", "ie", "ireland"],
    "丹麦": ["丹麦", "丹麦站", "dk", "denmark"],
    "芬兰": ["芬兰", "芬兰站", "fi", "finland"],
    "挪威": ["挪威", "挪威站", "no", "norway"],
    "瑞士": ["瑞士", "瑞士站", "ch", "switzerland"],
    "捷克": ["捷克", "捷克站", "cz", "czech", "czechia"],
    "匈牙利": ["匈牙利", "匈牙利站", "hu", "hungary"],
    "罗马尼亚": ["罗马尼亚", "罗马尼亚站", "ro", "romania"],
    "希腊": ["希腊", "希腊站", "gr", "greece"],
    "加拿大": ["加拿大", "加拿大站", "ca", "canada"],
    "墨西哥": ["墨西哥", "墨西哥站", "mx", "mexico"],
    "澳大利亚": ["澳大利亚", "澳大利亚站", "澳洲", "au", "australia"],
    "新西兰": ["新西兰", "新西兰站", "nz", "newzealand"],
    "日本": ["日本", "日本站", "日区", "jp", "japan"],
    "韩国": ["韩国", "韩国站", "韩区", "kr", "korea", "southkorea"],
    "新加坡": ["新加坡", "新加坡站", "sg", "singapore"],
    "马来西亚": ["马来西亚", "马来西亚站", "my", "malaysia"],
    "泰国": ["泰国", "泰国站", "th", "thailand"],
    "越南": ["越南", "越南站", "vn", "vietnam"],
    "菲律宾": ["菲律宾", "菲律宾站", "ph", "philippines"],
    "印尼": ["印尼", "印度尼西亚", "印尼站", "id", "indonesia"],
    "巴西": ["巴西", "巴西站", "br", "brazil"],
    "智利": ["智利", "智利站", "cl", "chile"],
    "哥伦比亚": ["哥伦比亚", "哥伦比亚站", "co", "colombia"],
    "秘鲁": ["秘鲁", "秘鲁站", "pe", "peru"],
    "沙特": ["沙特", "沙特阿拉伯", "沙特站", "sa", "saudiarabia", "ksa"],
    "阿联酋": ["阿联酋", "阿联酋站", "ae", "uae", "unitedarabemirates"],
    "以色列": ["以色列", "以色列站", "il", "israel"],
    "土耳其": ["土耳其", "土耳其站", "tr", "turkey", "turkiye"],
    "南非": ["南非", "南非站", "za", "southafrica"],
    "尼日利亚": ["尼日利亚", "尼日利亚站", "ng", "nigeria"],
    "埃及": ["埃及", "埃及站", "eg", "egypt"],
    "欧盟": ["欧盟", "欧区", "欧洲", "eu", "europe", "europeanunion"],
    "全球": ["全球", "全部", "全部站点", "all", "global", "worldwide"]
  };

  var KEY = {};   /* 统一键（已去掉空格和标点）→ 标准名 */
  var STD = {};   /* 认得出的标准名集合 */
  Object.keys(ALIAS).forEach(function (std) {
    STD[std] = 1;
    ALIAS[std].forEach(function (w) {
      KEY[squash(w)] = std;
    });
  });

  /* 去空格、去分隔符、转小写：比对时唯一有意义的差异就是这些 */
  function squash(s) {
    return String(s == null ? "" : s)
      .replace(/\s+/g, "")
      .replace(/[·．.、,，/|｜_\-—－:：'"“”‘’]/g, "")
      .toLowerCase();
  }

  /* 清洗：去掉「(US)」「（美国）」这类补充说明、去掉「站 / 站点 / 国家 / 地区 / 市场」后缀 */
  function clean(v) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return "";
    s = s.replace(/[（(\[【][^）)\]】]*[）)\]】]/g, "").trim();   /* 括号里的补充说明 */
    s = s.replace(/(站点|站|国家|地区|市场)$/g, "").trim();
    /* 「美国-全托管」「美国 / 半托管」这类：只取第一段 */
    var seg = s.split(/[\/|｜\-—－_,，、·]/)[0].trim();
    if (seg) s = seg;
    return s;
  }

  /* 归一键：任何写法 → 同一个字符串即可，不用于显示 */
  function key(v) {
    var s = clean(v);
    if (!s) return "";
    var k = squash(s);
    if (KEY[k]) return KEY[k];
    /* 「美国US」「美国(US)」清完剩「美国US」：试着砍掉尾部的字母再匹配一次 */
    var m = k.match(/^([\u4e00-\u9fa5]{2,8})[a-z]{1,3}$/);
    if (m && KEY[m[1]]) return KEY[m[1]];
    /* 「US美国」这种前缀写法 */
    var m2 = k.match(/^[a-z]{1,3}([\u4e00-\u9fa5]{2,8})$/);
    if (m2 && KEY[m2[1]]) return KEY[m2[1]];
    return s;                    /* 认不出来的，按清洗后的原文当键 */
  }

  /* 在给定清单里找归一后同名的那一项，返回清单里的写法；找不到返回清洗后的原文 */
  function resolve(v, list) {
    var raw = String(v == null ? "" : v).trim();
    if (!raw) return "";
    var k = key(raw);
    if (Array.isArray(list)) {
      for (var i = 0; i < list.length; i++) {
        var cand = String(list[i] == null ? "" : list[i]).trim();
        if (!cand) continue;
        if (key(cand) === k) return cand;      /* 用清单里的正式名字，不用对不上号的那串原文 */
      }
    }
    /* 清单里没有 → 只要认得出是哪个国家（美国站 / US / 美国-全托管），就用标准中文名；
       认不出（比如「火星站」）就原样返回，绝不猜、绝不改写。 */
    if (STD[key(k)]) return k;
    return raw;
  }

  /* 两组名字是否指同一个国家 */
  function same(a, b) {
    return key(a) !== "" && key(a) === key(b);
  }

  global.SiteNorm = { key: key, clean: clean, resolve: resolve, same: same, ALIAS: ALIAS };
  if (typeof module === "object" && module.exports) {
    module.exports = { key: key, clean: clean, resolve: resolve, same: same, ALIAS: ALIAS };
  }
})(typeof window !== "undefined" ? window : globalThis);
