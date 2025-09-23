import { access, mkdir, readFile, writeFile } from "fs/promises"
import path from "path"

import {
  head,
  put,
  BlobNotFoundError,
  type HeadBlobResult,
} from "@vercel/blob"

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN
const BLOB_PREFIX = normalizePrefix(process.env.VAULT_BLOB_PREFIX)
const BLOB_KEY = process.env.VAULT_BLOB_KEY ?? "vault.json"
const BLOB_PATH = [BLOB_PREFIX, BLOB_KEY].filter(Boolean).join("/")
const LOCAL_VAULT_DIR = path.join(process.cwd(), "data")
const LOCAL_VAULT_PATH = path.join(LOCAL_VAULT_DIR, "vault.json")

function normalizePrefix(prefix: string | undefined) {
  if (!prefix) {
    return "vaults"
  }

  return prefix.replace(/^\/+|\/+$/g, "") || undefined
}

function isBlobEnabled() {
  return Boolean(BLOB_TOKEN)
}

async function readFromBlob(handle: HeadBlobResult) {
  const response = await fetch(handle.downloadUrl)
  if (!response.ok) {
    throw new Error(`Failed to download vault: ${response.status} ${response.statusText}`)
  }

  return await response.text()
}

async function getBlobHandle() {
  if (!isBlobEnabled()) {
    throw new Error("Vercel Blob is not configured")
  }

  return await head(BLOB_PATH, { token: BLOB_TOKEN })
}

async function readFromFilesystem() {
  return await readFile(LOCAL_VAULT_PATH, "utf8")
}

async function writeToFilesystem(contents: string) {
  await mkdir(LOCAL_VAULT_DIR, { recursive: true })
  await writeFile(LOCAL_VAULT_PATH, contents, "utf8")
}

export async function storageReadVault() {
  if (isBlobEnabled()) {
    const handle = await getBlobHandle()
    return await readFromBlob(handle)
  }

  return await readFromFilesystem()
}

export async function storageWriteVault(contents: string) {
  if (isBlobEnabled()) {
    await put(BLOB_PATH, contents, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      token: BLOB_TOKEN,
    })
    return
  }

  await writeToFilesystem(contents)
}

export async function storageVaultExists() {
  if (isBlobEnabled()) {
    try {
      await getBlobHandle()
      return true
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        return false
      }

      throw error
    }
  }

  try {
    await access(LOCAL_VAULT_PATH)
    return true
  } catch {
    return false
  }
}
