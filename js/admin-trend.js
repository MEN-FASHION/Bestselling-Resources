/* ============================================================
 * TREND BANK · 后台管理（trend）
 * 说明：本文件由原单文件 admin.js 按面板拆分而来。
 *  - 共享状态在文件顶部声明（全局作用域，跨文件可见）
 *  - 函数定义在文件内 IIFE 中，末尾通过 Object.assign(window, {...}) 暴露给其它模块
 * ============================================================ */

/* ---------- 共享状态 ---------- */
// ================= 趋势专区管理（上传 / 列表 / 删除） =================
let trendPickedFile = null;

let trendPickedCover = null;

let trendList = [];

let trendCategory = "";

// 已选类目（引用视觉专区类目）
let trendCatOptions = [];

// —— 趋势文件二次编辑（独立状态，避免与上传表单冲突）——
let trendEditCatOptions = [];

// 编辑弹窗可选类目候选
let trendEditCategory = "";

// 编辑弹窗当前类目
let trendEditCover = null;

// 编辑弹窗新选封面（null=不替换）
let trendEditData = null;
(function () {

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
    bindTrendEditModal();
  }

async function loadTrendCatOptions() {
    try {
      let cats = await SB.listActiveCats().catch(() => []);
      cats = (cats || []).map(c => (typeof c === "string" ? c : (c && c.name) || "")).filter(Boolean);
      // 普通管理员：只显示被授权（趋势专区）的类目；超管/访客显示全部
      if (currentRole === "admin") {
        try {
          const mine = await SB.myZonePermissions("trend");
          const set = new Set((mine || []).map(s => (s || "").trim()));
          cats = cats.filter(c => set.has((c || "").trim()));
        } catch (e) {}
      }
      trendCatOptions = cats;
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
    // 必填校验：逐项提示哪一项没填
    if (!guardZone("trend", "无权限：只有可操作趋势专区的管理员可上传")) return;
    if (!trendPickedFile) return sbToast("未填写项：「PDF 文件」", false);
    if (!t) return sbToast("未填写项：「文件标题」", false);
    if (!trendCategory) return sbToast("未填写项：「选择类目」", false);
    if (!trendPickedCover) return sbToast("未填写项：「封面图」", false);
    const description = (document.querySelector("#trend-description")?.value || "").trim();
    if (!description) return sbToast("未填写项：「简介/介绍」", false);
    const tag = (document.querySelector('input[name="trend-tag"]:checked') || {}).value || "类目";
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
          '<button class="btn-ghost trend-edit">编辑</button>' +
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
      row.querySelector(".trend-edit").addEventListener("click", () => openTrendEditModal(t));
      box.appendChild(row);
    });
  }

function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

async function confirmDeleteTrend(t) {
    if (!confirm("确认删除趋势文件「" + (t.title || "") + "」？此操作会同时删除 R2 中的文件与封面。")) return;
    if (!guardZone("trend", "无权限：只有可操作趋势专区的管理员可删除")) return;
    try {
      await SB.deleteTrendFile(t.path, t.cover || "");
      await SB.removeTrendRecord(t.id);
      sbToast("已删除");
      loadTrendList();
    } catch (e) {
      sbToast("删除失败：" + (e.message || ""), false);
    }
  }

