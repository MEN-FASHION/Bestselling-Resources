/* ============================================================
 * TREND BANK · 后台管理（tasks）
 * 说明：本文件由原单文件 admin.js 按面板拆分而来。
 *  - 共享状态在文件顶部声明（全局作用域，跨文件可见）
 *  - 函数定义在文件内 IIFE 中，末尾通过 Object.assign(window, {...}) 暴露给其它模块
 * ============================================================ */

/* ---------- 共享状态 ---------- */
// ================= 招品回品专区：后台管理 =================
let recruitTasks = [];

let recruitAllSubs = [];

let recruitFilter = "";

// "" | published | submitted | bound
let recruitFlagFilter = "";

// 标记筛选 "" | ip | brand | cat_mismatch | no_refill
let recruitFlagCat = "";

// 标记统计类目筛选（"" = 全部类目）
let recruitSideCat = "";

// 左侧类目菜单当前选中类目（"" = 全部）
let recruitSideCats = [];

// 左侧类目菜单类目列表
let recruitSelected = new Set();

// 卡片勾选
let recruitTrash = [];

// 回收站任务
let recruitTrashSelected = new Set();

// 回收站勾选
let recruitInTrash = false;

// ===== 招品回品改版：先传表格 → 有「首图URL」直接成卡片 / 无URL按任务ID补图 =====
const recruitSelRows = new Set();

// 预览区被勾选的卡片（用于批量调整类目）
let recruitRows = [];

// 解析后的表格行（含全部字段）
let recruitHasImgRows = [];

// 有首图URL 的行（可直接导入）
let recruitNoImgRows = [];

// 无首图URL 的行（需按任务ID补图）
let recruitNoImgFiles = [];

/* ============================================================
 * 审核标记（IP / 品牌 / 类目错放 / 无需回品）—— 招品回品 + BESTSELLER 共用
 * ============================================================ */
const TASK_FLAG_DEFS = [
  { key: "flag_ip", val: "ip", label: "IP" },
  { key: "flag_brand", val: "brand", label: "品牌" },
  { key: "flag_cat_mismatch", val: "cat_mismatch", label: "类目错放" },
  { key: "flag_no_refill", val: "no_refill", label: "无需回品" },
];

/* ============================================================
 * 数据导出（仅管理员）：筛选栏与前台一致（类目 + 六维度），导出 Excel 含图片与分类标签
 * ============================================================ */
let exportImgs = [];

let exportTok = "";

// 数据导出图片预览所需的登录令牌
let exportDefs = [];

let exportCat = "";

// 当前导出类目筛选值
let exportState = { channel: "", style: "", element: "", scene: "", shoot: "", skin: "" };

const exportDimsCfg = () => [
  { key: "channel", field: "tags", lab: "渠道", names: (window.CONFIG.CHANNEL_TAGS || []).flatMap(g => g.tags || []) },
  { key: "style", field: "style_tags", lab: "风格", names: exportDefs.filter(d => d.type === "style").map(d => d.name) },
  { key: "element", field: "element_tags", lab: "元素", names: exportDefs.filter(d => d.type === "element").map(d => d.name) },
  { key: "scene", field: "scene_tags", lab: "场景", names: exportDefs.filter(d => d.type === "scene").map(d => d.name) },
  { key: "shoot", field: "shoot_tags", lab: "拍摄方式", names: exportDefs.filter(d => d.type === "shoot").map(d => d.name) },
  { key: "skin", field: "skin_tags", lab: "肤色", names: exportDefs.filter(d => d.type === "skin").map(d => d.name) }
];

// 强语义词：原文与类目名都含则该词直接压过后缀，解决"羽绒衣夹克→羽绒服""牛仔短裤→牛仔裤"等
  const CAT_STRONG = ["羽绒", "牛仔", "棉", "防风", "滑雪", "连裤", "针织", "皮衣", "西装", "卫衣", "毛衫", "礼服"];

// ================= 专区类目：类目设置弹窗（新增/改名/删除/搜索） =================
let zoneCatModalZone = "recruit";

let zoneCatModalCats = [];
(function () {

// 复制专区类目分享链接（方案A）：trends.html?zone=recruit|bestseller&cat=类目名
  function copyZoneCatLink(zone, cat) {
    const c = (cat || "").trim();
    if (!c) { sbToast("请先选择一个类目", false); return; }
    const base = new URL(window.location.href);
    const link = base.origin + base.pathname.replace(/\/[^\/]*$/, "/trends.html") + "?zone=" + encodeURIComponent(zone) + "&cat=" + encodeURIComponent(c);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(() => sbToast("已复制「" + c + "」分享链接")).catch(() => prompt("复制分享链接：", link));
    } else {
      prompt("复制分享链接：", link);
    }
  }

function bindShareCatBtn(btnId, zone, checkSide) {
    const btn = document.querySelector("#" + btnId);
    if (!btn) return;
    btn.addEventListener("click", () => {
      const cat = checkSide ? (zone === "bestseller" ? bestsellerSideCat : recruitSideCat) : "";
      if (cat) { copyZoneCatLink(zone, cat); return; }
      const sel = document.querySelector("#" + zone + "-flag-cat-filter");
      const c = sel ? sel.value : "";
      copyZoneCatLink(zone, c);
    });
  }

// ===== 传图进度条通用工具 =====
  function upShow(progId, barId, txtId, pct, text) {
    const p = document.querySelector(progId);
    if (p) p.classList.remove("hidden");
    const b = document.querySelector(barId);
    if (b) b.style.width = (pct == null || pct < 0 ? 6 : pct) + "%";
    const t = document.querySelector(txtId);
    if (t) t.textContent = text || "";
  }

function upHide(progId, barId) {
    const p = document.querySelector(progId);
    if (p) p.classList.add("hidden");
    const b = document.querySelector(barId);
    if (b) b.style.width = "0%";
    const t = document.querySelector(progId.replace("-prog", "-progtxt") || "");  // 兼容性占位
  }

function clearPane(inputId, previewId, fileId, resultId, progId, barId, clearStateFn) {
    const i = document.querySelector(inputId);
    if (i) i.value = "";
    const p = document.querySelector(previewId);
    if (p) { p.classList.add("hidden"); p.innerHTML = ""; }
    const f = document.querySelector(fileId);
    if (f) f.textContent = "";
    const r = document.querySelector(resultId);
    if (r) { r.textContent = ""; r.className = "url-match-result"; }
    upHide(progId, barId);
    if (typeof clearStateFn === "function") clearStateFn();
  }

// 依据表头解析8个字段列名（任务ID/站点id/行业链接/开款优先级/开款类型/招品原因/提需时间/首图URL）
  function recruitPickKeys(firstRow) {
    const keys = Object.keys(firstRow || {});
    const norm = (s) => String(s).toLowerCase().replace(/[\s_\-．.（()）（）]/g, "");
    const out = { task: "", site: "", link: "", priority: "", type: "", reason: "", time: "", img: "", cat: "" };
    const pick = (cond, assign) => { if (out[assign]) return; for (const k of keys) { if (cond(norm(k))) { out[assign] = k; return; } } };
    pick(n => n.includes("任务id") || n.includes("taskid") || n.includes("任务") || n.includes("序号"), "task");
    pick(n => n.includes("站点"), "site");
    pick(n => n.includes("行业链接") || (n.includes("链接") && !out.link), "link");
    pick(n => n.includes("开款优先级") || n.includes("优先级") || n.includes("priority"), "priority");
    pick(n => n.includes("开款类型") || n.includes("类型") || n.includes("type"), "type");
    pick(n => n.includes("招品原因") || n.includes("原因") || n.includes("reason"), "reason");
    pick(n => n.includes("提需时间") || n.includes("提需") || n.includes("时间") || n.includes("time"), "time");
    pick(n => n.includes("首图") || n.includes("主图") || n.includes("图片") || n.includes("img") || n.includes("url"), "img");    pick(n => (n.includes("叶子类目名") || n.includes("类目名") || n.includes("类目") || n.includes("品类") || n.includes("category")) && !n.includes("行业") && !n.includes("英文") && !/english/i.test(n), "cat");
    return out;
  }

// 上传表格（唯一入口）
  async function handleRecruitXlsx(files) {
    if (typeof XLSX === "undefined") return sbToast("Excel解析组件未加载，请联网后重试", false);
    if (!files || !files.length) return;
    const file = files[0];
    const mr = document.querySelector("#recruit-xlsx-result");
    const fname = document.querySelector("#recruit-xlsx-file");
    if (fname) fname.textContent = file.name;
    upShow("#recruit-xlsx-prog", "#recruit-xlsx-progbar", "#recruit-xlsx-progtxt", 30, "正在解析表格…");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (!rows.length) { upHide("#recruit-xlsx-prog", "#recruit-xlsx-progbar"); return sbToast("表格没有数据行", false); }
        const keys = recruitPickKeys(rows[0]);
        if (!keys.task) { upHide("#recruit-xlsx-prog", "#recruit-xlsx-progbar"); return sbToast("未找到「任务ID」列，请检查表头", false); }
        if (!keys.img) { upHide("#recruit-xlsx-prog", "#recruit-xlsx-progbar"); return sbToast("未找到「首图URL」列，请检查表头", false); }
        const has = [], noimg = [];
        rows.forEach(r => {
          const task_id = String(r[keys.task] || "").trim();
          if (!task_id) return;
          const main_img_url = String((keys.img ? r[keys.img] : "") || "").trim();
          const cat_raw = keys.cat ? String(r[keys.cat] || "").trim() : "";
          const row = {
            task_id,
            site_id: keys.site ? String(r[keys.site] || "").trim() : "",
            industry_link: keys.link ? String(r[keys.link] || "").trim() : "",
            open_priority: keys.priority ? String(r[keys.priority] || "").trim() : "",
            open_type: keys.type ? String(r[keys.type] || "").trim() : "",
            recruit_reason: keys.reason ? String(r[keys.reason] || "").trim() : "",
            required_at: keys.time ? String(r[keys.time] || "").trim() : "",
            cat_raw, category: (window.RECRUIT_CAT_MATCH && window.RECRUIT_CAT_CONFIRM) ? window.RECRUIT_CAT_CONFIRM(window.RECRUIT_CAT_MATCH(cat_raw)) : "",
            main_img_url, image_path: "", url: null,
          };
          (main_img_url ? has : noimg).push(row);
        });
        if (!has.length && !noimg.length) { upHide("#recruit-xlsx-prog", "#recruit-xlsx-progbar"); return sbToast("表格中没有有效的「任务ID」数据行", false); }
        recruitRows = has.concat(noimg);
        recruitHasImgRows = has; recruitNoImgRows = noimg;
        recruitNoImgFiles = [];
        const needImg = noimg.length ? `；其中 ${noimg.length} 行缺少「首图URL」，需按任务ID补充图片` : "";
        upShow("#recruit-xlsx-prog", "#recruit-xlsx-progbar", "#recruit-xlsx-progtxt", 100, "解析完成 " + recruitRows.length + " 条" + needImg);
        setTimeout(() => upHide("#recruit-xlsx-prog", "#recruit-xlsx-progbar"), 800);
        if (mr) { mr.textContent = "共解析 " + recruitRows.length + " 行：可直接导入 " + has.length + " 行" + (noimg.length ? "，需补图 " + noimg.length + " 行" : ""); mr.className = "url-match-result ok"; }
        sbToast("解析完成 " + recruitRows.length + " 条", true);
        buildRecruitXlsxPreview();
      } catch (e) {
        upHide("#recruit-xlsx-prog", "#recruit-xlsx-progbar");
        if (mr) { mr.textContent = "表格解析失败，请检查文件格式"; mr.className = "url-match-result"; }
        sbToast("表格解析失败，请检查文件格式", false);
      }
    };
    reader.readAsArrayBuffer(file);
  }

