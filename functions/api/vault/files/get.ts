import {
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
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return errorResponse("Invalid chunk index.", 400, env);
    }

    const db = getDb(env);
    await ensureVaultTable(db);

    const authFailure = await checkVaultAuth(request, db, env);
    if (authFailure) return authFailure;

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
      console.error("Vault file chunk parse error", parseError);
      return errorResponse("File data is corrupted.", 500, env);
    }

    return jsonResponse({ payload }, env);
  } catch (error) {
    console.error("Vault file get error", error);
    return errorResponse("Unable to load the file chunk.", 500, env);
  }
}
