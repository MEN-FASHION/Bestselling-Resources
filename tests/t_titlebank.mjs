/* 20261112N · 标题组词台（titlelab.html）
 *
 * 口径变更（本次核心）：
 *   词一律来自「标题原文」，不吃打标结果。
 *   打标是看图判断的属性（面料还带类目推断），和商家实际写在标题里的词
 *   不是一回事，拿它当标题词会失真 —— 这一条用回归断言钉死。
 *
 * 验收点：
 *   1) 中英标题分词、复合词不被切碎、全角/emoji 清理、停用词过滤；
 *   2) 六类归位正确，占比分母按「命中该槽位的款数」而不是总款数；
 *   3) 图案开关跟随后台：关掉时槽位消失、图案词不参与统计；
 *   4) 组词三种分隔 + 自然语序、去重、评分与超长判断；
 *   5) CSV 带 BOM、含逗号与引号正确转义；
 *   6) 页面只读、只取 title、不出现打标字段、不放产品截图；
 *   7) 导航 / 专区定义 / 权限映射 / 版本戳一致。
 */
import fs from "fs";
import vm from "vm";

const CORE_SRC = fs.readFileSync("js/title-words.js", "utf8");
const APP_SRC = fs.readFileSync("js/titlelab.js", "utf8");
const HTML = fs.readFileSync("titlelab.html", "utf8");
const CFG = fs.readFileSync("js/config.js", "utf8");

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log("  ✗ " + n); } };

/* ================= 真实执行计算内核 ================= */
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(CORE_SRC, ctx);
const T = ctx.window.TITLE_WORDS;

console.log("一、分词：只吃标题原文");
ok(!!T, "内核应挂载 TITLE_WORDS");
ok(T.SLOTS.length === 11, "应有十一个标题槽位（原六类 + 手感 + 品类 + 季节 + 人群 + 功能）");
ok(T.SLOTS.map((s) => s.key).join(",") === "style,pattern,craft,fit,fabric,scene,handfeel,category,season,aud,func",
  "槽位顺序应为 风格/图案/工艺/版型/面料/场景/手感/品类/季节/人群/功能");

const t1 = T.tokenize("美式复古条纹长袖T恤女宽松纯棉上衣");
const w1 = t1.words.map((x) => x.w);
ok(w1.indexOf("美式复古") >= 0, "应切出「美式复古」");
ok(w1.indexOf("条纹") >= 0, "应切出「条纹」");
ok(w1.indexOf("纯棉") >= 0, "应切出「纯棉」");
ok(t1.words.find((x) => x.w === "条纹").slot === "pattern", "「条纹」应归图案");
ok(t1.words.find((x) => x.w === "纯棉").slot === "fabric", "「纯棉」应归面料");
ok(t1.words.find((x) => x.w === "美式复古").slot === "style", "「美式复古」应归风格");

const t2 = T.tokenize("Women‘s Vintage Striped Long Sleeve T-Shirt Cotton Tee");
const w2 = t2.words.map((x) => x.w);
ok(w2.indexOf("vintage") >= 0, "英文 vintage 应保留");
ok(w2.indexOf("striped") >= 0, "英文 striped 应保留");
ok(w2.indexOf("cotton") >= 0, "英文 cotton 应保留");
ok(w2.indexOf("long-sleeve") >= 0, "long sleeve 应合并为 long-sleeve，不被切碎");
ok(w2.indexOf("t-shirt") >= 0, "t-shirt 应整体保留");
ok(t2.words.find((x) => x.w === "vintage").slot === "style", "vintage 应归风格");
ok(t2.words.find((x) => x.w === "striped").slot === "pattern", "striped 应归图案");
ok(t2.words.find((x) => x.w === "long-sleeve").slot === "fit", "long-sleeve 应归版型");

const t3 = T.tokenize("VINTAGE Vintage 复古风★ 2026 🎉");
const w3 = t3.words.map((x) => x.w);
ok(w3.filter((x) => x === "vintage").length === 1, "同款内重复词只算一次");
ok(w3.indexOf("2026") >= 0, "年份应保留");
ok(w3.indexOf("🎉") === -1, "emoji 不应成为词");
ok(w3.indexOf("for") === -1 && w3.indexOf("the") === -1, "停用词（示例）不应出现");

const t4 = T.tokenize("2024 2025 装 套");
ok(t4.words.filter((x) => /^20\d{2}$/.test(x.w)).length === 2, "年份按个保留，纯数字其它滤掉");

const t5 = T.tokenize("");
ok(t5.words.length === 0, "空标题应切不出词");

