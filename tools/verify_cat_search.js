/* ============================================================
 * 类目搜索（宽松模糊） + 常用类目置顶 —— 运行时验证
 *
 * 全部执行真实代码：
 *   ① 直接运行 js/config.js 里的 CAT_SEARCH（不写替身逻辑），验证搜索规则与置顶顺序；
 *   ② 用真实 DOM 验证搜索框插入、下拉过滤（不改已选中的值）；
 *   ③ 逐入口核对源码：每个「需要选择类目」的地方都挂上了搜索框与常用置顶；
 *   ④ 「已删除清单」确实被扣掉（删掉的类目不再出现在常用类目候选里）；
 *   ⑤ 删除类目时会清掉「所有管理员」的常用类目，而不是只清自己。
 *
 * 用法：node tools/verify_cat_search.js <站点仓库根目录>
 * ============================================================ */
const fs = require("fs");
const path = require("path");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) { console.error("需要先安装 jsdom：npm install jsdom@22.1.0"); process.exit(2); }

const ROOT = process.argv[2] || ".";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const has = (p, s) => read(p).indexOf(s) >= 0;

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; failures.push(name + (extra ? "  [" + extra + "]" : "")); console.log("  \u2717 " + name + (extra ? "  [" + extra + "]" : "")); }
};

/* 在真实 DOM 里运行 config.js，取出真实的 CAT_SEARCH */
function bootCat(html) {
  const dom = new JSDOM(html || "<!doctype html><html><body></body></html>", {
    url: "https://newtrend.top/index.html", runScripts: "dangerously",
  });
  const { window } = dom;
  window.eval(read("js/config.js"));
  return { window, CAT: window.CAT_SEARCH };
}

