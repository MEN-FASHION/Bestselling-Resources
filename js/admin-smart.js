/* ============================================================
 * TREND BANK · 后台管理（smart）
 * 说明：本文件由原单文件 admin.js 按面板拆分而来。
 *  - 共享状态在文件顶部声明（全局作用域，跨文件可见）
 *  - 函数定义在文件内 IIFE 中，末尾通过 Object.assign(window, {...}) 暴露给其它模块
 * ============================================================ */

/* ---------- 共享状态 ---------- */
// ================= 标签维度「前台展示」开关 =================
let dimSwitches = {};

const DIM_META = [
  { key: "channel", label: "渠道" },
  { key: "style", label: "风格" },
  { key: "element", label: "元素" },
  { key: "scene", label: "场景" },
  { key: "shoot", label: "拍摄方式" },
  { key: "skin", label: "肤色" }
];

// ================= 智能打标（拖拽池：左=已打，右=未打） =================
let smartDim = "style";

// 当前维度: style / element / channel
let smartTag = "";

// 当前选中标签
let smartAll = [];

// 全量图片缓存
let smartDragging = null;

// 正在拖拽的图片对象
let smartToken = "";

// 智能打标取图鉴权令牌
const smartFieldMap = { style: "style_tags", element: "element_tags", channel: "tags", scene: "scene_tags", shoot: "shoot_tags", skin: "skin_tags", category: "category" };

// 单值维度（类目 category 是字符串，其余是数组）
const smartSingleDim = { category: true };

// 区别于 category（字符串字段）：这些仍是数组字段，仅"选中某标签时排除已打其它标签的图 + 写入替换"。
const smartUniqueFields = new Set(["style_tags", "tags", "scene_tags", "shoot_tags", "skin_tags"]);

const smartAlbumPreview = {};

let smartTagsCache = [];

// 当前维度标签清单缓存（供图册栏复用）
let smartTokenCache = "";

// 最近一次取到的取图令牌（供局部移动卡片复用）
const smartSceneGroup = {};

// ================= 智能打标内上传图片（上传入口=右池首位卡片，待传=缩略图卡，按钮/进度常驻右池头部） =================
let smartPending = [];

// 待上传文件（含预览）
let smartUploading = false;
(function () {

function openSmartModal() {
    if (!document.querySelector("#smart-modal")) return;
    document.querySelector("#smart-modal").classList.remove("hidden");
    smartDim = "style"; smartTag = "";
    renderSmartDims();
    fillSmartCat();
    Promise.resolve().then(loadSmartAll);
  }

function closeSmartModal(opts) {
    const m = document.querySelector("#smart-modal");
    if (!m) return;
    // 退出全屏，避免下次进入残留全屏状态
    if (m.classList.contains("fullscreen") && typeof toggleSmartFullscreen === "function") toggleSmartFullscreen();
    m.classList.add("hidden");
    // 需求：关闭智能打标后自动显示「全部已上传图片」列表（首次才真正请求，之后复用已加载内容）
    if (opts && opts.skipManageLoad) return;
    if (typeof switchPanel === "function") switchPanel("manage-card");
    if (typeof ensureManageLoaded === "function") ensureManageLoaded();
  }

// 从标签管理面板一键回到智能打标：切回图片管理并打开弹窗，保留上次的维度与选中标签，重载池子数据
  function backToSmartTag() {
    switchPanel("manage-card");
    const m = document.querySelector("#smart-modal");
    if (!m) return;
    m.classList.remove("hidden");
    renderSmartDims();
    fillSmartCat();
    Promise.resolve().then(loadSmartAll);
    const box = document.getElementById("smart-grid-done");
    if (box) box.scrollTop = 0;
    const boxU = document.getElementById("smart-grid-undone");
    if (boxU) boxU.scrollTop = 0;
  }

function renderSmartDims() {
    const box = document.querySelector("#smart-dims");
    if (!box) return;
    const dims = [
      { key: "category", label: "类目" },
      { key: "style", label: "风格" },
      { key: "element", label: "元素" },
      { key: "channel", label: "渠道" },
      { key: "scene", label: "场景" },
      { key: "shoot", label: "拍摄方式" },
      { key: "skin", label: "肤色" }
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
        await renderSmartPools();
        await loadSmartAll();
      };
      box.appendChild(b);
    });
  }

// 类目维度候选：与「类目管理」口径完全一致 = 内置候选(CONFIG.CATEGORY_OPTIONS) + categories 表 + 图片中实际出现的类目
  // （原实现只取 categories 表，导致候选不完整、图片里已有的类目在本维度选不到）
  async function smartCategoryCandidates() {
    let active = [], used = [];
    try { active = await SB.listActiveCats(); } catch (e) { active = []; }
    try { used = await SB.listUsedCats(); } catch (e) { used = []; }
    const builtin = (window.CONFIG && window.CONFIG.CATEGORY_OPTIONS) || [];
    const set = new Set([].concat(builtin, active, used).map(s => String(s == null ? "" : s).trim()).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "zh"));
  }

async function loadSmartAll() {
    try { smartToken = await SB.currentToken(); } catch (e) { smartToken = ""; }
    try { smartAll = await SB.listImages(null); }
    catch (e) { sbToast("读取图片失败", false); return; }
    // 渲染该维度的标签选择条（类目用 categories 表；渠道用固定清单；其余用 tag_defs）
    if (smartDim === "category") {
      try {
        renderSmartTags(await smartCategoryCandidates());
      } catch (e) { renderSmartTags([]); }
      await renderSmartPools();
      return;
    }
    if (smartDim === "channel") {
      const list = (window.CONFIG.CHANNEL_TAGS || []).flatMap(g => g.tags || []);
      renderSmartTags([...new Set(list)]);
      await renderSmartPools(); // 未选具体标签时，按"是否已打该维度标"自动分池
      return;
    }
    try {
      const defs = await SB.listTagDefs();
      // 记录场景标签的室内/室外分组（供图册栏分组显示）
      if (smartDim === "scene") {
        Object.keys(smartSceneGroup).forEach(k => delete smartSceneGroup[k]);
        (defs || []).forEach(d => { if (d.type === "scene") smartSceneGroup[d.name] = d.group || (d.name.indexOf("室外") >= 0 ? "outdoor" : "indoor"); });
      } else {
        Object.keys(smartSceneGroup).forEach(k => delete smartSceneGroup[k]);
      }
      const list = (defs || []).filter(d => d.type === smartDim).map(d => d.name);
      renderSmartTags([...new Set(list)]);
      await renderSmartPools(); // 未选具体标签时，按"是否已打该维度标"自动分池
    } catch (e) { renderSmartTags([]); sbToast("读取标签失败", false); }
  }

