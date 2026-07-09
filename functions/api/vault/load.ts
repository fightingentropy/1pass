import {
  DEFAULT_VAULT_ID,
  checkVaultAuth,
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

export async function onRequestGet({
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

    const row = await db
      .prepare("SELECT payload, revision FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first<{ payload: string; revision: number }>();

    if (!row?.payload) {
      return errorResponse("Vault not initialized.", 404, env);
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(row.payload);
    } catch (parseError) {
      logError("Vault payload parse failed", parseError);
      return errorResponse("Vault data is corrupted.", 500, env);
    }

    return jsonResponse({ payload, revision: row.revision }, env);
  } catch (error) {
    logError("Vault load failed", error);
    return errorResponse("Unable to load vault.", 500, env);
  }
}
