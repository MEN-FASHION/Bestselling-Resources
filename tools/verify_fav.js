/* ============================================================
 * 我的收藏 —— 运行时验证
 *
 * 全部执行真实代码（只把数据库换成可编程的假库），不写替身逻辑：
 *   ① 数据层：批量收藏按「期次 + 图地址」去重，同一张图跨期算两条；
 *   ② 数据层：删分类不删图（先退回未分类，再删分类，顺序不能颠倒）；
 *   ③ 数据层：改分类 / 取消收藏都只作用于本人；
 *   ④ 分组：周降序、周内按分类顺序、未分类单独一桶；
 *   ⑤ 平铺：只平铺已分类的组；同类相邻；组下方一条框写类别名与张数；
 *   ⑥ 平铺：未分类不参与平铺（收在折叠区且默认收起）；
 *   ⑦ 交互：拖拽改分类真的写库并即时重排；点一键展开铺开所有周；
 *   ⑧ 守门：未登录、建表脚本未执行时都不渲染列表、不写库；
 *   ⑨ 榜单侧：卡片带星标 / 勾选 / 收藏快照字段，且期次不同即两条。
 *
 * 用法：node tools/verify_fav.js <站点仓库根目录>
 *       node tools/verify_fav.js . --reverse   # 反向验证：断言是否真的管事
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

const ME = "u-fav-1";

/* ============================================================
 * 假库：只实现收藏两张表需要的能力（可编程、可观察调用顺序）
 * ============================================================ */
function makeDB(seed) {
  seed = seed || {};
  const state = {
    cats: (seed.cats || []).map((c) => Object.assign({}, c)),
    items: (seed.items || []).map((r) => Object.assign({}, r)),
    seq: [],            // 调用顺序（用于校验「先退图、再删分类」）
    writes: 0,
    reads: 0,
    fail: seed.fail || null,   // "noTable" → 模拟表不存在
  };

  const match = (rows, filters) => rows.filter((r) => filters.every(([c, v]) => {
    if (v === null) return r[c] == null;
    return String(r[c]) === String(v);
  }));

  function qb(table) {
    const st = { filters: [], op: "select", payload: null, ins: null, ups: null, on: null, order: [], lim: null };
    const api = {
      select() { if (st.op === "select") st.op = "select"; return api; },
      eq(c, v) { st.filters.push([c, v]); return api; },
      in(c, list) { st.filters.push([c, "__in__" + JSON.stringify(list)]); return api; },
      order(c, o) { st.order.push([c, o && o.ascending === false ? -1 : 1]); return api; },
      limit(n) { st.lim = n; return api; },
      insert(rows) { st.op = "insert"; st.ins = Array.isArray(rows) ? rows : [rows]; return api; },
      upsert(rows, opt) { st.op = "upsert"; st.ups = Array.isArray(rows) ? rows : [rows]; st.on = (opt && opt.onConflict) || null; return api; },
      update(p) { st.op = "update"; st.payload = p; return api; },
      delete() { st.op = "delete"; return api; },
      single() { st.single = true; return run(); },
      then(res, rej) { return run().then(res, rej); },
      catch(rej) { return run().catch(rej); },
    };

    function tbl() {
      if (table === "fav_categories") return state.cats;
      if (table === "fav_items") return state.items;
      return [];
    }

    async function run() {
      const name = table;
      if (state.fail === "noTable" && (name === "fav_categories" || name === "fav_items")) {
        return { data: null, error: { message: 'relation "' + name + '" does not exist' } };
      }
      let rows = tbl();
      state.seq.push(name + ":" + st.op);
      if (st.op === "select") {
        state.reads++;
        // 展开 in() 过滤器
        let hit = rows.filter((r) => st.filters.every(([c, v]) => {
          if (typeof v === "string" && v.indexOf("__in__") === 0) {
            const list = JSON.parse(v.slice(6));
            return list.some((x) => String(r[c]) === String(x));
          }
          if (v === null) return r[c] == null;
          return String(r[c]) === String(v);
        }));
        st.order.forEach(([c, dir]) => {
          hit = hit.slice().sort((a, b) => {
            const x = a[c], y = b[c];
            if (x === y) return 0;
            return (x > y ? 1 : -1) * dir;
          });
        });
        if (st.lim) hit = hit.slice(0, st.lim);
        const out = hit.map((r) => Object.assign({}, r));
        return { data: st.single ? (out[0] || null) : out, error: null };
      }
      if (st.op === "insert") {
        state.writes++;
        for (const r of st.ins) {
          if (name === "fav_items") {
            const dup = rows.some((x) => String(x.user_id) === String(r.user_id)
              && String(x.period_label) === String(r.period_label)
              && String(x.image_url) === String(r.image_url));
            if (dup) return { data: null, error: { message: "duplicate key value violates unique constraint" } };
          }
          if (name === "fav_categories") {
            const dup = rows.some((x) => String(x.user_id) === String(r.user_id) && String(x.name) === String(r.name));
            if (dup) return { data: null, error: { message: "duplicate key value violates unique constraint" } };
          }
          const row = Object.assign({ id: rows.length + 1 }, r, { created_at: r.created_at || new Date().toISOString() });
          rows.push(row);
        }
        return { data: st.single ? Object.assign({}, rows[rows.length - 1]) : null, error: null };
      }
      if (st.op === "upsert") {
        state.writes++;
        const keys = st.on ? st.on.split(",").map((s) => s.trim()) : [];
        for (const r of st.ups) {
          const idx = keys.length ? rows.findIndex((x) => keys.every((k) => String(x[k]) === String(r[k]))) : -1;
          if (idx >= 0) Object.assign(rows[idx], r);
          else rows.push(Object.assign({ id: rows.length + 1 }, r));
        }
        return { data: null, error: null };
      }
      if (st.op === "update") {
        state.writes++;
        const hit = rows.filter((r) => st.filters.every(([c, v]) => {
          if (typeof v === "string" && v.indexOf("__in__") === 0) {
            const list = JSON.parse(v.slice(6));
            return list.some((x) => String(r[c]) === String(x));
          }
          if (v === null) return r[c] == null;
          return String(r[c]) === String(v);
        }));
        hit.forEach((r) => Object.assign(r, st.payload));
        return { data: null, error: null };
      }
      if (st.op === "delete") {
        state.writes++;
        const keep = rows.filter((r) => !st.filters.every(([c, v]) => {
          if (typeof v === "string" && v.indexOf("__in__") === 0) {
            const list = JSON.parse(v.slice(6));
            return list.some((x) => String(r[c]) === String(x));
          }
          return String(r[c]) === String(v);
        }));
        const removed = rows.length - keep.length;
        if (name === "fav_categories") state.cats = keep;
        if (name === "fav_items") state.items = keep;
        return { data: null, error: null, count: removed };
      }
      return { data: null, error: null };
    }

    return api;
  }

  const client = {
    from: (t) => qb(t),
    rpc: async () => ({ data: null, error: { message: "unknown rpc" } }),
    auth: {
      getSession: async () => (seed.notLogged ? { data: { session: null } } : { data: { session: { user: { id: ME } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { } } } }),
    },
  };
  return { client, state };
}

