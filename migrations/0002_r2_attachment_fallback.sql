-- Keep the legacy D1 chunk table readable while encrypted chunks migrate to R2
-- on first access. This index makes fallback reads and cleanup predictable.
CREATE INDEX IF NOT EXISTS vault_files_by_id
  ON vault_files (id, chunk_index);
