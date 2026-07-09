CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  auth_hash TEXT,
  revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vault_history (
  vault_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  saved_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS vault_history_by_vault_and_saved_at
  ON vault_history (vault_id, saved_at DESC);

CREATE TABLE IF NOT EXISTS vault_files (
  id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (id, chunk_index)
);
