/* 20261114Y · 权限分层：管理员=图片编辑，超管=打标数据
 *
 * 需求原文：
 *   「管理员只有图片编辑的权限，超管才有管理打标数据的权限。」
 *
 * 划界口径（本套用例的验收标准）：
 *   · 管理员（图片编辑）可以：上传 / 删除自己的图、给图打标与去标、批量打标、
 *     导出打标表、以「补齐空白」回填打标结果。
 *   · 超管（打标数据）才能：标签字典增删改（含智能打标里的新增图册 / 改名 / 删图册）、
 *     标签维度前台开关、图案印花款开关、前台类目与常用类目、新增类目、
 *     以及「覆盖同名列 / 空单元格清空」这类会改写既有打标数据的回填与批次撤回。
 *
 * 除了「界面藏起来」，还必须「函数本身挡住」——只藏菜单的话，控制台一句调用就能绕过。
 * 因此本套用例既查 HTML 的可见性标记，也把守卫函数抽出来真跑一遍两种角色。
 */
import fs from "fs";
import vm from "vm";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

const read = (f) => fs.readFileSync(f, "utf8");
const ADMIN = read("js/admin.js");
const IMG = read("js/admin-images.js");
const SMART = read("js/admin-smart.js");
const RIMPORT = read("js/admin-rankimport.js");
const RANK = read("js/admin-rank.js");
const RHYTHM = read("js/admin-rhythm.js");
const TREND = read("js/admin-trend.js");
const HTML = read("admin.html");

