/* 一次性改动脚本：趋势上升榜「只看标签」筛选 + 「导出图片（带标签·高清）」+ 导出权限收紧到超管。
   每个替换都断言"有且仅有一处命中"，任何一处不匹配立即报错退出，绝不静默跳过。 */
const fs = require("fs");
const path = require("path");

const ROOT = process.argv[2] || ".";
const F = (p) => path.join(ROOT, p);
let done = 0;

function rep(file, oldStr, newStr, tag) {
  const p = F(file);
  let s = fs.readFileSync(p, "utf8");
  const n = s.split(oldStr).length - 1;
  if (n !== 1) throw new Error("[" + tag + "] " + file + " 命中 " + n + " 处（期望 1 处）：\n" + oldStr.slice(0, 120));
  fs.writeFileSync(p, s.replace(oldStr, newStr));
  done++;
  console.log("  \u2713 " + tag);
}

/* ===================== js/rank.js ===================== */
const RJ = "js/rank.js";

/* ① 新增状态 + 「位次标签」单一来源 + 「只看标签」判定 + 导出范围文字 */
rep(RJ, `  var MOVE_SCOPE = "all";`,
`  var MOVE_SCOPE = "all";
  var ONLY = "off";          /* 只看标签：off | up（位次上升）| new（新上榜）——仅纵向·时间对比有效 */
  var EXPORT_ITEMS = [];     /* 当前屏幕上这批图（含位次标签），供「导出图片（带标签·高清）」使用 */

  /* 某期某张图的位次标签（与卡片上「上升 N 位 / 下降 N 位 / 新上榜」同源）：
     排序、卡片标签、「只看标签」筛选三处共用同一套计算，
     保证"筛出来的东西"和"图上显示的东西"永远一致，不会各算各的。 */
  function moveOf(it, p, prev, hasOf, rankOf) {
    if (!prev) return { move: "", isNew: false, diff: 0 };
    if (!hasOf[prev] || !hasOf[prev][it.image_url]) return { move: "新上榜", isNew: true, diff: 0 };
    var pr = (rankOf[prev] || {})[it.image_url];
    var cr = (rankOf[p] || {})[it.image_url];
    if (pr != null && cr != null) {
      var d = pr - cr;
      if (d > 0) return { move: "上升 " + d + " 位", isNew: false, diff: d };
      if (d < 0) return { move: "下降 " + (-d) + " 位", isNew: false, diff: d };
    }
    return { move: "", isNew: false, diff: 0 };
  }
  function onlyLabel() {
    return ONLY === "up" ? "只看位次上升" : (ONLY === "new" ? "只看新上榜" : "");
  }
  /* 「只看标签」命中判定：与卡片标签文案同源 */
  function hitOnly(mv) {
    if (ONLY === "off") return true;
    var s = (mv && mv.move) || "";
    if (ONLY === "new") return s === "新上榜";
    return s.indexOf("上升") === 0;                 /* 位次上升（含「上升 N 位」） */
  }
  /* 导出图片 / PPT 时写进文件名与封面的范围文字 */
  function exportScope() {
    var parts = [CAT || "全部类目"];
    var _g = activeGroup();
    parts.push(_g ? ("地区 " + _g.name) : (sitesForQuery().join("/") || "未选国家"));
    parts.push(activePeriods().join("、") || "未选周次");
    if (MODE === "v" && ONLY !== "off") parts.push(onlyLabel());
    return parts.join(" · ");
  }`, "rank.js 状态 + 位次标签单一来源 + 只看标签判定");

/* ② 切到横向时「只看标签」自动复位（横向没有可比基线） */
rep(RJ, `      if (SEL_PERIODS.length > 1) SEL_PERIODS = [SEL_PERIODS[SEL_PERIODS.length - 1]];
    }`,
`      if (SEL_PERIODS.length > 1) SEL_PERIODS = [SEL_PERIODS[SEL_PERIODS.length - 1]];
      /* 位次标签只存在于「纵向·时间对比」（与上一周比），横向没有可比基线 →
         切到横向时自动回到「全部」，避免出现"界面高亮只看上升、实际没筛"的错位 */
      ONLY = "off";
    }`, "rank.js 横向自动复位只看标签");

