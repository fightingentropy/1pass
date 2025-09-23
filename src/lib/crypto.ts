import { createCipheriv, createDecipheriv, pbkdf2 as pbkdf2Callback, randomBytes } from "crypto"

const PBKDF2_ITERATIONS = 310_000
const KEY_LENGTH = 32
const ALGORITHM = "aes-256-gcm"

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

function pbkdf2(password: string, salt: Buffer, iterations: number) {
  return new Promise<Buffer>((resolve, reject) => {
    pbkdf2Callback(password, salt, iterations, KEY_LENGTH, "sha256", (err, derivedKey) => {
      if (err) {
        reject(err)
        return
      }

      resolve(derivedKey)
    })
  })
}

export async function encryptData<T>(payload: T, password: string): Promise<EncryptedPayload> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await pbkdf2(password, salt, PBKDF2_ITERATIONS)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const json = JSON.stringify(payload)
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    version: 1,
    iterations: PBKDF2_ITERATIONS,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    tag: tag.toString("base64"),
  }
}

export async function decryptData<T>(payload: EncryptedPayload, password: string): Promise<T> {
  const { salt, iv, ciphertext, tag, iterations } = payload
  const saltBuffer = Buffer.from(salt, "base64")
  const ivBuffer = Buffer.from(iv, "base64")
  const cipherBuffer = Buffer.from(ciphertext, "base64")
  const tagBuffer = Buffer.from(tag, "base64")
  const key = await pbkdf2(password, saltBuffer, iterations ?? PBKDF2_ITERATIONS)
  const decipher = createDecipheriv(ALGORITHM, key, ivBuffer)

  decipher.setAuthTag(tagBuffer)

  try {
    const decrypted = Buffer.concat([decipher.update(cipherBuffer), decipher.final()])
    return JSON.parse(decrypted.toString("utf8")) as T
  } catch {
    throw new InvalidPasswordError()
  }
}
