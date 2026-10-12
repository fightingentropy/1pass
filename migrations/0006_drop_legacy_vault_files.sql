-- Attachments are served only from committed vault_file_manifests rows, so the
-- pre-R2 D1 chunk table is no longer read or written. Dropping it also drops
-- its vault_files_by_id index from migration 0002.
DROP TABLE IF EXISTS vault_files;
