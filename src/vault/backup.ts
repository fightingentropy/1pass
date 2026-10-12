import {
  isVaultEncryptedPayload,
  type VaultEncryptedPayload,
  type VaultPayload,
  type VaultStoredFile,
} from "../../functions/api/vault/schema";
import {
  decryptVaultPayload,
  encryptedChunkDigest,
  encryptVaultPayload,
  hasV3AttachmentManifest,
  isEncryptedChunk,
  restoreVaultSession,
  type EncryptedChunk,
  type VaultSession,
  verifyV3AttachmentManifest,
} from "../vaultCrypto";
import {
  ATTACHMENT_TRANSFER_CONCURRENCY,
  runWithConcurrency,
} from "./concurrency";
import { attachmentFileIds, normalizeVault } from "./types";

export const VAULT_BACKUP_APP = "1pass-vault-backup";
export const VAULT_BACKUP_VERSION = 2;

export type VaultBackupAttachment = {
  id: string;
  chunks: EncryptedChunk[];
};

export type VaultBackup = {
  app: typeof VAULT_BACKUP_APP;
  version: typeof VAULT_BACKUP_VERSION;
  exportedAt: string;
  payload: VaultEncryptedPayload;
  attachments: VaultBackupAttachment[];
};

function readBackupAttachment(value: unknown): VaultBackupAttachment | null {
  if (!value || typeof value !== "object") return null;
  const id = "id" in value ? value.id : null;
  const chunks = "chunks" in value ? value.chunks : null;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    !Array.isArray(chunks) ||
    chunks.length === 0 ||
    chunks.length > 64 ||
    !chunks.every(isEncryptedChunk)
  ) {
    return null;
  }
  return { id, chunks };
}

export function parseVaultBackup(value: unknown): VaultBackup {
  if (!value || typeof value !== "object") {
    throw new Error("This file is not a 1Pass backup.");
  }
  const app = "app" in value ? value.app : null;
  const version = "version" in value ? value.version : null;
  const exportedAt = "exportedAt" in value ? value.exportedAt : null;
  const payload = "payload" in value ? value.payload : null;
  const rawAttachments = "attachments" in value ? value.attachments : null;
  if (app !== VAULT_BACKUP_APP || version !== VAULT_BACKUP_VERSION) {
    throw new Error(
      "This backup is from an older format that did not include attachment files.",
    );
  }
  if (
    typeof exportedAt !== "string" ||
    !isVaultEncryptedPayload(payload) ||
    !Array.isArray(rawAttachments)
  ) {
    throw new Error("The backup header is invalid or corrupted.");
  }
  const attachments = rawAttachments.map(readBackupAttachment);
  if (attachments.some((attachment) => attachment === null)) {
    throw new Error("The backup contains invalid attachment data.");
  }
  const typedAttachments = attachments as VaultBackupAttachment[];
  if (new Set(typedAttachments.map((attachment) => attachment.id)).size !== typedAttachments.length) {
    throw new Error("The backup contains duplicate attachment records.");
  }
  return {
    app: VAULT_BACKUP_APP,
    version: VAULT_BACKUP_VERSION,
    exportedAt,
    payload,
    attachments: typedAttachments,
  };
}

