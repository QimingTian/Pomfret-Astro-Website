#!/bin/bash
# 部署脚本 - Pomfret Astro Website
# 使用方法: ./deploy.sh

cd "$(dirname "$0")"

echo "🚀 开始部署到 Vercel..."
echo ""

# 检查是否已登录
if ! vercel whoami &>/dev/null; then
    echo "❌ 未登录 Vercel，请先运行: vercel login"
    exit 1
fi

# 部署到生产环境
echo "📦 正在部署到生产环境..."
vercel --prod --yes

echo ""
echo "✅ 部署完成！"
echo "🌐 网站地址: https://pomfretastro.org"
echo ""
echo "💡 提示: 如果部署失败，请手动运行: vercel --prod"

