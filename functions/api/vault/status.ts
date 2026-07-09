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

export async function onRequestGet({ env }: { env: Env }) {
  try {
    const db = getDb(env);
    await ensureVaultTable(db);
    const row = await db
      .prepare("SELECT id FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first();

    return jsonResponse({ exists: Boolean(row) }, env);
  } catch (error) {
    logError("Vault status check failed", error);
    return errorResponse("Unable to check vault status.", 500, env);
  }
}
