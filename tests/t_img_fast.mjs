/* 20261116B · 「图片加载太慢」自检
 *
 * 现象：从前台 / 后台打开 P、S、T 专区、渠道对比，图要等很久才出来；
 *       关掉页面再进又要重新等一遍。
 *
 * 根因与对策（本文件逐条断言）：
 *   ① 卡片只有 70~220px，下的却是整张原图（约 200KB）→ 卡片图改走 ?w=340 缩略图（约 20KB）；
 *      原图地址留在 data-full，看大图 / 导出 / 搜同款仍用原图。
 *   ② 图片缓存只有 1 小时 → 原图 1 天、缩略图一年（文件名带时间戳，内容不会变）。
 *   ③ 视觉专区只 4 路并行、预取窗口 300px、且 fetch 带 cache:"no-store"（每次回源）
 *      → 8 路并行、预取 700px、允许命中缓存。
 *   ④ 一堆懒加载图一起抢带宽 → 懒加载图统一 fetchpriority="low"，并提前 preconnect。
 *
 * 反向用例：把「缩略图」换回整张原图、把「一年缓存」改回 1 小时、
 *          把「cache default」改回 no-store，本文件都必须报错。
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

const FAST = read("js/imgfast.js");
const SB = read("js/supabase.js");
const W = read("worker/worker.js");

console.log("【1】图片加速模块本身");
{
  ok(/window\.imgThumb\s*=/.test(FAST), "提供 imgThumb()：卡片图取缩略图地址");
  ok(/window\.imgThumbOf\s*=/.test(FAST), "提供 imgThumbOf()：已经是完整地址时也能加缩略参数");
  ok(/window\.imgFull\s*=/.test(FAST), "提供 imgFull()：去掉缩略参数拿回原图");
  ok(/window\.imgSrc\s*=/.test(FAST), "统一接管 window.imgSrc（本站图带令牌、外链原样）");
  ok(/TOKEN_TTL/.test(FAST) && /scanStorage|scanToken/.test(FAST), "令牌记忆 60 秒，不再每个 <img> 扫一遍 localStorage");
  ok(/rel\s*=\s*"preconnect"/.test(FAST), "提前与图片服务 preconnect，省掉首次握手");
  ok(/MutationObserver/.test(FAST), "后插入的图（翻页 / 切筛选 / 无限滚动）也会被接管");
  ok(/fetchpriority/.test(FAST) && /"low"/.test(FAST), "懒加载图让出带宽（fetchpriority=low）");
  ok(/data-full/.test(FAST), "缩略图元素保留 data-full 原图地址");
  ok(/stripThumb\(cur\)/.test(FAST), "缩略图取不到时自动回退原图（不会留灰底）");
  /* 反向：缩略参数必须是 w= + q=，否则图片服务认不出 */
  ok(/keep\.push\("w=" \+ width\)/.test(FAST) && /keep\.push\("q=" \+ THUMB_Q\)/.test(FAST),
    "缩略参数形如 ?w=340&q=76（按参数表增删，不会拼出 ?&）");
  ok(/function splitQuery\(/.test(FAST), "地址参数按参数表处理，去掉参数不留尾巴");
}

console.log("【2】每个页面都接入了这个模块");
{
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  const nav = pages.filter((f) => read(f).includes('js/common.js') || read(f).includes('js/config.js'));
  let miss = [];
  for (const f of nav) {
    const s = read(f);
    if (!s.includes("js/imgfast.js")) miss.push(f);
  }
  ok(miss.length === 0, "所有页面都引入了图片加速脚本" + (miss.length ? "，缺：" + miss.join(",") : ""));
  ok(read("admin.html").includes("js/imgfast.js"), "后台也接入了（后台图墙同样受益）");
}

