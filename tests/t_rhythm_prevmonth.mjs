/* 上新节奏 / 趋势上升榜：「新上榜」与「环比上升/下降」口径 —— 20261113E
   用户反馈：上新节奏导进去的图「全是从新上榜，没有相对上个月的上升或下降」。
   根因两条：
     ① 位次对比只判断「上期有没有这张图」，没判断「上期这个类目/站点有没有数据」，
        某类目只导了一个月时，整列都会被判成「新上榜」；
     ② 跨期认图只做字符串全等，同一张首图带上 ?w=1000 / _400x400 后缀就认不出来；
        另外整批没有环比列时前台一个涨跌标签都没有。
   这里把这几条口径锁死，防止回退。 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const ROOT = process.cwd();
const R = fs.readFileSync(path.join(ROOT, "js/rhythm.js"), "utf8");
const K = fs.readFileSync(path.join(ROOT, "js/rank.js"), "utf8");
const AR = fs.readFileSync(path.join(ROOT, "js/admin-rhythm.js"), "utf8");
const AK = fs.readFileSync(path.join(ROOT, "js/admin-rank.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

/* 把源码里的函数原样抠出来真跑，而不是只做字符串匹配 */
/* 花括号计数必须跳过字符串与注释，否则 "新上榜" 这类文本里的括号会打乱深度 */
function grab(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("not found: " + name);
  let d = 0, started = false;
  for (let j = start; j < src.length; j++) {
    const ch = src[j];
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      for (j++; j < src.length; j++) {
        if (src[j] === "\\") { j++; continue; }
        if (src[j] === q) break;
      }
      continue;
    }
    if (ch === "/" && src[j + 1] === "/") { while (j < src.length && src[j] !== "\n") j++; continue; }
    if (ch === "/" && src[j + 1] === "*") { j += 2; while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++; j++; continue; }
    if (ch === "{") { d++; started = true; }
    else if (ch === "}") { d--; if (started && d === 0) return src.slice(start, j + 1); }
  }
  throw new Error("unbalanced: " + name);
}
const env = {};
/* 20261113F：位次判定改由 rhythm-calc.js 统一给出，这里把真引擎注入到被测环境里，
   测的就是页面上跑的那份逻辑，不是另写一份模拟。 */
const require_ = createRequire(import.meta.url);
env.RCALC = require_(path.join(ROOT, "js/rhythm-calc.js"));
/* 不用 with（ESM 严格模式下语法上不允许），直接把函数声明放在 body 顶层再挂到 env 上 */
const BODY = ["imgKey", "ratioMove", "moveText", "colMetaNote", "moveOf"].map(n => grab(R, n)).join("\n")
  + "\nconst RCALC = env.RCALC;"
  + "\nenv.imgKey=imgKey;env.ratioMove=ratioMove;env.moveText=moveText;env.colMetaNote=colMetaNote;env.moveOf=moveOf;"
  + "\nenv.contextOf=RCALC.contextOf;";
new Function("env", BODY)(env);

console.log("一、上月同口径无数据时，不能标「新上榜」");
/* 20261113F：位次判定统一走自算引擎，参数是「本期上下文 / 上期上下文 / 取键函数」 */
const K_ = env.imgKey;
const itNoRatio = { image_url: "https://img/a.jpg", ratio: 12 };   /* 只有比例、没有绝对值 → 反推不出销量 */
const ctxNone = env.contextOf([itNoRatio], K_);
const mvNone = env.moveOf(itNoRatio, "11月", "10月", ctxNone, null, K_);
ok(mvNone.move === "" && mvNone.isNew === false, "上月无数据、本批也反推不出 → 不标新上榜（也不给假位次）");

const prevCtx = env.contextOf([{ image_url: "https://img/other.jpg", ratio: 1, abs_delta: 5 }], K_);
const itNew = { image_url: "https://img/b.jpg", ratio: null, abs_delta: null };
ok(env.moveOf(itNew, "11月", "10月", env.contextOf([itNew], K_), prevCtx, K_).move === "新上榜",
   "上月整榜里确实没有这一款 → 新上榜");

const it0 = { image_url: "https://img/a.jpg", ratio: 12 };
ok(env.moveOf(it0, "11月", null, ctxNone, null, K_).move === "", "首期（无上一月）不标任何位次标签");

console.log("二、跨期认图不能只看字符串全等");
ok(env.imgKey("https://Img.Example.com/a.jpg?w=1000") === env.imgKey("http://img.example.com/a.jpg"),
   "同图带查询串 / 协议 / 大小写不同 → 认成同一张");
ok(env.imgKey("https://img.example.com/a_400x400.jpg") === env.imgKey("https://img.example.com/a.jpg"),
   "带 _400x400 尺寸后缀 → 认成同一张");
ok(env.imgKey("https://img.example.com/a.jpg") !== env.imgKey("https://img.example.com/b.jpg"),
   "不同图不会被误认成同一张");
const prevSame = env.contextOf([{ image_url: "https://img.example.com/a.jpg", ratio: 1, abs_delta: 10 }], K_);
const nowSame = env.contextOf([{ image_url: "https://img.example.com/a.jpg?w=800", ratio: 5, abs_delta: 20 }], K_);
ok(env.moveOf({ image_url: "https://img.example.com/a.jpg", ratio: 5, abs_delta: 20 }, "11月", "10月", nowSame, prevSame, K_).isNew === false,
   "上期是同一张图（只是地址带参数）时，不算新上榜");