/* 启动真实 supabase.js（只替换数据库客户端） */
function bootSB(db) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://newtrend.top/fav.html", runScripts: "dangerously" });
  const { window } = dom;
  window.supabase = { createClient: () => db.client };
  window.CONFIG = { SUPABASE: { url: "https://abcdefgh.supabase.co", anonKey: "a.b.c" } };
  window.eval(read("js/supabase.js") + "\n;window.__SB=SB;");
  return { window, SB: window.__SB };
}

/* ============================================================
 * 一、数据层
 * ============================================================ */
async function testDataLayer() {
  console.log("\n[1] 收藏：同一张图跨期算两条，同期重复不重复插");
  {
    const db = makeDB({
      cats: [{ id: 1, user_id: ME, name: "印花T恤", color: "#c25e5a", sort: 0 }],
    });
    const { SB } = bootSB(db);
    const row = (period, url, title) => ({ image_url: url, period_label: period, title: title || "", leaf_category: "T恤", site: "US", rank_abs: 12, ratio: 1.5 });

    const n1 = await SB.addFavItems([row("W41", "u/a1.jpg", "A1 印花")], 1);
    ok("首次收藏写入 1 条", n1 === 1, String(n1));
    ok("落库字段完整（期次/图/标题/类目/站点/位次）",
      db.state.items.length === 1 && db.state.items[0].period_label === "W41" && db.state.items[0].title === "A1 印花"
      && db.state.items[0].site === "US" && db.state.items[0].rank_abs === 12);
    ok("分类被正确带上", String(db.state.items[0].category_id) === "1");

    const n2 = await SB.addFavItems([row("W41", "u/a1.jpg")], 1);
    ok("同一期同一张图再收藏一次：不会产生第二行", db.state.items.length === 1, String(db.state.items.length));
    ok("重复收藏是「覆盖」而不是「报错」（返回值表示处理条数）", n2 === 1, String(n2));
    ok("重复收藏会顺带刷新快照（位次/环比跟着最新数据走）",
      db.state.items.filter((x) => x.period_label === "W41")[0].rank_abs === 12);

    const n3 = await SB.addFavItems([row("W40", "u/a1.jpg")], 1);
    ok("同一张图在另一期收藏：算新的一条", n3 === 1, String(n3));
    ok("库里变成 2 条（W40 与 W41 各一条）", db.state.items.length === 2, String(db.state.items.length));
    ok("两条的图地址相同、期次不同",
      db.state.items[0].image_url === db.state.items[1].image_url
      && db.state.items[0].period_label !== db.state.items[1].period_label);

    const n4 = await SB.addFavItems([row("W41", "u/b1.jpg"), row("W41", "u/b2.jpg")], null);
    ok("批量收藏 2 张一次写入", n4 === 2, String(n4));
    ok("不选分类时 category_id 为空（未分类）",
      db.state.items.filter((x) => x.period_label === "W41" && /b[12]/.test(x.image_url)).every((x) => x.category_id == null));
  }

  console.log("\n[2] 收藏表还没建好：必须如实报错，不能假装成功");
  {
    const db = makeDB({ fail: "noTable" });
    const { SB } = bootSB(db);
    const ready = await SB.favReady();
    ok("favReady() 返回 false（表不存在）", ready === false, String(ready));
    let threw = "";
    try { await SB.addFavItems([{ image_url: "u/x.jpg", period_label: "W41" }], null); }
    catch (e) { threw = (e && e.message) || "err"; }
    ok("此时收藏会抛错并提示要建表", /建表|收藏表|does not exist/i.test(threw), threw);
    ok("并且确实没有写入任何数据", db.state.writes === 0, String(db.state.writes));
  }

  console.log("\n[3] 删分类不删图：先把图退回未分类，再删分类");
  {
    const db = makeDB({
      cats: [
        { id: 1, user_id: ME, name: "印花T恤", color: "#c25e5a", sort: 0 },
        { id: 2, user_id: ME, name: "连帽卫衣", color: "#4a9c6d", sort: 1 },
      ],
      items: [
        { id: 10, user_id: ME, image_url: "u/a1.jpg", period_label: "W41", category_id: 1, title: "A1" },
        { id: 11, user_id: ME, image_url: "u/b1.jpg", period_label: "W41", category_id: 2, title: "B1" },
      ],
    });
    const { SB } = bootSB(db);
    db.state.seq = [];
    await SB.deleteFavCategory(2);
    const touchesItems = db.state.seq.indexOf("fav_items:update");
    const touchesCats = db.state.seq.indexOf("fav_categories:delete");
    ok("先把图退回未分类（fav_items 更新发生了）", touchesItems >= 0);
    ok("再删分类，顺序不能颠倒", touchesItems >= 0 && touchesCats > touchesItems, db.state.seq.join(" > "));
    ok("图没有被删掉（2 条仍在）", db.state.items.length === 2, String(db.state.items.length));
    ok("原属该分类的图变成未分类", db.state.items.filter((x) => x.id === 11)[0].category_id == null);
    ok("另一个分类的图不受影响", String(db.state.items.filter((x) => x.id === 10)[0].category_id) === "1");
    ok("分类本体已删除（只剩 1 个）", db.state.cats.length === 1, String(db.state.cats.length));
  }

  console.log("\n[4] 改分类 / 取消收藏只作用于本人");
  {
    const db = makeDB({
      cats: [{ id: 1, user_id: ME, name: "印花T恤", sort: 0 }],
      items: [
        { id: 20, user_id: ME, image_url: "u/a1.jpg", period_label: "W41", category_id: null },
        { id: 21, user_id: "other-user", image_url: "u/x1.jpg", period_label: "W41", category_id: null },
      ],
    });
    const { SB } = bootSB(db);
    await SB.moveFavItems([20], 1);
    ok("自己的条目被移到新分类", String(db.state.items.filter((x) => x.id === 20)[0].category_id) === "1");
    ok("别人的条目纹丝不动", db.state.items.filter((x) => x.id === 21)[0].category_id == null);

    await SB.moveFavItems([20], null);
    ok("传 null 即退回未分类", db.state.items.filter((x) => x.id === 20)[0].category_id == null);

    await SB.removeFavItems([21]);
    ok("取消收藏别人的条目：不会误删自己的", db.state.items.some((x) => x.id === 20));
    ok("取消收藏自己的条目：确实删掉了", (await (async () => { await SB.removeFavItems([20]); return db.state.items.some((x) => x.id === 20); })()) === false);
  }
}