/* ③ 筛选面板：新增「只看标签」单选行（仅纵向显示） */
rep(RJ, `    /* 趋势标签 + 排序 / 图幅 / 位次排序 全部并列在同一排直接展示，无需再点开 */`,
`    /* 只看标签：点了就只显示带该标签的图，再点一次可取消（仅纵向·时间对比有效） */
    var onlyGroup = (MODE === "v")
      ? '<div class="tag-group"><span class="tag-group-name">只看标签（单选，点已选中的可取消）</span><div class="tag-chips" id="rk-g-only">' +
          chip("off", "全部", ONLY === "off", "data-only") +
          chip("up", "只看位次上升", ONLY === "up", "data-only") +
          chip("new", "只看新上榜", ONLY === "new", "data-only") +
        '</div></div>'
      : "";

    /* 趋势标签 + 排序 / 图幅 / 位次排序 全部并列在同一排直接展示，无需再点开 */`, "rank.js 渲染只看标签行");

rep(RJ, `      mergedRow;`, `      mergedRow + onlyGroup;`, "rank.js 挂载只看标签行");

/* ④ 筛选面板绑定：只看标签点击（再点一次取消） */
rep(RJ, `    var sortBox = $("#rk-g-sort");`,
`    var onlyBox = $("#rk-g-only");
    if (onlyBox) Array.prototype.forEach.call(onlyBox.querySelectorAll("[data-only]"), function (b) {
      b.onclick = function () {
        var v = b.getAttribute("data-only");
        ONLY = (v === ONLY) ? "off" : v;             /* 点已选中的 → 取消，回到全部 */
        renderPanel(); renderSummary(); renderBody();
      };
    });

    var sortBox = $("#rk-g-sort");`, "rank.js 绑定只看标签");

/* ⑤ 摘要条显示当前只看标签 */
rep(RJ, `    if (MODE === "v" && MOVE !== "off") parts.push(moveLabel());`,
`    if (MODE === "v" && MOVE !== "off") parts.push(moveLabel());
    if (MODE === "v" && ONLY !== "off") parts.push(onlyLabel());`, "rank.js 摘要条");

/* ⑥ 取图时清空导出清单并开始累计 */
rep(RJ, `    var html = "", maxLen = 0;`,
`    EXPORT_ITEMS = [];                                   /* 每次重排都重新累计，避免残留上一次的范围 */
    var html = "", maxLen = 0, kept = 0;`, "rank.js 导出清单累计初始化");

/* ⑦ 横向分支：导出清单（标签为空）+ 保留数 */
rep(RJ, `        html += poolHtml(s, meta, total, cards, opts.noFoot ? null : Math.min(limit, total));
      });`,
`        html += poolHtml(s, meta, total, cards, opts.noFoot ? null : Math.min(limit, total));
        kept += list.length;
        /* 导出用清单：整列（不按「每列最多展示」截断）；横向按国家比，没有位次标签 */
        list.forEach(function (it) {
          EXPORT_ITEMS.push({
            url: it.image_url, label: "", site: s,
            period: it.period_label || "",
            cat: it.leaf_category || it.category || CAT || ""
          });
        });
      });`, "rank.js 横向导出清单");

/* ⑧ 纵向分支：排序复用 moveOf */
rep(RJ, `            var isNew = !hasOf[prev][it.image_url];
            var d = 0;
            if (!isNew) {
              var pr = rankOf[prev][it.image_url];
              var cr = rankOf[p][it.image_url];
              if (pr != null && cr != null) d = pr - cr;
            }`,
`            var mv0 = moveOf(it, p, prev, hasOf, rankOf);
            var isNew = mv0.isNew;
            var d = mv0.diff;`, "rank.js 纵向排序复用 moveOf");

/* ⑨ 纵向分支：新上榜计数 + 只看标签筛选 + 列头说明 */
rep(RJ, `        if (list.length > maxLen) maxLen = list.length;
        var newCnt = 0;
        if (prev) list.forEach(function (i) { if (!hasOf[prev][i.image_url]) newCnt++; });
        var meta = site + (prev ? (" · 较上一周（" + prev + "）新上榜 " + newCnt + " 张") : " · 首期（无上一周）");`,
`        var newCnt = 0;
        if (prev) list.forEach(function (i) { if (moveOf(i, p, prev, hasOf, rankOf).isNew) newCnt++; });
        var full = list.length;
        /* 只看标签：位次上升 / 新上榜 —— 命中判定与卡片标签同源（同一套 moveOf），
           筛出来的和图上的标签永远一致；在排序之后筛，顺序仍是同一套口径 */
        if (ONLY !== "off" && prev) {
          list = list.filter(function (it) { return hitOnly(moveOf(it, p, prev, hasOf, rankOf)); });
        }
        if (list.length > maxLen) maxLen = list.length;
        var meta = site + (prev ? (" · 较上一周（" + prev + "）新上榜 " + newCnt + " 张") : " · 首期（无上一周）");
        if (ONLY !== "off") meta += " · " + onlyLabel() + "：" + list.length + " 张（该列共 " + full + " 张）";`, "rank.js 纵向只看标签筛选");

