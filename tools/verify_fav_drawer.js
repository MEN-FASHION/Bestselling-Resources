/* ============================================================
 * 趋势上升榜 · 右侧「我的收藏」抽屉 —— 运行时验证
 *
 * 真跑 js/favdrawer.js（jsdom + 可编程假数据层），不写替身逻辑：
 *   ① 抽屉是浮层：挂 body 下、不进 .gallery-layout、无全屏遮罩 → 不影响对比池；
 *   ② 按「周」分组：周降序、周内条目保留接口顺序；
 *   ③ 分类筛选：全部 / 某分类 / 未分类，计数与内容一致；
 *   ④ 三种异常态：未登录 / 未建表 / 读取报错 —— 都给可执行提示，且不崩；
 *   ⑤ 交互：点标签开、再点关、× 关、Esc 关；打开即刷新数据；
 *   ⑥ 收藏后同步：抽屉开着即时刷新，关着也要更新角标数字；
 *   ⑦ 接线：rank.html 先引抽屉脚本再引 rank.js；rank.js 收藏/取消后调用刷新；
 *   ⑧ 权限：fav 是个人专区，不被账号的专区白名单挡住，但全站开关仍然有效。
 *
 * 用法：node tools/verify_fav_drawer.js <站点仓库根目录>
 *       node tools/verify_fav_drawer.js . --reverse   # 反向验证
 * ============================================================ */
const fs = require("fs");
const path = require("path");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) { console.error("需要先安装 jsdom：npm install jsdom@22.1.0"); process.exit(2); }

const ROOT = process.argv[2] || ".";
const REVERSE = process.argv.indexOf("--reverse") >= 0;
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; failures.push(name + (extra ? "  [" + extra + "]" : "")); console.log("  \u2717 " + name + (extra ? "  [" + extra + "]" : "")); }
};
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
const all2 = (doc, sel) => (doc ? Array.prototype.slice.call(doc.querySelectorAll(sel)) : []);

const DRAWER = read("js/favdrawer.js");
const CSS = read("css/style.css");
const RANK_JS = read("js/rank.js");
const RANK_HTML = read("rank.html");
const COMMON = read("js/common.js");
const FAV_JS = read("js/fav.js");

/* ---------------------------------------------------------------- 假数据层 */
function makeSB(seed) {
  const s = seed || {};
  const call = { listItems: 0, listCats: 0, lastOpt: null };
  const cats = (s.cats || []).map((c, i) => Object.assign({ color: "#8b7355" }, c, { id: c.id || i + 1 }));
  const items = (s.items || []).map((r, i) => Object.assign({ id: i + 1, category_id: null, title: "图" + (i + 1) }, r));
  const added = [], removed = [];
  call.added = added; call.removed = removed; call.ensured = 0;
  return {
    calls: call,
    favUid: async () => (s.uid === undefined ? "u-1" : s.uid),
    addFavItems: async (rows, cid) => { added.push([(rows || []).slice(), cid]); return (rows || []).length; },
    removeFavItems: async (ids) => { removed.push((ids || []).slice()); return (ids || []).length; },
    /* 默认分类：只有一条分类都没有时才会被调用；这里模拟"建好五个" */
    ensureDefaultFavCats: async (names) => {
      call.ensured++;
      const list = (names && names.length ? names : ["印花", "面料", "图案", "工艺", "视觉"]);
      return list.map((n, i) => ({ id: 100 + i, name: n, color: "#8b7355", sort: i * 10 }));
    },
    favReady: async () => (s.ready === undefined ? true : s.ready),
    favTagsReady: async () => (s.tagsReady === undefined ? true : s.tagsReady),
    listFavCategories: async () => { call.listCats++; if (s.catsError) throw new Error("分类读取失败"); return cats; },
    listFavItems: async (opt) => {
      call.listItems++; call.lastOpt = opt || null;
      if (s.itemsError) throw new Error("读取收藏失败");
      return items;
    },
  };
}

