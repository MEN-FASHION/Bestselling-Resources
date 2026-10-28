/* ============================================================
 * track-menu.js —— 菜单点击热度上报（唯一实现，五个页面共用）
 * ------------------------------------------------------------
 * 后台「用户动向 → 专区·菜单热度」的数据来源。
 * 为什么单独一个文件、而不是写进各页脚本：
 *   rank.html 与 admin.html 并不引入 common.js，若把埋点放进 common.js，
 *   这两个页面就统计不到；放在这里由所有页面统一引入，避免"改一处漏一处"。
 *
 * 覆盖范围（一次事件委托，静态菜单与后台动态补进来的菜单都能命中）：
 *   - 前台顶部菜单：.top-tabs .tab-link
 *   - 前台类目菜单：.cat-menu a / .cat-menu li
 *   - 后台侧边菜单：.nav-item[data-target]
 *   - 其它标签页：.legal-tab / .notice-tab-btn / [data-menu]
 *
 * 原则：
 *   - 只记录，不改变任何点击行为（不 preventDefault、不拦截）；
 *   - 静默失败：统计不到绝不影响浏览；未登录用户交由服务端忽略；
 *   - 不产生额外查询，上报是"点一下发一次"，不轮询。
 * 依赖：js/supabase.js 提供的 SB.trackEvent（缺失时自动跳过）。
 * ============================================================ */
(function () {
  "use strict";
  if (window.MenuTrack) return;

  var SEL = ".top-tabs .tab-link, .nav-item[data-target], .cat-menu a, .cat-menu li, .legal-tab, .notice-tab-btn, [data-menu]";

  // 由页面路径推断所属专区：优先匹配专区定义（后台可在「专区管理」新增），匹配不到就用文件名
  function zoneOf(path) {
    try {
      var m = String(path || "").match(/([^\/#?]+)(#.*)?$/);
      var file = (m && m[1]) || "";
      var hash = ((m && m[2]) || "").replace("#", "");
      if (/^admin\.html$/i.test(file)) return "admin";
      var defs = (window.ZONE_DEFS || window.ZONE_DEFS_DEFAULT || []);
      for (var i = 0; i < defs.length; i++) {
        var d = defs[i];
        if (!d || !d.href) continue;
        var parts = String(d.href).split("#");
        if (parts[0] === file && (!parts[1] || parts[1] === hash)) return d.key || "";
      }
      return file.replace(/\.html$/i, "") || "";
    } catch (e) { return ""; }
  }

  function labelOf(el) {
    try {
      var t = (el.getAttribute("data-menu") || el.textContent || "").trim().replace(/\s+/g, " ");
      return t.slice(0, 30);
    } catch (e) { return ""; }
  }

  // 返回本次上报的内容（便于自检）；任何异常都不抛出
  function report(el, path) {
    try {
      if (!el || !el.getAttribute) return null;
      if (!window.SB || typeof SB.trackEvent !== "function") return null;
      var label = labelOf(el);
      if (!label) return null;
      var p = path || (location.pathname + location.hash);
      var z = el.getAttribute("data-zone") || zoneOf(p);
      SB.trackEvent("menu", z, label, p);
      return { zone: z, menu: label, path: p };
    } catch (e) { return null; }
  }

  var bound = false;
  function bind() {
    if (bound || !document || !document.addEventListener) return;
    bound = true;
    document.addEventListener("click", function (ev) {
      try {
        if (ev.button !== undefined && ev.button !== 0) return; // 只看左键
        var el = ev.target;
        while (el && el !== document) {
          if (el.matches && el.matches(SEL)) { report(el); return; }
          el = el.parentNode;
        }
      } catch (e) { /* 统计失败不影响浏览 */ }
    }, true);
  }

  try { bind(); } catch (e) { /* 绑定失败不影响浏览 */ }

  window.MenuTrack = { bind: bind, report: report, zoneOf: zoneOf, labelOf: labelOf, SEL: SEL };
})();
