/* 20261111AF · 专区后台「导出 / 导入打标表」
 *
 * 背景（真实故障）：后台点「导出打标表」提示「导出模块未加载，请强刷页面」，
 * 强刷也没用。原因是 rankexport.js 结尾导出清单里引用了一个已经不存在的函数，
 * 文件在加载阶段就抛 ReferenceError，window.RankExport 从来没被赋值过。
 * 这类「脚本整体没注册」的问题肉眼看不出来，所以这里用真实执行来证明：
 * 把脚本按浏览器顺序在沙箱里跑一遍，断言 window.RankExport 真的存在且可用。
 *
 * 覆盖：
 *  1) rankexport.js 能在干净环境里执行完并挂出 window.RankExport（防再犯）
 *  2) 导出清单里不引用未定义的标识符（静态扫一遍函数体内部引用）
 *  3) 专区面板有「导入打标表」入口：按钮、文件选择、写入方式、执行
 *  4) 导入按本专区图片清单做白名单匹配（否则文档存储的图全被判成对不上）
 *  5) 导入结果文案交代 写入/对上/对不上/未识别/缺列，不把 0 行当成功
 *  6) 导入同样受专区权限守卫
 *  7) 导出失败提示要区分「模块没加载」与「表格组件没加载」
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

/* ---------- 1. 真实执行：导出模块必须挂得上 ---------- */
function makeSandbox() {
  const doc = {
    readyState: "loading",
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement() {
      return { style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; } };
    },
    body: { appendChild() {} },
  };
  const s = {
    console, Date, Math, JSON, Array, Object, String, Number, Boolean, RegExp, Error,
    Promise, setTimeout, clearTimeout, TextDecoder, Uint8Array, ArrayBuffer,
    Blob: function () {}, File: function () {}, URLSearchParams,
    document: doc, navigator: { userAgent: "node" },
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { href: "http://local/" },
  };
  s.window = s; s.globalThis = s; s.self = s;
  vm.createContext(s);
  return s;
}

const sb = makeSandbox();
let xlsxOk = true;
try { vm.runInContext(read("vendor/xlsx.full.min.js"), sb, { filename: "xlsx.full.min.js" }); }
catch (e) { xlsxOk = false; }

let exportErr = null;
try { vm.runInContext(read("js/rankexport.js"), sb, { filename: "rankexport.js" }); }
catch (e) { exportErr = e; }

ok(!exportErr, "rankexport.js 加载阶段抛错：" + (exportErr && exportErr.message));
ok(!!sb.window.RankExport, "window.RankExport 未挂上（后台导出会一直提示「模块未加载」）");
ok(typeof (sb.window.RankExport || {}).buildBook === "function", "RankExport.buildBook 不可用（导出打标表的核心）");
ok(xlsxOk, "vendor/xlsx.full.min.js 无法在沙箱里执行");
ok(typeof sb.XLSX !== "undefined", "XLSX 未挂上（导出会报缺表格组件）");

/* ---------- 2. 导出清单不得引用未定义标识符 ---------- */
const RE_SRC = read("js/rankexport.js");
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const exportBlock = stripComments(RE_SRC.slice(RE_SRC.indexOf("window.RankExport = {")));
const expList = exportBlock.slice(0, exportBlock.indexOf("};"));
/* 取清单里 `key: value` 的 value 标识符，逐个确认文件里真的定义过 */
const idents = [...expList.matchAll(/[,{]\s*(?:[A-Za-z_$][\w$]*\s*:\s*)?([A-Za-z_$][\w$]*)\s*[,}]/g)]
  .map((m) => m[1]).filter((v) => v && v !== "window" && v !== "RankExport");
const missing = idents.filter((v) => {
  const defined = new RegExp("(?:function\\s+" + v + "\\b|(?:var|let|const)\\s+" + v + "\\b|" + v + "\\s*=)");
  return !defined.test(RE_SRC);
});
ok(missing.length === 0, "导出清单引用了未定义的标识符：" + missing.join("、"));
ok(!/\bhitChannel\s*[,}]/.test(expList), "导出清单不应再引用已下线的 hitChannel");