function buildRecruitXlsxPreview() {
    const pre = document.querySelector("#recruit-xlsx-preview");
    if (!pre) return;
    pre.classList.remove("hidden");
    pre.innerHTML = "";
    // 批量类目工具条：一次把「全部行」统一设为某类目（单张仍可由卡片下拉单独调整）
    const tb = document.createElement("div");
    tb.className = "rg-batch-bar";
    // 类目搜索：批量/行内/正式卡片的下拉共用同一个关键词，输入一次全缩范围
    if (window.CAT_SEARCH) {
      window.CAT_SEARCH.mountBox(tb, "cat-search-recruit", "搜索类目…", (v) => {
        window.CAT_SEARCH.kw("recruit", v);
        document.querySelectorAll(".rg-batch-sel, .rg-row-cat-sel, .rcac-cat-sel")
          .forEach(s => window.CAT_SEARCH.filterSelect(s, v));
      });
    }
    const tbLabel = document.createElement("span");
    tbLabel.className = "rg-batch-label"; tbLabel.textContent = "批量类目：";
    tb.appendChild(tbLabel);
    // 勾选说明 + 未匹配统计
    const selInfo = document.createElement("span");
    selInfo.className = "rg-batch-label"; selInfo.textContent = "(默认作用于全部，可先勾选卡片只改选中项)";
    tb.appendChild(selInfo);
    const batchSel = document.createElement("select");
    batchSel.className = "rg-batch-sel";
    const bo0 = document.createElement("option"); bo0.value = ""; bo0.textContent = "（设为…）";
    batchSel.appendChild(bo0);
    (window.RECRUIT_CAT_POOL || []).forEach(c => {
      const o = document.createElement("option"); o.value = c; o.textContent = c; batchSel.appendChild(o);
    });
    batchSel.addEventListener("change", () => {
      const v = batchSel.value;
      if (!v) return;
      // 若勾选了卡片则只改选中项，否则作用于全部
      const targets = recruitSelRows.size ? recruitRows.filter(r => recruitSelRows.has(r)) : recruitRows.slice();
      if (!targets.length) { sbToast("未找到可设置的目标行", false); batchSel.value = ""; return; }
      targets.forEach(r => { r.category = v; });
      // 同步更新目标行卡片上的标签与下拉状态（匹配目标行对象，不回退其它行）
      pre.querySelectorAll(".rg-row-cat").forEach(w => {
        const sel = w.querySelector(".rg-row-cat-sel");
        const tag = w.querySelector(".rg-row-cat-tag");
        const rowRef = w.__row;
        let hit = false;
        if (rowRef && recruitSelRows.size) hit = recruitSelRows.has(rowRef);
        else if (rowRef) hit = targets.indexOf(rowRef) >= 0;
        if (!hit) return;
        if (tag) { tag.className = "rg-row-cat-tag"; tag.textContent = "已设为：" + v; }
        if (sel && sel.value === "") sel.value = "";
        // 清除该卡片未匹配高亮
        const cell = w.closest(".bestseller-pre-cell");
        if (cell) cell.classList.remove("rg-cat-miss");
      });
      sbToast("已将" + (recruitSelRows.size ? "选中 " + targets.length : "全部 " + targets.length) + " 行类目设为「" + v + "」", true);
      if (recruitSelRows.size) { recruitSelRows.clear(); pre.querySelectorAll(".bestseller-pre-cell").forEach(c => c.classList.remove("rg-card-selected")); }
      batchSel.value = "";
    });
    tb.appendChild(batchSel);
    // 未匹配统计 + 定位、清空勾选
    const missCount = recruitRows.filter(r => !String(r.category || "").trim()).length;
    const missSpan = document.createElement("span");
    missSpan.className = "rg-batch-label" + (missCount ? " miss-badge" : "");
    missSpan.textContent = missCount ? ("未匹配 " + missCount + " 张") : "全部已匹配";
    tb.appendChild(missSpan);
    if (missCount) {
      const loc = document.createElement("button");
      loc.type = "button"; loc.className = "rg-mini-btn2"; loc.textContent = "定位未匹配";
      loc.addEventListener("click", () => {
        const c = pre.querySelector(".rg-cat-miss");
        if (c) { c.scrollIntoView({ behavior: "smooth", block: "center" }); c.classList.add("rg-flash"); setTimeout(() => c.classList.remove("rg-flash"), 1600); }
      });
      tb.appendChild(loc);
    }
    if (recruitSelRows.size) {
      const clr = document.createElement("button");
      clr.type = "button"; clr.className = "rg-mini-btn2"; clr.textContent = "取消勾选";
      clr.addEventListener("click", () => { recruitSelRows.clear(); buildRecruitXlsxPreview(); });
      tb.appendChild(clr);
      const delSel = document.createElement("button");
      delSel.type = "button"; delSel.className = "rg-mini-btn2 rg-mini-del"; delSel.textContent = "删除选中 " + recruitSelRows.size + " 张（不导入）";
      delSel.addEventListener("click", () => {
        if (!confirm("确认将勾选的 " + recruitSelRows.size + " 行移除（不导入）？")) return;
        const arr = [...recruitSelRows];
        arr.forEach(r => {
          const dump = a => { const i = a.indexOf(r); if (i >= 0) a.splice(i, 1); };
          dump(recruitRows); dump(recruitHasImgRows); dump(recruitNoImgRows);
          const key = String(r.task_id || "").replace(/\s+/g, "");
          if (key) recruitNoImgFiles = recruitNoImgFiles.filter(f => String(f.task_id || "").replace(/\s+/g, "") !== key);
        });
        recruitSelRows.clear();
        buildRecruitXlsxPreview();
      });
      tb.appendChild(delSel);
    }
    pre.appendChild(tb);
    if (recruitHasImgRows.length) {
      const head1 = document.createElement("div");
      head1.className = "rg-sec-head"; head1.textContent = "可直接导入（有首图URL，共 " + recruitHasImgRows.length + " 行）";
      pre.appendChild(head1);
      const wrap1 = document.createElement("div"); wrap1.className = "bestseller-pre-grid";
      recruitHasImgRows.forEach(x => { wrap1.appendChild(recruitPreCell(x.task_id + " · " + (window.CONFIG.siteName(x.site_id) || x.site_id || ""), x.main_img_url, true, x)); });
      pre.appendChild(wrap1);
    }
    if (recruitNoImgRows.length) {
      const head2 = document.createElement("div");
      head2.className = "rg-sec-head warn"; head2.textContent = "需补充图片（无首图URL，共 " + recruitNoImgRows.length + " 行，请用③按任务ID上传图片）";
      pre.appendChild(head2);
      const wrap2 = document.createElement("div"); wrap2.className = "bestseller-pre-grid";
      recruitNoImgRows.forEach(x => { wrap2.appendChild(recruitPreCell("任务ID：" + x.task_id, "", false, x)); });
      pre.appendChild(wrap2);
    }
    if (recruitNoImgFiles.length) {
      const head3 = document.createElement("div");
      head3.className = "rg-sec-head warn"; head3.textContent = "已匹配补充图片（" + recruitNoImgFiles.length + " 张）";
      pre.appendChild(head3);
      const wrap3 = document.createElement("div"); wrap3.className = "bestseller-pre-grid";
      recruitNoImgFiles.forEach(m => { wrap3.appendChild(recruitPreCell("任务ID：" + m.task_id, URL.createObjectURL(m.file), false)); });
      pre.appendChild(wrap3);
    }
    const tail = document.createElement("div");
    tail.className = "bestseller-pre-commit";
    const needImg = recruitNoImgRows.length - recruitNoImgFiles.length;
    tail.innerHTML = (recruitHasImgRows.length || recruitNoImgRows.length)
      ? '<button id="recruit-xlsx-commit" class="btn-primary" type="button">导入并生成任务卡片</button><span class="hint-inline">' + (needImg > 0 ? "（还有 " + needImg + " 行缺少图片，请先在③补图再导入）" : "（可直接导入全部 " + recruitRows.length + " 行）") + '</span>'
      : "";
    pre.appendChild(tail);
    const bt = tail.querySelector("#recruit-xlsx-commit");
    if (bt) bt.onclick = () => commitRecruitImport();
  }

