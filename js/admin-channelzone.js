/* ============================================================================
 * admin-channelzone.js —— 渠道图片专区后台（Pinterest / SHEIN）
 * ----------------------------------------------------------------------------
 * 定位：与「趋势上升榜」同构的纯图片专区后台作业台。
 *   这两个专区没有榜单指标（无环比、无国家、无排名），进来只有一件事：
 *   传图 → 打标 → 前台按「类目 + 月份」展示。
 *
 * 数据存放不另建表（与「其他渠道传图」同一套，后台两者互通）：
 *   图片本体 → 渠道图清单（channel = Pinterest / SHEIN，period_type = month）
 *   打标结果 → rank_image_tags（按图片地址，与榜单 / 趋势动向共用同一张表）
 *
 * 一个文件驱动两个面板：面板里带 data-cz="pinterest" / data-cz="shein"，
 * 所有 DOM id 都以 cz-<key>- 开头，互不干扰。
 * ==========================================================================*/
(function () {
  "use strict";

  var ZONES = [
    { key: "pinterest", label: "Pinterest 专区", channel: "Pinterest" },
    { key: "shein", label: "SHEIN 专区", channel: "SHEIN" },
  ];

  var DIMS = [
    { key: "style_tags", label: "风格", enum: "风格" },
    { key: "visual_tags", label: "视觉", enum: "视觉" },
    { key: "pattern_tags", label: "图案类型", enum: "图案类型" },
    { key: "element_tags", label: "图案元素", enum: "图案元素" },
    { key: "struct_tags", label: "结构部件", enum: "结构部件" },
    { key: "fabric_tags", label: "面料", enum: "面料" },
    { key: "craft_tags", label: "二次工艺", enum: "二次工艺" },
    { key: "shoot_tags", label: "拍摄方式", enum: "拍摄方式" },
    { key: "skin_tags", label: "模特", enum: "模特" },
    { key: "fit_tags", label: "版型", enum: "版型" },
    { key: "culture_tags", label: "文化背景", enum: "文化背景" },
    { key: "psych_tags", label: "消费心理", enum: "消费心理" },
    { key: "festival_tags", label: "节日（可选）", enum: "节日" },
  ];

  var state = {};   // key -> 面板状态

  function SBx() { return window.SB || null; }
  function $(sel) { return document.querySelector(sel); }
  function id(k, s) { return "cz-" + k + "-" + s; }
  function el(k, s) { return document.getElementById(id(k, s)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(t, ok) {
    if (window.sbToast) return window.sbToast(t, ok !== false);
    var m = document.querySelector(".cz-msg");
    if (m) m.textContent = t || "";
  }
  function say(k, t) { var n = el(k, "msg"); if (n) n.textContent = t || ""; }

  function normMonth(v) {
    var SB = SBx();
    if (SB && typeof SB._normMonth === "function") {
      try { return SB._normMonth(v); } catch (e) { /* 本地兜底 */ }
    }
    var s = String(v || "").trim();
    var m = s.match(/(20\d{2})\D{0,2}(\d{1,2})/);
    if (!m) return s;
    return m[1] + "-" + String(parseInt(m[2], 10)).padStart(2, "0");
  }
  function sameChannel(v, ch) {
    var a = String(v || "").replace(/[\s_\-]/g, "").toLowerCase();
    var b = String(ch || "").replace(/[\s_\-]/g, "").toLowerCase();
    return !!a && !!b && a === b;
  }
  function curMonthNow() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  /* ---------- 打标枚举（与榜单 / 趋势动向同一份） ---------- */
  function enumValues(d) {
    var E = window.APP_ENUM || {};
    if (d.key === "visual_tags") {
      return [].concat(E["视觉-背景"] || [], E["视觉-画面构成"] || [], E["视觉-呈现主体"] || []);
    }
    if (d.key === "fit_tags") {
      var FIT = (window.APP_ENUM_GROUPS && window.APP_ENUM_GROUPS.fit) || [];
      var all = [];
      FIT.forEach(function (g) { (g.values || []).forEach(function (v) { all.push(v); }); });
      return all;
    }
    return E[d.enum] || [];
  }
  function fitExpand() {
    var FIT = (window.APP_ENUM_GROUPS && window.APP_ENUM_GROUPS.fit) || [];
    var out = [];
    FIT.forEach(function (g) {
      (g.values || []).forEach(function (v) { out.push((g.label || "") + "·" + v); });
    });
    return out;
  }

  /* ---------- 面板骨架（注入到 admin.html 的空面板里） ---------- */
  function panelHtml(z) {
    var k = z.key;
    return '' +
      '<h2>' + esc(z.label) + ' <span class="hint-inline">（只传图 + 打标，无榜单数据；上传后前台按「类目 + 月份」展示）</span></h2>' +
      '<div class="movement-upload">' +
        '<div class="mv-up-row">' +
          '<label class="mv-field"><span>上传类目</span><select id="' + id(k, "upload-cat") + '" class="input"></select></label>' +
          '<label class="mv-field"><span>月份</span><input id="' + id(k, "upload-month") + '" class="input" type="month"></label>' +
          '<button id="' + id(k, "pick") + '" class="btn-primary" type="button">选择图片（可多选）</button>' +
          '<button id="' + id(k, "upload") + '" class="btn-primary" type="button" disabled>上传（0）</button>' +
          '<button id="' + id(k, "clear") + '" class="btn-ghost" type="button">清空待传</button>' +
          '<span id="' + id(k, "tip") + '" class="hint-inline"></span>' +
        '</div>' +
        '<div id="' + id(k, "drop") + '" class="mv-drop">把图片拖到这里，或点「选择图片」。这里只收图片，不需要表格与指标数据。</div>' +
        '<div id="' + id(k, "pending") + '" class="mv-pending"></div>' +
        '<div class="progress hidden" id="' + id(k, "prog") + '"><div class="progress-bar" id="' + id(k, "progbar") + '"></div></div>' +
        '<input type="file" id="' + id(k, "file") + '" accept="image/*" multiple hidden>' +
      '</div>' +

      '<div class="mv-toolbar">' +
        '<span id="' + id(k, "count") + '" class="hint-inline">加载中…</span>' +
        '<select id="' + id(k, "filter-cat") + '" class="input"><option value="">全部类目</option></select>' +
        '<select id="' + id(k, "filter-month") + '" class="input"><option value="">全部月份</option></select>' +
        '<button id="' + id(k, "refresh") + '" class="btn-ghost" type="button">刷新</button>' +
        '<button id="' + id(k, "export") + '" class="btn-ghost" type="button">导出打标表</button>' +
        '<button id="' + id(k, "import") + '" class="btn-ghost" type="button">导入打标表</button>' +
        '<input type="file" id="' + id(k, "imp-file") + '" accept=".xlsx,.xls" hidden>' +
        '<button id="' + id(k, "sel-all") + '" class="btn-ghost" type="button">全选本屏</button>' +
        '<button id="' + id(k, "sel-none") + '" class="btn-ghost" type="button" disabled>取消选择</button>' +
        '<button id="' + id(k, "batch-edit") + '" class="btn-primary" type="button" disabled>批量编辑</button>' +
        '<button id="' + id(k, "del-sel") + '" class="btn-danger" type="button" disabled>删除选中（0）</button>' +
        '<span id="' + id(k, "msg") + '" class="hint-inline cz-msg"></span>' +
      '</div>' +

      '<div class="manage-layout gallery-layout">' +
        '<aside class="sidebar"><div class="side-head">图片类目</div><nav id="' + id(k, "menu") + '" class="cat-menu"></nav></aside>' +
        '<main class="grid-wrap">' +
          '<p id="' + id(k, "empty") + '" class="empty-tip hidden">暂无图片</p>' +
          '<div id="' + id(k, "grid") + '" class="grid"></div>' +
        '</main>' +
      '</div>';
  }

  function modalHtml(z) {
    var k = z.key;
    return '' +
      '<div id="' + id(k, "tag-modal") + '" class="modal-mask hidden">' +
        '<div class="modal mv-tag-modal">' +
          '<div class="mv-tag-head">' +
            '<h3>' + esc(z.label) + ' · 打标</h3>' +
            '<span id="' + id(k, "tag-title") + '" class="hint-inline"></span>' +
          '</div>' +
          '<div class="mv-tag-body">' +
            '<div class="mv-tag-img"><img id="' + id(k, "tag-img") + '" alt=""></div>' +
            '<div class="mv-tag-dims" id="' + id(k, "tag-dims") + '"></div>' +
          '</div>' +
          '<div class="mtag-actions">' +
            '<label class="mv-field" style="margin-right:8px;"><span>类目</span><select id="' + id(k, "tag-cat") + '" class="input"></select></label>' +
            '<label class="mv-field" style="margin-right:8px;"><span>月份</span><input id="' + id(k, "tag-month") + '" class="input" type="month"></label>' +
            '<button id="' + id(k, "tag-save") + '" class="btn-primary" type="button">保存打标</button>' +
            '<button id="' + id(k, "tag-del") + '" class="btn-danger" type="button">删除这张图</button>' +
            '<button id="' + id(k, "tag-close") + '" class="btn-ghost" type="button">关闭</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function batchModalHtml(z) {
    var k = z.key;
    return '' +
      '<div id="' + id(k, "batch-modal") + '" class="modal-mask hidden">' +
        '<div class="modal cz-batch-modal">' +
          '<div class="mv-tag-head">' +
            '<h3>' + esc(z.label) + ' · 批量编辑</h3>' +
            '<span id="' + id(k, "batch-title") + '" class="hint-inline"></span>' +
          '</div>' +
          '<div class="cz-batch-body">' +
            '<p class="cz-batch-tip">只改填写的字段，留空的一律不动。别处的图不会被改到。</p>' +
            '<label class="cz-batch-field"><span>月份（前台展示的上传期次）</span>' +
              '<input id="' + id(k, "batch-month") + '" class="input" type="month">' +
            '</label>' +
            '<label class="cz-batch-field"><span>上传日期（记录日期，可留空）</span>' +
              '<input id="' + id(k, "batch-date") + '" class="input" type="date">' +
            '</label>' +
            '<label class="cz-batch-field"><span>类目</span>' +
              '<input id="' + id(k, "batch-cat") + '" class="input" list="' + id(k, "batch-cat-list") + '" placeholder="留空不改，也可直接输入新类目">' +
              '<datalist id="' + id(k, "batch-cat-list") + '"></datalist>' +
            '</label>' +
            '<label class="cz-batch-field"><span>渠道名</span>' +
              '<input id="' + id(k, "batch-ch") + '" class="input" placeholder="留空不改，例如 Pinterest / SHEIN">' +
            '</label>' +
          '</div>' +
          '<div class="mtag-actions">' +
            '<button id="' + id(k, "batch-apply") + '" class="btn-primary" type="button">应用到选中的图</button>' +
            '<button id="' + id(k, "batch-cancel") + '" class="btn-ghost" type="button">取消</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function exportModalHtml(z) {
    var k = z.key;
    return '' +
      '<div id="' + id(k, "exp-modal") + '" class="modal-mask hidden">' +
        '<div class="modal cz-exp-modal">' +
          '<div class="mv-tag-head">' +
            '<h3>' + esc(z.label) + ' · 导出打标表</h3>' +
            '<span id="' + id(k, "exp-title") + '" class="hint-inline"></span>' +
          '</div>' +
          '<div class="cz-batch-body">' +
            '<p class="cz-batch-tip">可选单个或多个类目；「按类目分表」时每个类目一个工作表，方便分头打标再分别导回。</p>' +
            '<div class="cz-exp-row">' +
              '<span class="cz-exp-label">类目</span>' +
              '<button id="' + id(k, "exp-all") + '" class="btn-ghost cz-mini" type="button">全选</button>' +
              '<button id="' + id(k, "exp-none") + '" class="btn-ghost cz-mini" type="button">清空</button>' +
              '<span id="' + id(k, "exp-cat-n") + '" class="hint-inline"></span>' +
            '</div>' +
            '<div id="' + id(k, "exp-cats") + '" class="cz-exp-cats"></div>' +
            '<div class="cz-exp-grid">' +
              '<label class="cz-batch-field"><span>月份</span>' +
                '<select id="' + id(k, "exp-month") + '" class="input"><option value="">全部月份</option></select></label>' +
              '<label class="cz-batch-field"><span>打标范围</span>' +
                '<select id="' + id(k, "exp-scope") + '" class="input">' +
                  '<option value="all">全部（含已打标）</option>' +
                  '<option value="todo">仅未打标</option>' +
                  '<option value="partial">仅打标不完整</option>' +
                  '<option value="done">仅已打标</option>' +
                '</select></label>' +
            '</div>' +
            '<label class="cz-row-all" style="margin-top:2px;">' +
              '<input id="' + id(k, "exp-split") + '" type="checkbox">' +
              '<span> 按类目分表（每类一个工作表）</span></label>' +
            '<p id="' + id(k, "exp-msg") + '" class="cz-batch-tip"></p>' +
          '</div>' +
          '<div class="mtag-actions">' +
            '<button id="' + id(k, "exp-run") + '" class="btn-primary" type="button">导出</button>' +
            '<button id="' + id(k, "exp-close") + '" class="btn-ghost" type="button">取消</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function importModalHtml(z) {
    var k = z.key;
    return '' +
      '<div id="' + id(k, "imp-modal") + '" class="modal-mask hidden">' +
        '<div class="modal cz-batch-modal">' +
          '<div class="mv-tag-head">' +
            '<h3>' + esc(z.label) + ' · 导入打标表</h3>' +
            '<span id="' + id(k, "imp-title") + '" class="hint-inline"></span>' +
          '</div>' +
          '<div class="cz-batch-body">' +
            '<p class="cz-batch-tip">按「图片URL」一列匹配本专区的图；表里其它列按打标维度回填。' +
              '对不上的行会被跳过，不会新增图片、也不会改到别的专区。</p>' +
            '<label class="cz-batch-field"><span>选择文件（.xlsx / .xls）</span>' +
              '<input id="' + id(k, "imp-pick") + '" class="input" type="file" accept=".xlsx,.xls"></label>' +
            '<label class="cz-batch-field"><span>写入方式</span>' +
              '<select id="' + id(k, "imp-mode") + '" class="input">' +
                '<option value="fill">只补空白（推荐，重复导入无副作用）</option>' +
                '<option value="overwrite">覆盖（表里填的维度直接替换原值）</option>' +
              '</select></label>' +
            '<label class="cz-row-all" style="margin-top:2px;">' +
              '<input id="' + id(k, "imp-clear") + '" type="checkbox"><span> 表里留空的维度也清空原标签（一般不用勾）</span></label>' +
            '<p id="' + id(k, "imp-msg") + '" class="cz-batch-tip"></p>' +
          '</div>' +
          '<div class="mtag-actions">' +
            '<button id="' + id(k, "imp-run") + '" class="btn-primary" type="button">开始导入</button>' +
            '<button id="' + id(k, "imp-close") + '" class="btn-ghost" type="button">关闭</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------- 类目候选项：站点类目表 ∪ 本专区已用过的类目 ---------- */
  function catOptions(k) {
    var out = ((window.CONFIG && window.CONFIG.CATEGORY_OPTIONS) || []).slice();
    var st = state[k];
    (st ? st.items : []).forEach(function (r) {
      var c = String(r.category || "").trim();
      if (c && out.indexOf(c) < 0) out.push(c);
    });
    return out;
  }

  function fillCatSelects(k) {
    var opts = catOptions(k);
    ["upload-cat", "filter-cat", "tag-cat"].forEach(function (s) {
      var sel = el(k, s);
      if (!sel) return;
      var keep = sel.value;
      var isFilter = s === "filter-cat";
      sel.innerHTML = "";
      sel.add(new Option(isFilter ? "全部类目" : "选择类目…", ""));
      opts.forEach(function (c) { sel.add(new Option(c, c)); });
      if (keep) sel.value = keep;
    });
    var f = el(k, "filter-cat");
    if (f && !f._bound) {
      f._bound = 1;
      f.onchange = function () { state[k].curCat = f.value || ""; renderAll(k); };
    }
  }

  function fillMonthSelects(k) {
    var st = state[k];
    var ms = {};
    st.items.forEach(function (r) { if (r.month) ms[r.month] = 1; });
    var list = Object.keys(ms).sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
    var sel = el(k, "filter-month");
    if (!sel) return;
    var keep = st.curMonth;
    sel.innerHTML = "";
    sel.add(new Option("全部月份", ""));
    list.forEach(function (m) { sel.add(new Option(m, m)); });
    sel.value = keep || "";
  }

  /* ---------- 数据 ---------- */
  async function loadAll(k) {
    var SB = SBx();
    var st = state[k];
    var z = st.zone;
    if (!SB) { say(k, "数据层未就绪，请强刷页面重试"); return; }
    if (typeof SB.listRankChannelPics !== "function") { say(k, "数据层版本偏旧，请强刷页面重试"); return; }
    say(k, "加载中…");
    try {
      var rows = await SB.listRankChannelPics({ periodType: "month" });
      st.items = (rows || []).filter(function (r) { return sameChannel(r.channel, z.channel); })
        .map(function (r) {
          var u = String(r.image_url || "");
          if (u && !/^https?:\/\//i.test(u)) {
            var base = String((window.CONFIG && window.CONFIG.WORKER_URL) || "").replace(/\/$/, "");
            if (base) u = base + "/" + u.replace(/^\/+/, "");
          }
          return {
            id: r.id || ("cp:" + r.image_url),
            image_url: u,
            category: String(r.category || "").trim(),
            month: normMonth(r.period_label || r.m || ""),
            channel: String(r.channel || "").trim(),
            uploaded: String(r.created_at || r.t || "").slice(0, 10),
          };
        })
        .filter(function (r) { return r.image_url && r.category; });
    } catch (e) {
      say(k, "读取失败：" + ((e && e.message) || "未知错误"));
      return;
    }

    var urls = st.items.map(function (r) { return r.image_url; }).filter(Boolean);
    st.tagMap = {};
    if (urls.length) {
      try {
        if (typeof SB.listMovementTags === "function") st.tagMap = (await SB.listMovementTags(urls)) || {};
        else if (typeof SB.listImageTags === "function") st.tagMap = (await SB.listImageTags(urls)) || {};
      } catch (e) { st.tagMap = {}; }
    }
    st.ready = true;
    fillCatSelects(k);
    fillMonthSelects(k);
    renderAll(k);
    say(k, "");
  }

  function filteredItems(k) {
    var st = state[k];
    return st.items.filter(function (r) {
      if (st.curCat && r.category !== st.curCat) return false;
      if (st.curMonth && r.month !== st.curMonth) return false;
      return true;
    });
  }

  function renderAll(k) {
    renderCount(k);
    renderMenu(k);
    renderGrid(k);
  }

  function renderCount(k) {
    var st = state[k];
    var node = el(k, "count");
    if (!node) return;
    var list = filteredItems(k);
    var done = list.filter(function (r) {
      var t = st.tagMap[r.image_url] || {};
      return DIMS.some(function (d) { return (t[d.key] || []).length; });
    }).length;
    node.textContent = list.length + " 张，已打标 " + done + " 张" +
      ((st.curCat || st.curMonth) ? "（筛选后）" : "");
  }

  function renderMenu(k) {
    var st = state[k];
    var nav = el(k, "menu");
    if (!nav) return;
    var scope = st.items.filter(function (r) { return !st.curMonth || r.month === st.curMonth; });
    var cnt = {};
    scope.forEach(function (r) { var c = r.category || "未分类"; cnt[c] = (cnt[c] || 0) + 1; });
    var names = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
    nav.innerHTML = "";
    var all = document.createElement("button");
    all.type = "button";
    all.className = "cat-menu-item" + (st.curCat ? "" : " active");
    all.textContent = "全部（" + scope.length + "）";
    all.onclick = function () { st.curCat = ""; syncFilterCat(k); renderAll(k); };
    nav.appendChild(all);
    names.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cat-menu-item" + (st.curCat === c ? " active" : "");
      b.textContent = c + "（" + cnt[c] + "）";
      b.onclick = function () { st.curCat = c; syncFilterCat(k); renderAll(k); };
      nav.appendChild(b);
    });
    if (!names.length) {
      var t = document.createElement("div");
      t.className = "cat-menu-tip";
      t.textContent = "暂无类目";
      nav.appendChild(t);
    }
  }

  function syncFilterCat(k) {
    var f = el(k, "filter-cat");
    if (f) f.value = state[k].curCat || "";
  }

  /* 视觉行每行几张：与 .grid 的 minmax(150px,1fr) + 8px 间距保持一致，
     另外扣掉行尾「删此行」按钮的宽度，避免算多一张把行尾挤掉。 */
  var CZ_MIN_W = 150, CZ_GAP = 8, CZ_ROWBTN = 54;
  function vcolsOf(box) {
    var w = 0;
    try { w = box ? box.clientWidth : 0; } catch (e) { w = 0; }
    if (!w) w = 900;
    var usable = Math.max(CZ_MIN_W, w - CZ_ROWBTN - CZ_GAP);
    var c = Math.floor((usable + CZ_GAP) / (CZ_MIN_W + CZ_GAP));
    return Math.max(1, c);
  }

  function renderGrid(k) {
    var st = state[k];
    var box = el(k, "grid");
    var empty = el(k, "empty");
    if (!box) return;
    box.classList.add("cz-rows");
    box.innerHTML = "";
    var list = filteredItems(k);
    if (!list.length) {
      if (empty) {
        empty.classList.remove("hidden");
        empty.textContent = st.items.length ? "当前筛选下没有图片" : "暂无图片，先在上面传一批";
      }
      syncSel(k);
      return;
    }
    if (empty) empty.classList.add("hidden");

    /* 按类目成行：一行 = 一个类目，行头带「整行删除」；筛选到某个类目时就是一行 */
    var groups = [];
    if (st.curCat) {
      groups = [{ cat: st.curCat, items: list }];
    } else {
      var byCat = {};
      list.forEach(function (r) {
        var c = r.category || "未分类";
        (byCat[c] = byCat[c] || []).push(r);
      });
      groups = Object.keys(byCat).sort(function (a, b) { return byCat[b].length - byCat[a].length; })
        .map(function (c) { return { cat: c, items: byCat[c] }; });
    }

    groups.forEach(function (g) {
      var row = document.createElement("div");
      row.className = "cz-row";
      row.setAttribute("data-cat", g.cat == null ? "" : g.cat);

      var head = document.createElement("div");
      head.className = "cz-row-head";
      var lab = document.createElement("label");
      lab.className = "cz-row-all";
      var cbx = document.createElement("input");
      cbx.type = "checkbox";
      cbx.className = "cz-row-cbx";
      cbx.onclick = function (e) {
        e.stopPropagation();
        g.items.forEach(function (r) { if (cbx.checked) st.sel[String(r.id)] = 1; else delete st.sel[String(r.id)]; });
        syncPickUI(k);
      };
      lab.appendChild(cbx);
      var lt = document.createElement("span");
      lt.textContent = " 全选";
      lab.appendChild(lt);
      head.appendChild(lab);

      var nm = document.createElement("b");
      nm.className = "cz-row-name";
      nm.textContent = g.cat;
      head.appendChild(nm);
      var cnt = document.createElement("span");
      cnt.className = "cz-row-n";
      cnt.textContent = g.items.length + " 张";
      head.appendChild(cnt);

      var delRow = document.createElement("button");
      delRow.type = "button";
      delRow.className = "cz-row-del";
      delRow.textContent = "清空该类目（" + g.items.length + "）";
      delRow.title = "删除「" + g.cat + "」这个类目下的全部图片";
      delRow.onclick = function (e) {
        e.stopPropagation();
        delMany(k, g.items.map(function (r) { return r.id; }), "「" + g.cat + "」这一行的 " + g.items.length + " 张图");
      };
      head.appendChild(delRow);
      row.appendChild(head);

      /* 【视觉行】原来是 bg 级 grid 自动换行，用户看到的「一行」和代码里的一行对不上。
         现在按实际列数切成视觉行，行尾给「删此行」，删的就是你眼下这一排的图。 */
      var cols = vcolsOf(box);
      var gbox = document.createElement("div");
      gbox.className = "cz-vrows";
      for (var vi = 0; vi < g.items.length; vi += cols) {
        var chunk = g.items.slice(vi, vi + cols);
        var vrow = document.createElement("div");
        vrow.className = "cz-vrow";
        var imgs = document.createElement("div");
        imgs.className = "cz-vrow-imgs";
        imgs.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
        chunk.forEach(function (r) { imgs.appendChild(cardOf(k, r)); });
        vrow.appendChild(imgs);
        /* 行尾按钮：删除这一排（不是整个类目、也不是勾选的那批） */
        (function (ch) {
          var vb = document.createElement("button");
          vb.type = "button";
          vb.className = "cz-vrow-del";
          vb.title = "删除这一排的 " + ch.length + " 张图";
          vb.textContent = "删此行(" + ch.length + ")";
          vb.onclick = function (e) {
            e.stopPropagation();
            delMany(k, ch.map(function (r) { return r.id; }), "这一排的 " + ch.length + " 张图");
          };
          vrow.appendChild(vb);
        })(chunk);
        gbox.appendChild(vrow);
      }
      row.appendChild(gbox);

      /* 行内已全选则勾上 */
      cbx.checked = g.items.every(function (r) { return st.sel[String(r.id)]; });
      box.appendChild(row);
    });
    syncSel(k);
  }

  function cardOf(k, r) {
    var st = state[k];
    var t = st.tagMap[r.image_url] || {};
    var filled = DIMS.filter(function (d) { return (t[d.key] || []).length; }).length;
    var card = document.createElement("div");
    card.className = "gcard cz-card" + (st.sel[String(r.id)] ? " is-sel" : "");
    card.setAttribute("data-id", String(r.id));
    card.innerHTML =
      '<label class="cz-pick" title="勾选后可批量编辑 / 批量删除">' +
        '<input type="checkbox"' + (st.sel[String(r.id)] ? " checked" : "") + "></label>" +
      '<button type="button" class="cz-card-del" title="删除这张图">×</button>' +
      '<div class="gthumb"><img loading="lazy" src="' + esc(r.image_url) + '" alt="">' +
      (r.month ? '<span class="mv-season-badge">' + esc(r.month) + "</span>" : "") +
      "</div>" +
      '<div class="gmeta">' +
      '<div class="gname">' + esc(r.category || "未分类") + "</div>" +
      '<div class="gsub">' + esc(r.channel || st.zone.channel) +
      '<span class="mv-prog' + (filled >= DIMS.length ? " is-done" : "") + '">' + filled + "/" + DIMS.length + "</span></div>" +
      (r.uploaded ? '<div class="cz-up">上传 ' + esc(r.uploaded) + "</div>" : "") +
      "</div>";

    var pick = card.querySelector(".cz-pick input");
    pick.onclick = function (e) {
      e.stopPropagation();
      if (pick.checked) st.sel[String(r.id)] = 1; else delete st.sel[String(r.id)];
      card.classList.toggle("is-sel", !!pick.checked);
      syncPickUI(k);
    };
    var del = card.querySelector(".cz-card-del");
    del.onclick = function (e) {
      e.stopPropagation();
      delMany(k, [r.id], "这张图（" + (r.category || "未分类") + (r.month ? " · " + r.month : "") + "）");
    };
    card.onclick = function () { openTag(k, r.id); };
    return card;
  }

  /* ---------- 选择状态 ---------- */
  function selIds(k) {
    var st = state[k];
    return Object.keys(st.sel || {}).filter(function (id) {
      return st.items.some(function (r) { return String(r.id) === id; });
    });
  }

  function syncSel(k) {
    var st = state[k];
    var n = selIds(k).length;
    var del = el(k, "del-sel");
    var be = el(k, "batch-edit");
    var none = el(k, "sel-none");
    if (del) { del.textContent = "删除选中（" + n + "）"; del.disabled = !n; }
    if (be) be.disabled = !n;
    if (none) none.disabled = !n;
    var cnt = el(k, "count");
    if (cnt) {
      /* 先去掉上一次追加的选中计数，再按当前数量补上（取消选择后不能留残字） */
      var base = cnt.textContent.replace(/　·　已选 \d+ 张/g, "");
      cnt.textContent = n ? base + "　·　已选 " + n + " 张" : base;
    }
  }

  /* 勾选态只做局部同步：几百张图时重建图墙会闪一下，没必要 */
  function syncPickUI(k) {
    var st = state[k];
    var box = el(k, "grid");
    if (box) {
      Array.prototype.forEach.call(box.querySelectorAll(".cz-row"), function (row) {
        var cat = row.getAttribute("data-cat") || "";
        var items = filteredItems(k).filter(function (r) { return (r.category || "未分类") === cat; });
        var all = items.length && items.every(function (r) { return st.sel[String(r.id)]; });
        var cb = row.querySelector(".cz-row-cbx");
        if (cb) cb.checked = !!all;
      });
      Array.prototype.forEach.call(box.querySelectorAll(".cz-card"), function (card) {
        var on = !!st.sel[card.getAttribute("data-id")];
        card.classList.toggle("is-sel", on);
        var p = card.querySelector(".cz-pick input");
        if (p) p.checked = on;
      });
    }
    syncSel(k);
  }

  /* ---------- 删除：单张 / 一批 / 整行 ---------- */
  async function delMany(k, ids, what) {
    var SB = SBx();
    var st = state[k];
    var list = (ids || []).map(String).filter(Boolean);
    if (!SB || !list.length) return;
    if (typeof window.guardZone === "function" && !window.guardZone(st.zone.key)) return;
    if (typeof SB.deleteRankChannelItems !== "function") {
      toast("数据层版本偏旧，请强刷页面后重试", false);
      return;
    }
    if (!(await uiConfirm("删除" + what + "？\n删掉后前台立即不再展示，打标记录会保留。"))) return;
    say(k, "删除中…");
    try {
      var res = await SB.deleteRankChannelItems(list);
      list.forEach(function (id) { delete st.sel[id]; });
      await loadAll(k);
      var msg = "已删除 " + res.ok + " 张";
      if (res.failed && res.failed.length) msg += "，失败 " + res.failed.length + " 张";
      say(k, msg);
      toast(msg, !(res.failed && res.failed.length));
    } catch (e) {
      say(k, "删除失败，请重试");
      toast("删除失败：" + ((e && e.message) || "未知错误"), false);
    }
  }

  /* ---------- 批量编辑 ---------- */
  function openBatch(k) {
    var st = state[k];
    var ids = selIds(k);
    if (!ids.length) { toast("先勾选要修改的图", false); return; }
    var t = el(k, "batch-title");
    if (t) t.textContent = "已选 " + ids.length + " 张";
    var mo = el(k, "batch-month"); if (mo) mo.value = "";
    var dt = el(k, "batch-date"); if (dt) dt.value = "";
    var ca = el(k, "batch-cat"); if (ca) ca.value = "";
    var ch = el(k, "batch-ch"); if (ch) ch.value = "";
    var dl = el(k, "batch-cat-list");
    if (dl) {
      dl.innerHTML = "";
      catOptions(k).forEach(function (c) {
        var o = document.createElement("option");
        o.value = c;
        dl.appendChild(o);
      });
    }
    var m = el(k, "batch-modal");
    if (m) m.classList.remove("hidden");
  }

  function closeBatch(k) {
    var m = el(k, "batch-modal");
    if (m) m.classList.add("hidden");
  }

  async function applyBatch(k) {
    var SB = SBx();
    var st = state[k];
    var ids = selIds(k);
    if (!SB || !ids.length) return;
    if (typeof window.guardZone === "function" && !window.guardZone(st.zone.key)) return;

    var patch = {};
    var mo = normMonth(el(k, "batch-month") ? el(k, "batch-month").value : "");
    var dt = el(k, "batch-date") ? String(el(k, "batch-date").value || "").trim() : "";
    var ca = el(k, "batch-cat") ? String(el(k, "batch-cat").value || "").trim() : "";
    var ch = el(k, "batch-ch") ? String(el(k, "batch-ch").value || "").trim() : "";
    if (mo) patch.period_label = mo;
    if (dt) patch.uploaded = dt;
    if (ca) patch.category = ca;
    if (ch) patch.channel = ch;
    if (!Object.keys(patch).length) { toast("没有填写任何要改的字段", false); return; }

    var what = [];
    if (patch.period_label) what.push("月份 → " + patch.period_label);
    if (patch.uploaded) what.push("上传日期 → " + patch.uploaded);
    if (patch.category) what.push("类目 → " + patch.category);
    if (patch.channel) what.push("渠道 → " + patch.channel);
    if (!(await uiConfirm("把这 " + ids.length + " 张图改成：\n" + what.join("\n") + "\n\n确认？"))) return;

    var btn = el(k, "batch-apply");
    if (btn) btn.disabled = true;
    say(k, "修改中…");
    try {
      var res = await SB.updateRankChannelItems(ids, patch);
      closeBatch(k);
      await loadAll(k);
      var msg = "已修改 " + res.ok + " 张";
      if (res.failed && res.failed.length) msg += "，失败 " + res.failed.length + " 张";
      say(k, msg);
      toast(msg, !(res.failed && res.failed.length));
    } catch (e) {
      say(k, "修改失败，请重试");
      toast("修改失败：" + ((e && e.message) || "未知错误"), false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ---------- 上传（只有图） ---------- */
  function addFiles(k, list) {
    var imgs = Array.prototype.slice.call(list || []).filter(function (f) { return /^image\//.test(f.type); });
    if (!imgs.length) { toast("请选择图片文件", false); return; }
    state[k].pending = state[k].pending.concat(imgs);
    renderPending(k);
  }

  function renderPending(k) {
    var st = state[k];
    var box = el(k, "pending");
    var btn = el(k, "upload");
    var tip = el(k, "tip");
    if (btn) {
      btn.disabled = !st.pending.length;
      btn.textContent = "上传（" + st.pending.length + "）";
    }
    if (tip) tip.textContent = st.pending.length ? "待传 " + st.pending.length + " 张" : "";
    if (!box) return;
    box.innerHTML = "";
    st.pending.forEach(function (f, i) {
      var d = document.createElement("div");
      d.className = "mv-pend-item";
      d.innerHTML = '<span class="mv-pend-name">' + esc(f.name) + "</span>";
      var x = document.createElement("button");
      x.type = "button";
      x.className = "mv-pend-x";
      x.textContent = "×";
      x.onclick = function (e) { e.stopPropagation(); st.pending.splice(i, 1); renderPending(k); };
      d.appendChild(x);
      box.appendChild(d);
    });
  }

  async function doUpload(k) {
    var SB = SBx();
    var st = state[k];
    if (!SB || !st.pending.length) return;
    if (typeof window.guardZone === "function" && !window.guardZone(st.zone.key)) return;

    var catSel = el(k, "upload-cat");
    var monEl = el(k, "upload-month");
    var cat = catSel ? String(catSel.value || "").trim() : "";
    var month = normMonth(monEl ? monEl.value : "");
    if (!cat) { toast("请先选择上传类目", false); return; }
    if (!month) { toast("请先选择月份", false); return; }

    /* 类目授权：超管不受限；配了具体类目的管理员只能传自己被授权的类目 */
    var isSuperFn = window.isSuper || function () { return false; };
    if (!isSuperFn() && typeof SB.myZonePermissions === "function") {
      try {
        var mine = await SB.myZonePermissions(st.zone.key);
        if (mine && mine.length && mine.indexOf(cat) < 0) {
          toast("你没有「" + cat + "」类目的上传权限", false);
          return;
        }
      } catch (e) { /* 读不到授权就按不限处理 */ }
    }

    var btn = el(k, "upload");
    var prog = el(k, "prog");
    var bar = el(k, "progbar");
    if (btn) btn.disabled = true;
    if (prog) prog.classList.remove("hidden");
    /* 传图接口收的是 { file } 记录，裸 File 会被判成「缺少图片文件」 */
    var items = st.pending.map(function (f) { return { file: f }; });
    try {
      var res = await SB.uploadRankChannelImages(items, { channel: st.zone.channel, category: cat, periodLabel: month },
        function (done, total) {
          if (bar) bar.style.width = Math.round(done / total * 100) + "%";
          say(k, "上传中 " + done + "/" + total);
        });
      st.pending = [];
      renderPending(k);
      say(k, "已上传 " + res.ok.length + " 张" + (res.failed.length ? "，失败 " + res.failed.length + " 张" : ""));
      if (res.failed.length) {
        toast("部分失败：" + res.failed.slice(0, 3).map(function (x) { return x.name; }).join("、"), false);
      }
      await loadAll(k);
    } catch (e) {
      toast("上传失败：" + ((e && e.message) || "未知错误"), false);
    } finally {
      if (prog) prog.classList.add("hidden");
      if (bar) bar.style.width = "0%";
      if (btn) btn.disabled = !st.pending.length;
    }
  }

  function bindUpload(k) {
    var st = state[k];
    var fi = el(k, "file");
    var pick = el(k, "pick");
    var up = el(k, "upload");
    var clr = el(k, "clear");
    var drop = el(k, "drop");
    if (pick && fi) pick.onclick = function () { fi.click(); };
    if (fi) fi.onchange = function () { addFiles(k, fi.files); fi.value = ""; };
    if (clr) clr.onclick = function () { st.pending = []; renderPending(k); };
    if (up) up.onclick = function () { doUpload(k); };
    if (drop) {
      ["dragenter", "dragover"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); });
      });
      drop.addEventListener("drop", function (e) {
        if (e.dataTransfer && e.dataTransfer.files) addFiles(k, e.dataTransfer.files);
      });
    }
    var mon = el(k, "upload-month");
    if (mon && !mon.value) mon.value = curMonthNow();
  }

  /* ---------- 打标面板 ---------- */
  function curItem(k) {
    var st = state[k];
    return st.items.filter(function (r) { return String(r.id) === String(st.curId); })[0] || null;
  }

  function openTag(k, rid) {
    var st = state[k];
    var item = st.items.filter(function (r) { return String(r.id) === String(rid); })[0];
    if (!item) return;
    st.curId = item.id;
    var img = el(k, "tag-img");
    if (img) img.src = item.image_url;
    var tt = el(k, "tag-title");
    if (tt) tt.textContent = (item.category || "未分类") + (item.month ? " · " + item.month : "");
    fillCatSelects(k);
    var cs = el(k, "tag-cat");
    if (cs) cs.value = item.category || "";
    var ms = el(k, "tag-month");
    if (ms) ms.value = item.month || "";
    renderDims(k, item);
    var m = el(k, "tag-modal");
    if (m) m.classList.remove("hidden");
  }

  function closeTag(k) {
    var m = el(k, "tag-modal");
    if (m) m.classList.add("hidden");
    state[k].curId = null;
  }

  function renderDims(k, item) {
    var st = state[k];
    var box = el(k, "tag-dims");
    if (!box) return;
    box.innerHTML = "";
    var t = st.tagMap[item.image_url] || {};
    DIMS.forEach(function (d) {
      var cur = (t[d.key] || []).slice();
      var wrap = document.createElement("div");
      wrap.className = "mv-dim";
      var head = document.createElement("div");
      head.className = "mv-dim-head";
      head.innerHTML = "<b>" + esc(d.label) + "</b><span>" + cur.length + " 项</span>";
      wrap.appendChild(head);

      var chosen = document.createElement("div");
      chosen.className = "mv-chosen";
      cur.forEach(function (v) {
        var tag = document.createElement("span");
        tag.className = "mv-chip";
        tag.innerHTML = esc(v) + "<i>×</i>";
        tag.querySelector("i").onclick = function () {
          var o = Object.assign({}, st.tagMap[item.image_url] || {});
          o[d.key] = cur.filter(function (x) { return x !== v; });
          st.tagMap[item.image_url] = o;
          renderDims(k, item);
        };
        chosen.appendChild(tag);
      });
      wrap.appendChild(chosen);

      var sel = document.createElement("select");
      sel.className = "input mv-dim-sel";
      sel.add(new Option("＋ 选择…", ""));
      var vals = (d.key === "fit_tags") ? fitExpand() : enumValues(d);
      vals.forEach(function (v) { sel.add(new Option(v, v)); });
      sel.onchange = function () {
        var v = sel.value;
        if (!v) return;
        var o = Object.assign({}, st.tagMap[item.image_url] || {});
        var arr = (o[d.key] || []).slice();
        if (arr.indexOf(v) < 0) arr.push(v);
        o[d.key] = arr;
        st.tagMap[item.image_url] = o;
        renderDims(k, item);
      };
      wrap.appendChild(sel);
      box.appendChild(wrap);
    });
  }

  async function saveTag(k) {
    var SB = SBx();
    var st = state[k];
    var item = curItem(k);
    if (!SB || !item) return;
    if (typeof window.guardZone === "function" && !window.guardZone(st.zone.key)) return;
    var t = st.tagMap[item.image_url] || {};
    var patch = {};
    DIMS.forEach(function (d) {
      if (t[d.key] !== undefined) patch[d.key] = (t[d.key] || []).slice();
    });

    /* 类目 / 月份就地修改（传错不用删了重传） */
    var cs = el(k, "tag-cat");
    var ms = el(k, "tag-month");
    var newCat = cs ? String(cs.value || "").trim() : "";
    var newMon = normMonth(ms ? ms.value : "");
    var meta = {};
    if (newCat && newCat !== item.category) meta.category = newCat;
    if (newMon && newMon !== item.month) meta.period_label = newMon;

    try {
      if (typeof SB.saveMovementTags === "function") await SB.saveMovementTags(item.image_url, patch);
      else if (typeof SB.saveImageTagsByUrl === "function") await SB.saveImageTagsByUrl(item.image_url, patch);
      if (Object.keys(meta).length && typeof SB.updateRankChannelItem === "function") {
        await SB.updateRankChannelItem(item.id, meta);
      }
      closeTag(k);
      await loadAll(k);
      toast("已保存");
    } catch (e) {
      toast("保存失败：" + ((e && e.message) || "未知错误"), false);
    }
  }

  async function delItem(k) {
    var SB = SBx();
    var st = state[k];
    var item = curItem(k);
    if (!SB || !item) return;
    if (typeof window.guardZone === "function" && !window.guardZone(st.zone.key)) return;
    if (!(await uiConfirm("删除这张图？删掉后前台立即不再展示（打标记录保留）。"))) return;
    try {
      await SB.deleteRankChannelItem(item.id);
      closeTag(k);
      await loadAll(k);
      toast("已删除");
    } catch (e) {
      toast("删除失败：" + ((e && e.message) || "未知错误"), false);
    }
  }

  /* ---------- 导入打标表（复用「趋势上升榜」「上新节奏」那套解析与写库） ---------- */
  function openImport(k) {
    var st = state[k];
    if (!st.items.length) { toast("本专区还没有图片，先传图再导入", false); return; }
    if (!window.RankTagImport || typeof window.RankTagImport.importFile !== "function") {
      toast("导入模块未加载，请强刷页面后重试", false);
      return;
    }
    var t = el(k, "imp-title");
    if (t) t.textContent = "本专区 " + st.items.length + " 张图";
    var f = el(k, "imp-pick"); if (f) f.value = "";
    var m = el(k, "imp-mode"); if (m) m.value = "fill";
    var c = el(k, "imp-clear"); if (c) c.checked = false;
    var g = el(k, "imp-msg"); if (g) g.textContent = "";
    var box = el(k, "imp-modal");
    if (box) box.classList.remove("hidden");
  }

  function closeImport(k) {
    var box = el(k, "imp-modal");
    if (box) box.classList.add("hidden");
  }

  async function runImport(k) {
    var st = state[k];
    if (typeof window.guardZone === "function" && !window.guardZone(st.zone.key)) return;
    var R = window.RankTagImport;
    if (!R || typeof R.importFile !== "function") {
      toast("导入模块未加载，请强刷页面后重试", false);
      return;
    }
    var fi = el(k, "imp-pick");
    var file = fi && fi.files && fi.files[0];
    if (!file) { toast("请先选择要导入的表格", false); return; }
    var mode = (el(k, "imp-mode") && el(k, "imp-mode").value) || "fill";
    var clearEmpty = !!(el(k, "imp-clear") && el(k, "imp-clear").checked);

    var btn = el(k, "imp-run");
    if (btn) { btn.disabled = true; btn.textContent = "导入中…"; }
    var msg = el(k, "imp-msg");
    if (msg) msg.textContent = "正在解析并写入，请稍等…";

    try {
      /* 只把本专区的图交给它当白名单：对不上的行跳过，不会串到别的专区 */
      var res = await R.importFile(file, {
        urls: st.items.map(function (r) { return r.image_url; }),
        mode: mode,
        clearEmpty: clearEmpty,
      });
      var line = "写入 " + (res.written || 0) + " 张";
      if (res.hit != null) line += " · 表内 " + (res.total || 0) + " 行，对上 " + res.hit + " 行";
      if (res.miss) line += " · 对不上 " + res.miss + " 行（不属于本专区，已跳过）";
      if (res.unknown && res.unknown.length) line += " · 未识别取值 " + res.unknown.length + " 处";
      if (res.missing && res.missing.length) line += " · 缺列未写：" + res.missing.join("、");
      if (res.msg) line += " · " + res.msg;
      if (msg) msg.textContent = line;
      say(k, line);
      await loadAll(k);
      toast("导入完成：写入 " + (res.written || 0) + " 张", (res.written || 0) > 0);
    } catch (e) {
      var why = (e && e.message) || "未知错误";
      if (msg) msg.textContent = "导入失败：" + why;
      toast("导入失败：" + why, false);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "开始导入"; }
    }
  }

  /* ---------- 导出打标表（复用榜单那套列，支持按类目导出） ---------- */
  function catCounts(k, month) {
    var st = state[k];
    var cnt = {};
    st.items.forEach(function (r) {
      if (month && r.month !== month) return;
      var c = r.category || "未分类";
      cnt[c] = (cnt[c] || 0) + 1;
    });
    return cnt;
  }

  function openExport(k) {
    var st = state[k];
    if (!window.RankExport) { toast("导出模块未加载，请强刷页面（若仍不行，多为脚本缓存）", false); return; }
    if (typeof XLSX === "undefined") { toast("表格组件未加载，请强刷页面", false); return; }
    if (!st.items.length) { toast("当前没有图片，先传图再导出", false); return; }

    /* 月份下拉 */
    var ms = {};
    st.items.forEach(function (r) { if (r.month) ms[r.month] = 1; });
    var months = Object.keys(ms).sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
    var sel = el(k, "exp-month");
    if (sel) {
      sel.innerHTML = "";
      sel.add(new Option("全部月份", ""));
      months.forEach(function (m) { sel.add(new Option(m, m)); });
      sel.value = st.curMonth || "";
    }

    /* 类目多选：默认勾上左侧菜单当前类目；没选就全勾 */
    var cnt = catCounts(k, st.curMonth || "");
    var names = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
    var box = el(k, "exp-cats");
    if (box) {
      box.innerHTML = "";
      if (!names.length) {
        box.innerHTML = '<div class="cz-exp-empty">当前筛选下没有图片</div>';
      }
      names.forEach(function (c) {
        var lab = document.createElement("label");
        lab.className = "cz-exp-cat";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = c;
        cb.className = "cz-exp-cbx";
        cb.checked = st.curCat ? c === st.curCat : true;
        cb.onchange = function () { syncExpCount(k); };
        var sp = document.createElement("span");
        sp.textContent = c + "（" + cnt[c] + "）";
        lab.appendChild(cb);
        lab.appendChild(sp);
        box.appendChild(lab);
      });
    }
    var sp2 = el(k, "exp-split"); if (sp2) sp2.checked = false;
    var sc = el(k, "exp-scope"); if (sc) sc.value = "all";
    var g = el(k, "exp-msg"); if (g) g.textContent = "";
    syncExpCount(k);
    var m = el(k, "exp-modal");
    if (m) m.classList.remove("hidden");
  }

  function closeExport(k) {
    var m = el(k, "exp-modal");
    if (m) m.classList.add("hidden");
  }

  function setAllExpCats(k, on) {
    var box = el(k, "exp-cats");
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll(".cz-exp-cbx"), function (c) { c.checked = !!on; });
    syncExpCount(k);
  }

  function expCheckedCats(k) {
    var box = el(k, "exp-cats");
    if (!box) return [];
    return Array.prototype.slice.call(box.querySelectorAll(".cz-exp-cbx"))
      .filter(function (c) { return c.checked; })
      .map(function (c) { return c.value; });
  }

  function syncExpCount(k) {
    var st = state[k];
    var month = (el(k, "exp-month") && el(k, "exp-month").value) || "";
    var cats = expCheckedCats(k);
    var n = st.items.filter(function (r) {
      if (month && r.month !== month) return false;
      return !cats.length ? false : cats.indexOf(r.category || "未分类") >= 0;
    }).length;
    var cn = el(k, "exp-cat-n");
    if (cn) cn.textContent = "已选 " + cats.length + " 类 · 约 " + n + " 张";
    var t = el(k, "exp-title");
    if (t) t.textContent = "本专区 " + st.items.length + " 张";
    return n;
  }

  /* 工作表名：Excel 不允许 : \ / ? * [ ]，且最长 31 字 */

  async function runExport(k) {
    var st = state[k];
    var RE = window.RankExport;
    if (!RE) { toast("导出模块未加载，请强刷页面（若仍不行，多为脚本缓存）", false); return; }
    if (typeof XLSX === "undefined") { toast("表格组件未加载，请强刷页面", false); return; }

    var month = (el(k, "exp-month") && el(k, "exp-month").value) || "";
    var scope = (el(k, "exp-scope") && el(k, "exp-scope").value) || "all";
    var split = !!(el(k, "exp-split") && el(k, "exp-split").checked);
    var cats = expCheckedCats(k);
    if (!cats.length) { toast("至少选一个类目（或点「全选」）", false); return; }

    var base = st.items.filter(function (r) {
      if (month && r.month !== month) return false;
      return cats.indexOf(r.category || "未分类") >= 0;
    });
    if (!base.length) { toast("所选类目 + 月份下没有图片", false); return; }

    var btn = el(k, "exp-run");
    if (btn) { btn.disabled = true; btn.textContent = "导出中…"; }
    var msg = el(k, "exp-msg");
    if (msg) msg.textContent = "正在生成表格…";
    try {
      var detailOf = function (rows) {
        return rows.map(function (r) {
          return { image_url: r.image_url, category: r.category || "", period_label: r.month || r.uploaded || "" };
        });
      };
      var total = 0, sheets = 0;
      var fname = st.zone.label + "-打标表-" +
        (cats.length === 1 ? String(cats[0]).replace(/[:\\\/\?\*\[\]]/g, "-") + "-" : "") +
        new Date().toISOString().slice(0, 10).replace(/-/g, "") + ".xlsx";

      if (!split) {
        /* 一次出：所选类目合并在「打标表」里（首列仍是图片URL，导回时按地址匹配） */
        var pack = RE.buildBook(detailOf(base), st.tagMap, { scope: scope });
        /* stats.picked = 真正写进表的张数；stats.total 只是这批图有多少张，
           用它判断会把「范围过滤后为空」也当成有内容，导出一张只有表头的表。 */
        total = (pack.stats && pack.stats.picked) || 0;
        if (!total) {
          if (msg) msg.textContent = "所选范围里没有符合条件的图（可能是打标范围太窄）";
          toast("所选范围里没有符合条件的图", false);
          return;
        }
        XLSX.writeFile(pack.wb, fname);
      } else {
        /* 分表：逻辑在导出模块里（buildBookSplit），改完每类可直接导回 */
        var sp = RE.buildBookSplit(detailOf(base), st.tagMap, { scope: scope });
        total = sp.total;
        sheets = sp.sheets;
        if (!total) {
          if (msg) msg.textContent = "所选范围里没有符合条件的图（可能是打标范围太窄）";
          toast("所选范围里没有符合条件的图", false);
          return;
        }
        XLSX.writeFile(sp.wb, fname);
        if (sp.emptyCats && sp.emptyCats.length) {
          say(k, "已导出 " + total + " 张；无符合条件图片未出表的类目：" +
            sp.emptyCats.slice(0, 5).join("、") + (sp.emptyCats.length > 5 ? " 等" : ""));
        }
      }

      var line = "已导出 " + total + " 张" + (split ? " · " + sheets + " 个类目分表" : "") +
        (month ? " · " + month : " · 全部月份");
      if (msg) msg.textContent = line;
      say(k, line);
      toast("已导出 " + total + " 张", true);
      closeExport(k);
    } catch (e) {
      var why = (e && e.message) || "未知错误";
      if (msg) msg.textContent = "导出失败：" + why;
      toast("导出失败，请重试", false);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "导出"; }
    }
  }


  /* ---------- 初始化 ---------- */
  function mount(z) {
    var card = document.getElementById(z.key + "-card");
    if (!card) return;
    var k = z.key;
    state[k] = {
      zone: z, items: [], tagMap: {}, pending: [], curCat: "", curMonth: "", curId: null, ready: false, sel: {},
    };
    card.innerHTML = panelHtml(z);
    /* 打标弹窗放到 body，避免被面板隐藏态带走 */
    var holder = document.createElement("div");
    holder.innerHTML = modalHtml(z) + batchModalHtml(z) + importModalHtml(z) + exportModalHtml(z);
    while (holder.firstChild) document.body.appendChild(holder.firstChild);

    fillCatSelects(k);
    bindUpload(k);
    renderPending(k);

    /* 窗口宽度变了，一行能放几张也变了：重算一次视觉行 */
    var czRsz = null;
    window.addEventListener("resize", function () {
      clearTimeout(czRsz);
      czRsz = setTimeout(function () {
        if (state[k] && state[k].ready) renderGrid(k);
      }, 300);
    });

    var ref = el(k, "refresh");
    if (ref) ref.onclick = function () { loadAll(k); };
    var fm = el(k, "filter-month");
    if (fm) fm.onchange = function () { state[k].curMonth = fm.value || ""; renderAll(k); };
    var ex = el(k, "export");
    if (ex) ex.onclick = function () { openExport(k); };
    var ea = el(k, "exp-all");
    if (ea) ea.onclick = function () { setAllExpCats(k, true); };
    var en = el(k, "exp-none");
    if (en) en.onclick = function () { setAllExpCats(k, false); };
    var em = el(k, "exp-month");
    if (em) em.onchange = function () {
      /* 换月份后类目清单与张数跟着变，避免勾着本月不存在的类目 */
      var cnt = catCounts(k, em.value || "");
      var names = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
      var box0 = el(k, "exp-cats");
      if (box0) {
        var keep = expCheckedCats(k);
        box0.innerHTML = "";
        names.forEach(function (c) {
          var lab = document.createElement("label");
          lab.className = "cz-exp-cat";
          var cb = document.createElement("input");
          cb.type = "checkbox"; cb.value = c; cb.className = "cz-exp-cbx";
          cb.checked = keep.length ? keep.indexOf(c) >= 0 : true;
          cb.onchange = function () { syncExpCount(k); };
          var sp = document.createElement("span");
          sp.textContent = c + "（" + cnt[c] + "）";
          lab.appendChild(cb); lab.appendChild(sp);
          box0.appendChild(lab);
        });
      }
      syncExpCount(k);
    };
    var er = el(k, "exp-run");
    if (er) er.onclick = function () { runExport(k); };
    var ec = el(k, "exp-close");
    if (ec) ec.onclick = function () { closeExport(k); };
    var exm = el(k, "exp-modal");
    if (exm) exm.onclick = function (e) { if (e.target === exm) closeExport(k); };
    var im = el(k, "import");
    if (im) im.onclick = function () { openImport(k); };
    var ir = el(k, "imp-run");
    if (ir) ir.onclick = function () { runImport(k); };
    var ic = el(k, "imp-close");
    if (ic) ic.onclick = function () { closeImport(k); };
    var imk = el(k, "imp-modal");
    if (imk) imk.onclick = function (e) { if (e.target === imk) closeImport(k); };
    /* 选文件后立刻给个反馈，避免以为没选上 */
    var ip = el(k, "imp-pick");
    if (ip) ip.onchange = function () {
      var g = el(k, "imp-msg");
      var f0 = ip.files && ip.files[0];
      if (g) g.textContent = f0 ? "已选择：" + f0.name : "";
    };

    /* 选择 / 批量删除 / 批量编辑 */
    var sa = el(k, "sel-all");
    if (sa) sa.onclick = function () {
      state[k].sel = {};
      filteredItems(k).forEach(function (r) { state[k].sel[String(r.id)] = 1; });
      syncPickUI(k);
    };
    var sn = el(k, "sel-none");
    if (sn) sn.onclick = function () { state[k].sel = {}; syncPickUI(k); };
    var ds = el(k, "del-sel");
    if (ds) ds.onclick = function () {
      var ids = selIds(k);
      if (!ids.length) { toast("先勾选要删除的图", false); return; }
      delMany(k, ids, "选中的 " + ids.length + " 张图");
    };
    var be = el(k, "batch-edit");
    if (be) be.onclick = function () { openBatch(k); };
    var ba = el(k, "batch-apply");
    if (ba) ba.onclick = function () { applyBatch(k); };
    var bc = el(k, "batch-cancel");
    if (bc) bc.onclick = function () { closeBatch(k); };
    var bm = el(k, "batch-modal");
    if (bm) bm.onclick = function (e) { if (e.target === bm) closeBatch(k); };

    var sv = el(k, "tag-save");
    if (sv) sv.onclick = function () { saveTag(k); };
    var dl = el(k, "tag-del");
    if (dl) dl.onclick = function () { delItem(k); };
    var cl = el(k, "tag-close");
    if (cl) cl.onclick = function () { closeTag(k); };
    var mask = el(k, "tag-modal");
    if (mask) mask.onclick = function (e) { if (e.target === mask) closeTag(k); };
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeTag(k);
    });
  }

  function init() {
    ZONES.forEach(function (z) {
      var card = document.getElementById(z.key + "-card");
      if (!card) return;
      /* 逐个专区独立初始化：某一个出错只影响它自己，不能让后面的专区整块空白 */
      try {
        mount(z);
      } catch (e) {
        card.innerHTML = '<div class="rkadm-head"><div><h3>' + esc(z.label) + '</h3>' +
          '<p class="hint" style="color:#b3382f">这个面板初始化出错，请强刷页面；若仍不行请联系管理员。</p></div></div>';
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.ChannelZoneAdmin = {
    reload: function (key) {
      var k = key || "pinterest";
      if (state[k] && state[k].zone) loadAll(k);
    },
    state: state,
  };
})();
