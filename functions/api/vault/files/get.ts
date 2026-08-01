import {
  DEFAULT_VAULT_ID,
  checkVaultAuth,
  ensureVaultFileUploadTables,
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
  sha256Hex,
  stagedChunkKey,
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
    await ensureVaultFileUploadTables(db);
    const committed = await db
      .prepare(
        "SELECT vault_file_manifests.upload_id, vault_file_manifests.deleted_at, vault_file_uploads.total_chunks FROM vault_file_manifests LEFT JOIN vault_file_uploads ON vault_file_uploads.upload_id = vault_file_manifests.upload_id WHERE vault_file_manifests.vault_id = ?1 AND vault_file_manifests.file_id = ?2",
      )
      .bind(DEFAULT_VAULT_ID, id)
      .first<{
        upload_id: string;
        deleted_at: number | null;
        total_chunks: number | null;
      }>();
    if (committed) {
      if (committed.deleted_at !== null) {
        return errorResponse("File chunk not found.", 404, env);
      }
      if (committed.total_chunks === null) {
        return errorResponse("File data is corrupted.", 500, env);
      }
      if (chunkIndex >= committed.total_chunks) {
        return errorResponse("File chunk not found.", 404, env);
      }
      const chunk = await db
        .prepare(
          "SELECT chunk_hash FROM vault_file_upload_chunks WHERE upload_id = ?1 AND chunk_index = ?2",
        )
        .bind(committed.upload_id, chunkIndex)
        .first<{ chunk_hash: string }>();
      const object = await bucket.get(
        stagedChunkKey(committed.upload_id, chunkIndex),
      );
      if (!object || !chunk || object.size > MAX_FILE_CHUNK_JSON_BYTES) {
        return errorResponse("File data is corrupted.", 500, env);
      }
      try {
        const serialized = await object.text();
        if ((await sha256Hex(serialized)) !== chunk.chunk_hash) {
          return errorResponse("File data is corrupted.", 500, env);
        }
        return jsonResponse({ payload: JSON.parse(serialized) }, env);
      } catch (parseError) {
        logError("Committed vault file chunk parse failed", parseError);
        return errorResponse("File data is corrupted.", 500, env);
      }
    }

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
