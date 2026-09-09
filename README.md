# TREND BANK（前台浏览 + 后台传图 · 真私密版）

一个部署在 **GitHub Pages** 的图片站：

- **前台**（`index.html`）：用户用 **邮箱+密码** 登录后，按分类浏览图片（缩略图懒加载、点击看大图）。近期新增 **趋势专区入口**（`trends.html`）。
- **后台**（`admin.html`）：**管理员**登录后，可 **网页拖拽上传/删除图片**，并管理 **趋势专区** 文件。
- **趋势专区**（`trends.html`）：登录后按 类目 / 月度 / 周度 标签浏览、在线预览趋势 PDF（受控鉴权、防下载）。

**图片真正私密**：所有图片存放在 Cloudflare R2 私有桶中，任何图片请求都必须携带登录令牌、经 Cloudflare Worker 校验后才放行 —— **未登录的人连图片网址都打不开**。

---

## 一、架构说明

```
GitHub Pages（静态页面）
   ├── 前台 index.html ──┐
   └── 后台 admin.html ──┤
                        ├──► Supabase（只做登录验证 + 图片清单）
                        │       ├── Auth      邮箱密码登录/会话
                        │       └── Database  profiles 角色表 + images 清单表
                        │
                        └──► Cloudflare Worker（图片"守门员"，免费）
                                ├── 校验令牌（问 Supabase：登录了吗？是管理员吗？）
                                ├── 通过才从 R2 私有桶取图/存图/删图
                                └── R2 私有桶（图片文件，任何人无法直接访问）
```

- **Supabase** 只承担 **登录验证 + 数据库清单**（不存图片，不占它的 1GB 存储/5GB 流量）
- **图片文件** 全部放 **R2 私有桶**（免费 10GB、出口流量不收费），由 Worker 鉴权代理

---

## 二、部署步骤

### 第 1 步：准备好 Supabase 项目（只做登录）
1. 登录 supabase.com，新建项目。
2. 记下 **Project URL** 与 **anon public key**（Project Settings → API）。
3. 填入 `js/config.js` 的 `SUPABASE.url` 和 `SUPABASE.anonKey`。

### 第 2 步：执行数据库初始化
1. 项目 → **SQL Editor** → New query。
2. 打开 `tools/setup.sql`，全选复制运行。
3. 自动创建：`profiles` 表（角色）、`images` 表（清单）、安全策略、注册自动建档。

### 第 3 步：开启邮箱登录
- 项目 → **Authentication → Providers → Email** 开启，建议关闭 Confirm email。

### 第 4 步：创建管理员
1. 访问站点 `admin.html` → “暂无账号？注册一个”，用你的邮箱注册。
2. 回 Supabase → **SQL Editor** 执行（换成你的邮箱）：
   ```sql
   update public.profiles set role = 'admin'
     where email = '你的邮箱@example.com';
   ```
3. 回站点刷新重新登录，上传功能即开放。

### 第 5 步：创建 Cloudflare R2 桶（图片仓库）
1. 注册/登录 **Cloudflare**（免费）→ 左侧 **R2 Object Storage**。
2. **Create bucket**：桶名填 `images`，**不要选"允许公开访问"**（保持私有）。
3. 记下桶名。

### 第 6 步：部署 Cloudflare Worker（守门员）
1. 左侧 **Workers & Pages** → **Create** → **Worker** → 随便起个名字（如 `gallery-api`）→ Deploy。
2. 进入该 Worker → **Settings → Variables**：
   - 添加 `SUPABASE_URL` = 你的 Supabase Project URL
   - 添加 `SUPABASE_ANON_KEY` = 你的 anon public key
3. **Settings → Bindings** → Add → **R2 Bucket**：
   - 变量名填 `IMAGES`，选择你刚创建的 `images` 桶。
4. 回到 Worker **Edit code**，把本目录 `worker/worker.js` 的**全部内容覆盖**粘贴进去 → Deploy。
5. 记下 Worker 访问地址（形如 `https://gallery-api.你的子域.workers.dev`），填入 `js/config.js` 的 `WORKER_URL`。

> **趋势专区依赖**：新版 `worker/worker.js` 额外提供了趋势文件的上传 / 删除 / 受控预览（`/trend/...`）端点。请务必用最新版 `worker/worker.js`（与趋势相关）整体覆盖部署，否则趋势上传与前台预览会失败。

### 第 7 步：部署到 GitHub Pages
1. 把 `gallery-site` 目录所有文件推送到 GitHub 仓库。
2. 仓库 → **Settings → Pages** → Deploy from a branch，分支 `main`，目录 `/ (root)`。

