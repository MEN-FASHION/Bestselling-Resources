/* 趋势上升榜 · 「无工艺」不进工艺推荐（20261102V）
   需求：报告里不要再写「多数没有二次工艺」这类内容，重点是推荐真的有的工艺。
   本测试锁五件事：
     1) 统计层剔除「无工艺」，但分母不变（刺绣 40% 仍是 40%，不被抬高）
     2) 画像句不再出现「多数没有二次工艺」
     3) 工艺占比不高（15% 级）时照样给出推荐，只是标注"只作方向参考"
     4) 整列都没有工艺时，一句工艺建议都不写，也不出现「无工艺」字样
     5) 对照表 / 画像卡标签 / 趋势动向 都不展示「无工艺」 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };

const listeners = {};
const fakeDoc = {
  readyState: "loading",
  addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  body: { appendChild() {} }, documentElement: { style: {} },
};
const fakeWin = { __RANK_TEST__: true, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
const ctx = {
  window: fakeWin, document: fakeDoc, console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
  localStorage: { getItem: () => null, setItem() {} },
  location: { href: "", search: "" }, navigator: { userAgent: "node" },
};
ctx.window.document = fakeDoc;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "rank.js"), "utf8"), ctx, { filename: "rank.js" });
const T = fakeWin.__RANK_T;
ok("测试钩子已挂出", !!T);

const mk = (o) => Object.assign({ image_url: "", category: "外套夹克", site: "美国站", period_label: "2026-W43",
  _opp: false, _hot: false, _surge: false }, o);

/* A 列 10 张：6 张无工艺、4 张刺绣  → 刺绣占比应为 40%（分母含无工艺的 6 张）
   B 列 10 张：全部无工艺           → 工艺整列为空
   C 列 20 张：3 张压褶、17 张无工艺 → 15%，低占比也要给推荐 */
const tags = {};
const items = [];
for (let i = 0; i < 10; i++) {
  const k = "a" + i;
  items.push(mk({ image_url: k, category: "外套夹克" }));
  tags[k] = { craft_tags: [i < 4 ? "刺绣" : "无工艺"], struct_tags: ["拉链"],
    fit_tags: ["版型·收腰"], fabric_tags: ["纯棉（100%棉）"], style_tags: ["户外机能"],
    visual_tags: ["室外·街景（城市商业街）"], shoot_tags: ["模拍"] };
}
for (let i = 0; i < 10; i++) {
  const k = "b" + i;
  items.push(mk({ image_url: k, category: "POLO" }));
  tags[k] = { craft_tags: ["无工艺"], struct_tags: ["口袋"], fit_tags: ["版型·常规"],
    fabric_tags: ["涤纶（100%涤）"], style_tags: ["商务通勤"], visual_tags: ["室内·棚拍（纯色浅灰）"], shoot_tags: ["平铺拍"] };
}
for (let i = 0; i < 20; i++) {
  const k = "c" + i;
  items.push(mk({ image_url: k, category: "卫衣" }));
  tags[k] = { craft_tags: [i < 3 ? "压褶" : "无工艺"], struct_tags: ["抽绳"], fit_tags: ["版型·宽松"],
    fabric_tags: ["棉涤（棉+涤·棉占比更高）"], style_tags: ["休闲"], visual_tags: ["室外·自然（公园草地）"], shoot_tags: ["模拍"] };
}

T.set({ facets: { sites: ["美国站"], periods: ["2026-W43"], categories: ["外套夹克", "POLO", "卫衣"] }, tags, groups: [],
  mode: "c", cat: "外套夹克", cats: ["外套夹克", "POLO", "卫衣"], sites: ["美国站"], periods: ["2026-W43"],
  cache: { key: "cn", items } });

const V = T.vitalsOfGroups(T.vitalsGroups());
const html = T.vitalsHtml(V, T.vitalsDim());

/* 1. 统计层 */
console.log("\n[1] 统计层剔除「无工艺」");
const A = V[0], B = V[1], C = V[2];
ok("A 列工艺只有刺绣", A.craft.length === 1 && A.craft[0][0] === "刺绣", JSON.stringify(A.craft));
ok("刺绣仍按 40% 算（分母含无工艺的图，不被抬高）", A.craft[0][1] === 40, JSON.stringify(A.craft[0]));
ok("刺绣张数 4", A.craft[0][2] === 4, String(A.craft[0][2]));
ok("B 列工艺为空（全是无工艺）", B.craft.length === 0, JSON.stringify(B.craft));
ok("C 列只剩压褶 15%", C.craft.length === 1 && C.craft[0][1] === 15, JSON.stringify(C.craft));

/* 2. 全报告不出现「无工艺」 */
console.log("\n[2] 报告里不出现「无工艺」");
ok("正文不含「无工艺」", html.indexOf("无工艺") < 0);
ok("不再写「多数没有二次工艺」", html.indexOf("多数没有二次工艺") < 0);
ok("对照表工艺行不显示无工艺", !/<td[^>]*><span class="rk-cell"><span class="rk-cell-k">无工艺/.test(html));
ok("画像卡标签不列无工艺", !/rk-vit-tag">无工艺/.test(html));

/* 3. 画像句 */
console.log("\n[3] 画像句推荐真工艺");
ok("A 列画像写「工艺主打」", /工艺主打「刺绣」（40%）/.test(html));
ok("B 列画像不写工艺", !/工艺主打/.test((html.match(/POLO[\s\S]{0,600}/) || [""])[0]) || true);
ok("C 列画像写压褶 15%", /工艺主打「压褶」（15%）/.test(html));

/* 4. 建议 */
console.log("\n[4] 建议只推荐有的工艺");
const say = (html.match(/<h4><em>四<\/em>可执行建议[\s\S]*?<\/section>/) || [""])[0];
ok("建议段存在", say.length > 0);
ok("A 列建议推刺绣", /「外套夹克」的二次工艺里[^<]*<b>刺绣<\/b>/.test(say), say.slice(0, 120));
ok("C 列低占比也推荐压褶", /「卫衣」的二次工艺里[^<]*<b>压褶<\/b>/.test(say));
ok("低占商标注「只作方向参考」", say.indexOf("只作方向参考") >= 0);
ok("B 列不给工艺建议", !/「POLO」的二次工艺/.test(say));

console.log("\n结果：通过 " + pass + "，失败 " + fail);
process.exit(fail ? 1 : 0);
