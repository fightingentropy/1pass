# 1Pass Vault

A SolidJS vault app that encrypts vault data in the browser before syncing it to Cloudflare D1.

## Getting Started

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) to access the vault.

## Tech Stack

- **SolidJS** for the SPA UI
- **Vite** for local dev and bundling
- **TypeScript** for application code
- **Web Crypto API** for PBKDF2 key derivation and AES-GCM encryption
- **Cloudflare Pages Functions + D1** for vault persistence

## Features

- Browser-side encryption before vault sync
- Master-password unlock using PBKDF2-derived AES-GCM keys
- Identity record storage and search
- Legacy plaintext vault migration on first unlock
- Cloudflare Pages Function API for init, status, load, and save

## Security

- The master password is only used in the browser to derive an encryption key
- The backend stores an encrypted vault envelope, not decrypted identity data
- Vaults use PBKDF2-SHA256 with 310,000 iterations and AES-GCM-256
- AES-GCM authentication tags provide tamper detection during decrypt

## Local Development

Install dependencies with `bun install`, then run `bun run dev`.

The frontend can run locally on its own, but the vault API still expects the
Cloudflare Pages Functions and D1 binding to exist. Point `VITE_API_BASE` at a
deployed environment if you want to exercise the full encrypted sync flow.

## Cloudflare Pages Deployment

1. Create a D1 database in the Cloudflare dashboard.
2. Run the SQL in `migrations/0001_create_vaults.sql` in the D1 console.
3. Bind the D1 database to your Pages project as `DB`.
4. Build the site with `bun run build` (or `npm run build`).
5. Set the Cloudflare Pages build output directory to `dist`.
6. Ensure the SPA redirect from `public/_redirects` ships with the build.
7. Deploy the static site (Functions are auto-detected from `functions/`).

## Vault Flow

1. On first setup, the browser derives a key from the master password and
   stores an encrypted empty vault in D1.
2. On unlock, the browser fetches the encrypted envelope, derives the same key,
   and decrypts the vault locally.
3. On edits, the browser re-encrypts the vault and saves the new ciphertext.