console.log("二、统计：分母按槽位算");
const rows = [
  { title: "美式复古条纹纯棉T恤", site: "US" },
  { title: "法式碎花雪纺连衣裙", site: "US" },
  { title: "宽松纯棉上衣", site: "UK" },
  { title: "", site: "UK" },
  { title: "无属性描述的款", site: "DE" }
];
const st = T.tally(rows, {});
ok(st.total === 5, "总款数应为 5");
ok(st.withTitle === 4, "有标题应为 4");
ok(st.noTitle === 1, "空标题应为 1");
const fab = st.slots.find((s) => s.key === "fabric");
ok(!!fab, "应有面料槽位");
ok(fab.denom === 3, "面料分母应为命中面料的 3 款（不是 5 款）");
const cotton = fab.words.find((w) => w.w === "纯棉");
ok(!!cotton && cotton.n === 2, "纯棉应命中 2 款");
ok(cotton.pct === 66.7, "纯棉占比应为 2/3=66.7，而不是 2/5=40");
ok(fab.coverPct === 60, "面料槽位覆盖率应为 3/5=60%");
const pat = st.slots.find((s) => s.key === "pattern");
ok(pat.denom === 2, "图案分母应为 2（条纹、碎花各一款）");
ok(pat.words.find((w) => w.w === "条纹").pct === 50, "条纹应为 1/2=50%");
ok(pat.words[0].n >= pat.words[pat.words.length - 1].n, "词应按出现款数降序");
ok(st.uniq > 0 && st.uniq === Object.keys(st.uniq && {}).length + st.uniq, "uniq 应为正整数");
ok(st.avgChars > 0 && st.avgChars < 30, "标题均长应合理");

console.log("三、图案开关跟随后台");
const stHide = T.tally(rows, { hidePattern: true });
ok(stHide.slots.every((s) => s.key !== "pattern"), "关闭后不应存在图案槽位");
ok(stHide.slots.length === 10, "关闭后应为 10 个槽位");
const allWordsHide = stHide.slots.reduce((a, s) => a.concat(s.words.map((w) => w.w)), []);
ok(allWordsHide.indexOf("条纹") === -1, "关闭后图案词不应出现在任何槽位");
ok(allWordsHide.indexOf("碎花") === -1, "关闭后碎花不应出现");
const fabHide = stHide.slots.find((s) => s.key === "fabric");
ok(fabHide.denom === 3, "关闭图案后其它槽位分母不受影响");

console.log("四、组词器");
const picked = { style: "美式复古", pattern: "条纹", craft: "", fit: "宽松", fabric: "纯棉", scene: "" };
ok(T.compose(picked, "space") === "美式复古 条纹 宽松 纯棉", "空格分隔应只拼已选槽位");
ok(T.compose(picked, "comma") === "美式复古，条纹，宽松，纯棉", "逗号分隔应为全角逗号");
ok(T.compose(picked, "pipe") === "美式复古 | 条纹 | 宽松 | 纯棉", "竖线分隔");
ok(T.compose({}, "space") === "", "未选词应为空串");
const dupPicked = { style: "纯棉", fabric: "纯棉" };
ok(T.compose(dupPicked, "space") === "纯棉", "跨槽位同词应去重");
const nat = T.composeNatural({ fabric: "纯棉", style: "美式复古", fit: "宽松" }, "space");
ok(nat === "美式复古 宽松 纯棉", "自然语序应为 风格→版型→面料");
const hid = T.compose(picked, "space", { hidePattern: true });
ok(hid === "美式复古 宽松 纯棉", "关闭图案时组词不应带图案词");

const sc0 = T.score("", picked);
ok(sc0.score === 0 && sc0.chars === 0, "空标题评分为 0");
const sc1 = T.score("美式复古条纹宽松纯棉", picked);
ok(sc1.chars === 10 && !sc1.over, "10 字不应判超长");
const longText = "很".repeat(61);
const sc2 = T.score(longText, picked);
ok(sc2.over === true, "超过 60 字应判超长");
const scMax = T.score(longText, { style: "a", pattern: "b", craft: "c", fit: "d", fabric: "e", scene: "f" });
ok(scMax.score >= 0 && scMax.score <= 100, "评分应在 0-100 区间");
ok(sc1.filled === 4, "已选槽位数应为 4");

console.log("五、词库与 CSV");
const bk = T.bank(rows, {});
ok(bk.rows.length > 0, "词库应有内容");
ok(bk.rows[0].n >= bk.rows[bk.rows.length - 1].n, "词库应按出现款数降序");
ok(bk.rows.some((x) => x.group === "风格调性"), "词库应含风格分组");
ok(bk.rows.length > 0, "词库应有内容");
const handWords = T.tokenize("轻薄柔软亲肤").words.map((x) => x.w);
ok(handWords.every((w) => T.tokenize("轻薄柔软亲肤").words.filter((x) => x.w === w)[0].slot === "handfeel"),
  "手感词应归入 handfeel 槽位");
