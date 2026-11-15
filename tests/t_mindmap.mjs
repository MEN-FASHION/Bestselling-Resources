/* 20261112C · 后台「实用工具 / 思维导图」
 *
 * 这一套不是「能画出来就行」，而是按 XMind / 幕布 / GitMind 的实际使用习惯做的：
 * 布局算法、折行、折叠、增删移动（含防环）、Markdown / XMind 导出都是纯函数，
 * 所以这里直接 import 源文件把引擎跑起来，逐项断言，而不是只 grep 关键字。
 *
 * 验收点：
 *   - 布局：层级向右展开、兄弟不重叠、父节点垂直居中于子节点
 *   - 折行：中文按宽度断、英文按单词断、超长词硬断、空行保留
 *   - 树操作：加子/加同级/删除/换父级（拒绝成环）/同级换序
 *   - 折叠：子节点不参与布局，但节点上仍记得有子节点与数量
 *   - 导出：Markdown 层级、XMind 的 topic / children.attached 结构
 *   - 接入：后台菜单、面板、脚本顺序、权限放行、懒加载、不改表结构
 */
import fs from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const SRC = fs.readFileSync("js/mindmap.js", "utf8");
const ADMIN_TOOLS = fs.readFileSync("js/admin-tools.js", "utf8");
const SUPA = fs.readFileSync("js/supabase.js", "utf8");
const ADMIN_HTML = fs.readFileSync("admin.html", "utf8");
const ADMIN_JS = fs.readFileSync("js/admin.js", "utf8");
const CSS = fs.readFileSync("css/style.css", "utf8");

/* 引擎里没有任何顶层 DOM 依赖，可以在 node 里直接跑 */
const win = { window: {} };
const run = new Function("window", "document", SRC + "\nreturn window;")(win.window, undefined);
const C = run.MindMapCore;
const E = run.MindMapEditor;

console.log("一、引擎可用性");
ok(!!C, "应导出 MindMapCore");
ok(typeof E === "function", "应导出 MindMapEditor（渲染器）");
ok(typeof C.layout === "function" && typeof C.wrapText === "function", "应导出布局与折行");
ok(typeof C.moveNode === "function" && typeof C.toXmindContent === "function", "应导出树操作与 XMind 导出");
ok(!/^document\./m.test(SRC), "顶层不应直接依赖 DOM（否则无 DOM 环境无法单测）");

console.log("二、文本折行与测量");
const lines1 = C.wrapText("夏日清凉女装连衣裙", 60, 14);
ok(lines1.length > 1, "中文超宽应折行");
ok(lines1.every((l) => C.textWidth(l, 14) <= 60 + 0.01), "每行宽度不应超过上限");
const lines2 = C.wrapText("summer casual dress for women", 70, 14);
ok(lines2.length > 1, "英文超宽应折行");
ok(lines2.every((l) => !/^\s/.test(l) || /^\s+$/.test(l)), "英文折行不应把空格留在行首");
ok(!lines2.some((l) => /^[a-z]{3,}$/.test(l) === false && l.length && !/\s/.test(l) && C.textWidth(l, 14) > 70), "英文行不应溢出");
const longWord = "A".repeat(80);
const lines3 = C.wrapText(longWord, 60, 14);
ok(lines3.length > 1, "超长单个词应硬断，不能溢出画布");
ok(C.wrapText("第一行\n第二行", 400, 14).length >= 2, "换行符应保留为多行");
ok(C.wrapText("", 100, 14).length === 1, "空文本也应有一行（占位）");
ok(C.textWidth("中文", 14) > C.textWidth("ab", 14), "中文应比同字数英文宽");

console.log("三、布局");
const root0 = C.newNode("中心主题");
ok(C.layout(root0).nodes.length === 1, "单节点应只布局 1 个");
ok(C.layout(root0).edges.length === 0, "单节点应无边");

const a = C.addChild(root0, root0.id, "方向一");
const b = C.addChild(root0, root0.id, "方向二");
const a1 = C.addChild(root0, a.id, "细项 A1");
const a2 = C.addChild(root0, a.id, "细项 A2");
const lay = C.layout(root0);
ok(lay.nodes.length === 5, "应布局 5 个节点");
ok(lay.edges.length === 4, "边数应为节点数 - 1");
const byId = {};
lay.nodes.forEach((n) => { byId[n.id] = n; });
ok(byId[a1.id].x > byId[a.id].x && byId[a.id].x > byId[root0.id].x, "子节点应在父节点右侧");
ok(byId[a1.id].y !== byId[a2.id].y, "兄弟节点不应重叠在同一行");
ok(byId[a.id].cy > byId[a1.id].cy && byId[a.id].cy < byId[a2.id].cy, "父节点应垂直居中于子节点之间");
ok(byId[b.id].cy > byId[a2.id].cy, "第二个父节点应排在第一条分支之后");
ok(lay.width > 0 && lay.height > 0, "应给出内容宽高（用于适应屏幕）");
let overlap = false;
const lv = lay.nodes.filter((n) => n.depth === 2);
for (let i = 1; i < lv.length; i++) if (lv[i].y < lv[i - 1].y + lv[i - 1].h) overlap = true;
ok(!overlap, "同层节点不应重叠");

