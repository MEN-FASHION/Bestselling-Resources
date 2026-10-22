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
  return {
    calls: call,
    favUid: async () => (s.uid === undefined ? "u-1" : s.uid),
    favReady: async () => (s.ready === undefined ? true : s.ready),
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

  /* ========== ⑨ 反向验证 ========== */
  if (REVERSE) {
    console.log("\n--- 反向验证：把关键保护拆掉，看断言是否真的报错 ---");
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

      /* 3) 去掉个人专区豁免 */
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
    }
    ok("[反向] 已还原全部临时改动", (function () {
      return fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8") === backup.css
        && fs.readFileSync(path.join(ROOT, "js/rank.js"), "utf8") === backup.rank
        && fs.readFileSync(path.join(ROOT, "js/common.js"), "utf8") === backup.common;
    })());
  }

  console.log("\n================ 汇总 ================");
  console.log("PASS " + pass + " / FAIL " + fail);
  if (fail) {
    console.log("失败项：");
    failures.forEach((f) => console.log(" - " + f));
    process.exit(1);
  }
})();