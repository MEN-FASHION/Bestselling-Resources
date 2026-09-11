/* ============================================================
 * 后台逻辑：Supabase 登录 + 管理员角色校验 + 传图 + 类目/常用类目管理 + 删除
 * ============================================================ */
(function () {
  const $ = (sel) => document.querySelector(sel);

  let pendingFiles = [];
  let uploading = false;
  let currentUser = null;
  let currentRole = null;
  let currentFavCats = [];   // 当前管理员常用类目
  let currentActiveCats = []; // 前台类目（categories 表）
  let currentCatOrder = [];   // 前台类目顺序 [{id,name,sort_order}]
  let currentManageCat = "全部"; // 图片管理当前选中类目（"全部" = 显示全部）
  let selectedImages = new Set();  // 图片管理勾选集合

  document.addEventListener("DOMContentLoaded", () => {
    // 先注册登录状态监听：保证任何后续界面绑定异常都不影响登录进入后台
    SB.onAuth((session) => {
      currentUser = session ? session.user : null;
      refreshUserBadge();
      if (session) {
        enterPanel();
      } else {
        // 未登录：显示登录页，隐藏后台
        $("#admin-login").classList.remove("hidden");
        $("#admin-panel").classList.add("hidden");
      }
      // 鉴权判定完成，揭开加载遮罩，避免登录页闪现
      const sp = document.getElementById("boot-splash");
      if (sp) sp.classList.add("hidden");
    });
    // 各项 UI 绑定单独容错：单个元素缺失只影响对应功能，绝不断开登录链路
    [bindLogin, bindLogout, bindToken, bindUpload, bindManage, bindFavCats,
     bindCatMgmt, bindAccess, bindTagDefs, bindDashboard, bindAdminNav, bindSmartModal, bindTrend, bindNotice, bindRecruit]
      .forEach(fn => { try { fn(); } catch (e) { console.warn("init 跳过:", fn.name, e); } });
  });

  // ================= 后台侧边菜单 =================
  function bindAdminNav() {
    document.querySelectorAll("#admin-panel .nav-item").forEach(item => {
      item.addEventListener("click", () => switchPanel(item.dataset.target));
    });
  }
  function switchPanel(target) {
    const cards = ["manage-card", "upload-card", "access-card", "tag-card", "dash-card", "trend-card", "notice-card", "recruit-card", "no-perm"];
    cards.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add("hidden"); });
    const show = document.getElementById(target);
    if (show) show.classList.remove("hidden");
    // 高亮当前菜单
    document.querySelectorAll("#admin-panel .nav-item").forEach(n => {
      n.classList.toggle("active", n.dataset.target === target);
    });
    // 进入看板/标签管理时动态加载数据
    if (target === "dash-card") { buildDashCatFilter(); loadDashboard(); }
    if (target === "tag-card") { loadTagDefs(); loadFavCats(); loadCatMgmt(); }
    if (target === "trend-card") { loadTrendList(); }
    if (target === "recruit-card") { loadRecruitList(); }
  }
  async function saveCatOrder() {
    const rows = [...document.querySelectorAll("#cat-order-box .cat-order-item")];
    if (!rows.length) { sbToast("没有需要保存的类目", false); return; }
    try {
      for (const row of rows) {
        const id = row.dataset.id;
        const num = parseInt(row.querySelector(".order-num").value, 10);
        await SB.setCategoryOrder(id, (Number.isFinite(num) && num >= 1) ? num : 1);
      }
      currentCatOrder = await SB.listActiveCatsWithOrder();
      renderCatOrder();
      sbToast("展示顺序已保存");
      const btn = $("#cat-order-save");
      if (btn) btn.disabled = true;
    } catch (e) { sbToast("保存失败：" + (e.message || ""), false); }
  }

  // 顶部显示当前用户与角色
  async function refreshUserBadge() {
    const el = $("#token-status");
    if (!currentUser) { el.textContent = "未登录"; return; }
    currentRole = await SB.myRole();
    el.textContent = currentUser.email + " · " + (currentRole === "admin" ? "管理员" : "访客");
    el.classList.toggle("bad", currentRole !== "admin");
    // 只控制侧边菜单显隐；面板显隐统一由 switchPanel 管理，避免后台各面板连在一起
    const isAdmin = currentRole === "admin";
    document.querySelectorAll("#admin-panel .nav-item").forEach(n => {
      n.classList.toggle("hidden", !isAdmin && n.dataset.target !== "manage-card");
    });
  }

  // ================= 登录 / 退出 =================
  function bindLogin() {
    $("#admin-login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#admin-email").value.trim();
      const pass = $("#admin-pass").value;
      if (!email || !pass) { sbToast("请输入邮箱和密码", false); return; }
      const { error } = await SB.signIn(email, pass);
      if (error) sbToast("登录失败：" + (error.message || ""), false);
    });
  }
  function bindLogout() {
    const logBtn = $("#admin-logout");
    if (!logBtn) return;
    logBtn.onclick = async () => {
      try {
        await SB.signOut();
        location.reload();
      } catch (e) {
        // 登出请求失败时给出提示并强制刷新，避免"点了没反应"
        sbToast("退出失败，请重试", false);
        location.reload();
      }
    };
  }
  function enterPanel() {
    $("#admin-login").classList.add("hidden");
    $("#admin-panel").classList.remove("hidden");
    loadCats(); loadManage(); loadAccess();
    if (currentRole === "admin") { loadFavCats(); loadCatMgmt(); loadTagDefs(); }
    // 默认显示“图片管理”
    switchPanel("manage-card");
  }

  // ================= 登录 / 注册引导 =================
  function bindToken() {
    // 后台登录页提供“注册”入口，便于用户创建首个账号，再在数据库里赋予管理员角色
    $("#admin-toggle").onclick = (e) => {
      e.preventDefault();
      sbToast("请先用邮箱注册（下方），注册后再到数据库把该用户设为管理员（见 README）");
    };
    $("#admin-signup-btn").onclick = async () => {
      const email = $("#admin-email").value.trim();
      const pass = $("#admin-pass").value;
      if (!email || !pass) { sbToast("请填写邮箱和密码", false); return; }
      const { data, error } = await SB.signUp(email, pass);
      if (error) { sbToast("注册失败：" + (error.message || ""), false); return; }
      sbToast("注册成功，已登录。现在去 Supabase 数据库把该用户设为管理员（见 README）");
    };
  }

  // ================= 上传 =================
  function bindUpload() {
    const dz = $("#dropzone");
    const fi = $("#file-input");

    dz.querySelector("em").onclick = (e) => { e.stopPropagation(); fi.click(); };
    dz.onclick = (e) => { if (e.target.tagName !== "EM") fi.click(); };
    fi.onchange = () => { addFiles(fi.files); fi.value = ""; };

    ["dragover", "dragenter"].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", (e) => { addFiles(e.dataTransfer.files); });

    $("#upload-btn").onclick = doUpload;
  }
  function addFiles(fileList) {
    const imgs = Array.from(fileList).filter(f => /^image\//.test(f.type));
    if (!imgs.length) { sbToast("请选择图片文件", false); return; }
    imgs.forEach(f => {
      if (pendingFiles.some(p => p.name === f.name && p.size === f.size)) return;
      pendingFiles.push(f);
    });
    renderPending();
  }
  function removePending(idx) { pendingFiles.splice(idx, 1); renderPending(); }
  function renderPending() {
    const box = $("#pending-list");
    box.innerHTML = "";
    pendingFiles.forEach((f, idx) => {
      const row = document.createElement("div");
      row.className = "pending-row";
      row.innerHTML = `<span class="pname">🖼 ${f.name}</span><span class="psize">${fmtSize(f.size)}</span><button class="x" data-i="${idx}">×</button>`;
      row.querySelector(".x").onclick = () => removePending(idx);
      box.appendChild(row);
    });
    $("#upload-btn").disabled = pendingFiles.length === 0;
    $("#upload-btn").textContent = "上传所选（" + pendingFiles.length + "）";
  }
  function fmtSize(n) {
    if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    return Math.max(1, Math.round(n / 1024)) + " KB";
  }

  // ================= 上传主流程（写入 R2 + DB） =================
  async function doUpload() {
    if (!pendingFiles.length || uploading) return;
    if (currentRole !== "admin") { sbToast("无权限：只有管理员可上传", false); return; }

    let cat = $("#cat-select").value;
    if (!cat) { sbToast("请选择分类", false); return; }

    uploading = true;
    $("#upload-btn").disabled = true;
    const prog = $("#progress"); prog.classList.remove("hidden");
    const bar = $("#progress-bar");
    const total = pendingFiles.length;
    let done = 0, failed = 0, dup = 0, dupNames = [];

    // 重复校验：加载库中已存在的图片名，同名图片无法重复上传
    let existingNames = new Set();
    try { existingNames = new Set(await SB.listImageNames()); } catch (e) { console.warn("加载已有图片名失败，跳过重复校验", e); }

    for (const file of pendingFiles) {
      const cleanName = file.name.replace(/[^\w.\-]/g, "_");
      if (existingNames.has(cleanName)) {
        dup++;
        dupNames.push(cleanName);
        console.warn("检测到重复图片，跳过：" + cleanName);
        done++;
        bar.style.width = Math.round(done / total * 100) + "%";
        continue;
      }
      try {
        // 1) 上传到 R2（经 Worker，路径由 Worker 生成）
        const path = await SB.uploadImage(file, cat);
        // 2) 记录到 DB 清单
        await SB.addImageRecord({ category: cat, name: cleanName, path });
        existingNames.add(cleanName); // 本次会话后续相同文件也不再重复上传
      } catch (e) {
        console.warn(e);
        failed++;
      }
      done++;
      bar.style.width = Math.round(done / total * 100) + "%";
    }

    let msg = `上传完成：成功 ${total - failed - dup}，失败 ${failed}`;
    if (dup) msg += `，重复跳过 ${dup}`;
    sbToast(msg, failed === 0 && dup === 0);
    if (dup) {
      const shown = dupNames.slice(0, 3).join("、");
      console.warn("重复图片（已跳过）：" + (dup > 3 ? shown + " 等共" + dup + "张" : shown));
    }
    setTimeout(() => { prog.classList.add("hidden"); bar.style.width = "0%"; }, 800);
    pendingFiles = [];
    renderPending();
    uploading = false;
    await loadCats(); await loadManage();
  }

  // ================= 分类下拉（常用类目优先） =================
  // 类目只能从已配置的「前台类目 + 常用类目」里选，不支持在传图时新增（防止误传出"露脸模特"这类残留类目）
  async function loadCats() {
    let cats = [];
    try { cats = await SB.listActiveCats(); } catch (e) {}
    const sel = $("#cat-select");
    sel.innerHTML = "";
    sel.add(new Option("── 请选择类目 ──", ""));
    // 常用类目排前面
    if (currentFavCats.length) {
      currentFavCats.forEach(c => { if (cats.includes(c)) sel.add(new Option("★ " + c, c)); });
    }
    cats.forEach(c => sel.add(new Option(c, c)));
  }

  // ================= 我的常用类目 =================
  function bindFavCats() {
    $("#fav-save").onclick = saveFavCats;
  }
  async function loadFavCats() {
    try { currentFavCats = await SB.myFavCats(); } catch (e) { currentFavCats = []; }
    // 与前台类目保持一致：候选以「前台类目 currentActiveCats」为主，勾选状态 = 前台类目
    const base = (currentActiveCats && currentActiveCats.length) ? currentActiveCats : currentFavCats;
    const opts = new Set((window.CONFIG.CATEGORY_OPTIONS || []).concat(base));
    const box = $("#fav-list");
    box.innerHTML = "";
    [...opts].sort((a, b) => a.localeCompare(b, "zh")).forEach(name => {
      const label = document.createElement("label");
      label.className = "check-item";
      label.innerHTML = `<input type="checkbox" value="${escAttr(name)}"> <span>${escHtml(name)}</span>`;
      label.querySelector("input").checked = base.includes(name);
      label.querySelector("input").onchange = () => {
        $("#fav-save").disabled = false;
      };
      box.appendChild(label);
    });
    $("#fav-save").disabled = true;
  }
  async function saveFavCats() {
    const picked = [...document.querySelectorAll("#fav-list input:checked")].map(i => i.value);
    try {
      // 与前台类目保持一致：勾选项新增进 categories，未勾选项从前台类目移除
      const toAdd = picked.filter(c => !currentActiveCats.includes(c));
      const toDel = currentActiveCats.filter(c => !picked.includes(c));
      for (const c of toAdd) await SB.addCategory(c);
      for (const c of toDel) await SB.removeCategory(c);
      currentActiveCats = await SB.listActiveCats();
      currentFavCats = await SB.updateFavCats(picked);
      sbToast("常用类目已保存（已同步前台类目）");
      $("#fav-save").disabled = true;
      await loadCats(); await loadCatMgmt();
    } catch (e) { sbToast("保存失败：" + (e.message || ""), false); }
  }

  // ================= 前台类目管理 =================
  function bindCatMgmt() {
    $("#cat-mgmt-save").onclick = saveCatMgmt;
    $("#cat-order-save").onclick = saveCatOrder;
    $("#cat-mgmt-add").onclick = () => {
      const v = $("#cat-mgmt-new").value.trim();
      if (!v) { sbToast("请输入类目名", false); return; }
      addOptionToCatMgmt(v);
      $("#cat-mgmt-new").value = "";
    };
  }
  async function loadCatMgmt() {
    try {
      currentActiveCats = await SB.listActiveCats();
      currentCatOrder = await SB.listActiveCatsWithOrder();
    } catch (e) { currentActiveCats = []; currentCatOrder = []; }
    // 合并三类：候选类目 + 前台启用类目 + 图片中实际出现的类目（含误加未入库的"露脸模特"这类残留）
    let usedCats = [];
    try { usedCats = await SB.listUsedCats(); } catch (e) { usedCats = []; }
    const opts = new Set((window.CONFIG.CATEGORY_OPTIONS || []).concat(currentActiveCats).concat(usedCats));
    const box = $("#cat-mgmt-list");
    box.innerHTML = "";
    [...opts].sort((a, b) => a.localeCompare(b, "zh")).forEach(name => {
      const label = document.createElement("label");
      label.className = "check-item";
      const isUsedOnly = usedCats.includes(name) && !currentActiveCats.includes(name) && !(window.CONFIG.CATEGORY_OPTIONS || []).includes(name);
      label.innerHTML = `<input type="checkbox" value="${escAttr(name)}"> <span title="${escAttr(name)}">${escHtml(name)}</span><button class="check-del" title="删除该类目（勾选项仅从前台移除；这里的删除会同时清空图片上的该类目）">删除</button>`;
      label.querySelector("input").checked = currentActiveCats.includes(name);
      label.querySelector("input").onchange = () => { $("#cat-mgmt-save").disabled = false; };
      // 删除按钮：从 categories 表移除，并清空图片上的该类目字段
      label.querySelector(".check-del").onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!confirm("确定删除类目「" + name + "」吗？\n删除后会同步清空所有归属该类目的图片的类目字段（图片本身保留）。")) return;
        try {
          await SB.removeCategory(name);
          const imgs = await SB.listImages(null);
          let n = 0;
          for (const img of imgs) {
            if ((img.category || "") === name) { await SB.updateImageField(img.id, "category", ""); n++; }
          }
          // 同步从常用类目移除
          const fav = (currentFavCats || []).filter(c => c !== name);
          try { await SB.updateFavCats(fav); currentFavCats = fav; } catch (e) {}
          sbToast("已删除类目「" + name + "」" + (n ? "，清空 " + n + " 张图片" : ""));
          await loadCatMgmt(); await loadCats(); await loadFavCats(); await loadManage();
        } catch (err) { sbToast("删除失败：" + (err.message || ""), false); }
      };
      if (isUsedOnly) { /* 残留类目：默认不勾选，仅展示以便删除 */ }
      box.appendChild(label);
    });
    renderCatOrder();
    $("#cat-mgmt-save").disabled = true;
  }
  function addOptionToCatMgmt(name) {
    // 若已存在则忽略；否则添加到勾选列表并标记待保存
    const box = $("#cat-mgmt-list");
    if (box.querySelector(`input[value="${CSS.escape(name)}"]`)) return;
    const label = document.createElement("label");
    label.className = "check-item";
    label.innerHTML = `<input type="checkbox" value="${escAttr(name)}" checked> <span>${escHtml(name)}</span>`;
    label.querySelector("input").onchange = () => { $("#cat-mgmt-save").disabled = false; };
    box.appendChild(label);
    $("#cat-mgmt-save").disabled = false;
  }
  // ---------- 前台类目展示顺序 ----------
  // 顺序区只显示"已添加"的类目，数字越小越靠前，支持上下调整
  function renderCatOrder() {
    const box = $("#cat-order-box");
    if (!box) return;
    box.innerHTML = "";
    if (!currentCatOrder.length) {
      box.innerHTML = '<p class="hint">暂无已添加的类目，勾选上方类目并保存后，可在此调整展示顺序。</p>';
      const b5 = $("#cat-order-save"); if (b5) b5.disabled = true;
      return;
    }
    currentCatOrder.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "cat-order-item";
      row.dataset.id = c.id;
      row.innerHTML = `
        <input type="number" class="order-num" min="1" step="1" value="${i + 1}" title="显示在第几位">
        <span class="order-name">${escHtml(c.name)}</span>
        <button type="button" class="order-up" title="上移">↑</button>
        <button type="button" class="order-down" title="下移">↓</button>`;
      row.querySelector(".order-up").onclick = () => moveCatOrder(i, -1);
      row.querySelector(".order-down").onclick = () => moveCatOrder(i, 1);
      const enableSave = () => { const b = $("#cat-order-save"); if (b) b.disabled = false; };
      row.querySelector(".order-num").onchange = enableSave;
      box.appendChild(row);
    });
  }
  function moveCatOrder(idx, dir) {
    const to = idx + dir;
    if (to < 0 || to >= currentCatOrder.length) return;
    const arr = currentCatOrder.slice();
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    currentCatOrder = arr;
    renderCatOrder();
    const sb2 = $("#cat-order-save"); if (sb2) sb2.disabled = false;
  }
  async function saveCatMgmt() {
    const picked = [...document.querySelectorAll("#cat-mgmt-list input:checked")].map(i => i.value);
    // 同步差异：新增不在 categories 里的；删除未勾选的
    const toAdd = picked.filter(c => !currentActiveCats.includes(c));
    const toDel = currentActiveCats.filter(c => !picked.includes(c));
    try {
      for (const c of toAdd) await SB.addCategory(c);
      for (const c of toDel) await SB.removeCategory(c);
      // 重新读取最新顺序（含新增类目）
      currentActiveCats = await SB.listActiveCats();
      currentCatOrder = await SB.listActiveCatsWithOrder();
      // 应用界面上调整过的顺序（含新增项末尾追加）
      const orderRows = [...document.querySelectorAll("#cat-order-box .cat-order-item")];
      if (orderRows.length) {
        const newOrder = orderRows.map((row) => {
          const num = parseInt(row.querySelector(".order-num").value, 10);
          return { id: row.dataset.id, sort_order: (Number.isFinite(num) && num >= 1) ? num : 1 };
        });
        for (const c of newOrder) await SB.setCategoryOrder(c.id, c.sort_order);
        currentCatOrder = await SB.listActiveCatsWithOrder();
        renderCatOrder();
      }
      sbToast("前台类目已保存");
      $("#cat-mgmt-save").disabled = true;
      // 与常用类目保持一致：同步当前用户的常用类目 = 前台类目
      try { await SB.updateFavCats(picked); currentFavCats = picked; } catch (e) {}
      await loadCats(); await loadFavCats(); await loadManage();
    } catch (e) { sbToast("保存失败：" + (e.message || ""), false); }
  }

  function bindManage() {
    $("#select-all-btn").onclick = toggleSelectAll;
    $("#batch-del-btn").onclick = batchDelete;
    $("#batch-tag-btn").onclick = openTagModal;
    $("#tag-apply").onclick = () => applyTags();
    $("#tag-remove").onclick = () => applyTags(true);
    $("#tag-clear").onclick = clearTags;
    $("#tag-cancel").onclick = closeTagModal;
    document.querySelectorAll(".modal-mask").forEach(m => {
      m.addEventListener("click", (e) => { if (e.target === m) closeTagModal(); });
    });
  }
  async function loadManage() {
    const grid = $("#manage-grid");
    const menu = $("#manage-menu");
    // 先并行取全部图片 + 有图类目
    let allImgs = [];
    try {
      allImgs = await SB.listImages(null);
    } catch (e) {
      grid.innerHTML = "<p class='hint'>读取失败</p>";
      return;
    }
    // 有图的类目（去重，拼音排序）
    const usedCats = [...new Set(allImgs.map(i => i.category))].sort((a, b) => a.localeCompare(b, "zh"));

    // 渲染左侧类目菜单
    menu.innerHTML = "";
    // 已配置的启用类目 + 候选类目（用于判断是否为"残留类目"——图片中有但无配置）
    let activeCats = [];
    try { activeCats = await SB.listActiveCats(); } catch (e) { activeCats = []; }
    let cfgOpts = [];
    try { cfgOpts = await SB.listCategories(); } catch (e) { cfgOpts = []; }
    const configured = new Set([...activeCats, ...cfgOpts.map(c => c.name)]);
    ["全部"].concat(usedCats).forEach(c => {
      const row = document.createElement("div");
      row.className = "cat-menu-row";
      const b = document.createElement("button");
      b.className = "cat-menu-item" + (c === currentManageCat ? " active" : "");
      b.textContent = c + "（" + (c === "全部" ? allImgs.length : allImgs.filter(i => i.category === c).length) + "）";
      b.onclick = () => { currentManageCat = c; renderManageGrid(allImgs, usedCats); };
      row.appendChild(b);
      // 残留类目：图片中有该类目但未在配置表中 → 提供一键删除（清空该类目下图片的类目字段）
      if (c !== "全部" && !configured.has(c)) {
        const del = document.createElement("button");
        del.className = "cat-menu-del";
        del.title = "删除残留类目「" + c + "」（清空该类目下所有图片的类目字段）";
        del.textContent = "×";
        del.onclick = async (ev) => {
          ev.stopPropagation();
          if (!confirm("类目「" + c + "」未在配置表中（疑似误加）。确定删除吗？\n删除后会同步清空该类目下所有图片的类目字段（图片本身保留）。")) return;
          try {
            const imgs = allImgs.filter(i => (i.category || "") === c);
            let n = 0;
            for (const img of imgs) { await SB.updateImageField(img.id, "category", ""); n++; }
            sbToast("已删除残留类目「" + c + "」，清空 " + n + " 张图片的类目");
            await loadManage();
          } catch (err) { sbToast("删除失败：" + (err.message || ""), false); }
        };
        row.appendChild(del);
      }
      menu.appendChild(row);
    });

    renderManageGrid(allImgs, usedCats);
  }

  async function renderManageGrid(allImgs, usedCats) {
    const grid = $("#manage-grid");
    const imgList = currentManageCat === "全部" ? allImgs : allImgs.filter(i => i.category === currentManageCat);
    // 勾选集合只保留当前列表里仍存在的项
    const validIds = new Set(imgList.map(i => i.id));
    selectedImages = new Set([...selectedImages].filter(id => validIds.has(id)));
    updateBatchBtn();

    grid.innerHTML = "";
    $("#manage-empty").classList.toggle("hidden", imgList.length > 0);
    if (!imgList.length) return;
    // 一次性取当前登录令牌
    const adminToken = await SB.currentToken();
    for (const img of imgList) {
      const thumb = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "") + "/" + img.path + (adminToken ? "?token=" + encodeURIComponent(adminToken) : "");
      const cell = document.createElement("div");
      cell.className = "cell mgr-cell";

      const holder = document.createElement("div");
      holder.className = "holder";
      const imgEl = document.createElement("img");
      imgEl.dataset.src = thumb;
      imgEl.alt = img.name || "";
      imgEl.loading = "lazy";
      imgEl.draggable = false;
      imgEl.addEventListener("contextmenu", (e) => e.preventDefault());
      holder.appendChild(imgEl);

      const cap = document.createElement("div");
      cap.className = "cell-cap mgr-cap";
      const mkCap = (lab, arr, cls) => `<span class="mgr-cap-row ${cls}"><i>${lab}</i>${(Array.isArray(arr) && arr.length) ? escHtml(arr.join("、")) : "未打标"}</span>`;
      cap.innerHTML =
        mkCap("类目", [img.category || ""], "cat") +
        mkCap("渠道", img.tags, "ch") +
        mkCap("风格", img.style_tags, "st") +
        mkCap("元素", img.element_tags, "el") +
        mkCap("场景", img.scene_tags, "sc") +
        mkCap("拍摄", img.shoot_tags, "sh") +
        mkCap("肤色", img.skin_tags, "sk");

      // 选中状态初始高亮
      if (selectedImages.has(img.id)) cell.classList.add("selected");

      // 点击卡片主体（图片/说明区）也可切换选中，支持连续多选；
      // 按钮查询放到运行时执行，避免依赖 topbar 定义顺序
      const clickCell = (e) => {
        if (e.target.closest(".mgr-topbar") || e.target.closest(".mgr-del")) return;
        const willSel = !selectedImages.has(img.id);
        if (willSel) selectedImages.add(img.id); else selectedImages.delete(img.id);
        cell.classList.toggle("selected", willSel);
        const sb = cell.querySelector(".mgr-selrow");
        if (sb) { sb.classList.toggle("on", willSel); sb.textContent = willSel ? "已选中" : "选中此行"; }
        updateBatchBtn();
      };
      cell.addEventListener("click", clickCell);

      // 顶部操作行：最左 =「选中此行」，最右 =「删除」；点击图片也可选中
      cell.appendChild(holder);
      cell.appendChild(cap);
      const topbar = document.createElement("div");
      topbar.className = "mgr-topbar";
      const selRow = document.createElement("button");
      selRow.className = "mgr-selrow" + (selectedImages.has(img.id) ? " on" : "");
      selRow.textContent = selectedImages.has(img.id) ? "已选中" : "选中此行";
      selRow.dataset.id = img.id;
      selRow.onclick = (e) => {
        e.stopPropagation();
        const willSel = !selectedImages.has(img.id);
        if (willSel) selectedImages.add(img.id); else selectedImages.delete(img.id);
        cell.classList.toggle("selected", willSel);
        selRow.classList.toggle("on", willSel);
        selRow.textContent = willSel ? "已选中" : "选中此行";
        updateBatchBtn();
      };
      const delBtn = document.createElement("button");
      delBtn.className = "btn-danger mgr-del";
      delBtn.textContent = "删除";
      delBtn.onclick = (e) => { e.stopPropagation(); removeImage(img); };
      topbar.appendChild(selRow);
      topbar.appendChild(delBtn);
      cell.appendChild(topbar);
      // 点击卡片主体也切换选中（可选便捷）
      grid.appendChild(cell);

      // 懒加载缩略图
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((entries, obs) => {
          entries.forEach(en => {
            if (en.isIntersecting) {
              en.target.src = en.target.dataset.src;
              en.target.onload = () => en.target.classList.add("loaded");
              obs.unobserve(en.target);
            }
          });
        }, { rootMargin: "200px" });
        io.observe(imgEl);
      } else {
        imgEl.src = imgEl.dataset.src;
        imgEl.classList.add("loaded");
      }
    }
    $("#manage-count").textContent = "共 " + imgList.length + " 张 · " + (currentManageCat === "全部" ? "全部类目" : "类目「" + currentManageCat + "」");
  }

  // 更新批量操作按钮计数
  function updateBatchBtn() {
    $("#batch-del-btn").textContent = "批量删除（" + selectedImages.size + "）";
    $("#batch-del-btn").disabled = selectedImages.size === 0;
    const tagBtn = $("#batch-tag-btn");
    if (tagBtn) {
      tagBtn.textContent = "批量打标签（" + selectedImages.size + "）";
      // 保持可点击，未勾选时在弹窗内提示
      tagBtn.disabled = false;
    }
  }

    // ================= 批量打标签（渠道/风格/元素） =================
  // 读取三类标签分组：渠道=固定清单；风格/元素=tag_defs
  async function getTagGroups() {
    const groups = (window.CONFIG.TAG_GROUPS || []).map(g => ({ ...g, items: [] }));
    const channel = groups.find(g => g.key === "channel");
    (window.CONFIG.CHANNEL_TAGS || []).forEach(grp => {
      (grp.tags || []).forEach(t => channel.items.push(t));
    });
    try {
      const defs = await SB.listTagDefs();
      (defs || []).forEach(d => {
        const g = groups.find(x => x.defType === d.type);
        if (g) g.items.push(d.name);
      });
    } catch (e) { /* 读取失败则只展示渠道 */ }
    return groups;
  }

  function openTagModal() {
    if (!selectedImages.size) { sbToast("请先勾选要打标签的图片", false); return; }
    getTagGroups().then(groups => {
      const box = document.getElementById("tag-modal-groups");
      box.innerHTML = "";
      groups.forEach(g => {
        if (!g.items.length) return;
        const gDiv = document.createElement("div");
        gDiv.className = "mtag-group";
        const gName = document.createElement("div");
        gName.className = "mtag-group-name";
        gName.textContent = g.label + "（" + g.items.length + "）";
        gDiv.appendChild(gName);
        const chips = document.createElement("div");
        chips.className = "mtag-chips";
        g.items.forEach(t => {
          const label = document.createElement("label");
          label.className = "mtag-chip";
          label.innerHTML = `<input type="checkbox" data-field="${escAttr(g.field)}" data-label="${escAttr(g.label)}" value="${escAttr(t)}"> <span>${escHtml(t)}</span>`;
          chips.appendChild(label);
        });
        gDiv.appendChild(chips);
        box.appendChild(gDiv);
      });
      document.getElementById("tag-modal-info").textContent =
        "已选 " + selectedImages.size + " 张图片。分渠道/风格/元素勾选标签后，可直接「添加」或「移除」；「清空」将清空所选图片的全部三类标签。";
      document.getElementById("tag-modal").classList.remove("hidden");
    }).catch(() => sbToast("读取标签失败", false));
  }
  function closeTagModal() {
    const m = document.getElementById("tag-modal");
    if (m) m.classList.add("hidden");
  }
  function checkedTags() {
    return [...document.querySelectorAll("#tag-modal-groups input:checked")].map(i => ({
      value: i.value, field: i.dataset.field
    }));
  }
  // remove=true 表示移除勾选标签，否则为添加（合并保留原有）
  async function applyTags(remove = false) {
    const tags = checkedTags();
    if (!tags.length) { sbToast("请先勾选至少一个标签", false); return; }
    let allImgs = [];
    try { allImgs = await SB.listImages(null); } catch (e) { sbToast("读取图片失败", false); return; }
    const targets = allImgs.filter(i => selectedImages.has(i.id));
    if (!targets.length) { sbToast("未找到对应图片记录", false); return; }

    // 按字段分组待处理标签（渠道/风格/元素 各列独立更新）
    const byField = {};
    tags.forEach(t => { (byField[t.field] = byField[t.field] || []).push(t.value); });

    closeTagModal();
    sbToast("正在打标…");
    let ok = 0, fail = 0;
    for (const img of targets) {
      let failed = false;
      for (const field of Object.keys(byField)) {
        const vals = byField[field];
        const cur = Array.isArray(img[field]) ? img[field] : [];
        let next;
        if (remove) next = cur.filter(t => !vals.includes(t));
        else next = [...new Set(cur.concat(vals))];
        try { await SB.updateImageField(img.id, field, next); ok++; }
        catch (e) { failed = true; }
      }
      if (failed) fail++;
    }
    sbToast((remove ? "移除标签" : "打标") + "完成：成功 " + ok + "，失败 " + fail);
    await loadManage();
  }
  async function clearTags() {
    if (!selectedImages.size) return;
    if (!confirm("确认清空选中的 " + selectedImages.size + " 张图片的 渠道/风格/元素/场景/拍摄方式/肤色 全部标签？")) return;
    closeTagModal();
    try {
      await SB.clearImageFields([...selectedImages], ["tags", "style_tags", "element_tags", "scene_tags", "shoot_tags", "skin_tags"]);
      sbToast("已清空所选图片标签");
    } catch (e) {
      sbToast("清空失败：" + (e.message || ""), false);
    }
    await loadManage();
  }

  // ================= 标签维度「前台展示」开关 =================
  let dimSwitches = {};
  const DIM_META = [
    { key: "channel", label: "渠道" },
    { key: "style", label: "风格" },
    { key: "element", label: "元素" },
    { key: "scene", label: "场景" },
    { key: "shoot", label: "拍摄方式" },
    { key: "skin", label: "肤色" }
  ];
  async function loadFrontendDims() {
    try { dimSwitches = await SB.getFrontendDims(); } catch (e) { dimSwitches = {}; }
    renderFrontendDims();
  }
  function renderFrontendDims() {
    const box = document.getElementById("frontend-dim-switches");
    if (!box) return;
    box.innerHTML = "";
    DIM_META.forEach(d => {
      const on = dimSwitches[d.key] !== false;
      const row = document.createElement("div");
      row.className = "fds-row" + (on ? " on" : "");
      row.innerHTML = `<span class="fds-name">${d.label}</span><span class="fds-switch${on ? " on" : ""}"><i></i></span><span class="fds-state">${on ? "展示" : "隐藏"}</span>`;
      row.onclick = async () => {
        const next = !(dimSwitches[d.key] !== false);
        dimSwitches[d.key] = next;
        renderFrontendDims();
        try { await SB.setFrontendDim(d.key, next); sbToast(`已${next ? "开启" : "关闭"}「${d.label}」前台展示`); }
        catch (e) { sbToast("保存失败：" + (e.message || ""), false); }
      };
      box.appendChild(row);
    });
  }

  // ================= 标签管理（风格/元素自定义增删） =================
  async function loadTagDefs() {
    await loadFrontendDims();   // 读取标签维度前台展示开关
    let defs = [];
    try { defs = await SB.listTagDefs(); } catch (e) { sbToast("读取标签失败", false); }
    const usage = {};
    try {
      const imgs = await SB.listImages(null);
      imgs.forEach(i => {
        (i.style_tags || []).forEach(t => usage["style:" + t] = (usage["style:" + t] || 0) + 1);
        (i.element_tags || []).forEach(t => usage["element:" + t] = (usage["element:" + t] || 0) + 1);
        (i.scene_tags || []).forEach(t => usage["scene:" + t] = (usage["scene:" + t] || 0) + 1);
        (i.shoot_tags || []).forEach(t => usage["shoot:" + t] = (usage["shoot:" + t] || 0) + 1);
        (i.skin_tags || []).forEach(t => usage["skin:" + t] = (usage["skin:" + t] || 0) + 1);
      });
    } catch (e) { /* 忽略用量统计失败 */ }
    renderTagDefs("style", defs.filter(d => d.type === "style"), usage);
    renderTagDefs("element", defs.filter(d => d.type === "element"), usage);
    renderTagDefs("scene", defs.filter(d => d.type === "scene"), usage);
    renderTagDefs("shoot", defs.filter(d => d.type === "shoot"), usage);
    renderTagDefs("skin", defs.filter(d => d.type === "skin"), usage);
  }
  function renderTagDefs(type, list, usage) {
    const box = document.getElementById(type + "-tag-list");
    if (!box) return;
    box.innerHTML = "";
    if (!list.length) {
      box.innerHTML = `<p class="hint">暂无${type === "style" ? "风格" : (type === "element" ? "元素" : (type === "scene" ? "场景" : (type === "shoot" ? "拍摄方式" : "肤色")))}标签，可在下方新增。</p>`;
      return;
    }
    if (type === "scene") {
      // 场景标签按「室内/室外」二级分组展示（group 字段为真实分组依据，不靠命名解析）
      const meta = [{ key: "indoor", label: "室内" }, { key: "outdoor", label: "室外" }];
      meta.forEach(m => {
        const subs = list.filter(d => (d.group || "") === m.key);
        if (subs.length) {
          const sub = document.createElement("div");
          sub.className = "tagdef-subgroup";
          const t = document.createElement("span");
          t.className = "tagdef-subgroup-name";
          t.textContent = m.label;
          sub.appendChild(t);
          subs.forEach(d => sub.appendChild(makeTagdefChip(d, type, usage)));
          box.appendChild(sub);
        }
      });
      // 未带 group 的存量场景标签兜底展示（若有）
      list.filter(d => (d.group || "") !== "indoor" && (d.group || "") !== "outdoor").forEach(d => box.appendChild(makeTagdefChip(d, type, usage)));
      return;
    }
    list.forEach(d => box.appendChild(makeTagdefChip(d, type, usage)));
  }
  function makeTagdefChip(d, type, usage) {
    const chip = document.createElement("span");
    chip.className = "tagdef-chip";
    const used = usage[type + ":" + d.name] || 0;
    const disp = type === "scene" ? (d.name.split("·")[1] || d.name) : d.name;
    chip.innerHTML = `<span class="tagdef-name" title="${escAttr(d.name)}">${escHtml(disp)}</span><span class="tagdef-used">${used}张</span><button class="tagdef-edit" title="重命名标签并同步图片">✎</button><button class="tagdef-del" title="删除该标签（同时移除图片上的该标签）">×</button>`;
    chip.querySelector(".tagdef-del").onclick = () => deleteTagDef(d, type, used);
    chip.querySelector(".tagdef-edit").onclick = () => renameTagDef(d, type, used);
    return chip;
  }
  async function renameTagDef(d, type, used) {
    const disp = type === "scene" ? (d.name.split("·")[1] || d.name) : d.name;
    const cur = disp;
    let group = (d.group === "indoor" || d.group === "outdoor") ? d.group : null;
    if (type === "scene") {
      const g = confirm("请选择新分组：确定 = 室内；取消 = 室外");
      // confirm 只能二选一，改用 prompt 更直观
    }
    let newName = "";
    if (type === "scene") {
      const g = prompt("【" + cur + "】\n请输入新场景名（不含前缀）：", cur);
      if (g === null) return;
      newName = String(g).trim();
      if (!newName) { sbToast("名称不能为空", false); return; }
      const g2 = (d.group === "indoor" || d.group === "outdoor") ? d.group : null;
      // 若无分组用前缀推断
      let grp = g2 || (d.name.indexOf("室外") === 0 ? "outdoor" : "indoor");
      newName = (grp === "outdoor" ? "室外·" : "室内·") + newName.replace(/^(室内|室外)·/, "");
      try {
        await SB.updateTagDef(d.id, newName, grp);
        if (used > 0) await SB.renameTagDefAndImages(type, d.name, newName);
        sbToast("已重命名：" + newName);
        await loadTagDefs();
      } catch (e) { sbToast("重命名失败：" + (e.message || ""), false); }
      return;
    }
    newName = prompt("【" + cur + "】\n请输入新名称：", cur);
    if (newName === null) return;
    newName = String(newName).trim();
    if (!newName) { sbToast("名称不能为空", false); return; }
    try {
      await SB.updateTagDef(d.id, newName);
      if (used > 0) await SB.renameTagDefAndImages(type, d.name, newName);
      sbToast("已重命名：" + newName);
      await loadTagDefs();
    } catch (e) { sbToast("重命名失败：" + (e.message || ""), false); }
  }
  function bindTagDefs() {
    const setup = (addBtnId, inputId, type, groupId) => {
      document.getElementById(addBtnId).onclick = () => addTagDef(type, document.getElementById(inputId), groupId ? document.getElementById(groupId) : null);
      document.getElementById(inputId).addEventListener("keydown", (e) => {
        if (e.key === "Enter") addTagDef(type, document.getElementById(inputId), groupId ? document.getElementById(groupId) : null);
      });
    };
    setup("style-tag-add", "style-tag-new", "style");
    setup("element-tag-add", "element-tag-new", "element");
    setup("scene-tag-add", "scene-tag-new", "scene", "scene-group-new");
    setup("shoot-tag-add", "shoot-tag-new", "shoot");
    setup("skin-tag-add", "skin-tag-new", "skin");
    // 标签搜索：输入时按名称过滤所有维度的标签（空白则全部显示）
    const search = document.getElementById("tag-search-input");
    if (search) {
      search.addEventListener("input", () => {
        const q = (search.value || "").trim().toLowerCase();
        let hit = 0;
        ["style", "element", "scene", "shoot", "skin"].forEach(type => {
          const box = document.getElementById(type + "-tag-list");
          if (!box) return;
          box.querySelectorAll(".tagdef-chip").forEach(chip => {
            const nm = (chip.querySelector(".tagdef-name") || {}).textContent || "";
            const show = !q || nm.toLowerCase().includes(q) || nm.includes(search.value.trim());
            chip.style.display = show ? "" : "none";
            if (show) hit++;
          });
        });
        const res = document.getElementById("tag-search-res");
        if (res) res.textContent = q ? ("匹配 " + hit + " 个标签") : "";
      });
    }
  }
  async function addTagDef(type, input, groupSelect) {
    const name = (input.value || "").trim();
    if (!name) { sbToast("请输入标签名", false); return; }
    let group;
    if (type === "scene") {
      group = (groupSelect && groupSelect.value) || "indoor";
    }
    try {
      // 场景标签自动归类到室内/室外二级分组；name 存带前缀形式以兼容图片/筛选
      const suffix = name.indexOf("·") > 0 ? name : name;
      const fullName = type === "scene" ? (group === "outdoor" ? "室外·" : "室内·") + suffix.replace(/^(室内|室外)·/, "") : suffix;
      await SB.addTagDef(type, fullName, group);
      input.value = "";
      sbToast("已添加标签：" + fullName + (type === "scene" ? "（" + (group === "indoor" ? "室内" : "室外") + "）" : ""));
      await loadTagDefs();
    } catch (e) { sbToast("添加失败：" + (e.message || ""), false); }
  }
  async function deleteTagDef(def, type, used) {
    const tname = def.name;
    if (!confirm("确认删除「" + tname + "」" + (used > 0 ? "？该标签当前被 " + used + " 张图片使用，将一并移除。" : "？"))) return;
    try {
      if (used > 0) {
        const FIELD_FOR_DEF = { style: "style_tags", element: "element_tags", scene: "scene_tags", shoot: "shoot_tags", skin: "skin_tags" };
        const field = FIELD_FOR_DEF[type];
        if (field) {
          const imgs = await SB.listImages(null);
          let n = 0;
          for (const img of imgs) {
            if (!Array.isArray(img[field]) || !img[field].includes(tname)) continue;
            await SB.updateImageField(img.id, field, img[field].filter(t => t !== tname));
            n++;
          }
        }
      }
      await SB.deleteTagDef(def.id);
      sbToast("已删除标签：" + tname);
      await loadTagDefs();
    } catch (e) { sbToast("删除失败：" + (e.message || ""), false); }
  }

  // ================= 数据看板（各类标签统计） =================
  function bindDashboard() {
    $("#dash-refresh").onclick = () => loadDashboard();
    const sel = document.getElementById("dash-cat-filter");
    if (sel) sel.onchange = () => loadDashboard();
  }
  function buildDashCatFilter(imgs) {
    const sel = document.getElementById("dash-cat-filter");
    if (!sel) return;
    const cur = sel.value;
    const cats = [...new Set((imgs || []).map(i => i.category))].filter(Boolean).sort((a, b) => a.localeCompare(b, "zh"));
    if (!cats.length) { sel.innerHTML = '<option value="">全部类目</option>'; return; }
    sel.innerHTML = '<option value="">全部类目</option>' + cats.map(c => `<option value="${escAttr(c)}">${escHtml(c)}</option>`).join("");
    if (cur && cats.includes(cur)) sel.value = cur; else sel.value = "";
  }
  async function loadDashboard() {
    const meta = $("#dash-meta");
    meta.textContent = "统计中…";
    let imgs = [], defs = [];
    try {
      [imgs, defs] = await Promise.all([SB.listImages(null), SB.listTagDefs()]);
    } catch (e) { meta.textContent = "统计失败，请点击刷新重试"; return; }
    buildDashCatFilter(imgs);
    const sel = document.getElementById("dash-cat-filter");
    const cat = sel && sel.value ? sel.value : "";
    if (cat) imgs = imgs.filter(i => i.category === cat);
    const catLabel = cat || "全部类目";
    meta.textContent = "类目「" + catLabel + "」共 " + imgs.length + " 张图片 · 更新于 " + new Date().toLocaleTimeString("zh-CN", { hour12: false });

    // 总览卡
    const cats = new Set(imgs.map(i => i.category));
    const hasAny = i => ["tags", "style_tags", "element_tags", "scene_tags", "shoot_tags", "skin_tags"].some(f => Array.isArray(i[f]) && i[f].length);
    const tagged = imgs.filter(hasAny).length;
    const ov = $("#dash-overview");
    ov.innerHTML = "";
    [
      { label: "图片总数", value: imgs.length },
      { label: "类目数", value: cats.size },
      { label: "已打标图片", value: tagged },
      { label: "未打标图片", value: imgs.length - tagged }
    ].forEach(x => {
      const c = document.createElement("div");
      c.className = "dash-ov-card";
      c.innerHTML = `<div class="dash-ov-num">${x.value}</div><div class="dash-ov-label">${x.label}</div>`;
      ov.appendChild(c);
    });

    // 标签维度分布条形图
    const charts = [
      { el: "dash-channel", field: "tags", names: (window.CONFIG.CHANNEL_TAGS || []).flatMap(g => g.tags || []), color: "var(--gold)", lab: "渠道" },
      { el: "dash-style", field: "style_tags", names: defs.filter(d => d.type === "style").map(d => d.name), color: "#6ea8fe", lab: "风格" },
      { el: "dash-element", field: "element_tags", names: defs.filter(d => d.type === "element").map(d => d.name), color: "#7ee0a3", lab: "元素" },
      { el: "dash-shoot", field: "shoot_tags", names: defs.filter(d => d.type === "shoot").map(d => d.name), color: "#b89bd6", lab: "拍摄方式" },
      { el: "dash-skin", field: "skin_tags", names: defs.filter(d => d.type === "skin").map(d => d.name), color: "#e6a0a0", lab: "肤色" }
    ];
    charts.forEach(cd => {
      const rows = cd.names.map(n => ({ name: n, count: imgs.filter(i => Array.isArray(i[cd.field]) && i[cd.field].includes(n)).length }));
      rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));
      renderHBars(document.getElementById(cd.el), rows, imgs.length, cd.color, cd.lab);
    });

    // 场景标签：按「室内/室外」两大二级分组统计（分开统计，便于掌握内外场景占比）
    const sceneEl = document.getElementById("dash-scene");
    if (sceneEl) {
      const sceneDefs = defs.filter(d => d.type === "scene");
      const indoorDefs = sceneDefs.filter(d => d.group === "indoor");
      const outdoorDefs = sceneDefs.filter(d => d.group === "outdoor");
      // 未带 group 的存量场景按名称前缀兜底归类
      const norm = (d) => { if (d.group === "indoor" || d.group === "outdoor") return d.group; return d.name.indexOf("室外") === 0 ? "outdoor" : "indoor"; };
      const inD = sceneDefs.filter(d => norm(d) === "indoor");
      const outD = sceneDefs.filter(d => norm(d) === "outdoor");
      const buildRows = (sub) => {
        const rows = sub.map(n => ({ name: n, count: imgs.filter(i => Array.isArray(i.scene_tags) && i.scene_tags.includes(n)).length }));
        rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));
        const tot = rows.reduce((s, r) => s + r.count, 0);
        return { rows, tot };
      };
      const inR = buildRows(inD.map(n => n.name));
      const outR = buildRows(outD.map(n => n.name));
      const p = document.createElement("div");
      p.className = "hbar-grouped";
      function sec(label, r) {
        const s = document.createElement("div");
        s.className = "hbar-group";
        const h = document.createElement("div");
        h.className = "hbar-group-head";
        h.textContent = label + "（" + r.tot + " 张 · 占已打场景 " + (r.tot + inR.tot + outR.tot ? Math.round(r.tot * 100 / (inR.tot + outR.tot)) + "%" : "0%") + "）";
        s.appendChild(h);
        const w = document.createElement("div");
        s.appendChild(w);
        r.rows.forEach(row => {
          const bar = document.createElement("div");
          bar.className = "hbar";
          bar.innerHTML = `<span class="hbar-name">${escHtml(row.name.split("·")[1] || row.name)}</span><span class="hbar-track"><span class="hbar-fill" style="width:${imgs.length ? Math.round(row.count * 100 / imgs.length) : 0}%"></span></span><span class="hbar-num">${row.count}</span>`;
          w.appendChild(bar);
        });
        return s;
      }
      p.appendChild(sec("室内", inR));
      p.appendChild(sec("室外", outR));
      sceneEl.innerHTML = "";
      if (!sceneDefs.length) { sceneEl.innerHTML = `<p class="hint">暂无场景标签</p>`; }
      else sceneEl.appendChild(p);
    }

    // 打标覆盖率环形图
    const rate = imgs.length ? tagged / imgs.length : 0;
    const deg = Math.round(rate * 360 * 10) / 10;
    const donut = $("#dash-donut");
    donut.innerHTML = `<div class="donut" style="background:conic-gradient(var(--gold) 0 ${deg}deg, rgba(255,255,255,.08) ${deg}deg 360deg)"><div class="donut-hole"><b>${(rate * 100).toFixed(1)}%</b><span>打标覆盖率</span></div></div>`;

    // 招品回品专区统计
    let rtasks = [], rsubs = [];
    try { [rtasks, rsubs] = await Promise.all([SB.listRecruitTasks(), SB.listAllRecruitSubmissions().catch(() => [])]); } catch (e) {}
    const rstat = (t) => {
      const hasSubs = rsubs.some(s => s.recruit_task_id === t.id);
      if (t.bound) return "bound";
      if (t.status === "published" && hasSubs) return "submitted";
      if (t.status === "published") return "published";
      return "draft";
    };
    const rc = { draft: 0, published: 0, submitted: 0, bound: 0 };
    rtasks.forEach(t => { rc[rstat(t)]++; });
    const ro = $("#dash-recruit-overview");
    if (ro) {
      ro.innerHTML = "";
      [
        { label: "招品任务", value: rtasks.length },
        { label: "已发布", value: rc.published + rc.submitted + rc.bound },
        { label: "用户已上传SPU", value: rc.submitted },
        { label: "已绑定(处理)", value: rc.bound },
        { label: "商家提交记录", value: rsubs.length }
      ].forEach(x => {
        const c = document.createElement("div");
        c.className = "dash-ov-card";
        c.innerHTML = `<div class="dash-ov-num">${x.value}</div><div class="dash-ov-label">${x.label}</div>`;
        ro.appendChild(c);
      });
    }
    const rrows = [
      { name: "已绑定", count: rc.bound },
      { name: "已上传SPU", count: rc.submitted },
      { name: "已发布", count: rc.published },
      { name: "未发布(草稿)", count: rc.draft }
    ];
    renderHBars(document.getElementById("dash-recruit-status"), rrows, rtasks.length, "#d9a849", "招品状态");
  }
  function renderHBars(el, rows, total, color, label) {
    if (!el) return;
    el.innerHTML = "";
    if (!rows.length) { el.innerHTML = `<p class="hint">暂无「${label}」标签数据</p>`; return; }
    const max = Math.max(1, ...rows.map(r => r.count));
    rows.forEach(r => {
      const pct = total ? (r.count / total * 100).toFixed(1) : "0.0";
      const row = document.createElement("div");
      row.className = "hbar";
      row.innerHTML = `
        <div class="hbar-name" title="${escAttr(r.name)}">${escHtml(r.name)}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(r.count / max * 100)}%;background:${color}"></div></div>
        <div class="hbar-num"><b>${r.count}</b><i>覆盖率 ${pct}%</i></div>`;
      el.appendChild(row);
    });
  }

  // 全选 / 取消全选（仅当前网格显示的）
  function toggleSelectAll() {
    const rows = [...document.querySelectorAll("#manage-grid .mgr-selrow")];
    const allOn = rows.every(b => b.classList.contains("on"));
    rows.forEach(b => {
      const id = b.dataset.id;
      const cell = b.closest(".cell");
      if (!allOn) { selectedImages.add(id); b.classList.add("on"); b.textContent = "已选中"; cell.classList.add("selected"); }
      else { selectedImages.delete(id); b.classList.remove("on"); b.textContent = "选中此行"; cell.classList.remove("selected"); }
    });
    updateBatchBtn();
  }

  // 批量删除
  async function batchDelete() {
    if (!selectedImages.size) return;
    if (!confirm("确认删除选中的 " + selectedImages.size + " 张图片？此操作不可恢复。")) return;
    // 拿当前网格对应的完整图片记录
    let allImgs = [];
    try { allImgs = await SB.listImages(null); } catch (e) {}
    const targets = allImgs.filter(i => selectedImages.has(i.id));
    if (!targets.length) { sbToast("未找到对应图片记录", false); return; }

    $("#batch-del-btn").disabled = true;
    let ok = 0, fail = 0;
    for (const img of targets) {
      try {
        if (img.path) await SB.deleteImage(img.path);
        await SB.removeImageRecord(img.id);
        ok++;
      } catch (e) { fail++; }
    }
    sbToast("批量删除完成：成功 " + ok + "，失败 " + fail);
    selectedImages = new Set();
    updateBatchBtn();
    // 删除可能影响类目，刷新整套（各步独立容错，确保网格必定重绘）
    await refreshAfterImageChange();
  }

  // 图片增删后统一刷新：类目/常用类目/标签管理/图片网格，各步独立容错，确保网格必定重绘
  async function refreshAfterImageChange() {
    const steps = [loadCats, loadCatMgmt, loadFavCats, loadManage];
    for (const fn of steps) {
      try { await fn(); } catch (e) { console.warn("refresh 跳过:", fn.name, e); }
    }
  }

  // 单个删除
  async function removeImage(img) {
    if (!confirm("确认删除该图片？")) return;
    try {
      if (img.path) await SB.deleteImage(img.path);
      await SB.removeImageRecord(img.id);
      selectedImages.delete(img.id);
      sbToast("已删除");
      // 删除后刷新类目与网格（各步独立容错，确保网格必定重绘）
      await refreshAfterImageChange();
    } catch (e) { sbToast("删除失败，请重试", false); }
  }

  // ================= 工具 =================
  function escHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function escAttr(s) { return escHtml(s); }

  // ================= 提示 =================
  function sbToast(msg, ok = true) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.style.background = ok ? "rgba(34,47,38,.92)" : "rgba(120,40,38,.92)";
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