// ================= 趋势文件二次编辑 =================
  function renderTrendEditCatResults() {
    const catSearch = document.querySelector("#trend-edit-cat-search");
    const catResults = document.querySelector("#trend-edit-cat-results");
    if (!catSearch || !catResults) return;
    const kw = (catSearch.value || "").trim().toLowerCase();
    let list = trendEditCatOptions.filter(c => c && c !== trendEditCategory);
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

function chooseTrendEditCategory(c) {
    trendEditCategory = c;
    renderTrendEditCatChosen();
    const catSearch = document.querySelector("#trend-edit-cat-search");
    const catResults = document.querySelector("#trend-edit-cat-results");
    if (catSearch) catSearch.value = "";
    if (catResults) { catResults.innerHTML = ""; catResults.classList.add("hidden"); }
  }

function renderTrendEditCatChosen() {
    const box = document.querySelector("#trend-edit-cat-chosen");
    const tip = document.querySelector("#trend-edit-cat-tip");
    if (!box) return;
    box.innerHTML = "";
    if (trendEditCategory) {
      const chip = document.createElement("span");
      chip.className = "cat-chip";
      chip.innerHTML = '<span class="cc-name"></span><button type="button" class="cc-x" title="移除">×</button>';
      chip.querySelector(".cc-name").textContent = trendEditCategory;
      chip.querySelector(".cc-x").onclick = () => { trendEditCategory = ""; renderTrendEditCatChosen(); };
      box.appendChild(chip);
    }
    if (tip) tip.textContent = trendEditCategory
      ? "已选择：视觉专区类目「" + trendEditCategory + "」"
      : "搜索已有类目点选，或点下方按钮自定义添加新类目。";
  }

async function customAddTrendEditCategory() {
    const catSearch = document.querySelector("#trend-edit-cat-search");
    const name = (catSearch ? catSearch.value : "").trim();
    if (!name) { sbToast("请先在搜索框输入新类目名", false); return; }
    try {
      await SB.addCategory(name);
      if (!trendEditCatOptions.includes(name)) trendEditCatOptions = trendEditCatOptions.concat([name]);
      chooseTrendEditCategory(name);
      sbToast("已添加类目「" + name + "」");
    } catch (e) {
      sbToast("添加类目失败（可能已存在）：" + (e.message || ""), false);
    }
  }

function openTrendEditModal(t) {
    trendEditData = t;
    trendEditCover = null;
    const modal = document.querySelector("#trend-edit-modal");
    if (!modal) return;
    // 回填标题
    document.querySelector("#trend-edit-title-inp").value = t.title || "";
    // 回填标签
    const radios = document.querySelectorAll('input[name="trend-edit-tag"]');
    radios.forEach(r => { r.checked = (r.value === (t.tag || "类目")); });
    // 回填类目
    trendEditCategory = t.category || "";
    renderTrendEditCatChosen();
    // 回填简介
    document.querySelector("#trend-edit-desc").value = t.description || "";
    // 清空封面选择提示
    const covPick = document.querySelector("#trend-edit-cover-pick");
    if (covPick) { covPick.classList.add("hidden"); covPick.textContent = ""; }
    // 加载类目候选
    loadTrendEditCatOptions();
    // 显示弹窗
    modal.classList.remove("hidden");
  }

async function loadTrendEditCatOptions() {
    try {
      let cats = await SB.listActiveCats().catch(() => []);
      cats = (cats || []).map(c => (typeof c === "string" ? c : (c && c.name) || "")).filter(Boolean);
      if (currentRole === "admin") {
        try {
          const mine = await SB.myZonePermissions();
          const set = new Set((mine || []).map(s => (s || "").trim()));
          cats = cats.filter(c => set.has((c || "").trim()));
        } catch (e) {}
      }
      trendEditCatOptions = cats;
      renderTrendEditCatResults();
    } catch (e) {}
  }

function closeTrendEditModal() {
    const modal = document.querySelector("#trend-edit-modal");
    if (modal) modal.classList.add("hidden");
    const pw = document.querySelector("#trend-edit-progress-wrap");
    if (pw) pw.classList.add("hidden");
  }

async function saveTrendEdit() {
    if (!guardZone("trend", "无权限：只有可操作趋势专区的管理员可编辑")) return;
    const title = (document.querySelector("#trend-edit-title-inp").value || "").trim();
    const desc = (document.querySelector("#trend-edit-desc").value || "").trim();
    const radios = document.querySelectorAll('input[name="trend-edit-tag"]');
    const tag = Array.prototype.find.call(radios, r => r.checked)?.value || "类目";
    if (!title) return sbToast("未填写项：「文件标题」", false);
    if (!trendEditCategory) return sbToast("未填写项：「选择类目」", false);
    if (!desc) return sbToast("未填写项：「简介/介绍」", false);
    if (!trendEditData) return;
    const save = document.querySelector("#trend-edit-save");
    if (save) save.disabled = true;
    try {
      let cover = trendEditData.cover || "";
      if (trendEditCover) {
        const pw = document.querySelector("#trend-edit-progress-wrap");
        const pb = document.querySelector("#trend-edit-progress-bar");
        const pt = document.querySelector("#trend-edit-progress-text");
        if (pw) pw.classList.remove("hidden");
        const up = await SB.uploadTrendCover(trendEditCover, (p) => {
          if (pb) pb.style.width = p + "%";
          if (pt) pt.textContent = p + "%";
        });
        if (pw) pw.classList.add("hidden");
        cover = up.cover || cover;
        // 若替换成功，删除旧封面文件
        if (trendEditData.cover && up.cover) {
          try { await SB.deleteTrendFile("", trendEditData.cover); } catch (e) {}
        }
      }
      await SB.updateTrendRecord(trendEditData.id,
        { title, tag, category: trendEditCategory, description: desc, cover });
      sbToast("趋势文件已更新");
      closeTrendEditModal();
      loadTrendList();
    } catch (e) {
      sbToast("保存失败：" + (e.message || ""), false);
    } finally {
      if (save) save.disabled = false;
    }
  }

function bindTrendEditModal() {
    const modal = document.querySelector("#trend-edit-modal");
    if (!modal) return;
    const close = document.querySelector("#trend-edit-close");
    const cancel = document.querySelector("#trend-edit-cancel");
    if (close) close.addEventListener("click", closeTrendEditModal);
    if (cancel) cancel.addEventListener("click", closeTrendEditModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeTrendEditModal(); });
    document.querySelector("#trend-edit-save").addEventListener("click", saveTrendEdit);
    // 封面选择
    const covDz = document.querySelector("#trend-edit-cover-dropzone");
    const covInput = document.querySelector("#trend-edit-cover-input");
    const covPick = document.querySelector("#trend-edit-cover-pick");
    function setTrendEditCover(f) {
      trendEditCover = f;
      if (covPick) {
        covPick.classList.remove("hidden");
        covPick.textContent = "已选择新封面：" + f.name + "（保存后替换）";
      }
    }
    if (covDz) {
      covDz.addEventListener("click", () => { if (covInput) covInput.click(); });
      covDz.addEventListener("dragover", ev => { ev.preventDefault(); covDz.classList.add("hover"); });
      covDz.addEventListener("dragleave", () => covDz.classList.remove("hover"));
      covDz.addEventListener("drop", ev => {
        ev.preventDefault(); covDz.classList.remove("hover");
        const f = ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (f) setTrendEditCover(f);
      });
    }
    if (covInput) covInput.addEventListener("change", () => {
      const f = covInput.files && covInput.files[0];
      if (f) setTrendEditCover(f);
    });
    // 类目搜索与候选
    const catSearch = document.querySelector("#trend-edit-cat-search");
    const catResults = document.querySelector("#trend-edit-cat-results");
    if (catSearch) catSearch.addEventListener("input", renderTrendEditCatResults);
    if (catResults) {
      catResults.addEventListener("click", (e) => {
        const b = e.target.closest(".cat-option");
        if (b) chooseTrendEditCategory(b.dataset.cat);
      });
    }
    const addBtn = document.querySelector("#trend-edit-cat-add-btn");
    if (addBtn) addBtn.addEventListener("click", customAddTrendEditCategory);
    document.addEventListener("click", (e) => {
      if (catResults && !catResults.contains(e.target) && e.target !== catSearch) {
        catResults.classList.add("hidden");
      }
    });
  }

function fmtAdminDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const p = n => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) { return ""; }
  }

  /* 暴露给其它模块 / 事件绑定 */
  Object.assign(window, {
    bindTrend, loadTrendCatOptions, renderCatResults, chooseCategory, renderTrendCategoryChosen, customAddCategory, doUploadTrend, loadTrendList, renderTrendList, escapeHtml, confirmDeleteTrend, renderTrendEditCatResults, chooseTrendEditCategory, renderTrendEditCatChosen, customAddTrendEditCategory, openTrendEditModal, loadTrendEditCatOptions, closeTrendEditModal, saveTrendEdit, bindTrendEditModal, fmtAdminDate
  });

})();