// 场景标签 -> 分组（indoor/outdoor），供图册栏按室内/室外分组
  function renderSmartTags(list) {
    smartTagsCache = Array.isArray(list) ? list.slice() : [];
    const box = document.querySelector("#smart-tags");
    if (!box) return;
    // 类目维度：标签很多，加搜索框（宽松模糊），并把常用类目排到最前带 ★
    const CATS = window.CAT_SEARCH;
    const isCat = smartDim === "category";
    const kwv = (isCat && CATS) ? CATS.kw("smart-cattags") : "";
    let ordered = list.slice();
    if (isCat && CATS) {
      CATS.mountBox(box, "cat-search-smarttags", "搜索类目…", (v) => {
        CATS.kw("smart-cattags", v);
        renderSmartTags(smartTagsCache);
      });
      const sbx = document.getElementById("cat-search-smarttags");
      if (sbx && sbx.value !== kwv) sbx.value = kwv;
      ordered = CATS.sortCats(CATS.filter(list, kwv), currentFavCats);
    }
    box.innerHTML = "";
    // 顶部标签栏「＋新增」：非渠道维度可直接新增标签并同步到标签管理
    if (smartDim && smartDim !== "channel") {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "smart-tag smart-tag-add";
      addBtn.title = "新增" + ({ category: "类目", style: "风格", element: "元素", scene: "场景", shoot: "拍摄方式", skin: "肤色" }[smartDim] || "") + "标签（自动同步到标签管理）";
      addBtn.textContent = "＋ 新增";
      addBtn.addEventListener("click", (e) => { e.stopPropagation(); smartAddAlbum(); });
      box.appendChild(addBtn);
    }
    if (isCat && !list.length) {
      const t0 = document.createElement("span");
      t0.className = "smart-tag-empty";
      t0.textContent = "暂无类目标签，请到「类目管理」或「标签管理」新增";
      box.appendChild(t0);
      return;
    }
    if (!list.length) {
      const t = document.createElement("span");
      t.className = "smart-tag-empty";
      t.textContent = smartDim === "channel"
        ? "暂无渠道标签（请在 config.js 维护 CHANNEL_TAGS）"
        : "暂无" + ({ category: "类目", style: "风格", element: "元素", scene: "场景", shoot: "拍摄方式", skin: "肤色" }[smartDim] || "") + "标签，请到「标签管理」新增";
      box.appendChild(t);
      return;
    }
    (isCat ? ordered : list.map(n => ({ name: n, fav: false }))).forEach(o => {
      const tag = o.name;
      const b = document.createElement("button");
      b.className = "smart-tag" + (tag === smartTag ? " active" : "");
      b.type = "button";
      if (o.fav) {
        const st = document.createElement("span");
        st.className = "cat-fav"; st.title = "我的常用类目"; st.textContent = "★";
        b.appendChild(st);
      }
      const nameSpan = document.createElement("span");
      nameSpan.className = "smart-tag-name";
      nameSpan.textContent = tag;
      b.appendChild(nameSpan);
      // 编辑标签名（渠道标签来自 config.js，不支持改名；其余维度可改名并同步图片）
      if (smartDim !== "channel") {
        const ed = document.createElement("span");
        ed.className = "smart-tag-edit";
        ed.textContent = "✎";
        ed.title = "编辑/改名（同步更新图片与标签管理）";
        ed.addEventListener("click", (e) => { e.stopPropagation(); smartRenameTag(tag); });
        b.appendChild(ed);
      }
      b.onclick = async () => {
        smartTag = tag;
        renderSmartTags(list);
        await renderSmartPools();
      };
      box.appendChild(b);
    });
    // 末尾显示候选总数（类目维度可据此确认候选是否完整）
    const cnt = document.createElement("span");
    cnt.className = "smart-tag-empty";
    cnt.textContent = (isCat && kwv)
      ? ("命中 " + CATS.filter(list, kwv).length + " / 共 " + list.length + " 项")
      : ("共 " + list.length + " 项");
    cnt.title = "当前维度的候选标签总数";
    box.appendChild(cnt);
  }

// 判断某图在某维度是否含指定标签（tag 为空串则只判断"该维度是否已打标"；单值维度=category 用字符串判断）
  function smartHas(img, field, tag) {
    const single = smartSingleDim[field];
    if (single) {
      const v = img[field];
      return tag ? (v === tag) : !!v;
    }
    const arr = Array.isArray(img[field]) ? img[field] : [];
    return tag ? arr.includes(tag) : arr.length > 0;
  }

// 逻辑单值维度：判断该图在此维度是否已打任意标签（数组非空）
  function smartHasAny(img, field) {
    const v = img[field];
    if (Array.isArray(v)) return v.length > 0;
    return !!(v && String(v).trim());
  }

// 智能打标取图地址（带令牌）
  function smartImgUrl(img, tok) {
    const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
    return base + "/" + img.path + (tok ? "?token=" + encodeURIComponent(tok) : "");
  }

// 按容器宽度计算列数（行内卡片 + 行末按钮均分）
  function smartCols(gridEl, cardW, gap) {
    if (!gridEl) return 4;
    const pad = 20;                 // 容器左右 padding 合计
    const btnW = 34;                // 行末按钮预留宽（含间距）
    const avail = (gridEl.clientWidth || 640) - pad - btnW;
    return Math.max(1, Math.floor((avail + gap) / (cardW + gap)));
  }

// 池子按行渲染：每行若干卡片 + 行末「全选本行」按钮（右侧池在最右侧）
  function smartRenderRows(container, list, isDone, smartToken, append) {
    if (!container || !list.length) return;
    if (!append) container.innerHTML = "";
    const gap = 10, cardW = 150, btnW = 34;
    const cols = smartCols(container, cardW, gap);
    const pad = 20;
    const avail = (container.clientWidth || 640) - pad;
    const cardPx = Math.max(140, Math.floor((avail - gap * (cols - 1) - btnW) / cols));
    for (let i = 0; i < list.length; i += cols) {
      const row = document.createElement("div");
      row.className = "smart-row";
      const chunk = list.slice(i, i + cols);
      chunk.forEach(img => {
        const c = makeSmartCard(img, isDone, smartToken);
        c.style.width = cardPx + "px";
        row.appendChild(c);
      });
      const b = document.createElement("button");
      b.className = "smart-row-sel";
      b.type = "button";
      b.textContent = isDone ? "全选本行去标" : "全选本行打标";
      b.title = "选中这一行的所有图片";
      b.onclick = (e) => { e.stopPropagation(); smartSelectRow(chunk.map(x => x.id), isDone); };
      row.appendChild(b);
      container.appendChild(row);
    }
  }

function renderSmartGrid(gridEl, list, isDone, smartToken) {
    if (!gridEl || !list.length) return;
    smartRenderRows(gridEl, list, isDone, smartToken);
  }

// 全选某一行：batch 打标(toDone=true)或去标(false)，带二次确认
  async function smartSelectRow(ids, toDone) {
    if (!smartTag) { sbToast("请先选择一个具体标签，再全选本行", false); return; }
    if (!ids.length) return;
    const field = smartFieldMap[smartDim];
    const single = smartSingleDim[field];
    const action = single
      ? (toDone ? "打上「" + smartTag + "」类目" : "清空「" + smartTag + "」类目")
      : (toDone ? "打上「" + smartTag + "」标签" : "移除「" + smartTag + "」标签");
    if (!confirm("确认要对本行 " + ids.length + " 张图片批量" + action + "？")) return;
    let ok = 0, fail = 0;
    for (const id of ids) {
      const img = smartAll.find(i => i.id === id);
      if (!img) continue;
      try {
        if (single) {
          await SB.setImageSingleField(id, field, toDone ? smartTag : "");
          img[field] = toDone ? smartTag : "";
        } else {
          const cur = Array.isArray(img[field]) ? img[field] : [];
          const next = (toDone && smartUniqueFields.has(field)) ? [smartTag] : (toDone ? [...new Set(cur.concat([smartTag]))] : cur.filter(t => t !== smartTag));
          await SB.updateImageField(id, field, next);
          img[field] = next;
        }
        ok++;
      } catch (e) { fail++; }
    }
    sbToast("本行已" + action + "，" + ok + " 张成功" + (fail ? "，失败 " + fail + " 张" : ""));
    await renderSmartPools();
  }

