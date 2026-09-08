let recruitTasks = [];
  let recruitAllSubs = [];
  let recruitImgFiles = [];   // 批量待上传图片
  let recruitFilter = "";     // "" | published | submitted | bound
  let recruitSelected = new Set();  // 卡片勾选

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
    function renderRecruitPre() {
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
    const rankList = recruitTasks.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    list.forEach((t) => {
      const subs = recruitSubsFor(t.id);
      const spuList = [];
      subs.forEach(s => { (s.spus || []).forEach(sp => { if (sp && spuList.indexOf(sp) < 0) spuList.push(sp); }); });
      const seq = t.sort_no || (rankList.indexOf(t) + 1);
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
            '<button class="btn-ghost small rcac-tag">打标签</button>' +
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
      // 打标签
      card.querySelector(".rcac-tag").onclick = () => editRecruitTags(t);
      // 复制SPU
      card.querySelector(".rcac-copy").onclick = () => copyRecruitSps(t, spuList);
      // 任务ID 编辑
      const tidInput = card.querySelector(".rcac-tid-input");
      tidInput.value = t.task_id || "";
      tidInput.addEventListener("change", () => {
        const v = tidInput.value.trim();
        SB.updateRecruitTask(t.id, { task_id: v }).then(() => sbToast("任务ID已更新")).catch(e => sbToast("更新失败", false));
      });
      // 标签区渲染
      renderRecruitTags(card, t);
      box.appendChild(card);
    });
  }

  function renderRecruitTags(card, t) {
    const el = card.querySelector("[data-tags]");
    if (!el) return;
    const tags = Array.isArray(t.tags) ? t.tags : [];
    el.innerHTML = "";
    if (!tags.length) { el.innerHTML = '<span class="rcac-tag-empty">未打标签</span>'; return; }
    tags.forEach(tg => { const s = document.createElement("span"); s.className = "rcac-tag-chip"; s.textContent = tg; el.appendChild(s); });
  }

  function editRecruitTags(t) {
    const cur = (Array.isArray(t.tags) ? t.tags : []).join("，");
    const input = prompt("为该招品任务设置标签（多个用英文逗号分隔）：", cur);
    if (input === null) return;
    const tags = input.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);
    SB.updateRecruitTask(t.id, { tags }).then(() => { t.tags = tags; renderRecruitList(); sbToast("标签已更新"); }).catch(e => sbToast("更新失败", false));
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
    const rankList = recruitTasks.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    recruitTasks.forEach((t) => {
      const seq = t.sort_no || (rankList.indexOf(t) + 1);
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