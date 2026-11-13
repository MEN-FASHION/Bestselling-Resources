/* 20261113H · 「有的表里没有排名」也要能算出位次
   -------------------------------------------------
   用户真实表（2026年1月POLO衫商品整理表）：
     16 列，有「销售额」，没有「排名」，环比比例 / 环比绝对值整列为空，「有销量站点」整列为空。
   旧逻辑只认「排名」，没有排名就一位次都算不出来 → 前台清一色「新上榜」。

   本文件把 admin-rhythm.js 里的纯函数真抽出来跑（表头识别 / 名次落位），
   20261113I 起口径统一：销售额覆盖过半就一律按销售额排批内名次（表里有排名也不用），
   只有整批没有销售额列才退回「排名」，再没有按表格行序；三种口径不会互相混用。
*/
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log("  ✓ " + n); }
  else { fail++; console.log("  ✗ " + n, extra === undefined ? "" : "→ " + JSON.stringify(extra)); }
};
const SRC = fs.readFileSync("js/admin-rhythm.js", "utf8");

/* 从源码里切出纯函数（表头识别 + 名次落位），在独立作用域里跑，不碰页面 */
function slice(from, to) {
  const a = SRC.indexOf(from);
  const b = SRC.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error("切片失败：" + from);
  return SRC.slice(a, b);
}
const HEAD = slice("  function normHead(h)", "  /* ---------- 标签与名次");
const RANK = slice("  function isPosNum(v)", "  /* ---------- 导入 ----------");
const API = new Function(HEAD + "\n" + RANK + "\n return { mapHeaderRow, pickHeaderRow, applyOfficialRank };")();

/* 用户真实表头（16 列，原样） */
const H16 = ["goodsid", "货品spuid", "叶子类目名称", "广告内容", "卖家ID", "卖家名称", "主体id", "有销量站点",
  "销售额", "环比比例", "环比绝对值", "货品名称", "限流标签", "叶子类目id", "是否即将售罄", "首图url"];

/* 真实行（销售额为原表前 12 名的真实值，站点 / 环比为空） */
const SALES = [35163.03, 19621.12, 10816.46, 10417.63, 9524.95, 7921.01, 7889.06, 7177.18, 7122.51, 6886.52, 6828.1, 6448.82];
const rowOf = (i, over) => {
  const r = H16.map(() => "");
  r[0] = "60" + (1100000000000 + i);
  r[2] = "服装、鞋靴和珠宝饰品,男士时尚,男装,男装上衣、T恤、衬衫,男装Polo衫";
  r[8] = String(SALES[i % SALES.length]);
  r[12] = "";
  r[15] = "https://img.kwcdn.com/polo_" + i + ".jpg";
  Object.assign(r, over || {});
  return r;
};
const AOA = [H16].concat(SALES.map((_, i) => rowOf(i)));

/* 把 aoa 变成解析阶段的 rows（等价 onRankFileChange 里那一段） */
function parse(aoa) {
  const head = API.pickHeaderRow(aoa);
  const rows = [];
  for (let i = head.idx + 1; i < aoa.length; i++) {
    const c = aoa[i] || [];
    const url = head.map.url >= 0 ? String(c[head.map.url] || "").trim() : "";
    if (!url) continue;
    const num = (v) => { const s = String(v == null ? "" : v).replace(/[,%]/g, "").trim(); return /^-?\d*\.?\d+$/.test(s) ? parseFloat(s) : null; };
    rows.push({
      leaf_category: String(head.map.leaf >= 0 ? (c[head.map.leaf] || "") : "").trim(),
      site: String(head.map.site >= 0 ? (c[head.map.site] || "") : "").trim(),
      image_url: url,
      abs_delta: num(head.map.abs >= 0 ? c[head.map.abs] : null),
      ratio: num(head.map.ratio >= 0 ? c[head.map.ratio] : null),
      pos: num(head.map.pos >= 0 ? c[head.map.pos] : null),
      sales: num(head.map.sales >= 0 ? c[head.map.sales] : null),
      hasSiteCol: head.map.site >= 0,
    });
  }
  return { head: head.map, rows };
}

