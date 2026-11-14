/* 20261114B · 「全站图片展示比例统一」自检
 *
 * 目标：让每个专区显示的图片宽高比，与【趋势上升榜】的卡片完全一致，
 * 而且只有一个来源 —— 改一行变量，所有专区一起变。
 */
import fs from "fs";
import path from "path";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const ROOT = process.cwd();
const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");

/* ---------- 1 变量本身 ---------- */
const r0 = css.indexOf(":root");
const rootBlock = css.slice(r0, css.indexOf("}", r0));
const m = rootBlock.match(/--img-ratio:\s*([^;]+);/);
ok(!!m, ":root 里定义了 --img-ratio");
const val = m ? m[1].replace(/\s+/g, " ").trim() : "";
ok(val === "3 / 4", "--img-ratio 取值是 3 / 4（与趋势上升榜一致），实际：" + val);

/* ---------- 2 没有第二个硬编码比例 ---------- */
const hard = [];
css.split("\n").forEach((line, i) => {
  const mm = line.match(/aspect-ratio:\s*([^;}\n]+)/g);
  if (!mm) return;
  mm.forEach(x => {
    const v = x.replace(/aspect-ratio:\s*/, "").trim();
    if (v.indexOf("var(--img-ratio)") !== 0) hard.push("L" + (i + 1) + " " + v);
  });
});
ok(hard.length === 0, "style.css 里没有硬编码图片比例（发现：" + hard.join(" | ") + "）");

/* ---------- 3 各专区的图片格都读变量 ---------- */
const TILES = [
  [".rk-card img", "趋势上升榜（基准）"],
  [".cmp-card img", "渠道对比"],
  [".mv-card-img", "SHEIN / Pinterest / 品牌动向"],
  [".trend-card-cover", "趋势专区"],
  ["#grid .holder", "视觉专区"],
  [".fv-card img", "我的收藏"],
  [".mk-card-img", "营销日历"],
  [".imgpool-thumb", "后台图片池"],
  [".bestseller-img", "后台榜单图墙"],
  [".rm-ch-card img", "上新节奏"],
  [".gthumb", "后台图墙"],
  [".plz-img", "专区上传区"],
];
TILES.forEach(([sel, name]) => {
  const i = css.indexOf(sel);
  ok(i >= 0, "找到选择器 " + sel + "（" + name + "）");
  if (i < 0) return;
  const seg = css.slice(i, css.indexOf("}", i));
  ok(seg.indexOf("aspect-ratio: var(--img-ratio)") >= 0,
    sel + " 的宽高比读统一变量（" + name + "）");
});

const useCount = (css.match(/aspect-ratio:\s*var\(--img-ratio\)/g) || []).length;
ok(useCount >= 25, "统一变量被至少 25 处图片格引用，实际 " + useCount + " 处");

/* ---------- 4 曾经不一致的几处已经收口 ---------- */
ok(!/\.trend-card-cover[^}]*aspect-ratio:\s*4\s*\/\s*3/.test(css),
  "趋势专区封面不再是 4:3（原来与榜单不一致）");
ok(!/\.bestseller-img[^}]*aspect-ratio:\s*1\s*\/\s*1/.test(css),
  "后台榜单图墙不再是 1:1（原来与榜单不一致）");
ok(!/\.mk-tag-img[^}]*aspect-ratio:\s*4\s*\/\s*3/.test(css),
  "营销日历标签图不再是 4:3");

const admin = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
ok(admin.indexOf("aspect-ratio:var(--img-ratio)") >= 0, "admin.html 内联样式也读统一变量");
ok(!/aspect-ratio:\s*[0-9]/.test(admin), "admin.html 没有残留的硬编码比例");

/* ---------- 5 页面都真的引了这份样式 ---------- */
const PAGES = ["index.html", "rank.html", "rhythm.html", "compare.html", "pinterest.html",
  "shein.html", "trends.html", "fav.html", "movement.html", "marketing.html", "admin.html"];
PAGES.forEach(p => {
  const f = path.join(ROOT, p);
  ok(fs.existsSync(f), "页面存在：" + p);
  if (!fs.existsSync(f)) return;
  const s = fs.readFileSync(f, "utf8");
  ok(/css\/style\.css\?v=/.test(s), p + " 引用了统一样式（带版本号，能强刷到新比例）");
});

/* ---------- 6 导出模板不至于「页面 3:4、导出另一种」 ---------- */
["js/view-export.js", "js/favexport.js"].forEach(f => {
  const s = fs.readFileSync(path.join(ROOT, f), "utf8");
  const ratios = (s.match(/aspect-ratio:\s*([0-9]+\s*\/\s*[0-9]+)/g) || [])
    .map(x => x.replace(/aspect-ratio:\s*/, "").replace(/\s+/g, ""));
  ok(ratios.length > 0, f + " 里的图片框有明确比例");
  ok(ratios.every(r => r === "3/4"), f + " 导出图片框比例与统一变量一致（3:4），实际：" + ratios.join(","));
});

/* ---------- 7 版本戳 ---------- */
ok(css.indexOf("20261114B") >= 0, "样式里带本次版本戳 20261114B");
const ps = fs.readFileSync(path.join(ROOT, "js/page-shot.js"), "utf8");
ok(ps.indexOf("20261114B") >= 0, "导出高清图脚本已升到 20261114B");

console.log("\n比例统一自检：" + pass + " 通过，" + fail + " 失败");
if (fail) process.exit(1);
