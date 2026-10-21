/* 趋势上升榜 ·「榜单打标」作业台验证套件
 *
 * 目的：这个面板最容易出错的地方不是界面，而是「标打上了但没存住」和
 *       「批量套用后撤不回来」—— 这两种错在页面上看不出来，只有下次打开才发现。
 * 所以本套件不查字符串，而是：
 *   1) 用真实的 admin.html DOM 加载真实脚本；
 *   2) 用一个假的数据库（内存表）承接读写，逐条核对写进去的内容与批次号；
 *   3) 用真实的键盘事件验证 1–9 落标签、→ 换图；
 *   4) 单独验证「表还没建」时不许写入、必须提示。
 *
 * 用法：node tools/verify_rank_tag.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; fails.push(name + (extra !== undefined ? " → " + extra : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 假数据库 ---------------- */
const URLS = [
  "https://cdn.example.com/a1.jpg",
  "https://cdn.example.com/a2.jpg",
  "https://cdn.example.com/a3.jpg",
];
function makeFakeDB(opt) {
  const o = opt || {};
  const store = {};
  const writes = [];
  const cleared = [];
  const db = {
    store, writes, cleared,
    ready: o.ready !== false,
    listTagDefs: async () => ([
      { type: "style", name: "连帽" }, { type: "style", name: "圆领" }, { type: "style", name: "廓形" },
      { type: "element", name: "刺绣" }, { type: "element", name: "字母印花" },
      { type: "scene", name: "室内" }, { type: "shoot", name: "模特实拍" }, { type: "skin", name: "浅" },
    ]),
    listActiveCats: async () => ["男装"],
    listUsedCats: async () => [],
    rankFacets: async () => ({ sites: ["美国"], periods: ["2026-W40", "2026-W41"], categories: ["男装"] }),
    rankTagReady: async () => db.ready,
    listRankTagQueue: async () => URLS.map((u, i) => ({
      image_url: u, category: "男装", leaf_category: "T恤", site: "美国",
      period_label: "2026-W41", periods: ["2026-W41"], rank_ratio: i + 1,
    })),
    listRankTagRows: async (urls) => {
      const out = {};
      (urls || []).forEach((u) => { if (store[u]) out[u] = Object.assign({}, store[u]); });
      return out;
    },
    saveRankTagRows: async (rows) => {
      writes.push(JSON.parse(JSON.stringify(rows || [])));
      (rows || []).forEach((r) => { store[r.image_url] = Object.assign({}, r); });
      return (rows || []).length;
    },
    clearRankTagBatch: async (bid) => {
      cleared.push(bid);
      Object.keys(store).forEach((u) => {
        if (store[u] && store[u].batch_id === bid) delete store[u];
      });
      return true;
    },
  };
  return db;
}

async function boot(dbOverride) {
  const html = read("admin.html");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://example.com/admin.html" });
  const { window } = dom;
  const db = dbOverride || makeFakeDB();
  window.SB = db;
  window.CONFIG = { CATEGORY_OPTIONS: ["男装"] };
  window.__toasts = [];
  window.sbToast = (m) => { window.__toasts.push(String(m || "")); };
  window.eval(read("js/admin-ranktag.js"));
  const card = window.document.getElementById("rank-tag-card");
  if (card) card.classList.remove("hidden");
  await window.RankTag.enter();
  await sleep(20);
  return { dom, window, db };
}