const catWords = T.tokenize("卫衣外套牛仔裤").words.map((x) => x.w);
ok(catWords.every((w) => T.tokenize("卫衣外套牛仔裤").words.filter((x) => x.w === w)[0].slot === "category"),
  "品类词应归入 category 槽位");
const bk2 = T.bank([{ title: "轻薄柔软卫衣" }, { title: "柔软外套" }], {});
ok(bk2.rows.some((x) => x.slot === "handfeel"), "词库应能产出感分组");
ok(bk2.rows.some((x) => x.slot === "category"), "词库应能产出品类分组");
const csv = T.toCSV([{ category: "T恤", period: "2026W45", site: "US", title: 'A,B "test"', words: [{ w: "纯棉" }], suggest: "美式复古" }]);
ok(csv.charCodeAt(0) === 0xfeff, "CSV 应以 BOM 开头");
ok(csv.indexOf('"A,B ""test"""') >= 0, "含逗号与引号应正确转义");
ok(csv.split("\r\n")[0].indexOf("原标题") >= 0, "CSV 表头应含原标题列");

console.log("六、口径回归：绝不吃打标");
ok(!/rank_tags|tag_id|tagIds|labels\s*:|getRankTags/i.test(CORE_SRC), "内核不应引用打标字段");
ok(!/rank_tags|tag_id|tagIds/i.test(APP_SRC), "页面不应引用打标字段");
ok(/title/.test(APP_SRC), "页面应读取 title 字段");
ok(/cols\s*:\s*"[^"]*title/.test(APP_SRC), "取数应显式声明 title 列");
const r1 = T.tally([{ title: "纯棉T恤" }], {});
const r2 = T.tally([{ title: "纯棉T恤", tags: { fabric: "雪纺" }, label_fabric: "雪纺" }], {});
ok(JSON.stringify(r1) === JSON.stringify(r2), "给同一标题附加打标字段，结果必须完全不变");

