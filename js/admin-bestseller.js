/* ============================================================
 * TREND BANK · 后台管理（bestseller）
 * 说明：本文件由原单文件 admin.js 按面板拆分而来。
 *  - 共享状态在文件顶部声明（全局作用域，跨文件可见）
 *  - 函数定义在文件内 IIFE 中，末尾通过 Object.assign(window, {...}) 暴露给其它模块
 * ============================================================ */

/* ---------- 共享状态 ---------- */
// ================= BESTSELLER 专区：后台管理 =================
let bestsellerTasks = [];

let bestsellerAllSubs = [];

let bestsellerFilter = "";

// "" | published | submitted | bound
let bestsellerFlagFilter = "";

// 标记筛选 "" | ip | brand | cat_mismatch | no_refill
let bestsellerSideCat = "";

// 左侧类目菜单当前选中类目（"" = 全部）
let bestsellerSideCats = [];

// 左侧类目菜单类目列表
let bestsellerFlagCat = "";

// 标记统计类目筛选（"" = 全部类目）
let bestsellerSelected = new Set();

// 卡片勾选
let bestsellerTrash = [];

// 回收站任务
let bestsellerTrashSelected = new Set();

// 回收站勾选
let bestsellerInTrash = false;

// 将解析出的主图URL卡片以预览形式展示，确认后一键写入
let bsUrlImportPending = [];

// BESTSELLER：批量上传图片（图片文件 + 一个表格，按图片文件名匹配「SKUID」绑定信息与链接）
let bsImgPending = [];

// 待导入的图片文件数组
let bsImgMatchRows = [];
(function () {

function bindBestsellerMatchClear() {
    const uClear = document.querySelector("#bestseller-urlimport-clear");
    if (uClear) uClear.addEventListener("click", () => clearPane("#bestseller-urlimport-input", "#bestseller-urlimport-preview", "#bestseller-urlimport-file", "#bestseller-urlimport-result", "#bestseller-urlimport-prog", "#bestseller-urlimport-progbar", () => { bsUrlImportPending = []; }));
    const iInput = document.querySelector("#bestseller-imgimport-input");
    const xInput = document.querySelector("#bestseller-imgxlsx-input");
    const iClear = document.querySelector("#bestseller-imgimport-clear");
    if (iClear) iClear.addEventListener("click", () => { if (iInput) iInput.value = ""; if (xInput) xInput.value = ""; clearPane("#bestseller-imgimport-input", "#bestseller-imgimport-preview", "#bestseller-imgimport-file", "#bestseller-imgimport-result", "#bestseller-imgimport-prog", "#bestseller-imgimport-progbar", () => { bsImgPending = []; bsImgMatchRows = []; }); });
  }

function renderBestsellerFlagStats() {
    renderTaskFlagStats(bestsellerTasks, bestsellerFlagCat, "#bestseller-flag-charts", "#bestseller-flag-total");
    renderTaskStatusStats(bestsellerTasks, bestsellerFlagCat, "#bestseller-status-stats", "bestseller");
  }

function loadBestsellerCatPicker() { fillZoneCatSelect("bestseller"); }

function loadBestsellerCatSettings() {
    const btn = $("#bestseller-cat-mgr");
    if (btn && !btn._bound) { btn._bound = true; btn.onclick = () => openZoneCatModal("bestseller"); }
  }

// BESTSELLER：直接用主图URL批量导入（表格列：Goods ID / SKUID / 站点 / 最新上榜时间 / 链接 / 主图URL）
  async function handleBestsellerUrlImport(files) {
    if (typeof XLSX === "undefined") return sbToast("Excel解析组件未加载，请联网后重试", false);
    if (!files || !files.length) return;
    const file = files[0];
    const mr = document.querySelector("#bestseller-urlimport-result");
    const fname = document.querySelector("#bestseller-urlimport-file");
    if (fname) fname.textContent = file.name;
    upShow("#bestseller-urlimport-prog", "#bestseller-urlimport-progbar", "#bestseller-urlimport-progtxt", 30, "正在解析表格…");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (!rows.length) return sbToast("表格没有数据行", false);
        // 列名容错映射
        let goodsKey = null, skuKey = null, siteKey = null, rankKey = null, linkKey = null, imgKey = null;
        if (rows.length) {
          const keys = Object.keys(rows[0]);
          for (const k of keys) {
            const lk = String(k).toLowerCase().replace(/\s+/g, "");
            if (!goodsKey && (lk.includes("goods") || lk.includes("竞品goodsid") || lk.includes("商品id"))) goodsKey = k;
            if (!skuKey && (lk.includes("sku") || lk.includes("竞品skuid"))) skuKey = k;
            if (!siteKey && (lk.includes("站点") || lk.includes("site"))) siteKey = k;
            if (!rankKey && (lk.includes("上榜") || lk.includes("rank") || lk.includes("上榜时间") || lk.includes("时间"))) rankKey = k;
            if (!linkKey && (lk.includes("竞品链接") || lk.includes("链接") || lk.includes("url"))) linkKey = k;
            if (!imgKey && (lk.includes("主图") || lk.includes("图片") || lk.includes("img") || lk.includes("imageurl"))) imgKey = k;
          }
        }
        if (!imgKey) return sbToast("未找到「主图URL」列，请检查表头", false);
        const imgs = [];  // 暂存待导入卡片，主图URL为必要字段
        rows.forEach(r => {
          const main_img_url = String(r[imgKey] || "").trim();
          if (!main_img_url) return;
          imgs.push({
            main_img_url,
            goods_id: goodsKey ? String(r[goodsKey] || "").trim() : "",
            sku_id: skuKey ? String(r[skuKey] || "").trim() : "",
            site: siteKey ? String(r[siteKey] || "").trim() : "",
            rank_time: rankKey ? String(r[rankKey] || "").trim() : "",
            url: linkKey ? String(r[linkKey] || "").trim() : "",
            task_id: "",
            image_path: "",
          });
        });
        if (!imgs.length) return sbToast("表格中没有有效的「主图URL」数据行", false);
        const cat = document.querySelector("#bestseller-category")?.value || "";
        imgs.forEach(x => x.category = cat);
        if (mr) { mr.textContent = "解析成功 " + imgs.length + " 行，准备导入"; mr.className = "url-match-result ok"; }
        sbToast("已解析 " + imgs.length + " 条信息", true);
        upShow("#bestseller-urlimport-prog", "#bestseller-urlimport-progbar", "#bestseller-urlimport-progtxt", 100, "解析完成 " + imgs.length + " 条");
        let __uHide = setTimeout(() => upHide("#bestseller-urlimport-prog", "#bestseller-urlimport-progbar"), 800);
        buildBestsellerUrlImport(imgs, mr);
      } catch (e) {
        upHide("#bestseller-urlimport-prog", "#bestseller-urlimport-progbar");
        if (mr) { mr.textContent = "表格解析失败，请检查文件格式"; mr.className = "url-match-result"; }
        sbToast("表格解析失败，请检查文件格式", false);
      }
    };
    reader.readAsArrayBuffer(file);
  }

