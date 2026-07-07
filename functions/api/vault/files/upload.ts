import {
  DEFAULT_VAULT_ID,
  checkVaultAuth,
  ensureVaultFilesTable,
  ensureVaultTable,
  errorResponse,
  getDb,
  isValidFileId,
  jsonResponse,
  optionsResponse,
} from "../shared";
import type { Env } from "../shared";

// Each chunk row must stay under D1's 2MB per-value limit. A 1MB raw chunk
// base64-encodes to ~1.34MB, so 1.6M chars leaves comfortable headroom.
const MAX_CHUNK_CIPHERTEXT_LENGTH = 1_600_000;
const MAX_CHUNK_INDEX = 63;

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
    const id = body?.id;
    const chunkIndex = body?.chunkIndex;
    const payload = body?.payload;

    if (!isValidFileId(id)) {
      return errorResponse("Invalid file id.", 400, env);
    }
    if (
      typeof chunkIndex !== "number" ||
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0 ||
      chunkIndex > MAX_CHUNK_INDEX
    ) {
      return errorResponse("Invalid chunk index.", 400, env);
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.iv !== "string" ||
      payload.iv.length === 0 ||
      payload.iv.length > 64 ||
      typeof payload.ciphertext !== "string" ||
      payload.ciphertext.length === 0 ||
      payload.ciphertext.length > MAX_CHUNK_CIPHERTEXT_LENGTH
    ) {
      return errorResponse("Invalid chunk payload.", 400, env);
    }

    const db = getDb(env);
    await ensureVaultTable(db);

    const authFailure = await checkVaultAuth(request, db, env);
    if (authFailure) return authFailure;

    const vault = await db
      .prepare("SELECT id FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first();
    if (!vault) {
      return errorResponse("Vault not initialized.", 404, env);
    }

    await ensureVaultFilesTable(db);
    await db
      .prepare(
        "INSERT OR REPLACE INTO vault_files (id, chunk_index, payload, created_at) VALUES (?1, ?2, ?3, ?4)",
      )
      .bind(
        id,
        chunkIndex,
        JSON.stringify({ iv: payload.iv, ciphertext: payload.ciphertext }),
        Date.now(),
      )
      .run();

    return jsonResponse({ ok: true }, env);
  } catch (error) {
    console.error("Vault file upload error", error);
    return errorResponse("Unable to store the file chunk.", 500, env);
  }
}