// 通用图片放大层：预览/列表中点击图片放大查看
  function openImgZoom(url, label) {
    if (!url) return;
    let ov = document.getElementById("rg-zoom-layer");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "rg-zoom-layer";
      ov.className = "lightbox";
      ov.innerHTML = '<img alt=""><div class="rg-zoom-cap"></div>';
      document.body.appendChild(ov);
      ov.addEventListener("click", (e) => { if (e.target === ov) closeImgZoom(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !ov.classList.contains("hidden")) closeImgZoom(); });
    }
    const img = ov.querySelector("img");
    const cap = ov.querySelector(".rg-zoom-cap");
    if (img) { img.src = url; img.style.cursor = "zoom-out"; }
    if (cap) cap.textContent = label || "";
    ov.classList.remove("hidden");
  }

function closeImgZoom() {
    const ov = document.getElementById("rg-zoom-layer");
    if (ov) ov.classList.add("hidden");
  }

function recruitPreCell(label, url, hasUrl, row) {
    const cell = document.createElement("div");
    const noimgClass = (hasUrl && url) ? "" : " noimg";
    cell.className = "bestseller-pre-cell" + noimgClass;
    // 勾选按钮：可点选卡片，配合批量类目调整（row 存在才会有类目调整）
    if (row) {
      const miss = !String(row.category || "").trim();
      if (miss) cell.classList.add("rg-cat-miss");
      const pick = document.createElement("button");
      pick.type = "button";
      pick.className = "rg-card-pick";
      const syncPick = () => {
        const on = recruitSelRows.has(row);
        pick.classList.toggle("on", on);
        pick.textContent = on ? "☑" : "☐";
        pick.title = on ? "已选中，再点取消" : "点选此卡片（可与其它卡片一起批量改类目）";
        cell.classList.toggle("rg-card-selected", on);
      };
      pick.addEventListener("click", (e) => {
        e.stopPropagation();
        if (recruitSelRows.has(row)) recruitSelRows.delete(row); else recruitSelRows.add(row);
        syncPick();
      });
      syncPick();
      cell.appendChild(pick);
    }
    const im = document.createElement("img");
    if (hasUrl && url) im.src = url; else { im.style.display = "none"; }
    if (hasUrl && url) {
      im.title = "点击放大查看";
      im.style.cursor = "zoom-in";
      im.addEventListener("click", (e) => { e.stopPropagation(); openImgZoom(url, label); });
    }
    // 放大查看按钮（对无首图URL但已补图的 div 覆盖不了，这里对有URL/已补图均可显示）
    if (url) {
      const zoomBtn = document.createElement("button");
      zoomBtn.type = "button";
      zoomBtn.className = "rg-card-zoom";
      zoomBtn.textContent = "🔍";
      zoomBtn.title = "点击放大";
      zoomBtn.addEventListener("click", (e) => { e.stopPropagation(); openImgZoom(url, label); });
      cell.appendChild(zoomBtn);
    }
    // 删除该行（不导入）：仅对可调整类目的 row 卡
    if (row) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "rg-card-del";
      delBtn.textContent = "✕";
      delBtn.title = "不导入此行（从匹配中移除）";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm("确认不导入该「" + label + "」？")) return;
        removeRecruitRow(row);
      });
      cell.appendChild(delBtn);
    }
    const lbl = document.createElement("div");
    lbl.className = "bestseller-pre-url";
    lbl.innerHTML = "<span>" + String(label || "") + "</span>" + (hasUrl ? '<span class="purl">🔗 首图URL</span>' : '<span class="purl" style="color:#ebb040">待补图</span>');
    cell.appendChild(im);
    // 每行类目：显示自动匹配结果 + 可手动调整下拉
    if (row) cell.appendChild(recruitRowCatWrap(row));
    cell.appendChild(lbl);
    return cell;
  }

// 删除某行（不导入）：从预览数据集中移除，并清理勾选集/未匹配标记
  function removeRecruitRow(row) {
    const dump = a => { const i = a.indexOf(row); if (i >= 0) a.splice(i, 1); };
    dump(recruitRows); dump(recruitHasImgRows); dump(recruitNoImgRows);
    // 同步相关图片文件（无URL行按 task_id 匹配）
    const key = String(row.task_id || "").replace(/\s+/g, "");
    if (key) recruitNoImgFiles = recruitNoImgFiles.filter(f => String(f.task_id || "").replace(/\s+/g, "") !== key);
    recruitSelRows.delete(row);
    buildRecruitXlsxPreview();
  }

function recruitRowCatWrap(row) {
    const wrap = document.createElement("div");
    wrap.className = "rg-row-cat";
    wrap.__row = row;
    let matched = String(row.category || "").trim();
    if (matched) {
      wrap.innerHTML = '<span class="rg-row-cat-tag">自动匹配：' + escHtml(matched) + '</span>';
    } else {
      wrap.innerHTML = '<span class="rg-row-cat-tag miss">未匹配到类目，请手动选择</span>';
    }
    const sel = document.createElement("select");
    sel.className = "rg-row-cat-sel";
    const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "手动调整…";
    sel.appendChild(o0);
    (window.RECRUIT_CAT_POOL || []).forEach(c => {
      const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o);
    });
    sel.addEventListener("change", () => { row.category = sel.value; matched = row.category;
      const tag = wrap.querySelector(".rg-row-cat-tag");
      if (tag) { tag.className = "rg-row-cat-tag"; tag.textContent = "已设为：" + (sel.value || matched); }
      const cell = wrap.closest(".bestseller-pre-cell");
      if (cell && row.category) cell.classList.remove("rg-cat-miss");
    });
    wrap.appendChild(sel);
    return wrap;
  }

// ③ 无URL行补充图片：按文件名=任务ID匹配
  function handleRecruitNoImgFiles(files) {
    if (!files || !files.length) return;
    if (!recruitNoImgRows.length) return sbToast("当前表格没有缺少首图URL的任务，无需补图", false);
    const byTask = {};
    recruitNoImgRows.forEach(r => { byTask[String(r.task_id).replace(/\s+/g, "")] = r.task_id; });
    let matched = 0, unmatched = 0;
    files.forEach(f => {
      const key = (f.name || "").replace(/\.[^.]+$/, "").trim().replace(/\s+/g, "");
      if (byTask[key]) {
        const exists = recruitNoImgFiles.some(x => x.task_id === byTask[key]);
        if (!exists) { recruitNoImgFiles.push({ file: f, task_id: byTask[key] }); matched++; }
      } else unmatched++;
    });
    const fname = document.querySelector("#recruit-imgxlsx-file");
    if (fname) fname.textContent = recruitNoImgFiles.length + " 张待补图（匹配 " + matched + " 张" + (unmatched ? "，" + unmatched + " 张未匹配" : "") + "）";
    if (matched) sbToast("已匹配 " + matched + " 张待补图图片" + (unmatched ? "，" + unmatched + " 张未匹配到任务ID" : ""), true);
    else sbToast("没有图片能匹配到缺少首图URL的任务ID，请核对文件名（文件名=任务ID）", false);
    buildRecruitXlsxPreview();
  }