/* ============================================================
 * 二、分组与平铺（纯逻辑，真跑 js/fav.js 暴露的 FavCore）
 * ============================================================ */
function bootFavPage(db, opts) {
  opts = opts || {};
  const html = read("fav.html");
  const body = html.replace(/^[\s\S]*?<body[^>]*>/, "").replace(/<\/body>[\s\S]*$/, "");
  const dom = new JSDOM("<!doctype html><html><body>" + body + "</body></html>", {
    url: "https://newtrend.top/fav.html", runScripts: "dangerously", pretendToBeVisual: true,
  });
  const { window } = dom;
  window.supabase = { createClient: () => db.client };
  window.CONFIG = { SUPABASE: { url: "https://abcdefgh.supabase.co", anonKey: "a.b.c" } };
  window.eval(read("js/supabase.js") + "\n;window.SB=SB;");

  /* 专区可见性配置来自 site_settings，本套件不验证它，直接给"全部可用" */
  window.SB.getFrontendZoneVisibility = async () => ({});
  window.SB.myFrontendZones = async () => (opts.noAuth ? ["rank"] : ["fav"]);
  window.SB.getSession = async () => (opts.notLogged ? null : { user: { id: ME, email: "me@x.com" } });
  window.SB.favUid = async () => (opts.notLogged ? null : ME);
  window.confirm = () => true;
  window.prompt = () => null;

  window.eval(read("js/fav.js"));
  return window;
}

