# GitHub 推送 + Cloudflare 部署检查清单

适用：仓库在 GitHub，站点由 Cloudflare（Pages）自动部署。

---

## 第一步：确认仓库根目录结构（最常见错误）

打开 GitHub 仓库首页，**第一层**必须能直接看到这些：

```
index.html
admin.html
compare.html
pinterest.html
shein.html
js/
css/
vendor/
```

如果你看到的是：

```
Bestselling-Resources-main/     ← 多了一层
  └ index.html
```

那么整站一定 404。Cloudflare 只认根目录（或指定输出目录）里的文件，多一层就等于根目录没有任何页面。

**修正办法**（在本地解压目录里执行）：

```bash
# 进入解压出来的文件夹（里面应直接能看到 index.html）
cd Bestselling-Resources-main
ls index.html          # 有输出才说明位置对了

# 把内容推到仓库根（假设远端分支是 main）
git init                                  # 若已有仓库可跳过
git remote add origin <你的仓库地址>        # 若已有可跳过
git add -A
git commit -m "deploy 20261111V"
git push -f origin main
```

推完回 GitHub 首页确认：根目录直接是 `index.html`，而不是一个文件夹。

---

## 第二步：确认 Cloudflare 部署状态

Cloudflare 控制台 → Workers & Pages → 你的项目 → **Deployments**：

| 状态 | 含义 |
|---|---|
| Success（最新一条） | 部署成功，问题在缓存或路径 |
| Failed | 构建失败 → 点进去看日志，通常是配置或文件问题 |
| 最新一条是很久以前 | 说明推送没触发部署（分支不对 / 自动部署关掉了） |

同时检查 **Settings → Builds & deployments**：

- **Framework preset**：`None`
- **Build command**：留空
- **Build output directory**：`/`（有些项目误填成 `dist`，会导致部署出空站点）

> 如果你之前一直是好的、只是最近坏了，这一项一般没被改过，重点看第一步和部署状态。

---

## 第三步：清缓存

Cloudflare 控制台 → 你的域名 → **Caching → Purge Cache → Purge Everything**。

然后浏览器强刷：Windows `Ctrl+Shift+R`，Mac `Cmd+Shift+R`。

---

## 第四步：判定

部署成功后打开：

1. **`你的域名/selftest.html`** —— 它不依赖脚本，直接告诉你文件在不在：
   - 「文件全部取不到」→ 回到第一步，目录结构或部署有问题
   - 「部分文件缺失」→ 推送不完整
   - 「静态文件都在」→ 托管正常，是脚本层的事
2. 若连 `selftest.html` 都打不开 → 100% 是部署/域名/路径问题，与页面代码无关。

---

## 第五步：确认恢复后

看页面里的版本号是否为 `20261111V`。是，说明回退到位。

然后告诉我：哪个页面打不开、遮罩上有没有提示文字、Cloudflare 部署状态是 Success 还是 Failed。我按 V 这个基线重做那几项改动，一次只动一处。
