/* ============================================================================
 * t_fabric_import.js —— 面料候选列导入离线断言（20261102B）
 *
 * 背景：人工打标表把面料拆成「面料-外层（候选）」「面料-内里（候选）」两列，
 *       候选项用全角竖线 ｜ 串在一起；旧导入只认单列「面料」、且只认半角 |，
 *       结果是整列面料既没被读取、读到的也不在枚举里 —— 前端「面料」一栏永远空。
 *
 * 本测试锁定三件事：
 *   ① 两列候选能合并进 fabric_tags，且全角 ｜ 被正确拆开
 *   ② 面料不做枚举过滤（候选池里有 17 个枚举外常用词，不能判未识别丢弃）
 *   ③ 其他维度的枚举校验没被放宽（拿掉面料豁免后照旧拦）
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✓ " + n); };
const no = (n, d) => { fail++; console.log("  ✗ " + n + (d ? " — " + d : "")); };

/* 极简浏览器桩：本文件只跑纯函数，不碰 DOM */
global.window = global;
global.document = { addEventListener() {}, querySelector() { return null; } };

function load(rel) {
  const p = path.resolve(__dirname, "..", rel);
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(p, "utf8"));
}
load("js/rank-enums.js");
/* 真实页面里 RankExport 先于导入模块加载；这里用枚举表直接顶替，
   否则导入端拿不到允许值列表，会退化成「什么值都放行」，测不出校验是否还在 */
window.RankExport = { ENUM: window.APP_ENUM };
load("js/admin-rankimport.js");

const T = window.RankTagImport && window.RankTagImport.__test;
if (!T) { console.log("✗ 取不到导入模块的测试入口"); process.exit(1); }

const URL1 = "https://img.kwcdn.com/product/a.jpg";
const URL2 = "https://img.kwcdn.com/product/b.jpg";

/* ---------- ① 三列并存：外层 + 内里 一起进 fabric_tags ---------- */
const head3 = ["图片URL", "类目", "风格", "面料-外层（候选）", "面料-内里（候选）", "面料置信度", "面料判定依据"];
const aoa1 = [
  head3,
  [URL1, "T恤", "街头潮流,休闲",
    "纯棉（100%棉）｜精梳棉（精梳棉纱·毛羽少）｜棉涤（棉+涤·棉占比更高）",
    "常规内里（无内里·单层）", "低", "类目推断·候选池"],
  [URL2, "外套夹克", "商务正装",
    "涤纶（100%涤纶）｜帆布（棉质厚帆布）",
    "绗棉内里（夹棉填充）｜羽绒内胆（羽绒填充）", "中", "类目推断·候选池"]
];
const r1 = T.parseRows(aoa1);
const m1 = {}; r1.rows.forEach((r) => { m1[r.url] = r; });

const f1 = (m1[URL1].tags || {}).fabric_tags || [];
if (f1.length === 4) ok("外层 3 项 + 内里 1 项 合并为 4 个候选");
else no("候选数不对", JSON.stringify(f1));
if (f1.indexOf("纯棉（100%棉）") >= 0 && f1.indexOf("棉涤（棉+涤·棉占比更高）") >= 0) ok("全角 ｜ 被正确拆开");
else no("全角竖线没拆开", JSON.stringify(f1));
if (f1.indexOf("常规内里（无内里·单层）") >= 0) ok("内里候选也写入（此前整列被忽略）");
else no("内里候选丢失", JSON.stringify(f1));
if (m1[URL1].provided && m1[URL1].provided.fabric_tags) ok("面料被标记为「本次要写」");
else no("面料未标记 provided，写库时会跳过");

/* ---------- ② 枚举外的面料词不判未识别 ---------- */
const f2 = (m1[URL2].tags || {}).fabric_tags || [];
if (f2.indexOf("涤纶（100%涤纶）") >= 0 && f2.indexOf("尼龙（锦纶平纹·塔丝隆）") < 0) {
  if (f2.indexOf("帆布（棉质厚帆布）") >= 0) ok("枚举外面料词（帆布 / 涤纶）原样写入");
  else no("枚举外面料词被丢弃", JSON.stringify(f2));
} else no("面料写入异常", JSON.stringify(f2));
if (!r1.unknown || r1.unknown.length === 0) ok("面料不产生「未识别」");
else no("面料被误判未识别", JSON.stringify(r1.unknown));

/* ---------- ③ 单列「面料」同样支持全角竖线 ---------- */
const aoa2 = [
  ["图片URL", "面料"],
  [URL1, "珠地（珠地网眼针织）｜涤棉（涤纶+棉·CVC/TC）"]
];
const r2 = T.parseRows(aoa2);
const f3 = ((r2.rows[0].tags || {}).fabric_tags) || [];
if (f3.length === 2) ok("单列「面料」内的全角竖线也拆开");
else no("单列面料拆词失败", JSON.stringify(f3));

/* ---------- ④ 其他维度仍严格校验 ---------- */
const aoa3 = [
  ["图片URL", "风格", "面料"],
  [URL1, "根本不存在的风格", "纯棉（100%棉）"]
];
const r3 = T.parseRows(aoa3);
const unk = (r3.unknown || []).map((x) => x.v);
if (unk.indexOf("根本不存在的风格") >= 0) ok("风格等维度仍按枚举拦截");
else no("枚举校验被整体放宽了", JSON.stringify(unk));
if ((((r3.rows[0] || {}).tags || {}).style_tags || []).length === 0) ok("未识别值不会写进风格");
else no("未识别值被写入");

/* ---------- ⑤ MAP 里三个面料列名都在 ---------- */
const labels = (window.RankTagImport.MAP || []).map((m) => m[0]);
["面料", "面料-外层（候选）", "面料-内里（候选）"].forEach((l) => {
  if (labels.indexOf(l) >= 0) ok("导入认「" + l + "」列");
  else no("导入不认「" + l + "」列");
});

/* ---------- ⑥ 前端面板不再按 57 项过滤面料 ---------- */
const rankJs = fs.readFileSync(path.resolve(__dirname, "..", "js/rank.js"), "utf8");
if (/\["面料", "fabric_tags", ""\]/.test(rankJs)) ok("前台面料分组不按枚举过滤");
else no("前台仍按枚举过滤面料，枚举外候选会被塞进「视觉·其他」");

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
