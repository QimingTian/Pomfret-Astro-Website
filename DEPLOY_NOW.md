# 立即部署说明

由于环境限制，需要手动运行部署命令。请按以下步骤操作：

## 快速部署（推荐）

在终端中运行：

```bash
cd "/Users/tianqiming/Desktop/Pomfret Astro/website"
npm run deploy
```

或者直接使用 Vercel CLI：

```bash
cd "/Users/tianqiming/Desktop/Pomfret Astro/website"
vercel --prod --yes
```

## 如果提示需要登录

如果提示需要登录，运行：

```bash
vercel login
```

然后再次运行部署命令。

## 部署完成后

部署完成后，favicon 会在几分钟内出现在 https://pomfretastro.org

## 以后自动部署

我已经在 `package.json` 中添加了 `deploy` 脚本，以后可以直接运行：

```bash
npm run deploy
```

