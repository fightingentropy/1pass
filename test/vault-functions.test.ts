import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { onRequestPost as initializeVault } from "../functions/api/vault/init";
import { onRequestGet as loadVault } from "../functions/api/vault/load";
import { onRequestPost as rotateVault } from "../functions/api/vault/rotate";
import { onRequestPost as saveVault } from "../functions/api/vault/save";
import { onRequestPost as deleteFile } from "../functions/api/vault/files/delete";
import { onRequestGet as getFile } from "../functions/api/vault/files/get";
import { onRequestPost as uploadFile } from "../functions/api/vault/files/upload";
import type { VaultEncryptedPayload } from "../functions/api/vault/schema";
import {
  fileChunkKey,
  type Env,
} from "../functions/api/vault/shared";

const testEnv = env as Env;
const payload: VaultEncryptedPayload = {
  version: 2,
  format: "aes-gcm",
  kdf: {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: 600_000,
    salt: "c2FsdA==",
  },
  iv: "aXY=",
  ciphertext: "Y2lwaGVydGV4dA==",
};

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

describe("vault Pages Functions", () => {
  it("guards initialization and rejects stale saves", async () => {
    const denied = await initializeVault({
      env: testEnv,
      request: postRequest(
        "/api/vault/init",
        { payload },
        {
          "x-vault-auth": "auth-token",
          "x-vault-bootstrap": "wrong-secret",
        },
      ),
    });
    expect(denied.status).toBe(401);

    const initialized = await initializeVault({
      env: testEnv,
      request: postRequest(
        "/api/vault/init",
        { payload },
        {
          "x-vault-auth": "auth-token",
          "x-vault-bootstrap": "test-bootstrap-secret",
        },
      ),
    });
    expect(initialized.status).toBe(200);
    await expect(initialized.json()).resolves.toMatchObject({ revision: 0 });

    const loaded = await loadVault({
      env: testEnv,
      request: new Request("https://vault.test/api/vault/load", {
        headers: { "x-vault-auth": "auth-token" },
      }),
    });
    expect(loaded.status).toBe(200);
    await expect(loaded.json()).resolves.toMatchObject({ revision: 0, payload });

    const saved = await saveVault({
      env: testEnv,
      request: postRequest(
        "/api/vault/save",
        { payload, expectedRevision: 0 },
        { "x-vault-auth": "auth-token" },
      ),
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({ revision: 1 });

    const stale = await saveVault({
      env: testEnv,
      request: postRequest(
        "/api/vault/save",
        { payload, expectedRevision: 0 },
        { "x-vault-auth": "auth-token" },
      ),
    });
    expect(stale.status).toBe(409);

    const encryptedChunk = { iv: "aXY=", ciphertext: "Y2h1bms=" };
    const uploaded = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        { id: "r2-file", chunkIndex: 0, payload: encryptedChunk },
        { "x-vault-auth": "auth-token" },
      ),
    });
    expect(uploaded.status).toBe(200);
    expect(await testEnv.VAULT_FILES.head(fileChunkKey("r2-file", 0))).not.toBeNull();

    const downloaded = await getFile({
      env: testEnv,
      request: new Request(
        "https://vault.test/api/vault/files/get?id=r2-file&chunk=0",
        { headers: { "x-vault-auth": "auth-token" } },
      ),
    });
    expect(downloaded.status).toBe(200);
    await expect(downloaded.json()).resolves.toEqual({ payload: encryptedChunk });

    const deleted = await deleteFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/delete",
        { id: "r2-file" },
        { "x-vault-auth": "auth-token" },
      ),
    });
    expect(deleted.status).toBe(200);
    expect(await testEnv.VAULT_FILES.head(fileChunkKey("r2-file", 0))).toBeNull();

    await testEnv.DB.prepare(
      "INSERT INTO vault_files (id, chunk_index, payload, created_at) VALUES (?1, 0, ?2, ?3)",
    )
      .bind("legacy-file", JSON.stringify(encryptedChunk), Date.now())
      .run();
    const migrated = await getFile({
      env: testEnv,
      request: new Request(
        "https://vault.test/api/vault/files/get?id=legacy-file&chunk=0",
        { headers: { "x-vault-auth": "auth-token" } },
      ),
    });
    expect(migrated.status).toBe(200);
    expect(
      await testEnv.VAULT_FILES.head(fileChunkKey("legacy-file", 0)),
    ).not.toBeNull();
    const legacyRow = await testEnv.DB.prepare(
      "SELECT payload FROM vault_files WHERE id = ?1 AND chunk_index = 0",
    )
      .bind("legacy-file")
      .first();
    expect(legacyRow).toBeNull();

    const replacementToken = "replacement-auth-token-with-more-than-32-characters";
    const rotated = await rotateVault({
      env: testEnv,
      request: postRequest(
        "/api/vault/rotate",
        {
          payload: { ...payload, ciphertext: "bmV3LWNpcGhlcnRleHQ=" },
          expectedRevision: 1,
          newAuthToken: replacementToken,
        },
        { "x-vault-auth": "auth-token" },
      ),
    });
    expect(rotated.status).toBe(200);
    await expect(rotated.json()).resolves.toMatchObject({ revision: 2 });

    const oldCredentials = await loadVault({
      env: testEnv,
      request: new Request("https://vault.test/api/vault/load", {
        headers: { "x-vault-auth": "auth-token" },
      }),
    });
    expect(oldCredentials.status).toBe(401);

    const newCredentials = await loadVault({
      env: testEnv,
      request: new Request("https://vault.test/api/vault/load", {
        headers: { "x-vault-auth": replacementToken },
      }),
    });
    expect(newCredentials.status).toBe(200);
    await expect(newCredentials.json()).resolves.toMatchObject({ revision: 2 });
    const history = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM vault_history WHERE vault_id = 'default'",
    ).first<{ count: number }>();
    expect(history?.count).toBe(0);

    await testEnv.DB.prepare("DELETE FROM vault_auth_attempts").run();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const rejected = await loadVault({
        env: testEnv,
        request: new Request("https://vault.test/api/vault/load", {
          headers: { "x-vault-auth": "wrong-auth-token" },
        }),
      });
      expect(rejected.status).toBe(401);
    }
    const rateLimited = await loadVault({
      env: testEnv,
      request: new Request("https://vault.test/api/vault/load", {
        headers: { "x-vault-auth": "wrong-auth-token" },
      }),
    });
    expect(rateLimited.status).toBe(429);
  });
});