function buildBestsellerUrlImport(imgs, mr) {
    bsUrlImportPending = imgs;
    const pre = document.querySelector("#bestseller-urlimport-preview");
    if (pre) {
      pre.classList.remove("hidden");
      pre.innerHTML = "";
      imgs.forEach((x) => {
        const cell = document.createElement("div");
        cell.className = "bestseller-pre-cell";
        const im = document.createElement("img");
        im.src = x.main_img_url;
        const lbl = document.createElement("div");
        lbl.className = "bestseller-pre-url";
        lbl.innerHTML = `<span>${x.goods_id || ""}${x.sku_id ? " · " + x.sku_id : ""}</span>${x.url ? '<span class="purl">🔗 已绑定链接</span>' : ""}`;
        cell.appendChild(im); cell.appendChild(lbl);
        pre.appendChild(cell);
      });
      const row = document.createElement("div");
      row.className = "bestseller-pre-commit";
      row.innerHTML = '<button id="bestseller-urlimport-commit" class="btn-primary" type="button">导入这 ' + imgs.length + ' 条卡片</button>';
      pre.appendChild(row);
      row.querySelector("#bestseller-urlimport-commit").onclick = () => commitBestsellerUrlImport();
    }
    if (mr) mr.textContent = "下方为预览（共 " + imgs.length + " 行），点「导入」写入任务卡片";
  }

async function commitBestsellerUrlImport() {
    if (!guardZone("bestseller", "无权限：只有可操作BESTSELLER专区的管理员可导入")) return;
    if (!bsUrlImportPending.length) return sbToast("没有待导入数据", false);
    const cat = document.querySelector("#bestseller-category")?.value || "";
    if (!cat) { sbToast("请先选择上传类目再导入", false); return; }   // 类目必选：不选无法导入
    const rows = bsUrlImportPending.map(x => ({ ...x, category: cat, status: "published", title: "" }));
    try {
      await SB.addBestsellerTasks(rows);
      bsUrlImportPending = [];
      const pre = document.querySelector("#bestseller-urlimport-preview");
      if (pre) { pre.classList.add("hidden"); pre.innerHTML = ""; }
      sbToast("已导入 " + rows.length + " 条任务卡片", true);
      loadBestsellerList();
    } catch (e) { sbToast("导入失败：" + (e.message || ""), false); }
  }

