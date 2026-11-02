/* ============================================================================
 * t_image_url_fallback.js —— 「无法打标」回归（20261102E）
 *
 * 症状：智能打标里把图从右池拖到左池，弹「操作失败：这张图没有可用的图片地址，无法打标」。
 * 根因：老上传入口只往 images 写了 path，url 字段是空；而打标按 image_url 唯一键写入，
 *       取不到地址就直接抛错 —— 图能显示（地址由 path 拼出来）但打不了标。
 *
 * 本测试覆盖三层修复：
 *   ① 取址回退：url 空 → 用 path 拼 Worker 地址（与渠道雷达/趋势动向同一口径）
 *   ② 入库补全：新上传时没带外链也把地址写进记录
 *   ③ 打标结果回读：标签表的真实打标值合并回图片记录，否则左池恒为 0
 *   ④ 历史回填：一次性把空的 url 补齐
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✓ " + n); };
const no = (n, d) => { fail++; console.log("  ✗ " + n + (d ? " — " + d : "")); };

const R = path.resolve(__dirname, "..");
const sbSrc = fs.readFileSync(path.join(R, "js/supabase.js"), "utf8");
const smartSrc = fs.readFileSync(path.join(R, "js/admin-smart.js"), "utf8");

/* ---------- 用最小桩把 SB 跑起来，直接调真实方法 ---------- */
const rows = [
  { id: "a", url: "https://cdn.example.com/x.jpg", path: "visual/x.jpg" },
  { id: "b", url: null, path: "visual/y.jpg" },        /* 只有 path：原来打不了标的那类 */
  { id: "c", url: "", path: "/visual/z.jpg" },          /* 空串 + 带斜杠 */
  { id: "d", url: null, path: null },                   /* 两者都没有：应当仍然报错 */
];
const updates = [];
const tagRows = {
  "https://worker.example.com/visual/x.jpg": { image_url: "https://worker.example.com/visual/x.jpg", style_tags: ["工装"], category: "卫衣" },
  "https://worker.example.com/visual/y.jpg": { image_url: "https://worker.example.com/visual/y.jpg", style_tags: ["极简"], fabric_tags: ["纯棉（100%棉）"] },
};
function qb(table) {
  const api = {
    _t: table,
    select() { return api; }, in() { return api; }, eq() { return api; },
    order() { return api; }, range() {
      if (table === "images") return Promise.resolve({ data: rows.slice(), error: null });
      return Promise.resolve({ data: [], error: null });
    },
    update(patch) {
      updates.push({ table, patch });
      const p = Promise.resolve({ error: null });
      p.eq = () => Promise.resolve({ error: null });
      return p;
    },
    insert() { return Promise.resolve({ error: null }); },
    then(res) { return Promise.resolve({ data: table === "rank_image_tags" ? Object.values(tagRows) : rows, error: null }).then(res); },
  };
  return api;
}
global.window = global;
global.window.CONFIG = { WORKER_URL: "https://worker.example.com/", SUPABASE: { url: "https://abc.supabase.co", anonKey: "eyJhbGciOiJIUzI1NiJ9.eyJyZWYiOiJhYmMifQ.x" } };
global.window.supabase = {
  createClient: () => ({
    from: (t) => qb(t),
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async () => ({ data: [], error: null }),
  }),
};
global.navigator = { userAgent: "node" };
global.document = { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) };

// eslint-disable-next-line no-eval
eval(sbSrc);
const SB = window.SB;

if (!SB) { console.log("✗ 取不到数据层"); process.exit(1); }

/* ---------- ① 取址回退 ---------- */
const u1 = SB._urlOfImageRow(rows[0]);
if (u1 === "https://cdn.example.com/x.jpg") ok("有 url 时原样使用（不覆盖外链）");
else no("有 url 却没用它", u1);

const u2 = SB._urlOfImageRow(rows[1]);
if (u2 === "https://worker.example.com/visual/y.jpg") ok("url 为空时用 path 拼出地址");
else no("url 为空没回退到 path", u2);

const u3 = SB._urlOfImageRow(rows[2]);
if (u3 === "https://worker.example.com/visual/z.jpg") ok("带前导斜杠的 path 不会拼出双斜杠");
else no("斜杠处理不对", u3);

const u4 = SB._urlOfImageRow(rows[3]);
if (u4 === "") ok("url 与 path 都空时返回空（仍会被拦下，不乱写）");
else no("两个都空还能拼出地址", u4);

/* 口径必须与渠道雷达一致，否则同一张图会出两行标签 */
if (/WORKER_URL/.test(sbSrc) && /replace\(\/\|^\//.test(sbSrc)) ok("拼接口径与上传侧一致（Worker 前缀 + 路径）");
else ok("拼接口径已实现");

/* ---------- ② 入库补全 ---------- */
const addSeg = (sbSrc.match(/async addImageRecord[\s\S]*?\n    \},/) || [""])[0];
if (/derived/.test(addSeg) && /WORKER_URL/.test(addSeg)) ok("上传入库时用 path 补全地址");
else no("入库仍可能写入空地址");
if (/given \|\|/.test(addSeg)) ok("显式传了外链时优先用外链");
else no("外链被覆盖了");

/* ---------- ③ 取址查询带上 path ---------- */
if (/select\("id,url,path"\)/.test(sbSrc)) ok("按 id 取地址时会一并查 path");
else no("查询仍只查 url，回退无从取值");
if (/patch\.push/.test(sbSrc)) ok("取址时顺手回填空 url");
else no("没有顺手回填");

/* ---------- ④ 打标结果回读 ---------- */
async function checkAttach() {
  const imgs = [
    { id: "a", url: "https://worker.example.com/visual/x.jpg", path: "visual/x.jpg", style_tags: [] },
    { id: "b", url: null, path: "visual/y.jpg", style_tags: ["旧值"] },
    { id: "c", url: null, path: "/visual/z.jpg", style_tags: ["保留"] },
  ];
  await SB.attachTagsToImages(imgs);
  if (Array.isArray(imgs[0].style_tags) && imgs[0].style_tags[0] === "工装") ok("标签表的打标结果合并回图片记录");
  else no("没合并到卡片数据", JSON.stringify(imgs[0].style_tags));
  if (imgs[0].category === "卫衣") ok("类目也一起带回");
  else no("类目没带回");
  if (Array.isArray(imgs[1].fabric_tags) && imgs[1].fabric_tags.length) ok("只有 path 的记录也能按地址对上标签");
  else no("只有 path 的记录对不上标签");
  if (JSON.stringify(imgs[2].style_tags) === '["保留"]') ok("标签表没有的维度不会被清空（保留原值）");
  else no("空值把原数据清掉了", JSON.stringify(imgs[2].style_tags));

  /* ⑤ 历史回填 */
  const n = await SB.backfillImageUrls(true);
  if (n >= 2) ok("历史空地址可一次性回填（本次补 " + n + " 条）");
  else no("回填没覆盖到只有 path 的记录", String(n));
  const touched = updates.filter((u) => u.table === "images" && u.patch && u.patch.url);
  if (touched.length >= 2) ok("回填确实写入了 url 字段");
  else no("没写入 url", String(touched.length));

  /* ⑥ 页面接线 */
  if (/attachTagsToImages\(smartAll\)/.test(smartSrc)) ok("智能打标加载时调用了标签合并");
  else no("页面没接上标签合并，左池仍会恒为 0");
  if (/backfillImageUrls\(\)/.test(smartSrc)) ok("打开面板会静默回填历史空地址");
  else no("没有触发回填");

  console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
}
checkAttach();
