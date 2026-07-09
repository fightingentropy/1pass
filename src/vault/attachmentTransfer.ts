import type {
  VaultAttachment,
  VaultPayload,
} from "../../functions/api/vault/schema";
import {
  decryptBytes,
  encryptBytes,
  type EncryptedChunk,
  type VaultSession,
} from "../vaultCrypto";
import { createId } from "./types";

export type AttachmentCloneResult = {
  vault: VaultPayload;
  stagedIds: string[];
  sourceIds: string[];
};

type CloneAttachmentOptions = {
  vault: VaultPayload;
  sourceSession: VaultSession;
  targetSession: VaultSession;
  readChunk: (
    attachment: VaultAttachment,
    chunkIndex: number,
  ) => Promise<EncryptedChunk>;
  writeChunk: (
    fileId: string,
    chunkIndex: number,
    chunk: EncryptedChunk,
  ) => Promise<void>;
  cleanupFile: (fileId: string) => Promise<void>;
  onProgress?: (label: string) => void;
};

export async function cloneVaultAttachments(
  options: CloneAttachmentOptions,
): Promise<AttachmentCloneResult> {
  const attachments = options.vault.identities.flatMap(
    (identity) => identity.attachments,
  );
  const stagedIds: string[] = [];
  const sourceIds = attachments.map((attachment) => attachment.id);
  let completed = 0;

  try {
    const identities = [];
    for (const identity of options.vault.identities) {
      const clonedAttachments: VaultAttachment[] = [];
      for (const attachment of identity.attachments) {
        const nextId = createId();
        stagedIds.push(nextId);
        for (let index = 0; index < attachment.chunks; index += 1) {
          options.onProgress?.(
            `Securing ${attachment.name} (${completed + 1}/${attachments.length}, chunk ${index + 1}/${attachment.chunks})…`,
          );
          const sourceChunk = await options.readChunk(attachment, index);
          const plaintext = await decryptBytes(
            sourceChunk,
            options.sourceSession,
          );
          const targetChunk = await encryptBytes(
            plaintext as Uint8Array<ArrayBuffer>,
            options.targetSession,
          );
          await options.writeChunk(nextId, index, targetChunk);
        }
        clonedAttachments.push({ ...attachment, id: nextId });
        completed += 1;
      }
      identities.push({ ...identity, attachments: clonedAttachments });
    }

    return {
      vault: { ...options.vault, identities },
      stagedIds,
      sourceIds,
    };
  } catch (error) {
    await Promise.all(
      stagedIds.map(async (fileId) => {
        try {
          await options.cleanupFile(fileId);
        } catch (cleanupError) {
          console.error("Staged attachment cleanup failed", cleanupError);
        }
      }),
    );
    throw error;
  }
}
