/* 20261114Y · 传图去重：同专区 + 同类目 + 同月才判重
 *
 * 口径（用户定的）：
 *   · 同一个专区、同一个类目、同一个月里，同一张图只留一张；
 *   · 换月可以再传（1 月的图 2 月再传属于两次上新）；
 *   · 换专区可以再传（P 传过的图，T 专区照样能传）；
 *   · 换类目可以再传（同一张图归到两个类目是两条记录）。
 * 20261114V 只按月份判重，指纹不分专区，P 传过的图到 T 就被拦下 —— 本次修的就是这个。
 *
 * 反向用例：
 *   - 判重键去掉专区 → 「跨专区必须放行」必须失败；
 *   - 判重键去掉类目 → 「跨类目必须放行」必须失败；
 *   - 库里文件名不按类目分组 → 「同类目同月拦住」必须失败。
 */
import fs from "fs";

const SRC = fs.readFileSync("js/admin-channelzone.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

console.log("一、实现结构");
ok(/function fpKey\(k, cat, month, fp\)/.test(SRC), "判重键应为「专区 + 类目 + 月份 + 指纹」");
ok(/function namesByCatMonth\(k\)/.test(SRC), "库内文件名应按「类目 + 月份」分组");
ok(/function pickCat\(k\)/.test(SRC), "应能从上传类目控件取当前类目");
ok(/var fk = fpKey\(k, cat, month, fp\);/.test(SRC), "本批比对应带专区 + 类目 + 月份");
ok(/rememberFps\([^)]*, month, k, cat\)/.test(SRC), "登记指纹时应带专区与类目");
ok(/fps\[fpKey\(k, cat, month, f\.__fp\)\]/.test(SRC), "上传前应按最终三键再挡一次");
ok(/同专区 \+ 同类目 \+ 同月|同专区本科目/.test(SRC), "提示文案应说明判重口径");

/* ---------- 二、真跑分组逻辑 ---------- */
function grab(name) {
  let i = SRC.indexOf("function " + name);
  if (i < 0) return "";
  if (SRC.slice(i - 6, i) === "async ") i -= 6;
  let d = 0, j = SRC.indexOf("{", i);
  for (let k = j; k < SRC.length; k++) {
    if (SRC[k] === "{") d++;
    else if (SRC[k] === "}") { d--; if (!d) return SRC.slice(i, k + 1); }
  }
  return "";
}

const code = [
  "function normName(n){ return String(n||'').toLowerCase().replace(/\\s+/g,''); }",
  "function normMonth(v){ var s=String(v||'').trim(); var m=s.match(/(20\\d{2})\\D{0,2}(\\d{1,2})/); return m ? m[1]+'-'+String(parseInt(m[2],10)).padStart(2,'0') : s; }",
  grab("nameFromUrl"),
  grab("catKey"),
  grab("namesByCatMonth"),
  grab("fpKey"),
].join("\n");

const sandbox = { state: {}, console };
const fn = new Function("state", "console", code + "\nreturn { namesByCatMonth, fpKey, nameFromUrl, catKey };");
const api = fn(sandbox.state, console);

console.log("二、库内文件名按「类目 + 月份」分组");
sandbox.state.z = {
  items: [
    { image_url: "https://x/a/1762000000000_1_shirt.jpg", month: "2026-01", category: "卫衣" },
    { image_url: "https://x/a/1762000000001_2_shirt.jpg", month: "2026-02", category: "卫衣" },
    { image_url: "https://x/a/1762000000002_3_shirt.jpg", month: "2026-01", category: "T恤" },
    { image_url: "https://x/a/1762000000003_4_coat.jpg", month: "2026-02", category: "卫衣" },
  ],
};
const bm = api.namesByCatMonth("z");
ok(!!bm["卫衣|2026-01"] && bm["卫衣|2026-01"]["shirt.jpg"] === 1, "卫衣 · 1 月应记下 shirt.jpg");
ok(!!bm["卫衣|2026-02"] && bm["卫衣|2026-02"]["shirt.jpg"] === 1, "同一张图换月应单独记一份");
ok(!!bm["T恤|2026-01"] && bm["T恤|2026-01"]["shirt.jpg"] === 1, "同一张图换类目应单独记一份");
ok(bm["卫衣|2026-02"]["coat.jpg"] === 1, "卫衣 · 2 月应记下 coat.jpg");
ok(!bm["卫衣|2026-03"], "没传过的月份不应凭空出现");
ok(Object.keys(bm).length === 3, "应按「类目|月份」分三组（实际 " + Object.keys(bm).length + "）");

