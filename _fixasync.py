import subprocess, re, glob, sys

def check(f):
    r = subprocess.run(['node','--check',f], capture_output=True, text=True)
    if r.returncode == 0: return None
    m = re.search(r':(\d+)\n', r.stderr)
    line = int(m.group(1)) if m else None
    return line, r.stderr

FUNC = re.compile(r'^(\s*)(async\s+)?function\s+[\w$]*\s*\(')
ASSIGN = re.compile(r'^(\s*)(?:var|let|const)?\s*[\w$]+\s*=\s*(async\s+)?(?:function|\()')
METHOD = re.compile(r'^(\s*)(?:async\s+)?[\w$]+\s*\([^)]*\)\s*\{')
ARROW = re.compile(r'^(\s*)(.*?)\(([^()]*)\)\s*=>\s*\{')

def add_async(lines, idx):
    """从 await 所在行向上找函数头，加 async。返回是否成功"""
    for i in range(idx, -1, -1):
        ln = lines[i]
        m = FUNC.match(ln)
        if m and not m.group(2):
            lines[i] = ln.replace('function', 'async function', 1)
            return True
        m = ASSIGN.match(ln)
        if m and not m.group(2):
            if 'function' in ln:
                lines[i] = ln.replace('function', 'async function', 1)
            else:
                lines[i] = re.sub(r'=\s*\(', '= (async (', ln, count=1)
            return True
        m = METHOD.match(ln)
        if m and 'async' not in ln and 'if' not in ln and 'for' not in ln and 'while' not in ln and 'switch' not in ln:
            lines[i] = ln.replace('(', '(async_args_marker(', 0) if False else re.sub(r'^(\s*)([\w$]+)\s*\(', r'\1\2(/*async*/', ln, count=1)
            return 'method'
    return False

for f in sorted(glob.glob('js/*.js')):
    if f == 'js/ui-dialog.js': continue
    for _ in range(60):
        res = check(f)
        if not res: break
        line, err = res
        if 'await is only valid' not in err:
            break
        lines = open(f, encoding='utf-8').read().split('\n')
        ok = add_async(lines, line-1)
        if not ok:
            print('MANUAL', f, line, err.split('\n')[0])
            break
        if ok == 'method':
            print('METHOD-MANUAL', f, line)
            open(f,'w',encoding='utf-8').write('\n'.join(lines))
            break
        open(f,'w',encoding='utf-8').write('\n'.join(lines))
    else:
        print('LOOP-LIMIT', f)
print('done')
