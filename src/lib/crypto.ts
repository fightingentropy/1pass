const PBKDF2_ITERATIONS = 310_000
const MIN_ITERATIONS = 100_000
const MAX_ITERATIONS = 600_000
const KEY_LENGTH = 256
const SALT_LENGTH = 16
const IV_LENGTH = 12
const TAG_LENGTH = 16

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = view

  if (buffer instanceof ArrayBuffer) {
    if (byteOffset === 0 && byteLength === buffer.byteLength) {
      return buffer
    }
    return buffer.slice(byteOffset, byteOffset + byteLength)
  }

  const copy = new Uint8Array(byteLength)
  copy.set(view)
  return copy.buffer
}

let resolvedCrypto: Crypto | null =
  typeof globalThis.crypto !== "undefined" && "subtle" in globalThis.crypto
    ? (globalThis.crypto as Crypto)
    : null

async function getCrypto(): Promise<Crypto> {
  if (resolvedCrypto) {
    return resolvedCrypto
  }

  if (typeof process !== "undefined" && typeof process.versions?.node === "string") {
    const { webcrypto } = await import("crypto")
    resolvedCrypto = webcrypto as unknown as Crypto
    return resolvedCrypto
  }

  throw new Error("Web Crypto API is not available in this environment")
}

function toBase64(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64")
  }

  let binary = ""
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary)
}

function fromBase64(value: string) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"))
  }

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number) {
  const crypto = await getCrypto()
  const subtle = crypto.subtle

  const keyMaterial = await subtle.importKey(
    "raw",
    textEncoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  )

  return await subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt: toArrayBuffer(salt),
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: KEY_LENGTH,
    },
    false,
    ["encrypt", "decrypt"]
  )
}

function validateIterationCount(iterations: number) {
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error("Unsupported PBKDF2 iteration count")
  }
}

export class InvalidPasswordError extends Error {
  constructor() {
    super("Invalid master password")
    this.name = "InvalidPasswordError"
  }
}

export type EncryptedPayload = {
  version: 1
  iterations: number
  salt: string
  iv: string
  ciphertext: string
  tag: string
}

export async function encryptData<T>(payload: T, password: string): Promise<EncryptedPayload> {
  if (!password) {
    throw new Error("Password is required to encrypt data")
  }

  const crypto = await getCrypto()

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS)

  const message = textEncoder.encode(JSON.stringify(payload))
  const encryptedBytes = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, message)
  )

  const tag = encryptedBytes.slice(encryptedBytes.length - TAG_LENGTH)
  const ciphertext = encryptedBytes.slice(0, encryptedBytes.length - TAG_LENGTH)

  return {
    version: 1,
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    tag: toBase64(tag),
  }
}

export async function decryptData<T>(payload: EncryptedPayload, password: string): Promise<T> {
  if (!password) {
    throw new Error("Password is required to decrypt data")
  }

  const crypto = await getCrypto()
  const subtle = crypto.subtle

  const iterations = payload.iterations ?? PBKDF2_ITERATIONS
  validateIterationCount(iterations)

  const salt = fromBase64(payload.salt)
  const iv = fromBase64(payload.iv)
  const ciphertext = fromBase64(payload.ciphertext)
  const tag = fromBase64(payload.tag)

  const combined = new Uint8Array(ciphertext.length + tag.length)
  combined.set(ciphertext)
  combined.set(tag, ciphertext.length)

  try {
    const key = await deriveAesKey(password, salt, iterations)
    const decrypted = await subtle.decrypt({ name: "AES-GCM", iv }, key, combined)
    const json = textDecoder.decode(decrypted)
    return JSON.parse(json) as T
  } catch (error) {
    if (error instanceof DOMException || error instanceof SyntaxError) {
      throw new InvalidPasswordError()
    }

    throw error
  }
}

export const CRYPTO_CONSTANTS = {
  PBKDF2_ITERATIONS,
  MIN_ITERATIONS,
  MAX_ITERATIONS,
  SALT_LENGTH,
  IV_LENGTH,
  TAG_LENGTH,
} as const
