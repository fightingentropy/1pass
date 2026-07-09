import {
  isVaultEncryptedPayload,
  type VaultEncryptedPayload,
  type VaultPayload,
} from "../../functions/api/vault/schema";
import {
  createVaultSession,
  decryptVaultPayload,
  encryptVaultPayload,
  restoreVaultSession,
  type VaultSession,
} from "../vaultCrypto";
import {
  isUnauthorizedError,
  loadVaultRecord,
  migrateAttachmentEncryption,
  readVaultMeta,
  saveVaultRecord,
} from "./api";
import { normalizeVault } from "./types";

const LEGACY_STORAGE_KEYS = {
  passwordHash: "vault.password.hash",
  passwordSalt: "vault.password.salt",
};
const PENDING_RECOVERY_KEY = "vault.pending-recovery.v1";

export type PendingRecovery = {
  payload: VaultEncryptedPayload;
  baseRevision: number;
  savedAt: number;
};

export function clearPendingRecovery() {
  localStorage.removeItem(PENDING_RECOVERY_KEY);
}

export function readPendingRecovery(): PendingRecovery | null {
  const raw = localStorage.getItem(PENDING_RECOVERY_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const payload = "payload" in parsed ? parsed.payload : null;
    const baseRevision = "baseRevision" in parsed ? parsed.baseRevision : null;
    const savedAt = "savedAt" in parsed ? parsed.savedAt : null;
    if (
      !isVaultEncryptedPayload(payload) ||
      typeof baseRevision !== "number" ||
      !Number.isInteger(baseRevision) ||
      baseRevision < 0 ||
      typeof savedAt !== "number" ||
      !Number.isFinite(savedAt)
    ) {
      clearPendingRecovery();
      return null;
    }
    return { payload, baseRevision, savedAt };
  } catch {
    clearPendingRecovery();
    return null;
  }
}

export async function storePendingRecovery(
  pendingVault: VaultPayload,
  activeSession: VaultSession,
  baseRevision: number,
) {
  const payload = await encryptVaultPayload(pendingVault, activeSession);
  const recovery: PendingRecovery = {
    payload,
    baseRevision,
    savedAt: Date.now(),
  };
  localStorage.setItem(PENDING_RECOVERY_KEY, JSON.stringify(recovery));
}

