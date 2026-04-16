# Pomfret Astro Website

A modern, responsive website for the Pomfret School VISTA Observatory showcasing astronomical photography, equipment information, and observatory details.

## Features

- **Home Page**: Introduction to Pomfret Astro and VISTA Observatory
- **Gallery**: Photo gallery showcasing astronomical images
- **Equipment**: Detailed information about observatory equipment and specifications

## Tech Stack

- **Next.js 14**: React framework with App Router
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first CSS framework
- **Responsive Design**: Mobile-first approach

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
website/
├── app/
│   ├── page.tsx          # Home page
│   ├── gallery/
│   │   └── page.tsx      # Gallery page
│   ├── equipment/
│   │   └── page.tsx      # Equipment page
│   ├── layout.tsx        # Root layout
│   └── globals.css       # Global styles
├── components/
│   └── Navigation.tsx    # Navigation component
└── package.json
```

## Customization

- Update gallery images in `app/gallery/page.tsx`
- Modify equipment information in `app/equipment/page.tsx`
- Customize colors in `tailwind.config.js`
- Update metadata in `app/layout.tsx`

## Deployment

### 自动部署到 pomfretastro.org

这个网站配置为使用 **Vercel** 部署，并连接到域名 `pomfretastro.org`。

**设置完成后，每次代码更新都会自动部署，你立即就能在网站上看到效果！**

详细部署说明请查看 [DEPLOYMENT.md](./DEPLOYMENT.md)

### 快速开始

1. 安装 Vercel CLI:
```bash
npm install -g vercel
```

2. 在 website 目录下部署:
```bash
cd website
vercel login
vercel
```

3. 在 Vercel Dashboard 连接域名 `pomfretastro.org`

### 其他部署选项

- **Netlify**
- **Any static hosting service**

## License

Pomfret School VISTA Observatory Project