/* ⑩ 纵向分支：卡片标签复用 moveOf + 导出清单（整列） */
rep(RJ, `        var cards = list.slice(0, limit).map(function (it) {
          var move = "", isNew = false;
          if (prev) {
            if (!hasOf[prev][it.image_url]) { move = "新上榜"; isNew = true; }
            else {
              var pr = rankOf[prev][it.image_url];
              var cr = rankOf[p][it.image_url];
              if (pr != null && cr != null) {
                var diff = pr - cr;
                if (diff > 0) move = "上升 " + diff + " 位";
                else if (diff < 0) move = "下降 " + (-diff) + " 位";
              }
            }
          }
          return cardHtml(it, { move: move, isNew: isNew, eager: opts.eager, eye: opts.eye });
        }).join("");
        html += poolHtml(p, meta, list.length, cards, opts.noFoot ? null : Math.min(limit, list.length));`,
`        var cards = list.slice(0, limit).map(function (it) {
          var mv = moveOf(it, p, prev, hasOf, rankOf);
          return cardHtml(it, { move: mv.move, isNew: mv.isNew, eager: opts.eager, eye: opts.eye });
        }).join("");
        html += poolHtml(p, meta, list.length, cards, opts.noFoot ? null : Math.min(limit, list.length));
        kept += list.length;
        /* 导出用清单：整列（不按「每列最多展示」截断），带站点 / 期次 / 类目 / 位次标签 */
        list.forEach(function (it) {
          EXPORT_ITEMS.push({
            url: it.image_url, label: moveOf(it, p, prev, hasOf, rankOf).move,
            site: it.site || site, period: p,
            cat: it.leaf_category || it.category || CAT || ""
          });
        });`, "rank.js 纵向卡片标签 + 导出清单");

/* ⑪ 取图结果带上"实际留下几张" */
rep(RJ, `    return { html: html, maxLen: maxLen };`,
`    return { html: html, maxLen: maxLen, kept: kept };`, "rank.js 返回实际张数");

/* ⑫ 只看标签筛完为空时，明确说明（而不是只说"暂无数据"） */
rep(RJ, `    var R = buildPools(CAP);
    var html = '<div class="rk-pools" id="rk-pools">' + R.html + '</div>';`,
`    var R = buildPools(CAP);
    if (ONLY !== "off" && !R.kept) {
      box.innerHTML = '<div class="rk-empty">当前筛选里没有「' + onlyLabel().replace("只看", "") + '」的图片。点筛选里的「全部」可以看回所有图。</div>';
      return;
    }
    var html = '<div class="rk-pools" id="rk-pools">' + R.html + '</div>';`, "rank.js 只看标签空态");

/* ⑬ 工具条：导出图片按钮（默认不显示，确认超管身份后才出现） */
rep(RJ, `    h += '<div class="rk-bar-info">';`,
`    h += '<button type="button" class="rk-exp-img" id="rk-exp-img" title="把当前这批图（含位次标签）按高清原图导出，方便分享">导出图片（带标签 · 高清）</button>';
    h += '<div class="rk-bar-info">';`, "rank.js 导出图片按钮");

rep(RJ, `    var eye = $("#rk-eye-btn");`,
`    /* 导出图片（带标签 · 高清）：与「导出 PPT」同一套权限口径 —— 只允许超级管理员
       （按钮默认不可见，确认身份后才出现；调用时还会再校验一次） */
    var exb = $("#rk-exp-img");
    if (exb) {
      exb.onclick = function () {
        var items = EXPORT_ITEMS.slice();
        if (!items.length) { toast("当前筛选下没有可导出的图片"); return; }
        if (!window.ReportKit || !window.ReportKit.exportImages) { toast("导出组件不可用，请刷新页面后重试"); return; }
        window.ReportKit.exportImages({ items: items, scope: exportScope() });
      };
      eyeIsSuper().then(function (ok) { if (ok) exb.className = "rk-exp-img on"; });
    }

    var eye = $("#rk-eye-btn");`, "rank.js 导出图片按钮接线 + 超管限制");

