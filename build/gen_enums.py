#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从《打标枚举总表》生成 js/rank-enums.js（全站唯一枚举源）。
用法: python3 build/gen_enums.py <xlsx> <out.js>
"""
import sys, re, json, openpyxl

SRC, OUT = sys.argv[1], sys.argv[2]

wb = openpyxl.load_workbook(SRC)

def split(v):
    return [x.strip() for x in re.split('[，,]', str(v or '')) if x.strip()]

dims = {}
for r in wb['枚举参考'].iter_rows(min_row=2, values_only=True):
    d = (r[0] or '').strip()
    if not d:
        continue
    dims[d] = {'values': split(r[1]), 'note': (r[2] or '').strip()}

def groups_of(sheet, valcol=1):
    out = []
    for r in wb[sheet].iter_rows(min_row=2, values_only=True):
        g = (r[0] or '').strip()
        v = (r[valcol] or '').strip()
        if v:
            out.append((g, v))
    return out

# 背景：以「枚举参考」为准，剔除已废弃的两个值，补入合并后的新值
BG_VALS = dims['视觉-背景']['values']
BG_LABEL = {
    '室内-居住': '室内 · 居住', '室内-公共': '室内 · 公共', '室内-棚拍': '室内 · 棚拍',
    '室外-街景': '室外 · 街景', '室外-建筑': '室外 · 建筑', '室外-自然': '室外 · 自然',
    '室外-运动': '室外 · 运动', '中性底': '中性底 / 棚拍纯底',
    '视觉-背景·室外·交通工具': '室外 · 交通工具', '视觉-背景·室内·交通工具': '室内 · 交通工具',
}
_bg_of = {}
for g, v in groups_of('背景场景结构'):
    if v in ('室外·交通工具·车厢', '室外·汽车·后备箱行李箱'):
        continue
    _bg_of[v] = BG_LABEL.get(g, g)
# 合并后新增的值（表里只出现在枚举参考）
_bg_of.setdefault('室外·交通工具·汽车后备箱', '室外 · 交通工具')
BG_GROUPED, _idx = [], {}
for v in BG_VALS:
    lab = _bg_of.get(v)
    if not lab:
        raise SystemExit('背景缺分组: ' + v)
    if lab not in _idx:
        _idx[lab] = len(BG_GROUPED)
        BG_GROUPED.append((lab, []))
    BG_GROUPED[_idx[lab]][1].append(v)
assert [v for _, vs in BG_GROUPED for v in vs] == BG_VALS

PATTERN_VALS = dims['图案类型']['values']
PATTERN_GROUPS = []
seen = {}
for g, v in groups_of('图案类型结构'):
    if g not in seen:
        seen[g] = []
        PATTERN_GROUPS.append((g, seen[g]))
    seen[g].append(v)
assert [v for _, vs in PATTERN_GROUPS for v in vs] == PATTERN_VALS

ELEMENT_VALS = dims['图案元素']['values']
ELEMENT_GROUPS = []
seen = {}
for g, v in groups_of('图案元素结构'):
    if g not in seen:
        seen[g] = []
        ELEMENT_GROUPS.append((g, seen[g]))
    seen[g].append(v)
assert [v for _, vs in ELEMENT_GROUPS for v in vs] == ELEMENT_VALS

FABRIC_VALS = dims['面料']['values']
FABRIC_GROUPS = []
seen = {}
for g, v in groups_of('面料明细'):
    if g not in seen:
        seen[g] = []
        FABRIC_GROUPS.append((g, seen[g]))
    seen[g].append(v)
assert [v for _, vs in FABRIC_GROUPS for v in vs] == FABRIC_VALS

FIT_KEYS = ['领型', '袖型', '袖长', '衣长', '松紧度', '裤型', '裤长', '裙长', '腰型']
FEST = dims['节日']['values']
FEST_CN_EA = FEST[:17]
FEST_WEST = FEST[17:32]
FEST_OTHER = FEST[32:45]
FEST_SPORT = FEST[45:]
assert [len(x) for x in (FEST_CN_EA, FEST_WEST, FEST_OTHER, FEST_SPORT)] == [17, 15, 13, 5], '节日分组切分变了，需人工确认'

# ---------- 旧值迁移表 ----------
BG_ALIAS = [(str(r[0]).strip(), str(r[1]).strip()) for r in wb['背景改值映射'].iter_rows(min_row=2, values_only=True) if r[0]]
# 总表的改值表里有两行指向已被合并/删除的值，按 v11 枚举参考修正：
#   汽车·后备箱行李箱 → 室外·交通工具·汽车后备箱（v11 把后备箱并入交通工具组）
#   交通工具·车厢     → 已删除（过泛），不映射，留作历史值
BG_ALIAS = [(a, '室外·交通工具·汽车后备箱' if b == '室外·汽车·后备箱行李箱' else b)
            for a, b in BG_ALIAS if b != '室外·交通工具·车厢']

OLD_ELEMENT = ["纯色/无图案", "拼色", "撞色", "竖条纹", "横条纹", "细条纹", "宽条纹", "格纹", "千鸟格", "威尔士格", "窗格", "维希格", "波点", "碎花", "大花/花卉", "植物叶纹", "藤蔓", "动物纹", "豹纹", "蛇纹", "斑马纹", "虎纹", "奶牛纹", "鳄鱼纹", "迷彩", "几何图案", "菱格", "棋盘格", "人字纹", "抽象图案", "涂鸦", "泼墨", "卡通图案", "人物图案", "动漫IP", "动物图案", "骷髅", "国旗/徽章", "地图", "文字标语", "字母", "标语文字", "品牌LOGO", "数字", "扎染", "晕染/水墨", "渐变", "民族图腾", "刺绣图案", "珠片图案", "满印", "定位印花", "局部印花", "拉链", "抽绳", "口袋", "工装口袋", "贴袋", "荷叶边", "蕾丝", "镂空", "绑带", "开衩", "流苏", "毛边", "撞钉", "铆钉", "拼接", "双层", "翻边", "腰带", "金属扣件", "织带", "肩章", "臂章", "反光条", "抽褶", "褶皱", "口袋盖"]
OLD_SHOOT = ["摆拍", "挂拍", "平铺拍", "人台拍", "3D", "商品图合成", "模拍", "棚拍模特", "外景模特", "街拍", "生活场景抓拍", "直播截帧", "买家秀", "KOL种草图", "全身出镜", "半身出镜", "局部出镜（手/腿/背影）", "不露脸出镜", "多人同框", "细节特写", "动态抓拍", "俯拍平铺", "悬挂悬空", "模特+平铺对比"]

PT = set(PATTERN_VALS); ST = set(dims['结构部件']['values'])
PE = set(ELEMENT_VALS); CR = set(dims['二次工艺']['values'])
SUB = set(dims['视觉-呈现主体']['values'])

MANUAL_ELEMENT = {'卡通图案': ('图案元素', '卡通人物'), '动漫IP': ('图案元素', '动漫角色')}
move_elem = {'图案类型': [], '结构部件': [], '二次工艺': [], '图案元素': []}
legacy_elem = []
for v in OLD_ELEMENT:
    if v in PE:
        continue
    if v in MANUAL_ELEMENT:
        d, t = MANUAL_ELEMENT[v]
        move_elem[d].append([v, t])
    elif v in PT:
        move_elem['图案类型'].append([v, v])
    elif v in ST:
        move_elem['结构部件'].append([v, v])
    elif v in CR:
        move_elem['二次工艺'].append([v, v])
    else:
        legacy_elem.append(v)

SHOOT_VALS = dims['拍摄方式']['values']
MANUAL_SHOOT = {'摆拍': ('视觉-呈现主体', '摆拍'), '买家秀': ('视觉-呈现主体', '买家秀'),
                '细节特写': ('视觉-呈现主体', '细节特写'), '全身出镜': ('视觉-呈现主体', '模特全身'),
                '半身出镜': ('视觉-呈现主体', '模特半身'), '局部出镜（手/腿/背影）': ('视觉-呈现主体', '模特局部'),
                '多人同框': ('视觉-呈现主体', '模特组合（多人）')}
move_shoot = []
legacy_shoot = []
for v in OLD_SHOOT:
    if v in SHOOT_VALS:
        continue
    if v in MANUAL_SHOOT:
        move_shoot.append([v, MANUAL_SHOOT[v][0], MANUAL_SHOOT[v][1]])
    else:
        legacy_shoot.append(v)

STYLE = dims['风格']['values']
FRAME = dims['视觉-画面构成']['values']
SUBJECT = dims['视觉-呈现主体']['values']
MODEL = dims['模特']['values']
CULTURE = dims['文化背景']['values']
PSYCH = dims['消费心理']['values']
CRAFT = dims['二次工艺']['values']
STRUCT = dims['结构部件']['values']
CHANNEL = ["SHEIN", "TEMU", "PINTEREST", "ALIEXPRESS", "AMAZON", "FACEBOOK",
           "TIKTOK", "EBAY", "WALMART", "独立站", "其他"]


def js(v):
    return json.dumps(v, ensure_ascii=False)


def wrap(vals, indent=4, width=104):
    """按宽度折行输出字符串数组"""
    lines, cur = [], ''
    pad = ' ' * indent
    for v in vals:
        piece = js(v) + ', '
        if len(cur) + len(piece) > width and cur:
            lines.append(pad + cur.rstrip())
            cur = ''
        cur += piece
    if cur:
        lines.append(pad + cur.rstrip().rstrip(','))
    return '\n'.join(lines)


def arr(name, vals, comment=''):
    head = ('  /* %s */\n' % comment) if comment else ''
    return '%s  var %s = [\n%s\n  ];\n' % (head, name, wrap(vals))


def grouped(name, groups):
    out = '  var %s = [\n' % name
    for lab, vals in groups:
        out += '    { label: %s, values: [\n%s\n    ] },\n' % (js(lab), wrap(vals, 6))
    out += '  ];\n'
    return out

out = []
out.append('''/* ============================================================================
 * rank-enums.js —— 全站打标枚举的唯一来源
 *
 * 版本：枚举总表 v11（20261102A）  维度 23 个 / 取值 1081 项
 * 生成方式：由《打标枚举总表-终版-v11.xlsx》机械生成，不要手改词表；
 *           要改词先改总表，再重新生成，避免页面与总表各写一套。
 *
 * 覆盖范围（三处共用同一份，任何一处改词只改这里）：
 *   ① 趋势上升榜：后台导出 / 导入 / 前台大图标签面板
 *   ② 视觉专区（图库）：后台导出 / 导入 / 打标面板
 *   ③ 渠道雷达、趋势动向、周报、维度体检、枚举参考工作表
 *
 * v11 相对 v10 的结构性变化（照 v10 打的标不会丢，见文末 normalizeTagSet）：
 *   ① 「视觉-背景」全量带 室内·/室外· 前缀，并按 10 组给出场景结构；
 *      旧值（家居卧室·床品沙发 等）通过 BG_ALIAS 自动改写到新值。
 *   ② 「图案」拆成三列：图案类型（纹样/肌理，87）、图案元素（画的是什么，171）、
 *      结构部件（功能性部件，20）。v10 把三样塞在「图案元素」一列里，
 *      旧值按 MOVE_ELEMENT 自动分拣到对应列，认不出的留作历史值不丢。
 *   ③ 新增「面料」维度（57 项，悬疑维度，配合置信度使用）。
 *   ④ 「拍摄方式」收敛为 7 个互斥值（按支撑物判定），v10 混进来的
 *      模特色/图源类型按 MOVE_SHOOT 分流到「视觉-呈现主体」或留作历史值。
 *
 * 手动标签合并：
 *   视觉专区后台可以在「标签管理」里自行增删标签（存在 tag_defs 表）。
 *   导出打标表时会把这些自定义标签并进对应维度的可选值，
 *   标注「手动」，避免人工填表时发现"我加的标签不在可选项里"。
 *
 * 加载顺序：必须先于 rankexport.js / imageexport.js / rank.js。
 * ==========================================================================*/
(function () {
''')

out.append(arr('STYLE', STYLE, '风格：这件衣服"看起来像什么"（85）'))
out.append('\n')
out.append(arr('VISUAL_BG', BG_VALS, '视觉-背景：衣服身后 / 底下是什么（125，一律带 室内·/室外· 前缀，中性底除外）'))
out.append(grouped('VISUAL_BG_GROUPS', BG_GROUPED))
out.append('\n')
out.append(arr('VISUAL_FRAME', FRAME, '视觉-画面构成：一张图怎么排版（28）'))
out.append('\n')
out.append(arr('VISUAL_SUBJECT', SUBJECT, '视觉-呈现主体：衣服以什么形态出现（34）'))
out.append('\n')
out.append(arr('PATTERN_TYPE', PATTERN_VALS, '图案类型：纹样 / 肌理 / 印花方式（87，十一族＋覆盖方式）'))
out.append(grouped('PATTERN_GROUPS', PATTERN_GROUPS))
out.append('\n')
out.append(arr('ELEMENT', ELEMENT_VALS, '图案元素：图案里画的是什么（171，十八个母题族）'))
out.append(grouped('ELEMENT_GROUPS', ELEMENT_GROUPS))
out.append('\n')
out.append(arr('STRUCT', STRUCT, '结构部件：服装上的功能性 / 装饰性部件（20）'))
out.append('\n')
out.append(arr('CRAFT', CRAFT, '二次工艺（126，含 牛仔工艺-XX 35 项）'))
out.append('\n')
out.append(arr('SHOOT', SHOOT_VALS, '拍摄方式：7 个互斥值，按支撑物判定'))
out.append('\n')
out.append(arr('MODEL', MODEL, '模特（36）'))
out.append('\n')
out.append(arr('CULTURE', CULTURE, '文化背景（96）'))
out.append('\n')
out.append(arr('PSYCH', PSYCH, '消费心理（31）'))
out.append('\n')
out.append(arr('FABRIC', FABRIC_VALS, '面料：口头叫法（专业叫法）（57，图片推测维度）'))
out.append(grouped('FABRIC_GROUPS', FABRIC_GROUPS))
out.append('\n')
out.append(arr('FEST_CN_EA', FEST_CN_EA))
out.append(arr('FEST_WEST', FEST_WEST))
out.append(arr('FEST_OTHER', FEST_OTHER))
out.append(arr('FEST_SPORT', FEST_SPORT))
out.append('''
  /* ============ 图库专有维度 ============ */
  /* 渠道：这张图来自哪个销售平台（不是托管模式） */
''')
out.append(arr('CHANNEL', CHANNEL))
out.append('  var SKIN = MODEL;\n')
out.append('''
  /* ============ 旧口径迁移表（v10 → v11） ============
     作用有两个：
       ① 导入：老表里还在用旧词时不判「未识别」，自动改写到新词；
       ② 展示：库里已存的旧值仍要能显示，不能因为词表换版就静默消失。 */

''')
out.append('  var BG_ALIAS = {\n' + ',\n'.join('    %s: %s' % (js(a), js(b)) for a, b in BG_ALIAS) + '\n  };\n')
out.append('''
  /* 图案：v10 一列里的值，按语义分拣到 v11 的三列 */
''')
out.append('  var MOVE_ELEMENT = {\n' + ',\n'.join(
    '    %s: {\n%s\n    }' % (js(k), ',\n'.join('      %s: %s' % (js(a), js(b)) for a, b in v))
    for k, v in move_elem.items() if v) + '\n  };\n')
out.append('''
  /* 拍摄方式：v10 混进来的模特出镜程度 / 图源类型 → 呈现主体 */
''')
out.append('  var MOVE_SHOOT = {\n' + ',\n'.join('    %s: [%s, %s]' % (js(a), js(b), js(c)) for a, b, c in move_shoot) + '\n  };\n')

# fit block
out.append('  /* ============ 版型（按部位拆分） ============ */\n  var FIT = {\n')
fit_parts = []
for k in FIT_KEYS:
    fit_parts.append('    %s: [\n%s\n    ]' % (k, wrap(dims[k]['values'], 6)))
out.append(',\n'.join(fit_parts) + '\n  };\n')

out.append('''
  /* 历史值：仍允许导入与展示（不判「未识别」），但下拉里不再提供 */
  var LEGACY = %s;
  var LEGACY_ELEMENT = %s;
  var LEGACY_SHOOT = %s;
''' % (js(sorted(set([a for a, _ in BG_ALIAS] + ['场景实景', '多件组合', '无人台挂拍', '平铺', '交通工具·车厢']))),
       js(legacy_elem), js(legacy_shoot)))

out.append('''
  window.APP_ENUM = {
    "风格": STYLE,
    "视觉-背景": VISUAL_BG,
    "视觉-画面构成": VISUAL_FRAME,
    "视觉-呈现主体": VISUAL_SUBJECT,
    "图案类型": PATTERN_TYPE,
    "图案元素": ELEMENT,
    "结构部件": STRUCT,
    "二次工艺": CRAFT,
    "拍摄方式": SHOOT,
    "模特": MODEL,
    "面料": FABRIC,
    "领型": FIT.领型, "袖型": FIT.袖型, "袖长": FIT.袖长, "衣长": FIT.衣长,
    "松紧度": FIT.松紧度, "裤型": FIT.裤型, "裤长": FIT.裤长, "裙长": FIT.裙长, "腰型": FIT.腰型,
    "文化背景": CULTURE,
    "消费心理": PSYCH,
    "节日": FEST_CN_EA.concat(FEST_WEST, FEST_OTHER, FEST_SPORT),
    "渠道": CHANNEL,
    "场景": VISUAL_BG,
    "肤色": SKIN,
    legacy: LEGACY,
    legacyElement: LEGACY_ELEMENT,
    legacyShoot: LEGACY_SHOOT
  };

  /* 视觉三组合并视图：只用于打标进度统计，不参与逐列校验 */
  window.APP_ENUM.视觉 = VISUAL_BG.concat(VISUAL_FRAME, VISUAL_SUBJECT);
  /* 旧值改写表对外暴露：导入端按它把老词改写成新词 */
  window.APP_ENUM.bgAlias = BG_ALIAS;
  window.APP_ENUM.moveElement = MOVE_ELEMENT;
  window.APP_ENUM.moveShoot = MOVE_SHOOT;

  window.APP_ENUM_GROUPS = {
    background: VISUAL_BG_GROUPS,
    pattern: PATTERN_GROUPS,
    element: ELEMENT_GROUPS,
    fabric: FABRIC_GROUPS,
    festival: [
      { label: "中国与东亚", values: FEST_CN_EA },
      { label: "欧美通用", values: FEST_WEST },
      { label: "其他地域与宗教", values: FEST_OTHER },
      { label: "体育赛事", values: FEST_SPORT }
    ],
    visual: [
      { label: "视觉-背景", values: VISUAL_BG },
      { label: "视觉-画面构成", values: VISUAL_FRAME },
      { label: "视觉-呈现主体", values: VISUAL_SUBJECT }
    ],
    fit: [
      { label: "领型", values: FIT.领型 }, { label: "袖型", values: FIT.袖型 },
      { label: "袖长", values: FIT.袖长 }, { label: "衣长", values: FIT.衣长 },
      { label: "松紧度", values: FIT.松紧度 }, { label: "裤型", values: FIT.裤型 },
      { label: "裤长", values: FIT.裤长 }, { label: "裙长", values: FIT.裙长 },
      { label: "腰型", values: FIT.腰型 }
    ]
  };

  /* ===== v10 → v11 取值归一 =====
     导入/回填时调用：把老表里的旧词改写成新词，跨维度的旧值搬到该去的列。
     返回 { tags, moved, unknown }；unknown 才是真正认不出的值（导入时列进「未识别」）。 */
  var DIM_FIELD = {
    "图案类型": "pattern_tags", "结构部件": "struct_tags",
    "二次工艺": "craft_tags", "图案元素": "element_tags"
  };
  window.normalizeTagSet = function (tags) {
    var src = tags || {};
    var out = {};
    Object.keys(src).forEach(function (k) { out[k] = Array.isArray(src[k]) ? src[k].slice() : []; });
    var moved = [], unknown = [];
    function push(field, v) {
      var a = out[field] = out[field] || [];
      if (a.indexOf(v) < 0) a.push(v);
    }
    /* 背景：老值 → 带前缀的新值 */
    var bg = [], vis = out.visual_tags || [];
    vis.forEach(function (v) {
      if (BG_ALIAS[v] && BG_ALIAS[v] !== v) { bg.push(BG_ALIAS[v]); moved.push(["视觉-背景", v, BG_ALIAS[v]]); }
      else bg.push(v);
    });
    if (bg.length) out.visual_tags = bg.filter(function (v, i) { return bg.indexOf(v) === i; });

    /* 图案：按语义分拣到 图案类型 / 结构部件 / 二次工艺 */
    var el = out.element_tags || [];
    delete out.element_tags;
    var keep = [];
    el.forEach(function (v) {
      var hit;
      Object.keys(MOVE_ELEMENT).forEach(function (dim) {
        if (MOVE_ELEMENT[dim][v]) hit = [dim, MOVE_ELEMENT[dim][v]];
      });
      if (hit) { push(DIM_FIELD[hit[0]] || "element_tags", hit[1]); moved.push(["图案元素", v, hit[0] + ":" + hit[1]]); }
      else keep.push(v);
    });
    var elPushed = out.element_tags || [];
    elPushed.forEach(function (v) { if (keep.indexOf(v) < 0) keep.push(v); });
    if (keep.length) out.element_tags = keep;

    /* 拍摄方式：模特出镜程度 → 呈现主体 */
    var sh = out.shoot_tags || [];
    var shKeep = [];
    sh.forEach(function (v) {
      if (MOVE_SHOOT[v]) { push("visual_tags", MOVE_SHOOT[v][1]); moved.push(["拍摄方式", v, MOVE_SHOOT[v][0] + ":" + MOVE_SHOOT[v][1]]); }
      else shKeep.push(v);
    });
    if (shKeep.length) out.shoot_tags = shKeep;
    return { tags: out, moved: moved, unknown: unknown };
  };

  /* 单个维度取允许值（含历史值），供导入校验用 */
  window.enumValuesFor = function (dim) {
    var E = window.APP_ENUM || {};
    var list = (E[dim] || []).slice();
    if (dim === "视觉-背景") list = list.concat(LEGACY);
    if (dim === "图案元素") list = list.concat(LEGACY_ELEMENT);
    if (dim === "拍摄方式") list = list.concat(LEGACY_SHOOT);
    return list;
  };

''')

out.append('''
  /* ===== 后台手动标签并入枚举 =====
     后台「标签管理」里手工加的标签，必须能被下拉选中、被导入校验放行，
     否则会出现「后台能选、导出表里没有、导回来判未识别」的死循环。
     做法：把手动值直接 push 进对应维度的枚举数组（原地扩充），
     所有读 window.APP_ENUM 的地方自动生效；重复调用不会重复添加。 */
  window.APP_ENUM_MANUAL = {};
  var _manualSeen = {};
  window.applyManualTags = function (defs) {
    var MAP = {
      style: "风格", element: "图案元素", pattern: "图案类型", struct: "结构部件",
      fabric: "面料", scene: "视觉-背景", shoot: "拍摄方式",
      skin: "模特", craft: "二次工艺", culture: "文化背景", psych: "消费心理",
      festival: "节日", channel: "渠道"
    };
    var added = 0;
    (defs || []).forEach(function (d) {
      if (!d) return;
      var dim = MAP[d.type];
      var name = String(d.name || "").trim();
      if (!dim || !name) return;
      var key = dim + "|" + name;
      if (_manualSeen[key]) return;
      _manualSeen[key] = 1;
      var list = window.APP_ENUM[dim] = window.APP_ENUM[dim] || [];
      if (list.indexOf(name) < 0) list.push(name);
      (window.APP_ENUM_MANUAL[dim] = window.APP_ENUM_MANUAL[dim] || []).push(name);
      added++;
    });
    /* 视觉合并视图是快照，手动值进来后重建一次 */
    if (added) window.APP_ENUM["视觉"] = VISUAL_BG.concat(VISUAL_FRAME, VISUAL_SUBJECT);
    return added;
  };
  /* 从后台读一次手动标签并合入（页面初始化时调用；失败不影响静态枚举） */
  window.loadManualTagsIntoEnums = async function () {
    try {
      if (!window.SB || typeof SB.listTagDefs !== "function") return 0;
      var defs = await SB.listTagDefs();
      return window.applyManualTags(defs);
    } catch (e) { return 0; }
  };

  /* 兼容旧模块（rankexport.js / imageexport.js 早期读的是这个） */
  window.RANK_VISUAL_ENUM = {
    bg: VISUAL_BG, frame: VISUAL_FRAME, subject: VISUAL_SUBJECT, legacy: LEGACY,
    all: VISUAL_BG.concat(VISUAL_FRAME, VISUAL_SUBJECT),
    bgGroups: VISUAL_BG_GROUPS,
    pattern: PATTERN_TYPE, patternGroups: PATTERN_GROUPS,
    elementGroups: ELEMENT_GROUPS,
    struct: STRUCT, fabric: FABRIC, fabricGroups: FABRIC_GROUPS,
    culture: CULTURE, psych: PSYCH,
    festival: window.APP_ENUM["节日"],
    festivalGroups: window.APP_ENUM_GROUPS.festival
  };
})();
''')

open(OUT, 'w', encoding='utf-8').write(''.join(out))
print('written', OUT)
counts = {k: len(v['values']) for k, v in dims.items()}
print('dims', len(counts), 'total', sum(counts.values()))
