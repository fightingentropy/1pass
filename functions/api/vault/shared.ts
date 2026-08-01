import { VAULT_BOOTSTRAP_HEADER } from "./schema";

export type Env = Cloudflare.Env & {
  ALLOWED_ORIGIN?: string;
  BOOTSTRAP_SECRET?: string;
};

export const DEFAULT_VAULT_ID = "default";
export const VAULT_AUTH_HEADER = "x-vault-auth";
export const VAULT_HISTORY_LIMIT = 10;
export const MAX_FILE_CHUNK_INDEX = 63;
export const MAX_FILE_CHUNK_JSON_BYTES = 1_600_256;
export const STAGED_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const STAGED_UPLOAD_GC_LIMIT = 8;
const AUTH_FAILURE_LIMIT = 60;
const AUTH_FAILURE_WINDOW_MS = 60_000;

export function getCorsHeaders(env?: Env): Record<string, string> {
  const origin = env?.ALLOWED_ORIGIN;
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": `content-type, ${VAULT_AUTH_HEADER}, ${VAULT_BOOTSTRAP_HEADER}`,
  };
}

export function jsonResponse(
  data: unknown,
  env?: Env,
  init: ResponseInit = {},
) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...getCorsHeaders(env),
      ...(init.headers ?? {}),
    },
  });
}

export function errorResponse(message: string, status = 400, env?: Env) {
  return jsonResponse({ error: message }, env, { status });
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415; error: string }
> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim();
  if (contentType !== "application/json") {
    return { ok: false, status: 415, error: "Expected a JSON request body." };
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsed = Number(declaredLength);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { ok: false, status: 400, error: "Invalid Content-Length." };
    }
    if (parsed > maxBytes) {
      return { ok: false, status: 413, error: "Request body is too large." };
    }
  }
  if (!request.body) {
    return { ok: false, status: 400, error: "Missing JSON request body." };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, status: 413, error: "Request body is too large." };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON request body." };
  }
}

