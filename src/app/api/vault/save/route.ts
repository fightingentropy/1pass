import { NextResponse } from "next/server"
import { InvalidPasswordError } from "@/lib/crypto"
import { saveVault, vaultExists } from "@/lib/vault"
import type { VaultData } from "@/types/vault"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const masterPassword = body?.masterPassword as string | undefined
  const data = body?.data as VaultData | undefined

  if (!masterPassword) {
    return NextResponse.json({ error: "Master password is required" }, { status: 400 })
  }

  if (!data) {
    return NextResponse.json({ error: "Vault data is required" }, { status: 400 })
  }

  if (!(await vaultExists())) {
    return NextResponse.json({ error: "Vault not initialized" }, { status: 404 })
  }

  try {
    await saveVault(masterPassword, data)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof InvalidPasswordError) {
      return NextResponse.json({ error: "Invalid master password" }, { status: 401 })
    }

    return NextResponse.json({ error: "Failed to save vault" }, { status: 500 })
  }
}
