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

  document.addEventListener("DOMContentLoaded", () => {
    bindLogin(); bindLogout(); bindToken(); bindUpload(); bindManage(); bindFavCats(); bindCatMgmt();
    SB.onAuth((session) => {
      currentUser = session ? session.user : null;
      refreshUserBadge();
      if (session) enterPanel();
    });
  });

  // 顶部显示当前用户与角色
  async function refreshUserBadge() {
    const el = $("#token-status");
    if (!currentUser) { el.textContent = "未登录"; return; }
    currentRole = await SB.myRole();
    el.textContent = currentUser.email + " · " + (currentRole === "admin" ? "管理员" : "访客");
    el.classList.toggle("bad", currentRole !== "admin");
    if (currentRole !== "admin" && currentUser) {
      // 非管理员：隐藏上传区，只显示只读提示
      ["#upload-card", "#fav-card", "#cat-mgmt-card"].forEach(s => $(s)?.classList.add("hidden"));
      $("#manage-card").classList.toggle("hidden", false);
      $("#no-perm").classList.remove("hidden");
    } else {
      ["#upload-card", "#fav-card", "#cat-mgmt-card"].forEach(s => $(s)?.classList.remove("hidden"));
      $("#no-perm").classList.add("hidden");
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
    loadCats(); loadManage();
    if (currentRole === "admin") { loadFavCats(); loadCatMgmt(); }
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
    $("#cat-mgmt-add").onclick = () => {
      const v = $("#cat-mgmt-new").value.trim();
      if (!v) { sbToast("请输入类目名", false); return; }
      addOptionToCatMgmt(v);
      $("#cat-mgmt-new").value = "";
    };
  }
  async function loadCatMgmt() {
    try { currentActiveCats = await SB.listActiveCats(); } catch (e) { currentActiveCats = []; }
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
  async function saveCatMgmt() {
    const picked = [...document.querySelectorAll("#cat-mgmt-list input:checked")].map(i => i.value);
    // 同步差异：新增不在 categories 里的；删除未勾选的
    const toAdd = picked.filter(c => !currentActiveCats.includes(c));
    const toDel = currentActiveCats.filter(c => !picked.includes(c));
    try {
      for (const c of toAdd) await SB.addCategory(c);
      for (const c of toDel) await SB.removeCategory(c);
      currentActiveCats = picked;
      sbToast("前台类目已保存");
      $("#cat-mgmt-save").disabled = true;
      await loadCats(); await loadFavCats(); await loadManage();
    } catch (e) { sbToast("保存失败：" + (e.message || ""), false); }
  }

  // ================= 图片管理（删除） =================
  function bindManage() {
    $("#refresh-btn").onclick = async () => { await loadManage(); };
    $("#manage-cat").onchange = () => loadManage();
  }
  async function loadManage() {
    const box = $("#manage-list");
    box.innerHTML = "<p class='hint'>加载中…</p>";
    let imgs = [];
    try {
      const catVal = $("#manage-cat").value;
      imgs = await SB.listImages(catVal === "全部" ? null : (catVal || null));
    } catch (e) { box.innerHTML = "<p class='hint'>读取失败</p>"; return; }
    // 重新填充分类筛选下拉
    fillManageCat(imgs);
    box.innerHTML = "";
    if (!imgs.length) { box.innerHTML = "<p class='hint'>暂无图片</p>"; return; }
    // 一次性取当前登录令牌，给缩略图地址加上
    const adminToken = await SB.currentToken();
    for (const img of imgs) {
      const thumb = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "") + "/" + img.path + (adminToken ? "?token=" + encodeURIComponent(adminToken) : "");
      const row = document.createElement("div");
      row.className = "m-row";
      row.innerHTML = `
        <img src="${thumb}" class="m-thumb" alt="" draggable="false">
        <div class="m-info"><b>${escHtml(img.name || "")}</b><br><span>${escHtml(img.category || "")}</span></div>
        <button class="btn-danger" data-id="${img.id}">删除</button>`;
      row.querySelector(".btn-danger").onclick = () => removeImage(img, row);
      box.appendChild(row);
    }
  }
  async function fillManageCat(imgs) {
    const sel = $("#manage-cat");
    const prev = sel.value;
    const cats = ["全部"].concat(imgs ? [...new Set(imgs.map(i => i.category))] : []);
    sel.innerHTML = "";
    cats.forEach(c => { const o = new Option(c, c); sel.add(o); });
    if (cats.includes(prev)) sel.value = prev; else sel.value = "全部";
  }
  async function removeImage(img, row) {
    if (!confirm("确认删除该图片？")) return;
    try {
      if (img.path) await SB.deleteImage(img.path);
      await SB.removeImageRecord(img.id);
      sbToast("已删除");
      row.remove();
      // 删除后刷新类目（前台类目若没图了会自动不展示）
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
})();