/* ============================================================
 * TREND BANK · 后台「用户动向」（超级管理员）
 * 三个子页：① 前台用户  ② 专区 · 菜单热度  ③ 后台管理员
 * 数据来源（全部只读，超管专用函数）：
 *   - public.visit_logs     页面浏览记录（专区 / 时长 / 地区 / 来源）+ menu 事件
 *   - public.admin_actions  后台操作日志（谁做了什么）
 *   - public.images         图片上传数（按上传人 + 时间范围）
 * 口径：
 *   - 只统计「已登录用户」（未登录访客不产生记录）
 *   - 停留时长按页面积累，切到别的标签页时暂停累加（前端心跳实现）
 *   - 时长与计数都在数据库侧聚合，页面只负责渲染（数据量大也不卡）
 * ============================================================ */
(function () {

  var INS_DAYS = 30;          /* 时间范围（天） */
  var INS_TAB = "iv-1";       /* 当前子页 */
  var INS_LOADED = false;     /* 是否已成功加载过一次 */
  var INS_LAST = null;        /* 最近一次成功返回的数据（切子页时直接复用，不重复请求） */

  /* ---------- 小工具 ---------- */
  function el(id) { return document.getElementById(id); }

  function num(n) {
    var v = Number(n || 0);
    if (!isFinite(v)) v = 0;
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* 秒 → 人话（0 秒显示 0 秒；避免出现「0 分钟」这种看着像没数据的写法） */
  function dur(sec) {
    var s = Math.max(0, Math.round(Number(sec) || 0));
    if (s < 60) return s + " 秒";
    var m = Math.floor(s / 60), h = Math.floor(m / 60);
    if (h > 0) return h + " 小时 " + (m % 60) + " 分";
    return m + " 分 " + (s % 60) + " 秒";
  }

  function when(t) {
    if (!t) return "—";
    var d = new Date(t);
    if (isNaN(d.getTime())) return "—";
    var p = function (x) { return (x < 10 ? "0" : "") + x; };
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function safe(s) { return (typeof escHtml === "function") ? escHtml(s == null ? "" : String(s)) : String(s == null ? "" : s); }

  /* 表格：heads 为表头数组，rows 为二维数组（单元格已转义或用 {html:true} 包装） */
  function tbl(heads, rows, emptyText) {
    if (!rows || !rows.length) return '<div class="hint">' + safe(emptyText || "暂无数据") + "</div>";
    var h = '<table class="ins-tbl"><thead><tr>' + heads.map(function (x) { return "<th>" + safe(x) + "</th>"; }).join("") + "</tr></thead><tbody>";
    h += rows.map(function (r) {
      return "<tr>" + r.map(function (c) {
        if (c && c.html) return "<td>" + c.html + "</td>";
        return "<td>" + safe(c) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return h + "</tbody></table>";
  }

  /* 水平条形：把「谁最多」一眼看出来（占比按最大值归一，不按总和，避免长尾全贴地） */
  function bars(rows, labelKey, valueKey, extraFn) {
    if (!rows || !rows.length) return '<div class="hint">暂无数据</div>';
    var max = 1;
    rows.forEach(function (r) { max = Math.max(max, Number(r[valueKey] || 0)); });
    return '<div class="ins-bars">' + rows.map(function (r) {
      var v = Number(r[valueKey] || 0);
      var w = Math.max(2, Math.round(v / max * 100));
      return '<div class="ins-bar-row">' +
        '<div class="ins-bar-lab" title="' + safe(r[labelKey]) + '">' + safe(r[labelKey]) + "</div>" +
        '<div class="ins-bar-track"><i style="width:' + w + '%"></i></div>' +
        '<div class="ins-bar-val">' + num(v) + (extraFn ? " " + safe(extraFn(r)) : "") + "</div>" +
        "</div>";
    }).join("") + "</div>";
  }

  /* 顶部指标卡 */
  function cards(list) {
    return list.map(function (c) {
      return '<div class="dash-card"><div class="dc-label">' + safe(c[0]) + '</div>' +
        '<div class="dc-value">' + safe(c[1]) + '</div>' +
        '<div class="dc-sub">' + safe(c[2] || "") + "</div></div>";
    }).join("");
  }

  /* 报错时的人话提示：把「哪一层断了」说清楚，别让人以为没数据 */
  function errText(e) {
    var d = (e && e.diag) || "other";
    if (d === "missing_function") return "数据库里还没有动向统计接口：请把仓库里 tools/setup_analytics.sql 整段执行一次。";
    if (d === "forbidden") return "当前账号没有动向统计接口的执行授权：请重跑 tools/setup_analytics.sql（含授权语句），并确认当前账号是超级管理员。";
    if (d === "sql_exec") {
      var ecode = String((e && e.code) || "");
      var eraw = String((e && e.detail) || "").trim();
      var tail = eraw ? "　数据库原文：" + safe(eraw.slice(0, 200)) : "";
      if (ecode === "42703") {
        var mc = eraw.match(/column\s+([\w."]+)\s+does not exist/i);
        return "统计接口用到的字段在线上表里不存在" + (mc ? "（缺的字段是 " + safe(mc[1]) + "）" : "") +
          "。线上表比脚本旧，缺字段 —— 请把 tools/setup_analytics.sql 整段重跑一次：" +
          "第 5.5 段会自动补齐缺失字段（幂等、不动数据），跑完看自检③的「缺失字段」列应为「（无，已齐备）」。与账号权限无关。" + tail;
      }
      return "统计接口内部那段查询报错（与账号权限无关）：请把 tools/setup_analytics.sql 整段重新执行一次。" + tail;
    }
    if (d === "not_authenticated") return "登录状态已失效：请重新登录后再打开。";
    if (d === "blocked") return "请求没能抵达数据库（浏览器/网络层被拦）：请强刷页面（Ctrl+F5）后重试。";
    return "读取失败：" + ((e && e.diag) || "未知原因") + "。请把这一行反馈给维护人员。";
  }

  function put(id, html) {
    var box = el(id);
    if (box) box.innerHTML = html;
  }

  /* ---------- 渲染：① 前台用户 ---------- */
  function renderFront(d) {
    var t = (d && d.totals) || {};
    put("ins-cards", cards([
      ["页面浏览", num(t.views), "时间范围内访问次数"],
      ["访客人数", num(t.users), "去重后的登录用户"],
      ["总停留时长", dur(t.sec), "所有访客累计"],
      ["人均停留", dur(t.avg_sec), "每次访问平均"],
    ]));

    var src = (d && d.sources) || [];
    put("ins-sources", bars(src.map(function (r) {
      return { k: r.referrer || "(直接进入)", n: r.n, u: r.users };
    }), "k", "n", function (r) { return "（" + num(r.u) + " 人）"; }));

    var cty = (d && d.countries) || [];
    put("ins-regions", bars(cty.map(function (r) {
      return { k: r.country || "(未知)", n: r.n, u: r.users };
    }), "k", "n", function (r) { return "（" + num(r.u) + " 人）"; }));

    var vs = (d && d.visitors) || [];
    put("ins-visitors", tbl(
      ["访客", "来几次", "看了几个专区", "总时长", "人均", "地区", "首次来源", "最近一次"],
      vs.map(function (r) {
        return [r.email || "(无邮箱)", num(r.visits), num(r.zones), dur(r.sec), dur(r.avg_sec),
          r.country || "未知", r.first_referrer || "(直接进入)", when(r.last_at)];
      }),
      "时间范围内还没有访客记录：让用户登录前台打开任一专区即可产生记录。"));

    var rc = (d && d.recent) || [];
    put("ins-recent", tbl(
      ["时间", "谁", "专区", "页面", "从哪来", "地区", "停留"],
      rc.map(function (r) {
        return [when(r.at), r.email || "—", zoneName(r.zone), r.path || "—",
          r.referrer || "(直接进入)", r.country || "未知", dur(r.sec)];
      }),
      "还没有访问明细。"));
  }

  /* ---------- 渲染：② 专区 · 菜单热度 ---------- */
  function renderHeat(d) {
    var zs = (d && d.zones) || [];
    put("ins-zones", tbl(
      ["专区", "浏览次数", "访客数", "总时长", "人均时长"],
      zs.map(function (r) {
        return [{ html: '<b>' + safe(zoneName(r.zone)) + "</b> <span class=\"hint\">" + safe(r.zone || "") + "</span>" },
          num(r.views), num(r.users), dur(r.sec), dur(r.avg_sec)];
      }),
      "时间范围内还没有专区浏览记录。"));

    var ms = (d && d.menus) || [];
    put("ins-menus", tbl(
      ["专区", "菜单", "点击次数", "点击人数"],
      ms.map(function (r) { return [zoneName(r.zone), r.menu || "(未命名)", num(r.n), num(r.users)]; }),
      "还没有菜单点击记录（用户点击前台/后台菜单后就会开始统计）。"));

    var dl = (d && d.daily) || [];
    put("ins-daily", tbl(
      ["日期", "浏览次数", "访客数", "总时长"],
      dl.slice().reverse().map(function (r) { return [r.d, num(r.views), num(r.users), dur(r.sec)]; }),
      "时间范围内没有按天的数据。"));
  }

  /* ---------- 渲染：③ 后台管理员 ---------- */
  var ACTION_LABEL = {
    image_upload: "上传图片",
    image_delete: "删除图片",
    image_update: "修改图片信息",
    tag_create: "新增标签",
    tag_delete: "删除标签",
    cat_create: "新增类目",
    cat_delete: "删除类目",
    rank_import: "导入榜单",
    rank_delete: "删除榜单数据",
    notice_publish: "发布/修改公告",
    notice_delete: "删除公告",
    perm_update: "修改权限",
    backup_create: "生成快照",
    backup_restore: "恢复快照",
    backup_delete: "删除快照",
    cat_setting: "类目设置",
    marketing_save: "营销日历保存",
  };
  function actName(a) { return ACTION_LABEL[a] || a || "(未命名操作)"; }

  function renderAdmin(d) {
    var acts = (d && d.actions) || [];
    var by = (d && d.by_user) || [];
    var ups = (d && d.uploads) || [];
    var upTotal = Number((d && d.uploads_total) || 0);
    var actTotal = Number((d && d.actions_total) || 0);
    var people = {};
    ups.forEach(function (r) { people[r.email] = 1; });
    by.forEach(function (r) { people[r.email] = 1; });

    put("ins-admin-cards", cards([
      ["上传图片", num(upTotal), "时间范围内全站新增"],
      ["操作次数", num(actTotal), "后台写操作记录"],
      ["活跃管理员", num(Object.keys(people).length), "有上传或操作的人"],
      ["类型数", num(acts.length), "不同操作类型"],
    ]));

    put("ins-uploads", tbl(
      ["上传人", "上传张数"],
      ups.map(function (r) { return [r.email || "—", num(r.n)]; }),
      "时间范围内没有图片上传记录。"));

    put("ins-admin-by-user", tbl(
      ["管理员", "操作次数", "做了哪些事", "最近一次"],
      by.map(function (r) {
        var types = r.types || {};
        var txt = Object.keys(types).map(function (k) { return actName(k) + " ×" + num(types[k]); }).join("、");
        return [r.email || "—", num(r.n), txt || "—", when(r.last_at)];
      }),
      "时间范围内还没有后台操作记录（本版起会开始记录）。"));

    put("ins-admin-recent", tbl(
      ["时间", "管理员", "操作", "对象", "详情"],
      (d && d.recent || []).map(function (r) {
        var det = r.detail || {};
        var parts = [];
        Object.keys(det).forEach(function (k) { parts.push(k + "：" + det[k]); });
        return [when(r.at), r.email || "—", actName(r.action), r.target || "—", parts.join("；") || "—"];
      }),
      "还没有操作明细。"));
  }

  /* 专区 key → 中文名（取后台专区定义；取不到就原样显示 key） */
  function zoneName(k) {
    if (!k) return "—";
    try {
      var defs = (typeof currentZoneDefs === "function") ? currentZoneDefs() : null;
      if (Array.isArray(defs)) {
        for (var i = 0; i < defs.length; i++) if (defs[i] && defs[i].key === k) return defs[i].label || k;
      }
    } catch (e) { /* 取不到就用 key */ }
    return k;
  }

  /* ---------- 子页切换 ---------- */
  function showTab(v) {
    INS_TAB = v;
    var tabs = document.querySelectorAll("#ins-tabs .ins-tab");
    Array.prototype.forEach.call(tabs, function (b) {
      b.classList.toggle("active", b.getAttribute("data-iv") === v);
    });
    var subs = document.querySelectorAll("#insight-card .ins-sub");
    Array.prototype.forEach.call(subs, function (s) {
      s.style.display = (s.getAttribute("data-iv") === v) ? "" : "none";
    });
  }

  /* ---------- 读取 ---------- */
  async function loadInsight(force) {
    var card = el("insight-card");
    if (!card) return;
    if (!(typeof isSuper === "function" ? isSuper() : (typeof currentRole !== "undefined" && currentRole === "super_admin"))) {
      put("ins-cards", '<div class="hint">用户动向仅超级管理员可见。</div>');
      return;
    }
    if (INS_LOADED && !force) { return; }   /* 同一会话重复进入不重复请求（可点刷新） */
    var st = el("ins-updated");
    if (st) st.textContent = "读取中…";
    try {
      var front = await SB.insightFront(INS_DAYS);
      var admin = await SB.insightAdmin(INS_DAYS);
      INS_LAST = { front: front || {}, admin: admin || {} };
      renderFront(INS_LAST.front);
      renderHeat(INS_LAST.front);
      renderAdmin(INS_LAST.admin);
      INS_LOADED = true;
      if (st) st.textContent = "更新于 " + when(new Date().toISOString()) + " · 近 " + INS_DAYS + " 天";
    } catch (e) {
      var msg = '<div class="hint">' + safe(errText(e)) + "</div>";
      ["ins-cards", "ins-sources", "ins-regions", "ins-visitors", "ins-recent",
        "ins-zones", "ins-menus", "ins-daily", "ins-admin-cards", "ins-uploads",
        "ins-admin-by-user", "ins-admin-recent"].forEach(function (id) { put(id, msg); });
      if (st) st.textContent = "读取失败";
    }
  }

  /* ---------- 分层自检：一次点清「配置 / 登录态 / 最小读写 / 动向接口」到底是哪一层断了 ---------- */
  /* 目的：不需要用户去翻开发者工具，页面自己给出结论（与「权限管理」无关，这是动向面板自己的入口） */
  async function probeInsight() {
    var out = el("ins-probe-out");
    if (!out) return;
    out.innerHTML = '<div class="hint">正在逐层自检…</div>';
    var r = null;
    try { r = await SB.connProbe(); } catch (e) { r = null; }
    if (!r) { out.innerHTML = '<div class="hint">自检未能完成：请强刷页面（Ctrl+F5）后再试。</div>'; return; }
    var c = r.config || {}, m = r.minimal || {}, d = r.dashboard || {};
    function layer(name, ok, extra) {
      return '<div class="ins-probe-row"><span class="ins-probe-name">' + safe(name) + "</span>" +
        '<span class="ins-probe-state ' + (ok ? "ok" : "bad") + '">' +
        (ok ? "✓ 正常" : "✗ " + safe(extra || "未通过")) + "</span></div>";
    }
    out.innerHTML =
      '<div class="ins-probe-verdict">' + safe(r.verdict || "") + "</div>" +
      layer("① 配置（地址与访问密钥）", !!c.ok, (c.problems || []).join("；")) +
      layer("② 登录态", !!r.session, "请先登录后再试") +
      layer("③ 最小读写（读一行自己的档案）", !!(m && m.ok), (m && m.code) ? "返回码 " + m.code : "请求没抵达数据库") +
      layer("④ 动向接口", !!(d && d.ok), ((d && d.diag) || "other") + ((d && d.code) ? "（" + d.code + "）" : "")) +
      '<div class="hint">四层全绿却仍然没有数据，说明只是还没有动向记录：让用户登录前台打开一次专区、后台做一次操作，再点「刷新」即可。</div>';
    try { console.info("[用户动向] 分层自检：", r); } catch (e) {}
  }

  /* ---------- 绑定 ---------- */
  function bindInsight() {
    var card = el("insight-card");
    if (!card || card.__insBound) return;
    card.__insBound = true;

    var tabs = document.querySelectorAll("#ins-tabs .ins-tab");
    Array.prototype.forEach.call(tabs, function (b) {
      b.onclick = function () { showTab(b.getAttribute("data-iv") || "iv-1"); };
    });

    var days = el("ins-days");
    if (days) {
      days.value = String(INS_DAYS);
      days.onchange = function () {
        INS_DAYS = Math.max(1, parseInt(days.value, 10) || 30);
        loadInsight(true);
      };
    }
    var rf = el("ins-refresh");
    if (rf) rf.onclick = function () { loadInsight(true); };

    var pb = el("ins-probe");
    if (pb) pb.onclick = function () { probeInsight(); };

    showTab(INS_TAB);
  }

  /* ---------- 供其它模块调用：后台操作日志 ---------- */
  /* 口径：只记「谁做了什么」，不记任何密钥/原始报错；失败静默，绝不影响业务动作 */
  var AdminLog = {
    log: function (action, target, detail) {
      try {
        if (window.SB && SB.logAdminAction) SB.logAdminAction(action, target, detail || {});
      } catch (e) { /* 日志失败不影响业务 */ }
      try { console.info("[后台操作] " + action + " " + (target || "")); } catch (e) {}
    },
  };

  Object.assign(window, { loadInsight: loadInsight, bindInsight: bindInsight, probeInsight: probeInsight, AdminLog: AdminLog });
})();