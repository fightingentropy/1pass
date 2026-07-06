import {
  VAULT_KDF_ITERATIONS,
  type VaultEncryptedPayload,
  type VaultPayload,
} from "../functions/api/vault/schema";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type VaultSession = {
  key: CryptoKey;
  kdf: VaultEncryptedPayload["kdf"];
};

function bytesToBase64(bytes: Uint8Array) {
  const parts: string[] = [];
  const sliceSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += sliceSize) {
    const slice = bytes.subarray(offset, offset + sliceSize);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function createRandomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveKeyMaterial(password: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
}

async function deriveVaultKey(
  password: string,
  kdf: VaultEncryptedPayload["kdf"],
) {
  const keyMaterial = await deriveKeyMaterial(password);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: kdf.hash,
      salt: base64ToBytes(kdf.salt),
      iterations: kdf.iterations,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function createVaultSession(password: string): Promise<VaultSession> {
  const kdf: VaultEncryptedPayload["kdf"] = {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: VAULT_KDF_ITERATIONS,
    salt: bytesToBase64(createRandomBytes(16)),
  };

  return {
    key: await deriveVaultKey(password, kdf),
    kdf,
  };
}

export async function restoreVaultSession(
  password: string,
  payload: VaultEncryptedPayload,
): Promise<VaultSession> {
  return {
    key: await deriveVaultKey(password, payload.kdf),
    kdf: payload.kdf,
  };
}

export async function encryptVaultPayload(
  payload: VaultPayload,
  session: VaultSession,
): Promise<VaultEncryptedPayload> {
  const iv = createRandomBytes(12);
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    session.key,
    plaintext,
  );

  return {
    version: 1,
    format: "aes-gcm",
    kdf: session.kdf,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptVaultPayload(
  payload: VaultEncryptedPayload,
  session: VaultSession,
): Promise<unknown> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    session.key,
    base64ToBytes(payload.ciphertext),
  );

  return JSON.parse(decoder.decode(plaintext));
}

export type EncryptedChunk = {
  iv: string;
  ciphertext: string;
};

export function isEncryptedChunk(value: unknown): value is EncryptedChunk {
  if (!value || typeof value !== "object") return false;
  const chunk = value as Partial<EncryptedChunk>;
  return (
    typeof chunk.iv === "string" &&
    chunk.iv.length > 0 &&
    typeof chunk.ciphertext === "string" &&
    chunk.ciphertext.length > 0
  );
}

export async function encryptBytes(
  bytes: Uint8Array<ArrayBuffer>,
  session: VaultSession,
): Promise<EncryptedChunk> {
  const iv = createRandomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    session.key,
    bytes,
  );

  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptBytes(
  chunk: EncryptedChunk,
  session: VaultSession,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(chunk.iv) },
    session.key,
    base64ToBytes(chunk.ciphertext),
  );

  return new Uint8Array(plaintext);
}
