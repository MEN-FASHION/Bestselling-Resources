/* data-sync.js —— 「删了要立刻消失」的跨页面同步底座（20261114W）
 *
 * 事故现象：后台把图片删掉之后，界面上那张图还在，非要手动刷新整个网页才消失。
 * 原因有两层：
 *   1) 页面之间没有通知机制：后台删完只管自己那一块，已经打开着的前台页面不知道要重取；
 *   2) 数据层有内存缓存（榜单条目、渠道图文档等），就算重新取数，读回来的还是缓存里那份，
 *      删掉的那张依旧在，只有整页刷新（缓存重新建）才真的没了。
 *
 * 这里做三件事：
 *   · bump()   —— 任何「删了 / 改了」的写操作成功后调用一次，向外广播一个变更号；
 *   · watch()  —— 其它标签页收到后，先清数据层缓存，再调本页注册的重新取数函数；
 *                 页面不可见时不立刻重绘（避免白干），切回来时补一次；
 *   · invalidate() —— 清内存缓存（交给数据层的 invalidateCaches）。
 *
 * 注意：localStorage 的 storage 事件只在「其它标签页」触发，本页收不到自己发的，
 * 所以同一页里删完只会重绘一次，不会来回刷。
 */
(function () {
  var KEY = "tb_data_rev";
  var CH = "tb-data-sync";
  var bc = null;
  try { if (typeof BroadcastChannel === "function") bc = new BroadcastChannel(CH); } catch (e) { bc = null; }

  var subs = [];
  var lastAt = 0;
  var timer = null;
  var dirty = false;

  function emit(kind, at) {
    if (!at || at <= lastAt) return;   /* 同一条通知只处理一次（频道与 storage 可能都来） */
    lastAt = at;
    subs.forEach(function (fn) { try { fn(kind, at); } catch (e) { /* 单个订阅出错不影响其它 */ } });
  }

  /* 写操作成功后调用：kind 只是给人看的分类（images / rank / tags…），不影响判断 */
  function bump(kind) {
    var at = Date.now();
    var payload = { t: at, kind: kind || "" };
    try { localStorage.setItem(KEY, JSON.stringify(payload)); } catch (e) { /* 隐私模式忽略 */ }
    if (bc) { try { bc.postMessage(payload); } catch (e) { /* 忽略 */ } }
  }

  function watch(fn) { if (typeof fn === "function") subs.push(fn); }

  /* 清掉数据层的内存缓存 —— 不清的话重取回来还是旧数据 */
  function invalidate() {
    try {
      if (window.SB && typeof window.SB.invalidateCaches === "function") window.SB.invalidateCaches();
    } catch (e) { /* 数据层没这个函数时不影响重绘 */ }
  }

  function reloadNow() {
    invalidate();
    var fn = window.__tbReload;
    if (typeof fn !== "function") return;   /* 该页面没有登记重新取数的方法：静默跳过 */
    try { fn(); } catch (e) { /* 重取失败不弹窗，页面保持原样 */ }
  }

  /* 收到通知：可见就重绘（250ms 合并连续变更），不可见就记一笔，切回来再补 */
  function schedule() {
    if (document.hidden) { dirty = true; return; }
    dirty = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; reloadNow(); }, 250);
  }

  function init() {
    if (bc) {
      bc.onmessage = function (ev) {
        var d = ev.data || {};
        if (d && d.t) emit(d.kind, d.t);
      };
    }
    window.addEventListener("storage", function (e) {
      if (e.key !== KEY || !e.newValue) return;
      var d = null;
      try { d = JSON.parse(e.newValue); } catch (err) { return; }
      if (d && d.t) emit(d.kind, d.t);
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && dirty) { dirty = false; schedule(); }
    });
    watch(schedule);
  }

  window.DataSync = {
    bump: bump,
    watch: watch,
    invalidate: invalidate,
    reload: reloadNow,
    KEY: KEY,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
