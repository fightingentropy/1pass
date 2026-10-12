import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { onRequestGet as loadVault } from "../functions/api/vault/load";
import { onRequestPost as saveVault } from "../functions/api/vault/save";
import type { VaultEncryptedPayload } from "../functions/api/vault/schema";
import type { Env } from "../functions/api/vault/shared";

const testEnv = env as Env;
const authToken = "auth-token-with-more-than-thirty-two-characters";
const bootstrapSecret = "test-bootstrap-secret";
const payload: VaultEncryptedPayload = {
  version: 3,
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

function load(headers: Record<string, string>) {
  return loadVault({
    env: testEnv,
    request: new Request("https://vault.test/api/vault/load", { headers }),
  });
}

async function storedAuthHash() {
  const row = await testEnv.DB.prepare(
    "SELECT auth_hash FROM vaults WHERE id = 'default'",
  ).first<{ auth_hash: string | null }>();
  if (!row) throw new Error("Vault row is missing.");
  return row.auth_hash;
}

// A vault row without an auth hash can only come from damage or a write that
// bypassed init. It must fail closed: the bootstrap secret gates creating a
// vault, never reading or adopting an existing one.
describe("vault without a stored auth hash", () => {
  it("rejects load and save even with the bootstrap secret", async () => {
    await testEnv.DB.prepare(
      "INSERT INTO vaults (id, payload, updated_at, auth_hash, revision, envelope_version, kdf_json) VALUES ('default', ?1, ?2, NULL, 0, ?3, ?4)",
    )
      .bind(
        JSON.stringify(payload),
        Date.now(),
        payload.version,
        JSON.stringify(payload.kdf),
      )
      .run();

    const bootstrapOnly = await load({ "x-vault-bootstrap": bootstrapSecret });
    expect(bootstrapOnly.status).toBe(401);
    await expect(bootstrapOnly.json()).resolves.toEqual({
      error: "Unauthorized.",
    });

    const bootstrapAndToken = await load({
      "x-vault-bootstrap": bootstrapSecret,
      "x-vault-auth": authToken,
    });
    expect(bootstrapAndToken.status).toBe(401);

    // A save no longer registers the caller's token as the vault credential.
    const adopted = await saveVault({
      env: testEnv,
      request: new Request("https://vault.test/api/vault/save", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vault-bootstrap": bootstrapSecret,
          "x-vault-auth": authToken,
        },
        body: JSON.stringify({ payload, expectedRevision: 0 }),
      }),
    });
    expect(adopted.status).toBe(401);
    await expect(storedAuthHash()).resolves.toBeNull();
  });

  it("treats an empty stored auth hash the same way", async () => {
    await testEnv.DB.prepare(
      "UPDATE vaults SET auth_hash = '' WHERE id = 'default'",
    ).run();

    const bootstrapOnly = await load({ "x-vault-bootstrap": bootstrapSecret });
    expect(bootstrapOnly.status).toBe(401);

    const bootstrapAndToken = await load({
      "x-vault-bootstrap": bootstrapSecret,
      "x-vault-auth": authToken,
    });
    expect(bootstrapAndToken.status).toBe(401);
    await expect(storedAuthHash()).resolves.toBe("");
  });
});
