import {
  VAULT_AUTH_HEADER,
  VAULT_BOOTSTRAP_HEADER,
  type VaultAttachment,
  type VaultEncryptedPayload,
  type VaultMeta,
  type VaultStoredFile,
} from "../../functions/api/vault/schema";
import {
  createV3AttachmentManifest,
  decryptBytes,
  encryptedChunkDigest,
  encryptBytes,
  hasV3AttachmentManifest,
  isEncryptedChunk,
  type EncryptedChunk,
  type VaultSession,
  verifyV3AttachmentManifest,
} from "../vaultCrypto";
import {
  ATTACHMENT_TRANSFER_CONCURRENCY,
  runWithConcurrency,
} from "./concurrency";
import { ATTACHMENT_CHUNK_SIZE } from "./types";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function isUnauthorizedError(error: unknown) {
  return error instanceof ApiError && error.status === 401;
}

export function isConflictError(error: unknown) {
  return error instanceof ApiError && error.status === 409;
}

// Browser requests stay relative so every Pages domain serves its own API.
// The CLI points this at a vault URL instead.
let apiBase = "";

export function configureApiBase(baseUrl: string) {
  apiBase = baseUrl.replace(/\/+$/, "");
}

async function requestJson<T>(
  path: string,
  init?: RequestInit & { authToken?: string; bootstrapSecret?: string },
) {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (init?.body) {
    headers["content-type"] = "application/json";
  }
  if (init?.authToken) {
    headers[VAULT_AUTH_HEADER] = init.authToken;
  }
  if (init?.bootstrapSecret) {
    headers[VAULT_BOOTSTRAP_HEADER] = init.bootstrapSecret;
  }
  // Every Pages domain serves the same vault API. Relative requests keep
  // custom domains working without cross-origin authentication or CORS.
  const response = await fetch(apiBase + path, {
    ...init,
    headers,
    cache: "no-store",
  });

  const text = await response.text();
  let data = null as T;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null as T;
    }
  }

  if (!response.ok) {
    const message =
      typeof (data as { error?: string } | null)?.error === "string"
        ? (data as { error: string }).error
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return data;
}

export async function readVaultMeta(): Promise<VaultMeta> {
  const meta = await requestJson<VaultMeta | null>("/api/vault/meta");
  if (!meta || typeof meta.exists !== "boolean") {
    throw new Error("Unable to read vault status.");
  }
  return meta;
}

export async function initVault(
  payload: VaultEncryptedPayload,
  authToken: string,
  bootstrapSecret: string,
) {
  const result = await requestJson<{ revision: number }>("/api/vault/init", {
    method: "POST",
    body: JSON.stringify({ payload }),
    authToken,
    bootstrapSecret,
  });
  return result.revision;
}

export async function loadVaultRecord(authToken: string) {
  return requestJson<{ payload: unknown; revision: number }>(
    "/api/vault/load",
    { authToken },
  );
}

export async function saveVaultRecord(
  payload: VaultEncryptedPayload,
  authToken: string,
  expectedRevision: number,
) {
  const result = await requestJson<{ revision: number }>("/api/vault/save", {
    method: "POST",
    body: JSON.stringify({ payload, expectedRevision }),
    authToken,
  });
  return result.revision;
}

export async function rotateVaultRecord(
  payload: VaultEncryptedPayload,
  currentAuthToken: string,
  newAuthToken: string,
  expectedRevision: number,
) {
  const result = await requestJson<{ revision: number }>("/api/vault/rotate", {
    method: "POST",
    body: JSON.stringify({ payload, expectedRevision, newAuthToken }),
    authToken: currentAuthToken,
  });
  return result.revision;
}

export async function uploadEncryptedChunk(
  uploadId: string,
  chunkIndex: number,
  payload: EncryptedChunk,
  authToken: string,
) {
  await requestJson("/api/vault/files/upload", {
    method: "POST",
    body: JSON.stringify({ action: "chunk", uploadId, chunkIndex, payload }),
    authToken,
  });
}

export async function beginAttachmentUpload(
  fileId: string,
  totalChunks: number,
  authToken: string,
) {
  const result = await requestJson<{ uploadId: string }>(
    "/api/vault/files/upload",
    {
      method: "POST",
      body: JSON.stringify({ action: "begin", fileId, totalChunks }),
      authToken,
    },
  );
  if (!result || typeof result.uploadId !== "string") {
    throw new Error("The upload session response is invalid.");
  }
  return result.uploadId;
}

type V3AttachmentManifest = Pick<
  VaultAttachment,
  "chunks" | "envelopeVersion" | "chunkHashes" | "chunkSizes" | "manifestMac"
>;

export async function commitAttachmentUpload(
  uploadId: string,
  manifest: V3AttachmentManifest,
  authToken: string,
) {
  await requestJson("/api/vault/files/upload", {
    method: "POST",
    body: JSON.stringify({ action: "commit", uploadId, manifest }),
    authToken,
  });
}

export async function abortAttachmentUpload(
  uploadId: string,
  authToken: string,
) {
  await requestJson("/api/vault/files/upload", {
    method: "POST",
    body: JSON.stringify({ action: "abort", uploadId }),
    authToken,
  });
}

