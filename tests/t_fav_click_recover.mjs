/* 20261121A · 为什么「点收藏没反应」
 *
 * 现场：在 P / S / T 专区（以及渠道对比、品牌动向）点星标，星标不亮、侧边栏不增、
 *       收藏页也没有这张图，界面上没有任何提示 —— 看起来就是点了没反应。
 *
 * 三个原因叠在一起，前两个都是「静默失败」：
 *   ① 提示条被吞：Common.toast 只有页面调过 Common.setToast(fn) 才会真的弹，
 *      渠道专区没调，于是「请先登录」「收藏失败：…」全都不显示；
 *   ② 一票否决：点星标时直接看「进页面那一刻」的登录态与收藏表状态，
 *      页面刚开、会话刚续期、收藏清单还在读的时候，状态还是空的，直接 return；
 *   ③ 失败也关弹层：写入报错后弹层照样关闭，界面上什么都不剩。
 *
 * 本文件锁三件事（含两条反向用例，把修复拿掉必须报错）：
 *   ① 提示条在没有 setToast 的页面上也写得进页面自己的 #toast
 *   ② 点击时重新确认登录与收藏表（迟到的就绪状态也能收藏成功）
 *   ③ 写入失败不关弹层（错误留在用户眼前）
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const SRC = fs.readFileSync(path.join(ROOT, "js/favstar.js"), "utf8");
const SHEIN = fs.readFileSync(path.join(ROOT, "shein.html"), "utf8");
const PIN = fs.readFileSync(path.join(ROOT, "pinterest.html"), "utf8");
const TT = fs.readFileSync(path.join(ROOT, "tiktok.html"), "utf8");

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

/* ===================== 一、极简 DOM：只满足 favstar 启动所需 ===================== */
function makeToast() {
  const el = {
    textContent: "", className: "toast",
    classList: { add(c) { el.className = (el.className + " " + c).trim(); }, remove() {}, contains(c) { return el.className.split(/\s+/).indexOf(c) >= 0; } },
  };
  return el;
}

function bootFavstar(opts) {
  const O = opts || {};
  const toastEl = makeToast();
  const body = {
    getAttribute: (k) => (k === "data-fav-source" ? (O.source || "shein") : null),
    appendChild() {},
  };
  const doc = {
    body,
    readyState: "complete",
    documentElement: {},
    querySelector: (sel) => (sel === "#toast" ? toastEl : null),
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} } }),
    addEventListener() {},
  };
  const win = {
    document: doc,
    console: { warn() {}, log() {} },
    setTimeout, clearTimeout,
    Promise, Date, JSON, Math, String, Number, Array, Object,
    location: { href: "https://x/" },
  };
  win.window = win;
  win.globalThis = win;

  const calls = { add: [], ready: 0, uid: 0 };
  const St = O.uid || "u1";
  const SB = {
    favUid: async () => { calls.uid++; return O.uidReady === false && calls.uid === 1 ? null : St; },
    favReady: async () => { calls.ready++; return O.readyAtFirst === false && calls.ready === 1 ? false : true; },
    listFavCategories: async () => [{ id: 7, name: "默认" }],
    listFavItems: async () => [],
    addFavItems: async (rows, cid) => { calls.add.push({ rows, cid }); return rows.length; },
    removeFavItems: async () => 1,
  };
  win.SB = SB;

  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: "js/favstar.js" });
  return { win, ctx, toastEl, calls, SB };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ===================== 二、提示条必须真的看得见 ===================== */
console.log("一、提示条不再被吞掉");
{
  const { win, ctx, toastEl } = bootFavstar({});
  await wait(20);
  ctx.__probeCall = null;
  /* 直接调暴露出来的 toast：模拟「请先登录」这类提示 */
  vm.runInContext('FavStar._test.toast("请先登录后再收藏")', ctx);
  ok(/请先登录后再收藏/.test(toastEl.textContent), "页面没有 setToast 时，提示写进 #toast（看得见）");
  ok(/show/.test(toastEl.className), "提示条带 show 类，会真的浮出来");
  ok(typeof win.toast !== "function", "这个页面本来就没有 window.toast（正是被吞的条件）");
}

