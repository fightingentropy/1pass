import {
  isVaultEncryptedPayload,
  type VaultAttachment,
  type VaultEncryptedPayload,
  type VaultPayload,
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
import { normalizeVault } from "./types";

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

export async function createVaultBackup(
  vault: VaultPayload,
  session: VaultSession,
  readChunk: (
    attachment: VaultAttachment,
    chunkIndex: number,
  ) => Promise<EncryptedChunk>,
  onProgress?: (label: string) => void,
): Promise<VaultBackup> {
  const allAttachments = vault.identities.flatMap(
    (identity) => identity.attachments,
  );
  const attachments: VaultBackupAttachment[] = [];
  for (const [fileIndex, attachment] of allAttachments.entries()) {
    const manifest = hasV3AttachmentManifest(attachment) ? attachment : null;
    if (attachment.envelopeVersion === 3 && !manifest) {
      throw new Error(`The manifest for "${attachment.name}" is invalid.`);
    }
    if (manifest && !(await verifyV3AttachmentManifest(manifest, session))) {
      throw new Error(
        `The manifest for "${attachment.name}" failed authentication.`,
      );
    }
    const chunks: EncryptedChunk[] = [];
    for (let index = 0; index < attachment.chunks; index += 1) {
      onProgress?.(
        `Backing up files (${fileIndex + 1}/${allAttachments.length}, chunk ${index + 1}/${attachment.chunks})…`,
      );
      const chunk = await readChunk(attachment, index);
      if (
        manifest &&
        (chunk.version !== 3 ||
          (await encryptedChunkDigest(chunk)) !== manifest.chunkHashes[index])
      ) {
        throw new Error(`A chunk for "${attachment.name}" was altered.`);
      }
      chunks.push(chunk);
    }
    attachments.push({ id: attachment.id, chunks });
  }

  return {
    app: VAULT_BACKUP_APP,
    version: VAULT_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    payload: await encryptVaultPayload(vault, session),
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
    referencedIds.add(attachment.id);
    const chunks = attachments.get(attachment.id);
    if (!chunks || chunks.length !== attachment.chunks) {
      throw new Error(`The backup is missing data for "${attachment.name}".`);
    }
  }
  if (attachments.size !== referencedIds.size) {
    throw new Error("The backup contains unreferenced attachment data.");
  }
  return { vault, session, attachments };
}
