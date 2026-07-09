# 1Pass Vault

A single-user SolidJS vault app that encrypts everything in the browser before syncing vault metadata to Cloudflare D1 and encrypted attachment chunks to Cloudflare R2. The server only ever sees ciphertext and a hash of an auth token — never the master password, encryption key, or decrypted data.

## Getting Started

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) to access the vault.

## Tech Stack

- **SolidJS** for the SPA UI
- **Vite** for local dev and bundling
- **TypeScript 7** for native, strict application and Worker type-checking
- **Web Crypto API** for PBKDF2 + HKDF key derivation and AES-GCM encryption
- **Cloudflare Pages Functions + D1 + R2** for vault metadata and file persistence
- Self-hosted fonts (Inter, JetBrains Mono) — no third-party requests at runtime

## Features

- **Identities** — name, contact details, address, NI number, NHS number, passport number, UTR, Government Gateway ID, and notes
- **Per-identity credentials** — username/password logins with website and notes, stored inside the identity
- **API keys** — label, service, key, environment, and notes
- **Encrypted file attachments** — up to 25MB per file, split into 1MB chunks, each AES-GCM encrypted client-side and stored in the private `1pass-vault-files` R2 bucket; legacy D1 chunks migrate lazily on first access
- **Complete encrypted backup and restore** — exports the encrypted vault envelope and every encrypted attachment chunk in one JSON backup; restore accepts the backup's password, stages all files under fresh IDs, and replaces the vault only after staging succeeds
- **Master-password rotation** — verifies the current password, stages every attachment under a new encryption key, atomically swaps the encrypted vault and auth token, then removes old-key files and D1 history
- **Vault history** — the server keeps the last 10 encrypted payloads in `vault_history` on every save; restore is manual via the D1 console
- **Conflict protection** — every save carries a vault revision, so a stale browser tab receives a conflict instead of silently overwriting newer data
- **Clipboard hygiene** — copied secrets are cleared from the clipboard after 60 seconds (best effort, only if the clipboard still holds the copied value)
- **Auto-lock** — the vault locks after 15 minutes of inactivity
- **Offline auto-lock recovery** — if syncing fails at lock time, an encrypted recovery copy is kept in that browser and offered on the next unlock
- **Legacy migration** — plaintext (v0) and v1-encrypted vaults are upgraded to the v2 scheme on unlock, including re-encryption of all attachment chunks (idempotent if interrupted)
- **/tax** — a standalone UK self-assessment tax calculator page (CIS/self-employed/employed modes, pension contributions, HICBC, annual allowance carry-forward); lazy-loaded, entirely client-side

## Security

- The master password never leaves the browser; it is only used locally to derive keys
- **Envelope v2 key derivation**: PBKDF2-SHA256 (600,000 iterations, random per-vault salt) produces 256 base bits, then HKDF-SHA256 expands them into two independent secrets:
  - an **AES-GCM-256 encryption key** (used only in the browser)
  - a **32-byte auth token**, sent as the `x-vault-auth` header to gate API reads/writes
- The server stores only SHA-256(authToken) in `vaults.auth_hash` and compares it in constant time — it learns nothing about the encryption key
- Fresh setup and one-time legacy migration also require a deployment-only `BOOTSTRAP_SECRET`, preventing the first public visitor from claiming an uninitialized vault
- Failed authentication attempts are rate-limited per hashed client address in D1, using an atomic one-minute attempt window
- `/api/vault/meta` is intentionally public: it exposes only the KDF salt and iteration count, which the client needs to derive keys before making authenticated calls
- AES-GCM authentication tags provide tamper detection during decrypt
- Strict security headers ship via `public/_headers`: a `default-src 'self'` Content-Security-Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a locked-down Permissions-Policy

## Local Development

Install dependencies with `bun install`.

`.env` sets `VITE_API_BASE` to the production URL, and Vite bakes it into builds — the dev server frontend will talk to the deployed API by default.

For a fully local stack (frontend + Functions + local D1), create local secrets,
apply the checked-in migration, and start Pages development:

```bash
cp .dev.vars.example .dev.vars
bun run db:migrate:local
bun run pages-dev
```

The local app is served at [http://localhost:8788](http://localhost:8788).
`bun run dev` still runs the Vite-only frontend on port 5173 and proxies `/api`
to `VITE_API_BASE`.

## Cloudflare Pages Deployment

1. The checked-in `wrangler.jsonc` contains the existing Pages project and D1 binding.
2. Create the private attachment bucket once: `bunx wrangler r2 bucket create 1pass-vault-files`.
3. Set a long random bootstrap secret: `bunx wrangler pages secret put BOOTSTRAP_SECRET --project-name 1pass`.
4. Apply migrations: `bunx wrangler d1 migrations apply DB --remote --env production`.
5. Build with `bun run build`; the Pages build output is `dist`.
6. Deploy through the existing Pages Git integration or `bunx wrangler pages deploy dist --project-name 1pass`.

The functions retain lazy schema upgrades for older deployments, but new schema
changes should be added under `migrations/`. Optionally set `ALLOWED_ORIGIN` to
enable CORS for one specific origin.

## Vault Flow

1. On first setup, the user supplies the deployment bootstrap secret. The browser derives the encryption key and auth token from the master password, encrypts an empty vault, and stores the envelope in D1 via `/api/vault/init` (which registers the auth token hash).
2. On unlock, the browser fetches KDF parameters from the public `/api/vault/meta` endpoint, re-derives the key and auth token, then loads the encrypted envelope with `/api/vault/load` and decrypts it locally. A wrong password fails either the auth check (401) or the AES-GCM decrypt.
3. On edits, the browser re-encrypts the whole vault and saves the new ciphertext (debounced) via `/api/vault/save`; the server atomically checks the expected revision and snapshots the previous payload into `vault_history`.
4. Attachments are chunked and encrypted in the browser, then uploaded through `/api/vault/files/*` into private R2 objects. Downloads reverse the process client-side. A chunk found only in the legacy `vault_files` D1 table is copied to R2 before its D1 row is removed.
5. Vaults on the old v1 scheme (or legacy plaintext) are transparently upgraded to v2 on unlock, re-encrypting the vault and every attachment chunk under the new key.
6. Backup restore and password rotation always stage re-encrypted attachments under fresh object IDs before the encrypted D1 envelope changes, so an interrupted operation leaves the current vault recoverable.

## Verification

```bash
bun run cf:types
bun run check
bun audit
```
