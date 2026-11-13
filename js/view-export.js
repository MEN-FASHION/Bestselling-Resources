/* ============================================================================
 * view-export.js —— 前台「按当前所见导出」（20261113N）
 * ----------------------------------------------------------------------------
 * 需求：有图的前台专区要能把「此刻页面上看到的东西」带走 ——
 *   1) 一份 HTML（版式照页面来，双击就能开，可以直接发给别人看）
 *   2) 一批高清图片（与 HTML 里一一对应）
 * 核心口径：**页面怎么显示，导出就长什么样**。筛选条件（类目 / 周次 / 月份 /
 *   渠道）决定了导出范围，不是重新按全量导一遍。
 *
 * 实现方式：直接从已经渲染出来的 DOM 取卡片，而不是重新查一次库。
 *   原因有两个：
 *     a) 「所见即所得」只有读 DOM 才能保证 —— 前端排序、分组、天眼模式、
 *        渠道对比的列顺序，全都是渲染阶段决定的，重查一遍必然走样；
 *     b) 不用再关心每个专区各自的数据来源（榜单外链 / 上传图 / 渠道图）差异。
 *
 * 权限：前台默认谁都看不到按钮。超管始终有；管理员需在后台「权限管理 →
 *   编辑用户 → 前台导出权限」里被单独勾上对应专区（site_settings.frontend_dims.export_zones）。
 *
 * 技术边界（不假装成功）：跨域图（部分榜单外链 CDN）不允许抓取时，会退回
 *   「原地址内嵌 + 标注未下载」，并在结果提示与 HTML 顶部说明「N 张未能下载」。
 *
 * 对外：window.VX.boot(zoneKey)   —— 页面加载后调一次即可
 *       window.VX.run()           —— 手动触发导出
 *       window.VX.available()     —— 当前账号是否有本页导出权限
 * ==========================================================================*/