// 解析到的表格匹配行
  async function handleBestsellerImgImport(images, xlsxFile) {
    if (typeof XLSX === "undefined") return sbToast("Excel解析组件未加载，请联网后重试", false);
    if (!images || !images.length) return sbToast("请先选择要上传的图片", false);
    if (!xlsxFile) return sbToast("请选择匹配表格", false);
    const mr = document.querySelector("#bestseller-imgimport-result");
    const fname = document.querySelector("#bestseller-imgimport-file");
    if (fname) fname.textContent = images.length + " 张图片 + " + xlsxFile.name;
    upShow("#bestseller-imgimport-prog", "#bestseller-imgimport-progbar", "#bestseller-imgimport-progtxt", 30, "正在解析表格…");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (!rows.length) return sbToast("表格没有数据行", false);
        // 列名容错映射（图片文件名去扩展名后用于匹配「SKUID」）
        let goodsKey = null, skuKey = null, siteKey = null, rankKey = null, linkKey = null;
        if (rows.length) {
          const keys = Object.keys(rows[0]);
          for (const k of keys) {
            const lk = String(k).toLowerCase().replace(/\s+/g, "");
            if (!goodsKey && (lk.includes("goods") || lk.includes("竞品goodsid") || lk.includes("商品id"))) goodsKey = k;
            if (!skuKey && (lk.includes("sku") || lk.includes("竞品skuid"))) skuKey = k;
            if (!siteKey && (lk.includes("站点") || lk.includes("site"))) siteKey = k;
            if (!rankKey && (lk.includes("上榜") || lk.includes("rank") || lk.includes("上榜时间") || lk.includes("时间"))) rankKey = k;
            if (!linkKey && (lk.includes("竞品链接") || lk.includes("链接") || lk.includes("url"))) linkKey = k;
          }
        }
        if (!skuKey && !goodsKey) return sbToast("未找到「Goods ID / SKUID」列，请检查表头", false);
        // 建立两张映射表：SKUID -> 行、GoodsID -> 行（去空格归一化）
        const skuMap = {}, goodsMap = {};
        rows.forEach(r => {
          const info = {
            goods_id: goodsKey ? String(r[goodsKey] || "").trim() : "",
            sku_id: skuKey ? String(r[skuKey] || "").trim() : "",
            site: siteKey ? String(r[siteKey] || "").trim() : "",
            rank_time: rankKey ? String(r[rankKey] || "").trim() : "",
            url: linkKey ? String(r[linkKey] || "").trim() : "",
          };
          const sid = info.sku_id.replace(/\s+/g, "");
          const gid = info.goods_id.replace(/\s+/g, "");
          if (sid && !skuMap[sid]) skuMap[sid] = { info, matchedBy: "SKUID" };
          if (gid && !goodsMap[gid]) goodsMap[gid] = { info, matchedBy: "Goods ID" };
        });
        // 按图片文件名（去扩展名）优先匹配 SKUID，匹配不到再回退 Goods ID
        const matched = [];
        let unmatched = 0;
        images.forEach(imgFile => {
          let base = (imgFile.name || "").replace(/\.[^.]+$/, "").trim();
          const key = base.replace(/\s+/g, "");
          let hit = skuMap[key] || goodsMap[key];
          if (hit) matched.push({ file: imgFile, info: hit.info, matchedBy: hit.matchedBy });
          else unmatched++;
        });
        if (!matched.length) { if (mr) { mr.textContent = "没有图片能匹配到表格里的Goods ID / SKUID"; mr.className = "url-match-result"; } return sbToast("没有图片能匹配到Goods ID / SKUID，请核对文件名", false); }
        bsImgPending = matched;
        bsImgMatchRows = matched;
        const cat = document.querySelector("#bestseller-category")?.value || "";
        if (mr) { mr.textContent = "匹配成功 " + matched.length + " 张图片" + (unmatched ? "，" + unmatched + " 张未匹配被跳过" : "") + (cat ? "" : "（请先选择上传类目）"); mr.className = "url-match-result ok"; }
        sbToast("匹配成功 " + matched.length + " 张图片" + (unmatched ? "，" + unmatched + " 张未匹配" : ""), true);
        upShow("#bestseller-imgimport-prog", "#bestseller-imgimport-progbar", "#bestseller-imgimport-progtxt", 100, "匹配成功 " + matched.length + " 张");
        let __uHide2 = setTimeout(() => upHide("#bestseller-imgimport-prog", "#bestseller-imgimport-progbar"), 800);
        buildBestsellerImgImport(matched, mr);
      } catch (e) {
        upHide("#bestseller-imgimport-prog", "#bestseller-imgimport-progbar");
        if (mr) { mr.textContent = "表格解析失败，请检查文件格式"; mr.className = "url-match-result"; }
        sbToast("表格解析失败，请检查文件格式", false);
      }
    };
    reader.readAsArrayBuffer(xlsxFile);
  }

function buildBestsellerImgImport(matched, mr) {
    const pre = document.querySelector("#bestseller-imgimport-preview");
    if (pre) {
      pre.classList.remove("hidden");
      pre.innerHTML = "";
      matched.forEach((m) => {
        const cell = document.createElement("div");
        cell.className = "bestseller-pre-cell";
        const im = document.createElement("img");
        im.src = URL.createObjectURL(m.file);
        const lbl = document.createElement("div");
        lbl.className = "bestseller-pre-url";
        lbl.innerHTML = `<span>${m.info.goods_id || ""}${m.info.sku_id ? " · " + m.info.sku_id : ""}${m.matchedBy ? "（" + m.matchedBy + "匹配）" : ""}</span>${m.info.url ? '<span class="purl">🔗 已绑定链接</span>' : ""}`;
        cell.appendChild(im); cell.appendChild(lbl);
        pre.appendChild(cell);
      });
      const row = document.createElement("div");
      row.className = "bestseller-pre-commit";
      row.innerHTML = '<button id="bestseller-imgimport-commit" class="btn-primary" type="button">上传并导入这 ' + matched.length + ' 张图片</button>';
      pre.appendChild(row);
      row.querySelector("#bestseller-imgimport-commit").onclick = () => commitBestsellerImgImport();
    }
    if (mr) mr.textContent = "下方为预览（共 " + matched.length + " 行），点「上传并导入」图片存R2并写入任务卡片";
  }

