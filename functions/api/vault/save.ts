import {
  DEFAULT_VAULT_ID,
  ensureVaultTable,
  errorResponse,
  getDb,
  jsonResponse,
  optionsResponse,
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

    const db = getDb(env);
    await ensureVaultTable(db);
    const existing = await db
      .prepare("SELECT id FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first();

    if (!existing) {
      return errorResponse("Vault not initialized.", 404, env);
    }

    await db
      .prepare("UPDATE vaults SET payload = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(JSON.stringify(body.payload), Date.now(), DEFAULT_VAULT_ID)
      .run();

    return jsonResponse({ ok: true }, env);
  } catch (error) {
    console.error("Vault save error", error);
    return errorResponse("Unable to save vault.", 500, env);
  }
}
