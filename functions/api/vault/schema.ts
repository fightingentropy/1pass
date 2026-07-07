export type VaultAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  chunks: number;
  thumb: string;
  createdAt: number;
};

export type VaultCredential = {
  id: string;
  label: string;
  username: string;
  password: string;
  website: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
};

export type VaultIdentityItem = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  nino: string;
  nhsNumber: string;
  passNumber: string;
  utr: string;
  govGatewayId: string;
  notes: string;
  attachments: VaultAttachment[];
  credentials: VaultCredential[];
  createdAt: number;
  updatedAt: number;
};

export type VaultApiKeyItem = {
  id: string;
  label: string;
  service: string;
  key: string;
  environment: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
};

export type VaultPayload = {
  identities: VaultIdentityItem[];
  apiKeys: VaultApiKeyItem[];
  // Present only while a v1→v2 attachment re-encryption is in flight: stores
  // the OLD (v1) KDF parameters so an interrupted migration can resume with
  // both keys derivable. Stripped again by the save that ends the migration.
  pendingMigration?: {
    kdf: VaultEncryptedPayload["kdf"];
  };
};

// version 1: AES key derived directly from the password via PBKDF2.
// version 2: PBKDF2 derives 256 base bits, then HKDF-SHA256 expands them into
// the AES-GCM key and a separate API auth token, so the server can gate writes
// without ever learning anything about the encryption key.
export type VaultEncryptedPayload = {
  version: 1 | 2;
  format: "aes-gcm";
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  iv: string;
  ciphertext: string;
};

export type VaultMeta = {
  exists: boolean;
  version?: number;
  kdf?: VaultEncryptedPayload["kdf"];
};

export const DEFAULT_VAULT_PAYLOAD: VaultPayload = {
  identities: [],
  apiKeys: [],
};

export const VAULT_KDF_ITERATIONS = 600_000;

export const VAULT_AUTH_HEADER = "x-vault-auth";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isVaultEncryptedPayload(
  value: unknown,
): value is VaultEncryptedPayload {
  if (!isObject(value) || !isObject(value.kdf)) {
    return false;
  }

  return (
    (value.version === 1 || value.version === 2) &&
    value.format === "aes-gcm" &&
    value.kdf.name === "PBKDF2" &&
    value.kdf.hash === "SHA-256" &&
    typeof value.kdf.iterations === "number" &&
    Number.isFinite(value.kdf.iterations) &&
    value.kdf.iterations > 0 &&
    typeof value.kdf.salt === "string" &&
    value.kdf.salt.length > 0 &&
    typeof value.iv === "string" &&
    value.iv.length > 0 &&
    typeof value.ciphertext === "string" &&
    value.ciphertext.length > 0
  );
}