async function commitBestsellerImgImport() {
    if (!guardZone("bestseller", "无权限：只有可操作BESTSELLER专区的管理员可导入")) return;
    if (!bsImgPending.length) return sbToast("没有待导入图片", false);
    const cat = document.querySelector("#bestseller-category")?.value || "";
    if (!cat) { sbToast("请先选择上传类目再导入", false); return; }   // 类目必选：不选无法导入
    const commitBtn = document.querySelector("#bestseller-imgimport-commit");
    if (commitBtn) { commitBtn.disabled = true; commitBtn.textContent = "正在上传…"; }
    const _total = bsImgPending.length;
    const rows = [];
    for (let i = 0; i < _total; i++) {
      const m = bsImgPending[i];
      try {
        const path = await SB.uploadBestsellerImage(m.file);
        upShow("#bestseller-imgimport-prog", "#bestseller-imgimport-progbar", "#bestseller-imgimport-progtxt", Math.round((i + 1) / _total * 100), "上传中 " + (i + 1) + "/" + _total);
        rows.push({
          image_path: path,
          main_img_url: "",
          goods_id: m.info.goods_id,
          sku_id: m.info.sku_id,
          site: m.info.site,
          rank_time: m.info.rank_time,
          url: m.info.url,
          task_id: "",
          category: cat,
          status: "published",
          title: "",
        });
      } catch (e) {
        sbToast("图片上传失败：" + (e.message || m.file.name), false);
        upHide("#bestseller-imgimport-prog", "#bestseller-imgimport-progbar");
        if (commitBtn) { commitBtn.disabled = false; commitBtn.textContent = "上传并导入这 " + bsImgPending.length + " 张图片"; }
        return;
      }
    }
    try {
      await SB.addBestsellerTasks(rows);
      bsImgPending = []; bsImgMatchRows = [];
      const pre = document.querySelector("#bestseller-imgimport-preview");
      if (pre) { pre.classList.add("hidden"); pre.innerHTML = ""; }
      sbToast("已导入 " + rows.length + " 条任务卡片", true);
      loadBestsellerList();
    } catch (e) { sbToast("导入失败：" + (e.message || ""), false); }
    if (commitBtn) { commitBtn.disabled = false; commitBtn.textContent = "上传并导入这 " + (rows.length || 0) + " 张图片"; }
  }

function bindBestseller() {
    bindBestsellerMatchClear();
    const refresh = document.querySelector("#bestseller-refresh");
    if (refresh) refresh.addEventListener("click", loadBestsellerList);
    // 批量上传（主图URL）：点击打开文件选择，选中后解析为卡片
    const iBtn = document.querySelector("#bestseller-urlimport-btn");
    const iInput = document.querySelector("#bestseller-urlimport-input");
    if (iBtn && iInput) {
      iBtn.addEventListener("click", () => iInput.click());
      iInput.addEventListener("change", () => {
        if (iInput.files && iInput.files.length) { handleBestsellerUrlImport([...iInput.files]); iInput.value = ""; }
      });
    }
    // 批量上传图片（图片文件 + 表格）：先选图片，再选表格，按文件名匹配SKUID
    const imgBtn = document.querySelector("#bestseller-imgimport-btn");
    const imgInput = document.querySelector("#bestseller-imgimport-input");
    const xlsxBtn = document.querySelector("#bestseller-imgxlsx-btn");
    const xlsxInput = document.querySelector("#bestseller-imgxlsx-input");
    if (imgBtn && imgInput) imgBtn.addEventListener("click", () => imgInput.click());
    if (xlsxBtn && xlsxInput) xlsxBtn.addEventListener("click", () => xlsxInput.click());
    if (imgInput) imgInput.addEventListener("change", () => { /* 图片先暂存，等待表格 */ });
    if (xlsxInput) xlsxInput.addEventListener("change", () => {
      const imgs = imgInput && imgInput.files ? [...imgInput.files] : [];
      if (imgs.length && xlsxInput.files && xlsxInput.files.length) {
        handleBestsellerImgImport(imgs, xlsxInput.files[0]);
        xlsxInput.value = "";
      } else if (!imgs.length) {
        sbToast("请先选择要上传的图片", false);
      }
    });
    // 图片选择触发提示选表格
    if (imgInput) imgInput.addEventListener("change", () => {
      if (imgInput.files && imgInput.files.length) sbToast("已选 " + imgInput.files.length + " 张图片，请再选择匹配表格", true);
    });
    // 筛选
    document.querySelectorAll("#bestseller-filters .bestseller-filter").forEach(b => {
      b.onclick = () => { bestsellerFilter = b.dataset.st || ""; renderBestsellerList(); };
    });
    // 复制分类分享链接
    bindShareCatBtn("bestseller-share-cat", "bestseller", true);
    // 标记筛选
    const bf = document.querySelector("#bestseller-flag-filter");
    if (bf) bf.addEventListener("change", () => { bestsellerFlagFilter = bf.value || ""; renderBestsellerList(); });
    // 标记统计类目筛选
    const bfc = document.querySelector("#bestseller-flag-cat-filter");
    if (bfc) bfc.addEventListener("change", () => { bestsellerFlagCat = bfc.value || ""; renderBestsellerFlagStats(); });
    // 全选
    const ca = document.querySelector("#bestseller-checkall");
    if (ca) ca.onchange = () => { bestsellerSelected.clear(); if (ca.checked) bestsellerTasks.forEach(t => bestsellerSelected.add(t.id)); renderBestsellerList(); };
    // 批量发布 / 批量绑定 / 取消绑定
    const bp = document.querySelector("#bestseller-batch-pub");
    if (bp) bp.onclick = () => bulkSetBestsellerStatus("published");
    const bb = document.querySelector("#bestseller-batch-bound");
    if (bb) bb.onclick = () => bulkSetBestsellerBound(true);
    const bu = document.querySelector("#bestseller-batch-unbound");
    if (bu) bu.onclick = () => bulkSetBestsellerBound(false);
    const exportBtn = document.querySelector("#bestseller-export");
    if (exportBtn) exportBtn.addEventListener("click", exportBestsellerExcel);
    // 批量删除 → 移入回收站
    const bdel = document.querySelector("#bestseller-batch-del");
    if (bdel) bdel.onclick = () => bulkDeleteBestseller();
    // 回收站开关
    const trashToggle = document.querySelector("#bestseller-trash-toggle");
    if (trashToggle) trashToggle.onclick = () => openBestsellerTrash();
    const trashBack = document.querySelector("#bestseller-trash-back");
    if (trashBack) trashBack.onclick = () => closeBestsellerTrash();
    // 回收站全选
    const tca = document.querySelector("#bestseller-trash-checkall");
    if (tca) tca.onchange = () => { bestsellerTrashSelected.clear(); if (tca.checked) bestsellerTrash.forEach(t => bestsellerTrashSelected.add(t.id)); renderBestsellerTrash(); };
    // 回收站批量恢复 / 永久删除
    const trRestore = document.querySelector("#bestseller-trash-restore");
    if (trRestore) trRestore.onclick = () => bulkRestoreBestseller();
    const trPurge = document.querySelector("#bestseller-trash-purge");
    if (trPurge) trPurge.onclick = () => bulkPurgeBestseller();
  }

