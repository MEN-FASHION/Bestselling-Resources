/* 20261103G：等待态卡在"正在核对图案标签"上出不来
   ① 就绪判定改成按图记账，不再比整批指纹（比不出来就永远不就绪）
   ② 6 秒超时兜底，请求不回来也照常出图
   ③ 已核对过的标签落本地缓存，第二次看同一批图不再等
   本测试锁住这三条，避免"页面停在提示上"再现。 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };

const store = {};
const fakeLS = {
  getItem: (k) => (store[k] === undefined ? null : store[k]),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const fakeDoc = {
  readyState: "loading", addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  body: { appendChild() {} }, documentElement: { style: {} },
};
const fakeWin = {
  __RANK_TEST__: true, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  APP_ENUM: {}, localStorage: fakeLS,
};
const ctx = {
  window: fakeWin, document: fakeDoc, console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
  localStorage: fakeLS, location: { href: "", search: "" }, navigator: { userAgent: "node" },
};
ctx.window.document = fakeDoc;
ctx.globalThis = ctx;
vm.createContext(ctx);
const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8");
vm.runInContext(SRC, ctx, { filename: "rank.js" });
const T = fakeWin.__RANK_T;
const mk = (u) => ({ image_url: u, category: "卫衣", site: "美国站", period_label: "2026-W43", _opp: false, _hot: false, _surge: false });

console.log("[1] 就绪判定：仍然按图记账（不再比整批指纹）");
ok("没有标签接口时直接放行（不会永远转圈）", T.tagsSettled([mk("a")]) === true);
ok("tagsSettled 里用 TAG_SEEN 按图记账", /if \(!TAG_SEEN\[tagStoreKey\(urls\[i\]\)\]\) \{/.test(SRC));
ok("不再把 TAG_KEY 当成就绪条件", SRC.indexOf("TAG_KEY === tagFingerprint(urls) && !TAG_BUSY") < 0);

console.log("\n[2] 等待有上限（不再死等）");
ok("门控有一个最长等待时间", /var TAG_GATE_WAIT = \d+;/.test(SRC));
ok("超过最长等待就放行出图", /Date\.now\(\) - TAG_GATE_AT > TAG_GATE_WAIT\) return true;/.test(SRC));
ok("换批次会重新计时", /TAG_GATE_AT = 0;/.test(SRC));
ok("请求失败也把图记为已核对（不会卡住）", /batch\.forEach\(function \(u\) \{ TAG_SEEN\[tagStoreKey\(u\)\] = 1; \}\);/.test(SRC));
ok("整表预取完成后，表里没有的图直接放行", /if \(TAG_ALL_STATE === 2\) \{ TAG_SEEN\[tagStoreKey\(urls\[i\]\)\] = 1; continue; \}/.test(SRC));

console.log("\n[3] 本地缓存与地址归一");
ok("地址归一去掉查询串", T.tagStoreKey("https://a.com/x.jpeg?imageView2/2/w/300") === "https://a.com/x.jpeg");
ok("地址归一去掉锚点", T.tagStoreKey("https://a.com/x.jpeg#p") === "https://a.com/x.jpeg");
ok("写入后能取回", (T.tagStorePut("https://a.com/1.jpeg", { craft_tags: ["刺绣"] }), (T.tagStoreGet("https://a.com/1.jpeg") || {}).craft_tags[0]) === "刺绣");
ok("带参数的同一张图也能命中缓存",
  (T.tagStoreGet("https://a.com/1.jpeg?w=800") || {}).craft_tags[0] === "刺绣");
ok("缓存落到本地存储", typeof store["rk_tag_store_v2"] === "string" && store["rk_tag_store_v2"].indexOf("刺绣") > 0);

console.log("\n[4] 缓存里的图视为已核对");
T.markTagSeen("https://b.com/2.jpeg");
ok("已记过的图算已核对", T.tagSeen("https://b.com/2.jpeg") === true);
ok("带参数访问同样算已核对", T.tagSeen("https://b.com/2.jpeg?v=1") === true);
ok("没记过的图不算", T.tagSeen("https://b.com/3.jpeg") === false);

console.log("\n[5] 缓存上限（整表预取要装得下，所以放宽到数千条）");
const CAPMAX = Number((SRC.match(/TAG_STORE_MAX = (\d+)/) || [])[1] || 0);
ok("上限提到 4000 以上", CAPMAX >= 4000, String(CAPMAX));
for (let i = 0; i < CAPMAX + 50; i++) T.tagStorePut("https://c.com/" + i + ".jpeg", { craft_tags: ["x"] });
ok("超出上限后旧的被淘汰", T.tagStoreGet("https://a.com/1.jpeg") === null);
ok("新的还在", !!T.tagStoreGet("https://c.com/" + (CAPMAX + 49) + ".jpeg"));

console.log("\n[6] 等待态有转圈提示");
ok("等待文案带转圈元素", SRC.indexOf("rk-spin") >= 0);
const CSS = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");
ok("样式里定义了转圈动画", CSS.indexOf("@keyframes rk-spin") >= 0);

console.log("\n[7] 部署配置");
const VJ = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
ok("静态站点不下发构建命令（避免无谓的 Building 等待）", VJ.buildCommand === undefined);
ok("js / css / vendor 长期缓存", VJ.headers.filter((h) => /^\/(js|css|vendor)\//.test(h.source)).length === 3);
ok("页面本身不强缓存（避免发版后看到旧的）", VJ.headers.some((h) => h.source === "/(.*)" && /no-cache/.test(JSON.stringify(h.headers))));
ok("有部署排除清单", fs.existsSync(path.join(__dirname, "..", ".vercelignore")));

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