(async function run() {
  /* ============ 1. 接线：菜单 / 面板 / 脚本 / 权限 ============ */
  const adminHtml = read("admin.html");
  ok("后台菜单里有「榜单打标」入口", /class="nav-item"[^>]*data-target="rank-tag-card"/.test(adminHtml));
  ok("面板容器 #rank-tag-card 存在", adminHtml.indexOf('id="rank-tag-card"') > 0);
  ok("菜单项排在「趋势上升榜」之后", adminHtml.indexOf('data-target="rank-card"') < adminHtml.indexOf('data-target="rank-tag-card"'));
  ok("脚本已引入", /js\/admin-ranktag\.js/.test(adminHtml));
  ok("脚本在 admin-rank.js 之后加载", adminHtml.indexOf("js/admin-rank.js") < adminHtml.indexOf("js/admin-ranktag.js"));
  ok("脚本在 supabase.js 之后加载", adminHtml.indexOf("js/supabase.js") < adminHtml.indexOf("js/admin-ranktag.js"));

  const adminJs = read("js/admin.js");
  ok("面板已登记到 PANEL_ZONE", /"rank-tag-card"\s*:/.test(adminJs));
  ok("管理员可进入（在免专区白名单里）", /rank-tag-card/.test(adminJs) && /return true;/.test(adminJs));
  ok("切换面板时调用了 enterRankTagPanel", /enterRankTagPanel\(\)/.test(adminJs));

  /* ============ 2. 建表脚本 ============ */
  const sql = read("tools/patch_20261021Q.sql");
  ok("建表脚本存在且幂等（if not exists）", /create table if not exists public\.rank_image_tags/i.test(sql));
  ok("以图片地址为唯一键", /image_url\s+text primary key/i.test(sql));
  ok("五个视觉维度列齐全", ["style_tags", "element_tags", "scene_tags", "shoot_tags", "skin_tags"].every((c) => sql.indexOf(c) > 0));
  ok("带批次列（可整批回滚）", /batch_id\s+text/i.test(sql));
  ok("开启 RLS", /enable row level security/i.test(sql));
  ok("四条策略（读/增/改/删）", (sql.match(/create policy/g) || []).length === 4);
  ok("写权限限定管理员/超管", sql.indexOf("'admin', 'super_admin'") > 0);
  ok("不改动既有表（无 drop table / delete from）", !/drop\s+table|delete\s+from/i.test(sql));

  /* ============ 3. 数据层：周报读标签的列名 ============ */
  const sb = read("js/supabase.js");
  ok("周报标签查询优先按 url 列（图库真实列名）", /readBy\("url"/.test(sb));
  ok("兼容手工加过 image_url 列的老库（有回退）", /readBy\("image_url"/.test(sb));
  ok("提供榜单标签读取方法", /async listRankTagRows/.test(sb));
  ok("提供榜单标签保存方法", /async saveRankTagRows/.test(sb));
  ok("提供建表检测方法", /async rankTagReady/.test(sb));
  ok("提供按批次回滚方法", /async clearRankTagBatch/.test(sb));
  ok("周报改为读合并结果", /listImageTagsForReport/.test(sb));
  ok("合并逻辑里榜单标签优先", /Object\.keys\(rank\)/.test(sb) && /const pick = \(k\) =>/.test(sb));
  const rankJs = read("js/rank.js");
  ok("周报入口调用合并读取", /listImageTagsForReport/.test(rankJs));

  /* ============ 4. 加载与队列 ============ */
  let { window, db } = await boot();
  const doc = window.document;
  const st0 = window.RankTag.state();
  ok("载入队列成功", st0.all.length === 3, st0.all.length);
  ok("六维齐全", JSON.stringify(window.RankTag.dims()) === JSON.stringify(["style", "element", "scene", "shoot", "skin", "category"]), window.RankTag.dims().join(","));
  ok("首张大图已显示", (doc.getElementById("rt-photo").getAttribute("src") || "").indexOf("a1.jpg") > 0);
  ok("进度初始为 0", /已打 0/.test(doc.getElementById("rt-pg-count").textContent), doc.getElementById("rt-pg-count").textContent);
  ok("队列缩略图渲染 3 张", doc.querySelectorAll("#rt-queue .rt-thumb").length === 3);

  /* ============ 5. 点标签 → 落库（含批次号） ============ */
  window.RankTag.toggle("style", "连帽");
  await sleep(600);
  ok("点标签后写库一次", db.writes.length >= 1, db.writes.length);
  ok("写入内容含「连帽」", JSON.stringify(db.store[URLS[0]] || {}).indexOf("连帽") > 0);
  ok("写入带批次号", /^rt-/.test(String((db.store[URLS[0]] || {}).batch_id || "")), (db.store[URLS[0]] || {}).batch_id);
  ok("保存状态显示已保存", /已保存/.test(doc.getElementById("rt-meta").textContent));
  ok("进度更新为 1 张", /已打 1/.test(doc.getElementById("rt-pg-count").textContent), doc.getElementById("rt-pg-count").textContent);

  window.RankTag.toggle("style", "连帽");
  await sleep(600);
  ok("再点一次取消该标签", JSON.stringify(db.store[URLS[0]] || {}).indexOf("连帽") < 0);

  window.RankTag.toggle("style", "连帽");
  window.RankTag.toggle("style", "圆领");
  await sleep(600);
  const tags0 = (db.store[URLS[0]] || {}).style_tags || [];
  ok("多标签累加保留两个", tags0.length === 2 && tags0.indexOf("连帽") >= 0 && tags0.indexOf("圆领") >= 0, tags0.join("/"));

  window.RankTag.toggle("category", "男装");
  await sleep(600);
  ok("类目可打（单选）", (db.store[URLS[0]] || {}).category === "男装");
  window.RankTag.toggle("category", "男装");
  await sleep(600);
  ok("再点类目取消", !(db.store[URLS[0]] || {}).category);

  /* ============ 6. 键盘：1–9 与 → ============ */
  window.RankTag.go(-2);
  const idxBefore = window.RankTag.state().idx;
  ok("换图后位次合法（环状，不越界）", idxBefore >= 0 && idxBefore < 3, idxBefore);

  const doc2 = window.document;
  doc2.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "1", bubbles: true }));
  await sleep(600);
  const cur = window.RankTag.state();
  const curUrl = cur.list[cur.idx].image_url;
  const after = (db.store[curUrl] || {}).style_tags || [];
  ok("按 1 给当前维度打了第 1 个标签", after.indexOf("连帽") >= 0, after.join("/"));

  const beforeIdx = window.RankTag.state().idx;
  doc2.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  await sleep(30);
  ok("按 → 切到下一张", window.RankTag.state().idx === (beforeIdx + 1) % 3, window.RankTag.state().idx);

  /* ============ 7. 队列筛选 ============ */
  window.RankTag.setFilter({ scope: "undone" });
  await sleep(20);
  const undone = window.RankTag.state().list;
  ok("「只看未打标」剔除了已打标的图", undone.length < 3 && undone.every((x) => !((db.store[x.image_url] || {}).style_tags || []).length), undone.length);
  window.RankTag.setFilter({ scope: "done" });
  await sleep(20);
  ok("「只看已打标」只剩已打的", window.RankTag.state().list.length >= 1);
  window.RankTag.setFilter({ scope: "all" });
  await sleep(20);

  /* ============ 8. 批量套用 + 撤销 ============ */
  const db2 = makeFakeDB();
  const b2 = await boot(db2);
  const w2 = b2.window;
  w2.RankTag.toggle("style", "连帽");
  w2.RankTag.toggle("element", "刺绣");
  await sleep(600);
  ok("套用前只有 1 张有标签", Object.keys(db2.store).length === 1, Object.keys(db2.store).length);

  w2.sbConfirm = () => Promise.resolve(true);
  const applyBtn = w2.document.getElementById("rt-apply");
  applyBtn.dispatchEvent(new w2.MouseEvent("click", { bubbles: true }));
  await sleep(150);
  ok("批量套用把标签给到未打标的图", Object.keys(db2.store).length === 3, Object.keys(db2.store).length);
  const u2 = db2.store[URLS[1]] || {};
  ok("被套用的图拿到同款标签", (u2.style_tags || []).indexOf("连帽") >= 0 && (u2.element_tags || []).indexOf("刺绣") >= 0, JSON.stringify(u2));
  ok("被套用的图标了独立批次号", /-bulk-/.test(String(u2.batch_id || "")), u2.batch_id);
  ok("撤销按钮已出现", !w2.document.getElementById("rt-undo-bulk").classList.contains("hidden"));

  const undoBtn = w2.document.getElementById("rt-undo-bulk");
  undoBtn.dispatchEvent(new w2.MouseEvent("click", { bubbles: true }));
  await sleep(150);
  ok("撤销调用了按批次清理", db2.cleared.length === 1, db2.cleared.length);
  ok("撤销后被套用的图已清空", !db2.store[URLS[1]] && !db2.store[URLS[2]], Object.keys(db2.store).join(","));
  ok("撤销不影响源图（它不在该批次里）", !!db2.store[URLS[0]]);

  /* ============ 9. 表还没建：不允许写入，必须提示 ============ */
  const db3 = makeFakeDB({ ready: false });
  const b3 = await boot(db3);
  const w3 = b3.window;
  ok("缺表时显示建表提示", !w3.document.getElementById("rt-warn").classList.contains("hidden"));
  const warnText = w3.document.getElementById("rt-warn").textContent || "";
  ok("提示里指明了脚本名", warnText.indexOf("patch_20261021Q.sql") >= 0);
  w3.RankTag.toggle("style", "连帽");
  await sleep(600);
  ok("缺表时不发出任何写请求", db3.writes.length === 0, db3.writes.length);
  ok("缺表时明确告知用户「存不住」（不是静默失败）",
     (w3.__toasts || []).some((m) => /建表|存不住|表还没建好/.test(m)), (w3.__toasts || []).join(" | "));
  ok("缺表时不改动本地状态（避免用户误以为已打标）",
     !((w3.RankTag.state().tags || {})[URLS[0]] || {}).style_tags || ((w3.RankTag.state().tags || {})[URLS[0]] || {}).style_tags.length === 0,
     JSON.stringify((w3.RankTag.state().tags || {})[URLS[0]] || {}));

  /* ============ 10. 图打不开：不崩、给提示 ============ */
  const img = w3.document.getElementById("rt-photo");
  if (typeof img.onerror === "function") img.onerror();
  ok("图加载失败时给出可操作提示（不是白屏）", /打不开|防盗链/.test(w3.document.getElementById("rt-photo-empty").textContent));

  /* ============ 11. 不与图库打标混用 ============ */
  const rtSrc = read("js/admin-ranktag.js");
  ok("榜单打标不写图库 images 表", rtSrc.indexOf('from("images")') < 0);
  ok("榜单打标写独立表", /saveRankTagRows/.test(rtSrc));
  ok("面板页面上写明与图片管理完全独立", /完全独立/.test(adminHtml));
  const noComment = rtSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  ok("未引入任何图像识别/外部模型调用", !/fetch\(|openai|apiKey|anthropic/i.test(noComment));

  /* ============ 输出 ============ */
  if (fail) {
    console.log("FAIL " + fail + " / PASS " + pass);
    fails.forEach((f) => console.log("  ✗ " + f));
    process.exit(1);
  }
  console.log("PASS " + pass + " / FAIL 0");
})().catch((e) => {
  console.log("EXCEPTION " + (e && e.message));
  process.exit(1);
});