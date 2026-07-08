import {
  VAULT_AUTH_HEADER,
  type VaultAttachment,
  type VaultEncryptedPayload,
  type VaultMeta,
} from "../../functions/api/vault/schema";
import {
  decryptBytes,
  encryptBytes,
  isEncryptedChunk,
  type VaultSession,
} from "../vaultCrypto";
import { ATTACHMENT_CHUNK_SIZE } from "./types";

// In local Vite dev, always hit same-origin /api (proxied to the deployed
 // Pages Functions). Cross-origin VITE_API_BASE fails when ALLOWED_ORIGIN is
 // production-only. Production builds still use VITE_API_BASE when set.
const apiBase = import.meta.env.DEV
  ? ""
  : (import.meta.env.VITE_API_BASE as string | undefined)
      ?.trim()
      .replace(/\/+$/, "");

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

async function requestJson<T>(
  path: string,
  init?: RequestInit & { authToken?: string },
) {
  const url = apiBase ? `${apiBase}${path}` : path;
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (init?.body) {
    headers["content-type"] = "application/json";
  }
  if (init?.authToken) {
    headers[VAULT_AUTH_HEADER] = init.authToken;
  }
  const response = await fetch(url, {
    ...init,
    headers,
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
) {
  await requestJson("/api/vault/init", {
    method: "POST",
    body: JSON.stringify({ payload }),
    authToken,
  });
}

export async function loadVaultRecord(authToken: string) {
  const data = await requestJson<{ payload: unknown }>("/api/vault/load", {
    authToken,
  });
  return data.payload;
}

export async function saveVaultRecord(
  payload: VaultEncryptedPayload,
  authToken: string,
) {
  await requestJson("/api/vault/save", {
    method: "POST",
    body: JSON.stringify({ payload }),
    authToken,
  });
}

export async function uploadAttachmentBytes(
  fileId: string,
  bytes: Uint8Array<ArrayBuffer>,
  session: VaultSession,
  onProgress?: (percent: number) => void,
): Promise<number> {
  const totalChunks = Math.max(1, Math.ceil(bytes.length / ATTACHMENT_CHUNK_SIZE));
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * ATTACHMENT_CHUNK_SIZE;
    const chunk = bytes.subarray(start, start + ATTACHMENT_CHUNK_SIZE);
    const payload = await encryptBytes(chunk, session);
    await requestJson("/api/vault/files/upload", {
      method: "POST",
      body: JSON.stringify({ id: fileId, chunkIndex: index, payload }),
      authToken: session.authToken,
    });
    onProgress?.(Math.round(((index + 1) / totalChunks) * 100));
  }
  return totalChunks;
}

export async function downloadAttachmentChunks(
  attachment: VaultAttachment,
  session: VaultSession,
): Promise<Uint8Array[]> {
  const chunkIndexes = Array.from({ length: attachment.chunks }, (_, i) => i);
  return Promise.all(
    chunkIndexes.map(async (index) => {
      const data = await requestJson<{ payload: unknown }>(
        `/api/vault/files/get?id=${encodeURIComponent(attachment.id)}&chunk=${index}`,
        { authToken: session.authToken },
      );
      if (!isEncryptedChunk(data?.payload)) {
        throw new Error("File data is missing or corrupted.");
      }
      return decryptBytes(data.payload, session);
    }),
  );
}

export async function downloadAttachmentBlob(
  attachment: VaultAttachment,
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
  try {
    await requestJson("/api/vault/files/delete", {
      method: "POST",
      body: JSON.stringify({ id: fileId }),
      authToken,
    });
  } catch (deleteError) {
    console.error("Attachment delete failed", deleteError);
  }
}

// Fetches an attachment's encrypted chunks and returns the raw decrypted
// bytes per chunk, trying the old session first and falling back to the new
// one — used by the v1→v2 migration so it stays idempotent if a previous
// migration attempt was interrupted partway through.
export async function migrateAttachmentEncryption(
  attachment: VaultAttachment,
  oldSession: VaultSession,
  newSession: VaultSession,
) {
  const chunkIndexes = Array.from({ length: attachment.chunks }, (_, i) => i);
  for (const index of chunkIndexes) {
    const data = await requestJson<{ payload: unknown }>(
      `/api/vault/files/get?id=${encodeURIComponent(attachment.id)}&chunk=${index}`,
      { authToken: newSession.authToken },
    );
    if (!isEncryptedChunk(data?.payload)) {
      throw new Error(`File data is missing for "${attachment.name}".`);
    }

    let plainChunk: Uint8Array;
    try {
      plainChunk = await decryptBytes(data.payload, oldSession);
    } catch {
      // Already re-encrypted by an earlier, interrupted migration run.
      await decryptBytes(data.payload, newSession);
      continue;
    }

    const reencrypted = await encryptBytes(
      plainChunk as Uint8Array<ArrayBuffer>,
      newSession,
    );
    await requestJson("/api/vault/files/upload", {
      method: "POST",
      body: JSON.stringify({ id: attachment.id, chunkIndex: index, payload: reencrypted }),
      authToken: newSession.authToken,
    });
  }
}
