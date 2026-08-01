CREATE TABLE IF NOT EXISTS vault_file_uploads (
  upload_id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  total_chunks INTEGER NOT NULL CHECK (total_chunks BETWEEN 1 AND 64),
  base_generation INTEGER NOT NULL CHECK (base_generation >= 0),
  state TEXT NOT NULL CHECK (state IN ('staging', 'committed', 'collecting')),
  created_at INTEGER NOT NULL,
  committed_at INTEGER
);

CREATE INDEX IF NOT EXISTS vault_file_uploads_by_age
  ON vault_file_uploads (state, created_at);

CREATE INDEX IF NOT EXISTS vault_file_uploads_by_file
  ON vault_file_uploads (vault_id, file_id, created_at);

CREATE TABLE IF NOT EXISTS vault_file_upload_chunks (
  upload_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index BETWEEN 0 AND 63),
  chunk_hash TEXT NOT NULL,
  ciphertext_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (upload_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS vault_file_manifests (
  vault_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  upload_id TEXT NOT NULL UNIQUE,
  generation INTEGER NOT NULL CHECK (generation > 0),
  manifest_json TEXT NOT NULL,
  committed_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (vault_id, file_id)
);
