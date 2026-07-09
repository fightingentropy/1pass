import {
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
  MAX_FILE_CHUNK_INDEX,
  MAX_FILE_CHUNK_JSON_BYTES,
  optionsResponse,
} from "../shared";
import type { Env } from "../shared";

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
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const chunkParam = url.searchParams.get("chunk") ?? "0";
    const chunkIndex = Number(chunkParam);

    if (!isValidFileId(id)) {
      return errorResponse("Invalid file id.", 400, env);
    }
    if (
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0 ||
      chunkIndex > MAX_FILE_CHUNK_INDEX
    ) {
      return errorResponse("Invalid chunk index.", 400, env);
    }

    const db = getDb(env);
    await ensureVaultTable(db);

    const authFailure = await checkVaultAuth(request, db, env);
    if (authFailure) return authFailure;

    const bucket = getFileBucket(env);
    const key = fileChunkKey(id, chunkIndex);
    const object = await bucket.get(key);
    if (object) {
      if (object.size > MAX_FILE_CHUNK_JSON_BYTES) {
        return errorResponse("File data is corrupted.", 500, env);
      }
      try {
        return jsonResponse({ payload: JSON.parse(await object.text()) }, env);
      } catch (parseError) {
        logError("R2 vault file chunk parse failed", parseError);
        return errorResponse("File data is corrupted.", 500, env);
      }
    }

    // Legacy deployments stored chunks in D1. Read them until first access,
    // then copy to R2 and remove the row only after the object write succeeds.
    await ensureVaultFilesTable(db);
    const row = await db
      .prepare(
        "SELECT payload FROM vault_files WHERE id = ?1 AND chunk_index = ?2",
      )
      .bind(id, chunkIndex)
      .first<{ payload: string }>();

    if (!row?.payload) {
      return errorResponse("File chunk not found.", 404, env);
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(row.payload);
    } catch (parseError) {
      logError("Vault file chunk parse failed", parseError);
      return errorResponse("File data is corrupted.", 500, env);
    }

    try {
      await bucket.put(key, row.payload, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { fileId: id, chunkIndex: String(chunkIndex) },
      });
      await db
        .prepare("DELETE FROM vault_files WHERE id = ?1 AND chunk_index = ?2")
        .bind(id, chunkIndex)
        .run();
    } catch (migrationError) {
      logError("Legacy vault file migration to R2 failed", migrationError);
    }

    return jsonResponse({ payload }, env);
  } catch (error) {
    logError("Vault file load failed", error);
    return errorResponse("Unable to load the file chunk.", 500, env);
  }
}
