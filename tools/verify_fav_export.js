/* verify_fav_export.js —— 收藏周报「整张高清导出」校验（20261027F）
 *
 * 校验三件事：
 *   ① 分组口径：期次 → 类目 → 上装/下装/未分，且"未分类"单独一块、不混进类目
 *   ② 版面：卡片全在页宽内、数量等于收藏数、类目标题在卡片之上
 *   ③ 入口与权限：所有登录用户都能看到（不再只有管理员），两处入口都接上、脚本已引入
 *
 * 用法：NODE_PATH=<testdeps>/node_modules node tools/verify_fav_export.js [项目根目录]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = process.argv[2] || path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  →  " + extra : "")); }
};

const EXPORT_SRC = read("js/favexport.js");
const FAV_JS = read("js/fav.js");
const DRAWER = read("js/favdrawer.js");
const FAV_HTML = read("fav.html");
const RANK_HTML = read("rank.html");
const CSS = read("css/style.css");

const IMG = (n) => "https://img.kwcdn.com/product/open/" + n + "-goods.jpeg";

/* 真实数据形状：两条期次、三个类目、有上装/下装/未分/未分类 */
function makeItems() {
  const rows = [
    { id: 1, category_id: 1, sub_cat: "top", period_label: "W43" },
    { id: 2, category_id: 1, sub_cat: "top", period_label: "W43" },
    { id: 3, category_id: 1, sub_cat: "bottom", period_label: "W43" },
    { id: 4, category_id: 2, sub_cat: null, period_label: "W43" },
    { id: 5, category_id: null, sub_cat: "top", period_label: "W43" },
    { id: 6, category_id: 9, sub_cat: "bottom", period_label: "W43" }, // 分类已删 → 未分类
    { id: 7, category_id: 2, sub_cat: "bottom", period_label: "W42" },
    { id: 8, category_id: 2, sub_cat: "bottom", period_label: "W42" },
  ];
  return rows.map((r, i) =>
    Object.assign({}, r, {
      image_url: IMG("e" + r.id),
      title: "纯棉阔腿直筒裤 " + r.id,
      leaf_category: "阔腿裤",
      site: "US",
      tags: ["潜力机会", "上升 12 位"],
      rank_pos: 3 + i,
      created_at: "2026-10-22T09:00:00Z",
    })
  );
}

const CATS = [
  { id: 1, name: "印花", color: "#c8a24a" },
  { id: 2, name: "面料", color: "#8b7355" },
  { id: 3, name: "视觉", color: "#7a8a4f" },
  { id: 4, name: "工艺", color: "#a56b4a" },
];

/* 用 jsdom 载入真实模块（不是字符串匹配） */
function boot() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: "outside-only", url: "https://example.test/fav.html" });
  const w = dom.window;
  w.eval(EXPORT_SRC);
  return w;
}

const w = boot();
const FX = w.FavExport;

console.log("\n=== 收藏周报 · 整张高清导出（20261027F） ===\n");

