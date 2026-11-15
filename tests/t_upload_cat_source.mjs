/* 20261114V · 传图类目候选统一到「趋势上升榜」那一套 + 类目搜索
 *
 * 口径：
 *   - 上传类目只取后台「类目管理」（categories 表，与榜单导入同一个来源）；
 *   - 筛选用下拉额外补上「本专区已用过的类目」，避免老图筛不到、改不了；
 *   - 上传 / 打标下拉都有搜索框（复用全站模糊搜索 CAT_SEARCH）；
 *   - 读不到类目表时退回内置清单，任何情况下都能选到东西。
 *
 * 反向用例：把上传下拉改成「也带上已用类目」→「严格只跟后台那套」的用例必须失败。
 */
import fs from "fs";

const CZ = fs.readFileSync("js/admin-channelzone.js", "utf8");
const MV = fs.readFileSync("js/admin-movement.js", "utf8");
const SMART = fs.readFileSync("js/admin-smart.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

function grab(src, name) {
  let i = src.indexOf("function " + name);
  if (i < 0) return "";
  if (src.slice(i - 6, i) === "async ") i -= 6;
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); }
  }
  return "";
}

console.log("一、渠道专区（S / P / T）：候选来源");
ok(/var active = \(st && st\.activeCats && st\.activeCats\.length\) \? st\.activeCats\.slice\(\) : \[\];/.test(CZ),
  "候选应优先取后台类目表（activeCats）");
ok(/typeof SB\.listActiveCats === "function"/.test(CZ), "加载时应读后台类目表 listActiveCats");
ok(/st\.activeCats = await SB\.listActiveCats\(\)/.test(CZ), "应把类目表存进面板状态复用");
ok(/var out = base\.slice\(\);/.test(CZ), "候选应以类目表为准");
ok(/if \(mode !== "upload"\) \{/.test(CZ), "上传下拉不应混入历史已用类目");

console.log("二、渠道专区：类目搜索框");
ok(/CATS\.mountBox\(sel, "cat-search" \+ key, "搜索类目…"/.test(CZ), "上传 / 打标下拉应挂搜索框");
ok(/\[\["upload-cat", "-upload"\], \["tag-cat", "-tag"\]\]/.test(CZ), "上传与打标两个下拉都要有搜索");
ok(/CATS\.filterSelect\(sel, CATS\.kw\(key\)\)/.test(CZ), "重绘后应保持上次的搜索词");

console.log("三、品牌动向：同一套口径");
ok(/opts = await SB\.listActiveCats\(\)/.test(MV), "品牌动向类目应来自后台类目表");
ok(/if \(!opts \|\| !opts\.length\) opts = \(window\.CONFIG && window\.CONFIG\.CATEGORY_OPTIONS\) \|\| \[\]/.test(MV),
  "读不到类目表时才退回内置清单");
ok(/CATS\.mountBox\(up, "cat-search-mv-upload", "搜索类目…"/.test(MV), "品牌动向上传类目应有搜索框");
ok(/CATS\.sortCats\(opts, favs\)/.test(MV), "常用类目应置顶带星（与榜单一致）");

console.log("四、视觉专区：此前已是同一口径（回归守护）");
ok(/cats = await SB\.listActiveCats\(\)/.test(SMART), "视觉专区类目仍来自后台类目表");
ok(/CATS\.mountBox\(sel, "cat-search-smartcat"/.test(SMART), "视觉专区类目搜索框不能被弄丢");

/* ---------- 五、真跑 catOptions ---------- */
const code = [
  grab(CZ, "usedCats"),
  grab(CZ, "catOptions"),
].join("\n");
const win = { CONFIG: { CATEGORY_OPTIONS: ["内置甲", "内置乙"] } };
const state = {
  z: {
    activeCats: ["毛衣", "衬衫", "打底/压缩"],
    items: [{ category: "毛衣" }, { category: "历史遗留类目" }, { category: "" }],
  },
};
const fn = new Function("window", "state", code + "\nreturn { catOptions, usedCats };");
const api = fn(win, state);

console.log("五、候选列表实算");
const up = api.catOptions("z", "upload");
ok(up.join(",") === "毛衣,衬衫,打底/压缩", "上传下拉应严格等于后台类目表（实际 " + up.join(",") + "）");
ok(up.indexOf("历史遗留类目") < 0, "上传下拉不得混入库里出现过的杂类目");
ok(up.indexOf("内置甲") < 0, "有后台类目表时不应再塞内置清单");

const any = api.catOptions("z", "any");
ok(any.indexOf("历史遗留类目") >= 0, "筛选 / 打标下拉要能选到已用过的类目");
ok(any.slice(0, 3).join(",") === "毛衣,衬衫,打底/压缩", "已用类目应追加在后面，不打乱后台顺序");
ok(api.catOptions("z", "any").join(",") === "毛衣,衬衫,打底/压缩,历史遗留类目", "去重后顺序应稳定");

state.z.activeCats = [];
const fb = api.catOptions("z", "upload");
ok(fb.join(",") === "内置甲,内置乙", "读不到类目表时应退回内置清单（实际 " + fb.join(",") + "）");

console.log("六、反向验证：上传下拉混入已用类目就该报错");
state.z.activeCats = ["毛衣"];
const lazy = api.catOptions("z", "any");
ok(lazy.indexOf("历史遗留类目") >= 0 && up.indexOf("历史遗留类目") < 0,
  "反向用例：两种模式必须不同，否则「严格跟后台」无从保证");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
