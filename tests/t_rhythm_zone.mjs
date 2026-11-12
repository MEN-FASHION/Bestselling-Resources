/* 上新节奏（月度趋势榜）结构校验 —— 20261104H
   目的：月度专区是「趋势上升榜」的复制件，两套必须互不串台。
   这里锁住：月度页只读月度数据、周度页不受影响、后台两个面板 id 不冲突、报告口径跟着改。 */
import fs from "fs";
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };
const R = fs.readFileSync("js/rank.js", "utf8");
const Y = fs.readFileSync("js/rhythm.js", "utf8");
const S = fs.readFileSync("js/supabase.js", "utf8");
const H = fs.readFileSync("rhythm.html", "utf8");
const RH = fs.readFileSync("rank.html", "utf8");
const A = fs.readFileSync("admin.html", "utf8");
const AJ = fs.readFileSync("js/admin.js", "utf8");
const AR = fs.readFileSync("js/admin-rhythm.js", "utf8");
const CFG = fs.readFileSync("js/config.js", "utf8");
const CMN = fs.readFileSync("js/common.js", "utf8");
const WK = fs.readFileSync("js/weekreport.js", "utf8");

console.log("一、前台页面");
ok("rhythm.html 存在且加载月度脚本", /js\/rhythm\.js\?v=/.test(H));
ok("页面标题为「上新节奏」", /<title>上新节奏/.test(H) && /id="rk-title">上新节奏</.test(H));
ok("顶部菜单里有本站自己的入口", /href="rhythm\.html" class="tab-link active">上新节奏/.test(H));
ok("同时能一键回周度榜", /href="rank\.html" class="tab-link">趋势上升榜/.test(H));
ok("月度页不加载周度脚本", !/js\/rank\.js/.test(H));
ok("月度页带齐打标枚举（否则标签文案与打标维度全空）", /js\/rank-enums\.js\?v=/.test(H));
const dep = (h) => [...h.matchAll(/src="(js\/[^"?]+)/g)].map(m => m[1]).sort().join(",");
ok("月度页依赖脚本与周度页一致（只差主脚本）",
  dep(H).replace("js/rhythm.js", "js/rank.js").split(",").sort().join(",") === dep(RH));
ok("报告模块按「月」出稿", /window\.RK_PERIOD_NOUN = "月"/.test(H));
ok("周期口径声明在报告模块之前（否则仍按周出稿）", H.indexOf('window.RK_PERIOD_NOUN = "月"') < H.indexOf('js/weekreport.js'));
ok("周度页没被改动成月度", /js\/rank\.js\?v=/.test(RH) && !/RK_PERIOD_NOUN = "月"/.test(RH));

console.log("二、期次类型隔离");
ok("月度页声明 PTYPE=month", /var PTYPE = "month"/.test(Y));
ok("筛选项按月度取", /rankFacetsByType\(PTYPE\)/.test(Y));
ok("前台取数带 periodType", (Y.match(/periodType: PTYPE/g) || []).length >= 3);
ok("周度页取数仍不带 periodType（走默认 week）", !/periodType: PTYPE/.test(R) && !/periodType: "month"/.test(R));
ok("周度页期次也按周度筛（不会冒出月份）", /rankFacetsByType\("week"\)/.test(R));
ok("后端按类型切分筛选项", /async rankFacetsByType\(periodType\)/.test(S));
ok("期次→类型以批次表为准", /from\("rank_batches"\)[\s\S]{0,200}period_type/.test(S));
ok("名称兜底能认出月份", /\\d\{1,2\}\\s\*月/.test(S));
ok("月度页类目以自己数据为准", /if \(periodType === "month"\)/.test(S));

console.log("三、月度期次排序");
ok("月份先判（不会被「几月」规则吃掉年份）", /月度期次：2026年10月 \/ 2026-10/.test(Y));
ok("月度页无周次解析残留", !/\[Ww\]\\s\*\(\\d\{1,2\}\)/.test(Y));
const pk = Y.slice(Y.indexOf("function periodKey(p) {"), Y.indexOf("function sortPeriods(arr)"));
const fn = new Function(pk + "return periodKey;")( );
ok("2026年10月 排在 2026年9月 之后", fn("2026年10月") > fn("2026年9月"));
ok("2026-10 与 2026年10月 同序", fn("2026-10") === fn("2026年10月"));
ok("跨年正确：2027年1月 > 2026年12月", fn("2027年1月") > fn("2026年12月"));
ok("2026-10 归入月度桶（不是周次桶）", fn("2026-10") === 2026 * 10000 + 200 + 10);

