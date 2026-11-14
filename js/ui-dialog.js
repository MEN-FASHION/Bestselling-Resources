/* ============================================================
 * ui-dialog.js —— 站内统一确认 / 提示弹窗（替代浏览器原生 confirm / alert）
 * ------------------------------------------------------------
 * 为什么要有这个文件：
 *   原生 confirm 是浏览器自己画的框，位置在页面顶部、样式无法改、
 *   还会弹「阻止此页面创建更多对话框」，用起来很别扭，也破坏页面观感。
 *
 * 用法（都是异步）：
 *   if (!(await uiConfirm("删除这张图？"))) return;
 *   await uiAlert("已保存");
 *   await uiConfirm("确定删除？", { title: "删除确认", okText: "删除", danger: true });
 *
 * 特点：
 *   - 样式跟随站点（浅色卡片、圆角、遮罩），居中显示在当前视口；
 *   - 支持多行文本（\n 原样换行）；
 *   - Enter = 确定，Esc = 取消；点遮罩 = 取消；
 *   - 同一时刻只允许一个弹窗，避免叠框；
 *   - 若本文件未加载成功，调用点会退回浏览器原生弹窗，功能不至于失效。
 * ============================================================ */
(function () {
  "use strict";
  if (window.uiConfirm) return;

  var CSS_ID = "ui-dialog-style";

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement("style");
    st.id = CSS_ID;
    st.textContent = [
      ".uid-mask{position:fixed;inset:0;background:rgba(17,24,39,.45);z-index:99999;",
      "display:flex;align-items:center;justify-content:center;padding:16px;}",
      ".uid-box{background:#fff;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.22);",
      "width:100%;max-width:420px;overflow:hidden;font-family:inherit;}",
      ".uid-head{padding:14px 18px 0;font-size:15px;font-weight:600;color:#111827;}",
      ".uid-body{padding:10px 18px 4px;font-size:13.5px;line-height:1.65;color:#374151;",
      "white-space:pre-line;max-height:52vh;overflow:auto;word-break:break-word;}",
      ".uid-foot{padding:14px 18px 16px;display:flex;gap:10px;justify-content:flex-end;}",
      ".uid-btn{border:1px solid #d5d9e0;background:#fff;color:#374151;border-radius:8px;",
      "padding:7px 16px;font-size:13px;cursor:pointer;font-family:inherit;}",
      ".uid-btn:hover{background:#f4f6f9;}",
      ".uid-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff;}",
      ".uid-btn.primary:hover{background:#1d4ed8;}",
      ".uid-btn.danger{background:#dc2626;border-color:#dc2626;color:#fff;}",
      ".uid-btn.danger:hover{background:#b91c1c;}",
      ".uid-btn:focus-visible{outline:2px solid #93c5fd;outline-offset:1px;}",
      ".uid-input{width:100%;box-sizing:border-box;border:1px solid #d5d9e0;border-radius:8px;",
      "padding:8px 10px;font-size:13.5px;font-family:inherit;color:#111827;background:#fff;}",
      ".uid-input:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15);}",
      "@media (max-width:480px){.uid-box{max-width:100%;}.uid-foot{flex-direction:column-reverse;}",
      ".uid-btn{width:100%;padding:10px 16px;}}",
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }

  var busy = false;
  var curMask = null;

  /* 20261114I · 复位：任何异常路径都必须把「正在弹」的标记清掉。
     否则 busy 会一直停在 true，之后所有弹窗都直接 resolve(false)，
     界面上表现为「按钮点了没反应」，而且不报错、不提示，极难自查。 */
  function reset() {
    busy = false;
    try { if (curMask && curMask.parentNode) curMask.parentNode.removeChild(curMask); } catch (e) {}
    curMask = null;
  }

  /* 组件万一不可用（脚本没加载、内部异常），退回浏览器原生弹窗，功能不至于失效 */
  function nativeFallback(msg, opts) {
    opts = opts || {};
    try {
      if (opts.input) {
        var v = window.prompt(msg == null ? "" : String(msg), opts.value == null ? "" : String(opts.value));
        return v == null ? null : v;
      }
      if (opts.onlyOk) { window.alert(msg == null ? "" : String(msg)); return true; }
      return window.confirm(msg == null ? "" : String(msg));
    } catch (e2) { return opts.input ? null : false; }
  }

  /* 核心：显示一个弹窗，返回 Promise。
     opts: { title, okText, cancelText, danger, onlyOk } */
  function open(msg, opts) {
    opts = opts || {};
    ensureCss();
    /* 自愈：上一次弹窗半路出错时 busy 可能卡在 true，画面上却没有任何遮罩。
       不处理的话，之后每一次点「合并 / 删除 / 改名」都会静默落空 —— 不弹框也不报错。 */
    if (busy) {
      var alive = false;
      try { alive = !!(curMask && curMask.parentNode); } catch (e) { alive = false; }
      if (!alive) reset();
    }
    var pr = new Promise(function (resolve) {
      try {
      /* 已有弹窗在等回答时，直接视为取消，绝不叠框 */
      if (busy) { resolve(opts.input ? null : false); return; }
      busy = true;

      var mask = document.createElement("div");
      mask.className = "uid-mask";

      var box = document.createElement("div");
      box.className = "uid-box";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");

      if (opts.title) {
        var head = document.createElement("div");
        head.className = "uid-head";
        head.textContent = opts.title;
        box.appendChild(head);
      }

      var body = document.createElement("div");
      body.className = "uid-body";
      body.style.whiteSpace = "pre-line";
      body.textContent = msg == null ? "" : String(msg);
      box.appendChild(body);

      /* 底部按钮区：必须先建好，输入框要插在它上面
         （20261114I 修复：此前 foot 声明在下面，输入分支里 appendChild(foot)
           拿到的是 undefined，浏览器抛 TypeError，Promise 直接 rejected，
           于是所有「输入框弹窗」点按钮都毫无反应） */
      var foot = document.createElement("div");
      foot.className = "uid-foot";

      /* 需要输入时（uiPrompt），在正文下面放一个单行输入框 */
      var input = null;
      if (opts.input) {
        input = document.createElement("input");
        input.type = "text";
        input.className = "uid-input";
        input.value = opts.value == null ? "" : String(opts.value);
        if (opts.placeholder) input.placeholder = opts.placeholder;
        input.style.margin = "4px 18px 2px";
        input.style.width = "calc(100% - 36px)";
        box.appendChild(input);
      }

      var btnCancel = null;
      if (!opts.onlyOk) {
        btnCancel = document.createElement("button");
        btnCancel.type = "button";
        btnCancel.className = "uid-btn";
        btnCancel.textContent = opts.cancelText || "取消";
        foot.appendChild(btnCancel);
      }

      var btnOk = document.createElement("button");
      btnOk.type = "button";
      btnOk.className = "uid-btn primary" + (opts.danger ? " danger" : "");
      btnOk.textContent = opts.okText || "确定";
      foot.appendChild(btnOk);
      box.appendChild(foot);
      mask.appendChild(box);
      document.body.appendChild(mask);
      curMask = mask;

      var done = false;
      function finish(val) {
        if (done) return;
        done = true;
        busy = false;
        document.removeEventListener("keydown", onKey, true);
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        if (curMask === mask) curMask = null;
        if (opts.input) resolve(val ? (input ? input.value : "") : null);
        else resolve(val);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
        else if (e.key === "Enter") { e.preventDefault(); finish(true); }
      }

      btnOk.onclick = function () { finish(true); };
      if (btnCancel) btnCancel.onclick = function () { finish(false); };
      mask.onclick = function (e) { if (e.target === mask) finish(false); };
      document.addEventListener("keydown", onKey, true);
      setTimeout(function () {
        try { (input || btnOk).focus(); } catch (e) {}
        if (input) { try { input.select(); } catch (e) {} }
      }, 30);
      } catch (err) {
        /* 构建弹窗过程中出错：复位标记、清掉残留遮罩，并退回原生弹窗。
           绝不允许「点了没反应」。 */
        try { console.error("[ui-dialog]", err); } catch (e) {}
        reset();
        resolve(nativeFallback(msg, opts));
      }
    });

    /* 20261114I：弹窗内部一旦出错，绝不能变成「点了没反应」。
       清掉残留遮罩，并退回浏览器原生弹窗，让功能照样能用。 */
    return pr.catch(function (err) {
      busy = false;
      if (curMask && curMask.parentNode) curMask.parentNode.removeChild(curMask);
      curMask = null;
      try { console.error("[ui-dialog]", err); } catch (e) {}
      try {
        if (opts.input) {
          var v = window.prompt(msg == null ? "" : String(msg), opts.value == null ? "" : String(opts.value));
          return v == null ? null : v;
        }
        if (opts.onlyOk) { window.alert(msg == null ? "" : String(msg)); return true; }
        return window.confirm(msg == null ? "" : String(msg));
      } catch (e2) { return opts.input ? null : false; }
    });
  }

  window.uiConfirm = function (msg, opts) { return open(msg, opts || {}); };
  window.uiAlert = function (msg, opts) {
    var o = opts || {};
    o.onlyOk = true;
    o.okText = o.okText || "知道了";
    return open(msg, o);
  };
  /* 站内输入框：返回输入的文字；取消返回 null（与原生 prompt 语义一致） */
  window.uiPrompt = function (msg, value, opts) {
    var o = opts || {};
    o.input = true;
    o.value = value == null ? "" : value;
    return open(msg, o);
  };

  /* 便于其它脚本判断是否可用 */
  window.__uiDialogReady = true;
})();
