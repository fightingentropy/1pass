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
- Self-hosted fonts (Geist, JetBrains Mono) — no third-party requests at runtime

## Features

- **Identities** — name, contact details, address, NI number, NHS number, passport number, UTR, Government Gateway ID, and notes
- **Per-identity credentials** — username/password logins with website and notes, stored inside the identity
- **API keys** — label, service, key, environment, and notes
- **Encrypted file attachments** — up to 25MB per file, split into 1MB chunks, each AES-GCM encrypted client-side and written once under a server-issued R2 staging session; an ordered authenticated manifest is exposed through one atomic D1 compare-and-swap
- **Image previews** — each image gets a small JPEG thumbnail stored as its own one-chunk encrypted file, fetched and decrypted when the file list is shown, so the vault envelope does not grow with every photo. Thumbnails that older releases kept inline are moved out after unlock
- **Complete encrypted backup and restore** — exports the encrypted vault envelope and every encrypted attachment and preview chunk in one JSON backup; restore accepts the backup's password, stages all files under fresh IDs, and replaces the vault only after staging succeeds. Backups made before the v3 upgrade still restore. A preview that cannot be read is dropped instead of failing a backup, restore, or password change
- **Master-password rotation** — verifies the current password, stages every attachment under a new encryption key, atomically swaps the encrypted vault and auth token, then removes old-key files and D1 history
- **Vault history** — the server keeps the last 10 encrypted payloads in `vault_history` on every save; restore is manual via the D1 console
- **Conflict protection** — every save carries a vault revision, so a stale browser tab receives a conflict instead of silently overwriting newer data; “Reload vault” fetches the newer revision with the live session and, when both sides changed, asks which version to keep
- **Clipboard hygiene** — copied secrets are cleared from the clipboard after 60 seconds (best effort, only if the clipboard still holds the copied value)
- **Auto-lock** — the vault locks after 15 minutes of inactivity
- **Offline auto-lock recovery** — if syncing fails at lock time, an encrypted recovery copy is kept in that browser and offered on the next unlock
- **Orphan cleanup** — after unlock, committed attachments and previews that no vault entry references and that are more than an hour old are deleted; the server only ever sees opaque file ids, so the browser has to make this call

## Command line

`bun run cli` lists identities, attaches a file to one, or downloads an
attachment, using the same client-side encryption as the browser. It asks for
the master password at a hidden prompt (or reads it from the first line of
stdin when piped) and never stores it.

```bash
bun run cli list
bun run cli attach ~/path/to/file.key --identity "First Last"
bun run cli download file.key --out ./file.key
```

`attach` encrypts and uploads the file, saves the vault with conflict
protection, then downloads the copy again to confirm it matches. `--replace`
swaps an attachment of the same name; `--identity` takes a full name or an id
from `list`, and is asked for interactively when omitted. Downloads are written
with owner-only permissions. The vault address defaults to `VAULT_URL` or
`https://1pass.erlin.org`; plain `http` is allowed for localhost only. Files
attached from the CLI get no image thumbnail.

`bun run test:cli` runs the CLI against a local Pages dev server with a
throwaway vault in a temporary directory.

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
- Fresh setup requires a deployment-only `BOOTSTRAP_SECRET`, preventing the first public visitor from claiming an uninitialized vault. A vault row without an auth hash is rejected outright; the bootstrap secret never grants access to an existing vault
- Failed authentication attempts are rate-limited per hashed client address in D1, using an atomic one-minute attempt window
- `/api/vault/meta` is intentionally public: it exposes only the KDF salt and iteration count, which the client needs to derive keys before making authenticated calls. The envelope version and KDF parameters are kept in their own `vaults` columns, so this unauthenticated route never reads the encrypted payload
- AES-GCM authentication tags provide tamper detection during decrypt
- Strict security headers ship via `public/_headers`: a `default-src 'self'` Content-Security-Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a locked-down Permissions-Policy

## Local Development

Install dependencies with `bun install`.