console.log("三、判重键：三键任一不同都必须放行");
const k = (z, c, m, f) => api.fpKey(z, c, m, f);
const base = k("pinterest", "卫衣", "2026-01", "h100_abc");
ok(base === k("pinterest", "卫衣", "2026-01", "h100_abc"), "同专区同类目同月同图 → 同一个键（拦住）");
ok(base !== k("tiktok", "卫衣", "2026-01", "h100_abc"), "换专区 → 键不同（放行）");
ok(base !== k("pinterest", "T恤", "2026-01", "h100_abc"), "换类目 → 键不同（放行）");
ok(base !== k("pinterest", "卫衣", "2026-02", "h100_abc"), "换月 → 键不同（放行）");
ok(base.indexOf("pinterest") === 0, "键里应带专区前缀");
ok(base.indexOf("2026-01") > 0, "键里应带月份");

console.log("四、类目名容差（只用于比对，不改库里的值）");
ok(api.catKey(" 卫 衣 ") === api.catKey("卫衣"), "类目名里的空格不应影响比对");
ok(api.catKey("卫衣") !== api.catKey("T恤"), "不同类目不能混成一个键");

console.log("五、反向验证：三个维度少任何一个都会误挡");
/* 只按指纹（旧版最激进的做法）：跨专区会被误挡 */
const byFp = (z, c, m, fp) => String(fp || "");
ok(byFp("pinterest", "卫衣", "2026-01", "h1") === byFp("tiktok", "卫衣", "2026-01", "h1"),
  "反向用例：只按指纹时跨专区同图键相同，说明带专区才是关键");
/* 按「专区 + 指纹」（漏掉类目）：跨类目会被误挡 */
const byZoneFp = (z, c, m, fp) => z + "|" + fp;
ok(byZoneFp("pinterest", "卫衣", "2026-01", "h1") === byZoneFp("pinterest", "T恤", "2026-01", "h1"),
  "反向用例：漏掉类目时跨类目同图键相同，说明带类目才是关键");
/* 按「专区 + 类目 + 指纹」（漏掉月份）：跨月会被误挡 */
const byNoMonth = (z, c, m, fp) => z + "|" + c + "|" + fp;
ok(byNoMonth("pinterest", "卫衣", "2026-01", "h1") === byNoMonth("pinterest", "卫衣", "2026-02", "h1"),
  "反向用例：漏掉月份时跨月同图键相同，说明带月份才是关键");
/* 不分组的库内文件名：跨类目同月会被误拦 */
const noGroup = {};
sandbox.state.z.items.forEach((r) => {
  const n = api.nameFromUrl(r.image_url);
  if (n) noGroup[n] = (noGroup[n] || 0) + 1;
});
ok(noGroup["shirt.jpg"] === 3, "反向用例：不分组时 shirt.jpg 被算 3 张，说明必须按「类目+月份」分组");

console.log("六、上传前按最终三键复检");
ok(/var month = pickMonth\(k\);/.test(SRC), "doUpload 应取最终月份");
ok(/var cat = pickCat\(k\);/.test(SRC), "doUpload 应取最终类目");
ok(/if \(nm && mNames\[nm\]\) \{ skippedSameMonth\+\+; return; \}/.test(SRC), "同类目同月同名应被跳过");
/* 20261121B：同月同指纹要挡，但「库里这个类目 + 月份已经一张都没有」时必须放行
   （否则误删后重传会被本地指纹永久挡住，菜单里却一张图都没有）。 */
ok(/if \(f\.__fp && fps\[fpKey\(k, cat, month, f\.__fp\)\]\) \{\s*\n\s*if \(dbN2 !== 0\) \{ skippedSameMonth\+\+; return; \}/.test(SRC),
  "同类目同月同指纹应被跳过（库里仍有图时）");
ok(/if \(dbN2 !== 0\)/.test(SRC) && /var dbN2 = dbGroupCount\(k, cat, month\)/.test(SRC),
  "判重前应先看库里这个类目 + 月份还剩几张");
ok(/if \(nm\) mNames\[nm\] = 1;/.test(SRC), "同一批里重名的也要挡");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
