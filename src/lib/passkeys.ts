import { access, mkdir, readFile, writeFile } from "fs/promises"
import path from "path"

export type StoredPasskey = {
  credentialID: string
  credentialPublicKey: string
  counter: number
  transports?: string[]
  userHandle: string
  masterPassword: string
}

type PasskeyStore = {
  credential?: StoredPasskey
}

const PASSKEY_DIR = path.join(process.cwd(), "data")
const PASSKEY_PATH = path.join(PASSKEY_DIR, "passkeys.json")

async function readStore(): Promise<PasskeyStore> {
  try {
    const raw = await readFile(PASSKEY_PATH, "utf8")
    return JSON.parse(raw) as PasskeyStore
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {}
    }

    throw error
  }
}

async function writeStore(store: PasskeyStore) {
  await mkdir(PASSKEY_DIR, { recursive: true })
  await writeFile(PASSKEY_PATH, JSON.stringify(store, null, 2), "utf8")
}

export async function getStoredPasskey(): Promise<StoredPasskey | null> {
  const store = await readStore()
  return store.credential ?? null
}

export async function saveStoredPasskey(credential: StoredPasskey) {
  const store = await readStore()
  store.credential = credential
  await writeStore(store)
}

export async function updateStoredPasskeyCounter(counter: number) {
  const store = await readStore()

  if (!store.credential) {
    throw new Error("No stored passkey to update")
  }

  store.credential.counter = counter
  await writeStore(store)
}

export async function removeStoredPasskey() {
  const store = await readStore()
  delete store.credential
  await writeStore(store)
}

export async function passkeyExists() {
  try {
    await access(PASSKEY_PATH)
    const store = await readStore()
    return Boolean(store.credential)
  } catch {
    return false
  }
}
