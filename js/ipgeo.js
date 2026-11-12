/* ============================================================
 * 登录 IP → 归属地（省市 / 国家）
 * ------------------------------------------------------------
 * 用途：后台「权限管理」用户表里，把登录 IP 换成看得懂的地点。
 *
 * 设计取舍：
 *  1) 查询在浏览器里做，结果缓存在本机（localStorage，默认 30 天）。
 *     同一 IP 只查一次，翻页/刷新不会重复请求；
 *  2) 内网/保留地址（10.x、192.168.x、127.x…）不发请求，直接显示「内网地址」；
 *  3) 查询失败不报错、不阻塞表格：单元格显示「—」，鼠标悬停给出原因，
 *     点一下可单独重试该行；
 *  4) 服务地址可在 config.js 里改（IP_GEO.url），也可以整体关掉
 *     （IP_GEO.enabled = false），关掉后这一列只显示「未启用」。
 * ============================================================ */
(function () {
  const CACHE_KEY = "ipgeo_cache_v1";
  const CFG = (window.CONFIG && window.CONFIG.IP_GEO) || {};
  const ENABLED = CFG.enabled !== false;
  const URL_TPL = CFG.url || "https://ipwho.is/{ip}";
  const TTL_DAYS = Number(CFG.ttlDays || 30);
  const MAX_CONCURRENT = 2;

  let cache = loadCache();
  const inflight = Object.create(null);
  const queue = [];
  let running = 0;

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      const o = raw ? JSON.parse(raw) : {};
      return (o && typeof o === "object") ? o : {};
    } catch (e) { return {}; }
  }

  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* 配额满就算了，不影响主流程 */ }
  }

  /* 内网 / 保留地址：不发请求 */
  function isPrivate(ip) {
    const s = String(ip || "").trim();
    if (!s) return true;
    if (/^::1$/.test(s) || /^fe80:/i.test(s) || /^f[cd][0-9a-f]{2}:/i.test(s)) return true;
    const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  function fresh(rec) {
    if (!rec || !rec.ts) return false;
    return (Date.now() - rec.ts) < TTL_DAYS * 86400000;
  }

  /* 把不同服务商的返回统一成一句话 */
  function normalize(j) {
    if (!j) return "";
    if (j.success === false) return "";
    const country = j.country || j.country_name || "";
    const region = j.region || j.regionName || j.province || "";
    const city = j.city || "";
    const parts = [];
    if (country && country !== "China" && country !== "中国") parts.push(country);
    if (region && region !== city) parts.push(region);
    if (city) parts.push(city);
    if (!parts.length && country) parts.push(country);
    return parts.join(" ").trim();
  }

  async function fetchOne(ip) {
    const url = URL_TPL.replace("{ip}", encodeURIComponent(ip));
    const ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
    try {
      const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      const loc = normalize(j);
      if (!loc) throw new Error("未识别");
      cache[ip] = { loc, ts: Date.now() };
      saveCache();
      return loc;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function pump() {
    while (running < MAX_CONCURRENT && queue.length) {
      const job = queue.shift();
      running++;
      (async () => {
        let text = "";
        try { text = await fetchOne(job.ip); } catch (e) { text = ""; }
        running--;
        job.done(text);
        pump();
      })();
    }
  }

  window.IPGeo = {
    enabled: ENABLED,
    isPrivate,

    /* 同步取：只读缓存与内网判断，不触发请求。
       返回 { text, state }，state ∈ cached | private | pending | off */
    peek(ip) {
      const s = String(ip || "").trim();
      if (!s) return { text: "", state: "pending" };
      if (isPrivate(s)) return { text: "内网地址", state: "private" };
      if (!ENABLED) return { text: "未启用", state: "off" };
      const rec = cache[s];
      if (fresh(rec)) return { text: rec.loc, state: "cached" };
      return { text: "", state: "pending" };
    },

    /* 异步解析一个 IP（命中缓存立即返回） */
    resolve(ip) {
      const s = String(ip || "").trim();
      if (!s || isPrivate(s)) return Promise.resolve("");
      if (!ENABLED) return Promise.resolve("");
      const rec = cache[s];
      if (fresh(rec)) return Promise.resolve(rec.loc);
      if (inflight[s]) return inflight[s];
      inflight[s] = new Promise((resolve) => {
        queue.push({ ip: s, done: (t) => { delete inflight[s]; resolve(t); } });
        pump();
      });
      return inflight[s];
    },

    /* 批量：逐个补全并回调，用于表格逐行填充（不阻塞渲染） */
    resolveMany(ips, onEach) {
      const list = [...new Set((ips || []).map((x) => String(x || "").trim()).filter(Boolean))];
      list.forEach((ip) => {
        if (isPrivate(ip) || !ENABLED) return;
        const rec = cache[ip];
        if (fresh(rec)) { onEach && onEach(ip, rec.loc); return; }
        this.resolve(ip).then((t) => { if (t) onEach && onEach(ip, t); });
      });
    },

    /* 清空本机缓存（换了查询服务、或想强制重查时用） */
    clearCache() {
      cache = {};
      saveCache();
    },
  };
})();
