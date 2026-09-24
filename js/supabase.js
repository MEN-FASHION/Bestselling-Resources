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

  // 取当前登录令牌（强制刷新会话后再取，确保拿到新鲜 token，避免手机端存有已过期访问令牌）
  async function currentToken() {
    // 仅在会话里没有有效访问令牌时才刷新会话；每次取 token 都 refreshSession 会持续触发
    // onAuthStateChange 的 TOKEN_REFRESHED 事件，被 onAuth 回调重复 enterPanel/loadManage，造成图片列表反复重绘闪跳。
    try {
      const s = await client.auth.getSession();
      if (s?.data?.session?.access_token) return s.data.session.access_token;
    } catch (e) { /* 忽略读取失败 */ }
    try {
      await client.auth.refreshSession();
    } catch (e) { /* 无刷新 token 或刷新失败时忽略 */ }
    try {
      const s = await client.auth.getSession();
      return s?.data?.session?.access_token || "";
    } catch (e) {
      return "";
    }
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
    // 暴露当前登录令牌
    async currentToken() {
      // 仅在无有效令牌时才刷新会话；每次调用都 refreshSession 会触发 onAuthStateChange 的
      // TOKEN_REFRESHED 事件，进而被 onAuth 回调重复 enterPanel/loadManage，造成图片列表反复重绘闪跳。
      let token = "";
      try {
        const s = await client.auth.getSession();
        token = (s && s.data && s.data.session && s.data.session.access_token) || "";
      } catch (e) { /* 忽略读取失败 */ }
      if (!token) {
        try { await client.auth.refreshSession(); } catch (e) { /* 忽略刷新失败 */ }
        const s2 = await client.auth.getSession();
        token = (s2 && s2.data && s2.data.session && s2.data.session.access_token) || "";
      }
      return token || "";
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
      if (error || !data) return "visitor";
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

    // ============ 常用类目（当前用户 profiles.favorite_categories） ============
    async myFavCats() {
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
      const session = await this.getSession();
      if (!session) throw new Error("未登录");
      const list = [...new Set((arr || []).map(x => (x || "").trim()).filter(Boolean))];
      const { error } = await client
        .from("profiles")
        .update({ favorite_categories: list })
        .eq("user_id", session.user.id);
      if (error) throw new Error(error.message || "保存失败");
      return list;
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
    async getFrontendZoneVisibility() {
      const { data, error } = await client
        .from("site_settings").select("frontend_zone_visibility").eq("id", 1).maybeSingle();
      if (error || !data || !data.frontend_zone_visibility) return {};
      return data.frontend_zone_visibility;
    },
    // zone: visual / trend / recruit / bestseller；visible=false 表示前台隐藏整个专区入口
    async setFrontendZoneVisibility(zone, visible) {
      const cur = await this.getFrontendZoneVisibility();
      cur[zone] = !!visible;
      const { error } = await client
        .from("site_settings").update({ frontend_zone_visibility: cur, updated_at: new Date().toISOString() }).eq("id", 1);
      if (error) throw new Error(error.message || "保存失败");
    },

    // ============ 新用户默认权限设置（超管） ============
    // 读取新用户默认权限：{ role, zones }
    // zones 为数组；空数组 = 新用户未配置用户级专区，前台按全局 frontend_zone_visibility 显示
    async getDefaultPerms() {
      const { data, error } = await client
        .from("site_settings").select("default_role, default_manage_zones").eq("id", 1).maybeSingle();
      if (error || !data) return { role: "visitor", zones: [] };
      const zones = Array.isArray(data.default_manage_zones) ? data.default_manage_zones : [];
      return { role: data.default_role || "visitor", zones };
    },
    // 写入新用户默认权限（role: visitor/admin/super_admin；zones 数组，空数组 = 按全局显示）
    async setDefaultPerms(role, zones) {
      const cleanRole = ["visitor", "admin", "super_admin"].includes(role) ? role : "visitor";
      const cleanZones = [...new Set((zones || []).filter(Boolean))];
      const { error } = await client
        .from("site_settings").update({ default_role: cleanRole, default_manage_zones: cleanZones, updated_at: new Date().toISOString() }).eq("id", 1);
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
    async addMarketingNode({ title, date, sort_order, image, url, description }) {
      const { error } = await client.from("marketing_nodes").insert({
        title, date: date || "", sort_order: sort_order || 0,
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
    // 读取某管理员被授权的类目名列表（跨专区共享同一套，不区分 zone）
    async listUserPermissions(userId, zone) {
      const { data, error } = await client.from("zone_permissions").select("category").eq("user_id", userId);
      if (error) throw new Error(error.message || "读取权限失败");
      return [...new Set((data || []).map(d => d.category))];
    },
    // 读取当前登录用户被授权的所有类目（四专区共用同一套，后台发布/上传下拉过滤用）
    async myZonePermissions(zone) {
      const s = await client.auth.getSession();
      const uid = s?.data?.session?.user?.id;
      if (!uid) return [];
      const { data, error } = await client.from("zone_permissions").select("category").eq("user_id", uid);
      if (error) return [];
      return [...new Set((data || []).map(d => d.category))];
    },
    // 超管：读取所有注册用户清单（权限管理页，含访客，超管可设置任意用户角色）
    async listAdminUsers() {
      const { data, error } = await client.from("profiles").select("user_id, email, role, manage_zones, user_tag, user_note").order("created_at", { ascending: true });
      if (error) throw new Error(error.message || "读取用户失败");
      return data || [];
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
    // 超管：写入某管理员的类目授权（一套共享，跨专区共用）。zone 参数仅为兼容保留，
    // 实际把类目同时写入 recruit/bestseller 两个 zone，保证四个专区读取都能命中同一套。
    async setUserPermissions(userId, zone, cats) {
      // 先删该用户旧的全部权限行（不限 zone），再整体覆盖写入
      const { error: de } = await client.from("zone_permissions").delete().eq("user_id", userId);
      if (de) throw new Error(de.message || "更新权限失败");
      if (!cats || !cats.length) return;
      const clean = [...new Set((cats || []).map(c => (c || "").trim()).filter(Boolean))];
      if (!clean.length) return;
      const rows = [];
      ["recruit", "bestseller"].forEach(z => {
        clean.forEach(c => rows.push({ user_id: userId, zone: z, category: c }));
      });
      const { error } = await client.from("zone_permissions").insert(rows);
      if (error) throw new Error(error.message || "更新权限失败");
    },
  };
})();
