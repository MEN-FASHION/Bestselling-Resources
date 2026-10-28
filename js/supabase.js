/* ============================================================
 * Supabase 封装：登录验证（Auth）+ 图片清单（DB）
 * 图片文件本身（读写）走 Cloudflare Worker -> R2 私有桶
 * 需要在页面里先用 CDN 引入 supabase-js，再引入本脚本。
 * ============================================================ */
const SB = (() => {
  if (!window.supabase) throw new Error("supabase-js 未加载，请检查 CDN 脚本顺序");
  const client = window.supabase.createClient(
    window.CONFIG.SUPABASE.url,
    window.CONFIG.SUPABASE.anonKey
  );

  // 配置自检：判断"页面是否真的拿到了可用的访问密钥"。
  // 为什么必须查这一步：Supabase 网关收到"没带密钥"的请求时，
  // 会在到达接口之前就拒绝（响应体形如 No API key found in request），
  // 页面若把它当成业务错误，就会误报成"当前账号没有权限"——把超管引向改权限的错误方向。
  // 这里提前判定并给出人话原因（缺失 / 格式不对 / 与地址不是同一项目），一个请求都不用发。
  function checkConfigHealth() {
    const cfg = (window.CONFIG && window.CONFIG.SUPABASE) || {};
    const url = String(cfg.url || "").trim();
    const key = String(cfg.anonKey || "").trim();
    const refFromUrl = (url.match(/^https:\/\/([a-z0-9-]+)\.supabase\./i) || [])[1] || "";
    let refFromKey = "", role = "";
    if (key) {
      try {
        const part = key.split(".")[1] || "";
        const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
        const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        const payload = JSON.parse(atob(pad));
        refFromKey = String(payload.ref || "");
        role = String(payload.role || "");
      } catch (e) { /* 解析失败按格式问题处理 */ }
    }
    const problems = [];
    if (!url) problems.push("配置里缺少数据库地址");
    if (!key) problems.push("配置里缺少访问密钥");
    else if (key.split(".").length !== 3 || !/^eyJ/.test(key)) problems.push("访问密钥格式不正确");
    else if (!refFromKey) problems.push("访问密钥无法解析");
    else if (refFromUrl && refFromKey !== refFromUrl) problems.push("访问密钥与数据库地址不属于同一个项目");
    return { ok: problems.length === 0, problems, refFromUrl, refFromKey, role };
  }

  /* ---------- 数据库错误的「可定位」解析 ----------
   * 不同版本的接口服务对"缺字段/缺表"给的文案不同：
   *   旧版：column "sort_no" does not exist / relation "xxx" does not exist
   *   新版：Could not find the 'sort_no' column of 'xxx' in the schema cache（PGRST204）
   *         Could not find the table 'public.xxx' in the schema cache（PGRST205）
   * 只按旧文案判断会漏判，前端就只能笼统提示"读取失败"——所以统一在这里识别。
   */
  function errText(e) {
    if (!e) return "";
    if (typeof e === "string") return e;
    return [e.message, e.details, e.hint, e.code].filter(Boolean).join(" | ");
  }
  function missingColumn(e) {
    const t = errText(e);
    let m = t.match(/Could not find the '([^']+)' column/i);
    if (m) return m[1];
    m = t.match(/column\s+["']?([A-Za-z0-9_]+)["']?\s+does not exist/i);
    if (m) return m[1];
    return "";
  }
  function missingTable(e) {
    const t = errText(e);
    return /Could not find the table/i.test(t)
      || /relation\s+["']?[A-Za-z0-9_.]+["']?\s+does not exist/i.test(t)
      || /42P01/.test(t);
  }

  // 取当前登录令牌（会话里是过期令牌时先用 refresh token 续期，确保拿到新鲜 token）
  async function freshAccessToken() {
    const readSess = async () => {
      try {
        const s = await client.auth.getSession();
        return (s && s.data && s.data.session) || null;
      } catch (e) { return null; }
    };
    // 已过期（或 60 秒内即将过期）才需要续期：不做无谓刷新，
    // 避免每次取 token 都 refreshSession 触发 TOKEN_REFRESHED，导致图片列表反复重绘闪跳。
    const isStale = (sess) => {
      if (!sess || !sess.access_token) return true;
      const exp = Number(sess.expires_at || 0);   // 秒级时间戳
      if (!exp) return false;
      return exp - Math.floor(Date.now() / 1000) <= 60;
    };
    let sess = await readSess();
    if (isStale(sess)) {
      try { await client.auth.refreshSession(); } catch (e) { /* 无刷新令牌或刷新失败：继续用现有令牌 */ }
      sess = (await readSess()) || sess;
    }
    return (sess && sess.access_token) || "";
  }

  async function currentToken() {
    return await freshAccessToken();
  }

  // ---------- 上传前自动压缩：按体积强制压到 200KB 以下 WebP ----------
  // 无论原图尺寸与格式如何，只要文件超过目标体积就压缩成 WebP；
  // 用「逐步降质量 + 必要时缩小尺寸」双梯度逼近目标体积，确保不影响观感；
  // 一律不再以尺寸作判断，只以文件大小校验；失败时回退原文件，绝不丢图。
  async function compressImage(file, maxKB = 200) {
    if (!file || !/^image\//i.test(file.type || "")) return file;
    const TARGET = (maxKB > 0 ? maxKB : 200) * 1024;   // 目标体积：可指定（200/100/40 KB），默认200KB
    const HEADROOM = 0.92;            // 留出余量，避免刚好边缘
    if (file.size <= TARGET) return file;   // 已达标，不处理
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = dataUrl;
      });
      const w0 = img.naturalWidth || 0;
      const h0 = img.naturalHeight || 0;
      if (!w0 || !h0) return file;
      const limit = Math.floor(TARGET * HEADROOM);

      // 在指定尺寸/质量下编码一次，返回 blob（失败返回 null）
      const encode = (cw, ch, q) => new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";        // 白底，避免透明图转 WebP 变黑底
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        canvas.toBlob(resolve, "image/webp", q);
      });

      // 梯度1：保持原尺寸，逐步降质量
      let best = null;
      const qualities = [0.82, 0.7, 0.6, 0.5, 0.4, 0.3];
      for (const q of qualities) {
        const blob = await encode(w0, h0, q);
        if (blob && blob.size <= limit && (!best || blob.size < best.size)) best = blob;
        if (blob && blob.size <= limit) break;
      }
      // 梯度2：若降质量仍超限，按比例缩小尺寸再压
      if (!best) {
        const ratios = [0.7, 0.5, 0.38, 0.28];
        for (const r of ratios) {
          const cw = Math.max(1, Math.round(w0 * r));
          const ch = Math.max(1, Math.round(h0 * r));
          const blob = await encode(cw, ch, 0.75);
          if (blob && blob.size <= limit) { best = blob; break; }
        }
      }
      // 兜底：若仍然超限，取当前最小可用的一个，且确保小于原图
      if (!best) {
        const blob = await encode(Math.max(1, Math.round(w0 * 0.22)), Math.max(1, Math.round(h0 * 0.22)), 0.6);
        if (blob) best = blob;
      }
      if (!best || best.size >= file.size) return file;   // 转码不划算则保留原图（极端情况，不丢图）
      // 保留原文件名，仅替换内容与 MIME，避免影响去重/命名逻辑
      return new File([best], file.name, { type: "image/webp" });
    } catch (e) {
      return file;
    }
  }

  return {
    client,

    // ============ Auth ============
    // 邮箱规范化：去首尾空格并转小写
    normalizeEmail(e) {
      if (!e) return "";
      return String(e).trim().toLowerCase();
    },
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({
        email: this.normalizeEmail(email),
        password
      });
      return { data, error };
    },
    // 重新发送注册确认邮件（注册后未收到确认邮件时调用）
    async resendConfirm(email) {
      const { data, error } = await client.auth.resend({
        type: 'signup',
        email: this.normalizeEmail(email)
      });
      return { data, error };
    },
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({
        email: this.normalizeEmail(email),
        password
      });
      // 登录成功后记录登录设备与 IP（安全设置：供超管后台「用户权限分配表」展示）
      if (!error && data && data.session) {
        this.recordLogin().catch(() => {});
      }
      return { data, error };
    },
    // ---------- 登录设备 / IP 记录（安全设置） ----------
    // 解析 userAgent 得到「浏览器 / 系统」，获取公网 IP，写 login_logs（失败静默忽略，不影响登录）。
    async recordLogin() {
      const device = this.parseDevice(navigator.userAgent || "");
      let ip = "";
      try {
        const r = await fetch("https://api.ipify.org?format=json", { method: "GET" });
        const j = await r.json();
        ip = (j && j.ip) || "";
      } catch (e) { /* 忽略 IP 获取失败，仍记录设备 */ }
      // 已用 JS 原生 fetch 获取 IP；record_login 是接受 (device, ip) 的函数
      const s = await this.getSession();
      const uid = s?.user?.id;
      if (!uid) return;
      await client.rpc("record_login", { p_device: device, p_ip: ip });
    },
    // 从 userAgent 解析可读的设备描述（浏览器 + 操作系统）
    parseDevice(ua) {
      ua = String(ua || "");
      let browser = "未知浏览器";
      const bRules = [
        [/Edg\/([\d.]+)/i, "Edge"],
        [/OPR\/([\d.]+)/i, "Opera"],
        [/Chrome\/([\d.]+)/i, "Chrome"],
        [/Firefox\/([\d.]+)/i, "Firefox"],
        [/Safari\/([\d.]+)/i, "Safari"],
      ];
      for (const [re, name] of bRules) { if (re.test(ua)) { browser = name; break; } }
      let os = "未知系统";
      const oRules = [
        [/Windows NT 10/i, "Windows 10/11"], [/Windows NT 6\.3/i, "Windows 8.1"],
        [/Windows NT 6\.1/i, "Windows 7"], [/Windows/i, "Windows"],
        [/iPhone/i, "iOS"], [/iPad/i, "iPadOS"], [/Android/i, "Android"],
        [/Mac OS X/i, "macOS"], [/Linux/i, "Linux"],
      ];
      for (const [re, name] of oRules) { if (re.test(ua)) { os = name; break; } }
      // 移动端标注
      const isMobile = /Android|iPhone|iPad/i.test(ua);
      return (browser + " · " + os + (isMobile ? " · 移动端" : ""));
    },
    // 判断邮箱是否已注册（依赖 is_email_registered RPC，用于登录时区分账号/密码错误）
    async isEmailRegistered(email) {
      const { data, error } = await client.rpc("is_email_registered", { p_email: this.normalizeEmail(email) });
      if (error) throw error;
      return !!data;
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      return { error };
    },
    // ---------- 修改密码（安全设置） ----------
    // 先校验旧密码（服务端 signInWithPassword 校验），正确后再用 auth.updateUser 更新新密码。
    // 旧密码错误时返回 error，前端 toast 提示；成功后 Supabase 自动保持当前会话（无需重新登录）。
    async changePassword(oldPwd, newPwd) {
      // 取当前登录邮箱
      const s = await client.auth.getSession();
      const email = s?.data?.session?.user?.email;
      if (!email) return { error: { message: "请先登录" } };
      // 校验旧密码
      const chk = await client.auth.signInWithPassword({ email, password: oldPwd });
      if (chk.error) {
        return { error: { message: "旧密码不正确" } };
      }
      // 更新为新密码
      const upd = await client.auth.updateUser({ password: newPwd });
      if (upd.error) {
        return { error: upd.error };
      }
      return { data: upd.data, error: null };
    },
    async getSession() {
      const { data } = await client.auth.getSession();
      return data.session;
    },
    // 暴露当前登录令牌（过期时自动续期，避免把过期令牌发给接口被判未登录）
    async currentToken() {
      return await freshAccessToken();
    },
    onAuth(cb) {
      client.auth.onAuthStateChange((_event, session) => cb(session));
    },

    // 当前登录用户的角色（profiles 表，默认 visitor）
    async myRole() {
      const session = await this.getSession();
      if (!session) return null;
      const { data, error } = await client
        .from("profiles")
        .select("role")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) return null;  // 读取出错 → 返回 null，由调用方区分"读取失败"与"真访客"，避免误判
      if (!data || !data.role) return "visitor";
      return data.role;
    },

    // ============ 图片存储（走 Worker -> R2） ============

    // 取出图片的访问 URL（带当前登录令牌，经 Worker 鉴权）
    // img: 数据库里的一条图片记录（含 path 字段）
    imageUrl(img) {
      const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      return base + "/" + img.path;
    },

    // 带当前登录令牌的图片访问 URL（给 <img> 标签用，令牌走 query 参数）
    async imageUrlWithToken(img) {
      const token = await this.currentToken();
      const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      if (!token) return base + "/" + img.path;
      return base + "/" + img.path + "?token=" + encodeURIComponent(token);
    },

    // 管理员上传：通过 Worker 写入 R2，返回存储 path
    async uploadImage(file, category) {
      const token = await currentToken();
      const f = await compressImage(file);
      const fd = new FormData();
      fd.append("file", f);
      fd.append("category", category);
      const res = await fetch(window.CONFIG.WORKER_URL + "/upload", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "上传失败");
      return j.path;
    },

    // 管理员删除：通过 Worker 从 R2 删除
    async deleteImage(path) {
      const token = await currentToken();
      const res = await fetch(window.CONFIG.WORKER_URL + "/" + path, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "删除失败");
    },

    // ============ 存量图片压缩池 ============
    // 对外暴露压缩引擎（供压缩池把任意图转成 ≤200KB WebP）
    async compress(file, maxKB = 200) {
      return compressImage(file, maxKB);
    },
    // 列出存储里全部图片（key + 字节数），供左右池子区分「已压缩 / 待压缩」
    async listStorageImgs() {
      const token = await currentToken();
      const res = await fetch(window.CONFIG.WORKER_URL + "/admin/list-imgs", {
        headers: { Authorization: "Bearer " + token },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "读取清单失败");
      return (j.items || []);
    },
    // 用压缩后的 WebP 覆盖写回原路径（URL 不变）
    async overwriteStoredImg(path, file) {
      const token = await currentToken();
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(window.CONFIG.WORKER_URL + "/admin/overwrite?path=" + encodeURIComponent(path), {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "覆盖失败");
      return true;
    },

    // ============ DB（图片清单） ============
    async listImages(category, opts) {
      let q = client.from("images").select("*").order("created_at", { ascending: false });
      if (category && category !== "全部") q = q.eq("category", category);
      if (opts && typeof opts.from === "number" && typeof opts.to === "number") {
        q = q.range(opts.from, opts.to);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message || "读取失败");
      return data || [];
    },
    // 数据看板专用：统计全站图片（含其他管理员上传），仅 admin / super_admin 可调用
    // 图片管理列表仍走 listImages（受 RLS 限制，管理员只看到并只能改自己上传的）
    async listDashboardImages() {
      // 首选专用统计函数（一次取全站）；函数还没建进库里时不能让看板退化成「只有自己上传的」
      try {
        const { data, error } = await client.rpc("dashboard_images");
        if (!error && Array.isArray(data)) return data;
      } catch (e) { /* 继续兜底 */ }
      try {
        const all = await this.listAllImagesPaged();
        if (all.length) return all;
      } catch (e) { /* 继续兜底 */ }
      return this.listImages(null);
    },
    // 全站图片（逐页拉全）：看板统计、超管的图片管理都用它
    // 走库里已有的前台分页函数（security definer，登录即可读全站），无需另建函数
    async listAllImagesPaged(maxPages) {
      const pageSize = 500, pages = maxPages || 20, out = [];
      for (let p = 0; p < pages; p++) {
        const { data, error } = await client.rpc("frontend_list_images_page", { p_limit: pageSize, p_offset: p * pageSize });
        if (error) throw new Error(error.message || "读取失败");
        const rows = data || [];
        for (const r of rows) out.push(r);
        if (rows.length < pageSize) break;
      }
      return out;
    },
    // 图片总数（后台分页判断；RLS 生效时仅统计当前用户可见数）
    async countImages(category) {
      let q = client.from("images").select("id", { count: "exact", head: true });
      if (category && category !== "全部") q = q.eq("category", category);
      const { count, error } = await q;
      if (error) throw new Error(error.message || "读取失败");
      return Number(count) || 0;
    },
    // 前台浏览专用：所有登录用户读取全部已发布图片（走 security definer 函数，
    // 绕过后台"智能打标"里"管理员只看自己上传的"这条 RLS 限制，仅前台前端调用）
    async listFrontendImages(limit, offset) {
      if (typeof limit === "number" && limit > 0) {
        // 服务端分页：按 created_at 倒序取第 offset 页，每页 limit 条
        const { data, error } = await client.rpc("frontend_list_images_page", {
          p_limit: limit,
          p_offset: typeof offset === "number" && offset > 0 ? offset : 0,
        });
        if (error) throw new Error(error.message || "读取失败");
        return data || [];
      }
      const { data, error } = await client.rpc("frontend_list_images");
      if (error) throw new Error(error.message || "读取失败");
      return data || [];
    },
    // 前台「筛选视图」全量取图（分页循环累加）
    // 背景：单次调用一次性返回全部图片，会被数据库 API 的"单次最大返回条数"上限截断
    //       （超管后台看到 1875 张、前台某类目却 0 张，就是旧图整批落在上限之外）。
    //       类目菜单走的是聚合函数（只返回 1 行），不受上限影响，于是出现"类目还在、图没了"。
    // 做法：按页循环取，偏移量按"实际返回条数"推进（兼容服务端上限比请求值更小的情况）；
    //       总数来自计数接口，取满即停；中途失败则保留已取到的部分并标记不完整。
    async listAllFrontendImages(pageSize) {
      const PAGE = (typeof pageSize === "number" && pageSize > 0) ? pageSize : 1000;
      const rows = [];
      let total = null;
      let failed = false;
      try { total = await this.countFrontendImages(); } catch (e) { total = null; }
      let offset = 0;
      for (let guard = 0; guard < 500; guard++) {
        let page;
        try {
          page = await this.listFrontendImages(PAGE, offset);
        } catch (e) {
          failed = true;
          if (!rows.length) throw e;   // 一条都没取到：如实抛错，交给上层展示真实原因
          break;                        // 已取到部分：保留，并标记不完整
        }
        if (!Array.isArray(page) || page.length === 0) break;
        for (let i = 0; i < page.length; i++) rows.push(page[i]);
        offset += page.length;
        if (total != null && rows.length >= total) break;
        if (page.length < PAGE && total == null) break;   // 未知总数且不足一页 → 视为取完
      }
      return { rows: rows, total: total, complete: !failed && (total == null ? true : rows.length >= total) };
    },
    // 前台图片总数（分页判断是否还有下一页）
    async countFrontendImages() {
      const { data, error } = await client.rpc("frontend_count_images");
      if (error) throw new Error(error.message || "读取失败");
      return Number(data) || 0;
    },
    // 前台标签/类目计数聚合（分页网格下标签栏与类目菜单显示真实总数）
    async frontendTagStats() {
      const { data, error } = await client.rpc("frontend_tag_stats");
      if (error) throw new Error(error.message || "读取失败");
      return data || {};
    },
    // 返回所有已上传图片名（用于上传时去重校验，避免重复传图）
    async listImageNames() {
      const { data, error } = await client.from("images").select("name");
      if (error) throw new Error(error.message || "读取失败");
      return (data || []).map(d => d && d.name).filter(Boolean);
    },
    async listCategories() {
      const { data, error } = await client.from("images").select("category").order("category");
      if (error) throw new Error(error.message || "读取失败");
      return [...new Set((data || []).map(d => d.category))];
    },
    // 后台图片管理：图片中有图的类目列表（轻量，仅取 category 列，去重排序）
    async manageCategories() {
      const { data, error } = await client.from("images").select("category");
      if (error) throw new Error(error.message || "读取失败");
      return [...new Set((data || []).map(d => d && d.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh"));
    },

    // ============ 类目清单（categories 表） ============
    // 管理员显式添加的类目（前台菜单用，按 sort_order 排序，数字小在前）
    async listActiveCats() {
      const { data, error } = await client.from("categories").select("name, sort_order").order("sort_order").order("name");
      if (error) throw new Error(error.message || "读取失败");
      return (data || []).map(d => d.name);
    },
    // 前台排序用途：返回 id/name/sort_order，供设置类目顺序
    async listActiveCatsWithOrder() {
      const { data, error } = await client.from("categories").select("id, name, sort_order").order("sort_order").order("name");
      if (error) throw new Error(error.message || "读取失败");
      return data || [];
    },
    // 设置单个类目的展示顺序
    async setCategoryOrder(id, order) {
      const { error } = await client.from("categories").update({ sort_order: order }).eq("id", id);
      if (error) throw new Error(error.message || "保存顺序失败");
    },
    // 实际上有图片的类目（从 images 表）
    // 前台类目菜单专用：所有登录用户读取图片里实际用到的全部类目
    // （与 frontend_list_images 同理，用 security definer 函数绕开后台 RLS，
    //   避免普通管理员/访客在前台只看到自己上传图的类目）
    async listUsedCats() {
      const { data, error } = await client.rpc("frontend_list_used_cats");
      if (error) throw new Error(error.message || "读取失败");
      return (data || []).filter(v => v && String(v).trim());
    },
    // 管理员新增类目
    async addCategory(name) {
      const n = (name || "").trim();
      if (!n) throw new Error("类目名不能为空");
      const { error } = await client.from("categories").insert({ name: n });
      if (error) throw new Error(error.message === "duplicate key value violates unique constraint \"categories_name_key\"" || (error.code === "23505") ? "该类目已存在" : (error.message || "新增失败"));
    },
    // 管理员删除类目（仅从清单移除，不影响已上传图片）
    async removeCategory(name) {
      const { error } = await client.from("categories").delete().eq("name", name);
      if (error) throw new Error(error.message || "删除失败");
    },
    // 重命名类目：同步更新 categories 表名称 + 所有图片的 category 字段
    async renameCategoryImages(oldName, newName) {
      const n = String(newName || "").trim();
      if (!n) throw new Error("类目名不能为空");
      if (n === oldName) return;
      // 1. 更新 categories 表同名类目（若存在）
      try {
        const { data: cats, error: cErr } = await client.from("categories").select("id").eq("name", oldName);
        if (!cErr && cats && cats.length) {
          const { error: uErr } = await client.from("categories").update({ name: n }).eq("name", oldName);
          if (uErr && uErr.code !== "23505") throw uErr;
        }
      } catch (e) { if (e.code !== "23505") throw e; }
      // 2. 更新所有图片的 category 字段（字符串字段，用 setImageSingleField）
      const imgs = await this.listImages(null);
      for (const img of imgs) {
        if (img.category === oldName) await this.setImageSingleField(img.id, "category", n);
      }
    },

    // ============ 常用类目（当前用户的快捷清单，仅自己可见） ============
    // 历史缺陷：profiles 表根本没有 favorite_categories 字段，而且普通账号无权更新自己的 profiles
    // （update 策略只给了超管），所以「常用类目」既读不出来也存不进去——界面能勾、能点保存、
    // 还提示成功，实际什么都没写；「常用置顶」从来没生效过，删掉类目后旧项也一直挂着。
    // 现在改为调用 security definer 函数读写（不放开 profiles 的 update 策略，避免提权风险）；
    // 函数尚未在库里建立时自动回退旧写法（至少不会直接崩）。
    async myFavCats() {
      try {
        const { data, error } = await client.rpc("get_my_favorite_categories");
        if (!error) return (Array.isArray(data) ? data : []).filter(Boolean);
      } catch (e) { /* 函数未建 → 回退 */ }
      const session = await this.getSession();
      if (!session) return [];
      const { data, error } = await client
        .from("profiles")
        .select("favorite_categories")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error || !data) return [];
      return data.favorite_categories || [];
    },
    async updateFavCats(arr) {
      const list = [...new Set((arr || []).map(x => (x || "").trim()).filter(Boolean))];
      try {
        const { data, error } = await client.rpc("set_my_favorite_categories", { p_list: list });
        if (!error) return (Array.isArray(data) ? data : list);
      } catch (e) { /* 函数未建 → 回退 */ }
      const session = await this.getSession();
      if (!session) throw new Error("未登录");
      const { error } = await client
        .from("profiles")
        .update({ favorite_categories: list })
        .eq("user_id", session.user.id);
      if (error) throw new Error(error.message || "保存失败");
      return list;
    },
    // 类目被删除时：把该类目从所有管理员的常用类目里一并清掉
    // （优先数据库函数一次完成；函数未建时退化为"只清当前账号"，保证自己这边不残留）
    async clearCatFromProfiles(name) {
      const v = String(name || "").trim();
      if (!v) return 0;
      try {
        const { data, error } = await client.rpc("remove_category_from_profiles", { p_name: v });
        if (!error) return Number(data) || 0;
      } catch (e) { /* 函数未建 → 退化为只清当前账号 */ }
      try {
        const mine = await this.myFavCats();
        if (mine.indexOf(v) >= 0) { await this.updateFavCats(mine.filter((c) => c !== v)); return 1; }
      } catch (e) { }
      return 0;
    },
    async addImageRecord({ category, name, path, url }) {
      const token = await currentToken();
      const s = await client.auth.getSession();
      const { error } = await client.from("images").insert({
        category, name, path,
        url: (url || "").trim() || null,
        uploaded_by: s?.data?.session?.user?.id || null,
      });
      if (error) throw new Error(error.message || "写入失败");
    },
    async removeImageRecord(id) {
      const { error } = await client.from("images").delete().eq("id", id);
      if (error) throw new Error(error.message || "删除失败");
    },
    // 给单张图片设置指定字段的标签（覆盖式写入，去重、过滤空值）
    // field 传入单元格名：tags(渠道) / style_tags(风格) / element_tags(元素)
    async updateImageField(id, field, tags) {
      const arr = [...new Set((tags || []).map(x => String(x).trim()).filter(Boolean))];
      const { error } = await client.from("images").update({ [field]: arr }).eq("id", id);
      if (error) throw new Error(error.message || "打标失败");
      return arr;
    },
    // 给单张图片设置渠道标签（兼容旧调用）
    async updateImageTags(id, tags) {
      return this.updateImageField(id, "tags", tags);
    },
    // 给单张图片设置单值字段（如 category 类目，是字符串不是数组）
    async setImageSingleField(id, field, value) {
      const v = value == null ? "" : String(value);
      const { error } = await client.from("images").update({ [field]: v }).eq("id", id);
      if (error) throw new Error(error.message || "设置失败");
      return v;
    },
    // 清空一批图片的指定字段标签
    async clearImageFields(ids, fields) {
      if (!ids || !ids.length) return;
      const patch = {};
      (fields || []).forEach(f => { patch[f] = []; });
      const { error } = await client.from("images").update(patch).in("id", ids);
      if (error) throw new Error(error.message || "清除标签失败");
    },
    // 清空一批图片的渠道标签（兼容旧调用）
    async clearImageTags(ids) {
      return this.clearImageFields(ids, ["tags"]);
    },

    /* ---------- 视觉专区批量打标（20261028B 导入用） ----------
       一次导入可能是上千行 × 11 个字段，逐条 update 会排成长队。
       这里按 20 条并发推送，单条失败不中断整批，返回 { ok, fail, errors }。
       patch 形如 { style_tags:[...], craft_tags:[...], ... }，只带要写的字段。 */
    async batchUpdateImageTags(updates, concurrency) {
      var list = (updates || []).filter(function (u) { return u && u.id != null && u.patch && Object.keys(u.patch).length; });
      var ok = 0, fail = 0, errors = [];
      var n = Math.max(1, concurrency || 20);
      for (var i = 0; i < list.length; i += n) {
        var slice = list.slice(i, i + n);
        var rs = await Promise.all(slice.map(async function (u) {
          var patch = {};
          Object.keys(u.patch).forEach(function (k) {
            var v = u.patch[k];
            patch[k] = Array.isArray(v)
              ? [...new Set(v.map(function (x) { return String(x).trim(); }).filter(Boolean))]
              : v;
          });
          var r = await client.from("images").update(patch).eq("id", u.id);
          return r && r.error ? (r.error.message || "写入失败") : "";
        }));
        rs.forEach(function (e) { if (e) { fail++; if (errors.length < 5) errors.push(e); } else ok++; });
      }
      return { ok: ok, fail: fail, errors: errors };
    },

    /* 只取 id + url，导入时匹配图片用，避免把整表字段拉下来 */
    async listImageIdUrls() {
      var out = [], from = 0, step = 1000;
      for (;;) {
        var res = await client.from("images").select("id,url,category").range(from, from + step - 1);
        if (res.error) throw new Error(res.error.message || "读取图片清单失败");
        var rows = res.data || [];
        rows.forEach(function (r) { out.push(r); });
        if (rows.length < step) break;
        from += step;
        if (from > 200000) break;
      }
      return out;
    },

    // ---------- 标签定义表（风格/元素自定义标签） ----------
    async listTagDefs(type) {
      let q = client.from("tag_defs").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true });
      if (type) q = q.eq("type", type);
      const { data, error } = await q;
      if (error) throw new Error(error.message || "读取标签失败");
      return data || [];
    },
    async addTagDef(type, name, group) {
      const n = String(name || "").trim();
      if (!n) throw new Error("标签名不能为空");
      // 场景标签为「室内/室外」二级分组：group 传 indoor/outdoor；
      // 新增标签一律置顶（sort_order 0 最小，排最前面）
      const payload = { type, name: n, sort_order: 0 };
      if (type === "scene" && (group === "indoor" || group === "outdoor")) payload.group = group;
      const { data, error } = await client.from("tag_defs").insert(payload).select();
      if (error) throw new Error(error.message || "新增标签失败");
      return data && data[0];
    },
    async updateTagDef(id, name, group) {
      const n = String(name || "").trim();
      if (!n) throw new Error("标签名不能为空");
      const payload = { name: n };
      // 场景标签可同步更新二级分组（indoor/outdoor）
      if (group === "indoor" || group === "outdoor") payload.group = group;
      const { error } = await client.from("tag_defs").update(payload).eq("id", id);
      if (error) throw new Error(error.message || "保存标签失败");
    },
    async deleteTagDef(id) {
      const { error } = await client.from("tag_defs").delete().eq("id", id);
      if (error) throw new Error(error.message || "删除标签失败");
    },
    // 重命名标签并同步更新所有图片字段中的旧标签
    async renameTagDefAndImages(type, oldName, newName) {
      const n = String(newName || "").trim();
      if (!n) throw new Error("标签名不能为空");
      const FIELD_FOR_DEF = { style: "style_tags", element: "element_tags", scene: "scene_tags", shoot: "shoot_tags", skin: "skin_tags", channel: "tags" };
      const field = FIELD_FOR_DEF[type];
      if (!field) throw new Error("不支持的标签类型");
      const imgs = await this.listImages(null);
      for (const img of imgs) {
        if (!Array.isArray(img[field]) || !img[field].includes(oldName)) continue;
        const newArr = img[field].map(t => t === oldName ? n : t);
        await this.updateImageField(img.id, field, newArr);
      }
    },

    // ============ 趋势专区（趋势文件：R2 存本体 + trends 表存清单） ============
    // 上传趋势文件（经 Worker -> R2，返回 { path, cover }）
    async uploadTrendFile(file, cover) {
      return await this.uploadTrendFileXHR(file, cover, null);
    },
    // 带进度上传（XHR 支持 progress；onProgress 回调 0-100 百分比）
    async uploadTrendFileXHR(file, cover, onProgress) {
      const token = await currentToken();
      // 主文件与封面都强制压缩到 200KB 以下（按文件大小驱动，不按尺寸）
      const f = await compressImage(file);
      const c = cover ? await compressImage(cover) : null;
      const fd = new FormData();
      fd.append("file", f);
      if (c) fd.append("cover", c);
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", window.CONFIG.WORKER_URL + "/trend/upload");
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.upload.onprogress = (e) => {
          if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          let j = {};
          try { j = JSON.parse(xhr.responseText || "{}"); } catch (e) {}
          if (xhr.status >= 200 && xhr.status < 300 && j.ok) resolve({ path: j.path, cover: j.cover || "" });
          else reject(new Error(j.error || "上传失败"));
        };
        xhr.onerror = () => reject(new Error("网络异常，上传失败"));
        xhr.send(fd);
      });
    },
    // 受控预览 URL（需登录令牌，经 Worker 鉴权，防下载）
    async trendPreviewUrl(path) {
      const token = await this.currentToken();
      const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      if (!token) return base + "/trend/preview?path=" + encodeURIComponent(path);
      return base + "/trend/preview?path=" + encodeURIComponent(path) + "&token=" + encodeURIComponent(token);
    },
    // 删除趋势文件（经 Worker 从 R2 删除；若带封面 path 一并删除）
    async deleteTrendFile(path, cover) {
      const token = await currentToken();
      let q = "/trend/delete?path=" + encodeURIComponent(path);
      if (cover) q += "&cover=" + encodeURIComponent(cover);
      const res = await fetch(window.CONFIG.WORKER_URL + q, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "删除失败");
    },
    // 受控封面图 URL（需登录令牌，经 Worker 鉴权，防下载）
    async trendCoverUrl(coverPath) {
      const token = await this.currentToken();
      const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      if (!token) return base + "/trend/cover?path=" + encodeURIComponent(coverPath);
      return base + "/trend/cover?path=" + encodeURIComponent(coverPath) + "&token=" + encodeURIComponent(token);
    },
    // 读取趋势清单（trends 表，登录用户可读）
    async listTrends() {
      const { data, error } = await client.from("trends").select("*").order("created_at", { ascending: false });
      if (error) throw new Error(error.message || "读取趋势失败");
      return data || [];
    },
    // 新增趋势清单记录
    async addTrendRecord({ title, tag, path, category, file_type, cover, description }) {
      const s = await client.auth.getSession();
      const { error } = await client.from("trends").insert({
        title, tag, path, category: category || "", file_type: file_type || "pdf",
        cover: cover || "", description: description || "",
        uploaded_by: s?.data?.session?.user?.id || null,
      });
      if (error) throw new Error(error.message || "写入趋势失败");
    },
    // 删除趋势清单记录
    async removeTrendRecord(id) {
      const { error } = await client.from("trends").delete().eq("id", id);
      if (error) throw new Error(error.message || "删除趋势失败");
    },