async function loadBestsellerList() {
    if (!document.querySelector("#bestseller-list")) return;
    try {
      bestsellerTasks = await SB.listBestsellerTasks();
      bestsellerAllSubs = await SB.listAllBestsellerSubmissions().catch(() => []);
      fillTaskFlagCatSelect(bestsellerTasks, "#bestseller-flag-cat-filter");
      loadZoneCatSide("bestseller");
      renderBestsellerFlagStats();
      renderBestsellerList();
    } catch (e) { sbToast("加载招品列表失败", false); }
  }

function bestsellerSubsFor(taskId) {
    return bestsellerAllSubs.filter(s => s.bestseller_task_id === taskId);
  }

function bestsellerStatusLabel(t, hasSubs) {
    if (t.bound) return "bound";
    if (t.status === "published" && hasSubs) return "submitted";
    if (t.status === "published") return "published";
    return "draft";
  }

function bestsellerStatusChip(cls, label) {
    return '<span class="bestseller-chip ' + cls + '">' + label + '</span>';
  }

function renderBestsellerList() {
    const box = document.querySelector("#bestseller-list");
    const cnt = document.querySelector("#bestseller-count");
    const ca = document.querySelector("#bestseller-checkall");
    if (!box) return;
    document.querySelectorAll("#bestseller-filters .bestseller-filter").forEach(b => b.classList.toggle("active", (b.dataset.st || "") === bestsellerFilter));
    let list = bestsellerTasks;
    if (bestsellerFilter === "published") list = list.filter(t => t.status === "published" && !t.bound);
    else if (bestsellerFilter === "submitted") list = list.filter(t => t.status === "published" && bestsellerSubsFor(t.id).length > 0 && !t.bound);
    else if (bestsellerFilter === "bound") list = list.filter(t => t.bound);
    else if (bestsellerFilter === "no_refill") list = list.filter(t => t.flag_no_refill);
    if (bestsellerSideCat) list = list.filter(t => (t.category || "") === bestsellerSideCat);
    if (bestsellerFlagFilter) list = list.filter(t => taskHasFlag(t, bestsellerFlagFilter));
    // 同步勾选集
    const valid = new Set(list.map(t => t.id));
    bestsellerSelected = new Set([...bestsellerSelected].filter(id => valid.has(id)));
    if (cnt) cnt.textContent = "共 " + list.length + " 个任务";
    if (ca) ca.checked = list.length > 0 && list.every(t => bestsellerSelected.has(t.id));
    box.innerHTML = "";
    if (!list.length) {
      box.innerHTML = '<p class="hint">暂无符合当前筛选的招品任务。</p>';
      return;
    }
    const token = null;
    const pubRank = bestsellerTasks.slice().filter(x => x.status === "published").sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    list.forEach((t) => {
      const subs = bestsellerSubsFor(t.id);
      const spuList = [];
      subs.forEach(s => { (s.spus || []).forEach(sp => { if (sp && spuList.indexOf(sp) < 0) spuList.push(sp); }); });
      const seq = t.status === "published" ? (pubRank.indexOf(t) + 1) : "";
      const st = bestsellerStatusLabel(t, subs.length > 0);
      const card = document.createElement("div");
      card.className = "bestseller-acard" + (bestsellerSelected.has(t.id) ? " sel" : "");
      const chip = st === "bound" ? bestsellerStatusChip("chip-bound", "已回品")
        : st === "submitted" ? bestsellerStatusChip("chip-sub", "商家已上传")
        : st === "published" ? bestsellerStatusChip("chip-pub", "已发布")
        : bestsellerStatusChip("chip-draft", "未发布");
      card.innerHTML =
        '<div class="bestseller-acard-imghold">' +
          '<img class="bestseller-acard-img" alt="">' +
          '<span class="bestseller-acard-no">' + seq + '</span>' +
          '<span class="bestseller-acard-del" title="删除">×</span>' +
          '<span class="bestseller-acard-check"><input type="checkbox" class="bestseller-check"' + (bestsellerSelected.has(t.id) ? ' checked' : '') + '></span>' +
          '<div class="recruit-acard-flags">' + taskFlagBoxHTML(t, "bestseller") + '</div>' +
        '</div>' +
        '<div class="bestseller-acard-body">' +
          '<div class="bestseller-acard-tid" title="任务ID：' + escAttr(t.task_id || "") + '">任务ID：' + escHtml(t.task_id || "（未填写）") + '</div>' +
          '<div class="bestseller-acard-strow">' + chip + '<span class="bestseller-acard-meta">' + subs.length + ' 人 / ' + spuList.length + ' 个SPU</span></div>' +
          '<div class="bestseller-acard-tags" data-tags></div>' +
          '<div class="bestseller-acard-actions">' +
            '<input type="text" class="rcac-tid-input" placeholder="任务ID" value="">' +
            '<button class="btn-ghost small rcac-pub">' + (t.status === "published" ? "取消发布" : "发布") + '</button>' +
            '<button class="btn-ghost small rcac-bound">' + (t.bound ? "取消绑定" : "标已绑定") + '</button>' +
            '<button class="btn-ghost small rcac-copy">复制SPU</button>' +
          '</div>' +
        '</div>';
      const img = card.querySelector(".bestseller-acard-img");
      if (t.main_img_url) {
        img.onload = () => img.classList.add("loaded");
        img.onerror = () => { img.classList.remove("loaded"); img.src = ""; };
        img.src = t.main_img_url;
      } else if (t.image_path) {
        SB.bestsellerImageUrl(t.image_path).then(u => {
          img.onload = () => img.classList.add("loaded");
          img.onerror = () => { img.classList.remove("loaded"); img.src = ""; };
          img.src = u;
        }).catch(() => {});
      } else {
        card.querySelector(".bestseller-acard-imghold").style.background = "rgba(255,255,255,.03)";
      }
      // 悬浮提示 SPU
      const tip = spuList.length ? ("该任务已提交货品SPU：\n" + spuList.join("\n")) : "该任务暂无商家提交SPU";
      card.querySelector(".bestseller-acard-imghold").title = tip;
      card.querySelector(".bestseller-acard-tid").title = tip;
      // 复选框
      const cb = card.querySelector(".bestseller-check");
      cb.onchange = () => { if (cb.checked) bestsellerSelected.add(t.id); else bestsellerSelected.delete(t.id); card.classList.toggle("sel", cb.checked); };
      // 删除
      card.querySelector(".bestseller-acard-del").onclick = () => confirmDeleteBestseller(t);
      // 发布切换
      card.querySelector(".rcac-pub").onclick = () => setBestsellerStatus(t, t.status === "published" ? "draft" : "published");
      // 绑定切换
      card.querySelector(".rcac-bound").onclick = () => setBestsellerBound(t, !t.bound);
      // 复制SPU
      card.querySelector(".rcac-copy").onclick = () => copyBestsellerSps(t, spuList);
      // 任务ID 编辑
      const tidInput = card.querySelector(".rcac-tid-input");
      tidInput.value = t.task_id || "";
      tidInput.addEventListener("change", () => {
        const v = tidInput.value.trim();
        SB.updateBestsellerTask(t.id, { task_id: v }).then(() => sbToast("任务ID已更新")).catch(e => sbToast("更新失败", false));
      });
      // 已传SPU 状态区
      renderBestsellerSpsStatus(card, spuList.length);
      bindTaskFlagBoxes(card, t, "bestseller", renderBestsellerList, renderBestsellerFlagStats);
      box.appendChild(card);
    });
  }