// 导入：有URL行直接成卡片；无URL行把已匹配图片上传R2后成卡片
  async function commitRecruitImport() {
    if (!guardZone("recruit", "无权限：只有可操作招品回品专区的管理员可导入")) return;
    // 每行类目：优先取行内自动匹配/手动调整的 category；否则回退到下拉（兼容旧流程）
    const globalCat = document.querySelector("#recruit-category")?.value || "";
    const rowCat = r => String(r.category || "").trim() || globalCat;
    const noCat = recruitRows.filter(r => !rowCat(r));
    if (noCat.length && !globalCat) { sbToast("还有 " + noCat.length + " 行未自动匹配到类目，请在预览区为这些行手动选择类目", false); return; }
    const missing = recruitNoImgRows.length - recruitNoImgFiles.length;
    if (missing > 0) { sbToast("还有 " + missing + " 行缺少对应的任务ID图片，请先用③上传后再导入", false); return; }
    const bt = document.querySelector("#recruit-xlsx-commit");
    if (bt) { bt.disabled = true; bt.textContent = "正在导入…"; }
    const total = recruitNoImgFiles.length;
    const rows = [];
    // 无URL行：上传图片
    for (let i = 0; i < total; i++) {
      const m = recruitNoImgFiles[i];
      try {
        const path = await SB.uploadRecruitImage(m.file);
        const src = recruitNoImgRows.find(r => String(r.task_id).replace(/\s+/g, "") === String(m.task_id).replace(/\s+/g, ""));
        rows.push(Object.assign({}, src, { image_path: path, category: rowCat(src), status: "published", tags: [] }));
        upShow("#recruit-imgxlsx-prog", "#recruit-imgxlsx-progbar", "#recruit-imgxlsx-progtxt", Math.round((i + 1) / total * 100), "上传图片 " + (i + 1) + "/" + total);
      } catch (e) {
        sbToast("图片上传失败：" + (e.message || m.file.name), false);
        if (bt) { bt.disabled = false; bt.textContent = "导入并生成任务卡片"; }
        upHide("#recruit-imgxlsx-prog", "#recruit-imgxlsx-progbar");
        return;
      }
    }
    // 有URL行直接成卡片
    recruitHasImgRows.forEach(x => rows.push(Object.assign({}, x, { category: rowCat(x), status: "published", tags: [] })));
    try {
      await SB.addRecruitTasks(rows);
      resetRecruitImport();
      sbToast("已导入 " + rows.length + " 条任务卡片", true);
      loadRecruitList();
    } catch (e) {
      upHide("#recruit-imgxlsx-prog", "#recruit-imgxlsx-progbar");
      sbToast("导入失败：" + (e.message || ""), false);
    }
    if (bt) { bt.disabled = false; bt.textContent = "导入并生成任务卡片"; }
    upHide("#recruit-imgxlsx-prog", "#recruit-imgxlsx-progbar");
  }

function resetRecruitImport() {
    recruitRows = []; recruitHasImgRows = []; recruitNoImgRows = []; recruitNoImgFiles = [];
    ["#recruit-xlsx-preview", "#recruit-imgxlsx-preview"].forEach(id => { const p = document.querySelector(id); if (p) { p.classList.add("hidden"); p.innerHTML = ""; } });
    ["#recruit-xlsx-file", "#recruit-imgxlsx-file"].forEach(id => { const f = document.querySelector(id); if (f) f.textContent = ""; });
    ["#recruit-xlsx-result", "#recruit-imgxlsx-result"].forEach(id => { const r = document.querySelector(id); if (r) { r.textContent = ""; r.className = "url-match-result"; } });
    const i = document.querySelector("#recruit-imgxlsx-input"); if (i) i.value = "";
  }

function bindRecruitMatch() {
    // ① 上传表格
    const xBtn = document.querySelector("#recruit-xlsx-btn");
    const xInput = document.querySelector("#recruit-xlsx-input");
    if (xBtn && xInput) {
      xBtn.addEventListener("click", () => xInput.click());
      xInput.addEventListener("change", () => { if (xInput.files && xInput.files.length) { handleRecruitXlsx([...xInput.files]); xInput.value = ""; } });
    }
    const xClear = document.querySelector("#recruit-xlsx-clear");
    if (xClear) xClear.addEventListener("click", () => { resetRecruitImport(); clearPane("#recruit-xlsx-input", "#recruit-xlsx-preview", "#recruit-xlsx-file", "#recruit-xlsx-result", "#recruit-xlsx-prog", "#recruit-xlsx-progbar", () => { recruitRows = []; recruitHasImgRows = []; recruitNoImgRows = []; recruitNoImgFiles = []; }); });
    // ③ 补充图片
    const iBtn = document.querySelector("#recruit-imgxlsx-btn");
    const iInput = document.querySelector("#recruit-imgxlsx-input");
    if (iBtn && iInput) {
      iBtn.addEventListener("click", () => iInput.click());
      iInput.addEventListener("change", () => { if (iInput.files && iInput.files.length) { handleRecruitNoImgFiles([...iInput.files]); iInput.value = ""; } });
    }
    const iClear = document.querySelector("#recruit-imgxlsx-clear");
    if (iClear) iClear.addEventListener("click", () => { if (iInput) iInput.value = ""; clearPane("#recruit-imgxlsx-input", "#recruit-imgxlsx-preview", "#recruit-imgxlsx-file", "#recruit-imgxlsx-result", "#recruit-imgxlsx-prog", "#recruit-imgxlsx-progbar", () => { recruitNoImgFiles = []; }); });
  }

function bindRecruit() {
    bindRecruitMatch();
    const upBtn = document.querySelector("#recruit-save");
    const refresh = document.querySelector("#recruit-refresh");
    if (upBtn) upBtn.addEventListener("click", commitRecruitImport);
    if (refresh) refresh.addEventListener("click", loadRecruitList);
    // 筛选
    document.querySelectorAll("#recruit-filters .recruit-filter").forEach(b => {
      b.onclick = () => { recruitFilter = b.dataset.st || ""; renderRecruitList(); };
    });
    // 复制分类分享链接
    bindShareCatBtn("recruit-share-cat", "recruit", true);
    // 标记筛选
    const rf = document.querySelector("#recruit-flag-filter");
    if (rf) rf.addEventListener("change", () => { recruitFlagFilter = rf.value || ""; renderRecruitList(); });
    // 标记统计类目筛选
    const rfc = document.querySelector("#recruit-flag-cat-filter");
    if (rfc) rfc.addEventListener("change", () => { recruitFlagCat = rfc.value || ""; renderRecruitFlagStats(); });
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
  }

async function loadRecruitList() {
    if (!document.querySelector("#recruit-list")) return;
    try {
      recruitTasks = await SB.listRecruitTasks();
      recruitAllSubs = await SB.listAllRecruitSubmissions().catch(() => []);
      fillTaskFlagCatSelect(recruitTasks, "#recruit-flag-cat-filter");
      loadZoneCatSide("recruit");
      renderRecruitFlagStats();
      renderRecruitList();
    } catch (e) { sbToast("加载招品列表失败", false); }
  }

function recruitSubsFor(taskId) {
    return recruitAllSubs.filter(s => s.recruit_task_id === taskId);
  }

