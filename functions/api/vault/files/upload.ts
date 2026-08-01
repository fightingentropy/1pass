import {
  DEFAULT_VAULT_ID,
  MAX_FILE_CHUNK_INDEX,
  MAX_FILE_CHUNK_JSON_BYTES,
  checkVaultAuth,
  deleteObjectPrefix,
  ensureVaultFileUploadTables,
  ensureVaultTable,
  errorResponse,
  garbageCollectAbandonedUploads,
  getFileBucket,
  getDb,
  isValidFileId,
  jsonResponse,
  logError,
  optionsResponse,
  readBoundedJson,
  sha256Hex,
  stagedChunkKey,
  stagedUploadPrefix,
} from "../shared";
import { base64ByteLength } from "../schema";
import type { Env } from "../shared";

// A 1MB raw chunk base64-encodes to ~1.34MB. Keep a hard request limit even
// though R2 can hold much larger objects, so the Worker never buffers an
// unexpectedly large JSON body.
const MAX_CHUNK_CIPHERTEXT_LENGTH = 1_600_000;
const MAX_PLAINTEXT_CHUNK_BYTES = 1_000_000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

type UploadRow = {
  upload_id: string;
  file_id: string;
  total_chunks: number;
  base_generation: number;
  state: "staging" | "committed" | "collecting";
};

type ChunkRow = {
  chunk_index: number;
  chunk_hash: string;
};

function readField(body: unknown, field: string) {
  return body && typeof body === "object" && field in body
    ? (body as Record<string, unknown>)[field]
    : null;
}

function serializeChunk(payload: unknown) {
  const version = readField(payload, "version");
  const iv = readField(payload, "iv");
  const ciphertext = readField(payload, "ciphertext");
  if (
    version !== 3 ||
    typeof iv !== "string" ||
    base64ByteLength(iv) !== 12 ||
    typeof ciphertext !== "string" ||
    base64ByteLength(ciphertext) < 16 ||
    ciphertext.length > MAX_CHUNK_CIPHERTEXT_LENGTH
  ) {
    return null;
  }
  const serialized = JSON.stringify({ version: 3, iv, ciphertext });
  return new TextEncoder().encode(serialized).byteLength <=
    MAX_FILE_CHUNK_JSON_BYTES
    ? serialized
    : null;
}

async function beginUpload(body: unknown, env: Env) {
  const fileId = readField(body, "fileId");
  const totalChunks = readField(body, "totalChunks");
  if (!isValidFileId(fileId)) {
    return errorResponse("Invalid file id.", 400, env);
  }
  if (
    typeof totalChunks !== "number" ||
    !Number.isInteger(totalChunks) ||
    totalChunks < 1 ||
    totalChunks > MAX_FILE_CHUNK_INDEX + 1
  ) {
    return errorResponse("Invalid total chunk count.", 400, env);
  }

  const db = getDb(env);
  const bucket = getFileBucket(env);
  await ensureVaultFileUploadTables(db);
  try {
    await garbageCollectAbandonedUploads(db, bucket);
  } catch (error) {
    // Cleanup is retried by the next begin request; a transient R2 failure
    // must not make otherwise safe new uploads unavailable.
    logError("Abandoned upload cleanup failed", error);
  }
  const active = await db
    .prepare(
      "SELECT generation FROM vault_file_manifests WHERE vault_id = ?1 AND file_id = ?2",
    )
    .bind(DEFAULT_VAULT_ID, fileId)
    .first<{ generation: number }>();
  const baseGeneration = active?.generation ?? 0;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const uploadId = crypto.randomUUID().replaceAll("-", "");
    const inserted = await db
      .prepare(
        "INSERT OR IGNORE INTO vault_file_uploads (upload_id, vault_id, file_id, total_chunks, base_generation, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'staging', ?6)",
      )
      .bind(
        uploadId,
        DEFAULT_VAULT_ID,
        fileId,
        totalChunks,
        baseGeneration,
        Date.now(),
      )
      .run();
    if (inserted.meta.changes === 1) {
      return jsonResponse({ uploadId }, env);
    }
  }
  throw new Error("Unable to allocate a unique upload id.");
}

