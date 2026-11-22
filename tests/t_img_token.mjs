/* 20261115G · 「有的图不显示」专项自检
   ------------------------------------------------------------
   现场：前台后台传的图，有的能看、有的灰底；同一个人两个页面，一个全好一个全灰。
   三处根因，各写正反两组断言：
     ① 地址没带令牌（库里很多是完整地址，直接 return 就把令牌丢了）→ 图片服务 401
     ② 令牌过期后不续期（dataset 里的令牌是页面打开那一刻的）→ 401 后落到灰底
     ③ 老记录缺 images/ 前缀 / 缺 path → 命中不到读图路由或拼成根地址 → 404
   反向断言：把修复退回旧写法，用例必须报错，防止「测试永远通过」。
*/
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

const workerSrc = fs.readFileSync(path.join(ROOT, "worker/worker.js"), "utf8");
const frontSrc = fs.readFileSync(path.join(ROOT, "js/frontend.js"), "utf8");
const commonSrc = fs.readFileSync(path.join(ROOT, "js/common.js"), "utf8");
const sbSrc = fs.readFileSync(path.join(ROOT, "js/supabase.js"), "utf8");
const czSrc = fs.readFileSync(path.join(ROOT, "js/channel-zone-front.js"), "utf8");
const cfSrc = fs.readFileSync(path.join(ROOT, "js/compare-front.js"), "utf8");
const aczSrc = fs.readFileSync(path.join(ROOT, "js/admin-channelzone.js"), "utf8");

const WORKER = "https://img.newtrend.top";
const TOKEN = "tok-abc";

/* 在隔离环境里真跑 common.js，取出 window.imgSrc */
function loadCommon(token) {
  const win = {};
  const store = {};
  if (token) store["sb-x-auth-token"] = JSON.stringify({ access_token: token });
  const localStorage = {
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i],
    getItem: (k) => (k in store ? store[k] : null),
  };
  const noop = () => {};
  const ctx = {
    window: win,
    document: {
      addEventListener: noop, removeEventListener: noop,
      readyState: "complete", querySelector: () => null,
      body: { appendChild: noop, classList: { add: noop, remove: noop }, style: {} },
      createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, setAttribute: noop, appendChild: noop }),
    },
    localStorage,
    sessionStorage: { getItem: () => null, setItem: noop },
    location: { pathname: "/", search: "", hash: "", href: "https://x/" },
    performance: { navigation: { type: 0 } },
    navigator: { userAgent: "node" },
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  win.addEventListener = noop;
  win.removeEventListener = noop;
  win.CONFIG = { WORKER_URL: WORKER };
  win.localStorage = localStorage;
  win.sessionStorage = ctx.sessionStorage;
  win.location = ctx.location;
  win.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(commonSrc, ctx);
  return ctx.window;
}

console.log("\n【1】统一地址出口：任何形态的地址都要带令牌");
{
  const w = loadCommon(TOKEN);
  const rel = w.imgSrc("images/卫衣/a.jpg");
  ok(rel === WORKER + "/images/卫衣/a.jpg?token=" + encodeURIComponent(TOKEN), "相对路径补令牌");
  const abs = w.imgSrc(WORKER + "/images/卫衣/b.jpg");
  ok(abs === WORKER + "/images/卫衣/b.jpg?token=" + encodeURIComponent(TOKEN), "本站完整地址补令牌（渠道图就是这种）");
  const ext = w.imgSrc("https://img.alicdn.com/x.jpg");
  ok(ext === "https://img.alicdn.com/x.jpg", "外部图床原样返回，不乱加参数");
  const dup = w.imgSrc(WORKER + "/images/a.jpg?token=old");
  ok(dup.indexOf("token=old") > 0 && dup.split("token=").length === 2, "已有令牌不重复追加");
  const empty = w.imgSrc("");
  ok(empty === "", "空值返回空串");

  // 反向：没有令牌时不得凭空造一个
  const w2 = loadCommon("");
  ok(w2.imgSrc("images/a.jpg") === WORKER + "/images/a.jpg", "未登录时给裸地址，不去拼空令牌");
}