// 提需时间只展示到日：截取 YYYY-MM-DD 或 YYYY-MM-DD 之前部分
  function recruitDay(v) {
    const s = String(v == null ? "" : v).trim();
    if (!s) return "";
    const m = s.match(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/);
    if (m) return m[0].replace(/[年\/.]/g, "-").replace(/月/g, "-").replace(/-$/, "");
    return s;
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
    document.querySelectorAll("#recruit-filters .recruit-filter").forEach(b => b.classList.toggle("active", (b.dataset.st || "") === recruitFilter));
    let list = recruitTasks;
    if (recruitFilter === "published") list = list.filter(t => t.status === "published" && !t.bound);
    else if (recruitFilter === "submitted") list = list.filter(t => t.status === "published" && recruitSubsFor(t.id).length > 0 && !t.bound);
    else if (recruitFilter === "bound") list = list.filter(t => t.bound);
    else if (recruitFilter === "no_refill") list = list.filter(t => t.flag_no_refill);
    if (recruitSideCat) list = list.filter(t => (t.category || "") === recruitSideCat);
    if (recruitFlagFilter) list = list.filter(t => taskHasFlag(t, recruitFlagFilter));
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
      const chip = st === "bound" ? recruitStatusChip("chip-bound", "已回品")
        : st === "submitted" ? recruitStatusChip("chip-sub", "商家已上传")
        : st === "published" ? recruitStatusChip("chip-pub", "已发布")
        : recruitStatusChip("chip-draft", "未发布");
      card.innerHTML =
        '<div class="recruit-acard-imghold">' +
          '<img class="recruit-acard-img" alt="">' +
          '<span class="recruit-acard-no">' + seq + '</span>' +
          '<span class="recruit-acard-copyid" title="点击复制任务ID" data-id="' + escAttr(t.task_id || "") + '">任务ID：' + escHtml(t.task_id || "（未填写）") + '</span>' +
          '<span class="recruit-acard-del" title="删除">×</span>' +
          '<span class="recruit-acard-check"><input type="checkbox" class="recruit-check"' + (recruitSelected.has(t.id) ? ' checked' : '') + '></span>' +
          '<div class="recruit-acard-flags">' + taskFlagBoxHTML(t, "recruit") + '</div>' +
        '</div>' +
        '<div class="recruit-acard-body">' +
          '<div class="recruit-acard-tid" title="任务ID：' + escAttr(t.task_id || "") + '">任务ID：' + escHtml(t.task_id || "（未填写）") + '</div>' +
          '<div class="recruit-acard-site">站点：' + escHtml(window.CONFIG.siteName(t.site_id) || "—") + '</div>' +
          '<div class="recruit-acard-info">' +
            (t.required_at ? '<span>提需：' + escHtml(recruitDay(t.required_at)) + '</span>' : '') +
            (t.open_priority ? '<span>优先级：' + escHtml(t.open_priority) + '</span>' : '') +
            (t.recruit_reason ? '<span>原因：' + escHtml(t.recruit_reason) + '</span>' : '') +
            (t.industry_link ? '<a class="rcac-link" href="' + escAttr(t.industry_link) + '" target="_blank" rel="noopener">行业链接 ↗</a>' : '') +
          '</div>' +
          '<div class="recruit-acard-cat" data-catwrap>类目：<span class="rcac-cat-show">' + escHtml(t.category || "—") + '</span><select class="rcac-cat-sel" title="点击调整类目"><option value="">（选一类目…）</option></select></div>' +
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
      if (t.main_img_url) {
        img.src = t.main_img_url;
        img.onload = () => img.classList.add("loaded");
        img.onerror = () => { img.classList.remove("loaded"); img.src = ""; };
      } else if (t.image_path) {
        SB.recruitImageUrl(t.image_path).then(u => {
          img.onload = () => img.classList.add("loaded");
          img.onerror = () => { img.classList.remove("loaded"); img.src = ""; };
          img.src = u;
        }).catch(() => {});
      } else {
// 点击图片放大查看
      img.title = "点击放大查看";
      img.style.cursor = "zoom-in";
      img.addEventListener("click", () => openImgZoom(img.src || t.main_img_url || "", "任务ID：" + (t.task_id || "")));
      // 放大角标
      const zhold = card.querySelector(".recruit-acard-imghold");
      if (zhold && (t.main_img_url || t.image_path)) {
        const zb = document.createElement("button");
        zb.type = "button"; zb.className = "rg-card-zoom"; zb.textContent = "🔍"; zb.title = "点击放大";
        zb.addEventListener("click", (e) => { e.stopPropagation(); openImgZoom((t.main_img_url || ""), "任务ID：" + (t.task_id || "")); });
        zhold.appendChild(zb);
      }
        card.querySelector(".recruit-acard-imghold").style.background = "rgba(255,255,255,.03)";
      }
      // 悬浮提示 SPU
      const tip = spuList.length ? ("该任务已提交货品SPU：\n" + spuList.join("\n")) : "该任务暂无商家提交SPU";
      card.querySelector(".recruit-acard-imghold").title = tip;
      card.querySelector(".recruit-acard-tid").title = tip;
      // 图片上「可复制任务ID」：点击复制
      const cid = card.querySelector(".recruit-acard-copyid");
      if (cid) {
        cid.addEventListener("click", () => {
          const v = (cid.dataset.id || "").trim();
          if (!v) return sbToast("该任务暂未填写任务ID", false);
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(() => sbToast("已复制任务ID：" + v)).catch(() => sbToast("复制失败", false));
          else sbToast("当前环境不支持复制", false);
        });
      }
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
      // 类目下拉：填充类目池并支持调整写库
      const catWrap = card.querySelector("[data-catwrap]");
      if (catWrap) {
        const catSel = catWrap.querySelector(".rcac-cat-sel");
        const catShow = catWrap.querySelector(".rcac-cat-show");
        (window.RECRUIT_CAT_POOL || []).forEach(c => {
          const o = document.createElement("option"); o.value = c; o.textContent = c; catSel.appendChild(o);
        });
        catSel.addEventListener("change", () => {
          const v = catSel.value;
          if (!v) return;
          SB.updateRecruitTask(t.id, { category: v }).then(() => {
            t.category = v;
            if (catShow) catShow.textContent = v;
            sbToast("类目已更新为「" + v + "」", true);
          }).catch(() => sbToast("类目更新失败", false));
        });
      }
      // 已传SPU 状态区
      renderRecruitSpsStatus(card, spuList.length);
      bindTaskFlagBoxes(card, t, "recruit", renderRecruitList, renderRecruitFlagStats);
      box.appendChild(card);
    });
    // 渲染完成后同步一次类目下拉：确保池就绪/重建后正式卡片下拉选项完整
    refreshRecruitCatSelects();
  }

// 已传SPU 状态标记：商家中已有提交 → 显示「已传SPU · 已上传」
  function renderRecruitSpsStatus(card, hasSubs) {
    const el = card.querySelector("[data-tags]");
    if (!el) return;
    el.innerHTML = "";
    const s = document.createElement("span");
    if (hasSubs) { s.className = "rcac-tag-chip rcac-sub-up"; s.textContent = "已传SPU · 商家已上传"; }
    else { s.className = "rcac-tag-empty"; s.textContent = "未传SPU"; }
    el.appendChild(s);
  }

async function setRecruitStatus(t, st) {
    if (!guardZone("recruit", "无权限：只有可操作招品回品专区的管理员可操作")) return;
    try {
      await SB.updateRecruitTask(t.id, { status: st });
      t.status = st; renderRecruitList(); sbToast(st === "published" ? "已发布" : "已取消发布");
    } catch (e) { sbToast("操作失败", false); }
  }

async function setRecruitBound(t, b) {
    if (!guardZone("recruit", "无权限：只有可操作招品回品专区的管理员可操作")) return;
    try {
      await SB.updateRecruitTask(t.id, { bound: b, bound_at: b ? new Date().toISOString() : null });
      t.bound = b; renderRecruitList(); sbToast(b ? "已标记为已绑定" : "已取消绑定");
    } catch (e) { sbToast("操作失败", false); }
  }

async function bulkSetRecruitStatus(st) {
    if (!guardZone("recruit", "无权限：只有可操作招品回品专区的管理员可批量操作")) return;
    const ids = [...recruitSelected];
    if (!ids.length) return sbToast("请先勾选要发布的任务", false);
    try { await SB.bulkUpdateRecruitTasks(ids, { status: st }); sbToast("已批量" + (st === "published" ? "发布" : "取消发布") + " " + ids.length + " 个任务"); loadRecruitList(); }
    catch (e) { sbToast("批量操作失败", false); }
  }

