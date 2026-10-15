/* ============================================================
 * TREND BANK · 后台管理（perm）
 * 说明：本文件由原单文件 admin.js 按面板拆分而来。
 *  - 共享状态在文件顶部声明（全局作用域，跨文件可见）
 *  - 函数定义在文件内 IIFE 中，末尾通过 Object.assign(window, {...}) 暴露给其它模块
 * ============================================================ */

/* ---------- 共享状态 ---------- */
// ================= 权限管理（超管）面板 =================
let permUsers = [];

// 用户级可见专区的可选项（与全局「前台访问设置」的专区集合一致）
// 可勾选的专区（内置 7 个 + 超管在「专区管理」新增的）；随 ZONE_DEFS 动态同步
let PERM_ZONES = [
  { key: "marketing", label: "营销日历" },
  { key: "visual", label: "视觉专区" },
  { key: "trend", label: "趋势专区" },
  { key: "recruit", label: "招品回品" },
  { key: "bestseller", label: "BESTSELLER" },
  { key: "notice", label: "公告" },
  { key: "rank", label: "趋势上升榜" },
];

// 与 admin.js 的 ZONE_DEFS（含后台新增专区）保持同步
function syncPermZones() {
  const defs = window.ZONE_DEFS;
  if (Array.isArray(defs) && defs.length) PERM_ZONES = defs.map(z => ({ key: z.key, label: z.label || z.key }));
}

// 跟随全局 = 显示全局 frontend_zone_visibility 中可见的专区；供权限表「已授权专区」列直接列出
let permGlobalZones = [];

// 用户标签预设选项（超管可直接在权限表里为用户选择标签，便于区分用户类别）
const PERM_TAG_OPTIONS = ["招商", "测试", "内部", "商家"];

const NONE_TAG = "__none__";

// 仅用于"按标签筛选"里的"无标签"筛选值
let permTagFilter = "";

// ============ 用户编辑弹窗（点「编辑」就地编辑，不滚到下方编辑区） ============
let permEditUid = null;

// 当前弹窗编辑的用户 user_id
let permEditAllCats = [];

// 弹窗类目池
let permEditZones = [];

