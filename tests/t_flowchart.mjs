/* 20261112E · 实用工具「流程图 / 泳道图」
 *
 * 不是「有按钮就算做了」，而是把引擎真正跑起来断言：
 *   布局（泳道内节点落在带内、列间距递增、互不重叠）、
 *   连线（拒绝自连 / 重复 / 指向不存在）、
 *   泳道（增删改名、删到只剩一条时拒绝）、
 *   导出（SVG 含泳道与箭头标记、Mermaid 结构正确）。
 *
 *   node tests/t_flowchart.mjs
 */
import fs from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const SRC = fs.readFileSync("js/flowchart.js", "utf8");
const TOOLS = fs.readFileSync("js/admin-tools.js", "utf8");
const SUPA = fs.readFileSync("js/supabase.js", "utf8");
const ADMIN_HTML = fs.readFileSync("admin.html", "utf8");
const CSS = fs.readFileSync("css/style.css", "utf8");

const win = { window: {} };
const run = new Function("window", "document", SRC + "\nreturn window;")(win.window, undefined);
const C = run.FlowchartCore;

console.log("一、引擎可用性");
ok(!!C, "应导出 FlowchartCore");
ok(typeof run.FlowchartEditor === "function", "应导出 FlowchartEditor");
ok(typeof C.layout === "function" && typeof C.toSVG === "function", "应导出布局与 SVG 导出");
ok(!/^document\./m.test(SRC), "顶层不应直接依赖 DOM（便于无 DOM 单测）");
ok(Object.keys(C.TYPES).length >= 5, "至少有开始/步骤/判断/结束/数据五种节点");

console.log("二、节点");
const doc = C.newDoc("测试流程");
ok(doc.lanes.length === 2 && doc.swim === true, "新文档默认两条泳道且开启泳道");
const n1 = C.addNode(doc, C.newNode("process", "选品"));
ok(n1.lane === doc.lanes[0].id, "未指定泳道时落到第一条");
ok(n1.w > 0 && n1.h > 0, "节点应有默认尺寸");
const n2 = C.addNode(doc, C.newNode("decision", "是否打样", { lane: doc.lanes[1].id }));
ok(n2.lane === doc.lanes[1].id, "可指定落到第二条泳道");
ok(n2.type === "decision" && C.TYPES.decision.kind === "diamond", "判断节点是菱形");
const bad = C.addNode(doc, C.newNode("process", "x", { lane: "不存在的道" }));
ok(bad.lane === doc.lanes[0].id, "泳道 id 不存在时回落到第一条，不留孤儿");
ok(C.findNode(doc, n1.id) === n1, "能按 id 找到节点");

console.log("三、连线");
const e1 = C.addEdge(doc, n1.id, n2.id);
ok(!!e1 && e1.from === n1.id && e1.to === n2.id, "正常连线");
ok(C.addEdge(doc, n1.id, n2.id) === e1, "同起止重复连线应返回已有那条，不重复创建");
ok(C.addEdge(doc, n1.id, n1.id) === null, "拒绝自连");
ok(C.addEdge(doc, n1.id, "不存在") === null, "拒绝连到不存在的节点");
const eWithLabel = C.addEdge(doc, n2.id, n1.id, "否");
ok(!!eWithLabel && eWithLabel.label === "否", "支持连线文字（判断分支）");
C.removeNode(doc, n2.id);
ok(doc.edges.every((e) => e.from !== n2.id && e.to !== n2.id), "删节点应连带删掉它的所有连线");
ok(C.findNode(doc, n2.id) === null, "节点确实被删掉");

console.log("四、泳道");
const d2 = C.newDoc();
const l3 = C.addLane(d2, "设计");
ok(d2.lanes.length === 3 && l3.name === "设计", "可新增泳道");
ok(C.renameLane(d2, l3.id, "视觉") === true && l3.name === "视觉", "可改名");
const nd = C.addNode(d2, C.newNode("process", "出图", { lane: l3.id }));
ok(C.removeLane(d2, l3.id) === true, "可删泳道");
ok(nd.lane === d2.lanes[0].id, "被删泳道里的节点应回落到第一条，不能指向空气");
const d1 = C.newDoc();
C.removeLane(d1, d1.lanes[0].id);
C.removeLane(d1, d1.lanes[0].id);
ok(d1.lanes.length === 1, "不允许删到一条泳道都不剩");

