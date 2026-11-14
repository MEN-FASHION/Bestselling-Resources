/* 期次名归一：W45 / 45周 / 第45周 / 2026-W45 必须视为同一期
   起因：后台选了期次，前台却冒出「第45周」和「W45」两个按钮，选其中一个查不到另一批图。
   这里真跑归一函数，并断言导入、查询、前台三处口径一致。 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { normPeriodLabel, normPeriodList } = require(path.join(ROOT, "js/rank-period-norm.js"));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("FAIL: " + msg); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ---------- 一、归一函数 ---------- */
const cases = [
  ["W45", "第45周"], ["w45", "第45周"], ["W 45", "第45周"], ["W05", "第5周"],
  ["第45周", "第45周"], ["第 45 周", "第45周"], ["第05周", "第5周"],
  ["45周", "第45周"], ["45", "第45周"], ["41", "第41周"],
  ["2026-W45", "第45周"], ["2026W45", "第45周"], ["2026-w05", "第5周"],
  ["2026年10月", "2026年10月"], ["2026-10", "2026-10"], ["国庆档", "国庆档"], ["", ""],
  ["0周", "0周"], ["54周", "54周"], ["第99周", "第99周"],
];
for (const [input, want] of cases) {
  ok(normPeriodLabel(input) === want, "归一「" + input + "」应为「" + want + "」，实际「" + normPeriodLabel(input) + "」");
}
ok(normPeriodLabel(null) === "" && normPeriodLabel(undefined) === "", "空值返回空串");
ok(normPeriodLabel(41) === "第41周", "数字 41 归一为第41周");

/* 同一周的四种写法归一后必须相等 —— 这是前台不再出现两个按钮的前提 */
const same = ["W45", "45周", "第45周", "2026-W45"].map(normPeriodLabel);
ok(new Set(same).size === 1, "同一周四种写法归一后必须完全相同");

/* 列表归一 + 去重 + 保序 */
const list = normPeriodList(["W44", "第44周", "W45", "第43周", "", null, "2026-W45"]);
ok(JSON.stringify(list) === JSON.stringify(["第44周", "第45周", "第43周"]), "列表归一去重保序，实际 " + JSON.stringify(list));

/* ---------- 二、导入侧：期次只认后台所选 ---------- */
const admin = read("js/admin-rank.js");
const gp = admin.slice(admin.indexOf("function groupRankRows"), admin.indexOf("async function doRankImport"));
ok(/_np\(defPeriod\) \|\| _np\(r\.period\)/.test(gp), "导入期次必须「界面优先、表格兜底」");
ok(gp.indexOf("_np(defPeriod)") < gp.indexOf("_np(r.period)"), "界面所选必须排在表格之前（顺序反了就等于没选）");
ok(/normPeriodLabel/.test(gp), "导入时要用归一函数");
ok(!/String\(r\.period \|\| ""\)\.trim\(\) \|\| defPeriod/.test(admin), "旧的「表格优先」写法必须已删除");

/* ---------- 三、查询侧：各种写法一起匹配 ---------- */
const sb = read("js/supabase.js");
const ep = sb.slice(sb.indexOf("function expandPeriods"), sb.indexOf("function expandPeriods") + 1800);
ok(/W\s*0\*\(\\d\{1,2\}\)/.test(ep) || /\[Ww\]/.test(ep), "expandPeriods 必须识别 W45 这类写法");
ok(/"第" \+ wn \+ "周"/.test(ep), "expandPeriods 必须把写法展开成「第N周」");
ok(/"W" \+ wn/.test(ep) && /wy \+ "-W" \+ wn/.test(ep), "expandPeriods 必须展开 Wn 与 年份-Wn");
ok(!/if \(\/W\\s\*\\d\/i\.test\(s0\)\) return;/.test(ep), "旧的「遇到 W45 直接返回」必须已删除（否则永远查不到另一批）");
ok(/expandPeriods\(f\.periods\)/.test(sb), "查询期次时必须走 expandPeriods");

/* ---------- 四、前台：只显示一个按钮 ---------- */
const rank = read("js/rank.js");
ok(/normPeriodList\(FACETS\.periods \|\| \[\]\)/.test(rank), "前台期次列表必须归一后再展示");
ok(/function periodVisible[\s\S]{0,400}normPeriodLabel/.test(rank), "后台隐藏列表比较时也要归一（否则隐藏 W45 管不到 第45周）");
const titlelab = read("js/titlelab.js");
ok(/normPeriodList\(\(f && f\.periods\) \|\| \[\]\)/.test(titlelab), "标题组词台的期次列表同样要归一");

/* ---------- 五、预览把规则写在脸上 ---------- */
ok(/期次统一成「第N周」/.test(admin), "预览要说明期次会统一成第N周");
ok(/以所选为准/.test(admin), "预览要说明以界面所选为准");
ok(/不会覆盖上方所选/.test(admin), "预览要说明表格期次不覆盖所选");
ok(!/会变成两个不同期次/.test(admin), "旧的「会变成两个期次」提示应已改掉");

/* ---------- 六、存量洗库：期次归并工具 ---------- */
ok(/期次归并…/.test(admin), "工具条要有「期次归并…」入口");
ok(/function openRankPeriodTools/.test(admin), "期次归并面板必须实现");
const pt = admin.slice(admin.indexOf("async function openRankPeriodTools"), admin.indexOf("/* 类目清理"));
ok(/updateRankPeriodData/.test(pt), "合并必须走改名迁移接口（先复制后删）");
ok(/合并为「/.test(pt), "面板要给出合并按钮");
ok(/共 ' \+ total \+ ' 条/.test(pt), "面板要显示合并后的条数，便于核对");
ok(/图片标签按图片地址关联/.test(pt), "确认框要说明标签不受影响");

/* ---------- 七、脚本引入与版本戳 ---------- */
for (const f of ["admin.html", "rank.html", "rhythm.html"]) {
  const html = read(f);
  /* 只验「有没有引入」，不锁死版本号 —— 锁死版本号会在每次发版后白白变红 */
  ok(/js\/rank-period-norm\.js\?v=\d{8}[A-Z]+/.test(html), f + " 必须引入期次归一脚本");
  ok(html.indexOf("rank-cat-norm.js") < html.indexOf("rank-period-norm.js"), f + " 归一脚本要在类目归一之后加载");
}

console.log("\n" + "=".repeat(50));
console.log(fail === 0 ? "PASS" : "FAIL");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail === 0 ? 0 : 1);
