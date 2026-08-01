import {
  base64ByteLength,
  isValidVaultKdf,
  VAULT_KDF_ITERATIONS,
  type VaultAttachment,
  type VaultEncryptedPayload,
  type VaultPayload,
} from "../functions/api/vault/schema";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const HKDF_SALT = "1pass/hkdf/v2";
const HKDF_INFO_ENCRYPTION = "1pass/enc/v2";
const HKDF_INFO_AUTH = "1pass/auth/v2";
const HKDF_V3_SALT = "1pass/hkdf/v3";
const HKDF_INFO_VAULT = "1pass/vault-payload/v3";
const HKDF_INFO_MANIFEST = "1pass/file-manifest/v3";
const HKDF_INFO_FILE = "1pass/file-content/v3";
const DEFAULT_VAULT_ID = "default";

export type VaultSession = {
  key: CryptoKey;
  fileKeyMaterial?: CryptoKey;
  manifestKey?: CryptoKey;
  kdf: VaultEncryptedPayload["kdf"];
  version: 1 | 2 | 3;
  // Sent as a bearer token so the server can gate reads/writes. Derived from
  // the password via a separate HKDF branch, so it reveals nothing about the
  // encryption key. Empty string for unmigrated v1 sessions.
  authToken: string;
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
    ["deriveKey", "deriveBits"],
  );
}

async function deriveLegacyVaultKey(
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

async function deriveV2Material(
  password: string,
  kdf: VaultEncryptedPayload["kdf"],
) {
  const keyMaterial = await deriveKeyMaterial(password);
  const baseBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: kdf.hash,
      salt: base64ToBytes(kdf.salt),
      iterations: kdf.iterations,
    },
    keyMaterial,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey("raw", baseBits, "HKDF", false, [
    "deriveKey",
    "deriveBits",
  ]);

  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(HKDF_SALT),
      info: encoder.encode(HKDF_INFO_ENCRYPTION),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const authBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(HKDF_SALT),
      info: encoder.encode(HKDF_INFO_AUTH),
    },
    hkdfKey,
    256,
  );

  return { key, authToken: bytesToBase64(new Uint8Array(authBits)) };
}

async function deriveV3Material(
  password: string,
  kdf: VaultEncryptedPayload["kdf"],
) {
  const keyMaterial = await deriveKeyMaterial(password);
  const baseBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: kdf.hash,
      salt: base64ToBytes(kdf.salt),
      iterations: kdf.iterations,
    },
    keyMaterial,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey("raw", baseBits, "HKDF", false, [
    "deriveKey",
    "deriveBits",
  ]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(HKDF_V3_SALT),
      info: encoder.encode(HKDF_INFO_VAULT),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const manifestKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(HKDF_V3_SALT),
      info: encoder.encode(HKDF_INFO_MANIFEST),
    },
    hkdfKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );

  // Keep the v2 auth branch stable during an in-place v2 -> v3 migration.
  // Encryption keys still move to independent v3 branches.
  const authBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(HKDF_SALT),
      info: encoder.encode(HKDF_INFO_AUTH),
    },
    hkdfKey,
    256,
  );
  return {
    key,
    fileKeyMaterial: hkdfKey,
    manifestKey,
    authToken: bytesToBase64(new Uint8Array(authBits)),
  };
}

export async function createVaultSession(password: string): Promise<VaultSession> {
  const kdf: VaultEncryptedPayload["kdf"] = {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: VAULT_KDF_ITERATIONS,
    salt: bytesToBase64(createRandomBytes(16)),
  };

  const { key, fileKeyMaterial, manifestKey, authToken } = await deriveV3Material(
    password,
    kdf,
  );
  return { key, fileKeyMaterial, manifestKey, kdf, version: 3, authToken };
}

