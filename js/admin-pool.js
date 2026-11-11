/* ============================================================
 * TREND BANK · 后台管理（pool）
 * 说明：本文件由原单文件 admin.js 按面板拆分而来。
 *  - 共享状态在文件顶部声明（全局作用域，跨文件可见）
 *  - 函数定义在文件内 IIFE 中，末尾通过 Object.assign(window, {...}) 暴露给其它模块
 * ============================================================ */

/* ---------- 共享状态 ---------- */
// ================= 存量图片压缩池（超管 · 左=已压缩 ≤200KB，右=待压缩 >200KB） =================
const IMG_POOL_TARGET = 200 * 1024;

// 阈值：200KB
let imgPoolItems = [];

// [{key,size,targetKB}]
let imgPoolSelected = new Set();

let imgPoolBusy = false;

const IMG_POOL_TARGETS = [{v:200,label:"200K"},{v:100,label:"100K"},{v:40,label:"40K"}];

const KB = n => n * 1024;

const poolTargetOf = it => (it && it.targetKB > 0) ? it.targetKB : 200;

const urlOfPath = (p, tok) => (window.CONFIG.WORKER_URL || "").replace(/\/$/, "") + "/" + p + (tok ? "?token=" + encodeURIComponent(tok) : "");
(function () {

async function imgPoolImgUrl(p) {
    let tok = "";
    try { tok = await SB.currentToken(); } catch (e) { tok = ""; }
    return urlOfPath(p, tok);
  }

function imgPoolStat() {
    const done = imgPoolItems.filter(i => i.size <= IMG_POOL_TARGET).length;
    const todo = imgPoolItems.length - done;
    const totalBytes = imgPoolItems.reduce((s, i) => s + (i.size || 0), 0);
    $("#imgpool-stat").textContent = "共 " + imgPoolItems.length + " 张 · 已压缩 " + done + " · 待压缩 " + todo + " · 合计 " + fmtSize(totalBytes);
    $("#imgpool-cnt-done").textContent = done;
    $("#imgpool-cnt-todo").textContent = todo;
    $("#imgpool-compress").textContent = "压缩选中(" + imgPoolSelected.size + ")";
    $("#imgpool-compress").disabled = imgPoolBusy || imgPoolSelected.size === 0;
    $("#imgpool-compress-all").disabled = imgPoolBusy || todo === 0;
  }

function poolFormatOf(key) {
    // 从扩展名判断格式，默认按 key 后缀
    const m = String(key).match(/\.([a-zA-Z0-9]+)$/);
    const ext = m ? m[1].toUpperCase() : "IMG";
    return ext === "WEBP" ? "WEBP" : ext;
  }

async function imgPoolRender() {
    const tok = await SB.currentToken().catch(() => "");
    const doneGrid = $("#imgpool-grid-done");
    const todoGrid = $("#imgpool-grid-todo");
    doneGrid.innerHTML = ""; todoGrid.innerHTML = "";
    imgPoolItems.forEach((it) => {
      const curTarget = poolTargetOf(it);
      const isDone = it.size <= KB(curTarget) || it.size <= KB(200);
      const url = urlOfPath(it.key, tok);
      const fmt = poolFormatOf(it.key);
      // 复用智能打标的 smart-card 结构与拖拽（右池拖到左池=压缩）
      const card = document.createElement("div");
      card.className = "smart-card";
      card.draggable = true;
      card.dataset.key = it.key;
      const wrap = document.createElement("div");
      wrap.className = "holder";
      const im = document.createElement("img");
      im.src = url;
      im.alt = it.key || "";
      im.loading = "eager";
      im.draggable = false;
      im.addEventListener("contextmenu", (e) => e.preventDefault());
      im.classList.add("loaded");
      im.onerror = () => { im.classList.remove("loaded"); };
      wrap.appendChild(im);
      card.appendChild(wrap);
      // 左上角：大小 + 格式 标签
      const tags = document.createElement("div");
      tags.className = "smart-card-tags";
      tags.innerHTML =
        '<div class="smart-tag-row size"><b>大小</b><span>' + fmtSize(it.size) + '</span></div>' +
        '<div class="smart-tag-row fmt"><b>格式</b><span>' + escHtml(fmt) + '</span></div>' +
        (isDone ? '<div class="smart-tag-row none"><b>态</b><span>已压缩</span></div>' : '<div class="smart-tag-row ch"><b>态</b><span>待压缩</span></div>');
      card.appendChild(tags);
      // 未压缩卡片：右下角档位下拉（200K/100K/40K）+ 预览按钮
      const acts = document.createElement("div");
      acts.className = "smart-card-actions";
      acts.innerHTML =
        '<select class="imgpool-target" data-key="' + escAttr(it.key) + '" title="压缩目标">' +
        IMG_POOL_TARGETS.map(o => '<option value="' + o.v + '"' + (curTarget === o.v ? " selected" : "") + '>' + o.label + '</option>').join("") +
        "</select>" +
        '<button class="imgpool-prev" data-key="' + escAttr(it.key) + '" data-url="' + escAttr(url) + '" type="button">预览</button>';
      card.appendChild(acts);
      // 勾选：未压缩卡片复选框，用于"压缩选中"批量压缩
      const pick = document.createElement("div");
      pick.className = "imgpool-pick";
      const ck = document.createElement("input");
      ck.type = "checkbox";
      ck.className = "imgpool-chk";
      ck.checked = imgPoolSelected.has(it.key);
      ck.addEventListener("click", (e) => e.stopPropagation());
      ck.addEventListener("change", (e) => {
        e.stopPropagation();
        if (ck.checked) imgPoolSelected.add(it.key);
        else imgPoolSelected.delete(it.key);
        card.classList.toggle("sel", ck.checked);
        imgPoolStat();
      });
      pick.appendChild(ck);
      card.appendChild(pick);
      // click 预览
      card.addEventListener("click", (e) => {
        if (e.target.closest(".imgpool-target") || e.target.closest(".imgpool-prev")) return;
        openImgZoom(url, it.key + " · " + fmtSize(it.size));
      });
      (isDone ? doneGrid : todoGrid).appendChild(card);
    });
    // 拖拽：右池卡片拖到左池 = 压缩该张；左池卡片拖回右池 = 转WebP
    bindImgPoolDrag();
    imgPoolRenderCheck();
    imgPoolStat();
  }

function imgPoolRenderCheck() {
    document.querySelectorAll(".imgpool-prev").forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); openImgZoom(btn.getAttribute("data-url"), btn.getAttribute("data-key") + " · 预览"); };
    });
    document.querySelectorAll("#imgpool-grid-todo .imgpool-target").forEach(sel => {
      sel.onchange = (e) => {
        e.stopPropagation();
        const it = imgPoolItems.find(x => x.key === e.target.getAttribute("data-key"));
        if (it) it.targetKB = parseInt(e.target.value, 10) || 200;
      };
    });
  }

