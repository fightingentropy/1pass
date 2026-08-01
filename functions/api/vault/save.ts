import { isVaultEncryptedPayload } from "./schema";
import {
  DEFAULT_VAULT_ID,
  VAULT_AUTH_HEADER,
  VAULT_HISTORY_LIMIT,
  checkVaultAuth,
  ensureVaultTable,
  ensureVaultHistoryTable,
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
        "Vault payload too large. Remove some attachments' thumbnails or notes.",
        413,
        env,
      );
    }

    const existing = await db
      .prepare("SELECT auth_hash, revision FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first<{ auth_hash: string | null; revision: number }>();

    if (!existing) {
      return errorResponse("Vault not initialized.", 404, env);
    }
    if (existing.revision !== expectedRevision) {
      return errorResponse(
        "Vault changed in another tab or device. Reload before saving again.",
        409,
        env,
      );
    }

    // A vault that predates the auth scheme registers the client's token on
    // its first save; from then on every mutation requires it.
    const incomingToken = request.headers.get(VAULT_AUTH_HEADER) ?? "";
    const nextAuthHash =
      !existing.auth_hash && incomingToken && incomingToken.length <= 256
        ? await sha256Hex(incomingToken)
        : existing.auth_hash;

    const savedAt = Date.now();
    const nextRevision = expectedRevision + 1;
    await ensureVaultHistoryTable(db);
    const results = await db.batch([
      db
        .prepare(
          "INSERT INTO vault_history (vault_id, payload, saved_at) SELECT id, payload, ?1 FROM vaults WHERE id = ?2 AND revision = ?3",
        )
        .bind(savedAt, DEFAULT_VAULT_ID, expectedRevision),
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
