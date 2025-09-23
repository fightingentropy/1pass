import { NextResponse } from "next/server"
import { InvalidPasswordError } from "@/lib/crypto"
import { loadVault, vaultExists } from "@/lib/vault"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const masterPassword = body?.masterPassword as string | undefined

  if (!masterPassword) {
    return NextResponse.json({ error: "Master password is required" }, { status: 400 })
  }

  if (!(await vaultExists())) {
    return NextResponse.json({ error: "Vault not initialized" }, { status: 404 })
  }

  try {
    const data = await loadVault(masterPassword)
    return NextResponse.json({ data })
  } catch (error) {
    if (error instanceof InvalidPasswordError) {
      return NextResponse.json({ error: "Invalid master password" }, { status: 401 })
    }

    return NextResponse.json({ error: "Failed to load vault" }, { status: 500 })
  }
}
