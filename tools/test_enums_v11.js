/* ============================================================================
 * test_enums_v11.js —— 枚举总表 v11 一致性回归
 *
 * 校验的不是"页面能不能跑"，而是"页面用的词表和运营手里的总表是不是同一份"。
 * 词表换版后最容易出的三类事故，这里各自钉一条：
 *   ① 数量对不上  → 说明少抄或多抄了取值
 *   ② 同一列里出现同一层级混装（纹样/图案内容/结构件）→ 说明三列没拆干净
 *   ③ 取值自带逗号 → 导出表用逗号分隔，一个值里有逗号会把后面的值切碎
 *
 * 运行：node tools/test_enums_v11.js
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const R = { pass: 0, fail: 0, msgs: [] };
const ok = (c, m) => (c ? R.pass++ : (R.fail++, R.msgs.push(m)));

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "rank-enums.js"), "utf8"), sandbox);
const E = sandbox.window.APP_ENUM;
const G = sandbox.window.APP_ENUM_GROUPS;

/* 1. 维度与取值数量（与《打标枚举总表-终版-v11》逐项对齐） */
const EXPECT = {
  "风格": 85, "视觉-背景": 125, "视觉-画面构成": 28, "视觉-呈现主体": 34,
  "图案类型": 87, "图案元素": 171, "结构部件": 20, "二次工艺": 126,
  "拍摄方式": 7, "模特": 36, "面料": 57, "文化背景": 96, "消费心理": 31, "节日": 50,
  "领型": 32, "袖型": 20, "袖长": 8, "衣长": 7, "松紧度": 9,
  "裤型": 26, "裤长": 8, "裙长": 7, "腰型": 11
};
Object.keys(EXPECT).forEach((k) => {
  const n = (E[k] || []).length;
  ok(n === EXPECT[k], `维度「${k}」取值数 ${n}，总表是 ${EXPECT[k]}`);
});
ok(Object.keys(EXPECT).length === 23, "枚举维度应为 23 个");
const TOTAL = Object.keys(EXPECT).reduce((a, k) => a + EXPECT[k], 0);
const got = Object.keys(EXPECT).reduce((a, k) => a + (E[k] || []).length, 0);
ok(got === TOTAL, `取值总数 ${got}，总表是 ${TOTAL}`);

/* 2. 同一维度内不重复 */
Object.keys(EXPECT).forEach((k) => {
  const arr = E[k] || [];
  ok(new Set(arr).size === arr.length, `维度「${k}」有重复取值`);
});

/* 3. 取值里不能出现分隔符（导出用逗号分列，值内有逗号会把一个值切成两个） */
Object.keys(EXPECT).forEach((k) => {
  const bad = (E[k] || []).filter((v) => /[,，、|；;]/.test(v));
  ok(!bad.length, `维度「${k}」取值里含分隔符：${bad.slice(0, 3).join(" / ")}`);
});

/* 4. 图案三列互不重叠：同一个词只能属于一列 */
const P = new Set(E["图案类型"]), EL = new Set(E["图案元素"]), ST = new Set(E["结构部件"]);
const overlapPT = [...P].filter((v) => EL.has(v));
const overlapST = [...ST].filter((v) => EL.has(v));
const overlapPS = [...P].filter((v) => ST.has(v));
ok(!overlapPT.length, `图案类型与图案元素重词：${overlapPT.join("、")}`);
ok(!overlapST.length, `结构部件与图案元素重词：${overlapST.join("、")}`);
ok(!overlapPS.length, `图案类型与结构部件重词：${overlapPS.join("、")}`);

/* 5. 结构件不能出现在图案元素里（v10 的混装点，逐条点名） */
["拉链", "抽绳", "口袋", "荷叶边", "蕾丝", "镂空", "绑带", "开衩", "双层", "翻边",
 "腰带", "金属扣件", "织带", "肩章", "臂章", "反光条", "褶皱", "口袋盖"].forEach((v) => {
  ok(!EL.has(v), `图案元素里仍有结构件「${v}」`);
  ok(ST.has(v), `结构部件缺「${v}」`);
});

/* 6. 纹样不能出现在图案元素里 */
["格纹", "竖条纹", "千鸟格", "波点", "碎花", "迷彩", "棋盘格", "满印"].forEach((v) => {
  ok(!EL.has(v), `图案元素里仍有纹样「${v}」`);
  ok(P.has(v), `图案类型缺「${v}」`);
});

