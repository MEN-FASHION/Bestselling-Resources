/* ============================================================================
 * plus-match.js —— 大码 / 标码「同款」判定引擎（20261026P）
 *
 * 四层判定，从最可靠到最模糊：
 *   ① 商品ID / SKU / 货号   —— 精确相等即同款（表里有就直接用，100%）
 *   ② 感知哈希 pHash + dHash —— 纯算法，不需要模型；扛得住换色 / 压缩 / 缩放 / 轻微裁剪
 *   ③ 标题归一化 + 2-gram    —— 纯算法，扛得住换说法
 *   ④ 语义向量               —— 需要模型：可选本地/远端 embedding 接口；
 *                              未配置时用内置「视觉描述子」兜底（色分布 + 4×4 结构网格）
 *
 * 综合分权重：
 *   有语义向量：图片 0.45 / 标题 0.25 / 语义 0.30
 *   无向量时　：图片 0.60 / 标题 0.40
 * 判定阈值：≥0.85 同款 · 0.60~0.85 待确认 · <0.60 大码机会
 *
 * 本文件顶层不依赖 DOM，纯函数可直接在 Node 里跑测试；
 * 取图 / 算哈希这类需要浏览器的部分放在末尾，调用前会先检查环境。
 * ==========================================================================*/
const PLUSM = (() => {
  /* ---------------- 阈值与权重（集中在这里，改口径只改这一处） ---------------- */
  const T_SAME = 0.85;      // ≥ 判同款
  const T_GAP = 0.60;       // < 判大码机会；中间档进待确认
  const W = {
    withSem: { img: 0.45, txt: 0.25, sem: 0.30 },
    noSem: { img: 0.60, txt: 0.40 },
  };

  /* ---------------- ③ 标题归一化 + 2-gram ---------------- */
  /* 去掉不影响"是不是同一个款"的修饰：颜色、尺码、促销词、括号内容、标点。
     特别是「大码 / 加大 / 胖MM / plus size」这类只表示尺码段的词必须去掉——
     否则大码标题永远比标码多一个词，同款也会被判成不同款。 */
  const NOISE_WORDS = [
    "大码", "加大", "加肥", "加肥加大", "胖mm", "胖妹妹", "胖美眉", "微胖", "胖人",
    "plus size", "plussize", "plussize", "oversize", "oversized", "big size",
    "新款", "爆款", "热卖", "热销", "包邮", "现货", "外贸", "跨境", "工厂直销", "厂家直销",
    "亚马逊", "temu", "shein", "速卖通", "代发", "一件代发", "批发",
    "女装", "男装", "女士", "男士", "女", "男",
    "春季", "夏季", "秋季", "冬季", "春夏", "秋冬", "四季",
    "显瘦", "百搭", "时尚", "潮流", "洋气", "减龄", "ins", "ins风", "网红", "同款",
  ];
  const COLOR_WORDS = [
    "黑色", "白色", "红色", "蓝色", "绿色", "黄色", "紫色", "粉色", "灰色", "咖色", "棕色", "米色",
    "卡其", "藏青", "酒红", "浅蓝", "深蓝", "杏色", "橘色", "橙色", "驼色", "银灰", "深灰", "浅灰",
  ];
  const SIZE_RE = /(\d{1,2}\s*)?(xxxxl|xxxl|xxl|xl|l|m|s|xs)\b/gi;
  /* 去词顺序必须"长的先走"：否则「加大码」会先被「大码」吃掉，剩一个「加」，
     反而给大码标题凭空多出一个字，把同款判成不同款。 */
  const NOISE_SORTED = NOISE_WORDS.concat(COLOR_WORDS, ["加大码", "加肥加大码", "大码裤", "大码女装"])
    .sort((a, b) => b.length - a.length);

  function normTitle(t) {
    let s = String(t == null ? "" : t).toLowerCase();
    s = s.replace(/[（(【\[].*?[)）】\]]/g, " ");          // 括号里的补充说明
    s = s.replace(/[\s\u3000]+/g, " ");
    NOISE_SORTED.forEach(w => {
      s = s.split(w).join(" ");
    });
    s = s.replace(SIZE_RE, " ");
    s = s.replace(/(19|20)\d{2}\s*年?/g, " ");            // 年份不影响"是不是同一款"
    s = s.replace(/[码号]/g, " ");                        // 残留的"码/号"（加大码 → 加大 之后留下的）
    s = s.replace(/[，,。、；;：:！!？?~～\-—_/\\|·"'“”‘’《》<>]/g, " ");
    s = s.replace(/\s+/g, "");
    return s;
  }
  function bigrams(s) {
    const out = {};
    const n = s.length;
    if (!n) return out;
    if (n === 1) { out[s] = 1; return out; }
    for (let i = 0; i < n - 1; i++) {
      const g = s.slice(i, i + 2);
      out[g] = (out[g] || 0) + 1;
    }
    return out;
  }
  function jaccard(m1, m2) {
    const k1 = Object.keys(m1), k2 = Object.keys(m2);
    if (!k1.length && !k2.length) return 1;
    if (!k1.length || !k2.length) return 0;
    let inter = 0, union = k1.length;
    k2.forEach(k => { if (m1[k]) inter++; else union++; });
    return union ? inter / union : 0;
  }
  function dice(m1, m2) {
    const k1 = Object.keys(m1), k2 = Object.keys(m2);
    let inter = 0;
    k2.forEach(k => { if (m1[k]) inter++; });
    const total = k1.length + k2.length;
    return total ? (2 * inter) / total : 0;
  }
  function levSim(a, b) {
    if (a === b) return 1;
    const n = a.length, m = b.length;
    if (!n || !m) return 0;
    let prev = new Array(m + 1), cur = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      cur[0] = i;
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const t = prev; prev = cur; cur = t;
    }
    return 1 - prev[m] / Math.max(n, m);
  }
  /* 标题相似度：2-gram 的 Jaccard 与 Dice 取均值，再与编辑距离按 7:3 混合。
     只用一种度量会各偏一头：Jaccard 对词序不敏感但会被长标题稀释，
     编辑距离对整体结构敏感但一个字的顺序差别就掉分。 */
  function textSim(a, b) {
    const na = normTitle(a), nb = normTitle(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const ba = bigrams(na), bb = bigrams(nb);
    const gram = (jaccard(ba, bb) * 0.5 + dice(ba, bb) * 0.5);
    return Math.max(0, Math.min(1, gram * 0.7 + levSim(na, nb) * 0.3));
  }

  /* ---------------- ② 感知哈希 ---------------- */
  /* 灰度：BT.601 亮度。输入是 canvas 的 RGBA 像素数组。 */
  function toGray(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      g[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    }
    return g;
  }
  /* 双线性缩放到固定尺寸（哈希必须先统一尺寸，否则分辨率会污染指纹） */
  function resizeGray(src, sw, sh, tw, th) {
    const out = new Float32Array(tw * th);
    for (let y = 0; y < th; y++) {
      const fy = (y + 0.5) * (sh / th) - 0.5;
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
      const y1 = Math.max(0, Math.min(sh - 1, y0 + 1));
      const wy = Math.max(0, Math.min(1, fy - y0));
      for (let x = 0; x < tw; x++) {
        const fx = (x + 0.5) * (sw / tw) - 0.5;
        const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
        const x1 = Math.max(0, Math.min(sw - 1, x0 + 1));
        const wx = Math.max(0, Math.min(1, fx - x0));
        const v00 = src[y0 * sw + x0], v01 = src[y0 * sw + x1];
        const v10 = src[y1 * sw + x0], v11 = src[y1 * sw + x1];
        out[y * tw + x] = (v00 * (1 - wx) + v01 * wx) * (1 - wy) + (v10 * (1 - wx) + v11 * wx) * wy;
      }
    }
    return out;
  }
  function bitsToHex(bits) {
    let hex = "";
    for (let i = 0; i < bits.length; i += 4) {
      let v = 0;
      for (let k = 0; k < 4; k++) v = (v << 1) | (bits[i + k] ? 1 : 0);
      hex += v.toString(16);
    }
    return hex;
  }
  function hexToBits(hex) {
    const bits = [];
    for (let i = 0; i < hex.length; i++) {
      const v = parseInt(hex[i], 16);
      for (let k = 3; k >= 0; k--) bits.push((v >> k) & 1);
    }
    return bits;
  }
  function hamming(aHex, bHex) {
    if (!aHex || !bHex || aHex.length !== bHex.length) return 999;
    const a = hexToBits(aHex), b = hexToBits(bHex);
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
  }
  /* dHash：水平相邻像素比较，9×8 → 64 位。对亮度渐变、压缩最稳。 */
  function dhash(gray, w, h) {
    const g = resizeGray(gray, w, h, 9, 8);
    const bits = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) bits.push(g[y * 9 + x] > g[y * 9 + x + 1] ? 1 : 0);
    }
    return bitsToHex(bits);
  }
  /* pHash：缩到 32×32 → 二维 DCT → 取左上 8×8 低频 → 与中位数比较 → 64 位。
     低频记录"画面结构"，高频记录细节噪声；换色、压缩、缩放改的是高频，
     所以 pHash 在换色款上依然能对上。 */
  function cosTable(N) {
    const t = new Float64Array(N * N);
    for (let u = 0; u < N; u++) {
      for (let x = 0; x < N; x++) t[u * N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
    }
    return t;
  }
  let COS32 = null;
  function dct2(grid, N) {
    const T = COS32 || (COS32 = cosTable(N));
    const tmp = new Float64Array(N * N);
    // 行变换
    for (let y = 0; y < N; y++) {
      for (let u = 0; u < N; u++) {
        let s = 0;
        for (let x = 0; x < N; x++) s += grid[y * N + x] * T[u * N + x];
        tmp[y * N + u] = s;
      }
    }
    // 列变换
    const out = new Float64Array(N * N);
    for (let u = 0; u < N; u++) {
      for (let v = 0; v < N; v++) {
        let s = 0;
        for (let y = 0; y < N; y++) s += tmp[y * N + u] * T[v * N + y];
        out[v * N + u] = s;
      }
    }
    return out;
  }
  function phash(gray, w, h) {
    const N = 32;
    const g = resizeGray(gray, w, h, N, N);
    const d = dct2(g, N);
    const vals = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) vals.push(d[y * N + x]);
    const sorted = vals.slice().sort((a, b) => a - b);
    const median = (sorted[31] + sorted[32]) / 2;
    return bitsToHex(vals.map(v => (v > median ? 1 : 0)));
  }
  /* 色分布：16 档灰度直方图（归一化）。用来压掉"结构像但整体色系不同"的误判。 */
  function grayHist(gray, w, h) {
    const bins = new Float64Array(16);
    const n = w * h;
    for (let i = 0; i < n; i++) {
      let b = Math.floor((gray[i] / 256) * 16);
      if (b < 0) b = 0; if (b > 15) b = 15;
      bins[b]++;
    }
    for (let i = 0; i < 16; i++) bins[i] /= n;
    return Array.prototype.slice.call(bins);
  }
  /* 结构网格：4×4 区块均值（归一化到 0~1）。对"主体位置"敏感。 */
  function gridMean(gray, w, h) {
    const G = 4;
    const small = resizeGray(gray, w, h, G, G);
    let max = 0;
    for (let i = 0; i < small.length; i++) if (small[i] > max) max = small[i];
    const out = [];
    for (let i = 0; i < small.length; i++) out.push(max > 0 ? small[i] / max : 0);
    return out;
  }
  function cos(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (!na || !nb) return 0;
    return dot / Math.sqrt(na * nb);
  }
  /* 一张图的全部特征（可序列化，便于缓存与测试） */
  function features(rgba, w, h) {
    const gray = toGray(rgba, w, h);
    return {
      phash: phash(gray, w, h),
      dhash: dhash(gray, w, h),
      hist: grayHist(gray, w, h),
      grid: gridMean(gray, w, h),
    };
  }
  /* 图片相似度：pHash 权重最高（结构最稳），dHash 次之，色分布与网格做校正。
     pHash 汉明距离 0~8 视为"几乎同图"，24 位以上视为不同款（线性映射到 0）。 */
  function imgSim(a, b) {
    if (!a || !b) return 0;
    const hp = 1 - Math.min(1, hamming(a.phash, b.phash) / 24);
    const hd = 1 - Math.min(1, hamming(a.dhash, b.dhash) / 22);
    const hs = Math.max(0, cos(a.hist || [], b.hist || []));
    const hg = Math.max(0, cos(a.grid || [], b.grid || []));
    return Math.max(0, Math.min(1, hp * 0.45 + hd * 0.25 + hs * 0.15 + hg * 0.15));
  }

  /* ---------------- ④ 语义向量 ---------------- */
  /* 语义向量只有一个接口约定：POST 一组图片网址，回一组同长向量。
     没配置接口时不假装有语义分——直接用 ②+③ 的两项权重，这一层留空。 */
  function hasSem(opt) {
    return !!(opt && opt.semA && opt.semA.length && opt.semB && opt.semB.length);
  }
  /* 综合分：可用通道按权重重新归一化，缺哪层就按剩余通道分摊权重，不补假分。
     某一通道为 null 表示"没算出来"（例如跨域图读不到像素），不是 0 分。 */
  function combine(o) {
    const txt = clamp01(o && o.txt);
    const img = (o && o.img != null) ? clamp01(o.img) : null;
    const sem = (o && o.sem != null) ? clamp01(o.sem) : null;
    const w = (sem == null) ? W.noSem : W.withSem;
    let wsum = 0, acc = 0;
    acc += txt * w.txt; wsum += w.txt;
    if (img != null) { acc += img * w.img; wsum += w.img; }
    if (sem != null) { acc += sem * w.sem; wsum += w.sem; }
    return wsum ? acc / wsum : 0;
  }
  function clamp01(v) {
    const n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }
  /* 判定：三档。等于阈值时向上取（宁可选"同款"也不要误报成机会） */
  function verdict(score) {
    const s = clamp01(score);
    if (s >= T_SAME) return "same";
    if (s >= T_GAP) return "review";
    return "gap";
  }

  /* ---------------- 一对一分配 ---------------- */
  /* 标码每个款最多认领一个大码款，大码每个款也只能被认领一次。
     做法：全量打分 → 按分数降序贪心认领（兵棋式），已被占用的两边都跳过。
     不加这条约束，一个爆款会"吃掉"所有相似款，
     于是大量本该标「大码机会」的款会被误判成"已有"。 */
  function assign(stdList, plusList, simFn) {
    const S = stdList || [], P = plusList || [];
    const pairs = [];
    for (let i = 0; i < S.length; i++) {
      for (let j = 0; j < P.length; j++) {
        const sc = Number(simFn(S[i], P[j]));
        if (!isFinite(sc)) continue;
        pairs.push({ i: i, j: j, score: sc });
      }
    }
    pairs.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);
    const usedS = {}, usedP = {}, out = [];
    pairs.forEach(p => {
      if (usedS[p.i] || usedP[p.j]) return;
      usedS[p.i] = 1; usedP[p.j] = 1;
      out.push(p);
    });
    return out;
  }

  /* ---------------- 人工结论优先 ---------------- */
  /* 重算时把人工结论搬回来：同一条标码图，只要上次是 manual 判的，就沿用它，
     算法这次算出来的结果直接丢弃。否则每周重跑一遍，人工修正全白做。 */
  function mergeManual(fresh, prev) {
    const key = (r) => String((r && r.site) || "") + "\u0000" + String((r && r.std_image_url) || "");
    const byKey = {};
    (prev || []).forEach(r => {
      if (r && r.method === "manual") byKey[key(r)] = r;
    });
    return (fresh || []).map(r => {
      /* 键里带站点：同一张标码图在不同站点是两条独立结论，
         只按图地址做键会让 A 站点的人工判定串到 B 站点去。 */
      const m = byKey[key(r)];
      if (!m) return r;
      return Object.assign({}, r, {
        plus_image_url: m.plus_image_url || r.plus_image_url,
        decision: m.decision,
        method: "manual",
        score: (m.score == null ? r.score : m.score),
      });
    });
  }

  /* ---------------- ④ 语义向量：【真语义】接口调用 ----------------
     约定：POST { urls: [...] } → { vectors: [[...], ...] }（同长等序）。
     语义模型体积大、跑不动就退化成「视觉描述子」，绝不假装有语义分。
     端点从 CONFIG.PLUS_EMBED_URL 读；没配就是没启用。 */
  function semEndpoint() {
    try { return (window.CONFIG && window.CONFIG.PLUS_EMBED_URL) || ""; } catch (e) { return ""; }
  }
  async function embed(urls, endpoint) {
    const list = (urls || []).filter(Boolean);
    const ep = endpoint || semEndpoint();
    if (!ep || !list.length) return {};
    const out = {};
    for (let i = 0; i < list.length; i += 16) {
      const chunk = list.slice(i, i + 16);
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: chunk }),
      });
      if (!res.ok) throw new Error("语义向量服务未响应");
      const j = await res.json();
      const vecs = (j && j.vectors) || [];
      chunk.forEach((u, k) => { if (vecs[k] && vecs[k].length) out[u] = vecs[k]; });
    }
    return out;
  }
  /* 向量相似度：CLIP 类模型的余弦通常落在 0.3~0.95，
     直接拿余弦当相似度会整体偏高（不同款也有 0.6），所以做一次线性拉伸。 */
  function semSim(a, b) {
    if (!a || !b || !a.length || a.length !== b.length) return null;
    return clamp01((cos(a, b) - 0.35) / 0.55);
  }

  /* ================= 浏览器侧：取图 → 算特征 ================= */
  /* 跨域图片读像素会被画布污染。先试 crossOrigin=anonymous（大多数 CDN 会带
     Access-Control-Allow-Origin），失败就退回"无 CORS 取图 + 不放 canvas"，
     此时该图只能参与标题相似度，视觉分按缺失处理——不编造分数。 */
  function loadImage(url, timeout) {
    return new Promise((resolve, reject) => {
      if (typeof Image === "undefined") { reject(new Error("无浏览器环境")); return; }
      const img = new Image();
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; reject(new Error("超时")); } }, timeout || 15000);
      img.onload = () => { if (!done) { done = true; clearTimeout(t); resolve(img); } };
      img.onerror = () => { if (!done) { done = true; clearTimeout(t); reject(new Error("加载失败")); } };
      img.crossOrigin = "anonymous";
      img.src = url;
    });
  }
  async function hashUrl(url, opt) {
    const o = opt || {};
    const img = await loadImage(url, o.timeout);
    const W = 64, H = 64;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;   // 跨域未授权会在这里抛 SecurityError
    return features(data, W, H);
  }

  return {
    /* 常量（测试与文档要读到同一份数值） */
    T_SAME, T_GAP, W,
    normTitle, textSim, bigrams, jaccard, dice, levSim,
    toGray, resizeGray, features, phash, dhash, hamming, imgSim,
    combine, verdict, assign, mergeManual, clamp01,
    embed, semSim, semEndpoint,
    loadImage, hashUrl,
  };
})();

try { window.PLUSM = PLUSM; } catch (e) {}