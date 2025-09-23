import { NextResponse } from "next/server"
import { loadVault, vaultExists } from "@/lib/vault"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  if (!(await vaultExists())) {
    return NextResponse.json({ error: "Vault not initialized" }, { status: 404 })
  }

  try {
    const payload = await loadVault()
    return NextResponse.json({ payload })
  } catch {
    return NextResponse.json({ error: "Failed to load vault" }, { status: 500 })
  }
}
