-- GET /api/vault/meta is unauthenticated and only needs the envelope version
-- and the KDF parameters. Keeping them in their own columns lets it answer
-- without loading and parsing the whole encrypted payload (up to ~1.9 MB).
ALTER TABLE vaults ADD COLUMN envelope_version INTEGER;
ALTER TABLE vaults ADD COLUMN kdf_json TEXT;

-- Backfill from the stored envelopes. Legacy plaintext vaults carry no version
-- and keep NULLs, which the endpoint resolves from the payload as before.
UPDATE vaults
SET envelope_version = json_extract(payload, '$.version'),
    kdf_json = json_extract(payload, '$.kdf')
WHERE json_valid(payload)
  AND json_type(payload, '$.version') = 'integer'
  AND json_type(payload, '$.kdf') = 'object';
