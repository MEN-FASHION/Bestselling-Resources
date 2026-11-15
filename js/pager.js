/* ============================================================================
 * pager.js —— 长列表分页（20261115B）
 *
 * 背景：后台「已上传记录」和「期次清单」是按批次 / 期次一条一行铺开的，
 * 期次越积越多，整页就被拉得很长，要滚很久才能看到下面的面板。
 *
 * 这里只做一件事：把数组切成当前页，并给出一条页脚控件。
 *   · 每页条数 10 / 20 / 50 / 全部，选过的值记在 sessionStorage，三处列表共用
 *   · 当前页码按列表 key 记在内存里，重新取数（删除、改名后）会保留页码并自动夹取到有效范围
 *   · 不发任何请求、不写数据库；不改变任何业务口径，只是少画几行
 *
 * 用法（调用方自己负责画行）：
 *   const pg = Pager.slice(list, "rank.batches");
 *   box.innerHTML = "";
 *   pg.items.forEach((it) => box.appendChild(rowOf(it)));
 *   box.appendChild(Pager.node("rank.batches", pg, () => redraw()));
 * ==========================================================================*/
(function (g) {
  "use strict";
  /* 0 表示「全部」。10 是最小档，用于判断「这么短的列表不需要分页条」 */
  const SIZES = [10, 20, 50, 0];
  const MIN_PAGED = 10;
  const states = Object.create(null);

  function savedSize() {
    let v = null;
    try { v = g.sessionStorage ? g.sessionStorage.getItem("rk.pager.size") : null; } catch (e) { v = null; }
    const n = v == null ? NaN : parseInt(v, 10);
    return SIZES.indexOf(n) >= 0 ? n : 20;
  }
  function state(key) {
    const k = String(key || "default");
    if (!states[k]) states[k] = { page: 1, size: savedSize() };
    return states[k];
  }
  function setSize(key, size) {
    const s = state(key);
    const n = parseInt(size, 10);
    s.size = SIZES.indexOf(n) >= 0 ? n : 20;
    s.page = 1;
    try { if (g.sessionStorage) g.sessionStorage.setItem("rk.pager.size", String(s.size)); } catch (e) { /* 存不了不影响使用 */ }
    return s.size;
  }
  function reset(key) { state(key).page = 1; }
  function pageOf(key) { return state(key).page; }

  /* 切页：items 是完整数组，返回当前页该画的那几行 + 页脚需要的数字 */
  function slice(items, key) {
    const list = Array.isArray(items) ? items : [];
    const s = state(key);
    const size = s.size > 0 ? s.size : Math.max(1, list.length);
    const pages = Math.max(1, Math.ceil(list.length / size));
    if (s.page > pages) s.page = pages;
    if (s.page < 1) s.page = 1;
    const from = (s.page - 1) * size;
    return {
      items: list.slice(from, from + size),
      page: s.page,
      pages: pages,
      size: s.size,
      total: list.length,
      from: list.length ? from + 1 : 0,
      to: Math.min(list.length, from + size),
    };
  }

  /* 页脚控件。列表短到一屏能看完时返回空 div（不显示分页条，不占地方）
     anchor：列表容器；翻页后若它已经在视口上方，就把视口拉回来，
     否则点「下一页」后要自己往上滚才能看到新的一页。 */
  function node(key, info, onChange, anchor) {
    const wrap = (g.document && g.document.createElement) ? g.document.createElement("div") : null;
    if (!wrap) return null;
    wrap.className = "rk-pager";
    const fire = () => { if (typeof onChange === "function") onChange(); };
    const backToTop = () => {
      try {
        if (!anchor || typeof anchor.getBoundingClientRect !== "function") return;
        const top = anchor.getBoundingClientRect().top;
        if (top < 0) anchor.scrollIntoView({ block: "start" });
      } catch (e) { /* 滚动失败不影响翻页 */ }
    };

    if (!info || info.total <= MIN_PAGED) {
      wrap.classList.add("is-hidden");
      wrap.style.display = "none";
      return wrap;
    }

    const label = (info.size === 0 ? "全部 " + info.total : info.from + "–" + info.to) + " 条";
    const txt = g.document.createElement("span");
    txt.className = "rk-pager-info";
    txt.textContent = "第 " + info.page + " / " + info.pages + " 页 · 共 " + info.total + " 条（本页 " + label + "）";
    wrap.appendChild(txt);

    const btns = g.document.createElement("span");
    btns.className = "rk-pager-btns";
    const mk = (text, to, disabled) => {
      const b = g.document.createElement("button");
      b.type = "button";
      b.className = "btn-ghost small";
      b.textContent = text;
      b.disabled = !!disabled;
      b.onclick = () => {
        if (b.disabled) return;
        const s = state(key);
        if (s.page === to) return;
        s.page = to;
        fire();
        backToTop();
      };
      return b;
    };
    btns.appendChild(mk("‹ 上一页", info.page - 1, info.page <= 1));
    btns.appendChild(mk("下一页 ›", info.page + 1, info.page >= info.pages));
    wrap.appendChild(btns);

    /* 每页条数：改完回到第 1 页，避免停在一个已经不存在的页码上 */
    const sizeWrap = g.document.createElement("label");
    sizeWrap.className = "rk-pager-size";
    sizeWrap.appendChild(g.document.createTextNode("每页 "));
    const sel = g.document.createElement("select");
    SIZES.forEach((n) => {
      const o = g.document.createElement("option");
      o.value = String(n);
      o.textContent = n === 0 ? "全部" : String(n);
      if (n === info.size) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => { setSize(key, sel.value); fire(); };
    sizeWrap.appendChild(sel);
    wrap.appendChild(sizeWrap);

    return wrap;
  }

  g.Pager = { slice: slice, node: node, reset: reset, pageOf: pageOf, setSize: setSize, SIZES: SIZES };
})(typeof window !== "undefined" ? window : globalThis);
