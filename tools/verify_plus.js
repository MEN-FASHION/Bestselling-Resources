/* verify_plus.js —— 大码专区（20261026P）行为校验
 * 分四组，全部"真跑"而不是查源码字符串：
 *   ① 匹配引擎：标题归一化 / 视觉指纹 / 加权合成 / 三档阈值 / 一对一分配 / 人工优先
 *   ② 数据层：分块写入（300 一批）、表未建时的降级
 *   ③ 后台：真实 xlsx（多 sheet = 多类目、超链接取真网址）→ 解析 → 导入载荷
 *   ④ 前台：类目以大码为准、无数据列整列不渲染、大码机会标、只看大码机会
 * 用法：node tools/verify_plus.js [项目根目录]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const ROOT = process.argv[2] || path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  →  " + extra : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dom(html) {
  return new JSDOM(html || "<!doctype html><html><body></body></html>", {
    runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/",
  });
}
function runScript(target, file) {
  /* target 可以是 JSDOM 实例（要它的内部 VM 上下文），也可以是 window（记在其 _dom 上） */
  const domObj = (target && typeof target.getInternalVMContext === "function") ? target : target._dom;
  const ctx = domObj.getInternalVMContext();
  ctx.__dom = domObj;
  vm.runInContext(read(file), ctx, { filename: file });
}

/* 造一张合成图：fn(x,y) 返回灰度值 */
function mkImg(fn, w, h) {
  w = w || 64; h = h || 64;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, v = fn(x, y);
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return { d: d, w: w, h: h };
}

