/* ============================================================
 * 后台逻辑：Supabase 登录 + 管理员角色校验 + 传图到 Storage + 管理
 * ============================================================ */
(function () {
  const $ = (sel) => document.querySelector(sel);

  let pendingFiles = [];
  let uploading = false;
  let currentUser = null;
  let currentRole = null;

  document.addEventListener("DOMContentLoaded", () => {
    bindLogin(); bindLogout(); bindToken(); bindUpload(); bindManage();
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
      $("#upload-card").classList.toggle("hidden", true);
      $("#manage-card").classList.toggle("hidden", false);
      $("#no-perm").classList.remove("hidden");
    } else {
      $("#upload-card").classList.remove("hidden");
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

  // ================= 上传主流程（写入 Storage + DB） =================
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

  // ================= 分类下拉 =================
  async function loadCats() {
    let cats = [];
    try { cats = await SB.listCategories(); } catch (e) {}
    const sel = $("#cat-select");
    sel.innerHTML = "";
    if (cats.length) cats.forEach(c => sel.add(new Option(c, c)));
    sel.add(new Option("＋ 新建分类", "__new__"));
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
        <img src="${thumb}" class="m-thumb" alt="">
        <div class="m-info"><b>${img.name}</b><br><span>${img.category}</span></div>
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
    } catch (e) { sbToast("删除失败，请重试", false); }
  }

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