// 已传SPU 状态标记：商家中已有提交 → 显示「已传SPU · 已上传」
  function renderBestsellerSpsStatus(card, hasSubs) {
    const el = card.querySelector("[data-tags]");
    if (!el) return;
    el.innerHTML = "";
    const s = document.createElement("span");
    if (hasSubs) { s.className = "rcac-tag-chip rcac-sub-up"; s.textContent = "已传SPU · 商家已上传"; }
    else { s.className = "rcac-tag-empty"; s.textContent = "未传SPU"; }
    el.appendChild(s);
  }

async function setBestsellerStatus(t, st) {
    if (!guardZone("bestseller", "无权限：只有可操作BESTSELLER专区的管理员可操作")) return;
    try {
      await SB.updateBestsellerTask(t.id, { status: st });
      t.status = st; renderBestsellerList(); sbToast(st === "published" ? "已发布" : "已取消发布");
    } catch (e) { sbToast("操作失败", false); }
  }

async function setBestsellerBound(t, b) {
    if (!guardZone("bestseller", "无权限：只有可操作BESTSELLER专区的管理员可操作")) return;
    try {
      await SB.updateBestsellerTask(t.id, { bound: b, bound_at: b ? new Date().toISOString() : null });
      t.bound = b; renderBestsellerList(); sbToast(b ? "已标记为已绑定" : "已取消绑定");
    } catch (e) { sbToast("操作失败", false); }
  }

async function bulkSetBestsellerStatus(st) {
    if (!guardZone("bestseller", "无权限：只有可操作BESTSELLER专区的管理员可批量操作")) return;
    const ids = [...bestsellerSelected];
    if (!ids.length) return sbToast("请先勾选要发布的任务", false);
    try { await SB.bulkUpdateBestsellerTasks(ids, { status: st }); sbToast("已批量" + (st === "published" ? "发布" : "取消发布") + " " + ids.length + " 个任务"); loadBestsellerList(); }
    catch (e) { sbToast("批量操作失败", false); }
  }