export async function downloadAttachmentEncryptedChunk(
  fileId: string,
  chunkIndex: number,
  authToken: string,
): Promise<EncryptedChunk> {
  const data = await requestJson<{ payload: unknown }>(
    `/api/vault/files/get?id=${encodeURIComponent(fileId)}&chunk=${chunkIndex}`,
    { authToken },
  );
  if (!isEncryptedChunk(data?.payload)) {
    throw new Error("File data is missing or corrupted.");
  }
  return data.payload;
}

export async function uploadAttachmentBytes(
  fileId: string,
  bytes: Uint8Array<ArrayBuffer>,
  session: VaultSession,
  onProgress?: (percent: number) => void,
): Promise<
  Pick<
    VaultAttachment,
    "chunks" | "envelopeVersion" | "chunkHashes" | "chunkSizes" | "manifestMac"
  >
> {
  if (session.version !== 3) {
    throw new Error("A v3 vault session is required for new attachments.");
  }
  const totalChunks = Math.max(
    1,
    Math.ceil(bytes.length / ATTACHMENT_CHUNK_SIZE),
  );
  const uploadId = await beginAttachmentUpload(
    fileId,
    totalChunks,
    session.authToken,
  );
  try {
    const chunkIndexes = Array.from({ length: totalChunks }, (_, i) => i);
    let completed = 0;
    const results = await runWithConcurrency(
      chunkIndexes,
      ATTACHMENT_TRANSFER_CONCURRENCY,
      async (index) => {
        const start = index * ATTACHMENT_CHUNK_SIZE;
        const chunk = bytes.subarray(start, start + ATTACHMENT_CHUNK_SIZE);
        const payload = await encryptBytes(chunk, session, {
          fileId,
          chunkIndex: index,
          totalChunks,
        });
        await uploadEncryptedChunk(uploadId, index, payload, session.authToken);
        const result = {
          hash: await encryptedChunkDigest(payload),
          size: chunk.length,
        };
        completed += 1;
        onProgress?.(Math.round((completed / totalChunks) * 100));
        return result;
      },
    );
    const chunkHashes = results.map((result) => result.hash);
    const chunkSizes = results.map((result) => result.size);
    const manifest = await createV3AttachmentManifest(
      session,
      fileId,
      chunkHashes,
      chunkSizes,
    );
    await commitAttachmentUpload(uploadId, manifest, session.authToken);
    return manifest;
  } catch (error) {
    try {
      await abortAttachmentUpload(uploadId, session.authToken);
    } catch (cleanupError) {
      console.error("Staged attachment cleanup failed", cleanupError);
    }
    throw error;
  }
}

// Live files are always v3: every chunk is checked against the
// authenticated manifest before and after decryption.
export async function downloadAttachmentChunks(
  file: VaultStoredFile,
  session: VaultSession,
): Promise<Uint8Array[]> {
  if (!hasV3AttachmentManifest(file)) {
    throw new Error("The attachment manifest is missing or corrupted.");
  }
  if (!(await verifyV3AttachmentManifest(file, session))) {
    throw new Error("The attachment manifest authentication failed.");
  }
  const chunkIndexes = Array.from({ length: file.chunks }, (_, i) => i);
  return Promise.all(
    chunkIndexes.map(async (index) => {
      const payload = await downloadAttachmentEncryptedChunk(
        file.id,
        index,
        session.authToken,
      );
      if (
        payload.version !== 3 ||
        (await encryptedChunkDigest(payload)) !== file.chunkHashes[index]
      ) {
        throw new Error("The attachment chunk manifest does not match.");
      }
      const plaintext = await decryptBytes(payload, session, {
        fileId: file.id,
        chunkIndex: index,
        totalChunks: file.chunks,
      });
      if (plaintext.length !== file.chunkSizes[index]) {
        throw new Error("The attachment chunk size does not match.");
      }
      return plaintext;
    }),
  );
}

export async function downloadAttachmentBlob(
  attachment: VaultStoredFile & { mimeType: string },
  session: VaultSession,
): Promise<Blob> {
  const parts = await downloadAttachmentChunks(attachment, session);
  return new Blob(parts as BlobPart[], {
    type: attachment.mimeType || "application/octet-stream",
  });
}

export async function deleteAttachmentRemote(
  fileId: string,
  authToken: string,
) {
  await requestJson("/api/vault/files/delete", {
    method: "POST",
    body: JSON.stringify({ id: fileId }),
    authToken,
  });
}

function isRemoteAttachmentEntry(
  value: unknown,
): value is { id: string; committedAt: number } {
  if (typeof value !== "object" || value === null) return false;
  const { id, committedAt } = value as { id?: unknown; committedAt?: unknown };
  return (
    typeof id === "string" &&
    id.length > 0 &&
    typeof committedAt === "number" &&
    Number.isFinite(committedAt)
  );
}

// Every live manifest-tracked file on the server, oldest commit first. The
// server cannot tell which of these the encrypted vault still references, so
// the caller diffs this against the decrypted attachment ids.
export async function listRemoteAttachments(
  authToken: string,
): Promise<{ id: string; committedAt: number }[]> {
  const data = await requestJson<{ files?: unknown } | null>(
    "/api/vault/files/list",
    { authToken },
  );
  const files = data?.files;
  if (!Array.isArray(files) || !files.every(isRemoteAttachmentEntry)) {
    throw new Error("The file list response is invalid.");
  }
  return files.map(({ id, committedAt }) => ({ id, committedAt }));
}
