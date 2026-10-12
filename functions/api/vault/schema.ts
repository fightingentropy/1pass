// One encrypted file in storage: its random id and chunk count, plus the v3
// manifest that binds every chunk to this id and its exact position. The
// manifest lives inside the encrypted vault payload, so changing a chunk,
// dropping one, or replaying one from another file is detectable.
export type VaultStoredFile = {
  id: string;
  chunks: number;
  envelopeVersion?: 3;
  chunkHashes?: string[];
  chunkSizes?: number[];
  manifestMac?: string;
};

// Image thumbnails are stored as their own one-chunk encrypted file so the
// vault envelope stays small; they are fetched when the file list is shown.
export type VaultAttachmentPreview = VaultStoredFile & {
  mimeType: string;
  size: number;
};

export type VaultAttachment = VaultStoredFile & {
  name: string;
  mimeType: string;
  size: number;
  // Inline JPEG data URL written by releases before thumbnails moved out of
  // the envelope. Migrated into `preview` after unlock; empty for new files.
  thumb: string;
  preview?: VaultAttachmentPreview;
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
};

// version 1: AES key derived directly from the password via PBKDF2.
// version 2: PBKDF2 derives 256 base bits, then HKDF-SHA256 expands them into
// the AES-GCM key and a separate API auth token, so the server can gate writes
// without ever learning anything about the encryption key.
// version 3: purpose-separated vault and per-file keys plus authenticated
// context for the vault envelope and every attachment chunk.
export type VaultEncryptedPayload = {
  version: 1 | 2 | 3;
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
export const VAULT_KDF_MIN_ITERATIONS = 100_000;
export const VAULT_KDF_MAX_ITERATIONS = 2_000_000;

export const VAULT_AUTH_HEADER = "x-vault-auth";
export const VAULT_BOOTSTRAP_HEADER = "x-vault-bootstrap";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function base64ByteLength(value: string) {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    return -1;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function isValidVaultKdf(
  value: unknown,
): value is VaultEncryptedPayload["kdf"] {
  if (!isObject(value)) return false;
  const saltBytes =
    typeof value.salt === "string" ? base64ByteLength(value.salt) : -1;
  return (
    value.name === "PBKDF2" &&
    value.hash === "SHA-256" &&
    typeof value.iterations === "number" &&
    Number.isInteger(value.iterations) &&
    value.iterations >= VAULT_KDF_MIN_ITERATIONS &&
    value.iterations <= VAULT_KDF_MAX_ITERATIONS &&
    saltBytes >= 16 &&
    saltBytes <= 64
  );
}

export function isVaultEncryptedPayload(
  value: unknown,
): value is VaultEncryptedPayload {
  if (!isObject(value) || !isObject(value.kdf)) {
    return false;
  }

  return (
    (value.version === 1 || value.version === 2 || value.version === 3) &&
    value.format === "aes-gcm" &&
    isValidVaultKdf(value.kdf) &&
    typeof value.iv === "string" &&
    base64ByteLength(value.iv) === 12 &&
    typeof value.ciphertext === "string" &&
    base64ByteLength(value.ciphertext) >= 16 &&
    value.ciphertext.length <= 2_600_000
  );
}