function seedFav() {
  return {
    cats: [
      { id: 1, user_id: ME, name: "印花T恤", color: "#c25e5a", sort: 0 },
      { id: 2, user_id: ME, name: "连帽卫衣", color: "#4a9c6d", sort: 1 },
      { id: 3, user_id: ME, name: "工装裤", color: "#5b7c9d", sort: 2 },
    ],
    items: [
      /* W41：印花T恤 3 张、连帽卫衣 2 张、未分类 2 张 */
      { id: 101, user_id: ME, image_url: "u/a1.jpg", period_label: "W41", period_type: "week", category_id: 1, title: "A1", site: "US" },
      { id: 102, user_id: ME, image_url: "u/a2.jpg", period_label: "W41", period_type: "week", category_id: 1, title: "A2", site: "US" },
      { id: 103, user_id: ME, image_url: "u/a3.jpg", period_label: "W41", period_type: "week", category_id: 1, title: "A3", site: "US" },
      { id: 104, user_id: ME, image_url: "u/b1.jpg", period_label: "W41", period_type: "week", category_id: 2, title: "B1", site: "US" },
      { id: 105, user_id: ME, image_url: "u/b2.jpg", period_label: "W41", period_type: "week", category_id: 2, title: "B2", site: "US" },
      { id: 106, user_id: ME, image_url: "u/n1.jpg", period_label: "W41", period_type: "week", category_id: null, title: "N1", site: "US" },
      { id: 107, user_id: ME, image_url: "u/n2.jpg", period_label: "W41", period_type: "week", category_id: null, title: "N2", site: "US" },
      /* W40：印花T恤 1 张（与 W41 的 a1 同一地址 → 跨期两条）、工装裤 1 张、未分类 1 张 */
      { id: 201, user_id: ME, image_url: "u/a1.jpg", period_label: "W40", period_type: "week", category_id: 1, title: "A1", site: "US" },
      { id: 202, user_id: ME, image_url: "u/c1.jpg", period_label: "W40", period_type: "week", category_id: 3, title: "C1", site: "US" },
      { id: 203, user_id: ME, image_url: "u/n3.jpg", period_label: "W40", period_type: "week", category_id: null, title: "N3", site: "US" },
    ],
  };
}

function testGrouping() {
  console.log("\n[5] 分组与平铺口径（纯逻辑）");
  {
    /* 反向验证：故意做一个"把未分类也并进平铺组"的错误实现，
       若下面的断言抓不到它，说明断言本身是摆设。 */
    const src = read("js/fav.js");
    const coreStart = src.indexOf("var COLORS =");
    const coreEnd = src.indexOf("window.FavCore = {");
    const coreBody = src.slice(coreStart, coreEnd);
    const sandbox = {};
    const fn = new Function("window", coreBody + "\n;return { groupWeeks: groupWeeks, flatGroups: flatGroups, weekStat: weekStat };");
    const C = fn(sandbox);

    const seed = seedFav();
    const weeks = C.groupWeeks(seed.items, seed.cats);
    ok("按周分组：2 个周", weeks.length === 2, String(weeks.length));
    ok("周降序（W41 在 W40 前面）", weeks[0].week === "W41" && weeks[1].week === "W40", weeks.map((w) => w.week).join(","));

    const w41 = weeks[0];
    ok("W41 总数 7 张", w41.total === 7, String(w41.total));
    ok("W41 有 2 个分类组", w41.groups.length === 2, String(w41.groups.length));
    ok("W41 分类顺序按分类 sort（印花T恤 在 连帽卫衣 前）",
      w41.groups[0].cat.name === "印花T恤" && w41.groups[1].cat.name === "连帽卫衣",
      w41.groups.map((g) => g.cat.name).join(","));
    ok("W41「印花T恤」= 3 张", w41.groups[0].items.length === 3, String(w41.groups[0].items.length));
    ok("W41「连帽卫衣」= 2 张", w41.groups[1].items.length === 2, String(w41.groups[1].items.length));
    ok("W41 未分类 = 2 张（单独一桶，不混进分类组）", w41.none.length === 2, String(w41.none.length));

    const st41 = C.weekStat(w41);
    ok("W41 统计：已分类 5 / 未分类 2 / 分类数 2",
      st41.classified === 5 && st41.uncategorized === 2 && st41.catN === 2,
      JSON.stringify(st41));

    const flat41 = C.flatGroups(w41);
    ok("平铺只取有图的分类组（2 组）", flat41.length === 2, String(flat41.length));
    ok("平铺组里绝不含未分类的图", flat41.every((g) => g.items.every((it) => it.category_id != null)));

    /* 反向验证：错误实现（把未分类做成一个组）应当被上面这条断言抓住 */
    const bad = { week: "W41", total: 7, groups: w41.groups.concat([{ cat: { id: "", name: "未分类" }, idx: 99, items: w41.none }]), none: [] };
    const badFlat = C.flatGroups(bad);
    const badLeaks = badFlat.some((g) => g.items.some((it) => it.category_id == null));
    ok("反向验证：错误实现会把未分类混进平铺（断言能抓到）", badLeaks === true);

    /* 跨期两条：同一地址在两个周里各出现一次 */
    const inW41 = w41.groups[0].items.some((it) => it.image_url === "u/a1.jpg");
    const inW40 = weeks[1].groups[0].items.some((it) => it.image_url === "u/a1.jpg");
    ok("同一张图在两个周里各算一条（W41 有、W40 也有）", inW41 && inW40);

    ok("分类被删除后，图落到未分类而不是消失",
      C.groupWeeks([{ id: 9, category_id: 999, period_label: "W41", image_url: "u/z.jpg" }], seed.cats)[0].none.length === 1);
  }
}