async function bulkSetRecruitBound(b) {
    if (!guardZone("recruit", "无权限：只有可操作招品回品专区的管理员可批量操作")) return;
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
    if (!guardZone("recruit", "无权限：只有可操作招品回品专区的管理员可删除")) return;
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
    if (!guardZone("recruit", "无权限：只有可操作招品回品专区的管理员可删除")) return;
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
      if (t.main_img_url) {
        img.src = t.main_img_url;
        img.onload = () => img.classList.add("loaded");
        img.onerror = () => { img.classList.remove("loaded"); img.src = ""; };
      } else if (t.image_path) {
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

function taskHasFlag(t, flagVal) {
    if (!t) return false;
    const d = TASK_FLAG_DEFS.find(x => x.val === flagVal);
    return d ? !!t[d.key] : false;
  }

function flagText(t, flagVal) { return taskHasFlag(t, flagVal) ? "√" : ""; }

// 打标框 HTML：图片右下角四个可勾选项
  function taskFlagBoxHTML(t, zone) {
    const pfx = zone === "bestseller" ? "bsflag" : "rcflag";
    let h = "";
    TASK_FLAG_DEFS.forEach(d => {
      const on = taskHasFlag(t, d.val);
      h += '<label class="rcflag-item' + (on ? " on" : "") + '" title="' + d.label + '"><input type="checkbox" class="rcflag-cb" data-flag="' + d.val + '" data-pfx="' + pfx + '"' + (on ? " checked" : "") + '><span>' + d.label + '</span></label>';
    });
    return h;
  }

// 勾选打标 / 取消打标（写库）
  function bindTaskFlagBoxes(card, t, zone, rerenderList, rerenderStats) {
    card.querySelectorAll(".rcflag-cb").forEach(cb => {
      cb.addEventListener("change", () => {
        const d = TASK_FLAG_DEFS.find(x => x.val === cb.dataset.flag);
        if (!d) return;
        const patch = {}; patch[d.key] = cb.checked;
        const upd = zone === "bestseller" ? SB.updateBestsellerTask : SB.updateRecruitTask;
        upd(t.id, patch).then(() => {
          t[d.key] = cb.checked;
          cb.parentElement.classList.toggle("on", cb.checked);
          sbToast("已" + (cb.checked ? "标记" : "取消标记") + "「" + d.label + "」");
          if (rerenderStats) rerenderStats();
          if (rerenderList) {
            // 若当前存在标记筛选且勾选状态与该筛选冲突则刷新；否则局部更新即可
            const curFlag = zone === "bestseller" ? bestsellerFlagFilter : recruitFlagFilter;
            if (curFlag && taskHasFlag(t, curFlag) === cb.checked) rerenderList();
          }
        }).catch(e => { cb.checked = !cb.checked; cb.parentElement.classList.toggle("on", cb.checked); sbToast("标记失败", false); });
      });
    });
  }

function recomputeTaskFlags(t, patch) {
    Object.keys(patch || {}).forEach(k => { if (k.indexOf("flag_") === 0) t[k] = patch[k]; });
  }

// 标记统计：按类目算各标签数量（招品回品 / BESTSELLER 两个专区共用）
  function computeTaskFlagStats(tasks, cat) {
    const src = cat ? tasks.filter(t => (t.category || "") === cat) : tasks;
    const total = src.length;
    const counts = {};
    TASK_FLAG_DEFS.forEach(d => { counts[d.val] = src.filter(t => taskHasFlag(t, d.val)).length; });
    return { total, counts };
  }

// 渲染某专区的标记统计图（顶部）
  function renderTaskFlagStats(tasks, cat, chartsId, totalId) {
    const box = document.querySelector(chartsId);
    const tEl = document.querySelector(totalId);
    if (!box) return;
    const s = computeTaskFlagStats(tasks, cat);
    if (tEl) tEl.textContent = "该类目共 " + s.total + " 个任务";
    box.innerHTML = "";
    TASK_FLAG_DEFS.forEach(d => {
      const n = s.counts[d.val];
      const pct = s.total ? Math.round(n / s.total * 100) : 0;
      const row = document.createElement("div");
      row.className = "hbar";
      row.innerHTML = '<span class="hbar-name">' + d.label + '</span>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="hbar-num">' + n + '<i>' + pct + '%</i></span>';
      box.appendChild(row);
    });
  }

// 状态统计：按类目统计各状态数量（招品 / BESTSELLER 共用，口径与状态筛选一致）
  function computeTaskStatusStats(tasks, cat, zone) {
    const src = cat ? tasks.filter(t => (t.category || "") === cat) : tasks;
    const subsFor = zone === "bestseller" ? bestsellerSubsFor : recruitSubsFor;
    const st = { total: src.length, published: 0, submitted: 0, bound: 0, no_refill: 0 };
    src.forEach(t => {
      if (t.bound) st.bound++;
      else if (t.status === "published" && subsFor(t.id).length > 0) st.submitted++;
      else if (t.status === "published") st.published++;
      if (t.flag_no_refill) st.no_refill++;
    });
    return st;
  }

// 渲染状态统计条（横向），显示 全部/已发布/商家已上传/已回品/无需回品 数量
  function renderTaskStatusStats(tasks, cat, boxId, zone) {
    const box = document.querySelector(boxId);
    if (!box) return;
    const s = computeTaskStatusStats(tasks, cat, zone);
    const items = [
      { label: "全部", n: s.total, cls: "st-all" },
      { label: "已发布", n: s.published, cls: "st-pub" },
      { label: "商家已上传", n: s.submitted, cls: "st-sub" },
      { label: "已回品", n: s.bound, cls: "st-bound" },
      { label: "无需回品", n: s.no_refill, cls: "st-norefill" },
    ];
    box.innerHTML = "";
    items.forEach(it => {
      const row = document.createElement("div");
      row.className = "st-item " + it.cls;
      row.innerHTML = '<span class="st-item-label">' + it.label + '</span><span class="st-item-num">' + it.n + '</span>';
      box.appendChild(row);
    });
  }

function renderRecruitFlagStats() {
    renderTaskFlagStats(recruitTasks, recruitFlagCat, "#recruit-flag-charts", "#recruit-flag-total");
    renderTaskStatusStats(recruitTasks, recruitFlagCat, "#recruit-status-stats", "recruit");
  }

// 填充招品/BESTSELLER 标记统计的类目下拉（取当前任务去重类目）
  function renderZoneCatSide(zone) {
    const sideId = zone === "bestseller" ? "#bestseller-zone-side" : "#recruit-zone-side";
    const side = document.querySelector(sideId);
    if (!side) return;
    const cats = (zone === "bestseller" ? bestsellerSideCats : recruitSideCats).slice().sort((a, b) => (a < b ? -1 : 1));
    const cur = zone === "bestseller" ? bestsellerSideCat : recruitSideCat;
    let html = '<div class="zs-title">前台类目 · 点击筛选 / 分享</div>';
    html += '<div class="zs-item' + (cur === "" ? " on" : "") + '" data-cat="">全部类目</div>';
    cats.forEach(c => {
      html += '<div class="zs-item' + (cur === c ? " on" : "") + '" data-cat="' + c.replace(/"/g, "&quot;") + '"><span class="zs-name">' + c + '</span><button type="button" class="zs-link-btn" title="复制「' + c + '」前台分享链接">🔗</button></div>';
    });
    side.innerHTML = html;
    side.querySelectorAll(".zs-item").forEach(item => {
      const cat = item.getAttribute("data-cat") || "";
      item.addEventListener("click", (ev) => {
        if (ev.target && ev.target.classList && ev.target.classList.contains("zs-link-btn")) return;
        if (zone === "bestseller") { bestsellerSideCat = cat; renderZoneCatSide("bestseller"); renderBestsellerList(); }
        else { recruitSideCat = cat; renderZoneCatSide("recruit"); renderRecruitList(); }
      });
      const linkBtn = item.querySelector(".zs-link-btn");
      if (linkBtn) linkBtn.addEventListener("click", (ev) => { ev.stopPropagation(); copyZoneCatLink(zone, cat); });
    });
  }

async function loadZoneCatSide(zone) {
    try {
      const cats = await SB.listZoneCats(zone);
      const arr = cats.map(c => c.name).filter(Boolean);
      if (zone === "bestseller") bestsellerSideCats = arr; else recruitSideCats = arr;
    } catch (e) {}
    renderZoneCatSide(zone);
  }

function fillTaskFlagCatSelect(tasks, selId) {
    const sel = document.querySelector(selId);
    if (!sel) return;
    const cats = [];
    tasks.forEach(t => { if (t.category && cats.indexOf(t.category) < 0) cats.push(t.category); });
    cats.sort((a, b) => (a < b ? -1 : 1));
    sel.innerHTML = "";
    const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "全部类目"; sel.appendChild(o0);
    cats.forEach(c => { const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); });
  }

function exportRecruitExcel() {
    if (!recruitTasks.length) return sbToast("暂无招品任务可导出", false);
    if (typeof XLSX === "undefined") return sbToast("导出组件未加载，请联网后重试", false);
    const rows = [];
    const pubRank = recruitTasks.slice().filter(x => x.status === "published").sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    // 按当前标记筛选/类目统计口径；默认导出全部任务
    const exportList = recruitFlagFilter
      ? recruitTasks.filter(t => taskHasFlag(t, recruitFlagFilter))
      : recruitTasks;
    exportList.forEach((t) => {
      const seq = t.status === "published" ? (pubRank.indexOf(t) + 1) : "";
      const subs = recruitSubsFor(t.id);
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
    XLSX.utils.book_append_sheet(wb, ws, "招品SPU汇总");
    XLSX.writeFile(wb, "招品回品SPU汇总.xlsx");
    sbToast("已导出 " + rows.length + " 行");
  }

async function loadExportPanel() {
    if (currentRole !== "admin" && currentRole !== "super_admin") return;
    const meta = $("#export-meta");
    meta.textContent = "加载中…";
    let imgs = [], defs = [];
    try {
      [imgs, defs] = await Promise.all([SB.listImages(null), SB.listTagDefs()]);
    } catch (e) { meta.textContent = "加载失败，请重试"; return; }
    exportImgs = imgs;
    exportDefs = defs;
    exportTok = await SB.currentToken().catch(() => "");
    buildExportCatFilter();
    buildExportDims();
    renderExportGrid();
  }

function buildExportCatFilter() {
    const sel = document.getElementById("export-cat");
    if (!sel) return;
    const cats = [...new Set((exportImgs || []).map(i => i.category))].filter(Boolean).sort((a, b) => a.localeCompare(b, "zh"));
    sel.innerHTML = '<option value="">全部类目</option>' + cats.map(c => `<option value="${escAttr(c)}">${escHtml(c)}</option>`).join("");
    if (exportCat && cats.includes(exportCat)) sel.value = exportCat; else sel.value = "";
  }

function buildExportDims() {
    const wrap = document.getElementById("export-dims");
    if (!wrap) return;
    wrap.innerHTML = "";
    exportDimsCfg().forEach(cf => {
      const lab = document.createElement("label");
      lab.className = "export-dim" + (cf.key === "channel" ? " export-dim-channel" : "");
      lab.appendChild(document.createTextNode(cf.lab));
      const sel = document.createElement("select");
      sel.className = "export-dim-sel";
      sel.id = "exp-dim-" + cf.key;
      sel.innerHTML = '<option value="">全部' + cf.lab + '</option>' + cf.names.map(n => `<option value="${escAttr(n)}">${escHtml(n)}</option>`).join("");
      sel.value = exportState[cf.key] || "";
      lab.appendChild(sel);
      wrap.appendChild(lab);
    });
  }

function exportMatch(img) {
    if (exportCat && img.category !== exportCat) return false;
    return exportDimsCfg().every(cf => {
      const v = exportState[cf.key];
      if (!v) return true;
      return Array.isArray(img[cf.field]) && img[cf.field].includes(v);
    });
  }

function renderExportGrid() {
    const selCat = document.getElementById("export-cat");
    exportCat = selCat ? selCat.value : "";
    exportDimsCfg().forEach(cf => {
      const f = document.getElementById("exp-dim-" + cf.key);
      exportState[cf.key] = f ? f.value : "";
    });
    const matches = (exportImgs || []).filter(exportMatch);
    const meta = $("#export-meta");
    const catLab = exportCat || "全部类目";
    meta.textContent = "类目「" + catLab + "」符合条件 " + matches.length + " 张图片 · 导出将含全部 " + matches.length + " 张（含图片链接、分类与六维度标签、外链）";
    const grid = document.getElementById("export-grid");
    if (!grid) return;
    const base = (window.CONFIG.WORKER_URL || "").replace(/\/+$/, "");
    const preview = matches.slice(0, 48);
    grid.innerHTML = preview.map(i => {
      const url = base + "/" + (i.path || "") + (exportTok ? "?token=" + encodeURIComponent(exportTok) : "");
      const labels = ["tags", "style_tags", "element_tags", "scene_tags", "shoot_tags", "skin_tags"]
        .map(f => Array.isArray(i[f]) ? i[f].join(" / ") : "").filter(Boolean).join("　");
      return `<div class="export-item"><img loading="lazy" src="${escAttr(url)}" alt="" onerror="this.closest('.export-item').classList.add('export-item-broken')"><div class="export-item-t"><span class="export-item-n">${escHtml(i.name || "")}</span><span class="export-item-cat">${escHtml(i.category || "未分类")}</span></div><div class="export-item-l">${escHtml(labels || "未打标")}</div></div>`;
    }).join("");
    if (matches.length > 48) grid.insertAdjacentHTML("beforeend", '<p class="hint">预览仅展示前 48 张，导出 Excel 含全部 ' + matches.length + ' 张（图片链接、分类、六维度标签、外链）。</p>');
    if (!preview.length) grid.innerHTML = '<p class="hint">没有符合筛选条件的图片。</p>';
  }

function doExportExcel() {
    if (currentRole !== "admin" && currentRole !== "super_admin") return sbToast("仅管理员可导出", false);
    if (!exportImgs.length) return sbToast("暂无数据可导出", false);
    const matches = (exportImgs || []).filter(exportMatch);
    if (!matches.length) return sbToast("当前筛选没有图片可导出", false);
    const base = (window.CONFIG.WORKER_URL || "").replace(/\/+$/, "");
    const rows = matches.map((i, idx) => {
      const url = base + "/" + (i.path || "");
      return {
        "序号": idx + 1,
        "图片链接": url,
        "文件名": i.name || "",
        "分类": i.category || "",
        "渠道": Array.isArray(i.tags) ? i.tags.join("、") : "",
        "风格": (i.style_tags || []).join("、"),
        "元素": (i.element_tags || []).join("、"),
        "场景": (i.scene_tags || []).join("、"),
        "拍摄方式": (i.shoot_tags || []).join("、"),
        "肤色": (i.skin_tags || []).join("、"),
        "外链": i.url || ""
      };
    });
    if (rows.length > 5000) return sbToast("导出图片数超过 5000，请先缩小筛选范围", false);
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 6 }, { wch: 42 }, { wch: 24 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 30 }];
    // 给"图片链接"列加超链接
    for (let r = 1; r < rows.length + 1; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r: r, c: 1 })];
      if (cell && cell.v) { cell.l = { Target: cell.v, Tooltip: cell.v }; }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "图片数据");
    const ts = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, "TREND-BANK-图片数据-" + ts + ".xlsx");
    sbToast("已导出 " + rows.length + " 行（含图片链接与分类标签）");
  }