/* ===================== js/report.js ===================== */
const RP = "js/report.js";
rep(RP, `  window.ReportKit = {`,
`  /* ============ 导出图片（带标签 · 高清） ============
     把当前屏幕上这批图（含位次标签）按原图分辨率逐张导出成 PNG，
     底部加一条标签栏（站点 · 期次 · 类目 + 位次标签），连同清单一起打进一个压缩包。
     权限口径与「导出 PPT」一致：只有超级管理员可导出（按钮不可见 + 调用时再校验一次）。 */
  var IMG_EXP = { maxW: 2000, maxN: 300, labelPct: 0.026, minFont: 18 };

  function isSuperNow() {
    return Promise.resolve()
      .then(function () {
        if (CFG.super) return true;
        if (typeof CFG.isSuper === "function") return CFG.isSuper();
        return false;
      })
      .then(function (v) { return !!v; }, function () { return false; });
  }

  function ensureZip() {
    if (window.JSZip) return Promise.resolve(true);
    var v = assetV();
    return loadScript("vendor/jszip.min.js" + (v ? ("?v=" + v) : "")).then(function () {
      return !!window.JSZip;
    }, function () { return false; });
  }

  function loadImg(url) {
    return new Promise(function (res) {
      var im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = url;
    });
  }

  /* 单张：原图分辨率（超过上限才等比缩小）→ 底部标签栏 → PNG。
     取不到像素（站外图 / 跨域被拒 / 未实现 canvas）返回 null，由调用方如实计数。 */
  function labelPng(item) {
    return loadImg(item.url).then(function (im) {
      if (!im) return null;
      var iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
      if (!iw || !ih) return null;
      var sc = Math.min(1, IMG_EXP.maxW / iw);
      var w = Math.max(1, Math.round(iw * sc)), h = Math.max(1, Math.round(ih * sc));
      var font = Math.max(IMG_EXP.minFont, Math.round(w * IMG_EXP.labelPct));
      var barH = Math.round(font * 2.3);
      var cv = document.createElement("canvas");
      cv.width = w; cv.height = h + barH;
      var ctx = cv.getContext && cv.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, cv.height);
      try { ctx.drawImage(im, 0, 0, w, h); } catch (e) { return null; }
      ctx.fillStyle = "rgba(17,17,17,.88)";
      ctx.fillRect(0, h, w, barH);
      var pad = Math.round(font * 0.55);
      ctx.textBaseline = "middle";
      ctx.font = Math.round(font * 0.72) + "px " + FONT;
      ctx.fillStyle = "#f2f2f2";
      var base = [item.site, item.period, item.cat].filter(Boolean).join(" · ");
      try { ctx.fillText(base, pad, h + barH / 2); } catch (e) { }
      if (item.label) {
        ctx.font = "bold " + font + "px " + FONT;
        var tw = 0;
        try { tw = ctx.measureText(item.label).width; } catch (e2) { tw = font * 4; }
        var bw = Math.round(tw + font * 1.1), bh = Math.round(font * 1.66);
        var bx = Math.max(pad, w - pad - bw), by = h + Math.round((barH - bh) / 2);
        ctx.fillStyle = "#d4a017"; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = "#1a1a1a";
        try { ctx.fillText(item.label, bx + Math.round(font * 0.55), h + barH / 2); } catch (e3) { }
      }
      return new Promise(function (res) {
        if (typeof cv.toBlob === "function") {
          try { cv.toBlob(function (b) { res(b ? { blob: b } : null); }, "image/png"); return; } catch (e) { }
        }
        try { res({ dataUrl: cv.toDataURL("image/png") }); } catch (e) { res(null); }
      });
    });
  }

  /* payload: { items:[{url,label,site,period,cat}], scope:"范围文字" } */
  function exportImages(payload) {
    var items = ((payload && payload.items) || []).filter(function (x) { return x && /^https?:\\/\\//i.test(x.url || ""); });
    var warn = "";
    return isSuperNow().then(function (ok) {
      if (!ok) { hud(true, "只有超级管理员可以导出图片。", 100, true); setTimeout(function () { hud(false); }, 2800); return false; }
      if (!items.length) { hud(true, "当前筛选下没有可导出的图片。", 100, true); setTimeout(function () { hud(false); }, 2800); return false; }
      if (items.length > IMG_EXP.maxN) {
        warn = "共 " + items.length + " 张，只导了前 " + IMG_EXP.maxN + " 张（可缩小范围后再导）";
        items = items.slice(0, IMG_EXP.maxN);
      }
      return ensureZip().then(function (hasZip) {
        if (!hasZip) { hud(true, "导出组件不可用，请刷新页面后重试。", 100, true); setTimeout(function () { hud(false); }, 3200); return false; }
        var zip = new window.JSZip(), missed = 0, done = 0, i = 0;
        var rows = [["序号", "站点", "期次", "类目", "位次标签", "文件名", "原图地址"]];
        function step() {
          if (i >= items.length) return Promise.resolve();
          var it = items[i], n = i;
          hud(true, "正在导出第 " + (n + 1) + " / " + items.length + " 张…", Math.round(n / items.length * 100));
          return labelPng(it).then(function (out) {
            var nm = safeName([pad2(n + 1), it.site || "", it.period || "", it.cat || "", it.label || "无标签"].filter(Boolean).join("_")) + ".png";
            if (!out) {
              missed++;
              rows.push([n + 1, it.site || "", it.period || "", it.cat || "", it.label || "", "（未导出：取不到图片像素）", it.url]);
            } else {
              if (out.blob) zip.file(nm, out.blob);
              else zip.file(nm, String(out.dataUrl || "").split(",")[1] || "", { base64: true });
              rows.push([n + 1, it.site || "", it.period || "", it.cat || "", it.label || "", nm, it.url]);
              done++;
            }
            i++;
            return step();
          });
        }
        return step().then(function () {
          zip.file("清单.csv", "\\ufeff" + rows.map(function (r) {
            return r.map(function (c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; }).join(",");
          }).join("\\r\\n"));
          return zip.generateAsync({ type: "blob" });
        }).then(function (blob) {
          var name = safeName("趋势上升榜_" + ((payload && payload.scope) || "") + "_" + fmtDate(new Date())) + ".zip";
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url; a.download = name;
          document.body.appendChild(a); a.click();
          setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) { } }, 2000);
          var msg = ["已导出 " + done + " 张"];
          if (missed) msg.push(missed + " 张取不到像素（站外图 / 加载失败），未放进压缩包");
          if (warn) msg.push(warn);
          hud(true, name + "：" + msg.join("；"), 100);
          setTimeout(function () { hud(false); }, 6000);
          return true;
        });
      });
    }).then(function (r) { return r; }, function () {
      hud(true, "导出失败，请重试。", 100, true); setTimeout(function () { hud(false); }, 2800); return false;
    });
  }

  window.ReportKit = {`, "report.js 导出图片实现");