// 拖拽：右池待压缩卡片 → 左池（drop）＝压缩该张
  function bindImgPoolDrag() {
    const doneGrid = $("#imgpool-grid-done");
    document.querySelectorAll("#imgpool-grid-todo .smart-card").forEach(card => {
      card.draggable = true;
      card.addEventListener("dragstart", (e) => {
        card.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", card.dataset.key || ""); } catch (err) {}
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
    });
    // 左池（已压缩）作为拖拽目标：把未压缩卡拖进来＝压缩该张
    doneGrid.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; doneGrid.classList.add("drop-over"); });
    doneGrid.addEventListener("dragleave", () => doneGrid.classList.remove("drop-over"));
    doneGrid.addEventListener("drop", (e) => {
      e.preventDefault();
      doneGrid.classList.remove("drop-over");
      const key = (e.dataTransfer.getData("text/plain") || (e.dataTransfer.files && e.dataTransfer.files.length ? "" : ""));
      if (!key) return;
      const it = imgPoolItems.find(x => x.key === key);
      if (!it) return;
      imgPoolCompressOne(it);
    });
  }

async function imgPoolLoad() {
    if (imgPoolBusy) return;
    imgPoolBusy = true;
    $("#imgpool-refresh").disabled = true;
    $("#imgpool-progress").classList.remove("hidden");
    const bar = $("#imgpool-progress-bar"), txt = $("#imgpool-progress-text");
    bar.style.width = "0%";
    txt.textContent = "正在读取存储清单…";
    try {
      imgPoolItems = await SB.listStorageImgs();
      imgPoolSelected.clear();
      await imgPoolRender();
      txt.textContent = "清单已加载：共 " + imgPoolItems.length + " 张";
      sbToast("清单已加载：" + imgPoolItems.length + " 张图片", true);
    } catch (e) {
      txt.textContent = "读取失败：" + (e.message || "");
      sbToast("读取失败：" + (e.message || ""), false);
    } finally {
      imgPoolBusy = false;
      $("#imgpool-refresh").disabled = false;
    }
  }

