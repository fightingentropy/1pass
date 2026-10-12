import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { onRequestPost as initializeVault } from "../functions/api/vault/init";
import { onRequestGet as loadVault } from "../functions/api/vault/load";
import { onRequestPost as rotateVault } from "../functions/api/vault/rotate";
import { onRequestPost as saveVault } from "../functions/api/vault/save";
import { onRequestPost as deleteFile } from "../functions/api/vault/files/delete";
import { onRequestGet as getFile } from "../functions/api/vault/files/get";
import { onRequestPost as uploadFile } from "../functions/api/vault/files/upload";
import type { VaultEncryptedPayload } from "../functions/api/vault/schema";
import {
  STAGED_UPLOAD_MAX_AGE_MS,
  sha256Hex,
  stagedChunkKey,
  type Env,
} from "../functions/api/vault/shared";

const testEnv = env as Env;
const authToken = "auth-token-with-more-than-thirty-two-characters";
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

const encryptedChunk = {
  version: 3 as const,
  iv: "AAAAAAAAAAAAAAAA",
  ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
};
const secondEncryptedChunk = {
  version: 3 as const,
  iv: "AQEBAQEBAQEBAQEB",
  ciphertext: "AQEBAQEBAQEBAQEBAQEBAQ==",
};
const serializedChunk = JSON.stringify(encryptedChunk);
const serializedSecondChunk = JSON.stringify(secondEncryptedChunk);
const manifestMac = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