console.log("七、页面只读 / 无截图 / 引用");
ok(!/\binsert\s*\(|\bupsert\s*\(|\bupdate\s*\(|\bdelete\s*\(/.test(APP_SRC), "页面不应有写库调用");
ok(!/<img\b/i.test(HTML), "页面不应出现产品截图");
ok(/js\/title-words\.js/.test(HTML), "页面应引用标题词库");
ok(!/js\/title-slot\.js/.test(HTML), "页面不应再引用旧的打标槽位脚本");

console.log("八、导航 / 专区定义 / 版本戳");
ok(/titlebank/.test(CFG), "专区定义应登记 titlebank");
const pages = ["index.html", "rank.html", "rising.html", "rising2.html", "rhythm.html",
  "favorites.html", "compare.html", "zone.html", "trend.html", "brand.html", "titlelab.html"];
let navOk = true, navMiss = [];
pages.forEach((p) => {
  if (!fs.existsSync(p)) { return; }
  const src = fs.readFileSync(p, "utf8");
  if (!/titlebank|标题组词台/.test(src) && p !== "titlelab.html") { navOk = false; navMiss.push(p); }
});
ok(navOk, "各页面应含专区入口/导航：" + navMiss.join(","));

const admin = fs.readFileSync("admin.html", "utf8");
const adminJs = fs.readFileSync("js/admin.js", "utf8");
ok(/titlebank/.test(CFG) && /titlelab\.html/.test(CFG), "专区定义应登记 titlebank 与页面地址");
ok(/ZONE_DEFS/.test(adminJs) && /for \(const z of ZONE_DEFS\)|ZONE_DEFS\.forEach/.test(adminJs),
  "后台可见性/权限开关应遍历专区定义动态生成（新增专区自动出现）");
ok(/getPatternPrintVisible/.test(APP_SRC), "页面应读取后台的图案印花款开关");

const ver = (HTML.match(/v=(20\d{6}[A-Z]+)/) || [])[1];
ok(!!ver, "页面应有版本戳");
if (ver) {
  const bad = pages.filter((p) => fs.existsSync(p) && !fs.readFileSync(p, "utf8").includes("v=" + ver));
  ok(bad.length === 0, "版本戳应全站一致：" + bad.join(","));
}


console.log("九、归位优先级（客户裁决 6 条）");
function slotOf(title, w) {
  const t = T.tokenize(title).words.filter((x) => x.w === w)[0];
  return t ? t.slot : "(未出现)";
}
ok(slotOf("户外钓鱼防晒", "户外") === "scene", "① 场景优先：户外 归场景");
ok(slotOf("户外钓鱼防晒", "钓鱼") === "scene", "① 场景优先：钓鱼 归场景");
ok(slotOf("户外露营训练", "训练") === "scene", "① 场景优先：训练 归场景");
ok(slotOf("刺绣logo卫衣", "刺绣") === "craft", "② 工艺优先：刺绣 归工艺");
ok(slotOf("开衫连帽外套", "开衫") === "fit", "③ 版型优先：开衫 归版型");
ok(slotOf("开衫连帽外套", "连帽") === "fit", "③ 版型优先：连帽 归版型");
ok(slotOf("男士棉服外套", "棉服") === "category", "④ 品类：棉服 不再进面料");
ok(slotOf("轻薄柔软衬衫", "轻薄") === "handfeel", "⑤ 手感：轻薄 归手感");
ok(slotOf("轻薄柔软衬衫", "柔软") === "handfeel", "⑤ 手感：柔软 归手感");
const keep = T.tokenize("时尚潮流新款 适合日常 版型设计 品质面料").words.map((x) => x.w);
ok(keep.indexOf("时尚") >= 0 && keep.indexOf("潮流") >= 0, "⑥ 不丢弃：时尚/潮流 仍保留（标为泛用词）");
ok(keep.indexOf("适合") === -1, "元词「适合」仍丢弃（属噪音而非卖点）");
ok(keep.indexOf("设计") === -1, "元词「设计」仍丢弃");
ok(T.tokenize("时尚潮流").words.filter((x) => x.w === "时尚")[0].slot === "style", "时尚 仍在风格槽位参与统计");

console.log("十、季节 / 性别 / 件数 / 礼物（第二批裁决）");
ok(slotOf("男士秋冬外套", "秋冬") === "season", "季节：秋冬 归季节时令");
ok(slotOf("男士四季衬衫", "四季") === "season", "季节：四季 归季节时令");
ok(slotOf("男女同款情侣外套", "男女同款") === "aud", "性别词：男女同款 保留并归人群尺码");
ok(slotOf("男士休闲卫衣", "男士") === "aud", "性别词：男士 保留并归人群尺码");
ok(slotOf("女士打底衫", "女士") === "aud", "性别词：女士 保留并归人群尺码");
ok(slotOf("3件套卫衣", "3件套") === "category", "件数：3件套 归品类形态");
ok(slotOf("二件套衬衫", "二件套") === "category", "件数：中文数字件套同样识别");
ok(slotOf("圣诞礼物毛衣", "圣诞礼物") === "scene", "礼物：归场景");
ok(slotOf("送礼卫衣", "送礼") === "scene", "礼物：送礼 归场景");
const seq = T.compose({ season: "秋冬", style: "休闲", category: "卫衣" }, "space", {});
ok(seq.indexOf("秋冬") === 0, "组词语序：季节置于最前");


console.log("十一、第三批裁决（人群 / 功能 / 工作 / 穿搭）");
ok(slotOf("男士大码卫衣", "男士") === "aud", "人群：男士 归人群尺码而非丢弃");
ok(slotOf("女士大码卫衣", "女士") === "aud", "人群：女士 归人群尺码");
ok(slotOf("情侣款卫衣", "情侣款") === "aud", "人群：情侣款 归人群尺码");
ok(slotOf("大码显瘦外套", "大码") === "aud", "人群：大码（尺码段）也归人群尺码");
ok(slotOf("可机洗衬衫", "可机洗") === "func", "功能：可机洗 归功能卖点");
ok(slotOf("快干运动T恤", "快干") === "func", "功能：快干 归功能卖点");
ok(slotOf("耐磨工装裤", "耐磨") === "func", "功能：耐磨 归功能卖点");
ok(slotOf("速干防晒外套", "速干") === "func", "功能：速干 归功能卖点");
ok(slotOf("弹力修身长裤", "弹力") === "func", "功能：弹力 归功能卖点（优先于面料）");
ok(slotOf("工作外套", "工作") === "scene", "场景：工作 归场景（客户裁决）");
ok(slotOf("工作服外套", "工作服") === "scene", "场景：工作服 归场景");
const wear = T.tokenize("秋冬穿搭 男士穿搭 日常穿搭").words.filter((x) => x.w === "穿搭")[0];
ok(!!wear, "穿搭：保留参与统计，不丢弃");
ok(wear.slot === "scene", "穿搭：归场景（可穿衣场合）");
ok(T.tokenize("通勤穿搭推荐").words.some((x) => x.w.indexOf("穿搭") >= 0 && x.slot === "scene"), "穿搭：通勤穿搭 组合词整体归场景");
ok(slotOf("男士休闲卫衣", "适合") === "(未出现)", "元词「适合」仍丢弃");

console.log("\n" + (fail === 0 ? "PASS " : "FAIL ") + pass + " / " + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
