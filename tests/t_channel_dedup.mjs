/* 20261112B · 专区上传自动去重（同一张图不重复上传）
 *
 * 三层判断，命中任一层就跳过：
 *   1) 本批重复：同一文件被选两次 / 同一张图存了两个名字
 *   2) 之前传过：按内容指纹（大小 + 前 64KB 的 SHA-256）记在本地，改名也认得出
 *   3) 库里已有：上传地址里保留了原文件名，按文件名比对（跨浏览器也有效）
 *
 * 验收点：
 *   - 三层各自都能独立拦住；
 *   - 判重不会误伤不同文件（大小不同、内容不同、名字不同都要放行）；
 *   - 只登记「真正传成功」的指纹；
 *   - 判重只在前端做，不改上传接口。
 */
import fs from "fs";

const SRC = fs.readFileSync("js/admin-channelzone.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

console.log("一、实现结构");
ok(/var FP_KEY = "cz_img_fp_v1"/.test(SRC), "应有本地指纹库");
ok(/async function fingerprint/.test(SRC), "应有内容指纹计算");
ok(/crypto\.subtle\.digest\("SHA-256"/.test(SRC), "指纹应基于内容摘要");
ok(/function nameFromUrl/.test(SRC), "应能从上传地址还原原文件名");
ok(/replace\(\/\^\\d\+_\\d\+_\/, ""\)/.test(SRC), "应去掉地址里的时间戳前缀");
ok(/dupBatch|dupLocal|dupCloud/.test(SRC), "应分别统计三类重复");
ok(/rememberFps\(st\.pending\.filter/.test(SRC), "只登记成功上传的指纹");
ok(!/uploadRankChannelImages\(items, \{ channel[^)]*dedup/.test(SRC), "去重不得依赖上传接口改动");

/* 把相关函数抽出来实跑 */
const grab = (name) => {
  let i = SRC.indexOf("function " + name);
  if (i < 0) return "";
  if (SRC.slice(i - 6, i) === "async ") i -= 6;   /* 保留 async 修饰，否则 await 语法非法 */
  let d = 0, j = SRC.indexOf("{", i);
  for (let k = j; k < SRC.length; k++) {
    if (SRC[k] === "{") d++;
    else if (SRC[k] === "}") { d--; if (!d) return SRC.slice(i, k + 1); }
  }
  return "";
};

const code = ['var FP_KEY = "cz_img_fp_v1"; var FP_MAX = 6000; ',
  grab("fpLoad"), grab("fpSave"), grab("fingerprint"), grab("normName"),
  grab("nameFromUrl"), grab("existingNames"),
].join("\n");
ok(code.indexOf("function fingerprint") >= 0 && code.indexOf("function nameFromUrl") >= 0, "关键函数未找到");

const sandbox = {
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } },
  normMonth: (x) => x,
  state: {},
  console,
  JSON, Object, Array, String, Number, Date, Math,
};
sandbox.crypto = globalThis.crypto;      /* 让内容摘要走真实 SHA-256 分支 */
sandbox.window = sandbox;
const fn = new Function("window", "localStorage", "state", "console", "crypto",
  code + "\nreturn { fingerprint, normName, nameFromUrl, existingNames, fpLoad, fpSave };");
const api = fn(sandbox, sandbox.localStorage, sandbox.state, console, globalThis.crypto);

console.log("二、文件名还原");
ok(api.nameFromUrl("https://x.com/a/1762000000000_1234_IMG_001.JPG") === "img_001.jpg",
  "应还原出 img_001.jpg");
ok(api.nameFromUrl("https://x.com/a/1731000000000_shirt.png?t=1") === "shirt.png",
  "应去掉前缀与查询串");
ok(api.normName(" IMG 001.JPG ") === "img001.jpg", "比较时应忽略空格与大小写");
ok(api.nameFromUrl("https://x.com/a/2026/shot.webp") === "shot.webp", "无前缀时保留原名");

console.log("三、库里已有判定");
sandbox.state.z1 = { items: [{ image_url: "https://x.com/a/1762000000000_1234_A.JPG" }] };
const names = api.existingNames("z1");
ok(names["a.jpg"] === 1, "库中已有的图应被记为存在");
ok(!names["b.jpg"], "库里没有的不应被记为存在");

console.log("四、指纹区分度");
function mkFile(name, size, content, mtime) {
  return {
    name, size, lastModified: mtime || 1,
    slice: () => ({ arrayBuffer: async () => new TextEncoder().encode(content).buffer }),
  };
}
const a1 = await api.fingerprint(mkFile("a.jpg", 10, "hello"));
const a2 = await api.fingerprint(mkFile("renamed.jpg", 10, "hello"));
const b1 = await api.fingerprint(mkFile("b.jpg", 10, "world"));
const c1 = await api.fingerprint(mkFile("c.jpg", 20, "hello"));
ok(a1 === a2, "同名内容、不同文件名应得到同一指纹（改名也能认出来）");
ok(a1 !== b1, "内容不同应得到不同指纹");
ok(a1 !== c1, "大小不同应得到不同指纹");
ok(/^h10_/.test(a1), "指纹应带大小信息");

console.log("五、本地指纹库读写与清理");
sandbox.localStorage._d = {};
const m = {};
m[a1] = { at: Date.now() };
api.fpSave(m);
ok(!!sandbox.localStorage._d["cz_img_fp_v1"], "应写入本地指纹库");
ok(!!api.fpLoad()[a1], "应能读回指纹");

/* 超量时清理最老的 */
const big = {};
for (let i = 0; i < 6100; i++) big["h1_" + i] = { at: i };
api.fpSave(big);
const back = api.fpLoad();
const n = Object.keys(back).length;
ok(n <= 6000, "指纹库应有上限（实际 " + n + "）");
ok(!back["h1_0"], "应优先清掉最老的记录");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
