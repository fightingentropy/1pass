import { isVaultEncryptedPayload } from "./schema";
import {
  DEFAULT_VAULT_ID,
  checkVaultAuth,
  ensureVaultHistoryTable,
  ensureVaultTable,
  errorResponse,
  getDb,
  jsonResponse,
  logError,
  optionsResponse,
  readBoundedJson,
  sha256Hex,
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
    await ensureVaultTable(db);
    const authFailure = await checkVaultAuth(request, db, env);
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
    const newAuthToken =
      body && typeof body === "object" && "newAuthToken" in body
        ? body.newAuthToken
        : null;

    if (!isVaultEncryptedPayload(payload) || payload.version < 2) {
      return errorResponse("Invalid payload.", 400, env);
    }
    if (
      typeof expectedRevision !== "number" ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      return errorResponse("Invalid vault revision.", 400, env);
    }
    if (
      typeof newAuthToken !== "string" ||
      newAuthToken.length < 32 ||
      newAuthToken.length > 256
    ) {
      return errorResponse("Invalid replacement auth token.", 400, env);
    }

    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 1_900_000) {
      return errorResponse("Vault payload too large.", 413, env);
    }

    const existing = await db
      .prepare("SELECT revision FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first<{ revision: number }>();
    if (!existing) {
      return errorResponse("Vault not initialized.", 404, env);
    }
    if (existing.revision !== expectedRevision) {
      return errorResponse(
        "Vault changed in another tab or device. Reload before changing the password.",
        409,
        env,
      );
    }

    const savedAt = Date.now();
    const nextRevision = expectedRevision + 1;
    const nextAuthHash = await sha256Hex(newAuthToken);
    await ensureVaultHistoryTable(db);
    // Do not retain snapshots encrypted with the old password. Rotation swaps
    // the live envelope and clears old-key history in one D1 transaction.
    const results = await db.batch([
      db
        .prepare(
          "UPDATE vaults SET payload = ?1, updated_at = ?2, auth_hash = ?3, revision = ?4 WHERE id = ?5 AND revision = ?6",
        )
        .bind(
          payloadJson,
          savedAt,
          nextAuthHash,
          nextRevision,
          DEFAULT_VAULT_ID,
          expectedRevision,
        ),
      db
        .prepare("DELETE FROM vault_history WHERE vault_id = ?1")
        .bind(DEFAULT_VAULT_ID),
    ]);

    if (results[0]?.meta.changes !== 1) {
      return errorResponse(
        "Vault changed in another tab or device. Reload before changing the password.",
        409,
        env,
      );
    }

    return jsonResponse({ ok: true, revision: nextRevision }, env);
  } catch (error) {
    logError("Vault password rotation failed", error);
    return errorResponse("Unable to change the master password.", 500, env);
  }
}
