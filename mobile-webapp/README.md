# Pomfret Mobile Web App

Standalone mobile web app (PWA shell) for All Sky Camera only.

## Goals

- Keep current desktop site untouched.
- Show only one page: live all-sky camera stream.

## Local run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create env file:

   ```bash
   cp .env.example .env.local
   ```

   Default stream URL is:

   `https://cam.pomfretastro.org/camera/stream`

3. Start dev server:

   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000`.

## Deploy

- Deploy this folder as a separate Vercel project (`mobile-webapp` root directory).
- Optional domain: `m.pomfretastro.org` (no need to buy a new domain).
