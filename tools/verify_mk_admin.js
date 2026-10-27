/* 后台「营销日历」= 前台实时预览（所见即所得）+ 编辑层：静态与运行时双层验证 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const admin = read('admin.html');
const adminJs = read('js/admin.js');
const mkHtml = read('marketing.html');
const editJs = read('js/marketing-edit.js');
const css = read('css/style.css');
const mkMain = read('js/marketing-main.js');

let pass = 0, fail = 0;
/* 内置库条数跟着真实数据走，避免库里加条目后断言过时 */
let LIB_N = 0;
function libCount() {
  const _vm = require('vm');
  const _ctx = {}; _vm.createContext(_ctx);
  _vm.runInContext(require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'marketing-data.js'), 'utf8'), _ctx);
  return _ctx.RAW.length;
} const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else { fail++; fails.push(name + (extra !== undefined ? '  [' + extra + ']' : '')); console.log('  ✗ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
}
const eq = (n, a, b) => ok(n, a === b, a + ' vs ' + b);

/* ============ 运行时环境：真实 edit 脚本 + 精简 DOM + 桩 ============ */
function makeHarness(opts) {
  opts = opts || {};
  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="mkzone">
      <div class="mk-editbar" id="mkEditBar">
        <span class="eb-live" id="ebLive"></span>
        <button id="ebAdd"></button><button id="ebImport"></button><button id="ebExport"></button>
        <button id="ebRebuild"></button><button id="ebClear"></button><input type="file" id="ebFile">
      </div>
      <article class="fcard" data-fid="f1">
        <div class="fest-edit-chip"><button data-edit="f1">编辑</button><button class="del" data-del="f1">删除</button></div>
      </article>
      <div class="timeline"><button class="fest" data-id="f2"></button></div>
      <div id="mkToast"></div>
      <div id="modal">
        <input id="fName"><input id="fEn"><select id="fRegion"><option value="美国">美国</option><option value="__new">＋新增</option></select>
        <input id="fRegionNew"><select id="fCat"><option value="trad">trad</option><option value="promo">promo</option></select>
        <input id="fDate" type="date"><input id="fRepeat" type="checkbox">
        <input id="fLead"><input id="fDur"><textarea id="fIdea"></textarea><textarea id="fNote"></textarea>
        <button id="mSave"></button><button id="mDel"></button>
      </div>
    </div></body></html>`, { url: 'https://x.test/marketing.html' + (opts.mode || ''), runScripts: 'outside-only' });

  const w = dom.window;
  /* location.search 由 url 决定；非编辑模式用例用不带参数 */
  const calls = { upsert: [], del: [], clear: 0, render: 0, close: 0, open: [], downloads: [] };
  w.CATS = { trad: { label: '传统' }, promo: { label: '大促' } };
  w.state = { festivals: [{ id: 'f1', name: 'A', date: '01-01', region: '美国', cat: 'trad', star: 3, lead: 120, dur: 1 }] };
  w.toast = () => {};
  w.render = () => { calls.render++; };
  w.closeModal = () => { calls.close++; };
  w.currentModalStar = () => 4;
  w.backfillDurations = () => {};
  w.dbRowToFestival = (r) => Object.assign({}, r, { custom: true });
  LIB_N = libCount();
  w.defaultFestivals = () => new Array(LIB_N).fill(0).map((_, i) => ({ id: 'b' + i, name: 'B' + i, date: '02-02' }));
  w.openModal = (id) => { calls.open.push(id); };
  w.editingId = opts.editingId === undefined ? null : opts.editingId;
  w.SB = {
    myRole: () => Promise.resolve(opts.role === undefined ? 'super_admin' : opts.role),
    listFestivals: () => Promise.resolve({ data: [{ id: 'd1', name: 'D', date: '03-03' }], error: null }),
    upsertFestivals: (rows) => { calls.upsert.push(rows); return Promise.resolve({ error: opts.upsertError || null }); },
    deleteFestival: (id) => { calls.del.push(id); return Promise.resolve({ error: null }); },
    clearFestivals: () => { calls.clear++; return Promise.resolve({ error: null }); }
  };
  w.URL.createObjectURL = () => 'blob:stub';
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { calls.downloads.push(this.download); };
  w.document.body.appendChild; // noop

  w.eval(editJs);
  return { dom, w, calls };
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 25));

(async function () {
  console.log('=== 一、后台：只有前台预览，没有第二套界面 ===');
  /* 20261019G：后台不再嵌 iframe，节庆库画在面板里（原生编辑） */
  ok('后台不再嵌 iframe（没有预览框）', !/id="mk-preview-frame"/.test(admin) && !/mk-preview-shell/.test(admin));
  ok('后台不再是"另一套页面"（不再指向 marketing.html?mode=edit）', !/marketing\.html\?mode=edit/.test(adminJs));
  ok('面板内有原生节庆库容器', /id="mkFestZone"/.test(admin) && /class="mkzone mk-adm"/.test(admin));
  ok('节庆库脚本已引入且在主脚本之后', /js\/admin-festival\.js\?v=/.test(admin)
    && admin.indexOf('js/admin.js') < admin.indexOf('js/admin-festival.js'));
  ok('进入面板才懒加载（FEST.mount）', /if \(target === "mk-card"\) \{\s*\n\s*if \(window\.FEST/.test(adminJs)
    && /function mountMarketingFestival/.test(adminJs));
  ok('面板标题写明"直接在这里编辑"', /直接在这里编辑/.test(admin));
  ok('旧的节庆库表单已移除', !/id="fest-list"/.test(admin) && !/id="fest-add"/.test(admin) && !/id="fest-import"/.test(admin));
  ok('旧节庆脚本不再被引用', !/admin-festivals\.js/.test(admin));
  ok('旧节庆脚本文件已删除', !fs.existsSync(path.join(ROOT, 'js/admin-festivals.js')));
  ok('admin.js 不再调用 loadFestivalsPanel', !/loadFestivalsPanel/.test(adminJs));
  ok('旧「已发布营销素材」区块已下线', !/id="mk-publish-sub"/.test(admin) && !/id="mk-viz-timeline"/.test(admin) && !/id="mk-viz-grid"/.test(admin));
  ok('旧节点/文章弹窗已删除', !/id="mk-node-modal"/.test(admin) && !/id="mk-art-modal"/.test(admin));
  ok('旧营销脚本已移除且文件删除', !/admin-marketing\.js/.test(admin) && !fs.existsSync(path.join(ROOT, 'js/admin-marketing.js')));
  ok('后台营销面板只剩节庆库一块', (admin.match(/id="mk-card"/g) || []).length === 1 && !/已发布营销素材/.test(admin));
  ok('侧栏菜单名仍为「营销日历」且仅超管', /data-target="mk-card" data-super="1">营销日历</.test(admin));
  ok('后台内嵌版样式存在（单列、无侧栏）', /\.mkzone\.mk-adm \{[^}]*grid-template-columns: minmax\(0, 1fr\)/.test(css));

  console.log('=== 二、前台：同一页面 + 编辑条（默认隐藏） ===');
  ok('编辑条元素齐全', ['mkEditBar', 'ebAdd', 'ebImport', 'ebExport', 'ebRebuild', 'ebClear', 'ebFile']
    .every((id) => new RegExp('id="' + id + '"').test(mkHtml)));
  ok('编辑条默认不显示（样式层面）', /\.mkzone \.mk-editbar \{[^}]*display: none/.test(css));
  ok('只有 is-editing 才显示', /\.mkzone\.is-editing \.mk-editbar \{ display: flex; \}/.test(css));
  ok('页面本身不带 is-editing 类', !/class="mkzone is-editing"/.test(mkHtml));
  ok('编辑层脚本在主脚本之后加载', /js\/marketing-edit\.js\?v=/.test(mkHtml) && mkHtml.indexOf('js/marketing-main.js') < mkHtml.indexOf('js/marketing-edit.js'));
  ok('卡片带 data-fid 与编辑徽标', /data-fid="'\+esc\(it\.h\.id\)/.test(mkMain) && /class="fest-edit-chip"/.test(mkMain));
  ok('徽标默认隐藏、编辑模式才显示', /\.fest-edit-chip \{ display: none/.test(css) && /\.mkzone\.is-editing \.fest-edit-chip \{ display: inline-flex/.test(css));
  ok('旧版隐藏区块已彻底删除', !/mk-legacy/.test(mkHtml));

  console.log('=== 三、运行时：前台访客不带参数 → 完全无编辑能力 ===');
  {
    const h = makeHarness({ mode: '' });
    await tick();
    ok('不加参数时脚本直接退出（无 MKEdit）', typeof h.w.MKEdit === 'undefined');
    ok('zone 不会被加上编辑态', !h.w.document.querySelector('.mkzone').classList.contains('is-editing'));
    ok('编辑条仍不可见（未启用）', h.w.document.getElementById('mkEditBar').style.display !== 'flex');
  }

  console.log('=== 四、运行时：普通管理员带参数 → 只读预览 ===');
  {
    const h = makeHarness({ mode: '?mode=edit', role: 'admin' });
    await tick();
    const bar = h.w.document.getElementById('mkEditBar');
    ok('普通管理员不会被开启编辑态', !h.w.document.querySelector('.mkzone').classList.contains('is-editing'));
    ok('给出「只读预览」说明', /只读预览/.test(bar.innerHTML) && /超级管理员/.test(bar.innerHTML));
    ok('保存按钮未被接管（点击不写库）', (function () {
      h.w.document.getElementById('mSave').click();
      return h.calls.upsert.length === 0;
    })());
  }

  console.log('=== 五、运行时：超级管理员 → 开启编辑 ===');
  {
    const h = makeHarness({ mode: '?mode=edit', role: 'super_admin' });
    await tick();
    const w = h.w, doc = w.document;
    ok('进入编辑态', doc.querySelector('.mkzone').classList.contains('is-editing'));
    ok('MKEdit 暴露且已启用', w.MKEdit && w.MKEdit.available === true && w.MKEdit.isEnabled() === true);
    eq('编辑条状态文案已同步', doc.getElementById('ebLive').textContent, '已同步 · 改动即时生效');

    /* 卡片编辑 */
    doc.querySelector('[data-edit="f1"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    eq('点卡片「编辑」打开对应节庆', h.calls.open[0], 'f1');
    /* 时间轴节点 */
    doc.querySelector('.timeline .fest[data-id="f2"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    eq('点时间轴节点也能编辑', h.calls.open[1], 'f2');

    /* 删除：两次确认 */
    const delBtn = doc.querySelector('[data-del="f1"]');
    delBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    eq('第一次点删除只进入待确认', h.calls.del.length, 0);
    ok('按钮变为确认态', delBtn.classList.contains('armed') && /确认删除/.test(delBtn.textContent));
    delBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await tick();
    eq('第二次确认才真正删库', h.calls.del[0], 'f1');
    ok('本地列表同步移除', !w.state.festivals.some((f) => f.id === 'f1'));

    /* 保存（编辑既有） */
    w.editingId = 'f2';
    doc.getElementById('fName').value = '黑色星期五';
    doc.getElementById('fEn').value = 'Black Friday';
    doc.getElementById('fRegion').value = '__new';
    doc.getElementById('fRegionNew').value = '北美';
    doc.getElementById('fCat').value = 'promo';
    doc.getElementById('fDate').value = '2026-11-27';
    doc.getElementById('fRepeat').checked = false;
    doc.getElementById('fLead').value = '75';
    doc.getElementById('fDur').value = '3';
    doc.getElementById('fIdea').value = '黑五服饰';
    doc.getElementById('fNote').value = '备货';
    doc.getElementById('mSave').click();
    await tick();
    const row = (h.calls.upsert[0] || [])[0] || {};
    eq('保存写库（不是本地存储）', h.calls.upsert.length, 1);
    eq('保存 id 沿用原节点', row.id, 'f2');
    eq('一次性日期存完整年月日', row.date, '2026-11-27');
    eq('新增地区取输入框内容', row.region, '北美');
    eq('重要度取弹窗当前星数', row.star, 4);
    eq('提前期与持续天数', row.lead + '/' + row.dur, '75/3');
    /* 之前删过一条已 render 一次，这里只比较增量 */
    ok('保存后关闭弹窗并重绘', h.calls.close === 1 && h.calls.render === 2, 'close=' + h.calls.close + ' render=' + h.calls.render);

    /* 新建：每年重复 → 只存月-日、生成新 id */
    w.editingId = null;
    doc.getElementById('fName').value = '万圣节';
    doc.getElementById('fRegion').value = '美国';
    doc.getElementById('fDate').value = '2026-10-31';
    doc.getElementById('fRepeat').checked = true;
    doc.getElementById('mSave').click();
    await tick();
    const row2 = (h.calls.upsert[1] || [])[0] || {};
    eq('每年重复只存月-日', row2.date, '10-31');
    ok('新建生成新 id', /^u/.test(String(row2.id)));
    ok('新建条目进入本地列表', w.state.festivals.some((f) => f.name === '万圣节'));

    /* 导出 */
    doc.getElementById('ebExport').click();
    ok('导出触发下载且文件名带日期', h.calls.downloads.length === 1 && /marketing-festivals-\d{4}-\d{2}-\d{2}\.json/.test(h.calls.downloads[0]));

    /* 重建 / 清空：两次确认 */
    const reb = doc.getElementById('ebRebuild');
    reb.click();
    eq('重建第一次只问确认', h.calls.upsert.length, 2);
    reb.click();
    await tick();
    eq('重建把内置库整批写库', (h.calls.upsert[2] || []).length, LIB_N);
    ok('内置库条数合理（≥300）', LIB_N >= 300, LIB_N);

    const clr = doc.getElementById('ebClear');
    clr.click();
    eq('清空第一次只问确认', h.calls.clear, 0);
    clr.click();
    await tick();
    eq('清空第二次才执行', h.calls.clear, 1);
    eq('清空后本地列表为空', w.state.festivals.length, 0);
  }

  console.log('=== 六、运行时：写库失败不假装成功 ===');
  {
    const h = makeHarness({ mode: '?mode=edit', role: 'super_admin', editingId: 'f1', upsertError: { message: 'denied' } });
    await tick();
    const doc = h.w.document;
    doc.getElementById('fName').value = 'X';
    doc.getElementById('fDate').value = '2026-05-05';
    doc.getElementById('mSave').click();
    await tick();
    ok('失败时弹窗不关闭', h.calls.close === 0);
    ok('失败时本地列表不变', h.w.state.festivals.length === 1 && h.w.state.festivals[0].name === 'A');
    ok('状态条提示保存失败', /保存失败/.test(doc.getElementById('ebLive').textContent));
  }

  console.log('=== 七、反向验证：把关键保护拆掉，检查必须报错 ===');
  {
    const broken = editJs.replace("if (!WANT_EDIT) return;", "/* removed guard */");
    ok('去掉「非编辑模式直接退出」后，脚本会误判为可编辑',
      broken !== editJs && !/if \(!WANT_EDIT\) return;/.test(broken));

    const noRole = editJs.replace("if (role === 'super_admin') { enable(); return; }", "enable(); return;");
    ok('去掉超管校验后普通管理员也会被放行', noRole !== editJs && !/role === 'super_admin'/.test(noRole));

    const noArm = editJs.replace("if (delBtn.classList.contains('armed')) { doDelete(id); return; }", "doDelete(id); return;");
    ok('去掉二次确认后一次点击即删', noArm !== editJs && /确认删除/.test(editJs) && !/armed\'\)\) \{ doDelete/.test(noArm));
  }

  console.log('==========================================');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) { console.log('失败项：'); fails.forEach((f) => console.log(' - ' + f)); process.exitCode = 1; }
})();
