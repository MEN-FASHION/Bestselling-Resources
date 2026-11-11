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

  function renderGrid(k) {
    var st = state[k];
    var box = el(k, "grid");
    var empty = el(k, "empty");
    if (!box) return;
    box.innerHTML = "";
    var list = filteredItems(k);
    if (!list.length) {
      if (empty) {
        empty.classList.remove("hidden");
        empty.textContent = st.items.length ? "当前筛选下没有图片" : "暂无图片，先在上面传一批";
      }
      return;
    }
    if (empty) empty.classList.add("hidden");
    list.forEach(function (r) {
      var t = st.tagMap[r.image_url] || {};
      var filled = DIMS.filter(function (d) { return (t[d.key] || []).length; }).length;
      var card = document.createElement("div");
      card.className = "gcard";
      card.innerHTML =
        '<div class="gthumb"><img loading="lazy" src="' + esc(r.image_url) + '" alt="">' +
        (r.month ? '<span class="mv-season-badge">' + esc(r.month) + "</span>" : "") +
        "</div>" +
        '<div class="gmeta">' +
        '<div class="gname">' + esc(r.category || "未分类") + "</div>" +
        '<div class="gsub">' + esc(r.channel || st.zone.channel) +
        '<span class="mv-prog' + (filled >= DIMS.length ? " is-done" : "") + '">' + filled + "/" + DIMS.length + "</span></div>" +
        "</div>";
      card.onclick = function () { openTag(k, r.id); };
      box.appendChild(card);
    });
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
    if (!window.confirm("删除这张图？删掉后前台立即不再展示（打标记录保留）。")) return;
    try {
      await SB.deleteRankChannelItem(item.id);
      closeTag(k);
      await loadAll(k);
      toast("已删除");
    } catch (e) {
      toast("删除失败：" + ((e && e.message) || "未知错误"), false);
    }
  }

  /* ---------- 导出打标表（复用榜单那套列） ---------- */
  async function doExport(k) {
    var st = state[k];
    var RE = window.RankExport;
    if (!RE || typeof XLSX === "undefined") { toast("导出模块未加载，请强刷页面", false); return; }
    if (!st.items.length) { toast("当前没有图片", false); return; }
    try {
      say(k, "导出中…");
      var detail = st.items.map(function (r) {
        return { image_url: r.image_url, category: r.category || "" };
      });
      var pack = RE.buildBook(detail, st.tagMap, {});
      XLSX.writeFile(pack.wb, st.zone.label + "-打标表-" +
        new Date().toISOString().slice(0, 10).replace(/-/g, "") + ".xlsx");
      say(k, "已导出 " + st.items.length + " 张");
    } catch (e) {
      say(k, "导出失败：" + ((e && e.message) || "未知错误"));
    }
  }

  /* ---------- 初始化 ---------- */
  function mount(z) {
    var card = document.getElementById(z.key + "-card");
    if (!card) return;
    var k = z.key;
    state[k] = {
      zone: z, items: [], tagMap: {}, pending: [], curCat: "", curMonth: "", curId: null, ready: false,
    };
    card.innerHTML = panelHtml(z);
    /* 打标弹窗放到 body，避免被面板隐藏态带走 */
    var holder = document.createElement("div");
    holder.innerHTML = modalHtml(z);
    document.body.appendChild(holder.firstChild);

    fillCatSelects(k);
    bindUpload(k);
    renderPending(k);

    var ref = el(k, "refresh");
    if (ref) ref.onclick = function () { loadAll(k); };
    var fm = el(k, "filter-month");
    if (fm) fm.onchange = function () { state[k].curMonth = fm.value || ""; renderAll(k); };
    var ex = el(k, "export");
    if (ex) ex.onclick = function () { doExport(k); };
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
      if (document.getElementById(z.key + "-card")) mount(z);
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