async function hashLegacyPassword(password: string, salt: string) {
  const encoded = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readLegacyPasswordMeta() {
  const hash = localStorage.getItem(LEGACY_STORAGE_KEYS.passwordHash);
  const salt = localStorage.getItem(LEGACY_STORAGE_KEYS.passwordSalt);
  if (!hash || !salt) return null;
  return { hash, salt };
}

export function clearLegacyPasswordMeta() {
  localStorage.removeItem(LEGACY_STORAGE_KEYS.passwordHash);
  localStorage.removeItem(LEGACY_STORAGE_KEYS.passwordSalt);
}

function readPendingMigrationKdf(
  decrypted: unknown,
): VaultEncryptedPayload["kdf"] | null {
  if (!decrypted || typeof decrypted !== "object") return null;
  const pending = (decrypted as Partial<VaultPayload>).pendingMigration;
  const kdf = pending?.kdf;
  if (
    kdf &&
    kdf.name === "PBKDF2" &&
    kdf.hash === "SHA-256" &&
    typeof kdf.iterations === "number" &&
    kdf.iterations > 0 &&
    typeof kdf.salt === "string" &&
    kdf.salt.length > 0
  ) {
    return kdf;
  }
  return null;
}

async function reencryptAllAttachments(
  vault: VaultPayload,
  oldSession: VaultSession,
  newSession: VaultSession,
  onProgress: (label: string) => void,
): Promise<number> {
  const attachments = vault.identities.flatMap(
    (identity) => identity.attachments,
  );
  let failed = 0;
  for (const [index, attachment] of attachments.entries()) {
    onProgress(`Re-encrypting files (${index + 1}/${attachments.length})…`);
    try {
      await migrateAttachmentEncryption(attachment, oldSession, newSession);
    } catch (migrateError) {
      console.error(
        `Attachment migration failed for "${attachment.name}"`,
        migrateError,
      );
      failed += 1;
    }
  }
  return failed;
}

async function migrateVaultToV2(
  password: string,
  vault: VaultPayload,
  oldSession: VaultSession,
  revision: number,
  bootstrapSecret: string,
  onProgress: (label: string) => void,
): Promise<{ session: VaultSession; revision: number }> {
  onProgress("Upgrading vault security…");
  const nextSession = await createVaultSession(password);
  const markedPayload = await encryptVaultPayload(
    { ...vault, pendingMigration: { kdf: oldSession.kdf } },
    nextSession,
  );
  let nextRevision = await saveVaultRecord(
    markedPayload,
    nextSession.authToken,
    revision,
    bootstrapSecret,
  );

  const failed = await reencryptAllAttachments(
    vault,
    oldSession,
    nextSession,
    onProgress,
  );

  onProgress("Upgrading vault security…");
  if (failed === 0) {
    const cleanPayload = await encryptVaultPayload(vault, nextSession);
    nextRevision = await saveVaultRecord(
      cleanPayload,
      nextSession.authToken,
      nextRevision,
    );
  }
  return { session: nextSession, revision: nextRevision };
}

export async function unlockVaultWithPassword(
  password: string,
  bootstrapSecret: string,
  onProgress: (label: string) => void,
  confirmLegacyAdoption: () => Promise<boolean>,
): Promise<{
  session: VaultSession;
  vault: VaultPayload;
  migrated: boolean;
  revision: number;
}> {
  const meta = await readVaultMeta();
  if (!meta.exists) {
    throw new Error("No vault exists yet. Reload the page to set one up.");
  }

  if (typeof meta.version === "number" && meta.version >= 1 && meta.kdf) {
    const session = await restoreVaultSession(password, {
      version: meta.version,
      kdf: meta.kdf,
    });

    let storedPayload: unknown;
    let revision = 0;
    try {
      const record = await loadVaultRecord(
        session.authToken,
        meta.requiresBootstrap ? bootstrapSecret : "",
      );
      storedPayload = record.payload;
      revision = record.revision;
    } catch (loadError) {
      if (isUnauthorizedError(loadError)) {
        throw new Error("Incorrect password. Try again.");
      }
      throw loadError;
    }

    if (!isVaultEncryptedPayload(storedPayload)) {
      throw new Error("Vault data is corrupted.");
    }

    let decrypted: unknown;
    try {
      decrypted = await decryptVaultPayload(storedPayload, session);
    } catch {
      throw new Error("Incorrect password. Try again.");
    }

    const pendingKdf = readPendingMigrationKdf(decrypted);
    const vault = normalizeVault(decrypted);

    if (session.version >= 2) {
      if (pendingKdf) {
        onProgress("Finishing security upgrade…");
        const oldSession = await restoreVaultSession(password, {
          version: 1,
          kdf: pendingKdf,
        });
        const failed = await reencryptAllAttachments(
          vault,
          oldSession,
          session,
          onProgress,
        );
        if (failed === 0) {
          const cleanPayload = await encryptVaultPayload(vault, session);
          revision = await saveVaultRecord(
            cleanPayload,
            session.authToken,
            revision,
          );
        }
        return { session, vault, migrated: true, revision };
      }
      if (meta.requiresBootstrap) {
        revision = await saveVaultRecord(
          storedPayload,
          session.authToken,
          revision,
          bootstrapSecret,
        );
      }
      return {
        session,
        vault,
        migrated: Boolean(meta.requiresBootstrap),
        revision,
      };
    }

    const migrated = await migrateVaultToV2(
      password,
      vault,
      session,
      revision,
      bootstrapSecret,
      onProgress,
    );
    clearLegacyPasswordMeta();
    return {
      session: migrated.session,
      vault,
      migrated: true,
      revision: migrated.revision,
    };
  }

  const record = await loadVaultRecord("", bootstrapSecret);
  const storedPayload = record.payload;
  const legacyMeta = readLegacyPasswordMeta();
  if (legacyMeta) {
    const hash = await hashLegacyPassword(password, legacyMeta.salt);
    if (hash !== legacyMeta.hash) {
      throw new Error("Incorrect password. Try again.");
    }
  } else {
    const confirmed = await confirmLegacyAdoption();
    if (!confirmed) {
      throw new Error("Unlock cancelled.");
    }
  }

  const vault = normalizeVault(storedPayload);
  const session = await createVaultSession(password);
  const encryptedPayload = await encryptVaultPayload(vault, session);
  const revision = await saveVaultRecord(
    encryptedPayload,
    session.authToken,
    record.revision,
    bootstrapSecret,
  );
  clearLegacyPasswordMeta();
  return { session, vault, migrated: true, revision };
}
