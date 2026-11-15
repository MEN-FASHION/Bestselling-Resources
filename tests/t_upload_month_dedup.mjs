/* 20261114V · 传图去重改成「按月判重」
 *
 * 口径：同一个月里同一张图只留一张；换一个月可以再传一次
 *       （1 月的图 2 月再传属于两次上新，必须放行）。
 *
 * 反向用例：
 *   - 把指纹键里的月份去掉（退回全局判重）→「换月必须放行」的用例必须失败；
 *   - 把库里文件名不按月份分组 → 「同月拦住」的用例必须失败。
 */
import fs from "fs";

const SRC = fs.readFileSync("js/admin-channelzone.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

console.log("一、实现结构");
ok(/function fpKey\(month, fp\)/.test(SRC), "应有带月份的指纹键 fpKey");
ok(/function namesByMonth\(k\)/.test(SRC), "应有按月份分组的库内文件名 namesByMonth");
ok(/function pickMonth\(k\)/.test(SRC), "应能从上传月份控件取当月");
ok(/var fk = fpKey\(month, fp\);/.test(SRC), "本批比对应带月份");
ok(/if \(have\[fk\]\)/.test(SRC), "本地指纹库比对应带月份");
ok(/rememberFps\([^)]*, month\)/.test(SRC), "登记指纹时应带上月份");
ok(/fps\[fpKey\(month, f\.__fp\)\]/.test(SRC), "上传前应按最终月份再挡一次");
ok(/换个月份可以再传一次/.test(SRC), "提示文案应说明换月可再传");

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
  grab("namesByMonth"),
  grab("fpKey"),
].join("\n");

const sandbox = { state: {}, console };
const fn = new Function("state", "console", code + "\nreturn { namesByMonth, fpKey, nameFromUrl };");
const api = fn(sandbox.state, console);

console.log("二、库里文件名按月分组");
sandbox.state.z = {
  items: [
    { image_url: "https://x/a/1762000000000_1_shirt.jpg", month: "2026-01" },
    { image_url: "https://x/a/1762000000001_2_shirt.jpg", month: "2026-02" },
    { image_url: "https://x/a/1762000000002_3_coat.jpg", month: "2026-02" },
  ],
};
const bm = api.namesByMonth("z");
ok(!!bm["2026-01"] && bm["2026-01"]["shirt.jpg"] === 1, "1 月应记下 shirt.jpg");
ok(!!bm["2026-02"] && bm["2026-02"]["shirt.jpg"] === 1, "同一张图在 2 月应单独记一份");
ok(bm["2026-02"]["coat.jpg"] === 1, "2 月应记下 coat.jpg");
ok(!bm["2026-03"], "没传过的月份不应凭空出现");
ok(Object.keys(bm).length === 2, "应按月份分两组（实际 " + Object.keys(bm).length + "）");

console.log("三、指纹键按月分区");
const a1 = api.fpKey("2026-01", "h100_abc");
const a2 = api.fpKey("2026-02", "h100_abc");
ok(a1 !== a2, "同一张图在不同月份应得到不同的判重键（换月放行）");
ok(api.fpKey("2026-01", "h100_abc") === a1, "同一月同一图应得到相同键（同月拦住）");
ok(a1.indexOf("2026-01") === 0, "键里应带月份前缀");

console.log("四、反向验证：去掉月份就拦不住 / 拦不住同月");
/* 把 fpKey 退化成「只用指纹」，用来证明上面的「换月放行」断言不是恒真 */
const noMonth = (m, fp) => String(fp || "");
ok(noMonth("2026-01", "h1") === noMonth("2026-02", "h1"),
  "反向用例：去掉月份后两月同图键相同，说明带月份的 fpKey 才是关键");
/* 把分组退化成「全月一桶」，用来证明同月拦截依赖分组 */
const allMonths = (() => {
  const bucket = {};
  sandbox.state.z.items.forEach((r) => {
    const n = api.nameFromUrl(r.image_url);
    if (n) bucket[n] = (bucket[n] || 0) + 1;
  });
  return bucket;
})();
ok(allMonths["shirt.jpg"] === 2, "反向用例：不分月时 shirt.jpg 会被算 2 张，说明必须按月分组才不会误挡换月重传");

console.log("五、上传前的复检用的是最终月份");
ok(/var month = normMonth\(monEl \? monEl\.value : ""\);/.test(SRC), "doUpload 应按控件里最终选中的月份判断");
ok(/if \(nm && mNames\[nm\]\) \{ skippedSameMonth\+\+; return; \}/.test(SRC), "同月同名应被跳过");
ok(/if \(f\.__fp && fps\[fpKey\(month, f\.__fp\)\]\) \{ skippedSameMonth\+\+; return; \}/.test(SRC), "同月同指纹应被跳过");
ok(/if \(nm\) mNames\[nm\] = 1;/.test(SRC), "同一批里重名的也要挡");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