// The blocks below run in order against one D1 database and R2 bucket, so each
// builds on the vault state the previous blocks left behind.
describe("vault Pages Functions", () => {
  let chunkHash: string;
  let secondChunkHash: string;
  // The committed two-chunk upload behind "r2-file", read back by the tamper check.
  let uploadId: string;
  // The upload that replaces "r2-file" after its first delete.
  let replacementUploadId: string;

  beforeAll(async () => {
    chunkHash = await sha256Hex(serializedChunk);
    secondChunkHash = await sha256Hex(serializedSecondChunk);
  });

  it("guards initialization and rejects stale saves", async () => {
    const denied = await initializeVault({
      env: testEnv,
      request: postRequest(
        "/api/vault/init",
        { payload },
        {
          "x-vault-auth": authToken,
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
          "x-vault-auth": authToken,
          "x-vault-bootstrap": "test-bootstrap-secret",
        },
      ),
    });
    expect(initialized.status).toBe(200);
    await expect(initialized.json()).resolves.toMatchObject({ revision: 0 });

    const rejectedBeforeBodyRead = await saveVault({
      env: testEnv,
      request: new Request("https://vault.test/api/vault/save", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vault-auth": "wrong-auth-token",
        },
        body: "x".repeat(1_950_001),
      }),
    });
    expect(rejectedBeforeBodyRead.status).toBe(401);

    const oversized = await saveVault({
      env: testEnv,
      request: new Request("https://vault.test/api/vault/save", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vault-auth": authToken,
        },
        body: "x".repeat(1_950_001),
      }),
    });
    expect(oversized.status).toBe(413);

    const hostileKdf = await saveVault({
      env: testEnv,
      request: postRequest(
        "/api/vault/save",
        {
          payload: {
            ...payload,
            kdf: { ...payload.kdf, iterations: 2_000_001 },
          },
          expectedRevision: 0,
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(hostileKdf.status).toBe(400);

    const loaded = await loadVault({
      env: testEnv,
      request: new Request("https://vault.test/api/vault/load", {
        headers: { "x-vault-auth": authToken },
      }),
    });
    expect(loaded.status).toBe(200);
    await expect(loaded.json()).resolves.toMatchObject({
      revision: 0,
      payload,
    });

    const saved = await saveVault({
      env: testEnv,
      request: postRequest(
        "/api/vault/save",
        { payload, expectedRevision: 0 },
        { "x-vault-auth": authToken },
      ),
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({ revision: 1 });

    const stale = await saveVault({
      env: testEnv,
      request: postRequest(
        "/api/vault/save",
        { payload, expectedRevision: 0 },
        { "x-vault-auth": authToken },
      ),
    });
    expect(stale.status).toBe(409);
  });

  it("stages chunks and commits an immutable manifest", async () => {
    const began = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        { action: "begin", fileId: "r2-file", totalChunks: 2 },
        { "x-vault-auth": authToken },
      ),
    });
    expect(began.status).toBe(200);
    ({ uploadId } = (await began.json()) as { uploadId: string });

    const uploaded = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "chunk",
          uploadId,
          chunkIndex: 0,
          payload: encryptedChunk,
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(uploaded.status).toBe(200);
    expect(
      await testEnv.VAULT_FILES.head(stagedChunkKey(uploadId, 0)),
    ).not.toBeNull();

    const duplicate = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "chunk",
          uploadId,
          chunkIndex: 0,
          payload: secondEncryptedChunk,
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(duplicate.status).toBe(409);

    const missingChunkCommit = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "commit",
          uploadId,
          manifest: {
            chunks: 2,
            envelopeVersion: 3,
            chunkHashes: [chunkHash, secondChunkHash],
            chunkSizes: [1, 1],
            manifestMac,
          },
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(missingChunkCommit.status).toBe(409);

    const uploadedSecond = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "chunk",
          uploadId,
          chunkIndex: 1,
          payload: secondEncryptedChunk,
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(uploadedSecond.status).toBe(200);

    const reorderedCommit = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "commit",
          uploadId,
          manifest: {
            chunks: 2,
            envelopeVersion: 3,
            chunkHashes: [secondChunkHash, chunkHash],
            chunkSizes: [1, 1],
            manifestMac,
          },
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(reorderedCommit.status).toBe(409);

    const committed = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "commit",
          uploadId,
          manifest: {
            chunks: 2,
            envelopeVersion: 3,
            chunkHashes: [chunkHash, secondChunkHash],
            chunkSizes: [1, 1],
            manifestMac,
          },
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(committed.status).toBe(200);

    const replayedCommit = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "commit",
          uploadId,
          manifest: {
            chunks: 2,
            envelopeVersion: 3,
            chunkHashes: [chunkHash, secondChunkHash],
            chunkSizes: [1, 1],
            manifestMac,
          },
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(replayedCommit.status).toBe(409);

    const downloaded = await getFile({
      env: testEnv,
      request: new Request(
        "https://vault.test/api/vault/files/get?id=r2-file&chunk=0",
        { headers: { "x-vault-auth": authToken } },
      ),
    });
    expect(downloaded.status).toBe(200);
    await expect(downloaded.json()).resolves.toEqual({
      payload: encryptedChunk,
    });

    const downloadedSecond = await getFile({
      env: testEnv,
      request: new Request(
        "https://vault.test/api/vault/files/get?id=r2-file&chunk=1",
        { headers: { "x-vault-auth": authToken } },
      ),
    });
    expect(downloadedSecond.status).toBe(200);
    await expect(downloadedSecond.json()).resolves.toEqual({
      payload: secondEncryptedChunk,
    });
  });

  it("detects a tampered chunk on read", async () => {
    // A storage-layer overwrite with another valid ciphertext is detected by
    // the committed ordered hash before data reaches the decryptor.
    await testEnv.VAULT_FILES.put(
      stagedChunkKey(uploadId, 0),
      serializedSecondChunk,
    );
    const substituted = await getFile({
      env: testEnv,
      request: new Request(
        "https://vault.test/api/vault/files/get?id=r2-file&chunk=0",
        { headers: { "x-vault-auth": authToken } },
      ),
    });
    expect(substituted.status).toBe(500);
    await testEnv.VAULT_FILES.put(stagedChunkKey(uploadId, 0), serializedChunk);
  });

  it("lets exactly one concurrent commit win", async () => {
    // Two immutable sessions can stage concurrently, but their shared base
    // generation allows exactly one manifest pointer to commit.
    const raceBeginA = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        { action: "begin", fileId: "race-file", totalChunks: 1 },
        { "x-vault-auth": authToken },
      ),
    });
    const raceBeginB = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        { action: "begin", fileId: "race-file", totalChunks: 1 },
        { "x-vault-auth": authToken },
      ),
    });
    const raceUploadA = ((await raceBeginA.json()) as { uploadId: string })
      .uploadId;
    const raceUploadB = ((await raceBeginB.json()) as { uploadId: string })
      .uploadId;
    for (const [raceUploadId, racePayload] of [
      [raceUploadA, encryptedChunk],
      [raceUploadB, secondEncryptedChunk],
    ] as const) {
      const response = await uploadFile({
        env: testEnv,
        request: postRequest(
          "/api/vault/files/upload",
          {
            action: "chunk",
            uploadId: raceUploadId,
            chunkIndex: 0,
            payload: racePayload,
          },
          { "x-vault-auth": authToken },
        ),
      });
      expect(response.status).toBe(200);
    }
    const raceCommitA = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "commit",
          uploadId: raceUploadA,
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
    expect(raceCommitA.status).toBe(200);
    const raceCommitB = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "commit",
          uploadId: raceUploadB,
          manifest: {
            chunks: 1,
            envelopeVersion: 3,
            chunkHashes: [secondChunkHash],
            chunkSizes: [1],
            manifestMac,
          },
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(raceCommitB.status).toBe(409);
    const activeRaceManifest = await testEnv.DB.prepare(
      "SELECT upload_id, generation FROM vault_file_manifests WHERE vault_id = 'default' AND file_id = 'race-file'",
    ).first<{ upload_id: string; generation: number }>();
    expect(activeRaceManifest).toEqual({
      upload_id: raceUploadA,
      generation: 1,
    });
  });

  it("deletes an attachment and commits a replacement", async () => {
    const deletedRace = await deleteFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/delete",
        { id: "race-file" },
        { "x-vault-auth": authToken },
      ),
    });
    expect(deletedRace.status).toBe(200);

    const replacementBegin = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        { action: "begin", fileId: "r2-file", totalChunks: 1 },
        { "x-vault-auth": authToken },
      ),
    });
    replacementUploadId = (
      (await replacementBegin.json()) as { uploadId: string }
    ).uploadId;
    const replacementChunk = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "chunk",
          uploadId: replacementUploadId,
          chunkIndex: 0,
          payload: secondEncryptedChunk,
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(replacementChunk.status).toBe(200);
    const replacementCommit = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "commit",
          uploadId: replacementUploadId,
          manifest: {
            chunks: 1,
            envelopeVersion: 3,
            chunkHashes: [secondChunkHash],
            chunkSizes: [1],
            manifestMac,
          },
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(replacementCommit.status).toBe(200);
    await expect(replacementCommit.json()).resolves.toMatchObject({
      generation: 2,
    });
    const replacementDownload = await getFile({
      env: testEnv,
      request: new Request(
        "https://vault.test/api/vault/files/get?id=r2-file&chunk=0",
        { headers: { "x-vault-auth": authToken } },
      ),
    });
    await expect(replacementDownload.json()).resolves.toEqual({
      payload: secondEncryptedChunk,
    });
  });

  it("rejects a stale session after delete and allows abort", async () => {
    const staleBegin = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        { action: "begin", fileId: "r2-file", totalChunks: 1 },
        { "x-vault-auth": authToken },
      ),
    });
    const staleUploadId = ((await staleBegin.json()) as { uploadId: string })
      .uploadId;
    const staleChunk = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "chunk",
          uploadId: staleUploadId,
          chunkIndex: 0,
          payload: encryptedChunk,
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(staleChunk.status).toBe(200);

    const deleted = await deleteFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/delete",
        { id: "r2-file" },
        { "x-vault-auth": authToken },
      ),
    });
    expect(deleted.status).toBe(200);
    expect(
      await testEnv.VAULT_FILES.head(stagedChunkKey(replacementUploadId, 0)),
    ).toBeNull();

    const staleAfterDelete = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        {
          action: "commit",
          uploadId: staleUploadId,
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
    expect(staleAfterDelete.status).toBe(409);
    const deletedRead = await getFile({
      env: testEnv,
      request: new Request(
        "https://vault.test/api/vault/files/get?id=r2-file&chunk=0",
        { headers: { "x-vault-auth": authToken } },
      ),
    });
    expect(deletedRead.status).toBe(404);
    const abortedStale = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        { action: "abort", uploadId: staleUploadId },
        { "x-vault-auth": authToken },
      ),
    });
    expect(abortedStale.status).toBe(200);
  });

  it("garbage-collects abandoned uploads", async () => {
    const abandonedUploadId = "abandoned-upload-session";
    await testEnv.DB.prepare(
      "INSERT INTO vault_file_uploads (upload_id, vault_id, file_id, total_chunks, base_generation, state, created_at) VALUES (?1, 'default', 'abandoned-file', 1, 0, 'staging', ?2)",
    )
      .bind(abandonedUploadId, Date.now() - STAGED_UPLOAD_MAX_AGE_MS - 1)
      .run();
    await testEnv.VAULT_FILES.put(
      stagedChunkKey(abandonedUploadId, 0),
      serializedChunk,
    );
    const gcTrigger = await uploadFile({
      env: testEnv,
      request: postRequest(
        "/api/vault/files/upload",
        { action: "begin", fileId: "gc-trigger", totalChunks: 1 },
        { "x-vault-auth": authToken },
      ),
    });
    expect(gcTrigger.status).toBe(200);
    expect(
      await testEnv.VAULT_FILES.head(stagedChunkKey(abandonedUploadId, 0)),
    ).toBeNull();
    const abandonedRow = await testEnv.DB.prepare(
      "SELECT upload_id FROM vault_file_uploads WHERE upload_id = ?1",
    )
      .bind(abandonedUploadId)
      .first();
    expect(abandonedRow).toBeNull();
  });

  it("serves attachments only through committed manifests", async () => {
    // An object at the retired direct-key R2 layout is never read back.
    await testEnv.VAULT_FILES.put(
      "vaults/default/files/unmanifested-file/0.json",
      serializedChunk,
    );
    const unmanifested = await getFile({
      env: testEnv,
      request: new Request(
        "https://vault.test/api/vault/files/get?id=unmanifested-file&chunk=0",
        { headers: { "x-vault-auth": authToken } },
      ),
    });
    expect(unmanifested.status).toBe(404);
    await expect(unmanifested.json()).resolves.toEqual({
      error: "File chunk not found.",
    });
  });

  it("rotates the password and retires the old credentials", async () => {
    const replacementToken =
      "replacement-auth-token-with-more-than-32-characters";
    const rotated = await rotateVault({
      env: testEnv,
      request: postRequest(
        "/api/vault/rotate",
        {
          payload: {
            ...payload,
            version: 3,
            ciphertext: "bmV3LWNpcGhlcnRleHQtMTYtYnl0ZXM=",
          },
          expectedRevision: 1,
          newAuthToken: replacementToken,
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(rotated.status).toBe(200);
    await expect(rotated.json()).resolves.toMatchObject({ revision: 2 });

    const oldCredentials = await loadVault({
      env: testEnv,
      request: new Request("https://vault.test/api/vault/load", {
        headers: { "x-vault-auth": authToken },
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
  });

  it("rate limits repeated authentication failures", async () => {
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