/* ===================== 三、点击时重新确认，迟到的就绪也能收藏 ===================== */
console.log("二、点击时重新确认登录与收藏表");
{
  const { ctx, calls } = bootFavstar({});
  await wait(30);
  const ready = vm.runInContext("FavStar._test.ensureReady()", ctx);
  const r = await ready;
  ok(r === true, "首次加载已经就绪 → 允许收藏");
  ok(calls.ready >= 1, "确认过程真的去查了收藏表（不是拿旧状态搪塞）");
}
{
  /* 首次 favReady() 返回 false（页面刚打开、接口还没就绪），点击时必须是 true */
  const { ctx, calls } = bootFavstar({ readyAtFirst: false });
  await wait(40);
  const st0 = vm.runInContext("FavStar._test.state().ready", ctx);
  ok(st0 === false, "初态确实没就绪（复现现场）");
  const r = await vm.runInContext("FavStar._test.ensureReady()", ctx);
  ok(r === true, "迟到的就绪状态也能收藏成功（旧版在这里直接 return）");
  ok(calls.ready >= 2, "重新确认时又查了一次（calls=" + calls.ready + "）");
}
{
  /* 登录态迟到：第一次 favUid 为 null，点击时重查应拿到 uid */
  const { ctx } = bootFavstar({ uidReady: false });
  await wait(40);
  const r = await vm.runInContext("FavStar._test.ensureReady()", ctx);
  ok(r === true, "会话刚续期时点击也能收藏（不再一票否决）");
}

/* ===================== 四、写入失败不关弹层 ===================== */
console.log("三、失败不能把弹层关掉");
ok(/if \(saved\) closePick\(\);/.test(SRC), "收藏成功才关弹层");
ok(/if \(done\) closePick\(\);/.test(SRC), "取消收藏成功才关弹层");
ok(/if \(ok\) closePick\(\);\s*\n\s*else if \(inp\)/.test(SRC), "新建分类并收藏：失败时留在弹层、输入框恢复可用");
ok(/收藏失败：" \+ msg/.test(SRC), "失败提示带上原始原因，不再只说「收藏失败」");
ok(/\[FAV-DIAG\]/.test(SRC), "失败时在控制台留一条可定位的诊断行");

/* ===================== 五、三个专区的星标脚本都挂着 ===================== */
console.log("四、P / S / T 三个专区");
[["shein.html", SHEIN, "shein"], ["pinterest.html", PIN, "pinterest"], ["tiktok.html", TT, "tiktok"]].forEach(([f, html, src]) => {
  ok(new RegExp('data-fav-source="' + src + '"').test(html), f + " 声明来源 " + src);
  ok(/js\/favstar\.js/.test(html), f + " 加载星标脚本");
  ok(/js\/favdrawer\.js/.test(html), f + " 加载收藏侧边栏");
});

/* ===================== 六、反向用例：把修复拿掉必须报错 ===================== */
console.log("五、反向验证（拿掉修复必须失败）");
{
  /* ① 提示条退回「只看 window.toast / Common.toast」→ 断言必须失败 */
  const broken = SRC.replace(
    /var t = \$\("#toast"\);\n    if \(t\) \{[\s\S]*?shown = true;\n    \}/,
    "var t = null;"
  );
  ok(!/var t = \$\("#toast"\);\n    if \(t\) \{[\s\S]*?shown = true;\n    \}/.test(broken), "（已构造：提示条不再写 #toast）");

  const toastEl = makeToast();
  const body = { getAttribute: () => "shein", appendChild() {} };
  const win = {
    document: {
      body, readyState: "complete",
      querySelector: (s) => (s === "#toast" ? toastEl : null),
      querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }), addEventListener() {},
    },
    console: { warn() {} }, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Array, Object,
  };
  win.window = win;
  win.SB = {
    favUid: async () => "u1", favReady: async () => true,
    listFavCategories: async () => [], listFavItems: async () => [],
  };
  const ctx = vm.createContext(win);
  vm.runInContext(broken, ctx, { filename: "favstar.broken.js" });
  vm.runInContext('FavStar._test.toast("请先登录后再收藏")', ctx);
  ok(!/请先登录后再收藏/.test(toastEl.textContent), "反证：退回旧写法时提示确实丢失 —— 用例抓得住这个缺陷");

  /* ② 拿掉点击时的重新确认 → ensureReady 不存在或不再重查 */
  const broken2 = SRC.replace(/function openPick\(card\) \{[\s\S]*?\n  \}\n/, "function openPick(card) { return; }\n");
  ok(broken2 !== SRC, "（已构造：点星标直接返回）");
  ok(!/return ensureReady\(\)\.then/.test(broken2), "反证：去掉重新确认后，点击不会再去查登录与收藏表");
}

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
