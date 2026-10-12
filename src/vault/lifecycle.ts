import {
  isVaultEncryptedPayload,
  type VaultEncryptedPayload,
  type VaultPayload,
} from "../../functions/api/vault/schema";
import {
  decryptVaultPayload,
  encryptVaultPayload,
  restoreVaultSession,
  type VaultSession,
} from "../vaultCrypto";
import { isUnauthorizedError, loadVaultRecord, readVaultMeta } from "./api";
import { normalizeVault } from "./types";

const PENDING_RECOVERY_KEY = "vault.pending-recovery.v1";

// Browsers that ran the pre-encryption app kept a fast salted SHA-256 of the
// master password here. Nothing reads it any more; remove it wherever it is
// still lying around so it cannot be used as an offline guessing oracle.
const LEGACY_PASSWORD_KEYS = ["vault.password.hash", "vault.password.salt"];

export function removeLegacyPasswordHash() {
  try {
    for (const key of LEGACY_PASSWORD_KEYS) localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private windows; nothing to clean then.
  }
}

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

// Only envelope v3 is supported. Older envelopes were upgraded in place by
// earlier releases; backups made before that upgrade are still restorable
// through the backup import, which keeps the older decryption paths.
export async function unlockVaultWithPassword(password: string): Promise<{
  session: VaultSession;
  vault: VaultPayload;
  revision: number;
}> {
  const meta = await readVaultMeta();
  if (!meta.exists) {
    throw new Error("No vault exists yet. Reload the page to set one up.");
  }
  if (meta.version !== 3 || !meta.kdf) {
    throw new Error("This vault uses an unsupported format.");
  }

  const session = await restoreVaultSession(password, {
    version: 3,
    kdf: meta.kdf,
  });

  let record: { payload: unknown; revision: number };
  try {
    record = await loadVaultRecord(session.authToken);
  } catch (loadError) {
    if (isUnauthorizedError(loadError)) {
      throw new Error("Incorrect password. Try again.");
    }
    throw loadError;
  }
  if (!isVaultEncryptedPayload(record.payload)) {
    throw new Error("Vault data is corrupted.");
  }

  let decrypted: unknown;
  try {
    decrypted = await decryptVaultPayload(record.payload, session);
  } catch {
    throw new Error("Incorrect password. Try again.");
  }
  return {
    session,
    vault: normalizeVault(decrypted),
    revision: record.revision,
  };
}
