/* ============================================================
 * TREND BANK · 后台「版本恢复」（超级管理员）
 * 用途：把站内核心数据表整体存成一份快照，误删/误改后可一键回滚。
 * 口径（与 tools/setup_backup.sql 一致）：
 *   - 快照存的是「数据库记录」，**不含图片文件本身**（文件在对象存储上，本功能不复制）
 *   - 恢复时服务端会**先自动备份当前状态**（列表里标记为「恢复前自动备份」），
 *     整个恢复在一个事务里执行：任何一步失败全部回滚，原数据不受影响
 *   - 最多保留最近 10 份快照（超出由服务端清理最早的）
 * 安全：生成 / 恢复 / 删除都走超管专用函数；页面对非超管直接拒绝并提示。
 * ============================================================ */
(function () {

  var BKP_MAX = 10;         /* 快照保留上限（与服务端一致，仅用于提示） */
  var BKP_BUSY = false;     /* 正在执行耗时动作（生成 / 恢复）时禁止重复点击 */
  var BKP_LIST = [];        /* 最近一次快照列表 */

  function el(id) { return document.getElementById(id); }
  function safe(s) { return (typeof escHtml === "function") ? escHtml(s == null ? "" : String(s)) : String(s == null ? "" : s); }

  function bytes(n) {
    var v = Number(n || 0);
    if (!isFinite(v) || v <= 0) return "—";
    if (v < 1024) return v + " B";
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + " KB";
    return (v / 1024 / 1024).toFixed(2) + " MB";
  }

  function when(t) {
    if (!t) return "—";
    var d = new Date(t);
    if (isNaN(d.getTime())) return "—";
    var p = function (x) { return (x < 10 ? "0" : "") + x; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function status(text, ok) {
    var s = el("bkp-status");
    if (!s) return;
    s.textContent = text || "";
    s.style.color = ok === false ? "var(--danger, #c25e5a)" : "";
  }

  /* 快照内各表条数摘要：让用户点恢复前看清「这份快照里有什么」 */
  function countsText(counts) {
    var c = counts || {};
    var keys = Object.keys(c);
    if (!keys.length) return "—";
    return keys.map(function (k) { return TABLE_LABEL[k] || k; }).join(" · ") + "（共 " + keys.length + " 张表）";
  }

  var TABLE_LABEL = {
    categories: "类目",
    tag_defs: "标签定义",
    site_settings: "站点设置",
    zone_permissions: "类目授权",
    rank_sites: "榜单站点",
    rank_batches: "榜单批次",
    marketing_nodes: "营销节点",
    images: "图片记录",
    announcements: "公告",
    trends: "趋势专区",
    rank_items: "榜单条目",
    marketing_articles: "营销文章",
    recruit_categories: "招品回品类目",
    bestseller_categories: "BESTSELLER 类目",
  };

  function isSuperNow() {
    try {
      if (typeof isSuper === "function") return !!isSuper();
      return typeof currentRole !== "undefined" && currentRole === "super_admin";
    } catch (e) { return false; }
  }

  function renderList() {
    var box = el("bkp-list");
    if (!box) return;
    if (!BKP_LIST.length) {
      box.innerHTML = '<div class="hint">还没有任何快照。建议在「改榜单 / 批量删图 / 调权限」这类高危操作之前先点一次「立即生成快照」。</div>';
      return;
    }
    var html = '<table class="ins-tbl"><thead><tr>' +
      "<th>生成时间</th><th>备注</th><th>类型</th><th>生成人</th><th>内容</th><th>体积</th><th>操作</th>" +
      "</tr></thead><tbody>";
    BKP_LIST.forEach(function (b) {
      var isAuto = (b.kind === "auto");
      html += "<tr>" +
        "<td>" + safe(when(b.created_at)) + "</td>" +
        '<td class="bkp-note-cell">' + (b.note ? safe(b.note) : '<span class="hint">无备注</span>') + "</td>" +
        '<td>' + (isAuto ? '<span class="bkp-tag bkp-tag-auto">恢复前自动备份</span>' : '<span class="bkp-tag">手动</span>') + "</td>" +
        "<td>" + safe(b.email || "—") + "</td>" +
        '<td class="hint">' + safe(countsText(b.counts)) + "</td>" +
        "<td>" + safe(bytes(b.bytes)) + "</td>" +
        "<td>" +
        '<button class="btn-primary small" type="button" data-bkp="restore" data-id="' + safe(b.id) + '">恢复到此</button>' +
        '<button class="btn-ghost small" type="button" data-bkp="del" data-id="' + safe(b.id) + '" style="margin-left:6px;color:var(--danger,#c25e5a)">删除</button>' +
        "</td></tr>";
    });
    html += "</tbody></table>";
    html += '<div class="hint" style="margin-top:6px">共 ' + BKP_LIST.length + " 份（最多保留 " + BKP_MAX + " 份，超出自动清理最早的）。</div>";
    box.innerHTML = html;
  }

  async function loadBackupList() {
    var box = el("bkp-list");
    if (!box) return;
    if (!isSuperNow()) {
      box.innerHTML = '<div class="hint">版本恢复仅超级管理员可用。</div>';
      return;
    }
    box.innerHTML = '<span class="hint">读取中…</span>';
    try {
      BKP_LIST = await SB.backupList();
      renderList();
      status("已读取 " + BKP_LIST.length + " 份快照", true);
    } catch (e) {
      box.innerHTML = '<div class="hint">' + safe(bkpErr(e)) + "</div>";
      status("读取失败", false);
    }
  }

  /* 顶部几条口径提示（进面板即显示，避免误以为"连图片一起备份了"） */
  function loadBackupPolicy() {
    var p = el("bkp-policy");
    if (!p) return;
    var max = BKP_MAX;
    try { if (SB && SB.backupPolicy) max = SB.backupPolicy().max || BKP_MAX; } catch (e) {}
    p.textContent = "最多保留 " + max + " 份快照；恢复前会自动备份当前状态。";
  }

  function bkpErr(e) {
    var d = (e && e.diag) || "other";
    if (d === "missing_function") return "数据库里还没有快照接口：请把仓库里 tools/setup_backup.sql 整段执行一次。";
    if (d === "forbidden") return "当前账号没有快照接口的执行授权：请重跑 tools/setup_backup.sql，并确认当前账号是超级管理员。";
    if (d === "sql_exec") return "快照接口内部报错（与账号权限无关）：请把 tools/setup_backup.sql 整段重新执行一次。";
    if (d === "not_authenticated") return "登录状态已失效：请重新登录后再试。";
    if (d === "blocked") return "请求没能抵达数据库（浏览器/网络层被拦）：请强刷页面（Ctrl+F5）后重试。";
    return "操作失败，请稍后重试。";
  }

  async function createBackup() {
    if (BKP_BUSY) return;
    BKP_BUSY = true;
    var btn = el("bkp-create");
    if (btn) btn.disabled = true;
    status("正在生成快照…（记录较多时需要几秒，请不要关闭页面）");
    var noteEl = el("bkp-note-input");
    var note = noteEl ? String(noteEl.value || "").trim() : "";
    try {
      var r = await SB.backupCreate(note);
      var n = 0;
      try { n = Object.keys((r && r.counts) || {}).length; } catch (e) {}
      status("快照已生成", true);
      if (noteEl) noteEl.value = "";
      if (typeof sbToast === "function") sbToast("快照已生成" + (n ? "（含 " + n + " 张表）" : ""));
      try { if (window.AdminLog) AdminLog.log("backup_create", note || "手动快照", {}); } catch (e) {}
      await loadBackupList();
    } catch (e) {
      status("生成失败", false);
      if (typeof sbToast === "function") sbToast(bkpErr(e), false);
    } finally {
      BKP_BUSY = false;
      if (btn) btn.disabled = false;
    }
  }

  function confirmRestore(b) {
    var whenTxt = when(b && b.created_at);
    var auto = (b && b.kind === "auto") ? "（这是恢复前自动备份）" : "";
    var msg = "确定恢复到这份快照吗？\n\n生成时间：" + whenTxt + auto +
      "\n备注：" + ((b && b.note) || "无") +
      "\n\n· 当前状态会先被自动备份一份（可再退回）\n" +
      "· 恢复会把「图片记录 / 类目 / 标签 / 榜单 / 公告 / 权限配置」等数据整体回滚到该时间点\n" +
      "· 快照不含图片文件本身，若文件已被物理删除，恢复只能找回记录、找不回文件\n" +
      "· 恢复期间请不要关闭页面";
    return window.confirm(msg);
  }

  async function doRestore(id) {
    if (BKP_BUSY) return;
    var b = null;
    for (var i = 0; i < BKP_LIST.length; i++) if (String(BKP_LIST[i].id) === String(id)) b = BKP_LIST[i];
    if (!confirmRestore(b)) return;
    BKP_BUSY = true;
    var btn = el("bkp-create");
    if (btn) btn.disabled = true;
    status("正在恢复…请不要关闭页面");
    try {
      var r = await SB.backupRestore(id);
      var failed = (r && r.failed) ? r.failed : null;
      if (failed && failed.length) {
        status("恢复未完成：有 " + failed.length + " 张表未能写回，已整体回滚，原数据未变。", false);
        if (typeof sbToast === "function") sbToast("恢复失败，已整体回滚（原数据未变）", false);
      } else {
        status("恢复完成", true);
        if (typeof sbToast === "function") sbToast("已恢复到该快照时间点");
      }
      try { if (window.AdminLog) AdminLog.log("backup_restore", String(id), {}); } catch (e) {}
      await loadBackupList();
    } catch (e) {
      status("恢复失败：" + bkpErr(e), false);
      if (typeof sbToast === "function") sbToast(bkpErr(e), false);
    } finally {
      BKP_BUSY = false;
      if (btn) btn.disabled = false;
    }
  }

  async function delBackup(id) {
    if (BKP_BUSY) return;
    if (!window.confirm("删除这份快照？删除后无法用它恢复（不影响站点数据）。")) return;
    try {
      await SB.backupDelete(id);
      if (typeof sbToast === "function") sbToast("已删除该快照");
      try { if (window.AdminLog) AdminLog.log("backup_delete", String(id), {}); } catch (e) {}
      await loadBackupList();
    } catch (e) {
      if (typeof sbToast === "function") sbToast(bkpErr(e), false);
    }
  }

  /* 列表内按钮用事件委托：就地刷新、不重建整页（避免滚动位置跳动） */
  function bindBackup() {
    var card = el("backup-card");
    if (!card || card.__bkpBound) return;
    card.__bkpBound = true;

    var c = el("bkp-create");
    if (c) c.onclick = createBackup;
    var rf = el("bkp-refresh");
    if (rf) rf.onclick = function () { loadBackupList(); };

    var box = el("bkp-list");
    if (box) {
      box.addEventListener("click", function (e) {
        var t = e.target;
        var btn = (t && t.closest) ? t.closest("button[data-bkp]") : null;
        if (!btn) return;
        var act = btn.getAttribute("data-bkp");
        var id = btn.getAttribute("data-id");
        if (act === "restore") doRestore(id);
        else if (act === "del") delBackup(id);
      });
    }
  }

  Object.assign(window, { loadBackupList: loadBackupList, loadBackupPolicy: loadBackupPolicy, bindBackup: bindBackup });
})();