// ================= 智能打标（拖拽池：左=已打，右=未打） =================
  let smartDim = "style";          // 当前维度: style / element / channel
  let smartTag = "";               // 当前选中标签
  let smartAll = [];               // 全量图片缓存
  let smartDragging = null;        // 正在拖拽的图片对象
  let smartToken = "";             // 智能打标取图鉴权令牌
  const smartFieldMap = { style: "style_tags", element: "element_tags", channel: "tags", scene: "scene_tags", shoot: "shoot_tags", skin: "skin_tags", category: "category" };
  // 单值维度（类目 category 是字符串，其余是数组）
  const smartSingleDim = { category: true };
  // 逻辑单值维度：数组存储但每张图该维度只允许一个标签（打新替换旧）。
  // 区别于 category（字符串字段）：这些仍是数组字段，仅"选中某标签时排除已打其它标签的图 + 写入替换"。
  const smartUniqueFields = new Set(["style_tags", "tags", "scene_tags", "shoot_tags", "skin_tags"]);
  const smartAlbumPreview = {};   // 每个图册标签显示的最新拖入图片（tag -> img 对象）

  function openSmartModal() {
    if (!document.querySelector("#smart-modal")) return;
    document.querySelector("#smart-modal").classList.remove("hidden");
    smartDim = "style"; smartTag = "";
    renderSmartDims();
    fillSmartCat();
    Promise.resolve().then(loadSmartAll);
  }
  function closeSmartModal() {
    const m = document.querySelector("#smart-modal");
    if (m) m.classList.add("hidden");
  }
  function renderSmartDims() {
    const box = document.querySelector("#smart-dims");
    if (!box) return;
    const dims = [
      { key: "category", label: "类目" },
      { key: "style", label: "风格" },
      { key: "element", label: "元素" },
      { key: "channel", label: "渠道" },
      { key: "scene", label: "场景" },
      { key: "shoot", label: "拍摄方式" },
      { key: "skin", label: "肤色" }
    ];
    box.innerHTML = "";
    dims.forEach(d => {
      const b = document.createElement("button");
      b.className = "smart-dim" + (d.key === smartDim ? " active" : "");
      b.textContent = d.label;
      b.onclick = async () => {
        smartDim = d.key; smartTag = ""; smartAll = [];
        renderSmartDims();
        renderSmartTags([]);
        await renderSmartPools();
        await loadSmartAll();
      };
      box.appendChild(b);
    });
  }
  async function loadSmartAll() {
    try { smartToken = await SB.currentToken(); } catch (e) { smartToken = ""; }
    try { smartAll = await SB.listImages(null); }
    catch (e) { sbToast("读取图片失败", false); return; }
    // 渲染该维度的标签选择条（类目用 categories 表；渠道用固定清单；其余用 tag_defs）
    if (smartDim === "category") {
      try {
        const cats = await SB.listActiveCats();
        const list = (cats || []).map(c => c.name);
        renderSmartTags([...new Set(list)]);
      } catch (e) { renderSmartTags([]); }
      await renderSmartPools();
      return;
    }
    if (smartDim === "channel") {
      const list = (window.CONFIG.CHANNEL_TAGS || []).flatMap(g => g.tags || []);
      renderSmartTags([...new Set(list)]);
      await renderSmartPools(); // 未选具体标签时，按"是否已打该维度标"自动分池
      return;
    }
    try {
      const defs = await SB.listTagDefs();
      // 记录场景标签的室内/室外分组（供图册栏分组显示）
      if (smartDim === "scene") {
        Object.keys(smartSceneGroup).forEach(k => delete smartSceneGroup[k]);
        (defs || []).forEach(d => { if (d.type === "scene") smartSceneGroup[d.name] = d.group || (d.name.indexOf("室外") >= 0 ? "outdoor" : "indoor"); });
      } else {
        Object.keys(smartSceneGroup).forEach(k => delete smartSceneGroup[k]);
      }
      const list = (defs || []).filter(d => d.type === smartDim).map(d => d.name);
      renderSmartTags([...new Set(list)]);
      await renderSmartPools(); // 未选具体标签时，按"是否已打该维度标"自动分池
    } catch (e) { renderSmartTags([]); sbToast("读取标签失败", false); }
  }
  let smartTagsCache = [];                          // 当前维度标签清单缓存（供图册栏复用）
  const smartSceneGroup = {};                       // 场景标签 -> 分组（indoor/outdoor），供图册栏按室内/室外分组
  function renderSmartTags(list) {
    smartTagsCache = Array.isArray(list) ? list.slice() : [];
    const box = document.querySelector("#smart-tags");
    if (!box) return;
    box.innerHTML = "";
    if (!list.length) {
      const t = document.createElement("span");
      t.className = "smart-tag-empty";
      t.textContent = smartDim === "channel"
        ? "暂无渠道标签（请在 config.js 维护 CHANNEL_TAGS）"
        : "暂无" + ({ category: "类目", style: "风格", element: "元素", scene: "场景", shoot: "拍摄方式", skin: "肤色" }[smartDim] || "") + "标签，请到「标签管理」新增";
      box.appendChild(t);
      return;
    }
    list.forEach(tag => {
      const b = document.createElement("button");
      b.className = "smart-tag" + (tag === smartTag ? " active" : "");
      b.textContent = tag;
      b.onclick = async () => {
        smartTag = tag;
        renderSmartTags(list);
        await renderSmartPools();
      };
      box.appendChild(b);
    });
  }
  // 判断某图在某维度是否含指定标签（tag 为空串则只判断"该维度是否已打标"；单值维度=category 用字符串判断）
  function smartHas(img, field, tag) {
    const single = smartSingleDim[field];
    if (single) {
      const v = img[field];
      return tag ? (v === tag) : !!v;
    }
    const arr = Array.isArray(img[field]) ? img[field] : [];
    return tag ? arr.includes(tag) : arr.length > 0;
  }
  // 逻辑单值维度：判断该图在此维度是否已打任意标签（数组非空）
  function smartHasAny(img, field) {
    const v = img[field];
    if (Array.isArray(v)) return v.length > 0;
    return !!(v && String(v).trim());
  }
  // 用指向弹窗滚动容器的懒加载渲染一个池子，避免一次性加载上百张
  // 智能打标取图地址（带令牌）
  function smartImgUrl(img, tok) {
    const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
    return base + "/" + img.path + (tok ? "?token=" + encodeURIComponent(tok) : "");
  }
  // 按容器宽度计算列数（行内卡片 + 行末按钮均分）
  function smartCols(gridEl, cardW, gap) {
    if (!gridEl) return 4;
    const pad = 20;                 // 容器左右 padding 合计
    const btnW = 34;                // 行末按钮预留宽（含间距）
    const avail = (gridEl.clientWidth || 640) - pad - btnW;
    return Math.max(1, Math.floor((avail + gap) / (cardW + gap)));
  }
  // 池子按行渲染：每行若干卡片 + 行末「全选本行」按钮（右侧池在最右侧）
  function smartRenderRows(container, list, isDone, smartToken) {
    if (!container || !list.length) return;
    container.innerHTML = "";
    const gap = 10, cardW = 150, btnW = 34;
    const cols = smartCols(container, cardW, gap);
    const pad = 20;
    const avail = (container.clientWidth || 640) - pad;
    const cardPx = Math.max(140, Math.floor((avail - gap * (cols - 1) - btnW) / cols));
    for (let i = 0; i < list.length; i += cols) {
      const row = document.createElement("div");
      row.className = "smart-row";
      const chunk = list.slice(i, i + cols);
      chunk.forEach(img => {
        const c = makeSmartCard(img, isDone, smartToken);
        c.style.width = cardPx + "px";
        row.appendChild(c);
      });
      const b = document.createElement("button");
      b.className = "smart-row-sel";
      b.type = "button";
      b.textContent = isDone ? "全选本行去标" : "全选本行打标";
      b.title = "选中这一行的所有图片";
      b.onclick = (e) => { e.stopPropagation(); smartSelectRow(chunk.map(x => x.id), isDone); };
      row.appendChild(b);
      container.appendChild(row);
    }
  }
  function renderSmartGrid(gridEl, list, isDone, smartToken) {
    if (!gridEl || !list.length) return;
    smartRenderRows(gridEl, list, isDone, smartToken);
  }