console.log("五、布局（泳道模式）");
const d3 = C.newDoc();
const LA = d3.lanes[0].id, LB = d3.lanes[1].id;
const a1 = C.addNode(d3, C.newNode("start", "开始", { lane: LA }));
const a2 = C.addNode(d3, C.newNode("process", "步骤一", { lane: LA }));
const a3 = C.addNode(d3, C.newNode("process", "步骤二", { lane: LA }));
const b1 = C.addNode(d3, C.newNode("process", "商品动作", { lane: LB }));
const size = C.layout(d3, { maxPerRow: 4 });
const bands = C.laneBands(d3, size);
ok(bands.length === 2, "两条泳道应出两条背景带");
ok(bands[0].h >= 120 && bands[1].y >= bands[0].y + bands[0].h - 1, "泳道带纵向依次排列、不重叠");
ok(a1.x < a2.x && a2.x < a3.x, "同泳道节点从左到右顺排");
const mid = (n) => n.y + n.h / 2;
ok(Math.abs(mid(a1) - mid(a2)) < 1.5 && Math.abs(mid(a2) - mid(a3)) < 1.5, "同一行的节点纵向居中对齐（高矮不同也不错位）");
const inBand = (n, b) => n.y >= b.y && (n.y + n.h) <= (b.y + b.h) + 1;
ok(inBand(a1, bands[0]) && inBand(a3, bands[0]), "第一道节点应落在第一道带内");
ok(inBand(b1, bands[1]), "第二道节点应落在第二道带内");
ok(b1.y > a3.y, "跨道节点不会挤在同一行");
ok(!(a1.x === b1.x && a1.y === b1.y), "不同道节点不重叠");
ok(size.w > 400 && size.h > 200, "整体尺寸应随内容撑开");

const d4 = C.newDoc();
for (let i = 0; i < 7; i++) C.addNode(d4, C.newNode("process", "节点" + i));
C.layout(d4, { maxPerRow: 4 });
const rowY = d4.nodes.map((n) => n.y);
ok(new Set(rowY).size === 2, "同泳道超过 4 个节点应换行（7 个 → 2 行）");
ok(d4.nodes[0].x === d4.nodes[4].x, "换行后回到第一列");

console.log("六、折行与文字");
ok(C.wrapText("一二三四五六七八九十", 4).length >= 3, "中文按字数折行");
ok(C.wrapText("hello world foo", 5).join("|").indexOf("hello") === 0, "英文按单词折行");
ok(C.wrapText("a".repeat(30), 8).every((s) => s.length <= 8), "超长单词硬断，不溢出");
ok(C.wrapText("第一行\n第二行", 20).length === 2, "显式换行保留");

console.log("七、导出");
const svg = C.toSVG(d3, {});
ok(/^<svg /.test(svg), "导出应为合法 svg 根节点");
ok(svg.indexOf('id="fcArrow"') > 0, "应带箭头 marker（否则连线没有方向）");
ok(svg.indexOf("开始") > 0 && svg.indexOf("步骤一") > 0, "节点文字应写入 SVG");
ok(svg.indexOf("商品动作") > 0, "其它泳道的节点也要导出");
ok((svg.match(/class="fc-lane"/g) || []).length === 2, "泳道背景应导出两条");
ok(/width="\d+"/.test(svg) && /viewBox="0 0 \d+ \d+"/.test(svg), "应带尺寸与 viewBox");
const dashSvg = C.toSVG(d3, { dark: true });
ok(dashSvg.indexOf("#0f172a") > 0, "支持深色导出");

const mmd = C.toMermaid(d3);
ok(/^flowchart LR/.test(mmd), "Mermaid 应为 flowchart LR");
ok(mmd.indexOf("([" + "开始" + "])") > 0 || mmd.indexOf('(["开始"])') > 0, "开始节点用胶囊括号");
ok(C.toMermaid(C.newDoc()) === "flowchart LR", "空文档应只输出一行 flowchart LR");
const d5 = C.newDoc();
const x1 = C.addNode(d5, C.newNode("process", "A"));
const x2 = C.addNode(d5, C.newNode("decision", "B"));
C.addEdge(d5, x1.id, x2.id, "是");
const mmd2 = C.toMermaid(d5);
ok(mmd2.indexOf('{"B"}') > 0, "判断节点用花括号（Mermaid 语法）");
ok(mmd2.split("\n").some((l) => l.indexOf("-->") > 0), "应包含连线语句");
ok(mmd2.indexOf('-->|"是"|') > 0, "连线文字应带进 Mermaid");

const st = C.stats(d3);
ok(st.nodes === 4 && st.edges === 0 && st.lanes === 2, "统计口径正确（节点/连线/泳道）");

console.log("八、后台接入");
ok(ADMIN_HTML.indexOf("js/flowchart.js") > 0, "后台应引入 flowchart.js");
ok(ADMIN_HTML.indexOf("js/gantt.js") > 0, "后台应引入 gantt.js");
ok(TOOLS.indexOf("流程图 / 泳道图") > 0, "实用工具里应有流程图入口");
ok(TOOLS.indexOf("FlowchartEditor") > 0 && TOOLS.indexOf("FlowchartCore") > 0, "面板应真正挂载流程图渲染器");
ok(/getFlowcharts/.test(SUPA) && /setFlowcharts/.test(SUPA), "应有流程图存取接口");
ok(SUPA.indexOf("tools_flowcharts") > 0, "数据应存在站点设置里（不改表结构）");
ok(/\.tp-tab/.test(CSS) && /\.fc-canvas/.test(CSS), "应有工具切换与画布样式");
ok(TOOLS.indexOf("try {") > 0 && TOOLS.indexOf("初始化出错") > 0, "单个工具出错不应让整个面板空白");
/* 三个工具并列，不是只留思维导图 */
const tabs = ["思维导图", "流程图 / 泳道图", "上新甘特图"];
ok(tabs.every((t) => TOOLS.indexOf(t) >= 0), "三个工具应并列出现在同一面板");

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
if (fail) process.exit(1);
console.log("FLOWCHART-OK");
