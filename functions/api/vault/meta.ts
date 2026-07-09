import { isVaultEncryptedPayload } from "./schema";
import {
  DEFAULT_VAULT_ID,
  ensureVaultTable,
  errorResponse,
  getDb,
  jsonResponse,
  logError,
  optionsResponse,
} from "./shared";
import type { Env } from "./shared";

export function onRequestOptions({ env }: { env: Env }) {
  return optionsResponse(env);
}

// Public endpoint: exposes only the KDF parameters (salt, iterations) so the
// client can derive its keys and auth token before making authenticated
// calls. Salts are not secret; the ciphertext itself stays behind auth.
export async function onRequestGet({ env }: { env: Env }) {
  try {
    const db = getDb(env);
    await ensureVaultTable(db);
    const row = await db
      .prepare("SELECT payload, auth_hash FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first<{ payload: string; auth_hash: string | null }>();

    if (!row?.payload) {
      return jsonResponse({ exists: false, requiresBootstrap: true }, env);
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      return errorResponse("Vault data is corrupted.", 500, env);
    }

    if (isVaultEncryptedPayload(payload)) {
      return jsonResponse(
        {
          exists: true,
          requiresBootstrap: !row.auth_hash,
          version: payload.version,
          kdf: payload.kdf,
        },
        env,
      );
    }

    // Legacy plaintext vault from before client-side encryption existed.
    return jsonResponse(
      { exists: true, requiresBootstrap: !row.auth_hash, version: 0 },
      env,
    );
  } catch (error) {
    logError("Vault metadata read failed", error);
    return errorResponse("Unable to read vault metadata.", 500, env);
  }
}
