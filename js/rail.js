/* ============================================================================
 * 左侧类目菜单 · 悬浮抽屉的「整列命中」控制器（仅前台）
 *
 * 问题：收起态侧栏只有约 54px 宽、118px 高的一小块可悬停，
 *       所以必须把鼠标移到左上角才能展开，很不方便。
 * 做法：把命中区扩到「整条左列」——
 *       横向：从列左边缘到「侧栏当前宽度 + 12px」；
 *       纵向：整个内容区（.gallery-layout）的高度，滚动到哪都能命中。
 *       鼠标进入左列任意位置即展开；移出后延时 140ms 收回（手抖不闪退）。
 * 边界：只作用于前台（body.front）；窄屏（≤900px）与后台一概不受影响。
 *       键盘 Tab 仍走 CSS 的 :focus-within，不依赖本脚本。
 * ========================================================================== */
(function () {
  "use strict";

  var COL_W = 54;          /* 收起态宽度（与样式一致） */
  var OPEN_W = 212;        /* 展开态宽度（与样式一致） */
  var EDGE = 12;           /* 右侧宽容边：允许鼠标略越过细轨 */
  var LEFT_EDGE = 6;       /* 左侧宽容边 */
  var CLOSE_DELAY = 140;   /* 移出后延时收回，避免手抖忽开忽关 */
  var NARROW = "(max-width: 900px)";   /* 窄屏下侧栏是普通大面板，不启用抽屉 */

  /* ---------------- 命中判定（纯函数，便于逐条验证边界） ---------------- */
  /* box = 内容区上下边界 + 列左边缘；open = 当前是否已展开（展开后命中区随宽度变宽） */
  function inZone(x, y, box, open) {
    if (!box || x == null || y == null) return false;
    var right = box.left + (open ? OPEN_W : COL_W) + EDGE;
    return x >= box.left - LEFT_EDGE && x <= right &&
           y >= box.top - EDGE && y <= box.bottom + EDGE;
  }

  var sb = null, layout = null, closeTimer = null, isOpen = false;

  function setOpen(v) {
    if (!sb || isOpen === v) return;
    isOpen = v;
    sb.classList.toggle("rail-open", v);
  }

  function boxOf() {
    if (!sb || !layout) return null;
    var sr = sb.getBoundingClientRect();
    var lr = layout.getBoundingClientRect();
    return { left: sr.left, top: lr.top, bottom: lr.bottom };
  }

  /* 核心：按坐标判断开合（暴露出来供验证直接驱动真实逻辑） */
  function apply(x, y) {
    if (!sb || !layout) return null;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    var hit = inZone(x, y, boxOf(), isOpen);
    setOpen(hit);
    if (!hit) closeTimer = setTimeout(function () { setOpen(false); closeTimer = null; }, CLOSE_DELAY);
    return hit;
  }

  function boot() {
    if (!document.body || !document.body.classList.contains("front")) return;
    /* 营销日历页的侧栏是"完整常显"的筛选栏，不参与细轨收缩（20261019O） */
    if (document.body.classList.contains("mk-page")) return;
    layout = document.querySelector(".gallery-layout");
    sb = layout ? layout.querySelector(".sidebar") : null;
    if (!sb) return;
    /* 窄屏不启用：那边侧栏是整块大面板，不需要抽屉 */
    if (window.matchMedia && window.matchMedia(NARROW).matches) return;

    document.addEventListener("mousemove", function (e) { apply(e.clientX, e.clientY); }, { passive: true });
    /* 鼠标移出窗口 / 切走标签页：直接收回，避免回来时残留展开 */
    document.addEventListener("mouseleave", function () { setOpen(false); });
    window.addEventListener("blur", function () { setOpen(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.Rail = {
    inZone: inZone, apply: apply, setOpen: setOpen,
    isOpen: function () { return isOpen; },
    COL_W: COL_W, OPEN_W: OPEN_W, EDGE: EDGE, LEFT_EDGE: LEFT_EDGE, CLOSE_DELAY: CLOSE_DELAY
  };
})();