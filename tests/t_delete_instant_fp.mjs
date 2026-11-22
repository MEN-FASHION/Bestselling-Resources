/* 20261121B · 两个回归自检
 *
 * 事故一：一批图传上去之后误删，再传同一批 → 提示「已经传过」，但菜单里一张图都没有。
 *   根因：判重指纹存在浏览器本地（localStorage），删图时没有清。
 *         图已经从库里删掉，指纹还在 → 整批被判重复跳过 → 库里 0 张、菜单自然空。
 *   修法：① 删图时按「专区 + 类目 + 月份 + 文件名」把指纹一起清掉；
 *         ② 兜底：库里这个「类目 + 月份」一张都没有时，本地指纹一律视为过期、直接放行。
 *         （文件名要按图片服务的清洗规则换算，否则中文名永远对不上。）
 *
 * 事故二：删图之后界面不更新，要刷新整页才消失。
 *   根因：删完只等「重新取数」再重绘，取数串了几条接口；慢/失败时界面就停在旧样子。
 *   修法：删成功先就地更新内存（st.items / state.items）、立刻重绘网格与计数，
 *         再去重新取数对账；同时清数据层缓存并广播。
 *
 * 本测试真跑：urlName / fpForget / dbGroupCount / 指纹库读写。
 * 反证：把「库里为空就放行」的分支拿掉必须失败；把名字换算改回不换算必须失败；
 *       名字对不上的指纹不许被误删。
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CZ = fs.readFileSync(path.join(ROOT, "js/admin-channelzone.js"), "utf8");
const MV = fs.readFileSync(path.join(ROOT, "js/admin-movement.js"), "utf8");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };
const has = (src, re, m) => ok(re.test(src), m);

console.log("一、实现结构（渠道专区）");
has(CZ, /function urlName\(/, "应有「按图片服务清洗规则换算文件名」的 urlName");
has(CZ, /function fpForget\(/, "应有删除时清指纹的 fpForget");
has(CZ, /function dbGroupCount\(/, "应有「本组还剩几张」的 dbGroupCount");
has(CZ, /fpForget\(k, goneItems\)/, "批量删除必须清指纹");
has(CZ, /fpForget\(k, \[item\]\)/, "单张删除必须清指纹");

console.log("二、删图后界面立刻更新（不许只等取数）");
const delMany = CZ.slice(CZ.indexOf("async function delMany"), CZ.indexOf("/* ---------- 批量编辑"));
ok(delMany.length > 200, "应能定位到 delMany");
ok(/st\.items = st\.items\.filter/.test(delMany), "批量删除应先从内存里移除这几张");
const iRender = delMany.indexOf("renderAll(k)");
const iLoad = delMany.indexOf("loadAll(k)");
ok(iRender > 0 && iLoad > 0 && iRender < iLoad, "必须「先重绘、后取数」（renderAll 在 loadAll 之前）");
ok(/invalidateCaches/.test(delMany), "取数前应清数据层缓存，否则会把刚删的读回来");

const delItem = CZ.slice(CZ.indexOf("async function delItem"), CZ.indexOf("/* ---------- 导入打标表"));
ok(/state\[k\]/.test(delItem) && /renderAll\(k\)/.test(delItem), "单张删除也要就地重绘");
const iR2 = delItem.indexOf("renderAll(k)"), iL2 = delItem.indexOf("loadAll(k)");
ok(iR2 > 0 && iL2 > 0 && iR2 < iL2, "单张删除也要「先重绘、后取数」");

const mvDel = MV.slice(MV.indexOf("async function delItem"), MV.indexOf("/* ---------- 导出 / 导入"));
ok(/state\.items = \(state\.items \|\| \[\]\)\.filter/.test(mvDel), "品牌动向删除也应先移除内存记录");
ok(/renderGrid\(\)/.test(mvDel) && /renderCount\(\)/.test(mvDel), "品牌动向删除后应立刻重绘网格与计数");
ok(mvDel.indexOf("renderGrid()") < mvDel.indexOf("await loadAll()"), "品牌动向也是「先重绘、后取数」");

console.log("三、真跑：文件名换算");
const grab = (src, name) => {
  let i = src.indexOf("function " + name);
  if (i < 0) return "";
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); }
  }
  return "";
};
const helpers = {
  normMonth: (x) => String(x || "").trim(),
  catKey: (c) => String(c == null ? "" : c).replace(/\s+/g, "").trim(),
};
const code = [
  'var FP_KEY = "cz_img_fp_v2"; var FP_MAX = 20000;',
  grab(CZ, "fpLoad"), grab(CZ, "fpSave"), grab(CZ, "normName"), grab(CZ, "nameFromUrl"),
  grab(CZ, "urlName"), grab(CZ, "fpKey"), grab(CZ, "fpForget"), grab(CZ, "dbGroupCount"),
].join("\n");
ok(/function fpForget/.test(code) && /function urlName/.test(code), "关键函数未找到");

const sandbox = {
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } },
  state: {},
  console, JSON, Object, Array, String, Number, Date, Math,
  normMonth: helpers.normMonth, catKey: helpers.catKey,
};
sandbox.window = sandbox;
const api = new Function("window", "localStorage", "state", "console", "normMonth", "catKey",
  code + "\nreturn { urlName, fpForget, dbGroupCount, fpLoad, fpSave, fpKey, nameFromUrl, normName };")(
  sandbox, sandbox.localStorage, sandbox.state, console, helpers.normMonth, helpers.catKey);

ok(api.urlName("背心1.jpg") === api.nameFromUrl("https://x.com/images/c/1762000000000_1234___1.jpg"),
  "中文名「背心1.jpg」应换算成图片服务存下来的「__1.jpg」");
ok(api.urlName("A B.JPG") === "a_b.jpg", "空格应换算成下划线、并忽略大小写");
ok(api.urlName("plain-01.png") === "plain-01.png", "纯英文名应原样保留");

console.log("四、真跑：删图清指纹");
const K = "pinterest";
sandbox.localStorage._d = {};
api.fpSave({
  [api.fpKey(K, "背心上衣", "2026-01", "h123_a")]: { at: 1, n: "背心1.jpg", m: "2026-01", c: "背心上衣", z: K },
  [api.fpKey(K, "背心上衣", "2026-01", "h123_b")]: { at: 1, n: "背心2.jpg", m: "2026-01", c: "背心上衣", z: K },
  [api.fpKey(K, "背心上衣", "2026-02", "h123_c")]: { at: 1, n: "背心1.jpg", m: "2026-02", c: "背心上衣", z: K },
  [api.fpKey("shein", "背心上衣", "2026-01", "h123_d")]: { at: 1, n: "背心1.jpg", m: "2026-01", c: "背心上衣", z: "shein" },
});
const n1 = api.fpForget(K, [{ category: "背心上衣", month: "2026-01", image_url: "https://x.com/images/c/1762000000000_1234___1.jpg" }]);
let map = api.fpLoad();
ok(n1 === 1, "只应清掉「同专区 + 同类目 + 同月 + 同名」这一条，实际清掉 " + n1);
ok(!map[api.fpKey(K, "背心上衣", "2026-01", "h123_a")], "删掉的那张指纹应消失");
ok(!!map[api.fpKey(K, "背心上衣", "2026-01", "h123_b")], "同月其它图不许被误删");
ok(!!map[api.fpKey(K, "背心上衣", "2026-02", "h123_c")], "换月不许被误删（换月本来就允许重传）");
ok(!!map[api.fpKey("shein", "背心上衣", "2026-01", "h123_d")], "换专区不许被误删");

console.log("五、真跑：库里为空 → 指纹作废（放行的依据）");
sandbox.state.shein = { items: [] };
ok(api.dbGroupCount("shein", "背心上衣", "2026-01") === -1, "列表尚未取回时返回 -1（状态未知），此时不许把指纹当过期");
sandbox.state.shein = { ready: true, items: [
  { category: "背心上衣", month: "2026-01" }, { category: "背心上衣", month: "2026-01" },
  { category: "背心上衣", month: "2026-02" }, { category: "卫衣", month: "2026-01" },
] };
ok(api.dbGroupCount("shein", "背心上衣", "2026-01") === 2, "应只数同组（类目 + 月份）的条数");
ok(api.dbGroupCount("shein", " 背心上衣 ", "2026-01") === 2, "类目名带空格也应算同一组");
ok(api.dbGroupCount("shein", "背心上衣", "2026-9") === 0, "不同月份不应被算进来");
ok(api.dbGroupCount("shein", "背心上衣", "2026-01") === 2, "同组条数应稳定可重复读取");


console.log("六、反证：放行分支必须存在，且只在「库里为空」时生效");
has(CZ, /if \(dbN !== 0\) \{ dupLocal\+\+; continue; \}\s*\n\s*delete have\[fk\]; staleFp\+\+;/,
  "加待传时：库里有图（或状态未知 -1）才拦，库里 0 张必须清掉指纹放行");
has(CZ, /if \(dbN2 !== 0\) \{ skippedSameMonth\+\+; return; \}\s*\n\s*\S*delete fps\[fpKey\(k, cat, month, f\.__fp\)\]; staleFp2\+\+;/,
  "点上传时：同样要先看库里有几张，不能无脑拦");
ok(!/if \(have\[fk\]\) \{ dupLocal\+\+; continue; \}/.test(CZ),
  "不许留下「只看本地指纹、不看库里」的旧写法（那正是本次事故）");

console.log("\n结果：" + pass + " 项通过，" + fail + " 项失败");
if (fail) process.exit(1);