// 压缩一张：拉原图 → 压成 ≤200KB WebP → 覆盖写回 → 刷新该卡大小
  async function imgPoolCompressOne(it) {
    let tok = "";
    try { tok = await SB.currentToken(); } catch (e) { tok = ""; }
    const url = urlOfPath(it.key, tok);
    const r = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
    if (!r.ok) throw new Error("拉图失败 " + r.status);
    const blob = await r.blob();
    // 从网络 blob 转 File 以便压缩引擎校验 type
    const ext = (it.key.match(/\.([a-z0-9]+)$/i) || [])[1] || "jpg";
    const file = new File([blob], "img." + ext, { type: (blob.type && /^image\//i.test(blob.type)) ? blob.type : "image/jpeg" });
    const targetKB = poolTargetOf(it);
    const targetBytes = KB(targetKB);
    let compressed = await SB.compress(file, targetKB);
    // 压缩引擎兜底会保留原图；若未能达标，强制以较低质量重编码一遍
    if (!compressed || compressed.size >= it.size || compressed.size > targetBytes) {
      const force = await SB.compress(new File([blob], "img.webp", { type: "image/webp" }), targetKB);
      if (force && force.size < it.size) compressed = force;
    }
    if (!compressed || (compressed.size >= it.size && it.size <= targetBytes)) return; // 已达标或确实无法缩小，不覆盖
    await SB.overwriteStoredImg(it.key, compressed);
    it.size = compressed.size;
    it.targetKB = targetKB;
  }

async function imgPoolConvertOne(key) {
    const it = imgPoolItems.find(x => x.key === key);
    if (!it || imgPoolBusy) return;
    imgPoolBusy = true;
    $("#imgpool-progress").classList.remove("hidden");
    const txt = $("#imgpool-progress-text");
    txt.textContent = "正在转换：" + key;
    try {
      await imgPoolCompressOne(it);
      imgPoolSelected.delete(key);
      await imgPoolRender();
      txt.textContent = "已转换：" + key + " → " + fmtSize(it.size);
      sbToast("已转换：" + key, true);
    } catch (e) {
      txt.textContent = "转换失败：" + key + "（" + (e.message || "") + "）";
      sbToast("转换失败：" + key, false);
    } finally {
      imgPoolBusy = false;
    }
  }

async function imgPoolCompressBatch(keys) {
    if (imgPoolBusy) return;
    if (!keys.length) { sbToast("请先勾选要压缩的图片", false); return; }
    imgPoolBusy = true;
    $("#imgpool-progress").classList.remove("hidden");
    const bar = $("#imgpool-progress-bar"), txt = $("#imgpool-progress-text");
    let ok = 0, fail = 0;
    bar.style.width = "0%";
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const it = imgPoolItems.find(x => x.key === key);
      if (!it) continue;
      txt.textContent = "压缩中…（" + (i + 1) + "/" + keys.length + "）" + key;
      bar.style.width = Math.round(((i) / keys.length) * 100) + "%";
      try {
        await imgPoolCompressOne(it);
        imgPoolSelected.delete(key);
        ok++;
        await imgPoolRender();           // 每次成功后重绘（自动跳左池）
      } catch (e) { fail++; }
    }
    bar.style.width = "100%";
    txt.textContent = "完成：成功 " + ok + " 张，失败 " + fail + " 张";
    await imgPoolStat();
    imgPoolBusy = false;
    imgPoolRenderCheck();
    sbToast("批量压缩完成：成功 " + ok + "，失败 " + fail, fail === 0);
  }

function bindImagePool() {
    const refresh = $("#imgpool-refresh");
    if (!refresh) return;
    refresh.addEventListener("click", imgPoolLoad);
    const selall = $("#imgpool-selall");
    const selnone = $("#imgpool-selnone");
    const compress = $("#imgpool-compress");
    const compressAll = $("#imgpool-compress-all");
    if (selall) selall.addEventListener("click", () => {
      imgPoolItems.forEach(i => { if (i.size > KB(200)) imgPoolSelected.add(i.key); });
      imgPoolStat();
      sbToast("已选中 " + imgPoolSelected.size + " 张待压缩图", true);
    });
    if (selnone) selnone.addEventListener("click", () => {
      imgPoolSelected.clear();
      imgPoolStat();
    });
    if (compress) compress.addEventListener("click", () => imgPoolCompressBatch([...imgPoolSelected]));
    const gtar = $("#imgpool-global-target");
    if (gtar) gtar.addEventListener("change", () => {
      const v = parseInt(gtar.value, 10) || 200;
      imgPoolItems.forEach(i => { if (i.size > KB(200)) i.targetKB = v; });
      imgPoolRender();
      sbToast("已将所有待压缩图目标设为 " + v + "K", true);
    });
    if (compressAll) compressAll.addEventListener("click", () => {
      const todo = imgPoolItems.filter(i => i.size > IMG_POOL_TARGET).map(i => i.key);
      if (!todo.length) { sbToast("当前没有待压缩的图片", false); return; }
      if (!confirm("确认压缩全部 " + todo.length + " 张待压缩图片？此操作会覆盖原图（URL不变），请确保已备份。")) return;
      imgPoolCompressBatch(todo);
    });
    // 首次进入面板时自动加载清单
    imgPoolLoad();
  }

  /* 暴露给其它模块 / 事件绑定 */
  Object.assign(window, {
    imgPoolImgUrl, imgPoolStat, poolFormatOf, imgPoolRender, imgPoolRenderCheck, bindImgPoolDrag, imgPoolLoad, imgPoolCompressOne, imgPoolConvertOne, imgPoolCompressBatch, bindImagePool
  });

})();
