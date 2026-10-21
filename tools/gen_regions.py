# -*- coding: utf-8 -*-
"""按导入表(国家→大洲)生成营销日历的地区分组，写回 js/marketing-data.js 的 REGION_GROUPS。
   生成结果同时落到 tools/regions_map.json，便于后续复核。用法：
   python3 tools/gen_regions.py [xlsx路径]
   不传路径时使用 tools/regions_map.json 里的既有映射重新生成。"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MAP = os.path.join(HERE, 'regions_map.json')
TARGET = os.path.join(ROOT, 'js', 'marketing-data.js')

# 站内聚合标签 → 归属大洲（不存在的会被自动忽略）
ALIAS = {
    '全球':'通用区域','欧美':'通用区域','跨区域':'通用区域','国际':'通用区域',
    '拉美':'南美洲','南美':'南美洲','中美洲':'北美洲','加勒比':'北美洲',
    '欧洲':'欧洲','北欧':'欧洲','西欧':'欧洲','东欧':'欧洲','南欧':'欧洲',
    '东南亚':'亚洲','南亚':'亚洲','中亚':'亚洲','东亚':'亚洲','中东':'亚洲',
    '北非':'非洲','西非':'非洲','东非':'非洲','南部非洲':'非洲','中非':'非洲',
    '大洋洲':'大洋洲','太平洋岛国':'大洋洲',
    # 站内旧写法 / 简称 → 与大洲口径对齐
    '阿联酋':'亚洲','多米尼加':'北美洲','美国':'北美洲','加拿大':'北美洲',
}
ORDER = ['通用区域','亚洲','欧洲','北美洲','南美洲','大洋洲','非洲']

def load_pairs(path=None):
    if path:
        import openpyxl
        wb = openpyxl.load_workbook(path); ws = wb['节日数据']
        hdr = [c.value for c in ws[1]]
        ci, gi = hdr.index('地区'), hdr.index('大洲')
        pairs = []
        for r in ws.iter_rows(min_row=2, values_only=True):
            if r[ci] and r[gi]:
                pairs.append((str(r[ci]).strip(), str(r[gi]).strip()))
        return pairs
    with open(MAP, encoding='utf-8') as f:
        d = json.load(f)
    return [(k, v) for k, v in d['country'].items()]

def build(pairs):
    country, count = {}, {}
    for region, cont in pairs:
        country[region] = cont
        count[region] = count.get(region, 0) + 1
    for k, v in ALIAS.items():
        if k not in country:
            country[k] = v
    groups = {g: [] for g in ORDER}
    for region, cont in country.items():
        g = cont if cont in groups else '通用区域'
        groups[g].append(region)
    for g in groups:
        groups[g].sort(key=lambda r: (-count.get(r, 0), r))
    return country, {g: groups[g] for g in ORDER if groups[g]}

def render(groups):
    lines = ['var REGION_GROUPS = [']
    for i, (g, regs) in enumerate(groups.items()):
        body = ','.join("'" + r.replace("'", "\\'") + "'" for r in regs)
        lines.append("  { label:'%s', regions:[%s] }%s" % (g, body, ',' if i < len(groups)-1 else ''))
    lines.append('];')
    return '\n'.join(lines)

def write_js(block):
    with open(TARGET, encoding='utf-8') as f:
        src = f.read()
    new, n = re.subn(r'var REGION_GROUPS = \[.*?\];', block, src, flags=re.S)
    assert n == 1, 'REGION_GROUPS 未找到或匹配到多处'
    with open(TARGET, 'w', encoding='utf-8') as f:
        f.write(new)

def main():
    xlsx = sys.argv[1] if len(sys.argv) > 1 else None
    country, groups = build(load_pairs(xlsx))
    if xlsx:
        with open(MAP, 'w', encoding='utf-8') as f:
            json.dump({'country': country}, f, ensure_ascii=False, indent=0)
    write_js(render(groups))
    total = sum(len(v) for v in groups.values())
    print('洲分组:', len(groups), '| 地区总数:', total)
    for g, regs in groups.items():
        print('  %-6s %3d 个' % (g, len(regs)))

if __name__ == '__main__':
    main()