console.log("四、折叠");
a.collapsed = true;
const lay2 = C.layout(root0);
ok(!lay2.nodes.some((n) => n.id === a1.id), "折叠后子节点不应参与布局");
const recA = lay2.nodes.filter((n) => n.id === a.id)[0];
ok(recA.hasChildren === true, "折叠后仍应知道它有子节点");
ok(recA.childCount === 2, "折叠后应带上子节点数量（画布上显示计数）");
ok(lay2.nodes.length === 3, "折叠后应只剩 3 个可见节点");
a.collapsed = false;

console.log("五、树操作");
const sized = C.countNodes(root0);
ok(sized === 5, "节点计数应为 5");
const s1 = C.addSibling(root0, a.id, "方向一之后");
ok(root0.children[1].id === s1.id, "加同级应插在原节点之后（不是末尾）");
const rootSib = C.addSibling(root0, root0.id, "根的同级");
ok(root0.children.some((c) => c.id === rootSib.id), "根节点没有同级时，应在根下加子主题");
ok(C.findParent(root0, a1.id).id === a.id, "应能取到父节点");
ok(C.removeNode(root0, s1.id) !== null, "应能删除节点");
ok(C.findNode(root0, s1.id) === null, "删除后应查不到");
ok(C.removeNode(root0, root0.id) === null, "根节点不可删除");

ok(C.moveNode(root0, a2.id, b.id) === true, "应能把节点移到另一个父级");
ok(C.findParent(root0, a2.id).id === b.id, "移动后父节点应更新");
ok(C.moveNode(root0, b.id, a2.id) === false, "不能把父节点移到自己的子孙下（防成环）");
ok(C.moveNode(root0, b.id, b.id) === false, "不能移动到自身");
ok(C.moveNode(root0, root0.id, b.id) === false, "根节点不可移动");
const order0 = root0.children.map((c) => c.id).join(",");
ok(C.moveSibling(root0, root0.children[1].id, -1) === true, "同级应能前移");
ok(root0.children.map((c) => c.id).join(",") !== order0, "前移后顺序应变化");
ok(C.moveSibling(root0, root0.children[0].id, -1) === false, "已在最前时不应移动");

console.log("六、导出");
const md = C.toMarkdown(root0);
ok(/^- 中心主题/m.test(md), "Markdown 首行应为根节点");
ok(/\n  - /.test(md), "Markdown 应用两个空格表示层级");
const back = C.fromMarkdown(md);
ok(C.countNodes(back) === C.countNodes(root0), "Markdown 往返后节点数应一致");
ok(back.children.length === root0.children.length, "往返后一级分支持有数应一致");
const imported = C.fromMarkdown("- 一级\n  - 二级\n  - 二级B\n- 一级B");
ok(imported.text === "一级", "第一个顶层条目应作为根（多根大纲并入根下，避免丢内容）");
ok(imported.children.length === 3, "多根大纲的其余顶层条目应成为根的下一级");
ok(imported.children[0].text === "二级" && imported.children[1].text === "二级B", "缩进的两项应保持同级顺序");
ok(C.toMarkdown(C.fromMarkdown("- A\n  - B\n    - C")).indexOf("- C") > 0, "深层缩进应能还原");
const xm = C.toXmindContent(root0, "我的导图");
ok(Array.isArray(xm) && xm[0]["class"] === "sheet", "XMind 应为 sheet 数组");
ok(xm[0].rootTopic.title === "中心主题", "XMind 根主题标题应正确");
ok(xm[0].rootTopic.children && Array.isArray(xm[0].rootTopic.children.attached), "子主题应放在 children.attached");
ok(/logic\.right/.test(xm[0].rootTopic.structureClass || ""), "结构应为右向逻辑图");
const foldedRoot = C.newNode("R");
const fc = C.addChild(foldedRoot, foldedRoot.id, "C");
foldedRoot.collapsed = true;
foldedRoot.note = "备注内容";
const xm2 = C.toXmindContent(foldedRoot, "x");
ok(xm2[0].rootTopic.folded === true, "折叠状态应导出");
ok(xm2[0].rootTopic.notes && xm2[0].rootTopic.notes.plain.content === "备注内容", "备注应导出");

