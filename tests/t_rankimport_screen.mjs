/* 榜单导入表被误传到「打标结果回填」时，必须当场说清「传错入口」，
   而不是显示「有效 0 张」就结束。
   另外「有效 0 张」本身也要给出原因（图片地址列是超链接 / 选错工作表）。 */
import fs from "fs";
import path from "path";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(path.join(root, "js/admin-rankimport.js"), "utf8");

console.log("一、识别榜单导入表并给出正确去处");
for (const h of ["期次", "周次", "周期", "货品名称", "商品名称", "环比比例", "环比绝对值", "销量站点", "叶子类目名称"]) {
  ok(src.includes('"' + h + '"'), "榜单表头特征含「" + h + "」");
}
ok(/looksLikeRank/.test(src), "存在榜单表识别分支");
ok(/请到页面最上方的「导入榜单」区域上传它/.test(src), "提示里直接指明正确入口");
ok(/「图片URL」\+ 打标维度列|「图片URL」/.test(src), "说明回填只认哪两类列");
ok(/setTip\(null, msg, false\)/.test(src) && /looksLikeRank\) \{[\s\S]{0,400}?return;/.test(src), "识别到传错表时立即返回，不再继续走回填流程");
ok(/looksLikeRank[\s\S]{0,300}?\$\("#rank-tag-import"\)\.disabled = true/.test(src), "传错表时导入按钮置灰，避免继续误操作");

console.log("二、「有效 0 张」必须给出原因");
ok(/res\.bad && res\.bad\.length/.test(src), "读取被跳过的行数");
ok(/行图片地址不合法被跳过/.test(src), "说明有多少行因地址不合法被跳过");
ok(/若该列是超链接，请导出时保留真实网址/.test(src), "指出超链接这一个最常见成因");
ok(/表里没有任何带图片地址的行，确认是否选错了工作表/.test(src), "无任何地址行时提示工作表可能选错");

console.log("三、没有破坏原有回填逻辑");
ok(/res\.rows\.length \+ " 张图 · 能对上榜单 " \+ hit\.length/.test(src), "原有「有效 N 张 / 对上 M 张」文案保留");
ok(/parseRows/.test(src) && /function parseBook/.test(src), "解析函数仍在");
ok(!/alert\(|confirm\(|prompt\(/.test(src), "没有原生弹窗残留");
ok(!/\bexec_sql\b|createClient\(|\bsupabase\.from\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "导入模块不直接写库（走上层传入的接口）");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
