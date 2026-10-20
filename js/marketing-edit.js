/* ============================================================================
 * 营销日历 · 所见即所得编辑层（20261019N）
 * ----------------------------------------------------------------------------
 * 设计原则：只有一套界面。
 *   · 前台访客打开 marketing.html        → 纯展示，无任何编辑入口；
 *   · 后台「营销日历」打开 marketing.html?mode=edit → 同一个页面，多出编辑条与
 *     卡片/节点上的编辑徽标，保存直接写数据库，改完即时生效（后台就是实时预览）。
 * 权限：只有超级管理员能进入编辑模式；普通管理员/访客即使带上参数也不会出现编辑入口。
 * ============================================================================ */
(function () {
  'use strict';

  var qs = String(location.search || '');
  var WANT_EDIT = /[?&]mode=edit(?:&|$)/.test(qs);
  if (!WANT_EDIT) return;

  var zone = document.querySelector('.mkzone');
  if (!zone) return;

  var ready = false, importing = false;
  var $ = function (id) { return document.getElementById(id); };
  function say(m) { try { if (typeof toast === 'function') toast(m); } catch (e) {} }
  function live(m) { var el = $('ebLive'); if (el) el.textContent = m || '已同步'; }

  /* ---------- 1. 权限闸门：非超管一律降级为只读 ---------- */
  function gate() {
    if (!window.SB || typeof SB.myRole !== 'function') { say('未登录，无法编辑'); return; }
    Promise.resolve().then(function () { return SB.myRole(); }).then(function (role) {
      if (role === 'super_admin') { enable(); return; }
      zone.classList.remove('is-editing');
      var bar = $('mkEditBar');
      if (bar) {
        bar.style.display = 'flex';
        bar.innerHTML = '<span class="eb-tag" style="background:linear-gradient(135deg,#8b8378,#6d665c)">只读预览</span>'
          + '<span class="eb-hint">当前账号不是超级管理员，这里是前台效果预览；要维护节庆库请用超级管理员账号登录后台。</span>';
      }
    }).catch(function () { say('角色读取失败，已按只读显示'); });
  }

  /* ---------- 2. 开启编辑模式 ---------- */
  function enable() {
    if (ready) return;
    ready = true;
    zone.classList.add('is-editing');
    bindBar();
    bindCards();
    hookModal();
    live('已同步 · 改动即时生效');
  }

  /* ---------- 3. 编辑条按钮 ---------- */
  function bindBar() {
    var add = $('ebAdd'), imp = $('ebImport'), exp = $('ebExport'),
        reb = $('ebRebuild'), clr = $('ebClear'), file = $('ebFile');

    if (add) add.onclick = function () { window.openModal(null); };

    if (exp) exp.onclick = function () {
      var rows = (state.festivals || []).map(function (f) {
        return { id: f.id, name: f.name, en: f.en || '', region: f.region || '', date: f.date,
                 cat: f.cat, star: f.star, lead: f.lead, dur: f.dur,
                 idea: f.idea || '', note: f.note || '', overrides: f.overrides || null };
      });
      var blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'marketing-festivals-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
      say('已导出 ' + rows.length + ' 条节庆');
    };

    if (imp && file) {
      imp.onclick = function () { file.value = ''; file.click(); };
      file.onchange = function () {
        var f = file.files && file.files[0];
        if (!f || importing) return;
        importing = true;
        var rd = new FileReader();
        rd.onload = function () {
          var arr = null;
          try { arr = JSON.parse(rd.result); } catch (e) { say('文件不是合法 JSON'); importing = false; return; }
          if (!Array.isArray(arr)) { say('JSON 顶层应为数组'); importing = false; return; }
          var clean = [], skip = 0;
          for (var i = 0; i < arr.length; i++) {
            var r = arr[i] || {};
            var nm = String(r.name || '').trim();
            var dt = String(r.date || '').trim();
            if (!nm || !dt) { skip++; continue; }
            clean.push({
              id: String(r.id || ('i' + Date.now().toString(36) + i)),
              name: nm, en: r.en || '', region: r.region || '其他', date: dt,
              cat: (window.CATS && CATS[r.cat]) ? r.cat : 'trad',
              star: Math.min(5, Math.max(1, parseInt(r.star, 10) || 3)),
              lead: Math.max(0, parseInt(r.lead, 10) || 120),
              dur: Math.max(1, parseInt(r.dur, 10) || 1),
              idea: r.idea || '', note: r.note || '',
              overrides: (r.overrides && typeof r.overrides === 'object') ? r.overrides : null
            });
          }
          live('导入中…');
          Promise.resolve().then(function () { return SB.upsertFestivals(clean); }).then(function (res) {
            importing = false;
            if (res && res.error) { live('导入失败'); say('导入失败：' + (res.error.message || '请检查权限')); return; }
            say('已导入 ' + clean.length + ' 条' + (skip ? ('，跳过 ' + skip + ' 条缺名称/日期') : ''));
            reload();
          }).catch(function () { importing = false; live('导入失败'); say('导入失败，请稍后重试'); });
        };
        rd.readAsText(f);
      };
    }

    if (reb) reb.onclick = function () {
      if (this.getAttribute('data-armed') !== '1') {
        this.setAttribute('data-armed', '1'); this.textContent = '确认重建？';
        var self = this;
        setTimeout(function () { self.removeAttribute('data-armed'); self.textContent = '用内置库重建'; }, 4000);
        return;
      }
      this.removeAttribute('data-armed'); this.textContent = '用内置库重建';
      var list = (typeof defaultFestivals === 'function') ? defaultFestivals() : [];
      live('写入内置库…');
      Promise.resolve().then(function () { return SB.upsertFestivals(list); }).then(function (res) {
        if (res && res.error) { live('重建失败'); say('重建失败：' + (res.error.message || '请检查权限')); return; }
        say('已用内置库重建 ' + list.length + ' 条节庆');
        reload();
      }).catch(function () { live('重建失败'); say('重建失败，请稍后重试'); });
    };

    if (clr) clr.onclick = function () {
      if (this.getAttribute('data-armed') !== '1') {
        this.setAttribute('data-armed', '1'); this.textContent = '确认清空？';
        var self = this;
        setTimeout(function () { self.removeAttribute('data-armed'); self.textContent = '清空库'; }, 4000);
        return;
      }
      this.removeAttribute('data-armed'); this.textContent = '清空库';
      live('清空中…');
      Promise.resolve().then(function () { return SB.clearFestivals(); }).then(function (res) {
        if (res && res.error) { live('清空失败'); say('清空失败：' + (res.error.message || '请检查权限')); return; }
        say('已清空数据库节庆库');
        state.festivals = [];
        if (typeof render === 'function') render();
        live('已清空');
      }).catch(function () { live('清空失败'); say('清空失败，请稍后重试'); });
    };
  }

  /* ---------- 4. 卡片 / 时间轴上的编辑入口（事件代理，重绘后仍有效） ---------- */
  function bindCards() {
    document.addEventListener('click', function (e) {
      if (!ready) return;
      var t = e.target;
      if (!t || !t.closest) return;

      var editBtn = t.closest('[data-edit]');
      if (editBtn && zone.contains(editBtn)) {
        e.preventDefault(); e.stopPropagation();
        window.openModal(editBtn.getAttribute('data-edit'));
        return;
      }
      var delBtn = t.closest('[data-del]');
      if (delBtn && zone.contains(delBtn)) {
        e.preventDefault(); e.stopPropagation();
        var id = delBtn.getAttribute('data-del');
        if (delBtn.classList.contains('armed')) { doDelete(id); return; }
        delBtn.classList.add('armed'); delBtn.textContent = '确认删除';
        setTimeout(function () { delBtn.classList.remove('armed'); delBtn.textContent = '删除'; }, 3600);
        return;
      }
      var node = t.closest('.timeline .fest[data-id]');
      if (node && zone.contains(node)) {
        e.preventDefault(); e.stopPropagation();
        window.openModal(node.getAttribute('data-id'));
      }
    }, true);
  }

  function doDelete(id) {
    var name = '';
    var list = state.festivals || [];
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { name = list[i].name; break; } }
    live('删除中…');
    Promise.resolve().then(function () { return SB.deleteFestival(id); }).then(function (res) {
      if (res && res.error) { live('删除失败'); say('删除失败：' + (res.error.message || '请检查权限')); return; }
      for (var j = 0; j < list.length; j++) { if (list[j].id === id) { list.splice(j, 1); break; } }
      if (typeof render === 'function') render();
      say('已删除「' + (name || id) + '」');
      live('已同步');
    }).catch(function () { live('删除失败'); say('删除失败，请稍后重试'); });
  }

  /* ---------- 5. 接管编辑弹窗的「保存 / 删除」→ 写数据库（而不是本地存储） ---------- */
  var origOpen = (typeof openModal === 'function') ? openModal : null;
  function hookModal() {
    var save = $('mSave'), del = $('mDel');
    if (!save) return;

    save.onclick = function () {
      var name = ($('fName').value || '').trim();
      if (!name) { say('请填写节日名称'); return; }
      var dv = $('fDate').value;
      if (!dv) { say('请选择日期'); return; }
      var rep = $('fRepeat').checked;
      var p = dv.split('-');
      var dateStr = rep ? (p[1] + '-' + p[2]) : dv;

      var regSel = $('fRegion').value;
      var region = regSel === '__new'
        ? (($('fRegionNew').value || '').trim() || '其他') : regSel;
      var star = (typeof currentModalStar === 'function') ? currentModalStar() : 3;
      var lead = parseInt($('fLead').value, 10); if (isNaN(lead) || lead < 0) lead = 0;
      var dur = parseInt($('fDur').value, 10); if (isNaN(dur) || dur < 1) dur = 1;

      var id = editingId;
      var isNew = !id;
      var row = {
        id: id || ('u' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36)),
        name: name,
        en: ($('fEn').value || '').trim(),
        region: region,
        date: dateStr,
        cat: $('fCat').value,
        star: star,
        lead: lead,
        dur: dur,
        idea: ($('fIdea').value || '').trim(),
        note: ($('fNote').value || '').trim(),
        overrides: (function () {
          var h = null, list = state.festivals || [];
          for (var i = 0; i < list.length; i++) { if (list[i].id === id) { h = list[i]; break; } }
          return h ? (h.overrides || null) : null;
        })()
      };

      live('保存中…');
      save.disabled = true;
      Promise.resolve().then(function () { return SB.upsertFestivals([row]); }).then(function (res) {
        save.disabled = false;
        if (res && res.error) { live('保存失败'); say('保存失败：' + (res.error.message || '请检查权限与建表脚本')); return; }
        var list = state.festivals || [];
        var hit = -1;
        for (var i = 0; i < list.length; i++) { if (list[i].id === row.id) { hit = i; break; } }
        var local = (typeof dbRowToFestival === 'function') ? dbRowToFestival(row) : row;
        if (hit >= 0) list[hit] = local; else list.push(local);
        if (typeof backfillDurations === 'function') backfillDurations(list);
        if (typeof closeModal === 'function') closeModal();
        if (typeof render === 'function') render();
        say((isNew ? '已创建「' : '已保存「') + name + '」');
        live('已同步 · 改动即时生效');
      }).catch(function () { save.disabled = false; live('保存失败'); say('保存失败，请稍后重试'); });
    };

    if (del) {
      del.onclick = function () {
        if (this.getAttribute('data-confirm') !== '1') {
          this.setAttribute('data-confirm', '1');
          this.textContent = '再点一次确认删除';
          return;
        }
        if (typeof closeModal === 'function') closeModal();
        doDelete(editingId);
      };
    }
  }

  /* openModal 每次重建弹窗 DOM，保存/删除按钮需要重新接管 */
  if (origOpen) {
    window.openModal = function (id) { origOpen(id); if (ready) hookModal(); };
  }

  /* ---------- 6. 数据变更后重新读库刷新（保证与库一致） ---------- */
  function reload() {
    live('读取中…');
    Promise.resolve().then(function () { return SB.listFestivals(); }).then(function (res) {
      var rows = (res && res.data) || [];
      if (!rows.length) { live('库为空'); return; }
      var list = [];
      for (var i = 0; i < rows.length; i++) {
        var f = (typeof dbRowToFestival === 'function') ? dbRowToFestival(rows[i]) : null;
        if (f && f.name && f.date) list.push(f);
      }
      if (typeof backfillDurations === 'function') backfillDurations(list);
      state.festivals = list;
      if (typeof render === 'function') render();
      live('已同步 · 改动即时生效');
    }).catch(function () { live('读取失败'); });
  }

  /* 供后台或脚本调用 */
  window.MKEdit = { available: true, enable: enable, reload: reload, isEnabled: function () { return ready; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', gate);
  else gate();
})();
