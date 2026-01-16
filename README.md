# 1Pass Vault

A fast, client-side password manager built with SolidJS, Vite, and the Web Crypto API.

## Getting Started

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) to access the vault.

## Tech Stack

- **SolidJS** for fine-grained reactivity
- **Vite** for instant dev startup
- **TypeScript 5** with strict mode
- **Tailwind CSS 4** for styling
- **Web Crypto API** for encryption (PBKDF2 + AES-GCM)

## Features

- 🔐 Client-side encryption (master password never leaves your device)
- 💾 Store passwords, credit cards, and identity information
- 🚀 Snappy UI powered by Solid's fine-grained updates
- 📱 Responsive design with modern UI
- 📦 Static output ready for Cloudflare Pages + D1

## Security

- All encryption/decryption happens in-browser using Web Crypto API
- Master password never leaves your device
- Encrypted vault is stored in Cloudflare D1
- Uses PBKDF2 (310k iterations) + AES-GCM-256
- Integrity tags prevent tampering

## Local Development

The UI runs with `bun run dev`, but vault storage depends on Cloudflare Pages
Functions + D1. Use a deployed Pages project to exercise the storage API.

## Cloudflare Pages Deployment

1. Create a D1 database in the Cloudflare dashboard.
2. Run the SQL in `migrations/0001_create_vaults.sql` in the D1 console.
3. Bind the D1 database to your Pages project as `DB`.
4. Build the site with `bun run build` (or `npm run build`).
5. Set the Cloudflare Pages build output directory to `dist`.
6. Ensure the SPA redirect from `public/_redirects` ships with the build.
7. Deploy the static site (Functions are auto-detected from `functions/`).

## Performance Optimizations

- Solid's fine-grained reactivity keeps updates minimal
- Vite build output optimized for CDN delivery
- Service worker caches the shell for quick loads
- Optimized crypto operations with caching
