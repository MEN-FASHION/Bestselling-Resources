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

  // ---------- 上传前自动转 WebP：大图转成 WebP 节省空间，小图不转 ----------
  // 仅对图片生效；默认转 WebP（同观感但体积更小）；已是小图或压缩不划算时保留原图；
  // 失败时回退原文件，绝不丢图。
  async function compressImage(file) {
    if (!file || !/^image\//i.test(file.type || "")) return file;
    const MAX_EDGE = 1600;            // 最长边上限
    const SMALL_BYTES = 300 * 1024;   // 小于 300KB 视为已足够小，直接返回原图（不转）
    const CANVAS_MAX = 1920;          // 超过此尺寸才考虑转码（避免无谓变换）
    if (file.size <= SMALL_BYTES) return file;
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
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      if (!w || !h || (w <= CANVAS_MAX && h <= CANVAS_MAX && file.size <= 900 * 1024)) return file;
      const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";           // 白底，避免透明 PNG 转 JPEG 变黑底
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      // 默认转 WebP：同观感、体积更小，现代浏览器与移动端全支持，观看无差异
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
      if (!blob || blob.size >= file.size) return file;   // 转码不划算则保留原图
      // 保留原文件名，仅替换内容与 MIME，避免影响去重/命名逻辑
      return new File([blob], file.name, { type: "image/webp" });
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
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({
        email: this.normalizeEmail(email),
        password
      });
      return { data, error };
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

    // ============ DB（图片清单） ============
    async listImages(category) {
      let q = client.from("images").select("*").order("created_at", { ascending: false });
      if (category && category !== "全部") q = q.eq("category", category);
      const { data, error } = await q;
      if (error) throw new Error(error.message || "读取失败");
      return data || [];
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
    async listUsedCats() {
      const { data, error } = await client.from("images").select("category").order("category");
      if (error) throw new Error(error.message || "读取失败");
      return [...new Set((data || []).map(d => d.category))];
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
      const c = cover ? await compressImage(cover) : null;
      const fd = new FormData();
      fd.append("file", file);
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
      const { data, error } = await client.from("profiles").select("user_id, email, role").order("created_at", { ascending: true });
      if (error) throw new Error(error.message || "读取用户失败");
      return data || [];
    },
    // 超管：设置某用户角色（visitor / admin / super_admin）
    async setUserRole(userId, role) {
      const { error } = await client.from("profiles").update({ role }).eq("user_id", userId);
      if (error) throw new Error(error.message || "更新角色失败");
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
