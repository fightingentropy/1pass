import {
  checkVaultAuth,
  deleteFileObjects,
  ensureVaultFilesTable,
  ensureVaultTable,
  errorResponse,
  getFileBucket,
  getDb,
  isValidFileId,
  jsonResponse,
  logError,
  optionsResponse,
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
    const body: unknown = await request.json().catch(() => null);
    const id = body && typeof body === "object" && "id" in body ? body.id : null;
    if (!isValidFileId(id)) {
      return errorResponse("Invalid file id.", 400, env);
    }

    const db = getDb(env);
    await ensureVaultTable(db);

    const authFailure = await checkVaultAuth(request, db, env);
    if (authFailure) return authFailure;

    await deleteFileObjects(getFileBucket(env), id);
    await ensureVaultFilesTable(db);
    await db
      .prepare("DELETE FROM vault_files WHERE id = ?1")
      .bind(id)
      .run();

    return jsonResponse({ ok: true }, env);
  } catch (error) {
    logError("Vault file delete failed", error);
    return errorResponse("Unable to delete the file.", 500, env);
  }
}
