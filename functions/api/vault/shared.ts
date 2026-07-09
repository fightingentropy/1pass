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

export function jsonResponse(data: unknown, env?: Env, init: ResponseInit = {}) {
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

export async function deleteFileObjects(bucket: Env["VAULT_FILES"], fileId: string) {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({
      prefix: filePrefix(fileId),
      limit: 1000,
      cursor,
    });
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((object) => object.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

export async function ensureVaultTable(db: Env["DB"]) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS vaults (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL, auth_hash TEXT, revision INTEGER NOT NULL DEFAULT 0)",
    )
    .run();

  // Older deployments predate the auth_hash column; probe and add it lazily.
  try {
    await db.prepare("SELECT auth_hash FROM vaults LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE vaults ADD COLUMN auth_hash TEXT").run();
  }

  // Older deployments predate optimistic-concurrency revisions.
  try {
    await db.prepare("SELECT revision FROM vaults LIMIT 1").first();
  } catch {
    await db
      .prepare("ALTER TABLE vaults ADD COLUMN revision INTEGER NOT NULL DEFAULT 0")
      .run();
  }
}

export async function ensureVaultHistoryTable(db: Env["DB"]) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS vault_history (vault_id TEXT NOT NULL, payload TEXT NOT NULL, saved_at INTEGER NOT NULL)",
    )
    .run();
}

export async function ensureVaultFilesTable(db: Env["DB"]) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS vault_files (id TEXT NOT NULL, chunk_index INTEGER NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (id, chunk_index))",
    )
    .run();
}

export async function ensureVaultAuthAttemptsTable(db: Env["DB"]) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS vault_auth_attempts (client_key TEXT PRIMARY KEY, window_started_at INTEGER NOT NULL, attempt_count INTEGER NOT NULL)",
    )
    .run();
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

  return (attempt?.attempt_count ?? AUTH_FAILURE_LIMIT + 1) <= AUTH_FAILURE_LIMIT
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