/* 7. 背景前缀规则：场景一律带 室内·/室外· 前缀，中性底不带 */
const NEUTRAL = ["纯白底", "浅灰底", "纯色背景", "渐变色背景", "画布纹理", "无背景（抠图）",
  "纯色背景纸·多种可选色", "渐变灯光背景", "投影光影背景"];
E["视觉-背景"].forEach((v) => {
  const isNeutral = NEUTRAL.indexOf(v) >= 0;
  const prefixed = /^室内·|^室外·/.test(v);
  ok(isNeutral ? !prefixed : prefixed, `背景「${v}」前缀不符合 v11 口径`);
});

/* 8. 拍摄方式收敛为 7 个互斥值，不再混模特出镜程度 */
ok((E["拍摄方式"] || []).length === 7, "拍摄方式应为 7 个值");
["全身出镜", "半身出镜", "街拍", "棚拍模特", "直播截帧"].forEach((v) => {
  ok((E["拍摄方式"] || []).indexOf(v) < 0, `拍摄方式仍混有「${v}」`);
});

/* 9. 分组的总和必须等于枚举本体，且不能漏值 */
[["background", "视觉-背景"], ["pattern", "图案类型"], ["element", "图案元素"], ["fabric", "面料"]].forEach(([gk, dim]) => {
  const groups = G[gk] || [];
  const flat = groups.reduce((a, g) => a.concat(g.values), []);
  ok(flat.length === (E[dim] || []).length, `${gk} 分组展开 ${flat.length} 项，枚举本体 ${E[dim].length} 项`);
  const miss = E[dim].filter((v) => flat.indexOf(v) < 0);
  ok(!miss.length, `${gk} 分组漏值：${miss.slice(0, 5).join("、")}`);
});
ok((G.fit || []).length === 9, "版型分组应为 9 个部位");
ok((G.festival || []).length === 4, "节日分组应为 4 组");

/* 10. 旧值改写：v10 的背景旧词必须都映射到 v11 新词，且映射目标在枚举内 */
const ALIAS = E.bgAlias || {};
ok(Object.keys(ALIAS).length >= 60, "背景改值表少于 60 条，疑似漏抄");
Object.keys(ALIAS).forEach((oldV) => {
  ok(E["视觉-背景"].indexOf(ALIAS[oldV]) >= 0, `背景旧值「${oldV}」映射到不在枚举里的「${ALIAS[oldV]}」`);
});

/* 11. 归一函数：老表导回来要能自动分拣，不能一导就判未识别 */
const norm = sandbox.window.normalizeTagSet({
  visual_tags: ["家居卧室·床品沙发", "纯白底"],
  element_tags: ["格纹", "拉链", "卡通图案", "骷髅"],
  shoot_tags: ["摆拍", "平铺拍"]
});
ok(norm.tags.visual_tags.indexOf("室内·家居卧室·床品沙发") >= 0, "旧背景值没有改写成新值");
ok(norm.tags.pattern_tags.indexOf("格纹") >= 0, "格纹没有分拣到图案类型");
ok(norm.tags.struct_tags.indexOf("拉链") >= 0, "拉链没有分拣到结构部件");
ok(norm.tags.element_tags.indexOf("卡通图案") < 0 && norm.tags.element_tags.indexOf("卡通人物") >= 0,
  "卡通图案没有换成 v11 的「卡通人物」");
ok(norm.tags.element_tags.indexOf("骷髅") >= 0, "骷髅不该被挪走");
ok(norm.tags.shoot_tags.join() === "平铺拍", "摆拍应从拍摄方式挪到视觉-呈现主体");
ok(norm.tags.visual_tags.indexOf("摆拍") >= 0, "摆拍没有落到视觉-呈现主体");

/* 12. 历史值放行：老词仍在 allow 列表里（不判未识别），但不在下拉里 */
const allowEl = sandbox.window.enumValuesFor("图案元素");
ok((E.legacyElement || []).every((v) => allowEl.indexOf(v) >= 0), "图案元素的历史值没有放行");
ok((E.legacyShoot || []).every((v) => sandbox.window.enumValuesFor("拍摄方式").indexOf(v) >= 0), "拍摄方式的历史值没有放行");
ok(E.legacyElement.every((v) => E["图案元素"].indexOf(v) < 0), "历史值不该混进下拉枚举");

console.log(`结果：通过 ${R.pass}，失败 ${R.fail}`);
if (R.fail) {
  R.msgs.forEach((m) => console.log("  ✗ " + m));
  process.exit(1);
}
R.msgs.forEach((m) => console.log("  ✓ " + m));
