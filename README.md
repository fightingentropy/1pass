This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, install dependencies and run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

### Local vault storage

During local development the encrypted vault is persisted in `data/vault.json`. This mirrors the structure used in production, making it easy to inspect or reset the vault while iterating locally.

## Deploying to Vercel

1. Enable **Vercel Blob** for the project from the Vercel dashboard (`Storage → Blob`).
2. Copy the generated `BLOB_READ_WRITE_TOKEN` and add it as an environment variable in the Vercel project settings (Environment Variables → Add).
3. Optionally customise `VAULT_BLOB_PREFIX` or `VAULT_BLOB_KEY` if you need a different location for the encrypted vault record.
4. Redeploy the project. On the first launch, initialise the vault through the UI or by calling `POST /api/vault/init`.

> **Note:** Vercel Blob currently exposes files via signed URLs. The vault contents remain encrypted, but anyone with access to the blob URL could download the ciphertext. Keep master passwords secret and rotate the blob token if it leaks.

## Environment variables

- `BLOB_READ_WRITE_TOKEN` &mdash; required in production to read and write the encrypted vault to Vercel Blob.
- `VAULT_BLOB_PREFIX` (optional) &mdash; folder-like prefix used when storing the vault, defaults to `vaults`.
- `VAULT_BLOB_KEY` (optional) &mdash; filename used within the prefix, defaults to `vault.json`.

An `.env.example` file is provided as a reference for local configuration.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
