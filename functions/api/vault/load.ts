import { DEFAULT_VAULT_ID, errorResponse, getDb, jsonResponse } from "./shared";
import type { Env } from "./shared";

export async function onRequestGet({ env }: { env: Env }) {
  try {
    const db = getDb(env);
    const row = await db
      .prepare("SELECT payload FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first<{ payload: string }>();

    if (!row?.payload) {
      return errorResponse("Vault not initialized.", 404);
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(row.payload);
    } catch (parseError) {
      console.error("Vault payload parse error", parseError);
      return errorResponse("Vault data is corrupted.", 500);
    }

    return jsonResponse({ payload });
  } catch (error) {
    console.error("Vault load error", error);
    return errorResponse("Unable to load vault.", 500);
  }
}