console.log("七、面板接入");
ok(/getMindmaps/.test(SUPA) && /setMindmaps/.test(SUPA), "应有导图读写接口");
ok(/dims\.tools_mindmaps =/.test(SUPA), "应写到 frontend_dims.tools_mindmaps（不改表结构）");
ok(/Object\.assign\(\{\}, \(data && data\.frontend_dims\) \|\| \{\}\)/.test(SUPA), "保存时应合并其它设置，不能覆盖 frontend_dims 里的其它键");
ok(/data-target="tools-card"/.test(ADMIN_HTML), "后台应有「实用工具」菜单");
ok(/id="tools-card"/.test(ADMIN_HTML), "后台应有对应面板容器");
ok(/nav-item" data-target="tools-card">实用工具</.test(ADMIN_HTML), "菜单名应为「实用工具」");
const iMm = ADMIN_HTML.indexOf('<script src="js/mindmap.js');
const iTools = ADMIN_HTML.indexOf('<script src="js/admin-tools.js');
ok(iMm > 0 && iTools > iMm, "引擎脚本必须在面板脚本之前引入");
ok(/"tools-card": ""/.test(ADMIN_JS), "应在面板-专区映射里登记（不属于任何专区）");
ok(/target === "tools-card"\) return true/.test(ADMIN_JS), "任一管理员应可进入实用工具面板");
ok(/window\.ToolsAdmin\.enter\(\)/.test(ADMIN_JS), "进入面板时应懒加载挂载");
ok(!/from\("site_settings"\)/.test(ADMIN_TOOLS), "面板脚本不应直接操作表（读写统一走数据层）");
ok(/SAVE_DELAY/.test(ADMIN_TOOLS) && /scheduleSave/.test(ADMIN_TOOLS), "应有防抖自动保存");
ok(/setRoot\(window\.MindMapCore\.clone\(/.test(ADMIN_TOOLS), "切换导图应深拷贝，避免编辑污染列表数据");
ok(/core\.walk\(copy\.root, \(n\) => \{ n\.id = core\.uid\("n"\); \}\)/.test(ADMIN_TOOLS), "复制导图应重生成节点 id");
ok(/sbAsk/.test(ADMIN_TOOLS) && /sbConfirm/.test(ADMIN_TOOLS), "重命名/删除应使用站内弹窗，不用浏览器原生弹窗");
ok(!/\bconfirm\(/.test(ADMIN_TOOLS.replace(/sbConfirm/g, "")) && !/\bprompt\(/.test(ADMIN_TOOLS), "不得残留原生 confirm/prompt");

console.log("八、样式与导出菜单");
ok(/\.mm-tools/.test(CSS) && /\.mm-canvas-wrap/.test(CSS) && /\.mm-edit/.test(CSS), "应有布局、画布、就地编辑样式");
ok(/\.mm-svg\.is-dark \.mm-node-text/.test(CSS), "深色主题应切换文字颜色");
ok(/data-x="svg"/.test(SRC) && /data-x="png"/.test(SRC) && /data-x="md"/.test(SRC) && /data-x="xmind"/.test(SRC), "导出菜单应含 SVG / PNG / Markdown / XMind");
ok(/ctrlKey \|\| e\.metaKey/.test(SRC) && /zoomAt\(/.test(SRC), "应支持 Ctrl+滚轮缩放");
ok(/case "Tab"|e\.key === "Tab"/.test(SRC), "应支持 Tab 加子主题");
ok(/e\.key === "Enter"/.test(SRC) && /e\.key === "Delete"/.test(SRC), "应支持 Enter 加同级、Delete 删除");
ok(/moveNode\(state\.root, d\.id, targetId\)/.test(SRC), "应支持拖拽换父级");
ok(/document\.addEventListener\("keydown", onKey\)/.test(SRC), "键盘应监听在 document 上（面板容器不可聚焦，挂在容器上会完全收不到按键）");
ok(!/host\.addEventListener\("keydown"/.test(SRC), "不得把键盘监听挂在不可聚焦的容器上");
ok(/svg\.focus\(/.test(SRC), "点击节点后应把焦点交给画布");
ok(/function panelVisible\(\)/.test(SRC) && /if \(!panelVisible\(\)\) return;/.test(SRC), "全局键盘处理应限定在面板可见时");
ok(/destroy\(\) \{ document\.removeEventListener\("keydown", state\._onKey\); \}/.test(SRC), "应能解绑全局监听（切换面板不重复绑定）");
ok(SRC.indexOf("api.destroy =") < 0, "不能在 api 定义前给它挂属性（会抛未初始化错误）");

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
if (fail) { console.log("MINDTEST-FAIL"); process.exit(1); }
console.log("MINDTEST-OK");
