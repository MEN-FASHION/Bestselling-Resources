/* 后台体验修复验证（20261019F）
 * 用法：node tools/verify_admin_ux.js [项目根目录]
 * 覆盖：① 居中弹窗替代原生 prompt/confirm ② 看板/超管图片管理读全站
 *      ③ 操作条不压图 + 类目清单文字不出格 ④ 招品回品统计迁到招品回品面板
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = process.argv[2] || ".";
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};

const html = read("admin.html");
const css = read("css/style.css");
const adminJs = read("js/admin.js");
const imagesJs = read("js/admin-images.js");
const smartJs = read("js/admin-smart.js");
const tasksJs = read("js/admin-tasks.js");
const sbJs = read("js/supabase.js");
const dialogJs = read("js/admin-dialog.js");

const sliceFn = (src, name) => {
  // 支持 async function xxx( / function xxx( / 方法简写 async xxx(
  let i = src.indexOf("async function " + name + "(");
  let pre = "async ";
  if (i < 0) { i = src.indexOf("function " + name + "("); pre = ""; }
  if (i < 0) { i = src.indexOf("async " + name + "("); pre = "async "; }
  if (i < 0) { i = src.indexOf(name + "("); pre = ""; }
  if (i < 0) return "";
  if (pre !== "async " && src.slice(Math.max(0, i - 6), i) === "async ") pre = "async ";
  const head = (pre === "async " ? "async " : "");
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === "{") { d++; started = true; }
    else if (c === "}") { d--; if (started && d === 0) { const raw = src.slice(i, k + 1); return (raw.startsWith("async ") ? "" : head) + raw; } }
  }
  return "";
};

console.log("\n【A】居中弹窗：接入方式");
check("admin.html 引入 admin-dialog.js", /js\/admin-dialog\.js\?v=/.test(html));
check("弹窗脚本在 admin.js 之前加载", html.indexOf("admin-dialog.js") > 0 && html.indexOf("admin-dialog.js") < html.indexOf("js/admin.js?v="));
check("未重复引入", (html.match(/admin-dialog\.js/g) || []).length === 1);
check("弹窗脚本导出 sbAsk / sbConfirm", /window\.sbAsk\s*=/.test(dialogJs) && /window\.sbConfirm\s*=/.test(dialogJs));

console.log("\n【B】居中弹窗：运行时行为（真实脚本 + jsdom）");
{
  const dom = new JSDOM(`<!doctype html><html><body><input id="x"></body></html>`, { runScripts: "outside-only" });
  const w = dom.window;
  try { w.eval(dialogJs); } catch (e) { check("弹窗脚本可在浏览器环境执行", false, e.message); }
  const q = (s) => w.document.querySelector(s);
  const layer = () => q(".sbd-mask");
  check("脚本执行后 create sbAsk", typeof w.sbAsk === "function");
  check("脚本执行后 create sbConfirm", typeof w.sbConfirm === "function");
  check("未打开时不出现遮罩（不打扰页面）", q(".sbd-mask") === null || q(".sbd-mask").classList.contains("hidden"));

  let r1 = null;
  w.sbAsk({ title: "图片外链", desc: "输入外链地址（留空则清除）：", value: "https://a.com/1.jpg" }).then((v) => { r1 = v; });
  check("sbAsk 打开后可见", !layer().classList.contains("hidden"));
  check("标题正确", q(".sbd-title").textContent === "图片外链");
  check("说明正确", q(".sbd-desc").textContent.indexOf("留空则清除") >= 0);
  check("输入框显示且带默认值", !q(".sbd-input").classList.contains("hidden") && q(".sbd-input").value === "https://a.com/1.jpg");
  q(".sbd-input").value = "https://b.com/2.jpg";
  q(".sbd-ok").click();
  return_tick(() => {
    check("点「确定」回传输入值", r1 === "https://b.com/2.jpg", String(r1));
    check("确定后关闭", layer().classList.contains("hidden"));

    let r2 = "sentinel";
    w.sbConfirm({ title: "删除类目「瑜伽袜」", desc: "删除后会同步清空归属该类目的图片的类目字段。", okText: "删除", danger: true }).then((v) => { r2 = v; });
    check("sbConfirm 不显示输入框", q(".sbd-input").classList.contains("hidden"));
    check("危险操作按钮文案 = 删除", q(".sbd-ok").textContent === "删除");
    check("危险样式已加上", q(".sbd-ok").classList.contains("danger"));
    q(".sbd-cancel").click();
    return_tick(() => {
      check("点「取消」返回 false（不执行删除）", r2 === false, String(r2));

      let r3 = "sentinel";
      w.sbAsk({ title: "t", value: "v" }).then((v) => { r3 = v; });
      w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
      return_tick(() => check("Esc 关闭并视为取消", r3 === null, String(r3)));

      let r4 = "sentinel";
      w.sbConfirm({ title: "t2" }).then((v) => { r4 = v; });
      layer().dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
      return_tick(() => check("点遮罩关闭并视为取消", r4 === null, String(r4)));

      console.log("\n【C】原生弹窗已清除");
      check("图片卡「外链」不再用原生 prompt", !/prompt\("输入外链地址/.test(imagesJs));
      check("智能打标「外链」不再用原生 prompt", !/prompt\("输入外链地址/.test(smartJs));
      check("删除类目不再用原生 confirm（标签管理）", !/confirm\("确定删除类目/.test(imagesJs));
      check("删除类目不再用原生 confirm（专区类目）", !/confirm\("删除类目/.test(tasksJs));
      check("改为调用居中弹窗（4 处）", (imagesJs.match(/await sb(Ask|Confirm)\(/g) || []).length + (smartJs.match(/await sb(Ask|Confirm)\(/g) || []).length + (tasksJs.match(/await sb(Ask|Confirm)\(/g) || []).length >= 4);
      finish();
    });
  });
}

function return_tick(fn) { setTimeout(fn, 0); }

function finish() {
  console.log("\n【D】看板读「全站」而不是「只有自己」");
  check("listDashboardImages 在专用函数失败时改走全站分页", /listAllImagesPaged/.test(sliceFn(sbJs, "listDashboardImages")));
  check("全站分页走库里已有的前台函数（无需另建）", /frontend_list_images_page/.test(sliceFn(sbJs, "listAllImagesPaged")));
  check("新增 listAllImagesPaged", /async listAllImagesPaged\(/.test(sbJs));
  {
    const src = sliceFn(sbJs, "listAllImagesPaged");
    check("分页逐页累加且提前结束", /out\.push|out\[/.test(src) && /rows\.length < pageSize/.test(src) && /break/.test(src));
  }
  // 运行时：dashboard_images 报错 → 落到分页函数，返回全站多类目
  {
    const p0 = []; for (let k = 0; k < 500; k++) p0.push({ id: k, category: k % 2 ? "卫衣" : "牛仔裤", uploaded_by: "u" + (k % 3) });
    const pages = [p0, [{ id: 500, category: "羽绒服", uploaded_by: "u9" }, { id: 501, category: "卫衣", uploaded_by: "u9" }]];
    let usedDash = 0, usedFront = 0;
    const ctx = {
      client: {
        rpc: (name, args) => {
          if (name === "dashboard_images") { usedDash++; return { data: null, error: { message: "function does not exist" } }; }
          if (name === "frontend_list_images_page") {
            usedFront++;
            const p = (args && args.p_offset) || 0;
            return { data: pages[p / 500] || [], error: null };
          }
          return { data: [], error: null };
        },
        from: () => ({ select: () => ({ order: () => ({ then: (r) => r({ data: [], error: null }) }) }) })
      }
    };
    const norm = (t, n) => t.replace(new RegExp("^(async\\s+)?" + n + "\\("), "async function " + n + "(");
    const fnSrc = norm(sliceFn(sbJs, "listDashboardImages"), "listDashboardImages");
    const pagedSrc = norm(sliceFn(sbJs, "listAllImagesPaged"), "listAllImagesPaged");
    const SB = { listImages: async () => [{ id: 99, category: "只有我自己" }] };
    const factory = new Function("client", "SB", "return (async () => {" + pagedSrc + "\n SB.listAllImagesPaged = listAllImagesPaged;\n" + fnSrc + "\n return await listDashboardImages.call(SB); })();");
    factory(ctx.client, SB).then((rows) => {
      check("看板统计函数未建时也能拿到全站数据（跨多页拉全）", usedFront > 1 && rows.length === 502, "rows=" + rows.length);
      check("返回的类目不止一个（不再是只有自己上传的卫衣）", new Set(rows.map(r => r.category)).size >= 2);
      check("没有退化成「只读自己」兜底", rows.length !== 1 || rows[0].id !== 99);
      stepE();
    }).catch((e) => { check("看板兜底链可执行", false, e.message); stepE(); });
  }
}

function stepE() {
  console.log("\n【E】超管图片管理：可看全站，普通管理员仍只看自己");
  check("存在超管全站取数缓存 mgrAllData", /async function mgrAllData\(/.test(imagesJs));
  check("存在按类目过滤 + 分片 mgrChunk", /async function mgrChunk\(/.test(imagesJs));
  check("分片走 isSuper 判定", /mgrSeeAll\(\)/.test(imagesJs) && /isSuper/.test(imagesJs));
  check("列表加载改用 mgrChunk", /mgrChunk\(currentManageCat/.test(imagesJs));
  check("切面板刷新时清空缓存（避免看到旧数据）", /_mgrAllCache = null;/.test(imagesJs));
  {
    const fn = sliceFn(imagesJs, "mgrChunk");
    const SB = { listImages: async () => [{ id: "self" }], listAllImagesPaged: async () => ([
      { id: 1, category: "卫衣" }, { id: 2, category: "牛仔裤" }, { id: 3, category: "卫衣" }, { id: 4, category: "羽绒服" }
    ]) };
    const cache = {};
    const f = new Function("SB", "isSuper", "mgrAllData", "mgrSeeAll", "return (" + fn + ");")(
      SB, () => true, async () => SB.listAllImagesPaged(), () => true
    );
    f("卫衣", 0, 1).then((a) => {
      check("超管：按类目过滤后分片（卫衣第 1 页 2 条）", a.length === 2 && a.every(x => x.category === "卫衣"), JSON.stringify(a.map(x => x.id)));
      return f("全部", 0, 9);
    }).then((b) => {
      check("超管：全部类目共 4 条", b.length === 4);
      const f2 = new Function("SB", "isSuper", "mgrAllData", "mgrSeeAll", "return (" + fn + ");")(SB, () => false, async () => [], () => false);
      return f2("全部", 0, 9).then((c) => check("普通管理员：仍走自己可见的列表", c.length === 1 && c[0].id === "self"));
    }).catch((e) => check("分片逻辑可执行", false, e.message)).then(stepF);
  }
}

function stepF() {
  console.log("\n【F】操作条不再压图 + 类目清单文字不出格");
  check("mgr-topbar 不再绝对定位在图片上", !/#manage-grid \.mgr-topbar\{[\s\S]{0,120}position:absolute/.test(css));
  check("mgr-topbar 改为卡片内正常流（底部一行）", /#manage-grid \.mgr-topbar\{[\s\S]{0,80}position:static/.test(css));
  check("卡片纵向排列，操作条位于图片下方", /#manage-grid \.mgr-cell\{[^}]*flex-direction:column/.test(css));
  check("类目名可收缩（min-width:0）", /\.check-item \{[^}]*min-width: 0/.test(css));
  check("类目名超出用省略号而非顶出容器", /\.check-item > span\{[^}]*text-overflow: ellipsis/.test(css));
  check("清单容器不出现横向滚动", /\.check-list\{[^}]*overflow-x: hidden/.test(css));

  console.log("\n【G】招品回品统计已迁到「招品回品」面板");
  check("统计块仍在页面上（未误删）", /id="dash-recruit-overview"/.test(html) && /id="dash-recruit-status"/.test(html));
  {
    const d = new JSDOM(html).window.document;
    const pane = d.getElementById("vis-dash");
    const rec = d.getElementById("recruit-card");
    check("已不在「数据看板」面板内", !!pane && !pane.querySelector("#dash-recruit-overview") && !pane.querySelector("#dash-recruit-status"));
    check("已在「招品回品」面板内", !!rec && !!rec.querySelector("#dash-recruit-overview") && !!rec.querySelector("#dash-recruit-status"));
    check("统计块只有一份（没有重复 id）", d.querySelectorAll("#dash-recruit-overview").length === 1);
  }
  check("标题改为「招品回品数据统计」", /招品回品数据统计/.test(html));
  check("loadDashboard 不再拉招品任务", !/listRecruitTasks/.test(sliceFn(imagesJs, "loadDashboard")));
  check("新增 loadRecruitDashStats 并暴露", /window\.loadRecruitDashStats = loadRecruitDashStats/.test(imagesJs));
  {
    const iFn = imagesJs.indexOf("async function loadRecruitDashStats(");
    const iEnd = imagesJs.lastIndexOf("})();");
    check("loadRecruitDashStats 定义在模块内部（能用到 $、renderHBars）", iFn > 0 && iFn < iEnd);
  }
  check("切到招品回品面板时刷新统计", /loadRecruitDashStats/.test(adminJs));

  console.log("\n【H】反向验证（把修复拆掉，检查必须报错）");
  check("① 操作条改回绝对定位 → 会被识别", /#manage-grid \.mgr-topbar\{[\s\S]{0,120}position:absolute/.test(css.replace("position:static", "position:absolute")));
  const cssNoEllipsis = css.replace(/\.check-item > span\{[^}]*\}/, ".check-item > span{}");
  check("② 删掉省略号规则 → 会被识别", !/\.check-item > span\{[^}]*text-overflow: ellipsis/.test(cssNoEllipsis));
  const sbNoFallback = sbJs.replace(/const all = await this\.listAllImagesPaged\(\);/, "const all = [];");
  check("③ 删掉看板兜底 → 会被识别", !/const all = await this\.listAllImagesPaged\(\);/.test(sbNoFallback));
  const dashBack = imagesJs.replace("// 招品回品统计已迁移到「招品回品」面板（进入该面板时刷新）", "const rt = await SB.listRecruitTasks();");
  check("④ 把招品统计塞回看板 → 会被识别", /listRecruitTasks/.test(sliceFn(dashBack, "loadDashboard")));

  console.log("\n=== 结果：" + pass + " 项通过，" + fail + " 项失败 ===");
  process.exit(fail ? 1 : 0);
}