async function uploadChunk(body: unknown, env: Env) {
  const uploadId = readField(body, "uploadId");
  const chunkIndex = readField(body, "chunkIndex");
  const payload = readField(body, "payload");
  if (!isValidFileId(uploadId)) {
    return errorResponse("Invalid upload id.", 400, env);
  }
  if (
    typeof chunkIndex !== "number" ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex > MAX_FILE_CHUNK_INDEX
  ) {
    return errorResponse("Invalid chunk index.", 400, env);
  }
  const serialized = serializeChunk(payload);
  if (!serialized) {
    return errorResponse("Invalid chunk payload.", 400, env);
  }

  const db = getDb(env);
  await ensureVaultFileUploadTables(db);
  const upload = await db
    .prepare(
      "SELECT upload_id, file_id, total_chunks, base_generation, state FROM vault_file_uploads WHERE upload_id = ?1 AND vault_id = ?2",
    )
    .bind(uploadId, DEFAULT_VAULT_ID)
    .first<UploadRow>();
  if (!upload) return errorResponse("Upload session not found.", 404, env);
  if (upload.state !== "staging") {
    return errorResponse("Upload session is no longer writable.", 409, env);
  }
  if (chunkIndex >= upload.total_chunks) {
    return errorResponse(
      "Chunk index exceeds the declared manifest.",
      400,
      env,
    );
  }

  const chunkHash = await sha256Hex(serialized);
  const bucket = getFileBucket(env);
  const key = stagedChunkKey(uploadId, chunkIndex);
  const written = await bucket.put(key, serialized, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      uploadId,
      fileId: upload.file_id,
      chunkIndex: String(chunkIndex),
      chunkHash,
    },
  });
  if (!written) {
    return errorResponse("Duplicate chunk upload rejected.", 409, env);
  }

  try {
    const recorded = await db
      .prepare(
        "INSERT OR IGNORE INTO vault_file_upload_chunks (upload_id, chunk_index, chunk_hash, ciphertext_bytes, created_at) SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM vault_file_uploads WHERE upload_id = ?1 AND vault_id = ?6 AND state = 'staging')",
      )
      .bind(
        uploadId,
        chunkIndex,
        chunkHash,
        new TextEncoder().encode(serialized).byteLength,
        Date.now(),
        DEFAULT_VAULT_ID,
      )
      .run();
    if (recorded.meta.changes !== 1) {
      await bucket.delete(key);
      return errorResponse("Duplicate chunk upload rejected.", 409, env);
    }
  } catch (error) {
    await bucket.delete(key);
    throw error;
  }

  return jsonResponse({ ok: true, chunkHash }, env);
}

async function commitUpload(body: unknown, env: Env) {
  const uploadId = readField(body, "uploadId");
  const manifest = readField(body, "manifest");
  if (!isValidFileId(uploadId)) {
    return errorResponse("Invalid upload id.", 400, env);
  }

  const db = getDb(env);
  await ensureVaultFileUploadTables(db);
  const upload = await db
    .prepare(
      "SELECT upload_id, file_id, total_chunks, base_generation, state FROM vault_file_uploads WHERE upload_id = ?1 AND vault_id = ?2",
    )
    .bind(uploadId, DEFAULT_VAULT_ID)
    .first<UploadRow>();
  if (!upload) return errorResponse("Upload session not found.", 404, env);
  if (upload.state !== "staging") {
    return errorResponse(
      "Upload session has already been committed or closed.",
      409,
      env,
    );
  }

  const chunks = readField(manifest, "chunks");
  const envelopeVersion = readField(manifest, "envelopeVersion");
  const chunkHashes = readField(manifest, "chunkHashes");
  const chunkSizes = readField(manifest, "chunkSizes");
  const manifestMac = readField(manifest, "manifestMac");
  if (
    chunks !== upload.total_chunks ||
    envelopeVersion !== 3 ||
    !Array.isArray(chunkHashes) ||
    chunkHashes.length !== chunks ||
    !chunkHashes.every(
      (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash),
    ) ||
    !Array.isArray(chunkSizes) ||
    chunkSizes.length !== chunks ||
    !chunkSizes.every(
      (size) =>
        typeof size === "number" &&
        Number.isInteger(size) &&
        size > 0 &&
        size <= MAX_PLAINTEXT_CHUNK_BYTES,
    ) ||
    chunkSizes.reduce<number>((sum, size) => sum + size, 0) >
      MAX_ATTACHMENT_BYTES ||
    typeof manifestMac !== "string" ||
    base64ByteLength(manifestMac) !== 32
  ) {
    return errorResponse("Invalid attachment manifest.", 400, env);
  }

  const uploadedChunks = await db
    .prepare(
      "SELECT chunk_index, chunk_hash FROM vault_file_upload_chunks WHERE upload_id = ?1 ORDER BY chunk_index ASC",
    )
    .bind(uploadId)
    .all<ChunkRow>();
  if (
    uploadedChunks.results.length !== chunks ||
    uploadedChunks.results.some(
      (chunk, index) =>
        chunk.chunk_index !== index || chunk.chunk_hash !== chunkHashes[index],
    )
  ) {
    return errorResponse(
      "Attachment manifest does not match the staged chunks.",
      409,
      env,
    );
  }

  const canonicalManifest = JSON.stringify({
    chunks,
    envelopeVersion: 3,
    chunkHashes,
    chunkSizes,
    manifestMac,
  });
  const committedAt = Date.now();
  const nextGeneration = upload.base_generation + 1;

  // This compare-and-swap is the commit point. The manifest and immutable R2
  // session become visible together through one D1 row; concurrent sessions
  // created from the same generation cannot both win.
  const committed = await db
    .prepare(
      "INSERT INTO vault_file_manifests (vault_id, file_id, upload_id, generation, manifest_json, committed_at, deleted_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, NULL WHERE EXISTS (SELECT 1 FROM vault_file_uploads WHERE upload_id = ?3 AND state = 'staging') AND ((?7 = 0 AND NOT EXISTS (SELECT 1 FROM vault_file_manifests WHERE vault_id = ?1 AND file_id = ?2)) OR EXISTS (SELECT 1 FROM vault_file_manifests WHERE vault_id = ?1 AND file_id = ?2 AND generation = ?7)) ON CONFLICT(vault_id, file_id) DO UPDATE SET upload_id = excluded.upload_id, generation = excluded.generation, manifest_json = excluded.manifest_json, committed_at = excluded.committed_at, deleted_at = NULL WHERE vault_file_manifests.generation = ?7",
    )
    .bind(
      DEFAULT_VAULT_ID,
      upload.file_id,
      uploadId,
      nextGeneration,
      canonicalManifest,
      committedAt,
      upload.base_generation,
    )
    .run();
  if (committed.meta.changes !== 1) {
    return errorResponse(
      "A newer version of this attachment has already been committed.",
      409,
      env,
    );
  }

  try {
    await db
      .prepare(
        "UPDATE vault_file_uploads SET state = 'committed', committed_at = ?1 WHERE upload_id = ?2 AND state = 'staging'",
      )
      .bind(committedAt, uploadId)
      .run();
  } catch (error) {
    // The manifest row is the authoritative commit point. If this optional
    // bookkeeping write fails, the referenced session remains protected from
    // GC and the client must still receive the successful commit.
    logError("Committed upload state bookkeeping failed", error);
  }
  return jsonResponse({ ok: true, generation: nextGeneration }, env);
}

