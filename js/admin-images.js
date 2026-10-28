/* ============================================================
 * TREND BANK · 后台管理（images）
 * 说明：本文件由原单文件 admin.js 按面板拆分而来。
 *  - 共享状态在文件顶部声明（全局作用域，跨文件可见）
 *  - 函数定义在文件内 IIFE 中，末尾通过 Object.assign(window, {...}) 暴露给其它模块
 * ============================================================ */

/* ---------- 共享状态 ---------- */
// ---------- 后台图片管理网格：服务端分页 + 无限滚动 ----------
const MGMT_PAGE = 36;  // 每页图片数（下调以减少一次性图片请求；可按需调整）
// 是否已加载过图片列表：用于「按需加载」，避免进入后台/关弹窗时重复拉取图片
let manageLoadedOnce = false;

let mgrPageAll = [];

// 当前视图已加载图片
let mgrOffset = 0;

// 下一页偏移
let mgrHasMore = false;

// 是否还有下一页
let mgrLoading = false;

// 加载中防重
let mgrSentinel = null;

// 哨兵
let mgrObserver = null;

let _mgrLoadedCount = 0;
(function () {

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
    // 「上传链接Excel」按钮与文件解析统一由文档级委托处理（见下方 bindUrlMatchDelegate），此处不再重复绑定
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

// 依据文件名（不含扩展名）给待上传图片批量挂外链：Excel/CSV 需含 Name 列（图片名，不含扩展名）与 Url 列
  function stripExt(name) { return String(name || "").replace(/\.[^.]+$/, "").trim(); }

function handleUrlMatch(files) {
    if (!pendingFiles.length) { sbToast("请先选择图片，再上传匹配链接表格", false); return; }
    if (typeof XLSX === "undefined") { sbToast("Excel解析组件未加载，请联网后重试", false); return; }
    if (!files || !files.length) return;
    const file = files[0];
    const mr = $("#url-match-result");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        // 找 Name 列与 Url 列（大小写不敏感，容错图片名/名称 列名）
        let nameKey = null, urlKey = null;
        if (rows.length) {
          const keys = Object.keys(rows[0]);
          for (const k of keys) {
            const lk = String(k).toLowerCase();
            if (!nameKey && (lk === "name" || lk === "图片名" || lk === "名称")) nameKey = k;
            if (!urlKey && (lk === "url" || lk === "链接" || lk === "外链")) urlKey = k;
          }
        }
        if (!nameKey || !urlKey) { sbToast("未找到 Name 列和 Url 列，请检查表头", false); return; }
        const map = {};
        rows.forEach(r => {
          const n = stripExt(r[nameKey]);
          const u = String(r[urlKey] || "").trim();
          if (n && u) map[n] = u;
        });
        if (!Object.keys(map).length) { sbToast("表格中没有可匹配的（图片名+Url）数据", false); return; }
        let matched = 0;
        pendingFiles.forEach(f => {
          const n = stripExt(f.name);
          if (map[n]) { f._url = map[n]; matched++; }
        });
        let un = 0;
        pendingFiles.forEach(f => { if (!f._url) un++; });
        renderPending();
        mr.textContent = `匹配成功 ${matched} 张${un ? `；${un} 张未匹配到链接` : ""}`;
        mr.className = "url-match-result" + (matched ? " ok" : "");
        sbToast(`已匹配 ${matched} 张图片链接${un ? `，${un} 张未匹配` : ""}`, matched > 0);
      } catch (e) {
        sbToast("表格解析失败，请检查文件格式", false);
      }
    };
    reader.readAsArrayBuffer(file);
  }

function renderPending() {
    const box = $("#pending-list");
    box.innerHTML = "";
    pendingFiles.forEach((f, idx) => {
      const row = document.createElement("div");
      row.className = "pending-row";
      const linked = f._url ? `<span class="purl">🔗 已匹配链接</span>` : "";
      row.innerHTML = `<span class="pname">🖼 ${f.name}</span>${linked}<span class="psize">${fmtSize(f.size)}</span><button class="x" data-i="${idx}">×</button>`;
      row.querySelector(".x").onclick = () => removePending(idx);
      box.appendChild(row);
    });
    $("#upload-btn").disabled = pendingFiles.length === 0;
    $("#upload-btn").textContent = "上传所选（" + pendingFiles.length + "）";
    const mr = $("#url-match-result");
    if (mr && pendingFiles.length === 0) mr.textContent = "";
  }