async function bulkSetBestsellerBound(b) {
    if (!guardZone("bestseller", "无权限：只有可操作BESTSELLER专区的管理员可批量操作")) return;
    const ids = [...bestsellerSelected];
    if (!ids.length) return sbToast("请先勾选任务", false);
    try { await SB.bulkUpdateBestsellerTasks(ids, { bound: b, bound_at: b ? new Date().toISOString() : null }); sbToast("已批量" + (b ? "标记绑定" : "取消绑定") + " " + ids.length + " 个任务"); loadBestsellerList(); }
    catch (e) { sbToast("批量操作失败", false); }
  }

async function copyBestsellerSps(t, spuList) {
    if (!spuList.length) return sbToast("该任务暂无SPU可复制", false);
    try {
      await navigator.clipboard.writeText(spuList.join(","));
      sbToast("已复制 " + spuList.length + " 个SPU");
    } catch (e) { sbToast("复制失败", false); }
  }

async function confirmDeleteBestseller(t) {
    if (!confirm("确认将招品任务ID「" + t.task_id + "」移入回收站？可在回收站中恢复。")) return;
    if (!guardZone("bestseller", "无权限：只有可操作BESTSELLER专区的管理员可删除")) return;
    try {
      await SB.removeBestsellerTask(t.id);
      sbToast("已移入回收站");
      loadBestsellerList();
    } catch (e) { sbToast("删除失败：" + (e.message || ""), false); }
  }

// 批量删除 → 移入回收站
  async function bulkDeleteBestseller() {
    const ids = [...bestsellerSelected];
    if (!ids.length) return sbToast("请先勾选要删除的任务", false);
    if (!confirm("确认将选中的 " + ids.length + " 个任务移入回收站？可在回收站中恢复。")) return;
    if (!guardZone("bestseller", "无权限：只有可操作BESTSELLER专区的管理员可删除")) return;
    try {
      await SB.bulkUpdateBestsellerTasks(ids, { deleted_at: new Date().toISOString() });
      sbToast("已移入回收站 " + ids.length + " 个任务");
      loadBestsellerList();
    } catch (e) { sbToast("操作失败", false); }
  }

// ===== 回收站 =====
  async function openBestsellerTrash() {
    bestsellerInTrash = true;
    const main = document.querySelector("#bestseller-main-area");
    const trash = document.querySelector("#bestseller-trash-view");
    if (main) main.classList.add("hidden");
    if (trash) trash.classList.remove("hidden");
    const toggle = document.querySelector("#bestseller-trash-toggle");
    if (toggle) toggle.textContent = "🗑 回收站";
    try {
      bestsellerTrash = await SB.listBestsellerTrash();
      bestsellerTrashSelected.clear();
      renderBestsellerTrash();
    } catch (e) { sbToast("加载回收站失败", false); }
  }

function closeBestsellerTrash() {
    bestsellerInTrash = false;
    const main = document.querySelector("#bestseller-main-area");
    const trash = document.querySelector("#bestseller-trash-view");
    if (main) main.classList.remove("hidden");
    if (trash) trash.classList.add("hidden");
    loadBestsellerList();
  }

function renderBestsellerTrash() {
    const box = document.querySelector("#bestseller-trash-list");
    const cnt = document.querySelector("#bestseller-trash-count");
    const ca = document.querySelector("#bestseller-trash-checkall");
    if (!box) return;
    if (cnt) cnt.textContent = "共 " + bestsellerTrash.length + " 个任务";
    if (ca) ca.checked = bestsellerTrash.length > 0 && bestsellerTrash.every(t => bestsellerTrashSelected.has(t.id));
    box.innerHTML = "";
    if (!bestsellerTrash.length) { box.innerHTML = '<p class="hint">回收站为空。</p>'; return; }
    bestsellerTrash.forEach((t) => {
      const subs = bestsellerSubsFor(t.id);
      const spuList = [];
      subs.forEach(s => { (s.spus || []).forEach(sp => { if (sp && spuList.indexOf(sp) < 0) spuList.push(sp); }); });
      const card = document.createElement("div");
      card.className = "bestseller-acard" + (bestsellerTrashSelected.has(t.id) ? " sel" : "");
      card.innerHTML =
        '<div class="bestseller-acard-imghold">' +
          '<img class="bestseller-acard-img" alt="">' +
          '<span class="bestseller-acard-trashtag">回收站</span>' +
          '<span class="bestseller-acard-check"><input type="checkbox" class="bestseller-check"' + (bestsellerTrashSelected.has(t.id) ? ' checked' : '') + '></span>' +
        '</div>' +
        '<div class="bestseller-acard-body">' +
          '<div class="bestseller-acard-tid" title="任务ID：' + escAttr(t.task_id || "") + '">任务ID：' + escHtml(t.task_id || "（未填写）") + '</div>' +
          '<div class="bestseller-acard-strow"><span class="bestseller-chip chip-draft">已删除 · ' + escHtml((t.deleted_at || "").slice(0, 10)) + '</span><span class="bestseller-acard-meta">' + subs.length + ' 人 / ' + spuList.length + ' 个SPU</span></div>' +
          '<div class="bestseller-acard-actions">' +
            '<button class="btn-ghost small trash-restore">恢复</button>' +
            '<button class="btn-danger small trash-purge">永久删除</button>' +
          '</div>' +
        '</div>';
      const img = card.querySelector(".bestseller-acard-img");
      if (t.main_img_url) {
        img.onload = () => img.classList.add("loaded");
        img.onerror = () => { img.classList.remove("loaded"); img.src = ""; };
        img.src = t.main_img_url;
      } else if (t.image_path) {
        SB.bestsellerImageUrl(t.image_path).then(u => {
          img.onload = () => img.classList.add("loaded");
          img.onerror = () => { img.classList.remove("loaded"); img.src = ""; };
          img.src = u;
        }).catch(() => {});
      } else {
        card.querySelector(".bestseller-acard-imghold").style.background = "rgba(255,255,255,.03)";
      }
      const cb = card.querySelector(".bestseller-check");
      cb.onchange = () => { if (cb.checked) bestsellerTrashSelected.add(t.id); else bestsellerTrashSelected.delete(t.id); card.classList.toggle("sel", cb.checked); };
      card.querySelector(".trash-restore").onclick = () => restoreTrashOne(t);
      card.querySelector(".trash-purge").onclick = () => purgeTrashOne(t);
      box.appendChild(card);
    });
  }

