/* 20261112B · 大码专区（前台 + 后台）已下线
 *
 * 要求：把「大码专区」从前台和后台都去掉。
 * 下线口径与之前「用户动向」一致：入口、页面、面板、脚本、权限勾选一并移除，**历史数据保留不动**。
 *
 * 本测试防止"只删了一部分"：
 *   - 前台不能再有任何指向 plus.html 的链接，页面文件本身也不应存在
 *   - 后台不能再有侧栏菜单、面板容器、脚本引用
 *   - 专区定义 / 权限勾选 / 懒加载映射里不能再有 plus
 *   - 剩下的页面引用脚本都要真实存在（删文件很容易漏掉引用）
 */
import fs from "fs";
import path from "path";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };
const read = (f) => fs.readFileSync(f, "utf8");

const PAGES = ["index.html", "rank.html", "rhythm.html", "trends.html", "marketing.html",
  "fav.html", "movement.html", "pinterest.html", "shein.html", "compare.html", "admin.html"];

console.log("一、前台入口与页面文件");
ok(!fs.existsSync("plus.html"), "大码专区前台页面文件应已删除");
PAGES.forEach((p) => {
  ok(read(p).indexOf("plus.html") < 0, p + " 仍有指向大码专区的链接");
});

console.log("二、后台菜单 / 面板 / 脚本");
const ADM = read("admin.html");
ok(ADM.indexOf("plus-card") < 0, "后台仍有大码专区面板容器或菜单项");
ok(!/admin-plus\.js/.test(ADM), "后台仍引用大码专区脚本");
ok(!/plus-sb\.js|plus-match\.js/.test(ADM), "后台仍引用大码专区数据层 / 匹配脚本");

["js/plus.js", "js/plus-sb.js", "js/plus-match.js", "js/admin-plus.js"].forEach((f) => {
  ok(!fs.existsSync(f), f + " 应已删除");
});

console.log("三、专区定义与权限勾选");
const CFG = read("js/config.js");
ok(CFG.indexOf('key: "plus"') < 0, "config.js 的专区定义里仍有大码专区");
ok(CFG.indexOf("大码专区") < 0, "config.js 仍出现「大码专区」字样");

const ADMJS = read("js/admin.js");
ok(ADMJS.indexOf('{ key: "plus"') < 0, "admin.js 的专区清单里仍有大码专区");
ok(ADMJS.indexOf('"plus-card"') < 0, "admin.js 的懒加载/守卫映射里仍有大码专区面板");

const PERM = read("js/admin-perm.js");
ok(PERM.indexOf('{ key: "plus"') < 0, "权限管理的专区列表里仍有大码专区");

const COMMON = read("js/common.js");
ok(COMMON.indexOf("plus.html") < 0, "页面回跳白名单里仍有大码专区");

console.log("四、库里历史配置不得复活该专区");
const SBJS = read("js/supabase.js");
ok(/const GONE = \{[^}]*plus: 1[^}]*\}/.test(SBJS), "专区定义读取时未过滤 plus（历史配置会复活一个打不开的入口）");

console.log("五、其它页面不得残留引用");
["js/supabase.js", "js/find-similar.js"].forEach((f) => {
  const s = read(f);
  ok(!/PLUSADMIN|plus-sb\.js|plus-match\.js/.test(s), f + " 仍引用大码专区脚本");
});

console.log("六、剩下的脚本引用都要真实存在");
let missing = [];
PAGES.forEach((p) => {
  const s = read(p);
  const re = /<script[^>]+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(s))) {
    const src = m[1].split("?")[0];
    if (/^https?:|^\/\//.test(src)) continue;
    if (!fs.existsSync(path.normalize(src))) missing.push(p + " → " + src);
  }
});
ok(missing.length === 0, "以下脚本引用指向不存在的文件：" + missing.join("；"));

console.log("七、其它专区不受影响");
["pinterest.html", "shein.html", "compare.html", "rank.html", "rhythm.html", "trends.html"].forEach((p) => {
  ok(fs.existsSync(p), p + " 不应被误删");
});
ok(fs.existsSync("js/admin-channelzone.js"), "渠道专区脚本不应被误删");
ok(fs.existsSync("js/compare-front.js"), "渠道对比脚本不应被误删");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
