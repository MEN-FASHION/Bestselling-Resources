/* 批量导入必须是「有并发 + 有进度 + 有单组超时」的，不能一串到底让界面停在「导入中…」。 */
import fs from "fs";
import path from "path";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(path.join(root, "js/admin-rank.js"), "utf8");

console.log("一、并发池");
ok(/const CONC = 4;/.test(src), "并发度常量存在");
ok(/let cursor = 0;/.test(src), "用游标分配任务（不会重复、不会漏组）");
ok(/Promise\.all\(Array\.from\(\{ length: Math\.min\(CONC, TOTAL\) \}/.test(src), "按并发度起 worker");
ok(/const i = cursor\+\+;\s*\n\s*if \(i >= TOTAL\) return;/.test(src), "worker 取完即退出");
ok(!/for \(const g of gf\.groups\)/.test(src), "原来的串行 for 循环已移除");
ok(/runGroup\(g\)/.test(src), "每组走独立的 runGroup");

console.log("二、进度可见");
ok(/导入中 0\/" \+ TOTAL/.test(src), "开始即显示 0/N");
ok(/\(TOTAL > 4\)/.test(src) || /TOTAL > 4 \? /.test(src), "组数多时才用进度文案（单组仍显示导入中）");
ok(/已写入 " \+ inserted \+ " 条/.test(src), "进度里带已写入条数");
ok(/paintProgress\(\)/.test(src), "每完成一组刷新进度");
ok(/请不要关闭页面/.test(src), "开始导入时提示不要关闭页面");

console.log("三、单组超时");
ok(/GROUP_TIMEOUT_MS = 90000/.test(src), "单组超时上限 90 秒");
ok(/Promise\.race\(\[/.test(src), "用 Promise.race 做超时");
ok(/等待超时（可能已部分写入，请核对条数）/.test(src), "超时文案说明可能已部分写入");
ok(/failed\.push\(g\.period \+ " · " \+ g\.category \+ "：" \+ explainFail\("等待超时/.test(src), "超时计入失败清单");

console.log("四、既有保障未被破坏");
ok(/undoGroups\.push/.test(src) && /setRankUndoInfo\(info\)/.test(src), "撤销记录仍在");
ok(/backupRows/.test(src) && /exportRankBackup/.test(src), "留底导出仍在");
ok(/if \(mode === "replace"\)/.test(src), "覆盖 / 追加分支仍在");
ok(/finally \{[\s\S]{0,400}?btn\.textContent = "导入榜单";/.test(src), "结束后按钮复位");
ok(/rankParsed = null;/.test(src), "导入结束清理已解析数据");

console.log("五、并发不会打乱结果汇总");
ok(/inserted \+= ins;/.test(src), "写入条数累加");
ok(/done\+\+;/.test(src), "完成组数累加");
ok(/periodSet\[g\.period\] = 1;/.test(src) && /catSet\[g\.category\] = 1;/.test(src), "期次/类目去重集合仍在");

console.log("六、常驻进度行（不依赖按钮文字）");
ok(/rank-import-progress/.test(src), "页面上有独立进度节点");
ok(/setInterval\(paintBar, 1000\)/.test(src), "每秒刷新一次");
ok(/已运行 " \+ sec \+ " 秒/.test(src), "显示已运行秒数（能看出在动）");
ok(/已完成 " \+ done \+ "\/" \+ TOTAL/.test(src), "显示完成组数");
ok(/已写入 " \+ inserted \+ " 条/.test(src), "显示已写入条数");
ok(/clearInterval\(window\.__rankImportTicker\)/.test(src), "异常路径也会停掉计时器");
const css = fs.readFileSync(path.join(root, "css/style.css"), "utf8");
ok(/\.rank-progress\{/.test(css), "进度行有对应样式");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
