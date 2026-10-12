import type { VaultPayload } from "../functions/api/vault/schema";
import { cloneVaultAttachments } from "./vault/attachmentTransfer";
import {
  createVaultBackup,
  decryptVaultBackup,
  parseVaultBackup,
} from "./vault/backup";
import {
  createVaultSession,
  createV3AttachmentManifest,
  decryptBytes,
  encryptedChunkDigest,
  encryptBytes,
  type EncryptedChunk,
} from "./vaultCrypto";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.error(`  [FAIL] ${label}`);
    failures += 1;
  }
}

console.log("Vault maintenance: complete backup and attachment re-key");
const sourceSession = await createVaultSession("source-password-for-testing");
const targetSession = await createVaultSession("target-password-for-testing");
const sourceBytes = new TextEncoder().encode("encrypted attachment contents");
const sourceContext = {
  fileId: "attachment-1",
  chunkIndex: 0,
  totalChunks: 1,
};
const sourceChunk = await encryptBytes(
  sourceBytes,
  sourceSession,
  sourceContext,
);
const sourceManifest = await createV3AttachmentManifest(
  sourceSession,
  sourceContext.fileId,
  [await encryptedChunkDigest(sourceChunk)],
  [sourceBytes.length],
);
const now = Date.now();
const vault: VaultPayload = {
  identities: [
    {
      id: "identity-1",
      firstName: "Backup",
      lastName: "Test",
      email: "",
      phone: "",
      address: "",
      nino: "",
      nhsNumber: "",
      passNumber: "",
      utr: "",
      govGatewayId: "",
      notes: "",
      attachments: [
        {
          id: "attachment-1",
          name: "proof.txt",
          mimeType: "text/plain",
          size: sourceBytes.length,
          ...sourceManifest,
          thumb: "",
          createdAt: now,
        },
      ],
      credentials: [],
      createdAt: now,
      updatedAt: now,
    },
  ],
  apiKeys: [],
};

const backup = await createVaultBackup(
  vault,
  sourceSession,
  async () => sourceChunk,
);
check(
  "backup includes encrypted attachment chunks",
  backup.attachments.length === 1,
);

const parsed = parseVaultBackup(JSON.parse(JSON.stringify(backup)));
const decoded = await decryptVaultBackup(parsed, "source-password-for-testing");
check("backup metadata decrypts", decoded.vault.identities.length === 1);
check(
  "backup attachment matches metadata",
  decoded.attachments.get("attachment-1")?.length === 1,
);

const uploaded = new Map<string, EncryptedChunk>();
const cloned = await cloneVaultAttachments({
  vault: decoded.vault,
  sourceSession: decoded.session,
  targetSession,
  readChunk: async (attachment, chunkIndex) => {
    const chunk = decoded.attachments.get(attachment.id)?.[chunkIndex];
    if (!chunk) throw new Error("missing test chunk");
    return chunk;
  },
  beginUpload: async (fileId) => fileId,
  writeChunk: async (uploadId, chunkIndex, chunk) => {
    uploaded.set(`${uploadId}:${chunkIndex}`, chunk);
  },
  commitUpload: async () => {},
  abortUpload: async () => {},
  cleanupFile: async () => {},
});

const nextAttachment = cloned.vault.identities[0]?.attachments[0];
check(
  "restore stages attachment under a fresh id",
  Boolean(nextAttachment && nextAttachment.id !== "attachment-1"),
);
const uploadedChunk = nextAttachment
  ? uploaded.get(`${nextAttachment.id}:0`)
  : undefined;
const restoredBytes = uploadedChunk
  ? await decryptBytes(uploadedChunk, targetSession, {
      fileId: nextAttachment?.id ?? "missing",
      chunkIndex: 0,
      totalChunks: 1,
    })
  : new Uint8Array();
check(
  "staged attachment decrypts with the replacement key",
  new TextDecoder().decode(restoredBytes) ===
    new TextDecoder().decode(sourceBytes),
);

console.log("Vault maintenance: separately stored previews");
const previewBytes = new TextEncoder().encode("jpeg preview bytes");
const previewChunk = await encryptBytes(previewBytes, sourceSession, {
  fileId: "preview-1",
  chunkIndex: 0,
  totalChunks: 1,
});
const previewManifest = await createV3AttachmentManifest(
  sourceSession,
  "preview-1",
  [await encryptedChunkDigest(previewChunk)],
  [previewBytes.length],
);
const sourceAttachment = vault.identities[0]!.attachments[0]!;
const vaultWithPreview: VaultPayload = {
  ...vault,
  identities: [
    {
      ...vault.identities[0]!,
      attachments: [
        {
          ...sourceAttachment,
          preview: {
            id: "preview-1",
            mimeType: "image/jpeg",
            size: previewBytes.length,
            ...previewManifest,
          },
        },
      ],
    },
  ],
};
const storedChunks = new Map<string, EncryptedChunk[]>([
  ["attachment-1", [sourceChunk]],
  ["preview-1", [previewChunk]],
]);
const readStored = async (file: { id: string }, chunkIndex: number) => {
  const chunk = storedChunks.get(file.id)?.[chunkIndex];
  if (!chunk) throw new Error(`missing test chunk for ${file.id}`);
  return chunk;
};

