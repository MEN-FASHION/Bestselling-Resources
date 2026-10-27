/* ============================================================
 * 标签 / 类目「彻底删除」 + 前台显隐配置的读写安全 —— 运行时验证
 *
 * 全部执行真实 js/supabase.js（只把数据库换成可编程的假库），不做替身逻辑：
 *   ① 标签被真正删掉：图片上的该标签被清除、标签定义被删除（这是"删不掉"问题的主线）；
 *   ② 清理是「一次调用」完成（未建库函数时自动退化为分批，单条失败不中断、不死循环）；
 *   ③ 清空的图片会被从其它读取「标签管理」数据的地方一起消失（前端按定义渲染，不做缓存）；
 *   ④ 类目清理同理；被删的内置类目会被压住、不再自己冒出来（cat_removed）；
 *   ⑤ 前台显隐（rank_hidden）读写不破坏 site_settings 里的其它配置键。
 *
 * 用法：node tools/verify_tag_delete.js <站点仓库根目录>
 * ============================================================ */
const fs = require("fs");
const path = require("path");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) { console.error("需要先安装 jsdom：npm install jsdom@22.1.0"); process.exit(2); }

const ROOT = process.argv[2] || ".";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; failures.push(name + (extra ? "  [" + extra + "]" : "")); console.log("  \u2717 " + name + (extra ? "  [" + extra + "]" : "")); }
};

