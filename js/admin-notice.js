/* ============================================================
 * TREND BANK · 后台管理（notice）
 * 说明：本文件由原单文件 admin.js 按面板拆分而来。
 *  - 共享状态在文件顶部声明（全局作用域，跨文件可见）
 *  - 函数定义在文件内 IIFE 中，末尾通过 Object.assign(window, {...}) 暴露给其它模块
 * ============================================================ */

/* ---------- 共享状态 ---------- */
// ================= 公告管理：编辑/发布/下架/删除 + 图文 =================
let noticeImages = [];

// 已上传图片路径数组（R2 notices/）
let noticeEditingId = null;

let noticeQuill = null;
(function () {

function bindNotice() {
    const titleEl = document.querySelector("#notice-title");
    const pubEl = document.querySelector("#notice-published");
    const saveBtn = document.querySelector("#notice-save");
    const resetBtn = document.querySelector("#notice-reset");

    // 初始化富文本编辑器（Quill）
    const editorEl = document.querySelector("#notice-content-editor");
    if (editorEl && typeof window.Quill !== "undefined") {
      noticeQuill = new window.Quill(editorEl, {
        theme: "snow",
        placeholder: "公告正文：可编辑格式、插入图片…",
        modules: {
          toolbar: {
            container: "#notice-toolbar",
            handlers: {
              image: function () {
                const inp = document.createElement("input");
                inp.type = "file";
                inp.accept = "image/*";
                inp.multiple = true;
                inp.onchange = () => {
                  const files = Array.from(inp.files || []);
                  const range = noticeQuill.getSelection(true);
                  files.forEach((f, i) => {
                    uploadNoticeImage(f).then(path => {
                      if (!path) return;
                      const idx = (range && range.index != null && i === 0) ? range.index : noticeQuill.getLength() - 1;
                      noticeQuill.insertEmbed(idx, "image", SB.noticeImageUrl(path), "user");
                      noticeQuill.setSelection(idx + 1, 0);
                    });
                  });
                };
                inp.click();
              }
            }
          }
        }
      });
      // 图片上传成功后用于编辑器插入的额外通知
    } else if (editorEl) {
      noticeQuill = null;
    }

    if (titleEl) titleEl.addEventListener("input", () => { if (saveBtn) saveBtn.disabled = !titleEl.value.trim(); });

    // 图片选择/上传（正文下方额外图片）
    const pickBtn = document.querySelector("#notice-img-pick");
    const imgInput = document.querySelector("#notice-img-input");
    if (pickBtn && imgInput) {
      pickBtn.addEventListener("click", () => imgInput.click());
      imgInput.addEventListener("change", () => {
        const files = Array.from(imgInput.files || []);
        imgInput.value = "";
        files.forEach(f => uploadNoticeImage(f, false));
      });
    }
    renderNoticeThumbs();

    if (saveBtn) saveBtn.addEventListener("click", () => doSaveNotice(titleEl, pubEl));
    if (resetBtn) resetBtn.addEventListener("click", () => resetNoticeForm(titleEl, pubEl));

    loadNoticeAdminList();
  }

async function uploadNoticeImage(file, toList) {
    if (file.type && file.type.indexOf("image/") !== 0) {
      sbToast("仅支持图片文件", false);
      return null;
    }
    try {
      const path = await SB.uploadNoticeImage(file);
      if (toList !== false) {
        noticeImages.push(path);
        renderNoticeThumbs();
      }
      sbToast("图片已添加");
      return path;
    } catch (e) {
      sbToast("图片上传失败：" + (e.message || ""), false);
      return null;
    }
  }

function renderNoticeThumbs() {
    const thumbs = document.querySelector("#notice-img-thumbs");
    if (!thumbs) return;
    thumbs.innerHTML = "";
    noticeImages.forEach((p, idx) => {
      const wrap = document.createElement("div");
      wrap.className = "notice-thumb";
      const img = document.createElement("img");
      img.alt = "";
      img.src = SB.noticeImageUrl(p);
      const x = document.createElement("button");
      x.type = "button";
      x.className = "notice-thumb-x";
      x.textContent = "×";
      x.title = "移除图片";
      x.addEventListener("click", () => {
        noticeImages.splice(idx, 1);
        renderNoticeThumbs();
      });
      wrap.appendChild(img);
      wrap.appendChild(x);
      thumbs.appendChild(wrap);
    });
  }

function resetNoticeForm(titleEl, pubEl, keepImages) {
    if (titleEl) titleEl.value = "";
    if (noticeQuill && noticeQuill.root) noticeQuill.root.innerHTML = "";
    if (pubEl) pubEl.checked = true;
    if (!keepImages) noticeImages = [];
    noticeEditingId = null;
    renderNoticeThumbs();
    if (titleEl) titleEl.dispatchEvent(new Event("input"));
  }

async function doSaveNotice(titleEl, pubEl) {
    if (!guardZone("notice", "无权限：只有可管理公告的管理员可操作")) return;
    const title = (titleEl && titleEl.value || "").trim();
    if (!title) return sbToast("请填写公告标题", false);
    // 富文本正文：保留管理员编辑的 HTML（加粗/列表/插图等），空白时退回纯文本
    let content = "";
    if (noticeQuill && noticeQuill.root) {
      content = noticeQuill.root.innerHTML.trim();
      // 去掉仅剩的空段落
      if (/^(<p><br><\/p>|&nbsp;|\s)*$/.test(content)) content = "";
    }
    const published = !pubEl ? true : pubEl.checked;
    try {
      if (noticeEditingId) {
        await SB.updateAnnouncement(noticeEditingId, { title, content, published, images: noticeImages });
        sbToast("公告已更新");
      } else {
        await SB.addAnnouncement({ title, content, published, images: noticeImages });
        sbToast("公告已发布");
      }
      resetNoticeForm(titleEl, pubEl, false);
      loadNoticeAdminList();
    } catch (e) {
      sbToast("保存失败：" + (e.message || ""), false);
    }
  }

async function loadNoticeAdminList() {
    const box = document.querySelector("#notice-list-box");
    if (!box) return;
    let list = [];
    try { list = await SB.listAnnouncements(); } catch (e) { list = []; }
    box.innerHTML = "";
    if (!list.length) {
      box.innerHTML = '<p class="hint">暂无公告。填写上方表单并点击「发布/保存」。</p>';
      return;
    }
    list.forEach(a => {
      const row = document.createElement("div");
      row.className = "notice-admin-row";
      const info = document.createElement("div");
      info.className = "notice-admin-info";
      const t = document.createElement("div");
      t.className = "notice-admin-title";
      t.textContent = a.title || "（无标题）";
      const m = document.createElement("div");
      m.className = "notice-admin-meta";
      m.textContent = fmtAdminDate(a.created_at) + " · " + (a.published ? "已发布" : "已下架") + (a.images && a.images.length ? " · " + a.images.length + " 图" : "");
      info.appendChild(t);
      info.appendChild(m);
      const ops = document.createElement("div");
      ops.className = "notice-admin-ops";
      const bEdit = document.createElement("button");
      bEdit.type = "button";
      bEdit.className = "btn-ghost";
      bEdit.textContent = "编辑";
      bEdit.addEventListener("click", () => editNotice(a));
      const bPub = document.createElement("button");
      bPub.type = "button";
      bPub.className = "btn-ghost";
      bPub.textContent = a.published ? "下架" : "发布";
      bPub.addEventListener("click", () => toggleNoticePublish(a));
      const bDel = document.createElement("button");
      bDel.type = "button";
      bDel.className = "btn-danger";
      bDel.textContent = "删除";
      bDel.addEventListener("click", () => deleteNotice(a));
      ops.appendChild(bEdit);
      ops.appendChild(bPub);
      ops.appendChild(bDel);
      row.appendChild(info);
      row.appendChild(ops);
      box.appendChild(row);
    });
  }

function editNotice(a) {
    const titleEl = document.querySelector("#notice-title");
    const pubEl = document.querySelector("#notice-published");
    if (titleEl) titleEl.value = a.title || "";
    if (pubEl) pubEl.checked = a.published !== false;
    if (noticeQuill && noticeQuill.root) {
      const raw = (a.content || "");
      noticeQuill.root.innerHTML = /^<(p|h\d|div|ul|ol|blockquote|img|table)/i.test(raw.trim()) ? raw : (raw ? "<p>" + escapeHtml(raw) + "</p>" : "");
    }
    noticeImages = (a.images || []).slice();
    noticeEditingId = a.id;
    renderNoticeThumbs();
    if (titleEl) titleEl.dispatchEvent(new Event("input"));
    sbToast("已载入《" + (a.title || "") + "》到表单，修改后点「发布/保存」");
  }

async function toggleNoticePublish(a) {
    try {
      await SB.updateAnnouncement(a.id, { published: a.published ? false : true });
      sbToast(a.published ? "已下架" : "已发布");
      loadNoticeAdminList();
    } catch (e) {
      sbToast("操作失败：" + (e.message || ""), false);
    }
  }

async function deleteNotice(a) {
    if (!confirm("确认删除公告「" + (a.title || "") + "」？")) return;
    try {
      await SB.removeAnnouncement(a.id);
      sbToast("已删除");
      loadNoticeAdminList();
    } catch (e) {
      sbToast("删除失败：" + (e.message || ""), false);
    }
  }

  /* 暴露给其它模块 / 事件绑定 */
  Object.assign(window, {
    bindNotice, uploadNoticeImage, renderNoticeThumbs, resetNoticeForm, doSaveNotice, loadNoticeAdminList, editNotice, toggleNoticePublish, deleteNotice
  });

})();
