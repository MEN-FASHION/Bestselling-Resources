/* 趋势上升榜 → 趋势专区 打通的结构校验（20261030D）
   目的：上传链路里任何一环漏了，这里都要报出来，避免又靠线上试错。 */
import fs from "fs";
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

const R = fs.readFileSync("js/report.js", "utf8");
const H = fs.readFileSync("rank.html", "utf8");
const T = fs.readFileSync("trends.html", "utf8");
const W = fs.readFileSync("worker/worker.js", "utf8");

console.log("一、入口");
ok("弹窗有「PDF 并上传趋势专区」选项", /data-fmt="trend"/.test(R));
ok("生成分支调用 publishToTrend", /FMT === "trend"\) await publishToTrend\(\)/.test(R));
ok("该格式有独立说明文案", /上传趋势专区：生成 A4 横版 PDF/.test(R));

console.log("二、PDF 生成");
ok("使用 jsPDF", /window\.jspdf\.jsPDF/.test(R));
ok("懒加载 vendor/jspdf.umd.min.js", /vendor\/jspdf\.umd\.min\.js/.test(R));
ok("A4 横版 297x210", /w: 297, h: 210/.test(R));
ok("封面先出（第 1 页）", /第 1 页：封面铺满/.test(R));
ok("内页为整页图片（中文不会丢字）", /buildInnerPageCanvas/.test(R) && /toDataURL\("image\/jpeg", 0\.86\)/.test(R));
ok("内页不再用 PDF 文字接口写中文", !/pdf\.text\(head/.test(R));
ok("图片解码有等待（未就绪会兜底提示）", /await loadImage\(shot\.data\)/.test(R));
ok("整体对照页 + 每列页", /整体对照 ·/.test(R) && /pools\.length \+ 1/.test(R));

console.log("三、自动填写趋势专区必填项");
ok("标题自动生成", /function autoTrendMeta/.test(R) && /趋势报告/.test(R));
ok("标签三选一，与前台页签对齐", /tag = "周度"/.test(R) && /tag = "月度"/.test(R) && /tag = "类目"/.test(R));
ok("前台页签确实是 类目/月度/周度", /data-tag="类目"/.test(T) && /data-tag="月度"/.test(T) && /data-tag="周度"/.test(T));
ok("类目、简介一并带出", /category: \(st\.cat/.test(R) && /description: desc/.test(R));
ok("周次识别 W 格式", /W\\d\{1,2\}/.test(R));

console.log("四、上传与登记");
ok("先抓图再上传", /shots\.all = await shoot\(wrap\)/.test(R));
ok("进度回调可用", /uploadTrendFileXHR/.test(R) && /74 \+ Math\.round\(p \* 0\.2\)/.test(R));
ok("无 XHR 版本时降级调用", /: await SBX\.uploadTrendFile\(pdfFile, coverFile\)/.test(R));
ok("登记到 trends 表（addTrendRecord）", /addTrendRecord\(\{/.test(R));
ok("字段齐全", /title: meta\.title/.test(R) && /tag: meta\.tag/.test(R) && /path: up\.path/.test(R) && /file_type: "pdf"/.test(R) && /cover: up\.cover/.test(R));
ok("封面图随文件一起上传", /new File\(\[pack\.coverBlob\]/.test(R));
ok("组件缺失有明确提示", /当前页面未加载上传组件/.test(R));

console.log("五、服务端与依赖");
ok("服务端 /trend/upload 仅接受 PDF", /暂仅支持 PDF/.test(W));
ok("上传受趋势专区权限管控", /canManageZone\(userId, role, token, env, "trend"\)/.test(W));
ok("PDF 走原样上传（不被图片压缩逻辑处理）", /if \(!file \|\| !\/\^image\\\/\/i\.test\(file\.type/.test(fs.readFileSync("js/supabase.js", "utf8")));
ok("jspdf 已放入 vendor", fs.existsSync("vendor/jspdf.umd.min.js"));

console.log("六、版本一致性");
ok("rank.html 引入 report.js 且为 20261030D", /js\/report\.js\?v=20261030D/.test(H));
const allHtml = ["admin.html","rank.html","trends.html","index.html","movement.html","plus.html","marketing.html","fav.html"];
ok("八个页面的资源引用版本号统一", allHtml.every(f => !/\?v=20261030[ABC]/.test(fs.readFileSync(f, "utf8"))));

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