export function logError(message: string, error: unknown) {
  console.error(
    JSON.stringify({
      message,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

export function optionsResponse(env?: Env) {
  return new Response(null, {
    status: 204,
    headers: { ...getCorsHeaders(env), "cache-control": "no-store" },
  });
}

export function getDb(env: Env) {
  if (!env?.DB) {
    throw new Error("D1 binding not configured");
  }

  return env.DB;
}

export function getFileBucket(env: Env) {
  if (!env?.VAULT_FILES) {
    throw new Error("R2 vault file binding not configured");
  }

  return env.VAULT_FILES;
}

export function fileChunkKey(fileId: string, chunkIndex: number) {
  return `vaults/${DEFAULT_VAULT_ID}/files/${fileId}/${chunkIndex}.json`;
}

export function filePrefix(fileId: string) {
  return `vaults/${DEFAULT_VAULT_ID}/files/${fileId}/`;
}

export function stagedUploadPrefix(uploadId: string) {
  return `vaults/${DEFAULT_VAULT_ID}/staging/${uploadId}/`;
}

export function stagedChunkKey(uploadId: string, chunkIndex: number) {
  return `${stagedUploadPrefix(uploadId)}${chunkIndex}.json`;
}

export async function deleteObjectPrefix(
  bucket: Env["VAULT_FILES"],
  prefix: string,
) {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, limit: 1000, cursor });
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((object) => object.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

export async function deleteFileObjects(
  bucket: Env["VAULT_FILES"],
  fileId: string,
) {
  await deleteObjectPrefix(bucket, filePrefix(fileId));
}

export async function ensureVaultTable(db: Env["DB"]) {
  await db.prepare("SELECT auth_hash, revision FROM vaults LIMIT 1").first();
}

export async function ensureVaultHistoryTable(db: Env["DB"]) {
  await db.prepare("SELECT vault_id FROM vault_history LIMIT 1").first();
}

export async function ensureVaultFilesTable(db: Env["DB"]) {
  await db.prepare("SELECT id FROM vault_files LIMIT 1").first();
}

export async function ensureVaultFileUploadTables(db: Env["DB"]) {
  await db.prepare("SELECT upload_id FROM vault_file_uploads LIMIT 1").first();
  await db
    .prepare("SELECT upload_id FROM vault_file_upload_chunks LIMIT 1")
    .first();
  await db
    .prepare("SELECT upload_id FROM vault_file_manifests LIMIT 1")
    .first();
}

type CollectableUpload = {
  upload_id: string;
  state: "staging" | "committed";
};

// Claim stale uploads in D1 before touching R2. A concurrent commit requires a
// `staging` row and therefore cannot make a claimed upload live after GC has
// begun. Referenced manifests are always excluded.
export async function garbageCollectAbandonedUploads(
  db: Env["DB"],
  bucket: Env["VAULT_FILES"],
  now = Date.now(),
) {
  await ensureVaultFileUploadTables(db);
  const candidates = await db
    .prepare(
      "SELECT upload_id, state FROM vault_file_uploads WHERE created_at < ?1 AND state IN ('staging', 'committed') AND NOT EXISTS (SELECT 1 FROM vault_file_manifests WHERE vault_file_manifests.upload_id = vault_file_uploads.upload_id AND vault_file_manifests.deleted_at IS NULL) ORDER BY created_at ASC LIMIT ?2",
    )
    .bind(now - STAGED_UPLOAD_MAX_AGE_MS, STAGED_UPLOAD_GC_LIMIT)
    .all<CollectableUpload>();

  let removed = 0;
  for (const candidate of candidates.results) {
    const claimed = await db
      .prepare(
        "UPDATE vault_file_uploads SET state = 'collecting' WHERE upload_id = ?1 AND state = ?2 AND NOT EXISTS (SELECT 1 FROM vault_file_manifests WHERE vault_file_manifests.upload_id = vault_file_uploads.upload_id AND vault_file_manifests.deleted_at IS NULL)",
      )
      .bind(candidate.upload_id, candidate.state)
      .run();
    if (claimed.meta.changes !== 1) continue;

    try {
      await deleteObjectPrefix(bucket, stagedUploadPrefix(candidate.upload_id));
      await db.batch([
        db
          .prepare("DELETE FROM vault_file_upload_chunks WHERE upload_id = ?1")
          .bind(candidate.upload_id),
        db
          .prepare(
            "DELETE FROM vault_file_uploads WHERE upload_id = ?1 AND state = 'collecting' AND NOT EXISTS (SELECT 1 FROM vault_file_manifests WHERE vault_file_manifests.upload_id = vault_file_uploads.upload_id AND vault_file_manifests.deleted_at IS NULL)",
          )
          .bind(candidate.upload_id),
      ]);
      removed += 1;
    } catch (error) {
      await db
        .prepare(
          "UPDATE vault_file_uploads SET state = ?1 WHERE upload_id = ?2 AND state = 'collecting'",
        )
        .bind(candidate.state, candidate.upload_id)
        .run();
      throw error;
    }
  }
  return removed;
}

export async function ensureVaultAuthAttemptsTable(db: Env["DB"]) {
  await db
    .prepare("SELECT client_key FROM vault_auth_attempts LIMIT 1")
    .first();
}

export function isValidFileId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[a-zA-Z0-9-]+$/.test(value)
  );
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHash(a: string, b: string) {
  const encoder = new TextEncoder();
  return crypto.subtle.timingSafeEqual(encoder.encode(a), encoder.encode(b));
}

async function authFailureResponse(request: Request, env: Env) {
  const clientIdentity =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local";
  const db = getDb(env);
  await ensureVaultAuthAttemptsTable(db);
  const now = Date.now();
  const windowCutoff = now - AUTH_FAILURE_WINDOW_MS;
  const clientKey = await sha256Hex(clientIdentity);
  const attempt = await db
    .prepare(
      "INSERT INTO vault_auth_attempts (client_key, window_started_at, attempt_count) VALUES (?1, ?2, 1) ON CONFLICT(client_key) DO UPDATE SET window_started_at = CASE WHEN vault_auth_attempts.window_started_at < ?3 THEN excluded.window_started_at ELSE vault_auth_attempts.window_started_at END, attempt_count = CASE WHEN vault_auth_attempts.window_started_at < ?3 THEN 1 ELSE vault_auth_attempts.attempt_count + 1 END RETURNING attempt_count",
    )
    .bind(clientKey, now, windowCutoff)
    .first<{ attempt_count: number }>();

  if (attempt?.attempt_count === 1) {
    await db
      .prepare("DELETE FROM vault_auth_attempts WHERE window_started_at < ?1")
      .bind(now - 24 * 60 * 60 * 1000)
      .run();
  }

  return (attempt?.attempt_count ?? AUTH_FAILURE_LIMIT + 1) <=
    AUTH_FAILURE_LIMIT
    ? errorResponse("Unauthorized.", 401, env)
    : errorResponse("Too many authentication attempts.", 429, env);
}

export async function checkBootstrapSecret(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const expected = env.BOOTSTRAP_SECRET?.trim() ?? "";
  if (!expected) {
    return errorResponse("Vault bootstrap is not configured.", 503, env);
  }

  const provided = request.headers.get(VAULT_BOOTSTRAP_HEADER) ?? "";
  if (!provided || provided.length > 512) {
    return authFailureResponse(request, env);
  }

  const [providedHash, expectedHash] = await Promise.all([
    sha256Hex(provided),
    sha256Hex(expected),
  ]);
  return timingSafeEqualHash(providedHash, expectedHash)
    ? null
    : authFailureResponse(request, env);
}

export async function getVaultAuthHash(db: Env["DB"]) {
  const row = await db
    .prepare("SELECT auth_hash FROM vaults WHERE id = ?1")
    .bind(DEFAULT_VAULT_ID)
    .first<{ auth_hash: string | null }>();
  return row?.auth_hash ?? null;
}

// Returns null when the request may proceed, otherwise a ready 401 response.
// Vaults created before the auth scheme have no auth_hash yet. They require the
// deployment bootstrap secret for their one-time authenticated migration.
export async function checkVaultAuth(
  request: Request,
  db: Env["DB"],
  env: Env,
): Promise<Response | null> {
  const stored = await getVaultAuthHash(db);
  if (!stored) return checkBootstrapSecret(request, env);

  const token = request.headers.get(VAULT_AUTH_HEADER) ?? "";
  if (!token || token.length > 256) {
    return authFailureResponse(request, env);
  }
  const hash = await sha256Hex(token);
  if (!timingSafeEqualHash(hash, stored)) {
    return authFailureResponse(request, env);
  }
  return null;
}
