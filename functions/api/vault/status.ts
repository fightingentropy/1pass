import { DEFAULT_VAULT_ID, errorResponse, getDb, jsonResponse } from "./shared";
import type { Env } from "./shared";

export async function onRequestGet({ env }: { env: Env }) {
  try {
    const db = getDb(env);
    const row = await db
      .prepare("SELECT id FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first();

    return jsonResponse({ exists: Boolean(row) });
  } catch (error) {
    console.error("Vault status error", error);
    return errorResponse("Unable to check vault status.", 500);
  }
}