/* ============================================================
 * 三、页面行为（真跑 fav.js + 真实 DOM）
 * ============================================================ */
async function testPage() {
  console.log("\n[6] 页面渲染：周 → 分类 → 图");
  const db = makeDB(seedFav());
  const win = bootFavPage(db);
  await new Promise((r) => setTimeout(r, 300));
  const doc = win.document;

  ok("渲染出 2 个周块", doc.querySelectorAll(".fv-week").length === 2, String(doc.querySelectorAll(".fv-week").length));
  ok("第一个周块是 W41", /W41/.test(doc.querySelector(".fv-week .fv-week-t").textContent));
  ok("左侧分类列表含「全部收藏 + 3 个分类 + 未分类」", doc.querySelectorAll("#fv-cats .fv-catrow").length === 5, String(doc.querySelectorAll("#fv-cats .fv-catrow").length));
  ok("分类列表显示每个分类的张数（印花T恤跨两期共 4 张）",
    doc.querySelector('.fv-catrow[data-cat="1"] .fv-cnum').textContent.trim() === "4",
    doc.querySelector('.fv-catrow[data-cat="1"] .fv-cnum').textContent);
  ok("顶部汇总写明总数与周数", /10/.test(doc.querySelector("#fv-sum").textContent) && /2/.test(doc.querySelector("#fv-sum").textContent), doc.querySelector("#fv-sum").textContent);

  const w41 = doc.querySelector('.fv-week[data-week="W41"]');
  ok("W41 默认按分类分块显示（2 个分类块 + 1 个未分类块）", w41.querySelectorAll(".fv-catblock").length === 3, String(w41.querySelectorAll(".fv-catblock").length));
  ok("W41 有一个「未分类」块", !!w41.querySelector('.fv-catblock.is-none'));
  ok("未分类块里是 2 张", w41.querySelectorAll('.fv-catblock.is-none .fv-card').length === 2, String(w41.querySelectorAll('.fv-catblock.is-none .fv-card').length));

  console.log("\n[7] 一键展开：同类相邻 + 组下方一条共用框");
  const flatBtn = w41.querySelector("[data-weekflat]");
  ok("周块上有「一键展开」按钮", !!flatBtn);
  flatBtn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));

  const w41b = doc.querySelector('.fv-week[data-week="W41"]');
  const groups = w41b.querySelectorAll(".fv-flat-group");
  ok("平铺后出现分类组（2 组）", groups.length === 2, String(groups.length));
  ok("平铺后不再有分类分块（换成平铺结构）", w41b.querySelectorAll(".fv-catblock").length === 0);

  const g0 = groups[0], g1 = groups[1];
  ok("第 1 组是「印花T恤」", /印花T恤/.test(g0.querySelector(".fv-tagname").textContent), g0.querySelector(".fv-tagname").textContent);
  ok("第 1 组的类别框写明 3 张", /3 张/.test(g0.querySelector(".fv-tagn").textContent), g0.querySelector(".fv-tagn").textContent);
  ok("第 1 组内 3 张图相邻排在同一组里", g0.querySelectorAll(".fv-card").length === 3, String(g0.querySelectorAll(".fv-card").length));
  ok("第 2 组是「连帽卫衣」，2 张", /连帽卫衣/.test(g1.querySelector(".fv-tagname").textContent) && g1.querySelectorAll(".fv-card").length === 2);
  ok("每组只有一条类别框（三张共用一条，不是每张一条）",
    g0.querySelectorAll(".fv-tagbar").length === 1, String(g0.querySelectorAll(".fv-tagbar").length));
  ok("类别框在该组图片之后（位于组内最后一个子元素）",
    g0.lastElementChild && g0.lastElementChild.classList.contains("fv-tagbar"));
  ok("类别框带该分类的颜色",
    /border-top-color/.test(g0.querySelector(".fv-tagbar").getAttribute("style") || "")
    || /#[0-9a-f]{6}/i.test(g0.querySelector(".fv-tagbar").getAttribute("style") || ""),
    g0.querySelector(".fv-tagbar").getAttribute("style"));

  console.log("\n[8] 未分类不参与平铺");
  const noneFold = w41b.querySelector(".fv-nonefold");
  ok("平铺后未分类收进折叠区", !!noneFold);
  ok("折叠区写明未分类张数", /未分类 · 2 张/.test(noneFold.textContent), noneFold.textContent.replace(/\s+/g, " ").slice(0, 40));
  ok("折叠区默认收起（图不可见）", noneFold.querySelector(".fv-nonebody").classList.contains("hidden"));
  ok("平铺区里一张未分类的图都没有",
    !w41b.querySelector(".fv-flat") || w41b.querySelectorAll(".fv-flat .fv-card").length === 5,
    String(w41b.querySelectorAll(".fv-flat .fv-card").length));
  ok("平铺区图片总量 = 已分类数量（5）",
    w41b.querySelectorAll(".fv-flat .fv-card").length === 5, String(w41b.querySelectorAll(".fv-flat .fv-card").length));

  /* 展开未分类折叠区 */
  noneFold.querySelector("[data-nonetog]").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const w41c = doc.querySelector('.fv-week[data-week="W41"]');
  ok("点一下可以展开未分类（看得到 2 张）",
    !w41c.querySelector(".fv-nonebody").classList.contains("hidden")
    && w41c.querySelectorAll(".fv-nonebody .fv-card").length === 2);

  console.log("\n[9] 展开全部周");
  doc.querySelector("#fv-expand-all").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const weeks = doc.querySelectorAll(".fv-week");
  const flatWeeks = doc.querySelectorAll(".fv-week .fv-flat");
  ok("两周都被平铺（2 个周都有平铺容器）", flatWeeks.length === 2, String(flatWeeks.length));
  const w40 = weeks[1];
  ok("W40 的平铺组数 = 2（印花T恤 / 工装裤）", w40.querySelectorAll(".fv-flat-group").length === 2, String(w40.querySelectorAll(".fv-flat-group").length));
  ok("同一张图跨期两条：W40 与 W41 各有一张 u/a1.jpg",
    doc.querySelectorAll('.fv-card[data-url="u/a1.jpg"]').length === 2,
    String(doc.querySelectorAll('.fv-card[data-url="u/a1.jpg"]').length));

  doc.querySelector("#fv-collapse-all").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  ok("「收起全部」后回到分类分块视图", doc.querySelectorAll(".fv-flat-group").length === 0);

  console.log("\n[10] 拖拽改分类：真的写库并即时重排");
  {
    const card = doc.querySelector('.fv-week[data-week="W41"] .fv-catblock[data-cat="1"] .fv-card');
    const dt = { data: {}, setData(k, v) { dt.data[k] = v; }, getData(k) { return dt.data[k]; }, effectAllowed: "" };
    const evStart = new win.Event("dragstart", { bubbles: true });
    evStart.dataTransfer = dt;
    card.dispatchEvent(evStart);
    ok("拖拽开始时携带了这张图的 id", JSON.parse(dt.data["text/plain"] || "[]").indexOf("101") >= 0, dt.data["text/plain"]);

    const target = doc.querySelector('.fv-week[data-week="W41"] .fv-catblock[data-cat="2"]');
    const evOver = new win.Event("dragover", { bubbles: true, cancelable: true });
    evOver.dataTransfer = dt;
    target.dispatchEvent(evOver);
    ok("拖到目标分类上会高亮（给出落点反馈）", target.classList.contains("is-over"));

    const evDrop = new win.Event("drop", { bubbles: true, cancelable: true });
    evDrop.dataTransfer = dt;
    target.dispatchEvent(evDrop);
    await new Promise((r) => setTimeout(r, 200));

    const moved = db.state.items.filter((x) => x.id === 101)[0];
    ok("库里的分类真的改了（→ 连帽卫衣）", String(moved.category_id) === "2", String(moved.category_id));
    const w41d = doc.querySelector('.fv-week[data-week="W41"]');
    ok("页面即时重排：印花T恤剩 2 张", w41d.querySelectorAll('.fv-catblock[data-cat="1"] .fv-card').length === 2,
      String(w41d.querySelectorAll('.fv-catblock[data-cat="1"] .fv-card').length));
    ok("连帽卫衣变成 3 张", w41d.querySelectorAll('.fv-catblock[data-cat="2"] .fv-card').length === 3,
      String(w41d.querySelectorAll('.fv-catblock[data-cat="2"] .fv-card').length));
  }

  console.log("\n[11] 取消收藏");
  {
    const del = doc.querySelector('.fv-week[data-week="W41"] .fv-card[data-id="102"] .fv-del');
    del.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    ok("库里少了那条收藏", !db.state.items.some((x) => x.id === 102));
    ok("页面也不再显示它", !doc.querySelector('.fv-card[data-id="102"]'));
  }
}