function bindExport() {
    const excelBtn = document.getElementById("export-excel");
    const resetBtn = document.getElementById("export-reset");
    const catSel = document.getElementById("export-cat");
    if (excelBtn) excelBtn.addEventListener("click", doExportExcel);
    if (resetBtn) resetBtn.addEventListener("click", () => {
      exportCat = "";
      exportState = { channel: "", style: "", element: "", scene: "", shoot: "", skin: "" };
      const cs = document.getElementById("export-cat"); if (cs) cs.value = "";
      exportDimsCfg().forEach(cf => { const f = document.getElementById("exp-dim-" + cf.key); if (f) f.value = ""; });
      renderExportGrid();
    });
    if (catSel) catSel.addEventListener("change", renderExportGrid);
    const dimsWrap = document.getElementById("export-dims");
    if (dimsWrap) dimsWrap.addEventListener("change", (e) => { if (e.target.classList.contains("export-dim-sel")) renderExportGrid(); });
  }

function _catSim(r, c) {
      if (!r || !c) return 0;
      if (r === c) return 1000;
      let score = 0;
      // 原文以该类目结尾（最符合"末尾几个字"）
      if (r.endsWith(c)) score += 500 + c.length * 8;
      if (c.endsWith(r)) score += 400 + r.length * 8;
      // 公共后缀长度（末尾连续相同字数）
      let l = 0, i = r.length - 1, j = c.length - 1;
      while (i >= 0 && j >= 0 && r[i] === c[j]) { l++; i--; j--; }
      score += l * 30;
      // 该类目名作为整体出现在原文任意位置
      if (r.indexOf(c) >= 0) score += 80;
      // 强语义词：原文与类目都含，直接大幅加权
      for (const w of CAT_STRONG) {
        if (r.indexOf(w) >= 0 && c.indexOf(w) >= 0) score += 1000;
      }
      return score;
    }

async function fillZoneCatSelect(zone) {
    const selId = zone === "bestseller" ? "#bestseller-category" : "#recruit-category";
    const sel = document.querySelector(selId);
    if (!sel) return;
    let cats = [];
    try { cats = await SB.listZoneCats(zone); } catch (e) { cats = []; }
    // 权限过滤：普通管理员发布时只能选自己有权限的类目（超管不限）
    if (currentRole === "admin") {
      let mine = [];
      try { mine = await SB.myZonePermissions(zone); } catch (e) { mine = []; }
      // 归一化（去首尾空格）比对，避免因空格等细微差异导致授权类目匹配不上
      const norm = s => (s || "").trim();
      const mineSet = new Set(mine.map(norm));
      cats = cats.filter(c => mineSet.has(norm(c.name)));
    }
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    // BESTSELLER 类目必选：默认占位提示，不提供"不限类目"免选
    opt0.value = ""; opt0.textContent = zone === "bestseller" ? "（请选择上传类目）" : "（不限类目）";
    sel.appendChild(opt0);
    const CATS = window.CAT_SEARCH;
    let favs = [];
    try { favs = await SB.myFavCats(); } catch (e) { favs = []; }
    const ordered = CATS ? CATS.sortCats(cats.map(c => (c && c.name) || c), favs) : cats.map(c => ({ name: (c && c.name) || c, fav: false }));
    ordered.forEach(o => {
      const op = document.createElement("option");
      op.value = o.name; op.textContent = (o.fav ? "★ " : "") + o.name;
      sel.appendChild(op);
    });
    sel._allCats = cats;
    if (CATS) {
      CATS.mountBox(sel, "cat-search-zone-" + zone, "搜索类目…", (v) => { CATS.kw("zone-" + zone, v); CATS.filterSelect(sel, v); });
      CATS.filterSelect(sel, CATS.kw("zone-" + zone));
    }
    if (zone === "recruit") window.RECRUIT_CAT_POOL = cats.map(c => c.name).filter(Boolean);
  }

function refreshRecruitCatSelects() {
    // 类目池加载完成后，把已渲染的所有类目下拉（批量/行内/正式卡片）的选项重建，解决「预览先渲染、池后到」导致下拉为空的问题
    const pool = (window.RECRUIT_CAT_POOL || []).filter(Boolean);
    document.querySelectorAll(".rg-batch-sel").forEach(sel => {
      const cur = sel.value;
      sel.innerHTML = "";
      const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "（设为…）";
      sel.appendChild(o0);
      pool.forEach(c => { const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); });
      sel.value = (cur && pool.indexOf(cur) >= 0) ? cur : "";
    });
    document.querySelectorAll(".rg-row-cat-sel").forEach(sel => {
      const cur = sel.value;
      const opts = pool.slice();
      if (cur && pool.indexOf(cur) < 0) opts.unshift(cur);
      sel.innerHTML = "";
      const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "手动调整…";
      sel.appendChild(o0);
      opts.forEach(c => { const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); });
      sel.value = cur || "";
    });
    // 正式卡片的类目下拉：池就绪后再补选项，避免正式列表先渲染导致下拉为空
    document.querySelectorAll(".rcac-cat-sel").forEach(sel => {
      const cur = sel.value;
      const opts = pool.slice();
      if (cur && pool.indexOf(cur) < 0) opts.unshift(cur);
      sel.innerHTML = "";
      const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "（选一类目…）";
      sel.appendChild(o0);
      opts.forEach(c => { const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); });
      sel.value = cur || "";
    });
    // 下拉被重建后，把当前搜索关键词重新应用一遍，避免"重建后搜索失效"
    if (window.CAT_SEARCH) {
      const v = window.CAT_SEARCH.kw("recruit");
      document.querySelectorAll(".rg-batch-sel, .rg-row-cat-sel, .rcac-cat-sel")
        .forEach(s => window.CAT_SEARCH.filterSelect(s, v));
    }
  }

function loadRecruitCatPicker() {
    // 招品回品上传区为「自动匹配+每行手动调整」，无全局下拉，但需预载类目候选池供自动匹配/行内下拉使用
    const applyPool = (cats) => {
      let names = (cats || []).map(c => c.name).filter(Boolean);
      // 兜底：若获取类目为空，用 config.js 内置类目补足，确保下拉/自动匹配永远有候选
      if (!names.length && window.CONFIG && Array.isArray(window.CONFIG.CATEGORY_OPTIONS)) {
        names = window.CONFIG.CATEGORY_OPTIONS.filter(Boolean);
      }
      window.RECRUIT_CAT_POOL = names;
      refreshRecruitCatSelects(); // 池就绪后刷新已渲染的下拉，避免下拉为空
    };
    if (window.SB) {
      window.SB.listZoneCats("recruit").then(cats => { applyPool(cats); }).catch(() => { applyPool([]); });
    } else {
      applyPool([]);
    }
    fillZoneCatSelect("recruit"); // 兼容旧调用（若DOM存在则填充下拉）
  }

function openZoneCatModal(zone) {
    zoneCatModalZone = zone;
    $("#zone-cat-title").textContent = (zone === "bestseller" ? "BESTSELLER" : "招品回品") + " · 类目设置";
    $("#zone-cat-modal").classList.remove("hidden");
    document.body.classList.add("no-scroll");
    $("#zone-cat-new").value = "";
    $("#zone-cat-filter").value = "";
    loadZoneCatList();
  }