function fmtSize(n) {
    if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    return Math.max(1, Math.round(n / 1024)) + " KB";
  }

// ================= 上传主流程（写入 R2 + DB） =================
  async function doUpload() {
    if (!pendingFiles.length || uploading) return;
    if (!guardZone("visual", "无权限：只有可操作视觉专区的管理员可上传")) return;

    let cat = $("#cat-select").value;
    if (!cat) { sbToast("请选择分类", false); return; }
    // 类目授权校验：普通管理员只能传自己被授权（视觉专区）的类目；超管不限
    if (currentRole === "admin") {
      let mine = [];
      try { mine = await SB.myZonePermissions("visual"); } catch (e) { mine = []; }
      const norm = s => (s || "").trim();
      const mineSet = new Set(mine.map(norm));
      if (!mineSet.has(norm(cat))) { sbToast("无权限：该分类未分配给您的可管理类目", false); return; }
    }

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
        await SB.addImageRecord({ category: cat, name: cleanName, path, url: file._url || "" });
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

// 类目只能从已配置的「前台类目 + 常用类目」里选，不支持在传图时新增（防止误传出"露脸模特"这类残留类目）
  async function loadCats() {
    const sel = $("#cat-select");
    if (!sel) return; // 上传图片菜单已并入智能打标弹窗，面板元素不存在时跳过
    let cats = [];
    try { cats = await SB.listActiveCats(); } catch (e) {}
    // 普通管理员：只显示被授权（视觉专区）的类目；超管/访客显示全部
    if (currentRole === "admin") {
      try {
        const mine = await SB.myZonePermissions("visual");
        const set = new Set(mine.map(s => (s || "").trim()));
        cats = cats.filter(c => set.has((c || "").trim()));
      } catch (e) {}
    }
    sel.innerHTML = "";
    sel.add(new Option("── 请选择类目 ──", ""));
    // 常用类目排前面并带 ★（统一走 CAT_SEARCH，保证各入口口径一致）
    const CATS = window.CAT_SEARCH;
    const ordered = CATS ? CATS.sortCats(cats, currentFavCats) : cats.map(n => ({ name: n, fav: false }));
    ordered.forEach(o => sel.add(new Option((o.fav ? "★ " : "") + o.name, o.name)));
    sel._allCats = cats;
    // 搜索框：只筛选项，不改变已选中的值
    if (CATS) {
      CATS.mountBox(sel, "cat-search-visual", "搜索类目…", (v) => { CATS.kw("visual", v); CATS.filterSelect(sel, v); });
      CATS.filterSelect(sel, CATS.kw("visual"));
    }
  }

// ================= 我的常用类目 =================
  function bindFavCats() {
    $("#fav-save").onclick = saveFavCats;
  }

async function loadFavCats() {
    try { currentFavCats = await SB.myFavCats(); } catch (e) { currentFavCats = []; }
    // 与前台类目保持一致：候选以「前台类目 currentActiveCats」为主，勾选状态 = 前台类目
    const base = (currentActiveCats && currentActiveCats.length) ? currentActiveCats : currentFavCats;
    const CATS = window.CAT_SEARCH;
    // 候选 = 内置清单 + 前台类目，再扣掉「已删除清单」。
    // 旧写法没扣，被删掉的类目（尤其是 config.js 里的内置类目）会一直留在候选里，
    // 看起来就是"我在前台类目里删了，这边还保留着以前的类目"。
    // catRemoved 是本文件内的全局词法变量（已删除清单）
    const removedSet = new Set(((catRemoved || [])).map(x => String(x == null ? "" : x).trim()));
    let optSet = (window.CONFIG.CATEGORY_OPTIONS || []).concat(base);
    let names = [...new Set(optSet)].filter(n => n && !removedSet.has(String(n).trim()));
    // 存量常用类目里若还留着已删除的类目，直接清掉（否则它会一直生效却看不见）
    const stale = currentFavCats.filter(n => removedSet.has(String(n || "").trim()));
    if (stale.length) {
      currentFavCats = currentFavCats.filter(n => !removedSet.has(String(n || "").trim()));
      try { await SB.updateFavCats(currentFavCats); } catch (e) { }
    }
    names.sort((a, b) => a.localeCompare(b, "zh"));
    const ordered = CATS ? CATS.sortCats(names, currentFavCats) : names.map(n => ({ name: n, fav: false }));
    const box = $("#fav-list");
    if (!box) return;
    const kwv = CATS ? CATS.kw("fav") : "";
    if (CATS) {
      CATS.mountBox(box, "cat-search-fav", "搜索类目…", (v) => { CATS.kw("fav", v); loadFavCats(); });
      const sbx = document.getElementById("cat-search-fav");
      if (sbx && sbx.value !== kwv) sbx.value = kwv;
    }
    box.innerHTML = "";
    const list = kwv ? ordered.filter(o => CATS.hit(o.name, kwv)) : ordered;
    list.forEach(o => {
      const name = o.name;
      const label = document.createElement("label");
      label.className = "check-item";
      label.innerHTML = `<input type="checkbox" value="${escAttr(name)}"> <span title="${escAttr(name)}">${o.fav ? '<span class="cat-fav" title="我的常用类目">★</span>' : ""}${escHtml(name)}</span>`;
      label.querySelector("input").checked = base.includes(name);
      label.querySelector("input").onchange = () => {
        $("#fav-save").disabled = false;
      };
      box.appendChild(label);
    });
    if (!list.length) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = kwv ? "没有匹配的类目（清空搜索框可看全部）" : "暂无可选类目（前台类目里还没有类目）";
      box.appendChild(p);
    }
    if (stale.length) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "已自动移除 " + stale.length + " 个「已被删除」的类目：" + stale.join("、");
      box.appendChild(p);
    }
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
    /* 已删除清单：内置候选清单（config.js 写死）与「图片里出现过的类目」都会把删掉的名字带回来，
       必须在这里扣掉，否则删了又重新出现（看起来"类目删不掉"）。 */
    try { catRemoved = await SB.getCatRemoved(); } catch (e) { catRemoved = catRemoved || []; }
    // 合并三类：候选类目 + 前台启用类目 + 图片中实际出现的类目（含误加未入库的"露脸模特"这类残留）
    let usedCats = [];
    try { usedCats = await SB.listUsedCats(); } catch (e) { usedCats = []; }
    const opts = new Set((window.CONFIG.CATEGORY_OPTIONS || []).concat(currentActiveCats).concat(usedCats));
    catRemoved.forEach(n => opts.delete(n));
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
        const _okDel = await sbConfirm({ title: "删除类目「" + name + "」", desc: "删除后会同步清空所有归属该类目的图片的类目字段（图片本身保留）。", okText: "删除", danger: true });
        if (!_okDel) return;
        try {
          await SB.removeCategory(name);
          /* 一次性清空图片上的该类目（数据库函数；未建库时自动分批清理，单条失败不中断） */
          const n = await SB.clearCategoryOnImages(name);
          // 从「所有管理员」的常用类目里移除该类目（不只清自己这一份）
          try {
            await SB.clearCatFromProfiles(name);
            const fav = (currentFavCats || []).filter(c => c !== name);
            currentFavCats = fav;
          } catch (e) { /* 清理失败不影响删除本身 */ }
          /* 内置候选清单里的名字会自己回来 → 记进「已删除清单」把它压住，才算是真删掉 */
          if ((window.CONFIG.CATEGORY_OPTIONS || []).includes(name) && catRemoved.indexOf(name) < 0) {
            catRemoved = catRemoved.concat([name]);
            try { await SB.setCatRemoved(catRemoved); } catch (e) { /* 记录失败不影响本次删除 */ }
          }
          sbToast("已删除类目「" + name + "」" + (n ? "，清空 " + n + " 张图片" : ""));
          await loadCatMgmt(); await loadCats(); await loadFavCats(); await loadManage();
          await refreshTagConsumers();
        } catch (err) { sbToast("删除失败：" + (err.message || ""), false); }
      };
      if (isUsedOnly) { /* 残留类目：默认不勾选，仅展示以便删除 */ }
      box.appendChild(label);
    });
    renderCatRemovedHint(box);
    renderCatOrder();
    $("#cat-mgmt-save").disabled = true;
  }