---

## 三、使用说明

**前台（访客）**
- 打开站点，邮箱注册/登录后进入画廊；顶部切换分类，点击图片看大图。

**后台（管理员）**
- 打开 `admin.html`，管理员账号登录。左侧菜单固定顺序：① 上传图片 → ② 我的常用类目 → ③ 前台类目 → ④ 图片管理 → ⑤ 前台访问设置 → ⑥ 标签管理 → ⑦ 数据看板。
- **① 上传**：选择/新建分类 → 拖拽多张图片 → 点“上传所选”。图片经 Worker 写入 R2，清单记录进数据库，前台立即可见。
- **④ 管理**：按分类查看图片；支持批量删除（同时删 R2 文件与清单）；**勾选多张图 → 点“批量打标签”**，分渠道/风格/元素统一打标（添加/移除/清空）。

**三类标签（渠道 / 风格 / 元素）**
- **渠道标签**（固定清单，后台不可增删）：市场站（TEMU / AMAZON / ALIEXPRESS）、社媒（TIKTOK / INS / FACEBOOK）、灵感（PINTEREST）、品牌网站（SHEIN）。清单在 `js/config.js` 的 `CHANNEL_TAGS` 维护。
- **风格标签**与**元素标签**（后台可自定义增删）：在后台「⑥ 标签管理」中新增/删除，删除时会同步移除所有图片上的该标签；首次建库会自动预置一批常用风格/元素标签（`PRESET_STYLE_TAGS` / `PRESET_ELEMENT_TAGS`）。
- **批量打标**：后台「④ 图片管理」勾选多张图片 → 点「批量打标签」，可分别按渠道/风格/元素添加或移除标签，也可一键清空三类标签。
- **前台展示与筛选**：图片区顶部有**吸顶的标签筛选栏**（渠道/风格/元素三组，向下滚动仍始终可见），三个维度可组合筛选；图片卡片底部显示**渠道 / 风格 / 元素**三类标签（未打标显示“未打标”），不再显示文件名。
- **数据看板**：后台「⑦ 数据看板」实时统计各渠道/风格/元素标签下的图片数量（横向条形图）、打标覆盖率（环形图）及图片总数/类目数/已打标/未打标总览。

> **升级旧站点**：本版 `tools/setup.sql` 新增 `images.tags`（渠道）、`images.style_tags`（风格）、`images.element_tags`（元素）三列，以及 `categories`、`site_settings`、`tag_defs`（风格/元素标签定义表）与匿名读取策略。已上线的库请把 `setup.sql` 整体重跑一遍（全部为幂等语句），并把 `worker/worker.js`（修复版，兼容中文路径 + 公开模式放行）重新部署到 Cloudflare Worker。

**为访客建号**
- 默认开放自助注册（`config.js` 的 `enableSignup` 控制）。要改为仅管理员建号：设 `false`，在 Supabase **Authentication → Users** 手动 Add user。

---

## 四、常见问题

- **登录提示 Invalid login credentials**：密码错误，或邮箱未在 Auth 用户里。
- **看图 401**：登录态过期，重新登录即可（Worker 会校验令牌）。
- **上传提示无管理员权限**：确认当前账号已在 SQL 里升级为 admin。
- **上传/看图报 404**：Worker 的 R2 Binding 变量名必须叫 `IMAGES`，且绑定到 `images` 桶。
- **为什么要 Worker 而不是直接放桶**：R2 桶保持私有，任何请求都要 Worker 校验令牌，未登录无法拿到图片，实现”真私密”。

---

## 五、文件清单
```
gallery-site/
├── index.html           前台 · 视觉专区（登录 + 画廊 + 趋势入口）
├── trends.html          前台 · 趋势专区（三标签筛选 + PDF 受控预览）
├── admin.html           后台（登录 + 上传/管理 + 趋势专区管理）
├── css/style.css        样式
├── js/
│   ├── config.js        ★ 配置（Supabase URL/anon key + Worker 地址 + 标签/类别清单）
│   ├── supabase.js      登录 + 清单 + Worker 通道封装 + 趋势通道封装
│   ├── frontend.js      前台视觉专区逻辑
│   ├── trends.js        前台趋势专区逻辑
│   └── admin.js         后台逻辑（含趋势专区管理）
├── worker/worker.js     Cloudflare Worker 源码（部署到 Cloudflare，含趋势端点）
└── tools/setup.sql      Supabase 数据库初始化（含 trends 表）
```