// ===== 分批渲染（省图片请求）：每批渲染若干张卡片，点「加载更多」再渲染下一批 =====
const SMART_STEP = 24;                 // 每批渲染的卡片数（左右池各自计算）
let smartFullDone = [], smartFullUndone = [];   // 当前维度/标签下的完整清单（用于计数与"全选本池"，与实际渲染多少无关）
let smartShownDone = SMART_STEP, smartShownUndone = SMART_STEP;
let smartSig = "";                     // 维度+标签签名：变化时重置分批进度

function smartResetBatchIfChanged() {
    const sig = smartDim + "|" + smartTag;
    if (sig === smartSig) return;
    smartSig = sig;
    smartShownDone = SMART_STEP;
    smartShownUndone = SMART_STEP;
  }

// 「加载更多」（只追加下一批卡片，不重建整池：既不重复请求已显示的图片，也不跳动滚动位置）
  function smartMore(isDone) {
    const grid = document.querySelector(isDone ? "#smart-grid-done" : "#smart-grid-undone");
    const list = isDone ? smartFullDone : smartFullUndone;
    const before = isDone ? smartShownDone : smartShownUndone;
    const after = before + SMART_STEP;
    if (isDone) smartShownDone = after; else smartShownUndone = after;
    if (!grid) return;
    const old = grid.querySelector(".smart-more");
    if (old) old.remove();
    const slice = list.slice(before, after);
    if (smartTag) smartRenderRows(grid, slice, isDone, smartTokenCache, true);
    else slice.forEach(img => grid.appendChild(makeSmartCard(img, isDone, smartTokenCache)));
    appendSmartMore(grid, isDone, list.length - after);
  }

// 在池子末尾追加「加载更多」按钮（剩余 <=0 时不追加）
  function appendSmartMore(grid, isDone, remain) {
    if (!grid || remain <= 0) return;
    const b = document.createElement("button");
    b.className = "smart-more";
    b.type = "button";
    b.textContent = "加载更多（剩余 " + remain + " 张）";
    b.onclick = (e) => { e.stopPropagation(); smartMore(isDone); };
    grid.appendChild(b);
  }

// 渲染单池：只渲染前 shown 张，剩余用「加载更多」按钮承接（未渲染的卡片不会去请求图片）
  function smartRenderPoolPaged(grid, list, isDone, smartToken, withRows, shown) {
    if (!grid) return;
    const slice = list.slice(0, shown);
    if (withRows) {
      if (slice.length) smartRenderRows(grid, slice, isDone, smartToken);
    } else {
      slice.forEach(img => grid.appendChild(makeSmartCard(img, isDone, smartToken)));
    }
    appendSmartMore(grid, isDone, list.length - slice.length);
  }

function smartRenderPoolsPaged(doneGrid, undoneGrid, doneList, undoneList, smartToken, withRows) {
    smartFullDone = doneList;
    smartFullUndone = undoneList;
    smartRenderPoolPaged(doneGrid, doneList, true, smartToken, withRows, smartShownDone);
    smartRenderPoolPaged(undoneGrid, undoneList, false, smartToken, withRows, smartShownUndone);
  }

async function renderSmartPools() {
    smartResetBatchIfChanged();
    let smartToken = "";
    try { smartToken = await SB.currentToken(); } catch (e) { smartToken = ""; }
    smartTokenCache = smartToken;
    const doneGrid = document.querySelector("#smart-grid-done");
    const undoneGrid = document.querySelector("#smart-grid-undone");
    if (!doneGrid || !undoneGrid) return;
    doneGrid.innerHTML = "";
    undoneGrid.innerHTML = "";
    document.querySelector("#smart-cnt-done").textContent = "0";
    document.querySelector("#smart-cnt-undone").textContent = "0";
    // 允许图片列表为空时仍渲染"上传图片"入口卡，保证管理员可上传（尤其首次无图时）
    if (!smartAll.length) { smartFullDone = []; smartFullUndone = []; renderSmartUploadEntry(); return; }
    const field = smartFieldMap[smartDim];

    // 池标题：已选具体标签→按"是否含该标签"；未选标签→按"该维度是否已打标"
    const doneHead = document.querySelector("#smart-pool-done .smart-pool-head");
    const undoneHead = document.querySelector("#smart-pool-undone .smart-pool-head");
    const finishHead = (el, label, cnt) => {
      if (!el) return;
      el.childNodes[0].nodeValue = label;
      const c = el.querySelector(".sp-count");
      if (c) c.textContent = cnt;
    };

    if (smartTag) {
      const doneList = [], undoneList = [];
      smartAll.forEach(img => {
        const has = smartHas(img, field, smartTag);
        if (has) { doneList.push(img); return; }
        // 对逻辑单值维度：该图已打下同维度其它标签 → 视为"该维度已占用"，
        // 不再出现在"未打当前标签"池中，避免被重复打标。
        if (smartUniqueFields.has(field) && smartHasAny(img, field)) return;
        undoneList.push(img);
      });
      finishHead(doneHead, "已打该标签 ", doneList.length);
      finishHead(undoneHead, "未打该标签 ", undoneList.length);
      smartRenderPoolsPaged(doneGrid, undoneGrid, doneList, undoneList, smartToken, true);
    } else {
      // 未选具体标签：自动聚焦"该维度还没打任何标"的图片
      const doneList = [], undoneList = [];
      const dimLabel = ({ category: "类目", style: "风格", element: "元素", channel: "渠道", scene: "场景", shoot: "拍摄方式", skin: "肤色" }[smartDim] || "该维度");
      smartAll.forEach(img => {
        const has = smartHas(img, field, "");
        (has ? doneList : undoneList).push(img);
      });
      finishHead(doneHead, "已打" + dimLabel + " ", doneList.length);
      finishHead(undoneHead, "未打" + dimLabel + " ", undoneList.length);
      smartRenderPoolsPaged(doneGrid, undoneGrid, doneList, undoneList, smartToken, false);
    }
    // 兜底：错峰补载未成功显示的图片（避免一次性并发过高导致部分灰块）
    setTimeout(() => {
      [doneGrid, undoneGrid].forEach(grid => {
        if (!grid) return;
        grid.querySelectorAll(".smart-card .holder img:not(.loaded)").forEach(im => {
          im.dispatchEvent(new Event("error"));
        });
      });
    }, 500);
    renderSmartUploadEntry();      // 右池首位：上传入口卡 + 待传缩略图卡
    renderSmartAlbums();
  }

