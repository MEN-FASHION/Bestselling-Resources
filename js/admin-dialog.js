/* 后台通用「居中弹窗」：替代浏览器原生 prompt / confirm
 * 原生弹窗会贴在浏览器窗口上方（地址栏下方），既挡不住视线也看不出属于哪个操作；
 * 这里统一成站点自己的居中对话框：标题 + 说明 + （可选）输入框 + 取消 / 确定。
 * 用法：
 *   const v = await sbAsk({ title: "外链地址", desc: "留空则清除", value: img.url || "", placeholder: "https://" });
 *   if (v === null) return;           // 取消
 *   const ok = await sbConfirm({ title: "删除类目", desc: "删除后会同步清空…", danger: true });
 */
(function () {
  if (window.sbAsk) return;

  let layer = null;
  let resolver = null;

  function ensureLayer() {
    if (layer && document.body.contains(layer)) return layer;
    layer = document.createElement("div");
    layer.className = "sbd-mask hidden";
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    layer.innerHTML = `
      <div class="sbd-box">
        <h3 class="sbd-title"></h3>
        <p class="sbd-desc"></p>
        <input class="sbd-input input" type="text">
        <div class="sbd-actions">
          <button type="button" class="btn-ghost sbd-cancel">取消</button>
          <button type="button" class="btn-primary sbd-ok">确定</button>
        </div>
      </div>`;
    document.body.appendChild(layer);

    layer.querySelector(".sbd-cancel").addEventListener("click", () => close(null));
    layer.querySelector(".sbd-ok").addEventListener("click", () => {
      const inp = layer.querySelector(".sbd-input");
      close(layer.dataset.mode === "ask" ? inp.value : true);
    });
    // 取消在「确认」模式下必须回 false（不是 null），调用方才能用 if (!ok) 直接判断
    layer.addEventListener("mousedown", (e) => { if (e.target === layer) close(null); });
    layer.querySelector(".sbd-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); layer.querySelector(".sbd-ok").click(); }
    });
    return layer;
  }

  function close(val) {
    if (!layer) return;
    const mode = layer.dataset.mode;
    layer.classList.add("hidden");
    const r = resolver;
    resolver = null;
    if (!r) return;
    if (mode === "confirm") r(val === true);   // 确认模式：只有点「确定」才是 true
    else r(val);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && layer && !layer.classList.contains("hidden")) close(null);
  });

  function open(opts, mode) {
    const o = opts || {};
    const l = ensureLayer();
    l.dataset.mode = mode;
    l.querySelector(".sbd-title").textContent = o.title || "";
    const desc = l.querySelector(".sbd-desc");
    desc.textContent = o.desc || "";
    desc.classList.toggle("hidden", !o.desc);
    const inp = l.querySelector(".sbd-input");
    inp.classList.toggle("hidden", mode !== "ask");
    inp.value = mode === "ask" ? (o.value || "") : "";
    inp.placeholder = o.placeholder || "";
    const ok = l.querySelector(".sbd-ok");
    ok.textContent = o.okText || "确定";
    ok.classList.toggle("danger", !!o.danger);
    l.classList.remove("hidden");
    setTimeout(() => {
      if (mode === "ask") { inp.focus(); inp.select(); }
      else ok.focus();
    }, 30);
    return new Promise((res) => { resolver = res; });
  }

  window.sbAsk = (opts) => open(opts, "ask");
  window.sbConfirm = (opts) => open(opts, "confirm");
  // 兼容写法：传字符串
  window.sbAskText = (title, desc, value) => open({ title: title, desc: desc, value: value }, "ask");
})();