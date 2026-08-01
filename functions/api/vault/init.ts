import { isVaultEncryptedPayload } from "./schema";
import {
  DEFAULT_VAULT_ID,
  VAULT_AUTH_HEADER,
  checkBootstrapSecret,
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
    const bootstrapFailure = await checkBootstrapSecret(request, env);
    if (bootstrapFailure) return bootstrapFailure;

    const authToken = request.headers.get(VAULT_AUTH_HEADER) ?? "";
    if (authToken.length < 32 || authToken.length > 256) {
      return errorResponse("Missing or invalid auth token.", 400, env);
    }

    const parsedBody = await readBoundedJson(request, 1_950_000);
    if (!parsedBody.ok) {
      return errorResponse(parsedBody.error, parsedBody.status, env);
    }
    const body = parsedBody.value;
    const payload =
      body && typeof body === "object" && "payload" in body
        ? body.payload
        : null;
    if (!isVaultEncryptedPayload(payload) || payload.version < 2) {
      return errorResponse("Invalid payload.", 400, env);
    }

    // D1 rejects values over 2MB with an opaque error; fail clearly instead.
    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 1_900_000) {
      return errorResponse("Vault payload too large.", 413, env);
    }

    const db = getDb(env);
    await ensureVaultTable(db);
    const inserted = await db
      .prepare(
        "INSERT OR IGNORE INTO vaults (id, payload, updated_at, auth_hash, revision) VALUES (?1, ?2, ?3, ?4, 0)",
      )
      .bind(
        DEFAULT_VAULT_ID,
        payloadJson,
        Date.now(),
        await sha256Hex(authToken),
      )
      .run();

    if (inserted.meta.changes !== 1) {
      return errorResponse("Vault already exists.", 409, env);
    }

    return jsonResponse({ ok: true, revision: 0 }, env);
  } catch (error) {
    logError("Vault init failed", error);
    return errorResponse("Unable to initialize vault.", 500, env);
  }
}