function makeSmartCard(img, isDone, smartToken) {
    const card = document.createElement("div");
    card.className = "smart-card";
    card.draggable = true;
    card.dataset.id = img.id;
    const wrap = document.createElement("div");
    wrap.className = "holder";
    const im = document.createElement("img");
    // 与图片管理完全一致的取图方式：渲染前一次性拿好令牌，只设 dataset.src，进入视口懒加载
    const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
    const makeSrc = (tok) => (base + "/" + img.path + (tok ? "?token=" + encodeURIComponent(tok) : ""));
    im.alt = img.name || "";
    im.loading = "eager";
    im.draggable = false;
    im.addEventListener("contextmenu", (e) => e.preventDefault());
    // 立即加载：智能打标弹窗内懒加载监听不可靠，改为打开即加载，保证图片显示
    let retried = false;
    const doLoad = (tok) => {
      im.src = makeSrc(tok);
      im.onload = () => { im.classList.add("loaded"); retried = false; };
      im.onerror = () => { im.classList.remove("loaded"); };
    };
    doLoad(smartToken);
    // 无论是否已带令牌，加载失败都重取一次最新令牌重试（处理令牌过期/失效）
    im.addEventListener("error", () => {
      if (retried) return;
      retried = true;
      SB.currentToken().then((t) => { if (t) doLoad(t); }).catch(() => {});
    });
    wrap.appendChild(im);
    card.appendChild(wrap);

    // 标签浮层：叠加显示在图片上（前台式），只展示有值的维度标签
    const cap = document.createElement("div");
    cap.className = "smart-card-tags";
    const dims = [
      ["类目", "cat", img.category ? [img.category] : []],
      ["渠道", "ch", (Array.isArray(img.tags) ? img.tags : []).concat(!Array.isArray(img.tags) && img.tags ? [img.tags] : [])],
      ["风格", "st", img.style_tags],
      ["元素", "el", img.element_tags],
      ["场景", "sc", img.scene_tags],
      ["拍摄", "sh", img.shoot_tags],
      ["肤色", "sk", img.skin_tags]
    ];
    // 像前台一样：每个维度一行（左对齐竖排一列），维度标签 + 标签值
    const rows = [];
    dims.forEach(([lab, cls, arr]) => {
      const v = (Array.isArray(arr) ? arr : []).filter(Boolean);
      if (v.length) rows.push(`<div class="smart-tag-row ${cls}"><b>${lab}</b><span>${escHtml(v.join("、"))}</span></div>`);
    });
    cap.innerHTML = rows.length ? rows.join("") : `<div class="smart-tag-row none"><b>—</b><span>未打标</span></div>`;
    card.appendChild(cap);
    // 卡片右上角删除图片按钮（点击确认后删除该图，并刷新池子/图册）
    const del = document.createElement("button");
    del.className = "smart-card-del";
    del.type = "button";
    del.title = "删除该图片";
    del.textContent = "×";
    del.addEventListener("click", (e) => { e.stopPropagation(); smartDeleteImage(img); });
    card.appendChild(del);
    // 单图外链编辑入口：点击为该图填写/清除外链（images.url），保存后刷新状态
    const lnk = document.createElement("button");
    lnk.className = "smart-card-link";
    lnk.type = "button";
    lnk.title = img.url ? ("外链：" + img.url) : "为这张图添加外链";
    lnk.textContent = img.url ? "🔗" : "＋链";
    lnk.addEventListener("click", (e) => {
      e.stopPropagation();
      const v = prompt("输入外链地址（留空则清除）：", img.url || "");
      if (v === null) return;
      const nv = v.trim();
      SB.setImageSingleField(img.id, "url", nv).then(() => {
        img.url = nv; lnk.textContent = nv ? "🔗" : "＋链"; lnk.title = nv ? ("外链：" + nv) : "为这张图添加外链";
        sbToast(nv ? "外链已保存" : "外链已清除");
      }).catch(err => sbToast("保存失败", false));
    });
    card.appendChild(lnk);
      // 双向点击：左池点图=撤标回右池；右池点图=打标到左池（保留拖拽）
    card.addEventListener("click", (e) => {
      if (smartDragging) return;                      // 拖拽中不触发
      e.stopPropagation();
      moveSmart(img.id, !isDone);                     // 左池→撤标(false)，右池→打标(true)
      if (isDone) {
        sbToast("已移除「" + smartTag + "」标签", false);
      } else {
        sbToast("已为图片打上「" + smartTag + "」标签", true);
      }
    });

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
    const albumsEl = document.querySelector("#smart-albums-list");
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
    // 图册栏：拖入某个册子=打上该标签（不依赖中间选中标签）
    if (albumsEl) {
      albumsEl.addEventListener("dragover", (e) => {
        const a = e.target.closest(".smart-album");
        if (!a) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        albumsEl.querySelectorAll(".smart-album").forEach(x => x.classList.remove("drop-over"));
        a.classList.add("drop-over");
      });
      albumsEl.addEventListener("dragleave", (e) => {
        const a = e.target.closest(".smart-album");
        if (a) a.classList.remove("drop-over");
      });
      albumsEl.addEventListener("drop", (e) => {
        e.preventDefault();
        albumsEl.querySelectorAll(".smart-album").forEach(x => x.classList.remove("drop-over"));
        const a = e.target.closest(".smart-album");
        if (!a) return;
        const tag = a.dataset.tag;
        if (!tag) return;
        const id = smartDragging ? smartDragging.id : null;
        if (!id) return;
        // 把图片打上该册子标签（自动落到左池该标签下）
        smartTag = tag;
        const draggedImg = smartAll.find(i => i.id === id);
        if (draggedImg) smartAlbumPreview[tag] = draggedImg;   // 图册缩略图显示最新拖入的这张
        moveSmart(id, true);
      });
    }
  }

// 渲染中间图册栏：当前维度下每个具体标签一个小册子，展示已收录数量
  function renderSmartAlbums() {
    const box = document.querySelector("#smart-albums-list");
    const cntEl = document.querySelector("#smart-album-cnt");
    if (!box) return;
    box.innerHTML = "";
    const lists = (smartTagsCache || []).slice();
    if (!lists.length) {
      if (cntEl) cntEl.textContent = "0";
      box.innerHTML = '<div class="smart-album-name" style="color:var(--sub);font-weight:400;font-size:12px;padding:8px">暂无标签，可到标签管理新增</div>';
      return;
    }
    const field = smartFieldMap[smartDim];
    // 场景维度：按室内/室外分组；其余维度平铺
    let groups = null;
    if (smartDim === "scene") {
      groups = [
        { key: "indoor", label: "室内" },
        { key: "outdoor", label: "室外" },
      ];
    }
    const renderOne = (tag) => {
      let count = 0;
      smartAll.forEach(img => { if (smartHas(img, field, tag)) count++; });
      const a = document.createElement("div");
      a.className = "smart-album" + (tag === smartTag ? " active" : "") + (count === 0 ? " empty" : "");
      a.dataset.tag = tag;
      const thumbWrap = document.createElement("div");
      thumbWrap.className = "smart-album-thumb";
      let pv = smartAlbumPreview[tag] || null;
      // 若图册预览图已被删除（不在此标签已打标的 smartAll 中），则忽略它，回退到该标签任一已打标图
      if (pv && !smartAll.some(img => img && img.id === pv.id)) pv = null;
      if (!pv) pv = smartAll.find(img => smartHas(img, field, tag)) || null;
      if (pv && pv.path) {
        const im = document.createElement("img");
        im.alt = tag;
        im.src = smartImgUrl(pv, smartToken);
        im.addEventListener("error", () => {
          if (smartToken) im.src = smartImgUrl(pv, "");
        });
        thumbWrap.appendChild(im);
      } else {
        const ph = document.createElement("span");
        ph.className = "smart-album-ph";
        ph.textContent = tag;
        thumbWrap.appendChild(ph);
      }
      const body = document.createElement("div");
      body.className = "smart-album-body";
      const name = document.createElement("div");
      name.className = "smart-album-name";
      const nameTxt = document.createElement("span");
      nameTxt.textContent = tag;
      name.appendChild(nameTxt);
      // 图册支持编辑标签名（除渠道维度）
      if (smartDim !== "channel") {
        const edn = document.createElement("button");
        edn.className = "smart-album-edit";
        edn.type = "button";
        edn.textContent = "✎";
        edn.title = "编辑/改名（同步更新图片与标签管理）";
        edn.addEventListener("click", (e) => { e.stopPropagation(); smartRenameTag(tag); });
        name.appendChild(edn);
      }
      const c = document.createElement("div");
      c.className = "smart-album-count";
      c.textContent = count + " 张";
      body.appendChild(name);
      body.appendChild(c);
      a.appendChild(thumbWrap);
      a.appendChild(body);
      const del = document.createElement("button");
      del.className = "smart-album-del";
      del.type = "button";
      del.title = "删除图册「" + tag + "」（同步到标签管理并移除图片上的该标签）";
      del.textContent = "×";
      del.setAttribute("data-tag", tag);
      del.addEventListener("click", (e) => { e.stopPropagation(); smartDeleteAlbum(tag); });
      a.appendChild(del);
      a.title = "把图片拖进此册子，即打上「" + tag + "」标签";
      a.addEventListener("click", async () => {
        smartTag = tag;
        document.querySelectorAll("#smart-tags .smart-tag").forEach(b => {
          b.classList.toggle("active", b.textContent === tag);
        });
        await renderSmartPools();
      });
      box.appendChild(a);
    };
    if (groups) {
      groups.forEach(g => {
        const members = lists.filter(t => smartSceneGroup[t] === g.key);
        if (!members.length) return;
        const gTitle = document.createElement("div");
        gTitle.className = "smart-album-group";
        gTitle.textContent = g.label;
        box.appendChild(gTitle);
        members.forEach(renderOne);
      });
      // 未归入 indoor/outdoor 的场景标签（无分组）单独展示
      const rest = lists.filter(t => smartSceneGroup[t] !== "indoor" && smartSceneGroup[t] !== "outdoor");
      if (rest.length) {
        const gTitle = document.createElement("div");
        gTitle.className = "smart-album-group";
        gTitle.textContent = "其他";
        box.appendChild(gTitle);
        rest.forEach(renderOne);
      }
    } else {
      lists.forEach(renderOne);
    }
    if (cntEl) cntEl.textContent = lists.length;
  }

