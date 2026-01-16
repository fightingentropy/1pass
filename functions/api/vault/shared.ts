export type Env = {
  DB: {
    prepare: (query: string) => {
      bind: (...args: unknown[]) => {
        first: <T = unknown>() => Promise<T | null>;
        run: () => Promise<unknown>;
      };
    };
  };
};

export const DEFAULT_VAULT_ID = "default";

export function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, { status });
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
