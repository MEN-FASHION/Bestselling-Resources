import re, glob, subprocess, sys

SKIP = {'js/ui-dialog.js'}
total = 0

def wrap_bang(s):
    """把 !confirm(...) 换成 !(await uiConfirm(...))，正确处理括号配对"""
    out = []
    i = 0
    pat = re.compile(r'!\s*(?:window\.)?confirm\s*\(')
    while True:
        m = pat.search(s, i)
        if not m: 
            out.append(s[i:]); break
        out.append(s[i:m.start()])
        # 定位参数括号起点
        open_idx = s.index('(', m.start() + (len(m.group(0)) - 1))
        depth = 0
        j = open_idx
        while j < len(s):
            if s[j] == '(': depth += 1
            elif s[j] == ')':
                depth -= 1
                if depth == 0: break
            j += 1
        inner = s[open_idx+1:j]
        out.append('!(await uiConfirm(' + inner + '))')
        i = j + 1
    return ''.join(out)

for f in sorted(glob.glob('js/*.js')):
    if f in SKIP: continue
    s = open(f, encoding='utf-8').read()
    orig = s
    if 'confirm(' not in s and 'alert(' not in s:
        continue
    # 1) !confirm(...) / !window.confirm(...)
    s = wrap_bang(s)
    # 2) 其余 confirm( → await uiConfirm(
    s = re.sub(r'(?<![.\w$])window\.confirm\s*\(', 'await uiConfirm(', s)
    s = re.sub(r'(?<![\w$.])confirm\s*\(', 'await uiConfirm(', s)
    # 3) alert( → await uiAlert(
    s = re.sub(r'(?<![.\w$])window\.alert\s*\(', 'await uiAlert(', s)
    s = re.sub(r'(?<![\w$.])alert\s*\(', 'await uiAlert(', s)
    if s != orig:
        open(f, 'w', encoding='utf-8').write(s)
        cnt = orig.count('confirm(') + orig.count('alert(')
        total += cnt
        print(f, cnt)
print('TOTAL', total)