// 新增图册（打标时）：在当前维度新增一个标签，并同步写入标签管理（tag_defs）
  async function smartAddAlbum() {
    if (!smartDim) { sbToast("请先选择一个维度（风格/元素/渠道等）", false); return; }
    const dimLabel = { category: "类目", style: "风格", element: "元素", channel: "渠道", scene: "场景", shoot: "拍摄方式", skin: "肤色" }[smartDim] || smartDim;
    if (smartDim === "channel") { sbToast("渠道标签请在 config.js 维护 CHANNEL_TAGS，不支持在此新增", false); return; }
    const name = prompt("请输入新的「" + dimLabel + "」标签名称：");
    if (name === null) return;
    const tag = name.trim();
    if (!tag) { sbToast("标签名称不能为空", false); return; }
    if ((smartTagsCache || []).some(t => t === tag)) { sbToast("标签「" + tag + "」已存在", false); return; }
    // 场景维度需带 indoor/outdoor 分组
    let group = null;
    if (smartDim === "scene") {
      const g = prompt("该场景属于室内还是室外？输入 室内 或 室外（回车留空=不分组）：");
      if (g !== null && g.trim()) {
        const gv = g.trim();
        group = (gv === "室内" || gv === "indoor") ? "indoor" : (gv === "室外" || gv === "outdoor") ? "outdoor" : null;
      }
    }
    try {
      let list = null;
      if (smartDim === "category") {
        // 类目维度：直接写入「类目管理」（categories 表），保证两处口径一致；
        // 管理员与超管均可新增（数据库策略：admin / super_admin 可写 categories）
        await SB.addCategory(tag);
        list = await smartCategoryCandidates();
      } else {
        await SB.addTagDef(smartDim, tag, group);
        // 本地同步刷新标签缓存（置顶显示）
        if (!smartTagsCache) smartTagsCache = [];
        smartTagsCache.unshift(tag);
        list = smartTagsCache.slice();
      }
      // 场景标签记录分组
      if (smartDim === "scene") smartSceneGroup[tag] = group || (tag.indexOf("室外") >= 0 ? "outdoor" : "indoor");
      // 更新图册栏与标签栏，并自动选中新标签/类目，可直接开始打标
      smartTag = tag;
      renderSmartAlbums();
      renderSmartTags(list);
      await renderSmartPools();
      sbToast((smartDim === "category" ? "已新增类目「" : "已新增标签「") + tag + "」并同步到" + (smartDim === "category" ? "类目管理" : "标签管理"), true);
    } catch (err) {
      const msg = (err && err.message) ? err.message : "";
      sbToast(smartDim === "category" ? ("新增类目失败：" + (msg || "请重试")) : "新增标签失败，请重试", false);
    }
  }

// 删除智能打标中的单张图片（确认后删除 R2 文件 + 数据库记录，并刷新池子与标签覆盖）
  async function smartDeleteImage(img) {
    if (!img || !img.id) return;
    if (!confirm("确认删除该图片？此操作不可恢复。")) return;
    if (!guardZone("visual", "无权限：只有可操作视觉专区的管理员可删除")) return;
    try {
      if (img.path) await SB.deleteImage(img.path);
      await SB.removeImageRecord(img.id);
      selectedImages.delete(img.id);
      // 更新本地缓存
      smartAll = smartAll.filter(i => i.id !== img.id);
      // 清除图册栏中指向该已删图片的"最新图"预览，避免画册残留已删图（回退到该标签其他有效图或占位）
      for (const k in smartAlbumPreview) {
        if (smartAlbumPreview[k] && smartAlbumPreview[k].id === img.id) delete smartAlbumPreview[k];
      }
      sbToast("已删除图片");
      // 刷新池子与图册栏，并同步刷新图片管理网格
      renderSmartAlbums();
      await renderSmartPools();
      refreshAfterImageChange();
    } catch (err) { sbToast("删除失败，请重试", false); }
  }

// 编辑/改名标签（顶部标签栏与图册栏共用）：同步更新 tag_defs 与图片上已打的该标签，然后刷新
  async function smartRenameTag(tag) {
    if (!tag) return;
    if (smartDim === "channel") { sbToast("渠道标签请在 config.js 维护，不支持在此改名", false); return; }
    const dimLabel = { category: "类目", style: "风格", element: "元素", scene: "场景", shoot: "拍摄方式", skin: "肤色" }[smartDim] || smartDim;
    const newName = prompt("重命名「" + tag + "」（" + dimLabel + "）：\n请输入新标签名称");
    if (newName === null) return;
    const n = String(newName || "").trim();
    if (!n) { sbToast("标签名称不能为空", false); return; }
    if (n === tag) { sbToast("新名称与旧名称相同", false); return; }
    if ((smartTagsCache || []).some(t => t === n)) { sbToast("标签「" + n + "」已存在", false); return; }
    // 场景维度：保留原分组；可选更换室内/室外
    let group = null;
    try {
      const defs = await SB.listTagDefs(smartDim);
      const hit = (defs || []).find(d => d.name === tag);
      group = hit ? (hit.group || null) : null;
    } catch (e) { /* 忽略 */ }
    if (smartDim === "scene") {
      const g = prompt("该场景属于室内还是室外？输入 室内 或 室外（回车保留原分组）：");
      if (g !== null && g.trim()) {
        const gv = g.trim();
        group = (gv === "室内" || gv === "indoor") ? "indoor" : (gv === "室外" || gv === "outdoor") ? "outdoor" : group;
      }
    }
    try {
      // 1. 更新 tag_defs 里的名称（按 type+name 查出 id）
      const defs = await SB.listTagDefs(smartDim);
      const hit = (defs || []).find(d => d.name === tag);
      if (!hit) { sbToast("未找到该标签定义", false); return; }
      await SB.updateTagDef(hit.id, n, group);
      // 2. 同步更新图片上该标签
      const field = smartFieldMap[smartDim];
      if (field && field !== "category") {
        await SB.renameTagDefAndImages(smartDim, tag, n);
      } else if (field === "category") {
        // 类目字段为字符串，单独处理
        await SB.renameCategoryImages(tag, n);
      }
      // 3. 更新本地缓存
      smartTagsCache = smartTagsCache.map(t => t === tag ? n : t);
      if (smartDim === "scene") { delete smartSceneGroup[tag]; smartSceneGroup[n] = group || (n.indexOf("室外") >= 0 ? "outdoor" : "indoor"); }
      smartAll.forEach(img => {
        const f = smartFieldMap[smartDim];
        if (!f) return;
        if (smartSingleDim[f]) {
          if (img[f] === tag) img[f] = n;
        } else if (Array.isArray(img[f])) {
          img[f] = img[f].map(t => t === tag ? n : t);
        }
      });
      // 4. 刷新标签栏 / 图册栏 / 池子
      renderSmartTags(smartTagsCache.slice());
      renderSmartAlbums();
      await renderSmartPools();
      sbToast("已将「" + tag + "」改名为「" + n + "」，并同步图片与标签管理", true);
    } catch (err) {
      sbToast("改名失败，请重试", false);
    }
  }

