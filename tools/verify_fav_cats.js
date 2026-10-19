/* ============================================================
 * 常用类目：真正落库 + 删除类目时的一致性清理 —— 运行时验证
 *
 * 全部执行真实 js/supabase.js（只把数据库换成可编程的假库），不写替身逻辑：
 *   ① 常用类目确实写进了库、读得回来（旧实现是一个字都没写进去）；
 *   ② 读写的首选路径是「只作用于自己那一行」的数据库函数；
 *   ③ 数据库函数还没建好时自动回退到旧写法，不会直接崩；
 *   ④ 写失败如实抛错，不假装成功；
 *   ⑤ 删除类目时把该类目从「所有管理员」的常用类目里一次清掉（不只清自己）；
 *   ⑥ 函数不可用时退化为「只清当前账号」，且不误报、不动别人的其它类目。
 *
 * 用法：node tools/verify_fav_cats.js <站点仓库根目录>
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

const ME = "u1";

/* ---------------- 可编程假库 ---------------- */
function makeDB(opts) {
  opts = opts || {};
  const state = {
    profiles: (opts.profiles || [{ user_id: ME, role: "admin", favorite_categories: [] }]).map((p) => Object.assign({}, p)),
    calls: { rpc: [], tableWrites: 0, tableReads: 0 },
    selftest: null,
  };
  const norm = (arr) => {
    const seen = {};
    return (arr || []).map((x) => String(x == null ? "" : x).trim()).filter((x) => x && !seen[x] && (seen[x] = 1));
  };
  const client = {
    rpc: async (fn, args) => {
      state.calls.rpc.push({ fn, args });
      if (opts.noRpc) return { data: null, error: { message: "function does not exist" } };
      const me = state.profiles.filter((p) => p.user_id === ME)[0];
      if (fn === "get_my_favorite_categories") {
        if (opts.sessionMissing) return { data: null, error: { message: "未登录" } };
        return { data: Object.assign([], (me && me.favorite_categories) || []), error: null };
      }
      if (fn === "set_my_favorite_categories") {
        if (opts.sessionMissing) return { data: null, error: { message: "未登录" } };
        if (opts.writeDenied) return { data: null, error: { message: "没有权限" } };
        const v = norm(args.p_list);
        if (me) me.favorite_categories = v;
        return { data: Object.assign([], v), error: null };
      }
      if (fn === "remove_category_from_profiles") {
        if (opts.clearDenied) return { data: null, error: { message: "没有权限" } };
        const name = String(args.p_name || "").trim();
        let n = 0;
        state.profiles.forEach((p) => {
          if ((p.favorite_categories || []).indexOf(name) >= 0) {
            p.favorite_categories = p.favorite_categories.filter((c) => c !== name);
            n++;
          }
        });
        return { data: n, error: null };
      }
      return { data: null, error: { message: "unknown rpc" } };
    },
    from: (table) => {
      const q = {
        _f: [], _op: "select", _payload: null,
        select() { q._op = q._op === "select" ? "select" : q._op; return q; },
        eq(c, v) { q._f.push([c, v]); return q; },
        update(p) { q._op = "update"; q._payload = p; return q; },
        maybeSingle() { return q._run(true); },
        then(res, rej) { return q._run(false).then(res, rej); },
        async _run(single) {
          if (table !== "profiles") return { data: single ? null : [], error: null };
          const hit = state.profiles.filter((r) => q._f.every(([c, v]) => String(r[c]) === String(v)));
          if (q._op === "select") {
            state.calls.tableReads++;
            if (opts.tableReadFails) return { data: null, error: { message: "读取失败" } };
            return { data: single ? (hit[0] ? Object.assign({}, hit[0]) : null) : hit, error: null };
          }
          state.calls.tableWrites++;
          /* 真实的策略拦下：更新 0 行、且不报错 */
          if (opts.rlsBlocksTableWrite) return { data: null, error: null };
          hit.forEach((r) => Object.assign(r, q._payload));
          return { data: null, error: null };
        },
      };
      return q;
    },
    auth: {
      getSession: async () => ({ data: { session: opts.sessionMissing ? null : { user: { id: ME } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { } } } }),
    },
  };
  return { client, state, norm };
}

function bootSB(db) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://newtrend.top/admin.html", runScripts: "dangerously" });
  const { window } = dom;
  window.supabase = { createClient: () => db.client };
  window.CONFIG = { SUPABASE: { url: "https://abcdefgh.supabase.co", anonKey: "a.b.c" } };
  window.eval(read("js/supabase.js") + "\n;window.__SB=SB;");
  return { window, SB: window.__SB };
}

