#!/usr/bin/env node
/**
 * 后台菜单全面体检（纯静态，不依赖浏览器环境）
 *
 * 背景（20261019O）：删掉旧营销脚本后，后台「超管权限」面板里的子页签
 * （公告管理 / 权限管理 / 前台访问设置 / 数据导出 / 存量图片压缩池）点了没反应
 * —— 因为它们的绑定函数原先住在被删掉的那个文件里。
 *
 * 本检查覆盖后台全部菜单与页签，防「有 DOM 却没有绑定」「有菜单却没有面板」
 * 「有面板却进不去（无权限）」这三类静默失效。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const rd = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; console.log("  \u2717 " + name + (extra ? "  \u2192 " + extra : "")); }
};

const html = rd("admin.html");
const admin = rd("js/admin.js");
let allJs = "";
for (const f of fs.readdirSync(path.join(ROOT, "js"))) {
  if (f.endsWith(".js")) allJs += "\n" + fs.readFileSync(path.join(ROOT, "js", f), "utf8");
}

console.log("\n=== 1. 侧栏菜单 \u2192 面板 一一对应 ===");
const navTargets = [...html.matchAll(/class="nav-item"[^>]*data-target="([^"]+)"/g)].map(m => m[1]);
const uniqNav = [...new Set(navTargets)];
ok("侧栏共 " + uniqNav.length + " 个菜单项", uniqNav.length >= 9);
const missingPanel = uniqNav.filter(t => !new RegExp('id="' + t + '"').test(html));
ok("每个菜单项都有对应面板", missingPanel.length === 0, missingPanel.join(", "));

const panels = [...html.matchAll(/class="panel-card[^"]*"\s+id="([^"]+)"/g)].map(m => m[1]);
ok("后台共 " + panels.length + " 个面板", panels.length >= 9);
const orphan = panels.filter(p => uniqNav.indexOf(p) === -1);
ok("没有「有面板但菜单进不去」的孤儿面板", orphan.length === 0, orphan.join(", "));
// 同时检查反向写法（class 在前 / 属性顺序不同）
const panels2 = [...html.matchAll(/id="([a-z-]+-card)"[^>]*class="panel-card/g)].map(m => m[1]);
ok("面板属性顺序变体也已覆盖", panels2.every(p => uniqNav.indexOf(p) !== -1 || panels.indexOf(p) !== -1));

console.log("\n=== 1b. 已下线的菜单不再出现（防止旧入口被手滑加回来）===");
ok("侧栏没有「榜单打标」入口", html.indexOf('data-target="rank-tag-card"') === -1);
ok("面板 #rank-tag-card 已移除", html.indexOf('id="rank-tag-card"') === -1);
ok("不再加载榜单打标脚本", !/js\/admin-ranktag\.js/.test(html));
ok("权限映射表里也没有它了", !/"rank-tag-card"\s*:/.test(admin));

console.log("\n=== 2. 每个菜单项都在权限映射表里（否则点进去会被判无权限）===");
const zoneBlock = (admin.match(/const PANEL_ZONE = \{([\s\S]*?)\};/) || [])[1] || "";
const zones = [...zoneBlock.matchAll(/"([a-z-]+-card)"\s*:/g)].map(m => m[1]);
const noZone = uniqNav.filter(t => zones.indexOf(t) === -1);
ok("菜单项均已在权限映射表中声明", noZone.length === 0, noZone.join(", "));
ok("超管专属面板被标记为 super（营销日历/用户动向/版本恢复/超管权限）",
   ["mk-card", "backup-card", "super-card"].every(t => new RegExp('"' + t + '":\\s*"super"').test(zoneBlock)));

console.log("\n=== 3. 超管权限子页签 \u2194 子面板 一一对应 ===");
const tabKeys = [...html.matchAll(/class="super-tab[^"]*"\s+data-sv="([^"]+)"/g)].map(m => m[1]);
const subKeys = [...html.matchAll(/class="super-sub"\s+data-sv="([^"]+)"/g)].map(m => m[1]);
ok("子页签 " + tabKeys.length + " 个 / 子面板 " + subKeys.length + " 个", tabKeys.length >= 4);
ok("页签与子面板一一对应", tabKeys.length === subKeys.length && tabKeys.every(k => subKeys.indexOf(k) !== -1),
   "页签:" + tabKeys.join(",") + " | 子面板:" + subKeys.join(","));

console.log("\n=== 4. 每个页签组都必须有绑定函数（防「有 DOM 没绑定」）===");
// domNeedle：页面里必须出现的结构特征；binder：绑定函数名；viaInit：是否直接进初始化清单；parent：由谁调用
const groups = [
  { name: "侧栏菜单", domNeedle: 'class="nav-item', binder: "bindAdminNav", viaInit: true },
  { name: "超管权限子页签", domNeedle: 'class="super-tab', binder: "bindSuperTabs", viaInit: true },
  { name: "视觉专区子页签", domNeedle: 'class="vis-tab', binder: "bindVisualTabs", viaInit: false, parent: "bindAdminNav" }
];
for (const g of groups) {
  ok(g.name + "：页面里有对应结构", html.indexOf(g.domNeedle) !== -1, g.domNeedle);
  const hasFn = new RegExp("function\\s+" + g.binder + "\\s*\\(").test(allJs) || new RegExp(g.binder + "\\s*=\\s*function").test(allJs);
  ok(g.name + "：绑定函数 " + g.binder + " 有实现", hasFn);
  if (g.viaInit) {
    ok(g.name + "：已纳入初始化清单", new RegExp("typeof\\s+" + g.binder + '\\s*===\\s*"function"\\s*&&\\s*' + g.binder).test(admin));
  } else {
    ok(g.name + "：由 " + g.parent + " 调用（同一次初始化即完成绑定）",
       new RegExp("function\\s+" + g.parent + "\\s*\\([\\s\\S]{0,400}?" + g.binder + "\\(\\)").test(admin));
  }
}

console.log("\n=== 5. 超管权限子页签的切换逻辑完整 ===");
ok("点击页签会切换 active 高亮", /tabs\.forEach\(t => t\.classList\.toggle\("active"/.test(admin));
ok("点击页签会显示对应子面板、隐藏其余", /subs\.forEach\(sp => \{ sp\.style\.display/.test(admin));
ok("首次进入按默认页签同步一次显隐", /const active = tabs\.filter\(t => t\.classList\.contains\("active"\)\)/.test(admin));
ok("重复绑定有防护（data-bound）", /dataset\.bound === "1"/.test(admin));

console.log("\n=== 6. 进入各面板时的数据加载都有守卫 ===");
const switchBody = (admin.match(/function switchPanel\(target\) \{([\s\S]*?)\n  \}/) || [])[1] || "";
ok("switchPanel 先做权限判定", /canAccessPanel\(target\)/.test(switchBody));
ok("switchPanel 先统一隐藏所有面板（不叠层）", /panel-card"\)\.forEach\(el => el\.classList\.add\("hidden"\)/.test(switchBody));
const targets = [...switchBody.matchAll(/target === "([a-z-]+-card)"/g)].map(m => m[1]);
const noLoad = uniqNav.filter(t => targets.indexOf(t) === -1);
ok("每个菜单项都有对应的加载分支（" + targets.length + " 个）", noLoad.length === 0, noLoad.join(", "));

console.log("\n=== 7. 监控脚本引用与绑定实现（复用初始化体检口径）===");
const refs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1].split("?")[0]);
const missJs = refs.filter(r => !/^https?:/i.test(r) && !fs.existsSync(path.join(ROOT, r)));
ok("admin.html 引用的脚本都存在", missJs.length === 0, missJs.join(", "));
const ids = [...((admin.match(/const INITERS = \[([\s\S]*?)\]\.filter/) || [])[1] || "").matchAll(/typeof\s+(bind[A-Za-z]+)\s*===\s*"function"\s*&&\s*\1/g)].map(m => m[1]);
const undef = ids.filter(n => !new RegExp("function\\s+" + n + "\\s*\\(").test(allJs));
ok("初始化清单里 " + ids.length + " 个绑定函数都有实现", undef.length === 0, undef.join(", "));

console.log("\n" + (fail === 0 ? "全部通过" : "存在失败项") + "：" + pass + " 通过 / " + fail + " 失败\n");
process.exit(fail ? 1 : 0);