import {
  DEFAULT_VAULT_ID,
  VAULT_AUTH_HEADER,
  ensureVaultTable,
  errorResponse,
  getDb,
  jsonResponse,
  optionsResponse,
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
      return errorResponse("Vault payload too large.", 413, env);
    }

    const authToken = request.headers.get(VAULT_AUTH_HEADER) ?? "";
    if (!authToken || authToken.length > 256) {
      return errorResponse("Missing auth token.", 400, env);
    }

    const db = getDb(env);
    await ensureVaultTable(db);
    const existing = await db
      .prepare("SELECT id FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first();

    if (existing) {
      return errorResponse("Vault already exists.", 409, env);
    }

    await db
      .prepare(
        "INSERT INTO vaults (id, payload, updated_at, auth_hash) VALUES (?1, ?2, ?3, ?4)",
      )
      .bind(
        DEFAULT_VAULT_ID,
        payloadJson,
        Date.now(),
        await sha256Hex(authToken),
      )
      .run();

    return jsonResponse({ ok: true }, env);
  } catch (error) {
    console.error("Vault init error", error);
    return errorResponse("Unable to initialize vault.", 500, env);
  }
}