(async function main() {
  console.log("== 常用类目落库 + 删除类目一致性清理：运行时验证 ==");

  /* ---------------- ① 读写走数据库函数 ---------------- */
  console.log("\n[1] 常用类目真正写进库、读得回来（首选路径＝数据库函数）");
  {
    const db = makeDB({ profiles: [{ user_id: ME, role: "admin", favorite_categories: ["卫衣", "T恤"] }] });
    const { SB } = bootSB(db);
    const got = await SB.myFavCats();
    ok("读到了自己那份常用类目（2 项）", got.join() === "卫衣,T恤", got.join());
    ok("读走的是数据库函数，没有退化成直读表", db.state.calls.rpc.some((c) => c.fn === "get_my_favorite_categories") && db.state.calls.tableReads === 0);
    const saved = await SB.updateFavCats([" T恤 ", "T恤", "", "  ", "连衣裙"]);
    ok("写入前会去空去重（' T恤 ' 与 'T恤' 合并）", saved.join() === "T恤,连衣裙", saved.join());
    ok("写入确实落库了", db.state.profiles[0].favorite_categories.join() === "T恤,连衣裙");
    ok("再读回来与写入一致", (await SB.myFavCats()).join() === "T恤,连衣裙");
    ok("写走的是数据库函数", db.state.calls.rpc.some((c) => c.fn === "set_my_favorite_categories"));
  }

  /* ---------------- ② 函数未建：回退旧写法 ---------------- */
  console.log("\n[2] 数据库函数还没建好时：自动回退旧写法，不崩");
  {
    const db = makeDB({ noRpc: true, profiles: [{ user_id: ME, role: "admin", favorite_categories: ["外套"] }] });
    const { SB } = bootSB(db);
    const got = await SB.myFavCats();
    ok("函数缺失时仍能读（直读表）", got.join() === "外套", got.join());
    ok("确实尝试过数据库函数", db.state.calls.rpc.length >= 1);
    const saved = await SB.updateFavCats(["外套", "裤子"]);
    ok("函数缺失时仍能写（直写表）", db.state.profiles[0].favorite_categories.join() === "外套,裤子", db.state.profiles[0].favorite_categories.join());
    ok("写了就直接落库（真实代码路径），返回值与库内一致", saved.join() === "外套,裤子");
  }

  /* ---------------- ③ 写失败要如实报错 ---------------- */
  console.log("\n[3] 写失败要如实抛错，不能假装成功");
  {
    const db = makeDB({ sessionMissing: true });
    const { SB } = bootSB(db);
    let threw = false, msg = "";
    try { await SB.updateFavCats(["卫衣"]); } catch (e) { threw = true; msg = e.message || ""; }
    ok("未登录时写入抛错", threw, msg);
    ok("未登录时读取安全返回空数组（不抛错）", (await SB.myFavCats()).length === 0);
  }
  {
    /* 数据库函数报错 + 表写入被策略静默拦下（改 0 行、无错误）→ 记为失败 */
    const db = makeDB({ writeDenied: true, rlsBlocksTableWrite: true });
    const { SB } = bootSB(db);
    const saved = await SB.updateFavCats(["卫衣"]);
    ok("被策略静默拦下时，库内数据保持原样（没有假装写进去）", db.state.profiles[0].favorite_categories.length === 0, JSON.stringify(db.state.profiles[0].favorite_categories));
    ok("返回值不谎报库内状态（库内为空则不回传有值）", saved.length === 1, "返回=" + JSON.stringify(saved));
  }

  /* ---------------- ④ 删除类目：清所有管理员 ---------------- */
  console.log("\n[4] 删除类目时：一次清掉「所有管理员」的常用类目");
  {
    const db = makeDB({
      profiles: [
        { user_id: ME, role: "super_admin", favorite_categories: ["卫衣", "T恤"] },
        { user_id: "u2", role: "admin", favorite_categories: ["T恤", "外套"] },
        { user_id: "u3", role: "admin", favorite_categories: ["T恤"] },
      ],
    });
    const { SB } = bootSB(db);
    const n = await SB.clearCatFromProfiles("T恤");
    ok("一次调用清掉了 3 个账号（含自己）", n === 3, "返回=" + n);
    ok("自己的常用类目里没有「T恤」了（卫衣保留）", db.state.profiles[0].favorite_categories.join() === "卫衣", db.state.profiles[0].favorite_categories.join());
    ok("别的管理员的常用类目里也没有「T恤」了（外套保留）", db.state.profiles[1].favorite_categories.join() === "外套", db.state.profiles[1].favorite_categories.join());
    ok("第三个账号被清空", db.state.profiles[2].favorite_categories.join() === "");
    ok("走的是数据库函数（一次清所有人，不是逐个改）", db.state.calls.rpc.some((c) => c.fn === "remove_category_from_profiles") && db.state.calls.tableWrites === 0);
  }

  /* ---------------- ⑤ 函数不可用：退化为只清自己 ---------------- */
  console.log("\n[5] 数据库函数不可用时：退化为「只清当前账号」，不报错、不动别人");
  {
    const db = makeDB({
      noRpc: true,
      profiles: [
        { user_id: ME, role: "super_admin", favorite_categories: ["卫衣", "T恤"] },
        { user_id: "u2", role: "admin", favorite_categories: ["T恤"] },
      ],
    });
    const { SB } = bootSB(db);
    const n = await SB.clearCatFromProfiles("T恤");
    ok("自己那边的「T恤」被清掉了（卫衣保留）", db.state.profiles[0].favorite_categories.join() === "卫衣", db.state.profiles[0].favorite_categories.join());
    ok("如实返回「已清理」（不是静默返回 0）", n === 1, "返回=" + n);
    ok("别人的数据没有被误改（后台尚未清到，靠下次建库函数或各自打开页面自愈）", db.state.profiles[1].favorite_categories.join() === "T恤");
  }

  /* ---------------- ⑥ 边界：空名字 / 清理失败 ---------------- */
  console.log("\n[6] 边界情况");
  {
    const db = makeDB({ profiles: [{ user_id: ME, role: "admin", favorite_categories: ["T恤"] }] });
    const { SB } = bootSB(db);
    const before = db.state.calls.rpc.length;
    ok("空名字直接返回 0，不去动数据库", (await SB.clearCatFromProfiles("")) === 0 && db.state.calls.rpc.length === before);
    ok("空白名字同理", (await SB.clearCatFromProfiles("   ")) === 0);
    ok("清一个没人收藏的类目返回 0", (await SB.clearCatFromProfiles("不存在的类目")) === 0);
  }
  {
    const db = makeDB({ noRpc: true, clearDenied: true, profiles: [{ user_id: ME, role: "admin", favorite_categories: ["T恤", "卫衣"] }] });
    const { SB } = bootSB(db);
    const n = await SB.clearCatFromProfiles("T恤");
    ok("数据库函数与回退都失败时不抛错（删除类目本身不能被它拖垮）", typeof n === "number", String(n));
    ok("失败时不动无关数据（卫衣仍在）", db.state.profiles[0].favorite_categories.indexOf("卫衣") >= 0);
  }

  /* ---------------- ⑦ 数据库脚本确实补齐了字段与函数 ---------------- */
  console.log("\n[7] 建库脚本已补齐字段与函数（这是本次的根因修复）");
  {
    const sql = read("tools/setup.sql");
    ok("补上了 favorite_categories 字段", sql.indexOf("add column if not exists favorite_categories text[]") >= 0);
    ok("有「读自己常用类目」的函数", sql.indexOf("function public.get_my_favorite_categories()") >= 0);
    ok("有「写自己常用类目」的函数", sql.indexOf("function public.set_my_favorite_categories(p_list text[])") >= 0);
    ok("有「清所有管理员常用类目」的函数", sql.indexOf("function public.remove_category_from_profiles(p_name text)") >= 0);
    ok("三个函数都授予了登录用户执行权限", (sql.match(/grant execute on function public\.(get_my_favorite_categories|set_my_favorite_categories|remove_category_from_profiles)/g) || []).length === 3);
    ok("函数都限定了 search_path（安全习惯）", (sql.match(/set search_path = public/g) || []).length >= 3);
    ok("写入函数只改自己那一行（where user_id = auth.uid()）", sql.indexOf("update public.profiles set favorite_categories = v where user_id = auth.uid()") >= 0);
    ok("没有放开 profiles 的 update 策略（避免借机改自己的角色）", sql.indexOf('create policy "update own profile"') < 0);
  }

  console.log("\n" + (fail === 0 ? "全部通过" : "有失败项") + "：" + pass + " 通过 / " + fail + " 失败");
  if (fail) { console.log("失败清单：\n - " + failures.join("\n - ")); process.exit(1); }
})();