# 1Pass Vault

A secure, client-side password manager built with Next.js 16, React 19, and Web Crypto API.

## Getting Started

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the vault.

## Tech Stack

- **Next.js 16 Canary** with Turbopack
- **React 19** with React Compiler enabled
- **TypeScript 5** with strict mode
- **Tailwind CSS 4** for styling
- **Web Crypto API** for encryption (PBKDF2 + AES-GCM)

## Features

- 🔐 Client-side encryption (master password never leaves your device)
- 💾 Store passwords, credit cards, and identity information
- 🚀 Optimized for performance (memoization, transitions, image optimization)
- 📱 Responsive design with modern UI
- 📦 Static export ready for CDN hosting (Cloudflare Pages + D1)

## Security

- All encryption/decryption happens in-browser using Web Crypto API
- Master password never leaves your device
- Encrypted vault is stored in Cloudflare D1
- Uses PBKDF2 (310k iterations) + AES-GCM-256
- Integrity tags prevent tampering

## Local Development

The UI runs with `bun run dev`, but vault storage depends on Cloudflare Pages
Functions + D1. Deploy to Pages to exercise the storage API.

## Cloudflare Pages Deployment

1. Create a D1 database in the Cloudflare dashboard.
2. Run the SQL in `migrations/0001_create_vaults.sql` in the D1 console.
3. Bind the D1 database to your Pages project as `DB`.
4. Build the site with `bun run build` (or `npm run build`).
5. Set the Cloudflare Pages build output directory to `out`.
6. Deploy the static site (Functions are auto-detected from `functions/`).

## Performance Optimizations

- React Compiler for automatic optimizations
- Memoized components and callbacks
- React transitions for smooth interactions
- Turbopack for fast builds (~2.4s)
- Modern image formats (AVIF, WebP)
- Optimized crypto operations with caching