/* ---------- 2b. 专区导出必须能把「已打标」的图也导出来 ----------
 * buildBook 的默认范围是「仅未打标」，专区的图多数已打过标；
 * 用默认值会导出一张只有表头的空表（用户看到的「导出没反应」）。 */
const exFn = AD_SRC_SAFE();
function AD_SRC_SAFE() { return fs.readFileSync(path.join(ROOT, "js/admin-channelzone.js"), "utf8"); }
ok(/\{ scope: scope \}/.test(exFn) || /scope: "all"/.test(exFn), "专区导出必须显式传打标范围（默认不能落到「仅未打标」）");
ok(/所选范围里没有符合条件的图/.test(exFn), "无可导出内容时应提示，而不是下载一张只有表头的空表");
ok(/pack\.stats\.picked/.test(exFn), "导出张数应取 stats.picked（真正写进表的数量），不能取 total");

/* 实测：两张图（一张部分打标、一张未打标）在 scope=all 下都要出现 */
if (sb.window.RankExport) {
  try {
    const pack = sb.window.RankExport.buildBook(
      [{ image_url: "https://x/a.jpg", category: "女装", period_label: "2026-11" },
       { image_url: "https://x/b.jpg", category: "女装", period_label: "2026-11" }],
      { "https://x/a.jpg": { style_tags: ["街头潮流"] }, "https://x/b.jpg": {} },
      { scope: "all" }
    );
    ok(pack && pack.stats && pack.stats.total === 2, "scope=all 下两张图都应进入导出表（实际 " + (pack && pack.stats && pack.stats.total) + "）");
    const aoa = sb.XLSX.utils.sheet_to_json(pack.wb.Sheets["打标表"], { header: 1 });
    ok(aoa.length === 3, "打标表应为表头 + 2 行，实际 " + aoa.length + " 行");
    ok(aoa[0][0] === "图片URL", "首列必须是「图片URL」，否则导入对不上");
  } catch (e) {
    ok(false, "专区导出实测失败：" + e.message);
  }
}

