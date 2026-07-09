import {
  DEFAULT_VAULT_ID,
  MAX_FILE_CHUNK_INDEX,
  MAX_FILE_CHUNK_JSON_BYTES,
  checkVaultAuth,
  ensureVaultFilesTable,
  ensureVaultTable,
  errorResponse,
  fileChunkKey,
  getFileBucket,
  getDb,
  isValidFileId,
  jsonResponse,
  logError,
  optionsResponse,
} from "../shared";
import type { Env } from "../shared";

// A 1MB raw chunk base64-encodes to ~1.34MB. Keep a hard request limit even
// though R2 can hold much larger objects, so the Worker never buffers an
// unexpectedly large JSON body.
const MAX_CHUNK_CIPHERTEXT_LENGTH = 1_600_000;

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
    const body: unknown = await request.json().catch(() => null);
    const id = body && typeof body === "object" && "id" in body ? body.id : null;
    const chunkIndex =
      body && typeof body === "object" && "chunkIndex" in body
        ? body.chunkIndex
        : null;
    const payload =
      body && typeof body === "object" && "payload" in body
        ? body.payload
        : null;
    const payloadIv =
      payload && typeof payload === "object" && "iv" in payload
        ? payload.iv
        : null;
    const payloadCiphertext =
      payload && typeof payload === "object" && "ciphertext" in payload
        ? payload.ciphertext
        : null;

    if (!isValidFileId(id)) {
      return errorResponse("Invalid file id.", 400, env);
    }
    if (
      typeof chunkIndex !== "number" ||
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0 ||
      chunkIndex > MAX_FILE_CHUNK_INDEX
    ) {
      return errorResponse("Invalid chunk index.", 400, env);
    }
    if (
      typeof payloadIv !== "string" ||
      payloadIv.length === 0 ||
      payloadIv.length > 64 ||
      typeof payloadCiphertext !== "string" ||
      payloadCiphertext.length === 0 ||
      payloadCiphertext.length > MAX_CHUNK_CIPHERTEXT_LENGTH
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

    const serialized = JSON.stringify({
      iv: payloadIv,
      ciphertext: payloadCiphertext,
    });
    if (new TextEncoder().encode(serialized).byteLength > MAX_FILE_CHUNK_JSON_BYTES) {
      return errorResponse("File chunk is too large.", 413, env);
    }

    await getFileBucket(env).put(fileChunkKey(id, chunkIndex), serialized, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { fileId: id, chunkIndex: String(chunkIndex) },
    });

    // A successful R2 write supersedes a legacy D1 copy. Cleanup is awaited so
    // failures are visible, while duplicate encrypted copies remain harmless.
    await ensureVaultFilesTable(db);
    await db
      .prepare("DELETE FROM vault_files WHERE id = ?1 AND chunk_index = ?2")
      .bind(id, chunkIndex)
      .run();

    return jsonResponse({ ok: true }, env);
  } catch (error) {
    logError("Vault file upload failed", error);
    return errorResponse("Unable to store the file chunk.", 500, env);
  }
}
