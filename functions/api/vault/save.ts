import { isVaultEncryptedPayload } from "./schema";
import {
  DEFAULT_VAULT_ID,
  VAULT_HISTORY_LIMIT,
  authorizeVaultRequest,
  errorResponse,
  getDb,
  jsonResponse,
  logError,
  optionsResponse,
  readBoundedJson,
} from "./shared";
import type { Env } from "./shared";

export function onRequestOptions({ env }: { env: Env }) {
  return optionsResponse(env);
}

export async function onRequestPost({
  request,
  env,
}: {
  request: Request;
  env: Env;
}) {
  try {
    const db = getDb(env);
    // One read serves both the credential check and the revision compare. The
    // body is only consumed once the caller has proven it may write.
    const existing = await db
      .prepare("SELECT auth_hash, revision FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first<{ auth_hash: string | null; revision: number }>();
    if (!existing) {
      return errorResponse("Vault not initialized.", 404, env);
    }
    const authFailure = await authorizeVaultRequest(
      request,
      env,
      existing.auth_hash,
    );
    if (authFailure) return authFailure;

    const parsedBody = await readBoundedJson(request, 1_950_000);
    if (!parsedBody.ok) {
      return errorResponse(parsedBody.error, parsedBody.status, env);
    }
    const body = parsedBody.value;
    const payload =
      body && typeof body === "object" && "payload" in body
        ? body.payload
        : null;
    const expectedRevision =
      body && typeof body === "object" && "expectedRevision" in body
        ? body.expectedRevision
        : null;
    if (!isVaultEncryptedPayload(payload)) {
      return errorResponse("Invalid payload.", 400, env);
    }
    if (
      typeof expectedRevision !== "number" ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      return errorResponse("Invalid vault revision.", 400, env);
    }

    // D1 rejects values over 2MB with an opaque error; fail clearly instead.
    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 1_900_000) {
      return errorResponse(
        "Vault payload too large.",
        413,
        env,
      );
    }

    if (existing.revision !== expectedRevision) {
      return errorResponse(
        "Vault changed in another tab or device. Reload before saving again.",
        409,
        env,
      );
    }

    const savedAt = Date.now();
    const nextRevision = expectedRevision + 1;
    const results = await db.batch([
      db
        .prepare(
          "INSERT INTO vault_history (vault_id, payload, saved_at) SELECT id, payload, ?1 FROM vaults WHERE id = ?2 AND revision = ?3",
        )
        .bind(savedAt, DEFAULT_VAULT_ID, expectedRevision),
      db
        .prepare(
          "UPDATE vaults SET payload = ?1, updated_at = ?2, auth_hash = ?3, revision = ?4, envelope_version = ?7, kdf_json = ?8 WHERE id = ?5 AND revision = ?6",
        )
        .bind(
          payloadJson,
          savedAt,
          existing.auth_hash,
          nextRevision,
          DEFAULT_VAULT_ID,
          expectedRevision,
          payload.version,
          JSON.stringify(payload.kdf),
        ),
      db
        .prepare(
          "DELETE FROM vault_history WHERE vault_id = ?1 AND rowid NOT IN (SELECT rowid FROM vault_history WHERE vault_id = ?1 ORDER BY saved_at DESC, rowid DESC LIMIT ?2)",
        )
        .bind(DEFAULT_VAULT_ID, VAULT_HISTORY_LIMIT),
    ]);

    if (results[1]?.meta.changes !== 1) {
      return errorResponse(
        "Vault changed in another tab or device. Reload before saving again.",
        409,
        env,
      );
    }

    return jsonResponse({ ok: true, revision: nextRevision }, env);
  } catch (error) {
    logError("Vault save failed", error);
    return errorResponse("Unable to save vault.", 500, env);
  }
}
