/* 「传了最新的图，导出表里却没有」—— 20261109G
   根因是取数上限：按 id 升序翻页、到 20000 行就停，超出的正好是最后上传的那批，
   于是前台能看到新期次、导出打标表里却没有。这里锁住：
     ① 上限抬高，明显高于当前数据量
     ② 被截断时不再静默：状态可查，导出/预览都会明确提示
     ③ 翻页逻辑本身没被改坏（不足一页就停、wanted 截断仍生效）
*/
import fs from "fs";
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };
const R = (p) => fs.readFileSync(p, "utf8");
const S = R("js/supabase.js");
const E = R("js/rankexport.js");
/* 按大括号配对精确切出 listRankItems 的函数体（避免切到文件尾） */
function cutFn(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return "";
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (!d) return src.slice(j, k + 1); }
  }
  return "";
}
const li = cutFn(S, "async listRankItems(filter) {");

console.log("一、取数上限");
ok("上限已从 20000 抬高", !/MAX = 20000;/.test(li));
ok("默认上限 ≥ 50000（可被调用方 f.max 放开）", /Math\.max\(1000, Number\(f\.max\) \|\| 60000\)/.test(li));
ok("单页仍是 1000（服务端单次截断点）", /PAGE = 1000/.test(li));
ok("解决「传了新图却导不出」的原因写进注释", /静默吃掉最新的数据/.test(S) && /导出打标表里却没有/.test(S) || /最新上传的那批/.test(S));

console.log("二、截断不再静默");
ok("每次查询先清空截断标记", /this\._rankTruncated = false;/.test(li));
ok("到上限即标记截断", /if \(out\.length >= MAX\) this\._rankTruncated = true;/.test(li));
ok("对外可查", /rankItemsTruncated\(\) \{ return !!this\._rankTruncated; \}/.test(S));
ok("导出取数上限已放宽（可按期次收窄）", /max: maxRows \|\| 200000/.test(E) && /fetchDetail\(o\)/.test(E));
ok("导出会读这个标记", /var cut = !!\(SB\.rankItemsTruncated && SB\.rankItemsTruncated\(\)\);/.test(E));
ok("导出成功后提示里说明只导出了一部分", /本次只导出了较早的一部分/.test(E));
ok("截断时提示不是绿色成功态", /\+ cutWarn, !cut\);/.test(E));
ok("导出结果对象带 truncated", /pack\.truncated = cut;/.test(E));
ok("预览统计也带 truncated", /pack\.stats\.truncated = !!\(SB\.rankItemsTruncated/.test(E));
ok("预览提示里也写清", /最新期次可能没算进来/.test(E));

console.log("三、翻页逻辑没被改坏");
ok("不满一页即停", /if \(rows\.length < PAGE\) break;/.test(li));
ok("wanted 截断仍生效", /return wanted \? out\.slice\(0, wanted\) : out;/.test(li));
ok("列白名单被拒会退回全量", /if \(res\.error && useSlim\(\)\)/.test(li));
ok("渠道条件失败会去掉重取", /if \(res\.error && chMode\)/.test(li));

console.log("四、实跑：翻页到上限的行为");
/* 用假客户端跑真实翻页代码：模拟 2500 行数据，PAGE=1000 → 3 次请求 */
/* li 是以 " {" 开头的函数体，这里补上函数头，并把上限改成 2000 方便跑 */
/* 把上限压到 2000，便于用 2500 行数据验证"到上限即截断" */
let body = "async function listRankItems(filter) "
  + li.replace(/const MAX = Math\.max\([^;]*;/, "const MAX = 2000;");
const fn = new Function("client", "COLS_REJECTED",
  "var COLS_REJECTED_ = COLS_REJECTED;" + body.replace(/useSlim\(\)/g, "false") + " return listRankItems;");

function mkClient(total) {
  return {
    from() {
      const st = { from: 0 };
      const q = {
        select() { return q; }, eq() { return q; }, in() { return q; }, neq() { return q; }, is() { return q; },
        gte() { return q; }, lte() { return q; }, order() { return q; },
        range(a, b) {
          const rows = [];
          for (let i = a; i <= b && i < total; i++) rows.push({ id: i + 1, image_url: "u" + (i + 1), period_type: "week", period_label: "2026-W45" });
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return q;
    },
  };
}
const ctx = { SB: {} };
const list1 = fn(mkClient(2500), false);
const api1 = { _rankTruncated: false, listRankItems: list1, rankItemsTruncated() { return !!this._rankTruncated; } };
list1.call(api1, {}).then((rows) => {
  ok("达到上限时只返回上限条数", rows.length === 2000);
  ok("并标记为截断", api1.rankItemsTruncated() === true);

  const list2 = fn(mkClient(1500), false);
  const api2 = { _rankTruncated: true, listRankItems: list2, rankItemsTruncated() { return !!this._rankTruncated; } };
  return list2.call(api2, {}).then((r2) => {
    ok("数据量在上限内时取全量", r2.length === 1500);
    ok("且不标记截断", api2.rankItemsTruncated() === false);
    ok("新传的（id 最大）也在结果里", r2[r2.length - 1].id === 1500);

    const list3 = fn(mkClient(2500), false);
    const api3 = { _rankTruncated: false, listRankItems: list3, rankItemsTruncated() { return !!this._rankTruncated; } };
    return list3.call(api3, { limit: 10 }).then((r3) => {
      ok("wanted 仍按需截断", r3.length === 10);
      console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
      process.exit(fail ? 1 : 0);
    });
  });
});