// 删除图册（打标时）：删除该标签，同步移除图片上的该标签，并同步删除标签管理里的标签
  async function smartDeleteAlbum(tag) {
    if (!tag) return;
    if (!confirm("确认删除图册「" + tag + "」？将同步移除图片上已打的该标签，并从标签管理删除该标签。")) return;
    const field = smartFieldMap[smartDim];
    try {
      // 1. 从数据库删除标签定义（先按 type+name 查出 id）
      let defId = null;
      try {
        const defs = await SB.listTagDefs(smartDim);
        const hit = (defs || []).find(d => d.name === tag);
        if (hit) defId = hit.id;
      } catch (e) { /* 忽略查询失败 */ }
      if (defId) await SB.deleteTagDef(defId);
      // 2. 逐张移除图片上该标签（图片本身保留）
      const affected = smartAll.filter(img => smartHas(img, field, tag));
      if (affected.length) {
        if (smartSingleDim[field]) {
          // 单值维度：清空该字段
          for (const img of affected) { await SB.setImageSingleField(img.id, field, ""); img[field] = ""; }
        } else {
          // 多值维度：从数组移除该标签
          for (const img of affected) {
            const arr = (img[field] || []).filter(x => x !== tag);
            await SB.updateImageField(img.id, field, arr);
            img[field] = arr;
          }
        }
      }
      // 3. 刷新本地缓存
      smartTagsCache = (smartTagsCache || []).filter(t => t !== tag);
      delete smartSceneGroup[tag];
      if (smartTag === tag) { smartTag = ""; }
      renderSmartAlbums();
      const tagBox = document.querySelector("#smart-tags");
      if (tagBox) {
        tagBox.querySelectorAll(".smart-tag").forEach(b => {
          if (b.textContent === tag) b.remove();
        });
      }
      await renderSmartPools();
      sbToast("已删除标签「" + tag + "」并同步到标签管理", true);
    } catch (err) {
      sbToast("删除标签失败，请重试", false);
    }
  }

// 单图打标/撤标后，只移动这一张卡到对应池，不重建整个池子 → 滚动位置保持不变
  function smartMoveCardLocally(img, toDone) {
    const doneGrid = document.querySelector("#smart-grid-done");
    const undoneGrid = document.querySelector("#smart-grid-undone");
    if (!doneGrid || !undoneGrid) return;
    const src = toDone ? undoneGrid : doneGrid;
    const dst = toDone ? doneGrid : undoneGrid;
    (src.querySelectorAll(".smart-card") || []).forEach(c => {
      if (c.dataset.id === String(img.id)) c.remove();
    });
    // 同步全量清单（计数与"全选本池"都以它为口径，不受分批渲染影响）
    smartFullDone = smartFullDone.filter(x => x.id !== img.id);
    smartFullUndone = smartFullUndone.filter(x => x.id !== img.id);
    (toDone ? smartFullDone : smartFullUndone).push(img);
    if (!smartTag) { smartSyncPoolCnt(); renderSmartAlbums(); return; }
    const newCard = makeSmartCard(img, toDone, smartTokenCache);
    const moreBtn = dst.querySelector(".smart-more");
    if (moreBtn) dst.insertBefore(newCard, moreBtn); else dst.appendChild(newCard);
    smartSyncPoolCnt();
    renderSmartAlbums();               // 图册栏计数同步更新（不影响池子滚动）
  }

// 只刷新左右池的计数文案，不清空池子（口径＝全量清单，不是已渲染张数）
  function smartSyncPoolCnt() {
    const set = (el, n) => { if (el) el.textContent = n; };
    set(document.querySelector("#smart-cnt-done"), smartFullDone.length);
    set(document.querySelector("#smart-cnt-undone"), smartFullUndone.length);
  }

async function moveSmart(id, toDone) {
    if (!smartTag) { sbToast("请先在中间选择一个标签", false); return; }
    const field = smartFieldMap[smartDim];
    const img = smartAll.find(i => i.id === id);
    if (!img) return;
    const isSingle = smartSingleDim[field];
    let next;
    if (isSingle) {
      next = toDone ? smartTag : "";
      try {
        await SB.setImageSingleField(img.id, field, next);
        img[field] = next;
        sbToast(toDone ? "已为图片打上「" + smartTag + "」类目" : "已清空该图片类目");
        smartMoveCardLocally(img, toDone);
      } catch (e) {
        sbToast("操作失败：" + (e.message || ""), false);
      }
      return;
    }
    const cur = Array.isArray(img[field]) ? img[field] : [];
    // 逻辑单值维度（风格/渠道/场景/拍摄/肤色）：打新=替换旧，只保留当前标签
    if (toDone && smartUniqueFields.has(field)) {
      next = [smartTag];
    } else if (toDone) {
      next = [...new Set(cur.concat([smartTag]))];
    } else {
      next = cur.filter(t => t !== smartTag);
    }
    try {
      await SB.updateImageField(img.id, field, next);
      img[field] = next;
      sbToast(toDone ? "已为图片打上「" + smartTag + "」标签" : "已移除「" + smartTag + "」标签");
      // 局部移动这一张卡，保持当前滚动位置（不再整池重渲染回顶）
      smartMoveCardLocally(img, toDone);
    } catch (e) {
      sbToast("操作失败：" + (e.message || ""), false);
    }
  }

// 全屏切换（智能打标弹窗）
  function toggleSmartFullscreen() {
    const modal = document.querySelector("#smart-modal");
    const fsBtn = document.querySelector("#smart-fs");
    if (!modal) return;
    const on = modal.classList.toggle("fullscreen");
    if (fsBtn) fsBtn.textContent = on ? "退出全屏" : "全屏";
  }