export async function restoreVaultSession(
  password: string,
  meta: { version: number; kdf: VaultEncryptedPayload["kdf"] },
): Promise<VaultSession> {
  if (!isValidVaultKdf(meta.kdf)) {
    throw new Error("Unsupported vault key derivation parameters.");
  }
  if (meta.version === 3) {
    const { key, fileKeyMaterial, manifestKey, authToken } =
      await deriveV3Material(
      password,
      meta.kdf,
    );
    return {
      key,
      fileKeyMaterial,
      manifestKey,
      kdf: meta.kdf,
      version: 3,
      authToken,
    };
  }
  if (meta.version === 2) {
    const { key, authToken } = await deriveV2Material(password, meta.kdf);
    return { key, kdf: meta.kdf, version: 2, authToken };
  }

  if (meta.version !== 1) {
    throw new Error("Unsupported vault envelope version.");
  }

  return {
    key: await deriveLegacyVaultKey(password, meta.kdf),
    kdf: meta.kdf,
    version: 1,
    authToken: "",
  };
}

export async function encryptVaultPayload(
  payload: VaultPayload,
  session: VaultSession,
): Promise<VaultEncryptedPayload> {
  const iv = createRandomBytes(12);
  const plaintext = encoder.encode(JSON.stringify(payload));
  const algorithm: AesGcmParams = {
    name: "AES-GCM",
    iv,
    ...(session.version === 3
      ? { additionalData: vaultAdditionalData() }
      : {}),
  };
  const ciphertext = await crypto.subtle.encrypt(
    algorithm,
    session.key,
    plaintext,
  );

  return {
    version: session.version,
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
  if (payload.version !== session.version) {
    throw new Error("Vault envelope and key versions do not match.");
  }
  const algorithm: AesGcmParams = {
    name: "AES-GCM",
    iv: base64ToBytes(payload.iv),
    ...(payload.version === 3
      ? { additionalData: vaultAdditionalData() }
      : {}),
  };
  const plaintext = await crypto.subtle.decrypt(
    algorithm,
    session.key,
    base64ToBytes(payload.ciphertext),
  );

  return JSON.parse(decoder.decode(plaintext));
}

export type EncryptedChunk = {
  version?: 3;
  iv: string;
  ciphertext: string;
};

export type AttachmentChunkContext = {
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
};

function vaultAdditionalData() {
  return encoder.encode(
    JSON.stringify({
      vaultId: DEFAULT_VAULT_ID,
      version: 3,
      objectType: "vault-payload",
    }),
  );
}

function validateChunkContext(context: AttachmentChunkContext) {
  if (
    !/^[a-zA-Z0-9-]{1,64}$/.test(context.fileId) ||
    !Number.isInteger(context.chunkIndex) ||
    !Number.isInteger(context.totalChunks) ||
    context.chunkIndex < 0 ||
    context.totalChunks < 1 ||
    context.totalChunks > 64 ||
    context.chunkIndex >= context.totalChunks
  ) {
    throw new Error("Invalid attachment encryption context.");
  }
}

function chunkAdditionalData(context: AttachmentChunkContext) {
  validateChunkContext(context);
  return encoder.encode(
    JSON.stringify({
      vaultId: DEFAULT_VAULT_ID,
      version: 3,
      objectType: "attachment-chunk",
      fileId: context.fileId,
      chunkIndex: context.chunkIndex,
      totalChunks: context.totalChunks,
    }),
  );
}

async function deriveFileKey(session: VaultSession, fileId: string) {
  if (session.version !== 3 || !session.fileKeyMaterial) {
    throw new Error("A v3 vault session is required for file key derivation.");
  }
  // File ids are random, immutable identifiers and serve as the unique HKDF
  // salt. The resulting key is never reused by another attachment.
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(fileId),
      info: encoder.encode(HKDF_INFO_FILE),
    },
    session.fileKeyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function isEncryptedChunk(value: unknown): value is EncryptedChunk {
  if (!value || typeof value !== "object") return false;
  const chunk = value as Partial<EncryptedChunk>;
  return (
    (chunk.version === undefined || chunk.version === 3) &&
    typeof chunk.iv === "string" &&
    base64ByteLength(chunk.iv) === 12 &&
    typeof chunk.ciphertext === "string" &&
    base64ByteLength(chunk.ciphertext) >= 16 &&
    chunk.ciphertext.length <= 1_600_000
  );
}

function serializeEncryptedChunk(chunk: EncryptedChunk) {
  return JSON.stringify(
    chunk.version === 3
      ? { version: 3, iv: chunk.iv, ciphertext: chunk.ciphertext }
      : { iv: chunk.iv, ciphertext: chunk.ciphertext },
  );
}

export async function encryptedChunkDigest(chunk: EncryptedChunk) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(serializeEncryptedChunk(chunk)),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function hasV3AttachmentManifest(
  attachment: VaultAttachment,
): attachment is VaultAttachment & {
  envelopeVersion: 3;
  chunkHashes: string[];
  chunkSizes: number[];
  manifestMac: string;
} {
  return (
    attachment.envelopeVersion === 3 &&
    Array.isArray(attachment.chunkHashes) &&
    attachment.chunkHashes.length === attachment.chunks &&
    attachment.chunkHashes.every((hash) => /^[a-f0-9]{64}$/.test(hash)) &&
    Array.isArray(attachment.chunkSizes) &&
    attachment.chunkSizes.length === attachment.chunks &&
    attachment.chunkSizes.every(
      (size) => Number.isInteger(size) && size >= 0 && size <= 1_048_576,
    ) &&
    typeof attachment.manifestMac === "string" &&
    base64ByteLength(attachment.manifestMac) === 32
  );
}

function manifestData(
  fileId: string,
  chunkHashes: string[],
  chunkSizes: number[],
) {
  return encoder.encode(
    JSON.stringify({
      vaultId: DEFAULT_VAULT_ID,
      version: 3,
      objectType: "attachment-manifest",
      fileId,
      totalChunks: chunkHashes.length,
      chunkHashes,
      chunkSizes,
    }),
  );
}

export async function createV3AttachmentManifest(
  session: VaultSession,
  fileId: string,
  chunkHashes: string[],
  chunkSizes: number[],
): Promise<Pick<
  VaultAttachment,
  "chunks" | "envelopeVersion" | "chunkHashes" | "chunkSizes" | "manifestMac"
>> {
  if (session.version !== 3 || !session.manifestKey) {
    throw new Error("A v3 vault session is required for manifest signing.");
  }
  if (
    chunkHashes.length < 1 ||
    chunkHashes.length !== chunkSizes.length ||
    chunkHashes.length > 64
  ) {
    throw new Error("Invalid attachment manifest.");
  }
  const mac = await crypto.subtle.sign(
    "HMAC",
    session.manifestKey,
    manifestData(fileId, chunkHashes, chunkSizes),
  );
  return {
    chunks: chunkHashes.length,
    envelopeVersion: 3,
    chunkHashes,
    chunkSizes,
    manifestMac: bytesToBase64(new Uint8Array(mac)),
  };
}

export async function verifyV3AttachmentManifest(
  attachment: VaultAttachment,
  session: VaultSession,
) {
  if (!hasV3AttachmentManifest(attachment) || !session.manifestKey) return false;
  return crypto.subtle.verify(
    "HMAC",
    session.manifestKey,
    base64ToBytes(attachment.manifestMac),
    manifestData(
      attachment.id,
      attachment.chunkHashes,
      attachment.chunkSizes,
    ),
  );
}

export async function encryptBytes(
  bytes: Uint8Array<ArrayBuffer>,
  session: VaultSession,
  context?: AttachmentChunkContext,
): Promise<EncryptedChunk> {
  const iv = createRandomBytes(12);
  const v3 = session.version === 3;
  if (v3 && !context) {
    throw new Error("Attachment encryption context is required.");
  }
  const key = v3 ? await deriveFileKey(session, context!.fileId) : session.key;
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      ...(v3 ? { additionalData: chunkAdditionalData(context!) } : {}),
    },
    key,
    bytes,
  );

  return {
    ...(v3 ? { version: 3 as const } : {}),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptBytes(
  chunk: EncryptedChunk,
  session: VaultSession,
  context?: AttachmentChunkContext,
): Promise<Uint8Array> {
  const v3 = chunk.version === 3;
  if (v3 && (!context || session.version !== 3)) {
    throw new Error("Attachment decryption context is required.");
  }
  if (!v3 && session.version === 3) {
    throw new Error("Legacy attachment requires its original vault session.");
  }
  const key = v3 ? await deriveFileKey(session, context!.fileId) : session.key;
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(chunk.iv),
      ...(v3 ? { additionalData: chunkAdditionalData(context!) } : {}),
    },
    key,
    base64ToBytes(chunk.ciphertext),
  );

  return new Uint8Array(plaintext);
}
