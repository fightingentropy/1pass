export type Env = {
  DB: {
    prepare: (query: string) => {
      run: () => Promise<unknown>;
      first: <T = unknown>() => Promise<T | null>;
      bind: (...args: unknown[]) => {
        first: <T = unknown>() => Promise<T | null>;
        run: () => Promise<unknown>;
      };
    };
  };
  ALLOWED_ORIGIN?: string;
};

export const DEFAULT_VAULT_ID = "default";
export const VAULT_AUTH_HEADER = "x-vault-auth";
export const VAULT_HISTORY_LIMIT = 10;

export function getCorsHeaders(env?: Env): Record<string, string> {
  const origin = env?.ALLOWED_ORIGIN;
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": `content-type, ${VAULT_AUTH_HEADER}`,
  };
}

export function jsonResponse(data: unknown, env?: Env, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...getCorsHeaders(env),
      ...(init.headers ?? {}),
    },
  });
}

export function errorResponse(message: string, status = 400, env?: Env) {
  return jsonResponse({ error: message }, env, { status });
}

export function optionsResponse(env?: Env) {
  return new Response(null, { status: 204, headers: getCorsHeaders(env) });
}

export function getDb(env: Env) {
  if (!env?.DB) {
    throw new Error("D1 binding not configured");
  }

  return env.DB;
}

export async function ensureVaultTable(db: Env["DB"]) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS vaults (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    )
    .run();

  // Older deployments predate the auth_hash column; probe and add it lazily.
  try {
    await db.prepare("SELECT auth_hash FROM vaults LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE vaults ADD COLUMN auth_hash TEXT").run();
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

function timingSafeEqualString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function getVaultAuthHash(db: Env["DB"]) {
  const row = await db
    .prepare("SELECT auth_hash FROM vaults WHERE id = ?1")
    .bind(DEFAULT_VAULT_ID)
    .first<{ auth_hash: string | null }>();
  return row?.auth_hash ?? null;
}

// Returns null when the request may proceed, otherwise a ready 401 response.
// Vaults created before the auth scheme have no auth_hash yet; they stay open
// until the client's first authenticated save registers a token.
export async function checkVaultAuth(
  request: Request,
  db: Env["DB"],
  env?: Env,
): Promise<Response | null> {
  const stored = await getVaultAuthHash(db);
  if (!stored) return null;

  const token = request.headers.get(VAULT_AUTH_HEADER) ?? "";
  if (!token || token.length > 256) {
    return errorResponse("Unauthorized.", 401, env);
  }
  const hash = await sha256Hex(token);
  if (!timingSafeEqualString(hash, stored)) {
    return errorResponse("Unauthorized.", 401, env);
  }
  return null;
}

export async function recordVaultHistory(
  db: Env["DB"],
  previousPayload: string,
) {
  await ensureVaultHistoryTable(db);
  await db
    .prepare(
      "INSERT INTO vault_history (vault_id, payload, saved_at) VALUES (?1, ?2, ?3)",
    )
    .bind(DEFAULT_VAULT_ID, previousPayload, Date.now())
    .run();
  await db
    .prepare(
      "DELETE FROM vault_history WHERE vault_id = ?1 AND rowid NOT IN (SELECT rowid FROM vault_history WHERE vault_id = ?1 ORDER BY saved_at DESC, rowid DESC LIMIT ?2)",
    )
    .bind(DEFAULT_VAULT_ID, VAULT_HISTORY_LIMIT)
    .run();
}
