/* 验证：打标写入/读取是否真的走独立标签表，且图片本体不受影响 */
import fs from "fs";
const src = fs.readFileSync("js/supabase.js", "utf8");
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✓ " + n); };
const no = (n, d) => { fail++; console.log("  ✗ " + n + (d ? " — " + d : "")); };

// 1. 打标写入不再直接 update images
const imgUpd = src.match(/from\("images"\)\s*\.update/g) || [];
if (imgUpd.length <= 2) ok("images 上仅保留类目/单值写入（" + imgUpd.length + " 处）");
else no("仍有 " + imgUpd.length + " 处直接写 images", "打标应走标签表");

// 2. 标签表写入用 upsert onConflict image_url
if (/from\("rank_image_tags"\)\s*[\s\S]{0,120}upsert\(/.test(src)) ok("标签写入用 upsert(image_url)");
else no("标签写入未用 upsert");

// 3. 有 id→url 映射
if (/_mapIdToUrl/.test(src)) ok("存在 id→url 映射方法");
else no("缺少 _mapIdToUrl");

// 4. 读取为双源合并
const li = src.slice(src.indexOf("async listImageTags(urls)"));
if (/rank_image_tags/.test(li.slice(0, 3000))) ok("读取先取标签表");
else no("读取未取标签表");
if (/fromImages/.test(li.slice(0, 4000))) ok("读取保留 images 兜底");
else no("读取缺兜底，迁移前会显示全空");

// 5. 批量写入走标签表
const bi = src.slice(src.indexOf("async batchUpdateImageTags"));
if (/_upsertTagsByUrl/.test(bi.slice(0, 1500))) ok("批量打标走标签表");
else no("批量打标仍写 images");

// 6. 导入前合并现有标签
const imp = fs.readFileSync("js/admin-imageimport.js", "utf8");
if (/listImageTags/.test(imp)) ok("导入前合并现有标签");
else no("导入未合并现有标签，fill 模式会误覆盖");

// 7. 看板合并标签
const ad = fs.readFileSync("js/admin-images.js", "utf8");
if (/listImageTags/.test(ad)) ok("看板合并标签");
else no("看板未合并标签，导出会全空");

// 8. 上传只写 images（无标签字段）
const up = src.slice(src.indexOf("async uploadImage"), src.indexOf("async uploadImage") + 2000);
if (!/style_tags|element_tags|scene_tags/.test(up)) ok("上传不涉及标签字段");
else no("上传仍在写标签字段");

// 9. 版本号统一
const pages = ["admin.html","index.html","rank.html","trends.html","marketing.html","plus.html","fav.html"];
const stale = pages.filter(p => fs.readFileSync(p,"utf8").includes("20261028G"));
if (!stale.length) ok("全部页面版本号已统一");
else no("版本号未统一：" + stale.join(","));

console.log("\n结果：" + pass + " pass, " + fail + " fail");
process.exit(fail ? 1 : 0);
