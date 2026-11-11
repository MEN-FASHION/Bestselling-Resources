/* 20261111AA · 渠道对比加载提速 + 压缩池「转 WebP」自检
 *
 * 这里盯两个容易「看着做完、其实没用」的点：
 *  1. 对比页的分批渲染：如果 renderPools 仍然一次铺全量、或者打标还在 load() 里全量查，
 *     页面照样慢，改了等于没改。
 *  2. 转 WebP：如果编码结果比原图还大却照样覆盖，用户的图会越转越大 —— 必须走兜底不覆盖。
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

const CF = read("js/compare-front.js");
const POOL = read("js/admin-pool.js");
const HTML = read("admin.html");
const CSS = read("css/style.css");
const WORKER = read("worker/worker.js");
const SUPA = read("js/supabase.js");

/* ================= 一、渠道对比：分批渲染 ================= */
ok(/var PAGE = 24;/.test(CF), "缺少首屏每列的批次大小（PAGE）");
ok(/shown: \{\}/.test(CF), "缺少每列已渲染进度（state.shown）");
ok(/tagAsked: \{\}/.test(CF), "缺少打标查询缓存（否则每次切类目都重查）");

const renderFn = CF.slice(CF.indexOf("async function renderPools"), CF.indexOf("async function renderPools") + 4200);
ok(/async function renderPools/.test(CF), "renderPools 应为异步（要按需等打标）");
ok(/await ensureTags\(want\)/.test(renderFn), "渲染前应只补齐「这一屏要显示」的打标");
ok(/slice\(0, lim\)/.test(renderFn), "每列必须先只渲染前 lim 张，不能一次铺全量");
ok(/data-more=/.test(renderFn) && /展开更多/.test(renderFn), "缺少「展开更多」入口");
ok(/state\.shown\[key\] = shownOf\(key\) \+ PAGE/.test(CF), "展开更多应递增该列的显示上限");
ok(/cmp-broken/.test(renderFn), "外链图失效应有占位处理，不能留一直转圈的空块");

/* 打标查询不能再走「全量一次拉」 */
ok(!/state\.tags = \(await SB\.listMovementTags\(urls\)\)/.test(CF), "load() 仍在一次性全量查打标（页面会被拖慢）");
ok(/async function ensureTags\(urls\)/.test(CF), "缺少按需查打标的 ensureTags");
ok(/TAG_BATCH/.test(CF) && /part = need\.slice/.test(CF), "按需查询应分批，避免一次塞上千个地址");
ok(/delete state\.tagAsked\[k\]/.test(CF), "查询失败应回滚缓存标记，否则这张图永远不再重试");

/* 分析要覆盖整列，不能只看屏幕上那几张 */
const insightFn = CF.slice(CF.indexOf("async function openInsight"), CF.indexOf("async function openInsight") + 1400);
ok(/await ensureTags\(all\)/.test(insightFn), "打开差异分析前应补齐整列打标，否则结论会偏");

/* 切类目 / 月份要重置分批进度，否则切回来还是厚的 */
ok(/state\.month = v; state\.shown = \{\}/.test(CF), "切月份时未重置分批进度");
ok(/state\.cat = name; state\.shown = \{\}/.test(CF), "切类目时未重置分批进度");

/* 样式：视口外的列不参与渲染 */
ok(/\.rk-pool\s*\{[^}]*content-visibility:\s*auto/.test(CSS), "缺少列级 content-visibility（几列并排时会白等）");
ok(/\.cmp-card\.cmp-broken/.test(CSS), "缺少图片失效占位样式");