/* 已删除的内置类目：列出来，点一下即可恢复（避免"删过头"没有退路） */
function renderCatRemovedHint(box) {
    const old = document.getElementById("cat-removed-hint");
    if (old) old.remove();
    if (!catRemoved || !catRemoved.length) return;
    const p = document.createElement("p");
    p.id = "cat-removed-hint";
    p.className = "hint";
    p.innerHTML = "已删除 " + catRemoved.length + " 个类目（恢复后重新出现在上方清单）：" +
      catRemoved.map(n => '<button type="button" class="link-btn" data-restore="' + escAttr(n) + '">' + escHtml(n) + " · 恢复</button>").join("");
    p.querySelectorAll("[data-restore]").forEach(b => {
      b.onclick = async (ev) => {
        ev.preventDefault();
        const n = b.getAttribute("data-restore");
        catRemoved = catRemoved.filter(x => x !== n);
        try { await SB.setCatRemoved(catRemoved); sbToast("已恢复类目：「" + n + "」"); await loadCatMgmt(); }
        catch (e) { sbToast("恢复失败", false); }
      };
    });
    box.appendChild(p);
  }

function addOptionToCatMgmt(name) {
    // 重新加回来的类目，从「已删除清单」里移出，否则它会被一直压住
    if (catRemoved && catRemoved.indexOf(name) >= 0) {
      catRemoved = catRemoved.filter(x => x !== name);
      try { SB.setCatRemoved(catRemoved); } catch (e) { /* 忽略 */ }
    }
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

// 按需加载图片列表：已加载过则直接复用，不重复请求
async function ensureManageLoaded() {
    if (manageLoadedOnce) return;
    await loadManage();
  }

async function loadManage() {
    manageLoadedOnce = true;
    _mgrAllCache = null;
    const menu = $("#manage-menu");
    // 轻量取「图片中有图」的类目列表（仅取 category 列，服务端排序）
    let usedCats = [];
    let _allForCount = null;
    if (mgrSeeAll()) {
      try { _allForCount = await mgrAllData(); } catch (e) { _allForCount = null; }
    }
    if (_allForCount) {
      usedCats = [...new Set(_allForCount.map(i => i.category).filter(Boolean))];
    } else {
      try {
        const q = await SB.manageCategories();
        usedCats = q || [];
      } catch (e) { usedCats = []; }
    }

    // 渲染左侧类目菜单
    menu.innerHTML = "";
    let activeCats = [];
    try { activeCats = await SB.listActiveCats(); } catch (e) { activeCats = []; }
    let cfgOpts = [];
    try { cfgOpts = await SB.listCategories(); } catch (e) { cfgOpts = []; }
    const configured = new Set([...activeCats, ...cfgOpts.map(c => c.name)]);

    // 各类目图片数（后台 RLS 生效口径）
    const catCounts = {};
    if (_allForCount) {
      catCounts["全部"] = _allForCount.length;
      for (const c of usedCats) catCounts[c] = _allForCount.filter(i => i.category === c).length;
    } else {
      try {
        catCounts["全部"] = await SB.countImages(null);
        for (const c of usedCats) { try { catCounts[c] = await SB.countImages(c); } catch (e) { catCounts[c] = 0; } }
      } catch (e) { catCounts["全部"] = 0; }
    }

    const CATS = window.CAT_SEARCH;
    const favSet = new Set((currentFavCats || []).map(x => String(x == null ? "" : x).trim()));
    const ordered = CATS ? CATS.sortCats(usedCats, currentFavCats) : usedCats.map(n => ({ name: n, fav: false }));
    const searchRows = [];
    ["全部"].concat(ordered.map(o => o.name)).forEach(c => {
      const row = document.createElement("div");
      row.className = "cat-menu-row";
      const b = document.createElement("button");
      b.className = "cat-menu-item" + (c === currentManageCat ? " active" : "");
      if (c !== "全部" && favSet.has(c)) {
        const st = document.createElement("span");
        st.className = "cat-fav"; st.title = "我的常用类目"; st.textContent = "★";
        b.appendChild(st);
      }
      b.appendChild(document.createTextNode(c + "（" + (catCounts[c] != null ? catCounts[c] : 0) + "）"));
      b.onclick = () => { currentManageCat = c; renderManageGrid(null, usedCats); };
      row.appendChild(b);
      searchRows.push({ name: c, row: row });
      if (c !== "全部" && !configured.has(c)) {
        const del = document.createElement("button");
        del.className = "cat-menu-del";
        del.title = "删除残留类目「" + c + "」（清空该类目下所有图片的类目字段）";
        del.textContent = "×";
        del.onclick = async (ev) => {
          ev.stopPropagation();
          if (!confirm("类目「" + c + "」未在配置表中（疑似误加）。确定删除吗？\n删除后会同步清空该类目下所有图片的类目字段（图片本身保留）。")) return;
          try {
            const imgs = await SB.listImages(c);
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
    // 搜索：只隐藏不匹配的行，不重新取数（避免每敲一个字都去数图片）
    if (CATS) {
      CATS.mountBox(menu, "cat-search-manage", "搜索类目…", (v) => {
        CATS.kw("manage", v);
        searchRows.forEach(it => {
          it.row.style.display = (it.name === "全部" || !v || CATS.hit(it.name, v)) ? "" : "none";
        });
      });
      const kwNow = CATS.kw("manage");
      const box2 = document.getElementById("cat-search-manage");
      if (box2) box2.value = kwNow;
      if (kwNow) {
        searchRows.forEach(it => {
          it.row.style.display = (it.name === "全部" || CATS.hit(it.name, kwNow)) ? "" : "none";
        });
      }
    }

    renderManageGrid(null, usedCats);
  }

function removeMgrSentinel() {
    if (mgrObserver) { mgrObserver.disconnect(); mgrObserver = null; }
    if (mgrSentinel && mgrSentinel.parentNode) mgrSentinel.parentNode.removeChild(mgrSentinel);
    mgrSentinel = null;
  }

async function buildManageCell(img) {
    const grid = $("#manage-grid");
    const adminToken = await SB.currentToken().catch(() => "");
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
    if (selectedImages.has(img.id)) cell.classList.add("selected");
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
    const linkBtn = document.createElement("button");
    linkBtn.className = "btn-ghost small mgr-link";
    linkBtn.textContent = img.url ? "🔗" : "🔗链接";
    linkBtn.title = img.url ? ("当前外链：" + img.url) : "为这张图添加外链";
    linkBtn.onclick = async (e) => {
      e.stopPropagation();
      const v = await sbAsk({ title: "图片外链", desc: "输入外链地址（留空则清除）：", value: img.url || "", placeholder: "https://" });
      if (v === null) return;
      const nv = v.trim();
      SB.setImageSingleField(img.id, "url", nv).then(() => {
        img.url = nv; linkBtn.textContent = nv ? "🔗" : "🔗链接"; linkBtn.title = nv ? ("当前外链：" + nv) : "为这张图添加外链";
        sbToast(nv ? "外链已保存" : "外链已清除");
      }).catch(err => sbToast("保存失败", false));
    };
    topbar.appendChild(selRow);
    topbar.appendChild(linkBtn);
    topbar.appendChild(delBtn);
    cell.appendChild(topbar);
    // 懒加载
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
    return cell;
  }

function setupMgrSentinel() {
    if (!mgrSentinel) {
      const grid = $("#manage-grid");
      if (!grid || !grid.parentNode) return;
      mgrSentinel = document.createElement("div");
      mgrSentinel.className = "page-sentinel";
      mgrSentinel.style.height = "1px";
      grid.parentNode.appendChild(mgrSentinel);
      mgrObserver = new IntersectionObserver(() => { loadMgrNextPage(); }, { rootMargin: "200px" });
      mgrObserver.observe(mgrSentinel);
    }
  }

// 超管：图片管理也按「全站」取数（并可管理全部）；普通管理员：仍只看自己上传的
let _mgrAllCache = null;
async function mgrAllData() {
  if (_mgrAllCache) return _mgrAllCache;
  _mgrAllCache = await SB.listAllImagesPaged();
  return _mgrAllCache;
}
function mgrSeeAll() { return typeof isSuper === "function" && isSuper(); }
async function mgrChunk(cat, from, to) {
  if (mgrSeeAll()) {
    const all = await mgrAllData();
    const f = (cat && cat !== "全部") ? all.filter(i => i.category === cat) : all;
    return f.slice(from, to + 1);
  }
  return SB.listImages(cat, { from, to });
}

async function loadMgrNextPage() {
    if (!mgrHasMore || mgrLoading) return;
    mgrLoading = true;
    try {
      const grid = $("#manage-grid");
      const chunk = await mgrChunk(currentManageCat, mgrOffset, mgrOffset + MGMT_PAGE - 1);
      const validIds = new Set(chunk.map(i => i.id));
      selectedImages = new Set([...selectedImages].filter(id => validIds.has(id)));
      updateBatchBtn();
      const newCells = [];
      for (const img of chunk) {
        const cell = await buildManageCell(img);
        grid.appendChild(cell);
        newCells.push(cell);
      }
      mgrOffset += chunk.length;
      mgrHasMore = chunk.length >= MGMT_PAGE;
      $("#manage-empty").classList.toggle("hidden", mgrPageAllConcat(chunk) > 0);
      setupMgrSentinel();
    } finally {
      mgrLoading = false;
    }
  }

function mgrPageAllConcat(chunk) { _mgrLoadedCount += chunk.length; return _mgrLoadedCount; }

async function renderManageGrid(allImgs, usedCats) {
    const grid = $("#manage-grid");
    grid.innerHTML = "";
    removeMgrSentinel();
    mgrPageAll = [];
    mgrOffset = 0;
    mgrLoading = false;
    _mgrLoadedCount = 0;
    mgrHasMore = true;

    const validIds0 = new Set();
    selectedImages = new Set([...selectedImages].filter(id => validIds0.has(id)));
    updateBatchBtn();
    $("#manage-empty").classList.toggle("hidden", false);
    await loadMgrNextPage();
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
    if (!guardZone("visual", "无权限：只有可操作视觉专区的管理员可打标")) return;
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
        await refreshTagConsumers();
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
      await refreshTagConsumers();
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
      await refreshTagConsumers();
    } catch (e) { sbToast("添加失败：" + (e.message || ""), false); }
  }

async function deleteTagDef(def, type, used) {
    const tname = def.name;
    if (!confirm("确认删除「" + tname + "」" + (used > 0 ? "？该标签当前被 " + used + " 张图片使用，将一并从这些图片上移除。" : "？"))) return;
    try {
      /* 顺序：先把图片上的该标签清掉（数据库函数一次完成；函数未建库时自动分批清理，单条失败不中断），
         再删标签定义本身 —— 反过来的话清除时就用不到标签名了。
         旧写法是「拉全表 → 逐张更新 → 最后才删定义」，任意一张失败就整批中止，标签定义反而永远删不掉。 */
      let n = 0;
      if (used > 0) {
        n = await SB.removeTagFromImages(type, tname);
        if (SB._lastBulkFailed) sbToast("有 " + SB._lastBulkFailed + " 张图片未能清除（权限或网络原因），其余已处理", false);
      }
      await SB.deleteTagDef(def.id);
      sbToast("已删除标签：" + tname + (n ? "，并从 " + n + " 张图片上移除" : ""));
      await loadTagDefs();
      await refreshTagConsumers();   /* 其它读「标签管理」数据的地方一起刷新 */
    } catch (e) { sbToast("删除失败：" + (e.message || ""), false); }
  }

/* 标签 / 类目 增删改后，把其它「读标签管理数据」的面板一起刷新，
   避免出现「这边删了、那边还挂着」的不一致（智能打标候选、类目清单、常用类目、榜单类目…） */
async function refreshTagConsumers() {
    const jobs = [
      () => (typeof loadSmartAll === "function" ? loadSmartAll() : null),   /* 智能打标：类目 / 标签候选 */
      () => (typeof loadCats === "function" ? loadCats() : null),           /* 前台类目菜单 */
      () => (typeof loadFavCats === "function" ? loadFavCats() : null),     /* 常用类目 */
      () => (typeof loadManage === "function" ? loadManage() : null),       /* 图片管理：类目清单 */
      () => (typeof loadCatMgmt === "function" ? loadCatMgmt() : null),     /* 类目管理勾选清单 */
      () => (typeof loadRankCats === "function" ? loadRankCats() : null),   /* 趋势上升榜：类目下拉 */
    ];
    for (const job of jobs) {
      try { await job(); } catch (e) { /* 单个面板刷新失败不影响其它 */ }
    }
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
    const CATS = window.CAT_SEARCH;
    const cur = sel.value;
    const cats = [...new Set((imgs || []).map(i => i.category))].filter(Boolean).sort((a, b) => a.localeCompare(b, "zh"));
    if (!cats.length) { sel.innerHTML = '<option value="">全部类目</option>'; return; }
    const ordered = CATS ? CATS.sortCats(cats, currentFavCats) : cats.map(n => ({ name: n, fav: false }));
    sel.innerHTML = '<option value="">全部类目</option>' +
      ordered.map(o => `<option value="${escAttr(o.name)}">${o.fav ? "★ " : ""}${escHtml(o.name)}</option>`).join("");
    if (cur && cats.includes(cur)) sel.value = cur; else sel.value = "";
    if (CATS) {
      CATS.mountBox(sel, "cat-search-dash", "搜索类目…", (v) => { CATS.kw("dash", v); CATS.filterSelect(sel, v); });
      CATS.filterSelect(sel, CATS.kw("dash"));
    }
  }

async function loadDashboard() {
    const meta = $("#dash-meta");
    meta.textContent = "统计中…";
    let imgs = [], defs = [];
    // 看板口径 = 全站（含其他管理员上传）；图片管理列表仍是「只能改自己上传的」
    const imgsP = (typeof SB.listDashboardImages === "function")
      ? SB.listDashboardImages().catch(() => SB.listImages(null))
      : SB.listImages(null);
    try {
      [imgs, defs] = await Promise.all([imgsP, SB.listTagDefs()]);
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
      { label: "上传人数", value: new Set(imgs.map(i => i.uploaded_by).filter(Boolean)).size },
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

    // 招品回品统计已迁移到「招品回品」面板（进入该面板时刷新）
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
    if (!guardZone("visual", "无权限：只有可操作视觉专区的管理员可删除")) return;
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

// 招品回品数据统计（原在数据看板，现置于「招品回品」面板顶部；进入该面板时刷新）
  async function loadRecruitDashStats() {
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
  window.loadRecruitDashStats = loadRecruitDashStats;

  /* 暴露给其它模块 / 事件绑定 */
  Object.assign(window, {
    bindUpload, addFiles, removePending, stripExt, handleUrlMatch, renderPending, fmtSize, doUpload, loadCats, bindFavCats, loadFavCats, saveFavCats, bindCatMgmt, loadCatMgmt, addOptionToCatMgmt, renderCatOrder, moveCatOrder, saveCatMgmt, bindManage, loadManage, removeMgrSentinel, buildManageCell, setupMgrSentinel, loadMgrNextPage, mgrPageAllConcat, ensureManageLoaded, renderManageGrid, updateBatchBtn, getTagGroups, openTagModal, closeTagModal, checkedTags, applyTags, clearTags, loadFrontendDims, renderFrontendDims, loadTagDefs, renderTagDefs, makeTagdefChip, renameTagDef, bindTagDefs, addTagDef, deleteTagDef, refreshTagConsumers, bindDashboard, buildDashCatFilter, loadDashboard, loadRecruitDashStats, renderHBars, toggleSelectAll, batchDelete, refreshAfterImageChange, removeImage, escHtml, escAttr, sbToast
  });

})();
