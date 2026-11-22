/* 20261115H · 「记录地址对不上桶里的文件」自检
 *
 * 现象：图片明明在，界面却是一块灰底，DevTools 里那一条是 404。
 * 根因：记录里的 path 与桶里实际的 key 只差一点点 ——
 *   ① 压缩池把 .jpg 转成 .webp，扩展名变了；
 *   ② 类目名里的「/」被规范化（打底/压缩 → 打底压缩），目录层级跟着变；
 *   ③ 文件名大小写不同 / 多一层少一层目录。
 *
 * 本自检断言：
 *   · 图片服务有「同名文件找回」（resolveKey / _scan），且取不到对象时会走它；
 *   · 图片服务有 /diag/img 现场诊断，能列出试过的 key、同目录现存文件、同名文件；
 *   · 前台 404 时会先问诊断接口，拿到正确地址就直接换上去（用户无感）；
 *   · 体检把这类归为「可一键修复」，并能把正确地址回写记录。
 * 反向用例：把找回 / 诊断 / 自动改正写回去必须失败，证明用例抓得住缺陷。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

const W = read("worker/worker.js");
const S = read("js/supabase.js");
const A = read("js/admin-channelzone.js");

console.log("【1】图片服务：同名文件找回");
{
  ok(/function _stemOf\(/.test(W), "有 _stemOf（忽略扩展名比较）");
  ok(/function _matchKey\(/.test(W), "有 _matchKey（先比整名，再比主名）");
  ok(/async function resolveKey\(/.test(W), "有 resolveKey（按同名文件解析实际 key）");
  ok(/async function _scan\(/.test(W), "有 _scan（按前缀扫桶，页数有界）");
  ok(/_scan\(dir \+ "\/", name, stem/.test(W), "先扫同目录（最快、最准）");
  ok(/_scan\("images\/", name, stem/.test(W), "再扫 images/ 全量");
  ok(/_rescueHit/.test(W) && /_rescueMiss/.test(W), "命中/未命中都有缓存，不反复扫桶");
  ok(/pages < \(maxPages \|\| 20\)/.test(W), "扫桶有页数上限（不会无限扫）");
  /* 取对象时真的会走到找回 */
  const g = W.slice(W.indexOf("async function getObject("), W.indexOf("async function getObject(") + 900);
  ok(/resolveKey\(decodedPath, rawPath\)/.test(g), "getObject 取不到时会调 resolveKey");
  // 反向：把找回整段删掉必须报错
  ok(!/if \(!obj\) \{\s*return null;\s*\}/.test(W), "反向：没有「取不到就直接 404」的旧写法");
}

console.log("\n【2】图片服务：/diag/img 现场诊断");
{
  ok(/path === "diag\/img"/.test(W), "有 /diag/img 路由");
  const d = W.slice(W.indexOf('path === "diag/img"'), W.indexOf('path === "diag/img"') + 2400);
  ok(/tried/.test(d) && /exists/.test(d), "报告试过哪些 key、是否存在");
  ok(/nearby/.test(d), "报告同目录现存文件（看清目录层级是否变了）");
  ok(/sameStem/.test(d), "报告同名文件（看清是否只是扩展名变了）");
  ok(/resolved/.test(d), "给出可用的正确地址");
  ok(/token-missing|token-invalid/.test(d), "未登录时区分「没带令牌」与「令牌失效」");
  ok(/const WORKER_BUILD = "20\d{6}[A-Z]"/.test(W), "图片服务版本戳合法可辨");
}

console.log("\n【3】前台：404 时先问诊断，再决定要不要画占位");
{
  ok(/async function diag\(u\)/.test(S), "有 diag()");
  ok(/\/diag\/img\?path=/.test(S), "diag 调的是 /diag/img");
  ok(/reason, probe, diag,/.test(S), "diag 已对外暴露（体检要用）");
  const oe = S.slice(S.indexOf("async function onError(el)"), S.indexOf("async function onError(el)") + 2200);
  ok(/code === 404 && el.getAttribute\("data-imgfixd"\) !== "1"/.test(oe), "只在 404 且没改过时才诊断");
  ok(/if \(d && d\.resolved\)/.test(oe), "拿到正确地址就换上去");
  ok(/data-imgfixd/.test(oe), "改过一次就打标记，避免来回重试打转");
  ok(/\[IMG-DIAG\]/.test(oe), "改不了时把现场打进控制台（便于反馈）");
  // 反向：不能一 404 就直接画「文件不存在」
  const naive = /const code = raw \? await probe\(raw\) : 0;\s*el\.setAttribute\("data-imgfail"/;
  ok(!naive.test(oe), "反向：不是「一 404 就断定文件没了」");
}

console.log("\n【4】体检：把「地址过期」和「文件真没了」分开，并能一键改正");
{
  ok(/fixable/.test(S) && /repairs/.test(S), "体检结果区分出「可修复」并带修复清单");
  ok(/out\.repairs\.push\(\{ url: stripAuth\(u\), key:/.test(S), "修复清单带正确 key");
  ok(/async repairImagePath\(id, key\)/.test(S), "有 repairImagePath（回写记录地址）");
  ok(/update\(\{ url: u, path: k \}\)/.test(S), "回写同时更新 url 与 path");
  ok(/rep\.repairs && rep\.repairs\.length/.test(A), "后台体检发现可修复项会给出修复");
  ok(/SB\.repairImagePath\(rec\.id, rp\.key\)/.test(A), "后台真的调用回写");
  ok(/地址修复：/.test(A), "修复后有明确结论文字");
  // 反向：不能把「可修复」混进「文件不存在」里误导
  ok(/地址过期可修复 /.test(A) && /文件不存在 /.test(A), "两类分开报，不再混为一谈");
}

console.log("\n【5】真实跑一遍：桶里只有 .webp，记录里写的是 .jpg");
{
  /* 抽出真代码里的 _stemOf/_matchKey/_baseOf/_dirOf，配假桶跑一次找回 */
  const grab = (name) => {
    const i = W.indexOf("function " + name + "(");
    if (i < 0) return "";
    let depth = 0, j = W.indexOf("{", i);
    for (let k = j; k < W.length; k++) {
      if (W[k] === "{") depth++;
      else if (W[k] === "}") { depth--; if (depth === 0) return W.slice(i, k + 1); }
    }
    return "";
  };
  const code = [grab("_dirOf"), grab("_baseOf"), grab("_stemOf"), grab("_matchKey")].join("\n");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code + "\nthis._dirOf=_dirOf;this._baseOf=_baseOf;this._stemOf=_stemOf;this._matchKey=_matchKey;", ctx);
  ok(ctx._stemOf("images/打底/压缩/1794_1_a.JPG") === "1794_1_a", "_stemOf 忽略扩展名与大小写");
  ok(ctx._dirOf("images/打底/压缩/a.jpg") === "images/打底/压缩", "_dirOf 取到目录");
  ok(ctx._matchKey("images/打底压缩/1794_1_a.webp", "1794_1_a.jpg", "1794_1_a") === true,
    "扩展名变了（jpg→webp）也算同一个文件");
  ok(ctx._matchKey("images/打底/压缩/1794_1_a.webp", "1794_1_a.jpg", "1794_1_a") === true,
    "目录层级变了也算同一个文件");
  ok(ctx._matchKey("images/打底/压缩/other.webp", "1794_1_a.jpg", "1794_1_a") === false,
    "不同文件不会误判");
}

console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
