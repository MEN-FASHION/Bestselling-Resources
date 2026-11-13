/* 期次名归一
   同一个期次有好几种写法：W45 / w45 / 45周 / 第45周 / 2026-W45。
   以前前台按库里原文罗列，同一周会出现两个按钮；后台选了「第45周」，
   表格里自带「W45」，导入后又多出一个期次。
   这里统一成「第N周」，查询时由数据层把各种写法一起匹配（见 supabase.js 的 expandPeriods），
   数据一条都不会漏。 */
(function (global) {
  "use strict";

  function normPeriodLabel(v) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return "";
    var n = 0;
    var m = s.match(/[Ww]\s*0*(\d{1,2})/);          /* W45 / w5 / 2026-W45 */
    if (m) n = parseInt(m[1], 10);
    else {
      m = s.match(/第\s*0*(\d{1,2})\s*周/);          /* 第45周 */
      if (m) n = parseInt(m[1], 10);
      else {
        m = s.match(/^0*(\d{1,2})\s*周$/);           /* 45周 */
        if (m) n = parseInt(m[1], 10);
        else if (/^0*\d{1,2}$/.test(s)) n = parseInt(s, 10);   /* 纯数字 45 */
      }
    }
    if (n >= 1 && n <= 53) return "第" + n + "周";
    return s;                                        /* 月份、日期、自定义名字原样保留 */
  }

  /* 一组期次去重后统一命名，保持原有顺序 */
  function normPeriodList(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (p) {
      var n = normPeriodLabel(p);
      if (!n || seen[n]) return;
      seen[n] = 1;
      out.push(n);
    });
    return out;
  }

  global.normPeriodLabel = normPeriodLabel;
  global.normPeriodList = normPeriodList;
  if (typeof module === "object" && module.exports) module.exports = { normPeriodLabel: normPeriodLabel, normPeriodList: normPeriodList };
})(typeof window !== "undefined" ? window : globalThis);
