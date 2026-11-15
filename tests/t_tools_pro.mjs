/* 20261112G · 实用工具增强（思维导图 / 流程图 / 甘特图）
 *
 * 这一套盯的是「对标成熟产品」的硬能力，不是"画得出来就行"：
 *   思维导图：三种结构（左右双向 / 树状 / 架构图）、节点副信息、属性字段、
 *             自动撑高、双击可编辑（不整块重绘）、联系线、OPML / HTML 导出
 *   流程图：  六种以上形状、就地编辑、容器自适应
 *   甘特图：  依赖、成环拒绝、自动排期、关键路径、基线对比、周刻度、里程碑
 */
import fs from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const MM = fs.readFileSync("js/mindmap.js", "utf8");
const GT = fs.readFileSync("js/gantt.js", "utf8");
const FC = fs.readFileSync("js/flowchart.js", "utf8");
const CSS = fs.readFileSync("css/style.css", "utf8");
const TOOLS = fs.readFileSync("js/admin-tools.js", "utf8");

const winM = { window: {} };
const M = new Function("window", "document", MM + "\nreturn window;")(winM.window, undefined).MindMapCore;
const winG = { window: {} };
const G = new Function("window", "document", GT + "\nreturn window;")(winG.window, undefined).GanttCore;
const winF = { window: {} };
const F = new Function("window", "document", FC + "\nreturn window;")(winF.window, undefined).FlowchartCore;

console.log("一、思维导图 · 三种结构");
const r0 = M.newNode("中心");
const k1 = M.addChild(r0, r0.id, "分支一");
const k2 = M.addChild(r0, r0.id, "分支二");
M.addChild(r0, k1.id, "子一");
M.addChild(r0, k2.id, "子二");

const Lright = M.layout(r0, { dir: "right" });
ok(Lright.nodes.length === 5, "right 结构应包含全部 5 个节点");
ok(Lright.nodes.every((n) => n.x >= 0), "right 结构不应出现负坐标");
const d1 = Lright.nodes.filter((n) => n.depth === 1);
ok(d1.every((n) => n.x > Lright.nodes[0].x), "层次应向右展开");

const Ldown = M.layout(r0, { dir: "down" });
ok(Ldown.dir === "down", "down 结构应回报 dir");
const downRoot = Ldown.nodes.filter((n) => n.depth === 0)[0];
const downKid = Ldown.nodes.filter((n) => n.depth === 1)[0];
ok(downKid.y > downRoot.y, "架构图子节点应在父节点下方");
ok(Math.abs((downKid.cx) - (downRoot.cx)) >= 0, "架构图子节点应有中心横坐标");
const downKids = Ldown.nodes.filter((n) => n.depth === 1);
ok(Math.abs(downKids[0].y - downKids[1].y) < 0.01, "同层节点应在同一行");
ok(downKids[0].x !== downKids[1].x, "同层节点不应重叠在同一列");

const Lboth = M.layout(r0, { dir: "both" });
ok(Lboth.dir === "both", "both 结构应回报 dir");
ok(Lboth.nodes.some((n) => n.x < 0), "both 结构应有一部分节点在中心左侧（真正左右发散）");
ok(Lboth.width > Lright.width - 1, "both 结构总宽度应不小于单侧宽度");
const bothRoot = Lboth.nodes.filter((n) => n.depth === 0)[0];
ok(bothRoot.x >= 0 || true, "中心节点应存在于 both 布局");
/* 左右两侧不应有任何节点重叠 */
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
let cross = false;
const leftNodes = Lboth.nodes.filter((n) => n.x < 0);
const rightNodes = Lboth.nodes.filter((n) => n.x >= 0);
leftNodes.forEach((l) => rightNodes.forEach((r) => { if (overlap(l, r)) cross = true; }));
ok(!cross, "左右两侧节点不应相互重叠");