async removeTrendRecord(id) {
      const { error } = await client.from("trends").delete().eq("id", id);
      if (error) throw new Error(error.message || "删除趋势失败");
    },
    // 更新趋势记录（二次编辑：标题/标签/类目/简介/封面）
    async updateTrendRecord(id, fields) {
      const patch = {};
      if (fields.title !== undefined) patch.title = fields.title;
      if (fields.tag !== undefined) patch.tag = fields.tag;
      if (fields.category !== undefined) patch.category = fields.category || "";
      if (fields.description !== undefined) patch.description = fields.description || "";
      if (fields.cover !== undefined) patch.cover = fields.cover || "";
      const { error } = await client.from("trends").update(patch).eq("id", id);
      if (error) throw new Error(error.message || "更新趋势失败");
    },
    // 单独上传/替换趋势封面（Worker 端点 /trend/uploadCover）→ 返回新 cover 路径
    async uploadTrendCover(coverFile, onProgress) {
      const token = await currentToken();
      const c = await compressImage(coverFile);
      const fd = new FormData();
      fd.append("cover", c);
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", window.CONFIG.WORKER_URL + "/trend/uploadCover");
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.upload.onprogress = (e) => {
          if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          let j = {};
          try { j = JSON.parse(xhr.responseText || "{}"); } catch (e) {}
          if (xhr.status >= 200 && xhr.status < 300 && j.ok) resolve({ cover: j.cover || "" });
          else reject(new Error(j.error || "封面上传失败"));
        };
        xhr.onerror = () => reject(new Error("网络异常，封面上传失败"));
        xhr.send(fd);
      });
    },

    // ============ 前台访问模式开关 ============

    // ============ 前台访问模式开关 ============
    // public_access=true：前台免登录公开浏览（Worker 图片也放行）；false：必须登录可见
    async getPublicAccess() {
      const { data, error } = await client
        .from("site_settings").select("public_access").eq("id", 1).maybeSingle();
      if (error || !data) return false;
      return !!data.public_access;
    },
    async setPublicAccess(v) {
      const { error } = await client
        .from("site_settings").update({ public_access: !!v, updated_at: new Date().toISOString() }).eq("id", 1);
      if (error) throw new Error(error.message || "保存失败");
    },

    // 各标签维度是否在前台展示（channel/style/element/scene/shoot/skin）
    async getFrontendDims() {
      const { data, error } = await client
        .from("site_settings").select("frontend_dims").eq("id", 1).maybeSingle();
      if (error || !data || !data.frontend_dims) {
        return { channel: true, style: true, element: true, scene: true, shoot: true, skin: true };
      }
      return data.frontend_dims;
    },
    async setFrontendDim(dim, show) {
      const cur = await this.getFrontendDims();
      cur[dim] = !!show;
      const { error } = await client
        .from("site_settings").update({ frontend_dims: cur, updated_at: new Date().toISOString() }).eq("id", 1);
      if (error) throw new Error(error.message || "保存失败");
    },

    // 各专区 · 各类目 是否在前台可见（frontend_cat_visibility）
    // 返回形如 { visual: {类目: true/false}, trend: {...}, recruit: {...}, bestseller: {...} }
    // 未配置或缺失的类目默认为可见（true）
    async getFrontendCatVisibility() {
      const { data, error } = await client
        .from("site_settings").select("frontend_cat_visibility").eq("id", 1).maybeSingle();
      if (error || !data || !data.frontend_cat_visibility) return {};
      return data.frontend_cat_visibility;
    },
    // zone: visual / trend / recruit / bestseller；visible=false 表示前台隐藏该类目下内容
    async setFrontendCatVisibility(zone, cat, visible) {
      const cur = await this.getFrontendCatVisibility();
      if (!cur[zone]) cur[zone] = {};
      cur[zone][cat] = !!visible;
      const { error } = await client
        .from("site_settings").update({ frontend_cat_visibility: cur, updated_at: new Date().toISOString() }).eq("id", 1);
      if (error) throw new Error(error.message || "保存失败");
    },

    // 各专区 本身 是否在前台可见（frontend_zone_visibility）
    // 返回形如 { visual: true/false, trend: ..., recruit: ..., bestseller: ... }
    // 未配置或缺失的专区默认为可见（true）
    // 原始读取（含内部保留键 __defs，仅内部使用）
    async _zoneRaw() {
      const { data, error } = await client
        .from("site_settings").select("frontend_zone_visibility").eq("id", 1).maybeSingle();
      if (error || !data || !data.frontend_zone_visibility || typeof data.frontend_zone_visibility !== "object") return {};
      return Object.assign({}, data.frontend_zone_visibility);
    },
    async getFrontendZoneVisibility() {
      const raw = await this._zoneRaw();
      const out = {};
      Object.keys(raw).forEach(k => { if (k !== "__defs") out[k] = raw[k]; });
      return out;
    },
    // 专区定义（超管在「权限管理 → 专区管理」维护）：[{key,label,href}]；未配置返回 null
    async getZoneDefs() {
      try {
        const raw = await this._zoneRaw();
        const saved = Array.isArray(raw.__defs) ? raw.__defs : [];
        // 内置专区始终存在：历史保存的 __defs 可能早于某个内置专区（如「趋势上升榜」）上线，
        // 若直接用保存值覆盖，会导致该专区在「专区管理 / 权限勾选 / 前台导航」里整体消失。
        // 因此以「内置清单」为底，用保存值覆盖同 key 的名称与链接，再追加超管新增的专区。
        const out = (window.ZONE_DEFS_DEFAULT || []).map(d => ({ key: String(d.key), label: String(d.label || d.key), href: String(d.href || "") }));
        const idx = {};
        out.forEach((d, i) => { idx[d.key] = i; });
        saved.forEach(d => {
          if (!d || !d.key) return;
          const k = String(d.key);
          if (idx[k] != null) {
            const t = out[idx[k]];
            if (d.label) t.label = String(d.label);
            if (d.href != null && d.href !== "") t.href = String(d.href);
          } else {
            idx[k] = out.length;
            out.push({ key: k, label: String(d.label || k), href: String(d.href || "") });
          }
        });
        return out.length ? out : null;
      } catch (e) { return null; }
    },
    async setZoneDefs(defs) {
      const raw = await this._zoneRaw();
      raw.__defs = (defs || []).map(d => ({ key: String(d.key || ""), label: String(d.label || ""), href: String(d.href || "") }));
      const { error } = await client
        .from("site_settings").update({ frontend_zone_visibility: raw, updated_at: new Date().toISOString() }).eq("id", 1);
      if (error) throw new Error(error.message || "保存失败");
    },
    // zone: 专区 key；visible=false 表示前台隐藏整个专区入口（保留 __defs，避免覆盖专区定义）
    async setFrontendZoneVisibility(zone, visible) {
      const cur = await this._zoneRaw();
      cur[zone] = !!visible;
      const { error } = await client
        .from("site_settings").update({ frontend_zone_visibility: cur, updated_at: new Date().toISOString() }).eq("id", 1);
      if (error) throw new Error(error.message || "保存失败");
    },

    // ============ 新用户默认权限设置（超管） ============
    // 读取新用户默认权限：{ role, frontZones, manageZones }
    // frontZones = 新用户默认前台可见专区（空 = 未配置，按全局 frontend_zone_visibility 显示）
    // manageZones = 新用户默认后台可管理专区（空 = 无后台操作权限，仅前台访问）
    async getDefaultPerms() {
      const { data, error } = await client
        .from("site_settings").select("default_role, default_frontend_zones, default_manage_zones").eq("id", 1).maybeSingle();
      if (error || !data) return { role: "visitor", frontZones: [], manageZones: [] };
      const frontZones = Array.isArray(data.default_frontend_zones) ? data.default_frontend_zones : [];
      const manageZones = Array.isArray(data.default_manage_zones) ? data.default_manage_zones : [];
      return { role: data.default_role || "visitor", frontZones, manageZones };
    },
    // 写入新用户默认权限（role: visitor/admin/super_admin；frontZones/manageZones 均为数组）
    async setDefaultPerms(role, frontZones, manageZones) {
      const cleanRole = ["visitor", "admin", "super_admin"].includes(role) ? role : "visitor";
      const cleanFront = [...new Set((frontZones || []).filter(Boolean))];
      const cleanManage = [...new Set((manageZones || []).filter(Boolean))];
      const { error } = await client
        .from("site_settings").update({ default_role: cleanRole, default_frontend_zones: cleanFront, default_manage_zones: cleanManage, updated_at: new Date().toISOString() }).eq("id", 1);
      if (error) throw new Error(error.message || "保存失败");
    },

    // ============ 公告 ============
    // 后台：读取全部公告（含草稿/下架）
    async listAnnouncements() {
      const { data, error } = await client.from("announcements").select("*").order("created_at", { ascending: false });
      if (error) throw new Error(error.message || "读取公告失败");
      return data || [];
    },
    // 后台：新增公告
    async addAnnouncement({ title, content, published, images }) {
      const { error } = await client.from("announcements").insert({
        title, content: content || "", published: published !== false,
        images: images || [],
      });
      if (error) throw new Error(error.message || "保存公告失败");
    },
    // 后台：更新公告
    async updateAnnouncement(id, patch) {
      const { error } = await client.from("announcements").update(Object.assign({ updated_at: new Date().toISOString() }, patch)).eq("id", id);
      if (error) throw new Error(error.message || "更新公告失败");
    },
    // 后台：删除公告
    async removeAnnouncement(id) {
      const { error } = await client.from("announcements").delete().eq("id", id);
      if (error) throw new Error(error.message || "删除公告失败");
    },
    // 前台：读取近一个月内【已发布】的公告
    async listRecentPublishedAnnouncements() {
      const from = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await client
        .from("announcements").select("*").eq("published", true)
        .gte("created_at", from).order("created_at", { ascending: false });
      if (error) throw new Error(error.message || "读取公告失败");
      return data || [];
    },
    // 前台：读取全部【已发布】公告（历史记录用，含超一个月）
    async listAllPublishedAnnouncements() {
      const { data, error } = await client
        .from("announcements").select("*").eq("published", true)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message || "读取公告失败");
      return data || [];
    },
    // 前台：读取当前登录用户已读的公告 id 列表
    async listMyReadAnnouncementIds() {
      const s = await client.auth.getSession();
      const uid = s?.data?.session?.user?.id;
      if (!uid) return [];
      const { data, error } = await client.from("announcement_reads").select("announcement_id").eq("user_id", uid);
      if (error) return [];
      return (data || []).map(d => d.announcement_id);
    },
    // 前台：标记某公告为已读
    async markAnnouncementRead(id) {
      const s = await client.auth.getSession();
      const uid = s?.data?.session?.user?.id;
      if (!uid) return;
      await client.from("announcement_reads").upsert(
        { announcement_id: id, user_id: uid, read_at: new Date().toISOString() },
        { onConflict: "announcement_id,user_id" }
      );
    },
    // 后台：上传公告图片（经 Worker 存 R2，返回 notices/ 相对路径）
    async uploadNoticeImage(file) {
      const token = await currentToken();
      const f = await compressImage(file);
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(window.CONFIG.WORKER_URL + "/notice/uploadimg", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "图片上传失败");
      return j.path;
    },
    // 前台：公告图片受控 URL（需登录、经 Worker 鉴权、防下载）
    async noticeImageUrl(path) {
      const token = await this.currentToken();
      const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      if (!token) return base + "/notice/img?path=" + encodeURIComponent(path);
      return base + "/notice/img?path=" + encodeURIComponent(path) + "&token=" + encodeURIComponent(token);
    },
