lines = open('js/admin.js', encoding='utf-8').read().split('\n')
start = 1545  # 1546行(1-based) -> index 1545
new = open('_recruit_new.js', encoding='utf-8').read().rstrip('\n').split('\n')
out = lines[:start] + new + ['})();']
open('js/admin.js', 'w', encoding='utf-8').write('\n'.join(out))
print('done, lines:', len(out))