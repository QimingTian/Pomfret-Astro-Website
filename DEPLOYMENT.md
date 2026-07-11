# 部署指南 - Pomfret Astro Website

## 使用 Vercel 自动部署

Vercel 是 Next.js 的官方推荐平台，支持自动部署和自定义域名。

### 域名状态

✅ **域名已注册**: `pomfretastro.org` 已在 Cloudflare 管理
- 注册商: Cloudflare, Inc.
- 状态: 活跃
- Name Servers: Cloudflare (bjorn.ns.cloudflare.com, kiki.ns.cloudflare.com)

### 第一次部署

1. **安装 Vercel CLI**（如果还没有）:
```bash
npm install -g vercel
```

2. **登录 Vercel**:
```bash
cd website
vercel login
```

3. **部署项目**:
```bash
vercel
```
按照提示完成部署。第一次会创建一个预览部署。

4. **部署到生产环境**:
```bash
vercel --prod
```

5. **在 Vercel Dashboard 添加域名**:
   - 访问 https://vercel.com/dashboard
   - 找到你的项目
   - 进入 **Settings** → **Domains**
   - 添加域名: `pomfretastro.org`
   - Vercel 会显示需要配置的 DNS 记录

6. **在 Cloudflare 配置 DNS**:
   
   登录 Cloudflare Dashboard (https://dash.cloudflare.com)
   
   **选项 A: 使用 CNAME（推荐）**
   - 添加 CNAME 记录:
     - **Name**: `@` (或留空，表示根域名)
     - **Target**: `cname.vercel-dns.com`
     - **Proxy status**: 可以开启 Cloudflare Proxy (橙色云朵) 或关闭 (灰色云朵)
   
   **选项 B: 使用 A 记录**
   - Vercel 会提供 IP 地址，在 Cloudflare 添加 A 记录指向该 IP
   
   **对于 www 子域名**:
   - 添加 CNAME 记录:
     - **Name**: `www`
     - **Target**: `cname.vercel-dns.com`

### 自动部署工作流程

一旦设置完成，每次你更新代码并推送到 Git 仓库，Vercel 会自动：
1. 检测到代码变更
2. 自动构建新版本
3. 自动部署到生产环境
4. **你立即就能在 pomfretastro.org 看到更新！**

### 两种部署方式

#### 方式 1: Git 集成（推荐 - 完全自动）

1. 将代码推送到 GitHub/GitLab/Bitbucket
2. 在 Vercel Dashboard → Settings → Git 连接你的仓库
3. 之后每次 `git push`，Vercel 会自动部署

#### 方式 2: 手动部署

```bash
cd website
vercel --prod
```

这会直接部署到生产环境。

### 预览部署

在推送到主分支之前，可以创建预览：
```bash
vercel
```
这会创建一个预览 URL，不影响生产环境。

### 检查部署状态

```bash
vercel ls
```

### 查看日志

```bash
vercel logs
```

## Cloudflare 配置详情

由于域名在 Cloudflare 管理，你可以利用 Cloudflare 的功能：

### SSL/TLS 设置
- Cloudflare Dashboard → SSL/TLS
- 设置为 **Full** 或 **Full (strict)** 模式
- 这样 Cloudflare 和 Vercel 之间的连接也是加密的

### 缓存设置（可选）
- 可以在 Cloudflare 设置缓存规则
- 但 Vercel 已经有很好的缓存策略，通常不需要额外配置

### DNS 记录示例

在 Cloudflare DNS 设置中应该看到：

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME | @ | cname.vercel-dns.com | 可选 |
| CNAME | www | cname.vercel-dns.com | 可选 |

## 环境变量（如果需要）

如果将来需要环境变量，在 Vercel Dashboard → Settings → Environment Variables 中添加。

## 注意事项

- DNS 传播通常需要几分钟到几小时
- Vercel 提供免费的 SSL 证书（HTTPS）
- Cloudflare 也提供 SSL，两者可以配合使用
- 所有部署都有独立的预览 URL
- 可以回滚到之前的部署版本
- 如果使用 Cloudflare Proxy，确保 SSL 模式设置为 Full

## 验证部署

部署完成后，访问：
- https://pomfretastro.org
- https://www.pomfretastro.org

两个都应该正常工作。
