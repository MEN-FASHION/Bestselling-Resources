import re, subprocess

targets = {
 'js/admin-perm.js': 637, 'js/admin-pool.js': 293, 'js/admin-rank.js': 313,
 'js/admin-rhythm.js': 316, 'js/admin-tasks.js': 308, 'js/fav.js': 878,
 'js/marketing-main.js': 1044, 'js/admin-backup.js': 169,
}

for f, line in targets.items():
    src = open(f, encoding='utf-8').read()
    # 修复被误改的三元
    src = src.replace('(async (b && b.kind === "auto")', '(b && b.kind === "auto")')
    lines = src.split('\n')
    idx = line - 1
    done = False
    for i in range(idx, max(-1, idx-120), -1):
        ln = lines[i]
        if 'async' in ln:            # 已近 async 容器
            continue
        if re.search(r'\(\s*\)\s*=>\s*\{', ln):
            lines[i] = re.sub(r'\(\s*\)\s*=>\s*\{', 'async () => {', ln, count=1); done = True; break
        if re.search(r'\(\s*[\w$]+([^()]*)\)\s*=>\s*\{', ln) and 'function' not in ln:
            lines[i] = re.sub(r'\(([^()]*)\)\s*=>\s*\{', r'async (\1) => {', ln, count=1); done = True; break
        m = re.match(r'^(\s*)function\s+([\w$]+)\s*\(', ln)
        if m:
            lines[i] = ln.replace('function', 'async function', 1); done = True; break
        if re.search(r'^\s*[\w$]+\s*=\s*function\s*\(', ln):
            lines[i] = ln.replace('function', 'async function', 1); done = True; break
    open(f,'w',encoding='utf-8').write('\n'.join(lines))
    print(f, 'fixed' if done else 'NOT-FOUND')