// 全选某一行：batch 打标(toDone=true)或去标(false)，带二次确认
  async function smartSelectRow(ids, toDone) {
    if (!smartTag) { sbToast("请先选择一个具体标签，再全选本行", false); return; }
    if (!ids.length) return;
    const field = smartFieldMap[smartDim];
    const single = smartSingleDim[field];
    const action = single
      ? (toDone ? "打上「" + smartTag + "」类目" : "清空「" + smartTag + "」类目")
      : (toDone ? "打上「" + smartTag + "」标签" : "移除「" + smartTag + "」标签");
    if (!confirm("确认要对本行 " + ids.length + " 张图片批量" + action + "？")) return;
    let ok = 0, fail = 0;
    for (const id of ids) {
      const img = smartAll.find(i => i.id === id);
      if (!img) continue;
      try {
        if (single) {
          await SB.setImageSingleField(id, field, toDone ? smartTag : "");
          img[field] = toDone ? smartTag : "";
        } else {
          const cur = Array.isArray(img[field]) ? img[field] : [];
          const next = (toDone && smartUniqueFields.has(field)) ? [smartTag] : (toDone ? [...new Set(cur.concat([smartTag]))] : cur.filter(t => t !== smartTag));
          await SB.updateImageField(id, field, next);
          img[field] = next;
        }
        ok++;
      } catch (e) { fail++; }
    }
    sbToast("本行已" + action + "，" + ok + " 张成功" + (fail ? "，失败 " + fail + " 张" : ""));
    await renderSmartPools();
  }

  async function renderSmartPools() {
    let smartToken = "";
    try { smartToken = await SB.currentToken(); } catch (e) { smartToken = ""; }
    const doneGrid = document.querySelector("#smart-grid-done");
    const undoneGrid = document.querySelector("#smart-grid-undone");
    if (!doneGrid || !undoneGrid) return;
    doneGrid.innerHTML = "";
    undoneGrid.innerHTML = "";
    document.querySelector("#smart-cnt-done").textContent = "0";
    document.querySelector("#smart-cnt-undone").textContent = "0";
    if (!smartAll.length) return;
    const field = smartFieldMap[smartDim];

    // 池标题：已选具体标签→按"是否含该标签"；未选标签→按"该维度是否已打标"
    const doneHead = document.querySelector("#smart-pool-done .smart-pool-head");
    const undoneHead = document.querySelector("#smart-pool-undone .smart-pool-head");
    const finishHead = (el, label, cnt) => {
      if (!el) return;
      el.childNodes[0].nodeValue = label;
      const c = el.querySelector(".sp-count");
      if (c) c.textContent = cnt;
    };

    if (smartTag) {
      const doneList = [], undoneList = [];
      smartAll.forEach(img => {
        const has = smartHas(img, field, smartTag);
        if (has) { doneList.push(img); return; }
        // 对逻辑单值维度：该图已打下同维度其它标签 → 视为"该维度已占用"，
        // 不再出现在"未打当前标签"池中，避免被重复打标。
        if (smartUniqueFields.has(field) && smartHasAny(img, field)) return;
        undoneList.push(img);
      });
      finishHead(doneHead, "已打该标签 ", doneList.length);
      finishHead(undoneHead, "未打该标签 ", undoneList.length);
      renderSmartGrid(doneGrid, doneList, true, smartToken);
      renderSmartGrid(undoneGrid, undoneList, false, smartToken);
    } else {
      // 未选具体标签：自动聚焦"该维度还没打任何标"的图片
      const doneList = [], undoneList = [];
      const dimLabel = ({ category: "类目", style: "风格", element: "元素", channel: "渠道", scene: "场景", shoot: "拍摄方式", skin: "肤色" }[smartDim] || "该维度");
      smartAll.forEach(img => {
        const has = smartHas(img, field, "");
        (has ? doneList : undoneList).push(img);
      });
      finishHead(doneHead, "已打" + dimLabel + " ", doneList.length);
      finishHead(undoneHead, "未打" + dimLabel + " ", undoneList.length);
      doneList.forEach(img => doneGrid.appendChild(makeSmartCard(img, true, smartToken)));
      undoneList.forEach(img => undoneGrid.appendChild(makeSmartCard(img, false, smartToken)));
    }
    // 兜底：错峰补载未成功显示的图片（避免一次性并发过高导致部分灰块）
    setTimeout(() => {
      [doneGrid, undoneGrid].forEach(grid => {
        if (!grid) return;
        grid.querySelectorAll(".smart-card .holder img:not(.loaded)").forEach(im => {
          im.dispatchEvent(new Event("error"));
        });
      });
    }, 500);
    renderSmartUploadEntry();      // 右池首位：上传入口卡 + 待传缩略图卡
    renderSmartAlbums();
  }
  function makeSmartCard(img, isDone, smartToken) {
    const card = document.createElement("div");
    card.className = "smart-card";
    card.draggable = true;
    card.dataset.id = img.id;
    const wrap = document.createElement("div");
    wrap.className = "holder";
    const im = document.createElement("img");
    // 与图片管理完全一致的取图方式：渲染前一次性拿好令牌，只设 dataset.src，进入视口懒加载
    const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
    const makeSrc = (tok) => (base + "/" + img.path + (tok ? "?token=" + encodeURIComponent(tok) : ""));
    im.alt = img.name || "";
    im.loading = "eager";
    im.draggable = false;
    im.addEventListener("contextmenu", (e) => e.preventDefault());
    // 立即加载：智能打标弹窗内懒加载监听不可靠，改为打开即加载，保证图片显示
    let retried = false;
    const doLoad = (tok) => {
      im.src = makeSrc(tok);
      im.onload = () => { im.classList.add("loaded"); retried = false; };
      im.onerror = () => { im.classList.remove("loaded"); };
    };
    doLoad(smartToken);
    // 无论是否已带令牌，加载失败都重取一次最新令牌重试（处理令牌过期/失效）
    im.addEventListener("error", () => {
      if (retried) return;
      retried = true;
      SB.currentToken().then((t) => { if (t) doLoad(t); }).catch(() => {});
    });
    wrap.appendChild(im);
    card.appendChild(wrap);

    // 标签浮层：叠加显示在图片上（前台式），只展示有值的维度标签
    const cap = document.createElement("div");
    cap.className = "smart-card-tags";
    const dims = [
      ["类目", "cat", img.category ? [img.category] : []],
      ["渠道", "ch", (Array.isArray(img.tags) ? img.tags : []).concat(!Array.isArray(img.tags) && img.tags ? [img.tags] : [])],
      ["风格", "st", img.style_tags],
      ["元素", "el", img.element_tags],
      ["场景", "sc", img.scene_tags],
      ["拍摄", "sh", img.shoot_tags],
      ["肤色", "sk", img.skin_tags]
    ];
    // 像前台一样：每个维度一行（左对齐竖排一列），维度标签 + 标签值
    const rows = [];
    dims.forEach(([lab, cls, arr]) => {
      const v = (Array.isArray(arr) ? arr : []).filter(Boolean);
      if (v.length) rows.push(`<div class="smart-tag-row ${cls}"><b>${lab}</b><span>${escHtml(v.join("、"))}</span></div>`);
    });
    cap.innerHTML = rows.length ? rows.join("") : `<div class="smart-tag-row none"><b>—</b><span>未打标</span></div>`;
    card.appendChild(cap);
      // 双向点击：左池点图=撤标回右池；右池点图=打标到左池（保留拖拽）
    card.addEventListener("click", (e) => {
      if (smartDragging) return;                      // 拖拽中不触发
      e.stopPropagation();
      moveSmart(img.id, !isDone);                     // 左池→撤标(false)，右池→打标(true)
      if (isDone) {
        sbToast("已移除「" + smartTag + "」标签", false);
      } else {
        sbToast("已为图片打上「" + smartTag + "」标签", true);
      }
    });

    // 拖拽
    card.addEventListener("dragstart", (e) => {
      smartDragging = img;
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", img.id); } catch (err) {}
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      smartDragging = null;
    });
    return card;
  }
  function bindSmartDrop() {
    const doneGrid = document.querySelector("#smart-grid-done");
    const undoneGrid = document.querySelector("#smart-grid-undone");
    const albumsEl = document.querySelector("#smart-albums-list");
    if (!doneGrid || !undoneGrid) return;
    const setup = (el, toDone) => {
      el.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; el.classList.add("drop-over"); });
      el.addEventListener("dragleave", () => el.classList.remove("drop-over"));
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        el.classList.remove("drop-over");
        const id = smartDragging ? smartDragging.id : null;
        if (!id) return;
        moveSmart(id, toDone);
      });
    };
    setup(doneGrid, true);
    setup(undoneGrid, false);
    // 图册栏：拖入某个册子=打上该标签（不依赖中间选中标签）
    if (albumsEl) {
      albumsEl.addEventListener("dragover", (e) => {
        const a = e.target.closest(".smart-album");
        if (!a) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        albumsEl.querySelectorAll(".smart-album").forEach(x => x.classList.remove("drop-over"));
        a.classList.add("drop-over");
      });
      albumsEl.addEventListener("dragleave", (e) => {
        const a = e.target.closest(".smart-album");
        if (a) a.classList.remove("drop-over");
      });
      albumsEl.addEventListener("drop", (e) => {
        e.preventDefault();
        albumsEl.querySelectorAll(".smart-album").forEach(x => x.classList.remove("drop-over"));
        const a = e.target.closest(".smart-album");
        if (!a) return;
        const tag = a.dataset.tag;
        if (!tag) return;
        const id = smartDragging ? smartDragging.id : null;
        if (!id) return;
        // 把图片打上该册子标签（自动落到左池该标签下）
        smartTag = tag;
        const draggedImg = smartAll.find(i => i.id === id);
        if (draggedImg) smartAlbumPreview[tag] = draggedImg;   // 图册缩略图显示最新拖入的这张
        moveSmart(id, true);
      });
    }
  }
  // 渲染中间图册栏：当前维度下每个具体标签一个小册子，展示已收录数量
  function renderSmartAlbums() {
    const box = document.querySelector("#smart-albums-list");
    const cntEl = document.querySelector("#smart-album-cnt");
    if (!box) return;
    box.innerHTML = "";
    const lists = (smartTagsCache || []).slice();
    if (!lists.length) {
      if (cntEl) cntEl.textContent = "0";
      box.innerHTML = '<div class="smart-album-name" style="color:var(--sub);font-weight:400;font-size:12px;padding:8px">暂无标签，可到标签管理新增</div>';
      return;
    }
    const field = smartFieldMap[smartDim];
    // 场景维度：按室内/室外分组；其余维度平铺
    let groups = null;
    if (smartDim === "scene") {
      groups = [
        { key: "indoor", label: "室内" },
        { key: "outdoor", label: "室外" },
      ];
    }
    const renderOne = (tag) => {
      let count = 0;
      smartAll.forEach(img => { if (smartHas(img, field, tag)) count++; });
      const a = document.createElement("div");
      a.className = "smart-album" + (tag === smartTag ? " active" : "") + (count === 0 ? " empty" : "");
      a.dataset.tag = tag;
      const thumbWrap = document.createElement("div");
      thumbWrap.className = "smart-album-thumb";
      const pv = smartAlbumPreview[tag] || smartAll.find(img => smartHas(img, field, tag)) || null;
      if (pv && pv.path) {
        const im = document.createElement("img");
        im.alt = tag;
        im.src = smartImgUrl(pv, smartToken);
        im.addEventListener("error", () => {
          if (smartToken) im.src = smartImgUrl(pv, "");
        });
        thumbWrap.appendChild(im);
      } else {
        const ph = document.createElement("span");
        ph.className = "smart-album-ph";
        ph.textContent = tag;
        thumbWrap.appendChild(ph);
      }
      const body = document.createElement("div");
      body.className = "smart-album-body";
      const name = document.createElement("div");
      name.className = "smart-album-name";
      name.textContent = tag;
      const c = document.createElement("div");
      c.className = "smart-album-count";
      c.textContent = count + " 张";
      body.appendChild(name);
      body.appendChild(c);
      a.appendChild(thumbWrap);
      a.appendChild(body);
      const del = document.createElement("button");
      del.className = "smart-album-del";
      del.type = "button";
      del.title = "删除图册「" + tag + "」（同步到标签管理并移除图片上的该标签）";
      del.textContent = "×";
      del.setAttribute("data-tag", tag);
      del.addEventListener("click", (e) => { e.stopPropagation(); smartDeleteAlbum(tag); });
      a.appendChild(del);
      a.title = "把图片拖进此册子，即打上「" + tag + "」标签";
      a.addEventListener("click", async () => {
        smartTag = tag;
        document.querySelectorAll("#smart-tags .smart-tag").forEach(b => {
          b.classList.toggle("active", b.textContent === tag);
        });
        await renderSmartPools();
      });
      box.appendChild(a);
    };
    if (groups) {
      groups.forEach(g => {
        const members = lists.filter(t => smartSceneGroup[t] === g.key);
        if (!members.length) return;
        const gTitle = document.createElement("div");
        gTitle.className = "smart-album-group";
        gTitle.textContent = g.label;
        box.appendChild(gTitle);
        members.forEach(renderOne);
      });
      // 未归入 indoor/outdoor 的场景标签（无分组）单独展示
      const rest = lists.filter(t => smartSceneGroup[t] !== "indoor" && smartSceneGroup[t] !== "outdoor");
      if (rest.length) {
        const gTitle = document.createElement("div");
        gTitle.className = "smart-album-group";
        gTitle.textContent = "其他";
        box.appendChild(gTitle);
        rest.forEach(renderOne);
      }
    } else {
      lists.forEach(renderOne);
    }
    if (cntEl) cntEl.textContent = lists.length;
  }
