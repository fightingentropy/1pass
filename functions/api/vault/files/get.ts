import {
  DEFAULT_VAULT_ID,
  checkVaultAuth,
  errorResponse,
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
    const authFailure = await checkVaultAuth(request, db, env, {
      requireVault: true,
    });
    if (authFailure) return authFailure;

    // One round trip resolves the manifest pointer, the session's declared
    // chunk count, and the committed hash of the requested chunk. Every stored
    // attachment is served through a committed manifest.
    const committed = await db
      .prepare(
        "SELECT m.upload_id, m.deleted_at, u.total_chunks, c.chunk_hash FROM vault_file_manifests m LEFT JOIN vault_file_uploads u ON u.upload_id = m.upload_id LEFT JOIN vault_file_upload_chunks c ON c.upload_id = m.upload_id AND c.chunk_index = ?3 WHERE m.vault_id = ?1 AND m.file_id = ?2",
      )
      .bind(DEFAULT_VAULT_ID, id, chunkIndex)
      .first<{
        upload_id: string;
        deleted_at: number | null;
        total_chunks: number | null;
        chunk_hash: string | null;
      }>();
    if (!committed || committed.deleted_at !== null) {
      return errorResponse("File chunk not found.", 404, env);
    }
    if (committed.total_chunks === null) {
      return errorResponse("File data is corrupted.", 500, env);
    }
    if (chunkIndex >= committed.total_chunks) {
      return errorResponse("File chunk not found.", 404, env);
    }

    const object = await getFileBucket(env).get(
      stagedChunkKey(committed.upload_id, chunkIndex),
    );
    if (
      !object ||
      committed.chunk_hash === null ||
      object.size > MAX_FILE_CHUNK_JSON_BYTES
    ) {
      return errorResponse("File data is corrupted.", 500, env);
    }
    try {
      const serialized = await object.text();
      if ((await sha256Hex(serialized)) !== committed.chunk_hash) {
        return errorResponse("File data is corrupted.", 500, env);
      }
      return jsonResponse({ payload: JSON.parse(serialized) }, env);
    } catch (parseError) {
      logError("Committed vault file chunk parse failed", parseError);
      return errorResponse("File data is corrupted.", 500, env);
    }
  } catch (error) {
    logError("Vault file load failed", error);
    return errorResponse("Unable to load the file chunk.", 500, env);
  }
}
