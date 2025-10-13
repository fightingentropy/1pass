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
- 🔄 Vercel Blob storage for production deployments

## Security

- All encryption/decryption happens in-browser using Web Crypto API
- Master password never leaves your device
- API routes only handle encrypted payloads
- Uses PBKDF2 (310k iterations) + AES-GCM-256
- Integrity tags prevent tampering

## Local Development

Encrypted vault is stored in `data/vault.json` during development.

## Production Deployment

### Vercel Blob Setup

1. Enable **Vercel Blob** in project dashboard
2. Add `BLOB_READ_WRITE_TOKEN` to environment variables
3. Optional: Set `VAULT_BLOB_PREFIX` for custom storage path
4. Deploy and initialize vault via UI

### Environment Variables

- `BLOB_READ_WRITE_TOKEN` - Required for production Vercel Blob storage
- `VAULT_BLOB_PREFIX` - Optional, defaults to `vaults`
- `VAULT_BLOB_KEY` - Optional, defaults to `vault.json`

## Performance Optimizations

- React Compiler for automatic optimizations
- Memoized components and callbacks
- React transitions for smooth interactions
- Turbopack for fast builds (~2.4s)
- Modern image formats (AVIF, WebP)
- Optimized crypto operations with caching