// 新增图册（打标时）：在当前维度新增一个标签，并同步写入标签管理（tag_defs）
  async function smartAddAlbum() {
    if (!smartDim) { sbToast("请先选择一个维度（风格/元素/渠道等）", false); return; }
    const dimLabel = { category: "类目", style: "风格", element: "元素", channel: "渠道", scene: "场景", shoot: "拍摄方式", skin: "肤色" }[smartDim] || smartDim;
    if (smartDim === "channel") { sbToast("渠道标签请在 config.js 维护 CHANNEL_TAGS，不支持在此新增", false); return; }
    const name = prompt("请输入新的「" + dimLabel + "」标签名称：");
    if (name === null) return;
    const tag = name.trim();
    if (!tag) { sbToast("标签名称不能为空", false); return; }
    if ((smartTagsCache || []).some(t => t === tag)) { sbToast("标签「" + tag + "」已存在", false); return; }
    // 场景维度需带 indoor/outdoor 分组
    let group = null;
    if (smartDim === "scene") {
      const g = prompt("该场景属于室内还是室外？输入 室内 或 室外（回车留空=不分组）：");
      if (g !== null && g.trim()) {
        const gv = g.trim();
        group = (gv === "室内" || gv === "indoor") ? "indoor" : (gv === "室外" || gv === "outdoor") ? "outdoor" : null;
      }
    }
    try {
      await SB.addTagDef(smartDim, tag, group);
      // 本地同步刷新标签缓存
      if (!smartTagsCache) smartTagsCache = [];
      smartTagsCache.push(tag);
      // 场景标签记录分组
      if (smartDim === "scene") smartSceneGroup[tag] = group || (tag.indexOf("室外") >= 0 ? "outdoor" : "indoor");
      // 更新图册栏与标签栏
      renderSmartAlbums();
      const tagBox = document.querySelector("#smart-tags");
      if (tagBox) {
        const b = document.createElement("button");
        b.className = "smart-tag";
        b.textContent = tag;
        b.onclick = async () => {
          smartTag = tag;
          renderSmartTags(smartTagsCache.slice());
          await renderSmartPools();
        };
        tagBox.appendChild(b);
      }
      sbToast("已新增标签「" + tag + "」并同步到标签管理", true);
    } catch (err) {
      sbToast("新增标签失败，请重试", false);
    }
  }

  // 删除图册（打标时）：删除该标签，同步移除图片上的该标签，并同步删除标签管理里的标签
  async function smartDeleteAlbum(tag) {
    if (!tag) return;
    if (!confirm("确认删除图册「" + tag + "」？将同步移除图片上已打的该标签，并从标签管理删除该标签。")) return;
    const field = smartFieldMap[smartDim];
    try {
      // 1. 从数据库删除标签定义（先按 type+name 查出 id）
      let defId = null;
      try {
        const defs = await SB.listTagDefs(smartDim);
        const hit = (defs || []).find(d => d.name === tag);
        if (hit) defId = hit.id;
      } catch (e) { /* 忽略查询失败 */ }
      if (defId) await SB.deleteTagDef(defId);
      // 2. 逐张移除图片上该标签（图片本身保留）
      const affected = smartAll.filter(img => smartHas(img, field, tag));
      if (affected.length) {
        if (smartSingleDim[field]) {
          // 单值维度：清空该字段
          for (const img of affected) { await SB.setImageSingleField(img.id, field, ""); img[field] = ""; }
        } else {
          // 多值维度：从数组移除该标签
          for (const img of affected) {
            const arr = (img[field] || []).filter(x => x !== tag);
            await SB.updateImageField(img.id, field, arr);
            img[field] = arr;
          }
        }
      }
      // 3. 刷新本地缓存
      smartTagsCache = (smartTagsCache || []).filter(t => t !== tag);
      delete smartSceneGroup[tag];
      if (smartTag === tag) { smartTag = ""; }
      renderSmartAlbums();
      const tagBox = document.querySelector("#smart-tags");
      if (tagBox) {
        tagBox.querySelectorAll(".smart-tag").forEach(b => {
          if (b.textContent === tag) b.remove();
        });
      }
      await renderSmartPools();
      sbToast("已删除标签「" + tag + "」并同步到标签管理", true);
    } catch (err) {
      sbToast("删除标签失败，请重试", false);
    }
  }

  async function moveSmart(id, toDone) {
    if (!smartTag) { sbToast("请先在中间选择一个标签", false); return; }
    const field = smartFieldMap[smartDim];
    const img = smartAll.find(i => i.id === id);
    if (!img) return;
    const isSingle = smartSingleDim[field];
    let next;
    if (isSingle) {
      next = toDone ? smartTag : "";
      try {
        await SB.setImageSingleField(img.id, field, next);
        img[field] = next;
        sbToast(toDone ? "已为图片打上「" + smartTag + "」类目" : "已清空该图片类目");
        await renderSmartPools();
      } catch (e) {
        sbToast("操作失败：" + (e.message || ""), false);
      }
      return;
    }
    const cur = Array.isArray(img[field]) ? img[field] : [];
    // 逻辑单值维度（风格/渠道/场景/拍摄/肤色）：打新=替换旧，只保留当前标签
    if (toDone && smartUniqueFields.has(field)) {
      next = [smartTag];
    } else if (toDone) {
      next = [...new Set(cur.concat([smartTag]))];
    } else {
      next = cur.filter(t => t !== smartTag);
    }
    try {
      await SB.updateImageField(img.id, field, next);
      img[field] = next;
      sbToast(toDone ? "已为图片打上「" + smartTag + "」标签" : "已移除「" + smartTag + "」标签");
      // 重新划分两池（保持已选标签高亮）
      await renderSmartPools();
    } catch (e) {
      sbToast("操作失败：" + (e.message || ""), false);
    }
  }
  // 全屏切换（智能打标弹窗）
  function toggleSmartFullscreen() {
    const modal = document.querySelector("#smart-modal");
    const fsBtn = document.querySelector("#smart-fs");
    if (!modal) return;
    const on = modal.classList.toggle("fullscreen");
    if (fsBtn) fsBtn.textContent = on ? "退出全屏" : "全屏";
  }
  // 全选本池：给右池（未打该标签）的全部图片一键打上当前标签
  async function smartSelectAll() {
    if (!smartTag) { sbToast("请先选择一个具体标签，再全选本池", false); return; }
    const field = smartFieldMap[smartDim];
    const undoneGrid = document.querySelector("#smart-grid-undone");
    if (!undoneGrid) return;
    const ids = [...undoneGrid.querySelectorAll(".smart-card")].map(c => c.dataset.id).filter(Boolean);
    if (!ids.length) { sbToast("本池暂无需要打标的图片", false); return; }
    if (!confirm("确认要对本池 " + ids.length + " 张图片批量打上「" + smartTag + "」标签？")) return;
    let ok = 0, fail = 0;
    for (const id of ids) {
      const img = smartAll.find(i => i.id === id);
      if (!img) continue;
      try {
        if (smartSingleDim[field]) {
          await SB.setImageSingleField(id, field, smartTag);
          img[field] = smartTag;
        } else {
          const cur = Array.isArray(img[field]) ? img[field] : [];
          const next = smartUniqueFields.has(field) ? [smartTag] : [...new Set(cur.concat([smartTag]))];
          await SB.updateImageField(id, field, next);
          img[field] = next;
        }
        ok++;
      } catch (e) { fail++; }
    }
    sbToast("已为 " + ok + " 张图片打上「" + smartTag + "」" + (smartSingleDim[field] ? "类目" : "标签") + (fail ? "，失败 " + fail + " 张" : ""));
    await renderSmartPools();
  }
  function bindSmartModal() {
    const openBtn = document.querySelector("#smart-tag-btn");
    if (openBtn) openBtn.addEventListener("click", openSmartModal);
    const closeBtn = document.querySelector("#smart-close");
    if (closeBtn) closeBtn.addEventListener("click", closeSmartModal);
    const fsBtn = document.querySelector("#smart-fs");
    if (fsBtn) fsBtn.addEventListener("click", toggleSmartFullscreen);
    const selAll = document.querySelector("#smart-select-all");
    if (selAll) selAll.addEventListener("click", smartSelectAll);
    const deselAll = document.querySelector("#smart-deselect-all");
    if (deselAll) deselAll.addEventListener("click", smartDeselAll);
    const albumAdd = document.querySelector("#smart-album-add");
    if (albumAdd) albumAdd.addEventListener("click", smartAddAlbum);
    // 从智能打标进入标签管理：关闭弹窗并切到标签管理面板
    const tagMgrBtn = document.querySelector("#smart-tagmgr-btn");
    if (tagMgrBtn) tagMgrBtn.addEventListener("click", () => {
      closeSmartModal();
      switchPanel("tag-card");
    });
    bindSmartUpload();
    bindSmartDrop();
  }
  // ================= 智能打标内上传图片（上传入口=右池首位卡片，待传=缩略图卡，按钮/进度常驻右池头部） =================
  let smartPending = [];           // 待上传文件（含预览）
  let smartUploading = false;      // 是否正在上传
  function bindSmartUpload() {
    const fi = document.querySelector("#smart-file");
    if (fi) fi.onchange = () => { smartAddFiles(fi.files); fi.value = ""; };
    const btn = document.querySelector("#smart-upload-btn");
    if (btn) btn.onclick = doSmartUpload;
  }
  async function fillSmartCat() {
    const sel = document.querySelector("#smart-cat");
    if (!sel) return;
    let cats = [];
    try { cats = await SB.listActiveCats(); } catch (e) {}
    sel.innerHTML = "";
    sel.add(new Option("类目…", ""));
    if (currentFavCats.length) {
      currentFavCats.forEach(c => { if (cats.includes(c)) sel.add(new Option("★ " + c, c)); });
    }
    cats.forEach(c => sel.add(new Option(c, c)));
  }
  // 点「＋」上传入口卡片：打开文件选择
  function smartPick() { const fi = document.querySelector("#smart-file"); if (fi) fi.click(); }
  function smartAddFiles(fileList) {
    const imgs = Array.from(fileList).filter(f => /^image\//.test(f.type));
    if (!imgs.length) { sbToast("请选择图片文件", false); return; }
    imgs.forEach(f => {
      if (smartPending.some(p => p.name === f.name && p.size === f.size)) return;
      const item = { file: f, url: URL.createObjectURL(f) };
      smartPending.push(item);
    });
    smartRenderPending();
  }
  function smartRemovePending(idx) {
    const it = smartPending[idx];
    if (it && it.url) URL.revokeObjectURL(it.url);
    smartPending.splice(idx, 1);
    smartRenderPending();
  }
  function smartRenderPending() {
    const btn = document.querySelector("#smart-upload-btn");
    if (btn) { btn.disabled = smartPending.length === 0; btn.textContent = "上传" + (smartPending.length ? `（${smartPending.length}）` : ""); }
    renderSmartUploadEntry();     // 刷新右池首位的"上传入口 + 待传缩略图"
  }
  // 在右池 grid 首位插入「上传入口卡片 + 待传缩略图卡」
  function renderSmartUploadEntry() {
    const undoneGrid = document.querySelector("#smart-grid-undone");
    if (!undoneGrid) return;
    // 移除旧的上传入口/待传卡（保留真正的图片卡）
    [...undoneGrid.querySelectorAll(".smart-up-entry, .smart-up-thumb")].forEach(n => n.remove());
    // ① 上传入口卡片（占一个图片位）
    const entry = document.createElement("div");
    entry.className = "smart-card smart-up-entry";
    entry.onclick = (e) => { e.stopPropagation(); smartPick(); };
    entry.innerHTML = `<div class="holder up-holder"><div class="up-inner"><span class="up-plus">＋</span><span class="up-txt">上传图片</span><span class="up-sub">点击选文件</span></div></div>`;
    undoneGrid.insertBefore(entry, undoneGrid.firstChild);
    // ② 待传缩略图卡（小图预览，无边框文件标题）
    smartPending.forEach((it, idx) => {
      const t = document.createElement("div");
      t.className = "smart-card smart-up-thumb";
      t.innerHTML = `<div class="holder"><img src="${it.url}" alt=""></div><button class="x" title="移除">×</button>`;
      t.querySelector(".x").onclick = (e) => { e.stopPropagation(); smartRemovePending(idx); };
      undoneGrid.insertBefore(t, entry.nextSibling);
    });
  }
  // 上传并写库：并发限制提速，缩略图预览，成功后刷新池子（新图直接可打标）
  async function doSmartUpload() {
    if (!smartPending.length || smartUploading) return;
    if (currentRole !== "admin") { sbToast("无权限：只有管理员可上传", false); return; }
    let cat = document.querySelector("#smart-cat").value;
    if (!cat) { sbToast("请先选择上传类目", false); return; }
    smartUploading = true;
    const btn = document.querySelector("#smart-upload-btn");
    const prog = document.querySelector("#smart-progress");
    const bar = document.querySelector("#smart-progress-bar");
    if (btn) btn.disabled = true;
    if (prog) prog.classList.remove("hidden");
    const files = smartPending.map(it => it.file);
    const total = files.length;
    let done = 0, failed = 0, dup = 0;
    const setBar = () => { if (bar) bar.style.width = Math.round(done / total * 100) + "%"; };
    setBar();
    let existingNames = new Set();
    try { existingNames = new Set(await SB.listImageNames()); } catch (e) { console.warn("加载已有图片名失败", e); }
    // 记录结果容器（按 index）
    const results = new Array(total).fill(null);
    // 并发分组上传（单批并行 4 张，大幅快于串行）
    const CONCURRENCY = 4;
    let cursor = 0;
    async function worker() {
      while (cursor < files.length) {
        const i = cursor++;
        const file = files[i];
        const cleanName = file.name.replace(/[^\w.\-]/g, "_");
        if (existingNames.has(cleanName)) { results[i] = { ok: false, dup: true }; done++; setBar(); continue; }
        try {
          const path = await SB.uploadImage(file, cat);
          await SB.addImageRecord({ category: cat, name: cleanName, path });
          existingNames.add(cleanName);
          results[i] = { ok: true };
        } catch (e) { console.warn(e); results[i] = { ok: false, fail: true }; }
        done++; setBar();
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
    results.forEach(r => { if (!r) return; if (r.dup) dup++; else if (r.fail) failed++; });
    const okCount = total - failed - dup;
    let msg = `上传完成：成功 ${okCount}，失败 ${failed}`;
    if (dup) msg += `，重复跳过 ${dup}`;
    sbToast(msg, failed === 0 && dup === 0);
    setTimeout(() => { if (prog) prog.classList.add("hidden"); if (bar) bar.style.width = "0%"; }, 800);
    smartPending.forEach(it => { if (it.url) URL.revokeObjectURL(it.url); });
    smartPending = [];
    smartUploading = false;
    smartRenderPending();
    await loadManage();
    await loadSmartAll();
    renderSmartPools();
  }
  // 全选本池去标：给左池（已打该标签）的全部图片一键移除当前标签（需二次确认）
  async function smartDeselAll() {
    if (!smartTag) { sbToast("请先选择一个具体标签，再全选本池去标", false); return; }
    const field = smartFieldMap[smartDim];
    const doneGrid = document.querySelector("#smart-grid-done");
    if (!doneGrid) return;
    const ids = [...doneGrid.querySelectorAll(".smart-card")].map(c => c.dataset.id).filter(Boolean);
    if (!ids.length) { sbToast("本池暂无需要移除标签的图片", false); return; }
    if (!confirm("确认要对本池 " + ids.length + " 张图片批量移除「" + smartTag + "」标签？")) return;
    let ok = 0, fail = 0;
    for (const id of ids) {
      const img = smartAll.find(i => i.id === id);
      if (!img) continue;
      try {
        if (smartSingleDim[field]) {
          await SB.setImageSingleField(id, field, "");
          img[field] = "";
        } else {
          const cur = Array.isArray(img[field]) ? img[field] : [];
          const next = cur.filter(t => t !== smartTag);
          await SB.updateImageField(id, field, next);
          img[field] = next;
        }
        ok++;
      } catch (e) { fail++; }
    }
    sbToast("已为 " + ok + " 张图片移除「" + smartTag + "」" + (smartSingleDim[field] ? "类目" : "标签") + (fail ? "，失败 " + fail + " 张" : ""));
    await renderSmartPools();
  }

  // ================= 前台访问模式开关（公开浏览 / 必须登录） =================
  async function loadAccess() {
    if (!document.querySelector("#access-card")) return;
    try {
      const pub = await SB.getPublicAccess();
      document.querySelector("#public-access-toggle").checked = !!pub;
      document.querySelector("#access-save").disabled = true;
    } catch (e) { /* 忽略读取失败 */ }
  }
  function bindAccess() {
    const toggle = document.querySelector("#public-access-toggle");
    const save = document.querySelector("#access-save");
    if (!toggle || !save) return;
    toggle.addEventListener("change", () => { save.disabled = false; });
    save.addEventListener("click", async () => {
      const val = toggle.checked;
      try {
        await SB.setPublicAccess(val);
        sbToast(val ? "已开启公开浏览，前台免登录可见" : "已关闭公开浏览，前台需登录可见");
        save.disabled = true;
      } catch (e) {
        sbToast("保存失败：" + (e.message || ""), false);
      }
    });
  }

  // ================= 趋势专区管理（上传 / 列表 / 删除） =================
  let trendPickedFile = null;
  let trendPickedCover = null;
  let trendList = [];
  let trendCategory = "";        // 已选类目（引用视觉专区类目）
  let trendCatOptions = [];      // 可选类目候选

  function bindTrend() {
    const dropzone = document.querySelector("#trend-dropzone");
    const fileInput = document.querySelector("#trend-file-input");
    const title = document.querySelector("#trend-title");
    const pick = document.querySelector("#trend-pick");
    const upBtn = document.querySelector("#trend-upload-btn");
    const refresh = document.querySelector("#trend-refresh");
    if (dropzone && fileInput) {
      dropzone.addEventListener("click", () => fileInput.click());
      dropzone.addEventListener("dragover", (e) => { e.preventDefault(); });
      dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        const f = e.dataTransfer.files ? e.dataTransfer.files[0] : null;
        if (f) setTrendFile(f);
      });
      fileInput.addEventListener("change", () => { if (fileInput.files && fileInput.files[0]) setTrendFile(fileInput.files[0]); });
    }
    function setTrendFile(f) {
      if (!/\.pdf$/i.test(f.name) && !/pdf/i.test(f.type)) { sbToast("仅支持 PDF 文件", false); return; }
      trendPickedFile = f;
      if (pick) { pick.textContent = "已选择：" + f.name; pick.classList.remove("hidden"); }
      if (upBtn) upBtn.disabled = !(title && title.value.trim());
    }
    // 封面（可选）
    const coverDz = document.querySelector("#trend-cover-dropzone");
    const coverInput = document.querySelector("#trend-cover-input");
    const coverPick = document.querySelector("#trend-cover-pick");
    if (coverDz && coverInput) {
      coverDz.addEventListener("click", () => coverInput.click());
      coverDz.addEventListener("dragover", (e) => { e.preventDefault(); });
      coverDz.addEventListener("drop", (e) => {
        e.preventDefault();
        const f = e.dataTransfer.files ? e.dataTransfer.files[0] : null;
        if (f) setTrendCover(f);
      });
      coverInput.addEventListener("change", () => { if (coverInput.files && coverInput.files[0]) setTrendCover(coverInput.files[0]); });
    }
    function setTrendCover(f) {
      if (!/^image\//i.test(f.type || "") && !/\.(jpe?g|png|webp)$/i.test(f.name || "")) { sbToast("封面仅支持图片", false); return; }
      trendPickedCover = f;
      if (coverPick) { coverPick.textContent = "封面：" + f.name; coverPick.classList.remove("hidden"); }
    }
    // 类目选择（复用视觉专区类目：搜索 / 点选 / 自定义添加）
    const catSearch = document.querySelector("#trend-cat-search");
    const catResults = document.querySelector("#trend-cat-results");
    const catAddBtn = document.querySelector("#trend-cat-add-btn");
    loadTrendCatOptions();
    renderTrendCategoryChosen();
    if (catSearch) catSearch.addEventListener("input", renderCatResults);
    catSearch.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); renderCatResults(); } });
    if (catResults) catResults.addEventListener("click", (e) => {
      const btn = e.target.closest(".cat-option");
      if (btn) chooseCategory(btn.dataset.cat);
    });
    if (catAddBtn) catAddBtn.addEventListener("click", customAddCategory);
    if (upBtn) upBtn.addEventListener("click", () => doUploadTrend(title.value.trim()));
    if (refresh) refresh.addEventListener("click", loadTrendList);
    if (title) title.addEventListener("input", () => { if (upBtn) upBtn.disabled = !(title.value.trim() && trendPickedFile); });
  }
  async function loadTrendCatOptions() {
    try {
      const cats = await SB.listActiveCats().catch(() => []);
      trendCatOptions = (cats || []).map(c => (typeof c === "string" ? c : (c && c.name) || ""));
      renderCatResults();
    } catch (e) {}
  }
  function renderCatResults() {
    const catSearch = document.querySelector("#trend-cat-search");
    const catResults = document.querySelector("#trend-cat-results");
    if (!catSearch || !catResults) return;
    const kw = (catSearch.value || "").trim().toLowerCase();
    let list = trendCatOptions.filter(c => c && c !== trendCategory);
    if (kw) list = list.filter(c => c.toLowerCase().indexOf(kw) >= 0);
    list = list.slice(0, 12);
    if (!list.length) { catResults.classList.add("hidden"); catResults.innerHTML = ""; return; }
    catResults.innerHTML = "";
    list.forEach(c => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cat-option";
      b.dataset.cat = c;
      b.textContent = c;
      catResults.appendChild(b);
    });
    catResults.classList.remove("hidden");
  }
  function chooseCategory(c) {
    trendCategory = c;
    renderTrendCategoryChosen();
    const catSearch = document.querySelector("#trend-cat-search");
    const catResults = document.querySelector("#trend-cat-results");
    if (catSearch) catSearch.value = "";
    if (catResults) { catResults.innerHTML = ""; catResults.classList.add("hidden"); }
  }
  function renderTrendCategoryChosen() {
    const box = document.querySelector("#trend-cat-chosen");
    const tip = document.querySelector("#trend-cat-tip");
    if (!box) return;
    box.innerHTML = "";
    if (trendCategory) {
      const chip = document.createElement("span");
      chip.className = "cat-chip";
      chip.innerHTML = '<span class="cc-name"></span><button type="button" class="cc-x" title="移除">×</button>';
      chip.querySelector(".cc-name").textContent = trendCategory;
      chip.querySelector(".cc-x").onclick = () => { trendCategory = ""; renderTrendCategoryChosen(); };
      box.appendChild(chip);
    }
    if (tip) tip.textContent = trendCategory
      ? "已选择：视觉专区类目「" + trendCategory + "」"
      : "搜索已有类目点选，或点下方按钮自定义添加新类目。";
  }
  async function customAddCategory() {
    const catSearch = document.querySelector("#trend-cat-search");
    const name = (catSearch ? catSearch.value : "").trim();
    if (!name) { sbToast("请先在搜索框输入新类目名", false); return; }
    try {
      await SB.addCategory(name);
      if (!trendCatOptions.includes(name)) trendCatOptions = trendCatOptions.concat([name]);
      chooseCategory(name);
      sbToast("已添加类目「" + name + "」");
    } catch (e) {
      sbToast("添加类目失败（可能已存在）：" + (e.message || ""), false);
    }
  }

  async function doUploadTrend(t) {
    if (!trendPickedFile) return sbToast("请先选择 PDF 文件", false);
    if (!t) return sbToast("请填写文件标题", false);
    const tag = (document.querySelector('input[name="trend-tag"]:checked') || {}).value || "类目";
    const description = (document.querySelector("#trend-description")?.value || "").trim();
    const upBtn = document.querySelector("#trend-upload-btn");
    const pw = document.querySelector("#trend-progress-wrap");
    const pb = document.querySelector("#trend-progress-bar");
    const pt = document.querySelector("#trend-progress-text");
    try {
      if (upBtn) upBtn.disabled = true;
      if (pw) pw.classList.remove("hidden");
      if (pb) pb.style.width = "0%";
      if (pt) pt.textContent = "0%";
      const onP = (p) => { if (pb) pb.style.width = p + "%"; if (pt) pt.textContent = p + "%"; };
      const res = await SB.uploadTrendFileXHR(trendPickedFile, trendPickedCover, onP);
      await SB.addTrendRecord({
        title: t, tag, path: res.path, cover: res.cover || "",
        category: trendCategory, description, file_type: "pdf",
      });
      trendPickedFile = null;
      trendPickedCover = null;
      trendCategory = "";
      const fileInput = document.querySelector("#trend-file-input");
      if (fileInput) fileInput.value = "";
      const coverInput = document.querySelector("#trend-cover-input");
      if (coverInput) coverInput.value = "";
      const pick = document.querySelector("#trend-pick");
      if (pick) { pick.classList.add("hidden"); pick.textContent = ""; }
      const coverPick = document.querySelector("#trend-cover-pick");
      if (coverPick) { coverPick.classList.add("hidden"); coverPick.textContent = ""; }
      const titleEl = document.querySelector("#trend-title");
      if (titleEl) titleEl.value = "";
      const desc = document.querySelector("#trend-description");
      if (desc) desc.value = "";
      renderTrendCategoryChosen();
      if (pw) pw.classList.add("hidden");
      if (upBtn) upBtn.disabled = true;
      sbToast("趋势文件上传成功");
      loadTrendList();
    } catch (e) {
      if (pw) pw.classList.add("hidden");
      sbToast("上传失败：" + (e.message || ""), false);
      if (upBtn) upBtn.disabled = false;
    }
  }

  async function loadTrendList() {
    if (!document.querySelector("#trend-list")) return;
    try {
      trendList = await SB.listTrends();
      renderTrendList();
    } catch (e) {
      sbToast("加载趋势列表失败", false);
    }
  }
  function renderTrendList() {
    const box = document.querySelector("#trend-list");
    const cnt = document.querySelector("#trend-count");
    if (!box) return;
    if (cnt) cnt.textContent = trendList.length + " 个文件";
    box.innerHTML = "";
    if (!trendList.length) {
      box.innerHTML = '<p class="hint">暂无趋势文件，先在上方上传一个 PDF。</p>';
      return;
    }
    trendList.forEach(t => {
      const row = document.createElement("div");
      row.className = "trend-admin-row";
      const catTxt = t.category ? (" · " + t.category) : "";
      row.innerHTML =
        '<div class="trend-cov"></div>' +
        '<div class="trend-admin-info">' +
          '<div class="trend-admin-title"></div>' +
          '<div class="trend-admin-meta"></div>' +
          '<div class="trend-admin-desc hidden2"></div>' +
        '</div>' +
        '<div class="trend-admin-ops">' +
          '<button class="btn-ghost trend-del">删除</button>' +
        '</div>';
      const cov = row.querySelector(".trend-cov");
      if (t.cover) {
        cov.classList.add("has");
        SB.trendCoverUrl(t.cover).then(u => {
          if (cov && !cov.dataset.loaded) { cov.style.backgroundImage = "url('" + u + "')"; cov.dataset.loaded = "1"; }
        }).catch(() => {});
      } else {
        cov.innerHTML = '<span class="tcov-ic">PDF</span>';
      }
      row.querySelector(".trend-admin-title").textContent = t.title || "未命名";
      row.querySelector(".trend-admin-meta").textContent = "[" + (t.tag || "") + catTxt + "] · " + (t.file_type || "pdf").toUpperCase();
      const d = row.querySelector(".trend-admin-desc");
      if (t.description) { d.textContent = t.description; d.classList.remove("hidden2"); }
      row.querySelector(".trend-del").addEventListener("click", () => confirmDeleteTrend(t));
      box.appendChild(row);
    });
  }
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  async function confirmDeleteTrend(t) {
    if (!confirm("确认删除趋势文件「" + (t.title || "") + "」？此操作会同时删除 R2 中的文件与封面。")) return;
    try {
      await SB.deleteTrendFile(t.path, t.cover || "");
      await SB.removeTrendRecord(t.id);
      sbToast("已删除");
      loadTrendList();
    } catch (e) {
      sbToast("删除失败：" + (e.message || ""), false);
    }
  }

  // ================= 公告管理：编辑/发布/下架/删除 + 图文 =================
  let noticeImages = [];      // 已上传图片路径数组（R2 notices/）
  let noticeEditingId = null;
  let noticeQuill = null;     // 富文本编辑器实例

  function bindNotice() {
    const titleEl = document.querySelector("#notice-title");
    const pubEl = document.querySelector("#notice-published");
    const saveBtn = document.querySelector("#notice-save");
    const resetBtn = document.querySelector("#notice-reset");

    // 初始化富文本编辑器（Quill）
    const editorEl = document.querySelector("#notice-content-editor");
    if (editorEl && typeof window.Quill !== "undefined") {
      noticeQuill = new window.Quill(editorEl, {
        theme: "snow",
        placeholder: "公告正文：可编辑格式、插入图片…",
        modules: {
          toolbar: {
            container: "#notice-toolbar",
            handlers: {
              image: function () {
                const inp = document.createElement("input");
                inp.type = "file";
                inp.accept = "image/*";
                inp.multiple = true;
                inp.onchange = () => {
                  const files = Array.from(inp.files || []);
                  const range = noticeQuill.getSelection(true);
                  files.forEach((f, i) => {
                    uploadNoticeImage(f).then(path => {
                      if (!path) return;
                      const idx = (range && range.index != null && i === 0) ? range.index : noticeQuill.getLength() - 1;
                      noticeQuill.insertEmbed(idx, "image", SB.noticeImageUrl(path), "user");
                      noticeQuill.setSelection(idx + 1, 0);
                    });
                  });
                };
                inp.click();
              }
            }
          }
        }
      });
      // 图片上传成功后用于编辑器插入的额外通知
    } else if (editorEl) {
      noticeQuill = null;
    }

    if (titleEl) titleEl.addEventListener("input", () => { if (saveBtn) saveBtn.disabled = !titleEl.value.trim(); });

    // 图片选择/上传（正文下方额外图片）
    const pickBtn = document.querySelector("#notice-img-pick");
    const imgInput = document.querySelector("#notice-img-input");
    if (pickBtn && imgInput) {
      pickBtn.addEventListener("click", () => imgInput.click());
      imgInput.addEventListener("change", () => {
        const files = Array.from(imgInput.files || []);
        imgInput.value = "";
        files.forEach(f => uploadNoticeImage(f, false));
      });
    }
    renderNoticeThumbs();

    if (saveBtn) saveBtn.addEventListener("click", () => doSaveNotice(titleEl, pubEl));
    if (resetBtn) resetBtn.addEventListener("click", () => resetNoticeForm(titleEl, pubEl));

    loadNoticeAdminList();
  }

  async function uploadNoticeImage(file, toList) {
    if (file.type && file.type.indexOf("image/") !== 0) {
      sbToast("仅支持图片文件", false);
      return null;
    }
    try {
      const path = await SB.uploadNoticeImage(file);
      if (toList !== false) {
        noticeImages.push(path);
        renderNoticeThumbs();
      }
      sbToast("图片已添加");
      return path;
    } catch (e) {
      sbToast("图片上传失败：" + (e.message || ""), false);
      return null;
    }
  }

  function renderNoticeThumbs() {
    const thumbs = document.querySelector("#notice-img-thumbs");
    if (!thumbs) return;
    thumbs.innerHTML = "";
    noticeImages.forEach((p, idx) => {
      const wrap = document.createElement("div");
      wrap.className = "notice-thumb";
      const img = document.createElement("img");
      img.alt = "";
      img.src = SB.noticeImageUrl(p);
      const x = document.createElement("button");
      x.type = "button";
      x.className = "notice-thumb-x";
      x.textContent = "×";
      x.title = "移除图片";
      x.addEventListener("click", () => {
        noticeImages.splice(idx, 1);
        renderNoticeThumbs();
      });
      wrap.appendChild(img);
      wrap.appendChild(x);
      thumbs.appendChild(wrap);
    });
  }

  function resetNoticeForm(titleEl, pubEl, keepImages) {
    if (titleEl) titleEl.value = "";
    if (noticeQuill && noticeQuill.root) noticeQuill.root.innerHTML = "";
    if (pubEl) pubEl.checked = true;
    if (!keepImages) noticeImages = [];
    noticeEditingId = null;
    renderNoticeThumbs();
    if (titleEl) titleEl.dispatchEvent(new Event("input"));
  }

  async function doSaveNotice(titleEl, pubEl) {
    const title = (titleEl && titleEl.value || "").trim();
    if (!title) return sbToast("请填写公告标题", false);
    // 富文本正文：保留管理员编辑的 HTML（加粗/列表/插图等），空白时退回纯文本
    let content = "";
    if (noticeQuill && noticeQuill.root) {
      content = noticeQuill.root.innerHTML.trim();
      // 去掉仅剩的空段落
      if (/^(<p><br><\/p>|&nbsp;|\s)*$/.test(content)) content = "";
    }
    const published = !pubEl ? true : pubEl.checked;
    try {
      if (noticeEditingId) {
        await SB.updateAnnouncement(noticeEditingId, { title, content, published, images: noticeImages });
        sbToast("公告已更新");
      } else {
        await SB.addAnnouncement({ title, content, published, images: noticeImages });
        sbToast("公告已发布");
      }
      resetNoticeForm(titleEl, pubEl, false);
      loadNoticeAdminList();
    } catch (e) {
      sbToast("保存失败：" + (e.message || ""), false);
    }
  }

  async function loadNoticeAdminList() {
    const box = document.querySelector("#notice-list-box");
    if (!box) return;
    let list = [];
    try { list = await SB.listAnnouncements(); } catch (e) { list = []; }
    box.innerHTML = "";
    if (!list.length) {
      box.innerHTML = '<p class="hint">暂无公告。填写上方表单并点击「发布/保存」。</p>';
      return;
    }
    list.forEach(a => {
      const row = document.createElement("div");
      row.className = "notice-admin-row";
      const info = document.createElement("div");
      info.className = "notice-admin-info";
      const t = document.createElement("div");
      t.className = "notice-admin-title";
      t.textContent = a.title || "（无标题）";
      const m = document.createElement("div");
      m.className = "notice-admin-meta";
      m.textContent = fmtAdminDate(a.created_at) + " · " + (a.published ? "已发布" : "已下架") + (a.images && a.images.length ? " · " + a.images.length + " 图" : "");
      info.appendChild(t);
      info.appendChild(m);
      const ops = document.createElement("div");
      ops.className = "notice-admin-ops";
      const bEdit = document.createElement("button");
      bEdit.type = "button";
      bEdit.className = "btn-ghost";
      bEdit.textContent = "编辑";
      bEdit.addEventListener("click", () => editNotice(a));
      const bPub = document.createElement("button");
      bPub.type = "button";
      bPub.className = "btn-ghost";
      bPub.textContent = a.published ? "下架" : "发布";
      bPub.addEventListener("click", () => toggleNoticePublish(a));
      const bDel = document.createElement("button");
      bDel.type = "button";
      bDel.className = "btn-danger";
      bDel.textContent = "删除";
      bDel.addEventListener("click", () => deleteNotice(a));
      ops.appendChild(bEdit);
      ops.appendChild(bPub);
      ops.appendChild(bDel);
      row.appendChild(info);
      row.appendChild(ops);
      box.appendChild(row);
    });
  }

  function editNotice(a) {
    const titleEl = document.querySelector("#notice-title");
    const pubEl = document.querySelector("#notice-published");
    if (titleEl) titleEl.value = a.title || "";
    if (pubEl) pubEl.checked = a.published !== false;
    if (noticeQuill && noticeQuill.root) {
      const raw = (a.content || "");
      noticeQuill.root.innerHTML = /^<(p|h\d|div|ul|ol|blockquote|img|table)/i.test(raw.trim()) ? raw : (raw ? "<p>" + escapeHtml(raw) + "</p>" : "");
    }
    noticeImages = (a.images || []).slice();
    noticeEditingId = a.id;
    renderNoticeThumbs();
    if (titleEl) titleEl.dispatchEvent(new Event("input"));
    sbToast("已载入《" + (a.title || "") + "》到表单，修改后点「发布/保存」");
  }

  async function toggleNoticePublish(a) {
    try {
      await SB.updateAnnouncement(a.id, { published: a.published ? false : true });
      sbToast(a.published ? "已下架" : "已发布");
      loadNoticeAdminList();
    } catch (e) {
      sbToast("操作失败：" + (e.message || ""), false);
    }
  }

  async function deleteNotice(a) {
    if (!confirm("确认删除公告「" + (a.title || "") + "」？")) return;
    try {
      await SB.removeAnnouncement(a.id);
      sbToast("已删除");
      loadNoticeAdminList();
    } catch (e) {
      sbToast("删除失败：" + (e.message || ""), false);
    }
  }

  function fmtAdminDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const p = n => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) { return ""; }
  }

  // ================= 招品回品专区：后台管理 =================
