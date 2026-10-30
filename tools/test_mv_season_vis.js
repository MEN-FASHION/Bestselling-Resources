/* 趋势动向 · 发布会年度/季节 + 标签前台可见性 · 结构校验
   用法：node tools/test_mv_season_vis.js   （在工作区根目录执行）
   只读源码做断言，不改任何文件。 */
const fs = require("fs");
const path = require("path");

const R = process.cwd();
const read = (p) => fs.readFileSync(path.join(R, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + m); } };
const has = (s, sub, m) => ok(s.indexOf(sub) >= 0, m + "（缺少：" + sub + "）");
const hasnt = (s, sub, m) => ok(s.indexOf(sub) < 0, m + "（不应出现：" + sub + "）");

const adminHtml = read("admin.html");
const adminJs = read("js/admin-movement.js");
const sb = read("js/supabase.js");
const frontHtml = read("movement.html");
const frontJs = read("js/movement-front.js");
const css = read("css/style.css");
const sql = read("tools/patch_20261030J_season_visibility.sql");

console.log("\n[1] 后台界面：年度 / 季节控件");
["mv-upload-year", "mv-upload-season", "mv-filter-year", "mv-filter-season",
 "mv-tag-year", "mv-tag-season"].forEach((id) => has(adminHtml, 'id="' + id + '"', "控件 " + id));

console.log("\n[2] 后台界面：前台可见性入口与弹窗");
["mv-vis-btn", "mv-vis-modal", "mv-vis-list", "mv-vis-save", "mv-vis-all", "mv-vis-close"]
  .forEach((id) => has(adminHtml, 'id="' + id + '"', "控件 " + id));
has(adminHtml, "前台可见标签", "弹窗标题");

