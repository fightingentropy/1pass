import { isValidVaultKdf, isVaultEncryptedPayload } from "./schema";
import {
  DEFAULT_VAULT_ID,
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

type VaultMetaRow = {
  envelope_version: number | null;
  kdf_json: string | null;
};

// Public endpoint: exposes only the KDF parameters (salt, iterations) so the
// client can derive its keys and auth token before making authenticated
// calls. Salts are not secret; the ciphertext itself stays behind auth.
//
// Because this runs unauthenticated on every page load, it answers from the
// envelope_version and kdf_json columns (migration 0005) and never loads or
// parses the encrypted payload, which can approach 2 MB.
export async function onRequestGet({ env }: { env: Env }) {
  try {
    const db = getDb(env);
    const row = await db
      .prepare("SELECT envelope_version, kdf_json FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first<VaultMetaRow>();

    if (!row) {
      return jsonResponse({ exists: false }, env);
    }

    const kdf = parseStoredKdf(row.kdf_json);
    if (typeof row.envelope_version === "number" && kdf) {
      return jsonResponse(
        { exists: true, version: row.envelope_version, kdf },
        env,
      );
    }

    return metaFromPayload(db, env);
  } catch (error) {
    logError("Vault metadata read failed", error);
    return errorResponse("Unable to read vault metadata.", 500, env);
  }
}

// kdf_json mirrors an envelope that was validated before it was stored, so
// anything that does not parse to a valid KDF is treated as absent and the
// payload remains the source of truth.
function parseStoredKdf(kdfJson: string | null) {
  if (kdfJson === null) return null;
  let kdf: unknown;
  try {
    kdf = JSON.parse(kdfJson);
  } catch {
    return null;
  }
  return isValidVaultKdf(kdf) ? kdf : null;
}

// A row inserted by a deployment that predates the meta columns (between
// applying migration 0005 and deploying the code that fills them) has NULL
// meta columns; its metadata is read from the encrypted envelope instead.
// Anything other than an encrypted envelope (including a pre-encryption
// plaintext vault, which is no longer supported) is reported as corrupted.
async function metaFromPayload(db: Env["DB"], env: Env) {
  const row = await db
    .prepare("SELECT payload FROM vaults WHERE id = ?1")
    .bind(DEFAULT_VAULT_ID)
    .first<{ payload: string }>();

  if (!row?.payload) {
    return jsonResponse({ exists: false }, env);
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return errorResponse("Vault data is corrupted.", 500, env);
  }

  if (!isVaultEncryptedPayload(payload)) {
    return errorResponse("Vault data is corrupted.", 500, env);
  }

  return jsonResponse(
    { exists: true, version: payload.version, kdf: payload.kdf },
    env,
  );
}