ok(/RCALC\.contextOf\([^)]*imgKey\)/.test(R) && /function contextOf\(items, keyOf\)/.test(fs.readFileSync(path.join(ROOT, "js/rhythm-calc.js"), "utf8")),
   "位次索引按归一后的地址建立（上下文构建时传入 imgKey）");

console.log("三、没有位次可比时，必须给出环比方向");
ok(env.ratioMove({ ratio: 8.5 }) === "环比上升", "环比为正 → 环比上升");
ok(env.ratioMove({ ratio: -3 }) === "环比下降", "环比为负 → 环比下降");
ok(env.ratioMove({ ratio: 0 }) === "" && env.ratioMove({ ratio: null }) === "", "环比为 0 / 无 → 不标");
ok(env.moveText({ move: "新上榜" }, { ratio: -2 }) === "新上榜 · 环比下降", "新上榜且环比下降 → 两个标签都给出");
ok(env.moveText({ move: "上升 3 位" }, { ratio: 9 }) === "上升 3 位", "有位次变化时不再叠环比，避免互相干扰");
ok(env.moveText({ move: "" }, { ratio: 4 }) === "环比上升", "上月无数据时仍然能看到环比方向");
ok(!/move: mv\.move, isNew/.test(R) && !/move: mv\.move, isNew/.test(K), "两个页面卡片都改用 moveText 渲染");
ok(/moveText/.test(R) && /moveText/.test(K), "两个页面都接上了 moveText");

console.log("四、列头必须说清「能不能比对」");
const st = { up: 2, down: 1, ne: 5, rup: 40, rdn: 9 };
ok(/上月（10月）该类目\/站点没有数据.*无法比对位次/.test(env.colMetaNote("10月", true, st)),
   "上月无数据 → 明确写「无法比对位次」而不是报一堆新上榜");
ok(/新上榜 5 张/.test(env.colMetaNote("10月", false, st)) && /位次上升 2 \/ 下降 1/.test(env.colMetaNote("10月", false, st)),
   "正常情况写清新上榜 + 位次升降");
ok(/位次由系统按销量自算/.test(env.colMetaNote("10月", false, st, { ok: true, mode: "self" })),
   "自算得出的位次在列头写明口径，不让人以为是平台官方名次");
ok(/本批数据未带环比列/.test(env.colMetaNote("10月", false, { up: 0, down: 0, ne: 3, rup: 0, rdn: 0 })),
   "整批没有环比列 → 列头直接说明，不让人误以为系统算不出涨跌");

console.log("五、只看标签新增「环比上升 / 环比下降」");
ok(/chip\("rup", "只看环比上升"/.test(R) && /chip\("rdown", "只看环比下降"/.test(R), "月度页两个新筛选都在");
ok(/chip\("rup", "只看环比上升"/.test(K) && /chip\("rdown", "只看环比下降"/.test(K), "周度页同步");
ok(/ONLY === "rup"\) return ratioMove\(it\) === "环比上升"/.test(R), "筛选命中判定与卡片标签同源");
ok(/ONLY !== "off" && \(prev \|\| ONLY\.charAt\(0\) === "r"\)/.test(R),
   "环比筛选不依赖有没有上一期（否则上月无数据时筛不出任何东西）");

console.log("六、后台导入：环比列表头认得更宽，且缺列会告警");
[["js/admin-rhythm.js", AR], ["js/admin-rank.js", AK]].forEach(([name, src]) => {
  ok(/h\.indexOf\("涨幅"\)/.test(src) && /h\.indexOf\("增长率"\)/.test(src) && /h\.indexOf\("较上月"\)/.test(src),
     name + " 认「环比涨幅 / 涨幅 / 增长率 / 较上月」等写法");
  ok(/h\.indexOf\("增量"\)/.test(src) && /h\.indexOf\("差额"\)/.test(src), name + " 环比绝对值也认「增量 / 差额」");
  /* 20261113H：缺环比列不再一律告警 —— 有排名 / 销售额 / 行序也能给位次；
     只在「三种依据都没有」时才提示，且提示语改成了「将按表格行序当名次」 */
  ok(/整批没有读到「环比比例」列/.test(src) || /整批既没有环比、也没有「排名 \/ 销售额」列/.test(src),
     name + " 整批缺环比列时导入预览仍给出提示");
});

console.log("七、版本戳一致");
const BUILD = (R.match(/var BUILD\s*=\s*"([^"]+)"/) || [])[1] || "";
/* 不再写死版本号：每次发版都要回来改测试，忘了就红一片（本项目已踩过三次）。
     这里只校验格式正确，并与页面里所有脚本版本戳一致（下面那条断言） */
ok(/^2026\d{4}[A-Z]+$/.test(BUILD), "前台 BUILD 是合法版本戳（当前 " + BUILD + "）");
ok((K.match(/var BUILD\s*=\s*"([^"]+)"/) || [])[1] === BUILD, "周度页与月度页同版本");
const RH = fs.readFileSync(path.join(ROOT, "rhythm.html"), "utf8");
const RK = fs.readFileSync(path.join(ROOT, "rank.html"), "utf8");
ok(RH.indexOf("js/rhythm.js?v=" + BUILD) >= 0, "rhythm.html 引用新版本脚本");
ok(RK.indexOf("js/rank.js?v=" + BUILD) >= 0, "rank.html 引用新版本脚本");

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
