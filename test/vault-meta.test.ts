import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { onRequestPost as initializeVault } from "../functions/api/vault/init";
import { onRequestGet as readMeta } from "../functions/api/vault/meta";
import { onRequestPost as rotateVault } from "../functions/api/vault/rotate";
import { onRequestPost as saveVault } from "../functions/api/vault/save";
import type { VaultEncryptedPayload } from "../functions/api/vault/schema";
import type { Env } from "../functions/api/vault/shared";

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
// A vault from before client-side encryption existed: no envelope, no version.
const legacyPlaintextPayload = '{"identities":[],"apiKeys":[]}';

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

async function initializeTestVault() {
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
}

async function fetchMeta() {
  const response = await readMeta({ env: testEnv });
  expect(response.status).toBe(200);
  return response.json();
}

// The stored meta columns, with kdf_json parsed so comparisons do not depend
// on how the JSON text was serialized.
async function readMetaColumns() {
  const row = await testEnv.DB.prepare(
    "SELECT envelope_version, kdf_json FROM vaults WHERE id = 'default'",
  ).first<{ envelope_version: number | null; kdf_json: string | null }>();
  if (!row) throw new Error("Vault row is missing.");
  return {
    envelopeVersion: row.envelope_version,
    kdf: row.kdf_json === null ? null : (JSON.parse(row.kdf_json) as unknown),
  };
}

function clearMetaColumns() {
  return testEnv.DB.prepare(
    "UPDATE vaults SET envelope_version = NULL, kdf_json = NULL WHERE id = 'default'",
  ).run();
}

describe("GET /api/vault/meta", () => {
  // Tests in this file share one D1 database, so each starts from an empty
  // vault table.
  beforeEach(async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare("DELETE FROM vaults"),
      testEnv.DB.prepare("DELETE FROM vault_history"),
    ]);
  });

  it("reports that no vault exists before initialization", async () => {
    await expect(fetchMeta()).resolves.toStrictEqual({ exists: false });
  });

  it("serves the version and KDF from the meta columns after init", async () => {
    await initializeTestVault();
    await expect(fetchMeta()).resolves.toStrictEqual({
      exists: true,
      version: 2,
      kdf: payload.kdf,
    });
    await expect(readMetaColumns()).resolves.toEqual({
      envelopeVersion: 2,
      kdf: payload.kdf,
    });
  });

  it("reflects a new salt after a save", async () => {
    await initializeTestVault();
    const kdf = { ...payload.kdf, salt: "AQEBAQEBAQEBAQEBAQEBAQ==" };
    const saved = await saveVault({
      env: testEnv,
      request: postRequest(
        "/api/vault/save",
        { payload: { ...payload, kdf }, expectedRevision: 0 },
        { "x-vault-auth": authToken },
      ),
    });
    expect(saved.status).toBe(200);
    await expect(fetchMeta()).resolves.toStrictEqual({
      exists: true,
      version: 2,
      kdf,
    });
    await expect(readMetaColumns()).resolves.toEqual({
      envelopeVersion: 2,
      kdf,
    });
  });

  it("reflects the new envelope version after a password rotation", async () => {
    await initializeTestVault();
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
          expectedRevision: 0,
          newAuthToken: "replacement-auth-token-with-more-than-32-characters",
        },
        { "x-vault-auth": authToken },
      ),
    });
    expect(rotated.status).toBe(200);
    await expect(fetchMeta()).resolves.toStrictEqual({
      exists: true,
      version: 3,
      kdf: payload.kdf,
    });
    await expect(readMetaColumns()).resolves.toEqual({
      envelopeVersion: 3,
      kdf: payload.kdf,
    });
  });

  it("never parses the payload while the meta columns are populated", async () => {
    await initializeTestVault();
    await testEnv.DB.prepare(
      "UPDATE vaults SET payload = 'not json' WHERE id = 'default'",
    ).run();
    await expect(fetchMeta()).resolves.toStrictEqual({
      exists: true,
      version: 2,
      kdf: payload.kdf,
    });

    // Only the payload fallback parses the envelope, so only it can notice
    // that the stored payload is unreadable.
    await clearMetaColumns();
    const corrupted = await readMeta({ env: testEnv });
    expect(corrupted.status).toBe(500);
    await expect(corrupted.json()).resolves.toStrictEqual({
      error: "Vault data is corrupted.",
    });
  });

  it("falls back to the payload when the meta columns are NULL", async () => {
    await initializeTestVault();
    await clearMetaColumns();
    await expect(fetchMeta()).resolves.toStrictEqual({
      exists: true,
      version: 2,
      kdf: payload.kdf,
    });
  });

  it("reports a legacy plaintext vault as corrupted", async () => {
    await initializeTestVault();
    await testEnv.DB.prepare(
      "UPDATE vaults SET payload = ?1, envelope_version = NULL, kdf_json = NULL, auth_hash = NULL WHERE id = 'default'",
    )
      .bind(legacyPlaintextPayload)
      .run();
    const response = await readMeta({ env: testEnv });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toStrictEqual({
      error: "Vault data is corrupted.",
    });
  });

  it("backfills the meta columns from encrypted envelopes only", async () => {
    const backfill = testEnv.TEST_MIGRATIONS.find(
      (migration) => migration.name === "0005_vault_meta_columns.sql",
    )?.queries.find((query) => /^\s*UPDATE\b/i.test(query));
    if (!backfill) throw new Error("Migration 0005 has no backfill statement.");

    await initializeTestVault();
    await clearMetaColumns();
    await testEnv.DB.prepare(backfill).run();
    await expect(readMetaColumns()).resolves.toEqual({
      envelopeVersion: 2,
      kdf: payload.kdf,
    });

    await testEnv.DB.prepare(
      "UPDATE vaults SET payload = ?1, envelope_version = NULL, kdf_json = NULL WHERE id = 'default'",
    )
      .bind(legacyPlaintextPayload)
      .run();
    await testEnv.DB.prepare(backfill).run();
    await expect(readMetaColumns()).resolves.toEqual({
      envelopeVersion: null,
      kdf: null,
    });
  });
});
