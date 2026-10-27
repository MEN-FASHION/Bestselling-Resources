/* verify_fav_ui.js —— 收藏抽屉这一版视觉/交互的静态校验（20261023E）
 * 只查"必须成立的结构与规则"，不查像素。用法：node tools/verify_fav_ui.js [项目根目录]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = process.argv[2] || path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const inc = (s, keys) => keys.every((k) => s.indexOf(k) >= 0);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  →  " + extra : "")); }
};

const DRAWER = read("js/favdrawer.js");
const RANK = read("js/rank.js");
const CSS = read("css/style.css");
const FAV_JS = read("js/fav.js");
const HTML = read("rank.html");

console.log("\n=== 收藏抽屉 + 拖动分类竖排清单：右侧浮层 + macOS 质感 ===\n");

/* ① 拖放面板：20261023H 起改成"竖排一列贴右侧"（横向扇形已被否掉） */
ok("js/favfan.js 仍在（改为竖排清单）", fs.existsSync(path.join(ROOT, "js/favfan.js")));
ok("rank.html 引入 favfan.js", /favfan\.js\?v=/.test(HTML));
ok("rank.js 拖动时调用 FavFan.show（带上起点，用来自动选边）", /FavFan\.show\(e\)/.test(RANK));
ok("CSS 有竖排清单的行样式", /\.fv-dock-row\{/.test(CSS));
ok("竖排清单贴在右侧（position:fixed + right）", /\.fv-dock\{[\s\S]*?position:\s*fixed[\s\S]*?right:\s*\d+px/.test(CSS));
ok("竖排清单是纵向一列（flex-direction: column）", /\.fv-dock-list\{[\s\S]*?flex-direction:\s*column/.test(CSS));
ok("旧的横向扇形样式已清干净", !/\.fv-fan-cell|\.fv-fan-deck/.test(CSS));
ok("拖动时不再自动把抽屉滑出（扇形接管拖放）", !/FavDrawer\.openForDrop\(\)/.test(RANK));
ok("仍然提示「可以拖进收藏」", /可以拖进收藏/.test(read("js/favfan.js")));
ok("抽屉的落点清理仍保留（两条路径都收得干净）", /endDropMode/.test(RANK));

/* ② 抽屉仍是"浮层"，不推挤对比池 */
/* 同名规则有多处：旧稿、本次重做、以及移动端覆盖。
   取"带 position: fixed 且带宽度变量"的那一条——那是桌面端实际生效的主规则。 */
const drawerHits = (CSS.match(/\.fv-drawer\s*\{[\s\S]*?\}/g) || [])
  .filter(function (h) { return /position:\s*fixed/.test(h) && /--fv-w/.test(h); });
const drawerSeg = drawerHits[drawerHits.length - 1] || "";
ok("抽屉是 position: fixed（浮层，零占位）", /position:\s*fixed/.test(drawerSeg), drawerSeg.slice(0, 60));
ok("抽屉不覆盖整屏（右侧留出对比池可视区）",
  /width:\s*var\(--fv-w\)/.test(drawerSeg) && !/left:\s*0/.test(drawerSeg.split("transform")[0]));
ok("抽屉不使用遮罩层（不挡对比池的点击）",
  !/\.fv-drawer-mask|\.fv-mask|\.fv-overlay/.test(CSS) && !/createElement\(["']div["']\)[\s\S]{0,80}mask/i.test(DRAWER));

/* ③ macOS 质感的四件套：毛玻璃 / 圆角 / 分层阴影 / 长缓动 */
ok("抽屉用了背景毛玻璃（backdrop-filter blur+saturate）",
  /backdrop-filter:\s*blur\(\d+px\)\s*saturate/.test(drawerSeg));
ok("抽屉是圆角浮起面板（border-radius 18–24px）",
  /border-radius:\s*(1[89]|2[0-4])px/.test(drawerSeg));
ok("阴影是分层的（远 + 近 + 内高光至少三层）",
  (drawerSeg.match(/rgba?\(/g) || []).length >= 3);
ok("出入场用长缓动而不是 ease-in-out",
  /--fv-ease:\s*cubic-bezier/.test(CSS) && /transition:\s*transform \.5\d?s var\(--fv-ease\)/.test(CSS));
ok("滑出方向是从右侧屏外进入（translate3d 正向 X）",
  /translate3d\(calc\(100% \+ \d+px\)/.test(drawerSeg));

/* ④ 拖动态：分类变文件夹落点，且"全部"不是落点 */
ok("拖动态把分类条改成网格布局", /\.fv-drawer\.is-drop-ready \.fv-d-filter\{[\s\S]*?display:\s*grid/.test(CSS));
ok("拖动态分类是虚框文件夹样式", /\.fv-drawer\.is-drop-ready \.fv-d-chip\{[\s\S]*?border:\s*1px dashed/.test(CSS));
ok("拖动态隐藏「全部」（它不是归类目标）", /\.is-drop-ready \.fv-d-chip\[data-fv-f="all"\]\{[^}]*display:\s*none/.test(CSS));
ok("拖动态有提示条，且平时不占位", inc(DRAWER, ['id="fv-drop-hint"', "setDropHint(true)", "setDropHint(false)"]));
ok("拖动结束会清掉落点高亮", /endDropMode[\s\S]{0,200}is-drop-ready/.test(DRAWER));

/* ⑤ 头部：图标按钮 + 读屏文案 */
ok("头部三个按钮都是线性图标（inline SVG）", inc(DRAWER, ["SVG.bookmark", "SVG.grid", "SVG.close"]));
ok("头部按钮带 aria-label（读屏可用）", /aria-label="全屏"/.test(DRAWER) && /aria-label="平铺"/.test(DRAWER));
ok("图标按钮有独立类名，不与文字按钮共用（避免样式串）",
  /class="fv-d-ic"/.test(DRAWER) && !/class="fv-d-btn" id="fv-d-full"/.test(DRAWER));
ok("全屏时按钮换成「退出全屏」文案", /退出全屏/.test(DRAWER));

/* ⑥ 副标题：说清"现在看到的是什么范围" */
ok("副标题渲染张数 / 分类数 / 当前筛选", inc(DRAWER, ['$("#fv-d-sub")', "正在看「"]));

/* ⑦ 入场动效：只在打开那一刻播，筛选重绘不重播 */
ok("入场动画由 is-in 触发（不是每次渲染都播）", /\.fv-d-body\.is-in \.fv-d-cell\{[^}]*animation/.test(CSS));
ok("卡片错峰入场（用 --i 控制延迟）", /--i:\s*' \+ \(opts\.i \|\| 0\)/.test(DRAWER) && /animation-delay:\s*calc\(var\(--i/.test(CSS));
ok("animateIn 只在 open() 里调用", /function animateIn/.test(DRAWER) && (DRAWER.match(/animateIn\(\)/g) || []).length === 2);

/* ⑧ 尊重系统"减少动效" */
ok("prefers-reduced-motion 下关掉全部动效", /@media \(prefers-reduced-motion: reduce\)/.test(CSS));

/* ⑨ 全屏工作台：左栏分类在窄屏不挤占 */
ok("全屏铺满视口", /\.fv-drawer\.is-full\{[\s\S]*?width:\s*100vw/.test(CSS));
ok("分类靠左成一列方框（每行一个方框）", /\.fv-d-filter\s*\{[^}]*flex-direction:\s*column/.test(CSS)
  && /\.fv-d-filter \.fv-d-chip\s*\{[^}]*width:\s*100%/.test(CSS));

/* 6.x) 二分类：标签页形态 + 图片左侧竖排标签（20261027D） */
ok("二分类工具条改成标签页（选中项下面一条金线）", /\.fv-sub\.is-on::after\s*\{[\s\S]*?background:/.test(CSS));
ok("标签默认是平面的（无边框、透明底）", /\.fv-sub\s*\{[\s\S]*?border:\s*0[;\s]/.test(CSS) && /\.fv-sub\s*\{[\s\S]*?background:\s*transparent/.test(CSS));
ok("选中标签用金色文字而不是按钮底色", /\.fv-sub\.is-on\s*\{[\s\S]*?color:\s*#8b6b28/.test(CSS));
ok("张数做成小徽标（选中时反白）", /\.fv-sub i\s*\{[\s\S]*?border-radius:\s*10px/.test(CSS) && /\.fv-sub\.is-on i\s*\{[^}]*background:\s*#c8a45c/.test(CSS));
ok("图片左侧有竖排小标签（writing-mode: vertical-rl）", /\.fv-subtag\s*\{[\s\S]*?writing-mode:\s*vertical-rl/.test(CSS));
ok("小标签贴在图左边缘（left: 0）且不挡点击", /\.fv-subtag\s*\{[\s\S]*?left:\s*0/.test(CSS) && /\.fv-subtag\s*\{[\s\S]*?pointer-events:\s*none/.test(CSS));
ok("上装/下装两种标签配色可区分", /\.fv-subtag\.is-top\s*\{[\s\S]*?linear-gradient/.test(CSS) && /\.fv-subtag\.is-bottom\s*\{[\s\S]*?linear-gradient/.test(CSS));
ok("抽屉与收藏页的卡片都会挂这枚标签", /fv-subtag is-/.test(DRAWER) && /fv-subtag is-/.test(FAV_JS));
ok("未分的不挂标签（只有 top/bottom 才出）", /subOf\(it\) \? '<span class="fv-subtag/.test(DRAWER));

console.log("\n================ 汇总 ================");
console.log("PASS " + pass + " / FAIL " + fail);
if (fail) { console.log("失败项需要修掉再交付"); process.exit(1); }