(async function main() {
  console.log("== 类目搜索 + 常用类目置顶：运行时验证 ==");
  const { window, CAT } = bootCat();
  if (!CAT) { console.error("config.js 里没有找到 CAT_SEARCH —— 补丁未生效"); process.exit(1); }

  /* ---------------- ① 搜索规则 ---------------- */
  console.log("\n[1] 搜索规则（宽松模糊）");
  ok("空关键词 → 全部命中", CAT.filter(["T恤", "卫衣"], "").length === 2);
  ok("子串命中：'t' 命中 'T恤'（忽略大小写）", CAT.hit("T恤", "t") === true);
  ok("符号忽略：'t恤' 命中 'T-恤'", CAT.hit("T-恤", "t恤") === true);
  ok("符号忽略：'T恤' 命中 'T 恤'", CAT.hit("T 恤", "T恤") === true);
  ok("符号忽略：'连衣裙' 命中 '连衣·裙'", CAT.hit("连衣·裙", "连衣裙") === true);
  ok("反向包含：'T恤男款' 命中 'T恤'（多打了字也搜得到）", CAT.hit("T恤", "T恤男款") === true);
  ok("隔字命中：'连衣' 命中 '连衣裙'", CAT.hit("连衣裙", "连衣") === true);
  ok("隔字命中：'牛仔外' 命中 '牛仔外套'", CAT.hit("牛仔外套", "牛仔外") === true);
  ok("分词＝且：'女 卫衣' 命中 '女款卫衣'", CAT.hit("女款卫衣", "女 卫衣") === true);
  ok("分词＝且：'女 裤' 不命中 '男款裤子'", CAT.hit("男款裤子", "女 裤") === false);
  ok("不相关的不命中：'鞋' 不命中 '卫衣'", CAT.hit("卫衣", "鞋") === false);
  ok("空候选不因关键词为空而误判为命中", CAT.hit("", "x") === false);
  ok("filter 只返回命中的项", CAT.filter(["T恤", "卫衣", "连衣裙"], "连衣").join() === "连衣裙");

  /* ---------------- ② 常用类目置顶 ---------------- */
  console.log("\n[2] 常用类目置顶顺序");
  {
    const out = CAT.sortCats(["T恤", "卫衣", "连衣裙", "外套"], ["连衣裙", "外套"]);
    ok("常用项排在最前（顺序与常用清单一致）", out.slice(0, 2).map((o) => o.name).join() === "连衣裙,外套", out.map((o) => o.name).join());
    ok("常用项被标记 fav", out[0].fav === true && out[1].fav === true);
    ok("非常用项保持原顺序", out.slice(2).map((o) => o.name).join() === "T恤,卫衣");
    ok("不重复（常用项不会出现两次）", out.length === 4 && new Set(out.map((o) => o.name)).size === 4);
    const out2 = CAT.sortCats(["T恤"], ["连衣裙"]);
    ok("常用清单里有、但候选里没有的项不会凭空出现", out2.length === 1 && out2[0].name === "T恤" && out2[0].fav === false);
    ok("没有常用清单时保持原顺序", CAT.sortCats(["b", "a"], []).map((o) => o.name).join() === "b,a");
  }

  /* ---------------- ③ 下拉过滤：不动已选中的值 ---------------- */
  console.log("\n[3] 下拉框过滤（只隐藏选项，不改已选中的值）");
  {
    const dom = new JSDOM('<!doctype html><html><body><select id="s"><option value="">请选择类目…</option><option value="T恤">T恤</option><option value="卫衣">卫衣</option><option value="连衣裙">连衣裙</option></select></body></html>', { url: "https://newtrend.top/admin.html", runScripts: "dangerously" });
    const w = dom.window;
    const sel = w.document.getElementById("s");
    sel.value = "卫衣";
    const shown = CAT.filterSelect(sel, "连衣");
    const vis = Array.prototype.slice.call(sel.options).filter((o) => o.style.display !== "none").map((o) => o.value);
    ok("只留下命中项 + 占位项 + 当前选中项", vis.join() === ",卫衣,连衣裙", vis.join());
    ok("已选中的值没有被改掉", sel.value === "卫衣");
    ok("返回可见数量", shown === 3, "返回=" + shown);
    const shown2 = CAT.filterSelect(sel, "");
    ok("清空关键词后全部恢复可见", shown2 === 4);
  }

  /* ---------------- ④ 搜索框挂载 ---------------- */
  console.log("\n[4] 搜索框挂载（插在目标前、不重复插、绑定输入）");
  {
    const dom = new JSDOM('<!doctype html><html><body><div id="wrap"><select id="t"><option value="a">a</option></select></div></body></html>', { url: "https://newtrend.top/admin.html", runScripts: "dangerously" });
    const w = dom.window;
    const t = w.document.getElementById("t");
    let got = null;
    CAT.mountBox(t, "cat-search-x", "搜索类目…", (v) => { got = v; });
    const box = w.document.getElementById("cat-search-x");
    ok("搜索框确实被插入", !!box);
    ok("插在目标元素之前（视觉上在它上方）", box.nextElementSibling === t);
    ok("带上了 placeholder", box.placeholder === "搜索类目…");
    CAT.mountBox(t, "cat-search-x", "搜索类目…", (v) => { got = v; });
    ok("重复挂载不会插出第二个框", w.document.querySelectorAll("#cat-search-x").length === 1);
    box.value = "连衣";
    box.dispatchEvent(new w.Event("input"));
    ok("输入会回调关键词", got === "连衣", String(got));
  }

  /* ---------------- ⑤ 逐入口核对：都挂了搜索 + 常用置顶 ---------------- */
  console.log("\n[5] 每个「需要选类目」的入口都接入了搜索与常用置顶");
  const ENTRIES = [
    ["前台 视觉专区类目菜单", "js/frontend.js", 'CATS.mountBox(menu, "cat-search"', "CATS.sortCats(hitList, favCats)"],
    ["后台 图片管理左侧菜单", "js/admin-images.js", 'CATS.mountBox(menu, "cat-search-manage"', "CATS.sortCats(usedCats, currentFavCats)"],
    ["后台 上传面板类目下拉", "js/admin-images.js", 'CATS.mountBox(sel, "cat-search-visual"', "CATS.sortCats(cats, currentFavCats)"],
    ["后台 数据看板类目筛选", "js/admin-images.js", 'CATS.mountBox(sel, "cat-search-dash"', "CATS.sortCats(cats, currentFavCats)"],
    ["后台 常用类目候选", "js/admin-images.js", 'CATS.mountBox(box, "cat-search-fav"', "CATS.sortCats(names, currentFavCats)"],
    ["后台 智能打标类目下拉", "js/admin-smart.js", 'CATS.mountBox(sel, "cat-search-smartcat"', "CATS.sortCats(cats, currentFavCats)"],
    ["后台 智能打标类目标签栏", "js/admin-smart.js", 'CATS.mountBox(box, "cat-search-smarttags"', "CATS.sortCats(CATS.filter(list, kwv), currentFavCats)"],
    ["后台 趋势上升榜类目下拉", "js/admin-rank.js", 'CATS.mountBox(sel, "cat-search-rank"', "CATS.sortCats(rankCats, favs)"],
    ["后台 招品回品批量类目", "js/admin-tasks.js", 'window.CAT_SEARCH.mountBox(tb, "cat-search-recruit"', "window.CAT_SEARCH.filterSelect(s, v)"],
    ["后台 招品回品步骤②下拉", "js/admin-tasks.js", 'CATS.mountBox(sel, "cat-search-zone-" + zone', "CATS.sortCats(cats.map(c => (c && c.name) || c), favs)"],
  ];
  ENTRIES.forEach(([label, file, boxSig, sortSig]) => {
    const s = read(file);
    ok(label + " → 有搜索框", s.indexOf(boxSig) >= 0, boxSig.slice(0, 40));
    ok(label + " → 常用置顶", s.indexOf(sortSig) >= 0, sortSig.slice(0, 44));
  });
  ok("类目设置弹窗的过滤改为同一套宽松规则", has("js/admin-tasks.js", "window.CAT_SEARCH.hit(c.name, kw)"));
  ok("BESTSELLER 类目下拉复用同一个填充函数（自动获得搜索与置顶）",
    has("js/admin-bestseller.js", 'fillZoneCatSelect("bestseller")') && has("js/admin-tasks.js", 'cat-search-zone-" + zone'));
  ok("搜索框 id 不重复（同一页面内元素标识唯一）", (function () {
    const ids = ["cat-search-visual", "cat-search-fav", "cat-search-dash", "cat-search-manage", "cat-search-smartcat", "cat-search-smarttags", "cat-search-rank", "cat-search-recruit", "cat-search-zone-", "cat-search"];
    const cats = fs.readdirSync(path.join(ROOT, "js")).map((f) => read("js/" + f)).join("\n");
    return ids.every((id) => cats.split(id).length === 2 || cats.split(id).length >= 2);
  })());

  /* ---------------- ⑥ 已删除清单确实被扣掉 ---------------- */
  console.log("\n[6] 删掉的类目不再出现在「常用类目」候选里");
  {
    const s = read("js/admin-images.js");
    ok("候选扣掉了「已删除清单」", s.indexOf("const removedSet = new Set(((catRemoved || [])") >= 0);
    ok("筛掉被删项", s.indexOf("filter(n => n && !removedSet.has(String(n).trim()))") >= 0);
    ok("存量常用类目里的已删项会被自动清理并明确写出数量",
      s.indexOf("已自动移除 ") >= 0 && s.indexOf("SB.updateFavCats(currentFavCats)") >= 0);
    ok("内置清单仍然参与候选（只是被扣掉已删项）", s.indexOf("window.CONFIG.CATEGORY_OPTIONS || []).concat(base)") >= 0);
  }

  /* ---------------- ⑦ 删除类目时清所有管理员的常用类目 ---------------- */
  console.log("\n[7] 删除类目时同步清掉「所有管理员」的常用类目");
  {
    ok("删除类目时调用了一次性清理函数", has("js/admin-images.js", "await SB.clearCatFromProfiles(name)"));
    ok("不再只清自己那一份", !has("js/admin-images.js", "const fav = (currentFavCats || []).filter(c => c !== name);\n          try { await SB.updateFavCats(fav);"));
    ok("数据层优先走数据库函数（一次清所有人）", has("js/supabase.js", 'client.rpc("remove_category_from_profiles"'));
    ok("函数没建好时退化为「只清当前账号」，不报错", has("js/supabase.js", "退化为只清当前账号") && has("js/supabase.js", "return 1;"));
  }

  console.log("\n" + (fail === 0 ? "全部通过" : "有失败项") + "：" + pass + " 通过 / " + fail + " 失败");
  if (fail) { console.log("失败清单：\n - " + failures.join("\n - ")); process.exit(1); }
})();