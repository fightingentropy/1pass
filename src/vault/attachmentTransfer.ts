import type {
  VaultAttachment,
  VaultPayload,
} from "../../functions/api/vault/schema";
import {
  createV3AttachmentManifest,
  decryptBytes,
  encryptedChunkDigest,
  encryptBytes,
  hasV3AttachmentManifest,
  type EncryptedChunk,
  type VaultSession,
  verifyV3AttachmentManifest,
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
  beginUpload: (fileId: string, totalChunks: number) => Promise<string>;
  writeChunk: (
    uploadId: string,
    chunkIndex: number,
    chunk: EncryptedChunk,
  ) => Promise<void>;
  commitUpload: (
    uploadId: string,
    manifest: Pick<
      VaultAttachment,
      | "chunks"
      | "envelopeVersion"
      | "chunkHashes"
      | "chunkSizes"
      | "manifestMac"
    >,
  ) => Promise<void>;
  abortUpload: (uploadId: string) => Promise<void>;
  cleanupFile: (fileId: string) => Promise<void>;
  onProgress?: (label: string) => void;
};

export async function cloneVaultAttachments(
  options: CloneAttachmentOptions,
): Promise<AttachmentCloneResult> {
  if (options.targetSession.version !== 3) {
    throw new Error("Attachment cloning requires a v3 target vault session.");
  }
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
        const sourceManifest = hasV3AttachmentManifest(attachment)
          ? attachment
          : null;
        if (attachment.envelopeVersion === 3 && !sourceManifest) {
          throw new Error(`The manifest for "${attachment.name}" is invalid.`);
        }
        if (
          sourceManifest &&
          !(await verifyV3AttachmentManifest(
            sourceManifest,
            options.sourceSession,
          ))
        ) {
          throw new Error(
            `The manifest for "${attachment.name}" failed authentication.`,
          );
        }
        const nextId = createId();
        stagedIds.push(nextId);
        const uploadId = await options.beginUpload(nextId, attachment.chunks);
        const chunkHashes: string[] = [];
        const chunkSizes: number[] = [];
        try {
          for (let index = 0; index < attachment.chunks; index += 1) {
            options.onProgress?.(
              `Securing ${attachment.name} (${completed + 1}/${attachments.length}, chunk ${index + 1}/${attachment.chunks})…`,
            );
            const sourceChunk = await options.readChunk(attachment, index);
            if (
              sourceManifest &&
              (sourceChunk.version !== 3 ||
                (await encryptedChunkDigest(sourceChunk)) !==
                  sourceManifest.chunkHashes[index])
            ) {
              throw new Error(`A chunk for "${attachment.name}" was altered.`);
            }
            const plaintext = await decryptBytes(
              sourceChunk,
              options.sourceSession,
              {
                fileId: attachment.id,
                chunkIndex: index,
                totalChunks: attachment.chunks,
              },
            );
            if (
              sourceManifest &&
              plaintext.length !== sourceManifest.chunkSizes[index]
            ) {
              throw new Error(
                `A chunk for "${attachment.name}" has the wrong size.`,
              );
            }
            const targetChunk = await encryptBytes(
              plaintext as Uint8Array<ArrayBuffer>,
              options.targetSession,
              {
                fileId: nextId,
                chunkIndex: index,
                totalChunks: attachment.chunks,
              },
            );
            await options.writeChunk(uploadId, index, targetChunk);
            chunkHashes.push(await encryptedChunkDigest(targetChunk));
            chunkSizes.push(plaintext.length);
          }
          const targetManifest = await createV3AttachmentManifest(
            options.targetSession,
            nextId,
            chunkHashes,
            chunkSizes,
          );
          await options.commitUpload(uploadId, targetManifest);
          clonedAttachments.push({
            ...attachment,
            id: nextId,
            ...targetManifest,
          });
        } catch (error) {
          try {
            await options.abortUpload(uploadId);
          } catch (cleanupError) {
            console.error("Staged attachment cleanup failed", cleanupError);
          }
          throw error;
        }
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
