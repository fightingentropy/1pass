import type { EncryptedPayload } from "@/lib/crypto"
import {
  storageReadVault,
  storageVaultExists,
  storageWriteVault,
} from "@/lib/storage"

function assertEncryptedPayload(payload: unknown): asserts payload is EncryptedPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Encrypted payload is malformed")
  }

  const candidate = payload as Partial<EncryptedPayload>

  if (
    candidate.version !== 1 ||
    typeof candidate.iterations !== "number" ||
    typeof candidate.salt !== "string" ||
    typeof candidate.iv !== "string" ||
    typeof candidate.ciphertext !== "string" ||
    typeof candidate.tag !== "string"
  ) {
    throw new Error("Encrypted payload is malformed")
  }
}

export async function vaultExists() {
  return await storageVaultExists()
}

export async function initializeVault(payload: EncryptedPayload) {
  assertEncryptedPayload(payload)

  if (await vaultExists()) {
    throw new Error("Vault already exists")
  }

  await storageWriteVault(JSON.stringify(payload, null, 2))
}

export async function loadVault(): Promise<EncryptedPayload> {
  if (!(await vaultExists())) {
    throw new Error("Vault not initialized")
  }

  const raw = await storageReadVault()

  try {
    const parsed = JSON.parse(raw) as unknown
    assertEncryptedPayload(parsed)
    return parsed
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Stored vault is not valid JSON")
    }

    throw error
  }
}

export async function saveVault(payload: EncryptedPayload) {
  assertEncryptedPayload(payload)

  if (!(await vaultExists())) {
    throw new Error("Vault not initialized")
  }

  await storageWriteVault(JSON.stringify(payload, null, 2))
}

