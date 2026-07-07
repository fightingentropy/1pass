# 1Pass Vault

A single-user SolidJS vault app that encrypts everything in the browser before syncing it to Cloudflare D1. The server only ever sees ciphertext and a hash of an auth token — never the master password, encryption key, or decrypted data.

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
- **Web Crypto API** for PBKDF2 + HKDF key derivation and AES-GCM encryption
- **Cloudflare Pages Functions + D1** for vault persistence
- Self-hosted fonts (Inter, JetBrains Mono) — no third-party requests at runtime

## Features

- **Identities** — name, contact details, address, NI number, NHS number, passport number, UTR, Government Gateway ID, and notes
- **Per-identity credentials** — username/password logins with website and notes, stored inside the identity
- **API keys** — label, service, key, environment, and notes
- **Encrypted file attachments** — up to 25MB per file, split into 1MB chunks, each AES-GCM encrypted client-side and stored as base64 JSON rows in D1 (`vault_files`); images and PDFs preview in-app
- **Export backup** — downloads the encrypted vault envelope as JSON (decryptable only with the master password; attachments not included)
- **Vault history** — the server keeps the last 10 encrypted payloads in `vault_history` on every save; restore is manual via the D1 console
- **Clipboard hygiene** — copied secrets are cleared from the clipboard after 60 seconds (best effort, only if the clipboard still holds the copied value)
- **Auto-lock** — the vault locks after 15 minutes of inactivity
- **Legacy migration** — plaintext (v0) and v1-encrypted vaults are upgraded to the v2 scheme on unlock, including re-encryption of all attachment chunks (idempotent if interrupted)
- **/tax** — a standalone UK self-assessment tax calculator page (CIS/self-employed/employed modes, pension contributions, HICBC, annual allowance carry-forward); lazy-loaded, entirely client-side

## Security

- The master password never leaves the browser; it is only used locally to derive keys
- **Envelope v2 key derivation**: PBKDF2-SHA256 (600,000 iterations, random per-vault salt) produces 256 base bits, then HKDF-SHA256 expands them into two independent secrets:
  - an **AES-GCM-256 encryption key** (used only in the browser)
  - a **32-byte auth token**, sent as the `x-vault-auth` header to gate API reads/writes
- The server stores only SHA-256(authToken) in `vaults.auth_hash` and compares it in constant time — it learns nothing about the encryption key
- `/api/vault/meta` is intentionally public: it exposes only the KDF salt and iteration count, which the client needs to derive keys before making authenticated calls
- AES-GCM authentication tags provide tamper detection during decrypt
- Strict security headers ship via `public/_headers`: a `default-src 'self'` Content-Security-Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a locked-down Permissions-Policy

## Local Development

Install dependencies with `bun install`, then run `bun run dev`.

`.env` sets `VITE_API_BASE` to the production URL, and Vite bakes it into builds — the dev server frontend will talk to the deployed API by default.

For a fully local stack (frontend + Functions + local D1):

```bash
VITE_API_BASE=" " bun run build
bunx wrangler pages dev dist --d1=DB
```

## Cloudflare Pages Deployment

1. Create a D1 database in the Cloudflare dashboard.
2. Bind the D1 database to your Pages project as `DB`.
3. Build the site with `bun run build`.
4. Set the Cloudflare Pages build output directory to `dist`.
5. Ensure `public/_redirects` (SPA fallback) and `public/_headers` (security headers) ship with the build.
6. Deploy the static site (Functions are auto-detected from `functions/`).

No SQL migrations are needed: tables (`vaults`, `vault_history`, `vault_files`) and columns are created automatically on first use. Optionally set the `ALLOWED_ORIGIN` environment variable to enable CORS for a specific origin.

## Vault Flow

1. On first setup, the browser derives the encryption key and auth token from the master password, encrypts an empty vault, and stores the envelope in D1 via `/api/vault/init` (which registers the auth token hash).
2. On unlock, the browser fetches KDF parameters from the public `/api/vault/meta` endpoint, re-derives the key and auth token, then loads the encrypted envelope with `/api/vault/load` and decrypts it locally. A wrong password fails either the auth check (401) or the AES-GCM decrypt.
3. On edits, the browser re-encrypts the whole vault and saves the new ciphertext (debounced) via `/api/vault/save`; the server snapshots the previous payload into `vault_history` first.
4. Attachments are chunked, encrypted, and uploaded per chunk to `/api/vault/files/*`; downloads reverse the process client-side.
5. Vaults on the old v1 scheme (or legacy plaintext) are transparently upgraded to v2 on unlock, re-encrypting the vault and every attachment chunk under the new key.
