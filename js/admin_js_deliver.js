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

  document.addEventListener("DOMContentLoaded", () => {
    bindLogin(); bindLogout(); bindToken(); bindUpload(); bindManage(); bindFavCats(); bindCatMgmt(); bindAccess();
    bindAdminNav();
    SB.onAuth((session) => {
      currentUser = session ? session.user : null;
      refreshUserBadge();
      if (session) enterPanel();
    });
  });

  // ================= 后台侧边菜单 =================
  function bindAdminNav() {
    document.querySelectorAll("#admin-panel .nav-item").forEach(item => {
      item.addEventListener("click", () => switchPanel(item.dataset.target));
    });
  }
  function switchPanel(target) {
    const cards = ["manage-card", "upload-card", "fav-card", "cat-mgmt-card", "access-card", "no-perm"];
    cards.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add("hidden"); });
    const show = document.getElementById(target);
    if (show) show.classList.remove("hidden");
    // 高亮当前菜单
    document.querySelectorAll("#admin-panel .nav-item").forEach(n => {
      n.classList.toggle("active", n.dataset.target === target);
    });
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
    if (currentRole !== "admin" && currentUser) {
      // 非管理员：隐藏上传区，只显示只读提示
      ["#upload-card", "#fav-card", "#cat-mgmt-card", "#access-card"].forEach(s => $(s)?.classList.add("hidden"));
      $("#manage-card").classList.toggle("hidden", false);
      $("#no-perm").classList.remove("hidden");
      // 非管理员侧边只保留“图片管理”
      document.querySelectorAll("#admin-panel .nav-item").forEach(n => {
        n.classList.toggle("hidden", n.dataset.target !== "manage-card");
      });
    } else {
      ["#upload-card", "#fav-card", "#cat-mgmt-card", "#access-card"].forEach(s => $(s)?.classList.remove("hidden"));
      $("#no-perm").classList.add("hidden");
      document.querySelectorAll("#admin-panel .nav-item").forEach(n => n.classList.remove("hidden"));
    }
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
    $("#admin-logout").onclick = async () => { await SB.signOut(); location.reload(); };
  }
  function enterPanel() {
    $("#admin-login").classList.add("hidden");
    $("#admin-panel").classList.remove("hidden");
    loadCats(); loadManage(); loadAccess();
    if (currentRole === "admin") { loadFavCats(); loadCatMgmt(); }
    // 默认显示“图片管理”
    switchPanel("manage-card");
  }

  // ================= 登录 / 注册引导 =================
  function bindToken() {
    // 后台登录页提供“注册”入口，便于用户创建首个账号，再在数据库里赋予管理员角色
    $("#admin-toggle").onclick = (e) => {
      e.preventDefault();
      sbToast("请先注册邮箱（下方），注册后再到数据库把该用户设为管理员（见 README）");
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
    if (cat === "__new__") {
      cat = ($("#cat-new").value || "").trim();
      if (!cat) { sbToast("请输入或选择分类", false); return; }
    }

    uploading = true;
    $("#upload-btn").disabled = true;
    const prog = $("#progress"); prog.classList.remove("hidden");
    const bar = $("#progress-bar");
    const total = pendingFiles.length;
    let done = 0, failed = 0;

    for (const file of pendingFiles) {
      try {
        // 1) 上传到 R2（经 Worker，路径由 Worker 生成）
        const cleanName = file.name.replace(/[^\w.\-]/g, "_");
        const path = await SB.uploadImage(file, cat);
        // 2) 记录到 DB 清单
        await SB.addImageRecord({ category: cat, name: cleanName, path });
      } catch (e) {
        console.warn(e);
        failed++;
      }
      done++;
      bar.style.width = Math.round(done / total * 100) + "%";
    }

    sbToast(`上传完成：成功 ${total - failed}，失败 ${failed}`);
    setTimeout(() => { prog.classList.add("hidden"); bar.style.width = "0%"; }, 800);
    pendingFiles = [];
    renderPending();
    uploading = false;
    await loadCats(); await loadManage();
  }

  // ================= 分类下拉（常用类目优先） =================
  async function loadCats() {
    let cats = [];
    try { cats = await SB.listActiveCats(); } catch (e) {}
    const sel = $("#cat-select");
    sel.innerHTML = "";
    // 常用类目排前面
    if (currentFavCats.length) {
      currentFavCats.forEach(c => { if (cats.includes(c)) sel.add(new Option("★ " + c, c)); });
      sel.add(new Option("──────────", ""));
      sel.value = "";
    }
    cats.forEach(c => sel.add(new Option(c, c)));
    sel.add(new Option("＋ 新建分类", "__new__"));
  }

  // ================= 我的常用类目 =================
  function bindFavCats() {
    $("#fav-save").onclick = saveFavCats;
  }
  async function loadFavCats() {
    try { currentFavCats = await SB.myFavCats(); } catch (e) { currentFavCats = []; }
    // 候选 = 配置里的候选清单 + 已添加的前台类目 + 已有常用类目
    const opts = new Set((window.CONFIG.CATEGORY_OPTIONS || []).concat(currentActiveCats).concat(currentFavCats));
    const box = $("#fav-list");
    box.innerHTML = "";
    [...opts].sort((a, b) => a.localeCompare(b, "zh")).forEach(name => {
      const label = document.createElement("label");
      label.className = "check-item";
      label.innerHTML = `<input type="checkbox" value="${escAttr(name)}"> <span>${escHtml(name)}</span>`;
      label.querySelector("input").checked = currentFavCats.includes(name);
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
      currentFavCats = await SB.updateFavCats(picked);
      sbToast("常用类目已保存");
      $("#fav-save").disabled = true;
      await loadCats();
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
    const opts = new Set((window.CONFIG.CATEGORY_OPTIONS || []).concat(currentActiveCats));
    const box = $("#cat-mgmt-list");
    box.innerHTML = "";
    [...opts].sort((a, b) => a.localeCompare(b, "zh")).forEach(name => {
      const label = document.createElement("label");
      label.className = "check-item";
      label.innerHTML = `<input type="checkbox" value="${escAttr(name)}"> <span>${escHtml(name)}</span>`;
      label.querySelector("input").checked = currentActiveCats.includes(name);
      label.querySelector("input").onchange = () => { $("#cat-mgmt-save").disabled = false; };
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
      await loadCats(); await loadFavCats(); await loadManage();
    } catch (e) { sbToast("保存失败：" + (e.message || ""), false); }
  }

  function bindManage() {
    $("#select-all-btn").onclick = toggleSelectAll;
    $("#batch-del-btn").onclick = batchDelete;
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
    ["全部"].concat(usedCats).forEach(c => {
      const b = document.createElement("button");
      b.className = "cat-menu-item" + (c === currentManageCat ? " active" : "");
      b.textContent = c + "（" + (c === "全部" ? allImgs.length : allImgs.filter(i => i.category === c).length) + "）";
      b.onclick = () => { currentManageCat = c; renderManageGrid(allImgs, usedCats); };
      menu.appendChild(b);
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
      cap.className = "cell-cap";
      cap.textContent = (img.name || "") + " · " + (img.category || "");

      // 勾选框
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "mgr-check";
      cb.dataset.id = img.id;
      cb.checked = selectedImages.has(img.id);
      cb.onchange = () => {
        if (cb.checked) selectedImages.add(img.id); else selectedImages.delete(img.id);
        cell.classList.toggle("selected", cb.checked);
        updateBatchBtn();
      };
      if (cb.checked) cell.classList.add("selected");

      // 单个删除按钮
      const delBtn = document.createElement("button");
      delBtn.className = "btn-danger mgr-del";
      delBtn.textContent = "删";
      delBtn.onclick = (e) => { e.stopPropagation(); removeImage(img); };

      cell.appendChild(cb);
      cell.appendChild(holder);
      cell.appendChild(cap);
      cell.appendChild(delBtn);
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

  // 更新批量删除按钮计数
  function updateBatchBtn() {
    $("#batch-del-btn").textContent = "批量删除（" + selectedImages.size + "）";
    $("#batch-del-btn").disabled = selectedImages.size === 0;
  }

  // 全选 / 取消全选（仅当前网格显示的）
  function toggleSelectAll() {
    const boxes = [...document.querySelectorAll("#manage-grid .mgr-check")];
    // 若当前已全选则取消，否则全选
    const allChecked = boxes.every(b => b.checked);
    boxes.forEach(b => {
      b.checked = !allChecked;
      const cell = b.closest(".cell");
      if (b.checked) { selectedImages.add(b.dataset.id); cell.classList.add("selected"); }
      else { selectedImages.delete(b.dataset.id); cell.classList.remove("selected"); }
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
    // 删除可能影响类目，刷新整套
    await loadCats(); await loadCatMgmt(); await loadFavCats(); await loadManage();
  }

  // 单个删除
  async function removeImage(img) {
    if (!confirm("确认删除该图片？")) return;
    try {
      if (img.path) await SB.deleteImage(img.path);
      await SB.removeImageRecord(img.id);
      selectedImages.delete(img.id);
      sbToast("已删除");
      // 删除后刷新类目与网格
      await loadCats(); await loadCatMgmt(); await loadFavCats(); await loadManage();
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
})();