rep(RP, `    exportEye: exportEye,`, `    exportEye: exportEye,
    exportImages: exportImages,`, "report.js 对外暴露 exportImages");

rep(RP, `      readPoolsFrom: readPoolsFrom, imgDataUrl: imgDataUrl, hud: hud, exportEye: exportEye,`,
`      readPoolsFrom: readPoolsFrom, imgDataUrl: imgDataUrl, hud: hud, exportEye: exportEye,
      exportImages: exportImages, labelPng: labelPng, IMG_EXP: IMG_EXP, isSuperNow: isSuperNow,`,
"report.js 测试可及性导出");

/* ===================== css/style.css ===================== */
rep("css/style.css", `.rk-eye-ppt.on:hover { filter: brightness(1.06); }`,
`.rk-eye-ppt.on:hover { filter: brightness(1.06); }
.rk-exp-img { display: none; }
.rk-exp-img.on {
  display: inline-flex; align-items: center;
  padding: 2px 10px; font-size: 11px; font-family: inherit; cursor: pointer;
  color: #16305e; background: #ffe9a8; border: 1px solid #ffd75e; border-radius: 999px; white-space: nowrap;
}
.rk-exp-img.on:hover { filter: brightness(1.05); }`, "style.css 导出图片按钮样式");

console.log("\n共完成 " + done + " 处改动。");