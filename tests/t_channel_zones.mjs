/* 20261111Q · Pinterest 专区 / SHEIN 专区（纯图片专区）
 * 覆盖：
 *  1) 两个前台页存在，左侧「服装类目」菜单与趋势上升榜一致，顶部只保留「月度」筛选
 *  2) 前台脚本按渠道取图、按月份筛选、打标读 rank_image_tags（按图片地址）
 *  3) 后台两个面板、侧栏菜单、脚本引用齐全，面板按专区权限管控
 *  4) 专区定义/权限清单/前台导航都补上了两个新专区
 *  5) 后台作业台：只传图（无指标）、打标、改类目月份、删除
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("  ✗ " + msg); } };

/* ---------- 1. 前台页面 ---------- */
const pages = [
  { file: "pinterest.html", key: "pinterest", channel: "Pinterest", label: "Pinterest 专区" },
  { file: "shein.html", key: "shein", channel: "SHEIN", label: "SHEIN 专区" },
];
for (const p of pages) {
  ok(fs.existsSync(path.join(ROOT, p.file)), `${p.file} 缺失`);
  const h = read(p.file);
  ok(h.includes(`window.CZONE = { key: "${p.key}", label: "${p.label}", channel: "${p.channel}" }`),
    `${p.file} 未声明专区配置`);
  ok(h.includes('class="sidebar"') && h.includes("服装类目"), `${p.file} 左侧菜单应与趋势上升榜一致（服装类目）`);
  ok(h.includes('id="cz-cats"'), `${p.file} 缺少类目菜单容器`);
  ok(h.includes('class="tag-filter"') && h.includes('id="cz-groups"'), `${p.file} 缺少筛选栏`);
  ok(!/国家站点|周次/.test(h), `${p.file} 顶部筛选项只应保留月度，不应出现国家/周次`);
  ok(h.includes("channel-zone-front.js"), `${p.file} 未引用前台脚本`);
  ok(h.includes(`href="${p.file}" class="tab-link active"`), `${p.file} 自身菜单项未高亮`);
}

/* ---------- 2. 前台脚本 ---------- */
const front = read("js/channel-zone-front.js");
ok(/listRankChannelPics\(\{\s*periodType:\s*"month"/.test(front), "前台应按月度渠道图读取");
ok(/sameChannel/.test(front), "前台必须按渠道过滤（不能把别的渠道图混进来）");
ok(/listMovementTags|listImageTags/.test(front), "打标结果应按图片地址读取");
ok(/state\.month/.test(front) && /全部月份/.test(front), "筛选应只有月份维度");
ok(/cat-menu-item/.test(front), "左侧类目菜单样式应与趋势上升榜一致");
ok(/myFrontendZones/.test(front) && /getFrontendZoneVisibility/.test(front), "前台应做两级专区可见性守门");
ok(!/uploadRankChannel|deleteRankChannel|saveMovementTags/.test(front), "前台页面不应有写操作");

/* ---------- 3. 后台页面与脚本 ---------- */
const admin = read("admin.html");
ok(admin.includes('id="pinterest-card"'), "后台缺少 Pinterest 面板");
ok(admin.includes('id="shein-card"'), "后台缺少 SHEIN 面板");
ok(/data-target="pinterest-card"/.test(admin), "后台侧栏缺少 Pinterest 入口");
ok(/data-target="shein-card"/.test(admin), "后台侧栏缺少 SHEIN 入口");
ok(admin.includes("admin-channelzone.js"), "后台未引用渠道专区脚本");

const adm = read("js/admin-channelzone.js");
ok(/uploadRankChannelImages\(items,\s*\{\s*channel:/.test(adm), "后台上传应带渠道（复用其他渠道传图通道）");
ok(/periodType:\s*"month"/.test(adm), "后台列表应按月度读取");
ok(/saveMovementTags/.test(adm), "打标应写 rank_image_tags（按图片地址）");
ok(/deleteRankChannelItem/.test(adm), "后台应支持删除单张图");
ok(/updateRankChannelItem/.test(adm), "后台应支持就地改类目/月份");
ok(/guardZone/.test(adm), "写操作应做专区权限守门");
ok(!/\bratio\b|abs_delta/.test(adm), "这两个专区不应出现榜单指标字段");

const adminJs = read("js/admin.js");
ok(/"pinterest-card":\s*"pinterest"/.test(adminJs), "PANEL_ZONE 未绑定 pinterest");
ok(/"shein-card":\s*"shein"/.test(adminJs), "PANEL_ZONE 未绑定 shein");
ok(/ChannelZoneAdmin\.reload/.test(adminJs), "切换面板时应触发数据加载");
ok(/key:\s*"pinterest",\s*label:\s*"Pinterest 专区"/.test(adminJs), "前台访问设置应可开关 Pinterest 专区");
ok(/key:\s*"shein",\s*label:\s*"SHEIN 专区"/.test(adminJs), "前台访问设置应可开关 SHEIN 专区");

/* ---------- 4. 专区定义与权限 ---------- */
const cfg = read("js/config.js");
ok(/key:\s*"pinterest",\s*label:\s*"Pinterest 专区",\s*href:\s*"pinterest\.html"/.test(cfg), "专区定义缺少 Pinterest");
ok(/key:\s*"shein",\s*label:\s*"SHEIN 专区",\s*href:\s*"shein\.html"/.test(cfg), "专区定义缺少 SHEIN");

const perm = read("js/admin-perm.js");
const m = perm.match(/ALL_CAT_ZONES\s*=\s*\[([^\]]*)\]/);
const zones = m ? m[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")) : [];
ok(zones.includes("pinterest"), "类目授权应覆盖 pinterest");
ok(zones.includes("shein"), "类目授权应覆盖 shein");
ok(/key:\s*"pinterest",\s*label:\s*"Pinterest 专区"/.test(perm), "权限勾选应含 Pinterest 专区");
ok(/key:\s*"shein",\s*label:\s*"SHEIN 专区"/.test(perm), "权限勾选应含 SHEIN 专区");
ok(/Pinterest 专区 \(pinterest\.html\)/.test(perm), "专区管理的前台链接预设应含 Pinterest");

/* ---------- 5. 各前台页面导航 ---------- */
const navPages = ["index.html", "rank.html", "rhythm.html", "trends.html", "marketing.html", "fav.html", "movement.html"];
for (const f of navPages) {
  const h = read(f);
  ok(h.includes('href="pinterest.html"'), `${f} 顶部菜单缺少 Pinterest 专区入口`);
  ok(h.includes('href="shein.html"'), `${f} 顶部菜单缺少 SHEIN 专区入口`);
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);