// 全选本池：给右池（未打该标签）的全部图片一键打上当前标签
  async function smartSelectAll() {
    if (!smartTag) { sbToast("请先选择一个具体标签，再全选本池", false); return; }
    const field = smartFieldMap[smartDim];
    const undoneGrid = document.querySelector("#smart-grid-undone");
    if (!undoneGrid) return;
    // 注意：用全量清单取图（分批渲染下页面只渲染了一部分）
    const ids = smartFullUndone.map(i => i.id).filter(Boolean);
    if (!ids.length) { sbToast("本池暂无需要打标的图片", false); return; }
    if (!confirm("确认要对本池 " + ids.length + " 张图片批量打上「" + smartTag + "」标签？")) return;
    let ok = 0, fail = 0;
    for (const id of ids) {
      const img = smartAll.find(i => i.id === id);
      if (!img) continue;
      try {
        if (smartSingleDim[field]) {
          await SB.setImageSingleField(id, field, smartTag);
          img[field] = smartTag;
        } else {
          const cur = Array.isArray(img[field]) ? img[field] : [];
          const next = smartUniqueFields.has(field) ? [smartTag] : [...new Set(cur.concat([smartTag]))];
          await SB.updateImageField(id, field, next);
          img[field] = next;
        }
        ok++;
      } catch (e) { fail++; }
    }
    sbToast("已为 " + ok + " 张图片打上「" + smartTag + "」" + (smartSingleDim[field] ? "类目" : "标签") + (fail ? "，失败 " + fail + " 张" : ""));
    await renderSmartPools();
  }

function bindSmartModal() {
    const openBtn = document.querySelector("#smart-tag-btn");
    if (openBtn) openBtn.addEventListener("click", openSmartModal);
    const closeBtn = document.querySelector("#smart-close");
    if (closeBtn) closeBtn.addEventListener("click", closeSmartModal);
    // ESC 键关闭智能打标：全屏时先退出全屏，否则关闭弹窗
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const m = document.querySelector("#smart-modal");
      if (!m || m.classList.contains("hidden")) return;
      if (m.classList.contains("fullscreen")) { toggleSmartFullscreen(); return; }
      closeSmartModal();
    });
    const fsBtn = document.querySelector("#smart-fs");
    if (fsBtn) fsBtn.addEventListener("click", toggleSmartFullscreen);
    const selAll = document.querySelector("#smart-select-all");
    if (selAll) selAll.addEventListener("click", smartSelectAll);
    const deselAll = document.querySelector("#smart-deselect-all");
    if (deselAll) deselAll.addEventListener("click", smartDeselAll);
    const albumAdd = document.querySelector("#smart-album-add");
    if (albumAdd) albumAdd.addEventListener("click", smartAddAlbum);
    // 从智能打标进入标签管理：关闭弹窗并切到标签管理面板
    const tagMgrBtn = document.querySelector("#smart-tagmgr-btn");
    if (tagMgrBtn) tagMgrBtn.addEventListener("click", () => {
      // 直接跳标签管理：不需要顺带加载图片列表（省图片请求）
      closeSmartModal({ skipManageLoad: true });
      switchPanel("tag-card");
    });
    // 标签管理面板里的「返回智能打标」：切回图片管理并恢复智能打标弹窗，保留上次维度/选中标签
    const smartBackBtn = document.querySelector("#smart-back-btn");
    if (smartBackBtn) smartBackBtn.addEventListener("click", () => backToSmartTag());
    bindSmartUpload();
    // 保护非关键调用：即使 bindSmartUrlMatch 异常，也不阻断后续拖放/上传绑定
    try { bindSmartUrlMatch(); } catch (e) { /* 忽略，不影响拖放 */ }
    bindSmartDrop();
  }

// 是否正在上传
  function bindSmartUpload() {
    const fi = document.querySelector("#smart-file");
    if (fi) fi.onchange = () => { smartAddFiles(fi.files); fi.value = ""; };
// 智能打标弹窗内：上传链接Excel，给当前智能待传图片按文件名挂外链
  function smartUrlMatch(files) {
    if (!files || !files.length) return;
    if (!smartPending.length) { sbToast("请先选择图片，再上传匹配链接表格", false); return; }
    if (typeof XLSX === "undefined") { sbToast("Excel解析组件未加载，请联网后重试", false); return; }
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
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
        smartPending.forEach(it => {
          if (!it.file) return;
          const n = stripExt(it.file.name);
          if (map[n]) { it.file._url = map[n]; matched++; }
        });
        smartRenderPending();
        sbToast(`已匹配 ${matched} 张图片链接${matched ? "" : "（未匹配到）"}`, matched > 0);
      } catch (e) {
        sbToast("表格解析失败，请检查文件格式", false);
      }
    };
    reader.readAsArrayBuffer(file);
  }
  function bindSmartUrlMatch() {
    // 「上传链接Excel」点击与文件解析统一由文档级委托处理（见下方 bindUrlMatchDelegate），此处不再重复绑定
  }
  // 文档级点击委托：正确分流两个「上传链接Excel」按钮到各自文件输入（绕开绑定时机/覆盖问题）
  document.addEventListener("click", (e) => {
    const t = e.target;
    const sm = t && t.closest ? t.closest("#smart-urlmatch-btn") : null;
    const main = t && t.closest ? t.closest("#url-match-btn") : null;
    if (sm) {
      e.preventDefault(); e.stopPropagation();
      if (!smartPending.length) { sbToast("请先在当前弹窗里选择要上传的图片（点右池「上传图片」卡片或用「上传」按钮），再上传匹配链接表格", false); return; }
      if (typeof XLSX === "undefined") { sbToast("Excel解析组件未加载，请联网后重试", false); return; }
      const fi = document.querySelector("#smart-url-file"); if (fi) fi.click(); return;
    }
    if (main) {
      e.preventDefault(); e.stopPropagation();
      const mi = document.querySelector("#url-match-input"); if (mi) mi.click(); return;
    }
  });
  // 文档级 change 委托：选中文档后必触发解析（主面板→handleUrlMatch，弹窗→smartUrlMatch），不再依赖任何初始化绑定
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!t || !t.id) return;
    if (t.id === "url-match-input") { handleUrlMatch(t.files); t.value = ""; }
    else if (t.id === "smart-url-file") { smartUrlMatch(t.files); t.value = ""; }
  });
    const btn = document.querySelector("#smart-upload-btn");
    if (btn) btn.onclick = doSmartUpload;
  }

async function fillSmartCat() {
    const sel = document.querySelector("#smart-cat");
    if (!sel) return;
    let cats = [];
    try { cats = await SB.listActiveCats(); } catch (e) {}
    sel.innerHTML = "";
    sel.add(new Option("类目…", ""));
    const CATS = window.CAT_SEARCH;
    const ordered = CATS ? CATS.sortCats(cats, currentFavCats) : cats.map(n => ({ name: n, fav: false }));
    ordered.forEach(o => sel.add(new Option((o.fav ? "★ " : "") + o.name, o.name)));
    sel._allCats = cats;
    if (CATS) {
      CATS.mountBox(sel, "cat-search-smartcat", "搜索类目…", (v) => { CATS.kw("smartcat", v); CATS.filterSelect(sel, v); });
      CATS.filterSelect(sel, CATS.kw("smartcat"));
    }
  }

// 点「＋」上传入口卡片：打开文件选择
  function smartPick() { const fi = document.querySelector("#smart-file"); if (fi) fi.click(); }