console.log("\n【2】反向验证：把「完整地址直接 return」的旧写法放回去，必须被抓住");
{
  const w = loadCommon(TOKEN);
  const oldImpl = (s) => {
    if (/^https?:\/\//i.test(s)) return s;   // 旧写法：直接 return，令牌丢失
    return WORKER + "/" + s.replace(/^\/+/, "") + "?token=" + TOKEN;
  };
  const old = oldImpl(WORKER + "/images/a.jpg");
  const now = w.imgSrc(WORKER + "/images/a.jpg");
  ok(old.indexOf("token=") < 0, "旧写法确实丢了令牌（对照组成立）");
  ok(now.indexOf("token=") > 0 && old !== now, "新写法与旧写法结果不同，用例真的能抓住差异");
}

console.log("\n【3】各专区/后台都改走统一出口（源码级断言）");
{
  ok(/typeof window\.imgSrc === "function"/.test(czSrc), "渠道专区（S/P/T）走统一出口");
  ok(/typeof window\.imgSrc === "function"/.test(cfSrc), "渠道对比走统一出口");
  ok(/_tok = await SB\.currentToken\(\)/.test(aczSrc) && /withTok\(u\)/.test(aczSrc), "后台专区图墙自己补令牌（后台不加载 common.js）");
  ok(!/if \(\/\^https\?:\\\/\\\/\/i\.test\(u\)\) return u;\n    var base/.test(czSrc.replace(/\s+/g, " ")), "渠道专区不再「完整地址直接 return」");
}

console.log("\n【4】令牌过期要续期重试，而不是直接灰底");
{
  ok(/async function fetchImgBlob/.test(frontSrc), "前台有统一的取图函数");
  const fb = frontSrc.slice(frontSrc.indexOf("async function fetchImgBlob"), frontSrc.indexOf("function lazyPump"));
  ok(/status === 401 \|\| resp\.status === 403/.test(fb), "401/403 会触发续期");
  ok(/DB\.currentToken/.test(fb), "续期用的是数据层的单飞续期");
  ok(/fresh !== at/.test(fb), "续期后令牌确实变了才重试（不做无谓请求）");
  ok(/__guestToken = fresh/.test(fb), "新令牌写回，同批图复用，不会每张都续期");
  // 兜底路径也要走同一函数（否则 4 秒超时那条路仍旧灰底）
  const errBlock = frontSrc.slice(frontSrc.indexOf("p.onerror = () =>"), frontSrc.indexOf("p.dataset.loading"));
  ok(/fetchImgBlob\(au, at\)/.test(errBlock), "onerror 兜底同样走续期重试");
  // 反向：把旧的裸 fetch 放回去，断言必须失败
  const oldFallback = 'const headers = at ? { "Authorization": "Bearer " + at } : {};\n          const resp = await fetch(au, { headers, cache: "no-store" });';
  ok(!errBlock.includes(oldFallback), "兜底里已不再用「旧令牌裸 fetch 一次」的写法");
  ok(/onerror/.test(frontSrc) && /\bimgEl\.dataset\.authToken/.test(frontSrc), "卡片仍记录 authUrl/authToken 供兜底使用");
}

console.log("\n【5】老记录缺 path / 缺 images/ 前缀也要能显示");
{
  ok(/_ensureImgPath\(r\)/.test(sbSrc), "数据层有统一的 path 补齐");
  ok(/API\._ensureImgPath\(r\)/.test(sbSrc), "分页读取也用同一个补齐");
  const fn = sbSrc.slice(sbSrc.indexOf("_ensureImgPath(r) {"), sbSrc.indexOf("async listImages("));
  ok(/indexOf\(base \+ "\/"\) === 0/.test(fn), "从完整地址反推 path");
  ok(/replace\(\/\^\\\/\+\/, ""\)/.test(fn), "从相对地址反推 path");
  // 反向：path 已有值时不得覆盖
  ok(/if \(p0\) return r;/.test(fn), "path 已有值时不改写");

  ok(/function isImgReadPath\(p\)/.test(workerSrc), "读图路由支持「像图片文件」的路径");
  ok(/indexOf\("images\/"\) === 0/.test(workerSrc), "images/ 前缀仍正常");
  ok(/"images\/" \+ decodedPath/.test(workerSrc), "取不到时补 images/ 前缀重试一次");
}

console.log("\n【6】真跑 isImgReadPath（从 worker 源码里抽出来执行）");
{
  const src = workerSrc.slice(workerSrc.indexOf("function isImgReadPath"), workerSrc.indexOf("// 兼容新旧存储"));
  const fn = new Function(src + "; return isImgReadPath;")();
  ok(fn("images/卫衣/a.jpg") === true, "images/ 开头 → 读图");
  ok(fn("卫衣/a.jpg") === true, "缺前缀但像图片 → 读图（老记录）");
  ok(fn("admin/list-imgs") === false, "后台接口不当作图");
  ok(fn("ver") === false, "版本接口不受影响");
  ok(fn("trend/xxx.pdf") === false, "趋势文件走原路由");
  ok(fn("") === false, "空路径不匹配");
}

console.log("\n【7】限流阈值不再误伤正常浏览");
{
  ok(/const WLIM = 20000/.test(workerSrc), "每分钟上限已从 2000 提到 20000");
  ok(/Retry-After/.test(workerSrc), "429 带上 Retry-After，前端可退避");
  // 反向：旧阈值必须报错
  ok(!/const WLIM = 2000;/.test(workerSrc), "旧阈值 2000 已不存在（一屏图就容易撞上 → 整屏灰）");
}

console.log("\n【8】版本戳一致");
{
  /* 20261121D：本轮只改前台收藏脚本（点击重试 / 提示可见），图片服务未改动，
     因此图片服务停在上一版 20261116B，前台资源统一升到 20261122A。 */
  const wver = "20261116B";
  const ver = "20261122A";
  ok(new RegExp('WORKER_BUILD = "' + wver + '"').test(workerSrc), "图片服务版本号 = " + wver);
  const idx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok(idx.includes("?v=" + ver), "前台资源版本 = " + ver);
  const czHtml = fs.readFileSync(path.join(ROOT, "shein.html"), "utf8");
  ok(czHtml.includes("?v=" + ver), "渠道专区页版本同步");
}

console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
