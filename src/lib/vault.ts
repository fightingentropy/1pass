import { access, mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import { decryptData, encryptData, InvalidPasswordError, type EncryptedPayload } from "@/lib/crypto"
import type { VaultData } from "@/types/vault"

const VAULT_DIR = path.join(process.cwd(), "data")
const VAULT_PATH = path.join(VAULT_DIR, "vault.json")

export async function vaultExists() {
  try {
    await access(VAULT_PATH)
    return true
  } catch {
    return false
  }
}

async function ensureVaultDir() {
  await mkdir(VAULT_DIR, { recursive: true })
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
  await ensureVaultDir()
  await writeFile(VAULT_PATH, JSON.stringify(encrypted, null, 2), "utf8")
}

export async function loadVault(masterPassword: string): Promise<VaultData> {
  if (!masterPassword) {
    throw new Error("Master password is required")
  }

  if (!(await vaultExists())) {
    throw new Error("Vault not initialized")
  }

  const raw = await readFile(VAULT_PATH, "utf8")
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
  await ensureVaultDir()
  await writeFile(VAULT_PATH, JSON.stringify(encrypted, null, 2), "utf8")
}
