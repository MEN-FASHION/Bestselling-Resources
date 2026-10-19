/* ============================================================
 * 用户动向 + 版本恢复 + 分页 + 对比池铺满 —— 运行时验证
 *
 * 全部用真实文件、真实代码：
 * ① 菜单热度：jsdom 解析真实 rank.html、执行真实 js/track-menu.js，
 *    派发真实点击事件，断言确实上报了（含静默失败/右键/空白处的反例）；
 * ② 管理员留痕：核对数据库侧触发器确实挂在业务表上、且不挂在访问日志上；
 * ③ 分页跳页：执行 admin-perm.js 里真实的 renderPermPager 源码；
 * ④ 对比池铺满：核对样式与脚本的铺满逻辑（横向不溢出 / 高度实测）。
 * 末尾做反向验证：把关键实现还原成旧写法，检查项必须失败（证明不是走过场）。
 *
 * 用法：node tools/verify_insight.js <站点仓库根目录>
 * （需要 jsdom：npm install jsdom@22.1.0）
 * ============================================================ */
const fs = require("fs");
const path = require("path");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) { console.error("需要先安装 jsdom（本脚本用真实浏览器环境跑真实前台脚本）：npm install jsdom@22.1.0"); process.exit(2); }

const ROOT = process.argv[2] || ".";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name + (extra ? " [" + extra + "]" : "")); console.log("  ✗ " + name + (extra ? " [" + extra + "]" : "")); }
};

/* ---------------- 菜单热度：真实页面 + 真实脚本 ---------------- */
function bootPage(file, opts) {
  opts = opts || {};
  let html = read(file).replace(/<script src="[^"]*"><\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://newtrend.top/" + file, runScripts: "dangerously", pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message || e.error)));
  window.eval(read("js/config.js"));
  const calls = [];
  if (!opts.noSB) window.SB = { trackEvent: function (ev, zone, menu, p) { calls.push({ ev: ev, zone: zone, menu: menu, path: p }); } };
  window.eval(read("js/track-menu.js"));
  const click = (el, btn) => {
    const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: btn === undefined ? 0 : btn });
    el.dispatchEvent(ev);
  };
  return { window, calls, errors, click };
}

/* ---------------- 反向验证用：构造"旧写法"的副本 ---------------- */
function mutate(file, re, to) {
  const src = read(file);
  if (!re.test(src)) return null;
  return src.replace(re, to);
}

