/* ============================================================
 * 后台「营销日历 · 节庆库」
 * ------------------------------------------------------------
 * 节庆库只有一份，存在数据库里（表 marketing_festivals）：
 *   前台只读展示；新建 / 修改 / 删除 / 导入 / 导出 全在这个面板。
 * 每次改动立刻落库，不需要再点"保存到服务器"。
 * ============================================================ */
(function () {
  var LIST = [];
  var Q = '';
  var editingId = null;
  var loaded = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, ok) {
    if (typeof sbToast === 'function') sbToast(msg, ok !== false);
  }
  function catLabel(k) { return (window.CATS && CATS[k]) ? CATS[k].label : (k || '传统节庆'); }

  function normMMDD(v) {
    if (typeof v !== 'string') return '';
    var s = v.trim().replace(/[\/.]/g, '-');
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s) || /^(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) return '';
    var mo = parseInt(m[m.length - 2], 10), d = parseInt(m[m.length - 1], 10);
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
    return (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
  }

  /* 内置节庆库（js/marketing-data.js 里的 RAW）→ 统一结构 */
  function builtinList() {
    var out = [];
    if (typeof RAW === 'undefined' || !RAW || !RAW.length) return out;
    for (var i = 0; i < RAW.length; i++) {
      var r = RAW[i];
      out.push({
        id: 'd' + i, name: r[0], en: r[1] || '', region: r[2] || '其他',
        date: normMMDD(r[3]) || r[3], cat: r[4] || 'trad',
        star: r[5] || 3, lead: r[6] == null ? 120 : r[6],
        idea: r[7] || '', overrides: r[8] || null,
        dur: (r[9] | 0) || 1, note: '', sort_no: i
      });
    }
    return out;
  }

  /* ---------- 数据 ---------- */
  function normalize(r, idx) {
    var o = {};
    o.id = String(r.id || ('i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)));
    o.name = String(r.name || '').trim();
    o.date = normMMDD(r.date) || String(r.date || '');
    o.en = r.en || '';
    o.region = r.region || '其他';
    o.cat = (window.CATS && CATS[r.cat]) ? r.cat : 'trad';
    o.star = Math.min(5, Math.max(1, parseInt(r.star, 10) || 3));
    o.lead = Math.max(0, parseInt(r.lead, 10) || 120);
    o.dur = Math.max(1, parseInt(r.dur, 10) || 1);
    o.idea = r.idea || '';
    o.note = r.note || '';
    o.overrides = (r.overrides && typeof r.overrides === 'object') ? r.overrides : null;
    o.sort_no = (r.sort_no == null ? idx : r.sort_no) | 0;
    return o;
  }

  function load() {
    var box = $('fest-list');
    if (!box) return;
    box.innerHTML = '<div class="hint">读取中…</div>';
    Promise.resolve()
      .then(function () { return SB.listFestivals(); })
      .then(function (res) {
        if (res && res.error) { box.innerHTML = '<div class="hint">读取失败，请确认已执行 tools/setup_marketing.sql。</div>'; return; }
        LIST = (res && res.data ? res.data : []).map(normalize);
        loaded = true;
        render();
      })
      .catch(function () {
        box.innerHTML = '<div class="hint">读取失败，请稍后重试。</div>';
      });
  }

  function render() {
    var box = $('fest-list'), stat = $('fest-stat'), empty = $('fest-empty');
    if (!box) return;
    var q = Q.trim().toLowerCase();
    var rows = LIST.filter(function (f) {
      if (!q) return true;
      return (f.name + ' ' + f.en + ' ' + f.region + ' ' + catLabel(f.cat)).toLowerCase().indexOf(q) >= 0;
    });
    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.sort_no | 0) - (b.sort_no | 0);
    });
    if (stat) stat.textContent = LIST.length ? ('共 ' + LIST.length + ' 个节庆' + (q ? '，匹配 ' + rows.length + ' 个' : '')) : '数据库里还没有节庆';
    if (empty) {
      if (!LIST.length && loaded) {
        empty.classList.remove('hidden');
        empty.textContent = '数据库里还没有节庆。可以点「用内置库重建」把内置的整套节庆写进数据库，前台立刻就能看到。';
      } else {
        empty.classList.add('hidden');
        empty.textContent = '';
      }
    }
    if (!rows.length) { box.innerHTML = q ? '<div class="hint">没有匹配的节日。</div>' : ''; return; }

    var h = '<div class="fest-row fest-head"><span>名称</span><span>日期</span><span>地区</span><span>类别</span><span>重要度</span><span>提前期</span><span>持续</span><span>操作</span></div>';
    for (var i = 0; i < rows.length; i++) {
      var f = rows[i];
      h += '<div class="fest-row" data-id="' + esc(f.id) + '">'
        + '<span class="fest-name" title="' + esc(f.en) + '">' + esc(f.name)
        + (f.overrides ? ' <i class="fest-flag">年度浮动</i>' : '') + '</span>'
        + '<span class="num">' + esc(f.date) + '</span>'
        + '<span>' + esc(f.region) + '</span>'
        + '<span>' + esc(catLabel(f.cat)) + '</span>'
        + '<span class="num">' + '★'.repeat(f.star) + '</span>'
        + '<span class="num">' + f.lead + ' 天</span>'
        + '<span class="num">' + f.dur + ' 天</span>'
        + '<span class="fest-act"><button class="btn-ghost small" data-act="edit">编辑</button>'
        + '<button class="btn-ghost small" data-act="del">删除</button></span>'
        + '</div>';
    }
    box.innerHTML = h;
  }

  /* ---------- 弹窗 ---------- */
  function fillCatSelect() {
    var sel = $('fest-cat');
    if (!sel) return;
    var h = '';
    var keys = window.CATS ? Object.keys(CATS) : ['trad'];
    for (var i = 0; i < keys.length; i++) h += '<option value="' + keys[i] + '">' + esc(CATS[keys[i]].label) + '</option>';
    sel.innerHTML = h;
  }
  function fillRegionList() {
    var dl = $('fest-region-list');
    if (!dl) return;
    var set = {}, arr = [];
    for (var i = 0; i < LIST.length; i++) { if (LIST[i].region && !set[LIST[i].region]) { set[LIST[i].region] = 1; arr.push(LIST[i].region); } }
    if (window.REGION_GROUPS) {
      for (var g = 0; g < REGION_GROUPS.length; g++) {
        for (var k = 0; k < REGION_GROUPS[g].regions.length; k++) {
          var rn = REGION_GROUPS[g].regions[k];
          if (!set[rn]) { set[rn] = 1; arr.push(rn); }
        }
      }
    }
    arr.sort();
    dl.innerHTML = arr.map(function (r) { return '<option value="' + esc(r) + '">'; }).join('');
  }

  function openModal(id) {
    fillCatSelect(); fillRegionList();
    editingId = id || null;
    var f = null;
    if (id) { for (var i = 0; i < LIST.length; i++) { if (LIST[i].id === id) { f = LIST[i]; break; } } }
    $('fest-modal-title').textContent = f ? '编辑节日' : '新建节日';
    $('fest-name').value = f ? f.name : '';
    $('fest-en').value = f ? f.en : '';
    $('fest-date').value = f ? f.date : '';
    $('fest-region').value = f ? f.region : '';
    $('fest-cat').value = f ? f.cat : 'trad';
    $('fest-star').value = String(f ? f.star : 3);
    $('fest-lead').value = String(f ? f.lead : 120);
    $('fest-dur').value = String(f ? f.dur : 1);
    $('fest-idea').value = f ? f.idea : '';
    $('fest-note').value = f ? f.note : '';
    $('fest-overrides').value = (f && f.overrides) ? JSON.stringify(f.overrides) : '';
    $('fest-mask').classList.remove('hidden');
  }
  function closeModal() { $('fest-mask').classList.add('hidden'); editingId = null; }

  function readForm() {
    var name = $('fest-name').value.trim();
    if (!name) { toast('请填写节日名称', false); return null; }
    var date = normMMDD($('fest-date').value);
    if (!date) { toast('日期请填 MM-DD，例如 10-31', false); return null; }
    var ov = null;
    var ovRaw = $('fest-overrides').value.trim();
    if (ovRaw) {
      try { ov = JSON.parse(ovRaw); } catch (e) { toast('「指定年份日期」不是合法的 JSON', false); return null; }
      if (!ov || typeof ov !== 'object') { toast('「指定年份日期」应为 {"2027":"02-06"} 这样的对象', false); return null; }
    }
    return normalize({
      id: editingId || ('i' + Date.now().toString(36)),
      name: name, en: $('fest-en').value.trim(), date: date,
      region: $('fest-region').value.trim() || '其他',
      cat: $('fest-cat').value,
      star: $('fest-star').value, lead: $('fest-lead').value, dur: $('fest-dur').value,
      idea: $('fest-idea').value.trim(), note: $('fest-note').value.trim(),
      overrides: ov,
      sort_no: editingId ? undefined : LIST.length
    }, editingId ? 0 : LIST.length);
  }

  function save() {
    var row = readForm();
    if (!row) return;
    if (editingId) {
      for (var i = 0; i < LIST.length; i++) {
        if (LIST[i].id === editingId) { row.sort_no = LIST[i].sort_no | 0; LIST[i] = row; break; }
      }
    } else {
      LIST.push(row);
    }
    Promise.resolve().then(function () { return SB.upsertFestivals([row]); }).then(function (res) {
      if (res && res.error) { toast('保存失败：' + (res.error.message || '请检查权限与建表脚本'), false); load(); return; }
      closeModal(); render(); toast('已保存「' + row.name + '」，前台即时生效');
    });
  }

  function del(id) {
    var f = null;
    for (var i = 0; i < LIST.length; i++) { if (LIST[i].id === id) { f = LIST[i]; break; } }
    if (!f) return;
    if (!confirm('确认删除「' + f.name + '」？删除后前台不再展示这个节日。')) return;
    Promise.resolve().then(function () { return SB.deleteFestival(id); }).then(function (res) {
      if (res && res.error) { toast('删除失败：' + (res.error.message || '请检查权限'), false); return; }
      LIST = LIST.filter(function (x) { return x.id !== id; });
      render(); toast('已删除「' + f.name + '」');
    });
  }

  /* ---------- 导入 / 导出 / 重建 ---------- */
  function exportJson() {
    var payload = { version: 1, exportedAt: new Date().toISOString(), festivals: LIST };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'festival-library-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast('已导出 ' + LIST.length + ' 个节庆');
  }

  function importFile(file) {
    var rd = new FileReader();
    rd.onload = function () {
      var obj;
      try { obj = JSON.parse(rd.result); } catch (e) { toast('JSON 解析失败，请检查文件', false); return; }
      var arr = Array.isArray(obj) ? obj : (obj && obj.festivals);
      if (!Array.isArray(arr) || !arr.length) { toast('文件里没有节庆数据', false); return; }
      var clean = [], skip = 0;
      for (var i = 0; i < arr.length; i++) {
        var x = arr[i];
        if (!x || typeof x !== 'object' || !x.name) { skip++; continue; }
        var md = normMMDD(x.date);
        if (!md) { skip++; continue; }
        clean.push(normalize(Object.assign({}, x, { date: md }), i));
      }
      if (!clean.length) { toast('没有可用记录（' + skip + ' 条被跳过）', false); return; }
      if (!confirm('导入 ' + clean.length + ' 个节庆？同标识的记录会被覆盖，其余不受影响。' + (skip ? '（' + skip + ' 条格式不对已跳过）' : ''))) return;
      Promise.resolve().then(function () { return SB.upsertFestivals(clean); }).then(function (res) {
        if (res && res.error) { toast('导入失败：' + (res.error.message || '请检查权限'), false); return; }
        toast('已导入 ' + clean.length + ' 个节庆'); load();
      });
    };
    rd.readAsText(file);
  }

  function rebuildFromBuiltin() {
    var list = builtinList();
    if (!list.length) { toast('内置库读取失败', false); return; }
    if (!confirm('用内置库重建？会用内置的 ' + list.length + ' 个节庆覆盖同标识记录（你新建的节日与修改不会被删）。')) return;
    Promise.resolve().then(function () { return SB.upsertFestivals(list); }).then(function (res) {
      if (res && res.error) { toast('重建失败：' + (res.error.message || '请检查权限'), false); return; }
      toast('已写入 ' + list.length + ' 个节庆'); load();
    });
  }

  function clearAll() {
    if (!LIST.length) { toast('数据库里已经是空的', false); return; }
    if (!confirm('清空数据库里的全部 ' + LIST.length + ' 个节庆？前台将不再显示任何节庆（内置库不会被删，随时可以重建）。')) return;
    Promise.resolve().then(function () { return SB.clearFestivals(); }).then(function (res) {
      if (res && res.error) { toast('清空失败：' + (res.error.message || '请检查权限'), false); return; }
      LIST = []; render(); toast('已清空');
    });
  }

  /* ---------- 绑定 ---------- */
  function bind() {
    if (!$('fest-list') || $('fest-list').dataset.bound === '1') return;
    $('fest-list').dataset.bound = '1';

    $('fest-add').addEventListener('click', function () { openModal(null); });
    $('fest-export').addEventListener('click', exportJson);
    $('fest-import').addEventListener('click', function () { $('fest-import-file').click(); });
    $('fest-import-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importFile(f);
      e.target.value = '';
    });
    $('fest-reset').addEventListener('click', rebuildFromBuiltin);
    $('fest-clear').addEventListener('click', clearAll);
    $('fest-search').addEventListener('input', function () { Q = this.value || ''; render(); });

    $('fest-list').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var row = b.closest('.fest-row');
      var id = row ? row.getAttribute('data-id') : '';
      if (b.getAttribute('data-act') === 'edit') openModal(id);
      else del(id);
    });

    $('fest-cancel').addEventListener('click', closeModal);
    $('fest-save').addEventListener('click', save);
    $('fest-mask').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('fest-mask').classList.contains('hidden')) closeModal();
    });
  }

  window.loadFestivalsPanel = function () {
    bind();
    load();
  };
})();