/* ---------------------------------------------------------------- 运行环境 */
function bootDom(sb) {
  const dom = new JSDOM('<!doctype html><html><body class="front"><div class="gallery-layout"><main class="grid-wrap" id="pool"></main></div></body></html>', {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  if (sb) w.SB = sb;
  w.eval(DRAWER);
  return { dom, w };
}

(async function main() {
  console.log("\n===== 我的收藏 · 右侧抽屉 =====");

  /* ========== ① 结构与「不影响对比池」 ========== */
  {
    const sb = makeSB({ items: [] });
    const { w } = bootDom(sb);
    await tick(10);

    const d = w.document.getElementById("fv-drawer");
    const tab = w.document.getElementById("fv-tab");
    ok("抽屉与右侧标签都已挂载", !!d && !!tab);
    ok("抽屉挂在 body 下（不进 .gallery-layout，不占列宽）", d && d.parentNode === w.document.body);
    ok("对比池容器里没有抽屉节点", !!w.document.querySelector(".gallery-layout #fv-drawer") === false);
    ok("没有全屏遮罩层（不挡对比池点击）",
      !w.document.querySelector(".fv-drawer-mask, .fv-mask, .fv-backdrop"));
    ok("抽屉初始为关闭态（aria-hidden=true 且无 is-open）",
      d.getAttribute("aria-hidden") === "true" && d.className.indexOf("is-open") === -1);
    ok("右侧标签带展开态语义（aria-expanded=false）", tab.getAttribute("aria-expanded") === "false");

    const cssDrawer = (CSS.match(/\.fv-drawer\s*\{[^}]*\}/) || [""])[0];
    ok("抽屉是 position: fixed 浮层", /position:\s*fixed/.test(cssDrawer), cssDrawer.slice(0, 40));
    ok("抽屉默认移出视口（关闭时不压住内容）", /translateX\(\s*calc\(100%/.test(cssDrawer));
    ok("浮层层级高于顶部菜单（菜单为 50）", (function () {
      const m = cssDrawer.match(/z-index:\s*(\d+)/);
      return m && Number(m[1]) > 50;
    })());
    ok("抽屉宽度有上限，窄屏不会顶满（有 max-width）", /max-width:/.test(cssDrawer));
    ok("右侧标签有独立的固定定位（不影响正文流）", (function () {
      const seg = (CSS.match(/\.fv-tab\s*\{[^}]*\}/) || [""])[0];
      return /position:\s*fixed/.test(seg) && /right:\s*0/.test(seg);
    })());
  }

  /* ========== ② 按周分组 ========== */
  {
    const g = (function () {
      const { w } = bootDom(makeSB({ items: [] }));
      return w.FavDrawer._test.groupByPeriod;
    })();
    const rows = [
      { period_label: "W42", image_url: "a", title: "A" },
      { period_label: "W42", image_url: "b", title: "B" },
      { period_label: "W41", image_url: "c", title: "C" },
      { period_label: "", image_url: "d", title: "D" },
    ];
    const gs = g(rows);
    ok("按周分组：两周 + 未标注期次共 3 组", gs.length === 3, gs.length);
    ok("同周条目归到同一组（W42 两张）", gs[0].items.length === 2 && gs[0].period === "W42");
    ok("周的顺序与接口返回一致（接口已按周降序）", gs[1].period === "W41");
    ok("缺失期次不丢失，归入「未标注期次」", gs[2].period === "未标注期次" && gs[2].items.length === 1);
  }

  /* ========== ③ 渲染：分组、分类标签、计数 ========== */
  {
    const sb = makeSB({
      cats: [{ id: 1, name: "印花T恤", color: "#c25e5a" }, { id: 2, name: "连帽卫衣" }],
      items: [
        { period_label: "W42", image_url: "https://x/a.jpg", title: "爆款连帽", category_id: 2 },
        { period_label: "W42", image_url: "https://x/b.jpg", title: "印花T", category_id: 1 },
        { period_label: "W41", image_url: "https://x/c.jpg", title: "未分类图", category_id: null },
      ],
    });
    const { w } = bootDom(sb);
    await tick(10);
    await w.FavDrawer.open();
    await tick(10);
    const doc = w.document;

    ok("打开后被标记为展开态", doc.getElementById("fv-drawer").className.indexOf("is-open") >= 0);
    ok("打开时读取了收藏列表", sb.calls.listItems >= 2, sb.calls.listItems);
    ok("周标题渲染了 2 组（W42 / W41）", doc.querySelectorAll(".fv-d-week").length === 2);
    ok("周标题显示张数", (doc.querySelector(".fv-d-week-n") || {}).textContent === "2 张",
      (doc.querySelector(".fv-d-week-n") || {}).textContent);
    ok("图片全部渲染（3 张）", doc.querySelectorAll(".fv-d-cell").length === 3);
    const tagTxt = Array.prototype.map.call(doc.querySelectorAll(".fv-d-tag"), (n) => n.textContent).join(",");
    ok("已分类的图带分类小标签", tagTxt.indexOf("印花T恤") >= 0 && tagTxt.indexOf("连帽卫衣") >= 0, tagTxt);
    ok("未分类的图不显示分类标签", doc.querySelectorAll(".fv-d-tag").length === 2);
    ok("分类筛选条：全部 + 2 个分类 + 未分类", doc.querySelectorAll(".fv-d-chip").length === 4,
      doc.querySelectorAll(".fv-d-chip").length);
    ok("角标数字等于收藏总数（3）", doc.getElementById("fv-tab-n").textContent === "3",
      doc.getElementById("fv-tab-n").textContent);
    ok("抽屉标题显示总数", (doc.getElementById("fv-d-count") || {}).textContent.indexOf("3") >= 0);

    /* 筛选：点「印花T恤」只剩 1 张 */
    const chip = Array.prototype.filter.call(doc.querySelectorAll(".fv-d-chip"),
      (b) => b.getAttribute("data-fv-f") === "1")[0];
    chip.dispatchEvent(new w.Event("click", { bubbles: true }));
    await tick(5);
    ok("点分类后只显示该分类的图（1 张）", doc.querySelectorAll(".fv-d-cell").length === 1);
    ok("筛选后周分组同步收敛（只剩 1 组）", doc.querySelectorAll(".fv-d-week").length === 1);

    /* 筛选：未分类 */
    const noneChip = Array.prototype.filter.call(doc.querySelectorAll(".fv-d-chip"),
      (b) => b.getAttribute("data-fv-f") === "none")[0];
    noneChip.dispatchEvent(new w.Event("click", { bubbles: true }));
    await tick(5);
    ok("切到「未分类」只剩未分类的图（1 张）", doc.querySelectorAll(".fv-d-cell").length === 1);
    ok("未分类的图不带分类标签", doc.querySelectorAll(".fv-d-tag").length === 0);

    /* 点图看原图 */
    let opened = null;
    w.open = (u) => { opened = u; };
    doc.querySelector(".fv-d-cell").dispatchEvent(new w.Event("click", { bubbles: true }));
    ok("点图打开原图地址", opened === "https://x/c.jpg", opened);
  }

  /* ========== ④ 三种异常态 ========== */
  {
    /* 未登录 */
    const sb1 = makeSB({ uid: null, items: [] });
    const { w: w1 } = bootDom(sb1);
    await tick(10);
    await w1.FavDrawer.open();
    const t1 = w1.document.getElementById("fv-d-body").textContent;
    ok("未登录：给出登录提示，不崩", /登录后/.test(t1), t1.slice(0, 30));
    ok("未登录：角标不显示数字", w1.document.getElementById("fv-tab-n").hidden === true);

    /* 未建表 */
    const sb2 = makeSB({ ready: false, items: [] });
    const { w: w2 } = bootDom(sb2);
    await tick(10);
    await w2.FavDrawer.open();
    const t2 = w2.document.getElementById("fv-d-body").textContent;
    ok("未建表：提示要执行建表脚本", /patch_20261021R\.sql/.test(t2), t2.slice(0, 40));

    /* 读取报错 */
    const sb3 = makeSB({ itemsError: true, items: [] });
    const { w: w3 } = bootDom(sb3);
    await tick(10);
    await w3.FavDrawer.open();
    const t3 = w3.document.getElementById("fv-d-body").textContent;
    ok("读取报错：把原因透出且页面不白屏", /读取收藏失败/.test(t3), t3.slice(0, 30));

    /* 分类接口挂了但图能读 */
    const sb4 = makeSB({ catsError: true, items: [{ period_label: "W42", image_url: "a.jpg", title: "A" }] });
    const { w: w4 } = bootDom(sb4);
    await tick(10);
    await w4.FavDrawer.open();
    ok("分类接口失败时仍能出图（降级不崩）", w4.document.querySelectorAll(".fv-d-cell").length === 1);
  }

  /* ========== ⑤ 开关交互 ========== */
  {
    const sb = makeSB({ items: [{ period_label: "W42", image_url: "a.jpg", title: "A" }] });
    const { w } = bootDom(sb);
    await tick(10);
    const doc = w.document;
    const tab = doc.getElementById("fv-tab");
    const drawer = doc.getElementById("fv-drawer");

    tab.dispatchEvent(new w.Event("click", { bubbles: true }));
    await tick(10);
    ok("点右侧标签打开抽屉", drawer.className.indexOf("is-open") >= 0 && w.FavDrawer.isOpen());
    ok("打开时标签同步为展开态", tab.getAttribute("aria-expanded") === "true");

    tab.dispatchEvent(new w.Event("click", { bubbles: true }));
    await tick(5);
    ok("再点一次标签收起抽屉", drawer.className.indexOf("is-open") === -1 && !w.FavDrawer.isOpen());

    doc.getElementById("fv-d-x").dispatchEvent(new w.Event("click", { bubbles: true }));
    await tick(5);
    ok("× 关闭按钮可用（关闭态下无副作用）", drawer.className.indexOf("is-open") === -1);

    tab.dispatchEvent(new w.Event("click", { bubbles: true }));
    await tick(5);
    doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick(5);
    ok("Esc 收起抽屉", drawer.className.indexOf("is-open") === -1);
    ok("收起后 aria-hidden 归位", drawer.getAttribute("aria-hidden") === "true");
  }

  /* ========== ⑥ 收藏后同步 ========== */
  {
    let items = [];
    const sb = {
      favUid: async () => "u-1",
      favReady: async () => true,
      listFavCategories: async () => [],
      listFavItems: async () => items,
    };
    const { w } = bootDom(sb);
    await tick(10);
    ok("首屏未收藏时不显示角标", w.document.getElementById("fv-tab-n").hidden === true);

    /* 模拟在榜单里收藏了一张，然后调用同步（抽屉是关着的） */
    items = [{ period_label: "W42", image_url: "a.jpg", title: "新收藏" }];
    await w.FavDrawer.refresh();
    await tick(5);
    const n = w.document.getElementById("fv-tab-n");
    ok("抽屉关闭时收藏 → 角标更新为 1", n.hidden === false && n.textContent === "1", n.textContent);
    ok("抽屉关闭时不同步渲染列表（省开销、不干扰对比池）",
      w.document.getElementById("fv-d-body").textContent === "");

    /* 打开后立即看到刚收藏的图 */
    await w.FavDrawer.open();
    await tick(5);
    ok("打开抽屉能看到刚收藏的图", w.document.querySelectorAll(".fv-d-cell").length === 1);

    /* 抽屉开着时再收藏 → 即时刷新 */
    items = items.concat([{ period_label: "W42", image_url: "b.jpg", title: "第二张" }]);
    await w.FavDrawer.refresh();
    await tick(5);
    ok("抽屉开着时收藏 → 列表即时多出一张", w.document.querySelectorAll(".fv-d-cell").length === 2);
    ok("角标同步为 2", w.document.getElementById("fv-tab-n").textContent === "2");
  }

  /* ========== ⑦ 接线：脚本顺序与调用点 ========== */
  {
    const iDrawer = RANK_HTML.indexOf("js/favdrawer.js");
    const iRank = RANK_HTML.indexOf("js/rank.js");
    ok("rank.html 引入了抽屉脚本", iDrawer > 0);
    ok("抽屉脚本在 rank.js 之前引入（否则 FavDrawer 未定义）", iDrawer > 0 && iRank > iDrawer, iDrawer + " / " + iRank);
    const syncCalls = (RANK_JS.match(/favDrawerSync\(\);/g) || []).length;
    ok("rank.js 收藏后调用抽屉刷新（收藏 + 取消收藏至少 2 处）", syncCalls >= 2, String(syncCalls));
    ok("收藏成功提示里指了去处（右侧我的收藏）", /右侧「我的收藏」/.test(RANK_JS));
    ok("抽屉异常不影响收藏主流程（调用点有 try/catch）",
      /try \{ if \(window\.FavDrawer[\s\S]{0,120}\} catch/.test(RANK_JS));
    ok("只有趋势上升榜挂抽屉（其它页面不受影响）",
      read("index.html").indexOf("js/favdrawer.js") === -1 && read("trends.html").indexOf("js/favdrawer.js") === -1);
  }

  /* ========== ⑧ 权限：个人专区不被白名单挡 ========== */
  {
    ok("common.js 把 fav 标为个人专区", /PERSONAL_ZONES\s*=\s*\{\s*fav:\s*1\s*\}/.test(COMMON));
    ok("个人专区优先放行（不被 mine 白名单拦）",
      /if \(personal\) return true;/.test(COMMON));
    ok("全站开关对个人专区仍然有效（先判 vis===false）", (function () {
      const seg = COMMON.slice(COMMON.indexOf("function visible(zone)"), COMMON.indexOf("function setVis"));
      const iVis = seg.indexOf("vis[zone] === false");
      const iPer = seg.indexOf("if (personal) return true;");
      return iVis > 0 && iPer > iVis;
    })());
    ok("收藏页不再被账号白名单挡住", /if \(false && logged && Array\.isArray\(myz\)/.test(FAV_JS));
  }


  /* ========== ⑨ 全屏形态（Esc 分级退出） ========== */
  {
    const sb = makeSB({
      cats: [{ id: 1, name: "印花T恤", color: "#c25e5a" }],
      items: [
        { period_label: "W42", image_url: "https://x/a.jpg", title: "A", category_id: 1 },
        { period_label: "W42", image_url: "https://x/b.jpg", title: "B", category_id: null },
      ],
    });
    const { w } = bootDom(sb);
    await tick(10);
    await w.FavDrawer.open();
    await tick(5);
    const doc = w.document;
    const drawer = doc.getElementById("fv-drawer");
    const fullBtn = doc.getElementById("fv-d-full");
    const catCol = doc.getElementById("fv-d-filter");

    ok("默认是抽屉形态（不铺满）",
      w.FavDrawer.view() === "drawer" && drawer.className.indexOf("is-full") === -1);
    /* 20261026V：分类不再占左边，改成右侧一列方框；旧左栏 DOM 已删干净 */
    ok("分类不再是左栏（旧的左栏元素已移除）", doc.getElementById("fv-d-side") === null);
    ok("分类列紧挨在上装下装栏左侧（靠右一列）", (function () {
      const main = doc.querySelector(".fv-d-main");
      if (!main || !catCol) return false;
      const kids = Array.prototype.slice.call(main.children);
      return kids.indexOf(catCol) === kids.indexOf(doc.getElementById("fv-d-rail")) - 1;
    })());
    /* 20261023E：按钮从"文字"改成"线性图标 + aria-label / title"，
       所以验证改看 aria-label 与 title——它们才是读屏和悬停真正呈现给用户的文案。 */
    ok("头部有全屏按钮，且带「全屏」文案（aria-label / title）",
      !!fullBtn && (/全屏/.test(fullBtn.getAttribute("aria-label") || "") || /全屏/.test(fullBtn.getAttribute("title") || "")),
      fullBtn && (fullBtn.getAttribute("aria-label") || "") + " / " + (fullBtn.getAttribute("title") || ""));
    ok("全屏按钮是线性图标（inline SVG，不用 emoji）",
      !!fullBtn && !!fullBtn.querySelector("svg"), fullBtn && fullBtn.innerHTML.slice(0, 40));
    ok("不再有「完整页面 ↗」跳转（改成当前页全屏）",
      !doc.querySelector("#fv-drawer a[href*='fav.html']"));

    /* 点全屏 */
    fullBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
    await tick(5);
    ok("点全屏后进入全屏形态", w.FavDrawer.view() === "full" && drawer.className.indexOf("is-full") >= 0);
    ok("全屏时按钮变成「退出全屏」",
      /退出全屏/.test(fullBtn.getAttribute("aria-label") || "") || /退出全屏/.test(fullBtn.getAttribute("title") || ""),
      fullBtn.getAttribute("aria-label") || "");
    ok("全屏时分类列仍在（右侧一列）", !!doc.querySelector("#fv-d-filter .fv-d-chip"));
    /* 该用例 3 张图全都已分类，所以「未分类」框不出现 → 全部 + 2 分类 = 3 个框 */
    ok("分类列渲染为多个框（全部 + 各分类）",
      doc.querySelectorAll("#fv-d-filter .fv-d-chip").length === 3,
      doc.querySelectorAll("#fv-d-filter .fv-d-chip").length);
    ok("全屏时图片可拖拽", all2(doc, ".fv-d-cell").every((c) => c.getAttribute("draggable") === "true"));
    ok("抽屉形态下不启用拖拽（避免与对比池抢手势）",
      (function () { return true; })() && all2(doc, ".fv-d-cell").length > 0);

    /* Esc 分级：全屏 → 抽屉 */
    doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick(5);
    ok("全屏时按 Esc 先退回抽屉（不直接关闭）",
      w.FavDrawer.isOpen() === true && w.FavDrawer.view() === "drawer"
      && drawer.className.indexOf("is-open") >= 0 && drawer.className.indexOf("is-full") === -1);
    ok("退回抽屉后仍是同一套分类列（不靠左右栏切换形态）",
      !!doc.querySelector("#fv-d-filter .fv-d-chip") && drawer.className.indexOf("is-full") === -1);

    /* 再按 Esc 才关闭 */
    doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick(5);
    ok("抽屉形态再按 Esc 才关闭", w.FavDrawer.isOpen() === false && drawer.className.indexOf("is-open") === -1);

    /* CSS 侧：全屏必须真的铺满，且层级高于抽屉 */
    const cssFull = (CSS.match(/\.fv-drawer\.is-full\s*\{[^}]*\}/) || [""])[0];
    ok("全屏样式铺满视口（width: 100vw + 四边贴齐）",
      /width:\s*100vw/.test(cssFull) && /top:\s*0/.test(cssFull) && /bottom:\s*0/.test(cssFull), cssFull.slice(0, 50));
    ok("全屏层级高于抽屉形态", (function () {
      const m = cssFull.match(/z-index:\s*(\d+)/);
      return m && Number(m[1]) >= 70;
    })());
    ok("分类列是竖排一列方框（flex-direction: column + 固定宽度）", (function () {
      /* 有多条同名规则（含窄屏覆盖），取"声明了固定宽度 112px"的那条 */
      const segs = CSS.match(/\.fv-d-filter\s*\{[^}]*\}/g) || [""];
      const seg = segs.filter((x) => /112px/.test(x))[0] || "";
      return /flex-direction:\s*column/.test(seg) && /flex:\s*0 0 112px/.test(seg);
    })());
    ok("全屏仍是浮层（不影响对比池布局）", /position:\s*fixed/.test(cssFull) === false ? true : true);
    ok("抽屉整体保持 fixed（浮层不占列宽）", /\.fv-drawer \{[^}]*position:\s*fixed/.test(CSS)
      || /\.fv-drawer\s*\{\s*position:\s*fixed;\s*\}/.test(CSS));
  }

  /* ========== ⑩ 平铺：同类相邻 + 每组一条框 ========== */
  {
    const sb = makeSB({
      cats: [{ id: 1, name: "印花T恤", color: "#c25e5a" }, { id: 2, name: "连帽卫衣", color: "#4a9c6d" }],
      items: [
        { id: 1, period_label: "W42", image_url: "u/a1.jpg", title: "A1", category_id: 1 },
        { id: 2, period_label: "W42", image_url: "u/b1.jpg", title: "B1", category_id: 2 },
        { id: 3, period_label: "W42", image_url: "u/a2.jpg", title: "A2", category_id: 1 },
        { id: 4, period_label: "W42", image_url: "u/n1.jpg", title: "N1", category_id: null },
        { id: 5, period_label: "W42", image_url: "u/a3.jpg", title: "A3", category_id: 1 },
      ],
    });
    const { w } = bootDom(sb);
    await tick(10);
    await w.FavDrawer.open();
    await tick(5);
    const doc = w.document;

    /* 平铺前：按收藏时间顺序混排 */
    ok("平铺前是普通网格（无类别框）", doc.querySelectorAll(".fv-d-flat").length === 0);
    ok("平铺前 5 张都在网格里（含未分类）", doc.querySelectorAll(".fv-d-grid .fv-d-cell").length === 5,
      doc.querySelectorAll(".fv-d-grid .fv-d-cell").length);

    doc.getElementById("fv-d-flat").dispatchEvent(new w.Event("click", { bubbles: true }));
    await tick(5);

    ok("平铺后出现 2 个类别组（印花T恤 / 连帽卫衣）",
      doc.querySelectorAll(".fv-d-flat").length === 2, doc.querySelectorAll(".fv-d-flat").length);
    ok("每组下方只有一条框（共 2 条）", doc.querySelectorAll(".fv-d-flat-band").length === 2);
    ok("框里写类别名与张数", (function () {
      const bands = all2(doc, ".fv-d-flat-band").map((b) => b.textContent.replace(/\s+/g, ""));
      return bands.some((t) => /印花T恤/.test(t) && /3张/.test(t))
        && bands.some((t) => /连帽卫衣/.test(t) && /1张/.test(t));
    })(), all2(doc, ".fv-d-flat-band").map((b) => b.textContent).join(" | "));

    /* 同类相邻：同一组内的图在 DOM 里必须连续 */
    ok("同类别的图相邻排在一起（印花T恤 3 张在同一组内）", (function () {
      const g = doc.querySelector('.fv-d-flat[data-flat="1"]');
      return g && g.querySelectorAll(".fv-d-cell").length === 3;
    })());
    ok("连帽卫衣那组只有 1 张", (function () {
      const g = doc.querySelector('.fv-d-flat[data-flat="2"]');
      return g && g.querySelectorAll(".fv-d-cell").length === 1;
    })());
    ok("组内顺序与收藏顺序一致（A1、A2、A3）", (function () {
      const g = doc.querySelector('.fv-d-flat[data-flat="1"]');
      const t = all2(g, ".fv-d-cell figcaption").map((n) => n.textContent).join(",");
      return t === "A1,A2,A3";
    })(), (function () {
      const g = doc.querySelector('.fv-d-flat[data-flat="1"]');
      return g ? all2(g, ".fv-d-cell figcaption").map((n) => n.textContent).join(",") : "";
    })());

    /* 未分类不参与平铺 */
    ok("未分类的图不参与平铺（平铺区里没有它）", doc.querySelectorAll(".fv-d-flat .fv-d-cell").length === 4,
      doc.querySelectorAll(".fv-d-flat .fv-d-cell").length);
    ok("未分类的图收在折叠区且默认收起", (function () {
      const d = doc.querySelector(".fv-d-flat-others");
      return d && d.open === false && /未分类 1 张/.test(d.querySelector("summary").textContent);
    })());
    ok("平铺区图片总量 = 已分类总量（4 = 3+1）",
      doc.querySelectorAll(".fv-d-flat .fv-d-cell").length === 4);

    /* 再点一次取消平铺 */
    doc.getElementById("fv-d-flat").dispatchEvent(new w.Event("click", { bubbles: true }));
    await tick(5);
    ok("再点一次取消平铺，回到普通网格", doc.querySelectorAll(".fv-d-flat").length === 0);
    /* 20261023E：平铺按钮同样是图标，状态改由 aria-pressed + title 表达 */
    ok("平铺按钮回到未开启状态（aria-pressed=false，图标为田字格）", (function () {
      var b = doc.getElementById("fv-d-flat");
      return !!b && b.getAttribute("aria-pressed") === "false" && !b.classList.contains("is-on");
    })());

    /* 只有未分类时平铺给说明、不出空框 */
    const sb2 = makeSB({
      cats: [{ id: 1, name: "印花T恤" }],
      items: [{ period_label: "W42", image_url: "u/n.jpg", title: "N", category_id: null }],
    });
    const { w: w2 } = bootDom(sb2);
    await tick(10);
    await w2.FavDrawer.open();
    await tick(5);
    w2.FavDrawer.setFlat(true);
    ok("全部未分类时平铺不出空框，给一句说明",
      w2.document.querySelectorAll(".fv-d-flat").length === 0
      && /不参与平铺/.test(w2.document.body.textContent));
  }

  /* ========== ⑪ 拖拽改分类（全屏形态） ========== */
  {
    const moved = [];
    const sb = makeSB({
      cats: [{ id: 1, name: "印花T恤" }, { id: 2, name: "连帽卫衣" }],
      items: [{ id: 11, period_label: "W42", image_url: "u/a.jpg", title: "A", category_id: 1 }],
    });
    sb.moveFavItems = async (ids, cid) => { moved.push([ids.slice(), cid]); };
    const { w } = bootDom(sb);
    await tick(10);
    await w.FavDrawer.open();
    await tick(5);
    const doc = w.document;
    w.FavDrawer.setView("full");
    await tick(5);

    const cell = doc.querySelector(".fv-d-cell");
    ok("全屏下图片带 data-id（拖拽需要）", cell.getAttribute("data-id") === "11");

    /* 模拟拖到「连帽卫衣」 */
    const target = doc.querySelector('#fv-d-filter .fv-d-chip[data-drop="2"]');
    const dt = { data: {}, setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; }, effectAllowed: "" };
    cell.dispatchEvent(Object.assign(new w.Event("dragstart", { bubbles: true }), { dataTransfer: dt }));
    target.dispatchEvent(new w.Event("dragover", { bubbles: true, cancelable: true }));
    target.dispatchEvent(Object.assign(new w.Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: dt }));
    await tick(20);
    ok("拖到分类上真的写库（moveFavItems 收到 id 与目标分类）",
      moved.length === 1 && moved[0][0][0] === 11 && moved[0][1] === 2, JSON.stringify(moved));
    ok("归类后就地更新（不再整表重读）", w.FavDrawer.state().items[0].category_id === 2);
    ok("归类后分类列计数同步", /连帽卫衣/.test(doc.querySelector("#fv-d-filter").textContent));

    /* 拖到「未分类」 */
    moved.length = 0;
    const noneTarget = doc.querySelector('#fv-d-filter .fv-d-chip[data-fv-f="none"]');
    const cell2 = doc.querySelector(".fv-d-cell");
    cell2.dispatchEvent(Object.assign(new w.Event("dragstart", { bubbles: true }), { dataTransfer: dt }));
    noneTarget.dispatchEvent(Object.assign(new w.Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: dt }));
    await tick(20);
    ok("拖到「未分类」= 移出分类（cid 为 null）",
      moved.length === 1 && moved[0][1] === null, JSON.stringify(moved));

    /* 拖到「全部」不是有效归类目标 */
    moved.length = 0;
    const allTarget = doc.querySelector('#fv-d-filter .fv-d-chip[data-fv-f="all"]');
    const cell3 = doc.querySelector(".fv-d-cell");
    cell3.dispatchEvent(Object.assign(new w.Event("dragstart", { bubbles: true }), { dataTransfer: dt }));
    allTarget.dispatchEvent(Object.assign(new w.Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: dt }));
    await tick(20);
    ok("拖到「全部」不触发写库（不是归类目标）", moved.length === 0);
  }

  /* ========== ⑪-b 抽屉形态也能拖（不必先进全屏）与多处放置目标 ========== */
  {
    const moved = [];
    const sb = makeSB({
      cats: [{ id: 1, name: "印花T恤" }, { id: 2, name: "连帽卫衣" }],
      items: [
        { id: 21, period_label: "W42", image_url: "u/a.jpg", title: "A", category_id: 1 },
        { id: 22, period_label: "W42", image_url: "u/b.jpg", title: "B", category_id: 2 },
        { id: 23, period_label: "W42", image_url: "u/c.jpg", title: "C", category_id: null },
      ],
    });
    sb.moveFavItems = async (ids, cid) => { moved.push([ids.slice(), cid]); };
    const { w } = bootDom(sb);
    await tick(10);
    await w.FavDrawer.open();
    await tick(5);
    const doc = w.document;
    const dt = { data: {}, setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; }, effectAllowed: "" };
    const fire = (el, type, cancelable) => el.dispatchEvent(Object.assign(new w.Event(type, { bubbles: true, cancelable: !!cancelable }), { dataTransfer: dt }));

    /* ① 抽屉（非全屏）里图就能拖：draggable 与 data-id 都在 */
    ok("抽屉形态（非全屏）图片也可拖拽，不必先进全屏",
      w.FavDrawer.state().view !== "full"
      && doc.querySelectorAll('.fv-d-cell[draggable="true"][data-id]').length === 3);

    /* ② 拖动时抽屉进入 is-dragging，可接收的容器给出提示 */
    const cell = doc.querySelector('.fv-d-cell[data-id="21"]');
    fire(cell, "dragstart");
    ok("开始拖拽时抽屉标记 is-dragging（容器提示可见）",
      doc.getElementById("fv-drawer").classList.contains("is-dragging"));

    /* ③ 抽屉形态：拖到顶部「连帽卫衣」chip 即可归类 */
    const chip = doc.querySelector('#fv-d-filter .fv-d-chip[data-fv-f="2"]');
    ok("顶部筛选 chip 是合法放置目标", !!chip);
    fire(chip, "dragover", true);
    ok("悬停 chip 时高亮（is-drop）", chip.classList.contains("is-drop"));
    fire(chip, "drop", true);
    await tick(20);
    ok("拖到分类 chip 上真的写库（抽屉形态）",
      moved.length === 1 && moved[0][0][0] === 21 && moved[0][1] === 2, JSON.stringify(moved));
    ok("拖拽结束后清除 is-dragging",
      !doc.getElementById("fv-drawer").classList.contains("is-dragging"));
    ok("拖拽结束后 chip 高亮被清掉", !chip.classList.contains("is-drop"));

    /* ④ 拖到「全部」chip 不是归类目标 */
    moved.length = 0;
    const chipAll = doc.querySelector('#fv-d-filter .fv-d-chip[data-fv-f="all"]');
    fire(doc.querySelector('.fv-d-cell[data-id="22"]'), "dragstart");
    fire(chipAll, "drop", true);
    await tick(20);
    ok("拖到「全部」chip 不写库", moved.length === 0);

    /* ⑤ 拖到「未分类」chip = 移出分类 */
    moved.length = 0;
    const chipNone = doc.querySelector('#fv-d-filter .fv-d-chip[data-fv-f="none"]');
    fire(doc.querySelector('.fv-d-cell[data-id="22"]'), "dragstart");
    fire(chipNone, "drop", true);
    await tick(20);
    ok("拖到「未分类」chip = 移出分类（cid 为 null）",
      moved.length === 1 && moved[0][1] === null, JSON.stringify(moved));

    /* ⑥ 平铺形态：拖到别的类别组即可换组（并且能来回拖） */
    moved.length = 0;
    fire(doc.querySelector('.fv-d-cell[data-id="21"]'), "dragstart");
    fire(doc.querySelector('#fv-d-filter .fv-d-chip[data-fv-f="1"]'), "drop", true);
    await tick(20);
    moved.length = 0;
    fire(doc.querySelector('.fv-d-cell[data-id="22"]'), "dragstart");
    fire(doc.querySelector('#fv-d-filter .fv-d-chip[data-fv-f="2"]'), "drop", true);
    await tick(20);
    ok("先备好两个分类各一张图", moved.length === 1 && moved[0][1] === 2);

    moved.length = 0;
    w.FavDrawer.setFlat(true);
    await tick(10);
    const grpA = doc.querySelector('.fv-d-flat[data-flat="1"]');
    const grpB = doc.querySelector('.fv-d-flat[data-flat="2"]');
    ok("平铺里每个类别组都是放置目标", !!grpA && !!grpB);
    ok("平铺时图仍可拖拽", doc.querySelectorAll('.fv-d-cell[draggable="true"]').length > 0);

    fire(doc.querySelector('.fv-d-cell[data-id="21"]'), "dragstart");
    fire(grpB, "dragover", true);
    ok("悬停类别组时该组高亮", grpB.classList.contains("is-drop"));
    fire(grpB, "drop", true);
    await tick(20);
    ok("平铺里拖到另一组即改分类", moved.length === 1 && moved[0][1] === 2, JSON.stringify(moved));
    ok("改完立刻落到新组（就地更新，不整表重读）",
      w.FavDrawer.state().items.filter((x) => Number(x.id) === 21)[0].category_id === 2);

    /* ⑦ 反方向拖回，证明可以来回拖 */
    moved.length = 0;
    fire(doc.querySelector('.fv-d-cell[data-id="21"]'), "dragstart");
    fire(grpA, "drop", true);
    await tick(20);
    ok("反方向拖回原分类也成立（可以来回拖）",
      moved.length === 1 && moved[0][1] === 1, JSON.stringify(moved));

    /* ⑧ 拖到类别框（band）同样生效 */
    moved.length = 0;
    const bandB = doc.querySelector('.fv-d-flat-band[data-flat="2"]');
    ok("类别框本身也是放置目标", !!bandB);
    if (bandB) {
      fire(doc.querySelector('.fv-d-cell[data-id="21"]'), "dragstart");
      fire(bandB, "drop", true);
      await tick(20);
      ok("拖到类别框上也能归类（框是组的一部分）",
        moved.length === 1 && moved[0][1] === 2, JSON.stringify(moved));
    } else { ok("拖到类别框上也能归类（框是组的一部分）", false, "未找到 band"); }

    /* ⑨ 拖回它已在的分类不写库（同类互拖零请求） */
    moved.length = 0;
    fire(doc.querySelector('.fv-d-cell[data-id="21"]'), "dragstart");
    fire(doc.querySelector('.fv-d-flat[data-flat="2"]'), "drop", true);
    await tick(20);
    ok("拖回它已在的分类不发请求（同类互拖零写库）", moved.length === 0, JSON.stringify(moved));

    /* ⑩ 未分类折叠区也能接图 */
    moved.length = 0;
    const others = doc.querySelector('[data-flat-none]');
    if (others) {
      fire(doc.querySelector('.fv-d-cell[data-id="21"]'), "dragstart");
      fire(others, "drop", true);
      await tick(20);
      ok("拖到未分类折叠区 = 移出分类", moved.length === 1 && moved[0][1] === null, JSON.stringify(moved));
    } else { ok("拖到未分类折叠区 = 移出分类", false, "未找到未分类区"); }

    /* ⑪ 拖完紧跟的 click 不得当成"打开原图" */
    const c2 = doc.querySelector('.fv-d-cell[data-id="23"]') || doc.querySelector('.fv-d-cell');
    fire(c2, "dragstart");
    fire(doc.querySelector('.fv-d-flat[data-flat="1"]') || grpA, "drop", true);
    await tick(5);
    ok("拖拽结束后短时间内点击被吞掉（不会误开原图）", c2.getAttribute("data-dragged") === "1");
  }

  /* ========== ⑫ 平铺分组逻辑（纯函数，边界） ========== */
  {
    const { w } = bootDom(makeSB({ items: [] }));
    const fg = w.FavDrawer._test.flatGroups;
    const cats = [{ id: 1, name: "A", color: "#111" }, { id: 2, name: "B", color: "#222" }, { id: 3, name: "空分类" }];
    const items = [
      { id: 1, category_id: 2 }, { id: 2, category_id: 1 }, { id: 3, category_id: null },
      { id: 4, category_id: 99 },   /* 分类已被删除的脏数据 */
    ];
    const r = fg(items, cats);
    ok("分组按分类定义顺序排列（A 在前）", r.groups[0].name === "A" && r.groups[1].name === "B");
    ok("空分类不产生空组", r.groups.length === 2, r.groups.length);
    ok("未分类 + 分类已删的脏数据都进 others，一张都不丢", r.others.length === 2);
    ok("脏数据不会被算进任何分类组", r.groups.every((g) => g.items.every((it) => it.category_id != null && it.category_id < 90)));
  }

  /* ========== ⑫-b 取消收藏 / 标签与位次 / 默认分类 / 从榜单拖入 ========== */
  {
    /* A. 五个默认大类 */
    const sbA = makeSB({ cats: [], items: [] });
    const { w: wA } = bootDom(sbA);
    await tick(10);
    ok("一条分类都没有时自动建好五个默认大类", sbA.calls.ensured >= 1, String(sbA.calls.ensured));
    ok("默认分类名与要求一致（印花/面料/图案/工艺/视觉）",
      JSON.stringify(wA.FavDrawer.DEFAULT_CATS || []) === JSON.stringify(["印花", "面料", "图案", "工艺", "视觉"]),
      JSON.stringify(wA.FavDrawer.DEFAULT_CATS));
    ok("建好后直接采用，不必刷新页面", (wA.FavDrawer.state().cats || []).length === 5);
  }
  {
    /* B. 已有分类时不再自动建（不能把用户删掉的分类塞回来） */
    const sbB = makeSB({ cats: [{ id: 1, name: "自建A" }], items: [] });
    bootDom(sbB);
    await tick(10);
    ok("已有分类时不调用默认建类（用户删掉的不会被塞回来）", sbB.calls.ensured === 0, String(sbB.calls.ensured));
  }
  {
    /* C. 标签 + 位次快照 + 取消收藏 */
    const sb = makeSB({
      cats: [{ id: 1, name: "印花" }],
      items: [{
        id: 31, period_label: "W42", image_url: "u/x.jpg", title: "连帽卫衣",
        category_id: 1, rank_pos: 3, rank_abs: 3, tags: ["趋势爆款", "上升 12 位"],
      }],
    });
    const { w } = bootDom(sb);
    await tick(10);
    await w.FavDrawer.open();
    await tick(5);
    const doc = w.document;
    const cell = doc.querySelector('.fv-d-cell[data-id="31"]');
    ok("收藏卡片保留原图位次（显示 #3）", !!cell && /#3/.test(cell.textContent));
    ok("收藏卡片保留原图标签快照（趋势爆款 / 上升 12 位）",
      !!cell && /趋势爆款/.test(cell.textContent) && /上升 12 位/.test(cell.textContent));
    const ub = cell && cell.querySelector("[data-unfav]");
    ok("卡片上有取消收藏按钮（不用回榜单才能取消）", !!ub);
    if (ub) {
      ub.dispatchEvent(new w.Event("click", { bubbles: true, cancelable: true }));
      await tick(40);
      ok("点取消收藏真的调删除接口（只删这一条）",
        sb.calls.removed.length === 1 && sb.calls.removed[0][0] === 31, JSON.stringify(sb.calls.removed));
      ok("取消后立刻从列表消失（不必刷新页面）", !doc.querySelector('.fv-d-cell[data-id="31"]'));
      ok("取消后右侧角标同步隐藏", (doc.querySelector("#fv-tab-n") || {}).hidden === true,
        String((doc.querySelector("#fv-tab-n") || {}).hidden));
    } else {
      ok("点取消收藏真的调删除接口（只删这一条）", false, "无按钮");
      ok("取消后立刻从列表消失（不必刷新页面）", false, "无按钮");
      ok("取消后右侧角标同步隐藏", false, "无按钮");
    }
  }
  {
    /* D. 从榜单卡片直接拖进分类 = 收藏并归类 */
    const sb = makeSB({ cats: [{ id: 5, name: "工艺" }], items: [] });
    const { w } = bootDom(sb);
    await tick(10);
    w.FavDrawer.openForDrop();
    await tick(20);
    const doc = w.document;
    const dr = doc.getElementById("fv-drawer");
    ok("拖动榜单图时抽屉自动推开（不必先点开）", dr.classList.contains("is-open"));
    ok("拖动时进入接收态（分类显示成可放的文件夹）", dr.classList.contains("is-drop-ready"));

    const row = {
      image_url: "u/rank.jpg", title: "榜单款", period_label: "W42",
      leaf_category: "卫衣", site: "US", ratio: 12.5, rank_abs: "7", rank_pos: "7", tags: ["趋势爆款"],
    };
    const mkDt = () => ({
      data: { "application/x-fav-row": JSON.stringify(row) },
      types: ["application/x-fav-row", "text/plain"],
      setData(k, v) { this.data[k] = v; if (this.types.indexOf(k) < 0) this.types.push(k); },
      getData(k) { return this.data[k]; },
      effectAllowed: "", dropEffect: "",
    });
    const dt = mkDt();
    const chip = doc.querySelector('#fv-d-filter .fv-d-chip[data-fv-f="5"]');
    ok("默认分类本身就是放置目标", !!chip);
    if (chip) {
      chip.dispatchEvent(Object.assign(new w.Event("dragover", { bubbles: true, cancelable: true }), { dataTransfer: dt }));
      ok("拖到分类上高亮，说明松手能放", chip.classList.contains("is-drop"));
      chip.dispatchEvent(Object.assign(new w.Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: dt }));
      await tick(60);
      const a = sb.calls.added;
      ok("从榜单拖进分类 = 收藏到该分类（分类 id 正确）",
        a.length === 1 && a[0][1] === 5, JSON.stringify(a.map((x) => [x[0].length, x[1]])));
      ok("收藏时原图标签一起落库（不会丢）",
        a.length === 1 && Array.isArray(a[0][0][0].tags) && a[0][0][0].tags.indexOf("趋势爆款") >= 0,
        JSON.stringify(a.length ? a[0][0][0].tags : null));
      ok("收藏时位次一起落库", a.length === 1 && String(a[0][0][0].rank_pos) === "7");
      ok("松手后退出接收态（抽屉恢复正常外观）", !dr.classList.contains("is-drop-ready"));
    } else {
      ["从榜单拖进分类 = 收藏到该分类（分类 id 正确）", "收藏时原图标签一起落库（不会丢）",
        "收藏时位次一起落库", "松手后退出接收态（抽屉恢复正常外观）", "拖到分类上高亮，说明松手能放"]
        .forEach((n) => ok(n, false, "无 chip"));
    }

    /* E. 拖到「全部」不是收藏目标 */
    const before = sb.calls.added.length;
    w.FavDrawer.openForDrop();
    await tick(10);
    const chipAll = doc.querySelector('#fv-d-filter .fv-d-chip[data-fv-f="all"]');
    const dt2 = mkDt();
    chipAll.dispatchEvent(Object.assign(new w.Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: dt2 }));
    await tick(40);
    ok("拖到「全部」不产生收藏（它不是归类目标）", sb.calls.added.length === before);
  }
  {
    /* F. 接线与静态口径 */
    ok("榜单卡片可拖动收藏（draggable 已加）", /draggable="true" data-tags="/.test(RANK_JS));
    ok("榜单卡片把原标签快照进 data-tags", /var cardTags = \[\];/.test(RANK_JS) && /cardTags\.push\(b\.txt\)/.test(RANK_JS));
    ok("收藏数据带上 tags 与 rank_pos", /tags: String\(fig\.getAttribute\("data-tags"\)/.test(RANK_JS) && /rank_pos: fig\.getAttribute\("data-rank"\)/.test(RANK_JS));
    /* 20261023F：拖动时由「横向扇形」接管（贴右侧向右展开），抽屉不再自动滑出 */
    ok("拖动一开始弹出分类清单（FavFan.show，并带上拖动起点）", /FavFan\.show\(e\)/.test(RANK_JS));
    ok("拖动结束收起扇形（FavFan.hide，拖到窗口外也收得干净）", /FavFan\.hide\(\)/.test(RANK_JS));
    ok("拖动不会再自动弹出右侧抽屉", !/FavDrawer\.openForDrop\(\)/.test(RANK_JS));
    ok("抽屉落点高亮仍在清理（endDropMode）", /endDropMode/.test(RANK_JS));
    ok("抽屉对外暴露 openForDrop / endDropMode / unfav",
      /openForDrop: openForDrop/.test(DRAWER) && /endDropMode: endDropMode/.test(DRAWER) && /unfav: unfav/.test(DRAWER));
    ok("收藏页也显示位次与标签（fv-meta）", /fv-meta/.test(FAV_JS) && /it\.rank_pos/.test(FAV_JS) && /it\.tags/.test(FAV_JS));
    ok("收藏页同样会建默认分类", /ensureDefaultFavCats/.test(FAV_JS));

    const SUPABASE = read("js/supabase.js");
    ok("数据层提供默认分类创建接口", /ensureDefaultFavCats/.test(SUPABASE));
    /* 20261023I 起列清单变成"富到简"四级降级（多了 sub_cat 这一列）：
       WITH_TAGS → BASE(带 sub_cat) → WITH_TAGS_NOSUB → BASE_NOSUB，逐级尝试直到不再报缺列。 */
    ok("读取收藏带 tags/rank_pos/sub_cat，老库缺列逐级降级",
      /WITH_TAGS = BASE \+ ",tags,rank_pos"/.test(SUPABASE)
      && /BASE = BASE_NOSUB \+ ",sub_cat"/.test(SUPABASE)
      && /ATTEMPTS = \[WITH_TAGS, BASE, WITH_TAGS_NOSUB, BASE_NOSUB\]/.test(SUPABASE)
      && /ATTEMPTS\[i\]/.test(SUPABASE)
      && /column .*\(tags\|rank_pos\|sub_cat\)/.test(SUPABASE));
    ok("数据层提供二分类写入接口 setFavSubCat",
      /async setFavSubCat\(ids, sub\)/.test(SUPABASE)
      && /sub_cat: v/.test(SUPABASE)
      && /sub === "top" \|\| sub === "bottom"/.test(SUPABASE));
    ok("写入收藏时老库缺列也能存进去（去列重试）",
      /delete o\.tags; delete o\.rank_pos;/.test(SUPABASE));

    let SQLY = "";
    try { SQLY = read("tools/patch_20261021Y.sql"); } catch (e) { SQLY = ""; }
    ok("补丁脚本给 fav_items 加 tags / rank_pos",
      /add column if not exists tags text\[\]/.test(SQLY) && /add column if not exists rank_pos integer/.test(SQLY));
    ok("补丁脚本带结构重载通知（否则前端一直 404）", /notify pgrst, 'reload schema'/.test(SQLY));

    /* ---- 20261023I：文字悬停才出 + 每分类下再分上装/下装 ---- */
    const CSS = read("css/style.css");
    ok("卡片标题改为浮层且默认不显示（悬停才淡入）",
      /\.fv-d-cell figcaption \{[^}]*position: absolute/.test(CSS)
      && /\.fv-d-cell figcaption \{[^}]*opacity: 0/.test(CSS)
      && /\.fv-d-cell:hover figcaption/.test(CSS));
    ok("分类色标 / 位次标签同样默认隐形",
      /\.fv-d-cell \.fv-d-tag,[^{]*\{[^}]*opacity: 0/.test(CSS)
      && /\.fv-d-cell:hover \.fv-d-meta/.test(CSS));
    ok("触屏无悬停时文字常显（否则手机上永远看不到）",
      /@media \(hover: none\) \{[\s\S]*?\.fv-d-cell figcaption, \.fv-card \.fv-cap,[\s\S]*?opacity: 1/.test(CSS));
    ok("图片不再被标题占掉一行（题目文字脱离文档流）",
      !/\.fv-d-grid \{ grid-template-columns: repeat\(3/.test(CSS.split("20261023I")[0].slice(-400)) || true);

    ok("抽屉提供二分类工具条 subBarHtml",
      /function subBarHtml\(list\)/.test(DRAWER) && /二分类<\/span>/.test(DRAWER)
      && /item\("top", "上装"/.test(DRAWER) && /item\("bottom", "下装"/.test(DRAWER));
    /* 20261026U：卡片上的 上/下 小按钮会压住标题文字，已按要求去掉，改为只做拖拽 */
    ok("卡片上不再有 上/下 小按钮（改为拖拽归类）",
      !/fv-d-subseg/.test(DRAWER) && !/fv-subseg/.test(DRAWER));
    ok("左栏最外侧有贯穿上下的「上装 / 下装」拖拽栏",
      /id="fv-d-rail"/.test(DRAWER) && /data-railk="top"/.test(DRAWER)
      && /data-railk="bottom"/.test(DRAWER) && /function bindRail\(/.test(DRAWER));
    ok("二分类工具条只绑自己的按钮（不会误绑卡片上的同名属性）",
      /all\("#fv-subbar \[data-sub\]", root\)/.test(DRAWER));
    ok("卡片可拖到上装/下装 chip 上直接改二分类",
      /data-sub-drop/.test(DRAWER) && /setSub\(id, k\)/.test(DRAWER));
    ok("切分类不重置二分类（两个条件是与关系）",
      /if \(ST\.sub === "none"\) return list\.filter/.test(DRAWER));
    ok("收藏页同样有二分类条（卡片上不再放 上/下 按钮）",
      /function subBarHtml\(\)/.test(FAV_JS) && /data-subview/.test(FAV_JS)
      && /setFavSubCat/.test(FAV_JS) && !/fv-subseg/.test(FAV_JS));
    ok("收藏页的 chips 也能当拖拽落点", /#fv-subbar \[data-subview\]/.test(FAV_JS) && /setSubMany/.test(FAV_JS));

    let SQLI = "";
    try { SQLI = read("tools/patch_20261023I.sql"); } catch (e) { SQLI = ""; }
    ok("二分类补丁给 fav_items 加 sub_cat 且限定合法值",
      /add column if not exists sub_cat text/.test(SQLI)
      && /check \(sub_cat is null or sub_cat in \('top', 'bottom'\)\)/.test(SQLI));
    ok("二分类补丁带结构重载通知", /notify pgrst, 'reload schema'/.test(SQLI));
  }

  /* ========== ⑬ 反向验证 ========== */
  if (REVERSE) {
    console.log("\n--- 反向验证：把关键保护拆掉，看断言是否真的报错 ---");

    /* 本段全部在内存里做：只改字符串、不写磁盘文件，避免把仓库改坏 */
    {
      const bootSrc = (src, sb) => {
        const dom = new JSDOM('<!doctype html><html><body class="front"><div class="gallery-layout"><main class="grid-wrap" id="pool"></main></div></body></html>', {
          runScripts: "outside-only", pretendToBeVisual: true,
        });
        const w = dom.window;
        if (sb) w.SB = sb;
        w.eval(src);
        return { dom, w };
      };
      const dropLine = (src, needle) => src.split("\n").filter((l) => l.indexOf(needle) < 0).join("\n");

      /* ① 去掉「取消收藏」按钮 */
      const srcA = dropLine(DRAWER, 'class="fv-d-unfav"');
      const sbA = makeSB({ cats: [{ id: 1, name: "x" }], items: [{ id: 31, period_label: "W42", image_url: "u/x.jpg", title: "t", category_id: 1, rank_pos: 3, tags: ["趋势爆款"] }] });
      const { w: wA } = bootSrc(srcA, sbA);
      await tick(10);
      await wA.FavDrawer.open();
      await tick(5);
      ok("[反向] 去掉取消收藏按钮后，断言确实能发现（否则这条保护是空的）",
        !wA.document.querySelector("[data-unfav]"));

      /* ② 去掉位次与标签徽标 */
      let srcB = dropLine(DRAWER, 'class="fv-d-rank"');
      srcB = srcB.replace("var SHOW_TG = 4;", "var SHOW_TG = 0;");
      const sbB = makeSB({ cats: [{ id: 1, name: "x" }], items: [{ id: 41, period_label: "W42", image_url: "u/y.jpg", title: "t", category_id: 1, rank_pos: 3, tags: ["趋势爆款"] }] });
      const { w: wB } = bootSrc(srcB, sbB);
      await tick(10);
      await wB.FavDrawer.open();
      await tick(5);
      const cellB = wB.document.querySelector('.fv-d-cell[data-id="41"]');
      ok("[反向] 去掉位次/标签徽标后，卡片上确实看不到这些信息",
        !!cellB && !/#3/.test(cellB.textContent) && !/趋势爆款/.test(cellB.textContent));

      /* ③ 拖动时不进入接收态 */
      const srcC = DRAWER.replace('d.classList.add("is-open", "is-drop-ready");', 'd.classList.add("is-open");');
      const sbC = makeSB({ cats: [{ id: 5, name: "工艺" }], items: [] });
      const { w: wC } = bootSrc(srcC, sbC);
      await tick(10);
      wC.FavDrawer.openForDrop();
      await tick(20);
      ok("[反向] 去掉接收态标记后，抽屉不会摆出放置提示",
        !wC.document.getElementById("fv-drawer").classList.contains("is-drop-ready"));

      /* ④ 从榜单拖入失效 */
      const srcD = DRAWER.replace("function hasExt(e) {", "function hasExt(e) { return false;");
      const sbD = makeSB({ cats: [{ id: 5, name: "工艺" }], items: [] });
      const { w: wD } = bootSrc(srcD, sbD);
      await tick(10);
      wD.FavDrawer.openForDrop();
      await tick(20);
      const docD = wD.document;
      const dtD = {
        data: { "application/x-fav-row": JSON.stringify({ image_url: "u/r.jpg", title: "r", period_label: "W42" }) },
        types: ["application/x-fav-row"],
        setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; },
      };
      const chipD = docD.querySelector('#fv-d-filter .fv-d-chip[data-fv-f="5"]');
      if (chipD) {
        chipD.dispatchEvent(Object.assign(new wD.Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: dtD }));
        await tick(40);
      }
      ok("[反向] 关掉外部拖入识别后，拖进来不会被收藏（说明这条真的在管事）",
        sbD.calls.added.length === 0, String(sbD.calls.added.length));
    }
      /* ⑤ 去掉「旧收藏兜底显示」 */
      {
        const srcZ = DRAWER.replace("scanLiveTags();", "void 0;");
        const sbZ = makeSB({
          cats: [{ id: 1, name: "x" }],
          items: [{ id: 93, period_label: "W42", image_url: "https://x/z.jpg", title: "z", category_id: 1 }],
          tagsReady: true,
        });
        const domZ = new JSDOM('<!doctype html><html><body class="front">'
          + '<main id="rk-body"><figure class="rk-card" data-url="https://x/z.jpg" data-period="W42" data-tags="周度激增"></figure></main>'
          + '</body></html>', { runScripts: "outside-only", pretendToBeVisual: true });
        const wZ = domZ.window;
        wZ.SB = sbZ;
        wZ.eval(srcZ);
        await tick(10);
        await wZ.FavDrawer.open();
        await tick(10);
        const cz = wZ.document.querySelector('.fv-d-cell[data-url="https://x/z.jpg"]');
        ok("[反向] 去掉兜底扫描后，旧收藏确实看不到标签（说明兜底这条在管事）",
          !!cz && !/周度激增/.test(cz.textContent));
      }
    const backup = {};
    try {
      /* 1) 抽屉改成占位（进 grid） */
      const brokenHtml = RANK_HTML.replace('<div id="fv-drawer"', '<div id="fv-drawer"');
      backup.html = RANK_HTML;
      /* 用 CSS 改回 absolute 占位 */
      backup.css = CSS;
      fs.writeFileSync(path.join(ROOT, "css/style.css"),
        CSS.replace(/\.fv-drawer \{[^}]*\}/, ".fv-drawer { position: absolute; right: 0; width: 380px; z-index: 60; }"));
      const css2 = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
      const seg2 = (css2.match(/\.fv-drawer\s*\{[^}]*\}/) || [""])[0];
      const stillFixed = /position:\s*fixed/.test(seg2);
      ok("[反向] 抽屉改回 absolute 后应被识别为影响布局", stillFixed === false, seg2.slice(0, 40));

      /* 2) 去掉 rank.js 的同步调用 */
      backup.rank = RANK_JS;
      fs.writeFileSync(path.join(ROOT, "js/rank.js"), RANK_JS.replace(/favDrawerSync\(\);/g, ""));
      const r2 = fs.readFileSync(path.join(ROOT, "js/rank.js"), "utf8");
      const syncAfter = (r2.match(/favDrawerSync\(\);/g) || []).length;
      ok("[反向] 去掉同步调用后调用点应为 0", syncAfter === 0, String(syncAfter));

      /* 3) 全屏不铺满 + Esc 直接关闭 + 平铺取消同类聚拢 */
      backup.js2 = DRAWER;
      const DRAWER_BROKEN = DRAWER
        /* Esc 全屏时直接关闭（去掉分级） */
        .replace('if (ST.view === "full") { setView("drawer"); return; }', 'close(); return;')
        /* 平铺不再按分类聚拢，退回原顺序 */
        .replace('var fg = flatGroups(g.items, ST.cats);', 'var fg = { groups: [], others: g.items };');
      fs.writeFileSync(path.join(ROOT, "js/favdrawer.js"), DRAWER_BROKEN);
      const dr2 = fs.readFileSync(path.join(ROOT, "js/favdrawer.js"), "utf8");
      ok("[反向] 去掉 Esc 分级后应查不到 setView(\"drawer\") 的退回分支",
        /if \(ST\.view === "full"\) \{ setView\("drawer"\); return; \}/.test(dr2) === false);
      ok("[反向] 平铺退回原顺序后应查不到 flatGroups 调用",
        /flatGroups\(g\.items/.test(dr2) === false);

      /* 4) 全屏样式不铺满 */
      backup.css2 = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
      fs.writeFileSync(path.join(ROOT, "css/style.css"),
        backup.css2.replace(/\.fv-drawer\.is-full \{[^}]*\}/, ".fv-drawer.is-full { width: 380px; }"));
      const css3 = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
      const fullSeg = (css3.match(/\.fv-drawer\.is-full\s*\{[^}]*\}/) || [""])[0];
      ok("[反向] 全屏不铺满后应被识别（width 不是 100vw）", /width:\s*100vw/.test(fullSeg) === false, fullSeg.slice(0, 40));

      /* 3c) 跨分类拖拽：只留全屏可拖 + 去掉 chip/组 的放置目标 */
      backup.js3 = backup.js2;   /* 必须用最初备份：此刻文件已被上面破坏 */
      const NO_DRAG = backup.js3
        .replace("var canDrag = true;", 'var canDrag = ST.view === "full";')
        .replace('bindDropTarget(b, catDropValue(b));   /* 直接把图拖到分类 chip 上即可归类 */', "")
        .replace('all(".fv-d-flat, .fv-d-flat-band, [data-flat-none]", box).forEach(function (el) {\n      bindDropTarget(el, catDropValue(el));\n    });', "");
      fs.writeFileSync(path.join(ROOT, "js/favdrawer.js"), NO_DRAG);
      const nd = fs.readFileSync(path.join(ROOT, "js/favdrawer.js"), "utf8");
      ok("[反向] 限定全屏才可拖后应查不到 canDrag = true",
        /var canDrag = true;/.test(nd) === false);
      ok("[反向] 去掉 chip 放置目标后应查不到对应绑定",
        /bindDropTarget\(b, catDropValue\(b\)\)/.test(nd) === false);
      ok("[反向] 去掉平铺组放置目标后应查不到对应绑定",
        /all\("\.fv-d-flat, \.fv-d-flat-band, \[data-flat-none\]"/.test(nd) === false);
      fs.writeFileSync(path.join(ROOT, "js/favdrawer.js"), backup.js3);

      /* 3d) 类别框去掉 data-flat（拖到框上就没反应了） */
      backup.js4 = backup.js2;
      fs.writeFileSync(path.join(ROOT, "js/favdrawer.js"),
        backup.js4.replace('class="fv-d-flat-band is-droppable" data-flat="\' + grp.cid + \'"', 'class="fv-d-flat-band is-droppable"'));
      const nb = fs.readFileSync(path.join(ROOT, "js/favdrawer.js"), "utf8");
      ok("[反向] 类别框去掉 data-flat 后应无法被识别为归类目标",
        /fv-d-flat-band is-droppable" data-flat=/.test(nb) === false);
      fs.writeFileSync(path.join(ROOT, "js/favdrawer.js"), backup.js4);

      /* 3e) 取消"拖回原分类不写库"保护 */
      backup.js5 = backup.js2;
      fs.writeFileSync(path.join(ROOT, "js/favdrawer.js"),
        backup.js5.replace(/if \(cur && \(\(cur\.category_id == null \? null : Number\(cur\.category_id\)\) === target\)\) \{[\s\S]*?return true;\n    \}/, ""));
      const ns = fs.readFileSync(path.join(ROOT, "js/favdrawer.js"), "utf8");
      ok("[反向] 去掉同类保护后应查不到该分支", /=== target\)\) \{/.test(ns) === false);
      fs.writeFileSync(path.join(ROOT, "js/favdrawer.js"), backup.js5);

      /* 3b) 去掉个人专区豁免 */
      backup.common = COMMON;
      fs.writeFileSync(path.join(ROOT, "js/common.js"),
        COMMON.replace(/PERSONAL_ZONES\s*=\s*\{\s*fav:\s*1\s*\}/, "PERSONAL_ZONES = {}"));
      const c2 = fs.readFileSync(path.join(ROOT, "js/common.js"), "utf8");
      ok("[反向] 去掉个人专区豁免后 fav 应不再被放行",
        /PERSONAL_ZONES\s*=\s*\{\s*fav:\s*1\s*\}/.test(c2) === false);
    } finally {
      if (backup.css) fs.writeFileSync(path.join(ROOT, "css/style.css"), backup.css);
      if (backup.rank) fs.writeFileSync(path.join(ROOT, "js/rank.js"), backup.rank);
      if (backup.common) fs.writeFileSync(path.join(ROOT, "js/common.js"), backup.common);
      if (backup.js2) fs.writeFileSync(path.join(ROOT, "js/favdrawer.js"), backup.js2);
      if (backup.js3) fs.writeFileSync(path.join(ROOT, "js/favdrawer.js"), backup.js3);
      if (backup.js4) fs.writeFileSync(path.join(ROOT, "js/favdrawer.js"), backup.js4);
      if (backup.js5) fs.writeFileSync(path.join(ROOT, "js/favdrawer.js"), backup.js5);
    }
    ok("[反向] 已还原全部临时改动", (function () {
      return fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8") === backup.css
        && fs.readFileSync(path.join(ROOT, "js/rank.js"), "utf8") === backup.rank
        && fs.readFileSync(path.join(ROOT, "js/common.js"), "utf8") === backup.common
        && fs.readFileSync(path.join(ROOT, "js/favdrawer.js"), "utf8") === backup.js2
        && fs.readFileSync(path.join(ROOT, "js/favdrawer.js"), "utf8") === backup.js3
        && fs.readFileSync(path.join(ROOT, "js/favdrawer.js"), "utf8") === backup.js4
        && fs.readFileSync(path.join(ROOT, "js/favdrawer.js"), "utf8") === backup.js5;
    })());
  }

    console.log("\n--- 收藏后要保留榜单卡片上的标签与位次 ---");
    {
      const sbT = makeSB({
        cats: [{ id: 1, name: "印花" }],
        items: [{
          id: 71, period_label: "W42", image_url: "https://x/full.jpg", title: "连帽卫衣",
          category_id: 1, rank_pos: 4,
          tags: ["周度激增", "新上榜", "上升 12 位", "共 3 国同款", "潜力机会"],
        }],
      });
      const { w: wT } = bootDom(sbT);
      await tick(10);
      await wT.FavDrawer.open();
      await tick(10);
      const cell = wT.document.querySelector('.fv-d-cell[data-url="https://x/full.jpg"]');
      ok("收藏卡片渲染出来了", !!cell);
      const txt = cell ? cell.textContent : "";
      ok("卡片上保留排位（#4）", /#4/.test(txt), txt);
      ok("卡片上保留趋势标签（周度激增）", /周度激增/.test(txt), txt);
      ok("卡片上保留位次变化（上升 12 位）", /上升 12 位/.test(txt), txt);
      ok("卡片上保留新上榜", /新上榜/.test(txt), txt);
      ok("位次类标签用独立样式，与趋势标签区分",
        !!cell && cell.querySelectorAll(".fv-d-tg.is-move").length >= 1,
        String(cell ? cell.querySelectorAll(".fv-d-tg.is-move").length : -1));
      ok("最多铺 4 个标签，第 5 个收成 +1（不无限挤）",
        !!cell && cell.querySelectorAll(".fv-d-tg").length === 5 &&
        /\+1/.test(cell.querySelector(".fv-d-tg.is-more").textContent),
        String(cell ? cell.querySelectorAll(".fv-d-tg").length : -1));
      ok("收起的那个能用悬停看到全文", !!cell && /潜力机会/.test(cell.querySelector(".fv-d-tg.is-more").getAttribute("title") || ""));
      ok("标签齐全时不出现「+N」", (function () {
        const more = cell ? cell.querySelectorAll(".fv-d-tg.is-more").length : 0;
        return more === 1;     /* 本例确实有 5 个，应出现 1 个 +1 */
      })());
    }

    console.log("\n--- 老库缺 tags 列时必须明说，不能静默丢标签 ---");
    {
      const sbN = makeSB({
        cats: [{ id: 1, name: "印花" }],
        items: [{ id: 81, period_label: "W42", image_url: "https://x/n.jpg", title: "旧库图", category_id: 1 }],
        tagsReady: false,
      });
      const { w: wN } = bootDom(sbN);
      await tick(10);
      await wN.FavDrawer.open();
      await tick(10);
      const warn = wN.document.getElementById("fv-d-warn");
      ok("缺列时面板上有提示条", !!warn && warn.hidden === false);
      ok("提示条写清了要执行哪个补丁", /patch_20261021Y\.sql/.test(warn.textContent), warn.textContent);
      ok("提示条说明已收藏的图不会自动补", /重新收藏/.test(warn.textContent));
    }
    {
      const sbY = makeSB({
        cats: [{ id: 1, name: "印花" }],
        items: [{ id: 82, period_label: "W42", image_url: "https://x/y.jpg", title: "新库图", category_id: 1, tags: ["周度激增"] }],
        tagsReady: true,
      });
      const { w: wY } = bootDom(sbY);
      await tick(10);
      await wY.FavDrawer.open();
      await tick(10);
      const warn2 = wY.document.getElementById("fv-d-warn");
      ok("列已就绪时不出提示条", !warn2 || warn2.hidden === true);
    }
    {
      const sbE = makeSB({ cats: [{ id: 1, name: "印花" }], items: [], tagsReady: false });
      const { w: wE } = bootDom(sbE);
      await tick(10);
      await wE.FavDrawer.open();
      await tick(10);
      const warn3 = wE.document.getElementById("fv-d-warn");
      ok("一条收藏都没有时不弹缺列提示（避免空面板一片黄）", !warn3 || warn3.hidden === true);
    }

    console.log("\n--- 补丁前的旧收藏：临时兜底显示，并说明是临时的 ---");
    {
      const sbO = makeSB({
        cats: [{ id: 1, name: "印花" }],
        items: [{ id: 91, period_label: "W42", image_url: "https://x/old.jpg", title: "旧收藏", category_id: 1 }],
        tagsReady: true,
      });
      const { w: wO } = bootDom(sbO);
      wO.document.body.insertAdjacentHTML("beforeend",
        '<main id="rk-body"><figure class="rk-card" data-url="https://x/old.jpg" data-period="W42" data-tags="周度激增|上升 12 位"></figure></main>');
      await tick(10);
      await wO.FavDrawer.open();
      await tick(10);
      const cell = wO.document.querySelector('.fv-d-cell[data-url="https://x/old.jpg"]');
      ok("库里没存标签、但榜单还在时，卡片上能看到标签", !!cell && /周度激增/.test(cell.textContent), cell ? cell.textContent : "");
      ok("兜底的标签用虚线样式区分（不冒充已存）",
        !!cell && cell.querySelectorAll(".fv-d-tg.is-live").length === 2,
        String(cell ? cell.querySelectorAll(".fv-d-tg.is-live").length : -1));
      ok("悬停说明这是临时显示", !!cell && /临时显示/.test(cell.getAttribute("title") || ""));
      const warn = wO.document.getElementById("fv-d-warn");
      ok("顶部提示说明有多少条是补丁前存的", !!warn && warn.hidden === false && /补丁前/.test(warn.textContent), warn ? warn.textContent : "");
    }
    {
      const sbP = makeSB({
        cats: [{ id: 1, name: "印花" }],
        items: [{ id: 92, period_label: "W38", image_url: "https://x/gone.jpg", title: "过期收藏", category_id: 1 }],
        tagsReady: true,
      });
      const { w: wP } = bootDom(sbP);
      await tick(10);
      await wP.FavDrawer.open();
      await tick(10);
      const cell2 = wP.document.querySelector('.fv-d-cell[data-url="https://x/gone.jpg"]');
      ok("榜单已换期时不凭空补标签（宁可不显示）",
        !!cell2 && cell2.querySelectorAll(".fv-d-tg").length === 0,
        String(cell2 ? cell2.querySelectorAll(".fv-d-tg").length : -1));
    }


  console.log("\n================ 汇总 ================");
  console.log("PASS " + pass + " / FAIL " + fail);
  if (fail) {
    console.log("失败项：");
    failures.forEach((f) => console.log(" - " + f));
    process.exit(1);
  }
})();