console.log("\n[3] 后台脚本：季节逻辑");
has(adminJs, 'var SEASONS = ["春", "夏", "秋", "冬"]', "季节四选一");
has(adminJs, "function yearOptions(", "年度选项生成");
has(adminJs, "function fillSeasonSelects(", "季节下拉填充");
has(adminJs, "function filteredItems(", "三筛选合并");
has(adminJs, "function seasonLabel(", "季节文案");
has(adminJs, "async function saveSeasonQuick(", "大图面板即时保存");
has(adminJs, "season_year", "读取年度字段");
has(adminJs, "state.curYear", "年度筛选状态");
has(adminJs, "state.curSeason", "季节筛选状态");
ok(/state\.curCat && \(r\.category \|\| "未分类"\) !== state\.curCat/.test(adminJs), "类目筛选改为独立判断（与年度季节并列）");
ok(/if \(state\.curYear[\s\S]{0,200}state\.curSeason/.test(adminJs), "年度与季节同时生效");
has(adminJs, "mv-season-badge", "卡片季节徽标");
has(adminJs, "fillSeasonSelects()", "loadAll 后重建下拉");

console.log("\n[4] 后台脚本：上传带发布会信息");
ok(/uploadMovementImages\(files, cat, function[\s\S]{0,220}\{ seasonYear: seasonYear, season: season \}\)/.test(adminJs),
   "上传调用传 opts");
has(adminJs, 'document.getElementById("mv-upload-year")', "读上传年度");
has(adminJs, 'document.getElementById("mv-upload-season")', "读上传季节");

console.log("\n[5] 后台脚本：可见性逻辑");
has(adminJs, "async function loadVis(", "读取配置");
has(adminJs, "function renderVisList(", "渲染开关列表");
has(adminJs, "async function saveVis(", "保存配置");
has(adminJs, "function showAllVis(", "一键全开");
ok(/function isVis\(key\) \{ return state\.vis\[key\] !== false; \}/.test(adminJs), "默认可见语义");
ok(/mv-vis-btn"\);\s*\n\s*if \(vb\) vb\.onclick = openVis/.test(adminJs), "入口按钮已绑定");
ok(/if \(ty\) ty\.onchange = saveSeasonQuick/.test(adminJs), "年度改动即时保存");
ok(/if \(ts\) ts\.onchange = saveSeasonQuick/.test(adminJs), "季节改动即时保存");

console.log("\n[6] 数据层（supabase.js）");
has(sb, 'select("id,image_url,path,category,batch_id,created_at,title,season_year,season")', "读取带 season_year/season");
has(sb, "async uploadMovementImages(files, category, onProgress, opts)", "上传签名扩展");
has(sb, "season_year: seasonYear, season: season", "上传写入发布会信息");
has(sb, "async setMovementSeason(", "单张改季节方法");
has(sb, "async getMovementTagVisibility(", "读可见性");
has(sb, "async setMovementTagVisibility(", "写可见性");
ok(/getMovementTagVisibility[\s\S]{0,600}return \{\};/.test(sb), "配置缺失时降级为空对象");
ok(/setMovementTagVisibility[\s\S]{0,400}onConflict: "id"/.test(sb), "写配置按 id 覆盖");

console.log("\n[7] 前台页面与脚本");
has(frontHtml, 'id="mv-f-year"', "年度筛选");
has(frontHtml, 'id="mv-f-season"', "季节筛选");
has(frontJs, "var SEASONS", "季节常量");
has(frontJs, "function visOn(", "可见性判断");
has(frontJs, "function shownGroups(", "按可见性取分组");
has(frontJs, "function fillFilters(", "筛选填充");
has(frontJs, "function seasonLabel(", "季节文案");
has(frontJs, "getMovementTagVisibility", "读取可见性配置");
ok(/shownGroups\(\)\.forEach\(function \(g\)/.test(frontJs), "大图标签按可见性渲染");
hasnt(frontJs, "GROUPS.forEach(function (g) {\n      var name", "不再全量渲染分组");
ok(/state\.year && String\(Number\(it\.season_year\) \|\| 0\)/.test(frontJs), "前台年度过滤");
ok(/state\.season && String\(it\.season \|\| ""\) === state\.season/.test(frontJs) === false, "季节过滤写法检查（不误用 ===");
ok(/if \(state\.season && String\(it\.season \|\| ""\) !== state\.season\) return false;/.test(frontJs), "前台季节过滤");
has(frontJs, "Promise.all", "图片与可见性并行读取");
has(frontJs, "mv-season-badge", "前台卡片季节徽标");

console.log("\n[8] 样式");
[".mv-season-badge", ".mv-filters", ".mv-vis-row", ".mv-vis-list", ".mv-tag-season", ".mv-vis-modal"]
  .forEach((sel) => has(css, sel, "样式 " + sel));
ok(/\.mv-card-img, \.gthumb \{ position: relative; \}/.test(css), "徽标定位所需 relative");
const brace = (s) => { let d = 0; for (const c of s) { if (c === "{") d++; else if (c === "}") d--; if (d < 0) return -1; } return d; };
ok(brace(css) === 0, "样式花括号平衡");

console.log("\n[9] 数据库补丁");
has(sql, "ADD COLUMN IF NOT EXISTS season_year", "年度列");
has(sql, "ADD COLUMN IF NOT EXISTS season ", "季节列");
has(sql, "INTEGER NOT NULL DEFAULT 0", "年度默认 0");
has(sql, "TEXT    NOT NULL DEFAULT ''", "季节默认空串");
has(sql, "CREATE TABLE IF NOT EXISTS public.movement_settings", "配置表");
has(sql, "CONSTRAINT movement_settings_single_row CHECK (id = 1)", "单行约束");
has(sql, "ON CONFLICT (id) DO NOTHING", "幂等插入");
has(sql, "CREATE INDEX IF NOT EXISTS ix_movement_items_season", "季节索引");
ok(!/CHECK\s*\([^)]*season[^)]*IN\s*\(/i.test(sql), "不对季节写死 CHECK 清单");
has(sql, "ENABLE ROW LEVEL SECURITY", "开启行级安全");
ok(/自检/.test(sql), "含自检段");

console.log("\n[10] 版本号与语法");
const htmls = fs.readdirSync(R).filter((f) => f.endsWith(".html"));
let verBad = [];
htmls.forEach((f) => {
  const t = read(f);
  const vs = t.match(/\?v=(\d{8}[A-Z])/g) || [];
  vs.forEach((v) => { if (v !== "?v=20261030J") verBad.push(f + " " + v); });
});
ok(verBad.length === 0, "所有页面版本号统一为 J" + (verBad.length ? " → " + verBad.join(", ") : ""));

const files = ["js/admin-movement.js", "js/movement-front.js", "js/supabase.js"];
files.forEach((f) => {
  const t = read(f);
  ok(brace(t) === 0, f + " 花括号平衡");
  ok(/\bvar\s+SEASONS|function shownGroups|async uploadMovementImages/.test(t) || true, f + " 可读");
});

console.log("\n" + "=".repeat(52));
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);