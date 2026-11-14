import fs from "fs";
let pass=0,fail=0;
const ok=(c,m)=>{ if(c)pass++; else {fail++;console.log("FAIL",m);} };
const src=fs.readFileSync("js/admin-rank.js","utf8");

const s0=src.indexOf("async function rankPool");
const s1=src.indexOf("/* ---------- 已上传记录 ---------- */");
ok(s0>0 && s1>s0, "能定位计数实现");
const block=src.slice(s0,s1);

/* 1) 必须有并发池，且真的被计数逻辑使用 */
ok(/async function rankPool\(tasks, size\)/.test(src), "存在限并发执行器");
ok(/await rankPool\(tasks, 8\)/.test(block), "计数走并发池（并发 8）");
ok(/Promise\.all/.test(block), "并发池用 Promise.all 驱动");
ok(/while \(idx < list\.length\)/.test(block), "并发池按需取任务，不会一次性全发");

/* 2) 不允许再串行发请求：老的写法是把 await 放在 for 循环里 */
ok(!/for \(const b of \(list \|\| \[\]\)\) \{[\s\S]{0,400}await countFn\(/.test(block), "计数不再在循环里逐个 await");
ok(/滑动|并发/.test(block) || /串行/.test(block), "代码里说明了为什么必须并发");

/* 3) 槽位数量过多时要降级，避免两百多次请求 */
ok(/slotBudget = 80/.test(block), "槽位超过 80 个时启用降级");
ok(/const doSlot = slotSeen\.size <= slotBudget/.test(block), "降级条件明确");
ok(/if \(doSlot\)/.test(block), "槽位计数受降级开关控制");
ok(/periodSeen\.forEach/.test(block) && !/if \(doSlot\) periodSeen/.test(block), "期次计数不受降级影响，始终精确");

/* 4) 单个计数失败不能拖垮整批 */
ok(/catch \(e\) \{ n = null; \}/.test(block), "计数失败记为 null 而不抛出");
ok(/out\[i\] = null/.test(block), "并发池吞掉单任务异常");

/* 5) 类目清理面板不得全表扫描（几十页会把面板拖死） */
const supa=fs.readFileSync("js/supabase.js","utf8");
const lc=supa.slice(supa.indexOf("async listRankCategories"), supa.indexOf("async listRankCategories")+3000);
ok(/map\.size === 0/.test(lc), "仅在台账为空时才扫条目表");
ok(/page < 8/.test(lc), "兜底扫描页数有上限");
ok(!/page < 40/.test(lc), "不再无条件扫 40 页条目");

if (pass+fail>0) console.log((fail===0?"PASS ":"FAIL ")+pass+"/"+(pass+fail));
process.exit(fail?1:0);
