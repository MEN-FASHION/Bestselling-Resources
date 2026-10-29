/* 趋势动向图片尺寸回归：卡片必须落在网格内、图片随列宽缩放 */
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name); }
}
function group(n) { console.log("\n【" + n + "】"); }

const css = read("css/style.css");
const frontJs = read("js/movement-front.js");
const adminJs = read("js/admin-movement.js");
const adminHtml = read("admin.html");
const mvHtml = read("movement.html");

function rule(sel) {
  const i = css.indexOf(sel + " {");
  if (i < 0) return "";
  const j = css.indexOf("}", i);
  return css.slice(i, j + 1);
}

group("前台图墙");
ok("#mv-body 已定义网格容错", /#mv-body \{[^}]*display:\s*grid/.test(css));
ok("#mv-body 列宽为 150px 起（与视觉专区同密度）", /#mv-body \{[^}]*minmax\(150px/.test(css));
ok("#mv-body 有窄屏回落", /@media \(max-width: 680px\) \{\s*#mv-body \{/.test(css));
ok("#mv-body 空态跨整行", /#mv-body > \.rk-empty \{[^}]*grid-column:\s*1 \/ -1/.test(css));
ok("卡片图片按列宽铺满", /\.mv-card-img img \{[^}]*width:\s*100%/.test(css));
ok("卡片保持 3/4 画幅", /\.mv-card-img \{[^}]*aspect-ratio:\s*3 \/ 4/.test(css));
ok("卡片溢出被裁切", /\.mv-card \{[^}]*overflow:\s*hidden/.test(css));
ok("前台卡片容器就用 mv-body", /id="mv-body"/.test(mvHtml));
ok("前台生成的卡片带 mv-card 类", /mv-card/.test(frontJs));

group("后台图墙");
ok("后台容器为 #mv-grid", /id="mv-grid"/.test(adminHtml));
ok("后台容器带 .grid 网格类", /id="mv-grid" class="grid"/.test(adminHtml));
ok(".grid 列为 150px 起", /\.grid \{[^}]*minmax\(150px/.test(css));
ok(".gcard 样式已补齐", /\.gcard \{[^}]*border-radius/.test(css));
ok(".gthumb 限制 3/4 画幅", /\.gthumb \{[^}]*aspect-ratio:\s*3 \/ 4/.test(css));
ok(".gthumb img 强制随列宽缩放", /\.gthumb img \{[^}]*width:\s*100%[^}]*height:\s*100%/.test(css));
ok(".gthumb img 用 cover 不拉伸", /\.gthumb img \{[^}]*object-fit:\s*cover/.test(css));
ok(".gcard 溢出裁切", /\.gcard \{[^}]*overflow:\s*hidden/.test(css));
ok(".gsub 内进度徽标不压缩", /\.gsub \.mv-prog \{[^}]*flex:\s*none/.test(css));
ok("后台卡片用 gcard 类", /card\.className = "gcard"/.test(adminJs));
ok("后台缩略图用 gthumb 类", /class="gthumb"/.test(adminJs));

group("弹窗大图（不该被这次改动影响）");
ok("打标弹窗大图有最大高度", /\.mv-tag-img img \{[^}]*max-height/.test(css));
ok("打标弹窗大图用 contain", /\.mv-tag-img img \{[^}]*object-fit:\s*contain/.test(css));
ok("打标弹窗左栏宽度有上限", /\.mv-tag-body \{[^}]*minmax\(280px, 420px\)/.test(css));
ok("弹窗左栏窄屏改单列", /@media[^{]*\{[^}]*\.mv-tag-body \{ grid-template-columns: 1fr/.test(css.replace(/\n/g, " ")));

group("样式完整性");
ok("CSS 花括号平衡", css.split("{").length === css.split("}").length);
ok("未引入 !important 补丁式写法", !/\.g(card|thumb|meta)[^{]*\{[^}]*!important/.test(css));
ok("版本号已统一", (() => {
  const v = new Set();
  (adminHtml + mvHtml).replace(/\?v=([0-9A-Za-z]+)/g, (m, x) => { v.add(x); return m; });
  return v.size === 1;
})());

console.log("\n" + (fail === 0 ? "全部通过：" : "存在失败：") + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
