/* 20261114V · 传图提速 + 上传可取消
 *
 * 一、提速
 *   - 批量传图（S / P / T 等渠道专区）以前一张一张排队，现在多路并发；
 *   - 品牌动向同一套；
 *   - 压缩不再是「6 个质量档 + 4 个尺寸档」逐个试（最多编码 11 次），
 *     改成先压一次、超限就按体积比估尺寸再压一次。
 * 二、取消
 *   - 有取消按钮；取消后不再领新图，已开始的传完；
 *   - 没轮到的留在待传列表里，下次接着传（不会白选一遍图）。
 *
 * 反向用例（必须报错才算测试有用）：
 *   - 把并发数写成 1（退回串行）→ 并发用例必须失败；
 *   - 取消标记不生效（永远返回 false）→ 取消用例必须失败。
 */
import fs from "fs";

const read = (p) => fs.readFileSync(p, "utf8");
const SB = read("js/supabase.js");
const CZ = read("js/admin-channelzone.js");
const MV = read("js/admin-movement.js");
const SMART = read("js/admin-smart.js");
const HTML = read("admin.html");

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("  ✗ " + n); } };

/* 从源码里抠出一个函数（含 async 修饰），用于真跑 */
function grab(src, name) {
  let i = src.indexOf("function " + name);
  if (i < 0) return "";
  if (src.slice(i - 6, i) === "async ") i -= 6;
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); }
  }
  return "";
}

console.log("一、并发池实现");
ok(/async function runPool/.test(SB), "应有通用并发池 runPool");
const runPoolSrc = grab(SB, "runPool");
ok(/Math\.min\(Number\(limit\) \|\| 4, 8, total\)/.test(runPoolSrc), "并发上限应可配置且封顶 8");
ok(/cancel\(\)/.test(runPoolSrc), "并发池应支持取消判断");