function closeZoneCatModal() {
    $("#zone-cat-modal").classList.add("hidden");
    document.body.classList.remove("no-scroll");
  }

async function loadZoneCatList() {
    const box = $("#zone-cat-list");
    if (!box) return;
    try { zoneCatModalCats = await SB.listZoneCats(zoneCatModalZone); } catch (e) { zoneCatModalCats = []; }
    const kw = ($("#zone-cat-filter").value || "").trim();
    box.innerHTML = "";
    // 宽松模糊：忽略大小写与符号、支持隔字（连衣 → 连衣裙）
    const list = zoneCatModalCats.filter(c => !kw || (window.CAT_SEARCH
      ? window.CAT_SEARCH.hit(c.name, kw)
      : c.name.toLowerCase().includes(kw.toLowerCase())));
    if (!list.length) { box.innerHTML = '<p class="hint">暂无类目。</p>'; return; }
    list.forEach(c => {
      const row = document.createElement("div");
      row.className = "zone-cat-row";
      row.innerHTML =
        '<span class="zone-cat-name">' + c.name + '</span>' +
        '<button type="button" class="btn-ghost small zc-rename">✎ 改名</button>' +
        '<button type="button" class="btn-danger small zc-del">删除</button>';
      row.querySelector(".zc-rename").onclick = () => {
        const nn = prompt("输入新的类目名：", c.name);
        if (!nn) return;
        SB.renameZoneCat(zoneCatModalZone, c.id, nn, c.name).then(() => { sbToast("已改名"); loadZoneCatList(); fillZoneCatSelect(zoneCatModalZone); })
          .catch(e => sbToast("改名失败：" + (e.message || ""), false));
      };
      row.querySelector(".zc-del").onclick = async () => {
        const _ok = await sbConfirm({ title: "删除类目「" + c.name + "」", desc: "该分类下所有任务将清空类目（图片保留）。", okText: "删除", danger: true });
        if (!_ok) return;
        SB.removeZoneCat(zoneCatModalZone, c.id, c.name).then(() => { sbToast("已删除"); loadZoneCatList(); fillZoneCatSelect(zoneCatModalZone); })
          .catch(e => sbToast("删除失败：" + (e.message || ""), false));
      };
      box.appendChild(row);
    });
  }

function loadRecruitCatSettings() {
    const btn = $("#recruit-cat-mgr");
    if (btn && !btn._bound) { btn._bound = true; btn.onclick = () => openZoneCatModal("recruit"); }
  }

function bindZoneCatModal() {
    const close = $("#zone-cat-close");
    if (close) close.onclick = closeZoneCatModal;
    const add = $("#zone-cat-add");
    if (add) add.onclick = () => {
      const n = $("#zone-cat-new").value.trim();
      if (!n) return sbToast("请输入类目名", false);
      SB.addZoneCat(zoneCatModalZone, n).then(() => { sbToast("已新增"); $("#zone-cat-new").value = ""; loadZoneCatList(); fillZoneCatSelect(zoneCatModalZone); })
        .catch(e => sbToast("新增失败：" + (e.message || ""), false));
    };
    const filter = $("#zone-cat-filter");
    if (filter) filter.oninput = loadZoneCatList;
  }

async function restoreTrashOne(t) {
    try {
      await SB.restoreBestsellerTask(t.id);
      sbToast("已恢复");
      const back = document.querySelector("#bestseller-trash-back");
      if (back) back.click();
    } catch (e) { sbToast("恢复失败", false); }
  }

async function purgeTrashOne(t) {
    if (!confirm("确认永久删除任务ID「" + t.task_id + "」？其图片与商家提交记录将彻底移除，不可恢复！")) return;
    try {
      if (t.image_path) await SB.deleteBestsellerImage(t.image_path).catch(() => {});
      await SB.purgeBestsellerTasks([t.id]);
      sbToast("已永久删除");
      openBestsellerTrash();
    } catch (e) { sbToast("永久删除失败", false); }
  }
window.RECRUIT_CAT_MATCH = (raw) => {
      if (!raw) return "";
      const r = String(raw).trim();
      if (!r) return "";
      const rl = r.toLowerCase();
      // 主力基准：以「类目管理」配置的类目池为准，末尾+相似度取最高
      const pool = (window.RECRUIT_CAT_POOL || []).filter(Boolean);
      if (pool.length) {
        let best = { score: -1, cat: "" };
        for (const c of pool) {
          const s = _catSim(rl, String(c).toLowerCase());
          if (s > best.score) { best = { score: s, cat: c }; }
        }
        // 阈值：得分太低视为未匹配（如袜子等池内无对应项）
        if (best.score >= 40) return best.cat;
      }
      // 池为空时的兜底词库（保证上传仍能归类；命中后仍会经 CONFIRM 对齐池名）
      const LIB = [
        ["羽绒服", ["羽绒服", "羽绒衣", "羽绒"]],
        ["棉服", ["棉服", "棉衣", "棉袄"]],
        ["防风衣", ["防风衣", "防风外套"]],
        ["夹克", ["夹克"]],
        ["大衣", ["大衣", "呢大衣"]],
        ["风衣", ["风衣"]],
        ["外套", ["外套"]],
        ["T恤", ["t恤", "T恤", "tee", "短袖t"]],
        ["衬衫", ["衬衫", "衬衣"]],
        ["Polo衫", ["polo衫", "polo", "polos"]],
        ["卫衣", ["卫衣"]],
        ["毛衣", ["毛衣", "毛衫", "针织衫"]],
        ["马甲", ["马甲"]],
        ["背心", ["背心"]],
        ["西装", ["西装", "西服"]],
        ["套装", ["套装"]],
        ["皮衣", ["皮衣", "皮夹克"]],
        ["连裤袜", ["连裤袜"]],
        ["牛仔裤", ["牛仔裤", "牛仔短裤", "牛仔长裤"]],
        ["短裤", ["短裤", "短衬裤"]],
        ["滑雪裤", ["滑雪裤"]],
        ["运动长裤", ["运动长裤", "宽松运动长裤", "运动裤"]],
        ["休闲裤", ["休闲裤", "休闲长裤", "休闲运动裤"]],
        ["运动服", ["运动服", "运动套装"]],
      ];
      let best = { len: -1, cat: "" };
      for (const [cat, kws] of LIB) {
        for (const k0 of kws) {
          const k = k0.toLowerCase();
          if (rl.endsWith(k) || (rl.indexOf(k) >= 0 && rl.length - rl.indexOf(k) - k.length <= 2)) {
            if (k.length > best.len) { best = { len: k.length, cat }; }
          }
        }
      }
      if (best.cat) return best.cat;
      const tail = r.slice(-3);
      if (/裤/.test(tail) && !/袜|衬裤|内裤/.test(r)) return "裤子";
      return "";
    };

// 候选池对齐：词库/相似度命中后，若类目管理池里有同类别类目名，返回池内名称（保证前台用池内标准名）
  window.RECRUIT_CAT_CONFIRM = (matched) => {
    if (!matched) return "";
    const pool = (window.RECRUIT_CAT_POOL || []).filter(Boolean);
    if (!pool.length) return matched;
    const LOW = String(matched).toLowerCase();
    for (const c of pool) if (String(c).toLowerCase() === LOW) return c;
    for (const c of pool) if (LOW.indexOf(String(c).toLowerCase()) >= 0) return c;
    for (const c of pool) if (String(c).toLowerCase().indexOf(LOW) >= 0) return c;
    return matched;
  };

  /* 暴露给其它模块 / 事件绑定 */
  Object.assign(window, {
    copyZoneCatLink, bindShareCatBtn, upShow, upHide, clearPane, recruitPickKeys, handleRecruitXlsx, buildRecruitXlsxPreview, openImgZoom, closeImgZoom, recruitPreCell, removeRecruitRow, recruitRowCatWrap, handleRecruitNoImgFiles, commitRecruitImport, resetRecruitImport, bindRecruitMatch, bindRecruit, loadRecruitList, recruitSubsFor, recruitDay, recruitStatusLabel, recruitStatusChip, renderRecruitList, renderRecruitSpsStatus, setRecruitStatus, setRecruitBound, bulkSetRecruitStatus, bulkSetRecruitBound, copyRecruitSps, confirmDeleteRecruit, bulkDeleteRecruit, openRecruitTrash, closeRecruitTrash, renderRecruitTrash, restoreTrashOne, purgeTrashOne, bulkRestoreRecruit, bulkPurgeRecruit, taskHasFlag, flagText, taskFlagBoxHTML, bindTaskFlagBoxes, recomputeTaskFlags, computeTaskFlagStats, renderTaskFlagStats, computeTaskStatusStats, renderTaskStatusStats, renderRecruitFlagStats, renderZoneCatSide, loadZoneCatSide, fillTaskFlagCatSelect, exportRecruitExcel, loadExportPanel, buildExportCatFilter, buildExportDims, exportMatch, renderExportGrid, doExportExcel, bindExport, _catSim, fillZoneCatSelect, refreshRecruitCatSelects, loadRecruitCatPicker, openZoneCatModal, closeZoneCatModal, loadZoneCatList, loadRecruitCatSettings, bindZoneCatModal
  });

})();
