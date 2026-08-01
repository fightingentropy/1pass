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

if (failures > 0) {
  throw new Error(`${failures} vault maintenance sanity check(s) failed.`);
}
console.log("All cases passed.");
