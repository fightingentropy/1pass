import {
  DEFAULT_VAULT_ID,
  checkVaultAuth,
  errorResponse,
  getDb,
  jsonResponse,
  logError,
  optionsResponse,
} from "../shared";
import type { Env } from "../shared";

type LiveManifestRow = {
  file_id: string;
  committed_at: number;
};

export function onRequestOptions({ env }: { env: Env }) {
  return optionsResponse(env);
}

// Lists every live (committed and not tombstoned) manifest-tracked file. The
// server never learns which ids the encrypted vault references, so the client
// diffs this listing against its decrypted attachments to find files left
// behind by a crash between commit and vault save, or by a delete that failed
// after the save. Staged uploads that never committed are not listed; bounded
// GC removes those once they expire.
export async function onRequestGet({
  request,
  env,
}: {
  request: Request;
  env: Env;
}) {
  try {
    const db = getDb(env);
    const authFailure = await checkVaultAuth(request, db, env, {
      requireVault: true,
    });
    if (authFailure) return authFailure;

    const rows = await db
      .prepare(
        "SELECT file_id, committed_at FROM vault_file_manifests WHERE vault_id = ?1 AND deleted_at IS NULL ORDER BY committed_at ASC",
      )
      .bind(DEFAULT_VAULT_ID)
      .all<LiveManifestRow>();

    return jsonResponse(
      {
        files: rows.results.map((row) => ({
          id: row.file_id,
          committedAt: row.committed_at,
        })),
      },
      env,
    );
  } catch (error) {
    logError("Vault file list failed", error);
    return errorResponse("Unable to list vault files.", 500, env);
  }
}
