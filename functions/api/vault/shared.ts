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
};

export const DEFAULT_VAULT_ID = "default";
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...CORS_HEADERS,
      ...(init.headers ?? {}),
    },
  });
}

export function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, { status });
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
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
