import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { onRequestPost as initializeVault } from "../functions/api/vault/init";
import { onRequestPost as deleteFile } from "../functions/api/vault/files/delete";
import { onRequestGet as listFiles } from "../functions/api/vault/files/list";
import { onRequestPost as uploadFile } from "../functions/api/vault/files/upload";
import type { VaultEncryptedPayload } from "../functions/api/vault/schema";
import { sha256Hex, type Env } from "../functions/api/vault/shared";

const testEnv = env as Env;
const authToken = "list-auth-token-with-more-than-thirty-two-characters";
const payload: VaultEncryptedPayload = {
  version: 2,
  format: "aes-gcm",
  kdf: {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: 600_000,
    salt: "AAAAAAAAAAAAAAAAAAAAAA==",
  },
  iv: "AAAAAAAAAAAAAAAA",
  ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
};

type ListedFile = { id: string; committedAt: number };

function postRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`https://vault.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function listRequest(headers: Record<string, string> = {}) {
  return listFiles({
    env: testEnv,
    request: new Request("https://vault.test/api/vault/files/list", {
      headers,
    }),
  });
}

describe("vault file list", () => {
  it("lists live manifest-tracked files and nothing else", async () => {
    const uninitialized = await listRequest({ "x-vault-auth": authToken });
    expect(uninitialized.status).toBe(404);

    const initialized = await initializeVault({
      env: testEnv,
      request: postRequest(
        "/api/vault/init",
        { payload },
        {
          "x-vault-auth": authToken,
          "x-vault-bootstrap": "test-bootstrap-secret",
        },
      ),
    });
    expect(initialized.status).toBe(200);

    const missingToken = await listRequest();
    expect(missingToken.status).toBe(401);

    const wrongToken = await listRequest({ "x-vault-auth": "wrong-auth-token" });
    expect(wrongToken.status).toBe(401);

    const empty = await listRequest({ "x-vault-auth": authToken });
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({ files: [] });

    const encryptedChunk = {
      version: 3 as const,
      iv: "AAAAAAAAAAAAAAAA",
      ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
    };
    const chunkHash = await sha256Hex(JSON.stringify(encryptedChunk));
    const manifestMac = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    const began = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        { action: "begin", fileId: "listed-file", totalChunks: 1 },
        { "x-vault-auth": authToken },
      ),
    });
    expect(began.status).toBe(200);
    const { uploadId } = (await began.json()) as { uploadId: string };

    const uploaded = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        { action: "chunk", uploadId, chunkIndex: 0, payload: encryptedChunk },
        { "x-vault-auth": authToken },
      ),
    });
    expect(uploaded.status).toBe(200);

    // Staged chunks are not a committed file yet, so they are not listed.
    const staged = await listRequest({ "x-vault-auth": authToken });
    expect(staged.status).toBe(200);
    await expect(staged.json()).resolves.toEqual({ files: [] });

    const beforeCommit = Date.now();
    const committed = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "commit",
          uploadId,
          manifest: {
            chunks: 1,
            envelopeVersion: 3,
            chunkHashes: [chunkHash],
            chunkSizes: [1],
            manifestMac,
          },
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(committed.status).toBe(200);

    const listed = await listRequest({ "x-vault-auth": authToken });
    expect(listed.status).toBe(200);
    const { files } = (await listed.json()) as { files: ListedFile[] };
    expect(files).toHaveLength(1);
    expect(files[0].id).toBe("listed-file");
    expect(typeof files[0].committedAt).toBe("number");
    expect(files[0].committedAt).toBeGreaterThanOrEqual(beforeCommit);
    expect(files[0].committedAt).toBeLessThanOrEqual(Date.now());

    const deleted = await deleteFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/delete",
        { id: "listed-file" },
        { "x-vault-auth": authToken },
      ),
    });
    expect(deleted.status).toBe(200);

    // The tombstoned manifest row still exists but is no longer live.
    const afterDelete = await listRequest({ "x-vault-auth": authToken });
    expect(afterDelete.status).toBe(200);
    await expect(afterDelete.json()).resolves.toEqual({ files: [] });
  });
});