/* 从源码里按大括号配平截出一段（拿真实代码来跑，避免「测试另写一份逻辑」） */
function sliceBlock(src, startMark) {
  const i = src.indexOf(startMark);
  if (i < 0) throw new Error("找不到片段的起点：" + startMark);
  let depth = 0, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

/* ================= 一、真跑 isSuper / isTagSuper / guardTagData ================= */
function loadGuards(role, opts) {
  const o = opts || {};
  const toasts = [];
  const superFn = (ADMIN.match(/const isSuper = \(\) =>[^\n]*/) || [""])[0];
  const tagSuper = sliceBlock(ADMIN, "const isTagSuper = () =>");
  const guard = sliceBlock(ADMIN, "function guardTagData(msg)");
  const ctx = {
    currentRole: role,
    window: {
      isSuper: o.windowSuper ? () => true : undefined,
      UO: o.uoSuper ? { isSuper: () => true } : undefined,
    },
    sbToast: (m, good) => toasts.push({ m, good }),
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(superFn + "\n" + tagSuper + "\n" + guard + "\nthis.__t = { isSuper, isTagSuper, guardTagData };", ctx);
  return { t: ctx.__t, toasts };
}

{
  const sup = loadGuards("super_admin").t;
  ok(sup.isTagSuper() === true, "超管：isTagSuper 应为 true");
  ok(sup.guardTagData("x") === true, "超管：guardTagData 应放行");

  const adm = loadGuards("admin");
  ok(adm.t.isSuper() === false, "管理员：isSuper 应为 false");
  ok(adm.t.isTagSuper() === false, "管理员：isTagSuper 应为 false");
  ok(adm.t.guardTagData("无权限：测试") === false, "管理员：guardTagData 应拦截");
  ok(adm.toasts.length === 1 && adm.toasts[0].good === false, "拦截时必须弹出失败提示");
  ok(/无权限/.test(adm.toasts[0].m), "拦截提示应写明无权限");

  const vis = loadGuards("visitor");
  ok(vis.t.isTagSuper() === false, "访客：isTagSuper 应为 false");
  ok(vis.t.guardTagData(null) === false, "访客：guardTagData 应拦截");
  ok(/超级管理员/.test(vis.toasts[0].m), "默认提示应说明「只有超级管理员可管理」");

  /* 角色名以外还有两处也视为超管（上传归属模块 / 前台偏好），否则会出现「一边放开一边收紧」 */
  ok(loadGuards("admin", { windowSuper: true }).t.isTagSuper() === true, "window.isSuper() 为真时应视为超管");
  ok(loadGuards("admin", { uoSuper: true }).t.isTagSuper() === true, "归属模块判为超管时应视为超管");
  ok(loadGuards("visitor").t.isTagSuper() === false, "不得因取不到角色而误放行");
}

/* ================= 二、面板可访问性：标签管理对管理员关闭 ================= */
function loadCanAccess(role, zones) {
  const panelZone = "const PANEL_ZONE = " + sliceBlock(ADMIN, "const PANEL_ZONE = {").replace(/^const PANEL_ZONE = /, "") + ";";
  const isSuper = (ADMIN.match(/const isSuper = \(\) =>[^\n]*/) || [""])[0];
  const can = sliceBlock(ADMIN, "function canAccessPanel(target)");
  const ctx = { currentRole: role, currentZones: zones || null, window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(panelZone + "\n" + isSuper + "\n" + can + "\nthis.__c = canAccessPanel;", ctx);
  return ctx.__c;
}
{
  ok(/PANEL_ZONE = \{[\s\S]*?"tag-card": "super"/.test(ADMIN), "标签管理面板应归入超管专区（tag-card → super）");
  const adm = loadCanAccess("admin", null);
  ok(adm("tag-card") === false, "管理员不得进入标签管理面板");
  ok(adm("manage-card") === true, "管理员仍可进入图片管理（图片编辑权限）");
  ok(adm("rank-card") === true, "管理员仍可进入趋势上升榜（上传 / 导出 / 补空白回填）");
  ok(adm("rhythm-card") === true, "管理员仍可进入上新节奏");
  ok(adm("pinterest-card") === true, "管理员仍可进入 P 专区");
  const sup = loadCanAccess("super_admin", null);
  ok(sup("tag-card") === true, "超管可进入标签管理面板");
  const vis = loadCanAccess("visitor", null);
  ok(vis("tag-card") === false && vis("manage-card") === false, "访客一律进不去");
}

/* ================= 三、界面侧：超管专属区块的标记 ================= */
{
  const seg = (id, len) => { const i = HTML.indexOf(id); return i < 0 ? "" : HTML.slice(i, i + len); };
  ok(/data-super="1"[\s\S]{0,200}rank-tag-clear-empty/.test(HTML), "趋势上升榜：覆盖模式「空单元格清空」应仅超管可见");
  ok(/<section class="rkadm-sec" data-super="1">\s*<h4>③ 批次与撤回/.test(HTML), "趋势上升榜：批次与撤回区块应仅超管可见");
  ok(/data-super="1"[\s\S]{0,200}rm-tag-imp-clear-empty/.test(HTML), "上新节奏：覆盖模式「空单元格清空」应仅超管可见");
  ok(/id="smart-album-add"[^>]*data-super="1"/.test(HTML), "智能打标：新增图册（写标签字典）应仅超管可见");
  ok(/id="rank-cat-add"[^>]*data-super="1"/.test(HTML), "趋势上升榜：自定义添加类目应仅超管可见");
  ok(/id="rm-cat-add"[^>]*data-super="1"/.test(HTML), "上新节奏：自定义添加类目应仅超管可见");
  ok(/标签管理[\s\S]{0,120}仅超级管理员/.test(HTML), "标签管理面板标题应写明仅超管");
  /* 智能打标弹层在 #admin-panel 之外，data-super 扫描够不到，必须单独处理 */
  ok(/#smart-modal \[data-super='1'\], #smart-tagmgr-btn/.test(ADMIN), "智能打标弹层内的超管专属按钮需单独收敛");
  ok(/n\.classList\.toggle\("hidden", !isSuper\(\)\);\s*\}\);\s*applyTagPermUI\(\);/.test(ADMIN), "角色就绪后应刷新打标数据权限的界面表现");
}

/* ================= 四、写入口的守卫（逐个点名，缺一个就是漏洞） ================= */
{
  const guarded = [
    ["标签新增", IMG, "async function addTagDef(type, input, groupSelect) {"],
    ["标签删除", IMG, "async function deleteTagDef(def, type, used) {"],
    ["标签重命名", IMG, "async function renameTagDef(d, type, used) {"],
    ["前台类目保存", IMG, "async function saveCatMgmt() {"],
    ["常用类目保存", IMG, "async function saveFavCats() {"],
    ["前台类目顺序保存", ADMIN, "async function saveCatOrder() {"],
    ["标签维度前台开关", IMG, "row.onclick = async () => {\n        /* 20261114Y"],
    ["图案印花款开关", IMG, "row.onclick = async () => {\n    /* 20261114Y"],
    ["智能打标新增图册", SMART, "async function smartAddAlbum() {"],
    ["智能打标标签改名", SMART, "async function smartRenameTag(tag) {"],
    ["智能打标删除图册", SMART, "async function smartDeleteAlbum(tag) {"],
    ["专区新增类目（品牌动向）", TREND, "async function customAddCategory() {"],
    ["专区新增类目（品牌动向·编辑）", TREND, "async function customAddTrendEditCategory() {"],
  ];
  guarded.forEach(([name, src, mark]) => {
    const i = src.indexOf(mark);
    ok(i >= 0, name + "：应能找到该写入口");
    if (i < 0) return;
    const body = src.slice(i, i + 700);
    ok(/isTagSuper|guardTagData/.test(body), name + "：必须带超管校验（只藏界面不算）");
  });

  /* 智能打标的「✎（改标签名）」入口：管理员侧不渲染 */
  ok(/function tagEditAllowed\(\)/.test(SMART), "应提供标签编辑入口的角色判定");
  ok((SMART.match(/smartDim !== "channel" && tagEditAllowed\(\)/g) || []).length === 2,
    "标签栏与图册栏的「✎」都应对管理员隐藏");

  /* 三个「新增类目」按钮的点击处理（趋势上升榜 / 上新节奏） */
  ["js/admin-rank.js", "js/admin-rhythm.js"].forEach((f, idx) => {
    const s = idx === 0 ? RANK : RHYTHM;
    ok(/catAdd\.onclick = async \(\) => \{[\s\S]{0,300}isTagSuper/.test(s), "新增类目按钮（" + f + "）必须带超管校验");
  });
}

/* ================= 五、回填：管理员只能「补齐空白」 ================= */
{
  ok(/isTagSuper\(\) && \(gateOpts\.mode === "overwrite" \|\| gateOpts\.clearEmpty\)/.test(RIMPORT)
    || /!isTagSuper\(\) && \(gateOpts\.mode === "overwrite" \|\| gateOpts\.clearEmpty\)/.test(RIMPORT),
    "doImport：非超管的「覆盖 / 清空」必须拦下");
  ok(/mode === "overwrite" \|\| clearEmpty\) && !isTagSuper\(\)/.test(RIMPORT),
    "共用导入入口 importFile：非超管的「覆盖 / 清空」必须抛错（各面板共用这一层）");
  ok(/undo\.disabled = true; undo\.title = "仅超级管理员可撤回打标批次"/.test(RIMPORT),
    "批次撤回：非超管应不可点");
  ok(/if \(!isTagSuper\(\)\) \{ denyTagData\("无权限：撤回打标批次只有超级管理员可操作"\); return; \}/.test(RIMPORT),
    "批次撤回：点击时再挡一层");
  /* 反过来确认「没被误伤」：补齐模式对管理员是允许的 */
  ok(/gateOpts\.mode === "overwrite" \|\| gateOpts\.clearEmpty/.test(RIMPORT),
    "复核：只有 覆盖 / 清空 被拦，补齐空白对管理员放行");
  ok(!/doImport[\s\S]{0,400}!isAdmin\(\)/.test(RIMPORT), "不得用 isAdmin 一刀切（那会连补空白也禁掉）");
}

/* ================= 六、管理员仍能做的图片编辑能力（不能被误伤） ================= */
{
  ok(!/async function applyTags[\s\S]{0,400}isTagSuper/.test(IMG), "给图打标 / 去标不应被超管校验拦住");
  ok(!/async function batchDelete[\s\S]{0,400}isTagSuper/.test(IMG), "删除图片不应被超管校验拦住");
  ok(!/async function doUpload[\s\S]{0,400}isTagSuper/.test(IMG), "上传图片不应被超管校验拦住");
  ok(!/function openTagModal[\s\S]{0,400}isTagSuper/.test(IMG), "打标弹层本身应照常打开");
  ok(/if \(isSuper\(\)\) \{ loadFavCats\(\); loadCatMgmt\(\); loadTagDefs\(\); \}/.test(ADMIN),
    "进后台时：常用类目 / 前台类目 / 标签字典只给超管预载（管理员不白拉请求）");
}

/* ================= 七、真跑 applyTagPermUI（假 DOM） ================= */
function mkDom() {
  const mk = (tag, props) => {
    const el = {
      tagName: tag, id: "", className: "", style: {}, disabled: false, textContent: "", value: "",
      children: [], parentNode: null, nextSibling: null,
      appendChild(c) { c.parentNode = el; el.children.push(c); c.nextSibling = null; return c; },
      insertBefore(c, ref) { c.parentNode = el; el.children.push(c); c.nextSibling = ref || null; return c; },
      remove() { if (el.parentNode) el.parentNode.children = el.parentNode.children.filter(x => x !== el); },
      closest() { return props && props.closest || null; },
      querySelector(sel) { return (el.children || []).find(c => sel.indexOf('option[value="overwrite"]') >= 0 && c.tagName === "option") || null; },
      querySelectorAll() { return []; },
    };
    return Object.assign(el, props || {});
  };
  const modeBox = mk("select");
  const overwrite = mk("option", { textContent: "覆盖同名列（改错用：填什么写什么）", disabled: false });
  overwrite.value = "overwrite";
  modeBox.appendChild(overwrite);
  modeBox.value = "overwrite";
  const body = mk("body");
  const grid = mk("div"); grid.className = "rank-grid";
  const parent = mk("section");
  body.appendChild(parent);
  parent.appendChild(grid);
  modeBox.parentNode = grid;
  grid.appendChild(modeBox);
  /* 真实 DOM 里 select 在 .rank-grid 内，closest 会命中那一层 */
  modeBox.closest = (sel) => (sel === ".rank-grid" ? grid : null);
  const registry = { "#rank-tag-mode": modeBox };
  const doc = {
    querySelector: (sel) => registry[sel] || null,
    getElementById: (id) => {
      const found = parent.children.find(c => c.id === id) || null;
      return found;
    },
    createElement: (t) => mk(t),
  };
  return { doc, modeBox, overwrite, parent, grid };
}

function runApply(role) {
  const dom = mkDom();
  const fn = sliceBlock(ADMIN, "function applyTagPermUI()");
  const isSuper = (ADMIN.match(/const isSuper = \(\) =>[^\n]*/) || [""])[0];
  const ctx = { document: dom.doc, currentRole: role, window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(isSuper + "\n" + fn + "\nthis.__a = applyTagPermUI;", ctx);
  ctx.__a();
  const hint = dom.parent.children.find(c => c.id === "rank-tag-perm-hint") || null;
  return { dom, hint };
}
{
  const adm = runApply("admin");
  ok(adm.dom.overwrite.disabled === true, "管理员侧：「覆盖同名列」应被禁用");
  ok(/仅超级管理员/.test(adm.dom.overwrite.textContent), "管理员侧：被禁用的选项应写明原因");
  ok(adm.dom.modeBox.value === "fill", "管理员侧：若当前停在覆盖，应回落到补齐空白");
  ok(!!adm.hint, "管理员侧：应出现「只能补齐空白」的说明条");
  ok(/补齐空白/.test(adm.hint.textContent), "说明条应讲清可用的模式");

  const sup = runApply("super_admin");
  ok(sup.dom.overwrite.disabled === false, "超管侧：「覆盖同名列」应可用");
  ok(/覆盖同名列（改错用：填什么写什么）/.test(sup.dom.overwrite.textContent), "超管侧：选项文案应恢复完整");
  ok(sup.dom.modeBox.value === "overwrite", "超管侧：不应改动用户已选的模式");
  ok(!sup.hint, "超管侧：不应出现管理员提示条");
}

/* ================= 八、版本戳一致性 ================= */
{
  const V = "20261115E";
  const files = ["index.html", "admin.html", "rank.html", "rhythm.html", "compare.html", "shein.html", "pinterest.html", "tiktok.html", "fav.html", "trends.html", "movement.html", "marketing.html"];
  const bad = files.filter(f => {
    const s = read(f);
    const refs = s.match(/\.js\?v=20\d{6}[A-Z]/g) || [];
    return refs.some(r => r.indexOf(V) < 0);
  });
  ok(bad.length === 0, "所有页面引用的脚本版本应统一为 " + V + "（发现：" + bad.join(",") + "）");
  const builds = ["js/rank.js", "js/rhythm.js", "js/view-export.js", "js/upload-dash.js", "js/page-shot.js"];
  ok(builds.every(f => read(f).includes('BUILD = "' + V + '"')), "各脚本内 BUILD 常量应统一为 " + V);
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
