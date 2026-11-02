/* ============================================================================
 * t_smart_upload_entry.js —— 智能打标「上传图片」入口回归（20261102D）
 *
 * 症状：智能打标弹窗里只剩「上传链接Excel」，没有上传图片的入口，想补图只能绕道。
 * 根因：20261030A 把批量上传从该弹窗摘掉（renderSmartUploadEntry 里直接 return），
 *       同时把类目下拉、上传按钮、进度条、文件输入从 admin.html 一起删了。
 *
 * 本测试锁死恢复后的完整链路：
 *   ① admin.html 里类目下拉 / 上传按钮 / 文件输入 / 进度条都在位
 *   ② renderSmartUploadEntry 不再提前 return，且入口卡会显示目标类目
 *   ③ 没选类目时点入口卡会被拦下并提示，不会静默传错类目
 *   ④ bindSmartUpload 绑定了文件输入与上传按钮
 *   ⑤ 上传前的授权/类目校验仍然在（不是把闸门一起拆了）
 *   ⑥ 样式补齐（控件组 / 类目下拉 / 进度条）
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✓ " + n); };
const no = (n, d) => { fail++; console.log("  ✗ " + n + (d ? " — " + d : "")); };

const R = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(R, "admin.html"), "utf8");
const js = fs.readFileSync(path.join(R, "js/admin-smart.js"), "utf8");
const css = fs.readFileSync(path.join(R, "css/style.css"), "utf8");

/* ---------- ① 控件在位 ---------- */
[["smart-cat", "类目下拉"], ["smart-upload-btn", "上传按钮"], ["smart-file", "文件输入"],
 ["smart-progress", "进度条容器"], ["smart-progress-bar", "进度条本体"]].forEach(([id, name]) => {
  if (new RegExp('id="' + id + '"').test(html)) ok("admin.html 有" + name + "（#" + id + "）");
  else no("admin.html 缺少" + name);
});

/* 控件必须落在「未打该标签」池头里，而不是别处的同名元素 */
const undonePool = (html.match(/id="smart-pool-undone"[\s\S]*?<\/div>\s*<\/div>/) || [""])[0];
if (/id="smart-cat"/.test(undonePool) && /id="smart-upload-btn"/.test(undonePool)) {
  ok("上传控件位于「未打该标签」池头");
} else no("上传控件不在右池池头");

const fileInput = (html.match(/<input[^>]*id="smart-file"[^>]*>/) || [""])[0];
if (/type="file"/.test(fileInput) && /accept="image\/\*"/.test(fileInput)) ok("文件输入限定图片类型");
else no("文件输入类型不对", fileInput);
if (/multiple/.test(fileInput)) ok("支持一次多选图片");
else no("文件输入不支持多选");

/* ---------- ② 入口卡恢复 ---------- */
const seg = js.slice(js.indexOf("function renderSmartUploadEntry"), js.indexOf("async function doSmartUpload"));
if (!seg) { no("找不到 renderSmartUploadEntry"); }
else {
  /* 早期版本这里是一句裸 return，把整段逻辑短路掉 */
  const bareReturn = /\n\s{0,6}return;\s*\n/.test(seg.replace(/\/\*[\s\S]*?\*\//g, ""));
  if (!bareReturn) ok("renderSmartUploadEntry 不再提前 return");
  else no("入口仍被提前 return 短路");
  if (/smart-up-entry/.test(seg) && /insertBefore/.test(seg)) ok("会把「上传图片」卡片插到右池首位");
  else no("没有插入上传入口卡");
  if (/目标类目/.test(seg)) ok("入口卡显示目标类目");
  else no("入口卡没写明传到哪个类目");
  if (/请先在右池上方选择/.test(seg)) ok("未选类目时点卡片会提示，不静默上传");
  else no("未选类目时没有拦截提示");
}

/* ---------- ③ 绑定 ---------- */
const bindSeg = js.slice(js.indexOf("function bindSmartUpload"), js.indexOf("function smartUrlMatch"));
if (/#smart-file/.test(bindSeg) && /onchange/.test(bindSeg)) ok("bindSmartUpload 绑定了文件输入 onchange");
else no("文件输入没绑定");
if (/#smart-upload-btn/.test(bindSeg) && /doSmartUpload/.test(bindSeg)) ok("bindSmartUpload 绑定了上传按钮");
else no("上传按钮没绑定");
if (/fillSmartCat/.test(bindSeg)) ok("打开面板会填充类目下拉");
else no("类目下拉没填充，上传会永远被拦");

/* ---------- ④ 闸门仍在 ---------- */
if (/if \(!cat\) \{ sbToast\("请先选择上传类目/.test(js)) ok("上传前仍校验类目");
else no("类目校验被拆掉了");
if (/myZonePermissions\("visual"\)/.test(js)) ok("上传前仍校验类目授权");
else no("类目授权校验被拆掉了");
if (/只有管理员可上传/.test(js)) ok("上传前仍校验管理员身份");
else no("身份校验被拆掉了");

/* ---------- ⑤ 样式 ---------- */
[".smart-up-ctl", ".smart-cat-sel", ".smart-progress", ".smart-up-entry"].forEach((sel) => {
  if (css.indexOf(sel) >= 0) ok("样式含 " + sel);
  else no("样式缺 " + sel);
});

/* ---------- ⑥ 其他入口没被误伤 ---------- */
if (/id="smart-urlmatch-btn"/.test(html)) ok("「上传链接Excel」按钮仍在");
else no("上传链接Excel 按钮丢了");
if (/id="smart-select-all"/.test(undonePool)) ok("「全选本池打标」仍在");
else no("批量打标按钮丢了");

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
