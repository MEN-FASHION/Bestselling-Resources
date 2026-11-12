/* ============================================================================
 * admin-compare.js —— 渠道对比 · 列配置（20261112B）
 * ----------------------------------------------------------------------------
 * 渠道对比页本身是只读聚合页（把各专区的图按月并排展示），后台要管的是
 * 「对比哪几列、叫什么名字、什么顺序、空列显不显示」。
 *
 * 配置存 site_settings.frontend_dims.compare_sources，不改表结构：
 *   { list:[{key,label,type,channel}], showEmpty:bool, perRow:number }
 *   type = "rank"（上新节奏·月度榜单） | "channel"（某个渠道的图）
 *
 * 新增渠道不用改代码：本面板每次打开都会去读「渠道图里出现过的渠道名」，
 * 勾上即成一列；前台也做了同样的自动发现，两处口径一致。
 * ==========================================================================*/
(function () {
  var $ = function (s) { return document.querySelector(s); };
  function SBx() { return window.SB || null; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(t, ok) {
    if (window.sbToast) return window.sbToast(t, ok !== false);
    var m = $("#cmpa-msg");
    if (m) m.textContent = t || "";
  }
  function say(t) { var m = $("#cmpa-msg"); if (m) m.textContent = t || ""; }

  var state = {
    list: [],        // 当前列配置（有序）
    pool: [],        // 可选项：上新节奏 + 所有渠道名
    showEmpty: true,
    perRow: 0,
    ready: false,
  };

  var RANK_KEY = "rank:month";

  function keyOf(ch) { return "ch:" + ch; }

  async function load() {
    var SB = SBx();
    if (!SB) { say("数据层未就绪，请强刷页面重试"); return; }
    say("加载中…");

    /* 可选项：上新节奏 + 渠道名（渠道图存储 + 榜单里出现过的渠道） */
    var names = [];
    try {
      if (typeof SB.listRankChannelNames === "function") names = (await SB.listRankChannelNames()) || [];
    } catch (e) { names = []; }
    /* 已配置但当前没数据的渠道也要留着，否则用户配置过的一列会被静默吃掉 */
    var conf = null;
    try { conf = (typeof SB.getCompareSources === "function") ? await SB.getCompareSources() : null; }
    catch (e) { conf = null; }

    var pool = [{ key: RANK_KEY, label: "上新节奏", type: "rank", channel: "" }];
    var seen = {};
    names.forEach(function (n) {
      var c = String(n || "").trim();
      if (!c || seen[c]) return;
      seen[c] = 1;
      pool.push({ key: keyOf(c), label: c, type: "channel", channel: c });
    });
    (conf && conf.list ? conf.list : []).forEach(function (x) {
      if (x.type !== "channel") return;
      var c = String(x.channel || "").trim();
      if (!c || seen[c]) return;
      seen[c] = 1;
      pool.push({ key: keyOf(c), label: c, type: "channel", channel: c });
    });

    state.pool = pool;
    state.list = (conf && conf.list && conf.list.length) ? conf.list.map(function (x) {
      return { key: x.key, label: x.label, type: x.type, channel: x.channel };
    }) : pool.slice();
    state.showEmpty = conf ? conf.showEmpty !== false : true;
    state.perRow = conf ? Number(conf.perRow) || 0 : 0;
    state.ready = true;

    render();
    say("");
  }

  function render() {
    var box = $("#cmpa-list");
    if (box) {
      box.innerHTML = "";
      if (!state.list.length) {
        box.innerHTML = '<p class="hint">还没有对比列。在下面勾选要参与对比的专区 / 渠道。</p>';
      }
      state.list.forEach(function (s, i) {
        var row = document.createElement("div");
        row.className = "cmpa-row";
        row.innerHTML =
          '<span class="cmpa-idx">' + (i + 1) + "</span>" +
          '<input class="input cmpa-label" value="' + esc(s.label) + '" placeholder="列名">' +
          '<code class="cmpa-key">' + esc(s.key) + "</code>" +
          '<span class="cmpa-type">' + (s.type === "rank" ? "月度榜单" : "渠道图") + "</span>" +
          '<span class="cmpa-ops">' +
            '<button type="button" class="btn-ghost small cmpa-up" title="上移">↑</button>' +
            '<button type="button" class="btn-ghost small cmpa-down" title="下移">↓</button>' +
            '<button type="button" class="btn-ghost small cmpa-del" title="移出对比">✕</button>' +
          "</span>";
        row.querySelector(".cmpa-label").onchange = function (e) {
          state.list[i].label = String(e.target.value || "").trim() || state.list[i].key;
        };
        row.querySelector(".cmpa-up").onclick = function () {
          if (i === 0) return;
          var t = state.list[i - 1]; state.list[i - 1] = state.list[i]; state.list[i] = t;
          render();
        };
        row.querySelector(".cmpa-down").onclick = function () {
          if (i >= state.list.length - 1) return;
          var t = state.list[i + 1]; state.list[i + 1] = state.list[i]; state.list[i] = t;
          render();
        };
        row.querySelector(".cmpa-del").onclick = function () {
          state.list.splice(i, 1);
          render();
        };
        box.appendChild(row);
      });
    }

    var chips = $("#cmpa-pool");
    if (chips) {
      chips.innerHTML = "";
      var used = {};
      state.list.forEach(function (s) { used[s.key] = 1; });
      state.pool.forEach(function (p) {
        var on = !!used[p.key];
        var b = document.createElement("button");
        b.type = "button";
        b.className = "cmpa-chip" + (on ? " is-on" : "");
        b.innerHTML = (on ? "✓ " : "＋ ") + esc(p.label) +
          '<i>' + (p.type === "rank" ? "月度榜单" : "渠道") + "</i>";
        b.onclick = function () {
          if (on) {
            state.list = state.list.filter(function (x) { return x.key !== p.key; });
          } else {
            state.list.push({ key: p.key, label: p.label, type: p.type, channel: p.channel });
          }
          render();
        };
        chips.appendChild(b);
      });
      if (!state.pool.length) chips.innerHTML = '<p class="hint">还没有任何渠道数据。</p>';
    }

    var se = $("#cmpa-show-empty");
    if (se) se.checked = state.showEmpty !== false;
    var pr = $("#cmpa-per-row");
    if (pr) pr.value = String(state.perRow || 0);
  }

  async function save() {
    var SB = SBx();
    if (!SB || typeof SB.setCompareSources !== "function") { toast("数据层版本偏旧，请强刷页面重试", false); return; }
    if (!state.list.length) { toast("至少要留一列", false); return; }
    try {
      await SB.setCompareSources({
        list: state.list,
        showEmpty: !!state.showEmpty,
        perRow: Number(state.perRow) || 0,
      });
      toast("已保存，前台刷新即生效");
      say("已保存 " + new Date().toLocaleTimeString());
    } catch (e) {
      toast("保存失败：" + ((e && e.message) || "未知错误"), false);
    }
  }

  async function resetDefault() {
    var SB = SBx();
    state.list = state.pool.slice();
    state.showEmpty = true;
    state.perRow = 0;
    render();
    try {
      if (SB && typeof SB.setCompareSources === "function") {
        await SB.setCompareSources({ list: state.list, showEmpty: true, perRow: 0 });
        toast("已恢复默认：全部列都参与对比");
      }
    } catch (e) { toast("恢复失败：" + ((e && e.message) || "未知错误"), false); }
  }

  function init() {
    if (!$("#compare-card")) return;
    var b = $("#cmpa-save");
    if (b) b.onclick = save;
    var r = $("#cmpa-refresh");
    if (r) r.onclick = load;
    var d = $("#cmpa-reset");
    if (d) d.onclick = resetDefault;
    var se = $("#cmpa-show-empty");
    if (se) se.onchange = function () { state.showEmpty = !!se.checked; };
    var pr = $("#cmpa-per-row");
    if (pr) pr.onchange = function () { state.perRow = Number(pr.value) || 0; };
    var open = $("#cmpa-open-front");
    if (open) open.onclick = function () { window.open("compare.html", "_blank"); };
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.CompareAdmin = { reload: load, state: state };
})();
