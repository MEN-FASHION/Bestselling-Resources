#!/usr/bin/env node
/**
 * 后台初始化静态检查（纯静态，不依赖浏览器环境）
 *
 * 背景（20261019O）：删掉 js/admin-marketing.js 后，admin.js 的初始化绑定数组里
 * 仍写着 bindMarketing / bindSuperTabs 这两个已不存在的标识符。数组字面量求值
 * 会抛 ReferenceError，导致【整个】绑定序列一条都不执行 —— 表现为：进后台后
 * 智能打标的「关闭」、Esc、「退出全屏」、「退出登录」全部点击无反应。
 *
 * 本检查防的就是这一类：脚本引用悬空、绑定标识符悬空、绑定裸引用、关键按钮缺失。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HTMLS = ["index.html", "admin.html", "marketing.html", "rank.html", "trends.html"];

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; console.log("  \u2717 " + name + (extra ? "  \u2192 " + extra : "")); }
};
const rd = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

console.log("\n=== 1. 页面引用的脚本文件必须真实存在 ===");
let allJs = "";
for (const h of HTMLS) {
  const s = rd(h);
  const refs = [...s.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1].split("?")[0]);
  const missing = refs.filter(r => !/^https?:/i.test(r) && !fs.existsSync(path.join(ROOT, r)));
  ok(h + " 的 " + refs.length + " 个脚本引用均存在", missing.length === 0, missing.join(", "));
}
for (const f of fs.readdirSync(path.join(ROOT, "js"))) {
  if (f.endsWith(".js")) allJs += "\n" + fs.readFileSync(path.join(ROOT, "js", f), "utf8");
}

console.log("\n=== 2. 初始化绑定数组不得出现裸引用 ===");
const admin = rd("js/admin.js");
const mBlock = admin.match(/const INITERS = \[([\s\S]*?)\]\.filter/);
ok("找到 INITERS 绑定数组", !!mBlock);
const body = mBlock ? mBlock[1] : "";
const lines = body.split("\n").map(l => l.trim()).filter(Boolean);
const codeLines = lines.filter(l => !l.startsWith("//"));
const bare = codeLines.filter(l => l && !/^typeof\s+bind[A-Za-z]+\s*===\s*"function"\s*&&\s*bind[A-Za-z]+,?$/.test(l));
ok("每一行都是 typeof 守卫写法（" + codeLines.length + " 行）", bare.length === 0, bare.join(" | "));
ok("数组结尾有 .filter 兜底", /\]\.filter\(fn => typeof fn === "function"\)/.test(admin));
ok("绑定执行仍有 try/catch 容错", /INITERS\.forEach\(fn => \{ try \{ fn\(\); \}/.test(admin));

console.log("\n=== 3. 绑定的标识符必须有实现 ===");
const ids = [...body.matchAll(/typeof\s+(bind[A-Za-z]+)\s*===\s*"function"\s*&&\s*\1/g)].map(m => m[1]);
ok("从数组中解析到 " + ids.length + " 个绑定函数", ids.length >= 20);
const undef = ids.filter(n => !new RegExp("function\\s+" + n + "\\s*\\(|\\b" + n + "\\s*=\\s*function").test(allJs));
ok("全部有实现（无悬空标识符）", undef.length === 0, undef.join(", "));

console.log("\n=== 4. 已下线模块不得再被绑定 ===");
ok("数组中不再绑定 bindMarketing", !/bindMarketing/.test(codeLines.join("\n").replace(/\/\/.*$/gm, "")));
// 20261019O：超管子页签的绑定已在本文件重新实现，因此它「必须」被绑定且必须有实现
ok("数组中重新绑定了 bindSuperTabs（超管子页签必须有人绑）", /bindSuperTabs/.test(codeLines.join("\n").replace(/\/\/.*$/gm, "")));
ok("bindSuperTabs 有实现", /function\s+bindSuperTabs\s*\(/.test(allJs));

console.log("\n=== 5. 关键按钮元素必须在页面里存在 ===");
const adminHtml = rd("admin.html");
for (const id of ["smart-modal", "smart-close", "smart-fs", "admin-logout", "admin-preview-btn"]) {
  ok("admin.html 含 #" + id, new RegExp('id="' + id + '"').test(adminHtml));
}

console.log("\n=== 6. 智能打标的关闭链路完整 ===");
const smart = rd("js/admin-smart.js");
ok("bindSmartModal 绑定了 #smart-close", /#smart-close"\);\s*\n?\s*if \(closeBtn\) closeBtn\.addEventListener\("click", closeSmartModal\)/.test(smart));
ok("bindSmartModal 绑定了 Esc 关闭", /e\.key !== "Escape"/.test(smart) && /closeSmartModal\(\)/.test(smart));
ok("bindSmartModal 绑定了 #smart-fs 全屏切换", /#smart-fs"\)/.test(smart) && /toggleSmartFullscreen/.test(smart));
ok("closeSmartModal 会退出全屏并切回图片管理", /toggleSmartFullscreen\(\)/.test(smart) && /switchPanel\("manage-card"\)/.test(smart));
ok("后台进入默认打开智能打标并置全屏", /openSmartModal\(\)/.test(admin) && /toggleSmartFullscreen/.test(admin));

console.log("\n" + (fail === 0 ? "全部通过" : "存在失败项") + "：" + pass + " 通过 / " + fail + " 失败\n");
process.exit(fail ? 1 : 0);