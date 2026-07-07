import {
  DEFAULT_VAULT_ID,
  VAULT_AUTH_HEADER,
  checkVaultAuth,
  ensureVaultTable,
  errorResponse,
  getDb,
  jsonResponse,
  optionsResponse,
  recordVaultHistory,
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
    const body = await request.json().catch(() => null);
    if (!body || typeof body.payload !== "object" || body.payload === null) {
      return errorResponse("Invalid payload.", 400, env);
    }

    // D1 rejects values over 2MB with an opaque error; fail clearly instead.
    const payloadJson = JSON.stringify(body.payload);
    if (payloadJson.length > 1_900_000) {
      return errorResponse(
        "Vault payload too large. Remove some attachments' thumbnails or notes.",
        413,
        env,
      );
    }

    const db = getDb(env);
    await ensureVaultTable(db);

    const authFailure = await checkVaultAuth(request, db, env);
    if (authFailure) return authFailure;

    const existing = await db
      .prepare("SELECT payload, auth_hash FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first<{ payload: string; auth_hash: string | null }>();

    if (!existing) {
      return errorResponse("Vault not initialized.", 404, env);
    }

    // Keep the previous payload as a restore point before overwriting.
    try {
      await recordVaultHistory(db, existing.payload);
    } catch (historyError) {
      console.error("Vault history error", historyError);
    }

    // A vault that predates the auth scheme registers the client's token on
    // its first save; from then on every mutation requires it.
    const incomingToken = request.headers.get(VAULT_AUTH_HEADER) ?? "";
    const nextAuthHash =
      !existing.auth_hash && incomingToken && incomingToken.length <= 256
        ? await sha256Hex(incomingToken)
        : existing.auth_hash;

    await db
      .prepare(
        "UPDATE vaults SET payload = ?1, updated_at = ?2, auth_hash = ?3 WHERE id = ?4",
      )
      .bind(payloadJson, Date.now(), nextAuthHash, DEFAULT_VAULT_ID)
      .run();

    return jsonResponse({ ok: true }, env);
  } catch (error) {
    console.error("Vault save error", error);
    return errorResponse("Unable to save vault.", 500, env);
  }
}