console.log("二、批量传图改并发 + 可取消");
ok(/API\.uploadRankChannelImages = async function \(items, opts, onProgress\)/.test(SB), "应有批量传图入口");
ok(/await runPool\(list, o\.concurrency \|\| 4/.test(SB), "渠道专区传图应走并发池（默认 4 路）");
ok(/const isCancel = \(\) =>/.test(SB), "应支持 isCancelled 回调");
ok(/cancelled, remaining: Math\.max\(0, list\.length - finished\)/.test(SB), "返回值应说明是否取消、还剩多少");
ok(/pos\.set\(url, doc\.length - 1\)/.test(SB), "文档写回应用地址索引，别每张 findIndex（平方级）");

console.log("三、品牌动向同样改并发 + 可取消");
ok(/async uploadMovementImages\(files, category, onProgress, opts\)/.test(SB), "应有品牌动向批量传图");
ok(/await runPool\(list, o\.concurrency \|\| 4/.test(SB), "品牌动向传图应走并发池");
ok(/isCancelled: function \(\) \{ return state\.cancel === true; \}/.test(MV), "品牌动向应把取消标记传给上传层");

console.log("四、压缩不再逐个试");
ok(!/const qualities = \[0\.82, 0\.7, 0\.6, 0\.5, 0\.4, 0\.3\]/.test(SB), "旧的 6 档质量循环应已移除");
ok(!/const ratios = \[0\.7, 0\.5, 0\.38, 0\.28\]/.test(SB), "旧的 4 档尺寸循环应已移除");
ok(/Math\.sqrt\(limit \/ first\.size\)/.test(SB), "应按体积比估算缩放尺寸，一步到位");
ok(/const TARGET = \(maxKB > 0 \? maxKB : 200\) \* 1024/.test(SB), "目标体积口径不应变（默认 200KB）");

console.log("五、界面上的取消按钮");
ok(/"cancel"\) \+ '" class="btn-ghost hidden" type="button">取消上传/.test(CZ), "渠道专区上传行应有取消按钮");
ok(/st\.cancel = true;/.test(CZ), "点取消应置cancel标记");
ok(/isCancelled: function \(\) \{ return st\.cancel === true; \}/.test(CZ), "渠道专区应把取消标记传给上传层");
ok(/id="mv-cancel-btn"/.test(HTML), "品牌动向应有取消按钮");
ok(/state\.cancel = true;/.test(MV), "品牌动向点取消应置标记");
ok(/id="smart-cancel-btn"/.test(HTML), "视觉专区应有取消按钮");
ok(/smartCancel = true;/.test(SMART), "视觉专区点取消应置标记");

console.log("六、取消后没传的留在待传");
ok(/if \(res\.cancelled\) \{/.test(CZ), "渠道专区应区分取消场景");
ok(/left = st\.pending\.filter\(function \(f\) \{/.test(CZ), "取消时未处理的应留在待传");
ok(/state\.pending = res\.cancelled \? files\.filter/.test(MV), "品牌动向取消时未处理的应留在待传");
ok(/if \(r === null\) keep\.push\(smartPending\[i\]\)/.test(SMART), "视觉专区取消时未处理的应留在待传");

/* ---------- 七、真跑并发池：确实并行、确实能取消 ---------- */
console.log("七、并发池实跑");
const sandboxSrc = runPoolSrc;
function makePool(concurrencyOverride) {
  let src = sandboxSrc;
  if (concurrencyOverride === 1) src = src.replace(/const width = [^;]+;/, "const width = 1;");
  return new Function(src + "\nreturn runPool;")();
}

async function realRun() {
  /* 并行度：4 路时同时在跑的应 >1 且 ≤4 */
  let running = 0, peak = 0, doneCount = 0;
  const items = Array.from({ length: 12 }, (_, i) => i);
  const pool = makePool();
  const t0 = Date.now();
  const r = await pool(items, 4, async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((r2) => setTimeout(r2, 25));
    running--; doneCount++;
  }, () => false);
  const ms = Date.now() - t0;
  ok(peak > 1 && peak <= 4, "并发峰值应在 2~4 之间（实际 " + peak + "）");
  ok(doneCount === 12 && r.done === 12, "12 张应全部处理完（实际 " + doneCount + "）");
  ok(!r.cancelled, "没有取消时不应标记取消");
  ok(ms < 12 * 25, "总耗时应明显短于串行（实际 " + ms + "ms，串行约 300ms）");

  /* 反向：并发数被改成 1 → 峰值必须是 1（证明上面的断言不是恒真） */
  let peak1 = 0, run1 = 0;
  const pool1 = makePool(1);
  await pool1(items.slice(0, 4), 4, async () => {
    run1++; peak1 = Math.max(peak1, run1);
    await new Promise((r2) => setTimeout(r2, 5));
    run1--;
  }, () => false);
  ok(peak1 === 1, "反向用例：并发数=1 时峰值应为 1（实际 " + peak1 + "）");

  /* 取消：处理到第 3 张就取消 */
  let n = 0;
  const pool2 = makePool();
  const r2 = await pool2(items, 4, async () => {
    n++;
    await new Promise((r3) => setTimeout(r3, 10));
  }, () => n >= 3);
  ok(r2.cancelled === true, "取消后应返回 cancelled=true");
  ok(r2.done < 12, "取消后不应把 12 张全跑完（实际 " + r2.done + "）");

  /* 反向：取消判断永远 false → 不该被误判成取消 */
  const pool3 = makePool();
  const r3 = await pool3(items.slice(0, 5), 4, async () => { }, () => false);
  ok(r3.done === 5 && !r3.cancelled, "反向用例：不取消时不得标记取消");

  /* 单张失败不影响整批 */
  const pool4 = makePool();
  const r4 = await pool4([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error("boom"); }, () => false);
  ok(r4.done === 3 && !r4.cancelled, "单张失败仍应继续跑完剩余（实际 " + r4.done + "）");

  /* 空列表不应报错 */
  const pool5 = makePool();
  const r5 = await pool5([], 4, async () => { }, () => false);
  ok(r5.done === 0 && !r5.cancelled, "空列表应安全返回");
}

await realRun();

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