(function () {
  "use strict";

  var LABELS = {
    rank: "趋势上升榜",
    rhythm: "上新节奏",
    pinterest: "Pinterest 专区",
    shein: "SHEIN 专区",
    compare: "渠道对比",
    movement: "品牌动向"
  };

  var CONCURRENCY = 4;       // 同时下载的图片数，太大反而容易被打回
  var state = {
    zone: "",
    label: "",
    allowed: false,
    booted: false,
    busy: false,
    dock: null,
    btn: null,
    tip: null
  };

  function $(s, r) { return (r || document).querySelector(s); }
  function SBx() { return window.SB || null; }
  function trim(s) { return String(s == null ? "" : s).trim(); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- 提示 ---------------- */
  function toast(msg, ok) {
    var t = document.getElementById("toast");
    if (!t) { try { console.log("[导出] " + msg); } catch (e) {} return; }
    t.textContent = msg;
    t.className = "toast show" + (ok === false ? " bad" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = "toast"; }, 3600);
  }

  /* ---------------- 权限 ---------------- */
  function loadPerm() {
    var SB = SBx();
    if (!SB || typeof SB.myExportZones !== "function") return Promise.resolve(false);
    return SB.myExportZones().then(function (list) {
      if (!Array.isArray(list)) return false;
      if (list.indexOf("*") >= 0) return true;
      return list.indexOf(state.zone) >= 0;
    }).catch(function () { return false; });
  }

  /* ---------------- 悬浮按钮 ---------------- */
  function buildDock() {
    if (state.dock) return state.dock;
    var d = document.createElement("div");
    d.className = "vx-dock";
    d.id = "vx-dock";
    var tip = document.createElement("span");
    tip.className = "vx-tip";
    tip.id = "vx-tip";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vx-btn";
    btn.id = "vx-btn";
    btn.textContent = "⤓ 导出本页";
    d.appendChild(tip);
    d.appendChild(btn);
    document.body.appendChild(d);
    state.dock = d;
    state.btn = btn;
    state.tip = tip;
    btn.onclick = function () { run(); };
    return d;
  }
  function showDock(on) {
    var d = buildDock();
    d.classList.toggle("on", !!on);
  }
  function setBusy(on) {
    state.busy = !!on;
    if (!state.btn) return;
    state.btn.disabled = !!on;
    state.btn.classList.toggle("is-busy", !!on);
    state.btn.textContent = on ? "◌ 导出中…" : "⤓ 导出本页";
  }
  function setTip(t) { if (state.tip) state.tip.textContent = t || ""; }

  /* ============================================================
   * 一、从 DOM 收集「当前所见」
   * ============================================================ */

  /* 章节 = 页面上的一个分组列（榜单的类目列、渠道对比的每个来源列）。
     纯图墙（Pinterest / SHEIN / 品牌动向）没有分组，整页算一节。 */
  function collectSections() {
    var secs = [];
    var pools = document.querySelectorAll(".rk-pool");
    if (pools.length) {
      Array.prototype.forEach.call(pools, function (p) {
        var nameEl = p.querySelector(".rk-pool-name > span");
        var metaEl = p.querySelector(".rk-pool-meta");
        var cards = pickCards(p);
        if (!cards.length) return;   // 空列不出现，跟页面一致
        secs.push({
          name: nameEl ? trim(nameEl.textContent) : "",
          meta: cleanMeta(metaEl ? metaEl.textContent : ""),
          cards: cards
        });
      });
    }
    if (!secs.length) {
      var cards = pickCards(document);
      if (cards.length) {
        secs.push({ name: activeCat() || state.label, meta: "", cards: cards });
      }
    }
    return secs;
  }

  /* 「详细分析」这类按钮是操作入口，不属于展示信息，导出时剔掉 */
  function cleanMeta(t) {
    return trim(t).replace(/详细分析/g, "").replace(/\s+/g, " ").trim();
  }

  function activeCat() {
    var el = document.querySelector(".cat-menu-item.active, .cat-menu .active");
    return el ? trim(el.textContent).replace(/\s*\d+$/, "") : "";
  }

  function pickCards(root) {
    var out = [], seen = {};
    var figs = root.querySelectorAll(".rk-card[data-url]");
    if (figs.length) {
      Array.prototype.forEach.call(figs, function (f) {
        if (closest(f, "#rk-lightbox, .rk-lb, .rk-eye-loupe, .modal-mask, #vx-dock")) return;
        var url = trim(f.getAttribute("data-url"));
        if (!url || seen[url]) return;
        seen[url] = 1;
        out.push(cardOfFig(f, url));
      });
      return out;
    }
    var mvs = root.querySelectorAll(".mv-card");
    Array.prototype.forEach.call(mvs, function (c) {
      if (closest(c, "#vx-dock, .modal-mask")) return;
      var img = c.querySelector("img");
      if (!img) return;
      var url = trim(img.getAttribute("src") || img.getAttribute("data-src"));
      if (!url || seen[url]) return;
      seen[url] = 1;
      out.push(cardOfMv(c, url, img));
    });
    return out;
  }

  function closest(el, sel) {
    if (!el || !el.closest) return null;
    return el.closest(sel);
  }

  function tagsOf(f) {
    var list = [];
    [" .rk-badge", ".rk-move", ".rk-share", ".rk-site"].forEach(function (s) {
      var e = f.querySelector(s.trim());
      if (e) list.push(trim(e.textContent));
    });
    var raw = trim(f.getAttribute("data-tags"));
    if (raw) raw.split("|").forEach(function (x) { if (trim(x)) list.push(trim(x)); });
    return dedupe(list);
  }

  function dedupe(a) {
    var out = [], seen = {};
    a.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }

  function cardOfFig(f, url) {
    var t = trim(f.getAttribute("data-title")) || trim(f.getAttribute("title"));
    return {
      url: url,
      title: t,
      cat: trim(f.getAttribute("data-cat")),
      site: trim(f.getAttribute("data-site")),
      period: trim(f.getAttribute("data-period")),
      tags: tagsOf(f),
      alt: trim((f.querySelector("img") || {}).alt)
    };
  }

  function cardOfMv(c, url, img) {
    var catEl = c.querySelector(".mv-card-cat");
    var badge = c.querySelector(".mv-season-badge");
    return {
      url: url,
      title: trim(img.getAttribute("alt")),
      cat: catEl ? trim(catEl.textContent) : "",
      site: "",
      period: badge ? trim(badge.textContent) : "",
      /* 卡片右下角的「3/13」是打标进度，属于后台编辑信息，不是展示内容，导出时不要 */
      tags: [],
      alt: trim(img.getAttribute("alt"))
    };
  }

  /* ============================================================
   * 二、下载图片
   * ============================================================ */
  function extOf(blob, url) {
    var t = String((blob && blob.type) || "").toLowerCase();
    if (/png/.test(t)) return ".png";
    if (/webp/.test(t)) return ".webp";
    if (/gif/.test(t)) return ".gif";
    if (/avif/.test(t)) return ".avif";
    if (/bmp/.test(t)) return ".bmp";
    if (/svg/.test(t)) return ".svg";
    if (/jpe?g/.test(t)) return ".jpg";
    var m = String(url || "").split("?")[0].match(/\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i);
    return m ? "." + m[1].toLowerCase().replace("jpeg", "jpg") : ".jpg";
  }

  function safeName(s, max) {
    var t = String(s == null ? "" : s)
      .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    if (!t) t = "未命名";
    return max && t.length > max ? t.slice(0, max) : t;
  }

  function fetchImage(url) {
    return fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" })
      .then(function (r) {
        if (!r || !r.ok) return null;
        return r.blob();
      })
      .then(function (b) { return (b && b.size) ? b : null; })
      .catch(function () { return null; });
  }

  /* 限并发跑完所有任务，返回与输入同序的结果 */
  function pool(tasks, limit, onStep) {
    var i = 0, done = 0, res = new Array(tasks.length);
    return new Promise(function (resolve) {
      if (!tasks.length) return resolve(res);
      var running = 0;
      function next() {
        if (i >= tasks.length) return;
        var k = i++;
        running++;
        tasks[k]().then(function (v) {
          res[k] = v;
        }).catch(function () {
          res[k] = null;
        }).then(function () {
          running--;
          done++;
          if (onStep) onStep(done, tasks.length);
          if (done === tasks.length) resolve(res);
          else next();
        });
      }
      for (var n = 0; n < Math.min(limit, tasks.length); n++) next();
    });
  }

  /* ============================================================
   * 三、生成 HTML
   * ============================================================ */
  function ymd(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }
  function ymdDash(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function periodRange(secs) {
    var all = [];
    secs.forEach(function (s) {
      s.cards.forEach(function (c) { if (c.period) all.push(c.period); });
    });
    var uniq = dedupe(all).sort();
    if (!uniq.length) return "";
    return uniq.length === 1 ? uniq[0] : uniq[0] + "—" + uniq[uniq.length - 1];
  }

  function buildHtml(sec, ctx) {
    var title = ctx.title;
    var css = [
      "*{box-sizing:border-box}",
      "body{margin:0;background:#0e1116;color:#e8ecf3;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}",
      ".hd{padding:22px 26px 14px;border-bottom:1px solid #1e2531;position:sticky;top:0;background:rgba(14,17,22,.96);backdrop-filter:blur(8px);z-index:5}",
      ".hd h1{margin:0;font-size:19px;letter-spacing:.3px}",
      ".hd .sub{margin-top:6px;color:#8b96a8;font-size:12.5px;line-height:1.7}",
      ".vx-note{margin:14px 26px 0;padding:10px 14px;border:1px solid #6b4a1f;background:#241a0c;color:#e7c17a;border-radius:8px;font-size:12.5px}",
      ".sec{padding:22px 26px 6px}",
      ".sec h2{margin:0 0 2px;font-size:15.5px;color:#dbe4f2}",
      ".sec .m{margin:0 0 14px;color:#7f8b9d;font-size:12px}",
      ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;align-items:start}",
      ".c{margin:0;background:#151a22;border:1px solid #1f2733;border-radius:10px;overflow:hidden}",
      ".ph{position:relative;aspect-ratio:3/4;background:#0b0f14;cursor:zoom-in;overflow:hidden}",
      ".ph img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .25s}",
      ".c:hover .ph img{transform:scale(1.03)}",
      ".ph .q{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);opacity:0;transition:opacity .16s,transform .16s;border:0;border-radius:999px;padding:8px 14px;background:rgba(17,22,30,.86);color:#eaf1ff;font-size:12.5px;cursor:pointer;backdrop-filter:blur(4px);white-space:nowrap}",
      ".c:hover .ph .q{opacity:1;transform:translate(-50%,-50%) scale(1)}",
      ".ph .miss{position:absolute;left:6px;top:6px;background:rgba(120,80,10,.92);color:#ffe6ae;font-size:11px;padding:2px 7px;border-radius:999px}",
      "figcaption{padding:9px 11px 11px}",
      ".t{display:block;font-size:12.8px;color:#dfe7f3;line-height:1.5;word-break:break-word}",
      ".g{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}",
      ".g span{font-size:11px;color:#9fb0c6;background:#1b222d;border:1px solid #26303f;border-radius:999px;padding:2px 8px}",
      ".ft{padding:26px;color:#6b7688;font-size:12px;border-top:1px solid #1a212b;margin-top:16px}",
      ".lb{position:fixed;inset:0;background:rgba(6,8,11,.94);display:none;align-items:center;justify-content:center;z-index:99}",
      ".lb.on{display:flex}",
      ".lb img{max-width:92vw;max-height:86vh;object-fit:contain;border-radius:6px}",
      ".lb button{position:absolute;border:0;background:rgba(30,38,50,.9);color:#e8eef8;width:42px;height:42px;border-radius:50%;font-size:20px;cursor:pointer}",
      ".lb .x{right:20px;top:20px}",
      ".lb .p{left:18px;top:50%;transform:translateY(-50%)}",
      ".lb .n{right:18px;top:50%;transform:translateY(-50%)}",
      ".lb .cap{position:absolute;left:0;right:0;bottom:14px;text-align:center;color:#a9b6c8;font-size:12.5px;padding:0 60px}",
      "@media(max-width:640px){.grid{grid-template-columns:repeat(2,1fr);gap:10px}.hd,.sec{padding-left:14px;padding-right:14px}}"
    ].join("\n");

    var body = "";
    sec.forEach(function (s, si) {
      body += '<section class="sec">' +
        "<h2>" + esc(s.name || "未命名分组") + "</h2>" +
        (s.meta ? '<p class="m">' + esc(s.meta) + "</p>" : '<p class="m"></p>') +
        '<div class="grid">';
      s.cards.forEach(function (c) {
        var src = c.file ? "images/" + c.file : c.url;
        body += '<figure class="c">' +
          '<div class="ph">' +
          '<img loading="lazy" class="z" src="' + esc(src) + '" data-full="' + esc(src) + '"' +
          ' data-orig="' + esc(c.url) + '" alt="' + esc(c.alt || c.title || s.name || "图片") + '">' +
          (c.file ? "" : '<span class="miss">未下载 · 原地址</span>') +
          '<button type="button" class="q" data-orig="' + esc(c.url) + '">⌕ 搜同款</button>' +
          "</div>" +
          "<figcaption>" +
          (c.title ? '<span class="t">' + esc(c.title) + "</span>" : "") +
          (c.tags && c.tags.length ? '<span class="g">' + c.tags.map(function (x) {
            return "<span>" + esc(x) + "</span>";
          }).join("") + "</span>" : "") +
          "</figcaption></figure>";
      });
      body += "</div></section>";
    });

    var note = ctx.failed ? '<div class="vx-note">有 ' + ctx.failed +
      " 张图没能下载（对方站点不允许跨域抓取），这些图在下面按原地址内嵌，需要联网才能显示；" +
      "其余 " + ctx.ok + " 张已随本文件一起打包在 images 文件夹里。</div>" : "";

    var script = [
      "(function(){",
      "var imgs=[].slice.call(document.querySelectorAll('img.z'));",
      "var lb=document.getElementById('lb'),big=document.getElementById('lb-img'),cap=document.getElementById('lb-cap'),cur=0;",
      "function show(i){if(!imgs.length)return;cur=(i+imgs.length)%imgs.length;var im=imgs[cur];big.src=im.getAttribute('data-full');cap.textContent=(cur+1)+' / '+imgs.length+' · '+(im.getAttribute('alt')||'');lb.classList.add('on');}",
      "function hide(){lb.classList.remove('on');}",
      "imgs.forEach(function(im,i){im.parentNode.parentNode.addEventListener('click',function(e){if(e.target.closest('.q'))return;show(i);});});",
      "document.querySelector('.lb .x').onclick=hide;",
      "lb.addEventListener('click',function(e){if(e.target===lb)hide();});",
      "document.querySelector('.lb .p').onclick=function(e){e.stopPropagation();show(cur-1);};",
      "document.querySelector('.lb .n').onclick=function(e){e.stopPropagation();show(cur+1);};",
      "document.addEventListener('keydown',function(e){if(!lb.classList.contains('on'))return;if(e.key==='Escape')hide();if(e.key==='ArrowLeft')show(cur-1);if(e.key==='ArrowRight')show(cur+1);});",
      "[].slice.call(document.querySelectorAll('.q')).forEach(function(b){b.addEventListener('click',function(e){e.stopPropagation();e.preventDefault();var u=b.getAttribute('data-orig');if(!/^https?:/i.test(u))return;window.open('https://lens.google.com/uploadbyurl?url='+encodeURIComponent(u),'_blank','noopener');});});",
      "})();"
    ].join("");

    return "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n" +
      '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
      "<title>" + esc(title) + "</title>\n<style>\n" + css + "\n</style>\n</head>\n<body>\n" +
      '<header class="hd"><h1>' + esc(title) + "</h1><div class=\"sub\">" + ctx.sub + "</div></header>\n" +
      note + "\n" + body +
      "\n<div class=\"lb\" id=\"lb\"><img id=\"lb-img\" alt=\"\"><button type=\"button\" class=\"x\">×</button>" +
      "<button type=\"button\" class=\"p\">‹</button><button type=\"button\" class=\"n\">›</button>" +
      '<div class="cap" id="lb-cap"></div></div>\n' +
      "<script>" + script + "</" + "script>\n</body>\n</html>";
  }

  /* ============================================================
   * 四、主流程
   * ============================================================ */
  function run() {
    if (state.busy) return Promise.resolve();
    if (!state.allowed) { toast("你没有导出权限，请联系超级管理员开通", false); return Promise.resolve(); }
    var secs = collectSections();
    if (!secs.length) { toast("当前页面没有可导出的图片", false); return Promise.resolve(); }

    setBusy(true);
    setTip("正在统计…");

    var total = 0;
    secs.forEach(function (s) { total += s.cards.length; });
    setTip("共 " + total + " 张，准备下载…");

    /* 去重下载：同一张图在多个分组出现只下一次。
       先按「唯一的图片地址」排好队再下载，最后把文件名挂回每一张卡片 ——
       不能在循环里边下载边登记，否则排在后面的重复图还没等到结果又会被下一次。 */
    var uniq = [], seen = {};
    secs.forEach(function (s) {
      var i = 0;
      s.cards.forEach(function (c) {
        if (seen[c.url]) return;
        seen[c.url] = 1;
        i++;
        var seq = i < 10 ? "0" + i : String(i);
        uniq.push({
          url: c.url,
          name: safeName((c.cat || s.name || "图片"), 24) + "_" + safeName(c.period || "", 16) + "_" + seq
        });
      });
    });

    var tasks = uniq.map(function (u) {
      return function () {
        return fetchImage(u.url).then(function (b) {
          if (!b) return null;
          return { name: u.name + extOf(b, u.url), blob: b };
        });
      };
    });

    return pool(tasks, CONCURRENCY, function (done, all) {
      setTip("下载图片 " + done + " / " + all);
    }).then(function (res) {
      var nameOf = {};                     // url -> 本地文件名
      uniq.forEach(function (u, i) {
        var r = res[i];
        if (r && r.blob) nameOf[u.url] = r.name;
      });
      var blobs = res.filter(Boolean);
      var okCount = 0;
      secs.forEach(function (s) {
        s.cards.forEach(function (c) {
          if (nameOf[c.url]) { c.file = nameOf[c.url]; okCount++; }
        });
      });
      var failed = total - okCount;

      if (state.btn) state.btn.textContent = "◌ 打包中…";
      setTip("打包 " + okCount + " 张图…");

      var now = new Date();
      var cat = activeCat();
      var rng = periodRange(secs);
      var nameParts = [state.label];
      if (cat && cat !== "全部") nameParts.push(cat);
      if (rng) nameParts.push(rng);
      nameParts.push(ymd(now));
      var baseName = safeName(nameParts.join("_"), 80);
      var title = state.label + (cat && cat !== "全部" ? " · " + cat : "") +
        (rng ? " · " + rng : "");
      var sub = [
        "来源：前台「" + state.label + "」当前筛选所见",
        "类目：" + (cat || "全部"),
        rng ? "期次：" + rng : "",
        "共 " + total + " 张",
        "导出于 " + ymdDash(now) + " " + ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2)
      ].filter(Boolean).join(" · ");

      var html = buildHtml(secs, { title: title, sub: esc(sub), failed: failed, ok: okCount });

      var Zip = window.JSZip;
      if (!Zip) {
        // 没有打包库时退化成「只给 HTML」，图片按原地址内嵌，不假装成功
        setBusy(false); setTip("");
        toast("打包组件未加载，已改为只导出 HTML（图片按原地址内嵌）", false);
        var blob = new Blob([html], { type: "text/html;charset=utf-8" });
        saveBlob(blob, baseName + ".html");
        return;
      }

      var zip = new Zip();
      zip.file(baseName + ".html", html);
      var dir = zip.folder("images");
      blobs.forEach(function (b) { dir.file(b.name, b.blob); });
      return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } })
        .then(function (z) {
          saveBlob(z, baseName + ".zip");
          setBusy(false); setTip("");
          toast(failed
            ? "已导出 " + okCount + " 张（" + failed + " 张未能下载，按原地址内嵌）"
            : "已导出 " + okCount + " 张图片 + HTML");
          state._last = { ok: okCount, failed: failed, name: baseName };
        });
    }).catch(function (e) {
      setBusy(false); setTip("");
      toast("导出失败：" + ((e && e.message) || "未知原因"), false);
    });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (e) {}
      a.remove();
    }, 1500);
  }

  /* ============================================================
   * 五、入口
   * ============================================================ */
  function boot(zoneKey) {
    var key = trim(zoneKey);
    if (!key || !LABELS[key]) return Promise.resolve(false);
    state.zone = key;
    state.label = LABELS[key];
    return loadPerm().then(function (ok) {
      state.allowed = !!ok;
      state.booted = true;
      if (ok) showDock(true);
      return ok;
    });
  }

  window.VX = {
    boot: boot,
    run: run,
    available: function () { return state.allowed; },
    _collect: collectSections,   // 自检用
    _build: buildHtml,
    _state: function () { return state; }
  };
})();
