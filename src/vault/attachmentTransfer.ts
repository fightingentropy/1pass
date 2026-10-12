import type {
  VaultAttachment,
  VaultAttachmentPreview,
  VaultPayload,
  VaultStoredFile,
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
import {
  ATTACHMENT_TRANSFER_CONCURRENCY,
  runWithConcurrency,
} from "./concurrency";
import { attachmentFileIds, createId } from "./types";

export type AttachmentCloneResult = {
  vault: VaultPayload;
  stagedIds: string[];
  sourceIds: string[];
};

type StoredManifest = Pick<
  VaultStoredFile,
  "chunks" | "envelopeVersion" | "chunkHashes" | "chunkSizes" | "manifestMac"
>;

type CloneAttachmentOptions = {
  vault: VaultPayload;
  sourceSession: VaultSession;
  targetSession: VaultSession;
  // `label` names the file in error messages.
  readChunk: (
    file: VaultStoredFile,
    chunkIndex: number,
    label: string,
  ) => Promise<EncryptedChunk>;
  beginUpload: (fileId: string, totalChunks: number) => Promise<string>;
  writeChunk: (
    uploadId: string,
    chunkIndex: number,
    chunk: EncryptedChunk,
  ) => Promise<void>;
  commitUpload: (uploadId: string, manifest: StoredManifest) => Promise<void>;
  abortUpload: (uploadId: string) => Promise<void>;
  cleanupFile: (fileId: string) => Promise<void>;
  onProgress?: (label: string) => void;
};

// Re-encrypts every attachment, and each image's preview, under fresh file
// ids with the target session. Nothing references the new ids until the
// caller saves the returned vault, so a failure only leaves staged copies,
// which are deleted before the error is rethrown.
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
  const sourceIds = attachments.flatMap(attachmentFileIds);

  const cloneFile = async (
    file: VaultStoredFile,
    label: string,
    onChunk?: (done: number) => void,
  ): Promise<VaultStoredFile> => {
    const sourceManifest = hasV3AttachmentManifest(file) ? file : null;
    if (file.envelopeVersion === 3 && !sourceManifest) {
      throw new Error(`The manifest for "${label}" is invalid.`);
    }
    if (
      sourceManifest &&
      !(await verifyV3AttachmentManifest(sourceManifest, options.sourceSession))
    ) {
      throw new Error(`The manifest for "${label}" failed authentication.`);
    }
    const nextId = createId();
    stagedIds.push(nextId);
    const uploadId = await options.beginUpload(nextId, file.chunks);
    try {
      const chunkIndexes = Array.from({ length: file.chunks }, (_, i) => i);
      let done = 0;
      const results = await runWithConcurrency(
        chunkIndexes,
        ATTACHMENT_TRANSFER_CONCURRENCY,
        async (index) => {
          const sourceChunk = await options.readChunk(file, index, label);
          if (
            sourceManifest &&
            (sourceChunk.version !== 3 ||
              (await encryptedChunkDigest(sourceChunk)) !==
                sourceManifest.chunkHashes[index])
          ) {
            throw new Error(`A chunk for "${label}" was altered.`);
          }
          const plaintext = await decryptBytes(
            sourceChunk,
            options.sourceSession,
            { fileId: file.id, chunkIndex: index, totalChunks: file.chunks },
          );
          if (
            sourceManifest &&
            plaintext.length !== sourceManifest.chunkSizes[index]
          ) {
            throw new Error(`A chunk for "${label}" has the wrong size.`);
          }
          const targetChunk = await encryptBytes(
            plaintext as Uint8Array<ArrayBuffer>,
            options.targetSession,
            { fileId: nextId, chunkIndex: index, totalChunks: file.chunks },
          );
          await options.writeChunk(uploadId, index, targetChunk);
          const result = {
            hash: await encryptedChunkDigest(targetChunk),
            size: plaintext.length,
          };
          done += 1;
          onChunk?.(done);
          return result;
        },
      );
      const targetManifest = await createV3AttachmentManifest(
        options.targetSession,
        nextId,
        results.map((result) => result.hash),
        results.map((result) => result.size),
      );
      await options.commitUpload(uploadId, targetManifest);
      return { id: nextId, ...targetManifest };
    } catch (error) {
      try {
        await options.abortUpload(uploadId);
      } catch (cleanupError) {
        console.error("Staged attachment cleanup failed", cleanupError);
      }
      throw error;
    }
  };

  try {
    let completed = 0;
    const identities = [];
    for (const identity of options.vault.identities) {
      const clonedAttachments: VaultAttachment[] = [];
      for (const attachment of identity.attachments) {
        const position = `${completed + 1}/${attachments.length}`;
        options.onProgress?.(`Securing ${attachment.name} (${position})…`);
        const file = await cloneFile(attachment, attachment.name, (done) =>
          options.onProgress?.(
            `Securing ${attachment.name} (${position}, chunk ${done}/${attachment.chunks})…`,
          ),
        );
        let preview: VaultAttachmentPreview | undefined;
        if (attachment.preview) {
          try {
            preview = {
              ...attachment.preview,
              ...(await cloneFile(
                attachment.preview,
                `${attachment.name} preview`,
              )),
            };
          } catch (previewError) {
            // A thumbnail is disposable. A missing or unreadable one must not
            // block a password change or a restore; the file keeps working.
            console.error(
              `Dropped the preview of "${attachment.name}"`,
              previewError,
            );
          }
        }
        const { preview: _sourcePreview, ...rest } = attachment;
        clonedAttachments.push({
          ...rest,
          ...file,
          ...(preview ? { preview } : {}),
        });
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