/* ================= 一·补、20261111AA 取数提速 ================= */
ok(/var CACHE_TTL = 5 \* 60 \* 1000;/.test(CF), "缺少会话级数据缓存（每次打开都重新全量取，必然慢）");
ok(/var LOAD_TIMEOUT = 8000;/.test(CF), "取数缺少超时（超过 8 秒必须先出东西，不能一直加载中）");
ok(/function withTimeout\(p, ms, fallback\)/.test(CF), "缺少超时包装器");
ok(/Promise\.all\(\[/.test(CF), "两张表应并行取，不能串着等");
ok(/cols: "id,image_url,category,period_label,period_type,channel,title"/.test(CF),
  "渠道图应只取需要的字段（原来 select(*) 拉几十个字段）");
ok(/const COLS = o\.cols \|\| null;/.test(SUPA) && /select\(COLS \|\| "\*"\)/.test(SUPA),
  "底层渠道图查询未支持精简字段");
ok(/sessionStorage\.removeItem\(CACHE_KEY\)/.test(CF), "重试时应清掉缓存再取");
ok(/id="cmp-retry"|cmp-retry/.test(CF), "取不到数据时应给出「重新加载」入口，而不是空白");
ok(/withTimeout\(pTag, 6000, null\)/.test(CF), "打标查询没有超时，会拖着整列一直加载中");

/* ================= 二、压缩池：为什么榜单图不在池里 ================= */
ok(/startsWith\("images\/"\)/.test(WORKER), "清单接口应只列本站存储的图（images/ 前缀）");
ok(/外部图片链接/.test(HTML) && /不在本站存储/.test(HTML),
  "压缩池没有说明「榜单图是外链、不在池内」，用户会以为功能漏了");
ok(/id="imgpool-webp"/.test(HTML) && /id="imgpool-webp-all"/.test(HTML), "工具栏缺少转 WebP 的两个按钮");
ok(/转WebP选中/.test(POOL) && /全部转WebP|转 WebP/.test(POOL), "缺少转 WebP 的批量入口文案");

/* ================= 三、转 WebP 的真实行为 ================= */
ok(/function encodeWebp\(blob, quality\)/.test(POOL), "缺少 WebP 编码函数");
ok(/toBlob\(\(b\) => done\(b\), "image\/webp", quality\)/.test(POOL), "编码应指定 image\/webp");
ok(/ctx\.fillStyle = "#ffffff"/.test(POOL), "透明图转 WebP 需先铺白底，否则会变黑块");
ok(/const steps = \[0\.92, 0\.86, 0\.78\]/.test(POOL), "应有质量阶梯（先用高画质，不够小再降）");

/* 用最小桩真跑：原图 jpg → 转出更小的 webp 才覆盖；更大则保留原图 */
function makePoolEnv(origBytes, origType, webpBytesByQ) {
  const calls = [];
  const blobs = [];
  const documentStub = {
    createElement(tag) {
      if (tag !== "canvas") return {};
      return {
        width: 0, height: 0,
        getContext() { return { fillStyle: "", fillRect() {}, drawImage() {} }; },
        toBlob(cb, type, q) {
          /* 按质量给不同体积，模拟真实编码 */
          const n = webpBytesByQ(q);
          const b = new Blob([new Uint8Array(n)], { type: "image/webp" });
          blobs.push(b);
          cb(b);
        },
      };
    },
  };
  const win = {
    console,
    document: documentStub,
    setTimeout, clearTimeout, Blob, File, Uint8Array, Promise, String, Number, Object, Array, JSON, Math,
    URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    Image: function () { this.src = ""; },
    createImageBitmap: async () => ({ width: 100, height: 100, close() {} }),
    fetch: async () => ({ ok: true, status: 200, blob: async () => new Blob([new Uint8Array(origBytes)], { type: origType }) }),
    CONFIG: { WORKER_URL: "https://w.example.com" },
    $: () => null,
    sbToast: () => {},
    escAttr: (x) => String(x == null ? "" : x),
    escHtml: (x) => String(x == null ? "" : x),
    fmtSize: (n) => Math.round(n / 1024) + "KB",
    openImgZoom: () => {},
    SB: {
      currentToken: async () => "tok",
      overwriteStoredImg: async (p, f) => { calls.push({ p, size: f.size, type: f.type }); return true; },
    },
  };
  win.window = win;
  win.globalThis = win;
  vm.createContext(win);
  /* 模块里用到的零散工具（函数体才会碰到，这里给空实现即可） */
  /* 模块自带顶层声明（IMG_POOL_TARGET 等），这里不要再补，否则重复声明直接报错 */
  vm.runInContext(POOL, win, { filename: "admin-pool.js" });
  return { win, calls };
}

/* 3a. jpg 100KB，高质量反而变大、中质量变小 → 应选小的覆盖 */
{
  const { win, calls } = makePoolEnv(100 * 1024, "image/jpeg", (q) => (q >= 0.9 ? 130 * 1024 : 60 * 1024));
  const it = { key: "images/a.jpg", size: 100 * 1024 };
  const r = await win.imgPoolWebpOne(it);
  ok(r === "done", "转出更小的 WebP 时应覆盖写回，实际返回 " + r);
  ok(calls.length === 1, "应只覆盖一次，实际 " + calls.length);
  ok(calls[0] && calls[0].type === "image/webp", "覆盖时应声明 image/webp 内容类型");
  ok(it.size < 100 * 1024, "转换后本地记录的大小应更新");
  ok(it.webp === true, "应标记为已转 WebP（界面显示 JPG → WEBP）");
}
/* 3b. 原图本身就是 webp → 跳过，不重复覆盖 */
{
  const { win, calls } = makePoolEnv(50 * 1024, "image/webp", () => 40 * 1024);
  const it = { key: "images/b.webp", size: 50 * 1024 };
  const r = await win.imgPoolWebpOne(it);
  ok(r === "skip", "已经是 WebP 应跳过，实际 " + r);
  ok(calls.length === 0, "已是 WebP 时不应覆盖");
}
/* 3c. 各质量都比原图大 → 保留原图，绝不把用户图片转大 */
{
  const { win, calls } = makePoolEnv(40 * 1024, "image/jpeg", () => 90 * 1024);
  const it = { key: "images/c.jpg", size: 40 * 1024 };
  const r = await win.imgPoolWebpOne(it);
  ok(r === "bigger", "转码反而更大时应返回 bigger，实际 " + r);
  ok(calls.length === 0, "转码更大时绝不能覆盖原图（会让图越转越大）");
  ok(it.size === 40 * 1024, "未覆盖时体积记录不应变化");
}
/* 3d. 命中「只换格式」而不是「压到 200K」：目标 KB 不应参与判断 */
ok(!/imgPoolWebpOne[\s\S]{0,900}poolTargetOf/.test(POOL), "转 WebP 不应受压缩目标档位影响（它只换格式）");

/* ================= 四、刷新后还能认出「已转 WebP」 ================= */
/* 转换不改文件名（URL 不变），只看后缀会把转过的图当成没转过，用户会反复点 */
ok(/function poolIsWebp\(it\)/.test(POOL), "缺少统一的「是否已是 WebP」判断");
ok(/\/webp\/i\.test\(it\.type/.test(POOL) || /webp\/i\.test\(it\.type/.test(POOL),
  "识别已转 WebP 时应看存储里的 content-type（刷新后唯一可靠依据）");
ok(/poolIsWebp\(it\)/.test(POOL.slice(POOL.indexOf("function imgPoolRender"), POOL.indexOf("function imgPoolRender") + 5200)),
  "卡片渲染应使用统一判断，否则转过的图仍显示 JPG 并可再点一次");

/* worker 清单要带 content-type，前端才认得出 */
ok(/items\.push\(\{ key: o\.key, size: o\.size, type: ct \}\)/.test(WORKER),
  "清单接口未返回 content-type，刷新后无法识别已转 WebP 的图");
ok(/httpMetadata\.contentType/.test(WORKER), "应从对象的 httpMetadata 取内容类型");

/* 实测三种识别路径 */
{
  const { win } = makePoolEnv(1024, "image/jpeg", () => 512);
  const f = win.poolIsWebp;
  ok(typeof f === "function", "poolIsWebp 未导出，无法验证");
  if (typeof f === "function") {
    ok(f({ key: "images/a.jpg", webp: true }) === true, "本次会话转过的图应判为 WebP");
    ok(f({ key: "images/b.webp" }) === true, "后缀 .webp 应判为 WebP");
    ok(f({ key: "images/c.jpg", type: "image/webp" }) === true, "内容类型是 webp 时应判为 WebP（刷新后靠它）");
    ok(f({ key: "images/d.jpg", type: "image/jpeg" }) === false, "普通 JPG 不应判为 WebP");
    ok(f({ key: "images/e.jpg" }) === false, "无类型信息且非 .webp 时不应误判");
  }
}

/* ================= 五、别把压缩与转格式混在一起 ================= */
ok(/async function imgPoolCompressOne/.test(POOL), "压缩能力应保留（按 200K/100K/40K 目标）");
ok(/async function imgPoolWebpOne/.test(POOL), "转 WebP 应是独立能力，不能被压缩覆盖掉");

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