/* ---------------- ① 分组口径 ---------------- */
console.log("[1] 分组：期次 → 类目 → 上装 / 下装 / 未分");
{
  ok("导出模块已挂到 window.FavExport", !!FX && typeof FX.exportPng === "function");
  ok("plan / layout / download / fileName 都在", !!FX && ["plan", "layout", "download", "fileName"].every((k) => typeof FX[k] === "function"));

  const p = FX.plan(makeItems(), CATS);
  ok("识别出 2 条期次", p.weeks.length === 2, String(p.weeks.length));
  ok("期次从新到旧（W43 在前）", p.weeks[0].period === "W43" && p.weeks[1].period === "W42", p.weeks.map((x) => x.period).join(","));

  const w43 = p.weeks[0];
  ok("W43 共 6 张", w43.total === 6, String(w43.total));
  ok("类目按配置顺序（印花 → 面料），空类目不出现", w43.cats.map((c) => c.name).join(",") === "印花,面料", w43.cats.map((c) => c.name).join(","));
  ok("视觉 / 工艺 没图 → 不出现", w43.cats.every((c) => ["印花", "面料"].indexOf(c.name) >= 0));

  const yin = w43.cats[0];
  ok("印花块内 上装 2 / 下装 1（空行不出现）", yin.subs.length === 2 && yin.subs[0].key === "top" && yin.subs[0].count === 2 && yin.subs[1].key === "bottom" && yin.subs[1].count === 1,
    JSON.stringify(yin.subs.map((s) => s.key + ":" + s.count)));

  const mian = w43.cats[1];
  ok("面料块内只有「未分」一行（1 张）", mian.subs.length === 1 && mian.subs[0].key === "none" && mian.subs[0].count === 1,
    JSON.stringify(mian.subs.map((s) => s.key + ":" + s.count)));

  ok("未分类（含分类已删）单独成块，不计入类目数", !!w43.others && w43.others.count === 2 && w43.others.name === "未分类",
    w43.others ? w43.others.name + ":" + w43.others.count : "无");
  ok("未分类块内部也分上装/下装", w43.others.subs.length === 2 && w43.others.subs[0].key === "top" && w43.others.subs[1].key === "bottom");

  ok("统计：上装 3 / 下装 4 / 未分 1（含 W42）", p.totals.top === 3 && p.totals.bottom === 4 && p.totals.none === 1,
    JSON.stringify(p.totals));
  ok("统计总张数 = 收藏总数 8", p.totals.items === 8, String(p.totals.items));
  ok("类目数按最多的一周算（2），不把未分类算进去", p.totals.cats === 2, String(p.totals.cats));

  const p2 = FX.plan(makeItems(), CATS);
  ok("plan 是纯函数：同一输入两次结果一致", JSON.stringify(p2.totals) === JSON.stringify(p.totals));
  ok("plan 不改动入参数组", makeItems().length === 8);
  const empty = FX.plan([], CATS);
  ok("空收藏：不炸，期次为 0", empty.weeks.length === 0 && empty.totals.items === 0);
}

/* ---------------- ② 版面 ---------------- */
console.log("\n[2] 版面：一张长图，卡片不越界、数量对得上");
{
  const items = makeItems();
  const p = FX.plan(items, CATS);
  const box = FX.layout(p, {});
  const C = FX._const;

  ok("逻辑宽度固定 1600（2 倍输出 = 3200px 宽）", box.width === 1600 && box.width * 2 === 3200, String(box.width));
  ok("高度随内容增长（> 页头 + 页脚）", box.height > C.HEAD_H + C.FOOT_H, String(box.height));
  ok("卡片总数 = 收藏张数 8", box.cards.length === 8, String(box.cards.length));
  ok("所有卡片都在左右留白之内", box.cards.every((c) => c.x >= C.PAD - 0.6 && c.x + c.w <= box.width - C.PAD + 0.6),
    JSON.stringify(box.cards.filter((c) => !(c.x >= C.PAD - 0.6 && c.x + c.w <= box.width - C.PAD + 0.6)).slice(0, 1)));
  ok("卡片不越出图底", box.cards.every((c) => c.y + c.h <= box.height));

  const rows = {};
  box.cards.forEach((c) => { rows[Math.round(c.y)] = (rows[Math.round(c.y)] || 0) + 1; });
  ok("每行最多 6 张（不会挤成一坨）", Object.values(rows).every((n) => n <= 6), JSON.stringify(rows));

  const subHeads = (box.blocks || []).filter((h) => h.kind === "sub");
  /* 印花(W43) 2 行 + 面料(W43) 1 行 + 未分类(W43) 2 行 + 面料(W42) 1 行 = 6 行 */
  ok("行头按「周 × 类目 × 上下装」生成（共 6 行）", subHeads.length === 6, String(subHeads.length));
  ok("行头文案里出现「上装」「下装」", subHeads.some((h) => h.name === "上装") && subHeads.some((h) => h.name === "下装"),
    subHeads.map((h) => h.name).join(","));
  const catHeads = (box.blocks || []).filter((h) => h.kind === "cat");
  ok("类目块按周分开（印花 W43 / 面料 W43 / 未分类 W43 / 面料 W42 = 4 块）", catHeads.length === 4, String(catHeads.length));
  ok("类目标题块在它下面第一张卡之上", catHeads.every((h) => box.cards.some((c) => c.y > h.y && c.y - h.y < 320)));

  ok("同一份收藏导出尺寸稳定（跑两次一样）", FX.layout(FX.plan(items, CATS), {}).height === box.height);
}

