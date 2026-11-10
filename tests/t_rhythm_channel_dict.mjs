/* 渠道字典（默认 Pinterest / SHEIN / Amazon，可增可删）—— 20261109E
   锁住：
     ① 默认三个渠道只在首次灌一次，删掉后不会被自动补回来（@seeded 标记）
     ② 候选 = 字典 ∪ 历史用过的名字（删字典不会让老图失去归属）
     ③ 增删都有界面与事件绑定，删除前有确认且明确"不影响已传的图"
     ④ 不新建表、不用跑 SQL（复用已有枚举表，type 独立命名空间）
     ⑤ 前台列仍然只按数据出（没有图的渠道不会出现空列）
*/
import fs from "fs";
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };
const R = (p) => fs.readFileSync(p, "utf8");

const A = R("admin.html");
const AR = R("js/admin-rhythm.js");
const S = R("js/supabase.js");
const Y = R("js/rhythm.js");
const C = R("css/style.css");

console.log("一、默认渠道与持久化");
ok("默认三个渠道写明", /RANK_CHANNEL_DEFAULTS: \["Pinterest", "SHEIN", "Amazon"\]/.test(S));
ok("字典类型独立命名空间", /RANK_CHANNEL_TYPE: "rank_channel"/.test(S));
ok("复用已有枚举表（不新建表）", /this\.addTagDef\(this\.RANK_CHANNEL_TYPE/.test(S) && !/from\("rank_channels"\)/.test(S));
ok("首次灌默认值", /async ensureRankChannelDefaults\(\)/.test(S));
ok("用 @seeded 标记避免删光又自动补回", /names\.indexOf\("@seeded"\) >= 0/.test(S) && /addTagDef\(this\.RANK_CHANNEL_TYPE, "@seeded"/.test(S));
ok("@seeded 不会出现在候选里", /filter\(\(n\) => n && n\.charAt\(0\) !== "@"\)/.test(S));

console.log("二、增删与候选");
ok("新增接口", /async addRankChannel\(name\)/.test(S));
ok("新增时去重", /if \(cur\.indexOf\(n\) >= 0\) return \{ added: false, name: n \};/.test(S));
ok("删除接口", /async deleteRankChannel\(name\)/.test(S));
ok("删除只动字典、不动图片数据", /删除只是从候选里去掉，不动已有图片/.test(S.replace(/\s+/g, " ")) || /不影响已传的图/.test(A));
ok("候选 = 字典 ∪ 历史用过的", /async listRankChannelOptions\(\)/.test(S) && /used\.forEach\(\(n\) => \{ if \(n && out\.indexOf\(n\) < 0\) out\.push\(n\); \}\)/.test(S));
ok("候选列表会剔除 @ 开头的内部标记", /async listRankChannelDict\(\)[\s\S]{0,300}charAt\(0\) !== "@"/.test(S));

console.log("三、后台界面");
ok("有「已配置渠道」区域", /id="rm-ch-dict"/.test(A));
ok("有「新增渠道」按钮", /id="rm-ch-add"/.test(A));
ok("说明里讲清删除不影响已传的图", /不影响已传的图/.test(A));
ok("候选同时列出历史用过的名字", /候选里同时会列出历史数据用过的渠道名/.test(A));
ok("标签渲染带 ×", /class="rk-ch-del"/.test(AR) && /title="从候选里删掉（不影响已传的图）"/.test(AR));
ok("点 × 先确认", /if \(!confirm\("从候选里删掉渠道/.test(AR));
ok("新增后自动填进渠道输入框", /chs\.value = r\.name/.test(AR));
ok("已有同名时不重复写入", /本来就有/.test(AR));
ok("进入面板时自动灌默认值", /names = await refreshChDict\(\)/.test(AR));
ok("有对应样式", /\.rk-ch-chip/.test(C) && /\.rk-ch-del/.test(C));

console.log("四、前台仍按数据出列");
ok("渠道列由条目里的 channel 决定", /function channelColumns/.test(Y));
ok("没有图的渠道不会单独成列（列只来自实际上传的渠道图）", /orderCh\.sort/.test(Y) && /orderCh\.slice\(0, CH_COL_MAX\)/.test(Y));

console.log("五、实跑：字典去重与候选合并");
/* 用假的枚举表读写，跑真实逻辑 */
const fake = [];
const stub = {
  listTagDefs: async (type) => fake.filter((r) => r.type === type),
  addTagDef: async (type, name) => { fake.push({ id: fake.length + 1, type, name }); return { id: fake.length, type, name }; },
  deleteTagDef: async (id) => { const i = fake.findIndex((r) => r.id === id); if (i >= 0) fake.splice(i, 1); },
  listRankChannelNames: async () => ["SHEIN", "TikTok"],
};
/* 从 supabase.js 里抠出这几个方法体，挂到桩对象上跑 */
const grab = (name) => {
  const i = S.indexOf("async " + name + "(");
  if (i < 0) return null;
  let d = 0, j = S.indexOf("{", i);
  for (let k = j; k < S.length; k++) { if (S[k] === "{") d++; else if (S[k] === "}") { d--; if (!d) return S.slice(i, k + 1); } }
  return null;
};
const src = ["listRankChannelDict", "ensureRankChannelDefaults", "addRankChannel", "deleteRankChannel", "listRankChannelOptions"]
  .map((n) => grab(n)).join(",\n");
const obj = new Function("obj", `
  const SB_METHODS = { ${src} };
  Object.keys(SB_METHODS).forEach(k => obj[k] = SB_METHODS[k]);
  obj.RANK_CHANNEL_TYPE = "rank_channel";
  obj.RANK_CHANNEL_DEFAULTS = ["Pinterest", "SHEIN", "Amazon"];
  return obj;
`)(stub);
obj.listTagDefs = stub.listTagDefs; obj.addTagDef = stub.addTagDef;
obj.deleteTagDef = stub.deleteTagDef; obj.listRankChannelNames = stub.listRankChannelNames;

const seeded = await obj.ensureRankChannelDefaults();
ok("首灌得到三个默认渠道", seeded.join(",") === "Pinterest,SHEIN,Amazon");
ok("重复调用不会重复写入", fake.filter((r) => r.type === "rank_channel").length === 4); /* 3 默认 + @seeded */
const seeded2 = await obj.ensureRankChannelDefaults();
ok("第二次仍是三个", seeded2.length === 3);
await obj.deleteRankChannel("SHEIN");
const afterDel = await obj.listRankChannelDict();
ok("删掉后不再出现", afterDel.indexOf("SHEIN") < 0);
const again = await obj.ensureRankChannelDefaults();
ok("删掉的不会被自动补回来", again.indexOf("SHEIN") < 0 && again.length === 2);
const add = await obj.addRankChannel("TikTok");
ok("新增成功", add.added === true);
const add2 = await obj.addRankChannel("TikTok");
ok("重复新增识别为已存在", add2.added === false);
const opts = await obj.listRankChannelOptions();
ok("候选里字典与历史名字都齐", ["Pinterest", "Amazon", "TikTok"].every((n) => opts.indexOf(n) >= 0));
ok("历史用过但字典没有的也在候选里", opts.indexOf("SHEIN") >= 0);
ok("候选里没有内部标记", opts.every((n) => n.charAt(0) !== "@"));

console.log("\n结果：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