All builds use same-origin `/api` requests, so the app works on both `1pass.pages.dev` and `1pass.erlin.org`. Use the local Pages stack below when exercising Functions; `VITE_API_BASE` only configures the local Vite proxy target.

For a fully local stack (frontend + Functions + local D1), create local secrets,
apply the checked-in migration, and start Pages development:

```bash
cp .dev.vars.example .dev.vars
bun run db:migrate:local
bun run pages-dev
```

The local app is served at [http://localhost:8788](http://localhost:8788).
`bun run dev` runs the Vite-only frontend on port 5173 with hot reload and
proxies `/api` to the local Pages dev server on port 8788 by default, so run
`bun run pages-dev` alongside it. Set `VITE_API_BASE` to point the proxy at a
deployed site instead.

## Cloudflare Pages Deployment

Production: [1pass.erlin.org](https://1pass.erlin.org). The custom domain is attached to the existing `1pass` Pages project, with a proxied CNAME pointing to `1pass.pages.dev`.

1. The checked-in `wrangler.jsonc` contains the existing Pages project and D1 binding.
2. Create the private attachment bucket once: `bunx wrangler r2 bucket create 1pass-vault-files`.
3. Set a long random bootstrap secret: `bunx wrangler pages secret put BOOTSTRAP_SECRET --project-name 1pass`.
4. Apply migrations: `bunx wrangler d1 migrations apply DB --remote --env production`. Deploy the matching code right after: migration `0005` backfills the meta columns from the current envelope, and a password change made by older code in between would leave them stale.
5. Build with `bun run build`; the Pages build output is `dist`.
6. Deploy through the existing Pages Git integration or `bunx wrangler pages deploy dist --project-name 1pass`.

Functions never create or alter schema during a request. Apply every checked-in
migration before deploying code that depends on it. Optionally set
`ALLOWED_ORIGIN` to enable CORS for one specific origin.

Deployments that ran a release before envelope v3 may still hold unreferenced
attachment chunks at the old direct keys under `vaults/default/files/`. Nothing
reads them any more; this one-off bucket rule expires them:

```bash
bunx wrangler r2 bucket lifecycle add 1pass-vault-files expire-legacy-files vaults/default/files/ --expire-days 1
```

## Vault Flow

1. On first setup, the user supplies the deployment bootstrap secret. The browser derives the encryption key and auth token from the master password, encrypts an empty vault, and stores the envelope in D1 via `/api/vault/init` (which registers the auth token hash).
2. On unlock, the browser fetches KDF parameters from the public `/api/vault/meta` endpoint, re-derives the key and auth token, then loads the encrypted envelope with `/api/vault/load` and decrypts it locally. A wrong password fails either the auth check (401) or the AES-GCM decrypt.
3. On edits, the browser re-encrypts the whole vault and saves the new ciphertext (debounced) via `/api/vault/save`; the server atomically checks the expected revision and snapshots the previous payload into `vault_history`.
4. Attachments are chunked and encrypted in the browser, then uploaded through `/api/vault/files/*` into write-once private R2 staging objects. The browser submits its HMAC-authenticated manifest only after every chunk is present; the server checks the exact ordered ciphertext hashes and atomically advances the file's D1 manifest pointer. Downloads resolve only that pointer and recheck the stored hash before client-side HMAC and AES-GCM verification. Image previews take the same path as one-chunk files.
5. Backup restore and password rotation always stage re-encrypted attachments under fresh object IDs before the encrypted D1 envelope changes, so an interrupted operation leaves the current vault recoverable.

## Metadata boundary

Encryption hides vault contents, filenames, MIME types, thumbnails, notes, and
file bytes. Cloudflare can still observe operational metadata needed to serve
the app: the fixed vault record, ciphertext sizes, opaque file IDs, chunk
indexes/counts, request timing, client network metadata, and access frequency.
The public `/api/vault/meta` endpoint reveals the envelope version and KDF salt
and work factor by design. Do not treat this deployment as traffic-analysis
resistant or multi-tenant isolation.

## Verification

```bash
bun run cf:types
bun run check
bun audit
```
