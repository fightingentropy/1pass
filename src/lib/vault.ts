import { decryptData, encryptData, InvalidPasswordError, type EncryptedPayload } from "@/lib/crypto"
import {
  storageReadVault,
  storageVaultExists,
  storageWriteVault,
} from "@/lib/storage"
import type { VaultData } from "@/types/vault"

export async function vaultExists() {
  return await storageVaultExists()
}

export async function initializeVault(masterPassword: string) {
  if (!masterPassword) {
    throw new Error("Master password is required")
  }

  if (await vaultExists()) {
    throw new Error("Vault already exists")
  }

  const emptyVault: VaultData = {
    passwords: [],
    cards: [],
    identities: [],
  }

  const encrypted = await encryptData(emptyVault, masterPassword)
  await storageWriteVault(JSON.stringify(encrypted, null, 2))
}

export async function loadVault(masterPassword: string): Promise<VaultData> {
  if (!masterPassword) {
    throw new Error("Master password is required")
  }

  if (!(await vaultExists())) {
    throw new Error("Vault not initialized")
  }

  const raw = await storageReadVault()
  const payload = JSON.parse(raw) as EncryptedPayload

  try {
    return await decryptData<VaultData>(payload, masterPassword)
  } catch (error) {
    if (error instanceof InvalidPasswordError) {
      throw error
    }

    throw new Error("Failed to decrypt vault")
  }
}

export async function saveVault(masterPassword: string, data: VaultData) {
  if (!masterPassword) {
    throw new Error("Master password is required")
  }

  if (!(await vaultExists())) {
    throw new Error("Vault not initialized")
  }

  // Validate the password against the current vault before overwriting.
  await loadVault(masterPassword)

  const encrypted = await encryptData(data, masterPassword)
  await storageWriteVault(JSON.stringify(encrypted, null, 2))
}
