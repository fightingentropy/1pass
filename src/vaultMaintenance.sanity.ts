import type { VaultPayload } from "../functions/api/vault/schema";
import { cloneVaultAttachments } from "./vault/attachmentTransfer";
import {
  createVaultBackup,
  decryptVaultBackup,
  parseVaultBackup,
} from "./vault/backup";
import {
  createVaultSession,
  decryptBytes,
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
const sourceChunk = await encryptBytes(sourceBytes, sourceSession);
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
          chunks: 1,
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
check("backup includes encrypted attachment chunks", backup.attachments.length === 1);

const parsed = parseVaultBackup(JSON.parse(JSON.stringify(backup)));
const decoded = await decryptVaultBackup(
  parsed,
  "source-password-for-testing",
);
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
  writeChunk: async (fileId, chunkIndex, chunk) => {
    uploaded.set(`${fileId}:${chunkIndex}`, chunk);
  },
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
  ? await decryptBytes(uploadedChunk, targetSession)
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
