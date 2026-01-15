import { DEFAULT_VAULT_ID, errorResponse, getDb, jsonResponse } from "./shared";
import type { Env } from "./shared";

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.payload !== "object" || body.payload === null) {
      return errorResponse("Invalid payload.", 400);
    }

    const db = getDb(env);
    const existing = await db
      .prepare("SELECT id FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first();

    if (existing) {
      return errorResponse("Vault already exists.", 409);
    }

    await db
      .prepare(
        "INSERT INTO vaults (id, payload, updated_at) VALUES (?1, ?2, ?3)",
      )
      .bind(DEFAULT_VAULT_ID, JSON.stringify(body.payload), Date.now())
      .run();

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Vault init error", error);
    return errorResponse("Unable to initialize vault.", 500);
  }
}
