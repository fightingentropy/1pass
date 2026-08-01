import {
  DEFAULT_VAULT_ID,
  checkVaultAuth,
  deleteObjectPrefix,
  deleteFileObjects,
  ensureVaultFileUploadTables,
  ensureVaultFilesTable,
  ensureVaultTable,
  errorResponse,
  getFileBucket,
  getDb,
  isValidFileId,
  jsonResponse,
  logError,
  optionsResponse,
  readBoundedJson,
  stagedUploadPrefix,
} from "../shared";
import type { Env } from "../shared";

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
    const db = getDb(env);
    await ensureVaultTable(db);
    const authFailure = await checkVaultAuth(request, db, env);
    if (authFailure) return authFailure;

    const parsedBody = await readBoundedJson(request, 2_048);
    if (!parsedBody.ok) {
      return errorResponse(parsedBody.error, parsedBody.status, env);
    }
    const body = parsedBody.value;
    const id =
      body && typeof body === "object" && "id" in body ? body.id : null;
    if (!isValidFileId(id)) {
      return errorResponse("Invalid file id.", 400, env);
    }

    const bucket = getFileBucket(env);
    await ensureVaultFileUploadTables(db);
    const active = await db
      .prepare(
        "SELECT upload_id FROM vault_file_manifests WHERE vault_id = ?1 AND file_id = ?2 AND deleted_at IS NULL",
      )
      .bind(DEFAULT_VAULT_ID, id)
      .first<{ upload_id: string }>();
    let cleanupDeferred = false;
    if (active) {
      const unlinked = await db
        .prepare(
          "UPDATE vault_file_manifests SET generation = generation + 1, deleted_at = ?1 WHERE vault_id = ?2 AND file_id = ?3 AND upload_id = ?4 AND deleted_at IS NULL",
        )
        .bind(Date.now(), DEFAULT_VAULT_ID, id, active.upload_id)
        .run();
      if (unlinked.meta.changes !== 1) {
        return errorResponse(
          "Attachment changed while it was being removed. Retry.",
          409,
          env,
        );
      }
      try {
        await deleteObjectPrefix(bucket, stagedUploadPrefix(active.upload_id));
        await db.batch([
          db
            .prepare(
              "DELETE FROM vault_file_upload_chunks WHERE upload_id = ?1",
            )
            .bind(active.upload_id),
          db
            .prepare("DELETE FROM vault_file_uploads WHERE upload_id = ?1")
            .bind(active.upload_id),
        ]);
      } catch (error) {
        // The authoritative manifest pointer is already tombstoned. Keep the
        // upload metadata so bounded GC can retry deleting the unreferenced R2
        // objects without resurrecting the attachment.
        cleanupDeferred = true;
        logError("Deleted attachment object cleanup deferred", error);
      }
    }

    // Also remove the pre-v3 direct-key representation during rolling
    // upgrades. It is not used after an immutable manifest is committed.
    await deleteFileObjects(bucket, id);
    await ensureVaultFilesTable(db);
    await db.prepare("DELETE FROM vault_files WHERE id = ?1").bind(id).run();

    return jsonResponse({ ok: true, cleanupDeferred }, env);
  } catch (error) {
    logError("Vault file delete failed", error);
    return errorResponse("Unable to delete the file.", 500, env);
  }
}