console.log("【3】上传时顺手生成缩略图");
{
  ok(/async function makeThumb\(/.test(SB), "有 makeThumb()：340px WebP");
  ok(/fd\.append\("thumb"/.test(SB), "上传时把缩略图一起提交，不多一次往返");
  ok(/async saveThumb\(/.test(SB), "提供 saveThumb()：存量老图回填用");
  ok(/\/admin\/thumb\?path=/.test(SB), "回填走 /admin/thumb 接口");
  ok(/canvas\.toBlob\(resolve, "image\/webp"/.test(SB), "缩略图编码为 WebP");
  ok(/blob\.size >= file\.size\) return null/.test(SB), "原图本来就比缩略图小时不多存一份");
}

console.log("【4】图片服务：缩略图落盘与读取");
{
  ok(/function thumbKeyOf\(/.test(W), "有 thumbKeyOf()：thumbs/<原路径去扩展名>.webp");
  ok(/return "thumbs\/" \+ dir \+ name \+ "\.webp"/.test(W), "缩略图放在 thumbs/ 前缀下（不污染图片池清单）");
  ok(/if \(url\.searchParams\.get\("w"\)\)/.test(W), "读图时识别 ?w= 参数");
  ok(/object = await env\.IMAGES\.get\(tk\)/.test(W), "先取缩略图");
  ok(/if \(!object\) object = await getObject\(path, rawPath\)/.test(W), "取不到缩略图自动回退原图（一次请求，不失败）");
  ok(/isThumb \? "public, max-age=31536000, immutable"/.test(W), "缩略图一年缓存 + immutable");
  ok(/isThumb \? "image\/webp"/.test(W), "缩略图按 WebP 返回");
  ok(/path === "admin\/thumb"/.test(W), "有 /admin/thumb 接口（回填老图）");
  ok(/const thumb = form\.get\("thumb"\)/.test(W), "/upload 会一并保存缩略图");
  ok(/缩略图失败不阻断|catch \(e\) \{ \/\* 缩略图失败不阻断 \*\//.test(W), "缩略图存失败不影响图片上传本身");
  /* 反向：缓存别退回去 */
  ok(!/"public, max-age=3600"/.test(W), "旧的 1 小时缓存已不存在（回退必须报错）");
}

console.log("【5】各专区卡片都改成缩略图");
{
  const cases = [
    ["js/compare-front.js", /esc\(thumbOf\(it\.image_url\)\)/, "渠道对比"],
    ["js/channel-zone-front.js", /esc\(thumbOf\(it\.image_url\)\)/, "S / P / T 专区"],
    ["js/movement-front.js", /esc\(thumbUrl\(it\)\)/, "品牌动向"],
    ["js/rank.js", /esc\(thumbOf\(it\.image_url\)\)/, "趋势上升榜"],
    ["js/rhythm.js", /esc\(thumbOf\(it\.image_url\)\)/, "上新节奏"],
    ["js/fav.js", /esc\(fvThumb\(showUrl\)\)/, "我的收藏"],
    ["js/admin-channelzone.js", /esc\(adminThumb\(r\.image_url\)\)/, "后台 S / P / T"],
    ["js/admin-movement.js", /esc\(adminThumb\(r\.image_url\)\)/, "后台品牌动向"],
  ];
  for (const [f, re, name] of cases) {
    const s = read(f);
    ok(re.test(s), name + " 卡片图改走缩略图");
    ok(s.includes("data-full"), name + " 卡片保留 data-full 原图地址");
  }
  const fe = read("js/frontend.js");
  ok(/window\.imgThumbOf \? window\.imgThumbOf\(fullSrc\)/.test(fe), "视觉专区卡片图改走缩略图");
  ok(/imgEl\.dataset\.full = fullSrc/.test(fe), "视觉专区卡片保留原图地址");
  /* 反向：老写法必须已经不存在 */
  ok(!/src="' \+ esc\(it\.image_url\) \+ '" alt="' \+ esc\(it\.category\)/.test(read("js/compare-front.js")),
    "渠道对比不再直接下原图");
}

console.log("【6】大图 / 导出 / 搜同款仍用原图");
{
  ok(/el\.getAttribute\("data-full"\) \|\| el\.currentSrc/.test(read("js/page-shot.js")), "导出高清图优先用 data-full 原图");
  const fs2 = read("js/find-similar.js");
  ok(/function imgFullSrc\(/.test(fs2), "搜同款统一取原图地址");
  ok(/var src = imgFullSrc\(im\);/.test(fs2), "搜同款扫描用原图地址");
  ok(/data-full/.test(read("js/favstar.js")), "收藏时保存原图地址（否则以后看大图是糊的）");
}

console.log("【7】视觉专区的懒加载参数");
{
  const fe = read("js/frontend.js");
  ok(/const LAZY_CONC = 8/.test(fe), "并发从 4 提到 8 路");
  ok(/rootMargin: "700px"/.test(fe), "预取窗口从 300px 提到 700px");
  ok(/cache: "default"/.test(fe), "允许命中 HTTP 缓存");
  /* 反向：别退回旧值 */
  ok(!/const LAZY_CONC = 4/.test(fe), "旧的 4 路并发已不存在");
  /* 取图那段（fetchImgBlob）里不许再出现 no-store；灯箱单张大图的兜底请求另有用途，不算在内 */
  const pump = fe.slice(fe.indexOf("async function fetchImgBlob"), fe.indexOf("function lazyPump"));
  ok(!/cache: "no-store"/.test(pump), "取图链路里不再有 no-store（每张回源）");
}

console.log("【8】后台存量图一键回填缩略图");
{
  const pool = read("js/admin-pool.js");
  ok(/async function imgPoolThumbBackfill/.test(pool), "有回填流程");
  ok(/async function thumbExists/.test(pool), "已有缩略图的会跳过（不重复生成）");
  ok(/it\.size <= 60 \* 1024/.test(pool), "原图本来就小的跳过");
  ok(/imgPoolThumbBackfill\)/.test(pool), "回填函数已挂到按钮上");
  ok(read("admin.html").includes('id="imgpool-thumb"'), "后台压缩池工具栏有「生成缩略图」按钮");
  ok(/im\.loading = "lazy"/.test(pool), "压缩池图墙不再 eager 全量下载");
}

console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