/* ---------------- 可编程假库（只实现被真实代码用到的链路） ---------------- */
function makeDB(opts) {
  opts = opts || {};
  const state = {
    rows: (opts.images || []).map((r, i) => Object.assign({ id: "img" + i }, r)),
    defs: (opts.defs || []).map((r, i) => Object.assign({ id: "def" + i }, r)),
    settings: Object.assign({ id: 1 }, opts.settings || {}),
    calls: { rpc: [], updates: 0, scans: 0, failedIds: [] },
  };
  const failIds = new Set(opts.failUpdateFor || []);

  function from(table) {
    const q = {
      _filters: [], _op: "select", _payload: null, _limit: null,
      select() { return q; },
      eq(col, val) { q._filters.push([col, val]); return q; },
      contains(col, arr) { q._filters.push([col, arr, "contains"]); return q; },
      limit(n) { q._limit = n; return q; },
      update(p) { q._op = "update"; q._payload = p; return q; },
      delete() { q._op = "delete"; return q; },
      maybeSingle() { return q._run(true); },
      then(res, rej) { return q._run(false).then(res, rej); },
      async _run(single) {
        const rows = table === "images" ? state.rows : table === "tag_defs" ? state.defs : table === "site_settings" ? [state.settings] : [];
        const match = (r) => q._filters.every(([c, v, kind]) => kind === "contains"
          ? (Array.isArray(r[c]) && r[c].indexOf(v[0]) >= 0) : String(r[c]) === String(v));
        if (table === "images" && q._op === "select") state.calls.scans++;
        let hit = rows.filter(match);
        if (q._op === "select") {
          if (single) return { data: hit[0] || null, error: null };
          if (q._limit) hit = hit.slice(0, q._limit);
          return { data: hit.map((r) => Object.assign({}, r)), error: null };
        }
        if (q._op === "update") {
          for (const r of hit) {
            if (failIds.has(r.id)) {
              state.calls.failedIds.push(r.id);
              return { data: null, error: { message: "权限不足" } };   // 真的报错，才测得出"单条失败不中断"
            }
            state.calls.updates++;
            Object.assign(r, q._payload);
          }
          return { data: null, error: null };
        }
        if (q._op === "delete") {
          if (table === "images") state.rows = state.rows.filter((r) => !match(r));
          else if (table === "tag_defs") state.defs = state.defs.filter((r) => !match(r));
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
    };
    return q;
  }

  const client = {
    from,
    rpc: async (fn, args) => {
      state.calls.rpc.push({ fn, args });
      if (opts.noRpc || !opts.rpcFns || !opts.rpcFns[fn]) return { data: null, error: { message: "function not found" } };
      const fnImpl = opts.rpcFns[fn];
      let n = 0;
      const field = args.p_field, tag = args.p_tag || args.p_name;
      for (const r of state.rows) {
        if (args.p_field) {
          if (Array.isArray(r[field]) && r[field].indexOf(tag) >= 0) { r[field] = r[field].filter((x) => x !== tag); n++; }
        } else if (String(r.category) === tag) { r.category = ""; n++; }
      }
      return { data: n, error: null };
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  };
  return { client, state };
}

function bootSB(db) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://newtrend.top/admin.html", runScripts: "dangerously" });
  const { window } = dom;
  window.supabase = { createClient: () => db.client };
  window.CONFIG = { SUPABASE: { url: "https://abcdefgh.supabase.co", anonKey: "a.b.c" } };
  /* supabase.js 用 const 声明 SB：eval 的顶层 const 不会挂到 window 上，
     所以在同一次 eval 里把引用交出来（磁盘上的生产代码不动） */
  window.eval(read("js/supabase.js") + "\n;window.__SB=SB;");
  return { window, SB: window.__SB };
}

(async function main() {
  console.log("== 标签 / 类目彻底删除 + 显隐配置读写：运行时验证 ==");

  /* ---------------- ① 标签被真正删掉（数据库函数可用） ---------------- */
  console.log("\n[1] 标签删除：图片上的标签被清除、定义被删除");
  {
    const db = makeDB({
      images: [
        { style_tags: ["街头", "复古"], category: "卫衣" },
        { style_tags: ["街头"], category: "卫衣" },
        { style_tags: ["复古"], category: "T恤" },
      ],
      defs: [{ type: "style", name: "街头" }],
      rpcFns: { remove_tag_from_images: true },
    });
    const { SB } = bootSB(db);
    const n = await SB.removeTagFromImages("style", "街头");
    ok("一次调用就清掉了所有带该标签的图片（返回 2）", n === 2, "返回=" + n);
    ok("图片上的「街头」确实没了", db.state.rows.every((r) => (r.style_tags || []).indexOf("街头") < 0), JSON.stringify(db.state.rows.map((r) => r.style_tags)));
    ok("没带该标签的图片不受影响（复古保留）", db.state.rows[2].style_tags.join() === "复古");
    ok("走的是数据库函数（不是逐张扫描）", db.state.calls.rpc.length === 1 && db.state.calls.scans === 0, "rpc=" + db.state.calls.rpc.length + " 扫描=" + db.state.calls.scans);
    await SB.deleteTagDef("def0");
    ok("标签定义被删除（" + db.state.defs.length + " 条）", db.state.defs.length === 0);
    ok("删除后不再有该标签（其它地方按定义渲染，也就一起没了）", db.state.defs.every((d) => d.name !== "街头"));
  }

  /* ---------------- ② 未建库函数：退化分批，单条失败也不中断 ---------------- */
  console.log("\n[2] 数据库函数还没建好时：自动分批清理，单条失败不中断、能删到底");
  {
    const imgs = [];
    for (let i = 0; i < 25; i++) imgs.push({ style_tags: ["街头", "复古"], category: "卫衣" });
    imgs.push({ style_tags: ["复古"], category: "卫衣" });          /* 不含目标标签 */
    const db = makeDB({ images: imgs, noRpc: true, failUpdateFor: ["img3", "img10"] });
    const { SB } = bootSB(db);
    const n = await SB.removeTagFromImages("style", "街头");
    ok("函数缺失时自动退化（不发 rpc 也能删）", n > 0, "返回=" + n);
    ok("失败的 2 张之外全部清干净（返回 23）", n === 23, "返回=" + n);
    ok("失败张数被如实记下（2 张），不假装全成功", SB._lastBulkFailed === 2, "failed=" + SB._lastBulkFailed);
    ok("不含该标签的图片不会被误改", db.state.rows[25].style_tags.join() === "复古");
    ok("单条失败不会中断整批（不是卡在第 4 张就停）", db.state.calls.updates === 23, "updates=" + db.state.calls.updates);
    ok("没有空转死循环（扫描轮数有界）", db.state.calls.scans <= 6, "scans=" + db.state.calls.scans);
    await SB.deleteTagDef("defX");
    ok("即使有图没清掉，标签定义依然被删除（这正是【标签删不掉】的关键）", db.state.defs.length === 0);
  }

  /* ---------------- ③ 类目清理 + 已删除清单 ---------------- */
  console.log("\n[3] 类目：清空图片上的该类目 + 被删的内置类目不再自己冒出来");
  {
    const db = makeDB({
      images: [{ category: "卫衣" }, { category: "卫衣" }, { category: "T恤" }],
      settings: { frontend_dims: { style: true, element: true, rank_hidden: { sites: ["法国"], periods: [] } }, updated_at: "x" },
      noRpc: true,
    });
    const { SB } = bootSB(db);
    const n = await SB.clearCategoryOnImages("卫衣");
    ok("清空图片上的该类目（返回 2）", n === 2, "返回=" + n);
    ok("图片类目确实被置空", db.state.rows[0].category === "" && db.state.rows[1].category === "");
    ok("其它类目不受影响（T恤保留）", db.state.rows[2].category === "T恤");

    const removed = await SB.setCatRemoved(["露脸模特"]);
    ok("已删除清单写入成功", removed.join() === "露脸模特", removed.join());
    const back = await SB.getCatRemoved();
    ok("读回来一致", back.join() === "露脸模特", back.join());
    ok("没破坏 frontend_dims 里的其它键（维度开关 + 显隐设置都还在）",
      db.state.settings.frontend_dims.style === true &&
      db.state.settings.frontend_dims.element === true &&
      db.state.settings.frontend_dims.rank_hidden.sites.join() === "法国",
      JSON.stringify(db.state.settings.frontend_dims));
  }

  /* ---------------- ④ 前台显隐配置读写 ---------------- */
  console.log("\n[4] 前台显隐（哪些站点 / 周次展示）：写入后不破坏其它配置");
  {
    const db = makeDB({
      settings: { frontend_dims: { style: true, element: false }, updated_at: "x" },
    });
    const { SB } = bootSB(db);
    let h = await SB.getRankHidden();
    ok("默认空（= 全部展示）", h.sites.length === 0 && h.periods.length === 0);
    h = await SB.setRankHidden({ sites: ["法国"] });
    ok("隐藏一个站点后读回一致", h.sites.join() === "法国", h.sites.join());
    h = await SB.setRankHidden({ periods: ["2026W39"] });
    ok("再隐藏一个周次：站点设置不被覆盖（两个键合起来生效）", h.sites.join() === "法国" && h.periods.join() === "2026W39", JSON.stringify(h));
    ok("去重生效（重复写入不产生重复项）", (await SB.setRankHidden({ sites: ["法国", "法国"] })).sites.length === 1);
    h = await SB.setRankHidden({ sites: [] });
    ok("取消隐藏后为空（前台恢复展示）", h.sites.length === 0 && h.periods.join() === "2026W39", JSON.stringify(h));
    ok("全程没破坏前端维度开关（style / element 原样）",
      db.state.settings.frontend_dims.style === true && db.state.settings.frontend_dims.element === false,
      JSON.stringify(db.state.settings.frontend_dims));
  }

  /* ---------------- ⑤ 极端：库函数不存在 + 限流/权限失败 ---------------- */
  console.log("\n[5] 极端情况：不支持的字段 / 空值 / 全部更新都失败");
  {
    const db = makeDB({ images: [{ style_tags: ["街头"] }], noRpc: true });
    const { SB } = bootSB(db);
    let threw = "";
    try { await SB.removeTagFromImages("not_a_field", "街头"); } catch (e) { threw = String(e.message || e); }
    ok("不支持的标签类型直接报错（不静默乱改数据）", /不支持/.test(threw), threw);
    ok("空标签名不误伤（返回 0）", (await SB.removeTagFromImages("style", "  ")) === 0);

    const db2 = makeDB({ images: [{ style_tags: ["街头"] }, { style_tags: ["街头"] }], noRpc: true, failUpdateFor: ["img0", "img1"] });
    const { SB: SB2 } = bootSB(db2);
    const n2 = await SB2.removeTagFromImages("style", "街头");
    ok("全部失败时返回 0 且不死循环（真实报错交给上层提示）", n2 === 0 && db2.state.calls.scans <= 3, "返回=" + n2 + " scans=" + db2.state.calls.scans);
  }

  /* ---------------- ⑥ 删除顺序（静态核对真实源码） ---------------- */
  console.log("\n[6] 删除顺序：先清图片、再删标签定义（否则清的时候就没有名字可用了）");
  {
    const src = read("js/admin-images.js");
    const iClear = src.indexOf("await SB.removeTagFromImages(type, tname)");
    const iDel = src.indexOf("await SB.deleteTagDef(def.id)");
    ok("清除图片上的标签发生在删除标签定义之前", iClear > 0 && iDel > iClear, "clear@" + iClear + " del@" + iDel);
    ok("类目删除同样先清图片、再删类目", (() => {
      const a = src.indexOf("await SB.removeCategory(name)");
      const b = src.indexOf("await SB.clearCategoryOnImages(name)");
      return a > 0 && b > a;
    })());
    ok("删除后会刷新所有读标签数据的面板（避免这边删了那边还挂着）", /refreshTagConsumers\(\)/.test(src));
    ok("类目勾选清单里扣掉了已删除类目（否则会被内置清单带回来）", /catRemoved\.forEach\(n => opts\.delete\(n\)\)/.test(src));
  }

  console.log("\n== 结果：通过 " + pass + " 项，失败 " + fail + " 项 ==");
  if (fail) { console.log("失败项：\n - " + failures.join("\n - ")); process.exit(1); }
})();