let recruitTasks = [];
  let recruitAllSubs = [];
  let recruitImgFiles = [];   // 批量待上传图片
  let recruitFilter = "";     // "" | published | submitted | bound
  let recruitSelected = new Set();  // 卡片勾选
  let recruitTrash = [];              // 回收站任务
  let recruitTrashSelected = new Set();  // 回收站勾选
  let recruitInTrash = false;         // 是否处于回收站视图

  function renderRecruitPre() {
    const pre = document.querySelector("#recruit-upload-preview");
    if (!pre) return;
    if (!recruitImgFiles.length) { pre.classList.add("hidden"); pre.innerHTML = ""; return; }
    pre.classList.remove("hidden");
    pre.innerHTML = "";
    recruitImgFiles.forEach((f, i) => {
      const cell = document.createElement("div");
      cell.className = "recruit-pre-cell";
      const im = document.createElement("img");
      im.src = URL.createObjectURL(f);
      const rm = document.createElement("button");
      rm.className = "btn-danger small"; rm.textContent = "×"; rm.title = "移除";
      rm.onclick = () => { recruitImgFiles.splice(i, 1); renderRecruitPre(); };
      cell.appendChild(im); cell.appendChild(rm);
      pre.appendChild(cell);
    });
  }

  function bindRecruit() {
    const upBtn = document.querySelector("#recruit-save");
    const refresh = document.querySelector("#recruit-refresh");
    const imgDz = document.querySelector("#recruit-img-dropzone");
    const imgInput = document.querySelector("#recruit-img-input");
    const pre = document.querySelector("#recruit-upload-preview");
    if (imgDz && imgInput) {
      imgDz.addEventListener("click", () => imgInput.click());
      imgDz.addEventListener("dragover", (e) => e.preventDefault());
      imgDz.addEventListener("drop", (e) => {
        e.preventDefault();
        const fs = e.dataTransfer.files ? [...e.dataTransfer.files] : [];
        if (fs.length) addRecruitImgs(fs);
      });
      imgInput.addEventListener("change", () => {
        if (imgInput.files && imgInput.files.length) addRecruitImgs([...imgInput.files]);
        imgInput.value = "";
      });
    }
    function addRecruitImgs(fs) {
      const ok = fs.filter(f => /^image\//i.test(f.type || "") && /\.(jpe?g|png|webp)$/i.test(f.name || ""));
      if (!ok.length) { sbToast("仅支持 JPG/PNG 图片", false); return; }
      // 去重（按文件名）
      const names = new Set(recruitImgFiles.map(x => x.name));
      ok.forEach(f => { if (!names.has(f.name)) { recruitImgFiles.push(f); names.add(f.name); } });
      renderRecruitPre();
    }
    if (upBtn) upBtn.addEventListener("click", saveRecruitTasks);
    if (refresh) refresh.addEventListener("click", loadRecruitList);
    // 筛选
    document.querySelectorAll("#recruit-filters .recruit-filter").forEach(b => {
      b.onclick = () => { recruitFilter = b.dataset.st || ""; renderRecruitList(); };
    });
    // 全选
    const ca = document.querySelector("#recruit-checkall");
    if (ca) ca.onchange = () => { recruitSelected.clear(); if (ca.checked) recruitTasks.forEach(t => recruitSelected.add(t.id)); renderRecruitList(); };
    // 批量发布 / 批量绑定 / 取消绑定
    const bp = document.querySelector("#recruit-batch-pub");
    if (bp) bp.onclick = () => bulkSetRecruitStatus("published");
    const bb = document.querySelector("#recruit-batch-bound");
    if (bb) bb.onclick = () => bulkSetRecruitBound(true);
    const bu = document.querySelector("#recruit-batch-unbound");
    if (bu) bu.onclick = () => bulkSetRecruitBound(false);
    const exportBtn = document.querySelector("#recruit-export");
    if (exportBtn) exportBtn.addEventListener("click", exportRecruitExcel);
    // 批量删除 → 移入回收站
    const bdel = document.querySelector("#recruit-batch-del");
    if (bdel) bdel.onclick = () => bulkDeleteRecruit();
    // 回收站开关
    const trashToggle = document.querySelector("#recruit-trash-toggle");
    if (trashToggle) trashToggle.onclick = () => openRecruitTrash();
    const trashBack = document.querySelector("#recruit-trash-back");
    if (trashBack) trashBack.onclick = () => closeRecruitTrash();
    // 回收站全选
    const tca = document.querySelector("#recruit-trash-checkall");
    if (tca) tca.onchange = () => { recruitTrashSelected.clear(); if (tca.checked) recruitTrash.forEach(t => recruitTrashSelected.add(t.id)); renderRecruitTrash(); };
    // 回收站批量恢复 / 永久删除
    const trRestore = document.querySelector("#recruit-trash-restore");
    if (trRestore) trRestore.onclick = () => bulkRestoreRecruit();
    const trPurge = document.querySelector("#recruit-trash-purge");
    if (trPurge) trPurge.onclick = () => bulkPurgeRecruit();
    renderRecruitPre();
  }

  // 批量上传：多张图 → 生成多张「未发布」卡片，多任务ID按顺序填入
  async function saveRecruitTasks() {
    if (!recruitImgFiles.length) return sbToast("请先选择招品图片", false);
    const ids = (document.querySelector("#recruit-taskid")?.value || "").replace(/[,，\s]+/g, " ").trim().split(/\s+/).filter(Boolean);
    const files = recruitImgFiles.slice();
    // 校验：任务ID数量不能多于图片数量（允许少于：多余的图留空草稿）
    const rows = [];
    let uploadErr = false;
    sbToast("正在上传 " + files.length + " 张图片…");
    for (let i = 0; i < files.length; i++) {
      try {
        const imagePath = await SB.uploadRecruitImage(files[i]);
        rows.push({ task_id: ids[i] || "", image_path: imagePath, status: ids[i] ? "published" : "draft" });
      } catch (e) { uploadErr = true; }
    }
    if (!rows.length) { sbToast("图片上传失败，请重试", false); return; }
    try {
      await SB.addRecruitTasks(rows);
      recruitImgFiles = [];
      renderRecruitPre();
      if (document.querySelector("#recruit-taskid")) document.querySelector("#recruit-taskid").value = "";
      sbToast("已创建 " + rows.length + " 张招品任务卡片");
      loadRecruitList();
    } catch (e) { sbToast("保存失败：" + (e.message || ""), false); }
  }

  async function loadRecruitList() {
    if (!document.querySelector("#recruit-list")) return;
    try {
      recruitTasks = await SB.listRecruitTasks();
      recruitAllSubs = await SB.listAllRecruitSubmissions().catch(() => []);
      renderRecruitList();
    } catch (e) { sbToast("加载招品列表失败", false); }
  }
  function recruitSubsFor(taskId) {
    return recruitAllSubs.filter(s => s.recruit_task_id === taskId);
  }
  function recruitStatusLabel(t, hasSubs) {
    if (t.bound) return "bound";
    if (t.status === "published" && hasSubs) return "submitted";
    if (t.status === "published") return "published";
    return "draft";
  }
  function recruitStatusChip(cls, label) {
    return '<span class="recruit-chip ' + cls + '">' + label + '</span>';
  }
  function renderRecruitList() {
    const box = document.querySelector("#recruit-list");
    const cnt = document.querySelector("#recruit-count");
    const ca = document.querySelector("#recruit-checkall");
    if (!box) return;
    let list = recruitTasks;
    if (recruitFilter === "published") list = list.filter(t => t.status === "published" && !t.bound);
    else if (recruitFilter === "submitted") list = list.filter(t => t.status === "published" && recruitSubsFor(t.id).length > 0 && !t.bound);
    else if (recruitFilter === "bound") list = list.filter(t => t.bound);
    // 同步勾选集
    const valid = new Set(list.map(t => t.id));
    recruitSelected = new Set([...recruitSelected].filter(id => valid.has(id)));
    if (cnt) cnt.textContent = "共 " + list.length + " 个任务";
    if (ca) ca.checked = list.length > 0 && list.every(t => recruitSelected.has(t.id));
    box.innerHTML = "";
    if (!list.length) {
      box.innerHTML = '<p class="hint">暂无符合当前筛选的招品任务。</p>';
      return;
    }
    const token = null;
    const pubRank = recruitTasks.slice().filter(x => x.status === "published").sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    list.forEach((t) => {
      const subs = recruitSubsFor(t.id);
      const spuList = [];
      subs.forEach(s => { (s.spus || []).forEach(sp => { if (sp && spuList.indexOf(sp) < 0) spuList.push(sp); }); });
      const seq = t.status === "published" ? (pubRank.indexOf(t) + 1) : "";
      const st = recruitStatusLabel(t, subs.length > 0);
      const card = document.createElement("div");
      card.className = "recruit-acard" + (recruitSelected.has(t.id) ? " sel" : "");
      const chip = st === "bound" ? recruitStatusChip("chip-bound", "已绑定")
        : st === "submitted" ? recruitStatusChip("chip-sub", "已上传")
        : st === "published" ? recruitStatusChip("chip-pub", "已发布")
        : recruitStatusChip("chip-draft", "未发布");
      card.innerHTML =
        '<div class="recruit-acard-imghold">' +
          '<img class="recruit-acard-img" alt="">' +
          '<span class="recruit-acard-no">' + seq + '</span>' +
          '<span class="recruit-acard-del" title="删除">×</span>' +
          '<span class="recruit-acard-check"><input type="checkbox" class="recruit-check"' + (recruitSelected.has(t.id) ? ' checked' : '') + '></span>' +
        '</div>' +
        '<div class="recruit-acard-body">' +
          '<div class="recruit-acard-tid" title="任务ID：' + escAttr(t.task_id || "") + '">任务ID：' + escHtml(t.task_id || "（未填写）") + '</div>' +
          '<div class="recruit-acard-strow">' + chip + '<span class="recruit-acard-meta">' + subs.length + ' 人 / ' + spuList.length + ' 个SPU</span></div>' +
          '<div class="recruit-acard-tags" data-tags></div>' +
          '<div class="recruit-acard-actions">' +
            '<input type="text" class="rcac-tid-input" placeholder="任务ID" value="">' +
            '<button class="btn-ghost small rcac-pub">' + (t.status === "published" ? "取消发布" : "发布") + '</button>' +
            '<button class="btn-ghost small rcac-bound">' + (t.bound ? "取消绑定" : "标已绑定") + '</button>' +
            '<button class="btn-ghost small rcac-copy">复制SPU</button>' +
          '</div>' +
        '</div>';
      const img = card.querySelector(".recruit-acard-img");
      if (t.image_path) {
        SB.recruitImageUrl(t.image_path).then(u => {
          img.onload = () => img.classList.add("loaded");
          img.onerror = () => { img.classList.remove("loaded"); img.src = ""; };
          img.src = u;
        }).catch(() => {});
      } else {
        card.querySelector(".recruit-acard-imghold").style.background = "rgba(255,255,255,.03)";
      }
      // 悬浮提示 SPU
      const tip = spuList.length ? ("该任务已提交货品SPU：\n" + spuList.join("\n")) : "该任务暂无商家提交SPU";
      card.querySelector(".recruit-acard-imghold").title = tip;
      card.querySelector(".recruit-acard-tid").title = tip;
      // 复选框
      const cb = card.querySelector(".recruit-check");
      cb.onchange = () => { if (cb.checked) recruitSelected.add(t.id); else recruitSelected.delete(t.id); card.classList.toggle("sel", cb.checked); };
      // 删除
      card.querySelector(".recruit-acard-del").onclick = () => confirmDeleteRecruit(t);
      // 发布切换
      card.querySelector(".rcac-pub").onclick = () => setRecruitStatus(t, t.status === "published" ? "draft" : "published");
      // 绑定切换
      card.querySelector(".rcac-bound").onclick = () => setRecruitBound(t, !t.bound);
      // 复制SPU
      card.querySelector(".rcac-copy").onclick = () => copyRecruitSps(t, spuList);
      // 任务ID 编辑
      const tidInput = card.querySelector(".rcac-tid-input");
      tidInput.value = t.task_id || "";
      tidInput.addEventListener("change", () => {
        const v = tidInput.value.trim();
        SB.updateRecruitTask(t.id, { task_id: v }).then(() => sbToast("任务ID已更新")).catch(e => sbToast("更新失败", false));
      });
      // 已传SPU 状态区
      renderRecruitSpsStatus(card, spuList.length);
      box.appendChild(card);
    });
  }

  // 已传SPU 状态标记：商家中已有提交 → 显示「已传SPU · 已上传」
  function renderRecruitSpsStatus(card, hasSubs) {
    const el = card.querySelector("[data-tags]");
    if (!el) return;
    el.innerHTML = "";
    const s = document.createElement("span");
    if (hasSubs) { s.className = "rcac-tag-chip rcac-sub-up"; s.textContent = "已传SPU · 已上传"; }
    else { s.className = "rcac-tag-empty"; s.textContent = "未传SPU"; }
    el.appendChild(s);
  }

  async function setRecruitStatus(t, st) {
    try {
      await SB.updateRecruitTask(t.id, { status: st });
      t.status = st; renderRecruitList(); sbToast(st === "published" ? "已发布" : "已取消发布");
    } catch (e) { sbToast("操作失败", false); }
  }
  async function setRecruitBound(t, b) {
    try {
      await SB.updateRecruitTask(t.id, { bound: b, bound_at: b ? new Date().toISOString() : null });
      t.bound = b; renderRecruitList(); sbToast(b ? "已标记为已绑定" : "已取消绑定");
    } catch (e) { sbToast("操作失败", false); }
  }
  async function bulkSetRecruitStatus(st) {
    const ids = [...recruitSelected];
    if (!ids.length) return sbToast("请先勾选要发布的任务", false);
    try { await SB.bulkUpdateRecruitTasks(ids, { status: st }); sbToast("已批量" + (st === "published" ? "发布" : "取消发布") + " " + ids.length + " 个任务"); loadRecruitList(); }
    catch (e) { sbToast("批量操作失败", false); }
  }
  async function bulkSetRecruitBound(b) {
    const ids = [...recruitSelected];
    if (!ids.length) return sbToast("请先勾选任务", false);
    try { await SB.bulkUpdateRecruitTasks(ids, { bound: b, bound_at: b ? new Date().toISOString() : null }); sbToast("已批量" + (b ? "标记绑定" : "取消绑定") + " " + ids.length + " 个任务"); loadRecruitList(); }
    catch (e) { sbToast("批量操作失败", false); }
  }

  async function copyRecruitSps(t, spuList) {
    if (!spuList.length) return sbToast("该任务暂无SPU可复制", false);
    try {
      await navigator.clipboard.writeText(spuList.join(","));
      sbToast("已复制 " + spuList.length + " 个SPU");
    } catch (e) { sbToast("复制失败", false); }
  }

  async function confirmDeleteRecruit(t) {
    if (!confirm("确认将招品任务ID「" + t.task_id + "」移入回收站？可在回收站中恢复。")) return;
    try {
      await SB.removeRecruitTask(t.id);
      sbToast("已移入回收站");
      loadRecruitList();
    } catch (e) { sbToast("删除失败：" + (e.message || ""), false); }
  }

  // 批量删除 → 移入回收站
  async function bulkDeleteRecruit() {
    const ids = [...recruitSelected];
    if (!ids.length) return sbToast("请先勾选要删除的任务", false);
    if (!confirm("确认将选中的 " + ids.length + " 个任务移入回收站？可在回收站中恢复。")) return;
    try {
      await SB.bulkUpdateRecruitTasks(ids, { deleted_at: new Date().toISOString() });
      sbToast("已移入回收站 " + ids.length + " 个任务");
      loadRecruitList();
    } catch (e) { sbToast("操作失败", false); }
  }

  // ===== 回收站 =====
  async function openRecruitTrash() {
    recruitInTrash = true;
    const main = document.querySelector("#recruit-main-area");
    const trash = document.querySelector("#recruit-trash-view");
    if (main) main.classList.add("hidden");
    if (trash) trash.classList.remove("hidden");
    const toggle = document.querySelector("#recruit-trash-toggle");
    if (toggle) toggle.textContent = "🗑 回收站";
    try {
      recruitTrash = await SB.listRecruitTrash();
      recruitTrashSelected.clear();
      renderRecruitTrash();
    } catch (e) { sbToast("加载回收站失败", false); }
  }
  function closeRecruitTrash() {
    recruitInTrash = false;
    const main = document.querySelector("#recruit-main-area");
    const trash = document.querySelector("#recruit-trash-view");
    if (main) main.classList.remove("hidden");
    if (trash) trash.classList.add("hidden");
    loadRecruitList();
  }
  function renderRecruitTrash() {
    const box = document.querySelector("#recruit-trash-list");
    const cnt = document.querySelector("#recruit-trash-count");
    const ca = document.querySelector("#recruit-trash-checkall");
    if (!box) return;
    if (cnt) cnt.textContent = "共 " + recruitTrash.length + " 个任务";
    if (ca) ca.checked = recruitTrash.length > 0 && recruitTrash.every(t => recruitTrashSelected.has(t.id));
    box.innerHTML = "";
    if (!recruitTrash.length) { box.innerHTML = '<p class="hint">回收站为空。</p>'; return; }
    recruitTrash.forEach((t) => {
      const subs = recruitSubsFor(t.id);
      const spuList = [];
      subs.forEach(s => { (s.spus || []).forEach(sp => { if (sp && spuList.indexOf(sp) < 0) spuList.push(sp); }); });
      const card = document.createElement("div");
      card.className = "recruit-acard" + (recruitTrashSelected.has(t.id) ? " sel" : "");
      card.innerHTML =
        '<div class="recruit-acard-imghold">' +
          '<img class="recruit-acard-img" alt="">' +
          '<span class="recruit-acard-trashtag">回收站</span>' +
          '<span class="recruit-acard-check"><input type="checkbox" class="recruit-check"' + (recruitTrashSelected.has(t.id) ? ' checked' : '') + '></span>' +
        '</div>' +
        '<div class="recruit-acard-body">' +
          '<div class="recruit-acard-tid" title="任务ID：' + escAttr(t.task_id || "") + '">任务ID：' + escHtml(t.task_id || "（未填写）") + '</div>' +
          '<div class="recruit-acard-strow"><span class="recruit-chip chip-draft">已删除 · ' + escHtml((t.deleted_at || "").slice(0, 10)) + '</span><span class="recruit-acard-meta">' + subs.length + ' 人 / ' + spuList.length + ' 个SPU</span></div>' +
          '<div class="recruit-acard-actions">' +
            '<button class="btn-ghost small trash-restore">恢复</button>' +
            '<button class="btn-danger small trash-purge">永久删除</button>' +
          '</div>' +
        '</div>';
      const img = card.querySelector(".recruit-acard-img");
      if (t.image_path) {
        SB.recruitImageUrl(t.image_path).then(u => {
          img.onload = () => img.classList.add("loaded");
          img.onerror = () => { img.classList.remove("loaded"); img.src = ""; };
          img.src = u;
        }).catch(() => {});
      } else {
        card.querySelector(".recruit-acard-imghold").style.background = "rgba(255,255,255,.03)";
      }
      const cb = card.querySelector(".recruit-check");
      cb.onchange = () => { if (cb.checked) recruitTrashSelected.add(t.id); else recruitTrashSelected.delete(t.id); card.classList.toggle("sel", cb.checked); };
      card.querySelector(".trash-restore").onclick = () => restoreTrashOne(t);
      card.querySelector(".trash-purge").onclick = () => purgeTrashOne(t);
      box.appendChild(card);
    });
  }
  async function restoreTrashOne(t) {
    try {
      await SB.restoreRecruitTask(t.id);
      sbToast("已恢复");
      const back = document.querySelector("#recruit-trash-back");
      if (back) back.click();
    } catch (e) { sbToast("恢复失败", false); }
  }
  async function purgeTrashOne(t) {
    if (!confirm("确认永久删除任务ID「" + t.task_id + "」？其图片与商家提交记录将彻底移除，不可恢复！")) return;
    try {
      if (t.image_path) await SB.deleteRecruitImage(t.image_path).catch(() => {});
      await SB.purgeRecruitTasks([t.id]);
      sbToast("已永久删除");
      openRecruitTrash();
    } catch (e) { sbToast("永久删除失败", false); }
  }
  async function bulkRestoreRecruit() {
    const ids = [...recruitTrashSelected];
    if (!ids.length) return sbToast("请先勾选要恢复的任务", false);
    try {
      await SB.bulkRestoreRecruitTasks(ids);
      sbToast("已恢复 " + ids.length + " 个任务");
      const back = document.querySelector("#recruit-trash-back");
      if (back) back.click();
    } catch (e) { sbToast("批量恢复失败", false); }
  }
  async function bulkPurgeRecruit() {
    const ids = [...recruitTrashSelected];
    if (!ids.length) return sbToast("请先勾选要永久删除的任务", false);
    if (!confirm("确认永久删除选中的 " + ids.length + " 个任务？其图片与商家提交记录将彻底移除，不可恢复！")) return;
    try {
      const inTrash = recruitTrash.filter(t => ids.includes(t.id));
      for (const t of inTrash) { if (t.image_path) await SB.deleteRecruitImage(t.image_path).catch(() => {}); }
      await SB.purgeRecruitTasks(ids);
      sbToast("已永久删除 " + ids.length + " 个任务");
      openRecruitTrash();
    } catch (e) { sbToast("永久删除失败", false); }
  }

  function exportRecruitExcel() {
    if (!recruitTasks.length) return sbToast("暂无招品任务可导出", false);
    if (typeof XLSX === "undefined") return sbToast("导出组件未加载，请联网后重试", false);
    const rows = [];
    const pubRank = recruitTasks.slice().filter(x => x.status === "published").sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    recruitTasks.forEach((t) => {
      const seq = t.status === "published" ? (pubRank.indexOf(t) + 1) : "";
      const subs = recruitSubsFor(t.id);
      subs.forEach(s => {
        rows.push({ 任务ID: t.task_id, 前台序号: seq, 商家前台用户ID: s.user_id, 货品SPU: (s.spus || []).join(","), 状态: t.bound ? "已绑定" : (t.status === "published" ? "已发布" : "未发布") });
      });
    });
    if (!rows.length) return sbToast("暂无商家提交数据可导出", false);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "招品SPU汇总");
    XLSX.writeFile(wb, "招品回品SPU汇总.xlsx");
    sbToast("已导出 " + rows.length + " 行");
  }
})();