async function abortUpload(body: unknown, env: Env) {
  const uploadId = readField(body, "uploadId");
  if (!isValidFileId(uploadId)) {
    return errorResponse("Invalid upload id.", 400, env);
  }
  const db = getDb(env);
  await ensureVaultFileUploadTables(db);
  const claimed = await db
    .prepare(
      "UPDATE vault_file_uploads SET state = 'collecting' WHERE upload_id = ?1 AND vault_id = ?2 AND state = 'staging' AND NOT EXISTS (SELECT 1 FROM vault_file_manifests WHERE vault_file_manifests.upload_id = vault_file_uploads.upload_id AND vault_file_manifests.deleted_at IS NULL)",
    )
    .bind(uploadId, DEFAULT_VAULT_ID)
    .run();
  if (claimed.meta.changes !== 1) {
    return errorResponse("Upload session is not abortable.", 409, env);
  }

  try {
    await deleteObjectPrefix(getFileBucket(env), stagedUploadPrefix(uploadId));
    await db.batch([
      db
        .prepare("DELETE FROM vault_file_upload_chunks WHERE upload_id = ?1")
        .bind(uploadId),
      db
        .prepare(
          "DELETE FROM vault_file_uploads WHERE upload_id = ?1 AND state = 'collecting'",
        )
        .bind(uploadId),
    ]);
  } catch (error) {
    await db
      .prepare(
        "UPDATE vault_file_uploads SET state = 'staging' WHERE upload_id = ?1 AND state = 'collecting'",
      )
      .bind(uploadId)
      .run();
    throw error;
  }
  return jsonResponse({ ok: true }, env);
}

export function onRequestOptions({ env }: { env: Env }) {
  return optionsResponse(env);
}

export async function onRequestPost({
  request,
  env,
}: {
  request: Request;
  env: Env;
}) {
  try {
    const db = getDb(env);
    await ensureVaultTable(db);
    const authFailure = await checkVaultAuth(request, db, env);
    if (authFailure) return authFailure;

    const parsedBody = await readBoundedJson(
      request,
      MAX_FILE_CHUNK_JSON_BYTES,
    );
    if (!parsedBody.ok) {
      return errorResponse(parsedBody.error, parsedBody.status, env);
    }
    const body = parsedBody.value;
    const action = readField(body, "action");

    const vault = await db
      .prepare("SELECT id FROM vaults WHERE id = ?1")
      .bind(DEFAULT_VAULT_ID)
      .first();
    if (!vault) {
      return errorResponse("Vault not initialized.", 404, env);
    }

    if (action === "begin") return beginUpload(body, env);
    if (action === "chunk") return uploadChunk(body, env);
    if (action === "commit") return commitUpload(body, env);
    if (action === "abort") return abortUpload(body, env);
    return errorResponse("Invalid upload action.", 400, env);
  } catch (error) {
    logError("Vault file upload failed", error);
    return errorResponse("Unable to update the staged file upload.", 500, env);
  }
}
