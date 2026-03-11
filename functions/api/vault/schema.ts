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
  notes: string;
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

export type VaultEncryptedPayload = {
  version: 1;
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

export const DEFAULT_VAULT_PAYLOAD: VaultPayload = {
  identities: [],
  apiKeys: [],
};

export const VAULT_KDF_ITERATIONS = 310_000;

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
    value.version === 1 &&
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