const previewBackup = await createVaultBackup(
  vaultWithPreview,
  sourceSession,
  readStored,
);
check(
  "backup carries the preview as its own file",
  previewBackup.attachments.map((entry) => entry.id).sort().join(",") ===
    "attachment-1,preview-1",
);
const decodedPreview = await decryptVaultBackup(
  parseVaultBackup(JSON.parse(JSON.stringify(previewBackup))),
  "source-password-for-testing",
);
check(
  "restored metadata keeps the preview reference",
  decodedPreview.vault.identities[0]?.attachments[0]?.preview?.id === "preview-1",
);

const previewUploads = new Map<string, EncryptedChunk>();
const clonedPreview = await cloneVaultAttachments({
  vault: decodedPreview.vault,
  sourceSession: decodedPreview.session,
  targetSession,
  readChunk: async (file, chunkIndex) => {
    const chunk = decodedPreview.attachments.get(file.id)?.[chunkIndex];
    if (!chunk) throw new Error("missing test chunk");
    return chunk;
  },
  beginUpload: async (fileId) => fileId,
  writeChunk: async (uploadId, chunkIndex, chunk) => {
    previewUploads.set(`${uploadId}:${chunkIndex}`, chunk);
  },
  commitUpload: async () => {},
  abortUpload: async () => {},
  cleanupFile: async () => {},
});
const rekeyed = clonedPreview.vault.identities[0]?.attachments[0];
const rekeyedPreview = rekeyed?.preview;
check(
  "re-key gives the preview its own fresh id",
  Boolean(
    rekeyedPreview &&
      rekeyedPreview.id !== "preview-1" &&
      rekeyedPreview.id !== rekeyed?.id,
  ),
);
const rekeyedPreviewChunk = rekeyedPreview
  ? previewUploads.get(`${rekeyedPreview.id}:0`)
  : undefined;
const rekeyedPreviewBytes = rekeyedPreviewChunk
  ? await decryptBytes(rekeyedPreviewChunk, targetSession, {
      fileId: rekeyedPreview!.id,
      chunkIndex: 0,
      totalChunks: 1,
    })
  : new Uint8Array();
check(
  "re-keyed preview decrypts with the replacement key",
  new TextDecoder().decode(rekeyedPreviewBytes) ===
    new TextDecoder().decode(previewBytes),
);
check(
  "old preview is scheduled for cleanup after re-key",
  clonedPreview.sourceIds.includes("preview-1") &&
    clonedPreview.stagedIds.length === 2,
);

const withoutPreviewData = await createVaultBackup(
  vaultWithPreview,
  sourceSession,
  async (file, chunkIndex) => {
    if (file.id === "preview-1") throw new Error("preview unavailable");
    return readStored(file, chunkIndex);
  },
);
const decodedWithoutPreview = await decryptVaultBackup(
  withoutPreviewData,
  "source-password-for-testing",
);
check(
  "an unreadable preview is left out of the backup instead of failing it",
  withoutPreviewData.attachments.length === 1 &&
    !decodedWithoutPreview.vault.identities[0]?.attachments[0]?.preview,
);

const droppedPreview = await cloneVaultAttachments({
  vault: vaultWithPreview,
  sourceSession,
  targetSession,
  readChunk: async (file, chunkIndex) => {
    if (file.id === "preview-1") throw new Error("preview unavailable");
    return readStored(file, chunkIndex);
  },
  beginUpload: async (fileId) => fileId,
  writeChunk: async () => {},
  commitUpload: async () => {},
  abortUpload: async () => {},
  cleanupFile: async () => {},
});
check(
  "an unreadable preview is dropped instead of failing the re-key",
  droppedPreview.vault.identities[0]?.attachments.length === 1 &&
    !droppedPreview.vault.identities[0]?.attachments[0]?.preview,
);

let strayRejected = false;
try {
  await decryptVaultBackup(
    {
      ...previewBackup,
      attachments: [
        ...previewBackup.attachments,
        { id: "stray-file", chunks: [sourceChunk] },
      ],
    },
    "source-password-for-testing",
  );
} catch {
  strayRejected = true;
}
check("backup data that nothing references is still rejected", strayRejected);

if (failures > 0) {
  throw new Error(`${failures} vault maintenance sanity check(s) failed.`);
}
console.log("All cases passed.");
