import { NextResponse } from "next/server"
import { vaultExists } from "@/lib/vault"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const exists = await vaultExists()
  return NextResponse.json({ exists })
}
