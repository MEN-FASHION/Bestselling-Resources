/* ============================================================================
 * admin-compare.js —— 渠道对比 · 列配置 + 渠道清单（20261114T）
 * ----------------------------------------------------------------------------
 * 渠道对比页本身是只读聚合页（把各专区的图按月并排展示），后台要管两件事：
 *   ① 渠道清单：能配置哪些渠道（想加多少加多少、想删哪个删哪个）
 *   ② 对比列：其中哪些列要真的摆到前台、叫什么名字、什么顺序
 *
 * 20261114T 改动：以前「可加入的专区 / 渠道」只能从「库里已经出现过的渠道名」
 * 推出来，没传过图的渠道根本不在候选里，看起来就像「只有四个能配」。
 * 现在清单自己就是一份可编辑名单，存在 site_settings.frontend_dims.compare_channels，
 * 增删只动名单，不删任何图片。
 *
 * 配置键：
 *   compare_channels : ["SHEIN","Pinterest","TikTok","Amazon", ...]  渠道清单
 *   compare_sources  : { list:[{key,label,type,channel}], showEmpty, perRow }  对比列
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
    list: [],        // 当前对比列（有序）
    channels: [],    // 渠道清单（有序，来自 compare_channels）
    showEmpty: true,
    perRow: 0,
    /* 20261124A：渠道合并对比（merge.html）的「其他渠道」展示方式，存在 merge_view */
    mergeView: { split: false, allowFront: true },
    ready: false,
    dirty: false,    // 清单/列有没有改过还没保存
  };

  var RANK_KEY = "rank:month";

  /* 渠道显示名（20261114Q）：SHEIN → S、Pinterest → P、TikTok → T，其它原样 */
  var CH_SHORT = { shein: "S", pinterest: "P", tiktok: "T" };
  function chShort(name) {
    var raw = String(name == null ? "" : name).trim();
    if (!raw) return "";
    var k = raw.replace(/[\s_\-]/g, "").toLowerCase();
    return CH_SHORT[k] || raw;
  }
  function normCh(name) {
    return String(name == null ? "" : name).replace(/[\s_\-]/g, "").toLowerCase();
  }

  function keyOf(ch) { return "ch:" + normCh(ch); }

  function mkChannel(name) {
    var raw = String(name == null ? "" : name).trim().slice(0, 24);
    if (!raw) return null;
    return { key: keyOf(raw), label: chShort(raw), type: "channel", channel: raw };
  }
  function mkRank() { return { key: RANK_KEY, label: "上新节奏", type: "rank", channel: "" }; }

  /* 20261121D：榜单列（key = rank:month）是内置列 -------------------------------
     用户反馈「上新节奏在渠道对比里没了」。根因之一是：后台把这一列移出（或保存时
     从来没带上它）之后，配置里就再没有它，前台完全听配置 → 这一列永久消失，
     而且没有任何入口能加回来。现在前后台都把它当内置列：少了自动补最前，且不允许移出。 */
  function isRankName(v) {
    var k = String(v == null ? "" : v).replace(/[\s_\-:：]/g, "");
    if (!k) return false;
    return k === "rankmonth" || k === "上新节奏" || k === "榜单" || k === "月度榜单" ||
           k === "上新节奏榜单";
  }
  function ensureRankInList() {
    var has = state.list.some(function (s) { return s && s.type === "rank"; });
    if (!has) state.list.unshift(mkRank());
  }

  async function load() {
    var SB = SBx();
    if (!SB) { say("数据层未就绪，请强刷页面重试"); return; }
    say("加载中…");

    /* ① 渠道清单：优先用已保存的名单；没保存过就用「库里出现过的渠道 + 已配置的列」生成一次 */
    var names = [];
    try {
      if (typeof SB.listRankChannelNames === "function") names = (await SB.listRankChannelNames()) || [];
    } catch (e) { names = []; }
    var conf = null;
    try { conf = (typeof SB.getCompareSources === "function") ? await SB.getCompareSources() : null; }
    catch (e) { conf = null; }
    var saved = null;
    try { saved = (typeof SB.getCompareChannels === "function") ? await SB.getCompareChannels() : null; }
    catch (e) { saved = null; }

    var channels = [];
    var seenCh = {};
    function pushCh(n) {
      var c = String(n == null ? "" : n).trim();
      var k = normCh(c);
      if (!c || seenCh[k]) return;
      seenCh[k] = 1;
      channels.push(c);
    }
    if (Array.isArray(saved)) {
      /* 已经是一份明确的名单：以它为准（删掉的渠道不会因为历史图又被补回来） */
      saved.forEach(pushCh);
    } else {
      /* 首次：把「库里出现过的」和「已配置过的列」并进来，作为初始名单 */
      names.forEach(pushCh);
      (conf && conf.list ? conf.list : []).forEach(function (x) {
        if (x.type !== "channel") return;
        pushCh(x.channel || x.label || "");
      });
    }
    state.channels = channels;

    var pool = [mkRank()].concat(channels.map(mkChannel).filter(Boolean));
    state.list = (conf && conf.list && conf.list.length)
      ? conf.list.map(function (x) {
        /* 20261121D：早期保存丢过 type，或者名字被写成「榜单」，这里认回榜单列，
           否则它会变成一条没有数据的空渠道列（前台看起来就是「上新节奏没了」）。 */
        var t = (x.type === "rank" || isRankName(x.channel) || isRankName(x.label) || isRankName(x.key))
          ? "rank" : "channel";
        return {
          key: t === "rank" ? RANK_KEY : x.key,
          label: t === "rank" ? (String(x.label || "").trim() || "上新节奏") : x.label,
          type: t,
          channel: t === "rank" ? "" : x.channel,
        };
      })
      : pool.slice();
    /* 榜单列是内置列：配置里没有就补在最前面（否则保存一次就永久少一列） */
    ensureRankInList();
    state.showEmpty = conf ? conf.showEmpty !== false : true;
    state.perRow = conf ? Number(conf.perRow) || 0 : 0;

    /* ④ 渠道合并对比 · 其他渠道展示方式（读不到就按默认：合并 + 允许前台切换） */
    var mv = null;
    try { mv = (typeof SB.getMergeView === "function") ? await SB.getMergeView() : null; }
    catch (e) { mv = null; }
    state.mergeView = {
      split: !!(mv && mv.split),
      allowFront: !(mv && mv.allowFront === false),
    };
    renderMergeView();

    state.ready = true;
    state.dirty = false;

    render();
    say("");
  }

  /* ---------- ④ 其他渠道：合并 / 拆分（全站统一口径） ---------- */
  function renderMergeView() {
    var mv = state.mergeView || { split: false, allowFront: true };
    var rm = $("#mrgv-merge"), rs = $("#mrgv-split"), al = $("#mrgv-allow");
    if (rm) rm.checked = !mv.split;
    if (rs) rs.checked = !!mv.split;
    if (al) al.checked = mv.allowFront !== false;
  }

  async function saveMergeView() {
    var SB = SBx();
    if (!SB || typeof SB.setMergeView !== "function") {
      var m0 = $("#mrgv-msg"); if (m0) m0.textContent = "数据层版本偏旧，请强刷页面重试";
      toast("数据层版本偏旧，请强刷页面重试", false);
      return;
    }
    var rs = $("#mrgv-split");
    var al = $("#mrgv-allow");
    var cfg = {
      split: !!(rs && rs.checked),
      allowFront: !(al && al.checked === false),
    };
    try {
      await SB.setMergeView(cfg);
      state.mergeView = cfg;
      renderMergeView();
      var m = $("#mrgv-msg");
      if (m) m.textContent = "已保存（" + (cfg.split ? "拆分" : "合并") +
        "，" + (cfg.allowFront ? "前台可自行切换" : "前台只读") + "）· " + new Date().toLocaleTimeString();
      toast("渠道合并对比的展示方式已保存，前台刷新即生效");
    } catch (e) {
      var m2 = $("#mrgv-msg");
      if (m2) m2.textContent = "保存失败：" + ((e && e.message) || "未知错误");
      toast("保存失败：" + ((e && e.message) || "未知错误"), false);
    }
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
          state.dirty = true;
        };
        row.querySelector(".cmpa-up").onclick = function () {
          if (i === 0) return;
          var t = state.list[i - 1]; state.list[i - 1] = state.list[i]; state.list[i] = t;
          state.dirty = true;
          render();
        };
        row.querySelector(".cmpa-down").onclick = function () {
          if (i >= state.list.length - 1) return;
          var t = state.list[i + 1]; state.list[i + 1] = state.list[i]; state.list[i] = t;
          state.dirty = true;
          render();
        };
        row.querySelector(".cmpa-del").onclick = function () {
          if (state.list[i].type === "rank") {
            toast("「上新节奏 / 榜单」是内置对比列，不能移出（列名和顺序可以改）", false);
            return;
          }
          state.list.splice(i, 1);
          state.dirty = true;
          render();
        };
        box.appendChild(row);
      });
    }

    /* 可加入的专区 / 渠道：清单里的每一个都在这儿，勾上就进对比列；右侧 ✕ 从清单里删掉 */
    var chips = $("#cmpa-pool");
    if (chips) {
      chips.innerHTML = "";
      var used = {};
      state.list.forEach(function (s) { used[s.key] = 1; });
      var pool = [mkRank()].concat(state.channels.map(mkChannel).filter(Boolean));
      pool.forEach(function (p) {
        var on = !!used[p.key];
        var wrap = document.createElement("span");
        wrap.className = "cmpa-chip-wrap";

        var b = document.createElement("button");
        b.type = "button";
        b.className = "cmpa-chip" + (on ? " is-on" : "");
        b.innerHTML = (on ? "✓ " : "＋ ") + esc(p.label) +
          '<i>' + (p.type === "rank" ? "月度榜单" : "渠道") + "</i>";
        b.onclick = function () {
          /* 20261121D：内置榜单列不允许取消，否则配置里一旦没有它，前台就永久少一列 */
          if (p.type === "rank") {
            if (!on) {
              state.list.unshift(mkRank());
              state.dirty = true;
              render();
              toast("已把内置的「上新节奏」列补回第一位，记得保存");
            } else {
              toast("「上新节奏 / 榜单」是内置对比列，不能移出（列名和顺序可以改）", false);
            }
            return;
          }
          if (on) {
            state.list = state.list.filter(function (x) { return x.key !== p.key; });
          } else {
            state.list.push({ key: p.key, label: p.label, type: p.type, channel: p.channel });
          }
          state.dirty = true;
          render();
        };
        wrap.appendChild(b);

        /* ✕ 只对渠道清单里的项：把它从名单里删掉（不删图，也不影响已有数据） */
        if (p.type !== "rank") {
          var x = document.createElement("button");
          x.type = "button";
          x.className = "cmpa-chip-x";
          x.textContent = "✕";
          x.title = "把「" + p.label + "」从渠道清单里删掉（不删任何图片）";
          x.onclick = function (e) {
            if (e && typeof e.stopPropagation === "function") e.stopPropagation();
            dropChannel(p.channel, p.label);
          };
          wrap.appendChild(x);
        }
        chips.appendChild(wrap);
      });
      if (!pool.length) chips.innerHTML = '<p class="hint">还没有任何渠道。</p>';
    }

    var cnt = $("#cmpa-pool-count");
    if (cnt) cnt.textContent = "共 " + state.channels.length + " 个渠道（不含上新节奏）";

    var se = $("#cmpa-show-empty");
    if (se) se.checked = state.showEmpty !== false;
    var pr = $("#cmpa-per-row");
    if (pr) pr.value = String(state.perRow || 0);
  }

  /* 从渠道清单里删掉一个渠道：同时把它从对比列里移走。
     不删图、不删历史数据 —— 以后想加回来，重新填一遍名字即可。 */
  function dropChannel(raw, label) {
    var k = normCh(raw);
    if (!k) return;
    var nm = String(label || raw || "");
    var ask = window.uiConfirm
      ? Promise.resolve(window.uiConfirm("从渠道清单里删掉「" + nm + "」？\n\n只影响这里能配置哪些渠道，不删任何图片；以后要加回来，重新填一次名字即可。", {
        title: "删除渠道", okText: "删除",
      }))
      : Promise.resolve(true);
    Promise.resolve(ask).then(function (yes) {
      if (yes === false) return;
      state.channels = state.channels.filter(function (c) { return normCh(c) !== k; });
      state.list = state.list.filter(function (s) { return normCh(s.channel || "") !== k; });
      state.dirty = true;
      render();
      toast("已从渠道清单删除「" + nm + "」，记得点「保存配置」");
    });
  }

  async function save() {
    var SB = SBx();
    if (!SB || typeof SB.setCompareSources !== "function") { toast("数据层版本偏旧，请强刷页面重试", false); return; }
    /* 20261121D：保存时始终带上内置榜单列 —— 配置里一旦漏了它，前台就会少一列 */
    ensureRankInList();
    if (!state.list.length) { toast("至少要留一列", false); return; }
    try {
      await SB.setCompareSources({
        list: state.list,
        showEmpty: !!state.showEmpty,
        perRow: Number(state.perRow) || 0,
      });
      if (typeof SB.setCompareChannels === "function") {
        try { await SB.setCompareChannels(state.channels); }
        catch (e) { toast("对比列已保存，但渠道清单没存上：" + ((e && e.message) || "未知错误"), false); return; }
      }
      state.dirty = false;
      toast("已保存，前台刷新即生效");
      say("已保存 " + new Date().toLocaleTimeString());
    } catch (e) {
      toast("保存失败：" + ((e && e.message) || "未知错误"), false);
    }
  }

  /* 自定义新增渠道：填一个名字就进清单，并直接加成一列 */
  function addPoolChannel(name) {
    var raw = String(name == null ? "" : name).trim().slice(0, 24);
    if (!raw) { toast("渠道名不能为空", false); return false; }
    var k = normCh(raw);
    var exist = state.channels.filter(function (c) { return normCh(c) === k; })[0];
    if (exist) {
      /* 已经在清单里：不重复加，但把它勾回对比列（用户可能只是想让这一列出图） */
      var key0 = keyOf(exist);
      if (!state.list.some(function (x) { return x.key === key0; })) {
        state.list.push({ key: key0, label: chShort(exist), type: "channel", channel: exist });
        state.dirty = true;
        render();
        toast("「" + chShort(exist) + "」已在渠道清单里，已勾回对比列（记得保存）");
        return false;
      }
      toast("「" + chShort(exist) + "」已经在渠道清单里了", false);
      return false;
    }
    state.channels.push(raw);
    exist = raw;
    var key = keyOf(exist);
    if (!state.list.some(function (x) { return x.key === key; })) {
      state.list.push({ key: key, label: chShort(exist), type: "channel", channel: exist });
    }
    state.dirty = true;
    render();
    toast("已加入渠道清单与对比列，记得点「保存配置」");
    return true;
  }

  async function resetDefault() {
    var SB = SBx();
    state.list = [mkRank()].concat(state.channels.map(mkChannel).filter(Boolean));
    state.showEmpty = true;
    state.perRow = 0;
    render();
    try {
      if (SB && typeof SB.setCompareSources === "function") {
        await SB.setCompareSources({ list: state.list, showEmpty: true, perRow: 0 });
        toast("已恢复默认：清单里的渠道全部参与对比");
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
    if (se) se.onchange = function () { state.showEmpty = !!se.checked; state.dirty = true; };
    var pr = $("#cmpa-per-row");
    if (pr) pr.onchange = function () { state.perRow = Number(pr.value) || 0; state.dirty = true; };
    var open = $("#cmpa-open-front");
    if (open) open.onclick = function () { window.open("compare.html", "_blank"); };
    /* ④ 其他渠道：合并 / 拆分 —— 独立保存按钮，不影响 ①②③ 的「保存配置」 */
    var mvSave = $("#mrgv-save");
    if (mvSave) mvSave.onclick = saveMergeView;
    ["#mrgv-merge", "#mrgv-split", "#mrgv-allow"].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      el.onchange = function () {
        var m = $("#mrgv-msg");
        if (m) m.textContent = "改动未保存";
      };
    });
    /* 自定义新增渠道：回车或点按钮都能加 */
    var addBtn = $("#cmpa-add-btn");
    var addInput = $("#cmpa-add-input");
    function doAdd() {
      if (!addInput) return;
      if (addPoolChannel(addInput.value)) addInput.value = "";
    }
    if (addBtn) addBtn.onclick = doAdd;
    if (addInput) {
      addInput.onkeydown = function (e) {
        if (e && (e.key === "Enter" || e.keyCode === 13)) { e.preventDefault(); doAdd(); }
      };
    }
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.CompareAdmin = { reload: load, state: state, addChannel: addPoolChannel };
})();
