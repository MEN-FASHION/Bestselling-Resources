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
      if (session) enterPanel();
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
    if (currentRole !== "admin" && currentUser) {
      // 非管理员：隐藏上传区，只显示只读提示
      ["#upload-card", "#access-card", "#tag-card", "#dash-card"].forEach(s => $(s)?.classList.add("hidden"));
      $("#manage-card").classList.toggle("hidden", false);
      $("#no-perm").classList.remove("hidden");
      // 非管理员侧边只保留“图片管理”
      document.querySelectorAll("#admin-panel .nav-item").forEach(n => {
        n.classList.toggle("hidden", n.dataset.target !== "manage-card");
      });
    } else {
      ["#upload-card", "#access-card", "#tag-card", "#dash-card"].forEach(s => $(s)?.classList.remove("hidden"));
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
      cap.className = "cell-cap mgr-cap";
      const mkCap = (lab, arr, cls) => `<span class="mgr-cap-row ${cls}"><i>${lab}</i>${(Array.isArray(arr) && arr.length) ? escHtml(arr.join("、")) : "未打标"}</span>`;
      cap.innerHTML =
        mkCap("类目", [img.category || ""], "cat") +
        mkCap("渠道", img.tags, "ch") +
        mkCap("风格", img.style_tags, "st") +
        mkCap("元素", img.element_tags, "el");

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
    if (!confirm("确认清空选中的 " + selectedImages.size + " 张图片的 渠道/风格/元素 全部标签？")) return;
    closeTagModal();
    try {
      await SB.clearImageFields([...selectedImages], ["tags", "style_tags", "element_tags"]);
      sbToast("已清空所选图片标签");
    } catch (e) {
      sbToast("清空失败：" + (e.message || ""), false);
    }
    await loadManage();
  }

  // ================= 标签管理（风格/元素自定义增删） =================
  async function loadTagDefs() {
    let defs = [];
    try { defs = await SB.listTagDefs(); } catch (e) { sbToast("读取标签失败", false); }
    const usage = {};
    try {
      const imgs = await SB.listImages(null);
      imgs.forEach(i => {
        (i.style_tags || []).forEach(t => usage["style:" + t] = (usage["style:" + t] || 0) + 1);
        (i.element_tags || []).forEach(t => usage["element:" + t] = (usage["element:" + t] || 0) + 1);
      });
    } catch (e) { /* 忽略用量统计失败 */ }
    renderTagDefs("style", defs.filter(d => d.type === "style"), usage);
    renderTagDefs("element", defs.filter(d => d.type === "element"), usage);
  }
  function renderTagDefs(type, list, usage) {
    const box = document.getElementById(type + "-tag-list");
    if (!box) return;
    box.innerHTML = "";
    if (!list.length) {
      box.innerHTML = `<p class="hint">暂无${type === "style" ? "风格" : "元素"}标签，可在下方新增。</p>`;
      return;
    }
    list.forEach(d => {
      const chip = document.createElement("span");
      chip.className = "tagdef-chip";
      const used = usage[type + ":" + d.name] || 0;
      chip.innerHTML = `<span class="tagdef-name">${escHtml(d.name)}</span><span class="tagdef-used">${used}张</span><button class="tagdef-del" title="删除该标签（同时移除图片上的该标签）">×</button>`;
      chip.querySelector(".tagdef-del").onclick = () => deleteTagDef(d, type, used);
      box.appendChild(chip);
    });
  }
  function bindTagDefs() {
    const setup = (addBtnId, inputId, type) => {
      document.getElementById(addBtnId).onclick = () => addTagDef(type, document.getElementById(inputId));
      document.getElementById(inputId).addEventListener("keydown", (e) => {
        if (e.key === "Enter") addTagDef(type, document.getElementById(inputId));
      });
    };
    setup("style-tag-add", "style-tag-new", "style");
    setup("element-tag-add", "element-tag-new", "element");
  }
  async function addTagDef(type, input) {
    const name = (input.value || "").trim();
    if (!name) { sbToast("请输入标签名", false); return; }
    try {
      await SB.addTagDef(type, name);
      input.value = "";
      sbToast("已添加标签：" + name);
      await loadTagDefs();
    } catch (e) { sbToast("添加失败：" + (e.message || ""), false); }
  }
  async function deleteTagDef(def, type, used) {
    const tname = def.name;
    if (!confirm("确认删除「" + tname + "」" + (used > 0 ? "？该标签当前被 " + used + " 张图片使用，将一并移除。" : "？"))) return;
    try {
      if (used > 0) {
        const field = type === "style" ? "style_tags" : "element_tags";
        const imgs = await SB.listImages(null);
        let n = 0;
        for (const img of imgs) {
          if (!Array.isArray(img[field]) || !img[field].includes(tname)) continue;
          await SB.updateImageField(img.id, field, img[field].filter(t => t !== tname));
          n++;
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
    const hasAny = i => ["tags", "style_tags", "element_tags"].some(f => Array.isArray(i[f]) && i[f].length);
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

    // 三个标签维度分布条形图
    const charts = [
      { el: "dash-channel", field: "tags", names: (window.CONFIG.CHANNEL_TAGS || []).flatMap(g => g.tags || []), color: "var(--gold)", lab: "渠道" },
      { el: "dash-style", field: "style_tags", names: defs.filter(d => d.type === "style").map(d => d.name), color: "#6ea8fe", lab: "风格" },
      { el: "dash-element", field: "element_tags", names: defs.filter(d => d.type === "element").map(d => d.name), color: "#7ee0a3", lab: "元素" }
    ];
    charts.forEach(cd => {
      const rows = cd.names.map(n => ({ name: n, count: imgs.filter(i => Array.isArray(i[cd.field]) && i[cd.field].includes(n)).length }));
      rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));
      renderHBars(document.getElementById(cd.el), rows, imgs.length, cd.color, cd.lab);
    });

    // 打标覆盖率环形图
    const rate = imgs.length ? tagged / imgs.length : 0;
    const deg = Math.round(rate * 360 * 10) / 10;
    const donut = $("#dash-donut");
    donut.innerHTML = `<div class="donut" style="background:conic-gradient(var(--gold) 0 ${deg}deg, rgba(255,255,255,.08) ${deg}deg 360deg)"><div class="donut-hole"><b>${(rate * 100).toFixed(1)}%</b><span>打标覆盖率</span></div></div>`;
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

// ================= 智能打标（拖拽池：左=已打，右=未打） =================
  let smartDim = "style";          // 当前维度: style / element / channel
  let smartTag = "";               // 当前选中标签
  let smartAll = [];               // 全量图片缓存
  let smartDragging = null;        // 正在拖拽的图片对象
  const smartFieldMap = { style: "style_tags", element: "element_tags", channel: "tags" };

  function openSmartModal() {
    if (!document.querySelector("#smart-modal")) return;
    document.querySelector("#smart-modal").classList.remove("hidden");
    smartDim = "style"; smartTag = "";
    renderSmartDims();
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
      { key: "style", label: "风格" },
      { key: "element", label: "元素" },
      { key: "channel", label: "渠道" }
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
        renderSmartPools([]);
        await loadSmartAll();
      };
      box.appendChild(b);
    });
  }
  async function loadSmartAll() {
    try { smartAll = await SB.listImages(null); }
    catch (e) { sbToast("读取图片失败", false); return; }
    // 渲染该维度的标签选择条（渠道用固定清单，风格/元素用 tag_defs）
    if (smartDim === "channel") {
      const list = (window.CONFIG.CHANNEL_TAGS || []).flatMap(g => g.tags || []);
      renderSmartTags([...new Set(list)]);
      return;
    }
    try {
      const defs = await SB.listTagDefs();
      const list = (defs || []).filter(d => d.type === smartDim).map(d => d.name);
      renderSmartTags([...new Set(list)]);
    } catch (e) { renderSmartTags([]); sbToast("读取标签失败", false); }
  }
  function renderSmartTags(list) {
    const box = document.querySelector("#smart-tags");
    if (!box) return;
    box.innerHTML = "";
    if (!list.length) {
      const t = document.createElement("span");
      t.className = "smart-tag-empty";
      t.textContent = smartDim === "channel"
        ? "暂无渠道标签（请在 config.js 维护 CHANNEL_TAGS）"
        : "暂无" + ({ style: "风格", element: "元素" }[smartDim] || "") + "标签，请到「⑥ 标签管理」新增";
      box.appendChild(t);
      return;
    }
    list.forEach(tag => {
      const b = document.createElement("button");
      b.className = "smart-tag" + (tag === smartTag ? " active" : "");
      b.textContent = tag;
      b.onclick = () => {
        smartTag = tag;
        renderSmartTags(list);
        renderSmartPools(smartAll);
      };
      box.appendChild(b);
    });
  }
  function renderSmartPools() {
    const doneGrid = document.querySelector("#smart-grid-done");
    const undoneGrid = document.querySelector("#smart-grid-undone");
    if (!doneGrid || !undoneGrid) return;
    doneGrid.innerHTML = "";
    undoneGrid.innerHTML = "";
    document.querySelector("#smart-cnt-done").textContent = "0";
    document.querySelector("#smart-cnt-undone").textContent = "0";
    if (!smartTag) return;
    const field = smartFieldMap[smartDim];
    const tarId = smartTag;
    const doneList = [], undoneList = [];
    smartAll.forEach(img => {
      const has = Array.isArray(img[field]) && img[field].includes(tarId);
      (has ? doneList : undoneList).push(img);
    });
    document.querySelector("#smart-cnt-done").textContent = doneList.length;
    document.querySelector("#smart-cnt-undone").textContent = undoneList.length;
    doneList.forEach(img => doneGrid.appendChild(makeSmartCard(img, true)));
    undoneList.forEach(img => undoneGrid.appendChild(makeSmartCard(img, false)));
  }
  function makeSmartCard(img, isDone) {
    const card = document.createElement("div");
    card.className = "smart-card";
    card.draggable = true;
    card.dataset.id = img.id;
    const wrap = document.createElement("div");
    wrap.className = "holder";
    const im = document.createElement("img");
    im.dataset.src = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "") + "/" + img.path;
    // 缩略图懒加载
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es, ob) => {
        es.forEach(en => {
          if (en.isIntersecting) { en.target.src = en.target.dataset.src; ob.unobserve(en.target); }
        });
      }, { root: document.querySelector("#smart-modal") });
      io.observe(im);
    } else { im.src = im.dataset.src; }
    wrap.appendChild(im);
    const cap = document.createElement("div");
    cap.className = "smart-cap";
    const lbl = document.createElement("span");
    lbl.className = "smart-cap-name";
    lbl.textContent = img.name || img.id;
    lbl.title = (img.name || img.id) + "　" + (img.category || "");
    const btn = document.createElement("button");
    btn.className = "smart-move";
    btn.textContent = isDone ? "←" : "→";
    btn.title = isDone ? "移除「" + smartTag + "」标签" : "打上「" + smartTag + "」标签";
    btn.onclick = (e) => { e.stopPropagation(); moveSmart(img.id, !isDone); };
    cap.appendChild(lbl);
    cap.appendChild(btn);
    card.appendChild(wrap);
    card.appendChild(cap);

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
  }
  async function moveSmart(id, toDone) {
    if (!smartTag) { sbToast("请先在中间选择一个标签", false); return; }
    const field = smartFieldMap[smartDim];
    const img = smartAll.find(i => i.id === id);
    if (!img) return;
    const cur = Array.isArray(img[field]) ? img[field] : [];
    let next;
    if (toDone) next = [...new Set(cur.concat([smartTag]))];
    else next = cur.filter(t => t !== smartTag);
    try {
      await SB.updateImageField(img.id, field, next);
      img[field] = next;
      sbToast(toDone ? "已为图片打上「" + smartTag + "」标签" : "已移除「" + smartTag + "」标签");
      // 重新划分两池（保持已选标签高亮）
      renderSmartPools();
    } catch (e) {
      sbToast("操作失败：" + (e.message || ""), false);
    }
  }
  function bindSmartModal() {
    const openBtn = document.querySelector("#smart-tag-btn");
    if (openBtn) openBtn.addEventListener("click", openSmartModal);
    const closeBtn = document.querySelector("#smart-close");
    if (closeBtn) closeBtn.addEventListener("click", closeSmartModal);
    bindSmartDrop();
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
  let recruitImgFile = null;
  let recruitEditingId = null;
  let recruitOldImgPath = null;

  function bindRecruit() {
    const upBtn = document.querySelector("#recruit-save");
    const refresh = document.querySelector("#recruit-refresh");
    const imgDz = document.querySelector("#recruit-img-dropzone");
    const imgInput = document.querySelector("#recruit-img-input");
    const imgPick = document.querySelector("#recruit-img-pick");
    const taskEl = document.querySelector("#recruit-taskid");
    if (imgDz && imgInput) {
      imgDz.addEventListener("click", () => imgInput.click());
      imgDz.addEventListener("dragover", (e) => e.preventDefault());
      imgDz.addEventListener("drop", (e) => {
        e.preventDefault();
        const f = e.dataTransfer.files ? e.dataTransfer.files[0] : null;
        if (f) setRecruitImg(f);
      });
      imgInput.addEventListener("change", () => { if (imgInput.files && imgInput.files[0]) setRecruitImg(imgInput.files[0]); });
    }
    function setRecruitImg(f) {
      if (!/^image\//i.test(f.type || "") && !/\.(jpe?g|png|webp)$/i.test(f.name || "")) { sbToast("仅支持图片", false); return; }
      recruitImgFile = f;
      if (imgPick) { imgPick.textContent = "已选择：" + f.name; imgPick.classList.remove("hidden"); }
      refreshRecruitSave();
    }
    function refreshRecruitSave() {
      const t = (taskEl ? taskEl.value : "").trim();
      if (upBtn) upBtn.disabled = !t;
    }
    if (taskEl) taskEl.addEventListener("input", refreshRecruitSave);
    if (upBtn) upBtn.addEventListener("click", saveRecruitTask);
    if (refresh) refresh.addEventListener("click", loadRecruitList);
    const exportBtn = document.querySelector("#recruit-export");
    if (exportBtn) exportBtn.addEventListener("click", exportRecruitExcel);
  }

  async function saveRecruitTask() {
    const taskId = (document.querySelector("#recruit-taskid")?.value || "").trim();
    if (!taskId) return sbToast("请填写任务ID", false);
    try {
      let imagePath = recruitEditingId ? (recruitOldImgPath || "") : "";
      if (recruitImgFile) {
        imagePath = await SB.uploadRecruitImage(recruitImgFile);
        if (recruitOldImgPath && recruitOldImgPath !== imagePath) await SB.deleteRecruitImage(recruitOldImgPath).catch(() => {});
      }
      if (recruitEditingId) {
        await SB.updateRecruitTask(recruitEditingId, { task_id: taskId, image_path: imagePath });
        sbToast("已更新招品任务");
      } else {
        await SB.addRecruitTask({ task_id: taskId, image_path: imagePath });
        sbToast("招品任务已发布");
      }
      resetRecruitForm();
      loadRecruitList();
    } catch (e) { sbToast("保存失败：" + (e.message || ""), false); }
  }

  function resetRecruitForm() {
    recruitImgFile = null;
    recruitEditingId = null;
    recruitOldImgPath = null;
    ["#recruit-taskid"].forEach(sel => { const el = document.querySelector(sel); if (el) el.value = ""; });
    const imgInput = document.querySelector("#recruit-img-input"); if (imgInput) imgInput.value = "";
    const imgPick = document.querySelector("#recruit-img-pick"); if (imgPick) { imgPick.classList.add("hidden"); imgPick.textContent = ""; }
    const upBtn = document.querySelector("#recruit-save"); if (upBtn) upBtn.disabled = true;
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
  function renderRecruitList() {
    const box = document.querySelector("#recruit-list");
    const cnt = document.querySelector("#recruit-count");
    if (!box) return;
    if (cnt) cnt.textContent = recruitTasks.length + " 个任务";
    box.innerHTML = "";
    if (!recruitTasks.length) {
      box.innerHTML = '<p class="hint">暂无招品任务，先在上方上传一张招品图片。</p>';
      return;
    }
    recruitTasks.forEach((t, idx) => {
      const subs = recruitSubsFor(t.id);
      const spuList = [];
      subs.forEach(s => { (s.spus || []).forEach(sp => { if (sp && spuList.indexOf(sp) < 0) spuList.push(sp); }); });
      const seq = idx + 1;
      const row = document.createElement("div");
      row.className = "recruit-admin-row";
      row.innerHTML =
        '<div class="recruit-img"></div>' +
        '<div class="recruit-admin-info">' +
          '<div class="recruit-admin-title"></div>' +
          '<div class="recruit-admin-meta"></div>' +
          '<div class="recruit-admin-sub hidden2"></div>' +
        '</div>' +
        '<div class="recruit-admin-ops">' +
          '<button class="btn-ghost rec-copy">复制SPU</button>' +
          '<button class="btn-ghost rec-edit">编辑</button>' +
          '<button class="btn-danger rec-del">删除</button>' +
        '</div>';
      const img = row.querySelector(".recruit-img");
      if (t.image_path) {
        SB.recruitImageUrl(t.image_path).then(u => { if (!img.dataset.loaded) { img.style.backgroundImage = "url('" + u + "')"; img.dataset.loaded = "1"; } }).catch(() => { if (!img.dataset.loaded) img.innerHTML = '<span class="tcov-ic">图</span>'; });
      } else {
        img.innerHTML = '<span class="tcov-ic">图</span>';
      }
      row.querySelector(".recruit-admin-title").textContent = "任务ID：" + t.task_id + "　·　序号 #" + seq;
      row.querySelector(".recruit-admin-meta").textContent = "序号 #" + seq + " · 已提交 " + subs.length + " 人 / " + spuList.length + " 个SPU";
      const subEl = row.querySelector(".recruit-admin-sub");
      if (spuList.length) { subEl.textContent = "已提交SPU：" + spuList.join("，"); subEl.classList.remove("hidden2"); }
      const tip = spuList.length ? ("该任务已提交货品SPU：\n" + spuList.join("\n")) : "该任务暂无商家提交SPU";
      row.querySelector(".recruit-img").title = tip;
      row.querySelector(".recruit-admin-title").title = tip;
      row.querySelector(".rec-copy").addEventListener("click", () => copyRecruitSps(t, spuList));
      row.querySelector(".rec-edit").addEventListener("click", () => editRecruitTask(t));
      row.querySelector(".rec-del").addEventListener("click", () => confirmDeleteRecruit(t));
      box.appendChild(row);
    });
  }

  async function copyRecruitSps(t, spuList) {
    if (!spuList.length) return sbToast("该任务暂无SPU可复制", false);
    try {
      await navigator.clipboard.writeText(spuList.join(","));
      sbToast("已复制 " + spuList.length + " 个SPU");
    } catch (e) { sbToast("复制失败", false); }
  }

  function editRecruitTask(t) {
    recruitEditingId = t.id;
    recruitOldImgPath = t.image_path || null;
    document.querySelector("#recruit-taskid").value = t.task_id || "";
    recruitImgFile = null;
    const imgInput = document.querySelector("#recruit-img-input"); if (imgInput) imgInput.value = "";
    document.querySelector("#recruit-save").disabled = false;
    sbToast("正在编辑任务ID：" + t.task_id);
  }

  async function confirmDeleteRecruit(t) {
    if (!confirm("确认删除招品任务ID「" + t.task_id + "」？其图片与商家提交记录会一并移除。")) return;
    try {
      if (t.image_path) await SB.deleteRecruitImage(t.image_path).catch(() => {});
      await SB.removeRecruitTask(t.id);
      sbToast("已删除");
      loadRecruitList();
    } catch (e) { sbToast("删除失败：" + (e.message || ""), false); }
  }

  function exportRecruitExcel() {
    if (!recruitTasks.length) return sbToast("暂无招品任务可导出", false);
    if (typeof XLSX === "undefined") return sbToast("导出组件未加载，请联网后重试", false);
    const rows = [];
    recruitTasks.forEach((t, ti) => {
      const seq = ti + 1;
      const subs = recruitSubsFor(t.id);
      subs.forEach(s => {
        rows.push({ 任务ID: t.task_id, 前台序号: seq, 商家前台用户ID: s.user_id, 货品SPU: (s.spus || []).join(",") });
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
