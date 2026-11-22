/* 筛选项按周度 / 月度切分（20261104H）：抽出 supabase.js 里的真实实现跑一遍。
   这是「两套榜单共用一张表」时最容易串台的一处：周度页冒出月份、月度页冒出周次。 */
import fs from "fs";
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

const S = fs.readFileSync("js/supabase.js", "utf8");
const i = S.indexOf("async rankFacetsByType(periodType) {");
const j = S.indexOf("\n    },", i);
const body = S.slice(i, j + 6);
/* 方法体里用的是模块级 client（不是 this.client），所以把它作为参数注入，
   与实际运行时的作用域一致 —— 否则整段会掉进 catch，看起来像"筛选项没生效"。 */
const mk = new Function("client", "return {" + body + "};");

function stub(batches, facets) {
  const client = {
    from: () => ({
      select: () => ({
        order: () => ({ range: async (a, b) => ({ data: batches.slice(a, b + 1), error: null }) }),
      }),
    }),
  };
  return Object.assign({}, mk(client), { rankFacets: async () => facets });
}

const F = { sites: ["美国", "欧盟"], periods: ["2026-09", "2026-10", "W40", "W41"], categories: ["卫衣", "毛衣", "外套"] };
const B = [
  { period_type: "week", period_label: "W40", category: "卫衣", site: "美国" },
  { period_type: "week", period_label: "W41", category: "毛衣", site: "美国" },
  { period_type: "month", period_label: "2026-09", category: "卫衣", site: "美国" },
  { period_type: "month", period_label: "2026-10", category: "卫衣,欧盟", site: "美国,欧盟" },
];

console.log("一、月度");
const m = await stub(B, F).rankFacetsByType("month");
ok("期次只剩月份", JSON.stringify(m.periods) === JSON.stringify(["2026-09", "2026-10"]));
ok("周次不会混进月度页", m.periods.indexOf("W41") < 0);
ok("类目以月度数据为准（毛衣只有周度数据）", JSON.stringify(m.categories) === JSON.stringify(["卫衣"]));
ok("站点以月度数据为准（站点列按逗号拆）", m.sites.length === 2);

console.log("二、周度");
const w = await stub(B, F).rankFacetsByType("week");
ok("期次只剩周次", JSON.stringify(w.periods) === JSON.stringify(["W40", "W41"]));
ok("周度类目保持原口径（不缩减）", w.categories.length === 3);

console.log("三、兜底");
const w2 = await stub([], F).rankFacetsByType("week");
ok("没有批次记录时按名称形态兜底", JSON.stringify(w2.periods) === JSON.stringify(["W40", "W41"]));
const m2 = await stub([], F).rankFacetsByType("month");
ok("2026-10 这种名称也算月度", JSON.stringify(m2.periods) === JSON.stringify(["2026-09", "2026-10"]));
const all = await stub(B, F).rankFacetsByType("");
ok("不传类型时原样返回（兼容老调用）", all.periods.length === 4);

console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
