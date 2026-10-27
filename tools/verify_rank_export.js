/* verify_rank_export.js —— 趋势上升榜「导出数据 + 打标回填」校验（20261027H）
 *
 * 三组断言：
 *   A 导出：按图片去重、期次合并排序、位次取最优、标签列齐全、三个工作表都在
 *   B 回填：真写一份 xlsx 再用回填模块解析回来（不是查字符串），验证多值拆分、
 *           视觉三列合并、版型加组前缀、枚举外取值被拒绝并计入未识别
 *   C 接线：榜单页按钮与脚本、后台回填区与脚本、数据层字段、SQL 补丁齐备
 *
 * 用法：NODE_PATH=work/testdeps/node_modules node tools/verify_rank_export.js [项目根目录]
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

const XLSX = require(path.join(ROOT, "vendor/xlsx.full.min.js"));

function makeEnv() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
  const w = dom.window;
  w.XLSX = XLSX;
  w.SB = { listRankItems: async () => [], listRankTagRows: async () => ({}) };
  w.alert = () => {};
  w.URL.createObjectURL = () => "blob:x";
  w.URL.revokeObjectURL = () => {};
  w.eval(read("js/rankexport.js"));
  w.eval(read("js/admin-rankimport.js"));
  return w;
}

const w = makeEnv();
const EXP = w.RankExport;
const IMP = w.RankTagImport;

console.log("\n[A] 导出组装");
ok("三个工作表都有", (() => {
  const r = EXP.buildBook([{ image_url: "https://a/1.jpg", period_label: "W43", category: "T恤", site: "美国", rank_ratio: 2, ratio: 88 }], {});
  return r.wb.SheetNames.join(",") === "打标表,全量明细,枚举参考";
})());

const detail = [
  { image_url: "https://a/1.jpg", period_label: "W43", period_type: "week", category: "T恤", site: "美国", leaf_category: "短袖T", rank_ratio: 3, ratio: 55, abs_delta: 12, flag_hot: true },
  { image_url: "https://a/1.jpg", period_label: "W42", period_type: "week", category: "T恤", site: "德国", leaf_category: "短袖T", rank_ratio: 1, ratio: 90, abs_delta: 30 },
  { image_url: "https://a/2.jpg", period_label: "W42", period_type: "week", category: "裤装", site: "美国", leaf_category: "直筒裤", rank_ratio: 5, ratio: 10, abs_delta: 5 }
];
const pack = EXP.buildBook(detail, {});
const wsMain = pack.wb.Sheets["打标表"];
const aoa = XLSX.utils.sheet_to_json(wsMain, { header: 1, raw: false, defval: "" });

ok("按图片去重：3 行 → 2 张图", pack.images === 2 && aoa.length === 3, "images=" + pack.images);
ok("表头 23 列且含全部标签列", aoa[0].length === 23 && aoa[0].indexOf("视觉-呈现主体") > 0 && aoa[0].indexOf("裙长") > 0);
const row1 = aoa[1];
ok("同图多期次合并并按先后排序", row1[0] === "https://a/1.jpg" && row1[3] === "W42，W43", row1[3]);
ok("多站点合并", row1[4] === "美国，德国", row1[4]);
ok("位次取最优（数值最小）", String(row1[5]) === "1", String(row1[5]));
ok("环比取最高", String(row1[6]) === "90", String(row1[6]));
ok("未打标时标签列为空", row1.slice(7, 22).every((x) => x === ""));

const withTags = EXP.buildBook(detail, {
  "https://a/1.jpg": {
    style_tags: ["街头潮流"], visual_tags: ["纯白底", "模特全身"], element_tags: ["条纹", "口袋"],
    craft_tags: ["刺绣"], shoot_tags: ["模拍"],
    fit_tags: ["领型·圆领", "袖长·长袖", "松紧度·宽松"]
  }
}).wb.Sheets["打标表"];
const aoa2 = XLSX.utils.sheet_to_json(withTags, { header: 1, raw: false, defval: "" });
const r2 = aoa2[1];
ok("已有标签回填到对应列（风格/元素/工艺/拍摄）", r2[7] === "街头潮流" && r2[11] === "条纹，口袋" && r2[12] === "刺绣" && r2[13] === "模拍");
ok("视觉多值合一列", r2[8] === "纯白底，模特全身", r2[8]);
ok("版型按子分组回填到各自列", r2[14] === "圆领" && r2[16] === "长袖" && r2[18] === "宽松", [r2[14], r2[16], r2[18]].join("|"));

console.log("\n[B] 回填解析（真 xlsx 往返）");
const buf = XLSX.write(pack.wb, { bookType: "xlsx", type: "array" });
const parsed = IMP.parseBook(buf);
ok("能解析出 2 行", parsed.rows.length === 2, "rows=" + parsed.rows.length);
ok("读到的工作表是「打标表」", parsed.sheet === "打标表", parsed.sheet);

// 造一张带标签的 xlsx 再解析
const book = XLSX.utils.book_new();
const head = EXP.COLS.slice();
const rowA = head.map(() => "");
rowA[0] = "https://a/1.jpg"; rowA[7] = "街头潮流, 极简"; rowA[8] = "纯白底";
rowA[9] = "模特半身"; rowA[10] = "模特全身"; rowA[11] = "条纹，口袋";
rowA[12] = "刺绣/钉珠"; rowA[13] = "模拍"; rowA[14] = "圆领"; rowA[16] = "长袖";
rowA[18] = "宽松";
const rowB = head.map(() => "");
rowB[0] = "https://a/9.jpg"; rowB[7] = "街头"; // 枚举外
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([head, rowA, rowB]), "打标表");
const buf2 = XLSX.write(book, { bookType: "xlsx", type: "array" });
const p2 = IMP.parseBook(buf2);
const rec = p2.rows.find((x) => x.url === "https://a/1.jpg");
ok("多值按中英文逗号、斜杠拆分", rec.tags.style_tags.join("|") === "街头潮流|极简", (rec.tags.style_tags || []).join("|"));
ok("视觉三列合并进 visual_tags", (rec.tags.visual_tags || []).join("|") === "纯白底|模特半身|模特全身", (rec.tags.visual_tags || []).join("|"));
ok("版型加子分组前缀", (rec.tags.fit_tags || []).includes("领型·圆领") && (rec.tags.fit_tags || []).includes("松紧度·宽松"), (rec.tags.fit_tags || []).join("|"));
ok("二次工艺斜杠拆分", (rec.tags.craft_tags || []).join("|") === "刺绣|钉珠");
ok("枚举外取值被拒并计入未识别", (rec.tags.style_tags || []).indexOf("街头") < 0 && p2.unknown.some((u) => u.v === "街头"), JSON.stringify(p2.unknown));
const blank = p2.rows.find((x) => x.url === "https://a/9.jpg");
ok("标签全被拒时该行仍保留但标签为空（便于统计）", !!blank && Object.keys(blank.tags).length === 0, JSON.stringify(blank && blank.tags));

console.log("\n[C] 接线");
const RANK_HTML = read("rank.html");
const ADMIN_HTML = read("admin.html");
const SB = read("js/supabase.js");
const SQL = fs.existsSync(path.join(ROOT, "tools/patch_20261027H.sql")) ? read("tools/patch_20261027H.sql") : "";

ok("榜单页有「导出数据」按钮", /id="rk-export-btn"[^>]*>导出数据</.test(RANK_HTML));
ok("榜单页引入 xlsx 与导出脚本", RANK_HTML.includes("vendor/xlsx.full.min.js") && RANK_HTML.includes("js/rankexport.js"));
ok("后台有回填区（文件选择 + 写入按钮）", ADMIN_HTML.includes('id="rank-tag-file"') && ADMIN_HTML.includes('id="rank-tag-import"'));
ok("后台引入回填脚本", ADMIN_HTML.includes("js/admin-rankimport.js"));
ok("数据层读写包含三个新列", ["visual_tags", "craft_tags", "fit_tags"].every((f) => SB.includes(f)));
ok("SQL 补丁含三列与索引", ["add column if not exists visual_tags", "add column if not exists craft_tags", "add column if not exists fit_tags"].every((x) => SQL.includes(x))
  && SQL.includes("idx_rank_image_tags_fit"));
ok("SQL 补丁会刷新接口缓存", /notify pgrst, 'reload schema'/.test(SQL));
ok("回填带批次号（可回滚）", read("js/admin-rankimport.js").includes('"tagimport-"'));
ok("回填按图片URL精确匹配（不做标题相似）", /exist\[x\.url\]/.test(read("js/admin-rankimport.js")));

const ENUM = EXP.ENUM;
ok("枚举含 5 个主维度 + 8 个版型子分组", Object.keys(ENUM).length === 13, Object.keys(ENUM).join(","));
ok("版型 8 个子分组齐全", ["领型", "袖型", "袖长", "衣长", "松紧度", "裤型", "裤长", "裙长"].every((k) => ENUM[k] && ENUM[k].length));
ok("拍摄方式含用户点名的四种", ["摆拍", "挂拍", "3D", "模拍"].every((v) => ENUM["拍摄方式"].includes(v)));

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);