// ============ 营销节日日历（时间节点 + 趋势文章） ============
    // 前台/后台：时间节点清单（登录用户可读全部，管理员可管理）
    async listMarketingNodes() {
      const { data, error } = await client.from("marketing_nodes").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true });
      return { data: data || [], error };
    },
    /* ---- 营销日历 · 节庆库（前台只读，后台「营销日历」维护） ---- */
    async listFestivals() {
      // 单次查询会被服务端截断在 1000 行（这也是「导入了 3000 条只显示 1000 条」的原因），
      // 这里用 range 分页把整张表拉完；排序必须稳定（sort_no + id），否则分页会漏行/重行。
      // 兼容旧表：老库里没有 sort_no 时，按 sort_no 排序会整体报错→整页读不出来，
      // 因此这里按「sort_no+id → id → 不排序」逐级降级，宁可顺序差一点也不能一条都读不到。
      if (!client) return { data: [], error: { message: "SUPABASE_NOT_READY", code: "NO_CLIENT" } };
      // 先做一次本地配置自检：缺地址/缺密钥/密钥与地址不同项目时，
      // 请求会在网关层被拒，报错文本与"没有权限"很像，容易把超管引向改权限的错误方向。
      try {
        const h = checkConfigHealth();
        if (!h.ok) return { data: [], error: { message: "页面数据库配置不完整：" + h.problems.join("；"), code: "CONFIG" } };
      } catch (e) { /* 自检本身失败不阻断读取 */ }
      const PAGE = 1000, MAX = 50000;
      const run = async (orders) => {
        let from = 0, all = [];
        for (let guard = 0; guard < 60; guard++) {
          let q = client.from("marketing_festivals").select("*");
          for (const o of orders) q = q.order(o, { ascending: true });
          const { data, error } = await q.range(from, from + PAGE - 1);
          if (error) {
            // 翻到表尾时个别网关会回 416，当作正常结束
            if (/PGRST103|range not satisfiable|416/i.test(errText(error))) return { data: all, error: null, orders };
            return { data: all, error, orders };
          }
          const rows = data || [];
          all = all.concat(rows);
          if (rows.length < PAGE || all.length >= MAX) break;
          from += PAGE;
        }
        return { data: all, error: null, orders };
      };
      let res = await run(["sort_no", "id"]);
      if (res.error && missingColumn(res.error) === "sort_no") res = await run(["id"]);
      if (res.error && missingColumn(res.error) === "id") res = await run([]);
      if (res.error) return { data: res.data || [], error: res.error };
      const degraded = (res.orders || []).join(",") !== "sort_no,id";
      return { data: res.data || [], error: null, degraded };
    },
    /* 诊断：把「表在不在、都有哪些字段、能读多少行」一次性查清，供页面自证原因 */
    async probeFestivals() {
      const out = { client: !!client, config: "", loggedIn: false, table: "", code: "", count: null, columns: {}, missing: [] };
      try { const h = checkConfigHealth(); out.config = h.ok ? "正常" : h.problems.join("；"); } catch (e) { out.config = "未知"; }
      if (!client) { out.table = "数据接口未初始化"; return out; }
      try {
        const s = await client.auth.getSession();
        out.loggedIn = !!(s && s.data && s.data.session);
      } catch (e) { out.loggedIn = false; }
      try {
        const r = await client.from("marketing_festivals").select("id", { count: "exact", head: true });
        if (r.error) { out.table = "读不到"; out.code = r.error.code || ""; out.raw = errText(r.error); return out; }
        out.table = "正常";
        out.count = r.count == null ? null : r.count;
      } catch (e) { out.table = "请求失败"; out.raw = errText(e); return out; }
      const cols = ["id", "name", "date", "region", "cat", "star", "lead", "dur", "idea", "note", "overrides", "sort_no", "updated_at"];
      for (const c of cols) {
        try {
          const r = await client.from("marketing_festivals").select(c).limit(1);
          if (r.error) { out.columns[c] = "缺"; out.missing.push(c); }
          else out.columns[c] = "有";
        } catch (e) { out.columns[c] = "未知"; }
      }
      if (missingTable({ message: out.raw || "" })) out.table = "不存在";
      return out;
    },
    async upsertFestivals(rows) {
      const list = (rows || []).filter(Boolean);
      if (!list.length) return { error: null };
      if (!client) return { error: { message: "SUPABASE_NOT_READY", code: "NO_CLIENT" } };
      const clean = list.map((r) => ({
        id: String(r.id), name: r.name, date: r.date,
        en: r.en || "", region: r.region || "其他", cat: r.cat || "trad",
        star: r.star || 3, lead: r.lead == null ? 120 : r.lead,
        dur: r.dur || 1, idea: r.idea || "", note: r.note || "",
        overrides: r.overrides || null, sort_no: r.sort_no || 0,
        updated_at: new Date().toISOString(),
      }));
      // 老库可能缺 note / overrides / sort_no / updated_at：缺哪个就去掉哪个重试，
      // 不能因为一个可选字段让整批 3091 条全部写不进去。
      let attempt = clean, dropped = [], err = null;
      for (let i = 0; i < 5; i++) {
        const { error } = await client.from("marketing_festivals").upsert(attempt, { onConflict: "id" });
        if (!error) {
          return { error: null, note: dropped.length ? ("已写入，但库里缺少字段：" + dropped.join("、") + "（建议执行一次补字段脚本，否则这些内容下次会被丢弃）") : null };
        }
        err = error;
        const col = missingColumn(error);
        if (!col || dropped.indexOf(col) >= 0) return { error };
        dropped.push(col);
        attempt = attempt.map((r) => { const c = Object.assign({}, r); delete c[col]; return c; });
      }
      return { error: err, note: dropped.length ? ("库里缺少字段：" + dropped.join("、")) : null };
    },
    async deleteFestival(id) {
      const { error } = await client.from("marketing_festivals").delete().eq("id", String(id));
      return { error };
    },
    async deleteFestivals(ids) {
      const list = (ids || []).filter(Boolean).map(String);
      if (!list.length) return { error: null };
      const { error } = await client.from("marketing_festivals").delete().in("id", list);
      return { error };
    },
    async clearFestivals() {
      const { error } = await client.from("marketing_festivals").delete().neq("id", "");
      return { error };
    },
    async addMarketingNode({ title, date, category, sort_order, image, url, description }) {
      const { error } = await client.from("marketing_nodes").insert({
        title, date: date || "", category: category || "festival", sort_order: sort_order || 0,
        image: image || "", url: url || "", description: description || "",
      });
      return { error };
    },
    async updateMarketingNode(id, patch) {
      const { error } = await client.from("marketing_nodes").update(Object.assign({ updated_at: new Date().toISOString() }, patch)).eq("id", id);
      return { error };
    },
    async removeMarketingNode(id) {
      const { error } = await client.from("marketing_nodes").delete().eq("id", id);
      return { error };
    },
    // 前台：已发布的文章清单；后台：全部文章清单（published 传 undefined/null 时读全部）
    async listMarketingArticles(publishedOnly = true) {
      let q = client.from("marketing_articles").select("*");
      if (publishedOnly) q = q.eq("published", true);
      const { data, error } = await q.order("sort_order", { ascending: true }).order("created_at", { ascending: false });
      return { data: data || [], error };
    },
    async addMarketingArticle({ title, url, image, summary, content, node_id, published, sort_order }) {
      const { error } = await client.from("marketing_articles").insert({
        title, url: url || "", image: image || "", summary: summary || "", content: content || "",
        node_id: node_id || null, published: published !== false, sort_order: sort_order || 0,
      });
      return { error };
    },
    async updateMarketingArticle(id, patch) {
      const { error } = await client.from("marketing_articles").update(Object.assign({ updated_at: new Date().toISOString() }, patch)).eq("id", id);
      return { error };
    },
    async removeMarketingArticle(id) {
      const { error } = await client.from("marketing_articles").delete().eq("id", id);
      return { error };
    },
    // 后台：上传营销日历图片（经 Worker 存 R2，返回 marketing/ 相对路径）
    async uploadMarketingImage(file) {
      const token = await currentToken();
      const f = await compressImage(file);
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(window.CONFIG.WORKER_URL + "/marketing/uploadimg", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "图片上传失败");
      return j.path;
    },
    // 前台/后台：营销日历图片受控 URL（需登录、经 Worker 鉴权、防下载）
    async marketingImageUrl(path) {
      const token = await this.currentToken();
      const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      if (!token) return base + "/marketing/img?path=" + encodeURIComponent(path);
      return base + "/marketing/img?path=" + encodeURIComponent(path) + "&token=" + encodeURIComponent(token);
    },
    // ============ 招品回品专区（招品图片存 R2 受控代理 + 任务表 + 提交表） ============
    // 后台：上传招品图片（经 Worker 存 R2，返回 recruits/ 相对路径）
    async uploadRecruitImage(file) {
      const token = await currentToken();
      const f = await compressImage(file);
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(window.CONFIG.WORKER_URL + "/recruit/upload", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "图片上传失败");
      return j.path;
    },
    // 前台/后台：招品图片受控 URL（需登录、经 Worker 鉴权、防下载）
    async recruitImageUrl(path) {
      const token = await this.currentToken();
      const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      if (!token) return base + "/recruit/img?path=" + encodeURIComponent(path);
      return base + "/recruit/img?path=" + encodeURIComponent(path) + "&token=" + encodeURIComponent(token);
    },
    // 后台：删除招品图片（经 Worker 从 R2 删除）
    async deleteRecruitImage(path) {
      const token = await currentToken();
      const res = await fetch(window.CONFIG.WORKER_URL + "/recruit/delete?path=" + encodeURIComponent(path), {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "删除失败");
    },
    
    
    
    
    // 读取招品任务清单（登录可见；默认排除已删除软删除项）
    async listRecruitTasks(filter) {
      // 优先走带软删除/状态过滤的新表查询；旧表缺列时 PostgREST 会返回 400，这里降级为无损查询
      try {
        let q = client.from("recruit_tasks").select("*");
        q = q.is("deleted_at", null);
        if (filter && filter.status) q = q.eq("status", filter.status);
        q = q.order("created_at", { ascending: true });
        const { data, error } = await q;
        if (!error) return data || [];
      } catch (e) {}
      // 降级：线上表缺少 status / deleted_at 列时的安全读取
      const q2 = client.from("recruit_tasks").select("*").order("created_at", { ascending: true });
      const res = await q2;
      if (res.error) throw new Error(res.error.message || "读取招品任务失败");
      let rows = res.data || [];
      if (filter && filter.status) rows = rows.filter(r => (r.status == null ? "published" : r.status) === filter.status);
      rows = rows.filter(r => !r.deleted_at);
      return rows;
    },
    // 后台：读取回收站（已软删除的任务）
    async listRecruitTrash() {
      try {
        const { data, error } = await client.from("recruit_tasks").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false });
        if (!error) return data || [];
      } catch (e) {}
      // 旧表无 deleted_at 列 → 无回收站概念
      return [];
    },
    // 后台：新增招品任务（序号由系统按创建顺序自动生成，无需传入）
    async addRecruitTask({ title, task_id, image_path, status, tags }) {
      const s = await client.auth.getSession();
      const { error } = await client.from("recruit_tasks").insert({
        title: title || "", task_id: String(task_id || "").trim(),
        image_path: image_path || "", status: status || "draft",
        tags: tags || [], uploaded_by: s?.data?.session?.user?.id || null,
      });
      if (error) throw new Error(error.message || "保存招品任务失败");
    },
    // 后台：批量新增招品任务（上传多张图后一次生成多条卡片）
    async addRecruitTasks(list) {
      if (!list || !list.length) return;
      const s = await client.auth.getSession();
      const rows = list.map(x => ({
        title: (x && x.title) || "", task_id: String((x && x.task_id) || "").trim(),
        image_path: (x && x.image_path) || "", status: (x && x.status) || "draft",
        tags: (x && x.tags) || [], category: (x && x.category) || "",
        url: (x && x.url) || null, main_img_url: (x && x.main_img_url) || null,
        site_id: (x && x.site_id) || "", industry_link: (x && x.industry_link) || "",
        open_priority: (x && x.open_priority) || "", open_type: (x && x.open_type) || "",
        recruit_reason: (x && x.recruit_reason) || "", required_at: (x && x.required_at) || "",
        uploaded_by: s?.data?.session?.user?.id || null,
      }));
      const { error } = await client.from("recruit_tasks").insert(rows);
      if (error) throw new Error(error.message || "批量保存招品任务失败");
    },
    // 后台：更新招品任务
    async updateRecruitTask(id, patch) {
      const { error } = await client.from("recruit_tasks").update(Object.assign({}, patch)).eq("id", id);
      if (error) throw new Error(error.message || "更新招品任务失败");
    },
    // 后台：批量更新（用于批量发布/批量绑定）
    async bulkUpdateRecruitTasks(ids, patch) {
      if (!ids || !ids.length) return;
      const { error } = await client.from("recruit_tasks").update(Object.assign({}, patch)).in("id", ids);
      if (error) throw new Error(error.message || "批量更新招品任务失败");
    },
    // 后台：软删除招品任务 → 移入回收站（不删图片与提交记录）
    async removeRecruitTask(id) {
      const { error } = await client.from("recruit_tasks").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(error.message || "移入回收站失败");
    },
    // 后台：从回收站恢复招品任务
    async restoreRecruitTask(id) {
      const { error } = await client.from("recruit_tasks").update({ deleted_at: null }).eq("id", id);
      if (error) throw new Error(error.message || "恢复招品任务失败");
    },
    // 后台：批量从回收站恢复
    async bulkRestoreRecruitTasks(ids) {
      if (!ids || !ids.length) return;
      const { error } = await client.from("recruit_tasks").update({ deleted_at: null }).in("id", ids);
      if (error) throw new Error(error.message || "批量恢复失败");
    },
    // 后台：永久删除（硬删除，连带提交记录 cascade）
    async purgeRecruitTasks(ids) {
      if (!ids || !ids.length) return;
      const { error } = await client.from("recruit_tasks").delete().in("id", ids);
      if (error) throw new Error(error.message || "永久删除失败");
    },
    // 后台：读取全部提交（含 user_id，供看所有用户SPU/导出）
    
    // 前台：当前用户对某任务的提交记录
    // 前台/后台：读取全部商家提交记录（用于悬浮显示与看板统计）
    async listAllRecruitSubmissions() {
      try {
        const { data, error } = await client.from("recruit_submissions").select("*").order("created_at", { ascending: false });
        if (!error) return (data || []).filter(d => (d.spus || []).length > 0);
      } catch (e) {}
      return [];
    },
    async myRecruitSubmission(taskId) {
      const s = await client.auth.getSession();
      const uid = s?.data?.session?.user?.id;
      if (!uid) return null;
      const { data, error } = await client.from("recruit_submissions").select("*").eq("recruit_task_id", taskId).eq("user_id", uid).maybeSingle();
      if (error) return null;
      return data || null;
    },
    // 前台：当前用户保存某任务的货品SPU（upsert，一个任务一条）
    async upsertRecruitSubmission(taskId, spus) {
      const s = await client.auth.getSession();
      const uid = s?.data?.session?.user?.id;
      if (!uid) throw new Error("未登录");
      const arr = [...new Set((spus || []).map(x => String(x).trim()).filter(Boolean))];
      const { error } = await client.from("recruit_submissions").upsert(
        { recruit_task_id: taskId, user_id: uid, spus: arr, updated_at: new Date().toISOString() },
        { onConflict: "recruit_task_id,user_id" }
      );
      if (error) throw new Error(error.message || "保存SPU失败");
      return arr;
    },
    // ============ BESTSELLER 专区（BESTSELLER 图片存 R2 受控代理 + 任务表 + 提交表） ============
    // 后台：上传BESTSELLER 图片（经 Worker 存 R2，返回 bestsellers/ 相对路径）
    async uploadBestsellerImage(file) {
      const token = await currentToken();
      const f = await compressImage(file);
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(window.CONFIG.WORKER_URL + "/bestseller/upload", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "图片上传失败");
      return j.path;
    },
    // 前台/后台：BESTSELLER 图片受控 URL（需登录、经 Worker 鉴权、防下载）
    async bestsellerImageUrl(path) {
      const token = await this.currentToken();
      const base = (window.CONFIG.WORKER_URL || "").replace(/\/$/, "");
      if (!token) return base + "/bestseller/img?path=" + encodeURIComponent(path);
      return base + "/bestseller/img?path=" + encodeURIComponent(path) + "&token=" + encodeURIComponent(token);
    },
    // 后台：删除BESTSELLER 图片（经 Worker 从 R2 删除）
    async deleteBestsellerImage(path) {
      const token = await currentToken();
      const res = await fetch(window.CONFIG.WORKER_URL + "/bestseller/delete?path=" + encodeURIComponent(path), {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "删除失败");
    },
    
    
    
    
    // 读取BESTSELLER 任务清单（登录可见；默认排除已删除软删除项）
    async listBestsellerTasks(filter) {
      // 优先走带软删除/状态过滤的新表查询；旧表缺列时 PostgREST 会返回 400，这里降级为无损查询
      try {
        let q = client.from("bestseller_tasks").select("*");
        q = q.is("deleted_at", null);
        if (filter && filter.status) q = q.eq("status", filter.status);
        q = q.order("created_at", { ascending: true });
        const { data, error } = await q;
        if (!error) return data || [];
      } catch (e) {}
      // 降级：线上表缺少 status / deleted_at 列时的安全读取
      const q2 = client.from("bestseller_tasks").select("*").order("created_at", { ascending: true });
      const res = await q2;
      if (res.error) throw new Error(res.error.message || "读取BESTSELLER 任务失败");
      let rows = res.data || [];
      if (filter && filter.status) rows = rows.filter(r => (r.status == null ? "published" : r.status) === filter.status);
      rows = rows.filter(r => !r.deleted_at);
      return rows;
    },
    // 后台：读取回收站（已软删除的任务）
    async listBestsellerTrash() {
      try {
        const { data, error } = await client.from("bestseller_tasks").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false });
        if (!error) return data || [];
      } catch (e) {}
      // 旧表无 deleted_at 列 → 无回收站概念
      return [];
    },
    // 后台：新增BESTSELLER 任务（序号由系统按创建顺序自动生成，无需传入）
    async addBestsellerTask({ title, task_id, image_path, status, tags }) {
      const s = await client.auth.getSession();
      const { error } = await client.from("bestseller_tasks").insert({
        title: title || "", task_id: String(task_id || "").trim(),
        image_path: image_path || "", status: status || "draft",
        tags: tags || [], uploaded_by: s?.data?.session?.user?.id || null,
      });
      if (error) throw new Error(error.message || "保存BESTSELLER 任务失败");
    },
    // 后台：批量新增BESTSELLER 任务（上传多张图后一次生成多条卡片）
    async addBestsellerTasks(list) {
      if (!list || !list.length) return;
      const s = await client.auth.getSession();
      const rows = list.map(x => ({
        title: (x && x.title) || "", task_id: String((x && x.task_id) || "").trim(),
        image_path: (x && x.image_path) || "", status: (x && x.status) || "draft",
        tags: (x && x.tags) || [], category: (x && x.category) || "",
        url: (x && x.url) || null,
        main_img_url: (x && x.main_img_url) || null,
        goods_id: (x && x.goods_id) || null,
        sku_id: (x && x.sku_id) || null,
        site: (x && x.site) || null,
        rank_time: (x && x.rank_time) || null,
        uploaded_by: s?.data?.session?.user?.id || null,
      }));
      const { error } = await client.from("bestseller_tasks").insert(rows);
      if (error) throw new Error(error.message || "批量保存BESTSELLER 任务失败");
    },
    // 后台：更新BESTSELLER 任务
    async updateBestsellerTask(id, patch) {
      const { error } = await client.from("bestseller_tasks").update(Object.assign({}, patch)).eq("id", id);
      if (error) throw new Error(error.message || "更新BESTSELLER 任务失败");
    },
    // 后台：批量更新（用于批量发布/批量绑定）
    async bulkUpdateBestsellerTasks(ids, patch) {
      if (!ids || !ids.length) return;
      const { error } = await client.from("bestseller_tasks").update(Object.assign({}, patch)).in("id", ids);
      if (error) throw new Error(error.message || "批量更新BESTSELLER 任务失败");
    },
    // 后台：软删除BESTSELLER 任务 → 移入回收站（不删图片与提交记录）
    async removeBestsellerTask(id) {
      const { error } = await client.from("bestseller_tasks").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(error.message || "移入回收站失败");
    },
    // 后台：从回收站恢复BESTSELLER 任务
    async restoreBestsellerTask(id) {
      const { error } = await client.from("bestseller_tasks").update({ deleted_at: null }).eq("id", id);
      if (error) throw new Error(error.message || "恢复BESTSELLER 任务失败");
    },
    // 后台：批量从回收站恢复
    async bulkRestoreBestsellerTasks(ids) {
      if (!ids || !ids.length) return;
      const { error } = await client.from("bestseller_tasks").update({ deleted_at: null }).in("id", ids);
      if (error) throw new Error(error.message || "批量恢复失败");
    },
    // 后台：永久删除（硬删除，连带提交记录 cascade）
    async purgeBestsellerTasks(ids) {
      if (!ids || !ids.length) return;
      const { error } = await client.from("bestseller_tasks").delete().in("id", ids);
      if (error) throw new Error(error.message || "永久删除失败");
    },
    // 后台：读取全部提交（含 user_id，供看所有用户SPU/导出）
    
    // 前台：当前用户对某任务的提交记录
    // 前台/后台：读取全部商家提交记录（用于悬浮显示与看板统计）
    async listAllBestsellerSubmissions() {
      try {
        const { data, error } = await client.from("bestseller_submissions").select("*").order("created_at", { ascending: false });
        if (!error) return (data || []).filter(d => (d.spus || []).length > 0);
      } catch (e) {}
      return [];
    },
    async myBestsellerSubmission(taskId) {
      const s = await client.auth.getSession();
      const uid = s?.data?.session?.user?.id;
      if (!uid) return null;
      const { data, error } = await client.from("bestseller_submissions").select("*").eq("bestseller_task_id", taskId).eq("user_id", uid).maybeSingle();
      if (error) return null;
      return data || null;
    },
    // 前台：当前用户保存某任务的货品SPU（upsert，一个任务一条）
    async upsertBestsellerSubmission(taskId, spus) {
      const s = await client.auth.getSession();
      const uid = s?.data?.session?.user?.id;
      if (!uid) throw new Error("未登录");
      const arr = [...new Set((spus || []).map(x => String(x).trim()).filter(Boolean))];
      const { error } = await client.from("bestseller_submissions").upsert(
        { bestseller_task_id: taskId, user_id: uid, spus: arr, updated_at: new Date().toISOString() },
        { onConflict: "bestseller_task_id,user_id" }
      );
      if (error) throw new Error(error.message || "保存SPU失败");
      return arr;
    },

    // ============ 专区类目（招品/BESTSELLER，各自独立，可增删改） ============
    // 读取某专区的全部类目（前台左栏 + 后台发布下拉共用）
    async listZoneCats(zone) {
      const tbl = zone === "bestseller" ? "bestseller_categories" : "recruit_categories";
      const { data, error } = await client.from(tbl).select("id, name, sort_order").order("sort_order").order("name");
      if (error) throw new Error(error.message || "读取类目失败");
      const list = data || [];
      // 兜底：把前台类目(categories)全部补进池子，保证「标签管理的所有类目」都显示（去重）
      const { data: all, error: aerr } = await client.from("categories").select("id, name, sort_order").order("sort_order").order("name");
      if (!aerr && all) {
        const have = new Set(list.map(c => c.name));
        all.forEach(c => { if (!have.has(c.name)) { list.push({ id: c.id, name: c.name, sort_order: c.sort_order }); have.add(c.name); } });
      }
      return list;
    },
    async addZoneCat(zone, name) {
      const n = (name || "").trim();
      if (!n) throw new Error("类目名不能为空");
      const tbl = zone === "bestseller" ? "bestseller_categories" : "recruit_categories";
      const { error } = await client.from(tbl).insert({ name: n });
      if (error && error.code !== "23505") throw new Error(error.message || "新增失败");
      // 同步写入前台类目表（幂等），保证「标签管理」与专区类目池保持一致
      try { await client.from("categories").upsert({ name: n }, { onConflict: "name" }); } catch (e) {}
    },
    async renameZoneCat(zone, id, name, oldName) {
      const n = (name || "").trim();
      if (!n) throw new Error("类目名不能为空");
      const tbl = zone === "bestseller" ? "bestseller_categories" : "recruit_categories";
      const { error } = await client.from(tbl).update({ name: n }).eq("id", id);
      if (error) throw new Error(error.message || "改名失败");
      // 同步更新任务表里已用该类目（旧名→新名）
      const taskTbl = zone === "bestseller" ? "bestseller_tasks" : "recruit_tasks";
      if (oldName && oldName !== n) {
        const { error: e2 } = await client.from(taskTbl).update({ category: n }).eq("category", oldName);
        if (e2) throw new Error(e2.message || "改名失败");
      }
    },
    async removeZoneCat(zone, id, oldName) {
      const tbl = zone === "bestseller" ? "bestseller_categories" : "recruit_categories";
      const { error } = await client.from(tbl).delete().eq("id", id);
      if (error) throw new Error(error.message || "删除失败");
      // 同步清空任务表里用了该类目的任务的类目
      const taskTbl = zone === "bestseller" ? "bestseller_tasks" : "recruit_tasks";
      if (oldName) {
        const { error: e2 } = await client.from(taskTbl).update({ category: "" }).eq("category", oldName);
        if (e2) throw new Error(e2.message || "删除失败");
      }
    },
    // 读取某专区的类目名列表（前台访问设置可见性用）
    // visual/trend 用前台类目表；recruit/bestseller 用各自专区类目表
    async listZoneCatsForVis(zone) {
      if (zone === "marketing" || zone === "notice") return [];
      if (zone === "recruit" || zone === "bestseller") {
        const list = await this.listZoneCats(zone);
        return (list || []).map(c => c.name);
      }
      // visual/trend：前台类目表（含展示顺序）
      return this.listActiveCats();
    },

    // ============ 超管权限分配（zone_permissions） ============
    // 读取某管理员被授权的类目名列表（按专区；不传 zone 则取全部专区并集）
    async listUserPermissions(userId, zone) {
      let q = client.from("zone_permissions").select("category");
      if (zone) q = q.eq("zone", zone);
      const { data, error } = await q.eq("user_id", userId);
      if (error) throw new Error(error.message || "读取权限失败");
      return [...new Set((data || []).map(d => d.category))];
    },
    // 读取当前登录用户在某专区被授权的所有类目（后台发布/上传下拉按专区精确过滤）
    async myZonePermissions(zone) {
      const s = await client.auth.getSession();
      const uid = s?.data?.session?.user?.id;
      if (!uid) return [];
      let q = client.from("zone_permissions").select("category");
      if (zone) q = q.eq("zone", zone);
      const { data, error } = await q.eq("user_id", uid);
      if (error) return [];
      return [...new Set((data || []).map(d => d.category))];
    },
    // 超管：读取所有注册用户清单（权限管理页，含访客，超管可设置任意用户角色）
    async listAdminUsers() {
      // 优先完整读取（含 frontend_zones）；若数据库尚未重跑 setup.sql（缺 frontend_zones 列）则降级重查，避免整张用户列表被清空
      let res = await client.from("profiles").select("user_id, email, role, manage_zones, frontend_zones, user_tag, user_note").order("created_at", { ascending: true });
      if (res.error && /frontend_zones/i.test(res.error.message || "")) {
        res = await client.from("profiles").select("user_id, email, role, manage_zones, user_tag, user_note").order("created_at", { ascending: true });
      }
      if (res.error) throw new Error(res.error.message || "读取用户失败");
      const rows = res.data || [];
      // 缺失 frontend_zones 时补空数组，避免前端渲染出错
      rows.forEach(r => { if (!Array.isArray(r.frontend_zones)) r.frontend_zones = []; });
      return rows;
    },
    // 超管：读取每个用户最近一次登录的设备与 IP（安全设置，后台权限分配表展示）
    async lastLoginLogs() {
      const { data, error } = await client.rpc("get_last_login_logs");
      if (error) throw new Error(error.message || "读取登录记录失败");
      return data || [];
    },
    // 超管：设置某用户标签（备注，便于区分用户类别；空串=清除）
    async setUserTag(userId, tag) {
      const { error } = await client.from("profiles").update({ user_tag: (tag || "").trim() }).eq("user_id", userId);
      if (error) throw new Error(error.message || "更新用户标签失败");
    },
    // 超管：设置某用户备注（自由文本说明，如 来源/用途/新用户名；空串=清除）
    async setUserNote(userId, note) {
      const { error } = await client.from("profiles").update({ user_note: (note || "").trim() }).eq("user_id", userId);
      if (error) throw new Error(error.message || "更新用户备注失败");
    },
    // 超管：设置某用户角色（visitor / admin / super_admin）
    async setUserRole(userId, role) {
      const { error } = await client.from("profiles").update({ role }).eq("user_id", userId);
      if (error) throw new Error(error.message || "更新角色失败");
    },
    // 超管：通过 Worker（Auth Admin API）创建用户（邮箱 + 密码），需 service_role
    async superCreateUser(email, password) {
      const token = await currentToken();
      const res = await fetch(window.CONFIG.WORKER_URL + "/admin/user/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ email, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "创建用户失败");
      return j.user;
    },
    // 超管：通过 Worker（Auth Admin API）删除用户（级联清理 profiles），需 service_role
    async superDeleteUser(userId) {
      const token = await currentToken();
      const res = await fetch(window.CONFIG.WORKER_URL + "/admin/user/delete?uid=" + encodeURIComponent(userId), {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "删除用户失败");
    },
    // 超管：读取某用户级可见专区白名单（manage_zones 数组；空/缺省 = 未配置，回退全局）
    async getUserManageZones(userId) {
      const { data, error } = await client.from("profiles").select("manage_zones").eq("user_id", userId).maybeSingle();
      if (error) throw new Error(error.message || "读取专区白名单失败");
      return (data && Array.isArray(data.manage_zones)) ? data.manage_zones : [];
    },
    // 超管：写入某用户级可见专区白名单（manage_zones 数组；传空数组 = 回退全局）
    async setUserManageZones(userId, zones) {
      const clean = [...new Set((zones || []).filter(Boolean))];
      const { error } = await client.from("profiles").update({ manage_zones: clean }).eq("user_id", userId);
      if (error) throw new Error(error.message || "更新专区白名单失败");
    },
    // 前台：读取当前登录用户的可见专区白名单（供专区守卫；null = 未配置，回退全局）
    async myManageZones() {
      const s = await client.auth.getSession();
      const uid = s?.data?.session?.user?.id;
      if (!uid) return null;
      const { data, error } = await client.from("profiles").select("manage_zones").eq("user_id", uid).maybeSingle();
      if (error) return null;
      return (data && Array.isArray(data.manage_zones)) ? data.manage_zones : null;
    },
    // 前端专区可见性（frontend_zones，与后端 manage_zones 独立）：
    // 返回当前登录用户前端可见的专区白名单；null = 未配置，按全局 frontend_zone_visibility 兜底
    async myFrontendZones() {
      const s = await client.auth.getSession();
      const uid = s?.data?.session?.user?.id;
      if (!uid) return null;
      const { data, error } = await client.from("profiles").select("frontend_zones").eq("user_id", uid).maybeSingle();
      if (error) return null;
      return (data && Array.isArray(data.frontend_zones)) ? data.frontend_zones : null;
    },
    // 超管：读取某用户前端可见专区白名单（frontend_zones）
    async getUserFrontendZones(userId) {
      const { data, error } = await client.from("profiles").select("frontend_zones").eq("user_id", userId).maybeSingle();
      if (error) throw new Error(error.message || "读取前端可见专区失败");
      return (data && Array.isArray(data.frontend_zones)) ? data.frontend_zones : [];
    },
    // 超管：写入某用户前端可见专区白名单（frontend_zones；传空数组 = 回退全局）
    async setUserFrontendZones(userId, zones) {
      const clean = [...new Set((zones || []).filter(Boolean))];
      const { error } = await client.from("profiles").update({ frontend_zones: clean }).eq("user_id", userId);
      if (error) throw new Error(error.message || "更新前端可见专区失败");
    },
    // 超管：写入某管理员在某专区的类目授权（按专区独立存储，不再跨专区共享）
    // 删除该用户该专区旧权限行后，写入指定类目
    async setUserPermissions(userId, zone, cats) {
      let q = client.from("zone_permissions").delete().eq("user_id", userId);
      if (zone) q = q.eq("zone", zone);
      const { error: de } = await q;
      if (de) throw new Error(de.message || "更新权限失败");
      if (!cats || !cats.length) return;
      const clean = [...new Set((cats || []).map(c => (c || "").trim()).filter(Boolean))];
      if (!clean.length) return;
      const rows = clean.map(c => ({ user_id: userId, zone: zone || "recruit", category: c }));
      const { error } = await client.from("zone_permissions").insert(rows);
      if (error) throw new Error(error.message || "更新权限失败");
    },

    // ============ 数据看板（访问统计 / 在线时长 / 地区分布） ============
    // 说明：只统计「已登录用户」的真实访问（游客不计），口径见 tools/setup_analytics.sql。
    // 页面打开时登记一次访问，返回该条记录 id；随后用心跳累加停留时长。
    async recordVisit(o) {
      const d = o || {};
/* 「从哪来」：优先用调用方传入，否则取浏览器来源地址。
        归一化成域名（同一来源只留一条），便于后台按来源聚合；取不到就留空，后台显示"直接进入"。 */
        var ref = d.referrer;
        if (!ref && typeof document !== "undefined") ref = document.referrer || "";
        ref = String(ref || "").trim();
        if (ref) {
          try { ref = new URL(ref).host || ref; } catch (e) { /* 不是标准地址就原样保留 */ }
          if (ref.length > 120) ref = ref.slice(0, 120);
        }
        const { data, error } = await client.rpc("record_visit", {
        p_zone: d.zone || "",
        p_path: d.path || "",
        p_ip: d.ip || "",
        p_country: d.country || "",
        p_region: d.region || "",
        p_city: d.city || "",
        p_referrer: ref,
      });
      if (error) throw new Error(error.message || "登记访问失败");
      return data;
    },
    // 累加停留时长（前端每 20 秒一次，离开页面时补最后一次）；失败静默，不影响浏览
    async visitPing(id, addSec) {
      if (!id) return;
      try {
        await client.rpc("visit_ping", { p_id: id, p_add: Math.max(0, Math.round(addSec || 0)) });
      } catch (e) { /* 统计失败不影响正常使用 */ }
    },
    // 配置自检：一眼看出"密钥是否缺失 / 是否用错项目"
    configCheck: checkConfigHealth,

    // ============ 用户动向（超管专用：前台访客 + 后台管理员） ============
    // 统一严格 RPC：失败时把原因归一化到 e.diag（missing_function / not_authenticated /
    // forbidden / sql_exec / blocked / other），界面据此给出人话提示；
    // 原始报错只进浏览器控制台，不显示到页面（也不外泄内部地址）。
    async rpcJson(name, args, label) {
      // 先做配置自检：页面没拿到可用密钥时，请求会在网关就被拒，
      // 这里直接给出人话原因，既不发出注定失败的请求，也不误报成「没有权限」。
      const cc0 = checkConfigHealth();
      if (!cc0.ok) {
        try { console.warn("[动向诊断] 配置自检未通过：", cc0.problems.join("；")); } catch (e) {}
        const e0 = new Error("页面配置未生效");
        e0.diag = "no_api_key"; e0.code = ""; e0.http = 0; e0.detail = cc0.problems.join("；");
        throw e0;
      }
      const tk = await freshAccessToken();
      if (!tk) {
        const e = new Error((label || "接口") + "：登录状态已失效");
        e.diag = "not_authenticated"; e.code = ""; e.http = 0;
        throw e;
      }
      let resp;
      try {
        resp = await client.rpc(name, args || {});
      } catch (netErr) {
        const m = String((netErr && netErr.message) || netErr || "");
        try { console.warn("[动向诊断] " + name + " 请求未抵达数据库（浏览器层被拦）：", m); } catch (x) {}
        const e = new Error((label || "接口") + "读取失败");
        e.diag = "blocked"; e.code = ""; e.http = 0; e.detail = m;
        throw e;
      }
      const { data, error, status } = resp;
      if (error) {
        const code = String(error.code || "");
        const raw = [error.message, error.details, error.hint, code].map(v => String(v || "")).join(" ");
        let diag = "other";
        // 判定顺序很关键，三条硬规则：
        //   ① 「没有执行授权」必须只看权限类信号（错误码 42501 / permission denied / forbidden / 403），
        //      不能把「aggregate functions are not allowed in GROUP BY」里的 not allowed 当成权限问题，
        //      否则统计脚本自身写错时会把用户引向去改权限（2026-10-16 真实故障的教训）。
        //   ② 42xxx（除 42501 权限码）＝函数内那段 SQL 自己写错了，与账号权限无关。
        //   ③ 「函数不存在」优先按缺函数处理，不落到「没有权限」。
        if (code === "PGRST202" || code === "42883") diag = "missing_function";
        else if (code === "PGRST301" || code === "PGRST302") diag = "not_authenticated";
        else if (/no api key|api key|apikey/i.test(raw)) diag = "no_api_key";
        else if (code === "42501" || /permission denied|forbidden|\b403\b/i.test(raw)) diag = "forbidden";
        else if (/^42[0-9]{3}$/.test(code) || /not allowed|grouping error|syntax error at|invalid input syntax/i.test(raw)) diag = "sql_exec";
        else if (/could not find the function|does not exist|schema cache/i.test(raw)) diag = "missing_function";
        else if (/not authenticated|invalid token|PGRST301|\b401\b/i.test(raw)) diag = "not_authenticated";
        const e = new Error((label || "接口") + "读取失败");
        e.diag = diag; e.code = code; e.http = status || 0; e.detail = raw;
        // 关键：把数据库返回的原文一起打出来。42703（字段不存在）这类错误，
        // 只有原文才指出是哪个字段，否则只能看到「读取失败」，无法定位。
        try {
          console.warn("[动向诊断] " + name + " 失败：diag=" + diag + " code=" + (code || "(无)") + " http=" + (status || "?"));
          if (raw) console.warn("[动向诊断] 数据库原文：" + String(raw).slice(0, 400));
          if (code === "42703") {
            console.warn("[动向诊断] 这是「字段不存在」：线上某张表缺少脚本需要的字段（早期建的旧表不会自动补字段）。" +
              "请把 tools/setup_analytics.sql 整段重跑一次 —— 其中第 5.5 段会自动补齐缺失字段（幂等、不动数据）；" +
              "跑完看自检③的「缺失字段」列是否全为「（无，已齐备）」。");
          }
        } catch (x) {}
        throw e;
      }
      return data;
    },
    async insightFront(days) { return this.rpcJson("insight_front", { p_days: Number(days) || 30 }, "用户动向"); },
    async insightAdmin(days) { return this.rpcJson("insight_admin", { p_days: Number(days) || 30 }, "管理员动向"); },
    // 菜单点击等行为上报：静默失败，绝不影响浏览（统计不到也不能挡住用户）
    async trackEvent(ev, zone, menu, path) {
      try {
        const tk = await freshAccessToken();
        if (!tk) return null;
        const { data, error } = await client.rpc("track_event", {
          p_event: ev || "menu", p_zone: zone || "", p_menu: menu || "", p_path: path || "",
        });
        if (error) return null;
        return data;
      } catch (e) { return null; }
    },
    // 后台操作日志：同样静默失败（日志不该挡住业务动作）
    async logAdminAction(action, target, detail) {
      try {
        const tk = await freshAccessToken();
        if (!tk) return null;
        const { data, error } = await client.rpc("log_admin_action", {
          p_action: action || "", p_target: target || "", p_detail: detail || {},
        });
        if (error) return null;
        return data;
      } catch (e) { return null; }
    },

    // ============ 版本恢复（超管专用：数据快照 / 一键回滚） ============
    async backupCreate(note) { return this.rpcJson("backup_create", { p_note: String(note || ""), p_kind: "manual" }, "生成快照"); },
    async backupList() { const d = await this.rpcJson("backup_list", {}, "快照列表"); return Array.isArray(d) ? d : []; },
    async backupGet(id) { return this.rpcJson("backup_get", { p_id: Number(id) }, "读取快照"); },
    async backupDelete(id) { return this.rpcJson("backup_delete", { p_id: Number(id) }, "删除快照"); },
    async backupRestore(id) { return this.rpcJson("backup_restore", { p_id: Number(id) }, "恢复快照"); },
    backupPolicy() { return { max: 10 }; },

    // 一键连通性自检：一次点清「配置 → 登录态 → 最小读写 → 动向接口」四层里到底哪一层断了。
    // 目的：不需要用户翻开发者工具，页面自己给出结论。
    async connProbe() {
      const out = { config: null, session: false, minimal: null, dashboard: null, verdict: "" };
      try { out.config = checkConfigHealth(); } catch (e) { out.config = { ok: false, problems: ["配置自检异常"] }; }
      try { const s = await client.auth.getSession(); out.session = !!(s && s.data && s.data.session); } catch (e) { out.session = false; }
      // 最小调用：只读一行自己的档案（任何登录用户都允许，不需要特殊权限或统计接口）
      try {
        const r = await client.from("profiles").select("role").limit(1);
        if (r && r.error) out.minimal = { ok: false, code: String(r.error.code || ""), http: r.status || 0, msg: String(r.error.message || "") };
        else out.minimal = { ok: true, http: (r && r.status) || 200 };
      } catch (e) { out.minimal = { ok: false, code: "", http: 0, msg: String((e && e.message) || e) }; }
      // 动向统计接口（超管专用；非超管会走到 forbidden 分支）
      try {
        const d = await this.insightAdmin(7);
        // 「empty」判断口径：接口本身可用，但还没有任何动向记录。
        // 注意不能只看返回对象是否非空 —— 没记录时接口同样会正常返回结构，
        // 若只看结构就会把「还没人来过」误报成「已正常」，用户会以为好了却还是空的。
        const noRec = !d || (Number(d.actions_total || 0) === 0 && Number(d.uploads_total || 0) === 0);
        out.dashboard = { ok: true, empty: noRec };
      }
      catch (e) { out.dashboard = { ok: false, diag: (e && e.diag) || "other", code: (e && e.code) || "", http: (e && e.http) || 0, detail: (e && e.detail) || "" }; }
      // 给出人话结论（逐层判断，先断的层先报）
      const c = out.config || {}, m = out.minimal || {}, d = out.dashboard || {};
      if (!c.ok) out.verdict = "配置未生效：页面没拿到可用的访问密钥（与账号权限无关）。";
      else if (!out.session) out.verdict = "登录态未就绪：请先登录（或重新登录）后再试。";
      else if (m.ok === false && !m.http) out.verdict = "请求没能抵达数据库（浏览器层被拦：预检/CORS/网络），与账号权限无关。";
      else if (m.ok === false) out.verdict = "数据库网关拒绝了请求（密钥或授权问题），返回码 " + (m.code || "无") + "。";
      else if (d.ok) out.verdict = d.empty ? "接口连通，但还没有动向记录：让用户登录前台打开一次专区、后台做一次操作，再回来看。" : "接口连通且有数据，用户动向应能正常显示。";
      // 函数内部 SQL 自身报错（42xxx）：与账号权限无关，必须重跑统计脚本
      else if (d.diag === "sql_exec" && String(d.code) === "42703") out.verdict = "统计接口引用的字段在线上表里不存在（错误码 42703，与账号权限无关）：线上表比脚本旧，缺字段。请把 tools/setup_analytics.sql 整段重跑一次（第 5.5 段会自动补齐缺失字段、幂等、不动数据），跑完看自检③的「缺失字段」列应为「（无，已齐备）」。数据库原文：" + String(d.detail || "").slice(0, 200);
      else if (d.diag === "sql_exec") out.verdict = "数据库执行统计接口时报错（错误码 " + (d.code || "无") + "）：统计脚本内部那段查询写错了，请把仓库里 tools/setup_analytics.sql 整段重新执行一次（与账号权限无关）。数据库原文：" + String(d.detail || "").slice(0, 200);
      else if (d.diag === "forbidden") out.verdict = "登录用户没有统计接口的执行授权：请重跑 tools/setup_analytics.sql（其中含授权语句）。";
      else if (d.diag === "missing_function") out.verdict = "数据库里还没有统计接口（或接口缓存未刷新）：请先执行 tools/setup_analytics.sql。";
      else if (d.diag === "blocked") out.verdict = "仅动向接口这一层失败：请求被浏览器/网络层拦下（与账号权限无关），请强刷页面、关闭代理或拦截插件后再试。";
      else if (d.diag === "not_authenticated") out.verdict = "登录状态已失效：请重新登录后再试。";
      else if (d.diag === "no_api_key") out.verdict = "页面未携带访问密钥：请核对配置里的地址与密钥（与账号权限无关）。";
      else out.verdict = "仅动向接口这一层失败，其余读写都正常：返回码 " + (d.code || "无") + "（" + d.diag + "），请把此行连同返回码反馈。";
      try { console.info("[动向诊断] 连通性自检：", out.verdict, out); } catch (e) {}
      return out;
    },
    // 访问地区：由服务端按真实网络出口解析（拿不到则返回 null，看板显示「未知」）
    // 地区/出口信息：由图片服务按真实网络出口解析。
    // ⚠️ 必须带超时：访问统计要等这一步完成后才写库，若此处卡住（网络不通/被拦截），
    // 整条上报就永远发不出去，后台看板会一条数据都没有。超时后按"未知地区"继续上报。
    async geoInfo() {
      try {
        const base = ((window.CONFIG && window.CONFIG.WORKER_URL) || "").replace(/\/+$/, "");
        if (!base) return null;
        const ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
        let tid = null;
        if (ctl) tid = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 2500);
        let res;
        try {
          res = await fetch(base + "/geo", { method: "GET", signal: ctl ? ctl.signal : undefined });
        } finally { if (tid) clearTimeout(tid); }
        if (!res.ok) return null;
        const j = await res.json().catch(() => null);
        if (!j) return null;
        return { ip: j.ip || "", country: j.country || "", region: j.region || "", city: j.city || "" };
      } catch (e) { return null; }
    },

    // ============ 批量维护用户（多选后批量打标签 / 改角色 / 加减专区） ============
    // opts: { tag, role, addFront:[], remFront:[], addManage:[], remManage:[], seedFront:[] }
    //  - 标签 / 角色：直接整批写入
    //  - 专区：先一次性取回这批用户现有配置，在本地做并集/差集，再逐个写回（保持各用户原配置不被覆盖）
    //  - seedFront：某用户前台可见专区为空（=跟随全局）却要「移除」时，用全局可见专区作为起点，否则移除无效果
    // 返回 { updated, failed }
    async bulkPatchUsers(ids, opts) {
      const list = [...new Set((ids || []).filter(Boolean))];
      if (!list.length) return { updated: 0, failed: 0 };
      const o = opts || {};
      const addFront = (o.addFront || []).filter(Boolean);
      const remFront = (o.remFront || []).filter(Boolean);
      const addManage = (o.addManage || []).filter(Boolean);
      const remManage = (o.remManage || []).filter(Boolean);
      const seedFront = (o.seedFront || []).filter(Boolean);
      const hasTag = Object.prototype.hasOwnProperty.call(o, "tag") && o.tag !== undefined;
      const hasRole = !!o.role;
      const needZones = addFront.length || remFront.length || addManage.length || remManage.length;
      const zoneMap = {};
      if (needZones) {
        const { data, error } = await client.from("profiles")
          .select("user_id, frontend_zones, manage_zones").in("user_id", list);
        if (error) throw new Error(error.message || "读取用户专区配置失败");
        (data || []).forEach(r => { zoneMap[r.user_id] = r; });
      }
      const merge = (cur, add, rem, seed) => {
        let base = (Array.isArray(cur) ? cur : []).filter(Boolean);
        if (!base.length && rem.length && seed.length) base = seed.slice();
        const set = new Set(base);
        add.forEach(z => set.add(z));
        rem.forEach(z => set.delete(z));
        return [...set];
      };
      let updated = 0, failed = 0;
      const CHUNK = 8;
      for (let i = 0; i < list.length; i += CHUNK) {
        const part = list.slice(i, i + CHUNK);
        await Promise.all(part.map(async (uid) => {
          const patch = {};
          if (hasTag) patch.user_tag = String(o.tag == null ? "" : o.tag).trim();
          if (hasRole) patch.role = o.role;
          if (needZones) {
            const cur = zoneMap[uid] || {};
            if (addFront.length || remFront.length) {
              patch.frontend_zones = merge(cur.frontend_zones, addFront, remFront, seedFront);
            }
            if (addManage.length || remManage.length) {
              patch.manage_zones = merge(cur.manage_zones, addManage, remManage, []);
            }
          }
          if (!Object.keys(patch).length) return;
          const { error } = await client.from("profiles").update(patch).eq("user_id", uid);
          if (error) failed++; else updated++;
        }));
      }
      return { updated, failed };
    },

    // ============ 趋势上升榜（rank_sites / rank_batches / rank_items） ============
    // 前台筛选三份清单：国家站点 / 周次 / 类目（服务端聚合，避免拉全表明细）
    async rankFacets() {
      const { data, error } = await client.rpc("rank_facets");
      if (error) throw new Error(error.message || "读取筛选清单失败");
      const o = (Array.isArray(data) ? data[0] : data) || {};
      return { sites: o.sites || [], periods: o.periods || [], categories: o.categories || [] };
    },
    // 国家站点清单（后台自定义维护）
    async listRankSites() {
      const { data, error } = await client.from("rank_sites").select("id, name, sort_order").order("sort_order").order("name");
      if (error) throw new Error(error.message || "读取站点失败");
      return data || [];
    },
    async addRankSite(name) {
      const n = (name || "").trim();
      if (!n) throw new Error("站点名不能为空");
      const { error } = await client.from("rank_sites").insert({ name: n });
      if (error) {
        if (error.code === "23505") throw new Error("该站点已存在");
        throw new Error(error.message || "新增站点失败");
      }
    },
    async removeRankSite(name) {
      const { error } = await client.from("rank_sites").delete().eq("name", name);
      if (error) throw new Error(error.message || "删除站点失败");
    },
    async updateRankSiteById(id, patch) {
      const { error } = await client.from("rank_sites").update(patch || {}).eq("id", id);
      if (error) throw new Error(error.message || "更新站点失败");
    },
    // 地区分组：把多个国家站点并成一个地区（如「欧洲」= 英国 / 德国 / 法国…）
    // 存放于 site_settings.frontend_dims.rank_groups = [{ name, members:[站点名…] }]，随现有配置列一起读写，无需改表结构。
    async getRankGroups() {
      const { data, error } = await client
        .from("site_settings").select("frontend_dims").eq("id", 1).maybeSingle();
      if (error || !data || !data.frontend_dims) return [];
      const raw = data.frontend_dims.rank_groups;
      if (!Array.isArray(raw)) return [];
      return raw.map((g) => ({
        name: String((g && g.name) || "").trim(),
        members: (Array.isArray(g && g.members) ? g.members : []).map((m) => String(m || "").trim()).filter(Boolean),
      })).filter((g) => g.name);
    },
    async setRankGroups(list) {
      const clean = (Array.isArray(list) ? list : []).map((g) => ({
        name: String((g && g.name) || "").trim(),
        members: (Array.isArray(g && g.members) ? g.members : []).map((m) => String(m || "").trim()).filter(Boolean),
      })).filter((g) => g.name);
      const { data, error } = await client
        .from("site_settings").select("frontend_dims").eq("id", 1).maybeSingle();
      if (error) throw new Error(error.message || "读取配置失败");
      const cur = Object.assign({}, (data && data.frontend_dims) || {});
      cur.rank_groups = clean;   // 只改 rank_groups 这一个键，其余配置（各维度开关）原样保留
      const up = await client
        .from("site_settings").update({ frontend_dims: cur, updated_at: new Date().toISOString() }).eq("id", 1);
      if (up.error) throw new Error(up.error.message || "保存地区分组失败");
      return clean;
    },
    // 站点改名：把 rank_items / rank_batches 里的旧站点名一并迁移（表无 update 策略 → 删除后重插）
    // 站点改名：迁移 rank_items 与 rank_batches（先复制成功、再删除原数据；任一步失败即回滚，绝不先删）
    async renameRankSiteData(oldName, newName) {
      const from = String(oldName || "").trim(), to = String(newName || "").trim();
      if (!to || to === from) return 0;
      // 目标站点若已有数据，拒绝静默合并（否则会因去重跳过 + 删除原数据而丢数据）
      const exist = await this._countRankItems({ site: to });
      if (exist > 0) throw new Error("站点「" + to + "」已存在 " + exist + " 条数据，为避免覆盖丢失，未执行改名。请换一个名称，或先删除该站点的数据。");
      let moved = 0;
      for (let round = 0; round < 100; round++) {
        const rows = await this.listRankItems({ sites: [from], limit: 500 });
        if (!rows.length) break;
        const news = rows.map((r) => { const o = Object.assign({}, r, { site: to }); delete o.id; delete o.created_at; return o; });
        // 严格插入（不做去重合并）：插入失败或数量不符即回滚，原数据保持不动
        const ids = await this._insertRankItemsStrict(news);
        if (ids.length !== news.length) {
          if (ids.length) await this.deleteRankItemsByIds(ids);
          throw new Error("改名中止：新数据未完整写入（预期 " + news.length + " 条，实际 " + ids.length + " 条），原数据已保留。");
        }
        await this.deleteRankItemsByIds(rows.map((r) => r.id));
        moved += rows.length;
        if (rows.length < 500) break;
      }
      if (moved) this._lastSiteRenameCount = moved;
      try {
        const { data } = await client.from("rank_batches").select("id, period_type, period_label, category, site, rows, skipped").eq("site", from);
        for (const b of (data || [])) {
          const { error: ie } = await client.from("rank_batches").insert({ period_type: b.period_type, period_label: b.period_label, category: b.category, site: to, rows: b.rows, skipped: b.skipped });
          if (ie) throw new Error(ie.message || "批次写入失败");
          await client.from("rank_batches").delete().eq("id", b.id);
        }
      } catch (e) { /* 批次仅作展示，失败忽略 */ }
      return moved;
    },
    // 期次改名 / 周度·月度切换：迁移 rank_items 与 rank_batches
    // 安全原则：先复制且校验成功，再删除原数据；任何异常都不会造成"改名=丢数据"
    async updateRankPeriodData(oldLabel, oldType, newLabel, newType) {
      const from = String(oldLabel || "").trim(), to = String(newLabel || "").trim();
      const nt = newType || oldType || "week";
      if (!to) throw new Error("期次名称不能为空。");
      if (to === from && nt === (oldType || nt)) return 0;   // 无变化，直接返回，不做任何写操作
      // 目标期次若已有数据，拒绝静默合并（会因去重跳过 + 删原数据而丢数据）
      const exist = await this._countRankItems({ periods: [to], periodType: nt });
      if (exist > 0) throw new Error("目标期次「" + to + "」（" + (nt === "month" ? "月度" : "周度") + "）已存在 " + exist + " 条数据，为避免覆盖丢失，未执行改名。请换一个名称，或先删除该期次。");
      let moved = 0;
      for (let round = 0; round < 100; round++) {
        let q = client.from("rank_items").select("*").eq("period_label", from).limit(500);
        if (oldType) q = q.eq("period_type", oldType);
        const { data: rows, error } = await q;
        if (error) throw new Error(error.message || "读取榜单条目失败");
        if (!rows || !rows.length) break;
        const news = rows.map((r) => { const o = Object.assign({}, r, { period_label: to, period_type: nt }); delete o.id; delete o.created_at; return o; });
        const ids = await this._insertRankItemsStrict(news);
        if (ids.length !== news.length) {
          if (ids.length) await this.deleteRankItemsByIds(ids);
          throw new Error("改名中止：新数据未完整写入（预期 " + news.length + " 条，实际 " + ids.length + " 条），原数据已保留。");
        }
        await this.deleteRankItemsByIds(rows.map((r) => r.id));
        moved += rows.length;
        if (rows.length < 500) break;
      }
      try {
        let bq = client.from("rank_batches").select("id, period_type, period_label, category, site, rows, skipped").eq("period_label", from);
        if (oldType) bq = bq.eq("period_type", oldType);
        const { data } = await bq;
        for (const b of (data || [])) {
          const { error: ie } = await client.from("rank_batches").insert({ period_type: nt, period_label: to, category: b.category, site: b.site, rows: b.rows, skipped: b.skipped });
          if (ie) throw new Error(ie.message || "批次写入失败");
          await client.from("rank_batches").delete().eq("id", b.id);
        }
      } catch (e) { /* 批次仅作展示，失败忽略 */ }
      this._lastPeriodRename = { moved: moved, from: from, to: to };
      return moved;
    },
    // 统计条数（用于改名前的目标占用检查）
    async _countRankItems(opt) {
      try {
        let q = client.from("rank_items").select("id", { count: "exact", head: true });
        if (opt.site) q = q.eq("site", opt.site);
        const ps = opt.periods || [];
        if (ps.length === 1) q = q.eq("period_label", ps[0]);
        else if (ps.length > 1) q = q.in("period_label", ps);
        if (opt.periodType) q = q.eq("period_type", opt.periodType);
        const { count, error } = await q;
        if (error) return 0;
        return count || 0;
      } catch (e) { return 0; }
    },
    // 严格插入：不做 upsert 去重合并，插入失败直接抛错（用于改名迁移，确保"成功才删原数据"）
    async _insertRankItemsStrict(rows) {
      const list = (rows || []).filter(Boolean);
      const ids = [];
      for (let i = 0; i < list.length; i += 200) {
        const chunk = list.slice(i, i + 200);
        const { data, error } = await client.from("rank_items").insert(chunk).select("id");
        if (error) throw new Error(error.message || "写入榜单数据失败");
        (data || []).forEach((d) => ids.push(d.id));
      }
      return ids;
    },
    // 删除整个期次（其下所有榜单条目与上传批次一并删除）
    async deleteRankPeriod(oldLabel, oldType) {
      let removed = 0;
      for (let round = 0; round < 100; round++) {
        const rows = await this.listRankItems({ periods: [oldLabel], periodType: oldType || undefined, limit: 500 });
        if (!rows.length) break;
        await this.deleteRankItemsByIds(rows.map((r) => r.id));
        removed += rows.length;
        if (rows.length < 500) break;
      }
      let q = client.from("rank_batches").select("id").eq("period_label", oldLabel);
      if (oldType) q = q.eq("period_type", oldType);
      const { data, error } = await q;
      if (error) throw new Error(error.message || "读取批次失败");
      for (const b of (data || [])) await this.deleteRankBatch(b.id);
      this._lastPeriodDelete = { items: removed, batches: (data || []).length };
      return this._lastPeriodDelete;
    },
    async createRankBatch(b) {
      const payload = {
        period_type: b.periodType || "week",
        period_label: b.periodLabel || "",
        category: b.category || "",
        site: b.site || "",
      };
      const { data, error } = await client.from("rank_batches").insert(payload).select("id").single();
      if (error) throw new Error(error.message || "创建上传批次失败");
      return data && data.id;
    },
    // 批量写入榜单条目（重复的自动跳过：同一 类目+站点+期次+首图url 只留一条）
    // 导入写入：普通插入（不再让数据库层按「期次+类目+站点+图片」去重）。
    //
    // 旧实现用 upsert + ignoreDuplicates，结果是：只要库里已有同样的（类目, 站点, 期次, 图片网址），
    // 这一行就被静默丢掉、而且算作「重复跳过」。用户重传同一张表 / 上传与以往有重叠的表时，
    // 就会出现「预览显示有效行 200、导入却只进去一部分甚至 0 条」，且没有任何明确提示。
    //
    // 去重改由导入流程在客户端显式完成：
    //   覆盖模式 → 先清空该期次·该类目·该站点下的旧数据，再整表写入（不与以往上传查重）
    //   追加模式 → 先剔除库里已存在的图，只补新的
    // 因此这里写入多少条是确定的，不会再出现静默吞行。
    async insertRankItems(rows) {
      const list = (rows || []).filter(Boolean);
      if (!list.length) return { inserted: 0 };
      let inserted = 0;
      for (let i = 0; i < list.length; i += 300) {
        const chunk = list.slice(i, i + 300);
        const { data, error } = await client.from("rank_items").insert(chunk).select("id");
        if (!error) { inserted += (data || []).length; continue; }
        const code = String((error && (error.code != null ? error.code : "")) || "");
        // 库里若还留着旧版唯一约束（同站点/期次/类目下同一张图算重复），
        // 直接插入会整批被拒；此时改成「覆盖写入」——同键的旧行被新数据更新，不新增重复。
        // 否则会出现「有效行 200，却一条也进不去」或「只进去一部分」。
        if (code === "23505") {
          const { data: d2, error: e2 } = await client
            .from("rank_items")
            .upsert(chunk, { onConflict: "category,site,period_type,period_label,image_url", ignoreDuplicates: false })
            .select("id");
          if (e2) throw new Error(e2.message || "写入榜单数据失败");
          inserted += (d2 || []).length;
          continue;
        }
        throw new Error(error.message || "写入榜单数据失败");
      }
      return { inserted };
    },
    // 覆盖导入用：清空「期次类型 + 期次 + 类目 + 站点」这个槽位下的旧榜单条目与上传记录。
    // 只清目标站点，不碰其它站点（例如先传欧盟、再传美国，互不影响）。
    async clearRankSlot(o) {
      const periodType = (o && o.periodType) || "week";
      const periodLabel = (o && o.periodLabel) || "";
      const category = (o && o.category) || "";
      const sites = ((o && o.sites) || []).filter(v => v != null && String(v).trim() !== "");
      let items = 0;
      for (let round = 0; round < 400; round++) {
        let q = client.from("rank_items").select("id")
          .eq("period_type", periodType).eq("period_label", periodLabel).eq("category", category);
        if (sites.length) q = q.in("site", sites);
        const { data, error } = await q.limit(500);
        if (error) throw new Error(error.message || "读取旧榜单数据失败");
        const rows = data || [];
        if (!rows.length) break;
        await this.deleteRankItemsByIds(rows.map(r => r.id));
        items += rows.length;
        if (rows.length < 500) break;
      }
      // 上传记录（批次）仅作展示用途；只有「该批次的站点完全被本次覆盖」时才一并删除
      let batches = 0;
      try {
        const { data } = await client.from("rank_batches").select("id, site")
          .eq("period_type", periodType).eq("period_label", periodLabel).eq("category", category);
        for (const b of (data || [])) {
          const bs = String(b.site || "").split(",").map(s => s.trim()).filter(Boolean);
          const covered = bs.length && bs.every(s => sites.indexOf(s) >= 0);
          if (covered) { await this.deleteRankBatch(b.id); batches++; }
        }
      } catch (e) { /* 批次仅作展示，失败忽略 */ }
      return { items: items, batches: batches };
    },
    // 追加导入用：取出该槽位里已有的图片网址（翻页取全，避免被单次上限截断）
    async listRankSlotUrls(o) {
      const periodType = (o && o.periodType) || "week";
      const periodLabel = (o && o.periodLabel) || "";
      const category = (o && o.category) || "";
      const sites = ((o && o.sites) || []).filter(v => v != null && String(v).trim() !== "");
      const urls = [];
      for (let page = 0; page < 100; page++) {
        let q = client.from("rank_items").select("image_url")
          .eq("period_type", periodType).eq("period_label", periodLabel).eq("category", category)
          .order("id", { ascending: true })
          .range(page * 1000, page * 1000 + 999);
        if (sites.length) q = q.in("site", sites);
        const { data, error } = await q;
        if (error) throw new Error(error.message || "读取已有榜单图失败");
        const rows = data || [];
        rows.forEach(r => { if (r.image_url) urls.push(r.image_url); });
        if (rows.length < 1000) break;
      }
      return urls;
    },
    // 按槽位精确计数（后台「上传记录」显示条数用）
    //
    // ⚠️ 计数必须交给数据库做，不能「一次性把全表拉回来自己在浏览器里数」：
    //    接口单次返回是有上限的，表一大就被截断，于是「上传记录」显示的条数会凭空变少
    //    （几个/几十个），而前台按槽位分次查却是完整的 —— 两边就对不上了。
    //    这里用 head 计数（数据库只回条数、不回行），既不受单次上限影响，也不浪费流量。
    // 返回：条数；若服务端没回数字（异常/不支持）→ 返回 null，由调用方决定退回展示口径。
    async countRankSlot(o) {
      const periodType = (o && o.periodType) || "week";
      const periodLabel = (o && o.periodLabel) || "";
      const category = (o && o.category) || "";
      const sites = ((o && o.sites) || []).filter(v => v != null && String(v).trim() !== "");
      try {
        let q = client.from("rank_items").select("id", { count: "exact", head: true })
          .eq("period_type", periodType);
        if (periodLabel) q = q.eq("period_label", periodLabel);
        if (category) q = q.eq("category", category);
        if (sites.length) q = q.in("site", sites);
        const res = await q;
        if (res && res.error) return null;
        return (res && typeof res.count === "number") ? res.count : null;
      } catch (e) { return null; }
    },
    async updateRankBatch(id, patch) {
      const { error } = await client.from("rank_batches").update(patch || {}).eq("id", id);
      if (error) throw new Error(error.message || "更新批次失败");
    },
    // 批次列表（后台管理）
    async listRankBatches() {
      const { data, error } = await client.from("rank_batches")
        .select("id, period_type, period_label, category, site, rows, skipped, created_at")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message || "读取上传记录失败");
      return data || [];
    },
    // 删除批次（其下条目级联删除）
    async deleteRankBatch(id) {
      const { error } = await client.from("rank_batches").delete().eq("id", id);
      if (error) throw new Error(error.message || "删除失败");
    },
    async deleteRankItemsByIds(ids) {
      const list = (ids || []).filter(v => v != null);
      if (!list.length) return;
      for (let i = 0; i < list.length; i += 200) {
        const { error } = await client.from("rank_items").delete().in("id", list.slice(i, i + 200));
        if (error) throw new Error(error.message || "删除失败");
      }
    },
    // 榜单条目查询（前台对比 / 后台核对）
    // filter: { category, sites:[], periods:[], periodType }
    async listRankItems(filter) {
      const f = filter || {};
      /* 服务端单次查询会被截断在 1000 行（与这里写多少 limit 无关，是接口层的上限）。
         类目对比要同时取「4 个类目 × 2 周」的图，行数轻松超过 1000，
         一旦被截断就会表现为「勾了 4 个类目，下面只有 1 列有图」——
         被截掉的是哪几个类目取决于数据库返回顺序，看起来像是那几个类目没上传。
         这里改成分页取全量：按 id 升序翻页，取到不满一页为止。 */
      const PAGE = 1000, MAX = 20000;
      const wanted = f.limit || 0;
      const build = (from, to) => {
        /* cols：只需要 URL 做比对时不要拉全量字段（每条记录几十个字段，上万行就是几 MB） */
        let q = client.from("rank_items").select(f.cols || "*");
        if (f.category) q = q.eq("category", f.category);
        else if (f.categories && f.categories.length) q = q.in("category", f.categories);
        if (f.periodType) q = q.eq("period_type", f.periodType);
        if (f.periods && f.periods.length) q = q.in("period_label", f.periods);
        if (f.sites && f.sites.length) q = q.in("site", f.sites);
        return q.order("id", { ascending: true }).range(from, to);
      };
      const out = [];
      for (let from = 0; from < MAX; from += PAGE) {
        const to = Math.min(from + PAGE, MAX) - 1;
        const { data, error } = await build(from, to);
        if (error) throw new Error(error.message || "读取榜单数据失败");
        const rows = data || [];
        for (const r of rows) out.push(r);
        if (rows.length < PAGE) break;                  /* 已取完 */
        if (wanted && out.length >= wanted) break;      /* 调用方只要前 N 条 */
      }
      return wanted ? out.slice(0, wanted) : out;
    },

    /* 按图片地址批量取「打标维度」：周对比分析报告要用它们做维度差异统计。
       只取分析需要的几列；表里没有的列不会出现在返回行里（报告会按"未打标"处理）。
       分片查询：地址列表可能上千条，一次性 in() 会超出请求长度。 */
        async listImageTags(urls) {
      const list = [...new Set((Array.isArray(urls) ? urls : []).map((u) => String(u || "").trim()).filter(Boolean))];
      const out = {};
      if (!list.length) return out;
      /* 列名要点：图库的外链列叫 url（setup.sql: alter table images add column url text），
         并没有 image_url 列。早期这里按 image_url 查询 → Postgres 直接报「列不存在」→
         整条查询抛错 → 六维永远为空（而且看起来像"没人打标"）。
         现在先按 url 查，失败再回退 image_url，兼容手工加过该列的老库。 */
      const FIELDS = ["category", "style_tags", "element_tags", "scene_tags", "shoot_tags", "skin_tags"];
      const readBy = async (col, cols) => {
        const res = {};
        for (let i = 0; i < list.length; i += 80) {
          const part = list.slice(i, i + 80);
          const { data, error } = await client.from("images").select(cols).in(col, part);
          if (error) return null;
          (data || []).forEach((r) => { res[r[col]] = r; });
        }
        return res;
      };
      const full = FIELDS.join(",");
      let got = await readBy("url", "url," + full);
      if (!got) got = await readBy("image_url", "image_url," + full);
      if (!got) {
        /* 连视觉维度列都没有（很老的库）：退化为只取类目，至少能出类目结构一页，不让整份报告失败 */
        let cat = await readBy("url", "url,category");
        if (!cat) cat = await readBy("image_url", "image_url,category");
        if (!cat) throw new Error("读取图片标签失败");
        Object.assign(out, cat);
        return out;
      }
      Object.assign(out, got);
      return out;
    },

    /* ============================================================
     * 趋势上升榜 · 榜单图独立打标（历史上的独立标签表；后台入口已于 20261026Q 下线，数据保留）
     * ------------------------------------------------------------
     * 为什么单独存：
     *   1) 榜单图只存在于 rank_items（外链地址），图库 images 里没有这些记录；
     *   2) 把几千张榜单外链图塞进图库，会污染「图片管理」列表与数据看板；
     *   3) images 的写策略绑死了「视觉专区 + 类目授权 + 只能改自己上传的」，
     *      与榜单打标的权限口径不同，硬写会出现「图能看、标存不进去」。
     * 所以标签单独放 rank_image_tags（image_url 唯一），与「图片管理 → 智能打标」
     * 完全独立、互不影响；周报按地址把两张表的结果合并（榜单表优先）。
     * ============================================================ */
    async rankTagReady() {
      const { error } = await client.from("rank_image_tags").select("image_url", { head: true, count: "exact" }).limit(1);
      return !error;
    },
    /* 探测打标表的可选维度列是否存在。
       用途：节日/文化/心理这些列是分批补丁加的，某个补丁没执行时，
       读取会静默降级、页面只是"少一栏"，用户完全看不出原因。
       后台一进来就问一次，缺列直接写在界面上，不用再靠猜。 */
    async probeRankTagCols() {
      const probe = async (col) => {
        try {
          const { error } = await client.from("rank_image_tags").select(col).limit(1);
          return !error;
        } catch (e) { return false; }
      };
      const [festival, culture, psych] = await Promise.all([
        probe("festival_tags"), probe("culture_tags"), probe("psych_tags"),
      ]);
      return { festival, culture, psych };
    },
    /* 打标数据体检：直接问库——每个维度到底有多少行真的有值。
       用途：界面"打了标却看不到"时，先分清是【没打进去】还是【读不出来】。
       读不出来是补丁/列的问题，没打进去是导入的问题，两者处置完全不同。 */
    async statRankTagDims() {
      const dims = [
        ["风格", "style_tags"], ["视觉", "visual_tags"], ["图案元素", "element_tags"],
        ["二次工艺", "craft_tags"], ["拍摄方式", "shoot_tags"], ["版型", "fit_tags"],
        ["文化背景", "culture_tags"], ["消费心理", "psych_tags"], ["节日", "festival_tags"],
      ];
      let cols = dims.map((d) => d[1]);
      let data = null, error = null;
      for (let i = 0; i < 3; i++) {
        const r = await client.from("rank_image_tags").select(cols.join(",")).limit(50000);
        data = r.data; error = r.error;
        if (!error) break;
        /* 某列不存在时整条查询会失败：退一列重试，并记下缺哪列 */
        const msg = String(error.message || error.details || "");
        const hit = dims.filter((d) => msg.indexOf(d[1]) >= 0).map((d) => d[1]);
        if (!hit.length) break;
        cols = cols.filter((c) => hit.indexOf(c) < 0);
        dims.filter((d) => hit.indexOf(d[1]) >= 0).forEach((d) => { d[2] = "missing"; });
      }
      if (error) throw new Error(error.message || "读取打标表失败");
      const rows = data || [];
      const stat = {};
      dims.forEach((d) => {
        const col = d[1];
        if (d[2] === "missing") { stat[d[0]] = { col, missing: true, n: 0 }; return; }
        let n = 0;
        rows.forEach((r) => {
          const v = r[col];
          if (Array.isArray(v) ? v.length : !!v) n++;
        });
        stat[d[0]] = { col, missing: false, n };
      });
      return { total: rows.length, stat };
    },
    async listRankTagRows(urls) {
      const list = [...new Set((Array.isArray(urls) ? urls : []).map((u) => String(u || "").trim()).filter(Boolean))];
      const out = {};
      if (!list.length) return out;

      /* 列清单分三级降级：
         全量列若因为「补丁没跑、列还不存在」而报错，整个查询会失败，
         前台就会一张标签都读不出来（看起来像"完全没打标"）。
         所以按 全量 → 去掉节日 → 只留基础列 逐级退，保证有多少显示多少。 */
      const C_FULL = "image_url,category,style_tags,element_tags,scene_tags,shoot_tags,skin_tags,tags,visual_tags,craft_tags,fit_tags,culture_tags,psych_tags,festival_tags,batch_id,updated_at";
      const C_NEW2 = "image_url,category,style_tags,element_tags,scene_tags,shoot_tags,skin_tags,tags,visual_tags,craft_tags,fit_tags,culture_tags,psych_tags,batch_id,updated_at";
      const C_BASE = "image_url,category,style_tags,element_tags,scene_tags,shoot_tags,skin_tags,tags,visual_tags,craft_tags,fit_tags,batch_id,updated_at";
      const LADDER = [C_FULL, C_NEW2, C_BASE];
      let lv = this.__rankTagLevel;
      if (typeof lv !== "number" || lv < 0 || lv > 2) lv = 0;

      const fetchPart = async (part, cols) => {
        const r = await client.from("rank_image_tags").select(cols).in("image_url", part);
        return r;
      };

      /* 导入时命中几千上万行要发上百个请求，串行等会非常慢。
         改成 4 路并发（批量仍按 60 条，避免 URL 过长被网关截断）。 */
      const BATCH = 60, CONC = 4;
      const chunks = [];
      for (let i = 0; i < list.length; i += BATCH) chunks.push(list.slice(i, i + BATCH));
      for (let i = 0; i < chunks.length; i += CONC) {
        const group = chunks.slice(i, i + CONC);
        const settled = await Promise.all(group.map(async (part) => {
          let myLv = lv;
          let res = await fetchPart(part, LADDER[myLv]);
          while (res.error && myLv < LADDER.length - 1) {
            myLv++;
            res = await fetchPart(part, LADDER[myLv]);
          }
          return { res, myLv };
        }));
        for (const one of settled) {
          if (one.res.error) throw new Error(one.res.error.message || "读取榜单标签失败");
          lv = Math.max(lv, one.myLv);
          (one.res.data || []).forEach((r) => {
            /* 降级丢掉的新列补成空数组，调用方不用到处判 undefined */
            if (!r.culture_tags) r.culture_tags = [];
            if (!r.psych_tags) r.psych_tags = [];
            if (!r.festival_tags) r.festival_tags = [];
            out[r.image_url] = r;
          });
        }
      }
      this.__rankTagLevel = lv;
      return out;
    },
    async saveRankTagRows(rows) {
      const list = (rows || []).filter((r) => r && r.image_url);
      if (!list.length) return 0;
      const now = new Date().toISOString();
      let n = 0;
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100).map((r) => ({
          image_url: r.image_url,
          category: r.category || "",
          style_tags: r.style_tags || [],
          element_tags: r.element_tags || [],
          scene_tags: r.scene_tags || [],
          shoot_tags: r.shoot_tags || [],
          culture_tags: r.culture_tags || [],
          psych_tags: r.psych_tags || [],
          festival_tags: r.festival_tags || [],
          skin_tags: r.skin_tags || [],
          tags: r.tags || [],
          visual_tags: r.visual_tags || [],
          craft_tags: r.craft_tags || [],
          fit_tags: r.fit_tags || [],
          batch_id: r.batch_id || null,
          updated_by: r.updated_by || null,
          updated_at: now,
        }));
        const { error } = await client.from("rank_image_tags")
          .upsert(chunk, { onConflict: "image_url", ignoreDuplicates: false });
        if (error) throw new Error(error.message || "保存榜单标签失败");
        n += chunk.length;
      }
      return n;
    },
    /* 按批次回滚：只清空该批次写过的行，不碰其它批次与人工单独改的行（batch_id 为空的保持原样） */
    async clearRankTagBatch(batchId) {
      const b = String(batchId || "").trim();
      if (!b) return 0;
      /* 20261027R：清空清单必须带上看/文化/心理/节日，否则「回滚本批」之后
         这几列的值会留在库里变成孤儿数据——导出时看不见、前台却在显示。 */
      const empty = { category: "", style_tags: [], element_tags: [], scene_tags: [], shoot_tags: [], skin_tags: [], visual_tags: [], craft_tags: [], fit_tags: [], culture_tags: [], psych_tags: [], festival_tags: [], batch_id: null, updated_at: new Date().toISOString() };
      const { error } = await client.from("rank_image_tags").update(empty).eq("batch_id", b);
      if (error) throw new Error(error.message || "回滚失败");
      return true;
    },

    /* ============================================================
     * 打标批次台账 + 改动历史（20261027J）
     * ------------------------------------------------------------
     * 为什么要有这两张表：
     *   以前只知道"这张图是哪个批次写的"，所以只能整批清空。
     *   清空不是撤回 —— 某张图若在前一批已打过标、后一批又覆盖过，
     *   清掉后一批会把它变成空标签，前一批的标也跟着没了。
     *   现在每改一个字段就记一条 before/after，撤回时按 before 写回，
     *   且只回滚「当前值仍等于当时写入值」的字段，后来人工改过的不动。
     * ============================================================ */
    async listRankTagBatches(limit) {
      const { data, error } = await client.from("rank_tag_batches")
        .select("batch_id,file_name,mode,scope,image_count,changed_count,field_count,skipped_count,unmatched_count,unknown_tags,status,note,created_at,reverted_at")
        .order("created_at", { ascending: false })
        .limit(limit || 60);
      if (error) throw new Error(error.message || "读取打标批次失败");
      return data || [];
    },
    async saveRankTagBatch(meta) {
      const m = meta || {};
      if (!m.batch_id) return false;
      const row = {
        batch_id: m.batch_id,
        file_name: m.file_name || "",
        mode: m.mode || "fill",
        scope: m.scope || "",
        image_count: m.image_count || 0,
        changed_count: m.changed_count || 0,
        field_count: m.field_count || 0,
        skipped_count: m.skipped_count || 0,
        unmatched_count: m.unmatched_count || 0,
        unknown_tags: Array.isArray(m.unknown_tags) ? m.unknown_tags.slice(0, 200) : [],
        status: m.status || "applied",
        note: m.note || "",
        created_by: m.created_by || null,
      };
      const { error } = await client.from("rank_tag_batches").upsert([row], { onConflict: "batch_id" });
      if (error) throw new Error(error.message || "写入打标批次失败");
      return true;
    },
    async updateRankTagBatch(batchId, patch) {
      const b = String(batchId || "").trim();
      if (!b) return false;
      const { error } = await client.from("rank_tag_batches").update(patch || {}).eq("batch_id", b);
      if (error) throw new Error(error.message || "更新打标批次失败");
      return true;
    },
    /* 历史明细：一次导入可能上千条，分批写 */
    async saveRankTagHistory(rows) {
      const list = (rows || []).filter((r) => r && r.batch_id && r.image_url && r.field);
      if (!list.length) return 0;
      let n = 0;
      for (let i = 0; i < list.length; i += 200) {
        const chunk = list.slice(i, i + 200).map((r) => ({
          batch_id: r.batch_id,
          image_url: r.image_url,
          field: r.field,
          before_tags: Array.isArray(r.before_tags) ? r.before_tags : [],
          after_tags: Array.isArray(r.after_tags) ? r.after_tags : [],
        }));
        const { error } = await client.from("rank_tag_history").insert(chunk);
        if (error) throw new Error(error.message || "写入打标历史失败");
        n += chunk.length;
      }
      return n;
    },
    async listRankTagHistory(batchId) {
      const b = String(batchId || "").trim();
      if (!b) return [];
      const PAGE = 1000, MAX = 50000, out = [];
      for (let from = 0; from < MAX; from += PAGE) {
        const to = Math.min(from + PAGE, MAX) - 1;
        const { data, error } = await client.from("rank_tag_history")
          .select("image_url,field,before_tags,after_tags")
          .eq("batch_id", b).order("id", { ascending: true }).range(from, to);
        if (error) throw new Error(error.message || "读取打标历史失败");
        const rows = data || [];
        rows.forEach((r) => out.push(r));
        if (rows.length < PAGE) break;
      }
      return out;
    },
    /* 打标队列：榜单图（按地址去重），带出期次/站点/类目/叶子类目/位次
       filter: { category, period, site, limit } —— 不传即全部 */
    async listRankTagQueue(filter) {
      const f = filter || {};
      let q = client.from("rank_items").select("id,period_type,period_label,category,site,leaf_category,image_url,rank_ratio,rank_abs");
      if (f.category) q = q.eq("category", f.category);
      if (f.period) q = q.eq("period_label", f.period);
      if (f.site) q = q.eq("site", f.site);
      const { data, error } = await q.order("rank_ratio", { ascending: true }).limit(f.limit || 3000);
      if (error) throw new Error(error.message || "读取榜单图失败");
      const map = new Map();
      (data || []).forEach((r) => {
        const u = String(r.image_url || "").trim();
        if (!u) return;
        const hit = map.get(u);
        if (hit) { hit.periods.push(r.period_label); return; }
        map.set(u, {
          image_url: u,
          category: r.category || "",
          leaf_category: r.leaf_category || "",
          site: r.site || "",
          period_label: r.period_label || "",
          periods: [r.period_label || ""],
          rank_ratio: r.rank_ratio,
          rank_abs: r.rank_abs,
        });
      });
      return [...map.values()];
    },
    /* 周对比报告专用：图库标签 + 榜单独立标签合并。
       规则：逐维度取"有值的那一边"，榜单表优先（它才是本面板打的标）；
       两边都有时用榜单表的，避免同一张图在两处被打成不同标签时口径打架。 */
    async listImageTagsForReport(urls) {
      const list = Array.isArray(urls) ? urls : [];
      let base = {};
      try { base = await this.listImageTags(list); } catch (e) { base = {}; }
      let rank = {};
      try { rank = await this.listRankTagRows(list); } catch (e) { rank = {}; }
      const out = Object.assign({}, base);
      Object.keys(rank).forEach((u) => {
        const r = rank[u] || {};
        const b = base[u] || {};
        const pick = (k) => {
          const rv = r[k];
          if (Array.isArray(rv) ? rv.length : !!rv) return rv;
          return b[k] !== undefined ? b[k] : (Array.isArray(rv) ? [] : "");
        };
        out[u] = {
          image_url: u,
          category: (r.category || b.category || ""),
          style_tags: pick("style_tags"),
          element_tags: pick("element_tags"),
          scene_tags: pick("scene_tags"),
          shoot_tags: pick("shoot_tags"),
          skin_tags: pick("skin_tags"),
          /* 20261027K 起榜单打标新增的三列：合并时以前一直被丢掉，
             导致前台/周报看到的「视觉 / 二次工艺 / 版型」永远是空。 */
          visual_tags: pick("visual_tags"),
          craft_tags: pick("craft_tags"),
          fit_tags: pick("fit_tags"),
          /* 20261027T 补：这三列在合并时被漏掉，导致前台左栏的
             「文化背景 / 消费心理 / 节日」永远是空的（数据在库里却读不出来）。 */
          culture_tags: pick("culture_tags"),
          psych_tags: pick("psych_tags"),
          festival_tags: pick("festival_tags"),
        };
      });
      return out;
    },

    // ============ 前台显隐（哪些国家站点 / 周次在前台展示，由后台控制） ============
    // 存于 site_settings.frontend_dims.rank_hidden = { sites:[名…], periods:[期次…] }，随现有配置列读写，无需改表结构。
    async getRankHidden() {
      const clean = (a) => (Array.isArray(a) ? a : []).map((x) => String(x || "").trim()).filter(Boolean);
      const { data, error } = await client.from("site_settings").select("frontend_dims").eq("id", 1).maybeSingle();
      if (error || !data || !data.frontend_dims) return { sites: [], periods: [] };
      const raw = data.frontend_dims.rank_hidden || {};
      return { sites: clean(raw.sites), periods: clean(raw.periods) };
    },
    async setRankHidden(patch) {
      const cur = await this.getRankHidden();
      const p = patch || {};
      const uniq = (a) => [...new Set((Array.isArray(a) ? a : []).map((x) => String(x || "").trim()).filter(Boolean))];
      const next = {
        sites: uniq(p.sites === undefined ? cur.sites : p.sites),
        periods: uniq(p.periods === undefined ? cur.periods : p.periods),
      };
      const { data, error } = await client.from("site_settings").select("frontend_dims").eq("id", 1).maybeSingle();
      if (error) throw new Error(error.message || "读取配置失败");
      const dims = Object.assign({}, (data && data.frontend_dims) || {});
      dims.rank_hidden = next;    // 只改这一个键，其余配置（维度开关 / 地区分组）原样保留
      const up = await client
        .from("site_settings").update({ frontend_dims: dims, updated_at: new Date().toISOString() }).eq("id", 1);
      if (up.error) throw new Error(up.error.message || "保存显隐设置失败");
      return next;
    },

    // 前台类目「已删除清单」：内置候选清单（config.js 写死）会把删掉的类目又带回来，
    // 用这份清单把被删的名字压住，才能真正删掉。
    async getCatRemoved() {
      const { data, error } = await client.from("site_settings").select("frontend_dims").eq("id", 1).maybeSingle();
      if (error || !data || !data.frontend_dims) return [];
      const raw = data.frontend_dims.cat_removed;
      return [...new Set((Array.isArray(raw) ? raw : []).map((x) => String(x || "").trim()).filter(Boolean))];
    },
    async setCatRemoved(list) {
      const clean = [...new Set((Array.isArray(list) ? list : []).map((x) => String(x || "").trim()).filter(Boolean))];
      const { data, error } = await client.from("site_settings").select("frontend_dims").eq("id", 1).maybeSingle();
      if (error) throw new Error(error.message || "读取配置失败");
      const dims = Object.assign({}, (data && data.frontend_dims) || {});
      dims.cat_removed = clean;
      const up = await client
        .from("site_settings").update({ frontend_dims: dims, updated_at: new Date().toISOString() }).eq("id", 1);
      if (up.error) throw new Error(up.error.message || "保存类目删除记录失败");
      return clean;
    },

    // ============ 标签 / 类目的「彻底删除」（连带清掉所有图片上的该标签） ============
    // 旧写法是「拉全表 → 逐张更新 → 再删标签定义」：图一多就慢，且任意一张失败就整批中止，
    // 标签定义也永远不会被删掉（表现为"标签删不掉"）。现在：
    //   1) 优先调用数据库函数，一条 SQL 完成（快）；
    //   2) 函数还没在库里建好时，自动退化为「只取仍带该标签的图」分批清理，单条失败不中断。
    async removeTagFromImages(type, tagName) {
      const FIELD_FOR_DEF = { style: "style_tags", element: "element_tags", scene: "scene_tags", shoot: "shoot_tags", skin: "skin_tags", channel: "tags" };
      const field = FIELD_FOR_DEF[type];
      if (!field) throw new Error("不支持的标签类型");
      const name = String(tagName || "").trim();
      if (!name) return 0;
      try {
        const { data, error } = await client.rpc("remove_tag_from_images", { p_field: field, p_tag: name });
        if (!error) { this._lastBulkFailed = 0; return Number(data) || 0; }
      } catch (e) { /* 函数不存在 → 走下面的兜底 */ }
      return await this._clearFieldValue(field, name);
    },
    async clearCategoryOnImages(name) {
      const v = String(name || "").trim();
      if (!v) return 0;
      try {
        const { data, error } = await client.rpc("clear_image_category", { p_name: v });
        if (!error) { this._lastBulkFailed = 0; return Number(data) || 0; }
      } catch (e) { /* 函数不存在 → 走下面的兜底 */ }
      return await this._clearFieldValue("category", v);
    },
    // 兜底清理：每轮只取「仍然带有该标签」的图片，逐条更新。
    // 三层制动，避免在图多 / 权限受限时拖垮页面：
    //   ① 单条失败只记数不中断（一张卡住不影响其余）；
    //   ② 某轮一次都没成功 → 停（不会反复重试同一批）；
    //   ③ 待处理数量没变少（服务端"成功"但实际没改，例如被策略层静默拦下）→ 停。
    async _clearFieldValue(field, value) {
      const PAGE = 200;
      const isSingle = (field === "category");   // 类目是单值字段，必须走单值写入（走数组写入会写进一个空数组）
      const NAME = { category: "category", tags: "tags", style_tags: "style_tags", element_tags: "element_tags", scene_tags: "scene_tags", shoot_tags: "shoot_tags", skin_tags: "skin_tags" };
      const col = NAME[field] || field;
      let ok = 0, lastLeft = Infinity;
      const failedIds = new Set();               // 按"张"去重：同一张图被重试两次只算一次，提示里的数字才不会虚高
      for (let round = 0; round < 200; round++) {
        let q = client.from("images").select("*");
        q = isSingle ? q.eq(col, value) : q.contains(col, [value]);
        const { data, error } = await q.limit(PAGE);
        if (error) throw new Error(error.message || "读取待清理图片失败");
        const rows = data || [];
        if (!rows.length) break;
        if (rows.length >= lastLeft) break;        // 数量没减少 → 再跑也白跑
        lastLeft = rows.length;
        let roundOk = 0;
        for (const img of rows) {
          try {
            if (isSingle) await this.setImageSingleField(img.id, col, "");
            else await this.updateImageField(img.id, col, (Array.isArray(img[col]) ? img[col] : []).filter((t) => t !== value));
            ok++; roundOk++;
          } catch (e) { failedIds.add(img.id); }
        }
        if (!roundOk) break;
      }
      this._lastBulkFailed = failedIds.size;
      return ok;
    },

    /* ---------- 收藏错误的统一翻译 ----------
     * 建表脚本没执行、或执行了但接口缓存没刷新，接口会返回 404 /
     * "Could not find the table ... in the schema cache"。
     * 这类原始报错对使用者毫无意义，统一翻译成「该执行哪个脚本」。 */
    _favIsMissingTable(err) {
      // 状态码有的在 code、有的在 status（Supabase 两种都出现过），都要看
      const s = String((err && (err.message || err.details || err.hint)) || "")
        + " " + String((err && err.code) || "")
        + " " + String((err && err.status) || "");
      return /PGRST20[0-9]|schema cache|does not exist|relation .* does not exist|\b404\b|not found/i.test(s);
    },
    favErrMsg(err) {
      if (this._favIsMissingTable(err)) {
        return "收藏表还没建好：请在数据库执行一次 tools/patch_20261021R.sql（执行完会刷新接口缓存），然后刷新本页。";
      }
      const raw = (err && (err.message || err.details)) || "";
      const s = raw + " " + String((err && err.code) || "");
      if (/JWT|token|not authenticated|permission denied|42501|\b401\b|\b403\b/i.test(s)) {
        return "登录状态已失效，请重新登录后再试。";
      }
      if (/duplicate|unique/i.test(s)) return "已经有同名分类了，换个名字";
      return raw || "操作失败，请稍后重试";
    },
    /* 诊断：给「重新检测」按钮用。返回缺表原因，便于页面给出准确指引。 */
    async favDiag() {
      try {
        const { error } = await client.from("fav_items").select("id", { head: true, count: "exact" }).limit(1);
        if (!error) return { ok: true, missing: false, msg: "" };
        const missing = this._favIsMissingTable(error);
        return { ok: false, missing: missing, msg: this.favErrMsg(error) };
      } catch (e) {
        return { ok: false, missing: false, msg: this.favErrMsg(e) };
      }
    },
    /* ============================================================
     * 我的收藏（前台专区）
     *  - 每人一套分类、一套收藏，全部按登录用户隔离
     *  - 收藏条目存快照：榜单换期 / 旧批次被清理后，收藏里的图仍可看
     *  - 同一张图出现在不同期次 → 各存一条（不是按图去重）
     * ============================================================ */
    async favReady() {
      const d = await this.favDiag();
      return !!d.ok;
    },
    async favUid() {
      try {
        const { data: s } = await client.auth.getSession();
        return (s && s.session && s.session.user && s.session.user.id) || null;
      } catch (e) { return null; }
    },
    async listFavCategories() {
      const uid = await this.favUid();
      if (!uid) return [];
      const { data, error } = await client.from("fav_categories")
        .select("id,name,color,sort,created_at")
        .eq("user_id", uid)
        .order("sort", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw new Error(this.favErrMsg(error) || "读取收藏分类失败");
      return data || [];
    },
    async createFavCategory(name, color) {
      const uid = await this.favUid();
      if (!uid) throw new Error("请先登录后再建分类");
      const n = String(name == null ? "" : name).trim();
      if (!n) throw new Error("分类名称不能为空");
      if (n.length > 40) throw new Error("分类名称最多 40 个字");
      const { data, error } = await client.from("fav_categories")
        .insert({ user_id: uid, name: n, color: String(color || ""), sort: 0 })
        .select("id,name,color,sort")
        .single();
      if (error) {
        // 唯一键冲突 = 同名分类已存在，给出人话提示而不是原始的约束报错
        if (/duplicate|unique/i.test(error.message || "")) throw new Error("已经有同名分类了，换个名字");
        throw new Error(this.favErrMsg(error) || "新建分类失败");
      }
      return data;
    },
    async updateFavCategory(id, patch) {
      const uid = await this.favUid();
      if (!uid) throw new Error("请先登录");
      const body = {};
      if (patch && patch.name != null) {
        const n = String(patch.name).trim();
        if (!n) throw new Error("分类名称不能为空");
        body.name = n;
      }
      if (patch && patch.color != null) body.color = String(patch.color);
      if (patch && patch.sort != null) body.sort = Number(patch.sort) || 0;
      if (!Object.keys(body).length) return true;
      const { error } = await client.from("fav_categories").update(body).eq("id", id).eq("user_id", uid);
      if (error) {
        if (/duplicate|unique/i.test(error.message || "")) throw new Error("已经有同名分类了，换个名字");
        throw new Error(this.favErrMsg(error) || "修改分类失败");
      }
      return true;
    },
    /* 删除分类：先把里面的条目退回「未分类」，再删分类 —— 图不会跟着消失 */
    async deleteFavCategory(id) {
      const uid = await this.favUid();
      if (!uid) throw new Error("请先登录");
      const { error: e1 } = await client.from("fav_items").update({ category_id: null }).eq("user_id", uid).eq("category_id", id);
      if (e1) throw new Error(this.favErrMsg(e1) || "把图退回未分类失败，分类未删除");
      const { error: e2 } = await client.from("fav_categories").delete().eq("id", id).eq("user_id", uid);
      if (e2) throw new Error(this.favErrMsg(e2) || "删除分类失败");
      return true;
    },
    /* tags 列在不在（patch_20261021Y 才有）。
       不在时 addFavItems 会降级成"能收藏但丢标签"，所以必须能被探测到并提示。 */
    async favTagsReady() {
      if (this.__favTagsReady !== undefined) return this.__favTagsReady;
      try {
        const { error } = await client.from("fav_items").select("tags", { head: true, count: "exact" }).limit(1);
        this.__favTagsReady = !error;
      } catch (e) {
        this.__favTagsReady = false;
      }
      return this.__favTagsReady;
    },

    async listFavItems(opt) {
      const uid = await this.favUid();
      if (!uid) return [];
      const o = opt || {};
      /* 三级降级的列清单：sub_cat（上装/下装）与 tags/rank_pos 都是后加补丁，
         任何一列不存在都不该让整页读不出收藏，所以按富到简依次尝试。 */
      const BASE_NOSUB = "id,category_id,image_url,title,leaf_category,rank_category,site,period_type,period_label,ratio,rank_abs,created_at";
      const BASE = BASE_NOSUB + ",sub_cat";
      const WITH_TAGS = BASE + ",tags,rank_pos";
      const WITH_TAGS_NOSUB = BASE_NOSUB + ",tags,rank_pos";
      const ATTEMPTS = [WITH_TAGS, BASE, WITH_TAGS_NOSUB, BASE_NOSUB];
      const run = (cols) => {
        let q = client.from("fav_items").select(cols).eq("user_id", uid);
        if (o.period) q = q.eq("period_label", o.period);
        if (o.categoryId != null && o.categoryId !== "") q = q.eq("category_id", o.categoryId);
        return q
          .order("period_label", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(o.limit || 5000);
      };
      let data = null, error = null, i = 0;
      for (; i < ATTEMPTS.length; i++) {
        const r = await run(ATTEMPTS[i]);
        data = r.data; error = r.error;
        if (!error) break;
        /* 只有"列不存在"才降级；权限/网络问题必须原样抛出，别悄悄吞掉 */
        if (!/column .*(tags|rank_pos|sub_cat)/i.test(String(error.message || "") + String(error.details || ""))) break;
      }
      if (error) throw new Error(this.favErrMsg(error) || "读取收藏失败");
      return data || [];
    },

    /* 首次使用自动建好五个默认大类；已有分类时不动（避免把用户删掉的分类又塞回来）。
       返回最新的分类列表。 */
    async ensureDefaultFavCats(names) {
      const uid = await this.favUid();
      if (!uid) return [];
      const want = (names && names.length) ? names.slice() : ["印花", "面料", "图案", "工艺", "视觉"];
      const { data: exist, error: e1 } = await client.from("fav_categories")
        .select("id,name,color,sort,created_at").eq("user_id", uid)
        .order("sort", { ascending: true }).order("id", { ascending: true });
      if (e1) throw new Error(this.favErrMsg(e1) || "读取收藏分类失败");
      const list = exist || [];
      if (list.length) return list;
      const COLORS = ["#8b7355", "#c25e5a", "#4a9c6d", "#5b7c9d", "#b08a4f"];
      const rows = want.map((n, i) => ({
        user_id: uid, name: n, color: COLORS[i % COLORS.length], sort: i * 10,
      }));
      const { error: e2 } = await client.from("fav_categories").insert(rows);
      if (e2) throw new Error(this.favErrMsg(e2) || "创建默认分类失败");
      const { data: after } = await client.from("fav_categories")
        .select("id,name,color,sort,created_at").eq("user_id", uid)
        .order("sort", { ascending: true }).order("id", { ascending: true });
      return after || [];
    },

    /* 补齐五个默认大类：只补当前分类里缺的名字，不删不改已有分类 */
    async topUpDefaultFavCats(names) {
      const uid = await this.favUid();
      if (!uid) return [];
      const want = (names && names.length) ? names.slice() : ["印花", "面料", "图案", "工艺", "视觉"];
      const cur = await this.listFavCategories();
      const have = {};
      (cur || []).forEach((c) => { have[String(c.name || "").trim()] = 1; });
      const miss = want.filter((n) => !have[n]);
      if (!miss.length) return cur;
      const COLORS = ["#8b7355", "#c25e5a", "#4a9c6d", "#5b7c9d", "#b08a4f"];
      const base = (cur || []).length;
      const rows = miss.map((n, i) => ({
        user_id: uid, name: n, color: COLORS[(base + i) % COLORS.length], sort: (base + i) * 10,
      }));
      const { error } = await client.from("fav_categories").insert(rows);
      if (error) throw new Error(this.favErrMsg(error) || "补齐默认分类失败");
      return await this.listFavCategories();
    },
    /* 收藏（可批量）：同一用户 + 同一期 + 同一图 只保留一条；跨期各一条 */
    async addFavItems(rows, categoryId) {
      const uid = await this.favUid();
      if (!uid) throw new Error("请先登录后再收藏");
      const cid = (categoryId == null || categoryId === "") ? null : categoryId;
      const list = (rows || []).filter((r) => r && String(r.image_url || "").trim());
      if (!list.length) return 0;
      const now = new Date().toISOString();
      const payload = list.map((r) => ({
        user_id: uid,
        category_id: cid,
        image_url: String(r.image_url).trim(),
        title: String(r.title || ""),
        leaf_category: String(r.leaf_category || ""),
        rank_category: String(r.rank_category || ""),
        site: String(r.site || ""),
        period_type: String(r.period_type || "week"),
        period_label: String(r.period_label || ""),
        ratio: (r.ratio == null || r.ratio === "") ? null : Number(r.ratio),
        rank_abs: (r.rank_abs == null || r.rank_abs === "") ? null : Number(r.rank_abs),
        tags: Array.isArray(r.tags) ? r.tags.filter((x) => String(x || "").trim()).map((x) => String(x).trim()) : [],
        rank_pos: (r.rank_abs == null || r.rank_abs === "") ? null : Number(r.rank_abs),
        created_at: now,
      }));
      let n = 0;
      for (let i = 0; i < payload.length; i += 100) {
        const chunk = payload.slice(i, i + 100);
        // 已存在则更新快照与分类（用户重新收藏同一张图时，视为"移动到这个分类"）
        let { error } = await client.from("fav_items")
          .upsert(chunk, { onConflict: "user_id,period_label,image_url", ignoreDuplicates: false });
        /* 老库还没执行 patch_20261021Y（缺 tags / rank_pos 列）→ 去掉这两列重试，
           保证"能不能存标签"不影响"能不能收藏"。 */
        if (error && /column .*(tags|rank_pos)|'(tags|rank_pos)'/i.test(String(error.message || "") + " " + String(error.details || ""))) {
          const slim = chunk.map((it) => {
            const o = Object.assign({}, it);
            delete o.tags; delete o.rank_pos;
            return o;
          });
          const r2 = await client.from("fav_items")
            .upsert(slim, { onConflict: "user_id,period_label,image_url", ignoreDuplicates: false });
          error = r2.error;
        }
        if (error) throw new Error(this.favErrMsg(error) || "收藏失败");
        n += chunk.length;
      }
      return n;
    },
    async removeFavItems(ids) {
      const uid = await this.favUid();
      if (!uid) throw new Error("请先登录");
      const list = (ids || []).map((x) => Number(x)).filter((x) => x > 0);
      if (!list.length) return 0;
      const { error } = await client.from("fav_items").delete().eq("user_id", uid).in("id", list);
      if (error) throw new Error(this.favErrMsg(error) || "取消收藏失败");
      return list.length;
    },
    /* 改分类：categoryId 传 null 即退回「未分类」 */
    async moveFavItems(ids, categoryId) {
      const uid = await this.favUid();
      if (!uid) throw new Error("请先登录");
      const list = (ids || []).map((x) => Number(x)).filter((x) => x > 0);
      if (!list.length) return 0;
      const cid = (categoryId == null || categoryId === "") ? null : Number(categoryId);
      const { error } = await client.from("fav_items").update({ category_id: cid }).eq("user_id", uid).in("id", list);
      if (error) throw new Error(this.favErrMsg(error) || "移动失败");
      return list.length;
    },
    /* 二分类：sub 传 "top" / "bottom" / null（未分）。
       与分类（category_id）互不影响——分类是"哪一类"，sub 是"上装还是下装"。 */
    async setFavSubCat(ids, sub) {
      const uid = await this.favUid();
      if (!uid) throw new Error("请先登录");
      const list = (ids || []).map((x) => Number(x)).filter((x) => x > 0);
      if (!list.length) return 0;
      const v = (sub === "top" || sub === "bottom") ? sub : null;
      const { error } = await client.from("fav_items").update({ sub_cat: v }).eq("user_id", uid).in("id", list);
      if (error) {
        const m = String(error.message || "") + String(error.details || "");
        if (/column .*sub_cat/i.test(m)) throw new Error("二分类功能还没启用：请在数据库执行一次 tools/patch_20261023I.sql");
        throw new Error(this.favErrMsg(error) || "设置上装/下装失败");
      }
      return list.length;
    },
    /* 榜单星标状态：返回已收藏的「期次 + 图地址」清单，前端据此点亮星标 */
    async listFavKeys() {
      const uid = await this.favUid();
      if (!uid) return [];
      const { data, error } = await client.from("fav_items")
        .select("id,period_label,image_url").eq("user_id", uid).limit(5000);
      if (error) return [];   // 星标是装饰性状态，读不到不该让榜单白屏
      return data || [];
    },
    /* 只读出口：供同级模块（大码专区数据层 plus-sb.js）复用同一个已登录客户端。
       不新建第二个 createClient —— 两个客户端各自维护会话，会出现"一边登录一边未登录"。 */
    _client() { return client; },
  };
})();

// 经典脚本里的 const 不会自动挂到 window 上；显式暴露，供其它模块的 `window.SB` 守卫使用。
try { window.SB = SB; } catch (e) {}