async function bulkRestoreBestseller() {
    const ids = [...bestsellerTrashSelected];
    if (!ids.length) return sbToast("请先勾选要恢复的任务", false);
    try {
      await SB.bulkRestoreBestsellerTasks(ids);
      sbToast("已恢复 " + ids.length + " 个任务");
      const back = document.querySelector("#bestseller-trash-back");
      if (back) back.click();
    } catch (e) { sbToast("批量恢复失败", false); }
  }

async function bulkPurgeBestseller() {
    const ids = [...bestsellerTrashSelected];
    if (!ids.length) return sbToast("请先勾选要永久删除的任务", false);
    if (!confirm("确认永久删除选中的 " + ids.length + " 个任务？其图片与商家提交记录将彻底移除，不可恢复！")) return;
    try {
      const inTrash = bestsellerTrash.filter(t => ids.includes(t.id));
      for (const t of inTrash) { if (t.image_path) await SB.deleteBestsellerImage(t.image_path).catch(() => {}); }
      await SB.purgeBestsellerTasks(ids);
      sbToast("已永久删除 " + ids.length + " 个任务");
      openBestsellerTrash();
    } catch (e) { sbToast("永久删除失败", false); }
  }

function exportBestsellerExcel() {
    if (!bestsellerTasks.length) return sbToast("暂无招品任务可导出", false);
    if (typeof XLSX === "undefined") return sbToast("导出组件未加载，请联网后重试", false);
    const rows = [];
    const pubRank = bestsellerTasks.slice().filter(x => x.status === "published").sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const exportList = bestsellerFlagFilter
      ? bestsellerTasks.filter(t => taskHasFlag(t, bestsellerFlagFilter))
      : bestsellerTasks;
    exportList.forEach((t) => {
      const seq = t.status === "published" ? (pubRank.indexOf(t) + 1) : "";
      const subs = bestsellerSubsFor(t.id);
      const flagStr = TASK_FLAG_DEFS.filter(d => taskHasFlag(t, d.val)).map(d => d.label).join("、") || "无";
      if (!subs.length) {
        rows.push({ 任务ID: t.task_id, 前台序号: seq, 类目: t.category || "", 标记: flagStr, IP: flagText(t, "ip"), 品牌: flagText(t, "brand"), 类目错放: flagText(t, "cat_mismatch"), 无需回品: flagText(t, "no_refill"), 商家前台用户ID: "", 货品SPU: "", 状态: t.bound ? "已回品" : (t.status === "published" ? "已发布" : "未发布") });
        return;
      }
      subs.forEach(s => {
        rows.push({ 任务ID: t.task_id, 前台序号: seq, 类目: t.category || "", 标记: flagStr, IP: flagText(t, "ip"), 品牌: flagText(t, "brand"), 类目错放: flagText(t, "cat_mismatch"), 无需回品: flagText(t, "no_refill"), 商家前台用户ID: s.user_id, 货品SPU: (s.spus || []).join(","), 状态: t.bound ? "已回品" : (t.status === "published" ? "已发布" : "未发布") });
      });
    });
    if (!rows.length) return sbToast("暂无数据可导出", false);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "BESTSELLER汇总");
    XLSX.writeFile(wb, "BESTSELLER汇总.xlsx");
    sbToast("已导出 " + rows.length + " 行");
  }

  /* 暴露给其它模块 / 事件绑定 */
  Object.assign(window, {
    bindBestsellerMatchClear, renderBestsellerFlagStats, loadBestsellerCatPicker, loadBestsellerCatSettings, handleBestsellerUrlImport, buildBestsellerUrlImport, commitBestsellerUrlImport, handleBestsellerImgImport, buildBestsellerImgImport, commitBestsellerImgImport, bindBestseller, loadBestsellerList, bestsellerSubsFor, bestsellerStatusLabel, bestsellerStatusChip, renderBestsellerList, renderBestsellerSpsStatus, setBestsellerStatus, setBestsellerBound, bulkSetBestsellerStatus, bulkSetBestsellerBound, copyBestsellerSps, confirmDeleteBestseller, bulkDeleteBestseller, openBestsellerTrash, closeBestsellerTrash, renderBestsellerTrash, bulkRestoreBestseller, bulkPurgeBestseller, exportBestsellerExcel
  });

})();
