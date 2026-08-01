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
- **Encrypted file attachments** — up to 25MB per file, split into 1MB chunks, each AES-GCM encrypted client-side and written once under a server-issued R2 staging session; an ordered authenticated manifest is exposed through one atomic D1 compare-and-swap, and legacy D1 chunks migrate lazily on first access
- **Complete encrypted backup and restore** — exports the encrypted vault envelope and every encrypted attachment chunk in one JSON backup; restore accepts the backup's password, stages all files under fresh IDs, and replaces the vault only after staging succeeds
- **Master-password rotation** — verifies the current password, stages every attachment under a new encryption key, atomically swaps the encrypted vault and auth token, then removes old-key files and D1 history
- **Vault history** — the server keeps the last 10 encrypted payloads in `vault_history` on every save; restore is manual via the D1 console
- **Conflict protection** — every save carries a vault revision, so a stale browser tab receives a conflict instead of silently overwriting newer data
- **Clipboard hygiene** — copied secrets are cleared from the clipboard after 60 seconds (best effort, only if the clipboard still holds the copied value)
- **Auto-lock** — the vault locks after 15 minutes of inactivity
- **Offline auto-lock recovery** — if syncing fails at lock time, an encrypted recovery copy is kept in that browser and offered on the next unlock
- **Legacy migration** — plaintext (v0), v1, and v2 vaults are upgraded to the v3 scheme on unlock, including re-encryption of all attachment chunks (idempotent if interrupted)
- **Separate tax origin** — a static UK self-assessment calculator (CIS/self-employed/employed modes, pension contributions, HICBC, annual allowance carry-forward) built and deployed independently from the vault

## Security

- The master password never leaves the browser; it is only used locally to derive keys
- **Envelope v3 key derivation**: PBKDF2-SHA256 (600,000 iterations, random per-vault salt) produces 256 base bits, then HKDF-SHA256 expands them into independent secrets:
  - a purpose-bound **AES-GCM-256 vault key** (used only in the browser)
  - a purpose-bound **HMAC-SHA256 manifest key** (used only in the browser)
  - a unique **per-file AES-GCM-256 key**, derived with the random immutable file ID as its HKDF salt
  - a **32-byte auth token**, sent as the `x-vault-auth` header to gate API reads/writes
- The vault envelope is authenticated with its vault ID, version, and object type. Every file chunk is authenticated with the vault ID, version, object type, file ID, chunk index, and total chunk count.
- Each encrypted vault contains an authenticated attachment manifest (ordered ciphertext hashes and plaintext chunk sizes), so missing, replayed, swapped, or reordered chunks fail closed.
- Attachment chunks cannot overwrite a live file: each upload uses a random immutable staging prefix, duplicate indexes are rejected, and the server exposes the session only after its exact ordered hashes match the browser-authenticated manifest. Concurrent sessions use a per-file generation compare-and-swap, and unreferenced sessions older than 24 hours are garbage-collected in bounded batches.
- Persisted KDF parameters, base64 envelopes, request bodies, file counts, and chunk sizes have strict lower and upper bounds before expensive work begins.
- The server stores only SHA-256(authToken) in `vaults.auth_hash` and compares it in constant time — it learns nothing about the encryption key
- Fresh setup and one-time legacy migration also require a deployment-only `BOOTSTRAP_SECRET`, preventing the first public visitor from claiming an uninitialized vault
- Failed authentication attempts are rate-limited per hashed client address in D1, using an atomic one-minute attempt window
- `/api/vault/meta` is intentionally public: it exposes only the KDF salt and iteration count, which the client needs to derive keys before making authenticated calls
- AES-GCM authentication tags provide tamper detection during decrypt
- Strict security headers ship via `public/_headers`: a `default-src 'self'` Content-Security-Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a locked-down Permissions-Policy

## Local Development

Install dependencies with `bun install`.

Vite development uses same-origin `/api` requests. Use the local Pages stack below when exercising Functions; production builds may set `VITE_API_BASE` explicitly.

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

Functions never create or alter schema during a request. Apply every checked-in
migration before deploying code that depends on it. Optionally set
`ALLOWED_ORIGIN` to enable CORS for one specific origin.

## Vault Flow

1. On first setup, the user supplies the deployment bootstrap secret. The browser derives the encryption key and auth token from the master password, encrypts an empty vault, and stores the envelope in D1 via `/api/vault/init` (which registers the auth token hash).
2. On unlock, the browser fetches KDF parameters from the public `/api/vault/meta` endpoint, re-derives the key and auth token, then loads the encrypted envelope with `/api/vault/load` and decrypts it locally. A wrong password fails either the auth check (401) or the AES-GCM decrypt.
3. On edits, the browser re-encrypts the whole vault and saves the new ciphertext (debounced) via `/api/vault/save`; the server atomically checks the expected revision and snapshots the previous payload into `vault_history`.
4. Attachments are chunked and encrypted in the browser, then uploaded through `/api/vault/files/*` into write-once private R2 staging objects. The browser submits its HMAC-authenticated manifest only after every chunk is present; the server checks the exact ordered ciphertext hashes and atomically advances the file's D1 manifest pointer. Downloads resolve only that pointer and recheck the stored hash before client-side HMAC and AES-GCM verification. A chunk found only in the legacy `vault_files` D1 table is copied to R2 before its D1 row is removed.
5. Vaults on v1 or v2 (or legacy plaintext) are transparently upgraded to v3 on unlock, re-encrypting the vault and every attachment chunk under purpose-separated keys and authenticated context.
6. Backup restore and password rotation always stage re-encrypted attachments under fresh object IDs before the encrypted D1 envelope changes, so an interrupted operation leaves the current vault recoverable.

## Metadata boundary

Encryption hides vault contents, filenames, MIME types, thumbnails, notes, and
file bytes. Cloudflare can still observe operational metadata needed to serve
the app: the fixed vault record, ciphertext sizes, opaque file IDs, chunk
indexes/counts, request timing, client network metadata, and access frequency.
The public `/api/vault/meta` endpoint reveals the envelope version and KDF salt
and work factor by design. Do not treat this deployment as traffic-analysis
resistant or multi-tenant isolation.

The tax calculator is built into `tax-site/dist` and deployed as the separate
`1pass-tax` Pages project. Its bundle contains no vault UI, API client, Pages
Functions, D1/R2 bindings or vault authentication strings, and its CSP denies
all network connections. The vault links across origins using
`VITE_TAX_ORIGIN`; the tax site links back with `VITE_VAULT_ORIGIN`.

Deploy and verify the two projects independently:

```bash
bun run build
bun run deploy:tax
bun run deploy:vault
```

## Verification

```bash
bun run cf:types
bun run check
bun audit
```