// 弹窗已勾专区
let permEditCats = [];
(function () {

function permRoleLabel(r) {
    return r === "super_admin" ? "超级管理员" : r === "admin" ? "管理员" : "访客";
  }

// 表格/筛选的标签候选集合：预设 + 当前表里已出现的所有用户标签（去重，避免覆盖自定义值后丢失）
  function permTagChoices(users) {
    const set = new Set(PERM_TAG_OPTIONS);
    (users || []).forEach(u => { if (u && u.user_tag) set.add(u.user_tag); });
    return [...set];
  }

// 生成标签下拉的 <option>
  function permTagOptionsHtml(users, current, allowNoneFilter) {
    let html = '<option value="">无标签</option>';
    permTagChoices(users).forEach(t => {
      const sel = (t === current) ? " selected" : "";
      html += '<option value="' + escAttr(t) + '"' + sel + ">" + escHtml(t) + "</option>";
    });
    return html;
  }

async function loadPermPanel() {
    try { await reloadZoneDefs(); } catch (e) { /* 忽略 */ }
    syncPermZones();
    try { permUsers = await SB.listAdminUsers(); } catch (e) { permUsers = []; }
    // 读取全局可见专区，未单独配置（manage_zones 为空）的用户则按全局展开列出可见专区
    try {
      const gz = await SB.getFrontendZoneVisibility().catch(() => ({}));
      permGlobalZones = PERM_ZONES.filter(z => gz[z.key] !== false).map(z => z.key);
    } catch (e) {
      permGlobalZones = PERM_ZONES.map(z => z.key);
    }
    // 合并每个用户最近一次登录的设备与 IP（安全设置）
    if (permUsers.length) {
      try {
        const logs = await SB.lastLoginLogs().catch(() => []);
        const logMap = {};
        (logs || []).forEach(l => { if (l && l.user_id) logMap[l.user_id] = l; });
        permUsers.forEach(u => {
          const log = logMap[u.user_id];
          u.device = (log && log.device) || "";
          u.ip = (log && log.ip) || "";
          u.last_login_at = (log && log.login_at) || "";
        });
      } catch (e) { /* 忽略登录记录读取失败，仅展示不到 */ }
    }
    renderPermTable(permUsers);
    await loadDefaultPerms();
    await renderZoneDefsBox();
  }

// 新用户默认权限设置：加载当前默认角色 + 默认可见专区到配置区
  async function loadDefaultPerms() {
    const roleSel = $("#dperm-role");
    if (!roleSel) return;
    let def = { role: "visitor", frontZones: [], manageZones: [] };
    try { def = await SB.getDefaultPerms().catch(() => ({ role: "visitor", frontZones: [], manageZones: [] })); } catch (e) {}
    roleSel.value = def.role || "visitor";
    renderDefaultZones(def.frontZones || [], "#dperm-zones");
    renderDefaultZones(def.manageZones || [], "#dperm-manage-zones");
  }

function renderDefaultZones(checked, containerId) {
    const box = $(containerId || "#dperm-zones");
    if (!box) return;
    box.innerHTML = "";
    const set = new Set((checked || []));
    PERM_ZONES.forEach(z => {
      const lab = document.createElement("label");
      lab.className = "perm-zone-item";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = z.key; cb.checked = set.has(z.key);
      lab.appendChild(cb); lab.appendChild(document.createTextNode(z.label));
      box.appendChild(lab);
    });
  }

function bindDefaultPerms() {
    const save = $("#dperm-save");
    if (!save) return;
    save.onclick = async () => {
      const role = $("#dperm-role")?.value || "visitor";
      const frontZones = [...document.querySelectorAll("#dperm-zones input:checked")].map(i => i.value);
      const manageZones = [...document.querySelectorAll("#dperm-manage-zones input:checked")].map(i => i.value);
      try {
        await SB.setDefaultPerms(role, frontZones, manageZones);
        sbToast("新用户默认权限已保存，之后新注册用户生效");
        await loadDefaultPerms();
      } catch (e) { sbToast("保存失败：" + (e.message || ""), false); }
    };
  }

// 用户权限分配表：总览所有用户角色与权限内容
  async function renderPermTable(users) {
    const body = $("#perm-table-body");
    if (!body) return;
    // 按「标签」筛选：all=全部，__none__=仅无标签，其它=仅该标签
    const shown = permTagFilter === "" ? users : (permTagFilter === NONE_TAG ? users.filter(u => !(u.user_tag && u.user_tag.trim())) : users.filter(u => u.user_tag === permTagFilter));
    if (!users.length) { body.innerHTML = '<tr><td colspan="10" class="hint">暂无用户</td></tr>'; return; }
    if (!shown.length) { body.innerHTML = '<tr><td colspan="10" class="hint">没有符合当前「按标签筛选」条件的用户</td></tr>'; return; }
    body.innerHTML = "";
    // 预取每个用户的类目授权，用于总览摘要（仅筛选后的行）
    const catCounts = {};
    await Promise.all(shown.map(async (u) => {
      try {
        const perms = await SB.listUserPermissions(u.user_id).catch(() => []);
        catCounts[u.user_id] = perms.length;
      } catch (e) { catCounts[u.user_id] = 0; }
    }));
    shown.forEach(u => {
      const tr = document.createElement("tr");
      const frontZones = Array.isArray(u.frontend_zones) ? u.frontend_zones : [];
      const manageZones = Array.isArray(u.manage_zones) ? u.manage_zones : [];
      // 「前台可见专区」= 单独配置的 frontend_zones；未配置则跟随全局，直接展开列出全局可见专区
      const frontZoneKeys = frontZones.length ? frontZones : permGlobalZones;
      const frontZoneTxt = frontZoneKeys.length ? frontZoneKeys.map(z => {
        const zz = PERM_ZONES.find(x => x.key === z);
        return zz ? zz.label : z;
      }).join("、") : "无";
      // 「后台管理专区」= 单独配置的 manage_zones；未配置则为「无后台权限」
      const manageZoneTxt = manageZones.length ? manageZones.map(z => {
        const zz = PERM_ZONES.find(x => x.key === z);
        return zz ? zz.label : z;
      }).join("、") : "无（仅前台）";
      const devTxt = u.device ? escHtml(u.device) : '<span class="hint">未记录</span>';
      const ipTxt = u.ip ? escHtml(u.ip) : '<span class="hint">未记录</span>';
      // 标签列：直接以下拉选择，切换即保存到该用户（无需点编辑区保存）
      const tagSel = '<select class="perm-tag-select" data-uid="' + u.user_id + '">' + permTagOptionsHtml(users, u.user_tag || "") + "</select>";
      // 备注列：自由文本说明（如新用户名/来源/用途）
      const noteTxt = u.user_note ? escHtml(u.user_note) : '<span class="hint">未填写</span>';
      tr.innerHTML =
        '<td class="perm-td-user">' + escHtml(u.email || "") + '</td>' +
        '<td class="perm-td-role">' + permRoleLabel(u.role) + '</td>' +
        '<td class="perm-td-tag">' + tagSel + '</td>' +
        '<td class="perm-td-note"><span class="perm-note-edit" data-uid="' + u.user_id + '" title="点击编辑备注">' + noteTxt + '</span></td>' +
        '<td class="perm-td-cats">' + (catCounts[u.user_id] ? catCounts[u.user_id] + " 个类目" : "无") + '</td>' +
        '<td class="perm-td-zones">' + escHtml(frontZoneTxt) + '</td>' +
        '<td class="perm-td-zones">' + escHtml(manageZoneTxt) + '</td>' +
        '<td class="perm-td-device">' + devTxt + '</td>' +
        '<td class="perm-td-ip">' + ipTxt + '</td>' +
        '<td class="perm-td-ops">' +
          '<button class="btn-ghost small" type="button" data-act="edit" data-uid="' + u.user_id + '">编辑</button>' +
          '<button class="btn-ghost small" type="button" data-act="del" data-uid="' + u.user_id + '" data-email="' + escAttr(u.email || "") + '" style="margin-left:6px;color:var(--danger,#c25e5a)">删除</button>' +
        '</td>';
      const editBtn = tr.querySelector('button[data-act="edit"]');
      editBtn.onclick = () => openPermEditModal(u);
      const delBtn = tr.querySelector('button[data-act="del"]');
      if (delBtn) delBtn.onclick = () => confirmDeletePermUser(u);
      const tagSelect = tr.querySelector(".perm-tag-select");
      tagSelect.onchange = async () => {
        const v = tagSelect.value;
        try {
          await SB.setUserTag(u.user_id, v);
          // 只更新数据与编辑区、筛选候选，绝不整表重建，保持滚动位置不跳
          u.user_tag = v;
          sbToast("已为用户标签设为「" + (v || "无") + "」");
          syncPermTagEditor();
          syncPermTagFilter();
        } catch (e) { sbToast("标签保存失败：" + (e.message || ""), false); }
      };
      // 备注列：点击就地编辑（点击 → 输入框 → 失焦保存，就地更新，不重建整表）
      const noteSpan = tr.querySelector(".perm-note-edit");
      if (noteSpan) noteSpan.onclick = () => {
        const td = noteSpan.parentElement;
        const oldNote = u.user_note || "";
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "input";
        inp.maxLength = 120;
        inp.value = oldNote;
        inp.placeholder = "填写说明（如新用户名/来源/用途），可留空";
        td.innerHTML = "";
        td.appendChild(inp);
        inp.focus();
        inp.select();
        let done = false;
        const commit = async (save) => {
          if (done) return;
          done = true;
          if (save) {
            const v = inp.value.trim();
            if (v !== oldNote) {
              try {
                await SB.setUserNote(u.user_id, v);
                u.user_note = v;
                sbToast("已更新备注");
              } catch (e) { sbToast("备注保存失败：" + (e.message || ""), false); }
            }
          }
          td.innerHTML = u.user_note ? escHtml(u.user_note) : '<span class="hint">未填写</span>';
          // 恢复为可点击 span，重新绑定
          const span = document.createElement("span");
          span.className = "perm-note-edit";
          span.title = "点击编辑备注";
          span.innerHTML = u.user_note ? escHtml(u.user_note) : '<span class="hint">未填写</span>';
          span.onclick = noteSpan.onclick;
          td.innerHTML = "";
          td.appendChild(span);
        };
        inp.onblur = () => commit(true);
        inp.onkeydown = (e) => {
          if (e.key === "Enter") { inp.blur(); }
          else if (e.key === "Escape") { commit(false); }
        };
      };
      body.appendChild(tr);
    });
    // 同步顶部「按标签筛选」下拉（保留用户当前选择）
    syncPermTagFilter();
  }

// 同步编辑区的标签下拉（与权限表标签一致）
  function syncPermTagEditor() {
    const tagInp = $("#perm-tag");
    if (!tagInp) return;
    const u = permUsers.find(x => x.user_id === ($("#perm-user")?.value || ""));
    tagInp.value = u ? (u.user_tag || "") : "";
  }

// 同步「按标签筛选」下拉的候选（预设 + 已出现标签），并保持当前选中
  function syncPermTagFilter() {
    const f = $("#perm-tag-filter");
    if (!f) return;
    const cur = f.value || "";
    let html = '<option value="">全部标签</option><option value="' + NONE_TAG + '">无标签</option>';
    permTagChoices(permUsers).forEach(t => {
      html += '<option value="' + escAttr(t) + '">' + escHtml(t) + "</option>";
    });
    f.innerHTML = html;
    f.value = cur;
  }

async function loadPermForUser(user) {
    if (!user) return;
    const roleSel = $("#perm-role");
    if (roleSel) roleSel.value = user.role || "visitor";
    const tagSel = $("#perm-tag");
    if (tagSel) {
      tagSel.innerHTML = permTagOptionsHtml(permUsers, user.user_tag || "");
      tagSel.value = user.user_tag || "";
    }
    const noteInp = $("#perm-note");
    if (noteInp) noteInp.value = user.user_note || "";
    const uid = user.user_id;
    // 类目池子 = 标签管理的全量类目（跨专区同一套），授权只勾一次、四专区共用
    const [allCats, perm, myZones] = await Promise.all([
      SB.listZoneCats("recruit").catch(() => []),
      SB.listUserPermissions(uid).catch(() => []),
      SB.getUserManageZones(uid).catch(() => []),
    ]);
    renderPermCats(allCats, perm);
    renderPermZones(myZones);
  }

// 弹窗已勾类目
  function openPermEditModal(u) {
    if (!u) return;
    permEditUid = u.user_id;
    const title = $("#perm-edit-title");
    if (title) title.textContent = "编辑用户权限 · " + (u.email || u.user_id);
    const roleSel = $("#perm-edit-role");
    if (roleSel) roleSel.value = u.role || "visitor";
    const tagSel = $("#perm-edit-tag");
    if (tagSel) {
      tagSel.innerHTML = permTagOptionsHtml(permUsers, u.user_tag || "");
      tagSel.value = u.user_tag || "";
    }
    const noteInp = $("#perm-edit-note");
    if (noteInp) noteInp.value = u.user_note || "";
    const modal = $("#perm-edit-modal");
    if (modal) modal.classList.remove("hidden");
    // 异步加载类目池 + 当前授权 + 前端可见专区(frontend_zones) + 后台可管理专区(manage_zones)
    Promise.all([
      SB.listZoneCats("recruit").catch(() => []),
      SB.listUserPermissions(u.user_id).catch(() => []),
      SB.getUserFrontendZones(u.user_id).catch(() => []),
      SB.getUserManageZones(u.user_id).catch(() => []),
    ]).then(([allCats, perm, frontZones, manageZones]) => {
      permEditAllCats = allCats;
      renderPermEditCats(allCats, perm);
      renderPermEditZones(frontZones, "#perm-edit-zones");
      renderPermEditZones(manageZones, "#perm-edit-manage-zones");
    });
  }

function closePermEditModal() {
    const modal = $("#perm-edit-modal");
    if (modal) modal.classList.add("hidden");
    permEditUid = null;
  }

function renderPermEditCats(cats, checked) {
    const box = $("#perm-edit-cats");
    if (!box) return;
    box.innerHTML = "";
    if (!cats.length) { box.innerHTML = '<span class="hint">暂无类目，请先到「标签管理/类目设置」新增。</span>'; return; }
    const norm = s => (s || "").trim();
    const chk = new Set((checked || []).map(norm));
    cats.forEach(c => {
      const lab = document.createElement("label");
      lab.className = "perm-cat-item";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = c.name; cb.checked = chk.has(norm(c.name));
      cb.onchange = updatePermEditCatCount;
      lab.appendChild(cb); lab.appendChild(document.createTextNode(c.name));
      box.appendChild(lab);
    });
    updatePermEditCatCount();
  }

function renderPermEditZones(checked, containerId) {
    const box = $(containerId || "#perm-edit-zones");
    if (!box) return;
    box.innerHTML = "";
    const set = new Set((checked || []));
    PERM_ZONES.forEach(z => {
      const lab = document.createElement("label");
      lab.className = "perm-zone-item";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = z.key; cb.checked = set.has(z.key);
      lab.appendChild(cb); lab.appendChild(document.createTextNode(z.label));
      box.appendChild(lab);
    });
  }

function updatePermEditCatCount() {
    const cnt = $("#perm-edit-cats-count");
    if (!cnt) return;
    const total = document.querySelectorAll("#perm-edit-cats input[type=checkbox]").length;
    const picked = document.querySelectorAll("#perm-edit-cats input[type=checkbox]:checked").length;
    cnt.textContent = "已选 " + picked + " / " + total;
  }

// 提交弹窗编辑：写入角色/标签/备注/类目/专区，完成后就地更新该行，不重建整表
  async function savePermEditModal() {
    const uid = permEditUid;
    if (!uid) return;
    const role = $("#perm-edit-role")?.value || "visitor";
    const tag = ($("#perm-edit-tag")?.value || "").trim();
    const note = ($("#perm-edit-note")?.value || "").trim();
    const cats = [...document.querySelectorAll("#perm-edit-cats input:checked")].map(i => i.value);
    const frontZones = [...document.querySelectorAll("#perm-edit-zones input:checked")].map(i => i.value);
    const manageZones = [...document.querySelectorAll("#perm-edit-manage-zones input:checked")].map(i => i.value);
    try {
      await SB.setUserNote(uid, note);
      await SB.setUserTag(uid, tag);
      await SB.setUserRole(uid, role);
      // 前端可见专区（frontend_zones）
      await SB.setUserFrontendZones(uid, frontZones);
      // 后台可管理专区（manage_zones）
      await SB.setUserManageZones(uid, manageZones);
      // 类目授权：与界面「跨专区统一生效」语义一致，写入全部四个专区
      // （无论超管是否勾了后台可管理专区，管理员在任一被授权专区上传都可受该类目约束）
      const ALL_CAT_ZONES = ["visual", "trend", "recruit", "bestseller"];
      for (const z of ALL_CAT_ZONES) {
        await SB.setUserPermissions(uid, z, cats);
      }
      sbToast("该用户角色与权限已保存");
      // 就地更新内存数据 + 刷新该行 + 同步编辑区/筛选
      const u = permUsers.find(x => x.user_id === uid);
      if (u) { u.role = role; u.user_tag = tag; u.user_note = note; }
      syncPermTagEditor(); syncPermTagFilter();
      $("#perm-note") && (($("#perm-note")).value = note);
      await renderPermTable(permUsers);
      closePermEditModal();
    } catch (e) { sbToast("保存失败：" + (e.message || ""), false); }
  }

function bindPermEditModal() {
    const modal = $("#perm-edit-modal");
    if (!modal) return;
    const close = $("#perm-edit-close");
    if (close) close.onclick = closePermEditModal;
    const cancel = $("#perm-edit-cancel");
    if (cancel) cancel.onclick = closePermEditModal;
    const save = $("#perm-edit-save");
    if (save) save.onclick = savePermEditModal;
    const allBtn = $("#perm-edit-cats-all");
    if (allBtn) allBtn.onclick = () => {
      document.querySelectorAll("#perm-edit-cats input[type=checkbox]").forEach(cb => cb.checked = true);
      updatePermEditCatCount();
    };
    const noneBtn = $("#perm-edit-cats-none");
    if (noneBtn) noneBtn.onclick = () => {
      document.querySelectorAll("#perm-edit-cats input[type=checkbox]").forEach(cb => cb.checked = false);
      updatePermEditCatCount();
    };
    // 弹窗遮罩点击关闭
    modal.addEventListener("click", (e) => { if (e.target === modal) closePermEditModal(); });
  }

// ============ 超管：新增用户（邮箱 + 密码，走 Worker Auth Admin API） ============
  function openPermCreateModal() {
    const modal = $("#perm-create-modal");
    if (!modal) return;
    const email = $("#perm-create-email");
    const pwd = $("#perm-create-password");
    if (email) email.value = "";
    if (pwd) pwd.value = "";
    modal.classList.remove("hidden");
    setTimeout(() => email && email.focus(), 60);
  }

function closePermCreateModal() {
    const modal = $("#perm-create-modal");
    if (modal) modal.classList.add("hidden");
  }

async function savePermCreateModal() {
    const email = ($("#perm-create-email")?.value || "").trim();
    const pwd = ($("#perm-create-password")?.value || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { sbToast("请输入正确的邮箱", false); return; }
    if (pwd.length < 6) { sbToast("密码至少 6 位", false); return; }
    const saveBtn = $("#perm-create-save");
    if (saveBtn) saveBtn.disabled = true;
    try {
      await SB.superCreateUser(email, pwd);
      sbToast("已创建账户：" + email);
      closePermCreateModal();
      await loadPermPanel();
    } catch (e) {
      sbToast("创建失败：" + (e.message || ""), false);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

function bindPermCreateUser() {
    const btn = $("#perm-add-user-btn");
    if (btn) btn.onclick = openPermCreateModal;
    const modal = $("#perm-create-modal");
    if (!modal) return;
    const close = $("#perm-create-close");
    if (close) close.onclick = closePermCreateModal;
    const cancel = $("#perm-create-cancel");
    if (cancel) cancel.onclick = closePermCreateModal;
    const save = $("#perm-create-save");
    if (save) save.onclick = savePermCreateModal;
    modal.addEventListener("click", (e) => { if (e.target === modal) closePermCreateModal(); });
  }

// ============ 超管：删除用户（走 Worker Auth Admin API，二次确认） ============
  function confirmDeletePermUser(u) {
    if (!u || !u.user_id) return;
    if (!confirm("确定删除用户「" + (u.email || u.user_id) + "」？\n删除后将无法登录，其权限与引导数据一并清除。此操作不可恢复。")) return;
    (async () => {
      try {
        await SB.superDeleteUser(u.user_id);
        sbToast("已删除用户：" + (u.email || ""));
        // 就地移除该行，避免整表重建跳滚动
        permUsers = permUsers.filter(x => x.user_id !== u.user_id);
        renderPermTable(permUsers);
      } catch (e) {
        sbToast("删除失败：" + (e.message || ""), false);
      }
    })();
  }

function renderPermZones(checked) {
    const box = $("#perm-zones");
    if (!box) return;
    box.innerHTML = "";
    const set = new Set((checked || []));
    PERM_ZONES.forEach(z => {
      const lab = document.createElement("label");
      lab.className = "perm-zone-item";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = z.key; cb.checked = set.has(z.key);
      lab.appendChild(cb); lab.appendChild(document.createTextNode(z.label));
      box.appendChild(lab);
    });
  }

function renderPermCats(cats, checked) {
    const box = $("#perm-cats");
    if (!box) return;
    box.innerHTML = "";
    if (!cats.length) { box.innerHTML = '<span class="hint">暂无类目，请先到「标签管理/类目设置」新增。</span>'; return; }
    const norm = s => (s || "").trim();
    const chk = new Set((checked || []).map(norm));
    cats.forEach(c => {
      const lab = document.createElement("label");
      lab.className = "perm-cat-item";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = c.name; cb.checked = chk.has(norm(c.name));
      cb.onchange = updatePermCatCount;
      lab.appendChild(cb); lab.appendChild(document.createTextNode(c.name));
      box.appendChild(lab);
    });
    updatePermCatCount();
  }

function updatePermCatCount() {
    const cnt = document.querySelector("#perm-cats-count");
    if (!cnt) return;
    const total = document.querySelectorAll("#perm-cats input[type=checkbox]").length;
    const picked = document.querySelectorAll("#perm-cats input[type=checkbox]:checked").length;
    cnt.textContent = "已选 " + picked + " / " + total;
  }

// ================= 专区管理（新增 / 改名 / 删除） =================
// 专区定义存于 site_settings.frontend_zone_visibility.__defs（无需改数据库）
const ZDEF_HREF_PRESETS = [
  { label: "（不显示在前台菜单）", href: "" },
  { label: "视觉专区页 (index.html)", href: "index.html" },
  { label: "趋势专区页 (trends.html)", href: "trends.html" },
  { label: "招品回品 (trends.html#recruit)", href: "trends.html#recruit" },
  { label: "BESTSELLER (trends.html#bestseller)", href: "trends.html#bestseller" },
  { label: "趋势上升榜 (rank.html)", href: "rank.html" },
  { label: "营销日历 (marketing.html)", href: "marketing.html" },
];

function zdefKey(label) {
  const base = String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (base) return base.slice(0, 24);
  return "z" + Date.now().toString(36);
}

function currentZoneDefs() {
  const d = window.ZONE_DEFS;
  if (Array.isArray(d) && d.length) return d.map(z => ({ key: z.key, label: z.label, href: z.href || "" }));
  return [];
}

async function persistZoneDefs(defs) {
  await SB.setZoneDefs(defs);
  await reloadZoneDefs();
  syncPermZones();
  if (window.Common && Common.zones) { Common.zones.setDefs(window.ZONE_DEFS); Common.zones.renderNav(); }
  await renderZoneDefsBox();
  // 让「顶部菜单项 · 前台可见」「各专区类目可见」两张表也换成新的专区集合
  try { await loadZoneVisibility(); } catch (e) {}
  try { await loadCatVisibility(); } catch (e) {}
}

async function renderZoneDefsBox() {
  const box = document.querySelector("#zone-defs-box");
  if (!box) return;
  const defs = currentZoneDefs();
  const builtinKeys = (window.ZONE_DEFS_DEFAULT || []).map(z => z.key);
  box.innerHTML = "";
  const head = document.createElement("div");
  head.className = "zdef-row zdef-head";
  head.innerHTML = '<span class="zdef-c1">专区名称</span><span class="zdef-c2">前台链接</span><span class="zdef-c3">标识</span><span class="zdef-c4"></span>';
  box.appendChild(head);

  defs.forEach(d => {
    const row = document.createElement("div");
    row.className = "zdef-row";
    const builtin = builtinKeys.indexOf(d.key) >= 0;
    const opts = ZDEF_HREF_PRESETS.slice();
    if (d.href && !opts.some(o => o.href === d.href)) opts.push({ label: "自定义：" + d.href, href: d.href });
    row.innerHTML =
      '<input class="input zdef-label" value="' + escHtml(d.label || "") + '" placeholder="专区名称">' +
      '<select class="input zdef-href">' + opts.map(o =>
        '<option value="' + escHtml(o.href) + '"' + (o.href === (d.href || "") ? " selected" : "") + '>' + escHtml(o.label) + '</option>'
      ).join("") + '</select>' +
      '<code class="zdef-key">' + escHtml(d.key) + '</code>' +
      '<span class="zdef-ops"><button class="btn-ghost zdef-save" type="button">保存</button>' +
      (builtin ? '' : '<button class="btn-ghost zdef-del" type="button">删除</button>') + '</span>';
    row.querySelector(".zdef-save").onclick = async () => {
      const label = row.querySelector(".zdef-label").value.trim();
      const href = row.querySelector(".zdef-href").value;
      if (!label) { sbToast("专区名称不能为空", false); return; }
      const next = currentZoneDefs().map(x => x.key === d.key ? { key: x.key, label: label, href: href } : x);
      try { await persistZoneDefs(next); sbToast("已保存：" + label); }
      catch (e) { sbToast("保存失败：" + (e.message || ""), false); }
    };
    if (!builtin) row.querySelector(".zdef-del").onclick = async () => {
      if (!confirm("确定删除专区「" + (d.label || d.key) + "」？删除后该专区不再出现在前台菜单与权限勾选列表里（已勾选该专区的用户会失去这一项）。")) return;
      const next = currentZoneDefs().filter(x => x.key !== d.key);
      try { await persistZoneDefs(next); sbToast("已删除：" + (d.label || d.key)); }
      catch (e) { sbToast("删除失败：" + (e.message || ""), false); }
    };
    box.appendChild(row);
  });

  const foot = document.createElement("div");
  foot.className = "zdef-row zdef-new";
  foot.innerHTML =
    '<input id="zdef-new-label" class="input zdef-label" placeholder="新专区名称，如 上新专区">' +
    '<select id="zdef-new-href" class="input zdef-href">' + ZDEF_HREF_PRESETS.map(o =>
      '<option value="' + escHtml(o.href) + '"' + (o.href === "rank.html" ? " selected" : "") + '>' + escHtml(o.label) + '</option>'
    ).join("") + '</select>' +
    '<span class="zdef-c3"><button id="zdef-add" class="btn-primary" type="button">＋ 新增专区</button></span><span></span>';
  box.appendChild(foot);

  const add = document.querySelector("#zdef-add");
  if (add) add.onclick = async () => {
    const label = (document.querySelector("#zdef-new-label").value || "").trim();
    const href = document.querySelector("#zdef-new-href").value || "";
    if (!label) { sbToast("请填写新专区名称", false); return; }
    const defs2 = currentZoneDefs();
    let key = zdefKey(label), i = 2;
    while (defs2.some(x => x.key === key)) key = zdefKey(label) + "-" + (i++);
    defs2.push({ key: key, label: label, href: href });
    try {
      await persistZoneDefs(defs2);
      sbToast("已新增专区：" + label + "（记得给管理员勾选该专区权限）");
    } catch (e) { sbToast("新增失败：" + (e.message || ""), false); }
  };
}

function bindPermission() {
    // 按标签筛选：选择后权限表仅显示匹配标签的用户
    const tagFilter = $("#perm-tag-filter");
    if (tagFilter) tagFilter.onchange = () => { permTagFilter = tagFilter.value; renderPermTable(permUsers); };
    bindDefaultPerms();
    bindPermEditModal();
    bindPermCreateUser();
  }

  /* 暴露给其它模块 / 事件绑定 */
  Object.assign(window, {
    permRoleLabel, permTagChoices, permTagOptionsHtml, loadPermPanel, loadDefaultPerms, renderDefaultZones, bindDefaultPerms, renderPermTable, syncPermTagEditor, syncPermTagFilter, loadPermForUser, openPermEditModal, closePermEditModal, renderPermEditCats, renderPermEditZones, updatePermEditCatCount, savePermEditModal, bindPermEditModal, openPermCreateModal, closePermCreateModal, savePermCreateModal, bindPermCreateUser, confirmDeletePermUser, renderPermZones, renderPermCats, updatePermCatCount, bindPermission, syncPermZones, renderZoneDefsBox, persistZoneDefs
  });

})();
