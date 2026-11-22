/* 20261112E · 实用工具「服装上新甘特图」
 *
 * 把统计口径当成验收点来测，而不是只看能不能画出条：
 *   日期换算（跨月、跨年、只按日期不受时分影响）、
 *   任务编辑（结束早于开始自动纠正、整体平移、右端改时长）、
 *   逾期判定（已完成不算逾期、当天到期不算逾期）、
 *   时间范围（含今天、两侧留白、最少 14 天）、
 *   月份切分（首尾对齐、不重叠不遗漏）、
 *   分组（类目顺序、自定义类目靠后、组内按开始日）、
 *   导出（SVG 尺寸与今天线、CSV 表头与逗号转义与 BOM）。
 *
 *   node tests/t_gantt.mjs
 */
import fs from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const SRC = fs.readFileSync("js/gantt.js", "utf8");
const TOOLS = fs.readFileSync("js/admin-tools.js", "utf8");
const SUPA = fs.readFileSync("js/supabase.js", "utf8");
const ADMIN_HTML = fs.readFileSync("admin.html", "utf8");
const CSS = fs.readFileSync("css/style.css", "utf8");

const win = { window: {} };
const run = new Function("window", "document", SRC + "\nreturn window;")(win.window, undefined);
const G = run.GanttCore;

console.log("一、引擎可用性");
ok(!!G, "应导出 GanttCore");
ok(typeof run.GanttBoard === "function", "应导出 GanttBoard");
ok(typeof G.toSVG === "function" && typeof G.toCSV === "function", "应能导出 SVG / CSV");
ok(!/^document\./m.test(SRC), "顶层不应直接依赖 DOM");
ok(G.CATS.length >= 8 && G.CATS.indexOf("T恤") >= 0 && G.CATS.indexOf("裙装") >= 0, "内置常见服装类目");

console.log("二、日期换算");
ok(G.fmtDate(G.parseDate("2026-03-05")) === "2026-03-05", "解析与格式化互逆");
ok(G.fmtDate(G.addDays(G.parseDate("2026-02-27"), 2)) === "2026-03-01", "跨月加天数正确");
ok(G.fmtDate(G.addDays(G.parseDate("2026-12-31"), 1)) === "2027-01-01", "跨年加天数正确");
ok(G.diffDays(G.parseDate("2026-01-01"), G.parseDate("2026-01-31")) === 30, "同月天数差正确");
ok(G.diffDays(G.parseDate("2026-02-28"), G.parseDate("2026-03-01")) === 1, "跨月天数差正确（非闰年）");
ok(G.diffDays(G.parseDate("2026-01-10"), G.parseDate("2026-01-10")) === 0, "同一天差 0");
const dt = new Date(2026, 4, 6, 23, 45);
ok(G.diffDays(dt, G.parseDate("2026-05-07")) === 1, "带时分也不影响（按日期算）");
ok(G.parseDate("乱写") === null && G.fmtDate(null) === "", "非法日期安全返回");

console.log("三、任务");
const doc = G.newDoc("测试排期");
const t1 = G.addTask(doc, { name: "T恤打样", cat: "T恤", start: "2026-05-01", end: "2026-05-08", progress: 40, owner: "王蕾" });
ok(doc.tasks.length === 1 && t1.name === "T恤打样", "可新增任务");
ok(t1.start === "2026-05-01" && t1.end === "2026-05-08", "起止日保留");
const t2 = G.addTask(doc, { name: "错序", cat: "衬衫", start: "2026-05-10", end: "2026-05-01" });
ok(t2.end > t2.start || t2.end === t2.start, "结束早于开始时自动纠正");
ok(G.addTask(doc, { progress: 130 }).progress === 100, "进度上限 100");
ok(G.addTask(doc, { progress: -5 }).progress === 0, "进度下限 0");
const custom = G.addTask(doc, { cat: "马甲" });
ok(custom.cat === "马甲", "自定义类目应原样保留（服装类目经常要自己加）");
ok(G.addTask(doc, { cat: "" }).cat === G.CATS[0], "类目为空时回落到第一个内置类目，不留空");
ok(G.findTask(doc, t1.id) === t1, "能按 id 找到任务");

console.log("四、平移与改时长");
const mv = G.newTask({ name: "m", start: "2026-05-01", end: "2026-05-05" });
G.shiftTask(mv, 3);
ok(mv.start === "2026-05-04" && mv.end === "2026-05-08", "整体平移后天数不变");
G.shiftTask(mv, -3);
ok(mv.start === "2026-05-01", "反向平移可回原处");
const rz = G.newTask({ name: "r", start: "2026-05-01", end: "2026-05-05" });
G.resizeTask(rz, "2026-05-10");
ok(rz.start === "2026-05-01" && rz.end === "2026-05-10", "拖右端只改结束日");
G.resizeTask(rz, "2026-04-20");
ok(rz.end === "2026-05-01", "结束日不能早于开始日（收到开始日）");

console.log("五、逾期判定");
const now = G.parseDate("2026-05-10");
ok(G.isOverdue({ start: "2026-05-01", end: "2026-05-05", status: "进行中" }, now) === true, "已过结束日算逾期");
ok(G.isOverdue({ start: "2026-05-01", end: "2026-05-10", status: "进行中" }, now) === false, "当天到期不算逾期");
ok(G.isOverdue({ start: "2026-05-01", end: "2026-05-20", status: "进行中" }, now) === false, "未到期不算逾期");
ok(G.isOverdue({ start: "2026-05-01", end: "2026-05-05", status: "已完成" }, now) === false, "已完成的不算逾期（关键口径）");