console.log("四、专区注册");
ok("默认专区表里有 rhythm", /\{ key: "rhythm",\s+label: "上新节奏",\s+href: "rhythm\.html" \}/.test(CFG));
ok("刷新归位允许月度页", /"rhythm\.html"/.test(CMN));
ok("后台专区链接预设里有月度页", /上新节奏 · 月度趋势 \(rhythm\.html\)/.test(fs.readFileSync("js/admin-perm.js", "utf8")));
ok("前台页面名与权限键一致", /Common\.visit\.track\("rhythm"\)/.test(Y) && /vis\.rhythm === false/.test(Y));

console.log("五、后台面板");
ok("后台有「上新节奏」菜单", /data-target="rhythm-card">上新节奏</.test(A));
ok("后台有月度面板", /id="rhythm-card"/.test(A));
ok("面板内 id 一律 rm- / rmadm- 前缀", /id="rm-site-list"/.test(A) && /id="rmadm-pv-frame"/.test(A));
const seg = A.slice(A.indexOf('id="rhythm-card"'), A.indexOf("<!-- ================= 大码专区"));
ok("月度面板不残留周度 id（否则两面板互相覆盖）", !/id="(rank|rkadm)-/.test(seg));
ok("月度面板不重复「打标表导出/回填」小节（周期无关，留在周度面板）", !/<h4>① 导出打标表/.test(seg) && !/<h4>② 打标结果回填/.test(seg));
ok("月度面板预览指向月度前台", /src="rhythm\.html"/.test(seg));
ok("后台加载月度脚本", /js\/admin-rhythm\.js\?v=/.test(A));
ok("面板权限：任一管理员可进", /"rhythm-card": ""/.test(AJ) && /target === "rhythm-card"/.test(AJ));
ok("切面板时才拉数据", /window\.RhythmAdmin\.enter/.test(AJ));
ok("后台脚本守卫用的是真面板 id（写错则整块不绑定事件）", /\$\("#rhythm-card"\)/.test(AR));
const ajIds = [...A.matchAll(/id="(rm[a-z]*-[a-z0-9-]+)"/g)].map(m => m[1]);
const used = [...AR.matchAll(/\$\("#(rm[a-z]*-[a-z0-9-]+)"\)/g)].map(m => m[1]);
const missing = [...new Set(used)].filter(id => ajIds.indexOf(id) < 0);
ok("脚本选到的每个 rm- 元素在 HTML 里都存在（错一个该功能就静默失效）", missing.length === 0);
if (missing.length) console.log("     缺失:", missing.join(", "));

console.log("六、后台导入只写月度");
ok("导入期次类型锁死 month", /const periodType = "month";/.test(AR));
ok("没读取周度/月度单选框", !/input\[name="rm-period"\]:checked/.test(AR));
ok("上传记录只显示月度批次", /filter\(\(b\) => \(\(b && b\.period_type\) \|\| "week"\) === "month"\)/.test(AR));
ok("预览地址指向月度前台", /return "rhythm\.html\?"/.test(AR));
ok("标签口径与周度一致（潜力机会/趋势爆款/月度激增）", /月度激增/.test(AR) && /flag_opportunity/.test(AR) && /flag_hot/.test(AR));
ok("站点/地区分组与周度共用", /SB\.getRankGroups/.test(AR) && /SB\.addRankSite/.test(AR));

console.log("七、报告口径");
ok("报告周期词可切换", /window\.RK_PERIOD_NOUN/.test(WK) && /var NOUN =/.test(WK));
ok("标题跟着周期词走", /s\.addText\(NOUN \+ "对比分析报告"/.test(WK));
ok("文件名跟着周期词走", /NOUN \+ "对比分析_"/.test(WK));
ok("默认仍是「周」（周度页不受影响）", /\? String\(window\.RK_PERIOD_NOUN\) : "周"/.test(WK));

console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