function smartAddFiles(fileList) {
    const imgs = Array.from(fileList).filter(f => /^image\//.test(f.type));
    if (!imgs.length) { sbToast("请选择图片文件", false); return; }
    imgs.forEach(f => {
      if (smartPending.some(p => p.name === f.name && p.size === f.size)) return;
      const item = { file: f, url: URL.createObjectURL(f) };
      smartPending.push(item);
    });
    smartRenderPending();
  }

function smartRemovePending(idx) {
    const it = smartPending[idx];
    if (it && it.url) URL.revokeObjectURL(it.url);
    smartPending.splice(idx, 1);
    smartRenderPending();
  }

function smartRenderPending() {
    const btn = document.querySelector("#smart-upload-btn");
    if (btn) { btn.disabled = smartPending.length === 0; btn.textContent = "上传" + (smartPending.length ? `（${smartPending.length}）` : ""); }
    renderSmartUploadEntry();     // 刷新右池首位的"上传入口 + 待传缩略图"
  }

// 在右池 grid 首位插入「上传入口卡片 + 待传缩略图卡」
  function renderSmartUploadEntry() {
    const undoneGrid = document.querySelector("#smart-grid-undone");
    if (!undoneGrid) return;
    // 移除旧的上传入口/待传卡（保留真正的图片卡）
    [...undoneGrid.querySelectorAll(".smart-up-entry, .smart-up-thumb")].forEach(n => n.remove());
    // ① 上传入口卡片（占一个图片位）
    const entry = document.createElement("div");
    entry.className = "smart-card smart-up-entry";
    entry.onclick = (e) => { e.stopPropagation(); smartPick(); };
    entry.innerHTML = `<div class="holder up-holder"><div class="up-inner"><span class="up-plus">＋</span><span class="up-txt">上传图片</span><span class="up-sub">点击选文件</span></div></div>`;
    undoneGrid.insertBefore(entry, undoneGrid.firstChild);
    // ② 待传缩略图卡（小图预览，无边框文件标题）
    smartPending.forEach((it, idx) => {
      const t = document.createElement("div");
      t.className = "smart-card smart-up-thumb";
      t.innerHTML = `<div class="holder"><img src="${it.url}" alt=""></div><button class="x" title="移除">×</button>`;
      t.querySelector(".x").onclick = (e) => { e.stopPropagation(); smartRemovePending(idx); };
      undoneGrid.insertBefore(t, entry.nextSibling);
    });
  }

// 上传并写库：并发限制提速，缩略图预览，成功后刷新池子（新图直接可打标）
  async function doSmartUpload() {
    if (!smartPending.length || smartUploading) return;
    if (currentRole !== "admin" && currentRole !== "super_admin") { sbToast("无权限：只有管理员可上传", false); return; }
    if (!guardZone("visual", "无权限：只有可操作视觉专区的管理员可上传")) return;
    let cat = document.querySelector("#smart-cat").value;
    if (!cat) { sbToast("请先选择上传类目", false); return; }
    // 类目级授权校验：超管放行；普通管理员必须该类目在其类目授权内（无授权类目不能传图）
    if (currentRole !== "super_admin") {
      let mineCats = [];
      try { mineCats = await SB.myZonePermissions("visual"); } catch (e) { mineCats = []; }
      if (mineCats.length && !mineCats.includes(cat)) { sbToast("无权限：该类目不在你的可管理类目授权内", false); return; }
    }
    smartUploading = true;
    const btn = document.querySelector("#smart-upload-btn");
    const prog = document.querySelector("#smart-progress");
    const bar = document.querySelector("#smart-progress-bar");
    if (btn) btn.disabled = true;
    if (prog) prog.classList.remove("hidden");
    const files = smartPending.map(it => it.file);
    const total = files.length;
    let done = 0, failed = 0, dup = 0;
    const setBar = () => { if (bar) bar.style.width = Math.round(done / total * 100) + "%"; };
    setBar();
    let existingNames = new Set();
    try { existingNames = new Set(await SB.listImageNames()); } catch (e) { console.warn("加载已有图片名失败", e); }
    // 记录结果容器（按 index）
    const results = new Array(total).fill(null);
    // 并发分组上传（单批并行 4 张，大幅快于串行）
    const CONCURRENCY = 4;
    let cursor = 0;
    async function worker() {
      while (cursor < files.length) {
        const i = cursor++;
        const file = files[i];
        const cleanName = file.name.replace(/[^\w.\-]/g, "_");
        if (existingNames.has(cleanName)) { results[i] = { ok: false, dup: true }; done++; setBar(); continue; }
        try {
          const path = await SB.uploadImage(file, cat);
          await SB.addImageRecord({ category: cat, name: cleanName, path, url: file._url || "" });
          existingNames.add(cleanName);
          results[i] = { ok: true };
        } catch (e) { console.warn(e); results[i] = { ok: false, fail: true }; }
        done++; setBar();
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
    results.forEach(r => { if (!r) return; if (r.dup) dup++; else if (r.fail) failed++; });
    const okCount = total - failed - dup;
    let msg = `上传完成：成功 ${okCount}，失败 ${failed}`;
    if (dup) msg += `，重复跳过 ${dup}`;
    sbToast(msg, failed === 0 && dup === 0);
    setTimeout(() => { if (prog) prog.classList.add("hidden"); if (bar) bar.style.width = "0%"; }, 800);
    smartPending.forEach(it => { if (it.url) URL.revokeObjectURL(it.url); });
    smartPending = [];
    smartUploading = false;
    smartRenderPending();
    // 仅在图片列表已加载过时才刷新它，避免为刷新而额外拉取图片
    if (manageLoadedOnce) await loadManage();
    await loadSmartAll();
    renderSmartPools();
  }

// 全选本池去标：给左池（已打该标签）的全部图片一键移除当前标签（需二次确认）
  async function smartDeselAll() {
    if (!smartTag) { sbToast("请先选择一个具体标签，再全选本池去标", false); return; }
    const field = smartFieldMap[smartDim];
    const doneGrid = document.querySelector("#smart-grid-done");
    if (!doneGrid) return;
    // 注意：用全量清单取图（分批渲染下页面只渲染了一部分）
    const ids = smartFullDone.map(i => i.id).filter(Boolean);
    if (!ids.length) { sbToast("本池暂无需要移除标签的图片", false); return; }
    if (!confirm("确认要对本池 " + ids.length + " 张图片批量移除「" + smartTag + "」标签？")) return;
    let ok = 0, fail = 0;
    for (const id of ids) {
      const img = smartAll.find(i => i.id === id);
      if (!img) continue;
      try {
        if (smartSingleDim[field]) {
          await SB.setImageSingleField(id, field, "");
          img[field] = "";
        } else {
          const cur = Array.isArray(img[field]) ? img[field] : [];
          const next = cur.filter(t => t !== smartTag);
          await SB.updateImageField(id, field, next);
          img[field] = next;
        }
        ok++;
      } catch (e) { fail++; }
    }
    sbToast("已为 " + ok + " 张图片移除「" + smartTag + "」" + (smartSingleDim[field] ? "类目" : "标签") + (fail ? "，失败 " + fail + " 张" : ""));
    await renderSmartPools();
  }

  /* 暴露给其它模块 / 事件绑定 */
  Object.assign(window, {
    openSmartModal, closeSmartModal, smartMore, appendSmartMore, smartCategoryCandidates, backToSmartTag, renderSmartDims, loadSmartAll, renderSmartTags, smartHas, smartHasAny, smartImgUrl, smartCols, smartRenderRows, renderSmartGrid, smartSelectRow, renderSmartPools, makeSmartCard, bindSmartDrop, renderSmartAlbums, smartAddAlbum, smartDeleteImage, smartRenameTag, smartDeleteAlbum, smartMoveCardLocally, smartSyncPoolCnt, moveSmart, toggleSmartFullscreen, smartSelectAll, bindSmartModal, bindSmartUpload, fillSmartCat, smartPick, smartAddFiles, smartRemovePending, smartRenderPending, renderSmartUploadEntry, doSmartUpload, smartDeselAll
  });

})();