/* ---------- 3. 导入入口 ---------- */
const AD = read("js/admin-channelzone.js");
ok(/id="' \+ id\(k, "import"\) \+ '"[^>]*>导入打标表/.test(AD), "工具栏缺少「导入打标表」按钮");
ok(/id="' \+ id\(k, "imp-file"\) \+ '"[^>]*accept="\.xlsx,\.xls"/.test(AD), "工具栏缺少表格选择入口");
ok(/function importModalHtml\(z\)/.test(AD), "缺少导入弹窗");
ok(/id="' \+ id\(k, "imp-mode"\)/.test(AD) && /只补空白/.test(AD) && /覆盖/.test(AD), "导入弹窗缺少写入方式（补空白 / 覆盖）");
ok(/id="' \+ id\(k, "imp-clear"\)/.test(AD), "导入弹窗缺少「留空也清空」选项");
ok(/id="' \+ id\(k, "imp-run"\)/.test(AD) && /开始导入/.test(AD), "缺少执行导入的按钮");
ok(/function openImport\(k\)/.test(AD) && /function runImport\(k\)/.test(AD), "缺少导入处理函数");
ok(/window\.RankTagImport/.test(AD), "导入应复用现成的打标导入通道，而不是另写一套解析");
ok(/RankTagImport\.importFile/.test(AD), "未调用无状态导入入口 importFile");

/* ---------- 4. 白名单匹配 ---------- */
const RI = read("js/admin-rankimport.js");
ok(/Array\.isArray\(opts\.urls\) && opts\.urls\.length/.test(RI), "importFile 未支持按给定图片清单匹配");
ok(/urls: st\.items\.map\(function \(r\) \{ return r\.image_url; \}\)/.test(AD),
  "调用导入时应传入本专区的图片清单（否则文档存储的图全被判成对不上）");
ok(/不属于本专区，已跳过/.test(AD), "对不上的行应说明是被跳过，而不是静默丢弃");

/* ---------- 5. 结果文案 ---------- */
const runFn = AD.slice(AD.indexOf("async function runImport"), AD.indexOf("async function runImport") + 2600);
ok(/写入 " \+ \(res\.written \|\| 0\) \+ " 张/.test(runFn), "结果要报实际写入张数");
ok(/对上 " \+ res\.hit/.test(runFn) && /对不上/.test(runFn), "结果要报对上/对不上的行数");
ok(/未识别取值/.test(runFn), "结果要报未识别的枚举取值");
ok(/缺列未写/.test(runFn), "结果要报缺列（库里没这列时标出来，而不是假装写全）");
ok(/await loadAll\(k\)/.test(runFn), "导入后要重新拉数据，图墙才会显示新标签");
ok(/导入失败：/.test(runFn), "导入失败要明确报错，不能静默");

/* ---------- 6. 权限守卫 ---------- */
ok(/async function runImport\(k\) \{[\s\S]{0,260}guardZone/.test(AD), "导入必须走专区权限守卫");
ok(/function openImport\(k\) \{[\s\S]{0,400}RankTagImport/.test(AD), "导入入口应检查模块可用性，缺失时提示而非静默");

/* ---------- 7. 导出报错区分真实原因 ---------- */
/* 专区的导出入口现在是弹窗 + 执行两段，两段都要做前置判断 */
const openFn = AD.slice(AD.indexOf("function openExport(k)"), AD.indexOf("function openExport(k)") + 700);
const runFn2 = AD.slice(AD.indexOf("async function runExport(k)"), AD.indexOf("async function runExport(k)") + 700);
ok(/if \(!window\.RankExport\)/.test(openFn) && /if \(!RE\)/.test(runFn2), "导出应先判断导出模块是否可用");
ok(/typeof XLSX === "undefined"/.test(openFn) && /typeof XLSX === "undefined"/.test(runFn2), "导出应单独判断表格组件");
ok(/表格组件未加载/.test(openFn), "缺表格组件时的提示要与「模块未加载」区分开");

/* 后台必须真的引用了这两个脚本（否则上面的入口都是死的） */
const ADMIN = read("admin.html");
ok(/js\/rankexport\.js\?v=/.test(ADMIN), "admin.html 未引用 rankexport.js");
ok(/js\/admin-rankimport\.js\?v=/.test(ADMIN), "admin.html 未引用 admin-rankimport.js");
/* 只认 <script src> 标签，正文注释里提到文件名不算加载顺序 */
const scriptOrder = (name) => {
  const m = ADMIN.match(new RegExp('<script src="js/' + name.replace(/\./g, "\\.") + '\\?v='));
  return m ? m.index : -1;
};
const iExp = scriptOrder("rankexport.js");
const iImp = scriptOrder("admin-rankimport.js");
const iCZ = scriptOrder("admin-channelzone.js");
ok(iExp > 0 && iImp > 0 && iCZ > 0, "admin.html 缺少脚本引用（rankexport / admin-rankimport / admin-channelzone）");
ok(iExp < iCZ, "rankexport.js 必须在 admin-channelzone.js 之前加载（专区导出依赖它）");
ok(iImp < iCZ, "admin-rankimport.js 必须在 admin-channelzone.js 之前加载");

/* ---------- 8. 按类目导出（20261111AF） ---------- */
const AD2 = read("js/admin-channelzone.js");
const MV = read("js/admin-movement.js");
const ADMIN2 = read("admin.html");

/* 专区：导出改为弹窗，能选一个或多个类目 */
ok(/function exportModalHtml\(z\)/.test(AD2), "专区缺少导出弹窗（按类目导出没有入口）");
ok(/cz-exp-cbx/.test(AD2), "导出弹窗缺少类目勾选");
ok(/全选/.test(AD2) && /function setAllExpCats/.test(AD2), "导出弹窗缺少类目全选/清空");
ok(/id="' \+ id\(k, "exp-split"\)/.test(AD2) && /按类目分表/.test(AD2), "导出弹窗缺少「按类目分表」选项");
ok(/id="' \+ id\(k, "exp-scope"\)/.test(AD2), "导出弹窗缺少打标范围选择");
ok(/id="' \+ id\(k, "exp-month"\)/.test(AD2), "导出弹窗缺少月份筛选");
ok(/buildBookSplit\(detailOf\(base\)/.test(AD2), "分表导出应调用 buildBookSplit");
ok(/至少选一个类目/.test(AD2), "一个类目都不选时应提示，而不是导出全部");
ok(/cats\.length === 1 \? String\(cats\[0\]\).*\+ "-" : ""/.test(AD2), "单类目导出时文件名应带上类目名");

/* 上新节奏：同样支持按类目选 + 分表 */
ok(/mv-exp-cats/.test(ADMIN2) && /mv-exp-split/.test(ADMIN2), "趋势动向导出弹窗未接入 admin.html");
ok(/function expCheckedCats\(\)/.test(MV), "趋势动向缺少类目勾选读取");
ok(/buildBookSplit\(detail, state\.tagMap/.test(MV), "趋势动向分表导出应调用 buildBookSplit");
ok(/sp\.wb\.SheetNames\.forEach/.test(MV) && /appendCol\(sp\.wb\.Sheets\[nm\]/.test(MV),
  "趋势动向分表时每个工作表都要补「模特/腰型/渠道」三列");
ok(/stats\.picked/.test(MV), "趋势动向导出张数应取 stats.picked");

/* 导出模块：分表实现 ---------- */
const REX = read("js/rankexport.js");
ok(/function buildBookSplit\(detail, tagMap, opts\)/.test(REX), "导出模块缺少 buildBookSplit");
ok(/buildBookSplit: buildBookSplit/.test(REX), "buildBookSplit 未对外暴露（界面调不到）");
ok(/function safeSheetName\(name, used\)/.test(REX), "缺少工作表名清洗（Excel 禁 : \\ / ? * [ ]，31 字上限）");
ok(/replace\(/g.test(REX), "工作表名应清洗非法字符");
ok(/while \(used\[s\]\)/.test(REX), "重名工作表应自动加序号，否则同名类目会覆盖");
ok(/p\.stats\.picked/.test(REX), "分表应把「范围过滤后为空」的类目跳过（用 picked 判断）");
ok(/枚举参考/.test(REX), "分表应附一张枚举参考");

/* 实测：两个类目 → 两个工作表 + 枚举参考，空类目不出表 */
if (sb.window.RankExport && sb.window.RankExport.buildBookSplit) {
  const detail = [
    { image_url: "https://x/a.jpg", category: "T恤", period_label: "2026-11" },
    { image_url: "https://x/b.jpg", category: "T恤", period_label: "2026-11" },
    { image_url: "https://x/c.jpg", category: "裤装/长裤", period_label: "2026-11" },
  ];
  const tags = { "https://x/a.jpg": { style_tags: ["街头潮流"] }, "https://x/b.jpg": {}, "https://x/c.jpg": {} };
  const r1 = sb.window.RankExport.buildBookSplit(detail, tags, { scope: "all" });
  ok(r1.sheets === 2 && r1.total === 3, "分表结果应为 2 类 3 张（实际 " + r1.sheets + " 类 " + r1.total + " 张）");
  ok(r1.wb.SheetNames.includes("枚举参考"), "分表缺少「枚举参考」工作表");
  ok(r1.wb.SheetNames.includes("裤装-长裤"), "工作表名应清洗非法字符（/ → -）");
  const aoa = sb.XLSX.utils.sheet_to_json(r1.wb.Sheets["T恤"], { header: 1 });
  ok(aoa.length === 3, "T恤 表应为表头 + 2 行，实际 " + aoa.length);
  ok(aoa[0][0] === "图片URL", "分表首列仍须是「图片URL」（导回时按地址匹配）");

  const r2 = sb.window.RankExport.buildBookSplit(detail, tags, { scope: "done" });
  ok(r2.sheets === 0 && r2.total === 0, "打标范围过滤后全空时，不应生成任何工作表（实际 " + r2.sheets + " 个）");
  ok(r2.emptyCats.length === 2, "被跳过的类目应记录在 emptyCats，供界面提示");
} else {
  ok(false, "buildBookSplit 不可用，无法验证按类目分表");
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
