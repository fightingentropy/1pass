import { NextResponse } from "next/server"
import { initializeVault, vaultExists } from "@/lib/vault"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const masterPassword = body?.masterPassword as string | undefined

  if (!masterPassword) {
    return NextResponse.json({ error: "Master password is required" }, { status: 400 })
  }

  if (await vaultExists()) {
    return NextResponse.json({ error: "Vault already initialized" }, { status: 409 })
  }

  try {
    await initializeVault(masterPassword)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to initialize vault" }, { status: 500 })
  }
}