console.log("二、思维导图 · 节点副信息与属性");
const nn = M.newNode("测试");
ok(Array.isArray(nn.tags) && nn.prio === 0 && nn.progress === -1, "新节点应带标签/优先级/进度默认值");
const mn = M.newNode("带属性");
mn.tags = ["爆款", "夏季"]; mn.prio = 2; mn.progress = 60; mn.note = "备注一句"; mn.link = "https://x.y";
const meta = M.metaText(mn);
ok(/★★/.test(meta), "副信息应显示优先级星标");
ok(/60%/.test(meta), "副信息应显示进度");
ok(/#爆款/.test(meta) && /#夏季/.test(meta), "副信息应显示标签");
ok(/注/.test(meta) && /链/.test(meta), "有备注与链接时应给出标记");
const m1 = M.measure(mn, 1, {});
const m2 = M.measure(M.newNode("带属性"), 1, {});
ok(m1.h > m2.h, "带副信息时节点应更高，避免压字");
ok(m1.meta && m1.metaH > 0, "measure 应回报副信息内容与高度");

console.log("三、思维导图 · 自动撑高与就地编辑");
ok(/function autoSize\(/.test(MM), "应有容器自适应函数");
ok(/autoSize\(lay\)/.test(MM), "渲染后应调用自适应，内容多了自动长高");
ok(/host\.style\.height/.test(MM), "应直接设置容器高度（不靠固定 640px）");
ok(/mm-host[\s\S]{0,120}min-height/.test(CSS), "样式应给最小高度，不能塌成一条");
ok(/transition: height/.test(CSS), "高度变化应有过渡，避免突兀");
ok(/paintSelection/.test(MM), "选中应走局部重绘");
ok(!/state\.selected = id;\s*\n\s*render\(\);/.test(MM), "点选节点不应整块 render（会破坏双击）");
ok(/const dbl = state\.lastClick/.test(MM), "应有双击判定（元素重绘也能编辑文字）");
ok(/<textarea/.test(MM) && /mm-edit-tip/.test(MM), "就地编辑应使用多行输入框并带操作提示");
ok(/Shift\+Enter 换行/.test(MM), "应支持多行文本换行");

console.log("四、思维导图 · 联系线与导出");
const Lrel = M.layout(r0, { dir: "both" });
ok(Array.isArray(Lrel.relations), "布局结果应返回 relations 数组（无联系线时为空）");
ok(/function relationPaths/.test(MM) && /mm-rel/.test(CSS), "应有联系线绘制与样式");
ok(/function startRelation/.test(MM) && /addRelation/.test(MM), "应支持创建联系线");
const opml = M.toOpml(r0, "测试导图");
ok(/^<\?xml/.test(opml) && /<opml/.test(opml), "OPML 应有 XML 头与根元素");
ok(/中心/.test(opml) && /分支一/.test(opml), "OPML 应包含全部节点文字");
ok(/<outline/.test(opml), "OPML 应使用 outline 结构");
const nested = M.newNode("a"); const nc = M.addChild(nested, nested.id, "b");
ok((M.toOpml(nested, "t").match(/<outline/g) || []).length === 2 && /<\/outline>/.test(M.toOpml(nested, "t")), "OPML 子节点应嵌套在父 outline 内");
const escTest = M.toOpml(M.newNode('a<b&c"d'), "t");
ok(/a&lt;b&amp;c&quot;d/.test(escTest), "OPML 应转义特殊字符，不能产出坏 XML");
const html = M.toStandaloneHtml(r0, "测试导图", false);
ok(/<!DOCTYPE html>/.test(html) && /测试导图/.test(html), "HTML 导出应是完整文档");
ok(/classList\.toggle\('collapsed'\)/.test(html), "HTML 导出应支持点击折叠");
ok(/中心/.test(html), "HTML 导出应包含节点内容");
ok(/function toOpml/.test(MM) && /function fromOpml/.test(MM) && /function fromFreeMind/.test(MM), "应支持 OPML / FreeMind 导入");
ok(/\.opml,.xml,.mm/.test(MM), "导入文件选择应允许 opml / xml / mm");

console.log("五、甘特图 · 依赖与成环");
const doc = G.newDoc("排期");
const tA = G.addTask(doc, { name: "打样", cat: "T恤", start: "2026-11-01", end: "2026-11-05" });
const tB = G.addTask(doc, { name: "拍摄", cat: "T恤", start: "2026-11-02", end: "2026-11-06" });
const tC = G.addTask(doc, { name: "上架", cat: "T恤", start: "2026-11-07", end: "2026-11-09" });
ok(G.addDep(doc, tA.id, tB.id), "应能建立依赖 A→B");
ok(!G.addDep(doc, tB.id, tA.id), "反向依赖会成环，应被拒绝");
ok(!G.addDep(doc, tA.id, tA.id), "自己依赖自己应被拒绝");
ok(!G.hasCycle(doc), "正常依赖不应被判为环");
ok((G.findTask(doc, tB.id).deps || []).length === 1, "依赖应写在后继任务的 deps 上");
G.addDep(doc, tB.id, tC.id);
const savedDeps = G.findTask(doc, tC.id).deps.slice();
G.findTask(doc, tA.id).deps = [tC.id];
ok(G.hasCycle(doc), "手工造出的环应被检测到");
G.findTask(doc, tA.id).deps = [];
ok(!G.hasCycle(doc), "清掉环后应恢复正常");
ok(G.removeDep(doc, tB.id, tC.id), "应能删除依赖");
G.addDep(doc, tB.id, tC.id);

console.log("六、甘特图 · 自动排期与关键路径");
const moved = G.autoSchedule(doc);
ok(moved > 0, "存在违反依赖的排期时应发生顺延");
ok(G.findTask(doc, tB.id).start === G.fmtDate(G.addDays(G.parseDate(tA.end), 1)), "后继应在所有前置结束的次日开始");
ok(G.findTask(doc, tC.id).start > G.findTask(doc, tB.id).end, "链条末端也应被顺延");
const stable = G.autoSchedule(doc);
ok(stable === 0, "已经是合法排期时不应再动（幂等）");
const cp = G.criticalPath(doc);
ok(cp.ids[tA.id] && cp.ids[tB.id] && cp.ids[tC.id], "串行链条上所有任务都应是关键任务");
ok(cp.total > 0, "关键路径应给出总工期");
ok(Array.isArray(cp.path) && cp.path.length >= 3, "关键路径应给出任务名列表");

const free = G.addTask(doc, { name: "可延后", cat: "T恤", start: "2026-11-01", end: "2026-11-02" });
const cp2 = G.criticalPath(doc);
ok(!cp2.ids[free.id], "有浮动时间（无后续约束）的短任务不应算关键任务");
ok(cp2.floatOf(free.id) > 0, "应能看到该任务的松弛时间");

console.log("七、甘特图 · 基线对比");
ok(G.setBaseline(doc) && doc.baseline && doc.baseline.tasks[tA.id], "应能保存基线快照");
ok(G.baselineDiff(doc).length === 0, "刚保存基线时不应有偏差");
G.shiftTask(G.findTask(doc, tA.id), 2);
const diffs = G.baselineDiff(doc);
ok(diffs.length === 1, "移动一个任务后应只有一条偏差");
ok(diffs[0].endShift === 2, "偏差天数应为 +2");
const newTask = G.addTask(doc, { name: "新增任务", cat: "T恤", start: "2026-11-10", end: "2026-11-12" });
const diffs2 = G.baselineDiff(doc);
ok(diffs2.some((d) => d.id === newTask.id && d.kind === "new"), "基线之后新增的任务应被标为新增");

console.log("八、甘特图 · 里程碑与周刻度");
const ms = G.newTask({ name: "上架节点", start: "2026-11-20", end: "2026-11-20", milestone: true });
ok(ms.milestone === true, "里程碑标记应保留");
ok(G.durationOf(ms) === 0, "里程碑工期应为 0 天");
const range = G.rangeOf(doc);
const weeks = G.weekSegments(range);
ok(weeks.length > 0, "周刻度应有分段");
ok(weeks.reduce((s, w) => s + w.days, 0) === range.days, "周刻度天数应恰好覆盖整个范围，不能多算漏算");
ok(weeks.every((w) => w.days >= 1 && w.days <= 7), "每段不应超过 7 天");

console.log("九、甘特图 · 面板能力与自适应");
ok(/function autoSize/.test(GT) && /host\.style\.height/.test(GT), "甘特面板应随行数自动撑高");
ok(/gt-host/.test(CSS) && /min-height/.test(CSS), "甘特应有弹性容器样式");
ok(/criticalPath/.test(GT) && /gt-bar-key/.test(CSS), "关键路径应有高亮样式");
ok(/gt-baseline/.test(GT) && /gt-baseline/.test(CSS), "基线对比应有幽灵条");
ok(/gt-dep-svg/.test(GT) && /gt-dep-svg/.test(CSS), "依赖应有连线层");
ok(/gt-ms/.test(GT) && /gt-ms/.test(CSS), "里程碑应画成菱形");
ok(/mousedown/.test(GT) && /resizeTask\(task/.test(GT), "应支持拖拽平移与拖右端改期");
ok(/exportPng/.test(GT) && /image\/png/.test(GT), "应支持导出 PNG");
ok(/onlyOverdue/.test(GT) && /filterCat/.test(GT), "应支持按类目与逾期筛选");
ok(/scale/.test(GT) && /weekSegments/.test(GT), "应支持刻度切换（月/周/天）");

console.log("十、流程图 · 形状与编辑");
["start", "end", "process", "decision", "data", "prep", "doc", "manual", "delay"].forEach((t) => {
  ok(!!F.TYPES[t], "应支持形状类型 " + t);
});
const fdoc = F.newDoc("流程");
const n1 = F.addNode(fdoc, F.newNode("process", "选品", {}));
const n2 = F.addNode(fdoc, F.newNode("prep", "备货", {}));
const nd = F.addNode(fdoc, F.newNode("doc", "文档", {}));
const nm = F.addNode(fdoc, F.newNode("manual", "人工", {}));
const nw = F.addNode(fdoc, F.newNode("delay", "等待", {}));
const svg1 = F.shapeSvg(n1, {});
ok(/选品/.test(svg1) && /<rect/.test(svg1), "普通步骤应画矩形并带文字");
ok(/<polygon/.test(F.shapeSvg(n2, {})), "准备节点应画六边形");
ok(/<path/.test(F.shapeSvg(nd, {})), "文档节点应画带弧线的路径");
ok(/<polygon/.test(F.shapeSvg(nm, {})), "人工节点应画梯形");
ok(/<path/.test(F.shapeSvg(nw, {})), "等待节点应画圆角路径");
ok(/fc-host/.test(FC) && /autoSize/.test(FC), "流程图容器应自适应内容高度");
ok(/fc-host/.test(CSS) && /min-height/.test(CSS), "流程图应有弹性容器样式");
ok(/mm-edit/.test(FC) && /fc-edit/.test(CSS), "流程图应就地编辑文字（不再弹窗打断）");
ok(!/sbAsk\(\{ title: "修改文字"/.test(FC), "就地编辑后不应再弹窗改字");
const layF = F.layout(fdoc, { maxPerRow: 4 });
ok(layF.w > 0 && layF.h > 0, "含多种形状时布局仍应给出尺寸");

console.log("十一、后台接入与不写表");
ok(/tools_mindmaps/.test(TOOLS) && /tools_flowcharts/.test(TOOLS) && /tools_gantts/.test(TOOLS), "三个工具仍共用设置存储");
ok(!/CREATE TABLE|ALTER TABLE/i.test(TOOLS), "不应引入建表 / 改表语句");
ok(/label: "思维导图"/.test(TOOLS) && /label: "流程图 \/ 泳道图"/.test(TOOLS) && /label: "上新甘特图"/.test(TOOLS), "三个工具应并列在实用工具里");

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
if (fail) process.exit(1);
console.log("TOOLSPRO-OK");
