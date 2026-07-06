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

export function getCorsHeaders(env?: Env): Record<string, string> {
  const origin = env?.ALLOWED_ORIGIN;
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
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