console.log("一、用户这张真实表：没有「排名」，只有「销售额」");
{
  const m = API.mapHeaderRow(H16);
  ok("认出「销售额」列（第 9 列）", m.sales === 8, m.sales);
  ok("没有「排名」列 → pos 为 -1", m.pos === -1, m.pos);
  ok("「有销量站点」列被认出但整列为空", m.site === 7);
  const P = parse(AOA);
  ok("12 行全部解析出来（图片地址都在）", P.rows.length === 12, P.rows.length);
  ok("整批没有环比值", P.rows.every(r => r.ratio == null && r.abs_delta == null));
  /* 勾选站点后，行归入「美国」——与真实导入时一致 */
  P.rows.forEach(r => { r.site = "美国"; });
  const res = API.applyOfficialRank(P.rows);
  ok("名次依据 = 销售额", res.basis === "sales", res.basis);
  ok("12 行都拿到名次", P.rows.every(r => r.rank_abs != null), P.rows.map(r => r.rank_abs));
  ok("名次与销售额严格对应（第一名 35163.03）", (() => {
    const top = P.rows.slice().sort((a, b) => a.rank_abs - b.rank_abs);
    return top[0].sales === 35163.03 && top[11].sales === 6448.82 && top[0].rank_abs === 1 && top[11].rank_abs === 12;
  })(), P.rows.map(r => [r.sales, r.rank_abs]));
  ok("不是全 0 / 不是全 1（真的排了序）", new Set(P.rows.map(r => r.rank_abs)).size === 12);
}

console.log("二、同时有「排名」和「销售额」：一律按销售额（口径统一）");
{
  const aoa = [H16.slice(0, 8).concat(["排名"]).concat(H16.slice(8))];
  for (let i = 0; i < 12; i++) {
    const r = rowOf(i, {});
    r.splice(8, 0, String(i * 2 + 3));      /* 排名故意与销售额顺序不同：3,5,7… */
    aoa.push(r);
  }
  const P = parse(aoa);
  ok("认出「排名」列", P.head.pos >= 0, P.head.pos);
  P.rows.forEach(r => { r.site = "美国"; });
  const res = API.applyOfficialRank(P.rows);
  ok("20261113I：名次依据 = 销售额（不再优先用排名）", res.basis === "sales", res.basis);
  ok("写进去的是销售额批内名次 1..12", P.rows[0].rank_abs === 1 && P.rows[11].rank_abs === 12, P.rows.slice(0, 3).map(r => r.rank_abs));
  ok("排名列的值没有被采用（3,5,7… 不进 rank_abs）", P.rows.map(r => r.rank_abs).join(",") === "1,2,3,4,5,6,7,8,9,10,11,12", P.rows.map(r => r.rank_abs));
}

console.log("二之二、没有「销售额」列时，才退回「排名」");
{
  const cols = ["叶子类目名称", "有销量站点", "排名", "首图url"];
  const aoa = [cols];
  for (let i = 0; i < 6; i++) aoa.push(["POLO衫", "美国", String(i * 2 + 3), "https://img.kwcdn.com/n_" + i + ".jpg"]);
  const P = parse(aoa);
  ok("认出排名列", P.head.pos >= 0, P.head.pos);
  ok("没有销售额列", P.head.sales === -1, P.head.sales);
  const res = API.applyOfficialRank(P.rows);
  ok("名次依据 = 排名", res.basis === "pos", res.basis);
  ok("写进去的是排名列的值（3,5,7…）", P.rows[0].rank_abs === 3 && P.rows[1].rank_abs === 5, P.rows.slice(0, 3).map(r => r.rank_abs));
  ok("标记为回退口径（用于提示跨月不比对）", res.fallback === "pos", res.fallback);
}

console.log("三、既没有排名也没有销售额：退回表格行序");
{
  const cols = ["叶子类目名称", "有销量站点", "首图url", "货品名称"];
  const aoa = [cols];
  for (let i = 0; i < 6; i++) aoa.push(["POLO衫", "", "https://img.kwcdn.com/o_" + i + ".jpg", "款" + i]);
  const P = parse(aoa);
  ok("只有 3 个可用列也能解析", P.rows.length === 6, P.rows.length);
  P.rows.forEach(r => { r.site = "美国"; });
  const res = API.applyOfficialRank(P.rows);
  ok("名次依据 = 行序", res.basis === "order", res.basis);
  ok("第 1 行 = 第 1 名，最后一行为第 6 名", P.rows[0].rank_abs === 1 && P.rows[5].rank_abs === 6, P.rows.map(r => r.rank_abs));
}