// Collects the encrypted chunks of every attachment and preview. The chunks
// are copied as stored, so the backup decrypts only with this vault's
// password. An unreadable preview is left out and unlinked from the backed-up
// vault rather than failing the whole backup.
export async function createVaultBackup(
  vault: VaultPayload,
  session: VaultSession,
  readChunk: (
    file: VaultStoredFile,
    chunkIndex: number,
    label: string,
  ) => Promise<EncryptedChunk>,
  onProgress?: (label: string) => void,
): Promise<VaultBackup> {
  const allAttachments = vault.identities.flatMap(
    (identity) => identity.attachments,
  );
  const attachments: VaultBackupAttachment[] = [];
  const droppedPreviewIds = new Set<string>();

  const readFile = async (
    file: VaultStoredFile,
    label: string,
    onChunk?: (done: number) => void,
  ) => {
    const manifest = hasV3AttachmentManifest(file) ? file : null;
    if (file.envelopeVersion === 3 && !manifest) {
      throw new Error(`The manifest for "${label}" is invalid.`);
    }
    if (manifest && !(await verifyV3AttachmentManifest(manifest, session))) {
      throw new Error(`The manifest for "${label}" failed authentication.`);
    }
    const chunkIndexes = Array.from({ length: file.chunks }, (_, i) => i);
    let done = 0;
    return runWithConcurrency(
      chunkIndexes,
      ATTACHMENT_TRANSFER_CONCURRENCY,
      async (index) => {
        const chunk = await readChunk(file, index, label);
        if (
          manifest &&
          (chunk.version !== 3 ||
            (await encryptedChunkDigest(chunk)) !== manifest.chunkHashes[index])
        ) {
          throw new Error(`A chunk for "${label}" was altered.`);
        }
        done += 1;
        onChunk?.(done);
        return chunk;
      },
    );
  };

  for (const [fileIndex, attachment] of allAttachments.entries()) {
    const position = `${fileIndex + 1}/${allAttachments.length}`;
    onProgress?.(`Backing up files (${position})…`);
    const chunks = await readFile(attachment, attachment.name, (done) =>
      onProgress?.(
        `Backing up files (${position}, chunk ${done}/${attachment.chunks})…`,
      ),
    );
    attachments.push({ id: attachment.id, chunks });
    if (attachment.preview) {
      try {
        const previewChunks = await readFile(
          attachment.preview,
          `${attachment.name} preview`,
        );
        attachments.push({ id: attachment.preview.id, chunks: previewChunks });
      } catch (previewError) {
        console.error(
          `Left the preview of "${attachment.name}" out of the backup`,
          previewError,
        );
        droppedPreviewIds.add(attachment.preview.id);
      }
    }
  }

  const backedUpVault: VaultPayload =
    droppedPreviewIds.size === 0
      ? vault
      : {
          ...vault,
          identities: vault.identities.map((identity) => ({
            ...identity,
            attachments: identity.attachments.map((attachment) => {
              if (!attachment.preview || !droppedPreviewIds.has(attachment.preview.id)) {
                return attachment;
              }
              const { preview: _dropped, ...rest } = attachment;
              return rest;
            }),
          })),
        };

  return {
    app: VAULT_BACKUP_APP,
    version: VAULT_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    payload: await encryptVaultPayload(backedUpVault, session),
    attachments,
  };
}

export async function decryptVaultBackup(
  backup: VaultBackup,
  password: string,
): Promise<{
  vault: VaultPayload;
  session: VaultSession;
  attachments: Map<string, EncryptedChunk[]>;
}> {
  const session = await restoreVaultSession(password, {
    version: backup.payload.version,
    kdf: backup.payload.kdf,
  });
  let decrypted: unknown;
  try {
    decrypted = await decryptVaultPayload(backup.payload, session);
  } catch {
    throw new Error("The backup password is incorrect.");
  }
  const vault = normalizeVault(decrypted);
  const attachments = new Map(
    backup.attachments.map((attachment) => [attachment.id, attachment.chunks]),
  );
  // Every attachment's data must be present. A preview's data is optional:
  // restore drops a preview it cannot read instead of failing.
  const referencedIds = new Set<string>();
  for (const attachment of vault.identities.flatMap(
    (identity) => identity.attachments,
  )) {
    if (
      attachment.envelopeVersion === 3 &&
      !(await verifyV3AttachmentManifest(attachment, session))
    ) {
      throw new Error(
        `The manifest for "${attachment.name}" failed authentication.`,
      );
    }
    for (const id of attachmentFileIds(attachment)) referencedIds.add(id);
    const chunks = attachments.get(attachment.id);
    if (!chunks || chunks.length !== attachment.chunks) {
      throw new Error(`The backup is missing data for "${attachment.name}".`);
    }
  }
  for (const id of attachments.keys()) {
    if (!referencedIds.has(id)) {
      throw new Error("The backup contains unreferenced attachment data.");
    }
  }
  return { vault, session, attachments };
}