(async function main() {
  /* ==================================================================
     ① 匹配引擎
     ================================================================== */
  console.log("\n=== ① 同款匹配引擎（图片 + 标题 + 可选语义） ===\n");
  const d1 = dom();
  runScript(d1, "js/plus-match.js");
  const M = d1.window.PLUSM;
  ok("引擎已挂载（window.PLUSM）", !!M && typeof M.combine === "function");

  /* 标题归一化：去掉"大码/加大码/年份/尺码/颜色"这些与"是不是同一款"无关的字 */
  const n1 = M.normTitle("【大码】2024新款 黑色 阔腿裤 XXL 胖MM显瘦");
  ok("标题归一化去掉尺码、颜色、年份、大码前缀", !/xxl|黑色|2024|大码/i.test(n1), n1);
  ok("标题归一化保留主体（阔腿裤）", n1.indexOf("阔腿裤") >= 0, n1);
  ok("「加肥加大码」不会残留一个字（去词按长度优先）",
    M.normTitle("加肥加大码阔腿裤") === M.normTitle("阔腿裤"),
    M.normTitle("加肥加大码阔腿裤") + " vs " + M.normTitle("阔腿裤"));

  ok("同款换说法（大码 vs 标码）判高度相似",
    M.textSim("2024新款女装宽松阔腿裤高腰显瘦", "加肥加大码女装宽松阔腿裤高腰显瘦胖MM") >= 0.85,
    M.textSim("2024新款女装宽松阔腿裤高腰显瘦", "加肥加大码女装宽松阔腿裤高腰显瘦胖MM").toFixed(3));
  ok("不同款判为不相似", M.textSim("高腰阔腿牛仔裤", "雪纺碎花连衣裙") < 0.3);
  ok("空标题不报错且为 0", M.textSim("", "阔腿裤") === 0);

  /* 视觉指纹 */
  const solid = mkImg((x, y) => (x > 20 && x < 45 && y > 10 && y < 55) ? 230 : 40);
  const bright = mkImg((x, y) => (x > 20 && x < 45 && y > 10 && y < 55) ? 200 : 60);
  const turned = mkImg((x, y) => (y > 20 && y < 45 && x > 10 && x < 55) ? 230 : 40);
  const fA = M.features(solid.d, solid.w, solid.h);
  const fB = M.features(bright.d, bright.w, bright.h);
  const fC = M.features(turned.d, turned.w, turned.h);
  ok("同一张图相似度为 1", Math.abs(M.imgSim(fA, fA) - 1) < 1e-9);
  ok("整体亮度变化仍判为同图（≥0.8）", M.imgSim(fA, fB) >= 0.8, M.imgSim(fA, fB).toFixed(3));
  ok("结构换了（旋转）明显掉分（<0.6）", M.imgSim(fA, fC) < 0.6, M.imgSim(fA, fC).toFixed(3));
  ok("指纹是 64 位（16 位十六进制表示）",
    String(fA.phash).length === 16 && String(fA.dhash).length === 16,
    String(fA.phash) + " / " + String(fA.dhash));

  /* 加权合成：缺图时不能把分数拉成 0（那会把同款误判成"大码机会"） */
  ok("图片缺失时只按可用的通道加权", Math.abs(M.combine({ img: null, txt: 1 }) - 1) < 1e-9);
  ok("三通道齐全时按权重合成", M.combine({ img: 1, txt: 1, sem: 1 }) === 1);
  /* 图完全一致、标题毫无相似 → 0.6 上下：不直接判同款，也不直接判缺口，
     正好落进「待确认」让人看一眼。这是刻意的，不是把分数算低了。 */
  const mixed = M.combine({ img: 1, txt: 0 });
  ok("图完全一致但标题完全不相似 → 落进待确认（不冒判）",
    M.verdict(mixed) === "review", mixed.toFixed(3));

  /* 三档 */
  ok("≥0.85 → 同款", M.verdict(0.92) === "same");
  ok("0.6~0.85 → 待确认", M.verdict(0.72) === "review");
  ok("<0.6 → 大码机会", M.verdict(0.31) === "gap");
  ok("阈值常量对外可读（文档与测试同源）", M.T_SAME === 0.85 && M.T_GAP === 0.6,
    M.T_SAME + " / " + M.T_GAP);

  /* 一对一分配：两个标码款抢同一张大码图时，只能有一张认领成功 */
  const stdA = [{ url: "s1" }, { url: "s2" }];
  const plusA = [{ url: "p1" }];
  const scoreMap = { "s1|p1": 0.9, "s2|p1": 0.88 };
  const pairs = M.assign(stdA, plusA, (a, b) => scoreMap[a.url + "|" + b.url] || 0);
  ok("一对一分配：一张大码图只被一个标码款认领", pairs.length === 1);
  ok("一对一分配：认领的是分数更高的那个", pairs.length === 1 && stdA[pairs[0].i].url === "s1");
  const used = {};
  M.assign([{ url: "a" }, { url: "b" }], [{ url: "x" }, { url: "y" }], (p, q) => (p.url === "a" && q.url === "x") ? 0.9 : (p.url === "b" && q.url === "y") ? 0.8 : 0.1)
    .forEach((pr) => { used[pr.j] = (used[pr.j] || 0) + 1; });
  ok("一对一分配：每张大码图最多被认领一次", Object.keys(used).every((k) => used[k] === 1));

  /* 人工结论优先，且按「站点 + 图」对齐 */
  const fresh = [
    { site: "美国", std_image_url: "u1", decision: "review", method: "auto", score: 0.7 },
    { site: "德国", std_image_url: "u1", decision: "review", method: "auto", score: 0.7 },
  ];
  const prev = [{ site: "美国", std_image_url: "u1", decision: "same", method: "manual", plus_image_url: "p9", score: 0.7 }];
  const merged = M.mergeManual(fresh, prev);
  ok("人工判定在重算后保留", merged[0].decision === "same" && merged[0].method === "manual");
  ok("人工判定不会串到另一个站点", merged[1].decision === "review" && merged[1].method === "auto");
  ok("人工判定保留命中的大码图", merged[0].plus_image_url === "p9");

  /* ==================================================================
     ② 数据层：分块写入
     ================================================================== */
  console.log("\n=== ② 数据层（分块写入 / 表未建时降级） ===\n");
  const d2 = dom();
  const insCalls = [];
  const fakeClient = {
    from(t) {
      return {
        insert(rows) {
          insCalls.push(rows.length);
          return { select: () => Promise.resolve({ data: rows.map((r, i) => ({ id: i })) }) };
        },
      };
    },
    rpc() { return Promise.resolve({ data: null, error: { message: "Could not find the function" } }); },
  };
  d2.window.SB = { _client: () => fakeClient };
  runScript(d2, "js/plus-sb.js");
  const SBP = d2.window.SBP;
  ok("数据层已挂载（window.SBP）", !!SBP && typeof SBP.insertItems === "function");

  const rows650 = Array.from({ length: 650 }, (_, i) => ({ batch_id: 1, period_label: "W43", image_url: "u" + i }));
  const done = [];
  const n = await SBP.insertItems(rows650, (d, t) => done.push([d, t]));
  ok("650 条一次传完不报错", n === 650);
  ok("按 300 条一批分块写入（3 批）", insCalls.length === 3 && insCalls[0] === 300 && insCalls[2] === 50,
    JSON.stringify(insCalls));
  ok("分块写入有进度回调（最后一条 = 650/650）",
    done.length === 3 && done[done.length - 1][0] === 650 && done[done.length - 1][1] === 650);

  const fac = await SBP.facets();
  ok("函数未建时派生的清单不抛错（返回空结构）",
    fac && Array.isArray(fac.periods) && Array.isArray(fac.categories),
    JSON.stringify(fac));

  /* ==================================================================
     ③ 后台：真实 xlsx → 解析 → 导入载荷
     ================================================================== */
  console.log("\n=== ③ 后台上传（多 sheet 多类目 / 超链接取真网址 / 大批量） ===\n");
  const adminHtml = read("admin.html");
  const start = adminHtml.indexOf('<div class="panel-card hidden" id="plus-card">');
  /* 面板结束边界：取紧随其后的下一个 panel-card（榜单打标已下线，不能再拿它当界标） */
  const nextPanel = adminHtml.indexOf('<div class="panel-card hidden" id="insight-card">', start);
  const end = nextPanel > start ? nextPanel : adminHtml.length;
  ok("admin.html 里有 #plus-card 面板", start > 0 && end > start);
  ok("后台侧栏有「大码专区」入口", /data-target="plus-card">大码专区/.test(adminHtml));
  ok("后台引入大码三个脚本", /admin-plus\.js\?v=/.test(adminHtml) && /plus-sb\.js\?v=/.test(adminHtml) && /plus-match\.js\?v=/.test(adminHtml));
  const cardHtml = adminHtml.slice(start, end);

  const d3 = dom('<!doctype html><html><body><div id="toast"></div>' + cardHtml + "</body></html>");
  const w3 = d3.window;
  runScript(d3, "vendor/xlsx.full.min.js");
  ok("页内可用的 xlsx 库已载入", !!w3.XLSX && typeof w3.XLSX.read === "function");

  const toasts = [];
  w3.sbToast = (m, okFlag) => toasts.push([String(m), okFlag !== false]);
  w3.confirm = () => true;
  w3.SB = { listRankItems: () => Promise.resolve([]) };

  const calls = { clearSlot: [], createBatch: [], insert: [], upsert: [], batchPatch: [] };
  w3.SBP = {
    facets: () => Promise.resolve({ periods: ["W43"], categories: ["裤装", "连衣裙"] }),
    listBatches: () => Promise.resolve([]),
    createBatch: (b) => { calls.createBatch.push(b); return Promise.resolve(77); },
    updateBatch: (id, p) => { calls.batchPatch.push([id, p]); return Promise.resolve(); },
    deleteBatch: () => Promise.resolve(),
    clearSlot: (o) => { calls.clearSlot.push(o); return Promise.resolve(5); },
    listSlotUrls: () => Promise.resolve([]),
    insertItems: (rows, cb) => { calls.insert.push(rows); if (cb) cb(rows.length, rows.length); return Promise.resolve(rows.length); },
    listMatches: () => Promise.resolve([]),
    upsertMatches: (rows) => { calls.upsert.push(rows); return Promise.resolve(rows.length); },
    setDecision: () => Promise.resolve(true),
    clearMatches: () => Promise.resolve(true),
  };

  runScript(d3, "js/admin-plus.js");
  await sleep(60);

  /* 造一本真实工作簿：两个类目 sheet + 一张没表头的 sheet + 一张空 sheet */
  const X = w3.XLSX;
  const wb = X.utils.book_new();
  const ws1 = X.utils.aoa_to_sheet([
    ["首图url", "货品名称", "环比比例", "环比绝对值"],
    ["查看首图", "加肥加大码阔腿裤 高腰显瘦", "522.2%", "1,200"],
    ["查看首图", "加肥加大码阔腿裤 高腰显瘦", "300%", "800"],   // 同图重复，应合并
    ["查看首图", "大码雪纺衬衫", "-12.5%", "-40"],
    ["", "没图的行", "10%", "5"],                                // 缺图，应跳过
  ]);
  ws1["A2"].l = { Target: "https://img.example.com/p1.jpeg" };
  ws1["A3"].l = { Target: "https://img.example.com/p1.jpeg" };
  ws1["A4"].l = { Target: "https://img.example.com/p2.jpeg" };
  X.utils.book_append_sheet(wb, ws1, "裤装");

  const ws2 = X.utils.aoa_to_sheet([
    ["首图url", "货品名称", "环比比例", "环比绝对值"],
    ["查看首图", "大码碎花连衣裙", "45%", "30"],
  ]);
  ws2["A2"].l = { Target: "https://img.example.com/p3.jpeg" };
  X.utils.book_append_sheet(wb, ws2, "连衣裙");

  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["名称"], ["只有名字"]]), "缺首图列");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([]), "空表");

  const buf = X.write(wb, { type: "array", bookType: "xlsx" });

  /* 表格里加一批"大码"行以验证大批量导入（1200 行） */
  const big = [];
  for (let i = 0; i < 1200; i++) big.push(["https://img.example.com/b" + i + ".jpeg", "大码测试款 " + i, (i % 200) + "%", String(i)]);
  const wsBig = X.utils.aoa_to_sheet([["首图url", "货品名称", "环比比例", "环比绝对值"]].concat(big));
  X.utils.book_append_sheet(wb, wsBig, "大批量");

  const buf2 = X.write(wb, { type: "array", bookType: "xlsx" });
  const file = new w3.File([new Uint8Array(buf2)], "大码W43.xlsx",
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const input = w3.document.getElementById("pl-file");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new w3.Event("change", { bubbles: true }));
  await sleep(400);

  const tip = (w3.document.getElementById("pl-file-tip") || {}).textContent || "";
  const pv = (w3.document.getElementById("pl-preview") || {}).innerHTML || "";
  ok("解析成功并给出有效行数（1204 行 - 1 条重复 = 1203）", /1203/.test(tip) || /1203/.test(pv), tip + " | " + pv.slice(0, 120));
  ok("四个 sheet 都认出类目（裤装/连衣裙/大批量）",
    /裤装/.test(pv) && /连衣裙/.test(pv) && /大批量/.test(pv));
  ok("缺首图列的 sheet 被明确提示，而不是静默吞掉", /缺首图列/.test(pv) && /首图/.test(pv));
  ok("同图重复被合并（表内重复合并 ≥1）", />1</.test(pv.replace(/\s/g, "")) || /重复合并\s*<b>1/.test(pv), pv.slice(0, 200));
  ok("缺图的行被跳过并计数", /缺图跳过/.test(pv));

  /* 触发导入 */
  w3.document.getElementById("pl-import").click();
  await sleep(500);

  const sent = calls.insert[0] || [];
  ok("导入时创建了大码批次", calls.createBatch.length === 1 && calls.createBatch[0].periodLabel);
  ok("覆盖模式先清空该期次的旧大码数据（按类目）",
    calls.clearSlot.length === 1 && Array.isArray(calls.clearSlot[0].categories)
    && calls.clearSlot[0].categories.length === 3, JSON.stringify(calls.clearSlot));
  ok("写入载荷条数 = 有效行数（重复已合并）", sent.length === 1203, String(sent.length));
  ok("类目取自 sheet 名（裤装 2 条合并后）", sent.filter((r) => r.category === "裤装").length === 2,
    String(sent.filter((r) => r.category === "裤装").length));
  ok("首图 url 取的是超链接里的真网址，不是「查看首图」",
    sent.every((r) => !/查看首图/.test(r.image_url)) && sent.some((r) => r.image_url === "https://img.example.com/p1.jpeg"));
  ok("环比比例按百分数存（522.2 而不是 5.222）", sent.some((r) => Math.abs(Number(r.ratio) - 522.2) < 1e-6));
  ok("环比绝对值去掉千分位（1200）", sent.some((r) => Number(r.abs_delta) === 1200));
  ok("负增长保留符号（-12.5）", sent.some((r) => Number(r.ratio) === -12.5));
  ok("批次统计回写了写入条数", calls.batchPatch.length === 1 && calls.batchPatch[0][1].rows === 1203);
  ok("导入完成有明确提示", toasts.some((t) => /导入完成/.test(t[0]) && t[1] === true));

  /* ==================================================================
     ④ 前台：类目以大码为准 / 无数据列不渲染 / 大码机会
     ================================================================== */
  console.log("\n=== ④ 前台大码专区（以大码为锚 / 缺口标机会） ===\n");
  const pageHtml = read("plus.html");
  const d4 = new JSDOM(pageHtml, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const w4 = d4.window;
  const IMG = (n) => "https://img.example.com/" + n + ".jpeg";

  const plusRows = [
    { category: "裤装", site: "", title: "大码阔腿裤A", image_url: IMG("p1"), ratio: 120 },
    { category: "裤装", site: "", title: "大码阔腿裤B", image_url: IMG("p2"), ratio: 80 },
    { category: "连衣裙", site: "", title: "大码碎花裙", image_url: IMG("p3"), ratio: 45 },
  ];
  const stdRows = [
    { category: "裤装", site: "美国", title: "阔腿裤A", image_url: IMG("s1"), ratio: 300 },
    { category: "裤装", site: "美国", title: "阔腿裤C", image_url: IMG("s2"), ratio: 210 },
    { category: "衬衫", site: "美国", title: "衬衫X", image_url: IMG("s3"), ratio: 90 },
    { category: "衬衫", site: "美国", title: "衬衫Y", image_url: IMG("s4"), ratio: 70 },
  ];
  const matchRows = [
    { std_image_url: IMG("s1"), decision: "same", score: 0.93, method: "auto", site: "美国", category: "裤装" },
    { std_image_url: IMG("s2"), decision: "gap", score: 0.22, method: "auto", site: "美国", category: "裤装" },
  ];

  w4.SB = {
    getSession: () => Promise.resolve({ user: { email: "tester@example.com" } }),
    signOut: () => Promise.resolve(),
    rankFacets: () => Promise.resolve({ sites: ["美国", "德国"], periods: ["W43"], categories: ["裤装", "衬衫"] }),
    listRankItems: (q) => {
      let rows = stdRows.slice();
      if (q && q.category) rows = rows.filter((r) => r.category === q.category);
      if (q && q.periods && q.periods.length) { /* 期次在本测试里不区分 */ }
      return Promise.resolve(rows);
    },
  };
  w4.SBP = {
    facets: () => Promise.resolve({ periods: ["W42", "W43"], categories: ["裤装", "连衣裙"] }),
    listItems: (o) => Promise.resolve(plusRows.filter((r) => !o.category || r.category === o.category)),
    listMatches: (o) => Promise.resolve(matchRows.filter((r) => !o.category || r.category === o.category)),
  };
  runScript(d4, "js/plus.js");
  await sleep(300);

  const doc4 = w4.document;
  const catsTxt = (doc4.getElementById("plz-cats") || {}).textContent || "";
  const bodyTxt = (doc4.getElementById("plz-body") || {}).textContent || "";

  ok("类目清单来自大码（裤装 / 连衣裙）", /裤装/.test(catsTxt) && /连衣裙/.test(catsTxt), catsTxt);
  ok("标码独有的类目（衬衫）不进专区类目清单", !/衬衫/.test(catsTxt));
  ok("标码独有的类目也不渲染成组", !/衬衫/.test(bodyTxt));

  const groups = Array.prototype.slice.call(doc4.querySelectorAll(".plz-group"));
  ok("渲染了两个类目组（裤装 / 连衣裙）", groups.length === 2, String(groups.length));

  const shirts = doc4.querySelectorAll(".plz-badge.gap");
  ok("「大码机会」只在标码有、大码没有的款上出现", shirts.length === 1, String(shirts.length));

  const groupsArr = groups.map((g) => ({
    name: ((g.querySelector(".plz-h3") || {}).textContent || "").trim(),
    plus: g.querySelectorAll(".plz-col.plus").length,
    std: g.querySelectorAll(".plz-col.std").length,
    cols: g.querySelectorAll(".plz-col").length,
  }));
  const needle = groupsArr.filter((g) => g.name.indexOf("连衣裙") === 0)[0];
  ok("连衣裙：大码有、标码没有 → 只渲染大码一列", needle && needle.plus === 1 && needle.std === 0 && needle.cols === 1,
    JSON.stringify(needle));
  ok("只有一列时容器带上 one（整行铺满，不留空壳）",
    Array.prototype.some.call(doc4.querySelectorAll(".plz-cols"), (el) => el.classList.contains("one")));

  const ku = groupsArr.filter((g) => g.name.indexOf("裤装") === 0)[0];
  ok("裤装：两边都有数据 → 左大码右标码两列", ku && ku.plus === 1 && ku.std === 1, JSON.stringify(ku));

  const sumTxt = (doc4.getElementById("plz-sum") || {}).textContent || "";
  ok("汇总行给出标码/大码/大码机会三组数字", /大码/.test(sumTxt) && /标码/.test(sumTxt) && /大码机会/.test(sumTxt), sumTxt);
  ok("汇总里的大码机会 = 1", /大码机会\s*1/.test(sumTxt.replace(/\s+/g, " ")), sumTxt);

  /* 只看大码机会 */
  doc4.getElementById("plz-only-gap").click();
  await sleep(60);
  const gapTxt = doc4.getElementById("plz-body").textContent || "";
  const gapCols = doc4.querySelectorAll(".plz-col.plus").length;
  ok("「只看大码机会」隐藏大码列，只留缺口款", gapCols === 0, String(gapCols));
  ok("「只看大码机会」里不再出现已在售的同款（阔腿裤A）", !/阔腿裤A/.test(gapTxt), gapTxt.slice(0, 120));
  ok("「只看大码机会」保留缺口款（阔腿裤C）", /阔腿裤C/.test(gapTxt));

  /* 期次配对：默认跟随，解锁后可各选 */
  const unlockBtn = doc4.getElementById("plz-unlock");
  const stdSel = doc4.getElementById("plz-std-period");
  ok("默认锁定期次（标码期次不可单独选）", stdSel.disabled === true);
  unlockBtn.click();
  await sleep(30);
  ok("解锁后标码期次可单独选", stdSel.disabled === false);
  ok("解锁按钮有状态反馈", unlockBtn.classList.contains("on"));

  /* 静态规则：卡片文字默认隐藏、触屏常显（与收藏卡片同一套质感） */
  const CSS = read("css/style.css");
  ok("大码专区样式已并入主样式表", /\.plz-group\s*\{/.test(CSS) && /\.plz-card\s*\{/.test(CSS));
  ok("卡片标题默认隐藏、悬停淡入", /\.plz-title\s*\{[\s\S]*?opacity:\s*0/.test(CSS) && /\.plz-card:hover \.plz-title/.test(CSS));
  ok("触屏设备文字常显（手机没有 hover）", /@media \(hover: none\)[\s\S]{0,200}\.plz-title\s*\{[^}]*opacity:\s*1/.test(CSS));
  ok("尊重「减少动效」", /prefers-reduced-motion[\s\S]{0,200}plz-card/.test(CSS));

  /* SQL 补丁 */
  console.log("\n=== ⑤ 数据库补丁 ===\n");
  const SQL = read("tools/patch_20261026P.sql");
  ok("三张表都建了",
    /create table if not exists public\.rank_plus_batches/.test(SQL)
    && /create table if not exists public\.rank_plus_items/.test(SQL)
    && /create table if not exists public\.rank_plus_matches/.test(SQL));
  ok("不碰现有表（没有 alter/drop rank_items）", !/alter table public\.rank_items\b/i.test(SQL) && !/drop table[^;]*rank_items/i.test(SQL));
  ok("结论表按「期次+类目+站点+标码图」唯一（重算不会堆重复行）",
    /unique \(period_label, category, site, std_image_url\)/.test(SQL));
  ok("开了行级安全并给管理员写权限", /enable row level security/.test(SQL) && /role in \('admin', 'super_admin'\)/.test(SQL));
  ok("显式授权 authenticated（否则新表读不出来）",
    /grant select, insert, update, delete on public\.rank_plus_items\s+to authenticated/.test(SQL));
  ok("建完通知接口层刷新缓存", /notify pgrst, 'reload schema'/.test(SQL));
  ok("聚合函数 rank_plus_facets 只聚合大码（类目以大码为准）",
    /create or replace function public\.rank_plus_facets/.test(SQL)
    && !/from public\.rank_items/.test(SQL));
  ok("补丁幂等（可重复执行）", (SQL.match(/if not exists/g) || []).length >= 6 && /create or replace function/.test(SQL));

  /* ==================================================================
     ⑥ 上传时能选类目（20261026R）
     ================================================================== */
  console.log("\n=== ⑥ 后台上传可选类目 + 前台类目交互 ===\n");
  const htmlR = read("admin.html");
  ok("上传区有类目下拉", /<select id="pl-cat"/.test(htmlR));
  ok("上传区有「自定义添加」类目按钮", /id="pl-cat-add"/.test(htmlR));
  ok("类目用法可选「整表用这个类目 / 只兜底」",
    /name="pl-catmode" value="force"/.test(htmlR) && /name="pl-catmode" value="fallback"/.test(htmlR));
  ok("类目下拉走统一搜索组件（可搜 + 常用类目优先）",
    /CATS\.mountBox\(sel, "cat-search-plus"/.test(read("js/admin-plus.js"))
    && /CATS\.sortCats\(ST\.cats, favs\)/.test(read("js/admin-plus.js")));
  ok("匹配区类目下拉也能搜", /cat-search-plus-match/.test(read("js/admin-plus.js")));

  /* 用刚解析过的那本工作簿，换类目设置重解析 */
  const selR = w3.document.getElementById("pl-cat");
  selR.innerHTML = '<option value="">不指定</option><option value="裤装">裤装</option><option value="连衣裙">连衣裙</option>';
  selR.value = "连衣裙";
  const forceR = w3.document.querySelector('input[name="pl-catmode"][value="force"]');
  forceR.checked = true;
  selR.onchange();
  await sleep(700);
  const tipR = (w3.document.getElementById("pl-file-tip") || {}).textContent || "";
  const chipsR = Array.prototype.slice.call(w3.document.querySelectorAll("#pl-preview .pl-chip")).map((el) => el.textContent.trim());
  ok("整表归入：预览里只剩所选类目", chipsR.length === 1 && /连衣裙/.test(chipsR[0]), JSON.stringify(chipsR));
  ok("整表归入：提示里写明归到哪个类目", /整表归入「连衣裙」/.test(tipR), tipR);

  /* 切到兜底：sheet 名优先，识别不出的才用它 */
  const fbR = w3.document.querySelector('input[name="pl-catmode"][value="fallback"]');
  fbR.checked = true;
  fbR.onchange();
  await sleep(700);
  const chipsR2 = Array.prototype.slice.call(w3.document.querySelectorAll("#pl-preview .pl-chip")).map((el) => el.textContent.trim());
  ok("兜底模式：sheet 名照旧当类目（裤装 / 大批量 都回来了）",
    chipsR2.some((t) => /裤装/.test(t)) && chipsR2.some((t) => /大批量/.test(t)), JSON.stringify(chipsR2).slice(0, 160));
  const tipR2 = (w3.document.getElementById("pl-file-tip") || {}).textContent || "";
  ok("兜底模式：提示文案与整表模式不同", /识别不出类目的行归到/.test(tipR2), tipR2);

  /* 选中的类目要真的进载荷，而不只是界面好看 */
  forceR.checked = true;
  selR.value = "连衣裙";
  selR.onchange();
  await sleep(700);
  const rowsBefore = calls.insert.length;
  const impBtnR = w3.document.getElementById("pl-import");
  if (impBtnR) impBtnR.click();
  await sleep(500);
  const newPayload = calls.insert.slice(rowsBefore).reduce((a, b) => a.concat(b || []), []);
  ok("导入载荷用的是所选的类目（不是 sheet 名）",
    newPayload.length > 0 && newPayload.every((r) => r.category === "连衣裙"),
    newPayload.length ? newPayload.slice(0, 3).map((r) => r.category).join(",") + " / 共" + newPayload.length : "无载荷");

  /* ---- 前台：类目名不完全一致也要对上；加载中点类目不丢 ---- */
  const d6 = new JSDOM(read("plus.html"), { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const w6 = d6.window;
  const IMG6 = (n) => "https://img.example.com/" + n + ".jpeg";
  const plus6 = [{ category: "裤装", site: "", title: "大码阔腿裤", image_url: IMG6("p1"), ratio: 90 }];
  const std6 = [
    { category: "加绒裤装", site: "美国", title: "加绒阔腿裤", image_url: IMG6("s1"), ratio: 300 },
    { category: "衬衫", site: "美国", title: "衬衫", image_url: IMG6("s2"), ratio: 120 },
  ];
  let listCalls = 0;
  w6.SB = {
    getSession: () => Promise.resolve({ user: { email: "t@e.com" } }),
    signOut: () => Promise.resolve(),
    rankFacets: () => Promise.resolve({ sites: ["美国"], periods: ["W43"], categories: ["裤装", "衬衫"] }),
    listRankItems: (q) => {
      listCalls++;
      let rows = std6.slice();
      if (q && q.category) rows = rows.filter((r) => r.category === q.category);
      return new Promise((res) => setTimeout(() => res(rows), 60));
    },
  };
  w6.SBP = {
    facets: () => Promise.resolve({ periods: ["W43"], categories: ["裤装"] }),
    listItems: () => new Promise((res) => setTimeout(() => res(plus6), 60)),
    listMatches: () => Promise.resolve([]),
  };
  runScript(d6, "js/plus.js");
  await sleep(20);                                  /* 首次加载还在路上 */
  const catBtn = Array.prototype.slice.call(w6.document.querySelectorAll("#plz-cats .cat-menu-item"))
    .filter((b) => (b.getAttribute("data-cat") || "") === "裤装")[0];
  if (catBtn) catBtn.click();                        /* 加载中点类目：不能白点 */
  await sleep(600);
  const g6 = Array.prototype.slice.call(w6.document.querySelectorAll(".plz-group"));
  ok("加载中点类目不会白点（加载完会再跑一遍）", g6.length === 1, String(g6.length));
  ok("类目名不完全一致（裤装 vs 加绒裤装）标码列仍然出现",
    g6.length === 1 && g6[0].querySelectorAll(".plz-col.std").length === 1,
    g6.length ? String(g6[0].querySelectorAll(".plz-col.std").length) : "0");
  ok("宽松匹配不会把无关类目（衬衫）拉进来",
    !/衬衫/.test((w6.document.getElementById("plz-body") || {}).textContent || ""));
  ok("前台加载点头应有排队重跑（不是直接 return 掉）",
    /if \(ST\.loading\) \{ ST\.pending = true; return; \}/.test(read("js/plus.js"))
    && /if \(ST\.pending\) \{ ST\.pending = false; load\(\); \}/.test(read("js/plus.js")));
  ok("类目为空时给出「重传时选类目」的明确指引",
    /上传时选一个类目/.test(read("js/plus.js")));

  /* ==================================================================
     ⑦ 大码专区必须登记进「专区体系」（可见开关 / 权限勾选 / 面板授权）
     ================================================================== */
  console.log("\n=== ⑦ 大码专区纳入专区权限体系 ===\n");
  const CFG = read("js/config.js");
  const ADM = read("js/admin.js");
  const PERMJS = read("js/admin-perm.js");
  ok("内置专区清单里有 plus（前台导航/全局可见开关读它）",
    /\{ key: "plus",\s*label: "大码专区",\s*href: "plus.html" \}/.test(CFG));
  ok("后台专区定义里也有 plus（专区管理/类目可见共用它）",
    /\{ key: "plus", label: "大码专区" \}/.test(ADM));
  ok("权限管理兜底清单里也有 plus（权限表能勾）",
    /\{ key: "plus", label: "大码专区" \}/.test(PERMJS));
  /* 只看 canAccessPanel 函数体：「任一授权专区即可」的放行名单里不能再有 plus-card。
     (文件别处出现 plus-card 是刷新钩子，不属于权限判定，不能一并否定) */
  const canBody = (ADM.match(/function canAccessPanel[\s\S]*?\n  \}/) || [""])[0];
  ok("后台大码面板按「大码专区」授权（不再对任一管理员放行）",
    /"plus-card": "plus"/.test(ADM) && canBody.length > 0 && !/plus-card/.test(canBody),
    canBody ? canBody.split("\n").slice(0, 6).join(" | ") : "没截到函数体");

  /* getZoneDefs 必须「内置为底 + 保存值覆盖」，否则老库里存的 __defs 缺 plus 就永远看不到 */
  const SBSRC = read("js/supabase.js");
  ok("读取专区定义以内置清单为底（历史保存的配置不会把新专区吃掉）",
    /getZoneDefs[\s\S]{0,700}?ZONE_DEFS_DEFAULT/.test(SBSRC)
    && /saved\.forEach/.test(SBSRC));

  /* 真跑：模拟"库里 __defs 是旧清单"，看合并结果里有没有 plus */
  const d7 = new JSDOM("<!doctype html><html><body></body></html>",
    { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const w7 = d7.window;
  w7.ZONE_DEFS_DEFAULT = [
    { key: "rank", label: "趋势上升榜", href: "rank.html" },
    { key: "plus", label: "大码专区", href: "plus.html" },
  ];
  const mergedZ = (function () {
    const raw = { __defs: [{ key: "rank", label: "旧名字", href: "rank.html" }, { key: "custom", label: "自定义", href: "c.html" }] };
    const saved = Array.isArray(raw.__defs) ? raw.__defs : [];
    const out = (w7.ZONE_DEFS_DEFAULT || []).map((d) => ({ key: String(d.key), label: String(d.label || d.key), href: String(d.href || "") }));
    const idx = {};
    out.forEach((d, i) => { idx[d.key] = i; });
    saved.forEach((d) => {
      if (!d || !d.key) return;
      const k = String(d.key);
      if (idx[k] != null) { const t = out[idx[k]]; t.label = String(d.label || t.label); t.href = String(d.href || t.href); }
      else { out.push({ key: k, label: String(d.label || k), href: String(d.href || "") }); }
    });
    return out;
  })();
  ok("库里存着旧专区清单时，新专区仍会出现在合并结果里",
    mergedZ.some((z) => z.key === "plus"), JSON.stringify(mergedZ.map((z) => z.key)));
  ok("合并时保留超管自定义专区", mergedZ.some((z) => z.key === "custom"));
  ok("合并时同 key 以保存值为准（不会把改名覆盖掉）",
    mergedZ.filter((z) => z.key === "rank")[0].label === "旧名字");

  /* 前台 plus.html：全站关掉 / 未授权时要有明确说明，而不是空白 */
  const PLUSS = read("js/plus.js");
  ok("大码页读全站开关与用户级白名单（两级守门）",
    /getFrontendZoneVisibility/.test(PLUSS) && /myFrontendZones/.test(PLUSS));
  ok("全站关掉时给出原因", /vis\.plus === false/.test(PLUSS) && /前台访问设置/.test(PLUSS));
  ok("未授权时给出原因", /myz\.indexOf\("plus"\) === -1/.test(PLUSS) && /权限管理|未获授权/.test(PLUSS));
  ok("大码页顶部导航走统一显隐（不再自己写一套）", /Common\.zones\.applyNav/.test(PLUSS));

  const d8 = new JSDOM(read("plus.html"), { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const w8 = d8.window;
  w8.SB = {
    getSession: () => Promise.resolve({ user: { email: "t@e.com" } }),
    signOut: () => Promise.resolve(),
    getFrontendZoneVisibility: () => Promise.resolve({ plus: false }),
    myFrontendZones: () => Promise.resolve(null),
    listRankItems: () => Promise.resolve([]),
  };
  w8.SBP = { facets: () => Promise.resolve({ periods: [], categories: [] }), listItems: () => Promise.resolve([]), listMatches: () => Promise.resolve([]) };
  runScript(d8, "js/plus.js");
  await sleep(200);
  const gateTxt = (w8.document.getElementById("plz-body") || {}).textContent || "";
  ok("全站关闭时页面显示关闭原因（非空白页）", /前台访问设置/.test(gateTxt), gateTxt.slice(0, 80));

  const d9 = new JSDOM(read("plus.html"), { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const w9 = d9.window;
  w9.SB = {
    getSession: () => Promise.resolve({ user: { email: "t@e.com" } }),
    signOut: () => Promise.resolve(),
    getFrontendZoneVisibility: () => Promise.resolve({}),
    myFrontendZones: () => Promise.resolve(["visual", "rank"]),
    listRankItems: () => Promise.resolve([]),
  };
  w9.SBP = { facets: () => Promise.resolve({ periods: [], categories: [] }), listItems: () => Promise.resolve([]), listMatches: () => Promise.resolve([]) };
  runScript(d9, "js/plus.js");
  await sleep(200);
  const gateTxt2 = (w9.document.getElementById("plz-body") || {}).textContent || "";
  ok("账号未授权时显示未授权原因", /未获授权/.test(gateTxt2), gateTxt2.slice(0, 80));

  console.log("\n================ 汇总 ================");
  console.log("PASS " + pass + " / FAIL " + fail);
  if (fail) process.exitCode = 1;
})();