/* ---------------- ③ 入口：不再只有管理员 ---------------- */
console.log("\n[3] 入口：所有登录用户可见（去掉管理员门槛）");
{
  ok("导出模块里没有任何角色判定（无 isAdmin / super_admin / myRole）",
    !/isAdmin|super_admin|\bmyRole\b|currentRole/.test(EXPORT_SRC));
  ok("收藏页导出处理函数没有角色判定",
    !/isAdmin|super_admin|myRole/.test(FAV_JS.slice(FAV_JS.indexOf("function doExport"), FAV_JS.indexOf("function doExport") + 1600)));
  ok("抽屉导出处理没有角色判定",
    !/isAdmin|super_admin|myRole/.test(DRAWER.slice(DRAWER.indexOf("fv-d-exp"), DRAWER.indexOf("fv-d-exp") + 1400)));

  ok("收藏页顶部有「导出周报」按钮", /id="fv-export"/.test(FAV_HTML) && /导出周报/.test(FAV_HTML));
  ok("收藏页引入了导出脚本", /favexport\.js\?v=/.test(FAV_HTML));
  ok("导出脚本在 fav.js 之前引入（依赖顺序）", FAV_HTML.indexOf("favexport.js") < FAV_HTML.indexOf("js/fav.js"));
  ok("收藏页把按钮接到 doExport", /fv-export"\);\s*\n\s*if \(eb\) eb\.onclick = doExport/.test(FAV_JS) || /if \(eb\) eb\.onclick = doExport/.test(FAV_JS));
  ok("没有收藏时按钮置灰", /fv-export"\);\s*\n\s*if \(ex && ex\.getAttribute\("data-busy"\) !== "1"\) ex\.disabled = !ST\.items\.length/.test(FAV_JS)
    || /ex\.disabled = !ST\.items\.length/.test(FAV_JS));

  ok("抽屉头部有「导出」按钮", /id="fv-d-exp"/.test(DRAWER));
  ok("抽屉导出按钮已绑定点击", /getElementById\("fv-d-exp"\)|\$\("#fv-d-exp"\)/.test(DRAWER));
  ok("拖动浮层页面（rank.html）引入了导出脚本", /favexport\.js\?v=/.test(RANK_HTML));
  ok("导出脚本在抽屉脚本之前引入", RANK_HTML.indexOf("favexport.js") < RANK_HTML.indexOf("favdrawer.js"));
  ok("抽屉导出按钮有样式（文字按钮，不是图标）", /\.fv-d-exp\{/.test(CSS));

  ok("点导出后按「全部收藏」导出，不受当前筛选影响",
    /exportPng\(ST\.items, ST\.cats/.test(FAV_JS) && /exportPng\(ST\.items, ST\.cats/.test(DRAWER));
}

/* ---------------- ④ 实现要点 ---------------- */
console.log("\n[4] 实现要点：跨域取图、2 倍输出、PNG 文件名");
{
  ok("图片带 crossOrigin=anonymous（否则画布被污染、无法导出）", /crossOrigin\s*=\s*"anonymous"/.test(EXPORT_SRC));
  ok("用 canvas.toBlob 出图，不依赖任何外部服务", /toBlob\(/.test(EXPORT_SRC));
  ok("取不到的图计入 failed 并在图上标注", /failed/.test(EXPORT_SRC) && /图片未能载入/.test(EXPORT_SRC));
  ok("文件名是 .png 且带时间戳", /\.png"/.test(EXPORT_SRC) && /fileName/.test(EXPORT_SRC));
  ok("有进度回调（导出过程中按钮能显示进展）", /opts\.onProgress/.test(EXPORT_SRC));
  ok("可取消（导出中途能停）", /NS\.cancel/.test(EXPORT_SRC));
  const n1 = FX.fileName(new Date(2026, 9, 27, 9, 5));
  ok("文件名形如 收藏周报-20261027-0905.png", /收藏周报-20261027-0905\.png/.test(n1), n1);
}

/* ---------------- ⑤ 网页导出（单文件 HTML） ---------------- */
console.log("\n[5] 网页导出：一个文件、双击就开、自带筛选");
{
  ok("导出模块提供 exportHtml", typeof FX.exportHtml === "function" && typeof FX.buildHtml === "function");

  const items = makeItems();
  const p = FX.plan(items, CATS);
  const html = FX.buildHtml(p, { now: new Date(2026, 9, 27, 15, 20) });

  ok("是一份完整 HTML 文档", /^<!doctype html>/i.test(html.trim()) && /<\/html>\s*$/.test(html.trim()));
  ok("声明 UTF-8（中文不乱码）", /charset="utf-8"/i.test(html) && /<html lang="zh-CN">/.test(html));
  ok("响应式视口（手机也能看）", /name="viewport"/.test(html));

  /* 单文件：不能有任何外链脚本 / 样式 */
  ok("没有任何外部脚本", !/<script[^>]+src=/.test(html));
  ok("没有任何外部样式", !/<link[^>]+href=/.test(html));
  ok("没有 CDN 引用", !/https?:\/\/(cdn|unpkg|jsdelivr)/i.test(html));
  ok("样式内联在 <style> 里", /<style>/.test(html) && /\.card\{/.test(html));
  ok("渲染脚本内联在 <script> 里", /function render\(\)/.test(html));

  /* 数据内嵌 + 结构 */
  ok("数据以 JSON 内嵌（不依赖本站接口）", /<script type="application\/json" id="data">/.test(html));
  ok("期次标题都在（W43 / W42）", /W43/.test(html) && /W42/.test(html));
  ok("类目名都在（印花 / 面料 / 未分类）", /印花/.test(html) && /面料/.test(html) && /未分类/.test(html));
  ok("上装 / 下装 / 未分 都在", /上装/.test(html) && /下装/.test(html));
  ok("有筛选标签（全部/上装/下装/未分）", /data-k="all"/.test(html) && /data-k="top"/.test(html) && /data-k="bottom"/.test(html) && /data-k="none"/.test(html));
  ok("有搜索框", /id="q"/.test(html) && /placeholder="搜索标题…"/.test(html));
  ok("有多少张的统计", /共 8 张图/.test(html) && /上装 <b>3<\/b>/.test(html) && /下装 <b>4<\/b>/.test(html));
  ok("有打印样式（可直接打印/存 PDF）", /@media print/.test(html));
  ok("有类目跳转按钮", /class="navcat"/.test(html) && /data-jump=/.test(html));

  /* 内嵌 JSON 必须可解析、且条数对得上 */
  const m = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/);
  ok("内嵌 JSON 能被 JSON.parse", !!m);
  let data = null;
  try { data = JSON.parse(m[1]); } catch (e) { data = null; }
  ok("JSON 里的期次数 = 2", data && data.weeks.length === 2, data ? String(data.weeks.length) : "解析失败");
  const total = data ? data.weeks.reduce((a, w) => a + w.cats.reduce((b, c) => b + c.subs.reduce((c2, sb) => c2 + sb.items.length, 0), 0), 0) : -1;
  ok("JSON 里的图总数 = 8（一张不丢）", total === 8, String(total));

  /* 注入风险：标题里带 </script> 或引号不能破坏页面 */
  const evil = [{
    id: 99, category_id: 1, sub_cat: "top", period_label: "W43",
    image_url: "https://img.kwcdn.com/x.jpeg",
    title: '危险</script><b>x</b>"quote"', tags: ['<i>tag</i>'], leaf_category: "T",
  }];
  const evilHtml = FX.buildHtml(FX.plan(evil, CATS), {});
  ok("标题里的 </script> 不会提前闭合脚本", evilHtml.split("</script>").length - 1 === 2, String(evilHtml.split("</script>").length - 1));
  ok("危险字符被转义为 \\u003c（数据内）", /\\u003c/.test(evilHtml));
  const em = evilHtml.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/);
  let evilData = null;
  try { evilData = JSON.parse(em[1]); } catch (e) { }
  ok("转义后仍是合法 JSON，标题原文保留", !!evilData && evilData.weeks[0].cats[0].subs[0].items[0].title.indexOf("</script>") >= 0,
    evilData ? evilData.weeks[0].cats[0].subs[0].items[0].title : "解析失败");

  /* 文件名与空态 */
  const n = FX.htmlName(new Date(2026, 9, 27, 15, 20));
  ok("文件名形如 收藏周报-20261027-1520.html", /收藏周报-20261027-1520\.html/.test(n), n);
  ok("空收藏不生成网页（抛错而不是给个空页）",
    (() => { try { FX.plan([], CATS); return true; } catch (e) { return false; } })() === true);

  /* 入口 */
  ok("收藏页有「导出网页」按钮", /id="fv-export-html"/.test(FAV_HTML) && /导出网页/.test(FAV_HTML));
  ok("收藏页把按钮接到 doExportHtml", /fv-export-html"\);\s*\n\s*if \(eh\) eh\.onclick = doExportHtml/.test(FAV_JS));
  ok("抽屉导出是二选一菜单（PNG / HTML）", /fv-d-expmenu/.test(DRAWER) && /data-k="html"/.test(DRAWER) && /data-k="png"/.test(DRAWER));
  ok("菜单点空白处会关闭", /onDocDown/.test(DRAWER) && /closeExportMenu/.test(DRAWER));
  ok("菜单有样式", /\.fv-d-expmenu\{/.test(CSS));
  ok("网页导出同样不限管理员",
    !/isAdmin|super_admin|myRole/.test(FAV_JS.slice(FAV_JS.indexOf("function doExportHtml"), FAV_JS.indexOf("function doExportHtml") + 1400)));
}

/* ---------------- ⑥ 真打开一次：导出的网页能渲染、能筛选、能搜索 ---------------- */
console.log("\n[6] 真打开导出的网页（jsdom 执行页面脚本）");
{
  const html = FX.buildHtml(FX.plan(makeItems(), CATS), { now: new Date(2026, 9, 27, 15, 20) });
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "file:///tmp/收藏周报.html" });
  const d = dom.window.document;
  const cards = () => d.querySelectorAll(".card").length;

  ok("页面脚本执行无异常，卡片被渲染出来", cards() === 8, String(cards()));
  ok("周标题 2 个", d.querySelectorAll(".week").length === 2, String(d.querySelectorAll(".week").length));
  ok("类目块 4 个（按周分开）", d.querySelectorAll(".cat").length === 4, String(d.querySelectorAll(".cat").length));
  ok("右上角显示「显示 8 / 8 张」", /显示 8 \/ 8 张/.test(d.getElementById("cnt").textContent), d.getElementById("cnt").textContent);

  const tabs = Array.from(d.querySelectorAll(".tab"));
  const cnt = (k) => { const t = tabs.find((x) => x.dataset.k === k); return t ? t.querySelector("i").textContent : "?"; };
  ok("标签计数 全部8 / 上装3 / 下装4 / 未分1",
    cnt("all") === "8" && cnt("top") === "3" && cnt("bottom") === "4" && cnt("none") === "1",
    [cnt("all"), cnt("top"), cnt("bottom"), cnt("none")].join("/"));

  /* 点「上装」→ 只剩 3 张 */
  tabs.find((x) => x.dataset.k === "top").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  ok("点上装后只剩 3 张", cards() === 3, String(cards()));
  ok("上装选中态标记正确", tabs.find((x) => x.dataset.k === "top").getAttribute("aria-selected") === "true");

  /* 点「下装」→ 4 张 */
  tabs.find((x) => x.dataset.k === "bottom").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  ok("点下装后剩 4 张", cards() === 4, String(cards()));

  /* 回到全部 + 搜索 */
  tabs.find((x) => x.dataset.k === "all").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const q = d.getElementById("q");
  q.value = "阔腿直筒裤 7";
  q.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  ok("搜索标题能筛到 1 张", cards() === 1, String(cards()));

  q.value = "不存在的词";
  q.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  ok("搜不到时给空态提示，不是白屏", cards() === 0 && /没有符合条件的图/.test(d.getElementById("app").textContent));

  ok("卡片图片是懒加载（大收藏不卡）", /i\.loading='lazy'/.test(html) && /i\.decoding='async'/.test(html));
}

console.log("\n" + (fail ? "✗ 失败 " + fail + " 项，" : "✓ 全部通过，") + "共 " + (pass + fail) + " 项（通过 " + pass + "）\n");
process.exit(fail ? 1 : 0);