console.log("六、时间范围与月份切分");
const d2 = G.newDoc();
G.addTask(d2, { name: "a", start: "2026-05-03", end: "2026-05-20" });
G.addTask(d2, { name: "b", start: "2026-06-02", end: "2026-06-18" });
const range = G.rangeOf(d2, now);
ok(G.parseDate(range.start) <= G.parseDate("2026-05-03"), "范围要覆盖最早开始前的留白");
ok(G.parseDate(range.end) >= G.parseDate("2026-06-18"), "范围要覆盖最晚结束后的留白");
ok(range.days >= 14, "范围至少有 14 天，避免挤成一条");
ok(G.parseDate(range.start) <= now && G.parseDate(range.end) >= now, "范围必须包含今天（否则今天线看不见）");
const empty = G.rangeOf(G.newDoc(), now);
ok(empty.days >= 14, "空文档也要给出可用的时间轴");
const months = G.monthSegments(range);
ok(months.length >= 2, "跨月应切成两段以上");
ok(months.reduce((a, m) => a + m.days, 0) === range.days, "各段天数之和应等于总天数（不重叠不遗漏）");
ok(months[0].label < months[1].label, "月份标签按时间先后排列");

console.log("七、分组与统计");
const d3 = G.newDoc();
G.addTask(d3, { name: "裤装B", cat: "裤装", start: "2026-05-08", end: "2026-05-12", progress: 100, status: "已完成" });
G.addTask(d3, { name: "T恤A", cat: "T恤", start: "2026-05-01", end: "2026-05-05", progress: 50, status: "进行中" });
G.addTask(d3, { name: "裤装A", cat: "裤装", start: "2026-05-02", end: "2026-05-06", progress: 0, status: "进行中" });
G.addTask(d3, { name: "自定义", cat: "马甲", start: "2026-05-03", end: "2026-05-09", progress: 20 });
const rows = G.buildRows(d3);
ok(rows.length === 3, "按类目分组，三个类目三组");
ok(rows[0].cat === "T恤", "组顺序按内置类目先后（T恤 在 裤装 之前）");
ok(rows[rows.length - 1].cat === "马甲", "自定义类目排在已知类目之后");
const pants = rows.filter((r) => r.cat === "裤装")[0];
ok(pants.tasks[0].name === "裤装A", "组内按开始日排序（05-02 在 05-08 之前）");
const sT = G.stats(d3, now);
ok(sT.total === 4, "总数统计正确");
ok(sT.done === 1, "已完成数正确");
ok(sT.overdue === 3, "逾期数正确（按 now=05-10 口径，已完成的不算）");
ok(sT.avgProgress === Math.round((100 + 50 + 0 + 20) / 4), "平均进度按算术平均");
ok(sT.byCat.length === 3, "分类目统计条数正确");
const tshirt = sT.byCat.filter((c) => c.cat === "T恤")[0];
ok(tshirt.total === 1 && tshirt.progress === 50, "分类目明细可用");

console.log("八、导出");
const svg = G.toSVG(d3, { now: now, dayW: 20 });
ok(/^<svg /.test(svg), "导出应为合法 svg");
ok(svg.indexOf("今天") > 0 && svg.indexOf("#ef4444") > 0, "应画出今天线");
ok(svg.indexOf("裤装") > 0 && svg.indexOf("T恤") > 0, "类目名应写入");
ok(svg.indexOf("裤装A") > 0, "任务名应写入");
ok((svg.match(/rx="6"/g) || []).length >= 4, "每个任务一个圆角条");
const wide = G.toSVG(d3, { now: now, dayW: 40 });
const w1 = Number(svg.match(/width="(\d+)"/)[1]);
const w2 = Number(wide.match(/width="(\d+)"/)[1]);
ok(w2 > w1, "放大刻度后画布应变宽");

const csv = G.toCSV(d3);
ok(csv.charCodeAt(0) === 0xfeff, "CSV 应带 BOM（Excel 打开不乱码）");
ok(csv.split("\r\n").length === 5, "表头 + 4 行任务");
ok(csv.indexOf("类目,任务,开始,结束") === 0 + 1 || csv.indexOf("类目,任务,开始,结束") > 0, "表头字段齐全");
const d4 = G.newDoc();
G.addTask(d4, { name: '含逗号,和"引号"', cat: "T恤", start: "2026-05-01", end: "2026-05-02" });
const csv2 = G.toCSV(d4);
ok(csv2.indexOf('"含逗号,和""引号"""') > 0, "含逗号与引号的字段应正确转义");

console.log("九、示例与后台接入");
const sample = G.sampleTasks(G.parseDate("2026-05-01"));
ok(sample.length >= 6, "示例应覆盖多个类目、多条任务");
ok(new Set(sample.map((x) => x.cat)).size >= 4, "示例至少覆盖 4 个类目");
ok(sample.every((x) => G.parseDate(x.start) && G.parseDate(x.end)), "示例日期都合法");
ok(ADMIN_HTML.indexOf("js/gantt.js") > 0, "后台应引入 gantt.js");
ok(TOOLS.indexOf("上新甘特图") > 0, "实用工具里应有甘特图入口");
ok(TOOLS.indexOf("GanttBoard") > 0 && TOOLS.indexOf("GanttCore") > 0, "面板应真正挂载甘特图");
ok(/getGantts/.test(SUPA) && /setGantts/.test(SUPA), "应有甘特图存取接口");
ok(SUPA.indexOf("tools_gantts") > 0, "数据应存在站点设置里（不改表结构）");
ok(/\.gt-bar/.test(CSS) && /\.gt-today/.test(CSS) && /\.gt-now/.test(CSS), "应有条形、今天列、今天线样式");
ok(/\.gt-handle/.test(CSS), "应有右端拖拽手柄样式（改结束日）");

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
if (fail) process.exit(1);
console.log("GANTT-OK");