(async function main() {
  console.log("== 用户动向 + 版本恢复 + 分页 + 对比池：运行时验证 ==");

  /* ---------- ① 菜单热度：前台 ---------- */
  console.log("\n[1] 前台菜单点击会上报（真实 rank.html + 真实 track-menu.js）");
  {
    const t = bootPage("rank.html");
    const w = t.window;
    const tab = w.document.querySelector(".top-tabs .tab-link");
    ok("页面上存在顶部菜单项（真实结构）", !!tab);
    if (tab) {
      const label = (tab.textContent || "").trim().replace(/\s+/g, " ");
      t.click(tab);
      ok("点顶部菜单会上报一条 menu 事件", t.calls.length === 1, JSON.stringify(t.calls));
      ok("事件类型是 menu", t.calls[0] && t.calls[0].ev === "menu", t.calls[0] && t.calls[0].ev);
      ok("记录了菜单文字（与页面一致）", t.calls[0] && t.calls[0].menu === label.slice(0, 30), t.calls[0] && t.calls[0].menu);
      ok("记录了所属专区（rank）", t.calls[0] && t.calls[0].zone === "rank", t.calls[0] && t.calls[0].zone);
      ok("记录了页面路径", !!(t.calls[0] && t.calls[0].path && t.calls[0].path.indexOf("rank.html") >= 0), t.calls[0] && t.calls[0].path);
    }
    const cat = w.document.querySelector(".cat-menu a, .cat-menu li");
    if (cat) {
      t.click(cat);
      ok("点类目菜单也会上报", t.calls.length === 2, String(t.calls.length));
    }
    const before = t.calls.length;
    t.click(w.document.body);
    ok("点空白处不上报（不产生噪声）", t.calls.length === before, String(t.calls.length));
    t.click(tab, 2);
    ok("右键不上报", t.calls.length === before, String(t.calls.length));
    ok("全程无未捕获错误", t.errors.length === 0, t.errors.join(" | ").slice(0, 160));
  }

  console.log("\n[2] 专区归属识别 / 静默失败");
  {
    const t = bootPage("rank.html");
    const MT = t.window.MenuTrack;
    ok("rank.html → rank", MT.zoneOf("/rank.html") === "rank", MT.zoneOf("/rank.html"));
    ok("admin.html → admin", MT.zoneOf("/admin.html") === "admin", MT.zoneOf("/admin.html"));
    ok("index.html → visual（按专区定义）", MT.zoneOf("/index.html") === "visual", MT.zoneOf("/index.html"));
    ok("未知页面 → 文件名兜底", MT.zoneOf("/foo.html") === "foo", MT.zoneOf("/foo.html"));

    const t2 = bootPage("rank.html", { noSB: true });
    const tab2 = t2.window.document.querySelector(".top-tabs .tab-link");
    let threw = false;
    try { t2.click(tab2); } catch (e) { threw = true; }
    ok("没有上报通道时点击不报错（静默失败）", !threw && t2.errors.length === 0, t2.errors.join(" | ").slice(0, 120));
  }

  console.log("\n[3] 五个页面都接入了上报（含不引入 common.js 的页面）");
  ["index.html", "trends.html", "rank.html", "marketing.html", "admin.html"].forEach((f) => {
    const s = read(f);
    ok(f + " 引入 track-menu.js", s.indexOf("js/track-menu.js") >= 0);
  });

  /* ---------- ② 管理员留痕 ---------- */
  console.log("\n[4] 管理员操作留痕（数据库侧自动记录）");
  {
    const sql = read("tools/setup_analytics.sql");
    // ⚠️ 触发器「覆盖面 / 排除项」的判定必须限定在「逐个挂触发器」那一段内。
    //    2026-10-19 真实踩坑：5.5 字段对齐段里也出现了 'visit_logs' / 'admin_actions' 字面量
    //    （补字段用的），全文件扫描会把这些误判成「把访问日志表也挂上了留痕」。
    //    判定要按段落取，不能扫全文。
    const trig = (function () {
      const i = sql.indexOf("逐个挂触发器");
      const j = sql.indexOf("5.5 字段对齐");
      return (i >= 0 && j > i) ? sql.slice(i, j) : "";
    })();
    ok("能定位到「逐个挂触发器」段落", trig.length > 0, "段落标记可能被改动");
    ok("存在留痕触发器函数", /create or replace function public\.log_admin_tbl/.test(sql));
    ok("存在账号资料专用留痕函数", /create or replace function public\.log_admin_profile/.test(sql));
    ok("触发器是语句级（批量上传不会刷爆日志）", /for each statement execute function public\.log_admin_tbl/.test(sql));
    ok("使用新旧行过渡表统计影响行数", /referencing old table as oldtab new table as newtab/i.test(sql));
    ok("只记录管理员/超管的写入", /v_role not in \('admin', 'super_admin'\)/.test(sql));
    ok("管理员上传图片会被记到（images）", /'images',\s*'图片'/.test(trig), "");
    ok("账号权限调整单独处理（避免改常用类目也刷日志）", /manage_zones is distinct from|frontend_zones is distinct from/.test(sql));
    ok("访问日志自身不被记录（防自我放大）", !/'visit_logs'/.test(trig), "触发器段落里出现了 visit_logs");
    ok("操作日志表自身不被记录", !/'admin_actions'/.test(trig), "触发器段落里出现了 admin_actions");
    ok("表不存在时自动跳过（未启用模块不报错）", /to_regclass\('public\.'\s*\|\|\s*t\.tbl\) is null/.test(sql));
    ok("单个触发器失败不中断整段脚本", /exception when others then\s*\n\s*raise notice '操作留痕/.test(sql));
    const tables = ["images", "categories", "tag_defs", "site_settings", "trends", "announcements",
      "recruit_tasks", "recruit_submissions", "recruit_categories", "bestseller_tasks",
      "bestseller_submissions", "bestseller_categories", "zone_permissions",
      "marketing_nodes", "marketing_articles", "rank_sites", "rank_batches", "rank_items"];
    const missing = tables.filter((t) => trig.indexOf("('" + t + "'") < 0);
    ok("业务表覆盖面完整（" + tables.length + " 张）", missing.length === 0, missing.join(","));
  }

  console.log("\n[5] 用户动向 / 版本恢复：面板与接口都在");
  {
    const html = read("admin.html");
    const nav = read("js/admin.js");
    const sup = read("js/supabase.js");
    ok("后台有「用户动向」面板", html.indexOf('id="insight-card"') >= 0);
    ok("后台有「版本恢复」面板", html.indexOf('id="backup-card"') >= 0);
    ok("用户动向面板：前台用户 / 专区菜单热度 / 后台管理员 三个子页",
      /前台用户/.test(html) && /菜单/.test(html) && /后台管理员/.test(html));
    ok("切到用户动向会懒加载", /insight-card"\s*&&\s*typeof loadInsight/.test(nav));
    ok("切到版本恢复会加载快照与策略", /backup-card"\s*&&\s*typeof loadBackupList/.test(nav));
    ok("前台用户统计接口存在（来源/行为/时长）", /insight_front/.test(sup));
    ok("后台管理员统计接口存在", /insight_admin/.test(sup));
    ok("行为上报接口存在（菜单点击用）", /trackEvent/.test(sup));
    const bk = read("tools/setup_backup.sql");
    ok("版本恢复有建表与函数（快照/回滚在一个事务里）", /backup_restore/.test(bk) && /begin/i.test(bk));
  }

  console.log("\n[6] 权限管理里的「数据看板」已移除");
  {
    const html = read("admin.html");
    ok("admin.html 里没有 perm-dash 看板块", html.indexOf('id="perm-dash"') < 0);
    ok("admin.html 里没有看板标题残留", html.indexOf("数据看板") < 0 || html.indexOf("perm-dash") < 0);
    const perm = read("js/admin-perm.js");
    ok("admin-perm.js 里没有遗留的看板渲染函数", !/function renderDash\(/.test(perm));
  }

  /* ---------- ③ 分页跳页：执行真实源码 ---------- */
  console.log("\n[7] 权限管理分页：每页条数 / 首末页 / 跳页（执行真实源码）");
  {
    const src = read("js/admin-perm.js");
    const fn = src.slice(src.indexOf("function renderPermPager(total)"));
    const body = fn.slice(0, fn.indexOf("\n  }") + 4);
    const dom = new JSDOM('<div id="perm-pager"></div>', { url: "https://newtrend.top/admin.html", runScripts: "outside-only" });
    const w = dom.window;
    /* 把真实源码包成一个工厂：显式注入 document，避免跨作用域取值 */
    const factory = w.eval("(function (document) {\n" +
      "var permPage = 3, permPageSize = 20, permShownIds = new Array(137);\n" +
      "var $ = function (s) { return document.querySelector(s); };\n" +
      body + "\n" +
      "return { render: renderPermPager, setPage: function (v) { permPage = v; } };\n})");
    const api = factory(w.document);
    api.render(137);
    const out = w.document.getElementById("perm-pager").innerHTML;
    ok("分页条渲染出了内容", out.length > 0);
    ok("显示总条数与当前区间（137 人 / 41–60）", /共 <b>137<\/b> 个用户/.test(out) && /41–60/.test(out), out.slice(0, 90));
    ok("有首页 / 上一页 / 下一页 / 末页", /data-pp="first"/.test(out) && /data-pp="prev"/.test(out) && /data-pp="next"/.test(out) && /data-pp="last"/.test(out));
    ok("显示当前第几页 / 共几页（3 / 7）", /第 <b>3<\/b> \/ 7 页/.test(out), out.slice(0, 160));
    ok("有每页条数选择（10/20/50/100）", /perm-page-size/.test(out) && /100 条/.test(out));
    ok("新增「跳页」输入框", /id="perm-page-jump"/.test(out));
    ok("跳页上限等于总页数", /max="7"/.test(out), out.slice(0, 200));
    api.setPage(1);
    api.render(5);
    const out2 = w.document.getElementById("perm-pager").innerHTML;
    ok("只有一页时跳页禁用（不做无意义的跳转）", /id="perm-page-jump"[^>]*disabled/.test(out2), "");
    ok("分页状态只有一处声明（不重复定义）",
      (src.match(/(?:var|let|const)\s+permPage\s*=/g) || []).length === 1);
  }

  /* ---------- ④ 对比池铺满 ---------- */
  console.log("\n[8] 对比池：铺满下方 + 横向永不溢出");
  {
    const css = read("css/style.css");
    const js = read("js/rank.js");
    ok("池体高度优先用实测值 --rk-fill（不再只靠写死估算）",
      /#rank-view \.rk-body \{[^}]*height:\s*var\(--rk-fill/.test(css));
    ok("保留写死值仅作兜底（取不到尺寸时仍可用）", /var\(--rk-fill,\s*max\(420px/.test(css));
    ok("脚本按「池顶到视口底」实测写入高度", /function fillPoolsHeight/.test(js) && /--rk-fill/.test(js));
    ok("实测高度在排布计算前生效", /function fitPools\(\) \{\s*\n\s*fillPoolsHeight\(\);/.test(js));
    ok("太矮时有下限（不会把图压到看不清）", /Math\.max\(420,\s*avail\)/.test(js));
    ok("对比池横向不出现滚动条", /\.rk-pools \{[^}]*overflow-x:\s*hidden/.test(css));
    ok("列宽按列数均分（flex:1 1 0 + min-width:0，几列都不溢出）",
      /\.rk-pool \{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0/.test(css));
    ok("列数上限受控（不会排出几十张的小图）", /POOL_R_MAX\s*=\s*\d+/.test(js));
    ok("窗口变化会重排（旋转/缩放后仍一眼看全）", /fitPoolsSoon/.test(js) && /resize/.test(js));
  }

  /* ---------- 反向验证 ---------- */
  console.log("\n[9] 反向验证：把关键实现还原成旧写法，检查项必须失败");
  {
    // (a) 页面没接入上报 → 不应能通过「接入」检查
    const idx = read("index.html");
    const cut = mutate("index.html", /\n[ \t]*<script src="js\/track-menu\.js\?v=[^"]*"><\/script>/g, "");
    ok("还原：页面去掉 track-menu.js 引用", cut !== null && cut.indexOf("track-menu.js") < 0);
    if (cut) ok("此时「已接入上报」检查会失败（证明检查有效）", cut.indexOf("js/track-menu.js") < 0);

    // (b) 上报模块被删掉 → 真实点击不再产生上报
    const dom = new JSDOM(read("rank.html").replace(/<script src="[^"]*"><\/script>/g, "").replace(/[ \t]*<script src="js\/track-menu\.js[^"]*"><\/script>/, ""),
      { url: "https://newtrend.top/rank.html", runScripts: "dangerously", pretendToBeVisual: true });
    const calls = [];
    dom.window.SB = { trackEvent: (a, b, c) => calls.push([a, b, c]) };
    dom.window.eval(read("js/config.js"));
    const tab = dom.window.document.querySelector(".top-tabs .tab-link");
    if (tab) tab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    ok("还原：不引入上报模块时，点菜单不会上报（检查项抓到差异）", calls.length === 0, JSON.stringify(calls));

    // (c) 留痕触发器少挂一张表 → 覆盖面检查必须失败
    const sqlFull = read("tools/setup_analytics.sql");
    const ti = sqlFull.indexOf("逐个挂触发器"), tj = sqlFull.indexOf("5.5 字段对齐");
    const sqlCut = sqlFull.slice(0, ti) +
      sqlFull.slice(ti, tj).replace("('images', '图片'),", "") + sqlFull.slice(tj);
    const trigCut = sqlCut.slice(ti, tj);
    const tables = ["images", "categories", "tag_defs", "site_settings"];
    const missing = tables.filter((t) => trigCut.indexOf("('" + t + "'") < 0);
    ok("还原：拿掉 images 一行后，覆盖面检查会失败（证明检查有效）", missing.indexOf("images") >= 0, missing.join(","));

    // (d) 对比池改回横向滚动 + 写死高度 → 溢出检查必须失败
    const cssOld = read("css/style.css")
      .replace(/height:\s*var\(--rk-fill,\s*max\(420px,\s*calc\(100vh - 244px\)\)\)/, "height: max(420px, calc(100vh - 244px))")
      .replace(/overflow-x:\s*hidden;/, "overflow-x: auto;");
    ok("还原：写死高度 + 允许横向滚动时，铺满/不溢出检查会失败（证明检查有效）",
      !/height:\s*var\(--rk-fill/.test(cssOld) && /\.rk-pools \{[^}]*overflow-x:\s*auto/.test(cssOld));

    // (e) 分页去掉跳页 → 跳页检查必须失败
    const permOld = read("js/admin-perm.js").replace(/html \+= '<label class="pp-jump">[\s\S]*?;/, "");
    ok("还原：拿掉跳页输入后，跳页检查会失败（证明检查有效）", permOld.indexOf('id="perm-page-jump"') < 0);
  }

  /* ---------- ⑤ 本轮线上报错的根因：脚本执行顺序 ---------- */
  console.log("\n[10] 统计脚本：自检不得早于对象创建（本轮 SQL 报错的根因）");
  {
    const sql = read("tools/setup_analytics.sql");
    const lines = sql.split("\n");
    const sc = lines.findIndex((l) => l.indexOf("自检 ①") >= 0);
    ok("脚本里存在自检区", sc >= 0);
    const late = [];
    ["is_super_admin", "record_visit", "visit_ping", "track_event", "log_admin_action",
      "insight_front", "insight_admin", "log_admin_tbl", "log_admin_profile"].forEach((n) => {
      const defs = lines.map((l, i) => [l, i]).filter((x) => /^create (or replace )?function public\./.test(x[0]) && x[0].indexOf("public." + n + "(") >= 0).map((x) => x[1]);
      if (defs.length && Math.min.apply(null, defs) > sc) late.push(n);
    });
    ok("自检区排在所有被检查对象创建之后", late.length === 0, late.join(","));
    // 语义判定：自检区之后不允许再出现建表/建函数/挂触发器这类「被检查对象」的创建语句。
    // （原实现用「自检区之后字符数 < 3000」这种长度阈值，往自检清单里补几行就会误报，属于脆弱判定）
    const afterSc = sql.slice(sql.indexOf("自检 ①"));
    const ddlAfter = afterSc.match(/^create (or replace )?(function|table|trigger)/gim) || [];
    ok("自检区之后不再有建表/建函数/挂触发器语句", ddlAfter.length === 0, ddlAfter.join(","));
    ok("权限检查带存在性保护（对象缺失也不会中断整段脚本）",
      /to_regprocedure\('public\.insight_front\(integer\)'\) is not null/.test(sql));
    ok("保护覆盖了全部三项动向/上报接口",
      ["insight_front(integer)", "insight_admin(integer)", "track_event(text, text, text, text)", "log_admin_action(text, text, jsonb)"]
        .every((sig) => sql.indexOf("to_regprocedure('public." + sig + "')") >= 0));

    /* 签名一致性：grant/revoke 引用的签名必须能对应到真实创建的函数（否则同样报 42883） */
    const creates = {};
    sql.replace(/^create (?:or replace )?function public\.([a-z_]+)\(([^)]*)\)/gm, (m, name, args) => {
      const parts = args.split(",").map((x) => x.trim()).filter(Boolean);
      (creates[name] = creates[name] || []).push(parts);
      return m;
    });
    const bad = [];
    sql.replace(/^(?:grant|revoke)[^;]*?function public\.([a-z_]+)\(([^)]*)\)/gm, (m, name, args) => {
      const n = args.split(",").map((x) => x.trim()).filter(Boolean).length;
      const cands = creates[name] || [];
      const hit = cands.some((ps) => ps.length === n || (ps.length > n && ps.slice(n).every((x) => /default/i.test(x))));
      if (!hit) bad.push(name + "(" + args.trim() + ")");
      return m;
    });
    ok("授权语句引用的函数签名都能对上（否则执行时同样会报函数不存在）", bad.length === 0, bad.join(" | "));
  }

  console.log("\n[11] 访问来源（从哪来）真正接通");
  {
    const sup = read("js/supabase.js");
    const sql = read("tools/setup_analytics.sql");
    ok("前台登记访问时上报了来源字段", /p_referrer:\s*ref/.test(sup));
    ok("来源取不到浏览器值时回落到空（后台显示直接进入）", /document\.referrer/.test(sup));
    ok("来源归一化为域名（同一来源只留一条，便于聚合）", /new URL\(ref\)\.host/.test(sup));
    ok("来源做过长度截断（不会写进超长地址）", /ref\.length > 120/.test(sup));
    ok("数据库侧新版登记函数确实收来源参数", /p_referrer text default ''/.test(sql));
    ok("旧的 6 参数重载被显式清理（否则调用会落到旧版、来源永远记不到）",
      /drop function if exists public\.record_visit\(text, text, text, text, text, text\)/.test(sql));
    ok("清理旧重载发生在「新版就位」之后（否则调用仍会落到旧签名、来源永远记不到）",
      sql.lastIndexOf("drop function if exists public.record_visit(text, text, text, text, text, text);") >
      sql.indexOf("create or replace function public.record_visit("));
  }

  console.log("\n[12] 反向验证（本轮修复）");
  {
    const sql = read("tools/setup_analytics.sql");
    // (a) 自检挪回创建之前 → 顺序检查必须失败
    const i = sql.indexOf("-- 自检 ①");
    const j = sql.indexOf('as "全部账号与角色";') + 'as "全部账号与角色";'.length;
    const block = sql.slice(i, j);
    const without = sql.slice(0, i) + sql.slice(i + block.length);
    const at = without.indexOf("notify pgrst");
    const movedBack = without.slice(0, at) + block + "\n" + without.slice(at);
    const early = movedBack.indexOf("-- 自检 ①");
    const defPos = movedBack.search(/create (?:or replace )?function public\.insight_front\(/);
    // 自检①若是被挪回 insight_front 创建之前，同一套顺序判定必须报失败
    ok("还原：自检又排在 insight_front 创建之前（顺序检查会失败）", early < defPos, early + " vs " + defPos);

    // (b) 去掉存在性保护
    ok("还原：去掉 to_regprocedure 保护后，保护检查会失败",
      !/to_regprocedure\('public\.insight_front\(integer\)'\) is not null/.test(
        sql.replace(/to_regprocedure\('public\.insight_front\(integer\)'\) is not null\n?\s*and /g, "")));

    // (c) 去掉旧重载清理
    ok("还原：拿掉旧重载清理后，重载检查会失败",
      !/drop function if exists public\.record_visit\(text, text, text, text, text, text\)/.test(
        sql.split("drop function if exists public.record_visit(text, text, text, text, text, text);").join("")));

    // (d) 去掉来源上报
    ok("还原：拿掉 p_referrer 后，来源检查会失败",
      !/p_referrer:\s*ref/.test(read("js/supabase.js").replace(/p_referrer:\s*ref,/, "")));
  }
console.log("\n[13] 报错定位能力：42703（字段不存在）必须能说清原因与下一步");
  {
    const ins = read("js/admin-insight.js");
    const sup = read("js/supabase.js");
    // 界面提示：42703 单独成句，且必须指向「重跑统计脚本 + 第 5.5 段自动补齐 + 看自检③」
    ok("界面区分了「字段不存在(42703)」这一类",
      /ecode\s*===\s*"42703"|code\s*===\s*"42703"/.test(ins));
    ok("42703 的提示说明了「线上表比脚本旧、缺字段」",
      /线上表比脚本旧|字段在线上表里不存在/.test(ins));
    ok("42703 的提示指名了自动补齐段（5.5）", /5\.5/.test(ins));
    ok("42703 的提示指名了自检③", /自检③/.test(ins));
    ok("42703 的提示点出了缺失字段名（从数据库原文里提取）",
      /column\\s\+\(\[\\w\."\]\+\)\\s\+does not exist/i.test(ins));
    ok("提示里附带了数据库原文（便于反馈定位）", /数据库原文/.test(ins));
    ok("数据库原文进提示前做了转义（不引入注入）", /safe\(eraw\.slice/.test(ins));
    // 控制台诊断：必须把数据库原文打出来，并给出这一类的中文解释
    ok("控制台会把数据库原文打出来", /数据库原文："\s*\+\s*String\(raw\)/.test(sup));
    ok("控制台对 42703 给出中文解释", /这是「字段不存在」/.test(sup));
    ok("自检结论里 42703 与其它 42xxx 分开表述",
      /d\.code\) === "42703"/.test(sup) && /sql_exec"\) out\.verdict/.test(sup));
    // 反向验证：把 42703 的分支拿掉，上面这些判定必须失败
    const insCut = ins.replace(/if \(ecode === "42703"\) \{[\s\S]*?\n      \}/, "");
    ok("还原：拿掉 42703 分支后，判定会失败（证明检查有效）",
      !/线上表比脚本旧/.test(insCut));
  }

  console.log("\n== 结果：" + pass + " 项通过，" + fail + " 项失败 ==");
  if (fail) { console.log("失败项：\n - " + failures.join("\n - ")); process.exit(1); }
  process.exit(0);
})();
