import {
  isVaultEncryptedPayload,
  type VaultPayload,
} from "../../functions/api/vault/schema";
import {
  createVaultSession,
  decryptVaultPayload,
  encryptVaultPayload,
  restoreVaultSession,
  type VaultSession,
} from "../vaultCrypto";
import { cloneVaultAttachments } from "./attachmentTransfer";
import {
  createVaultBackup,
  decryptVaultBackup,
  parseVaultBackup,
  type VaultBackup,
} from "./backup";
import {
  abortAttachmentUpload,
  beginAttachmentUpload,
  commitAttachmentUpload,
  deleteAttachmentRemote,
  downloadAttachmentEncryptedChunk,
  loadVaultRecord,
  rotateVaultRecord,
  saveVaultRecord,
  uploadEncryptedChunk,
} from "./api";
import { normalizeVault } from "./types";

type Progress = (label: string) => void;

async function cleanupFiles(ids: string[], authToken: string) {
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        await deleteAttachmentRemote(id, authToken);
        return true;
      } catch (cleanupError) {
        console.error("Encrypted file cleanup failed", cleanupError);
        return false;
      }
    }),
  );
  return results.filter((removed) => !removed).length;
}

export async function buildCompleteBackup(
  vault: VaultPayload,
  session: VaultSession,
  onProgress: Progress,
): Promise<VaultBackup> {
  return createVaultBackup(
    vault,
    session,
    (attachment, chunkIndex) =>
      downloadAttachmentEncryptedChunk(
        attachment.id,
        chunkIndex,
        session.authToken,
      ),
    onProgress,
  );
}

export async function restoreCompleteBackup(options: {
  file: File;
  password: string;
  currentVault: VaultPayload;
  currentSession: VaultSession;
  revision: number;
  onProgress: Progress;
}): Promise<{
  vault: VaultPayload;
  revision: number;
  cleanupFailures: number;
}> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(await options.file.text());
  } catch {
    throw new Error("The selected backup is not valid JSON.");
  }
  const backup = parseVaultBackup(parsedJson);
  options.onProgress("Decrypting backup…");
  const decoded = await decryptVaultBackup(backup, options.password);
  const replacedFileIds = options.currentVault.identities.flatMap((identity) =>
    identity.attachments.map((attachment) => attachment.id),
  );

  const cloned = await cloneVaultAttachments({
    vault: decoded.vault,
    sourceSession: decoded.session,
    targetSession: options.currentSession,
    readChunk: async (attachment, chunkIndex) => {
      const chunks = decoded.attachments.get(attachment.id);
      const chunk = chunks?.[chunkIndex];
      if (!chunk) {
        throw new Error(`The backup is missing data for "${attachment.name}".`);
      }
      return chunk;
    },
    beginUpload: (fileId, totalChunks) =>
      beginAttachmentUpload(
        fileId,
        totalChunks,
        options.currentSession.authToken,
      ),
    writeChunk: (uploadId, chunkIndex, chunk) =>
      uploadEncryptedChunk(
        uploadId,
        chunkIndex,
        chunk,
        options.currentSession.authToken,
      ),
    commitUpload: (uploadId, manifest) =>
      commitAttachmentUpload(
        uploadId,
        manifest,
        options.currentSession.authToken,
      ),
    abortUpload: (uploadId) =>
      abortAttachmentUpload(uploadId, options.currentSession.authToken),
    cleanupFile: (fileId) =>
      deleteAttachmentRemote(fileId, options.currentSession.authToken),
    onProgress: options.onProgress,
  });

  try {
    options.onProgress("Replacing vault…");
    const encryptedPayload = await encryptVaultPayload(
      cloned.vault,
      options.currentSession,
    );
    const revision = await saveVaultRecord(
      encryptedPayload,
      options.currentSession.authToken,
      options.revision,
    );
    options.onProgress("Removing replaced files…");
    const cleanupFailures = await cleanupFiles(
      replacedFileIds,
      options.currentSession.authToken,
    );
    return { vault: cloned.vault, revision, cleanupFailures };
  } catch (error) {
    await cleanupFiles(cloned.stagedIds, options.currentSession.authToken);
    throw error;
  }
}

export async function rotateMasterPassword(options: {
  currentPassword: string;
  newPassword: string;
  vault: VaultPayload;
  currentSession: VaultSession;
  revision: number;
  onProgress: Progress;
}): Promise<{
  session: VaultSession;
  vault: VaultPayload;
  revision: number;
  cleanupFailures: number;
}> {
  const candidate = await restoreVaultSession(options.currentPassword, {
    version: options.currentSession.version,
    kdf: options.currentSession.kdf,
  });
  if (candidate.authToken !== options.currentSession.authToken) {
    throw new Error("The current master password is incorrect.");
  }

  options.onProgress("Deriving new encryption keys…");
  const nextSession = await createVaultSession(options.newPassword);
  const cloned = await cloneVaultAttachments({
    vault: options.vault,
    sourceSession: options.currentSession,
    targetSession: nextSession,
    readChunk: (attachment, chunkIndex) =>
      downloadAttachmentEncryptedChunk(
        attachment.id,
        chunkIndex,
        options.currentSession.authToken,
      ),
    beginUpload: (fileId, totalChunks) =>
      beginAttachmentUpload(
        fileId,
        totalChunks,
        options.currentSession.authToken,
      ),
    writeChunk: (uploadId, chunkIndex, chunk) =>
      uploadEncryptedChunk(
        uploadId,
        chunkIndex,
        chunk,
        options.currentSession.authToken,
      ),
    commitUpload: (uploadId, manifest) =>
      commitAttachmentUpload(
        uploadId,
        manifest,
        options.currentSession.authToken,
      ),
    abortUpload: (uploadId) =>
      abortAttachmentUpload(uploadId, options.currentSession.authToken),
    cleanupFile: (fileId) =>
      deleteAttachmentRemote(fileId, options.currentSession.authToken),
    onProgress: options.onProgress,
  });

  let committed = false;
  try {
    const encryptedPayload = await encryptVaultPayload(
      cloned.vault,
      nextSession,
    );
    options.onProgress("Changing master password…");
    let revision: number;
    try {
      revision = await rotateVaultRecord(
        encryptedPayload,
        options.currentSession.authToken,
        nextSession.authToken,
        options.revision,
      );
      committed = true;
    } catch (rotationError) {
      try {
        const record = await loadVaultRecord(nextSession.authToken);
        if (!isVaultEncryptedPayload(record.payload)) throw rotationError;
        const verified = normalizeVault(
          await decryptVaultPayload(record.payload, nextSession),
        );
        if (JSON.stringify(verified) !== JSON.stringify(cloned.vault)) {
          throw rotationError;
        }
        revision = record.revision;
        committed = true;
      } catch {
        throw rotationError;
      }
    }

    options.onProgress("Removing old encrypted files…");
    const cleanupFailures = await cleanupFiles(
      cloned.sourceIds,
      nextSession.authToken,
    );
    return {
      session: nextSession,
      vault: cloned.vault,
      revision,
      cleanupFailures,
    };
  } catch (error) {
    if (!committed) {
      await cleanupFiles(cloned.stagedIds, options.currentSession.authToken);
    }
    throw error;
  }
}
