/* ============================================================================
 * favstar.js —— 任意专区的「收藏星标」通用组件（20261114V）
 *
 * 目的：让「我的收藏」不再只能收趋势上升榜的图——S / P / T 专区、视觉专区、
 *       渠道对比、品牌动向里的每一张图都能一键收藏，并且记下"来自哪个专区"，
 *       收藏页据此按专区成列，用于横向比较各专区的类目 / 站点 / 期次差异。
 *
 * 设计（都是有意的，改之前先读）：
 *   ① 不改各专区的渲染代码：用 data-fav-source 声明来源，脚本自己去扫卡片、
 *      补一个 ☆ 按钮。异步渲染的页面靠 MutationObserver 兜住，不用各页面调时机。
 *   ② 星标固定在卡片右上角，点它不触发卡片自身的"点开大图"（stopPropagation）。
 *   ③ 收藏分类直接读「我的收藏」那套分类，不另建一套口径；已收藏的星标点亮。
 *   ④ 缺 source 列的老库也能收藏（数据层自动降级），只是收藏页归到"未标注专区"。
 * ========================================================================== */
(function (global) {
  "use strict";

  var EXT_TYPE = "application/x-fav-row";
  var DEF_SEL = ".mv-card, .cmp-card, .cell";

  var ST = {
    source: "",
    sel: DEF_SEL,
    uid: null,
    ready: false,
    cats: [],
    keys: {},        /* "期次|图片地址" -> 收藏条目 id（用于取消收藏） */
    items: [],
    pickEl: null,
    loading: false,
    scanTimer: null,
    obs: null,
  };

  function SBX() { try { return global.SB || null; } catch (e) { return null; } }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  var toastTimer = null;
  function toast(msg) {
    if (typeof global.toast === "function") { try { global.toast(msg); return; } catch (e) { /* 走下面的兜底 */ } }
    if (global.Common && typeof global.Common.toast === "function") {
      try { global.Common.toast(msg); return; } catch (e) { /* 兜底 */ }
    }
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  function labelOf(k) {
    var SB = SBX();
    if (SB && typeof SB.favSourceLabel === "function") return SB.favSourceLabel(k);
    return String(k || "") || "未标注专区";
  }

  function keyOf(period, url) { return String(period || "") + "|" + String(url || ""); }

  /* 收藏里只存"稳定地址"：站点内图片地址若带会话 token，收藏时必须剥掉——
     否则过一会儿 token 换了，收藏里那张图就打不开了。显示时由收藏页按当前会话补 token。 */
  function stripToken(u) {
    var s = String(u || "");
    if (s.indexOf("token=") < 0) return s;
    try {
      var m = s.match(/^([^?#]*)\?([^#]*)$/);
      if (!m) return s;
      var keep = m[2].split("&").filter(function (kv) {
        return kv && kv.split("=")[0] !== "token";
      });
      return keep.length ? (m[1] + "?" + keep.join("&")) : m[1];
    } catch (e) {
      return s;
    }
  }

  /* ---------- 从卡片上读出收藏需要的字段 ---------- */
  function cardUrl(card) {
    if (!card) return "";
    var u = card.getAttribute("data-url");
    if (u) return stripToken(String(u).trim());
    var img = card.querySelector("img");
    if (!img) return "";
    /* 视觉专区的图是鉴权路径：优先取不带临时 token 的 authUrl，换 token 也不会变地址 */
    var au = img.getAttribute("data-auth-url") || img.dataset.authUrl || "";
    if (au) return stripToken(String(au).trim());
    return stripToken(String(img.dataset.src || img.getAttribute("src") || "").trim());
  }

  function rowOf(card) {
    var img = card ? card.querySelector("img") : null;
    var url = cardUrl(card);
    var period = (card && card.getAttribute("data-period")) || "";
    var cat = (card && card.getAttribute("data-cat")) || "";
    if (!cat) {
      var e = card && card.querySelector(".mv-card-cat");
      if (e) cat = String(e.textContent || "").trim();
    }
    var title = (card && card.getAttribute("data-title")) || (img && img.alt) || cat || "";
    var isMonth = /^\d{4}-\d{2}$/.test(String(period));
    var isSeason = /季$/.test(String(period));
    return {
      image_url: url,
      title: String(title || ""),
      leaf_category: String(cat || ""),
      rank_category: String(cat || ""),
      site: (card && card.getAttribute("data-site")) || "",
      period_type: isMonth ? "month" : (isSeason ? "season" : "week"),
      period_label: String(period || ""),
      tags: [],
      source: ST.source,
    };
  }

  /* ---------- 星标绘制 ---------- */
  function paint(card) {
    if (!card) return;
    var b = card.querySelector("[data-fs-star]");
    if (!b) return;
    var row = rowOf(card);
    var on = String(row.image_url || "") !== "" && ST.keys[keyOf(row.period_label, row.image_url)];
    b.textContent = on ? "★" : "☆";
    b.classList.toggle("is-on", !!on);
    b.title = on ? "已收藏 · 点开可取消或换分类" : "收藏到「我的收藏」（来源：" + labelOf(ST.source) + "）";
  }

  function attach(card) {
    if (!card || card.getAttribute("data-fs") === "1") return;
    if (!card.querySelector("img")) return;
    if (!cardUrl(card)) return;
    card.setAttribute("data-fs", "1");
    card.classList.add("fs-host");
    var b = document.createElement("button");
    b.type = "button";
    b.className = "fs-star";
    b.setAttribute("data-fs-star", "1");
    b.setAttribute("aria-label", "收藏到我的收藏");
    b.textContent = "☆";
    b.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
    b.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openPick(card);
    });
    card.appendChild(b);

    /* 从卡片拖进右侧收藏抽屉的分类里（与榜单同一套拖放协议） */
    card.addEventListener("dragstart", function (ev) {
      try {
        var row = rowOf(card);
        if (!row.image_url || !ev.dataTransfer) return;
        ev.dataTransfer.setData(EXT_TYPE, JSON.stringify(row));
        ev.dataTransfer.effectAllowed = "copy";
        if (global.FavDrawer && typeof global.FavDrawer.openForDrop === "function") {
          try { global.FavDrawer.openForDrop(); } catch (x) { /* 抽屉异常不影响收藏 */ }
        }
      } catch (x) { /* 忽略 */ }
    });
    card.addEventListener("dragend", function () {
      if (global.FavDrawer && typeof global.FavDrawer.endDropMode === "function") {
        try { global.FavDrawer.endDropMode(); } catch (x) { /* 忽略 */ }
      }
    });

    paint(card);
  }

  function scan() {
    var list = all(ST.sel);
    for (var i = 0; i < list.length; i++) attach(list[i]);
  }

  function scheduleScan() {
    if (ST.scanTimer) clearTimeout(ST.scanTimer);
    ST.scanTimer = setTimeout(function () { ST.scanTimer = null; scan(); }, 220);
  }

  /* ---------- 分类选择弹层 ---------- */
  function closePick() {
    if (ST.pickEl && ST.pickEl.parentNode) ST.pickEl.parentNode.removeChild(ST.pickEl);
    ST.pickEl = null;
  }

  function openPick(card) {
    closePick();
    var row = rowOf(card);
    if (!row.image_url) { toast("这张图没有可收藏的地址"); return; }
    var SB = SBX();
    if (!SB) { toast("数据服务未就绪，请刷新页面"); return; }
    if (!ST.uid) { toast("请先登录后再收藏"); return; }
    if (!ST.ready) { toast("收藏功能还没启用，请先执行建表脚本"); return; }

    var existed = ST.keys[keyOf(row.period_label, row.image_url)];
    var wrap = document.createElement("div");
    wrap.className = "fs-wrap";
    var cats = (ST.cats || []).map(function (c) {
      return '<button type="button" class="fs-cat" data-cid="' + c.id + '">'
        + '<i class="fs-dot" style="background:' + esc(c.color || "#8b7355") + '"></i>'
        + '<span>' + esc(c.name) + "</span></button>";
    }).join("");
    wrap.innerHTML = ''
      + '<div class="fs-mask" data-fs-close="1"></div>'
      + '<div class="fs-box" role="dialog" aria-label="收藏到我的收藏">'
      +   '<div class="fs-hd">' + (existed ? "已收藏" : "收藏到「我的收藏」")
      +     '<em class="fs-src">来源 · ' + esc(labelOf(ST.source)) + '</em></div>'
      +   '<div class="fs-sub">' + esc((row.leaf_category || row.title || "这张图")) + "</div>"
      +   '<div class="fs-cats">' + (cats || '<div class="fs-none-tip">还没有分类，直接在下面新建一个</div>')
      +     '<button type="button" class="fs-cat is-none" data-cid=""><i class="fs-dot is-empty"></i><span>不分类</span></button>'
      +   "</div>"
      +   '<div class="fs-newrow">'
      +     '<input type="text" class="fs-newin" maxlength="40" placeholder="新建分类并收藏，如 印花T恤">'
      +     '<button type="button" class="fs-newok">建好并收藏</button>'
      +   "</div>"
      +   '<div class="fs-ft">'
      +     (existed ? '<button type="button" class="fs-btn is-danger" data-fs-unfav="1">取消收藏</button>' : "")
      +     '<button type="button" class="fs-btn" data-fs-close="1">关闭</button>'
      +   "</div>"
      + "</div>";
    document.body.appendChild(wrap);
    ST.pickEl = wrap;

    wrap.addEventListener("click", async function (ev) {
      var t = ev.target;
      if (t.closest("[data-fs-close]")) { closePick(); return; }
      var cbtn = t.closest("[data-cid]");
      if (cbtn) {
        var cid = cbtn.getAttribute("data-cid");
        await save(card, cid === "" ? null : Number(cid));
        closePick();
        return;
      }
      var ok = t.closest(".fs-newok");
      if (ok) { await createAndSave(card, wrap); return; }
      var un = t.closest("[data-fs-unfav]");
      if (un) { await unfav(card); closePick(); }
    });
    var inp = $(".fs-newin", wrap);
    if (inp) {
      inp.focus();
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") createAndSave(card, wrap); });
    }
    document.addEventListener("keydown", function onEsc(e) {
      if (e.key === "Escape") { closePick(); document.removeEventListener("keydown", onEsc); }
    });
  }

  async function createAndSave(card, wrap) {
    var SB = SBX();
    var inp = wrap && $(".fs-newin", wrap);
    var name = inp ? String(inp.value || "").trim() : "";
    if (!name) { toast("先写一个分类名"); return; }
    if (inp) inp.disabled = true;
    try {
      var c = await SB.createFavCategory(name, "#8b7355");
      try { ST.cats = await SB.listFavCategories(); } catch (e) { ST.cats = (ST.cats || []).concat([c]); }
      await save(card, c && c.id != null ? c.id : null);
      closePick();
    } catch (e) {
      if (inp) inp.disabled = false;
      toast((e && e.message) ? e.message : "新建分类失败");
    }
  }

  async function save(card, cid) {
    var SB = SBX();
    var row = rowOf(card);
    if (!row.image_url) { toast("这张图没有可收藏的地址"); return; }
    try {
      await SB.addFavItems([row], cid);
      ST.keys[keyOf(row.period_label, row.image_url)] = 1;
      paint(card);
      try { if (global.FavDrawer && global.FavDrawer.refresh) global.FavDrawer.refresh(); } catch (e) { /* 忽略 */ }
      toast("已收藏" + (labelOf(ST.source) ? " · " + labelOf(ST.source) : ""));
      load();  /* 后台刷新一次真实 id，取消收藏才用得上 */
    } catch (e) {
      toast((e && e.message) ? e.message : "收藏失败");
    }
  }

  async function unfav(card) {
    var SB = SBX();
    var row = rowOf(card);
    var id = ST.keys[keyOf(row.period_label, row.image_url)];
    try {
      if (typeof id === "number") await SB.removeFavItems([id]);
      else {
        /* 没有 id（刚收藏还没回填）：按同图匹配一条删掉 */
        var list = await SB.listFavItems();
        var hit = (list || []).filter(function (x) {
          return String(x.image_url || "") === String(row.image_url || "");
        })[0];
        if (hit) await SB.removeFavItems([hit.id]);
      }
      delete ST.keys[keyOf(row.period_label, row.image_url)];
      paint(card);
      try { if (global.FavDrawer && global.FavDrawer.refresh) global.FavDrawer.refresh(); } catch (e) { /* 忽略 */ }
      toast("已取消收藏");
    } catch (e) {
      toast((e && e.message) ? e.message : "取消收藏失败");
    }
  }

  /* ---------- 载入状态 ---------- */
  async function load() {
    var SB = SBX();
    if (!SB || typeof SB.listFavItems !== "function") return;
    if (ST.loading) return;
    ST.loading = true;
    try {
      try { ST.uid = (await SB.favUid()) || null; } catch (e) { ST.uid = null; }
      if (!ST.uid) return;
      try { ST.ready = await SB.favReady(); } catch (e) { ST.ready = false; }
      if (!ST.ready) return;
      try { ST.cats = await SB.listFavCategories(); } catch (e) { ST.cats = []; }
      try { ST.items = (await SB.listFavItems()) || []; } catch (e) { ST.items = []; }
      ST.keys = {};
      ST.items.forEach(function (it) {
        if (it && it.id != null) ST.keys[keyOf(it.period_label, it.image_url)] = Number(it.id);
      });
      scan();
    } finally {
      ST.loading = false;
    }
  }

  function watch() {
    if (ST.obs || typeof MutationObserver === "undefined" || !document.body) return;
    ST.obs = new MutationObserver(function () { scheduleScan(); });
    ST.obs.observe(document.body, { childList: true, subtree: true });
  }

  function init(opts) {
    var o = opts || {};
    ST.source = String(o.source || (document.body && document.body.getAttribute("data-fav-source")) || "").trim();
    ST.sel = String(o.selector || DEF_SEL);
    scan();
    watch();
    load();
  }

  /* 收藏页改动后（新增分类等）让星标跟上 */
  function refresh() { return load(); }

  function boot() {
    var src = document.body && document.body.getAttribute("data-fav-source");
    if (!src) return;                 /* 没声明的页面不挂星标 */
    init({ source: src });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  global.FavStar = {
    init: init,
    refresh: refresh,
    scan: scan,
    rowOf: rowOf,
    keyOf: keyOf,
    labelOf: labelOf,
    source: function () { return ST.source; },
    _test: {
      cardUrl: cardUrl,
      state: function () { return ST; },
      scheduleScan: scheduleScan,
    },
  };
})(typeof window !== "undefined" ? window : this);