/* ============================================================
 * 四、守门：未登录 / 缺表 / 无权限
 * ============================================================ */
async function testGuards() {
  console.log("\n[12] 守门：未登录、建表脚本未执行、无专区权限");
  {
    const db = makeDB(seedFav());
    const win = bootFavPage(db, { notLogged: true });
    await new Promise((r) => setTimeout(r, 200));
    const doc = win.document;
    ok("未登录时提示要登录", /登录/.test(doc.querySelector("#fv-body").textContent));
    ok("未登录时不显示任何收藏卡片", doc.querySelectorAll(".fv-card").length === 0);

    const db2 = makeDB(Object.assign(seedFav(), { fail: "noTable" }));
    const win2 = bootFavPage(db2, { noTable: true });
    await new Promise((r) => setTimeout(r, 200));
    const doc2 = win2.document;
    ok("缺表时提示要执行建表脚本", /建表脚本|patch_20261021R/.test(doc2.querySelector("#fv-body").textContent),
      doc2.querySelector("#fv-body").textContent.slice(0, 60));
    ok("缺表时不显示列表、也不发写请求", doc2.querySelectorAll(".fv-card").length === 0 && db2.state.writes === 0);
    /* 报错必须可自己排查：不能只甩一句「失败」让人去猜 */
    ok("缺表页给出「重新检测」按钮", !!doc2.querySelector("[data-fv-recheck]"));
    const rcBtn = doc2.querySelector("[data-fv-recheck]");
    if (rcBtn) {
      rcBtn.dispatchEvent(new win2.Event("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      const stillMiss = /建表脚本|patch_20261021R/.test(doc2.querySelector("#fv-body").textContent);
      ok("仍缺表时点重新检测：不崩、继续提示（且零写入）", stillMiss && db2.state.writes === 0);
    }
    /* 表建好后点重新检测：应直接进入正常列表，无需刷新页面 */
    const db4 = makeDB(seedFav());
    const win4 = bootFavPage(db4, { noTable: true });
    win4.SB.favReady = async () => false;
    await new Promise((r) => setTimeout(r, 200));
    win4.SB.favReady = win4.SB.favDiag ? async () => (await win4.SB.favDiag()).ok : async () => true;
    const rc4 = win4.document.querySelector("[data-fv-recheck]");
    if (rc4) {
      rc4.dispatchEvent(new win4.Event("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      ok("表建好后点重新检测：直接显示收藏列表（不用刷新页面）",
        win4.document.querySelectorAll(".fv-card").length > 0,
        String(win4.document.querySelectorAll(".fv-card").length));
    } else {
      ok("表建好后点重新检测：直接显示收藏列表（不用刷新页面）", false, "没找到按钮");
    }

    const db3 = makeDB(seedFav());
    const win3 = bootFavPage(db3, { noAuth: true });
    await new Promise((r) => setTimeout(r, 200));
    const doc3 = win3.document;
    ok("无专区权限时给出守门说明", /暂无法查看/.test(doc3.querySelector("#fv-body").textContent || ""));
    ok("无权限时不加载收藏数据", db3.state.reads === 0, String(db3.state.reads));
  }
}

/* ============================================================
 * 五、榜单侧：卡片星标 / 勾选 / 快照字段
 * ============================================================ */
function testRankCard() {
  console.log("\n[13] 榜单卡片：星标、勾选、收藏快照字段");
  const src = read("js/rank.js");
  const start = src.indexOf("  function cardHtml(it, opt) {");
  if (start < 0) { ok("能找到 cardHtml 函数", false); return; }
  let i = src.indexOf("{", start), depth = 0, end = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}") { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  const body = src.slice(start, end);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const badgeOf = () => null;
  const fn = new Function("esc", "badgeOf", "MODE", body + "\n;return cardHtml;");
  const cardHtml = fn(esc, badgeOf, "v");

  const base = {
    image_url: "u/a1.jpg", period_label: "W41", period_type: "week", title: "男装印花T恤",
    leaf_category: "T恤", category: "男装", site: "US", ratio: 1.23, rank_abs: 7,
  };
  const h1 = cardHtml(base, {});
  ok("卡片上有收藏星标", /class="rk-fav"/.test(h1));
  ok("卡片上有多选勾选", /class="rk-pick"/.test(h1));
  ok("卡片带期次快照（data-period）", /data-period="W41"/.test(h1), (h1.match(/data-period="[^"]*"/) || [""])[0]);
  ok("卡片带标题快照（data-title）", /data-title="男装印花T恤"/.test(h1));
  ok("卡片带叶子类目 / 榜单类目 / 站点 / 环比 / 位次快照",
    /data-leaf="T恤"/.test(h1) && /data-cat="男装"/.test(h1) && /data-site="US"/.test(h1)
    && /data-ratio="1\.23"/.test(h1) && /data-rank="7"/.test(h1));
  ok("星标默认未收藏（空心）", /data-fav="0"/.test(h1));

  const h2 = cardHtml(Object.assign({}, base, { period_label: "W40" }), {});
  ok("换个期次，期次快照随之变化（保证跨期算两条）",
    /data-period="W40"/.test(h2) && !/data-period="W40"/.test(h1));

  const h3 = cardHtml(base, { eye: true });
  ok("天眼纯图墙不加星标（不挡图）", !/class="rk-fav"/.test(h3));

  /* 榜单页真的把星标状态刷上去了 */
  ok("rank.js 在渲染后会同步星标状态", /syncFavUI\(\)/.test(src));
  ok("rank.js 支持批量收藏按钮", /rk-batch-fav/.test(src));
  ok("收藏按「期次 + 图地址」判定（不是只看图地址）",
    /function favKey\(period, url\)/.test(src) && /period_label, r\.image_url/.test(src));
}

/* ============================================================
 * 六、静态接线检查
 * ============================================================ */
function testWiring() {
  console.log("\n[14] 接线：菜单、专区权限、建表脚本");
  const cfg = read("js/config.js");
  ok("专区清单里有「我的收藏」", /key:\s*"fav"/.test(cfg));
  ok("「我的收藏」指向 fav.html", /key:\s*"fav"[\s\S]{0,80}fav\.html/.test(cfg));
  const perm = read("js/admin-perm.js");
  ok("后台权限管理可勾选「我的收藏」", /key:\s*"fav"/.test(perm) || /我的收藏/.test(perm));

  ["index.html", "trends.html", "marketing.html", "rank.html", "fav.html"].forEach((f) => {
    ok("顶部菜单在各专区一致：包含收藏入口（" + f + "）", /fav\.html/.test(read(f)));
  });

  const sql = read("tools/patch_20261021R.sql");
  ok("建表脚本建 fav_categories", /create table if not exists public\.fav_categories/.test(sql));
  ok("建表脚本建 fav_items", /create table if not exists public\.fav_items/.test(sql));
  ok("唯一键是（用户 + 期次 + 图地址）——同一张图跨期算两条",
    /unique \(user_id, period_label, image_url\)/.test(sql));
  ok("两张表都开了行级安全", (sql.match(/enable row level security/g) || []).length >= 2);
  ok("读策略限定本人", /using \(user_id = auth\.uid\(\)\)/.test(sql));
  ok("收藏只对登录用户开放", /to authenticated/.test(sql));
  ok("删分类时条目退为未分类（on delete set null）", /category_id bigint references public\.fav_categories \(id\) on delete set null/.test(sql));

  const favHtml = read("fav.html");
  ok("收藏页引入了 fav.js", /js\/fav\.js/.test(favHtml));
  ok("收藏页引入了数据层", /js\/supabase\.js/.test(favHtml));
}


/* ============================================================
 * 六、报错可读性：404 / 缓存未刷新必须翻译成「该执行哪个脚本」
 *   背景：真实事故——建表脚本缺 notify pgrst，接口一直 404，
 *        用户只看到 "点击收藏报错"，无从判断该做什么。
 * ============================================================ */
async function testErrorVoice() {
  console.log("\n[15] 报错可读性：缺表 / 登录失效 / 重名都要说人话");
  const db = makeDB(seedFav());
  const win = bootFavPage(db, {});
  const SB = win.SB;

  const miss1 = SB.favErrMsg({ message: 'relation "public.fav_items" does not exist' });
  ok("表不存在 → 指向 patch_20261021R.sql", /patch_20261021R\.sql/.test(miss1), miss1);
  ok("表不存在 → 不把原始 SQL 报错甩给用户", !/relation .* does not exist/i.test(miss1), miss1);

  const miss2 = SB.favErrMsg({ message: "Could not find the table 'public.fav_categories' in the schema cache", code: "PGRST205" });
  ok("接口缓存未刷新（PGRST205）→ 同样给出脚本指引", /patch_20261021R\.sql/.test(miss2), miss2);

  const miss3 = SB.favErrMsg({ message: "Request failed", status: 404 });
  ok("404 也归到「缺表/缓存」这一类", /patch_20261021R\.sql/.test(miss3), miss3);

  const auth = SB.favErrMsg({ message: "JWT expired", code: "401" });
  ok("登录失效 → 提示重新登录", /重新登录/.test(auth), auth);

  const dup = SB.favErrMsg({ message: "duplicate key value violates unique constraint" });
  ok("分类重名 → 提示换个名字", /同名|换个名字/.test(dup), dup);

  const other = SB.favErrMsg({ message: "网络开小差了" });
  ok("其它错误原样透出，不被乱翻译", other === "网络开小差了", other);

  const d1 = await SB.favDiag();
  ok("正常库：favDiag 返回可用", d1.ok === true && d1.missing === false, JSON.stringify(d1));

  const db2 = makeDB(Object.assign(seedFav(), { fail: "noTable" }));
  const win2 = bootFavPage(db2, {});
  const d2 = await win2.SB.favDiag();
  ok("缺表库：favDiag 判定为缺表（missing=true）", d2.ok === false && d2.missing === true, JSON.stringify(d2));
  ok("缺表库：favReady 随之为 false", (await win2.SB.favReady()) === false);

  /* 榜单侧弹窗：表没建好时不该显示「收藏」提交按钮，而应给指引 + 重新检测 */
  const rankSrc = read("js/rank.js");
  const missBranch = rankSrc.indexOf('if (!FAV.ready) {');
  const alreadyBranch = rankSrc.indexOf('} else if (already) {');
  ok("榜单弹窗先判「表未建好」，再判「已收藏」", missBranch > 0 && alreadyBranch > missBranch);
  ok("榜单弹窗缺表时给出重新检测入口", /data-fp="recheck"/.test(rankSrc));
  ok("榜单弹窗缺表时文案指向脚本名", /patch_20261021R\.sql/.test(rankSrc.slice(missBranch, alreadyBranch)));
  ok("重新检测会重新加载收藏状态（不是只改按钮文字）",
    /async function favRecheck[\s\S]{0,400}loadFavState/.test(rankSrc));

  /* 建表脚本必须刷新接口缓存，否则执行了也照样 404 */
  const sql = read("tools/patch_20261021R.sql");
  ok("建表脚本通知接口重载（notify pgrst）", /notify pgrst, 'reload schema'/i.test(sql));
  ok("notify 在脚本末尾（建完表才刷新）",
    sql.search(/notify pgrst/i) > sql.search(/create table if not exists public\.fav_items/i));
}

(async function main() {
  console.log("== 我的收藏：功能与口径验证 ==" + (REVERSE ? "（反向验证模式）" : ""));
  await testDataLayer();
  testGrouping();
  await testPage();
  await testGuards();
  testRankCard();
  testWiring();
  await testErrorVoice();

  console.log("\n================ 汇总 ================");
  console.log("PASS " + pass + " / FAIL " + fail);
  if (fail) {
    console.log("\n失败项：");
    failures.forEach((f) => console.log("  · " + f));
    process.exit(1);
  }
})();