console.log("四、排名列只零星填了几行：不能一半官方一半批内混着比");
{
  const aoa = [H16.slice(0, 8).concat(["排名"]).concat(H16.slice(8))];
  for (let i = 0; i < 12; i++) {
    const r = rowOf(i, {});
    r.splice(8, 0, i < 3 ? String(i + 1) : "");   /* 只有 3/12 行有排名 */
    aoa.push(r);
  }
  const P = parse(aoa);
  P.rows.forEach(r => { r.site = "美国"; });
  const res = API.applyOfficialRank(P.rows);
  ok("覆盖不足 60% → 退回销售额", res.basis === "sales", res.basis);
  ok("名次仍是 1..12 连续（没有混入官方名次）", (() => {
    const s = P.rows.map(r => r.rank_abs).sort((a, b) => a - b);
    return s.every((v, i) => v === i + 1);
  })(), P.rows.map(r => r.rank_abs));
}

console.log("五、带环比列的批次：一律不动 rank_abs（两套口径不混）");
{
  const P = parse(AOA);
  P.rows.forEach((r, i) => { r.site = "美国"; r.ratio = i + 1; r.abs_delta = i + 1; r.rank_abs = 99; });
  const res = API.applyOfficialRank(P.rows);
  ok("不接管（applied=false）", res.applied === false, res);
  ok("rank_abs 保持原值 99", P.rows.every(r => r.rank_abs === 99));
}

console.log("六、并列销售额 → 同一名次，后一名跳号");
{
  const aoa = [["叶子类目名称", "有销量站点", "销售额", "首图url"]];
  [100, 90, 90, 70].forEach((v, i) => aoa.push(["POLO衫", "", String(v), "https://img.kwcdn.com/t_" + i + ".jpg"]));
  const P = parse(aoa);
  P.rows.forEach(r => { r.site = "美国"; });
  API.applyOfficialRank(P.rows);
  ok("100 → 1 名", P.rows[0].rank_abs === 1, P.rows[0].rank_abs);
  ok("两个 90 并列 2 名", P.rows[1].rank_abs === 2 && P.rows[2].rank_abs === 2, [P.rows[1].rank_abs, P.rows[2].rank_abs]);
  ok("70 → 4 名（不压成 3）", P.rows[3].rank_abs === 4, P.rows[3].rank_abs);
}

console.log("七、两个站点各自排名，不互相串");
{
  const aoa = [["叶子类目名称", "有销量站点", "销售额", "首图url"]];
  [["美国站", 500], ["美国站", 400], ["英国", 900], ["英国", 100]]
    .forEach(([s, v], i) => aoa.push(["POLO衫", s, String(v), "https://img.kwcdn.com/s_" + i + ".jpg"]));
  const P = parse(aoa);
  API.applyOfficialRank(P.rows);
  const us = P.rows.filter(r => r.site.indexOf("美国") >= 0).map(r => r.rank_abs);
  const uk = P.rows.filter(r => r.site === "英国").map(r => r.rank_abs);
  ok("美国两条：1、2 名", us[0] === 1 && us[1] === 2, us);
  ok("英国两条：也是 1、2 名（各自排）", uk[0] === 1 && uk[1] === 2, uk);
}

console.log("八、源码级：销售额优先的口径写在导入链路里");
{
  ok("有 isPosNum 覆盖度判定", /posN >= Math\.ceil\(n \* 0\.6\)/.test(SRC));
  ok("有 rankByValue 并列名次", /function rankByValue/.test(SRC));
  ok("行序兜底写在最后一级", /按表格行序|按行序/.test(SRC) || /x\.r\.rank_abs = idx \+ 1/.test(SRC));
  ok("回执里会告诉用户用了哪种依据", /位次依据：/.test(SRC));
  ok("预览不再说「只能显示新上榜」", !/系统没有任何可比的依据/.test(SRC));
}

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
